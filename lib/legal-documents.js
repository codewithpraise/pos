// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - UNIFIED LEGAL DOCUMENTS & TAX DISCLAIMERS
// Professional Terms of Service, EULA, Privacy Policy, and Tri-Partite Responsibilities
// ============================================================================

const LEGAL_DOCUMENTS = {
  VERSION: '2.3.0',
  EFFECTIVE_DATE: '2026-08-11',

  TERMS_OF_SERVICE: `
# VALENIXIA COMMERCE ECOSYSTEM — TERMS OF SERVICE (v2.3.0)

## 1. ACCEPTANCE OF TERMS
By creating an account, registering a store, or utilizing Valenixia POS software, you agree to be bound by these Terms of Service.

## 2. SOFTWARE LICENSE & SUBSCRIPTION
Valenixia grants you a non-exclusive, non-transferable right to access and use the Valenixia POS application.

## 3. ELECTRONIC INVOICING & TAX SYSTEM FACILITATION DISCLAIMER

### 3.1 Software Provider Responsibility (Valenixia)
Valenixia is responsible for:
- Maintaining software integration capability to interface with Pakistan FBR digital fiscalization systems;
- Securely transmitting transaction data payloads through approved integration pathways;
- Preserving fiscalization logs, submission queues, and transaction records;
- Protecting API credentials and secrets stored within the application;
- Keeping application software tools operational to the extent specified in active subscriptions.

### 3.2 Licensed Integrator / PRAL Responsibility
Licensed Integrators or PRAL are responsible for:
- Providing the approved/licensed integration service and server endpoints;
- Approved POS configuration and certification;
- Communication and data transmission with FBR tax databases;
- Regulatory licensing obligations imposed under applicable tax laws.

### 3.3 Merchant Responsibility (Registered Person)
The merchant remains solely responsible for:
- Determining legal integration requirements under Pakistani tax laws;
- Providing accurate NTN, STRN, and business registration details;
- Maintaining correct tax rates and product tax categories within catalog settings;
- Securing and maintaining integration credentials;
- Complying with all applicable federal and provincial tax laws and filing obligations.

### 3.4 Limitation of Tax Compliance Guarantee
Software availability of FBR or fiscal integration features does NOT by itself constitute a determination that the merchant is legally compliant with Pakistani tax laws. Subscribing to Valenixia software does not relieve the merchant of their statutory obligations.

### 3.5 Commercial Terms & Integrator Fees
Valenixia includes FBR software functionality in all subscription plans at no additional Valenixia subscription fee. Configuration or integration charges by licensed third-party integrators, if applicable, are determined independently by such third parties.

## 4. DATA OWNERSHIP & PRIVACY
You retain full ownership of your business, transaction, customer, and catalog data. Valenixia does not sell merchant data.
  `,

  EULA: `
# VALENIXIA POS — END USER LICENSE AGREEMENT (EULA v2.3.0)

This End User License Agreement governs the installation and offline/online execution of Valenixia POS software on desktop, tablet, and mobile devices.
  `,

  PRIVACY_POLICY: `
# VALENIXIA POS — PRIVACY POLICY (v2.3.0)

Valenixia respects your privacy. All local database transactions remain encrypted at rest using AES-256-GCM / SQLCipher bindings.
  `
};

module.exports = LEGAL_DOCUMENTS;
