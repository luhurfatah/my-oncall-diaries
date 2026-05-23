# GitHub Actions — Reference CI/CD Pattern

This guide documents the enterprise reference pattern for a high-performance, secure GitHub Actions workflow.

---

## Trigger Behavior & Architecture

```
Pull Request to main  → CI runs (lint, test, build, scan)
                       → CD does NOT run (no deploy on PR)
                       → Purpose: validate code before merge

Push to main (merge)  → CI runs (lint, test, build, scan, push image)
                       → CD runs (deploy to staging → prod)
                       → Purpose: deploy validated code
```

---

## Full Pipeline Reference (`.github/workflows/pipeline.yml`)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main]                     # Triggers on merge to main
    paths-ignore: ['**.md', 'docs/**']   # Skip CI on doc-only changes
  pull_request:
    branches: [main]                     # Triggers on PR targeting main

# Cancel in-progress runs for the same PR/branch (saves runner minutes)
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# Principle of least privilege — only grant what's needed
permissions:
  contents: read          # Checkout code
  id-token: write         # OIDC authentication to AWS
  pull-requests: write    # Post comments on PR (optional)

# ─── CI JOBS (run on BOTH PR and push to main) ───────────────────────

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'               # Cache node_modules based on lockfile

      - run: npm ci                  # Clean install from lockfile
      - run: npm run lint

  test:
    runs-on: ubuntu-latest           # Runs in PARALLEL with lint
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci
      - run: npm test -- --coverage

      - name: Upload coverage
        if: always()                 # Upload even if tests fail
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  security-scan:
    runs-on: ubuntu-latest           # Runs in PARALLEL with lint and test
    steps:
      - uses: actions/checkout@v4

      - name: Dependency audit (CRITICAL = fail pipeline)
        run: npx audit-ci --critical   # Exits non-zero if CRITICAL CVEs found

      - name: Secret detection (any finding = fail pipeline)
        uses: trufflesecurity/trufflehog@main
        with:
          extra_args: --only-verified --fail   # Exits non-zero if secrets found

  # ─── BUILD (waits for ALL CI checks to pass) ─────────────────────
  #     If ANY of lint, test, security-scan fails → build is SKIPPED
  #     → CD never runs → broken code never reaches any environment

  build:
    needs: [lint, test, security-scan]   # ALL must pass — this is the gate
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ github.sha }}     # Pass to CD jobs

    steps:
      - uses: actions/checkout@v4

      # OIDC authentication — no static AWS keys stored in secrets
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-ci
          aws-region: ap-southeast-1

      - name: Login to Amazon ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: ${{ github.event_name == 'push' }}   # Push only on merge, not PR
          tags: |
            ${{ steps.ecr-login.outputs.registry }}/myapp:${{ github.sha }}
            ${{ steps.ecr-login.outputs.registry }}/myapp:latest
          cache-from: type=gha               # Docker layer caching
          cache-to: type=gha,mode=max

      - name: Scan image for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ steps.ecr-login.outputs.registry }}/myapp:${{ github.sha }}
          exit-code: 1                       # Fail pipeline on findings
          severity: HIGH,CRITICAL
          format: table

# ─── CD JOBS (run ONLY on push to main, never on PR) ──────────────

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: staging                     # Optional: approval gate

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
            --wait --timeout 5m              # Wait for rollout to complete

      - name: Smoke test staging
        run: |
          curl --fail --retry 5 --retry-delay 10 \
            https://staging.myapp.example.com/health

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment: production                  # Requires manual approval in GitHub

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
            --atomic                         # Auto-rollback on failure

      - name: Post-deploy verification
        run: |
          curl --fail --retry 5 --retry-delay 10 \
            https://myapp.example.com/health
```

---

## Key Best Practices Applied

### Triggers
- **PR:** Runs CI only (lint, test, security scans, build without pushing to registry) to validate code quality before merging.
- **Push to main:** Runs CI, builds and pushes the immutable image, and executes CD deployments (staging → prod).
- **Paths-ignore:** Skips CI/CD execution on documentation-only updates.

### Security
- **OIDC Authentication:** No long-lived static AWS Access Keys are stored in GitHub Secrets. Runners exchange a short-lived OIDC token with AWS IAM.
- **Explicit Permissions:** The workflow uses strict, scoped permissions (`contents: read`, `id-token: write`).
- **Blast Radius Isolation:** Separate IAM roles are used for CI vs. Staging CD vs. Production CD.
- **Trivy Image Scan:** Blocks deployment of built containers containing HIGH or CRITICAL CVEs.

### Performance
- **Parallel Jobs:** Independent linting, testing, and security scanning run concurrently.
- **Dependency Caching:** Utilizes setup-node caching patterns to preserve dependencies.
- **Docker Layer Caching:** Uses BuildKit caching integrated directly with the GitHub Actions cache back-end.
- **Concurrency Management:** Cancels in-progress runs for the same branch if a new commit is pushed.

### Deployment & Reliability
- **Staging-first Rollout:** Assures deployment to staging and smoke tests succeed before triggering prod.
- **Production Approval Gate:** Utilizes GitHub Environments to require manual verification before prod deployment.
- **Atomic Helm Deploys:** Uses `--atomic` to automatically roll back to the previous deployment revision if health checks fail.
- **Rollout Waiting:** Uses `--wait` to ensure the pipeline doesn't mark the deployment job as complete until all pods report healthy.
