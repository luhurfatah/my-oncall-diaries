# Lab 03 — GitOps with Argo CD: Installation & Basics

## 🎯 Objectives

By the end of this lab, you will:

- Understand GitOps principles and how Argo CD implements them
- Install Argo CD on your Kubernetes cluster using Helm
- Access the Argo CD Web UI and CLI
- Create your first Argo CD Application from a Git repository
- Understand sync policies: manual vs. automatic
- Experience drift detection and self-healing
- Work with sync status, health status, and application management

---

## 📋 Prerequisites

- Completed **Lab 02** (running Kubernetes cluster with Helm installed)
- A GitHub account (free) — for creating a GitOps repo
- `kubectl` access to your cluster

---

## 🏗️ Architecture

The GitOps delivery model relies on a pull-based synchronization workflow managed by Argo CD:

1. **Git Repository (Source of Truth):** Developers commit Kubernetes manifests (YAML) representing the desired state.
2. **Argo CD Controller (Observability & Sync):**
   - **Repo Server:** Clones Git repos and parses manifests.
   - **Application Controller:** Periodically checks Git (polls every 3 minutes or via webhooks) and monitors the live cluster.
   - **API Server / Web UI:** Exposes visual management dashboards and administrative endpoints.
3. **Target Kubernetes Cluster (Actual State):** Argo CD continuous reconciliation automatically applies git commits to keep the cluster synchronized.

---

## 📚 Concepts

### What is GitOps?

GitOps is an operational framework that applies DevOps best practices for infrastructure automation — using Git as the single source of truth.

| Principle | How Argo CD Implements It |
|-----------|--------------------------|
| **Declarative** | Applications defined as Kubernetes manifests in Git |
| **Versioned** | Git provides full history, diffs, and rollback |
| **Pulled Automatically** | Argo CD polls Git or receives webhooks |
| **Continuously Reconciled** | Application Controller constantly compares Git vs. cluster |

### Argo CD Components

| Component | Purpose |
|-----------|---------|
| **API Server** | gRPC/REST API, Web UI, authentication |
| **Application Controller** | Monitors applications, compares desired (Git) vs. live (cluster) state |
| **Repo Server** | Clones Git repos, generates manifests (Helm, Kustomize, plain YAML) |
| **Redis** | Caching for repo server and application controller |
| **Dex** | OIDC authentication (optional) |
| **ApplicationSet Controller** | Generates Applications from templates (Lab 11) |

### Key Terminology

| Term | Definition |
|------|-----------|
| **Application** | A group of Kubernetes resources defined by a Git repo path |
| **Source** | Reference to a Git repository + path + revision |
| **Destination** | Target Kubernetes cluster + namespace |
| **Sync** | Making the cluster state match the Git state |
| **Sync Status** | `Synced` (matches Git), `OutOfSync` (differs from Git) |
| **Health Status** | `Healthy`, `Degraded`, `Progressing`, `Missing` |
| **Refresh** | Re-read the Git repo to check for changes |
| **Prune** | Delete resources in cluster that are no longer in Git |

---

## 🔬 Hands-On Exercises

### Exercise 1: Install Argo CD

#### Step 1: Create the Argo CD Namespace

```bash
kubectl create namespace argocd
```

#### Step 2: Install Argo CD using Helm

```bash
helm install argocd argo/argo-cd \
  --namespace argocd \
  --set crds.install=true \
  --set server.service.type=ClusterIP \
  --set configs.params."server\.insecure"=true \
  --set server.extraArgs="{--insecure}" \
  --wait --timeout 300s
```

#### Step 3: Verify the Installation

```bash
# Check all Argo CD pods are running
kubectl get pods -n argocd

# Expected output (all should be Running/Completed):
# NAME                                               READY   STATUS
# argocd-application-controller-0                    1/1     Running
# argocd-repo-server-xxxxxxxxx-xxxxx                 1/1     Running
# argocd-server-xxxxxxxxx-xxxxx                      1/1     Running
# argocd-redis-xxxxxxxxx-xxxxx                       1/1     Running
# argocd-dex-server-xxxxxxxxx-xxxxx                  1/1     Running

# Check services
kubectl get svc -n argocd
```

#### Step 4: Get the Admin Password

```bash
# The initial admin password is stored in a Kubernetes secret
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d)

echo "Argo CD Admin Password: $ARGOCD_PASSWORD"
```

> 📝 **Save this password** — you'll need it to log into the UI and CLI.

#### Step 5: Access the Argo CD UI

```bash
# Port-forward to access the Web UI
kubectl port-forward svc/argocd-server -n argocd 8443:443 &

echo "Argo CD UI: https://localhost:8443"
echo "Username: admin"
echo "Password: $ARGOCD_PASSWORD"
```

> 💡 **Pluralsight Sandbox Tip**: If your sandbox provides a web preview URL, use that instead of localhost. You may need to use the sandbox's built-in browser preview feature.

Open the Argo CD UI in your browser. You should see an empty dashboard — we haven't created any applications yet!

---

### Exercise 2: Install and Configure the Argo CD CLI

```bash
# Install the Argo CD CLI
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd
sudo mv argocd /usr/local/bin/

# Verify installation
argocd version --client

# Login to Argo CD (use the password from Exercise 1)
argocd login localhost:8443 \
  --username admin \
  --password "$ARGOCD_PASSWORD" \
  --insecure

# Verify login
argocd account list

# Optional: Change the admin password
# argocd account update-password \
#   --current-password "$ARGOCD_PASSWORD" \
#   --new-password "YourNewSecurePassword123!"
```

---

### Exercise 3: Create Your GitOps Repository

We need a Git repository to serve as our source of truth. We'll create one with sample manifests.

#### Step 1: Set Up the Git Repository

```bash
# Create a local directory for our GitOps repo
mkdir -p ~/gitops-repo/{apps/guestbook,apps/nginx,environments/{dev,staging,prod}}

# Create a simple Guestbook application (3 files)
cat <<'EOF' > ~/gitops-repo/apps/guestbook/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: guestbook
  labels:
    app: guestbook
    managed-by: argocd
EOF

cat <<'EOF' > ~/gitops-repo/apps/guestbook/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: guestbook-ui
  namespace: guestbook
  labels:
    app: guestbook-ui
spec:
  replicas: 2
  selector:
    matchLabels:
      app: guestbook-ui
  template:
    metadata:
      labels:
        app: guestbook-ui
    spec:
      containers:
      - name: guestbook-ui
        image: gcr.io/heptio-images/ks-guestbook-demo:0.2
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
EOF

cat <<'EOF' > ~/gitops-repo/apps/guestbook/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: guestbook-ui
  namespace: guestbook
spec:
  selector:
    app: guestbook-ui
  ports:
  - port: 80
    targetPort: 80
  type: ClusterIP
EOF
```

#### Step 2: Initialize Git and Push

```bash
cd ~/gitops-repo

# Initialize git
git init
git add -A
git commit -m "Initial commit: Add guestbook application"

# Configure git (adjust with your details)
git config user.email "platformengineer@example.com"
git config user.name "Platform Engineer"
```

> 📝 **Important**: For Argo CD to access your repo, you have two options:
> 
> **Option A — Public GitHub Repo (Recommended for labs):**
> - Create a new public repo on GitHub
> - Push your code there
> 
> **Option B — Use the Argo CD example repo:**
> - We'll use `https://github.com/argoproj/argocd-example-apps.git` for the next exercises

For this lab, let's use **Option B** (the official example repo) so you can get started immediately:

```bash
# We'll use the official Argo CD example apps repository
export GITOPS_REPO="https://github.com/argoproj/argocd-example-apps.git"
echo "Using GitOps repo: $GITOPS_REPO"
```

---

### Exercise 4: Create Your First Argo CD Application

#### Method 1: Using the CLI

```bash
# Create an application using the CLI
argocd app create guestbook \
  --repo https://github.com/argoproj/argocd-example-apps.git \
  --path guestbook \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace guestbook \
  --sync-option CreateNamespace=true

# View the application
argocd app get guestbook
```

**Expected Output:**
```
Name:               argocd/guestbook
Project:            default
Server:             https://kubernetes.default.svc
Namespace:          guestbook
URL:                https://localhost:8443/applications/guestbook
Repo:               https://github.com/argoproj/argocd-example-apps.git
Target:
Path:               guestbook
SyncWindow:         Sync Allowed
Sync Policy:        <none>
Sync Status:        OutOfSync
Health Status:      Missing
```

> 📌 Notice: The app is `OutOfSync` and `Missing` — Argo CD has detected the desired state in Git but hasn't applied it yet because we're using **manual sync**.

#### Method 2: Using a Declarative YAML Manifest

This is the GitOps way — define the Application as YAML:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx-app
  namespace: argocd
  labels:
    app.kubernetes.io/managed-by: platform-team
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: nginx
  destination:
    server: https://kubernetes.default.svc
    namespace: nginx-app
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
EOF

# View the application
argocd app get nginx-app
```

---

### Exercise 5: Sync an Application (Manual Sync)

```bash
# Sync the guestbook application
argocd app sync guestbook

# Watch the sync progress
argocd app wait guestbook --health

# Check the result
argocd app get guestbook
```

**Expected Output After Sync:**
```
Name:               argocd/guestbook
Sync Status:        Synced
Health Status:      Healthy

GROUP  KIND        NAMESPACE  NAME          STATUS  HEALTH   HOOK  MESSAGE
       Service     guestbook  guestbook-ui  Synced  Healthy        service/guestbook-ui created
apps   Deployment  guestbook  guestbook-ui  Synced  Healthy        deployment.apps/guestbook-ui created
```

```bash
# Verify the resources are deployed
kubectl get all -n guestbook

# Sync the nginx app too
argocd app sync nginx-app
argocd app wait nginx-app --health
```

---

### Exercise 6: Explore Sync Status & Health

```bash
# List all applications
argocd app list

# Get detailed info with resource tree
argocd app get guestbook --show-params

# View the resource tree (shows all Kubernetes objects)
argocd app resources guestbook

# View application logs
argocd app logs guestbook

# View diff between Git and cluster
argocd app diff guestbook
```

#### Understand the Status Model

##### Sync Status Flow
- **OutOfSync:** Live cluster differs from Git.
- **Syncing:** Sync operation is actively running.
- **Synced:** Live cluster perfectly matches the Git specification.
- *Note:* If any configuration drift is subsequently detected on the cluster, the state transitions back to **OutOfSync**.

##### Health Status States
- **Progressing:** Resources are being created and validated (e.g., containers starting).
- **Healthy:** Resources are running, active, and reporting successful readiness probes.
- **Degraded:** Resources have failed to start or remain in an unhealthy loop (e.g., CrashLoopBackOff).
- **Suspended:** Resource controllers are paused or scaled to zero.

---

### Exercise 7: Experience Drift Detection

Let's manually modify a resource and watch Argo CD detect the drift.

```bash
# Scale the guestbook deployment directly (bypassing Git!)
kubectl scale deployment guestbook-ui -n guestbook --replicas=5

# Check the current state
kubectl get deployment guestbook-ui -n guestbook

# Now check Argo CD — it should detect the drift
argocd app get guestbook

# View the diff (you should see the replicas difference)
argocd app diff guestbook
```

**Expected Output:**
```
===== apps/Deployment guestbook/guestbook-ui ======
  spec:
-   replicas: 5     ← Live state (manually changed)
+   replicas: 1     ← Desired state (from Git)
```

The application should now show `OutOfSync` — the cluster state no longer matches Git!

```bash
# Sync to restore the Git state (undo the manual change)
argocd app sync guestbook

# Verify replicas are back to what Git specifies
kubectl get deployment guestbook-ui -n guestbook
```

> 💡 **Key Insight**: This is the power of GitOps. Any manual change is detected and can be automatically reverted. Git is the source of truth, not the cluster.

---

### Exercise 8: Enable Auto-Sync & Self-Healing

Let's configure automatic sync so Argo CD fixes drift without manual intervention.

```bash
# Enable auto-sync with self-healing and pruning
argocd app set guestbook \
  --sync-policy automated \
  --self-heal \
  --auto-prune

# Verify the sync policy
argocd app get guestbook | grep -A5 "Sync Policy"
```

**Expected Output:**
```
Sync Policy:        Automated (Prune)
Self-Heal:          Enabled
```

#### Test Self-Healing

```bash
# Try to manually change the replicas again
kubectl scale deployment guestbook-ui -n guestbook --replicas=10

# Wait a few seconds
sleep 15

# Check — Argo CD should have automatically reverted the change!
kubectl get deployment guestbook-ui -n guestbook
argocd app get guestbook
```

The replicas should be back to the value defined in Git. **Self-healing in action!**

#### Test Auto-Pruning

```bash
# Create a rogue resource in the guestbook namespace
kubectl run rogue-pod --image=nginx --namespace=guestbook

# If auto-prune is enabled and the pod is not in Git,
# Argo CD will NOT delete it (it only prunes resources it manages)
# But if you add a resource to Git and then remove it, Argo CD WILL prune it
kubectl get pods -n guestbook
```

---

### Exercise 9: Application with Declarative Auto-Sync

Let's create an application the GitOps way — fully declarative with auto-sync built in:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: helm-guestbook
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: helm-guestbook
  destination:
    server: https://kubernetes.default.svc
    namespace: helm-guestbook
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
EOF

# Wait for auto-sync to complete
sleep 10
argocd app get helm-guestbook
argocd app wait helm-guestbook --health
```

---

### Exercise 10: Managing Multiple Applications

Let's see how to manage multiple apps and understand the Argo CD project concept.

```bash
# Create an Argo CD Project for our platform work
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: platform-labs
  namespace: argocd
spec:
  description: Platform Engineering Lab Applications
  sourceRepos:
    - "https://github.com/argoproj/argocd-example-apps.git"
    - "*"  # Allow all repos (for lab purposes only!)
  destinations:
    - namespace: "*"
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"
EOF

# List projects
argocd proj list

# View project details
argocd proj get platform-labs

# List all applications
argocd app list

# Filter by project
argocd app list --project platform-labs

# Get a summary view
argocd app list -o wide
```

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 03 — Argo CD Verification"
echo "============================================"
echo ""

# Check Argo CD installation
echo "1. Argo CD Pods:"
kubectl get pods -n argocd --no-headers | while read line; do
  echo "   ✅ $line"
done
echo ""

# Check Argo CD CLI
echo "2. Argo CD CLI:"
argocd version --client --short 2>/dev/null && echo "   ✅ CLI installed" || echo "   ❌ CLI not installed"
echo ""

# Check applications
echo "3. Applications:"
argocd app list --output name 2>/dev/null | while read app; do
  STATUS=$(argocd app get "$app" -o json 2>/dev/null | grep -o '"syncStatus":"[^"]*"' | head -1)
  HEALTH=$(argocd app get "$app" -o json 2>/dev/null | grep -o '"healthStatus":"[^"]*"' | head -1)
  echo "   ✅ $app - $STATUS - $HEALTH"
done
echo ""

# Check deployed resources
echo "4. Guestbook Resources:"
kubectl get all -n guestbook --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "============================================"
echo "  Verification Complete!"
echo "============================================"
```

---

## 🧹 Cleanup

> ⚠️ **Keep Argo CD installed** — we'll use it in Labs 04, 10, 11, and 14!

To clean up only the test applications:

```bash
# Delete test applications (this also deletes the Kubernetes resources they manage)
argocd app delete guestbook --yes
argocd app delete nginx-app --yes
argocd app delete helm-guestbook --yes

# Clean up rogue pod if it exists
kubectl delete pod rogue-pod -n guestbook --ignore-not-found

# Delete namespaces created by the apps
kubectl delete namespace guestbook --ignore-not-found
kubectl delete namespace nginx-app --ignore-not-found
kubectl delete namespace helm-guestbook --ignore-not-found
```

---

## 📝 Key Takeaways

- **Argo CD implements GitOps** by continuously reconciling cluster state with Git
- **Applications** are the core Argo CD resource — they link a Git source to a cluster destination
- **Sync Status** tells you if cluster matches Git; **Health Status** tells you if resources are working
- **Manual sync** gives you control; **Auto-sync** gives you continuous deployment
- **Self-healing** automatically reverts manual changes — enforcing Git as the source of truth
- **Drift detection** catches unauthorized changes immediately
- **Declarative Application definitions** (YAML) are the GitOps way — avoid CLI-only workflows
- **Projects** provide multi-tenancy and access control for applications

---

## 🔗 References

- [Argo CD Official Documentation](https://argo-cd.readthedocs.io/)
- [Argo CD Getting Started Guide](https://argo-cd.readthedocs.io/en/stable/getting_started/)
- [Argo CD Example Apps Repository](https://github.com/argoproj/argocd-example-apps)
- [GitOps Principles (OpenGitOps)](https://opengitops.dev/)
- [Argo CD Best Practices](https://argo-cd.readthedocs.io/en/stable/user-guide/best_practices/)

---

## ➡️ Next Lab

**[Lab 04 — Argo CD: Helm Charts & Kustomize](lab-04-argocd-helm-kustomize.md)**

We'll dive deeper into Argo CD by deploying Helm charts and Kustomize-based applications, using overlays for multi-environment management, and exploring sync waves and hooks.
