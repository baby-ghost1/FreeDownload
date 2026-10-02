# syntax=docker/dockerfile:1.7
#
# Build context MUST be the repository root:
#
#   docker build -f backend/Dockerfile --target api    -t freedownload-api .
#   docker build -f backend/Dockerfile --target worker  -t freedownload-worker .
#
# Multi-stage, non-root, minimal runtime (contract §57).

# ---------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
# NOTE: NODE_ENV stays unset here on purpose — npm omits devDependencies when
# NODE_ENV=production, which would strip typescript from the build stage.

# ---------------------------------------------------------------------------
# Dependency installation — npm workspaces, only the backend workspace.
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace @freedownload/backend --omit=dev

# Build-time deps (typescript, etc.)
FROM base AS deps-build
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace @freedownload/backend

# ---------------------------------------------------------------------------
FROM deps-build AS build
COPY tsconfig.base.json ./
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
RUN npm run build --workspace @freedownload/backend \
 && npm prune --workspace @freedownload/backend --omit=dev

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/backend/dist ./dist
COPY backend/package.json ./package.json
USER app

# ---------------------------------------------------------------------------
FROM runtime AS api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health > /dev/null || exit 1
CMD ["node", "dist/server/server.js"]

# ---------------------------------------------------------------------------
# Worker entrypoint arrives in Phase 3; the target exists now so the image
# pipeline and deploy topology are verified from day one.
FROM runtime AS worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -f "dist/workers/worker.js" > /dev/null || exit 1
CMD ["node", "dist/workers/worker.js"]
