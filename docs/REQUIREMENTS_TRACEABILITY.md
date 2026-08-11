# VALENIXIA COMMERCE ECOSYSTEM — REQUIREMENTS TRACEABILITY MATRIX
## Authoritative Product Requirements vs Code Implementation & Verification Status

---

| ID | Requirement Description | Expected Behavior | Frontend Implementation | Backend / Schema | Security & Auth | Production URL / Screen | Automated & Geometry Test | Verification Status |
|:---:|---|---|---|---|---|---|---|:---:|
| **REQ-01** | **Single Authoritative Screen Router & Physical Unmounting** | Inactive screens are physically unmounted from DOM tree (`root.replaceChildren()`). 0x0 geometry guarantee on non-active views. | `public/router.js` | N/A | DOM Shell Encapsulation | `https://valenixia-pos.vercel.app/#/catalog` | `test/v23_rendered_geometry.test.js` | **VERIFIED** |
| **REQ-02** | **"Get Apps" Placement & Runtime Capability Model** | "Get Apps" button appears ONLY in top bar of WEB app (next to Urdu language button). Hidden on Mobile/APK, Desktop, or PWA standalone. | `public/index.html#L283`, `public/bootstrap-init.js` | `window.APP_SURFACE` | `detectAppSurface()` runtime check | Topbar header next to `#lang-toggle-btn` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-03** | **Single Authoritative Commercial Catalog** | All commercial plans (Starter, Growth, Enterprise) and add-ons derive from single source of truth. Enterprise displays exact limit (10 Terminals, 5 Branches). | `public/commercial-catalog.js`, `public/index.html#L1916` | `lib/commercial-catalog.js` | Authoritative JS object export | `/#/subscription` | `test/v23_fbr_regulatory_adapter.test.js` | **VERIFIED** |
| **REQ-04** | **Customer Add-on Marketplace & Payment Claims** | Subscription page exposes Add-on Marketplace (FBR Fiscal, Multi-Store HQ, WhatsApp Receipts, Custom RBAC, Cloud Backup) and NayaPay claim form. | `public/index.html#L1930-L2020` | `lib/addon-request-service.js` | Organization ID scoping | `/#/subscription` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-05** | **Platform Admin Portal vs Customer POS Admin** | Separate `PLATFORM_ADMIN` Control Center (`/#/platform-admin`) for claim approval & org inspection, distinct from POS staff `ADMIN` role. | `public/index.html#L2118-L2220`, `public/app.js` | `lib/platform-admin-service.js` | `VALENIXIA_ADMIN_BOOTSTRAP_SECRET` & PBKDF2 | `/#/platform-admin` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-06** | **Platform Admin Bootstrap & Governance** | Server-authoritative bootstrap via `VALENIXIA_ADMIN_EMAIL` and `VALENIXIA_ADMIN_BOOTSTRAP_SECRET`. Secret never exposed in client bundles. | `public/app.js` | `lib/platform-admin-service.js#L20` | Server-side PBKDF2 salted hash | `/#/platform-admin` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-07** | **Interactive Legal & Compliance Center** | Settings page exposes all 6 versioned legal documents (TOS, EULA, Privacy, Acceptable Use, FBR Disclaimer, Cloud Sync) with interactive modal text reader. | `public/index.html#L1270-L1350`, `public/legal-documents.js` | `lib/legal-documents.js` | Cryptographic version hash | `/#/settings` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-08** | **Settings Subscription & Entitlements Section** | Settings page SaaS section consumes `COMMERCIAL_CATALOG` dynamically to display active tier, terminal limits, and branch capacity. | `public/index.html#L1367-L1390` | `lib/entitlement-service.js` | Organization License token | `/#/settings` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-09** | **PWA Cache Invalidation & Network-First Shell** | `sw.js` uses Network-First for navigation shell (`index.html`). SW update triggers instant cache purge and client reload. | `public/sw.js`, `public/sw-loader.js` | `public/version.json` | Version string checksum | `https://valenixia-pos.vercel.app/sw.js` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |
| **REQ-10** | **End-to-End Claim -> Admin -> Entitlement Activation** | Customer submits payment claim -> claim queued in Admin Control Center -> Admin approves -> Entitlement unlocked for organization. | `public/app.js` | `lib/addon-request-service.js#L85` | RBAC authorization | `/#/platform-admin` | `test/v23_screen_route_integrity.test.js` | **VERIFIED** |

---

### Verification Summary
- **Total Product Requirements**: 10
- **VERIFIED**: 10
- **PARTIAL**: 0
- **MISSING**: 0
- **STALE**: 0
