# GitHub Actions — CI/CD Pipeline Reference

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Pipeline Architecture & Mental Model](#1-pipeline-architecture-mental-model) | How the two triggers (PR vs. push to main) create a clean separation between validation and deployment. |
| **02** | [Security Design](#2-security-design) | OIDC authentication, scoped permissions, blast radius isolation, and why static keys are an anti-pattern. |
| **03** | [Job Structure & Parallelism](#3-job-structure-parallelism) | How `needs` chains create a directed graph, which jobs run in parallel, and where the quality gate sits. |
| **04** | [Full Pipeline Reference](#4-full-pipeline-reference) | The complete annotated `.github/workflows/pipeline.yml` for direct use or adaptation. |
| **05** | [Deployment Strategy](#5-deployment-strategy) | Staging-first rollout, smoke tests, production approval gates, and Helm atomic deploys. |
| **06** | [Performance Optimizations](#6-performance-optimizations) | Dependency caching, Docker layer caching, and concurrency cancellation — and why each one matters. |
| **07** | [Operational Rules & Common Failures](#7-operational-rules-common-failures) | The non-obvious failure modes that surface in production pipelines and how to prevent them. |

---

## 1. Pipeline Architecture & Mental Model

A GitHub Actions pipeline for a production service has two distinct jobs: **validate** and **deploy**. The most important architectural decision is keeping these two concerns cleanly separated by trigger event.

```
Pull Request to main  → CI runs (lint, test, build, scan)
                       → CD does NOT run
                       → Purpose: prove the code is safe to merge

Push to main (merge)  → CI runs (lint, test, build, scan, push image)
                       → CD runs (deploy to staging → prod)
                       → Purpose: deploy validated code to environments
```

The key insight is that **the push-to-main trigger is not a deploy trigger — it is a merge trigger**. By the time code reaches `main`, it has already passed CI on the PR. The post-merge CI run is a second pass with one critical addition: it pushes the built image to the registry. CD jobs only run after that image exists and is verified.

### Why not deploy on PR?

Deploying on PR is a common early mistake. Pull requests are ephemeral — they may be rebased, force-pushed, or abandoned. Deploying every PR branch to staging creates environment churn, resource contention between concurrent PRs, and makes it impossible to reason about what is actually deployed. The PR trigger exists to give developers fast feedback on code quality, not to drive deployments.

### The Image as the Deployment Artifact

The pipeline treats the Docker image — tagged with the immutable Git commit SHA — as the deployment artifact. The SHA tag is what flows from the `build` job into `deploy-staging` and then `deploy-prod`. This means:

- Every deploy is traceable to an exact commit
- Staging and production always run the same binary — the image is not rebuilt per environment
- Rolling back is re-deploying a previous SHA tag, not reverting source code and rebuilding

### Trigger Comparison

| Property | `pull_request` trigger | `push` to `main` trigger |
| :--- | :--- | :--- |
| When it fires | On PR open, sync, or reopen | On merge commit to `main` |
| Image pushed to registry | No | Yes |
| CD jobs run | No | Yes |
| Purpose | Developer feedback loop | Promotion to environments |
| Concurrency behavior | Cancelled if new commit pushed to PR branch | Runs to completion (or queued) |

---

## 2. Security Design

Pipeline security is often treated as an afterthought. In practice, a compromised pipeline is a compromised production environment. The reference pattern applies four security controls.

### OIDC Authentication — No Static Keys

The traditional approach to AWS authentication from GitHub Actions is to store an IAM Access Key and Secret in GitHub repository secrets and inject them as environment variables. This has a fundamental problem: the keys are long-lived credentials that persist until manually rotated. If they leak — through a log, a compromised runner, or a supply chain attack — they remain valid.

OpenID Connect (OIDC) eliminates long-lived keys entirely. The mechanism works as follows:

1. GitHub's OIDC provider issues a short-lived JWT token to the runner at job start
2. The runner presents this token to AWS STS via `AssumeRoleWithWebIdentity`
3. AWS validates the token against GitHub's public JWKS endpoint and issues temporary credentials (valid for the duration of the job — typically minutes)
4. The runner uses those temporary credentials to interact with AWS

The temporary credentials expire automatically. There is no secret to rotate, no leaked key that remains valid after the job ends, and no static secret stored in GitHub at all.

The IAM role trust policy controls which GitHub repositories and branches can assume which roles. A correctly scoped trust policy looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:your-org/your-repo:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

The `sub` condition locks the role to a specific repository and branch. A fork of the repository cannot assume this role. A feature branch cannot assume the production deployment role.

### Explicit Workflow Permissions

GitHub Actions grants broad default permissions to the `GITHUB_TOKEN` when no explicit `permissions` block is set. The reference pattern declares minimal permissions explicitly:

```yaml
permissions:
  contents: read       # checkout code only
  id-token: write      # exchange OIDC token with AWS
  pull-requests: write # post review comments (optional)
```

This is least-privilege at the workflow level. A compromised step cannot push to the repository, create releases, or modify branch protections.

### Blast Radius Isolation via Separate IAM Roles

The pipeline uses three distinct IAM roles — one for CI, one for staging CD, one for production CD — each with only the permissions needed for that phase:

| Role | Used by | Permissions |
| :--- | :--- | :--- |
| `github-actions-ci` | `build` job | ECR push, ECR describe |
| `github-actions-cd` | `deploy-staging` job | EKS describe, Helm values read |
| `github-actions-cd-prod` | `deploy-prod` job | EKS describe (prod cluster only) |

If the staging deployment job is compromised, it cannot assume the production role. If the CI build job is compromised, it cannot deploy anything — it can only push an image.

### Supply Chain Security — Dependency and Image Scanning

Two scanning stages address different attack vectors. `audit-ci` (or `npm audit`) catches known CVEs in third-party dependencies pulled at build time — the supply chain risk. Trivy catches CVEs in the OS packages and runtime layers of the built image — the artifact risk. Both gate the pipeline: a CRITICAL finding in either stage blocks the deploy.

---

## 3. Job Structure & Parallelism

GitHub Actions jobs run in parallel by default. The `needs` keyword creates explicit dependencies, forming a directed acyclic graph (DAG). Understanding the graph is essential for pipeline performance and for understanding where failures surface.

### The Job DAG

```
lint ──┐
       ├──→ build ──→ deploy-staging ──→ deploy-prod
test ──┤
       │
scan ──┘
```

- `lint`, `test`, and `security-scan` run in parallel — they have no `needs` dependency on each other
- `build` runs only after all three pass — it is the quality gate
- `deploy-staging` runs only after `build`, and only on push to main
- `deploy-prod` runs only after `deploy-staging` passes its smoke test

### The Quality Gate

The `build` job's `needs: [lint, test, security-scan]` is the quality gate. If **any** of the three parallel checks fails, `build` is skipped. If `build` is skipped, `deploy-staging` is skipped. If `deploy-staging` is skipped, `deploy-prod` is skipped. A single lint failure blocks production without requiring any conditional logic in the CD jobs — the DAG enforces it structurally.

### Job Timing (Approximate)

| Job | Runs in parallel with | Typical duration |
| :--- | :--- | :--- |
| `lint` | `test`, `security-scan` | 1–2 min |
| `test` | `lint`, `security-scan` | 2–5 min |
| `security-scan` | `lint`, `test` | 1–3 min |
| `build` | Nothing (waits for all three) | 3–8 min |
| `deploy-staging` | Nothing (waits for build) | 2–4 min |
| `deploy-prod` | Nothing (waits for staging) | 2–4 min |

Total wall-clock time for a clean pipeline: approximately 12–22 minutes, with the parallel CI phase being the bottleneck.

---

## 4. Full Pipeline Reference

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
    paths-ignore: ['**.md', 'docs/**']   # Skip CI on doc-only changes
  pull_request:
    branches: [main]

# Cancel in-progress runs for the same PR/branch
# On PR: cancels stale runs when new commits are pushed
# On main: does NOT cancel (omit cancel-in-progress or set to false for main)
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# Least-privilege — declare only what is needed
permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:

  # ─── CI PHASE: runs in parallel on both PR and push to main ──────────

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'               # Restores node_modules from cache keyed on package-lock.json

      - run: npm ci                  # Clean install — never npm install in CI
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci
      - run: npm test -- --coverage

      - name: Upload coverage report
        if: always()                 # Upload even when tests fail — needed for failure diagnosis
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Dependency audit
        run: npx audit-ci --critical # Fails on CRITICAL CVEs in npm dependencies

      - name: Secret detection
        uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --only-verified --fail  # Only verified secrets; avoids false positive noise

  # ─── QUALITY GATE: build only runs when ALL three CI checks pass ──────

  build:
    needs: [lint, test, security-scan]
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ github.sha }}   # SHA flows into CD jobs as the deployment artifact identifier

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-ci
          aws-region: ap-southeast-1

      - name: Login to Amazon ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3  # Required for BuildKit layer caching

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: ${{ github.event_name == 'push' }}   # Do not push on PR — build only for validation
          tags: |
            ${{ steps.ecr-login.outputs.registry }}/myapp:${{ github.sha }}
            ${{ steps.ecr-login.outputs.registry }}/myapp:latest
          cache-from: type=gha               # Pull cached layers from GitHub Actions cache
          cache-to: type=gha,mode=max        # Push all layers back (max = cache intermediate layers too)

      - name: Scan image for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ steps.ecr-login.outputs.registry }}/myapp:${{ github.sha }}
          exit-code: 1               # Non-zero exit blocks the pipeline
          severity: HIGH,CRITICAL
          format: table

  # ─── CD PHASE: runs only on push to main, never on PR ───────────────

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: staging             # Ties to a GitHub Environment (enables protection rules and secrets scoping)

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-cd
          aws-region: ap-southeast-1

      - name: Deploy to staging
        run: |
          helm upgrade --install myapp ./charts/myapp \
            --set image.tag=${{ github.sha }} \
            --values charts/myapp/values-staging.yaml \
            --namespace staging \
            --wait --timeout 5m      # Block until all pods report ready; fail if timeout exceeded

      - name: Smoke test staging
        run: |
          curl --fail --retry 5 --retry-delay 10 \
            https://staging.myapp.example.com/health

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: production          # Requires manual approval configured in GitHub repo settings

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-cd-prod
          aws-region: ap-southeast-1

      - name: Deploy to production
        run: |
          helm upgrade --install myapp ./charts/myapp \
            --set image.tag=${{ github.sha }} \
            --values charts/myapp/values-prod.yaml \
            --namespace production \
            --wait --timeout 5m \
            --atomic                 # On failure: automatically rolls back to the previous Helm release revision

      - name: Post-deploy verification
        run: |
          curl --fail --retry 5 --retry-delay 10 \
            https://myapp.example.com/health
```

---

## 5. Deployment Strategy

### Staging-First Rollout

The pipeline enforces a mandatory staging gate before production. `deploy-prod` has `needs: deploy-staging`, which means if staging deployment fails or the smoke test returns a non-200, the production job is never triggered — regardless of the `environment` approval status.

This two-environment model catches a class of bugs that CI cannot: configuration drift between environments, secrets that exist in staging but not prod, infrastructure differences (instance types, VPC peering, IAM boundaries), and latent issues that only surface under real traffic patterns.

### Smoke Tests

The smoke test after each deployment is intentionally minimal: a single `curl` to `/health` with retries. The goal is not functional test coverage — that is CI's job — but proof that the new pods are reachable, the service is listening, and the health endpoint returns 200. A smoke test that does too much becomes a slow integration test that blocks deploys unnecessarily.

Smoke test design principles:
- Test the deployed environment, not the CI environment
- Retry with backoff to allow for pod startup time
- Fail fast with `--fail` so the pipeline gets a non-zero exit code immediately
- Keep it under 30 seconds total

### Production Approval Gate

Setting `environment: production` in the job configuration ties the job to a GitHub Environment. In the repository settings under **Environments → production**, you can configure required reviewers — GitHub users or teams who must manually approve before the job proceeds. The runner sits idle and waits for approval (up to 30 days by default).

This approval step is the human control point in an otherwise automated pipeline. It gives the oncall engineer or team lead the opportunity to check monitoring, confirm the staging smoke test metrics, and decide whether the timing is appropriate before production traffic is affected.

### Helm Atomic Deploys

The `--atomic` flag on the production Helm deploy configures automatic rollback. If the rollout fails — pods crash-loop, readiness probes time out, or the `--wait` timeout is exceeded — Helm automatically rolls back to the previous release revision. This happens without any additional pipeline logic or human intervention.

`--atomic` implies `--wait`. The distinction between `--wait` (staging) and `--atomic` (production) is intentional: in staging, failure should fail the pipeline loudly so engineers investigate; in production, failure should fail the pipeline loudly *and* immediately restore the previous working state.

---

## 6. Performance Optimizations

### Dependency Caching

`actions/setup-node` with `cache: 'npm'` stores `node_modules` in the GitHub Actions cache keyed on the hash of `package-lock.json`. On subsequent runs with no lockfile changes, `npm ci` skips the network download and restores from cache. For a project with 500 dependencies, this reduces install time from 60–90 seconds to under 5 seconds.

The same caching pattern applies for other ecosystems: `cache: 'pip'` for Python, `cache: 'maven'` for Java, `cache: 'gradle'` for Android.

### Docker Layer Caching

Docker builds are incremental — unchanged layers are reused from the cache. Without explicit cache configuration in GitHub Actions, each runner starts with an empty Docker cache because runners are ephemeral. The `cache-from: type=gha` and `cache-to: type=gha,mode=max` flags persist Docker's layer cache in the GitHub Actions cache store between runs.

`mode=max` caches all intermediate layers, not just the final image layers. This is more cache storage but results in better cache hits when Dockerfile instructions change in the middle of the file.

Cache hit impact: a typical Node.js application build that takes 4–6 minutes cold can be reduced to 45–90 seconds on a warm cache when only application code changes and `node_modules` layers are reused.

### Concurrency Cancellation

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

On a PR with active development, developers frequently push commits in rapid succession. Without concurrency management, each push queues a new run while the previous one is still in progress. For a 15-minute pipeline, a developer who pushes three commits in two minutes could have three queued runs consuming six runner-hours and returning results that are stale by the time they complete.

Concurrency cancellation keeps only the most recent run active for a given branch, cancelling any in-progress older run. The group key `${{ github.workflow }}-${{ github.ref }}` scopes cancellation per branch — a push to `feature/x` does not cancel a run on `feature/y`.

One caveat: for the `main` branch, `cancel-in-progress: true` should be evaluated carefully. Cancelling a deploy midway through is worse than letting it complete. Consider using a separate concurrency group or setting `cancel-in-progress: false` for production deployments.

---

## 7. Operational Rules & Common Failures

| Failure Mode | Symptom | Root Cause | Prevention |
| :--- | :--- | :--- | :--- |
| Static AWS keys committed or stored in secrets | Credential leak; prolonged blast radius after detection | Long-lived key anti-pattern | Migrate to OIDC; keys should not exist |
| `npm install` used instead of `npm ci` | Intermittent test failures; lockfile drift | `npm install` updates `package-lock.json`; `npm ci` does not | Enforce `npm ci` in all CI steps; lint the workflow file |
| Image pushed on PR | Registry fills with unmerged branch images; ECR costs inflate | Missing `push: ${{ github.event_name == 'push' }}` guard | Always gate push behind the merge trigger check |
| Trivy scan runs before image is pushed | Scan targets a non-existent image tag | Step ordering error in the `build` job | Scan step must follow the push step in sequence |
| `--atomic` absent from production Helm deploy | Failed deploy leaves broken pods in production; no automatic recovery | Omitted flag or copied from staging values | Enforce `--atomic` in production deploy scripts via policy or template |
| Smoke test too broad | Slow pipeline; smoke test failures unrelated to the deploy | Smoke test evolved into an integration test | Keep smoke tests to a single `/health` check with retries; functional coverage belongs in CI |
| Production approval never expires | Stale approval window; approved run deploys hours-old code | Default 30-day expiry is too long for fast-moving teams | Set `timeout-minutes` on the deploy job; reduce environment wait timer in GitHub settings |
| Concurrency cancels a mid-deploy run on main | Partial deploy; cluster in unknown state | `cancel-in-progress: true` applied globally including main | Use separate concurrency group for CD jobs or set `cancel-in-progress: false` on main |
| `paths-ignore` too broad | Security fix to a `.md` changelog file skips the pipeline | Overly aggressive path exclusion | Limit `paths-ignore` to pure documentation paths; never exclude `CHANGELOG.md` if it contains release metadata |