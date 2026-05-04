# ============================================================
#  Next.js Web — Multi-stage Docker Build
# ============================================================

# ---- Stage 1: Dependencies ----
FROM node:22-alpine AS deps

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Copy Web package files
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# ---- Stage 2: Build ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy root config files
COPY package.json ./

# Copy Web source code
COPY apps/web ./apps/web

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js application (standalone mode)
RUN npm run build --prefix apps/web

# ---- Stage 3: Production ----
FROM node:22-alpine AS production

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
# Copy static assets
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# Copy public assets
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

# Start the Next.js production server
CMD ["node", "apps/web/server.js"]