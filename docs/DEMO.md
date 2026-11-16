# ShortLink: demo script and Q&A guide

## 1. Before the presentation (30–45 minutes before)

```bash
cd ~/Downloads/shortlink
export MSYS_NO_PATHCONV=1
export ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv)

az aks start -g rg-shortlink-prod -n aks-shortlink-prod
az mysql flexible-server start -g rg-shortlink-prod -n mysql-shortlink-knqzj
kubectl get nodes                       # Ready
kubectl get pods -n shortlink           # if ImagePullBackOff: kubectl delete pod -n shortlink --all
kubectl get pods -A | grep -v Running   # should list only the header line
kubectl get gateway shortlink -n shortlink -o jsonpath='{.status.addresses[0].value}'; echo
```

**Open and test everything:**

| Terminal / tab | What |
|---|---|
| Terminal 1 | `kubectl port-forward svc/monitoring-grafana -n monitoring 3001:80` |
| Terminal 2 | `kubectl port-forward svc/argocd-server -n argocd 8081:443` |
| Terminal 3 | `while true; do clear; date; kubectl get hpa,pods -n shortlink; sleep 5; done` |
| Terminal 4 | Ready for commands (git, k6) |
| Browser tab 1 | The app: `http://<gateway-ip>` (create 1–2 links with harmless URLs) |
| Browser tab 2 | GitHub repo → **Actions** tab |
| Browser tab 3 | Argo CD → shortlink app (logged in) |
| Browser tab 4 | Grafana → ShortLink dashboard (logged in, Last 15 minutes, refresh 10s) |
| Browser tab 5 | Azure portal → resource group `rg-shortlink-prod` |

**Backup plan:** if the internet or the cluster fails during the demo, present from the screenshots in `docs/images/` and the README. Say calmly: *"I'll show the recorded results."* Examiners care that you understand the system.

---

## 2. The demo (about 10–12 minutes)

### Part 1: The problem and architecture (2 min)
- **Say:** "The brief was to design, provision, deploy and automate a containerized production web app. I built ShortLink, a URL shortener, and focused on the platform around it."
- **Show:** the README architecture diagram.
- **Say:** "Terraform provisions the Azure infrastructure. GitHub Actions is CI. Argo CD does GitOps-based CD onto AKS. Traffic enters through the Kubernetes Gateway API. Prometheus and Grafana provide observability."

### Part 2: Infrastructure as Code (1.5 min)
- **Show:** `infra/aks.tf`, then the resource group in the Azure portal.
- **Say:** "Everything in Azure was created from this code, so I can rebuild or destroy the whole environment with one command. State is stored remotely with versioning."
- **Mention:** "The first deploy hit a VM-size restriction and a zero vCPU quota. I diagnosed both from the errors and moved regions with a one-variable change."

### Part 3: Live GitOps deployment (3 min, the highlight)
1. In VS Code, change the `<h1>` in `app/frontend/html/index.html` (e.g. to `ShortLink v3`).
2. Commit and push:
   ```bash
   git pull && git add app/frontend/html/index.html && git commit -m "feat: demo change" && git push
   ```
3. **Show the GitHub Actions tab:** tests → chart lint → build → **Trivy scan** → push → release commit.
4. **Say while it runs (about 5 min):** "The pipeline never touches the cluster. Its last step commits the new image tag to Git. Argo CD, inside the cluster, sees that commit and deploys it."
5. Use the waiting time for Part 4, then come back to show Argo CD syncing and the new heading live.

### Part 4: Security (2 min, during the pipeline run)
- **OIDC:** "There are no Azure passwords in GitHub. Actions gets a short-lived token that Azure only accepts from this repo's main branch or production environment."
- **Trivy:** "Releases are blocked on fixable HIGH/CRITICAL CVEs. It caught 10 in npm, which I removed from the runtime image because the app doesn't need it, and 13 in Nginx's OS packages, which I patched."
- **Supply chain:** "The scanner action itself was hit by a real supply-chain attack in March 2026, when its version tags were hijacked. I moved to an immutable release."
- **Containers:** show `helm/shortlink/templates/api.yaml`: non-root user, read-only filesystem, dropped capabilities, internal-only Service.

### Part 5: Self-healing (1 min)
```bash
kubectl delete pod -n shortlink -l app.kubernetes.io/name=shortlink-api
```
- **Show:** Terminal 3, where a replacement pod appears within seconds.
- **Say:** "Kubernetes maintains desired state. And if someone changes something by hand, Argo CD reverts it to match Git."

### Part 6: Autoscaling and observability (2 min)
- **Show:** the Grafana dashboard and the screenshots in the README Results section. Optionally, start the k6 test live.
- **Say:** "Under 150 concurrent users, the system served 82,747 requests at 275 per second with zero errors and p95 of 282 ms. CPU hit 196% of target, so the HPA scaled the API from 1 to 4 pods, then back to 1 when the load ended."
- **Say:** "The 4th pod stayed Pending because the single node was full. The HPA scales pods, the Cluster Autoscaler scales nodes. I'd enable it in production; I kept one node here for cost."

### Part 7: Wrap-up (30 sec)
- Back to the app: show the new heading is live.
- **Say:** "Every change goes through the same tested, scanned, audited path, from a commit to production with no manual steps. Next steps would be the Cluster Autoscaler, HTTPS, Key Vault and private networking."

---

## 3. Likely examiner questions

**Why AKS rather than a simpler service like Azure Container Apps?**
Container Apps would be simpler and cheaper for an app this size. I chose AKS because Kubernetes is the industry standard, and I wanted to show Helm, GitOps, the Gateway API and HPA. For a small production app I'd consider Container Apps first. The choice depends on team skills and scale.

**What is GitOps, and why use it?**
Git is the single source of truth for what runs in the cluster. An agent inside the cluster (Argo CD) pulls and applies it. Benefits: every deployment is a reviewable commit, rollback is `git revert`, drift is corrected automatically, and CI never needs cluster credentials.

**What's the difference between CI and CD in your pipeline?**
CI (GitHub Actions) verifies and packages: test, lint, build, scan, push. CD (Argo CD) delivers: it applies the desired state from Git to the cluster. The hand-off between them is a Git commit.

**How do secrets work?**
CI uses OIDC, so no stored cloud secrets. The DB password is generated by Terraform and put into a Kubernetes Secret directly from Terraform's output, never into Git. The improvement is Key Vault with the Secrets Store CSI driver and Workload Identity.

**What happens if a deployment is bad?**
Readiness probes stop broken pods from receiving traffic, and the rolling update keeps the old pods until the new ones are ready (`maxUnavailable: 0`). To roll back, revert the commit and Argo CD redeploys the previous version, or use Argo CD's history and rollback.

**How does the HPA decide to scale?**
It compares average CPU usage against the pods' CPU *requests* (target 60%) every 15 seconds using metrics-server, and calculates the needed replicas. Scale-down waits about 5 minutes to avoid flapping.

**Why did one pod stay Pending?**
The scheduler only places a pod where its CPU and memory requests fit. The single node was full, so the 4th replica waited. The Cluster Autoscaler would add a node.

**Why the Gateway API instead of Ingress?**
The Gateway API is the newer Kubernetes standard for traffic routing, with clearer roles and more features. The widely used ingress-nginx controller was retired in March 2026, so new projects should use the Gateway API.

**How would you make this highly available?**
Multiple nodes across availability zones, at least 2 replicas of each component with PodDisruptionBudgets, the AKS Standard tier (uptime SLA), zone-redundant MySQL, and HTTPS through a managed front door or WAF.

**What was the hardest problem?**
Pick one and tell it as **problem → diagnosis → fix → lesson**. Good choices: the Terraform `-replace` issue (#3), the OIDC subject mismatch (#5), or the Trivy findings (#7). See the Challenges table in the README.

**How much does it cost?**
The AKS control plane is free on the Free tier. The main costs are the single burstable node, Basic ACR and Burstable MySQL. I stop the cluster and database when they're idle, set a budget alert, and will tear everything down with `terraform destroy` after the project.
