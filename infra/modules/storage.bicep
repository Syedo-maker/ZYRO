targetScope = 'resourceGroup'

param name string
param location string = resourceGroup().location
param tags object = {}
@description('Principal id of the identity the API and worker run as.')
param appPrincipalId string
@description('Standard_LRS for staging; Standard_ZRS keeps three copies across zones for production.')
param skuName string = 'Standard_LRS'

// Files (backend/src/lib/storage.ts): product images in `public`, receipts and voice notes in `private`.
resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  // Always at least 15 characters: 'st' and a 13-character hash. The compiler cannot see that.
  #disable-next-line BCP334
  name: take(replace('st${name}${uniqueString(resourceGroup().id)}', '-', ''), 24)
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: skuName }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // Needed for the `public` container only; the `private` one has no public access whatever this says.
    allowBlobPublicAccess: true
    // No account keys: the API signs in with its managed identity and signs links with a user
    // delegation key, so a leaked key cannot exist.
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    accessTier: 'Hot'
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    // A file deleted by mistake can be restored for 14 days.
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource publicContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'public'
  // Anyone may read a single image; nobody may list them.
  properties: { publicAccess: 'Blob' }
}

resource privateContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'private'
  properties: { publicAccess: 'None' }
}

// Read and write files, and sign the SAS links for private ones (a user delegation key needs this
// role or Storage Blob Delegator; Contributor includes it).
var blobDataContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource appCanUseBlobs 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, appPrincipalId, blobDataContributor)
  scope: account
  properties: {
    roleDefinitionId: blobDataContributor
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output name string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
