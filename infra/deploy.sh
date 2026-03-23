#!/bin/bash
# deploy.sh — Deploy Datacore infrastructure to Azure
# Subscription: Azure for Students (291928K@curtin.edu.au)
# Resources: ADLS Gen2 + Azure Databricks (Premium) + Cost monitor

set -e

echo "=== Datacore Infrastructure Deploy ==="
echo ""

# Login (if not already)
az account show > /dev/null 2>&1 || az login --tenant curtin.edu.au

# Set subscription
az account set --subscription "Azure for Students"
echo "Subscription: $(az account show --query name -o tsv)"
echo ""

# Deploy at subscription level
echo "Deploying to East US..."
az deployment sub create \
  --location eastus \
  --template-file main.bicep \
  --parameters \
    location=eastus \
    rgName=rg-datacore \
    alertEmail=291928K@curtin.edu.au \
    monthlyBudgetAUD=15 \
    databricksWorkspaceName=datacore-databricks

echo ""
echo "=== Deploy complete ==="
echo ""

# Show outputs
echo "Resources created:"
az deployment sub show \
  --name main \
  --query properties.outputs \
  -o table 2>/dev/null || echo "(check Azure Portal for details)"

echo ""
echo "Next steps:"
echo "  1. Open Databricks workspace: az databricks workspace show -n datacore-databricks -g rg-datacore --query workspaceUrl -o tsv"
echo "  2. Upload data: azcopy copy ./sample-data 'https://<storageaccount>.blob.core.windows.net/landing/'"
echo "  3. Create notebooks in Databricks workspace"
