targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}
@description('Principal ids that may read secrets (the apps\' managed identities).')
param readerPrincipalIds array
@description('Production keeps deleted secrets recoverable for 90 days and cannot purge them early.')
param purgeProtection bool
@secure()
@description('Secrets to store, as { name: value }. Empty values are skipped (an optional integration that is not configured).')
param secrets object

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  // 3 to 24 characters, globally unique.
  name: take('kv-${replace(name, '-', '')}${uniqueString(resourceGroup().id)}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    // Access by Azure role, not by vault access policy: one model for every resource.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: purgeProtection ? true : null
    publicNetworkAccess: 'Enabled'
  }
}

var secretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource readers 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in readerPrincipalIds: {
  name: guid(vault.id, principalId, secretsUserRole)
  scope: vault
  properties: {
    roleDefinitionId: secretsUserRole
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}]

resource stored 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for s in items(secrets): if (!empty(s.value)) {
  parent: vault
  name: s.key
  properties: { value: s.value }
}]

output name string = vault.name
output uri string = vault.properties.vaultUri
