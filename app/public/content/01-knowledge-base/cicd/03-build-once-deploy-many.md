# Build Once, Deploy Many — Implementation Guide

## The Principle

The core idea is simple: build your artifact **once**, then promote the same immutable artifact across all environments. The only thing that changes between environments is configuration and secrets — not the binary itself.

> ❌ **Wrong:** Build a separate artifact per environment
> `CI builds myapp:dev → myapp:staging → myapp:prod`
> Different builds = different binaries = "works on staging" ≠ works on prod.

> ✅ **Correct:** Build ONE artifact, promote it everywhere
> `CI builds myapp:abc1234 → deploy to dev → staging → prod`
> Same binary everywhere. Only config and secrets change per environment.

---

## Backend / Container Apps

For backend services, the artifact is a Docker image tagged with the Git SHA. This is the most straightforward implementation.

### Pipeline Flow

1. CI builds image → `myapp:abc1234`
2. Push to registry (ECR / GCR)
3. Deploy to **dev** — inject dev config via env vars / ConfigMaps / Vault
4. Deploy to **staging** — same image, staging config
5. Deploy to **prod** — same image, prod config

### What changes per environment (injected at runtime)

- Database connection strings
- API endpoints / base URLs
- Feature flag values
- Log levels
- Secrets (via Vault / Secrets Manager / External Secrets Operator)
- Replica count and resource limits (via Helm values or Kustomize overlays)

### Example: Helm Values

```yaml
# values-dev.yaml
replicaCount: 1
image:
  tag: "abc1234"      # Same tag everywhere
env:
  API_URL: "https://api.dev.example.com"
  LOG_LEVEL: "debug"

# values-prod.yaml
replicaCount: 5
image:
  tag: "abc1234"      # Same tag everywhere
env:
  API_URL: "https://api.example.com"
  LOG_LEVEL: "warn"
```

### Example: Kustomize

```yaml
# overlays/prod/kustomization.yaml
images:
  - name: myapp
    newTag: "abc1234"    # CI updates this tag
patches:
  - path: replica-patch.yaml
```

---

## Web Apps / Frontend (The Tricky Part)

Frameworks like React, Next.js, and Vite bake `VITE_API_URL` or `NEXT_PUBLIC_*` into the JavaScript bundle at **build time**. Using different env vars per environment produces different bundles — violating the build-once principle.

The solution is to **defer config loading to runtime**.

### Solution 1: Runtime Config File (Recommended)

Instead of `VITE_API_URL`, serve a plain static `config.js` file that contains placeholders. Replace those placeholders with real values when the container starts — not at build time.

```javascript
// public/config.js — served as a static file, NOT processed by Vite
window.__ENV__ = {
  API_URL: "__API_URL_PLACEHOLDER__",
  FEATURE_X: "__FEATURE_X_PLACEHOLDER__",
};
```

```html
<!-- index.html — load config before the app bundle -->
<script src="/config.js"></script>
<script type="module" src="/main.js"></script>
```

```javascript
// In your React/Vue app — read from window, not process.env
const config = window.__ENV__;
fetch(`${config.API_URL}/users`);
```

The Dockerfile uses an entrypoint script to substitute the placeholders at container startup:

```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
COPY docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
```

```bash
#!/bin/sh
# docker-entrypoint.sh — runs at container START, substitutes real values
sed -i "s|__API_URL_PLACEHOLDER__|${API_URL}|g" /usr/share/nginx/html/config.js
sed -i "s|__FEATURE_X_PLACEHOLDER__|${FEATURE_X}|g" /usr/share/nginx/html/config.js
exec "$@"
```

The Kubernetes deployment then injects the environment-specific values:

```yaml
env:
  - name: API_URL
    value: "https://api.prod.example.com"
  - name: FEATURE_X
    value: "true"
```

### Solution 2: Config Endpoint (API-driven)

The frontend fetches its config from the backend at startup. The backend reads its own env vars and returns the appropriate config.

```javascript
async function loadConfig() {
  const res = await fetch('/api/config');
  return res.json();
  // Returns: { apiUrl: "https://api.prod.example.com", featureX: true }
}

loadConfig().then(config => {
  ReactDOM.render(<App config={config} />, root);
});
```

This works well for SSR apps (e.g., Next.js `getServerSideProps`).

### Solution 3: Next.js `publicRuntimeConfig`

```javascript
// next.config.js — reads env vars at SERVER STARTUP, not build time
module.exports = {
  publicRuntimeConfig: {
    apiUrl: process.env.API_URL,
    featureX: process.env.FEATURE_X,
  },
};

// In components
import getConfig from 'next/config';
const { publicRuntimeConfig } = getConfig();
fetch(`${publicRuntimeConfig.apiUrl}/users`);
```

> [!WARNING]
> This requires Next.js server mode (not static export). For static export, use Solution 1.

---

## What Must NEVER Be Baked Into the Artifact

The following values are environment-specific and must always be injected at runtime:

- ❌ API URLs and backend endpoints
- ❌ Database connection strings
- ❌ Secrets, API keys, and tokens
- ❌ Feature flag values
- ❌ Environment name (dev / staging / prod)
- ❌ Log levels or debug flags
- ❌ Third-party service URLs (analytics, payment gateways)

These are safe to bake in at build time because they don't change between environments:

- ✅ Application code and business logic
- ✅ UI components, styles, and static assets
- ✅ Package dependencies
- ✅ Build-time optimizations (minification, tree-shaking)

---

## Summary

| App Type | Artifact | Config Injection Method |
|---|---|---|
| Backend (Java, Go, Node) | Docker image | Env vars / ConfigMaps / Vault at runtime |
| Frontend SPA (React, Vue) | Docker image (nginx + static) | Entrypoint script replaces placeholders in `config.js` |
| Frontend SPA (S3 + CDN) | Zip / tarball of static files | CI replaces `config.js` per environment before upload |
| SSR App (Next.js) | Docker image | `publicRuntimeConfig` or env vars at server start |
| Mobile App | APK / IPA binary | Config fetched from remote endpoint at app launch |
| Helm Chart | Chart package | `values-{env}.yaml` files per environment |
