# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first (Docker layer cache)
COPY package.json package-lock.json ./

# Install ALL deps (dev + prod) so TypeScript & Prisma CLI are available
RUN npm ci

# Copy the rest of the source
COPY . .

# Generate Prisma Client and compile TypeScript
RUN npx prisma generate && npx tsc

# ── Stage 2: Production ────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Copy dependency manifests and install production-only deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy Prisma schema + config (needed by Prisma Client at runtime)
COPY prisma ./prisma
COPY prisma.config.ts ./

# Re-generate Prisma Client against the production node_modules
RUN npx prisma generate

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Expose the port Railway will route to
EXPOSE 3000

# Start: push schema to DB, seed, then run the server
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/seed.js && node dist/server.js"]
