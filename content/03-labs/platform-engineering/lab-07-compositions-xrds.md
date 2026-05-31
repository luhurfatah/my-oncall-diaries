# Lab 07 — Crossplane: Compositions & XRDs


## 🎯 Objectives

By the end of this lab, you will:

- Understand Composite Resource Definitions (XRDs) and Compositions
- Build a custom platform API (the "Database" abstraction)
- Write Compositions that map XRDs to managed resources
- Use Claims (XRCs) as the developer-facing interface
- Implement patching strategies for dynamic resource configuration
- Test compositions with different inputs and environments

---

## 📋 Prerequisites

- Completed **Lab 05 & 06** (Crossplane installed with Provider-Kubernetes and Provider-Helm)
- All providers in `Healthy` state

---

## 🏗️ Architecture

### Platform Team (Creators)
*   **XRD (API Definition):** Defines the parameters developers can request (e.g., `databaseSize`, `engine`, `environment`).
*   **Composition (Implementation):** Maps the XRD parameters to actual infrastructure resources (e.g., creates Namespace, Deployment, Service, ConfigMap).

### Developer (Consumers)
*   **Claim (Request):** Developer declares a high-level request (e.g., "I need a small PostgreSQL database for development").
*   **Provisioned Resources:** Crossplane translates the claim into the final manifests and verifies their readiness (Namespace, PostgreSQL Deployment, Service, ConfigMap containing database credentials).

---

## 📚 Concepts

### The Three Layers

| Layer | Resource | Created By | Purpose |
|-------|----------|------------|---------|
| **API** | XRD (CompositeResourceDefinition) | Platform Team | Defines the schema (what parameters are exposed) |
| **Implementation** | Composition | Platform Team | Maps the XRD to actual managed resources |
| **Request** | Claim (XRC) | Developer | Requests an instance of the composite resource |

### XRD → Composition → Claim Flow

```
- **Developer Claim:** A simple manifest requesting a database:
  ```yaml
  kind: DatabaseClaim
  spec:
    size: small
    engine: postgresql
    environment: dev
  ```
- **XRD Validation Schema:** Ensures the claim matches defined parameters (`size`, `engine`, `environment`).
- **Composition Resolution:** Renders the actual managed resources needed to fulfill the request (Namespace, PostgreSQL Deployment, Service, ConfigMap).
```

---

## 🔬 Hands-On Exercises

### Exercise 1: Create Your First XRD

Let's define a custom API for a "Platform Database":

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xdatabases.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XDatabase
    plural: xdatabases
  # Claims allow namespace-scoped access (developer-facing)
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
                      description: "Database size: small, medium, large"
                      enum: ["small", "medium", "large"]
                      default: "small"
                    engine:
                      type: string
                      description: "Database engine"
                      enum: ["postgresql", "mysql"]
                      default: "postgresql"
                    environment:
                      type: string
                      description: "Target environment"
                      enum: ["dev", "staging", "prod"]
                    storageGB:
                      type: integer
                      description: "Storage in GB"
                      default: 5
                      minimum: 1
                      maximum: 100
                  required:
                    - environment
            status:
              type: object
              properties:
                databaseEndpoint:
                  type: string
                databasePort:
                  type: string
                databaseName:
                  type: string
                status:
                  type: string
EOF

# Verify the XRD
kubectl get xrd xdatabases.platform.example.com

# Check that new CRDs were created
kubectl get crd | grep platform.example.com
```

**Expected Output:**
```
NAME                                  ESTABLISHED   OFFERED   AGE
xdatabases.platform.example.com       True          True      10s
```

> 💡 `OFFERED: True` means the Claim CRD (`DatabaseClaim`) was also created. Developers can now use `kind: DatabaseClaim` in their YAML.

---

### Exercise 2: Create a Composition

Now let's implement the XRD — define what resources get created when someone requests a database:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: database-composition
  labels:
    crossplane.io/xrd: xdatabases.platform.example.com
    provider: kubernetes
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  
  resources:
    # Resource 1: Namespace for the database
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
                name: ""  # patched below
                labels:
                  managed-by: crossplane-composition
                  resource-type: database
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
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.environment
          toFieldPath: spec.forProvider.manifest.metadata.labels.environment

    # Resource 2: PostgreSQL Deployment
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
                namespace: ""  # patched
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
                        value: "appdb"
                      - name: POSTGRES_USER
                        value: "appuser"
                      - name: POSTGRES_PASSWORD
                        value: "changeme123"
                      - name: PGDATA
                        value: /var/lib/postgresql/data/pgdata
                      resources:
                        requests:
                          cpu: "100m"
                          memory: "256Mi"
                        limits:
                          cpu: "200m"
                          memory: "512Mi"
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
        # Size-based resource patches
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.size
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.cpu
          transforms:
            - type: map
              map:
                small: "100m"
                medium: "250m"
                large: "500m"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.size
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.memory
          transforms:
            - type: map
              map:
                small: "256Mi"
                medium: "512Mi"
                large: "1Gi"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.size
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.limits.cpu
          transforms:
            - type: map
              map:
                small: "200m"
                medium: "500m"
                large: "1"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.size
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.limits.memory
          transforms:
            - type: map
              map:
                small: "512Mi"
                medium: "1Gi"
                large: "2Gi"

    # Resource 3: Database Service
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
                namespace: ""  # patched
              spec:
                selector:
                  app: postgresql
                ports:
                - port: 5432
                  targetPort: 5432
                type: ClusterIP
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

    # Resource 4: Connection Info ConfigMap
    - name: connection-info
      base:
        apiVersion: kubernetes.crossplane.io/v1alpha2
        kind: Object
        spec:
          providerConfigRef:
            name: kubernetes-provider
          forProvider:
            manifest:
              apiVersion: v1
              kind: ConfigMap
              metadata:
                name: db-connection-info
                namespace: ""  # patched
              data:
                DB_HOST: ""
                DB_PORT: "5432"
                DB_NAME: "appdb"
                DB_USER: "appuser"
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
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.environment
              - fromFieldPath: metadata.labels[crossplane.io/claim-name]
            strategy: string
            string:
              fmt: "postgresql.db-%s-%s.svc.cluster.local"
          toFieldPath: spec.forProvider.manifest.data.DB_HOST
EOF

# Verify the composition
kubectl get composition database-composition
```

---

### Exercise 3: Create a Claim (Developer Experience)

Now let's be a **developer** and request a database using the simple Claim API:

```bash
# Developer creates a simple claim — no need to know about deployments, services, etc.
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: my-app-db
  namespace: platform-dev
spec:
  parameters:
    size: small
    engine: postgresql
    environment: dev
    storageGB: 5
  compositionRef:
    name: database-composition
EOF

echo "⏳ Waiting for database to be provisioned..."
sleep 30

# Check the claim status
kubectl get databaseclaim my-app-db -n platform-dev

# Check the composite resource (cluster-scoped)
kubectl get xdatabase

# Check all the resources that were created
kubectl get objects -l crossplane.io/composite

# Verify the actual resources
NAMESPACE=$(kubectl get ns | grep "db-dev-my-app-db" | awk '{print $1}')
if [ -n "$NAMESPACE" ]; then
  echo "=== Resources in $NAMESPACE ==="
  kubectl get all -n "$NAMESPACE"
  kubectl get configmap -n "$NAMESPACE"
else
  echo "Namespace not yet created. Checking objects..."
  kubectl get objects
fi
```

---

### Exercise 4: Create Multiple Databases (Different Sizes)

```bash
# Medium database for staging
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: staging-orders-db
  namespace: platform-staging
spec:
  parameters:
    size: medium
    engine: postgresql
    environment: staging
    storageGB: 20
  compositionRef:
    name: database-composition
EOF

# Large database for production
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: prod-orders-db
  namespace: platform-prod
spec:
  parameters:
    size: large
    engine: postgresql
    environment: prod
    storageGB: 50
  compositionRef:
    name: database-composition
EOF

echo "⏳ Waiting for databases..."
sleep 30

# Compare resources across environments
echo "=== All Database Claims ==="
kubectl get databaseclaims --all-namespaces

echo ""
echo "=== All Composite Resources ==="
kubectl get xdatabases

echo ""
echo "=== All Created Objects ==="
kubectl get objects -l crossplane.io/composite
```

---

### Exercise 5: Build an "Application Environment" XRD

Let's create a more complex composition — a full application environment:

```bash
# XRD for an application environment
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xappenvironments.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XAppEnvironment
    plural: xappenvironments
  claimNames:
    kind: AppEnvironmentClaim
    plural: appenvironmentclaims
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
                    appName:
                      type: string
                      description: "Name of the application"
                    environment:
                      type: string
                      enum: ["dev", "staging", "prod"]
                    replicas:
                      type: integer
                      default: 1
                      minimum: 1
                      maximum: 10
                    image:
                      type: string
                      description: "Container image"
                      default: "nginx:1.25-alpine"
                    port:
                      type: integer
                      default: 80
                    includeDatabase:
                      type: boolean
                      default: false
                      description: "Include a PostgreSQL database"
                  required:
                    - appName
                    - environment
EOF

# Composition for app environment
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: app-environment-composition
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XAppEnvironment
  resources:
    # Namespace
    - name: app-namespace
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
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.appName
              - fromFieldPath: spec.parameters.environment
            strategy: string
            string:
              fmt: "%s-%s"
          toFieldPath: spec.forProvider.manifest.metadata.name

    # Deployment
    - name: app-deployment
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
                name: app
                namespace: ""
              spec:
                replicas: 1
                selector:
                  matchLabels:
                    app: main
                template:
                  metadata:
                    labels:
                      app: main
                  spec:
                    containers:
                    - name: app
                      image: nginx:1.25-alpine
                      ports:
                      - containerPort: 80
                      resources:
                        requests:
                          cpu: 50m
                          memory: 64Mi
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.appName
              - fromFieldPath: spec.parameters.environment
            strategy: string
            string:
              fmt: "%s-%s"
          toFieldPath: spec.forProvider.manifest.metadata.namespace
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.replicas
          toFieldPath: spec.forProvider.manifest.spec.replicas
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.image
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].image
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.port
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].ports[0].containerPort

    # Service
    - name: app-service
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
                name: app
                namespace: ""
              spec:
                selector:
                  app: main
                ports:
                - port: 80
                  targetPort: 80
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.appName
              - fromFieldPath: spec.parameters.environment
            strategy: string
            string:
              fmt: "%s-%s"
          toFieldPath: spec.forProvider.manifest.metadata.namespace
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.port
          toFieldPath: spec.forProvider.manifest.spec.ports[0].targetPort
EOF

# Use the new claim
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: AppEnvironmentClaim
metadata:
  name: frontend
  namespace: platform-dev
spec:
  parameters:
    appName: myapp
    environment: dev
    replicas: 2
    image: hashicorp/http-echo:0.2.3
    port: 8080
    includeDatabase: false
  compositionRef:
    name: app-environment-composition
EOF

sleep 20
echo "=== App Environment Claim ==="
kubectl get appenvironmentclaims -n platform-dev
echo ""
echo "=== Deployed Resources ==="
kubectl get all -n myapp-dev 2>/dev/null || echo "Waiting for namespace creation..."
```

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 07 — Compositions Verification"
echo "============================================"
echo ""

echo "1. XRDs:"
kubectl get xrd --no-headers | while read line; do echo "   ✅ $line"; done
echo ""

echo "2. Compositions:"
kubectl get compositions --no-headers | while read line; do echo "   ✅ $line"; done
echo ""

echo "3. Claims (all namespaces):"
kubectl get databaseclaims --all-namespaces --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done
kubectl get appenvironmentclaims --all-namespaces --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done
echo ""

echo "4. Composite Resources:"
kubectl get xdatabases --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done
kubectl get xappenvironments --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done
echo ""

echo "============================================"
```

---

## 🧹 Cleanup

```bash
# Delete claims (this cascades to composite resources and managed resources)
kubectl delete databaseclaims --all -n platform-dev
kubectl delete databaseclaims --all -n platform-staging
kubectl delete databaseclaims --all -n platform-prod
kubectl delete appenvironmentclaims --all -n platform-dev

sleep 15

# Delete compositions and XRDs
kubectl delete compositions --all
kubectl delete xrd --all

# Clean up namespaces
kubectl delete ns -l managed-by=crossplane-composition --ignore-not-found
kubectl delete ns -l managed-by=crossplane --ignore-not-found
```

---

## 📝 Key Takeaways

- **XRDs** define your platform's custom API — what developers can request
- **Compositions** implement the API — what actually gets created
- **Claims** are the developer-facing interface — simple, namespace-scoped requests
- **Patches** map claim parameters to resource fields (transforms, maps, combines)
- **One XRD can have multiple Compositions** — different implementations for different environments or clouds
- This is the **core pattern** for building Internal Developer Platforms with Crossplane

---

## 🔗 References

- [Crossplane Compositions](https://docs.crossplane.io/latest/concepts/compositions/)
- [Crossplane XRDs](https://docs.crossplane.io/latest/concepts/composite-resource-definitions/)
- [Crossplane Claims](https://docs.crossplane.io/latest/concepts/claims/)
- [Patch & Transform](https://docs.crossplane.io/latest/concepts/patch-and-transform/)

---

## ➡️ Next Lab

**[Lab 08 — Backstage: Setup & Software Catalog](lab-08-backstage-setup-software-catalog.md)**

We'll set up Backstage as our developer portal and populate the Software Catalog with our services.
