# CI/CD Best Practices & Core Principles

This guide covers the core principles, strategies, and methodologies for building robust and reliable CI/CD pipelines.

## Quick Summary

1. **Build once, deploy many** — one immutable artifact promoted across all environments (dev → staging → prod)
2. **Fail fast** — order pipeline stages so cheapest checks run first: lint → test → build → scan → deploy
3. **Trunk-based development** — short-lived branches (< 2 days) + feature flags to decouple deploy from release
4. **Never commit secrets** — use secret stores (Vault, AWS SSM) and inject at runtime, not build time
5. **Always have a rollback plan** — automated rollback on health check failure; keep N previous artifacts
6. **Shift-left security (DevSecOps)** — SAST, SCA, image scanning, and secret detection in every pipeline run
7. **Track DORA metrics** — Deployment Frequency, Lead Time, MTTR, Change Failure Rate as team KPIs
8. **Cache and parallelize** — target < 10 min CI feedback loop by caching deps and running stages concurrently
9. **Staging must mirror prod** — same infrastructure structure, env-specific secrets only via vault
10. **No manual steps** — everything automated and idempotent; manual = toil + human error

---

## 1. Core Principles

- **Commit early, commit often** — small, focused commits are easier to debug and revert.
- **Everything as code** — pipelines, infra, configs all live in version control (GitOps).
- **Fail fast** — surface errors at the earliest possible stage (lint → test → build → deploy).
- **Build once, deploy many** — one artifact promoted across environments. See [Build Once, Deploy Many](build-once-deploy-many.md).
- **Immutable artifacts** — never modify a built artifact; rebuild if needed.
- **Idempotent pipelines** — running the same pipeline twice should produce the same result.

---

## 2. Pipeline Stages

A typical pipeline runs stages in order from cheapest to most expensive:

> Code Push → Lint → Unit Tests → Build → Integration Tests → Security Scan → Publish Artifact → Deploy Staging → Smoke Tests → Deploy Prod → Post-deploy Verification

| Stage | Purpose | Tools |
|---|---|---|
| Lint / SAST | Catch syntax & style issues early | ESLint, Hadolint, SonarQube |
| Unit Tests | Fast, isolated logic validation | Jest, pytest, JUnit |
| Build | Compile/containerize the artifact | Docker, Maven, Gradle |
| Integration Tests | Test component interactions | Testcontainers, Postman |
| Security Scan | CVE & secret detection | Trivy, Snyk, TruffleHog, Grype |
| Artifact Publish | Push to registry/repo | ECR, GCR, Artifactory, Nexus |
| Deploy Staging | Deploy to pre-prod environment | Helm, ArgoCD |
| Smoke / E2E | Validate live environment | Selenium, Cypress, k6 |
| Deploy Prod | Release to production | Helm, ArgoCD |
| Post-deploy | Health check, rollback trigger | Datadog, Prometheus alerts |

---

## 3. Branching Strategy

### Git Flow

```text
main ← release ← develop ← feature/*
                          ← hotfix/*
```

Structured release cycles with high isolation, but prone to long-lived branches and merge conflicts.

### Trunk-Based Development (Preferred)

```text
main ← short-lived feature branches (< 2 days)
     ← feature flags control release
```

- **Prefer trunk-based** for fast-moving teams — reduces merge conflicts.
- Use **feature flags** to decouple deployment from release.
- Protect `main` / `master` with required reviews + passing CI.

---

## 4. Environment Strategy

Environments promote changes through a linear path: **dev → staging → prod**

- Environments should be **identical in structure**, different in scale.
- Use **environment-specific secrets** via vault (HashiCorp Vault, AWS SSM, GCP Secret Manager).
- Never hardcode credentials — inject via env vars or secret stores at runtime.
- **Staging must mirror prod** closely enough to catch real issues before they reach production.

---

## 5. Deployment Strategies

| Strategy | Description | Use Case |
|---|---|---|
| **Rolling Update** | Gradually replace old instances | Default for most workloads |
| **Blue/Green** | Two identical envs; switch traffic instantly | Zero-downtime, easy rollback. See [Blue/Green Guide](blue-green.md). |
| **Canary** | Route small % traffic to new version | Risk mitigation on large changes |
| **Feature Flags** | Deploy code, toggle visibility in prod | Decouple deploy from release |
| **Recreate** | Kill all, then deploy new | Non-critical, stateless apps only |

---

## 6. Secret Management

- **Never commit secrets** to version control — even in private repos.
- Use `.gitignore` + pre-commit hooks (`detect-secrets`, `gitleaks`) to catch leaks early.
- Centralise secrets in: **HashiCorp Vault**, AWS Secrets Manager / SSM, GCP Secret Manager, or Azure Key Vault.
- Inject secrets at **runtime**, not build time — they should never be baked into an image.
- **Rotate secrets regularly** and revoke immediately if a leak is suspected.
- Use OIDC/Workload Identity for CI runners to avoid static long-lived IAM keys.

---

## 7. Testing Strategy

The test pyramid guides how many tests to write at each level:

- **Unit tests** — many, fast, no external deps. Run on every commit.
- **Integration tests** — moderate count, test real DB/API calls. Run on merge.
- **E2E tests** — few, slow, full user journey. Run pre-prod and post-deploy.

Aim for **meaningful coverage**, not 100% line coverage. Use test fixtures and factories to avoid shared mutable state between tests.

---

## 8. Rollback Strategy

- **Always have a rollback plan** defined before deploying to production.
- Automate rollback on health check failure using readiness/liveness probes.
- **Blue/Green:** redirect traffic back to the previous environment instantly.
- **Helm:** `helm rollback <release> <revision>`
- **Argo CD:** sync to a previous Git SHA.
- Keep **N previous artifact versions** in the registry for quick revert.
- For database migrations, use the **expand-contract pattern** to ensure backward-compatible schema changes.

---

## 9. Observability Integration

- Emit **structured logs** (JSON) from all applications.
- Push **deployment events** to monitoring tools (Datadog, Grafana, New Relic).
- Set **deployment markers** on dashboards — correlate deploys with latency or error spikes.
- Automate **post-deploy smoke tests** and alert on failure.
- Track the four **DORA metrics** as team health KPIs.

---

## 10. Security (DevSecOps)

| Layer | Practice |
|---|---|
| Code | SAST (SonarQube, Semgrep), peer review |
| Dependencies | SCA — Snyk, Dependabot, OWASP Dependency-Check |
| Secrets | TruffleHog, gitleaks in pre-commit + CI |
| Container | Trivy/Grype image scan, non-root user, minimal base images |
| IaC | Checkov, tfsec, OPA/Rego policy |
| Runtime | DAST, WAF, network policies, pod security standards |
| Supply Chain | SBOM generation, image signing (cosign), SLSA framework |

---

## 11. DORA Metrics

| Metric | Elite Target | How to Measure |
|---|---|---|
| **Deployment Frequency** | On-demand (multiple/day) | Deploys per day |
| **Lead Time for Changes** | < 1 hour | Commit to prod time |
| **MTTR (Mean Time to Recover)** | < 1 hour | Incident duration |
| **Change Failure Rate** | < 5% | Failed deploys / total deploys |

---

## 12. Common Anti-Patterns

- ❌ Long-lived feature branches — causes merge conflicts and delayed integration
- ❌ Manual steps in the pipeline — toil, inconsistency, and human error
- ❌ Different artifact per environment — violates the build-once principle
- ❌ Secrets in environment variables baked into images
- ❌ Skipping tests to "speed up" deployment
- ❌ No rollback plan before a prod deploy
- ❌ Monolithic pipelines with no parallelism
- ❌ `latest` image tags in production manifests
- ❌ Ignoring security scan findings ("we'll fix it later")
- ❌ No post-deploy verification step
