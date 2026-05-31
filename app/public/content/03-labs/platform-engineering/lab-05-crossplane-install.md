# Lab 05 — Crossplane: Installation & First Provider


## 🎯 Objectives

By the end of this lab, you will:

- Understand the Crossplane architecture and how it extends Kubernetes
- Install Crossplane on your cluster using Helm
- Understand Providers, Managed Resources, and ProviderConfigs
- Install and configure Provider-Kubernetes
- Install and configure Provider-Helm
- Create your first Managed Resources using Crossplane
- Use the Crossplane CLI for debugging and inspection

---

## 📋 Prerequisites

- Completed **Lab 02** (running Kubernetes cluster with Helm)
- `kubectl` and `helm` installed
- Basic understanding of Kubernetes CRDs

---

## 🏗️ Architecture

Crossplane extends a Kubernetes cluster into a universal control plane:

- **Crossplane Core:**
  - **Crossplane Pod:** The core reconciliation engine driving state sync.
  - **RBAC Manager Pod:** Manages the service accounts and RBAC permissions needed by installed providers.
- **Provider Runtime:** Custom controllers installed as plugins (e.g., Kubernetes, Helm, AWS/Azure/GCP Providers).
- **Target Resources:** Managed resources created by providers, including in-cluster Kubernetes resources, Helm releases, and external cloud resources.

---

## 📚 Concepts

### How Crossplane Works

Crossplane extends Kubernetes with **Custom Resource Definitions (CRDs)** that represent external resources. When you create a CRD instance, a Crossplane **Provider** reconciles it against the external API.

```
Traditional Way:                    Crossplane Way:
────────────────                    ────────────────
aws s3 mb s3://my-bucket            kubectl apply -f bucket.yaml
terraform apply                     
aws rds create-db-instance          (Crossplane reconciles continuously)
```

### Key Concepts

| Concept | Description | Analogy |
|---------|-------------|---------|
| **Provider** | A plugin that knows how to manage a specific API (AWS, Azure, K8s, Helm) | A device driver |
| **ProviderConfig** | Credentials and settings for a Provider | Connection string |
| **Managed Resource (MR)** | A single external resource managed by Crossplane | `aws_s3_bucket` in Terraform |
| **Composite Resource Definition (XRD)** | Custom API schema you define (Lab 07) | Terraform module interface |
| **Composition** | Maps an XRD to actual Managed Resources (Lab 07) | Terraform module implementation |
| **Claim (XRC)** | Developer-facing request for a Composite Resource (Lab 07) | `terraform apply` with variables |

### The Crossplane Control Loop

1. **Apply Manifest:** Developer creates or updates a Managed Resource (e.g., `kubectl apply -f bucket.yaml`).
2. **Detect Change:** The Crossplane Provider controller watches the custom resource and detects the update.
3. **API Invocation:** The Provider calls the target API (e.g., AWS API) to provision or update the external resource.
4. **Update Status:** The Provider updates the Kubernetes Custom Resource status with the current state of the external resource.
5. **Continuous Loop:** The reconciliation loop runs periodically (drift detection and correction).
6. **Self-Healing:** If the external resource is modified manually, the next reconciliation loop corrects the drift back to the state declared in Git.

---

## 🔬 Hands-On Exercises

### Exercise 1: Install Crossplane

#### Step 1: Create the Crossplane Namespace and Install

```bash
# Create namespace
kubectl create namespace crossplane-system

# Install Crossplane using Helm
helm install crossplane crossplane-stable/crossplane \
  --namespace crossplane-system \
  --wait --timeout 300s

# Verify the installation
kubectl get pods -n crossplane-system

# Expected output:
# NAME                                      READY   STATUS    RESTARTS   AGE
# crossplane-xxxxxxxxx-xxxxx                1/1     Running   0          60s
# crossplane-rbac-manager-xxxxxxxxx-xxxxx   1/1     Running   0          60s
```

#### Step 2: Verify Crossplane CRDs

```bash
# Crossplane installs several CRDs
kubectl get crds | grep crossplane

# You should see:
# compositeresourcedefinitions.apiextensions.crossplane.io
# compositionrevisions.apiextensions.crossplane.io
# compositions.apiextensions.crossplane.io
# configurationrevisions.pkg.crossplane.io
# configurations.pkg.crossplane.io
# ...and more

# Check the Crossplane API resources
kubectl api-resources | grep crossplane
```

#### Step 3: Install the Crossplane CLI (Optional but Recommended)

```bash
# Install the Crossplane CLI
curl -sL "https://raw.githubusercontent.com/crossplane/crossplane/master/install.sh" | sh
sudo mv crossplane /usr/local/bin/

# Verify
crossplane --version 2>/dev/null || echo "CLI installed (version may not display)"
```

---

### Exercise 2: Install Provider-Kubernetes

Provider-Kubernetes allows Crossplane to manage Kubernetes resources — perfect for learning without cloud credentials.

#### Step 1: Install the Provider

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-kubernetes
spec:
  package: xpkg.upbound.io/crossplane-contrib/provider-kubernetes:v0.14.1
EOF

# Wait for the provider to become healthy
echo "Waiting for Provider-Kubernetes to be installed..."
kubectl wait --for=condition=Healthy provider/provider-kubernetes --timeout=180s

# Check provider status
kubectl get providers
```

**Expected Output:**
```
NAME                  INSTALLED   HEALTHY   PACKAGE                                                         AGE
provider-kubernetes   True        True      xpkg.upbound.io/crossplane-contrib/provider-kubernetes:v0.14.1  60s
```

#### Step 2: Check the CRDs Added by the Provider

```bash
# Provider-Kubernetes adds CRDs for managing K8s resources
kubectl get crds | grep kubernetes.crossplane.io

# You should see:
# objects.kubernetes.crossplane.io
# providerconfigs.kubernetes.crossplane.io
# ...
```

#### Step 3: Configure the Provider

```bash
# Create a ProviderConfig that uses the Crossplane ServiceAccount
# (it already has access to the cluster)
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha1
kind: ProviderConfig
metadata:
  name: kubernetes-provider
spec:
  credentials:
    source: InjectedIdentity
EOF

# Verify the ProviderConfig
kubectl get providerconfig
```

---

### Exercise 3: Create Your First Managed Resource

Let's use Provider-Kubernetes to create a Kubernetes Namespace via Crossplane:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: crossplane-demo-namespace
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Namespace
      metadata:
        name: crossplane-demo
        labels:
          created-by: crossplane
          managed-by: provider-kubernetes
EOF

# Check the managed resource status
kubectl get object crossplane-demo-namespace

# Verify the namespace was created
kubectl get namespace crossplane-demo --show-labels
```

**Expected Output:**
```
NAME                        SYNCED   READY   AGE
crossplane-demo-namespace   True     True    30s
```

> 💡 **Key Insight**: The namespace was created by Crossplane, not by `kubectl create namespace`. Crossplane manages its lifecycle — if someone deletes the namespace manually, Crossplane will recreate it!

#### Test Self-Healing

```bash
# Delete the namespace manually
kubectl delete namespace crossplane-demo

# Wait 15-30 seconds for Crossplane to detect and fix the drift
sleep 20

# Check — Crossplane should have recreated it!
kubectl get namespace crossplane-demo
```

---

### Exercise 4: Create Multiple Resources with Crossplane

Let's create a full application stack using Provider-Kubernetes:

```bash
# Create a ConfigMap via Crossplane
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: demo-configmap
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: app-config
        namespace: crossplane-demo
      data:
        APP_NAME: "Crossplane Demo App"
        ENVIRONMENT: "development"
        LOG_LEVEL: "info"
EOF

# Create a Deployment via Crossplane
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: demo-deployment
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: crossplane-app
        namespace: crossplane-demo
        labels:
          app: crossplane-app
      spec:
        replicas: 2
        selector:
          matchLabels:
            app: crossplane-app
        template:
          metadata:
            labels:
              app: crossplane-app
          spec:
            containers:
            - name: app
              image: hashicorp/http-echo:0.2.3
              args:
                - "-text=Managed by Crossplane! 🚀"
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
                limits:
                  cpu: 100m
                  memory: 128Mi
EOF

# Create a Service via Crossplane
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: demo-service
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Service
      metadata:
        name: crossplane-app
        namespace: crossplane-demo
      spec:
        selector:
          app: crossplane-app
        ports:
        - port: 80
          targetPort: 8080
        type: ClusterIP
EOF

# Check all managed resources
kubectl get objects

# Verify the actual resources
kubectl get all -n crossplane-demo
```

---

### Exercise 5: Install Provider-Helm

Provider-Helm allows Crossplane to install Helm charts as managed resources.

```bash
# Install Provider-Helm
cat <<'EOF' | kubectl apply -f -
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-helm
spec:
  package: xpkg.upbound.io/crossplane-contrib/provider-helm:v0.19.0
EOF

# Wait for installation
echo "Waiting for Provider-Helm to be installed..."
kubectl wait --for=condition=Healthy provider/provider-helm --timeout=180s

# Check all providers
kubectl get providers
```

#### Configure Provider-Helm

```bash
# Grant the Provider-Helm ServiceAccount cluster-admin
# (in production, use least-privilege RBAC)

# First, find the provider-helm ServiceAccount
SA=$(kubectl get sa -n crossplane-system -o name | grep provider-helm | head -1)
echo "Provider-Helm ServiceAccount: $SA"

# Create ClusterRoleBinding
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: provider-helm-admin
subjects:
  - kind: ServiceAccount
    name: provider-helm-*
    namespace: crossplane-system
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
EOF

# Alternative: Find exact SA name and bind
HELM_SA=$(kubectl get sa -n crossplane-system -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep provider-helm | head -1)
if [ -n "$HELM_SA" ]; then
  kubectl create clusterrolebinding provider-helm-admin-exact \
    --clusterrole=cluster-admin \
    --serviceaccount=crossplane-system:$HELM_SA \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# Create ProviderConfig for Helm
cat <<'EOF' | kubectl apply -f -
apiVersion: helm.crossplane.io/v1beta1
kind: ProviderConfig
metadata:
  name: helm-provider
spec:
  credentials:
    source: InjectedIdentity
EOF
```

---

### Exercise 6: Deploy a Helm Chart via Crossplane

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: helm.crossplane.io/v1beta1
kind: Release
metadata:
  name: redis-crossplane
spec:
  providerConfigRef:
    name: helm-provider
  forProvider:
    chart:
      name: redis
      repository: https://charts.bitnami.com/bitnami
      version: "18.6.1"
    namespace: crossplane-redis
    values:
      architecture: standalone
      auth:
        enabled: false
      master:
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
      replica:
        replicaCount: 0
    set:
      - name: master.persistence.enabled
        value: "false"
EOF

# Wait for the release to be ready
echo "Waiting for Redis Helm release..."
sleep 30
kubectl get release redis-crossplane

# Check the deployed resources
kubectl get all -n crossplane-redis
```

---

### Exercise 7: Install Provider-AWS (Pluralsight Sandbox)

If your Pluralsight sandbox provides AWS credentials, let's set up Provider-AWS:

```bash
# Install Provider-AWS (family providers for individual services)
cat <<'EOF' | kubectl apply -f -
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-s3
spec:
  package: xpkg.upbound.io/upbound/provider-aws-s3:v1.14.0
EOF

# Wait for installation
echo "Waiting for Provider-AWS-S3 to be installed..."
kubectl wait --for=condition=Healthy provider/provider-aws-s3 --timeout=300s

kubectl get providers
```

#### Configure AWS Credentials

```bash
# Check if AWS credentials are available in the sandbox
if [ -f ~/.aws/credentials ] || [ -n "$AWS_ACCESS_KEY_ID" ]; then
  echo "AWS credentials found!"
  
  # Create credentials secret from environment variables
  if [ -n "$AWS_ACCESS_KEY_ID" ]; then
    cat <<EOF > /tmp/aws-credentials.txt
[default]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
EOF
  else
    cp ~/.aws/credentials /tmp/aws-credentials.txt
  fi

  # Create Kubernetes secret
  kubectl create secret generic aws-creds \
    -n crossplane-system \
    --from-file=credentials=/tmp/aws-credentials.txt

  # Clean up temp file
  rm /tmp/aws-credentials.txt

  # Create ProviderConfig
  cat <<EOF | kubectl apply -f -
apiVersion: aws.upbound.io/v1beta1
kind: ProviderConfig
metadata:
  name: aws-provider
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: aws-creds
      key: credentials
EOF

  echo "✅ AWS Provider configured!"
else
  echo "⚠️  No AWS credentials found. Skipping AWS provider setup."
  echo "    You can still use Provider-Kubernetes and Provider-Helm."
fi
```

#### Create an S3 Bucket (if AWS is available)

```bash
# Only run this if AWS credentials are configured
cat <<'EOF' | kubectl apply -f -
apiVersion: s3.aws.upbound.io/v1beta2
kind: Bucket
metadata:
  name: platform-lab-bucket
spec:
  providerConfigRef:
    name: aws-provider
  forProvider:
    region: us-east-1
    tags:
      Environment: lab
      ManagedBy: crossplane
      Project: platform-engineering
EOF

# Check the status
kubectl get bucket platform-lab-bucket

# Describe for detailed status
kubectl describe bucket platform-lab-bucket
```

> 💡 **Note**: If your sandbox doesn't have AWS, that's fine! Provider-Kubernetes and Provider-Helm are sufficient for learning Crossplane concepts. We'll use them for Compositions in Lab 07.

---

### Exercise 8: Inspect and Debug Crossplane Resources

```bash
# List all managed resources across all providers
kubectl get managed

# Get detailed events for a resource
kubectl describe object crossplane-demo-namespace

# Check Crossplane logs for debugging
kubectl logs -n crossplane-system -l app=crossplane --tail=50

# Check provider logs
kubectl logs -n crossplane-system -l pkg.crossplane.io/revision -c provider --tail=50

# View all Crossplane conditions
kubectl get objects -o custom-columns=\
NAME:.metadata.name,\
SYNCED:.status.conditions[0].status,\
READY:.status.conditions[1].status,\
AGE:.metadata.creationTimestamp

# Use the Crossplane CLI (if installed)
crossplane xpkg list 2>/dev/null || echo "Use 'kubectl get providers' instead"
```

---

### Exercise 9: Understanding Resource Lifecycle

```bash
# Crossplane resources have a lifecycle:
# 1. Creating → 2. Synced/Ready → 3. Updated → 4. Deleted

# Update a managed resource
kubectl patch object demo-deployment --type=merge -p '{
  "spec": {
    "forProvider": {
      "manifest": {
        "spec": {
          "replicas": 3
        }
      }
    }
  }
}'

# Crossplane will reconcile the change
sleep 10
kubectl get deployment crossplane-app -n crossplane-demo

# Delete a managed resource (this deletes the external resource too!)
# Let's delete the ConfigMap managed resource
kubectl delete object demo-configmap

# Verify the ConfigMap is gone from the cluster
kubectl get configmap app-config -n crossplane-demo
# Should show: not found
```

> ⚠️ **Important**: Deleting a Managed Resource also deletes the external resource it manages! This is called the **deletion policy**. You can change this behavior with `deletionPolicy: Orphan` to leave the external resource when the MR is deleted.

```bash
# Example of Orphan deletion policy
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: orphan-test
spec:
  providerConfigRef:
    name: kubernetes-provider
  deletionPolicy: Orphan
  forProvider:
    manifest:
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: orphan-test
        namespace: crossplane-demo
      data:
        will-survive: "true"
EOF

# Wait for sync
sleep 10

# Delete the managed resource
kubectl delete object orphan-test

# The ConfigMap should still exist!
kubectl get configmap orphan-test -n crossplane-demo
```

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 05 — Crossplane Verification"
echo "============================================"
echo ""

echo "1. Crossplane Core:"
kubectl get pods -n crossplane-system --no-headers | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "2. Installed Providers:"
kubectl get providers --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "3. Provider Configs:"
kubectl get providerconfigs --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "4. Managed Resources (Objects):"
kubectl get objects --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "5. Helm Releases:"
kubectl get releases --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "6. Crossplane-Managed Workloads:"
kubectl get all -n crossplane-demo --no-headers 2>/dev/null | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "============================================"
echo "  Verification Complete!"
echo "============================================"
```

---

## 🧹 Cleanup

> ⚠️ **Keep Crossplane installed** — we'll use it in Labs 06, 07, 10, 12, and 14!

To clean up only lab resources:

```bash
# Delete managed resources (this also deletes the external resources)
kubectl delete objects --all
kubectl delete releases --all

# Delete the S3 bucket if created
kubectl delete bucket platform-lab-bucket --ignore-not-found

# Delete namespaces created by Crossplane
kubectl delete namespace crossplane-demo --ignore-not-found
kubectl delete namespace crossplane-redis --ignore-not-found
```

---

## 📝 Key Takeaways

- **Crossplane extends Kubernetes** with CRDs that represent external resources
- **Providers** are plugins that know how to manage specific APIs (AWS, Helm, K8s)
- **ProviderConfigs** hold credentials for providers
- **Managed Resources** are individual external resources (like a single S3 bucket or namespace)
- **Provider-Kubernetes** manages K8s resources — great for learning and in-cluster management
- **Provider-Helm** manages Helm releases as Crossplane resources
- **Self-healing** works out of the box — Crossplane continuously reconciles drift
- **Deletion policies** control what happens when you delete a Managed Resource
- In the next labs, we'll learn **Compositions** — the real power of Crossplane for platform engineering

---

## 🔗 References

- [Crossplane Official Documentation](https://crossplane.io/docs/)
- [Crossplane Providers](https://marketplace.upbound.io/providers)
- [Provider-Kubernetes](https://github.com/crossplane-contrib/provider-kubernetes)
- [Provider-Helm](https://github.com/crossplane-contrib/provider-helm)
- [Upbound Provider AWS](https://marketplace.upbound.io/providers/upbound/provider-family-aws)
- [Crossplane CLI](https://docs.crossplane.io/latest/cli/)

---

## ➡️ Next Lab

**[Lab 06 — Crossplane: Managing Resources](lab-06-crossplane-managed-resources.md)**

We'll go deeper into managing real cloud resources, work with Provider-Helm for application deployment, and prepare for the Compositions lab.
