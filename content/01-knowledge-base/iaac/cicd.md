# IaC CI/CD Knowledge Base: Terraform & Terragrunt

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Core Principles](#1-core-principles) | Immutability, GitOps model, and CI/CD contract for IaC pipelines. |
| **02** | [Repository Layout](#2-repository-layout) | Monorepo vs. polyrepo, Terragrunt live directory structure, and module registry layout. |
| **03** | [Terragrunt Fundamentals](#3-terragrunt-fundamentals) | Root config, generate blocks, DRY backend/provider patterns. |
| **04** | [Remote State & Backend Automation](#4-remote-state--backend-automation) | Auto-generated backends, state path conventions, and cross-stack dependencies. |
| **05** | [CI/CD Pipeline Design](#5-cicd-pipeline-design) | Pipeline stages, job separation, plan/apply gate model, and tool matrix. |
| **06** | [Authentication & Secrets](#6-authentication--secrets) | OIDC federation, IRSA, per-environment role isolation, and secrets hygiene. |
| **07** | [Plan & Apply Workflow](#7-plan--apply-workflow) | PR-driven plan, plan artifact passing, apply-on-merge, and blast radius control. |
| **08** | [Drift Detection](#8-drift-detection) | Scheduled plan runs, refresh-only strategy, and alert routing. |
| **09** | [Module Versioning & Release](#9-module-versioning--release) | Git tag strategy, semantic versioning, CHANGELOG automation, and registry publishing. |
| **10** | [Testing Strategy](#10-testing-strategy) | Static analysis, policy-as-code, native `terraform test`, and Terratest integration. |
| **11** | [Multi-Account & Multi-Region Patterns](#11-multi-account--multi-region-patterns) | Account vending, provider alias patterns, and cross-account state access. |
| **12** | [Rollback & Recovery](#12-rollback--recovery) | State backup, revert-and-apply, state surgery commands, and incident runbook. |
| **13** | [Common Anti-Patterns to Avoid](#13-common-anti-patterns-to-avoid) | Pipeline anti-patterns, Terragrunt misuse, and state management failures. |

---

## 1. Core Principles

Every IaC CI/CD pipeline must be built on a set of non-negotiable operational rules. These govern how humans interact with infrastructure and how automation treats changes.

- **Infrastructure is Code, Not Configuration:** Every resource, every variable, every module version is tracked in Git. No resource exists that was not created through a pipeline.
- **The Pipeline is the Only Deployment Path:** Direct `terraform apply` from a developer workstation to production is prohibited. All changes flow through PR → plan → review → apply.
- **Plans are Contracts:** A `terraform plan` output is a binding contract between the code change and its real-world effect. It must be reviewed and attached to the PR before any merge.
- **State is Sacred:** The state file is the source of truth for what Terraform manages. It is never manually edited, never stored locally for shared environments, and always encrypted.
- **Environments are Isolated by Design:** Dev, staging, and prod run in separate state files, separate AWS accounts, and separate IAM roles. A failure in staging never touches prod state.
- **Least Privilege at Every Layer:** The CI runner, the plan role, and the apply role all carry the minimum IAM permissions needed for their specific task. Plan roles are read-only; apply roles are scoped to the layer they manage.

---

## 2. Repository Layout

### Option A: Terragrunt Monorepo (Recommended for Multi-Account)

The canonical layout for large-scale Terragrunt deployments. The `modules/` directory holds reusable, versioned Terraform modules. The `live/` directory is the GitOps source of truth — one directory per account/region/layer.

```text
infrastructure/
├── modules/                            # Internal reusable Terraform modules
│   ├── vpc/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── versions.tf
│   ├── eks/
│   ├── rds/
│   └── ecs-service/
│
├── live/                               # GitOps source of truth (Terragrunt)
│   ├── terragrunt.hcl                  # Root config: remote state, provider generation
│   ├── _global/                        # Account-level shared config (SCPs, IAM, DNS)
│   │   └── terragrunt.hcl
│   │
│   ├── dev/
│   │   ├── account.hcl                 # Account-level vars (account_id, env name)
│   │   └── ap-southeast-1/
│   │       ├── region.hcl              # Region-level vars
│   │       ├── networking/
│   │       │   └── terragrunt.hcl
│   │       └── eks/
│   │           └── terragrunt.hcl
│   │
│   ├── staging/
│   │   └── ap-southeast-1/
│   │       ├── networking/
│   │       └── eks/
│   │
│   └── prod/
│       ├── account.hcl
│       └── ap-southeast-1/
│           ├── networking/
│           ├── eks/
│           └── rds/
│
├── .github/
│   └── workflows/
│       ├── tf-plan.yml
│       ├── tf-apply.yml
│       └── tf-drift-detection.yml
│
└── .terraform-version                  # Pinned via tfenv
```

**Key conventions:**
- `account.hcl` and `region.hcl` files hold non-sensitive metadata (account ID, region name, environment label). They are read by child `terragrunt.hcl` files via `read_terragrunt_config()`.
- The `live/` directory is never modified by the pipeline directly — only by humans via PR. The pipeline reads it and executes it.
- Module source references in `live/` always point to a specific Git tag — never a floating branch.

### Option B: Polyrepo Split (Modules vs. Live)

```text
# Repo 1: terraform-modules (versioned, published)
terraform-modules/
├── modules/
│   ├── vpc/
│   ├── eks/
│   └── rds/
└── .github/workflows/release.yml      # Tags and publishes on merge to main

# Repo 2: infrastructure-live (Terragrunt consumer)
infrastructure-live/
├── live/
│   ├── terragrunt.hcl
│   ├── dev/
│   ├── staging/
│   └── prod/
└── .github/workflows/
    ├── tf-plan.yml
    └── tf-apply.yml
```

**Polyrepo trade-offs:**

| | Monorepo | Polyrepo |
| :--- | :--- | :--- |
| **Module changes** | Atomic — module + consumer in one PR | Decoupled — module release is a separate PR and tag |
| **Access control** | One repo, branch protection rules | Separate repos, separate teams |
| **Blast radius** | Larger PR surface | Module changes are independently gated |
| **Best for** | Small-to-medium platform teams | Large orgs with separate module and consumer teams |

---

## 3. Terragrunt Fundamentals

Terragrunt is a thin wrapper that solves Terraform's three biggest limitations at scale: **DRY backend config**, **DRY provider config**, and **dependency orchestration across state files**.

### Root `terragrunt.hcl` — The Configuration Hub

The root config is the single place where backend paths, provider generation, and common inputs are defined. Every child `terragrunt.hcl` inherits from it.

```hcl
# live/terragrunt.hcl

locals {
  # Read account and region metadata from the directory hierarchy
  account_vars = read_terragrunt_config(find_in_parent_folders("account.hcl"))
  region_vars  = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  account_id   = local.account_vars.locals.account_id
  account_name = local.account_vars.locals.account_name
  aws_region   = local.region_vars.locals.aws_region
}

# Generate backend.tf in every child module directory at runtime
generate "backend" {
  path      = "backend.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
terraform {
  backend "s3" {
    bucket         = "org-tf-state-${local.account_id}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
    role_arn       = "arn:aws:iam::${local.account_id}:role/TerraformStateRole"
  }
}
EOF
}

# Generate providers.tf in every child module directory at runtime
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "${local.aws_region}"

  assume_role {
    role_arn = "arn:aws:iam::${local.account_id}:role/TerraformApplyRole"
  }

  default_tags {
    tags = {
      ManagedBy   = "terraform"
      Environment = "${local.account_name}"
      Repository  = "infrastructure-live"
    }
  }
}
EOF
}

# Inputs available to all child modules
inputs = {
  aws_region   = local.aws_region
  account_id   = local.account_id
  environment  = local.account_name
}
```

### Child `terragrunt.hcl` — The Consumer

Each stack in `live/` is a thin consumer. It declares what module to use, which version, and what inputs to pass. No backend or provider boilerplate.

```hcl
# live/prod/ap-southeast-1/eks/terragrunt.hcl

include "root" {
  path = find_in_parent_folders()    # Inherits backend, provider, common inputs
}

terraform {
  source = "git::https://github.com/org/terraform-modules.git//modules/eks?ref=v3.2.1"
}

dependency "networking" {
  config_path = "../networking"

  mock_outputs = {
    vpc_id          = "vpc-00000000000000000"
    private_subnets = ["subnet-00000000", "subnet-11111111"]
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

inputs = {
  cluster_name    = "prod-ap-southeast-1"
  kubernetes_version = "1.30"
  vpc_id          = dependency.networking.outputs.vpc_id
  subnet_ids      = dependency.networking.outputs.private_subnets
  node_instance_types = ["m5.xlarge"]
  min_nodes       = 3
  max_nodes       = 20
}
```

### `account.hcl` and `region.hcl` — Metadata Files

```hcl
# live/prod/account.hcl
locals {
  account_id   = "123456789012"
  account_name = "prod"
}

# live/prod/ap-southeast-1/region.hcl
locals {
  aws_region = "ap-southeast-1"
}
```

These are pure metadata — no resources, no secrets. Safe to commit to Git. The root `terragrunt.hcl` reads them with `read_terragrunt_config(find_in_parent_folders("account.hcl"))`.

### Dependency Block with Mock Outputs

```hcl
dependency "rds" {
  config_path = "../rds"

  # mock_outputs let plan and validate run without the real outputs being present
  # (e.g., on a fresh environment where RDS hasn't been deployed yet)
  mock_outputs = {
    db_endpoint = "mock-db.cluster-xxxxxxxx.ap-southeast-1.rds.amazonaws.com"
    db_port     = 5432
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}
```

**Why mock outputs matter in CI:** Without them, a plan job for `eks/` would fail if `rds/` hasn't been applied yet (e.g., first deploy of a new environment). Mock outputs allow plan to complete and show diffs without real dependency outputs.

---

## 4. Remote State & Backend Automation

### State Path Convention

The `path_relative_to_include()` Terragrunt function resolves to the path of the child `terragrunt.hcl` relative to the root config. This automatically generates unique, human-readable state keys:

```
live/prod/ap-southeast-1/networking/  →  prod/ap-southeast-1/networking/terraform.tfstate
live/prod/ap-southeast-1/eks/         →  prod/ap-southeast-1/eks/terraform.tfstate
live/staging/ap-southeast-1/eks/      →  staging/ap-southeast-1/eks/terraform.tfstate
```

No manual `key` value ever needs to be set in a child config. Adding a new stack automatically generates the correct state path.

### State Bucket Bootstrap

The state bucket itself cannot be managed by the same Terraform that uses it as a backend. Bootstrap it once via a dedicated module or manually, then lock it down.

```hcl
# bootstrap/main.tf — run once per account, manually or via a separate pipeline
resource "aws_s3_bucket" "tf_state" {
  bucket = "org-tf-state-${var.account_id}"
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.tf_state.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

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

### Cross-Stack State References (Terragrunt `dependency` vs. `terraform_remote_state`)

| Approach | Mechanism | Best For |
| :--- | :--- | :--- |
| **Terragrunt `dependency {}`** | Reads outputs from another Terragrunt stack's state at plan/apply time | Stacks in the same Terragrunt repo |
| **`terraform_remote_state`** | Reads another state file directly via backend config | Cross-repo or cross-team state references |

```hcl
# Cross-account remote state reference (raw Terraform)
data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket   = "org-tf-state-${var.network_account_id}"
    key      = "prod/ap-southeast-1/networking/terraform.tfstate"
    region   = "ap-southeast-1"
    role_arn = "arn:aws:iam::${var.network_account_id}:role/TerraformStateReadRole"
  }
}

# Consume the output
resource "aws_eks_cluster" "main" {
  vpc_config {
    subnet_ids = data.terraform_remote_state.networking.outputs.private_subnet_ids
  }
}
```

---

## 5. CI/CD Pipeline Design

### Pipeline Architecture

```
Pull Request opened / updated
        │
        ├─── Static Checks (parallel, fast)
        │       ├─ terraform fmt -check
        │       ├─ terraform validate
        │       ├─ tflint
        │       ├─ tfsec / checkov
        │       └─ terragrunt hcl-fmt --check
        │
        ├─── Plan Jobs (parallel per changed stack)
        │       ├─ terragrunt plan → prod/networking
        │       ├─ terragrunt plan → prod/eks
        │       └─ terragrunt plan → staging/eks
        │       (plan outputs posted as PR comments)
        │
        └─── [PR Review + Approval]

Merge to main
        │
        ├─── Apply Jobs (sequential by dependency order)
        │       ├─ terragrunt apply → staging/networking
        │       ├─ terragrunt apply → staging/eks
        │       └─ [Manual approval gate]
        │           ├─ terragrunt apply → prod/networking
        │           └─ terragrunt apply → prod/eks
        │
        └─── Post-Apply Validation
                ├─ smoke tests
                └─ drift check (plan should be empty)
```

### GitHub Actions: Plan Workflow

```yaml
# .github/workflows/tf-plan.yml
name: Terraform Plan

on:
  pull_request:
    paths:
      - 'live/**'
      - 'modules/**'

permissions:
  id-token: write       # Required for OIDC
  contents: read
  pull-requests: write  # Required to post plan as PR comment

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      stacks: ${{ steps.changed.outputs.stacks }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Detect changed Terragrunt stacks
        id: changed
        run: |
          CHANGED=$(git diff --name-only origin/main...HEAD \
            | grep '^live/' \
            | xargs -I{} dirname {} \
            | sort -u \
            | jq -R -s -c 'split("\n")[:-1]')
          echo "stacks=$CHANGED" >> $GITHUB_OUTPUT

  plan:
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        stack: ${{ fromJson(needs.detect-changes.outputs.stacks) }}
      fail-fast: false   # Plan all stacks even if one fails
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.PLAN_ROLE_ACCOUNT_ID }}:role/GitHubActionsPlanRole
          aws-region: ap-southeast-1

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.9.0"

      - name: Setup Terragrunt
        run: |
          curl -Lo /usr/local/bin/terragrunt \
            https://github.com/gruntwork-io/terragrunt/releases/download/v0.67.0/terragrunt_linux_amd64
          chmod +x /usr/local/bin/terragrunt

      - name: Terragrunt Plan
        id: plan
        working-directory: ${{ matrix.stack }}
        run: |
          terragrunt plan -no-color -out=tfplan 2>&1 | tee plan_output.txt
          echo "exitcode=${PIPESTATUS[0]}" >> $GITHUB_OUTPUT

      - name: Post plan to PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const planOutput = fs.readFileSync('${{ matrix.stack }}/plan_output.txt', 'utf8');
            const truncated = planOutput.length > 60000
              ? planOutput.substring(0, 60000) + '\n... [truncated]'
              : planOutput;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Plan: \`${{ matrix.stack }}\`\n\`\`\`hcl\n${truncated}\n\`\`\``
            });

      - name: Upload plan artifact
        uses: actions/upload-artifact@v4
        with:
          name: tfplan-${{ hashFiles(matrix.stack) }}
          path: ${{ matrix.stack }}/tfplan
          retention-days: 5
```

### GitHub Actions: Apply Workflow

```yaml
# .github/workflows/tf-apply.yml
name: Terraform Apply

on:
  push:
    branches: [main]
    paths:
      - 'live/**'

jobs:
  apply-staging:
    runs-on: ubuntu-latest
    environment: staging      # GitHub Environment: no approval required
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC — staging)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.STAGING_ACCOUNT_ID }}:role/GitHubActionsApplyRole
          aws-region: ap-southeast-1

      - name: Apply changed stacks in staging
        run: |
          terragrunt run-all apply \
            --terragrunt-working-dir live/staging \
            --terragrunt-non-interactive \
            -auto-approve

  apply-prod:
    needs: apply-staging
    runs-on: ubuntu-latest
    environment: production   # GitHub Environment: requires manual approval
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC — prod)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.PROD_ACCOUNT_ID }}:role/GitHubActionsApplyRole
          aws-region: ap-southeast-1

      - name: Apply changed stacks in prod
        run: |
          terragrunt run-all apply \
            --terragrunt-working-dir live/prod \
            --terragrunt-non-interactive \
            -auto-approve
```

### Terraform vs. Atlantis vs. Terragrunt CI — Decision Matrix

| Tool | Trigger Model | Best For |
| :--- | :--- | :--- |
| **GitHub Actions** | Push/PR webhooks, path filters | Teams already on GitHub, cloud-native pipelines |
| **Atlantis** | PR-driven (`atlantis plan`, `atlantis apply` comments) | Teams wanting Terraform-native PR workflow without custom CI |
| **GitLab CI** | Push/MR triggers | Enterprises on self-hosted GitLab |
| **Terraform Cloud** | VCS-connected workspaces | Teams wanting managed remote execution, Sentinel policies |
| **Jenkins** | Webhook or scheduled | Legacy orgs with existing Jenkins infrastructure |

---

## 6. Authentication & Secrets

### OIDC Federation — No Static Credentials

The pipeline never stores `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`. GitHub Actions exchanges a short-lived OIDC JWT for temporary STS credentials at runtime.

```hcl
# IAM OIDC provider — created once per AWS account
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Plan role — read-only, usable from any branch
resource "aws_iam_role" "github_plan" {
  name = "GitHubActionsPlanRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:org/infrastructure-live:*"
        }
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

# Apply role — restricted to main branch only
resource "aws_iam_role" "github_apply" {
  name = "GitHubActionsApplyRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          # Only the main branch can assume the apply role
          "token.actions.githubusercontent.com:sub" = "repo:org/infrastructure-live:ref:refs/heads/main"
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}
```

### Role Separation by Stage

| Role | Used By | IAM Permissions |
| :--- | :--- | :--- |
| **PlanRole** | PR pipeline jobs | `ReadOnly` + `s3:GetObject` on state bucket + `dynamodb:GetItem` |
| **ApplyRole** | Merge-to-main pipeline jobs | Resource-specific write permissions scoped to the layer |
| **StateRole** | Both | `s3:GetObject`, `s3:PutObject`, `dynamodb:PutItem`, `dynamodb:DeleteItem` on state resources only |
| **BootstrapRole** | One-time manual run | Admin (used to create the state bucket and lock table) |

### Secrets That Must Reach the Pipeline

Not all pipeline secrets can be replaced with OIDC. For secrets that must exist (GitHub token, Datadog API key, Vault token), follow this hierarchy:

```
Preference order (most to least preferred):
1. OIDC — no secret at all (AWS, GCP, Azure)
2. GitHub Actions Environment secrets — scoped to production environment
3. GitHub Actions Repository secrets — available to all workflows
4. AWS Secrets Manager — fetched at runtime via OIDC-authenticated AWS call
```

```yaml
# Fetching a non-AWS secret at runtime via OIDC-authenticated AWS call
- name: Fetch Datadog API key from Secrets Manager
  run: |
    DD_API_KEY=$(aws secretsmanager get-secret-value \
      --secret-id prod/datadog/api_key \
      --query SecretString \
      --output text)
    echo "::add-mask::$DD_API_KEY"    # Masks the value in all subsequent log output
    echo "DD_API_KEY=$DD_API_KEY" >> $GITHUB_ENV
```

---

## 7. Plan & Apply Workflow

### The Golden Rule: Plan Artifact Passing

The plan produced during PR review must be the exact plan that gets applied on merge. If you re-run `plan` at apply time, drift or concurrent changes can produce a different execution than what was reviewed.

```
PR Plan job:
  terragrunt plan -out=tfplan.binary   → upload as artifact (encrypted at rest)

Apply job (after merge):
  download artifact tfplan.binary
  terragrunt apply tfplan.binary       → applies EXACTLY what was reviewed
```

```yaml
# In the plan job
- name: Save plan artifact
  uses: actions/upload-artifact@v4
  with:
    name: plan-${{ github.sha }}-${{ matrix.stack_hash }}
    path: ${{ matrix.stack }}/tfplan.binary
    retention-days: 1    # Short retention — plan artifacts are only valid until apply

# In the apply job
- name: Download plan artifact
  uses: actions/download-artifact@v4
  with:
    name: plan-${{ github.sha }}-${{ matrix.stack_hash }}
    path: ${{ matrix.stack }}/

- name: Apply plan artifact
  working-directory: ${{ matrix.stack }}
  run: terragrunt apply -auto-approve tfplan.binary
```

### Controlling Apply Order with Terragrunt `run-all`

Terragrunt's `run-all` command respects the `dependency {}` graph and applies stacks in the correct order automatically.

```bash
# Apply all stacks under prod in dependency order
terragrunt run-all apply --terragrunt-working-dir live/prod --terragrunt-non-interactive

# Plan only stacks that have changed (custom script approach)
terragrunt run-all plan \
  --terragrunt-working-dir live/prod \
  --terragrunt-ignore-dependency-errors   # Plan each stack independently even if deps fail
```

### Targeted Stack Apply

For emergency fixes or when only one stack changed:

```bash
# Apply a single stack only
cd live/prod/ap-southeast-1/eks
terragrunt apply -auto-approve

# Apply with explicit target (use sparingly — hides dependency issues)
terragrunt apply -target=aws_eks_node_group.main -auto-approve
```

### Protecting Production: `prevent_destroy`

Add lifecycle guards on stateful production resources. The pipeline cannot destroy them without an explicit code change to remove the guard first.

```hcl
# modules/rds/main.tf
resource "aws_db_instance" "main" {
  # ...

  lifecycle {
    prevent_destroy = true
  }
}
```

This means a `terraform destroy` or a plan that would destroy the RDS instance will hard-fail — even in CI — until `prevent_destroy = false` is explicitly committed and reviewed.

---

## 8. Drift Detection

Drift occurs when real infrastructure diverges from the Terraform state — caused by manual console changes, AWS automated updates, or external automation.

### Scheduled Drift Detection Workflow

```yaml
# .github/workflows/tf-drift-detection.yml
name: Drift Detection

on:
  schedule:
    - cron: '0 6 * * *'    # Run daily at 06:00 UTC
  workflow_dispatch:         # Allow manual trigger

jobs:
  drift-check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment: [staging, prod]
      fail-fast: false
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars[format('{0}_ACCOUNT_ID', matrix.environment)] }}:role/GitHubActionsPlanRole
          aws-region: ap-southeast-1

      - name: Run refresh-only plan
        id: drift
        working-directory: live/${{ matrix.environment }}
        run: |
          terragrunt run-all plan -refresh-only -detailed-exitcode -no-color 2>&1 | tee drift_output.txt
          echo "exitcode=${PIPESTATUS[0]}" >> $GITHUB_OUTPUT

      - name: Alert on drift detected
        if: steps.drift.outputs.exitcode == '2'   # Exit code 2 = diff found
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "⚠️ *Infrastructure drift detected in `${{ matrix.environment }}`*\nRun: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_DRIFT }}
```

### Terraform Exit Codes for Drift Automation

| Exit Code | Meaning | Pipeline Action |
| :--- | :--- | :--- |
| `0` | No changes — state matches real infrastructure | Pass silently |
| `1` | Error during plan execution | Alert immediately (broken pipeline or provider issue) |
| `2` | Changes detected — drift exists | Alert team, create GitHub Issue, do not auto-apply |

### Drift Response Runbook

```
Drift detected in prod/networking
         │
         ├─ Step 1: Identify the drift
         │     terragrunt plan -refresh-only
         │     # Review what changed vs. what's in state
         │
         ├─ Step 2: Classify the change
         │     ├─ Accidental manual change → apply Terraform to restore desired state
         │     ├─ Legitimate emergency change → update .tf code to match, commit via PR
         │     └─ AWS-managed update (e.g., AMI rotation) → add to ignore_changes or accept
         │
         ├─ Step 3: Remediate
         │     ├─ For code updates: PR → plan → review → merge → apply
         │     └─ For state sync only: terragrunt apply -refresh-only
         │
         └─ Step 4: Add guardrails
               └─ SCP / IAM deny on direct console modification for the affected resource type
```

---

## 9. Module Versioning & Release

### Git Tag Versioning Strategy

All modules follow **semantic versioning** on Git tags. Breaking changes increment the major version; consumers pin to a major version and get non-breaking updates automatically within it.

```
v1.0.0  → Initial release
v1.1.0  → Added optional variable (backward-compatible)
v1.1.1  → Bug fix in output value
v2.0.0  → Breaking: renamed required variable (major bump)
```

### Module Release Pipeline

```yaml
# .github/workflows/release.yml (in terraform-modules repo)
name: Module Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Lint and validate all modules
        run: |
          for module in modules/*/; do
            echo "Validating $module"
            terraform -chdir="$module" init -backend=false
            terraform -chdir="$module" validate
            terraform -chdir="$module" fmt -check
          done

      - name: Determine next version (conventional commits)
        id: version
        uses: mathieudutour/github-tag-action@v6.2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          default_bump: patch

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.version.outputs.new_tag }}
          generate_release_notes: true
```

### Version Pinning in `live/` Consumers

```hcl
# Pinned to a specific tag — never use floating main or HEAD
terraform {
  source = "git::https://github.com/org/terraform-modules.git//modules/eks?ref=v3.2.1"
}
```

**Version upgrade process:**
1. Module team cuts `v3.3.0` with new feature.
2. Platform team opens a PR in `infrastructure-live` updating the `ref=` value.
3. CI runs `terragrunt plan` — shows exactly what changes on real infrastructure.
4. PR reviewed, merged, applied.
5. Rollback = revert the PR (change `ref=v3.3.0` back to `ref=v3.2.1`), re-plan, re-apply.

### Module CHANGELOG Convention

Each module directory maintains a `CHANGELOG.md` updated on every release:

```markdown
## [3.2.1] - 2025-08-01
### Fixed
- Output `cluster_endpoint` was missing https:// prefix

## [3.2.0] - 2025-07-15
### Added
- Optional `enable_irsa` variable (default: true)
- Output `oidc_provider_arn` for IRSA setup downstream

## [3.0.0] - 2025-06-01
### Breaking
- Renamed variable `node_count` → `desired_node_count`
- Removed deprecated `legacy_networking` variable
```

---

## 10. Testing Strategy

IaC testing runs on a spectrum from zero-infrastructure static checks to full real-resource integration tests. A mature pipeline runs all layers.

### Testing Pyramid

| Layer | Tool | What It Catches | Speed | Real Infra? |
| :--- | :--- | :--- | :--- | :--- |
| **Format** | `terraform fmt -check` | Style inconsistency | Instant | No |
| **Syntax** | `terraform validate` | Type errors, missing required args | Seconds | No |
| **Linting** | `tflint` | Provider rule violations, deprecated syntax | Seconds | No |
| **Security scanning** | `checkov`, `tfsec`, `trivy` | Misconfigs (open SGs, public buckets, missing encryption) | Seconds | No |
| **Unit / contract** | `terraform test` (v1.6+) | Module input/output contracts, mock provider | Minutes | No |
| **Integration** | `terratest` (Go) | Real resources provisioned + validated + destroyed | 10–60 min | Yes |
| **Plan diffing** | `infracost` | Cost delta, unexpected resource destruction | Minutes | No |

### Static Analysis in CI (Pre-Plan Gate)

```yaml
- name: Terraform Format Check
  run: terraform fmt -check -recursive live/

- name: Terragrunt HCL Format Check
  run: terragrunt hcl-fmt --check --diff live/

- name: TFLint
  uses: terraform-linters/setup-tflint@v4
  with:
    tflint_version: v0.52.0
- run: tflint --recursive

- name: Checkov Security Scan
  uses: bridgecrewio/checkov-action@master
  with:
    directory: modules/
    framework: terraform
    soft_fail: false
    output_format: sarif
    output_file_path: checkov-results.sarif

- name: Upload Checkov results to Security tab
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: checkov-results.sarif
```

### Native `terraform test` (v1.6+)

```hcl
# modules/vpc/tests/vpc_defaults.tftest.hcl

run "creates_vpc_with_correct_cidr" {
  command = plan    # No real infra needed

  variables {
    cidr_block  = "10.0.0.0/16"
    environment = "test"
  }

  assert {
    condition     = aws_vpc.main.cidr_block == "10.0.0.0/16"
    error_message = "VPC CIDR block does not match input variable"
  }

  assert {
    condition     = aws_vpc.main.tags["Environment"] == "test"
    error_message = "Environment tag not applied to VPC"
  }
}

run "apply_and_verify_outputs" {
  command = apply    # Provisions real resources in a test account

  assert {
    condition     = output.vpc_id != ""
    error_message = "vpc_id output is empty"
  }
}
```

### Terratest Integration Test

```go
// modules/vpc/test/vpc_test.go
package test

import (
    "testing"
    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/stretchr/testify/assert"
)

func TestVpcModule(t *testing.T) {
    t.Parallel()

    opts := &terraform.Options{
        TerraformDir: "../",
        Vars: map[string]interface{}{
            "cidr_block":  "10.99.0.0/16",
            "environment": "test",
        },
    }

    defer terraform.Destroy(t, opts)   // Always destroy — prevents resource leakage
    terraform.InitAndApply(t, opts)

    vpcID := terraform.Output(t, opts, "vpc_id")
    assert.NotEmpty(t, vpcID)
    assert.Regexp(t, `^vpc-[a-z0-9]+$`, vpcID)
}
```

### Cost Estimation with Infracost

```yaml
- name: Infracost cost estimate
  uses: infracost/actions/setup@v3
  with:
    api-key: ${{ secrets.INFRACOST_API_KEY }}

- name: Generate cost diff
  run: |
    infracost diff \
      --path live/prod \
      --format json \
      --out-file infracost.json

- name: Post cost estimate to PR
  uses: infracost/actions/comment@v3
  with:
    path: infracost.json
    behavior: update
```

---

## 11. Multi-Account & Multi-Region Patterns

### AWS Landing Zone Account Structure

```
Management Account (root)
├── Security Account     → CloudTrail, Config, GuardDuty aggregation
├── Network Account      → Transit Gateway, centralized VPC, Route53 (shared zones)
├── Shared Services      → ECR, Artifact repos, internal tools
├── Dev Account          → All dev workloads
├── Staging Account      → Pre-production workloads
└── Prod Account         → Production workloads
```

Each account has its own:
- State bucket: `org-tf-state-<account-id>`
- Lock table: `terraform-state-lock`
- OIDC trust: `GitHubActionsApplyRole` (principal restricted to `main` branch)
- Plan role: `GitHubActionsPlanRole` (principal restricted to the repo, any branch)

### Cross-Account Provider Configuration

```hcl
# Terraform: deploying into a spoke account from a hub pipeline
provider "aws" {
  alias  = "prod"
  region = "ap-southeast-1"

  assume_role {
    role_arn     = "arn:aws:iam::${var.prod_account_id}:role/TerraformApplyRole"
    session_name = "terraform-prod-apply"
  }
}

provider "aws" {
  alias  = "network"
  region = "ap-southeast-1"

  assume_role {
    role_arn = "arn:aws:iam::${var.network_account_id}:role/TerraformApplyRole"
  }
}

# Reference a resource in the network account
data "aws_vpc" "shared" {
  provider = aws.network
  id       = var.shared_vpc_id
}
```

### Multi-Region Pattern in Terragrunt

```text
live/prod/
├── ap-southeast-1/      ← Primary region
│   ├── networking/
│   ├── eks/
│   └── rds/
└── ap-southeast-3/      ← DR region
    ├── networking/
    └── rds-replica/
```

Each region directory has its own `region.hcl`. The root `terragrunt.hcl` reads it via `find_in_parent_folders("region.hcl")` — so all backend keys and provider configs are automatically region-aware without any manual override.

### Transit Gateway Cross-Account RAM Share (Terragrunt Example)

```hcl
# live/prod/ap-southeast-1/transit-gateway-attachment/terragrunt.hcl

dependency "tgw" {
  # TGW lives in the network account — reference its Terragrunt stack
  config_path = "../../../../network-account/ap-southeast-1/transit-gateway"

  mock_outputs = {
    transit_gateway_id = "tgw-00000000000000000"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

inputs = {
  transit_gateway_id = dependency.tgw.outputs.transit_gateway_id
  subnet_ids         = dependency.networking.outputs.private_subnet_ids
}
```

---

## 12. Rollback & Recovery

### The Rollback Decision Tree

```
Deployment failed or bad config in production
            │
            ├─ Did apply complete fully?
            │       │
            │       ├─ NO (mid-apply failure)
            │       │     └─ Run `terragrunt apply` again
            │       │          Terraform is idempotent — it retries only what failed
            │       │
            │       └─ YES (fully applied but wrong)
            │             └─ Revert the Git commit and apply
            │
            ├─ Is the state file corrupted?
            │       └─ YES → State recovery procedure (see below)
            │
            └─ Was a database or stateful resource destroyed?
                      └─ YES → Restore from backup; do NOT re-apply blindly
```

### Standard Rollback: Revert + Apply

```bash
# 1. Identify the last known-good commit
git log --oneline live/prod/ap-southeast-1/eks/

# 2. Revert the bad commit (creates a new commit — safe for protected branches)
git revert <bad-commit-sha>
git push origin main

# 3. CI pipeline auto-triggers plan → review → apply
#    Or apply directly if urgent:
cd live/prod/ap-southeast-1/eks
terragrunt apply -auto-approve
```

### State Recovery from S3 Versioned Backup

```bash
# 1. List all versions of the state file
aws s3api list-object-versions \
  --bucket org-tf-state-123456789012 \
  --prefix prod/ap-southeast-1/eks/terraform.tfstate \
  --query 'Versions[*].[VersionId,LastModified]' \
  --output table

# 2. Download the last known-good version
aws s3api get-object \
  --bucket org-tf-state-123456789012 \
  --key prod/ap-southeast-1/eks/terraform.tfstate \
  --version-id <VERSION_ID> \
  restored.tfstate

# 3. Inspect the restored state before pushing
cat restored.tfstate | jq '.resources[].type' | sort | uniq -c

# 4. Back up current (corrupted) state
terraform state pull > corrupted_state_backup_$(date +%Y%m%d%H%M%S).json

# 5. Push the restored state
terraform state push restored.tfstate
```

### Safe State Manipulation Commands

| Command | Purpose | Risk |
| :--- | :--- | :--- |
| `terraform state list` | List all managed resource addresses | Read-only — safe |
| `terraform state show <addr>` | Show raw attributes of a resource | Read-only — safe |
| `terraform state mv <old> <new>` | Rename or move a resource address | Modifies state — backup first |
| `terraform state rm <addr>` | Remove resource from state (cloud resource untouched) | Modifies state — backup first |
| `terraform state pull > file.json` | Export current state to a local file | Read-only — safe |
| `terraform state push file.json` | Overwrite remote state with local file | **Destructive** — triple-check first |
| `terragrunt import <addr> <id>` | Import an existing cloud resource into state | Modifies state — write the resource block first |

### Moved Block — Zero-Downtime Refactor

When renaming a resource or moving it into a module, use the `moved` block instead of `state mv`. It's tracked in Git, reviewable in a PR, and produces a clean plan.

```hcl
# Adding this block tells Terraform the address changed — no resource recreation
moved {
  from = aws_security_group.old_name
  to   = module.eks.aws_security_group.cluster
}
```

---

## 13. Common Anti-Patterns to Avoid

| Anti-Pattern | What Goes Wrong | Correct Approach |
| :--- | :--- | :--- |
| **Running `apply` locally against prod** | No audit trail, no review, no plan artifact. First incident waiting to happen. | All applies via CI/CD pipeline only. Local applies blocked by IAM — the apply role is only assumable via OIDC from `main` branch. |
| **Storing `AWS_ACCESS_KEY_ID` in CI secrets** | Long-lived credentials. One secret leak = full account compromise. | OIDC federation. No static credentials in any CI secret. |
| **Floating module references (`ref=main`)** | Silent breaking changes introduced on the next `terragrunt init`. | Pin every `source` to an exact Git tag. Upgrades are explicit, reviewed, and rollback-able. |
| **Monolithic `run-all apply` on every merge** | Applies unchanged stacks, wastes time, risks unintended changes to unrelated stacks. | Detect and apply only changed stacks. Use path filters + stack change detection scripts. |
| **Skipping plan review on "small" changes** | "Small" variable changes can trigger resource recreations (e.g., changing `engine_version` on RDS). | Every PR requires a plan review. No exceptions. Automate plan posting to PR comments. |
| **Committing `.terraform/` directory** | Massive repo bloat, provider binary conflicts between OS/arch. | `.terraform/` is gitignored. Providers downloaded fresh on each CI run. Only `.terraform.lock.hcl` is committed. |
| **Sharing state across environments** | A bad prod plan can accidentally show staging resources. A corrupted prod state can be confused with staging. | One state file per environment per layer. State paths encode account + region + layer. |
| **Using `count` for unique resources** | Index shift on list modification destroys and recreates resources. | Use `for_each` with a `map` or `set(string)` for all uniquely named resources. |
| **No `mock_outputs` on `dependency` blocks** | Plan fails in CI on new environments where dependencies haven't been applied yet. | All `dependency {}` blocks include `mock_outputs` and `mock_outputs_allowed_terraform_commands = ["validate", "plan"]`. |
| **`terraform destroy` without `prevent_destroy` guard** | Deletes production databases with no friction. | Set `lifecycle { prevent_destroy = true }` on all stateful resources in production modules. |
| **Ignoring Checkov/tfsec violations as noise** | Security misconfigurations accumulate until they become incidents. | Treat `CRITICAL` and `HIGH` findings as pipeline blockers. Use `#checkov:skip` with a written justification for accepted exceptions — never suppress silently. |