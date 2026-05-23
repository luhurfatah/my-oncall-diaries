# Kubernetes (K8s) Interview Questions & Explanation

## Common Interview Questions

### Q1: What are the main components of the Kubernetes Control Plane and Worker Nodes?
Kubernetes architecture is split into the **Control Plane** (manages the cluster state) and **Worker Nodes** (run applications):
- **Control Plane Components:**
  - **kube-apiserver:** The entry point for all administrative tasks. Exposes the Kubernetes API.
  - **etcd:** Consistent, highly available key-value store containing all cluster configuration data.
  - **kube-scheduler:** Watches for newly created pods with no assigned node, and selects a node for them to run on based on resources and constraints.
  - **kube-controller-manager:** Runs controller processes (like Node, ReplicaSet, and Endpoint controllers) to maintain the desired cluster state.
  - **cloud-controller-manager:** Integrates with underlying cloud provider APIs (e.g., AWS, GCP).
- **Worker Node Components:**
  - **kubelet:** An agent running on each node that ensures containers are running in a Pod according to the PodSpecs.
  - **kube-proxy:** Network proxy that maintains network rules on nodes, enabling communication to Pods from inside or outside the cluster.
  - **Container Runtime:** Software responsible for running containers (e.g., containerd, Docker).

### Q2: What is the difference between a Pod, a ReplicaSet, and a Deployment?
- **Pod:** The smallest deployable unit in Kubernetes. It represents a single running process and can contain one or more containers that share network, storage, and specifications on how to run. Pods are ephemeral.
- **ReplicaSet:** Ensures that a specified number of identical Pod replicas are running at any given time. If a Pod crashes or is deleted, the ReplicaSet spins up a new one.
- **Deployment:** A higher-level abstraction that manages ReplicaSets and provides declarative updates to Pods. It supports rollback capabilities, zero-downtime rolling updates, and scaling of applications. You should almost always use Deployments instead of creating Pods or ReplicaSets directly.

### Q3: Explain the different Kubernetes Service types.
A **Service** provides a stable network endpoint to access a logical set of Pods. The main types are:
- **ClusterIP (Default):** Exposes the service on a cluster-internal IP. The service is only accessible within the cluster.
- **NodePort:** Exposes the service on each Node's IP at a static port (usually in the range 30000-32767). It routes traffic to the service, enabling external access without a load balancer.
- **LoadBalancer:** Exposes the service externally using a cloud provider's load balancer (e.g., AWS ELB). Automatically provisions a NodePort and ClusterIP.
- **ExternalName:** Maps a service to a DNS name (CNAME record) instead of using selectors to direct traffic to Pods.

### Q4: What is Kubernetes Ingress and how does it differ from a LoadBalancer Service?
- **LoadBalancer Service:** Provisions a dedicated load balancer for *each* service you expose. This can quickly become expensive and hard to manage if you have dozens of microservices.
- **Ingress:** An API object that manages external access to services, typically HTTP/HTTPS. It acts as an entry point/reverse proxy that routes traffic to multiple services based on hostnames or URL paths (e.g., `app.example.com/api` goes to service A, `/web` goes to service B). It requires an **Ingress Controller** (like NGINX, Traefik, or Istio) to function. Ingress consolidation allows using a single load balancer for multiple services.

### Q5: How do you handle storage in Kubernetes? Explain PV, PVC, and StorageClass.
- **PersistentVolume (PV):** A piece of storage in the cluster that has been provisioned by an administrator or dynamically provisioned using Storage Classes. It is a cluster resource, independent of any individual Pod.
- **PersistentVolumeClaim (PVC):** A request for storage by a user/Pod. It is similar to a Pod consuming node resources; a PVC consumes PV resources. It specifies size, access modes (e.g., ReadWriteOnce, ReadWriteMany), and storage classes.
- **StorageClass (SC):** Allows administrators to describe the "classes" of storage they offer (e.g., fast SSD vs. cheap HDD). It enables dynamic provisioning of PVs when a PVC is requested, so administrators don't have to manually pre-provision storage.

### Q6: What are Liveness, Readiness, and Startup Probes?
Kubernetes uses probes to monitor the health of containers in a Pod:
- **Liveness Probe:** Determines if a container is still running. If the liveness probe fails, the kubelet kills the container and restarts it according to its restart policy.
- **Readiness Probe:** Determines if a container is ready to accept network traffic. If the readiness probe fails, the endpoints controller removes the Pod's IP address from all Services, preventing traffic from reaching it.
- **Startup Probe:** Determines if the application within the container has started up. All other probes are disabled until the startup probe succeeds, which is useful for slow-starting legacy applications.

---

## Kubernetes Topic Explanation

### What is Kubernetes?
Kubernetes (often abbreviated as **K8s**) is an open-source container orchestration platform originally designed by Google. It automates the deployment, scaling, management, and networking of containerized applications.

### Core Philosophy: Declarative State & Reconciliation Loop
Kubernetes operates on a declarative configuration model:
1. **Declare the Desired State:** The user writes a YAML manifest detailing how the application should run (e.g., "I want 3 replicas of the frontend container").
2. **Reconciliation Loop:** The Kubernetes controllers continuously monitor the active cluster state and compare it to the desired state. If a node fails and the number of active pods drops to 2, the controller automatically schedules a new pod to restore the count to 3.

### Essential Concepts

#### 1. Pod Communication & Networking
Every Pod in Kubernetes gets its own unique IP address. All containers within a single Pod share the same network namespace, meaning they communicate with each other over `localhost` on different ports. Pods communicate with other Pods in the cluster directly using their IPs without NAT, facilitated by a Container Network Interface (CNI) plugin like Calico, Flannel, or VPC-CNI.

#### 2. Declarative Config Management
- **ConfigMaps:** Used to store non-sensitive configuration data in key-value pairs (e.g., config files, environment names).
- **Secrets:** Used to store sensitive data like passwords, OAuth tokens, and SSH keys. They are Base64 encoded but **not** encrypted by default in etcd without additional configuration.
- Both ConfigMaps and Secrets can be injected into containers as environment variables or mounted as files inside volumes.

#### 3. Scaling & Resource Management
Kubernetes allows you to manage resources per container using:
- **Limits:** The maximum amount of CPU or Memory a container is allowed to consume.
- **Requests:** The guaranteed amount of CPU or Memory allocated to a container. The scheduler uses requests to find a suitable node with enough capacity.
- **Horizontal Pod Autoscaler (HPA):** Dynamically scales the number of Pods up or down based on CPU utilization or custom metrics.
- **Cluster Autoscaler:** Automatically adjusts the size of the Kubernetes cluster (adding or removing worker nodes) when there are unschedulable Pods due to lack of resources.
