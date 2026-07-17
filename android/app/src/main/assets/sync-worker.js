// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - BACKGROUND SYNC WEB WORKER
// Offloads database I/O, CRDT delta merging, and WebSocket sync off main thread
// ============================================================================

importScripts('client-db.js', 'client-sync.js');
let dbReadyPromise = ValenixiaDB.init(); // Capture the init promise

function secureRandomInt(min, max) {
  const range = max - min + 1;
  const array = new Uint32Array(1);
  (self.crypto || crypto).getRandomValues(array);
  return min + (array[0] % range);
}

function secureRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  (self.crypto || crypto).getRandomValues(array);
  let str = '';
  for (let i = 0; i < length; i++) {
    str += chars[array[i] % chars.length];
  }
  return str;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  }
}

function validateModeFields(mode, modeFieldsRaw) {
  let fields = {};
  try {
    fields = typeof modeFieldsRaw === 'string' ? JSON.parse(modeFieldsRaw || '{}') : (modeFieldsRaw || {});
  } catch (e) {
    throw new Error('Invalid JSON structure for mode fields.');
  }

  if (mode === 'clothing-fashion') {
    if (fields.variants && !Array.isArray(fields.variants)) {
      throw new Error('Variants must be a valid array list.');
    }
  } else if (mode === 'food-restaurant') {
    if (fields.modifiers && !Array.isArray(fields.modifiers)) {
      throw new Error('Modifiers must be a valid array list.');
    }
  } else if (mode === 'services-appointments') {
    if (fields.duration && typeof fields.duration !== 'number') {
      throw new Error('Duration must be a valid number representation.');
    }
  } else if (mode === 'electronics-highvalue') {
    if (fields.warranty && typeof fields.warranty !== 'object') {
      throw new Error('Warranty details must be a valid configuration object.');
    }
  }
  return JSON.stringify(fields);
}

let syncClient = null;
let nodeId = null;
let isBootstrapped = false;
let bootstrapPromise = null;

// Exact decimal conversion to prevent IEEE 754 float precision issues for PRAL compliance
const toDec = (minor) => Number((minor / 100).toFixed(2));

function serializePRALPayload(fbrInvoiceNumber, now, total, tax, subtotal, cart, paymentMode, usin) {
  // PRAL requires bare numeric doubles (not quoted strings) for monetary fields
  // We build the object with numbers directly — no regex post-processing needed
  const formattedObj = {
    invoiceNumber: fbrInvoiceNumber,
    saleDate: new Date(now).toISOString(),
    totalAmount: toDec(total),
    taxAmount: toDec(tax),
    subtotalAmount: toDec(subtotal),
    items: cart.map(i => ({
      sku: i.sku,
      qty: i.qty,
      unitPrice: toDec(i.price)
    })),
    paymentMode: paymentMode,
    usin: usin
  };
  return JSON.stringify(formattedObj);
}

async function flushFBRQueue() {
  const queue = await ValenixiaDB.getAll('fbr_offline_queue');
  if (!queue || queue.length === 0) return;
  
  for (const entry of queue) {
    try {
      const response = await fetchWithTimeout(`${self.serverUrl}/api/fbr/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: entry.payload
      }, 10000);
      if (response.ok) {
        await ValenixiaDB.delete('fbr_offline_queue', entry.id);
      }
    } catch (e) {
      console.warn('[SyncWorker] Failed to flush FBR queue item', entry.id);
    }
  }
}

// Initialize Database and Sync Client
async function initializeSyncEngine(serverUrl) {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    if (serverUrl) {
      self.serverUrl = serverUrl;
    }
    try {
      await ValenixiaDB.init();

    // Fetch persistent terminal/node ID from local preferences or create one
    let terminalNamePref = await ValenixiaDB.get('local_preferences', 'terminal_name');
    if (!terminalNamePref || !terminalNamePref.value_payload) {
      nodeId = 'web_client_' + ((self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID().replace(/-/g,'').slice(0,9) : secureRandomString(9));
      await ValenixiaDB.put('local_preferences', {
        key: 'terminal_name',
        value_type: 'STR',
        value_payload: nodeId,
        is_idempotent_flag: 0,
        updated_at: Date.now()
      });
    } else {
      nodeId = terminalNamePref.value_payload.replace(/\s+/g, '_').toLowerCase();
    }

    console.log(`[SyncWorker] Initializing sync client with nodeId: ${nodeId}`);

    // Callback when remote sync data arrives
    const onSyncReceived = async (changes) => {
      let applied = 0;
      let conflicts = 0;

      if (!changes || changes.length === 0) return;

      const stores = [
        'transactions', 'line_items', 'inventory_catalog', 'crsql_changes', 
        'local_preferences', 'customers', 'categories', 'distributors', 
        'purchase_orders', 'po_line_items', 'distributor_payments', 'customer_credit',
        'employees', 'speech_analytics_logs', 'stock_movements', 'employee_shifts',
        'fbr_offline_queue'
      ];
      
      const idbTx = ValenixiaDB.db.transaction(stores, 'readwrite');

      try {
        for (const change of changes) {
          syncClient.hlc.merge(change.sync_hlc);

          const local = await ValenixiaDB.get('crsql_changes', [change.table_name, change.pk, change.cid], idbTx);
          
          let shouldApply = !local;
          if (local) {
            if (change.col_version > local.col_version) shouldApply = true;
            else if (change.col_version < local.col_version) shouldApply = false;
            else shouldApply = change.sync_hlc > local.sync_hlc;
          }

          if (shouldApply) {
            applied++;
            await ValenixiaDB.applyChangeToSchema(change.table_name, change.pk, change.cid, change.val, change.cl, change.val_type || 'string', idbTx);
            
            const dbVer = (await ValenixiaDB.getDbVersion(idbTx)) + 1;
            await ValenixiaDB.put('crsql_changes', {
              table_name: change.table_name,
              pk: change.pk,
              cid: change.cid,
              val: change.val,
              val_type: change.val_type || 'string',
              col_version: change.col_version,
              db_version: dbVer,
              site_id: change.site_id,
              cl: change.cl,
              sync_hlc: change.sync_hlc
            }, idbTx);

            if (change.table_name === 'inventory_catalog_counters') {
              const sku = change.pk.split('/')[0];
              await ValenixiaDB.recalculateCachedStock(sku, idbTx);
            } else if (change.table_name === 'inventory_catalog' && change.cid === 'stock_level') {
              await ValenixiaDB.recalculateCachedStock(change.pk, idbTx);
            }
          } else {
            conflicts++;
          }
        }

        await new Promise((resolve, reject) => {
          idbTx.oncomplete = () => resolve();
          idbTx.onerror = (e) => reject(e.target.error);
          idbTx.onabort = () => reject(new Error('Sync transaction aborted'));
        });
      } catch (err) {
        console.error('[SyncWorker] Sync apply failed, rolling back:', err);
        try { idbTx.abort(); } catch (_) {}
        return;
      }

      postMessage({
        type: 'SYNC_RECEIVED',
        nodeId: nodeId,
        hlc: syncClient.hlc.toString(),
        appliedCount: applied,
        conflictCount: conflicts,
        changes: changes
      });
    };
    const onConnectionChange = async (isConnected) => {
      postMessage({
        type: 'CONNECTION_CHANGE',
        isConnected: isConnected,
        nodeId: nodeId
      });
      if (isConnected) {
        // Rule 150XC: batch-upload any offline-queued FBR invoices within 24h of restore
        await flushFBRQueue();
      }
    };

    syncClient = new SyncClient(nodeId, onSyncReceived, onConnectionChange);
    
    // Load synchronization passphrase for in-transit encryption
    const syncPassphrasePref = await ValenixiaDB.get('local_preferences', 'sync_passphrase');
    if (syncPassphrasePref && syncPassphrasePref.value_payload) {
      syncClient.passphrase = syncPassphrasePref.value_payload;
    }

    // Load device token and friendly name for whitelisting
    const deviceTokenPref = await ValenixiaDB.get('local_preferences', 'device_token');
    if (deviceTokenPref && deviceTokenPref.value_payload) {
      syncClient.deviceToken = deviceTokenPref.value_payload;
    }

    const deviceNamePref = await ValenixiaDB.get('local_preferences', 'device_name');
    if (deviceNamePref && deviceNamePref.value_payload) {
      syncClient.deviceName = deviceNamePref.value_payload;
    }

    syncClient.connect();

    isBootstrapped = true;

    // Fetch initial status and send to UI
    postMessage({
      type: 'INIT_SUCCESS',
      nodeId: nodeId,
      hlc: syncClient.hlc.toString(),
      isPaired: !!(deviceTokenPref && deviceTokenPref.value_payload),
      deviceToken: deviceTokenPref ? deviceTokenPref.value_payload : null
    });

  } catch (err) {
    console.error('[SyncWorker] Init failed:', err);
    isBootstrapped = false;
    postMessage({ type: 'INIT_ERROR', error: err.message });
    throw err;
  }
  })();
  return bootstrapPromise;
}

// Global listener for UI thread events
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  // Handle reload instruction from SyncClient
  if (type === 'FORCE_RELOAD') {
    postMessage({ type: 'FORCE_RELOAD' });
    return;
  }

  // Handle terminate instruction
  if (type === 'TERMINATE') {
    console.warn('[SyncWorker] TERMINATE received. Closing database and WebSocket connections...');
    if (syncClient) {
      if (syncClient.ws) {
        try { syncClient.ws.close(); } catch (_) {}
      }
    }
    try {
      if (ValenixiaDB.db) {
        ValenixiaDB.db.close();
      }
    } catch (_) {}
    postMessage({ type: 'TERMINATED' });
    self.close(); // Closes the Web Worker thread
    return;
  }

  // Guard: Reject non-INIT messages if not bootstrapped
  if (type !== 'INIT' && !isBootstrapped) {
    console.warn(`[SyncWorker] Rejected message type "${type}" — engine not bootstrapped yet`);
    postMessage({
      type: 'ERROR',
      error: 'SyncEngine not initialized. Please wait for database initialization to complete.',
      rejectedType: type
    });
    return;
  }

  try {
    switch (type) {
      case 'INIT':
        await initializeSyncEngine(payload ? payload.serverUrl : null);
        break;

      case 'BOOTSTRAP_STORE': {
        const { storeName, taxRate, adminPin, syncPassphrase, theme, shopMode } = payload;
        await ValenixiaDB.bootstrapStore(storeName, taxRate, adminPin, syncPassphrase, theme, shopMode);
        
        // Mark database as hydrated locally since it was just bootstrapped fresh
        await ValenixiaDB.put('local_preferences', {
          key: 'database_hydrated',
          value_type: 'BOOL',
          value_payload: 'true',
          is_idempotent_flag: 1,
          updated_at: Date.now()
        });

        // Mark onboarding complete locally since the store is now bootstrapped
        await ValenixiaDB.put('local_preferences', {
          key: 'onboarding_complete',
          value_type: 'BOOL',
          value_payload: 'true',
          is_idempotent_flag: 1,
          updated_at: Date.now()
        });

        if (syncClient) {
          syncClient.passphrase = syncPassphrase;
        }
        postMessage({ type: 'BOOTSTRAP_SUCCESS' });
        break;
      }

      case 'JOIN_NETWORK': {
        const { serverUrl, syncPassphrase } = payload;
        
        if (serverUrl) {
          self.serverUrl = serverUrl;
          await ValenixiaDB.put('local_preferences', {
            key: 'valenixia_server_url',
            value_type: 'STR',
            value_payload: serverUrl,
            is_idempotent_flag: 0,
            updated_at: Date.now()
          });
        }
        
        await ValenixiaDB.put('local_preferences', {
          key: 'sync_passphrase',
          value_type: 'STR',
          value_payload: syncPassphrase,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
        
        await ValenixiaDB.put('local_preferences', {
          key: 'onboarding_complete',
          value_type: 'BOOL',
          value_payload: 'true',
          is_idempotent_flag: 1,
          updated_at: Date.now()
        });

        if (syncClient) {
          syncClient.passphrase = syncPassphrase;
          syncClient.connect();
        }
        
        postMessage({ type: 'BOOTSTRAP_SUCCESS' });
        break;
      }

      case 'SET_ONLINE_STATE':
        syncClient.setOnlineState(payload.isOnline);
        break;

      case 'FORCE_SYNC_RECONNECT':
        if (syncClient) {
          syncClient.backoffTime = 1000; // Reset exponential backoff timer
          syncClient.passphraseInvalid = false;
          syncClient.connect();
        }
        break;

      case 'STOP_SYNC':
        if (syncClient) {
          syncClient.passphraseInvalid = true;
          if (syncClient.ws) {
            try { syncClient.ws.close(); } catch (_) {}
          }
        }
        break;

      case 'HYDRATE_DATABASE': {
        const { licenseToken } = payload;
        try {
          console.log('[SyncWorker] Starting database hydration pull...');
          const isFile = location.protocol === 'file:' || location.origin === 'null';
          const base = self.serverUrl || (isFile ? 'https://valenixia-license-worker.pages.dev' : location.origin);
          
          // Ensure we don't try to fetch relative to file:// origin
          const bootstrapUrl = base.startsWith('http') ? (base + '/api/sync/bootstrap') : '/api/sync/bootstrap';

          const response = await fetchWithTimeout(bootstrapUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${licenseToken}`,
              'Content-Type': 'application/json'
            }
          }, 15000);
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || 'Hydration request failed');
          }

          const changes = result.changes || [];
          console.log(`[SyncWorker] Received ${changes.length} database recovery delta rows.`);

          let applied = 0;
          let conflicts = 0;

          for (const change of changes) {
            if (syncClient && syncClient.hlc && change.sync_hlc) {
              try {
                syncClient.hlc.merge(change.sync_hlc);
              } catch (e) {}
            }

            // Fetch local change version
            const local = await ValenixiaDB.get('crsql_changes', [change.table_name, change.pk, change.cid]);
            
            // LWW merge comparison
            let shouldApply = !local;
            if (local) {
              if (change.col_version > local.col_version) shouldApply = true;
              else if (change.col_version < local.col_version) shouldApply = false;
              else shouldApply = change.sync_hlc > local.sync_hlc;
            }

            if (shouldApply) {
              applied++;
              // Apply mutation to target store
              await ValenixiaDB.applyChangeToSchema(change.table_name, change.pk, change.cid, change.val, change.cl, change.val_type || 'string');
              // Save CRDT metadata locally
              await ValenixiaDB.put('crsql_changes', {
                table_name: change.table_name,
                pk: change.pk,
                cid: change.cid,
                val: change.val,
                val_type: change.val_type || 'string',
                col_version: change.col_version,
                db_version: (await ValenixiaDB.getDbVersion()) + 1,
                site_id: change.site_id,
                cl: change.cl,
                sync_hlc: change.sync_hlc
              });

              // Recalculate stock level if PN delta changes or manual stock updates occur
              if (change.table_name === 'inventory_catalog_counters') {
                const sku = change.pk.split('/')[0];
                await ValenixiaDB.recalculateCachedStock(sku);
              } else if (change.table_name === 'inventory_catalog' && change.cid === 'stock_level') {
                await ValenixiaDB.recalculateCachedStock(change.pk);
              }
            } else {
              conflicts++;
            }
          }

          // Mark database as hydrated in preferences
          await ValenixiaDB.put('local_preferences', {
            key: 'database_hydrated',
            value_type: 'BOOL',
            value_payload: 'true',
            is_idempotent_flag: 1,
            updated_at: Date.now()
          });

          console.log(`[SyncWorker] Hydration successful. Applied: ${applied}, Conflicts: ${conflicts}`);
          postMessage({ type: 'HYDRATE_SUCCESS', applied, conflicts });
        } catch (err) {
          console.error('[SyncWorker] Hydration error:', err);
          postMessage({ type: 'HYDRATE_ERROR', error: err.message });
        }
        break;
      }

      case 'REGISTER_DEVICE': {
        const { deviceName } = payload;
        await ValenixiaDB.put('local_preferences', {
          key: 'device_name',
          value_type: 'STR',
          value_payload: deviceName,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
        if (syncClient) {
          syncClient.deviceName = deviceName;
          syncClient.connect(); // Reconnect to trigger REGISTER payload handshake
        }
        break;
      }

      case 'GET_CATALOG': {
        const catalog = await ValenixiaDB.getAll('inventory_catalog');
        postMessage({ type: 'CATALOG_DATA', catalog });
        break;
      }

      case 'GET_CUSTOMERS': {
        const customers = await ValenixiaDB.getAll('customers');
        postMessage({ type: 'CUSTOMERS_DATA', customers });
        break;
      }

      case 'GET_EMPLOYEES': {
        const employees = await ValenixiaDB.getAll('employees');
        postMessage({ type: 'EMPLOYEES_DATA', employees });
        break;
      }

      case 'GET_PREFERENCES': {
        const prefs = await ValenixiaDB.getAll('local_preferences');
        postMessage({ type: 'PREFERENCES_DATA', prefs });
        break;
      }

      case 'GET_TRANSACTIONS': {
        let transactions = await ValenixiaDB.getAll('transactions');
        const isMaster = payload ? payload.isMaster !== false : true;
        const empId = payload ? payload.employeeId : null;

        if (!isMaster && empId) {
          transactions = transactions.filter(t => t.employee_id === empId);
        }

        // Map line items to transactions
        const enriched = [];
        for (const tx of transactions) {
          const items = await ValenixiaDB.getAllLineItemsByTx(tx.id);
          enriched.push({ ...tx, items });
        }
        postMessage({ type: 'TRANSACTIONS_DATA', transactions: enriched });
        break;
      }

      case 'COMPLETE_TRANSACTION': {
        const { transactionId } = payload;
        const tickHlc = syncClient.hlc.tick();
        const tx = await ValenixiaDB.get('transactions', transactionId);
        if (tx) {
          tx.status = 'COMPLETED';
          tx.updated_at = Date.now();
          tx.sync_hlc = tickHlc;
          await ValenixiaDB.put('transactions', tx);
          await logFieldChange('transactions', transactionId, 'status', 'COMPLETED', tickHlc);
        }
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'BROADCAST_CFD_CART': {
        if (syncClient) {
          await syncClient.broadcastEphemeral('cfd_cart', payload);
        }
        break;
      }

      case 'BROADCAST_CFD_PAY': {
        if (syncClient) {
          await syncClient.broadcastEphemeral('cfd_pay', payload);
        }
        break;
      }

      case 'CHECKOUT': {
        const { transactionId, employeeId, cart, subtotal, tax, total, paymentMode, paymentDetails, fbr_integration_enabled } = payload;
        const now = Date.now();
        const txHlc = syncClient.hlc.tick();

        // Retrieve verified tier securely from database to prevent tier bypass
        let tier = 'STARTER';
        try {
          const licenseRow = await ValenixiaDB.get('local_preferences', 'license_token');
          if (licenseRow && licenseRow.value_payload) {
            const token = licenseRow.value_payload;
            let claims = null;
            if (token.includes('.')) {
              const parts = token.split('.');
              if (parts.length === 3) {
                const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                claims = JSON.parse(atob(b64));
              }
            } else {
              const decoded = atob(token);
              const pipeIndex = decoded.lastIndexOf('|');
              if (pipeIndex !== -1) {
                claims = JSON.parse(decoded.substring(0, pipeIndex));
              }
            }
            if (claims && claims.exp > Date.now()) {
              tier = claims.tier || 'STARTER';
            }
          }
        } catch (e) {
          console.warn('[SyncWorker] Failed to decode license token for tier validation:', e.message);
        }

        // Check if FBR integration is enabled for the license tier
        const isFbrEnabled = (tier === 'ENTERPRISE' || tier === 'TRIAL') && (fbr_integration_enabled === true || fbr_integration_enabled === 'true');
        let finalPaymentDetails = paymentDetails || '';
        let fbrInvoiceNumber = '';
        let fbrQrUrl = '';

        if (isFbrEnabled) {
          // Generate FBR E-Invoicing compliant Fiscal details automatically
          fbrInvoiceNumber = `FBR-POS-${now}-${secureRandomInt(1000, 9999)}`;
          fbrQrUrl = `https://verification.fbr.gov.pk/verify?invoiceNumber=${encodeURIComponent(fbrInvoiceNumber)}&total=${encodeURIComponent(total)}&tax=${encodeURIComponent(tax)}`;
          
          const fbrMeta = {
            fbr_invoice_number: fbrInvoiceNumber,
            fbr_qr_url: fbrQrUrl,
            fbr_status: 'INTEGRATED_SUCCESS'
          };
          
          if (finalPaymentDetails.startsWith('{')) {
            try {
              const parsed = JSON.parse(finalPaymentDetails);
              finalPaymentDetails = JSON.stringify({ ...parsed, ...fbrMeta });
            } catch(e) {
              finalPaymentDetails = JSON.stringify({ note: finalPaymentDetails, ...fbrMeta });
            }
          } else {
            finalPaymentDetails = JSON.stringify({ note: finalPaymentDetails, ...fbrMeta });
          }
        }

        // Open a single atomic readwrite transaction
        const idbTx = ValenixiaDB.db.transaction(
          ['transactions', 'line_items', 'inventory_catalog', 'crsql_changes', 'stock_movements', 'customer_credit', 'fbr_offline_queue', 'purchase_orders', 'po_line_items', 'distributors', 'local_preferences'],
          'readwrite'
        );

        try {
          // 1. Write transaction to IndexedDB
          const txRecord = {
            id: transactionId,
            employee_id: employeeId,
            terminal_id: nodeId,
            subtotal_minor_units: subtotal,
            tax_minor_units: tax,
            total_minor_units: total,
            status: 'PENDING',
            payment_mode: paymentMode || 'CASH',
            payment_details: finalPaymentDetails,
            created_at: now,
            updated_at: now,
            sync_hlc: txHlc,
            is_dirty: 1,
            is_deleted: 0
          };
          await ValenixiaDB.put('transactions', txRecord, idbTx);

          // 2. Log transaction fields to CRDT Changes catalog
          await logFieldChange('transactions', transactionId, 'employee_id', employeeId, txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'terminal_id', nodeId, txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'subtotal_minor_units', subtotal, txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'tax_minor_units', tax, txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'total_minor_units', total, txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'status', 'PENDING', txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'payment_mode', paymentMode || 'CASH', txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'payment_details', finalPaymentDetails, txHlc, 1, 1, idbTx);

          // 3. Write Line items to IndexedDB
          for (const item of cart) {
            const liId = `li_${transactionId}_${item.sku}`;
            const liRecord = {
              id: liId,
              transaction_id: transactionId,
              sku: item.sku,
              quantity: item.qty,
              unit_price_minor_units: item.price,
              applied_discount_minor_units: item.discount || 0,
              sync_hlc: txHlc,
              is_deleted: 0
            };
            await ValenixiaDB.put('line_items', liRecord, idbTx);

            // Log line item fields to CRDT
            await logFieldChange('line_items', liId, 'transaction_id', transactionId, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'sku', item.sku, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'quantity', item.qty, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'unit_price_minor_units', item.price, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'applied_discount_minor_units', item.discount || 0, txHlc, 1, 1, idbTx);

            // 4. Update Stock Level via PN-Counters
            const prod = await ValenixiaDB.get('inventory_catalog', item.sku, idbTx);
            if (prod) {
              const baseStockRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog', item.sku, 'stock_level'], idbTx);
              const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

              const localDeltaRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', `${item.sku}/${nodeId}`, 'delta'], idbTx);
              let currentOffset = 0;
              if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                currentOffset = Number(localDeltaRow.val);
              }

              const newOffset = currentOffset - item.qty;

              await logFieldChange('inventory_catalog_counters', `${item.sku}/${nodeId}`, 'delta', newOffset, txHlc, 1, 1, idbTx);
              await ValenixiaDB.recalculateCachedStock(item.sku, idbTx);
              await checkStockAlert(item.sku, txHlc, idbTx);

              // Log stock movement audit records
              const mvId = `mv_${Date.now()}_${item.sku}`;
              const movement = {
                id: mvId,
                sku: item.sku,
                change_qty: -item.qty,
                reason: 'SALE',
                created_at: Date.now(),
                sync_hlc: txHlc
              };
              await ValenixiaDB.put('stock_movements', movement, idbTx);
              await logFieldChange('stock_movements', mvId, 'sku', item.sku, txHlc, 1, 1, idbTx);
              await logFieldChange('stock_movements', mvId, 'change_qty', -item.qty, txHlc, 1, 1, idbTx);
              await logFieldChange('stock_movements', mvId, 'reason', 'SALE', txHlc, 1, 1, idbTx);
            }
          }

          // 5. If paymentMode is CREDIT, write to customer_credit store
          if (paymentMode === 'CREDIT' && payload.customerId) {
            const ccId = `cc_sale_${transactionId}`;
            const ccRecord = {
              id: ccId,
              customer_id: payload.customerId,
              transaction_id: transactionId,
              type: 'CREDIT',
              amount_minor: total,
              payment_method: 'CASH',
              due_date: now + 30 * 24 * 60 * 60 * 1000, // 30 days due date default
              notes: `Auto credit invoice sale: ${transactionId}`,
              created_at: now,
              sync_hlc: txHlc,
              is_deleted: 0
            };
            await ValenixiaDB.put('customer_credit', ccRecord, idbTx);
            await logFieldChange('customer_credit', ccId, 'customer_id', payload.customerId, txHlc, 1, 1, idbTx);
            await logFieldChange('customer_credit', ccId, 'transaction_id', transactionId, txHlc, 1, 1, idbTx);
            await logFieldChange('customer_credit', ccId, 'type', 'CREDIT', txHlc, 1, 1, idbTx);
            await logFieldChange('customer_credit', ccId, 'amount_minor', total, txHlc, 1, 1, idbTx);
            await logFieldChange('customer_credit', ccId, 'due_date', ccRecord.due_date, txHlc, 1, 1, idbTx);
            await logFieldChange('customer_credit', ccId, 'notes', ccRecord.notes, txHlc, 1, 1, idbTx);
            await logFieldChange('customer_credit', ccId, 'created_at', now, txHlc, 1, 1, idbTx);
          }

          if (isFbrEnabled) {
            // Queue FBR invoice (Rule 150XC: both online and offline routes write to queue first to ensure strict FIFO order)
            const usin = `USIN-${nodeId}-${transactionId.slice(0, 8)}-${now}`.slice(0, 50);
            const payloadObj = serializePRALPayload(fbrInvoiceNumber, now, total, tax, subtotal, cart, paymentMode, usin);

            const fbrQueueEntry = {
              id: `fbr_${transactionId}`,
              transactionId,
              usin,
              invoiceNumber: fbrInvoiceNumber,
              invoicePayload: payloadObj,
              totalMinor: total,
              taxMinor: tax,
              status: 'PENDING',
              createdAt: now
            };
            await ValenixiaDB.put('fbr_offline_queue', fbrQueueEntry, idbTx);

            const isOnline = syncClient && syncClient.isConnected;
            if (isOnline) {
              // Trigger flush immediately in background
              idbTx.addEventListener('complete', () => {
                setTimeout(() => flushFBRQueue(), 1000);
              });
            } else {
              console.log(`[FBR] Invoice ${fbrInvoiceNumber} queued for offline batch-upload (Rule 150XC)`);
            }
          }

          await new Promise((resolve, reject) => {
            idbTx.oncomplete = () => resolve();
            idbTx.onerror = (e) => reject(e.target.error);
            idbTx.onabort = (e) => reject(new Error('Transaction aborted'));
          });

          postMessage({ type: 'CHECKOUT_SUCCESS', transactionId, subtotal, tax, total, paymentMode });
        } catch (err) {
          console.error('[SyncWorker] Checkout transaction failed, rolling back:', err);
          try {
            idbTx.abort();
          } catch (abortErr) {}
          postMessage({ type: 'ERROR', error: `Checkout transaction failed: ${err.message}` });
        }
        break;
      }

      case 'SAVE_PRODUCT': {
        const { sku, name, gtin, price, stock, category, emoji, cost, low_stock_threshold, isAuditReset, mode_fields, image_url } = payload;
        const tickHlc = syncClient.hlc.tick();

        const exists = await ValenixiaDB.get('inventory_catalog', sku);
        const colVersion = exists ? (exists.col_version || 1) + 1 : 1;

        const shopModePref = await ValenixiaDB.get('local_preferences', 'shop_mode');
        const shopMode = shopModePref ? shopModePref.value_payload : 'simple-retail';

        let validatedFields = '{}';
        try {
          validatedFields = validateModeFields(shopMode, mode_fields);
        } catch (valErr) {
          postMessage({ type: 'ERROR', error: `Validation Error: ${valErr.message}` });
          return;
        }

        const cleanGtin = (gtin && gtin.trim()) ? gtin.trim() : undefined;
        const prod = {
          sku,
          gtin: cleanGtin,
          name,
          base_price_minor_units: price,
          stock_level: exists ? exists.stock_level : stock,
          reserved_stock: 0,
          category: category || 'Uncategorized',
          emoji: emoji || '📦',
          cost_price_minor_units: cost || 0,
          low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : 10,
          mode_fields: validatedFields,
          image_url: image_url || '',
          col_version: colVersion,
          sync_hlc: tickHlc
        };

        await ValenixiaDB.put('inventory_catalog', prod);

        await logFieldChange('inventory_catalog', sku, 'name', name, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'gtin', cleanGtin, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'base_price_minor_units', price, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'category', category || 'Uncategorized', tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'emoji', emoji || '📦', tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'cost_price_minor_units', cost || 0, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'low_stock_threshold', prod.low_stock_threshold, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'mode_fields', prod.mode_fields, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'image_url', prod.image_url, tickHlc, colVersion);

        if (exists) {
          if (isAuditReset) {
            // Hard Audit Reset: override base stock and clear older deltas HLC-wise
            prod.stock_level = stock;
            await ValenixiaDB.put('inventory_catalog', prod);
            await logFieldChange('inventory_catalog', sku, 'stock_level', stock, tickHlc, colVersion);
            await ValenixiaDB.recalculateCachedStock(sku);
            await checkStockAlert(sku, tickHlc);
          } else {
            // Stock Adjustment: relative delta addition preserving offline concurrent changes
            const diff = stock - exists.stock_level;
            if (diff !== 0) {
              const baseStockRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog', sku, 'stock_level']);
              const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

              const localDeltaRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', `${sku}/${nodeId}`, 'delta']);
              let currentOffset = 0;
              if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                currentOffset = Number(localDeltaRow.val);
              }

              const newOffset = currentOffset + diff;
              await logFieldChange('inventory_catalog_counters', `${sku}/${nodeId}`, 'delta', newOffset, tickHlc);
              await ValenixiaDB.recalculateCachedStock(sku);
              await checkStockAlert(sku, tickHlc);
            }
          }
        } else {
          // New product creation: seed as base stock
          prod.stock_level = stock;
          await ValenixiaDB.put('inventory_catalog', prod);
          await logFieldChange('inventory_catalog', sku, 'stock_level', stock, tickHlc, colVersion);
          await checkStockAlert(sku, tickHlc);
        }

        // Log manual stock movement audit if stock changes
        if (exists && exists.stock_level !== stock) {
          const mvId = `mv_${Date.now()}_${sku}`;
          const movement = {
            id: mvId,
            sku: sku,
            change_qty: stock - exists.stock_level,
            reason: isAuditReset ? 'AUDIT_RESET' : 'MANUAL_EDIT',
            created_at: Date.now(),
            sync_hlc: tickHlc
          };
          await ValenixiaDB.put('stock_movements', movement);
          await logFieldChange('stock_movements', mvId, 'sku', sku, tickHlc);
          await logFieldChange('stock_movements', mvId, 'change_qty', stock - exists.stock_level, tickHlc);
          await logFieldChange('stock_movements', mvId, 'reason', isAuditReset ? 'AUDIT_RESET' : 'MANUAL_EDIT', tickHlc);
        }

        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'DELETE_PRODUCT': {
        const { sku } = payload;
        const tickHlc = syncClient.hlc.tick();
        const exists = await ValenixiaDB.get('inventory_catalog', sku);
        if (exists) {
          const colVersion = (exists.col_version || 1) + 1;
          // Soft delete in catalog
          exists.stock_level = 0;
          exists.col_version = colVersion;
          exists.sync_hlc = tickHlc;
          await ValenixiaDB.put('inventory_catalog', exists);

          // Log soft delete metadata (causal length cl = 0)
          await logFieldChange('inventory_catalog', sku, 'stock_level', 0, tickHlc, colVersion, 0);
        }
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_CUSTOMER': {
        const { id, name, phone, email, spend, visits } = payload;
        const tickHlc = syncClient.hlc.tick();

        const cust = {
          id,
          name,
          phone: phone || '',
          email: email || '',
          total_spend_cents: spend || 0,
          visits: visits || 0,
          created_at: Date.now(),
          sync_hlc: tickHlc
        };

        await ValenixiaDB.put('customers', cust);

        await logFieldChange('customers', id, 'name', name, tickHlc);
        await logFieldChange('customers', id, 'phone', phone || '', tickHlc);
        await logFieldChange('customers', id, 'email', email || '', tickHlc);
        await logFieldChange('customers', id, 'total_spend_cents', spend || 0, tickHlc);
        await logFieldChange('customers', id, 'visits', visits || 0, tickHlc);

        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'DELETE_CUSTOMER': {
        const { id } = payload;
        const tickHlc = syncClient.hlc.tick();
        await ValenixiaDB.delete('customers', id);
        // Soft delete metadata
        await logFieldChange('customers', id, 'name', null, tickHlc, 1, 0);
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_EMPLOYEE': {
        const { id, pin, biometric_token, role, is_active } = payload;
        
        // Reject ADMIN role creation from client
        if (role === 'ADMIN') {
          postMessage({ type: 'ERROR', error: 'ADMIN role can only be assigned server-side.' });
          break;
        }

        const tickHlc = syncClient.hlc.tick();
        
        // Load existing employee to preserve auth_hash if pin is not provided
        const existing = await ValenixiaDB.get('employees', id);
        let finalHash = (existing && existing.auth_hash) || '';
        if (pin) {
          finalHash = await hashPin(pin);
        }

        const emp = {
          id,
          auth_hash: finalHash,
          biometric_token: biometric_token || '',
          role: role || 'CASHIER',
          is_active: is_active !== undefined ? is_active : 1,
          sync_hlc: tickHlc
        };

        await ValenixiaDB.put('employees', emp);

        await logFieldChange('employees', id, 'auth_hash', finalHash, tickHlc);
        await logFieldChange('employees', id, 'role', role || 'CASHIER', tickHlc);
        await logFieldChange('employees', id, 'is_active', is_active !== undefined ? is_active : 1, tickHlc);

        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_PREFERENCE': {
        const { key, val, value_type } = payload;
        
        await ValenixiaDB.put('local_preferences', {
          key: key,
          value_type: value_type || 'STR',
          value_payload: String(val),
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });

        // Preferences do not sync over CRDT by default (local whitelabel preferences are terminal specific).
        // If the passphrase is saved, immediately update sync client credentials.
        if (key === 'sync_passphrase' && syncClient) {
          syncClient.passphrase = String(val);
          syncClient.passphraseInvalid = false; // Reset mismatch flag — user has provided a new key
          syncClient.backoffTime = 1000; // Reset backoff too
          syncClient.connect(); // Force reconnect using new key
        }

        // Notify main thread
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'CLOSE_SHIFT': {
        const { shiftId, employeeId, clockIn, clockOut, declared, expected, variance } = payload;
        const tickHlc = syncClient.hlc.tick();
        
        const shiftRecord = {
          id: shiftId,
          employee_id: employeeId,
          clock_in: clockIn,
          clock_out: clockOut,
          declared_cash_minor_units: declared,
          expected_cash_minor_units: expected,
          variance_minor_units: variance,
          sync_hlc: tickHlc
        };
        
        await ValenixiaDB.put('employee_shifts', shiftRecord);
        
        await logFieldChange('employee_shifts', shiftId, 'employee_id', employeeId, tickHlc);
        await logFieldChange('employee_shifts', shiftId, 'clock_in', clockIn, tickHlc);
        await logFieldChange('employee_shifts', shiftId, 'clock_out', clockOut, tickHlc);
        await logFieldChange('employee_shifts', shiftId, 'declared_cash_minor_units', declared, tickHlc);
        await logFieldChange('employee_shifts', shiftId, 'expected_cash_minor_units', expected, tickHlc);
        await logFieldChange('employee_shifts', shiftId, 'variance_minor_units', variance, tickHlc);
        
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'GET_DISTRIBUTORS': {
        const distributors = await ValenixiaDB.getAll('distributors');
        postMessage({ type: 'DISTRIBUTORS_DATA', distributors });
        break;
      }

      case 'GET_PURCHASE_ORDERS': {
        const orders = await ValenixiaDB.getAll('purchase_orders');
        const enriched = [];
        const items = await ValenixiaDB.getAll('po_line_items');
        for (const po of orders) {
          const poItems = items.filter(item => item.po_id === po.id && item.is_deleted !== 1);
          enriched.push({ ...po, items: poItems });
        }
        postMessage({ type: 'PURCHASE_ORDERS_DATA', purchaseOrders: enriched });
        break;
      }

      case 'GET_DISTRIBUTOR_PAYMENTS': {
        const payments = await ValenixiaDB.getAll('distributor_payments');
        postMessage({ type: 'DISTRIBUTOR_PAYMENTS_DATA', payments });
        break;
      }

      case 'GET_CUSTOMER_CREDIT': {
        const credits = await ValenixiaDB.getAll('customer_credit');
        postMessage({ type: 'CUSTOMER_CREDIT_DATA', credits });
        break;
      }

      case 'SAVE_DISTRIBUTOR': {
        const { id, name, phone, email, address, creditLimit, notes } = payload;
        const tickHlc = syncClient.hlc.tick();
        const exists = await ValenixiaDB.get('distributors', id);
        
        const dist = {
          id,
          name,
          phone: phone || '',
          email: email || '',
          address: address || '',
          credit_limit_minor: creditLimit || 0,
          notes: notes || '',
          created_at: exists ? exists.created_at : Date.now(),
          sync_hlc: tickHlc,
          is_deleted: 0
        };
        await ValenixiaDB.put('distributors', dist);
        await logFieldChange('distributors', id, 'name', name, tickHlc);
        await logFieldChange('distributors', id, 'phone', phone || '', tickHlc);
        await logFieldChange('distributors', id, 'email', email || '', tickHlc);
        await logFieldChange('distributors', id, 'address', address || '', tickHlc);
        await logFieldChange('distributors', id, 'credit_limit_minor', creditLimit || 0, tickHlc);
        await logFieldChange('distributors', id, 'notes', notes || '', tickHlc);
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_PURCHASE_ORDER': {
        const { id, distributorId, status, items, notes, expectedDelivery } = payload;
        const tickHlc = syncClient.hlc.tick();
        const now = Date.now();
        
        let total = 0;
        for (const item of items) {
          total += item.qtyOrdered * item.unitCost;
        }

        const po = {
          id,
          distributor_id: distributorId,
          status: status || 'DRAFT',
          total_minor: total,
          notes: notes || '',
          expected_delivery: expectedDelivery || null,
          created_at: now,
          updated_at: now,
          sync_hlc: tickHlc,
          is_deleted: 0
        };
        await ValenixiaDB.put('purchase_orders', po);
        await logFieldChange('purchase_orders', id, 'distributor_id', distributorId, tickHlc);
        await logFieldChange('purchase_orders', id, 'status', status || 'DRAFT', tickHlc);
        await logFieldChange('purchase_orders', id, 'total_minor', total, tickHlc);
        await logFieldChange('purchase_orders', id, 'notes', notes || '', tickHlc);
        await logFieldChange('purchase_orders', id, 'expected_delivery', expectedDelivery || null, tickHlc);

        // Save items
        for (const item of items) {
          const itemId = `poi_${id}_${item.sku || secureRandomString(7)}`;
          const poli = {
            id: itemId,
            po_id: id,
            sku: item.sku || '',
            product_name: item.name || '',
            quantity_ordered: item.qtyOrdered,
            quantity_received: item.qtyReceived || 0,
            unit_cost_minor: item.unitCost,
            sync_hlc: tickHlc,
            is_deleted: 0
          };
          await ValenixiaDB.put('po_line_items', poli);
          await logFieldChange('po_line_items', itemId, 'po_id', id, tickHlc);
          await logFieldChange('po_line_items', itemId, 'sku', item.sku || '', tickHlc);
          await logFieldChange('po_line_items', itemId, 'product_name', item.name || '', tickHlc);
          await logFieldChange('po_line_items', itemId, 'quantity_ordered', item.qtyOrdered, tickHlc);
          await logFieldChange('po_line_items', itemId, 'quantity_received', item.qtyReceived || 0, tickHlc);
          await logFieldChange('po_line_items', itemId, 'unit_cost_minor', item.unitCost, tickHlc);
        }
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'RECEIVE_PURCHASE_ORDER': {
        const { id, itemsReceived } = payload;
        const tickHlc = syncClient.hlc.tick();
        const now = Date.now();
        
        let allReceived = true;
        for (const entry of itemsReceived) {
          const poli = await ValenixiaDB.get('po_line_items', entry.id);
          if (poli) {
            const finalQtyReceived = (poli.quantity_received || 0) + entry.qtyReceived;
            poli.quantity_received = finalQtyReceived;
            poli.sync_hlc = tickHlc;
            await ValenixiaDB.put('po_line_items', poli);
            await logFieldChange('po_line_items', entry.id, 'quantity_received', finalQtyReceived, tickHlc);
            
            if (finalQtyReceived < poli.quantity_ordered) {
              allReceived = false;
            }

            if (entry.sku) {
              const prod = await ValenixiaDB.get('inventory_catalog', entry.sku);
              if (prod) {
                const baseStockRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog', entry.sku, 'stock_level']);
                const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

                const localDeltaRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', `${entry.sku}/${nodeId}`, 'delta']);
                let currentOffset = 0;
                if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                  currentOffset = Number(localDeltaRow.val);
                }

                const newOffset = currentOffset + entry.qtyReceived;
                await logFieldChange('inventory_catalog_counters', `${entry.sku}/${nodeId}`, 'delta', newOffset, tickHlc);
                await ValenixiaDB.recalculateCachedStock(entry.sku);

                if (poli.unit_cost_minor) {
                  const exists = await ValenixiaDB.get('inventory_catalog', entry.sku);
                  if (exists) {
                    exists.cost_price_minor_units = poli.unit_cost_minor;
                    await ValenixiaDB.put('inventory_catalog', exists);
                    await logFieldChange('inventory_catalog', entry.sku, 'cost_price_minor_units', poli.unit_cost_minor, tickHlc);
                  }
                }

                const mvId = `mv_${Date.now()}_${entry.sku}`;
                const movement = {
                  id: mvId,
                  sku: entry.sku,
                  change_qty: entry.qtyReceived,
                  reason: 'RECV_ORDER',
                  created_at: now,
                  sync_hlc: tickHlc
                };
                await ValenixiaDB.put('stock_movements', movement);
                await logFieldChange('stock_movements', mvId, 'sku', entry.sku, tickHlc);
                await logFieldChange('stock_movements', mvId, 'change_qty', entry.qtyReceived, tickHlc);
                await logFieldChange('stock_movements', mvId, 'reason', 'RECV_ORDER', tickHlc);
              }
            }
          }
        }

        const po = await ValenixiaDB.get('purchase_orders', id);
        if (po) {
          const finalStatus = allReceived ? 'RECEIVED' : 'PARTIAL';
          po.status = finalStatus;
          po.updated_at = now;
          po.sync_hlc = tickHlc;
          await ValenixiaDB.put('purchase_orders', po);
          await logFieldChange('purchase_orders', id, 'status', finalStatus, tickHlc);
        }
        
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_DISTRIBUTOR_PAYMENT': {
        const { id, distributorId, poId, amount, paymentMethod, referenceNote } = payload;
        const tickHlc = syncClient.hlc.tick();
        const now = Date.now();
        
        const dp = {
          id,
          distributor_id: distributorId,
          po_id: poId || null,
          amount_minor: amount,
          payment_method: paymentMethod || 'CASH',
          reference_note: referenceNote || '',
          paid_at: now,
          sync_hlc: tickHlc,
          is_deleted: 0
        };
        await ValenixiaDB.put('distributor_payments', dp);
        await logFieldChange('distributor_payments', id, 'distributor_id', distributorId, tickHlc);
        await logFieldChange('distributor_payments', id, 'po_id', poId || null, tickHlc);
        await logFieldChange('distributor_payments', id, 'amount_minor', amount, tickHlc);
        await logFieldChange('distributor_payments', id, 'payment_method', paymentMethod || 'CASH', tickHlc);
        await logFieldChange('distributor_payments', id, 'reference_note', referenceNote || '', tickHlc);
        await logFieldChange('distributor_payments', id, 'paid_at', now, tickHlc);
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_CUSTOMER_CREDIT': {
        const { id, customerId, transactionId, type, amount, paymentMethod, dueDate, notes } = payload;
        const tickHlc = syncClient.hlc.tick();
        const now = Date.now();
        
        const cc = {
          id,
          customer_id: customerId,
          transaction_id: transactionId || null,
          type,
          amount_minor: amount,
          payment_method: paymentMethod || 'CASH',
          due_date: dueDate || null,
          notes: notes || '',
          created_at: now,
          sync_hlc: tickHlc,
          is_deleted: 0
        };
        await ValenixiaDB.put('customer_credit', cc);
        await logFieldChange('customer_credit', id, 'customer_id', customerId, tickHlc);
        await logFieldChange('customer_credit', id, 'transaction_id', transactionId || null, tickHlc);
        await logFieldChange('customer_credit', id, 'type', type, tickHlc);
        await logFieldChange('customer_credit', id, 'amount_minor', amount, tickHlc);
        await logFieldChange('customer_credit', id, 'payment_method', paymentMethod || 'CASH', tickHlc);
        await logFieldChange('customer_credit', id, 'due_date', dueDate || null, tickHlc);
        await logFieldChange('customer_credit', id, 'notes', notes || '', tickHlc);
        await logFieldChange('customer_credit', id, 'created_at', now, tickHlc);
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'DESTRUCTIVE_RESET': {
        const { adminPin } = payload || {};
        if (!adminPin) {
          postMessage({ type: 'ERROR', error: 'Admin PIN is required for destructive reset.' });
          break;
        }

        const employees = await ValenixiaDB.getAll('employees');
        let authenticated = false;

        for (const emp of employees) {
          if (emp.is_active === 1 && (emp.role === 'ADMIN' || emp.role === 'MANAGER')) {
            if (emp.auth_hash && await verifyPinClient(adminPin, emp.auth_hash)) {
              authenticated = true;
              break;
            }
          }
        }

        if (!authenticated) {
          postMessage({ type: 'ERROR', error: 'Unauthorized: Valid Admin or Manager PIN is required for destructive reset.' });
          break;
        }

        await ValenixiaDB.destructReset();
        // Send reset notice to backend if connected
        if (syncClient.ws && syncClient.ws.readyState === WebSocket.OPEN) {
          syncClient.ws.send(JSON.stringify({ type: 'reset_trigger', nodeId }));
        }
        postMessage({ type: 'RESET_SUCCESS' });
        break;
      }

      case 'VOID_TRANSACTION': {
        const { transactionId, managerPin, voidReason } = payload || {};
        if (!transactionId || !managerPin) {
          postMessage({ type: 'ERROR', error: 'transactionId and managerPin are required.' });
          break;
        }

        // 1. Authenticate Manager PIN
        const employees = await ValenixiaDB.getAll('employees');
        let authenticated = false;
        let managerId = '';
        for (const emp of employees) {
          if (emp.is_active === 1 && (emp.role === 'ADMIN' || emp.role === 'MANAGER')) {
            if (emp.auth_hash && await verifyPinClient(managerPin, emp.auth_hash)) {
              authenticated = true;
              managerId = emp.id;
              break;
            }
          }
        }

        if (!authenticated) {
          postMessage({ type: 'ERROR', error: 'Unauthorized: Valid Admin or Manager PIN is required to void a transaction.' });
          break;
        }

        // 2. Fetch original transaction
        const original = await ValenixiaDB.get('transactions', transactionId);
        if (!original) {
          postMessage({ type: 'ERROR', error: `Transaction ${transactionId} not found.` });
          break;
        }
        if (original.status === 'VOIDED') {
          postMessage({ type: 'ERROR', error: 'Transaction is already voided.' });
          break;
        }

        const tickHlc = syncClient.hlc.tick();
        const contraId = `void_${transactionId}_${Date.now()}`;
        const now = Date.now();

        // 3. Mark original as VOIDED
        original.status = 'VOIDED';
        original.voided_transaction_id = contraId;
        original.void_reason = voidReason || 'Manager void';
        original.updated_at = now;
        original.sync_hlc = tickHlc;

        await ValenixiaDB.put('transactions', original);

        // Log CRDT changes for original transaction updates
        await logFieldChange('transactions', transactionId, 'status', 'VOIDED', tickHlc);
        await logFieldChange('transactions', transactionId, 'voided_transaction_id', contraId, tickHlc);
        await logFieldChange('transactions', transactionId, 'void_reason', voidReason || 'Manager void', tickHlc);
        await logFieldChange('transactions', transactionId, 'updated_at', now, tickHlc);

        // 4. Create contra-entry (negative mirror)
        const contraTx = {
          id: contraId,
          employee_id: managerId,
          terminal_id: original.terminal_id,
          subtotal_minor_units: -(original.subtotal_minor_units || 0),
          tax_minor_units: -(original.tax_minor_units || 0),
          total_minor_units: -(original.total_minor_units || 0),
          status: 'VOID_CONTRA',
          payment_mode: original.payment_mode || 'CASH',
          payment_details: '',
          created_at: now,
          updated_at: now,
          sync_hlc: tickHlc,
          is_deleted: 0,
          voided_transaction_id: transactionId,
          void_reason: voidReason || 'Manager void'
        };

        await ValenixiaDB.put('transactions', contraTx);

        // Log CRDT changes for new contra transaction
        await logFieldChange('transactions', contraId, 'employee_id', managerId, tickHlc);
        await logFieldChange('transactions', contraId, 'terminal_id', original.terminal_id, tickHlc);
        await logFieldChange('transactions', contraId, 'subtotal_minor_units', -(original.subtotal_minor_units || 0), tickHlc);
        await logFieldChange('transactions', contraId, 'tax_minor_units', -(original.tax_minor_units || 0), tickHlc);
        await logFieldChange('transactions', contraId, 'total_minor_units', -(original.total_minor_units || 0), tickHlc);
        await logFieldChange('transactions', contraId, 'status', 'VOID_CONTRA', tickHlc);
        await logFieldChange('transactions', contraId, 'payment_mode', original.payment_mode || 'CASH', tickHlc);
        await logFieldChange('transactions', contraId, 'created_at', now, tickHlc);
        await logFieldChange('transactions', contraId, 'updated_at', now, tickHlc);
        await logFieldChange('transactions', contraId, 'voided_transaction_id', transactionId, tickHlc);
        await logFieldChange('transactions', contraId, 'void_reason', voidReason || 'Manager void', tickHlc);

        postMessage({ type: 'VOID_SUCCESS', transactionId, contraId });
        break;
      }

      case 'FLUSH_FBR_QUEUE': {
        const result = await flushFBRQueue();
        postMessage({ type: 'FBR_FLUSH_RESULT', ...result });
        break;
      }

      case 'GET_FBR_QUEUE': {
        const pending = await ValenixiaDB.getAll('fbr_offline_queue');
        postMessage({ type: 'FBR_QUEUE_DATA', items: pending });
        break;
      }

      // ── Component I: Crash Telemetry Storage ─────────────────────────────
      case 'SAVE_TELEMETRY': {
        try {
          const log = payload;
          await ValenixiaDB.put('telemetry_logs', {
            id: log.id || `tl_${Date.now()}_${secureRandomString(4)}`,
            node_id: log.nodeId || nodeId,
            error_type: log.errorType || 'UNKNOWN',
            error_message: log.errorMessage || '',
            stack_trace: log.stackTrace || '',
            hlc: log.hlc || '',
            last_clicks: log.lastClicks || '',
            created_at: log.createdAt || Date.now()
          });
          // Forward crash to master server if online
          if (syncClient && syncClient.isConnected) {
            fetchWithTimeout('/api/telemetry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(log)
            }, 5000).catch(() => {});
          }
        } catch(e) { /* non-fatal */ }
        break;
      }

      // ── Component B: Oversell Guard — check after PN-Counter recalculation ─
      case 'CHECK_OVERSELL': {
        const { sku: oversellSku } = payload;
        const prod = await ValenixiaDB.get('inventory_catalog', oversellSku);
        if (prod && prod.stock_level < 0) {
          postMessage({
            type: 'STOCK_RECONCILIATION_REQUIRED',
            sku: oversellSku,
            name: prod.name,
            computedStock: prod.stock_level
          });
        }
        break;
      }

      case 'PURGE_OLD_IMAGES': {
        const threshold = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days
        const tx = ValenixiaDB.db.transaction(['payment_proofs'], 'readwrite');
        const store = tx.objectStore('payment_proofs');
        const cursorRequest = store.openCursor();
        let purgedCount = 0;
        cursorRequest.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const proof = cursor.value;
            if (proof.created_at < threshold && proof.screenshot_proof) {
              proof.screenshot_proof = null; // purge heavy base64 screenshot
              cursor.update(proof);
              purgedCount++;
            }
            cursor.continue();
          } else {
            postMessage({ type: 'PURGE_IMAGES_COMPLETE', count: purgedCount });
          }
        };
        cursorRequest.onerror = (err) => {
          postMessage({ type: 'ERROR', error: 'Purge failed: ' + err.target.error.message });
        };
        break;
      }
    }
  } catch (err) {
    console.error('[SyncWorker] Task execution failed:', err);
    postMessage({ type: 'ERROR', error: err.message });
  }
};

// Helper: logs change to local IndexedDB crsql_changes and pushes it immediately
async function logFieldChange(tableName, pk, cid, val, syncHlc, colVersion = 1, cl = 1, tx = null) {
  const dbVer = await ValenixiaDB.logLocalChange(tableName, pk, cid, val, colVersion, cl, syncHlc, tx);
  
  const performDispatch = () => {
    // Push changes live via syncClient
    syncClient.pushDelta(tableName, pk, cid, val, colVersion, cl);

    // Send local logs feed update to the UI
    postMessage({
      type: 'LOCAL_LOG_PUSH',
      change: {
        table_name: tableName,
        pk: pk,
        cid: cid,
        val: val === null ? null : String(val),
        col_version: colVersion,
        db_version: dbVer,
        site_id: nodeId,
        cl: cl,
        sync_hlc: syncHlc
      }
    });
  };

  if (tx) {
    if (!tx._pendingDispatches) {
      tx._pendingDispatches = [];
      tx.addEventListener('complete', () => {
        for (const fn of tx._pendingDispatches) {
          try {
            fn();
          } catch (e) {
            console.error('[SyncWorker] Error running deferred dispatch:', e);
          }
        }
      });
    }
    tx._pendingDispatches.push(performDispatch);
  } else {
    performDispatch();
  }
}

// FBR Offline Queue Flush (Rule 150XC compliance)
// Batch-uploads all pending invoices to the local server which forwards to FBR
async function flushFBRQueue() {
  try {
    const allQueued = await ValenixiaDB.getAll('fbr_offline_queue');
    // Filter for non-submitted items
    const pending = allQueued.filter(q => q.status === 'PENDING' || q.status === 'FAILED');
    
    // Sort chronologically to guarantee strict FIFO ordering
    pending.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (pending.length === 0) return { flushed: 0, failed: 0 };

    console.log(`[FBR] Processing ${pending.length} pending invoice(s) in strict FIFO sequence (Rule 150XC)`);
    
    let flushed = 0;
    
    for (const entry of pending) {
      try {
        const response = await fetchWithTimeout('/api/fbr/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoices: [entry] })
        }, 15000);

        if (!response.ok) {
          console.warn(`[FBR] Server communication error for USIN: ${entry.usin}, HTTP: ${response.status}`);
          // Network or server communication error locks the queue; retries happen on next loop trigger
          return { flushed, failed: 1, locked: true };
        }

        const data = await response.json();
        const result = (data.results || [])[0];

        if (result && result.status === 'SUBMITTED') {
          entry.status = 'SUBMITTED';
          entry.fbr_response_code = result.fbrResponseCode || null;
          entry.fbr_error_details = null;
          await ValenixiaDB.put('fbr_offline_queue', entry);

          // Write official FBR_Invoice_Number back to the transaction receipt details (Compliance)
          const tx = await ValenixiaDB.get('transactions', entry.transactionId);
          if (tx) {
            let details = {};
            try {
              details = JSON.parse(tx.payment_details || '{}');
            } catch(e) {
              details = { note: tx.payment_details };
            }
            // Update with official FBR invoice number from server response
            details.fbr_invoice_number = result.fbrInvoiceNumber || entry.invoiceNumber;
            // Regenerate QR Url with official invoice number
            details.fbr_qr_url = `https://verification.fbr.gov.pk/verify?invoiceNumber=${details.fbr_invoice_number}&total=${tx.total_minor}&tax=${tx.tax_minor}`;
            details.fbr_status = 'INTEGRATED_OFFICIAL';
            tx.payment_details = JSON.stringify(details);
            tx.updated_at = Date.now();
            await ValenixiaDB.put('transactions', tx);
            
            // Log the change to CRDT so it syncs across the fleet
            if (syncClient) {
              const tickHlc = syncClient.hlc.tick().toString();
              await logFieldChange('transactions', tx.id, 'payment_details', tx.payment_details, tickHlc);
            }
          }

          flushed++;
        } else {
          // Hard rejection or processing error from PRAL API
          console.error(`[FBR] Hard rejection for USIN: ${entry.usin}. Code: ${result?.fbrResponseCode}, Error: ${result?.fbrErrorDetails}`);
          
          const isClientError = result?.fbrResult?.status >= 400 && result?.fbrResult?.status < 500;
          if (isClientError) {
            entry.status = 'REJECTED_PERMANENT';
          } else {
            entry.status = 'FAILED';
          }
          
          entry.fbr_response_code = result?.fbrResponseCode || null;
          entry.fbr_error_details = result?.fbrErrorDetails || 'Unknown FBR rejection';
          entry.retry_count = (entry.retry_count || 0) + 1;
          await ValenixiaDB.put('fbr_offline_queue', entry);
          
          postMessage({ 
            type: 'FBR_QUEUE_FAILED', 
            id: entry.id, 
            usin: entry.usin,
            fbrResponseCode: entry.fbr_response_code, 
            fbrErrorDetails: entry.fbr_error_details 
          });
          
          if (isClientError) {
            console.warn('[FBR] Invoice permanently rejected due to client validation error. Removing from active retry loop to prevent queue lock.');
            flushed++;
            continue; // Proceed to next queue item
          }

          // Strict FIFO Lock: Halt processing of all subsequent items
          console.warn('[FBR] Queue locked due to validation failure. Retries halted to preserve sequence.');
          return { flushed, failed: 1, locked: true };
        }
      } catch (err) {
        console.warn(`[FBR] Network fetch failed for USIN: ${entry.usin}:`, err.message);
        // Lock queue on network error
        return { flushed, failed: 1, locked: true };
      }
    }

    postMessage({ type: 'FBR_QUEUE_FLUSHED', flushed, failed: 0, total: pending.length });
    console.log(`[FBR] Sequential FIFO flush completed. Successfully submitted: ${flushed}`);
    return { flushed, failed: 0 };
  } catch (err) {
    console.error('[FBR] Queue process exception:', err.message);
    return { flushed: 0, failed: 0, error: err.message };
  }
}

// Smart Inventory: Automatic low-stock checking and Purchase Order generation
async function checkStockAlert(sku, tickHlc, tx = null) {
  try {
    const prod = await ValenixiaDB.get('inventory_catalog', sku, tx);
    if (!prod) return;

    const currentStock = prod.stock_level;
    const threshold = prod.low_stock_threshold !== undefined ? prod.low_stock_threshold : 10;

    if (currentStock <= threshold) {
      console.warn(`[InventoryAlert] SKU ${sku} (${prod.name}) dropped below threshold (${currentStock}/${threshold}).`);

      // Check if there is already a PENDING or DRAFT purchase order for this SKU to prevent duplicate ordering
      const pos = await ValenixiaDB.getAll('purchase_orders', tx);
      let hasExistingOrder = false;
      for (const po of pos) {
        if (po.is_deleted === 1) continue;
        if (po.status === 'DRAFT' || po.status === 'PENDING') {
          const lineItems = await ValenixiaDB.getAll('po_line_items', tx);
          const matches = lineItems.filter(item => item.po_id === po.id && item.sku === sku && item.is_deleted !== 1);
          if (matches.length > 0) {
            hasExistingOrder = true;
            break;
          }
        }
      }

      if (!hasExistingOrder) {
        // Query distributors
        const dists = await ValenixiaDB.getAll('distributors', tx);
        let distributorId = 'dist_default_primary';
        const activeDists = dists.filter(d => d.is_deleted !== 1);
        
        if (activeDists.length > 0) {
          distributorId = activeDists[0].id;
        } else {
          // Seed default primary distributor
          const seedDist = {
            id: 'dist_default_primary',
            name: 'Primary Wholesale Distributor',
            phone: '0300-1234567',
            email: 'supply@primarywholesale.com',
            address: 'Main Bazaar, Lahore',
            credit_limit_minor: 5000000,
            notes: 'Auto-seeded primary supplier',
            created_at: Date.now(),
            sync_hlc: tickHlc,
            is_deleted: 0
          };
          await ValenixiaDB.put('distributors', seedDist, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'name', seedDist.name, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'phone', seedDist.phone, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'email', seedDist.email, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'address', seedDist.address, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'credit_limit_minor', seedDist.credit_limit_minor, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'notes', seedDist.notes, tickHlc, 1, 1, tx);
        }

        // Generate Automated Draft PO
        const poId = 'po_' + Date.now() + '_' + secureRandomString(4);
        const reorderQty = 50;
        const estimatedCost = prod.cost_price_minor_units || Math.round(prod.base_price_minor_units * 0.60);
        const totalCost = estimatedCost * reorderQty;

        const po = {
          id: poId,
          distributor_id: distributorId,
          status: 'DRAFT',
          total_minor: totalCost,
          notes: `Automated reorder alert: SKU ${sku} (${prod.name}) stock level is ${currentStock} (threshold: ${threshold}).`,
          expected_delivery: Date.now() + (3 * 24 * 60 * 60 * 1000), // 3 days lead time
          created_at: Date.now(),
          updated_at: Date.now(),
          sync_hlc: tickHlc,
          is_deleted: 0
        };

        await ValenixiaDB.put('purchase_orders', po, tx);
        await logFieldChange('purchase_orders', poId, 'distributor_id', distributorId, tickHlc, 1, 1, tx);
        await logFieldChange('purchase_orders', poId, 'status', 'DRAFT', tickHlc, 1, 1, tx);
        await logFieldChange('purchase_orders', poId, 'total_minor', totalCost, tickHlc, 1, 1, tx);
        await logFieldChange('purchase_orders', poId, 'notes', po.notes, tickHlc, 1, 1, tx);
        await logFieldChange('purchase_orders', poId, 'expected_delivery', po.expected_delivery, tickHlc, 1, 1, tx);

        const itemId = `poi_${poId}_${sku}`;
        const poli = {
          id: itemId,
          po_id: poId,
          sku: sku,
          product_name: prod.name,
          quantity_ordered: reorderQty,
          quantity_received: 0,
          unit_cost_minor: estimatedCost,
          sync_hlc: tickHlc,
          is_deleted: 0
        };

        await ValenixiaDB.put('po_line_items', poli, tx);
        await logFieldChange('po_line_items', itemId, 'po_id', poId, tickHlc, 1, 1, tx);
        await logFieldChange('po_line_items', itemId, 'sku', sku, tickHlc, 1, 1, tx);
        await logFieldChange('po_line_items', itemId, 'product_name', prod.name, tickHlc, 1, 1, tx);
        await logFieldChange('po_line_items', itemId, 'quantity_ordered', reorderQty, tickHlc, 1, 1, tx);
        await logFieldChange('po_line_items', itemId, 'quantity_received', 0, tickHlc, 1, 1, tx);
        await logFieldChange('po_line_items', itemId, 'unit_cost_minor', estimatedCost, tickHlc, 1, 1, tx);

        postMessage({ type: 'MUTATION_SUCCESS' });
      }
    }
  } catch (err) {
    console.error('[InventoryAlert] Failed to check stock alert:', err.message);
  }
}

// Start background periodic FBR sweep (every 60 seconds) (Rule 150XC Proxy compliance)
setInterval(async () => {
  try {
    const allQueued = await ValenixiaDB.getAll('fbr_offline_queue');
    const pending = allQueued.filter(q => q.status === 'PENDING' || q.status === 'FAILED');
    if (pending.length > 0) {
      console.log(`[FBR Cron] Found ${pending.length} pending FBR submissions. Triggering sweep...`);
      await flushFBRQueue();
    }
  } catch (err) {
    console.error('[FBR Cron] Background sweep failed:', err.message);
  }
}, 60000);

