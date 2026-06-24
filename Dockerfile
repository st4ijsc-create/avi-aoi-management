# syntax=docker/dockerfile:1.7
# Multi-stage build for avi-aoi-management (Node 20 + pnpm).
# Base: Debian glibc (bookworm-slim) — KHÔNG dùng alpine/musl vì native deps nặng
# (onnxruntime-node, sharp, node-llama-cpp, puppeteer) chỉ có prebuilt glibc; trên
# musl chúng lỗi ERR_DLOPEN_FAILED (thiếu ld-linux-x86-64.so.2) khi nạp .so.
ARG NODE_VERSION=20-bookworm-slim

# ---- deps stage: install all deps (incl. dev) for build ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# node-llama-cpp: bỏ qua postinstall build (cần model .gguf mount lúc chạy; engine
# degrade honestly khi không có binding). Tránh git-clone + compile llama.cpp.
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
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
    PORT=3000 \
    NODE_LLAMA_CPP_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client tini wget ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app --home-dir /app app
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

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
