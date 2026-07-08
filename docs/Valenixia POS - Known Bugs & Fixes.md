# Valenixia POS - Known Bugs & Fixes

## Fixed Bugs
### Chrome-only APIs (WebUSB, Web Speech)
- **Issue**: Limited browser compatibility.
- **Fix**: Documented limitation; future work: fallback or polyfill.

### Clock Rollback Vulnerabilities
- **Issue**: Local time changes could break sync.
- **Fix**: Monotonic time anchor + health checks.

### Sync Circuit Breaker
- **Issue**: Supabase sync could spam failures.
- **Fix**: Circuit breaker halts after 5 failures; manual resume.

### Light-Mode Skeleton Shimmer
- **Issue**: Shimmer looked broken in `theme-monochrome-ivory`.
- **Fix**: Added theme-aware shimmer gradients.

### Double Click / Double Event Listener in wireHistoryFilterPills
- **Issue**: Successive loads registered multiple click handlers, leaking memory and multiplying callbacks.
- **Fix**: Implemented a container-level IDempotency guard (`container.__wired = true`).

## Open Issues / Future Work
- File splitting: `design-tokens.css`, `components.css`, `themes.css`
- Better error boundaries in UI (e.g., network errors)
- More comprehensive E2E tests for premium animations
