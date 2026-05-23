# Cloud Security Best Practices Cheatsheet

> ## 📌 Quick Summary — Top Best Practices to Remember
>
> 1. **Zero Trust** — never trust, always verify; authenticate and authorize every request regardless of network location
> 2. **Least privilege everywhere** — minimal permissions for users, services, and CI/CD; use just-in-time access for admin tasks
> 3. **Encrypt everything** — TLS 1.2+ in transit, KMS-managed keys at rest; mTLS for service-to-service communication
> 4. **Shift left security** — SAST, SCA, secret scanning, image scanning, and IaC scanning in every CI pipeline
> 5. **Never store secrets in code or env vars** — use Vault, AWS Secrets Manager, or External Secrets Operator; auto-rotate credentials
> 6. **Defense in depth** — multiple security layers: identity → network → compute → data → application; no single control is enough
> 7. **Audit everything** — CloudTrail, audit logs, and immutable log archives; centralize in a dedicated security account
> 8. **Automate incident response** — detect with GuardDuty/Falco, respond with EventBridge+Lambda, contain before investigating
> 9. **Secure the software supply chain** — sign images (cosign/Sigstore), generate SBOMs, enforce admission policies (OPA/Kyverno)
> 10. **Assume breach** — segment networks, limit blast radius, practice incident response with GameDays; prepare for when, not if

---

## 1. Core Philosophy

- **Defense in depth** — no single security control is sufficient; layer them
- **Zero Trust** — verify every request; network location does not grant trust
- **Least privilege** — minimum permissions needed, for the shortest time possible
- **Shift left** — integrate security at the earliest stage (design, code, CI/CD)
- **Assume breach** — design systems to limit blast radius when compromise occurs
- **Automate security** — manual security processes don't scale; policy-as-code
- **Immutability** — immutable infrastructure reduces attack surface; replace, don't patch
- **Visibility first** — you can't protect what you can't see; observe everything

---

## 2. Identity & Access Management (IAM)

### Core Principles

```
Never trust:
  ✗ Long-lived access keys (static credentials)
  ✗ Root/admin accounts for day-to-day work
  ✗ Shared accounts or credentials
  ✗ Wide-open permissions ("Action: *", "Resource: *")

Always use:
  ✓ IAM roles with temporary credentials (STS)
  ✓ OIDC federation for CI/CD (GitHub Actions, GitLab CI)
  ✓ SSO / IAM Identity Center for human access
  ✓ MFA everywhere — especially for privileged actions
  ✓ Service accounts per application (K8s, cloud)
```

### Least Privilege Implementation

```
Step 1: Start with zero permissions
Step 2: Grant only what's needed for the specific task
Step 3: Scope to specific resources (not *)
Step 4: Add conditions (IP, MFA, time, tags)
Step 5: Review regularly (Access Analyzer, Access Advisor)
Step 6: Revoke unused permissions (90-day unused = remove)
```

### Privileged Access Management (PAM)

| Practice | Implementation |
|---|---|
| **Just-In-Time (JIT) access** | Request → approve → temporary role → auto-expire |
| **Break-glass procedures** | Emergency access with full audit trail + forced review |
| **Session recording** | Record all privileged sessions (SSM Session Manager) |
| **No standing admin access** | Admins assume roles temporarily; no persistent privilege |
| **Separation of duties** | Person who deploys ≠ person who approves for prod |

### RBAC vs ABAC

```
RBAC (Role-Based Access Control):
  User → Role → Permissions
  ✓ Simple, well-understood
  ✗ Role explosion at scale (dev-team-a-read-s3-bucket-x)

ABAC (Attribute-Based Access Control):
  User (tags) + Resource (tags) → Policy evaluates dynamically
  ✓ Scales well; one policy covers many users/resources
  ✗ Harder to audit; requires consistent tagging

AWS Example (ABAC):
  "Allow S3 access if user tag 'Team' matches bucket tag 'Team'"
  → One policy works for all teams; no per-team roles needed
```

---

## 3. Network Security

### Defense in Depth (Network Layers)

```
Layer 1: Edge Protection
  → WAF (OWASP Top 10, rate limiting, IP blocking)
  → DDoS protection (AWS Shield, Cloudflare)
  → CDN (CloudFront — cache + protect origin)

Layer 2: Perimeter
  → VPC isolation; private subnets by default
  → NAT Gateway for egress only; no direct inbound
  → VPN / Direct Connect for on-premises connectivity

Layer 3: Network Segmentation
  → Security Groups (stateful, per-instance/ENI)
  → NACLs (stateless, per-subnet — broad deny rules)
  → Separate subnets: public / private / data

Layer 4: Service-to-Service
  → mTLS via service mesh (Istio, Linkerd, Cilium)
  → K8s NetworkPolicies (default deny, explicit allow)
  → VPC Endpoints (keep AWS API traffic off internet)

Layer 5: Application
  → Input validation, parameterized queries
  → CORS, CSP, HSTS headers
  → Rate limiting per API key / user
```

### VPC Security Best Practices

```
✓ No public IPs on EC2 — use ALB + NAT GW
✓ One NAT GW per AZ (HA + avoid cross-AZ cost)
✓ VPC Flow Logs enabled → S3 / CloudWatch for analysis
✓ DNS Firewall — block malicious domain resolution
✓ Security Groups reference other SGs, not CIDR (chain: ALB-SG → App-SG → DB-SG)
✓ Never open 0.0.0.0/0 on port 22/3389 — use SSM Session Manager
✓ VPC Endpoints for S3, DynamoDB, STS, SSM, ECR, CloudWatch
✓ Private hosted zones for internal DNS
```

### Kubernetes Network Security

```yaml
# Default deny all ingress traffic
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: app-prod
spec:
  podSelector: {}      # Applies to all pods in namespace
  policyTypes:
    - Ingress
```

```yaml
# Then explicitly allow required traffic
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: app-prod
spec:
  podSelector:
    matchLabels:
      app: backend
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - port: 8080
  policyTypes:
    - Ingress
```

- **Default deny** → explicitly allow — zero-trust within the cluster
- CNI must support NetworkPolicy: **Calico, Cilium, Weave**
- Use **Cilium** for L7 (HTTP/gRPC) network policies and eBPF observability
- Consider **service mesh** (Istio/Linkerd) for mTLS + authorization policies

---

## 4. Data Protection

### Encryption Strategy

```
In Transit:
  → TLS 1.2 minimum; TLS 1.3 preferred
  → mTLS for service-to-service (service mesh or application-level)
  → Enforce SSL on databases (rds.force_ssl = 1)
  → HTTPS-only on load balancers; redirect HTTP → HTTPS
  → HSTS header on all web responses

At Rest:
  → S3: SSE-KMS with customer-managed keys (CMK) for sensitive data
  → RDS/Aurora: encryption enabled at creation (cannot add later!)
  → EBS: encrypted volumes (default encryption per account)
  → DynamoDB: encrypted by default; use CMK for sensitive tables
  → Secrets: Vault / AWS Secrets Manager (never plaintext)

Key Management:
  → Use managed KMS (AWS KMS, GCP Cloud KMS)
  → Separate keys per environment + data classification
  → Enable automatic key rotation (yearly at minimum)
  → Audit key usage via CloudTrail
  → Key policy: only specific roles/services can use decrypt
```

### Data Classification

| Level | Examples | Controls |
|---|---|---|
| **Public** | Marketing content, docs | No special protection |
| **Internal** | Internal wikis, arch docs | Access control, no public sharing |
| **Confidential** | Customer data, PII | Encryption, RBAC, audit logging, masking |
| **Restricted** | Credentials, payment data, PHI | CMK encryption, strict RBAC, MFA, monitoring |

### Secrets Management

```
Hierarchy of secret management (worst → best):

  ❌ Hardcoded in source code
  ❌ Environment variables baked into image/container
  ❌ .env files committed to Git
  ❌ Plain SSM Parameter Store
  ⚠️ Encrypted SSM SecureString (okay for non-critical)
  ✓ AWS Secrets Manager (auto-rotation, audit, cross-account)
  ✓ HashiCorp Vault (dynamic secrets, leases, fine-grained policies)
  ✓ External Secrets Operator (K8s — syncs from Vault/AWS/GCP)
```

### Secret Rotation

```
Automated Rotation (preferred):
  Secrets Manager → Lambda rotator → updates DB password → updates secret
  → Applications fetch latest on next call; no redeployment needed

Rotation cadence:
  Database credentials  → every 30-90 days
  API keys              → every 90 days
  TLS certificates      → auto-renew via cert-manager / ACM
  SSH keys              → eliminate; use SSM Session Manager instead
  Service account tokens → short-lived (hours); OIDC where possible
```

---

## 5. Container & Kubernetes Security

### Image Security

```
Build Phase:
  → Use minimal base images (distroless, Alpine, scratch)
  → Pin image tags to digest (sha256), not :latest
  → Multi-stage builds — dev tools not in production image
  → Run as non-root user (USER 1000 in Dockerfile)
  → No secrets in image layers (use build secrets, not ARG/ENV)

Scan Phase:
  → Scan in CI: Trivy, Grype, Snyk Container
  → Block HIGH/CRITICAL CVEs from deploying
  → Generate SBOM: syft, trivy sbom
  → Scan for leaked secrets: TruffleHog, gitleaks

Registry:
  → Private registries only (ECR, GCR, ACR, Harbor)
  → Enable image scanning on push (ECR native / Trivy)
  → Image retention policy — clean up old tags
  → Sign images: cosign (Sigstore) / Docker Content Trust
```

### Pod Security (Kubernetes)

```yaml
# Secure container spec — apply to ALL production containers
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  seccompProfile:
    type: RuntimeDefault
```

```yaml
# Pod Security Admission — enforce at namespace level
apiVersion: v1
kind: Namespace
metadata:
  name: app-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
```

| PSA Level | Description |
|---|---|
| Privileged | No restrictions — system pods only |
| Baseline | Prevents known privilege escalations |
| Restricted | Hardened — non-root, no host access, drop caps |

### Admission Control (Policy Enforcement)

```
Tools: OPA/Gatekeeper, Kyverno, Kubewarden

Common policies to enforce:
  → Block :latest image tag
  → Require resource requests/limits
  → Require non-root containers
  → Block privileged containers
  → Require approved image registries only
  → Enforce labels (team, environment, app)
  → Block hostPath volumes
  → Block hostNetwork/hostPID
  → Require readOnlyRootFilesystem
```

### Runtime Security

| Tool | Purpose |
|---|---|
| **Falco** | Runtime threat detection (syscall monitoring) |
| **Tetragon** | eBPF-based observability + enforcement (Cilium) |
| **GuardDuty EKS** | AWS-managed threat detection for EKS |
| **Sysdig** | Commercial runtime security + forensics |

- Alert on: unexpected processes, shell spawned in container, sensitive file access
- Use **read-only root filesystem** — mount writable paths explicitly
- Use **seccomp profiles** — restrict system calls to known-good set
- **No SSH/exec into production containers** — debug with ephemeral containers

---

## 6. CI/CD Pipeline Security (DevSecOps)

### Security Gates in Pipeline

```
Code Push
  → Secret Detection      (TruffleHog, gitleaks, detect-secrets)
  → SAST                  (SonarQube, Semgrep, CodeQL)
  → SCA / Dependency Scan (Snyk, Dependabot, OWASP Dep-Check)
  → IaC Scan              (Checkov, tfsec, KICS, Terrascan)
  → License Compliance    (FOSSA, Snyk)

Build
  → Container Image Scan  (Trivy, Grype, Snyk Container)
  → SBOM Generation       (syft, trivy sbom)
  → Image Signing         (cosign / Sigstore)

Pre-Deploy
  → Admission Policies    (OPA/Gatekeeper, Kyverno)
  → DAST                  (OWASP ZAP, Burp Suite — on staging)
  → Manifest Validation   (kubeval, kubeconform)

Post-Deploy
  → Runtime Scanning      (Falco, GuardDuty, Inspector)
  → Penetration Testing   (scheduled; HackerOne, Bugcrowd)
  → Compliance Audit      (AWS Config, Security Hub)
```

### Pipeline Security Hardening

```
Runner Security:
  → Use ephemeral/self-hosted runners — no shared state between jobs
  → Pin action versions to SHA (not @v4, use @sha256:...)
  → Limit runner permissions — only what the job needs
  → Separate runners for prod deploy (isolated, restricted)

Credential Security:
  → OIDC federation for cloud providers (no static keys)
  → Short-lived tokens scoped to the job
  → Never log credentials — mask in CI output
  → Separate secrets for dev/staging/prod

Supply Chain:
  → Verify dependency checksums (lockfiles committed)
  → Use private registries / mirrors for dependencies
  → Audit dependency updates before merging (Renovate, Dependabot)
  → SLSA framework for build provenance
```

### SLSA (Supply Chain Levels for Software Artifacts)

| Level | Requirements |
|---|---|
| SLSA 1 | Build process documented |
| SLSA 2 | Hosted build service; version-controlled |
| SLSA 3 | Source and build verifiable; isolated builders |
| SLSA 4 | Hermetic, reproducible builds; two-party review |

---

## 7. Logging, Monitoring & Detection

### Security Logging — What to Capture

```
Authentication:
  → Successful and failed login attempts
  → MFA usage and bypass
  → Token issuance and revocation

Authorization:
  → Access denied events (IAM, RBAC, NetworkPolicy)
  → Privilege escalation attempts
  → Cross-account/cross-namespace access

Data Access:
  → S3 data events (GetObject, PutObject, DeleteObject)
  → Database query logging (sensitive tables)
  → Secret access (Vault audit log, Secrets Manager)

Infrastructure:
  → CloudTrail (all API calls — management + data events)
  → VPC Flow Logs (network traffic metadata)
  → DNS query logs (Route 53 Resolver)
  → K8s audit logs (API server)
```

### Threat Detection Services

| Service | What It Detects |
|---|---|
| **GuardDuty** | Compromised instances, credential abuse, crypto mining |
| **Security Hub** | Aggregated findings from GuardDuty, Inspector, Macie, Config |
| **Inspector** | CVEs in EC2, Lambda, ECR images |
| **Macie** | PII/sensitive data exposure in S3 |
| **AWS Config** | Resource compliance (encryption enabled? S3 public?) |
| **IAM Access Analyzer** | Resources shared with external accounts/public |
| **Falco** | Runtime anomalies in K8s (shell in container, unexpected mount) |

### Critical Alerts to Set Up

```
Identity:
  → Root account login (any usage = incident)
  → IAM policy changes (new admin, broad permissions)
  → Failed authentication spike

Network:
  → Security group opened to 0.0.0.0/0
  → Unusual traffic spikes or new destination IPs
  → WAF rule matches (SQL injection, XSS attempts)

Data:
  → S3 bucket policy changed to public
  → S3 bucket encryption disabled
  → Unusual data transfer volume (potential exfiltration)

Compute:
  → EC2 instance launched in unused region
  → Privileged container started in K8s
  → Crypto mining detected (GuardDuty)
```

---

## 8. Incident Response

### Response Framework (NIST)

```
1. Identify
   → Detect anomaly via alerts, GuardDuty findings, user reports
   → Triage severity; assign Incident Commander
   → Open incident ticket; start timeline

2. Contain
   → Isolate compromised resource IMMEDIATELY
   → Revoke leaked credentials / rotate secrets
   → Block malicious IPs / network segments
   → Don't terminate instances yet — preserve evidence

3. Eradicate
   → Remove malware, backdoors, unauthorized access
   → Patch vulnerability that allowed the breach
   → Rotate ALL potentially compromised credentials

4. Recover
   → Restore from clean backups / rebuild from IaC
   → Re-deploy from trusted artifacts
   → Gradually restore traffic with monitoring

5. Learn
   → Blameless post-mortem within 48 hours
   → Document timeline, impact, root cause, remediation
   → Update runbooks and detection rules
```

### AWS Containment Actions (Quick Reference)

```bash
# Revoke compromised IAM credentials immediately
aws iam update-access-key --access-key-id AKIA... --status Inactive --user-name compromised-user

# Isolate compromised EC2 instance
# 1. Create forensic security group (no ingress/egress)
aws ec2 create-security-group --group-name forensic-isolate \
  --description "No traffic" --vpc-id vpc-xxx
# 2. Replace all SGs on instance with isolation SG
aws ec2 modify-instance-attribute --instance-id i-xxx --groups sg-forensic-isolate
# 3. Snapshot EBS volumes for forensic analysis
aws ec2 create-snapshot --volume-id vol-xxx --description "Forensic snapshot"
```

---

## 9. Compliance & Governance

### Common Compliance Frameworks

| Framework | Focus | Key Requirements |
|---|---|---|
| **SOC 2** | Security, availability | Access control, logging, encryption, incident response |
| **PCI-DSS** | Payment card data | Network segmentation, encryption, vulnerability mgmt |
| **HIPAA** | Healthcare data (PHI) | Encryption, access control, audit trails, BAA required |
| **GDPR** | EU personal data | Consent, right to erasure, data minimization |
| **ISO 27001** | Info security mgmt | ISMS, risk assessment, continuous improvement |
| **CIS Benchmarks** | Config hardening | Specific technical controls per service/OS |

### Policy-as-Code

```
Tools:
  → AWS SCP (Organization-level guardrails)
  → AWS Config Rules (resource compliance checks)
  → OPA/Rego (Kubernetes admission + general policy)
  → Sentinel (Terraform Enterprise policy)
  → Kyverno (Kubernetes-native policy engine)
  → Checkov / tfsec (IaC scanning in CI)

Approach:
  → Define policies as code in Git (version-controlled, reviewed)
  → Enforce at multiple layers:
      CI pipeline → IaC policies (Checkov, Sentinel)
      Admission   → K8s policies (OPA, Kyverno)
      Runtime     → AWS Config, GuardDuty
  → Continuous compliance, not periodic audits
```

---

## 10. OWASP Top 10 (Quick Reference)

| # | Vulnerability | Mitigation |
|---|---|---|
| 1 | **Broken Access Control** | RBAC, server-side enforcement, deny by default |
| 2 | **Cryptographic Failures** | TLS everywhere, KMS for keys, no MD5/SHA1 |
| 3 | **Injection** | Parameterized queries, input validation, ORMs |
| 4 | **Insecure Design** | Threat modeling (STRIDE), secure design patterns |
| 5 | **Security Misconfiguration** | CIS benchmarks, IaC scanning, automated hardening |
| 6 | **Vulnerable Components** | SCA scanning (Snyk, Dependabot), update deps |
| 7 | **Auth & Session Failures** | MFA, session timeout, secure cookie flags |
| 8 | **Software Integrity Failures** | Code signing, SBOM, CI/CD pipeline security |
| 9 | **Logging Failures** | Structured logging, SIEM, alert on auth failures |
| 10 | **SSRF** | Allow-list URLs, IMDSv2 on EC2, validate redirects |

---

## 11. Supply Chain Security

### Software Bill of Materials (SBOM)

```
Generate:
  → syft <image>                    # From container image
  → trivy image --format spdx      # SPDX format
  → trivy image --format cyclonedx  # CycloneDX format

Store & Track:
  → Attach SBOM to container image (cosign attest)
  → Monitor for new CVEs against SBOM components
```

### Image Signing & Verification

```bash
# Sign image with cosign (Sigstore)
cosign sign --key cosign.key myregistry/myapp:v1.2.3

# Verify signature before deploy
cosign verify --key cosign.pub myregistry/myapp:v1.2.3

# Keyless signing (recommended — ephemeral keys via OIDC)
cosign sign myregistry/myapp:v1.2.3    # Uses Fulcio + Rekor
```

---

## 12. Security Tooling Summary

| Category | Tools |
|---|---|
| **SAST** | SonarQube, Semgrep, CodeQL, Checkmarx |
| **SCA** | Snyk, Dependabot, OWASP Dep-Check, Renovate |
| **Secret Detection** | TruffleHog, gitleaks, detect-secrets |
| **Container Scan** | Trivy, Grype, Snyk Container, Clair |
| **IaC Scanning** | Checkov, tfsec, KICS, Terrascan |
| **DAST** | OWASP ZAP, Burp Suite, Nuclei |
| **Image Signing** | cosign (Sigstore), Docker Content Trust |
| **SBOM** | syft, trivy, cyclonedx-cli |
| **Runtime Security** | Falco, Tetragon, Sysdig, GuardDuty |
| **Policy Engine** | OPA/Gatekeeper, Kyverno, Sentinel |
| **SIEM** | Splunk, Elastic SIEM, AWS Security Lake |

---

## 13. Common Anti-Patterns to Avoid

- ❌ Using root/admin accounts for automation or day-to-day work
- ❌ Long-lived access keys in CI/CD or application code
- ❌ Overly permissive IAM policies (`"Action": "*"`, `"Resource": "*"`)
- ❌ Secrets in environment variables baked into container images
- ❌ No encryption at rest on databases, S3, or EBS
- ❌ Security groups open to 0.0.0.0/0 on SSH/RDP
- ❌ No MFA on human accounts (especially admins)
- ❌ CloudTrail disabled or only in one region
- ❌ GuardDuty not enabled (it's off by default!)
- ❌ No image scanning — deploying containers with known CVEs
- ❌ No network segmentation — flat network, any pod/service talks to any
- ❌ Logging secrets, tokens, or PII in application logs
- ❌ No incident response plan — figuring it out during the incident
- ❌ Manual security reviews instead of automated policy-as-code
- ❌ Treating security as a phase instead of a continuous practice
- ❌ No SBOM or image signatures — unknown software provenance
- ❌ Shared credentials across environments (same password in dev and prod)

---

*Good luck with the interview!*
