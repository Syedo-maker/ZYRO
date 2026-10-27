#!/bin/sh
# Applies database migrations for the current azd environment, the same way the release pipeline
# does: build the migrate image in the registry, point the migration job at it, run it once, and
# stop the deployment if it fails. Safe to run again: Prisma applies only migrations not yet applied.
set -eu

eval "$(azd env get-values)"
: "${AZURE_RESOURCE_GROUP:?run azd provision first}"
: "${AZURE_CONTAINER_REGISTRY_NAME:?run azd provision first}"
: "${MIGRATE_JOB_NAME:?run azd provision first}"

TAG="migrate-$(date -u +%Y%m%d%H%M%S)"
IMAGE="${AZURE_CONTAINER_REGISTRY_ENDPOINT}/zyro-migrate:${TAG}"

echo "Building ${IMAGE} in the registry"
az acr build --registry "$AZURE_CONTAINER_REGISTRY_NAME" --image "zyro-migrate:${TAG}" --target migrate ./backend --only-show-errors

az containerapp job update --name "$MIGRATE_JOB_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --image "$IMAGE" --only-show-errors >/dev/null
EXECUTION=$(az containerapp job start --name "$MIGRATE_JOB_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --query name -o tsv)
echo "Migration running: ${EXECUTION}"

while :; do
  STATUS=$(az containerapp job execution show --name "$MIGRATE_JOB_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --job-execution-name "$EXECUTION" --query properties.status -o tsv)
  case "$STATUS" in
    Succeeded) echo "Migrations applied."; exit 0 ;;
    Failed|Stopped|Degraded) echo "Migration ${STATUS}. The release stops here; nothing new was deployed." >&2; exit 1 ;;
    *) sleep 10 ;;
  esac
done
