# syntax=docker/dockerfile:1
# Kichiko production image (Module 16.2)
# Multi-stage: deps -> build -> minimal non-root runtime serving Next standalone.
# The app lives in apps/web inside an npm-workspaces monorepo; next.config.js
# sets `output: 'standalone'` + `outputFileTracingRoot` (repo root) so the
# standalone bundle mirrors the monorepo layout (apps/web/server.js + traced
# node_modules). Runtime runs as a non-root user with a /api/health HEALTHCHECK.

# Pin the exact patch for reproducibility (matches CI Node 20).
FROM node:20.18.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ---- Dependencies (lockfile-exact, whole workspace) ----
FROM base AS deps
# Root lockfile + every workspace manifest so `npm ci` resolves the graph.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

# ---- Builder ----
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# Public build-time env (baked into the client bundle). Non-secret by design.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build

# ---- Runner (minimal, non-root) ----
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone server + traced deps (layout rooted at the monorepo root).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# Liveness/readiness: the M13 structured health endpoint (busybox wget on alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
