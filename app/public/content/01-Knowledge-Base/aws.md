# AWS Best Practices Cheatsheet

> ## 📌 Quick Summary — Top Best Practices to Remember
>
> 1. **Multi-account strategy** — separate accounts per environment (dev/staging/prod) via AWS Organizations; never run workloads in the management account
> 2. **No long-lived access keys** — use IAM roles + OIDC federation for CI/CD; use SSM Session Manager instead of SSH; enforce IMDSv2
> 3. **Least privilege IAM** — scope policies to specific resources/actions; use IAM Access Analyzer to detect over-permissive policies
> 4. **Private by default** — no public IPs on EC2; use NAT GW for egress, ALB for ingress; VPC Endpoints for AWS services (S3, DynamoDB, SSM)
> 5. **Multi-AZ everything in production** — ALB, ASG, RDS Multi-AZ, ElastiCache Multi-AZ; one NAT Gateway per AZ
> 6. **Encrypt at rest and in transit** — KMS for data at rest, ACM certs + enforce TLS in transit; S3 SSE-KMS + block public access
> 7. **Always enable CloudTrail + GuardDuty** — CloudTrail in all regions/accounts for audit; GuardDuty for threat detection; centralize in Security account
> 8. **Design for failure** — Auto Scaling, health checks, DLQs on SQS, circuit breakers; know your RTO/RPO targets
> 9. **Cost optimization** — gp3 over gp2, Compute Savings Plans for baseline, Spot for burst, right-size with Compute Optimizer, tag everything
> 10. **Secrets in Secrets Manager** — auto-rotation support; never store secrets in env vars, user data, or plain SSM parameters

---

## 1. Core Philosophy

- **Well-Architected Framework** — Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization, Sustainability
- **Design for failure** — assume any component can fail at any time
- **Loose coupling** — decouple components via queues, events, APIs
- **Elasticity** — scale out (horizontal) over scale up (vertical)
- **Everything as code** — infrastructure, policies, config via IaC
- **Defense in depth** — security at every layer: network, compute, data, identity
- **Least privilege** — minimum permissions required, nothing more

---

## 2. Account & Organization Structure

### AWS Organizations (Multi-Account Strategy)

```
Root
├── Management Account         # Billing, SCPs only — no workloads
├── Security OU
│   ├── Log Archive Account    # CloudTrail, Config, VPC Flow Logs
│   └── Audit Account         # Security Hub, GuardDuty aggregator
├── Infrastructure OU
│   ├── Network Account        # Transit Gateway, shared VPCs, DNS
│   └── Shared Services        # CI/CD tooling, artifact registries
├── Workloads OU
│   ├── Dev Account
│   ├── Staging Account
│   └── Prod Account
└── Sandbox OU                 # Developers' experimental accounts
```

- **Never run workloads in the management account**
- Separate accounts per environment — isolated blast radius, billing, and limits
- Use **AWS Control Tower** to set up Landing Zone with guardrails
- Enforce guardrails with **Service Control Policies (SCPs)** at OU level
- **AWS SSO / IAM Identity Center** for centralized access — no IAM users per account

### Key SCPs to Enforce

```json
// Deny leaving the organization
// Deny disabling CloudTrail
// Deny creating IAM users (force SSO)
// Deny regions outside approved list
// Require MFA for sensitive actions
// Deny purchasing Reserved Instances in workload accounts
```

---

## 3. Identity & Access Management (IAM)

### Core Principles

- **No root account usage** — lock it down, enable MFA, never use day-to-day
- **No long-lived access keys** — use IAM roles + OIDC / instance profiles
- **IAM roles over IAM users** — for all services and automation
- **Permission boundaries** — limit max permissions delegated roles can grant
- **Attribute-Based Access Control (ABAC)** — tag-based policies for scale

### IAM Policy Best Practices

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ReadOnOwnPrefix",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::my-bucket",
        "arn:aws:s3:::my-bucket/${aws:PrincipalTag/Team}/*"
      ]
    }
  ]
}
```

- Use **conditions** to restrict by IP, MFA, time, tag
- Prefer **AWS managed policies** for common cases; custom for fine-grained
- Regularly run **IAM Access Analyzer** — detect overly permissive policies
- Use **IAM Access Advisor** — see which services are actually used, trim unused
- Enable **MFA Delete** on S3 buckets with critical data

### Roles for Cross-Account Access

```json
// Trust policy on target account role
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::SOURCE_ACCOUNT_ID:role/cicd-role"
  },
  "Action": "sts:AssumeRole",
  "Condition": {
    "StringEquals": {
      "sts:ExternalId": "unique-external-id"
    }
  }
}
```

- Use **ExternalId** for third-party cross-account access (confused deputy prevention)
- Use **OIDC federation** for GitHub Actions / GitLab CI — no static keys

```yaml
# GitHub Actions OIDC — no AWS keys needed
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789:role/github-actions-role
    aws-region: ap-southeast-1
```

---

## 4. Networking (VPC)

### VPC Design

```
VPC: 10.0.0.0/16
├── Public Subnets (10.0.0.0/24, 10.0.1.0/24, 10.0.2.0/24)
│   └── NAT Gateway, ALB, Bastion (or none with SSM)
├── Private Subnets (10.0.10.0/24, 10.0.11.0/24, 10.0.12.0/24)
│   └── EC2, EKS nodes, Lambda (in VPC)
└── Data Subnets (10.0.20.0/24, 10.0.21.0/24, 10.0.22.0/24)
    └── RDS, ElastiCache, OpenSearch (no internet access)
```

- **3 AZs minimum** for production — survive AZ failure
- **Private by default** — only expose what must be public
- **No public IPs on EC2** — use NAT GW for egress, ALB for ingress
- **Separate subnet tiers** — public / private / data (defense in depth)
- One **NAT Gateway per AZ** — avoid cross-AZ NAT traffic charges and single point of failure
- Use **VPC Endpoints** for S3, DynamoDB, STS, SSM — keep traffic off the internet

### Security Groups vs NACLs

| Feature | Security Group | NACL |
|---|---|---|
| Level | Instance/ENI | Subnet |
| State | Stateful | Stateless |
| Rules | Allow only | Allow + Deny |
| Evaluation | All rules | Order (lowest number first) |
| Best for | Fine-grained access control | Subnet-level broad blocking |

```
# Security Group best practice
- Allow only required ports from specific SGs (not 0.0.0.0/0)
- Separate SG per tier: alb-sg → app-sg → db-sg
- Never allow 0.0.0.0/0 on port 22 or 3389
- Use SSM Session Manager instead of SSH/RDP entirely
```

### Transit Gateway (Multi-VPC / Multi-Account)

```
Network Account
└── Transit Gateway
    ├── Prod VPC attachment
    ├── Staging VPC attachment
    ├── Shared Services VPC attachment
    └── On-prem (Direct Connect / VPN attachment)
```

- Share TGW across accounts via **AWS RAM**
- Use **route table separation** — prod cannot reach dev/staging by default
- Centralize **egress inspection** via a dedicated inspection VPC (AWS Network Firewall)

---

## 5. Compute (EC2, EKS, Lambda)

### EC2 Best Practices

- Use **IAM instance profiles** — never put credentials on the instance
- Use **SSM Session Manager** instead of SSH — no bastion, no port 22 open
- Prefer **Auto Scaling Groups** over standalone instances
- Use **Launch Templates** (not Launch Configurations — deprecated)
- Use **User Data / cloud-init** or **Systems Manager** for config, not manual SSH
- Enable **IMDSv2** — prevent SSRF-based metadata credential theft

```bash
# Enforce IMDSv2 on launch template
aws ec2 modify-instance-metadata-options \
  --instance-id i-1234 \
  --http-tokens required \
  --http-endpoint enabled
```

- **Spot Instances** for fault-tolerant, stateless workloads (up to 90% savings)
- **Savings Plans / Reserved Instances** for predictable baseline workloads
- Tag instances for cost allocation: `Environment`, `Team`, `Application`

### Auto Scaling Best Practices

```
Target Tracking  → Simple, recommended for most cases (keep CPU at 60%)
Step Scaling     → More control; define specific adjustment steps
Scheduled        → Predictable traffic patterns (scale up before market open)
Predictive       → ML-based; anticipates traffic before it arrives
```

- Set **minimum = 2** for HA workloads (survive AZ failure)
- Use **health checks** tied to ALB — replace unhealthy instances automatically
- Configure **scale-in protection** for instances running critical jobs

### Lambda Best Practices

- Keep functions **small and single-purpose**
- Set appropriate **memory** (CPU scales with memory) and **timeout**
- Use **environment variables** for config; **Secrets Manager** for secrets
- Enable **X-Ray tracing** for distributed tracing
- Use **reserved concurrency** to protect downstream services
- Use **provisioned concurrency** to eliminate cold starts for latency-sensitive functions
- Deploy inside **VPC** only if accessing VPC resources (adds cold start overhead)
- Use **Lambda Layers** for shared dependencies
- Prefer **ARM64 (Graviton)** — 20% cheaper, same or better performance

---

## 6. Storage (S3)

### S3 Best Practices

```hcl
resource "aws_s3_bucket" "data" {
  bucket = "myapp-prod-data"
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning
resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Encrypt at rest
resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
  }
}
```

- **Block public access** at account level AND bucket level
- **Encrypt at rest** with SSE-S3 minimum; SSE-KMS for sensitive data
- **Enable versioning** for accidental deletion recovery
- **MFA Delete** for critical data buckets
- **S3 Object Lock** for compliance/immutable data (WORM)
- **Lifecycle policies** — transition to IA/Glacier, expire old versions
- **Access logging** + **CloudTrail S3 data events** for audit
- Use **S3 Inventory** for large buckets instead of `list-objects`
- Use **VPC Endpoint** for private access — no internet traversal

### S3 Storage Classes

| Class | Use Case | Retrieval |
|---|---|---|
| Standard | Frequently accessed | Immediate |
| Intelligent-Tiering | Unknown/changing access pattern | Immediate |
| Standard-IA | Infrequent access, rapid retrieval | Immediate |
| One Zone-IA | Infrequent, non-critical (one AZ) | Immediate |
| Glacier Instant | Archive, occasional access | Milliseconds |
| Glacier Flexible | Archive, rare access | Minutes–hours |
| Glacier Deep Archive | Long-term compliance | Hours |

---

## 7. Databases (RDS, Aurora, DynamoDB)

### RDS / Aurora Best Practices

- Deploy in **Multi-AZ** — automatic failover in ~60s
- Use **Aurora** over RDS for new projects — faster failover, auto-scaling storage
- **Read Replicas** for read-heavy workloads and cross-region DR
- Enable **automated backups** + **manual snapshots** before major changes
- Enable **deletion protection** on production databases
- Use **RDS Proxy** — connection pooling, reduces DB overload from Lambda/ECS
- **Encrypt at rest** (KMS) and **in transit** (enforce SSL)
- Store credentials in **Secrets Manager** — supports automatic rotation
- Deploy in **data subnets** (no internet access)
- Use **Performance Insights** + **Enhanced Monitoring**

```sql
-- Enforce SSL on RDS PostgreSQL
ALTER USER myapp WITH CONNECTION LIMIT -1;
-- Set rds.force_ssl = 1 in parameter group
```

### DynamoDB Best Practices

- Design for **access patterns first** — model tables around queries, not entities
- Use **single-table design** where appropriate — reduce operational overhead
- Choose **partition key** carefully — avoid hot partitions (high cardinality)
- Use **on-demand capacity** for unpredictable traffic; **provisioned + Auto Scaling** for steady
- Enable **DynamoDB Streams** for event-driven architectures
- Use **Global Tables** for multi-region active-active
- Enable **Point-in-Time Recovery (PITR)** — 35-day restore window
- Use **TTL** to auto-expire stale items — reduce storage cost
- Use **DAX** (DynamoDB Accelerator) for microsecond read latency
- Enable **encryption at rest** (default since 2018, but verify KMS key)

---

## 8. Security Services

### The Core Security Stack

| Service | Purpose |
|---|---|
| **IAM** | Identity and access management |
| **AWS Organizations + SCPs** | Account-level guardrails |
| **CloudTrail** | API audit log — who did what, when |
| **AWS Config** | Resource configuration compliance |
| **GuardDuty** | Threat detection (ML-based) |
| **Security Hub** | Aggregated security findings |
| **Inspector** | Vulnerability scanning (EC2, ECR, Lambda) |
| **Macie** | S3 sensitive data discovery (PII, secrets) |
| **WAF** | Web application firewall (ALB, CloudFront, API GW) |
| **Shield** | DDoS protection (Standard free, Advanced paid) |
| **KMS** | Key management for encryption |
| **Secrets Manager** | Secret storage with auto-rotation |
| **IAM Access Analyzer** | Detect external resource exposure |
| **Detective** | Security investigation and root cause analysis |

### CloudTrail — Never Disable

```hcl
resource "aws_cloudtrail" "org" {
  name                          = "org-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  is_multi_region_trail         = true     # All regions
  is_organization_trail         = true     # All accounts in org
  enable_log_file_validation    = true     # Detect tampering
  include_global_service_events = true     # IAM, STS, etc.
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.ct.arn}:*"
}
```

- Centralize CloudTrail logs in **Log Archive account**
- Enable **log file validation** — detect if logs are tampered
- Retain for **minimum 1 year** (7 years for compliance)
- Alert on: root login, IAM changes, SCP changes, CloudTrail disable attempts

### GuardDuty — Always Enable

- Enable in **all regions, all accounts** via Organizations delegated admin
- Findings feed into **Security Hub**
- Automate response with **EventBridge → Lambda → isolate instance / revoke credentials**
- Enable **S3 Protection, EKS Protection, Malware Protection, RDS Protection**

---

## 9. Observability (CloudWatch, X-Ray)

### CloudWatch Key Practices

```python
# Emit structured metrics from application
import boto3
cloudwatch = boto3.client('cloudwatch')

cloudwatch.put_metric_data(
    Namespace='MyApp/Orders',
    MetricData=[{
        'MetricName': 'OrdersProcessed',
        'Value': 1,
        'Unit': 'Count',
        'Dimensions': [
            {'Name': 'Environment', 'Value': 'prod'},
            {'Name': 'Region', 'Value': 'ap-southeast-1'}
        ]
    }]
)
```

- Use **CloudWatch Container Insights** for EKS/ECS metrics
- Use **CloudWatch Lambda Insights** for function-level metrics
- Use **Embedded Metrics Format (EMF)** — structured logs that auto-create metrics
- Enable **VPC Flow Logs** → CloudWatch / S3 for network analysis
- Set **alarms** on: error rates, latency p99, CPU > 80%, disk > 85%
- Use **Composite Alarms** — reduce alert noise, combine conditions
- Use **CloudWatch Synthetics** — canary tests for endpoint availability
- **Log retention policies** — don't keep logs indefinitely (cost)

### X-Ray Distributed Tracing

- Enable on **Lambda, API Gateway, ECS, EKS (via ADOT)**
- Use **sampling rules** — 5% baseline, 100% on errors
- Use **X-Ray groups** to isolate traces by service or error type
- Use **Service Map** to visualize latency and error hotspots

### Recommended Observability Stack

```
Metrics   → CloudWatch + Prometheus (EKS) → Grafana
Logs      → CloudWatch Logs / S3 → Athena or OpenSearch
Traces    → X-Ray or OpenTelemetry → Jaeger / Tempo
Alerts    → CloudWatch Alarms → SNS → PagerDuty / Slack
Dashboards → Grafana or CloudWatch Dashboards
```

---

## 10. Cost Optimization

### Pillars of Cost Optimization

| Pillar | Action |
|---|---|
| Right-sizing | Match instance type to actual usage |
| Commitment discounts | Savings Plans, Reserved Instances |
| Spot Instances | Up to 90% off for interruptible workloads |
| Storage tiering | S3 Intelligent-Tiering, EBS gp3 over gp2 |
| Auto Scaling | Scale down when not needed |
| Data transfer | Minimize cross-AZ and cross-region traffic |
| Waste elimination | Delete unused EBS, snapshots, EIPs, NAT GWs |

### Key Tools

```
AWS Cost Explorer        → Analyze spend by service/tag/account
AWS Budgets              → Alert when cost exceeds threshold
AWS Cost Anomaly Detection → ML-based spend spike alerts
AWS Trusted Advisor      → Right-sizing and idle resource recommendations
Compute Optimizer        → Right-sizing for EC2, Lambda, EBS, ECS
Infracost                → Cost estimation in Terraform PRs
```

### gp3 over gp2 (Quick Win)

```bash
# gp3 is 20% cheaper than gp2 and better performance baseline
aws ec2 modify-volume --volume-id vol-xxx --volume-type gp3
# gp3: 3000 IOPS / 125 MB/s baseline free
# gp2: IOPS tied to size (3 IOPS/GB)
```

### Savings Plans vs Reserved Instances

| Type | Commitment | Flexibility | Discount |
|---|---|---|---|
| Compute Savings Plan | $/hour spend | Any EC2, Lambda, Fargate | Up to 66% |
| EC2 Instance Savings Plan | $/hour, instance family | Specific family, any size/OS | Up to 72% |
| Reserved Instance | Specific instance | Less flexible | Up to 72% |

- **Compute Savings Plans** are most flexible — recommended default
- Cover **baseline** with Savings Plans; burst with On-Demand or Spot

---

## 11. High Availability & Disaster Recovery

### HA Design Patterns

```
Multi-AZ (Active-Active):
  ALB → EC2/EKS in AZ-a, AZ-b, AZ-c
  RDS Multi-AZ → automatic failover
  ElastiCache Multi-AZ → automatic failover

Multi-Region (Active-Passive):
  Route 53 health checks → failover routing
  Aurora Global Database → < 1s replication lag
  S3 Cross-Region Replication
  DynamoDB Global Tables

Multi-Region (Active-Active):
  Route 53 latency routing or geolocation
  DynamoDB Global Tables (multi-master)
  CloudFront for edge caching
```

### DR Tiers (RTO / RPO)

| Strategy | RTO | RPO | Cost |
|---|---|---|---|
| Backup & Restore | Hours | Hours | Low |
| Pilot Light | Minutes–1hr | Minutes | Medium |
| Warm Standby | Minutes | Seconds–minutes | High |
| Multi-Site Active-Active | Seconds | Near-zero | Very High |

- **RTO** = Recovery Time Objective (how long to recover)
- **RPO** = Recovery Point Objective (how much data loss is acceptable)
- Define targets before architecting — drives design decisions

### Route 53 Health Checks

```hcl
resource "aws_route53_health_check" "app" {
  fqdn              = "myapp.example.com"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30
}
```

- Use **health checks + failover routing** for multi-region DR
- Enable **Route 53 Resolver DNS Firewall** for malicious domain blocking

---

## 12. Load Balancing

| Type | Use Case |
|---|---|
| **ALB** (Application) | HTTP/HTTPS, path/host-based routing, WebSocket, gRPC |
| **NLB** (Network) | TCP/UDP, ultra-low latency, static IP, PrivateLink |
| **GWLB** (Gateway) | Third-party network appliances (firewall, IDS) |
| **CLB** (Classic) | Legacy — do not use for new workloads |

### ALB Best Practices

```
- Enable access logs → S3 for analysis
- Enable deletion protection in prod
- Use HTTPS listeners only; redirect HTTP → HTTPS
- Use ACM certificates (auto-renew) — never manually managed certs
- Enable WAF association for public-facing ALBs
- Use target group health checks tuned to app's /health endpoint
- Enable sticky sessions only when stateful (prefer stateless)
```

---

## 13. Messaging & Decoupling

### SQS Best Practices

```
Standard Queue    → At-least-once, best-effort ordering, high throughput
FIFO Queue        → Exactly-once, strict ordering, 3000 msg/s with batching
```

- Set **Dead Letter Queue (DLQ)** — capture failed messages for debugging
- Set **visibility timeout** > max processing time (avoid double processing)
- Enable **Long Polling** (`WaitTimeSeconds: 20`) — reduces empty receives and cost
- Use **SQS + Lambda** for serverless fan-out processing
- Encrypt with **SSE-SQS or SSE-KMS**

### SNS + SQS Fan-Out Pattern

```
SNS Topic
├── SQS Queue A → Lambda (process orders)
├── SQS Queue B → Lambda (send email)
└── SQS Queue C → Lambda (update analytics)
```

- Never direct SNS → Lambda in high-throughput scenarios (no buffering)
- Always buffer with **SQS between SNS and Lambda**
- Use **EventBridge** for complex event routing across services and accounts

---

## 14. Well-Architected Framework — Quick Reference

### Operational Excellence

- Perform operations as code (IaC, runbooks as code)
- Make frequent, small, reversible changes
- Anticipate failure — run GameDays, chaos engineering
- Learn from operations failures — blameless post-mortems

### Security

- Implement strong identity foundation (least privilege, MFA)
- Enable traceability (CloudTrail, Config, logs)
- Apply security at all layers
- Protect data in transit and at rest
- Prepare for security events (incident response runbooks)

### Reliability

- Test recovery procedures regularly
- Scale horizontally; avoid single points of failure
- Stop guessing capacity — use Auto Scaling
- Manage change via automation

### Performance Efficiency

- Use serverless/managed services where possible
- Go global in minutes (CloudFront, Global Accelerator)
- Use the right tool for the job (DB, compute, storage)
- Experiment more often

### Cost Optimization

- Adopt a consumption model — pay for what you use
- Measure overall efficiency (unit economics)
- Stop spending on undifferentiated heavy lifting
- Analyze and attribute expenditure (tagging)

### Sustainability

- Maximize utilization — right-size and consolidate
- Use managed services — AWS optimizes infra for you
- Use efficient storage (S3 Intelligent-Tiering, compression)
- Choose regions with lower carbon footprint

---

## 15. Common Anti-Patterns to Avoid

- ❌ Running workloads in the management/root account
- ❌ Using root account credentials day-to-day
- ❌ Long-lived IAM access keys in code, env vars, or CI
- ❌ Overly permissive IAM policies (`Action: "*"`, `Resource: "*"`)
- ❌ EC2 instances with public IPs and port 22 open to 0.0.0.0/0
- ❌ Single-AZ deployments for production workloads
- ❌ S3 buckets with public access enabled
- ❌ Secrets in environment variables, SSM Parameter Store (plain text), or user data
- ❌ No CloudTrail in all regions and all accounts
- ❌ GuardDuty disabled (default is off — must enable explicitly)
- ❌ Manual changes to production infra outside IaC (drift)
- ❌ gp2 EBS volumes (use gp3 — cheaper and better)
- ❌ One NAT Gateway for all AZs — single point of failure + cross-AZ costs
- ❌ No tagging strategy — impossible to do cost allocation or ops later
- ❌ Ignoring Trusted Advisor and Compute Optimizer recommendations

---

## 16. Essential AWS CLI Patterns

```bash
# Assume a role cross-account
aws sts assume-role \
  --role-arn arn:aws:iam::TARGET_ACCOUNT:role/admin \
  --role-session-name my-session

# List all EC2 instances across all regions
for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  echo "=== $region ===" && aws ec2 describe-instances --region $region \
    --query 'Reservations[].Instances[].{ID:InstanceId,State:State.Name,Type:InstanceType}' \
    --output table
done

# Find unattached EBS volumes (cost waste)
aws ec2 describe-volumes \
  --filters Name=status,Values=available \
  --query 'Volumes[].{ID:VolumeId,Size:Size,AZ:AvailabilityZone}' \
  --output table

# Find unused Elastic IPs
aws ec2 describe-addresses \
  --query 'Addresses[?AssociationId==`null`].[PublicIp,AllocationId]' \
  --output table

# Check S3 bucket public access
aws s3api get-public-access-block --bucket my-bucket

# Get all IAM roles and their last used date
aws iam generate-credential-report && aws iam get-credential-report \
  --query 'Content' --output text | base64 -d

# SSM Session Manager — no SSH needed
aws ssm start-session --target i-1234567890abcdef0

# CloudTrail — find who deleted a resource
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=my-bucket \
  --start-time 2024-01-01 --end-time 2024-01-31
```

---

*Good luck with the interview!*