# Terragrunt — DRY Infrastructure at Scale

Terragrunt is a thin wrapper for Terraform that provides extra tools for keeping your configurations DRY, working with multiple Terraform modules, and managing remote state across multiple accounts.

---

## Why Terragrunt?

```
Problem with plain Terraform at scale:
  ✗ Backend config copy-pasted in every environment directory
  ✗ Provider config duplicated everywhere
  ✗ No built-in way to express dependencies BETWEEN root modules
  ✗ No "apply everything in order" command
  ✗ Variable values repeated across environments

Terragrunt solves:
  ✓ DRY backend/provider config — define once, inherit everywhere
  ✓ Dependency ordering — module A waits for module B
  ✓ run-all plan/apply — operate on entire environment at once
  ✓ Generate blocks — auto-generate provider.tf, backend.tf
  ✓ Inputs from dependencies — pass outputs between root modules
```

---

## Project Structure

```
infrastructure/
├── terragrunt.hcl                     # ROOT — shared config for ALL environments
├── modules/                           # Reusable Terraform modules
│   ├── vpc/
│   ├── eks/
│   ├── rds/
│   └── s3/
├── environments/
│   ├── _env/                          # Shared environment-level config
│   │   ├── vpc.hcl                    # Common VPC inputs
│   │   ├── eks.hcl
│   │   └── rds.hcl
│   ├── dev/
│   │   ├── env.hcl                    # Dev-specific variables (region, account)
│   │   ├── vpc/
│   │   │   └── terragrunt.hcl
│   │   ├── eks/
│   │   │   └── terragrunt.hcl
│   │   └── rds/
│   │       └── terragrunt.hcl
│   ├── staging/
│   │   ├── env.hcl
│   │   ├── vpc/
│   │   ├── eks/
│   │   └── rds/
│   └── prod/
│       ├── env.hcl
│       ├── vpc/
│       ├── eks/
│       └── rds/
```

---

## Root terragrunt.hcl (Shared Config)

```hcl
# terragrunt.hcl (root — inherited by ALL child configs)

# Read environment-level variables
locals {
  env_vars     = read_terragrunt_config(find_in_parent_folders("env.hcl"))
  environment  = local.env_vars.locals.environment
  aws_region   = local.env_vars.locals.aws_region
  account_id   = local.env_vars.locals.account_id
}

# DRY backend — every child gets this automatically
remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"           # Auto-generates backend.tf in each child
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket         = "tf-state-${local.account_id}-${local.aws_region}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = local.aws_region
    encrypt        = true
    dynamodb_table = "terraform-lock"
  }
}

# DRY provider — auto-generate provider.tf in every child
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "${local.aws_region}"

  default_tags {
    tags = {
      Environment = "${local.environment}"
      ManagedBy   = "terraform"
      Repo        = "github.com/org/infrastructure"
    }
  }
}
EOF
}
```

### Environment Config (env.hcl)
```hcl
# environments/prod/env.hcl
locals {
  environment = "prod"
  aws_region  = "ap-southeast-1"
  account_id  = "123456789012"
}
```

---

## Child Module Config & Dependencies

### VPC Configuration
```hcl
# environments/prod/vpc/terragrunt.hcl
include "root" {
  path = find_in_parent_folders()        # Inherits root terragrunt.hcl
}

terraform {
  source = "../../../modules//vpc"       # Points to reusable module
}

inputs = {
  cidr_block         = "10.0.0.0/16"
  environment        = "prod"
  availability_zones = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
}
```

### EKS Configuration (with dependencies)
```hcl
# environments/prod/eks/terragrunt.hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules//eks"
}

# EKS depends on VPC — Terragrunt ensures VPC is applied first
dependency "vpc" {
  config_path = "../vpc"

  # Mock outputs for `terragrunt plan` before VPC exists
  mock_outputs = {
    vpc_id             = "vpc-mock"
    private_subnet_ids = ["subnet-mock-1", "subnet-mock-2"]
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

dependency "rds" {
  config_path = "../rds"
}

inputs = {
  vpc_id             = dependency.vpc.outputs.vpc_id
  private_subnet_ids = dependency.vpc.outputs.private_subnet_ids
  db_endpoint        = dependency.rds.outputs.endpoint
}
```

```
Dependency graph resolved by Terragrunt:
VPC ──> RDS ──> EKS

Apply order: VPC -> RDS -> EKS
Destroy order: EKS -> RDS -> VPC (auto-reversed)
```

---

## DRY Inputs with `_env/` Common Config

```hcl
# environments/_env/eks.hcl — shared EKS defaults
locals {
  cluster_version = "1.29"
  node_min_size   = 2
  node_max_size   = 10
  instance_types  = ["m6i.large", "m6i.xlarge"]
}
```

```hcl
# environments/prod/eks/terragrunt.hcl
include "root" {
  path = find_in_parent_folders()
}

include "eks_common" {
  path   = "${dirname(find_in_parent_folders())}/_env/eks.hcl"
  expose = true                          # Expose locals for use below
}

terraform {
  source = "../../../modules//eks"
}

inputs = {
  cluster_version = include.eks_common.locals.cluster_version
  node_min_size   = 3                     # Override default for prod
  node_max_size   = include.eks_common.locals.node_max_size
  instance_types  = include.eks_common.locals.instance_types
}
```

---

## Multi-Account Pattern

```hcl
# Centralized role assumption inside root terragrunt.hcl
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "${local.aws_region}"
  assume_role {
    role_arn = "arn:aws:iam::${local.account_id}:role/TerraformExecutionRole"
  }
}
EOF
}
```
- **CI/CD pipeline** authenticates to the AWS Management Account (OIDC) and assumes target account roles dynamically based on inputs.

---

## Terragrunt vs. Plain Terraform

| Feature | Plain Terraform | Terragrunt |
|---|---|---|
| **Backend config** | Copy-paste per environment | Define once, inherit everywhere |
| **Provider config** | Copy-paste per environment | Auto-generated via `generate` |
| **Cross-module deps** | Manual (`terraform_remote_state`) | `dependency` block with mocks |
| **Apply all modules** | Run each one manually | `run-all apply` (ordered) |
| **Destroy in order** | Figure out reverse order yourself | `run-all destroy` (auto-reversed) |
| **DRY variable values** | `tfvars` per env | `include` + shared configs |
| **Multi-account** | Manual assume role config | Centralized in root config |

---

## Essential CLI Commands

```bash
terragrunt init                         # Init single module
terragrunt plan                         # Plan single module
terragrunt apply                        # Apply single module

terragrunt run-all init                 # Init all modules recursively
terragrunt run-all plan                 # Plan all modules recursively
terragrunt run-all apply                 # Apply all modules in dependency order
terragrunt run-all destroy               # Destroy all modules in reverse order

terragrunt render-json                  # Debug generated HCL as JSON
terragrunt graph-dependencies           # Show module dependencies
terragrunt hclfmt                       # Format terragrunt.hcl files
```
