# Valenixia POS - Development Guide & Architecture

## System Overview
Valenixia is a zero-trust, local-first distributed POS system featuring offline-resilient CRDT synchronizations, end-to-end WebCrypto encryption (AES-GCM-256), multi-device role modes (Register, Kitchen Display, Customer Facing Display), dynamic i18n support via a dedicated `strings.js` translation library (English & Urdu support), and an asynchronous Supabase cloud backup layer for fleet management and disaster recovery.

## Build & Run Commands
- **Launch Development Server (Node.js):** `npm start`
- **Compile Kotlin Multiplatform JVM target:** `./gradlew compileKotlinJvm`
- **Launch Kotlin Multiplatform Desktop app:** `./gradlew run`
- **Build Desktop App Distributable:** `./gradlew packageDistributionForCurrentOS` (outputs to `build/compose/binaries`)
- **Build Android App (APK):** Run `./gradlew assembleDebug` inside the `android/` directory (outputs `app-debug.apk`)
- **Sync Web Assets to Android Assets:** `npm run sync:android`
- **Test Supabase Connection:** `node test_supabase.js`
- **Run Complete E2E Test Suite:** `powershell -ExecutionPolicy Bypass -File ./test_runner.ps1`

---

## ☁️ Supabase Cloud Synchronization & Disaster Recovery (Component N)

We use Supabase strictly as a background disaster recovery layer. The system remains 100% operational offline, and the local Node.js server automatically batches and upserts append-only CRDT change rows to the cloud table every 5 minutes.

### Setup Instructions
1. Run local Supabase initialization:
   ```bash
   npx supabase init
   ```
2. Copy the SQL migration script located in [init_disaster_recovery.sql](file:///c:/Users/DELL/Desktop/valenixia/supabase/migrations/20260630000000_init_disaster_recovery.sql) and paste it into the **SQL Editor** on your Supabase dashboard, then click **Run**.
3. Create a `.env` file in the root directory:
   ```env
   SUPABASE_URL=https://your-supabase-project.supabase.co
   SUPABASE_ANON_KEY=your-supabase-anon-key
   STORE_TERMINAL_ID=terminal_pc_master
   ```
4. Verify the setup runs correctly:
   ```bash
   node test_supabase.js
   ```

---

## 📱 The 5 Mobile UX Pillars (Compose Multiplatform / Mobile Build)

To maintain an premium native mobile experience, the mobile application must adhere to the following strict UX guidelines:

### Pillar 1: The "Thumb Zone" Ergonomics (Layout)
- **Bottom-Heavy Navigation:** Do not put critical actions at the top of the screen. The Cart Total, "Pay" button, and Category switchers must live in a persistent bottom sheet or lower navigation bar.
- **Tap Targets:** Enforce a strict minimum touch target of `56.dp` for all buttons.
- **The Floating Scanner:** The primary action is adding items. Implement a prominent, floating, glowing `FloatingActionButton` (FAB) just above the bottom bar that instantly wakes the CameraX barcode scanner.

### Pillar 2: Fluid Micro-Interactions (Gestures)
- **Swipe-to-Delete:** Implement Compose's `SwipeToDismissBox`. Cashiers smoothly swipe the cart row to the left to delete. As they swipe, the row background turns Crimson Red with a trash icon, triggering a soft vibration when the deletion threshold is crossed.
- **Spring Physics:** Use Compose's `spring()` spec for all animations (`stiffness = Spring.StiffnessLow, dampingRatio = Spring.DampingRatioNoBouncy`). When a modal opens, it should smoothly "snap" into place, not just fade in.

### Pillar 3: Sensory Feedback (The Vibe)
- **Tactile Haptics:** Inject `LocalHapticFeedback.current` into all actions:
  - *Adding an item:* `HapticFeedbackType.TextHandleMove` (light tick).
  - *Error / Wrong PIN:* `HapticFeedbackType.LongPress` x 2 (heavy double thud).
  - *Successful Checkout:* A custom ripple vibration pattern.
- **Spatial Audio:** Hook into `AudioSynth.kt` using distinct, crisp UI sounds:
  - A high-pitched *pop* for cart additions.
  - A soft *swish* for swiping away items.
  - A satisfying *cash-register ding* only upon payment completion.

### Pillar 4: True Immersive Native Mode
- **Hide System Bars:** Use `WindowCompat.setDecorFitsSystemWindows(window, false)` on Android to draw the UI underneath the system status bar and navigation bar. Make the system bars transparent so the glassmorphic backgrounds bleed all the way to the absolute edges of the bezel.
- **Keep Screen On:** Implement `window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)` when the app is in Register mode to prevent sleep timeouts.

### Pillar 5: Performance & 60FPS Standard
- **Lazy Lists:** Ensure the product grid uses `LazyVerticalGrid` and the cart uses `LazyColumn`. Use `key = { it.id }` inside the lazy lists to prevent Compose from recomposing the entire cart every time the total changes.
- **Immutable State:** Mark data classes with `@Immutable` or `@Stable` in Kotlin. This tells the Compose compiler to skip rendering checks, drastically improving scrolling performance on lower-end Android tablets.
- **The Offline Pill:** Do not use blocking pop-ups if the Wi-Fi drops. Use an animated `AnimatedVisibility` pill at the top of the screen that smoothly drops down, glows amber, and says *"Offline (Syncing paused - safe to keep selling)"*.

---

## Developer Code Templates and ADRs (Phase 8)

### Code Templates

#### Template A: How to Add a New Shop Business Mode
To introduce a new shop business mode (e.g., automotive-repair):
1. Register the mode name in `server.js` within the `validateModeFields` helper.
2. Define the schema requirements (e.g., vehicle_make, mileage, estimated_hours).
3. Add a check block in the client-side validation logic inside `public/app.js`.
4. Create test cases in `tests/modes.test.js` and `tests/e2e-modes.test.js` to assert constraints.

#### Template B: How to Add a New Product Modifier Type
To add a new modifier option:
1. Update `validateModeFields` in `tests/modes.test.js` and sync scripts to handle structural validation.
2. Update the frontend menu layout to render options input (e.g., checkboxes, weight scales).
3. Ensure the Checkout Engine aggregates adjustments (e.g., itemBasePrice + modifierPrice).

#### Template C: How to Add a New Analytics Chart
To append an analytics dashboard component:
1. Add an empty state placeholder and container in `public/index.html`.
2. Retrieve raw transaction objects from SQLite in the server-side API handler.
3. Apply date range filters, then compute aggregations (e.g., group by categories, split payment modes).
4. Render the chart visually in `public/app.js` using responsive SVG layers or bar charts.

---

### Architectural Decision Records (ADRs)

#### ADR-001: Zero-Blocking Native Call Policy & Custom Modals
* **Context**: Native browser alert(), confirm(), and prompt() calls block the main JS execution thread, which is dangerous for real-time local-first operations and incompatible with headless automated verification sweeps.
* **Decision**: All native modal pop-ups are completely prohibited in production paths. They are fully replaced with the asynchronous, non-blocking window.showModal custom promise-based overlay, supporting titles, multi-actions, custom classes, and standard inputs.
* **Consequence**: Guaranteed non-blocking thread behavior and full E2E automation compatibility.

#### ADR-002: Storage Limitations Guardrails
* **Context**: Local registers operate on resource-constrained hardware. Storing high-resolution transaction images can cause SQLite/browser quota overflow.
* **Decision**: Implement a 4MB quota limit warning on startup. Standardize image compression using canvas resizing before upload, and automate image purge routines for logs older than 90 days.
* **Consequence**: Protects registers against database WAL locking and localized data corruption.

#### ADR-003: Mode-Specific Analytics
* **Context**: Different retail verticals have distinct KPIs (e.g., modifiers for food, warranties for electronics).
* **Decision**: Analytics views are dynamically reconfigured based on active shop_mode. We segregate category breakdowns, variants, and booking details into targeted charts.
* **Consequence**: Clean, decoupled layouts with minimal visual noise for POS operators.

#### ADR-004: Responsive Viewport Resizing & Dialog Containment
* **Context**: POS screens range from large desktop monitors to narrow mobile screens or split-screen views. Squeezing three-column layouts on narrow viewports broke readability.
* **Decision**: We shifted the 3-column layout breakpoint to `1200px` (forcing 2-column stacked layouts below it). We enforced scroll-lock classes and MutationObserver checking to prevent double-scrollbar glitches, added close buttons to top-level fixed banner overlays, and bound input-resize handlers to re-center focused elements when the virtual keyboard pops.
* **Consequence**: Full responsive coverage from 320px wide up to ultra-wide displays.

#### ADR-005: Decoupled Internationalization and System Diagnostics Dashboard
* **Context**: POS terminal systems require localized support for non-English speakers (such as Urdu in Pakistan) and active local telemetry/diagnostic tracking without cluttering main controller script files.
* **Decision**: We moved all static translation dictionaries to a standalone `strings.js` asset script loaded synchronously, replaced legacy unicode hardcoding with structured references, and implemented an active, real-time System Diagnostics panel showing local IndexedDB schema counts, Circuit Breaker status, current terminal HWID, and Storage Quotas.
* **Consequence**: Better codebase readability, simplified maintenance for future translation sets, and real-time support diagnostic reporting.

#### ADR-006: PIN Cooldown Lockout Rate Limiter
* **Context**: POS systems are prone to brute-force attacks on the local lock screen when left unattended.
* **Decision**: We enforced a local, state-level rate limiter on pin verification: if an operator enters an incorrect PIN 3 times sequentially, the lock screen enters a 30-second lockout mode, disabling the PIN input overlay and displaying a remaining lockout seconds alert.
* **Consequence**: Protects registers against localized brute-force security overrides.

