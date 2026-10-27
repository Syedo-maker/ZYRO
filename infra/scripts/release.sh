#!/usr/bin/env bash
# Releases one build (already pushed to this environment's registry) to one environment, with no
# downtime and an automatic rollback. Used by .github/workflows/deploy.yml for staging and production.
#
#   release.sh <resource-group> <image-tag>
#
# 1. Remember what is live, and pin all traffic to it.
# 2. Run database migrations with the new build. If they fail, stop: nothing new is running yet.
# 3. Update the worker and the recommendation service.
# 4. Start new revisions of the API and the site, with no traffic, and wait until they are healthy.
# 5. Move traffic to them, then smoke-test the live site.
# 6. If anything from step 3 on fails: move traffic back to the previous revisions (seconds, no
#    rebuild), put the previous worker and recommendation images back, and fail the release.
#
# Migrations must be backward compatible with the release before (add, never remove or rename, in
# one step), because the old revisions keep serving while the new ones start, and after a rollback.
set -euo pipefail

RG="$1"
TAG="$2"
SUFFIX="r$(echo "$TAG" | cut -c1-12 | tr '[:upper:]' '[:lower:]')"

ACR=$(az acr list -g "$RG" --query "[0].name" -o tsv)
REGISTRY=$(az acr show -n "$ACR" --query loginServer -o tsv)
app() { az containerapp list -g "$RG" --query "[?tags.\"azd-service-name\"=='$1'].name | [0]" -o tsv; }
API=$(app api)
WEB=$(app web)
WORKER=$(app worker)
RECO=$(app reco)
JOB=$(az containerapp job list -g "$RG" --query "[0].name" -o tsv)
SITE="https://$(az containerapp show -n "$WEB" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"

live_revision() { az containerapp revision list -n "$1" -g "$RG" --query "sort_by([?properties.trafficWeight > \`0\`], &properties.trafficWeight)[-1].name" -o tsv; }
image_of() { az containerapp show -n "$1" -g "$RG" --query "properties.template.containers[0].image" -o tsv; }

PREV_API=$(live_revision "$API")
PREV_WEB=$(live_revision "$WEB")
PREV_WORKER_IMAGE=$(image_of "$WORKER")
PREV_RECO_IMAGE=$(image_of "$RECO")
echo "Live now: api ${PREV_API}, web ${PREV_WEB}. Releasing ${TAG} to ${SITE}"

# ---- 1. Pin traffic, so a new revision gets none until it has proved itself ----
az containerapp ingress traffic set -n "$API" -g "$RG" --revision-weight "${PREV_API}=100" --only-show-errors >/dev/null
az containerapp ingress traffic set -n "$WEB" -g "$RG" --revision-weight "${PREV_WEB}=100" --only-show-errors >/dev/null

# ---- 2. Migrations ----
az containerapp job update -n "$JOB" -g "$RG" --image "${REGISTRY}/zyro-migrate:${TAG}" --only-show-errors >/dev/null
EXECUTION=$(az containerapp job start -n "$JOB" -g "$RG" --query name -o tsv)
echo "Migrations running: ${EXECUTION}"
while :; do
  STATUS=$(az containerapp job execution show -n "$JOB" -g "$RG" --job-execution-name "$EXECUTION" --query properties.status -o tsv)
  case "$STATUS" in
    Succeeded) echo "Migrations applied."; break ;;
    Failed|Stopped|Degraded) echo "::error::Migrations ${STATUS}. Nothing new was deployed; the live site is unchanged." >&2; exit 1 ;;
    *) sleep 10 ;;
  esac
done

rollback() {
  echo "::error::$1. Rolling back."
  az containerapp ingress traffic set -n "$API" -g "$RG" --revision-weight "${PREV_API}=100" --only-show-errors >/dev/null || true
  az containerapp ingress traffic set -n "$WEB" -g "$RG" --revision-weight "${PREV_WEB}=100" --only-show-errors >/dev/null || true
  az containerapp update -n "$WORKER" -g "$RG" --image "$PREV_WORKER_IMAGE" --only-show-errors >/dev/null || true
  az containerapp update -n "$RECO" -g "$RG" --image "$PREV_RECO_IMAGE" --only-show-errors >/dev/null || true
  az containerapp revision deactivate -n "$API" -g "$RG" --revision "${API}--${SUFFIX}" --only-show-errors >/dev/null 2>&1 || true
  az containerapp revision deactivate -n "$WEB" -g "$RG" --revision "${WEB}--${SUFFIX}" --only-show-errors >/dev/null 2>&1 || true
  echo "Rolled back to api ${PREV_API}, web ${PREV_WEB}."
  exit 1
}

# ---- 3. Background services ----
az containerapp update -n "$WORKER" -g "$RG" --image "${REGISTRY}/zyro-api:${TAG}" --only-show-errors >/dev/null || rollback "The worker did not update"
az containerapp update -n "$RECO" -g "$RG" --image "${REGISTRY}/zyro-reco:${TAG}" --only-show-errors >/dev/null || rollback "The recommendation service did not update"

# ---- 4. New revisions, no traffic yet ----
az containerapp update -n "$API" -g "$RG" --image "${REGISTRY}/zyro-api:${TAG}" --revision-suffix "$SUFFIX" --only-show-errors >/dev/null || rollback "The API revision was not created"
az containerapp update -n "$WEB" -g "$RG" --image "${REGISTRY}/zyro-web:${TAG}" --revision-suffix "$SUFFIX" --only-show-errors >/dev/null || rollback "The site revision was not created"

wait_healthy() {
  for _ in $(seq 1 60); do
    HEALTH=$(az containerapp revision show -n "$1" -g "$RG" --revision "$1--${SUFFIX}" --query properties.healthState -o tsv 2>/dev/null || echo Unknown)
    [ "$HEALTH" = "Healthy" ] && return 0
    [ "$HEALTH" = "Unhealthy" ] && return 1
    sleep 10
  done
  return 1
}
wait_healthy "$API" || rollback "The new API revision never became healthy (its readiness probe checks the databases, Redis and storage)"
wait_healthy "$WEB" || rollback "The new site revision never became healthy"

# ---- 5. Move traffic, then check the live site ----
az containerapp ingress traffic set -n "$API" -g "$RG" --revision-weight "${API}--${SUFFIX}=100" --only-show-errors >/dev/null
az containerapp ingress traffic set -n "$WEB" -g "$RG" --revision-weight "${WEB}--${SUFFIX}=100" --only-show-errors >/dev/null

sleep 15
smoke() {
  curl -fsS --max-time 10 "${SITE}/healthz" >/dev/null &&
    curl -fsS --max-time 10 "${SITE}/" | grep -q 'id="root"' &&
    curl -fsS --max-time 15 "${SITE}/api/v1/plans" | grep -q '"tier"' &&
    curl -fsS --max-time 15 "${SITE}/api/v1/stores?limit=1" >/dev/null
}
for attempt in 1 2 3; do
  if smoke; then
    echo "Released ${TAG}: ${SITE}"
    exit 0
  fi
  echo "Smoke test attempt ${attempt} failed; retrying."
  sleep 10
done
rollback "The live site failed its smoke test after the switch"
