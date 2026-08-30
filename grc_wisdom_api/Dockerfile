# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate the Prisma client and compile TypeScript.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate && npx tsc

# ── Stage 2: Runtime ────────────────────────────────────────────
FROM node:22-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# dumb-init reaps zombies and forwards SIGTERM, so `docker compose down` stops
# the process cleanly instead of waiting out the 10s kill timeout.
RUN apk add --no-cache dumb-init

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
COPY prisma.config.ts ./

# Prisma reads DATABASE_URL at generate time only to know the provider; the
# value here is never connected to.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

COPY --from=builder /app/dist ./dist

# uploads/ is a mount point for a named volume. Creating it here with the right
# ownership means the container does not need to be root to write to it.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

# Migrations are idempotent and must complete before the server accepts traffic.
#
# The seed is deliberately NOT run here. It opens with 58 deleteMany() calls,
# so the previous CMD — `prisma db push --accept-data-loss && node dist/seed.js`
# — destroyed every tenant's data on each restart. Reference data is loaded by
# `npm run provision`, which only upserts.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
