# Pre-commit for Terragrunt Monorepos — Best Practices Cheatsheet

> *Companion to [iac.md](file:///root/workspace/interview/iac.md) — read that first for Terraform/Terragrunt fundamentals.*

> ## 📌 Quick Summary — Top Rules to Remember
>
> 1. **Pre-commit is shift-left, not enforcement** — it catches issues early on the developer's machine, but CI is the real gate; never rely on pre-commit alone
> 2. **`--no-verify` exists** — any developer can skip hooks; design your system assuming they will; CI must re-run the same checks
> 3. **Pick ONE security scanner for pre-commit** — Checkov OR tfsec OR Trivy, not all three; run the others in CI if needed
> 4. **Keep hooks under 30 seconds total** — slow hooks get skipped; move heavy checks to `stages: [manual]` or CI
> 5. **Commit `.secrets.baseline`** — detect-secrets needs a shared baseline; uncommitted = inconsistent results across team
> 6. **Pre-commit OPA is static only** — no `terraform plan` = no computed values; CI does the real plan-based policy check
> 7. **Same policy files in pre-commit and CI** — DRY; `.conftest/` policies used by both layers; no divergence

---

## 1. Pre-commit Philosophy

### What Pre-commit Is and Is NOT

```
Pre-commit IS:
  ✓ A fast feedback loop on the developer's machine
  ✓ A linter / formatter that catches obvious issues BEFORE pushing
  ✓ A "you forgot to run terraform fmt" safety net
  ✓ A shift-left tool — catch at commit, not at PR review

Pre-commit is NOT:
  ✗ A security gate (anyone can --no-verify)
  ✗ A replacement for CI checks
  ✗ A place to run terraform plan (no state access locally)
  ✗ A guaranteed enforcement layer
```

### Where Pre-commit Fits

```
Developer machine (pre-commit):
  → Fast static checks: fmt, validate, lint, secret scan, basic policy
  → Goal: catch 80% of issues before push
  → Enforcement: NONE (advisory only)

CI pipeline (GitHub Actions):
  → Full checks: fmt, validate, plan, policy-on-plan, security scan
  → Goal: catch 100% of issues before merge
  → Enforcement: HARD BLOCK (required status check)

Both layers run the SAME tools and policies — pre-commit is just faster feedback.
```

### The `--no-verify` Problem

```bash
# Any developer can skip all hooks
git commit --no-verify -m "yolo"

# This is why:
#   1. CI MUST re-run every check pre-commit runs
#   2. Branch protection rules must require CI to pass
#   3. Pre-commit is a convenience, not a control
```

> ⚠️ Never list pre-commit as a security control in an audit. It is not enforceable.

---

## 2. Full .pre-commit-config.yaml

```yaml
# .pre-commit-config.yaml
# Terragrunt monorepo — complete hook configuration

# Minimum pre-commit version required
minimum_pre_commit_version: "3.7.0"

repos:
  # ─── GENERAL HYGIENE ────────────────────────────────────────────

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace           # Remove trailing spaces
      - id: end-of-file-fixer             # Ensure newline at EOF
      - id: check-yaml                    # Validate YAML syntax
        args: ['--unsafe']                # Allow custom YAML tags (Helm, CloudFormation)
      - id: check-json                    # Validate JSON syntax
      - id: check-merge-conflict          # Detect unresolved merge markers
      - id: check-added-large-files       # Prevent committing binaries/large blobs
        args: ['--maxkb=500']
      - id: no-commit-to-branch           # Block direct commits to main
        args: ['--branch', 'main']

  # ─── SECRET DETECTION ───────────────────────────────────────────

  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
        exclude: |
          (?x)^(
            \.terraform/.*|
            \.terragrunt-cache/.*|
            .*\.lock\.hcl$
          )$

  # ─── TERRAFORM / TERRAGRUNT ────────────────────────────────────

  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.96.1
    hooks:
      # Format
      - id: terraform_fmt
        args:
          - '--args=-diff'                # Show diff of format changes
          - '--args=-write=true'          # Auto-fix formatting

      - id: terragrunt_fmt
        args:
          - '--args=--terragrunt-hclfmt-file'

      # Validate
      - id: terraform_validate
        args:
          - '--hook-config=--retry-once-with-cleanup=true'   # Clean .terraform on fail

      - id: terragrunt_validate
        # Note: may need AWS creds for provider download; skip if offline
        args:
          - '--args=--terragrunt-no-auto-init=false'

      # Lint
      - id: terraform_tflint
        args:
          - '--args=--config=__GIT_WORKING_DIR__/.tflint.hcl'

      # Documentation (auto-generate README from variables/outputs)
      - id: terraform_docs
        args:
          - '--hook-config=--path-to-file=README.md'
          - '--hook-config=--add-to-existing-file=true'
          - '--hook-config=--create-file-if-not-exist=true'

  # ─── SECURITY SCANNING (pick ONE — we use Checkov) ─────────────

  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.96.1
    hooks:
      - id: terraform_checkov
        args:
          - '--args=--quiet'                 # Only show failed checks
          - '--args=--compact'               # Compact output
          - '--args=--skip-check CKV_AWS_999' # Skip known false positives
          - '--args=--framework terraform'

  # ─── OPA / CONFTEST (static policy checks) ─────────────────────

  - repo: local
    hooks:
      - id: conftest-terraform
        name: OPA policy check (static)
        entry: scripts/pre-commit-conftest.sh
        language: script
        files: '\.tf$'
        exclude: '\.terraform/.*'
        pass_filenames: true

      # Test OPA policies themselves when .rego files change
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

## 3. Hook Deep Dives

### detect-secrets

```bash
# Initial setup — generate baseline file
detect-secrets scan --baseline .secrets.baseline

# Audit baseline — review flagged items
detect-secrets audit .secrets.baseline

# What it catches:
#   → AWS access keys (AKIA...)
#   → Private keys (BEGIN RSA PRIVATE KEY)
#   → High-entropy strings (potential passwords/tokens)
#   → Base64-encoded secrets
#   → Common password patterns

# What it does NOT catch:
#   → Secrets in binary files
#   → Encrypted secrets (correctly identified as non-plaintext)
#   → Obfuscated or split-across-lines secrets
```

```bash
# Managing false positives
# Option 1: Mark as false positive in audit
detect-secrets audit .secrets.baseline
# → Interactive prompt: is this a real secret? (y/n/s)
# → Marked false positives are remembered in baseline

# Option 2: Inline suppression
variable "example" {
  default = "not-a-secret"  # pragma: allowlist secret
}

# Option 3: Exclude file patterns in .pre-commit-config.yaml (see config above)
```

> ⚠️ **Always commit `.secrets.baseline` to Git.** Without it, every developer generates their own baseline → inconsistent results.

### terraform_fmt + terragrunt_fmt

```
terraform_fmt:
  → Formats .tf files to canonical HCL style
  → --diff shows what changed (useful for learning)
  → --write=true auto-fixes (default behavior)
  → Runs per-directory (finds all .tf files in each dir)

terragrunt_fmt (hclfmt):
  → Formats terragrunt.hcl files
  → Same canonical HCL formatting
  → No --diff mode available — always overwrites
```

### terraform_validate

```
What it does:
  → Checks .tf files for syntax and internal consistency
  → Verifies resource types, argument names, required attributes
  → Requires `terraform init` to have been run (needs provider schemas)

When it needs credentials:
  → Never for syntax validation
  → Provider download needs network access (registry.terraform.io)
  → Some providers need auth to fetch schema (rare)

Gotcha:
  → Fails if .terraform/ is stale — use --retry-once-with-cleanup
  → For modules/ that aren't root modules, validate may need a test harness
```

### Security Scanner Comparison

| Feature | Checkov | tfsec | Trivy |
|---|---|---|---|
| Terraform support | ✅ Full | ✅ Full | ✅ Full |
| Terragrunt support | ✅ Native | ⚠️ Limited | ⚠️ Limited |
| Custom policies | Python + YAML | Rego | Rego |
| Speed | Moderate | Fast | Fast |
| False positive rate | Medium | Low | Low |
| CI integration | Excellent | Good (now Trivy) | Excellent |
| Pre-commit hook | `terraform_checkov` | `terraform_tfsec` | `terraform_trivy` |
| Active development | ✅ Very active | ⚠️ Merged into Trivy | ✅ Very active |
| SARIF output | ✅ | ✅ | ✅ |

> 💡 **Recommendation:** Pick **Checkov** for pre-commit (best Terragrunt support, custom policies in YAML). Run **Trivy** in CI for broader coverage (containers, SBOM). tfsec is now part of Trivy — avoid running both.

### terraform_docs

```yaml
# .terraform-docs.yaml (place in repo root or module root)
formatter: markdown table

sections:
  show:
    - header
    - inputs
    - outputs
    - resources
    - requirements

content: |-
  {{ .Header }}

  ## Usage

  {{ .Content }}

  {{ .Inputs }}

  {{ .Outputs }}

  {{ .Resources }}

output:
  file: README.md
  mode: inject                    # inject into existing README between markers
  # mode: replace                 # overwrite entire README (use for modules/)

settings:
  indent: 3
  anchor: true
  default: true
  required: true
  type: true
```

```
inject mode:
  Looks for markers in existing README:
  <!-- BEGIN_TF_DOCS --> ... <!-- END_TF_DOCS -->
  Only replaces content between markers

replace mode:
  Overwrites entire README.md
  Better for reusable modules/ with generated-only docs

Recommendation:
  modules/ → replace mode (README is 100% auto-generated)
  environments/ → inject mode (README has manual context + auto-generated docs)
```

### OPA / conftest (Static Check)

```bash
#!/bin/bash
# scripts/pre-commit-conftest.sh
# Static OPA policy check for Terraform files
# Limitation: no plan data = no computed values (see §5)

set -euo pipefail

# Find unique directories from changed .tf files
DIRS=$(echo "$@" | tr ' ' '\n' | xargs -I{} dirname {} | sort -u)

POLICY_DIR=".conftest/policy"
DATA_DIR=".conftest/data"

EXIT_CODE=0

for dir in $DIRS; do
  # Skip if no .tf files in directory
  [ -z "$(ls "$dir"/*.tf 2>/dev/null)" ] && continue

  echo "==> Checking $dir"

  # Run conftest on raw .tf files (HCL parse, not plan JSON)
  if ! conftest test "$dir"/*.tf \
    --policy "$POLICY_DIR" \
    --data "$DATA_DIR" \
    --parser hcl2 \
    --no-color; then
    EXIT_CODE=1
  fi
done

exit $EXIT_CODE
```

---

## 4. OPA in Pre-commit — Constraints and Scope

### Why Pre-commit OPA Is Limited

```
Pre-commit runs BEFORE terraform plan.
No plan = no computed values = limited policy scope.

What pre-commit OPA CAN check (static HCL):
  ✓ Required tags present in resource blocks
  ✓ Forbidden resource types (e.g., aws_iam_user)
  ✓ Required arguments (e.g., encryption = true on aws_s3_bucket)
  ✓ Naming conventions (resource name patterns)
  ✓ Banned providers or modules
  ✓ Variable constraints (type, description present)

What pre-commit OPA CANNOT check (needs plan):
  ✗ IAM policy document content (computed from data sources)
  ✗ Security group rules from dynamic blocks
  ✗ Actual CIDR values from variables passed at plan time
  ✗ Cross-module references (dependency outputs)
  ✗ Conditional resources (count/for_each resolved at plan)
```

### The modules/ Gap

```
environments/prod/vpc/            ← "live" module — has terragrunt.hcl
  → conftest checks *.tf files here ✓
  → But inputs come from terragrunt.hcl, not variables.tf defaults
  → Static check sees variable declarations, not actual values

modules/vpc/                      ← "reusable" module — no terragrunt.hcl
  → conftest checks *.tf files here ✓
  → All values are parameterized (var.*)
  → Static check can verify structure, not runtime values

Strategy:
  modules/ → check structure: required variables, outputs, tags pattern
  live/    → check config: terragrunt.hcl inputs, source references
```

### Coverage Comparison: Pre-commit vs CI

| File Type | Pre-commit Check | CI Check | Gap |
|---|---|---|---|
| `environments/**/*.tf` | Static HCL parse (conftest) | Plan-based policy (conftest on plan JSON) | Computed values, dynamic blocks |
| `environments/**/terragrunt.hcl` | Format (hclfmt), validate | Full plan + apply | Dependency resolution, remote state |
| `modules/**/*.tf` | fmt, validate, tflint, conftest static | Plan with test harness, checkov | Integration behavior |
| `.conftest/**/*.rego` | `opa test` (unit tests) | `opa test` (same) | None — fully tested at both layers |
| `scripts/**/*.sh` | shellcheck (if added) | shellcheck | None |

---

## 5. Performance — Keeping Pre-commit Fast

### Hook Ordering (Fail-Fast)

```yaml
# Hooks run in order listed in .pre-commit-config.yaml
# Put FASTEST and MOST LIKELY TO FAIL hooks first

Order by speed:
  1. trailing-whitespace, end-of-file     (~instant, catches common issues)
  2. check-merge-conflict                 (~instant, blocks bad commits)
  3. no-commit-to-branch                  (~instant, blocks direct-to-main)
  4. detect-secrets                       (~1-2s, catches leaked secrets early)
  5. terraform_fmt / terragrunt_fmt       (~1-3s, most common failure)
  6. terraform_validate                   (~3-5s, needs provider download)
  7. terraform_tflint                     (~3-5s, linting rules)
  8. terraform_docs                       (~2-3s, README generation)
  9. terraform_checkov                    (~5-15s, security scanning)
  10. conftest-terraform                  (~2-5s, OPA policy check)
```

### Slow Hook Management

```yaml
# Move heavy hooks to manual stage — run on demand, not every commit
- id: terraform_checkov
  stages: [manual]                  # Only runs with: pre-commit run --hook-stage manual

# Developer can explicitly run slow hooks before pushing:
pre-commit run --hook-stage manual --all-files
```

### Performance Targets

| Category | Target | Hooks |
|---|---|---|
| Instant (< 1s) | Every commit | whitespace, merge-conflict, branch check |
| Fast (< 5s) | Every commit | fmt, detect-secrets |
| Medium (< 15s) | Every commit | validate, tflint, docs |
| Slow (< 60s) | Manual / pre-push | checkov, conftest full scan |
| Heavy (> 60s) | CI only | terraform plan, full security scan |

### Key Performance Settings

```yaml
# pass_filenames: true — hook receives only CHANGED files (fast)
# pass_filenames: false — hook runs once regardless of files (use for global checks)

- id: conftest-terraform
  pass_filenames: true          # Only check directories with changed .tf files

# require_serial: true — prevent parallel execution (needed for state-dependent hooks)
- id: terraform_validate
  require_serial: true          # Avoid concurrent init in same directory
```

---

## 6. Directory Structure

```
infrastructure/
├── .pre-commit-config.yaml           # Hook configuration
├── .secrets.baseline                  # detect-secrets baseline (COMMIT THIS)
├── .tflint.hcl                        # tflint config (rules, plugins)
├── .terraform-docs.yaml               # terraform-docs config (optional global)
│
├── .conftest/                         # OPA policy directory
│   ├── policy/                        # Rego policies
│   │   ├── tags.rego                  # Required tagging policy
│   │   ├── encryption.rego            # Encryption requirements
│   │   ├── naming.rego                # Resource naming conventions
│   │   └── banned.rego                # Banned resources/providers
│   ├── policy_test/                   # OPA unit tests (opa test)
│   │   ├── tags_test.rego
│   │   ├── encryption_test.rego
│   │   └── testdata/                  # Test fixtures (.tf snippets)
│   └── data/                          # Policy data files
│       ├── allowed_regions.json       # {"allowed": ["ap-southeast-1", ...]}
│       └── required_tags.json         # {"required": ["Environment", "Team", ...]}
│
├── scripts/
│   ├── pre-commit-conftest.sh         # OPA pre-commit wrapper
│   └── setup-dev.sh                   # Developer environment setup
│
├── modules/                           # Reusable Terraform modules (see iac.md §16)
├── environments/                      # Live infrastructure (see iac.md §16)
└── terragrunt.hcl                     # Root Terragrunt config (see iac.md §16)
```

---

## 7. Team Onboarding

### setup-dev.sh

```bash
#!/bin/bash
# scripts/setup-dev.sh — one-command developer environment setup
set -euo pipefail

echo "==> Setting up development environment for Terragrunt monorepo"

OS=$(uname -s)

# ─── Install tools ────────────────────────────────────────────────

if [[ "$OS" == "Darwin" ]]; then
  echo "==> macOS detected — using Homebrew"
  brew install --quiet \
    pre-commit \
    terraform \
    terragrunt \
    tflint \
    terraform-docs \
    checkov \
    detect-secrets \
    conftest \
    opa \
    shellcheck

elif [[ "$OS" == "Linux" ]]; then
  echo "==> Linux detected — installing binaries"

  # pre-commit
  pip3 install --user pre-commit detect-secrets checkov

  # terraform (via tfenv)
  if ! command -v tfenv &>/dev/null; then
    git clone --depth=1 https://github.com/tfutils/tfenv.git ~/.tfenv
    echo 'export PATH="$HOME/.tfenv/bin:$PATH"' >> ~/.bashrc
    export PATH="$HOME/.tfenv/bin:$PATH"
  fi
  tfenv install latest && tfenv use latest

  # terragrunt
  TGVER="0.68.0"
  curl -sL "https://github.com/gruntwork-io/terragrunt/releases/download/v${TGVER}/terragrunt_linux_amd64" \
    -o /usr/local/bin/terragrunt && chmod +x /usr/local/bin/terragrunt

  # tflint
  curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash

  # terraform-docs
  curl -sL https://terraform-docs.io/dl/v0.19.0/terraform-docs-v0.19.0-linux-amd64.tar.gz \
    | tar xz -C /usr/local/bin terraform-docs

  # conftest
  CONFVER="0.56.0"
  curl -sL "https://github.com/open-policy-agent/conftest/releases/download/v${CONFVER}/conftest_${CONFVER}_Linux_x86_64.tar.gz" \
    | tar xz -C /usr/local/bin conftest

  # opa
  curl -sL -o /usr/local/bin/opa https://openpolicyagent.org/downloads/latest/opa_linux_amd64_static \
    && chmod +x /usr/local/bin/opa
fi

# ─── Install pre-commit hooks ────────────────────────────────────

echo "==> Installing pre-commit hooks"
pre-commit install                        # pre-commit hook
pre-commit install --hook-type commit-msg  # conventional commit hook

# ─── Initialize detect-secrets baseline (if not exists) ──────────

if [ ! -f .secrets.baseline ]; then
  echo "==> Generating .secrets.baseline"
  detect-secrets scan --baseline .secrets.baseline
fi

# ─── Verify installations ────────────────────────────────────────

echo ""
echo "==> Tool versions:"
echo "  pre-commit:     $(pre-commit --version)"
echo "  terraform:      $(terraform version -json | jq -r '.terraform_version')"
echo "  terragrunt:     $(terragrunt --version | head -1)"
echo "  tflint:         $(tflint --version)"
echo "  terraform-docs: $(terraform-docs version)"
echo "  checkov:        $(checkov --version 2>&1)"
echo "  detect-secrets: $(detect-secrets --version)"
echo "  conftest:       $(conftest --version)"
echo "  opa:            $(opa version | head -1)"
echo ""
echo "✅ Setup complete! Run 'pre-commit run --all-files' to verify."
```

### Running Hooks Manually

```bash
# Run ALL hooks on ALL files (full check)
pre-commit run --all-files

# Run a specific hook
pre-commit run terraform_fmt --all-files
pre-commit run detect-secrets --all-files

# Run only on staged files (what would run on commit)
pre-commit run

# Run manual-stage hooks (slow hooks)
pre-commit run --hook-stage manual --all-files

# Update hook versions to latest
pre-commit autoupdate

# Clear pre-commit cache (fix stale environments)
pre-commit clean
```

### Legitimate `--no-verify` Use Cases

```bash
# ✓ OK: WIP commit on a feature branch (will squash later)
git commit --no-verify -m "wip: checkpoint"

# ✓ OK: Committing auto-generated files that fail formatting
git commit --no-verify -m "chore: update generated lock files"

# ✓ OK: Emergency hotfix with team awareness
git commit --no-verify -m "fix: emergency prod fix, hooks skipped"

# ✗ NOT OK: Skipping because "hooks are slow" (fix the hook config instead)
# ✗ NOT OK: Skipping because "secret detection false positive" (update baseline instead)
# ✗ NOT OK: Routinely skipping on every commit (means hooks are broken or too slow)
```

---

## 8. CI vs Pre-commit Responsibility Matrix

| Check | Pre-commit | CI (GitHub Actions) | Enforcement |
|---|---|---|---|
| **Formatting** (fmt) | ✅ Auto-fix on commit | ✅ `--check` mode (fail if unformatted) | CI blocks merge |
| **Syntax** (validate) | ✅ Fast feedback | ✅ Full validate with providers | CI blocks merge |
| **Linting** (tflint) | ✅ Catches common issues | ✅ Same rules, all files | CI blocks merge |
| **Secret detection** | ✅ Pre-commit scan | ✅ TruffleHog / gitleaks on diff | CI blocks merge |
| **Security scan** (Checkov) | ✅ Static on changed files | ✅ Full scan, all files | CI blocks merge |
| **OPA policy** (static) | ✅ HCL parse, basic rules | ✅ Same policies, all files | CI blocks merge |
| **OPA policy** (plan) | ❌ No plan available | ✅ `conftest test tfplan.json` | **CI only** |
| **Terraform plan** | ❌ No state access | ✅ Full plan per module | **CI only** |
| **Terraform apply** | ❌ Never | ✅ On merge to main | **CI only** |
| **Module docs** (terraform-docs) | ✅ Auto-generate README | ✅ Verify README is up to date | CI blocks merge |
| **Commit message** | ✅ Conventional commits | ⚠️ Optional (PR title check) | Pre-commit advisory |
| **OPA test** (rego) | ✅ On .rego file changes | ✅ Always run all tests | CI blocks merge |

```
Key insight:
  Pre-commit: catches issues in < 30s at commit time → fast developer feedback
  CI:         catches everything in 5-15 min at PR time → hard enforcement gate

  Both run the SAME tools, SAME configs, SAME policies.
  The difference is scope (changed files vs all files) and enforcement (advisory vs blocking).
```

### Why Both Layers Use the Same Policy Files

```
.conftest/policy/tags.rego        ← used by BOTH pre-commit and CI
.tflint.hcl                       ← used by BOTH pre-commit and CI
.secrets.baseline                 ← used by BOTH pre-commit and CI

DRY principle:
  → One set of policies, two execution contexts
  → Update policy once → enforced everywhere
  → No drift between what developers see locally and what CI enforces
```

---

## 9. Common Anti-Patterns to Avoid

- ❌ **Running plan-dependent hooks in pre-commit** — no local state/creds means it either fails or gives false results
- ❌ **Not committing `.secrets.baseline`** — each developer gets different results; new team members hit false positives on day one
- ❌ **Pre-commit as the only security gate** — `--no-verify` bypasses everything; CI is the real gate
- ❌ **Running all three scanners** (Checkov + tfsec + Trivy) in pre-commit — 45s+ hook time; developers will skip it
- ❌ **No `opa test` hook on `.rego` changes** — policies without tests break silently; catch in pre-commit before CI
- ❌ **Different tool versions in pre-commit vs CI** — "works locally, fails in CI" is the worst developer experience; pin versions in both
- ❌ **Not using `stages: [manual]` for slow hooks** — every hook runs on every commit; 60s+ commit time kills productivity
- ❌ **Ignoring `.terragrunt-cache/` in hooks** — hooks scan cached modules and report thousands of findings from upstream code
- ❌ **No `setup-dev.sh` script** — new team members spend half a day installing tools manually; automate it
- ❌ **Running conftest on modules/ with live-config expectations** — modules have parameterized values; static check sees `var.x`, not actual values

---

*For Terraform/Terragrunt fundamentals, module design, state management, and Terragrunt project structure, see [iac.md](file:///root/workspace/interview/iac.md).*

*Good luck with the interview!*
