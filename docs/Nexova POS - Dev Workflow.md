# Nexova POS - Dev Workflow

## Local Development
1. `npm start` – Start dev server
2. Open Chrome (WebUSB dependency)
3. Test offline/online behavior

## Testing
- `npm test` – Unit tests
- `npm run test:e2e` – E2E tests
- Visual verification of all 6 themes

## Code Style
- CSS: BEM-like classes, design tokens in `:root`
- JS: Modular functions in `app.js` (to be split later)
- Commit messages: descriptive, reference issues

## Deployment
- Push to main → auto-deploy (if you have CI/CD)
- Sync `public/` changes to Android assets
