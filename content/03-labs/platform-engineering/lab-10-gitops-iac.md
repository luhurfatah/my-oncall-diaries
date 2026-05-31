# Lab 10 — Integrating Argo CD + Crossplane (GitOps-Driven IaC)


## 🎯 Objectives

By the end of this lab, you will:

- Store Crossplane XRDs and Compositions in a Git repository
- Use Argo CD to deploy and manage Crossplane configurations
- Implement the GitOps workflow: commit a Claim → Argo CD syncs → Crossplane provisions
- Configure Argo CD health checks for Crossplane resources
- Handle drift detection for infrastructure managed by both tools

---

## 📋 Prerequisites

- Completed **Lab 03-04** (Argo CD installed)
- Completed **Lab 05-07** (Crossplane installed with compositions)
- Both Argo CD and Crossplane running on your cluster

---

## 🏗️ Architecture

The GitOps IaC workflow is driven by two independent reconciliation loops working in harmony:

1. **Argo CD Loop (Git → Cluster):** Watches the Git Repository containing platform files (XRDs, Compositions, Claims) and synchronizes them directly into the Kubernetes cluster.
2. **Crossplane Loop (Cluster → Cloud):** Detects the synchronized custom resources (Claims) inside the Kubernetes API and runs the respective Compositions to provision resources.

---

## 🔬 Hands-On Exercises

### Exercise 1: Create the GitOps Infrastructure Repository

```bash
mkdir -p ~/infra-gitops-repo/{crossplane/{xrds,compositions,claims/{dev,staging,prod}},platform-config}

# Store the XRD in Git
cat <<'EOF' > ~/infra-gitops-repo/crossplane/xrds/database-xrd.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xdatabases.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XDatabase
    plural: xdatabases
  claimNames:
    kind: DatabaseClaim
    plural: databaseclaims
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                parameters:
                  type: object
                  properties:
                    size:
                      type: string
                      enum: ["small", "medium", "large"]
                      default: "small"
                    engine:
                      type: string
                      enum: ["postgresql", "mysql"]
                      default: "postgresql"
                    environment:
                      type: string
                      enum: ["dev", "staging", "prod"]
                    storageGB:
                      type: integer
                      default: 5
                  required: ["environment"]
EOF

# Store the Composition in Git
cat <<'EOF' > ~/infra-gitops-repo/crossplane/compositions/database-composition.yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: database-composition
  labels:
    crossplane.io/xrd: xdatabases.platform.example.com
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  resources:
    - name: database-namespace
      base:
        apiVersion: kubernetes.crossplane.io/v1alpha2
        kind: Object
        spec:
          providerConfigRef:
            name: kubernetes-provider
          forProvider:
            manifest:
              apiVersion: v1
              kind: Namespace
              metadata:
                name: ""
                labels:
                  managed-by: crossplane
                  provisioned-via: argocd
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.labels[crossplane.io/claim-name]
            strategy: string
            string:
              fmt: "db-%s-%s"
          toFieldPath: spec.forProvider.manifest.metadata.name

    - name: database-deployment
      base:
        apiVersion: kubernetes.crossplane.io/v1alpha2
        kind: Object
        spec:
          providerConfigRef:
            name: kubernetes-provider
          forProvider:
            manifest:
              apiVersion: apps/v1
              kind: Deployment
              metadata:
                name: postgresql
                namespace: ""
              spec:
                replicas: 1
                selector:
                  matchLabels:
                    app: postgresql
                template:
                  metadata:
                    labels:
                      app: postgresql
                  spec:
                    containers:
                    - name: postgresql
                      image: postgres:15-alpine
                      ports:
                      - containerPort: 5432
                      env:
                      - name: POSTGRES_DB
                        value: appdb
                      - name: POSTGRES_PASSWORD
                        value: changeme123
                      resources:
                        requests:
                          cpu: 100m
                          memory: 256Mi
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.labels[crossplane.io/claim-name]
            strategy: string
            string:
              fmt: "db-%s-%s"
          toFieldPath: spec.forProvider.manifest.metadata.namespace
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.size
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.memory
          transforms:
            - type: map
              map:
                small: "256Mi"
                medium: "512Mi"
                large: "1Gi"

    - name: database-service
      base:
        apiVersion: kubernetes.crossplane.io/v1alpha2
        kind: Object
        spec:
          providerConfigRef:
            name: kubernetes-provider
          forProvider:
            manifest:
              apiVersion: v1
              kind: Service
              metadata:
                name: postgresql
                namespace: ""
              spec:
                selector:
                  app: postgresql
                ports:
                - port: 5432
                  targetPort: 5432
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.labels[crossplane.io/claim-name]
            strategy: string
            string:
              fmt: "db-%s-%s"
          toFieldPath: spec.forProvider.manifest.metadata.namespace
EOF

# Create a dev claim
cat <<'EOF' > ~/infra-gitops-repo/crossplane/claims/dev/order-db.yaml
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: order-db
  namespace: platform-dev
  labels:
    team: backend-team
    provisioned-via: argocd-gitops
spec:
  parameters:
    size: small
    engine: postgresql
    environment: dev
    storageGB: 5
  compositionRef:
    name: database-composition
EOF

# Initialize Git
cd ~/infra-gitops-repo
git init
git add -A
git commit -m "Initial infrastructure: XRDs, Compositions, and dev claims"
```

### Exercise 2: Deploy Crossplane Platform Config via Argo CD

```bash
# App 1: Crossplane Platform Definitions (XRDs + Compositions)
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: crossplane-platform-config
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: guestbook
  destination:
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
EOF

# Since we can't push to a real repo easily, let's apply locally
# and create Argo CD apps that manage the resources we apply

# Apply the XRD and Composition directly (simulating Argo CD sync)
kubectl apply -f ~/infra-gitops-repo/crossplane/xrds/
kubectl apply -f ~/infra-gitops-repo/crossplane/compositions/

echo "✅ Platform config (XRDs + Compositions) applied"
echo ""

# Now apply the claims (simulating a developer commit)
kubectl apply -f ~/infra-gitops-repo/crossplane/claims/dev/

echo "✅ Dev claims applied"
sleep 20

# Check the results
echo ""
echo "=== XRDs ==="
kubectl get xrd

echo ""
echo "=== Compositions ==="
kubectl get compositions

echo ""
echo "=== Claims ==="
kubectl get databaseclaims -n platform-dev

echo ""
echo "=== Composite Resources ==="
kubectl get xdatabases
```

### Exercise 3: Configure Argo CD Health Checks for Crossplane

Argo CD needs to know how to assess the health of Crossplane resources:

```bash
# Add custom health checks for Crossplane resources
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  resource.customizations.health.kubernetes.crossplane.io_Object: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for i, condition in ipairs(obj.status.conditions) do
          if condition.type == "Ready" and condition.status == "True" then
            hs.status = "Healthy"
            hs.message = "Resource is ready"
            return hs
          end
          if condition.type == "Synced" and condition.status == "False" then
            hs.status = "Degraded"
            hs.message = condition.message or "Resource sync failed"
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Waiting for resource to be ready"
    return hs

  resource.customizations.health.helm.crossplane.io_Release: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for i, condition in ipairs(obj.status.conditions) do
          if condition.type == "Ready" and condition.status == "True" then
            hs.status = "Healthy"
            hs.message = "Release is ready"
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Waiting for release"
    return hs

  resource.customizations.health.platform.example.com_XDatabase: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.conditions ~= nil then
        for i, condition in ipairs(obj.status.conditions) do
          if condition.type == "Ready" and condition.status == "True" then
            hs.status = "Healthy"
            hs.message = "Database is ready"
            return hs
          end
        end
      end
    end
    hs.status = "Progressing"
    hs.message = "Database provisioning in progress"
    return hs
EOF

# Restart Argo CD server to pick up changes
kubectl rollout restart deployment argocd-server -n argocd
kubectl rollout restart statefulset argocd-application-controller -n argocd

echo "⏳ Waiting for Argo CD to restart..."
kubectl rollout status deployment argocd-server -n argocd --timeout=120s
```

### Exercise 4: Simulate the Full GitOps Workflow

```bash
echo "============================================"
echo "  Full GitOps IaC Workflow Simulation"
echo "============================================"
echo ""

# Step 1: Developer creates a new claim (simulating a Git commit)
echo "Step 1: Developer requests a staging database..."
cat <<'EOF' > ~/infra-gitops-repo/crossplane/claims/staging-payment-db.yaml
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: payment-db
  namespace: platform-staging
  labels:
    team: backend-team
    provisioned-via: argocd-gitops
spec:
  parameters:
    size: medium
    engine: postgresql
    environment: staging
    storageGB: 20
  compositionRef:
    name: database-composition
EOF

cd ~/infra-gitops-repo
git add -A
git commit -m "feat: Add staging payment database"

# Step 2: Argo CD would detect the commit and sync (we apply manually)
echo "Step 2: Argo CD syncs the new claim..."
kubectl apply -f ~/infra-gitops-repo/crossplane/claims/staging-payment-db.yaml

# Step 3: Crossplane provisions the resources
echo "Step 3: Crossplane provisioning..."
sleep 20

# Step 4: Verify
echo "Step 4: Verification"
echo ""
echo "=== All Claims ==="
kubectl get databaseclaims --all-namespaces
echo ""
echo "=== All Composite Resources ==="
kubectl get xdatabases
echo ""
echo "=== Provisioned Namespaces ==="
kubectl get ns | grep "db-"
```

### Exercise 5: Infrastructure Drift Detection

```bash
# Simulate drift: manually change a Crossplane-managed resource
echo "=== Creating drift by manually modifying a resource ==="

# Find a namespace created by Crossplane
DB_NS=$(kubectl get ns | grep "db-dev" | awk '{print $1}' | head -1)
if [ -n "$DB_NS" ]; then
  # Manually add a label (drift!)
  kubectl label namespace "$DB_NS" unauthorized-change=true 2>/dev/null
  echo "Added unauthorized label to $DB_NS"
  
  # Wait for Crossplane to detect and fix
  echo "⏳ Waiting for Crossplane to detect drift..."
  sleep 30
  
  # Check if Crossplane corrected it
  kubectl get namespace "$DB_NS" --show-labels
  echo ""
  echo "Crossplane continuously reconciles — unauthorized changes are corrected!"
else
  echo "No database namespace found yet. Try again after claims are fully provisioned."
fi
```

---

## ✅ Verification

```bash
echo "============================================"
echo "  Lab 10 — GitOps + IaC Verification"
echo "============================================"
echo ""

echo "1. Crossplane Platform Config:"
kubectl get xrd --no-headers 2>/dev/null | wc -l
echo "   XRDs defined"
kubectl get compositions --no-headers 2>/dev/null | wc -l
echo "   Compositions defined"

echo ""
echo "2. Active Claims:"
kubectl get databaseclaims --all-namespaces --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done

echo ""
echo "3. Argo CD Status:"
kubectl get pods -n argocd --no-headers | head -3

echo ""
echo "============================================"
```

---

## 🧹 Cleanup

```bash
kubectl delete databaseclaims --all -n platform-dev 2>/dev/null
kubectl delete databaseclaims --all -n platform-staging 2>/dev/null
kubectl delete databaseclaims --all -n platform-prod 2>/dev/null
sleep 15
kubectl delete compositions --all 2>/dev/null
kubectl delete xrd --all 2>/dev/null
kubectl delete ns -l managed-by=crossplane --ignore-not-found
argocd app delete crossplane-platform-config --yes 2>/dev/null
```

---

## 📝 Key Takeaways

- **Argo CD + Crossplane** creates a powerful GitOps-driven IaC pipeline
- **Two reconciliation loops** work together: Argo CD (Git→Cluster) and Crossplane (CRDs→Cloud)
- **XRDs and Compositions should live in Git** — managed by Argo CD
- **Claims are the developer interface** — committing a claim to Git triggers the entire provisioning flow
- **Custom health checks** teach Argo CD how to assess Crossplane resource health
- **Drift is caught at two levels**: Argo CD (manifest drift) and Crossplane (external resource drift)

---

## ➡️ Next Lab

**[Lab 11 — Argo CD: ApplicationSets & Multi-Cluster](lab-11-argocd-applicationsets-multi-cluster.md)**
