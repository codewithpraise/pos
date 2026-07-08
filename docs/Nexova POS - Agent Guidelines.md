# Nexova POS - Agent Guidelines

## How to Map the Codebase
1. Start with [[Nexova POS - Architecture]].
2. Check [[Nexova POS - UI-UX Design System]] for styling.
3. See [[Nexova POS - Premium UI Overhaul v3]] for latest changes.
4. Review [[Nexova POS - Known Bugs & Fixes]] to avoid repeats.

## Common Tasks
### Add a New Theme
- Add theme block in `style.css`.
- Register in all theme arrays in `app.js`.
- Test across all screens; verify accessibility.

### Add a New UI Component
- Use existing design tokens (`--space-*`, `--color-*`).
- Add CSS in `style.css` (later: move to `components.css`).
- Add JS helpers in `app.js` (later: modularize).

### Fix a Bug
- Check if it’s already documented in [[Nexova POS - Known Bugs & Fixes]].
- If new, add it there after fixing.

## Do’s and Don'ts
- ✅ Use semantic color tokens.
- ✅ Respect `prefers-reduced-motion`.
- ✅ Announce changes to screen readers.
- ❌ Don’t break existing themes.
- ❌ Don’t add Chrome-only features without fallback.
