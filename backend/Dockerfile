# Multi-stage Dockerfile

# ---- Build stage: install all deps and compile TypeScript ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile
COPY . .
RUN npm run build

# ---- Prod-deps stage: install only production dependencies ----
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --frozen-lockfile && npm cache clean --force

# ---- Runtime stage: minimal, non-root, healthcheck ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production \
    PROCESS_ROLE=api \
    PORT=3000

# wget is provided by busybox in alpine and used by the healthcheck
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Run as a non-root user
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

# Single image, multiple process roles selected via PROCESS_ROLE (api|worker|indexer)
CMD ["sh", "-c", "case \"$PROCESS_ROLE\" in worker) exec node dist/worker ;; indexer) exec node dist/indexer ;; *) exec node dist/main ;; esac"]
