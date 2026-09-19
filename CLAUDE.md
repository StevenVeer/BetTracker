# BetTracker

Personal, single-user bet tracker (React + Vite frontend, Express + Postgres backend), run locally via Docker Compose (`bettracker-db-1`, `bettracker-api-1`, `bettracker-web-1`; web on http://localhost:6070).

## Deploy after every change

After any edit to `server/`, `src/`, `index.html`, `nginx.conf`, or their Dockerfiles, automatically rebuild and restart the affected container(s) — do not ask for confirmation first, this is pre-authorized:

```bash
docker compose build <api and/or web> && docker compose up -d <api and/or web>
```

- Only rebuild `db` if `docker-compose.yml` itself changes (schema changes go through `server/db.js`'s `ensureSchema()`, which runs automatically on `api` startup and is additive/idempotent).
- After restarting, check `docker logs bettracker-api-1 --tail 30` for a clean startup (no crash loop) before considering the change done.
- This runs against the user's real local database — schema changes must stay additive (`create table if not exists`, `add column if not exists`) like the existing migrations in `server/db.js`, never destructive, so it's safe to apply automatically.
