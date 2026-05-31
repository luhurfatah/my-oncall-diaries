# CI/CD — Best Practices & Core Principles

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Core Principles](#1-core-principles) | The ten rules that underpin every well-designed pipeline, with the reasoning behind each. |
| **02** | [Pipeline Stage Design](#2-pipeline-stage-design) | Stage ordering, the fail-fast principle, and a reference stage table with tooling. |
| **03** | [Branching Strategy](#3-branching-strategy) | Git Flow vs. trunk-based development — when to use each and why trunk-based wins at speed. |
| **04** | [Environment Strategy](#4-environment-strategy) | How to structure dev → staging → prod promotion and what "mirrors prod" actually means. |
| **05** | [Deployment Strategies](#5-deployment-strategies) | Rolling, blue/green, canary, feature flags, and recreate — trade-offs and when to reach for each. |
| **06** | [Secret Management](#6-secret-management) | The rules for keeping secrets out of code, images, and logs — and how to enforce them automatically. |
| **07** | [Testing Strategy](#7-testing-strategy) | The test pyramid, what belongs at each level, and coverage philosophy. |
| **08** | [Rollback Strategy](#8-rollback-strategy) | Rollback mechanisms per deployment tool, database migration safety, and the expand-contract pattern. |
| **09** | [Observability Integration](#9-observability-integration) | Deployment events, dashboard markers, structured logs, and DORA metric collection. |
| **10** | [DevSecOps — Security at Every Layer](#10-devsecops-security-at-every-layer) | Security controls mapped to pipeline layer: code, deps, secrets, container, IaC, runtime, supply chain. |
| **11** | [DORA Metrics](#11-dora-metrics) | The four engineering performance indicators, elite targets, and how to measure each. |
| **12** | [Anti-Patterns](#12-anti-patterns) | The ten most common CI/CD mistakes and what they cost you. |

---

## 1. Core Principles

These ten rules are the foundation. Violations of any one of them are usually traceable to a real incident or operational pain.

| # | Principle | Why it matters |
| :---: | :--- | :--- |
| 1 | **Build once, deploy many** | One immutable artifact promoted across all environments eliminates the "works in staging" class of bugs — you are literally deploying the same binary |
| 2 | **Fail fast** | Order stages cheapest-first (lint → test → build → scan → deploy) so developers get feedback in minutes, not after a 20-minute build |
| 3 | **Trunk-based development** | Short-lived branches (< 2 days) with feature flags eliminate merge conflicts and keep integration continuous — the "CI" in CI/CD |
| 4 | **Never commit secrets** | Secrets in version control are permanent; even a force-push leaves them in reflog and forks. Inject at runtime from a vault |
| 5 | **Always have a rollback plan** | Define and test the rollback path *before* the deploy, not during an incident |
| 6 | **Shift-left security** | Finding a CVE in a pre-commit hook costs minutes; finding it in production costs hours and reputation |
| 7 | **Track DORA metrics** | Deployment Frequency, Lead Time, MTTR, and Change Failure Rate are the four signals that tell you if the pipeline is actually improving delivery |
| 8 | **Cache and parallelize** | Target a < 10 min CI feedback loop; beyond that, developers stop waiting and context-switch |
| 9 | **Staging must mirror prod** | Structure-identical, scale-different. If staging diverges in architecture, it stops being a safety net |
| 10 | **No manual steps** | Every manual step is toil, is inconsistent, and will be skipped under pressure. Automate or eliminate |

---

## 2. Pipeline Stage Design

### The Fail-Fast Ordering Principle

Stage order is not arbitrary. Each stage should be ordered by cost (time + compute) ascending, and by signal quality descending. A lint failure should surface in 60 seconds, not after a 10-minute Docker build.

```
Code Push → Lint → Unit Tests → Build → Integration Tests → Security Scan
         → Publish Artifact → Deploy Staging → Smoke Tests → Deploy Prod → Post-deploy Verification
```

### Stage Reference

| Stage | Purpose | Fail threshold | Reference tooling |
| :--- | :--- | :--- | :--- |
| Lint / SAST | Syntax, style, and static security issues | Any finding (configurable) | ESLint, Hadolint, Semgrep, SonarQube |
| Unit Tests | Fast, isolated logic validation | Any failure | Jest, pytest, JUnit, Go test |
| Build | Compile or containerize the artifact | Build error | Docker, Maven, Gradle, ko |
| Integration Tests | Component interaction against real deps | Any failure | Testcontainers, Postman, REST Assured |
| Security Scan | CVE and secret detection in artifact | HIGH / CRITICAL CVEs | Trivy, Grype, Snyk, TruffleHog |
| Artifact Publish | Push to registry or artifact store | Push failure | ECR, GCR, Artifactory, Nexus |
| Deploy Staging | Roll out to pre-production | Rollout timeout | Helm, ArgoCD, Flux |
| Smoke / E2E | Validate live environment health | Any failure | Cypress, k6, Playwright, curl |
| Deploy Prod | Release to production | Rollout timeout | Helm (`--atomic`), ArgoCD |
| Post-deploy | Health verification and rollback trigger | Health check failure | Datadog, Prometheus, custom scripts |

### Parallelism

Independent stages — lint, unit tests, and security scanning — should run concurrently. `build` should only begin after all three pass. This is the quality gate. If any parallel check fails, the build is skipped and CD never runs — no conditional logic required, the dependency graph enforces it.

---

## 3. Branching Strategy

### Git Flow

```
main ← release ← develop ← feature/*
                          ← hotfix/*
```

Structured release cycles with strong isolation. Appropriate for versioned software (SDKs, firmware, mobile apps) with infrequent, scheduled releases. The trade-off is long-lived branches, merge conflicts, and delayed integration feedback.

### Trunk-Based Development (Preferred for Services)

```
main ← short-lived feature branches (< 2 days)
     ← feature flags control release visibility
```

All developers integrate to `main` continuously. Features that are not ready for users are hidden behind feature flags, not held in a branch. This eliminates merge conflicts at scale, keeps CI signal fresh, and makes deployment frequency a technical choice rather than a branch management challenge.

| Property | Git Flow | Trunk-Based |
| :--- | :--- | :--- |
| Branch lifetime | Days to weeks | Hours to 2 days max |
| Merge conflict risk | High | Low |
| CI feedback freshness | Delayed | Continuous |
| Feature isolation mechanism | Branch | Feature flag |
| Release cadence | Scheduled | On-demand |
| Best fit | Versioned / packaged software | Services and web applications |

**Branch protection minimum requirements for `main`:** require at least one approving review, require all CI status checks to pass, and disallow direct pushes.

---

## 4. Environment Strategy

### Promotion Path

Changes move linearly through environments. No environment is skipped. Each promotion gate requires the previous environment's health checks to pass.

```
dev (fast feedback) → staging (production mirror) → prod (live traffic)
```

### Environment Design Rules

- **Identical in structure, different in scale.** Staging should use the same VPC layout, IAM boundaries, service dependencies, and Kubernetes resource types as production. Scale (replica count, instance size) can differ.
- **Environment-specific configuration via vault only.** Database endpoints, API keys, and feature flag states are injected at runtime from the secret store — never hardcoded, never baked into the image.
- **No shared mutable state between environments.** Staging should have its own database, its own queue, its own cache. Sharing infrastructure between environments means a staging incident can corrupt production data or exhaust production capacity.
- **Staging data should resemble production in shape, not content.** Use anonymized production snapshots or realistic synthetic data. Staging with empty databases misses an entire class of real bugs.

---

## 5. Deployment Strategies

| Strategy | Mechanism | Rollback speed | Risk level | Best fit |
| :--- | :--- | :--- | :--- | :--- |
| **Rolling Update** | Replace instances gradually | Minutes (re-deploy) | Medium | Default for most stateless workloads |
| **Blue/Green** | Two full environments; flip traffic switch | Seconds | Low | Zero-downtime requirements, easy rollback |
| **Canary** | Route a small % to new version; expand if healthy | Seconds (shift traffic back) | Low | Large user bases, risk-sensitive changes |
| **Feature Flags** | Deploy code dark; toggle visibility in prod | Milliseconds (flag flip) | Very low | Decoupling deploy from release |
| **Recreate** | Terminate all old, then start new | Re-deploy (minutes) | High | Non-critical, stateless, or dev-only workloads |

**Choosing between blue/green and canary:** blue/green is all-or-nothing — it is fast and simple but offers no gradual traffic ramp. Canary gives you a controlled ramp with real user traffic validating the new version before full promotion, at the cost of needing a traffic-splitting mechanism (Istio, ALB weighted target groups, Argo Rollouts). If you have the infrastructure for canary, prefer it for high-risk changes.

---

## 6. Secret Management

### The Hard Rules

- Never commit secrets to version control — not even in private repos, not even temporarily. Secrets survive in Git history, forks, and reflogs long after deletion.
- Never bake secrets into a Docker image at build time. `docker history` exposes every layer, including `ENV` and `ARG` instructions used during build.
- Never pass secrets as environment variables in Kubernetes manifests committed to Git. Use `secretKeyRef` referencing an externally managed secret.

### Enforcement

- Pre-commit hooks (`detect-secrets`, `gitleaks`) catch secrets before they reach the remote
- CI secret scanning (TruffleHog with `--only-verified --fail`) as a pipeline gate
- Repository scanning tools (GitHub Advanced Security, GitGuardian) for historical audits

### Secret Storage & Injection

| Tool | Best for | Injection method |
| :--- | :--- | :--- |
| HashiCorp Vault | Multi-cloud, fine-grained leases, dynamic secrets | Agent sidecar, Vault Secrets Operator |
| AWS Secrets Manager / SSM | AWS-native workloads | External Secrets Operator, ASCP |
| GCP Secret Manager | GCP-native workloads | External Secrets Operator |
| Azure Key Vault | Azure-native workloads | CSI driver, External Secrets Operator |

### OIDC / Workload Identity

CI runners should never hold a static IAM access key. Use OIDC (GitHub Actions, GitLab CI) or Workload Identity (GKE, EKS with IRSA) to issue short-lived, automatically expiring credentials scoped to the specific job. See the [GitHub Actions Pipeline Reference](github-actions-cicd-pipeline.md) for an OIDC implementation example.

---

## 7. Testing Strategy

### The Test Pyramid

More tests at the bottom (cheap, fast), fewer at the top (slow, expensive). Inverting the pyramid — many E2E tests, few unit tests — produces a slow, brittle test suite that developers learn to distrust.

| Level | Count | Speed | Dependencies | Run on |
| :--- | :--- | :--- | :--- | :--- |
| Unit | Many | Seconds | None | Every commit |
| Integration | Moderate | Minutes | Real DB, real API | Every merge |
| E2E / Smoke | Few | Minutes | Full environment | Pre-prod, post-deploy |

### Coverage Philosophy

Target **meaningful coverage**, not a line coverage percentage. 80% line coverage with tests that assert nothing is worthless. Prioritize covering business-critical paths, error boundaries, and known regression areas. Use mutation testing (Stryker, PITest) to verify that tests actually catch bugs, not just execute lines.

### Test Hygiene

- Tests must be **deterministic** — a test that passes sometimes and fails sometimes is worse than no test
- No shared mutable state between tests — use test fixtures, factories, and database transaction rollback
- Avoid `sleep()` in tests — use retry logic with backoff or event-driven assertions (polling assertions)
- Keep the test suite runnable locally with the same command used in CI

---

## 8. Rollback Strategy

A rollback plan defined during an incident is not a rollback plan. Define and test it before every production deploy.

### Rollback Mechanisms by Tool

| Tool | Rollback command | What it restores |
| :--- | :--- | :--- |
| Helm | `helm rollback <release> <revision>` | Previous Helm release state |
| Argo CD | Sync to previous Git SHA | Full manifests at that commit |
| Kubernetes | `kubectl rollout undo deployment/<name>` | Previous ReplicaSet |
| Blue/Green | Flip Service selector back | Entire active slot instantly |
| Feature Flag | Toggle flag off | Code path, not the deploy |

### Database Migration Safety — The Expand-Contract Pattern

Database migrations are the hardest part of rollback. A schema change that is not backward-compatible makes rolling back the application code impossible without also rolling back the database — which may mean data loss.

The expand-contract pattern breaks schema changes into three separate deploys:

```
Phase 1 — Expand:   Add the new column (nullable). Old code ignores it. New code writes to both.
Phase 2 — Migrate:  Backfill existing rows. Verify data integrity.
Phase 3 — Contract: Drop the old column. Old code is already retired.
```

This means any single deploy can be rolled back without leaving the database in an inconsistent state. Never combine a breaking schema change with an application cutover in the same deploy.

### Artifact Retention

Keep the last N image versions in the registry with their exact SHA tags. `latest` is not a rollback target — it gets overwritten on every deploy. Retain at minimum the last 5 production-deployed SHAs. Set lifecycle policies on ECR/GCR to prevent unbounded registry growth while protecting recent production versions.

---

## 9. Observability Integration

A deploy that isn't observable is a deploy that can't be debugged. Observability integration should be a pipeline step, not an afterthought.

### Deployment Events

Push a deployment event to your observability platform at the start and end of every production deploy. Most platforms support this natively:

| Platform | Mechanism |
| :--- | :--- |
| Datadog | `datadog-ci deployment mark` or Events API |
| Grafana | Annotations API |
| New Relic | Deployment Marker API |
| PagerDuty | Change Events API |

### Dashboard Correlation

Deployment markers overlaid on latency and error rate dashboards are the fastest way to correlate a deploy with a regression. If your SRE team isn't doing this today, add the deployment event step to the pipeline and configure the annotation in your primary SLO dashboard.

### Structured Logs

All applications should emit JSON-structured logs. Free-form text logs cannot be queried, aggregated, or alerted on at scale. Minimum fields: `timestamp`, `level`, `service`, `version` (the deployed SHA), `trace_id`, `message`. The `version` field is what lets you filter logs by deploy in production.

### Post-Deploy Smoke Test as a Circuit Breaker

The post-deploy verification step is not just a health check — it is the automated circuit breaker. If it fails, the pipeline should trigger rollback automatically. For Helm deploys, `--atomic` handles this. For other tools, the post-deploy step should call the rollback mechanism explicitly on non-zero exit.

---

## 10. DevSecOps — Security at Every Layer

Security controls should be distributed across every phase of the pipeline, not concentrated in a single gate. A vulnerability caught at the code layer costs minutes; the same vulnerability caught in production costs days.

| Layer | What to check | Tools |
| :--- | :--- | :--- |
| Code | SAST, peer review, complexity analysis | SonarQube, Semgrep, CodeClimate |
| Dependencies | SCA — known CVEs in third-party packages | Snyk, Dependabot, OWASP Dependency-Check |
| Secrets | Leaked credentials in code and history | TruffleHog, gitleaks, GitHub Advanced Security |
| Container | CVEs in OS packages and base image layers; non-root user; minimal base | Trivy, Grype, Docker Scout |
| IaC | Misconfigured Terraform, CloudFormation, Kubernetes manifests | Checkov, tfsec, OPA/Rego, kube-score |
| Runtime | DAST, WAF rules, network policies, pod security standards | OWASP ZAP, Falco, kube-bench |
| Supply Chain | SBOM generation, image signing, provenance attestation | cosign, Syft, SLSA framework |

**Minimum viable DevSecOps for a new pipeline:** secret scanning in pre-commit, dependency CVE check in CI, container image scan before push. Add layers as the team matures.

---

## 11. DORA Metrics

DORA metrics are the four engineering performance indicators that correlate most strongly with organizational outcomes (from the State of DevOps research). They measure the speed and stability of your delivery system, not individual productivity.

| Metric | What it measures | Elite target | How to collect |
| :--- | :--- | :--- | :--- |
| **Deployment Frequency** | How often you ship to production | Multiple times per day | Count prod deploy events per day |
| **Lead Time for Changes** | Commit to production duration | < 1 hour | Timestamp from first commit to deploy completion |
| **MTTR** | How fast you recover from incidents | < 1 hour | Incident start to resolution timestamp |
| **Change Failure Rate** | % of deploys that cause an incident or rollback | < 5% | Failed or rolled-back deploys / total deploys |

Deployment Frequency and Lead Time measure **speed**. MTTR and Change Failure Rate measure **stability**. High-performing teams improve both simultaneously — the research consistently shows speed and stability are not a trade-off.

Use these as team KPIs reviewed in retrospectives, not as individual performance metrics. A high Change Failure Rate is a signal to invest in testing or deployment strategy, not to blame individual engineers.

---

## 12. Anti-Patterns

| Anti-Pattern | What it costs you |
| :--- | :--- |
| Long-lived feature branches | Merge conflicts, delayed integration, stale CI signal |
| Manual steps in the pipeline | Toil, inconsistency, and steps skipped under incident pressure |
| Different artifact per environment | Violates build-once; staging tests a different binary than prod |
| Secrets baked into images | Permanent credential exposure via `docker history` |
| Skipping tests to speed up deployment | Technical debt that compounds; the next incident will be longer |
| No rollback plan before a prod deploy | Rollback decisions made under pressure are wrong decisions |
| Monolithic pipelines with no parallelism | 30-minute feedback loops that developers learn to ignore |
| `latest` image tags in production | Deploys are not reproducible; rollback has no stable target |
| Ignoring security scan findings | CVEs age badly; a known finding becomes an exploited finding |
| No post-deploy verification | You find out the deploy failed from a user report, not a monitor |