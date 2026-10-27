# 0001: The site and the API share one origin

**Status:** Accepted, 2026-10-21. Replaces the plan of 2026-10-20 to serve the frontend from Azure
Static Web Apps.

## Context

A signed-in merchant's session lives in a refresh token: an `httpOnly`, `SameSite=lax` cookie set by
the API. The access token is kept in memory only, so every page load asks the API for a new one using
that cookie. A browser sends a `SameSite=lax` cookie only to the same site. If the site and the API
had different domains (a Static Web Apps host and a Container Apps host), that request would carry no
cookie, and every reload would sign the merchant out. Development never showed this because the Vite
dev server already proxies `/api`.

## Decision

The frontend runs as a small nginx container that serves the built site and forwards `/api/*` to the
API over the Container Apps environment's private network. The browser sees one origin.

## Alternatives

- **Static Web Apps with a linked backend**: keeps one origin, but its proxy timeout could not be
  confirmed to outlast a 60-second AI generation, and it ties the release of site and API together in
  a way the blue-green release (0007) does not need.
- **`SameSite=None` cookies across domains**: works in some browsers today and is being withdrawn by
  others (third-party cookie restrictions). Sessions would break unpredictably.
- **Tokens in `localStorage`**: readable by any script on the page, so one cross-site scripting bug
  becomes account takeover. Rejected on security grounds.

## Consequences

- The API has no public address; only the web app does. A smaller attack surface.
- One more container (0.25 vCPU), and no CDN in front of the static files until Front Door is added
  (Deployment_Runbook.md, "Hardening after launch").
- Rate limits depend on counting the proxies correctly (`TRUST_PROXY`), checked on staging before
  launch.
- nginx is where the security headers live (`frontend/nginx/`), and the local smoke test is what
  proves they fit the app (it found two that did not).
