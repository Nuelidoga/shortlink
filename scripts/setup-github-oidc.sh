#!/usr/bin/env bash
# Lets GitHub Actions log in to Azure WITHOUT storing a password (OpenID Connect).
# Usage: ./scripts/setup-github-oidc.sh <github-username>/<repo-name>
set -euo pipefail

REPO="${1:?Usage: $0 <github-username>/<repo-name>}"
APP_NAME="shortlink-github-actions"

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "Creating app registration $APP_NAME..."
CLIENT_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
SP_OBJECT_ID=$(az ad sp create --id "$CLIENT_ID" --query id -o tsv)

# Contributor: create and change resources.
# User Access Administrator: needed because Terraform grants AKS permission to pull from ACR (AcrPull).
# Improvement for real production: scope these to the project's resource groups only.
for ROLE in "Contributor" "User Access Administrator"; do
  az role assignment create \
    --assignee-object-id "$SP_OBJECT_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "$ROLE" \
    --scope "/subscriptions/$SUBSCRIPTION_ID" \
    --output none
done

# Trust GitHub tokens from: the production environment, pull requests, and the main branch.
create_cred() {
  local name="$1" subject="$2"
  az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
    \"name\": \"$name\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"$subject\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" --output none
}
create_cred "github-env-production" "repo:${REPO}:environment:production"
create_cred "github-pull-request"   "repo:${REPO}:pull_request"
create_cred "github-main-branch"    "repo:${REPO}:ref:refs/heads/main"

echo
echo "Done. Add these GitHub repository SECRETS (Settings > Secrets and variables > Actions):"
echo "  AZURE_CLIENT_ID       = $CLIENT_ID"
echo "  AZURE_TENANT_ID       = $TENANT_ID"
echo "  AZURE_SUBSCRIPTION_ID = $SUBSCRIPTION_ID"
