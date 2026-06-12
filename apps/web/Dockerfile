# ============================================================
#  Next.js Web — Multi-stage Docker Build
# ============================================================

# ---- Stage 1: Dependencies ----
FROM node:22-alpine AS deps

WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN npm ci --prefix apps/web

# ---- Stage 2: Build ----
FROM node:22-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL=/api/proxy
ARG API_BASE_URL=http://api:8000

COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV API_BASE_URL=${API_BASE_URL}

RUN npm run build --prefix apps/web

# ---- Stage 3: Production ----
FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup -S oneerp && adduser -S oneerp -G oneerp

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

RUN chown -R oneerp:oneerp /app

EXPOSE 3000
USER oneerp

CMD ["node", "apps/web/server.js"]
