#!/bin/bash
# setup-databricks.sh — Create cluster + upload notebooks to Databricks
# Run AFTER deploy.sh (needs workspace + storage to exist)
# This handles everything Bicep can't: cluster config, storage credentials, notebooks

set -e

DATABRICKS_URL="https://adb-7405608864534253.13.azuredatabricks.net"
STORAGE_ACCOUNT="datacore3kcfne4phgzua"
RG="rg-datacore"
NOTEBOOK_DIR="$(cd "$(dirname "$0")/../notebooks" && pwd)"
USER_PATH="/Users/291928k@curtin.edu.au/datacore"

echo "=== Databricks Setup ==="
echo "Workspace: ${DATABRICKS_URL}"
echo "Storage:   ${STORAGE_ACCOUNT}"
echo ""

# Get tokens
TOKEN=$(az account get-access-token --resource 2ff814a6-3304-4ab8-85cb-cd0e6f879c1d --query accessToken -o tsv)
STORAGE_KEY=$(az storage account keys list --account-name "$STORAGE_ACCOUNT" --resource-group "$RG" --query '[0].value' -o tsv)


# 1. Create single-node cluster with storage key pre-configured
echo "--- Creating cluster (single-node, auto-terminates in 30min) ---"
CLUSTER_RESPONSE=$(curl -s -X POST "${DATABRICKS_URL}/api/2.0/clusters/create" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_name": "datacore-small",
    "spark_version": "15.4.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "num_workers": 0,
    "autotermination_minutes": 30,
    "spark_conf": {
      "fs.azure.account.key.'${STORAGE_ACCOUNT}'.dfs.core.windows.net": "'"${STORAGE_KEY}"'",
      "spark.databricks.cluster.profile": "singleNode",
      "spark.master": "local[*]"
    },
    "custom_tags": {
      "ResourceClass": "SingleNode",
      "project": "datacore"
    }
  }')

CLUSTER_ID=$(echo "$CLUSTER_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('cluster_id','FAILED'))")
echo "  Cluster ID: ${CLUSTER_ID}"


# 2. Create workspace folder
echo "--- Creating workspace folder ---"
curl -s -X POST "${DATABRICKS_URL}/api/2.0/workspace/mkdirs" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"${USER_PATH}\"}" > /dev/null
echo "  Created: ${USER_PATH}"

# 3. Upload all notebooks
echo "--- Uploading notebooks ---"
for nb in "$NOTEBOOK_DIR"/*.py; do
  NAME=$(basename "$nb" .py)
  CONTENT=$(base64 < "$nb")
  RESULT=$(curl -s -X POST "${DATABRICKS_URL}/api/2.0/workspace/import" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"path\": \"${USER_PATH}/${NAME}\",
      \"format\": \"SOURCE\",
      \"language\": \"PYTHON\",
      \"content\": \"${CONTENT}\",
      \"overwrite\": true
    }")
  echo "  Uploaded: ${NAME}"
done


echo ""
echo "=== Databricks Setup Complete ==="
echo ""
echo "  Cluster:    ${CLUSTER_ID} (auto-terminates in 30min)"
echo "  Notebooks:  ${USER_PATH}/"
echo "  Storage:    ${STORAGE_ACCOUNT} (key configured in cluster spark_conf)"
echo ""
echo "  Open workspace: ${DATABRICKS_URL}"
echo ""
echo "  To start cluster:  az databricks cluster start --cluster-id ${CLUSTER_ID}"
echo "  To stop cluster:   az databricks cluster stop --cluster-id ${CLUSTER_ID}"
echo ""
echo "  NOTE: Cluster auto-terminates after 30 min idle to save credits."
echo "  Run 01-bronze-ingest first, then 02-bronze-search."
