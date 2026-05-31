# Kubernetes CSI — Container Storage Interface

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The Kubernetes Storage Model](#1-the-kubernetes-storage-model) | The abstraction layers — PV, PVC, StorageClass — and the contract every storage implementation must satisfy. |
| **02** | [Linux Storage Primitives](#2-linux-storage-primitives) | Block devices, device mapper, filesystem mounts, bind mounts, and the kernel paths that underpin all CSI drivers. |
| **03** | [What CSI Is and Is Not](#3-what-csi-is-and-is-not) | The CSI specification, its three gRPC services, what it defines, and what it deliberately leaves to the driver. |
| **04** | [CSI Driver Architecture](#4-csi-driver-architecture) | Sidecars, DaemonSets, Deployments, the node plugin vs controller plugin split, and how they communicate with kubelet. |
| **05** | [End-to-End Volume Lifecycle](#5-end-to-end-volume-lifecycle) | The complete journey of a volume — from PVC creation to pod deletion — across every component and API call. |
| **06** | [Dynamic Provisioning & StorageClass](#6-dynamic-provisioning-storageclass) | How StorageClass parameters drive provisioner behavior, reclaim policies, binding modes, and topology constraints. |
| **07** | [Volume Snapshots & Cloning](#7-volume-snapshots-cloning) | The VolumeSnapshot API, how CSI drivers implement snapshot and restore, and operational patterns for backup. |
| **08** | [AWS EBS CSI Driver](#8-aws-ebs-csi-driver) | EBS volume types, the EBS CSI controller and node plugin, IAM requirements, multi-attach limits, and topology constraints. |
| **09** | [Ceph CSI — RBD and CephFS](#9-ceph-csi-rbd-and-cephfs) | How Ceph RBD maps to block volumes, CephFS for shared filesystem access, RADOS internals, and operational trade-offs. |
| **10** | [CSI Comparison & Selection Guide](#10-csi-comparison-selection-guide) | Side-by-side comparison across access modes, performance, and a decision framework for driver and volume type selection. |

---

## 1. The Kubernetes Storage Model

Kubernetes does not implement storage itself. It defines a set of API objects and a contract that any storage implementation must satisfy, then delegates the actual provisioning, attachment, and mounting to a pluggable component: the CSI driver. The model has three layers of abstraction that separate the administrator's concern (what storage exists) from the developer's concern (how much storage I need).

### The Three-Layer Abstraction

A **PersistentVolume (PV)** represents a piece of actual storage — an EBS volume, a Ceph RBD image, an NFS share. It is a cluster-scoped resource, created either manually by an administrator or automatically by a provisioner. It carries the real storage details: the volume ID, capacity, access modes, and a reference to the CSI driver that manages it.

A **PersistentVolumeClaim (PVC)** is a request for storage made by a developer or workload. It specifies how much capacity is needed, what access mode is required (ReadWriteOnce, ReadWriteMany, ReadOnlyMany), and optionally a StorageClass. The PVC is namespace-scoped — it belongs to the workload's namespace. The Kubernetes control plane binds a PVC to a matching PV, and from that point the PVC is the stable handle the pod uses to reference its storage.

A **StorageClass** defines a storage profile — a named set of provisioner parameters that determine what kind of storage is created when a PVC is dynamically provisioned. StorageClasses decouple the "what type of storage" decision from the PVC itself. A developer requests 50Gi of `fast-nvme` storage; the StorageClass carries the knowledge that `fast-nvme` means EBS gp3 with 16,000 IOPS. The developer never touches those details directly.

### Access Modes

Access modes define how a volume can be mounted across nodes. They are a contract between the PVC and the backing storage — not all drivers support all modes.

| Access Mode | Abbreviation | Meaning |
| :--- | :--- | :--- |
| ReadWriteOnce | RWO | Mounted read-write by a single node at a time |
| ReadOnlyMany | ROX | Mounted read-only by many nodes simultaneously |
| ReadWriteMany | RWX | Mounted read-write by many nodes simultaneously |
| ReadWriteOncePod | RWOP | Mounted read-write by a single pod (K8s 1.22+) |

Block storage (EBS, Ceph RBD) is inherently single-node — it supports RWO only. Shared filesystem storage (CephFS, NFS, EFS) supports RWX. Choosing the wrong access mode for the backing storage type is one of the most common storage misconfiguration errors.

### Reclaim Policies

When a PVC is deleted, the reclaim policy on the PV determines what happens to the underlying storage.

- **Delete** — the PV and the backing storage (the EBS volume, the RBD image) are deleted automatically. The default for dynamically provisioned volumes. Appropriate for stateless scratch volumes.
- **Retain** — the PV moves to a `Released` state but the backing storage is not deleted. A human must manually reclaim it. Appropriate for any data you cannot afford to lose automatically.
- **Recycle** — deprecated. Do not use.

**The silent data loss trap:** If a StorageClass is created with `reclaimPolicy: Delete` (the default) and a developer deletes their PVC, the EBS volume and all its data are gone immediately. For production databases, always use `reclaimPolicy: Retain` at the StorageClass level, or enforce it via OPA/Kyverno policy.

---

## 2. Linux Storage Primitives

CSI drivers are not magic — they are orchestrated sequences of standard Linux storage operations. Understanding these primitives is essential for debugging mount failures, I/O performance issues, and driver errors.

### Block Devices

A block device is a file in `/dev/` that provides raw byte-addressable storage: `/dev/nvme0n1`, `/dev/xvda`, `/dev/rbd0`. Block devices have no inherent filesystem structure — they are sequences of fixed-size blocks. EBS volumes appear as NVMe devices (`/dev/nvme*`) on Nitro-based EC2 instances. Ceph RBD images appear as `/dev/rbd*` devices after being mapped via the `rbd` kernel module.

The CSI node plugin's `NodeStageVolume` call is responsible for making the block device appear on the node. For EBS, this means the volume is already attached by EC2 — the driver simply finds the device path. For Ceph RBD, the driver calls `rbd map` to instruct the kernel's RBD client to connect to the Ceph cluster and expose the image as a local block device.

### Filesystems and mkfs

A block device must be formatted with a filesystem before it can be used as a directory mount. The CSI node plugin performs this operation during `NodeStageVolume` if the device is unformatted. The filesystem type is specified in the StorageClass (`fsType: ext4` or `fsType: xfs`). The driver calls `mkfs.ext4` or `mkfs.xfs` — standard Linux tools — on the raw block device.

This is a one-time operation. Once formatted, the driver detects the existing filesystem on subsequent mounts and skips formatting. The check is done via `blkid` — a standard tool that reads filesystem superblocks.

**ext4 vs xfs trade-offs:**

| Property | ext4 | xfs |
| :--- | :--- | :--- |
| Default filesystem | Yes (most Linux distros) | Often preferred for data workloads |
| Large file performance | Good | Excellent (better for >4GB files) |
| Metadata performance | Good | Better at high concurrency |
| Online shrink | Not supported | Not supported |
| Online grow | Supported | Supported |
| Recovery time | Fast (journal replay) | Fast (journal replay) |
| Max filesystem size | 1 EiB | 8 EiB |
| Best for | General purpose, databases | Databases, large sequential I/O |

### The Mount Hierarchy: Stage and Publish

Kubernetes uses a two-stage mount model for CSI volumes, corresponding to the two node-side CSI calls: `NodeStageVolume` and `NodePublishVolume`.

The **stage** path (`/var/lib/kubelet/plugins/kubernetes.io/csi/pv/<pv-name>/globalmount/`) is where the volume is mounted once per node. If the same PV is used by multiple pods on the same node, the volume is staged once and shared. This is efficient for block volumes — one filesystem mount serves multiple consumers.

The **publish** path (`/var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~csi/<pv-name>/mount/`) is a bind mount from the stage path into the specific pod's volume directory. Each pod gets its own bind mount, but they all point to the same underlying staged mount.

```
Block Device (/dev/nvme1n1)
    ↓ mkfs + mount
Stage Path (/var/lib/kubelet/plugins/.../globalmount/)
    ↓ bind mount
Publish Path (/var/lib/kubelet/pods/<uid>/volumes/.../mount/)
    ↓ bind mount (by container runtime)
Container Path (/data inside the container)
```

### Device Mapper and Encryption

When `encrypted: "true"` is specified (EBS) or block encryption is used (Ceph RBD with dm-crypt), the Linux Device Mapper creates a virtual device (`/dev/dm-N`) that transparently encrypts/decrypts data between the filesystem and the raw block device. The CSI driver is responsible for setting up the Device Mapper layer using `cryptsetup` before formatting and mounting.

---

## 3. What CSI Is and Is Not

CSI stands for Container Storage Interface. It is a specification that defines how a container orchestrator (Kubernetes, in this context) communicates with an external storage plugin. Before CSI, storage drivers were compiled directly into the Kubernetes binary — adding a new storage provider required a Kubernetes release. CSI decouples storage drivers from the orchestrator completely.

### What CSI Defines

CSI defines a gRPC API between two sides: the **CO (Container Orchestrator)** — Kubernetes — and the **CSI Plugin** — the driver. The API is divided into three gRPC services, each implemented by the driver.

**Identity Service** — every CSI plugin implements this. It exposes the driver's name, version, and capability flags. The CO calls `GetPluginInfo` to discover the driver identity and `GetPluginCapabilities` to know what features the driver supports (snapshotting, volume expansion, topology awareness).

**Controller Service** — implements volume lifecycle operations that are cluster-level, not node-level. These run in the controller plugin (a Deployment, not a DaemonSet). The key RPCs are:

| RPC | Purpose |
| :--- | :--- |
| `CreateVolume` | Provision a new volume (creates the EBS volume, the RBD image) |
| `DeleteVolume` | Deprovision a volume |
| `ControllerPublishVolume` | Attach a volume to a node (EC2 AttachVolume API call) |
| `ControllerUnpublishVolume` | Detach a volume from a node |
| `CreateSnapshot` | Create a snapshot of a volume |
| `DeleteSnapshot` | Delete a snapshot |
| `ListVolumes` | List all volumes managed by this driver |
| `ExpandVolume` | Expand a volume's capacity |

**Node Service** — implements volume operations that must run on the specific node where a pod is scheduled. These run in the node plugin (a DaemonSet). The key RPCs are:

| RPC | Purpose |
| :--- | :--- |
| `NodeStageVolume` | Mount the volume to the node's staging path |
| `NodePublishVolume` | Bind mount from staging path into the pod's path |
| `NodeUnpublishVolume` | Remove the pod's bind mount |
| `NodeUnstageVolume` | Unmount from the node's staging path and detach |
| `NodeExpandVolume` | Expand the filesystem after a volume resize |
| `NodeGetInfo` | Report node topology labels |

### What CSI Does Not Define

CSI does not define how volumes are allocated across a cluster, how topology constraints are satisfied, how access control between drivers and the Kubernetes API works, or how sidecar containers manage the communication between Kubernetes and the CSI driver. These concerns are handled by the Kubernetes CSI sidecar containers, which are maintained separately by the Kubernetes storage SIG.

---

## 4. CSI Driver Architecture

A CSI driver is not a single binary — it is a set of components that run as Kubernetes workloads, communicating with each other and with kubelet via Unix domain sockets and the Kubernetes API.

### The Controller Plugin (Deployment)

The controller plugin runs as a Deployment — typically with one or two replicas for high availability. It implements the CSI Controller Service. It does not run on every node; it runs wherever Kubernetes schedules it, communicating with the cloud provider API (AWS, Ceph) to provision and attach volumes.

The controller plugin pod contains the CSI driver binary alongside standard Kubernetes-provided sidecar containers:

- **external-provisioner** — watches for new PVCs with a matching StorageClass and calls the driver's `CreateVolume` to provision the backing storage. Creates the corresponding PV object.
- **external-attacher** — watches VolumeAttachment objects and calls `ControllerPublishVolume` / `ControllerUnpublishVolume` to attach and detach volumes from nodes.
- **external-snapshotter** — watches VolumeSnapshotContent objects and calls `CreateSnapshot` / `DeleteSnapshot`.
- **external-resizer** — watches PVCs for capacity change requests and calls `ControllerExpandVolume`.

All sidecars communicate with the driver binary via a Unix domain socket (`/csi/csi.sock` mounted as a shared volume in the pod). The sidecars make gRPC calls to the driver; the driver makes calls to the backing storage API.

### The Node Plugin (DaemonSet)

The node plugin runs as a DaemonSet — one pod per node. It implements the CSI Node Service and must run on the same node as the workload it serves, because it performs local operations like mounting filesystems and creating bind mounts.

The node plugin pod contains the CSI driver binary alongside:

- **node-driver-registrar** — registers the CSI driver with kubelet by creating a socket at `/var/lib/kubelet/plugins_registry/<driver-name>.sock`. Once registered, kubelet knows to call this driver's socket for storage operations on this node.

The node plugin has elevated privileges — it typically runs with `privileged: true` because mounting filesystems and accessing block devices are privileged operations. This is unavoidable for storage drivers.

### Communication Architecture

```
Kubernetes API Server
    ↓ watches PVC, VolumeAttachment, VolumeSnapshotContent
external-provisioner
external-attacher          → gRPC socket → CSI Driver Binary → Cloud API (EBS, Ceph)
external-snapshotter          (controller pod)
external-resizer

kubelet (on each node)
    ↓ gRPC via kubelet plugin socket
CSI Driver Binary          → Linux syscalls → block device / filesystem operations
    (node daemonset pod)
```

### Topology Support

CSI drivers that are topology-aware (like EBS CSI, which is AZ-scoped) implement `NodeGetInfo` to report topology labels (`topology.ebs.csi.aws.com/zone=ap-southeast-1a`). The `external-provisioner` uses these labels — combined with the PVC's `volumeBindingMode: WaitForFirstConsumer` — to ensure a volume is provisioned in the same AZ as the pod that will consume it.

---

## 5. End-to-End Volume Lifecycle

This section traces the complete journey of a volume from the moment a developer writes a PVC manifest to the moment the pod is deleted and the volume is reclaimed. Understanding this lifecycle end-to-end is essential for diagnosing stuck PVCs, failed mounts, and orphaned volumes.

### Phase 1 — Provisioning (PVC → PV)

A developer applies a PVC:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: payments-data
  namespace: payments
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: ebs-gp3-encrypted
  resources:
    requests:
      storage: 50Gi
```

**Step 1:** The Kubernetes API server validates and stores the PVC. Its status becomes `Pending`.

**Step 2:** If `volumeBindingMode: WaitForFirstConsumer` is set on the StorageClass, the `external-provisioner` waits. If `Immediate`, it proceeds now.

**Step 3:** `external-provisioner` detects the new PVC (via informer/watch on the API server), checks that no existing PV satisfies it, and calls the driver's `CreateVolume` gRPC.

**Step 4:** The CSI driver binary calls the backing storage API — for EBS, it calls `ec2:CreateVolume` with the parameters from the StorageClass (volume type, IOPS, encryption key). For Ceph RBD, it calls `rbd create` to create a new RBD image in the configured pool.

**Step 5:** The driver returns the new volume's ID and capacity to `external-provisioner`.

**Step 6:** `external-provisioner` creates a PV object in the Kubernetes API, referencing the volume ID and the CSI driver name.

**Step 7:** The Kubernetes PV controller binds the PVC to the PV. The PVC status becomes `Bound`.

At this point, the EBS volume exists in AWS (or the RBD image exists in Ceph), but it is not attached to any node. The pod can now be scheduled.

### Phase 2 — Scheduling

If `WaitForFirstConsumer` is used, scheduling and provisioning are interleaved:

**Step 1:** The scheduler selects a node for the pod, factoring in the PVC's topology requirements (must be in the same AZ as the volume, or for `WaitForFirstConsumer`, the volume hasn't been created yet — so the scheduler chooses the node first).

**Step 2:** The scheduler annotates the PVC with the selected node's topology. The `external-provisioner` sees this annotation and now calls `CreateVolume` with the topology constraint, ensuring the EBS volume is created in the same AZ as the chosen node.

**Step 3:** Once the PV is created and bound, the scheduler can finalize the pod placement and record the binding.

### Phase 3 — Attachment (ControllerPublishVolume)

**Step 1:** The pod is scheduled to a node. The `AD Controller` (Attach/Detach Controller, running in `kube-controller-manager`) creates a `VolumeAttachment` object.

**Step 2:** `external-attacher` watches `VolumeAttachment` objects. It sees the new one and calls the driver's `ControllerPublishVolume` gRPC, passing the volume ID and the node ID.

**Step 3:** For EBS: the driver calls `ec2:AttachVolume`, specifying the volume ID and the EC2 instance ID. AWS attaches the EBS volume to the instance. The block device appears at `/dev/nvme*` on the node within a few seconds.

**Step 4:** For Ceph RBD: `ControllerPublishVolume` is a no-op — Ceph RBD does not require a pre-attachment step at the cloud layer. The actual device mapping happens in the node plugin.

**Step 5:** The driver confirms attachment. `external-attacher` updates the `VolumeAttachment` status. The AD Controller records the attachment in the node's `volumesAttached` status.

**Step 6:** kubelet on the target node detects that the volume is marked as attached and is ready for the next phase.

### Phase 4 — Staging (NodeStageVolume)

**Step 1:** kubelet calls the node plugin's `NodeStageVolume` gRPC via the registered socket.

**Step 2:** The node plugin locates the block device. For EBS on Nitro, the device path is determined by the volume's serial number: `ls -la /dev/disk/by-id/ | grep <volume-id>`. For Ceph RBD, the driver calls `rbd map <pool>/<image>` which instructs the kernel's RBD client to connect to the Ceph monitors, authenticate, and expose the image as `/dev/rbd<N>`.

**Step 3:** The node plugin checks if the device is already formatted using `blkid`. If it is a new volume with no filesystem signature, it runs `mkfs.ext4` or `mkfs.xfs`.

**Step 4:** The node plugin creates the staging directory: `/var/lib/kubelet/plugins/kubernetes.io/csi/pv/<pv-name>/globalmount/`.

**Step 5:** The node plugin mounts the block device to the staging directory: `mount /dev/nvme1n1 /var/lib/kubelet/plugins/.../globalmount/`.

**Step 6:** kubelet records the staging completion. The volume is now mounted once on the node.

### Phase 5 — Publishing (NodePublishVolume)

**Step 1:** kubelet calls the node plugin's `NodePublishVolume` gRPC.

**Step 2:** The node plugin creates the pod-specific publish directory: `/var/lib/kubelet/pods/<pod-uid>/volumes/kubernetes.io~csi/<pv-name>/mount/`.

**Step 3:** The node plugin performs a bind mount from the staging path to the publish path: `mount --bind /var/lib/kubelet/plugins/.../globalmount/ /var/lib/kubelet/pods/<uid>/volumes/.../mount/`.

**Step 4:** kubelet passes the publish path to the container runtime (containerd). The runtime bind mounts it again into the container's filesystem at the path specified by `volumeMounts[].mountPath`.

**Step 5:** The container starts. From inside the container, the volume appears at `/data` (or whatever mountPath was configured). The container reads and writes to this path, which traverses the bind mounts all the way down to the staged filesystem on the block device.

The pod is now running with its volume. Every write goes: container → publish bind mount → stage mount → filesystem on block device → block device driver → storage backend.

### Phase 6 — Unpublishing (Pod Deletion / NodeUnpublishVolume)

**Step 1:** The pod is deleted. kubelet observes the pod deletion and begins teardown.

**Step 2:** The container runtime unmounts the container-level bind mount from the container's filesystem.

**Step 3:** kubelet calls `NodeUnpublishVolume` on the node plugin. The plugin removes the pod-specific bind mount (`umount /var/lib/kubelet/pods/<uid>/volumes/.../mount/`) and deletes the directory.

**Step 4:** If no other pods on this node are using the same PV, kubelet calls `NodeUnstageVolume`. The node plugin unmounts the staging path (`umount /var/lib/kubelet/plugins/.../globalmount/`) and cleans up the staging directory.

**Step 5:** For Ceph RBD, the node plugin calls `rbd unmap /dev/rbd<N>` to disconnect the kernel RBD client from the Ceph cluster.

### Phase 7 — Detachment (ControllerUnpublishVolume)

**Step 1:** The AD Controller detects the pod is gone and creates an intent to detach. `external-attacher` calls `ControllerUnpublishVolume`.

**Step 2:** For EBS: the driver calls `ec2:DetachVolume`. AWS detaches the EBS volume from the EC2 instance. The `/dev/nvme*` device disappears from the node.

**Step 3:** `external-attacher` deletes the `VolumeAttachment` object. The AD Controller records the detachment.

### Phase 8 — Reclamation (PVC Deletion)

**Step 1:** The developer (or controller) deletes the PVC.

**Step 2:** If `reclaimPolicy: Delete`, the `external-provisioner` calls the driver's `DeleteVolume`. For EBS: `ec2:DeleteVolume`. For Ceph RBD: `rbd rm`. The backing storage is permanently destroyed.

**Step 3:** The `external-provisioner` deletes the PV object from the Kubernetes API.

**Step 4:** If `reclaimPolicy: Retain`, the PV moves to `Released` state. The backing storage survives. An administrator must manually delete the PV (and optionally the backing storage) when ready.

### Lifecycle State Machine

| Phase | PVC State | PV State | Volume State (AWS/Ceph) |
| :--- | :--- | :--- | :--- |
| PVC created, awaiting provisioning | Pending | — | Does not exist |
| Volume provisioned, binding | Pending → Bound | Available → Bound | Created, not attached |
| Pod scheduled, attaching | Bound | Bound | Attaching |
| NodeStageVolume complete | Bound | Bound | Attached, mounted (node) |
| NodePublishVolume complete | Bound | Bound | Mounted (pod) |
| Pod deleted, unpublishing | Bound | Bound | Unmounting |
| ControllerUnpublishVolume complete | Bound | Bound | Detached |
| PVC deleted (Delete policy) | Terminating | Released → Deleted | Deleting → Gone |
| PVC deleted (Retain policy) | Deleted | Released | Exists (orphaned) |

---

## 6. Dynamic Provisioning & StorageClass

### StorageClass Anatomy

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3-encrypted
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"   # Default SC for PVCs that don't specify one
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "16000"
  throughput: "1000"
  encrypted: "true"
  kmsKeyId: arn:aws:kms:ap-southeast-1:123456789012:key/mrk-abc123   # Per-env CMK
reclaimPolicy: Retain          # Safer default for production
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer   # Provision in the pod's AZ
mountOptions:
  - noatime                    # Reduces unnecessary I/O for most workloads
  - nodiratime
```

### volumeBindingMode: The Most Important StorageClass Setting

`volumeBindingMode: Immediate` provisions and binds the PV as soon as the PVC is created, in whatever AZ the provisioner chooses. In a multi-AZ cluster, this frequently results in a volume provisioned in AZ-A while the pod eventually schedules to AZ-B — causing a `Multi-Attach error` or a pod stuck in `ContainerCreating` indefinitely.

`volumeBindingMode: WaitForFirstConsumer` delays provisioning until a pod that uses the PVC is scheduled. The provisioner then creates the volume in the same AZ as the pod. This is the only correct mode for block storage (EBS, Ceph RBD) in multi-AZ clusters.

**Always use `WaitForFirstConsumer` for block storage StorageClasses.** `Immediate` is only appropriate for storage backends that are topology-independent (NFS, CephFS with global access).

### Expanding Volumes

With `allowVolumeExpansion: true`, a PVC can be expanded by editing its `spec.resources.requests.storage`. The sequence is:

- `external-resizer` calls `ControllerExpandVolume` — the backing volume is resized (e.g., `ec2:ModifyVolume` for EBS).
- The node plugin's `NodeExpandVolume` is called when the pod next starts (or immediately if the volume is online). It runs `resize2fs` (ext4) or `xfs_growfs` (xfs) to expand the filesystem to fill the new block device size.

Volume shrinking is not supported by Kubernetes or most CSI drivers. Requesting a smaller size in the PVC spec is a no-op or an error.

---

## 7. Volume Snapshots & Cloning

### The VolumeSnapshot API

Volume snapshots are a Kubernetes extension API, not core — they require the snapshot CRDs and the snapshot controller to be installed separately from the CSI driver.

```yaml
# VolumeSnapshotClass — defines which driver handles snapshots
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: ebs-vsc
  annotations:
    snapshot.storage.kubernetes.io/is-default-class: "true"
driver: ebs.csi.aws.com
deletionPolicy: Retain    # Retain: snapshot survives VolumeSnapshot deletion
parameters:
  tagSpecification_1: "key=environment,value=prod"
```

```yaml
# VolumeSnapshot — request a snapshot of a PVC
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: payments-db-snapshot-2026-05-25
  namespace: payments
spec:
  volumeSnapshotClassName: ebs-vsc
  source:
    persistentVolumeClaimName: payments-data
```

When the `VolumeSnapshot` is created, the snapshot controller creates a `VolumeSnapshotContent` (the cluster-scoped backing object), which triggers `external-snapshotter` to call the driver's `CreateSnapshot`. For EBS, this calls `ec2:CreateSnapshot`. For Ceph RBD, it calls `rbd snap create`.

### Restoring from a Snapshot

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: payments-data-restored
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: ebs-gp3-encrypted
  resources:
    requests:
      storage: 50Gi
  dataSource:
    name: payments-db-snapshot-2026-05-25
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

The provisioner sees the `dataSource` field, calls `CreateVolume` with the snapshot ID as the source, and the driver creates a new volume pre-populated with the snapshot's data.

### Volume Cloning

Cloning creates a new PVC as a copy of an existing PVC, without going through a snapshot:

```yaml
spec:
  dataSource:
    name: payments-data       # Source PVC (must be in same namespace)
    kind: PersistentVolumeClaim
```

The driver's `CreateVolume` receives the source volume ID and creates a clone. For EBS, this is an `ec2:CreateVolume` from snapshot (AWS creates an implicit snapshot). For Ceph RBD, it uses `rbd clone` — a copy-on-write clone that shares blocks with the parent until diverged.

---

## 8. AWS EBS CSI Driver

### Overview

The AWS EBS CSI driver (`ebs.csi.aws.com`) replaces the in-tree `kubernetes.io/aws-ebs` provisioner, which was deprecated in Kubernetes 1.23 and removed in 1.27. The EBS CSI driver is the mandatory storage driver for EKS clusters running Kubernetes 1.27+.

EBS volumes are block storage — they are AZ-scoped, support RWO only, and appear as NVMe devices on Nitro-based instances. They are the right default choice for stateful workloads on EKS: databases, message brokers, stateful services with high I/O requirements.

### IAM Requirements

The EBS CSI driver must call EC2 APIs to create, attach, detach, and delete volumes. It authenticates via an IAM Role attached to the controller pod using IRSA (IAM Roles for Service Accounts).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVolume",
        "ec2:DeleteVolume",
        "ec2:AttachVolume",
        "ec2:DetachVolume",
        "ec2:ModifyVolume",
        "ec2:DescribeVolumes",
        "ec2:DescribeVolumeStatus",
        "ec2:DescribeInstances",
        "ec2:DescribeAvailabilityZones",
        "ec2:CreateSnapshot",
        "ec2:DeleteSnapshot",
        "ec2:DescribeSnapshots",
        "ec2:CreateTags",
        "ec2:DeleteTags"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:CreateGrant",
        "kms:ListGrants",
        "kms:RevokeGrant",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:ap-southeast-1:123456789012:key/mrk-abc123"
    }
  ]
}
```

### EBS Volume Types and When to Use Them

| Volume Type | IOPS | Throughput | Latency | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **gp3** | Up to 16,000 (configurable) | Up to 1,000 MB/s | Single-digit ms | Default. Most databases, general workloads |
| **gp2** | Up to 16,000 (burst-based) | Up to 250 MB/s | Single-digit ms | Legacy. Prefer gp3 in all new StorageClasses |
| **io2 Block Express** | Up to 256,000 | Up to 4,000 MB/s | Sub-ms | High-performance databases (Oracle, SQL Server, Cassandra) |
| **io1** | Up to 64,000 | Up to 1,000 MB/s | Sub-ms | Legacy provisioned IOPS. Prefer io2 |
| **st1** | N/A | Up to 500 MB/s | High | Sequential big-data, Kafka log segments |
| **sc1** | N/A | Up to 250 MB/s | High | Cold storage, infrequent access |

**gp3 is the correct default.** Unlike gp2, gp3 decouples IOPS and throughput from volume size — you can have a 10Gi gp3 volume with 10,000 IOPS, which is impossible on gp2 without over-provisioning size.

### StorageClass Examples

```yaml
# Default general purpose
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  encrypted: "true"
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true

---
# High-performance for databases
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-io2-high-perf
provisioner: ebs.csi.aws.com
parameters:
  type: io2
  iopsPerGB: "50"         # 50 IOPS per GB — 500 IOPS for a 10Gi volume
  encrypted: "true"
  kmsKeyId: arn:aws:kms:ap-southeast-1:123456789012:key/mrk-abc123
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

### EBS CSI Deployment

```yaml
# Helm install — the recommended installation method for EKS
# values for aws-ebs-csi-driver chart

controller:
  replicaCount: 2
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/ebs-csi-driver-role

  # Schedule controller pods on dedicated infrastructure nodes
  nodeSelector:
    node-role: platform
  tolerations:
    - key: node-role
      value: platform
      effect: NoSchedule

node:
  tolerateAllTaints: false   # Only tolerate taints you explicitly define
  tolerations:
    - operator: Exists        # Node plugin must run everywhere — tolerate all taints

storageClasses:
  - name: ebs-gp3
    annotations:
      storageclass.kubernetes.io/is-default-class: "true"
    parameters:
      type: gp3
      encrypted: "true"
    reclaimPolicy: Retain
    volumeBindingMode: WaitForFirstConsumer
    allowVolumeExpansion: true

volumeSnapshotClasses:
  - name: ebs-vsc
    parameters: {}
    deletionPolicy: Retain
```

### EBS-Specific Limitations and Gotchas

**AZ affinity is hard.** An EBS volume exists in exactly one AZ. If a StatefulSet pod is evicted from AZ-A and rescheduled to AZ-B, it cannot access its EBS volume. The pod will be stuck in `ContainerCreating` until it is rescheduled back to AZ-A. Mitigate with `topologySpreadConstraints` pinning pods to AZs, or use StatefulSet with `podManagementPolicy: Parallel` and explicit AZ spread.

**Volume attachment limits per instance.** Each EC2 instance type has a maximum number of EBS volumes that can be attached simultaneously. The limit varies: `m5.large` supports up to 25 attachments; larger instances support more. The EBS CSI driver does not enforce this limit — pods will fail to schedule if the node is at capacity. Monitor attachment counts via CloudWatch `VolumeQueueLength`.

**Detachment timing on spot interruptions.** When a Spot Instance is interrupted, it has a 2-minute notice. EBS volume detachment during that window may not complete cleanly, leaving the volume in a `detaching` state. Force-detach is sometimes required. Use `--force` on the EC2 `detach-volume` API when the instance is confirmed terminated.

**Multi-Attach (io1/io2 only).** EBS io1 and io2 volumes support Multi-Attach — the same volume attached to multiple instances simultaneously. Kubernetes exposes this as `ReadWriteMany` on EBS, but only with `accessMode: ReadWriteOncePod` semantics per pod. This is not a shared filesystem: two pods writing to the same block device without a cluster-aware filesystem (GFS2, OCFS2) will corrupt data. Multi-Attach on EBS is for specialized HA database configurations only.

---

## 9. Ceph CSI — RBD and CephFS

### Ceph Architecture Primer

Before understanding Ceph CSI, the underlying Ceph architecture must be clear. Ceph is a unified distributed storage system that presents three storage interfaces — block (RBD), filesystem (CephFS), and object (RGW) — all backed by the same distributed storage engine: RADOS.

**RADOS** (Reliable Autonomic Distributed Object Store) is the foundation. It is a cluster of OSD (Object Storage Daemon) processes, each managing a physical disk or partition. Data is distributed across OSDs using a deterministic algorithm called CRUSH (Controlled Replication Under Scalable Hashing). Every object is replicated (typically 3 copies) or erasure-coded across OSDs. Monitor daemons maintain the cluster map — which OSDs are up, which are down, where data lives.

**Ceph RBD** (RADOS Block Device) stripes a block device image across RADOS objects. A 50Gi RBD image is striped into 4MiB objects distributed across the OSD pool. The kernel's `rbd` module or the `librbd` library provides a block device interface on top of these RADOS objects.

**CephFS** is a POSIX-compliant distributed filesystem built on RADOS. Metadata (directory structure, file attributes) is managed by one or more MDS (Metadata Server) daemons. File data is striped across RADOS as objects. CephFS provides true shared read-write access across multiple nodes simultaneously.

### Ceph CSI Driver Components

The Ceph CSI driver (`rbd.csi.ceph.com` and `cephfs.csi.ceph.com`) runs two parallel sets of controller and node components — one for RBD and one for CephFS — because the two storage backends have fundamentally different characteristics and require different kernel operations.

```
ceph-csi-rbd-controller (Deployment)
  ├── csi-provisioner
  ├── csi-attacher
  ├── csi-snapshotter
  ├── csi-resizer
  └── csi-rbdplugin (driver binary)

ceph-csi-rbd-nodeplugin (DaemonSet)
  ├── node-driver-registrar
  ├── csi-rbdplugin (driver binary)
  └── liveness probe

ceph-csi-cephfs-controller (Deployment)
  ├── csi-provisioner
  ├── csi-resizer
  └── csi-cephfsplugin (driver binary)

ceph-csi-cephfs-nodeplugin (DaemonSet)
  ├── node-driver-registrar
  ├── csi-cephfsplugin
  └── liveness probe
```

### Ceph CSI Configuration

Ceph CSI requires a ConfigMap describing the Ceph cluster endpoints and a Secret with Ceph credentials:

```yaml
# ConfigMap: Ceph cluster connection details
apiVersion: v1
kind: ConfigMap
metadata:
  name: ceph-csi-config
  namespace: ceph-csi
data:
  config.json: |
    [
      {
        "clusterID": "b9127830-b0cc-4e34-aa47-9d1a2e9949a8",
        "monitors": [
          "10.10.0.10:6789",
          "10.10.0.11:6789",
          "10.10.0.12:6789"
        ],
        "cephFS": {
          "subvolumeGroup": "kubernetes"
        }
      }
    ]
```

```yaml
# Secret: Ceph admin credentials (for provisioning)
apiVersion: v1
kind: Secret
metadata:
  name: ceph-admin-secret
  namespace: ceph-csi
stringData:
  userID: admin
  userKey: AQDu/mBloc6LExAAnkasdfExampleKeyHere==
```

### Ceph RBD — Block Storage

RBD provides RWO block storage with thin provisioning, snapshots, and cloning. It is the correct choice for databases, stateful applications, and any workload requiring consistent low-latency block I/O from a single pod.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-rbd-ssd
provisioner: rbd.csi.ceph.com
parameters:
  clusterID: b9127830-b0cc-4e34-aa47-9d1a2e9949a8
  pool: kubernetes-ssd         # The Ceph pool to provision images in
  imageFeatures: layering,fast-diff,object-map,deep-flatten
  # imageFeatures explanation:
  #   layering:     required for cloning/snapshots
  #   fast-diff:    efficient diff computation for incremental snapshots
  #   object-map:   tracks which RADOS objects are allocated (speeds up operations)
  #   deep-flatten: required for fully independent clones
  csi.storage.k8s.io/provisioner-secret-name: ceph-admin-secret
  csi.storage.k8s.io/provisioner-secret-namespace: ceph-csi
  csi.storage.k8s.io/node-stage-secret-name: ceph-admin-secret
  csi.storage.k8s.io/node-stage-secret-namespace: ceph-csi
  csi.storage.k8s.io/controller-expand-secret-name: ceph-admin-secret
  csi.storage.k8s.io/controller-expand-secret-namespace: ceph-csi
reclaimPolicy: Retain
allowVolumeExpansion: true
volumeBindingMode: Immediate   # Ceph is not AZ-scoped; Immediate is fine
```

**RBD image features gotcha.** Not all image features are supported by all kernel versions. `object-map` and `fast-diff` require kernel 5.x in some configurations. The driver falls back gracefully, but a mismatch between declared features and kernel support causes `NodeStageVolume` to fail with a cryptic kernel error. Check `/proc/version` and the `rbd` kernel module version before enabling advanced features on older node images.

**NodeStageVolume for RBD — what happens on the node:**

```bash
# The node plugin executes approximately these operations:
rbd map kubernetes-ssd/csi-vol-abc123 \
  --id admin \
  --keyfile /tmp/ceph-key \
  --mon-host 10.10.0.10:6789,10.10.0.11:6789,10.10.0.12:6789

# Returns: /dev/rbd0

# If new volume (no filesystem):
mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0 /dev/rbd0

# Mount to staging path:
mount /dev/rbd0 /var/lib/kubelet/plugins/.../globalmount/
```

### Ceph RBD Snapshots

RBD snapshots are crash-consistent point-in-time copies of an RBD image. They are implemented as copy-on-write in RADOS — the snapshot records which objects were present at the snapshot moment, and subsequent writes to the original image are written to new RADOS objects, leaving the snapshot's objects unchanged.

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: ceph-rbd-vsc
driver: rbd.csi.ceph.com
deletionPolicy: Retain
parameters:
  clusterID: b9127830-b0cc-4e34-aa47-9d1a2e9949a8
  csi.storage.k8s.io/snapshotter-secret-name: ceph-admin-secret
  csi.storage.k8s.io/snapshotter-secret-namespace: ceph-csi
```

**RBD clone hierarchy.** When a PVC is restored from a snapshot, Ceph creates a clone — an RBD image that shares RADOS objects with its parent snapshot via copy-on-write. Clones depend on their parent snapshot, which depends on the original image. You cannot delete the original image while clones exist. Flattening a clone (`rbd flatten`) breaks this dependency by copying all shared objects into the clone, making it fully independent — at the cost of time and storage.

Production recommendation: use `imageFeatures: deep-flatten` in the StorageClass so that the CSI driver automatically flattens clones during `DeleteVolume`, preventing orphaned snapshot chains.

### CephFS — Shared Filesystem Storage

CephFS provides RWX storage — true shared read-write access from multiple pods simultaneously, on multiple nodes. It is the correct choice for shared configuration, media storage, log aggregation, and any workload requiring `ReadWriteMany`.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: cephfs-shared
provisioner: cephfs.csi.ceph.com
parameters:
  clusterID: b9127830-b0cc-4e34-aa47-9d1a2e9949a8
  fsName: cephfs              # The CephFS filesystem name
  pool: cephfs-data           # The data pool
  rootPath: /volumes/kubernetes   # Root path in CephFS for subvolumes
  csi.storage.k8s.io/provisioner-secret-name: ceph-admin-secret
  csi.storage.k8s.io/provisioner-secret-namespace: ceph-csi
  csi.storage.k8s.io/node-stage-secret-name: ceph-admin-secret
  csi.storage.k8s.io/node-stage-secret-namespace: ceph-csi
reclaimPolicy: Retain
allowVolumeExpansion: true
volumeBindingMode: Immediate
```

**How CephFS subvolumes work.** When a PVC is created, the Ceph CSI driver calls `ceph fs subvolume create` to create a dedicated subvolume (an isolated directory with its own quota) inside the CephFS filesystem. Each PVC gets its own subvolume — isolation is enforced at the MDS level. The node plugin mounts just the subvolume path, not the entire CephFS root.

**NodeStageVolume for CephFS — what happens on the node:**

```bash
# CephFS mount via kernel client:
mount -t ceph 10.10.0.10:6789,10.10.0.11:6789:/volumes/kubernetes/<subvolume-path> \
  /var/lib/kubelet/plugins/.../globalmount/ \
  -o name=admin,secretfile=/tmp/ceph-key,_netdev,noatime

# Or via FUSE client (ceph-fuse, for kernels without CephFS support):
ceph-fuse /var/lib/kubelet/plugins/.../globalmount/ \
  --id=admin \
  --keyfile=/tmp/ceph-key \
  --conf=/etc/ceph/ceph.conf \
  --client-mountpoint=/volumes/kubernetes/<subvolume-path>
```

**Kernel client vs FUSE client.** The kernel CephFS client (`mount -t ceph`) is significantly faster than the FUSE client (`ceph-fuse`) — kernel client avoids the user-space/kernel-space context switching overhead. However, the kernel client requires a sufficiently recent kernel with CephFS support matching the Ceph cluster version. On Kubernetes nodes running Amazon Linux 2 with older kernels, the FUSE client may be the only option. Always prefer the kernel client when available.

### Ceph CSI Operational Trade-offs

| Property | Ceph RBD | CephFS |
| :--- | :--- | :--- |
| Access Mode | RWO only | RWX, RWO, ROX |
| Protocol | RADOS block (kernel rbd module) | CephFS kernel or FUSE client |
| Performance | Excellent (direct RADOS, single writer) | Good (MDS metadata overhead) |
| Snapshots | Yes — copy-on-write in RADOS | Yes — CephFS snapshot directories |
| Cloning | Yes — COW clone, flatten supported | Limited |
| Quota enforcement | Image size enforced at RADOS | Subvolume quota via MDS |
| Multi-pod write | No — block device, single node | Yes — POSIX shared filesystem |
| Failure domain | RADOS replication across OSDs | MDS availability + RADOS |
| MDS dependency | No | Yes — MDS must be available |

**CephFS MDS as a single point of dependency.** CephFS depends on the MDS for all metadata operations (directory listing, file creation, renames). In an active-standby MDS configuration, MDS failover can take 5–30 seconds, during which metadata operations from all CephFS clients are stalled. For latency-sensitive workloads that do heavy metadata operations (many small file creates, lots of `stat()` calls), RBD with a local filesystem is often more predictable.

---

## 10. CSI Comparison & Selection Guide

### Feature Comparison

| Property | AWS EBS CSI | Ceph RBD CSI | CephFS CSI |
| :--- | :--- | :--- | :--- |
| Access Modes | RWO, RWOP | RWO | RWX, RWO, ROX |
| Protocol | NVMe (EC2 attachment) | Kernel RBD module | CephFS kernel / FUSE |
| Topology-aware | Yes — AZ-scoped | No — global | No — global |
| Snapshots | Yes (EC2 snapshots) | Yes (RADOS COW) | Yes (CephFS snaps) |
| Volume cloning | Yes | Yes (COW clone) | Limited |
| Online expansion | Yes | Yes | Yes |
| Encryption | AWS-managed or CMK | dm-crypt (in-kernel) | In-transit TLS, at-rest via OSD |
| Max volume size | 64 TiB | Pool size limit | Filesystem size limit |
| Reclaim automation | Full (Delete policy) | Full | Full |
| Multi-writer | No (io2 Multi-Attach only, specialist) | No | Yes |
| Cloud dependency | AWS EC2 API | Ceph cluster | Ceph cluster + MDS |
| On-premises support | No | Yes | Yes |
| EKS integration | Native (managed add-on) | Manual Helm install | Manual Helm install |
| Latency profile | Single-digit ms | Low (RADOS direct) | Moderate (MDS metadata) |

### Decision Framework

**Choose AWS EBS CSI when** the cluster runs on EKS, workloads are single-writer (databases, stateful services), and tight AWS integration (KMS encryption, IAM, EC2 snapshot lifecycle) is valuable. EBS CSI is the zero-operational-overhead choice for AWS-native clusters — AWS manages the storage backend entirely.

**Choose Ceph RBD CSI when** the cluster runs on-premises or in a private cloud with a Ceph cluster, workloads need consistent block storage with snapshot and clone capabilities, and RWO access is sufficient. RBD provides comparable performance to EBS with full on-premises control.

**Choose CephFS CSI when** workloads require RWX shared storage — multiple pods on multiple nodes writing to the same volume simultaneously. CephFS is the most capable shared filesystem option for Kubernetes: POSIX-compliant, quota-enforced, snapshotable, and scalable.

**Do not use EBS for RWX.** EBS does not support genuine multi-node shared writes. If a workload requires RWX, the correct choices are CephFS, Amazon EFS (via the `efs.csi.aws.com` driver), or NFS.

| Scenario | Recommended Driver |
| :--- | :--- |
| EKS, single-writer database (Postgres, MySQL, Redis) | EBS CSI — gp3 with `WaitForFirstConsumer` |
| EKS, high-performance database (Cassandra, Oracle) | EBS CSI — io2 with provisioned IOPS |
| EKS, shared config/media across pods | EFS CSI — or CephFS if Ceph is available |
| On-prem / bare metal, single-writer stateful | Ceph RBD CSI |
| On-prem / bare metal, shared read-write filesystem | CephFS CSI |
| On-prem, mixed block + shared in one cluster | Ceph RBD + CephFS CSI (run both) |
| EKS, backup and cross-region restore via snapshots | EBS CSI with VolumeSnapshotClass |
| High pod density, many small volumes | Ceph RBD (no per-node attachment limit) |