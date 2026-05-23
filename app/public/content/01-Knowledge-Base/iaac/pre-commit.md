# Pre-commit & Policy-as-Code for Infrastructure repos

Implementing a robust "shift-left" validation framework on the developer's local machine to catch syntax errors, linting issues, formatting problems, secrets, and security vulnerabilities before pushing to Git.

---

## Philosophy: Pre-commit vs. CI/CD

- **Pre-commit is local & fast:** A lightweight sandbox to catch 80% of issues early. It can be bypassed using `git commit --no-verify` (making it advisory, not a strict security gate).
- **CI/CD is global & authoritative:** Re-runs all checks plus plan-dependent policies. It is a strict gateway that blocks PR merges.

---

## Directory Structure

```
infrastructure/
├── .pre-commit-config.yaml           # Hook configuration
├── .secrets.baseline                  # detect-secrets baseline (COMMIT THIS)
├── .tflint.hcl                        # tflint rules and plugins
├── .terraform-docs.yaml               # terraform-docs config
├── .conftest/
│   ├── policy/                        # Rego policies (used by pre-commit AND CI)
│   │   ├── tags.rego
│   │   ├── encryption.rego
│   │   └── naming.rego
│   ├── policy_test/                   # OPA unit tests
│   │   └── tags_test.rego
│   └── data/                          # Policy data files
│       ├── allowed_regions.json
│       └── required_tags.json
```

---

## Hook Configuration (`.pre-commit-config.yaml`)

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

## Static vs. Dynamic OPA Policy Enforcement

Because pre-commit runs **before** a Terraform plan is generated, policies are split into static and dynamic checks:

### Static Policies (Checks HCL files directly)
- Checked in **Pre-commit**:
  - Required tags in resources (e.g., `Environment` tags).
  - Banned resource types (e.g., `aws_iam_user` - forcing IAM role adoption).
  - Parameter settings (e.g., `aws_s3_bucket` must set `encryption = true`).

### Dynamic Policies (Requires `terraform plan` output JSON)
- Checked in **CI/CD Only**:
  - Content analysis of IAM policy documents (computed resources).
  - IP range checks (CIDR values resolved from dynamic variables).
  - Security group inbound rules built from dynamic/for_each loops.

---

## Hook Lifecycle & Execution Speed

To maintain developer productivity, local hooks must run quickly. Optimize performance by ordering hooks by execution speed:

| Speed | Run Stage | Target Hooks |
|---|---|---|
| **Instant (< 1s)** | Every commit | trailing-whitespace, check-merge-conflict |
| **Fast (< 5s)** | Every commit | fmt, detect-secrets |
| **Medium (< 15s)** | Every commit | validate, tflint, conftest |
| **Slow (< 60s)** | Manual / Pre-push | checkov (scan only changed files) |
| **Heavy (> 60s)** | CI only | terraform plan, full security scans |

---

## Quick CLI Commands

```bash
# Setup hooks locally
pre-commit install
pre-commit install --hook-type commit-msg

# Run manually
pre-commit run --all-files                 # Run all hooks on all files
pre-commit run detect-secrets --all-files  # Run single hook
pre-commit run --hook-stage manual         # Run slow hooks manually

# Update hooks to newest versions
pre-commit autoupdate
```
