# ============================================================
#  NestJS API — Multi-stage Docker Build
# ============================================================

# ---- Stage 1: Build ----
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./

# Copy API package files
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy Prisma schema first (for layer caching)
COPY apps/api/prisma ./apps/api/prisma

# Generate Prisma Client
RUN npx prisma generate --schema=./apps/api/prisma/schema.prisma

# Copy API source code
COPY apps/api ./apps/api

# Build the NestJS application
RUN npm run build --prefix apps/api

# ---- Stage 2: Production ----
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules
RUN apk add --no-cache tini

# Copy root package files
COPY package.json package-lock.json ./

# Copy API package files
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy Prisma schema and generated client
COPY apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy seed file (optional, for init scripts)
COPY apps/api/seed.ts ./apps/api/seed.ts

WORKDIR /app/apps/api

# Expose API port
EXPOSE 8000

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the production server
CMD ["node", "dist/main"]