# ArgoCD — Core Concepts & Best Practices

ArgoCD is a declarative, GitOps continuous delivery tool for Kubernetes. It runs as an agent in the cluster, pulling desired state from Git and applying it to the cluster.

## 1. Core Resources

### Application Manifest

The `Application` CRD is the fundamental unit of deployment in ArgoCD. It links a source (Git repo) to a destination (Kubernetes cluster and namespace).

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-prod
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io  # Cascade delete on app removal
spec:
  project: myapp-project
  source:
    repoURL: https://github.com/org/config-repo
    targetRevision: main
    path: environments/prod/myapp
  destination:
    server: https://kubernetes.default.svc
    namespace: myapp-prod
  syncPolicy:
    automated:
      prune: true        # Remove resources deleted from Git
      selfHeal: true     # Revert manual kubectl changes
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
      - ApplyOutOfSyncOnly=true    # Only sync changed resources
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### ArgoCD App of Apps Pattern

Instead of creating Applications manually via the UI or CLI, use a "root" Application that watches a folder of other Application manifests.

```yaml
# root-app.yaml — manages all other Applications
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-app
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/org/config-repo
    targetRevision: main
    path: argocd/applications      # Folder containing other Application manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Folder structure:
```text
argocd/applications/
├── myapp-dev.yaml
├── myapp-staging.yaml
├── myapp-prod.yaml
├── monitoring.yaml
└── ingress-nginx.yaml
```

- Bootstrap the cluster with one `kubectl apply -f root-app.yaml`
- All other apps self-manage from Git thereafter

### ApplicationSet (Multi-Cluster / Multi-Env)

Use `ApplicationSet` to generate multiple `Application` resources from a single template, perfect for deploying across many clusters or environments.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: dev
            cluster: dev-cluster
            url: https://dev-k8s.example.com
          - env: staging
            cluster: staging-cluster
            url: https://staging-k8s.example.com
          - env: prod
            cluster: prod-cluster
            url: https://prod-k8s.example.com
  template:
    metadata:
      name: "myapp-{{env}}"
    spec:
      project: myapp
      source:
        repoURL: https://github.com/org/config-repo
        targetRevision: main
        path: "environments/{{env}}/myapp"
      destination:
        server: "{{url}}"
        namespace: "myapp-{{env}}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

- Generates one Application per list item automatically
- Adding a new environment just requires adding one list entry

## 2. Security & Guardrails

### ArgoCD Projects (RBAC)

Projects enforce boundaries on what an Application can do.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: myapp-project
  namespace: argocd
spec:
  description: MyApp workloads
  sourceRepos:
    - https://github.com/org/config-repo   # Whitelist source repos
  destinations:
    - namespace: myapp-*                   # Allowed target namespaces
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  namespaceResourceBlacklist:
    - group: ""
      kind: ResourceQuota              # Prevent teams from changing their own quotas
  roles:
    - name: developer
      policies:
        - p, proj:myapp-project:developer, applications, sync, myapp-project/*, allow
        - p, proj:myapp-project:developer, applications, get, myapp-project/*, allow
```

- Apply **least privilege** — developers can trigger syncs but not delete production apps
- Restrict which repositories can be used as sources

## 3. Image Update Automation

### ArgoCD Image Updater

Automate updating container images by annotating the Application resource. The Image Updater polls the registry and updates the app when a new tag matches the policy.

```yaml
# Annotation-based configuration on the Application
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: myapp=myrepo/myapp
    argocd-image-updater.argoproj.io/myapp.update-strategy: semver
    argocd-image-updater.argoproj.io/myapp.allow-tags: regexp:^1\.[0-9]+\.[0-9]+$
    argocd-image-updater.argoproj.io/write-back-method: git  # Crucial: commit tag back to Git
```

- Always use `write-back-method: git` to maintain Git as the single source of truth.

## 4. Observability

### Key Prometheus Metrics

```text
argocd_app_info                              # App health and sync status
argocd_app_sync_total                        # Sync frequency
argocd_app_reconcile_duration_seconds        # Reconcile time
```

### Alert Examples

```yaml
# Alert: App out of sync for > 5 minutes
- alert: ArgoCDAppOutOfSync
  expr: argocd_app_info{sync_status="OutOfSync"} > 0
  for: 5m
  annotations:
    summary: "ArgoCD app {{ $labels.name }} is out of sync"

# Alert: App degraded
- alert: ArgoCDAppDegraded
  expr: argocd_app_info{health_status="Degraded"} > 0
  for: 2m
```

## 5. Useful CLI Commands

```bash
argocd app list
argocd app get myapp-prod
argocd app sync myapp-prod
argocd app sync myapp-prod --dry-run
argocd app diff myapp-prod
argocd app history myapp-prod
argocd app rollback myapp-prod 3               # Rollback to revision 3
argocd app set myapp-prod --sync-policy none   # Disable auto-sync temporarily
```
