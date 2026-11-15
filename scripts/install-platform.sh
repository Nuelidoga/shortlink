#!/usr/bin/env bash
# Installs the platform tools into the AKS cluster (run ONCE, after `az aks get-credentials`):
#   1. Envoy Gateway        - Gateway API controller (gets the app a public IP)
#   2. kube-prometheus-stack - Prometheus + Grafana monitoring
#   3. Argo CD              - GitOps: deploys the app from Git
# Usage: ./scripts/install-platform.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENVOY_GATEWAY_VERSION="v1.9.3"

echo "==> Adding Helm chart repositories"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

echo "==> 1/3 Installing Envoy Gateway $ENVOY_GATEWAY_VERSION (includes Gateway API CRDs)"
helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm \
  --version "$ENVOY_GATEWAY_VERSION" \
  --namespace envoy-gateway-system --create-namespace \
  --wait --timeout 5m
kubectl apply -f platform/gatewayclass.yaml

echo "==> 2/3 Installing Prometheus + Grafana"
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
if ! kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1; then
  GRAFANA_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=')"
  kubectl -n monitoring create secret generic grafana-admin \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$GRAFANA_PASSWORD"
fi
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f platform/monitoring-values.yaml \
  --wait --timeout 10m

echo "==> 3/3 Installing Argo CD"
helm upgrade --install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  -f platform/argocd-values.yaml \
  --wait --timeout 10m

echo
echo "Platform installed. Logins:"
echo "  Grafana  user: admin"
echo "           password: $(kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)"
echo "  Argo CD  user: admin"
echo "           password: $(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d)"
