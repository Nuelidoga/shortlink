#!/usr/bin/env bash
# Lets GitHub Actions log in to Azure WITHOUT storing a password (OpenID Connect).
# Usage: ./scripts/setup-github-oidc.sh <github-username>/<repo-name>
#
# GitHub's OIDC token subject can use either format:
#   legacy:    repo:<owner>/<repo>:...
#   immutable: repo:<owner>@<owner-id>/<repo>@<repo-id>:...   (IDs stop a re-created repo
#              with the same name from inheriting cloud access)
# This script registers BOTH, so it works whichever format your repo uses.
set -euo pipefail

REPO="${1:?Usage: $0 <github-username>/<repo-name>}"
APP_NAME="shortlink-github-actions"

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "Looking up immutable IDs for $REPO on GitHub..."
IMMUTABLE=$(node -e "
fetch('https://api.github.com/repos/$REPO')
  .then(r => { if (!r.ok) throw new Error('GitHub API returned ' + r.status); return r.json(); })
  .then(j => console.log(j.owner.login + '@' + j.owner.id + '/' + j.name + '@' + j.id))
  .catch(e => { console.error(e.message); process.exit(1); });
") || { echo "Could not look up the repo. Is it public and spelled correctly?"; exit 1; }
echo "  legacy:    repo:$REPO"
echo "  immutable: repo:$IMMUTABLE"

echo "Creating app registration $APP_NAME..."
CLIENT_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
SP_OBJECT_ID=$(az ad sp create --id "$CLIENT_ID" --query id -o tsv)

# Contributor: create and change resources.
# User Access Administrator: Terraform grants AKS permission to pull from ACR (AcrPull).
# Improvement for real production: scope these to the project's resource groups only.
for ROLE in "Contributor" "User Access Administrator"; do
  az role assignment create \
    --assignee-object-id "$SP_OBJECT_ID" \
    --assignee-principal-type ServicePrincipal \
    --role "$ROLE" \
    --scope "/subscriptions/$SUBSCRIPTION_ID" \
    --output none
done

create_cred() {
  local name="$1" subject="$2"
  az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
    \"name\": \"$name\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"$subject\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" --output none
  echo "  trusted: $subject"
}

# Trust: the main branch, the production environment, and pull requests - in both formats.
for PREFIX_NAME in "legacy:repo:$REPO" "immutable:repo:$IMMUTABLE"; do
  TAG="${PREFIX_NAME%%:*}"
  PREFIX="${PREFIX_NAME#*:}"
  create_cred "gh-${TAG}-main"       "$PREFIX:ref:refs/heads/main"
  create_cred "gh-${TAG}-production" "$PREFIX:environment:production"
  create_cred "gh-${TAG}-pr"         "$PREFIX:pull_request"
done

echo
echo "Done. Add these GitHub repository SECRETS (Settings > Secrets and variables > Actions):"
echo "  AZURE_CLIENT_ID       = $CLIENT_ID"
echo "  AZURE_TENANT_ID       = $TENANT_ID"
echo "  AZURE_SUBSCRIPTION_ID = $SUBSCRIPTION_ID"
