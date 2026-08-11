// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - UNIFIED LEGAL REQUIREMENTS MATRIX & DOCUMENTS
// Single source of truth for ToS, EULA, Privacy Policy, Acceptable Use, FBR Disclaimer, and Cloud Sync Terms.
// ============================================================================

const LEGAL_DOCUMENTS = {
  VERSION: '2.5.1',
  EFFECTIVE_DATE: '2026-08-11',

  TERMS_OF_SERVICE: `
# VALENIXIA COMMERCE ECOSYSTEM — TERMS OF SERVICE (v2.5.1)

## 1. ACCEPTANCE & SCOPE
By creating an account, registering a store counter, or installing Valenixia POS software, you agree to be bound by these Terms of Service. If you do not agree, do not use the application.

## 2. COMMERCIAL SUBSCRIPTION & HARDWARE LIMITS & BOUNDS
Valenixia POS is licensed on a subscription or perpetual basis. Registered accounts are bound by active tier limits:
- **Starter Tier**: 1 Register Terminal License & 1 Store Branch.
- **Growth (Pro) Tier**: Up to 3 Register Terminals & 1 Store Branch.
- **Enterprise Tier**: Up to 10 Register Terminals & 5 Store Branches.

Attempting to connect excess terminal nodes beyond active tier entitlements will result in automatic node isolation and access restriction.

## 3. ELECTRONIC INVOICING & TAX FACILITATION DISCLAIMER
### 3.1 Software Provider Scope (Valenixia)
Valenixia provides software tools to format, tag, and queue digital invoice payloads for transmission to Federal Board of Revenue (FBR) or provincial tax authority endpoints. Valenixia is a software vendor, NOT a licensed tax auditor or government authority.

### 3.2 Merchant Tax Obligations
The merchant (Registered Person) remains 100% legally responsible for:
- Maintaining valid NTN, STRN, and business registration status;
- Setting accurate tax rates (e.g. 18% GST, 15% restaurant service tax) within catalog settings;
- Timely filing of monthly sales tax returns with relevant tax authorities;
- Validating generated QR codes and fiscal numbers against PRAL records.

## 4. PAYMENT CLAIMS & ADD-ON MARKETPLACE
Upgrade claims submitted via NayaPay or bank transfers are subject to verification. Add-ons (FBR POS, Multi-Store HQ, WhatsApp Receipts, Custom RBAC, Data Portability) remain active while subscription fees are in good standing.
  `,

  EULA: `
# VALENIXIA POS — END USER LICENSE AGREEMENT (EULA v2.4.6)

## 1. GRANT OF LICENSE
Valenixia grants you a revocable, non-exclusive, non-transferable license to execute Valenixia POS software on physical hardware devices (PC, Android, POS Terminal).

## 2. HARDWARE FINGERPRINTING & DEVICE BINDING
Each license token is cryptographically bound to a unique Hardware Identifier (HWID) derived from CPU, motherboard, storage, and network interface signatures. Licenses cannot be transferred without administrative re-pairing.

## 3. OFFLINE OPERATION & DATABASE LOCALITY
Valenixia POS operates as a local-first software system. All transactions, catalog edits, and customer records are written to local SQLite / IndexedDB databases. Offline capability does NOT waive license fee obligations or subscription renewal dates.

## 4. PROHIBITED USAGE
You shall not:
- Decompile, reverse engineer, or unpack cryptographic license validation routines;
- Modify, forge, or tamper with FBR fiscal submission logs or transaction audit ledgers;
- Bypass hardware terminal connection caps or branch isolation gates.
  `,

  PRIVACY_POLICY: `
# VALENIXIA POS — PRIVACY POLICY & DATA OWNERSHIP (v2.4.6)

## 1. DATA OWNERSHIP
You retain full, exclusive ownership of your business data, including inventory items, sales records, customer directories, and employee PINs. Valenixia does NOT sell, rent, or monetize your store ledgers.

## 2. ENCRYPTION AT REST
Local databases are secured using AES-256-GCM encryption. Sensitive credentials, including API keys, PIN hashes (PBKDF2), and tax portal tokens, are stored in encrypted preference vaults.

## 3. CLOUD SYNC & TELEMETRY
When cloud sync is enabled, store data is transmitted over TLS 1.3 encrypted channels to your isolated Supabase tenant. Diagnostic telemetry is restricted to crash logs, storage utilization metrics, and software version verification.

## 4. WHATSAPP & THIRD-PARTY SERVICES
If you utilize WhatsApp Digital Receipts, customer phone numbers and itemized totals are passed to official WhatsApp Business APIs solely for dispatching requested transaction receipts.
  `,

  ACCEPTABLE_USE: `
# VALENIXIA POS — ACCEPTABLE USE POLICY (AUP v2.4.6)

## 1. SYSTEM INTEGRITY
Users must not inject malicious scripts, attempt SQL injection, or execute unauthorized automated requests against Valenixia SyncHub or API endpoints.

## 2. RATE LIMITING & BANDWIDTH FAIR USE
Cloud synchronization services enforce rate limits of 1,000 sync batches per hour per terminal node. Excessive background requests exceeding fair-use caps may trigger temporary IP throttling.

## 3. SECURITY & PIN RESPONSIBILITIES
Cashiers and administrators are responsible for safeguarding access PINs. Cashier shift lock mechanisms must be engaged when registers are left unattended.
  `,

  FBR_DISCLAIMER: `
# VALENIXIA POS — OFFICIAL FBR & TAX REGULATORY DISCLAIMER (v2.4.6)

## 1. THREE-WAY REGULATORY BOUNDARY DEFINITION

### A. Valenixia POS Software Application
Valenixia POS provides automated tax calculation modules, FBR invoice payload generation, QR code formatting, and offline submission outbox queues. Valenixia does NOT issue government tax certifications.

### B. Licensed PRAL / FBR Integrators
Third-party PRAL licensed integrators are responsible for server endpoint availability, digital certificate signing, and direct communication with FBR central databases.

### C. Taxpayer / Merchant Obligations
The merchant is solely responsible for legal compliance under the Sales Tax Act, 1990, Income Tax Ordinance, 2001, and relevant Provincial Sales Tax acts.

## 2. FBR SERVICE FEE & QR CODE FACILITATION
Where mandated for Tier-1 retailers, the FBR POS Service Fee of PKR 1.00 per invoice is automatically added to invoice totals. Software availability of FBR features does NOT relieve the merchant of statutory audit liabilities.
  `,

  CLOUD_SYNC_TERMS: `
# VALENIXIA POS — CLOUD SYNC & CLOUD BACKUP TERMS (v2.5.0)

## 1. HYBRID LOGICAL CLOCK CONFLICT RESOLUTION
Multi-terminal synchronization utilizes Hybrid Logical Clocks (HLC) for deterministic timestamp ordering. In the event of conflicting edits across terminals, higher HLC logical timestamps supersede.

## 2. AUTOMATED BACKUPS & GOOGLE DRIVE INTEGRATION
Daily database snapshots are stored locally and, where configured, uploaded to merchant-owned Google Drive accounts via OAuth 2.0 tokens. Valenixia does not store master encryption keys for private Drive backups.

## 3. ZERO-DATA-LOSS GUARANTEE SCOPE
Offline transactions recorded in local outbox tables are guaranteed to persist across device reboots and offline periods until network connectivity enables background synchronization.
  `
};

module.exports = LEGAL_DOCUMENTS;
