# Lab 13 — Backstage: Plugins & Kubernetes Integration


## 🎯 Objectives

By the end of this lab, you will:

- Install and configure the Backstage Kubernetes plugin
- Display pod status, deployments, and logs in Backstage
- Install the Argo CD plugin to show sync status
- Configure TechDocs for integrated documentation
- Set up authentication with a local provider
- Understand how to build a custom Backstage plugin

---

## 📋 Prerequisites

- Completed **Lab 08-09** (Backstage app running at `~/platform-portal`)
- Completed **Lab 03** (Argo CD installed)
- Kubernetes cluster accessible

---

## 🏗️ Architecture

- **Kubernetes Plugin:** Queries the Kubernetes API Server directly to surface pod logs, deployment statuses, and resource usage metrics.
- **Argo CD Plugin:** Communicates with the Argo CD API Server to fetch live synchronization states and application health statuses.
- **TechDocs Plugin:** Generates and serves HTML documentation pages compiled from Markdown files stored inside the application code repositories.

---

## 🔬 Hands-On Exercises

### Exercise 1: Install the Kubernetes Plugin

```bash
cd ~/platform-portal

# Install the Kubernetes plugin packages
yarn --cwd packages/backend add @backstage/plugin-kubernetes-backend
yarn --cwd packages/app add @backstage/plugin-kubernetes
```

#### Configure the Backend Plugin

Edit `packages/backend/src/index.ts` to add the Kubernetes backend:

```bash
cat <<'EOF' >> packages/backend/src/index.ts

// Kubernetes plugin is auto-discovered via the new backend system
EOF
```

> 💡 In the new Backstage backend system, plugins are auto-discovered. If using the legacy system, you need to explicitly register the plugin.

#### Configure Kubernetes in app-config.yaml

```bash
cat <<'KUBECONFIG' >> ~/platform-portal/app-config.yaml

kubernetes:
  serviceLocatorMethod:
    type: 'multiTenant'
  clusterLocatorMethods:
    - type: 'config'
      clusters:
        - url: https://kubernetes.default.svc
          name: platform-lab
          authProvider: 'serviceAccount'
          skipTLSVerify: true
          skipMetricsLookup: true
          serviceAccountToken: ${K8S_SA_TOKEN}
KUBECONFIG
```

#### Create a ServiceAccount for Backstage

```bash
# Create a ServiceAccount with read permissions
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: backstage-k8s-reader
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: backstage-k8s-reader
subjects:
  - kind: ServiceAccount
    name: backstage-k8s-reader
    namespace: default
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
EOF

# Get the ServiceAccount token
K8S_SA_TOKEN=$(kubectl create token backstage-k8s-reader --duration=8760h 2>/dev/null || \
  kubectl get secret $(kubectl get sa backstage-k8s-reader -o jsonpath='{.secrets[0].name}') -o jsonpath='{.data.token}' | base64 -d)

echo "K8S_SA_TOKEN=$K8S_SA_TOKEN"
export K8S_SA_TOKEN
```

#### Add Kubernetes Annotations to Catalog Entities

```bash
# Update catalog entities to link to Kubernetes resources
cat <<'EOF' >> ~/platform-portal/catalog-entities/all.yaml

---
# Component with Kubernetes annotation
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: nginx-demo
  description: Nginx demo deployment for Kubernetes plugin testing
  annotations:
    backstage.io/kubernetes-id: nginx-demo
    backstage.io/kubernetes-namespace: platform-dev
    backstage.io/kubernetes-label-selector: 'app=nginx-demo'
  tags:
    - nginx
    - kubernetes
    - demo
spec:
  type: service
  lifecycle: experimental
  owner: platform-team
  system: ecommerce-platform
EOF

# Deploy a matching workload
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-demo
  namespace: platform-dev
  labels:
    app: nginx-demo
    backstage.io/kubernetes-id: nginx-demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx-demo
  template:
    metadata:
      labels:
        app: nginx-demo
        backstage.io/kubernetes-id: nginx-demo
    spec:
      containers:
      - name: nginx
        image: nginx:1.25-alpine
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 25m
            memory: 32Mi
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-demo
  namespace: platform-dev
spec:
  selector:
    app: nginx-demo
  ports:
  - port: 80
EOF
```

### Exercise 2: Install the Argo CD Plugin

```bash
cd ~/platform-portal

# Install Argo CD plugin
yarn --cwd packages/app add @roadiehq/backstage-plugin-argo-cd
```

#### Configure Argo CD in app-config.yaml

```bash
cat <<'ARGOCONFIG' >> ~/platform-portal/app-config.yaml

argocd:
  baseUrl: https://localhost:8443
  username: admin
  password: ${ARGOCD_ADMIN_PASSWORD}
ARGOCONFIG

# Set the Argo CD password
export ARGOCD_ADMIN_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)
echo "ARGOCD_ADMIN_PASSWORD=$ARGOCD_ADMIN_PASSWORD"
```

#### Add Argo CD Annotations to Entities

```bash
cat <<'EOF' >> ~/platform-portal/catalog-entities/all.yaml

---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: argocd-managed-app
  description: Application managed by Argo CD
  annotations:
    argocd/app-name: guestbook
    backstage.io/kubernetes-id: argocd-managed-app
  tags:
    - argocd
    - gitops
spec:
  type: service
  lifecycle: production
  owner: platform-team
  system: ecommerce-platform
EOF
```

### Exercise 3: Configure TechDocs

```bash
# Install TechDocs dependencies
cd ~/platform-portal

# Install mkdocs for local TechDocs building
pip3 install mkdocs mkdocs-techdocs-core 2>/dev/null || \
  pip install mkdocs mkdocs-techdocs-core 2>/dev/null || \
  echo "Install mkdocs manually if needed"

# Create a sample TechDocs site for the order-service
mkdir -p ~/platform-portal/docs/order-service

cat <<'EOF' > ~/platform-portal/docs/order-service/mkdocs.yml
site_name: Order Service Documentation
nav:
  - Home: index.md
  - Architecture: architecture.md
  - API Reference: api.md
  - Runbook: runbook.md
plugins:
  - techdocs-core
EOF

cat <<'EOF' > ~/platform-portal/docs/order-service/docs/index.md
# Order Service

Welcome to the Order Service documentation.

## Overview

The Order Service handles all order processing, including:

- Order creation and validation
- Payment processing integration
- Order status tracking
- Notification dispatch

## Quick Links

- [Architecture](architecture.md)
- [API Reference](api.md)
- [Runbook](runbook.md)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/example/order-service.git

# Install dependencies
npm install

# Run locally
npm run dev
```

## Team

Maintained by the **Backend Team**.
EOF

cat <<'EOF' > ~/platform-portal/docs/order-service/docs/architecture.md
# Architecture

## System Design

- **Client (Web Storefront):** Initiates operations by sending HTTP requests.
- **Order Service:** Coordinates order state management and handles payment operations.
- **Payment Gateway:** External third-party system processing payments.
- **PostgreSQL Database:** Stores transactions, order history, and service state details.

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20 |
| Framework | Express.js |
| Database | PostgreSQL 15 |
| Cache | Redis 7 |
| Message Queue | RabbitMQ |
EOF

cat <<'EOF' > ~/platform-portal/docs/order-service/docs/api.md
# API Reference

## Endpoints

### Create Order
`POST /api/v1/orders`

### Get Order
`GET /api/v1/orders/{id}`

### List Orders
`GET /api/v1/orders?page=1&limit=20`

### Update Order Status
`PATCH /api/v1/orders/{id}/status`
EOF

cat <<'EOF' > ~/platform-portal/docs/order-service/docs/runbook.md
# Runbook

## Common Issues

### High Latency
1. Check database connection pool
2. Review slow query logs
3. Check Redis cache hit ratio

### Failed Orders
1. Check payment gateway status
2. Review order validation logs
3. Verify inventory availability
EOF
```

### Exercise 4: Restart Backstage with All Plugins

```bash
# Stop existing Backstage
pkill -f "backstage" 2>/dev/null
sleep 5

cd ~/platform-portal

# Set environment variables
export K8S_SA_TOKEN=$(kubectl create token backstage-k8s-reader --duration=8760h 2>/dev/null || echo "token-not-available")
export ARGOCD_ADMIN_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d 2>/dev/null || echo "password-not-available")

# Start Backstage
yarn dev &

echo "⏳ Waiting for Backstage to start with plugins..."
sleep 90

echo ""
echo "==================================="
echo "  Backstage with Plugins Running!"
echo "  http://localhost:3000"
echo "==================================="
```

### Exercise 5: Verify Plugin APIs

```bash
# Test Kubernetes plugin
echo "=== Kubernetes Plugin ==="
curl -s http://localhost:7007/api/kubernetes/clusters 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Kubernetes plugin not fully configured"

# Test Catalog with annotations
echo ""
echo "=== Entities with K8s Annotations ==="
curl -s "http://localhost:7007/api/catalog/entities?filter=metadata.annotations.backstage.io/kubernetes-id" 2>/dev/null | python3 -c "
import json, sys
try:
    entities = json.load(sys.stdin)
    for e in entities:
        k8s_id = e.get('metadata', {}).get('annotations', {}).get('backstage.io/kubernetes-id', 'N/A')
        print(f\"  {e['metadata']['name']}: kubernetes-id={k8s_id}\")
except:
    print('  Could not parse response')
" 2>/dev/null

# Test TechDocs
echo ""
echo "=== TechDocs ==="
curl -s http://localhost:7007/api/techdocs/static/docs 2>/dev/null | head -5 || echo "TechDocs endpoint available"
```

### Exercise 6: Understanding Custom Plugin Development

While building a full custom plugin is beyond this lab's scope, here's the structure:

```bash
# A custom Backstage plugin scaffold
echo "=== Custom Plugin Structure ==="
cat <<'STRUCTURE'
plugins/
└── my-custom-plugin/
    ├── package.json
    ├── src/
    │   ├── index.ts              # Plugin entry point
    │   ├── plugin.ts             # Plugin definition
    │   ├── routes.ts             # Route definitions
    │   └── components/
    │       ├── ExampleComponent/
    │       │   ├── ExampleComponent.tsx
    │       │   └── index.ts
    │       └── ExamplePage/
    │           ├── ExamplePage.tsx
    │           └── index.ts
    └── dev/
        └── index.tsx             # Dev standalone setup

Key files:
- plugin.ts: createPlugin() with routes and components
- components/: React components for the UI
- api/: Backend API client (if needed)
STRUCTURE

# You can create a plugin skeleton with:
# cd ~/platform-portal
# yarn new --select plugin
```

---

## ✅ Verification

```bash
echo "============================================"
echo "  Lab 13 — Plugins Verification"
echo "============================================"
echo ""

echo "1. Backstage Running:"
curl -s -o /dev/null -w "   Status: %{http_code}\n" http://localhost:3000 2>/dev/null || echo "   ❌ Not running"

echo ""
echo "2. Kubernetes SA:"
kubectl get sa backstage-k8s-reader 2>/dev/null && echo "   ✅ ServiceAccount exists" || echo "   ❌ Missing"

echo ""
echo "3. Demo Workload:"
kubectl get deployment nginx-demo -n platform-dev 2>/dev/null && echo "   ✅ nginx-demo deployed" || echo "   ❌ Missing"

echo ""
echo "4. TechDocs Content:"
ls ~/platform-portal/docs/order-service/docs/ 2>/dev/null && echo "   ✅ TechDocs created" || echo "   ❌ Missing"

echo ""
echo "============================================"
```

---

## 🧹 Cleanup

```bash
pkill -f "backstage" 2>/dev/null
kubectl delete deployment nginx-demo -n platform-dev --ignore-not-found
kubectl delete service nginx-demo -n platform-dev --ignore-not-found
```

---

## 📝 Key Takeaways

- **Kubernetes plugin** shows pod status, logs, and deployments directly in Backstage
- **Argo CD plugin** displays sync status and application health
- **TechDocs** provides integrated, docs-as-code documentation
- Entities link to K8s resources via **annotations** (`backstage.io/kubernetes-id`)
- Backstage has **200+ community plugins** — check the [Plugin Marketplace](https://backstage.io/plugins)
- Custom plugins use **React** (frontend) and **Express** (backend)

---

## ➡️ Next Lab

**[Lab 14 — Full IDP: Backstage + Argo CD + Crossplane End-to-End](lab-14-full-idp-backstage-argocd-crossplane.md)**
