// ZYRO on Azure: one environment (staging or production) per deployment.
//
//   azd env new zyro-staging    then  azd provision
//   azd env new zyro-prod       then  azd provision   (with ZYRO_PRODUCTION=true)
//
// Nothing here has been deployed. documentation/Deployment_Runbook.md is the order of operations,
// and .azure/deployment-plan.md the decisions behind this template.
targetScope = 'subscription'

@minLength(1)
@maxLength(20)
@description('The azd environment name, for example zyro-staging. Names every resource.')
param environmentName string

@minLength(1)
@description('Azure region. UAE North is the nearest to Pakistan.')
param location string

@description('Production sizing, warm replicas, longer backups and purge protection.')
param isProduction bool = false

@description('A custom domain bound to the site (for example shop.zyro.pk). Empty uses the Azure address.')
param customDomain string = ''

// ---- Secrets: supplied through the azd environment, stored only in Key Vault ----

@secure()
@description('PostgreSQL administrator password. Letters and digits, at least 24.')
param postgresAdminPassword string

@secure()
@description('Signs login tokens. A random string of at least 32 characters.')
param jwtAccessSecret string

@secure()
@description('The MongoDB Atlas connection string (an Atlas cluster in the same Azure region).')
param mongodbUri string

@secure()
@description('Shared between the API and the recommendation service. A random string.')
param recommendationServiceToken string

@secure()
param stripeSecretKey string = ''
@secure()
param stripeWebhookSecret string = ''
@secure()
param anthropicApiKey string = ''
@secure()
param sendgridApiKey string = ''
param sendgridFromEmail string = ''

// ---- Images: set by azd after the first deploy; empty runs a placeholder until then ----
param webImage string = ''
param apiImage string = ''
param recoImage string = ''
param migrateImage string = ''

var tags = { 'azd-env-name': environmentName, product: 'zyro' }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: { name: environmentName, location: location, tags: tags, retentionInDays: isProduction ? 90 : 30 }
}

module identities 'modules/identities.bicep' = {
  name: 'identities'
  scope: rg
  params: { name: environmentName, location: location, tags: tags }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  scope: rg
  params: {
    name: environmentName
    location: location
    tags: tags
    pullPrincipalIds: [identities.outputs.appPrincipalId, identities.outputs.recoPrincipalId]
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  scope: rg
  params: {
    name: environmentName
    location: location
    tags: tags
    readerPrincipalIds: [identities.outputs.appPrincipalId, identities.outputs.recoPrincipalId]
    purgeProtection: isProduction
    secrets: {
      'jwt-access-secret': jwtAccessSecret
      'mongodb-uri': mongodbUri
      'recommendation-service-token': recommendationServiceToken
      'stripe-secret-key': stripeSecretKey
      'stripe-webhook-secret': stripeWebhookSecret
      'anthropic-api-key': anthropicApiKey
      'sendgrid-api-key': sendgridApiKey
    }
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    name: environmentName
    location: location
    tags: tags
    appPrincipalId: identities.outputs.appPrincipalId
    skuName: isProduction ? 'Standard_ZRS' : 'Standard_LRS'
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  scope: rg
  params: {
    name: environmentName
    location: location
    tags: tags
    administratorPassword: postgresAdminPassword
    skuName: isProduction ? 'Standard_B2s' : 'Standard_B1ms'
    storageSizeGB: isProduction ? 64 : 32
    backupRetentionDays: isProduction ? 14 : 7
    geoRedundantBackup: isProduction
    keyVaultName: keyVault.outputs.name
  }
}

module redis 'modules/redis.bicep' = {
  name: 'redis'
  scope: rg
  params: {
    name: environmentName
    location: location
    tags: tags
    skuName: isProduction ? 'Balanced_B1' : 'Balanced_B0'
    highAvailability: isProduction
    keyVaultName: keyVault.outputs.name
  }
}

module apps 'modules/apps.bicep' = {
  name: 'apps'
  scope: rg
  // The apps read the database-url secret that the database module writes (Redis is already a
  // dependency through its host name).
  dependsOn: [postgres]
  params: {
    name: environmentName
    location: location
    tags: tags
    workspaceName: monitoring.outputs.workspaceName
    appInsightsName: monitoring.outputs.appInsightsName
    registryLoginServer: registry.outputs.loginServer
    keyVaultUri: keyVault.outputs.uri
    appIdentityId: identities.outputs.appId
    appIdentityClientId: identities.outputs.appClientId
    recoIdentityId: identities.outputs.recoId
    storageBlobEndpoint: storage.outputs.blobEndpoint
    redisHostName: redis.outputs.hostName
    isProduction: isProduction
    hasStripe: !empty(stripeSecretKey) && !empty(stripeWebhookSecret)
    hasAnthropic: !empty(anthropicApiKey)
    hasSendgrid: !empty(sendgridApiKey) && !empty(sendgridFromEmail)
    sendgridFromEmail: sendgridFromEmail
    webImage: webImage
    apiImage: apiImage
    recoImage: recoImage
    migrateImage: migrateImage
    customDomain: customDomain
  }
}

// UPPERCASE outputs become azd environment values, read by the pipeline and the runbook.
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_LOCATION string = location
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name
output AZURE_CONTAINER_APPS_ENVIRONMENT_NAME string = apps.outputs.environmentName
output AZURE_STORAGE_ACCOUNT_NAME string = storage.outputs.name
output AZURE_POSTGRES_SERVER_NAME string = postgres.outputs.serverName
output WEB_APP_NAME string = apps.outputs.webName
output API_APP_NAME string = apps.outputs.apiName
output WORKER_APP_NAME string = apps.outputs.workerName
output RECO_APP_NAME string = apps.outputs.recoName
output MIGRATE_JOB_NAME string = apps.outputs.migrateJobName
output SITE_URL string = apps.outputs.siteUrl
