# Lab 08 — Backstage: Setup & Software Catalog


## 🎯 Objectives

By the end of this lab, you will:

- Create a Backstage application from scratch
- Understand the Backstage project structure
- Configure `app-config.yaml` for your environment
- Register components in the Software Catalog
- Create Systems, Components, APIs, and Resources entities
- Explore the entity dependency graph
- Set up TechDocs for integrated documentation

---

## 📋 Prerequisites

- Completed **Lab 02** (Kubernetes cluster)
- Node.js 18 or 20 (LTS) installed
- Yarn installed
- Git installed

---

## 📚 Concepts

### Backstage Architecture

- **Frontend (React) at localhost:3000:** Handles the UI components, catalog views, scaffolding forms, and TechDocs pages.
- **Backend (Node.js) at localhost:7007:** Exposes catalog REST APIs, runs the scaffolding orchestration engine, gathers TechDocs metadata, and interfaces with identity/auth providers.
- **Database (SQLite / PostgreSQL):** Backing the catalog backend, storing plugin states and entity lists.

### Software Catalog Entity Model

- **Group (Team) / User:** Groups have member Users, and own Components.
- **Component (Service):** The software entity providing or consuming APIs, owned by a Group, and depending on resources.
- **API:** Defined interfaces (e.g., OpenAPI, gRPC) provided or consumed by Components.
- **Resource (Infrastructure):** Underlying infrastructure dependency (e.g., databases, buckets) that Components depend on.

---

## 🔬 Hands-On Exercises

### Exercise 1: Install Prerequisites

```bash
# Check Node.js version (need 18 or 20)
node --version

# If not installed or wrong version:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
# sudo apt-get install -y nodejs

# Install Yarn (if not installed)
npm install -g yarn

# Verify
yarn --version

# Ensure git is configured
git config --global user.email "platformengineer@example.com"
git config --global user.name "Platform Engineer"
```

### Exercise 2: Create a Backstage App

```bash
# Create a new Backstage app
cd ~
npx @backstage/create-app@latest --skip-install

# When prompted, name it: platform-portal
# This creates a monorepo with frontend and backend

cd platform-portal

# Install dependencies
yarn install

# Explore the project structure
echo "=== Project Structure ==="
ls -la

echo ""
echo "=== Key Files ==="
echo "app-config.yaml          - Main configuration"
echo "app-config.production.yaml - Production overrides"
echo "packages/app/            - Frontend (React)"
echo "packages/backend/        - Backend (Node.js)"
echo "catalog-info.yaml        - Self-registration entity"
```

### Exercise 3: Understand app-config.yaml

```bash
cat app-config.yaml
```

Key sections to understand:

```yaml
# app-config.yaml — annotated key sections

app:
  title: Platform Engineering Portal   # Browser title
  baseUrl: http://localhost:3000        # Frontend URL

organization:
  name: Platform Team                   # Org name shown in UI

backend:
  baseUrl: http://localhost:7007        # Backend API URL
  database:
    client: better-sqlite3              # SQLite for local dev
    connection: ':memory:'              # In-memory database

catalog:
  import:
    entityFilename: catalog-info.yaml
  rules:
    - allow: [Component, System, API, Resource, Location, Template, Group, User]
  locations:
    # Example: register entities from a URL
    - type: url
      target: https://github.com/backstage/backstage/blob/master/packages/catalog-model/examples/all-components.yaml
```

### Exercise 4: Configure and Start Backstage

```bash
# Edit app-config.yaml for our lab
cat <<'APPCONFIG' > app-config.yaml
app:
  title: Platform Engineering Portal
  baseUrl: http://localhost:3000

organization:
  name: Platform Engineering Lab

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
  csp:
    connect-src: ["'self'", 'http:', 'https:']
  cors:
    origin: http://localhost:3000
    methods: [GET, HEAD, PATCH, POST, PUT, DELETE]
    credentials: true
  database:
    client: better-sqlite3
    connection: ':memory:'

auth:
  providers:
    guest: {}

catalog:
  import:
    entityFilename: catalog-info.yaml
    pullRequestBranchName: backstage-integration
  rules:
    - allow: [Component, System, API, Resource, Location, Template, Group, User, Domain]
  locations:
    # Local example entities
    - type: file
      target: ./catalog-entities/all.yaml
      rules:
        - allow: [Component, System, API, Resource, Group, User, Domain]

techdocs:
  builder: 'local'
  generator:
    runIn: 'local'
  publisher:
    type: 'local'
APPCONFIG
```

### Exercise 5: Create Catalog Entities

```bash
mkdir -p ~/platform-portal/catalog-entities

# Create the main catalog file
cat <<'EOF' > ~/platform-portal/catalog-entities/all.yaml
# ============================================
# Domain
# ============================================
apiVersion: backstage.io/v1alpha1
kind: Domain
metadata:
  name: platform-engineering
  description: Platform Engineering domain covering all internal platform services
spec:
  owner: platform-team

---
# ============================================
# System: E-Commerce Platform
# ============================================
apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: ecommerce-platform
  description: E-Commerce microservices platform
  annotations:
    backstage.io/techdocs-ref: dir:.
  tags:
    - ecommerce
    - microservices
spec:
  owner: platform-team
  domain: platform-engineering

---
# ============================================
# Groups (Teams)
# ============================================
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: platform-team
  description: Platform Engineering Team
spec:
  type: team
  children: []

---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: backend-team
  description: Backend Development Team
spec:
  type: team
  children: []

---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: frontend-team
  description: Frontend Development Team
spec:
  type: team
  children: []

---
# ============================================
# Users
# ============================================
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: platform-admin
  description: Platform Administrator
spec:
  memberOf: [platform-team]

---
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: dev-alice
  description: Backend Developer
spec:
  memberOf: [backend-team]

---
# ============================================
# Components (Services)
# ============================================
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: order-service
  description: Handles order processing and management
  annotations:
    backstage.io/kubernetes-id: order-service
  tags:
    - java
    - spring-boot
    - backend
  links:
    - url: https://github.com/example/order-service
      title: GitHub Repository
      icon: github
spec:
  type: service
  lifecycle: production
  owner: backend-team
  system: ecommerce-platform
  providesApis:
    - order-api
  consumesApis:
    - inventory-api
  dependsOn:
    - resource:orders-database

---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: inventory-service
  description: Manages product inventory and stock levels
  tags:
    - go
    - backend
spec:
  type: service
  lifecycle: production
  owner: backend-team
  system: ecommerce-platform
  providesApis:
    - inventory-api
  dependsOn:
    - resource:inventory-database

---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: web-storefront
  description: Customer-facing web storefront
  tags:
    - react
    - typescript
    - frontend
spec:
  type: website
  lifecycle: production
  owner: frontend-team
  system: ecommerce-platform
  consumesApis:
    - order-api
    - inventory-api

---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: platform-infra
  description: Platform infrastructure managed by Crossplane
  tags:
    - crossplane
    - infrastructure
spec:
  type: service
  lifecycle: production
  owner: platform-team
  system: ecommerce-platform

---
# ============================================
# APIs
# ============================================
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: order-api
  description: REST API for order management
  tags:
    - rest
    - orders
spec:
  type: openapi
  lifecycle: production
  owner: backend-team
  system: ecommerce-platform
  definition: |
    openapi: "3.0.0"
    info:
      title: Order API
      version: 1.0.0
      description: API for managing orders
    paths:
      /orders:
        get:
          summary: List all orders
          responses:
            '200':
              description: A list of orders
        post:
          summary: Create a new order
          responses:
            '201':
              description: Order created
      /orders/{id}:
        get:
          summary: Get order by ID
          parameters:
            - name: id
              in: path
              required: true
              schema:
                type: string
          responses:
            '200':
              description: Order details

---
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: inventory-api
  description: REST API for inventory management
  tags:
    - rest
    - inventory
spec:
  type: openapi
  lifecycle: production
  owner: backend-team
  system: ecommerce-platform
  definition: |
    openapi: "3.0.0"
    info:
      title: Inventory API
      version: 1.0.0
    paths:
      /products:
        get:
          summary: List products
          responses:
            '200':
              description: Product list
      /products/{id}/stock:
        get:
          summary: Check stock level
          parameters:
            - name: id
              in: path
              required: true
              schema:
                type: string
          responses:
            '200':
              description: Stock level

---
# ============================================
# Resources (Infrastructure)
# ============================================
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: orders-database
  description: PostgreSQL database for the Order Service
  tags:
    - postgresql
    - database
spec:
  type: database
  owner: platform-team
  system: ecommerce-platform

---
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: inventory-database
  description: PostgreSQL database for the Inventory Service
  tags:
    - postgresql
    - database
spec:
  type: database
  owner: platform-team
  system: ecommerce-platform
EOF
```

### Exercise 6: Start Backstage

```bash
cd ~/platform-portal

# Start the development server
yarn dev &

# Wait for startup (takes 30-60 seconds)
echo "⏳ Starting Backstage (this takes about 60 seconds)..."
sleep 60

echo ""
echo "==================================="
echo "  Backstage is running!"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:7007"
echo "==================================="
```

> 💡 **Pluralsight Sandbox Tip**: Use the sandbox's web preview or port-forward feature to access localhost:3000.

### Exercise 7: Explore the Software Catalog

```bash
# Test the Catalog API
echo "=== Catalog Entities ==="
curl -s http://localhost:7007/api/catalog/entities | python3 -m json.tool | head -50

# Count entities by kind
echo ""
echo "=== Entity Counts ==="
curl -s http://localhost:7007/api/catalog/entities | python3 -c "
import json, sys
from collections import Counter
data = json.load(sys.stdin)
counts = Counter(e['kind'] for e in data)
for kind, count in sorted(counts.items()):
    print(f'  {kind}: {count}')
print(f'  Total: {len(data)}')
"

# Get a specific entity
echo ""
echo "=== Order Service Details ==="
curl -s "http://localhost:7007/api/catalog/entities/by-name/component/default/order-service" | python3 -m json.tool
```

### Exercise 8: Register a Remote Component

```bash
# Register an entity from a URL via the API
curl -X POST http://localhost:7007/api/catalog/locations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url",
    "target": "https://github.com/backstage/backstage/blob/master/packages/catalog-model/examples/components/artist-lookup-component.yaml"
  }' 2>/dev/null | python3 -m json.tool

echo "Entity registered! Check the catalog in the UI."
```

### Exercise 9: Understanding Entity Relations

The catalog tracks relationships between entities:

```bash
# Query entity relationships
curl -s "http://localhost:7007/api/catalog/entities/by-name/component/default/order-service" | python3 -c "
import json, sys
entity = json.load(sys.stdin)
print('Entity:', entity['metadata']['name'])
print('Kind:', entity['kind'])
print('Owner:', entity['spec'].get('owner', 'N/A'))
print()
print('Relations:')
for rel in entity.get('relations', []):
    print(f\"  {rel['type']}: {rel['targetRef']}\")
"
```

**Expected Relations:**

```
Entity: order-service
Relations:
  ownedBy: group:default/backend-team
  providesApi: api:default/order-api
  consumesApi: api:default/inventory-api
  dependsOn: resource:default/orders-database
  partOf: system:default/ecommerce-platform
```

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 08 — Backstage Verification"
echo "============================================"
echo ""

echo "1. Backstage Frontend:"
curl -s -o /dev/null -w "   HTTP Status: %{http_code}\n" http://localhost:3000 2>/dev/null || echo "   ❌ Not running"

echo "2. Backstage Backend:"
curl -s -o /dev/null -w "   HTTP Status: %{http_code}\n" http://localhost:7007/api/catalog/entities 2>/dev/null || echo "   ❌ Not running"

echo "3. Catalog Entities:"
ENTITY_COUNT=$(curl -s http://localhost:7007/api/catalog/entities 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "   Total entities: $ENTITY_COUNT"

echo ""
echo "============================================"
```

---

## 🧹 Cleanup

```bash
# Stop Backstage
kill %1 2>/dev/null
# Or find and kill the process
pkill -f "backstage" 2>/dev/null
```

> ⚠️ **Keep the Backstage app** — we'll extend it in Labs 09, 13, and 14!

---

## 📝 Key Takeaways

- **Backstage** is a developer portal framework — you build YOUR portal on top of it
- The **Software Catalog** is the central registry of everything in your organization
- Entities are described with **YAML descriptors** (`catalog-info.yaml`)
- Key entity kinds: **Component**, **API**, **Resource**, **System**, **Domain**, **Group**, **User**
- **Relations** connect entities — ownership, dependencies, API contracts
- Backstage uses a **plugin architecture** — extend with community or custom plugins
- `app-config.yaml` is the main configuration file

---

## 🔗 References

- [Backstage Documentation](https://backstage.io/docs/)
- [Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Catalog Entity Model](https://backstage.io/docs/features/software-catalog/descriptor-format)
- [Backstage Getting Started](https://backstage.io/docs/getting-started/)

---

## ➡️ Next Lab

**[Lab 09 — Backstage: Software Templates](lab-09-backstage-software-templates.md)**

We'll create Software Templates (Scaffolder) to enable developer self-service — the "Golden Paths" for creating new services.
