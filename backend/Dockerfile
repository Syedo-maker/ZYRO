# ZYRO API and background worker: one image, two commands.
#   API:      the default command (node dist/index.js)
#   worker:   node dist/worker.js
#   migrate:  build with --target migrate; runs `prisma migrate deploy` once per release, before the
#             new API revision takes traffic (an Azure Container Apps job in production).

FROM node:24-bookworm-slim AS base
# Prisma's query engine links against OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Everything, including the TypeScript compiler and the Prisma CLI.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npx tsc -p tsconfig.json

# Production dependencies only, with the generated Prisma client copied in.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Applies migrations and exits. Kept separate so the running API never carries the Prisma CLI.
FROM deps AS migrate
COPY prisma ./prisma
# Fetches Prisma's engines now, so a release never waits on (or fails at) a download.
RUN npx prisma version
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=5000 \
    LOG_FORMAT=json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 5000
# Node runs as PID 1 and handles SIGTERM itself (lib/lifecycle.ts): it stops taking traffic, finishes
# the requests and jobs in flight, closes its connections, and exits.
CMD ["node", "--enable-source-maps", "dist/index.js"]
