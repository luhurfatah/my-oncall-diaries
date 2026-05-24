# Kubernetes — GitOps, Helm & Multi-Cluster

> **Scope:** Production GitOps workflows with ArgoCD, Helm packaging patterns, multi-cluster and multi-tenancy design. Covers the non-obvious pitfalls of running GitOps at scale.

---

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Helm — Advanced Patterns](#1-helm--advanced-patterns) | Chart structure, _helpers.tpl, multi-environment values architecture, and Helm gotchas. |
| **02** | [GitOps Principles](#2-gitops-principles) | OpenGitOps four principles, repo structure options, and app vs config repo separation. |
| **03** | [ArgoCD — Production Setup](#3-argocd--production-setup) | HA installation, RBAC configuration, and Application spec best practices. |
| **04** | [ArgoCD — Multi-Environment & Multi-Cluster](#4-argocd--multi-environment--multi-cluster) | AppProject tenancy, ApplicationSet DRY deployments, and multi-cluster registration. |
| **05** | [Progressive Delivery — Argo Rollouts](#5-progressive-delivery--argo-rollouts) | Canary deployment steps, AnalysisTemplate automated gates, and blue-green strategy. |
| **06** | [Multi-Cluster Architecture](#6-multi-cluster-architecture) | Cluster topology patterns, federated observability with Thanos, and cross-cluster service discovery. |
| **07** | [Multi-Tenancy Patterns](#7-multi-tenancy-patterns) | Namespace-per-team soft isolation, vCluster virtual clusters, and Cluster API lifecycle management. |

---

## 1. Helm — Advanced Patterns

### Chart Structure Best Practices

```
charts/myapp/
  Chart.yaml              ← Chart metadata, dependencies
  values.yaml             ← Defaults (safe for all envs)
  values-staging.yaml     ← Staging overrides
  values-prod.yaml        ← Production overrides
  templates/
    _helpers.tpl           ← Template functions, name helpers
    deployment.yaml
    service.yaml
    ingress.yaml
    hpa.yaml
    pdb.yaml
    servicemonitor.yaml
    networkpolicy.yaml
    NOTES.txt              ← Post-install instructions
  .helmignore
```

### Chart.yaml — Pin Dependencies

```yaml
apiVersion: v2
name: myapp
description: Payment service
type: application
version: 1.4.2           # Chart version — bump on chart changes
appVersion: "3.1.0"      # App image version — bump on app changes

dependencies:
  - name: redis
    version: "19.x.x"    # Use range for patch updates
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
```

`version` (chart) and `appVersion` (app) are separate. Bump `version` on any chart template/values change, `appVersion` on image tag changes.

### _helpers.tpl — Reusable Patterns

```yaml
{{/* Standard labels applied to all resources */}}
{{- define "myapp.labels" -}}
helm.sh/chart: {{ include "myapp.chart" . }}
app.kubernetes.io/name: {{ include "myapp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Values.global.team }}
team: {{ .Values.global.team }}
{{- end }}
{{- end }}

{{/* Selector labels (immutable — don't change after initial deploy) */}}
{{- define "myapp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "myapp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

### Values Architecture for Multi-Environment

```yaml
# values.yaml — safe defaults
replicaCount: 1
image:
  repository: myregistry/myapp
  tag: ""                      # Overridden by CI with commit SHA
  pullPolicy: IfNotPresent

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

pdb:
  enabled: false
  minAvailable: 1

ingress:
  enabled: false

networkPolicy:
  enabled: true
  denyAll: true

---
# values-prod.yaml — production overrides
replicaCount: 3

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 2
    memory: 2Gi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 50

pdb:
  enabled: true
  minAvailable: 2

ingress:
  enabled: true
  host: myapp.example.com
```

### Helm Workflow — CI/CD Best Practices

```bash
# 1. Lint before any apply
helm lint charts/myapp -f charts/myapp/values-prod.yaml

# 2. Preview changes (requires helm-diff plugin)
helm diff upgrade myapp charts/myapp \
  -n app-prod \
  -f charts/myapp/values-prod.yaml \
  --set image.tag=abc123

# 3. Template rendering test (catch YAML errors)
helm template myapp charts/myapp \
  -f charts/myapp/values-prod.yaml | kubectl apply --dry-run=client -f -

# 4. Upgrade with atomic rollback on failure
helm upgrade --install myapp charts/myapp \
  -n app-prod \
  -f charts/myapp/values-prod.yaml \
  --set image.tag=abc123 \
  --atomic \                    # Auto-rollback on failure
  --timeout 5m \
  --wait \                      # Wait for all resources to be ready
  --history-max 10              # Keep last 10 revisions

# 5. Verify
helm test myapp -n app-prod    # Run test hooks (smoke tests)
```

### Helm Gotchas

- **`--atomic` failure leaves Helm in a failed state** — subsequent `upgrade` will fail unless you run `helm rollback` or `helm upgrade --force` first.
- **Immutable fields cause upgrade failure** — if you change a field like `selector.matchLabels` on a Deployment (immutable), Helm upgrade fails. Solution: `helm upgrade --force` (deletes + recreates) or use `helm uninstall` + reinstall. Plan schema changes carefully.
- **Secret values in Helm values files** — never store secrets in values.yaml. Use External Secrets and reference the K8s Secret name in values. Use `helm-secrets` plugin if you must store encrypted values in Git.
- **`helm template` output is not identical to `helm install`** — some hooks, lookup functions, and conditionals behave differently. Always test with `--dry-run=server` (requires cluster access) for the most accurate preview.
- **CRD installation via Helm** — CRDs in `crds/` directory are installed on first install only, **never upgraded or deleted** by Helm. Use separate CRD management (ArgoCD's CRD sync, helm-crds-install job) for CRD lifecycle management.

---

## 2. GitOps Principles

### The Four Core Principles (OpenGitOps)

1. **Declarative** — desired state described in files, not procedures
2. **Versioned and immutable** — state stored in Git with history
3. **Pulled automatically** — controllers pull and apply from Git (not push)
4. **Continuously reconciled** — controllers detect and correct drift

### Repository Structure Options

**Mono-repo (recommended for small/medium orgs):**
```
gitops-repo/
  apps/
    myapp/
      base/                    ← Common manifests
        deployment.yaml
        service.yaml
        kustomization.yaml
      overlays/
        staging/               ← Staging-specific patches
          kustomization.yaml
          replica-patch.yaml
        prod/
          kustomization.yaml
          replica-patch.yaml
  infrastructure/
    monitoring/
    ingress/
    cert-manager/
  clusters/
    prod-cluster/
      apps.yaml                ← ArgoCD App-of-Apps
    staging-cluster/
      apps.yaml
```

**Multi-repo (for large orgs with separate team ownership):**
```
platform-repo/       ← Platform team: infra, operators, shared tools
app-payments-repo/   ← Payments team: their app manifests only
app-data-repo/       ← Data team: their app manifests
```

Multi-repo needs clear access controls — platform team writes to platform-repo, app teams write to their own repos. ArgoCD has read access to all.

### Separation of App Repo and Config Repo

Critical pattern: **application source code and deployment manifests live in separate repos.**

```
app-repo/ (developers push code here)
  src/
  Dockerfile
  .github/workflows/build.yaml    ← CI: build image, push, update config-repo

config-repo/ (GitOps controller watches this)
  apps/myapp/prod/
    deployment.yaml               ← CI bot bumps image tag here via PR/commit
```

Why: Merging code doesn't automatically deploy. The CI pipeline explicitly updates the config-repo image tag. This creates a clear audit trail: "which Git commit caused this deployment?"

---

## 3. ArgoCD — Production Setup

### Production-Grade ArgoCD Installation

```yaml
# argocd-values.yaml
global:
  nodeSelector:
    node-role: platform

server:
  replicas: 2
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 5
  resources:
    requests:
      cpu: 100m
      memory: 256Mi

repoServer:
  replicas: 2              # Scale this under heavy load (chart rendering)
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 5
  resources:
    requests:
      cpu: 200m
      memory: 512Mi

applicationSet:
  replicas: 2

redis-ha:
  enabled: true            # HA Redis for production (not standalone)

configs:
  params:
    server.insecure: false
    application.namespaces: "app-prod,app-staging,app-dev"  # Allow apps in these namespaces
```

### ArgoCD RBAC

```yaml
# argocd-rbac-cm ConfigMap
policy.csv: |
  # Admins — full access
  g, platform-team, role:admin

  # Developers — can sync their own apps, read-only on others
  p, role:developer, applications, get, */*, allow
  p, role:developer, applications, sync, payments/*, allow
  p, role:developer, applications, override, payments/*, allow
  p, role:developer, logs, get, payments/*, allow

  g, payments-team, role:developer

  # Read-only for auditors
  p, role:auditor, applications, get, */*, allow
  g, security-team, role:auditor

policy.default: role:readonly    # Default: everyone gets read-only
```

### Application Spec — Production Best Practices

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payments-prod
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io   # Cascade delete: remove K8s resources when App deleted
spec:
  project: payments
  source:
    repoURL: https://github.com/org/gitops-repo
    targetRevision: main
    path: apps/payments/prod
    helm:
      releaseName: payments
      valueFiles:
        - values.yaml
        - values-prod.yaml
      parameters:
        - name: image.tag
          value: abc123def

  destination:
    server: https://kubernetes.default.svc
    namespace: payments-prod

  syncPolicy:
    automated:
      prune: true           # Remove resources deleted from Git
      selfHeal: true        # Revert manual kubectl changes
      allowEmpty: false     # Don't prune everything if source is empty (safety)
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground    # Wait for child resources to delete
      - PruneLast=true                       # Delete old resources after new ones are healthy
      - RespectIgnoreDifferences=true
      - ServerSideApply=true                 # Use SSA for better conflict handling

  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas        # Don't revert HPA-managed replica count
    - group: ""
      kind: ConfigMap
      name: argocd-cm
      jsonPointers:
        - /data

  revisionHistoryLimit: 5
```

### `ignoreDifferences` — Critical for HPA + GitOps

Without ignoring `/spec/replicas`, ArgoCD will detect drift every time HPA changes the replica count and try to revert it to the value in Git. Always ignore replicas when HPA is managing them.

---

## 4. ArgoCD — Multi-Environment & Multi-Cluster

### AppProject — Tenancy Boundaries

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: payments
  namespace: argocd
spec:
  description: Payments team applications
  sourceRepos:
    - 'https://github.com/org/gitops-repo'
    - 'https://github.com/org/payments-app'

  destinations:
    - namespace: payments-*       # Can deploy to any payments-* namespace
      server: https://kubernetes.default.svc
    - namespace: payments-prod
      server: https://prod-cluster-api.example.com

  clusterResourceWhitelist:       # Cluster-scoped resources this project can manage
    - group: ''
      kind: Namespace

  namespaceResourceBlacklist:     # Namespace resources this project CANNOT manage
    - group: ''
      kind: ResourceQuota         # Platform team manages quotas, not app teams

  roles:
    - name: payments-deployer
      policies:
        - p, proj:payments:payments-deployer, applications, sync, payments/*, allow
      groups:
        - payments-ci-bot
```

### ApplicationSet — DRY Multi-Environment Deployments

ApplicationSet generates multiple ArgoCD Applications from a single template:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: payments-all-envs
  namespace: argocd
spec:
  goTemplate: true
  generators:
    - matrix:                    # Combine two generators
        generators:
          - list:
              elements:
                - env: staging
                  cluster: https://staging-cluster.example.com
                  namespace: payments-staging
                  values_file: values-staging.yaml
                - env: prod
                  cluster: https://prod-cluster.example.com
                  namespace: payments-prod
                  values_file: values-prod.yaml

  template:
    metadata:
      name: 'payments-{{.env}}'
    spec:
      project: payments
      source:
        repoURL: https://github.com/org/gitops-repo
        targetRevision: main
        path: apps/payments
        helm:
          valueFiles:
            - values.yaml
            - '{{.values_file}}'
      destination:
        server: '{{.cluster}}'
        namespace: '{{.namespace}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### Multi-Cluster Registration

```bash
# Register remote cluster with ArgoCD
argocd cluster add prod-cluster \
  --name prod-cluster \
  --kubeconfig ~/.kube/config \
  --context prod-cluster-context \
  --system-namespace argocd

# ArgoCD creates a ServiceAccount in the remote cluster
# with cluster-admin (or custom RBAC) for deploying resources
```

For production multi-cluster, use **ArgoCD pull mode** (argocd-agent) to avoid giving the central ArgoCD cluster-admin on remote clusters — the remote cluster pulls its own sync state.

---

## 5. Progressive Delivery — Argo Rollouts

Argo Rollouts provides advanced deployment strategies beyond what K8s Deployments support natively.

### Canary Deployment

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: payments-api
spec:
  replicas: 10
  strategy:
    canary:
      canaryService: payments-canary-svc    # Traffic goes to canary pods
      stableService: payments-stable-svc    # Traffic goes to stable pods
      trafficRouting:
        nginx:
          stableIngress: payments-ingress
      steps:
        - setWeight: 5            # 5% to canary
        - pause:
            duration: 5m          # Wait 5 min, watch metrics
        - setWeight: 20
        - pause:
            duration: 10m
        - analysis:               # Run automated analysis before proceeding
            templates:
              - templateName: success-rate-check
        - setWeight: 50
        - pause:
            duration: 10m
        - setWeight: 100          # Full rollout

  selector:
    matchLabels:
      app: payments-api
  template:
    # ... pod template
```

### AnalysisTemplate — Automated Gate

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate-check
spec:
  metrics:
    - name: success-rate
      interval: 1m
      successCondition: result[0] >= 0.95     # 95% success rate
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            sum(rate(http_requests_total{app="payments-api",status_code!~"5.."}[5m]))
            / sum(rate(http_requests_total{app="payments-api"}[5m]))
```

If analysis fails, Rollout automatically reverts to stable. No manual intervention needed.

### Blue-Green Deployment

```yaml
strategy:
  blueGreen:
    activeService: payments-active
    previewService: payments-preview
    autoPromotionEnabled: false    # Manual promotion — review preview before going live
    prePromotionAnalysis:
      templates:
        - templateName: success-rate-check
    postPromotionAnalysis:
      templates:
        - templateName: success-rate-check
    scaleDownDelaySeconds: 300     # Keep old (blue) pods for 5min after promotion
```

Blue-green gives you a live preview environment before promotion — useful for QA sign-off on production traffic.

---

## 6. Multi-Cluster Architecture

### Cluster Topology Patterns

**Environment-based (most common):**
```
prod-cluster        → All production workloads
staging-cluster     → All staging workloads
dev-cluster         → All dev/test workloads
```

**Workload-based:**
```
compute-cluster     → Stateless applications
data-cluster        → Databases, Kafka, stateful workloads
ml-cluster          → GPU workloads, training jobs
```

**Regional:**
```
ap-southeast-1-cluster   → SEA production
us-east-1-cluster        → US production
eu-west-1-cluster        → EU production (data residency)
```

### Federated Observability

Each cluster has its own Prometheus. Aggregate with Thanos or Victoria Metrics:

```
Cluster 1 Prometheus → Thanos Sidecar → Object Storage (S3)
Cluster 2 Prometheus → Thanos Sidecar → Object Storage (S3)
                                              ↓
                                    Thanos Query → Grafana
                                    (single query plane across all clusters)
```

```yaml
# Thanos Sidecar alongside Prometheus
containers:
  - name: thanos-sidecar
    image: quay.io/thanos/thanos:v0.35.0
    args:
      - sidecar
      - --prometheus.url=http://localhost:9090
      - --objstore.config-file=/etc/thanos/objstore.yaml
      - --tsdb.path=/prometheus
    volumeMounts:
      - name: prometheus-data
        mountPath: /prometheus
      - name: thanos-config
        mountPath: /etc/thanos
```

### Cross-Cluster Service Discovery

Options in order of complexity:
1. **External DNS + shared Route53** — each cluster registers its services, others discover via DNS
2. **Submariner** — direct pod-to-pod networking across clusters
3. **Istio multi-cluster** — federated service mesh
4. **Skupper** — application-layer networking, no cluster admin required

For most cases: expose services via internal load balancers with Route53 private hosted zones — simpler than mesh federation.

---

## 7. Multi-Tenancy Patterns

### Namespace-per-Team (Soft Multi-Tenancy)

```
Cluster: prod-cluster
  Namespace: payments-prod   → payments-team owns this
  Namespace: data-prod       → data-team owns this
  Namespace: platform-prod   → platform-team owns this
```

Isolation via: RBAC, ResourceQuota, LimitRange, NetworkPolicy, PodSecurity.

**Not true isolation** — a compromised pod can still reach the K8s API server, other namespaces via ClusterIP (if NetworkPolicy not enforced), and host network (if not blocked by PSS).

### vCluster — Virtual Clusters

vCluster creates a K8s control plane inside a namespace of the host cluster. Each tenant gets their own API server, etcd, and controller manager — full K8s API compatibility.

```bash
helm install my-vcluster vcluster \
  --repo https://charts.loft.sh \
  --namespace team-a-vcluster \
  --create-namespace \
  -f vcluster-values.yaml
```

```yaml
# vcluster-values.yaml
vcluster:
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
sync:
  ingresses:
    enabled: true
  storageClasses:
    enabled: false           # Use host cluster's storage classes
```

vCluster advantages:
- Full K8s API compatibility (CRDs, webhooks, RBAC)
- Dev teams can install operators, CRDs without cluster-admin on real cluster
- Strong isolation per tenant
- Lightweight — runs as pods in the host cluster

Use when: dev teams need cluster-admin privileges for testing, or when you need to provide isolated K8s environments for multiple teams/customers.

### Cluster API — Cluster Lifecycle Management

For managing many clusters programmatically:

```yaml
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: payments-prod-us-east-1
spec:
  clusterNetwork:
    pods:
      cidrBlocks: ["10.100.0.0/16"]
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta2
    kind: AWSCluster
    name: payments-prod-us-east-1
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta2
    kind: KubeadmControlPlane
    name: payments-prod-us-east-1-cp
```

Cluster API manages cluster creation, upgrades, and deletion via K8s-native CRDs — GitOps for clusters themselves, not just workloads.

---

*Last updated: 2026-05 | Author: Personal KB | Stack: ArgoCD 2.x, Helm 3.x, Argo Rollouts, Kustomize*