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

# The demo seed and its data do not ship.
#
# seed.js and utils/mockData.js carry the demo accounts and the one password
# they all share, and utils/seedData.json carries the rest of the demo
# directory. Nothing the server loads imports any of them — only seed.ts does,
# and seed.ts refuses to run in production anyway — so they were in this image
# for no reason except that tsc compiles everything under src/. A production
# image should hold no credential at all, published or otherwise.
#
# Removing them also means `npm run seed:demo` inside this container fails with
# "Cannot find module" instead of reaching the seed's own refusal. That is the
# better failure: there is nothing here to run.
RUN rm -f dist/seed.js dist/seed.js.map dist/seed.d.ts \
          dist/utils/mockData.js dist/utils/mockData.js.map dist/utils/mockData.d.ts \
          dist/utils/seedData.json

# uploads/ is a mount point for a named volume. Creating it here with the right
# ownership means the container does not need to be root to write to it.
# evidence-store/ is the same arrangement for delivery evidence, and is
# deliberately a separate path: nothing under it is ever served statically.
RUN mkdir -p /app/uploads /app/evidence-store && chown -R node:node /app

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
