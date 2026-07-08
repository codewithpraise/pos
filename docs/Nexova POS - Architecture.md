# Nexova POS - Architecture

## Core Concepts
- **Local-first**: SQLite (WAL), CRDT sync, Supabase backup.
- **Multi-client**: Web (`/public`), Android, Desktop (Compose).
- **Offline resilience**: Circuit breaker, monotonic time anchor.

## Key Modules
- `server.js` – Core server
- `database.js` – SQLite + migrations
- `supabase-sync.js` – Cloud backup
- `crdt-engine.js` – Conflict resolution
- `validator.js` – Security/validation
- `/public/app.js` – Web UI logic
- `/public/style.css` – Styles + themes

## Sync Flow
1. Local write → SQLite
2. CRDT merge
3. Supabase sync (if online)
4. Health checks via `/api/health`

## UI Clients
- Web: Vanilla JS + CSS (Obsidian Precision v2 design system)
- Android/Desktop: Kotlin Compose + Material 3
