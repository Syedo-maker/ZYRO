targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}
param administratorLogin string = 'zyroadmin'
@secure()
param administratorPassword string
@description('Burstable: Standard_B1ms for staging, Standard_B2s for production; GeneralPurpose for more.')
param skuName string = 'Standard_B1ms'
param skuTier string = 'Burstable'
param storageSizeGB int = 32
param backupRetentionDays int = 7
param geoRedundantBackup bool = false
@description('Key Vault the connection string is written to.')
param keyVaultName string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-${name}-${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: skuName, tier: skuTier }
  properties: {
    version: '17'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    // Prisma signs in with a password; the password lives only in Key Vault.
    authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }
    storage: { storageSizeGB: storageSizeGB, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: backupRetentionDays, geoRedundantBackup: geoRedundantBackup ? 'Enabled' : 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'zyro'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Only Azure services (the container apps) may connect. Moving the database into a private network
// is the next step up (Deployment_Runbook.md, "Hardening after launch").
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// Every connection is encrypted.
resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: { value: 'ON', source: 'user-override' }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource databaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: 'postgresql://${administratorLogin}:${uriComponent(administratorPassword)}@${server.properties.fullyQualifiedDomainName}:5432/${database.name}?schema=public&sslmode=require'
  }
}

output serverName string = server.name
output host string = server.properties.fullyQualifiedDomainName
