# Kubernetes Networking & CNI

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The Kubernetes Networking Model](#1-the-kubernetes-networking-model) | The four fundamental rules every compliant network implementation must satisfy. |
| **02** | [Linux Networking Primitives](#2-linux-networking-primitives) | Network namespaces, veth pairs, bridges, routes, and iptables — the building blocks all CNI plugins use. |
| **03** | [What CNI Is and Is Not](#3-what-cni-is-and-is-not) | The CNI specification, what it defines, what it leaves to the plugin, and where it sits in the pod lifecycle. |
| **04** | [The CNI Plugin Lifecycle](#4-the-cni-plugin-lifecycle) | How kubelet invokes CNI, what ADD and DEL operations do, and how chained plugins work. |
| **05** | [Overlay vs Underlay vs eBPF Dataplanes](#5-overlay-vs-underlay-vs-ebpf-dataplanes) | The three architectural approaches to pod-to-pod traffic and the trade-offs of each. |
| **06** | [Flannel: Simple Overlay](#6-flannel-simple-overlay) | VXLAN encapsulation, the flannel daemon, subnet allocation, and why Flannel exists. |
| **07** | [Calico: Routed Underlay with Policy](#7-calico-routed-underlay-with-policy) | BGP-based routing, Felix, BIRD, the Calico datastore, and network policy enforcement via iptables. |
| **08** | [Cilium: eBPF-Native Networking](#8-cilium-ebpf-native-networking) | How Cilium replaces kube-proxy and iptables with eBPF programs, identity-based policy, and Hubble observability. |
| **09** | [AWS VPC CNI: Native ENI Networking](#9-aws-vpc-cni-native-eni-networking) | How EKS assigns VPC IPs directly to pods, ENI management, IP warm pools, and the implications for IP exhaustion. |
| **10** | [CNI Comparison & Selection Guide](#10-cni-comparison-selection-guide) | Side-by-side comparison across key properties and a decision framework for choosing a CNI. |

---

## 1. The Kubernetes Networking Model

Kubernetes does not implement networking itself. It defines a contract — a set of rules that any network implementation must satisfy — and delegates the actual implementation to a pluggable component: the CNI plugin. The rules are intentionally minimal:

- **Every pod gets its own IP address.** Pods are not behind NAT from the cluster's perspective. There is no port mapping, no shared network namespace between pods on the same node (unless explicitly configured with host networking).
- **Every pod can reach every other pod by IP, without NAT.** A pod on Node A can connect directly to a pod on Node B using the destination pod's IP. The routing is transparent — no address translation occurs in transit.
- **Every node can reach every pod, and vice versa.** Nodes and pods share a routable address space. A process on the node host can connect to any pod IP directly.
- **The IP a pod sees for itself is the same IP that other pods use to reach it.** There is no split between internal and external pod addressing within the cluster network.

These four rules define the Kubernetes networking model. They say nothing about *how* the connectivity is achieved — whether through tunnels, BGP routing, direct ENI attachment, or eBPF programs. That is entirely the CNI plugin's concern.

The model's elegance is that it gives application developers a simple mental model — pods have stable IPs within their lifetime, any pod can reach any other pod — while giving infrastructure engineers freedom to implement that model using whatever mechanism fits their environment.

---

## 2. Linux Networking Primitives

Before examining CNI plugins, it is worth understanding the Linux kernel primitives that every plugin builds on. CNI plugins are not magic — they are orchestrated sequences of standard Linux networking operations.

### Network Namespaces

A network namespace is a kernel feature that gives a process its own isolated view of the network stack: its own interfaces, routing table, iptables rules, and socket table. When Kubernetes creates a pod, the container runtime creates a new network namespace for it. The pod's containers all share this namespace — they share the same IP address, the same port space, and the same network interfaces. This is why two containers in a pod can communicate over `localhost`.

At the moment of creation, the pod's network namespace has no interfaces (other than loopback) and no routes. It is the CNI plugin's job to wire this namespace into the broader network.

### Veth Pairs

A veth (virtual Ethernet) pair is a linked pair of virtual network interfaces that act like a pipe: anything written into one end emerges from the other. CNI plugins use veth pairs as the fundamental mechanism for connecting a pod's network namespace to the node's network namespace.

One end of the veth pair is placed inside the pod's network namespace (typically named `eth0` from the pod's perspective). The other end stays in the node's root network namespace (named something like `veth3a8b2c1`). The pod sends a packet out of `eth0`; it emerges from `veth3a8b2c1` on the node side, where it can be handled by the node's routing table, bridge, or eBPF programs.

### Linux Bridge

A Linux bridge is a software Layer 2 switch. CNI plugins like Flannel and the standard bridge plugin attach all the node-side veth ends to a bridge (`cni0` or `cbr0` are common names). Pods on the same node communicate through the bridge at Layer 2 without involving the routing stack. Traffic destined for pods on other nodes leaves the bridge, hits the node's routing table, and is forwarded off-node.

### Routes and the Routing Table

The Linux kernel's routing table determines where a packet goes based on its destination IP. CNI plugins install routes in both the pod's network namespace (a default route pointing at the node-side veth or gateway) and the node's routing table (routes for pod CIDRs on other nodes, pointing at tunnels or the physical interface). Managing these routes — adding them when pods start, removing them when pods stop — is a core responsibility of every CNI plugin.

### iptables and Netfilter

iptables is the userspace interface to the Linux kernel's Netfilter packet filtering framework. It allows rules to be written that match packets based on source IP, destination IP, port, protocol, and connection state, and to take actions: accept, drop, DNAT, SNAT, or jump to another chain.

CNI plugins and kube-proxy both use iptables extensively. kube-proxy uses iptables to implement Service load balancing (DNAT from ClusterIP to pod IPs). Calico uses iptables to enforce NetworkPolicy. Understanding iptables traversal — the order in which tables and chains are evaluated — is essential for debugging connectivity issues in clusters that have not migrated to eBPF.

### IPVS

IP Virtual Server (IPVS) is a higher-performance alternative to iptables for load balancing, built into the Linux kernel. kube-proxy can be configured to use IPVS instead of iptables for Service routing. At large scale (thousands of Services and endpoints), iptables rule evaluation becomes a linear scan that degrades performance; IPVS uses hash tables for O(1) lookup. IPVS does not replace iptables for network policy enforcement — that remains iptables-based in most CNI plugins.

---

## 3. What CNI Is and Is Not

CNI stands for Container Network Interface. It is a specification and a set of libraries that define how a container runtime invokes a network plugin to configure networking for a container. CNI is intentionally narrow in scope.

### What CNI Defines

CNI defines two things: an **interface** between the runtime and the plugin (how the runtime calls the plugin, what arguments it passes, what the plugin must return), and a **plugin execution model** (plugins are executables invoked by the runtime, not long-running daemons — though plugins may manage a daemon separately).

The CNI spec defines three operations a plugin must implement:

- **ADD** — configure networking for a container. Called when a pod starts. The plugin receives the network namespace path, the container ID, and a JSON configuration. It must attach the container to the network and return the IP address(es) assigned to the container.
- **DEL** — remove networking configuration for a container. Called when a pod stops. The plugin must clean up interfaces, routes, and IP allocations.
- **CHECK** — verify that the networking configuration for a container is as expected. Used for health checking.

### What CNI Does Not Define

CNI does not define how pod IPs are allocated across the cluster, how routing between nodes works, how network policy is enforced, or what the dataplane looks like. These are left entirely to the plugin implementation. This is why CNI plugins can range from a simple VXLAN overlay to a sophisticated eBPF-based policy engine — the specification is just the invocation interface.

### IPAM: IP Address Management

IP address management is a sub-concern within the ADD operation. CNI separates IPAM into its own plugin type. When a CNI plugin needs to allocate an IP for a pod, it invokes an IPAM plugin (such as `host-local`, `dhcp`, or a cloud-provider IPAM) that returns an available IP from the configured pool. The main CNI plugin then assigns this IP to the pod's interface.

In practice, sophisticated CNI plugins like AWS VPC CNI and Cilium implement their own IPAM logic rather than delegating to a generic IPAM plugin, because their allocation strategies are tightly coupled to their dataplane model.

---

## 4. The CNI Plugin Lifecycle

Understanding how CNI is invoked clarifies what the plugin is responsible for and what it is not.

### Pod Startup Sequence

When the Kubernetes scheduler assigns a pod to a node, the following sequence occurs:

1. **kubelet** receives the pod assignment and instructs the container runtime (containerd or CRI-O) to create the pod sandbox.
2. The **container runtime** creates the pod's network namespace — an empty namespace with only loopback configured.
3. The container runtime invokes the **CNI plugin binary** (found at `/opt/cni/bin/`) with the ADD operation, passing the network namespace path, container ID, and CNI configuration JSON from `/etc/cni/net.d/`.
4. The CNI plugin configures the network namespace: creates a veth pair, assigns an IP address (via IPAM), adds routes inside the namespace, and connects the node-side veth to the bridge or other dataplane construct.
5. The CNI plugin returns the assigned IP address to the runtime.
6. The container runtime starts the pod's application containers inside the already-networked namespace.
7. **kubelet** reports the pod's IP to the API server, where it becomes visible in `kubectl get pods -o wide`.

### Pod Teardown Sequence

When a pod is deleted, the sequence reverses. kubelet instructs the runtime to stop the containers and invoke the CNI plugin with the DEL operation. The plugin removes the veth pair, releases the IP back to the IPAM pool, and cleans up any routes or iptables rules it installed. The network namespace is then destroyed by the runtime.

### Chained Plugins

CNI supports plugin chaining — multiple plugins executed in sequence for a single ADD or DEL operation. The output of one plugin is passed as input to the next. This is how network policy enforcement is often layered on top of basic connectivity: a base CNI plugin (e.g., Flannel) provides connectivity, and a policy plugin (e.g., Calico in policy-only mode) chains after it to install iptables rules for NetworkPolicy enforcement.

Chaining is configured in the CNI configuration JSON, which specifies a `plugins` array. Each plugin in the array runs in order during ADD, and in reverse order during DEL.

---

## 5. Overlay vs Underlay vs eBPF Dataplanes

The three broad architectural approaches to pod-to-pod traffic represent fundamentally different answers to the same question: how does a packet from Pod A on Node 1 reach Pod B on Node 2?

### Overlay Networks

An overlay network encapsulates pod traffic inside another protocol — typically VXLAN or IP-in-IP — before sending it across the physical network. The physical network sees only node-to-node traffic; the pod addressing is entirely virtual and hidden inside the encapsulation.

The advantage is that overlay networks work on any physical network without requiring routing configuration. The physical switches and routers do not need to know anything about pod CIDRs. The disadvantage is encapsulation overhead: each packet gains a header (VXLAN adds 50 bytes), and the encapsulation/decapsulation is CPU work performed on the node. At high packet rates, this overhead becomes measurable.

Flannel's VXLAN mode is the canonical overlay implementation. Calico's VXLAN mode is an optional overlay for environments where BGP is not possible.

### Underlay / Routed Networks

A routed (underlay) network does not encapsulate pod traffic. Instead, it programs the physical network — or the node's routing table — with routes for pod CIDRs. When Pod A on Node 1 sends a packet to Pod B on Node 2, the packet travels with the pod IP as the destination, and routers forward it based on the programmed routes.

The advantage is zero encapsulation overhead and full network visibility: the physical network sees the actual pod IPs, making debugging and monitoring simpler. The disadvantage is that the physical network must be capable of carrying the pod routes — either through BGP peering with a ToR switch or through cloud-provider route table programming.

Calico in BGP mode is the canonical routed implementation. AWS VPC CNI achieves a similar effect by assigning VPC IPs directly to pods, making the VPC's routing infrastructure the "underlay" automatically.

### eBPF Dataplane

eBPF (extended Berkeley Packet Filter) is a Linux kernel technology that allows sandboxed programs to run inside the kernel in response to events — including network packet processing. Rather than using iptables rules or kernel routing, an eBPF-based CNI attaches programs to network hooks that intercept packets and make forwarding decisions at kernel speed, without the overhead of the traditional networking stack.

The advantages are significant: lower per-packet latency, O(1) service lookup (vs iptables' linear chain traversal), richer observability (eBPF programs can emit structured events about every flow), and the ability to enforce L7-aware policies without a sidecar proxy. The disadvantage is a minimum kernel version requirement (4.9 for basic eBPF, 5.x for advanced features) and operational complexity — debugging eBPF programs requires different tooling than iptables.

Cilium is the leading eBPF-native CNI. It replaces kube-proxy entirely and provides a dataplane that has no iptables dependency.

---

## 6. Flannel: Simple Overlay

Flannel is the oldest and simplest production CNI plugin. It was created by CoreOS (now part of Red Hat) to solve the basic problem of pod-to-pod connectivity across nodes without requiring physical network configuration. Its design philosophy is minimal: do one thing — provide a flat network — and do it simply.

### Architecture

Flannel runs a daemon called `flanneld` on every node. At startup, `flanneld` acquires a subnet lease from a central store (etcd or the Kubernetes API) — a slice of the cluster's pod CIDR range that this node exclusively owns. For example, if the cluster pod CIDR is `10.244.0.0/16`, Node 1 might receive `10.244.1.0/24` and Node 2 might receive `10.244.2.0/24`.

`flanneld` then creates a VXLAN interface (`flannel.1`) on the node and programs routes so that traffic destined for other nodes' pod subnets is sent via VXLAN encapsulation through `flannel.1`. Traffic for local pods goes through the `cni0` bridge directly.

### VXLAN Encapsulation

When Pod A (10.244.1.5) on Node 1 sends a packet to Pod B (10.244.2.8) on Node 2:

1. The packet leaves Pod A via its `eth0` veth, emerges on the `cni0` bridge on Node 1.
2. Node 1's routing table has a route: `10.244.2.0/24 via flannel.1`.
3. The kernel VXLAN driver encapsulates the original packet in a UDP datagram, with the Node 2 IP as the outer destination. The VXLAN Network Identifier (VNI) identifies the overlay network.
4. The encapsulated packet travels across the physical network from Node 1 to Node 2 as a normal UDP packet.
5. Node 2's VXLAN driver decapsulates the packet, revealing the original pod-addressed packet, which is delivered to Pod B via the `cni0` bridge.

### Trade-offs

Flannel's simplicity is both its greatest strength and its primary limitation. It provides basic connectivity with minimal configuration and works on almost any network infrastructure. It does not, however, provide NetworkPolicy enforcement — a separate policy enforcement mechanism (like Calico in policy-only mode, chained after Flannel) is required for production use. Flannel also cannot take advantage of direct routing capabilities available in cloud environments like AWS, though it can be configured to use host-gw mode (no encapsulation, direct routing) when all nodes are on the same L2 segment.

Flannel is appropriate for simple clusters, development environments, and scenarios where operational simplicity matters more than performance or policy richness. It is rarely the right choice for production-grade multi-tenant clusters.

---

## 7. Calico: Routed Underlay with Policy

Calico is a production-grade CNI plugin from Tigera that takes a fundamentally different approach from Flannel. Rather than building an overlay, Calico operates as a routing daemon that distributes pod routes across the cluster using BGP. It also provides a rich NetworkPolicy engine, making it a common choice for production environments that need both performance and policy.

### Core Components

Calico's architecture on each node consists of two main components:

**Felix** is the primary agent. It runs on every node, watches the Calico datastore (either etcd or the Kubernetes API via CRDs) for policy and endpoint changes, and programs the node's networking accordingly — installing routes, writing iptables rules for NetworkPolicy enforcement, and managing the local pod interface configuration.

**BIRD** (Bird Internet Routing Daemon) is a BGP daemon that runs alongside Felix. It peers with BIRD instances on other nodes (or with physical ToR switches in datacenter deployments) and advertises the pod CIDR subnets owned by the local node. Other nodes receive these advertisements and install routes into their kernel routing tables. This is what enables direct pod-to-pod routing without encapsulation.

In cloud environments like EKS, where BGP peering with the physical network is not possible, Calico can fall back to VXLAN or IP-in-IP overlay mode, or it can run in policy-only mode where AWS VPC CNI handles connectivity and Calico provides only NetworkPolicy enforcement.

### Routing Modes

| Mode | Mechanism | Requires physical BGP | Encapsulation overhead |
| :--- | :--- | :--- | :--- |
| BGP (full mesh) | BIRD peers with all other nodes | No — nodes peer directly | None |
| BGP (with route reflector) | BIRD peers with a central reflector | Optional | None |
| BGP (with ToR peering) | BIRD peers with physical switches | Yes | None |
| IP-in-IP overlay | Encapsulates in IP | No | Low (20-byte header) |
| VXLAN overlay | Encapsulates in UDP/VXLAN | No | Medium (50-byte header) |

In a full-mesh BGP deployment, every node peers with every other node. This works up to a few hundred nodes but becomes operationally complex at scale. Route reflectors — dedicated nodes or external systems that redistribute BGP routes — are used in larger clusters.

### NetworkPolicy Enforcement

Calico's Felix component translates Calico NetworkPolicy and Kubernetes NetworkPolicy objects into iptables rules on each node. When a new policy is created or modified, Felix calculates the affected endpoints and updates the iptables rules accordingly.

Calico's own policy model is a superset of the standard Kubernetes NetworkPolicy — it supports egress rules (not available in some older Kubernetes NetworkPolicy implementations), DNS-based rules, ordering and priority between policies, and cluster-wide GlobalNetworkPolicy objects that apply to all namespaces. This richness makes Calico a strong choice for multi-tenant clusters with complex security requirements.

The trade-off is iptables scale. In a cluster with many pods and many policies, the number of iptables rules can reach tens of thousands, and the linear traversal cost during rule matching becomes measurable. Calico addresses this with eBPF mode — a newer option that replaces its iptables dataplane with eBPF programs, gaining the same performance benefits as Cilium without requiring a full migration.

---

## 8. Cilium: eBPF-Native Networking

Cilium is a CNI plugin built from the ground up on eBPF. Rather than layering on top of iptables and the traditional kernel networking stack, Cilium attaches eBPF programs to network hooks that process packets at near-line rate inside the kernel. The result is a networking and security layer with no iptables dependency, richer policy semantics, and native observability.

### How Cilium Replaces kube-proxy

In a standard cluster, kube-proxy runs on every node and manages iptables rules for Service load balancing. When a pod sends a packet to a ClusterIP, iptables DNAT rules translate the destination to a real pod IP. In large clusters with many Services, these rules number in the tens of thousands and are evaluated sequentially for every packet.

Cilium replaces kube-proxy entirely. It attaches eBPF programs at the socket layer — before packets even enter the kernel networking stack — that perform Service load balancing using eBPF maps (hash tables with O(1) lookup). The ClusterIP is resolved to a backend pod IP before the packet is sent, eliminating the DNAT overhead entirely. Connection tracking is maintained in eBPF maps rather than the kernel's conntrack table.

### Identity-Based Policy

The most conceptually significant aspect of Cilium is its approach to network policy enforcement. Traditional CNI plugins enforce policy based on IP addresses: a rule allows traffic from `10.244.1.0/24`. IP addresses are unstable in Kubernetes — pods are ephemeral and IPs are recycled — which means IP-based rules require constant updates as pods come and go.

Cilium enforces policy based on **identity** — a numeric label derived from the pod's Kubernetes labels. Every pod is assigned an identity at startup. Policy rules match on identity rather than IP. When a new pod starts, it inherits its identity from its labels; no policy update is required. When a pod is rescheduled with the same labels, it gets the same identity and the same policy applies immediately.

This identity model also enables Cilium's L7 policy capability. Because Cilium's eBPF programs inspect packet content, a NetworkPolicy can express rules like "allow HTTP GET requests to path `/api/v1/` from pods with label `role=frontend`" without a sidecar proxy. This is a qualitative capability improvement over IP-based L4 rules.

### Hubble: eBPF-Native Observability

Hubble is Cilium's observability layer, built on eBPF. Because eBPF programs run in the kernel and can observe every packet at every network hook, Hubble provides flow-level visibility across the entire cluster without any application instrumentation or sidecar injection. It surfaces per-flow metrics, DNS query logs, HTTP request/response metadata, and policy verdict (allowed vs dropped) for every network flow.

This level of observability is not achievable with traditional CNI plugins because there is no kernel hook that provides it — iptables rules fire but do not log structured flow data, and adding logging to every iptables rule at scale degrades performance significantly.

### Minimum Kernel Requirements

Cilium's eBPF dependency comes with kernel version requirements. A practical minimum for production Cilium is Linux 5.4 LTS, though some features require 5.10 or later. Amazon Linux 2023 and Ubuntu 22.04 both meet this requirement. Older node images — Amazon Linux 2 with a pre-5.4 kernel — require kernel upgrades before Cilium can be used.

---

## 9. AWS VPC CNI: Native ENI Networking

AWS VPC CNI is the default CNI plugin for Amazon EKS. It takes a fundamentally different approach from overlay and BGP-routed plugins: rather than building a separate pod network on top of the VPC, it makes the VPC itself the pod network by assigning real VPC IP addresses directly to pods using Elastic Network Interfaces.

### The ENI Model

Every EC2 instance in AWS can have multiple ENIs attached, and each ENI can have multiple private IP addresses assigned from the VPC subnet. AWS VPC CNI exploits this capability: when a node starts, the `aws-node` DaemonSet (which runs the CNI) attaches additional ENIs to the instance and pre-allocates a pool of secondary IPs on those ENIs. When a pod starts and needs an IP, the CNI assigns one of these pre-allocated IPs directly to the pod's network interface.

The pod's IP is a real VPC IP. Traffic from the pod travels on the VPC fabric natively — no encapsulation, no overlay, no tunnel. The VPC routing table, security groups, and VPC flow logs all see the actual pod IPs. A pod in EKS is effectively a first-class VPC resource, indistinguishable from an EC2 instance at the network layer.

### IP Warm Pool and Pre-allocation

To avoid latency during pod startup (allocating a new IP from AWS would require an EC2 API call, which takes seconds), AWS VPC CNI maintains a warm pool of pre-allocated IPs on each node. The `WARM_IP_TARGET` and `WARM_ENI_TARGET` environment variables on the `aws-node` DaemonSet control how many spare IPs are kept ready. When the pool drops below the target, the CNI proactively allocates more IPs — attaching new ENIs or adding secondary IPs to existing ENIs.

This pre-allocation means that a node holds more IPs from the subnet than it has running pods. In subnets with limited CIDR ranges, this can cause IP exhaustion before node capacity is reached.

### The IP Exhaustion Problem

The most operationally significant characteristic of AWS VPC CNI is its consumption of VPC IP address space. The number of pods a node can run is bounded not just by CPU and memory but by the number of ENIs the instance type supports multiplied by the number of IPs per ENI, minus one (the primary ENI's primary IP is reserved for the node itself).

For example, an `m5.large` supports 3 ENIs with 10 IPs each — meaning a maximum of `(3 × 10) - 3 = 27` pod IPs per node. For instance types with fewer ENIs or smaller IP limits, this can be a tight constraint.

In a large cluster with many small subnets or a `/24` VPC CIDR, the combination of IP pre-allocation and per-node ENI attachment can exhaust subnet IPs before all nodes are fully utilized. This is a well-known operational challenge with AWS VPC CNI in dense deployments.

### Mitigation: Prefix Delegation Mode

AWS VPC CNI supports a **prefix delegation** mode that dramatically increases the number of IPs available per node. Instead of assigning individual secondary IPs to an ENI, prefix delegation assigns a `/28` CIDR prefix (16 IPs) to each ENI slot. An `m5.large` with 3 ENIs can then support up to `3 × 16 = 48` IPs from prefix delegation versus 30 from individual IP assignment.

Prefix delegation requires that the subnets hosting the ENIs have sufficient CIDR space to allocate `/28` blocks, and that the VPC CNI version and EKS node AMI are recent enough to support it. It is the recommended mode for clusters with high pod density.

### Security Groups for Pods

Because pods have real VPC IPs, AWS VPC CNI supports attaching VPC Security Groups directly to pods — not just to nodes. This means a pod can have a security group rule that allows inbound access from an RDS security group, for example, without relying on Kubernetes NetworkPolicy. Security groups for pods are applied at the ENI level in the VPC fabric, not via iptables on the node.

This capability is particularly valuable for workloads that need to integrate with VPC-native services (RDS, ElastiCache, MSK) using security group references rather than CIDR-based firewall rules. It is, however, mutually exclusive with some CNI configurations and requires specific instance types that support the trunk ENI feature.

### Interoperability with Calico for NetworkPolicy

AWS VPC CNI provides connectivity only — it does not implement Kubernetes NetworkPolicy. For network policy enforcement on EKS, the most common pattern is to run Calico in **policy-only mode** alongside AWS VPC CNI. In this configuration, AWS VPC CNI handles all IP assignment and routing, while Calico's Felix component installs iptables rules on each node to enforce NetworkPolicy without interfering with the VPC CNI dataplane.

Alternatively, Cilium can be deployed on EKS in **chained mode** or as a full replacement CNI, using either its own IPAM or delegating to AWS VPC CNI for IP allocation while providing the eBPF policy and observability layer.

---

## 10. CNI Comparison & Selection Guide

### Feature Comparison

| Property | Flannel | Calico | Cilium | AWS VPC CNI |
| :--- | :--- | :--- | :--- | :--- |
| Dataplane | VXLAN overlay | BGP routes / VXLAN / eBPF | eBPF | Native VPC ENI |
| Encapsulation | Yes (VXLAN) | Optional | No (eBPF socket) | No |
| NetworkPolicy | No (needs chaining) | Yes — iptables or eBPF | Yes — identity-based, L7-aware | No (needs Calico or Cilium) |
| kube-proxy replacement | No | Partial (eBPF mode) | Yes — full replacement | No |
| L7 policy | No | No | Yes | No |
| Observability | Minimal | Moderate (Felix logs) | Rich (Hubble flows) | VPC Flow Logs (node-level) |
| IPAM model | Per-node subnet | Per-node subnet | Flexible (k8s, cluster pool, ENI) | AWS ENI secondary IPs |
| Multi-tenant isolation | Basic | Strong (GlobalNetworkPolicy) | Strongest (identity + L7) | Network via SGs |
| Cloud-native integration | None | None | Partial | Deep (SGs, VPC routing) |
| Minimum kernel | Any | Any (eBPF mode: 5.3+) | 5.4+ recommended | Any |
| Operational complexity | Low | Medium | Medium-High | Low-Medium |
| EKS support | Community | Community + AWS | Community + AWS | AWS official default |

### Decision Framework

**Choose Flannel when** the cluster is a development or lab environment, operational simplicity is the top priority, and NetworkPolicy is not required. Flannel is rarely appropriate for production multi-tenant clusters.

**Choose Calico when** the cluster needs robust NetworkPolicy enforcement, the environment supports BGP routing (bare metal, on-prem, or cloud with L3 fabric access), and the team is comfortable with iptables-based operations. Calico's GlobalNetworkPolicy and egress policy capabilities make it the strongest choice for strict multi-tenant isolation without eBPF requirements.

**Choose Cilium when** the cluster requires L7-aware policy, high-performance service routing at scale, or deep network observability without a service mesh. Cilium's eBPF foundation makes it the best long-term architectural choice for clusters running on modern kernels. The kernel version requirement and operational learning curve are the primary adoption barriers.

**Choose AWS VPC CNI when** the cluster runs on EKS and native VPC integration is a priority — particularly when VPC security groups need to apply to pods, when VPC Flow Logs must capture pod-level traffic, or when tight integration with VPC-native services (RDS, ElastiCache) via security group references is required. AWS VPC CNI should always be paired with Calico or Cilium for NetworkPolicy enforcement.

| Scenario | Recommended CNI |
| :--- | :--- |
| EKS, standard workloads, minimal ops overhead | AWS VPC CNI + Calico (policy-only) |
| EKS, high pod density, IP exhaustion risk | AWS VPC CNI (prefix delegation) + Calico |
| EKS, L7 policy, deep observability | AWS VPC CNI + Cilium chained, or Cilium full |
| On-prem / bare metal, BGP fabric available | Calico (BGP mode) |
| On-prem / bare metal, modern kernel, eBPF desired | Cilium |
| On-prem / bare metal, simple cluster, no BGP | Flannel + Calico policy |
| Multi-cloud or hybrid, consistent policy plane | Calico or Cilium |
