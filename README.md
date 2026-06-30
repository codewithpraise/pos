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
   SUPABASE_URL=https://wzvwyfyefbdrqscxhwsf.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_P6-5AYr2f-c-XFyp5iea6A_d2Kfjxem
   STORE_TERMINAL_ID=terminal_pc_master
   ```
4. Run `npm start` to launch the SQLite database engine, initialize WAL indexes, and start the local sync hub:
   ```bash
   npm start
   ```
5. Open your browser to `http://localhost:3000`.

### Executing Client Releases
* **Desktop Executable**: Double-click the pre-built `NexovaPOS.exe` or `NexovaPOS.msi` inside the project root folder.
* **Android Client**: Install `nexova-pos-debug.apk` directly on Android tablets or mobile registers.

### Cloud Setup (Disaster Recovery Provisioning)
1. Go to your **Supabase Dashboard** -> **SQL Editor**.
2. Run the DDL migration queries written in [init_disaster_recovery.sql](file:///c:/Users/DELL/Desktop/nexova/supabase/migrations/20260630000000_init_disaster_recovery.sql) to set up remote tables and Row Level Security (RLS) rules.
3. Test your connection:
   ```bash
   node test_supabase.js
   ```

---

## ⌨️ POS Keyboard Hotkeys

- `F1`: Execute checkout transaction.
- `F2`: Park/Void active cart (Requires Manager PIN authentication if items exist).
- `F5`: Focus search input bar.
- `F8`: Toggle Speech Coach audio analysis.
