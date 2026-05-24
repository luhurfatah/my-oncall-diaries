# Terraform Best Practices & Core Principles

This guide details the core principles, syntax rules, module design, and security patterns for writing production-grade Terraform configurations.

---

## 📌 Quick Summary — Top Best Practices to Remember

1. **Plan before apply** — always review `terraform plan`; save the plan (`-out=tfplan`) and apply the exact saved plan.
2. **Remote state with locking** — S3 + DynamoDB (AWS) or equivalent; never local state in production.
3. **Directory-per-environment, not workspaces** — separate state files and backends for dev/staging/prod to isolate blast radius.
4. **Pin provider and module versions** — use `~>` constraints, commit `.terraform.lock.hcl`, pin CLI version with `tfenv`.
5. **Modules for reusability** — single-responsibility, parameterized, versioned-tagged modules; never copy-paste infra.
6. **Use `for_each` over `count`** — stable resource addresses; `count` causes index shift issues when items are removed.
7. **Never commit secrets** — mark variables as `sensitive = true`, inject via env vars or vault, use OIDC for CI auth.
8. **Tag every resource** — Environment, Application, Team, CostCenter, ManagedBy; enforce via `default_tags` on the provider.
9. **Use `prevent_destroy` on stateful resources** — protect RDS, S3, and critical data from accidental `terraform destroy`.
10. **Scan IaC for misconfigurations** — Checkov, tfsec, KICS in every PR pipeline; policy-as-code with OPA or Sentinel.

---

## 1. Core Principles

- **Declarative infrastructure** — describe *what* you want, not *how* to get there.
- **Everything in Git** — all `.tf` files, modules, and variable definitions version-controlled.
- **Plan before apply** — always review `terraform plan` output; never blind-apply.
- **Remote state always** — never use local state in production.
- **Modules for reusability** — DRY principle; no copy-paste infrastructure.
- **Least privilege** — Terraform runner has only the permissions it needs.
- **Immutable where possible** — replace resources rather than mutate in-place.

---

## 2. Project Structure

### Flat (Single Environment)
```
.
├── main.tf
├── variables.tf
├── outputs.tf
├── providers.tf
├── versions.tf
└── terraform.tfvars
```

### Multi-Environment (Recommended)
```
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
- Each environment has **its own state file** — isolated blast radius.
- Modules are **reusable units** called by each environment.
- Never put credentials or secrets in `.tf` files or `tfvars` committed to Git.

---

## 3. Provider & Version Pinning

```hcl
# versions.tf
terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"       # Allow 5.x, block 6.x
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
  }
}
```
- **Always pin provider versions** — upstream changes can break your plan silently.
- Commit `.terraform.lock.hcl` to Git — locks exact provider checksums.
- Use `~>` (pessimistic constraint) for patch/minor flexibility.
- Use `tfenv` or `.terraform-version` to pin Terraform CLI version across team.

---

## 4. Remote State & Backend

```hcl
# backend.tf (AWS S3 example)
terraform {
  backend "s3" {
    bucket         = "my-tf-state-prod"
    key            = "app/prod/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true                      # Server-side encryption
    dynamodb_table = "terraform-state-lock"    # State locking
    kms_key_id     = "arn:aws:kms:..."         # Customer-managed KMS
  }
}
```

### State Locking with DynamoDB
```hcl
# Create this once manually or via bootstrap module
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
- **State locking** prevents concurrent applies — always enable.
- Enable **S3 versioning** on the state bucket for state recovery.
- **Never edit state manually** — use `terraform state` commands.

### Key State Commands
```bash
terraform state list                          # List all resources in state
terraform state show aws_instance.web         # Inspect a resource
terraform state mv old_name new_name          # Rename/move resource in state
terraform state rm aws_instance.old           # Remove from state (not from cloud)
terraform import aws_instance.web i-1234abcd  # Import existing resource
```

---

## 5. Variables & Outputs

```hcl
# variables.tf
variable "environment" {
  type        = string
  description = "Deployment environment (dev/staging/prod)"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "instance_count" {
  type    = number
  default = 2
}

variable "db_password" {
  type      = string
  sensitive = true    # Redacted from plan/apply output
}
```

```hcl
# outputs.tf
output "vpc_id" {
  description = "VPC ID for cross-module referencing"
  value       = aws_vpc.main.id
}

output "db_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}
```
- Mark secrets as `sensitive = true` — prevents plaintext logging in CI.
- Use **validation blocks** to catch invalid variables early.
- Variable Precedence (Low → High): `default` in variable block → `terraform.tfvars` → `*.auto.tfvars` → `-var-file` flag → `-var` flag → `TF_VAR_*` env vars.

---

## 6. Module Design

```hcl
# Calling a module
module "vpc" {
  source  = "./modules/vpc"       # Local
  # source = "terraform-aws-modules/vpc/aws"  # Registry
  # source = "git::https://github.com/org/modules.git//vpc?ref=v1.2.0"  # Git

  version     = "~> 5.0"         # Only for registry sources
  environment = var.environment
  cidr_block  = "10.0.0.0/16"
}
```
- **Single responsibility** — one module manages one component.
- **No hardcoded values** — parameterize resource configurations.
- **Versioned tags** — reference Git tags (`?ref=v1.2.0`) rather than `main`.

---

## 7. Loops & Dynamic Blocks

### count
```hcl
resource "aws_instance" "web" {
  count         = var.instance_count
  ami           = var.ami_id
  instance_type = "t3.medium"
  tags = {
    Name = "web-${count.index}"
  }
}
```

### for_each (Preferred)
```hcl
resource "aws_s3_bucket" "this" {
  for_each = var.buckets
  bucket   = "myapp-${each.key}"
}
```
- Prefer **`for_each` over `count`** — `count` indexes shift when list items are deleted, causing recreation of downstream resources.
- Use **`dynamic` blocks** for conditional nested blocks.

---

## 8. Locals & Tagging Strategy

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
  default_tags {
    tags = local.tags
  }
}
```
- Use `locals` to compute values and merge tag lists.
- Enforce tagging via **AWS Tag Policies** or OPA.
- Use **`default_tags`** at the provider level.

---

## 9. Lifecycle Rules

```hcl
resource "aws_instance" "web" {
  lifecycle {
    create_before_destroy = true   # Zero-downtime replacement
    prevent_destroy       = true   # Prevent accidental deletion
    ignore_changes        = [
      tags["LastModified"],        # Ignore external changes
    ]
  }
}
```

---

## 10. Refactoring: Import & Moved Blocks

### Import Block (Terraform >= 1.5)
```hcl
import {
  to = aws_s3_bucket.logs
  id = "my-existing-bucket"
}
```

### Moved Block (Refactoring without Destroy)
```hcl
moved {
  from = aws_instance.old_name
  to   = aws_instance.new_name
}
```
- Use `moved` blocks when moving resources into modules or renaming resources to avoid recreation.

---

## 11. Common Anti-Patterns to Avoid

- ❌ Local state in production (no locking, no backup).
- ❌ Hardcoded region, account IDs, or AMI IDs.
- ❌ Using `count` for maps or sets.
- ❌ Giant monolithic root module.
- ❌ No version pinning on providers or modules.
- ❌ Storing secrets in Git.
- ❌ Not using `prevent_destroy` on stateful resources (RDS, S3).
