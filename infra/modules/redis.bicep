targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}
@description('Azure Managed Redis size: Balanced_B0 for staging, Balanced_B1 or above for production.')
param skuName string = 'Balanced_B0'
param highAvailability bool = false
@description('Key Vault the connection details are written to.')
param keyVaultName string

// Azure Managed Redis (Azure Cache for Redis could no longer be created after 1 October 2026).
// Carts, rate limits, the AI cache and the BullMQ job queues all live here.
resource cache 'Microsoft.Cache/redisEnterprise@2025-04-01' = {
  name: 'redis-${name}-${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: skuName }
  properties: {
    minimumTlsVersion: '1.2'
    highAvailability: highAvailability ? 'Enabled' : 'Disabled'
  }
}

resource db 'Microsoft.Cache/redisEnterprise/databases@2025-04-01' = {
  parent: cache
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    port: 10000
    // One endpoint that behaves like a single Redis: BullMQ's multi-key commands would break
    // under the OSS cluster policy, which spreads keys across shards.
    clusteringPolicy: 'EnterpriseCluster'
    // BullMQ requires that Redis never silently drops keys: a dropped job is a lost order email
    // or AI generation. Memory pressure surfaces as errors instead.
    evictionPolicy: 'NoEviction'
    accessKeysAuthentication: 'Enabled'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource redisUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'redis-url'
  properties: {
    value: 'rediss://:${uriComponent(db.listKeys().primaryKey)}@${cache.properties.hostName}:10000'
  }
}

// The worker's autoscaler (KEDA) reads the queue length with the bare password.
resource redisPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'redis-password'
  properties: { value: db.listKeys().primaryKey }
}

output hostName string = cache.properties.hostName
