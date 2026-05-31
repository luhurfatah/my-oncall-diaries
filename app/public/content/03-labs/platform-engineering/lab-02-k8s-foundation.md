# Lab 02 — Kubernetes Foundation & Cluster Setup

## 🎯 Objectives

By the end of this lab, you will:

- Understand Kubernetes architecture and core components
- Set up a working Kubernetes cluster in your Pluralsight sandbox
- Deploy, expose, and manage workloads
- Work with namespaces, labels, and selectors
- Understand RBAC basics
- Install Helm and deploy your first chart
- Be fully prepared for the remaining 13 labs

---

## 📋 Prerequisites

- Completed **Lab 01** (conceptual understanding)
- Pluralsight Cloud Sandbox environment active
- Basic command-line experience

---

## 🏗️ Architecture

A Kubernetes cluster is divided into two primary planes that decouple management from workload execution:

### 1. Control Plane (The Brain)
Coordinates all cluster operations and maintains desired resource state:
- **API Server:** The front entry point of the cluster; accepts and validates administrative commands.
- **etcd:** Consistent, highly available key-value store containing all cluster backing state.
- **Controller Manager:** Continuously observes the cluster state and runs control loops to reconcile deltas.
- **Scheduler:** Selects the healthiest and most appropriate worker node to run unscheduled Pods.

### 2. Worker Nodes (The Muscle)
Host the actual containers and workloads:
- **Worker Nodes (Node 1 / Node 2):** Individual machine instances containing workloads.
- **Pods (Pod A / Pod B / Pod C / Pod D):** The atomic unit of container execution.
- **kubelet:** Node-level agent ensuring declared containers are running and healthy inside their pods.
- **kube-proxy:** Manages network connection routing rules across host interfaces.

---

## 📚 Concepts

### Kubernetes Core Components

| Component | Role |
|-----------|------|
| **API Server** | The front door to the cluster; all requests go through it |
| **etcd** | Distributed key-value store; holds all cluster state |
| **Controller Manager** | Runs controllers that reconcile desired vs. actual state |
| **Scheduler** | Decides which node runs each pod |
| **kubelet** | Agent on each node; ensures containers are running |
| **kube-proxy** | Handles network routing for Services |

### Key Kubernetes Resources

| Resource | Purpose | Example |
|----------|---------|---------|
| **Pod** | Smallest deployable unit (1+ containers) | A single instance of your app |
| **Deployment** | Manages ReplicaSets, handles rolling updates | Run 3 replicas of nginx |
| **Service** | Stable network endpoint for pods | ClusterIP, NodePort, LoadBalancer |
| **ConfigMap** | Store non-sensitive configuration | App settings, feature flags |
| **Secret** | Store sensitive data | Passwords, API keys |
| **Namespace** | Virtual cluster isolation | dev, staging, prod |
| **Ingress** | HTTP routing to Services | Route `/api` to backend service |

---

## 🔬 Hands-On Exercises

### Exercise 1: Verify Your Cluster

Your Pluralsight sandbox should provide a Kubernetes cluster. Let's verify it's ready.

```bash
# Check kubectl is installed
kubectl version --client

# Check cluster connectivity
kubectl cluster-info

# View cluster nodes
kubectl get nodes -o wide

# Check all system pods are running
kubectl get pods -n kube-system
```

**Expected Output:**
```
NAME                   STATUS   ROLES           AGE   VERSION
node-1                 Ready    control-plane   10m   v1.28.x
node-2                 Ready    <none>          10m   v1.28.x
```

> 💡 **Pluralsight Sandbox Tip**: If your sandbox provides a cloud-managed cluster (EKS/AKS/GKE), the control plane nodes won't be visible — that's normal. You'll see only worker nodes.

```bash
# Check available API resources (this list will grow as we add Crossplane & Argo CD)
kubectl api-resources | head -30

# Check current context
kubectl config current-context

# View cluster configuration
kubectl config view --minify
```

---

### Exercise 2: Working with Namespaces

Namespaces are essential for multi-tenancy — we'll use them extensively in later labs.

```bash
# List existing namespaces
kubectl get namespaces

# Create namespaces for our lab work
kubectl create namespace platform-dev
kubectl create namespace platform-staging
kubectl create namespace platform-prod

# Verify
kubectl get namespaces

# Set a default namespace to avoid typing -n every time
kubectl config set-context --current --namespace=platform-dev

# Verify the context change
kubectl config view --minify | grep namespace
```

**Label your namespaces** (important for later labs with Argo CD):

```bash
kubectl label namespace platform-dev environment=dev tier=development
kubectl label namespace platform-staging environment=staging tier=non-production
kubectl label namespace platform-prod environment=prod tier=production

# View labels
kubectl get namespaces --show-labels
```

---

### Exercise 3: Deploy Your First Application

Let's deploy a sample application to understand the deployment lifecycle.

#### Step 1: Create a Deployment

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-platform
  namespace: platform-dev
  labels:
    app: hello-platform
    managed-by: manual
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hello-platform
  template:
    metadata:
      labels:
        app: hello-platform
        version: v1
    spec:
      containers:
      - name: hello
        image: hashicorp/http-echo:0.2.3
        args:
          - "-text=Hello from Platform Engineering Lab!"
          - "-listen=:8080"
        ports:
        - containerPort: 8080
          name: http
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
        readinessProbe:
          httpGet:
            path: /
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 30
EOF
```

#### Step 2: Watch the Deployment Roll Out

```bash
# Watch the rollout status
kubectl rollout status deployment/hello-platform -n platform-dev

# View the deployment details
kubectl get deployment hello-platform -n platform-dev -o wide

# View the pods created
kubectl get pods -n platform-dev -l app=hello-platform

# Describe a pod for detailed information
kubectl describe pod -n platform-dev -l app=hello-platform | head -50

# View pod logs
kubectl logs -n platform-dev -l app=hello-platform --all-containers
```

#### Step 3: Expose with a Service

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: hello-platform-svc
  namespace: platform-dev
  labels:
    app: hello-platform
spec:
  type: ClusterIP
  selector:
    app: hello-platform
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
    name: http
EOF
```

```bash
# Verify the service
kubectl get svc -n platform-dev

# Test the service using port-forward
kubectl port-forward svc/hello-platform-svc 8080:80 -n platform-dev &

# Wait a moment, then test
sleep 2
curl http://localhost:8080

# Stop the port-forward
kill %1
```

**Expected Output:**
```
Hello from Platform Engineering Lab!
```

---

### Exercise 4: ConfigMaps and Secrets

#### ConfigMap

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: platform-config
  namespace: platform-dev
data:
  ENVIRONMENT: "development"
  LOG_LEVEL: "debug"
  FEATURE_FLAGS: |
    enable_new_ui=true
    enable_beta_api=false
    max_retries=3
  app-config.yaml: |
    server:
      port: 8080
      host: 0.0.0.0
    database:
      host: postgres.platform-dev.svc.cluster.local
      port: 5432
      name: platform_db
EOF

# View the configmap
kubectl get configmap platform-config -n platform-dev -o yaml
```

#### Secret

```bash
# Create a secret (values are base64 encoded automatically with --from-literal)
kubectl create secret generic platform-secrets \
  -n platform-dev \
  --from-literal=db-password='P@ssw0rd123!' \
  --from-literal=api-key='sk-1234567890abcdef'

# View the secret (values are base64 encoded)
kubectl get secret platform-secrets -n platform-dev -o yaml

# Decode a secret value
kubectl get secret platform-secrets -n platform-dev \
  -o jsonpath='{.data.db-password}' | base64 -d
echo  # newline
```

---

### Exercise 5: Using ConfigMaps and Secrets in Pods

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: configmap-demo
  namespace: platform-dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: configmap-demo
  template:
    metadata:
      labels:
        app: configmap-demo
    spec:
      containers:
      - name: demo
        image: busybox:1.36
        command: ['sh', '-c']
        args:
        - |
          echo "=== Environment Variables ==="
          echo "ENVIRONMENT: $ENVIRONMENT"
          echo "LOG_LEVEL: $LOG_LEVEL"
          echo "DB_PASSWORD: $DB_PASSWORD"
          echo ""
          echo "=== Mounted Config File ==="
          cat /config/app-config.yaml
          echo ""
          echo "=== Feature Flags ==="
          cat /config/FEATURE_FLAGS
          sleep 3600
        env:
        - name: ENVIRONMENT
          valueFrom:
            configMapKeyRef:
              name: platform-config
              key: ENVIRONMENT
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: platform-config
              key: LOG_LEVEL
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: platform-secrets
              key: db-password
        volumeMounts:
        - name: config-volume
          mountPath: /config
          readOnly: true
      volumes:
      - name: config-volume
        configMap:
          name: platform-config
EOF

# Wait for the pod to start
kubectl wait --for=condition=ready pod -l app=configmap-demo -n platform-dev --timeout=60s

# View the output
kubectl logs -n platform-dev -l app=configmap-demo
```

---

### Exercise 6: Rolling Updates and Rollbacks

```bash
# Update the hello-platform deployment to v2
kubectl set image deployment/hello-platform \
  hello=hashicorp/http-echo:0.2.3 \
  -n platform-dev

# Change the text to simulate a v2 release
kubectl patch deployment hello-platform -n platform-dev --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":["-text=Hello from Platform Engineering v2!","-listen=:8080"]}]'

# Watch the rolling update
kubectl rollout status deployment/hello-platform -n platform-dev

# Check rollout history
kubectl rollout history deployment/hello-platform -n platform-dev

# Rollback to previous version
kubectl rollout undo deployment/hello-platform -n platform-dev

# Verify rollback
kubectl rollout status deployment/hello-platform -n platform-dev

# Test the service
kubectl port-forward svc/hello-platform-svc 8080:80 -n platform-dev &
sleep 2
curl http://localhost:8080
kill %1
```

---

### Exercise 7: Install Helm

Helm is the package manager for Kubernetes — we'll use it to install Argo CD, Crossplane, and Backstage.

```bash
# Install Helm (if not already installed)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify installation
helm version

# Add common Helm repositories (we'll need these in future labs)
helm repo add stable https://charts.helm.sh/stable
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add argo https://argoproj.github.io/argo-helm
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo add backstage https://backstage.github.io/charts

# Update repo cache
helm repo update

# List added repos
helm repo list
```

#### Deploy a Chart (nginx as example)

```bash
# Search for nginx charts
helm search repo bitnami/nginx

# Install nginx with custom values
helm install my-nginx bitnami/nginx \
  --namespace platform-dev \
  --set service.type=ClusterIP \
  --set replicaCount=2

# Check the installation
helm list -n platform-dev

# View the deployed resources
kubectl get all -n platform-dev -l app.kubernetes.io/instance=my-nginx

# View the rendered manifests (useful for debugging)
helm get manifest my-nginx -n platform-dev | head -50

# Uninstall when done
helm uninstall my-nginx -n platform-dev
```

---

### Exercise 8: Resource Quotas and Limits (Governance Basics)

This is a preview of platform governance — controlling what developers can deploy.

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: dev-quota
  namespace: platform-dev
spec:
  hard:
    requests.cpu: "2"
    requests.memory: 2Gi
    limits.cpu: "4"
    limits.memory: 4Gi
    pods: "20"
    services: "10"
    configmaps: "20"
    secrets: "20"
    persistentvolumeclaims: "5"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: dev-limits
  namespace: platform-dev
spec:
  limits:
  - default:
      cpu: 200m
      memory: 256Mi
    defaultRequest:
      cpu: 100m
      memory: 128Mi
    max:
      cpu: "1"
      memory: 1Gi
    min:
      cpu: 50m
      memory: 64Mi
    type: Container
EOF

# View the quota
kubectl get resourcequota -n platform-dev
kubectl describe resourcequota dev-quota -n platform-dev

# View the limit range
kubectl get limitrange -n platform-dev
kubectl describe limitrange dev-limits -n platform-dev
```

---

### Exercise 9: RBAC Basics

Understanding RBAC is critical for platform engineering — you'll control who can do what.

```bash
# Create a ServiceAccount for a "developer" persona
kubectl create serviceaccount developer -n platform-dev

# Create a Role with limited permissions
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer-role
  namespace: platform-dev
rules:
- apiGroups: [""]
  resources: ["pods", "services", "configmaps"]
  verbs: ["get", "list", "watch", "create", "update", "delete"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "watch", "create", "update", "delete"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]  # Can read but NOT create/delete secrets
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: developer-binding
  namespace: platform-dev
subjects:
- kind: ServiceAccount
  name: developer
  namespace: platform-dev
roleRef:
  kind: Role
  name: developer-role
  apiGroup: rbac.authorization.k8s.io
EOF

# Verify the RBAC setup
kubectl auth can-i create pods --namespace=platform-dev --as=system:serviceaccount:platform-dev:developer
# Should output: yes

kubectl auth can-i delete secrets --namespace=platform-dev --as=system:serviceaccount:platform-dev:developer
# Should output: no

kubectl auth can-i create pods --namespace=platform-prod --as=system:serviceaccount:platform-dev:developer
# Should output: no
```

---

### Exercise 10: Declarative Management with YAML Files

In GitOps (Lab 03+), everything is in YAML files in Git. Let's practice the declarative approach.

```bash
# Create a directory for our manifests
mkdir -p ~/platform-manifests/base

# Create a complete application manifest
cat <<'EOF' > ~/platform-manifests/base/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: sample-app
  labels:
    app: sample-app
    managed-by: platform-team
EOF

cat <<'EOF' > ~/platform-manifests/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-app
  namespace: sample-app
  labels:
    app: sample-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: sample-app
  template:
    metadata:
      labels:
        app: sample-app
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
            cpu: 100m
            memory: 128Mi
EOF

cat <<'EOF' > ~/platform-manifests/base/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: sample-app
  namespace: sample-app
spec:
  selector:
    app: sample-app
  ports:
  - port: 80
    targetPort: 80
  type: ClusterIP
EOF

# Apply all manifests at once (declarative!)
kubectl apply -f ~/platform-manifests/base/

# Verify
kubectl get all -n sample-app

# This is the pattern Argo CD uses — apply manifests from a directory
```

---

## ✅ Verification & Testing

Run this verification script to confirm your lab environment is ready:

```bash
echo "============================================"
echo "  Lab 02 Environment Verification"
echo "============================================"
echo ""

# Check cluster
echo "1. Cluster Status:"
kubectl cluster-info 2>/dev/null && echo "   ✅ Cluster is accessible" || echo "   ❌ Cluster not accessible"
echo ""

# Check nodes
echo "2. Nodes:"
NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l)
echo "   Found $NODE_COUNT node(s)"
kubectl get nodes --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

# Check namespaces
echo "3. Lab Namespaces:"
for ns in platform-dev platform-staging platform-prod; do
  kubectl get namespace $ns --no-headers 2>/dev/null && echo "   ✅ $ns exists" || echo "   ❌ $ns missing"
done
echo ""

# Check deployments
echo "4. Deployments in platform-dev:"
kubectl get deployments -n platform-dev --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

# Check Helm
echo "5. Helm:"
helm version --short 2>/dev/null && echo "   ✅ Helm is installed" || echo "   ❌ Helm not installed"
echo ""

# Check Helm repos
echo "6. Helm Repos:"
for repo in argo crossplane-stable backstage; do
  helm repo list 2>/dev/null | grep -q $repo && echo "   ✅ $repo repo added" || echo "   ❌ $repo repo missing"
done
echo ""

echo "============================================"
echo "  Verification Complete!"
echo "============================================"
```

---

## 🧹 Cleanup

> ⚠️ **Don't clean up yet!** Keep your namespaces and Helm repos — we'll use them in the next labs.

If you need to clean up for any reason:

```bash
# Remove lab resources (keep namespaces)
kubectl delete deployment hello-platform configmap-demo -n platform-dev
kubectl delete svc hello-platform-svc -n platform-dev
kubectl delete configmap platform-config -n platform-dev
kubectl delete secret platform-secrets -n platform-dev
kubectl delete resourcequota dev-quota -n platform-dev
kubectl delete limitrange dev-limits -n platform-dev
kubectl delete serviceaccount developer -n platform-dev
kubectl delete role developer-role -n platform-dev
kubectl delete rolebinding developer-binding -n platform-dev
kubectl delete -f ~/platform-manifests/base/
```

---

## 📝 Key Takeaways

- **Kubernetes is the foundation** — Argo CD, Crossplane, and Backstage all run on top of it
- **Declarative YAML** is the pattern — you describe desired state, Kubernetes reconciles
- **Namespaces** provide isolation — critical for multi-tenancy in platform engineering
- **RBAC** controls access — platform teams define what developers can do
- **Helm** is the package manager — we'll install all our tools using Helm charts
- **Resource Quotas** enforce governance — prevent runaway resource consumption
- **Labels and Selectors** are how Kubernetes (and our tools) organize and target resources

---

## 🔗 References

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Kubernetes Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
- [Pluralsight Cloud Labs Guide](https://www.pluralsight.com/cloud-labs)

---

## ➡️ Next Lab

**[Lab 03 — GitOps with Argo CD: Installation & Basics](lab-03-gitops-argocd-basics.md)**

Now that our Kubernetes foundation is solid, we'll install Argo CD and experience the power of GitOps firsthand.
