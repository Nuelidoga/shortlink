#!/usr/bin/env bash
# Creates the Azure Storage account that holds the Terraform state (run ONCE).
# Usage: ./scripts/bootstrap-state.sh [location]
set -euo pipefail

LOCATION="${1:-northeurope}"
RG="rg-shortlink-tfstate"
SA="stshortlinktf$(( RANDOM % 90000 + 10000 ))"
CONTAINER="tfstate"

echo "Creating resource group $RG in $LOCATION..."
az group create --name "$RG" --location "$LOCATION" --output none

echo "Creating storage account $SA..."
az storage account create \
  --name "$SA" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --output none

az storage account blob-service-properties update \
  --account-name "$SA" --resource-group "$RG" \
  --enable-versioning true --output none

echo "Creating container $CONTAINER..."
az storage container create --name "$CONTAINER" --account-name "$SA" --auth-mode key --output none

cat > infra/backend.hcl <<EOF
resource_group_name  = "$RG"
storage_account_name = "$SA"
container_name       = "$CONTAINER"
key                  = "shortlink.prod.tfstate"
EOF

echo
echo "Done. Wrote infra/backend.hcl"
echo "Add these GitHub repository variables:"
echo "  TFSTATE_RESOURCE_GROUP  = $RG"
echo "  TFSTATE_STORAGE_ACCOUNT = $SA"
