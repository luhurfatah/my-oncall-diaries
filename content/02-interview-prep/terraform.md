# Terraform Interview Preparation

### Q: What is Terraform Cloud, and how does it differ from using Terraform locally?

<details>
<summary>Show Answer</summary>

**Terraform Cloud** is a managed SaaS platform by HashiCorp that adds collaboration, remote execution, and governance capabilities on top of Terraform's core engine.

**Core differences:**

| Dimension | Local Terraform | Terraform Cloud |
| :--- | :--- | :--- |
| **State storage** | Local `.tfstate` or self-managed S3/GCS backend | Managed, encrypted, versioned state per workspace |
| **Execution** | Runs on your machine or CI runner | Remote runs in isolated HCP-managed agents |
| **Locking** | Depends on backend (DynamoDB for S3) | Native state locking built in |
| **Secrets/vars** | `.tfvars`, env vars, external vaults | Workspace variables (sensitive, masked in UI/logs) |
| **Collaboration** | Git + manual coordination | Run queue, approvals, Sentinel policies, audit logs |
| **Cost estimation** | Not built in | Built in (pre-apply cost delta) |
| **VCS integration** | None native | GitHub/GitLab/Bitbucket triggers via webhooks |

**Key architectural points:**
- In **remote execution mode**, your local CLI becomes a thin proxy — the plan/apply happen in the Cloud agent, not your laptop. This is important for security since provider credentials live in the workspace, not on developer machines.
- **Sentinel** (policy as code) is Terraform Cloud's enforcement layer — it gates runs before apply, enabling compliance rules like "no public S3 buckets" without relying on developer discipline.
- Terraform Cloud **workspaces** map 1:1 to a state file + variable set, unlike local workspaces which are just state file variants in the same backend.

> **Gotcha:** Remote execution requires your modules and providers to be resolvable from HCP's network. Private module registries or on-prem providers require **Terraform Cloud Agents** running inside your network.

</details>

---

### Q: How do you structure a Terraform project when starting out?

<details>
<summary>Show Answer</summary>

For a small project or single-environment setup, the goal is **clarity over abstraction** — don't over-engineer before you understand the blast radius of your resources.

**Recommended starter layout:**

```
project/
├── main.tf          # Core resources
├── variables.tf     # Input variable declarations
├── outputs.tf       # Output value declarations
├── providers.tf     # Provider config + version constraints
├── backend.tf       # Remote backend config (S3 + DynamoDB, or Terraform Cloud)
├── terraform.tfvars # Local variable values (gitignored for sensitive data)
└── README.md
```

**Key practices at this stage:**
- Always define a **remote backend** from day one — local state causes disasters in teams and is hard to migrate later.
- Pin **provider versions** using `required_providers` with `~>` constraints to avoid surprise upgrades.
- Separate `terraform.tfvars` per environment using `-var-file` flags rather than branching your code.
- Use `outputs.tf` liberally — outputs become the interface when you later split into modules.

**When to split into modules:** When a logical group of resources is reused in more than one place, or when a single file exceeds ~150–200 lines and becomes hard to reason about.

> **Gotcha:** Don't put `backend.tf` inside a module — backends are only valid in root configurations. Modules inherit the caller's backend.

</details>

---

### Q: How do you structure your Terraform code for large-scale infrastructure?

<details>
<summary>Show Answer</summary>

At scale, the primary concerns are **state isolation**, **blast radius control**, and **DRY configuration** across environments and accounts. The answer is a layered architecture with opinionated conventions.

**Three-tier structure:**

```
infrastructure/
├── modules/                  # Reusable, versioned internal modules
│   ├── networking/
│   ├── eks-cluster/
│   └── rds-postgres/
├── live/                     # Environment-specific root configs
│   ├── prod/
│   │   ├── networking/
│   │   ├── eks/
│   │   └── databases/
│   └── staging/
│       └── ...
└── terragrunt.hcl            # Root Terragrunt config (if using Terragrunt)
```

**Key structural principles:**

- **One state file per logical unit** — never put all resources in one root. A `networking` state and a `compute` state should be separate. This limits the impact of a bad plan.
- **Modules are the API** — root configs (`live/`) should be thin wrappers that call modules with environment-specific inputs. Business logic lives in modules.
- **Use Terragrunt** for large environments — it handles DRY `backend` and `provider` blocks via `generate` blocks, eliminates boilerplate, and supports dependency graphs across state files with `dependency {}` blocks.
- **Remote state references** replace direct resource references across state files — use `terraform_remote_state` or Terragrunt `dependency` to pass outputs (e.g., VPC IDs from networking → compute).
- **Version-pin modules** using Git tags (`source = "git::...?ref=v1.3.0"`) or a private registry so environments can be on different module versions during a rollout.

> **Gotcha:** Avoid using `count` or `for_each` at the root level to manage environments — this couples all environments into one state file and means a plan for prod evaluates staging resources too.

</details>

---

### Q: Explain your strategy for managing Terraform state in a team environment.

<details>
<summary>Show Answer</summary>

State management is where Terraform breaks down in teams without deliberate design. The strategy has three pillars: **isolation**, **locking**, and **access control**.

**Backend choice:**

| Backend | Locking | Encryption | Team Suitability |
| :--- | :--- | :--- | :--- |
| **S3 + DynamoDB** | DynamoDB native | S3 SSE | Standard AWS teams |
| **Terraform Cloud** | Built in | Managed | Cross-cloud or SaaS-first |
| **GCS** | Native object lock | GCS SSE | GCP teams |
| **Azure Blob** | Lease-based | Azure SSE | Azure teams |

**State isolation strategy:**
- One state file per **environment × layer** (e.g., `prod/networking`, `prod/eks`, `staging/networking`). Never share state across environments.
- Use **workspace separation** only for truly identical configurations (e.g., ephemeral feature environments) — not for prod/staging/dev which often diverge.
- Each state file should be stored under a path convention: `<account-id>/<region>/<env>/<layer>/terraform.tfstate`.

**Locking:**
- **S3 backend requires explicit DynamoDB table** for locking — the table needs a `LockID` (String) primary key. Without this, concurrent runs corrupt state.
- Terraform Cloud and GCS lock automatically.

**Access control:**
- Restrict `terraform apply` to CI/CD pipelines only in production — no direct human applies.
- Use **IAM roles** scoped to what each state layer needs (e.g., networking role can't touch IAM).
- Enable **S3 versioning** and **MFA delete** on the state bucket to support rollback and prevent accidental deletion.

> **Gotcha:** `terraform state mv` and `terraform state rm` are untracked operations — they bypass plan/apply and directly mutate state. Always take a manual backup (`terraform state pull > backup.tfstate`) before any state manipulation.

</details>

---

### Q: How do you handle secret management with Terraform?

<details>
<summary>Show Answer</summary>

The core principle: **secrets should never be stored in `.tfstate`, `.tfvars`, or version control.** Terraform's state is JSON in plaintext at rest unless the backend encrypts it — and even then, it's still readable by anyone with backend access.

**Approaches by context:**

| Approach | When to Use | Risk |
| :--- | :--- | :--- |
| **AWS Secrets Manager / SSM Parameter Store data sources** | Runtime secret retrieval (DB passwords, API keys) | Secret value still lands in state |
| **Vault provider (`vault_generic_secret`)** | Dynamic secrets, short-lived credentials | Requires Vault infra; values in state |
| **Environment variables (`TF_VAR_*`)** | CI/CD pipeline secrets | Ephemeral; never on disk |
| **`sensitive = true` on variables/outputs** | Suppress values in plan/apply output | Doesn't encrypt in state — just redacts from logs |
| **External data sources + `nonsensitive()`** | Read-only secret injection at plan time | Values exist in memory during run |

**Recommended pattern for DB credentials:**
1. Generate credentials outside Terraform (Secrets Manager, Vault).
2. Pass the **ARN or path** as a Terraform input, not the value.
3. Use a `data "aws_secretsmanager_secret_version"` source at runtime — the consuming application fetches the secret directly, not Terraform.
4. For resources that require a password argument (e.g., `aws_db_instance`), use `lifecycle { ignore_changes = [password] }` after initial creation and rotate externally.

> **Gotcha:** Even `sensitive = true` doesn't protect secrets in state — the value is stored in plaintext in `tfstate`. The mitigation is encrypting the backend (S3 SSE + bucket policy restricting access) and using **Terraform Cloud's encrypted state** if available. Treat `.tfstate` like a credential file.

</details>

---

### Q: What's your approach to testing Terraform code?

<details>
<summary>Show Answer</summary>

Terraform testing exists on a spectrum from cheap/fast static checks to expensive/slow real infrastructure validation. A mature pipeline combines multiple layers.

**Testing pyramid:**

| Layer | Tool | What It Catches | Cost |
| :--- | :--- | :--- | :--- |
| **Static analysis** | `terraform validate`, `tflint` | Syntax, type errors, provider rule violations | Free, fast |
| **Security scanning** | `checkov`, `tfsec`, `trivy` | Misconfigurations (public buckets, open SGs) | Free, fast |
| **Format check** | `terraform fmt -check` | Style consistency in CI | Free, instant |
| **Unit/contract tests** | `terraform test` (v1.6+) | Mock provider calls, module input/output contracts | Fast, no real infra |
| **Integration tests** | **Terratest** (Go) | Real infra provisioned + assertions + destroy | Expensive, minutes–hours |
| **Plan diffing** | `infracost`, `terraform plan -out` | Cost delta, resource count change detection | Moderate |

**`terraform test` (native, v1.6+):**
```hcl
# tests/main.tftest.hcl
run "creates_vpc_with_correct_cidr" {
  command = plan
  assert {
    condition     = aws_vpc.main.cidr_block == "10.0.0.0/16"
    error_message = "VPC CIDR mismatch"
  }
}
```
Use `command = plan` for mock-based unit tests; `command = apply` for real integration tests in ephemeral test accounts.

**Terratest pattern:**
```go
func TestEksModule(t *testing.T) {
    opts := &terraform.Options{TerraformDir: "../modules/eks"}
    defer terraform.Destroy(t, opts)
    terraform.InitAndApply(t, opts)
    clusterName := terraform.Output(t, opts, "cluster_name")
    assert.NotEmpty(t, clusterName)
}
```

> **Gotcha:** Never run integration tests against production accounts or shared environments. Use a dedicated **test account** with a nightly cleanup Lambda or `defer terraform.Destroy` to prevent resource leakage and cost accumulation.

</details>

---

### Q: How would you implement a multi-environment infrastructure using Terraform?

<details>
<summary>Show Answer</summary>

The decision point is: **are your environments structurally identical or do they meaningfully diverge?** This determines whether you use workspaces, variable files, or full directory separation.

**Option comparison:**

| Strategy | Isolation | Divergence Support | Recommended For |
| :--- | :--- | :--- | :--- |
| **Directory-per-env** (`live/prod/`, `live/staging/`) | Full state isolation | High — each env has its own config | Most production systems |
| **Workspaces** | Separate state per workspace | Low — same code, different var values | Identical ephemeral envs (feature branches) |
| **`-var-file` flag** | Shared state if not combined with directories | Medium | Simple projects, single account |

**Recommended: Directory + Terragrunt DRY pattern**

```
live/
├── _env_defaults/
│   └── terraform.tfvars        # Shared defaults
├── prod/
│   ├── networking/
│   │   └── terragrunt.hcl      # calls module, sets prod-specific inputs
│   └── eks/
│       └── terragrunt.hcl
└── staging/
    ├── networking/
    │   └── terragrunt.hcl
    └── eks/
        └── terragrunt.hcl
```

Each `terragrunt.hcl` sets:
- `inputs = { env = "prod", instance_type = "m5.xlarge" }`
- `remote_state` path derived from path hierarchy (no copy-paste backend config)

**Key controls per environment:**
- Prod: manual approval gate in CI, `prevent_destroy = true` on critical resources, stricter IAM boundaries.
- Staging: auto-apply on merge, auto-teardown schedules for cost control.
- Dev: workspace-per-developer or ephemeral environments via PR automation.

> **Gotcha:** Terraform workspaces share the same provider configuration. If prod and dev are in separate AWS accounts (which they should be), workspaces are not appropriate — directory separation with per-env provider role assumptions is required.

</details>

---

### Q: How do you manage infrastructure drift in IaC environments?

<details>
<summary>Show Answer</summary>

**Drift** occurs when the real infrastructure state diverges from what's in the Terraform state or code — caused by manual console changes, other automation tools, or external events (e.g., auto-scaling, AWS service updates).

**Detection mechanisms:**

- **`terraform plan`** is the primary drift detector — run it on a schedule (daily/hourly via CI) even when no changes are intended. Any non-empty plan output signals drift.
- **`terraform refresh`** (now `-refresh-only` in v1.x) updates the state file to match real resources without applying any changes. Run this to see the gap between state and reality.
- **AWS Config + Config Rules** can detect drift independently of Terraform — useful for compliance enforcement.
- **Drift detection in Terraform Cloud/Enterprise** — built-in scheduled runs with drift notifications.

**Remediation strategy:**

| Drift Type | Action |
| :--- | :--- |
| Accidental manual change | Re-apply Terraform to restore declared state |
| Intentional emergency change | Update `.tf` code to match reality, then `terraform plan` should be clean |
| Resource added outside Terraform | `terraform import` + write the resource in code |
| Resource deleted outside Terraform | Re-apply creates it, or remove from code if intentional |

**Prevention:**
- **SCPs / IAM policies** that deny direct console access to infrastructure accounts — all changes must go through IaC pipelines.
- **CloudTrail alerts** on manual resource modifications in prod — page on-call when drift is introduced.
- `lifecycle { prevent_destroy = true }` on stateful resources prevents accidental deletion but doesn't prevent manual modification.

> **Gotcha:** `terraform refresh` and `-refresh-only` update the state file to match reality. If someone deleted a resource manually, this will remove it from state — and a subsequent plan may try to recreate it. Always review `-refresh-only` output before accepting it.

</details>

---

### Q: How do you version and modularize Terraform code across many AWS accounts and environments?

<details>
<summary>Show Answer</summary>

At scale (many accounts, regions, environments), the answer is a **versioned internal module registry** backed by Git tags, consumed via Terragrunt with centralized version pinning.

**Module versioning strategy:**

```hcl
# Pinned to a semver tag in an internal Git repo or Terraform Registry
module "eks" {
  source  = "git::https://github.com/org/terraform-modules.git//modules/eks?ref=v2.4.1"
  # or via private Terraform Registry:
  # source  = "app.terraform.io/org/eks/aws"
  # version = "~> 2.4"
  
  cluster_name = var.cluster_name
  node_count   = var.node_count
}
```

**Module structure best practices:**
- One module per logical service or resource group (`eks-cluster`, `rds-postgres`, `vpc`).
- Modules expose a minimal, stable interface via `variables.tf` with sensible defaults.
- Treat breaking changes (removed variables, renamed outputs) as major version bumps — use **semantic versioning** on Git tags.
- Use a **CHANGELOG.md** per module; require PR review + tag creation as a release gate.

**Cross-account consumption pattern with Terragrunt:**

```hcl
# terragrunt.hcl in live/prod/us-east-1/eks/
terraform {
  source = "git::https://github.com/org/terraform-modules.git//modules/eks?ref=v2.4.1"
}

inputs = {
  cluster_name = "prod-us-east-1"
  node_count   = 10
}
```

The Terragrunt root `terragrunt.hcl` dynamically generates the backend config from the directory path — so every environment gets isolated state with zero duplication.

> **Gotcha:** Avoid using `source = "../../modules/eks"` (relative local paths) in production environments. It ties the calling config and the module to the same Git tag, making independent versioning impossible. Use absolute Git refs.

</details>

---

### Q: What are your strategies for managing provider versions and dependency locking in Terraform?

<details>
<summary>Show Answer</summary>

Provider version management is critical — AWS provider minor versions regularly introduce breaking changes or behavior differences. The **`.terraform.lock.hcl`** file is the primary mechanism.

**Lock file mechanics:**
- Generated by `terraform init`, it records the exact provider version and its checksums for all platforms.
- **Commit `.terraform.lock.hcl` to version control** — this ensures every team member and CI runner uses the identical provider binary.
- Update explicitly with `terraform init -upgrade` after intentional version bumps in `required_providers`.

**Version constraint strategy:**

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"   # Allows 5.40.x, blocks 6.x
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.20, < 3.0"
    }
  }
  required_version = ">= 1.6.0, < 2.0.0"
}
```

- `~> 5.40` is the standard recommendation — allows patch updates, blocks minor/major.
- `~> 5.0` allows minor updates — acceptable for mature providers, risky for AWS.
- Never use an unconstrained `version = ">= 5.0"` in production.

**Multi-platform lock file:**
CI runners (Linux amd64) and developer machines (macOS arm64) need different checksums. Generate cross-platform lock files with:
```bash
terraform providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64 \
  -platform=windows_amd64
```

> **Gotcha:** If `.terraform.lock.hcl` is gitignored (common mistake), each `terraform init` resolves the latest matching version — leading to silent provider upgrades between runs that can break plans or applies.

</details>

---

### Q: How can you avoid conflicts when multiple engineers are working with Terraform?

<details>
<summary>Show Answer</summary>

Conflicts in Terraform come from two sources: **state file corruption from concurrent runs** and **code merge conflicts**. Address both independently.

**Preventing concurrent run conflicts:**

- **State locking** is the first line of defense — S3+DynamoDB, Terraform Cloud, or GCS all support it. A locked state rejects any concurrent `plan` or `apply`.
- **Run Terraform only in CI/CD** — ban local applies to shared environments. Engineers propose changes via PR; the pipeline executes. This serializes all runs naturally.
- **Terraform Cloud run queue** — runs are queued per workspace; concurrent triggers don't race.

**Preventing code conflicts:**

- **Small, focused PRs** — each PR should touch one layer (e.g., only `networking/` or only `eks/`). Large PRs that span layers cause merge conflicts and make review hard.
- **State isolation by layer** — if `networking` and `compute` are separate state roots, teams can work on them in parallel without interfering.
- **Module versioning** — teams consuming a module reference a fixed version tag. The module team can develop the next version without breaking consumers.

**Workflow:**

```
Engineer A → PR for networking change
Engineer B → PR for EKS change
         ↓
Both PRs can be reviewed, planned, and merged independently
CI applies one at a time; state locks prevent races
```

> **Gotcha:** Even with state locking, two engineers editing the same `.tf` file create a **code merge conflict** — not a state conflict. The mitigation is scope discipline (one concern per PR) and frequent rebases, not Terraform-specific tooling.

</details>

---

### Q: What is the purpose of the `terraform import` command, and when would you use it?

<details>
<summary>Show Answer</summary>

`terraform import` brings an **existing real-world resource under Terraform management** by associating it with a resource block in your configuration and writing its current state into the state file. It does not modify the resource.

**When to use:**
- Infrastructure was provisioned manually (console, CLI, SDK) and you want to adopt IaC without re-creating it.
- A resource was removed from state (accidental `terraform state rm`) but still exists in the cloud.
- Migrating from one Terraform root/workspace to another.
- Taking over a resource previously managed by another tool (CloudFormation, Pulumi, CDK).

**Workflow:**

```bash
# 1. Write the resource block in .tf code (must match the real resource)
# resource "aws_vpc" "main" { ... }

# 2. Import by resource address and provider-specific ID
terraform import aws_vpc.main vpc-0abc123def456

# 3. Run terraform plan — expect a non-empty diff if your .tf config doesn't match reality
# 4. Reconcile .tf code until plan shows no changes
```

**Bulk import (Terraform v1.5+ `import` blocks):**
```hcl
import {
  to = aws_vpc.main
  id = "vpc-0abc123def456"
}
```
This allows plan-time import preview and is scriptable — generate import blocks programmatically for bulk adoption.

**Provider-specific IDs:** Each resource type defines its import ID format. Check provider docs — for `aws_iam_role`, it's the role name; for `aws_db_instance`, it's the DB instance identifier; for `aws_route53_record`, it's `zone_id/name/type`.

> **Gotcha:** `terraform import` only imports one resource at a time (for CLI form). It does not import child resources — e.g., importing an `aws_security_group` does not import its `aws_security_group_rule` resources. You must import each individually. The v1.5 `import` block approach combined with `terraform plan -generate-config-out` can auto-generate `.tf` config as a starting point.

</details>

---

### Q: How can you implement Terraform workspaces in a multi-environment setup?

<details>
<summary>Show Answer</summary>

**Terraform workspaces** create isolated state files within the same backend configuration, with the current workspace name available as `terraform.workspace`. They are appropriate for a **narrow use case** — environments that share identical code and infrastructure topology.

**How it works:**

```hcl
# Use workspace name to differentiate resource naming and sizing
locals {
  env     = terraform.workspace  # "prod", "staging", "dev"
  is_prod = terraform.workspace == "prod"
}

resource "aws_instance" "app" {
  instance_type = local.is_prod ? "m5.xlarge" : "t3.medium"
  tags = { Environment = local.env }
}
```

```bash
terraform workspace new staging
terraform workspace select prod
terraform workspace list
```

**When workspaces ARE appropriate:**
- Ephemeral PR environments (feature-branch deployments using the branch name as the workspace).
- Identical test environments spun up in the same account for parallel testing.

**When workspaces are NOT appropriate:**

| Scenario | Why Workspaces Fail |
| :--- | :--- |
| Prod vs staging in different AWS accounts | Same provider config; can't assume different roles per workspace natively |
| Environments with diverging architecture | Logic branches in code become complex and error-prone |
| Long-lived, high-stakes environments | Risk of accidental cross-environment applies if wrong workspace selected |

**The alternative** for true multi-account/multi-env is **directory-per-environment** with separate backend paths and per-env provider role assumptions — this gives full isolation with no shared config risk.

> **Gotcha:** When using workspaces, `terraform apply` targets whichever workspace is currently selected. Engineers accidentally applying to `prod` when they intended `staging` is a real incident pattern. CI/CD mitigates this — automate workspace selection based on the triggering branch, and never allow manual workspace selection in prod.

</details>

---

### Q: What is the role of a backend in Terraform, and why is it important?

<details>
<summary>Show Answer</summary>

The **backend** in Terraform defines two things: **where state is stored** and **how operations are executed** (local vs. remote). It is the most operationally critical configuration in any production Terraform setup.

**State storage role:**
- The state file is Terraform's source of truth — it maps `.tf` resources to real cloud resource IDs, tracks metadata, and enables dependency resolution.
- Without a remote backend, state is stored locally in `terraform.tfstate` — lost on machine failure, inaccessible to teammates, unversioned.

**Execution role:**
- **Standard backends** (S3, GCS, Azure Blob, Consul) handle state storage only — execution is local.
- **Enhanced backends** (Terraform Cloud) handle both state and remote execution — plans and applies run on managed infrastructure.

**S3 backend example:**

```hcl
terraform {
  backend "s3" {
    bucket         = "org-terraform-state"
    key            = "prod/networking/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
    role_arn       = "arn:aws:iam::123456789012:role/TerraformBackendRole"
  }
}
```

**Why each attribute matters:**
- `encrypt = true` — enables SSE-S3 (or SSE-KMS with `kms_key_id`) at rest.
- `dynamodb_table` — enables state locking; without this, concurrent runs corrupt state.
- `key` — the path within the bucket; must be unique per root configuration.
- `role_arn` — allows cross-account backend access without static credentials.

> **Gotcha:** Backend configuration cannot use Terraform variables or `locals` — it's evaluated before the normal Terraform init phase. This is why Terragrunt's `generate "backend"` block exists: to dynamically generate `backend.tf` from Terragrunt inputs, working around Terraform's static backend constraint.

</details>

---

### Q: How do you enable self-service infrastructure for developers?

<details>
<summary>Show Answer</summary>

Self-service IaC means developers can provision approved infrastructure without writing Terraform themselves or waiting for a platform team. The architecture combines a **module abstraction layer**, **policy guardrails**, and a **delivery mechanism**.

**Architecture layers:**

```
Developer Intent
      ↓
Service Catalog / Platform UI / GitHub template
      ↓
Approved Terraform module (internal registry)
      ↓
CI/CD pipeline (GitHub Actions, Atlantis, Terraform Cloud)
      ↓
Sentinel / OPA policies (guardrails)
      ↓
Cloud infrastructure
```

**Key components:**

- **Internal Terraform module registry** — publish versioned, tested modules for common patterns (RDS instance, EKS namespace, S3 bucket). Developers `source` from here, not from scratch.
- **Atlantis or Terraform Cloud** — developers open a PR with their infrastructure config; `atlantis plan` runs automatically. The PR shows the plan output for review before merge triggers `apply`.
- **Sentinel / OPA policies** — enforce guardrails without blocking self-service: "all S3 buckets must have encryption", "EC2 instances in prod must use approved AMIs", "cost delta must be < $500/month".
- **GitHub template repositories** — developers fork a template that already has the correct module source, backend config, and CI workflow. They only fill in the `inputs = {}`.
- **`tfvars` schema validation** — use `variable` type constraints and `validation` blocks in modules to reject invalid inputs early.

**Developer experience target:**
```bash
# Developer creates: infra/my-service/main.tf (using approved template)
# Opens PR → Atlantis comments with plan
# Gets approval → Atlantis applies on merge
# Done — no Terraform expertise required
```

> **Gotcha:** Self-service without cost visibility creates runaway spend. Integrate **Infracost** into the PR comment alongside the plan — show the monthly cost delta before merge. Pair with **budget alerts** per team or cost allocation tags enforced by Sentinel.

</details>

---

### Q: How do you write reusable Terraform modules?

<details>
<summary>Show Answer</summary>

A reusable module is one that can be consumed in multiple environments and contexts without modification — it achieves this through a **stable interface**, **sensible defaults**, and **no hardcoded assumptions**.

**Module structure:**

```
modules/rds-postgres/
├── main.tf           # Resource definitions
├── variables.tf      # All inputs declared with types, descriptions, defaults
├── outputs.tf        # All useful attributes exported
├── versions.tf       # required_providers + required_version
└── README.md         # Usage example, input/output table
```

**Interface design principles:**

```hcl
# variables.tf — good interface design
variable "instance_class" {
  type        = string
  description = "RDS instance class (e.g., db.t3.medium)"
  default     = "db.t3.medium"

  validation {
    condition     = can(regex("^db\\.", var.instance_class))
    error_message = "instance_class must start with 'db.'"
  }
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to all resources"
  default     = {}
}
```

**Key practices:**
- **Type everything** — use `type = string`, `object({})`, `list(string)`. Untyped inputs accept anything and fail at runtime.
- **Expose `tags` as a variable** — pass tags from the caller; modules shouldn't set their own tags unilaterally.
- **No hardcoded account IDs, regions, or ARNs** — use data sources (`data "aws_region" "current"`) instead.
- **Output everything useful** — IDs, ARNs, DNS names, security group IDs. Callers can't use what you don't export.
- **`lifecycle` blocks when necessary** — some resources need `create_before_destroy` or `ignore_changes`; encode this in the module so callers don't have to know.
- **Avoid calling child modules from inside a module** unless the abstraction is intentional — deep module nesting makes debugging painful.

> **Gotcha:** Modules that use `provider` meta-arguments (e.g., aliased providers for multi-region) are difficult to reuse because the caller must pass matching provider aliases. Prefer passing region as a variable and letting the caller configure the provider rather than embedding provider config in the module.

</details>

---

### Q: How do you safely roll back infrastructure changes after a failed deployment?

<details>
<summary>Show Answer</summary>

Terraform has no native "rollback" command — rolling back means **re-applying a previous known-good configuration**. The strategy depends on whether the failure happened during `plan`, mid-`apply`, or post-`apply`.

**Scenarios and responses:**

| Failure Point | State | Action |
| :--- | :--- | :--- |
| Plan failure | State unchanged | Fix code, re-run |
| Mid-apply failure | Partial state (some resources created) | Run `terraform apply` again — Terraform is idempotent for completed resources and will retry failed ones |
| Post-apply: bad config deployed | State reflects new config | Revert code to previous version + `terraform apply` |
| Post-apply: state corrupted | State inconsistent | Restore state from S3 versioned backup |

**Standard rollback procedure:**

```bash
# 1. Revert code to last known-good Git commit
git revert HEAD  # or git checkout <previous-tag> -- module/

# 2. Run plan to verify revert produces the expected diff
terraform plan

# 3. Apply
terraform apply
```

**State backup/restore (emergency):**
```bash
# Pull current (possibly corrupted) state
terraform state pull > state_corrupt_backup.json

# Retrieve previous version from S3
aws s3api get-object \
  --bucket org-terraform-state \
  --key prod/eks/terraform.tfstate \
  --version-id <VERSION_ID> \
  restored.tfstate

# Push restored state
terraform state push restored.tfstate
```

**Prevention is the primary strategy:**
- **`prevent_destroy = true`** on stateful resources (RDS, S3 data buckets) prevents accidental destruction during a bad apply.
- **Blue/green for compute** — deploy new ASG/EKS node group alongside existing; shift traffic; destroy old. Rollback = shift traffic back.
- **Module version pinning** — environment configs reference a specific module tag. Rolling back means changing the tag reference, not the module itself.
- **Plan approval gates in CI** — require human approval of plan output for prod before apply. Catches destructive changes before they execute.

> **Gotcha:** `terraform apply` on a partially-failed state is often safer than a manual rollback because Terraform knows what succeeded. Attempting manual state manipulation or `terraform destroy` on partial state risks destroying things that were correctly applied. Always try `terraform apply` again first before state surgery.

</details>

---
---

## 📚 Question Reference

Additional questions and topic coverage sourced from **[acecloudinterviews.com/questions](https://www.acecloudinterviews.com/questions/)**.
