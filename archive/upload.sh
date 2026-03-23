#!/bin/bash
# upload.sh — Push collected data from sample-data/ to ADLS Gen2 landing zone
# Prerequisites: az cli logged in, storage account created
# Run: ./upload.sh

set -e

# Configuration — update after creating storage account
STORAGE_ACCOUNT="${DATACORE_STORAGE_ACCOUNT:-}"
CONTAINER="landing"

if [ -z "$STORAGE_ACCOUNT" ]; then
  echo "ERROR: Set DATACORE_STORAGE_ACCOUNT env var first."
  echo ""
  echo "  export DATACORE_STORAGE_ACCOUNT=<your-storage-account-name>"
  echo "  # Find it: az storage account list -g rg-datacore --query '[].name' -o tsv"
  echo ""
  exit 1
fi

SAMPLE_DIR="$(cd "$(dirname "$0")" && pwd)/sample-data"
DEST="https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER}"

echo "=== Uploading to ADLS Gen2 ==="
echo "Storage: $STORAGE_ACCOUNT"
echo "Container: $CONTAINER"
echo "Source: $SAMPLE_DIR"
echo ""


# Get storage account key
echo "Getting storage key..."
STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "${DATACORE_RG:-rg-datacore}" \
  --query '[0].value' -o tsv)

if [ -z "$STORAGE_KEY" ]; then
  echo "ERROR: Could not get storage key. Are you logged in? (az login)"
  exit 1
fi

# Upload each source to its own folder in the landing zone
for source in openclaw git claude content docs; do
  if [ -d "$SAMPLE_DIR/$source" ] && [ "$(ls -A "$SAMPLE_DIR/$source" 2>/dev/null)" ]; then
    echo "--- Uploading $source ---"
    az storage blob upload-batch \
      --account-name "$STORAGE_ACCOUNT" \
      --account-key "$STORAGE_KEY" \
      --destination "$CONTAINER/$source" \
      --source "$SAMPLE_DIR/$source" \
      --overwrite true
    echo "  Done: $source"
  else
    echo "  Skipping $source (empty or missing)"
  fi
done

echo ""
echo "=== Upload complete ==="
echo ""
echo "Verify in Azure Portal:"
echo "  Storage account → Containers → landing/"
echo ""
echo "Or with CLI:"
echo "  az storage blob list --account-name $STORAGE_ACCOUNT -c landing --auth-mode login -o table"
echo ""
echo "Next: Open Databricks workspace and create Bronze ingest notebook"
