# Pipeline Optimization — Making CI/CD Fast

A slow pipeline (30+ min) forces developers to batch multiple changes together, creating bigger PRs, more risk, and a longer feedback cycle. A fast pipeline (< 10 min) encourages frequent small commits with less risk and faster iterations.

> 🎯 **Target:** < 10 min for CI feedback on a PR · < 15 min for a full CD rollout to production

---

## Strategy 1: Parallelize Independent Stages

Running stages sequentially wastes time. Lint, unit tests, and security scans are all independent — they can run at the same time.

**Sequential (slow):** Lint → Unit Test → Build → Integration Test → Security Scan → Push = **18 min**

**Parallel (fast):** Lint + Unit Test + Security Scan all run simultaneously, then Build → Integration Test → Push = **13 min**

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint

  test:
    runs-on: ubuntu-latest       # Runs in PARALLEL with lint
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  security:
    runs-on: ubuntu-latest       # Runs in PARALLEL with lint and test
    steps:
      - uses: actions/checkout@v4
      - run: npx audit-ci --critical

  build:
    needs: [lint, test, security]  # Waits for ALL parallel jobs to pass
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
```

---

## Strategy 2: Cache Dependencies

Dependency installation is one of the biggest bottlenecks. Caching `node_modules`, `.m2`, pip, or go module directories eliminates redundant downloads on every run.

> **Impact:** `npm ci` drops from ~60 seconds to ~5 seconds with a warm cache.

```yaml
# Node.js — use setup-node built-in caching (recommended)
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'npm'       # Caches based on package-lock.json hash

# Explicit cache (works for any language)
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-

# Python (pip)
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: pip-${{ hashFiles('requirements.txt') }}

# Go modules
- uses: actions/cache@v4
  with:
    path: ~/go/pkg/mod
    key: go-${{ hashFiles('go.sum') }}

# Maven
- uses: actions/cache@v4
  with:
    path: ~/.m2/repository
    key: maven-${{ hashFiles('pom.xml') }}
```

---

## Strategy 3: Cache Docker Build Layers

BuildKit can push and restore layer cache to/from the GitHub Actions cache or a container registry, avoiding full image rebuilds when only source code changes.

```yaml
# GitHub Actions — Docker layer caching with BuildKit
- name: Build and push
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: myapp:${{ github.sha }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

The key is also **Dockerfile layer order**. Place instructions that change least frequently at the top so they cache more often:

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Layer 1: dependencies (changes rarely) — CACHED on most runs
COPY package.json package-lock.json ./
RUN npm ci --production

# Layer 2: source code (changes often) — only this layer rebuilds
COPY . .
RUN npm run build
```

- **Without layer caching:** Full rebuild every run = 3–5 min
- **With layer caching:** Only source layer rebuilds = 30–60s

---

## Strategy 4: Run Only What Changed (Monorepo)

In a monorepo, only run build and test steps for the services or directories that actually changed.

```yaml
- uses: dorny/paths-filter@v3
  id: changes
  with:
    filters: |
      frontend:
        - 'frontend/**'
      backend:
        - 'backend/**'
      infra:
        - 'terraform/**'

- name: Test Frontend
  if: steps.changes.outputs.frontend == 'true'
  run: cd frontend && npm test

- name: Test Backend
  if: steps.changes.outputs.backend == 'true'
  run: cd backend && go test ./...
```

For larger monorepos, dedicated tooling handles the affected graph automatically:

- **Turborepo** (JS/TS) — caches task outputs, skips tasks with no changes
- **NX** (JS/TS/Polyglot) — computes affected project graph
- **Bazel** (Language-agnostic) — hermetic remote caching at the action level

---

## Strategy 5: Smarter Test Execution

- **Run tests in parallel** across multiple CPU cores:

```bash
jest --maxWorkers=4          # Node.js
pytest -n auto               # Python (via pytest-xdist)
go test -parallel 4 ./...    # Go
```

- **Shard tests** across multiple parallel CI runners using historical timing data.
- **Run only relevant tests** for changed files: `jest --changedSince=main`

---

## Strategy 6: Self-Hosted Runners & Larger Machines

| Runner Type | Specs | Best For |
|---|---|---|
| GitHub-hosted (default) | 2 CPU, 7 GB RAM | Small projects, cold cache |
| GitHub larger runner | 8 CPU, 32 GB RAM | 3–4× faster builds |
| Self-hosted | Custom (warm cache) | Large teams, persistent cache |

> **Trade-off:** Self-hosted runners are fastest but require you to manage patching and security hardening.

---

## Strategy 7: Skip Unnecessary Work

Don't run the full CI/CD pipeline for changes that can't affect the build — like updating a README.

```yaml
on:
  push:
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - '.github/CODEOWNERS'
```

You can also skip specific steps conditionally via commit message flags:

```yaml
- name: Security Scan
  if: "!contains(github.event.head_commit.message, '[skip-scan]')"
  run: trivy image myapp:${{ github.sha }}
```

---

## Optimization Checklist

- [ ] Parallel jobs for independent stages (lint, test, scan)
- [ ] Dependency caching (npm, pip, go, maven)
- [ ] Docker layer caching (BuildKit + GHA cache or registry)
- [ ] Change detection for monorepos (paths-filter, Turborepo, NX)
- [ ] Test parallelization (`--maxWorkers`, `-n auto`, sharding)
- [ ] Skip CI on non-code changes (docs, comments)
- [ ] Pipeline timeouts configured to prevent stuck jobs
- [ ] Larger runners for CPU-intensive builds
- [ ] Incremental builds (only rebuild changed modules)
- [ ] Remote caching for build artifacts (Turborepo, Bazel)

| Metric | Before | After |
|---|---|---|
| **Total CI time** | 25–30 min | 6–10 min |
| **Dependency install** | 60–90s | 5–10s (cached) |
| **Docker build** | 3–5 min | 30–60s (layer cache) |
| **Test execution** | 8 min (serial) | 3 min (parallel + sharded) |
| **Unnecessary runs** | Every push | Only when relevant files change |
