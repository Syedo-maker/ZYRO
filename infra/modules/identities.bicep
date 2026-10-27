targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}

// Two identities, so each part has only what it needs:
//   app:  web, api, worker and the migration job. Pulls images, reads secrets, reads and writes files.
//   reco: the recommendation service. Pulls images and reads its two secrets; no access to files.
// User-assigned rather than system-assigned so their permissions exist before any app does: an app
// can then pull its first image without the circular dependency a system identity would create.
resource app 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${name}-app'
  location: location
  tags: tags
}

resource reco 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${name}-reco'
  location: location
  tags: tags
}

output appId string = app.id
output appPrincipalId string = app.properties.principalId
output appClientId string = app.properties.clientId
output recoId string = reco.id
output recoPrincipalId string = reco.properties.principalId
