# Blue/Green Deployment – Implementation Guide

## Core Concept

Two identical environments run simultaneously. Only one takes live traffic at a time.
The **switch** (LB rule, Service selector, DNS record) is the only difference between them.
Rollback = flip the switch back. Old environment stays warm until you're confident.

---

## Kubernetes Implementation (kubectl)

### namespace.yaml
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: myapp
spec:
  selector:
    app: myapp
    slot: blue        # ← change this to cutover
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

### deploy-blue.yaml
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
  namespace: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      slot: blue
  template:
    metadata:
      labels:
        app: myapp
        slot: blue
    spec:
      containers:
        - name: myapp
          image: myrepo/myapp:v1
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
```

### deploy-green.yaml
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
  namespace: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      slot: green
  template:
    metadata:
      labels:
        app: myapp
        slot: green
    spec:
      containers:
        - name: myapp
          image: myrepo/myapp:v2     # new image
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
```

### service-green-test.yaml (pre-cutover smoke testing)
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-green-test
  namespace: myapp
spec:
  selector:
    app: myapp
    slot: green
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

### PodDisruptionBudget (production)
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-blue-pdb
  namespace: myapp
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: myapp
      slot: blue
```

### GitHub Actions – CI cutover pipeline
```yaml
name: Blue/Green Deploy
on:
  push:
    branches: [main]

env:
  IMAGE: myrepo/myapp
  NAMESPACE: myapp

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up kubeconfig
        uses: azure/k8s-set-context@v3
        with:
          kubeconfig: ${{ secrets.KUBECONFIG }}

      - name: Determine active slot
        id: slot
        run: |
          ACTIVE=$(kubectl get svc myapp -n $NAMESPACE \
            -o jsonpath='{.spec.selector.slot}')
          echo "active=$ACTIVE" >> $GITHUB_OUTPUT
          if [ "$ACTIVE" = "blue" ]; then
            echo "target=green" >> $GITHUB_OUTPUT
          else
            echo "target=blue" >> $GITHUB_OUTPUT
          fi

      - name: Build and push image
        run: |
          docker build -t $IMAGE:${{ github.sha }} .
          docker push $IMAGE:${{ github.sha }}

      - name: Deploy to idle slot
        run: |
          kubectl set image deployment/myapp-${{ steps.slot.outputs.target }} \
            myapp=$IMAGE:${{ github.sha }} -n $NAMESPACE
          kubectl rollout status deployment/myapp-${{ steps.slot.outputs.target }} \
            -n $NAMESPACE --timeout=120s

      - name: Smoke test idle slot
        run: |
          kubectl run smoke-${{ github.run_id }} \
            --rm -it --image=curlimages/curl --restart=Never -n $NAMESPACE \
            -- curl -sf --retry 5 --retry-delay 3 \
            http://myapp-${{ steps.slot.outputs.target }}-test.$NAMESPACE.svc.cluster.local/healthz

      - name: Cutover traffic
        run: |
          kubectl patch service myapp -n $NAMESPACE \
            --type='json' \
            -p="[{\"op\":\"replace\",\"path\":\"/spec/selector/slot\",\"value\":\"${{ steps.slot.outputs.target }}\"}]"

      - name: Verify live traffic
        run: |
          sleep 10
          kubectl run verify-${{ github.run_id }} \
            --rm -it --image=curlimages/curl --restart=Never -n $NAMESPACE \
            -- curl -sf http://myapp.$NAMESPACE.svc.cluster.local/healthz

      - name: Rollback on failure
        if: failure()
        run: |
          kubectl patch service myapp -n $NAMESPACE \
            --type='json' \
            -p="[{\"op\":\"replace\",\"path\":\"/spec/selector/slot\",\"value\":\"${{ steps.slot.outputs.active }}\"}]"
```

---

## GitOps Implementation (Flux CD + Helm)

### Repo structure
```
infra/
└── apps/
    └── myapp/
        ├── helmrelease-blue.yaml
        ├── helmrelease-green.yaml
        ├── service.yaml
        ├── service-green-test.yaml
        └── kustomization.yaml
```

### HelmRepository source
```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: myapp-charts
  namespace: flux-system
spec:
  interval: 5m
  url: https://charts.myrepo.io
```

### helmrelease-blue.yaml
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: myapp-blue
  namespace: myapp
spec:
  interval: 5m
  chart:
    spec:
      chart: myapp
      version: "1.x"
      sourceRef:
        kind: HelmRepository
        name: myapp-charts
        namespace: flux-system
  values:
    slot: blue
    image:
      repository: myrepo/myapp
      tag: "v1.4.2"           # bump this in Git to update Blue
    replicaCount: 3
    service:
      enabled: false
    podLabels:
      slot: blue
```

### helmrelease-green.yaml
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: myapp-green
  namespace: myapp
spec:
  interval: 5m
  chart:
    spec:
      chart: myapp
      version: "2.x"
      sourceRef:
        kind: HelmRepository
        name: myapp-charts
        namespace: flux-system
  values:
    slot: green
    image:
      repository: myrepo/myapp
      tag: "v2.0.0"           # new version being staged
    replicaCount: 3
    service:
      enabled: false
    podLabels:
      slot: green
```

### service.yaml – cutover lives here
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: myapp
spec:
  selector:
    app: myapp
    slot: blue          # ← THE ONLY LINE YOU CHANGE IN GIT TO CUTOVER
  ports:
    - port: 80
      targetPort: 8080
```

### Flux Kustomization (reconciler)
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 5m
  path: ./infra/apps/myapp
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: myapp-blue
      namespace: myapp
    - apiVersion: apps/v1
      kind: Deployment
      name: myapp-green
      namespace: myapp
  timeout: 3m
```

### GitHub Actions – image tag bump + PR
```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  bump-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Determine idle slot
        id: slot
        run: |
          LIVE=$(grep 'slot:' infra/apps/myapp/service.yaml \
            | tail -1 | awk '{print $2}')
          if [ "$LIVE" = "blue" ]; then
            echo "idle=green" >> $GITHUB_OUTPUT
          else
            echo "idle=blue" >> $GITHUB_OUTPUT
          fi
          echo "tag=${GITHUB_REF_NAME}" >> $GITHUB_OUTPUT

      - name: Bump image tag in idle HelmRelease
        run: |
          FILE="infra/apps/myapp/helmrelease-${{ steps.slot.outputs.idle }}.yaml"
          sed -i "s/tag: .*/tag: \"${{ steps.slot.outputs.tag }}\"/" $FILE

      - name: Open PR
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          branch: deploy/${{ steps.slot.outputs.tag }}
          title: "deploy: ${{ steps.slot.outputs.tag }} → ${{ steps.slot.outputs.idle }}"
          body: |
            ## Blue/Green deploy
            - **Version:** `${{ steps.slot.outputs.tag }}`
            - **Target slot:** `${{ steps.slot.outputs.idle }}`

            ### Pre-merge checklist
            - [ ] Green pods healthy (`kubectl get pods -n myapp -l slot=green`)
            - [ ] Smoke test passed against `myapp-green-test` service
            - [ ] Ready to cut over

            ### To cut over
            After merging this PR, open another PR changing `slot:` in `service.yaml`.
          commit-message: "chore: bump ${{ steps.slot.outputs.idle }} to ${{ steps.slot.outputs.tag }}"
```

---

## GitOps End-to-End Flow

```
1. Dev pushes tag v2.0.0
        ↓
2. GitHub Actions opens PR: bump helmrelease-green.yaml image tag → v2.0.0
        ↓
3. PR merged → Flux reconciles → Green Deployment rolls out v2 pods
        ↓
4. Verify:
   flux get helmreleases -n myapp
   kubectl get pods -n myapp -l slot=green
   curl http://myapp-green-test.myapp.svc/healthz
        ↓
5. Open PR: change service.yaml  slot: blue → slot: green
        ↓
6. PR reviewed + merged → Flux reconciles Service in <5min
        ↓
7. Traffic live on Green. Monitor.
        ↓
8. Rollback: revert the service.yaml PR → Flux reconciles back
```

### Force immediate reconciliation
```bash
flux reconcile kustomization myapp --with-source
flux get kustomizations myapp --watch
kubectl get svc myapp -n myapp -o jsonpath='{.spec.selector.slot}'
```

---

## Key Rules

| Rule | Why |
|------|-----|
| Readiness probes are mandatory | `rollout status` waits on them; without it you cut over to unready pods |
| Keep old slot running post-cutover | Instant rollback window (keep for 15–30 min minimum) |
| Never break DB schema in same deploy as cutover | Both versions must be schema-compatible simultaneously |
| In GitOps: cutover = PR to service.yaml | Git is the audit trail, review gate, and rollback mechanism |
| PodDisruptionBudget in production | Prevents node drain from killing too many pods mid-cutover |
| DNS TTL set low before multi-region cutover | Otherwise clients cache the old region for the full TTL |
