# Build Once, Deploy Many

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The Principle](#1-the-principle) | Why building per-environment violates delivery integrity and what immutable promotion actually means. |
| **02** | [What Changes, What Does Not](#2-what-changes-what-does-not) | The hard boundary between build-time constants and runtime configuration. |
| **03** | [Backend & Container Apps](#3-backend-container-apps) | Pipeline flow, Helm values, Kustomize overlays, and config injection patterns for server-side services. |
| **04** | [Frontend SPAs — The Tricky Part](#4-frontend-spas-the-tricky-part) | Why build-time env var baking breaks the principle and three runtime config strategies that solve it. |
| **05** | [SSR Apps — Next.js](#5-ssr-apps-nextjs) | Server-side rendering config patterns, `publicRuntimeConfig`, and the static export exception. |
| **06** | [Mobile Apps](#6-mobile-apps) | Why mobile binaries are the hardest case and how remote config services solve the promotion problem. |
| **07** | [Artifact Promotion Pipeline](#7-artifact-promotion-pipeline) | How a full multi-environment promotion pipeline is structured, gated, and audited. |
| **08** | [Common Violations & Failure Modes](#8-common-violations-failure-modes) | The most frequent ways teams accidentally break the build-once principle and how to detect them. |

---

## 1. The Principle

Build Once, Deploy Many is the discipline of producing a single immutable artifact from a single CI build and promoting that exact artifact through every environment — development, staging, production — without rebuilding it. The only things that vary between environments are configuration values and secrets, injected at runtime. The binary itself is identical.

The wrong approach is to run a separate build for each environment, parameterized with environment-specific values at build time. This produces binaries that are superficially similar but not identical — different compiler outputs, different inlined constants, different dependency resolution snapshots depending on when each build ran. The consequences are subtle and dangerous: a bug present in the dev build may not reproduce in the staging build because the two builds are not the same artifact. When staging passes and production fails, the diagnosis almost always traces back to an environment-specific build difference that was invisible during testing.

The correct approach is to build once, tag the artifact with the commit SHA that produced it, and promote that exact artifact. Every environment runs the same binary. If it passes integration tests in staging, you have high confidence it will behave the same way in production — because it is not just similar code, it is the same compiled object.

This principle has a direct relationship with the immutable infrastructure model described in the CI/CD Foundations guide. An artifact tagged with a commit SHA is immutable by definition: it represents a specific, reproducible state of the codebase at a specific moment. Promoting it is a mechanical operation, not a creative one.

---

## 2. What Changes, What Does Not

The discipline of build-once requires a clear mental boundary between what belongs in the artifact and what belongs in the environment. Violating this boundary — putting runtime configuration inside the artifact — is the root cause of almost every build-once failure.

### Must Never Be Baked Into the Artifact

The following values are environment-specific. They must always be injected at runtime via environment variables, ConfigMaps, Secrets Manager, or a configuration service — never hardcoded or inlined during the build.

- API URLs and backend service endpoints
- Database connection strings and credentials
- Secrets, API keys, tokens, and certificates
- Feature flag values and A/B test parameters
- Environment name identifiers (`dev`, `staging`, `prod`)
- Log levels and debug flags
- Third-party service URLs (analytics, payment gateways, CDNs)
- Replica counts and resource limits (infra concern, not app concern)

### Safe to Bake In at Build Time

The following are intrinsic to the application logic and do not vary between environments. They are safe — and correct — to compile into the artifact.

- Application code and business logic
- UI components, stylesheets, and static assets
- Package dependencies and their resolved versions
- Build-time optimizations (minification, tree-shaking, dead code elimination)
- Internal routing logic that does not reference external endpoints
- Schema definitions and data models

### The Detection Test

When evaluating whether a value belongs in the artifact or in runtime configuration, apply this test: if you changed this value, would you need to rebuild the binary, or just restart the container with a different environment variable? If it requires a rebuild, it is build-time. If a restart is sufficient, it should be runtime-injected. Any value that fails this test — where a rebuild is needed because the value is baked in, but the value logically belongs to the environment — is a build-once violation waiting to cause a production incident.

| Category | Examples | Belongs In |
| :--- | :--- | :--- |
| Business logic | Discount calculation, auth rules | Artifact (build time) |
| UI components | React components, CSS | Artifact (build time) |
| Dependencies | npm packages, Go modules | Artifact (build time) |
| Service endpoints | `https://api.prod.example.com` | Runtime config |
| Credentials | DB passwords, API tokens | Runtime secrets |
| Feature flags | `FEATURE_NEW_CHECKOUT=true` | Runtime config |
| Log verbosity | `LOG_LEVEL=debug` | Runtime config |
| Scaling parameters | `REPLICA_COUNT=5` | Infrastructure config |

---

## 3. Backend & Container Apps

For backend services — Go binaries, Java JARs, Node.js apps, Python services — the artifact is a Docker image tagged with the Git commit SHA. This is the most straightforward implementation of build-once because server-side runtimes read environment variables at process startup, making runtime injection natural.

### Pipeline Flow

A promotion pipeline for a backend service follows this sequence. The image is built exactly once in the first stage, and every subsequent stage deploys the same image tag.

- **Build stage** — CI builds `myapp:abc1234` and pushes to ECR or GCR. No environment-specific values are baked in.
- **Dev deployment** — the same image is deployed with dev configuration injected via environment variables, ConfigMaps, or External Secrets Operator pulling from Vault or AWS Secrets Manager.
- **Staging deployment** — the same `myapp:abc1234` image is promoted. Staging config is injected. Integration and end-to-end test suites run against the deployed instance.
- **Production deployment** — after staging gates pass, the same image is promoted to production with production config injected.

The commit SHA tag is non-negotiable. Using a mutable tag like `latest` breaks the immutability guarantee — `latest` can silently point to a different image between the time staging tested it and the time it is pulled by the production cluster.

### Helm Values Pattern

Helm overlays are the standard mechanism for per-environment configuration injection in Kubernetes. The image tag is the same across all values files; only the configuration and scaling parameters differ.

```yaml
# values-dev.yaml
replicaCount: 1
image:
  tag: "abc1234"
env:
  API_URL: "https://api.dev.example.com"
  LOG_LEVEL: "debug"
resources:
  requests:
    cpu: 100m
    memory: 128Mi
```

```yaml
# values-prod.yaml
replicaCount: 5
image:
  tag: "abc1234"
env:
  API_URL: "https://api.example.com"
  LOG_LEVEL: "warn"
resources:
  requests:
    cpu: 500m
    memory: 512Mi
```

Secrets are never stored in values files — even encrypted values files are a last resort. The correct pattern is to reference a Kubernetes Secret by name in the values file, with the Secret itself managed by External Secrets Operator pulling from AWS Secrets Manager or Vault:

```yaml
# values-prod.yaml — reference secrets by name, never inline values
envFrom:
  - secretRef:
      name: payments-api-secrets   # Populated by ExternalSecret CR
```

### Kustomize Overlays Pattern

Kustomize achieves the same result through a base-plus-overlay model. The base contains the common manifest; overlays contain only the environment-specific patches.

```yaml
# overlays/prod/kustomization.yaml
resources:
  - ../../base
images:
  - name: myapp
    newTag: "abc1234"    # Updated by CI automation
patches:
  - path: replica-patch.yaml
  - path: resource-patch.yaml
```

The CI pipeline updates `newTag` in the overlay's `kustomization.yaml` via a `sed` command or `kustomize edit set image`, commits the change to the GitOps repository, and the ArgoCD or Flux controller reconciles the change to the cluster. The image itself is never rebuilt.

---

## 4. Frontend SPAs — The Tricky Part

Frontend applications built with React, Vue, Vite, or similar frameworks present a structural challenge to build-once. These tools process environment variables at build time — `VITE_API_URL`, `REACT_APP_API_URL`, `NEXT_PUBLIC_*` — and inline their values directly into the compiled JavaScript bundle. A bundle built with `VITE_API_URL=https://api.dev.example.com` contains that string literally in the minified output. Deploying that bundle to production will call the dev API.

The naive fix — building a separate bundle per environment — is the violation. The correct fix is to defer configuration loading to runtime entirely, so the build produces a bundle with no environment-specific values inlined, and the container or server injects the correct values when it starts.

There are three viable approaches.

### Solution 1: Runtime Config File via Entrypoint Script (Recommended)

This pattern serves a static `config.js` file that contains placeholder strings. When the container starts, an entrypoint shell script uses `sed` to substitute those placeholders with real values from the container's environment variables. The result is a correctly-configured `config.js` served to the browser — different values per environment, same image everywhere.

The `config.js` file lives in the `public/` directory so it is served as a static file by nginx, not processed by Vite or Webpack:

```javascript
// public/config.js — static file, never processed by the bundler
window.__ENV__ = {
  API_URL: "__API_URL_PLACEHOLDER__",
  FEATURE_CHECKOUT_V2: "__FEATURE_CHECKOUT_V2_PLACEHOLDER__",
  ANALYTICS_KEY: "__ANALYTICS_KEY_PLACEHOLDER__",
};
```

Load `config.js` before the application bundle in `index.html`, so `window.__ENV__` is populated before any application code runs:

```html
<!-- index.html -->
<head>
  <script src="/config.js"></script>
  <script type="module" src="/assets/main.js"></script>
</head>
```

In application code, read from `window.__ENV__` rather than `import.meta.env` or `process.env`:

```javascript
// src/config.ts
const config = {
  apiUrl: window.__ENV__.API_URL,
  featureCheckoutV2: window.__ENV__.FEATURE_CHECKOUT_V2 === 'true',
  analyticsKey: window.__ENV__.ANALYTICS_KEY,
};

export default config;
```

The Dockerfile copies the built static files and the entrypoint script. The entrypoint runs the substitution at container start, before nginx begins serving:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
```

```bash
#!/bin/sh
# docker-entrypoint.sh — runs at container startup, before nginx
set -e

CONFIG_FILE="/usr/share/nginx/html/config.js"

sed -i "s|__API_URL_PLACEHOLDER__|${API_URL}|g" "$CONFIG_FILE"
sed -i "s|__FEATURE_CHECKOUT_V2_PLACEHOLDER__|${FEATURE_CHECKOUT_V2}|g" "$CONFIG_FILE"
sed -i "s|__ANALYTICS_KEY_PLACEHOLDER__|${ANALYTICS_KEY}|g" "$CONFIG_FILE"

echo "Runtime config applied."
exec "$@"
```

The Kubernetes deployment injects the environment-specific values as normal environment variables:

```yaml
env:
  - name: API_URL
    value: "https://api.prod.example.com"
  - name: FEATURE_CHECKOUT_V2
    value: "true"
  - name: ANALYTICS_KEY
    valueFrom:
      secretKeyRef:
        name: frontend-secrets
        key: analytics-key
```

This approach works for any static hosting setup — ECS, Kubernetes, or a VM running nginx. It has no framework dependency and is fully transparent: inspecting `config.js` in the browser shows exactly what config the container is running with.

### Solution 2: Config Endpoint (API-Driven)

The frontend fetches its configuration from the backend at application startup. The backend reads its own environment variables and returns a JSON config response. This approach is particularly well-suited to applications where the frontend and backend are deployed together, or where the backend already enforces authentication that should gate config access.

```typescript
// src/bootstrap.ts — fetch config before rendering
async function loadConfig(): Promise<AppConfig> {
  const response = await fetch('/api/v1/config');
  if (!response.ok) {
    throw new Error(`Failed to load config: ${response.status}`);
  }
  return response.json();
}

loadConfig()
  .then(config => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <ConfigProvider config={config}>
        <App />
      </ConfigProvider>
    );
  })
  .catch(err => {
    console.error('Application failed to start:', err);
    // Render a user-facing error state, do not silently fail
  });
```

The backend config endpoint reads from its own environment:

```go
// handlers/config.go
func ConfigHandler(w http.ResponseWriter, r *http.Request) {
    config := map[string]interface{}{
        "apiUrl":           os.Getenv("API_URL"),
        "featureCheckoutV2": os.Getenv("FEATURE_CHECKOUT_V2") == "true",
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(config)
}
```

The trade-off is that this adds a network call to the application startup path. If the backend is unavailable, the frontend cannot start. For applications that already depend on the backend being up before they are useful, this is an acceptable coupling. For applications that should render something useful even when the backend is degraded, Solution 1 is more resilient.

### Solution 3: S3 or CDN Hosted SPAs

When the frontend is deployed as static files to S3 and served via CloudFront — rather than as a container — the entrypoint script approach is not available. The substitution must happen in the CI pipeline before the files are uploaded, on a per-environment basis.

This is the one case where uploading different files per environment is unavoidable. The key is that the application bundle itself is identical — only `config.js` differs. The CI pipeline replaces the placeholders in `config.js` using the same `sed` pattern, then uploads the modified `config.js` alongside the unchanged bundle to the environment-specific S3 bucket.

```bash
# CI script — run per environment, not per build
DIST_DIR="dist"
CONFIG_FILE="${DIST_DIR}/config.js"

# Substitute placeholders with environment-specific values
sed -i "s|__API_URL_PLACEHOLDER__|${API_URL}|g" "$CONFIG_FILE"
sed -i "s|__FEATURE_CHECKOUT_V2_PLACEHOLDER__|${FEATURE_CHECKOUT_V2}|g" "$CONFIG_FILE"

# Upload to environment-specific bucket
aws s3 sync "${DIST_DIR}/" "s3://${S3_BUCKET}/" \
  --cache-control "max-age=31536000,immutable" \
  --exclude "config.js"

# Upload config.js with short cache TTL — it changes per environment
aws s3 cp "${CONFIG_FILE}" "s3://${S3_BUCKET}/config.js" \
  --cache-control "max-age=60,no-cache"

# Invalidate CloudFront cache for config.js only
aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/config.js"
```

Setting a short cache TTL on `config.js` and a long TTL on all other assets is important. The bundle files are content-addressed (their names contain a hash) and genuinely immutable. `config.js` changes with every deployment and must not be aggressively cached.

---

## 5. SSR Apps — Next.js

Next.js occupies a middle ground between fully static SPAs and traditional backend services. It runs a Node.js server that renders pages on request, which means it can read environment variables at server startup — not at build time. This makes runtime config injection more tractable than with static SPAs, but requires understanding which Next.js configuration mechanism is actually runtime-evaluated.

### publicRuntimeConfig

`publicRuntimeConfig` is Next.js's mechanism for exposing server-side environment variables to both server-rendered pages and client-side navigation. Values are read from `process.env` when the Next.js server starts, making them truly runtime-configurable — the same Docker image can run with different values in different environments.

```javascript
// next.config.js
module.exports = {
  publicRuntimeConfig: {
    apiUrl: process.env.API_URL,
    featureCheckoutV2: process.env.FEATURE_CHECKOUT_V2 === 'true',
  },
};
```

```javascript
// pages/index.tsx or any component
import getConfig from 'next/config';

const { publicRuntimeConfig } = getConfig();

export default function HomePage() {
  return <div>API: {publicRuntimeConfig.apiUrl}</div>;
}
```

The critical constraint is that `publicRuntimeConfig` requires Next.js server mode. It does not work with `next export` (static HTML export), because static export eliminates the server that reads the environment variables. For statically exported Next.js applications, use Solution 1 from Section 04.

### NEXT_PUBLIC_ Variables (The Trap)

`NEXT_PUBLIC_*` variables are the standard Next.js client-side config mechanism, but they are evaluated at build time and inlined into the JavaScript bundle — identical to how Vite and Create React App handle `VITE_*` and `REACT_APP_*` variables. Using `NEXT_PUBLIC_API_URL` means the API URL is baked into the bundle at build time, violating build-once exactly as it does in Vite.

`NEXT_PUBLIC_*` is appropriate only for values that genuinely do not change between environments: a public asset CDN domain that is the same everywhere, a third-party analytics script URL, or a fixed public identifier. Any value that differs between dev, staging, and prod must use `publicRuntimeConfig` or a runtime config fetch, not `NEXT_PUBLIC_*`.

| Mechanism | Evaluated At | Works with Static Export | Build-Once Safe |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_*` env vars | Build time | Yes | Only for env-invariant values |
| `publicRuntimeConfig` | Server startup | No | Yes |
| `/api/config` endpoint | Request time | No | Yes |
| Runtime `config.js` (Solution 1) | Container startup | Yes | Yes |

---

## 6. Mobile Apps

Mobile applications are the hardest case for build-once. An iOS IPA or Android APK is a signed binary artifact — it cannot be modified after it is signed without invalidating the signature. There is no "entrypoint script" that runs at startup and substitutes placeholders. The binary that leaves CI is the binary that the user downloads from the App Store or Play Store.

Despite this constraint, build-once still applies: the same signed binary should be used for TestFlight/internal testing and for the production App Store submission. Building a separate binary for each test environment reintroduces the "works in testing, fails in production" risk.

### Remote Config Services

The standard solution is to have the mobile app fetch its configuration from a remote endpoint at launch time. Firebase Remote Config, LaunchDarkly, AWS AppConfig, and similar services serve environment-specific configuration to the app at runtime. The app binary contains only a minimal bootstrap config — enough to know where to reach the config service — and reads everything else remotely.

```swift
// iOS — fetch config at app launch before rendering UI
func application(_ application: UIApplication,
                 didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

    RemoteConfig.remoteConfig().fetch(withExpirationDuration: 3600) { status, error in
        if status == .success {
            RemoteConfig.remoteConfig().activate()
        }
        // Proceed with app startup using fetched or cached config
        self.startMainApplication()
    }
    return true
}
```

The config service itself is aware of which environment it is serving — typically determined by the app's bundle identifier (`com.example.app.dev` vs `com.example.app`) or by a signing certificate that identifies the environment. The same binary reads different config values in TestFlight (dev/staging config) and in the App Store (production config).

### What the Mobile Binary Must Not Contain

Even with remote config, mobile binaries frequently contain hardcoded values that should be remote-configurable: API base URLs, feature flag defaults, third-party SDK initialization keys, and debug flags. These should be treated with the same discipline as backend configuration — absent from the binary unless they are truly environment-invariant. Embedding `https://api.prod.example.com` in the binary prevents the TestFlight build from pointing at a staging API without a rebuild.

---

## 7. Artifact Promotion Pipeline

A build-once promotion pipeline has a clear structure: one build stage, multiple deploy stages, and explicit promotion gates between environments. The artifact tag flows through every stage without being rebuilt.

### Pipeline Stages

The build stage runs once per commit. It compiles the artifact, runs unit tests, executes SAST and dependency scanning, and pushes the tagged image to the registry. If the build fails, the pipeline stops here — no artifact is promoted.

The dev deployment stage deploys the new image to the development environment and runs smoke tests to confirm the service starts and passes basic health checks. Dev is the first environment where the artifact meets real infrastructure. Failures here indicate environment configuration problems, not code problems — the artifact is unchanged.

The staging deployment stage promotes the same image to staging and runs the full integration and end-to-end test suite. Staging should be a production-equivalent environment: same instance types, same network topology, same secrets management setup, same observability stack. Any difference between staging and production is a risk factor for the promotion to production.

The production promotion stage is gated. In a fully automated pipeline, the gate is a passing staging test suite and an optional approval step. In a manually-gated pipeline, a human explicitly triggers the promotion. Either way, the action is to update the production environment's image tag reference — in the Helm values file, the Kustomize overlay, or the ECS task definition — to point at the same artifact that already ran in staging.

### Git SHA as the Promotion Token

The commit SHA is the single token that links every stage of the pipeline. It identifies the artifact, the source code that produced it, the CI run that built it, and the environments it has been promoted to. Every deployment record, every test result, every environment's running version should be traceable back to a commit SHA.

```bash
# CI: build and tag with commit SHA
IMAGE_TAG="${GIT_SHA:0:8}"    # First 8 chars: abc1234f
docker build -t "${ECR_REPO}/myapp:${IMAGE_TAG}" .
docker push "${ECR_REPO}/myapp:${IMAGE_TAG}"

# Also tag as the branch name for human readability — but always deploy the SHA tag
docker tag "${ECR_REPO}/myapp:${IMAGE_TAG}" "${ECR_REPO}/myapp:main-latest"
docker push "${ECR_REPO}/myapp:main-latest"
```

```bash
# Promotion: update the GitOps repo with the new tag — no rebuild
git clone https://github.com/org/gitops-config
cd gitops-config
sed -i "s/newTag: .*/newTag: \"${IMAGE_TAG}\"/" overlays/prod/kustomization.yaml
git commit -am "chore: promote myapp ${IMAGE_TAG} to production"
git push
# ArgoCD or Flux detects the commit and reconciles production
```

### Promotion Gate Checklist

Before promoting from staging to production, the following gates should be satisfied automatically by the pipeline:

- Staging deployment completed successfully with zero crash-loops
- All integration tests passed (exit code 0)
- No new HIGH or CRITICAL CVEs introduced since the last promoted version
- Error rate in staging is within baseline (monitored via CloudWatch or Datadog)
- Manual approval received (if required by the organization's change process)

---

## 8. Common Violations & Failure Modes

The build-once principle is straightforward to state and consistently violated in practice. Most violations are not intentional — they accumulate gradually as teams add environment-specific parameters to build steps for convenience.

### Build-Time Environment Variable Injection

The most common violation. A developer adds `--build-arg API_URL=${API_URL}` to a `docker build` command to avoid dealing with runtime config injection. The Docker image now contains a hardcoded API URL. The build passes; the promotion breaks.

Detection: inspect the final image with `docker inspect` or `docker history`. Any `ENV` instruction or `ARG` that contains a URL, hostname, or environment identifier is a violation. Add a CI step that asserts the image contains no environment-specific strings.

### Mutable Image Tags

Using `latest`, `main`, or a branch name as the deployed tag. These tags are mutable — the same tag can point to different image digests at different times. If staging deploys `myapp:latest` and production deploys `myapp:latest` two hours later, they may be running different images depending on what was built in between.

Detection: scan the deployment manifests for non-SHA image tags and fail the CI pipeline. Enforce immutable tag patterns with a Kyverno or OPA policy on the Kubernetes admission controller.

### Per-Environment Build Jobs

A CI configuration with three jobs — `build-dev`, `build-staging`, `build-prod` — each running `docker build` with different arguments. This is the definitional violation. Every environment gets a different binary. Any test result from `build-dev` is meaningless as evidence of what `build-prod` will do.

Detection: audit the CI configuration for multiple build jobs targeting the same service. A build-once pipeline has exactly one build job per service per commit.

### Secrets in Environment Variables Stored in Git

Injecting configuration at runtime is correct; storing the injected values in plain text in a Git repository is a separate, serious problem. Helm values files with plaintext database passwords, `.env` files committed to the config repository, or Kubernetes Secret manifests with base64-encoded values in Git are all violations of secrets hygiene even though they do not violate build-once.

Runtime configuration injection must be paired with a secrets management system — AWS Secrets Manager, HashiCorp Vault, or Azure Key Vault — with the External Secrets Operator or equivalent pulling secrets into Kubernetes Secrets at deployment time. The Git repository stores references to secrets, never the secrets themselves.

### Summary

| App Type | Artifact | Config Injection Method |
| :--- | :--- | :--- |
| Backend (Go, Java, Node, Python) | Docker image (SHA-tagged) | Env vars, ConfigMaps, External Secrets at runtime |
| Frontend SPA — containerized (React, Vue) | Docker image (nginx + static) | Entrypoint script substitutes placeholders in `config.js` |
| Frontend SPA — S3 + CDN | Static file bundle | CI substitutes `config.js` per environment before upload |
| SSR App (Next.js — server mode) | Docker image | `publicRuntimeConfig` reads env vars at server startup |
| SSR App (Next.js — static export) | Static file bundle | Runtime `config.js` via Solution 1 |
| Mobile App (iOS / Android) | Signed binary (IPA / APK) | Remote config service fetched at app launch |
| Helm Chart | Chart package (OCI or tarball) | `values-{env}.yaml` files per environment |