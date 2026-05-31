# Lab 15 — Production-Ready Platform: Security, Observability & Multi-Tenancy


## 🎯 Objectives

By the end of this lab, you will:

- Implement RBAC and multi-tenancy with Argo CD Projects
- Configure Crossplane RBAC with namespace-scoped claims
- Set up Backstage permission framework
- Deploy observability stack: Prometheus + Grafana for platform metrics
- Implement secret management with External Secrets Operator
- Apply cost governance and policy enforcement
- Understand the platform maturity model

---

## 📋 Prerequisites

- Completed **Lab 14** (full IDP integration)
- All three tools running (Argo CD, Crossplane, Backstage)

---

## 🏗️ Architecture — Production Considerations

### 🔒 Security
- Strict **RBAC** models limiting namespaces.
- **Network Policies** isolating team environments.
- Automated **Secret Management** (Vault + External Secrets Operator).
- Detailed **Audit Logs** and **mTLS** for inter-service communication.

### 📊 Observability
- Cluster-wide **Prometheus** metrics collection.
- Curated **Grafana** visualization dashboards.
- Dynamic slack/mail **Alerting** configurations.
- Actionable service **SLOs & SLIs**.

### ⚖️ Governance
- Strict namespace **Resource Quotas**.
- Mandated **Cost Tags** for department billing.
- Continuous **Policy Enforcement** (OPA/Kyverno).
- Standardized **Compliance Checks** and change gates.

### 👥 Multi-Tenancy & Operations
- Logical **Team Spaces** isolation.
- Multi-cluster **High Availability** setups.
- Automated **Backup/DR** pipelines.
- Transparent **FinOps Billing** allocations.

---

## 🔬 Hands-On Exercises

### Exercise 1: Argo CD Multi-Tenancy with Projects

```bash
# Create team-specific Argo CD Projects with strict boundaries

# Backend Team Project
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: backend-team
  namespace: argocd
spec:
  description: Backend Team Applications
  
  # Only allow deployments from specific repos
  sourceRepos:
    - "https://github.com/myorg/backend-*"
    - "https://github.com/argoproj/argocd-example-apps.git"
  
  # Restrict which namespaces the team can deploy to
  destinations:
    - namespace: 'backend-*'
      server: https://kubernetes.default.svc
    - namespace: 'platform-dev'
      server: https://kubernetes.default.svc
    - namespace: 'platform-staging'
      server: https://kubernetes.default.svc
  
  # Restrict which cluster resources can be created
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  
  # Restrict which namespaced resources can be created
  namespaceResourceWhitelist:
    - group: ""
      kind: "*"
    - group: "apps"
      kind: "*"
    - group: "networking.k8s.io"
      kind: "*"
  
  # Deny specific resources
  namespaceResourceBlacklist:
    - group: ""
      kind: ResourceQuota  # Only platform team can set quotas
    - group: "rbac.authorization.k8s.io"
      kind: "*"            # No RBAC changes
  
  # Sync windows — no deploys to prod on weekends
  syncWindows:
    - kind: deny
      schedule: "0 0 * * 6-0"  # Weekends
      duration: 48h
      namespaces: ["backend-prod-*"]
      
  # Role definitions
  roles:
    - name: developer
      description: Backend developer access
      policies:
        - p, proj:backend-team:developer, applications, get, backend-team/*, allow
        - p, proj:backend-team:developer, applications, sync, backend-team/*, allow
      groups:
        - backend-team
    - name: admin
      description: Backend team admin
      policies:
        - p, proj:backend-team:admin, applications, *, backend-team/*, allow
      groups:
        - backend-team-leads
EOF

# Frontend Team Project (more restricted)
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: frontend-team
  namespace: argocd
spec:
  description: Frontend Team Applications
  sourceRepos:
    - "https://github.com/myorg/frontend-*"
    - "https://github.com/argoproj/argocd-example-apps.git"
  destinations:
    - namespace: 'frontend-*'
      server: https://kubernetes.default.svc
    - namespace: 'platform-dev'
      server: https://kubernetes.default.svc
  clusterResourceWhitelist: []  # No cluster resources allowed
  namespaceResourceWhitelist:
    - group: ""
      kind: Service
    - group: ""
      kind: ConfigMap
    - group: "apps"
      kind: Deployment
EOF

# Platform Team Project (full access)
cat <<'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: platform-team
  namespace: argocd
spec:
  description: Platform Team - Full Infrastructure Access
  sourceRepos: ["*"]
  destinations:
    - namespace: "*"
      server: "*"
  clusterResourceWhitelist:
    - group: "*"
      kind: "*"
  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"
EOF

echo "=== Argo CD Projects ==="
argocd proj list 2>/dev/null || kubectl get appprojects -n argocd
```

### Exercise 2: Crossplane RBAC for Teams

```bash
# Create RBAC rules so teams can only create claims in their namespaces

# Backend team can create database claims in dev/staging
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: crossplane-claim-creator
  namespace: platform-dev
rules:
  - apiGroups: ["platform.example.com"]
    resources: ["platformappclaims", "databaseclaims"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["configmaps", "secrets"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: backend-team-claims
  namespace: platform-dev
subjects:
  - kind: Group
    name: backend-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: crossplane-claim-creator
  apiGroup: rbac.authorization.k8s.io
EOF

# Production claims require platform-team approval
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: crossplane-claim-viewer
  namespace: platform-prod
rules:
  - apiGroups: ["platform.example.com"]
    resources: ["platformappclaims", "databaseclaims"]
    verbs: ["get", "list", "watch"]  # Read-only in prod!
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: backend-team-prod-viewer
  namespace: platform-prod
subjects:
  - kind: Group
    name: backend-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: crossplane-claim-viewer
  apiGroup: rbac.authorization.k8s.io
EOF

echo "✅ Crossplane RBAC configured"
echo "   Dev/Staging: Teams can create claims"
echo "   Prod: Teams can only view claims"
```

### Exercise 3: Network Policies for Isolation

```bash
# Default deny all traffic between team namespaces
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: platform-dev
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  # Deny all by default
  ingress: []
  egress:
    # Allow DNS
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
# Allow traffic within the same namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: platform-dev
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector: {}
---
# Allow traffic from ingress controller
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress
  namespace: platform-dev
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-system
EOF

echo "✅ Network policies applied"
```

### Exercise 4: Deploy Observability Stack

```bash
# Deploy Prometheus + Grafana for platform monitoring
cat <<'EOF' | kubectl apply -f -
apiVersion: helm.crossplane.io/v1beta1
kind: Release
metadata:
  name: platform-monitoring
spec:
  providerConfigRef:
    name: helm-provider
  forProvider:
    chart:
      name: kube-prometheus-stack
      repository: https://prometheus-community.github.io/helm-charts
      version: "55.5.0"
    namespace: platform-monitoring
    values:
      prometheus:
        prometheusSpec:
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
          retention: 24h
          serviceMonitorSelectorNilUsesHelmValues: false
      grafana:
        enabled: true
        adminPassword: "PlatformAdmin123!"
        resources:
          requests:
            cpu: 50m
            memory: 128Mi
        dashboardProviders:
          dashboardproviders.yaml:
            apiVersion: 1
            providers:
              - name: default
                folder: Platform
                type: file
                options:
                  path: /var/lib/grafana/dashboards/default
      alertmanager:
        enabled: false
      nodeExporter:
        enabled: true
EOF

echo "⏳ Deploying monitoring stack (2-3 minutes)..."
sleep 30
kubectl get release platform-monitoring

# Wait for pods
kubectl wait --for=condition=Ready release/platform-monitoring --timeout=300s 2>/dev/null || \
  echo "Still deploying... check: kubectl get pods -n platform-monitoring"
```

### Exercise 5: Create Platform Alerts

```bash
# Create PrometheusRule for platform alerts
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: platform-alerts
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: platform-alerts-config
        namespace: platform-monitoring
      data:
        alerts.yaml: |
          groups:
            - name: platform.rules
              rules:
                - alert: HighPodRestartRate
                  expr: rate(kube_pod_container_status_restarts_total[15m]) > 0.1
                  for: 5m
                  labels:
                    severity: warning
                    team: platform
                  annotations:
                    summary: "Pod {{ $labels.pod }} is restarting frequently"
                
                - alert: NamespaceQuotaExceeded80Percent
                  expr: >
                    kube_resourcequota{type="used"} / 
                    kube_resourcequota{type="hard"} > 0.8
                  for: 5m
                  labels:
                    severity: warning
                  annotations:
                    summary: "Namespace {{ $labels.namespace }} is using >80% of quota"
                
                - alert: CrossplaneManagedResourceNotReady
                  expr: kube_customresource_status_condition{type="Ready",status="False"} == 1
                  for: 10m
                  labels:
                    severity: critical
                    team: platform
                  annotations:
                    summary: "Crossplane resource not ready for >10min"
EOF

echo "✅ Platform alerts configured"
```

### Exercise 6: Secret Management Pattern

```bash
# Demonstrate secret management with Kubernetes secrets
# In production, use External Secrets Operator with Vault/AWS Secrets Manager

# Create a sealed/managed secret pattern
cat <<'EOF' | kubectl apply -f -
apiVersion: kubernetes.crossplane.io/v1alpha2
kind: Object
metadata:
  name: managed-secret-pattern
spec:
  providerConfigRef:
    name: kubernetes-provider
  forProvider:
    manifest:
      apiVersion: v1
      kind: Secret
      metadata:
        name: app-secrets
        namespace: platform-dev
        labels:
          managed-by: platform-team
          secret-type: application
        annotations:
          description: "Platform-managed application secrets"
      type: Opaque
      data:
        # In production, these would come from External Secrets Operator
        DATABASE_URL: cG9zdGdyZXM6Ly91c2VyOnBhc3NAZGIucGxhdGZvcm0uc3ZjOjU0MzIvYXBwZGI=
        API_KEY: c2stcGxhdGZvcm0tYXBpLWtleS0xMjM0NTY3ODkw
EOF

echo "✅ Secret management pattern configured"
echo ""
echo "Production recommendations:"
echo "  1. Use External Secrets Operator (ESO)"
echo "  2. Store secrets in HashiCorp Vault or AWS Secrets Manager"
echo "  3. ESO syncs external secrets → K8s Secrets automatically"
echo "  4. Rotate secrets via the external provider"
```

### Exercise 7: Cost Governance with Labels and Quotas

```bash
# Enforce cost tracking labels on all namespaces
echo "=== Cost Governance Pattern ==="

for env in dev staging prod; do
  MAX_CPU="2"
  MAX_MEM="4Gi"
  MAX_PODS="20"
  
  case $env in
    dev) MAX_CPU="2"; MAX_MEM="4Gi"; MAX_PODS="20" ;;
    staging) MAX_CPU="4"; MAX_MEM="8Gi"; MAX_PODS="30" ;;
    prod) MAX_CPU="8"; MAX_MEM="16Gi"; MAX_PODS="50" ;;
  esac

  cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: environment-quota
  namespace: platform-${env}
  labels:
    governance: cost-control
spec:
  hard:
    requests.cpu: "${MAX_CPU}"
    requests.memory: "${MAX_MEM}"
    limits.cpu: "$((${MAX_CPU%.*} * 2))"
    limits.memory: "${MAX_MEM}"
    pods: "${MAX_PODS}"
    services: "15"
    persistentvolumeclaims: "10"
EOF
  echo "  ✅ platform-${env}: CPU=${MAX_CPU}, Mem=${MAX_MEM}, Pods=${MAX_PODS}"
done

echo ""
echo "=== Current Quota Usage ==="
for env in dev staging prod; do
  echo "--- platform-${env} ---"
  kubectl describe resourcequota environment-quota -n platform-${env} 2>/dev/null | grep -A 20 "Used" | head -10
done
```

### Exercise 8: Platform Maturity Assessment

```bash
cat <<'MATURITY'
╔══════════════════════════════════════════════════════════════╗
║              PLATFORM MATURITY MODEL                        ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Level 1: PROVISIONAL (Labs 01-04)               ✅ Done    ║
║  ─────────────────────────                                   ║
║  • Kubernetes cluster running                                ║
║  • GitOps with Argo CD                                       ║
║  • Basic CI/CD pipeline                                      ║
║                                                              ║
║  Level 2: OPERATIONAL (Labs 05-09)               ✅ Done    ║
║  ──────────────────────                                      ║
║  • IaC with Crossplane                                       ║
║  • Developer portal (Backstage)                              ║
║  • Software templates for golden paths                       ║
║  • Software catalog populated                                ║
║                                                              ║
║  Level 3: SCALABLE (Labs 10-13)                  ✅ Done    ║
║  ───────────────────                                         ║
║  • GitOps-driven infrastructure                              ║
║  • ApplicationSets for fleet management                      ║
║  • Advanced compositions (tier-based)                        ║
║  • Plugin ecosystem (K8s, ArgoCD, TechDocs)                  ║
║                                                              ║
║  Level 4: OPTIMIZING (Labs 14-15)                ✅ Done    ║
║  ─────────────────────                                       ║
║  • Full self-service IDP                                     ║
║  • Multi-tenancy & RBAC                                      ║
║  • Observability & alerting                                  ║
║  • Cost governance                                           ║
║  • Secret management                                         ║
║                                                              ║
║  Level 5: STRATEGIC (Next Steps)                 🔲 Future   ║
║  ────────────────────                                        ║
║  • Multi-cluster management                                  ║
║  • Service mesh (Istio/Linkerd)                              ║
║  • FinOps integration                                        ║
║  • Compliance automation (OPA/Kyverno)                       ║
║  • AI-assisted operations                                    ║
║  • Platform-as-a-Product metrics                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
MATURITY
```

---

## ✅ Final Verification — Complete Platform Health Check

```bash
echo "╔══════════════════════════════════════════════════════╗"
echo "║      COMPLETE PLATFORM HEALTH CHECK                  ║"
echo "╠══════════════════════════════════════════════════════╣"

echo "║"
echo "║  🔄 ARGO CD"
ARGOCD_PODS=$(kubectl get pods -n argocd --no-headers 2>/dev/null | grep Running | wc -l)
ARGOCD_PROJS=$(kubectl get appprojects -n argocd --no-headers 2>/dev/null | wc -l)
echo "║    Pods: $ARGOCD_PODS running"
echo "║    Projects: $ARGOCD_PROJS configured"

echo "║"
echo "║  ☁️  CROSSPLANE"
CP_PODS=$(kubectl get pods -n crossplane-system --no-headers 2>/dev/null | grep Running | wc -l)
PROVIDERS=$(kubectl get providers --no-headers 2>/dev/null | wc -l)
XRDS=$(kubectl get xrd --no-headers 2>/dev/null | wc -l)
COMPS=$(kubectl get compositions --no-headers 2>/dev/null | wc -l)
echo "║    Pods: $CP_PODS running"
echo "║    Providers: $PROVIDERS installed"
echo "║    XRDs: $XRDS | Compositions: $COMPS"

echo "║"
echo "║  🎭 BACKSTAGE"
BS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "N/A")
echo "║    Frontend: HTTP $BS_STATUS"

echo "║"
echo "║  🔒 SECURITY"
echo "║    RBAC Roles: $(kubectl get roles --all-namespaces --no-headers 2>/dev/null | grep -c crossplane)"
echo "║    Network Policies: $(kubectl get networkpolicies --all-namespaces --no-headers 2>/dev/null | wc -l)"
echo "║    Projects: $ARGOCD_PROJS"

echo "║"
echo "║  📊 OBSERVABILITY"
MON_PODS=$(kubectl get pods -n platform-monitoring --no-headers 2>/dev/null | grep Running | wc -l)
echo "║    Monitoring Pods: $MON_PODS running"

echo "║"
echo "║  💰 GOVERNANCE"
QUOTAS=$(kubectl get resourcequotas --all-namespaces --no-headers 2>/dev/null | wc -l)
echo "║    Resource Quotas: $QUOTAS configured"

echo "║"
echo "╚══════════════════════════════════════════════════════╝"
```

---

## 🧹 Full Cleanup

```bash
echo "=== Full Platform Cleanup ==="

# Delete Crossplane resources
kubectl delete platformappclaims --all --all-namespaces 2>/dev/null
kubectl delete databaseclaims --all --all-namespaces 2>/dev/null
kubectl delete appstackclaims --all --all-namespaces 2>/dev/null
sleep 20

kubectl delete releases --all 2>/dev/null
kubectl delete objects --all 2>/dev/null
kubectl delete compositions --all 2>/dev/null
kubectl delete xrd --all 2>/dev/null
kubectl delete environmentconfigs --all 2>/dev/null

# Delete Argo CD resources
kubectl delete applicationsets --all -n argocd 2>/dev/null
argocd app delete --all --yes 2>/dev/null
kubectl delete appprojects backend-team frontend-team platform-team platform-labs -n argocd --ignore-not-found 2>/dev/null

# Delete namespaces
kubectl delete ns platform-dev platform-staging platform-prod --ignore-not-found 2>/dev/null
kubectl delete ns -l managed-by=crossplane --ignore-not-found 2>/dev/null
kubectl delete ns -l managed-by=platform-idp --ignore-not-found 2>/dev/null
kubectl delete ns platform-monitoring --ignore-not-found 2>/dev/null

# Uninstall tools (optional)
# helm uninstall crossplane -n crossplane-system
# helm uninstall argocd -n argocd
# pkill -f backstage

echo "✅ Cleanup complete!"
```

---

## 📝 Key Takeaways

- **Multi-tenancy** requires RBAC at every layer: Argo CD Projects, K8s RBAC, Crossplane claims
- **Network policies** isolate team workloads by default
- **Observability** is non-negotiable — monitor the platform itself, not just applications
- **Secret management** should use external providers (Vault, AWS SM) via External Secrets Operator
- **Cost governance** uses ResourceQuotas + labels + tier-based compositions
- **Platform maturity** is a journey from Provisional → Strategic
- The platform is a **product** — measure developer satisfaction, provisioning time, and adoption

---

## 🔗 References

- [Argo CD RBAC & Projects](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)
- [Crossplane RBAC](https://docs.crossplane.io/latest/concepts/rbac/)
- [Backstage Permissions](https://backstage.io/docs/permissions/overview)
- [External Secrets Operator](https://external-secrets.io/)
- [Kube-Prometheus Stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack)
- [Platform Engineering Maturity Model](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
- [CNCF Platforms White Paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)

---

## 🎉 Congratulations!

You've completed all 15 labs and built a production-grade Internal Developer Platform from scratch. You now have hands-on experience with:

- **Platform Engineering** concepts and architecture
- **Argo CD** for GitOps continuous delivery
- **Crossplane** for Kubernetes-native Infrastructure as Code
- **Backstage** for developer portal and self-service

### What's Next?

1. **Certifications**: CKA, CKAD, GitOps Certified (Argo)
2. **Advanced Topics**: Service Mesh, FinOps, Policy Engines (OPA/Kyverno)
3. **Community**: Join platformengineering.org, CNCF Slack
4. **Build**: Apply these patterns in your organization — start small, iterate fast
