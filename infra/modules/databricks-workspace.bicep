// modules/databricks-workspace.bicep — Azure Databricks (Premium)

@description('Azure region')
param location string

@description('Workspace name')
param workspaceName string

@description('Managed resource group for Databricks internal resources')
param managedRgName string = 'rg-datacore-databricks-managed'

// Azure Databricks workspace — Premium tier (Unity Catalog, RBAC)
resource databricks 'Microsoft.Databricks/workspaces@2024-05-01' = {
  name: workspaceName
  location: location
  sku: {
    name: 'premium'    // Required for Unity Catalog, RBAC, Auto Loader events
  }
  properties: {
    managedResourceGroupId: subscriptionResourceId('Microsoft.Resources/resourceGroups', managedRgName)
    parameters: {
      enableNoPublicIp: {
        value: false    // Allow public access (simpler for learning)
      }
    }
  }
}

output workspaceName string = databricks.name
output workspaceId string = databricks.id
output workspaceUrl string = databricks.properties.workspaceUrl
