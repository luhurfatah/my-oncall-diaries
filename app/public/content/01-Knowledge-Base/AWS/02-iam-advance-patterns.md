# AWS IAM — Advanced Patterns, Edge Cases & Design Decisions

> **Scope:** Production IAM patterns for multi-account AWS Organizations environments. Covers permission architecture, role design, federation, and non-obvious behavioral edge cases.

---

## Table of Contents

| Section | Topic |
| :---: | :--- |
| **01** | [IAM Fundamentals — Policy Evaluation Logic](#1-iam-fundamentals--policy-evaluation-logic) |
| **02** | [Permission Boundaries — Blast Radius Containment](#2-permission-boundaries--blast-radius-containment) |
| **03** | [Service Control Policies (SCPs) — Guardrails vs Deny Logic](#3-service-control-policies-scps--guardrails-vs-deny-logic) |
| **04** | [Resource-Based Policies vs Identity-Based — Precedence Rules](#4-resource-based-policies-vs-identity-based--precedence-rules) |
| **05** | [IAM Role Chaining — Limits & Gotchas](#5-iam-role-chaining--limits--gotchas) |
| **06** | [IAM Roles Anywhere — Extending AWS IAM to On-Premises](#6-iam-roles-anywhere--extending-aws-iam-to-on-premises) |
| **07** | [Federated Identity — SAML, OIDC, and AWS SSO (IAM Identity Center)](#7-federated-identity--saml-oidc-and-aws-sso-iam-identity-center) |
| **08** | [Cross-Account Access Patterns](#8-cross-account-access-patterns) |
| **09** | [Secrets Manager vs Parameter Store — Edge Cases & Tradeoffs](#9-secrets-manager-vs-parameter-store--edge-cases--tradeoffs) |
| **10** | [IAM Anti-Patterns & Common Mistakes](#10-iam-anti-patterns--common-mistakes) |

---

## 1. IAM Fundamentals — Policy Evaluation Logic

### The Evaluation Order (Memorize This)

| Order | Policy Layer | Evaluation Logic |
| :---: | :--- | :--- |
| **1** | **Explicit DENY** | Always wins, anywhere in the chain |
| **2** | **Organization SCP** | Must allow (whitelist) or not deny |
| **3** | **Resource-based policy** | Can grant access cross-account |
| **4** | **IAM Permission Boundary** | Caps what identity policies can grant |
| **5** | **Session policy** | Further restricts assumed role sessions |
| **6** | **Identity policy** | The actual Allow statements |

**Default is DENY.** Access is granted only when all applicable layers allow it and none deny it.

### The Key Mental Model

Think of it as **intersections, not unions:**

```
Effective Permission = Identity Policy ∩ Permission Boundary ∩ SCP ∩ Session Policy
```

Adding more Allows to an identity policy does nothing if the permission boundary or SCP doesn't also allow it. This trips up nearly everyone.

### Same-Account vs Cross-Account

**Same account:** Resource-based policy OR identity-based policy — either alone is sufficient (unless a boundary/SCP blocks it).

**Cross-account:** Resource-based policy AND identity-based policy — BOTH must allow. The resource policy must explicitly trust the external account/principal, AND the calling principal's identity policy must allow the action.

```
Account A (caller)                    Account B (resource)
  └── IAM Role: Allow s3:GetObject ──► S3 Bucket Policy: Allow Account A
       (both must exist)
```

---

## 2. Permission Boundaries — Blast Radius Containment

### Concept

A permission boundary is an IAM managed policy attached to a **role or user** that defines the **maximum permissions** that identity can ever have — regardless of what identity policies grant.

```
Identity Policy grants: s3:*, ec2:*, iam:*
Permission Boundary allows: s3:*, ec2:*
Effective permission: s3:*, ec2:*   ← iam:* is silently dropped
```

### Primary Use Case — Delegated Role Creation

Allow developers to create IAM roles for their applications **without being able to escalate their own privileges.**

```json
{
  "Effect": "Allow",
  "Action": ["iam:CreateRole", "iam:AttachRolePolicy"],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "iam:PermissionsBoundary": "arn:aws:iam::123456789:policy/dev-boundary"
    }
  }
}
```

This policy says: *you may create roles, but only if you attach the `dev-boundary` boundary to them.* The dev cannot create a role without a boundary, so any role they create is automatically capped.

### Preventing Boundary Removal

Also add a Deny in the boundary policy itself:

```json
{
  "Effect": "Deny",
  "Action": [
    "iam:DeleteRolePermissionsBoundary",
    "iam:PutRolePermissionsBoundary"
  ],
  "Resource": "*",
  "Condition": {
    "StringNotEquals": {
      "iam:PermissionsBoundary": "arn:aws:iam::123456789:policy/dev-boundary"
    }
  }
}
```

Without this, a developer could simply remove the boundary from any role they own and gain uncapped permissions.

### Edge Cases & Gotchas

- **Boundaries don't apply to resource-based policies.** If an S3 bucket policy grants access directly to a role ARN, that access is NOT filtered by the boundary. Boundaries only restrict identity-based policies.
- **Boundaries apply to the principal, not the action.** A boundary on Role A doesn't affect what Role A can do to Role B (like modifying Role B's policies).
- **Service roles are exempt if created by AWS.** When AWS services create roles on your behalf (e.g., Lambda execution roles via console), boundaries are not automatically applied. You must enforce this via SCP.
- **Boundary must be attached at creation time** for delegated workflows — you cannot add it after the fact without explicit permission.
- **No boundary inheritance.** A boundary on a parent role does not propagate to roles created by that role.

---

## 3. Service Control Policies (SCPs) — Guardrails vs Deny Logic

### What SCPs Are (and Aren't)

- SCPs apply to **all principals in an OU/account** — including the root user of member accounts
- SCPs do **not** grant permissions — they only restrict
- SCPs do **not** apply to the Management (master) account
- SCPs do **not** apply to service-linked roles — AWS services can still do what they need

### SCP Inheritance Model

```
Root (SCP: FullAWSAccess)
  └── OU: Workloads (SCP: DenyLeaveOrg, DenyRootUsage)
        ├── OU: Production (SCP: DenyDelete*, RequireMFA)
        │     └── Account: prod-app-1
        └── OU: Non-Production (SCP: DenyExpensiveServices)
              └── Account: dev-app-1
```

An account inherits **all SCPs from its entire OU path**. Effective permissions = intersection of all SCPs in the hierarchy.

### Whitelist vs Blacklist Model

**Blacklist (recommended):** Start with `FullAWSAccess` at root, add Deny SCPs lower down. Easier to manage — you only document what's forbidden.

**Whitelist:** Remove `FullAWSAccess` and explicitly Allow only what's needed. Very restrictive, operationally heavy. Use only for highly locked-down sandbox or test OUs.

### High-Value SCPs to Always Have

```json
// Prevent leaving the Organization
{
  "Effect": "Deny",
  "Action": "organizations:LeaveOrganization",
  "Resource": "*"
}

// Prevent disabling CloudTrail
{
  "Effect": "Deny",
  "Action": [
    "cloudtrail:DeleteTrail",
    "cloudtrail:StopLogging",
    "cloudtrail:UpdateTrail"
  ],
  "Resource": "*"
}

// Deny root user usage
{
  "Effect": "Deny",
  "Action": "*",
  "Resource": "*",
  "Condition": {
    "StringLike": { "aws:PrincipalArn": "arn:aws:iam::*:root" }
  }
}

// Restrict to approved regions only
{
  "Effect": "Deny",
  "Action": "*",
  "Resource": "*",
  "Condition": {
    "StringNotEquals": {
      "aws:RequestedRegion": ["ap-southeast-1", "ap-southeast-3", "us-east-1"]
    },
    "ArnNotLike": {
      "aws:PrincipalArn": "arn:aws:iam::*:role/PlatformAdmin"
    }
  }
}
```

### Edge Cases & Gotchas

- **Global services ignore region SCPs.** IAM, Route 53, CloudFront, STS, and Support always use `us-east-1` — if you deny all regions except your target, you must exempt these global services explicitly using `NotAction`.
- **SCP does not show up in IAM simulator.** The IAM Policy Simulator does not evaluate SCPs. Always test SCP effects in a sandbox OU first.
- **Deny in SCP cannot be overridden by any policy** — not by admin roles, not by root of member accounts. If you lock yourself out with an SCP, only the management account can fix it.
- **SCPs affect IAM roles assumed cross-account from outside the org.** If an external account assumes a role in your org's account, the SCP still applies to that assumed session.
- **SCP limit:** 5 SCPs per OU/account, 5,120 characters per SCP. For complex environments, consolidate SCPs carefully or use the `aws:PrincipalTag` condition to vary behavior within a single SCP.
- **Service-linked roles bypass SCPs** — critical to understand when SCPs deny broad service actions. AWS-managed SLRs for EKS, RDS, etc. are not restricted.

---

## 4. Resource-Based Policies vs Identity-Based — Precedence Rules

### Key Difference

| | Identity-Based | Resource-Based |
|---|---|---|
| Attached to | IAM user/role/group | AWS resource (S3, KMS, SQS, etc.) |
| Controls | What the principal can do | Who can access this resource |
| Cross-account | Needs resource policy too | Can grant access standalone |
| Services supported | All | S3, KMS, SQS, SNS, Lambda, ECR, Secrets Manager, etc. |

### Cross-Account Access — Both Required (Usually)

```
Account A role wants to read from Account B's S3 bucket:

Account A - Identity Policy:          Account B - Bucket Policy:
Allow s3:GetObject                    Allow Principal: Account A role
  Resource: Account B bucket     +      Action: s3:GetObject
                                         Resource: bucket/*
```

**Exception:** If Account B's bucket policy explicitly grants access to Account A's **root** (`arn:aws:iam::AccountA:root`), all principals in Account A can access it — subject only to their identity policies. This is a common confusion point.

### KMS Key Policy — A Special Case

KMS requires the key policy to explicitly allow the account or principal. Unlike S3, an IAM policy alone is **never sufficient** for KMS — the key policy is mandatory.

```json
// KMS key policy must include this or IAM policies are useless:
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::123456789:root" },
  "Action": "kms:*",
  "Resource": "*"
}
```

Without the root delegation in the key policy, even the account admin cannot use the key — it's a potential lockout scenario.

### Edge Cases & Gotchas

- **S3 Block Public Access overrides bucket policy.** Even if a bucket policy allows public access, Block Public Access settings at account or bucket level will deny it. This is evaluated outside the normal policy evaluation chain.
- **Lambda resource policy for invoking cross-account:** Lambda requires a resource-based policy allowing the invoking principal. This is separate from the Lambda execution role. Both must be correct.
- **ECR repository policy for cross-account pulls:** Without a repo policy allowing the pulling account, the pull fails even if the pulling role has `ecr:*`. Add `ecr:GetAuthorizationToken` to the identity policy too — this is an account-level permission, not repo-scoped.
- **Confused deputy problem:** When service A calls service B on your behalf using a service role, use `aws:SourceArn` and `aws:SourceAccount` conditions in the trust policy to prevent cross-tenant attacks:

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "lambda.amazonaws.com" },
  "Action": "sts:AssumeRole",
  "Condition": {
    "ArnLike": { "aws:SourceArn": "arn:aws:lambda:ap-southeast-1:123456789:function:my-fn" },
    "StringEquals": { "aws:SourceAccount": "123456789" }
  }
}
```

---

## 5. IAM Role Chaining — Limits & Gotchas

### What Is Role Chaining

Role chaining = assuming Role B from Role A (which was itself assumed). Each hop is a new STS `AssumeRole` call.

```
Human/CI ──► AssumeRole ──► Role A ──► AssumeRole ──► Role B ──► AssumeRole ──► Role C
```

### Hard Limits

- **Maximum session duration for chained roles: 1 hour.** This is a hard AWS limit — cannot be changed. Even if Role B has `MaxSessionDuration = 12h`, when assumed via chaining the session is capped at 1 hour.
- **Maximum chaining depth:** No documented hard limit, but each hop adds latency and a new set of credentials to manage.
- **Chaining resets the session duration clock** at each hop.

### When You Hit the 1-Hour Cap

Common scenario: a CI/CD pipeline assumes a deployment role, which then assumes account-specific roles. Long deployments (Terraform, CDK synth) fail at the 1-hour mark with `ExpiredTokenException`.

**Solutions:**
- Re-assume the role periodically (refresh credentials mid-run)
- Flatten the chain — assume the final role directly from the CI principal
- Use `aws sts assume-role` with credential refresh loops in long-running scripts
- For GitHub Actions: use OIDC to assume the final target role directly (no chaining)

### Session Tags and Chaining

Session tags from the original session are **not** automatically propagated through a chain. You must explicitly pass tags at each `AssumeRole` call using `TransitiveTagKeys` if downstream policies rely on tags.

```json
// Trust policy requiring a specific tag to be transitive:
{
  "Condition": {
    "StringEquals": { "aws:RequestedRegion": "${aws:PrincipalTag/allowed-region}" }
  }
}
```

---

## 6. IAM Roles Anywhere — Extending AWS IAM to On-Premises

### Concept

IAM Roles Anywhere allows workloads **outside AWS** (on-prem servers, VMs, containers, CI agents) to obtain temporary AWS credentials using **X.509 certificates** from a trusted Certificate Authority — without long-lived IAM access keys.

```
On-Prem Workload
  └── Has X.509 cert from trusted CA
        └── Calls Roles Anywhere endpoint (public or via PrivateLink)
              └── Presents cert → AWS validates against trust anchor
                    └── Returns temporary STS credentials (1hr default)
                          └── Workload uses credentials normally
```

### Components

| Component | Description |
|---|---|
| **Trust Anchor** | Reference to your CA — AWS Private CA or external CA (e.g., HashiCorp Vault PKI, on-prem CA) |
| **Profile** | Maps cert attributes to IAM roles + sets session duration, managed policies |
| **Role** | Standard IAM role — trust policy must allow `rolesanywhere.amazonaws.com` |

### Trust Policy for Roles Anywhere

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "rolesanywhere.amazonaws.com" },
  "Action": ["sts:AssumeRole", "sts:SetSourceIdentity", "sts:TagSession"],
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:rolesanywhere:ap-southeast-1:123456789:trust-anchor/abc123"
    }
  }
}
```

### Attribute Mapping — Cert Fields to Session Tags

You can map X.509 cert Subject fields to IAM session tags and use them in role policies:

```
Cert Subject CN=server-prod-01 → aws:PrincipalTag/x509Subject/CN = "server-prod-01"
Cert Subject O=production      → aws:PrincipalTag/x509Subject/O  = "production"
```

```json
// Role policy restricting access based on cert org field:
{
  "Condition": {
    "StringEquals": {
      "aws:PrincipalTag/x509Subject/O": "production"
    }
  }
}
```

### Edge Cases & Gotchas

- **Certificate revocation is not automatic.** AWS does not check CRL/OCSP in real time during credential issuance. If a cert is compromised, you must manually disable the profile or trust anchor — revocation alone is insufficient.
- **Session duration max: 1 hour** per credential issuance. For long-running jobs, build credential refresh into your workload.
- **`rolesanywhere-credential-helper`** is the AWS-provided tool to automate credential retrieval and refresh. It writes credentials to the standard AWS credential chain, transparent to SDKs.
- **PrivateLink support:** Roles Anywhere has a VPC endpoint (`rolesanywhere`) — use it for on-prem workloads connecting via Direct Connect to avoid public internet exposure.
- **Profile session policies** can further restrict what a role can do per profile — useful when one role is shared across multiple use cases with different permission subsets.
- **Cannot use with EC2 instance profiles** — Roles Anywhere is explicitly for non-AWS workloads.

---

## 7. Federated Identity — SAML, OIDC, and AWS SSO (IAM Identity Center)

### Overview of Federation Options

| Method | Best For | Token Type | Session Max |
|---|---|---|---|
| **IAM Identity Center (SSO)** | Human users, multi-account | SAML/OIDC internally | 8 hours |
| **SAML 2.0 federation** | Enterprise IdP → AWS console/CLI | SAML assertion | 12 hours |
| **Web Identity / OIDC** | Workloads (GitHub Actions, EKS pods, K8s) | JWT (OIDC token) | 1–12 hours |
| **Cognito** | App user federation, customer-facing | JWT | Configurable |

---

### 7a. IAM Identity Center (AWS SSO)

#### Architecture

```
Corporate IdP (Entra ID / Okta / Google)
  └── SAML/SCIM sync ──► IAM Identity Center
                              ├── Permission Sets (map to IAM roles per account)
                              ├── Account Assignments (user/group → account → permission set)
                              └── AWS Access Portal (single URL for all accounts)
```

#### Permission Sets

A Permission Set is a template that IAM Identity Center deploys as an IAM role in each assigned account. It contains:
- AWS managed policies (e.g., `AdministratorAccess`)
- Inline policy (custom permissions)
- Permission boundary
- Session duration

**Key:** You define permission sets once, assign them to many accounts. IAM Identity Center creates and maintains the roles automatically.

#### SCIM Provisioning

With SCIM, users and groups sync automatically from your IdP to IAM Identity Center:
- User created in Entra ID/Okta → appears in Identity Center within minutes
- User deprovisioned in IdP → access revoked in Identity Center
- Group membership changes → account assignments update automatically

Without SCIM, you manage users manually in Identity Center — painful at scale.

#### Edge Cases & Gotchas

- **Permission Set propagation delay:** After updating a permission set, it takes 1–5 minutes to propagate to all assigned accounts. Do not test immediately after changes.
- **Role name format is fixed:** IAM Identity Center creates roles named `AWSReservedSSO_<PermissionSetName>_<randomsuffix>`. You cannot control the name — factor this into SCPs and resource policies that reference role ARNs (use wildcards).
- **CLI access requires `aws sso login`** or the SSO credential helper. The standard `aws configure` with access keys does not apply. Educate teams on `aws configure sso`.
- **Multi-region Identity Center:** Identity Center is a single-region service. The portal and admin functions are tied to the region you enable it in. Credentials work globally, but the control plane is regional.
- **Delegated administration:** You can delegate Identity Center management to a designated member account (not just management account). Do this — reduces blast radius of management account access.
- **Session duration vs token duration:** The Identity Center session (portal login) and the role session duration are separate. A user can be logged into the portal for 8 hours but the underlying role credentials expire per the permission set's session duration (default 1h, max 12h).

---

### 7b. SAML 2.0 Federation (Direct)

#### How It Works

```
User ──► IdP (Okta/Entra) ──► SAML Assertion ──► AWS STS AssumeRoleWithSAML
                                                        └── Returns temp credentials
```

The SAML assertion contains **attributes** that map to IAM session tags or role selection:

```xml
<!-- IdP sends this attribute to specify which role to assume -->
<Attribute Name="https://aws.amazon.com/SAML/Attributes/Role">
  <AttributeValue>
    arn:aws:iam::123456789:role/SamlAdmins,arn:aws:iam::123456789:saml-provider/MyIdP
  </AttributeValue>
</Attribute>
```

#### Session Tags via SAML

Pass attributes from IdP as IAM session tags for ABAC (Attribute-Based Access Control):

```xml
<Attribute Name="https://aws.amazon.com/SAML/Attributes/PrincipalTag:Department">
  <AttributeValue>Engineering</AttributeValue>
</Attribute>
```

Then scope IAM policies using `aws:PrincipalTag/Department`:
```json
{
  "Condition": {
    "StringEquals": { "aws:PrincipalTag/Department": "Engineering" }
  }
}
```

#### Edge Cases & Gotchas

- **Max session duration:** `AssumeRoleWithSAML` max is 12 hours (if role allows it). Default is 1 hour.
- **SAML assertion validity window:** STS rejects assertions older than 5 minutes. Clock skew between IdP and AWS must be minimal — sync IdP servers with NTP.
- **Role ARN must be in the assertion:** AWS does not guess which role to assume. The IdP must include the `Role` attribute with both the role ARN and the SAML provider ARN.
- **One SAML provider per IdP metadata per account:** If you have multiple IdP environments (prod/staging), create separate SAML providers per account.

---

### 7c. OIDC / Web Identity Federation

#### Use Cases

- **GitHub Actions → AWS:** No stored secrets; GitHub's OIDC provider issues JWT tokens per workflow run
- **EKS Pod Identity / IRSA:** Pods assume IAM roles via projected service account tokens
- **GitLab CI, CircleCI, Bitbucket Pipelines:** Same OIDC pattern

#### GitHub Actions OIDC Setup

```hcl
# Create OIDC provider in AWS
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Role trust policy
data "aws_iam_policy_document" "github_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:your-org/your-repo:*"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}
```

#### Scoping GitHub OIDC Claims

The `sub` claim can be scoped to: repo, branch, environment, PR, or tag:

```
repo:org/repo:*                        # any trigger in repo
repo:org/repo:ref:refs/heads/main      # main branch only
repo:org/repo:environment:production   # GitHub Environment named 'production'
repo:org/repo:pull_request             # PRs only (read-only is safer)
```

**Best practice:** Scope to environment for production deployments. Prevents feature branches from deploying to prod.

#### EKS — IRSA (IAM Roles for Service Accounts)

```
Pod → Projected service account token (JWT) → OIDC Provider (EKS cluster)
   → STS AssumeRoleWithWebIdentity → IAM Role → AWS SDK calls
```

```hcl
# Trust policy for pod service account
data "aws_iam_policy_document" "pod_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.service_account_name}"]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}
```

#### IRSA vs EKS Pod Identity (newer)

| Feature | IRSA | EKS Pod Identity |
|---|---|---|
| Setup | OIDC provider + role trust policy | Pod Identity Agent DaemonSet + association |
| Annotation | Service account annotation | Association object (separate from role trust) |
| Cross-account | Complex | Simpler |
| Role reuse across clusters | One trust policy per cluster OIDC | Single association model |
| Token path | Projected volume | Agent-injected |
| Recommended for new clusters | No | Yes (GA since 2024) |

#### OIDC Edge Cases & Gotchas

- **Thumbprint rotation:** The OIDC provider thumbprint (TLS cert hash) can change when the IdP rotates its TLS certificate. AWS now supports multiple thumbprints — add both old and new during rotation windows.
- **Token expiry for long jobs:** GitHub Actions OIDC tokens are valid for a limited time. For long-running jobs, re-request credentials or use a credential refresher.
- **IRSA token path must be mounted:** Pods need `automountServiceAccountToken: true` and the projected token volume must be present. Some pod specs disable this for security — breaks IRSA silently.
- **EKS cluster OIDC endpoint must be public (by default):** The OIDC discovery document must be reachable by AWS STS for validation. Private endpoint clusters require additional configuration.
- **`aws:FederatedProvider` condition key:** Use this in role trust policies to restrict which OIDC provider can assume the role — prevents cross-provider token abuse:
```json
{
  "Condition": {
    "StringEquals": {
      "aws:FederatedProvider": "arn:aws:iam::123456789:oidc-provider/token.actions.githubusercontent.com"
    }
  }
}
```

---

## 8. Cross-Account Access Patterns

### Hub-and-Spoke Role Assumption

```
CI/CD Account (hub)
  └── Pipeline Role ──► AssumeRole ──► Target Account Role
                                           └── Performs deployment
```

**Target account trust policy:**
```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::CICD_ACCOUNT:role/PipelineRole" },
  "Action": "sts:AssumeRole",
  "Condition": {
    "StringEquals": { "sts:ExternalId": "unique-per-account-secret" }
  }
}
```

**ExternalId** prevents confused deputy attacks when a third party assumes roles across many accounts — each account gets a unique ExternalId that the caller must present.

### ABAC — Attribute-Based Access Control at Scale

Instead of one role per team/project (N roles × M accounts = N×M), use tags to drive access:

```json
// Single role policy — access scoped by tag match
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::*",
  "Condition": {
    "StringEquals": {
      "aws:ResourceTag/Project": "${aws:PrincipalTag/Project}"
    }
  }
}
```

Teams assume one shared role but can only access resources tagged with their own project. Reduces role sprawl dramatically.

### Edge Cases & Gotchas

- **`sts:AssumeRole` must be allowed in the caller's identity policy AND the target's trust policy** — both are required for cross-account.
- **MFA condition on AssumeRole:** You can require MFA for role assumption using `aws:MultiFactorAuthPresent: true` — but this breaks automated pipelines. Scope MFA conditions carefully using `aws:PrincipalTag` to exempt service principals.
- **`sts:TagSession` permission** is required if the caller wants to pass session tags. Without it, the AssumeRole call with tags fails.
- **Session duration on chained cross-account:** Remember the 1-hour cap when chaining (see Section 5).

---

## 9. Secrets Manager vs Parameter Store — Edge Cases & Tradeoffs

### Quick Comparison

| Feature | Secrets Manager | Parameter Store (Standard) | Parameter Store (Advanced) |
|---|---|---|---|
| Cost | $0.40/secret/month + API calls | Free | $0.05/param/month |
| Max value size | 64 KB | 4 KB | 8 KB |
| Automatic rotation | ✅ Built-in (Lambda-based) | ❌ Manual | ❌ Manual |
| Cross-account access | ✅ Resource policy | ❌ (SSM doesn't support resource policies for cross-account natively) | ❌ |
| Versioning | ✅ (stages: AWSCURRENT, AWSPREVIOUS) | ✅ (parameter history) | ✅ |
| KMS encryption | ✅ Default or custom CMK | ✅ SecureString type | ✅ |
| CloudFormation dynamic reference | ✅ | ✅ | ✅ |
| Replication | ✅ Multi-region replication | ❌ | ❌ |
| Use case | Credentials, API keys needing rotation | Config values, feature flags | Larger config, policies |

### When Parameter Store Wins

- Non-sensitive config values (feature flags, environment names, ARNs)
- High-volume reads (no per-API cost) — cache-friendly
- Simple hierarchical config: `/app/prod/db_host`, `/app/prod/db_port`
- When you don't need automatic rotation

### When Secrets Manager Wins

- Database passwords, API keys, OAuth tokens that need **automatic rotation**
- **Cross-account secret sharing** — Secrets Manager supports resource-based policies
- **Multi-region replication** — for DR or latency-sensitive access
- Secrets that Lambda, RDS, or Redshift need to rotate natively

### Rotation Edge Cases

- **Rotation Lambda must be in the same VPC as the database** (or have network access to it). A common mistake is placing the Lambda in a VPC without a route to RDS.
- **During rotation, two versions exist simultaneously** (`AWSCURRENT` and `AWSPENDING`). Applications reading `AWSCURRENT` continue to work. If your app caches credentials, it may use the old version — build in retry logic on auth failure.
- **Single-user vs multi-user rotation:** Single-user rotation briefly makes the secret invalid during rotation. Multi-user rotation (alternating users) provides zero-downtime rotation — use for production databases.
- **Parameter Store SecureString cross-account:** You cannot directly share a SecureString across accounts using resource policies. Workaround: replicate to each account, or use Secrets Manager instead.

### Caching Best Practice

Both services have per-API-call costs at high volume. Use the AWS Secrets Manager caching client:

```python
import boto3
from aws_secretsmanager_caching import SecretCache, SecretCacheConfig

client = boto3.client('secretsmanager')
cache = SecretCache(config=SecretCacheConfig(max_cache_size=1000), client=client)

# Cached — only calls API on cache miss or TTL expiry
secret = cache.get_secret_string('prod/db/password')
```

Default TTL is 1 hour. Balance freshness vs API cost based on rotation frequency.

---

## 10. IAM Anti-Patterns & Common Mistakes

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Wildcard `*` in Action and Resource | Over-permissive, violates least privilege | Scope to specific actions and resource ARNs |
| Long-lived access keys for automation | Keys don't expire, leak risk is permanent | Use OIDC / Roles Anywhere / instance profiles |
| Storing IAM credentials in code/repos | Secret exposure via git history | Use Secrets Manager + secret scanning in CI |
| No permission boundary on delegated role creation | Privilege escalation via developer-created roles | Enforce boundary via SCP |
| No SCP on management account | Management account has no guardrails | Treat management account as break-glass only |
| Role trust policy trusting entire account (`arn:aws:iam::ID:root`) | Any principal in that account can assume role | Scope to specific roles/users |
| Ignoring SCPs in IAM simulator testing | False sense of correct policy | Always test in sandbox with SCPs active |
| Using same role for multiple microservices | Blast radius — one compromise affects all | One role per service (IRSA/Pod Identity makes this easy) |
| Not setting `MaxSessionDuration` on roles | Default 1h may be too short or too long | Set explicitly per role use case |
| KMS key policy without root delegation | Lockout — no one can recover the key | Always include account root in key policy |
| Assuming cross-account without ExternalId | Confused deputy vulnerability | Use ExternalId for all third-party cross-account |
| Not monitoring IAM with CloudTrail + GuardDuty | Silent privilege escalation | Enable GuardDuty IAM findings, alert on `AssumeRole` anomalies |

---

## Quick Reference — IAM Limits Worth Knowing

| Limit | Default |
|---|---|
| Managed policies per role | 10 |
| Inline policy size per role | 10,240 characters |
| Roles per account | 1,000 |
| Session duration (chained roles) | 1 hour (hard limit) |
| Session duration (direct assume) | 1–12 hours (role-controlled) |
| SCPs per OU/account | 5 |
| SCP size | 5,120 characters |
| SAML assertion validity | 5 minutes |
| AssumeRoleWithWebIdentity max session | 12 hours |
| IAM groups per user | 10 |
| Permission boundary — applies to | Users and roles only (not groups) |

---

*Last updated: 2026-05 | Author: Personal KB | Covers: IAM, STS, SSO, OIDC, SAML, Roles Anywhere*