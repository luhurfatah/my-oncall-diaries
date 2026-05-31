# Lab 06 — Crossplane: Managing Resources


## 🎯 Objectives

By the end of this lab, you will:

- Deploy complex application stacks using Provider-Helm
- Manage cloud resources with Provider-AWS (or simulate with Provider-Kubernetes)
- Understand Crossplane resource states and conditions
- Work with connection details and secrets
- Implement deletion policies and management policies
- Use references between managed resources
- Debug common Crossplane issues

---

## 📋 Prerequisites

- Completed **Lab 05** (Crossplane installed with Provider-Kubernetes and Provider-Helm)
- Providers in `Healthy` state

---

## 📚 Concepts

### Resource Lifecycle States

##### Resource Lifecycle State Machine
- **Created:** The resource manifest is registered in the control plane.
- **Syncing:** Crossplane is actively deploying or applying configuration updates.
- **Ready:** The resource is fully provisioned and functional.
- **Updated:** Configuration changes are pushed and updated successfully.
- **Deleting/Deleted:** The resource is removed from the external provider and cleaned up.
- **Failed/Stuck:** The deployment has failed or is blocked (check logs for errors).
- **OutOfSync:** Drift is detected relative to the declared state, triggering auto-correction back to parity.

### Crossplane Resource Conditions

| Condition | Values | Meaning |
|-----------|--------|---------|
| **Synced** | True/False | Crossplane can communicate with the external API |
| **Ready** | True/False | The external resource exists and is ready |
| **LastAsyncOperation** | (varies) | Status of the last async cloud operation |

### Management Policies

| Policy | Behavior |
|--------|----------|
| `*` (default) | Full management: create, observe, update, delete |
| `ObserveOnly` | Read-only: just import and watch existing resources |
| `OrphanOnDelete` | Create and manage, but leave resource when MR is deleted |

---

## 🔬 Hands-On Exercises

### Exercise 1: Deploy a Full Application Stack with Provider-Helm

Let's deploy a complete monitoring stack (Prometheus + Grafana) using Crossplane:

```bash
# Create a namespace for monitoring first
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: monitoring-namespace
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Namespace
      metadata:
        name: monitoring
        labels:
          purpose: observability
          managed-by: crossplane
EOF

# Wait for namespace
sleep 5
```

#### Deploy Prometheus via Crossplane Helm Release

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: helm.crossplane.io/v1beta1
kind: Release
metadata:
  name: prometheus
spec:
  providerConfigRef:
    name: helm-provider
  forProvider:
    chart:
      name: kube-prometheus-stack
      repository: https://prometheus-community.github.io/helm-charts
      version: "55.5.0"
    namespace: monitoring
    values:
      # Minimize resource usage for lab environment
      prometheus:
        prometheusSpec:
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 200m
              memory: 512Mi
          retention: 6h
          storageSpec: {}
      # Grafana settings
      grafana:
        enabled: true
        adminPassword: "PlatformLab123!"
        resources:
          requests:
            cpu: 50m
            memory: 128Mi
          limits:
            cpu: 100m
            memory: 256Mi
        service:
          type: ClusterIP
      # Disable components we don't need for the lab
      alertmanager:
        enabled: false
      nodeExporter:
        enabled: true
      kubeStateMetrics:
        enabled: true
    set:
      - name: prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues
        value: "false"
EOF

echo "⏳ Deploying Prometheus stack (this may take 2-3 minutes)..."
sleep 30

# Check the release status
kubectl get release prometheus

# Wait for it to become ready
kubectl wait --for=condition=Ready release/prometheus --timeout=300s 2>/dev/null || \
  echo "Still provisioning... check with: kubectl get release prometheus"

# Verify pods
kubectl get pods -n monitoring
```

#### Access Grafana

```bash
# Port-forward to Grafana
kubectl port-forward svc/prometheus-grafana -n monitoring 3000:80 &

echo "Grafana URL: http://localhost:3000"
echo "Username: admin"
echo "Password: PlatformLab123!"

# Wait and test
sleep 3
curl -s http://localhost:3000/api/health
kill %1 2>/dev/null
```

---

### Exercise 2: Connection Details — Sharing Credentials Between Resources

When Crossplane provisions resources (like databases), it can write connection details to Kubernetes Secrets.

```bash
# Deploy a PostgreSQL instance via Helm
cat <<'EOF' | kubectl apply -f -
apiVersion: helm.crossplane.io/v1beta1
kind: Release
metadata:
  name: postgresql
spec:
  providerConfigRef:
    name: helm-provider
  forProvider:
    chart:
      name: postgresql
      repository: https://charts.bitnami.com/bitnami
      version: "13.2.24"
    namespace: platform-dev
    values:
      auth:
        postgresPassword: "SuperSecure123!"
        database: platformdb
        username: platformuser
        password: "UserPass123!"
      primary:
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
        persistence:
          enabled: false
      readReplicas:
        replicaCount: 0
  # Write connection details to a Kubernetes Secret
  connectionDetails:
    - apiVersion: v1
      kind: Secret
      namespace: platform-dev
      name: postgresql
      fieldPath: data.postgres-password
      toConnectionSecretKey: password
EOF

echo "⏳ Deploying PostgreSQL..."
sleep 30
kubectl get release postgresql
```

#### Create an Application That Uses the Database

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: db-consumer-app
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: db-consumer
        namespace: platform-dev
      spec:
        replicas: 1
        selector:
          matchLabels:
            app: db-consumer
        template:
          metadata:
            labels:
              app: db-consumer
          spec:
            containers:
            - name: app
              image: busybox:1.36
              command: ['sh', '-c']
              args:
                - |
                  echo "Database connection test:"
                  echo "Host: postgresql.platform-dev.svc.cluster.local"
                  echo "Port: 5432"
                  echo "Database: platformdb"
                  echo "User: platformuser"
                  echo "Password is set: $(test -n "$DB_PASSWORD" && echo 'yes' || echo 'no')"
                  echo ""
                  echo "App running and connected to database!"
                  sleep 3600
              env:
              - name: DB_HOST
                value: "postgresql.platform-dev.svc.cluster.local"
              - name: DB_PORT
                value: "5432"
              - name: DB_NAME
                value: "platformdb"
              - name: DB_USER
                value: "platformuser"
              - name: DB_PASSWORD
                valueFrom:
                  secretKeyRef:
                    name: postgresql
                    key: postgres-password
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
EOF

sleep 15
kubectl logs -n platform-dev -l app=db-consumer 2>/dev/null || echo "Waiting for pod..."
```

---

### Exercise 3: Resource Dependencies and Ordering

In real scenarios, resources depend on each other. Let's demonstrate how to manage dependencies.

```bash
# Create a full 3-tier application stack

# Tier 1: Namespace (must exist first)
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: tiered-app-namespace
  annotations:
    crossplane.io/external-name: tiered-app
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Namespace
      metadata:
        name: tiered-app
        labels:
          app: tiered-app
          tier: infrastructure
EOF

sleep 5

# Tier 2: Backend service (depends on namespace)
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: tiered-app-backend
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: backend
        namespace: tiered-app
      spec:
        replicas: 2
        selector:
          matchLabels:
            app: backend
            tier: backend
        template:
          metadata:
            labels:
              app: backend
              tier: backend
          spec:
            containers:
            - name: api
              image: hashicorp/http-echo:0.2.3
              args:
                - "-text={\"status\":\"ok\",\"service\":\"backend-api\",\"version\":\"1.0\"}"
                - "-listen=:8080"
              ports:
              - containerPort: 8080
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
---
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: tiered-app-backend-svc
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Service
      metadata:
        name: backend
        namespace: tiered-app
      spec:
        selector:
          app: backend
        ports:
        - port: 80
          targetPort: 8080
EOF

sleep 5

# Tier 3: Frontend (depends on backend service)
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: tiered-app-frontend
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: frontend
        namespace: tiered-app
      spec:
        replicas: 2
        selector:
          matchLabels:
            app: frontend
            tier: frontend
        template:
          metadata:
            labels:
              app: frontend
              tier: frontend
          spec:
            containers:
            - name: web
              image: nginx:1.25-alpine
              ports:
              - containerPort: 80
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
---
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: tiered-app-frontend-svc
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Service
      metadata:
        name: frontend
        namespace: tiered-app
      spec:
        selector:
          app: frontend
        ports:
        - port: 80
          targetPort: 80
EOF

# Verify the full stack
sleep 10
echo "=== Tiered Application Stack ==="
kubectl get all -n tiered-app
```

---

### Exercise 4: Observe-Only Resources (Importing Existing Resources)

Sometimes you want Crossplane to **monitor** existing resources without managing them:

```bash
# First, create a resource manually
kubectl create namespace legacy-app
kubectl create configmap legacy-config -n legacy-app --from-literal=version=v2.0

# Now, observe it with Crossplane (read-only — won't delete or modify)
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: observe-legacy-config
spec:
  providerConfigRef:
    name: kubernetes-provider
  managementPolicies: ["Observe"]
  forProvider:
    manifest:
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: legacy-config
        namespace: legacy-app
EOF

sleep 10

# Check the observed resource
kubectl get object observe-legacy-config -o yaml | grep -A 20 "atProvider"

# Delete the Crossplane Object — the external ConfigMap should survive!
kubectl delete object observe-legacy-config
kubectl get configmap legacy-config -n legacy-app
# ✅ ConfigMap still exists!
```

---

### Exercise 5: Debugging Crossplane Resources

```bash
# Common debugging commands:

echo "=== 1. List all managed resources ==="
kubectl get managed

echo ""
echo "=== 2. Check for unhealthy resources ==="
kubectl get managed -o custom-columns=\
TYPE:.kind,\
NAME:.metadata.name,\
SYNCED:.status.conditions[?(@.type=="Synced")].status,\
READY:.status.conditions[?(@.type=="Ready")].status

echo ""
echo "=== 3. Check Crossplane core logs ==="
kubectl logs -n crossplane-system -l app=crossplane --tail=20

echo ""
echo "=== 4. Check Provider logs ==="
# Provider-Kubernetes
kubectl logs -n crossplane-system -l pkg.crossplane.io/revision --tail=20 -c provider 2>/dev/null

echo ""
echo "=== 5. Describe a stuck resource ==="
# Replace with your resource name if debugging
kubectl describe object demo-deployment 2>/dev/null | tail -20

echo ""
echo "=== 6. Check events ==="
kubectl get events -n crossplane-system --sort-by='.lastTimestamp' | tail -15
```

### Common Issues and Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Provider not healthy** | `HEALTHY: False` | Check provider pod logs |
| **Resource stuck Syncing** | `SYNCED: False` | Check ProviderConfig credentials |
| **Resource not Ready** | `READY: False` | Check if external resource failed (e.g., quota) |
| **Permission denied** | Events show 403 errors | Check RBAC for provider ServiceAccount |
| **CRD not found** | `error: the server doesn't have a resource type` | Provider not installed or wrong version |

---

### Exercise 6: Crossplane with Multiple Environments

Let's create a pattern for managing resources across environments:

```bash
# Create per-environment configurations
for ENV in dev staging prod; do
  REPLICAS=1
  CPU_REQ="50m"
  MEM_REQ="64Mi"
  
  case $ENV in
    staging) REPLICAS=2; CPU_REQ="100m"; MEM_REQ="128Mi" ;;
    prod)    REPLICAS=3; CPU_REQ="200m"; MEM_REQ="256Mi" ;;
  esac

  cat <<EOF | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: env-app-${ENV}
  labels:
    environment: ${ENV}
    managed-by: crossplane
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: env-app
        namespace: platform-${ENV}
        labels:
          app: env-app
          environment: ${ENV}
      spec:
        replicas: ${REPLICAS}
        selector:
          matchLabels:
            app: env-app
        template:
          metadata:
            labels:
              app: env-app
              environment: ${ENV}
          spec:
            containers:
            - name: app
              image: hashicorp/http-echo:0.2.3
              args:
                - "-text=Hello from ${ENV} environment!"
                - "-listen=:8080"
              ports:
              - containerPort: 8080
              resources:
                requests:
                  cpu: ${CPU_REQ}
                  memory: ${MEM_REQ}
EOF
  echo "✅ Created env-app in platform-${ENV}"
done

# Verify all environments
for ENV in dev staging prod; do
  echo "=== platform-${ENV} ==="
  kubectl get deployment env-app -n platform-${ENV} 2>/dev/null || echo "  Not found"
done
```

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 06 — Managing Resources Verification"
echo "============================================"
echo ""

echo "1. All Managed Resources:"
kubectl get managed --no-headers 2>/dev/null | wc -l
echo "   managed resources total"
echo ""

echo "2. Helm Releases:"
kubectl get releases --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "3. Provider-Kubernetes Objects:"
kubectl get objects --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "4. Tiered App Stack:"
kubectl get all -n tiered-app --no-headers 2>/dev/null | wc -l
echo "   resources in tiered-app namespace"
echo ""

echo "5. Multi-Environment Deployments:"
for env in dev staging prod; do
  READY=$(kubectl get deployment env-app -n platform-$env -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
  DESIRED=$(kubectl get deployment env-app -n platform-$env -o jsonpath='{.spec.replicas}' 2>/dev/null)
  echo "   platform-$env: $READY/$DESIRED ready"
done
echo ""

echo "============================================"
echo "  Verification Complete!"
echo "============================================"
```

---

## 🧹 Cleanup

```bash
# Delete managed resources
kubectl delete objects --all
kubectl delete releases --all

# Delete namespaces
kubectl delete namespace tiered-app monitoring crossplane-redis legacy-app --ignore-not-found

# Delete specific resources
kubectl delete deployment db-consumer -n platform-dev --ignore-not-found
kubectl delete deployment env-app -n platform-dev --ignore-not-found
kubectl delete deployment env-app -n platform-staging --ignore-not-found
kubectl delete deployment env-app -n platform-prod --ignore-not-found
```

---

## 📝 Key Takeaways

- **Provider-Helm** lets you manage Helm releases declaratively through Crossplane
- **Connection Details** pass credentials from provisioned resources to consumers
- **Management Policies** control the level of Crossplane management (`ObserveOnly`, `OrphanOnDelete`)
- **Resource dependencies** should be managed through ordering or composition (Lab 07)
- **Multi-environment patterns** can be templated with environment-specific values
- **Debugging** involves checking conditions, events, and provider logs
- The real power comes in Lab 07 with **Compositions** — creating reusable platform APIs

---

## 🔗 References

- [Crossplane Managed Resources](https://docs.crossplane.io/latest/concepts/managed-resources/)
- [Crossplane Management Policies](https://docs.crossplane.io/latest/concepts/managed-resources/#managementpolicies)
- [Provider-Helm Documentation](https://github.com/crossplane-contrib/provider-helm)
- [Crossplane Troubleshooting](https://docs.crossplane.io/latest/guides/troubleshoot/)

---

## ➡️ Next Lab

**[Lab 07 — Crossplane: Compositions & XRDs](lab-07-crossplane-compositions-xrds.md)**

This is the most important Crossplane lab! We'll build custom platform APIs using Composite Resource Definitions and Compositions — the core of building a platform.
