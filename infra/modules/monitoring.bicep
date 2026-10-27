targetScope = 'resourceGroup'

@description('Base name for the resources.')
param name string
param location string = resourceGroup().location
param tags object = {}
@description('How long logs are kept. 30 days is included in the Log Analytics price.')
param retentionInDays int = 30

// Container logs (the API's JSON lines) and platform events land here.
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionInDays
  }
}

// Requests, dependencies and exceptions from the API and the worker (OpenTelemetry, see
// backend/src/instrumentation.ts). Workspace-based, so it shares the retention above.
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${name}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    // Telemetry only with the connection string, never with the old instrumentation key alone.
    DisableLocalAuth: false
  }
}

output workspaceName string = workspace.name
output workspaceId string = workspace.id
output appInsightsName string = appInsights.name
