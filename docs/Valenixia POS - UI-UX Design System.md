# Valenixia POS - UI/UX Design System

## Themes
- `theme-obsidian-emerald`
- `theme-midnight-sapphire`
- `theme-warm-amber`
- `theme-minimalist-chrome`
- `theme-monochrome-ivory`
- `theme-premium-navy` (v3)

## Design Tokens
- Spacing: `--space-1` to `--space-16` (8px scale)
- Colors: semantic aliases (`--color-success`, `--color-error`, etc.)
- Typography: Inter (premium), Outfit/Manrope fallbacks

## Components
- `.pos-empty-state` – Empty states
- `.offline-banner` – Offline indicator
- `.metric-trend` – KPI trend badges
- `.cart-item-row.adding/.removing` – Cart animations
- `.qty-val.bump` – Qty pulse
- `.btn-checkout-pay.success-pulse` – Payment success
- `.shake` – Error shake
- `.history-filter-pill` – History filters
- `.kbd` – Keyboard shortcut badges
- `.sync-status-badge` – Sync status
- `.settings-section.danger-zone` – Danger zone

## Animations
- Slide-in/out for cart items
- Spring bounce for qty
- Ring flash for payment success
- Horizontal shake for errors
- Shimmer skeletons for loading

## Accessibility
- `:focus-visible` styles
- `@media (prefers-reduced-motion)`
- `aria-live` region + `announceToScreenReader()`
- `.sr-only` utility
