# Lab 14 — Full IDP: Backstage + Argo CD + Crossplane End-to-End


## 🎯 Objectives

By the end of this lab, you will:

- Build a complete Internal Developer Platform integrating all three tools
- Implement the full self-service workflow: Portal → Git → GitOps → IaC
- Developer requests a "new environment" from Backstage UI
- Backstage generates Crossplane Claims and K8s manifests
- Argo CD syncs and deploys; Crossplane provisions infrastructure
- Status flows back into Backstage catalog
- Complete full lifecycle: create, observe, update, and destroy

---

## 📋 Prerequisites

- Completed **ALL previous labs** (Labs 01-13)
- Argo CD, Crossplane, and Backstage all running
- Provider-Kubernetes and Provider-Helm installed

---

## 🏗️ Architecture — The Complete Picture

1. **Backstage Portal (Developer Request):** Developer fills out a self-service template specifying app parameters. Backstage generates code repositories, manifests, and Crossplane claims, and commits them to Git.
2. **Git Repository (Source of Truth):** Holds versioned templates, manifests, and claims.
3. **Argo CD (GitOps Delivery):** Detects new commits and synchronizes both Kubernetes workloads and Crossplane claims into the cluster.
4. **Crossplane (Infrastructure Provisioning):** Resolves claims, executes composed resource bindings, and configures physical services, networking, and databases.
5. **Observed Running Infrastructure:** Workloads are fully operational, network policies are active, and live environment health status syncs back to the Backstage catalog.

---

## 🔬 Hands-On Exercises

### Exercise 1: Prepare the Platform Foundation

Ensure all platform components are running:

```bash
echo "========================================"
echo "  Platform Health Check"
echo "========================================"

# Check Argo CD
echo ""
echo "1. Argo CD:"
kubectl get pods -n argocd --no-headers 2>/dev/null | grep Running | wc -l
echo "   pods running"

# Check Crossplane
echo "2. Crossplane:"
kubectl get pods -n crossplane-system --no-headers 2>/dev/null | grep Running | wc -l
echo "   pods running"

# Check Providers
echo "3. Providers:"
kubectl get providers --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done

# Check Namespaces
echo "4. Platform Namespaces:"
for ns in platform-dev platform-staging platform-prod; do
  kubectl get ns $ns --no-headers 2>/dev/null && echo "   ✅ $ns" || (kubectl create ns $ns && echo "   ✅ $ns created")
done
```

### Exercise 2: Deploy Platform XRDs and Compositions

```bash
# Full-featured Application Platform XRD
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xplatformapps.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XPlatformApp
    plural: xplatformapps
  claimNames:
    kind: PlatformAppClaim
    plural: platformappclaims
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
                    team:
                      type: string
                    environment:
                      type: string
                      enum: ["dev", "staging", "prod"]
                    tier:
                      type: string
                      enum: ["basic", "standard", "premium"]
                      default: "standard"
                    image:
                      type: string
                      default: "nginx:1.25-alpine"
                    port:
                      type: integer
                      default: 80
                    replicas:
                      type: integer
                      default: 1
                    includeDatabase:
                      type: boolean
                      default: false
                  required: ["appName", "team", "environment"]
            status:
              type: object
              properties:
                appEndpoint:
                  type: string
                status:
                  type: string
EOF

# Composition
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: platform-app-full
  labels:
    crossplane.io/xrd: xplatformapps.platform.example.com
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XPlatformApp
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
                  managed-by: platform-idp
                  provisioned-by: crossplane
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
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.team
          toFieldPath: spec.forProvider.manifest.metadata.labels.team

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
                labels:
                  backstage.io/kubernetes-id: ""
              spec:
                replicas: 1
                selector:
                  matchLabels:
                    app: main
                template:
                  metadata:
                    labels:
                      app: main
                      backstage.io/kubernetes-id: ""
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
                        limits:
                          cpu: 200m
                          memory: 256Mi
                      readinessProbe:
                        httpGet:
                          path: /
                          port: 80
                        initialDelaySeconds: 5
                      livenessProbe:
                        httpGet:
                          path: /
                          port: 80
                        initialDelaySeconds: 10
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
          fromFieldPath: spec.parameters.appName
          toFieldPath: spec.forProvider.manifest.metadata.labels[backstage.io/kubernetes-id]
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.appName
          toFieldPath: spec.forProvider.manifest.spec.template.metadata.labels[backstage.io/kubernetes-id]
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.image
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].image
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.port
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].ports[0].containerPort
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.replicas
          toFieldPath: spec.forProvider.manifest.spec.replicas
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.cpu
          transforms:
            - type: map
              map:
                basic: "25m"
                standard: "100m"
                premium: "250m"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.memory
          transforms:
            - type: map
              map:
                basic: "32Mi"
                standard: "128Mi"
                premium: "512Mi"

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

echo "✅ Platform XRD and Composition deployed"
```

### Exercise 3: Create the Backstage Self-Service Template

```bash
mkdir -p ~/platform-portal/templates/provision-app/skeleton

cat <<'TMPL' > ~/platform-portal/templates/provision-app/template.yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: provision-platform-app
  title: "🚀 Provision Application Environment"
  description: |
    Provision a complete application environment with namespace, deployment,
    service, and optional database. Uses Crossplane for infrastructure
    and Argo CD for GitOps delivery.
  tags:
    - platform
    - self-service
    - crossplane
    - argocd
    - recommended
spec:
  owner: platform-team
  type: environment

  parameters:
    - title: Application Details
      required:
        - appName
        - team
        - environment
      properties:
        appName:
          title: Application Name
          type: string
          pattern: '^[a-z][a-z0-9-]*$'
          ui:autofocus: true
          ui:help: 'Lowercase letters, numbers, and hyphens only'
        description:
          title: Description
          type: string
        team:
          title: Owner Team
          type: string
          enum:
            - platform-team
            - backend-team
            - frontend-team
        environment:
          title: Environment
          type: string
          enum:
            - dev
            - staging
            - prod
          default: dev

    - title: Resource Configuration
      properties:
        tier:
          title: Resource Tier
          type: string
          enum:
            - basic
            - standard
            - premium
          default: standard
          description: "basic=minimal, standard=balanced, premium=high-performance"
        image:
          title: Container Image
          type: string
          default: "hashicorp/http-echo:0.2.3"
        port:
          title: Container Port
          type: integer
          default: 8080
        replicas:
          title: Replicas
          type: integer
          default: 1
          minimum: 1
          maximum: 5
        includeDatabase:
          title: Include PostgreSQL Database
          type: boolean
          default: false

  steps:
    - id: log-request
      name: Log Provisioning Request
      action: debug:log
      input:
        message: |
          ======================================
          Platform App Provisioning Request
          ======================================
          App: ${{ parameters.appName }}
          Team: ${{ parameters.team }}
          Environment: ${{ parameters.environment }}
          Tier: ${{ parameters.tier }}
          Image: ${{ parameters.image }}
          Port: ${{ parameters.port }}
          Replicas: ${{ parameters.replicas }}
          Database: ${{ parameters.includeDatabase }}
          ======================================

    - id: generate-manifests
      name: Generate Crossplane Claim & Catalog Entry
      action: fetch:template
      input:
        url: ./skeleton
        targetPath: .
        values:
          appName: ${{ parameters.appName }}
          description: ${{ parameters.description }}
          team: ${{ parameters.team }}
          environment: ${{ parameters.environment }}
          tier: ${{ parameters.tier }}
          image: ${{ parameters.image }}
          port: ${{ parameters.port }}
          replicas: ${{ parameters.replicas }}
          includeDatabase: ${{ parameters.includeDatabase }}

    - id: log-output
      name: Log Generated Files
      action: debug:log
      input:
        message: "✅ Manifests generated for ${{ parameters.appName }}"
        listWorkspace: true

  output:
    links:
      - title: View in Catalog
        icon: catalog
        entityRef: component:default/${{ parameters.appName }}
      - title: View Argo CD Application
        icon: dashboard
        url: https://localhost:8443/applications/${{ parameters.appName }}-${{ parameters.environment }}
TMPL

# Crossplane Claim skeleton
cat <<'EOF' > ~/platform-portal/templates/provision-app/skeleton/crossplane-claim.yaml
# Auto-generated by Backstage Platform Template
# This claim will be synced by Argo CD and provisioned by Crossplane
apiVersion: platform.example.com/v1alpha1
kind: PlatformAppClaim
metadata:
  name: ${{ values.appName }}
  namespace: platform-${{ values.environment }}
  labels:
    app.kubernetes.io/managed-by: backstage
    backstage.io/template: provision-platform-app
    team: ${{ values.team }}
  annotations:
    backstage.io/source-template: provision-platform-app
    backstage.io/provisioned-at: "2024-01-01T00:00:00Z"
spec:
  parameters:
    appName: ${{ values.appName }}
    team: ${{ values.team }}
    environment: ${{ values.environment }}
    tier: ${{ values.tier }}
    image: ${{ values.image }}
    port: ${{ values.port }}
    replicas: ${{ values.replicas }}
    includeDatabase: ${{ values.includeDatabase }}
  compositionRef:
    name: platform-app-full
EOF

# Catalog entry skeleton
cat <<'EOF' > ~/platform-portal/templates/provision-app/skeleton/catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${{ values.appName }}
  description: "${{ values.description }}"
  annotations:
    backstage.io/kubernetes-id: ${{ values.appName }}
    backstage.io/kubernetes-namespace: ${{ values.appName }}-${{ values.environment }}
    argocd/app-name: ${{ values.appName }}-${{ values.environment }}
  tags:
    - ${{ values.environment }}
    - ${{ values.tier }}
    - platform-managed
spec:
  type: service
  lifecycle: experimental
  owner: ${{ values.team }}
  system: ecommerce-platform
EOF

echo "✅ Backstage template created"
```

### Exercise 4: Simulate the Full Self-Service Flow

Since we can't push to a real Git repo from the sandbox, let's simulate the full flow manually:

```bash
echo "========================================"
echo "  SIMULATING FULL IDP WORKFLOW"
echo "========================================"

# Step 1: "Developer" fills out the Backstage form
echo ""
echo "Step 1: Developer requests via Backstage"
echo "  App: payment-service"
echo "  Team: backend-team"
echo "  Environment: dev"
echo "  Tier: standard"

# Step 2: Backstage generates manifests (we create them manually)
echo ""
echo "Step 2: Backstage generates Crossplane Claim"

cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: PlatformAppClaim
metadata:
  name: payment-service
  namespace: platform-dev
  labels:
    app.kubernetes.io/managed-by: backstage
    team: backend-team
  annotations:
    backstage.io/source-template: provision-platform-app
spec:
  parameters:
    appName: payment-service
    team: backend-team
    environment: dev
    tier: standard
    image: hashicorp/http-echo:0.2.3
    port: 8080
    replicas: 2
    includeDatabase: false
  compositionRef:
    name: platform-app-full
EOF

# Step 3: In real flow, Argo CD would sync this from Git
echo ""
echo "Step 3: Argo CD syncs (simulated — applied directly)"

# Step 4: Crossplane provisions
echo ""
echo "Step 4: Crossplane provisioning..."
sleep 30

# Step 5: Verify the full stack
echo ""
echo "Step 5: Verification"
echo ""

echo "=== Claim Status ==="
kubectl get platformappclaims -n platform-dev

echo ""
echo "=== Composite Resource ==="
kubectl get xplatformapps

echo ""
echo "=== Provisioned Resources ==="
kubectl get all -n payment-service-dev 2>/dev/null || echo "Namespace still provisioning..."

echo ""
echo "=== All Managed Objects ==="
kubectl get objects -l crossplane.io/composite 2>/dev/null

# Test the application
echo ""
echo "=== Application Test ==="
kubectl port-forward svc/app -n payment-service-dev 9090:80 2>/dev/null &
sleep 3
curl -s http://localhost:9090 2>/dev/null || echo "App not ready yet"
kill %1 2>/dev/null
```

### Exercise 5: Provision a Second Application

```bash
echo "Provisioning a second app: inventory-service (staging, premium)"

cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: PlatformAppClaim
metadata:
  name: inventory-service
  namespace: platform-staging
  labels:
    app.kubernetes.io/managed-by: backstage
    team: backend-team
spec:
  parameters:
    appName: inventory-service
    team: backend-team
    environment: staging
    tier: premium
    image: hashicorp/http-echo:0.2.3
    port: 8080
    replicas: 3
    includeDatabase: false
  compositionRef:
    name: platform-app-full
EOF

sleep 30

echo "=== All Platform App Claims ==="
kubectl get platformappclaims --all-namespaces

echo ""
echo "=== All Provisioned Namespaces ==="
kubectl get ns -l managed-by=platform-idp
```

### Exercise 6: Full Platform Dashboard

```bash
echo "╔══════════════════════════════════════════════════════╗"
echo "║        PLATFORM ENGINEERING DASHBOARD                ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"

echo "║  🔄 Argo CD Applications:                           ║"
ARGOCD_APPS=$(argocd app list --output name 2>/dev/null | wc -l)
echo "║     $ARGOCD_APPS applications managed                ║"

echo "║                                                      ║"
echo "║  ☁️  Crossplane Resources:                           ║"
XRD_COUNT=$(kubectl get xrd --no-headers 2>/dev/null | wc -l)
COMP_COUNT=$(kubectl get compositions --no-headers 2>/dev/null | wc -l)
CLAIM_COUNT=$(kubectl get platformappclaims --all-namespaces --no-headers 2>/dev/null | wc -l)
OBJECTS=$(kubectl get objects --no-headers 2>/dev/null | wc -l)
echo "║     $XRD_COUNT XRDs | $COMP_COUNT Compositions        ║"
echo "║     $CLAIM_COUNT Claims | $OBJECTS Managed Objects    ║"

echo "║                                                      ║"
echo "║  🎭 Backstage Catalog:                               ║"
ENTITIES=$(curl -s http://localhost:7007/api/catalog/entities 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "N/A")
echo "║     $ENTITIES entities registered                     ║"

echo "║                                                      ║"
echo "║  📊 Provisioned Environments:                        ║"
kubectl get ns -l managed-by=platform-idp --no-headers 2>/dev/null | while read ns rest; do
  echo "║     ✅ $ns"
done

echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
```

---

## ✅ Verification

```bash
echo "============================================"
echo "  Lab 14 — Full IDP Verification"
echo "============================================"

echo ""
echo "✅ Checklist:"
echo "  [$(kubectl get xrd xplatformapps.platform.example.com --no-headers 2>/dev/null | wc -l | tr -d ' ' | sed 's/1/x/;s/0/ /')] XRD created"
echo "  [$(kubectl get composition platform-app-full --no-headers 2>/dev/null | wc -l | tr -d ' ' | sed 's/1/x/;s/0/ /')] Composition created"
echo "  [$(kubectl get platformappclaims -n platform-dev --no-headers 2>/dev/null | wc -l | tr -d ' ' | sed 's/^0$/ /;s/^[1-9].*/x/')] Dev claims active"
echo "  [$(kubectl get ns payment-service-dev --no-headers 2>/dev/null | wc -l | tr -d ' ' | sed 's/1/x/;s/0/ /')] payment-service-dev namespace"
echo "  [$(test -f ~/platform-portal/templates/provision-app/template.yaml && echo 1 || echo 0 | sed 's/1/x/;s/0/ /')] Backstage template exists"

echo ""
echo "============================================"
```

---

## 🧹 Cleanup

```bash
# Delete claims
kubectl delete platformappclaims --all -n platform-dev 2>/dev/null
kubectl delete platformappclaims --all -n platform-staging 2>/dev/null
kubectl delete platformappclaims --all -n platform-prod 2>/dev/null
sleep 20

# Delete compositions and XRDs
kubectl delete compositions --all 2>/dev/null
kubectl delete xrd --all 2>/dev/null

# Delete provisioned namespaces
kubectl delete ns -l managed-by=platform-idp --ignore-not-found
kubectl delete ns payment-service-dev inventory-service-staging --ignore-not-found 2>/dev/null
```

---

## 📝 Key Takeaways

- **The full IDP workflow**: Backstage (UI) → Git (source of truth) → Argo CD (sync) → Crossplane (provision)
- **Developers never touch kubectl** — they use the Backstage form and everything flows automatically
- **Platform team defines the API** (XRDs) and **implementation** (Compositions)
- **Git provides audit trail** — every infrastructure change is a commit
- **Two reconciliation loops** (Argo CD + Crossplane) provide continuous desired-state enforcement
- This architecture scales from **1 to 1000+ services** without changing the workflow

---

## ➡️ Next Lab

**[Lab 15 — Production-Ready Platform: Security, Observability & Multi-Tenancy](lab-15-production-ready-platform-security-observability.md)**
