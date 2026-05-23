# Kubernetes Best Practices Cheatsheet

> ## 📌 Quick Summary — Top Best Practices to Remember
>
> 1. **Always set resource requests and limits** — prevents resource contention; aim for Guaranteed or Burstable QoS, never BestEffort in prod
> 2. **Never run containers as root** — use `runAsNonRoot`, `readOnlyRootFilesystem`, drop all capabilities
> 3. **Never use `:latest` image tag in production** — unpredictable deployments and breaks rollback
> 4. **Liveness + Readiness + Startup probes** — liveness restarts unhealthy pods, readiness removes from traffic, startup gates slow-starting apps
> 5. **Namespace isolation with RBAC** — separate teams/environments by namespace; least-privilege roles, dedicated ServiceAccounts per app
> 6. **NetworkPolicies (default deny)** — zero-trust pod-to-pod communication; explicitly allow only required traffic
> 7. **PodDisruptionBudgets (PDB)** — prevent upgrades and node drains from taking down all replicas simultaneously
> 8. **Spread replicas across AZs** — use `topologySpreadConstraints` or pod anti-affinity for high availability
> 9. **External Secrets Operator for secrets** — never store plaintext secrets in Git or ConfigMaps
> 10. **HPA for autoscaling + Cluster Autoscaler/Karpenter** — scale pods on CPU/memory, scale nodes on pending pods; always `minReplicas >= 2`

---

## 1. Core Philosophy

- **Declarative over imperative** — define desired state in YAML, let K8s reconcile
- **Everything in Git** — manifests, Helm values, Kustomize overlays (GitOps)
- **Cattle, not pets** — pods are ephemeral; design for disposability
- **Least privilege** — minimal RBAC, minimal container capabilities
- **Observability by default** — logs, metrics, traces built in from day one
- **Namespace isolation** — separate teams/envs by namespace, enforce with policies

---

## 2. Pod Design & Workload Best Practices

### Always Set Resource Requests & Limits

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

- **Requests** = what the scheduler uses for placement
- **Limits** = hard ceiling (CPU throttled, Memory OOMKilled if exceeded)
- No requests/limits = pods fight for resources, cluster becomes unstable
- Aim for **Burstable** or **Guaranteed** QoS class (avoid BestEffort in prod)

### QoS Classes

| Class | Condition | Eviction Priority |
|---|---|---|
| Guaranteed | requests == limits for all containers | Last to be evicted |
| Burstable | requests < limits | Middle |
| BestEffort | No requests/limits set | First to be evicted |

### Liveness, Readiness, and Startup Probes

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5

startupProbe:           # For slow-starting apps
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

- **Liveness** — restart container if unhealthy
- **Readiness** — remove from Service endpoints if not ready (no traffic)
- **Startup** — gate liveness/readiness until app is initialized

### Pod Lifecycle & Graceful Shutdown

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]  # Allow in-flight requests to drain
terminationGracePeriodSeconds: 60
```

- Always handle **SIGTERM** gracefully in your app
- `preStop` hook + `terminationGracePeriodSeconds` prevents dropped connections

---

## 3. Deployments

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0       # Zero-downtime rolling update
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        version: "1.2.3"      # Useful for canary/observability
    spec:
      containers:
        - name: myapp
          image: myapp:1.2.3  # Never use :latest in prod
          imagePullPolicy: IfNotPresent
```

- **Never use `:latest` in prod** — unpredictable, breaks rollback
- Set `maxUnavailable: 0` for zero-downtime deployments
- Use `minReadySeconds` to ensure pods are actually stable before proceeding

---

## 4. Namespace Strategy

```
kube-system         # K8s internals — do not touch
monitoring          # Prometheus, Grafana, Loki
ingress-nginx       # Ingress controllers
cert-manager        # TLS automation
app-dev             # Dev workloads
app-staging         # Staging workloads
app-prod            # Prod workloads
```

- Separate **teams** and **environments** by namespace
- Apply **ResourceQuotas** and **LimitRanges** per namespace
- Apply **NetworkPolicies** to control cross-namespace traffic

### ResourceQuota Example

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: prod-quota
  namespace: app-prod
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    pods: "50"
```

---

## 5. RBAC (Role-Based Access Control)

```yaml
# Principle of least privilege
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: app-prod
  name: app-reader
rules:
  - apiGroups: [""]
    resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]   # Read-only

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-reader-binding
  namespace: app-prod
subjects:
  - kind: ServiceAccount
    name: myapp-sa
    namespace: app-prod
roleRef:
  kind: Role
  apiGroupt: rbac.authorization.k8s.io
  name: app-reader
```

- **Never use `cluster-admin`** for application workloads
- Use **ServiceAccounts** per application, not the default SA
- Use **RoleBinding** (namespace-scoped) over ClusterRoleBinding where possible
- Audit RBAC with: `kubectl auth can-i --list --as=system:serviceaccount:app-prod:myapp-sa`

---

## 6. Secret Management

- **Do not store secrets in plain YAML committed to Git**
- Options (in order of preference for production):

| Tool | Approach |
|---|---|
| External Secrets Operator | Syncs from AWS SSM/Secrets Manager, GCP Secret Manager, Vault |
| Sealed Secrets | Encrypted at rest in Git, decrypted by controller |
| HashiCorp Vault + Agent Injector | Sidecar injects secrets at runtime |
| CSI Secret Store Driver | Mounts secrets as volumes from external stores |

```yaml
# External Secrets Operator example
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: myapp-secret
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: myapp-secret
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: prod/myapp/db
        property: password
```

---

## 7. Networking & Services

### Service Types

| Type | Use Case |
|---|---|
| ClusterIP | Internal-only communication (default) |
| NodePort | Expose on node IP (avoid in prod) |
| LoadBalancer | Cloud LB per service (costly at scale) |
| ExternalName | DNS alias to external service |

### Ingress (Preferred for HTTP/S)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp
                port:
                  number: 80
```

### NetworkPolicy (Zero-Trust Between Pods)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-only-frontend
  namespace: app-prod
spec:
  podSelector:
    matchLabels:
      app: backend
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - port: 8080
  policyTypes:
    - Ingress
```

- **Default deny all**, then selectively allow — defense in depth
- CNI must support NetworkPolicy (Calico, Cilium, Weave)

---

## 8. Storage

### PersistentVolume Best Practices

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myapp-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3         # Use fast storage class
  resources:
    requests:
      storage: 20Gi
```

| Access Mode | Description |
|---|---|
| ReadWriteOnce (RWO) | Single node read-write (most common) |
| ReadOnlyMany (ROX) | Many nodes read-only |
| ReadWriteMany (RWX) | Many nodes read-write (NFS, EFS, CephFS) |

- Use **StorageClasses** — never manually provision PVs
- Enable **volumeBindingMode: WaitForFirstConsumer** to avoid zone mismatch
- Enable **reclaimPolicy: Retain** for critical data (not Delete)
- Backup PVs with **Velero**

---

## 9. Pod Scheduling & Affinity

### Node Affinity (Prefer/Require Nodes)

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: node-role
              operator: In
              values: ["compute"]
```

### Pod Anti-Affinity (Spread Replicas Across Nodes/AZs)

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: myapp
        topologyKey: kubernetes.io/hostname   # Spread across nodes
```

### Topology Spread Constraints (Modern Approach)

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: myapp
```

- **Spread replicas across AZs** to survive zone failures
- Use **taints & tolerations** to dedicate nodes for specific workloads

---

## 10. HPA & VPA (Autoscaling)

### Horizontal Pod Autoscaler (HPA)

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
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### Vertical Pod Autoscaler (VPA)

- Automatically adjusts resource requests/limits based on usage
- Use `updateMode: "Off"` first to just get recommendations
- **Don't use HPA + VPA on CPU/memory simultaneously** — conflicts

### Cluster Autoscaler / Karpenter

- **Cluster Autoscaler**: scales node groups based on pending pods
- **Karpenter** (AWS): provisions right-sized nodes in seconds, more flexible
- Always set `minReplicas >= 2` for HA workloads

---

## 11. Security Hardening

### Pod Security (Pod Security Admission / Standards)

```yaml
# Label namespace to enforce policy
apiVersion: v1
kind: Namespace
metadata:
  name: app-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted
```

| Level | Description |
|---|---|
| Privileged | No restrictions (only for system pods) |
| Baseline | Prevents known privilege escalations |
| Restricted | Hardened — run as non-root, no host access |

### Secure Container Spec

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

- **Never run containers as root**
- **Read-only root filesystem** — mount writable paths explicitly
- Drop all Linux capabilities; add only what's needed
- Scan images with **Trivy / Grype** before deployment
- Use **OPA/Gatekeeper or Kyverno** for policy enforcement (e.g., block :latest, enforce labels)

---

## 12. Observability

### Three Pillars in K8s

| Pillar | Tool Stack |
|---|---|
| Metrics | Prometheus + Grafana (kube-prometheus-stack) |
| Logs | Loki + Promtail / Fluentd + Elasticsearch |
| Traces | Jaeger / Tempo + OpenTelemetry |

### Key Metrics to Watch

```
# Node level
node_cpu_utilization
node_memory_utilization
node_disk_pressure

# Pod level
container_cpu_usage_seconds_total
container_memory_working_set_bytes
kube_pod_container_status_restarts_total   # Crashloop indicator

# Cluster level
kube_node_status_condition
kube_deployment_status_replicas_unavailable
apiserver_request_duration_seconds
```

- Emit **structured JSON logs** from applications (no raw text)
- Use **labels consistently** — environment, app, version, team
- Add **liveness/readiness probe failures** as alerting signals
- Set up alerts on: OOMKill, CrashLoopBackOff, PVC nearing full, HPA at max

---

## 13. Helm Best Practices

```
charts/
  myapp/
    Chart.yaml          # Chart metadata, version, appVersion
    values.yaml         # Default values
    values-staging.yaml # Env overrides
    values-prod.yaml
    templates/
      deployment.yaml
      service.yaml
      ingress.yaml
      _helpers.tpl      # Reusable template snippets
```

- **Pin chart versions** in CI — never use floating latest
- Use `helm diff` plugin before every upgrade (preview changes)
- Use `helm test` to run post-install smoke tests
- Store Helm releases in **remote chart museums** (ChartMuseum, OCI registry)
- Use `helm upgrade --atomic` — auto rollback on failure
- `helm rollback <release> <revision>` for quick revert

---

## 14. GitOps with ArgoCD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/k8s-manifests
    targetRevision: main
    path: apps/myapp/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: app-prod
  syncPolicy:
    automated:
      prune: true       # Remove resources deleted from Git
      selfHeal: true    # Revert manual changes in cluster
    syncOptions:
      - CreateNamespace=true
```

- Git is the **single source of truth** — no `kubectl apply` by hand in prod
- Use **App of Apps** or **ApplicationSets** for multi-cluster/multi-env
- Enable **drift detection** — alert or auto-heal on manual changes
- Separate **config repo** from **app repo** (avoid triggering CI on manifest bumps)

---

## 15. Multi-Cluster & Multi-Tenancy

- Use **separate clusters** for prod vs non-prod (blast radius isolation)
- Use **Cluster API** or managed K8s (EKS, GKE, AKS) for cluster lifecycle
- Federate observability to a central stack (Thanos, Victoria Metrics)
- **Namespace-per-team** within a cluster; cluster-per-criticality
- Consider **vCluster** for lightweight dev/test cluster isolation

---

## 16. Cluster Upgrade Strategy

1. Upgrade **control plane first**, then **node groups**
2. Use **managed node groups** (EKS/GKE) for rolling node upgrades
3. Upgrade **one minor version at a time** (1.27 → 1.28 → 1.29)
4. Check **API deprecations** before upgrade (`pluto`, `kubent`)
5. Test in **lower environments** first
6. Keep Helm charts and operators compatible with the target K8s version

---

## 17. Common Anti-Patterns to Avoid

- ❌ Using `:latest` image tag in production
- ❌ No resource requests/limits (BestEffort QoS)
- ❌ Running containers as root
- ❌ Storing secrets in ConfigMaps or plain YAML in Git
- ❌ Exposing services via NodePort in production
- ❌ Single replica for stateful or critical workloads
- ❌ No pod disruption budgets (PDB) — upgrade causes full outage
- ❌ No NetworkPolicies — flat cluster network, any pod can talk to any pod
- ❌ Manually `kubectl apply`-ing to production (no GitOps)
- ❌ Ignoring `kubectl get events` when debugging (goldmine of info)
- ❌ Using default ServiceAccount for application pods
- ❌ Skipping `terminationGracePeriodSeconds` — dropped in-flight requests

### PodDisruptionBudget (PDB) — Don't Skip This

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
spec:
  minAvailable: 2       # Or maxUnavailable: 1
  selector:
    matchLabels:
      app: myapp
```

- PDB ensures rolling upgrades / node drains don't take down all replicas simultaneously

---

## 18. Useful Debugging Commands

```bash
# Pod status & events
kubectl get pods -n app-prod -o wide
kubectl describe pod <pod> -n app-prod      # Check events section!
kubectl get events -n app-prod --sort-by=.lastTimestamp

# Logs
kubectl logs <pod> -n app-prod --previous   # Crashed container logs
kubectl logs -l app=myapp -n app-prod       # All pods with label

# Resource usage
kubectl top pods -n app-prod
kubectl top nodes

# Debug with ephemeral container
kubectl debug -it <pod> --image=busybox --target=myapp -n app-prod

# RBAC check
kubectl auth can-i get pods --as=system:serviceaccount:app-prod:myapp-sa -n app-prod

# Drain a node safely
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data

# Rollout management
kubectl rollout status deployment/myapp -n app-prod
kubectl rollout history deployment/myapp -n app-prod
kubectl rollout undo deployment/myapp -n app-prod
```

---

*Good luck with the interview!*