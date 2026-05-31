# CI/CD Interview Preparation

### Q: What are some popular CI/CD tools you've worked with?

<details>
<summary>Show Answer</summary>

The honest answer here isn't a laundry list — it's a brief map of the landscape and where each tool fits, followed by what you've actually used in production.

**Tool landscape:**

| Tool | Model | Strengths | Typical Use Case |
| :--- | :--- | :--- | :--- |
| **GitHub Actions** | SaaS, native to GitHub | Tight VCS integration, marketplace ecosystem, OIDC to cloud | Greenfield projects, open-source, teams already on GitHub |
| **GitLab CI** | SaaS or self-hosted | Built-in container registry, security scanning, environments | Enterprises wanting all-in-one DevSecOps |
| **Jenkins** | Self-hosted | Maximum flexibility, plugin ecosystem, mature | Legacy orgs, complex custom pipelines |
| **CircleCI** | SaaS | Fast orbs (reusable config), parallelism | Startup/scale-up, build-speed-focused teams |
| **ArgoCD** | Kubernetes-native | GitOps pull model, drift detection, rollback UI | Kubernetes-heavy CD layer |
| **Tekton** | Kubernetes-native | Cloud-native pipelines as CRDs | Platform teams building internal CI platforms |
| **AWS CodePipeline** | Managed AWS | Native integration with CodeBuild, ECR, ECS, Lambda | AWS-only shops preferring managed services |
| **Atlantis** | Self-hosted | Terraform-specific, PR-driven plan/apply | IaC-focused pipelines |

**Key differentiators to discuss:**
- **Hosted vs. self-hosted:** GitHub Actions and CircleCI remove ops burden; Jenkins gives full control but requires maintenance.
- **Pull vs. push CD:** ArgoCD/Flux pull from Git; Jenkins/Actions push to target — pull model is more secure for Kubernetes.
- **IaC pipelines:** Tools like Atlantis are specialized for Terraform workflows and shouldn't be conflated with general CI tools.

> **What interviewers really want:** Not a list, but evidence you understand trade-offs. Say which tool you'd choose for what scenario and why.

</details>

---

### Q: Which is your preferred CI/CD tool?

<details>
<summary>Show Answer</summary>

This is an opinion question, but the strong answer demonstrates *reasoned preference with context*, not brand loyalty.

**A strong framing:**

> "For application CI/CD in teams already on GitHub, I default to **GitHub Actions** — the zero-infrastructure overhead, native OIDC to AWS/GCP, and reusable workflows cover 80% of use cases without managing a server. For Kubernetes CD specifically, I pair it with **ArgoCD** — the pull-based GitOps model means the cluster reconciles itself against Git, and you get drift detection and rollback for free. For IaC pipelines managing Terraform, **Atlantis** or a purpose-built GitHub Actions workflow with manual approval gates works well."

**Why GitHub Actions + ArgoCD is a defensible default:**

```
Code change → GitHub PR
      ↓
GitHub Actions (CI): lint → test → build image → push to ECR
      ↓
ArgoCD (CD): detects new image tag in Git → reconciles cluster
      ↓
Production
```

- CI stays in the VCS layer (Actions), CD stays in the cluster layer (ArgoCD).
- No credentials leave GitHub — OIDC tokens authenticate to AWS at runtime.
- ArgoCD's UI gives ops teams visibility without needing `kubectl` access.

**When to choose something else:**
- Heavy AWS-native shop with no Kubernetes → **CodePipeline + CodeBuild** reduces cross-service complexity.
- Large enterprise with on-prem restrictions → **GitLab CI self-hosted** or **Jenkins** with shared library conventions.
- Terraform-heavy platform team → **Atlantis** for plan-on-PR, apply-on-merge workflow.

> **Gotcha:** Don't say "Jenkins" unless you can explain why the operational overhead is worth it in your context. Most interviewers at cloud-native companies view Jenkins as a legacy burden unless there's a specific justification.

</details>

---

### Q: How do you trigger pipelines on code changes?

<details>
<summary>Show Answer</summary>

Pipeline triggers define *when* automation runs. A mature trigger strategy balances speed (run often) with cost (don't run unnecessarily) and safety (gate the right things).

**Trigger types:**

| Trigger | Mechanism | Use Case |
| :--- | :--- | :--- |
| **Push to branch** | `on: push` / webhook | Run CI on every commit; catch breakage early |
| **Pull request** | `on: pull_request` | Validate before merge; block bad code from main |
| **Tag push** | `on: push: tags` | Trigger release pipeline on semver tag |
| **Merge to main** | `on: push: branches: [main]` | Deploy to staging on merge |
| **Schedule (cron)** | `on: schedule` | Nightly security scans, drift detection, dependency audits |
| **Manual dispatch** | `on: workflow_dispatch` | Production deploys requiring human approval |
| **Repository dispatch** | API trigger | Cross-repo triggers (e.g., module updated → consumer pipeline re-runs) |
| **Path filters** | `paths:` filter on push | Monorepo: only trigger service A's pipeline when `services/a/**` changes |

**GitHub Actions example with path filtering (monorepo):**

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'services/payments/**'
      - 'shared/libs/**'
  pull_request:
    paths:
      - 'services/payments/**'
```

**Branch strategy alignment:**

- **Feature branches:** CI only (lint, test, build). No deploy.
- **`main` / `develop`:** CI + deploy to dev/staging automatically.
- **Tags (`v*`):** Full release pipeline — build, push image, deploy to prod with approval gate.
- **`release/*`:** Optional: hotfix pipelines with narrower scope.

**Concurrency control:** Prevent redundant runs when commits arrive faster than pipelines complete:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true  # Cancel older run when new commit arrives on same branch
```

> **Gotcha:** Without path filters in a monorepo, every commit triggers every service's pipeline — this kills runner minutes and creates noise. Path-based triggers are essential at scale, but they require careful mapping of shared library changes to downstream consumers.

</details>

---

### Q: How do you integrate unit tests, integration tests, and linting in CI?

<details>
<summary>Show Answer</summary>

The principle is **fast feedback first** — fail the pipeline as early and cheaply as possible. Structure jobs so the cheapest checks run first and gate the expensive ones.

**Pipeline stage ordering:**

```
Lint → Unit Tests → Build → Integration Tests → E2E Tests (optional)
 ↑          ↑         ↑            ↑
Fast      Fast     Medium        Slow
Cheap     Cheap    Moderate    Expensive
```

**GitHub Actions multi-job example:**

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install flake8 && flake8 src/

  unit-test:
    needs: lint          # Only runs if lint passes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pytest tests/unit/ --cov=src --cov-report=xml
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage.xml

  build:
    needs: unit-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myapp:${{ github.sha }} .

  integration-test:
    needs: build
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - run: pytest tests/integration/
```

**Key practices:**

- **Linting is a hard gate** — formatting/style failures must block merge. Use `--check` mode so linters exit non-zero on violations.
- **Coverage thresholds:** Set a minimum coverage floor (e.g., 80%) and fail the build if it drops. Upload coverage to Codecov or SonarCloud for trend tracking.
- **Matrix builds:** Test across multiple runtime versions in parallel:
  ```yaml
  strategy:
    matrix:
      python-version: ["3.10", "3.11", "3.12"]
  ```
- **Integration tests use real dependencies** — spin up databases, caches, or message queues as service containers, not mocks. This catches real integration failures that unit tests miss.
- **Artifact passing:** Share build artifacts (Docker image, compiled binary) between jobs using `upload-artifact`/`download-artifact` or a registry — don't rebuild in every job.

> **Gotcha:** Running integration tests on every PR against a shared staging database creates flaky tests from data collisions between concurrent runs. Use ephemeral service containers per job (GitHub Actions `services:` block) or a dedicated test database with per-run schema isolation.

</details>

---

### Q: How do you manage pipelines across different environments (dev/stage/prod)?

<details>
<summary>Show Answer</summary>

Environment pipeline management is about **progressive promotion with increasing gates**. Code flows through environments; the gates between them get stricter as you approach production.

**Promotion model:**

```
PR merge → dev (auto)
         → staging (auto, after dev passes)
         → prod (manual approval required)
```

**GitHub Actions environments:**

```yaml
jobs:
  deploy-staging:
    environment: staging          # Maps to a GitHub Environment
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh staging

  deploy-prod:
    needs: deploy-staging
    environment:
      name: production
      url: https://app.example.com
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh production
```

GitHub Environments support **required reviewers**, **wait timers**, and **environment secrets** — prod credentials never exist in the staging context.

**Per-environment configuration strategy:**

| Concern | Approach |
| :--- | :--- |
| **Secrets** | Environment-scoped secrets in CI tool (never in code) |
| **Config values** | Environment-specific var files or Parameter Store paths (`/app/prod/db_host`) |
| **IAM roles** | Separate OIDC role per environment; prod role has `deny` on destructive actions except via pipeline |
| **Approval gates** | Dev: none. Staging: none. Prod: 1–2 required approvers |
| **Deployment frequency** | Dev: every commit. Staging: every merge. Prod: batched or on-demand |

**Preventing cross-environment contamination:**
- Prod pipeline runs in a **separate AWS account** with its own OIDC trust — staging credentials cannot reach prod even if a workflow is misconfigured.
- Use **separate runner pools or labels** for prod if runners are self-hosted, to isolate the execution environment.
- Enforce environment protection rules so `production` jobs only trigger from `main` branch, never from a feature branch.

> **Gotcha:** Sharing secrets across environments via a single CI variable (e.g., `AWS_ACCESS_KEY_ID` that happens to have prod permissions) is a common mistake. Scope secrets to the environment that needs them — a staging deploy job should be physically incapable of reaching prod resources.

</details>

---

### Q: Describe a CI/CD pipeline you've implemented from scratch.

<details>
<summary>Show Answer</summary>

This is a behavioral question — the interviewer wants to hear your reasoning, trade-offs, and ownership, not just a list of tools. Structure your answer around the problem, decisions, and outcome.

**Strong answer structure (STAR-lite):**

**Context:** A containerized microservice (Python/FastAPI) deployed to AWS ECS Fargate, previously deployed manually by engineers SSH-ing into a bastion. Build times were unpredictable and prod incidents from bad deployments were frequent.

**What I built:**

```
PR opened
  └─ GitHub Actions: lint (flake8) + unit tests (pytest) + SAST (bandit)
  └─ Terraform plan (Atlantis) if infra files changed

Merge to main
  └─ GitHub Actions CI:
       build Docker image → push to ECR (tagged with git SHA)
  └─ GitHub Actions CD:
       update ECS task definition with new image tag
       deploy to ECS staging (rolling update)
       run smoke tests against staging ALB
       if smoke tests pass → gate on manual approval
       deploy to ECS prod (blue/green via CodeDeploy)

Tag push (v*)
  └─ Release pipeline: generate changelog, create GitHub Release
```

**Key decisions and why:**

- **OIDC over static keys** — no long-lived AWS credentials stored in GitHub. The GitHub Actions runner exchanges a short-lived JWT for temporary AWS credentials via STS at runtime.
- **Image tagged with git SHA** — fully traceable. Any running container can be mapped back to an exact commit.
- **Blue/green for prod** — ECS + CodeDeploy shifts traffic at the ALB listener level with an automatic rollback if health checks fail post-deploy.
- **Smoke tests as a gate** — a simple `curl` against the `/health` endpoint of the staging ECS service. Cheap to run, catches 80% of deployment failures before they reach prod.
- **Separate workflows for CI and CD** — CI workflow runs on every PR; CD workflow runs only on `main` pushes. Keeps concerns separated and makes debugging easier.

**Outcome:** Deploy time went from 45 minutes (manual) to 8 minutes (automated). Zero deployment-related incidents in the 6 months post-implementation.

> **Gotcha:** Interviewers notice when candidates describe a pipeline that works perfectly with no trade-offs. Mention a real problem you hit — e.g., flaky integration tests causing false failures, or a slow Docker build you fixed with layer caching — to demonstrate genuine ownership.

</details>

---

### Q: How do you handle blue/green or canary deployments with minimal user impact?

<details>
<summary>Show Answer</summary>

Blue/green and canary are both traffic-shifting strategies, but they solve different problems. Knowing when to use each — and how to implement them — is what separates a senior answer from a junior one.

**Blue/Green:**

Two identical environments exist simultaneously. Traffic switches 100% from old (blue) to new (green) at the load balancer level. Rollback = switch back.

```
ALB Listener
   ├─ Blue target group  (v1.0, currently live)   ← 100% traffic
   └─ Green target group (v1.1, new version)      ← 0% traffic (warming up)

After health checks pass:
   ├─ Blue target group  (v1.0)                   ← 0% traffic
   └─ Green target group (v1.1)                   ← 100% traffic
```

**AWS implementation:**
- **ECS + CodeDeploy:** Native blue/green support — CodeDeploy manages the listener rule swap and holds the old task set for a configurable bake time before termination.
- **Kubernetes:** Two `Deployment` objects + `Service` selector swap, or managed via Argo Rollouts.

**Canary:**

Route a small percentage of traffic to the new version, then gradually increase while monitoring error rates and latency.

```
100% → v1.0
 ↓  shift 5% to v1.1, monitor for 10 minutes
 ↓  shift 25% to v1.1, monitor
 ↓  shift 100% to v1.1, decommission v1.0
```

**Implementation options:**

| Platform | Canary Mechanism |
| :--- | :--- |
| **ALB weighted target groups** | Two target groups, weighted routing rules (5%/95%) |
| **Argo Rollouts** | `canarySteps` with pause + analysis steps (automated rollback on metric breach) |
| **AWS App Mesh / Istio** | Traffic weight via VirtualService — fine-grained header-based routing |
| **Lambda** | Weighted alias (`live` alias: 95% → v3, 5% → v4) |
| **CloudFront** | Continuous deployment policies (built-in canary at CDN level) |

**Automated rollback trigger (Argo Rollouts example):**

```yaml
analysis:
  templates:
    - templateName: error-rate
  args:
    - name: service-name
      value: payments-service
  # Automatically abort canary if error rate > 1% for 5 minutes
```

**Key considerations:**
- Canary requires **observability** — you need metrics (error rate, p99 latency) per version to know when to proceed or roll back.
- Blue/green requires **double the compute** during the transition window — factor into cost.
- **Database migrations** are the hard problem for both strategies — schema changes must be backward-compatible with both versions running simultaneously.

> **Gotcha:** Blue/green doesn't work well if your deployment has in-flight stateful sessions (WebSockets, long-polling) — users on the blue side get dropped on switch. Solve this with sticky sessions during the bake window, or drain connections before switching.

</details>

---

### Q: Describe a robust rollback strategy in case a deployment goes wrong.

<details>
<summary>Show Answer</summary>

A robust rollback strategy is **defined before the deployment, not improvised during an incident**. The goal is to minimize MTTR (mean time to recovery) with predictable, rehearsed steps.

**Rollback by layer:**

| Layer | Rollback Mechanism | Speed |
| :--- | :--- | :--- |
| **Container (ECS/K8s)** | Re-deploy previous image tag | Fast (seconds–minutes) |
| **Lambda** | Shift alias weight back to previous version | Seconds |
| **Infrastructure (Terraform)** | Revert code + re-apply, or restore state backup | Minutes |
| **Database schema** | Pre-applied migration rollback script | Variable |
| **Feature flag** | Toggle flag off in LaunchDarkly/Flagsmith | Seconds |

**Container rollback (ECS):**

```bash
# Find previous task definition revision
aws ecs describe-task-definition --task-definition myapp --query 'taskDefinition.revision'

# Roll back to previous revision
aws ecs update-service \
  --cluster prod \
  --service myapp \
  --task-definition myapp:41   # previous stable revision
```

**Kubernetes rollback:**

```bash
kubectl rollout undo deployment/myapp
kubectl rollout undo deployment/myapp --to-revision=3  # specific revision
kubectl rollout status deployment/myapp                # confirm
```

**What makes a strategy "robust":**

1. **Automated rollback triggers** — don't rely on humans to notice a bad deploy. CodeDeploy, Argo Rollouts, and ECS Circuit Breaker can detect failed health checks and roll back automatically.
2. **Immutable artifacts** — every build produces a uniquely tagged image (git SHA). Rolling back means re-deploying a known-good tag, not rebuilding.
3. **Rehearsed, not theoretical** — rollback procedures that have never been tested fail during incidents. Run rollback drills in staging.
4. **Database migration strategy** — rollback is blocked if a migration was applied that the old code can't run against. The solution is **expand-contract migrations**: add columns before removing old ones, never drop columns in the same release that removes code references.
5. **Feature flags as a fast path** — deploy code behind a flag; rollback = flip the flag, no re-deploy needed.

**ECS Circuit Breaker (automatic rollback):**

```hcl
deployment_circuit_breaker {
  enable   = true
  rollback = true  # ECS rolls back automatically if new tasks fail to stabilize
}
```

> **Gotcha:** `git revert` and `kubectl rollout undo` roll back the application. They do not roll back database changes. If a migration dropped a column and you roll back the app, the old code trying to write that column will immediately start throwing errors. Always separate schema migrations from application deployments and plan for backward compatibility.

</details>

---

### Q: What strategies do you use to secure CI/CD pipelines, particularly secrets management?

<details>
<summary>Show Answer</summary>

CI/CD pipelines are high-value attack targets — they have credentials for every environment, access to source code, and can push to production. Security failures here are catastrophic.

**Threat model for a CI/CD pipeline:**

- **Secret exfiltration** — a compromised third-party Action exfiltrates `AWS_SECRET_ACCESS_KEY` via an outbound HTTP call.
- **Supply chain attack** — a pinned action is compromised after tagging; `uses: some-action@v2` now runs malicious code.
- **Privilege escalation** — a developer's PR pipeline has the same AWS role as the production deploy pipeline.
- **Pipeline injection** — user-controlled input (PR title, branch name) injected into a `run:` step via `${{ github.event.pull_request.title }}`.

**Secrets management:**

| Approach | Use Case | Risk |
| :--- | :--- | :--- |
| **OIDC (keyless auth)** | AWS, GCP, Azure from GitHub Actions | Best — no static credentials |
| **CI-native secrets** | API tokens, registry passwords | Good — encrypted at rest, masked in logs |
| **HashiCorp Vault** | Dynamic credentials, short-lived secrets | Best for self-hosted or complex rotation needs |
| **AWS Secrets Manager** | App secrets fetched at deploy time | Good — but value lands in env var |

**OIDC to AWS (no static keys):**

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsDeployRole
      aws-region: ap-southeast-1
```

The runner never holds a static `AWS_ACCESS_KEY_ID`. The JWT is exchanged for temporary STS credentials scoped to the role.

**Supply chain hardening:**

```yaml
# Pin third-party actions to full commit SHA, not a mutable tag
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
```

A mutable tag (`@v4`) can be silently updated to point to malicious code. A SHA pin is immutable.

**Principle of least privilege for pipeline roles:**

- **PR/CI role:** Read-only — can pull from ECR, read SSM parameters. Cannot deploy.
- **Staging deploy role:** Can update ECS services in staging account only.
- **Prod deploy role:** Can update ECS services in prod account. Requires the workflow to run from `main` branch — enforced via IAM condition on the OIDC trust policy:

```json
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:sub": "repo:org/myapp:ref:refs/heads/main"
  }
}
```

**Additional controls:**
- `CODEOWNERS` file to require senior review on workflow file changes (`.github/workflows/`).
- Secret scanning (GitHub Advanced Security or `truffleHog`) on every PR.
- Restrict `workflow_dispatch` to protected branches only.
- Audit runner logs for unexpected outbound network calls.

> **Gotcha:** `${{ env.MY_SECRET }}` is masked in logs, but `${{ toJSON(env) }}` or `echo $MY_SECRET` will print it. Prefer passing secrets directly to the step that needs them rather than setting them as environment variables on the entire job.

</details>

---

### Q: How do you automate compliance and security checks in your deployment process?

<details>
<summary>Show Answer</summary>

Compliance automation shifts security left — problems are caught in the pipeline before they reach production, not during an audit after the fact.

**Layers of automated compliance:**

```
Code commit
  └─ SAST (Static Application Security Testing): code vulnerabilities
  └─ Secret scanning: credentials in code
  └─ Dependency scanning: vulnerable libraries (SCA)
  └─ License scanning: GPL in a commercial codebase

Docker image build
  └─ Container image scanning: CVEs in base image and packages (Trivy, ECR scanning)
  └─ Dockerfile linting (Hadolint): best practice violations

Infrastructure (IaC)
  └─ Checkov / tfsec: misconfigurations (public S3, open security groups)
  └─ Terraform plan policy enforcement (OPA / Sentinel)

Pre-deploy
  └─ CIS benchmark checks
  └─ Compliance-as-code (InSpec, Chef Compliance)
```

**GitHub Actions integration example:**

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ${{ env.ECR_REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
    format: sarif
    output: trivy-results.sarif
    severity: CRITICAL,HIGH
    exit-code: '1'   # Fail the pipeline on CRITICAL/HIGH CVEs

- name: Upload scan results to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

**IaC policy enforcement (OPA example):**

```rego
# deny S3 buckets with public ACL
deny[msg] {
  resource := input.planned_values.root_module.resources[_]
  resource.type == "aws_s3_bucket_acl"
  resource.values.acl == "public-read"
  msg := sprintf("S3 bucket '%v' must not have a public ACL", [resource.name])
}
```

**Audit trail for compliance:**
- Every pipeline run is logged — who triggered it, what changed, what tests passed, what image was deployed.
- Store scan results as pipeline artifacts (SARIF, JUnit XML) for audit evidence.
- Enforce **signed commits** (`git commit -S`) and **signed images** (Cosign/Notary) to provide an unbroken chain of custody from developer to production.

**Compliance frameworks mapped to automation:**

| Framework | Automated Controls |
| :--- | :--- |
| **SOC 2** | Change approval workflows, audit logs, access reviews |
| **PCI-DSS** | No credentials in code, image scanning, network policy enforcement |
| **CIS Benchmarks** | InSpec profiles run against deployed AMIs/containers |
| **DORA** | Deployment frequency and MTTR tracked via pipeline metadata |

> **Gotcha:** Blocking on every CRITICAL CVE sounds correct but causes pipeline failures from base image vulnerabilities that have no fix yet (unpatched upstream). Use a tiered approach: `CRITICAL` with available fix = blocking; `CRITICAL` with no fix = non-blocking + alert; `HIGH` = non-blocking. Tune thresholds over time as you reduce baseline noise.

</details>

---

### Q: Your pipeline is slow — how would you debug and speed it up?

<details>
<summary>Show Answer</summary>

Pipeline performance is a real operational concern — slow pipelines delay feedback, frustrate developers, and indicate deeper architectural issues. Debugging it is systematic, not guesswork.

**Step 1: Measure before optimizing**

Pull the timing data. In GitHub Actions, every step shows wall-clock time in the UI. For structured analysis:

```bash
# GitHub CLI: list recent workflow run timings
gh run list --workflow=ci.yml --json databaseId,conclusion,createdAt,updatedAt
```

Identify: Which job is slowest? Which step within that job? Is it consistently slow or flaky-slow?

**Common culprits and fixes:**

| Root Cause | Symptom | Fix |
| :--- | :--- | :--- |
| **No dependency caching** | `npm install` / `pip install` takes 3–5 min every run | Cache `node_modules` or `~/.cache/pip` with `actions/cache` |
| **No Docker layer caching** | Full image rebuild on every run | Use `cache-from: type=gha` with BuildKit |
| **Sequential jobs** | Jobs that could run in parallel run one-by-one | Restructure as parallel jobs with `needs:` only where order matters |
| **Slow tests** | Test suite takes 20+ minutes | Shard tests across parallel runners; split unit/integration |
| **Oversized runner** | Large job runs on a small runner | Use larger runner for compute-heavy steps |
| **Pulling large base image** | Docker pull takes 2–3 minutes | Pin to a minimal base (`alpine`, `distroless`); use ECR pull-through cache |
| **Redundant work** | Re-running static analysis on unchanged files | Path filters to skip pipelines when unrelated files change |

**Dependency caching (GitHub Actions):**

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements.txt') }}
    restore-keys: |
      ${{ runner.os }}-pip-

- run: pip install -r requirements.txt
```

**Docker BuildKit layer caching:**

```yaml
- uses: docker/build-push-action@v5
  with:
    context: .
    cache-from: type=gha
    cache-to: type=gha,mode=max
    tags: ${{ env.IMAGE_TAG }}
```

**Test parallelism (pytest):**

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]

steps:
  - run: pytest tests/ --shard-id=${{ matrix.shard }} --num-shards=4
```

**Step 2: Restructure job graph**

```
Before (sequential, 18 min total):
lint → unit-test → build → integration-test

After (parallel where possible, 10 min total):
lint ──┐
       ├─ build → integration-test
unit ──┘
```

**Step 3: Targeted triggers**

Stop running the full pipeline on every commit to every file:

```yaml
on:
  push:
    paths:
      - 'src/**'
      - 'tests/**'
      - 'requirements.txt'
# Docs changes, README updates → no pipeline
```

> **Gotcha:** Cache invalidation bugs are subtle — a cache key that never changes means stale dependencies silently accumulate. Always include a lockfile hash in your cache key (`hashFiles('**/package-lock.json')`) so the cache busts when dependencies change.

</details>

---

### Q: Your deployment failed in production — how do you respond?

<details>
<summary>Show Answer</summary>

A deployment failure in production is an incident. The response has two modes running in parallel: **mitigate first, investigate second**. This is the most important distinction a senior engineer makes under pressure.

**Response playbook:**

**Phase 1 — Contain (first 5 minutes)**

1. **Declare the incident** — notify the team immediately. Don't silently try to fix it first. Loop in on-call.
2. **Assess blast radius** — is it total outage or degraded? What percentage of users are affected? Are errors increasing or stable?
3. **Stop the bleeding — roll back** — don't wait to understand the root cause. Rollback now, investigate later.

```bash
# ECS: force re-deploy of previous task definition revision
aws ecs update-service --cluster prod --service myapp --task-definition myapp:41

# Kubernetes: roll back deployment
kubectl rollout undo deployment/myapp

# Feature flag: turn off the offending feature in LaunchDarkly/Flagsmith
```

4. **Verify rollback worked** — check health endpoints, error rates in CloudWatch/Datadog. Confirm user impact is resolved.

**Phase 2 — Investigate (after rollback)**

- Pull deployment logs from the CI/CD pipeline — what changed, what was the diff?
- Check application logs around the deployment timestamp — first errors, first exceptions.
- Check infrastructure metrics — CPU, memory, connection pool exhaustion?
- Was there a database migration? Did the old schema work with the new code?
- Was there a dependency update that changed behavior?

**Phase 3 — Communicate**

- Update the incident channel with status every 10–15 minutes, even if "still investigating."
- Once resolved, send a brief summary to stakeholders: what happened, impact duration, current status.

**Phase 4 — Post-mortem**

Within 24–48 hours:
- Write a blameless post-mortem — timeline, root cause, impact, contributing factors.
- Define action items with owners and due dates — not vague "improve monitoring" but "add alarm on 5xx rate > 1% for 5 min."
- Feed findings back into the pipeline: add the test that would have caught this, tighten the smoke test gate, add a canary step.

**What strong candidates say differently:**

> "My first instinct is rollback, not debug in production. We keep artifacts immutable and tagged, so rollback is always available. I treat a failed deployment as an incident from the first minute — loop in the team, communicate status, restore service first."

> **Gotcha:** Trying to "quick fix" a broken deployment forward — pushing a patch to fix the patch — usually makes things worse. The error is compounding, the root cause is still unknown, and the team is flying blind. Rollback is almost always faster and safer than a hotfix under pressure.

</details>

---

### Q: Have you used GitOps? How does it relate to CI/CD?

<details>
<summary>Show Answer</summary>

GitOps is a **deployment model**, not a tool. It extends CI/CD by making Git the single source of truth for the *desired state* of infrastructure and applications — and using a reconciliation loop to enforce it continuously.

**CI/CD vs. GitOps:**

| Dimension | Traditional CI/CD (Push) | GitOps (Pull) |
| :--- | :--- | :--- |
| **Deployment trigger** | Pipeline pushes to target (kubectl apply, aws ecs update-service) | Agent in cluster pulls from Git and self-reconciles |
| **Credentials** | Pipeline holds cloud/cluster credentials | Cluster agent has outbound Git access only; no inbound access needed |
| **Desired state** | Implicit — last pipeline run | Explicit — Git repo is the source of truth |
| **Drift detection** | Not built in | Continuous — agent detects and alerts/corrects drift |
| **Rollback** | Re-run pipeline with old tag | `git revert` the commit; reconciler applies it |
| **Audit trail** | Pipeline logs | Git commit history |

**How CI and GitOps fit together:**

```
Developer pushes code
      ↓
CI pipeline (GitHub Actions):
  lint → test → build image → push to ECR/GCR (tagged with SHA)
  ↓
CI updates the GitOps repo (image tag in Helm values / Kustomize overlay):
  git commit "chore: update payments-service to sha-abc123"
      ↓
GitOps agent (ArgoCD / Flux) detects change in GitOps repo
      ↓
Agent reconciles cluster → deploys new image → cluster matches Git
```

CI is responsible for **producing the artifact**. GitOps is responsible for **deploying it**. They're complementary, not competing.

**ArgoCD Application example:**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payments-service
spec:
  source:
    repoURL: https://github.com/org/gitops-config
    targetRevision: main
    path: apps/payments-service/overlays/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: payments
  syncPolicy:
    automated:
      prune: true       # Remove resources deleted from Git
      selfHeal: true    # Revert manual kubectl changes
```

**Key benefits in practice:**
- **No cluster credentials in CI** — a major security improvement. The cluster pulls from Git; nothing pushes into it from outside.
- **Self-healing** — if someone runs `kubectl edit deployment myapp` in prod, ArgoCD detects drift and reverts it within seconds.
- **Multi-cluster promotion** — the same Git-based flow promotes across dev → staging → prod clusters by merging changes into the appropriate branch or overlay directory.

> **Gotcha:** GitOps doesn't solve secret management — you still can't put secrets in Git. Use **Sealed Secrets**, **External Secrets Operator** (pulling from AWS Secrets Manager/Vault), or **SOPS** to encrypt secrets before committing. The GitOps repo should be safe to read without exposing credentials.

</details>

---

### Q: How do you implement observability in the CI/CD pipeline (e.g., pipeline metrics, failure alerts)?

<details>
<summary>Show Answer</summary>

Most teams have observability on their *applications* but not on the pipeline itself. A mature platform treats the CI/CD pipeline as a production system and monitors it accordingly.

**What to observe:**

| Signal | Metric | Why It Matters |
| :--- | :--- | :--- |
| **Pipeline duration** | p50/p95 of total run time per workflow | Trending upward = something regressed |
| **Success rate** | Failed runs / total runs per branch | High failure rate on `main` = broken baseline |
| **MTTR (pipeline)** | Time from failure to next successful run | Measures how quickly teams fix broken builds |
| **Queue wait time** | Time spent waiting for a runner | Runner capacity issue |
| **Step-level timing** | Duration per job/step | Pinpoints where slowness lives |
| **Flaky test rate** | Tests that fail/pass non-deterministically | Erodes trust in CI; masks real failures |
| **Deployment frequency** | Deploys per day/week per service | DORA metric — leading indicator of team health |
| **Change failure rate** | % of deploys that cause an incident | DORA metric — quality signal |

**Implementation approaches:**

**GitHub Actions → Datadog (via webhook or action):**

```yaml
- name: Send pipeline metrics to Datadog
  if: always()   # Run even on failure
  uses: masci/datadog@v1
  with:
    api-key: ${{ secrets.DATADOG_API_KEY }}
    metrics: |
      - type: "gauge"
        name: "ci.pipeline.duration_seconds"
        value: ${{ steps.timer.outputs.duration }}
        tags:
          - "workflow:${{ github.workflow }}"
          - "branch:${{ github.ref_name }}"
          - "status:${{ job.status }}"
```

**OpenTelemetry for pipelines (otel-cli):**

```bash
# Wrap pipeline steps in OTEL spans
otel-cli exec \
  --service "ci-pipeline" \
  --name "unit-tests" \
  -- pytest tests/unit/
```

Sends traces to any OTLP-compatible backend (Jaeger, Honeycomb, Grafana Tempo). You get a waterfall view of every pipeline step as a trace.

**Failure alerting:**

```yaml
# Notify Slack on failure of main branch only
- name: Notify Slack on failure
  if: failure() && github.ref == 'refs/heads/main'
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "❌ Pipeline failed on `main` — <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View run>"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

**DORA metrics tracking:**

- **Deployment frequency + lead time** — derive from pipeline run timestamps and commit timestamps.
- Tools like **LinearB**, **Sleuth**, or **Faros** ingest CI/CD events and compute DORA automatically.
- Or build it yourself: pipeline metadata → CloudWatch Events / PubSub → BigQuery → Grafana dashboard.

> **Gotcha:** Alerting on every pipeline failure creates alert fatigue fast — feature branch failures are expected and shouldn't page anyone. Alert selectively: failures on `main`/`release` branches, or three consecutive failures on the same PR, or deployment failures in staging/prod environments.

</details>

---

### Q: How do you build pipelines for microservices or monorepos?

<details>
<summary>Show Answer</summary>

Monorepos introduce a specific CI/CD challenge: how do you avoid building and deploying *all* services when only one changed? The answer is **affected-service detection** combined with per-service pipelines.

**The core problem:**

```
monorepo/
├── services/
│   ├── payments/     ← changed
│   ├── orders/       ← unchanged
│   └── notifications/ ← unchanged
├── shared/
│   └── lib-common/   ← if this changes, all three are affected
```

**Strategy 1: Path-based triggers (simple, works for GitHub Actions)**

```yaml
# .github/workflows/payments-ci.yml
on:
  push:
    paths:
      - 'services/payments/**'
      - 'shared/lib-common/**'  # payments depends on this
```

Each service has its own workflow file. Path filters ensure only affected workflows trigger.

**Limitation:** You must manually maintain the path list as dependencies change. Works well for small monorepos with stable dependency graphs.

**Strategy 2: Change detection scripts (medium complexity)**

```yaml
- name: Detect changed services
  id: changes
  run: |
    CHANGED=$(git diff --name-only origin/main...HEAD | grep '^services/' | cut -d/ -f2 | sort -u)
    echo "services=$CHANGED" >> $GITHUB_OUTPUT

- name: Build payments if changed
  if: contains(steps.changes.outputs.services, 'payments')
  run: ./build.sh payments
```

**Strategy 3: Nx / Turborepo (recommended for large monorepos)**

Tools like **Nx** and **Turborepo** understand your dependency graph and compute which services are *affected* by a change:

```bash
# Only test and build projects affected by the diff vs main
npx nx affected --target=test --base=main
npx nx affected --target=build --base=main
```

This handles transitive dependencies — if `lib-common` changes, Nx knows that `payments`, `orders`, and `notifications` are all affected.

**Per-service deployment gates:**

Even in a monorepo, each service should have **independent deployment state**:

```
services/payments → deploys to payments ECS service
services/orders   → deploys to orders ECS service
```

Never couple deployments: if `orders` fails its tests, `payments` should still be deployable independently.

**Shared library change strategy:**

When `shared/lib-common` changes, the safest approach:
1. Run tests for *all* consuming services (affected detection).
2. Deploy services one at a time, not in a single blast.
3. Use integration tests between services to catch contract breaks before prod.

**Docker image tagging in a monorepo:**

```
payments:  sha-abc123-payments   (content hash of payments/ + shared/)
orders:    sha-abc123-orders
```

Use a hash of the service directory + shared dependencies as the image tag — identical source produces identical tags, enabling caching without rebuilding unchanged services.

> **Gotcha:** A monorepo CI setup that rebuilds everything on every commit quickly becomes the bottleneck that forces teams to batch commits or delay merges. If your monorepo CI takes 30+ minutes for a single-service change, you've lost the monorepo benefit. Invest in affected-service detection early.

</details>

---

### Q: How do you manage CI/CD for serverless applications?

<details>
<summary>Show Answer</summary>

Serverless CI/CD shares the same principles as container-based CI/CD but has distinct characteristics: **no server to deploy to**, **faster deploy times**, **unit of deployment is a function or stack**, and **infrastructure is the application**.

**What changes for serverless:**

| Dimension | Containers | Serverless |
| :--- | :--- | :--- |
| **Artifact** | Docker image | ZIP package or SAM/CDK artifact |
| **Deploy target** | ECS service / K8s deployment | Lambda function, API Gateway stage |
| **Deploy time** | Minutes | Seconds |
| **Rollback unit** | Task definition revision | Lambda version/alias or CloudFormation stack |
| **Infra and app** | Separate | Merged — Lambda + API GW + IAM are one stack |
| **Local testing** | `docker run` | `sam local invoke`, Localstack |

**Pipeline structure (AWS Lambda + SAM):**

```yaml
jobs:
  test:
    steps:
      - run: pip install -r requirements.txt
      - run: pytest tests/unit/
      - run: sam validate --lint       # Validate SAM template

  build-and-deploy-staging:
    needs: test
    steps:
      - run: sam build
      - run: |
          sam deploy \
            --stack-name myapp-staging \
            --s3-bucket my-deployment-bucket \
            --parameter-overrides Environment=staging \
            --no-confirm-changeset \
            --capabilities CAPABILITY_IAM

  integration-test:
    needs: build-and-deploy-staging
    steps:
      - run: pytest tests/integration/ --base-url=${{ steps.deploy.outputs.ApiUrl }}

  deploy-prod:
    needs: integration-test
    environment: production
    steps:
      - run: |
          sam deploy \
            --stack-name myapp-prod \
            --parameter-overrides Environment=prod \
            --no-confirm-changeset
```

**Rollback for serverless:**

- **Lambda aliases + traffic shifting:** Deploy new version to `$LATEST`, shift traffic gradually using a weighted alias (`live` → 90% v3, 10% v4). Rollback = weight alias back.
- **CloudFormation rollback:** SAM deploys via CloudFormation — if a stack update fails, CloudFormation automatically rolls back to the previous stable state.
- **CodeDeploy for Lambda:** Canary and linear traffic shifting with automatic rollback on CloudWatch alarm breach.

**Lambda-specific CI/CD practices:**
- **Dependency layers:** Build a Lambda Layer for shared dependencies — it's cached and not re-uploaded on every function deploy.
- **Cold start testing:** Include cold start latency in integration test assertions — a deploy that bloats package size can silently degrade startup performance.
- **Multi-region:** Use `sam deploy` with different `--region` flags in a matrix strategy for multi-region deployments.

**Monorepo of Lambda functions:**

Use path-based triggers per function directory. Each function has its own SAM template and deploys independently — avoids deploying 20 functions when only one changed.

> **Gotcha:** SAM and CDK deploy infrastructure *and* code in the same pipeline step. A failed IAM policy change will roll back your Lambda code too. Separate infrastructure-only changes (IAM, VPC config) from code-only changes (function logic) to reduce blast radius — or at minimum, ensure CloudFormation rollback is enabled so partial failures don't leave the stack in an inconsistent state.

</details>

---
---

## 📚 Question Reference

Additional questions and topic coverage sourced from **[acecloudinterviews.com/questions](https://www.acecloudinterviews.com/questions/)**.
