# ShortLink: a cloud-native URL shortener on Azure Kubernetes Service

A production-style web application that is **designed, provisioned, deployed and automated** on Microsoft Azure using industry-standard DevOps tooling.

**Stack:** Azure · AKS · Terraform · Docker · Helm · GitHub Actions · Argo CD (GitOps) · Gateway API (Envoy Gateway) · Prometheus · Grafana · Trivy · MySQL · OIDC

---

## Architecture

```
                         ┌──────────────────────── GitHub ─────────────────────────┐
 Developer ─ git push ─► │  GitHub Actions CI                                       │
                         │   test → lint chart → build → Trivy scan → push to ACR   │
                         │   → commit new image tag to helm/shortlink/values.yaml   │
                         │  Terraform workflow: fmt → validate → plan → apply       │
                         └──────────────┬───────────────────────────────────────────┘
                                        │ Argo CD watches the repo (GitOps)
┌─────────────────────────── Azure: rg-shortlink-prod ──────────────┼──────────────────┐
│  Azure Container Registry ◄── images                              │                  │
│                                                                   ▼                  │
│  ┌─────────────────────── AKS cluster (Free tier, 1 node) ──────────────────────┐    │
│  │ argocd ns:      Argo CD ──── syncs Helm chart ──► shortlink ns               │    │
│  │ envoy-gateway:  Envoy Gateway (Gateway API) ◄── public IP ◄── Internet       │    │
│  │ shortlink ns:   Gateway/HTTPRoute → shortlink-web (Nginx) → shortlink-api    │    │
│  │                 (Node.js, HPA 1-4 pods) ──── TLS ────┐                       │    │
│  │ monitoring ns:  Prometheus (scrapes /metrics) → Grafana dashboards           │    │
│  └──────────────────────────────────────────────────────┼──────────────────────┘    │
│                                                         ▼                           │
│                         Azure Database for MySQL Flexible Server (B1ms)             │
└──────────────────────────────────────────────────────────────────────────────────────┘
               Terraform state: Azure Storage account (rg-shortlink-tfstate)
```

### What each tool does

| Tool | Role in this project |
|---|---|
| **Terraform** | Creates all Azure resources (AKS, ACR, MySQL) as code, with remote state |
| **Docker** | Packages the API and frontend as small, non-root container images |
| **GitHub Actions** | CI: tests, lints the Helm chart, builds, scans with Trivy, pushes to ACR, updates the image tag in Git |
| **Argo CD** | CD (GitOps): keeps the cluster in sync with the Helm chart in Git, self-heals manual changes |
| **Helm** | Packages all Kubernetes resources for the app with one settings file (`values.yaml`) |
| **Gateway API + Envoy Gateway** | Routes internet traffic into the cluster (successor to the retired ingress-nginx) |
| **Prometheus + Grafana** | Collects cluster and app metrics; dashboards for traffic, errors, latency, scaling |
| **HPA** | Adds API pods automatically when CPU is high |
| **OIDC** | GitHub logs in to Azure with short-lived tokens; no stored cloud passwords |

### Production practices to point out

- Infrastructure as Code with remote, versioned state
- GitOps: Git is the single source of truth; rollback = `git revert`
- Zero-downtime rolling updates (`maxUnavailable: 0`), readiness/liveness probes
- Autoscaling (HPA) with CPU requests/limits set on every container
- Security: non-root containers, read-only root filesystem, all Linux capabilities dropped, API not exposed publicly, `/metrics` blocked at the edge, TLS to the database, image scanning, no secrets in Git, passwordless CI login
- Observability: app-level metrics (requests, errors, latency) + cluster metrics in Grafana
- Cost control: AKS Free tier control plane, single burstable node, cluster stop/start, Basic ACR

---

## Repository layout

```
app/              API (Node.js) and frontend (Nginx) source + Dockerfiles
infra/            Terraform: resource group, ACR, AKS, MySQL
helm/shortlink/   Helm chart: Deployments, Services, HPA, Gateway, HTTPRoute, ServiceMonitor, dashboard
argocd/           Argo CD Application (points Argo CD at the Helm chart)
platform/         Settings for Envoy Gateway, Prometheus/Grafana, Argo CD
scripts/          One-time setup scripts
loadtest/         k6 load test
.github/workflows CI (app.yml) and Terraform (infra.yml) pipelines
docker-compose.yml  Run everything locally
```

---

## Step 1: Run locally ✅

```bash
docker compose up --build        # open http://localhost:8080
cd app/api && npm install && npm test && cd ../..
```

---

## Step 2: Azure and GitHub setup

On Windows, use **Git Bash**. In every new terminal, run:

```bash
export MSYS_NO_PATHCONV=1                 # stop Git Bash rewriting /subscriptions/... paths
export ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
```

1. **Budget alert:** Azure portal → Cost Management → Budgets → monthly $25, alerts at 50% and 90%.
2. **Log in:** `az login`
3. **Terraform state storage:** `bash scripts/bootstrap-state.sh northeurope`. Note the two values it prints.
4. **GitHub repo:** create an empty **public** repo named `shortlink`. Don't push yet.
5. **Passwordless CI login:** `bash scripts/setup-github-oidc.sh <github-username>/shortlink`. Note the three values it prints.
6. **GitHub settings** → Secrets and variables → Actions:

| Type | Name | Value |
|---|---|---|
| Secret | `AZURE_CLIENT_ID` | from 2.5 |
| Secret | `AZURE_TENANT_ID` | from 2.5 |
| Secret | `AZURE_SUBSCRIPTION_ID` | from 2.5 |
| Variable | `TFSTATE_RESOURCE_GROUP` | from 2.3 |
| Variable | `TFSTATE_STORAGE_ACCOUNT` | from 2.3 |

---

## Step 3: Create the infrastructure (Terraform)

```bash
cd infra
terraform init -backend-config=backend.hcl
terraform plan          # review what will be created
terraform apply         # about 10-15 minutes
terraform output
cd ..
```

Add one more GitHub **variable**: `ACR_NAME` = `terraform -chdir=infra output -raw acr_name`

Install `kubectl` and `helm` (Windows, in PowerShell):
```powershell
winget install -e --id Kubernetes.kubectl
winget install -e --id Helm.Helm
```

Connect `kubectl` to the cluster:
```bash
az aks get-credentials -g rg-shortlink-prod -n aks-shortlink-prod
kubectl get nodes        # should show 1 node, STATUS Ready
```

---

## Step 4: Install the platform tools

```bash
bash scripts/install-platform.sh    # Envoy Gateway, Prometheus + Grafana, Argo CD (~10 min)
bash scripts/create-db-secret.sh    # DB connection Secret, read straight from Terraform outputs
```

Save the Grafana and Argo CD passwords the script prints.

---

## Step 5: Deploy with GitOps

1. In `argocd/shortlink-app.yaml`, replace `YOUR-GITHUB-USERNAME`.
2. Push the code. The **App CI** workflow builds the images and commits the new image tag:
   ```bash
   git init -b main
   git add .
   git commit -m "ShortLink on AKS"
   git remote add origin https://github.com/<github-username>/shortlink.git
   git push -u origin main
   ```
3. Wait for the workflow to finish (GitHub → Actions), then pull its commit: `git pull`
4. Tell Argo CD about the app:
   ```bash
   kubectl apply -f argocd/shortlink-app.yaml
   kubectl get pods -n shortlink --watch      # wait for Running and READY 1/1, then Ctrl+C
   ```
5. Get the public IP and open it in a browser:
   ```bash
   kubectl get gateway shortlink -n shortlink -o jsonpath='{.status.addresses[0].value}'; echo
   ```

From now on, **every push to `app/` deploys automatically**: CI → new tag in Git → Argo CD syncs.

---

## Step 6: Dashboards, monitoring and load testing

Each command below runs until you press Ctrl+C. Use a separate terminal for each.

```bash
# Argo CD UI → https://localhost:8081   (user: admin; accept the certificate warning)
kubectl port-forward svc/argocd-server -n argocd 8081:443

# Grafana → http://localhost:3001   (user: admin) → Dashboards → "ShortLink - Application Overview"
kubectl port-forward svc/monitoring-grafana -n monitoring 3001:80

# Prometheus → http://localhost:9090
kubectl port-forward svc/monitoring-kube-prometheus-prometheus -n monitoring 9090:9090
```

Load test and watch autoscaling (install k6 with `winget install k6`):
```bash
k6 run -e BASE_URL=http://<gateway-ip> loadtest/load-test.js
kubectl get hpa,pods -n shortlink --watch      # in another terminal
```

---

## Demo script (about 10 minutes)

1. **Architecture:** the diagram above.
2. **Terraform:** `infra/` and the resources in the Azure portal.
3. **GitOps deploy:** change the heading in `app/frontend/html/index.html`, push, and show: GitHub Actions (tests, Trivy) → the commit updating `values.yaml` → Argo CD syncing → the new version live.
4. **Self-healing:** `kubectl delete pod -n shortlink -l app.kubernetes.io/name=shortlink-api`, and Kubernetes replaces it. `kubectl scale deploy shortlink-web -n shortlink --replicas=3`, and Argo CD changes it back to match Git.
5. **Rollback:** `git revert HEAD && git push`, and Argo CD rolls back.
6. **Autoscaling:** k6 load test + HPA + the Grafana dashboard.
7. **Security:** non-root/read-only containers, internal-only API, OIDC, Trivy, secrets not in Git.

---

## Cost control

```bash
# Stop when not working (stops node and MySQL compute billing)
az aks stop -g rg-shortlink-prod -n aks-shortlink-prod
az mysql flexible-server stop -g rg-shortlink-prod -n $(terraform -chdir=infra output -raw mysql_server_name)

# Start again (about 5 minutes)
az aks start -g rg-shortlink-prod -n aks-shortlink-prod
az mysql flexible-server start -g rg-shortlink-prod -n $(terraform -chdir=infra output -raw mysql_server_name)

# After grading: delete everything
terraform -chdir=infra destroy
az group delete -n rg-shortlink-tfstate --yes
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Error mentioning `C:/Program Files/Git/subscriptions/...` | Run `export MSYS_NO_PATHCONV=1` in this terminal. |
| Region, quota or `SkuNotAvailable` error in `terraform apply` | Change `location` or `node_vm_size` (e.g. `Standard_B2s_v2`, `Standard_D2s_v5`) in `infra/terraform.tfvars`. |
| Pods in `ImagePullBackOff` | CI hasn't run yet, or `values.yaml` still says `REPLACE_ME`. Check GitHub Actions, then `git pull`. |
| API pod `Running` but `0/1` READY | Can't reach MySQL. Is MySQL started? Is the Secret right? `kubectl logs -n shortlink deploy/shortlink-api` |
| `CreateContainerConfigError` | The `shortlink-db` Secret is missing. Run `scripts/create-db-secret.sh`. |
| Gateway has no IP address | `kubectl get gateway -n shortlink` and `kubectl get pods -n envoy-gateway-system`. Allow 1-2 minutes. |
| No data in the Grafana ShortLink dashboard | Visit the site a few times first. In Prometheus → Status → Targets, check that `shortlink-api` is UP. |
| CI fails at "Update image tag" (push rejected) | A branch protection rule is blocking the bot. Allow GitHub Actions to push to `main`. |

---

## Stretch goals

- HTTPS: custom domain + cert-manager + Let's Encrypt on the Gateway
- Azure Key Vault + Secrets Store CSI driver + Workload Identity for the DB password
- Alertmanager → email/Slack alerts
- Argo CD "app of apps" to manage the platform tools via GitOps too
- Private MySQL access via VNet integration
- Staging environment (a second values file / Argo CD Application)
