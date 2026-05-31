# IaC Paradigms, Patterns & Decisions

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The IaC Mindset & Philosophies](#1-the-iac-mindset-philosophies) | Why IaC exists, declarative vs imperative models, cattle vs pets, and immutable infrastructure. |
| **02** | [Core Concepts](#2-core-concepts) | State, idempotency, reconciliation (human vs continuous), drift, and ownership boundaries. |
| **03** | [The IaC Maturity Model](#3-the-iac-maturity-model) | The evolution from ClickOps and custom scripts to team-scale IaC and true platform engineering. |
| **04** | [Infrastructure Delivery & Patterns](#4-infrastructure-delivery-patterns) | GitOps for IaC (push vs pull), code vs configuration separation, repository structures, and module composition models. |
| **05** | [Decision Framework](#5-decision-framework) | Pragmatic "it depends" matrices for Monorepo vs Polyrepo, Workspaces vs Directory Separation, Single vs Split State, and Tool selection. |
| **06** | [Multi-Environment Strategies](#6-multi-environment-strategies) | Managing dev, staging, and prod environment promotion, variable management, and ephemeral test environments. |
| **07** | [Multi-Account & Isolation](#7-multi-account-isolation) | Landing zone patterns: when to split accounts/OUs, and managing cross-account resource access cleanly. |
| **08** | [State Management & Blast Radius](#state) | Sizing state files, blast radius isolation, and sharing state securely using remote state or SSM parameter store. |
| **09** | [Governance & Standards](#9-governance-standards) | Enforcing quality, guardrails, compliance controls, and module governance at organization scale. |
| **10** | [Operating IaC at Scale](#10-operating-iac-at-scale) | Handling drift detection, continuous observability, recovery, toil reduction, and cost attribution. |
| **11** | [Common Anti-Patterns](#11-common-anti-patterns) | Real-world IaC design mistakes, state-locking failures, and patterns that fail under production stress. |
| **12** | [Architecture Decision Cheatsheet](#12-architecture-decision-cheatsheet) | Quick-reference lookup matrix for common IaC design dilemmas. |

---

## 1. The IaC Mindset & Philosophies

### Why IaC Exists — The Actual Reason

The common answer is "automation" and "repeatability." Those are outcomes, not the reason. IaC exists because **human beings cannot reliably apply complex configuration to infrastructure at the speed and scale that modern systems require**. A senior engineer making manual changes in the AWS Console will eventually make an error, forget a step, or produce an environment that differs subtly from every other environment they have ever configured. IaC removes the human from the application step while keeping them in the design and review step.

The deeper purpose is **making infrastructure auditable, reviewable, and reversible**. When infrastructure is defined as code, you get version history, pull request reviews, and the ability to understand why a configuration decision was made three years ago — not because it is "documentation" but because the code *is* the system state.

### Declarative vs Imperative IaC

The most fundamental split in IaC tooling is between declarative and imperative models. Understanding the difference — and why declarative wins at scale — shapes every other decision in how you design and operate infrastructure.

**Declarative tools** (Terraform, OpenTofu, CloudFormation, Kubernetes manifests) ask you to describe the *desired end state* of your infrastructure. The tool owns the reconciliation loop: it compares what you declared against what currently exists, calculates the delta, and executes only the API calls needed to close the gap.

**Imperative tools** (AWS CLI scripts, Bash, Ansible in procedural mode) ask you to write the *steps* to achieve a state. You own the logic — checking whether resources exist, handling failures, managing ordering and dependencies. This is flexible but doesn't scale.

| Property | Declarative | Imperative |
| :--- | :--- | :--- |
| **You define** | Desired end state | Step-by-step instructions |
| **Dependency resolution** | Handled by the tool | Written manually by you |
| **Idempotency** | Built-in | Must be coded explicitly |
| **Drift detection** | Native (plan/diff) | Not possible without custom logic |
| **Examples** | Terraform, CloudFormation, Pulumi | AWS CLI, Bash, Ansible (procedural) |

**Declarative in practice:** To enable versioning on an S3 bucket, you declare `versioning = enabled`. If the bucket already exists but versioning is off, the tool enables it. If the bucket doesn't exist, it creates it with versioning on. You don't write a single conditional.

**Imperative in practice:** The equivalent script must check if the bucket exists, branch on the result, call `create-bucket` if absent, then call `put-bucket-versioning` regardless. Every edge case you miss becomes a production incident.

The practical cost of imperative IaC only becomes visible at scale. Managing 10 resources imperatively is manageable. Managing 500 resources across three environments and four regions imperatively is chaos — dependency ordering bugs, race conditions, and non-idempotent scripts that partially apply on re-run.

### Cattle vs Pets in Infrastructure

This mental model, coined in the early cloud era, describes two fundamentally different relationships engineers can have with their servers. It remains the clearest way to explain why IaC exists at all.

**Pets** are servers that are individually named, hand-built, and nursed back to health when something goes wrong. Engineers log in, troubleshoot, and apply fixes directly to the running machine. The server accumulates history — packages installed ad hoc, config files edited by hand, services started and forgotten. Over time, no two servers are truly identical even if they started from the same base.

**Cattle** are servers built from a standard template (an AMI, a container image, a Launch Template). They are identical, numbered rather than named, and entirely disposable. When a cattle server becomes unhealthy, degraded, or needs a change applied, it is terminated and replaced by a freshly built instance from the updated template. The fix happens in the template, not on the running machine.

| Property | Pets | Cattle |
| :--- | :--- | :--- |
| **Identity** | Named, unique | Numbered, interchangeable |
| **On failure** | Log in and repair | Terminate and replace |
| **Configuration drift** | Inevitable | Eliminated by design |
| **Scaling** | Hard — each new server is manual work | Trivial — clone the template |
| **IaC compatibility** | Poor — state lives on the machine | Native — state lives in the template |

The cattle model is what makes IaC, auto-scaling, and CI/CD pipelines possible. If your servers are pets, you can't automate their lifecycle — each one is a snowflake with undocumented history. If they're cattle, any pipeline can build, deploy, and replace them safely.

### Immutable Infrastructure

Immutable infrastructure takes the cattle model to its logical conclusion. Instead of applying changes to running servers — patching packages, updating config files, restarting services — you build a *new* machine image incorporating the change and deploy it to replace the old instances. The running servers are never modified after launch.

The canonical tool for this is **Packer**, which bakes AMIs with all dependencies, config, and application artifacts pre-installed. When a change is needed, a new AMI is built, validated, and promoted through environments. Existing instances are replaced by new ones launched from the updated AMI.

**Benefits of immutable infrastructure:**

- **Environment parity:** Dev, staging, and prod all run from the same tested artifact. There is no "it works on my machine" — the machine is the artifact.
- **Elimination of configuration drift:** Running servers cannot diverge from the declared state because they are never modified after launch.
- **Clean rollbacks:** Rolling back means deploying the previous AMI version. There is no "undo" command to reverse a partial configuration change — you just re-deploy the known-good image.
- **Simplified incident response:** When a server behaves unexpectedly, the correct response is terminate and replace, not investigate and patch. The investigation happens against the image build process, not the live server.

The tradeoff is deployment speed. Baking a new AMI takes minutes; `apt upgrade` on a running server takes seconds. For most production workloads, the correctness and reliability gains are worth it.

### Infrastructure as a Product, Not a Project

The most important mindset shift for platform teams: **infrastructure is a product with consumers, not a project with a delivery date**. Projects end. Products evolve. An infrastructure platform that was "completed" in 2022 and has not been touched since is accruing technical debt, security vulnerabilities, and drift — even if no one has changed it, the world around it has changed.

This has direct implications for how platform teams are structured, funded, and measured. A platform team funded as a project will build the infrastructure and move on. A platform team funded as a product team will own it through its entire lifecycle, iterate on it based on consumer feedback, and maintain it as the cloud evolves around it.

---

## 2. Core Concepts

### State

State is the IaC tool's record of what it believes exists in the real world. In Terraform/OpenTofu, this is a JSON file (`.tfstate`). Every resource managed has a corresponding state entry mapping its logical identifier (e.g., `aws_s3_bucket.my_bucket`) to its real-world attributes (bucket name, ARN, region, versioning config).

State is not a cache — it is the source of truth for the tool's plan generation. When the tool runs a plan, it compares the desired state (`.tf` files) against the current state (`.tfstate`) to determine what changes to make. It does not always re-query the real world — it trusts state unless you run `terraform refresh` or use the `-refresh-only` flag.

**State is your most critical operational artifact.** A corrupted, lost, or split state file is an incident. Treat state backends with the same operational rigor as a production database.

### Idempotency

An operation is idempotent if applying it multiple times produces the same result as applying it once. Desired-state IaC tools aim for idempotency: running `terraform apply` on an already-converged system should result in no changes.

Idempotency fails in practice when:
- Resources are created outside IaC (manual changes) that the tool then tries to recreate.
- The tool's state diverges from the real world (drift).
- External systems have side effects (e.g., an RDS instance whose parameter group has been modified manually, making the tool believe a change is needed on every plan).
- `count` or `for_each` expressions produce non-deterministic results depending on variable input order.

### Reconciliation

Reconciliation is the process of bringing actual state into alignment with desired state. In Terraform, reconciliation happens during `apply`. In Kubernetes, the controller manager continuously reconciles — it does not wait for a human to run a command.

This distinction matters: **Terraform is human-triggered reconciliation; Kubernetes is continuous reconciliation**. For infrastructure that must remain in a known state continuously (not just after deployments), Kubernetes-style continuous reconciliation (via tools like Crossplane or AWS Controllers for Kubernetes) is architecturally stronger than Terraform-apply-on-merge.

### Drift

Drift is the divergence between your declared desired state and the actual state of your infrastructure. It happens through:
- Manual changes in the cloud provider console.
- Changes made by another team or tool that manages the same resource.
- AWS-initiated changes (e.g., AWS modifying a managed service's default configuration).
- Terraform apply failures that left resources partially created.

Drift is inevitable. Every organization has it. The question is how quickly it is detected and whether it is visible. Undetected drift is a security risk (someone hardened a security group manually, then a Terraform apply reverts it) and a reliability risk (someone fixed a misconfiguration manually, then the next apply breaks it again).

### Ownership Boundaries

Every infrastructure resource should have exactly one IaC owner — one module, one state file, one team responsible for it. When two IaC stacks both believe they manage the same resource, you have a split-brain problem that will produce conflicts, unexpected destroys, and confused plans.

Common ownership boundary violations:
- A security team's Terraform stack and an application team's stack both import and manage the same IAM role.
- A shared networking stack and an application stack both have `aws_route_table_association` resources for the same subnet.
- Two CI pipelines applying to the same Terraform state file concurrently (requires state locking to prevent).

Establish ownership boundaries explicitly. If a resource is referenced by multiple stacks, exactly one stack should manage it (own the state entry); others should reference it via data sources or remote state outputs.

---

## 3. The IaC Maturity Model

### Stage 1 — ClickOps

Infrastructure is created manually through the AWS Console, Azure Portal, or CLI commands. No state is tracked. No code exists. Changes are applied by logging in and clicking.

This is the starting point for every organization. It is not wrong at small scale; it is unsustainable at medium scale and dangerous at large scale. The tell-tale sign that ClickOps is causing pain: "We're not sure what we have" and "We can't reproduce that environment."

### Stage 2 — Scripted Infrastructure

Infrastructure creation is automated via shell scripts, AWS CLI commands, or cloud-specific SDKs. Environments can be rebuilt, but scripts are often imperative and fragile — they fail if run twice, do not handle partial failure gracefully, and cannot represent current state.

Most organizations reach this stage quickly after their first major production incident caused by a manual misconfiguration.

### Stage 3 — Declarative IaC (Single Team)

Terraform (or equivalent) is adopted. Infrastructure is declared in `.tf` files. State is managed (often in an S3 backend). The single platform team runs Terraform from their laptops or a shared CI job. There is one repository. There are few modules and significant copy-paste between environment directories.

This works until the team grows, more people need to make changes, and "who applied last?" becomes a daily question.

### Stage 4 — Team-Scale IaC

Multiple teams write IaC. Modules are extracted and versioned. CI/CD pipelines apply Terraform — no one applies from a laptop. State is split by component and environment. Pull request reviews are required. There is a naming convention and folder structure standard.

This is where most mature cloud teams operate. The remaining pain: modules are inconsistently structured, module versioning is ad-hoc, and there is no enforcement mechanism for standards — they are documents no one reads.

### Stage 5 — Platform Engineering

Infrastructure is a product with a published API (the module interface). Internal modules are published to a registry. Consumers write `module "vpc" { source = "registry/vpc/aws" }` and get a compliant network without understanding its internals. Policy as code (OPA, Sentinel) enforces standards automatically. Drift detection runs continuously. The platform team owns the modules; application teams own their consumption configurations.

This stage requires organizational investment — dedicated platform engineers, a module registry, pipeline infrastructure, and governance tooling. Reaching it is a multi-year journey for most organizations.

---

## 4. Infrastructure Delivery & Patterns

### GitOps for Infrastructure

GitOps is the practice of using a Git repository as the single source of truth for both desired state and change history. Every infrastructure change — no matter how small — goes through a pull request, is reviewed, and is applied by an automated system rather than a human running commands locally.

There are two delivery patterns for GitOps infrastructure, and choosing between them has significant operational implications.

#### Pull-Based Reconciliation

A controller running inside the cluster or cloud environment watches the Git repository. When it detects a difference between the declared state in Git and the actual state of the infrastructure, it automatically applies the necessary changes to reconcile them.

*   **Tools:** Crossplane (for cloud resources), ArgoCD and Flux (for Kubernetes resources).
*   **Key Property:** **Continuous reconciliation** — the controller doesn't just apply changes when you push; it continuously checks that the live state matches Git and corrects any drift, even drift caused by manual changes made outside the pipeline.

#### Push-Based Pipelines

A CI/CD runner (GitHub Actions, GitLab CI, Atlantis) is triggered by a merge to the main branch. It runs `terraform plan` on the PR and `terraform apply` on merge.

*   **Tools:** Atlantis, GitHub Actions, GitLab CI.
*   **Key Property:** **Event-driven application** — changes are applied when triggered by a Git event, not continuously. Drift that happens between pipeline runs is not automatically corrected.

| Property | Pull-Based | Push-Based |
| :--- | :--- | :--- |
| **Drift correction** | Continuous, automatic | Only on next pipeline run |
| **Operational model** | Controller manages state | Pipeline applies changes |
| **Credential exposure** | Controller credentials stay in-cluster | Runner needs cloud credentials |
| **Tooling** | Crossplane, ArgoCD, Flux | Atlantis, GitHub Actions, GitLab CI |
| **Best for** | Kubernetes-native and cloud resource management | Terraform-centric workflows |

Neither model is universally superior. Most mature platforms use push-based pipelines for Terraform-managed infrastructure (where the blast radius of a misfired reconciliation is high) and pull-based reconciliation for Kubernetes workloads (where convergence speed and drift correction matter more).

### Code vs Configuration

One of the most common structural mistakes in IaC is conflating the reusable logic of a module with the environment-specific values that configure it. Separating these two concerns is what makes IaC actually reusable.

*   **Infrastructure code** (modules, libraries) defines *how* a resource is built — the structure, logic, and best-practice defaults. A well-written VPC module knows how to create subnets, route tables, and NAT gateways correctly. It doesn't know whether it's being deployed in dev or prod, or what CIDR range to use.
*   **Environment configuration** defines *what* to provision in a specific context — the actual CIDR blocks, instance sizes, replica counts, and feature flags for a particular environment. This lives in `tfvars` files, environment-specific directories, or a configuration management system.

| Layer | Contains | Changes when |
| :--- | :--- | :--- |
| **Module (code)** | Resource logic, defaults, validation | Architecture changes |
| **Configuration (vars)** | Environment-specific values | Environment needs change |
| **State** | Actual deployed resource IDs | Resources are created or destroyed |

**The golden rule:** A module should never contain hardcoded environment names, account IDs, or region-specific values. If you find yourself writing `if env == "prod"` inside a module, the module has absorbed configuration that belongs outside it.

The practical test: can you deploy the same module to a new environment by only changing a `tfvars` file, with zero changes to the module itself? If yes, the separation is correct.

### Repository Structure Patterns

The repository structure is the first major IaC architectural decision. There is no universally correct answer, but there are trade-offs to understand.

#### Pattern A — Monorepo

All infrastructure code for the organization lives in one repository. Teams own directories within it.

```
infra/
├── modules/
│   ├── vpc/
│   ├── eks/
│   └── rds/
├── accounts/
│   ├── production/
│   │   ├── networking/
│   │   ├── compute/
│   │   └── data/
│   └── development/
│       ├── networking/
│       └── compute/
└── platform/
    └── shared-services/
```

| Strength | Weakness |
| :--- | :--- |
| Single source of truth; easy to find anything | CI pipelines must detect which directories changed to avoid applying everything |
| Cross-team changes are atomic (one PR) | Access control is harder — all teams can see all code |
| Easier to enforce conventions via tooling | Repository becomes slow to clone at large scale |
| Module reuse is local (no registry needed for sharing) | Blast radius of a misconfigured CI job is the entire org |

#### Pattern B — Repository Per Team / Component

Each team or major component has its own repository. Shared modules live in separate module repositories.

```
github.com/org/
├── infra-networking/
├── infra-compute/
├── infra-data/
├── tf-module-vpc/
├── tf-module-eks/
└── tf-module-rds/
```

| Strength | Weakness |
| :--- | :--- |
| Team autonomy; independent CI pipelines | Cross-team changes require coordinated PRs across repos |
| Smaller blast radius per repository | Module versioning and dependency management becomes explicit overhead |
| Fine-grained access control | Harder to get a holistic view of infrastructure |
| Scales to large organizations | Duplicate patterns emerge across repos when there is no enforcement |

#### Pattern C — Monorepo with Module Registry (Hybrid)

Module code lives in dedicated module repositories (published to a registry). Infrastructure configurations live in a monorepo. This is the pattern used by organizations operating at Stage 5 maturity.

```
# Module repos (published to registry)
github.com/org/tf-module-vpc           → registry.org.com/vpc/aws/1.2.0
github.com/org/tf-module-eks           → registry.org.com/eks/aws/2.0.1

# Config monorepo
infra/
├── accounts/
│   ├── production/
│   │   └── networking/
│   │       └── main.tf  # sources registry.org.com/vpc/aws/1.2.0
│   └── development/
│       └── networking/
│           └── main.tf  # sources registry.org.com/vpc/aws/1.2.0
```

### Module Composition Patterns

Modules are the unit of reuse and abstraction in Terraform. How you compose them defines the flexibility and complexity of your infrastructure platform.

#### Thin Wrapper Modules

A thin wrapper calls a single upstream module and adds organizational defaults. Useful for enforcing opinions on top of community modules without duplicating their logic.

```hcl
# modules/s3-bucket/main.tf — thin wrapper over hashicorp/s3-bucket
module "s3" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 3.0"

  bucket = var.bucket_name

  # Org defaults — consumers cannot override these
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
  versioning = {
    enabled = var.versioning_enabled
  }
  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = {
        sse_algorithm = "aws:kms"
        kms_master_key_id = var.kms_key_id
      }
    }
  }
}
```

#### Composition Modules (Root Modules)

Composition modules bring together multiple resource modules to deliver a complete capability. They are consumed by environments directly.

```hcl
# modules/application-tier/main.tf — composition
module "vpc" {
  source = "registry/vpc/aws"
  # ...
}

module "alb" {
  source = "registry/alb/aws"
  vpc_id = module.vpc.vpc_id
  # ...
}

module "ecs_service" {
  source  = "registry/ecs-service/aws"
  alb_arn = module.alb.arn
  # ...
}
```

Composition modules are opinionated about how components connect. They reduce consumer decision fatigue but reduce flexibility. The right level of composition depends on how standard your architecture is across teams.

#### Resource Modules vs Configuration Modules

A useful mental model:

| Type | Scope | Contains | Versioned? |
| :--- | :--- | :--- | :--- |
| **Resource module** | Single resource type or tight cluster | `aws_s3_bucket` + related resources (policy, lifecycle, notification) | Yes — published |
| **Composition module** | Multiple resource modules assembled into a capability | VPC + subnets + route tables + endpoints + flow logs | Yes — published |
| **Root module** | Specific environment configuration | Composition modules with environment-specific values | No — it is the leaf |

Root modules are not published to a registry. They are the environment-specific configurations in your config repository. Publishing root modules would mean publishing "production configuration" as a reusable artifact — which makes no sense. Only resource and composition modules get versioned and published.

---

## 5. Decision Framework

### The "It Depends" Decisions — Made Explicit

Every IaC architectural decision has a context dependency. The goal of this section is to make those dependencies explicit so you can apply the framework to your situation rather than cargo-culting a pattern from a blog post.

#### Decision: Monorepo vs Polyrepo

| Choose Monorepo When | Choose Polyrepo When |
| :--- | :--- |
| Teams are small and trust each other with shared access | Teams have distinct ownership and access control requirements |
| Cross-team infrastructure dependencies are frequent | Teams deploy independently with few cross-team infrastructure dependencies |
| You want to enforce standards via shared CI tooling | Teams need independent release cycles for their infrastructure |
| Organization size < 30 infrastructure engineers | Organization size > 50 infrastructure engineers |
| You have the tooling to scope CI to changed directories (Terragrunt, Atlantis) | Teams have different IaC tooling preferences |

#### Decision: Terraform Workspaces vs Directory Separation for Environments

Terraform workspaces allow one configuration to manage multiple environments by switching the workspace (`terraform workspace select production`). Directory separation uses distinct directories per environment, each with their own state.

| Factor | Workspaces | Directory Separation |
| :--- | :--- | :--- |
| **State isolation** | Partial — all workspaces share one backend path prefix | Complete — each directory has its own state key |
| **Configuration drift between environments** | Easy to diverge accidentally (different workspace variables) | Explicit — you can diff directories |
| **Blast radius of a wrong apply** | High — workspace selection is manual and easy to mistake | Low — you must `cd` to the target environment |
| **Complexity for beginners** | High — workspace concept is non-obvious | Low — directories are intuitive |
| **Suitable for environments with different resource counts** | No — `count` with workspace conditionals becomes unmaintainable | Yes |

**Recommendation:** Use directory separation for environments. Workspaces are appropriate for ephemeral, identical environments (feature branch testing environments that are structurally identical to each other), not for the production/staging/dev distinction.

#### Decision: Single State vs Split State

| Factor | Single State | Split State |
| :--- | :--- | :--- |
| **Plan execution time** | Slow — Terraform queries all resources every plan | Fast — each state file is small |
| **Blast radius of a failed apply** | High — one broken resource can block all changes | Low — isolated to the component |
| **Cross-component dependency management** | Implicit — resources share a namespace | Explicit — remote state references required |
| **Team independence** | Low — one state means one queue | High — teams apply to their state independently |
| **Suitable for large resource counts (>500 resources)** | No — plans become unusably slow | Yes |

**Rule of thumb:** Split state when a single `terraform plan` takes longer than 10 minutes, when more than one team writes to the same configuration, or when you want to apply networking changes independently of compute changes.

#### Decision: Which IaC Tool

| Tool | Best For | Avoid When |
| :--- | :--- | :--- |
| **Terraform (OpenTofu)** | Multi-cloud; large ecosystem; team familiarity; stable enterprise deployments | You need strongly-typed infrastructure definitions or programmatic logic |
| **Pulumi** | Teams who want real programming languages (Python, TypeScript, Go); complex conditional logic; unit testing infrastructure | Team lacks software engineering background; simple, stable infrastructure |
| **AWS CDK** | AWS-only; TypeScript/Python fluency; tight integration with CDK Constructs ecosystem | Multi-cloud; you need to import existing resources cleanly |
| **CloudFormation** | AWS-only; you want deep AWS service integration without a third-party tool; StackSets for multi-account | You want a plan preview before applying; you value readable code |
| **Crossplane** | Infrastructure managed as Kubernetes resources; GitOps with Flux/ArgoCD; continuous reconciliation | You do not already run Kubernetes; your team has no Kubernetes experience |
| **Ansible** | Configuration management of running instances; OS-level setup; hybrid environments | Provisioning cloud resources (it is the wrong layer — use Terraform for cloud resources) |

#### Decision: Module Version Pinning Strategy

| Strategy | Pattern | Risk |
| :--- | :--- | :--- |
| **Exact pin** | `version = "1.2.3"` | Safe; never gets unexpected updates; stale if not actively updated |
| **Patch-range pin** | `version = "~> 1.2"` (allows 1.2.x) | Automatically picks up bug fixes; minor risk of breaking change in a patch |
| **Minor-range pin** | `version = ">= 1.2, < 2.0"` | Picks up new features; higher risk of breaking changes |
| **Latest** | No version constraint | Never do this in production — a module breaking change will immediately break all consumers |

**Recommendation:** Use exact pins in production root modules. Use patch-range pins in internal modules that consume other internal modules (controlled environment). Run Dependabot or Renovate to automate version bump PRs so exact pinning does not mean manual stagnation.

---

## 6. Multi-Environment Strategies

### The Environment Promotion Model

Environments exist to gate risk. A change moves through environments in promotion order — usually `dev → staging → production` — gaining confidence at each stage before reaching the highest-risk target.

The key design question: **how different are your environments from each other?**

| Dimension | Identical Environments | Differentiated Environments |
| :--- | :--- | :--- |
| **Resource sizing** | Same instance types, same counts | Dev uses smaller instances; prod uses HA multi-AZ |
| **Feature flags** | Same config | Some features enabled only in prod |
| **Data** | Synthetic or anonymized data in dev | Real data in prod (with controls) |
| **Network topology** | Same CIDR structure, different CIDRs | Same structure, different addressing |
| **Cost** | Expensive to maintain identical staging | Cheaper with sized-down non-prod |

Identical environments give you high fidelity pre-production testing. Differentiated environments are cheaper but can hide environment-specific bugs (the classic "works in dev, breaks in prod" caused by a difference in instance size exposing a memory issue).

**Recommendation:** Keep the *structure* identical (same modules, same topology) but vary the *parameters* (size, count, features). This is the sweet spot — structural fidelity with cost-appropriate sizing.

### Environment Variable Management

Variables that differ between environments must be managed systematically. Common approaches:

#### tfvars Files Per Environment

```
environments/
├── dev.tfvars
├── staging.tfvars
└── production.tfvars
```

Each file contains the environment-specific overrides. The CI pipeline selects the correct file: `terraform apply -var-file=environments/production.tfvars`.

Simple and explicit. The downside: the files live in the same repository as the code, which creates a single PR that changes both infrastructure logic and environment values — harder to review and reason about separately.

#### Separate Config Repository

Configuration values (tfvars, Helm values) live in a separate repository from the infrastructure code. The infrastructure CI pipeline reads from both: the module code from one repo, the values from another.

Useful when configuration values change frequently (feature flags, scaling parameters) and you do not want every config change to trigger a full infrastructure pipeline run. Adds complexity — now you have two repositories to keep in sync.

#### Environment-Specific Backends

Each environment has its own backend configuration — not just a different state key, but potentially a different bucket, a different account, and different IAM permissions.

```hcl
# Production backend
terraform {
  backend "s3" {
    bucket  = "org-tfstate-production"
    key     = "networking/terraform.tfstate"
    region  = "ap-southeast-1"
    role_arn = "arn:aws:iam::PROD_ACCOUNT:role/TerraformBackend"
  }
}
```

This is the strongest isolation model — the production state file is in the production account, accessible only by production-scoped IAM roles. A misconfigured CI job cannot accidentally apply to production because it does not have permission to access the production backend.

### Ephemeral Environments

Ephemeral environments are short-lived, on-demand environments created for a specific purpose (feature branch testing, load testing, compliance audit) and destroyed when done. They are distinct from permanent environments (dev, staging, prod).

Ephemeral environment design requirements:
- Must be created and destroyed by CI automatically — no manual steps.
- Must be structurally identical to staging (same topology, possibly smaller).
- Must have unique resource naming to avoid collisions with permanent environments.
- Must be enumerable — you must be able to list all ephemeral environments and find orphans.

Implement unique naming via a workspace or prefix derived from the branch name or PR number:

```hcl
locals {
  env_prefix = "feature-${var.pr_number}"
  bucket_name = "${local.env_prefix}-my-bucket"
}
```

The operational risk: ephemeral environments that are not cleaned up become idle resource cost. Implement a TTL mechanism — a scheduled Lambda or GitHub Actions job that destroys environments older than N hours that have not been refreshed.

---

## 7. Multi-Account & Isolation

### When to Create a New AWS Account

The AWS account is the strongest isolation boundary. Use it deliberately.

| Signal | Recommended Isolation |
| :--- | :--- |
| **Different compliance scope (PCI, HIPAA data)** | Dedicated account — different compliance controls, auditable boundary |
| **Different team with no legitimate access to other environments** | Dedicated account — access control is cleaner than IAM policy complexity |
| **Different billing and cost allocation requirement** | Dedicated account — account-level Cost Explorer filtering is reliable |
| **Blast radius concern (a destroy in this environment must never affect production)** | Dedicated account — Terraform state and API access are physically separate |
| **Development sandbox with elevated IAM permissions** | Dedicated account — engineers need broad permissions that would be dangerous in shared accounts |
| **Transient or time-bounded project** | Consider — account creation is cheap; account closure is a process |

Account proliferation has costs: each account requires baseline infrastructure (CloudTrail, Config, Security Hub enrollment, networking), and managing hundreds of accounts requires Control Tower or equivalent. Do not create accounts reflexively — create them when the isolation benefit justifies the overhead.

### OU Structure and IaC Alignment

Your OU structure should reflect your IaC state file structure. If the production OU contains three accounts, your IaC repository should have three production-scoped state configurations. Misalignment between OU structure and IaC structure creates confusion about which code manages which account.

```
AWS Organizations                     IaC Repository
─────────────────────────────         ────────────────────────────
Root                                  accounts/
├── Security OU                       ├── security/
│   └── Security Account              │   └── tooling/
├── Infrastructure OU                 ├── infrastructure/
│   ├── Shared Services               │   ├── shared-services/
│   └── Log Archive                   │   └── log-archive/
└── Workloads OU                      └── workloads/
    ├── Production OU                     ├── production/
    │   ├── Product-A                     │   ├── product-a/
    │   └── Product-B                     │   └── product-b/
    └── Non-Production OU                 └── non-production/
        └── Product-A Dev                     └── product-a/
```

### Cross-Account Resource Access in IaC

When one account's infrastructure needs to reference another account's resources, use Terraform data sources with explicit provider configurations per account:

```hcl
# providers.tf — configure multiple provider aliases
provider "aws" {
  alias  = "network"
  region = var.region
  assume_role {
    role_arn = "arn:aws:iam::${var.network_account_id}:role/TerraformReader"
  }
}

provider "aws" {
  alias  = "workload"
  region = var.region
  assume_role {
    role_arn = "arn:aws:iam::${var.workload_account_id}:role/TerraformApply"
  }
}

# Read VPC from network account
data "aws_vpc" "shared" {
  provider = aws.network
  tags = {
    Name = "shared-services-vpc"
  }
}

# Create resources in workload account referencing network account VPC
resource "aws_security_group" "app" {
  provider = aws.workload
  vpc_id   = data.aws_vpc.shared.id
}
```

This pattern makes cross-account dependencies explicit and auditable. The alternative — hardcoding resource IDs from other accounts — creates implicit dependencies that are invisible in the plan and break silently when the referenced resource changes.

### Tenant Models for Shared Infrastructure

When multiple teams share infrastructure (a shared EKS cluster, a shared RDS instance, a shared Kafka cluster), you have a tenancy model decision:

| Model | Description | Trade-offs |
| :--- | :--- | :--- |
| **Hard multi-tenancy** | Dedicated infrastructure per tenant; no sharing | Maximum isolation; highest cost; lowest density |
| **Namespace isolation** | Shared compute; logical isolation via Kubernetes namespaces, database schemas, Kafka topics | Good balance; tenants can interfere via resource exhaustion if not quota-enforced |
| **Soft multi-tenancy** | Shared infrastructure; trust-based isolation | Lowest cost; highest operational simplicity; inappropriate when tenants are from different orgs or have different compliance requirements |

In AWS, hard multi-tenancy (dedicated accounts) is the recommended default for compliance-sensitive workloads. Namespace isolation (shared EKS cluster with RBAC + namespace resource quotas) is appropriate for internal platform teams where all tenants are trusted and under the same compliance scope.

---

## 8. State Management & Blast Radius

### Blast Radius Isolation

Blast radius is the amount of damage a single failure — a bad `terraform apply`, a state corruption, a leaked credential, a misconfigured IAM policy — can cause. Blast radius is a function of how much infrastructure is under one unit of control. The larger the state file or the broader the permissions scope, the larger the blast radius.

**Monolithic state** is the antipattern where all infrastructure — VPC, databases, EKS clusters, DNS, IAM, and application resources — lives in a single Terraform state file managed by a single pipeline with a single set of credentials. This is easy to start with and catastrophic at scale.
*   A corrupted state file takes down everything.
*   A single failed resource can block the entire `apply`.
*   Any engineer with access to the pipeline can affect any resource.
*   Plan output is enormous and nearly impossible to review safely.

**Decoupled state** splits infrastructure along two axes: environment boundaries and layer boundaries.

*   **Splitting by environment** ensures that a failed deployment in dev cannot affect prod. The prod state file is a separate artifact, managed by a separate pipeline, requiring separate credentials. Dev is the canary; prod is protected.
*   **Splitting by layer** separates infrastructure by lifecycle and ownership. Core networking (VPCs, Transit Gateways, DNS) changes rarely and requires broad permissions. Application infrastructure (ECS services, RDS instances, Lambda functions) changes frequently and should be deployable without touching the network layer.

A practical layering model:

| Layer | Contents | Change Frequency | Blast Radius |
| :--- | :--- | :--- | :--- |
| **Foundation** | Accounts, SCPs, IAM identity | Very rare | Entire organization |
| **Core Networking** | VPC, TGW, subnets, DNS zones | Rare | All workloads in region |
| **Shared Services** | Centralized endpoints, security tooling | Occasional | All spoke accounts |
| **Data** | RDS, ElastiCache, S3 buckets | Moderate | Applications using the data layer |
| **Compute** | EKS, ECS, Lambda, EC2 | Frequent | Individual workloads |
| **Application** | Services, tasks, deployments | Very frequent | Single service |

Each layer is independently deployable. A broken application deployment cannot cascade into a network-layer state corruption. A network change can be planned, reviewed, and applied without touching application state.

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
# Producer
resource "aws_ssm_parameter" "vpc_id" {
  name  = "/infra/networking/vpc-id"
  type  = "String"
  value = aws_vpc.main.id
}

# Consumer
data "aws_ssm_parameter" "vpc_id" {
  name = "/infra/networking/vpc-id"
}
```

This pattern is particularly useful in multi-account architectures where the consumer and producer are in different AWS accounts — cross-account remote state access requires careful S3 bucket policy configuration, while cross-account SSM reads are a standard IAM permission.

| Property | Remote State Data Source | Parameter Store |
| :--- | :--- | :--- |
| **Coupling** | Consumer knows producer's backend and key | Consumer knows only the parameter path |
| **Cross-account support** | Requires S3 bucket policy configuration | Standard IAM `ssm:GetParameter` |
| **Auditability** | State access logged in S3/backend logs | CloudTrail logs every read |
| **Version history** | Tied to Terraform state versioning | Native SSM parameter versioning |
| **Best for** | Single-account, tightly coupled layers | Multi-account, loosely coupled layers |

### State Backend Requirements

The state backend is where Terraform writes its state file after every apply. For any team-scale deployment, the local filesystem is not an acceptable backend. A production state backend must provide:

| Requirement | Why | AWS Implementation |
| :--- | :--- | :--- |
| **Durability** | State corruption or loss is an incident | S3 with versioning enabled |
| **Concurrency control** | Two simultaneous applies produce race conditions | DynamoDB table for state locking |
| **Access control** | Only CI pipelines should write state; humans should read-only | S3 bucket policy + IAM roles |
| **Encryption** | State files contain sensitive data (passwords, private keys, secrets) | S3 SSE-KMS with a dedicated key |
| **Audit trail** | Who changed state and when | S3 server access logs + CloudTrail |
| **Versioning** | Recovery from corruption requires a previous known-good state | S3 versioning with lifecycle policy |

```hcl
# Bootstrap: the state backend bucket itself
resource "aws_s3_bucket" "tfstate" {
  bucket = "org-terraform-state-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true  # Never accidentally delete the state bucket
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.tfstate.arn
    }
  }
}

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

### State Key Design

The state key (the S3 object path for the state file) should encode enough context to be human-readable during incident response. You should be able to look at a state key and immediately know what it manages.

```
# Good: encodes account, environment, component
s3://org-tfstate/accounts/production/product-a/networking/terraform.tfstate
s3://org-tfstate/accounts/production/product-a/compute/terraform.tfstate
s3://org-tfstate/accounts/development/product-a/networking/terraform.tfstate

# Bad: opaque; requires context to understand
s3://org-tfstate/state1.tfstate
s3://org-tfstate/prod.tfstate
s3://org-tfstate/terraform.tfstate
```

### State Splitting Strategy

Split state when:
- A single state exceeds ~300 resources (plans become slow and noisy).
- Different teams need to apply changes independently without queuing behind each other.
- Components have different change frequencies (networking changes rarely; application config changes frequently — they should not share state).
- You want to isolate blast radius (a broken compute apply should not block networking changes).

Split along these natural boundaries (roughly in order of lowest-to-highest change frequency):
- Account bootstrap (IAM roles, account-level Config, CloudTrail) — changes rarely
- Networking (VPC, subnets, TGW, DNS) — changes infrequently
- Shared data services (RDS, ElastiCache, MSK) — changes occasionally
- Compute platform (EKS, ECS clusters, ASGs) — changes regularly
- Application configuration (ECS services, Lambda functions) — changes frequently

### State Corruption Recovery

State corruption is rare but happens. The recovery process depends on the corruption type:

*   **Scenario 1 — State file is stale (real world diverged from state):** Run `terraform refresh` to update state from the real world, then review the plan for unexpected changes. Or use `terraform apply -refresh-only` to update state without making changes.
*   **Scenario 2 — Resource in state but not in real world (deleted manually):** Remove the stale state entry: `terraform state rm <resource_address>`. Then re-apply to recreate it, or import the replacement if it was recreated manually.
*   **Scenario 3 — Resource in real world but not in state (created outside IaC):** Import the resource: `terraform import <resource_address> <real_world_id>`. Review the plan — the resource will show no changes if the configuration matches, or a diff if it needs to be brought into conformance.
*   **Scenario 4 — State file is corrupted (JSON parse error):** Restore the previous version from S3 versioning. Check the S3 version history for the last known-good version and restore it. Then re-evaluate whether recent applies need to be replayed.
*   **Scenario 5 — State lock is stuck (failed apply left a lock):** Verify the lock is genuinely stuck (not an in-progress apply): `terraform force-unlock <lock_id>`. Only force-unlock after confirming no apply is in progress — a concurrent apply on an unlocked state will produce corruption.

### Sensitive Data in State

Terraform state files contain the values of all resource attributes — including secrets. An RDS instance's master password, a generated private key, or an API secret written to a resource attribute will appear in plaintext in the state file.

Mitigations:
- Use SSE-KMS encryption on the state bucket — state is encrypted at rest.
- Use IAM policies to restrict state file read access to CI roles — humans should not have direct S3 GetObject permission on the state bucket in production.
- Store secrets outside Terraform where possible — reference them via data sources (`aws_secretsmanager_secret_version`) rather than managing them as Terraform resources.
- Use the `sensitive = true` attribute in output and variable declarations to prevent values from being logged in CI output.

---

## 9. Governance & Standards

### Policy as Code

Policy as code moves compliance enforcement from documentation into automated gates in the CI pipeline. Instead of a security policy document that says "all S3 buckets must have public access blocked," a policy check in CI automatically fails any plan that creates a public bucket.

Two primary tools:

| Tool | Integration | Language | Best For |
| :--- | :--- | :--- | :--- |
| **Open Policy Agent (OPA) + Conftest** | CI step on `terraform plan` JSON output | Rego | Open source; CI-native; no vendor dependency |
| **HashiCorp Sentinel** | Terraform Cloud / Enterprise only | Sentinel DSL | Teams using TFC/TFE; tighter integration with plan metadata |

OPA with Conftest is the more portable choice. Write policies in Rego that evaluate the Terraform plan JSON:

```rego
# policy/s3_public_access.rego
package terraform.s3

deny[msg] {
  r := input.resource_changes[_]
  r.type == "aws_s3_bucket_public_access_block"
  r.change.after.block_public_acls == false
  msg := sprintf("S3 bucket %v must have block_public_acls enabled", [r.address])
}
```

```bash
# In CI pipeline
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
conftest test tfplan.json --policy policy/
```

### Module Governance

A module registry without governance becomes a graveyard of inconsistent, unmaintained modules. Establish:

*   **Module ownership:** Every published module has a named owner (team, not individual). The owner is responsible for security patches, breaking change management, and consumer communication.
*   **Versioning discipline:** Use semantic versioning. Breaking changes increment the major version. New features increment minor. Bug fixes increment patch. Communicate breaking changes in a CHANGELOG before publishing the major bump.
*   **Deprecation process:** Modules are not deleted — they are deprecated. A deprecated module gets a prominent deprecation notice in its README and a `deprecated` tag in the registry. Consumers are given a migration path and a sunset date.
*   **Required module elements:**
    *   `README.md` with description, usage example, inputs, and outputs.
    *   `variables.tf` with description and validation for every variable.
    *   `outputs.tf` with description for every output.
    *   `versions.tf` with required Terraform and provider version constraints.
    *   `examples/` directory with at least one working example.

### Naming Convention Standards

Consistent naming across resources reduces cognitive load during incident response. An engineer who has never seen a particular resource should be able to infer its purpose, environment, and owner from its name.

Recommended naming pattern: `{org}-{env}-{region}-{component}-{suffix}`

| Resource | Example | Notes |
| :--- | :--- | :--- |
| **VPC** | `org-prod-apse1-main-vpc` | Region abbreviated: `apse1` for `ap-southeast-1` |
| **Subnet** | `org-prod-apse1-private-1a-snet` | AZ and tier in name |
| **Security Group** | `org-prod-web-alb-sg` | Tier and purpose |
| **S3 Bucket** | `org-prod-apse1-app-data-{account_id}` | Account ID suffix for global uniqueness |
| **IAM Role** | `org-prod-eks-node-role` | Service and purpose |
| **EKS Cluster** | `org-prod-apse1-eks` | Env and region required for multi-cluster support |

Enforce naming via Terraform variable validation and OPA policies. A plan that creates an S3 bucket without the organization prefix should fail the policy check automatically.

---

## 10. Operating IaC at Scale

### Drift Detection

Drift between IaC desired state and real-world actual state is inevitable. The question is how quickly you detect it.

Detection approaches:

| Approach | Frequency | Tool | Coverage |
| :--- | :--- | :--- | :--- |
| **`terraform plan` on schedule** | Hourly or daily | CI cron job | IaC-managed resources only |
| **AWS Config managed rules** | Continuous | AWS Config | Any resource, with or without IaC |
| **AWS Security Hub standards** | Continuous | Security Hub | Security-focused config drift |
| **Custom CloudWatch Events** | Real-time | EventBridge + Lambda | Specific resources you define |

A scheduled `terraform plan` that runs nightly and alerts on non-empty plans is the minimum viable drift detection for IaC-managed resources. Post the plan output to a Slack channel or create a ticket for every non-zero plan.

```yaml
# GitHub Actions — nightly drift detection
name: Drift Detection
on:
  schedule:
    - cron: '0 1 * * *'  # 1 AM daily

jobs:
  detect-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Terraform Plan
        id: plan
        run: |
          terraform init
          terraform plan -detailed-exitcode -out=tfplan
        continue-on-error: true
      - name: Alert on drift
        if: steps.plan.outputs.exitcode == '2'
        run: |
          echo "Drift detected — plan has changes"
```

### Observability for Infrastructure Changes

Infrastructure changes should be as observable as application deployments. Every Terraform apply should emit:
- Who triggered it (OIDC identity or CI runner identity).
- What changed (plan summary: N resources added, N modified, N destroyed).
- When it ran and how long it took.
- Whether it succeeded or failed, and why.

Most CI tools capture this in logs. The gap is making it queryable — a CI job that failed three weeks ago should be searchable when you are debugging a production issue that started at the same time. Emit structured apply events to CloudWatch or a centralized logging system.

Correlate infrastructure changes with application monitoring. If a Terraform apply runs at 14:32 and your error rate spikes at 14:33, you want to find that correlation in minutes, not hours.

### Managing Terraform Upgrades

Terraform and provider versions are dependencies that require active management. Letting them drift causes painful upgrade gaps.

Strategy:
- Pin all provider versions in `versions.tf` with `~>` (minor range) to receive patch fixes automatically while blocking major version changes.
- Run Dependabot or Renovate on the Terraform configuration repository to open PRs for version updates automatically.
- Upgrade one minor version at a time. Do not jump from Terraform 1.3 to 1.9 in one step — run the upgrade in test environments first and validate no resource re-creation is planned.
- Track the Terraform provider changelog for any resources you use that have breaking changes in major bumps.

### Toil Reduction

Toil is operational work that is manual, repetitive, and does not provide lasting value. IaC at scale generates toil in predictable places:

| Toil Source | Reduction Approach |
| :--- | :--- |
| **Running `terraform init` across directories** | Terragrunt `run-all` or a CI wrapper script |
| **Updating a module version across 50 consumers** | Renovate bot with auto-merge for patch versions |
| **Generating boilerplate for new modules** | Cookiecutter or Yeoman template with standard structure |
| **Manually creating backend config per env** | Terragrunt `remote_state` block with auto-creation |
| **Finding which module manages a given resource** | Consistent naming conventions + searchable state key design |
| **Reviewing plans with hundreds of resources** | State splitting so plans are scoped and readable |

---

## 11. Common Anti-Patterns

### Anti-Pattern: The God Module

A module that manages everything — VPC, subnets, security groups, EC2 instances, RDS databases, S3 buckets, IAM roles — in a single Terraform configuration. God modules feel convenient early because one `terraform apply` provisions an entire environment. They become unmanageable quickly because:
- Plans are enormous and unreadable.
- A change to a security group requires a plan that touches 200 resources.
- Blast radius is the entire environment.
- Team members queue behind each other for every apply.
- The state file becomes a corruption risk — one failed apply leaves the entire environment in an unknown state.

**Fix:** Split by lifecycle — resources that change together, own together. Networking, compute, and data services have different change frequencies and different owners.

### Anti-Pattern: Snowflake Environments

When each environment has been individually modified — through manual changes, one-off Terraform modifications, or "just this once" console clicks — the environments diverge from a shared baseline. A bug fixed in staging by a manual console change that is never propagated to production. A security group rule that exists in dev but not in prod. Configuration drift between environments.

Snowflake environments make "it works in staging" meaningless as a signal, because staging no longer accurately represents production.

**Fix:** Enforce immutable environments. All changes go through IaC. Manual changes are immediately reverted by the next Terraform apply. Use the `enforced` flag on your CI pipeline to treat any manual drift as an immediate action item.

### Anti-Pattern: Credential Sprawl

Long-lived AWS access keys stored in CI environment variables, passed between engineers via Slack, stored in `.env` files, or hardcoded in scripts. Every static credential is a security liability — it does not expire, it can be shared, and it is often over-privileged.

**Fix:** OIDC federation for CI runners. Instance profiles for EC2 and ECS tasks. IAM Roles Anywhere for on-premise systems. No static access keys, anywhere, ever, for machine identities.

### Anti-Pattern: Copy-Paste Module Consumption

Instead of using a versioned module, an engineer copies the module code directly into their configuration and modifies it. This feels efficient in the short term and creates a maintenance nightmare:
- Security patches to the module do not reach the copy.
- Bug fixes must be re-applied manually to each copy.
- The copies diverge — every "environment" becomes slightly different.
- There is no way to know how many copies exist or where.

**Fix:** Never copy module code. Source modules from the registry. If a module does not support a required use case, open a PR to the module to add the feature. If the module is external and cannot be modified, create a thin wrapper module that sources the external module and adds your requirement.

### Anti-Pattern: `terraform apply` in Production from a Laptop

An engineer, under pressure during an incident, runs `terraform apply` from their laptop against the production state. Problems:
- No PR review — no second pair of eyes on the change.
- No CI gate — no policy checks, no automated validation.
- The laptop's Terraform and provider versions may differ from the CI pipeline.
- The apply is not in the audit trail of the standard CI system.
- Local variable overrides, uncommitted code, or wrong workspace selection can cause unexpected changes.

**Fix:** Remove engineer IAM permissions to assume the Terraform CI role. All applies must go through the CI pipeline, even during incidents. For genuine break-glass scenarios, have a documented emergency apply process with a post-incident review requirement.

### Anti-Pattern: Ignoring Plan Output

The Terraform plan is the most valuable output IaC produces — it shows exactly what will change before it changes. Teams that rubber-stamp plan approval without reading it are getting no value from the review step.

Signs that plan review is broken: PRs approved in under 2 minutes, no comments on plans with resource destroys, production incidents caused by unexpected resource replacements that were visible in the plan.

**Fix:** Set a policy that any plan containing resource destroys or `forces replacement` requires explicit senior engineer sign-off. Configure Atlantis or CI to label PRs with plan summaries (adds X, changes Y, destroys Z) so reviewers are primed before they read the plan.

### Anti-Pattern: Unversioned Module Sources

```hcl
# Dangerous — will silently pick up breaking changes
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  # No version constraint
}
```

Without a version constraint, `terraform init` picks up the latest published version of the module — including breaking changes. A previously working configuration will fail unexpectedly after a module major version bump.

**Fix:** Every module source must have an explicit version constraint. For internal modules, use exact pins. For external community modules, use patch-range constraints (`~> 3.0`) with Renovate to manage version bumps as PRs.

---

## 12. Architecture Decision Cheatsheet

### Repository Pattern Selection

| Situation | Pattern |
| :--- | :--- |
| **Single team, < 5 engineers, < 3 accounts** | Monorepo, flat structure |
| **Multiple teams, shared infrastructure** | Monorepo with team directories and shared modules |
| **Many teams, strict access isolation** | Polyrepo with published module registry |
| **Enterprise scale, compliance separation** | Polyrepo + module registry + config repo |

### State Split Boundaries

| Component | Split State? | Rationale |
| :--- | :--- | :--- |
| **Account bootstrap (IAM, Config, CloudTrail)** | Yes — always separate | Changes rarely; high blast radius; often requires elevated permissions |
| **Networking (VPC, subnets, TGW)** | Yes — always separate | Changes rarely; shared by multiple teams; must not be blocked by app changes |
| **Shared data services (RDS, MSK, ElastiCache)** | Yes | Different lifecycle from compute; data engineers may own this layer |
| **Compute platform (EKS, ECS clusters)** | Yes | Different change frequency from applications |
| **Application configuration (services, functions)** | Yes — per application or team | High change frequency; team-owned; must apply independently |
| **DNS records** | Yes — often separate | Very high change frequency; application teams may need self-service |

### Secrets Handling Decision Matrix

| Scenario | Approach |
| :--- | :--- |
| **Database password needed by RDS** | Generate with `random_password`; store in Secrets Manager; pass ARN to application |
| **API key from external service** | Store in Secrets Manager manually; reference via `aws_secretsmanager_secret_version` data source in Terraform; never in `.tf` files |
| **TLS certificate** | Use ACM (managed by AWS); or import via `aws_acm_certificate` with cert stored in Secrets Manager |
| **SSH key pair** | Generate externally; import public key only via `aws_key_pair`; never the private key |
| **Terraform variable that is a secret** | Mark `sensitive = true`; pass via CI environment variable, never in `tfvars` committed to repo |

### Module Abstraction Level Decision

| Use Case | Correct Abstraction |
| :--- | :--- |
| **A new team needs a VPC** | Composition module — they should not configure subnets and route tables |
| **A team needs an S3 bucket with defaults** | Thin wrapper module over community module |
| **A team needs a Lambda function with one-off needs** | Root module using community modules directly; evaluate generalization later |
| **A capability that five teams all need with variation** | Resource module with well-designed input variables to handle the variation |
| **A one-off resource that only one team uses** | Direct resource in their root module; do not over-abstract |

### CI/CD Apply Strategy

| Org Size | Recommended Pipeline | Reason |
| :--- | :--- | :--- |
| **Small (< 5 infra engineers)** | GitHub Actions; plan on PR; manual apply on merge | Simple; low overhead |
| **Medium (5–20 infra engineers)** | Atlantis or GitHub Actions with environment gates | PR-centric; prevents concurrent applies |
| **Large (> 20 infra engineers)** | Spacelift, env0, or Terraform Cloud | Policy enforcement, drift detection, audit trail at enterprise scale |
| **Multi-team, strict governance** | Terraform Cloud + Sentinel policies | Native policy integration with Terraform plan graph |

### Drift Response Matrix

| Drift Type | Discovery | Response |
| :--- | :--- | :--- |
| **Manual change by engineer (unintentional)** | Nightly plan shows diff | Revert via Terraform apply; post-incident if production |
| **Manual change by engineer (intentional fix)** | Nightly plan shows diff | Codify the change in IaC; apply to make state match; document why |
| **AWS-initiated change to managed service** | Nightly plan shows diff | Evaluate: if AWS changed a default, update IaC to match or override explicitly |
| **Drift caused by another IaC stack** | Ownership conflict in plan | Resolve ownership; one stack removes resource from state; owner manages it |
| **Drift undetectable by Terraform** | AWS Config or custom check | Use Systems Manager State Manager or Ansible to enforce config |

---

*Last updated: 2026-Q2 | Primary toolchain: Terraform (OpenTofu) + Terragrunt + Atlantis | Registry: Private Terraform registry | Policy engine: OPA + Conftest | CI: GitHub Actions with OIDC | State backend: S3 + DynamoDB*
