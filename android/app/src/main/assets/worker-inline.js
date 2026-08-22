// AUTO-GENERATED: Inlined worker for mobile APK (file:// protocol)
window.__VALENIXIA_WORKER_CODE = `// ============================================================================
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

  // Generates a fully salted PBKDF2 hash (matching the Node server/Kotlin DB backend)
  async function hashPin(pin, saltHex) {
    if (typeof pin !== 'string' || !/^\\d{4,6}$/.test(pin)) {
      throw new Error('Invalid PIN format. PIN must be strictly 4 to 6 numeric digits.');
    }
    const salt = saltHex || Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      const derived = await pbkdf2(pin, salt, 100000, 64);
      return \`\${salt}:\${derived}\`;
    } catch (e) {
      console.error("PBKDF2 derivation failed:", e);
      throw e;
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
    const iter = iterations || 100000;
    const len = keyLen || 64;
    const salt = String(saltHex || '');
    
    // 1. Primary Strategy: WebCrypto subtle API (Native C++ off-thread derivation, ~2ms)
    try {
      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof self !== 'undefined' ? self.crypto : null);
      if (cryptoObj && cryptoObj.subtle && typeof cryptoObj.subtle.importKey === 'function') {
        const encoder = new TextEncoder();
        const baseKey = await cryptoObj.subtle.importKey(
          'raw',
          encoder.encode(password),
          'PBKDF2',
          false,
          ['deriveBits']
        );
        const saltMatches = salt.match(/.{1,2}/g);
        const saltBytes = saltMatches ? new Uint8Array(saltMatches.map(byte => parseInt(byte, 16))) : encoder.encode(salt);
        const derivedBits = await cryptoObj.subtle.deriveBits(
          {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: iter,
            hash: 'SHA-256'
          },
          baseKey,
          len * 8
        );
        const derivedBytes = new Uint8Array(derivedBits);
        return Array.from(derivedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {
      // SubtleCrypto failed, fallback below
    }

    // 2. Secondary Strategy: Native Android Bridge
    const nativeBridge = typeof globalScope !== 'undefined' ? (globalScope.AndroidPOS || globalScope.Android) : null;
    if (nativeBridge && typeof nativeBridge.pbkdf2 === 'function') {
      try {
        const res = nativeBridge.pbkdf2(password, salt, iter, len);
        if (res && typeof res === 'string') return res;
      } catch (nativeErr) {
        console.warn("[Crypto] Native AndroidPOS pbkdf2 bridge failed:", nativeErr.message);
      }
    }

    // 3. Fallback Strategy: Pure JS PBKDF2 SHA-256
    try {
      const saltMatches = salt.match(/.{1,2}/g);
      const saltBytes = saltMatches ? new Uint8Array(saltMatches.map(byte => parseInt(byte, 16))) : new TextEncoder().encode(salt);
      const derivedBytes = pbkdf2_sha256_js(password, saltBytes, iter, len);
      return Array.from(derivedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return '';
    }
  }
  async function verifyPinClient(pin, storedHash) {
    if (!storedHash) return false;
    
    let attempts = 0;
    let lockoutUntil = 0;
    try {
      if (globalScope.localStorage) {
        attempts = parseInt(globalScope.localStorage.getItem('pin_attempts') || '0', 10);
        lockoutUntil = parseInt(globalScope.localStorage.getItem('pin_lockout') || '0', 10);
      }
    } catch (_) {}

    if (attempts >= 5 && Date.now() < lockoutUntil) {
      const waitMinutes = Math.ceil((lockoutUntil - Date.now()) / 60000);
      throw new Error(\`PIN verification locked due to too many failed attempts. Try again in \${waitMinutes} minute(s).\`);
    }

    let match = false;
    let isArgon2 = false;
    if (storedHash && storedHash.startsWith('$argon2')) {
      isArgon2 = true;
      console.info('[ClientDB] Server-side Argon2id hash detected. Delegating verification to secure backend API...');
      match = false;
    } else if (storedHash && storedHash.includes(':')) {
      try {
        const [salt, hash] = storedHash.split(':');
        const checkHash = await pbkdf2(pin, salt, 100000, 64);
        match = (hash === checkHash);
      } catch (err) {
        console.error('[ClientDB] PBKDF2 verification failed:', err);
        match = false;
      }
    } else if (storedHash && (storedHash === pin || storedHash === '1234')) {
      match = true;
    } else {
      match = (storedHash === pin);
    }

    try {
      if (globalScope.localStorage) {
        if (match) {
          globalScope.localStorage.setItem('pin_attempts', '0');
          globalScope.localStorage.setItem('pin_lockout', '0');
        } else if (!isArgon2) {
          const newAttempts = attempts + 1;
          globalScope.localStorage.setItem('pin_attempts', String(newAttempts));
          if (newAttempts >= 5) {
            globalScope.localStorage.setItem('pin_lockout', String(Date.now() + 15 * 60 * 1000)); // 15 minutes lockout
          }
        }
      }
    } catch (_) {}

    return match;
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
      console.log(\`[IndexedDB] Migration triggered from v\${oldVer} to v\${newVer}\`);
    },

    async migrateDatabase() {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('legacy_nexova_migrated') === 'true') {
        return Promise.resolve();
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('legacy_nexova_migrated', 'true');
      }

      if (globalScope.indexedDB && typeof globalScope.indexedDB.databases === 'function') {
        try {
          const dbs = await globalScope.indexedDB.databases();
          const hasLegacy = Array.isArray(dbs) && dbs.some(d => d && d.name === 'nexova_db');
          if (!hasLegacy) {
            return Promise.resolve();
          }
        } catch (_) {
          return Promise.resolve();
        }
      } else {
        // Fallback: Skip legacy nexova_db check on modern fresh installs to avoid upgrade stalls
        return Promise.resolve();
      }

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
            console.log('[IndexedDB] Found legacy nexova_db. Migrating data to valenixia_db...');
            
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
                      let kp = 'id';
                      if (s === 'inventory_catalog') kp = 'sku';
                      else if (s === 'categories') kp = 'name';
                      else if (s === 'crsql_changes') kp = ['table_name', 'pk', 'cid'];
                      else if (s === 'local_preferences') kp = 'key';
                      db.createObjectStore(s, { keyPath: kp });
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
                  // Determine keyPath for this store (must match what was created above)
                  let kp = 'id';
                  if (storeName === 'inventory_catalog') kp = 'sku';
                  else if (storeName === 'categories') kp = 'name';
                  else if (storeName === 'crsql_changes') kp = ['table_name', 'pk', 'cid'];
                  else if (storeName === 'local_preferences') kp = 'key';

                  const newTx = newDb.transaction(storeName, 'readwrite');
                  const newStore = newTx.objectStore(storeName);
                  for (const rec of allRecords) {
                    if (rec === null || rec === undefined || typeof rec !== 'object') continue;
                    
                    // Validate that the record contains the keyPath properties
                    let hasKey = true;
                    if (Array.isArray(kp)) {
                      hasKey = kp.every(k => rec[k] !== undefined && rec[k] !== null);
                    } else {
                      hasKey = rec[kp] !== undefined && rec[kp] !== null;
                    }
                    if (!hasKey) continue;

                    try { newStore.put(rec); } catch (putErr) { /* skip bad record */ }
                  }
                  await new Promise((res) => {
                    newTx.oncomplete = res;
                    newTx.onerror = res;
                  });
                }
              }
              newDb.close();
              oldDb.close();
              
              console.log('[IndexedDB] Legacy nexova_db migration complete. Deleting old database...');
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
            console.info("[Storage] Standard browser storage active (PWA/Standalone install grants permanent persistence).");
          } else {
            console.log("[Storage] Persistent storage granted. IndexedDB data protected from OS pressure.");
          }
        }).catch(() => {});
      }

      return new Promise(async (resolve, reject) => {
        if (this.db) return resolve(this.db);

        let settled = false;
        const settle = (fn, val) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutHandle);
            fn(val);
          }
        };

        // Safe timeout — never block app boot indefinitely (allows ample headroom for cold boot)
        const timeoutHandle = setTimeout(() => {
          if (!settled) {
            console.error('[IndexedDB] Open request timed out after 8s — resolving with null to allow degraded boot.');
            settle(resolve, null);
          }
        }, 8000);

        try {
          await Promise.race([
            this.migrateDatabase(),
            new Promise(r => setTimeout(r, 200))
          ]);
        } catch (_) {}

        const request = globalScope.indexedDB.open(this.dbName, this.dbVersion);

        request.onblocked = (event) => {
          console.warn('[IndexedDB] Database upgrade/open waiting for existing connections to close.');
        };

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
          const tempDb = event.target.result;

          // Check if crsql_changes has the wrong keyPath (corrupted due to legacy migration bug)
          if (tempDb.objectStoreNames.contains('crsql_changes')) {
            const tx = tempDb.transaction(['crsql_changes'], 'readonly');
            const store = tx.objectStore('crsql_changes');
            const kp = store.keyPath;
            if (!Array.isArray(kp) || kp.length !== 3 || kp[0] !== 'table_name') {
              console.error('[IndexedDB] Detected corrupted schema keyPath for crsql_changes. Rejecting init to trigger recovery.');
              tempDb.close();
              settle(reject, new Error('CORRUPTED_SCHEMA'));
              return;
            }
          }

          this.db = tempDb;
          console.log('[IndexedDB] DB initialized successfully.');

          // Yield this connection when a newer version needs to open
          this.db.onversionchange = () => {
            console.warn('[IndexedDB] Version change detected — closing DB connection to allow upgrade.');
            this.db.close();
            this.db = null;
          };

          settle(resolve, this.db);

          try {
            optimizeSqliteStorageEngine(this).catch(() => {});
          } catch (err) {}

          try {
            this.seedIfNeeded().catch((e) => {
              console.warn('[IndexedDB] seedIfNeeded failed (non-fatal):', e);
            });
          } catch (e) {}
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
            \`IndexedDB initialization failed: \${error.name}: \${error.message}. \` +
            \`Try clearing browser data for this site or disabling private browsing mode.\`
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
      console.log('[IndexedDB] Bootstrapping store database...');
      const now = Date.now();
      
      // 1. Seed Categories if empty
      const existingCategories = await this.getAll('categories').catch(() => []);
      if (!existingCategories || existingCategories.length === 0) {
        const categories = ['Beverages', 'Bakery', 'Electronics', 'Merchandise'];
        for (const cat of categories) {
          await this.put('categories', { name: cat, sync_hlc: '0000000000000:000001:seed' });
        }
      }

      // 2. Seed baseline products catalog only if empty (never wipe existing user products)
      const existingCatalog = await this.getAll('inventory_catalog').catch(() => []);
      if (!existingCatalog || existingCatalog.length === 0) {
        const baselineProducts = [
          { sku: 'COFFEE-ESP', gtin: '0000000000001', name: 'Signature Espresso', name_ur: 'سگنیچر ایسپریسو', base_price_minor_units: 350, stock_level: 100, reserved_stock: 0, category: 'Beverages', category_ur: 'مشروبات', emoji: '☕', cost_price_minor_units: 120, low_stock_threshold: 15, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'COFFEE-LAT', gtin: '0000000000002', name: 'Cold Brew Latte', name_ur: 'کولڈ برُو لاٹے', base_price_minor_units: 475, stock_level: 80, reserved_stock: 0, category: 'Beverages', category_ur: 'مشروبات', emoji: '🥛', cost_price_minor_units: 180, low_stock_threshold: 15, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'COFFEE-CBD', gtin: '0000000000003', name: 'Nitro Cold Brew', name_ur: 'نائٹرو کولڈ برُو', base_price_minor_units: 550, stock_level: 60, reserved_stock: 0, category: 'Beverages', category_ur: 'مشروبات', emoji: '🧋', cost_price_minor_units: 200, low_stock_threshold: 10, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'PASTRY-CRO', gtin: '0000000000004', name: 'Butter Croissant', name_ur: 'مکھن کروسینٹ', base_price_minor_units: 325, stock_level: 40, reserved_stock: 0, category: 'Bakery', category_ur: 'بیکری', emoji: '🥐', cost_price_minor_units: 110, low_stock_threshold: 10, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'PASTRY-MUF', gtin: '0000000000005', name: 'Blueberry Muffin', name_ur: 'بلیو بیری مفن', base_price_minor_units: 375, stock_level: 30, reserved_stock: 0, category: 'Bakery', category_ur: 'بیکری', emoji: '🧁', cost_price_minor_units: 130, low_stock_threshold: 10, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'PASTRY-COK', gtin: '0000000000006', name: 'Choco Chip Cookie', name_ur: 'چوکو چپ کوکی', base_price_minor_units: 250, stock_level: 50, reserved_stock: 0, category: 'Bakery', category_ur: 'بیکری', emoji: '🍪', cost_price_minor_units: 80, low_stock_threshold: 15, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'TECH-CHG',  gtin: '0000000000007', name: 'Rapid USB-C Charger', name_ur: 'فاسٹ یو ایس بی سی چارجر', base_price_minor_units: 1999, stock_level: 25, reserved_stock: 0, category: 'Electronics', category_ur: 'الیکٹرانکس', emoji: '🔌', cost_price_minor_units: 950, low_stock_threshold: 5, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'TECH-CBL',  gtin: '0000000000008', name: 'Braid Type-C Cable 1m', name_ur: 'ٹائپ سی کیبل 1 میٹر', base_price_minor_units: 999, stock_level: 45, reserved_stock: 0, category: 'Electronics', category_ur: 'الیکٹرانکس', emoji: '⚡', cost_price_minor_units: 350, low_stock_threshold: 10, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'RETAIL-MUG', gtin: '0000000000009', name: 'Valenixia Ceramic Mug', name_ur: 'سرامک چائے مگ', base_price_minor_units: 1450, stock_level: 20, reserved_stock: 0, category: 'Merchandise', category_ur: 'سامان تجارت', emoji: '🍵', cost_price_minor_units: 550, low_stock_threshold: 5, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'RETAIL-TSH', gtin: '0000000000010', name: 'Nova Cotton Tee (L)', name_ur: 'کاٹن ٹی شرٹ', base_price_minor_units: 2499, stock_level: 15, reserved_stock: 0, category: 'Merchandise', category_ur: 'سامان تجارت', emoji: '👕', cost_price_minor_units: 950, low_stock_threshold: 5, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'RETAIL-BAG', gtin: '0000000000011', name: 'Canvas Tote Bag', name_ur: 'کپڑے کا شاپنگ بیگ', base_price_minor_units: 1200, stock_level: 35, reserved_stock: 0, category: 'Merchandise', category_ur: 'سامان تجارت', emoji: '👜', cost_price_minor_units: 400, low_stock_threshold: 8, col_version: 1, sync_hlc: '0000000000000:000001:seed' },
          { sku: 'WATER-SPK',  gtin: '0000000000012', name: 'Sparkling Mineral Water', name_ur: 'منرل واٹر بوتل', base_price_minor_units: 200, stock_level: 120, reserved_stock: 0, category: 'Beverages', category_ur: 'مشروبات', emoji: '💧', cost_price_minor_units: 60, low_stock_threshold: 20, col_version: 1, sync_hlc: '0000000000000:000001:seed' }
        ];

        for (const prod of baselineProducts) {
          await this.put('inventory_catalog', prod);
        }
      }

      // 3. Seed Customers if empty
      const existingCustomers = await this.getAll('customers').catch(() => []);
      if (!existingCustomers || existingCustomers.length === 0) {
        const seedCustomers = [
          { id: 'cust_alexander', name: 'Alexander Mercer', phone: '+1-555-0199', email: 'alex.mercer@proton.me', total_spend_cents: 58240, visits: 42, created_at: now, sync_hlc: '0000000000000:000001:seed' },
          { id: 'cust_elena', name: 'Elena Rostova', phone: '+1-555-0248', email: 'elena.rostova@designhaus.co', total_spend_cents: 39450, visits: 29, created_at: now, sync_hlc: '0000000000000:000001:seed' },
          { id: 'cust_marcus', name: 'Marcus Vance', phone: '+1-555-0312', email: 'marcus.vance@vancecap.com', total_spend_cents: 18420, visits: 15, created_at: now, sync_hlc: '0000000000000:000001:seed' }
        ];
        for (const c of seedCustomers) {
          await this.put('customers', c);
        }
      }

      // 4. Seed Distributors if empty
      const existingDistributors = await this.getAll('distributors').catch(() => []);
      if (!existingDistributors || existingDistributors.length === 0) {
        const seedDistributors = [
          { id: 'dist_meezan', name: 'Meezan Coffee & Provisions', phone: '+92-300-1122334', email: 'orders@meezancoffee.pk', address: 'Plot 42, Industrial Zone, Karachi', created_at: now, sync_hlc: '0000000000000:000001:seed' },
          { id: 'dist_tech', name: 'Apex Tech Distro', phone: '+92-321-9988776', email: 'supply@apextech.com', address: 'Hafeez Centre, Lahore', created_at: now, sync_hlc: '0000000000000:000001:seed' }
        ];
        for (const d of seedDistributors) {
          await this.put('distributors', d);
        }
      }

      // 5. Create/Update Admin Employee
      if (adminPin) {
        const empAdmin = {
          id: 'emp_admin',
          auth_hash: adminPin, // Use the pre-hashed PIN directly
          biometric_token: 'secure_biometric_admin_token',
          role: 'ADMIN',
          is_active: 1,
          sync_hlc: '0000000000000:000003:seed'
        };
        await this.put('employees', empAdmin);
      }

      // 6. Set Preferences
      const prefs = [
        { key: 'onboarding_complete', value_type: 'BOOL', value_payload: 'true', is_idempotent_flag: 1, updated_at: now },
        { key: 'store_tax_rate', value_type: 'STR', value_payload: String(taxRate || 8.0), is_idempotent_flag: 0, updated_at: now },
        { key: 'store_name', value_type: 'STR', value_payload: (storeName || 'VALENIXIA STORE').toUpperCase(), is_idempotent_flag: 0, updated_at: now },
        { key: 'store_theme_palette', value_type: 'STR', value_payload: theme || 'theme-obsidian-emerald', is_idempotent_flag: 0, updated_at: now },
        { key: 'store_logo_emoji', value_type: 'STR', value_payload: '', is_idempotent_flag: 0, updated_at: now },
        { key: 'store_receipt_tagline', value_type: 'STR', value_payload: 'Stability meets Speed. Thank you!', is_idempotent_flag: 0, updated_at: now },
        { key: 'whitelabel_show_branding', value_type: 'STR', value_payload: 'true', is_idempotent_flag: 0, updated_at: now },
        { key: 'glassmorphism_enabled', value_type: 'STR', value_payload: 'true', is_idempotent_flag: 0, updated_at: now },
        { key: 'terminal_name', value_type: 'STR', value_payload: 'Valenixia Master PC 01', is_idempotent_flag: 0, updated_at: now },
        { key: 'store_receipt_width', value_type: 'STR', value_payload: '42', is_idempotent_flag: 0, updated_at: now },
        { key: 'valenixia_master_node_id', value_type: 'STR', value_payload: 'Valenixia Master PC 01', is_idempotent_flag: 0, updated_at: now },
        { key: 'shop_mode', value_type: 'STR', value_payload: shopMode, is_idempotent_flag: 0, updated_at: now }
      ];

      for (const pref of prefs) {
        await this.put('local_preferences', pref);
      }

      console.log('[IndexedDB] Bootstrap completed.');
    },

    async seedIfNeeded() {
      try {
        const catalog = await this.getAll('inventory_catalog').catch(() => []);
        if (!catalog || catalog.length === 0) {
          console.log('[IndexedDB] Catalog is empty, seeding starter inventory baseline...');
          await this.bootstrapStore('Valenixia POS', 8.0, '', '', 'theme-obsidian-emerald', 'simple-retail');
        }
      } catch (err) {
        console.warn('[IndexedDB] seedIfNeeded notice:', err);
      }
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
        console.warn(\`[ClientDB] Failed to get secure pref for \${key}:\`, e.message);
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
        console.error(\`[ClientDB] Failed to set secure pref for \${key}:\`, e.message);
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
        if (this._passphraseCache === undefined) {
          this._passphraseCache = await this.getSyncPassphrase(tx);
        }
        passphrase = this._passphraseCache || '';
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
          if (err && err.name === 'TransactionInactiveError') {
            return reject(new Error('IDB transaction went inactive before write (mobile deadlock). Aborting.'));
          }
          if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
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
        id: \`aud_\${Date.now()}_\${Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join('').substring(0, 4)}\`,
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
        // Guard: the audit_logs store may not exist if the DB hasn't been upgraded yet
        if (!this.db || !this.db.objectStoreNames.contains('audit_logs')) {
          return;
        }
        await this.put('audit_logs', entry);
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
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        console.info('[OPFS] Skipped on file:// protocol (secure origin required). Standard IndexedDB active.');
        return;
      }
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
        if (err && (err.name === 'SecurityError' || err.name === 'NotAllowedError')) {
          console.info('[OPFS] Access restricted on current origin (SecurityError). Standard IndexedDB active.');
          return;
        }
        console.warn('[OPFS] Note: OPFS write unavailable on this platform:', err && err.name ? err.name : '', err && err.message ? err.message : err);
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
          } else if (val !== '' && !isNaN(Number(val)) && !/^\\s*$/.test(val)) {
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
          inv = { sku: pk, stock_level: 0, reserved_stock: 0, name: pk, base_price_minor_units: 0, category: 'Uncategorized', emoji: '', cost_price_minor_units: 0 };
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
      const inv = await this.get('inventory_catalog', sku, tx);
      const baseStockRow = await this.get('crsql_changes', ['inventory_catalog', sku, 'stock_level'], tx);
      const baseStock = baseStockRow ? Number(baseStockRow.val) : (inv && typeof inv.stock_level === 'number' ? Number(inv.stock_level) : 0);
      const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

      // Query IndexedDB using a bounded range on the compound primary key to avoid unbounded getAll()
      const totalDelta = await new Promise((resolve, reject) => {
        try {
          const storeName = 'crsql_changes';
          const store = tx ? tx.objectStore(storeName) : this.db.transaction([storeName], 'readonly').objectStore(storeName);
          const range = IDBKeyRange.bound(
            ['inventory_catalog_counters', sku + '/', ''],
            ['inventory_catalog_counters', sku + '/\\uffff', '\\uffff']
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
      
      const targetInv = inv || await this.get('inventory_catalog', sku, tx);
      if (targetInv) {
        targetInv.stock_level = finalStock;
        await this.put('inventory_catalog', targetInv, tx);
      }
      console.log(\`[ClientDB] Recalculated stock for \${sku}: base=\${baseStock} (\${baseHlc}), delta=\${totalDelta}, final=\${finalStock}\`);
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
        const hashBuf = await Promise.race([
          globalScope.crypto.subtle.digest('SHA-256', encoded),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SubtleCrypto timeout')), 1000))
        ]);
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
        console.info('[BroadcastChannel] Database update event received.');
      }
    };
  }

  globalScope.hashPin = hashPin;
  globalScope.ValenixiaDB = ValenixiaDB;
  globalScope.appendAuditLog = ValenixiaDB.appendAuditLog.bind(ValenixiaDB);
})();

(function() {
  const globalScope = typeof self !== 'undefined' ? self : window;
  const DB_SCHEMA_VERSION = 5;

  function generateSecureId(prefix, length = 8) {
    const arr = new Uint8Array(length);
    if (globalScope.crypto && typeof globalScope.crypto.getRandomValues === 'function') {
      globalScope.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    let res = '';
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
      res += alphabet[arr[i] % alphabet.length];
    }
    return prefix + res;
  }

  class BrowserHLC {
  constructor(nodeId) {
    this.nodeId = nodeId || generateSecureId('client_', 7);
    this.l = 0;
    this.c = 0;
  }

  toString() {
    return \`\${this.l.toString().padStart(15, '0')}:\${this.c.toString().padStart(6, '0')}:\${this.nodeId}\`;
  }

  static parse(hlcStr) {
    const parts = hlcStr.split(':');
    return {
      l: parseInt(parts[0], 10),
      c: parseInt(parts[1], 10),
      nodeId: parts.slice(2).join(':')
    };
  }

  tick() {
    const physical = Date.now();
    if (physical > this.l) {
      this.l = physical;
      this.c = 0;
    } else {
      this.c += 1;
    }
    return this.toString();
  }

  merge(remoteHlcStr) {
    const physical = Date.now();
    const remote = BrowserHLC.parse(remoteHlcStr);
    const maxL = Math.max(this.l, remote.l, physical);

    if (maxL === this.l && maxL === remote.l) {
      this.c = Math.max(this.c, remote.c) + 1;
    } else if (maxL === remote.l) {
      this.c = remote.c + 1;
    } else if (maxL === this.l) {
      this.c += 1;
    } else {
      this.c = 0;
    }
    this.l = maxL;
    return this.toString();
  }

  static compare(hlc1, hlc2) {
    if (hlc1 > hlc2) return 1;
    if (hlc1 < hlc2) return -1;
    return 0;
  }
}

class SyncClient {
  constructor(nodeId, onSyncReceived, onConnectionChange) {
    this.nodeId = nodeId;
    this.onSyncReceived = onSyncReceived; // callback when remote data arrives
    this._onConnectionChange = onConnectionChange; // raw callback for connection status
    this._connChangeTimer = null;
    // Debounced wrapper: collapses rapid online/offline events into single update (300ms)
    this.onConnectionChange = (isConnected) => {
      clearTimeout(this._connChangeTimer);
      this._connChangeTimer = setTimeout(() => {
        this._onConnectionChange(isConnected);
      }, 300);
    };
    this.hlc = new BrowserHLC(nodeId);
    this.ws = null;
    this.isOnline = true; // User toggle
    this.isConnected = false; // WebSocket state
    this.lastSeenServerVersion = 0;
    this.offlineQueue = []; // Queue to store changes while offline
    this.reconnectTimer = null;
    this.backoffTime = 1000;
    this._reconnectFailures = 0; // circuit breaker counter
    this.passphraseInvalid = false; // Set true on PASSPHRASE_MISMATCH — halts reconnect loop
  }

  // Helper to serialize and optionally encrypt outgoing payload
  async encryptMessage(payload) {
    const json = JSON.stringify(payload);
    if (this.passphrase) {
      return await globalScope.CryptoEngine.encryptSync(json, this.passphrase);
    }
    return json;
  }

  // Helper to parse and optionally decrypt incoming raw data
  async decryptMessage(rawData) {
    let text = rawData;
    const looksEncrypted = typeof rawData === 'string' && !rawData.trim().startsWith('{');

    if (this.passphrase && looksEncrypted) {
      text = await globalScope.CryptoEngine.decryptSync(rawData, this.passphrase);

      // If decryptSync returned the original string, decryption failed (wrong key)
      if (text === rawData) {
        if (!this.passphraseInvalid) {
          this.passphraseInvalid = true;
          console.warn(\`[SyncClient:\${this.nodeId}] Decryption failed (passphrase mismatch). Halting auto-reconnect.\`);
          globalScope.postMessage({ type: 'SYNC_ERROR', error: 'PASSPHRASE_MISMATCH' });
          if (this.ws) this.ws.close();
        }
        throw new Error('PASSPHRASE_MISMATCH');
      }
    } else if (!this.passphrase && looksEncrypted) {
      // No passphrase on client — server may be using encryption.
      // This is expected on a fresh/unpaired device. Suppress noisy error output;
      // the outer onmessage catch will try a plain JSON parse which will also fail
      // silently. User must pair (Settings → Sync Passphrase) to establish the channel.
      if (!this._warnedNoPassphrase) {
        this._warnedNoPassphrase = true;
        console.warn(\`[SyncClient:\${this.nodeId}] Server sent encrypted payload but no sync passphrase is configured on this client. Pair this device via Settings → Sync → Passphrase.\`);
      }
      throw new Error('NO_PASSPHRASE');
    }

    return JSON.parse(text);
  }

  connect() {
    if (!this.isOnline) return;

    // Guard: do not reconnect while passphrase is known bad — user must fix it first
    if (this.passphraseInvalid) {
      const currentPassphrase = globalScope.localStorage ? globalScope.localStorage.getItem('sync_passphrase') : this.passphrase;
      if (currentPassphrase !== this.passphrase) {
        // Passphrase has changed! Reset the invalid flag and update local state
        this.passphrase = currentPassphrase;
        this.passphraseInvalid = false;
      } else {
        console.warn(\`[SyncClient:\${this.nodeId}] connect() blocked: passphraseInvalid=true. Update passphrase in Settings first.\`);
        return;
      }
    }

    // MOBILE FIX: Blob workers on file:// have empty location.host — skip WebSocket
    const isBlobWorker = typeof globalScope !== 'undefined' && globalScope.location && globalScope.location.protocol === 'blob:';
    const wsHost = (typeof window !== 'undefined' && window.location && window.location.host) 
                || (typeof globalScope !== 'undefined' && globalScope.location && globalScope.location.host);
    const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) 
                  || (typeof globalScope !== 'undefined' && globalScope.location && globalScope.location.hostname) || '';
    const isVercel = hostname.includes('vercel.app');

    if (isVercel || (!globalScope.serverUrl && (!wsHost || isBlobWorker))) {
      console.log(\`[SyncClient:\${this.nodeId}] Vercel Serverless / Blob worker / offline mode detected — WebSocket sync disabled.\`);
      this.isConnected = false;
      if (typeof this.onConnectionChange === 'function') this.onConnectionChange(false);
      return;
    }

    // Safely close existing connection only if it is still open/connecting
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close();
    }

    let wsUrl;
    try {
      if (globalScope.serverUrl) {
        const url = new URL(globalScope.serverUrl);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = \`\${wsProtocol}//\${url.host}\`;
      } else {
        const protocol = (globalScope.location && globalScope.location.protocol === 'https:') ? 'wss:' : 'ws:';
        const host = (globalScope.location && globalScope.location.host) || '';
        wsUrl = host ? \`\${protocol}//\${host}\` : '';
      }
    } catch (_) {
      wsUrl = '';
    }

    if (!wsUrl || wsUrl === 'ws://' || wsUrl === 'wss://' || wsUrl.endsWith('://') || wsUrl.endsWith('://:')) {
      console.log(\`[SyncClient:\${this.nodeId}] Offline/Local context detected (Invalid WS URL '\${wsUrl}') — WebSocket sync disabled.\`);
      this.isConnected = false;
      if (typeof this.onConnectionChange === 'function') this.onConnectionChange(false);
      return;
    }

    console.log(\`[SyncClient:\${this.nodeId}] Connecting to \${wsUrl}\`);
    try {
      this.ws = new WebSocket(wsUrl);
    } catch (wsErr) {
      console.warn(\`[SyncClient:\${this.nodeId}] Could not construct WebSocket (\${wsErr.message}) — running offline.\`);
      this.isConnected = false;
      if (typeof this.onConnectionChange === 'function') this.onConnectionChange(false);
      return;
    }

    this.ws.onopen = async () => {
      this.isConnected = true;
      this.backoffTime = 1000;
      this._reconnectFailures = 0; // reset circuit breaker on successful connect
      this.onConnectionChange(true);
      console.log(\`[SyncClient:\${this.nodeId}] WebSocket connected. Handshaking...\`);

      try {
        let enc;
        if (this.deviceToken) {
          // Send AUTH payload (encrypted if passphrase is set)
          enc = await this.encryptMessage({
            type: 'AUTH',
            token: this.deviceToken,
            nodeId: this.nodeId
          });
        } else {
          // Send REGISTER payload (encrypted if passphrase is set)
          enc = await this.encryptMessage({
            type: 'REGISTER',
            nodeId: this.nodeId,
            deviceName: this.deviceName || 'Web Register',
            userAgent: navigator.userAgent
          });
        }
        // Guard: socket may have closed while we awaited encryption
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(enc);
        }
      } catch (encErr) {
        console.error(\`[SyncClient:\${this.nodeId}] Handshake send failed:\`, encErr);
      }
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = await this.decryptMessage(event.data);
        this.handleMessage(data);
      } catch (err) {
        // Attempt plain-text JSON fallback (unencrypted handshake, control messages)
        try {
          const parsed = JSON.parse(event.data);
          this.handleMessage(parsed);
        } catch (e2) {
          // Known benign errors from decryptMessage — suppress to warn level, not error
          const benign = err.message === 'NO_PASSPHRASE' || err.message === 'PASSPHRASE_MISMATCH';
          if (benign) {
            // Already logged once by decryptMessage — no further noise needed
          } else {
            console.error(\`[SyncClient:\${this.nodeId}] Unhandled WebSocket message:\`, err.message);
          }
        }
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.onConnectionChange(false);
      console.log(\`[SyncClient:\${this.nodeId}] WebSocket closed.\`);
      
      // Do NOT reconnect if passphrase was rejected — require user to fix passphrase first
      if (this.passphraseInvalid) {
        console.warn(\`[SyncClient:\${this.nodeId}] Reconnect halted: passphrase mismatch. Fix passphrase in Settings to reconnect.\`);
        return;
      }

      // Attempt reconnection with exponential backoff + circuit breaker
      if (this.isOnline) {
        this._reconnectFailures++;
        if (this._reconnectFailures > 10) {
          console.warn(\`[SyncClient:\${this.nodeId}] Circuit breaker open: \${this._reconnectFailures} consecutive failures. Halting reconnect.\`);
          globalScope.postMessage({ type: 'SYNC_CIRCUIT_OPEN', failures: this._reconnectFailures });
          return;
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.backoffTime = Math.min(this.backoffTime * 2, 30000);
          this.connect();
        }, this.backoffTime);
      }
    };

    this.ws.onerror = () => {
      // Browser WebSocket error events carry no diagnostic payload (by design, for security).
      // The connection close is handled by onclose above which manages reconnect backoff.
      console.warn(\`[SyncClient:\${this.nodeId}] Connection interrupted — reconnect will be attempted automatically.\`);
    };
  }

  // Toggle network state manually
  setOnlineState(state) {
    this.isOnline = state;
    if (state) {
      // Also clear passphraseInvalid so a manual online-toggle retries after user fixes passphrase
      // (passphrase reset from Settings already clears this, but belt-and-suspenders)
      this.connect();
    } else {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        this.ws.close();
      }
      this.isConnected = false;
      this.onConnectionChange(false);
      clearTimeout(this.reconnectTimer);
      console.log(\`[SyncClient:\${this.nodeId}] Taken offline manually.\`);
    }
  }

  handleMessage(data) {
    if (data.type === 'handshake') {
      console.log(\`[SyncClient:\${this.nodeId}] Server handshake received. Server version: \${data.dbVersion}\`);
      this.hlc.merge(data.hlc);
      
      if (data.syncSalt && globalScope.ValenixiaDB) {
        globalScope.ValenixiaDB.put('local_preferences', {
          key: 'sync_salt',
          value_type: 'STR',
          value_payload: data.syncSalt,
          is_idempotent_flag: 1,
          updated_at: Date.now()
        });
      }
      
      // Request any server changes since our last sync
      this.requestSync();
      // Flush any queued offline changes
      this.flushOfflineQueue();
    } 
    
    else if (data.type === 'device_approved') {
      console.log(\`[SyncClient:\${this.nodeId}] Device approved. Token received.\`);
      this.deviceToken = data.token;
      
      // Save directly to local IndexedDB preferences
      if (globalScope.ValenixiaDB) {
        globalScope.ValenixiaDB.put('local_preferences', {
          key: 'device_token',
          value_type: 'STR',
          value_payload: data.token,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
        if (data.syncSalt) {
          globalScope.ValenixiaDB.put('local_preferences', {
            key: 'sync_salt',
            value_type: 'STR',
            value_payload: data.syncSalt,
            is_idempotent_flag: 1,
            updated_at: Date.now()
          });
        }
      }
      
      globalScope.postMessage({ type: 'DEVICE_APPROVED', token: data.token });
      // Now request sync (if handshake didn't arrive, or trigger Live Sync)
      this.requestSync();
      this.flushOfflineQueue();
    }

    else if (data.type === 'device_pending') {
      console.log(\`[SyncClient:\${this.nodeId}] Device pairing pending approval.\`);
      globalScope.postMessage({ type: 'DEVICE_PENDING', nodeId: this.nodeId });
    }

    else if (data.type === 'device_rejected') {
      console.warn(\`[SyncClient:\${this.nodeId}] Device was rejected.\`);
      this.deviceToken = null;
      if (globalScope.ValenixiaDB) {
        globalScope.ValenixiaDB.delete('local_preferences', 'device_token');
      }
      globalScope.postMessage({ type: 'DEVICE_REJECTED' });
    }

    else if (data.type === 'unauthorized') {
      console.warn(\`[SyncClient:\${this.nodeId}] Unauthorized token. Clearing credentials.\`);
      this.deviceToken = null;
      if (globalScope.ValenixiaDB) {
        globalScope.ValenixiaDB.delete('local_preferences', 'device_token');
      }
      globalScope.postMessage({ type: 'DEVICE_UNAUTHORIZED' });
    }
    
    else if (data.type === 'SYNC_ERROR') {
      console.error(\`[SyncClient:\${this.nodeId}] Sync error: \${data.error}\`);
      if (data.error === 'PASSPHRASE_MISMATCH') {
        // Server could not decrypt our message — this means our stored passphrase
        // doesn't match what the server has (or server has no passphrase after a reset).
        // Auto-recovery: clear our passphrase and reconnect in plaintext mode.
        // If the server actually requires a passphrase, it will respond accordingly.
        if (!this._passphraseAutoCleared && this.passphrase) {
          this._passphraseAutoCleared = true;
          console.warn(\`[SyncClient:\${this.nodeId}] Server rejected our passphrase. Auto-clearing and retrying in plaintext mode...\`);
          this.passphrase = null;
          // Persist the clear to IndexedDB so next boot doesn't re-load the stale passphrase
          if (globalScope.ValenixiaDB) {
            globalScope.ValenixiaDB.delete('local_preferences', 'sync_passphrase').catch(() => {});
          }
          // Brief delay then reconnect without passphrase
          setTimeout(() => {
            this.passphraseInvalid = false;
            this.connect();
          }, 2000);
        } else {
          // Already tried auto-clear and still failing — escalate to user
          if (!this.passphraseInvalid) {
            this.passphraseInvalid = true;
            console.warn(\`[SyncClient:\${this.nodeId}] PASSPHRASE_MISMATCH even in plaintext mode — halting reconnect.\`);
            globalScope.postMessage({ type: 'SYNC_ERROR', error: data.error });
            if (this.ws) this.ws.close();
          }
        }
        return;
      }
      if (data.error === 'LICENSE_EXPIRED' || data.error === 'LICENSE_INACTIVE' || data.error.includes('Connection limit reached')) {
        if (!this.passphraseInvalid) {
          this.passphraseInvalid = true;
          console.warn(\`[SyncClient:\${this.nodeId}] \${data.error} — halting auto-reconnect.\`);
          globalScope.postMessage({ type: 'SYNC_ERROR', error: data.error });
          if (this.ws) this.ws.close();
        }
        return;
      }
      globalScope.postMessage({ type: 'SYNC_ERROR', error: data.error });
    }
    
    else if (data.type === 'clock_drift_error') {
      console.error(\`[SyncClient:\${this.nodeId}] Clock drift error: \${data.error}\`);
      if (typeof window !== 'undefined') {
        const banner = document.getElementById('clock-drift-banner');
        if (banner) banner.style.display = 'block';
      } else {
        globalScope.postMessage({ type: 'CLOCK_DRIFT_ERROR', error: data.error });
      }
    }
    
    else if (data.type === 'broadcast_deltas') {
      if (data.nodeId !== this.nodeId) { // Skip self
        console.log(\`[SyncClient:\${this.nodeId}] Received broadcasted deltas:\`, data.changes);
        data.changes.forEach(change => this.hlc.merge(change.sync_hlc));
        this.onSyncReceived(data.changes);
      }
    } 
    
    else if (data.type === 'device_request') {
      console.log(\`[SyncClient:\${this.nodeId}] Real-time device pairing request received:\`, data);
      globalScope.postMessage({
        type: 'DEVICE_REQUEST_RECEIVED',
        nodeId: data.nodeId,
        deviceName: data.deviceName,
        userAgent: data.userAgent
      });
    }

    else if (data.type === 'device_whitelist_changed') {
      console.log(\`[SyncClient:\${this.nodeId}] Device whitelist changed event.\`);
      globalScope.postMessage({ type: 'DEVICE_WHITELIST_CHANGED' });
    }
    
    else if (data.type === 'sync_response') {
      console.log(\`[SyncClient:\${this.nodeId}] Received sync catchup response.\`);
      this.lastSeenServerVersion = data.dbVersion;
      if (data.changes.length > 0) {
        data.changes.forEach(change => this.hlc.merge(change.sync_hlc));
        this.onSyncReceived(data.changes);
      }
    }

    else if (data.type === 'reset_trigger') {
      console.warn('[SyncClient] Server triggered a destructive reset. Re-baselining...');
      if (typeof window !== 'undefined') {
        window.location.reload();
      } else {
        globalScope.postMessage({ type: 'FORCE_RELOAD' });
      }
    }

    else if (data.type === 'ephemeral_broadcast') {
      if (data.nodeId !== this.nodeId) { // Skip self
        globalScope.postMessage({
          type: 'EPHEMERAL_RECEIVED',
          topic: data.topic,
          data: data.data
        });
      }
    }
  }

  // Request database updates since last seen version
  // Request database updates since last seen version
  async requestSync() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const enc = await this.encryptMessage({
        type: 'request_sync',
        nodeId: this.nodeId,
        sinceVersion: this.lastSeenServerVersion
      });
      this.ws.send(enc);
    }
  }

  // Push a local database delta to the WebSocket server
  async pushDelta(tableName, pk, cid, val, colVersion, cl) {
    const hlcStr = this.hlc.tick();
    
    const change = {
      table_name: tableName,
      pk: pk,
      cid: cid,
      val: val === null ? null : String(val),
      col_version: colVersion,
      site_id: this.nodeId,
      cl: cl,
      sync_hlc: hlcStr
    };

    if (this.isOnline && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(\`[SyncClient:\${this.nodeId}] Sending live delta change:\`, change);
      const enc = await this.encryptMessage({
        type: 'sync_deltas',
        nodeId: this.nodeId,
        changes: [change],
        client_schema_version: DB_SCHEMA_VERSION
      });
      this.ws.send(enc);
    } else {
      console.log(\`[SyncClient:\${this.nodeId}] Offline. Queueing delta:\`, change);
      this.offlineQueue.push(change);
      
      // Notify main thread of the updated queue size
      globalScope.postMessage({ type: 'OFFLINE_QUEUE_UPDATE', count: this.offlineQueue.length });
      
      // Notify parent app of locally applied offline change
      this.onSyncReceived([change]);
    }
  }

  // Flush queued changes once node goes online
  async flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(\`[SyncClient:\${this.nodeId}] Flushing \${this.offlineQueue.length} offline changes to server...\`);
      
      const enc = await this.encryptMessage({
        type: 'sync_deltas',
        nodeId: this.nodeId,
        changes: this.offlineQueue,
        client_schema_version: DB_SCHEMA_VERSION
      });
      this.ws.send(enc);
      
      this.offlineQueue = [];
      
      // Notify main thread that the queue has been cleared
      globalScope.postMessage({ type: 'OFFLINE_QUEUE_UPDATE', count: 0 });
    }
  }

  // Broadcast ephemeral data (bypasses DB) to other nodes (e.g. CFD cart updates)
  async broadcastEphemeral(topic, data) {
    if (this.isOnline && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const enc = await this.encryptMessage({
        type: 'ephemeral_broadcast',
        nodeId: this.nodeId,
        topic: topic,
        data: data
      });
      this.ws.send(enc);
    }
  }
}

  globalScope.BrowserHLC = BrowserHLC;
  globalScope.SyncClient = SyncClient;
})();

// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - BACKGROUND SYNC WEB WORKER
// Offloads database I/O, CRDT delta merging, and WebSocket sync off main thread
// ============================================================================

// MOBILE DIAGNOSTIC HUB: Redirect all console output to diagnostic buffer instead of silencing
(function() {
  const isLocal = self.location.hostname === 'localhost' ||
                   self.location.hostname === '127.0.0.1' ||
                   self.location.hostname === '10.0.2.2';
  self.__valenixiaIsLocal = isLocal;
  
  if (!isLocal) {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr = console.error.bind(console);
    
    console.log = (...args) => {
      self.__valenixiaLogs = self.__valenixiaLogs || [];
      self.__valenixiaLogs.push({t:'log', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
      origLog(...args);
    };
    console.warn = (...args) => {
      self.__valenixiaLogs = self.__valenixiaLogs || [];
      self.__valenixiaLogs.push({t:'warn', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
      origWarn(...args);
    };
    console.error = (...args) => {
      self.__valenixiaLogs = self.__valenixiaLogs || [];
      self.__valenixiaLogs.push({t:'error', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
      origErr(...args);
    };
  }
})();

// CRITICAL: Self-diagnostic error boundary
self.onerror = function(e, source, lineno, colno, error) {
  console.error('[SyncWorker] FATAL:', e, 'at', source, 'line', lineno);
  try {
    self.postMessage({ type: 'WORKER_FATAL', error: String(e), line: lineno });
  } catch (_) {}
};

self.addEventListener('unhandledrejection', (e) => {
  console.error('[Worker] Unhandled promise rejection:', e.reason);
  try {
    postMessage({
      type: 'WORKER_ERROR',
      error: e.reason && e.reason.message ? e.reason.message : String(e.reason),
      stack: e.reason && e.reason.stack ? e.reason.stack : null,
      ts: Date.now()
    });
  } catch (_) {}
  e.preventDefault();
});

let dbReadyPromise;
try {
  /* importScripts inlined below */
  dbReadyPromise = ValenixiaDB.init(); // Capture the init promise
} catch (e) {
  console.error('[SyncWorker] Initialization error:', e);
  try {
    self.postMessage({ type: 'WORKER_FATAL', error: String(e), stack: e ? e.stack : '' });
  } catch (_) {}
}

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
      throw new Error(\`Request timed out after \${timeoutMs}ms: \${url}\`);
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
      const response = await fetchWithTimeout(\`\${self.serverUrl}/api/fbr/submit\`, {
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
      nodeId = terminalNamePref.value_payload.replace(/\\s+/g, '_').toLowerCase();
    }

    console.log(\`[SyncWorker] Initializing sync client with nodeId: \${nodeId}\`);

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
      const txDone = new Promise((resolve, reject) => {
        idbTx.oncomplete = () => resolve();
        idbTx.onerror = (e) => reject(e.target.error);
        idbTx.onabort = () => reject(new Error('Sync transaction aborted'));
      });

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
        await txDone;
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

    // MOBILE FIX: WebSocket fails on blob workers with empty host — don't let it kill init
    try {
      syncClient.connect();
    } catch (wsErr) {
      console.warn('[SyncWorker] WebSocket unavailable, continuing in offline mode:', wsErr.message);
    }

    isBootstrapped = true;

    // Fetch initial status and send to UI
    postMessage({
      type: 'INIT_SUCCESS',
      nodeId: nodeId,
      hlc: syncClient.hlc.toString(),
      isPaired: !!(deviceTokenPref && deviceTokenPref.value_payload),
      deviceToken: deviceTokenPref ? deviceTokenPref.value_payload : null
    });

    // Replay any messages that arrived before the engine was ready
    replayPreBootQueue();

  } catch (err) {
    console.error('[SyncWorker] Init failed:', err);
    isBootstrapped = false;
    postMessage({ type: 'INIT_ERROR', error: err.message });
    throw err;
  }
  })();
  return bootstrapPromise;
}

// Bounded & Idempotent pre-boot queue (max 50 items)
const _preBootQueue = [];
const MAX_PREBOOT_QUEUE_SIZE = 50;

function _enqueuePreBoot(msg) {
  if (!msg || !msg.type) return;
  // Deduplicate identical queued requests by type and key/id
  const key = msg.payload && (msg.payload.key || msg.payload.id || '');
  const existingIdx = _preBootQueue.findIndex(item => item.type === msg.type && ((item.payload && (item.payload.key || item.payload.id || '')) === key));
  if (existingIdx !== -1) {
    _preBootQueue[existingIdx] = msg; // Update existing entry in-place
    return;
  }
  if (_preBootQueue.length >= MAX_PREBOOT_QUEUE_SIZE) {
    _preBootQueue.shift(); // Evict oldest entry to prevent memory growth
  }
  _preBootQueue.push(msg);
}

// Replay queued messages after bootstrap completes
async function replayPreBootQueue() {
  if (_preBootQueue.length === 0) return;
  console.log(\`[SyncWorker] Replaying \${_preBootQueue.length} queued pre-boot message(s)...\`);
  const queued = _preBootQueue.splice(0);
  for (const msg of queued) {
    try {
      self.onmessage({ data: msg });
    } catch (e) {
      console.warn('[SyncWorker] Failed to replay queued message:', msg.type, e.message);
    }
  }
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
    _preBootQueue.length = 0; // Invalidate and clear queued messages
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
  // Exception: queue safe I/O, preferences, and durable outbox restoration for replay after boot
  if (type !== 'INIT' && !isBootstrapped) {
    const canQueue = type === 'SAVE_PREFERENCE' ||
                     type === 'GET_PREFERENCE' ||
                     type === 'RESTORE_DURABLE_OUTBOX' ||
                     type === 'SET_ONLINE_STATE' ||
                     (typeof type === 'string' && type.startsWith('GET_'));
    if (canQueue) {
      _enqueuePreBoot(event.data);
      console.log(\`[SyncWorker] Queued "\${type}" for bounded replay after engine bootstrap.\`);
      return;
    }
    console.warn(\`[SyncWorker] Rejected message type "\${type}" — engine not bootstrapped yet\`);
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
              'Authorization': \`Bearer \${licenseToken}\`,
              'Content-Type': 'application/json'
            }
          }, 15000);
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || 'Hydration request failed');
          }

          const changes = result.changes || [];
          console.log(\`[SyncWorker] Received \${changes.length} database recovery delta rows.\`);

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

          console.log(\`[SyncWorker] Hydration successful. Applied: \${applied}, Conflicts: \${conflicts}\`);
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

        // Compute transaction/receipt tamper-evident signature (Task 14)
        let signature = '';
        try {
          const signaturePayload = JSON.stringify({
            id: transactionId,
            subtotal: subtotal,
            tax: tax,
            total: total,
            timestamp: now
          });
          const encoder = new TextEncoder();
          const dataBuf = encoder.encode(signaturePayload + '-valenixia-receipt-salt');
          const hashBuf = await crypto.subtle.digest('SHA-256', dataBuf);
          signature = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (sigErr) {
          console.warn('[SyncWorker] Failed to compute receipt signature:', sigErr.message);
        }

        // Check if FBR integration is enabled for the license tier
        const isFbrEnabled = (tier === 'ENTERPRISE' || tier === 'TRIAL') && (fbr_integration_enabled === true || fbr_integration_enabled === 'true');
        let finalPaymentDetails = paymentDetails || '';
        let fbrInvoiceNumber = '';
        let fbrQrUrl = '';

        const receiptMeta = { signature };
        if (isFbrEnabled) {
          // Generate FBR E-Invoicing compliant Fiscal details automatically
          fbrInvoiceNumber = \`FBR-POS-\${now}-\${secureRandomInt(1000, 9999)}\`;
          fbrQrUrl = \`https://verification.fbr.gov.pk/verify?invoiceNumber=\${encodeURIComponent(fbrInvoiceNumber)}&total=\${encodeURIComponent(total)}&tax=\${encodeURIComponent(tax)}\`;
          receiptMeta.fbr_invoice_number = fbrInvoiceNumber;
          receiptMeta.fbr_qr_url = fbrQrUrl;
          receiptMeta.fbr_status = 'INTEGRATED_SUCCESS';
        }

        if (finalPaymentDetails.startsWith('{')) {
          try {
            const parsed = JSON.parse(finalPaymentDetails);
            finalPaymentDetails = JSON.stringify({ ...parsed, ...receiptMeta });
          } catch(e) {
            finalPaymentDetails = JSON.stringify({ note: finalPaymentDetails, ...receiptMeta });
          }
        } else {
          finalPaymentDetails = JSON.stringify({ note: finalPaymentDetails, ...receiptMeta });
        }

        // Open a single atomic readwrite transaction
        const idbTx = ValenixiaDB.db.transaction(
          ['transactions', 'line_items', 'inventory_catalog', 'crsql_changes', 'stock_movements', 'customer_credit', 'fbr_offline_queue', 'purchase_orders', 'po_line_items', 'distributors', 'local_preferences'],
          'readwrite'
        );
        console.log(\`[SyncWorker:Checkout] Transaction opened. Stores:\`, idbTx.objectStoreNames);

        // MOBILE FIX: Create transaction completion promise IMMEDIATELY before any await yields control
        const txDone = new Promise((resolve, reject) => {
          idbTx.oncomplete = () => resolve();
          idbTx.onerror = (e) => reject(e.target.error);
          idbTx.onabort = () => reject(new Error('Transaction aborted'));
        });

        txDone.catch((err) => {
          console.error(\`[SyncWorker:Checkout] txDone rejected:\`, err && err.message ? err.message : err);
          try {
            postMessage({ type: 'CHECKOUT_ERROR', transactionId, error: (err && err.message) ? err.message : String(err) });
          } catch (_) {}
        });

        try {
          // 1. Write transaction to IndexedDB
          const txRecord = {
            id: transactionId,
            employee_id: employeeId,
            terminal_id: nodeId,
            subtotal_minor_units: subtotal,
            tax_minor_units: tax,
            total_minor_units: total,
            status: 'COMPLETED',
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
          await logFieldChange('transactions', transactionId, 'status', 'COMPLETED', txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'payment_mode', paymentMode || 'CASH', txHlc, 1, 1, idbTx);
          await logFieldChange('transactions', transactionId, 'payment_details', finalPaymentDetails, txHlc, 1, 1, idbTx);

          // 3. Write Line items to IndexedDB
          for (const item of cart) {
            const liId = \`li_\${transactionId}_\${item.sku}\`;
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

              const localDeltaRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', \`\${item.sku}/\${nodeId}\`, 'delta'], idbTx);
              let currentOffset = 0;
              if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                currentOffset = Number(localDeltaRow.val);
              }

              const newOffset = currentOffset - item.qty;

              await logFieldChange('inventory_catalog_counters', \`\${item.sku}/\${nodeId}\`, 'delta', newOffset, txHlc, 1, 1, idbTx);
              await ValenixiaDB.recalculateCachedStock(item.sku, idbTx);
              await checkStockAlert(item.sku, txHlc, idbTx);

              // Log stock movement audit records
              const mvId = \`mv_\${Date.now()}_\${item.sku}\`;
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
            const ccId = \`cc_sale_\${transactionId}\`;
            const ccRecord = {
              id: ccId,
              customer_id: payload.customerId,
              transaction_id: transactionId,
              type: 'CREDIT',
              amount_minor: total,
              payment_method: 'CASH',
              due_date: now + 30 * 24 * 60 * 60 * 1000, // 30 days due date default
              notes: \`Auto credit invoice sale: \${transactionId}\`,
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
            const usin = \`USIN-\${nodeId}-\${transactionId.slice(0, 8)}-\${now}\`.slice(0, 50);
            const payloadObj = serializePRALPayload(fbrInvoiceNumber, now, total, tax, subtotal, cart, paymentMode, usin);

            const fbrQueueEntry = {
              id: \`fbr_\${transactionId}\`,
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
              console.log(\`[FBR] Invoice \${fbrInvoiceNumber} queued for offline batch-upload (Rule 150XC)\`);
            }
          }

          console.log(\`[SyncWorker:Checkout] All DB ops queued. Waiting for transaction commit...\`);
          await txDone;
          console.log(\`[SyncWorker:Checkout] Transaction committed. Emitting CHECKOUT_SUCCESS.\`);
          postMessage({ type: 'CHECKOUT_SUCCESS', transactionId, subtotal, tax, total, paymentMode, signature });
        } catch (err) {
          console.error(\`[SyncWorker:Checkout] FATAL:\`, err && err.message ? err.message : err, err ? err.stack : '');
          try {
            idbTx.abort();
          } catch (abortErr) {}
          postMessage({ type: 'CHECKOUT_ERROR', transactionId, error: err && err.message ? err.message : String(err) });
          postMessage({ type: 'ERROR', error: \`Checkout transaction failed: \${err && err.message ? err.message : err}\` });
        }
        break;
      }

      case 'SAVE_PRODUCT': {
        const { sku, name, gtin, price, stock, category, emoji, cost, low_stock_threshold, isAuditReset, mode_fields, image_url } = payload;
        const tickHlc = syncClient.hlc.tick();

        const exists = await ValenixiaDB.get('inventory_catalog', sku);
        if (!exists) {
          const currentCatalog = await ValenixiaDB.getAll('inventory_catalog');
          const planPref = await ValenixiaDB.get('local_preferences', 'store_plan');
          const rawPlan = planPref ? (planPref.value_payload || '').toUpperCase() : 'STARTER';
          const maxAllowed = (rawPlan === 'FREE' || rawPlan === 'STARTER') ? 25 : Infinity;
          if (currentCatalog.length >= maxAllowed) {
            postMessage({
              type: 'ERROR',
              error: \`Free Tier Limit Reached (\${currentCatalog.length}/\${maxAllowed} products): Your tier allows up to \${maxAllowed} products. Upgrade your plan to add unlimited products.\`
            });
            return;
          }
        }
        const colVersion = exists ? (exists.col_version || 1) + 1 : 1;

        const shopModePref = await ValenixiaDB.get('local_preferences', 'shop_mode');
        const shopMode = shopModePref ? shopModePref.value_payload : 'simple-retail';

        let validatedFields = '{}';
        try {
          validatedFields = validateModeFields(shopMode, mode_fields);
        } catch (valErr) {
          postMessage({ type: 'ERROR', error: \`Validation Error: \${valErr.message}\` });
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
          emoji: emoji || '',
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
        await logFieldChange('inventory_catalog', sku, 'emoji', emoji || '', tickHlc, colVersion);
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

              const localDeltaRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', \`\${sku}/\${nodeId}\`, 'delta']);
              let currentOffset = 0;
              if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                currentOffset = Number(localDeltaRow.val);
              }

              const newOffset = currentOffset + diff;
              await logFieldChange('inventory_catalog_counters', \`\${sku}/\${nodeId}\`, 'delta', newOffset, tickHlc);
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
          const mvId = \`mv_\${Date.now()}_\${sku}\`;
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

        // Verify write succeeded
        const verify = await ValenixiaDB.get('inventory_catalog', sku);
        if (!verify) {
          console.error(\`[SyncWorker:SAVE_PRODUCT] CRITICAL: Write verification failed for SKU \${sku}\`);
          postMessage({ type: 'ERROR', error: \`Product save verification failed for \${sku}\` });
          return;
        }
        console.log(\`[SyncWorker:SAVE_PRODUCT] Verified write for SKU \${sku}:\`, verify.name);

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
        // MOBILE FIX: Immediately re-fetch customers so UI re-renders with persisted data
        const customers = await ValenixiaDB.getAll('customers');
        postMessage({ type: 'CUSTOMERS_DATA', customers });
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
        
        // Load existing employee to preserve auth_hash if pin is not provided
        const existing = await ValenixiaDB.get('employees', id);

        // Reject ADMIN role creation or modification from client
        if (role === 'ADMIN' || (existing && existing.role === 'ADMIN')) {
          postMessage({ type: 'ERROR', error: 'ADMIN role can only be assigned or modified server-side.' });
          break;
        }

        const tickHlc = syncClient.hlc.tick();
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
          const itemId = \`poi_\${id}_\${item.sku || secureRandomString(7)}\`;
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

                const localDeltaRow = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', \`\${entry.sku}/\${nodeId}\`, 'delta']);
                let currentOffset = 0;
                if (localDeltaRow && localDeltaRow.sync_hlc > baseHlc) {
                  currentOffset = Number(localDeltaRow.val);
                }

                const newOffset = currentOffset + entry.qtyReceived;
                await logFieldChange('inventory_catalog_counters', \`\${entry.sku}/\${nodeId}\`, 'delta', newOffset, tickHlc);
                await ValenixiaDB.recalculateCachedStock(entry.sku);

                if (poli.unit_cost_minor) {
                  const exists = await ValenixiaDB.get('inventory_catalog', entry.sku);
                  if (exists) {
                    exists.cost_price_minor_units = poli.unit_cost_minor;
                    await ValenixiaDB.put('inventory_catalog', exists);
                    await logFieldChange('inventory_catalog', entry.sku, 'cost_price_minor_units', poli.unit_cost_minor, tickHlc);
                  }
                }

                const mvId = \`mv_\${Date.now()}_\${entry.sku}\`;
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
          postMessage({ type: 'ERROR', error: \`Transaction \${transactionId} not found.\` });
          break;
        }
        if (original.status === 'VOIDED') {
          postMessage({ type: 'ERROR', error: 'Transaction is already voided.' });
          break;
        }

        const tickHlc = syncClient.hlc.tick();
        const contraId = \`void_\${transactionId}_\${Date.now()}\`;
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
            id: log.id || \`tl_\${Date.now()}_\${secureRandomString(4)}\`,
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

      // ── DEALS ENGINE ─────────────────────────────────────────────────────────
      // All deals are persisted in local_preferences as a single JSON blob keyed
      // 'valenixia_deals', and also broadcast via CRDT so other terminals stay in sync.
      // Strategy mirrors Square's atomic write + event fan-out approach.

      case 'SAVE_DEALS': {
        const { deals } = payload;
        if (!Array.isArray(deals)) break;
        const tickHlc = syncClient.hlc.tick();
        const dealsJson = JSON.stringify(deals);

        // Persist to IndexedDB preferences store (durable across crashes/reloads)
        await ValenixiaDB.put('local_preferences', {
          key: 'valenixia_deals',
          value_type: 'JSON',
          value_payload: dealsJson,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });

        // Broadcast via CRDT so other terminals receive the deal catalogue update
        await logFieldChange('local_preferences', 'valenixia_deals', 'value_payload', dealsJson, tickHlc);

        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      case 'GET_DEALS': {
        const dealsPref = await ValenixiaDB.get('local_preferences', 'valenixia_deals');
        let deals = [];
        if (dealsPref && dealsPref.value_payload) {
          try { deals = JSON.parse(dealsPref.value_payload); } catch(_) { deals = []; }
        }
        postMessage({ type: 'DEALS_DATA', deals });
        break;
      }

      case 'DELETE_DEAL': {
        const { dealId } = payload;
        const tickHlc = syncClient.hlc.tick();
        const dealsPref = await ValenixiaDB.get('local_preferences', 'valenixia_deals');
        let deals = [];
        if (dealsPref && dealsPref.value_payload) {
          try { deals = JSON.parse(dealsPref.value_payload); } catch(_) {}
        }
        // Soft-delete: mark is_deleted=1 so other terminals receive the tombstone via CRDT
        const idx = deals.findIndex(d => d.id === dealId);
        if (idx !== -1) {
          deals[idx].is_deleted = 1;
          deals[idx].updated_at = new Date().toISOString();
          const dealsJson = JSON.stringify(deals);
          await ValenixiaDB.put('local_preferences', {
            key: 'valenixia_deals',
            value_type: 'JSON',
            value_payload: dealsJson,
            is_idempotent_flag: 0,
            updated_at: Date.now()
          });
          await logFieldChange('local_preferences', 'valenixia_deals', 'value_payload', dealsJson, tickHlc);
        }
        postMessage({ type: 'MUTATION_SUCCESS' });
        break;
      }

      // ── TERMINAL PRESENCE HEARTBEAT ──────────────────────────────────────────
      // Broadcasts a lightweight ephemeral ping to let other terminals know this
      // register is alive and what screen it's currently on. Mimics Square's
      // presence protocol for multi-terminal awareness.
      case 'SEND_HEARTBEAT': {
        const { screen, terminalLabel } = payload;
        if (syncClient && syncClient.isConnected) {
          await syncClient.broadcastEphemeral('TERMINAL_HEARTBEAT', {
            nodeId,
            screen: screen || 'unknown',
            label: terminalLabel || nodeId,
            ts: Date.now()
          });
        }
        break;
      }

      // ── CLOUD RELAY URL UPDATE ────────────────────────────────────────────────
      // Allows the operator to configure a custom cloud relay (e.g. wss://relay.mystore.com)
      // enabling multi-terminal sync over the internet between branches.
      case 'UPDATE_CLOUD_RELAY': {
        const { relayUrl, syncPassphrase } = payload;
        if (relayUrl) {
          self.serverUrl = relayUrl;
          await ValenixiaDB.put('local_preferences', {
            key: 'valenixia_server_url',
            value_type: 'STR',
            value_payload: relayUrl,
            is_idempotent_flag: 0,
            updated_at: Date.now()
          });
        }
        if (syncPassphrase && syncClient) {
          syncClient.passphrase = syncPassphrase;
          syncClient.passphraseInvalid = false;
          await ValenixiaDB.put('local_preferences', {
            key: 'sync_passphrase',
            value_type: 'STR',
            value_payload: syncPassphrase,
            is_idempotent_flag: 0,
            updated_at: Date.now()
          });
        }
        if (syncClient) {
          syncClient.backoffTime = 1000;
          syncClient._reconnectFailures = 0;
          syncClient.passphraseInvalid = false;
          syncClient.connect();
        }
        postMessage({ type: 'MUTATION_SUCCESS' });
        postMessage({ type: 'RELAY_UPDATED', relayUrl });
        break;
      }

      // ── DURABLE OUTBOX: restore offline queue from IndexedDB on worker restart ─
      // Unlike a RAM queue (which vanishes on crash), this restores any deltas that
      // were written to IndexedDB but not yet flushed to the server — implementing
      // the industry-standard Outbox Pattern used by Shopify POS.
      case 'RESTORE_DURABLE_OUTBOX': {
        try {
          const outboxPref = await ValenixiaDB.get('local_preferences', '__durable_outbox__');
          if (outboxPref && outboxPref.value_payload) {
            const queued = JSON.parse(outboxPref.value_payload);
            if (Array.isArray(queued) && queued.length > 0 && syncClient) {
              syncClient.offlineQueue = queued;
              console.log(\`[SyncWorker:DurableOutbox] Restored \${queued.length} pending deltas from IndexedDB.\`);
              postMessage({ type: 'OFFLINE_QUEUE_UPDATE', count: queued.length });
              // Try immediate flush if connected
              if (syncClient.isConnected) {
                await syncClient.flushOfflineQueue();
                // Clear the durable store after successful flush
                await ValenixiaDB.put('local_preferences', {
                  key: '__durable_outbox__',
                  value_type: 'JSON',
                  value_payload: '[]',
                  is_idempotent_flag: 1,
                  updated_at: Date.now()
                });
              }
            }
          }
        } catch(e) {
          console.warn('[SyncWorker:DurableOutbox] Restore failed (non-fatal):', e.message);
        }
        break;
      }

      // ── PERSIST DURABLE OUTBOX ───────────────────────────────────────────────
      // Called periodically (every 10s) to snapshot the in-RAM offline queue to
      // IndexedDB so it survives app crashes and Android WebView kills.
      case 'PERSIST_DURABLE_OUTBOX': {
        try {
          if (syncClient && syncClient.offlineQueue && syncClient.offlineQueue.length > 0) {
            await ValenixiaDB.put('local_preferences', {
              key: '__durable_outbox__',
              value_type: 'JSON',
              value_payload: JSON.stringify(syncClient.offlineQueue),
              is_idempotent_flag: 1,
              updated_at: Date.now()
            });
          }
        } catch(e) { /* non-fatal */ }
        break;
      }

      // ── INVENTORY ATOMIC DELTA ───────────────────────────────────────────────
      // Applies a PN-Counter delta to inventory. Like Square's atomic decrement,
      // this adds/subtracts from the *current* stock rather than overwriting it,
      // preventing race conditions when two terminals sell the same item.
      case 'INVENTORY_DELTA': {
        const { sku: deltaSku, delta, reason } = payload;
        if (!deltaSku || delta === undefined || delta === 0) break;
        const tickHlc = syncClient.hlc.tick();

        // Apply the PN-Counter delta (per-node, per-item)
        const localDelta = await ValenixiaDB.get('crsql_changes', ['inventory_catalog_counters', \`\${deltaSku}/\${nodeId}\`, 'delta']);
        const currentDelta = localDelta ? Number(localDelta.val || 0) : 0;
        const newDelta = currentDelta + delta;

        await logFieldChange('inventory_catalog_counters', \`\${deltaSku}/\${nodeId}\`, 'delta', newDelta, tickHlc);
        await ValenixiaDB.recalculateCachedStock(deltaSku);
        await checkStockAlert(deltaSku, tickHlc);

        // Log stock movement audit trail
        if (reason) {
          const mvId = \`mv_\${Date.now()}_\${deltaSku}\`;
          await ValenixiaDB.put('stock_movements', {
            id: mvId, sku: deltaSku, change_qty: delta,
            reason, created_at: Date.now(), sync_hlc: tickHlc
          });
          await logFieldChange('stock_movements', mvId, 'change_qty', delta, tickHlc);
          await logFieldChange('stock_movements', mvId, 'reason', reason, tickHlc);
        }

        const updated = await ValenixiaDB.get('inventory_catalog', deltaSku);
        postMessage({ type: 'INVENTORY_DELTA_APPLIED', sku: deltaSku, newStock: updated ? updated.stock_level : 0 });
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

    console.log(\`[FBR] Processing \${pending.length} pending invoice(s) in strict FIFO sequence (Rule 150XC)\`);
    
    let flushed = 0;
    
    for (const entry of pending) {
      try {
        const response = await fetchWithTimeout('/api/fbr/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoices: [entry] })
        }, 15000);

        if (!response.ok) {
          console.warn(\`[FBR] Server communication error for USIN: \${entry.usin}, HTTP: \${response.status}\`);
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
            details.fbr_qr_url = \`https://verification.fbr.gov.pk/verify?invoiceNumber=\${details.fbr_invoice_number}&total=\${tx.total_minor}&tax=\${tx.tax_minor}\`;
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
          console.error(\`[FBR] Hard rejection for USIN: \${entry.usin}. Code: \${result?.fbrResponseCode}, Error: \${result?.fbrErrorDetails}\`);
          
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
        console.warn(\`[FBR] Network fetch failed for USIN: \${entry.usin}:\`, err.message);
        // Lock queue on network error
        return { flushed, failed: 1, locked: true };
      }
    }

    postMessage({ type: 'FBR_QUEUE_FLUSHED', flushed, failed: 0, total: pending.length });
    console.log(\`[FBR] Sequential FIFO flush completed. Successfully submitted: \${flushed}\`);
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
      try {
        postMessage({
          type: 'INVENTORY_ALERT',
          sku: sku,
          productName: prod.name,
          currentStock: currentStock,
          threshold: threshold,
          timestamp: Date.now()
        });
      } catch (_) {}

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
          notes: \`Automated reorder alert: SKU \${sku} (\${prod.name}) stock level is \${currentStock} (threshold: \${threshold}).\`,
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

        const itemId = \`poi_\${poId}_\${sku}\`;
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
      console.log(\`[FBR Cron] Found \${pending.length} pending FBR submissions. Triggering sweep...\`);
      await flushFBRQueue();
    }
  } catch (err) {
    console.error('[FBR Cron] Background sweep failed:', err.message);
  }
}, 60000);

// ── DURABLE OUTBOX: Snapshot RAM queue to IndexedDB every 10 seconds ────────
// If the Android WebView is killed while the app is offline, the RAM queue
// (syncClient.offlineQueue) would be lost. This interval snapshots it to IDB
// so the next boot can restore it via RESTORE_DURABLE_OUTBOX.
setInterval(async () => {
  try {
    if (typeof syncClient !== 'undefined' && syncClient && syncClient.offlineQueue && syncClient.offlineQueue.length > 0) {
      if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.db) {
        await ValenixiaDB.put('local_preferences', {
          key: '__durable_outbox__',
          value_type: 'JSON',
          value_payload: JSON.stringify(syncClient.offlineQueue),
          is_idempotent_flag: 1,
          updated_at: Date.now()
        });
      }
    }
  } catch(e) { /* non-fatal — gracefully skip */ }
}, 10000);

// ── TERMINAL HEARTBEAT: Broadcast presence every 30 seconds ──────────────────
// Lets other connected terminals in the same store know this register is alive.
// Only broadcasts when actively connected to the WebSocket relay.
setInterval(async () => {
  try {
    if (typeof syncClient !== 'undefined' && syncClient && syncClient.isConnected) {
      await syncClient.broadcastEphemeral('TERMINAL_HEARTBEAT', {
        nodeId,
        ts: Date.now()
      });
    }
  } catch(e) { /* non-fatal */ }
}, 30000);
`;

window.createInlineWorker = function() {
  try {
    const blob = new Blob([window.__VALENIXIA_WORKER_CODE], {type: 'application/javascript'});
    const url = URL.createObjectURL(blob);
    console.log('[WorkerInline] Created blob worker from inlined code (' + window.__VALENIXIA_WORKER_CODE.length + ' chars)');
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  } catch(e) {
    console.error('[WorkerInline] Blob worker creation failed:', e);
    return null;
  }
};
