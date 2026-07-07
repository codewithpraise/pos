# Nexova POS — Enterprise Local-First Commerce Engine 🌌

Nexova is a zero-trust, masterless, offline-first Point of Sale (POS) system and peer-to-peer sync engine designed for high-volume retail. By combining a **local-first database architecture** with **cryptographic offline licensing** and **asynchronous cloud disaster recovery**, Nexova operates 100% functional under total network partitions while retaining absolute data integrity.

---

## 🛠️ High-Performance Technology Stack

- **Master Desktop Server (Local Node)**:
  - Runtime: Node.js (v18+)
  - DB Engine: SQLite configured in **WAL (Write-Ahead Logging)** mode.
  - Concurrency Lock: `BEGIN IMMEDIATE` transactions with strict column schemas.
  - Sync Hub: WebSockets (`ws` library) broadcasting column-level delta updates.
  - Cloud Backup: Asynchronous disaster recovery daemon powered by `@supabase/supabase-js`.
- **Desktop/Mobile Compose Client (Native)**:
  - Runtime: Compose Multiplatform & Kotlin Multiplatform JVM target.
  - Mobile Discovery: Multicast UDP socket service receiver automatically locating sync server beacons.
- **Visual Interface (Kinetic Flight Deck Client)**:
  - Markup & UI Logic: HTML5, Vanilla CSS3 (HSL variables, spring transitions, glassmorphic styling), and modern ES6 JS.
  - Layout: Responsive clamp-based fluid typography and grid containers.
  - List Performance: Windowed `VirtualList` rendering keeping DOM footprint static for 10k+ catalog sizes.

---

## 🧭 Enterprise System Architecture

### 1. Zero-Cost Offline Licensing & Cryptographic Lockout
- **Hardware Fingerprinting**: Combines canvas rendering, CPU concurrency count, and screen geometry to construct a unique local HWID.
- **Asymmetric Verification**: Validates developer-signed base64 license keys using an Ed25519 public key entirely offline via the WebCrypto SubtleCrypto API.
- **Monotonic Time Anchor**: Writes a secure monotonic time anchor to SQLite on every transaction. Detects and blocks local machine clock rollback attempts instantly.

### 2. PN-Counter CRDT Inventory Integrity
- Decouples simple LWW integer stock levels into Positive-Negative counter columns (`stock_additions` and `stock_subtractions`) to guarantee eventual consistency during asynchronous merges.
- Features real-time stock level reconciliation alerts in the client UI if computed levels drop below zero (Oversell Guard).

### 3. Native WebUSB Thermal Printing & Drawer Lock
- Compiles raw product lists into ESC/POS byte buffers sent directly to USB printers via WebUSB.
- Automatically kicks the cash drawer on transactions, tracks drawer status, and enforces manager PIN validation for audit-logged `NO SALE` openings.

### 4. Capture-Phase HID Burst Scanner Interceptor
- Listens in the window's capture phase, measuring keyboard stream speeds via `performance.now()`.
- Successfully separates hardware barcode scanning from human typing, routing codes to the cart without character leakage into active text fields.

### 5. Bulk CSV Importer (60fps Yielding)
- Custom client-side CSV parser processing lines in 100-item chunks.
- Yields the execution loop to the browser between batches via `setTimeout(0)`, keeping skeleton loader animations responsive at 60fps during massive imports.

### 6. Global Crash Telemetry & Schema Version Negotiation
- Listens for unhandled promise rejections and uncaught exceptions, writing stack traces and user click paths to local IndexedDB logs, and batching uploads to the cloud.
- Rejects outdated client synchronization streams using `SERVER_SCHEMA_VERSION = 3`.

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js installed (v18 or higher recommended).
- A web browser (Google Chrome is recommended for native WebUSB and Web Speech support).

### Installation & Server Launch
1. Open a terminal inside the workspace directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a local `.env` configuration file in the project root:
   ```env
    SUPABASE_URL=https://your_project_id.supabase.co
    SUPABASE_ANON_KEY=your_supabase_anon_key_here
    STORE_TERMINAL_ID=terminal_pc_master
   ```
4. Run `npm start` to launch the SQLite database engine, initialize WAL indexes, and start the local sync hub:
   ```bash
   npm start
   ```
5. Open your browser to `http://localhost:3000`.

### Executing Client Releases
* **Desktop Client**: Compile and run the desktop app using Gradle:
  ```bash
  # Compile and run immediately
  ./gradlew run
  
  # Package the installer/executable for your current OS
  ./gradlew packageDistributionForCurrentOS
  ```
  This generates native installers (MSI/EXE on Windows, DMG/PKG on macOS, DEB/RPM on Linux) under `build/compose/binaries`.
* **Android Client**: Build and run the Android app:
  ```bash
  cd android
  ./gradlew assembleDebug
  ```
  This outputs `app-debug.apk` under `android/app/build/outputs/apk/debug/`. Install this APK on Android registers or tablets.

### Cloud Setup (Disaster Recovery Provisioning)
1. Go to your **Supabase Dashboard** -> **SQL Editor**.
2. Run the DDL migration queries written in [init_disaster_recovery.sql](file:///c:/Users/DELL/Desktop/nexova/supabase/migrations/20260630000000_init_disaster_recovery.sql) to set up remote tables and secure Row Level Security (RLS) rules checking `x-store-id` headers.
3. Test your connection:
  ```bash
  node scripts/test_supabase.js
  ```

---

## ⌨️ POS Keyboard Hotkeys

- `F1`: Execute checkout transaction.
- `F2`: Park/Void active cart (Requires Manager PIN authentication if items exist).
- `F5`: Focus search input bar.
- `F8`: Toggle Speech Coach audio analysis.

---

## ⚙️ Environment Variables

Create a `.env` file in the project root. **Never commit this file.**

```env
PORT=3000
NODE_ENV=production

# Preferred over DB-stored passphrase — set this in production
SYNC_PASSPHRASE=your-strong-passphrase-here

# Supabase Cloud Backup (optional)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
STORE_TERMINAL_ID=my_store_01

LOG_LEVEL=info      # debug | info | warn | error
MAX_BACKUPS=7       # how many rotated backup files to keep
```

---

## 🔐 Security Hardening

- **PBKDF2**: 100,000 iterations, SHA-256, 256-bit key. Keys cached in-memory per session.
- **Android Keystore**: `server_url` stored encrypted via hardware-backed AES-GCM 256-bit keys (`nexova_prefs_key`).
- **Input Validation**: All sensitive endpoints validated via `lib/validator.js` (store name, PIN, passphrase, UUIDs).
- **Circuit Breaker**: Supabase sync halts after 5 consecutive failures, resumes after 60 seconds.
- **val_type Whitelist**: Sync payloads with invalid `val_type` are rejected before upsert.
- **Google Safe Browsing**: Enabled for Android 8.0+ WebView.
- **CSP Headers**: Enforced via Helmet with restrictive `defaultSrc: 'self'`.
- **Crash Logger**: Uncaught exceptions written to `nexova_crash.log` on Android external storage.

---

## 💾 Schema Migrations

Migrations run **automatically** on server startup. Tracked in `local_preferences.schema_version`.

| Version | Changes |
|---|---|
| v1 | Full initial schema (all 17 domain tables) |
| v2 | ALTER TABLE additions: categories, cost price, shift variance, PN-counters, void columns |
| v3 | `val_type` column on `crsql_changes` + dynamic type backfill |

---

## 🔒 Backup & Restore

### Create a Backup
```bash
node scripts/backup.js
```
Saves a live SQLite copy to `backups/nexova_YYYY-MM-DD-HHmmSS.db` (last `MAX_BACKUPS` retained).

### Restore a Backup
```bash
# Stop the server, restore, restart
cp backups/nexova_2026-07-07-120000.db nexova.db
npm start
```
Verify restore via `GET /api/health`.

---

## 🩺 Health Check

```
GET /api/health
```
```json
{
  "status": "ok",
  "database": "connected",
  "sync": { "pendingChanges": 0 },
  "license": "ACTIVE",
  "schemaVersion": 3
}
```

---

## 🧪 Testing

```bash
# Syntax checks
node --check server.js
node --check lib/logger.js
node --check lib/validator.js
node --check scripts/backup.js
node --check supabase-sync.js

# Android compile check
cd android && .\gradlew compileDebugKotlin

# E2E flow tests
node e2e_full_test.js
```

---

## 📁 Key Files

| File | Purpose |
|---|---|
| `server.js` | HTTP + WebSocket core server |
| `database.js` | SQLite wrapper + incremental migrations |
| `supabase-sync.js` | Cloud CRDT backup with circuit-breaker |
| `lib/logger.js` | Zero-dependency structured JSON logger |
| `lib/validator.js` | Zero-dependency input validator + middleware |
| `scripts/backup.js` | SQLite VACUUM INTO backup with rotation |
| `public/client-db.js` | IndexedDB wrapper with type inference |
| `public/client-sync.js` | WebSocket sync client |
| `public/sync-worker.js` | Service worker delta merge |
