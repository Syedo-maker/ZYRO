targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}

param workspaceName string
param appInsightsName string
param registryLoginServer string
param keyVaultUri string
param appIdentityId string
param appIdentityClientId string
param recoIdentityId string
param storageBlobEndpoint string
param redisHostName string

@description('Production keeps at least one replica of every app warm; staging may scale to zero.')
param isProduction bool

@description('Optional integrations: each is wired in only when its secret was supplied.')
param hasStripe bool
param hasAnthropic bool
param hasSendgrid bool
param sendgridFromEmail string = ''

@description('Images. Empty until the first build has been pushed; a public placeholder runs until then.')
param webImage string = ''
param apiImage string = ''
param recoImage string = ''
param migrateImage string = ''

@description('A custom domain for the site, when one is bound (for example shop.zyro.pk). Empty uses the Azure address.')
param customDomain string = ''

var placeholder = 'mcr.microsoft.com/k8se/quickstart:latest'
var webIsPlaceholder = empty(webImage)
var apiIsPlaceholder = empty(apiImage)
var recoIsPlaceholder = empty(recoImage)

var apiName = 'ca-${name}-api'
var workerName = 'ca-${name}-worker'
var recoName = 'ca-${name}-reco'
var webName = 'ca-${name}-web'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${name}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}

// The public address of the whole product: the web app serves the site and forwards /api to the API.
var siteUrl = empty(customDomain) ? 'https://${webName}.${environment.properties.defaultDomain}' : 'https://${customDomain}'

// ---- Secrets: every one read from Key Vault by the app's identity, none stored in the app ----

func kvSecret(vaultUri string, secretName string, identityId string) object => {
  name: secretName
  keyVaultUrl: '${vaultUri}secrets/${secretName}'
  identity: identityId
}

var appSecrets = concat(
  [
    kvSecret(keyVaultUri, 'database-url', appIdentityId)
    kvSecret(keyVaultUri, 'mongodb-uri', appIdentityId)
    kvSecret(keyVaultUri, 'redis-url', appIdentityId)
    kvSecret(keyVaultUri, 'redis-password', appIdentityId)
    kvSecret(keyVaultUri, 'jwt-access-secret', appIdentityId)
    kvSecret(keyVaultUri, 'recommendation-service-token', appIdentityId)
    { name: 'appinsights-connection-string', value: appInsights.properties.ConnectionString }
  ],
  hasStripe ? [kvSecret(keyVaultUri, 'stripe-secret-key', appIdentityId), kvSecret(keyVaultUri, 'stripe-webhook-secret', appIdentityId)] : [],
  hasAnthropic ? [kvSecret(keyVaultUri, 'anthropic-api-key', appIdentityId)] : [],
  hasSendgrid ? [kvSecret(keyVaultUri, 'sendgrid-api-key', appIdentityId)] : []
)

// ---- What the API and the worker are told (backend/.env.example explains each) ----

var appEnv = concat(
  [
    { name: 'NODE_ENV', value: 'production' }
    { name: 'LOG_FORMAT', value: 'json' }
    { name: 'DATABASE_URL', secretRef: 'database-url' }
    { name: 'MONGODB_URI', secretRef: 'mongodb-uri' }
    { name: 'REDIS_URL', secretRef: 'redis-url' }
    { name: 'JWT_ACCESS_SECRET', secretRef: 'jwt-access-secret' }
    { name: 'PUBLIC_URL', value: siteUrl }
    { name: 'CORS_ORIGIN', value: siteUrl }
    { name: 'STOREFRONT_URL', value: siteUrl }
    // Three proxies stand between a visitor and the API: the web app's public ingress, its nginx,
    // and the API's internal ingress, each appending to X-Forwarded-For. Rate limits count each
    // visitor's own address only when this matches the real number of hops, so it is checked on
    // staging before launch (Deployment_Runbook.md, step "Check the visitor address").
    { name: 'TRUST_PROXY', value: '3' }
    { name: 'RUN_WORKERS_IN_API', value: 'false' }
    { name: 'STORAGE_DRIVER', value: 'azure' }
    { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storageBlobEndpoint }
    { name: 'AZURE_CLIENT_ID', value: appIdentityClientId }
    { name: 'RECOMMENDATION_SERVICE_URL', value: 'http://${recoName}' }
    { name: 'RECOMMENDATION_SERVICE_TOKEN', secretRef: 'recommendation-service-token' }
    { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
  ],
  hasStripe ? [{ name: 'STRIPE_SECRET_KEY', secretRef: 'stripe-secret-key' }, { name: 'STRIPE_WEBHOOK_SECRET', secretRef: 'stripe-webhook-secret' }] : [],
  hasAnthropic ? [{ name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }] : [],
  hasSendgrid ? [{ name: 'SENDGRID_API_KEY', secretRef: 'sendgrid-api-key' }, { name: 'SENDGRID_FROM_EMAIL', value: sendgridFromEmail }] : []
)

var registries = [{ server: registryLoginServer, identity: appIdentityId }]

// ---- api: internal only; reached through the web app ----

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appIdentityId}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      // Each release is a new revision. The previous one stays active (with no traffic) so a bad
      // release is rolled back by moving traffic, in seconds, without a rebuild.
      activeRevisionsMode: 'Multiple'
      maxInactiveRevisions: 5
      ingress: {
        external: false
        targetPort: apiIsPlaceholder ? 80 : 5000
        transport: 'http'
        allowInsecure: true // inside the environment only; the public edge is HTTPS
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      registries: registries
      secrets: appSecrets
    }
    template: {
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'api'
          image: apiIsPlaceholder ? placeholder : apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(appEnv, [{ name: 'PORT', value: '5000' }, { name: 'OTEL_SERVICE_NAME', value: 'zyro-api' }])
          probes: apiIsPlaceholder ? [] : [
            { type: 'Startup', httpGet: { path: '/health', port: 5000 }, periodSeconds: 2, failureThreshold: 30 }
            { type: 'Liveness', httpGet: { path: '/health', port: 5000 }, periodSeconds: 10, failureThreshold: 3 }
            { type: 'Readiness', httpGet: { path: '/ready', port: 5000 }, periodSeconds: 10, failureThreshold: 3 }
          ]
        }
      ]
      scale: {
        minReplicas: isProduction ? 1 : 0
        maxReplicas: isProduction ? 6 : 2
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
}

// ---- worker: no ingress; scales on the AI generation queue ----

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerName
  location: location
  tags: union(tags, { 'azd-service-name': 'worker' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appIdentityId}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      secrets: appSecrets
    }
    template: {
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'worker'
          image: apiIsPlaceholder ? placeholder : apiImage
          command: apiIsPlaceholder ? [] : ['node', '--enable-source-maps', 'dist/worker.js']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(appEnv, [{ name: 'WORKER_HEALTH_PORT', value: '5001' }, { name: 'OTEL_SERVICE_NAME', value: 'zyro-worker' }])
          probes: apiIsPlaceholder ? [] : [
            { type: 'Startup', httpGet: { path: '/health', port: 5001 }, periodSeconds: 2, failureThreshold: 30 }
            { type: 'Liveness', httpGet: { path: '/health', port: 5001 }, periodSeconds: 10, failureThreshold: 3 }
          ]
        }
      ]
      scale: {
        // Always one: the weekly schedules and the cart scan must have someone to run them.
        minReplicas: 1
        maxReplicas: isProduction ? 4 : 1
        rules: [
          {
            name: 'ai-queue'
            custom: {
              type: 'redis'
              metadata: {
                address: '${redisHostName}:10000'
                listName: 'bull:ai-generate:wait'
                listLength: '10'
                enableTLS: 'true'
              }
              auth: [{ secretRef: 'redis-password', triggerParameter: 'password' }]
            }
          }
        ]
      }
    }
  }
}

// ---- reco: internal only; the API is its only caller ----

resource reco 'Microsoft.App/containerApps@2024-03-01' = {
  name: recoName
  location: location
  tags: union(tags, { 'azd-service-name': 'reco' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${recoIdentityId}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: recoIsPlaceholder ? 80 : 8001
        transport: 'http'
        allowInsecure: true
      }
      registries: [{ server: registryLoginServer, identity: recoIdentityId }]
      secrets: [
        kvSecret(keyVaultUri, 'mongodb-uri', recoIdentityId)
        kvSecret(keyVaultUri, 'recommendation-service-token', recoIdentityId)
      ]
    }
    template: {
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'reco'
          image: recoIsPlaceholder ? placeholder : recoImage
          resources: { cpu: json('1'), memory: '2Gi' }
          env: [
            { name: 'MONGODB_URI', secretRef: 'mongodb-uri' }
            { name: 'RECOMMENDATION_SERVICE_TOKEN', secretRef: 'recommendation-service-token' }
            { name: 'PORT', value: '8001' }
          ]
          // Its /health needs the shared secret, so the platform probes the port instead.
          probes: recoIsPlaceholder ? [] : [
            { type: 'Startup', tcpSocket: { port: 8001 }, periodSeconds: 3, failureThreshold: 40 }
            { type: 'Liveness', tcpSocket: { port: 8001 }, periodSeconds: 15, failureThreshold: 3 }
          ]
        }
      ]
      // Kept warm: loading the models takes a while, and a cold start would make the first shopper wait.
      scale: { minReplicas: 1, maxReplicas: isProduction ? 2 : 1 }
    }
  }
}

// ---- web: the public site, and the one door to the API ----

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appIdentityId}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Multiple'
      maxInactiveRevisions: 5
      ingress: {
        external: true
        targetPort: webIsPlaceholder ? 80 : 8080
        transport: 'auto'
        allowInsecure: false
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      registries: registries
    }
    template: {
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'web'
          image: webIsPlaceholder ? placeholder : webImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [{ name: 'API_UPSTREAM', value: 'http://${apiName}' }]
          probes: webIsPlaceholder ? [] : [
            { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
            { type: 'Readiness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 5, failureThreshold: 3 }
          ]
        }
      ]
      scale: {
        minReplicas: isProduction ? 1 : 0
        maxReplicas: isProduction ? 4 : 2
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '100' } } }]
      }
    }
  }
}

// ---- migrate: one run per release, before the new API takes traffic ----

resource migrate 'Microsoft.App/jobs@2024-03-01' = {
  name: 'caj-${name}-migrate'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appIdentityId}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      // A migration either completes or fails loudly; it is never retried on its own, because a
      // half-applied migration retried blindly can make things worse.
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: registries
      secrets: [kvSecret(keyVaultUri, 'database-url', appIdentityId)]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: empty(migrateImage) ? placeholder : migrateImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [{ name: 'DATABASE_URL', secretRef: 'database-url' }]
        }
      ]
    }
  }
}

output environmentName string = environment.name
output siteUrl string = siteUrl
output webName string = web.name
output apiName string = api.name
output workerName string = worker.name
output recoName string = reco.name
output migrateJobName string = migrate.name
output webFqdn string = web.properties.configuration.ingress.fqdn
