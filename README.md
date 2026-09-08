# Valenixia POS — Enterprise Local-First Commerce Engine 🌌

Valenixia is a zero-trust, masterless, offline-first Point of Sale (POS) system and peer-to-peer sync engine designed for high-volume retail. By combining a **local-first database architecture** with **cryptographic offline licensing** and **asynchronous cloud disaster recovery**, Valenixia operates 100% functional under total network partitions while retaining absolute data integrity.

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

---

## 💎 Dual-Namespace Device ID & Multi-Store Isolation Architecture

One of the most complex challenges in distributed, local-first retail software is allowing **multiple independent store instances** to operate on the **same physical hardware** (or switching between Web and Native Android apps) without state collision, license leakage, or entitlement corruption.

Valenixia POS implements an advanced **Dual-Namespace Hardware Identification (HWID) & Entitlement Isolation Engine**.

### 1. The Dual-Namespace Fingerprint Partition (`AND-` vs `WEB-`)

Hardware identifiers are divided into two mutually exclusive cryptographic namespaces:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHYSICAL REGISTER HARDWARE                      │
├───────────────────────────────────┬────────────────────────────────────┤
│         NATIVE CONTAINER          │        WEB BROWSER SANDBOX         │
│          (Android App)            │           (PWA / Web)              │
├───────────────────────────────────┼────────────────────────────────────┤
│  Queries AndroidPOS.getDeviceID() │  Store-bound 2D Canvas Seed        │
│  Tied to Android ID / HW Serial   │  + CPU concurrency + Memory + Res  │
│                                   │  + WebCrypto SHA-256 / djb2 Hash   │
├───────────────────────────────────┼────────────────────────────────────┤
│     Namespace: AND-<HEX_ID>       │    Namespace: WEB-<STORE_HASH>     │
└───────────────────────────────────┴────────────────────────────────────┘
```

#### Native Android Architecture (`AND-` Namespace)
- When executing inside the native Android Kotlin shell (Sunmi, iMin, Pax, Android tablets), the JavaScript engine invokes `window.AndroidPOS.getDeviceID()` or `window.Android.getDeviceID()`.
- The native layer extracts the hardware-rooted `Settings.Secure.ANDROID_ID` or telephonic serial number via the Android Keystore.
- The runtime automatically normalizes and prefixes this identifier with `AND-` (e.g., `AND-7C3F81A90B2E`).
- **Advantage**: Impervious to app uninstalls, cache clearing, or APK updates. The register retains its identity permanently.

#### Web Sandbox Architecture (`WEB-` Namespace)
- In standard desktop browsers (Chrome, Edge, Safari), direct hardware serial numbers are blocked by browser sandboxing.
- Instead of using a naive random UUID that gets erased when cookies are cleared, Valenixia generates a **deterministic store-bound fingerprint**:
  1. **Store Identity Ingestion**: Retrieves the active store name (`valenixia_store_name`) and normalizes it (`storeNormalized = storeName.toLowerCase().replace(/[^a-z0-9]/g, '_')`).
  2. **Invisible Canvas 2D Seed**: Renders an off-screen HTML5 Canvas drawing with context font `14px Arial` writing `ValenixiaPOS-HWID-Seed-${storeNormalized}`. Different GPU drivers, antialiasing engines, and subpixel rendering pipelines generate micro-variations unique to that device and that specific store.
  3. **Multi-Vector Entropy String**:
     ```javascript
     const components = [
       'WEB_APP',
       storeNormalized,
       navigator.userAgent,
       navigator.language,
       String(screen.width * screen.height),
       String(screen.colorDepth),
       String(navigator.hardwareConcurrency || 0),
       String(navigator.deviceMemory || 0),
       new Intl.DateTimeFormat().resolvedOptions().timeZone,
       canvasData.slice(-128)
     ].join('|');
     ```
  4. **Cryptographic Hashing**: Hashes this payload via `crypto.subtle.digest('SHA-256')`. If running in legacy or non-HTTPS contexts where `SubtleCrypto` is inaccessible, it gracefully fails over to a deterministic 64-bit `djb2` bitwise XOR algorithm.
  5. **Namespace Anchoring**: Formats the result as `WEB-<HEX_20>`, e.g., `WEB-A8E2B150F9C7D43A12E8`.

---

### 2. Perfect & Separate Store Upgrades on the Same Device

#### The Problem Solved
In commercial POS operations, a merchant frequently runs two separate retail stores on the same cashier PC or tablet:
- **Store A**: "Downtown Electronics" (running on the **Enterprise Plan** with FBR Fiscal POS and 3 terminals).
- **Store B**: "Quick Fix Accessories" (running on the **Starter Plan** or **Free Basic** tier).

In conventional software, upgrading Store A would overwrite local database limits, causing Store B to accidentally inherit Enterprise features (entitlement bleed) or, conversely, downgrading Store B would strip Store A's active paid license!

#### How Valenixia Guarantees Zero-Collision Store Isolation:
1. **Store-Bound HWID Generation**:
   Because `storeNormalized` is embedded directly into the canvas draw seed and the entropy components, Store Alpha and Store Beta generate **mathematically distinct HWIDs** on the exact same computer screen:
   - `HWID_Alpha = WEB-6FA901...`
   - `HWID_Beta  = WEB-3BC482...`
   - Test suite verification: `assert.notStrictEqual(webHwidA, webHwidB)` enforces this contract across all releases.

2. **Isolated SQLite Hardware Entitlement Ledger**:
   All tier limits, feature locks, and prepaid day countdowns are recorded in SQLite under:
   ```sql
   CREATE TABLE hardware_entitlements (
     hwid TEXT PRIMARY KEY,
     tier TEXT NOT NULL,
     mode TEXT NOT NULL,          -- 'subscription' | 'lifetime'
     expires_at INTEGER,          -- Monotonic UTC timestamp (null for Perpetual)
     granted_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   ```
   Upgrades, payment proofs, and activation codes target `(store_id, hwid)` pairs. Modifying Store Alpha's record in `hardware_entitlements` has zero effect on Store Beta's entry.

3. **Cloud-Anchored Multi-Store Subscription Restoration**:
   If the merchant reinstalls the app, clears browser storage, or swaps hardware:
   - The `/api/subscription/restore` engine queries the central Supabase cloud ledger matching the merchant's authenticated identity and store name.
   - It re-anchors the active prepaid days and re-issues the asymmetric Ed25519 token specifically to the requesting store's fresh HWID without consuming additional terminal seats!

---

## 💳 Commercial Plans & Perpetual Licensing Matrix (v3.2.4)

Valenixia POS supports both flexible monthly cloud SaaS subscriptions and standalone, offline-first **Perpetual Lifetime Licenses** with **Annual Maintenance Contracts (AMC)** for enterprise retailers:

| Feature / Limit | Free Basic | Starter Plan | Growth / Pro Plan | Enterprise HQ Plan |
|---|---|---|---|---|
| **Monthly Subscription** | **PKR 0** / forever | **PKR 3,499** / mo | **PKR 6,999** / mo | **PKR 11,999** / mo |
| **Perpetual License (One-Time)** | N/A | **PKR 79,000** | **PKR 149,000** | **PKR 249,000** |
| **Annual Maintenance (AMC)** | N/A | **PKR 15,000** / year | **PKR 28,000** / year | **PKR 45,000** / year |
| **Included Terminals** | 1 Terminal | 1 Terminal | 2 Terminals | 3 Terminals (Expandable) |
| **Included Branches** | 1 Branch | 1 Branch | 1 Branch | 2 Branches (Expandable) |
| **Transactions Limit** | 20 / day (600 / mo) | **Unlimited** | **Unlimited** | **Unlimited** |
| **Catalog Products Limit** | 25 Items | **Unlimited** | **Unlimited** | **Unlimited** |
| **FBR Fiscal POS (PRAL Live)** | ❌ | ✅ | ✅ | ✅ |
| **Kitchen Display (KDS / KOT)** | ❌ | ❌ | ✅ | ✅ |
| **Multi-Store Central HQ** | ❌ | ❌ | ❌ | ✅ |
| **Inter-Branch Stock Transfers (STN)**| ❌ | ❌ | ❌ | ✅ |
| **WhatsApp Digital Receipts** | ❌ | ❌ | Optional Add-on | ✅ Included |
| **Cloud Disaster Recovery** | Manual Export | Manual Export | Automated Daily | Real-Time Continuous |
| **Deals & Bundle Builder** | ✅ Free Included | ✅ Included | ✅ Included | ✅ Included |

---

### 3. PN-Counter CRDT Inventory Integrity
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

### 7. Decoupled Internationalization (strings.js)
- Features dynamic translation bundles (English and Urdu) separated into a dedicated `strings.js` script asset.
- Implements right-to-left (RTL) document layout flow and automatic Nastaliq font pairing when switching translation sets.

### 8. Real-time System Diagnostics Dashboard
- Embeds a real-time health dashboard inside the sync logs panel detailing local IndexedDB connection status, table row counts, sync engine network circuit breaker states, and HTML5 Web Storage quotas.
- Automatically handles vacuum defragmentation, sync force-reconnection, and telemetry logs export directly inside the client interface.

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
2. Run the DDL migration queries written in [init_disaster_recovery.sql](file:///c:/Users/DELL/Desktop/valenixia/supabase/migrations/20260630000000_init_disaster_recovery.sql) to set up remote tables and secure Row Level Security (RLS) rules checking `x-store-id` headers.
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
- **Android Keystore**: `server_url` stored encrypted via hardware-backed AES-GCM 256-bit keys (`valenixia_prefs_key`).
- **Input Validation**: All sensitive endpoints validated via `lib/validator.js` (store name, PIN, passphrase, UUIDs).
- **Circuit Breaker**: Supabase sync halts after 5 consecutive failures, resumes after 60 seconds.
- **val_type Whitelist**: Sync payloads with invalid `val_type` are rejected before upsert.
- **Google Safe Browsing**: Enabled for Android 8.0+ WebView.
- **CSP Headers**: Enforced via Helmet with restrictive `defaultSrc: 'self'`.
- **Crash Logger**: Uncaught exceptions written to `valenixia_crash.log` on Android external storage.

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
Saves a live SQLite copy to `backups/valenixia_YYYY-MM-DD-HHmmSS.db` (last `MAX_BACKUPS` retained).

### Restore a Backup
```bash
# Stop the server, restore, restart
cp backups/valenixia_2026-07-07-120000.db valenixia.db
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
