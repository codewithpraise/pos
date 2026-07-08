# Valenixia POS - Agent Guidelines

## How to Map the Codebase
1. Start with [[Valenixia POS - Architecture]].
2. Check [[Valenixia POS - UI-UX Design System]] for styling.
3. See [[Valenixia POS - Premium UI Overhaul v3]] for latest changes.
4. Review [[Valenixia POS - Known Bugs & Fixes]] to avoid repeats.

## Common Tasks & Code Templates

### 1. How to Add a New Theme
To register a new color palette (e.g., `theme-neon-cyber`):
1. **Define the CSS block in `public/style.css`**:
   ```css
   body.theme-neon-cyber {
     --bg-obsidian: #050508;
     --panel-graphite: #0f0f16;
     --panel-graphite-mid: #0f0f16;
     --panel-graphite-light: #161622;
     --panel-hover: #1c1c2b;
     --border-titanium: rgba(0, 214, 143, 0.1);
     --border-bright: rgba(0, 214, 143, 0.2);
     --accent-emerald: #00ffaa;
     --accent-emerald-gradient: linear-gradient(135deg, #00ffaa 0%, #00bcff 100%);
     --text-white: #ffffff;
     --text-muted: #d0d0da;
     --text-gray: #7a7a93;
     --text-dim: #44445c;
     --success: #00e676;
     --warning: #ffd600;
     --alert-coral: #ff1744;
     --font-display: 'Inter', sans-serif;
     --font-body: 'Inter', sans-serif;
   }
   ```
2. **Register in `public/app.js`** inside the four theme arrays (Theme Toggler, Settings Save, Settings Load, Setup Wizard):
   ```javascript
   const themes = [
     'theme-obsidian-emerald',
     'theme-midnight-sapphire',
     'theme-warm-amber',
     'theme-minimalist-chrome',
     'theme-monochrome-ivory',
     'theme-premium-navy',
     'theme-neon-cyber' // <-- Append new theme here
   ];
   ```

### 2. How to Trigger Haptics, Audio, & Screen Reader Announcements
Always pair physical inputs or transactional outcomes with multimodal feedback:
```javascript
// Trigger a light tick haptic on tap
haptic(30);

// Trigger a success double-vibe on payment
haptic([50, 30, 100]);

// Announce a status change to screen readers
announceToScreenReader('Cart successfully updated.');

// Play localized synthesized sound cue
playAudioSignal('success');
```

---

## Architectural Decision Records (ADRs)

### ADR 001: CRDT Append-Only Sync vs Simple Timestamp-Based Sync
- **Context**: POS register terminals operate primarily offline. If multiple registers modify the same product stock or supplier records while disconnected, simple last-write-wins (timestamp-based) sync causes lost updates and stale stock levels.
- **Decision**: Implemented an append-only Conflict-Free Replicated Data Type (CRDT) engine (`crdt-engine.js` and SQLite `crsql_changes` logs). Every mutation creates an independent, commutative change row with a globally unique node ID. Merging changes guarantees convergent, conflict-free state resolution across all nodes regardless of sync order.

### ADR 002: Virtual Windowed DOM List for Large Product Catalogs
- **Context**: Product catalogs can exceed 10,000+ items. Rendering them in standard HTML tables or grids tanks DOM performance, resulting in sluggish scrolling, frame drops, and input latency on lower-end retail tablets.
- **Decision**: Implemented `VirtualList` (`virtual-list.js`). This component keeps only the visible subset (~12–15 nodes) rendered in the DOM window. It adjusts a ghost spacer's height to preserve native scrollbar size, achieving 60fps scrolling on resource-constrained hardware.

---

## Glossary of Terms

- **WAL (Write-Ahead Logging)**: A SQLite journaling mode that enables concurrent reads and writes, preventing UI freezes during high-frequency local IndexedDB/sync updates.
- **Monotonic Time Anchor**: A security feature preventing users from bypassing trial or operational licensing limits by rolling back their system clocks.
- **Circuit Breaker**: A resilience pattern in `supabase-sync.js` that halts remote cloud sync queries after 5 consecutive failures, avoiding client-side resource starvation and network spamming.
- **Idempotency Key**: A unique key assigned to checkouts to prevent duplicate sales processing if double-clicks or worker network retries occur.

---

## Do’s and Don'ts for AI Agents
- ✅ **Do** preserve the BEM-like CSS structure inside `style.css`.
- ✅ **Do** support `:focus-visible` states for accessibility.
- ✅ **Do** respect the `prefers-reduced-motion` query in style additions.
- ❌ **Don't** add third-party dependencies unless absolutely critical.
- ❌ **Don't** use browser APIs (e.g. WebUSB, SpeechSynthesis) without checking compatibility and providing clean fallback pathways.

