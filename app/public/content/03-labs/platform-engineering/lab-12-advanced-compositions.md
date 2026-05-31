# Lab 12 — Crossplane: Advanced Compositions & Functions


## 🎯 Objectives

By the end of this lab, you will:

- Build nested compositions (compositions referencing other compositions)
- Understand and use Composition Functions (pipeline mode)
- Use patch transforms: maps, math, string formats, conditions
- Implement EnvironmentConfigs for shared configuration
- Forward status from managed resources to composite resources
- Build a complete "Application Platform" XRD with multiple compositions

---

## 📋 Prerequisites

- Completed **Lab 07** (Crossplane compositions basics)
- Crossplane with Provider-Kubernetes and Provider-Helm installed

---

## 📚 Concepts

### Composition Functions (Pipeline Mode)

Traditional compositions use `resources` with `patches`. Composition Functions introduce a **pipeline** approach:

```
Traditional:                      Function Pipeline:
────────────                      ──────────────────
resources:                        pipeline:
  - name: ns                        - step: create-ns
    base: ...                         functionRef: patch-and-transform
    patches: ...                      input: ...
  - name: deploy                    - step: create-deploy
    base: ...                         functionRef: patch-and-transform
                                      input: ...
                                    - step: add-labels
                                      functionRef: go-templating
```

### Advanced Patching

| Transform Type | Use Case | Example |
|---------------|----------|---------|
| **map** | Enum → value lookup | `small → 256Mi` |
| **math** | Arithmetic operations | `multiply: 1024` |
| **string** | String formatting | `fmt: "db-%s-%s"` |
| **convert** | Type conversion | `toType: int64` |
| **match** | Pattern matching | Regex-based transforms |

---

## 🔬 Hands-On Exercises

### Exercise 1: Advanced Patching Strategies

Build a composition with sophisticated patching:

```bash
# XRD for a full application stack
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xappstacks.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XAppStack
    plural: xappstacks
  claimNames:
    kind: AppStackClaim
    plural: appstackclaims
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
                      description: "Application tier determines resource allocation"
                      enum: ["free", "standard", "premium"]
                      default: "standard"
                    image:
                      type: string
                      default: "nginx:1.25-alpine"
                    port:
                      type: integer
                      default: 80
                    enableIngress:
                      type: boolean
                      default: false
                    enableHPA:
                      type: boolean
                      default: false
                    minReplicas:
                      type: integer
                      default: 1
                    maxReplicas:
                      type: integer
                      default: 5
                  required: ["appName", "team", "environment"]
            status:
              type: object
              properties:
                endpoint:
                  type: string
                replicas:
                  type: integer
                status:
                  type: string
EOF

# Advanced Composition with complex patching
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: appstack-standard
  labels:
    crossplane.io/xrd: xappstacks.platform.example.com
    tier: standard
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XAppStack
  resources:
    # 1. Namespace
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
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.team
          toFieldPath: spec.forProvider.manifest.metadata.labels.team
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.metadata.labels.tier

    # 2. Resource Quota (based on tier)
    - name: resource-quota
      base:
        apiVersion: kubernetes.crossplane.io/v1alpha2
        kind: Object
        spec:
          providerConfigRef:
            name: kubernetes-provider
          forProvider:
            manifest:
              apiVersion: v1
              kind: ResourceQuota
              metadata:
                name: tier-quota
                namespace: ""
              spec:
                hard:
                  requests.cpu: "1"
                  requests.memory: "1Gi"
                  limits.cpu: "2"
                  limits.memory: "2Gi"
                  pods: "10"
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
        # Tier-based quota mapping
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.hard.requests\.cpu
          transforms:
            - type: map
              map:
                free: "500m"
                standard: "2"
                premium: "4"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.hard.requests\.memory
          transforms:
            - type: map
              map:
                free: "512Mi"
                standard: "2Gi"
                premium: "8Gi"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.hard.pods
          transforms:
            - type: map
              map:
                free: "5"
                standard: "20"
                premium: "50"

    # 3. Deployment
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
                        limits:
                          cpu: 200m
                          memory: 256Mi
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
          fromFieldPath: spec.parameters.image
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].image
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.port
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].ports[0].containerPort
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.minReplicas
          toFieldPath: spec.forProvider.manifest.spec.replicas
        # Tier-based resource mapping
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.cpu
          transforms:
            - type: map
              map:
                free: "25m"
                standard: "100m"
                premium: "250m"
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.tier
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].resources.requests.memory
          transforms:
            - type: map
              map:
                free: "32Mi"
                standard: "128Mi"
                premium: "512Mi"

    # 4. Service
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

    # 5. Network Policy (security by default)
    - name: network-policy
      base:
        apiVersion: kubernetes.crossplane.io/v1alpha2
        kind: Object
        spec:
          providerConfigRef:
            name: kubernetes-provider
          forProvider:
            manifest:
              apiVersion: networking.k8s.io/v1
              kind: NetworkPolicy
              metadata:
                name: default-deny-ingress
                namespace: ""
              spec:
                podSelector: {}
                policyTypes:
                - Ingress
                ingress:
                - from:
                  - namespaceSelector:
                      matchLabels:
                        kubernetes.io/metadata.name: ingress-system
                  - podSelector: {}
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
EOF

echo "✅ Advanced XRD and Composition created"
```

### Exercise 2: Test the Advanced Composition

```bash
# Free tier claim
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: AppStackClaim
metadata:
  name: demo-free
  namespace: platform-dev
spec:
  parameters:
    appName: mysite
    team: frontend-team
    environment: dev
    tier: free
    image: hashicorp/http-echo:0.2.3
    port: 8080
  compositionRef:
    name: appstack-standard
EOF

# Premium tier claim
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: AppStackClaim
metadata:
  name: demo-premium
  namespace: platform-dev
spec:
  parameters:
    appName: api
    team: backend-team
    environment: dev
    tier: premium
    image: hashicorp/http-echo:0.2.3
    port: 8080
    minReplicas: 2
  compositionRef:
    name: appstack-standard
EOF

sleep 30

# Compare the two tiers
echo "=== Free Tier (mysite-dev) ==="
kubectl get resourcequota -n mysite-dev -o jsonpath='{.items[0].spec.hard}' 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Waiting..."
kubectl get deployment -n mysite-dev 2>/dev/null

echo ""
echo "=== Premium Tier (api-dev) ==="
kubectl get resourcequota -n api-dev -o jsonpath='{.items[0].spec.hard}' 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Waiting..."
kubectl get deployment -n api-dev 2>/dev/null
```

### Exercise 3: EnvironmentConfigs for Shared Settings

EnvironmentConfigs let you share data across compositions:

```bash
# Create an EnvironmentConfig with shared platform settings
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: EnvironmentConfig
metadata:
  name: platform-defaults
  labels:
    platform: shared
data:
  defaultRegion: us-east-1
  clusterName: platform-lab
  domainName: platform.example.com
  monitoringEnabled: "true"
  logLevel: info
  costCenter: platform-engineering
  teamSlackChannel: "#platform-alerts"
EOF

# Create per-environment configs
for ENV in dev staging prod; do
  LOG_LEVEL="debug"
  MONITORING="false"
  case $ENV in
    staging) LOG_LEVEL="info"; MONITORING="true" ;;
    prod) LOG_LEVEL="warn"; MONITORING="true" ;;
  esac
  
  cat <<EOF | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: EnvironmentConfig
metadata:
  name: env-${ENV}
  labels:
    environment: ${ENV}
data:
  logLevel: ${LOG_LEVEL}
  monitoringEnabled: "${MONITORING}"
  environmentTier: ${ENV}
EOF
done

# Verify
kubectl get environmentconfigs
```

### Exercise 4: Multiple Compositions for the Same XRD

Create different compositions for different use cases:

```bash
# Minimal composition (for development/testing)
cat <<'EOF' | kubectl apply -f -
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: appstack-minimal
  labels:
    crossplane.io/xrd: xappstacks.platform.example.com
    tier: minimal
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XAppStack
  resources:
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
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.appName
              - fromFieldPath: spec.parameters.environment
            strategy: string
            string:
              fmt: "%s-%s-minimal"
          toFieldPath: spec.forProvider.manifest.metadata.name
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
                      image: nginx
                      resources:
                        requests:
                          cpu: 10m
                          memory: 32Mi
      patches:
        - type: CombineFromComposite
          combine:
            variables:
              - fromFieldPath: spec.parameters.appName
              - fromFieldPath: spec.parameters.environment
            strategy: string
            string:
              fmt: "%s-%s-minimal"
          toFieldPath: spec.forProvider.manifest.metadata.namespace
        - type: FromCompositeFieldPath
          fromFieldPath: spec.parameters.image
          toFieldPath: spec.forProvider.manifest.spec.template.spec.containers[0].image
EOF

# Use the minimal composition
cat <<'EOF' | kubectl apply -f -
apiVersion: platform.example.com/v1alpha1
kind: AppStackClaim
metadata:
  name: quick-test
  namespace: platform-dev
spec:
  parameters:
    appName: quicktest
    team: platform-team
    environment: dev
    tier: free
  compositionRef:
    name: appstack-minimal
EOF

sleep 20

echo "=== Compositions Available ==="
kubectl get compositions -l crossplane.io/xrd=xappstacks.platform.example.com

echo ""
echo "=== Claims and Their Compositions ==="
kubectl get appstackclaims -n platform-dev -o custom-columns=NAME:.metadata.name,COMPOSITION:.spec.compositionRef.name
```

---

## ✅ Verification

```bash
echo "============================================"
echo "  Lab 12 — Advanced Compositions Verification"
echo "============================================"
echo ""

echo "1. XRDs:"
kubectl get xrd --no-headers | while read line; do echo "   ✅ $line"; done

echo ""
echo "2. Compositions:"
kubectl get compositions --no-headers | while read line; do echo "   ✅ $line"; done

echo ""
echo "3. EnvironmentConfigs:"
kubectl get environmentconfigs --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done

echo ""
echo "4. Claims:"
kubectl get appstackclaims -n platform-dev --no-headers 2>/dev/null | while read line; do echo "   ✅ $line"; done

echo ""
echo "============================================"
```

---

## 🧹 Cleanup

```bash
kubectl delete appstackclaims --all -n platform-dev 2>/dev/null
kubectl delete databaseclaims --all --all-namespaces 2>/dev/null
sleep 20
kubectl delete compositions --all
kubectl delete xrd --all
kubectl delete environmentconfigs --all 2>/dev/null
kubectl delete ns -l managed-by=crossplane --ignore-not-found
```

---

## 📝 Key Takeaways

- **Advanced patches** (map, math, combine, convert) enable sophisticated resource customization
- **Multiple compositions per XRD** allow different implementations (minimal, standard, premium)
- **EnvironmentConfigs** share configuration across compositions
- **Tier-based resource quotas** enforce governance through composition logic
- **Network policies by default** embed security into every provisioned environment
- Composition Functions (pipeline mode) enable programmatic logic beyond YAML patching

---

## ➡️ Next Lab

**[Lab 13 — Backstage: Plugins & Kubernetes Integration](lab-13-backstage-plugins-kubernetes-integration.md)**
