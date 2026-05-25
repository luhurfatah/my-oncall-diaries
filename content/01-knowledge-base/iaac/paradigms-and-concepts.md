# IaC Paradigms, Concepts, & Philosophies

High-level paradigms, design philosophies, and architectural patterns of Infrastructure as Code. Covers declarative vs imperative models, immutability, GitOps delivery patterns, state management, and blast radius isolation strategies.

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Core Philosophies](#1-core-philosophies) | Declarative vs imperative models, cattle vs pets, and immutable infrastructure. |
| **02** | [Infrastructure Delivery Concepts](#2-infrastructure-delivery-concepts) | GitOps patterns, push vs pull reconciliation, and separating code from configuration. |
| **03** | [Architecture & Blast Radius](#3-architecture--blast-radius) | State isolation strategies, decoupled layering, and sharing outputs across module boundaries. |

---

## 1. Core Philosophies

### Declarative vs Imperative IaC

The most fundamental split in IaC tooling is between declarative and imperative models. Understanding the difference — and why declarative wins at scale — shapes every other decision in how you design and operate infrastructure.

**Declarative tools** (Terraform, CloudFormation, Kubernetes manifests) ask you to describe the *desired end state* of your infrastructure. The tool owns the reconciliation loop: it compares what you declared against what currently exists, calculates the delta, and executes only the API calls needed to close the gap.

**Imperative tools** (AWS CLI scripts, Bash, Ansible in procedural mode) ask you to write the *steps* to achieve a state. You own the logic — checking whether resources exist, handling failures, managing ordering and dependencies. This is flexible but doesn't scale.

| Property | Declarative | Imperative |
| :--- | :--- | :--- |
| You define | Desired end state | Step-by-step instructions |
| Dependency resolution | Handled by the tool | Written manually by you |
| Idempotency | Built-in | Must be coded explicitly |
| Drift detection | Native (plan/diff) | Not possible without custom logic |
| Examples | Terraform, CloudFormation, Pulumi | AWS CLI, Bash, Ansible (procedural) |

**Declarative in practice:** To enable versioning on an S3 bucket, you declare `versioning = enabled`. If the bucket already exists but versioning is off, the tool enables it. If the bucket doesn't exist, it creates it with versioning on. You don't write a single conditional.

**Imperative in practice:** The equivalent script must check if the bucket exists, branch on the result, call `create-bucket` if absent, then call `put-bucket-versioning` regardless. Every edge case you miss becomes a production incident.

The practical cost of imperative IaC only becomes visible at scale. Managing 10 resources imperatively is manageable. Managing 500 resources across three environments and four regions imperatively is chaos — dependency ordering bugs, race conditions, and non-idempotent scripts that partially apply on re-run.

---

### Cattle vs Pets in Infrastructure

This mental model, coined in the early cloud era, describes two fundamentally different relationships engineers can have with their servers. It remains the clearest way to explain why IaC exists at all.

**Pets** are servers that are individually named, hand-built, and nursed back to health when something goes wrong. Engineers log in, troubleshoot, and apply fixes directly to the running machine. The server accumulates history — packages installed ad hoc, config files edited by hand, services started and forgotten. Over time, no two servers are truly identical even if they started from the same base.

**Cattle** are servers built from a standard template (an AMI, a container image, a Launch Template). They are identical, numbered rather than named, and entirely disposable. When a cattle server becomes unhealthy, degraded, or needs a change applied, it is terminated and replaced by a freshly built instance from the updated template. The fix happens in the template, not on the running machine.

| Property | Pets | Cattle |
| :--- | :--- | :--- |
| Identity | Named, unique | Numbered, interchangeable |
| On failure | Log in and repair | Terminate and replace |
| Configuration drift | Inevitable | Eliminated by design |
| Scaling | Hard — each new server is manual work | Trivial — clone the template |
| IaC compatibility | Poor — state lives on the machine | Native — state lives in the template |

The cattle model is what makes IaC, auto-scaling, and CI/CD pipelines possible. If your servers are pets, you can't automate their lifecycle — each one is a snowflake with undocumented history. If they're cattle, any pipeline can build, deploy, and replace them safely.

---

### Immutable Infrastructure

Immutable infrastructure takes the cattle model to its logical conclusion. Instead of applying changes to running servers — patching packages, updating config files, restarting services — you build a *new* machine image incorporating the change and deploy it to replace the old instances. The running servers are never modified after launch.

The canonical tool for this is **Packer**, which bakes AMIs with all dependencies, config, and application artifacts pre-installed. When a change is needed, a new AMI is built, validated, and promoted through environments. Existing instances are replaced by new ones launched from the updated AMI.

**Benefits of immutable infrastructure:**

- **Environment parity:** Dev, staging, and prod all run from the same tested artifact. There is no "it works on my machine" — the machine is the artifact.
- **Elimination of configuration drift:** Running servers cannot diverge from the declared state because they are never modified after launch.
- **Clean rollbacks:** Rolling back means deploying the previous AMI version. There is no "undo" command to reverse a partial configuration change — you just re-deploy the known-good image.
- **Simplified incident response:** When a server behaves unexpectedly, the correct response is terminate and replace, not investigate and patch. The investigation happens against the image build process, not the live server.

The tradeoff is deployment speed. Baking a new AMI takes minutes; `apt upgrade` on a running server takes seconds. For most production workloads, the correctness and reliability gains are worth it.

---

## 2. Infrastructure Delivery Concepts

### GitOps for Infrastructure

GitOps is the practice of using a Git repository as the single source of truth for both desired state and change history. Originally coined in the context of Kubernetes, it applies equally well to cloud infrastructure managed with Terraform, Crossplane, or similar declarative tools.

The core principle: if it's not in Git, it doesn't exist. Every infrastructure change — no matter how small — goes through a pull request, is reviewed, and is applied by an automated system rather than a human running commands locally.

There are two delivery patterns for GitOps infrastructure, and choosing between them has significant operational implications.

#### Pull-Based Reconciliation

A controller running inside the cluster or cloud environment watches the Git repository. When it detects a difference between the declared state in Git and the actual state of the infrastructure, it automatically applies the necessary changes to reconcile them.

Tools: Crossplane (for cloud resources), ArgoCD and Flux (for Kubernetes resources).

The key property is **continuous reconciliation** — the controller doesn't just apply changes when you push; it continuously checks that the live state matches Git and corrects any drift, even drift caused by manual changes made outside the pipeline.

#### Push-Based Pipelines

A CI/CD runner (GitHub Actions, GitLab CI, Atlantis) is triggered by a merge to the main branch. It runs `terraform plan` on the PR and `terraform apply` on merge.

The key property is **event-driven application** — changes are applied when triggered by a Git event, not continuously. Drift that happens between pipeline runs is not automatically corrected.

| Property | Pull-Based | Push-Based |
| :--- | :--- | :--- |
| Drift correction | Continuous, automatic | Only on next pipeline run |
| Operational model | Controller manages state | Pipeline applies changes |
| Credential exposure | Controller credentials stay in-cluster | Runner needs cloud credentials |
| Tooling | Crossplane, ArgoCD, Flux | Atlantis, GitHub Actions, GitLab CI |
| Best for | Kubernetes-native and cloud resource management | Terraform-centric workflows |

Neither model is universally superior. Most mature platforms use push-based pipelines for Terraform-managed infrastructure (where the blast radius of a misfired reconciliation is high) and pull-based reconciliation for Kubernetes workloads (where convergence speed and drift correction matter more).

---

### Code vs Configuration

One of the most common structural mistakes in IaC is conflating the reusable logic of a module with the environment-specific values that configure it. Separating these two concerns is what makes IaC actually reusable.

**Infrastructure code** (modules, libraries) defines *how* a resource is built — the structure, logic, and best-practice defaults. A well-written VPC module knows how to create subnets, route tables, and NAT gateways correctly. It doesn't know whether it's being deployed in dev or prod, or what CIDR range to use.

**Environment configuration** defines *what* to provision in a specific context — the actual CIDR blocks, instance sizes, replica counts, and feature flags for a particular environment. This lives in `tfvars` files, environment-specific directories, or a configuration management system.

| Layer | Contains | Changes when |
| :--- | :--- | :--- |
| Module (code) | Resource logic, defaults, validation | Architecture changes |
| Configuration (vars) | Environment-specific values | Environment needs change |
| State | Actual deployed resource IDs | Resources are created or destroyed |

**The golden rule:** A module should never contain hardcoded environment names, account IDs, or region-specific values. If you find yourself writing `if env == "prod"` inside a module, the module has absorbed configuration that belongs outside it.

The practical test: can you deploy the same module to a new environment by only changing a `tfvars` file, with zero changes to the module itself? If yes, the separation is correct.

---

## 3. Architecture & Blast Radius

### Blast Radius Isolation

Blast radius is the amount of damage a single failure — a bad `terraform apply`, a state corruption, a leaked credential, a misconfigured IAM policy — can cause. Blast radius is a function of how much infrastructure is under one unit of control. The larger the state file or the broader the permissions scope, the larger the blast radius.

**Monolithic state** is the antipattern where all infrastructure — VPC, databases, EKS clusters, DNS, IAM, and application resources — lives in a single Terraform state file managed by a single pipeline with a single set of credentials. This is easy to start with and catastrophic at scale.

- A corrupted state file takes down everything.
- A single failed resource can block the entire `apply`.
- Any engineer with access to the pipeline can affect any resource.
- Plan output is enormous and nearly impossible to review safely.

**Decoupled state** splits infrastructure along two axes: environment boundaries and layer boundaries.

**Splitting by environment** ensures that a failed deployment in dev cannot affect prod. The prod state file is a separate artifact, managed by a separate pipeline, requiring separate credentials. Dev is the canary; prod is protected.

**Splitting by layer** separates infrastructure by lifecycle and ownership. Core networking (VPCs, Transit Gateways, DNS) changes rarely and requires broad permissions. Application infrastructure (ECS services, RDS instances, Lambda functions) changes frequently and should be deployable without touching the network layer.

A practical layering model:

| Layer | Contents | Change Frequency | Blast Radius |
| :--- | :--- | :--- | :--- |
| Foundation | Accounts, SCPs, IAM identity | Very rare | Entire organization |
| Core Networking | VPC, TGW, subnets, DNS zones | Rare | All workloads in region |
| Shared Services | Centralized endpoints, security tooling | Occasional | All spoke accounts |
| Data | RDS, ElastiCache, S3 buckets | Moderate | Applications using the data layer |
| Compute | EKS, ECS, Lambda, EC2 | Frequent | Individual workloads |
| Application | Services, tasks, deployments | Very frequent | Single service |

Each layer is independently deployable. A broken application deployment cannot cascade into a network-layer state corruption. A network change can be planned, reviewed, and applied without touching application state.

---

### Shared State vs Remote State Data Sources

Splitting state into layers creates a new problem: layers need to share information. An EKS cluster needs the VPC ID and subnet IDs from the networking layer. An application deployment needs the RDS endpoint from the data layer. You can't have isolated state files if values need to flow between them.

The wrong answer is copy-pasting values into hardcoded variables. Hardcoded values go stale, cause drift, and break silently when the upstream resource is recreated with a new ID.

The right answer is **remote state data sources** or **Parameter Store / Secrets Manager outputs**.

#### Remote State Data Sources

The producer module writes its outputs to a remote state backend (S3 + DynamoDB lock, Terraform Cloud, etc.). The consumer module reads those outputs using a `terraform_remote_state` data source, referencing the exact backend and key where the producer's state is stored.

```hcl
data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket = "my-tfstate-bucket"
    key    = "core-networking/terraform.tfstate"
    region = "ap-southeast-1"
  }
}

resource "aws_eks_cluster" "this" {
  vpc_config {
    subnet_ids = data.terraform_remote_state.networking.outputs.private_subnet_ids
  }
}
```

The consumer always reads the live, current output from the producer's state. If the networking layer is redeployed and subnet IDs change, the next apply of the compute layer picks up the new values automatically.

#### Parameter Store as an Interface

An alternative pattern is to have the producer write its outputs explicitly to AWS Systems Manager Parameter Store, and have the consumer read from Parameter Store using an `aws_ssm_parameter` data source. This decouples the consumer from knowledge of the producer's state backend and key structure — the only shared contract is the parameter path.

```hcl
resource "aws_ssm_parameter" "vpc_id" {
  name  = "/infra/networking/vpc-id"
  type  = "String"
  value = aws_vpc.main.id
}
```

```hcl
data "aws_ssm_parameter" "vpc_id" {
  name = "/infra/networking/vpc-id"
}
```

This pattern is particularly useful in multi-account architectures where the consumer and producer are in different AWS accounts — cross-account remote state access requires careful S3 bucket policy configuration, while cross-account SSM reads are a standard IAM permission.

| Property | Remote State Data Source | Parameter Store |
| :--- | :--- | :--- |
| Coupling | Consumer knows producer's backend and key | Consumer knows only the parameter path |
| Cross-account support | Requires S3 bucket policy configuration | Standard IAM `ssm:GetParameter` |
| Auditability | State access logged in S3/backend logs | CloudTrail logs every read |
| Version history | Tied to Terraform state versioning | Native SSM parameter versioning |
| Best for | Single-account, tightly coupled layers | Multi-account, loosely coupled layers |

Whichever pattern you choose, the principle is the same: outputs flow from producer to consumer through a well-defined interface, not through hardcoded values or manual coordination.
