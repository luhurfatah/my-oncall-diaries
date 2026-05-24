# Kubernetes — Workload Design & Pod Lifecycle

> **Scope:** Production-grade pod and deployment design. Goes beyond basics — covers QoS tuning, probe edge cases, init containers, graceful shutdown gotchas, StatefulSet caveats, and storage patterns.

---

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Resource Requests & Limits — Deep Dive](#1-resource-requests--limits--deep-dive) | CPU vs memory enforcement, throttling detection, OOMKill forensics, and sizing process. |
| **02** | [QoS Classes — Production Implications](#2-qos-classes--production-implications) | Guaranteed vs Burstable vs BestEffort, eviction order, and when to use each. |
| **03** | [Probes — Liveness, Readiness, Startup](#3-probes--liveness-readiness-startup) | Probe types and failure actions, full probe configuration, and edge case gotchas. |
| **04** | [Graceful Shutdown & Pod Lifecycle](#4-graceful-shutdown--pod-lifecycle) | Full termination sequence, endpoint removal race, SIGTERM handling, and grace period sizing. |
| **05** | [Init Containers & Sidecar Containers](#5-init-containers--sidecar-containers) | Init container use cases and native sidecar support (K8s 1.29+). |
| **06** | [Deployments — Advanced Patterns](#6-deployments--advanced-patterns) | Rolling update tuning, minReadySeconds, canary without service mesh, and rollback. |
| **07** | [StatefulSets — When and How](#7-statefulsets--when-and-how) | StatefulSet vs Deployment, headless services, canary updates with partition, and gotchas. |
| **08** | [Storage — PVCs, StorageClasses & Edge Cases](#8-storage--pvcs-storageclasses--edge-cases) | StorageClass selection, WaitForFirstConsumer, volume expansion, snapshots, and access modes. |
| **09** | [Jobs & CronJobs](#9-jobs--cronjobs) | Job patterns, CronJob concurrency control, and missed run gotchas. |

---

## 1. Resource Requests & Limits — Deep Dive

### The Mental Model

```
requests = scheduling contract (what the node reserves for you)
limits   = enforcement ceiling (what the kernel enforces)
```

Requests affect **where** a pod lands. Limits affect **what happens when it runs hot**.

```yaml
resources:
  requests:
    cpu: "200m"
    memory: "256Mi"
  limits:
    cpu: "1000m"
    memory: "512Mi"
```

### CPU vs Memory — Different Enforcement Mechanisms

| Resource | Over-limit behavior | Mechanism |
|---|---|---|
| CPU | **Throttled** — slowed down, not killed | Linux CFS scheduler |
| Memory | **OOMKilled** — container terminated | Linux OOM killer |

CPU throttling is silent and insidious — your app slows down without obvious errors. High CPU throttling shows as latency spikes, not crashes.

### CPU Throttling — The Hidden Perf Problem

Even if your pod is using well under its CPU limit on average, **burst activity** (GC, request spikes) can cause throttling. The Linux CFS scheduler enforces CPU limits in 100ms windows.

Detecting throttling:
```bash
# Check throttled periods
kubectl exec -it <pod> -- cat /sys/fs/cgroup/cpu/cpu.stat
# Look for: throttled_time > 0
```

Or via Prometheus:
```promql
rate(container_cpu_cfs_throttled_periods_total[5m])
/ rate(container_cpu_cfs_periods_total[5m])
```

If throttle ratio > 25%, your CPU limit is too low.

### Memory — OOMKill Forensics

When a container is OOMKilled:
- Pod restarts (based on `restartPolicy`)
- Exit code is `137` (128 + SIGKILL)
- `kubectl describe pod` shows `OOMKilled: true`

```bash
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
# Look for: "reason": "OOMKilled"
```

Common causes:
- Memory leak in application
- Limit set too low relative to actual working set
- `limits.memory` includes JVM heap + overhead — Java apps commonly need limit ≥ 1.5× heap size

### Setting Good Values

Process:
1. Deploy with generous limits, no specific requests
2. Run under production-like load
3. Observe with `kubectl top pods` or Prometheus `container_memory_working_set_bytes`
4. Set requests at P99 usage, limits at 2× requests (adjust per workload)
5. Use VPA in `Off` mode to get automated recommendations

```bash
# VPA recommendation (after deploying VPA controller)
kubectl describe vpa myapp-vpa
# Shows: lowerBound, target, upperBound per container
```

### Extended Resources (GPU, hugepages)

```yaml
resources:
  limits:
    nvidia.com/gpu: 1           # GPU — must equal request (no fractional GPU)
    hugepages-2Mi: 256Mi        # Hugepages — must equal request
  requests:
    nvidia.com/gpu: 1
    hugepages-2Mi: 256Mi
```

Extended resources must always have requests == limits.

---

## 2. QoS Classes — Production Implications

### Classes and Eviction Order

```
BestEffort  →  Burstable  →  Guaranteed
(evicted first)              (evicted last)
```

| Class | How to Achieve | When to Use |
|---|---|---|
| **Guaranteed** | requests == limits for ALL containers | Critical services, latency-sensitive |
| **Burstable** | requests < limits, at least one container has a request | Most production workloads |
| **BestEffort** | No requests or limits on any container | Never in production |

### Guaranteed QoS — Tradeoffs

Guaranteed QoS prevents eviction but also prevents bursting. If your app has spiky CPU usage:
- Guaranteed: CPU throttled at the limit
- Burstable: Can burst above request (up to limit) if node has headroom

For latency-critical apps (API servers, databases), Guaranteed is worth it. For batch or background jobs, Burstable is fine.

### Checking a Pod's QoS Class

```bash
kubectl get pod <pod> -o jsonpath='{.status.qosClass}'
```

---

## 3. Probes — Liveness, Readiness, Startup

### Probe Types

| Probe | Failure Action | Use For |
|---|---|---|
| **Liveness** | Restart container | Detecting deadlocks, hung processes |
| **Readiness** | Remove from Service endpoints | Warmup, dependency checks, overload |
| **Startup** | Block liveness/readiness | Slow-starting apps (JVM, ML models) |

### Critical Distinction

```
Liveness failure  → container restart (may cause traffic disruption)
Readiness failure → removed from LB, pod NOT restarted (stays running)
```

Never put dependency health checks (DB, cache) in liveness probes — if your DB goes down, you don't want all pods restarting in a cascade. Put external dependency checks in **readiness** only.

### Full Probe Example with Tuning

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30      # 30 × 10s = 5 minutes max startup time
  periodSeconds: 10

livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 0    # Startup probe handles delay
  periodSeconds: 10
  failureThreshold: 3       # 30s before restart
  timeoutSeconds: 5         # Probe timeout — set this!
  successThreshold: 1

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
  failureThreshold: 3       # 15s before removed from LB
  successThreshold: 2       # Must pass twice before added back to LB
  timeoutSeconds: 3
```

### Probe Method Tradeoffs

| Method | Use When |
|---|---|
| `httpGet` | App has an HTTP server — preferred |
| `exec` | No HTTP server, can run a command |
| `tcpSocket` | Confirm port is open (no HTTP) |
| `grpc` | gRPC services (requires port with gRPC reflection) |

`exec` probes spawn a new process per check — at high `periodSeconds` frequency on many pods, this creates significant overhead. Prefer `httpGet`.

### Edge Cases & Gotchas

- **`timeoutSeconds` defaults to 1** — if your health endpoint takes >1s (cold DB query), the probe fails spuriously. Always set this explicitly.
- **Liveness probe too aggressive** → CrashLoopBackOff storm. Start with `failureThreshold: 5` and tune down.
- **Readiness probe with database check** — if DB is slow, readiness flip-flops and the pod keeps entering/leaving the LB. Use a fast in-process check for readiness, not full dependency chain.
- **Startup probe not set for slow apps** — liveness fires before app is ready → immediate restart loop. Always add startup probe for Java, Python with ML models, apps that load large data on boot.
- **`successThreshold` on readiness > 1** — requires multiple consecutive passes before pod is re-added to Service. Good for flaky apps but adds time to recovery.

---

## 4. Graceful Shutdown & Pod Lifecycle

### Full Termination Sequence

```
kubectl delete pod  OR  node drain  OR  rolling update
         │
         ▼
1. Pod status → Terminating
2. Endpoint removed from Service (async — may take ~1-2s)
3. SIGTERM sent to container PID 1
4. preStop hook executed (if configured)
5. terminationGracePeriodSeconds countdown begins
6. After grace period: SIGKILL sent
```

### The Endpoint Removal Race Condition

Step 2 (endpoint removal) and step 3 (SIGTERM) happen roughly simultaneously but **not atomically**. For ~1-2 seconds, kube-proxy and Ingress controllers may still route traffic to a terminating pod.

Fix with `preStop` sleep:
```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]
terminationGracePeriodSeconds: 30
```

The 5-second sleep gives the control plane time to propagate endpoint removal before the app starts shutting down. This eliminates 502s during rolling deployments.

### Application-Level SIGTERM Handling

Your app must handle SIGTERM, not just SIGKILL:

```go
// Go example
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGTERM)
go func() {
    <-sigChan
    log.Println("SIGTERM received, starting graceful shutdown")
    server.Shutdown(context.Background())
}()
```

```python
# Python example
import signal, sys
def handle_sigterm(sig, frame):
    print("SIGTERM received")
    cleanup()
    sys.exit(0)
signal.signal(signal.SIGTERM, handle_sigterm)
```

If PID 1 is a shell script (e.g., `CMD ["/bin/sh", "start.sh"]`), SIGTERM goes to the shell, not your app. Use `exec` in your entrypoint:
```dockerfile
# Wrong — SIGTERM hits bash, not your app
CMD ["/bin/sh", "-c", "myapp"]

# Correct — exec replaces shell with your process
CMD ["/bin/sh", "-c", "exec myapp"]
# Or better
ENTRYPOINT ["myapp"]
```

### terminationGracePeriodSeconds Sizing

```
terminationGracePeriodSeconds >= preStop duration + app shutdown time + buffer

Example:
  preStop sleep: 5s
  app drain time: 15s
  buffer: 10s
  → terminationGracePeriodSeconds: 30
```

If your grace period is too short, SIGKILL fires mid-drain → in-flight requests dropped, DB connections not closed, caches not flushed.

---

## 5. Init Containers & Sidecar Containers

### Init Containers

Run to completion **before** app containers start. Run sequentially.

```yaml
initContainers:
  - name: wait-for-db
    image: busybox:1.36
    command: ['sh', '-c', 'until nc -z postgres 5432; do sleep 2; done']

  - name: run-migrations
    image: myapp:1.2.3
    command: ['./migrate', '--up']
    env:
      - name: DB_URL
        valueFrom:
          secretKeyRef:
            name: db-secret
            key: url
```

Use cases:
- Wait for dependencies (DB, Kafka, external service)
- Run DB migrations before app starts
- Fetch config or certificates before app boots
- Set up filesystem permissions

**Gotcha:** Init containers share volumes with app containers but have their own resource limits. Don't forget to set resources on init containers too — they count toward pod scheduling.

### Native Sidecar Containers (K8s 1.29+)

Before 1.29, sidecars were just regular containers in the pod spec — they started simultaneously with the app and had no ordering guarantees relative to init containers.

Kubernetes 1.29 introduced **native sidecar support** via `initContainers` with `restartPolicy: Always`:

```yaml
initContainers:
  - name: log-collector        # Native sidecar
    image: fluent-bit:3.0
    restartPolicy: Always      # Marks this as a sidecar, not a regular init container
    resources:
      requests:
        cpu: 50m
        memory: 64Mi

containers:
  - name: myapp
    image: myapp:1.2.3
```

Native sidecars:
- Start before app containers (like init containers)
- Run alongside app containers (like regular containers)
- Are terminated **after** app containers during shutdown (important for log flushing)
- Counted in pod readiness (pod is ready only when sidecar is ready)

This solves the classic problem of Envoy/Istio sidecars or log collectors not being ready when the app starts.

---

## 6. Deployments — Advanced Patterns

### Rolling Update Tuning

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 25%           # Extra pods above desired during update
    maxUnavailable: 0       # Zero-downtime: no pod removed until new one is Ready
```

`maxUnavailable: 0` + `maxSurge: 1` = safest zero-downtime. Slower but guaranteed no traffic disruption.

For faster rollouts with acceptable risk:
```yaml
maxSurge: 2
maxUnavailable: 1
```

### `minReadySeconds` — Underused but Important

```yaml
spec:
  minReadySeconds: 30    # Pod must be Ready for 30s before considered "available"
```

Without this, a pod that passes readiness probe immediately is counted as available — even if it crashes 5 seconds later. `minReadySeconds` adds a stability window before the rollout proceeds.

### Canary Deployments (Without Service Mesh)

Simple label-based canary using two Deployments sharing one Service:

```yaml
# Service selects both stable and canary pods
selector:
  app: myapp             # Both deployments have this label

# Stable deployment — 9 replicas
metadata:
  labels:
    app: myapp
    track: stable

# Canary deployment — 1 replica (10% traffic)
metadata:
  labels:
    app: myapp
    track: canary
```

Traffic split ratio = replica ratio. For precise percentage-based splits, use Argo Rollouts, Flagger, or a service mesh (Istio, Linkerd).

### Recreate Strategy — When to Use It

```yaml
strategy:
  type: Recreate    # Kill all old pods, then start new ones
```

Use when:
- Your app cannot run two versions simultaneously (schema migrations, singletons)
- You're fine with a brief downtime window
- Rolling update would cause data corruption (old + new pod both writing)

Avoid for HTTP-serving production workloads.

### Revision History & Rollback

```yaml
spec:
  revisionHistoryLimit: 10    # Keep last 10 ReplicaSets for rollback
```

```bash
# View rollout history
kubectl rollout history deployment/myapp -n app-prod

# Rollback to previous version
kubectl rollout undo deployment/myapp -n app-prod

# Rollback to specific revision
kubectl rollout undo deployment/myapp --to-revision=3 -n app-prod
```

---

## 7. StatefulSets — When and How

### StatefulSet vs Deployment

| Feature | Deployment | StatefulSet |
|---|---|---|
| Pod identity | Random names (`myapp-abc123`) | Stable ordinal names (`myapp-0`, `myapp-1`) |
| Pod ordering | Parallel start/stop | Sequential by default |
| Storage | Shared or ephemeral | Per-pod PVC (VolumeClaimTemplate) |
| DNS | Single Service DNS | Per-pod DNS (`myapp-0.myapp.ns.svc`) |
| Use case | Stateless apps | Databases, Kafka, Zookeeper, Elasticsearch |

### StatefulSet Spec

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres-headless    # Must match a headless Service
  replicas: 3
  podManagementPolicy: OrderedReady  # or Parallel
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0                   # Update pods >= partition index
  selector:
    matchLabels:
      app: postgres
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:16
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:              # Per-pod PVC — NOT deleted when pod is deleted
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp3
        resources:
          requests:
            storage: 50Gi
```

### Headless Service — Required for StatefulSet DNS

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-headless
spec:
  clusterIP: None                    # Headless — no load balancing
  selector:
    app: postgres
  ports:
    - port: 5432
```

With a headless service, each pod gets a stable DNS record:
```
postgres-0.postgres-headless.default.svc.cluster.local
postgres-1.postgres-headless.default.svc.cluster.local
```

### Canary Updates with `partition`

```yaml
updateStrategy:
  type: RollingUpdate
  rollingUpdate:
    partition: 2    # Only update pods with index >= 2 (just pod-2 in a 3-replica set)
```

Use partition for staged StatefulSet rollouts — update one pod, validate, then lower the partition to update the rest.

### Edge Cases & Gotchas

- **PVCs are NOT deleted when StatefulSet is deleted** — you must delete PVCs manually. This prevents accidental data loss but also means stale PVCs accumulate if you're not careful.
- **`OrderedReady` means sequential startup** — `myapp-1` won't start until `myapp-0` is Running and Ready. For large StatefulSets (Kafka with 10 brokers), this significantly slows down cold starts. Use `podManagementPolicy: Parallel` if ordering isn't required.
- **Scaling down removes the highest-ordinal pod first** — `myapp-2` removed before `myapp-1`. Scaling down Kafka/Zookeeper without proper decommissioning can cause data loss.
- **Rolling update on StatefulSet goes in reverse order** — `myapp-2` updated first, then `myapp-1`, then `myapp-0`. For primary/replica databases, this means replicas update before primary.

---

## 8. Storage — PVCs, StorageClasses & Edge Cases

### StorageClass Selection

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3-encrypted
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "4000"
  throughput: "200"          # MiB/s
  encrypted: "true"
  kmsKeyId: "arn:aws:kms:..."
reclaimPolicy: Retain        # Retain or Delete
volumeBindingMode: WaitForFirstConsumer   # Critical for multi-AZ
allowVolumeExpansion: true
```

### `WaitForFirstConsumer` — Why It Matters

Default `Immediate` binding provisions the PV in a random AZ. When the pod is scheduled, if it lands in a different AZ from the PV → pod stuck in `Pending` forever.

`WaitForFirstConsumer` waits until the pod is scheduled, then provisions the PV in the same AZ. Always use this for EBS/regional block storage.

### `reclaimPolicy: Retain` vs `Delete`

| Policy | On PVC deletion |
|---|---|
| `Delete` | PV and underlying storage deleted immediately |
| `Retain` | PV stays, data preserved, manually reclaimed |

Use `Retain` for production stateful workloads. Use `Delete` for ephemeral or easily reproducible data.

### PVC Expansion (Online Resize)

```yaml
# 1. StorageClass must have allowVolumeExpansion: true
# 2. Edit the PVC:
kubectl patch pvc myapp-data -p '{"spec":{"resources":{"requests":{"storage":"100Gi"}}}}'
# 3. Delete the pod to trigger filesystem resize (EBS requires pod restart for xfs/ext4)
```

**Gotcha:** EBS volume expansion is online (no detach needed) but filesystem resize requires the pod to restart for most filesystems. Plan for a brief pod restart.

### Volume Snapshots (Backup Before Risky Operations)

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: myapp-pre-migration
spec:
  volumeSnapshotClassName: ebs-vsc
  source:
    persistentVolumeClaimName: myapp-data
```

Take a VolumeSnapshot before schema migrations, major upgrades, or any destructive operation.

### Access Modes Summary

| Mode | Short | Multi-node? | Use Case |
|---|---|---|---|
| ReadWriteOnce | RWO | No (single node) | EBS, local SSD |
| ReadWriteOncePod | RWOP | No (single pod) | Stricter than RWO |
| ReadOnlyMany | ROX | Yes (read-only) | Shared config/data |
| ReadWriteMany | RWX | Yes (read-write) | EFS, NFS, CephFS |

`ReadWriteOncePod` (K8s 1.22+) is stricter than `ReadWriteOnce` — only one pod in the entire cluster can mount it, regardless of node.

---

## 9. Jobs & CronJobs

### Job Patterns

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
spec:
  completions: 1          # Total successful completions needed
  parallelism: 1          # Concurrent pods
  backoffLimit: 3         # Retry on failure
  ttlSecondsAfterFinished: 3600   # Auto-cleanup after 1h
  activeDeadlineSeconds: 600      # Kill if not done in 10min
  template:
    spec:
      restartPolicy: OnFailure    # Never or OnFailure (not Always)
      containers:
        - name: migrate
          image: myapp:1.2.3
          command: ["./migrate", "--up"]
```

### CronJob with Concurrency Control

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-report
spec:
  schedule: "0 2 * * *"              # 2 AM daily
  timeZone: "Asia/Jakarta"           # K8s 1.27+
  concurrencyPolicy: Forbid          # Skip if previous run still running
  startingDeadlineSeconds: 300       # Skip if can't start within 5min of scheduled time
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: myapp:1.2.3
```

### `concurrencyPolicy` Options

| Policy | Behavior |
|---|---|
| `Allow` | Multiple concurrent runs allowed |
| `Forbid` | Skip new run if previous still running |
| `Replace` | Kill running job, start new one |

### Edge Cases & Gotchas

- **`ttlSecondsAfterFinished` is critical** — without it, completed Job pods accumulate and exhaust your pod count quota. Always set it.
- **CronJob missed runs:** If the control plane is down during scheduled time, the job is "missed." If `startingDeadlineSeconds` is set and the deadline passes, the missed run is recorded but not retried. If more than 100 jobs are missed, CronJob stops scheduling.
- **`restartPolicy: Always` is not valid for Jobs** — use `OnFailure` or `Never`.
- **Job parallelism with `completions`:** Setting `parallelism > 1` with `completions > 1` runs multiple pods in parallel. Be careful with work-queue jobs — each pod must track its own work unit or you'll process duplicates.

---

*Last updated: 2026-05 | Author: Personal KB | K8s version context: 1.29+*