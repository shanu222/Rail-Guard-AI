# RAILGUARD AI Dashboard

Dashboard platform for **RAILGUARD AI** by Resilience Technologies Labs (SMC-Private) Limited, Islamabad
(Ignite SPARK 2026, ref. SPARK-2026-1584). It receives results from Track Units and Crossing Units,
maps them, scores every 100 m track segment 1–5, and lets inspectors confirm or reject alerts.

> "Railway" in hosting terms means **Railway.app**. "Pakistan Railways" is the customer.
> All seeded and simulated data is **DEMO DATA** and must never be presented as real Pakistan Railways results.
> The UI shows a `DEMO DATA` badge whenever `DEMO_MODE=true`. Risk scores are labelled "Decision aid — confirm on site".

## Layout

```
apps/api            Fastify API + BullMQ worker + Prisma/PostGIS schema, migrations, seed   → Railway.app
apps/web            Next.js 14 dashboard (Tailwind, TanStack Query, Recharts, MapLibre)     → Vercel
packages/shared     Zod schemas, enums, role permissions, geo helpers, risk-config types
packages/simulator  Fake edge devices (2 Track + 3 Crossing Units) using the real ingestion API
```

## Local setup

Requirements: Node 20+, pnpm 10 (`corepack enable`), Docker.

> **Windows: keep the project in a short path** (e.g. `C:\Users\you\railguard-ai-dashboard`). The 260-character
> path limit stops Prisma's engine and esbuild from starting in deeply nested folders.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # set JWT_ACCESS_SECRET (and the others if you like)
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up                                  # PostGIS 16, Redis, MinIO (R2 stand-in, bucket railguard-media)
pnpm db:migrate                                # prisma migrate deploy
pnpm db:seed                                   # demo division, 247 segments, 3 crossings, 5 devices, 4 users
pnpm dev                                       # API on :4000 (docs at /docs), web on :3000
```

In a second terminal, generate demo data through the real ingestion API:

```bash
pnpm sim backfill --days 45    # history: detections (with images in MinIO), crossing events, runs
pnpm sim run                   # live loop: heartbeats, detections, events, offline/resend cycles
pnpm sim offline-test          # sends a batch twice; verifies the resend is de-duplicated
```

Optionally run the worker for scheduled jobs (nightly risk recalculation, offline-device watch, snapshot purge).
Without `REDIS_URL` the API runs those jobs in-process, which is fine for development:

```bash
pnpm --filter @railguard/api dev:worker   # needs REDIS_URL
```

**Demo logins** (created only when `DEMO_MODE=true`): `admin@`, `engineer@`, `inspector@`, `viewer@` +
`demo.railguard.example`; password = `SEED_DEMO_PASSWORD` from `apps/api/.env`.

If `pnpm install` crashes with `readStream must be readable` (seen with pnpm on Node 24 in some terminals), use
`pnpm install --ignore-scripts`, then run `pnpm db:generate` and
`node node_modules/.pnpm/@prisma+engines*/node_modules/@prisma/engines/scripts/postinstall.js`.

### Tests and checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                                      # shared + API unit/smoke tests (Vitest)
TEST_DATABASE_URL=postgresql://railguard:railguard@localhost:5432/railguard pnpm --filter @railguard/api test   # + ingestion idempotency on real PostGIS
pnpm --filter @railguard/web e2e               # Playwright: login, review (incl. offline), work orders (stack must be running + simulator backfill)
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, Prettier, strict type-check and tests on every push, plus
PostGIS integration tests and the Playwright suite.

## How it works

**Ingestion** (`/v1/ingest/*`, header `x-api-key`): heartbeat, detections, crossing events, runs, presigned upload URLs.
Batches are **idempotent** (client-generated UUIDs + `ON CONFLICT DO NOTHING`), accept gzip, are size-limited and
rate-limited per device, and never trust device time (future timestamps are clamped; `received_at` is server time).
Detections are snapped to the nearest 100 m segment within 50 m.

**Risk engine** (`apps/api/src/risk/engine.ts`, pure and unit-tested) — runs on new detections, nightly, on review/work-order
changes and when weights change:

```
defect = Σ severity(1/3/6) × confidence × 0.5^(days/30) × review(CONFIRMED 1.5, PENDING 1, REJECTED 0)   (90-day window)
trend  = max(0, defect − defect as of 30 days ago)
heat   = heat_exposure × (1 if forecast max ≥ 45 °C else 0.5)
flood  = flood_exposure × (1 if rain72h ≥ 50 mm or flood flag else 0.4)
local  = 0.3·curve + 0.4·bridge + 0.3·near_crossing
raw    = 0.45·defect + 0.15·trend + 0.15·heat + 0.15·flood + 0.10·local        (weights editable by Admin / Engineer)
score  = 1–5 by quantile (or absolute) thresholds
```

Every stored score keeps its components, so the Risk Map side panel explains it. The Admin → Risk weights tab previews
the effect on all segments before saving.

**Inspector Review** (`/review`) is mobile-first and works offline: a service worker caches the app shell, the queue is
cached in IndexedDB, and decisions + field photos are stored locally and replayed when the network returns.

**Privacy:** crossing snapshots are shown as "privacy protected" (faces/plates are blurred on the device) and are
deleted after `snapshot_retention_days` (default 30; only metadata is kept). Media is private in R2 and served only
through 5-minute presigned URLs after an access check.

## Deploy

### 1. Cloudflare (R2 + DNS/WAF)

1. **R2 → Create bucket** `railguard-media` (keep it private).
2. **R2 → Manage API tokens → Create** an *Object Read & Write* token scoped to that bucket. Note the Account ID, Access Key ID, Secret.
3. Bucket **CORS** (so browsers can PUT inspector photos via presigned URLs):
   ```json
   [{ "AllowedOrigins": ["https://YOUR-APP.vercel.app"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
4. Bucket **lifecycle rules** (belt and braces with the app's own purge): expire objects with prefix `snapshot/` after 30 days; abort incomplete multipart uploads after 1 day.
5. **DNS:** add `api.<your-domain>` as a CNAME to the Railway domain, **proxied** (orange cloud). SSL/TLS mode *Full (strict)*.
6. **Security → WAF → Rate limiting rules:** `/v1/ingest/*` (e.g. 300 req/min per IP) and `/auth/*` (e.g. 30 req/min per IP) → block 10 min.

### 2. Railway.app (API, worker, Postgres, Redis)

1. New project → **Add PostgreSQL**. Use the PostGIS image (`postgis/postgis:16-3.4` as a Docker image service) or confirm `CREATE EXTENSION postgis` works on your Postgres; the first migration runs it.
2. **Add Redis.**
3. **Add service `api`** from this GitHub repo. Settings → *Config as code path*: `/railway.json` (uses `apps/api/Dockerfile`; migrations run on every deploy).
4. **Add service `worker`** from the same repo with config path `/railway.worker.json` (same image, `node dist/worker.js`).
5. Set variables on **both** services (`apps/api/.env.example` lists everything):
   `DATABASE_URL`, `REDIS_URL` (Railway reference variables), `JWT_ACCESS_SECRET` (random 48+ bytes), `CORS_ORIGIN=https://YOUR-APP.vercel.app`,
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=railguard-media` (leave `R2_ENDPOINT` unset), `NODE_ENV=production`,
   `DEMO_MODE=true` **only** while you are demonstrating with simulated data.
6. Add the custom domain `api.<your-domain>` to the `api` service. Check `https://api.<your-domain>/health` and `/docs`.
7. Create the first Admin (the demo seed is for demos only). From your machine, with the production `DATABASE_URL` exported:
   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='a-long-Passw0rd-here' pnpm --filter @railguard/api create-admin
   ```
   Then create divisions, sections (upload GeoJSON/KML), crossings and devices from the Admin screen.

### 3. Vercel (web)

1. Import the repo; **Root Directory** `apps/web` (the included `vercel.json` installs from the monorepo root).
2. Environment variables: `NEXT_PUBLIC_API_URL=https://api.<your-domain>`, `NEXT_PUBLIC_WS_URL=https://api.<your-domain>`, `NEXT_PUBLIC_DEMO_MODE=true|false`.
3. Deploy, then put the Vercel URL into the API's `CORS_ORIGIN`.

> The refresh-token cookie is `SameSite=None; Secure` in production because web and API are on different sites. If you
> serve the web app from a subdomain of the same domain (e.g. `app.<your-domain>`), you can tighten it to `Lax`.

## Add a real device

1. Admin → **Devices → Register device** (type, serial, name, division). Copy the API key shown **once** (rotate/revoke any time).
2. For a Crossing Unit, link it to a crossing in Admin → Sections & crossings.
3. The firmware calls the API with `x-api-key: rgk_…`:
   ```bash
   curl -X POST https://api.<your-domain>/v1/ingest/heartbeat -H "x-api-key: $KEY" -H "content-type: application/json" \
     -d '{"deviceTime":"2026-06-01T08:00:00+05:00","firmwareVersion":"1.0.0","modelVersion":"1.0.0","batteryPct":82,"network":"LTE_4G"}'
   ```
   - `POST /v1/ingest/upload-url` → presigned PUT for an image/audio clip, then reference the returned `key` as `imageKey`/`audioKey`.
   - `POST /v1/ingest/detections` / `crossing-events` → `{ "items": [...] }`, each item with a **client-generated UUID** so store-and-forward resends are safe. Gzip the body with `content-encoding: gzip` if you like.
   - Full schemas: `https://api.<your-domain>/docs`.

## Honest status notes

- The code type-checks, lints, builds (`next build`), and the unit/smoke tests pass. The **SQL-heavy paths** (spatial queries, ingestion
  idempotency, analytics) are covered by the PostGIS integration/e2e tests that run in CI, but were **not executed against a live database
  while this was authored** (no Docker on the authoring machine) — run `pnpm infra:up && pnpm db:migrate && pnpm db:seed` and the test suites first.
- Recall figures on the Pilot page are **entered by an Admin** from a labelled test set (they cannot be derived from reviews). Precision and
  uptime are computed live. Nothing is pre-filled with invented numbers.
- Inspection time saved needs the admin-entered baseline (minutes/km) and ingested runs.
- Urdu: layouts use logical properties and an RTL toggle is included, but UI strings are English only.
- No paid service beyond those named in the brief (Vercel, Railway.app, Cloudflare R2/DNS/WAF) is used. Cloudflare Images is not enabled.
