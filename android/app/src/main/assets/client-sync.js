(function() {
  const globalScope = typeof self !== 'undefined' ? self : window;

  class BrowserHLC {
  constructor(nodeId) {
    this.nodeId = nodeId || 'client_' + Math.random().toString(36).substring(2, 9);
    this.l = 0;
    this.c = 0;
  }

  toString() {
    return `${this.l.toString().padStart(15, '0')}:${this.c.toString().padStart(6, '0')}:${this.nodeId}`;
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
    this.onConnectionChange = onConnectionChange; // callback for connection status
    this.hlc = new BrowserHLC(nodeId);
    this.ws = null;
    this.isOnline = true; // User toggle
    this.isConnected = false; // WebSocket state
    this.lastSeenServerVersion = 0;
    this.offlineQueue = []; // Queue to store changes while offline
    this.reconnectTimer = null;
    this.backoffTime = 1000;
  }

  // Helper to serialize and optionally encrypt outgoing payload
  async encryptMessage(payload) {
    const json = JSON.stringify(payload);
    if (this.passphrase) {
      return await globalScope.CryptoEngine.encrypt(json, this.passphrase);
    }
    return json;
  }

  // Helper to parse and optionally decrypt incoming raw data
  async decryptMessage(rawData) {
    let text = rawData;
    if (this.passphrase && !rawData.trim().startsWith('{')) {
      text = await globalScope.CryptoEngine.decrypt(rawData, this.passphrase);
    }
    return JSON.parse(text);
  }

  connect() {
    if (!this.isOnline) return;
    
    // Close existing connection if any
    if (this.ws) {
      this.ws.close();
    }

    const protocol = globalScope.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${globalScope.location.host}`;
    
    console.log(`[SyncClient:${this.nodeId}] Connecting to ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = async () => {
      this.isConnected = true;
      this.backoffTime = 1000;
      this.onConnectionChange(true);
      console.log(`[SyncClient:${this.nodeId}] WebSocket connected. Handshaking...`);
      
      if (this.deviceToken) {
        // Send AUTH payload (encrypted if passphrase is set)
        const enc = await this.encryptMessage({
          type: 'AUTH',
          token: this.deviceToken,
          nodeId: this.nodeId
        });
        this.ws.send(enc);
      } else {
        // Send REGISTER payload (encrypted if passphrase is set)
        const enc = await this.encryptMessage({
          type: 'REGISTER',
          nodeId: this.nodeId,
          deviceName: this.deviceName || 'Web Register',
          userAgent: navigator.userAgent
        });
        this.ws.send(enc);
      }
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = await this.decryptMessage(event.data);
        this.handleMessage(data);
      } catch (err) {
        // If decryption fails, try parsing as plaintext (e.g. handshake, device_pending, device_approved, unauthorized)
        try {
          const parsed = JSON.parse(event.data);
          this.handleMessage(parsed);
        } catch (e2) {
          console.error('Error handling WebSocket message:', err);
        }
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.onConnectionChange(false);
      console.log(`[SyncClient:${this.nodeId}] WebSocket closed.`);
      
      // Attempt reconnection with exponential backoff
      if (this.isOnline) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.backoffTime = Math.min(this.backoffTime * 2, 30000);
          this.connect();
        }, this.backoffTime);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[SyncClient] WebSocket error:', err);
    };
  }

  // Toggle network state manually
  setOnlineState(state) {
    this.isOnline = state;
    if (state) {
      this.connect();
    } else {
      if (this.ws) {
        this.ws.close();
      }
      this.isConnected = false;
      this.onConnectionChange(false);
      clearTimeout(this.reconnectTimer);
      console.log(`[SyncClient:${this.nodeId}] Taken offline manually.`);
    }
  }

  handleMessage(data) {
    if (data.type === 'handshake') {
      console.log(`[SyncClient:${this.nodeId}] Server handshake received. Server version: ${data.dbVersion}`);
      this.hlc.merge(data.hlc);
      
      // Request any server changes since our last sync
      this.requestSync();
      // Flush any queued offline changes
      this.flushOfflineQueue();
    } 
    
    else if (data.type === 'device_approved') {
      console.log(`[SyncClient:${this.nodeId}] Device approved. Token received.`);
      this.deviceToken = data.token;
      
      // Save directly to local IndexedDB preferences
      if (globalScope.NexovaDB) {
        globalScope.NexovaDB.put('local_preferences', {
          key: 'device_token',
          value_type: 'STR',
          value_payload: data.token,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
      }
      
      globalScope.postMessage({ type: 'DEVICE_APPROVED', token: data.token });
      // Now request sync (if handshake didn't arrive, or trigger Live Sync)
      this.requestSync();
      this.flushOfflineQueue();
    }

    else if (data.type === 'device_pending') {
      console.log(`[SyncClient:${this.nodeId}] Device pairing pending approval.`);
      globalScope.postMessage({ type: 'DEVICE_PENDING', nodeId: this.nodeId });
    }

    else if (data.type === 'device_rejected') {
      console.warn(`[SyncClient:${this.nodeId}] Device was rejected.`);
      this.deviceToken = null;
      if (globalScope.NexovaDB) {
        globalScope.NexovaDB.delete('local_preferences', 'device_token');
      }
      globalScope.postMessage({ type: 'DEVICE_REJECTED' });
    }

    else if (data.type === 'unauthorized') {
      console.warn(`[SyncClient:${this.nodeId}] Unauthorized token. Clearing credentials.`);
      this.deviceToken = null;
      if (globalScope.NexovaDB) {
        globalScope.NexovaDB.delete('local_preferences', 'device_token');
      }
      globalScope.postMessage({ type: 'DEVICE_UNAUTHORIZED' });
    }
    
    else if (data.type === 'clock_drift_error') {
      console.error(`[SyncClient:${this.nodeId}] Clock drift error: ${data.error}`);
      if (typeof window !== 'undefined') {
        const banner = document.getElementById('clock-drift-banner');
        if (banner) banner.style.display = 'block';
      } else {
        globalScope.postMessage({ type: 'CLOCK_DRIFT_ERROR', error: data.error });
      }
    }
    
    else if (data.type === 'broadcast_deltas') {
      if (data.nodeId !== this.nodeId) { // Skip self
        console.log(`[SyncClient:${this.nodeId}] Received broadcasted deltas:`, data.changes);
        data.changes.forEach(change => this.hlc.merge(change.sync_hlc));
        this.onSyncReceived(data.changes);
      }
    } 
    
    else if (data.type === 'device_request') {
      console.log(`[SyncClient:${this.nodeId}] Real-time device pairing request received:`, data);
      globalScope.postMessage({
        type: 'DEVICE_REQUEST_RECEIVED',
        nodeId: data.nodeId,
        deviceName: data.deviceName,
        userAgent: data.userAgent
      });
    }

    else if (data.type === 'device_whitelist_changed') {
      console.log(`[SyncClient:${this.nodeId}] Device whitelist changed event.`);
      globalScope.postMessage({ type: 'DEVICE_WHITELIST_CHANGED' });
    }
    
    else if (data.type === 'sync_response') {
      console.log(`[SyncClient:${this.nodeId}] Received sync catchup response.`);
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
      console.log(`[SyncClient:${this.nodeId}] Sending live delta change:`, change);
      const enc = await this.encryptMessage({
        type: 'sync_deltas',
        nodeId: this.nodeId,
        changes: [change],
        client_schema_version: DB_SCHEMA_VERSION
      });
      this.ws.send(enc);
    } else {
      console.log(`[SyncClient:${this.nodeId}] Offline. Queueing delta:`, change);
      this.offlineQueue.push(change);
      
      // Notify parent app of locally applied offline change
      this.onSyncReceived([change]);
    }
  }

  // Flush queued changes once node goes online
  async flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[SyncClient:${this.nodeId}] Flushing ${this.offlineQueue.length} offline changes to server...`);
      
      const enc = await this.encryptMessage({
        type: 'sync_deltas',
        nodeId: this.nodeId,
        changes: this.offlineQueue,
        client_schema_version: DB_SCHEMA_VERSION
      });
      this.ws.send(enc);
      
      this.offlineQueue = [];
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
