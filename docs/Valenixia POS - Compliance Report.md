# Valenixia POS — Regulatory Compliance Report (Pakistan PECA & SBP)

This document certifies the compliance architecture of the Valenixia POS (Point of Sale) Commerce Ecosystem under the Prevention of Electronic Crimes Act (PECA) 2016 and the State Bank of Pakistan (SBP) Rules for Electronic Money Institutions (EMIs).

---

## 1. Prevention of Electronic Crimes Act (PECA) 2016 Compliance

### Section 32: Data Localization & Retention
- **Requirement**: Maintenance of local traffic data and transaction records inside Pakistan.
- **Valenixia Implementation**:
  - **Local-First Architecture**: Each POS terminal operates a completely standalone local database (`valenixia.db`) stored on the physical device's disk within Pakistan boundaries.
  - **Supabase Cloud Regioning**: The peer-to-peer sync daemon connects to Supabase database instances configured to store all tables (including transactional audit change logs) in sovereign Pakistan-based cloud availability zones or on-premise regional servers.
  - **1-Year Logging Retention**: Automated tombstone retention sweeps inside `server.js` enforce data retention schedules that maintain transaction metrics and audit logs for the statutory 1-year window before pruning database rows.

### Section 13, 14, & 21: Privacy, Identity Theft & PII Protection
- **Requirement**: Protection of consumer privacy and prevention of unauthorized credentials or PII logs exposure.
- **Valenixia Implementation**:
  - **PII Log Masking**: The zero-dependency JSON structured logger `lib/logger.js` runs regex filters to automatically redact private keys, JWTs, Bearer tokens, passwords, pins, phone numbers (+92/E.164), emails, and CNIC (Pakistan National ID) numbers.
  - **Secure Cryptographic Hashing**: Cleartext passwords/PINs are hashed using Argon2id (memoryCost: 64MB, timeCost: 3, parallelism: 4) on the server, and 100,000-iteration salted PBKDF2 WebCrypto hashes on the client side. Unsalted SHA-256 legacy derivations are strictly blocked.

---

## 2. State Bank of Pakistan (SBP) EMI Regulation Compliance

### Chapter V: Security of Transactions and Consumer Protection
- **Requirement**: Ensuring transaction integrity, non-repudiation, and secure transmission of financial transactions.
- **Valenixia Implementation**:
  - **SQLCipher at Rest**: The SQLite database engine dynamically binds `@journeyapps/sqlcipher` to encrypt database files at rest with AES-256 key management tied to local environment variables.
  - **Authorized Privileged Overrides**: Operations involving critical system adjustments, employee updates, or system resets require administrative PIN verification or biometric authorization (via the Android Biometrics SDK interface).
  - **Secure Channels**: Local mesh networking WebSocket synchronization and external API calls (e.g. Supabase, licenses, FBR integration) operate exclusively over TLS 1.3/HTTPS channels.

---

## 3. FBR Rule 150XC Real-Time E-Invoicing Fallback

- **Requirement**: Tier-1 retailers must register invoices in real-time with the Federal Board of Revenue (FBR) systems. If the network or FBR gateway goes down, offline sales must be queued and resubmitted within 24 hours of connection recovery.
- **Valenixia Implementation**:
  - **Local Offline Queue**: Invoices created during offline periods generate a unique local sequence number (USIN) and are stored in the local SQLite `fbr_submissions` table with status `FAILED` or `PENDING`.
  - **Automatic Resubmission Daemon**: A background scheduler `runAutomatedFbrRetry()` runs in `server.js` every 15 minutes to scan the database and resubmit queued invoices to the FBR gateway automatically once internet connectivity is restored.
