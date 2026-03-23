// main.bicep — Subscription-level deployment for Datacore
// Creates: ADLS Gen2 + Azure Databricks (Premium) + Cost monitoring
// Subscription: Azure for Students (291928K@curtin.edu.au)
targetScope = 'subscription'

@description('Azure region for all resources')
param location string = 'eastus'

@description('Resource group name')
param rgName string = 'rg-datacore'

@description('Email for budget alerts')
param alertEmail string = '291928K@curtin.edu.au'

@description('Monthly budget limit in AUD')
param monthlyBudgetAUD int = 15

@description('Storage account name (must be globally unique, lowercase, no hyphens, max 24 chars)')
param storageAccountName string = 'datacore${uniqueString(subscription().id)}'

@description('Databricks workspace name')
param databricksWorkspaceName string = 'datacore-databricks'

// Create resource group
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
}

// ADLS Gen2 storage (hierarchical namespace enabled)
module storage 'modules/storage-account.bicep' = {
  name: 'storage-deployment'
  scope: rg
  params: {
    location: location
    storageAccountName: storageAccountName
  }
}

// Azure Databricks workspace (Premium tier)
module databricks 'modules/databricks-workspace.bicep' = {
  name: 'databricks-deployment'
  scope: rg
  params: {
    location: location
    workspaceName: databricksWorkspaceName
  }
}

// Cost monitoring — budget alerts via email
module costMonitor 'modules/cost-monitor.bicep' = {
  name: 'cost-monitor-deployment'
  scope: rg
  params: {
    monthlyBudgetAUD: monthlyBudgetAUD
    alertEmail: alertEmail
    resourceGroupName: rgName
  }
}

// Outputs
output resourceGroup string = rg.name
output storageAccountName string = storage.outputs.storageAccountName
output adlsEndpoint string = storage.outputs.dfsEndpoint
output databricksWorkspaceUrl string = databricks.outputs.workspaceUrl
output databricksWorkspaceId string = databricks.outputs.workspaceId
output budgetName string = costMonitor.outputs.budgetName
