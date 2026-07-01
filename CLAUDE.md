# Nexova POS - Development Guide & Architecture

## System Overview
Nexova is a zero-trust, local-first distributed POS system featuring offline-resilient CRDT synchronizations, end-to-end WebCrypto encryption (AES-GCM-256), multi-device role modes (Register, Kitchen Display, Customer Facing Display), and an asynchronous Supabase cloud backup layer for fleet management and disaster recovery.

## Build & Run Commands
- **Launch Development Server (Node.js):** `npm start`
- **Compile Kotlin Multiplatform JVM target:** `./gradlew compileKotlinJvm`
- **Launch Kotlin Multiplatform Desktop app:** `./gradlew run`
- **Build Desktop App Distributable:** `./gradlew packageDistributionForCurrentOS` (outputs to `build/compose/binaries`)
- **Build Android App (APK):** Run `./gradlew assembleDebug` inside the `android/` directory (outputs `app-debug.apk`)
- **Test Supabase Connection:** `node test_supabase.js`

---

## ☁️ Supabase Cloud Synchronization & Disaster Recovery (Component N)

We use Supabase strictly as a background disaster recovery layer. The system remains 100% operational offline, and the local Node.js server automatically batches and upserts append-only CRDT change rows to the cloud table every 5 minutes.

### Setup Instructions
1. Run local Supabase initialization:
   ```bash
   npx supabase init
   ```
2. Copy the SQL migration script located in [init_disaster_recovery.sql](file:///c:/Users/DELL/Desktop/nexova/supabase/migrations/20260630000000_init_disaster_recovery.sql) and paste it into the **SQL Editor** on your Supabase dashboard, then click **Run**.
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
