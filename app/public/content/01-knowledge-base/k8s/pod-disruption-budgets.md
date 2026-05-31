# How Pod Disruption Budgets Work

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The Problem PDB Solves](#1-the-problem-pdb-solves) | Why Kubernetes needs a mechanism to protect workload availability during maintenance operations. |
| **02** | [Voluntary vs Involuntary Disruptions](#2-voluntary-vs-involuntary-disruptions) | The fundamental distinction that defines what PDB can and cannot protect against. |
| **03** | [PDB Mechanics: minAvailable and maxUnavailable](#3-pdb-mechanics-minavailable-and-maxunavailable) | How the two PDB fields work, what they calculate against, and how to choose between them. |
| **04** | [The Eviction API](#4-the-eviction-api) | How eviction requests are processed, how PDB is checked, and what happens when a budget is exhausted. |
| **05** | [Node Drain & kubectl drain](#5-node-drain-kubectl-drain) | How drain works under the hood, its interaction with PDB, and why drains block. |
| **06** | [Cluster Autoscaler & Karpenter Interaction](#6-cluster-autoscaler-karpenter-interaction) | How scale-down decisions respect PDB and the operational implications for node consolidation. |
| **07** | [Rolling Updates & PDB](#7-rolling-updates-pdb) | How Deployment rolling updates interact with PDB, the relationship with maxSurge and maxUnavailable, and where conflicts arise. |
| **08** | [PriorityClass & Preemption](#8-priorityclass-preemption) | How pod priority affects eviction ordering, what preemption is, and how it bypasses PDB. |
| **09** | [Design Patterns](#9-design-patterns) | PDB patterns for Deployments, StatefulSets, single-replica workloads, and critical infrastructure pods. |
| **10** | [Common Misconfigurations & Deadlocks](#10-common-misconfigurations-deadlocks) | The configurations that silently break cluster maintenance — and how to detect and fix them. |

---

## 1. The Problem PDB Solves

Kubernetes is very good at recovering from involuntary failures — a node dies, the controller manager notices, pods are rescheduled elsewhere. But Kubernetes also performs many deliberate, controlled operations that require removing pods from nodes: node upgrades, node pool rotations, cluster autoscaler scale-downs, and manual maintenance drains. These are **voluntary disruptions** — the cluster operator is intentionally asking pods to leave a node.

Without any guardrail, a voluntary disruption can be just as damaging as an involuntary failure. If a node drain removes all three replicas of a critical service simultaneously — because all three happened to be scheduled on the same node, or because two nodes are being drained at once — the service goes down. The disruption was deliberate but the outage was not.

A **Pod Disruption Budget** is a Kubernetes object that puts a floor under a workload's availability during voluntary disruptions. It tells the cluster: "no matter what maintenance you are performing, this workload must always have at least N pods running." Any component that performs voluntary disruptions — `kubectl drain`, the cluster autoscaler, Karpenter — is required to respect this constraint before evicting a pod.

PDB is not about preventing disruptions. It is about bounding the impact of disruptions so that availability guarantees can be maintained through routine cluster operations without manual coordination.

---

## 2. Voluntary vs Involuntary Disruptions

This distinction is the conceptual foundation of PDB. Getting it wrong leads to unrealistic expectations about what PDB can protect.

### Voluntary Disruptions

A voluntary disruption is one where a human or an automated system deliberately requests that a pod be evicted from a node. The key word is *requests* — voluntary disruptions go through the **Eviction API**, which is where PDB enforcement happens. Examples include:

- `kubectl drain` during a node upgrade or maintenance window.
- Cluster Autoscaler removing an underutilized node.
- Karpenter consolidating workloads onto fewer nodes.
- A human running `kubectl delete pod` (this also goes through the eviction path when graceful deletion is involved).
- A rolling update that terminates old pods to make room for new ones.

PDB protects against all of these. If evicting a pod would violate the budget, the eviction is denied and the requesting system must wait or give up.

### Involuntary Disruptions

An involuntary disruption is one the cluster did not choose and cannot prevent — the underlying infrastructure failed. Examples include:

- A node's kernel panics or the EC2 instance is terminated by AWS.
- A hardware failure takes a node offline.
- An OOMKill terminates a container because it exceeded its memory limit.
- A network partition makes a node unreachable.

PDB **does not protect against involuntary disruptions**. When a node dies, its pods are simply gone — the kubelet is not running, the Eviction API is not consulted, and the budget is irrelevant. The controller manager notices the missing pods and schedules replacements, but the disruption already happened.

This is a critical operational point. A PDB with `minAvailable: 2` on a three-replica Deployment does not guarantee two replicas are always running. It guarantees that voluntary disruptions will not bring the count below two. If two nodes fail simultaneously, all three replicas could be lost regardless of the PDB.

| Disruption Type | Goes Through Eviction API | PDB Enforced |
| :--- | :--- | :--- |
| `kubectl drain` | Yes | Yes |
| Cluster Autoscaler scale-down | Yes | Yes |
| Karpenter consolidation | Yes | Yes |
| Rolling update pod termination | Yes | Yes |
| Node hardware failure | No | No |
| OOMKill | No | No |
| EC2 instance termination (AWS) | No | No |

---

## 3. PDB Mechanics: minAvailable and maxUnavailable

A PDB object selects pods using a `selector` that matches pod labels — the same label selector pattern used by Services and ReplicaSets. The budget applies to all pods matched by that selector across all nodes in the cluster.

PDB has two mutually exclusive fields for expressing the availability constraint:

### minAvailable

`minAvailable` sets the minimum number of matched pods that must be in a Running and Ready state before any eviction is permitted. It can be expressed as an absolute integer or a percentage.

- `minAvailable: 2` — at least 2 pods must be ready. If there are 3 total and 1 is already unavailable for any reason, no eviction is allowed.
- `minAvailable: 50%` — at least 50% of the matched pods must be ready, rounded down. With 4 replicas, this means at least 2 must be ready before eviction proceeds.

### maxUnavailable

`maxUnavailable` sets the maximum number of matched pods that can be unavailable simultaneously during disruption. It is the inverse of `minAvailable` and is often more intuitive for rolling-update-style thinking.

- `maxUnavailable: 1` — only 1 pod can be unavailable at a time. With 3 replicas, at least 2 must be ready before an eviction is permitted.
- `maxUnavailable: 25%` — at most 25% of pods can be unavailable, rounded down. With 8 replicas, at most 2 can be unavailable.

### Which to Use

The choice between them is largely stylistic, but there are cases where one is more precise:

| Scenario | Preferred field | Reason |
| :--- | :--- | :--- |
| Fixed minimum replicas required for quorum | `minAvailable: N` | Absolute — not affected by replica count changes |
| Maximizing disruption throughput during upgrades | `maxUnavailable: N` | Directly controls pace of eviction |
| Percentage-based for auto-scaling workloads | Either as `%` | Scales with replica count automatically |
| Single critical pod (replicas: 1) | `minAvailable: 1` | Blocks all eviction until a replacement is running |

### How the Budget Is Calculated

At any moment, Kubernetes calculates the **disruptions allowed** as:

```
disruptions allowed = current ready pods − minAvailable
```

Or equivalently for `maxUnavailable`:

```
disruptions allowed = maxUnavailable − current unavailable pods
```

If disruptions allowed is zero or negative, the budget is exhausted and no eviction is permitted. This calculation is live — as pods recover and become ready again, the budget opens back up and evictions can proceed.

---

## 4. The Eviction API

The Eviction API is a Kubernetes sub-resource of the Pod object. Rather than deleting a pod directly, a caller creates an `Eviction` object targeting the pod. The API server intercepts this request and, before proceeding, checks whether the eviction would violate any PDB that selects the target pod.

### What Happens During an Eviction Request

1. The caller (kubectl drain, cluster autoscaler, etc.) sends a POST to `/api/v1/namespaces/{ns}/pods/{pod}/eviction`.
2. The API server checks all PDBs whose selector matches the pod.
3. If evicting this pod would bring the ready pod count below `minAvailable` (or push unavailable count above `maxUnavailable`), the API server returns **HTTP 429 Too Many Requests** — the eviction is denied.
4. If the budget allows the eviction, the API server proceeds with a graceful deletion of the pod, respecting the pod's `terminationGracePeriodSeconds`.
5. The PDB's `disruptionsAllowed` counter is decremented immediately upon approval, before the pod actually terminates — preventing concurrent evictions from racing and simultaneously violating the budget.

### 429 vs 500

A 429 response means "budget exhausted, try again later." The caller is expected to retry after a delay. A 500 response means something went wrong. Tools like `kubectl drain` handle 429 automatically — they poll and retry until the eviction succeeds or a timeout is reached.

### PDB Status Fields

The PDB object's `status` field exposes the current state of the budget in real time:

| Field | Meaning |
| :--- | :--- |
| `currentHealthy` | Number of pods currently Ready |
| `desiredHealthy` | The target derived from minAvailable or maxUnavailable |
| `disruptionsAllowed` | How many pods can be evicted right now |
| `expectedPods` | Total pods matched by the selector |
| `disruptedPods` | Pods currently being disrupted (eviction in progress) |

Inspecting these fields via `kubectl get pdb -o wide` is the first diagnostic step when a drain is stuck.

---

## 5. Node Drain & kubectl drain

`kubectl drain` is the standard operation for preparing a node for maintenance — it cordons the node (marking it unschedulable so no new pods are assigned) and then evicts all pods currently running on it.

### How Drain Works Under the Hood

Drain does not delete pods — it creates `Eviction` objects for each pod on the node, one at a time or in parallel depending on the implementation. For each eviction attempt:

- If the eviction is approved (budget allows), the pod is gracefully terminated and drain moves to the next pod.
- If the eviction is denied (budget exhausted — HTTP 429), drain waits and retries. By default, `kubectl drain` retries indefinitely until it succeeds or `--timeout` is reached.

This retry loop is what causes drain operations to hang. An operator running `kubectl drain node-1` may find the command sitting for minutes or hours if a PDB is blocking eviction because the workload does not have enough healthy replicas elsewhere to allow the disruption.

### What Drain Skips

By default, drain will not evict:

- **DaemonSet-managed pods** — drain skips these unless `--ignore-daemonsets` is passed. DaemonSet pods are expected to exist on every node; evicting them is meaningless because they will be immediately recreated.
- **Pods with local storage** (emptyDir volumes) — drain skips these unless `--delete-emptydir-data` is passed, because evicting them destroys the data.
- **Unmanaged pods** (not owned by any controller) — drain refuses to evict these unless `--force` is passed, because they will not be recreated after eviction.

### Drain and PDB Interaction

The interaction between drain and PDB is the most common source of stuck node drains in production. The scenario:

- A Deployment has 3 replicas distributed across 3 nodes.
- PDB requires `minAvailable: 2`.
- Node 2 experiences a hardware failure — its pods are lost involuntarily. Now only 2 replicas are running (on nodes 1 and 3).
- An operator tries to drain Node 1 for a scheduled upgrade.
- Drain attempts to evict the pod on Node 1. The eviction check: evicting this pod would leave only 1 ready pod, violating `minAvailable: 2`. Eviction denied — 429.
- Drain blocks indefinitely, waiting for the budget to open.
- The budget will not open until the lost replica on Node 2 is rescheduled and becomes Ready somewhere else.

The fix in this scenario is to wait for the scheduler to reschedule the lost pod — once it becomes Ready on another node, `currentHealthy` rises to 3, `disruptionsAllowed` becomes 1, and drain can proceed.

---

## 6. Cluster Autoscaler & Karpenter Interaction

Both the Cluster Autoscaler and Karpenter use the Eviction API when removing nodes, so PDB enforcement applies to their scale-down and consolidation operations identically to `kubectl drain`.

### Cluster Autoscaler Scale-Down

Before the Cluster Autoscaler removes an underutilized node, it simulates the eviction of all pods on that node and checks whether any PDB would be violated. If evicting any pod on the candidate node would exhaust a budget, the node is marked as **unremovable** and skipped for scale-down during that cycle.

This means a misconfigured PDB can permanently block cluster autoscaler scale-down, leaving underutilized nodes running indefinitely and increasing cluster cost. The Cluster Autoscaler exposes this via its logs and status — nodes blocked by PDB are annotated with the reason.

### Karpenter Consolidation

Karpenter's consolidation logic — which attempts to pack workloads onto fewer, cheaper nodes — similarly checks PDB before evicting pods during node removal. If consolidation would violate a budget, Karpenter skips that node or defers consolidation until the budget allows.

Karpenter has an additional concept: **disruption budgets at the node pool level** (`spec.disruption.budgets` in the NodePool object). These are Karpenter-native budgets that limit how many nodes Karpenter can disrupt simultaneously, independent of pod-level PDBs. This is a separate control from Kubernetes PDB and operates at a higher level — it limits the rate of node replacement, not the pod availability minimum.

### The Blocking Pattern

A common operational pattern that blocks both cluster autoscaler and Karpenter:

- A workload has a single replica and `minAvailable: 1`.
- The pod is the only pod on a node.
- Scale-down simulation: evicting the pod would leave 0 ready pods, violating `minAvailable: 1`.
- Node is permanently unremovable by the autoscaler.

The fix is not to remove the PDB — it is to ensure the workload has more than one replica, or to accept that single-replica workloads with `minAvailable: 1` are intentionally pinning a node and size the cluster accordingly.

---

## 7. Rolling Updates & PDB

Rolling updates and PDB both express availability constraints during disruption, but they operate at different layers and can conflict with each other in ways that slow or stall deployments.

### How Rolling Updates Work

A Deployment's rolling update strategy uses two fields:

- `maxUnavailable` — how many pods can be unavailable during the rollout (old pods terminated before new ones are ready).
- `maxSurge` — how many extra pods can be created above the desired replica count during the rollout (new pods started before old ones are terminated).

The Deployment controller manages this by scaling up the new ReplicaSet and scaling down the old one in steps, respecting these bounds.

### Where PDB and Rolling Updates Interact

Rolling updates terminate old pods via the Eviction API. If the Deployment's `maxUnavailable` would allow terminating a pod, but the PDB says no evictions are currently allowed, the rollout stalls — the controller retries until the budget allows the eviction.

This creates a practical tension: a PDB with `minAvailable: N` and a Deployment with `maxUnavailable: 1` both express availability constraints, but they are evaluated independently. The effective constraint is whichever is more restrictive.

| Deployment replicas | PDB minAvailable | Deployment maxUnavailable | Effective constraint |
| :--- | :--- | :--- | :--- |
| 3 | 2 | 1 | 1 pod at a time — aligned, no conflict |
| 3 | 3 | 1 | PDB requires all 3 ready — rollout cannot proceed without maxSurge |
| 5 | 3 | 2 | PDB allows 2 unavailable, Deployment allows 2 — aligned |
| 4 | 4 | 1 | PDB requires all 4 ready — rollout stalls without surge capacity |

The case where `minAvailable` equals the total replica count is the most common rollout deadlock. If the PDB requires all replicas to be healthy and the rollout wants to terminate one, no eviction is ever allowed. The solution is either to reduce `minAvailable` below the replica count, increase the replica count above `minAvailable`, or use `maxSurge` to add extra capacity before terminating old pods.

### Using maxSurge to Avoid Rollout Deadlock

With `maxSurge: 1` and `maxUnavailable: 0`, the rollout strategy creates a new pod first (bringing total to 4 in a 3-replica Deployment), waits for it to become Ready, then terminates an old pod. The PDB check at termination time sees 4 ready pods — evicting one leaves 3, which satisfies `minAvailable: 3`. No deadlock.

This is the recommended rollout strategy for any workload with a strict PDB: `maxUnavailable: 0` and `maxSurge: 1` or higher. It trades rollout speed for guaranteed availability throughout the update.

---

## 8. PriorityClass & Preemption

PriorityClass and PDB operate in adjacent but distinct parts of the Kubernetes scheduling and eviction system. Understanding how they interact prevents surprises during resource-constrained events.

### PriorityClass

A PriorityClass assigns an integer priority value to pods. Higher-priority pods are scheduled first and, when resources are scarce, lower-priority pods can be **preempted** — evicted to make room for higher-priority pods that cannot be scheduled due to resource constraints.

Common priority tiers in a Landing Zone cluster:

| PriorityClass | Value | Typical Use |
| :--- | :--- | :--- |
| `system-cluster-critical` | 2,000,001,000 | Core cluster components (CoreDNS, kube-proxy) |
| `system-node-critical` | 2,000,000,000 | Node-level daemons (kube-proxy, CNI) |
| `platform-high` | 1,000,000 | Platform infrastructure (monitoring, logging agents) |
| `application-standard` | 100,000 | Standard application workloads |
| `batch-low` | 1,000 | Batch jobs, non-critical background work |

### Preemption Bypasses PDB

This is the most important and least understood interaction: **preemption does not go through the Eviction API and therefore does not respect PDB.**

When the scheduler needs to preempt a lower-priority pod to place a higher-priority pod, it deletes the lower-priority pod directly — not via an eviction request. The PDB for that pod is not consulted. This means a critical high-priority pod that cannot be scheduled can cause a PDB-protected workload to have pods forcibly removed, potentially violating the availability guarantee the PDB was meant to provide.

The practical implication: PDB protects against voluntary maintenance disruptions, not against preemption by higher-priority workloads. If a cluster runs critical system pods at very high priority and application workloads at standard priority, a sudden burst of critical pods needing scheduling can preempt application pods regardless of their PDB.

The mitigation is careful PriorityClass design: ensure that the pods most likely to be preempted are genuinely lower-priority batch workloads, not critical application replicas. Assigning `system-cluster-critical` to everything defeats the priority system and still does not protect against node-level failures.

### Eviction Ordering (Non-Preemption)

For voluntary eviction — where the kubelet is evicting pods due to node resource pressure rather than scheduler preemption — PriorityClass does influence the order. The kubelet evicts pods in priority order, lowest first, when the node is under memory or disk pressure. PDB is still respected here because node-pressure eviction goes through the Eviction API. Lower-priority pods are evicted first, and if their PDB allows it, higher-priority pods are left untouched.

---

## 9. Design Patterns

### Pattern 1: Standard Multi-Replica Deployment

For a typical stateless Deployment with 3 or more replicas, the standard pattern is `maxUnavailable: 1` — allow one disruption at a time. This keeps the blast radius of any single maintenance operation bounded to one pod while not being so conservative that drains become impractically slow.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payments-api-pdb
  namespace: payments
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: payments-api
```

Pair this with a rolling update strategy of `maxUnavailable: 0` and `maxSurge: 1` to ensure the PDB is never the constraint that blocks a rollout.

### Pattern 2: StatefulSet with Quorum Requirements

StatefulSets often back stateful systems — databases, message queues, consensus clusters — that have a minimum quorum requirement. A three-node etcd cluster requires at least 2 members (quorum of a 3-node Raft cluster). A PDB should reflect this:

```yaml
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: etcd
```

Using `minAvailable` (absolute integer) rather than a percentage is intentional here: quorum is a fixed number, not a proportion. If the replica count ever changes, the quorum requirement may not scale proportionally — it needs to be updated explicitly.

### Pattern 3: Single-Replica Workload

Single-replica workloads are the hardest to protect. A PDB with `minAvailable: 1` on a single-replica workload blocks all voluntary eviction — the pod cannot be drained without a replacement already running, which the scheduler cannot provide until the node is drained and the pod is rescheduled. This is a chicken-and-egg problem.

The honest answer: single-replica workloads cannot have zero-downtime voluntary disruptions without architectural change. The options are:

- Accept brief downtime during drains (no PDB, or PDB with `minAvailable: 0`).
- Increase replicas to 2 or more, which is the correct fix for availability-sensitive workloads.
- Use `minAvailable: 1` and accept that drain operations will be blocked until the scheduler reschedules the pod on another node after the drain completes — which only works if `--force` is used or the pod is unmanaged.

### Pattern 4: Critical Infrastructure DaemonSets

DaemonSet pods — CNI agents, log shippers, monitoring collectors — are typically skipped by drain (`--ignore-daemonsets`). They do not need PDBs for drain protection. However, if a DaemonSet pod is selected by a PDB (e.g., through a namespace-wide label selector), the PDB may block evictions it was never intended to protect. Always scope PDB selectors tightly to the specific workload labels.

### Pattern 5: Percentage-Based for Auto-Scaling Workloads

For workloads managed by HPA where the replica count fluctuates, percentage-based PDB fields scale automatically with the replica count:

```yaml
spec:
  maxUnavailable: 25%
  selector:
    matchLabels:
      app: api-gateway
```

With 4 replicas, this allows 1 disruption. With 8 replicas (after HPA scales up), it allows 2. The budget grows with the workload without requiring PDB updates.

---

## 10. Common Misconfigurations & Deadlocks

### Misconfiguration 1: minAvailable Equals Replica Count

Setting `minAvailable` equal to the total number of replicas means zero disruptions are ever allowed. No eviction can proceed because any eviction would immediately bring the healthy count below the minimum.

This is the most common PDB deadlock in production. It is often set with good intentions — "I want all my pods to always be available" — without understanding that this makes voluntary disruptions impossible without either scaling up first or temporarily deleting the PDB.

**Detection:** `kubectl get pdb` shows `DISRUPTIONS ALLOWED: 0` persistently even when all pods are healthy.

**Fix:** Set `minAvailable` to `replicas - 1`, or use `maxUnavailable: 1`.

### Misconfiguration 2: Selector Matches No Pods

A PDB with a selector that matches zero pods has `disruptionsAllowed: 0` — because `currentHealthy` is zero and therefore the budget is always exhausted. Any eviction of any pod that is later caught by the selector will be blocked.

More dangerously, a PDB with a selector that matches pods from multiple Deployments or StatefulSets may conflate their availability budgets — disrupting one workload affects the budget available for disrupting the other.

**Detection:** `kubectl get pdb -o wide` — check `EXPECTED PODS` and `CURRENT HEALTHY`. If both are 0 for a PDB that should be protecting something, the selector is wrong.

### Misconfiguration 3: PDB Without Corresponding Replicas

A PDB that requires `minAvailable: 3` on a Deployment with only 2 replicas means the budget is permanently exhausted — there are never enough healthy pods to allow any disruption. This is often introduced when a team scales down a Deployment during cost optimization but forgets to update the PDB.

**Detection:** `DESIRED HEALTHY` exceeds `EXPECTED PODS` in `kubectl get pdb -o wide`.

### Misconfiguration 4: PDB Blocking Cluster Autoscaler Permanently

Any PDB with `minAvailable` equal to replica count on a single-replica workload permanently marks its node as unremovable by the cluster autoscaler. In clusters with many such workloads spread across many nodes, this can prevent the autoscaler from ever scaling down, leading to permanently oversized clusters.

**Detection:** Cluster Autoscaler logs show nodes as `unremovable: not enough pod disruption budget to move`. `kubectl describe configmap cluster-autoscaler-status -n kube-system` shows blocked nodes.

**Fix:** Either accept that nodes hosting single-replica workloads with `minAvailable: 1` will not be consolidated, or increase replicas to 2+ to allow the autoscaler to find another node with capacity.

### Misconfiguration 5: Forgetting PDB During Rollout Strategy Design

A Deployment with `maxUnavailable: 0` and `maxSurge: 0` — which is invalid and Kubernetes will reject — or `maxUnavailable: 1` and a PDB with `minAvailable: replicas` will stall rollouts permanently. Always design the rolling update strategy and the PDB together, verifying that the effective allowed disruptions is at least 1 for rollouts to make progress.

### Quick Diagnostic Reference

| Symptom | First Check | Likely Cause |
| :--- | :--- | :--- |
| `kubectl drain` hangs indefinitely | `kubectl get pdb -A` — check `DISRUPTIONS ALLOWED` | PDB exhausted; check `currentHealthy` vs `desiredHealthy` |
| Cluster autoscaler never scales down | Autoscaler logs; `kubectl describe cm cluster-autoscaler-status` | PDB blocks eviction on candidate nodes |
| Rolling update stalls at 0 progress | `kubectl get pdb`, `kubectl rollout status` | PDB minAvailable = replica count; add maxSurge |
| PDB shows `DISRUPTIONS ALLOWED: 0` with all pods healthy | `kubectl get pdb -o yaml` — check selector | Selector mismatch, or minAvailable = expectedPods |
| Drain succeeds but service is briefly down | Check PDB — was it present? | No PDB configured; all replicas on drained node |