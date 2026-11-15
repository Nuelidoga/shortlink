#!/usr/bin/env bash
# Creates the Kubernetes Secret with the database connection details.
# Values come straight from Terraform's outputs, so the password is never typed or stored in Git.
# Usage: ./scripts/create-db-secret.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DB_HOST="$(terraform -chdir=infra output -raw mysql_fqdn)"
DB_USER="$(terraform -chdir=infra output -raw mysql_admin_username)"
DB_PASSWORD="$(terraform -chdir=infra output -raw mysql_admin_password)"

kubectl create namespace shortlink --dry-run=client -o yaml | kubectl apply -f -

kubectl -n shortlink create secret generic shortlink-db \
  --from-literal=DB_HOST="$DB_HOST" \
  --from-literal=DB_USER="$DB_USER" \
  --from-literal=DB_PASSWORD="$DB_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Secret shortlink-db created/updated in namespace shortlink."
