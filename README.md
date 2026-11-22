# RAILGUARD AI Dashboard

Dashboard platform for **RAILGUARD AI** by Resilience Technologies Labs (SMC-Private) Limited, Islamabad
(Ignite SPARK 2026, ref. SPARK-2026-1584). It receives results from Track Units and Crossing Units,
maps them, scores every 100 m track segment 1-5, and lets inspectors confirm or reject alerts.

> "Railway" in hosting terms means **Railway.app**. "Pakistan Railways" is the customer.
> All seeded and simulated data is **DEMO DATA** and is never real Pakistan Railways results.

## Build status

| Stage | Scope | Status |
|---|---|---|
| 1 | Monorepo, shared schemas, database schema + migrations, seed data | **done** |
| 2 | Auth, roles, ingestion API, R2 presigned uploads, simulator | next |
| 3 | Overview, Risk Map, Detections, Inspector Review (offline) | |
| 4 | Risk engine, Crossings, Work Orders, Devices | |
| 5 | Analytics, PDF reports, Pilot Evaluation, Admin | |
| 6 | Tests, CI, deployment configs, final polish | |

## Layout

```
apps/api            Fastify API, Prisma schema, migrations, seed   (Railway.app)
apps/web            Next.js dashboard                              (Vercel)       - stage 3
packages/shared     Zod schemas, enums, geo helpers, risk config types
packages/simulator  Fake Track/Crossing Units                      - stage 2
```

## Local setup

Requires Node 20+, pnpm 10, and Docker.

> **Windows: keep the project in a short path** (for example `C:\Users\you\Downloads\railguard-ai-dashboard`).
> Windows' 260-character path limit stops Prisma's engine and esbuild from starting in deeply nested folders.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # then set JWT secrets
pnpm infra:up                               # PostGIS 16, Redis, MinIO (R2 stand-in)
pnpm db:migrate                             # prisma migrate deploy
pnpm db:seed                                # demo division, 247 segments, 3 crossings, 5 devices, 4 users
```

`pnpm db:seed:dry` builds the demo geography in memory and prints a summary, with no database needed.

If `pnpm install` crashes with `readStream must be readable` (seen with pnpm on Node 24 in some
terminals), use `pnpm install --ignore-scripts`, then run `pnpm db:generate` and
`node node_modules/.pnpm/@prisma+engines*/node_modules/@prisma/engines/scripts/postinstall.js`.

### Demo logins (created only when `DEMO_MODE=true`)

`admin@`, `engineer@`, `inspector@`, `viewer@` + `demo.railguard.example`. The password is
`SEED_DEMO_PASSWORD` from `apps/api/.env`.

## Database

PostgreSQL 16 + PostGIS. `prisma/migrations/*_init` is generated from `schema.prisma`;
`*_postgis_extras` adds GIST indexes, CHECK constraints, partial indexes and the
`segment_latest_risk` view. Geometry columns are `Unsupported(...)` in Prisma, so spatial reads and
writes use raw SQL (`ST_*`).

Key design points:

- `detections.id` and `crossing_events.id` are **client-generated UUIDs**, so store-and-forward
  resends are idempotent (`INSERT ... ON CONFLICT DO NOTHING`). `received_at` is the trusted server time.
- `risk_scores` keeps full history; `components` JSON explains every score.
- Device API keys are stored as SHA-256 hashes of a high-entropy secret (plaintext shown once) and are revocable.
- Refresh tokens are single-use with a `family_id` so reuse of a rotated token revokes the family.
- Every write is meant to go to `audit_log`; every query is scoped by the user's division.
