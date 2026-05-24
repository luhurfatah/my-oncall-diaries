# Kubernetes — Networking & Security

> **Scope:** Production-grade K8s networking and security hardening. Covers RBAC depth, secrets management, NetworkPolicy patterns, Pod Security Standards, service mesh considerations, and real-world gotchas.

---

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Kubernetes Networking Model](#1-kubernetes-networking-model) | Four networking requirements, CNI plugin selection, DNS resolution chain, and CoreDNS tuning. |
| **02** | [Services — Deep Dive](#2-services--deep-dive) | kube-proxy modes, service types, external traffic policy, session affinity, and EndpointSlices. |
| **03** | [Ingress & Gateway API](#3-ingress--gateway-api) | Ingress controller options, TLS with cert-manager, and the next-gen Gateway API model. |
| **04** | [NetworkPolicy — Zero-Trust Patterns](#4-networkpolicy--zero-trust-patterns) | Default deny setup, allow patterns, cross-namespace policy, and edge case gotchas. |
| **05** | [RBAC — Production Patterns](#5-rbac--production-patterns) | Least privilege roles, dedicated ServiceAccounts, aggregated ClusterRoles, and audit queries. |
| **06** | [Secret Management](#6-secret-management) | Envelope encryption, External Secrets Operator, CSI driver, and rotation patterns. |
| **07** | [Pod Security Standards & Admission](#7-pod-security-standards--admission) | PSA levels, namespace enforcement labels, OPA/Gatekeeper, and Kyverno policies. |
| **08** | [Container Security Hardening](#8-container-security-hardening) | Full secure container spec, seccomp profiles, and read-only filesystem patterns. |
| **09** | [Service Mesh Considerations](#9-service-mesh-considerations) | Istio vs Linkerd tradeoffs, mTLS, and when to use a service mesh. |

---

## 1. Kubernetes Networking Model

### The Four Requirements

K8s networking is built on four rules:
1. Every pod gets a unique cluster-wide IP
2. Pods on the same node communicate without NAT
3. Pods on different nodes communicate without NAT
4. The IP a pod sees itself as = the IP others see it as (no masquerading)

This is implemented by a **CNI plugin** (Calico, Cilium, AWS VPC CNI, Flannel, etc.).

### CNI Plugin Selection — Matters More Than You Think

| CNI | NetworkPolicy | eBPF dataplane | AWS VPC native IPs | Encryption |
|---|---|---|---|---|
| **AWS VPC CNI** | Partial (needs Calico for policy) | No | ✅ Yes | No (use Nitro) |
| **Calico** | ✅ Full | Optional | No | WireGuard |
| **Cilium** | ✅ Full + L7 | ✅ Yes | Optional | WireGuard |
| **Flannel** | ❌ No | No | No | No |

For EKS production workloads: **AWS VPC CNI + Calico for NetworkPolicy** or **Cilium** (more powerful, steeper ops curve).

### DNS Resolution Chain

```
Pod query: "postgres.app-prod.svc.cluster.local"
  → /etc/resolv.conf: nameserver 172.20.0.10 (CoreDNS ClusterIP)
  → CoreDNS
  → Returns ClusterIP of the "postgres" Service in "app-prod" namespace
```

Short name resolution search order (from `/etc/resolv.conf`):
```
search app-prod.svc.cluster.local svc.cluster.local cluster.local
```

A pod in `app-prod` can reach another service in `app-prod` via:
- `postgres` (short name, resolves via search path)
- `postgres.app-prod` 
- `postgres.app-prod.svc.cluster.local` (FQDN)

Cross-namespace requires at minimum: `postgres.other-namespace`

### CoreDNS Tuning

Default CoreDNS can become a bottleneck at scale. Signs: increased DNS lookup latency, `SERVFAIL` under load.

```yaml
# CoreDNS ConfigMap tuning
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
          pods insecure
          fallthrough in-addr.arpa ip6.arpa
        }
        cache 30           # DNS cache TTL — reduce upstream queries
        loop
        reload
        loadbalance
        forward . /etc/resolv.conf {
          max_concurrent 1000
        }
    }
```

Also consider `ndots:5` → `ndots:2` in pod DNS config to reduce search path traversal:
```yaml
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"
```

`ndots:5` (default) means a query like `postgres` tries 5 suffixes before going to the root — 5 DNS queries instead of 1. Use FQDNs or reduce ndots for high-volume services.

---

## 2. Services — Deep Dive

### kube-proxy Modes

| Mode | Mechanism | Performance | Notes |
|---|---|---|---|
| `iptables` | iptables rules per endpoint | O(n) rule traversal | Default on most clusters |
| `ipvs` | IPVS kernel module | O(1) lookup | Better at 1000+ endpoints |
| `eBPF` (Cilium) | eBPF programs | Fastest | Requires Cilium CNI |

For clusters with >500 services or >5000 pods, switch to IPVS or Cilium eBPF.

### Service Types and When to Use Each

```yaml
# ClusterIP — internal only (default, prefer this)
spec:
  type: ClusterIP
  clusterIP: None    # Headless — for StatefulSets, direct pod DNS

# NodePort — dev/testing only (security risk in prod)
spec:
  type: NodePort
  ports:
    - port: 80
      nodePort: 30080    # Exposed on ALL nodes, 30000-32767 range

# LoadBalancer — use Ingress instead at scale (1 LB per service = expensive)
spec:
  type: LoadBalancer
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-internal: "true"
```

### External Traffic Policy

```yaml
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local    # vs Cluster (default)
```

| Policy | Behavior | Tradeoff |
|---|---|---|
| `Cluster` | Routes to any pod, double-hops possible | Load balanced evenly, source IP lost |
| `Local` | Only routes to pods on the receiving node | Preserves source IP, uneven load if pods are skewed |

Use `Local` when you need client source IP (WAF rules, audit logs, rate limiting by IP).

### Session Affinity

```yaml
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800    # 3 hours
```

Sessions stick to the same pod by client IP. Useful for stateful apps that can't share session state. Not a substitute for proper stateless design.

### EndpointSlices

K8s 1.21+ uses EndpointSlices instead of Endpoints. Each slice holds up to 100 endpoints. For large services (100+ pods), EndpointSlices dramatically reduce etcd and kube-proxy load compared to the old single Endpoints object.

Don't manually interact with EndpointSlices — they're managed automatically. But if you're debugging why a Service isn't routing traffic, check them:

```bash
kubectl get endpointslices -n app-prod -l kubernetes.io/service-name=myapp
```

---

## 3. Ingress & Gateway API

### Ingress Controller Options

| Controller | Best For | Notable Features |
|---|---|---|
| **ingress-nginx** | General purpose | Most widely used, rich annotations |
| **AWS Load Balancer Controller** | EKS-native | ALB/NLB integration, WAF, target group binding |
| **Traefik** | Dynamic routing | CRD-first, auto TLS, middleware |
| **Kong** | API Gateway use case | Rate limiting, auth plugins |
| **Istio Gateway** | Service mesh | mTLS, traffic splitting |

### Ingress with TLS (cert-manager)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [myapp.example.com]
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

### Gateway API (Next-Gen Ingress)

Gateway API replaces Ingress with a more expressive, role-separated model:

```yaml
# GatewayClass — cluster admin defines the controller
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: nginx
spec:
  controllerName: k8s.nginx.org/nginx-gateway-controller

# Gateway — infra team defines the listener
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: prod-gateway
  namespace: infra
spec:
  gatewayClassName: nginx
  listeners:
    - name: https
      port: 443
      protocol: HTTPS
      tls:
        certificateRefs:
          - name: prod-tls

# HTTPRoute — app team routes their own traffic
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: myapp
  namespace: app-prod
spec:
  parentRefs:
    - name: prod-gateway
      namespace: infra
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: myapp
          port: 80
          weight: 90
        - name: myapp-canary
          port: 80
          weight: 10          # Canary split at the routing layer
```

Gateway API advantages over Ingress:
- **Role separation**: GatewayClass (infra admin) → Gateway (platform team) → HTTPRoute (app team)
- **Native traffic splitting** (weights in backendRefs)
- **Cross-namespace routing** with explicit allow policies
- **Richer matching** (headers, query params, methods)

---

## 4. NetworkPolicy — Zero-Trust Patterns

### Default Deny — The Foundation

Always start with default deny, then open what's needed:

```yaml
# Deny all ingress in namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: app-prod
spec:
  podSelector: {}        # Applies to ALL pods in namespace
  policyTypes:
    - Ingress

---
# Deny all egress in namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: app-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

After applying these, **no pod in the namespace can send or receive any traffic** until you explicitly allow it.

### Allow Patterns

```yaml
# Allow frontend → backend on port 8080
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: app-prod
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - port: 8080
          protocol: TCP

---
# Allow all pods to reach CoreDNS (required after egress deny-all)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: app-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
```

### Cross-Namespace Policy

```yaml
# Allow monitoring namespace to scrape metrics from app-prod
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: app-prod
spec:
  podSelector:
    matchLabels:
      app: myapp
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
          podSelector:
            matchLabels:
              app: prometheus
      ports:
        - port: 9090
```

### Edge Cases & Gotchas

- **NetworkPolicy requires a supporting CNI.** Flannel does not enforce NetworkPolicy — pods with policies will still communicate freely. Use Calico, Cilium, or AWS VPC CNI with Calico for enforcement.
- **DNS egress is always required.** After applying default-deny egress, apps lose DNS resolution. You must explicitly allow UDP/TCP 53 to CoreDNS — this is the most commonly forgotten rule.
- **Policies are additive.** Multiple NetworkPolicies applying to the same pod are OR'd together — any policy that allows traffic allows it. There's no way to write a "deny" in a NetworkPolicy (only block by absence of allow).
- **ICMP is blocked by default** after deny-all egress — affects health checks from external systems. Allow explicitly if needed.
- **ipBlock for external traffic:**

```yaml
egress:
  - to:
      - ipBlock:
          cidr: 0.0.0.0/0
          except:
            - 10.0.0.0/8
            - 172.16.0.0/12
            - 192.168.0.0/16
    ports:
      - port: 443    # Allow HTTPS to internet, block RFC1918
```

---

## 5. RBAC — Production Patterns

### Principle of Least Privilege — Enforcing It

```yaml
# Bad: ClusterAdmin for an app serviceaccount
# Good: namespace-scoped minimal role
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: app-prod
  name: myapp-role
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["myapp-config"]    # Specific resource name, not wildcard
    verbs: ["get", "watch"]
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["myapp-db-secret"]
    verbs: ["get"]
```

`resourceNames` restricts access to specific named resources — a pod that only needs `myapp-config` cannot read other ConfigMaps in the namespace.

### Dedicated ServiceAccount Per Application

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: app-prod
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/myapp-irsa-role  # For IRSA

---
# Disable automounted token if not needed
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
automountServiceAccountToken: false   # Default SA token is mounted automatically — disable it

---
# Or disable per-pod
spec:
  automountServiceAccountToken: false
```

### Aggregated ClusterRoles

Define reusable role fragments that combine automatically:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: custom-metrics-reader
  labels:
    rbac.example.com/aggregate-to-monitoring: "true"   # Aggregation label
rules:
  - apiGroups: ["custom.metrics.k8s.io"]
    resources: ["*"]
    verbs: ["get", "list"]
```

Any ClusterRole with `aggregationRule` matching that label automatically inherits these rules — useful for Prometheus, operators, and platform tooling.

### Impersonation for Auditing

```bash
# Test what a serviceaccount can do
kubectl auth can-i --list \
  --as=system:serviceaccount:app-prod:myapp-sa \
  -n app-prod

# Test specific action
kubectl auth can-i delete pods \
  --as=system:serviceaccount:app-prod:myapp-sa \
  -n app-prod
```

### Dangerous Permissions to Audit Regularly

```bash
# Find all subjects with cluster-admin
kubectl get clusterrolebindings -o json | \
  jq '.items[] | select(.roleRef.name=="cluster-admin") | .subjects'

# Find roles with wildcard verbs or resources
kubectl get clusterroles -o json | \
  jq '.items[].rules[] | select(.verbs[] == "*" or .resources[] == "*")'
```

Dangerous permission combinations to flag:
- `secrets: get/list/watch` at cluster scope — can read all secrets
- `pods/exec: create` — can exec into any pod = arbitrary code execution
- `nodes: proxy` — can access any node endpoint
- `*: *` — effectively cluster-admin
- `rolebindings/clusterrolebindings: create` — can grant any permission to anyone

---

## 6. Secret Management

### Never Do This

```yaml
# NEVER — plaintext in ConfigMap
apiVersion: v1
kind: ConfigMap
data:
  DB_PASSWORD: "supersecret"     # Visible to anyone with ConfigMap read access

# NEVER — base64 is not encryption
apiVersion: v1
kind: Secret
data:
  DB_PASSWORD: "c3VwZXJzZWNyZXQ="  # Just base64, trivially decoded
```

Kubernetes Secrets are base64-encoded, not encrypted by default. Anyone with `secrets:get` access can decode them instantly. Enable **envelope encryption** with KMS and use external secret management.

### Envelope Encryption (EKS)

Configure etcd encryption at rest using AWS KMS:

```yaml
# encryption-config.yaml (passed to API server)
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - kms:
          name: aws-kms
          endpoint: unix:///var/run/kmsplugin/socket.sock
          cachesize: 1000
      - identity: {}    # Fallback for unencrypted secrets
```

EKS manages this via cluster configuration — enable via `--encryption-config` at cluster creation or update. Secrets at rest in etcd are encrypted with a KMS DEK.

### External Secrets Operator (ESO)

ESO syncs secrets from external stores into K8s Secrets, with automatic rotation:

```yaml
# ClusterSecretStore — cluster-wide, references AWS Secrets Manager
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
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets

---
# ExternalSecret — per-app secret sync
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: myapp-db-secret
  namespace: app-prod
spec:
  refreshInterval: 1h               # Re-sync from source every hour
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: myapp-db-secret           # K8s Secret name to create
    creationPolicy: Owner           # ESO owns and manages this Secret
    deletionPolicy: Delete          # Delete K8s Secret if ExternalSecret is deleted
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: prod/myapp/database
        property: password
    - secretKey: DB_USERNAME
      remoteRef:
        key: prod/myapp/database
        property: username
```

**ESO rotation flow:**
1. Secret rotated in AWS Secrets Manager
2. ESO polls every `refreshInterval` (or use Push-based with EventBridge)
3. K8s Secret updated
4. Application reads new secret (requires app restart or dynamic secret reading)

**Gotcha:** Updating the K8s Secret does NOT automatically restart pods. If your app reads secrets at startup only, you need a restart mechanism (use Reloader operator or `sha256sum` annotation trick):

```yaml
# Deployment annotation — restart on secret change
annotations:
  secret-checksum: "{{ sha256sum (lookup 'v1' 'Secret' .Release.Namespace 'myapp-db-secret').data }}"
```

### CSI Secret Store Driver

Mounts secrets as files (not env vars) directly from external stores:

```yaml
volumes:
  - name: secrets
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: myapp-aws-secrets
```

Advantages over ESO:
- Secrets never stored in etcd (mounted directly from provider)
- Fine-grained per-file access control
- Automatic rotation with `rotationPollInterval`

Disadvantages:
- Secrets not available as env vars (must parse files)
- Slightly higher latency on pod startup (must fetch secret before container starts)

---

## 7. Pod Security Standards & Admission

### Pod Security Standards (PSS) — Replacing PSP

PSP (PodSecurityPolicy) was removed in K8s 1.25. The replacement is **Pod Security Admission (PSA)** with three built-in levels:

| Level | What It Blocks |
|---|---|
| `privileged` | Nothing — only for system/infra pods |
| `baseline` | Privilege escalation, host namespaces, dangerous capabilities |
| `restricted` | All of baseline + must run as non-root, drop ALL caps, no seccomp bypass |

```yaml
# Label namespace to enforce policy
apiVersion: v1
kind: Namespace
metadata:
  name: app-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
```

Use `warn` and `audit` before `enforce` — `warn` shows warnings, `audit` logs violations, `enforce` blocks the pod. Roll out in warn → audit → enforce order.

### OPA/Gatekeeper — Policy as Code

For policies beyond what PSA covers (e.g., "all pods must have labels", "no :latest images"):

```yaml
# ConstraintTemplate — defines the policy logic
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels
        violation[{"msg": msg}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing := required - provided
          count(missing) > 0
          msg := sprintf("Missing required labels: %v", [missing])
        }

---
# Constraint — applies the policy
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-app-labels
spec:
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: ["Deployment"]
  parameters:
    labels: ["app", "version", "team"]
```

### Kyverno — Simpler Alternative to Gatekeeper

Kyverno uses YAML-native policies (no Rego):

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-image-tag
      match:
        any:
          - resources:
              kinds: ["Pod"]
      validate:
        message: "Image tag ':latest' is not allowed."
        pattern:
          spec:
            containers:
              - image: "!*:latest"
```

Kyverno can also **mutate** resources (add labels, inject sidecars) and **generate** resources (create NetworkPolicy when Namespace is created).

---

## 8. Container Security Hardening

### Full Secure Container Spec

```yaml
securityContext:
  # Pod-level
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  seccompProfile:
    type: RuntimeDefault         # Use container runtime's default seccomp profile

containers:
  - name: myapp
    securityContext:
      # Container-level
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop:
          - ALL
        add:
          - NET_BIND_SERVICE      # Only if binding to port < 1024
    volumeMounts:
      - name: tmp
        mountPath: /tmp            # Writable temp dir
      - name: cache
        mountPath: /app/cache      # App-specific writable dir

volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
```

### Seccomp Profiles

`RuntimeDefault` syscall filter blocks ~40% of syscalls that containers rarely need. For highest security, use a custom profile:

```yaml
seccompProfile:
  type: Localhost
  localhostProfile: profiles/myapp-seccomp.json
```

Custom profiles allow only the exact syscalls your app makes — anything else → EPERM. Build with `strace` or Inspektor Gadget.

### Image Security

```bash
# Scan with Trivy (CI gate)
trivy image --exit-code 1 --severity CRITICAL myapp:1.2.3

# Sign with cosign (supply chain security)
cosign sign --key cosign.key myapp:1.2.3

# Verify signature before deployment (Kyverno policy)
```

```yaml
# Kyverno — verify image signature before allowing in cluster
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-signature
      match:
        any:
          - resources:
              kinds: ["Pod"]
      verifyImages:
        - imageReferences: ["myregistry.io/myapp*"]
          attestors:
            - entries:
                - keyless:
                    subject: "https://github.com/org/repo/.github/workflows/build.yml@refs/heads/main"
                    issuer: "https://token.actions.githubusercontent.com"
```

---

## 9. Service Mesh Considerations

### When You Actually Need a Service Mesh

| Need | Without Mesh | With Mesh |
|---|---|---|
| mTLS between pods | Manual cert management | Automatic |
| Traffic splitting (canary) | Ingress annotations or dual-Deployment | HTTPRoute weights |
| Retries & circuit breaking | App-level code | Mesh policy |
| Observability (L7 metrics) | App instrumentation required | Automatic |
| Service-to-service auth | NetworkPolicy (L3/L4 only) | JWT/SPIFFE identity |

**Don't add a service mesh prematurely.** The operational overhead (Envoy sidecar memory, debugging complexity, control plane management) is significant. Adopt when you have concrete requirements for mTLS or L7 traffic management at scale.

### Istio vs Linkerd vs Cilium Service Mesh

| | Istio | Linkerd | Cilium (Mesh) |
|---|---|---|---|
| Sidecar model | Envoy per pod | micro-proxy per pod | No sidecar (eBPF) |
| Memory overhead | ~100MB per pod | ~10MB per pod | Near-zero |
| mTLS | ✅ | ✅ | ✅ |
| L7 traffic control | ✅ Rich | ✅ Moderate | Limited |
| Complexity | High | Low-Medium | Medium |
| EKS support | Good | Good | Good (EKS add-on) |

For EKS, **Cilium** is increasingly popular for its eBPF-native approach — no sidecar overhead, NetworkPolicy + service mesh in one CNI.

### Ambient Mesh (Istio Sidecarless)

Istio's ambient mode (stable in Istio 1.22+) removes per-pod sidecars and uses:
- **ztunnel** (per-node): L4 mTLS + auth
- **waypoint proxy** (per-namespace/service): L7 policies (optional)

Dramatically reduces memory overhead — worth evaluating for large clusters where Envoy sidecar cost is significant.

---

*Last updated: 2026-05 | Author: Personal KB | K8s version context: 1.29+*