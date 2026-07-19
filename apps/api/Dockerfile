# ============================================================
#  NestJS API — Multi-stage Docker Build
# ============================================================

# ---- Stage 1: Build ----
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (bcrypt) and OpenSSL for Prisma
RUN apk add --no-cache python3 make g++ openssl

# Copy API package files
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/

# Install API dependencies inside the API package directory
RUN npm ci --prefix apps/api

# Copy Prisma schema first (for layer caching)
COPY apps/api/prisma ./apps/api/prisma

# Generate Prisma Client
WORKDIR /app/apps/api
RUN npx prisma generate --schema=./prisma/schema.prisma

# Copy API source code
COPY apps/api ./

# Build the NestJS application
RUN npm run build

# ---- Stage 2: Production ----
FROM node:22-alpine AS production

WORKDIR /app

# Install runtime dependencies for native modules and Prisma
RUN apk add --no-cache tini openssl

# Create non-root user
RUN addgroup -S oneerp && adduser -S oneerp -G oneerp

# Copy API package files
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/

# Install production dependencies only
RUN npm ci --omit=dev --prefix apps/api && chown -R oneerp:oneerp /app

# Copy Prisma schema and generated client
COPY apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy seed file (optional, for init scripts)
COPY apps/api/seed.ts ./apps/api/seed.ts

RUN chown -R oneerp:oneerp /app

WORKDIR /app/apps/api

# Expose API port
EXPOSE 8000

USER oneerp

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the production server
CMD ["node", "dist/src/main.js"]
