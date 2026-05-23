# IaC Paradigms, Concepts, & Philosophies

This document covers the high-level paradigms, design philosophies, and architectural patterns of Infrastructure as Code (IaC).

---

## 1. Core Philosophies

### Declarative vs. Imperative IaC
- **Declarative (e.g., Terraform, CloudFormation, Kubernetes):** You declare the *desired end state* of the infrastructure. The IaC tool calculates the difference between current state and desired state, and executes only the necessary API calls to reconcile them.
  - *Example:* "I want an S3 bucket with versioning enabled." If it exists but versioning is disabled, the tool just enables versioning.
- **Imperative (e.g., AWS CLI, Bash, Ansible to an extent):** You write step-by-step commands to achieve the state.
  - *Example:* "Step 1: Check if bucket exists. Step 2: If not, run create-bucket. Step 3: Run put-bucket-versioning."
  - *Downside:* Requires the developer to manually write complex routing, ordering, and dependency logic.

---

### Cattle vs. Pets in Infrastructure
- **Pets:** Servers that are individually built, named, and cared for. When they break, engineers log in to troubleshoot and repair them. This leads to configuration drift and makes scale-out difficult.
- **Cattle:** Servers built to standard templates (AMIs/Images). They are identical, disposable, and identified by numbers (e.g., `web-01`, `web-02`). If a server becomes unhealthy or needs a patch, it is terminated and replaced by a fresh, newly built instance.

---

### Immutable Infrastructure
Instead of logging into running servers to patch configurations or upgrade packages (mutable configuration), you build a new machine image (e.g., using Packer) and deploy it to replace the old running server (immutable deployment).
- **Benefits:** Ensures environment parity, eliminates configuration drift, and allows for clean, automated rollbacks.

---

## 2. Infrastructure Delivery Concepts

### GitOps for Infrastructure
Extending GitOps to infrastructure management. Infrastructure manifests (e.g., Terraform or Crossplane configs) are stored in Git, which serves as the single source of truth.
- **Pull-Based Reconciliation:** Controllers like Crossplane or ArgoCD watch the Git repo and automatically update cloud resources, continuously correcting any drift.
- **Push-Based Pipelines:** Merging to `main` triggers a CI/CD runner (GitHub Actions, GitLab CI, Atlantis) to run `terraform apply`.

---

### Code vs. Configuration
- **Application Code:** Reusable modules, libraries, and logic blocks that define *how* resources behave (written in HCL, OpenTofu, Pulumi).
- **Environment Configuration:** Specific variables, inputs, and environment keys that define *what* resources to provision in a specific instance (e.g., Dev, Staging, Prod values).
- **Golden Rule:** Keep application code (modules) strictly separated from environment configuration.

---

## 3. Architecture & Blast Radius

### Blast Radius Isolation
The amount of damage that can be caused by a single failed execution or security breach.
- **Monolithic State:** Putting all infrastructure (VPC, databases, EKS, DNS) in one massive state file. A single state corruption or credential leak can destroy the entire business.
- **Decoupled State:** Splitting infrastructure by **environment** (Dev, Staging, Prod) and **layer** (Core Networking, Database, Compute, Applications). If the application deployment fails, it cannot affect the network layer.

---

### Shared State vs. Remote State Data Sources
- In a decoupled architecture, modules need to share information (e.g., EKS needs the VPC ID).
- Avoid copy-pasting values. Instead, expose outputs from the producer module and read them dynamically in the consumer module using a **remote state data source** or **parameter store**.
