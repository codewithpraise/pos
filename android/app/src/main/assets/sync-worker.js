// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - BACKGROUND SYNC WEB WORKER
// Offloads database I/O, CRDT delta merging, and WebSocket sync off main thread
// ============================================================================

importScripts('client-db.js', 'client-sync.js');
let dbReadyPromise = NexovaDB.init(); // Capture the init promise

let syncClient = null;
let nodeId = null;

// Exact decimal string serialization to prevent IEEE 754 float precision issues for PRAL compliance
function serializePRALPayload(fbrInvoiceNumber, now, total, tax, subtotal, cart, paymentMode, usin) {
  // PRAL requires bare numeric doubles (not quoted strings) for monetary fields
  // We build the object with numbers directly — no regex post-processing needed
  const formattedObj = {
    invoiceNumber: fbrInvoiceNumber,
    saleDate: new Date(now).toISOString(),
    totalAmount: Number((total / 100).toFixed(2)),
    taxAmount: Number((tax / 100).toFixed(2)),
    subtotalAmount: Number((subtotal / 100).toFixed(2)),
    items: cart.map(i => ({
      sku: i.sku,
      qty: i.qty,
      unitPrice: Number((i.price / 100).toFixed(2))
    })),
    paymentMode: paymentMode,
    usin: usin
  };
  return JSON.stringify(formattedObj);
}

// Initialize Database and Sync Client
async function initializeSyncEngine(serverUrl) {
  if (serverUrl) {
    self.serverUrl = serverUrl;
  }
  try {
    await NexovaDB.init();

    // Fetch persistent terminal/node ID from local preferences or create one
    let terminalNamePref = await NexovaDB.get('local_preferences', 'terminal_name');
    if (!terminalNamePref || !terminalNamePref.value_payload) {
      nodeId = 'web_client_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'').slice(0,9) : Math.random().toString(36).substring(2, 9));
      await NexovaDB.put('local_preferences', {
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
        'purchase_orders', 'po_line_items', 'distributor_payments', 'customer_credit'
      ];
      
      const idbTx = NexovaDB.db.transaction(stores, 'readwrite');

      try {
        for (const change of changes) {
          syncClient.hlc.merge(change.sync_hlc);

          const local = await NexovaDB.get('crsql_changes', [change.table_name, change.pk, change.cid], idbTx);
          
          let shouldApply = !local;
          if (local) {
            if (change.col_version > local.col_version) shouldApply = true;
            else if (change.col_version < local.col_version) shouldApply = false;
            else shouldApply = change.sync_hlc > local.sync_hlc;
          }

          if (shouldApply) {
            applied++;
            await NexovaDB.applyChangeToSchema(change.table_name, change.pk, change.cid, change.val, change.cl, change.val_type || 'string', idbTx);
            
            const dbVer = (await NexovaDB.getDbVersion(idbTx)) + 1;
            await NexovaDB.put('crsql_changes', {
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
              await NexovaDB.recalculateCachedStock(sku, idbTx);
            } else if (change.table_name === 'inventory_catalog' && change.cid === 'stock_level') {
              await NexovaDB.recalculateCachedStock(change.pk, idbTx);
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
    const syncPassphrasePref = await NexovaDB.get('local_preferences', 'sync_passphrase');
    if (syncPassphrasePref && syncPassphrasePref.value_payload) {
      syncClient.passphrase = syncPassphrasePref.value_payload;
    }

    // Load device token and friendly name for whitelisting
    const deviceTokenPref = await NexovaDB.get('local_preferences', 'device_token');
    if (deviceTokenPref && deviceTokenPref.value_payload) {
      syncClient.deviceToken = deviceTokenPref.value_payload;
    }

    const deviceNamePref = await NexovaDB.get('local_preferences', 'device_name');
    if (deviceNamePref && deviceNamePref.value_payload) {
      syncClient.deviceName = deviceNamePref.value_payload;
    }

    syncClient.connect();

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
    postMessage({ type: 'INIT_ERROR', error: err.message });
  }
}

// Global listener for UI thread events
self.onmessage = async (event) => {
  await dbReadyPromise;
  const { type, payload } = event.data;

  // Handle reload instruction from SyncClient
  if (type === 'FORCE_RELOAD') {
    postMessage({ type: 'FORCE_RELOAD' });
    return;
  }

  // SAVE_TELEMETRY and CHECK_OVERSELL only need the DB (not the sync connection),
  // so they can run before the sync engine is fully initialized.
  const dbOnlyMessages = ['SAVE_TELEMETRY', 'CHECK_OVERSELL'];
  // GET_ messages only read from IndexedDB — they work before the WS sync engine initialises
  const dbReadMessages = [
    'GET_PREFERENCES', 'GET_CATALOG', 'GET_EMPLOYEES', 'GET_CUSTOMERS',
    'GET_TRANSACTIONS', 'GET_ANALYTICS', 'GET_SHIFTS', 'HYDRATE_DB',
    'GET_INVENTORY', 'GET_ALERTS', 'GET_STAFF'
  ];
  if (!syncClient && type !== 'INIT' && !dbOnlyMessages.includes(type) && !dbReadMessages.includes(type)) {
    // For mutation-type messages before init, return a soft warning (not a loud error)
    console.warn(`[SyncWorker] Message "${type}" received before sync engine initialized — queuing skipped.`);
    return;
  }

  try {
    switch (type) {
      case 'INIT':
        await initializeSyncEngine(payload ? payload.serverUrl : null);
        break;

      case 'BOOTSTRAP_STORE': {
        const { storeName, taxRate, adminPin, syncPassphrase, theme } = payload;
        await NexovaDB.bootstrapStore(storeName, taxRate, adminPin, syncPassphrase, theme);
        
        // Mark database as hydrated locally since it was just bootstrapped fresh
        await NexovaDB.put('local_preferences', {
          key: 'database_hydrated',
          value_type: 'BOOL',
          value_payload: 'true',
          is_idempotent_flag: 1,
          updated_at: Date.now()
        });

        // Mark onboarding complete locally since the store is now bootstrapped
        await NexovaDB.put('local_preferences', {
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
          await NexovaDB.put('local_preferences', {
            key: 'nexova_server_url',
            value_type: 'STR',
            value_payload: serverUrl,
            is_idempotent_flag: 0,
            updated_at: Date.now()
          });
        }
        
        await NexovaDB.put('local_preferences', {
          key: 'sync_passphrase',
          value_type: 'STR',
          value_payload: syncPassphrase,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
        
        await NexovaDB.put('local_preferences', {
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
          const base = self.serverUrl || (isFile ? 'https://nexova-license-worker.pages.dev' : location.origin);
          
          // Ensure we don't try to fetch relative to file:// origin
          const bootstrapUrl = base.startsWith('http') ? (base + '/api/sync/bootstrap') : '/api/sync/bootstrap';

          const response = await fetch(bootstrapUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${licenseToken}`,
              'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(15000)
          });
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
            const local = await NexovaDB.get('crsql_changes', [change.table_name, change.pk, change.cid]);
            
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
              await NexovaDB.applyChangeToSchema(change.table_name, change.pk, change.cid, change.val, change.cl, change.val_type || 'string');
              // Save CRDT metadata locally
              await NexovaDB.put('crsql_changes', {
                table_name: change.table_name,
                pk: change.pk,
                cid: change.cid,
                val: change.val,
                val_type: change.val_type || 'string',
                col_version: change.col_version,
                db_version: (await NexovaDB.getDbVersion()) + 1,
                site_id: change.site_id,
                cl: change.cl,
                sync_hlc: change.sync_hlc
              });

              // Recalculate stock level if PN delta changes or manual stock updates occur
              if (change.table_name === 'inventory_catalog_counters') {
                const sku = change.pk.split('/')[0];
                await NexovaDB.recalculateCachedStock(sku);
              } else if (change.table_name === 'inventory_catalog' && change.cid === 'stock_level') {
                await NexovaDB.recalculateCachedStock(change.pk);
              }
            } else {
              conflicts++;
            }
          }

          // Mark database as hydrated in preferences
          await NexovaDB.put('local_preferences', {
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
        await NexovaDB.put('local_preferences', {
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
        const catalog = await NexovaDB.getAll('inventory_catalog');
        postMessage({ type: 'CATALOG_DATA', catalog });
        break;
      }

      case 'GET_CUSTOMERS': {
        const customers = await NexovaDB.getAll('customers');
        postMessage({ type: 'CUSTOMERS_DATA', customers });
        break;
      }

      case 'GET_EMPLOYEES': {
        const employees = await NexovaDB.getAll('employees');
        postMessage({ type: 'EMPLOYEES_DATA', employees });
        break;
      }

      case 'GET_PREFERENCES': {
        const prefs = await NexovaDB.getAll('local_preferences');
        postMessage({ type: 'PREFERENCES_DATA', prefs });
        break;
      }

      case 'GET_TRANSACTIONS': {
        const transactions = await NexovaDB.getAll('transactions');
        // Map line items to transactions
        const enriched = [];
        for (const tx of transactions) {
          const items = await NexovaDB.getAllLineItemsByTx(tx.id);
          enriched.push({ ...tx, items });
        }
        postMessage({ type: 'TRANSACTIONS_DATA', transactions: enriched });
        break;
      }

      case 'COMPLETE_TRANSACTION': {
        const { transactionId } = payload;
        const tickHlc = syncClient.hlc.tick();
        const tx = await NexovaDB.get('transactions', transactionId);
        if (tx) {
          tx.status = 'COMPLETED';
          tx.updated_at = Date.now();
          tx.sync_hlc = tickHlc;
          await NexovaDB.put('transactions', tx);
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
        const { transactionId, employeeId, cart, subtotal, tax, total, paymentMode, paymentDetails, tier, fbr_integration_enabled } = payload;
        const now = Date.now();
        const txHlc = syncClient.hlc.tick();

        // Check if FBR integration is enabled for the license tier
        const isFbrEnabled = (tier === 'ENTERPRISE' || tier === 'TRIAL') && (fbr_integration_enabled === true || fbr_integration_enabled === 'true');
        let finalPaymentDetails = paymentDetails || '';
        let fbrInvoiceNumber = '';
        let fbrQrUrl = '';

        if (isFbrEnabled) {
          // Generate FBR E-Invoicing compliant Fiscal details automatically
          fbrInvoiceNumber = `FBR-POS-${now}-${Math.floor(1000 + Math.random() * 9000)}`;
          fbrQrUrl = `https://verification.fbr.gov.pk/verify?invoiceNumber=${fbrInvoiceNumber}&total=${total}&tax=${tax}`;
          
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
        const idbTx = NexovaDB.db.transaction(
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
          await NexovaDB.put('transactions', txRecord, idbTx);

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
            await NexovaDB.put('line_items', liRecord, idbTx);

            // Log line item fields to CRDT
            await logFieldChange('line_items', liId, 'transaction_id', transactionId, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'sku', item.sku, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'quantity', item.qty, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'unit_price_minor_units', item.price, txHlc, 1, 1, idbTx);
            await logFieldChange('line_items', liId, 'applied_discount_minor_units', item.discount || 0, txHlc, 1, 1, idbTx);

            // 4. Update Stock Level via PN-Counters
            const prod = await NexovaDB.get('inventory_catalog', item.sku, idbTx);
            if (prod) {
              const baseStockRow = await NexovaDB.get('crsql_changes', ['inventory_catalog', item.sku, 'stock_level'], idbTx);
              const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

              const localDeltaRow = await NexovaDB.get('crsql_changes', ['inventory_catalog_counters', `${item.sku}/${nodeId}`, 'delta'], idbTx);
              let currentOffset = 0;
              if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                currentOffset = Number(localDeltaRow.val);
              }

              const newOffset = currentOffset - item.qty;

              await logFieldChange('inventory_catalog_counters', `${item.sku}/${nodeId}`, 'delta', newOffset, txHlc, 1, 1, idbTx);
              await NexovaDB.recalculateCachedStock(item.sku, idbTx);
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
              await NexovaDB.put('stock_movements', movement, idbTx);
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
            await NexovaDB.put('customer_credit', ccRecord, idbTx);
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
            await NexovaDB.put('fbr_offline_queue', fbrQueueEntry, idbTx);

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
        const { sku, name, gtin, price, stock, category, emoji, cost, low_stock_threshold, isAuditReset } = payload;
        const tickHlc = syncClient.hlc.tick();

        const exists = await NexovaDB.get('inventory_catalog', sku);
        const colVersion = exists ? (exists.col_version || 1) + 1 : 1;

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
          col_version: colVersion,
          sync_hlc: tickHlc
        };

        await NexovaDB.put('inventory_catalog', prod);

        await logFieldChange('inventory_catalog', sku, 'name', name, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'gtin', cleanGtin, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'base_price_minor_units', price, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'category', category || 'Uncategorized', tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'emoji', emoji || '📦', tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'cost_price_minor_units', cost || 0, tickHlc, colVersion);
        await logFieldChange('inventory_catalog', sku, 'low_stock_threshold', prod.low_stock_threshold, tickHlc, colVersion);

        if (exists) {
          if (isAuditReset) {
            // Hard Audit Reset: override base stock and clear older deltas HLC-wise
            prod.stock_level = stock;
            await NexovaDB.put('inventory_catalog', prod);
            await logFieldChange('inventory_catalog', sku, 'stock_level', stock, tickHlc, colVersion);
            await NexovaDB.recalculateCachedStock(sku);
            await checkStockAlert(sku, tickHlc);
          } else {
            // Stock Adjustment: relative delta addition preserving offline concurrent changes
            const diff = stock - exists.stock_level;
            if (diff !== 0) {
              const baseStockRow = await NexovaDB.get('crsql_changes', ['inventory_catalog', sku, 'stock_level']);
              const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

              const localDeltaRow = await NexovaDB.get('crsql_changes', ['inventory_catalog_counters', `${sku}/${nodeId}`, 'delta']);
              let currentOffset = 0;
              if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                currentOffset = Number(localDeltaRow.val);
              }

              const newOffset = currentOffset + diff;
              await logFieldChange('inventory_catalog_counters', `${sku}/${nodeId}`, 'delta', newOffset, tickHlc);
              await NexovaDB.recalculateCachedStock(sku);
              await checkStockAlert(sku, tickHlc);
            }
          }
        } else {
          // New product creation: seed as base stock
          prod.stock_level = stock;
          await NexovaDB.put('inventory_catalog', prod);
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
          await NexovaDB.put('stock_movements', movement);
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
        const exists = await NexovaDB.get('inventory_catalog', sku);
        if (exists) {
          const colVersion = (exists.col_version || 1) + 1;
          // Soft delete in catalog
          exists.stock_level = 0;
          exists.col_version = colVersion;
          exists.sync_hlc = tickHlc;
          await NexovaDB.put('inventory_catalog', exists);

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

        await NexovaDB.put('customers', cust);

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
        await NexovaDB.delete('customers', id);
        // Soft delete metadata
        await logFieldChange('customers', id, 'name', null, tickHlc, 1, 0);
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_EMPLOYEE': {
        const { id, auth_hash, biometric_token, role, is_active } = payload;
        const tickHlc = syncClient.hlc.tick();

        const emp = {
          id,
          auth_hash,
          biometric_token: biometric_token || '',
          role: role || 'CASHIER',
          is_active: is_active !== undefined ? is_active : 1,
          sync_hlc: tickHlc
        };

        await NexovaDB.put('employees', emp);

        await logFieldChange('employees', id, 'auth_hash', auth_hash, tickHlc);
        await logFieldChange('employees', id, 'role', role || 'CASHIER', tickHlc);
        await logFieldChange('employees', id, 'is_active', is_active !== undefined ? is_active : 1, tickHlc);

        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'SAVE_PREFERENCE': {
        const { key, val, value_type } = payload;
        
        await NexovaDB.put('local_preferences', {
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
        
        await NexovaDB.put('employee_shifts', shiftRecord);
        
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
        const distributors = await NexovaDB.getAll('distributors');
        postMessage({ type: 'DISTRIBUTORS_DATA', distributors });
        break;
      }

      case 'GET_PURCHASE_ORDERS': {
        const orders = await NexovaDB.getAll('purchase_orders');
        const enriched = [];
        const items = await NexovaDB.getAll('po_line_items');
        for (const po of orders) {
          const poItems = items.filter(item => item.po_id === po.id && item.is_deleted !== 1);
          enriched.push({ ...po, items: poItems });
        }
        postMessage({ type: 'PURCHASE_ORDERS_DATA', purchaseOrders: enriched });
        break;
      }

      case 'GET_DISTRIBUTOR_PAYMENTS': {
        const payments = await NexovaDB.getAll('distributor_payments');
        postMessage({ type: 'DISTRIBUTOR_PAYMENTS_DATA', payments });
        break;
      }

      case 'GET_CUSTOMER_CREDIT': {
        const credits = await NexovaDB.getAll('customer_credit');
        postMessage({ type: 'CUSTOMER_CREDIT_DATA', credits });
        break;
      }

      case 'SAVE_DISTRIBUTOR': {
        const { id, name, phone, email, address, creditLimit, notes } = payload;
        const tickHlc = syncClient.hlc.tick();
        const exists = await NexovaDB.get('distributors', id);
        
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
        await NexovaDB.put('distributors', dist);
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
        await NexovaDB.put('purchase_orders', po);
        await logFieldChange('purchase_orders', id, 'distributor_id', distributorId, tickHlc);
        await logFieldChange('purchase_orders', id, 'status', status || 'DRAFT', tickHlc);
        await logFieldChange('purchase_orders', id, 'total_minor', total, tickHlc);
        await logFieldChange('purchase_orders', id, 'notes', notes || '', tickHlc);
        await logFieldChange('purchase_orders', id, 'expected_delivery', expectedDelivery || null, tickHlc);

        // Save items
        for (const item of items) {
          const itemId = `poi_${id}_${item.sku || Math.random().toString(36).substring(2, 9)}`;
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
          await NexovaDB.put('po_line_items', poli);
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
          const poli = await NexovaDB.get('po_line_items', entry.id);
          if (poli) {
            const finalQtyReceived = (poli.quantity_received || 0) + entry.qtyReceived;
            poli.quantity_received = finalQtyReceived;
            poli.sync_hlc = tickHlc;
            await NexovaDB.put('po_line_items', poli);
            await logFieldChange('po_line_items', entry.id, 'quantity_received', finalQtyReceived, tickHlc);
            
            if (finalQtyReceived < poli.quantity_ordered) {
              allReceived = false;
            }

            if (entry.sku) {
              const prod = await NexovaDB.get('inventory_catalog', entry.sku);
              if (prod) {
                const baseStockRow = await NexovaDB.get('crsql_changes', ['inventory_catalog', entry.sku, 'stock_level']);
                const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

                const localDeltaRow = await NexovaDB.get('crsql_changes', ['inventory_catalog_counters', `${entry.sku}/${nodeId}`, 'delta']);
                let currentOffset = 0;
                if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                  currentOffset = Number(localDeltaRow.val);
                }

                const newOffset = currentOffset + entry.qtyReceived;
                await logFieldChange('inventory_catalog_counters', `${entry.sku}/${nodeId}`, 'delta', newOffset, tickHlc);
                await NexovaDB.recalculateCachedStock(entry.sku);

                if (poli.unit_cost_minor) {
                  const exists = await NexovaDB.get('inventory_catalog', entry.sku);
                  if (exists) {
                    exists.cost_price_minor_units = poli.unit_cost_minor;
                    await NexovaDB.put('inventory_catalog', exists);
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
                await NexovaDB.put('stock_movements', movement);
                await logFieldChange('stock_movements', mvId, 'sku', entry.sku, tickHlc);
                await logFieldChange('stock_movements', mvId, 'change_qty', entry.qtyReceived, tickHlc);
                await logFieldChange('stock_movements', mvId, 'reason', 'RECV_ORDER', tickHlc);
              }
            }
          }
        }

        const po = await NexovaDB.get('purchase_orders', id);
        if (po) {
          const finalStatus = allReceived ? 'RECEIVED' : 'PARTIAL';
          po.status = finalStatus;
          po.updated_at = now;
          po.sync_hlc = tickHlc;
          await NexovaDB.put('purchase_orders', po);
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
        await NexovaDB.put('distributor_payments', dp);
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
        await NexovaDB.put('customer_credit', cc);
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
        await NexovaDB.destructReset();
        // Send reset notice to backend if connected
        if (syncClient.ws && syncClient.ws.readyState === WebSocket.OPEN) {
          syncClient.ws.send(JSON.stringify({ type: 'reset_trigger', nodeId }));
        }
        postMessage({ type: 'RESET_SUCCESS' });
        break;
      }

      case 'FLUSH_FBR_QUEUE': {
        const result = await flushFBRQueue();
        postMessage({ type: 'FBR_FLUSH_RESULT', ...result });
        break;
      }

      case 'GET_FBR_QUEUE': {
        const pending = await NexovaDB.getAll('fbr_offline_queue');
        postMessage({ type: 'FBR_QUEUE_DATA', items: pending });
        break;
      }

      // ── Component I: Crash Telemetry Storage ─────────────────────────────
      case 'SAVE_TELEMETRY': {
        try {
          const log = payload;
          await NexovaDB.put('telemetry_logs', {
            id: log.id || `tl_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
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
            fetch('/api/telemetry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(log)
            }).catch(() => {});
          }
        } catch(e) { /* non-fatal */ }
        break;
      }

      // ── Component B: Oversell Guard — check after PN-Counter recalculation ─
      case 'CHECK_OVERSELL': {
        const { sku: oversellSku } = payload;
        const prod = await NexovaDB.get('inventory_catalog', oversellSku);
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
    }
  } catch (err) {
    console.error('[SyncWorker] Task execution failed:', err);
    postMessage({ type: 'ERROR', error: err.message });
  }
};

// Helper: logs change to local IndexedDB crsql_changes and pushes it immediately
async function logFieldChange(tableName, pk, cid, val, syncHlc, colVersion = 1, cl = 1, tx = null) {
  const dbVer = await NexovaDB.logLocalChange(tableName, pk, cid, val, colVersion, cl, syncHlc, tx);
  
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
    const allQueued = await NexovaDB.getAll('fbr_offline_queue');
    // Filter for non-submitted items
    const pending = allQueued.filter(q => q.status === 'PENDING' || q.status === 'FAILED');
    
    // Sort chronologically to guarantee strict FIFO ordering
    pending.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (pending.length === 0) return { flushed: 0, failed: 0 };

    console.log(`[FBR] Processing ${pending.length} pending invoice(s) in strict FIFO sequence (Rule 150XC)`);
    
    let flushed = 0;
    
    for (const entry of pending) {
      try {
        const response = await fetch('/api/fbr/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoices: [entry] }),
          signal: AbortSignal.timeout(15000)
        });

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
          await NexovaDB.put('fbr_offline_queue', entry);

          // Write official FBR_Invoice_Number back to the transaction receipt details (Compliance)
          const tx = await NexovaDB.get('transactions', entry.transactionId);
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
            await NexovaDB.put('transactions', tx);
            
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
          await NexovaDB.put('fbr_offline_queue', entry);
          
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
    const prod = await NexovaDB.get('inventory_catalog', sku, tx);
    if (!prod) return;

    const currentStock = prod.stock_level;
    const threshold = prod.low_stock_threshold !== undefined ? prod.low_stock_threshold : 10;

    if (currentStock <= threshold) {
      console.warn(`[InventoryAlert] SKU ${sku} (${prod.name}) dropped below threshold (${currentStock}/${threshold}).`);

      // Check if there is already a PENDING or DRAFT purchase order for this SKU to prevent duplicate ordering
      const pos = await NexovaDB.getAll('purchase_orders', tx);
      let hasExistingOrder = false;
      for (const po of pos) {
        if (po.is_deleted === 1) continue;
        if (po.status === 'DRAFT' || po.status === 'PENDING') {
          const lineItems = await NexovaDB.getAll('po_line_items', tx);
          const matches = lineItems.filter(item => item.po_id === po.id && item.sku === sku && item.is_deleted !== 1);
          if (matches.length > 0) {
            hasExistingOrder = true;
            break;
          }
        }
      }

      if (!hasExistingOrder) {
        // Query distributors
        const dists = await NexovaDB.getAll('distributors', tx);
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
          await NexovaDB.put('distributors', seedDist, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'name', seedDist.name, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'phone', seedDist.phone, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'email', seedDist.email, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'address', seedDist.address, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'credit_limit_minor', seedDist.credit_limit_minor, tickHlc, 1, 1, tx);
          await logFieldChange('distributors', 'dist_default_primary', 'notes', seedDist.notes, tickHlc, 1, 1, tx);
        }

        // Generate Automated Draft PO
        const poId = 'po_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
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

        await NexovaDB.put('purchase_orders', po, tx);
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

        await NexovaDB.put('po_line_items', poli, tx);
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
    const allQueued = await NexovaDB.getAll('fbr_offline_queue');
    const pending = allQueued.filter(q => q.status === 'PENDING' || q.status === 'FAILED');
    if (pending.length > 0) {
      console.log(`[FBR Cron] Found ${pending.length} pending FBR submissions. Triggering sweep...`);
      await flushFBRQueue();
    }
  } catch (err) {
    console.error('[FBR Cron] Background sweep failed:', err.message);
  }
}, 60000);

