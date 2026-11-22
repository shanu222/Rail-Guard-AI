# Build context = repository root:  docker build -f apps/api/Dockerfile .
# One image serves both Railway services: `api` (default CMD) and `worker` (start command override).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
# manifests of the other workspace projects so the frozen lockfile matches the workspace
COPY apps/web/package.json apps/web/package.json
COPY packages/simulator/package.json packages/simulator/package.json
COPY apps/api apps/api

RUN pnpm install --frozen-lockfile --filter @railguard/api...
RUN pnpm --filter @railguard/api prisma:generate && pnpm --filter @railguard/api build

ENV NODE_ENV=production
EXPOSE 4000
WORKDIR /repo/apps/api
# Apply migrations on every deploy, then start. (Worker: `node dist/worker.js`, no migrate.)
CMD ["sh", "-c", "pnpm prisma:deploy && node dist/server.js"]
