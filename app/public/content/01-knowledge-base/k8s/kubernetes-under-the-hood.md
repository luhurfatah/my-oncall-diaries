# Kubernetes Control Plane Internals

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The Big Picture](#1-the-big-picture) | The core design philosophy: declarative state, the watch-reconcile loop, and why Kubernetes works the way it does. |
| **02** | [The API Server](#2-the-api-server) | The single entry point for all cluster operations — authn, authz, admission, and the object store gateway. |
| **03** | [etcd: The Source of Truth](#3-etcd-the-source-of-truth) | How Kubernetes stores and watches cluster state, MVCC, and why etcd health equals cluster health. |
| **04** | [The Scheduler](#4-the-scheduler) | How an unscheduled pod becomes assigned to a node — filtering, scoring, and binding. |
| **05** | [The Controller Manager](#5-the-controller-manager) | The reconciliation engine — what controllers are, how they watch and act, and which built-in controllers matter most. |
| **06** | [The Kubelet](#6-the-kubelet) | The node agent — how it watches for work, drives the container runtime, manages probes, and handles eviction. |
| **07** | [The Container Runtime Stack: CRI, containerd, runc](#7-the-container-runtime-stack-cri-containerd-runc) | The layered interfaces from kubelet to running process — CRI, containerd, snapshotter, and runc. |
| **08** | [Linux Isolation: cgroups & Namespaces](#8-linux-isolation-cgroups-namespaces) | How the kernel enforces resource limits and process isolation for every container. |
| **09** | [Kubenet: The Built-in Network Plugin](#9-kubenet-the-built-in-network-plugin) | What kubenet is, how it differs from CNI plugins, and where it still appears. |
| **10** | [Image Pull & Layer Caching](#10-image-pull-layer-caching) | How container images are fetched, unpacked, and layered before a container starts. |
| **11** | [Full Pod Lifecycle: kubectl apply → Running Pod](#11-full-pod-lifecycle-kubectl-apply-running-pod) | A step-by-step trace of every system interaction from manifest submission to a healthy running container. |

---

## 1. The Big Picture

Kubernetes is a **declarative system**. You tell it what you want — "run three replicas of this container" — and the system continuously works to make reality match that declaration. You do not instruct Kubernetes to start a container; you write an object that describes the desired state and let the control plane figure out how to achieve it.

This philosophy has a name: the **watch-reconcile loop**. Every meaningful component in Kubernetes — the scheduler, the controller manager, the kubelet — follows the same pattern:

1. **Watch** the API server for objects relevant to its concern.
2. **Compare** the desired state (what the object declares) against the current state (what actually exists).
3. **Act** to close the gap — start a pod, schedule a workload, delete a replica.
4. **Repeat** indefinitely.

Nothing in Kubernetes is one-shot. Controllers are always running, always reconciling. If a node dies, the controller notices the gap and re-creates the affected pods elsewhere. If someone manually deletes a pod managed by a ReplicaSet, the controller sees the gap and starts a replacement. The system is self-healing not because of special logic but because reconciliation never stops.

This also means Kubernetes has **no single point of coordination**. The API server is the communication hub, but no component tells another what to do. The scheduler does not tell the kubelet to start a pod; it writes a binding object to the API server, and the kubelet — which is already watching — reacts to it. Every component is autonomous and event-driven.

Understanding this model explains most Kubernetes behavior, including why eventual consistency is a property of the system by design, not a bug.

---

## 2. The API Server

The API server (`kube-apiserver`) is the only component in Kubernetes that talks directly to etcd. Every other component — the scheduler, the controller manager, the kubelet, `kubectl` — interacts with the cluster exclusively through the API server's REST interface. It is the single front door to all cluster state.

### Request Processing Pipeline

Every request to the API server passes through a sequential pipeline before it touches etcd:

**Authentication (authn)** determines *who* is making the request. Kubernetes supports several authentication mechanisms simultaneously: client certificates (the kubeconfig credential), bearer tokens (service account tokens, OIDC JWTs), and webhook authenticators. The API server tries each configured authenticator in order until one succeeds. The result is a user identity — a username and a set of groups — attached to the request.

**Authorization (authz)** determines *whether* the authenticated identity is allowed to perform the requested action on the requested resource. The default and most common authorizer is RBAC — it checks whether any Role or ClusterRole bound to the requesting identity grants the requested verb (get, list, create, delete, etc.) on the target resource type and namespace. If no binding grants the action, the request is denied.

**Admission control** is a post-authorization step that can mutate or validate the request before it is persisted. Admission controllers are plugins that run in sequence. **Mutating admission webhooks** can modify the object — the IRSA webhook that injects environment variables into pods is a mutating admission webhook. **Validating admission webhooks** can reject requests that do not meet policy — OPA/Gatekeeper and Kyverno work this way. Built-in admission controllers handle things like setting default resource requests, enforcing namespace limits, and injecting default service accounts.

**Persistence** is the final step — the validated, admitted object is written to etcd, and the API server returns a response to the caller.

### The Watch Mechanism

The API server's watch mechanism is what makes the reconcile loop possible. Any client — including controllers, the scheduler, and the kubelet — can open a long-lived HTTP connection to the API server and watch for changes to a resource type. When an object is created, updated, or deleted, the API server sends a watch event to all active watchers. This is how the scheduler knows when a new unscheduled pod appears, and how the kubelet knows when a pod has been assigned to its node.

Watches are the circulatory system of Kubernetes. Without them, every component would need to poll the API, creating massive load. With them, changes propagate to all interested parties within milliseconds.

---

## 3. etcd: The Source of Truth

etcd is a distributed key-value store that Kubernetes uses as its sole persistent state backend. Every object in the cluster — every pod, service, configmap, secret, node registration, and custom resource — lives in etcd. If etcd is lost without a backup, the cluster's state is unrecoverable.

### What etcd Stores

Kubernetes stores objects in etcd as serialized protobuf (binary format, more efficient than JSON). The key for each object encodes its type and identity — for example, `/registry/pods/default/my-pod`. The API server translates between the REST representation clients see and the binary format etcd stores.

### MVCC and Revision Numbers

etcd uses Multi-Version Concurrency Control (MVCC) — every write creates a new revision of the object rather than overwriting the previous one. Each revision has a monotonically increasing revision number. The API server uses these revision numbers to implement **optimistic concurrency control**: when you update an object, you include its current `resourceVersion` in the request. If etcd's current version does not match (because someone else updated it concurrently), the write is rejected and you must re-fetch and retry. This prevents silent overwrites in concurrent control scenarios.

Watch connections use revision numbers to resume from a specific point. When a controller restarts, it re-establishes a watch starting from the last revision it processed, ensuring it does not miss events that occurred during the outage.

### Compaction and Storage Limits

Because etcd stores every revision, the storage grows over time. etcd periodically **compacts** old revisions — discarding historical versions beyond a retention window — to keep storage bounded. The API server triggers compaction automatically. The practical limit for etcd storage is typically 8GB (the default `--quota-backend-bytes` value); exceeding this causes etcd to enter a read-only alarm state, which stops the entire cluster from accepting new writes.

### etcd Cluster and Leader Election

In production, etcd runs as a cluster of typically 3 or 5 members for fault tolerance, using the Raft consensus protocol to agree on every write. Raft requires a quorum — a majority of members must acknowledge a write before it is committed. With 3 members, one can fail; with 5, two can fail. This is why even-numbered etcd clusters are discouraged — 4 members tolerate only 1 failure, the same as 3.

In managed Kubernetes like EKS, the etcd cluster is entirely hidden behind the managed control plane. Engineers do not interact with it directly, but its health limits directly bound API server availability.

---

## 4. The Scheduler

The scheduler (`kube-scheduler`) has one job: watch for pods that have no node assigned and decide which node each pod should run on. It does not start the pod — it writes a binding, and the kubelet on the chosen node takes it from there.

### The Scheduling Cycle

For each unscheduled pod, the scheduler runs through two phases:

**Filtering** eliminates nodes that cannot run the pod. The filter checks hard requirements: does the node have enough CPU and memory? Does it have the required labels for a nodeSelector or nodeAffinity rule? Does it have the pod's requested tolerations for any node taints? Are the required volumes accessible from this node? After filtering, only nodes that are *capable* of running the pod remain.

**Scoring** ranks the surviving nodes. Each node receives a score across multiple dimensions: how much spare capacity does it have (bin-packing vs spreading), does it satisfy soft affinity preferences, is it in the preferred zone, does it already have the pod's container image cached? The node with the highest aggregate score wins.

**Binding** is the output of scheduling. The scheduler writes a `Binding` object to the API server that records `this pod → this node`. The pod object is updated with its `nodeName` field set, and the kubelet on that node — which is watching for pods assigned to it — picks it up.

### Scheduler Extensibility

The scheduler's filter and scoring logic is pluggable via the **Scheduler Framework** — a set of extension points that allow custom logic to be injected at each phase without forking the scheduler binary. This is how features like topology spread constraints, custom resource scheduling, and GPU scheduling are implemented. Cluster operators can also run multiple schedulers in a cluster and select which one handles a pod via the `schedulerName` field in the pod spec.

### What the Scheduler Cannot Do

The scheduler does not monitor pods after placement. If a pod fails on its assigned node, the scheduler is not involved in the recovery — that is the controller manager's job (replacing the pod) and the kubelet's job (reporting the failure). The scheduler only handles the initial placement decision.

---

## 5. The Controller Manager

The controller manager (`kube-controller-manager`) is a single binary that bundles dozens of independent control loops — **controllers** — each responsible for a specific resource type. Each controller watches its resource type via the API server and reconciles the actual state toward the desired state.

### The Reconcile Pattern

Every controller follows the same pattern. The **ReplicaSet controller**, for example, watches ReplicaSet objects and the pods they own. When it sees a ReplicaSet with `replicas: 3` but only 2 matching pods, it creates a new pod. When there are 4 pods, it deletes one. It does not care how the gap appeared — a pod crashed, a node died, someone deleted a pod manually. It only cares about the current count and acts accordingly.

This statelessness is intentional. Controllers do not remember what they did last; they observe the current state fresh on every reconcile and act from first principles. This makes them resilient to restarts and network partitions — when the controller comes back, it re-observes the world and continues reconciling.

### Key Built-in Controllers

| Controller | Watches | Reconciles |
| :--- | :--- | :--- |
| ReplicaSet controller | ReplicaSets, Pods | Ensures pod count matches desired replicas |
| Deployment controller | Deployments, ReplicaSets | Manages rolling updates by creating/scaling ReplicaSets |
| StatefulSet controller | StatefulSets, Pods | Manages ordered pod creation, stable identities, and PVC binding |
| Node controller | Nodes | Marks nodes as unreachable, evicts pods from failed nodes |
| Endpoint controller | Services, Pods | Populates the Endpoints object with ready pod IPs for each Service |
| Namespace controller | Namespaces | Cleans up all resources when a namespace is deleted |
| Job controller | Jobs, Pods | Creates pods for batch work, tracks completions and failures |

### Leader Election

Because the controller manager contains stateful reconciliation logic, only one instance should be active at a time — multiple instances reconciling simultaneously could create conflicting actions. The controller manager uses **leader election** via a lease object in etcd: one instance holds the lease and runs the controllers; others standby and attempt to acquire the lease if the current holder stops renewing it. This is how active/passive HA for the control plane works without a dedicated HA framework.

---

## 6. The Kubelet

The kubelet is the node agent — the component that bridges the Kubernetes control plane and the actual container runtime on each node. It is the only control plane component that runs on worker nodes, and it is responsible for everything that happens on a node: starting pods, running health probes, reporting node status, and evicting pods when the node is under resource pressure.

### How the Kubelet Gets Work

The kubelet registers its node with the API server on startup, then opens a watch on the API server for pods assigned to its node. When the scheduler binds a pod to the node, the kubelet sees a new pod in its watch stream with `nodeName` set to its own node name. This is its trigger to start the pod.

The kubelet also reads pod specs from a local static pod directory (`/etc/kubernetes/manifests/`). Pods defined here — called **static pods** — are managed directly by the kubelet without going through the scheduler. This is how the control plane components themselves run on the control plane nodes: the API server, etcd, scheduler, and controller manager are all static pods managed by the kubelet on the control plane node.

### Pod Lifecycle Management

When the kubelet receives a pod spec, it drives the container runtime to create the pod sandbox (the shared network namespace), pull images, and start containers. It then runs the pod's lifecycle hooks and health checks continuously:

**Startup probes** run first on containers that declare them, giving slow-starting containers time to initialize before liveness checks begin. **Liveness probes** run continuously; a failed liveness probe causes the kubelet to restart the container. **Readiness probes** determine whether the container should receive traffic; a failed readiness probe removes the pod from Service endpoints without restarting it.

The kubelet reports container status back to the API server continuously, updating the pod's `status` field with container states, ready conditions, and IP address. This is how `kubectl get pods` reflects current container state.

### Node Status and Eviction

The kubelet also acts as the node's reporter. It periodically sends **node heartbeats** to the API server — updating the `Node` object's status with current resource usage, allocatable capacity, and conditions. If the node controller stops receiving heartbeats, it marks the node as `NotReady` and eventually evicts its pods.

When a node's own resources — memory, disk, process IDs — run low, the kubelet's **eviction manager** kicks in. It ranks pods by priority and resource consumption and evicts the least critical pods to reclaim resources and keep the node stable. Pods with no `PriorityClass`, large memory usage relative to their requests, and no active requests are evicted first. This is why setting accurate resource requests is an operational requirement, not just a best practice.

---

## 7. The Container Runtime Stack: CRI, containerd, runc

Between the kubelet deciding "start this container" and a process actually running on the node, there are three distinct layers of abstraction. Each layer has a well-defined interface and a clear responsibility.

### CRI: Container Runtime Interface

The **CRI** (Container Runtime Interface) is a gRPC API defined by Kubernetes that decouples the kubelet from any specific container runtime. The kubelet speaks CRI; it does not know or care whether the runtime underneath is containerd, CRI-O, or anything else. This decoupling was introduced specifically to allow Kubernetes to support multiple runtimes without modifying the kubelet code.

The CRI defines two services: **RuntimeService** for managing pod sandboxes and containers (create sandbox, start container, stop container, exec into container), and **ImageService** for managing images (pull image, list images, remove image). The kubelet calls these over a local Unix socket.

### containerd

**containerd** is the container runtime that implements the CRI interface in most modern Kubernetes deployments (including EKS). It is a daemon that manages the full container lifecycle: it receives CRI calls from the kubelet, manages image storage, creates container filesystems using its **snapshotter** (the layer stacking mechanism that builds a container's filesystem from image layers), and delegates the actual process creation to runc.

containerd's snapshotter is what makes layer caching work — it stores each image layer once and assembles a layered filesystem for each container using copy-on-write semantics. Multiple containers based on the same image share the underlying read-only layers; only the writable top layer is unique per container.

### runc

**runc** is the lowest-level component. It is a small CLI binary that takes an **OCI bundle** — a directory containing a `config.json` describing the container's configuration and a `rootfs` directory containing the container's filesystem — and creates a running Linux process with the specified namespaces and cgroup constraints. runc is the reference implementation of the OCI (Open Container Initiative) Runtime Specification.

runc does not run persistently. containerd invokes runc for each container start, runc forks the container process, and then runc exits. The container process is now a direct child of containerd (via a shim process that containerd uses to avoid direct child process dependencies). If containerd is restarted, the shim keeps the container alive.

### The Call Chain

The full chain for starting a container is:

```
kubelet → (CRI gRPC) → containerd → snapshotter (filesystem) → runc → container process
```

Each layer has a single well-defined responsibility, and each interface is stable and independently versioned. This means containerd can be upgraded without changing the kubelet, and runc can be upgraded without changing containerd — which is how container runtime CVEs are patched in production clusters without full cluster rebuilds.

---

## 8. Linux Isolation: cgroups & Namespaces

Containers are not a Linux kernel primitive — they are a combination of two independent kernel features: **namespaces** for isolation and **cgroups** for resource control. runc configures both when it starts a container process.

### Namespaces

A Linux namespace wraps a global system resource and gives a process an isolated view of it. Different namespace types isolate different things:

| Namespace | What it isolates | Container effect |
| :--- | :--- | :--- |
| `pid` | Process ID space | Container processes see only their own PIDs; PID 1 inside is the container's init process |
| `net` | Network stack | Container gets its own interfaces, routing table, and ports (the pod network namespace) |
| `mnt` | Filesystem mount points | Container sees only its own filesystem tree |
| `uts` | Hostname and domain name | Container has its own hostname independent of the node |
| `ipc` | System V IPC and POSIX message queues | Container IPC is isolated from the host and other containers |
| `user` | User and group ID mappings | Allows UID remapping (rootless containers) |

All containers in a pod share the same `net` and `ipc` namespaces — that is what allows containers in a pod to communicate over localhost and what makes the pod a cohesive networking unit. Each container has its own `pid`, `mnt`, and `uts` namespaces.

### cgroups

Control groups (cgroups) are a kernel mechanism for limiting, accounting for, and isolating the resource usage of a group of processes. When runc starts a container, it creates a cgroup hierarchy entry for the container and enforces the resource limits defined in the pod spec's `resources.limits` and `resources.requests` fields.

The key resource controllers used by Kubernetes:

- **cpu** — limits CPU time. A container with `limits.cpu: 500m` can use at most 500 millicores (half a CPU) over any scheduling period. Exceeding this causes CPU throttling, not termination.
- **memory** — limits memory usage. A container that exceeds `limits.memory` is immediately OOM-killed by the kernel. Unlike CPU throttling, memory limit violations are fatal to the container.
- **pid** — limits the number of processes a container can create. Relevant for fork bomb protection.

The distinction between `requests` and `limits` matters at the cgroup level: `requests` is what the scheduler uses for placement decisions (it treats the node as having this much reserved), while `limits` is what cgroups enforces as the hard ceiling. A container with no `limits` can consume all node resources, starving other containers — this is why setting limits is an operational necessity in multi-tenant clusters.

Kubernetes uses cgroup v2 on modern nodes (kernel 5.8+, Amazon Linux 2023, Ubuntu 22.04+). cgroup v2 has a unified hierarchy and more precise memory accounting compared to cgroup v1, but the conceptual model is the same.

---

## 9. Kubenet: The Built-in Network Plugin

Kubenet is not a CNI plugin — it is a simple, built-in network plugin implemented directly inside the kubelet. It predates the CNI specification and exists for historical and compatibility reasons. Understanding it clarifies what a CNI plugin replaces and why CNI was introduced.

### What Kubenet Does

Kubenet provides basic pod networking using the Linux bridge model. When kubenet is enabled, the kubelet itself (without invoking an external CNI binary) creates a Linux bridge (`cbr0`) on the node, creates a veth pair for each pod, attaches the node-side veth to the bridge, and assigns an IP from the node's pod CIDR to the pod-side interface.

Pod-to-pod traffic within a node flows through the bridge. Pod-to-pod traffic across nodes relies on the cloud provider or the underlying network to route packets between node pod CIDRs — kubenet does not handle cross-node routing itself. On AWS, this means static routes in the VPC route table must be programmed for each node's pod CIDR pointing to the node's instance. On GCP, a similar mechanism applies.

### Kubenet's Limitations

Kubenet has no NetworkPolicy support. It supports only a single network interface per pod. It does not support advanced IPAM. And because it relies on cloud-provider route table programming for cross-node routing, it only works in environments where that integration exists.

These limitations are why kubenet is not used in production Kubernetes clusters today. It is encountered in very old cluster configurations, in lightweight distributions like some k3s modes, or in documentation that predates CNI's ubiquity. In EKS, kubenet is never used — AWS VPC CNI is always the network plugin.

### Kubenet vs CNI

| Property | Kubenet | CNI Plugin |
| :--- | :--- | :--- |
| Implementation | Built into kubelet | External binary in `/opt/cni/bin/` |
| NetworkPolicy | No | Yes (plugin-dependent) |
| Multi-interface pods | No | Yes |
| Cross-node routing | Cloud-provider route tables only | Plugin-managed (BGP, VXLAN, ENI) |
| Pluggability | None | Full — swap plugins without kubelet changes |
| Production use | Rare, legacy | Universal |

---

## 10. Image Pull & Layer Caching

Before a container can start, its image must exist on the node. The image pull process is driven by containerd, coordinated by the kubelet, and directly affects pod startup latency.

### OCI Images and Layers

A container image is not a single file — it is a manifest that references an ordered list of **layers**, each of which is a compressed tar archive of filesystem changes. Layers are additive: each layer adds, modifies, or deletes files on top of the previous one. The final container filesystem is the union of all layers stacked in order.

This layered model is why image caching is effective. If a node already has the `ubuntu:22.04` base layer cached (because another image uses the same base), a new image that also uses `ubuntu:22.04` only needs to pull the layers that differ. In practice, nodes running similar workloads share many base layers, and only the application-specific top layers need to be pulled for each new image version.

### The Pull Process

When the kubelet instructs containerd to start a container, containerd first checks whether the image exists in its local store. If not, it pulls the image manifest from the registry, determines which layers are missing from the local store, downloads only the missing layers, and decompresses and stores them. The snapshotter then assembles the layered filesystem for the container.

The pull process is the most variable part of pod startup time. A cold node with no cached layers pulling a large image can take 30–60 seconds or more. A warm node with all layers cached starts the same container in under a second. This is one reason DaemonSets use `imagePullPolicy: IfNotPresent` — they assume the image is already on the node, having been pulled during node bootstrap.

### imagePullPolicy

The `imagePullPolicy` field on a container controls when the kubelet asks containerd to check for a fresh image:

| Policy | Behavior | When to use |
| :--- | :--- | :--- |
| `IfNotPresent` | Pull only if the image is not in the local store | Most workloads — avoids redundant pulls |
| `Always` | Always contact the registry to check for updates | Development, when using mutable tags like `latest` |
| `Never` | Never pull — fail if not present locally | Air-gapped environments, pre-pulled images |

Using `latest` as an image tag in production is an anti-pattern for two reasons: it is a mutable reference (the image it points to can change between pulls), and with `imagePullPolicy: IfNotPresent`, the kubelet will not notice the change because the tag already exists locally. Immutable image tags (typically a git SHA or build number) paired with `IfNotPresent` is the correct production pattern.

### Image Pull Secrets

Private registries require authentication. The kubelet uses **image pull secrets** — references to Kubernetes Secret objects containing registry credentials — to authenticate pull requests. These secrets are referenced in the pod spec and passed to containerd when pulling. In EKS, authentication to ECR is handled via the `ecr-credential-provider` — a kubelet credential provider plugin that fetches ECR tokens automatically using the node's IAM instance profile, so no explicit pull secret is needed for ECR images in the same account.

---

## 11. Full Pod Lifecycle: kubectl apply → Running Pod

With all components understood individually, here is how they work together from the moment a manifest is submitted to the moment a pod is running and healthy.

### Step 1 — Manifest Submission

A developer runs `kubectl apply -f deployment.yaml`. kubectl reads the kubeconfig, constructs an HTTP request to the API server, and submits the Deployment object.

### Step 2 — API Server Processing

The API server receives the request and runs it through the pipeline:

- **Authn** validates the kubeconfig credential and identifies the user.
- **Authz** checks RBAC — does this user have permission to create or update a Deployment in this namespace?
- **Admission** runs mutating webhooks (e.g., setting default resource requests if a LimitRange is configured) and then validating webhooks (e.g., checking policy compliance).
- The validated Deployment object is written to etcd. The API server returns a 200/201 response to kubectl.

### Step 3 — Deployment Controller Reacts

The Deployment controller inside the controller manager has a watch on Deployment objects. It sees the new Deployment and reconciles: no ReplicaSet exists for this Deployment yet, so it creates one with the desired `replicas` count. The ReplicaSet object is written to the API server and persisted to etcd.

### Step 4 — ReplicaSet Controller Reacts

The ReplicaSet controller sees the new ReplicaSet with `replicas: 3` and zero existing pods. It creates three Pod objects — bare pod specs with no `nodeName` assigned. These pods are written to the API server and persisted to etcd. They now exist as objects, but no container has started anywhere.

### Step 5 — Scheduler Reacts

The scheduler sees three new pods with no `nodeName`. For each pod, it runs the scheduling cycle: filters nodes by resource availability, taints/tolerations, and affinity rules; scores the remaining nodes; selects the winner. It writes a `Binding` object for each pod to the API server, which updates each pod's `nodeName` field. The pods are now assigned to nodes but still not running.

### Step 6 — Kubelet Reacts

The kubelet on each assigned node has a watch on pods assigned to its node. It sees the newly bound pod and begins the startup sequence:

- It instructs containerd (via CRI) to create the pod sandbox — the shared network namespace for the pod's containers.
- The CNI plugin is invoked to configure the pod's network namespace: a veth pair is created, an IP is assigned, and routes are installed.
- The kubelet checks whether the container images are present locally. If not, it instructs containerd to pull them from the registry.
- Once images are available, the kubelet instructs containerd to create and start each container in the pod. containerd calls runc, which creates the process with the appropriate namespaces and cgroups.

### Step 7 — Container Startup & Probes

The container process starts inside the pod's network namespace with its cgroup limits enforced. If the pod declares an `initContainer`, it runs to completion first. If a startup probe is declared, the kubelet waits for it to succeed before starting liveness and readiness probes.

### Step 8 — Status Reporting

The kubelet reports the pod's status back to the API server: the assigned IP address, the container states (waiting → running), and the pod's Ready condition. The endpoint controller sees the pod is Ready and adds its IP to the Endpoints object for any matching Service. The pod is now reachable from within the cluster.

### Step 9 — Steady State

The pod is running. The kubelet continues to run liveness and readiness probes at the configured interval. The controller manager continues to watch the ReplicaSet — if the pod fails or disappears, the ReplicaSet controller creates a replacement and the entire sequence from Step 4 repeats. No human intervention required.

### The Full Component Interaction Map

| Event | Component that acts |
| :--- | :--- |
| Manifest submitted | API Server (authn → authz → admission → etcd write) |
| Deployment created | Deployment Controller → creates ReplicaSet |
| ReplicaSet created | ReplicaSet Controller → creates Pod objects |
| Pod objects created (unscheduled) | Scheduler → assigns nodeName |
| Pod assigned to node | Kubelet → drives CRI/containerd/runc |
| Network namespace created | CNI plugin → assigns IP, installs routes |
| Container image missing | containerd → pulls from registry |
| Container started | runc → creates process with namespaces + cgroups |
| Pod Ready | Endpoint Controller → adds pod IP to Service endpoints |
| Pod fails | Kubelet → reports failure; ReplicaSet Controller → creates replacement |
