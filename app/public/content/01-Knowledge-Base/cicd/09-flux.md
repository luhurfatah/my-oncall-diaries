# Flux — Core Concepts & Best Practices

Flux is a set of continuous and progressive delivery solutions for Kubernetes that are open and extensible. It is built from the ground up to use Kubernetes' API extension system (Custom Resource Definitions) and integrates smoothly with core Kubernetes tooling.

## 1. Setup & Bootstrapping

### Bootstrap Flux

Bootstrapping installs Flux on a cluster and configures it to manage itself from a Git repository.

```bash
flux bootstrap github \
  --owner=org \
  --repository=config-repo \
  --branch=main \
  --path=clusters/prod \
  --personal
```

## 2. Core Resources

### GitRepository Source

Defines the Git repository where your desired state is stored.

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: config-repo
  namespace: flux-system
spec:
  interval: 1m          # How often to poll Git
  url: https://github.com/org/config-repo
  ref:
    branch: main
  secretRef:
    name: git-credentials
```

### Kustomization

Tells Flux to apply Kustomize manifests from a specific path in the defined source.

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: myapp-prod
  namespace: flux-system
spec:
  interval: 5m
  path: ./environments/prod/myapp
  prune: true           # Delete resources removed from Git
  sourceRef:
    kind: GitRepository
    name: config-repo
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: myapp
      namespace: myapp-prod
  timeout: 2m
```

### HelmRelease

Manages Helm chart releases declaratively.

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: myapp
  namespace: myapp-prod
spec:
  interval: 10m
  chart:
    spec:
      chart: myapp
      version: "~1.2"
      sourceRef:
        kind: HelmRepository
        name: myapp-charts
        namespace: flux-system
  values:
    image:
      tag: "1.2.3"
    replicas: 3
  upgrade:
    remediation:
      remediateLastFailure: true    # Auto-rollback on failed upgrade
  rollback:
    timeout: 5m
```

## 3. Image Update Automation

Flux can automatically update image tags in your Git repository when new images are pushed to a container registry.

```yaml
# 1. Watch the image registry
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: myapp
  namespace: flux-system
spec:
  image: myrepo/myapp
  interval: 5m

# 2. Define update policy (e.g., semver range)
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
      range: ">=1.0.0 <2.0.0"

# 3. Automate Git commits to update the manifests
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImageUpdateAutomation
metadata:
  name: flux-system
  namespace: flux-system
spec:
  interval: 5m
  sourceRef:
    kind: GitRepository
    name: config-repo
  git:
    checkout:
      ref:
        branch: main
    commit:
      author:
        name: Flux Bot
        email: flux@example.com
      messageTemplate: "chore: update {{range .Updated.Images}}{{.}}{{end}}"
    push:
      branch: main
```

- Image automation commits tag updates back to Git, maintaining a full audit trail.
- Use **semver policies** to avoid automatically rolling out breaking major versions.

## 4. Observability

### Key Prometheus Metrics

```text
gotk_reconcile_condition                     # Source/Kustomization health
gotk_reconcile_duration_seconds              # How long reconciliation takes
```

## 5. Useful CLI Commands

```bash
flux get all -n flux-system
flux get kustomizations
flux reconcile source git config-repo
flux reconcile kustomization myapp-prod
flux suspend kustomization myapp-prod   # Pause reconciliation
flux resume kustomization myapp-prod
flux logs --level=error                 # Error logs from controllers
flux diff kustomization myapp-prod      # Diff live vs desired state
```
