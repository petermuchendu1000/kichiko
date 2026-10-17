# syntax=docker/dockerfile:1
# Elopis production image (Module 16.2)
# Multi-stage: deps -> build -> minimal non-root runtime serving Next standalone.
# The app lives in apps/web inside an npm-workspaces monorepo; next.config.js
# sets `output: 'standalone'` + `outputFileTracingRoot` (repo root) so the
# standalone bundle mirrors the monorepo layout (apps/web/server.js + traced
# node_modules). Runtime runs as a non-root user with a /api/health HEALTHCHECK.

# Pin the exact patch for reproducibility (matches CI Node 20).
FROM node:26.11.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ---- Dependencies (lockfile-exact, whole workspace) ----
FROM base AS deps
# Root lockfile + every workspace manifest so `npm ci` resolves the graph.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
# npm decides for itself what to hoist. With the current lockfile it puts
# everything at the root and creates no apps/web/node_modules at all, and the
# builder stage below copies that path unconditionally, so the build died with
# `"/app/apps/web/node_modules": not found` the first time the tree deduped
# that way. Which packages get nested is not something this image should have
# an opinion about, so guarantee the directory exists and let the COPY be a
# no-op when npm nested nothing.
RUN mkdir -p /app/apps/web/node_modules

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

# FAIL THE BUILD, NOT PRODUCTION.
#
# These three are baked into the bundle by `next build`; they are NOT read from
# the environment at runtime, so a Fly secret of the same name cannot repair an
# image built without them. Omit the --build-arg flags and the build still
# succeeds, the image still starts, the health check still answers for a while
# — and then middleware.js throws "Your project's URL and Key are required to
# create a Supabase client!" on EVERY request, including the health route.
#
# That is exactly what happened on 2026-10-16: a hand-run `flyctl deploy`
# without --build-arg replaced all three machines with an image that 500'd on
# every request, and elopis.com was down for about eight minutes until the
# previous image was redeployed. deploy-staging.yml passes the flags; a human
# running flyctl by hand had nothing to remind them.
#
# Three lines here turn that outage into a build failure, which is the only
# place this is cheap to catch. Checked individually so the message names the
# one that is missing.
# Checked by NAME, not by value. The first cut wrote `test -n "$VAR"`, and
# BuildKit echoes a RUN line with its ENV references already substituted — so
# the build log printed the Supabase URL and anon key in full. Both are public
# by design (the anon key ships to every browser and is bounded by RLS), so
# nothing was exposed that is not already, but a build log is the wrong place
# to learn that habit: the next argument added here might not be public.
# Dereferencing `$v` inside the shell keeps values out of the echoed command.
RUN for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_APP_URL; do \
      eval "val=\${$v:-}"; \
      [ -n "$val" ] || { echo "FATAL: --build-arg $v is required (baked in at build time by next build; a runtime secret cannot repair an image built without it)"; exit 1; }; \
    done

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

# The scheduler's clock (fly.toml `cron` process group). The standalone output
# contains only the app, so without this COPY the cron machine starts, finds no
# such file and restart-loops. It is plain Node with no dependencies, which is
# why it can live outside the traced bundle.
COPY --chown=nextjs:nodejs scripts/cron-pinger.mjs ./scripts/cron-pinger.mjs

USER nextjs
EXPOSE 3000

# Liveness/readiness: the M13 structured health endpoint (busybox wget on alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
