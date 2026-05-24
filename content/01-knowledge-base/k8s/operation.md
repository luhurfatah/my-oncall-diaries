# Kubernetes — Operations, Upgrades & Debugging

> **Scope:** Day-2 operations for production Kubernetes clusters. Covers cluster upgrade strategy, node management, debugging methodology, anti-patterns, and the commands you actually need when things break at 2 AM.

---

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Cluster Upgrade Strategy](#1-cluster-upgrade-strategy) | Upgrade order (control plane first), pre-upgrade checklist, and EKS upgrade process. |
| **02** | [Node Management](#2-node-management) | Cordon vs drain vs taint, node pressure eviction, and NotReady triage. |
| **03** | [Debugging Methodology](#3-debugging-methodology) | Systematic top-down approach and pod status meaning reference table. |
| **04** | [Debugging Playbooks](#4-debugging-playbooks) | Step-by-step playbooks for CrashLoopBackOff, Pending, DNS, image pull, and stuck termination. |
| **05** | [etcd Operations](#5-etcd-operations) | Health checks, backup procedure, and performance indicators. |
| **06** | [Backup & Disaster Recovery](#6-backup--disaster-recovery) | Velero installation, scheduled backups, what Velero backs up, and RTO/RPO planning. |
| **07** | [Production Anti-Patterns](#7-production-anti-patterns) | Workload and operations anti-patterns with the most dangerous combinations. |
| **08** | [Essential kubectl Commands](#8-essential-kubectl-commands) | Daily operations, logs, debugging, rollout management, and JSONPath queries. |

---

## 1. Cluster Upgrade Strategy

### Upgrade Order — Always Control Plane First

```
1. Back up etcd
2. Upgrade control plane (EKS: managed — just call the API)
3. Upgrade core add-ons (kube-proxy, CoreDNS, CNI)
4. Upgrade node groups one at a time (cordon → drain → upgrade → uncordon)
5. Upgrade Helm chart dependencies (cert-manager, ingress, prometheus)
6. Upgrade application Helm charts if K8s API changes affect them
```

**Never skip minor versions.** K8s only supports N-2 skew between kubelet and API server. Upgrade one minor version at a time: 1.28 → 1.29 → 1.30.

### Pre-Upgrade Checklist

```bash
# 1. Check API deprecations (will any existing resources break?)
kubent                    # kubectl node-triage — detects deprecated APIs in use
pluto detect-all-in-cluster

# 2. Check add-on compatibility
# cert-manager, ingress-nginx, external-secrets, Karpenter all have K8s version requirements
# Check each add-on's compatibility matrix before upgrading

# 3. Verify PodDisruptionBudgets won't block drain
kubectl get pdb -A

# 4. Check for pods with restrictive PDBs
kubectl get pods -A | grep -v Running   # Any non-running pods to resolve first?

# 5. Dry-run upgrade (EKS)
aws eks update-cluster-version \
  --name prod-cluster \
  --kubernetes-version 1.30
```

### API Deprecation Impact

Before upgrading, identify all resources using deprecated APIs:

```bash
# pluto output example:
# NAME                  NAMESPACE    KIND              VERSION     REPLACEMENT     REMOVED
# my-ingress            app-prod     Ingress           networking.k8s.io/v1beta1   networking.k8s.io/v1   true

# Fix: update manifests to use the new API version before upgrading
```

Common API removals between versions:
- 1.25: `PodSecurityPolicy` removed
- 1.26: `HorizontalPodAutoscaler/v2beta2` → `v2`
- 1.27: `CSIStorageCapacity/v1beta1` → `v1`

### EKS Upgrade Process

```bash
# 1. Upgrade control plane
aws eks update-cluster-version \
  --name prod-cluster \
  --kubernetes-version 1.30

# Wait for control plane update (~15 min)
aws eks wait cluster-active --name prod-cluster

# 2. Update add-ons
aws eks update-addon \
  --cluster-name prod-cluster \
  --addon-name vpc-cni \
  --resolve-conflicts OVERWRITE

# 3. Upgrade managed node groups (rolling)
aws eks update-nodegroup-version \
  --cluster-name prod-cluster \
  --nodegroup-name prod-workers \
  --kubernetes-version 1.30

# 4. If using Karpenter, it upgrades nodes via drift detection (set expireAfter)
# Nodes older than expireAfter are replaced with new AMI version automatically
```

### Node Group Upgrade — Manual (Self-Managed)

```bash
# Drain and upgrade one node at a time
for NODE in $(kubectl get nodes -l upgrade=true -o name); do
  echo "Draining $NODE"
  kubectl cordon $NODE
  kubectl drain $NODE \
    --ignore-daemonsets \
    --delete-emptydir-data \
    --grace-period=60 \
    --timeout=5m

  # Replace/upgrade the node here (terraform taint, AWS console, etc.)
  
  echo "Waiting for node to rejoin..."
  sleep 60
done
```

---

## 2. Node Management

### Cordon vs Drain vs Taint

| Action | Effect | Use Case |
|---|---|---|
| `cordon` | Mark unschedulable — no new pods | Preparing for maintenance |
| `drain` | Cordon + evict all pods (respects PDB) | Taking node offline |
| `taint` | Repel pods without tolerations | Permanent pool separation |
| `delete` | Remove node from cluster | Node terminated / replacement |

```bash
# Cordon — stop new pods landing here
kubectl cordon node-1

# Drain — evict existing pods gracefully
kubectl drain node-1 \
  --ignore-daemonsets \          # DaemonSet pods can't be moved
  --delete-emptydir-data \       # Allow evicting pods with emptyDir volumes
  --grace-period=120 \           # Give pods 2min to terminate
  --timeout=10m                  # Give up after 10min

# Drain gotcha: PDB blocking eviction
kubectl drain node-1 --disable-eviction  # Bypass PDB (dangerous, use only in emergencies)

# Uncordon — allow scheduling again
kubectl uncordon node-1
```

### Node Pressure & Eviction

Kubelet evicts pods when a node is under resource pressure:

```
Memory pressure: evicts BestEffort first, then Burstable, then Guaranteed
Disk pressure: evicts pods with largest disk usage
PID pressure: evicts pods with most processes
```

Eviction thresholds (kubelet config):
```yaml
evictionHard:
  memory.available: "200Mi"     # Evict when available < 200Mi
  nodefs.available: "10%"
  nodefs.inodesFree: "5%"
evictionSoft:
  memory.available: "500Mi"     # Warn when < 500Mi (no immediate eviction)
evictionSoftGracePeriod:
  memory.available: "1m30s"     # Evict soft threshold after 90s
```

### Node Not Ready — Triage

```bash
# Check node conditions
kubectl describe node <node-name>
# Look for: MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable

# SSH to node (if accessible)
systemctl status kubelet
journalctl -u kubelet -f --since "10 minutes ago"

# Check containerd
systemctl status containerd
crictl ps    # List running containers
```

Common causes:
- kubelet crashed (OOM, cert expired, config error)
- containerd not responding
- Node disk full (`df -h`, `du -sh /var/lib/docker` or `/var/lib/containerd`)
- kubelet certificate expired (`/var/lib/kubelet/pki/`)
- Network misconfiguration (CNI issue)

---

## 3. Debugging Methodology

### Systematic Approach — Start from the Top

```
1. Is the pod Running?
   → NO: debug scheduling (Pending) or crashing (CrashLoopBackOff/Error)
   → YES: continue

2. Is the pod Ready?
   → NO: readiness probe failing — check /ready endpoint, dependencies
   → YES: continue

3. Is traffic reaching the pod?
   → Check Service endpoints
   → Check NetworkPolicy
   → Check Ingress routing

4. Is the app responding correctly?
   → Check app logs
   → Check traces
```

### Pod Status Meanings

| Status | Meaning | First Action |
|---|---|---|
| `Pending` | Not scheduled yet | `kubectl describe pod` → Events section |
| `Init:0/1` | Init container running/waiting | `kubectl logs pod -c init-container-name` |
| `PodInitializing` | Init done, main container starting | Check image pull, container start |
| `Running` | Running but may not be ready | Check readiness probe |
| `CrashLoopBackOff` | Repeatedly crashing | `kubectl logs pod --previous` |
| `OOMKilled` | Memory limit exceeded | Increase limit or fix leak |
| `Error` | Container exited non-zero | `kubectl logs pod --previous` |
| `Terminating` | Deleting — stuck? | Finalizer blocking deletion |
| `ImagePullBackOff` | Can't pull image | Wrong tag, registry auth, network |
| `Evicted` | Evicted by kubelet | Node pressure — check node |

### `kubectl describe` — What to Actually Look For

```bash
kubectl describe pod <pod> -n <ns>
```

Key sections to check in order:
1. **Status** — current phase and reason
2. **Conditions** — Ready, ContainersReady, Initialized, PodScheduled
3. **Containers** — State (reason, exit code), Last State (for crashes), Ready
4. **Events** — **This is where the actual cause is.** Read from oldest to newest.

```
Events (bottom of describe output):
  Warning  FailedScheduling  3m   "0/5 nodes available: 3 Insufficient memory"
  Warning  BackOff           1m   "Back-off restarting failed container"
  Normal   Pulled            2m   "Successfully pulled image"
  Warning  OOMKilling        30s  "Memory cgroup out of memory"
```

---

## 4. Debugging Playbooks

### CrashLoopBackOff

```bash
# 1. Check current logs (may be empty if crash is immediate)
kubectl logs <pod> -n <ns>

# 2. Check previous container logs (MOST USEFUL)
kubectl logs <pod> -n <ns> --previous

# 3. Check exit code
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
# exitCode: 1 = app error, 137 = OOMKill/SIGKILL, 143 = SIGTERM

# 4. Override entrypoint to debug interactively
kubectl debug <pod> -it \
  --image=busybox \
  --target=<container> \
  --copy-to=debug-pod \
  -- sh

# 5. Create standalone debug pod with same spec
kubectl run debug --image=myapp:1.2.3 --command -- sleep 3600
kubectl exec -it debug -- /bin/sh
```

### Pod Stuck in Pending

```bash
# 1. Check events
kubectl describe pod <pod>

# 2. Inspect scheduler output
kubectl get events -n <ns> --field-selector reason=FailedScheduling

# 3. Check node resources
kubectl describe nodes | grep -A5 "Allocated resources"

# 4. Check if taint is blocking
kubectl describe nodes | grep Taints

# 5. Check PVC not bound
kubectl get pvc -n <ns>
kubectl describe pvc <pvc-name>    # Check storageClass, AZ mismatch

# 6. Simulate scheduling
kubectl auth can-i create pods --as=system:serviceaccount:<ns>:<sa>
```

### Service Not Routing Traffic

```bash
# 1. Check service exists and selector matches pods
kubectl get svc <svc> -n <ns> -o yaml
# Verify: spec.selector matches pod labels

# 2. Check endpoints are populated
kubectl get endpoints <svc> -n <ns>
# If empty: selector doesn't match any running+ready pods

# 3. Check pod readiness
kubectl get pods -l app=myapp -n <ns>
# All pods must be Ready (2/2, not 1/2)

# 4. Test from inside cluster
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never \
  -- curl http://<svc>.<ns>.svc.cluster.local:<port>/healthz

# 5. Check NetworkPolicy (if exists)
kubectl get networkpolicy -n <ns>
# Is there a deny-all? Is there an allow for the expected traffic?

# 6. Check kube-proxy / iptables rules on node
iptables -t nat -L KUBE-SERVICES | grep <svc-cluster-ip>
```

### DNS Resolution Failure

```bash
# 1. Test DNS from inside a pod
kubectl exec -it <pod> -n <ns> -- nslookup kubernetes.default

# 2. Check CoreDNS pods are running
kubectl get pods -n kube-system -l k8s-app=kube-dns

# 3. Check CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50

# 4. Test DNS directly
kubectl run dnsutils --image=gcr.io/kubernetes-e2e-test-images/dnsutils:1.3 \
  --rm -it --restart=Never -- nslookup myapp.app-prod.svc.cluster.local

# 5. Check resolv.conf in pod
kubectl exec -it <pod> -- cat /etc/resolv.conf
# Should show: nameserver <coredns-cluster-ip>

# 6. Check NetworkPolicy allows DNS (if egress deny-all is set)
kubectl get networkpolicy -n <ns>
# Must have egress rule allowing UDP/TCP 53 to kube-system
```

### Image Pull Failure

```bash
# 1. Check the error
kubectl describe pod <pod>
# "Failed to pull image": wrong tag, registry unreachable, auth failure

# 2. Check imagePullSecrets
kubectl get pod <pod> -o jsonpath='{.spec.imagePullSecrets}'
kubectl get secret <secret-name> -n <ns> -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d

# 3. Check if registry is reachable from node
# (may need to SSH to node)
curl -I https://myregistry.example.com/v2/

# 4. For ECR — check IAM role has ECR permissions
# Node instance profile must have ecr:GetAuthorizationToken + ecr:BatchGetImage
```

### Pod Stuck in Terminating

```bash
# 1. Check for finalizers
kubectl get pod <pod> -o jsonpath='{.metadata.finalizers}'

# 2. Force remove finalizers (use with care)
kubectl patch pod <pod> \
  -p '{"metadata":{"finalizers":null}}' \
  --type=merge

# 3. Force delete (last resort — may leave orphaned resources)
kubectl delete pod <pod> --grace-period=0 --force
```

---

## 5. etcd Operations

etcd is the brain of Kubernetes — all cluster state lives here.

### etcd Health Check

```bash
# Check etcd cluster health
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \
  endpoint health

# Check leader
etcdctl endpoint status --write-out=table

# Check member list
etcdctl member list --write-out=table
```

### etcd Backup (Critical — Do Before Any Upgrade)

```bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# Verify backup
etcdctl snapshot status /backup/etcd-snapshot.db --write-out=table
```

For EKS — etcd is managed by AWS and automatically backed up. You can't access etcd directly, but AWS snapshots it. Your backup strategy should be **Velero** for application state.

### etcd Performance Indicators

```promql
# etcd leader changes (should be 0 or near 0)
increase(etcd_server_leader_changes_seen_total[1h]) > 1

# etcd DB size (alert if approaching quota — default 8GB)
etcd_mvcc_db_total_size_in_bytes / 1e9

# Slow fsync (indicates disk I/O issue)
histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m])) > 0.01
```

etcd is I/O sensitive — always run it on fast SSD storage (gp3 or better). Slow disk = slow K8s API = cascading failures.

---

## 6. Backup & Disaster Recovery

### Velero — Application Backup

Velero backs up K8s resources (manifests) and optionally PVC data:

```bash
# Install Velero with AWS S3 backend
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.9.0 \
  --bucket my-velero-backups \
  --backup-location-config region=ap-southeast-1 \
  --snapshot-location-config region=ap-southeast-1 \
  --secret-file ./credentials-velero

# Create a scheduled backup
velero schedule create daily-backup \
  --schedule="0 2 * * *" \
  --include-namespaces app-prod,payments-prod \
  --ttl 720h \                # Keep 30 days
  --storage-location default

# One-off backup
velero backup create pre-upgrade-backup \
  --include-namespaces app-prod \
  --wait

# Restore
velero restore create \
  --from-backup pre-upgrade-backup \
  --include-namespaces app-prod
```

### What Velero Does and Doesn't Back Up

✅ **Does back up:**
- All K8s resources (Deployments, Services, ConfigMaps, Secrets, etc.)
- PersistentVolume data (via CSI snapshots or Restic/Kopia file backup)
- CustomResources (ArgoCD Applications, Prometheus rules, etc.)

❌ **Does NOT back up:**
- etcd itself (use etcd snapshot for that)
- Container runtime data
- In-memory application state

### RTO/RPO Planning

| Scenario | Recovery | RPO | RTO |
|---|---|---|---|
| Accidental resource deletion | Velero restore | Last backup | Minutes |
| Namespace wipe | Velero restore | Last backup | 10-30 min |
| Full cluster loss | New cluster + Velero restore + GitOps | Last backup | 1-4 hours |
| etcd corruption | etcd snapshot restore | Last snapshot | 30-60 min |
| Region failure | Pre-provisioned DR cluster + DNS failover | Near-zero (GitOps) | Minutes (traffic) |

GitOps dramatically improves RTO for cluster recreation — re-running ArgoCD sync restores all applications from Git. The bottleneck is usually stateful data (PVCs, databases).

---

## 7. Production Anti-Patterns

### Workload Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `:latest` image tag | Unpredictable deploys, broken rollback | Pin to digest: `myapp@sha256:abc123` |
| No requests/limits | BestEffort QoS, resource contention | Always set both |
| Running as root | Container escape = host access | `runAsNonRoot: true`, drop ALL caps |
| No liveness/readiness probes | Broken pods receive traffic, hung pods not restarted | Add all three probe types |
| Single replica in prod | Pod restart = full outage | `minReplicas: 2`, PDB |
| No PDB | Cluster upgrade kills all pods | PDB on every production Deployment |
| No graceful shutdown | In-flight requests dropped on deploy | SIGTERM handler + preStop sleep |
| Secrets in ConfigMaps | Anyone with ConfigMap read access can read secrets | External Secrets Operator |
| Default ServiceAccount | Overly permissive, shared blast radius | Dedicated SA per app, `automountServiceAccountToken: false` |
| HPA + VPA on same resource | Conflicting autoscaling | Use KEDA + VPA(Off) or just HPA |

### Operations Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `kubectl apply` to production | No audit trail, no rollback, drift from Git | GitOps-only writes to prod |
| Skipping minor versions on upgrade | API skew breaks kubelet or add-ons | One minor version at a time |
| No pre-upgrade API deprecation check | Post-upgrade resources fail to reconcile | Run `kubent`/`pluto` before every upgrade |
| Upgrading control plane and nodes simultaneously | Node compatibility window violated | Control plane first, then nodes |
| No etcd backup before upgrade | Unrecoverable cluster if upgrade fails | Backup etcd + Velero before every upgrade |
| No resource quotas on namespaces | One team exhausts all cluster resources | ResourceQuota + LimitRange per namespace |
| cluster-admin for CI/CD pipelines | Compromise of pipeline = cluster takeover | Scoped role per namespace |
| No NetworkPolicy | Flat cluster network, any pod can reach any pod | Default deny + explicit allows |
| DaemonSet without resource limits | DaemonSet on 100 nodes with no limits = 100× resource leak | Always set DaemonSet resource limits |
| Not monitoring the monitoring stack | Prometheus OOMs silently, alerts stop firing | Alert on Prometheus self-health + Watchdog |

### The Most Dangerous Combinations

```
1. No PDB + Karpenter consolidation
   → Karpenter drains a node, all replicas evicted simultaneously
   → Full service outage

2. HPA maxReplicas = 10 + no node autoscaler
   → Traffic spike, HPA wants 10 pods, nodes can't fit them
   → Pods pending, latency degrades, alerts fire late

3. readinessProbe with DB health check + default-deny egress NetworkPolicy
   → New pod can't reach DB (blocked by NetworkPolicy)
   → readinessProbe fails → pod never becomes Ready → rollout hangs

4. No graceful shutdown + maxUnavailable: 1 rolling update
   → Old pod evicted mid-request
   → In-flight requests receive connection reset
   → 502s during every deployment

5. VPA Auto mode + StatefulSet
   → VPA evicts pods to resize
   → StatefulSet OrderedReady: pod-0 evicted → pod-1 won't restart until pod-0 is ready
   → Cascading StatefulSet restart, extended downtime
```

---

## 8. Essential kubectl Commands

### Daily Operations

```bash
# Wide view of pods (shows node, IP)
kubectl get pods -n app-prod -o wide

# Watch pods in real time
kubectl get pods -n app-prod -w

# Get pods with resource usage
kubectl top pods -n app-prod --sort-by=memory

# All pods across all namespaces — sorted by restart count
kubectl get pods -A --sort-by='.status.containerStatuses[0].restartCount'

# Get all non-running pods
kubectl get pods -A --field-selector='status.phase!=Running'

# Events sorted by time — THE most useful debugging command
kubectl get events -n app-prod --sort-by='.lastTimestamp'

# Events for a specific pod
kubectl get events -n app-prod \
  --field-selector involvedObject.name=<pod-name>
```

### Logs

```bash
# Previous container logs (crashed container)
kubectl logs <pod> -n app-prod --previous

# Follow logs from all pods with label
kubectl logs -l app=myapp -n app-prod -f --max-log-requests=10

# Multi-container pod — specify container
kubectl logs <pod> -n app-prod -c myapp-container

# Timestamps
kubectl logs <pod> -n app-prod --timestamps=true --since=1h

# Stern — multi-pod log aggregation (install separately)
stern myapp -n app-prod --since 30m
```

### Inspection & Debugging

```bash
# Shell into running container
kubectl exec -it <pod> -n app-prod -- /bin/sh

# Ephemeral debug container (when main container has no shell)
kubectl debug -it <pod> -n app-prod \
  --image=nicolaka/netshoot \           # Contains curl, nslookup, tcpdump, etc.
  --target=<container-name>

# Copy files from pod
kubectl cp app-prod/<pod>:/app/logs/app.log ./app.log

# Port-forward to test service locally
kubectl port-forward svc/myapp 8080:80 -n app-prod

# Port-forward to a pod directly
kubectl port-forward pod/<pod> 8080:8080 -n app-prod

# Check resource usage on nodes
kubectl describe nodes | grep -A 10 "Allocated resources"

# What can a service account do?
kubectl auth can-i --list \
  --as=system:serviceaccount:app-prod:myapp-sa \
  -n app-prod
```

### Rollout Management

```bash
# Check rollout status (blocks until complete or fails)
kubectl rollout status deployment/myapp -n app-prod --timeout=5m

# View rollout history
kubectl rollout history deployment/myapp -n app-prod

# Rollback
kubectl rollout undo deployment/myapp -n app-prod
kubectl rollout undo deployment/myapp --to-revision=3 -n app-prod

# Pause/resume (for manual canary control)
kubectl rollout pause deployment/myapp -n app-prod
kubectl rollout resume deployment/myapp -n app-prod

# Restart all pods (rolling, respects PDB)
kubectl rollout restart deployment/myapp -n app-prod
```

### Resource Management

```bash
# Edit resource live (opens $EDITOR)
kubectl edit deployment/myapp -n app-prod

# Patch without editor
kubectl patch deployment myapp -n app-prod \
  -p '{"spec":{"replicas":5}}'

# Set image (quick update — prefer GitOps in prod)
kubectl set image deployment/myapp myapp=myapp:1.2.4 -n app-prod

# Scale manually
kubectl scale deployment/myapp --replicas=10 -n app-prod

# Delete stuck namespace
kubectl delete namespace app-old --grace-period=0

# If namespace stuck in Terminating, remove finalizers
kubectl get namespace app-old -o json \
  | jq '.spec.finalizers = []' \
  | kubectl replace --raw "/api/v1/namespaces/app-old/finalize" -f -
```

### Cluster-Wide Inspection

```bash
# All resources in a namespace
kubectl get all -n app-prod

# Resource usage vs quotas
kubectl describe resourcequota -n app-prod

# What's using the most resources
kubectl top nodes
kubectl top pods -A --sort-by=cpu | head -20

# Find all pods running on a specific node
kubectl get pods -A --field-selector spec.nodeName=<node-name>

# Check API server health
kubectl get componentstatuses          # Older clusters
kubectl get --raw='/healthz'           # API server health
kubectl get --raw='/healthz/etcd'      # etcd via API server

# Node conditions summary
kubectl get nodes -o custom-columns=\
'NAME:.metadata.name,STATUS:.status.conditions[-1].type,REASON:.status.conditions[-1].reason'
```

### JSONPath & JQ — Power Queries

```bash
# Get all images running in cluster
kubectl get pods -A -o jsonpath='{.items[*].spec.containers[*].image}' | tr ' ' '\n' | sort -u

# Get pods with their QoS class
kubectl get pods -n app-prod \
  -o custom-columns='NAME:.metadata.name,QOS:.status.qosClass'

# Get all service account names
kubectl get pods -n app-prod \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.serviceAccountName}{"\n"}{end}'

# Find pods with no resource limits set
kubectl get pods -n app-prod -o json | \
  jq '.items[] | select(.spec.containers[].resources.limits == null) | .metadata.name'

# Find all pods using a specific image
kubectl get pods -A -o json | \
  jq '.items[] | select(.spec.containers[].image | contains("myapp:latest")) | .metadata.name'
```

---

*Last updated: 2026-05 | Author: Personal KB | Covers: EKS, self-managed K8s 1.29+, Velero, etcd*