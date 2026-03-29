# ── Stage 1: Build (installs ALL deps, compiles frontend) ────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy manifests first – Docker caches this layer if they haven't changed
COPY package*.json ./
COPY prisma ./prisma/

# Install all deps (including devDeps needed for Vite build)
RUN npm ci --frozen-lockfile

# Copy source and build
COPY . .
RUN npm run build
RUN npx prisma generate


# ── Stage 2: Production image (lean, no devDeps) ─────────────────────────────
FROM node:20-bookworm-slim AS production

WORKDIR /app

# Security: run as non-root user
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r appgroup \
  && useradd -r -g appgroup appuser

# Copy production deps only
COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev && npm cache clean --force

# Copy compiled artefacts and generated Prisma client from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy application source (server, services, configs, etc.)
COPY --chown=appuser:appgroup . .

# Remove devDep source files not needed at runtime
RUN rm -rf src/ *.config.{js,cjs,ts} postcss.config.cjs tailwind.config.js \
    hf_*.js index.js taivley-test.js test_*.cjs

USER appuser

# Expose and set NODE_ENV
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Health check so orchestrators know when the container is ready
HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

# Graceful shutdown: use JSON array (exec form) to receive SIGTERM correctly
CMD ["node", "server.js"]

