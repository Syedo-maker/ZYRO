targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}
@description('Principal ids allowed to pull images.')
param pullPrincipalIds array

// Registry names are alphanumeric only, 5 to 50 characters, and globally unique.
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  // Always at least 15 characters: 'cr' and a 13-character hash. The compiler cannot see that.
  #disable-next-line BCP334
  name: take(replace('cr${name}${uniqueString(resourceGroup().id)}', '-', ''), 50)
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    // Images are pulled with managed identities and pushed by the pipeline's own identity;
    // no shared admin password exists.
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in pullPrincipalIds: {
  name: guid(registry.id, principalId, acrPullRole)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRole
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}]

output name string = registry.name
output loginServer string = registry.properties.loginServer
