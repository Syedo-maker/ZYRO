# Applies database migrations for the current azd environment. See migrate.sh for what and why.
$ErrorActionPreference = 'Stop'

$values = @{}
azd env get-values | ForEach-Object {
  if ($_ -match '^([^=]+)="?(.*?)"?$') { $values[$Matches[1]] = $Matches[2] }
}
foreach ($name in 'AZURE_RESOURCE_GROUP', 'AZURE_CONTAINER_REGISTRY_NAME', 'AZURE_CONTAINER_REGISTRY_ENDPOINT', 'MIGRATE_JOB_NAME') {
  if (-not $values[$name]) { throw "$name is not set: run azd provision first" }
}

$tag = 'migrate-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$image = "$($values.AZURE_CONTAINER_REGISTRY_ENDPOINT)/zyro-migrate:$tag"

Write-Host "Building $image in the registry"
az acr build --registry $values.AZURE_CONTAINER_REGISTRY_NAME --image "zyro-migrate:$tag" --target migrate ./backend --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'The migrate image did not build' }

az containerapp job update --name $values.MIGRATE_JOB_NAME --resource-group $values.AZURE_RESOURCE_GROUP --image $image --only-show-errors | Out-Null
$execution = az containerapp job start --name $values.MIGRATE_JOB_NAME --resource-group $values.AZURE_RESOURCE_GROUP --query name -o tsv
Write-Host "Migration running: $execution"

while ($true) {
  $status = az containerapp job execution show --name $values.MIGRATE_JOB_NAME --resource-group $values.AZURE_RESOURCE_GROUP --job-execution-name $execution --query properties.status -o tsv
  switch ($status) {
    'Succeeded' { Write-Host 'Migrations applied.'; exit 0 }
    { $_ -in 'Failed', 'Stopped', 'Degraded' } { Write-Error "Migration $status. The release stops here; nothing new was deployed."; exit 1 }
    default { Start-Sleep -Seconds 10 }
  }
}
