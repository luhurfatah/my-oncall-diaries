# GitOps — Git as the Source of Truth

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Core Concepts & Mental Model](#1-core-concepts-mental-model) | What GitOps is, the four principles, pull vs push, and the reconciliation loop. |
| **02** | [Repository Design Patterns](#2-repository-design-patterns) | Monorepo, polyrepo, infra+app split, and app-of-apps — trade-offs and when to use each. |
| **03** | [Argo CD Reference](#3-argo-cd-reference) | Architecture, Application, AppProject, hub-and-spoke multi-cluster, and annotated manifests. |
| **04** | [Flux CD Reference](#4-flux-cd-reference) | Architecture, GitRepository, Kustomization, HelmRelease, image automation, and multi-tenancy. |
| **05** | [GitOps with Helm](#5-gitops-with-helm) | HelmRelease patterns, values management, chart versioning strategy, and Helm vs raw manifests. |
| **06** | [GitOps with Kustomize](#6-gitops-with-kustomize) | Overlay model, base + environment pattern, components, and Kustomize vs Helm decision guide. |
| **07** | [Progressive Delivery — Argo Rollouts](#7-progressive-delivery-argo-rollouts) | Canary and blue/green via Argo Rollouts, AnalysisTemplate, traffic routing integration. |
| **08** | [Argo Workflows](#8-argo-workflows) | DAG and steps-based pipelines, CI integration, and GitOps promotion workflows. |
| **09** | [Secrets Management](#9-secrets-management) | SOPS, External Secrets Operator, Vault Agent — comparison, patterns, and annotated configs. |
| **10** | [Multi-Cluster Management](#10-multi-cluster-management) | Hub-and-spoke topology, cluster registration, fleet management patterns. |
| **11** | [RBAC & Multi-Tenancy](#11-rbac-multi-tenancy) | AppProject isolation, Flux tenancy model, team-scoped access patterns. |
| **12** | [Drift Detection & Reconciliation](#12-drift-detection-reconciliation) | What drift is, self-heal behavior, when to allow manual changes, and audit patterns. |
| **13** | [Disaster Recovery Patterns](#13-disaster-recovery-patterns) | Cluster rebuild from Git, state recovery, RTO targets, and DR runbook structure. |
| **14** | [Anti-Patterns & Failure Modes](#14-anti-patterns-failure-modes) | The most common GitOps mistakes and what they cost in production. |

---

## 1. Core Concepts & Mental Model

### What GitOps Is

GitOps is an operational model where Git is the single source of truth for the desired state of a system. Every change to infrastructure or application configuration is made by committing to a Git repository. A software agent running inside the cluster continuously compares that desired state (Git) against the actual state (the cluster) and reconciles any difference.

The key mental shift from traditional CI/CD is **who initiates the deployment**. In push-based CD, the pipeline reaches into the cluster and applies changes. In GitOps, the cluster reaches out to Git and pulls changes. The cluster is always in control of what runs inside it.

### The Four GitOps Principles (OpenGitOps)

| Principle | What it means in practice |
| :--- | :--- |
| **Declarative** | The entire system is described as desired state, not a sequence of imperative commands |
| **Versioned and immutable** | Desired state is stored in Git — every change is a commit, every commit is auditable and revertable |
| **Pulled automatically** | Software agents pull state from Git and apply it; no external system pushes into the cluster |
| **Continuously reconciled** | Agents detect and correct drift from desired state automatically and continuously |

### Pull vs Push Model

In a push-based pipeline (traditional CI/CD), the CI system — GitHub Actions, Jenkins, GitLab CI — authenticates to the cluster and runs `kubectl apply` or `helm upgrade`. The cluster is passive. Access credentials must live in the CI system.

In a pull-based GitOps model, an agent inside the cluster — Argo CD or Flux — polls the Git repository and applies changes when it detects a diff. The cluster is active. No external system needs cluster credentials; the agent already runs inside with appropriate RBAC.

| Property | Push (traditional CI/CD) | Pull (GitOps) |
| :--- | :--- | :--- |
| Who initiates deploy | CI pipeline (external) | Agent inside the cluster |
| Cluster credentials location | CI system secrets | Inside the cluster (ServiceAccount) |
| Drift detection | None — state diverges silently | Continuous — agent reconciles |
| Audit trail | CI pipeline logs | Git commit history |
| Rollback mechanism | Re-run pipeline with old ref | Revert Git commit |
| Works without network egress from CI | No | Yes |

### The Reconciliation Loop

The reconciliation loop is the core operational mechanism of any GitOps agent. It runs continuously on a configurable interval (typically 30 seconds to 5 minutes) and executes three steps: fetch the desired state from Git, fetch the actual state from the cluster, compute the diff, and apply the diff. If Git and the cluster match, nothing happens. If they diverge, the agent drives the cluster back toward Git.

This loop is what makes GitOps self-healing. A manual `kubectl edit` on a resource managed by the GitOps agent will be overwritten on the next reconciliation cycle. This is intentional — it enforces that Git is the only legitimate way to change the system.

---

## 2. Repository Design Patterns

The repository structure is the most consequential architectural decision in a GitOps system. It determines how teams collaborate, how changes are isolated, and how the GitOps agent discovers what to deploy where.

### Monorepo

All teams, all services, and all environments live in a single repository. The GitOps agent points at different paths within the same repo for different clusters or namespaces.

- All configuration is co-located and cross-team changes are visible in one place
- Access control is path-based, which requires careful CODEOWNERS configuration
- Works well for small to medium organizations where platform and app teams are closely coupled
- Scales poorly when different teams need different merge and review cadences

### Polyrepo

Each team or service owns its own repository. The GitOps agent is configured with multiple source repositories, one per team or service.

- Strong isolation — a misconfiguration in one team's repo cannot break another team's deployment
- Each repo has its own access control, branch protection, and CI pipeline
- Increases operational overhead for the platform team who must register and manage many sources
- Cross-cutting changes (e.g. updating a shared base image) require PRs to many repositories

### Separate Infra Repo + App Repos

A hybrid model where cluster infrastructure (namespaces, RBAC, network policies, CRDs, operator installations) lives in a dedicated platform repo managed by the platform team, and application manifests live in separate app repos managed by product teams. The GitOps agent bootstraps from the platform repo, which then registers the app repos as additional sources.

This is the most common pattern in mature organizations. It cleanly separates platform concerns from application concerns and allows the platform team to enforce baseline cluster configuration without being in the critical path for every application deploy.

### App-of-Apps Pattern (Argo CD)

In Argo CD, an Application resource points the agent at a Git path. The app-of-apps pattern uses one root Application whose Git path contains not application manifests, but more Application resources. Argo CD deploys those Application resources, which in turn cause Argo CD to deploy the actual workloads.

This creates a self-bootstrapping hierarchy: deploy one root Application manually, and the rest of the cluster configuration follows from Git automatically. The root Application is the only thing that needs to be created out-of-band.

```yaml
# root-app.yaml — the only manifest applied manually
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/gitops-repo
    targetRevision: main
    path: clusters/production/apps   # this path contains more Application YAMLs
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Flux CD Equivalent — Kustomization Hierarchy

Flux uses Kustomization resources (not to be confused with a `kustomization.yaml` file) to define what to reconcile and from where. The equivalent of app-of-apps in Flux is a root Kustomization that points at a path containing more Kustomization resources, which in turn point at application paths. The bootstrap process creates the root Kustomization; everything else is Git-driven.

### Repository Pattern Comparison

| Pattern | Team isolation | Operational complexity | Cross-cutting changes | Best fit |
| :--- | :--- | :--- | :--- | :--- |
| Monorepo | Low (path-based) | Low | Easy (one PR) | Small orgs, single platform team |
| Polyrepo | High (repo-based) | High | Hard (many PRs) | Large orgs, autonomous teams |
| Infra + App split | Medium | Medium | Medium | Most production environments |
| App-of-apps | Medium | Medium | Medium | Argo CD environments at scale |

---

## 3. Argo CD Reference

### Architecture

Argo CD runs as a set of components inside the cluster. The **API server** exposes the gRPC and REST API consumed by the CLI and UI. The **repository server** clones Git repositories and renders manifests (expanding Helm charts, running Kustomize). The **application controller** is the reconciliation engine — it watches Application resources, compares desired state from the repo server against live cluster state, and applies diffs. The **application set controller** manages ApplicationSet resources that generate Application resources dynamically.

### The Application Resource

The Application is the fundamental Argo CD object. It defines a source (Git repo, path, revision) and a destination (cluster, namespace), and declares sync policy behavior.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-production
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io  # deletes cluster resources when App is deleted
spec:
  project: myapp-project          # scopes this app to an AppProject for RBAC

  source:
    repoURL: https://github.com/your-org/myapp
    targetRevision: main           # branch, tag, or commit SHA
    path: deploy/production        # path within the repo to reconcile

  destination:
    server: https://kubernetes.default.svc   # target cluster API server URL
    namespace: myapp-production

  syncPolicy:
    automated:
      prune: true        # delete resources removed from Git
      selfHeal: true     # revert manual changes detected in cluster
    syncOptions:
      - CreateNamespace=true        # create destination namespace if missing
      - PrunePropagationPolicy=foreground
      - ApplyOutOfSyncOnly=true     # only apply resources that differ (faster syncs)
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 1m
```

### The AppProject Resource

AppProject defines RBAC boundaries for a set of Applications — which source repos are permitted, which destination clusters and namespaces are allowed, and which Kubernetes resource types can be deployed. Without AppProject scoping, any Application can deploy any resource to any namespace.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: myapp-project
  namespace: argocd
spec:
  description: "Production applications for the myapp team"

  # Only allow sources from this org's repos
  sourceRepos:
    - https://github.com/your-org/*

  # Only allow deploys to these clusters and namespaces
  destinations:
    - server: https://kubernetes.default.svc
      namespace: myapp-production
    - server: https://kubernetes.default.svc
      namespace: myapp-staging

  # Restrict which resource types this project can manage
  clusterResourceWhitelist:
    - group: ''
      kind: Namespace
  namespaceResourceWhitelist:
    - group: 'apps'
      kind: Deployment
    - group: ''
      kind: Service
    - group: ''
      kind: ConfigMap

  # Deny deploying ClusterRole or ClusterRoleBinding
  clusterResourceBlacklist:
    - group: 'rbac.authorization.k8s.io'
      kind: ClusterRole
```

### ApplicationSet — Dynamic Application Generation

ApplicationSet generates multiple Application resources from a template and a generator. The list generator, cluster generator, and git generator are the most common.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-environments
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - env: staging
            cluster: https://staging.k8s.example.com
          - env: production
            cluster: https://prod.k8s.example.com

  template:
    metadata:
      name: 'myapp-{{env}}'
    spec:
      project: myapp-project
      source:
        repoURL: https://github.com/your-org/myapp
        targetRevision: main
        path: 'deploy/{{env}}'
      destination:
        server: '{{cluster}}'
        namespace: 'myapp-{{env}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### Sync Phases and Hooks

Argo CD supports sync hooks — Jobs or resources annotated to run at specific phases of the sync lifecycle. This is how database migrations, pre-deploy validation, and post-deploy smoke tests are integrated.

| Hook phase | When it runs | Common use |
| :--- | :--- | :--- |
| `PreSync` | Before any resources are applied | Database migrations, backup snapshots |
| `Sync` | During the normal sync | Default — all non-hook resources |
| `PostSync` | After all resources are healthy | Smoke tests, notification dispatch |
| `SyncFail` | If the sync fails | Rollback scripts, alerting |

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: myrepo/myapp:latest
          command: ["python", "manage.py", "migrate"]
      restartPolicy: Never
```

---

## 4. Flux CD Reference

### Architecture

Flux is a set of controllers — each responsible for a single concern — that together implement the GitOps reconciliation loop. The **source-controller** fetches and caches artifacts from Git repositories, Helm repositories, and OCI registries. The **kustomize-controller** reconciles Kustomization resources by rendering manifests and applying them to the cluster. The **helm-controller** reconciles HelmRelease resources by installing or upgrading Helm charts. The **notification-controller** dispatches alerts and events. The **image-reflector-controller** and **image-automation-controller** handle automated image tag updates.

### Bootstrap

Flux bootstrap installs the Flux controllers into the cluster and commits their manifests into the target Git repository. After bootstrap, the cluster manages itself — the Flux controllers are themselves reconciled by Flux.

```bash
flux bootstrap github \
  --owner=your-org \
  --repository=gitops-repo \
  --branch=main \
  --path=clusters/production \
  --personal
```

### GitRepository — Defining a Source

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 1m                    # how often to poll for new commits
  url: https://github.com/your-org/myapp
  ref:
    branch: main
  secretRef:
    name: myapp-git-credentials   # SSH key or token stored in a Secret
```

### Kustomization — Reconciling a Path

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: myapp-production
  namespace: flux-system
spec:
  interval: 5m
  path: ./deploy/production        # path within the GitRepository to reconcile
  prune: true                      # delete resources removed from Git
  sourceRef:
    kind: GitRepository
    name: myapp
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: myapp
      namespace: myapp-production
  timeout: 3m
  postBuild:
    substituteFrom:
      - kind: ConfigMap
        name: cluster-vars          # inject cluster-specific variables at render time
```

### Image Automation

Flux can watch a container registry for new image tags matching a policy and automatically commit an updated image tag to Git. This closes the loop between a new image being pushed and the cluster running it — without a CI pipeline needing to push to Git.

```yaml
# 1. Watch the registry for new tags
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: myapp
  namespace: flux-system
spec:
  image: 123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/myapp
  interval: 1m

---
# 2. Define which tags are valid candidates
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: myapp
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: myapp
  policy:
    semver:
      range: '>=1.0.0'             # only promote semver-tagged images

---
# 3. Write the new tag back to Git automatically
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImageUpdateAutomation
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 1m
  sourceRef:
    kind: GitRepository
    name: myapp
  git:
    checkout:
      ref:
        branch: main
    commit:
      author:
        email: fluxbot@your-org.com
        name: Flux Bot
      messageTemplate: 'chore: update myapp image to {{range .Updated.Images}}{{.}}{{end}}'
    push:
      branch: main
```

---

## 5. GitOps with Helm

### When to Use Helm in a GitOps Context

Helm charts are the standard packaging format for reusable, configurable Kubernetes applications. In a GitOps context, you do not run `helm install` from a pipeline. Instead, you declare a HelmRelease resource in Git and let the GitOps agent (Argo CD or Flux's helm-controller) perform the install and upgrade. The chart version and values are version-controlled; the pipeline never touches the cluster directly.

### Values Management Strategy

The most common mistake with Helm in GitOps is scattering values across too many places. A clean pattern is one base `values.yaml` in the chart, one `values-<env>.yaml` per environment in the GitOps repo, and cluster-specific secrets injected separately (never in values files committed to Git).

```yaml
# Flux HelmRelease with layered values
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: myapp
  namespace: myapp-production
spec:
  interval: 5m
  chart:
    spec:
      chart: myapp
      version: '>=1.0.0 <2.0.0'    # semver range — automatically upgrades patch and minor
      sourceRef:
        kind: HelmRepository
        name: myapp-charts
        namespace: flux-system

  # Layer 1: base values from the chart
  # Layer 2: environment overrides declared inline
  values:
    replicaCount: 3
    resources:
      requests:
        cpu: 200m
        memory: 256Mi

  # Layer 3: values from a Secret or ConfigMap (injected at runtime)
  valuesFrom:
    - kind: Secret
      name: myapp-db-credentials
      valuesKey: values.yaml        # key inside the Secret that contains YAML

  # Upgrade behavior
  upgrade:
    remediation:
      remediateLastFailure: true    # roll back to previous revision on failure
  rollback:
    timeout: 5m
    cleanupOnFail: true
```

### Chart Versioning Strategy

| Approach | Version pinning | Auto-upgrades | Risk |
| :--- | :--- | :--- | :--- |
| Exact version (`1.2.3`) | Full | None | Lowest — deterministic |
| Patch range (`~1.2.0`) | Minor+Major | Patches only | Low |
| Minor range (`^1.0.0`) | Major only | Patches + minors | Medium |
| Semver range (`>=1.0.0 <2.0.0`) | Major only | Patches + minors | Medium |
| `*` or latest | None | All | Never use in production |

Always pin to an exact version or a tight semver range in production. Use the minor range in staging to catch upstream chart changes before they reach production.

### Argo CD Helm Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-production
  namespace: argocd
spec:
  project: myapp-project
  source:
    repoURL: https://charts.myrepo.io
    chart: myapp
    targetRevision: 1.4.2
    helm:
      releaseName: myapp
      valueFiles:
        - values-production.yaml   # relative to the app source, or use a second source
      parameters:
        - name: image.tag
          value: "abc1234"         # override a specific value inline
  destination:
    server: https://kubernetes.default.svc
    namespace: myapp-production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

---

## 6. GitOps with Kustomize

### The Overlay Model

Kustomize works by layering — a base set of manifests is patched by one or more overlays without modifying the original files. In a GitOps context, the base represents the canonical application definition and each overlay represents a deployment target (environment, cluster, region).

A typical layout:

```
deploy/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   └── service.yaml
└── overlays/
    ├── staging/
    │   ├── kustomization.yaml     # references ../base, applies staging patches
    │   └── replica-patch.yaml
    └── production/
        ├── kustomization.yaml     # references ../base, applies production patches
        └── replica-patch.yaml
```

### Base kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
commonLabels:
  app: myapp
```

### Production Overlay kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: myapp-production
resources:
  - ../../base
patches:
  - path: replica-patch.yaml
    target:
      kind: Deployment
      name: myapp
images:
  - name: myrepo/myapp
    newTag: abc1234              # the only line that changes per deploy — updated by CI or image automation
configMapGenerator:
  - name: myapp-config
    envs:
      - config.env               # environment-specific config injected here
```

### Kustomize Components

Components are reusable patches that can be included in any overlay without being a full base. They are the correct mechanism for optional features — enabling metrics, enabling debug logging, or applying non-default resource limits — that only some environments need.

```yaml
# components/metrics/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - servicemonitor.yaml
patches:
  - path: add-metrics-port.yaml
```

Include in an overlay with `components: [../../components/metrics]`.

### Kustomize vs Helm Decision Guide

| Factor | Prefer Kustomize | Prefer Helm |
| :--- | :--- | :--- |
| Chart reuse across orgs | No | Yes — Helm charts are distributable |
| Complexity of parameterization | Low to medium | High — many configurable values |
| Template logic (conditionals, loops) | Not needed | Yes — Helm supports full templating |
| Patch-based customization | Yes | No — Helm does not support patches |
| OCI artifact distribution | Possible | Native |
| Learning curve | Lower | Higher |
| Audit readability | High — plain YAML | Lower — template syntax |

Many teams use both: Helm for third-party applications (ingress-nginx, cert-manager, kube-prometheus-stack) and Kustomize for their own application manifests.

---

## 7. Progressive Delivery — Argo Rollouts

### What Argo Rollouts Adds

Kubernetes Deployments support rolling updates but provide no traffic control — all traffic shifts to new pods as they become ready. Argo Rollouts replaces the Deployment controller with a Rollout controller that integrates with ingress controllers and service meshes to split traffic by percentage, run automated metric analysis, and gate promotion on observable signals.

### Canary Rollout

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp
  namespace: myapp-production
spec:
  replicas: 10
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myrepo/myapp:v2
          ports:
            - containerPort: 8080

  strategy:
    canary:
      # Traffic routing via ALB weighted target groups
      canaryService: myapp-canary
      stableService: myapp-stable
      trafficRouting:
        alb:
          ingress: myapp-ingress
          servicePort: 80

      steps:
        - setWeight: 10            # send 10% traffic to canary
        - pause: {duration: 5m}   # wait 5 minutes
        - analysis:                # run metric analysis — proceed only if passing
            templates:
              - templateName: success-rate
        - setWeight: 50
        - pause: {duration: 10m}
        - setWeight: 100           # full cutover
```

### AnalysisTemplate — Automated Promotion Gates

An AnalysisTemplate defines metrics queries that Argo Rollouts evaluates during a canary step. If the analysis fails, the rollout is automatically aborted and traffic is shifted back to the stable version.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
  namespace: myapp-production
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      interval: 1m
      count: 5                     # run 5 measurements
      successCondition: result[0] >= 0.95   # 95% success rate required
      failureLimit: 1              # abort after 1 failure
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc.cluster.local:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status!~"5.."}[1m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[1m]))
```

### Blue/Green via Argo Rollouts

```yaml
strategy:
  blueGreen:
    activeService: myapp-active       # receives live traffic
    previewService: myapp-preview     # receives no traffic until promotion
    autoPromotionEnabled: false       # require manual promotion
    prePromotionAnalysis:
      templates:
        - templateName: success-rate  # run analysis against preview before promoting
    postPromotionAnalysis:
      templates:
        - templateName: success-rate  # run analysis against active after promoting
    scaleDownDelaySeconds: 600        # keep old version for 10 min post-promotion
```

### Rollback

Argo Rollouts keeps the previous stable ReplicaSet running until the new version is fully promoted. If an analysis fails or a manual abort is issued, traffic is shifted back to the stable ReplicaSet instantly — no redeploy required.

```bash
kubectl argo rollouts abort myapp -n myapp-production   # abort and revert to stable
kubectl argo rollouts undo myapp -n myapp-production    # revert to previous image
```

---

## 8. Argo Workflows

### What Argo Workflows Is

Argo Workflows is a container-native workflow engine for Kubernetes. Each step in a workflow runs as a Pod. Workflows are defined as directed acyclic graphs (DAGs) or sequential steps, and are submitted to the cluster as custom resources. It is the foundation for Argo Events and integrates with Argo CD for GitOps promotion pipelines.

### Steps-Based Workflow

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: ci-pipeline-
  namespace: argo-workflows
spec:
  entrypoint: pipeline
  templates:
    - name: pipeline
      steps:
        - - name: lint
            template: run-lint
        - - name: test              # runs after lint completes
            template: run-tests
        - - name: build
            template: build-image

    - name: run-lint
      container:
        image: node:20
        command: [npm, run, lint]

    - name: run-tests
      container:
        image: node:20
        command: [npm, test]

    - name: build-image
      container:
        image: gcr.io/kaniko-project/executor:latest
        args:
          - --context=git://github.com/your-org/myapp
          - --destination=myrepo/myapp:{{workflow.parameters.image-tag}}
```

### DAG-Based Workflow

```yaml
- name: pipeline
  dag:
    tasks:
      - name: lint
        template: run-lint
      - name: test
        template: run-tests
      - name: security-scan
        template: run-scan
      - name: build              # runs after all three complete
        dependencies: [lint, test, security-scan]
        template: build-image
      - name: promote-staging    # runs after build
        dependencies: [build]
        template: update-gitops-repo
```

### GitOps Promotion via Argo Workflows

Argo Workflows integrates with GitOps by running a promotion step that commits an updated image tag to the GitOps repository. The GitOps agent then picks up the change and deploys it — the workflow never touches the cluster directly.

```yaml
- name: update-gitops-repo
  script:
    image: alpine/git
    command: [sh]
    source: |
      git clone https://github.com/your-org/gitops-repo /workspace
      cd /workspace
      sed -i "s/newTag: .*/newTag: {{workflow.parameters.image-tag}}/" \
        deploy/production/kustomization.yaml
      git config user.email "argoworkflows@your-org.com"
      git config user.name "Argo Workflows Bot"
      git add .
      git commit -m "chore: promote myapp to {{workflow.parameters.image-tag}}"
      git push
```

---

## 9. Secrets Management

### The Core Problem

Git is public or semi-public. Kubernetes Secrets are base64-encoded, not encrypted. A naive GitOps approach where Secrets are committed to Git exposes credentials to anyone with repository access. Three patterns solve this at different layers.

### Pattern Comparison

| Pattern | Secret stored in | Encrypted in Git | External dependency | Best fit |
| :--- | :--- | :--- | :--- | :--- |
| **SOPS** | Git (encrypted) | Yes | KMS key (AWS, GCP, age) | Small teams, simple setup |
| **External Secrets Operator** | External vault | Not in Git | Vault / ASM / SSM | Enterprise, dynamic secrets |
| **Vault Agent Sidecar** | Vault | Not in Git | HashiCorp Vault | Workloads needing secret rotation |

### SOPS — Encrypted Secrets in Git

SOPS (Secrets OPerationS) encrypts secret values in YAML or JSON files using a KMS key or age key. The encrypted file is committed to Git. The GitOps agent decrypts it at apply time using a key that is accessible to the cluster (via IRSA or Workload Identity) but not to repository readers.

```yaml
# Before encryption — never commit this
apiVersion: v1
kind: Secret
metadata:
  name: myapp-db-credentials
  namespace: myapp-production
type: Opaque
stringData:
  DB_PASSWORD: "supersecret"

# After sops --encrypt — safe to commit
apiVersion: v1
kind: Secret
metadata:
  name: myapp-db-credentials
  namespace: myapp-production
type: Opaque
stringData:
  DB_PASSWORD: ENC[AES256_GCM,data:abc123...,tag:xyz==,type:str]
sops:
  kms:
    - arn: arn:aws:kms:ap-southeast-1:123456789012:key/your-key-id
  lastmodified: "2024-01-01T00:00:00Z"
```

Flux natively supports SOPS decryption via the `spec.decryption` field on a Kustomization. Argo CD supports it via the `argocd-vault-plugin` or community SOPS plugin.

```yaml
# Flux Kustomization with SOPS decryption
spec:
  decryption:
    provider: sops
    secretRef:
      name: sops-age-key           # Secret containing the age private key
```

### External Secrets Operator (ESO)

ESO runs as a controller in the cluster. An ExternalSecret resource declares which secret to fetch from an external store (AWS Secrets Manager, SSM Parameter Store, HashiCorp Vault, GCP Secret Manager) and what Kubernetes Secret to create from it. The Kubernetes Secret is never committed to Git — only the ExternalSecret manifest is.

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: myapp-db-credentials
  namespace: myapp-production
spec:
  refreshInterval: 1h              # re-fetch from the store every hour
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore       # cluster-scoped store configured by platform team

  target:
    name: myapp-db-credentials    # name of the Kubernetes Secret to create
    creationPolicy: Owner          # ESO owns and manages this Secret

  data:
    - secretKey: DB_PASSWORD       # key in the Kubernetes Secret
      remoteRef:
        key: myapp/production/db   # path in AWS Secrets Manager
        property: password         # JSON property within the secret value
```

The ClusterSecretStore (configured once by the platform team) defines how ESO authenticates to the external store:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secretsmanager
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-southeast-1
      auth:
        jwt:                        # IRSA — no static keys
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

### Vault Agent Sidecar

For workloads that need secrets injected as files or environment variables at pod start (rather than as Kubernetes Secrets), the Vault Agent sidecar pattern injects a sidecar container that authenticates to Vault using Kubernetes Service Account token and writes secrets to a shared volume.

```yaml
# Pod annotations that trigger Vault sidecar injection
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "myapp-production"
  vault.hashicorp.com/agent-inject-secret-config: "myapp/production/db"
  vault.hashicorp.com/agent-inject-template-config: |
    {{- with secret "myapp/production/db" -}}
    DB_PASSWORD={{ .Data.data.password }}
    {{- end }}
```

Secrets are written to `/vault/secrets/config` inside the pod and can be sourced as environment variable files.

---

## 10. Multi-Cluster Management

### Hub-and-Spoke Topology

The hub-and-spoke model uses a dedicated management cluster that runs the GitOps control plane (Argo CD or Flux) and manages all workload clusters from a single point. Workload clusters run only application workloads — they do not run GitOps agents that require cluster-admin access to the management plane.

The management cluster holds cluster registration credentials for each spoke. Changes to any spoke are driven from the hub by committing to the GitOps repository; the hub's agent applies the change to the appropriate spoke.

This topology simplifies audit — all deployment decisions flow through one system — and reduces the blast radius of a compromised workload cluster, since that cluster's credentials cannot be used to affect other clusters or the GitOps control plane.

### Cluster Registration in Argo CD

```bash
# Register a spoke cluster using the Argo CD CLI
argocd cluster add spoke-production \
  --kubeconfig ~/.kube/spoke-production.yaml \
  --name spoke-production \
  --system-namespace argocd
```

This creates a Secret in the `argocd` namespace on the hub that stores the spoke cluster's API server URL and credentials. Applications targeting this cluster reference the URL in their `spec.destination.server`.

### ApplicationSet with Cluster Generator

The cluster generator dynamically creates one Application per registered cluster, avoiding the need to manually define an Application for every spoke.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-all-clusters
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            environment: production   # only target clusters labelled as production

  template:
    metadata:
      name: 'myapp-{{name}}'          # name = cluster name from registration
    spec:
      project: myapp-project
      source:
        repoURL: https://github.com/your-org/myapp
        targetRevision: main
        path: 'deploy/production'
      destination:
        server: '{{server}}'          # server = cluster API URL from registration
        namespace: myapp-production
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### Flux Multi-Cluster with Cluster API or External Flux Instances

In a Flux-based hub-and-spoke model, each spoke cluster runs its own Flux instance bootstrapped from the same or a separate GitOps repository. The hub cluster can manage the spoke's Flux installation using Cluster API (CAPI) or Crossplane, and the spoke's Flux Kustomizations point at spoke-specific paths in the GitOps repo.

A simpler approach without Cluster API: bootstrap Flux independently on each spoke, pointing all spokes at the same GitOps repo but different cluster-specific paths:

```
clusters/
├── hub/
│   └── flux-system/
├── spoke-production-ap/
│   └── flux-system/
└── spoke-production-eu/
    └── flux-system/
```

Each spoke's Flux instance only reconciles its own path, isolating blast radius between regions.

### Multi-Cluster Operational Comparison

| Concern | Argo CD hub-and-spoke | Flux per-cluster |
| :--- | :--- | :--- |
| Single pane of glass UI | Yes — Argo CD UI shows all clusters | No — requires separate tooling (Weave GitOps) |
| Agent location | Hub only | Each spoke |
| Spoke cluster compromise impact | Cannot reach hub or other spokes | Cannot reach other spokes |
| Bootstrap complexity | Register clusters manually or via CLI | Bootstrap each spoke independently |
| Network requirement | Hub must reach spoke API server | Spoke must reach Git |

---

## 11. RBAC & Multi-Tenancy

### Argo CD AppProject Isolation

The AppProject is Argo CD's primary multi-tenancy boundary. Each team receives an AppProject that restricts which source repositories their Applications can reference, which destination clusters and namespaces they can deploy to, and which Kubernetes resource kinds they are permitted to manage.

A team with an AppProject scoped to their own namespace cannot accidentally (or maliciously) deploy a ClusterRole, modify another team's namespace, or reference an unauthorized Helm repository.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-payments
  namespace: argocd
spec:
  sourceRepos:
    - https://github.com/your-org/payments-*   # wildcard — only payments repos
  destinations:
    - server: https://kubernetes.default.svc
      namespace: payments-*                     # wildcard namespace match
  namespaceResourceWhitelist:
    - group: 'apps'
      kind: Deployment
    - group: ''
      kind: Service
    - group: ''
      kind: ConfigMap
    - group: ''
      kind: Secret
  clusterResourceBlacklist:
    - group: '*'
      kind: '*'                                 # deny all cluster-scoped resources
  roles:
    - name: payments-deployer
      description: "CI system deploy access"
      policies:
        - p, proj:team-payments:payments-deployer, applications, sync, team-payments/*, allow
      jwtTokens:
        - iat: 1609459200
```

### Argo CD RBAC Policy

Argo CD has its own RBAC layer (distinct from Kubernetes RBAC) configured in the `argocd-rbac-cm` ConfigMap.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.csv: |
    # Platform team — full admin
    g, platform-team, role:admin

    # App team — can sync and view their own project only
    p, role:app-team, applications, get, team-payments/*, allow
    p, role:app-team, applications, sync, team-payments/*, allow
    p, role:app-team, applications, get, team-payments/*, allow
    g, payments-team-sso-group, role:app-team

  policy.default: role:readonly   # unauthenticated users get read-only
```

### Flux Multi-Tenancy

Flux implements multi-tenancy by running each tenant's Kustomization under a different ServiceAccount with scoped RBAC. The platform team creates the ServiceAccount and RoleBinding; tenants can only deploy resources their ServiceAccount is permitted to manage.

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: payments-app
  namespace: payments             # Kustomization lives in the tenant's namespace
spec:
  serviceAccountName: payments-reconciler   # runs with this SA's RBAC, not cluster-admin
  interval: 5m
  path: ./apps/payments
  sourceRef:
    kind: GitRepository
    name: payments-repo
    namespace: payments
  prune: true
```

```yaml
# RBAC scoped to the tenant's namespace only
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-reconciler
  namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin             # scoped to namespace via RoleBinding, not ClusterRoleBinding
subjects:
  - kind: ServiceAccount
    name: payments-reconciler
    namespace: payments
```

---

## 12. Drift Detection & Reconciliation

### What Drift Is

Drift occurs when the actual state of the cluster diverges from the desired state declared in Git. The most common causes are manual `kubectl` changes made during an incident, automated systems (autoscalers, operators) modifying resources, and failed partial syncs that leave resources in an inconsistent state.

### Self-Heal Behavior

Both Argo CD and Flux detect drift on every reconciliation cycle. When `selfHeal: true` (Argo CD) or default reconciliation (Flux) is enabled, any detected diff is automatically corrected by re-applying the Git state. Manual changes to managed resources are overwritten within the reconciliation interval.

This is the correct behavior for production systems — it means Git is reliably the source of truth. However, it requires that any legitimate operational change (scaling up replicas during an incident, temporarily increasing resource limits) is either made via Git commit or made to a resource that is explicitly excluded from GitOps management.

### Excluding Resources from Reconciliation

Not all resources should be fully managed by GitOps. HorizontalPodAutoscalers, for example, update the `spec.replicas` field dynamically — if GitOps overwrites this on every sync, autoscaling is broken.

Argo CD handles this with the `ignoreDifferences` field:

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas          # do not sync replica count — let HPA manage it
    - group: autoscaling
      kind: HorizontalPodAutoscaler
      jsonPointers:
        - /spec/minReplicas
        - /spec/maxReplicas
```

Flux handles it with the `force: false` default and strategic merge patch annotations on specific fields.

### Drift Alerting

Beyond automatic correction, drift events should generate alerts so the platform team can identify unauthorized changes. Argo CD emits application health and sync status as metrics (scraped by Prometheus) and can be configured to send notifications via the notification controller.

```yaml
# Argo CD notification trigger on OutOfSync
trigger.on-sync-status-unknown: |
  - when: app.status.sync.status == 'OutOfSync'
    send: [slack-sync-failed]

template.slack-sync-failed:
  slack:
    attachments: |
      [{
        "title": "{{.app.metadata.name}} is OutOfSync",
        "text": "Source: {{.app.spec.source.repoURL}}/{{.app.spec.source.path}}"
      }]
```

### Reconciliation Interval Tuning

| Scenario | Recommended interval | Reasoning |
| :--- | :--- | :--- |
| Production workloads | 2–5 minutes | Balance between responsiveness and API server load |
| Infrastructure (CRDs, namespaces) | 10–15 minutes | Changes are infrequent; shorter interval wastes resources |
| Secrets (ESO) | 1 hour | Secret store API rate limits; secrets don't change frequently |
| Image automation | 1 minute | Needs to catch new image tags quickly |

---

## 13. Disaster Recovery Patterns

### The GitOps DR Advantage

The fundamental advantage of GitOps for disaster recovery is that the entire desired cluster state is in Git. Rebuilding a cluster from scratch is a bootstrap operation, not a restoration operation. You do not need to restore etcd backups to recover the desired state — you need a new cluster and a working GitOps bootstrap.

What is **not** in Git and must be recovered separately: persistent volume data, external database state, and secrets (if using ESO or Vault — the external store must be accessible from the new cluster).

### Cluster Rebuild Procedure (Argo CD)

The procedure for rebuilding a cluster from Git is deterministic and repeatable:

- Provision a new cluster (via IaC — Terraform, eksctl, or Cluster API)
- Install Argo CD into the new cluster (`kubectl apply -n argocd -f argocd-install.yaml`)
- Apply the root Application manifest (`kubectl apply -f root-app.yaml`)
- Wait for Argo CD to reconcile all Applications from Git

All namespaces, RBAC, network policies, operators, and application workloads are restored automatically. The RTO for application configuration is bounded by the time it takes to reconcile all Applications, not by manual runbook execution.

### Cluster Rebuild Procedure (Flux)

- Provision a new cluster
- Run `flux bootstrap` pointing at the same GitOps repository and cluster path
- Flux installs its controllers and immediately begins reconciling the cluster path from Git

### What Must Be Recovered Outside GitOps

| Resource type | Recovery mechanism |
| :--- | :--- |
| Persistent Volume data | Backup/restore tool (Velero, AWS Backup, volume snapshots) |
| External database state | RDS snapshot restore, point-in-time recovery |
| Secrets (if ESO/Vault) | ESO/Vault must be accessible; ExternalSecrets re-fetch automatically |
| Secrets (if SOPS in Git) | Recovered automatically from Git during reconciliation |
| TLS certificates (cert-manager) | cert-manager re-issues automatically after bootstrap |
| Cluster autoscaler state | Stateless — recovers automatically |

### RTO Targets by Recovery Scope

| Scope | GitOps RTO | Bottleneck |
| :--- | :--- | :--- |
| Application config only (same cluster) | < 5 minutes | Reconciliation interval |
| Full cluster rebuild (config only) | 15–30 minutes | Argo CD/Flux bootstrap + reconcile |
| Full cluster rebuild (with data restore) | 1–4 hours | Volume/database restore |
| Multi-cluster failover | < 15 minutes | DNS cutover + new cluster already warm |

### Pre-Warm Standby Pattern

For sub-15-minute RTO requirements, maintain a pre-bootstrapped standby cluster that is continuously reconciled by the same GitOps repo. Failover is a DNS record update — the standby is always current with the desired state. The cost is running a second cluster at idle capacity.

---

## 14. Anti-Patterns & Failure Modes

| Anti-Pattern | What it costs you |
| :--- | :--- |
| **Committing unencrypted secrets to Git** | Permanent credential exposure — Git history cannot be safely purged from all forks and clones |
| **Using `latest` image tags in manifests** | Deploys are not reproducible; drift between environments is invisible; rollback has no stable target |
| **Disabling selfHeal in production** | Drift accumulates silently; the cluster state diverges from Git without alerting anyone |
| **No AppProject or namespace scoping** | Any team can deploy any resource to any namespace — a misconfiguration in one team's repo can break the entire cluster |
| **Storing deploy credentials in CI (push model)** | CI system compromise = cluster compromise; credentials require manual rotation; no audit trail of what the CI system did |
| **One Git branch per environment** | Branch divergence is merge conflict debt; long-lived env branches defeat the purpose of trunk-based GitOps |
| **No prune enabled** | Deleted resources in Git continue running in the cluster — orphaned workloads, dangling services, accumulated resource waste |
| **Skipping health checks on sync** | Pipeline marks deploy as successful before pods are ready; errors surface as user-reported incidents, not pipeline failures |
| **Manual `kubectl` changes without a Git commit** | Changes are overwritten on next reconciliation; the engineer's fix is silently reverted; produces oncall confusion |
| **Monolithic root Kustomization with no health check scoping** | A single unhealthy deployment blocks reconciliation of the entire cluster path — one broken app cascades to all apps |
| **No notification on OutOfSync** | Drift goes undetected until it causes an incident; the gap between desired and actual state widens silently |
| **Using default Argo CD admin credentials in production** | Shared credentials, no audit trail, single point of compromise — use SSO integration with your IdP |