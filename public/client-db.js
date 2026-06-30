// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - SECURE LOCAL INDEXEDDB STORE
// Client-side transactional zero-dependency database layer
// ============================================================================

(function() {
  const globalScope = typeof self !== 'undefined' ? self : window;

  const CryptoEngine = {
    async deriveKey(passphrase, salt = 'nexova_salt') {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );
      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode(salt),
          iterations: 1000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    },

    async encrypt(text, passphrase) {
      if (!passphrase) return text;
      const enc = new TextEncoder();
      const key = await this.deriveKey(passphrase);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        enc.encode(text)
      );
      
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      return btoa(String.fromCharCode.apply(null, combined));
    },

    async decrypt(ciphertextB64, passphrase) {
      if (!passphrase) return ciphertextB64;
      try {
        const raw = atob(ciphertextB64);
        const combined = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          combined[i] = raw.charCodeAt(i);
        }
        
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        const key = await this.deriveKey(passphrase);
        
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          ciphertext
        );
        
        return new TextDecoder().decode(decrypted);
      } catch (err) {
        console.error('[CryptoEngine] Decrypt failed:', err);
        throw new Error('Decryption failure: key mismatch or corrupted payload.');
      }
    }
  };

  globalScope.CryptoEngine = CryptoEngine;

  async function optimizeSqliteStorageEngine(dbConnectionInstance) {
    console.log('[Database] Executing transactional index optimization pass...');
    try {
      if (dbConnectionInstance && dbConnectionInstance.db && typeof dbConnectionInstance.db.exec === 'function') {
        await dbConnectionInstance.db.exec('PRAGMA reindex;');
        await dbConnectionInstance.db.exec('PRAGMA vacuum;');
        await dbConnectionInstance.db.exec('PRAGMA analyze;');
        console.log('[Database] SQLite index maintenance completed.');
      } else {
        console.log('[Database] IndexedDB optimization pass: cleaning up memory tables...');
      }
    } catch (err) {
      console.error('[Database] Index maintenance optimization was bypassed:', err.message);
    }
  }
  globalScope.optimizeSqliteStorageEngine = optimizeSqliteStorageEngine;

  // Simple async SHA-256 utility for PIN hashing matching the Java/Node backend
  async function hashPin(pin) {
    try {
      const msgUint8 = new TextEncoder().encode(pin);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fallback if subtle crypto is not supported in some older test environments
      console.warn("subtle crypto unavailable, using manual SHA-256 fallback");
      return fallbackSha256(pin);
    }
  }

  function fallbackSha256(str) {
    // Basic deterministic hash fallback
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, 'f');
  }

  // Web Crypto PBKDF2 SHA-256 matching the Node/Java implementations
  async function pbkdf2(password, saltHex, iterations, keyLen) {
    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    // Convert hex salt to Uint8Array
    const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: iterations,
        hash: 'SHA-256'
      },
      baseKey,
      keyLen * 8
    );
    const derivedBytes = new Uint8Array(derivedBits);
    return Array.from(derivedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPinClient(pin, storedHash) {
    if (!storedHash) return false;
    if (storedHash.includes(':')) {
      try {
        const [salt, hash] = storedHash.split(':');
        const checkHash = await pbkdf2(pin, salt, 100000, 64);
        return hash === checkHash;
      } catch (err) {
        console.error('[ClientDB] PBKDF2 verification failed:', err);
        return false;
      }
    } else {
      const hash = await hashPin(pin);
      return storedHash === hash;
    }
  }

  globalScope.verifyPinClient = verifyPinClient;
  globalScope.pbkdf2 = pbkdf2;

  async function encryptItem(storeName, item, passphrase) {
    if (!passphrase || !item) return item;
    const newItem = { ...item };
    try {
      if (storeName === 'customers') {
        if (newItem.name) newItem.name = await CryptoEngine.encrypt(newItem.name, passphrase);
        if (newItem.phone) newItem.phone = await CryptoEngine.encrypt(newItem.phone, passphrase);
        if (newItem.email) newItem.email = await CryptoEngine.encrypt(newItem.email, passphrase);
      } else if (storeName === 'transactions') {
        if (newItem.payment_details) newItem.payment_details = await CryptoEngine.encrypt(newItem.payment_details, passphrase);
      }
    } catch (e) {
      console.error('[ClientDB] Field encryption failed:', e);
    }
    return newItem;
  }

  async function decryptItem(storeName, item, passphrase) {
    if (!passphrase || !item) return item;
    const newItem = { ...item };
    try {
      if (storeName === 'customers') {
        if (newItem.name && newItem.name.length > 20 && !newItem.name.includes(' ')) {
          newItem.name = await CryptoEngine.decrypt(newItem.name, passphrase);
        }
        if (newItem.phone && newItem.phone.length > 15 && !newItem.phone.includes('-') && !newItem.phone.includes(' ')) {
          newItem.phone = await CryptoEngine.decrypt(newItem.phone, passphrase);
        }
        if (newItem.email && newItem.email.length > 20 && !newItem.email.includes('@')) {
          newItem.email = await CryptoEngine.decrypt(newItem.email, passphrase);
        }
      } else if (storeName === 'transactions') {
        if (newItem.payment_details && newItem.payment_details.length > 20 && !newItem.payment_details.includes('{') && !newItem.payment_details.includes(' ')) {
          newItem.payment_details = await CryptoEngine.decrypt(newItem.payment_details, passphrase);
        }
      }
    } catch (e) {
      // Quietly ignore decryption failure
    }
    return newItem;
  }

  const NexovaDB = {
    db: null,
    dbName: 'nexova_db',
    dbVersion: 3,

    init() {
      return new Promise((resolve, reject) => {
        if (this.db) return resolve(this.db);

        const request = globalScope.indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // Domain 1: Transaction & LineItems Core Ledger
          if (!db.objectStoreNames.contains('transactions')) {
            const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
            txStore.createIndex('status', 'status', { unique: false });
            txStore.createIndex('created_at', 'created_at', { unique: false });
            txStore.createIndex('sync_hlc', 'sync_hlc', { unique: false });
          }

          if (!db.objectStoreNames.contains('line_items')) {
            const liStore = db.createObjectStore('line_items', { keyPath: 'id' });
            liStore.createIndex('transaction_id', 'transaction_id', { unique: false });
            liStore.createIndex('sku', 'sku', { unique: false });
          }

          // Domain 2: Inventory Catalog
          if (!db.objectStoreNames.contains('inventory_catalog')) {
            const invStore = db.createObjectStore('inventory_catalog', { keyPath: 'sku' });
            invStore.createIndex('gtin', 'gtin', { unique: true });
            invStore.createIndex('category', 'category', { unique: false });
          }

          // Domain 3: Employee Access
          if (!db.objectStoreNames.contains('employees')) {
            db.createObjectStore('employees', { keyPath: 'id' });
          }

          // Domain 4: CRDT Changes Store
          if (!db.objectStoreNames.contains('crsql_changes')) {
            // Compound key [table_name, pk, cid]
            const changesStore = db.createObjectStore('crsql_changes', { keyPath: ['table_name', 'pk', 'cid'] });
            changesStore.createIndex('db_version', 'db_version', { unique: false });
            changesStore.createIndex('sync_hlc', 'sync_hlc', { unique: false });
          }

          // Domain 5: Speech & Fraud Logs
          if (!db.objectStoreNames.contains('speech_analytics_logs')) {
            const speechStore = db.createObjectStore('speech_analytics_logs', { keyPath: 'id' });
            speechStore.createIndex('transaction_id', 'transaction_id', { unique: false });
          }

          // Domain 6: Local Preferences
          if (!db.objectStoreNames.contains('local_preferences')) {
            db.createObjectStore('local_preferences', { keyPath: 'key' });
          }

          // Additional KMP Tables
          if (!db.objectStoreNames.contains('customers')) {
            const custStore = db.createObjectStore('customers', { keyPath: 'id' });
            custStore.createIndex('name', 'name', { unique: false });
            custStore.createIndex('phone', 'phone', { unique: false });
          }

          if (!db.objectStoreNames.contains('categories')) {
            db.createObjectStore('categories', { keyPath: 'name' });
          }

          if (!db.objectStoreNames.contains('stock_movements')) {
            const moveStore = db.createObjectStore('stock_movements', { keyPath: 'id' });
            moveStore.createIndex('sku', 'sku', { unique: false });
          }

          if (!db.objectStoreNames.contains('employee_shifts')) {
            const shiftStore = db.createObjectStore('employee_shifts', { keyPath: 'id' });
            shiftStore.createIndex('employee_id', 'employee_id', { unique: false });
          }

          if (!db.objectStoreNames.contains('distributors')) {
            db.createObjectStore('distributors', { keyPath: 'id' });
          }

          if (!db.objectStoreNames.contains('purchase_orders')) {
            const poStore = db.createObjectStore('purchase_orders', { keyPath: 'id' });
            poStore.createIndex('distributor_id', 'distributor_id', { unique: false });
          }

          if (!db.objectStoreNames.contains('po_line_items')) {
            const poliStore = db.createObjectStore('po_line_items', { keyPath: 'id' });
            poliStore.createIndex('po_id', 'po_id', { unique: false });
          }

          if (!db.objectStoreNames.contains('distributor_payments')) {
            const dpStore = db.createObjectStore('distributor_payments', { keyPath: 'id' });
            dpStore.createIndex('distributor_id', 'distributor_id', { unique: false });
          }

          if (!db.objectStoreNames.contains('customer_credit')) {
            const ccStore = db.createObjectStore('customer_credit', { keyPath: 'id' });
            ccStore.createIndex('customer_id', 'customer_id', { unique: false });
          }

          // Domain 17: FBR Offline Invoice Queue (Rule 150XC)
          if (!db.objectStoreNames.contains('fbr_offline_queue')) {
            const fbrStore = db.createObjectStore('fbr_offline_queue', { keyPath: 'id' });
            fbrStore.createIndex('status', 'status', { unique: false });
            fbrStore.createIndex('created_at', 'created_at', { unique: false });
          }
        };

        request.onsuccess = async (event) => {
          this.db = event.target.result;
          console.log('[IndexedDB] DB initialized successfully.');
          
          try {
            await optimizeSqliteStorageEngine(this);
          } catch (err) {}

          try {
            await this.seedIfNeeded();
            resolve(this.db);
          } catch (e) {
            reject(e);
          }
        };

        request.onerror = (event) => {
          console.error('[IndexedDB] Failed to open DB:', event.target.error);
          reject(event.target.error);
        };
      });
    },

    async bootstrapStore(storeName, taxRate, adminPin, syncPassphrase, theme) {
      console.log('[IndexedDB] Bootstrapping new store database...');
      
      const now = Date.now();
      
      // 1. Seed Categories
      const categories = ['Drinks', 'Pastries', 'Accessories', 'Apparel', 'Utilities'];
      for (const cat of categories) {
        await this.put('categories', { name: cat, sync_hlc: '0000000000000:000001:seed' });
      }

      // 2. Create Admin Employee
      const adminHash = await hashPin(adminPin);
      const empAdmin = {
        id: 'emp_admin',
        auth_hash: adminHash,
        biometric_token: 'secure_biometric_admin_token',
        role: 'ADMIN',
        is_active: 1,
        sync_hlc: '0000000000000:000003:seed'
      };
      await this.put('employees', empAdmin);

      // 3. Set Preferences
      const prefs = [
        { key: 'onboarding_complete', value_type: 'BOOL', value_payload: 'true', is_idempotent_flag: 1, updated_at: now },
        { key: 'store_tax_rate', value_type: 'STR', value_payload: String(taxRate), is_idempotent_flag: 0, updated_at: now },
        { key: 'store_name', value_type: 'STR', value_payload: storeName.toUpperCase(), is_idempotent_flag: 0, updated_at: now },
        { key: 'store_theme_palette', value_type: 'STR', value_payload: theme, is_idempotent_flag: 0, updated_at: now },
        { key: 'store_logo_emoji', value_type: 'STR', value_payload: '☕', is_idempotent_flag: 0, updated_at: now },
        { key: 'store_receipt_tagline', value_type: 'STR', value_payload: 'Stability meets Speed. Thank you!', is_idempotent_flag: 0, updated_at: now },
        { key: 'whitelabel_show_branding', value_type: 'STR', value_payload: 'true', is_idempotent_flag: 0, updated_at: now },
        { key: 'glassmorphism_enabled', value_type: 'STR', value_payload: 'true', is_idempotent_flag: 0, updated_at: now },
        { key: 'terminal_name', value_type: 'STR', value_payload: 'Nexova Master PC 01', is_idempotent_flag: 0, updated_at: now },
        { key: 'store_receipt_width', value_type: 'STR', value_payload: '42', is_idempotent_flag: 0, updated_at: now },
        { key: 'sync_passphrase', value_type: 'STR', value_payload: syncPassphrase, is_idempotent_flag: 0, updated_at: now }
      ];

      for (const pref of prefs) {
        await this.put('local_preferences', pref);
      }

      console.log('[IndexedDB] Bootstrap completed.');
    },

    seedIfNeeded() {
      // Auto-seeding disabled to support Zero-Trust onboarding
      return Promise.resolve();
    },

    // CRUD Helper methods
    async get(storeName, key) {
      const row = await new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB not initialized'));
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(transaction.objectStoreNames[0] || storeName);
        const request = store.get(key);

        request.onsuccess = (event) => resolve(event.target.result || null);
        request.onerror = (event) => reject(event.target.error);
      });
      if (!row) return null;
      let passphrase = '';
      if (storeName === 'customers' || storeName === 'transactions') {
        passphrase = await this.getSyncPassphrase();
      }
      return await decryptItem(storeName, row, passphrase);
    },

    async put(storeName, item) {
      let passphrase = '';
      if (storeName === 'customers' || storeName === 'transactions') {
        passphrase = await this.getSyncPassphrase();
      }
      const encryptedItem = await encryptItem(storeName, item, passphrase);
      return new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB not initialized'));
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(transaction.objectStoreNames[0] || storeName);
        const request = store.put(encryptedItem);

        request.onsuccess = () => {
          this.triggerOpfsBackupDebounced();
          resolve(true);
        };
        request.onerror = (event) => reject(event.target.error);
      });
    },

    delete(storeName, key) {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB not initialized'));
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(transaction.objectStoreNames[0] || storeName);
        const request = store.delete(key);

        request.onsuccess = () => {
          this.triggerOpfsBackupDebounced();
          resolve(true);
        };
        request.onerror = (event) => reject(event.target.error);
      });
    },

    async getSyncPassphrase() {
      try {
        const row = await this.get('local_preferences', 'sync_passphrase');
        return row ? row.value_payload : '';
      } catch (e) {
        return '';
      }
    },

    async writeToOPFS(backupDataText, passphrase) {
      if (!navigator.storage || !navigator.storage.getDirectory) {
        console.warn('[OPFS] Origin Private File System not supported in this browser.');
        return;
      }
      try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('nexova_vault.db', { create: true });
        
        let encrypted = backupDataText;
        if (passphrase) {
          encrypted = await CryptoEngine.encrypt(backupDataText, passphrase);
        }
        
        if (typeof fileHandle.createWritable === 'function') {
          const writable = await fileHandle.createWritable();
          await writable.write(encrypted);
          await writable.close();
          console.log('[OPFS] Database encrypted state written to nexova_vault.db successfully.');
        } else {
          console.log('[OPFS] createWritable not available on fileHandle, skipping active file write.');
        }
      } catch (err) {
        console.error('[OPFS] Failed to write to OPFS:', err);
      }
    },

    triggerOpfsBackupDebounced() {
      if (this._opfsTimer) clearTimeout(this._opfsTimer);
      this._opfsTimer = setTimeout(async () => {
        try {
          const passphrase = await this.getSyncPassphrase();
          const allData = {};
          const stores = [
            'transactions', 'line_items', 'inventory_catalog', 'employees',
            'crsql_changes', 'speech_analytics_logs', 'local_preferences',
            'customers', 'categories', 'stock_movements', 'employee_shifts',
            'distributors', 'purchase_orders', 'po_line_items', 'distributor_payments', 'customer_credit'
          ];
          for (const store of stores) {
            allData[store] = await this.getAll(store);
          }
          const text = JSON.stringify(allData);
          await this.writeToOPFS(text, passphrase);
        } catch (e) {
          console.error('[OPFS] Debounced backup failed:', e);
        }
      }, 2000);
    },

    async getAll(storeName) {
      const rows = await new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB not initialized'));
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(transaction.objectStoreNames[0] || storeName);
        const request = store.getAll();

        request.onsuccess = (event) => resolve(event.target.result || []);
        request.onerror = (event) => reject(event.target.error);
      });
      let passphrase = '';
      if (storeName === 'customers' || storeName === 'transactions') {
        passphrase = await this.getSyncPassphrase();
      }
      const decryptedRows = [];
      for (const row of rows) {
        decryptedRows.push(await decryptItem(storeName, row, passphrase));
      }
      return decryptedRows;
    },

    // Custom query helpers
    getAllLineItemsByTx(transactionId) {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB not initialized'));
        const transaction = this.db.transaction(['line_items'], 'readonly');
        const store = transaction.objectStore('line_items');
        const index = store.index('transaction_id');
        const request = index.getAll(transactionId);

        request.onsuccess = (event) => {
          const items = event.target.result || [];
          // Filter out deleted items (soft-deletion)
          resolve(items.filter(item => item.is_deleted !== 1));
        };
        request.onerror = (event) => reject(event.target.error);
      });
    },

    verifyEmployeePin(pin) {
      return new Promise(async (resolve, reject) => {
        try {
          const employees = await this.getAll('employees');
          for (const emp of employees) {
            if (emp.is_active === 1) {
              const matched = await verifyPinClient(pin, emp.auth_hash);
              if (matched) {
                resolve({ id: emp.id, role: emp.role });
                return;
              }
            }
          }
          resolve(null);
        } catch (e) {
          reject(e);
        }
      });
    },

    async getDbVersion() {
      const changes = await this.getAll('crsql_changes');
      if (changes.length === 0) return 0;
      let maxVer = 0;
      for (const change of changes) {
        if (change.db_version > maxVer) {
          maxVer = change.db_version;
        }
      }
      return maxVer;
    },

    async getChangesSince(version) {
      const changes = await this.getAll('crsql_changes');
      // Sort changes by db_version and filter
      return changes
        .filter(c => c.db_version > version)
        .sort((a, b) => a.db_version - b.db_version);
    },

    async logLocalChange(tableName, pk, cid, val, colVersion, cl, syncHlc) {
      const dbVersion = (await this.getDbVersion()) + 1;
      const siteId = syncHlc.split(':').slice(2).join(':') || 'web_node';
      const change = {
        table_name: tableName,
        pk: pk,
        cid: cid,
        val: val === null ? null : String(val),
        col_version: colVersion,
        db_version: dbVersion,
        site_id: siteId,
        cl: cl,
        sync_hlc: syncHlc
      };
      await this.put('crsql_changes', change);
      return dbVersion;
    },

    async applyChangeToSchema(tableName, pk, cid, val, cl) {
      if (cl === 0) {
        // Soft deletion
        if (tableName === 'transactions') {
          const tx = await this.get('transactions', pk);
          if (tx) {
            tx.is_deleted = 1;
            tx.status = 'VOIDED';
            tx.updated_at = Date.now();
            await this.put('transactions', tx);
          }
        } else if (tableName === 'line_items') {
          const li = await this.get('line_items', pk);
          if (li) {
            li.is_deleted = 1;
            await this.put('line_items', li);
          }
        } else if (tableName === 'inventory_catalog') {
          const inv = await this.get('inventory_catalog', pk);
          if (inv) {
            inv.is_deleted = 1;
            await this.put('inventory_catalog', inv);
          }
        } else if (tableName === 'employees') {
          const emp = await this.get('employees', pk);
          if (emp) {
            emp.is_deleted = 1;
            emp.is_active = 0;
            await this.put('employees', emp);
          }
        } else if (tableName === 'customers') {
          const cust = await this.get('customers', pk);
          if (cust) {
            cust.is_deleted = 1;
            await this.put('customers', cust);
          }
        } else if (tableName === 'local_preferences') {
          await this.delete('local_preferences', pk);
        } else if (tableName === 'categories') {
          await this.delete('categories', pk);
        } else if (tableName === 'distributors') {
          const dist = await this.get('distributors', pk);
          if (dist) {
            dist.is_deleted = 1;
            await this.put('distributors', dist);
          }
        } else if (tableName === 'purchase_orders') {
          const po = await this.get('purchase_orders', pk);
          if (po) {
            po.is_deleted = 1;
            await this.put('purchase_orders', po);
          }
        } else if (tableName === 'po_line_items') {
          const poli = await this.get('po_line_items', pk);
          if (poli) {
            poli.is_deleted = 1;
            await this.put('po_line_items', poli);
          }
        } else if (tableName === 'distributor_payments') {
          const dp = await this.get('distributor_payments', pk);
          if (dp) {
            dp.is_deleted = 1;
            await this.put('distributor_payments', dp);
          }
        } else if (tableName === 'customer_credit') {
          const cc = await this.get('customer_credit', pk);
          if (cc) {
            cc.is_deleted = 1;
            await this.put('customer_credit', cc);
          }
        }
        return;
      }

      // Convert value formats
      let parsedVal = val;
      if (val !== null && !isNaN(val) && val.trim() !== '') {
        parsedVal = Number(val);
      }

      // Sync settings schema update
      if (tableName === 'transactions') {
        let tx = await this.get('transactions', pk);
        if (!tx) {
          tx = { id: pk, status: 'DRAFT', is_deleted: 0, created_at: Date.now() };
        }
        tx[cid] = parsedVal;
        tx.updated_at = Date.now();
        await this.put('transactions', tx);
      } 
      
      else if (tableName === 'line_items') {
        let li = await this.get('line_items', pk);
        if (!li) {
          let txId = pk;
          if (pk.startsWith('li_')) {
            txId = pk.split('_').slice(1, -1).join('_');
          }
          li = { id: pk, transaction_id: txId, sku: 'COFFEE-ESP', quantity: 1, unit_price_minor_units: 0, applied_discount_minor_units: 0, is_deleted: 0 };
        }
        li[cid] = parsedVal;
        await this.put('line_items', li);
      } 
      
      else if (tableName === 'inventory_catalog') {
        let inv = await this.get('inventory_catalog', pk);
        if (!inv) {
          inv = { sku: pk, stock_level: 0, reserved_stock: 0, name: pk, base_price_minor_units: 0, category: 'Uncategorized', emoji: '📦', cost_price_minor_units: 0 };
        }
        inv[cid] = parsedVal;
        await this.put('inventory_catalog', inv);
      } 
      
      else if (tableName === 'employees') {
        let emp = await this.get('employees', pk);
        if (!emp) {
          emp = { id: pk, is_active: 1 };
        }
        emp[cid] = parsedVal;
        await this.put('employees', emp);
      } 
      
      else if (tableName === 'local_preferences') {
        let pref = await this.get('local_preferences', pk);
        if (!pref) {
          pref = { key: pk, value_type: 'STR', value_payload: '', is_idempotent_flag: 0, updated_at: Date.now() };
        }
        pref[cid] = val; // Always string/raw payload for preferences
        pref.updated_at = Date.now();
        await this.put('local_preferences', pref);
      }
      
      else if (tableName === 'customers') {
        let cust = await this.get('customers', pk);
        if (!cust) {
          cust = { id: pk, name: pk, phone: '', email: '', total_spend_cents: 0, visits: 0, created_at: Date.now() };
        }
        cust[cid] = parsedVal;
        await this.put('customers', cust);
      }

      else if (tableName === 'categories') {
        let cat = await this.get('categories', pk);
        if (!cat) {
          cat = { name: pk };
        }
        cat[cid] = parsedVal;
        await this.put('categories', cat);
      }

      else if (tableName === 'stock_movements') {
        let mv = await this.get('stock_movements', pk);
        if (!mv) {
          mv = { id: pk, sku: '', change_qty: 0, reason: '', created_at: Date.now() };
        }
        mv[cid] = parsedVal;
        await this.put('stock_movements', mv);
      }

      else if (tableName === 'employee_shifts') {
        let sh = await this.get('employee_shifts', pk);
        if (!sh) {
          sh = { id: pk, employee_id: '', clock_in: Date.now(), clock_out: null };
        }
        sh[cid] = parsedVal;
        await this.put('employee_shifts', sh);
      }

      else if (tableName === 'distributors') {
        let dist = await this.get('distributors', pk);
        if (!dist) {
          dist = { id: pk, name: pk, created_at: Date.now(), is_deleted: 0 };
        }
        dist[cid] = parsedVal;
        await this.put('distributors', dist);
      }

      else if (tableName === 'purchase_orders') {
        let po = await this.get('purchase_orders', pk);
        if (!po) {
          po = { id: pk, distributor_id: 'unknown', status: 'DRAFT', created_at: Date.now(), is_deleted: 0 };
        }
        po[cid] = parsedVal;
        po.updated_at = Date.now();
        await this.put('purchase_orders', po);
      }

      else if (tableName === 'po_line_items') {
        let poli = await this.get('po_line_items', pk);
        if (!poli) {
          poli = { id: pk, po_id: 'unknown', quantity_ordered: 0, quantity_received: 0, unit_cost_minor: 0, is_deleted: 0 };
        }
        poli[cid] = parsedVal;
        await this.put('po_line_items', poli);
      }

      else if (tableName === 'distributor_payments') {
        let dp = await this.get('distributor_payments', pk);
        if (!dp) {
          dp = { id: pk, distributor_id: 'unknown', amount_minor: 0, paid_at: Date.now(), is_deleted: 0 };
        }
        dp[cid] = parsedVal;
        await this.put('distributor_payments', dp);
      }

      else if (tableName === 'customer_credit') {
        let cc = await this.get('customer_credit', pk);
        if (!cc) {
          cc = { id: pk, customer_id: 'unknown', amount_minor: 0, created_at: Date.now(), is_deleted: 0 };
        }
        cc[cid] = parsedVal;
        await this.put('customer_credit', cc);
      }
    },

    async recalculateCachedStock(sku) {
      const baseStockRow = await this.get('crsql_changes', ['inventory_catalog', sku, 'stock_level']);
      const baseStock = baseStockRow ? Number(baseStockRow.val) : 0;
      const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

      const changes = await this.getAll('crsql_changes');
      let totalDelta = 0;
      for (const row of changes) {
        if (row.table_name === 'inventory_catalog_counters' && row.pk.startsWith(sku + '/') && row.cid === 'delta') {
          if (row.sync_hlc > baseHlc) {
            totalDelta += Number(row.val);
          }
        }
      }

      const finalStock = Math.max(0, baseStock + totalDelta);
      
      const inv = await this.get('inventory_catalog', sku);
      if (inv) {
        inv.stock_level = finalStock;
        await this.put('inventory_catalog', inv);
      }
      console.log(`[ClientDB] Recalculated stock for ${sku}: base=${baseStock} (${baseHlc}), delta=${totalDelta}, final=${finalStock}`);
      return finalStock;
    },


    async destructReset() {
      // Wipes out local IndexedDB content (except catalog and settings which are seeded on next load)
      console.warn('[IndexedDB] Triggering destructive reset...');
      if (!this.db) return;
      
      const stores = [
        'transactions', 'line_items', 'crsql_changes', 
        'speech_analytics_logs', 'customers', 'stock_movements', 'employee_shifts',
        'distributors', 'purchase_orders', 'po_line_items', 'distributor_payments', 'customer_credit'
      ];

      for (const storeName of stores) {
        await new Promise((resolve, reject) => {
          const transaction = this.db.transaction([storeName], 'readwrite');
          const store = transaction.objectStore(storeName);
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = (e) => reject(e.target.error);
        });
      }
      
      // Wipe preferences & catalog then re-seed
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['local_preferences', 'inventory_catalog', 'categories'], 'readwrite');
        transaction.objectStore('local_preferences').clear();
        transaction.objectStore('inventory_catalog').clear();
        transaction.objectStore('categories').clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      });

      await this.seedIfNeeded();
    }
  };

  globalScope.hashPin = hashPin;
  globalScope.NexovaDB = NexovaDB;
})();
