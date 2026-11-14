# ZYRO web: the built React app, served by nginx, which also forwards /api to the API (see
# nginx/default.conf.template for why the two must share one origin).

FROM node:24.22.2-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# The development setup (compose.dev.yaml) runs the Vite dev server from the stage above, with the
# source mounted in; production builds the site here.
FROM deps AS build
COPY . .
# No VITE_API_URL: the app calls the relative /api/v1, which nginx forwards.
RUN npm run build

# The unprivileged variant runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine AS runtime
COPY nginx/security-headers.inc.template /etc/nginx/templates/security-headers.inc.template
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:5000     FILES_ORIGIN=""
# The base image already runs as this unprivileged user (uid 101); said explicitly so it cannot drift.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
