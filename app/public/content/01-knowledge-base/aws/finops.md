# AWS FinOps

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [FinOps Fundamentals & Maturity Model](#1-finops-fundamentals-maturity-model) | What FinOps is, the crawl-walk-run maturity framework, and common failure modes when getting started. |
| **02** | [Cost Visibility Architecture](#2-cost-visibility-architecture) | Account structure for cost isolation, Cost Explorer, CUR, and building a queryable cost data lake. |
| **03** | [Tagging Strategy & Allocation](#3-tagging-strategy-allocation) | Tag taxonomy, enforcement via SCP and Config, shared cost allocation, and untagged resource recovery. |
| **04** | [Savings Plans & Reserved Instances](#4-savings-plans-reserved-instances) | SP types, RI types, purchase decision framework, coverage targets, and management at org level. |
| **05** | [Spot Instances](#5-spot-instances) | Spot interruption model, mixed fleet ASG design, Spot for containers, and workload suitability. |
| **06** | [Rightsizing & Waste Elimination](#6-rightsizing-waste-elimination) | Compute Optimizer integration, idle resource detection, GP2→GP3 migration, and S3 cost patterns. |
| **07** | [Unit Economics & Showback/Chargeback](#7-unit-economics-showbackchargeback) | Cost per unit metrics, showback vs chargeback models, team accountability, and P&L mapping. |
| **08** | [Cost Anomaly Detection](#8-cost-anomaly-detection) | AWS Cost Anomaly Detection setup, SNS alerting, custom monitors, and runbook for spike investigation. |
| **09** | [Data Transfer Cost Optimization](#9-data-transfer-cost-optimization) | Inter-AZ, inter-region, NAT Gateway, CloudFront, and PrivateLink cost patterns and mitigations. |
| **10** | [Kubernetes & Container Cost Allocation](#10-kubernetes-container-cost-allocation) | EKS node cost attribution, Kubecost integration, namespace-level chargeback, and Fargate economics. |
| **11** | [FinOps Tooling Landscape](#11-finops-tooling-landscape) | Native AWS tools vs third-party (Apptio, CloudHealth, Vantage, FOCUS), trade-off comparison. |
| **12** | [Governance & Operating Model](#12-governance-operating-model) | FinOps team structure, weekly cadence, budget alerts, SCP guardrails, and budget escalation paths. |
| **13** | [Day-2 Ops Checklist](#13-day-2-ops-checklist) | Weekly, monthly, and quarterly FinOps review cadence with concrete action items. |

---

## 1. FinOps Fundamentals & Maturity Model

### What FinOps Actually Is

FinOps is the practice of bringing financial accountability to the variable-spend model of cloud. It is not a cost-cutting program — it is a discipline that enables engineering teams to make informed trade-offs between speed, cost, and quality. The FinOps Foundation defines it as a cultural practice, not a tooling problem. The tools matter, but without organizational buy-in and defined ownership, no amount of dashboarding changes spending behavior.

The central tension in FinOps: **engineering teams control the spend but do not feel the cost; finance teams feel the cost but cannot control it.** FinOps closes that gap by making cost a first-class engineering metric, visible at the team or product level, with the same rigor applied to latency or error rate.

### The Crawl-Walk-Run Maturity Model

The FinOps Foundation's maturity model is a useful honest assessment tool. Most organizations overestimate their maturity.

| Phase | Capability | Organizational Signal |
| :--- | :--- | :--- |
| **Crawl** | Basic visibility: total AWS bill visible; rough breakdown by account; tagging policy exists on paper | Someone owns the AWS bill; teams are aware costs exist; no team-level accountability |
| **Walk** | Allocation: costs attributed to teams or products with >80% coverage; anomaly alerting in place; first commitment purchases (Savings Plans) | Engineering leads see their team's spend in weekly reviews; FinOps function exists (even if one person) |
| **Run** | Optimization: unit economics tracked; commitment coverage >80%; rightsizing automated or on a regular cadence; chargeback or showback integrated with P&L | Product teams own their unit cost targets; cost efficiency is in sprint planning; FinOps is embedded in architecture reviews |

**Common anti-pattern:** Organizations jump to "run" tooling (Kubecost, Apptio, full chargeback) before establishing "crawl" foundations (tagging coverage, account-level visibility). The tooling cannot allocate costs that are not tagged or structured for attribution.

### FinOps Is a Team Sport

FinOps requires three functions to collaborate:

- **Engineering:** Makes the architectural and code-level decisions that drive cost. Must have visibility into cost impact of their choices.
- **Finance:** Owns budgeting, forecasting, and variance analysis. Must understand AWS's variable cost model (not like on-premise capex).
- **FinOps practitioner:** Bridges both worlds. Translates AWS billing concepts to finance; translates budget pressure to actionable engineering recommendations.

In small organizations (< 50 engineers), this is typically one person wearing all three hats. In large organizations, a dedicated FinOps team of 3–8 people is common for $5M+ annual AWS spend.

### The Most Common FinOps Failure Modes

| Failure Mode | Symptom | Root Cause |
| :--- | :--- | :--- |
| Tag hygiene neglect | 40%+ costs unallocated; monthly "who owns this?" investigations | Tagging enforced inconsistently; no SCP enforcement at launch |
| Savings Plans panic-buying | Over-committed on compute SPs; flexible workloads not covered | Purchased SPs based on peak spend without understanding coverage vs utilization |
| Rightsizing theater | Recommendations generated; nothing actioned | No ownership assigned; recommendations delivered to the wrong team; fear of performance regression |
| Data transfer blindness | Unexpected $50K data transfer bill | Inter-AZ traffic from microservices not visible until billing; no transfer cost in architecture reviews |
| Dashboard proliferation | 5 cost dashboards; none trusted | Different tools with different allocation logic; teams dispute numbers instead of acting |

---

## 2. Cost Visibility Architecture

### Account Structure as Cost Allocation Primitive

The AWS account is the strongest cost isolation boundary. Before any tagging or allocation logic, structuring accounts to match your business dimensions gives you clean cost separation in Cost Explorer with zero tag overhead.

Recommended account structure for cost attribution:

```
Root (Management Account)
├── Security OU
│   └── Security Tooling Account         ← security spend isolated
├── Infrastructure OU
│   ├── Shared Services Account          ← networking, DNS, inspection
│   ├── Log Archive Account
│   └── Backup Account
├── Workloads OU
│   ├── Production OU
│   │   ├── Product-A Prod Account       ← Product A production costs
│   │   └── Product-B Prod Account
│   ├── Non-Production OU
│   │   ├── Product-A Dev Account        ← Product A dev costs
│   │   └── Product-A Test Account
│   └── Sandbox OU
│       └── Developer Sandbox Accounts   ← individual dev exploration
└── Platform OU
    └── Platform Engineering Account     ← platform team's own tools
```

With this structure, filtering Cost Explorer by linked account gives immediate product/team cost breakdowns without any allocation logic. This is the cheapest and most reliable cost attribution method available.

### Cost Explorer: What It Can and Cannot Do

Cost Explorer is the native AWS cost visualization tool. It operates on billing data with a 24-hour lag. It is good for:

- Month-to-date spend by account, service, region, tag.
- Savings Plans and RI utilization and coverage reports.
- Rightsizing recommendations (EC2).
- Forecasting based on historical trend.

It is not good for:

- Hourly granularity beyond the last 14 days (daily is the finest for most queries).
- Custom allocation logic (e.g., splitting shared infrastructure costs proportionally).
- Joining cost data with your own business metrics (unit cost calculation).
- Any query that takes more than a few seconds — the API rate limits are aggressive for bulk queries.

For anything beyond point-in-time cost exploration, you need the Cost and Usage Report (CUR).

### Cost and Usage Report (CUR) — The Foundation

CUR is a CSV/Parquet dump of every line item in your AWS bill, delivered hourly to an S3 bucket. It is the source of truth for all serious cost analytics. Cost Explorer is built on CUR under the hood.

Enable CUR at the management account level with these settings:

```hcl
resource "aws_cur_report_definition" "main" {
  report_name                = "org-cur-hourly"
  time_unit                  = "HOURLY"
  format                     = "Parquet"
  compression                = "Parquet"
  s3_bucket                  = aws_s3_bucket.cur.bucket
  s3_region                  = "us-east-1"  # CUR must be us-east-1
  s3_prefix                  = "cur"
  additional_schema_elements = ["RESOURCES"]  # Include resource IDs — critical for per-resource allocation
  additional_artifacts       = ["ATHENA"]     # Generate Athena integration files

  report_versioning          = "OVERWRITE_REPORT"
  refresh_closed_months      = true
}
```

**Critical settings:**
- `HOURLY` time unit gives you the finest granularity for anomaly detection and idle resource detection.
- `RESOURCES` schema element adds resource IDs to every line item — without this you cannot attribute costs to specific EC2 instances, RDS databases, or S3 buckets.
- `ATHENA` artifact generates the Glue Catalog and partition projection configuration needed to query CUR with Athena.

### Building the Cost Data Lake

Raw CUR in S3 is queryable via Athena but is large (multi-GB per month for large orgs) and requires understanding the CUR schema (300+ columns). Build a curated layer on top:

```sql
-- Athena view: daily cost by account, service, and team tag
CREATE OR REPLACE VIEW daily_cost_by_team AS
SELECT
  line_item_usage_start_date AS usage_date,
  line_item_linked_account_id AS account_id,
  product_servicecode AS service,
  resource_tags_user_team AS team,
  resource_tags_user_environment AS environment,
  SUM(line_item_unblended_cost) AS unblended_cost,
  SUM(line_item_blended_cost) AS blended_cost
FROM cur_db.cur_table
WHERE
  line_item_line_item_type NOT IN ('Tax', 'Credit', 'Refund')
GROUP BY 1, 2, 3, 4, 5;
```

Send this to a BI tool (QuickSight, Grafana, Superset) for dashboarding. The key discipline is having **one authoritative view** that all teams and finance use — dashboard proliferation is fatal to FinOps credibility.

### Cost Explorer API for Automation

The Cost Explorer API enables programmatic cost data retrieval for custom reporting and anomaly detection:

```python
import boto3
from datetime import datetime, timedelta

ce = boto3.client("ce", region_name="us-east-1")

def get_daily_cost_by_account(days=30):
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    response = ce.get_cost_and_usage(
        TimePeriod={"Start": start, "End": end},
        Granularity="DAILY",
        Metrics=["UnblendedCost", "UsageQuantity"],
        GroupBy=[
            {"Type": "DIMENSION", "Key": "LINKED_ACCOUNT"},
            {"Type": "DIMENSION", "Key": "SERVICE"}
        ]
    )
    return response["ResultsByTime"]
```

**Rate limit warning:** Cost Explorer API allows 1 request per second and has a monthly quota of ~100,000 requests. For bulk historical pulls, use Athena on CUR instead — it does not count against Cost Explorer quotas and is significantly faster for large date ranges.

---

## 3. Tagging Strategy & Allocation

### Tag Taxonomy

A flat, organization-wide tag standard is the prerequisite for cost allocation. Define it once, enforce it universally, and resist the temptation to let individual teams define their own tag schemas.

Recommended mandatory tag set:

| Tag Key | Example Values | Cost Allocation Purpose |
| :--- | :--- | :--- |
| `Team` | `platform`, `data-engineering`, `product-checkout` | Primary cost attribution to team |
| `Environment` | `prod`, `staging`, `dev`, `sandbox` | Cost split between prod and non-prod |
| `Product` | `checkout`, `inventory`, `analytics` | Product-level P&L mapping |
| `CostCenter` | `CC-1042` | Finance system integration |
| `Owner` | `lzy@corp.com` | Escalation contact for anomalies |

Optional but high-value:

| Tag Key | Example Values | Purpose |
| :--- | :--- | :--- |
| `Project` | `PROJ-2025-migration` | Temporary project cost tracking |
| `Terraform` | `true` | Identify IaC-managed vs manual resources |
| `Schedule` | `office-hours` | Instance Scheduler integration |
| `DataClassification` | `confidential`, `internal` | Security + cost reporting correlation |

**Naming convention:** Lowercase with hyphens for both keys and values. `team` not `Team`, `data-engineering` not `DataEngineering`. AWS tag keys are case-sensitive; inconsistent casing creates duplicate allocation buckets in Cost Explorer.

### Enforcing Tags at Resource Creation

Relying on teams to tag voluntarily results in 40–60% untagged resources within months. Enforce at launch time using SCPs:

```json
{
  "Sid": "DenyResourceCreationWithoutRequiredTags",
  "Effect": "Deny",
  "Action": [
    "ec2:RunInstances",
    "rds:CreateDBInstance",
    "elasticloadbalancing:CreateLoadBalancer",
    "es:CreateDomain",
    "elasticache:CreateCacheCluster"
  ],
  "Resource": "*",
  "Condition": {
    "Null": {
      "aws:RequestTag/Team": "true",
      "aws:RequestTag/Environment": "true"
    }
  }
}
```

Apply this SCP to all workload OUs. Exclude the management account and security OU where break-glass operations must not be blocked.

**SCP gotcha:** Many AWS services do not propagate `aws:RequestTag` conditions to all sub-resources created during a single API call. For example, `ec2:RunInstances` creates an instance, a network interface, and a volume — the tag condition applies to the instance but may not block creation if the network interface resource type is not included in the `Resource` field. Test your SCP with `iam-policy-simulator` before applying to production OUs.

### AWS Config Tag Compliance Rules

Complement SCP enforcement (which blocks creation) with Config rules that detect non-compliant resources that slipped through (created before the SCP, created via automation that bypasses the SCP, or AWS-managed resources that cannot be tag-conditioned):

```hcl
resource "aws_config_config_rule" "required_tags" {
  name = "required-tags-ec2-rds"

  source {
    owner             = "AWS"
    source_identifier = "REQUIRED_TAGS"
  }

  input_parameters = jsonencode({
    tag1Key   = "Team"
    tag2Key   = "Environment"
    tag3Key   = "Product"
  })

  scope {
    compliance_resource_types = [
      "AWS::EC2::Instance",
      "AWS::RDS::DBInstance",
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      "AWS::S3::Bucket"
    ]
  }
}
```

Wire Config non-compliance notifications to a Slack channel or ticketing system. The SLA for tagging a non-compliant resource should be 48 hours. Resources still non-compliant after 7 days should be flagged for automated stop (non-prod) or escalation (prod).

### Shared Cost Allocation

Some costs cannot be tagged to a single team — shared infrastructure like Transit Gateway, centralized DNS, Shared Services VPC, and logging pipelines serve all teams. The two approaches:

| Approach | Method | Trade-offs |
| :--- | :--- | :--- |
| **Even split** | Divide shared cost equally across N teams | Simple; unfair if team sizes differ dramatically |
| **Proportional split** | Allocate shared cost proportional to each team's direct spend | Fair; more complex to calculate; requires automation |
| **Platform tax** | Platform team absorbs shared costs as a platform overhead; product teams pay only their direct costs | Cleanest for product teams; obscures platform efficiency |
| **Exclude from allocation** | Shared costs reported separately; not charged to teams | Easy; leaves a cost pool that no one optimizes |

AWS Cost Categories support proportional split natively. Define a cost category that maps shared service account costs to product teams using the `PROPORTIONAL` allocation rule:

```json
{
  "Name": "SharedInfraAllocation",
  "Rules": [
    {
      "Value": "shared-proportional",
      "Rule": {
        "Dimensions": {
          "Key": "LINKED_ACCOUNT",
          "Values": ["shared-services-account-id"]
        }
      }
    }
  ],
  "SplitChargeRules": [
    {
      "Source": "shared-proportional",
      "Targets": ["team-checkout", "team-inventory", "team-analytics"],
      "Method": "PROPORTIONAL"
    }
  ]
}
```

### Recovering Untagged Costs

In any mature environment, there will be a residual pool of untagged costs — typically 5–15% of total spend even with strong enforcement. Strategies for attribution:

- **Resource Groups:** Query AWS Resource Groups for untagged resources by type and correlate with the AWS account owner.
- **CUR resource-level query:** Join `line_item_resource_id` in CUR against a CMDB or Terraform state file to infer ownership from resource naming conventions.
- **Automated tag propagation:** For EC2 instances, propagate tags from the ASG launch template to instances automatically using ASG tag propagation settings. For Lambda, propagate tags from the CloudFormation stack.
- **Last-resort rule:** If a resource cannot be tagged, attribute it to the account owner. Account-level ownership should always be 100% allocated even if resource-level is partial.

---

## 4. Savings Plans & Reserved Instances

### The Commitment Discount Landscape

AWS offers two primary commitment-based discount mechanisms. Understanding the trade-offs between them is essential before purchasing.

| Mechanism | Flexibility | Discount Range | Commitment |
| :--- | :--- | :--- | :--- |
| **Compute Savings Plans** | Any EC2 region/family/OS, Lambda, Fargate | 17–66% vs on-demand | 1 or 3 year |
| **EC2 Instance Savings Plans** | Specific instance family + region | Up to 72% vs on-demand | 1 or 3 year |
| **Standard Reserved Instances** | Specific instance type, region, OS | Up to 72% | 1 or 3 year |
| **Convertible Reserved Instances** | Any instance type within same family | Up to 66% | 1 or 3 year |
| **RDS Reserved Instances** | Specific DB engine, class, region | Up to 69% | 1 or 3 year |
| **ElastiCache Reserved Nodes** | Specific node type, region | Up to 55% | 1 or 3 year |
| **Redshift Reserved Nodes** | Specific node type | Up to 75% | 1 or 3 year |

### Savings Plans vs Reserved Instances: The Decision

Savings Plans (SPs) are the default choice for EC2, Lambda, and Fargate spend. They are more flexible than RIs and apply automatically across your organization. Reserved Instances remain relevant for RDS, ElastiCache, and Redshift — services not covered by Savings Plans — and for EC2 scenarios where you have high confidence in a specific instance family and region.

**Use Compute Savings Plans when:**
- Your workloads span multiple instance families or regions.
- You are migrating to Graviton and want the SP to cover both the migration source and target.
- You have Lambda or Fargate spend worth discounting.

**Use EC2 Instance Savings Plans when:**
- You have high-confidence, stable demand in a specific instance family and region (e.g., you will definitely run `m6g` in `ap-southeast-1` for the next year).
- The additional discount over Compute SPs justifies the reduced flexibility.

**Use Standard RIs for:**
- RDS (no SP equivalent).
- ElastiCache (no SP equivalent).
- Redshift (no SP equivalent).
- EC2 when you need the maximum discount and have near-certain instance type stability.

### Coverage and Utilization: The Two Metrics That Matter

FinOps practitioners track two distinct SP/RI metrics that are frequently confused:

- **Coverage:** What percentage of your eligible on-demand spend is covered by SPs or RIs? Low coverage means you are leaving discount money on the table.
- **Utilization:** What percentage of your SP/RI commitment is being consumed? Low utilization means you bought more than you are using — you are paying for commitment you do not need.

The target is **high coverage and high utilization simultaneously.** The common failure is purchasing SPs to achieve high coverage without monitoring utilization — you end up fully covered but wasting 20% of the commitment.

Target thresholds:

| Metric | Target | Alarm Threshold |
| :--- | :--- | :--- |
| SP Coverage (EC2) | >80% | < 70% |
| SP Utilization | >95% | < 90% |
| RI Utilization (RDS) | >95% | < 85% |

### Purchase Strategy at Org Level

Purchase SPs and RIs from the **management account**. SPs purchased in the management account apply to all linked accounts automatically (Compute SPs share across the org by default).

**Step-by-step purchase process:**

- Pull the last 30 days of on-demand EC2 spend from Cost Explorer. Exclude any spend that is already SP/RI covered.
- Use Cost Explorer's Savings Plans purchase recommendations. Filter to `1-year`, `No Upfront` (for flexibility) or `Partial Upfront` (for additional discount if cash flow allows).
- Start conservatively — purchase 70% of the recommended amount on your first purchase. Expand after observing utilization for 30 days.
- For RDS, pull database instance hours by type and region from CUR. Purchase RIs for instance types with stable, predictable usage (production databases; not dev instances).

```python
import boto3

ce = boto3.client("ce", region_name="us-east-1")

def get_sp_recommendations(lookback_days=30, term="ONE_YEAR", payment="NO_UPFRONT"):
    response = ce.get_savings_plans_purchase_recommendation(
        SavingsPlansType="COMPUTE_SP",
        TermInYears=term,
        PaymentOption=payment,
        LookbackPeriodInDays=f"LAST_{lookback_days}_DAYS",
        AccountScope="ORGANIZATION"
    )
    rec = response["SavingsPlansRecommendation"]
    summary = rec["SavingsPlansRecommendationSummary"]
    print(f"Recommended hourly commitment: ${summary['HourlyCommitmentToDeploy']}")
    print(f"Estimated monthly savings: ${summary['EstimatedMonthlySavingsAmount']}")
    print(f"Estimated coverage: {summary['EstimatedSavingsPercentage']}%")
    return rec
```

### Managing SPs Across Org: Guardrails

At scale, uncoordinated SP purchases across linked accounts create commitment debt. Establish these guardrails:

- Only the management account (or a designated FinOps account with delegated access) can purchase SPs and RIs. Enforce via SCP:

```json
{
  "Sid": "RestrictSavingsPlanPurchase",
  "Effect": "Deny",
  "Action": [
    "savingsplans:CreateSavingsPlan",
    "ec2:PurchaseReservedInstancesOffering"
  ],
  "Resource": "*",
  "Condition": {
    "StringNotEquals": {
      "aws:PrincipalAccount": "${management_account_id}"
    }
  }
}
```

- Set a CloudWatch alarm on `SavingsPlansUtilization` dropping below 90%. A sharp utilization drop often signals a workload migration or decommission that left commitments orphaned.
- Review SP expiry 90 days before renewal. Do not let SPs auto-expire without reviewing whether the workload they covered still exists.

---

## 5. Spot Instances

### The Spot Interruption Model

Spot instances run on spare EC2 capacity at discounts of 60–90% vs on-demand. AWS reclaims Spot instances with a 2-minute warning when capacity is needed. This model fundamentally changes what workloads are appropriate for Spot.

Spot instances are appropriate for:
- Stateless, horizontally scalable workloads (web tier behind a load balancer)
- Batch processing and data pipelines where jobs can be checkpointed and retried
- CI/CD build agents
- Development and test environments
- Machine learning training jobs with checkpoint support
- Kubernetes worker nodes (with graceful pod eviction on interruption)

Spot instances are **not** appropriate for:
- Stateful single-instance workloads (a lone RDS alternative on EC2)
- Workloads with strict latency SLAs that cannot tolerate a 2-minute interruption
- Leader/coordinator nodes in distributed systems without fast re-election

### Mixed Fleet ASG Design

Never run a Spot-only fleet. A mixed On-Demand + Spot fleet provides cost savings while guaranteeing baseline capacity:

```hcl
resource "aws_autoscaling_group" "web_tier" {
  name               = "web-tier-mixed"
  min_size           = 2
  max_size           = 20
  vpc_zone_identifier = var.private_subnet_ids

  mixed_instances_policy {
    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.web.id
        version            = "$Latest"
      }

      override {
        instance_type = "m6g.large"
      }
      override {
        instance_type = "m6i.large"
      }
      override {
        instance_type = "m5.large"
      }
      override {
        instance_type = "m5a.large"
      }
    }

    instances_distribution {
      on_demand_base_capacity                  = 2      # Always 2 on-demand instances
      on_demand_percentage_above_base_capacity = 20     # 20% on-demand, 80% Spot above base
      spot_allocation_strategy                 = "price-capacity-optimized"
    }
  }
}
```

**Instance type diversification:** List 4–6 instance types of similar size across multiple families. This dramatically increases Spot availability and reduces interruption probability. `price-capacity-optimized` strategy is the current AWS recommendation — it chooses from pools with the highest capacity availability, not just the lowest price, reducing interruption frequency.

### Spot for EKS Worker Nodes

EKS nodes can be Spot instances. The key requirement is graceful pod eviction on interruption:

- Deploy the [AWS Node Termination Handler](https://github.com/aws/aws-node-termination-handler) as a DaemonSet. It listens to EC2 instance metadata for Spot interruption notices and cordons + drains the node before AWS reclaims it.
- Use separate node groups for On-Demand (system workloads, stateful pods) and Spot (stateless application pods).
- Apply node selector or toleration policies to route appropriate workloads to Spot nodes:

```yaml
spec:
  nodeSelector:
    eks.amazonaws.com/capacityType: SPOT
  tolerations:
    - key: "spot"
      operator: "Equal"
      value: "true"
      effect: "NoSchedule"
```

### Spot Savings Tracking

Track realized Spot savings vs on-demand equivalent in CUR:

```sql
SELECT
  line_item_usage_start_date,
  SUM(line_item_unblended_cost) AS spot_cost,
  SUM(line_item_unblended_rate * line_item_usage_amount) AS spot_equivalent_demand_cost,
  SUM(line_item_unblended_rate * line_item_usage_amount) - SUM(line_item_unblended_cost) AS savings
FROM cur_db.cur_table
WHERE
  line_item_line_item_type = 'Usage'
  AND pricing_term = 'Spot'
GROUP BY 1
ORDER BY 1;
```

---

## 6. Rightsizing & Waste Elimination

### AWS Compute Optimizer

Compute Optimizer analyzes CloudWatch metrics for EC2, Lambda, ECS on Fargate, Auto Scaling Groups, and EBS volumes. It generates rightsizing recommendations based on actual utilization patterns over 14 days (or up to 3 months with enhanced infrastructure metrics).

Enable at the org level from the management account:

```hcl
resource "aws_computeoptimizer_enrollment_status" "org" {
  status = "Active"
  include_member_accounts = true
}
```

Compute Optimizer recommendations have three findings:

| Finding | Meaning | Action |
| :--- | :--- | :--- |
| `OVER_PROVISIONED` | CPU, memory, or network below 40% of capacity consistently | Downsize or change instance family |
| `UNDER_PROVISIONED` | CPU or memory above 90% of capacity — performance risk | Upsize |
| `OPTIMIZED` | Utilization within expected range | No action needed |
| `NOT_OPTIMIZED` | Insufficient data (< 30 hours of metrics) | Wait; or enable Enhanced Infrastructure Metrics |

### Rightsizing Action Pipeline

The gap between "recommendation generated" and "resource resized" is where most rightsizing programs fail. Build a pipeline that automates the easy cases and surfaces the hard cases for human review:

```python
import boto3

co = boto3.client("compute-optimizer")

def get_ec2_recommendations(account_ids):
    response = co.get_ec2_instance_recommendations(
        accountIds=account_ids,
        filters=[
            {
                "name": "Finding",
                "values": ["OVER_PROVISIONED"]
            }
        ]
    )
    for rec in response["instanceRecommendations"]:
        instance_id = rec["instanceArn"].split("/")[-1]
        current_type = rec["currentInstanceType"]
        # Take the top recommendation
        if rec["recommendationOptions"]:
            top = rec["recommendationOptions"][0]
            recommended_type = top["instanceType"]
            savings = top["estimatedMonthlySavings"]["value"]
            print(f"{instance_id}: {current_type} → {recommended_type} (save ${savings:.2f}/month)")
```

Automate rightsizing for non-prod instances (dev, sandbox) where a wrong sizing decision has low blast radius. Require human approval for production. Use the ASG instance refresh feature for zero-downtime rightsizing of instances in ASGs.

### Idle Resource Detection

Idle resources are running but generating zero or near-zero useful work. Common categories:

| Resource Type | Idle Signal | Monthly Waste Estimate |
| :--- | :--- | :--- |
| EC2 instances | CPU < 5% for 7+ days | Full on-demand cost |
| RDS instances | `DatabaseConnections = 0` for 7+ days | Full on-demand cost |
| Load balancers (ALB/NLB) | `RequestCount = 0` for 7+ days | ~$16–22/month/LB + data |
| Elastic IPs | Not associated with a running instance | $3.60/month each |
| Unattached EBS volumes | Not attached to any instance | Full provisioned cost |
| Old EBS snapshots | Created > 90 days ago; no deletion policy | $0.05/GB-month |
| Unused NAT Gateways | `BytesOutToDestination = 0` for 7 days | ~$32/month + data |

Detect idle resources with this CloudWatch Insights query for zero-traffic load balancers:

```
fields @timestamp, @message
| filter @logStream like /ELB/
| stats sum(RequestCount) as total_requests by LoadBalancer
| filter total_requests = 0
```

Or via CUR for zero-connection RDS:

```sql
SELECT
  line_item_resource_id,
  SUM(line_item_unblended_cost) AS monthly_cost
FROM cur_db.cur_table
WHERE
  product_servicecode = 'AmazonRDS'
  AND line_item_line_item_type = 'Usage'
  AND month = 6
GROUP BY 1
HAVING monthly_cost > 100
ORDER BY 2 DESC;
```

Cross-reference with CloudWatch `DatabaseConnections` metric for zero-connection instances to identify idle RDS spend.

### GP2 → GP3 EBS Migration

GP2 volumes are the legacy default EBS type. GP3 is 20% cheaper and offers independently configurable IOPS and throughput (no need to over-provision volume size to get IOPS). GP3 delivers 3,000 IOPS baseline for free (vs GP2's 100 IOPS/GB).

Migration is non-disruptive — it happens live with no downtime. The only scenario requiring caution is a GP2 volume that is intentionally sized large *only* to get IOPS (e.g., a 5 TB GP2 volume for 15,000 IOPS). Migrating to GP3 requires explicitly setting IOPS to 15,000 to maintain performance.

```bash
# Identify all GP2 volumes and their provisioned IOPS-to-size ratio
aws ec2 describe-volumes \
  --filters Name=volume-type,Values=gp2 \
  --query 'Volumes[*].{ID:VolumeId,Size:Size,IOPS:Iops,State:State}' \
  --output table

# Migrate a volume to GP3
aws ec2 modify-volume \
  --volume-id vol-0abc123 \
  --volume-type gp3 \
  --iops 3000 \
  --throughput 125
```

At scale, automate this with a Lambda function triggered by Config rule detecting GP2 volumes. Estimate savings: GP3 is $0.08/GB-month vs GP2's $0.10/GB-month in most regions — 20% reduction on all EBS spend.

### S3 Cost Patterns

S3 costs are often misunderstood because they have four distinct components:

| Component | Cost Driver | Optimization |
| :--- | :--- | :--- |
| **Storage** | GB-month by storage class | Lifecycle policies to transition cold data to Glacier/IA |
| **Requests** | GET/PUT/LIST/DELETE counts | Avoid list-heavy patterns; use S3 Inventory instead of recursive LIST |
| **Data transfer** | GB leaving S3 to internet or cross-region | Use CloudFront for public assets; S3 Transfer Acceleration rarely cost-effective |
| **Replication** | GB replicated cross-region | Review replication scope — is full bucket replication necessary? |

S3 Intelligent-Tiering is appropriate when you cannot predict access patterns. It automatically moves objects between tiers based on access frequency. The monitoring fee ($0.0025 per 1,000 objects) is worth it when objects are frequently accessed but unpredictably — if objects are clearly either hot (accessed daily) or cold (accessed rarely), explicit lifecycle policies are cheaper.

**S3 multipart upload zombie cost:** Incomplete multipart uploads accumulate indefinitely unless you have a lifecycle rule to abort them. A single large failed upload can silently consume storage for months.

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "transition-to-ia"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER_IR"
    }
  }
}
```

---

## 7. Unit Economics & Showback/Chargeback

### Unit Economics: Cost Per Business Metric

Unit economics is the practice of expressing cloud cost in terms of business value delivered. Raw cost numbers ("we spent $200K on AWS last month") are hard to act on. Unit cost ("we spent $0.0043 per API call" or "$12.50 per active customer per month") tells you whether cost is growing in line with value.

Define unit cost metrics that are meaningful to your business:

| Business Model | Unit Metric | Example Cost |
| :--- | :--- | :--- |
| SaaS (per seat) | Cost per active user per month | $3.50/user/month |
| E-commerce | Cost per order processed | $0.18/order |
| API product | Cost per 1,000 API calls | $0.42/1,000 calls |
| Data platform | Cost per TB processed | $8.20/TB |
| Gaming | Cost per DAU per day | $0.009/DAU/day |

Calculate unit cost by joining AWS cost data (from CUR) with business metrics (from your data warehouse or analytics platform). This join is the hardest part — it requires an agreed definition of "one unit" and consistent metric tracking.

```python
# Pseudocode: unit cost calculation
monthly_aws_cost = get_cost_from_cur(team="checkout", month="2025-06")
monthly_orders = get_from_datawarehouse("SELECT COUNT(*) FROM orders WHERE month = '2025-06'")
cost_per_order = monthly_aws_cost / monthly_orders
print(f"Cost per order: ${cost_per_order:.4f}")
```

The goal is a trend line. A rising cost per order when order volume is flat signals inefficiency. A rising cost per order when order volume is growing rapidly may be acceptable — the unit cost will often decrease after the initial scale-up.

### Showback vs Chargeback

| Model | Description | Appropriate For |
| :--- | :--- | :--- |
| **Showback** | Teams see their costs in a report; no actual budget transfer | Early FinOps maturity; building cost culture without creating friction |
| **Chargeback** | Teams are billed for their AWS usage; actual P&L impact | Mature organizations; multiple P&Ls; strong cost accountability culture |
| **Hybrid** | Showback for shared infrastructure; chargeback for direct team costs | Common middle ground |

**Showback is underrated.** The behavioral change from "I see my cost" is 70–80% of the value of chargeback without the political overhead of inter-team billing disputes. Most organizations should run showback for 6–12 months before evaluating chargeback.

For chargeback, the most common implementation is a monthly report from the FinOps team to finance that maps AWS costs to cost centers. Finance then does the internal transfer. Do not build a custom billing system — the overhead is not worth it.

### Making Showback Actionable

A showback report that lands in an inbox once a month and gets ignored delivers zero value. Showback is effective when:

- It is delivered in the team's operational tooling (Slack, not email).
- It is actionable — it includes specific resources, not just totals.
- It has a clear owner for every line item.
- It shows trend (is this week's cost higher or lower than last week?).

A weekly Slack message with team-level cost summary and the top 3 most expensive resources is more effective than a monthly PDF report.

---

## 8. Cost Anomaly Detection

### AWS Cost Anomaly Detection

Cost Anomaly Detection is a native AWS service that uses machine learning to detect unusual cost patterns. It requires no threshold configuration — it learns your baseline and alerts on deviations. This is more powerful than static budget alerts for catching unexpected cost spikes.

Create monitors for each dimension you want to watch independently:

```hcl
resource "aws_ce_anomaly_monitor" "by_service" {
  name         = "AnomalyMonitor-ByService"
  monitor_type = "DIMENSIONAL"

  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_monitor" "by_account" {
  name         = "AnomalyMonitor-ByAccount"
  monitor_type = "DIMENSIONAL"

  monitor_dimension = "LINKED_ACCOUNT"
}

resource "aws_ce_anomaly_subscription" "daily_alert" {
  name      = "DailyAnomalyAlert"
  frequency = "DAILY"

  monitor_arn_list = [
    aws_ce_anomaly_monitor.by_service.arn,
    aws_ce_anomaly_monitor.by_account.arn
  ]

  subscriber {
    address = var.finops_sns_topic_arn
    type    = "SNS"
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      values        = ["100"]  # Alert if anomaly impact > $100
      match_options = ["GREATER_THAN_OR_EQUAL"]
    }
  }
}
```

Set the threshold based on your organization's noise tolerance. $100 is appropriate for a $50K/month AWS bill; for a $500K/month bill, set $500–1,000 to avoid alert fatigue.

### Runbook: Investigating a Cost Anomaly Alert

When an anomaly alert fires, the investigation follows a consistent sequence:

- **Identify the dimension:** The alert will specify the service or account driving the anomaly. Open Cost Explorer and filter to that dimension for the last 7 days.
- **Narrow to service/region/resource:** Within the anomalous service, group by region, then by usage type (e.g., `DataTransfer-Out-Bytes` vs `BoxUsage:m5.large`). The usage type pinpoints the exact cost driver.
- **Identify the resource:** Use the CUR `line_item_resource_id` field to find the specific resource. For EC2, that is an instance ID. For S3, it is a bucket name.
- **Correlate with deployment events:** Check CloudTrail for resource creation events in the same time window. A new EC2 instance launched at the same time as the anomaly start time is almost certainly the cause.
- **Check for data transfer:** Many anomalies are data transfer — a new workload that started moving large amounts of data cross-AZ or to the internet. Check VPC Flow Logs for unusually high-volume flows.
- **Remediate:** Stop/terminate idle resources; adjust architecture to reduce data transfer; if the cost is legitimate (new feature launch), document and update the baseline.

### Static Budget Alerts as Backstop

Cost Anomaly Detection catches unexpected patterns. Budget alerts catch expected-but-exceeded patterns (e.g., you budgeted $100K for Q3 and it is trending to $130K). Use both:

```hcl
resource "aws_budgets_budget" "monthly_org" {
  name         = "monthly-org-spend"
  budget_type  = "COST"
  limit_amount = "150000"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.finops_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.finops_email, var.engineering_vp_email]
  }
}
```

Set budget alerts at 80% actual (early warning) and 100% forecasted (escalation). The forecasted alert is often more valuable — it gives you time to act before the budget is actually exceeded.

---

## 9. Data Transfer Cost Optimization

### The Data Transfer Cost Map

Data transfer is one of the most surprising cost categories for teams new to AWS. The rules are complex and non-intuitive.

| Traffic Path | Cost |
| :--- | :--- |
| Within the same AZ, same VPC | Free |
| Between AZs in the same region | **$0.01/GB each direction** (most impactful hidden cost) |
| Between VPCs in the same region (via VPC peering) | $0.01/GB each direction |
| Between VPCs via Transit Gateway | $0.02/GB processed + $0.05/hr attachment |
| Region to internet (egress) | $0.08–0.09/GB (first 10 TB/month) |
| Region to region | $0.02/GB (varies by region pair) |
| To CloudFront (from S3 or EC2) | Free |
| CloudFront to internet | $0.0085–0.12/GB (varies by region) |

**The inter-AZ cost is the most commonly overlooked.** A microservices architecture with 10 services calling each other frequently can generate millions of cross-AZ API calls per day. At $0.01/GB each way, this accumulates rapidly.

### Detecting Inter-AZ Traffic Cost

CUR usage type `DataTransfer-Regional-Bytes` represents inter-AZ data transfer. Query it:

```sql
SELECT
  line_item_resource_id,
  SUM(line_item_unblended_cost) AS transfer_cost,
  SUM(line_item_usage_amount) AS gb_transferred
FROM cur_db.cur_table
WHERE
  line_item_usage_type LIKE '%DataTransfer-Regional%'
  AND month = 6
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;
```

The top offenders are usually load balancers (which distribute traffic across AZs by default) and microservices with cross-AZ calls.

### Mitigating Inter-AZ Traffic

- **Enable ALB cross-zone load balancing awareness in clients:** Use client-side load balancing (e.g., AWS SDK with AZ affinity) to prefer same-AZ endpoints where possible.
- **Use AZ-local endpoints for high-throughput services:** For services that handle large data volumes, deploy per-AZ instances and use service discovery to route to the local AZ.
- **Topology-aware routing in EKS:** Kubernetes `topologySpreadConstraints` and service topology routing prefer same-AZ pod-to-pod communication.
- **VPC Endpoints for AWS services:** Without VPC endpoints, calls to S3, DynamoDB, and other AWS services from within a VPC can route through a NAT Gateway, incurring NAT Gateway processing fees on top of any data transfer charges.

### NAT Gateway Cost Optimization

NAT Gateway charges two ways: hourly ($0.045/hr per NAT GW, ~$32/month) and per-GB processed ($0.045/GB). A single high-throughput NAT Gateway can generate $10,000+/month in processing fees.

Mitigation strategies:

| Strategy | Savings | Complexity |
| :--- | :--- | :--- |
| VPC Endpoints for S3 and DynamoDB | Eliminates traffic through NAT for these services | Low |
| VPC Interface Endpoints for other AWS services | Eliminates NAT for ECR, CloudWatch, Secrets Manager, etc. | Medium |
| Reduce S3 cross-AZ traffic | Place application and S3 bucket in same region; use S3 VPC endpoint | Low |
| Replace NAT with PrivateLink for inter-service calls | Eliminates NAT for service-to-service traffic | High |
| Centralized NAT Gateway (one per AZ, shared) | Reduces NAT Gateway count | Medium |

The highest-value first step is almost always deploying VPC Endpoints for S3 and DynamoDB. Most AWS workloads transfer significant data to/from S3 and DynamoDB; routing this through a NAT Gateway when VPC Endpoints are free (for gateway endpoints) is pure waste.

---

## 10. Kubernetes & Container Cost Allocation

### The EKS Cost Attribution Problem

EKS presents a unique cost attribution challenge: multiple teams' workloads share the same EC2 node fleet. The EC2 line items in CUR are tagged to the node group, not to individual pods or namespaces. Without additional tooling, you have no visibility into which team's workload consumed which fraction of the node cost.

The two approaches:

- **Node group isolation:** Separate node groups per team, tagged with the team tag. EC2 cost is then directly attributable. This is simple but wastes capacity (teams cannot share idle nodes across the boundary).
- **Proportional namespace allocation:** Run a shared node fleet, then use a tool (Kubecost, OpenCost) to measure each namespace's resource consumption and allocate node cost proportionally. More efficient; more complex.

### Kubecost / OpenCost Integration

[Kubecost](https://www.kubecost.com/) (commercial) and [OpenCost](https://www.opencost.io/) (CNCF open source) are the standard tools for Kubernetes cost allocation. They run as in-cluster deployments and:

- Measure CPU and memory requests/limits and actual usage per pod.
- Allocate node cost proportionally based on resource consumption.
- Integrate with CUR/Cost Explorer for blended cost accuracy (including Spot and SP discounts).
- Expose namespace, label, and deployment-level cost breakdowns.

Deploy OpenCost on EKS:

```bash
helm install opencost opencost/opencost \
  --namespace opencost \
  --create-namespace \
  --set opencost.exporter.defaultClusterId=prod-eks-cluster \
  --set opencost.prometheus.internal.enabled=true
```

Configure with your AWS CUR S3 bucket for accurate pricing (otherwise OpenCost uses on-demand list prices, understating Spot savings):

```yaml
# opencost values.yaml
opencost:
  exporter:
    cloudProviderApiKey: ""  # Not needed for AWS
  aws:
    spot_data_bucket: "my-spot-data-feed"
    spot_data_prefix: "spot"
    project_id: "123456789012"
    spot_data_region: "ap-southeast-1"
```

### Fargate Cost Model

Fargate eliminates the node management overhead but changes the cost model: you pay per vCPU-second and per GB-second of memory consumed by your pods. There is no idle node cost — you pay only for what your pods request.

| Factor | EKS Managed Nodes | Fargate |
| :--- | :--- | :--- |
| Cost model | Node EC2 cost (fixed hourly) | Per pod vCPU + memory (variable) |
| Cost efficiency (high utilization) | Lower — Spot + bin packing | Higher per vCPU than On-Demand EC2 |
| Cost efficiency (low utilization) | Higher — idle nodes waste money | More efficient — no idle pay |
| Spot equivalent | Yes — Spot node groups | No — Fargate Spot available but not for all profiles |
| Right-sizing | Node group instance type | Pod resource requests (critical) |

Fargate is cost-effective for workloads with highly variable or spiky resource usage — you do not pay for idle capacity. It is more expensive than right-sized EC2 Spot for steady-state, high-utilization workloads.

**Critical Fargate cost control:** Fargate charges based on pod resource *requests*, not actual usage. A pod with `resources.requests.cpu: 4` that actually uses 0.5 CPU pays for 4 vCPUs. Right-sizing resource requests is the primary Fargate cost optimization lever.

---

## 11. FinOps Tooling Landscape

### Native AWS Tools

| Tool | Purpose | Limitation |
| :--- | :--- | :--- |
| **Cost Explorer** | Interactive cost visualization and SP/RI recommendations | 24h lag; limited custom allocation logic; no unit economics |
| **Cost and Usage Report** | Raw billing data; foundation for all analytics | Requires Athena/data lake setup; complex schema |
| **Cost Anomaly Detection** | ML-based anomaly alerting | No root cause analysis; alert only |
| **Compute Optimizer** | Rightsizing recommendations | EC2, Lambda, EBS, ECS — not all services |
| **Trusted Advisor** | Cost optimization checks (Idle resources, RI coverage) | Business/Enterprise support required for full checks |
| **AWS Budgets** | Budget alerts and actions | Static thresholds only; no ML |
| **Cost Categories** | Custom cost allocation rules | Limited split-charge logic; no join with external metrics |

### Third-Party FinOps Platforms

| Platform | Strengths | Best For |
| :--- | :--- | :--- |
| **Apptio Cloudability** | Enterprise-grade; strong chargeback; finance integrations | Large enterprises with mature finance requirements |
| **CloudHealth (VMware)** | Multi-cloud; governance + cost in one platform | Multi-cloud organizations with existing VMware relationships |
| **Vantage** | Modern UI; strong Kubernetes cost; CUR-native | Engineering-led FinOps; teams that want self-serve |
| **Spot.io (NetApp)** | Automated Spot optimization; ocean for Kubernetes | Teams wanting hands-off Spot management |
| **ProsperOps** | Fully automated SP/RI management | Organizations that want commitment management outsourced |
| **Kubecost** | Best-in-class Kubernetes cost allocation | EKS-heavy organizations |

### FOCUS: The Emerging Billing Standard

The [FinOps Open Cost and Usage Specification (FOCUS)](https://focus.finops.org/) is a vendor-neutral billing data schema developed by the FinOps Foundation. AWS, Azure, GCP, and Oracle have all committed to supporting it. FOCUS standardizes column names and semantics across cloud providers — a `ServiceName` in FOCUS means the same thing whether you are looking at AWS, Azure, or GCP data.

AWS began publishing FOCUS-formatted CUR in 2024. If you are building a multi-cloud cost platform or evaluating tooling that claims FOCUS support, verify the AWS FOCUS CUR export meets your needs before investing heavily in the legacy CUR format.

---

## 12. Governance & Operating Model

### FinOps Team Structure

| Org Size (AWS Spend) | FinOps Structure | Recommended Staffing |
| :--- | :--- | :--- |
| < $500K/year | No dedicated team | 1 platform engineer owns FinOps as part of role |
| $500K–$2M/year | FinOps champion | 1 dedicated FinOps practitioner; embedded in platform team |
| $2M–$10M/year | FinOps team | 2–3 practitioners; FinOps lead with data + engineering background |
| > $10M/year | FinOps Center of Excellence | 5–8 members; dedicated FinOps lead, data engineer, cloud architect |

The FinOps function should report to either Engineering or Finance — not IT Operations. The key qualification for the FinOps lead is the ability to credibly speak both technical (architecture, AWS services) and financial (P&L, budget cycles) languages.

### The Weekly FinOps Review Cadence

A consistent weekly review meeting is the forcing function that prevents FinOps from becoming a once-a-quarter fire drill. A 30-minute weekly review format:

- **5 min — Cost summary:** WoW and MoM spend delta; forecast vs budget tracking.
- **10 min — Anomalies and spikes:** Review any anomaly alerts from the past week; confirm root cause and remediation status.
- **10 min — Optimization backlog:** One or two specific rightsizing or waste elimination items to action this week. Assign an owner.
- **5 min — Commitment coverage:** SP/RI utilization and coverage; any upcoming expirations.

The meeting should produce at least one specific action item per week. If the meeting has no actions, the FinOps data is not being used.

### SCP Guardrails for Cost Control

Beyond tagging enforcement, several SCPs prevent unexpected cost spikes from infrastructure anti-patterns:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyExpensiveInstanceFamilies",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringLike": {
          "ec2:InstanceType": [
            "p4d.*", "p4de.*", "p3dn.*",
            "trn1n.*", "inf2.*",
            "x1e.*", "x2iezn.*"
          ]
        }
      }
    },
    {
      "Sid": "DenyExpensiveRegions",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": [
            "ap-east-1", "me-south-1", "af-south-1"
          ]
        }
      }
    }
  ]
}
```

Apply instance family restrictions to non-production OUs. GPU instances (p4, p3) and inference instances (inf, trn) in a dev account are almost always a mistake — an engineer experimenting with a `p4d.24xlarge` at $32/hr generates a large bill quickly.

### Budget Actions for Automated Response

AWS Budget Actions can automatically apply IAM policies, SCP policies, or run SSM automation when a budget threshold is crossed. This enables automated cost containment without human intervention:

```hcl
resource "aws_budgets_budget_action" "stop_ec2_on_overspend" {
  budget_name        = aws_budgets_budget.sandbox.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 120  # Trigger at 120% of budget
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.deny_ec2_launch.arn
      roles      = [var.developer_role_arn]
    }
  }

  subscriber {
    address           = var.finops_email
    subscription_type = "EMAIL"
  }
}
```

Use Budget Actions conservatively — automatically denying IAM permissions can break legitimate workflows. Apply them to sandbox accounts where the blast radius is low and clearly communicate the policy to developers.

---

## 13. Day-2 Ops Checklist

### Weekly

- Review Cost Anomaly Detection alerts from the past 7 days — confirm each has a root cause documented and is either resolved or accepted.
- Check SP utilization in Cost Explorer — flag any SP with utilization < 90% for investigation.
- Pull top 10 cost resources by spend per team — route to team leads for context.
- Confirm no new accounts have been added to workload OUs without spoke tagging policy enforcement.
- Verify Budget alert thresholds — update if monthly budget has changed.

### Monthly (First Week of Month)

- Reconcile prior month's actual vs budget by team/product — document and explain variances > 15%.
- Run the idle resource audit: EIPs, unattached EBS, unused NAT Gateways, zero-traffic load balancers.
- Generate Compute Optimizer rightsizing report for all accounts — triage into automated (non-prod) and human-review (prod) queues.
- Review tag compliance Config rule results — assign remediation for non-compliant resources with owners.
- Pull Savings Plans coverage report — if coverage < 75%, prepare a purchase recommendation for review.
- Check for GP2 volumes — run the GP2→GP3 migration for any new volumes added in the prior month.

### Quarterly

- Conduct a full commitment review: audit all active SPs and RIs, their expiry dates, and utilization trends. Decide which to renew, resize, or let expire.
- Review account structure — have any new products or teams been added that warrant a new AWS account for clean cost isolation?
- Run a data transfer cost analysis — identify the top 5 inter-AZ and NAT Gateway consumers and build a remediation plan.
- Assess unit economics trend — is cost per unit improving, stable, or degrading? Present to engineering leadership with context.
- Conduct the quarterly FinOps tooling review — are the current tools meeting needs? Is CUR data feeding the correct BI dashboards?
- Update the FinOps training material for new engineers — include cost awareness in onboarding runbooks.

### Offboarding a Workload or Account

When a workload is being decommissioned or an account retired:

- Terminate all EC2 and RDS resources (stopping is not sufficient — stopped instances still have EBS costs).
- Delete all unattached EBS volumes and snapshots older than the retention policy.
- Release all Elastic IPs.
- Delete unused NAT Gateways and VPC Endpoints.
- Confirm S3 buckets have deletion policies or transfer ownership to an archive account.
- Remove the account from Savings Plans sharing scope if it had dedicated commitments.
- Archive the account's CUR data to Glacier before closing the account — billing data for closed accounts is retained by AWS for 90 days but no longer.
- Update your tagging audit job to remove the decommissioned account from the scan list.
