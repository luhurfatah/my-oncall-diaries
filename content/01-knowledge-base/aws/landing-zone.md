# AWS Landing Zones — Control Tower, AFT & Enterprise Patterns

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Landing Zone Fundamentals](#1-landing-zone-fundamentals) | Core landing zone goals, building vs buying, and multi-account strategies. |
| **02** | [AWS Organizations & OU Design](#2-aws-organizations-ou-design) | Designing OU structures (Core vs Workloads vs Sandbox) and account allocation principles. |
| **03** | [AWS Control Tower — Production Setup](#3-aws-control-tower-production-setup) | Control Tower version lifecycles, resource provisioning, and enrolling existing accounts safely. |
| **04** | [Account Factory for Terraform (AFT)](#4-account-factory-for-terraform-aft) | Deploying and tuning AFT, and customizing bootstrap and pipeline executions. |
| **05** | [Guardrails & Service Control Policies](#5-guardrails-service-control-policies) | Detective vs preventive controls, and building/testing production-ready SCPs. |
| **06** | [Networking Architecture](#6-networking-architecture) | VPC design (RFC1918 allocations, subnets) and Transit Gateway hub-and-spoke topologies. |
| **07** | [Security Baseline & Identity](#7-security-baseline-identity) | IAM Identity Center (SSO) integration, permission sets, and Security Hub aggregates. |
| **08** | [Logging & Observability](#8-logging-observability) | Centralizing logs with CloudTrail org trails, S3 configurations, and CloudWatch log streaming. |
| **09** | [Multi-Region Strategy](#9-multi-region-strategy) | Active vs governed regions, AFT python hooks for multi-region security, and Region failover. |
| **10** | [Day-2 Operations & Customization Pipelines](#10-day-2-operations-customization-pipelines) | Managing drift detection, clean account offboarding, and quarterly review checklists. |

---

## 1. Landing Zone Fundamentals

### What a Landing Zone Is (and Isn't)

A **landing zone** is the pre-configured, secure multi-account AWS environment that teams land in when they need cloud resources. It is:

- A set of AWS accounts with enforced guardrails (SCPs, Config rules)
- A shared networking foundation (Transit Gateway, DNS, egress)
- A security baseline applied automatically to every new account
- An account vending machine that reduces time-to-account from weeks to minutes

It is **not**:

- A one-time setup task — it requires continuous lifecycle management
- A replacement for application-level security controls
- A solved problem — it will evolve as your org scales

### Build vs Buy Trade-offs

| Option | Pros | Cons |
|---|---|---|
| **AWS Control Tower** | Managed, AWS-integrated, free (pay for resources it creates), quick to start | Opinionated OU structure, slower to customize, CT bugs affect your entire org |
| **Custom Terraform** | Full control, no CT constraints | You own the entire operational burden, significant build investment |
| **Superwerker / Landing Zone Accelerator** | Open-source, batteries included | Less support, harder to deviate from opinions |

**Recommendation:** Control Tower + AFT for orgs that can accept CT's OU opinions. Custom Terraform only if you have a dedicated platform team >3 engineers and specific constraints CT can't meet (e.g., GovCloud-first, complex existing org structure).

---

## 2. AWS Organizations & OU Design

### OU Hierarchy — The Critical Design Decision

OU structure drives SCP inheritance. Design it wrong and you'll be fighting it for years. Reorganizing OUs later is painful — SCPs must be detached, accounts moved (which triggers CT re-enrollment), and existing deployments often break.

**Recommended OU Structure:**

```
Root
├── Management (root account — almost nothing runs here)
├── Security/
│   ├── Audit            ← CloudTrail, Config aggregation, Security Hub
│   └── Log Archive      ← Centralized S3 log buckets (no delete permissions)
├── Infrastructure/
│   ├── Network          ← Transit Gateway, DNS resolver, shared VPCs
│   └── Tooling          ← CI/CD, artifact registries, internal tooling
├── Workloads/
│   ├── Prod/
│   │   ├── TeamA-Prod
│   │   └── TeamB-Prod
│   ├── NonProd/
│   │   ├── TeamA-Dev
│   │   ├── TeamA-Staging
│   │   └── TeamB-Dev
│   └── Sandbox/         ← Loose guardrails, auto-cleanup, credit limits
├── Suspended/           ← Accounts pending deletion (quarantine)
└── Exceptions/          ← Accounts that need SCP exclusions (keep minimal)
```

### OU Design Rules

**Keep OUs flat (max 3–4 levels).** Deep nesting makes SCP inheritance hard to reason about. AWS Organizations supports up to 5 levels; don't use them all.

**Design around trust boundary, not team structure.** `Prod` and `NonProd` are different trust domains — they get fundamentally different SCPs. Don't create OUs for every team at the top level.

**Sandbox OU is mandatory.** Engineers need a place to experiment without guardrails blocking them. A sandbox with a $200/month SCP budget limit and weekly Nuke cleanup is better than shadow IT.

**The `Exceptions` OU is a smell.** If you're constantly adding accounts here, your guardrails are too restrictive. Revisit SCPs.

### Account Strategy

Each AWS account is a hard blast-radius boundary. Follow these rules:

- **One workload, one prod account** — shared prod accounts create coupling between unrelated teams
- **Separate AWS accounts for prod vs non-prod** — never share prod and non-prod in the same account, even for small services
- **Network/shared services in dedicated accounts** — Transit Gateway, Route 53 Resolver, shared AMIs never live in workload accounts
- **Management account has zero workloads** — the management account has elevated permissions (billing, CT management). A compromised workload in the management account can destroy your entire org

---

## 3. AWS Control Tower — Production Setup

### What Control Tower Creates

When you enable Control Tower, it automatically provisions several resources. It creates a **Log Archive account** as the centralized destination for CloudTrail and Config delivery, and an **Audit account** that acts as the Security Hub aggregator with read-only cross-account access for security tools. It also sets up the core `Security` and `Sandbox` OUs and applies a set of mandatory default guardrails (SCPs and Config rules) across all managed OUs.

One important thing to understand: **CT has its own version lifecycle.** Check the current landing zone version before enrolling new accounts — CT upgrades can cause drift on enrolled accounts. Set a quarterly reminder to check and read the upgrade release notes before applying any version bump.

### Enrolling Existing Accounts

Enrolling accounts that already have resources is the riskiest CT operation. CT will apply mandatory SCPs (which may break existing IAM policies), create the `AWSControlTowerExecution` role (requires the account to trust the management account), and enable Config recording and CloudTrail (which may conflict with existing setups).

**Safe enrollment procedure:**

1. Pre-flight check — scan the target account for existing Config recorders and CloudTrail trails that may conflict
2. Create the `AWSControlTowerExecution` IAM role in the target account with a trust policy pointing to your management account and `AdministratorAccess` attached
3. Enroll via the CT console (Account Factory → Enroll Account) — avoid the CLI for this step
4. After enrollment, validate in the CT console and check for drift or errors before proceeding

### Control Tower Limitations (Know Before You Commit)

These constraints are permanent once you're in. Know them before you commit:

- **Cannot change the Log Archive or Audit account** once set — they're permanent
- **Cannot rename OUs** managed by CT without re-enrollment
- **One CT instance per org** — you cannot have multiple Control Tower setups in the same AWS Organizations
- **CT doesn't manage non-CT OUs** — accounts outside CT's managed hierarchy don't get CT guardrails
- **AFT pipeline is sequential** — account customizations run one at a time by default; large orgs need to tune pipeline concurrency
- **CT region support lag** — new AWS regions often aren't CT-supported for months after GA

---

## 4. Account Factory for Terraform (AFT)

AFT is AWS's GitOps-native account vending system. It replaces the CT console-based Account Factory with a Terraform + CodePipeline workflow.

### How AFT Works

When you push a new account request to Git, AFT kicks off a CodePipeline that validates the request via Terraform plan and then applies it through CT's Account Factory. Once the account exists, a second pipeline runs your **global customizations** (which apply to every account) and then your **account-specific customizations** (per-account Terraform templates like `workload-prod`, `workload-dev`, or `sandbox`).

AFT customizations are structured across four separate Git repos: account requests, global customizations, account-provisioning customizations, and account-specific customizations. Each repo is independently versioned and triggered by pipeline events.

### AFT Bootstrap (the key Terraform module)

```hcl
module "aft" {
  source  = "aws-ia/control_tower_account_factory/aws"
  version = "1.12.x"           # Pin to minor version; patch is generally safe

  ct_management_account_id    = "123456789012"
  log_archive_account_id      = "234567890123"
  audit_account_id            = "345678901234"
  aft_management_account_id   = "456789012345"   # Separate account for AFT itself

  ct_home_region              = "ap-southeast-1"
  tf_backend_secondary_region = "us-east-1"      # Multi-region state backend

  vcs_provider                         = "github"
  account_request_repo_name            = "myorg/aft-account-request"
  account_request_repo_branch          = "main"
  global_customizations_repo_name      = "myorg/aft-global-customizations"
  global_customizations_repo_branch    = "main"
  account_customizations_repo_name     = "myorg/aft-account-customizations"
  account_customizations_repo_branch   = "main"

  terraform_version      = "1.9.8"
  terraform_distribution = "oss"

  aft_feature_delete_default_vpcs_enabled = true   # Delete default VPCs in all regions
  aft_feature_cloudtrail_data_events      = false  # True = significant CloudTrail cost
}
```

### Account Request Pattern

```hcl
# account-request/terraform/accounts/teamA-prod.tf
module "teamA_prod" {
  source = "./modules/aft-account-request"

  control_tower_parameters = {
    AccountEmail              = "aws+teamA-prod@mycompany.com"
    AccountName               = "teamA-prod"
    ManagedOrganizationalUnit = "Workloads/Prod"
    SSOUserEmail              = "platform-team@mycompany.com"
    SSOUserFirstName          = "Platform"
    SSOUserLastName           = "Team"
  }

  account_tags = {
    "team"        = "teamA"
    "environment" = "prod"
    "cost-center" = "CC-1234"
    "managed-by"  = "aft"
  }

  account_customizations_name = "workload-prod"

  custom_fields = {
    network_type   = "connected"     # connected = TGW attachment, isolated = no TGW
    data_class     = "confidential"
    backup_enabled = "true"
  }
}
```

### AFT Gotchas

**AFT pipeline is not idempotent by default.** If a global customization fails halfway through, some accounts will have the new version and some won't. Always write customizations to be idempotent — Terraform handles this well, Python hooks need manual care.

**AFT uses a shared Terraform state per account.** All customizations for one account share one S3 state file. Large state files slow pipelines. Split large customizations into separate workspaces.

**Re-triggering customizations** — AFT doesn't have a native "re-run all" button. To retrigger, invoke the `aft-invoke-customizations` Lambda directly, passing the target account ID and customization name in the payload.

**AFT doesn't support account deletion.** AFT creates accounts; it does not delete them. Account deletion must go through CT console + manual cleanup. Move accounts to the `Suspended` OU first.

---

## 5. Guardrails & Service Control Policies

### SCP vs Config Rules — Know the Difference

| | SCP | AWS Config Rule |
|---|---|---|
| **Effect** | Preventive — blocks API calls | Detective — alerts on non-compliance |
| **Scope** | IAM principal actions | Resource state |
| **Timing** | Real-time enforcement | Near-real-time detection |
| **Cost** | Free | $0.001 per evaluation |
| **Limitation** | Cannot grant; only restrict | Cannot prevent |

**Use SCPs for:** blocking dangerous actions that must never happen (disable CloudTrail, leave regions, create root access keys).

**Use Config Rules for:** detecting configuration drift that SCPs can't prevent (public S3, unencrypted EBS, open security groups).

### SCP Design Principles

**SCPs are allow-list or deny-list — not both at once per OU.** AWS evaluates: both IAM policy AND SCP must allow an action. A common mistake is writing complex SCPs that try to do both.

**Always have a break-glass condition.** Use condition keys to exclude your break-glass role from restrictive SCPs. Every deny SCP should have a `StringNotLike` condition on `aws:PrincipalARN` that allows `BreakGlassRole` and `AWSControlTowerExecution` to bypass it.

### Essential SCPs — The Minimum Set

These five SCPs are the baseline for every organization. They should be applied at the root or Workloads OU level:

**1. Deny root account usage** — blocks all API calls made directly as the root user. This doesn't prevent root login to the console, but it catches most programmatic misuse.

**2. Deny region enablement outside approved list** — use `NotAction` to exempt global services (IAM, Route 53, CloudFront, STS, billing), then deny everything else outside your approved regions. This is verbose but necessary — a missing global service exemption will silently break things.

**3. Deny leaving the organization** — blocks `organizations:LeaveOrganization`. Without this, any account admin can detach their account from your org and escape all guardrails.

**4. Deny disabling security services** — blocks CloudTrail deletion, Config recorder deletion, GuardDuty deletion, SecurityHub disablement, and Macie disablement. Always scope this with a break-glass exception.

```json
{
  "Sid": "DenyDisableSecurityServices",
  "Effect": "Deny",
  "Action": [
    "cloudtrail:DeleteTrail",
    "cloudtrail:StopLogging",
    "config:DeleteConfigurationRecorder",
    "config:DeleteDeliveryChannel",
    "guardduty:DeleteDetector",
    "guardduty:DisassociateFromMasterAccount",
    "securityhub:DisableSecurityHub",
    "macie2:DisableMacie"
  ],
  "Resource": "*",
  "Condition": {
    "StringNotLike": {
      "aws:PrincipalARN": "arn:aws:iam::*:role/BreakGlassRole"
    }
  }
}
```

**5. Deny S3 public access settings modification** — blocks `s3:PutAccountPublicAccessBlock` and `s3:DeletePublicAccessBlock`. Combined with the S3 Block Public Access setting enforced during account vending, this prevents any account from opening public S3 access.

### SCP Inheritance Traps

**Deny at any level in the hierarchy overrides allow anywhere.** An SCP deny on Root applies to the management account too — be careful with root-level SCPs.

**The `FullAWSAccess` SCP is not a "grant all"** — it's a no-op allow that's always attached. You can't grant permissions via SCP; you can only restrict them. Removing `FullAWSAccess` from an OU effectively blocks all access.

**Tag-based SCPs require tag protection SCPs too.** If you write SCPs that condition on resource tags, you must also have an SCP that prevents tag removal or modification — otherwise the condition can be bypassed by deleting the tag first.

---

## 6. Networking Architecture

### Hub-and-Spoke with Transit Gateway

The recommended topology for most enterprises is a centralized Network account owning the Transit Gateway and shared services, with workload VPCs attaching to it as spokes. On-premises connectivity (Direct Connect or VPN) terminates in the Network account. Workload accounts never have direct internet exposure.

All outbound internet traffic routes through the Network account, where you can inspect, log, and control egress centrally. Individual workload accounts have private subnets only.

### Centralized vs Distributed Egress

| | Centralized Egress | Distributed (per-account NAT) |
|---|---|---|
| **Cost** | Lower (shared NAT GW) | Higher (NAT GW per account per AZ) |
| **Security** | Single inspection point, easier to enforce | Harder to enforce, easy to forget |
| **Availability** | Single dependency — Network account outage = all egress down | Blast radius contained per account |
| **Complexity** | TGW routing rules, careful route propagation | Simpler per account |

**Recommendation:** Centralized egress for regulated workloads. Distributed is acceptable for sandbox/dev where cost optimization is less important.

### VPC CIDR Strategy

CIDR conflicts between accounts kill TGW routing. Plan this upfront — it cannot be easily changed later. Allocate a `/16` per account from your `10.0.0.0/8` space and reserve blocks for future growth. Keep sandboxes on a separate range — they don't attach to the TGW so CIDR overlap there is fine.

For organizations with more than 20 accounts, manage CIDRs with **AWS VPC IPAM**. It enforces CIDR uniqueness across the org and provides allocation history — much better than a shared spreadsheet.

### Transit Gateway Configuration

The two critical TGW settings that most teams get wrong:

- **Disable default route table association and propagation.** Use custom route tables per trust tier. Prod accounts should use a `prod-rt` that has no routes to non-prod VPCs — TGW enforces the network-level blast radius boundary.
- **Disable auto-accept shared attachments.** Manual approval for new VPC attachments means a rogue account can't silently join your transit network.

Share the TGW to all org accounts via AWS RAM with `allow_external_principals = false`. Workload accounts accept the share and create their own VPC attachments — the Network account never needs access into workload accounts for this.

### DNS Architecture

Centralize DNS in the Network account using Route 53 Private Hosted Zones (PHZ) shared via RAM. Workload account VPCs associate with the central PHZ — they don't manage their own. The Network account hosts both inbound and outbound Route 53 Resolver endpoints, enabling bidirectional DNS forwarding with on-premises.

Workload account DHCP option sets point to the Network account Resolver IPs — workload instances resolve internal names without any per-account DNS configuration.

---

## 7. Security Baseline & Identity

### Security Services Delegation

Control Tower enrolls the Audit account as the delegated administrator for security services. Extend this to all security services: Security Hub, GuardDuty, Macie, and Inspector v2 should all be centrally managed from the Audit account, not the management account.

**Never manage security services from the management account.** If your management account is compromised, the attacker shouldn't be able to turn off your detection capabilities. Delegating to the Audit account creates separation — the Audit account has no workloads and no ability to affect the org structure.

Enable `auto_enable = true` on the Security Hub org configuration so new accounts are automatically enrolled. Do the same for GuardDuty's org configuration.

### IAM Identity Center (SSO) Design

Use an external IdP (Azure AD or Okta) as the identity source, synced to IAM Identity Center via SCIM. Define permission sets centrally in the management account:

| Permission Set | Who Gets It | Session Duration |
|---|---|---|
| `AdministratorAccess` | Platform team only, MFA enforced | 1 hour |
| `PowerUser` | Team leads | 4 hours |
| `ReadOnly` | All engineers, always on | 8 hours |
| `BillingView` | Finance team | 8 hours |
| `SecurityAudit` | Security team, all accounts | 4 hours |

**Rule of thumb:** Production accounts get 1–2 hour sessions. Dev/sandbox accounts can use 4–8 hours.

### Break-Glass Pattern

Every account should have a `BreakGlassRole` deployed via AFT global customizations. This role has `AdministratorAccess`, but requires both MFA and an `ExternalId` (stored in Secrets Manager) to assume. It's excluded from restrictive SCPs so it can act during emergencies when normal access paths fail.

Every use of the break-glass role must trigger a CloudWatch alarm and page the security team. The role exists for genuine emergencies — SSO outages, production incidents where normal IAM paths are broken. Every use should trigger a post-incident review.

### Eliminating Long-Lived Credentials

All human access should go through IAM Identity Center (short-lived tokens). CI/CD systems should use OIDC federation — GitHub Actions, GitLab, and most modern CI platforms support this natively.

The pattern is: CI platform presents an OIDC token → IAM evaluates the `sub` claim (e.g., `repo:myorg/myapp:*`) → issues temporary STS credentials. No IAM user, no long-lived access key. An SCP blocking `iam:CreateAccessKey` for non-service-account principals enforces this at the org level.

---

## 8. Logging & Observability

### Centralized Logging Architecture

Every account ships logs to the Log Archive account's S3 bucket. The sources are: CloudTrail (org trail from management account), VPC Flow Logs, Config delivery snapshots, ALB access logs, WAF logs, and GuardDuty findings.

The Log Archive S3 bucket uses **S3 Object Lock in COMPLIANCE mode** — not Governance. Governance mode can be overridden by users with `s3:BypassGovernanceRetention`. Compliance mode cannot be overridden by anyone, including root. Set retention to at minimum 365 days; regulatory requirements often require 7 years.

The bucket policy must deny `s3:DeleteObject`, `s3:DeleteBucket`, `s3:DeleteBucketPolicy`, and `s3:PutBucketPolicy` for everyone except the break-glass role. CloudTrail delivery is allowed via a `Service: cloudtrail.amazonaws.com` principal scoped with `aws:SourceOrgID` — this prevents accounts outside your org from writing to the bucket.

### Organization CloudTrail

One org trail in the management account covers all accounts and all regions. Key settings:

- `is_organization_trail = true` — covers every account in the org automatically
- `is_multi_region_trail = true` — captures events from all regions
- `enable_log_file_validation = true` — detect tampered log files
- `include_global_service_events = true` — captures IAM, STS, and Route 53 events

For data events (S3 object-level, Lambda invocations): **be selective**. Data events are expensive at org scale. Only enable them for sensitive buckets (like the log archive bucket itself) and high-value Lambda functions.

Enable CloudTrail Insights for both `ApiCallRateInsight` and `ApiErrorRateInsight` — these detect unusual API patterns at low cost and are genuinely useful for catching credential abuse.

### Security Hub Configuration

In the Audit account (delegated admin), enable `auto_enable = true` so new accounts are automatically enrolled. Subscribe to both the CIS AWS Foundations Benchmark (v1.4.0) and AWS Foundational Security Best Practices standards.

**Security Hub cost management:** Each active finding costs money. Suppress findings that don't apply to your environment using automated suppression rules. Build a Lambda triggered by EventBridge that looks at incoming findings and suppresses known expected ones (for example, Config findings in regions you've intentionally restricted via SCP). Use `Workflow: SUPPRESSED` — don't dismiss findings manually.

---

## 9. Multi-Region Strategy

### Active Region vs Governed Region

Define two categories of regions clearly before you start:

- **Active region:** Workloads run here. Full networking, logging, security services deployed.
- **Governed region:** No workloads, but security controls still active (Config, GuardDuty) to prevent shadow deployments.

The `DenyUnapprovedRegions` SCP blocks resource creation in ungoverned regions. GuardDuty enabled in governed regions catches any bypasses. This combination — preventive (SCP) plus detective (GuardDuty) — is more reliable than either alone.

### Multi-Region AFT Customization

AFT runs customizations in the CT home region only by default. To enable multi-region security baseline, use AFT's Python API hooks to programmatically enable GuardDuty and delete default VPCs across all governed regions. The hooks run before and after Terraform applies, making them ideal for cross-region boto3 operations that Terraform's provider model handles awkwardly.

### Region Failover Considerations

Transit Gateway is regional — cross-region failover requires a choice:

- **TGW peering** — two TGWs peered across regions, workloads route to both. Most complex, highest operational overhead.
- **Route 53 health checks + failover routing** — DNS-based failover at the application layer. Sufficient for most enterprises and significantly simpler.
- **Global Accelerator** — Anycast routing with automatic failover. Higher cost, but removes DNS TTL as a variable in your recovery time.

For most enterprises, Route 53 failover routing is the right default. Reserve TGW peering for workloads with strict network-level failover requirements.

---

## 10. Day-2 Operations & Customization Pipelines

### Drift Detection

CT performs drift detection and will flag accounts that have been manually modified outside of CT/AFT. Common drift causes:

- Manual SCP changes in the Organizations console
- Direct IAM Identity Center modifications bypassing AFT
- CT version upgrades applying changes AFT doesn't know about
- SCPs added by AWS during CT upgrades conflicting with custom SCPs

Check `landingZones[].driftStatus` in the CT API regularly. The most reliable remediation is re-running AFT customization pipelines after any CT upgrade. Always test CT upgrades in a staging org first.

### Account Offboarding

Deleting AWS accounts is irreversible and has a 90-day suspension period. Follow this sequence strictly:

1. **Suspend workloads** — tag account as "offboarding", remove from service discovery
2. **Move to Suspended OU** — restrictive SCP blocks all new resource creation
3. **Data backup** — export any required data (S3 snapshots, RDS final snapshots)
4. **Remove SSO assignments** — users can no longer access the account
5. **Terminate all resources** — use AWS Nuke or manual cleanup; keep `AWSControlTowerExecution` and `BreakGlassRole` until the last step
6. **Remove from TGW** — detach VPC attachments from the Transit Gateway
7. **Close account** — via CT console → Account Factory → Close Account (90-day suspension before permanent deletion)

### Quarterly Landing Zone Review Checklist

SCPs and security baselines need regular review. Run this quarterly:

**Control Tower**
- CT landing zone version — any updates available?
- CT managed guardrails — any new mandatory guardrails enabled by AWS?

**SCPs**
- Review Exceptions OU membership — any accounts that should be moved back?
- Review SCP deny list — any new dangerous actions to block?
- Test break-glass role still works (in staging org)

**AFT**
- AFT module version updates (`aws-ia/control_tower_account_factory/aws`)
- Terraform version — any updates to pin to?
- Global customization drift — re-run against a sample account

**Security**
- Security Hub findings backlog — triage unresolved HIGH/CRITICAL
- GuardDuty threat intelligence — any new threat feeds to enable?
- IAM Access Analyzer — review new findings in each account
- CloudTrail Insights — any anomalous API patterns?

**Networking**
- IPAM utilization — approaching exhaustion in any pool?
- TGW routing table — any stale routes from decommissioned accounts?
- VPC Flow Logs — any unexpected cross-account traffic patterns?

### Testing Your Landing Zone

Landing zone changes are high-blast-radius. Maintain a **shadow organization** (`myorg-test`) that mirrors your production CT/AFT setup. Apply all landing zone changes there first, run automated compliance tests, and promote to production after validation. Never test landing zone changes directly in your production org.

Automated tests to run against every account in the shadow org:

- CloudTrail org trail is active and logging
- S3 Block Public Access is enabled at the account level
- GuardDuty detector is enabled and in ENABLED state
- Default VPC is deleted in all regions
- No IAM users with console access (all access via SSO)
- Security Hub is enrolled and reporting findings