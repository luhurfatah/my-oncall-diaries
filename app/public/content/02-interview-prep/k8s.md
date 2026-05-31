# Kubernetes Interview Preparation

### Q: What are the different types of Services in Kubernetes (ClusterIP, NodePort, LoadBalancer)?

<details>
<summary>Show Answer</summary>

A Kubernetes **Service** is a stable network endpoint in front of a dynamic set of pods — pods come and go, but the Service IP and DNS name stay constant. The type controls *where* the Service is reachable from.

**Service types:**

| Type | Reachable From | Use Case |
| :--- | :--- | :--- |
| **ClusterIP** | Inside the cluster only | Internal service-to-service communication |
| **NodePort** | Outside cluster via `<NodeIP>:<NodePort>` | Dev/test access; not for production |
| **LoadBalancer** | Outside cluster via cloud load balancer | Production external traffic (AWS ALB/NLB) |
| **ExternalName** | Inside cluster, resolves to external DNS | Route in-cluster traffic to an external hostname |

**ClusterIP (default):**
```yaml
spec:
  type: ClusterIP       # Omitting `type:` also defaults to ClusterIP
  selector:
    app: payments
  ports:
    - port: 80          # Port exposed inside the cluster
      targetPort: 8080  # Port on the pod
```
Every ClusterIP service gets a DNS name: `payments.default.svc.cluster.local`. Other pods use this — no direct pod IP needed.

**NodePort:**
```yaml
spec:
  type: NodePort
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080   # Fixed port on every node (30000–32767)
```
Traffic hits `<any-node-ip>:30080` and is forwarded to the pods. Exposes a port on every node — problematic for security and ephemeral node IPs.

**LoadBalancer:**
```yaml
spec:
  type: LoadBalancer
  ports:
    - port: 443
      targetPort: 8443
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
```
Provisions a cloud load balancer (AWS NLB/ALB via the AWS Load Balancer Controller). The `EXTERNAL-IP` field shows the load balancer DNS once provisioned.

**LoadBalancer vs. Ingress:**
- `LoadBalancer` service = one LB per service (expensive for many services).
- **Ingress** = one LB shared across many services, with path/host-based routing. Preferred for HTTP workloads.

> **Gotcha:** `NodePort` and `LoadBalancer` still create a `ClusterIP` internally — they're additive. Deleting a `LoadBalancer` service immediately terminates the cloud LB, which can cause a brief traffic drop. Use a drain window in production before deleting.

</details>

---

### Q: What are readiness probes and liveness probes?

<details>
<summary>Show Answer</summary>

Probes are how Kubernetes knows whether a container is healthy. Getting them wrong causes either constant restarts or routing traffic to pods that can't handle it — both are production incidents.

**The distinction:**

| Probe | Question It Answers | Failure Consequence |
| :--- | :--- | :--- |
| **Liveness** | Is the container still alive and should it keep running? | Container is restarted |
| **Readiness** | Is the container ready to receive traffic? | Pod is removed from Service endpoints (not restarted) |
| **Startup** | Has the container finished starting up? | Delays liveness/readiness checks until startup completes |

**Liveness probe:** Catches deadlocks or processes that are running but frozen. If it fails, Kubernetes kills and restarts the container.

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 15   # Wait before first check (give app time to start)
  periodSeconds: 10
  failureThreshold: 3        # Restart after 3 consecutive failures
```

**Readiness probe:** Controls traffic routing. A pod that fails readiness is silently removed from the Service's endpoint list — requests stop going to it, but it isn't restarted.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
```

**Startup probe:** For slow-starting apps (JVM, large ML models). Gives the container time to start before liveness kicks in — prevents a slow-start app from being killed in a restart loop.

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30   # Allow up to 30 * 10s = 5 minutes to start
  periodSeconds: 10
```

**What the `/healthz` vs `/ready` endpoints should do:**
- `/healthz` (liveness): Return 200 if the process is alive. Keep it cheap — a basic HTTP 200 is enough.
- `/ready` (readiness): Return 200 only when the app is ready to serve real traffic — database connected, caches warm, background jobs running.

> **Gotcha:** A common mistake is using the same endpoint for both probes. If your app's DB connection drops, liveness fails → pod restarts → DB gets hammered by reconnects from all pods simultaneously. Decouple them: liveness checks process health; readiness checks dependency health.

</details>

---

### Q: What is an Ingress and how does it work in Kubernetes?

<details>
<summary>Show Answer</summary>

An **Ingress** is a Kubernetes API object that defines HTTP(S) routing rules — host-based and path-based — for external traffic entering the cluster. It is not a load balancer itself; it requires an **Ingress Controller** to implement the rules.

**Architecture:**

```
Internet
   ↓
Ingress Controller (AWS ALB / nginx / Traefik)
   ↓ host/path routing rules
┌──────────────────────────────┐
│  /api/*  → api-service:80   │
│  /app/*  → web-service:80   │
│  *.other.com → other:8080   │
└──────────────────────────────┘
```

**Ingress resource example:**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    kubernetes.io/ingress.class: "alb"
    alb.ingress.kubernetes.io/scheme: "internet-facing"
    alb.ingress.kubernetes.io/certificate-arn: "arn:aws:acm:..."
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /v1/payments
            pathType: Prefix
            backend:
              service:
                name: payments-service
                port:
                  number: 80
          - path: /v1/orders
            pathType: Prefix
            backend:
              service:
                name: orders-service
                port:
                  number: 80
  tls:
    - hosts:
        - api.example.com
      secretName: tls-cert-secret
```

**Popular Ingress controllers:**

| Controller | Backing LB | Best For |
| :--- | :--- | :--- |
| **AWS Load Balancer Controller** | AWS ALB | EKS — native AWS integration, WAF, ACM certs |
| **nginx-ingress** | nginx pods | Self-managed clusters, advanced routing |
| **Traefik** | Traefik pods | Auto-discovery, Let's Encrypt, simple config |
| **Istio Gateway** | Envoy proxies | Service mesh environments |

**IngressClass (v1.18+):**

```yaml
spec:
  ingressClassName: alb   # Replaces the deprecated annotation approach
```

Multiple controllers can coexist in a cluster; `ingressClassName` routes each Ingress to the right controller.

> **Gotcha:** An Ingress resource with no matching controller does nothing — no error, no routing, just silence. Always verify the controller is installed and the `ingressClassName` matches. On EKS, the AWS Load Balancer Controller must be installed separately via Helm and needs an appropriate IAM role (IRSA).

</details>

---

### Q: How do resource requests and limits help in resource management?

<details>
<summary>Show Answer</summary>

Requests and limits are how Kubernetes manages CPU and memory allocation across the cluster. Getting them wrong causes either wasted capacity or cascading OOMKills in production.

**Definitions:**

| Field | Meaning | Used By |
| :--- | :--- | :--- |
| `requests` | Minimum guaranteed resources | Scheduler (decides which node to place the pod on) |
| `limits` | Maximum allowed resources | Kubelet (enforces ceiling at runtime) |

```yaml
resources:
  requests:
    cpu: "250m"      # 0.25 vCPU guaranteed
    memory: "256Mi"
  limits:
    cpu: "1000m"     # 1 vCPU maximum (CPU is throttled, not killed)
    memory: "512Mi"  # Memory: pod is OOMKilled if exceeded
```

**CPU vs. memory behavior when limits are hit:**

- **CPU limit exceeded:** Container is **throttled** (slowed down). It is not killed. CPU is compressible.
- **Memory limit exceeded:** Container is **OOMKilled** and restarted. Memory is incompressible — Kubernetes cannot take memory back from a running process.

**QoS classes (derived from requests/limits):**

| QoS Class | Condition | Eviction Priority |
| :--- | :--- | :--- |
| **Guaranteed** | requests == limits for all containers | Last to be evicted |
| **Burstable** | requests set, limits higher or absent | Middle priority |
| **BestEffort** | No requests or limits set | First to be evicted |

For production workloads, use **Guaranteed** QoS (set requests == limits) to prevent eviction under node pressure.

**LimitRange (namespace-level defaults):**

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
spec:
  limits:
    - default:
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      type: Container
```

Applies default requests/limits to any pod in the namespace that doesn't set them — prevents `BestEffort` pods from consuming unbounded resources.

**ResourceQuota (namespace-level ceiling):**

```yaml
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
```

Caps the total resources a namespace can request — useful for multi-tenant clusters.

> **Gotcha:** Setting memory limits too low causes intermittent OOMKills that look like application crashes. Profile your actual memory usage under load before setting limits — use `kubectl top pods` or Datadog/Prometheus metrics. A common pattern is to start with no limits, observe p99 usage over a week, then set limits at 1.5–2× p99.

</details>

---

### Q: What are taints and tolerations in Kubernetes?

<details>
<summary>Show Answer</summary>

Taints and tolerations control which pods can be scheduled onto which nodes — they're the mechanism for **repelling** pods from nodes unless the pod explicitly opts in.

**Concepts:**

- A **taint** is applied to a node: "don't schedule pods here unless they tolerate this."
- A **toleration** is applied to a pod: "I can tolerate this taint — schedule me on tainted nodes."

**Taint effects:**

| Effect | Behavior |
| :--- | :--- |
| `NoSchedule` | New pods without toleration won't be scheduled here |
| `PreferNoSchedule` | Scheduler tries to avoid this node, but will use it if necessary |
| `NoExecute` | Existing pods without toleration are evicted; new ones not scheduled |

**Example — dedicated GPU nodes:**

```bash
# Taint the GPU node
kubectl taint nodes gpu-node-1 dedicated=gpu:NoSchedule
```

```yaml
# Pod that tolerates the taint (can be scheduled on GPU nodes)
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"
```

Pods without this toleration will never be scheduled on `gpu-node-1`. Pods with it can be scheduled there (but won't be *forced* there — that's `nodeAffinity`'s job).

**Common real-world uses:**

| Use Case | Taint | Toleration On |
| :--- | :--- | :--- |
| Spot instance nodes | `spot=true:NoSchedule` | Batch/fault-tolerant workloads only |
| System-only nodes (monitoring, ingress) | `role=infra:NoSchedule` | DaemonSets and infra pods |
| GPU nodes | `nvidia.com/gpu=true:NoSchedule` | ML workload pods |
| Node under maintenance | `maintenance=true:NoExecute` | Nothing — evicts all pods |

**Taints + Node Affinity together:**
Taints repel unwanted pods. `nodeAffinity` attracts desired pods to the right node. Use both to ensure dedicated workloads land on dedicated nodes and nothing else does:

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: dedicated
              operator: In
              values: [gpu]
tolerations:
  - key: dedicated
    value: gpu
    effect: NoSchedule
```

> **Gotcha:** `NoExecute` taints evict running pods immediately unless the toleration includes `tolerationSeconds`. If you taint a node for maintenance without setting `tolerationSeconds` on critical pods, they evict with zero graceful shutdown time. Use `kubectl drain` instead — it respects `PodDisruptionBudgets` and `terminationGracePeriodSeconds`.

</details>

---

### Q: What's the role of Helm charts in Kubernetes deployments, and how do you use them?

<details>
<summary>Show Answer</summary>

Helm is the package manager for Kubernetes. A chart is a reusable, parameterised bundle of Kubernetes manifests — it solves the problem of managing tens of YAML files across environments without copy-pasting.

**Core concepts:**

| Concept | Description |
| :--- | :--- |
| **Chart** | A package of Kubernetes manifests + a `values.yaml` schema |
| **Release** | A deployed instance of a chart in a cluster (one chart, many releases) |
| **Values** | Input parameters that customise a chart at deploy time |
| **Repository** | A hosted index of charts (Artifact Hub, ECR, private Chartmuseum) |

**Basic usage:**

```bash
# Add a chart repo
helm repo add bitnami https://charts.bitnami.com/bitnami

# Install a chart as a release
helm install my-postgres bitnami/postgresql \
  --namespace databases \
  --set auth.password=supersecret \
  --values prod-values.yaml

# Upgrade a release
helm upgrade my-postgres bitnami/postgresql --values prod-values.yaml

# Roll back to a previous revision
helm rollback my-postgres 2

# List releases
helm list -A
```

**Chart structure:**

```
mychart/
├── Chart.yaml          # Chart metadata (name, version, appVersion)
├── values.yaml         # Default values
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── _helpers.tpl    # Named template helpers (reusable snippets)
└── charts/             # Subchart dependencies
```

**Template example:**

```yaml
# templates/deployment.yaml
replicas: {{ .Values.replicaCount }}
image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
```

**values.yaml:**

```yaml
replicaCount: 2
image:
  repository: myorg/myapp
  tag: ""   # Defaults to Chart.AppVersion if empty
```

**Helm vs. raw kubectl apply:**
- Helm tracks release history — `helm rollback` is instant.
- Helm diffs before apply with `helm diff upgrade` (plugin).
- Helm manages lifecycle: install, upgrade, rollback, uninstall as atomic operations.
- `kubectl apply` has no built-in history or rollback.

> **Gotcha:** `helm install` on an existing release fails — use `helm upgrade --install` to make it idempotent. Also, `helm uninstall` deletes all resources but does **not** delete PersistentVolumeClaims by default — data survives, which is usually what you want, but can cause state confusion if you reinstall with different storage settings.

</details>

---

### Q: How do you debug a pod that is stuck in a CrashLoopBackOff state?

<details>
<summary>Show Answer</summary>

`CrashLoopBackOff` means the container starts, crashes, and Kubernetes keeps retrying with an exponential backoff (10s → 20s → 40s → … up to 5 minutes). The pod is crashing; Kubernetes is just waiting before trying again.

**Systematic debug process:**

**Step 1 — Get the exit reason and last logs:**

```bash
kubectl describe pod <pod-name> -n <namespace>
# Look at: Last State, Exit Code, Reason, Events section at the bottom

kubectl logs <pod-name> -n <namespace>               # Current container logs
kubectl logs <pod-name> -n <namespace> --previous    # Logs from the crashed container
```

The `--previous` flag is critical — the current container may have no logs because it crashed immediately. The previous run's logs show the actual error.

**Step 2 — Interpret the exit code:**

| Exit Code | Meaning |
| :--- | :--- |
| `0` | Process exited cleanly — container command finished (not an error for Jobs) |
| `1` | Application error — check app logs |
| `137` | OOMKilled (`128 + 9`) — memory limit exceeded |
| `139` | Segfault (`128 + 11`) |
| `143` | SIGTERM not handled (`128 + 15`) — graceful shutdown issue |

**Step 3 — Common causes and fixes:**

| Root Cause | Signal | Fix |
| :--- | :--- | :--- |
| **OOMKilled** | Exit code 137, `Reason: OOMKilled` in describe | Increase memory limit or fix memory leak |
| **Missing env var / config** | App logs show config error on startup | Check ConfigMap/Secret mounts and env var names |
| **Bad entrypoint/command** | Exit code 1 immediately | Check `command:` and `args:` in pod spec |
| **Missing Secret or ConfigMap** | `describe` shows `MountVolume.SetUp failed` | Create the missing Secret/ConfigMap |
| **Image pull failure** | `ImagePullBackOff`, not `CrashLoopBackOff` | Check image name, tag, and registry credentials |
| **Liveness probe too aggressive** | Pod killed repeatedly after short intervals | Increase `initialDelaySeconds` or use startup probe |
| **Dependency not ready** | App tries to connect to DB before it's up | Add init container or retry logic in app |

**Step 4 — Run the container interactively to debug:**

```bash
# Override the entrypoint to drop into a shell (bypasses the crashing process)
kubectl run debug --image=myorg/myapp:latest -it --restart=Never \
  --command -- /bin/sh

# Or exec into a running (but crashing) pod during its brief alive window
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh
```

**Step 5 — Check events:**

```bash
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | tail -20
```

Events often show the real reason (eviction, quota exceeded, image pull error) that doesn't appear in pod logs.

> **Gotcha:** Pods in `CrashLoopBackOff` have progressively longer restart intervals — after several crashes, you may wait 5 minutes between each attempt. To force an immediate restart without deleting the pod, delete it: `kubectl delete pod <name>` and the Deployment will recreate it immediately, resetting the backoff timer.

</details>

---

### Q: The Kubernetes cluster is experiencing pod scheduling issues. Walk me through how you would troubleshoot this.

<details>
<summary>Show Answer</summary>

Pod scheduling failures mean the scheduler cannot find a node to place the pod on. The pod stays in `Pending` state indefinitely. Diagnosis is systematic: rule out resource constraints, then affinity rules, then taints, then quotas.

**Step 1 — Confirm the pod is Pending and check events:**

```bash
kubectl get pods -n <namespace> | grep Pending
kubectl describe pod <pod-name> -n <namespace>
# The Events section at the bottom is the most important part
```

Common event messages and what they mean:

| Event Message | Root Cause |
| :--- | :--- |
| `0/3 nodes are available: 3 Insufficient memory` | No node has enough free memory |
| `0/3 nodes are available: 3 node(s) had untolerated taint` | Pod lacks required toleration |
| `0/3 nodes are available: 3 node(s) didn't match Pod's node affinity` | nodeAffinity/nodeSelector mismatch |
| `0/3 nodes are available: 3 node(s) didn't have free ports` | `hostPort` conflict |
| `exceeded quota: requests.cpu` | Namespace ResourceQuota exhausted |
| `PersistentVolumeClaim is not bound` | PVC not fulfilled — no matching PV or StorageClass |

**Step 2 — Check node resources:**

```bash
kubectl top nodes                        # Current CPU/memory usage
kubectl describe nodes | grep -A5 "Allocated resources"
kubectl get nodes -o wide                # Check node status (Ready/NotReady)
```

If all nodes are at high allocation, the scheduler has nowhere to place the pod. Options: scale the node group, reduce requests on the pod, or add a new node type.

**Step 3 — Check for taints:**

```bash
kubectl describe nodes | grep Taints
```

If a node has `NoSchedule` taints the pod doesn't tolerate, it can't land there.

**Step 4 — Check nodeSelector and affinity:**

```bash
kubectl get pod <name> -o yaml | grep -A20 "affinity:"
kubectl get pod <name> -o yaml | grep "nodeSelector" -A5
```

If the pod requires a label that no node has (e.g., `disktype=ssd` but no node is labelled that), it will never schedule.

**Step 5 — Check ResourceQuota:**

```bash
kubectl describe resourcequota -n <namespace>
# Shows hard limits vs. current usage — if used == hard, new pods can't be scheduled
```

**Step 6 — Check PVC binding (if pod uses persistent storage):**

```bash
kubectl get pvc -n <namespace>
kubectl describe pvc <pvc-name> -n <namespace>
# STATUS should be Bound — if Pending, the PV or StorageClass has a problem
```

**Step 7 — Cluster autoscaler (if EKS with managed node groups):**

```bash
kubectl logs -n kube-system deployment/cluster-autoscaler | tail -50
```

If the autoscaler is enabled but not adding nodes, look for scale-out blockers: node group at max size, unsupported instance type, IAM permission error.

> **Gotcha:** A pod can be `Pending` even with available node capacity if it has a `podAntiAffinity` rule that prevents it from co-locating with existing replicas. If you have 3 replicas with `requiredDuringSchedulingIgnoredDuringExecution` anti-affinity and only 3 nodes, a 4th replica will never schedule. Switch to `preferredDuringSchedulingIgnoredDuringExecution` or increase node count.

</details>

---

### Q: Your application depends on another service being available first. How would you ensure proper startup order?

<details>
<summary>Show Answer</summary>

Kubernetes does not guarantee pod startup order natively — even if Service B starts before Service A in a manifest, there's no guarantee Service B is ready when Service A needs it. The right solution depends on the strictness of the dependency.

**Option 1 — Init Containers (recommended for hard dependencies):**

Init containers run to completion before the main container starts. They share the pod's network namespace, so you can poll a dependency from within the pod.

```yaml
spec:
  initContainers:
    - name: wait-for-postgres
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          until nc -z postgres-service 5432; do
            echo "Waiting for postgres..."
            sleep 2
          done
  containers:
    - name: myapp
      image: myorg/myapp:latest
```

The main container (`myapp`) only starts after the init container exits 0 — i.e., after postgres is accepting connections.

**Option 2 — Readiness probes + retry logic (recommended for loose dependencies):**

Don't block startup — instead, write the application to retry connections with backoff. The readiness probe marks the pod as not-ready until the dependency is available, so no traffic is routed to it while it's waiting.

```yaml
readinessProbe:
  httpGet:
    path: /ready    # Returns 200 only after DB connection established
    port: 8080
  periodSeconds: 5
  failureThreshold: 10
```

This is more resilient than init containers because it handles transient dependency failures *after* startup too, not just at init time.

**Option 3 — Kubernetes Job dependency with `helm` hooks:**

For database migrations that must complete before the app starts:

```yaml
# Helm hook: run migration Job before Deployment is created
annotations:
  "helm.sh/hook": pre-install,pre-upgrade
  "helm.sh/hook-weight": "-5"
  "helm.sh/hook-delete-policy": before-hook-creation
```

**Option 4 — ArgoCD sync waves:**

In GitOps workflows, ArgoCD sync waves let you control the order resources are applied:

```yaml
annotations:
  argocd.argoproj.io/sync-wave: "1"   # Lower number = earlier
```

Wave 1 (databases) → Wave 2 (backend services) → Wave 3 (frontend).

**What to avoid:**
- Don't use `sleep` in init containers with a fixed duration — too fragile; slow environments will fail, fast environments waste time.
- Don't use `depends_on`-style logic at the Deployment level — Kubernetes has no such primitive. Model it at the pod level.

> **Gotcha:** Init containers restart the entire pod if they fail. If your init container polls for 10 minutes and then fails, the main container never runs and the pod enters `Init:CrashLoopBackOff`. Add a timeout and clear error messaging so the failure is diagnosable.

</details>

---

### Q: You updated a ConfigMap, but the application is still using old values. How do you apply the change?

<details>
<summary>Show Answer</summary>

This is a common gotcha: Kubernetes updates the ConfigMap in etcd, but running pods do not automatically reload it. The mechanism for picking up the change depends on how the ConfigMap is consumed.

**How ConfigMaps are consumed — and what reload behavior each has:**

| Consumption Method | Auto-reload? | Notes |
| :--- | :--- | :--- |
| **Environment variables** (`envFrom` / `env.valueFrom`) | ❌ Never | Env vars are set at container start; only a pod restart picks up changes |
| **Mounted as a volume** | ✅ Eventually | Kubelet refreshes the file on disk (default: ~60s via `syncPeriod`) |
| **Projected volume with `subPath`** | ❌ Never | `subPath` mounts bypass the auto-update mechanism |

**Case 1 — ConfigMap as env vars → must restart pods:**

```bash
# Force a rolling restart of the deployment
kubectl rollout restart deployment/myapp -n <namespace>

# Monitor the rollout
kubectl rollout status deployment/myapp -n <namespace>
```

There is no way to hot-reload env vars. A rolling restart is the correct answer.

**Case 2 — ConfigMap as volume mount → file updates, but app may not re-read it:**

The file on disk updates within ~60 seconds, but whether the application picks it up depends entirely on whether it watches for file changes. Most apps don't.

```bash
# Check when the file was last updated in the pod
kubectl exec -it <pod-name> -- ls -la /etc/config/
```

If the app doesn't hot-reload config files, you still need `kubectl rollout restart`.

**Best practice — hash-based rolling restart on ConfigMap change:**

Annotate the Deployment with a hash of the ConfigMap content. When the ConfigMap changes, the annotation changes, triggering a rolling restart automatically:

```yaml
# In Deployment pod template annotations:
annotations:
  checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
```

This is a Helm pattern — whenever `helm upgrade` runs with a changed ConfigMap, the pod template hash changes and Kubernetes rolls the pods.

**Kubernetes-native approach (Reloader controller):**

The **Stakater Reloader** controller watches ConfigMaps and Secrets and automatically triggers rolling restarts when they change:

```yaml
# Annotation on the Deployment
annotations:
  reloader.stakater.com/auto: "true"
```

> **Gotcha:** If you edit a ConfigMap and a volume mount shows the new value but the app behavior hasn't changed, the app is loading config at startup and caching it in memory. This is an application design issue — the fix is either to implement a config file watcher (e.g., Viper's `WatchConfig()` in Go) or accept that config changes require a pod restart.

</details>

---

### Q: Your team wants to use Helm to manage deployments. What benefits does it bring, and how would you structure your charts?

<details>
<summary>Show Answer</summary>

Helm brings **parameterisation, release management, and lifecycle operations** to Kubernetes deployments. The key value proposition is treating a multi-resource application as a single deployable unit with versioned history.

**Benefits:**

| Benefit | Without Helm | With Helm |
| :--- | :--- | :--- |
| **Parameterisation** | Copy-paste YAML per env | Single chart, per-env `values.yaml` |
| **Release history** | No native tracking | `helm history my-release` shows every revision |
| **Rollback** | Re-apply old manifests manually | `helm rollback my-release 3` — instant |
| **Atomic deploys** | Resources applied independently | Helm applies all-or-nothing; fails cleanly |
| **Dependency management** | Manual | `Chart.yaml` dependencies pulled automatically |
| **Templating** | None | Go templates + Sprig functions |

**Recommended chart structure for a team:**

```
charts/
└── myapp/
    ├── Chart.yaml              # name, version, appVersion, dependencies
    ├── values.yaml             # Shared defaults
    ├── values-staging.yaml     # Staging overrides
    ├── values-prod.yaml        # Prod overrides
    ├── templates/
    │   ├── _helpers.tpl        # Named templates (labels, selectors)
    │   ├── deployment.yaml
    │   ├── service.yaml
    │   ├── ingress.yaml
    │   ├── hpa.yaml
    │   ├── serviceaccount.yaml
    │   ├── configmap.yaml
    │   └── NOTES.txt           # Post-install instructions printed to stdout
    └── charts/                 # Subchart dependencies (e.g., postgresql)
```

**`_helpers.tpl` pattern — define labels once:**

```yaml
{{- define "myapp.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
{{- end }}
```

Used in every template: `{{- include "myapp.labels" . | nindent 4 }}`

**Values file strategy:**

```yaml
# values.yaml (shared defaults)
replicaCount: 1
image:
  repository: myorg/myapp
  tag: ""
resources:
  requests:
    cpu: 100m
    memory: 128Mi
```

```yaml
# values-prod.yaml (prod overrides only)
replicaCount: 3
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1Gi
```

```bash
helm upgrade --install myapp ./charts/myapp \
  --values charts/myapp/values.yaml \
  --values charts/myapp/values-prod.yaml \
  --namespace prod
```

**Versioning strategy:**
- Increment `Chart.yaml` `version` on chart structure changes.
- `appVersion` tracks the application version (e.g., the image tag default).
- Store charts in a Git monorepo or publish to a private OCI registry (`helm push`).
- Pin chart versions in ArgoCD ApplicationSets for GitOps deployments.

> **Gotcha:** Helm's Go templating can become unmaintainable — deeply nested `{{- if .Values.ingress.enabled }}` blocks and `range` loops are hard to debug. Keep templates readable. If a chart exceeds ~300 lines in a single template, split resources into sub-templates or consider whether a subchart abstraction makes sense. Use `helm template` locally to render and inspect the output before applying.

</details>

---

### Q: How do you manage secrets and configurations in a Kubernetes cluster on AWS?

<details>
<summary>Show Answer</summary>

The principle is the same as for any secrets management: **secrets never live in Git, never in plaintext in etcd, and always carry least-privilege access**. On AWS + EKS, there are several layers to combine.

**The problem with native Kubernetes Secrets:**

`kubectl create secret` stores values base64-encoded in etcd — not encrypted by default. Base64 is encoding, not encryption. Anyone with etcd access or `kubectl get secret` can read the value.

**Mitigation 1 — Encrypt etcd at rest (EKS):**

Enable KMS envelope encryption for Secrets in the EKS cluster config:

```yaml
encryptionConfig:
  - provider:
      kms:
        keyArn: arn:aws:kms:ap-southeast-1:123456789012:key/...
    resources:
      - secrets
```

Now Secret values are encrypted in etcd with a KMS key. `kubectl get secret` still works for authorised users — decryption is transparent — but raw etcd access is protected.

**Mitigation 2 — External Secrets Operator (recommended pattern):**

Never store the secret in Kubernetes at all. Store it in AWS Secrets Manager or SSM Parameter Store, and let the External Secrets Operator sync it into a Kubernetes Secret:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: db-credentials     # Creates a Kubernetes Secret with this name
  data:
    - secretKey: password    # Key in the Kubernetes Secret
      remoteRef:
        key: prod/myapp/db   # Path in AWS Secrets Manager
        property: password
```

The source of truth is Secrets Manager. The Kubernetes Secret is ephemeral and auto-rotated.

**Mitigation 3 — Secrets Store CSI Driver:**

Mount secrets directly into pods as files from Secrets Manager/SSM — the secret never becomes a Kubernetes Secret object at all:

```yaml
volumes:
  - name: secrets
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: aws-secrets
```

**IRSA for pod-level AWS access:**

Pods that need AWS access (S3, Secrets Manager, DynamoDB) should use **IAM Roles for Service Accounts (IRSA)** — not node-level instance profiles or static credentials:

```yaml
serviceAccountName: myapp-sa
# The SA is annotated with an IAM role ARN
# Only pods using this SA can assume the role
```

**Configuration (non-secret) strategy:**

- Non-sensitive config (feature flags, timeouts, log levels) → **ConfigMap** or **Helm values**.
- Environment-specific config → per-env `values.yaml` in Helm or separate Kustomize overlays.
- Shared config across services → **AWS AppConfig** or a central ConfigMap in a shared namespace.

> **Gotcha:** Rotating a secret in AWS Secrets Manager does not automatically update the Kubernetes Secret or restart the pods consuming it. Configure External Secrets Operator with a short `refreshInterval` (e.g., `1h`), and use the **Reloader** controller to trigger a pod rolling restart when the Secret object updates. Otherwise, pods run with stale credentials until the next restart.

</details>

---

### Q: Can you explain the steps involved in setting up a Kubernetes cluster on AWS using EKS?

<details>
<summary>Show Answer</summary>

EKS removes the burden of running the Kubernetes control plane — AWS manages the API server, etcd, and controller manager. Your responsibility is the data plane (nodes), networking, add-ons, and access control.

**High-level setup flow:**

```
1. Prerequisites
2. Cluster creation (control plane)
3. Node group creation (data plane)
4. Networking configuration
5. Core add-ons
6. Access control (RBAC + aws-auth)
7. Application workload add-ons
```

**Step 1 — Prerequisites:**

- VPC with public and private subnets across ≥2 AZs. Tag subnets correctly:
  - Public subnets: `kubernetes.io/role/elb = 1`
  - Private subnets: `kubernetes.io/role/internal-elb = 1`
- IAM roles: EKS cluster role, node instance role (or IRSA for managed node groups).

**Step 2 — Cluster creation (Terraform/eksctl):**

```hcl
# Terraform (aws_eks_cluster)
resource "aws_eks_cluster" "main" {
  name     = "prod-cluster"
  version  = "1.30"
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = false   # Disable public API server for prod
  }

  encryption_config {
    provider { key_arn = aws_kms_key.eks.arn }
    resources = ["secrets"]
  }
}
```

**Step 3 — Node groups:**

```hcl
resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "general"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnet_ids
  instance_types  = ["m5.xlarge"]

  scaling_config {
    desired_size = 3
    min_size     = 2
    max_size     = 10
  }
}
```

**Step 4 — Core add-ons (managed or self-managed):**

| Add-on | Purpose |
| :--- | :--- |
| **VPC CNI** (`aws-node`) | Pod networking — assigns VPC IPs to pods |
| **CoreDNS** | Cluster DNS resolution |
| **kube-proxy** | Service networking (iptables/ipvs rules) |
| **EBS CSI Driver** | Persistent volumes via EBS |
| **EFS CSI Driver** | Shared persistent volumes via EFS |

```bash
aws eks create-addon --cluster-name prod-cluster --addon-name vpc-cni --resolve-conflicts OVERWRITE
aws eks create-addon --cluster-name prod-cluster --addon-name coredns
aws eks create-addon --cluster-name prod-cluster --addon-name kube-proxy
```

**Step 5 — Access control:**

```bash
# Update kubeconfig for local access
aws eks update-kubeconfig --region ap-southeast-1 --name prod-cluster

# Grant IAM users/roles access via aws-auth ConfigMap (or EKS access entries in newer API)
kubectl edit configmap aws-auth -n kube-system
```

**Step 6 — Application add-ons:**

- **AWS Load Balancer Controller** — Ingress and LoadBalancer Service support.
- **Cluster Autoscaler** or **Karpenter** — automatic node scaling.
- **External DNS** — auto-creates Route53 records for Ingress/Service objects.
- **External Secrets Operator** — syncs Secrets Manager into Kubernetes Secrets.
- **Metrics Server** — enables `kubectl top` and HPA.

**Step 7 — Validate:**

```bash
kubectl get nodes                    # All nodes Ready
kubectl get pods -n kube-system      # All system pods Running
kubectl run test --image=nginx --rm -it -- curl http://kubernetes.default
```

> **Gotcha:** EKS managed node groups use EC2 launch templates. If you need custom AMIs, user data, or instance metadata options (e.g., `IMDSv2` enforced), configure these in the launch template, not in the node group directly. EKS doesn't expose all EC2 launch configuration options through the node group API.

</details>

---

### Q: How do you monitor and log Kubernetes clusters in AWS?

<details>
<summary>Show Answer</summary>

Observability on EKS has three layers: **metrics** (what is the cluster doing?), **logs** (what did each component say?), and **traces** (how did requests flow?). Each layer has distinct tooling.

**Metrics stack:**

**Option A — Prometheus + Grafana (self-managed, most control):**

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values monitoring-values.yaml
```

`kube-prometheus-stack` bundles Prometheus, Alertmanager, Grafana, and pre-built dashboards for nodes, pods, and workloads. Prometheus scrapes metrics via `ServiceMonitor` CRDs.

**Option B — Amazon Managed Service for Prometheus (AMP) + Grafana:**

No Prometheus infra to manage. Prometheus agents on the cluster remote-write to AMP. Grafana (or Amazon Managed Grafana) queries AMP via a datasource.

**Option C — CloudWatch Container Insights:**

```bash
# Install CloudWatch Agent via Helm
helm install aws-cloudwatch-metrics aws/aws-cloudwatch-metrics \
  --namespace amazon-cloudwatch \
  --set clusterName=prod-cluster
```

Sends CPU, memory, disk, network metrics per pod/node to CloudWatch. Less flexible than Prometheus but zero infra.

**Logging stack:**

**Fluent Bit → CloudWatch Logs (AWS-native):**

```bash
helm install aws-for-fluent-bit aws/aws-for-fluent-bit \
  --namespace amazon-cloudwatch \
  --set cloudWatch.region=ap-southeast-1 \
  --set cloudWatch.logGroupName=/aws/eks/prod-cluster/workloads
```

Fluent Bit runs as a DaemonSet, tails `/var/log/containers/*.log`, and ships to CloudWatch Log Groups structured as `/aws/eks/<cluster>/<namespace>/<pod>`.

**Fluent Bit → OpenSearch / Loki (for self-managed log search):**
Route logs to OpenSearch (ELK stack) or Grafana Loki for more powerful querying and longer retention than CloudWatch.

**EKS Control Plane Logs:**

```bash
# Enable in EKS cluster config
aws eks update-cluster-config --name prod-cluster \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'
```

API server audit logs in CloudWatch — essential for security incident investigation.

**Key metrics to alert on:**

| Metric | Alert Condition | Implication |
| :--- | :--- | :--- |
| Node CPU/memory | > 85% for 5 min | Scale node group |
| Pod restarts | > 3 in 10 min | CrashLoopBackOff pattern |
| Pending pods | > 0 for 5 min | Scheduling or capacity issue |
| PVC usage | > 80% | Storage will fill |
| API server error rate | 5xx > 1% | Control plane issue |

> **Gotcha:** CloudWatch Container Insights charges per metric and per log ingestion — in a large cluster, the bill can surprise you. Set log retention policies (e.g., 30 days for app logs, 90 days for audit) and use metric filters instead of storing raw logs indefinitely. For cost-sensitive setups, route high-volume debug logs to S3 via Kinesis Firehose and only send WARNING+ to CloudWatch.

</details>

---

### Q: What's your approach to Kubernetes RBAC and securing API access?

<details>
<summary>Show Answer</summary>

Kubernetes RBAC controls who can do what to which resources in the cluster. The approach is **least privilege by default** — deny everything, grant only what's needed, scope as tightly as possible.

**Core RBAC objects:**

| Object | Scope | Purpose |
| :--- | :--- | :--- |
| `Role` | Namespace | Grants permissions within one namespace |
| `ClusterRole` | Cluster-wide | Grants permissions across all namespaces or to cluster-scoped resources |
| `RoleBinding` | Namespace | Binds a Role or ClusterRole to a subject within a namespace |
| `ClusterRoleBinding` | Cluster-wide | Binds a ClusterRole to a subject across the entire cluster |

**Minimal workload identity (IRSA):**

```yaml
# ServiceAccount for a pod that needs read-only S3 access
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: payments
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/MyAppS3ReadRole
```

The pod uses this SA; the SA maps to an IAM role via OIDC. No static credentials, no node-level access.

**RBAC for a development team (namespace-scoped):**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: developer
  namespace: payments
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: []     # No exec access for developers in prod
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: developer-binding
  namespace: payments
subjects:
  - kind: Group
    name: payments-team     # Mapped from IAM via aws-auth or EKS access entries
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: developer
  apiGroup: rbac.authorization.k8s.io
```

**AWS-specific: IAM to RBAC mapping (EKS Access Entries):**

```bash
# Modern API (EKS access entries, preferred over aws-auth ConfigMap)
aws eks create-access-entry \
  --cluster-name prod-cluster \
  --principal-arn arn:aws:iam::123456789012:role/DevOpsRole \
  --kubernetes-groups devops-team
```

**Key hardening practices:**

- **Audit RBAC regularly** — `kubectl auth can-i --list --as=system:serviceaccount:default:myapp` shows what a SA can do.
- **No `cluster-admin` for humans** — even platform engineers should use a namespaced admin role for day-to-day work.
- **Disable automounting** for SAs that don't need API access:
  ```yaml
  automountServiceAccountToken: false
  ```
- **Audit logs** — enable API server audit logging to CloudWatch; alert on sensitive verbs (`create`, `delete`, `exec`) on production namespaces.
- **Network policies** — RBAC controls API access; NetworkPolicy controls pod-to-pod traffic. Both are needed.

> **Gotcha:** `ClusterRoleBinding` to a broad role (e.g., binding `edit` ClusterRole to a team) gives them write access to *every namespace* — not just theirs. Always prefer namespace-scoped `RoleBinding` for human users. Use `ClusterRoleBinding` only for cluster-wide operators (Prometheus, External DNS) that genuinely need cross-namespace access.

</details>

---

### Q: How would you implement pod-level autoscaling with custom metrics?

<details>
<summary>Show Answer</summary>

The Horizontal Pod Autoscaler (HPA) scales pod replicas based on metrics. CPU and memory are built-in; **custom metrics** (queue depth, request latency, business KPIs) require an additional metrics pipeline.

**HPA with built-in metrics (baseline):**

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60   # Scale out when avg CPU > 60%
```

**Custom metrics pipeline architecture:**

```
Application exposes /metrics (Prometheus format)
        ↓
Prometheus scrapes metrics
        ↓
Prometheus Adapter translates metrics into Kubernetes custom metrics API
        ↓
HPA queries custom metrics API
        ↓
HPA scales Deployment up/down
```

**Prometheus Adapter configuration:**

```yaml
# prometheus-adapter values.yaml
rules:
  custom:
    - seriesQuery: 'http_requests_total{namespace!="",pod!=""}'
      resources:
        overrides:
          namespace: {resource: "namespace"}
          pod: {resource: "pod"}
      name:
        matches: "^(.*)_total"
        as: "${1}_per_second"
      metricsQuery: 'rate(<<.Series>>{<<.LabelMatchers>>}[2m])'
```

**HPA using the custom metric:**

```yaml
metrics:
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "100"     # Scale when avg >100 req/s per pod
```

**SQS queue depth scaling (common pattern on AWS):**

Use **KEDA (Kubernetes Event-Driven Autoscaling)** — it natively integrates with SQS, Kafka, RabbitMQ, and dozens of other event sources:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
spec:
  scaleTargetRef:
    name: worker-deployment
  minReplicaCount: 0       # Scale to zero when queue empty
  maxReplicaCount: 50
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.ap-southeast-1.amazonaws.com/123456789012/jobs
        queueLength: "10"   # One pod per 10 messages
        awsRegion: ap-southeast-1
      authenticationRef:
        name: keda-aws-credentials
```

KEDA uses IRSA for AWS auth — no static credentials.

**Vertical Pod Autoscaler (VPA) — complement to HPA:**

VPA adjusts CPU/memory requests based on actual usage, rather than scaling replicas. Useful for right-sizing requests. Don't run HPA (CPU) and VPA (CPU) on the same deployment — they conflict. Use HPA for replica scaling, VPA in recommendation-only mode for right-sizing.

> **Gotcha:** HPA has a scale-down stabilisation window (default 5 minutes) to prevent flapping. If your metric spikes briefly and then drops, HPA won't scale down immediately — this is intentional. Tune `behavior.scaleDown.stabilizationWindowSeconds` if your workload has predictable traffic drops that warrant faster scale-down.

</details>

---

### Q: How do you isolate workloads in a multi-tenant Kubernetes cluster?

<details>
<summary>Show Answer</summary>

Multi-tenant isolation in Kubernetes is **not binary** — it's a spectrum from soft (namespace-level) to hard (separate clusters). The right level depends on the trust model between tenants.

**Isolation layers (apply in combination):**

```
RBAC          → Who can do what via the API
Namespaces    → Logical boundary for resource scoping
NetworkPolicy → What pods can talk to what pods
ResourceQuota → How much CPU/memory a namespace can consume
LimitRange    → Per-pod resource floors and ceilings
PodSecurity   → What Linux capabilities pods can use
```

**Namespace-based soft isolation:**

Each tenant gets a dedicated namespace. This is the baseline — it's not security isolation but it prevents naming collisions and scopes RBAC.

```bash
kubectl create namespace tenant-a
kubectl create namespace tenant-b
```

**RBAC — tenants can only touch their namespace:**

```yaml
# Bind tenant-a's team to a Role in their namespace only
kind: RoleBinding
subjects:
  - kind: Group
    name: tenant-a-devs
roleRef:
  kind: ClusterRole
  name: edit
namespace: tenant-a
```

**NetworkPolicy — block cross-tenant pod traffic:**

```yaml
# Default deny all ingress in tenant-a namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: tenant-a
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# Allow traffic only from within the same namespace
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: tenant-a
spec:
  podSelector: {}
  ingress:
    - from:
        - podSelector: {}   # Any pod in the same namespace
```

**ResourceQuota — prevent noisy neighbours:**

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: tenant-a-quota
  namespace: tenant-a
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    count/pods: "50"
```

**PodSecurity Standards — restrict privilege escalation:**

```yaml
# Label the namespace to enforce restricted security policy
kubectl label namespace tenant-a \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest
```

`restricted` policy blocks: running as root, privilege escalation, host namespaces, most Linux capabilities.

**Node isolation (hard multi-tenancy):**

For tenants with stricter isolation requirements, use dedicated node pools with taints:

```bash
kubectl taint nodes tenant-a-node-1 tenant=a:NoSchedule
```

Combined with tolerations on tenant-a pods — their workloads run on their nodes; other tenants' pods can't schedule there.

**When to use separate clusters instead:**

| Scenario | Recommendation |
| :--- | :--- |
| Internal dev teams, low blast radius | Namespace isolation sufficient |
| External customers with SLA isolation | Separate clusters or virtual clusters (vCluster) |
| Compliance boundary (PCI, HIPAA) | Separate clusters |
| Full administrative autonomy per tenant | Separate clusters |

> **Gotcha:** Namespaces and RBAC are soft isolation — a misconfigured ClusterRole or ClusterRoleBinding can give a tenant's service account cluster-wide access. Regularly audit with `kubectl auth can-i --list --as=system:serviceaccount:tenant-a:default` to verify what tenants can actually reach. Use OPA/Gatekeeper policies to prevent cluster-wide role bindings from being created outside of platform namespaces.

</details>

---

### Q: What are best practices for running Kubernetes on spot instances (cost vs. reliability)?

<details>
<summary>Show Answer</summary>

Spot instances can cut EKS node costs by 60–90%, but they can be reclaimed by AWS with 2 minutes notice. The strategy is to **architect for interruption** rather than trying to prevent it.

**Node group architecture:**

```
Node groups:
  on-demand (baseline)    → system-critical, stateful workloads
  spot (cost-optimised)   → stateless, fault-tolerant workloads
```

Use **mixed instance types** in spot node groups to reduce interruption probability — if one instance type is unavailable, the group falls back to another:

```hcl
# Karpenter NodePool (preferred over managed node groups for spot)
spec:
  template:
    spec:
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: node.kubernetes.io/instance-type
          operator: In
          values: ["m5.xlarge", "m5a.xlarge", "m4.xlarge", "m5d.xlarge"]
```

**Workload design for spot:**

1. **Stateless only** — spot nodes are appropriate for stateless services (web tier, workers, batch jobs). Never run stateful workloads (databases, Kafka brokers) on spot.

2. **Pod Disruption Budgets (PDB)** — limit how many pods can be disrupted simultaneously during a spot interruption:
   ```yaml
   apiVersion: policy/v1
   kind: PodDisruptionBudget
   metadata:
     name: myapp-pdb
   spec:
     minAvailable: 2      # At least 2 pods must remain available during disruption
     selector:
       matchLabels:
         app: myapp
   ```

3. **Graceful shutdown handling** — when a spot node is reclaimed, the node gets a `node.kubernetes.io/not-ready` taint and pods get 2 minutes to terminate. Ensure `terminationGracePeriodSeconds` is set appropriately and the app handles SIGTERM:
   ```yaml
   terminationGracePeriodSeconds: 60
   ```

4. **Spot interruption handler** — the **AWS Node Termination Handler** (NTH) watches the EC2 metadata endpoint for spot interruption notices and cordons + drains the node before AWS reclaims it:
   ```bash
   helm install aws-node-termination-handler eks/aws-node-termination-handler \
     --namespace kube-system \
     --set enableSpotInterruptionDraining=true
   ```

5. **Anti-affinity for replicas** — spread replicas across nodes so a single spot interruption doesn't take out all instances:
   ```yaml
   affinity:
     podAntiAffinity:
       preferredDuringSchedulingIgnoredDuringExecution:
         - weight: 100
           podAffinityTerm:
             topologyKey: kubernetes.io/hostname
   ```

**Karpenter vs. Cluster Autoscaler for spot:**

| | Cluster Autoscaler | Karpenter |
| :--- | :--- | :--- |
| **Provisioning speed** | 2–5 min (scale node group) | 30–60 sec (direct EC2 launch) |
| **Instance diversity** | Limited per node group | Any instance type, any AZ |
| **Spot handling** | Manual multi-group setup | Native via `capacity-type` requirement |
| **Bin packing** | Limited | Aggressive — fewer, larger nodes |

Karpenter is the recommended choice for spot-heavy EKS clusters in 2024+.

> **Gotcha:** Even with graceful termination, jobs that haven't checkpointed progress will restart from the beginning on a spot interruption. For long-running batch jobs, implement checkpoint/resume logic or use AWS Batch with Spot, which handles interruption and retry natively. Never rely on spot for jobs where re-running the entire workload is prohibitively expensive.

</details>

---

### Q: What's your experience with service meshes (e.g., Istio) in AWS environments?

<details>
<summary>Show Answer</summary>

A service mesh adds a **network infrastructure layer** between services — it handles traffic management, mutual TLS, observability, and policy enforcement without requiring changes to application code.

**What a service mesh solves:**

| Problem | Without Mesh | With Mesh |
| :--- | :--- | :--- |
| mTLS between services | Manual cert management per service | Automatic, certificate rotation transparent |
| Canary / traffic splitting | App-level or ingress-level | Fine-grained per-service weight |
| Observability (tracing) | Instrument every service | Automatic distributed tracing via sidecar |
| Retries / circuit breaking | Implement in every service | Configured once in mesh policy |
| Access policy (who can call what) | NetworkPolicy (coarse, L4 only) | AuthorizationPolicy (L7, per method/path) |

**Istio architecture on EKS:**

```
Pod A                              Pod B
┌─────────────────┐           ┌─────────────────┐
│ App container   │           │ App container   │
│ Envoy sidecar ──┼── mTLS ───┼── Envoy sidecar │
└─────────────────┘           └─────────────────┘
         ↑                            ↑
    Istiod (control plane): pushes config, certs, policy to all sidecars
```

**Canary deployment with Istio VirtualService:**

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: payments
spec:
  hosts: [payments]
  http:
    - route:
        - destination:
            host: payments
            subset: v1
          weight: 90
        - destination:
            host: payments
            subset: v2
          weight: 10   # 10% canary
```

**mTLS policy:**

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT   # All traffic between pods must be mTLS
```

**AuthorizationPolicy (L7 access control):**

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: payments-policy
  namespace: production
spec:
  selector:
    matchLabels:
      app: payments
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/production/sa/orders-service"]
      to:
        - operation:
            methods: ["POST"]
            paths: ["/v1/charge"]
```

Only the `orders-service` SA can POST to `/v1/charge` on the payments service.

**AWS App Mesh vs. Istio on EKS:**

| | Istio | AWS App Mesh |
| :--- | :--- | :--- |
| **Proxy** | Envoy | Envoy |
| **Control plane** | Self-managed Istiod | AWS managed |
| **Integration** | Broad ecosystem | Deep AWS service integration (Cloud Map, X-Ray) |
| **Complexity** | High | Lower |
| **EKS integration** | Manual setup | Native via App Mesh controller |

**When not to use a service mesh:**

Service meshes add latency (two extra network hops per call), CPU overhead (Envoy sidecar on every pod), and significant operational complexity. For small clusters or simple architectures, NetworkPolicy + application-level retries + CloudWatch tracing is often sufficient.

> **Gotcha:** Istio sidecar injection happens automatically when a namespace is labelled `istio-injection=enabled`. Injecting sidecars into `kube-system` or other system namespaces will break cluster operations. Label only application namespaces. Also, the first Istio deployment in a cluster typically reveals implicit service dependencies that were never documented — treat the installation as a dependency-mapping exercise, not just an infrastructure change.

</details>

---

### Q: How do you manage multi-cluster Kubernetes environments?

<details>
<summary>Show Answer</summary>

Multi-cluster environments arise from regulatory requirements (data residency), availability (regional failover), blast radius reduction (separate prod clusters per BU), or environment isolation. The challenge is managing consistency across clusters without duplicating everything.

**Why multiple clusters vs. one large cluster:**

| Driver | Multi-cluster justification |
| :--- | :--- |
| **Blast radius** | Cluster failure affects one BU, not all |
| **Compliance** | Data residency requires workloads in specific regions |
| **Team autonomy** | Each team owns their cluster lifecycle |
| **Environment isolation** | Prod and non-prod never share a control plane |
| **Scale** | One cluster has practical limits (~5000 nodes, ~150K pods) |

**Cluster fleet management approaches:**

**1. GitOps with ArgoCD ApplicationSets:**

A single ArgoCD instance (or ArgoCD in a hub-spoke topology) manages multiple target clusters:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: myapp-all-clusters
spec:
  generators:
    - list:
        elements:
          - cluster: prod-eu-west-1
            url: https://k8s.eu-west-1.example.com
          - cluster: prod-ap-southeast-1
            url: https://k8s.ap-southeast-1.example.com
  template:
    metadata:
      name: '{{cluster}}-myapp'
    spec:
      destination:
        server: '{{url}}'
        namespace: myapp
      source:
        repoURL: https://github.com/org/gitops-config
        path: 'apps/myapp/overlays/{{cluster}}'
```

Each cluster gets its own overlay with environment-specific values. The ApplicationSet generates one ArgoCD Application per cluster entry.

**2. Flux multi-tenancy:**

Flux running per-cluster, each pointing at a cluster-specific directory in a central GitOps repo. No hub ArgoCD required — each cluster self-manages.

**3. Cluster API (CAPI):**

For managing the *clusters themselves* as code — provisioning, upgrading, and scaling clusters via Kubernetes-native CRDs:

```yaml
kind: Cluster
apiVersion: cluster.x-k8s.io/v1beta1
metadata:
  name: prod-ap-southeast-1
spec:
  infrastructureRef:
    kind: AWSCluster
    name: prod-ap-southeast-1
```

**Cross-cluster service discovery:**

| Tool | Mechanism |
| :--- | :--- |
| **Istio multicluster** | Shared trust, cross-cluster mTLS via east-west gateways |
| **Submariner** | L3 tunnel between clusters, shared service DNS |
| **AWS Cloud Map** | Register services across clusters, resolve via DNS |
| **Global Accelerator + ALB** | Traffic routing at the edge, cluster-agnostic |

**Shared infrastructure per cluster:**

Each cluster needs its own: VPC/networking, IAM roles (IRSA), core add-ons (LBC, External DNS, metrics server), monitoring stack or remote-write to a shared Prometheus/AMP endpoint.

Manage this with a **cluster bootstrap module** in Terraform — one module call per cluster provisions the cluster + all add-ons in a consistent, versioned way.

**Operational challenges:**

- **Config drift** — clusters diverge over time as manual changes accumulate. GitOps reconciliation prevents this.
- **Credential management** — each cluster has its own kubeconfig. Use tools like `kubie` or `kubeconfig` context switching with strict production-context discipline.
- **Version skew** — EKS minor version upgrades must be managed per-cluster. Use a staged rollout: upgrade non-prod → staging → prod with health validation between stages.

> **Gotcha:** A central ArgoCD managing many clusters is itself a single point of failure and a high-value attack target — it has credentials (or IRSA trust) for every cluster. Run ArgoCD in an isolated management cluster with strict RBAC, audit all ArgoCD project policies, and use ArgoCD ApplicationProject boundaries to limit which teams can push to which clusters.

</details>

---
---

## 📚 Question Reference

Additional questions and topic coverage sourced from **[acecloudinterviews.com/questions](https://www.acecloudinterviews.com/questions/)**.
