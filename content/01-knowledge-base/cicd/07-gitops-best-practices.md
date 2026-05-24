# GitOps — Concepts & Best Practices

GitOps is an operational framework that applies DevOps best practices (version control, collaboration, CI/CD) to infrastructure automation. Git is the single source of truth; a software agent continuously reconciles the live system state with what is declared in Git.

## Quick Summary

1. **Git is the single source of truth** — if it's not in Git, it doesn't exist; no `kubectl apply` by hand in production
2. **Separate app repo from config repo** — app repo triggers CI (build image); config repo triggers CD (deploy)
3. **Pull-based, not push-based** — GitOps agents (ArgoCD/Flux) pull desired state from Git and reconcile automatically
4. **Enable selfHeal + prune in production** — auto-revert manual changes and remove zombie resources
5. **Environment-per-directory** — use `environments/dev|staging|prod/` directories in a single branch; avoid environment-per-branch drift
6. **Never store plaintext secrets in Git** — use External Secrets Operator (ESO), Sealed Secrets, or SOPS
7. **Promotion via PR** — promote across environments through pull requests with increasing review gates
8. **Alert on drift** — even with selfHeal on, log every drift correction as a signal of process violation

---

## 1. Core Principles (The Four GitOps Pillars)

| Pillar | Meaning |
|---|---|
| **Declarative** | Entire system state described declaratively (YAML, HCL, JSON) |
| **Versioned & Immutable** | Git is the single source of truth; history is tamper-evident |
| **Pulled Automatically** | Agents pull desired state from Git (not pushed by CI) |
| **Continuously Reconciled** | Agents detect and correct drift automatically |

- **Git = Source of Truth** — if it's not in Git, it doesn't exist
- **No `kubectl apply` by hand in production** — ever
- **Audit trail is free** — every change has a commit, author, timestamp, and PR link
- **Rollback = `git revert`** — no special tooling required
- **Separate concerns** — app code repo ≠ config/manifest repo

---

## 2. Repository Strategy

### Option A: Monorepo (All in One)

```text
infra-repo/
├── apps/
│   ├── myapp/
│   │   ├── dev/
│   │   ├── staging/
│   │   └── prod/
│   └── otherapp/
├── infrastructure/
│   ├── terraform/
│   └── crossplane/
└── clusters/
    ├── dev-cluster/
    └── prod-cluster/
```

**Pros:** single PR for coordinated changes, simple discoverability
**Cons:** noisy, harder access control, large blast radius

### Option B: Polyrepo (Recommended at Scale)

```text
app-repo/             # Application source code + Dockerfile
  └── triggers CI → builds image → updates config-repo

config-repo/          # Kubernetes manifests, Helm values, Kustomize
  └── watched by ArgoCD / Flux

infra-repo/           # Terraform, Terragrunt, Crossplane
  └── separate pipeline; longer lifecycle

platform-repo/        # Cluster-level configs, operators, addons
```

**Pros:** clear ownership, fine-grained access control, independent lifecycles
**Cons:** cross-repo PRs for coordinated changes, more automation needed

### Golden Rule

> **Application repo triggers CI. Config repo triggers CD.**
> CI builds & pushes the image → updates the image tag in config repo → GitOps agent syncs to cluster.

---

## 3. Branch Strategy

### Environment-per-Branch (Simple)

```text
main     → prod
staging  → staging
dev      → dev
```

Promotion = PR from `dev` → `staging` → `main`. Risk: branch divergence and merge conflicts over time.

### Environment-per-Directory (Recommended)

```text
main (only branch)
├── environments/dev/
├── environments/staging/
└── environments/prod/
```

Single branch, directories per environment. Promotion = PR that copies/updates manifests from `dev/` to `staging/`. Works well with Kustomize overlays and avoids branch sync issues entirely.

---

## 4. Promotion Strategy (Dev → Staging → Prod)

The recommended flow keeps humans in the loop for higher environments while automating the lower ones:

1. CI builds image → pushes to registry → image tag: `v1.2.3`
2. CI opens PR to config-repo: updates `environments/dev/myapp/values.yaml`
3. Auto-merged to dev (no review needed)
4. GitOps agent (ArgoCD/Flux) syncs → deploys to dev
5. Automated smoke tests run against dev
6. On success → PR opened: `dev/` → `staging/` (requires 1 reviewer)
7. On staging approval + tests pass → PR opened: `staging/` → `prod/` (requires 2 reviewers)

**Tools for automated promotion:** Argo Rollouts (canary/blue-green with analysis), Keptn (SLO/SLI quality gates), or custom scripts using the GitHub API.

---

## 5. Drift Detection & Reconciliation

Drift occurs when the live cluster state diverges from what is declared in Git — either from a manual `kubectl` change or a failed reconciliation.

GitOps agents handle drift in two ways:

- **selfHeal** — automatically reverts any manual change to the cluster back to the Git-declared state
- **prune** — removes resources that exist in the cluster but were deleted from Git (zombie resources)

```yaml
# ArgoCD — selfHeal corrects drift automatically
syncPolicy:
  automated:
    selfHeal: true
    prune: true

# Flux — re-applies desired state on every interval
spec:
  interval: 5m
  prune: true
```

- **Always alert on drift** — even if auto-healed, a drift event is a signal that someone bypassed the process
- Disable `selfHeal` on non-prod if teams need exploratory `kubectl` access during development
- Enable `selfHeal: true` always on production — no exceptions

---

## 6. Secret Management

**Never store plaintext secrets in Git** — even in private repos.

| Tool | Approach |
|---|---|
| **Sealed Secrets** | Encrypted in Git, decrypted by in-cluster controller |
| **External Secrets Operator (ESO)** | Syncs from AWS SSM/Secrets Manager, Vault, GCP SM |
| **Vault Agent / VSO** | Vault Secrets Operator injects secrets into K8s |
| **SOPS** | Encrypt secret files with KMS/GPG; decrypt at apply time |

### Sealed Secrets

```bash
# Encrypt a secret (safe to commit to Git)
kubeseal --format yaml < secret.yaml > sealed-secret.yaml
git add sealed-secret.yaml && git commit -m "feat: add db secret"

# Controller decrypts it in-cluster — never leaves the cluster in plaintext
```

### External Secrets Operator (ESO)

ESO is the **current industry standard** — it decouples the secret lifecycle from Kubernetes manifests by syncing from an external source:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: myapp-db
  namespace: myapp-prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: myapp-db-secret
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: prod/myapp/db
        property: password
```

---

## 7. Multi-Cluster GitOps

```text
config-repo/
├── clusters/
│   ├── dev/
│   │   └── flux-system/       # Flux bootstrapped here watches dev cluster
│   ├── staging/
│   └── prod/
├── environments/
│   ├── dev/
│   ├── staging/
│   └── prod/
└── platform/                  # Shared: monitoring, ingress, cert-manager
    ├── monitoring/
    └── ingress/
```

- Each cluster watches the same Git repo but a **different path**
- Platform addons (monitoring, ingress, cert-manager) are managed separately from apps
- Use **ArgoCD ApplicationSet** or **Flux** cluster generators to rollout across clusters — see [ArgoCD Guide](argocd.md) and [Flux Guide](flux.md)

---

## 8. Observability & Alerting

Key signals to monitor in a GitOps setup:

- **Sync status** — apps that are `OutOfSync` for more than a few minutes need attention
- **Health status** — a `Degraded` app means the deployment failed after syncing
- **Sync frequency** — a sudden drop means the pipeline is broken
- **Image update failures** — usually registry auth or tag policy issues
- **Drift events** — even auto-healed drift should generate a signal

Push sync events and failures to **Slack / PagerDuty / OpsGenie** as part of the platform's alerting strategy.

---

## 9. Access Control & Security

```text
Developer     → Read-only on GitOps UI; can trigger sync on dev apps only
Team Lead     → Can approve PRs to staging config
Platform Team → Full GitOps admin; approves prod PRs
CI Bot        → Can write to config-repo (image tag updates only)
```

- **SSO** via OIDC (GitHub, Google, Okta) for the GitOps control plane
- **RBAC** — limit what teams can sync, view, or delete per environment
- **Branch protection** — require PR reviews for `staging/` and `prod/` paths
- **CODEOWNERS** — auto-assign reviewers based on directory path
- **Signed commits** — verify author identity on config repo changes

```text
# .github/CODEOWNERS
environments/prod/*     @org/platform-team
environments/staging/*  @org/senior-devs
environments/dev/*      @org/devs
```

---

## 10. Kustomize in GitOps

Kustomize is the most common tool for managing environment-specific patches in a GitOps config repo. It is built into both `kubectl` and ArgoCD — no extra installation needed.

```text
base/
├── deployment.yaml
├── service.yaml
└── kustomization.yaml

overlays/
├── dev/
│   ├── kustomization.yaml
│   └── replica-patch.yaml
├── staging/
│   └── kustomization.yaml
└── prod/
    ├── kustomization.yaml
    └── resource-patch.yaml
```

```yaml
# overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namespace: myapp-prod
images:
  - name: myapp
    newTag: "1.2.3"           # Updated by CI automation
patches:
  - path: resource-patch.yaml
commonLabels:
  environment: prod
```

- Base = common manifests; overlays = environment-specific patches only
- Avoid duplicating entire manifests — patch only what differs
- Use the `images:` directive for image tag management (easy CI automation target)

---

## 11. Helm in GitOps

### Option A: Helm Chart as Source (values only in Git)

```yaml
# ArgoCD Application with Helm chart from registry
spec:
  source:
    repoURL: https://charts.myapp.com
    chart: myapp
    targetRevision: 1.2.3
    helm:
      valueFiles:
        - values-prod.yaml
      parameters:
        - name: image.tag
          value: "abc1234"
```

### Option B: Rendered Manifests (Helm → YAML → Git)

```bash
# CI renders the Helm chart to plain YAML and commits it to the config repo
helm template myapp ./charts/myapp -f values-prod.yaml > rendered/prod/myapp.yaml
git commit -am "chore: render myapp v1.2.3 for prod"
```

- **Rendered manifests** = full visibility into exactly what will be applied; no Helm dependency at sync time
- **Helm source** = simpler setup, but harder to diff (rendered at sync time by the agent)
- Prefer **rendered manifests for auditability** in regulated environments

---

## 12. Common Anti-Patterns

- ❌ Using `kubectl apply` directly in production — bypasses Git, no audit trail
- ❌ Storing plaintext secrets in Git, even in private repos
- ❌ Same repo for app code and K8s manifests — noisy, mixed lifecycle
- ❌ No branch protection on the config repo — anyone can push to the prod path
- ❌ `selfHeal: false` in production — manual changes accumulate as hidden debt
- ❌ `prune: false` — zombie resources linger and cause confusion
- ❌ Watching mutable tags like `latest` — use commit SHAs or semver tags
- ❌ No promotion gates — auto-promoting broken builds to prod
- ❌ No drift alerts — selfHeal silently fixes things, masking real process violations
- ❌ Skipping health checks in sync — app deployed but crashing still counts as "synced"

---

## 13. ArgoCD vs Flux

Both are CNCF Graduated projects and are the two dominant GitOps tools. The choice depends on your team's preferences and operational model.

| Feature | ArgoCD | Flux |
|---|---|---|
| UI | Rich web UI | CLI-first (Weave GitOps UI available) |
| Architecture | Central server + agent | Agent-only (no central server) |
| Multi-tenancy | Projects + RBAC | Namespace isolation + RBAC |
| Multi-cluster | Built-in hub-spoke model | Bootstrap per cluster |
| Helm support | Native | HelmRelease CRD |
| Kustomize | Native | Kustomization CRD |
| Image automation | ArgoCD Image Updater (add-on) | Built-in |
| Secret management | External (ESO, Vault, etc.) | External (ESO, SOPS, Vault) |
| Best for | Teams wanting UI + centralized control | Teams wanting lightweight, K8s-native |

→ See [ArgoCD Deep Dive](argocd.md) and [Flux Deep Dive](flux.md) for tool-specific configuration and patterns.