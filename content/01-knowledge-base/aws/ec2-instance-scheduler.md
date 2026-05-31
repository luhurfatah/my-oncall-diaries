# EC2 Instance Scheduler

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Fundamentals & Solution Landscape](#1-fundamentals-solution-landscape) | What Instance Scheduler is, what it isn't, and when to use it vs alternatives. |
| **02** | [Architecture Deep Dive](#2-architecture-deep-dive) | Component breakdown, DynamoDB schema, Lambda execution model, and EventBridge wiring. |
| **03** | [Deployment & Bootstrap](#3-deployment-bootstrap) | CloudFormation deployment, parameter decisions, IAM cross-account roles, and initial validation. |
| **04** | [Schedule & Period Configuration](#4-schedule-period-configuration) | Period primitives, schedule composition, timezone handling, override mechanics. |
| **05** | [Tagging Strategy](#5-tagging-strategy) | Tag naming, multi-value patterns, enforcement via SCP/Config, and tag governance. |
| **06** | [Multi-Account & Multi-Region](#6-multi-account-multi-region) | Hub-and-spoke model, remote role trust, spoke account onboarding, cross-region constraints. |
| **07** | [RDS Scheduling](#7-rds-scheduling) | RDS differences from EC2, cluster vs instance behavior, Aurora caveats, snapshot-on-stop risk. |
| **08** | [Operational Runbooks](#8-operational-runbooks) | Instance not stopping, instance not starting, DynamoDB config corruption, emergency override. |
| **09** | [Monitoring & Alerting](#9-monitoring-alerting) | CloudWatch metrics emitted, log structure, recommended alarms, and cost validation. |
| **10** | [Cost Impact & Sizing](#10-cost-impact-sizing) | Savings calculation model, scheduler overhead cost, ROI milestones, and reporting. |
| **11** | [Alternatives & Trade-offs](#11-alternatives-trade-offs) | AWS Scheduler vs Instance Scheduler vs custom Lambda vs Auto Scaling schedules. |
| **12** | [Day-2 Ops Checklist](#12-day-2-ops-checklist) | Weekly hygiene, quarterly reviews, offboarding instances cleanly. |

---

## 1. Fundamentals & Solution Landscape

### What Instance Scheduler Actually Is

AWS Instance Scheduler is an AWS-published CloudFormation solution — not a managed service. It deploys a Lambda function, a DynamoDB table, and an EventBridge (formerly CloudWatch Events) scheduled rule into your account. The Lambda function polls DynamoDB every N minutes (configurable, default 5 min), evaluates each defined schedule against current time, and calls `ec2:StartInstances` / `ec2:StopInstances` (or their RDS equivalents) on tagged resources.

The key implication: **you own the infrastructure**. There is no SLA, no automatic update pipeline, no AWS support escalation path for bugs in the solution code. You are running open-source Lambda code that AWS published.

### The Core Value Proposition

Non-production environments — dev, test, staging, sandbox — are typically idle 70–75% of the time (nights + weekends). A standard Mon–Fri 08:00–20:00 schedule runs instances for 60 hours/week vs the baseline 168 hours. That is a **64% reduction in EC2 running hours** for those environments before any right-sizing.

For a fleet with $10,000/month in non-prod EC2 spend, disciplined scheduling realistically recovers $5,000–$7,000/month. Instance Scheduler has near-zero marginal cost at scale (Lambda invocations are sub-dollar for thousands of instances).

### When *Not* to Use Instance Scheduler

Instance Scheduler is the right tool when you have stateful EC2 instances you genuinely want stopped on a schedule. It is the wrong tool in several cases:

| Situation | Better Approach |
| :--- | :--- |
| Stateless, auto-scaling workloads | Set desired capacity to 0 on ASG scheduled action — Instance Scheduler cannot manage ASG instances reliably |
| Containers on ECS/EKS | Scale service desired count to 0 or use Karpenter scale-to-zero |
| One-off immediate stop/start | AWS Systems Manager Run Command or direct Console action — don't configure a schedule for it |
| Environments with strong uptime SLAs | Don't schedule them; use resource rightsizing instead |
| Spot instances | Spot capacity can be reclaimed by AWS independently; scheduling adds no value and complicates tracking |

### Solution Versions

AWS has published multiple versions. The distinction matters for operational decisions:

| Version | Deployment | Notable Changes |
| :--- | :--- | :--- |
| v1.x | CloudFormation (monolithic) | Original; Lambda code directly in CFN; limited cross-account |
| v2.x | CloudFormation | DynamoDB-backed config; cross-account via remote spoke stacks |
| v3.x (current) | CloudFormation + CDK option | Refactored Python codebase; separate hub/spoke templates; improved metrics |

**Recommendation:** Always deploy from the latest release in the [AWS Solutions GitHub repository](https://github.com/aws-solutions/instance-scheduler-on-aws). Do not deploy the version linked directly from the Solutions Library page — it may lag behind the GitHub release by weeks.

---

## 2. Architecture Deep Dive

### Component Map

Instance Scheduler deploys into a **hub account** — typically your Shared Services or Tooling account. Spoke accounts are the environments containing the EC2/RDS instances to be scheduled.

The hub account hosts all control-plane components:

- **EventBridge Rule**: Fires every N minutes (the scheduler interval). Triggers the orchestrator Lambda.
- **Orchestrator Lambda**: Entry point. Reads all account/region targets from DynamoDB, fans out to per-account scheduling Lambda invocations.
- **Scheduling Lambda**: Assumes the cross-account role in each spoke, lists tagged instances, evaluates schedules, and calls start/stop APIs.
- **DynamoDB Table**: Single table storing all configuration — schedules, periods, account mappings, and state tracking.
- **SNS Topic**: Receives Lambda error notifications. Wire this to your alerting stack.
- **CloudWatch Log Groups**: One per Lambda. Structured JSON logs.

### DynamoDB Table Schema

The configuration table uses a simple `type` + `name` primary key. Understanding this schema is critical for debugging and for writing automation that manages schedules programmatically.

| `type` (PK) | `name` (SK) | Purpose |
| :--- | :--- | :--- |
| `schedule` | `<schedule-name>` | Schedule definition with period references and timezone |
| `period` | `<period-name>` | Time window definition (days, begin/end time) |
| `account` | `<account-id>` | Spoke account registration with regions |
| `config` | `scheduler` | Global configuration (interval, default timezone, SSM maintenance) |

A schedule item looks like this in DynamoDB (simplified):

```json
{
  "type": "schedule",
  "name": "office-hours",
  "periods": ["weekday-daytime"],
  "timezone": "Asia/Jakarta",
  "description": "Mon-Fri 08:00-20:00 WIB",
  "enforced": false,
  "retain_running": false,
  "ssm_maintenance_window": ""
}
```

A period item:

```json
{
  "type": "period",
  "name": "weekday-daytime",
  "begintime": "08:00",
  "endtime": "20:00",
  "weekdays": "mon-fri",
  "description": "Standard office hours Monday through Friday"
}
```

### Lambda Execution Model

The scheduling Lambda does not run continuously. It is event-driven on the EventBridge schedule. Each invocation:

1. Lists all EC2 instances in the spoke account/region with the scheduler tag present.
2. For each instance, determines the target state (running/stopped) based on the current time and the schedule named in the tag.
3. Compares target state against the current instance state (stored in DynamoDB and cross-checked against the live AWS state).
4. Calls start/stop only when a state change is needed.
5. Writes updated state back to DynamoDB.

**Critical implication:** The scheduler only acts at invocation time. If the interval is 5 minutes and an instance should start at 08:00, it may actually start anywhere between 08:00 and 08:05. This is expected behavior. If you need precise start times (e.g., a DB must be running before an 08:00 batch job), offset the schedule start by 10–15 minutes.

### State Tracking in DynamoDB

Instance Scheduler writes a state record per instance to DynamoDB. This is how it detects drift — for example, if an instance was manually started outside of schedule hours (`enforced: true` can stop it again; `enforced: false` will leave it running).

State items are stored under `type = instance-state` with the instance ID as the sort key. They include the last action taken, the timestamp, and the schedule name. These records are your primary debugging artifact when an instance isn't behaving as expected.

---

## 3. Deployment & Bootstrap

### Hub Account Deployment

Deploy the hub stack into your Shared Services / Tooling account. The CloudFormation template is `instance-scheduler-main.template` from the GitHub release.

Key parameters and the non-obvious decisions behind them:

| Parameter | Recommended Value | Reasoning |
| :--- | :--- | :--- |
| `SchedulerFrequency` | `5` (minutes) | Lower values mean faster response to schedule windows but higher Lambda cost. 5 min is the sweet spot for most environments. |
| `DefaultTimezone` | Your primary ops timezone | Instances without a timezone override in the schedule use this. Set it to where your ops team is. |
| `ScheduledServices` | `EC2,RDS` | Enable both unless you have a reason not to. Disabling RDS later requires stack update. |
| `CreateRdsSnapshot` | `No` | **Do not enable for non-prod.** Snapshots on every RDS stop are expensive and clutter snapshot retention policies. |
| `MemorySize` | `128` | Sufficient for most deployments. Increase to 256 if you have >500 instances in a single account/region. |
| `LogRetentionDays` | `30` | Balance between debuggability and CloudWatch storage cost. |
| `Regions` | Explicit list | Only schedule regions where you actually have workloads. Every additional region adds Lambda invocations. |
| `StartedTags` | `SchedulerState=started` | Optional but useful. Instance Scheduler adds this tag on start — useful for filtering in Cost Explorer. |
| `StoppedTags` | `SchedulerState=stopped` | Same — visible in Cost Explorer to confirm scheduled instances are actually stopped. |

### Spoke Account Deployment

Deploy `instance-scheduler-spoke.template` into each spoke account. This creates the cross-account IAM role that the hub Lambda assumes.

The spoke stack only creates an IAM role. It has no Lambda, no DynamoDB, no EventBridge. All control plane stays in the hub.

```hcl
# If managing spoke deployments via Terraform (recommended for scale):
resource "aws_cloudformation_stack" "instance_scheduler_spoke" {
  name         = "InstanceSchedulerSpoke"
  template_url = "https://s3.amazonaws.com/solutions-reference/instance-scheduler-on-aws/latest/instance-scheduler-remote.template"

  parameters = {
    InstanceSchedulerAccount = var.hub_account_id
    Namespace                = "dev"
  }

  capabilities = ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"]
}
```

### Registering Spoke Accounts

After deploying the spoke stack, register the account in the hub's DynamoDB. You can do this via the AWS Console (DynamoDB table item editor) or via the AWS CLI:

```bash
aws dynamodb put-item \
  --table-name InstanceScheduler-ConfigTable \
  --item '{
    "type": {"S": "account"},
    "name": {"S": "123456789012"},
    "regions": {"SS": ["ap-southeast-1", "ap-southeast-3"]},
    "role_name": {"S": "InstanceSchedulerCrossAccountRole"},
    "account_name": {"S": "dev-workloads"}
  }'
```

**Gotcha:** The `role_name` value must exactly match the IAM role name created by the spoke CloudFormation stack. The default is `InstanceSchedulerCrossAccountRole` with an optional namespace prefix. If you deployed with a namespace, the role name will be `<Namespace>-InstanceSchedulerCrossAccountRole`.

### Validation After Deployment

Before tagging production-equivalent workloads, validate the scheduler is working:

- Launch a test EC2 instance (`t3.micro`).
- Tag it with `Schedule = <schedule-name>` using a schedule that should currently be in its stop window.
- Wait one scheduler interval (up to 5 minutes).
- Confirm the instance stopped and a DynamoDB state record was written.
- Check CloudWatch Logs for the scheduling Lambda — look for a JSON log entry with `"action": "stopped"` and the instance ID.

---

## 4. Schedule & Period Configuration

### Periods: The Primitive

A period defines a contiguous time window within a day. Periods are reusable building blocks — they are referenced by schedules, not embedded in them. Always define periods at the finest granularity you need, then compose them into schedules.

Period fields:

| Field | Format | Example | Notes |
| :--- | :--- | :--- | :--- |
| `begintime` | `HH:MM` (24h) | `08:00` | Inclusive |
| `endtime` | `HH:MM` (24h) | `20:00` | Inclusive — the instance is stopped *after* this time |
| `weekdays` | Day names or ranges | `mon-fri`, `sat,sun`, `mon,wed,fri` | Case-insensitive |
| `months` | Month names or ranges | `jan-mar`, `dec` | Optional; omit for all months |
| `monthdays` | Day-of-month range | `1-15` | Optional; useful for first/second half of month patterns |

### Schedules: Composing Periods

A schedule references one or more periods. An instance is in the **running state** during any period that is currently active. Outside all periods, the instance is stopped.

This matters for understanding multi-period schedules. If you define `office-hours` as `mon-fri 08:00-20:00` and add a second period `saturday-morning 09:00-13:00`, the instance runs Mon–Fri 08:00–20:00 and also Saturday 09:00–13:00.

```json
{
  "type": "schedule",
  "name": "extended-dev",
  "periods": ["weekday-daytime", "saturday-morning"],
  "timezone": "Asia/Jakarta",
  "description": "Dev team extended schedule including Saturday AM"
}
```

### Timezone Handling

Timezones are resolved at the schedule level, not the period level. Every schedule should declare an explicit timezone. Relying on the global default creates a silent failure mode when the default changes during a stack update.

Use IANA timezone names — not UTC offsets, not abbreviations.

| Region | Correct IANA Name |
| :--- | :--- |
| Jakarta (WIB, UTC+7) | `Asia/Jakarta` |
| Singapore (SGT, UTC+8) | `Asia/Singapore` |
| US Eastern | `America/New_York` |
| US Pacific | `America/Los_Angeles` |
| London | `Europe/London` |

**DST gotcha:** IANA names automatically handle daylight saving time transitions. `America/New_York` is EST in winter and EDT in summer — the schedule adjusts automatically. UTC offsets do not. Never use `Etc/GMT+7` for a schedule you want to track local business hours.

### The `enforced` Flag

By default (`enforced: false`), if someone manually starts an instance that is in its stop window, the scheduler does **not** stop it again. It respects the manual override.

Setting `enforced: true` changes behavior: the scheduler will stop any instance that is in its stop window regardless of whether it was manually started. This is the right setting for:

- Cost control environments where ad-hoc running is not permitted.
- Compliance environments where non-production systems must not run outside approved windows.

**Gotcha:** `enforced: true` will stop an instance that was intentionally started for an emergency hotfix test at 11 PM. Document this behavior prominently and ensure there is an override mechanism (see [Section 8](#8-operational-runbooks)).

### The `retain_running` Flag

Setting `retain_running: true` tells the scheduler: if an instance is running when a stop window begins, do not stop it — let it keep running until the next start window. This is useful for long-running batch jobs that should not be interrupted mid-execution. It is not a true extension mechanism; it just defers the stop to the next natural cycle.

### SSM Maintenance Window Integration

Schedules can reference an SSM Maintenance Window name. During that window, the scheduler will not stop instances that are otherwise in their stop period. This prevents the scheduler from stopping an instance mid-patch. Reference the maintenance window by name in the schedule's `ssm_maintenance_window` field.

---

## 5. Tagging Strategy

### The Scheduler Tag

The default tag key is `Schedule`. This is configurable at deployment time via the `TagName` CloudFormation parameter. The tag value is the schedule name exactly as defined in DynamoDB.

```
Tag Key:   Schedule
Tag Value: office-hours
```

Tag keys and values are case-sensitive in Instance Scheduler. `office-hours` and `Office-Hours` are different schedules. Establish and enforce a lowercase-with-hyphens naming convention for schedule names.

### Multi-Value Tag Patterns

Instance Scheduler supports only a single schedule per resource. If you need to schedule an instance differently than others in the same environment, you must define separate named schedules — not comma-separated tag values.

**Gotcha:** Some teams attempt to encode multiple signals in tags (e.g., `Schedule = office-hours|team=data`). This will fail — the scheduler will treat the entire string as a schedule name and fail to find it in DynamoDB.

### Recommended Tag Set

Beyond the required `Schedule` tag, a robust tagging approach adds metadata that helps with reporting and incident response:

| Tag Key | Example Value | Purpose |
| :--- | :--- | :--- |
| `Schedule` | `office-hours` | Required by Instance Scheduler |
| `SchedulerOptOut` | `true` | Convention-based opt-out (requires custom enforcement logic) |
| `Environment` | `dev` | Cost allocation |
| `Owner` | `team-platform` | Alert routing |
| `SchedulerState` | `stopped` | Written by scheduler on stop (if `StoppedTags` is configured) |

### Enforcing Tag Presence via AWS Config

Relying on manual tagging means instances will be missed. Use AWS Config to detect untagged EC2 instances:

```json
{
  "ConfigRuleName": "ec2-requires-schedule-tag",
  "Source": {
    "Owner": "AWS",
    "SourceIdentifier": "REQUIRED_TAGS"
  },
  "InputParameters": "{\"tag1Key\":\"Schedule\"}",
  "Scope": {
    "ComplianceResourceTypes": ["AWS::EC2::Instance"]
  }
}
```

Complement this with an SCP that denies launching EC2 instances in non-production OUs without the `Schedule` tag present. This shifts enforcement left to launch time rather than detecting missing tags after the fact.

```json
{
  "Sid": "DenyEC2WithoutScheduleTag",
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "arn:aws:ec2:*:*:instance/*",
  "Condition": {
    "Null": {
      "aws:RequestTag/Schedule": "true"
    }
  }
}
```

Apply this SCP to the Dev, Test, and Sandbox OUs — not to Production.

### Tag Governance at Scale

When operating across dozens of accounts, tag drift is inevitable. Build a weekly audit job:

```python
import boto3

def find_unscheduled_instances(account_id, region, role_arn):
    sts = boto3.client("sts")
    creds = sts.assume_role(RoleArn=role_arn, RoleSessionName="SchedulerAudit")["Credentials"]
    ec2 = boto3.client(
        "ec2", region_name=region,
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"]
    )
    paginator = ec2.get_paginator("describe_instances")
    unscheduled = []
    for page in paginator.paginate(Filters=[{"Name": "instance-state-name", "Values": ["running", "stopped"]}]):
        for reservation in page["Reservations"]:
            for instance in reservation["Instances"]:
                tags = {t["Key"]: t["Value"] for t in instance.get("Tags", [])}
                if "Schedule" not in tags:
                    unscheduled.append({
                        "account": account_id,
                        "region": region,
                        "instance_id": instance["InstanceId"],
                        "name": tags.get("Name", ""),
                        "owner": tags.get("Owner", "unknown")
                    })
    return unscheduled
```

Emit results to a central S3 bucket or a CloudWatch metric for dashboarding.

---

## 6. Multi-Account & Multi-Region

### Hub-and-Spoke Model

Instance Scheduler's multi-account model is **pull-based from the hub**. The hub's scheduling Lambda assumes a role in each registered spoke account and manages instances there. Spoke accounts have no Lambda, no EventBridge rule — they are passive.

```
┌─────────────────────────────────────────┐
│          Hub (Shared Services)          │
│                                         │
│  EventBridge → Orchestrator Lambda      │
│                     │                   │
│             ┌───────┴──────────┐        │
│             │                  │        │
│    Scheduling Lambda (per spoke)        │
└─────────────────────────────────────────┘
         │ AssumeRole               │ AssumeRole
         ▼                          ▼
┌─────────────────┐      ┌─────────────────┐
│  Spoke Account  │      │  Spoke Account  │
│  (dev)          │      │  (test)         │
│  IAM Role only  │      │  IAM Role only  │
└─────────────────┘      └─────────────────┘
```

### Cross-Account IAM Trust

The spoke IAM role must trust the hub account's scheduling Lambda execution role. The spoke CloudFormation template creates this automatically when you provide the `InstanceSchedulerAccount` parameter (the hub account ID).

The trust policy on the spoke role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<HUB_ACCOUNT_ID>:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<HUB_ACCOUNT_ID>"
        }
      }
    }
  ]
}
```

The external ID condition uses the hub account ID as the external ID by default. If you deploy multiple independent Instance Scheduler stacks (e.g., one for dev environments, one for test), each hub must have a different account — or you need to namespace the roles to prevent trust collisions.

### Region Scope

Regions are configured in two places:

- **Hub stack `Regions` parameter**: Declares all regions the hub will schedule. This list is global — the hub will schedule these regions across all spoke accounts.
- **Account DynamoDB record `regions` field**: Optionally scope a specific spoke account to a subset of the hub's regions.

If your hub `Regions` parameter includes `ap-southeast-1, ap-southeast-3` but a spoke account has workloads only in `ap-southeast-1`, set the account's `regions` field to `["ap-southeast-1"]` to avoid unnecessary cross-region API calls.

### Multi-Region Scaling Considerations

Each (account × region) combination is one scheduling Lambda invocation per scheduler interval. For 20 spoke accounts × 3 regions × 288 intervals/day (5-min interval), that is 17,280 Lambda invocations/day. At Lambda's free tier (1M invocations/month) this is negligible. At scale, it remains sub-dollar.

**Real scaling constraint:** The DynamoDB table read capacity. All invocations read the same schedule/period configuration. Use DynamoDB On-Demand mode for the configuration table — the access pattern is spiky (all invocations fire simultaneously at each interval) and On-Demand handles bursts better than provisioned capacity at this pattern.

### Spoke Account Onboarding Checklist

- Deploy `instance-scheduler-spoke.template` via CloudFormation (or StackSets for scale).
- Confirm IAM role exists and trust policy references the correct hub account ID.
- Add DynamoDB account record in the hub table with correct `regions` list.
- Tag one test instance in the spoke.
- Wait one scheduler interval and verify stop/start behavior.
- Add spoke account ID to your tag audit job's account list.

### AWS Organizations + StackSets for Spoke Deployment

At scale, managing spoke stacks individually is unworkable. Use CloudFormation StackSets with service-managed permissions to deploy the spoke template to all accounts in your non-production OUs:

```hcl
resource "aws_cloudformation_stack_set" "scheduler_spoke" {
  name             = "InstanceSchedulerSpoke"
  template_url     = "https://s3.amazonaws.com/solutions-reference/instance-scheduler-on-aws/latest/instance-scheduler-remote.template"
  permission_model = "SERVICE_MANAGED"

  auto_deployment {
    enabled                          = true
    retain_stacks_on_account_removal = false
  }

  parameters = {
    InstanceSchedulerAccount = var.hub_account_id
    Namespace                = "nonprod"
  }

  capabilities = ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"]
}

resource "aws_cloudformation_stack_set_instance" "scheduler_spoke_ou" {
  stack_set_name = aws_cloudformation_stack_set.scheduler_spoke.name

  deployment_targets {
    organizational_unit_ids = [
      var.ou_dev_id,
      var.ou_test_id,
      var.ou_sandbox_id
    ]
  }

  region = "ap-southeast-1"
}
```

With `auto_deployment.enabled = true`, new accounts added to those OUs automatically receive the spoke stack within minutes of account enrollment — no manual onboarding step required.

---

## 7. RDS Scheduling

### RDS vs EC2 Behavioral Differences

RDS scheduling works on the same mechanism as EC2 — tag the resource, the scheduler calls `rds:StartDBInstance` / `rds:StopDBInstance`. However, there are important behavioral differences:

| Behavior | EC2 | RDS |
| :--- | :--- | :--- |
| Stop API response time | Seconds | 2–10 minutes per instance |
| AWS forced start after stop | Never | **7 days** — AWS auto-starts RDS stopped for 7 days |
| Stop action creates snapshot | No | Optional (and off by default in scheduler) |
| Cluster vs instance distinction | N/A | Both supported; different API calls |
| Read replicas | N/A | Cannot be independently stopped; source must be stopped first |

### The 7-Day AWS Auto-Start Problem

AWS will automatically start an RDS instance or cluster that has been stopped for 7 consecutive days. This is an AWS platform behavior, not a bug in Instance Scheduler. The official AWS documentation notes this limit to prevent accidental permanent data inaccessibility.

**Implication for scheduling:** If your schedule keeps an RDS database stopped continuously (e.g., stopped all of Saturday and Sunday, then Monday arrives and it should start) — this is fine, the instance restarts within 7 days. But if you have an RDS instance in a truly dormant environment (a staging environment only used quarterly), do not rely on the scheduler to keep it stopped indefinitely. The AWS platform will restart it after 7 days regardless.

**Mitigation:** For quarterly or infrequent environments, delete and recreate the RDS instance from a snapshot rather than leaving a stopped instance. This is more reliable and often cheaper.

### Aurora Clusters

Aurora requires scheduling at the **cluster** level, not the individual instance level. Tag the cluster, not the instances within it. The scheduler calls `rds:StopDBCluster` / `rds:StartDBCluster`.

If you tag an Aurora writer instance directly, the scheduler will fail — the `StopDBInstance` API rejects calls on instances that belong to a cluster.

To identify Aurora clusters in your inventory:

```bash
aws rds describe-db-clusters \
  --query "DBClusters[*].{Cluster:DBClusterIdentifier,Engine:Engine,Status:Status}" \
  --output table
```

### Multi-AZ and Read Replica Considerations

- **Multi-AZ RDS:** Stopping a Multi-AZ instance stops both primary and standby. This is expected. The failover standby does not need a separate tag or schedule.
- **Read replicas:** Read replicas cannot be stopped independently from their source. If you stop the source, the replica stops automatically. Do not tag read replicas — tag only the source instance.

### RDS Snapshot-on-Stop Warning

The hub stack parameter `CreateRdsSnapshot` controls whether the scheduler takes an automated snapshot every time it stops an RDS instance. This is almost always the wrong choice for non-production environments:

- Snapshots consume storage and cost money.
- Snapshots accumulate — if an instance is stopped every night, you get 30 snapshots in a month.
- RDS already has automated backups for instances that are running; the scheduler snapshot adds no incremental safety.

**Recommendation:** Set `CreateRdsSnapshot = No` at deployment time. If you need a snapshot before a risky operation, take it manually.

---

## 8. Operational Runbooks

### Runbook: Instance Not Stopping

**Symptom:** An instance remains in `running` state past its stop window.

**Diagnosis steps:**

- Verify the `Schedule` tag value on the instance exactly matches a schedule name in DynamoDB (case-sensitive).
- Check the schedule's timezone and confirm the current time in that timezone is past the period's `endtime`.
- Look for a DynamoDB state record for the instance under `type = instance-state`. If absent, the scheduler has never processed this instance.
- Check CloudWatch Logs for the scheduling Lambda. Filter for the instance ID. Look for errors like `AccessDenied` (the cross-account role is missing EC2 permissions) or `InvalidInstanceID` (instance was terminated and relaunched with a new ID).
- If `retain_running: true` is set on the schedule, the scheduler intentionally skips stopping a running instance when the stop window begins.

**Resolution:**

- Fix the tag value to match the schedule name exactly.
- If a permissions error, update the spoke IAM role policy to include `ec2:StopInstances`.
- For immediate stop outside of a scheduler cycle, run: `aws ec2 stop-instances --instance-ids <id>` from the spoke account.

### Runbook: Instance Not Starting

**Symptom:** An instance remains in `stopped` state past its start window.

**Diagnosis steps:**

- Confirm the instance has a `Schedule` tag and the schedule's period includes the current time.
- Check the instance's status in EC2 — if it was manually terminated (not stopped), the scheduler will have a stale state record but the instance no longer exists.
- Check CloudWatch Logs for `ec2:StartInstances` errors. Common causes: instance store-backed instances cannot be started after stop (this is an EC2 limitation, not a scheduler bug); instance type is no longer available in the AZ.
- Verify the spoke account has sufficient EC2 instance quota for the instance type.

**Resolution:**

- If the instance was terminated, remove the DynamoDB state record for that instance ID to stop the scheduler from logging errors.
- For a quota error, request a quota increase or change the instance type.

### Runbook: Emergency Override — Keep Instance Running

When an on-call engineer needs to keep a scheduled instance running outside its window (e.g., debugging a production incident in a staging environment at 2 AM):

**Option 1 — Change the tag value (recommended):**
Set `Schedule = running` (a built-in schedule that keeps instances always running). This is explicit, visible, and reversible.

```bash
aws ec2 create-tags \
  --resources i-0abc123def456 \
  --tags Key=Schedule,Value=running
```

Revert after the incident by restoring the original schedule name.

**Option 2 — Remove the tag entirely:**
Without the `Schedule` tag, the scheduler ignores the instance. Use this when you are not sure which schedule to restore to.

**Option 3 — Disable the schedule (affects all tagged instances):**
In DynamoDB, update the schedule item's `enabled` field to `false`. This affects every instance using that schedule — use only when you want to pause the schedule fleet-wide.

### Runbook: DynamoDB Configuration Corruption

**Symptom:** All instances stop being scheduled; CloudWatch Logs show DynamoDB read errors or schedule-not-found errors across all instances.

**Cause:** A malformed DynamoDB item — usually from a manual edit that broke the JSON structure or introduced an invalid field value.

**Resolution:**

- Open the DynamoDB table in the Console and run a Scan.
- Look for items with missing or malformed required fields (`begintime`, `endtime`, `weekdays` for periods; `periods` for schedules).
- Correct the item in the editor.
- Wait one scheduler interval for recovery.

**Prevention:** Treat DynamoDB configuration as code. Store all schedule/period definitions in a Terraform resource or a Python script that writes them via the AWS SDK. Never make manual edits to the DynamoDB table in production — use the code source.

```hcl
resource "aws_dynamodb_table_item" "schedule_office_hours" {
  table_name = var.scheduler_table_name
  hash_key   = "type"
  range_key  = "name"

  item = jsonencode({
    type        = { S = "schedule" }
    name        = { S = "office-hours" }
    periods     = { SS = ["weekday-daytime"] }
    timezone    = { S = "Asia/Jakarta" }
    description = { S = "Standard Mon-Fri 08:00-20:00 WIB" }
    enforced    = { BOOL = false }
  })
}
```

---

## 9. Monitoring & Alerting

### CloudWatch Metrics Emitted

Instance Scheduler emits custom metrics to CloudWatch under the namespace `InstanceScheduler`. Key metrics:

| Metric | Dimension | Description |
| :--- | :--- | :--- |
| `ec2.started` | `Service`, `Account`, `Region` | Count of instances started per invocation |
| `ec2.stopped` | `Service`, `Account`, `Region` | Count of instances stopped per invocation |
| `ec2.skipped` | `Service`, `Account`, `Region` | Count of instances skipped (already in correct state) |
| `rds.started` | `Service`, `Account`, `Region` | Count of RDS instances started |
| `rds.stopped` | `Service`, `Account`, `Region` | Count of RDS instances stopped |
| `SchedulingErrors` | `Service` | Errors during scheduling execution |

### Recommended Alarms

| Alarm | Metric / Condition | Action |
| :--- | :--- | :--- |
| Scheduler Lambda errors | Lambda `Errors` >= 1 for 2 consecutive periods | SNS → PagerDuty or Slack |
| Scheduling errors | `SchedulingErrors` >= 1 | SNS → ops channel |
| Lambda not executing | `Invocations` < 1 over 15 minutes | SNS → critical — EventBridge rule may be broken |
| DynamoDB throttling | `ConsumedReadCapacityUnits` spikes | Review On-Demand vs Provisioned mode |

The "Lambda not executing" alarm is the most important. If the EventBridge rule is accidentally disabled or the Lambda is throttled hard, no instances will be scheduled — they will remain running indefinitely, burning budget silently.

```hcl
resource "aws_cloudwatch_metric_alarm" "scheduler_not_running" {
  alarm_name          = "instance-scheduler-not-invoked"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  alarm_description   = "Instance Scheduler Lambda has not been invoked — check EventBridge rule"

  dimensions = {
    FunctionName = var.scheduling_lambda_name
  }

  alarm_actions = [var.ops_sns_arn]
}
```

### CloudWatch Log Insights for Operational Reporting

To see all start/stop actions across all accounts in the last 24 hours:

```
fields @timestamp, account, region, instance_id, action, schedule
| filter action in ["started", "stopped"]
| sort @timestamp desc
| limit 500
```

To find instances that the scheduler attempted to action but failed:

```
fields @timestamp, account, instance_id, error
| filter ispresent(error)
| sort @timestamp desc
```

### Cost Validation Dashboard

After deploying, you need to validate that the scheduler is actually producing savings — not just executing. Build a simple weekly report comparing EC2 running hours in scheduled accounts before vs after deployment. Use Cost Explorer's API with instance-level granularity and filter by the `SchedulerState=stopped` tag.

---

## 10. Cost Impact & Sizing

### Savings Calculation Model

For a given instance, the weekly running hours reduction is:

```
weekly_hours_saved = 168 - scheduled_running_hours_per_week
```

For a Mon–Fri 08:00–20:00 schedule:
- Scheduled running hours = 5 days × 12 hours = 60 hours
- Weekly hours saved = 168 − 60 = 108 hours
- Savings rate = 108 / 168 = **64.3%**

For a Mon–Fri 07:00–22:00 schedule (longer hours):
- Scheduled running hours = 5 × 15 = 75 hours
- Weekly hours saved = 93 hours
- Savings rate = **55.4%**

Apply this to each instance family's on-demand rate. For a `m6g.large` in `ap-southeast-1` at approximately $0.077/hr:
- Monthly on-demand cost without scheduling: 730 × $0.077 = **$56.21**
- Monthly cost with Mon–Fri 08:00–20:00 schedule: (60/7 × 4.33) × $0.077 = **$20.27**
- Monthly savings per instance: **$35.94**

Scale this across 50 dev instances: **$1,797/month** recovered from a single schedule configuration.

### Scheduler Overhead Cost

The scheduler itself has a cost:

| Component | Estimated Monthly Cost |
| :--- | :--- |
| Lambda invocations (20 accounts × 3 regions × 288/day × 30 days) | ~$0.05 |
| Lambda compute (128MB × 30s average duration) | ~$1.20 |
| DynamoDB On-Demand reads | ~$0.50 |
| CloudWatch Logs ingestion | ~$0.30 |
| **Total** | **~$2.05/month** |

The scheduler is essentially free relative to the savings it generates.

### ROI Milestones

| Fleet Size | Monthly Savings (64% rate, avg $0.10/hr instance) | Payback on 1-week deployment effort |
| :--- | :--- | :--- |
| 10 instances | ~$300 | First month |
| 50 instances | ~$1,500 | First week |
| 200 instances | ~$6,000 | First day |

---

## 11. Alternatives & Trade-offs

| Solution | Strengths | Weaknesses | Best For |
| :--- | :--- | :--- | :--- |
| **AWS Instance Scheduler** | Multi-account; schedule-as-config in DynamoDB; RDS + EC2; no custom code required | You own the infra; schedule config in DynamoDB is awkward at scale without Terraform; no native UI | Organizations already using Control Tower; multi-account setups |
| **Auto Scaling Scheduled Actions** | Native AWS; works with ASGs; no separate deployment | Only works on ASG-managed instances; cannot touch standalone EC2 or RDS | Stateless workloads already behind an ASG |
| **Custom Lambda + EventBridge** | Full control; no dependency on third-party solution; schedule logic in code | You own all of it; more maintenance burden; re-implementing features Instance Scheduler already has | Organizations with unique scheduling logic not expressible in Instance Scheduler |
| **AWS Scheduler (EventBridge Scheduler)** | Serverless; no infrastructure to deploy; native AWS service | Fires one-time or recurring cron events; does not natively know about EC2 instance states; requires custom Lambda target to start/stop | Simple cron-based starts/stops for a small number of instances |
| **Resource Groups + Systems Manager Automation** | SSM Automation can start/stop tagged instances on a schedule; integrates with Maintenance Windows | More complex to set up than Instance Scheduler for basic use cases | Organizations heavily invested in SSM already |
| **Terraform `null_resource` / GitHub Actions schedules** | Familiar for DevOps teams; schedule as code in version control | Requires a persistent runner or GitHub-hosted runner with AWS credentials; fragile for always-on scheduling | Dev environments where the team owns the pipeline |

### Key Decision Points

**Use Instance Scheduler when:**
- You have more than 10 instances to schedule.
- You need multi-account coverage.
- You need RDS scheduling alongside EC2.
- You want schedule definitions managed as configuration (not code).

**Use ASG Scheduled Actions when:**
- Your instances are already in an Auto Scaling Group.
- You want zero additional infrastructure.

**Use a custom Lambda when:**
- Instance Scheduler's schedule model does not fit your needs (e.g., you need dynamic schedules based on API input, or integration with a ticketing system for override approval).

---

## 12. Day-2 Ops Checklist

### Weekly Hygiene

- Review CloudWatch Logs for scheduling errors in the past 7 days.
- Confirm `instance-scheduler-not-invoked` alarm has not fired.
- Run the untagged instance audit script and route results to resource owners for tagging.
- Spot-check 5 random scheduled instances: verify they were stopped and started at expected times by querying DynamoDB state records.

### Monthly Review

- Pull Cost Explorer data filtered by `SchedulerState=stopped` tag — confirm savings are tracking against projections.
- Review the registered account list in DynamoDB — remove decommissioned accounts.
- Validate that new accounts onboarded this month have the spoke stack deployed and at least one test instance tagged.
- Check for new releases of the Instance Scheduler solution on GitHub — evaluate upgrade if a significant bugfix or feature is present.

### Quarterly Review

- Audit all schedule definitions: are any schedules unused (no instances tagged with them)? Remove stale schedules.
- Review schedule windows with teams — do the hours still reflect actual working patterns?
- Evaluate instance types in non-prod: could some be downsized rather than scheduled? Scheduling a large instance is better than not scheduling it, but right-sizing + scheduling is better still.
- Test the emergency override runbook with a new team member — ensure they can execute it without documentation in < 5 minutes.

### Cleanly Offboarding a Scheduled Instance

When an instance is being terminated, perform these steps in order to avoid stale state in DynamoDB:

- Remove the `Schedule` tag from the instance before terminating it. This prevents the scheduler from writing error logs about a missing instance.
- Terminate the instance.
- Delete the DynamoDB `instance-state` record for that instance ID if it exists.

If you terminate without removing the tag, the scheduler will log `InvalidInstanceID.NotFound` errors every 5 minutes until you clean up the state record. This is harmless but noisy.