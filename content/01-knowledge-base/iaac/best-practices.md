# Terraform Best Practices & Core Principles

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Core Principles](#1-core-principles) | Declarative infrastructure, everything in Git, and least privilege rules. |
| **02** | [Project Structure](#2-project-structure) | Multi-environment directories, flat layouts, and folder recommendations. |
| **03** | [Provider & Version Pinning](#3-provider-version-pinning) | versions.tf configuration, Pessimistic constraint patterns (~), and lock files. |
| **04** | [Remote State & Backend](#4-remote-state-backend) | S3 & DynamoDB backend setup, state locking resources, and key state commands. |
| **05** | [Variables & Outputs](#5-variables-outputs) | Early validation blocks, sensitive markings, and variable precedence rules. |
| **06** | [Module Design](#6-module-design) | Module sourcing strategies, parameterization, and tag pinning. |
| **07** | [Loops & Dynamic Blocks](#7-loops-dynamic-blocks) | Stable resource addresses with `for_each` vs `count` index shift vulnerabilities. |
| **08** | [Locals & Tagging Strategy](#8-locals-tagging-strategy) | DRY calculations, provider default_tags, and tag policies. |
| **09** | [Lifecycle Rules](#9-lifecycle-rules) | prevent_destroy, create_before_destroy, and ignore_changes. |
| **10** | [Refactoring: Import & Moved Blocks](#10-refactoring-import-moved-blocks) | Moved blocks and import declarations for safe cloud restructurings. |
| **11** | [Common Anti-Patterns to Avoid](#11-common-anti-patterns-to-avoid) | Storing secrets in Git, monolithic states, and ignoring plan output. |

---

## 1. Core Principles

To manage cloud infrastructure at scale, standardizing on a set of immutable operational principles is crucial:

- **Declarative Infrastructure:** Describe the *desired end state* of the resource graph, not the step-by-step instructions to get there. Let the execution engine own the API reconciliation.
- **Single Source of Truth:** All files, modules, state configurations, and variables must be tracked in Git. No manual mutations are permitted.
- **Plan Verification:** Review the exact plan delta with `terraform plan` before applying. Never run a blind apply in a pipeline or local terminal.
- **Decoupled Lifecycle Ownership:** Split your resource stacks along natural ownership and change frequency boundaries to isolate risk and speed up delivery.
- **Principle of Least Privilege:** Run the planning and application stages using scoped, OIDC-federated IAM roles with only the necessary cloud permissions.

---

## 2. Project Structure

Standardizing repository layouts ensures consistent engineering onboarding and pipeline automation.

### Flat Layout (Small Workloads Only)

```text
.
├── main.tf
├── variables.tf
├── outputs.tf
├── providers.tf
├── versions.tf
└── terraform.tfvars
```

### Multi-Environment Layout (Recommended Enterprise Pattern)

```text
.
├── modules/
│   ├── vpc/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── eks/
│   └── rds/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── providers.tf
│   │   └── backend.tf
│   ├── staging/
│   └── prod/
└── .terraform-version       # Pin version via tfenv
```

- **Environment Isolation:** Each environment maintains **its own remote state file** and state path, completely isolating the blast radius.
- **Reusable Modules:** The directories under `environments/` act as consumer root modules that ingest standard inputs to instantiate modules located under `modules/` or external registries.
- **Zero Hardcoded Secrets:** Never put credentials, API keys, or database passwords in `.tf` files or `tfvars` committed to version control.

---

## 3. Provider & Version Pinning

Always establish tight constraints for both the Terraform execution engine and the downstream cloud providers inside a dedicated `versions.tf` file.

```hcl
# versions.tf
terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"       # Allow 5.x patch upgrades, block major 6.x changes
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
  }
}
```

- **Lock Dependency Trees:** Always commit the automatically generated `.terraform.lock.hcl` file to your Git repository. This tracks exact provider hashes and ensures binary parity across developer machines and build pipelines.
- **Pessimistic Pinning (`~>`):** Use the pessimistic operator to automatically adopt non-breaking bug fixes and patches while protecting against breaking major upgrades.
- **Standardize Execution Engines:** Enforce a single runner version using tools like `tfenv` and keep a `.terraform-version` file at the repository root.

---

## 4. Remote State & Backend

For multi-engineer collaboration, the state file must live in a central secure remote backend with concurrency control (locking).

```hcl
# backend.tf (AWS S3 example)
terraform {
  backend "s3" {
    bucket         = "my-tf-state-prod"
    key            = "app/prod/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true                      # Force server-side encryption
    dynamodb_table = "terraform-state-lock"    # Concurrent apply control
    kms_key_id     = "arn:aws:kms:..."         # Customer-managed KMS Key ARN
  }
}
```

### State Locking with DynamoDB

```hcl
# Create this table once manually or via a separate bootstrap module
resource "aws_dynamodb_table" "tf_lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

- **Concurrency Control:** Always configure state locking. An apply concurrent with another developer's plan can corrupt the resource state.
- **Backend Durability:** Enable S3 bucket versioning on the state bucket to easily recover from manual corruptions or accidental removals.
- **Never Modify State Directly:** Use the programmatic state manipulation commands to refactor resources safely.

### Safe State Refactoring Commands

| Command | Operational Purpose |
|---|---|
| `terraform state list` | List all resources currently managed by the active state file. |
| `terraform state show <addr>` | Show the raw state attributes of a specific resource address. |
| `terraform state mv <old> <new>` | Rename a resource path or move a resource into a module inside the state. |
| `terraform state rm <addr>` | Remove a resource from the state file (leaving the physical resource untouched in the cloud). |
| `terraform import <addr> <id>` | Import an existing, manually created cloud resource into the active state. |

---

## 5. Variables & Outputs

Structure variable files with descriptions and tight type validation rules. Mark credentials and sensitive properties as sensitive to avoid leakage.

```hcl
# variables.tf
variable "environment" {
  type        = string
  description = "Deployment environment (dev/staging/prod)"
  
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "The environment variable must be one of: dev, staging, or prod."
  }
}

variable "instance_count" {
  type        = number
  description = "Number of application server compute instances to provision"
  default     = 2
}

variable "db_password" {
  type        = string
  description = "Master password for the database cluster"
  sensitive   = true  # Prevents plaintext leakage in the stdout plan/apply CLI logs
}
```

```hcl
# outputs.tf
output "vpc_id" {
  description = "VPC ID for cross-module referencing and downstream consumers"
  value       = aws_vpc.main.id
}

output "db_endpoint" {
  description = "The raw database connection endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true  # Propagates the sensitive flag to output consumption
}
```

### Input Value Precedence (Low to High)

1.  **Defaults:** Defined directly in the `variable` block.
2.  **Global values:** Located in `terraform.tfvars`.
3.  **Automatic files:** Any file ending in `*.auto.tfvars`.
4.  **CLI Flag arguments:** Using the `-var-file` or `-var` flags.
5.  **Shell environments:** Passing `TF_VAR_<name>` variables.

---

## 6. Module Design

Modules represent standard architectural patterns. Standardize their APIs to maximize consumption flexibility.

```hcl
# Calling a reusable module configuration
module "vpc" {
  source  = "./modules/vpc"                                                     # Local path
  # source = "terraform-aws-modules/vpc/aws"                                    # Registry source
  # source = "git::https://github.com/org/modules.git//vpc?ref=v1.2.0"            # Git tag constraint

  version     = "~> 5.0"  # Only supported when using public/private registry sources
  environment = var.environment
  cidr_block  = "10.0.0.0/16"
}
```

- **Single Responsibility:** Design modules that solve a single cohesive infrastructure task (e.g., standard S3 compliance bucket, VPC setup). Do not build monolithic "god modules."
- **Strict Input Parametrization:** Avoid hardcoding parameters. Allow variables to adjust configurations depending on environments.
- **Immutable References:** Pin git sources to a specific tag (`ref=v1.2.0`) or release revision. Never reference the floating `main` branch.

---

## 7. Loops & Dynamic Blocks

When looping through resources, choose the strategy that guarantees long-term resource tracking stability.

### The Problem with Count
Using the `count` index (`count.index`) creates high vulnerability to index shifts. If you have a list of strings and delete an item in the middle of the array, Terraform will shift the index of all subsequent items, forcing their recreation.

```hcl
# Vulnerable to index shifts
resource "aws_instance" "web" {
  count         = var.instance_count
  ami           = var.ami_id
  instance_type = "t3.medium"
  tags = {
    Name = "web-${count.index}"
  }
}
```

### The Solution: Stable Keys with `for_each`
Always prefer `for_each` over `count` when creating collections of unique resources. This binds each resource to a string key instead of a numeric index.

```hcl
resource "aws_s3_bucket" "this" {
  for_each = var.buckets
  bucket   = "myapp-${each.key}"
}
```

---

## 8. Locals & Tagging Strategy

Consolidate complex string manipulations and configurations in a single place to enforce organizational governance standards.

```hcl
locals {
  tags = {
    Environment = var.environment
    Application = var.app_name
    ManagedBy   = "terraform"
  }
}

provider "aws" {
  region = var.region
  
  # Automatically injects tags to all resources created under this provider
  default_tags {
    tags = local.tags
  }
}
```

- **DRY Calculations:** Use `locals` to calculate regions, account IDs, and naming combinations.
- **Enforce Default Tags:** Rely on the provider-level `default_tags` block instead of manual tagging on every resource block.
- **Governance Audits:** Combine default provider tags with scheduled pre-commit policy enforcement to catch naming and tag gaps before deployment.

---

## 9. Lifecycle Rules

Lifecycle hooks allow engineers to control how the core execution engine treats resources during updates and deletions.

```hcl
resource "aws_instance" "web" {
  # ...

  lifecycle {
    create_before_destroy = true   # Creates new resources first to ensure zero-downtime rollouts
    prevent_destroy       = true   # Blocks accidental terraform destroy runs on database nodes
    ignore_changes        = [
      tags["LastModified"],        # Ignores tag changes managed by external systems
    ]
  }
}
```

---

## 10. Refactoring: Import & Moved Blocks

Modern Terraform versions provide first-class blocks to refactor code blocks without deleting active cloud infrastructure.

### The Import Block (Terraform >= 1.5)

```hcl
import {
  to = aws_s3_bucket.logs
  id = "my-existing-bucket-name"
}
```

### The Moved Block (Terraform >= 1.1)

```hcl
moved {
  from = aws_instance.old_instance_name
  to   = aws_instance.new_instance_name
}
```

- **Declarative Imports:** The `import` block allows you to document cloud integrations directly in HCL instead of running imperatively on developer workstations.
- **Zero-Downtime Rename:** The `moved` block tells the engine that the address has changed, updating the state pointer without terminating or rebuilding the resource.

---

## 11. Common Anti-Patterns to Avoid

| Anti-Pattern | Operational Failure | Modern Corrective Action |
|---|---|---|
| **Local State Files** | No backups, no locks, easily overridden. | Configure remote S3 / DynamoDB backends. |
| **Monolithic State Graphs** | Enormous blast radius, extremely slow plans. | Segment directories by lifecycle and environment. |
| **Secrets Committed to Git** | Total credential compromise and security incidents. | Mark variables as `sensitive = true` and use OIDC. |
| **Pervasive ClickOps Fixes** | Immediate configuration drift on the next apply. | Enforce CI/CD triggers and auto-revert manual modifications. |
| **Unconstrained Module Source** | Silently imports breaking code. | Exact-pin all version attributes. |
