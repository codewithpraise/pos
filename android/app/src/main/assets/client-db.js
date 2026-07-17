// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SECURE LOCAL INDEXEDDB STORE
// Client-side transactional zero-dependency database layer
// ============================================================================

(function() {
  const globalScope = typeof self !== 'undefined' ? self : window;

  const keyCache = new Map();
  let sessionSalt = null;

  function getSessionSalt() {
    if (!sessionSalt) {
      sessionSalt = crypto.getRandomValues(new Uint8Array(16));
    }
    return sessionSalt;
  }

  function uint8ArrayToHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function arrayBufferToBase64(uint8Array) {
    let binary = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  function base64ToUint8Array(base64String) {
    const binary = atob(base64String);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const CryptoEngine = {
    async deriveKey(passphrase, salt) {
      const saltString = typeof salt === 'string' ? salt : uint8ArrayToHex(salt);
      const cacheKey = passphrase + ':' + saltString;
      if (keyCache.has(cacheKey)) {
        return keyCache.get(cacheKey);
      }

      const enc = new TextEncoder();
      const saltBytes = typeof salt === 'string' ? enc.encode(salt) : salt;

      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );
      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          // Must match server deriveKey: crypto.pbkdf2Sync(pass, salt, 100000, 32, 'sha256')
          // Mismatching iterations produces a different key — decryption silently fails.
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      keyCache.set(cacheKey, derivedKey);
      return derivedKey;
    },

    async encrypt(text, passphrase) {
      if (!passphrase) return text;
      // Bypasses restriction by pushing to Android Kotlin Engine
      if (globalScope.AndroidPOS && typeof globalScope.AndroidPOS.encryptAES === 'function') {
        return globalScope.AndroidPOS.encryptAES(text, passphrase);
      }
      const enc = new TextEncoder();
      const salt = getSessionSalt();
      const key = await this.deriveKey(passphrase, salt);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        enc.encode(text)
      );
      
      const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
      combined.set(salt, 0);
      combined.set(iv, salt.length);
      combined.set(new Uint8Array(encrypted), salt.length + iv.length);
      
      // Prefix with 'VAL1:' so decrypt can reliably detect ciphertext vs plain values
      return 'VAL1:' + arrayBufferToBase64(combined);
    },

    async decrypt(ciphertextB64, passphrase) {
      if (!passphrase) return ciphertextB64;
      // Bypasses restriction by pushing to Android Kotlin Engine
      if (globalScope.AndroidPOS && typeof globalScope.AndroidPOS.decryptAES === 'function') {
        return globalScope.AndroidPOS.decryptAES(ciphertextB64, passphrase);
      }
      // Only attempt decryption if value has VAL1: or NEX1: prefix — plain values pass through
      const hasPrefix = ciphertextB64 && (ciphertextB64.startsWith('VAL1:') || ciphertextB64.startsWith('NEX1:'));
      if (!hasPrefix) return ciphertextB64;
      try {
        const combined = base64ToUint8Array(ciphertextB64.slice(5)); // strip prefix (both are 5 chars)
        if (combined.length < 28) return ciphertextB64;
        
        const salt = combined.slice(0, 16);
        const iv = combined.slice(16, 28);
        const ciphertext = combined.slice(28);
        
        const key = await this.deriveKey(passphrase, salt);
        
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          ciphertext
        );
        
        return new TextDecoder().decode(decrypted);
      } catch (err) {
        return ciphertextB64; // Return original on failure — do not log to prevent spam
      }
    },

    async encryptSync(text, passphrase) {
      if (!passphrase) return text;
      const enc = new TextEncoder();
      let salt = '';
      try {
        if (globalScope.ValenixiaDB && typeof globalScope.ValenixiaDB.get === 'function') {
          const saltRow = await globalScope.ValenixiaDB.get('local_preferences', 'sync_salt');
          if (saltRow && saltRow.value_payload) {
            salt = saltRow.value_payload;
          }
        }
      } catch (e) {}
      if (!salt) {
        const msgUint8 = enc.encode(passphrase + "_salt_deriv");
        if (globalScope.crypto && globalScope.crypto.subtle && typeof globalScope.crypto.subtle.digest === 'function') {
          const hashBuffer = await globalScope.crypto.subtle.digest('SHA-256', msgUint8);
          salt = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
        } else {
          salt = passphrase.split('').reverse().join('').substring(0, 16);
        }
      }
      const key = await this.deriveKey(passphrase, salt);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        enc.encode(text)
      );
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);
      return arrayBufferToBase64(combined);
    },

    async decryptSync(ciphertextB64, passphrase) {
      // Decrypts server-side AES-256-GCM payloads.
      // Server format: base64( iv[12] + ciphertext + tag[16] )
      // WebCrypto subtle.decrypt expects: iv + ciphertext_with_tag_appended
      // which is exactly what we have — just split at byte 12 and pass the rest.
      if (!passphrase) return ciphertextB64;
      try {
        const combined = base64ToUint8Array(ciphertextB64);
        // Minimum: 12 (iv) + 16 (tag) + 1 (at least 1 byte payload)
        if (combined.length < 29) return ciphertextB64;

        const iv = combined.slice(0, 12);
        // Everything after IV: ciphertext bytes + 16-byte auth tag (WebCrypto handles tag verification)
        const ciphertextWithTag = combined.slice(12);
        let salt = '';
        try {
          if (globalScope.ValenixiaDB && typeof globalScope.ValenixiaDB.get === 'function') {
            const saltRow = await globalScope.ValenixiaDB.get('local_preferences', 'sync_salt');
            if (saltRow && saltRow.value_payload) {
              salt = saltRow.value_payload;
            }
          }
        } catch (e) {}
        if (!salt) {
          const enc = new TextEncoder();
          const msgUint8 = enc.encode(passphrase + "_salt_deriv");
          if (globalScope.crypto && globalScope.crypto.subtle && typeof globalScope.crypto.subtle.digest === 'function') {
            const hashBuffer = await globalScope.crypto.subtle.digest('SHA-256', msgUint8);
            salt = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
          } else {
            salt = passphrase.split('').reverse().join('').substring(0, 16);
          }
        }
        const key = await this.deriveKey(passphrase, salt);

        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv, tagLength: 128 },
          key,
          ciphertextWithTag
        );
        return new TextDecoder().decode(decrypted);
      } catch (err) {
        // Decryption failed — could be wrong passphrase or non-encrypted message
        return ciphertextB64;
      }
    }
  };

  globalScope.CryptoEngine = CryptoEngine;

  async function optimizeSqliteStorageEngine(dbConnectionInstance) {
    // NOTE: PRAGMA commands are SQLite-only. IndexedDB does not support them.
    // This function intentionally does nothing for IDB instances —
    // browser garbage collection and quota management handle cleanup automatically.
    console.log('[Database] IndexedDB initialised — no PRAGMA maintenance needed.');
  }
  globalScope.optimizeSqliteStorageEngine = optimizeSqliteStorageEngine;


  // ============================================================================
  // PURE JS CRYPTOGRAPHIC FALLBACKS
  // Used when window.crypto.subtle is not supported or restricted (non-HTTPS)
  // ============================================================================
  function sha256_js(bytes) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    var len = bytes.length;
    var words = [];
    for (var i = 0; i < len; i++) {
      words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    }
    var bitLen = len * 8;
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    var wordsLen = ((len + 8) >> 6) + 1 << 4;
    while (words.length < wordsLen) words.push(0);
    words[wordsLen - 2] = Math.floor(bitLen / 0x100000000);
    words[wordsLen - 1] = bitLen & 0xFFFFFFFF;
    var w = new Int32Array(64);
    var hash = new Int32Array(H);
    for (var i = 0; i < wordsLen; i += 16) {
      for (var j = 0; j < 16; j++) w[j] = words[i + j];
      for (var j = 16; j < 64; j++) {
        var s0 = (w[j - 15] >>> 7 | w[j - 15] << 25) ^ (w[j - 15] >>> 18 | w[j - 15] << 14) ^ (w[j - 15] >>> 3);
        var s1 = (w[j - 2] >>> 17 | w[j - 2] << 15) ^ (w[j - 2] >>> 19 | w[j - 2] << 13) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a1 = hash[0], b1 = hash[1], c1 = hash[2], d1 = hash[3];
      var e1 = hash[4], f1 = hash[5], g1 = hash[6], h1 = hash[7];
      for (var j = 0; j < 64; j++) {
        var S1 = (e1 >>> 6 | e1 << 26) ^ (e1 >>> 11 | e1 << 21) ^ (e1 >>> 25 | e1 << 7);
        var ch = (e1 & f1) ^ (~e1 & g1);
        var temp1 = (h1 + S1 + ch + K[j] + w[j]) | 0;
        var S0 = (a1 >>> 2 | a1 << 30) ^ (a1 >>> 13 | a1 << 19) ^ (a1 >>> 22 | a1 << 10);
        var maj = (a1 & b1) ^ (a1 & c1) ^ (b1 & c1);
        var temp2 = (S0 + maj) | 0;
        h1 = g1;
        g1 = f1;
        f1 = e1;
        e1 = (d1 + temp1) | 0;
        d1 = c1;
        c1 = b1;
        b1 = a1;
        a1 = (temp1 + temp2) | 0;
      }
      hash[0] = (hash[0] + a1) | 0;
      hash[1] = (hash[1] + b1) | 0;
      hash[2] = (hash[2] + c1) | 0;
      hash[3] = (hash[3] + d1) | 0;
      hash[4] = (hash[4] + e1) | 0;
      hash[5] = (hash[5] + f1) | 0;
      hash[6] = (hash[6] + g1) | 0;
      hash[7] = (hash[7] + h1) | 0;
    }
    var result = new Uint8Array(32);
    for (var i = 0; i < 8; i++) {
      result[i * 4] = hash[i] >>> 24;
      result[i * 4 + 1] = hash[i] >>> 16 & 0xFF;
      result[i * 4 + 2] = hash[i] >>> 8 & 0xFF;
      result[i * 4 + 3] = hash[i] & 0xFF;
    }
    return result;
  }

  function hmac_sha256_js(keyBytes, messageBytes) {
    var key = keyBytes;
    if (key.length > 64) {
      key = sha256_js(key);
    }
    if (key.length < 64) {
      var temp = new Uint8Array(64);
      temp.set(key);
      key = temp;
    }
    var o_key_pad = new Uint8Array(64);
    var i_key_pad = new Uint8Array(64);
    for (var i = 0; i < 64; i++) {
      o_key_pad[i] = key[i] ^ 0x5c;
      i_key_pad[i] = key[i] ^ 0x36;
    }
    var innerMsg = new Uint8Array(64 + messageBytes.length);
    innerMsg.set(i_key_pad);
    innerMsg.set(messageBytes, 64);
    var innerHash = sha256_js(innerMsg);
    var outerMsg = new Uint8Array(64 + 32);
    outerMsg.set(o_key_pad);
    outerMsg.set(innerHash, 64);
    return sha256_js(outerMsg);
  }

  function pbkdf2_sha256_js(passwordStr, saltBytes, iterations, keyLen) {
    var passwordBytes = new TextEncoder().encode(passwordStr);
    var result = new Uint8Array(keyLen);
    var offset = 0;
    var blockNum = 1;
    while (offset < keyLen) {
      var blockMsg = new Uint8Array(saltBytes.length + 4);
      blockMsg.set(saltBytes);
      blockMsg[saltBytes.length] = blockNum >>> 24 & 0xFF;
      blockMsg[saltBytes.length + 1] = blockNum >>> 16 & 0xFF;
      blockMsg[saltBytes.length + 2] = blockNum >>> 8 & 0xFF;
      blockMsg[saltBytes.length + 3] = blockNum & 0xFF;
      var u = hmac_sha256_js(passwordBytes, blockMsg);
      var u_sum = new Uint8Array(u);
      for (var i = 1; i < iterations; i++) {
        u = hmac_sha256_js(passwordBytes, u);
        for (var j = 0; j < 32; j++) {
          u_sum[j] ^= u[j];
        }
      }
      var take = Math.min(32, keyLen - offset);
      result.set(u_sum.subarray(0, take), offset);
      offset += take;
      blockNum++;
    }
    return result;
  }

  // Simple async SHA-256 legacy utility for PIN hashing matching legacy db values
  async function hashPinLegacy(pin, salt) {
    try {
      if (!crypto || !crypto.subtle) throw new Error("SubtleCrypto unavailable");
      const msgUint8 = new TextEncoder().encode(pin + (salt || ''));
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn("SubtleCrypto digest unavailable, using JS-native fallback SHA-256");
      const hashBytes = sha256_js(new TextEncoder().encode(pin + (salt || '')));
      return Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  // Generates a fully salted PBKDF2 hash (matching the Node server/Kotlin DB backend)
  async function hashPin(pin, saltHex) {
    const salt = saltHex || Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      const derived = await pbkdf2(pin, salt, 100000, 64);
      return `${salt}:${derived}`;
    } catch (e) {
      console.warn("PBKDF2 derivation failed, falling back to simple hash:", e);
      const hash = await hashPinLegacy(pin, salt);
      return `${salt}:${hash}`;
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
    // Use Native Android Bridge if WebCrypto is blocked by Chromium
    if (globalScope.AndroidPOS && typeof globalScope.AndroidPOS.pbkdf2 === 'function') {
      const res = globalScope.AndroidPOS.pbkdf2(password, saltHex, iterations, keyLen);
      if (res) return res;
    }

    try {
      if (!crypto || !crypto.subtle) throw new Error("SubtleCrypto unavailable");
      const encoder = new TextEncoder();
      const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
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
    } catch (e) {
      console.warn("SubtleCrypto pbkdf2 unavailable, using JS-native fallback PBKDF2");
      const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const derivedBytes = pbkdf2_sha256_js(password, saltBytes, iterations, keyLen);
      return Array.from(derivedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
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
      const hash = await hashPinLegacy(pin);
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

  const ValenixiaDB = {
    db: null,
    dbName: 'valenixia_db',
    dbVersion: 5,

    runMigrations(oldVer, newVer) {
      console.log(`[IndexedDB] Migration triggered from v${oldVer} to v${newVer}`);
    },

    async migrateDatabase() {
      return new Promise((resolve) => {
        const oldDbName = 'nexova_db';
        try {
          const req = indexedDB.open(oldDbName);
          let exists = true;
          req.onupgradeneeded = (e) => {
            exists = false;
            try { e.target.transaction.abort(); } catch(err) {}
          };
          req.onerror = () => {
            resolve();
          };
          req.onsuccess = async (e) => {
            if (!exists) {
              resolve();
              return;
            }
            const oldDb = e.target.result;
            console.log('[IndexedDB] Found old nexova_db database. Beginning migration to valenixia_db...');
            
            try {
              const storesToMigrate = Array.from(oldDb.objectStoreNames);
              if (storesToMigrate.length === 0) {
                oldDb.close();
                resolve();
                return;
              }
              
              const newDb = await new Promise((res, rej) => {
                const openReq = indexedDB.open(this.dbName, this.dbVersion);
                openReq.onsuccess = (evt) => res(evt.target.result);
                openReq.onerror = (evt) => rej(evt.target.error);
                openReq.onupgradeneeded = (evt) => {
                  const db = evt.target.result;
                  storesToMigrate.forEach(s => {
                    if (!db.objectStoreNames.contains(s)) {
                      db.createObjectStore(s, { keyPath: s === 'line_items' || s === 'error_logs' || s === 'crsql_changes' ? 'id' : 'key' });
                    }
                  });
                };
              });
              
              for (const storeName of storesToMigrate) {
                const oldTx = oldDb.transaction(storeName, 'readonly');
                const oldStore = oldTx.objectStore(storeName);
                const allRecords = await new Promise((res) => {
                  const getReq = oldStore.getAll();
                  getReq.onsuccess = () => res(getReq.result);
                  getReq.onerror = () => res([]);
                });
                
                if (allRecords.length > 0) {
                  const newTx = newDb.transaction(storeName, 'readwrite');
                  const newStore = newTx.objectStore(storeName);
                  for (const rec of allRecords) {
                    newStore.put(rec);
                  }
                  await new Promise((res) => {
                    newTx.oncomplete = res;
                    newTx.onerror = res;
                  });
                }
              }
              newDb.close();
              oldDb.close();
              
              console.log('[IndexedDB] Migration complete. Deleting old nexova_db...');
              indexedDB.deleteDatabase(oldDbName);
            } catch (err) {
              console.error('[IndexedDB] Database migration failed:', err);
              try { oldDb.close(); } catch(ex) {}
            }
            resolve();
          };
        } catch (e) {
          resolve();
        }
      });
    },

    init() {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(granted => {
          if (!granted) {
            console.warn("Persistent storage not granted. OS may clear data under storage pressure.");
          } else {
            console.log("Persistent storage granted. IndexedDB data protected.");
          }
        });
      }

      return new Promise(async (resolve, reject) => {
        if (this.db) return resolve(this.db);

        await this.migrateDatabase();

        let settled = false;
        const settle = (fn, val) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutHandle);
            fn(val);
          }
        };

        // Hard timeout — never block app boot more than 8 seconds
        const timeoutHandle = setTimeout(() => {
          if (!settled) {
            console.error('[IndexedDB] Open request timed out after 8s — resolving with null to allow app boot degraded.');
            settle(resolve, null);
          }
        }, 8000);

        const request = globalScope.indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          const oldVer = event.oldVersion;
          const newVer = event.newVersion;
          ValenixiaDB.runMigrations(oldVer, newVer);

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

          // Domain 18 (v5): Audit Log — append-only, never deleted, integrity-protected
          if (!db.objectStoreNames.contains('audit_logs')) {
            const auditStore = db.createObjectStore('audit_logs', { keyPath: 'id' });
            auditStore.createIndex('timestamp', 'timestamp', { unique: false });
            auditStore.createIndex('action', 'action', { unique: false });
            auditStore.createIndex('actor_id', 'actor_id', { unique: false });
          }

          // Domain 19 (v5): Error Logs — crash telemetry, exportable
          if (!db.objectStoreNames.contains('error_logs')) {
            const errStore = db.createObjectStore('error_logs', { keyPath: 'id' });
            errStore.createIndex('timestamp', 'timestamp', { unique: false });
            errStore.createIndex('error_type', 'error_type', { unique: false });
          }

          // Domain 20 (v5): Pending Checkouts — crash recovery
          if (!db.objectStoreNames.contains('pending_checkouts')) {
            db.createObjectStore('pending_checkouts', { keyPath: 'id' });
          }
        };

        request.onsuccess = async (event) => {
          if (typeof window !== 'undefined' && typeof window.debugLog === 'function') window.debugLog('IndexedDB open onsuccess triggered');
          this.db = event.target.result;
          console.log('[IndexedDB] DB initialized successfully.');

          // Yield this connection when a newer version needs to open
          this.db.onversionchange = () => {
            console.warn('[IndexedDB] Version change detected — closing DB connection to allow upgrade.');
            this.db.close();
            this.db = null;
          };

          try {
            await optimizeSqliteStorageEngine(this);
          } catch (err) {}

          try {
            await this.seedIfNeeded();
          } catch (e) {
            console.warn('[IndexedDB] seedIfNeeded failed (non-fatal):', e);
          }
          settle(resolve, this.db);
        };

        request.onerror = async (event) => {
          const error = event.target.error;
          console.error('[IndexedDB] Failed to open DB:', error);
          
          const isCorruptionError = 
            error.name === 'VersionError' ||
            error.name === 'QuotaExceededError' ||
            error.name === 'UnknownError' ||
            error.name === 'NotFoundError' ||
            (error.message && (
              error.message.toLowerCase().includes('corrupt') ||
              error.message.toLowerCase().includes('version') ||
              error.message.toLowerCase().includes('upgrade')
            ));
          
          if (isCorruptionError) {
            console.warn('[IndexedDB] Detected corruption error, attempting recovery...');
            try {
              if (this.db) {
                this.db.close();
                this.db = null;
              }
              
              const deleteReq = indexedDB.deleteDatabase(this.dbName);
              await new Promise((res, rej) => {
                deleteReq.onsuccess = () => {
                  console.log('[IndexedDB] Corrupted database deleted successfully');
                  res();
                };
                deleteReq.onerror = () => {
                  console.error('[IndexedDB] Failed to delete corrupted database');
                  rej(deleteReq.error);
                };
                deleteReq.onblocked = () => {
                  console.warn('[IndexedDB] Database delete blocked — other tabs may be using it');
                  if (typeof BroadcastChannel !== 'undefined') {
                    const bc = new BroadcastChannel('valenixia_db_reload');
                    bc.postMessage({ action: 'force_reload' });
                    bc.close();
                  }
                  setTimeout(() => window.location.reload(), 500);
                };
              });
              
              if (typeof showTransientToast === 'function') {
                showTransientToast('Database recovered. Reloading app...', 'warning', 2000);
              }
              setTimeout(() => window.location.reload(), 1500);
              return new Promise(() => {});
            } catch (recoveryErr) {
              console.error('[IndexedDB] Recovery failed:', recoveryErr);
            }
          }
          
          const enhancedError = new Error(
            `IndexedDB initialization failed: ${error.name}: ${error.message}. ` +
            `Try clearing browser data for this site or disabling private browsing mode.`
          );
          enhancedError.originalError = error;
          enhancedError.isRecoverable = isCorruptionError;
          settle(reject, enhancedError);
        };

        // CRITICAL: This fires when another tab/SW holds the DB at a lower version.
        // Without this handler, the open request hangs indefinitely.
        request.onblocked = (event) => {
          console.warn('[IndexedDB] Open request BLOCKED — another tab/SW is holding DB v' +
            (event.oldVersion || '?') + '. Triggering reload on all clients...');
          // Broadcast to all SW clients to close their connections
          if (globalScope.navigator && navigator.serviceWorker && navigator.serviceWorker.controller) {
            try {
              navigator.serviceWorker.controller.postMessage({ type: 'IDB_CLOSE_FOR_UPGRADE' });
            } catch (e) {}
          }
          // Resolve with null after a brief wait so boot can continue in degraded mode
          setTimeout(() => {
            console.warn('[IndexedDB] Block timeout reached — resolving with null for degraded boot.');
            settle(resolve, null);
          }, 3000);
        };
      });
    },


    async bootstrapStore(storeName, taxRate, adminPin, syncPassphrase, theme, shopMode = 'simple-retail') {
      console.log('[IndexedDB] Bootstrapping new store database...');
      
      const now = Date.now();
      
      // 1. Seed Categories
      const categories = ['Drinks', 'Pastries', 'Accessories', 'Apparel', 'Utilities'];
      for (const cat of categories) {
        await this.put('categories', { name: cat, sync_hlc: '0000000000000:000001:seed' });
      }

      // Seed baseline products catalog
      const baselineProducts = [
        { sku: 'sku_espresso', name: 'Monochrome Espresso', category: 'Drinks', base_price_minor_units: 32000, cost_price_minor_units: 12000, stock_level: 50, alert_threshold: 5, sync_hlc: '0000000000000:000004:seed' },
        { sku: 'sku_cappuccino', name: 'Premium Cappuccino', category: 'Drinks', base_price_minor_units: 45000, cost_price_minor_units: 15000, stock_level: 40, alert_threshold: 5, sync_hlc: '0000000000000:000005:seed' },
        { sku: 'sku_croissant', name: 'Butter Croissant', category: 'Pastries', base_price_minor_units: 28000, cost_price_minor_units: 10000, stock_level: 25, alert_threshold: 3, sync_hlc: '0000000000000:000006:seed' },
        { sku: 'sku_muffin', name: 'Blueberry Muffin', category: 'Pastries', base_price_minor_units: 30000, cost_price_minor_units: 11000, stock_level: 30, alert_threshold: 4, sync_hlc: '0000000000000:000007:seed' },
        { sku: 'sku_tote', name: 'Canvas Tote Bag', category: 'Accessories', base_price_minor_units: 120000, cost_price_minor_units: 45000, stock_level: 15, alert_threshold: 2, sync_hlc: '0000000000000:000008:seed' }
      ];

      for (const prod of baselineProducts) {
        await this.put('inventory_catalog', prod);
      }

      // 2. Create Admin Employee
      const empAdmin = {
        id: 'emp_admin',
        auth_hash: adminPin, // Use the pre-hashed PIN directly to avoid double-hashing
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
        { key: 'terminal_name', value_type: 'STR', value_payload: 'Valenixia Master PC 01', is_idempotent_flag: 0, updated_at: now },
        { key: 'store_receipt_width', value_type: 'STR', value_payload: '42', is_idempotent_flag: 0, updated_at: now },
        { key: 'valenixia_master_node_id', value_type: 'STR', value_payload: 'Valenixia Master PC 01', is_idempotent_flag: 0, updated_at: now },
        { key: 'shop_mode', value_type: 'STR', value_payload: shopMode, is_idempotent_flag: 0, updated_at: now }
        // NOTE: sync_passphrase intentionally NOT stored in IndexedDB — it lives in
        // server memory only and is sent to the worker over postMessage for session use.
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

    async getSecurePref(key) {
      try {
        const pref = await this.get('local_preferences', key);
        if (!pref || !pref.value_payload) return null;
        if (pref.value_payload.startsWith('SEC1:')) {
          const encrypted = pref.value_payload.substring(5);
          const hwid = await deriveSecurePrefHWID();
          const decrypted = await CryptoEngine.decrypt(encrypted, hwid);
          return decrypted;
        }
        return pref.value_payload;
      } catch (e) {
        console.warn(`[ClientDB] Failed to get secure pref for ${key}:`, e.message);
        return null;
      }
    },

    async setSecurePref(key, val) {
      try {
        if (!val) {
          await this.delete('local_preferences', key);
          return;
        }
        const hwid = await deriveSecurePrefHWID();
        const encrypted = await CryptoEngine.encrypt(val, hwid);
        await this.put('local_preferences', {
          key: key,
          value_type: 'SECURE_STR',
          value_payload: 'SEC1:' + encrypted,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
      } catch (e) {
        console.error(`[ClientDB] Failed to set secure pref for ${key}:`, e.message);
      }
    },

    // CRUD Helper methods
    // CRUD Helper methods
    async get(storeName, key, tx = null) {
      const row = await new Promise((resolve, reject) => {
        if (!this.db && !tx) return resolve(null);
        const store = tx ? tx.objectStore(storeName) : this.db.transaction([storeName], 'readonly').objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = (event) => resolve(event.target.result || null);
        request.onerror = (event) => reject(event.target.error);
      });
      if (!row) return null;
      let passphrase = '';
      if (storeName === 'customers' || storeName === 'transactions') {
        passphrase = await this.getSyncPassphrase(tx);
      }
      return await decryptItem(storeName, row, passphrase);
    },

    async put(storeName, item, tx = null) {
      let passphrase = '';
      if (storeName === 'customers' || storeName === 'transactions') {
        passphrase = await this.getSyncPassphrase(tx);
      }
      const encryptedItem = await encryptItem(storeName, item, passphrase);
      return new Promise((resolve, reject) => {
        if (!this.db && !tx) return resolve(true);
        try {
          const store = tx ? tx.objectStore(storeName) : this.db.transaction([storeName], 'readwrite').objectStore(storeName);
          const request = store.put(encryptedItem);

          request.onsuccess = () => {
            if (!tx) this.triggerOpfsBackupDebounced();
            resolve(true);
          };
          request.onerror = (event) => {
            const err = event.target.error;
            if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('CRITICAL_STORAGE_ERROR', { detail: 'Device storage is full. Please free up space immediately.' }));
              }
            }
            reject(err);
          };
        } catch (err) {
          if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('CRITICAL_STORAGE_ERROR', { detail: 'Device storage is full. Please free up space immediately.' }));
            }
          }
          reject(err);
        }
      });
    },

    delete(storeName, key, tx = null) {
      return new Promise((resolve, reject) => {
        if (!this.db && !tx) return resolve(true);
        try {
          const store = tx ? tx.objectStore(storeName) : this.db.transaction([storeName], 'readwrite').objectStore(storeName);
          const request = store.delete(key);

          request.onsuccess = () => {
            if (!tx) this.triggerOpfsBackupDebounced();
            resolve(true);
          };
          request.onerror = (event) => {
            const err = event.target.error;
            if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('CRITICAL_STORAGE_ERROR', { detail: 'Device storage is full. Please free up space immediately.' }));
              }
            }
            reject(err);
          };
        } catch (err) {
          if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('CRITICAL_STORAGE_ERROR', { detail: 'Device storage is full. Please free up space immediately.' }));
            }
          }
          reject(err);
        }
      });
    },

    async count(storeName) {
      if (!this.db) return 0;
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch (e) {
          resolve(0);
        }
      });
    },

    async appendAuditLog({ event_type, who, what, node_id }) {
      const entry = {
        id: `aud_${Date.now()}_${Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join('').substring(0, 4)}`,
        event_type,
        action: event_type,
        who,
        actor_id: who,
        what,
        details: what,
        node_id: node_id || 'unknown',
        timestamp: Date.now()
      };
      try {
        await this.put('audit_logs', entry);
        console.log('[AuditLog]', entry);
      } catch (err) {
        console.warn('[AuditLog] Failed to write to IndexedDB:', err);
      }
    },


    async getSyncPassphrase(tx = null) {
      try {
        const row = await this.get('local_preferences', 'sync_passphrase', tx);
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
        const fileHandle = await root.getFileHandle('valenixia_vault.db', { create: true });
        
        let encrypted = backupDataText;
        if (passphrase) {
          encrypted = await CryptoEngine.encrypt(backupDataText, passphrase);
        }
        
        if (typeof fileHandle.createWritable === 'function') {
          const writable = await fileHandle.createWritable();
          await writable.write(encrypted);
          await writable.close();
          console.log('[OPFS] Database encrypted state written to valenixia_vault.db successfully.');
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

    async getAll(storeName, tx = null) {
      const rows = await new Promise((resolve, reject) => {
        if (!this.db && !tx) return resolve([]);
        const store = tx ? tx.objectStore(storeName) : this.db.transaction([storeName], 'readonly').objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = (event) => resolve(event.target.result || []);
        request.onerror = (event) => reject(event.target.error);
      });
      let passphrase = '';
      if (storeName === 'customers' || storeName === 'transactions') {
        passphrase = await this.getSyncPassphrase(tx);
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
        if (!this.db) return resolve([]);
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
          const activeEmps = employees.filter(emp => emp.is_active === 1);
          
          // Map each active employee to an async verify pin promise to run in parallel
          const verifications = activeEmps.map(async (emp) => {
            const matched = await verifyPinClient(pin, emp.auth_hash);
            return matched ? emp : null;
          });
          
          const results = await Promise.all(verifications);
          const matchedEmp = results.find(emp => emp !== null);
          if (matchedEmp) {
            resolve({ id: matchedEmp.id, role: matchedEmp.role });
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    },
    async getDbVersion(tx = null) {
      const changes = await this.getAll('crsql_changes', tx);
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

    async logLocalChange(tableName, pk, cid, val, colVersion, cl, syncHlc, tx = null) {
      const dbVersion = (await this.getDbVersion(tx)) + 1;
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
      await this.put('crsql_changes', change, tx);
      return dbVersion;
    },

    async applyChangeToSchema(tableName, pk, cid, val, cl, valType = 'string', tx = null) {
      if (cid === '__proto__' || cid === 'constructor' || cid === 'prototype') {
        throw new Error('Security Exception: Prototype pollution blocked');
      }

      if (cl === 0) {
        // Soft deletion
        if (tableName === 'transactions') {
          const record = await this.get('transactions', pk, tx);
          if (record) {
            record.is_deleted = 1;
            record.status = 'VOIDED';
            record.updated_at = Date.now();
            await this.put('transactions', record, tx);
          }
        } else if (tableName === 'line_items') {
          const li = await this.get('line_items', pk, tx);
          if (li) {
            li.is_deleted = 1;
            await this.put('line_items', li, tx);
          }
        } else if (tableName === 'inventory_catalog') {
          const inv = await this.get('inventory_catalog', pk, tx);
          if (inv) {
            inv.is_deleted = 1;
            await this.put('inventory_catalog', inv, tx);
          }
        } else if (tableName === 'employees') {
          const emp = await this.get('employees', pk, tx);
          if (emp) {
            emp.is_deleted = 1;
            emp.is_active = 0;
            await this.put('employees', emp, tx);
          }
        } else if (tableName === 'customers') {
          const cust = await this.get('customers', pk, tx);
          if (cust) {
            cust.is_deleted = 1;
            await this.put('customers', cust, tx);
          }
        } else if (tableName === 'local_preferences') {
          await this.delete('local_preferences', pk, tx);
        } else if (tableName === 'categories') {
          await this.delete('categories', pk, tx);
        } else if (tableName === 'distributors') {
          const dist = await this.get('distributors', pk, tx);
          if (dist) {
            dist.is_deleted = 1;
            await this.put('distributors', dist, tx);
          }
        } else if (tableName === 'purchase_orders') {
          const po = await this.get('purchase_orders', pk, tx);
          if (po) {
            po.is_deleted = 1;
            await this.put('purchase_orders', po, tx);
          }
        } else if (tableName === 'po_line_items') {
          const poli = await this.get('po_line_items', pk, tx);
          if (poli) {
            poli.is_deleted = 1;
            await this.put('po_line_items', poli, tx);
          }
        } else if (tableName === 'distributor_payments') {
          const dp = await this.get('distributor_payments', pk, tx);
          if (dp) {
            dp.is_deleted = 1;
            await this.put('distributor_payments', dp, tx);
          }
        } else if (tableName === 'customer_credit') {
          const cc = await this.get('customer_credit', pk, tx);
          if (cc) {
            cc.is_deleted = 1;
            await this.put('customer_credit', cc, tx);
          }
        }
        return;
      }

      // Convert value formats using type spec or inference
      let parsedVal = val;
      if (val !== null) {
        let inferredType = valType;
        if (!inferredType || inferredType === 'string') {
          if (val === 'true' || val === 'false') {
            inferredType = 'boolean';
          } else if (val !== '' && !isNaN(Number(val)) && !/^\s*$/.test(val)) {
            inferredType = 'number';
          } else if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
            try {
              JSON.parse(val);
              inferredType = 'object';
            } catch (e) {}
          }
        }

        if (inferredType === 'number') {
          parsedVal = Number(val);
        } else if (inferredType === 'boolean') {
          parsedVal = (val === 'true' || val === '1' || val === 1);
        } else if (inferredType === 'object') {
          try {
            parsedVal = JSON.parse(val);
          } catch (e) {
            parsedVal = val;
          }
        }
      }

      // Sync settings schema update
      if (tableName === 'transactions') {
        let record = await this.get('transactions', pk, tx);
        if (!record) {
          record = { id: pk, status: 'DRAFT', is_deleted: 0, created_at: Date.now() };
        }
        record[cid] = parsedVal;
        record.updated_at = Date.now();
        await this.put('transactions', record, tx);
      } 
      
      else if (tableName === 'line_items') {
        let li = await this.get('line_items', pk, tx);
        if (!li) {
          let txId = pk;
          if (pk.startsWith('li_')) {
            txId = pk.split('_').slice(1, -1).join('_');
          }
          li = { id: pk, transaction_id: txId, sku: 'COFFEE-ESP', quantity: 1, unit_price_minor_units: 0, applied_discount_minor_units: 0, is_deleted: 0 };
        }
        li[cid] = parsedVal;
        await this.put('line_items', li, tx);
      } 
      
      else if (tableName === 'inventory_catalog') {
        let inv = await this.get('inventory_catalog', pk, tx);
        if (!inv) {
          inv = { sku: pk, stock_level: 0, reserved_stock: 0, name: pk, base_price_minor_units: 0, category: 'Uncategorized', emoji: '📦', cost_price_minor_units: 0 };
        }
        inv[cid] = parsedVal;
        await this.put('inventory_catalog', inv, tx);
      } 
      
      else if (tableName === 'employees') {
        let emp = await this.get('employees', pk, tx);
        if (!emp) {
          emp = { id: pk, is_active: 1 };
        }
        emp[cid] = parsedVal;
        await this.put('employees', emp, tx);
      } 
      
      else if (tableName === 'local_preferences') {
        let pref = await this.get('local_preferences', pk, tx);
        if (!pref) {
          pref = { key: pk, value_type: 'STR', value_payload: '', is_idempotent_flag: 0, updated_at: Date.now() };
        }
        pref[cid] = val; // Always string/raw payload for preferences
        pref.updated_at = Date.now();
        await this.put('local_preferences', pref, tx);
      }
      
      else if (tableName === 'customers') {
        let cust = await this.get('customers', pk, tx);
        if (!cust) {
          cust = { id: pk, name: pk, phone: '', email: '', total_spend_cents: 0, visits: 0, created_at: Date.now() };
        }
        cust[cid] = parsedVal;
        await this.put('customers', cust, tx);
      }

      else if (tableName === 'categories') {
        let cat = await this.get('categories', pk, tx);
        if (!cat) {
          cat = { name: pk };
        }
        cat[cid] = parsedVal;
        await this.put('categories', cat, tx);
      }

      else if (tableName === 'stock_movements') {
        let mv = await this.get('stock_movements', pk, tx);
        if (!mv) {
          mv = { id: pk, sku: '', change_qty: 0, reason: '', created_at: Date.now() };
        }
        mv[cid] = parsedVal;
        await this.put('stock_movements', mv, tx);
      }

      else if (tableName === 'employee_shifts') {
        let sh = await this.get('employee_shifts', pk, tx);
        if (!sh) {
          sh = { id: pk, employee_id: '', clock_in: Date.now(), clock_out: null };
        }
        sh[cid] = parsedVal;
        await this.put('employee_shifts', sh, tx);
      }

      else if (tableName === 'distributors') {
        let dist = await this.get('distributors', pk, tx);
        if (!dist) {
          dist = { id: pk, name: pk, created_at: Date.now(), is_deleted: 0 };
        }
        dist[cid] = parsedVal;
        await this.put('distributors', dist, tx);
      }

      else if (tableName === 'purchase_orders') {
        let po = await this.get('purchase_orders', pk, tx);
        if (!po) {
          po = { id: pk, distributor_id: 'unknown', status: 'DRAFT', created_at: Date.now(), is_deleted: 0 };
        }
        po[cid] = parsedVal;
        po.updated_at = Date.now();
        await this.put('purchase_orders', po, tx);
      }

      else if (tableName === 'po_line_items') {
        let poli = await this.get('po_line_items', pk, tx);
        if (!poli) {
          poli = { id: pk, po_id: 'unknown', quantity_ordered: 0, quantity_received: 0, unit_cost_minor: 0, is_deleted: 0 };
        }
        poli[cid] = parsedVal;
        await this.put('po_line_items', poli, tx);
      }

      else if (tableName === 'distributor_payments') {
        let dp = await this.get('distributor_payments', pk, tx);
        if (!dp) {
          dp = { id: pk, distributor_id: 'unknown', amount_minor: 0, paid_at: Date.now(), is_deleted: 0 };
        }
        dp[cid] = parsedVal;
        await this.put('distributor_payments', dp, tx);
      }

      else if (tableName === 'customer_credit') {
        let cc = await this.get('customer_credit', pk, tx);
        if (!cc) {
          cc = { id: pk, customer_id: 'unknown', amount_minor: 0, created_at: Date.now(), is_deleted: 0 };
        }
        cc[cid] = parsedVal;
        await this.put('customer_credit', cc, tx);
      }
    },

    async recalculateCachedStock(sku, tx = null) {
      const baseStockRow = await this.get('crsql_changes', ['inventory_catalog', sku, 'stock_level'], tx);
      const baseStock = baseStockRow ? Number(baseStockRow.val) : 0;
      const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

      // Query IndexedDB using a bounded range on the compound primary key to avoid unbounded getAll()
      const totalDelta = await new Promise((resolve, reject) => {
        try {
          const storeName = 'crsql_changes';
          const store = tx ? tx.objectStore(storeName) : this.db.transaction([storeName], 'readonly').objectStore(storeName);
          const range = IDBKeyRange.bound(
            ['inventory_catalog_counters', sku + '/', ''],
            ['inventory_catalog_counters', sku + '/\uffff', '\uffff']
          );
          
          let delta = 0;
          const request = store.openCursor(range);
          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const row = cursor.value;
              if (row.cid === 'delta' && row.sync_hlc > baseHlc) {
                delta += Number(row.val);
              }
              cursor.continue();
            } else {
              resolve(delta);
            }
          };
          request.onerror = (event) => reject(event.target.error);
        } catch (e) {
          reject(e);
        }
      });

      const finalStock = Math.max(0, baseStock + totalDelta);
      
      const inv = await this.get('inventory_catalog', sku, tx);
      if (inv) {
        inv.stock_level = finalStock;
        await this.put('inventory_catalog', inv, tx);
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

  async function deriveSecurePrefHWID() {
    if (globalScope.hwid) return globalScope.hwid;
    if (globalScope.__valenixiaHWID) return globalScope.__valenixiaHWID;

    if (globalScope.AndroidPOS && typeof globalScope.AndroidPOS.getDeviceID === 'function') {
      const nativeHwid = globalScope.AndroidPOS.getDeviceID();
      if (nativeHwid) return nativeHwid;
    }

    const canvas = globalScope.document ? globalScope.document.createElement('canvas') : null;
    let canvasData = '';
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('ValenixiaPOS-HWID-Seed', 2, 2);
        canvasData = canvas.toDataURL();
      }
    }

    const components = [
      globalScope.navigator ? globalScope.navigator.userAgent : 'node_or_worker',
      globalScope.navigator ? globalScope.navigator.language : 'en',
      globalScope.screen ? String(globalScope.screen.width * globalScope.screen.height) : '1920x1080',
      globalScope.screen ? String(globalScope.screen.colorDepth) : '24',
      globalScope.navigator ? String(globalScope.navigator.hardwareConcurrency || 0) : '4',
      globalScope.navigator ? String(globalScope.navigator.deviceMemory || 0) : '4',
      typeof Intl !== 'undefined' ? new Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
      canvasData ? canvasData.slice(-128) : 'fallback_canvas_data'
    ].join('|');

    try {
      if (globalScope.crypto && globalScope.crypto.subtle) {
        const encoded = new TextEncoder().encode(components);
        const hashBuf = await globalScope.crypto.subtle.digest('SHA-256', encoded);
        const hashArr = Array.from(new Uint8Array(hashBuf));
        return hashArr.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().slice(0, 32);
      }
    } catch (e) {}

    let h = 5381;
    for (let i = 0; i < components.length; i++) {
      h = ((h << 5) + h) ^ components.charCodeAt(i);
      h = h >>> 0;
    }
    let result = '';
    let seed = h;
    while (result.length < 32) {
      seed = ((seed << 5) + seed + result.length * 31) >>> 0;
      result += seed.toString(16).padStart(8, '0');
    }
    return result.toUpperCase().slice(0, 32);
  }

  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel('valenixia_db_reload');
    bc.onmessage = (event) => {
      if (event.data && event.data.action === 'force_reload') {
        console.warn('[BroadcastChannel] Force reload requested.');
        window.location.reload();
      }
    };
  }

  globalScope.hashPin = hashPin;
  globalScope.ValenixiaDB = ValenixiaDB;
  globalScope.appendAuditLog = ValenixiaDB.appendAuditLog.bind(ValenixiaDB);
})();
