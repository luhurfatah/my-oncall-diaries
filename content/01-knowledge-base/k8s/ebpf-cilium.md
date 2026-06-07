# Cilium — eBPF-Native Networking, Security, and Observability for Kubernetes

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [What Cilium Is and Why It Exists](#1-what-cilium-is-and-why-it-exists) | The problem with kube-proxy, iptables at scale, and the eBPF argument. |
| **02** | [Architecture Internals](#2-architecture-internals) | The Cilium Agent, Operator, CNI plugin, Hubble, and how they compose. |
| **03** | [eBPF — The Foundation](#3-ebpf-the-foundation) | What eBPF programs do in the kernel, BPF maps, and why this matters for networking. |
| **04** | [Installation & Bootstrap](#4-installation--bootstrap) | Helm-based installation, key config flags, and kube-proxy replacement modes. |
| **05** | [Network Policy — Beyond NetworkPolicy](#5-network-policy--beyond-networkpolicy) | CiliumNetworkPolicy, identity-based enforcement, FQDN egress, and policy audit mode. |
| **06** | [Hubble — Observability Layer](#6-hubble--observability-layer) | Flow visibility, the Hubble CLI, Relay, and integration with Prometheus and Grafana. |
| **07** | [Service Mesh Mode (Sidecarless)](#7-service-mesh-mode-sidecarless) | Mutual TLS, L7 traffic management, and how Cilium replaces Istio without sidecars. |
| **08** | [Cluster Mesh — Multi-Cluster Networking](#8-cluster-mesh--multi-cluster-networking) | Cross-cluster service discovery, global services, and shared policy. |
| **09** | [BGP Control Plane](#9-bgp-control-plane) | Advertising pod CIDRs and LoadBalancer IPs directly via BGP without a cloud LB. |
| **10** | [Performance Characteristics & Benchmarks](#10-performance-characteristics--benchmarks) | Latency, throughput, CPU overhead vs kube-proxy, and where eBPF wins. |
| **11** | [Failure Modes & Troubleshooting](#11-failure-modes--troubleshooting) | Common failure patterns, the cilium CLI, and a connectivity troubleshooting playbook. |
| **12** | [Day-2 Operations](#12-day-2-operations) | Upgrades, policy auditing, identity expiry, and quarterly review drills. |

---

## 1. What Cilium Is and Why It Exists

### The Problem with Traditional Kubernetes Networking

Standard Kubernetes networking is built on `kube-proxy` and `iptables`. For small clusters this works fine. For clusters above a few hundred services, it becomes a liability.

`iptables` is evaluated as a linear chain of rules. Every new Service adds `O(n)` rules to every node. At 1,000 services with a handful of endpoints each, you are evaluating tens of thousands of iptables rules per packet. The kernel locks the entire ruleset during updates. A single `kubectl apply` during a high-traffic window introduces rule-rewrite latency across all nodes simultaneously.

The other structural problem is visibility. `iptables` does not give you flow-level telemetry. You can inspect `conntrack` tables, you can read VPC Flow Logs if you are on a cloud provider, but within a node — between two pods on the same host — you are largely blind. Security engineers asking "which pod called which external API at 14:32 UTC" have historically gotten a shrug.

Cilium was built to replace both problems with a single runtime: eBPF programs running directly in the Linux kernel, attached to network events, with no userspace copying, no iptables chain traversal, and native per-flow observability baked in.

### The eBPF Argument in One Paragraph

eBPF (extended Berkeley Packet Filter) lets you load verified, sandboxed programs into the kernel at runtime and attach them to defined hook points — network packet receive, send, socket operations, system calls, and others. The kernel JIT-compiles them on load. They execute at kernel speed with zero context switching to userspace. For networking, this means Cilium can make forwarding decisions — including load balancing, NAT, policy enforcement, and encryption — in kernel space, in the fast path, without sending packets to iptables or through userspace proxies.

### What Cilium Is Not

Cilium is a CNI plugin. It handles Layer 3/4 networking (pod-to-pod routing, service load balancing, policy) and optionally Layer 7 (HTTP, gRPC, Kafka-aware policy). It is not a service mesh in the traditional sense — though its sidecarless service mesh mode (Cilium Service Mesh) overlaps significantly with what Istio and Linkerd do. It is also not a replacement for your cloud provider's load balancer in all cases, though its BGP control plane can get close.

> [!NOTE]
> **Adoption Signal:** As of 2024, Cilium is the default CNI on AWS EKS (via the VPC CNI eBPF mode), Google GKE (Dataplane V2), and Azure AKS (Cilium-based). If you are running a managed Kubernetes cluster and you have not checked your CNI lately, there is a reasonable chance Cilium is already under the hood.

---

## 2. Architecture Internals

Cilium is composed of several distinct components. Understanding the boundaries between them is important when things go wrong — and things will go wrong.

### Cilium Agent (`cilium-agent`)

The agent runs as a DaemonSet on every node. It is the core of Cilium's operation. On each node it:

- Monitors the Kubernetes API for Pod, Service, Endpoint, and NetworkPolicy changes.
- Generates and loads eBPF programs into the kernel for every network interface on the node.
- Manages BPF maps (kernel data structures) that store endpoint identity, service backends, and policy rules.
- Operates the node's local IPAM (IP Address Management) — allocating IPs from the node's pod CIDR.
- Handles identity assignment for every pod endpoint (using labels, not IPs — more on this in Section 5).

The agent exposes a local API at `/var/run/cilium/cilium.sock`. The `cilium` CLI talks to this socket. When you run `cilium status` on a node, you are calling this API.

### Cilium Operator

The Operator runs as a Deployment (typically 1–2 replicas) and handles cluster-wide state that does not need to run per-node:

- Syncing Kubernetes CRDs (CiliumIdentity, CiliumEndpoint, CiliumNode objects).
- Managing IP pools for cluster-wide IPAM modes.
- Garbage-collecting stale CiliumIdentity and CiliumEndpoint objects.
- Syncing Cilium's own node CIDR allocations.

If the Operator is down for an extended period, new node bootstrapping will stall because CIDR allocation cannot proceed. Pods on existing nodes continue to run — eBPF programs are already loaded — but new pods on new nodes will fail to get IPs.

### CNI Plugin Binary

The CNI binary (`/opt/cni/bin/cilium-cni`) is invoked by the kubelet container runtime for every pod add/delete. It calls into the Cilium Agent API to allocate an IP and configure the pod's `veth` pair. The CNI binary itself is stateless — all state is in the agent.

### Hubble

Hubble is Cilium's observability layer. It runs as two components:

- **Hubble embedded in the agent:** Every node's Cilium Agent captures flow events from its eBPF programs and exposes them on a local gRPC socket.
- **Hubble Relay:** A cluster-wide aggregation service that connects to every agent's Hubble socket and serves a single unified flow query API. The `hubble` CLI and Hubble UI connect to the Relay.

Hubble is opt-in. You enable it at install time or via a Helm upgrade. Without Hubble, you still get all the networking and policy features — just no flow visibility.

```
┌─────────────────────────────────────────────────────┐
│                   Kubernetes API                     │
└──────────────────┬──────────────────────────────────┘
                   │ watches: Pod, Svc, Endpoint, NP
          ┌────────▼────────┐          ┌──────────────┐
          │  Cilium Operator │          │  Hubble UI   │
          │  (Deployment)    │          │  (optional)  │
          └────────┬────────┘          └──────┬───────┘
                   │ CRD mgmt                 │
          ┌────────▼──────────────────────────▼───────┐
          │            Hubble Relay (Deployment)        │
          └───────┬───────────────────┬────────────────┘
                  │ gRPC              │ gRPC
       ┌──────────▼──────┐  ┌────────▼──────────┐
       │  Cilium Agent   │  │  Cilium Agent      │
       │  Node A         │  │  Node B            │
       │  ┌───────────┐  │  │  ┌───────────┐    │
       │  │ eBPF progs│  │  │  │ eBPF progs│    │
       │  │ BPF maps  │  │  │  │ BPF maps  │    │
       │  └───────────┘  │  │  └───────────┘    │
       └─────────────────┘  └───────────────────┘
```

---

## 3. eBPF — The Foundation

### What the eBPF Programs Actually Do

Cilium attaches eBPF programs to three primary hook points:

- **`tc` (Traffic Control) ingress/egress:** Attached to network interfaces (the pod's `veth` and the node's physical interface). Handles policy enforcement, NAT, and load balancing on inbound/outbound packets.
- **`XDP` (eXpress Data Path):** Attached at the NIC driver level before the kernel's network stack processes the packet. Used for ultra-fast load balancing on the ingress path when the driver supports it.
- **Socket-level hooks (`BPF_PROG_TYPE_SOCK_OPS`, `sk_msg`):** For socket-aware load balancing (bypassing the network stack entirely for same-node pod-to-pod traffic via the loopback socket) and for mutual TLS in service mesh mode.

### BPF Maps — The Shared State

eBPF programs are stateless by themselves. State is stored in BPF maps — kernel data structures that both eBPF programs and userspace (the Cilium Agent) can read and write. Cilium's most important maps include:

| Map | Purpose |
|---|---|
| `cilium_lxc` | Maps network interface indices to endpoint identities |
| `cilium_ct4_*` (connection tracking) | Per-node conntrack tables for policy enforcement |
| `cilium_lb4_services_v2` | Service → backend mapping (replaces kube-proxy) |
| `cilium_lb4_backends_v2` | Backend pod IPs for load balancing |
| `cilium_ipcache` | Maps pod IP → security identity |
| `cilium_policy_*` | Per-endpoint policy allow/deny rules |

When the Cilium Agent updates policy, it writes new entries into the BPF maps. The running eBPF programs immediately see the updated state on the next packet evaluation. No restart required. No iptables ruleset reload.

### Why This Matters for Networking Operations

The practical implication is operational consistency. At 5,000 pods, updating a NetworkPolicy that affects 200 endpoints in a kube-proxy cluster means rewriting iptables on every node, serially, with a global lock. In Cilium, it means writing new entries into BPF maps on the affected nodes — an atomic, lock-free operation that takes microseconds. The policy is enforced on the next packet, not after a multi-second iptables reload window.

---

## 4. Installation & Bootstrap

### Helm Installation

Cilium is distributed as a Helm chart. The recommended installation path is via the `cilium` Helm chart in the `cilium` repo.

```bash
helm repo add cilium https://helm.cilium.io/
helm repo update

helm install cilium cilium/cilium \
  --version 1.15.5 \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=<API_SERVER_IP> \
  --set k8sServicePort=6443 \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true \
  --set prometheus.enabled=true \
  --set operator.prometheus.enabled=true
```

> [!IMPORTANT]
> **`k8sServiceHost` and `k8sServicePort` are mandatory when using `kubeProxyReplacement=true`.** With kube-proxy replacement enabled, Cilium handles Kubernetes Service traffic itself. It needs the API server address to bootstrap before the in-cluster `kubernetes` Service FQDN is resolvable — which is the circular dependency that these flags break.

### kube-proxy Replacement Modes

| Mode | Behavior |
|---|---|
| `kubeProxyReplacement=false` | Cilium coexists with kube-proxy. iptables rules are managed by kube-proxy as normal. Cilium only handles CNI (pod networking and policy). |
| `kubeProxyReplacement=true` | Cilium replaces kube-proxy entirely. All Service load balancing, NodePort, and ExternalIPs are handled by eBPF programs. kube-proxy DaemonSet should be removed or never deployed. |

For new clusters, `kubeProxyReplacement=true` is the recommended path. For existing clusters migrating from kube-proxy, the migration path is: deploy Cilium in coexistence mode → verify → drain kube-proxy → switch to full replacement mode. Do not attempt to flip directly in production.

### Key Helm Values Reference

```yaml
# kube-proxy replacement (set to true for full eBPF dataplane)
kubeProxyReplacement: true

# IPAM mode — determines how pod IPs are allocated
ipam:
  mode: cluster-pool     # Cilium-managed CIDR pools
  # alternatives: kubernetes (delegated to k8s), eni (AWS ENI-native), azure

# Enable Hubble observability
hubble:
  enabled: true
  relay:
    enabled: true
  ui:
    enabled: true
  metrics:
    enabled:
      - dns
      - drop
      - tcp
      - flow
      - port-distribution
      - httpV2:exemplars=true;labelsContext=source_ip,source_namespace,destination_ip,destination_namespace,traffic_direction

# Encryption (WireGuard-based, node-to-node)
encryption:
  enabled: true
  type: wireguard

# BGP control plane (enable if you want to advertise pod CIDRs/LB IPs via BGP)
bgpControlPlane:
  enabled: true

# Enable Cilium to load balance Kubernetes services via DSR (Direct Server Return)
# Requires kube-proxy replacement enabled
loadBalancer:
  mode: dsr           # alternatives: snat (default), hybrid

# Bitmask for features — nodeinit initializes iptables compat rules on new nodes
nodeinit:
  enabled: true
```

### Verifying the Installation

```bash
# Install the Cilium CLI
CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)
curl -LO "https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-amd64.tar.gz"
tar -xzf cilium-linux-amd64.tar.gz && mv cilium /usr/local/bin/

# Run the connectivity test (creates a test namespace, deploys pods, tests L3/L4/L7)
cilium connectivity test

# Check overall Cilium status
cilium status --wait

# Check kube-proxy replacement status
cilium status | grep KubeProxyReplacement
```

---

## 5. Network Policy — Beyond NetworkPolicy

### The Identity Model

Standard Kubernetes NetworkPolicy operates on IP addresses. When a pod is rescheduled to a new IP, policies based on the old IP break until they are reconciled. Cilium does not work this way.

Cilium assigns every endpoint (pod) a **security identity** — a numeric label derived from the pod's labels. Two pods with identical labels share the same identity. Policy rules reference identities, not IPs. When a pod is rescheduled to a new node and new IP, it retains the same identity, and policy enforcement is uninterrupted.

The identity is propagated cluster-wide via the `cilium_ipcache` BPF map. Every node knows the identity of every pod IP in the cluster without querying the API server on the data path.

### CiliumNetworkPolicy (CNP)

Cilium extends standard `NetworkPolicy` with its own CRD — `CiliumNetworkPolicy`. It adds:

- **L7 policy:** HTTP path/method/header matching, gRPC method matching, Kafka topic matching.
- **FQDN-based egress:** Allow outbound only to specific domain names (e.g., `api.github.com`), resolved via Cilium's DNS proxy.
- **Entity-based policy:** Reference named entities like `world` (all external traffic), `kube-apiserver`, `host`, or `cluster` without specifying CIDRs.
- **Cluster-scope CNP (`CiliumClusterwideNetworkPolicy`):** Enforced across all namespaces, useful for baseline egress deny policies and platform-level controls.

```yaml
# L7 HTTP policy — only allow GET /api/v1/* to the backend service
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: frontend-to-backend
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: /api/v1/.*
```

```yaml
# FQDN egress — allow only specific external domains
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-external-apis
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: data-pipeline
  egress:
    - toFQDNs:
        - matchName: api.stripe.com
        - matchName: api.github.com
    - toEntities:
        - kube-apiserver
```

### Policy Audit Mode

Before enforcing a new policy, enable audit mode to observe what traffic would be denied without actually dropping it. Hubble will report flows as "policy-denied (audit)" in the flow log.

```bash
# Enable audit mode on the agent (Helm value)
# policyAuditMode: true

# Or annotate a specific namespace
kubectl annotate namespace production \
  policy.cilium.io/audit-mode=enabled
```

> [!TIP]
> **Run every new policy in audit mode for at least 24 hours in staging.** FQDN policies in particular can have surprising gaps — applications make DNS lookups you did not know about, and Cilium's DNS proxy needs to have seen the resolution before it can enforce allow-by-FQDN. Audit mode surfaces these gaps before they become 3am incidents.

### Deny Policies

By default, Cilium (like standard NetworkPolicy) operates on an allowlist model: if no policy selects an endpoint, all traffic is permitted. Once any policy selects an endpoint, only explicitly allowed traffic passes.

For defense in depth, deploy a clusterwide default-deny baseline and then add allowlist policies per workload:

```yaml
# Clusterwide default deny for all non-system namespaces
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: default-deny-all
spec:
  endpointSelector:
    matchExpressions:
      - key: io.kubernetes.pod.namespace
        operator: NotIn
        values:
          - kube-system
          - kube-public
          - cilium-test
  ingress:
    - {}   # empty ingress = deny all ingress
  egress:
    - toEntities:
        - kube-apiserver   # allow all pods to reach API server
    - toEntities:
        - cluster          # allow intra-cluster (override per workload)
```

---

## 6. Hubble — Observability Layer

### What Hubble Captures

Hubble captures flow events at the eBPF level from every Cilium Agent. Each flow record includes:

- Source and destination pod identity (labels, namespace, node).
- Source and destination IP and port.
- Protocol (TCP/UDP/ICMP) and L7 protocol if applicable (HTTP, DNS, gRPC).
- For HTTP: method, URL, status code, latency.
- For DNS: query name, response IPs, response code.
- Verdict: forwarded, dropped, redirected, audit.
- Drop reason if dropped: policy denied, CT map full, interface error, etc.

This answers questions that iptables and even VPC Flow Logs cannot: "Why is this pod's HTTP call failing?" "Which pods are querying `api.external-service.com`?" "What is the p99 HTTP latency between the checkout and inventory services?"

### Hubble CLI

```bash
# Install Hubble CLI
export HUBBLE_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/hubble/master/stable.txt)
curl -LO "https://github.com/cilium/hubble/releases/download/${HUBBLE_VERSION}/hubble-linux-amd64.tar.gz"
tar -xzf hubble-linux-amd64.tar.gz && mv hubble /usr/local/bin/

# Port-forward to the Hubble Relay (or use in-cluster DNS if on the cluster)
kubectl port-forward -n kube-system svc/hubble-relay 4245:80 &

# Observe all flows cluster-wide
hubble observe

# Observe dropped flows only
hubble observe --verdict DROPPED

# Observe flows for a specific pod
hubble observe --from-pod production/checkout-7d4f8b9 --follow

# Observe HTTP flows with response codes
hubble observe --protocol http --follow

# Observe DNS flows
hubble observe --protocol dns

# Observe flows between two namespaces
hubble observe \
  --from-namespace production \
  --to-namespace data-platform \
  --follow
```

### Hubble Metrics — Prometheus Integration

When Hubble metrics are enabled, the Cilium Agent exposes a `/metrics` endpoint scraped by Prometheus. Key metrics to dashboard:

| Metric | Alert Condition | Meaning |
|---|---|---|
| `hubble_drop_total` | Rate increase >10/min | Policy drops or connectivity failures |
| `hubble_flows_processed_total` | Baseline deviation | Unusual traffic volume |
| `hubble_http_requests_total` | 5xx rate increase | Application errors in the flow path |
| `hubble_http_request_duration_seconds` | p99 > SLO | HTTP latency regression |
| `hubble_dns_response_total` (NXDOMAIN) | Count spike | DNS resolution failures |
| `cilium_endpoint_regenerations_total` | Spike | Frequent policy updates or pod churn |

---

## 7. Service Mesh Mode (Sidecarless)

### The Sidecar Problem

Traditional service meshes (Istio, Linkerd) inject a sidecar proxy (Envoy, in Istio's case) into every pod. The sidecar intercepts all traffic to and from the application container. This works, but the costs are real: two extra containers per pod (pilot-agent + proxy), ~100ms added to pod startup, memory overhead per pod, and a complete parallel control plane to operate.

Cilium's service mesh mode eliminates the sidecar. The proxy (Envoy, same as Istio) runs as a single instance per node, managed by the Cilium Agent. Traffic is redirected to the per-node Envoy instance via eBPF socket hooks, handled at L7, and then forwarded — without leaving the kernel for the initial redirect.

### What Cilium Service Mesh Provides

- **Mutual TLS (mTLS):** Transparent, certificate-managed encryption between pods. Certificates are provisioned by SPIFFE/SPIRE or Cilium's own CA.
- **L7 Traffic Management:** HTTP/gRPC retries, timeouts, circuit breaking, and header manipulation via `CiliumEnvoyConfig` CRD.
- **Traffic Policies:** Canary deployments, traffic splitting by weight.
- **Ingress / Gateway API:** Cilium can serve as a Kubernetes Ingress controller or implement the Gateway API spec.

```yaml
# Example: HTTP retry policy via CiliumEnvoyConfig
apiVersion: cilium.io/v2
kind: CiliumEnvoyConfig
metadata:
  name: checkout-retry-policy
  namespace: production
spec:
  services:
    - name: checkout
      namespace: production
  resources:
    - "@type": type.googleapis.com/envoy.config.route.v3.RouteConfiguration
      name: checkout_route
      virtual_hosts:
        - name: checkout
          domains: ["*"]
          routes:
            - match:
                prefix: /
              route:
                cluster: checkout_cluster
                retry_policy:
                  retry_on: 5xx
                  num_retries: 3
                  per_try_timeout: 10s
```

> [!NOTE]
> **Cilium Service Mesh vs Istio:** Cilium's service mesh mode is simpler to operate (no sidecars, no Istiod control plane), but has less feature breadth than Istio — particularly for complex traffic routing scenarios (Istio's `VirtualService` DSL is richer than `CiliumEnvoyConfig`). For organizations starting fresh without a service mesh, Cilium is the lower-complexity path. Migrating from Istio to Cilium requires careful policy translation.

---

## 8. Cluster Mesh — Multi-Cluster Networking

### What Cluster Mesh Enables

Cluster Mesh connects multiple Cilium-managed clusters so that:

- Pods in Cluster A can reach pods in Cluster B using their cluster-internal pod IPs (no NAT, no VPN tunnel required beyond the underlying network connectivity).
- Kubernetes Services can be declared as Global Services — exposed across all connected clusters with automatic failover.
- Network policies are enforced consistently at the endpoint identity level across cluster boundaries.

Cluster Mesh is useful for active-active multi-region architectures, or for separating environments (prod/staging) into separate clusters while allowing controlled cross-cluster access.

### Architecture

Each cluster exposes its Cilium KVStore (etcd) externally. Connected clusters read each other's endpoint identity and service state from these shared etcd endpoints. The Cilium Agent on each node maintains a local view of all identities cluster-wide including remote clusters.

```bash
# Enable Cluster Mesh on both clusters
# Cluster 1
cilium clustermesh enable --context cluster-1

# Cluster 2
cilium clustermesh enable --context cluster-2

# Connect the clusters
cilium clustermesh connect \
  --context cluster-1 \
  --destination-context cluster-2

# Verify
cilium clustermesh status --context cluster-1
```

### Global Services

Annotate a Service to make it a Global Service — load balanced across all clusters:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: production
  annotations:
    service.cilium.io/global: "true"
    service.cilium.io/shared: "true"   # also export this cluster's pods to others
spec:
  selector:
    app: backend
  ports:
    - port: 8080
      targetPort: 8080
```

With `global: true`, a request to `backend.production.svc.cluster.local` from any pod in any connected cluster will be load balanced across all matching pods in all clusters. Cilium handles failover automatically — if all pods in the local cluster become unhealthy, traffic shifts to the remote cluster's pods.

---

## 9. BGP Control Plane

### The Problem It Solves

In cloud environments, you typically rely on cloud load balancers (ALB, NLB on AWS; Cloud LB on GCP) to give Services external IPs. In bare-metal, on-premises, or hybrid environments, there is no such cloud provider. BGP Control Plane lets Cilium advertise LoadBalancer Service IPs and pod CIDRs directly to your ToR (Top of Rack) switches or on-premises routers, making them routable without cloud infrastructure.

### BGP Peer Configuration

```yaml
# CiliumBGPPeeringPolicy — defines BGP peers for nodes matching the node selector
apiVersion: cilium.io/v2alpha1
kind: CiliumBGPPeeringPolicy
metadata:
  name: rack-1-bgp
spec:
  nodeSelector:
    matchLabels:
      rack: rack-1
  virtualRouters:
    - localASN: 65001
      exportPodCIDR: true          # advertise pod CIDRs to the fabric
      serviceSelector:
        matchExpressions:
          - key: somekey
            operator: Exists        # advertise all Services with this label
      neighbors:
        - peerAddress: 192.168.1.1/32
          peerASN: 65000
          eBGPMultihop: false
          gracefulRestart:
            enabled: true
            restartTimeSeconds: 120
```

### LoadBalancer IP Allocation

Combine BGP with Cilium's `CiliumLoadBalancerIPPool` to allocate IPs from your own IP block without a MetalLB or cloud provider:

```yaml
apiVersion: cilium.io/v2alpha1
kind: CiliumLoadBalancerIPPool
metadata:
  name: production-lb-pool
spec:
  cidrs:
    - cidr: 192.168.100.0/24   # Your on-prem routable range
  serviceSelector:
    matchLabels:
      pool: production
```

Services annotated `pool: production` will receive IPs from this range, and Cilium's BGP control plane will advertise those /32 host routes to your BGP peers.

---

## 10. Performance Characteristics & Benchmarks

### Where eBPF Wins Over kube-proxy

The performance advantage of Cilium over kube-proxy increases with scale. At small cluster sizes (<50 nodes, <200 services), the difference is measurable but not operationally relevant. Above that, the gap grows.

| Scenario | kube-proxy (iptables) | Cilium (eBPF) |
|---|---|---|
| Service update propagation at 10k services | 5–10 seconds (iptables rewrite) | ~10ms (BPF map update) |
| Per-packet forwarding latency (p99) | 40–80μs | 10–20μs |
| CPU at 100k pps (single node) | ~30% higher than eBPF | Baseline |
| Connection setup rate | Degrades with rule count | Near-constant |
| Flow-level observability | Not available | Native (Hubble) |

Reference: Cilium's own benchmarks and independent testing by CNCF projects consistently show 20–40% lower latency and significantly reduced CPU overhead compared to kube-proxy at scale. The exact numbers vary by kernel version, NIC driver, and workload pattern.

### DSR Mode — Direct Server Return

When `loadBalancer.mode: dsr` is enabled, response traffic from backend pods does not hairpin through the node that received the request. Instead, the backend pod sends responses directly to the client, with the original Service IP preserved in the source. This eliminates one network hop for response traffic on NodePort and LoadBalancer services, reducing latency and the load on ingress nodes.

DSR requires the underlying network to support Cilium's encapsulation of the original client IP in the request packet. It works natively in direct-routing mode (no tunnel) and with the Geneve-based tunnel encapsulation in tunnel mode.

### Same-Node Pod-to-Pod Optimization

When both the source and destination pods are on the same node, Cilium bypasses the network stack entirely using socket-level eBPF hooks. The packet does not traverse a `veth` pair — it is redirected at the socket level. This eliminates multiple kernel stack traversals and reduces same-node pod-to-pod latency significantly compared to routing through a virtual bridge.

---

## 11. Failure Modes & Troubleshooting

### Failure Scenario Matrix

| Failure | Impact | Detection | Recovery |
|---|---|---|---|
| **Cilium Agent crash on a node** | Existing eBPF programs keep running (dataplane is kernel-resident). New pods on that node fail to get IPs. | `cilium-agent` pod `CrashLoopBackOff` in `kube-system`. | Agent restarts automatically. If persistent: check logs, kernel version compatibility, BPF map exhaustion. |
| **Cilium Operator down** | New node bootstrapping stalls (CIDR allocation). Existing cluster operation continues. | Operator pod not `Running`. | Operator self-heals on restart. Check CRD sync errors in logs. |
| **BPF map full** | Packets dropped, new connections refused. `CT map full` errors. | Hubble drop events with `CT_TRUNCATED` or `MAX_CONNECTIONS_FLUSHED` reason. | Increase map sizes via Helm (`bpf.ctTcp.max`, `bpf.ctAny.max`). Requires agent restart. |
| **Identity allocation exhaustion** | New pods cannot get identities, policy enforcement stalls. | `CiliumIdentity` object creation failures. | Default identity range is 1–65535. Adjust `identityAllocationMode` or clean up stale identities. |
| **FQDN policy DNS proxy failure** | DNS resolution fails for pods with FQDN egress policies. | `dns` protocol drop events in Hubble. | Check Cilium Agent DNS proxy logs. Verify CoreDNS is reachable. |
| **Kernel version incompatibility** | Agent fails to load eBPF programs. | Agent logs: `failed to load BPF program`. | Cilium requires kernel 4.19.57+ (basic), 5.10+ (all features). Check feature gate with `cilium-dbg kernel-check`. |

### Connectivity Troubleshooting Playbook

1. **Run the built-in connectivity test first.** `cilium connectivity test` creates a test namespace and runs L3/L4/L7 connectivity probes. This isolates whether the problem is Cilium itself or your specific workload's policy.

2. **Check Agent health on the affected node.** SSH to the node and run `cilium status`. Look for `Controller Failures` and `BPF Map Usage`. A map near 100% is a capacity problem.

3. **Observe drops in Hubble.** `hubble observe --verdict DROPPED --from-pod <namespace>/<pod>` shows whether packets are being policy-denied or dropped for other reasons. The drop reason is included in the output.

4. **Check endpoint status.** `cilium endpoint list` on the affected node. An endpoint in `not-ready` state indicates regeneration is failing. `cilium endpoint get <id>` shows policy details and identity.

5. **Verify identity propagation.** If two pods cannot talk even though policy allows it, check that the source pod's identity is correctly propagated to the destination node: `cilium identity list` and `cilium map get cilium_ipcache` on the destination node.

6. **Check FQDN DNS cache for FQDN policies.** `cilium fqdn cache list` shows which domains have been resolved and which IPs are currently allowed. If a domain is missing, the DNS proxy may not have intercepted the resolution.

7. **Inspect BPF maps directly if needed.** `cilium map get cilium_lb4_services_v2` to verify service-to-backend mappings are correct. Missing backends indicate an endpoint syncing issue.

8. **Enable debug logging temporarily.** `cilium config debug=true` on the agent. This is verbose — pull a 5-minute log window and disable immediately after.

```bash
# Quick diagnostic sequence
cilium status
cilium endpoint list
hubble observe --verdict DROPPED --last 100
cilium monitor --type drop    # low-level kernel drop events
```

---

## 12. Day-2 Operations

### Upgrading Cilium

Cilium supports rolling upgrades. The general procedure:

1. Read the release notes for breaking changes. Cilium is explicit about deprecations.
2. Run `cilium upgrade` (via the Cilium CLI) or `helm upgrade`. The CLI wraps the Helm upgrade with preflight checks.
3. The DaemonSet performs a rolling restart — one node at a time. Existing eBPF programs continue to enforce policy during the restart; the brief window between agent shutdown and restart on each node is handled by the kernel-resident programs staying loaded.
4. After upgrade, run `cilium connectivity test` to verify the new version is functioning correctly.

```bash
# Upgrade using Cilium CLI (preferred — includes preflight checks)
cilium upgrade --version 1.16.0

# Or via Helm
helm upgrade cilium cilium/cilium \
  --version 1.16.0 \
  --namespace kube-system \
  --reuse-values \
  --set upgradeCompatibility=1.15
```

> [!WARNING]
> **Do not skip major versions.** Cilium's upgrade path supports N-1 version jumps. Jumping from 1.13 to 1.15 directly is unsupported and risks BPF map schema incompatibilities that require agent recreation rather than a rolling update.

### Identity Garbage Collection

CiliumIdentity objects accumulate over time as pods with unique label sets come and go. Stale identities are cleaned up by the Operator, but the GC cycle runs on a configurable interval (default: 15 minutes). In high-churn environments (CI runners, batch jobs), identity objects can accumulate faster than GC clears them.

```bash
# List all identities and their label sets
cilium identity list

# Count current identities
kubectl get ciliumidentity --no-headers | wc -l

# Force an Operator reconciliation cycle (restarts the operator pod)
kubectl rollout restart deployment/cilium-operator -n kube-system
```

### Quarterly Network Review

Run this review quarterly for clusters using Cilium as the CNI in production.

#### Policy Hygiene
- Run `cilium policy get` and audit all `CiliumNetworkPolicy` and `CiliumClusterwideNetworkPolicy` objects. Remove policies for decommissioned workloads.
- Review Hubble drop metrics in Grafana for sustained drop rates that indicate policy gaps or misconfigured allowlists.
- For any FQDN policies, rotate the FQDN allowlist and verify `cilium fqdn cache list` matches expected domains.

#### Capacity & Limits
- Check BPF map usage on the highest-pod-density nodes: `cilium status | grep BPF`. Alert if any map is above 70%.
- Review identity count growth trend. If approaching 60k identities, investigate label proliferation (overly specific label schemas, CI job pods leaking identities).
- Review `hubble_drop_total` rate. Sustained drops suggest a policy, capacity, or kernel issue.

#### Security Audit
- Audit `CiliumClusterwideNetworkPolicy` for any policies that were added as "temporary" and never removed.
- Review egress FQDN allowlists for stale domains pointing to decommissioned services.
- Confirm mTLS is active between all service-mesh-enrolled namespaces: `hubble observe --protocol tcp --verdict FORWARDED` should show encryption metadata on affected flows.

#### Upgrade Readiness
- Check the current Cilium version against the latest stable release. Cilium has a roughly 6-week release cadence.
- Review kernel versions across the node fleet. Features like WireGuard encryption require kernel 5.6+; BIG TCP requires 6.3+.
- Run `cilium connectivity test` in a staging cluster on the target Cilium version before scheduling a production upgrade.
