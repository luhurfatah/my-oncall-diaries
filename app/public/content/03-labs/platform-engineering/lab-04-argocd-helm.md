# Lab 04 — Argo CD: Helm Charts & Kustomize


## 🎯 Objectives

By the end of this lab, you will:

- Deploy Helm-based applications through Argo CD
- Deploy Kustomize-based applications through Argo CD
- Use Kustomize overlays for multi-environment management (dev/staging/prod)
- Understand and use Argo CD Sync Waves for ordered deployments
- Implement Sync Hooks (PreSync, PostSync) for lifecycle operations
- Master Helm value overrides in Argo CD

---

## 📋 Prerequisites

- Completed **Lab 03** (Argo CD installed and running)
- Argo CD CLI authenticated
- Helm installed

---

## 📚 Concepts

### How Argo CD Renders Manifests

Argo CD doesn't just apply plain YAML — it supports multiple manifest generation tools:

Argo CD handles manifest rendering dynamically by acting as a pipeline between Git and the Kubernetes API:

- **Git Repository:** Stores plain YAML manifests, Helm Charts, or Kustomize base + overlays.
- **Argo CD Repo Server:** Detects the format automatically, runs the appropriate template commands (e.g., `helm template` or `kustomize build`), and generates flat, plain Kubernetes manifests (YAML).
- **Kubernetes Cluster:** The generated plain manifests are applied to the cluster, ensuring git-driven parity.

### Helm vs. Kustomize

| Aspect | Helm | Kustomize |
|--------|------|-----------|
| **Approach** | Templating (Go templates) | Patching (strategic merge) |
| **Packaging** | Charts with `Chart.yaml` | Directories with `kustomization.yaml` |
| **Parameterization** | `values.yaml` | Patches and overlays |
| **Complexity** | Higher (template syntax) | Lower (pure YAML) |
| **Ecosystem** | Huge chart ecosystem | Built into kubectl |
| **Best For** | Distributing reusable packages | Environment-specific customization |

### Sync Waves and Hooks

Sync waves control the **order** of resource deployment:

| Wave -1 (System Foundations) | Wave 0 (Configurations) | Wave 1 (Workloads) | Wave 2 (Routing & Monitoring) |
|---|---|---|---|
| • Namespaces<br>• CRDs<br>• RBAC | • ConfigMaps<br>• Secrets<br>• PVCs | • Deployments<br>• Services | • Ingress<br>• Monitoring |

---

## 🔬 Hands-On Exercises

### Exercise 1: Deploy a Helm Chart via Argo CD

#### Step 1: Create a Helm-Based Application

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx-helm
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://charts.bitnami.com/bitnami
    chart: nginx
    targetRevision: "*"
    helm:
      releaseName: my-nginx
      values: |
        replicaCount: 2
        service:
          type: ClusterIP
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
        metrics:
          enabled: false
  destination:
    server: https://kubernetes.default.svc
    namespace: nginx-helm
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
EOF

# Wait for sync
argocd app wait nginx-helm --health --timeout 120

# View the application
argocd app get nginx-helm

# Check deployed resources
kubectl get all -n nginx-helm
```

#### Step 2: Override Helm Values

```bash
# Update Helm values using the CLI
argocd app set nginx-helm \
  --helm-set replicaCount=3 \
  --helm-set service.type=NodePort

# Sync the changes
argocd app sync nginx-helm

# Verify the changes
kubectl get pods -n nginx-helm
kubectl get svc -n nginx-helm
```

#### Step 3: View the Rendered Manifests

```bash
# See what Argo CD renders from the Helm chart
argocd app manifests nginx-helm | head -80

# Compare with helm template output
helm template my-nginx bitnami/nginx \
  --set replicaCount=3 \
  --set service.type=NodePort | head -80
```

---

### Exercise 2: Deploy from a Helm Chart in Git

This pattern is common — storing your Helm chart in the same repo as your app code.

```bash
# Create a Helm-based app from a Git repo
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: helm-guestbook-git
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: helm-guestbook
    helm:
      valueFiles:
        - values.yaml
      parameters:
        - name: replicaCount
          value: "2"
  destination:
    server: https://kubernetes.default.svc
    namespace: helm-guestbook-git
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
EOF

argocd app sync helm-guestbook-git
argocd app wait helm-guestbook-git --health
argocd app get helm-guestbook-git
```

---

### Exercise 3: Kustomize Basics with Argo CD

#### Step 1: Create a Kustomize Base

```bash
mkdir -p ~/gitops-repo/kustomize-app/{base,overlays/{dev,staging,prod}}

# Base deployment
cat <<'EOF' > ~/gitops-repo/kustomize-app/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: platform-app
  labels:
    app: platform-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: platform-app
  template:
    metadata:
      labels:
        app: platform-app
    spec:
      containers:
      - name: app
        image: hashicorp/http-echo:0.2.3
        args:
          - "-text=Hello from BASE environment"
          - "-listen=:8080"
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
EOF

# Base service
cat <<'EOF' > ~/gitops-repo/kustomize-app/base/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: platform-app
spec:
  selector:
    app: platform-app
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF

# Base kustomization
cat <<'EOF' > ~/gitops-repo/kustomize-app/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml

commonLabels:
  managed-by: platform-team
  part-of: platform-engineering-labs
EOF
```

#### Step 2: Create Environment Overlays

**Dev Overlay:**

```bash
cat <<'EOF' > ~/gitops-repo/kustomize-app/overlays/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: platform-dev

namePrefix: dev-

resources:
  - ../../base

labels:
  - pairs:
      environment: dev
    includeSelectors: false

patches:
  - target:
      kind: Deployment
      name: platform-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 1
      - op: replace
        path: /spec/template/spec/containers/0/args
        value:
          - "-text=Hello from DEV environment 🔧"
          - "-listen=:8080"
EOF
```

**Staging Overlay:**

```bash
cat <<'EOF' > ~/gitops-repo/kustomize-app/overlays/staging/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: platform-staging

namePrefix: staging-

resources:
  - ../../base

labels:
  - pairs:
      environment: staging
    includeSelectors: false

patches:
  - target:
      kind: Deployment
      name: platform-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 2
      - op: replace
        path: /spec/template/spec/containers/0/args
        value:
          - "-text=Hello from STAGING environment 🧪"
          - "-listen=:8080"
EOF
```

**Prod Overlay:**

```bash
cat <<'EOF' > ~/gitops-repo/kustomize-app/overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: platform-prod

namePrefix: prod-

resources:
  - ../../base

labels:
  - pairs:
      environment: prod
    includeSelectors: false

patches:
  - target:
      kind: Deployment
      name: platform-app
    patch: |
      - op: replace
        path: /spec/replicas
        value: 3
      - op: replace
        path: /spec/template/spec/containers/0/args
        value:
          - "-text=Hello from PRODUCTION environment 🚀"
          - "-listen=:8080"
      - op: replace
        path: /spec/template/spec/containers/0/resources
        value:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
EOF
```

#### Step 3: Test Kustomize Locally

```bash
# Preview what each overlay generates
echo "=== DEV ==="
kubectl kustomize ~/gitops-repo/kustomize-app/overlays/dev/

echo ""
echo "=== STAGING ==="
kubectl kustomize ~/gitops-repo/kustomize-app/overlays/staging/

echo ""
echo "=== PROD ==="
kubectl kustomize ~/gitops-repo/kustomize-app/overlays/prod/
```

#### Step 4: Deploy with Argo CD (Using Local Path Workaround)

Since we haven't pushed to a remote Git repo yet, let's apply the manifests directly to demonstrate, and then deploy a Kustomize app from the Argo CD example repo:

```bash
# Apply locally for quick testing
kubectl apply -k ~/gitops-repo/kustomize-app/overlays/dev/
kubectl apply -k ~/gitops-repo/kustomize-app/overlays/staging/

# Verify
kubectl get deployment -n platform-dev
kubectl get deployment -n platform-staging

# Now let's use the Argo CD example repo for a proper Kustomize-based Argo CD app
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kustomize-guestbook
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: kustomize-guestbook
  destination:
    server: https://kubernetes.default.svc
    namespace: kustomize-guestbook
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
EOF

argocd app sync kustomize-guestbook
argocd app wait kustomize-guestbook --health
```

---

### Exercise 4: Kustomize Overrides in Argo CD

Argo CD allows you to override Kustomize settings directly:

```bash
# Override the image used by the kustomize app
argocd app set kustomize-guestbook \
  --kustomize-image gcr.io/heptio-images/ks-guestbook-demo:0.2

# Set a name prefix
argocd app set kustomize-guestbook \
  --nameprefix lab-

# Add common labels
argocd app set kustomize-guestbook \
  --kustomize-common-label "team=platform"

# Sync the changes
argocd app sync kustomize-guestbook
argocd app get kustomize-guestbook

# View the modified resources
kubectl get all -n kustomize-guestbook
```

---

### Exercise 5: Sync Waves — Ordered Deployments

Sync waves let you control the order in which resources are deployed. Resources with lower wave numbers sync first.

```bash
mkdir -p ~/gitops-repo/sync-waves-demo

cat <<'EOF' > ~/gitops-repo/sync-waves-demo/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
EOF

cat <<'EOF' > ~/gitops-repo/sync-waves-demo/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "0"
data:
  DATABASE_URL: "postgres://db.sync-waves-demo.svc:5432/mydb"
  CACHE_TTL: "300"
EOF

cat <<'EOF' > ~/gitops-repo/sync-waves-demo/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "0"
type: Opaque
data:
  db-password: UEBzc3cwcmQxMjMh  # P@ssw0rd123!
EOF

cat <<'EOF' > ~/gitops-repo/sync-waves-demo/database.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: database
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "1"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: database
  template:
    metadata:
      labels:
        app: database
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: db-password
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "1"
spec:
  selector:
    app: database
  ports:
  - port: 5432
    targetPort: 5432
EOF

cat <<'EOF' > ~/gitops-repo/sync-waves-demo/application.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
      - name: app
        image: hashicorp/http-echo:0.2.3
        args:
          - "-text=Web app running! DB is ready."
          - "-listen=:8080"
        ports:
        - containerPort: 8080
        envFrom:
        - configMapRef:
            name: app-config
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
---
apiVersion: v1
kind: Service
metadata:
  name: web-app
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  selector:
    app: web-app
  ports:
  - port: 80
    targetPort: 8080
EOF

# Apply directly (in real GitOps, this would be in a Git repo)
kubectl apply -f ~/gitops-repo/sync-waves-demo/namespace.yaml
kubectl apply -f ~/gitops-repo/sync-waves-demo/configmap.yaml
kubectl apply -f ~/gitops-repo/sync-waves-demo/secret.yaml
kubectl apply -f ~/gitops-repo/sync-waves-demo/database.yaml
kubectl apply -f ~/gitops-repo/sync-waves-demo/application.yaml

# Verify the deployment order
echo "=== Namespace ==="
kubectl get ns sync-waves-demo

echo "=== ConfigMap & Secret (Wave 0) ==="
kubectl get configmap,secret -n sync-waves-demo

echo "=== Database (Wave 1) ==="
kubectl get deployment,svc -n sync-waves-demo -l app=database

echo "=== Web App (Wave 2) ==="
kubectl get deployment,svc -n sync-waves-demo -l app=web-app
```

---

### Exercise 6: Sync Hooks — Lifecycle Operations

Sync hooks run at specific points during the sync process.

```bash
mkdir -p ~/gitops-repo/hooks-demo

# PreSync Hook — runs BEFORE the sync (e.g., database migration)
cat <<'EOF' > ~/gitops-repo/hooks-demo/pre-sync-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
      - name: migration
        image: busybox:1.36
        command: ['sh', '-c']
        args:
          - |
            echo "=========================================="
            echo "  Running database migration..."
            echo "  Step 1: Checking database connectivity"
            sleep 2
            echo "  Step 2: Applying schema changes"
            sleep 2
            echo "  Step 3: Running data migration"
            sleep 2
            echo "  Migration completed successfully! ✅"
            echo "=========================================="
      restartPolicy: Never
  backoffLimit: 1
EOF

# PostSync Hook — runs AFTER the sync (e.g., smoke test)
cat <<'EOF' > ~/gitops-repo/hooks-demo/post-sync-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: smoke-test
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/hook: PostSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
      - name: test
        image: curlimages/curl:8.4.0
        command: ['sh', '-c']
        args:
          - |
            echo "=========================================="
            echo "  Running post-deployment smoke tests..."
            echo "  Test 1: Web app endpoint"
            curl -s http://web-app.sync-waves-demo.svc:80 && echo " ✅" || echo " ❌"
            echo "  Test 2: Database connectivity"
            echo "  (simulated) ✅"
            echo "  All smoke tests passed! 🎉"
            echo "=========================================="
      restartPolicy: Never
  backoffLimit: 1
EOF

# SyncFail Hook — runs if sync fails (e.g., notification)
cat <<'EOF' > ~/gitops-repo/hooks-demo/sync-fail-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: notify-failure
  namespace: sync-waves-demo
  annotations:
    argocd.argoproj.io/hook: SyncFail
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
      - name: notify
        image: busybox:1.36
        command: ['sh', '-c']
        args:
          - |
            echo "⚠️  SYNC FAILED!"
            echo "Sending notification to #platform-alerts..."
            echo "Team: Platform Engineering"
            echo "Time: $(date)"
      restartPolicy: Never
  backoffLimit: 1
EOF

# Apply the hooks
kubectl apply -f ~/gitops-repo/hooks-demo/

# Check hook execution
kubectl get jobs -n sync-waves-demo

# View hook logs
kubectl logs -n sync-waves-demo job/db-migration 2>/dev/null || echo "PreSync hook completed and was cleaned up"
```

### Hook Lifecycle Diagram

- **PreSync Hooks:** Run *before* the application sync (e.g., DB Migration, Schema Updates, Backups).
- **Sync Resources:** The core Kubernetes resource deployment step (e.g., applying Deployments, Services).
- **PostSync Hooks:** Run *after* a successful sync completes (e.g., running Smoke Tests, warming up caches).
- **SyncFail Hooks:** Trigger only if the sync operation fails (e.g., sending notifications, alerts).

---

### Exercise 7: Multi-Source Applications

Argo CD supports deploying an application from multiple sources (e.g., Helm chart + values file from a different repo):

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: multi-source-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  sources:
    # Source 1: The Helm chart from a Helm repo
    - repoURL: https://charts.bitnami.com/bitnami
      chart: nginx
      targetRevision: "*"
      helm:
        releaseName: multi-source-nginx
        values: |
          replicaCount: 1
          service:
            type: ClusterIP
  destination:
    server: https://kubernetes.default.svc
    namespace: multi-source
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
EOF

argocd app sync multi-source-app
argocd app wait multi-source-app --health --timeout 120
argocd app get multi-source-app
```

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 04 — Helm & Kustomize Verification"
echo "============================================"
echo ""

echo "1. Helm-based Applications:"
for app in nginx-helm helm-guestbook-git multi-source-app; do
  STATUS=$(argocd app get $app -o json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['status']['sync']['status'])" 2>/dev/null || echo "N/A")
  echo "   $app: $STATUS"
done
echo ""

echo "2. Kustomize-based Applications:"
for app in kustomize-guestbook; do
  STATUS=$(argocd app get $app -o json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['status']['sync']['status'])" 2>/dev/null || echo "N/A")
  echo "   $app: $STATUS"
done
echo ""

echo "3. Sync Waves Demo:"
kubectl get all -n sync-waves-demo --no-headers 2>/dev/null | wc -l
echo "   resources deployed in sync-waves-demo"
echo ""

echo "4. All Argo CD Applications:"
argocd app list 2>/dev/null
echo ""

echo "============================================"
echo "  Verification Complete!"
echo "============================================"
```

---

## 🧹 Cleanup

```bash
# Delete test applications
argocd app delete nginx-helm --yes 2>/dev/null
argocd app delete helm-guestbook-git --yes 2>/dev/null
argocd app delete kustomize-guestbook --yes 2>/dev/null
argocd app delete multi-source-app --yes 2>/dev/null

# Delete manually created resources
kubectl delete namespace sync-waves-demo --ignore-not-found
kubectl delete namespace nginx-helm --ignore-not-found
kubectl delete namespace helm-guestbook-git --ignore-not-found
kubectl delete namespace kustomize-guestbook --ignore-not-found
kubectl delete namespace multi-source --ignore-not-found

# Clean up local dev/staging kustomize deployments
kubectl delete deployment dev-platform-app -n platform-dev --ignore-not-found
kubectl delete service dev-platform-app -n platform-dev --ignore-not-found
kubectl delete deployment staging-platform-app -n platform-staging --ignore-not-found
kubectl delete service staging-platform-app -n platform-staging --ignore-not-found

# Clean up local directories
rm -rf ~/gitops-repo/sync-waves-demo ~/gitops-repo/hooks-demo
```

---

## 📝 Key Takeaways

- **Helm in Argo CD**: Point to a Helm repo or a Git repo containing a chart — Argo CD runs `helm template` internally
- **Kustomize in Argo CD**: Auto-detected when `kustomization.yaml` exists — Argo CD runs `kustomize build`
- **Overlays pattern**: Use base + overlays for dev/staging/prod — each environment gets its own Argo CD Application
- **Sync Waves**: Control deployment order with `argocd.argoproj.io/sync-wave` annotations (lower numbers first)
- **Sync Hooks**: Run Jobs at lifecycle points (PreSync, Sync, PostSync, SyncFail) for migrations, tests, notifications
- **Multi-Source**: Combine Helm charts with external value files from different repos
- **Value Overrides**: Override Helm values via `--helm-set` or `values` in the Application spec

---

## 🔗 References

- [Argo CD Helm Support](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/)
- [Argo CD Kustomize Support](https://argo-cd.readthedocs.io/en/stable/user-guide/kustomize/)
- [Argo CD Sync Waves & Hooks](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)
- [Argo CD Multi-Source Applications](https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/)
- [Kustomize Documentation](https://kustomize.io/)
- [Helm Documentation](https://helm.sh/docs/)

---

## ➡️ Next Lab

**[Lab 05 — Crossplane: Installation & First Provider](lab-05-crossplane-installation-first-provider.md)**

We're done with Argo CD basics! Now we'll install Crossplane and learn how to manage infrastructure using Kubernetes APIs.
