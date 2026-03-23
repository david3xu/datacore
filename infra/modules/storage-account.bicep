// modules/storage-account.bicep — ADLS Gen2 with hierarchical namespace

@description('Azure region')
param location string

@description('Storage account name')
param storageAccountName string

// ADLS Gen2 storage account
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'   // Locally redundant — cheapest, fine for learning
  }
  properties: {
    isHnsEnabled: true      // Hierarchical namespace = ADLS Gen2
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// Blob service (required parent for containers)
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

// Container: datacore (Bronze/Silver/Gold folders created by Databricks)
resource datacoreContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'datacore'
}

// Container: landing (raw files uploaded from Mac before Auto Loader picks them up)
resource landingContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'landing'
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
output dfsEndpoint string = storageAccount.properties.primaryEndpoints.dfs
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
