# Pre-commit & Policy-as-Code for Infrastructure Repos

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Philosophy: Local Pre-commit vs. CI/CD](#1-philosophy-local-pre-commit-vs-cicd) | Lightweight local advisory validation versus authoritative global environment pipelines. |
| **02** | [Directory Structure](#2-directory-structure) | Repository layout for hook configuration files, OPA policy directories, and baselines. |
| **03** | [Hook Configuration](#3-hook-configuration-pre-commit-configyaml) | Complete reference template for `.pre-commit-config.yaml` with security scanners and linters. |
| **04** | [Static vs. Dynamic OPA Policy Enforcement](#4-static-vs-dynamic-opa-policy-enforcement) | Pre-commit static code check constraints compared to plan-based runtime JSON tests. |
| **05** | [Hook Lifecycle & Execution Speed](#5-hook-lifecycle-execution-speed) | Optimizing local hooks for developer productivity, categorized from instant to heavy. |
| **06** | [Quick CLI Commands](#6-quick-cli-commands) | Installation, targeted hook executions, manual overrides, and autoupdate commands. |

---

## 1. Philosophy: Local Pre-commit vs. CI/CD

Validating configurations should happen as early as possible in the software development lifecycle (SDLC). We distinguish between the local validation sandbox and the authoritative deployment gate:

- **Pre-commit is local & fast:** Caught inside the developer workspace before a single file reaches Git. It acts as an *advisory sandbox* to catch 80% of issues early. It can be bypassed using `git commit --no-verify` when experimenting, which keeps developer friction low.
- **CI/CD is global & authoritative:** Triggered automatically upon PR creation and branch merges. It acts as a *strict validation gate* running plan-dependent security checks. It cannot be bypassed, and it blocks all unapproved merges.

---

## 2. Directory Structure

Standardizing the location of linters, policies, and hook definitions ensures consistency across enterprise platform repositories.

```text
infrastructure/
├── .pre-commit-config.yaml           # Local hook configuration definitions
├── .secrets.baseline                  # detect-secrets whitelist baseline (MUST commit)
├── .tflint.hcl                        # tflint rule overrides and plugin configurations
├── .terraform-docs.yaml               # terraform-docs formatting constraints
├── .conftest/
│   ├── policy/                        # Rego rules (shared between pre-commit and CI)
│   │   ├── tags.rego
│   │   ├── encryption.rego
│   │   └── naming.rego
│   ├── policy_test/                   # Unit tests for Rego policies
│   │   └── tags_test.rego
│   └── data/                          # Parameterized rules metadata
│       ├── allowed_regions.json
│       └── required_tags.json
```

---

## 3. Hook Configuration (`.pre-commit-config.yaml`)

This master hook definition aggregates universal formatting, secrets scanning, syntax verification, security scanning, and policy audits.

```yaml
minimum_pre_commit_version: "3.7.0"

repos:
  # ─── GENERAL HYGIENE ────────────────────────────────────────────
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
        args: ['--unsafe']
      - id: check-json
      - id: check-merge-conflict
      - id: check-added-large-files
        args: ['--maxkb=500']
      - id: no-commit-to-branch
        args: ['--branch', 'main']

  # ─── SECRET DETECTION ───────────────────────────────────────────
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
        exclude: '(\.terraform/|\.terragrunt-cache/|\.lock\.hcl$)'

  # ─── TERRAFORM / TERRAGRUNT ────────────────────────────────────
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.96.1
    hooks:
      - id: terraform_fmt
        args: ['--args=-diff', '--args=-write=true']
      - id: terragrunt_fmt
      - id: terraform_validate
        args: ['--hook-config=--retry-once-with-cleanup=true']
      - id: terraform_tflint
        args: ['--args=--config=__GIT_WORKING_DIR__/.tflint.hcl']
      - id: terraform_docs
        args:
          - '--hook-config=--path-to-file=README.md'
          - '--hook-config=--add-to-existing-file=true'
          - '--hook-config=--create-file-if-not-exist=true'

  # ─── SECURITY SCANNING ──────────────────────────────────────────
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.96.1
    hooks:
      - id: terraform_checkov
        args: ['--args=--quiet', '--args=--compact', '--args=--framework terraform']

  # ─── OPA / CONFTEST (Static Policy Checks) ─────────────────────
  - repo: local
    hooks:
      - id: conftest-terraform
        name: OPA policy check (static)
        entry: scripts/pre-commit-conftest.sh
        language: script
        files: '\.tf$'
        exclude: '\.terraform/.*'
        pass_filenames: true
      - id: opa-test
        name: OPA policy unit tests
        entry: opa test .conftest/policy/ -v
        language: system
        files: '\.rego$'
        pass_filenames: false

  # ─── COMMIT MESSAGE ────────────────────────────────────────────
  - repo: https://github.com/compilerla/conventional-pre-commit
    rev: v3.4.0
    hooks:
      - id: conventional-pre-commit
        stages: [commit-msg]
        args: ['feat', 'fix', 'chore', 'docs', 'refactor', 'ci', 'test']
```

---

## 4. Static vs. Dynamic OPA Policy Enforcement

Because pre-commit runs **before** a Terraform plan is generated, policies are split into static and dynamic categories to manage validation dependencies:

### Static Policies (Checks HCL files directly)
- **Local Hook Verification:** Evaluates HCL configuration directories without authenticating to cloud providers or waiting for resource allocations.
- **Rules Enforced:**
  - Mandatory resource tag keys (e.g., `Environment`, `ManagedBy` present in variables/locals).
  - Explicitly banned resources (e.g., blocking `aws_iam_user` to force AWS IAM Identity Center usage).
  - Required basic parameter flags (e.g., S3 buckets must declare `aws_s3_bucket_server_side_encryption_configuration`).

### Dynamic Policies (Requires `terraform plan` output JSON)
- **CI/CD Pipeline Gate:** Evaluates compiled plans with resolved variables and resource graph dependencies.
- **Rules Enforced:**
  - Inspection of calculated IAM policy documents to prevent `*` administrative grants.
  - CIDR routing verification against actual environment routing tables.
  - Verification of port configurations inside complex `dynamic` security group arrays.

---

## 5. Hook Lifecycle & Execution Speed

To maintain developer productivity, local hooks must run quickly. Optimize performance by ordering hooks by execution speed:

| Speed Profile | Run Trigger | Targeting Hook Configurations |
|---|---|---|
| **Instant (< 1s)** | Every commit | `trailing-whitespace`, `check-merge-conflict`, `check-yaml` |
| **Fast (< 5s)** | Every commit | `terraform_fmt`, `detect-secrets` |
| **Medium (< 15s)** | Every commit | `terraform_validate`, `terraform_tflint`, `conftest-terraform` |
| **Slow (< 60s)** | Manual / Pre-push | `terraform_checkov` (optimized to scan only changed files) |
| **Heavy (> 60s)** | CI/CD Runner Only | `terraform plan`, dynamic OPA policy engine evaluations, and system tests |

---

## 6. Quick CLI Commands

Standard commands to bootstrap, execute, and maintain pre-commit validation states inside local development directories:

```bash
# Register hooks with git triggers inside the active repository
pre-commit install
pre-commit install --hook-type commit-msg

# Run validation manual checks
pre-commit run --all-files                 # Run every hook against all files in the repository
pre-commit run detect-secrets --all-files  # Targeted run of secret detection only
pre-commit run --hook-stage manual         # Trigger slow and heavy checks explicitly

# Keep hook binaries and configuration sources updated
pre-commit autoupdate
```
