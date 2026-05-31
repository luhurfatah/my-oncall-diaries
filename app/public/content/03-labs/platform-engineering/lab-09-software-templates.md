# Lab 09 — Backstage: Software Templates (Golden Paths)


## 🎯 Objectives

By the end of this lab, you will:

- Understand the Backstage Scaffolder and template structure
- Build a Software Template to create a new microservice
- Use template parameters (forms), steps (actions), and outputs
- Use built-in actions: `fetch:template`, `catalog:register`, `debug:log`
- Create a skeleton project with templated files
- Test templates using the Scaffolder UI and Dry Run

---

## 📋 Prerequisites

- Completed **Lab 08** (Backstage app created and running)
- Backstage app at `~/platform-portal`

---

## 📚 Concepts

### Software Template Structure

```
template/
├── template.yaml          # Template definition (parameters, steps, output)
└── skeleton/              # Files to generate
    ├── catalog-info.yaml  # Auto-registers the new service
    ├── README.md          # Project readme
    ├── Dockerfile         # Container build file
    ├── k8s/
    │   ├── deployment.yaml
    │   └── service.yaml
    └── src/
        └── main.py        # Application code
```

### Template YAML Structure

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: template-name
  title: Human Readable Title
  description: What this template creates
spec:
  owner: team-name
  type: service
  parameters:        # ← UI form definition (JSON Schema)
    - title: Step 1
      properties:
        name:
          type: string
  steps:             # ← Actions to execute
    - id: fetch
      action: fetch:template
      input: ...
  output:            # ← Links shown after completion
    links:
      - title: Repository
        url: ${{ steps.publish.output.remoteUrl }}
```

---

## 🔬 Hands-On Exercises

### Exercise 1: Create a Simple Template

```bash
mkdir -p ~/platform-portal/templates/new-service/skeleton/{k8s,src}

# Create the template definition
cat <<'TMPL' > ~/platform-portal/templates/new-service/template.yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: new-microservice
  title: Create a New Microservice
  description: |
    Scaffolds a new microservice with Kubernetes manifests, Dockerfile,
    and auto-registration in the Backstage catalog.
  tags:
    - microservice
    - python
    - kubernetes
    - recommended
spec:
  owner: platform-team
  type: service

  # ──────────────────────────────────────
  # PARAMETERS — Define the UI form
  # ──────────────────────────────────────
  parameters:
    - title: Service Information
      required:
        - serviceName
        - owner
        - description
      properties:
        serviceName:
          title: Service Name
          type: string
          description: Unique name for the service (lowercase, hyphens allowed)
          pattern: '^[a-z][a-z0-9-]*$'
          ui:autofocus: true
          ui:help: 'Must start with a letter. Only lowercase letters, numbers, and hyphens.'
        description:
          title: Description
          type: string
          description: A brief description of what this service does
        owner:
          title: Owner
          type: string
          description: Team that owns this service
          enum:
            - platform-team
            - backend-team
            - frontend-team
          default: backend-team

    - title: Technical Configuration
      required:
        - language
        - port
      properties:
        language:
          title: Programming Language
          type: string
          enum:
            - python
            - node
            - go
          default: python
          description: Primary language for the service
        port:
          title: Service Port
          type: integer
          default: 8080
          description: Port the service listens on
        environment:
          title: Target Environment
          type: string
          enum:
            - dev
            - staging
            - prod
          default: dev
        replicas:
          title: Number of Replicas
          type: integer
          default: 1
          minimum: 1
          maximum: 5
          description: Number of pod replicas

    - title: Features
      properties:
        includeDatabase:
          title: Include Database
          type: boolean
          default: false
          description: Add a PostgreSQL database dependency
        includeMonitoring:
          title: Include Monitoring
          type: boolean
          default: true
          description: Add Prometheus metrics endpoint
        includeCICD:
          title: Include CI/CD Pipeline
          type: boolean
          default: true
          description: Add GitHub Actions workflow

  # ──────────────────────────────────────
  # STEPS — Actions to execute
  # ──────────────────────────────────────
  steps:
    - id: log-input
      name: Log Input Parameters
      action: debug:log
      input:
        message: |
          Creating service: ${{ parameters.serviceName }}
          Owner: ${{ parameters.owner }}
          Language: ${{ parameters.language }}
          Port: ${{ parameters.port }}
          Environment: ${{ parameters.environment }}

    - id: fetch-skeleton
      name: Fetch Skeleton
      action: fetch:template
      input:
        url: ./skeleton
        targetPath: .
        values:
          serviceName: ${{ parameters.serviceName }}
          description: ${{ parameters.description }}
          owner: ${{ parameters.owner }}
          language: ${{ parameters.language }}
          port: ${{ parameters.port }}
          environment: ${{ parameters.environment }}
          replicas: ${{ parameters.replicas }}
          includeDatabase: ${{ parameters.includeDatabase }}
          includeMonitoring: ${{ parameters.includeMonitoring }}
          includeCICD: ${{ parameters.includeCICD }}

    - id: log-complete
      name: Log Completion
      action: debug:log
      input:
        message: "Service ${{ parameters.serviceName }} scaffolded successfully!"
        listWorkspace: true

  # ──────────────────────────────────────
  # OUTPUT — Links shown after completion
  # ──────────────────────────────────────
  output:
    links:
      - title: View in Catalog
        icon: catalog
        entityRef: ${{ steps['fetch-skeleton'].output.entityRef }}
TMPL
```

### Exercise 2: Create the Skeleton Files

```bash
# catalog-info.yaml template
cat <<'EOF' > ~/platform-portal/templates/new-service/skeleton/catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${{ values.serviceName }}
  description: ${{ values.description }}
  annotations:
    backstage.io/kubernetes-id: ${{ values.serviceName }}
    backstage.io/techdocs-ref: dir:.
  tags:
    - ${{ values.language }}
    - microservice
spec:
  type: service
  lifecycle: experimental
  owner: ${{ values.owner }}
EOF

# README.md template
cat <<'EOF' > ~/platform-portal/templates/new-service/skeleton/README.md
# ${{ values.serviceName }}

${{ values.description }}

## Quick Start

### Local Development

```bash
# Run locally
docker build -t ${{ values.serviceName }} .
docker run -p ${{ values.port }}:${{ values.port }} ${{ values.serviceName }}
```

### Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | ${{ values.port }} | Service port |
| ENVIRONMENT | ${{ values.environment }} | Target environment |

## Owner

Maintained by **${{ values.owner }}**
EOF

# Dockerfile template
cat <<'DOCKERFILE' > ~/platform-portal/templates/new-service/skeleton/Dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY src/ .

RUN pip install --no-cache-dir flask prometheus-client

EXPOSE ${{ values.port }}

CMD ["python", "main.py"]
DOCKERFILE

# Application source
cat <<'EOF' > ~/platform-portal/templates/new-service/skeleton/src/main.py
"""${{ values.serviceName }} - ${{ values.description }}"""

from flask import Flask, jsonify
import os

app = Flask(__name__)

SERVICE_NAME = "${{ values.serviceName }}"
ENVIRONMENT = os.getenv("ENVIRONMENT", "${{ values.environment }}")
PORT = int(os.getenv("PORT", "${{ values.port }}"))


@app.route("/")
def root():
    return jsonify({
        "service": SERVICE_NAME,
        "environment": ENVIRONMENT,
        "status": "healthy",
        "version": "1.0.0"
    })


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/ready")
def ready():
    return jsonify({"status": "ready"})


if __name__ == "__main__":
    print(f"Starting {SERVICE_NAME} on port {PORT}")
    app.run(host="0.0.0.0", port=PORT)
EOF

# Kubernetes deployment manifest
cat <<'EOF' > ~/platform-portal/templates/new-service/skeleton/k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${{ values.serviceName }}
  namespace: platform-${{ values.environment }}
  labels:
    app: ${{ values.serviceName }}
    environment: ${{ values.environment }}
    managed-by: backstage-scaffolder
spec:
  replicas: ${{ values.replicas }}
  selector:
    matchLabels:
      app: ${{ values.serviceName }}
  template:
    metadata:
      labels:
        app: ${{ values.serviceName }}
        environment: ${{ values.environment }}
    spec:
      containers:
      - name: ${{ values.serviceName }}
        image: ${{ values.serviceName }}:latest
        ports:
        - containerPort: ${{ values.port }}
        env:
        - name: ENVIRONMENT
          value: "${{ values.environment }}"
        - name: PORT
          value: "${{ values.port }}"
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
        readinessProbe:
          httpGet:
            path: /ready
            port: ${{ values.port }}
          initialDelaySeconds: 5
        livenessProbe:
          httpGet:
            path: /health
            port: ${{ values.port }}
          initialDelaySeconds: 10
EOF

# Kubernetes service manifest
cat <<'EOF' > ~/platform-portal/templates/new-service/skeleton/k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: ${{ values.serviceName }}
  namespace: platform-${{ values.environment }}
  labels:
    app: ${{ values.serviceName }}
spec:
  selector:
    app: ${{ values.serviceName }}
  ports:
  - port: 80
    targetPort: ${{ values.port }}
  type: ClusterIP
EOF
```

### Exercise 3: Register the Template in Backstage

Update `app-config.yaml` to include the template:

```bash
# Add template location to app-config.yaml
cat <<'APPCONFIG' >> ~/platform-portal/app-config.yaml

  # Software Templates
    - type: file
      target: ./templates/new-service/template.yaml
      rules:
        - allow: [Template]
APPCONFIG
```

> ⚠️ Make sure the indentation is correct — the location entry should be under `catalog.locations`. You may need to manually edit the file.

Alternatively, manually edit the file to ensure correct YAML:

```bash
cd ~/platform-portal

# Verify the config is valid
node -e "const yaml = require('yaml'); const fs = require('fs'); const doc = yaml.parse(fs.readFileSync('app-config.yaml', 'utf8')); console.log('Config OK:', Object.keys(doc));" 2>/dev/null || echo "Check YAML manually"
```

### Exercise 4: Restart Backstage and Test

```bash
# Stop Backstage if running
pkill -f "backstage" 2>/dev/null
sleep 5

# Restart
cd ~/platform-portal
yarn dev &

echo "⏳ Waiting for Backstage to start..."
sleep 60

# Check that the template is registered
curl -s http://localhost:7007/api/catalog/entities?filter=kind=template | python3 -m json.tool
```

Navigate to **http://localhost:3000/create** in your browser to see the template form.

### Exercise 5: Create a Crossplane Claim Template

Let's create a template that generates Crossplane Claims — connecting Backstage to Crossplane:

```bash
mkdir -p ~/platform-portal/templates/request-database/skeleton

cat <<'TMPL' > ~/platform-portal/templates/request-database/template.yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: request-database
  title: Request a Database
  description: |
    Request a new PostgreSQL or MySQL database provisioned by Crossplane.
    The database will be automatically provisioned in your target environment.
  tags:
    - database
    - crossplane
    - self-service
    - infrastructure
spec:
  owner: platform-team
  type: resource

  parameters:
    - title: Database Configuration
      required:
        - databaseName
        - environment
      properties:
        databaseName:
          title: Database Name
          type: string
          pattern: '^[a-z][a-z0-9-]*$'
          description: Name for the database (lowercase, hyphens allowed)
          ui:autofocus: true
        environment:
          title: Environment
          type: string
          enum:
            - dev
            - staging
            - prod
          default: dev
        size:
          title: Database Size
          type: string
          enum:
            - small
            - medium
            - large
          default: small
          description: |
            small = 1 CPU, 512MB RAM
            medium = 2 CPU, 1GB RAM
            large = 4 CPU, 2GB RAM
        engine:
          title: Database Engine
          type: string
          enum:
            - postgresql
            - mysql
          default: postgresql
        ownerTeam:
          title: Owner Team
          type: string
          enum:
            - platform-team
            - backend-team
            - frontend-team
          default: backend-team

  steps:
    - id: log-request
      name: Log Database Request
      action: debug:log
      input:
        message: |
          Database Request:
            Name: ${{ parameters.databaseName }}
            Environment: ${{ parameters.environment }}
            Size: ${{ parameters.size }}
            Engine: ${{ parameters.engine }}
            Owner: ${{ parameters.ownerTeam }}

    - id: fetch-claim
      name: Generate Crossplane Claim
      action: fetch:template
      input:
        url: ./skeleton
        targetPath: ./crossplane-claim
        values:
          databaseName: ${{ parameters.databaseName }}
          environment: ${{ parameters.environment }}
          size: ${{ parameters.size }}
          engine: ${{ parameters.engine }}
          ownerTeam: ${{ parameters.ownerTeam }}

    - id: log-output
      name: Log Generated Files
      action: debug:log
      input:
        message: "Crossplane claim generated for ${{ parameters.databaseName }}"
        listWorkspace: true

  output:
    links:
      - title: View Database Claim
        icon: catalog
        entityRef: resource:default/${{ parameters.databaseName }}
TMPL

# Create the Crossplane claim skeleton
cat <<'EOF' > ~/platform-portal/templates/request-database/skeleton/database-claim.yaml
# Generated by Backstage Scaffolder
# Apply this to your cluster: kubectl apply -f database-claim.yaml
apiVersion: platform.example.com/v1alpha1
kind: DatabaseClaim
metadata:
  name: ${{ values.databaseName }}
  namespace: platform-${{ values.environment }}
  labels:
    app.kubernetes.io/managed-by: backstage
    backstage.io/template: request-database
    team: ${{ values.ownerTeam }}
spec:
  parameters:
    size: ${{ values.size }}
    engine: ${{ values.engine }}
    environment: ${{ values.environment }}
    storageGB: 10
  compositionRef:
    name: database-composition
EOF

# Catalog entry for the database resource
cat <<'EOF' > ~/platform-portal/templates/request-database/skeleton/catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: ${{ values.databaseName }}
  description: "${{ values.engine }} database (${{ values.size }}) in ${{ values.environment }}"
  tags:
    - ${{ values.engine }}
    - database
    - ${{ values.environment }}
spec:
  type: database
  owner: ${{ values.ownerTeam }}
  system: ecommerce-platform
EOF
```

### Exercise 6: List Available Scaffolder Actions

```bash
# Query available scaffolder actions
curl -s http://localhost:7007/api/scaffolder/v2/actions | python3 -c "
import json, sys
actions = json.load(sys.stdin)
print('Available Scaffolder Actions:')
print('=' * 50)
for action in sorted(actions, key=lambda a: a['id']):
    print(f\"  {action['id']}\")
    desc = action.get('description', 'No description')
    print(f\"    {desc[:80]}\")
    print()
" 2>/dev/null || echo "Backstage not running or actions endpoint not available"
```

Common built-in actions:

| Action | Purpose |
|--------|---------|
| `fetch:template` | Copy and template files from skeleton |
| `fetch:plain` | Copy files without templating |
| `publish:github` | Create a GitHub repository |
| `publish:gitlab` | Create a GitLab repository |
| `catalog:register` | Register entity in Backstage catalog |
| `catalog:write` | Write a catalog-info.yaml file |
| `debug:log` | Log messages (useful for debugging) |
| `debug:wait` | Wait for a specified time |

---

## ✅ Verification & Testing

```bash
echo "============================================"
echo "  Lab 09 — Software Templates Verification"
echo "============================================"
echo ""

echo "1. Templates registered:"
curl -s http://localhost:7007/api/catalog/entities?filter=kind=template 2>/dev/null | python3 -c "
import json, sys
templates = json.load(sys.stdin)
for t in templates:
    print(f\"   ✅ {t['metadata']['name']}: {t['metadata'].get('title', 'N/A')}\")
if not templates:
    print('   ❌ No templates found')
" 2>/dev/null || echo "   ❌ Cannot connect to Backstage"

echo ""
echo "2. Template files:"
for tmpl in new-service request-database; do
  if [ -f ~/platform-portal/templates/$tmpl/template.yaml ]; then
    echo "   ✅ $tmpl/template.yaml exists"
  else
    echo "   ❌ $tmpl/template.yaml missing"
  fi
done

echo ""
echo "3. Skeleton files (new-service):"
find ~/platform-portal/templates/new-service/skeleton -type f | while read f; do
  echo "   ✅ $(echo $f | sed 's|.*/skeleton/||')"
done

echo ""
echo "============================================"
```

---

## 🧹 Cleanup

```bash
# Stop Backstage
pkill -f "backstage" 2>/dev/null
```

> ⚠️ **Keep the Backstage app and templates** — we'll use them in Labs 13 and 14!

---

## 📝 Key Takeaways

- **Software Templates** enable developer self-service via "Golden Paths"
- Templates have 3 parts: **Parameters** (UI form), **Steps** (actions), **Output** (links)
- The **Scaffolder** processes templates using built-in and custom actions
- `fetch:template` copies and templates files from a `skeleton/` directory
- Templates can generate **Crossplane Claims** — connecting the portal to infrastructure provisioning
- In production, templates would use `publish:github` to create real repos and `catalog:register` to auto-register entities
- Templates are themselves catalog entities (`kind: Template`)

---

## 🔗 References

- [Writing Templates](https://backstage.io/docs/features/software-templates/writing-templates)
- [Built-in Actions](https://backstage.io/docs/features/software-templates/builtin-actions)
- [Input Examples](https://backstage.io/docs/features/software-templates/input-examples)
- [Template Editor](https://backstage.io/docs/features/software-templates/testing-scaffolder)

---

## ➡️ Next Lab

**[Lab 10 — Integrating Argo CD + Crossplane](lab-10-argocd-crossplane-gitops-iac.md)**

We'll connect Argo CD and Crossplane — using GitOps to manage infrastructure as code.
