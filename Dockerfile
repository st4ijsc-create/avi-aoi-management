# syntax=docker/dockerfile:1.7
# Multi-stage build for avi-aoi-management (Node 20 + pnpm)
ARG NODE_VERSION=20-alpine

# ---- deps stage: install all deps (incl. dev) for build ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ postgresql-client
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod=false

# ---- build stage ----
FROM deps AS build
COPY . .
RUN pnpm run build

# ---- runtime stage ----
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
RUN apk add --no-cache postgresql-client tini && \
    addgroup -S app && adduser -S app -G app
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/knowledge ./knowledge

RUN mkdir -p /app/uploads /app/backups && chown -R app:app /app
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
