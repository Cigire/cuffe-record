# The Cuffe Record

A family archive site: Overview, Family Tree, Archive, Photos, accounts and admin.

- `public/` static front end (vanilla JS)
- `api/index.js` single serverless function; `vercel.json` rewrites every `/api/...` path to it
- `lib/` auth, people/privacy rules, storage (Neon Postgres via `DATABASE_URL`)
- `data/people.json` seed data; copied into the database on first run, and never overwrites admin edits

Environment variables: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_SETUP_CODE`.

Local test server: `npm install && npm run dev` (uses a local folder instead of Neon).
