# Lab 11 — Argo CD: ApplicationSets & Multi-Cluster


## 🎯 Objectives

By the end of this lab, you will:

- Understand ApplicationSet generators (List, Git, Cluster, Matrix, Merge)
- Deploy applications across multiple targets using ApplicationSets
- Use the Git Generator for monorepo-based deployments
- Combine generators with Matrix for complex deployment patterns
- Implement Go templates for dynamic Application generation

---

## 📋 Prerequisites

- Completed **Lab 03-04** (Argo CD installed and familiar)
- Argo CD CLI authenticated

---

## 📚 Concepts

### ApplicationSet vs. Application

| Aspect | Application | ApplicationSet |
|--------|-------------|----------------|
| **Scope** | Single app → single target | Template → many apps |
| **Management** | One YAML per app | One YAML, many apps |
| **Use Case** | Individual deployments | Fleet management |
| **Scaling** | Manual | Automatic |

### Generator Types

An ApplicationSet acts as a factory that uses generators to automate Application creation:

- **Generators:** Extract configurations and parameters from external sources:
  - *List:* Iterates over a static inline array of values.
  - *Git:* Dynamically reads directories or configuration files inside a Git repository.
  - *Cluster:* Queries the clusters registered with Argo CD.
  - *Matrix/Merge:* Combines or merges output parameters from multiple generators.
- **Template Application:** Combines these generated values with a base Application definition to dynamically stamp out concrete, syncable Applications.

---

## 🔬 Hands-On Exercises

### Exercise 1: List Generator — Deploy to Multiple Environments

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: multi-env-guestbook
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - environment: dev
            replicas: "1"
            namespace: guestbook-dev
          - environment: staging
            replicas: "2"
            namespace: guestbook-staging
          - environment: prod
            replicas: "3"
            namespace: guestbook-prod
  template:
    metadata:
      name: 'guestbook-{{environment}}'
      namespace: argocd
    spec:
      project: default
      source:
        repoURL: https://github.com/argoproj/argocd-example-apps.git
        targetRevision: HEAD
        path: guestbook
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{namespace}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
EOF

# Wait and check
sleep 15
echo "=== Generated Applications ==="
argocd app list | grep guestbook

echo ""
echo "=== Namespaces ==="
kubectl get ns | grep guestbook
```

### Exercise 2: Git Generator — Directory-Based Deployments

Set up a monorepo structure where each directory is an application:

```bash
# Create a monorepo structure
mkdir -p ~/gitops-monorepo/{app-frontend,app-backend,app-worker}

# Frontend app
cat <<'EOF' > ~/gitops-monorepo/app-frontend/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: nginx:1.25-alpine
        ports:
        - containerPort: 80
        resources:
          requests: { cpu: 50m, memory: 64Mi }
EOF

# Backend app
cat <<'EOF' > ~/gitops-monorepo/app-backend/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: hashicorp/http-echo:0.2.3
        args: ["-text=Backend API", "-listen=:8080"]
        ports:
        - containerPort: 8080
        resources:
          requests: { cpu: 50m, memory: 64Mi }
EOF

# Worker app
cat <<'EOF' > ~/gitops-monorepo/app-worker/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
      - name: worker
        image: busybox:1.36
        command: ['sh', '-c', 'while true; do echo "Processing..."; sleep 30; done']
        resources:
          requests: { cpu: 50m, memory: 64Mi }
EOF

# Git Generator ApplicationSet (using example repo since we can't push)
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: monorepo-apps
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/argoproj/argocd-example-apps.git
        revision: HEAD
        directories:
          - path: "*"
          - path: "plugins"
            exclude: true
  template:
    metadata:
      name: '{{path.basename}}'
      namespace: argocd
    spec:
      project: default
      source:
        repoURL: https://github.com/argoproj/argocd-example-apps.git
        targetRevision: HEAD
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{path.basename}}'
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
EOF

sleep 10
echo "=== Generated Applications from Git Directories ==="
argocd app list | head -20
```

### Exercise 3: Matrix Generator — Combined Deployments

The Matrix generator creates the Cartesian product of two generators:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: matrix-deploy
  namespace: argocd
spec:
  generators:
    - matrix:
        generators:
          # Generator 1: Applications
          - list:
              elements:
                - app: nginx-web
                  path: guestbook
                - app: helm-demo
                  path: helm-guestbook
          # Generator 2: Environments
          - list:
              elements:
                - env: dev
                  replicas: "1"
                - env: staging
                  replicas: "2"
  template:
    metadata:
      name: '{{app}}-{{env}}'
      namespace: argocd
    spec:
      project: default
      source:
        repoURL: https://github.com/argoproj/argocd-example-apps.git
        targetRevision: HEAD
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{app}}-{{env}}'
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
EOF

sleep 10
echo "=== Matrix Generated Applications ==="
echo "Expected: 2 apps × 2 envs = 4 applications"
argocd app list | grep -E "(nginx-web|helm-demo)-(dev|staging)"
```

### Exercise 4: Go Templates for Advanced Logic

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: go-template-demo
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - list:
        elements:
          - name: web-app
            environment: dev
            team: frontend
            critical: false
          - name: api-service
            environment: prod
            team: backend
            critical: true
  template:
    metadata:
      name: '{{ .name }}-{{ .environment }}'
      namespace: argocd
      labels:
        team: '{{ .team }}'
        environment: '{{ .environment }}'
      annotations:
        notifications.argoproj.io/subscribe.on-sync-failed.slack: '{{ if eq .critical "true" }}critical-alerts{{ else }}general-alerts{{ end }}'
    spec:
      project: default
      source:
        repoURL: https://github.com/argoproj/argocd-example-apps.git
        targetRevision: HEAD
        path: guestbook
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{ .name }}-{{ .environment }}'
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
EOF

sleep 10
echo "=== Go Template Applications ==="
argocd app list | grep -E "(web-app|api-service)"
```

### Exercise 5: ApplicationSet for Platform Services

Create a standard set of platform services that every cluster should have:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: platform-services
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - name: nginx-ingress
            chart: ingress-nginx
            repo: https://kubernetes.github.io/ingress-nginx
            namespace: ingress-system
            version: "4.8.3"
            values: |
              controller:
                resources:
                  requests:
                    cpu: 50m
                    memory: 128Mi
  template:
    metadata:
      name: 'platform-{{name}}'
      namespace: argocd
      labels:
        app.kubernetes.io/part-of: platform-services
    spec:
      project: default
      source:
        repoURL: '{{repo}}'
        chart: '{{chart}}'
        targetRevision: '{{version}}'
        helm:
          releaseName: '{{name}}'
          values: '{{values}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{namespace}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
EOF

sleep 15
echo "=== Platform Services ==="
argocd app list | grep platform-
```

---

## ✅ Verification

```bash
echo "============================================"
echo "  Lab 11 — ApplicationSets Verification"
echo "============================================"
echo ""

echo "ApplicationSets:"
kubectl get applicationsets -n argocd --no-headers | while read line; do
  echo "   ✅ $line"
done
echo ""

echo "Generated Applications (count):"
argocd app list --output name 2>/dev/null | wc -l
echo "   total applications"
```

---

## 🧹 Cleanup

```bash
# Delete all ApplicationSets (this also deletes generated Applications)
kubectl delete applicationsets --all -n argocd

# Clean up namespaces
kubectl delete ns -l argocd.argoproj.io/managed-by --ignore-not-found 2>/dev/null
for ns in guestbook-dev guestbook-staging guestbook-prod; do
  kubectl delete ns $ns --ignore-not-found 2>/dev/null
done
```

---

## 📝 Key Takeaways

- **ApplicationSets** replace manual Application creation for fleet management
- **List Generator**: Static list of parameters — simplest generator
- **Git Generator**: Auto-discover apps from repo directory structure
- **Matrix Generator**: Cartesian product of two generators — deploy N apps × M targets
- **Go Templates**: Advanced logic with conditionals and functions
- ApplicationSets are essential for **platform engineering** — deploy standard services to all clusters

---

## ➡️ Next Lab

**[Lab 12 — Crossplane: Advanced Compositions & Functions](lab-12-crossplane-advanced-compositions-functions.md)**
