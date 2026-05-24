# Kubernetes — Scheduling, Autoscaling & Resource Management

> **Scope:** Deep-dive into how K8s schedules pods, controls placement, and scales both pods and nodes. Covers namespace quotas, affinity patterns, HPA/VPA/KEDA, Karpenter, and the non-obvious interactions between them.

---

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Kubernetes Scheduler — How It Works](#1-kubernetes-scheduler--how-it-works) | Filter/score phases, pending pod diagnosis, and custom schedulers. |
| **02** | [Namespace Strategy & Resource Quotas](#2-namespace-strategy--resource-quotas) | Namespace design, ResourceQuota, LimitRange patterns, and QoS interactions. |
| **03** | [Node Affinity & Node Selector](#3-node-affinity--node-selector) | Simple node targeting vs expressive affinity rules with hard/soft requirements. |
| **04** | [Pod Affinity & Anti-Affinity](#4-pod-affinity--anti-affinity) | Co-location and spread patterns, topology keys, and performance warnings. |
| **05** | [Topology Spread Constraints](#5-topology-spread-constraints) | Modern AZ spreading, maxSkew, minDomains, and TSC vs pod anti-affinity tradeoffs. |
| **06** | [Taints & Tolerations](#6-taints--tolerations) | Taint effects, dedicated node pool pattern, and built-in system taints. |
| **07** | [HPA — Horizontal Pod Autoscaler](#7-hpa--horizontal-pod-autoscaler) | HPA v2 multi-metric scaling, behavior tuning, and custom metrics via Prometheus Adapter. |
| **08** | [VPA — Vertical Pod Autoscaler](#8-vpa--vertical-pod-autoscaler) | VPA modes (Off/Initial/Auto), reading recommendations, and JVM gotchas. |
| **09** | [KEDA — Event-Driven Autoscaling](#9-keda--event-driven-autoscaling) | Scale-to-zero pattern, SQS/cron triggers, and authentication via IRSA. |
| **10** | [Cluster Autoscaler vs Karpenter](#10-cluster-autoscaler-vs-karpenter) | Provisioning comparison, Karpenter NodePool config, and disruption/consolidation. |
| **11** | [PodDisruptionBudgets](#11-poddisruptionbudgets) | minAvailable vs maxUnavailable, and common PDB gotchas that block drains. |
| **12** | [Priority Classes & Preemption](#12-priority-classes--preemption) | Priority class definitions and preemption behavior when the cluster is full. |

---

## 1. Kubernetes Scheduler — How It Works

### Two Phases: Filter → Score

```
Pod created → Scheduler picks up
  Phase 1: Filter (hard constraints)
    └── Remove nodes that CANNOT run the pod
        ├── Insufficient CPU/memory
        ├── NodeAffinity required rules
        ├── Taints not tolerated
        ├── PVC AZ mismatch
        └── Node not Ready

  Phase 2: Score (soft preferences)
    └── Rank remaining nodes
        ├── Least requested (spread load)
        ├── Balanced resource allocation
        ├── NodeAffinity preferred rules
        ├── Pod affinity preferred rules
        └── Image locality (prefer nodes with image already pulled)

  Best scored node → Pod bound → kubelet starts container
```

### Scheduling Failures — Diagnosing `Pending` Pods

```bash
kubectl describe pod <pod> -n <namespace>
# Look at "Events:" section at the bottom

# Common messages:
# "0/5 nodes are available: 3 Insufficient memory, 2 node(s) had taint..."
# "0/5 nodes are available: 5 pod has unbound immediate PersistentVolumeClaims"
# "0/5 nodes are available: 5 node(s) didn't match pod affinity rules"
```

### Scheduler Extenders & Custom Schedulers

For advanced use cases (GPU scheduling, topology-aware batch scheduling), you can run a secondary scheduler alongside the default:

```yaml
spec:
  schedulerName: my-custom-scheduler   # Use custom scheduler for this pod
```

Common secondary schedulers:
- **Volcano** — batch and ML workloads (gang scheduling)
- **Koordinator** — mixed online/offline workloads
- Default = `default-scheduler` when field is omitted

---

## 2. Namespace Strategy & Resource Quotas

### Namespace Design Principles

```
kube-system         → K8s internals, do not touch
kube-public         → Cluster info, public readable
kube-node-lease     → Node heartbeat leases

infra namespaces:
  monitoring        → Prometheus, Grafana, Loki
  ingress-nginx     → Ingress controller
  cert-manager      → TLS automation
  external-secrets  → ESO controller
  argocd            → GitOps control plane

app namespaces (one per team/env):
  payments-prod
  payments-staging
  payments-dev
  platform-prod
  data-prod
```

Namespace-per-team AND namespace-per-environment is the most common pattern. For very large orgs, separate clusters per criticality (prod cluster, non-prod cluster) and namespace-per-team within each.

### ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: payments-prod-quota
  namespace: payments-prod
spec:
  hard:
    # Compute
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi

    # Object counts
    pods: "100"
    services: "20"
    secrets: "50"
    configmaps: "50"
    persistentvolumeclaims: "20"

    # LoadBalancer services
    services.loadbalancers: "2"
    services.nodeports: "0"          # Disallow NodePort entirely
```

### LimitRange — Per-Pod Defaults and Ceilings

LimitRange provides per-pod/container defaults (for when devs forget to set them) and ceilings:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: payments-prod-limits
  namespace: payments-prod
spec:
  limits:
    - type: Container
      default:              # Applied when no limits set
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:       # Applied when no requests set
        cpu: "100m"
        memory: "128Mi"
      max:                  # Hard ceiling per container
        cpu: "4"
        memory: "4Gi"
      min:                  # Hard floor per container
        cpu: "50m"
        memory: "64Mi"

    - type: PersistentVolumeClaim
      max:
        storage: 100Gi
      min:
        storage: 1Gi
```

**Gotcha:** ResourceQuota will reject a pod with no requests/limits if the namespace has a quota — you must set them. LimitRange's defaults apply before quota checking, so LimitRange + ResourceQuota together enforce good hygiene.

### Viewing Quota Usage

```bash
kubectl describe resourcequota -n payments-prod
# Shows: RESOURCE / USED / HARD
```

---

## 3. Node Affinity & Node Selector

### Node Selector — Simple, Blunt

```yaml
spec:
  nodeSelector:
    node-type: compute          # Pod ONLY schedules on nodes with this label
    topology.kubernetes.io/zone: ap-southeast-1a   # Pin to specific AZ
```

No flexibility — if no node matches, pod is `Pending` forever. Use for hard requirements only.

### Node Affinity — Flexible and Expressive

```yaml
spec:
  affinity:
    nodeAffinity:
      # HARD requirement — must match or pod stays Pending
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: kubernetes.io/arch
                operator: In
                values: ["amd64", "arm64"]
              - key: node.kubernetes.io/instance-type
                operator: NotIn
                values: ["t3.micro", "t3.small"]   # Avoid tiny nodes

      # SOFT preference — scheduler prefers these nodes, but won't block
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 80
          preference:
            matchExpressions:
              - key: node-type
                operator: In
                values: ["compute-optimized"]
        - weight: 20
          preference:
            matchExpressions:
              - key: spot
                operator: NotIn
                values: ["true"]       # Prefer on-demand, but allow spot
```

### `IgnoredDuringExecution` — What It Means

The suffix `IgnoredDuringExecution` means: once a pod is scheduled, it keeps running even if the node label changes and no longer matches. There's also `RequiredDuringExecution` (alpha) which would evict pods if nodes stop matching.

### Dedicated Node Pools

Label nodes for dedicated workloads:

```bash
kubectl label node ip-10-0-1-1.ec2.internal workload=gpu
kubectl label node ip-10-0-1-2.ec2.internal workload=batch
```

Then use nodeAffinity to target them. Pair with taints to ensure only intended workloads land there (see Section 6).

---

## 4. Pod Affinity & Anti-Affinity

### Pod Anti-Affinity — Spread Replicas

```yaml
spec:
  affinity:
    podAntiAffinity:
      # HARD — never schedule two myapp pods on the same node
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app: myapp
          topologyKey: kubernetes.io/hostname   # Per-node

      # SOFT — prefer different AZs
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchLabels:
                app: myapp
            topologyKey: topology.kubernetes.io/zone   # Per-AZ
```

`required` anti-affinity on `hostname` = max one replica per node. If you have 5 replicas and 4 nodes, the 5th pod stays `Pending`. Use `preferred` when you want best-effort spreading without blocking.

### Pod Affinity — Co-locate for Performance

```yaml
spec:
  affinity:
    podAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchLabels:
                app: redis-cache
            topologyKey: kubernetes.io/hostname   # Co-locate with redis for low latency
```

Use co-location for apps that communicate very frequently (app + local cache, sidecar-like patterns without sidecar injection).

### Performance Warning

Pod affinity/anti-affinity is O(N²) in the scheduler — for clusters with thousands of pods, heavy use of pod affinity can significantly slow scheduling. Topology Spread Constraints (Section 5) are more efficient for spreading pods.

---

## 5. Topology Spread Constraints

The modern, efficient replacement for AZ-spreading via pod anti-affinity.

```yaml
spec:
  topologySpreadConstraints:
    # Spread across AZs — max 1 pod difference between any two zones
    - maxSkew: 1
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule      # Hard — block if can't satisfy
      labelSelector:
        matchLabels:
          app: myapp

    # Also spread across nodes within each AZ
    - maxSkew: 2
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway    # Soft — schedule but record violation
      labelSelector:
        matchLabels:
          app: myapp
```

### `whenUnsatisfiable` Options

| Value | Behavior |
|---|---|
| `DoNotSchedule` | Pod stays `Pending` if constraint can't be met |
| `ScheduleAnyway` | Schedule anyway, minimize skew as much as possible |

### `minDomains` — Ensure Multi-Zone Coverage

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    minDomains: 3               # Require pods spread across at least 3 zones
    labelSelector:
      matchLabels:
        app: myapp
```

`minDomains` (K8s 1.25+) ensures pods won't concentrate in fewer zones than you intend — important when a zone is temporarily empty.

### TSC vs Pod Anti-Affinity Tradeoffs

| | Topology Spread | Pod Anti-Affinity |
|---|---|---|
| Performance | O(N) | O(N²) |
| Granularity | `maxSkew` (flexible) | All-or-nothing per topology |
| Multi-topology | Multiple TSCs (additive) | Multiple rules (complex) |
| `minDomains` | ✅ Supported | ❌ No |

Use Topology Spread Constraints by default. Only use pod anti-affinity for strict "one pod per node" requirements.

---

## 6. Taints & Tolerations

### Concept

```
Taint:     Applied to a NODE — "I repel pods that don't tolerate me"
Toleration: Applied to a POD  — "I can tolerate this node's taint"
```

A pod without a matching toleration is **not scheduled** on a tainted node (or **evicted** if already running, depending on effect).

### Taint Effects

| Effect | Behavior |
|---|---|
| `NoSchedule` | No new pods without toleration scheduled here |
| `PreferNoSchedule` | Scheduler avoids this node, but may schedule if needed |
| `NoExecute` | Existing pods without toleration are evicted; new ones not scheduled |

### Dedicated Node Pool Pattern

```bash
# 1. Taint the GPU nodes
kubectl taint nodes ip-10-0-1-5.ec2.internal workload=gpu:NoSchedule

# 2. Label them too (for nodeAffinity)
kubectl label nodes ip-10-0-1-5.ec2.internal workload=gpu
```

```yaml
# GPU workload pod — tolerates the taint AND targets GPU nodes
spec:
  tolerations:
    - key: "workload"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: workload
                operator: In
                values: ["gpu"]
```

Taint alone repels unwanted pods. NodeAffinity ensures your desired pods go there. Both are needed for dedicated pools — without nodeAffinity, your GPU pod might schedule on a non-tainted node.

### System Taints (Built-In)

```
node.kubernetes.io/not-ready           → Node not Ready
node.kubernetes.io/unreachable         → Node unreachable
node.kubernetes.io/memory-pressure     → Node low on memory
node.kubernetes.io/disk-pressure       → Node low on disk
node.kubernetes.io/unschedulable       → kubectl cordon applied
node.kubernetes.io/network-unavailable → Node network not configured
```

Critical pods (DaemonSets, kube-proxy) auto-tolerate these. Your app pods should tolerate `not-ready` and `unreachable` with a timeout:

```yaml
tolerations:
  - key: "node.kubernetes.io/not-ready"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 300    # Evict after 5 minutes, not immediately
```

---

## 7. HPA — Horizontal Pod Autoscaler

### HPA v2 — Multi-Metric Scaling

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
  maxReplicas: 50
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0      # Scale up immediately
      policies:
        - type: Percent
          value: 100                      # Double pods at most per step
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300    # Wait 5min before scaling down
      policies:
        - type: Pods
          value: 2                        # Remove max 2 pods per step
          periodSeconds: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 75
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second  # Custom metric from Prometheus Adapter
        target:
          type: AverageValue
          averageValue: "1000"
```

### Scale Behavior — Preventing Flapping

```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300    # Look-back window — don't scale down if max replica count in last 5min was higher
    policies:
      - type: Percent
        value: 10                       # Remove max 10% of pods per period
        periodSeconds: 60
  scaleUp:
    stabilizationWindowSeconds: 0      # React immediately to spikes
    selectPolicy: Max                  # Use most aggressive policy
```

Scale-up should be fast (traffic spikes are immediate). Scale-down should be conservative (prevent removing too many pods during a brief traffic dip).

### Custom Metrics via Prometheus Adapter

HPA can scale on any Prometheus metric via the custom metrics API:

```yaml
# prometheus-adapter config
rules:
  - seriesQuery: 'http_requests_total{namespace!="",pod!=""}'
    resources:
      overrides:
        namespace: {resource: "namespace"}
        pod: {resource: "pod"}
    name:
      matches: "^(.*)_total"
      as: "${1}_per_second"
    metricsQuery: 'sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (<<.GroupBy>>)'
```

Then in HPA:
```yaml
- type: Pods
  pods:
    metric:
      name: http_requests_per_second
    target:
      type: AverageValue
      averageValue: "500"
```

### HPA Gotchas

- **Metrics server must be installed** — HPA requires `metrics-server` (or Prometheus Adapter for custom metrics). Without it, HPA shows `<unknown>` and doesn't scale.
- **HPA and VPA on the same Deployment conflict** — if both target CPU/memory, they fight. VPA changes requests → HPA's utilization target shifts → unstable loop. Use VPA for requests recommendation (Off mode) and HPA for replica scaling, or use KEDA instead.
- **`minReplicas: 1` means one pod** — single point of failure during scaling or node failure. Always set `minReplicas: 2` for production.
- **Scaling lag:** HPA evaluates every 15 seconds by default. There's always a 15-30s lag between load spike and pod addition, plus pod startup time. Pre-warm or set higher minReplicas for predictable traffic spikes.

---

## 8. VPA — Vertical Pod Autoscaler

### Modes

| Mode | Behavior | Use Case |
|---|---|---|
| `Off` | Recommendations only — no changes | Read recommendations, set requests manually |
| `Initial` | Set requests/limits at pod creation only | Pods get right-sized on restart |
| `Auto` | Live updates — evicts pods to resize | Automatic right-sizing (causes restarts) |
| `Recreate` | Same as Auto but more aggressive | Full pod recreation for resize |

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: myapp-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  updatePolicy:
    updateMode: "Off"               # Start with Off, observe recommendations
  resourcePolicy:
    containerPolicies:
      - containerName: myapp
        minAllowed:
          cpu: "100m"
          memory: "128Mi"
        maxAllowed:
          cpu: "4"
          memory: "4Gi"
        controlledResources: ["cpu", "memory"]
```

### Reading VPA Recommendations

```bash
kubectl describe vpa myapp-vpa
# Shows per-container:
#   Lower Bound:   cpu: 50m,  memory: 100Mi
#   Target:        cpu: 200m, memory: 256Mi  ← Set this as your request
#   Upper Bound:   cpu: 1,    memory: 1Gi
#   Uncapped Target: cpu: 180m, memory: 230Mi
```

Use VPA in `Off` mode for at least 24-48 hours under realistic load before trusting the recommendations.

### VPA Gotchas

- **VPA evicts pods to resize** — `Auto` mode will kill running pods to apply new resource settings. Schedule maintenance windows or use `Initial` mode.
- **Not compatible with HPA on same resource** — see HPA section.
- **JVM apps need special handling** — JVM heap is configured via `-Xmx` flags, not just container memory limits. VPA changing memory limits without matching JVM flags can cause OOMKills even though the limit was increased.

---

## 9. KEDA — Event-Driven Autoscaling

KEDA extends HPA to scale on **external event sources** — SQS queue depth, Kafka lag, Cron schedules, database row counts, HTTP request rates, and 60+ other sources.

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
  namespace: app-prod
spec:
  scaleTargetRef:
    name: queue-worker
  minReplicaCount: 0              # Scale to zero when idle
  maxReplicaCount: 100
  cooldownPeriod: 300             # Wait 5min before scaling down to zero
  pollingInterval: 15
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.ap-southeast-1.amazonaws.com/123456789/my-queue
        awsRegion: ap-southeast-1
        queueLength: "10"          # Target: 1 worker per 10 messages
      authenticationRef:
        name: keda-aws-credentials

    - type: cron
      metadata:
        timezone: Asia/Jakarta
        start: "0 8 * * 1-5"      # Scale up 8 AM weekdays
        end: "0 20 * * 1-5"       # Scale down 8 PM weekdays
        desiredReplicas: "5"
```

### Scale-to-Zero Pattern

KEDA's most powerful feature — workers scale to zero when there's no work, eliminating idle compute cost:

```
SQS queue empty → KEDA scales deployment to 0 pods
Message arrives → KEDA detects queue depth > 0
               → Scales deployment to 1+ pods within seconds
Messages processed → Queue empty again → Scales back to 0
```

For scale-to-zero to be safe, your workload must be:
- Stateless (no in-memory state lost during scale-down)
- Tolerant of cold start delay (new pods take time to be Ready)

### KEDA Authentication

```yaml
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: keda-aws-credentials
  namespace: app-prod
spec:
  podIdentity:
    provider: aws-eks              # Use IRSA — no credentials in KEDA config
```

---

## 10. Cluster Autoscaler vs Karpenter

### How Each Works

**Cluster Autoscaler (CA):**
```
Pending pod → CA checks which node group can satisfy it
           → Calls cloud API to add node to that group
           → Wait for node to join (1-3 minutes)
           → Pod scheduled
```

**Karpenter:**
```
Pending pod → Karpenter reads pod requirements directly
           → Provisions the exact right instance type immediately
           → Node joins in ~60 seconds
           → Pod scheduled
```

### Comparison

| Feature | Cluster Autoscaler | Karpenter |
|---|---|---|
| Node provisioning time | 2-5 min | ~60 seconds |
| Instance selection | From pre-defined node groups | Any instance type, right-sized |
| Spot handling | Node group per spot type | Flexible, multi-instance-type |
| Bin packing | Limited | Aggressive — consolidates nodes |
| Drift detection | ❌ | ✅ Replaces nodes with newer AMIs |
| ARM/AMD mix | Separate node groups | Same NodePool |
| AWS integration | Works | Native — purpose-built for AWS |

### Karpenter NodePool

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  template:
    metadata:
      labels:
        node-type: general
    spec:
      nodeClassRef:
        apiVersion: karpenter.k8s.aws/v1
        kind: EC2NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]    # Prefer spot, fall back to on-demand
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: ["c", "m", "r"]
        - key: karpenter.k8s.aws/instance-generation
          operator: Gt
          values: ["3"]                    # Only 4th gen and newer
      expireAfter: 720h                    # Recycle nodes after 30 days (drift control)
  limits:
    cpu: "1000"
    memory: 2000Gi
  disruption:
    consolidationPolicy: WhenUnderutilized
    consolidateAfter: 30s

---
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: default
spec:
  amiSelectorTerms:
    - alias: al2023@latest                 # Always latest Amazon Linux 2023
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: my-cluster
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: my-cluster
  instanceProfile: KarpenterNodeInstanceProfile
  blockDeviceMappings:
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 50Gi
        volumeType: gp3
        encrypted: true
```

### Karpenter Disruption & Consolidation

```yaml
disruption:
  consolidationPolicy: WhenUnderutilized   # or WhenEmpty
  consolidateAfter: 30s                    # Wait before acting
  budgets:
    - nodes: "10%"                         # Consolidate max 10% of nodes at once
```

Karpenter's consolidation is powerful but needs a `PodDisruptionBudget` on all workloads — otherwise consolidation can take down too many pods simultaneously.

---

## 11. PodDisruptionBudgets

PDB limits simultaneous voluntary disruptions (node drains, rolling upgrades, Karpenter consolidation).

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
  namespace: app-prod
spec:
  # Option A: minimum available replicas
  minAvailable: 2           # Always keep at least 2 pods running

  # Option B: maximum unavailable replicas
  # maxUnavailable: 1       # Allow at most 1 pod to be unavailable

  selector:
    matchLabels:
      app: myapp
```

### `minAvailable` vs `maxUnavailable`

```
5 replicas, minAvailable: 2    → max 3 pods can be disrupted simultaneously
5 replicas, maxUnavailable: 1  → max 1 pod can be disrupted simultaneously (safer)

# For HPA-managed deployments, maxUnavailable is better:
# minAvailable: 2 with 10 replicas → 8 can be disrupted (too many)
# maxUnavailable: 1 always limits to 1 regardless of replica count
```

### PDB Gotchas

- **PDB with minAvailable: 1 and 1 replica** — drain blocks forever. You can never disrupt the single pod. Use `minAvailable: 0` or scale to 2+ replicas before maintenance.
- **PDB doesn't protect against node failures** — PDB only governs voluntary disruptions. Node crashes bypass PDB entirely.
- **Karpenter consolidation respects PDB** — but if you have no PDB, Karpenter may consolidate aggressively and cause outages.
- **`maxUnavailable: "0%"` is equivalent to `minAvailable: 100%`** — nothing can be disrupted. This can cause cluster upgrades to hang if pods are stuck.

---

## 12. Priority Classes & Preemption

When the cluster is full and a high-priority pod needs to schedule, the scheduler can evict lower-priority pods to make room.

```yaml
# Define priority classes
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: critical-production
value: 1000000
globalDefault: false
description: "Critical production services"
preemptionPolicy: PreemptLowerPriority   # Default

---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: batch-low
value: 100
preemptionPolicy: Never                  # Won't preempt others but can be preempted
description: "Batch and background jobs"
```

```yaml
# Use in pod spec
spec:
  priorityClassName: critical-production
```

### Built-In System Priority Classes

```
system-cluster-critical   → value: 2000000100  (kube-dns, metrics-server)
system-node-critical      → value: 2000001000  (kube-proxy, fluentd as DaemonSet)
```

Don't use these for application pods. Create your own hierarchy:

```
system-cluster-critical   2000000100   ← K8s system (built-in)
critical-production       1000000      ← Your most critical services
standard-production       500000       ← Normal production workloads
non-production            100000       ← Dev/staging
batch                     1000         ← Background jobs
```

### Preemption Gotchas

- **Preemption ignores PDB** — when preempting, the scheduler may evict pods protected by PDB. PDB only governs drain/voluntary disruption, not scheduler preemption.
- **Preempted pods get graceful termination** — the scheduler waits for `terminationGracePeriodSeconds` before the node is considered free.
- **`preemptionPolicy: Never`** — pod can be preempted but won't preempt others. Use for batch jobs that should yield to production but shouldn't die silently.

---

*Last updated: 2026-05 | Author: Personal KB | K8s version context: 1.29+*