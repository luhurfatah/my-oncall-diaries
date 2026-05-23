# AWS Landing Zone & Multi-Account — Advanced Patterns, Edge Cases & Design Decisions

> **Scope:** Production-grade multi-account AWS Organizations design. Covers Control Tower, account vending, OU architecture, delegated administration, and cross-account operational patterns. Assumes Landing Zone as the foundation.

---

## Table of Contents

1. [AWS Organizations — Core Concepts & Design](#1-aws-organizations--core-concepts--design)
2. [OU Design — Hierarchy Strategies](#2-ou-design--hierarchy-strategies)
3. [AWS Control Tower — Architecture, Guardrails & Limitations](#3-aws-control-tower--architecture-guardrails--limitations)
4. [Account Vending Machine Pattern](#4-account-vending-machine-pattern)
5. [Delegated Administration](#5-delegated-administration)
6. [Centralized Security Tooling — GuardDuty, Security Hub, Config Aggregator](#6-centralized-security-tooling--guardduty-security-hub-config-aggregator)
7. [Control Tower Customizations (CfCT & AFT)](#7-control-tower-customizations-cfct--aft)
8. [Multi-Account Networking Integration](#8-multi-account-networking-integration)
9. [Multi-Account Cost Visibility & Tagging Strategy](#9-multi-account-cost-visibility--tagging-strategy)
10. [Landing Zone Anti-Patterns & Common Mistakes](#10-landing-zone-anti-patterns--common-mistakes)

---

## 1. AWS Organizations — Core Concepts & Design

### Structure

```
Management Account (root)
  └── Root
        ├── OU: Security
        │     ├── Log Archive Account
        │     └── Security Tooling Account
        ├── OU: Infrastructure
        │     ├── Network Account
        │     └── Shared Services Account
        ├── OU: Workloads
        │     ├── OU: Production
        │     │     └── prod-app-1, prod-app-2 ...
        │     └── OU: Non-Production
        │           └── dev-app-1, staging-app-1 ...
        ├── OU: Sandbox
        │     └── Individual developer sandbox accounts
        └── OU: Suspended
              └── Decommissioned accounts (not yet deleted)
```

### Management Account — Treat as Break-Glass

The management account has **unconstrained power** over the entire organization:
- Can remove accounts from the org
- Can delete SCPs
- Can access any member account via Organizations API
- **SCPs do not apply to the management account**

Best practices:
- No workloads in the management account — ever
- Minimal IAM users/roles — ideally only a break-glass role
- MFA on root, hardware MFA preferred
- CloudTrail + alerting on all management account activity
- Use delegated admin for Control Tower, Security Hub, GuardDuty, etc.

### Key Organization-Level Features

| Feature | What It Does |
|---|---|
| **SCPs** | Permission guardrails across all accounts |
| **Tag Policies** | Enforce tag key casing and allowed values |
| **Backup Policies** | Enforce AWS Backup plans across accounts |
| **AI Services Opt-Out Policies** | Prevent AWS from using org data for AI training |
| **RAM** | Share resources (subnets, Route 53 rules, etc.) without leaving org |
| **Trusted Access** | Allow AWS services to operate across all accounts (GuardDuty, Config, etc.) |

### Edge Cases & Gotchas

- **Account removal from org:** A member account must have valid payment info and support plan before it can leave/be removed. The account also keeps all resources — there is no automatic cleanup.
- **Root email uniqueness:** Every AWS account needs a unique root email. Plan a naming convention early: `aws+prod-app-1@company.com` using email aliasing.
- **Account limits:** Default org-wide account limit is 10 (for new orgs). Submit a limit increase request before starting any serious deployment. Target 1,000+ for large enterprises.
- **Trusted access enablement is account-wide:** Enabling trusted access for a service (e.g., GuardDuty) across the org cannot be scoped per-OU — it's all-or-nothing at the org level.
- **SCP changes are near-instant but not atomic:** Changes propagate quickly but there's a brief window where old and new policies coexist. For critical changes, validate in a test OU first.

---

## 2. OU Design — Hierarchy Strategies

### Design Principles

1. **OUs reflect security/compliance posture, not org chart.** Engineering teams change; compliance boundaries don't.
2. **Fewer, wider OUs are easier to manage** than deep hierarchies.
3. **SCPs attach to OUs** — group accounts that need the same controls together.
4. **Maximum OU depth: 5 levels.** Beyond that, inheritance becomes hard to reason about.

### Recommended OU Structure

```
Root
├── Security OU          → Log Archive, Security Tooling accounts
│                          SCP: Deny modification of security services
├── Infrastructure OU    → Network, Shared Services accounts
│                          SCP: Deny non-infra workloads
├── Workloads OU         → All application accounts
│   ├── Production OU    → SCP: DenyDelete*, RequireTagging, DenyUnapprovedRegions
│   ├── Non-Prod OU      → SCP: DenyExpensiveServices, DenyProductionData
│   └── (Optional) per-BU or per-team sub-OUs
├── Sandbox OU           → Individual dev accounts
│                          SCP: DenyProductionData, CostCap, DenyVPCPeering
├── Policy Staging OU    → Test new SCPs here before applying to production OUs
└── Suspended OU         → Accounts pending deletion; SCP: DenyAll
```

### Policy Staging OU — Critical Pattern

Before applying a new SCP to Production OU, move a non-critical test account into the Policy Staging OU and apply the SCP there. Validate no unexpected denials. Then apply to prod.

**Never test SCPs directly in production OUs.** A bad SCP can break deployments across dozens of accounts simultaneously.

### Sandbox OU Design

Sandbox accounts should be generous but bounded:

```json
// SCP: Deny expensive services in sandbox
{
  "Effect": "Deny",
  "Action": [
    "redshift:CreateCluster",
    "rds:CreateDBCluster",
    "es:CreateDomain",
    "sagemaker:CreateTrainingJob"
  ],
  "Resource": "*"
}

// SCP: Cap individual resource sizes
{
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "arn:aws:ec2:*:*:instance/*",
  "Condition": {
    "ForAnyValue:StringNotLike": {
      "ec2:InstanceType": ["t3.*", "t4g.*", "m5.large", "m5.xlarge"]
    }
  }
}
```

### Edge Cases & Gotchas

- **Moving accounts between OUs:** Instant — SCPs of the new OU apply immediately. Have a runbook for OU moves; the account inherits new controls the moment it lands.
- **OU rename doesn't affect SCPs** — policies are attached by OU ID, not name. Renaming is safe.
- **Root-level SCP applies everywhere:** Any SCP at root applies to all accounts including Security and Infrastructure OUs. Keep root SCPs minimal (only org-wide non-negotiables like `DenyLeaveOrg`).
- **Nested OU SCP evaluation:** An account at `Root > Workloads > Production > BU-Finance` inherits SCPs from all four levels. Debugging effective permissions requires checking all ancestors.

---

## 3. AWS Control Tower — Architecture, Guardrails & Limitations

### What Control Tower Provides

- **Landing Zone setup:** Baseline accounts (Log Archive, Audit), CloudTrail, Config, S3 log bucket — all pre-wired
- **Guardrails:** Pre-built SCPs and Config rules (called controls in newer versions)
- **Account Factory:** GUI/API-driven account provisioning
- **Control Tower Dashboard:** Compliance status across all accounts

### Control Tower Baseline Components per Account

When Control Tower enrolls an account, it deploys:

```
Each enrolled account receives:
  ├── CloudTrail trail → S3 in Log Archive account
  ├── AWS Config recorder → S3 in Log Archive account
  ├── IAM roles for Control Tower management
  ├── SNS topics for drift notifications
  └── StackSets for ongoing baseline management
```

### Guardrail Types

| Type | Mechanism | Can Override? |
|---|---|---|
| **Mandatory** | SCP — always enforced | No |
| **Strongly Recommended** | SCP or Config rule — enabled by default | Yes (disable per OU) |
| **Elective** | Config rule or SCP — opt-in | Yes |

**Proactive controls** (newer): CloudFormation hooks that block non-compliant resources at deployment time — before they're created. More powerful than detective Config rules.

### Control Tower Limitations — The Real List

- **Single home region:** Control Tower is deployed in one region. Management plane is in that region. You can govern resources in other regions, but the CT home region cannot change post-deployment.
- **Account Factory one at a time:** The Service Catalog-based Account Factory provisions one account at a time, synchronously. At scale, use AFT (see Section 7).
- **Customization via StackSets only:** Any baseline customization (VPC deletion, default SG rules, etc.) must be implemented as CloudFormation StackSets targeting all accounts. No native Terraform support in vanilla CT.
- **Enrolled account requirements:** An account must not have conflicting CloudTrail trails or Config recorders before enrollment. Pre-existing accounts often need cleanup before they can be enrolled.
- **Guardrail conflicts with custom SCPs:** Control Tower's SCPs and your custom SCPs can conflict. Control Tower SCPs are managed — do not edit them directly; CT will drift and alert.
- **Landing Zone update required for new guardrails:** New Control Tower controls require a Landing Zone update, which is a sequential, potentially multi-hour operation that can cause brief disruptions to account provisioning.
- **Decommissioning an account from CT:** You must unenroll (removes CT baseline) before closing the account. Closing without unenrolling leaves orphaned StackSet instances and drift.
- **Max accounts per org with CT:** No hard CT-specific limit, but StackSet deployment at 1,000+ accounts introduces significant operation time for CT updates.

### Drift Detection & Remediation

Control Tower monitors for drift (manual changes to CT-managed resources). Common drift causes:
- Someone manually edits a CT-managed SCP
- CloudTrail trail modified in a member account
- Config recorder disabled

Drift shows in CT dashboard. Remediation = re-run Landing Zone update or repair via CT console. **Automated drift remediation is not built-in** — you need to build a Lambda or use AWS Config + SSM Automation.

---

## 4. Account Vending Machine Pattern

### Concept

An automated pipeline that provisions new AWS accounts on demand with full baseline configuration — no manual console steps.

```
Request (Jira / ServiceNow / Git PR)
  └── Trigger (webhook / scheduled)
        └── Pipeline (AFT / Terraform / CDK)
              ├── Create account via Organizations API
              ├── Move to correct OU
              ├── Apply account-level tags
              ├── Deploy baseline (VPC, IAM roles, logging, security tools)
              ├── Enroll in Control Tower
              └── Notify requestor
```

### Minimum Baseline per New Account

Every vended account should have:

```
Networking:
  ├── Default VPC deleted (security hygiene)
  ├── VPC with standard CIDR (from IPAM pool)
  ├── TGW attachment (to central network account TGW)
  └── VPC Flow Logs enabled

Security:
  ├── CloudTrail enabled (CT manages this)
  ├── Config recorder enabled (CT manages this)
  ├── GuardDuty enrolled (delegated admin auto-enrolls)
  ├── Security Hub enrolled (delegated admin auto-enrolls)
  ├── IAM Access Analyzer enabled
  └── Default SG: all rules removed

IAM:
  ├── Break-glass role (for emergency access)
  ├── CI/CD deployment role (assumed from pipeline account)
  └── Read-only role (assumed from monitoring/audit account)

Tagging:
  ├── AccountName
  ├── Environment (production/non-production/sandbox)
  ├── BusinessUnit
  ├── CostCenter
  └── Owner
```

### Root Email Strategy

Use email aliasing (Gmail `+` trick or distribution lists):

```
aws+prod-app-payments@company.com
aws+dev-app-payments@company.com
aws+sandbox-john-doe@company.com
```

Route all `aws+*` emails to a shared mailbox monitored by the platform team. This allows root email access for recovery without individual ownership.

### Edge Cases & Gotchas

- **Account creation is eventually consistent:** After `organizations:CreateAccount`, the account may not be immediately usable for IAM role assumption. Poll `DescribeCreateAccountStatus` and wait for `SUCCEEDED` before proceeding.
- **GovCloud account linking:** Creating a GovCloud account requires a separate API call and is linked to a commercial account. Plan this separately.
- **Account name is immutable after creation** via Organizations API (though display name can be changed in Billing). Choose a clear, consistent naming convention upfront.
- **IPAM CIDR allocation must happen before VPC creation** — wire IPAM pool allocation into the vending pipeline before the Terraform VPC module runs.
- **CloudFormation StackSet propagation delay:** After account creation, StackSets targeting the new account's OU may take 5–15 minutes to deploy. Don't gate on StackSet completion synchronously in the pipeline — use async polling.
- **Closing vs suspending an account:** You cannot delete an AWS account immediately. Closed accounts enter a 90-day suspended state before permanent deletion. During this window, the account still counts against org limits.
- **Service quota inheritance:** New accounts start with default service quotas, not parent account quotas. Pre-warm critical quotas (EC2 vCPUs, EIP limits, VPC limits) via Service Quotas API as part of vending.

---

## 5. Delegated Administration

### Concept

Move AWS service management planes out of the management account into a designated member account. Reduces blast radius of management account access.

### Services Supporting Delegated Admin

| Service | Recommended Delegated Account |
|---|---|
| GuardDuty | Security Tooling account |
| Security Hub | Security Tooling account |
| AWS Config (aggregator) | Security Tooling account |
| IAM Identity Center | Security Tooling or dedicated SSO account |
| Control Tower | Dedicated governance account (optional) |
| AWS Firewall Manager | Security Tooling account |
| Amazon Macie | Security Tooling account |
| AWS Audit Manager | Audit/Compliance account |
| AWS Inspector | Security Tooling account |
| AWS RAM | Network account (for subnet sharing) |
| S3 Storage Lens | FinOps or Log Archive account |
| Route 53 Resolver (DNS Firewall) | Network account |

### Enabling Delegated Admin

```bash
# From the management account
aws organizations register-delegated-administrator \
  --account-id 123456789012 \
  --service-principal guardduty.amazonaws.com
```

Once registered, the Security Tooling account can manage GuardDuty across all org accounts without needing management account access.

### GuardDuty Delegated Admin — Auto-Enable Pattern

After registering the delegated admin, configure auto-enable for new accounts:

```bash
# From the delegated admin (Security Tooling) account
aws guardduty update-organization-configuration \
  --detector-id <detector-id> \
  --auto-enable-organization-members ALL \
  --features '[{"Name":"S3_DATA_EVENTS","AutoEnable":"NEW"},
               {"Name":"EKS_AUDIT_LOGS","AutoEnable":"NEW"},
               {"Name":"RUNTIME_MONITORING","AutoEnable":"NEW"}]'
```

**`ALL` vs `NEW`:** `ALL` enables for existing + new accounts. `NEW` only for future accounts. When first setting up, use `ALL` to backfill.

### Edge Cases & Gotchas

- **Only one delegated admin per service per org.** You cannot split GuardDuty admin across two accounts. Choose carefully.
- **Delegated admin cannot manage the management account** for most services — the management account must self-enroll or is automatically included.
- **Deregistering delegated admin mid-operation** can leave member accounts in an inconsistent state (e.g., GuardDuty enabled but orphaned from the org aggregator). Always plan a replacement admin before deregistering.
- **IAM Identity Center delegated admin has limitations:** The delegated admin can manage users, groups, and permission sets but cannot change the Identity Center instance configuration (e.g., change the identity source). That still requires management account access.
- **Some services require trusted access before delegated admin.** Enable trusted access for the service in Organizations first, then register the delegated admin.
- **Cross-region behavior:** Delegated admin registration is global (Organizations level), but service configuration (e.g., GuardDuty detectors) is regional. You must configure the delegated admin's actions in each active region.

---

## 6. Centralized Security Tooling — GuardDuty, Security Hub, Config Aggregator

### GuardDuty — Multi-Account Architecture

```
Security Tooling Account (Delegated Admin)
  └── GuardDuty Administrator
        ├── Aggregates findings from all member accounts
        ├── All findings visible in Security Tooling account
        ├── Member accounts see only their own findings
        └── EventBridge rules → Security findings → SIEM / ticketing
```

**Finding flow:**
```
Member Account EC2 → GuardDuty detects anomaly
  → Finding created in member account
  → Replicated to administrator account within minutes
  → EventBridge in admin account → SNS / Lambda → PagerDuty / SIEM
```

### Security Hub — Aggregation & Standards

Security Hub aggregates findings from:
- GuardDuty
- AWS Config (via Config rules)
- Amazon Inspector
- Amazon Macie
- AWS Firewall Manager
- Third-party integrations (CrowdStrike, Palo Alto, etc.)

**Standards to enable:**
- AWS Foundational Security Best Practices (FSBP) — most comprehensive
- CIS AWS Foundations Benchmark — for compliance
- PCI DSS — if applicable
- NIST 800-53 — for government/regulated workloads

**Cross-region aggregation:** Security Hub supports a finding aggregation region — all findings from all regions are replicated to one region for a single-pane view.

```bash
aws securityhub create-finding-aggregator \
  --region-linking-mode ALL_REGIONS \
  --region us-east-1  # aggregation region
```

### AWS Config — Aggregator Pattern

```
Security Tooling Account
  └── Config Aggregator
        ├── Sources: All accounts in Org (auto-discovered via trusted access)
        ├── Queries: Multi-account, multi-region resource inventory
        └── Conformance Packs: Deploy rules across all accounts from one place
```

**Conformance packs** allow you to deploy a bundle of Config rules to all accounts in the org simultaneously — like a policy package.

```yaml
# conformance-pack-baseline.yaml
Parameters:
  MaxAccessKeyAge:
    Default: "90"
Resources:
  IamAccessKeyRotation:
    Type: AWS::Config::ConfigRule
    Properties:
      ConfigRuleName: access-keys-rotated
      Source:
        Owner: AWS
        SourceIdentifier: ACCESS_KEYS_ROTATED
      InputParameters:
        maxAccessKeyAge: !Ref MaxAccessKeyAge
```

### Log Archive Account — Design

```
Log Archive Account
  ├── S3: cloudtrail-org-logs/          (all accounts, all regions)
  ├── S3: config-org-logs/             (all accounts, all regions)
  ├── S3: vpc-flow-logs/               (from network account)
  ├── S3: alb-access-logs/             (from workload accounts)
  └── S3: guardduty-exports/           (finding archives)

Bucket policies:
  - Allow write from CloudTrail service (all accounts)
  - Allow write from Config service (all accounts)
  - Deny delete (SCPed + bucket policy)
  - Object Lock: COMPLIANCE mode, 365-day retention
```

**Object Lock compliance mode** prevents deletion even by the root user of the Log Archive account — critical for tamper-evident logging required by PCI/SOC2/ISO27001.

### Edge Cases & Gotchas

- **GuardDuty suppression rules are per-account:** A suppression rule in the admin account does not suppress findings in member accounts. You must create suppression rules in each member account or use EventBridge filtering in the admin account.
- **Security Hub finding deduplication:** The same underlying issue (e.g., an open S3 bucket) may generate findings from multiple sources (GuardDuty + Config + Inspector). Security Hub does not deduplicate cross-source — build dedup logic in your SIEM.
- **Config rules vs Proactive controls:** Config rules are detective (evaluate after resource creation). Control Tower proactive controls block at deploy time. For true shift-left, use both.
- **CloudTrail S3 bucket cross-account write:** The CloudTrail S3 bucket in Log Archive must have a bucket policy allowing `cloudtrail.amazonaws.com` to write from all accounts. Forgetting to update this policy when adding new accounts breaks log delivery silently.
- **Config aggregator does not remediate:** The aggregator is read-only for visibility. Remediation must be triggered via EventBridge + SSM Automation or Lambda in the member account.
- **GuardDuty cost at scale:** GuardDuty pricing is based on CloudTrail event volume, VPC Flow Log GB, and DNS log volume. Large orgs can see $10,000+/month. Use the 30-day free trial per account to estimate, and use GuardDuty cost optimization (e.g., exclude noisy S3 prefixes).

---

## 7. Control Tower Customizations (CfCT & AFT)

### Two Customization Frameworks

| Framework | Type | Language | Scale | When to Use |
|---|---|---|---|---|
| **CfCT** (Customizations for Control Tower) | CloudFormation + SCPs | YAML/JSON | Medium | Simpler orgs, CT-native teams |
| **AFT** (Account Factory for Terraform) | Terraform | HCL | Large | Terraform-native teams, complex customizations |

---

### CfCT — Customizations for Control Tower

CfCT deploys a CodePipeline triggered by changes to a manifest file in S3/CodeCommit. It applies CloudFormation StackSets and SCPs to OUs or individual accounts.

```yaml
# manifest.yaml
region: ap-southeast-1
version: 2021-03-15

resources:
  - name: delete-default-vpc
    resource_file: templates/delete-default-vpc.yaml
    deploy_method: stack_set
    deployment_targets:
      organizational_units:
        - Workloads/Production
        - Workloads/Non-Production
    regions:
      - ap-southeast-1
      - ap-southeast-3

  - name: restrict-s3-public-access
    resource_file: templates/s3-account-public-access-block.yaml
    deploy_method: stack_set
    deployment_targets:
      organizational_units:
        - Root
```

**Gotcha:** CfCT does not support Terraform natively. If your platform team is Terraform-first, use AFT instead.

---

### AFT — Account Factory for Terraform

AFT is a Terraform module that replaces Account Factory with a GitOps-driven pipeline. It consists of:

```
AFT Management Account (dedicated)
  ├── CodePipeline: account-request pipeline
  ├── CodePipeline: account-provisioning pipeline
  ├── CodePipeline: account-customizations pipeline
  └── DynamoDB: account state tracking

Git Repositories:
  ├── aft-account-request/          → One .tf file per account to vend
  ├── aft-global-customizations/    → Applied to ALL accounts
  ├── aft-account-customizations/   → Applied to specific accounts by tag
  └── aft-account-provisioning-customizations/  → Pre/post hooks
```

#### Account Request File

```hcl
# accounts/prod-app-payments.tf
module "prod_app_payments" {
  source = "./modules/aft-account-request"

  control_tower_parameters = {
    AccountEmail              = "aws+prod-app-payments@company.com"
    AccountName               = "prod-app-payments"
    ManagedOrganizationalUnit = "Workloads/Production"
    SSOUserEmail              = "platform-team@company.com"
    SSOUserFirstName          = "Platform"
    SSOUserLastName           = "Admin"
  }

  account_tags = {
    Environment  = "production"
    BusinessUnit = "payments"
    CostCenter   = "CC-2001"
    Owner        = "payments-team@company.com"
  }

  change_management_parameters = {
    change_requested_by = "platform-team"
    change_reason       = "New payments service account"
  }

  account_customizations_name = "production-workload"
}
```

Merging this file to the main branch triggers account provisioning automatically.

#### AFT Customization Layers

```
Global Customizations (all accounts):
  └── Delete default VPC
  └── Enable IAM Access Analyzer
  └── Deploy break-glass role
  └── Configure account-level S3 public access block

Account Customizations (by account_customizations_name tag):
  └── "production-workload":
        ├── VPC with production CIDR from IPAM
        ├── TGW attachment
        └── Production-specific IAM roles

  └── "sandbox":
        ├── VPC with sandbox CIDR
        └── Cost budget alert at $500/month
```

### Edge Cases & Gotchas

- **AFT does not replace Control Tower — it extends it.** CT still manages guardrails and enrollment. AFT handles account requests and customizations on top.
- **AFT pipelines are sequential per account.** Parallel account provisioning is limited. Vending 50 accounts simultaneously is not straightforward — stagger requests.
- **AFT state in DynamoDB:** AFT tracks account state in DynamoDB. If the table gets corrupted or items are manually deleted, re-running pipelines may fail or duplicate resources. Treat the AFT DynamoDB table as infrastructure state.
- **Global customization failures block all accounts.** If a Terraform error exists in `aft-global-customizations`, every account provisioning will fail at that stage. Keep global customizations minimal and well-tested.
- **CfCT manifest errors are silent in some versions:** A YAML syntax error in the manifest may cause the pipeline to succeed but not apply changes. Always verify StackSet deployment status independently.
- **AFT upgrade path:** AFT is versioned as a Terraform module. Upgrading AFT version can change pipeline structure — test upgrades in a non-production AFT environment first.

---

## 8. Multi-Account Networking Integration

### Account-to-Network Account Relationship

```
Network Account owns:
  ├── Transit Gateway
  ├── Egress VPC (NAT GW + IGW)
  ├── Ingress VPC (ALB + WAF for inbound)
  ├── Shared Services VPC (VPC Endpoints, DNS)
  └── Direct Connect / VPN termination

Workload accounts own:
  ├── Application VPCs
  └── TGW attachments (shared via RAM from Network account)
```

### TGW Sharing via RAM

The TGW lives in the Network account and is shared to all org accounts via RAM:

```hcl
# Network account
resource "aws_ram_resource_share" "tgw" {
  name                      = "tgw-share"
  allow_external_principals = false
}

resource "aws_ram_resource_association" "tgw" {
  resource_arn       = aws_ec2_transit_gateway.main.arn
  resource_share_arn = aws_ram_resource_share.tgw.arn
}

resource "aws_ram_principal_association" "org" {
  principal          = data.aws_organizations_organization.main.arn
  resource_share_arn = aws_ram_resource_share.tgw.arn
}
```

Workload accounts can then create TGW attachments to the shared TGW — but route table association and propagation must be done from the **Network account**, not the workload account.

### IP Address Management (IPAM)

AWS IPAM provides centralized CIDR management across the org:

```
IPAM (in Network account, delegated admin)
  └── Top-level pool: 10.0.0.0/8
        ├── Regional pool: 10.10.0.0/12 (ap-southeast-1)
        │     ├── Prod pool: 10.10.0.0/13
        │     └── Non-prod pool: 10.12.0.0/13
        └── Regional pool: 10.20.0.0/12 (us-east-1)
```

Workload accounts allocate CIDRs from the pool at VPC creation. IPAM prevents overlapping CIDRs — which break TGW routing and make peering impossible.

```hcl
# Workload account VPC — CIDR from IPAM
resource "aws_vpc" "main" {
  ipv4_ipam_pool_id   = var.ipam_pool_id   # passed from platform
  ipv4_netmask_length = 24                  # /24 per workload VPC
}
```

### Edge Cases & Gotchas

- **TGW route propagation is account-scoped:** A workload account can create a TGW attachment, but only the Network account (TGW owner) can configure route table associations and propagations. Build this into the vending pipeline.
- **IPAM allocation vs VPC creation race:** If the AFT customization pipeline allocates an IPAM CIDR and creates a VPC in the same Terraform run, ordering matters. Use `depends_on` explicitly.
- **Default VPC deletion:** Default VPCs exist in every region in every new account. Delete them as part of account baseline — they use `172.31.0.0/16` which may overlap with your IPAM ranges, and they're a security risk (default IGW, default open SGs).
- **VPC Flow Logs cross-account delivery:** Flow logs from workload accounts should be delivered to the Log Archive account S3 bucket — requires a bucket policy allowing the VPC flow log service from the member account's region.

---

## 9. Multi-Account Cost Visibility & Tagging Strategy

### Cost Allocation Architecture

```
Management Account
  └── AWS Cost Explorer (org-wide view)
        ├── Linked account breakdown (per account)
        ├── Tag-based cost allocation
        └── Cost anomaly detection

  └── AWS Cost and Usage Report (CUR)
        └── S3 (in Management or dedicated FinOps account)
              └── Athena + QuickSight / Grafana for dashboards
```

### Mandatory Tag Strategy

Enforce via Tag Policies (Organizations) + Config rules for coverage:

| Tag Key | Values | Purpose |
|---|---|---|
| `Environment` | production, non-production, sandbox | Cost split by env |
| `BusinessUnit` | payments, platform, data, etc. | Chargeback |
| `CostCenter` | CC-XXXX | Finance allocation |
| `Application` | Free text | Per-app cost tracking |
| `Owner` | Team email | Alert routing |
| `ManagedBy` | terraform, cdk, manual | Operational context |

### Tag Policy Enforcement

```json
// Organizations Tag Policy
{
  "tags": {
    "Environment": {
      "tag_key": { "@@assign": "Environment" },
      "tag_value": {
        "@@assign": ["production", "non-production", "sandbox"]
      },
      "enforced_for": {
        "@@assign": ["ec2:instance", "rds:db", "s3:bucket"]
      }
    }
  }
}
```

Tag policies enforce key casing and allowed values but do **not** block resource creation on non-compliance — they report violations. Use Config rules (`required-tags`) for blocking or alerting.

### Showback vs Chargeback

- **Showback:** Show teams their costs without direct billing transfer. Start here.
- **Chargeback:** Actually transfer costs to business units. Requires Finance alignment and tooling (Apptio, CloudHealth, or custom).

AWS account-per-team structure makes chargeback clean — each account's costs map directly to a team. This is one of the strongest arguments for fine-grained account isolation.

### Edge Cases & Gotchas

- **Tags on shared resources (TGW, NAT GW in Network account):** These costs don't have a natural owner tag. Use a service code tag (e.g., `CostCenter: CC-platform-shared`) and split via FinOps tooling.
- **Untagged resources accumulate fast:** New accounts without enforced tagging accumulate unallocatable costs. Automate tag enforcement from day 1 in the vending pipeline.
- **Reserved Instance / Savings Plans apply org-wide:** RIs purchased in any account can be shared across the org. Centralize RI purchasing in the management or FinOps account for best discount coverage.
- **CUR latency:** Cost and Usage Reports are updated up to 3 times per day but can lag 24–48 hours. Don't use CUR for real-time cost alerting — use Cost Anomaly Detection instead.
- **Cost Anomaly Detection requires setup per service:** Configure anomaly monitors per service (EC2, RDS, etc.) and per linked account. The default monitor is org-wide and can be too noisy.

---

## 10. Landing Zone Anti-Patterns & Common Mistakes

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Workloads in management account | No SCP protection; blast radius = entire org | Move to workload accounts; management = break-glass only |
| Single large "catch-all" account | No isolation, cost attribution is impossible | One account per environment per application |
| Deep OU hierarchy (6+ levels) | SCP inheritance is hard to debug | Max 4–5 levels; prefer wider, shallower OUs |
| Manually created accounts (not vended) | No baseline, missing security tooling, bad tagging | All account creation goes through vending pipeline |
| SCPs tested in production OUs | Bad SCP can break all prod deployments simultaneously | Use Policy Staging OU for all SCP testing |
| No delegated admin — everything in management account | Excessive management account access, audit nightmare | Delegate GuardDuty, Security Hub, Config, SSO |
| Log Archive account with mutable logs | Logs can be deleted or tampered with | Enable S3 Object Lock (COMPLIANCE mode) on log buckets |
| No IPAM — teams self-assign CIDRs | Overlapping CIDRs break TGW routing permanently | Implement IPAM from day 1; enforce via SCP if needed |
| Root user without hardware MFA | Root account takeover risk | Hardware MFA on management + all member account roots |
| Account per developer in production OU | Dev accounts with prod SCP restrictions | Separate Sandbox OU with developer accounts |
| Forgetting to vend service quotas | New accounts hit default limits mid-deployment | Pre-warm quotas (EC2 vCPUs, EIPs, VPCs) in vending pipeline |
| No Suspended OU | Decommissioned accounts mixed with active | Move to Suspended OU with DenyAll SCP before closure |
| Ignoring Config aggregator lag | Compliance status is stale — false sense of security | Understand Config evaluation frequency; use proactive controls for hard blocks |
| Control Tower without AFT/CfCT | Manual account customization = configuration drift | Automate all baseline config via AFT or CfCT from day 1 |

---

## Quick Reference — Key Limits

| Limit | Default | Notes |
|---|---|---|
| Accounts per organization | 10 (new orgs) | Request increase to 1,000+ |
| OUs per organization | 1,000 | Rarely hit |
| OU nesting depth | 5 levels | Hard limit |
| SCPs per OU/account | 5 | Consolidate carefully |
| SCP character limit | 5,120 | Use `NotAction` to save space |
| Delegated admins per service | 1 | Choose carefully |
| AFT pipelines (parallel accounts) | Sequential | Stagger for bulk vending |
| Control Tower home region | 1 (immutable) | Plan before enabling |
| Tag policy enforcement | Report only | Use Config rules for hard blocking |
| CUR update frequency | 3× per day | 24–48h lag possible |

---

*Last updated: 2026-05 | Author: Personal KB | Covers: Organizations, Control Tower, AFT, CfCT, GuardDuty, Security Hub, Config, IPAM, FinOps*