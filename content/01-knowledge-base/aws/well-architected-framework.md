# AWS Well-Architected Framework — Production Reference

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [WAF Overview & Review Process](#1-waf-overview-review-process) | Core pillars of the WAF, review timing, common pitfalls, and risk-based tiering. |
| **02** | [Operational Excellence](#2-operational-excellence) | Runbook automation, CodeDeploy canary structures, and structured JSON logs. |
| **03** | [Security](#3-security) | IAM Access Analyzer configurations, boundary architectures, and encryption rules. |
| **04** | [Reliability](#4-reliability) | Availability target scales, RDS Multi-AZ patterns, and automated backup drills. |
| **05** | [Performance Efficiency](#5-performance-efficiency) | Compute matrices (Graviton3), caching strategies, and DynamoDB scaling. |
| **06** | [Cost Optimization](#6-cost-optimization) | Committed spend (Savings Plans), spot instances, and S3 lifecycle configurations. |
| **07** | [Sustainability](#7-sustainability) | Energy footprint matching, Graviton gains, and scheduled scaling models. |
| **08** | [Pillar Tensions & Trade-off Navigation](#8-pillar-tensions-trade-off-navigation) | Balancing cost vs reliability, security vs latency, and operation vs safety. |
| **09** | [AWS Well-Architected Tool — Practical Usage](#9-aws-well-architected-tool-practical-usage) | Setting milestones, custom organizational lenses, and facilitation guidelines. |

---

## 1. WAF Overview & Review Process

### The Six Pillars

| Pillar | Core Question | Primary Risk if Ignored |
|---|---|---|
| **Operational Excellence** | Can we run and improve it? | Slow incident response, manual toil, no feedback loop |
| **Security** | Are we protected? | Data breach, compliance failure, account compromise |
| **Reliability** | Does it keep working? | Downtime, data loss, customer impact |
| **Performance Efficiency** | Does it scale and perform? | Latency, throughput limits, poor user experience |
| **Cost Optimization** | Are we spending wisely? | Waste, unpredictable bills, budget overruns |
| **Sustainability** | Are we minimizing environmental impact? | Carbon footprint, wasted energy, regulatory risk |

### When to Conduct a Review

- **New workload design** — before you write infrastructure code, not after.
- **Major architectural change** — new data store, new region, or new traffic pattern.
- **Post-incident** — retrospective view of what WAF question was violated.
- **Annual review** — continuous improvement cycle, minimum once per year per workload.
- **Pre-launch** — gate on production readiness.

### Review Anti-Patterns to Avoid

- **Reviewing after building** — WAF as a compliance checkbox rather than a design input. Reviews should drive decisions, not validate them post-hoc.
- **Reviewing everything to the same depth** — tier your workloads. Tier 1 (customer-facing, regulated) gets a full review. Tier 3 (internal tooling) gets a lightweight review.
- **No remediation plan** — WAF reviews that produce a spreadsheet of findings with no owners or timelines are theater. Every High-risk finding needs a ticket and an owner before the review closes.
- **One-time reviews** — architecture drifts. A workload that passed a review 18 months ago has likely drifted. Build re-review into your operational calendar.

### Workload Tiering

Before beginning a review, group your workloads into distinct tiers to align the time investment with business risk:

*   **Tier 1: Critical Workloads**
    *   *Characteristics:* Customer-facing production environments, workloads handling PII or regulated data, systems with an SLA > 99.9%.
    *   *Cadence & Scope:* Full WAF review covering all six pillars, 4–8 hours total, with quarterly follow-up check-ins.
*   **Tier 2: Important Workloads**
    *   *Characteristics:* Internal production systems or business-critical backend pipelines with an SLA of 99.5%–99.9%.
    *   *Cadence & Scope:* Full review covering all pillars, 2–4 hours, with biannual check-ins.
*   **Tier 3: Standard Workloads**
    *   *Characteristics:* Internal tooling, dev/test environments, and non-critical systems with no customer impact during downtime.
    *   *Cadence & Scope:* Lightweight review focusing on key risks, 1 hour, completed annually.
*   **Tier 4: Sandbox Workloads**
    *   *Characteristics:* R&D sandboxes, local experiments, and temporary POCs.
    *   *Cadence & Scope:* No formal review required; guardrails are enforced at the AWS landing zone level.

---

## 2. Operational Excellence

### Design Principles

**Perform operations as code.** Runbooks as Lambda functions, not wiki pages. If your incident response requires someone to manually run commands, you have a toil problem.

**Make frequent, small, reversible changes.** Large infrequent deployments are the leading cause of outages. The deploy that broke production is almost always the large, "just a few things" deploy.

**Anticipate failure.** Pre-mortem: before launching, ask "how will this fail?" Game days and chaos engineering are operational excellence tools, not SRE luxuries.

**Learn from all operational events.** Every incident, page, and near-miss is data. Without a blameless post-mortem culture, your MTTR will plateau.

### Key Patterns

#### Runbook Automation

Avoid hosting critical operational procedures on static wiki pages. Instead, implement them as executable code (e.g., AWS Systems Manager Documents, AWS Lambda functions, or Step Functions) that can be triggered automatically in response to CloudWatch alarms. For example, rather than documenting how to restart an unhealthy service, write a Lambda runbook that detaches, captures forensic data, and safely restarts unhealthy containers.

#### Deployment Safety

Deploy changes using CodeDeploy with canary deployment strategies and automated rollbacks. Set up validation gates that trigger automated smoke tests against the new canary task set before any customer traffic is allowed to transition over:

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: <TASK_DEFINITION>
        LoadBalancerInfo:
          ContainerName: "app"
          ContainerPort: 8080

Hooks:
  - BeforeAllowTraffic: "arn:aws:lambda:ap-southeast-1:123:function:pre-traffic-check"
  - AfterAllowTraffic: "arn:aws:lambda:ap-southeast-1:123:function:post-traffic-check"
```

A rollback is executed instantly if your verification Lambda detects health anomalies during the canary phase, minimizing blast radius.

#### Observability Stack

The three signals every workload needs before going to production:

| Signal | Mechanism | Goal |
|---|---|---|
| **Metrics** | CloudWatch Custom Metrics | Track business KPIs (e.g., orders per minute, payment success rate, checkout queue depth) rather than just system stats. |
| **Logs** | Structured JSON Logs | Queryable, parsed logs stored in CloudWatch Logs, allowing fast aggregation and investigation via CloudWatch Logs Insights. |
| **Traces** | AWS X-Ray or OpenTelemetry | Continuous tracing to follow single customer requests end-to-end across multiple downstream microservices. |

Ensure your services emit structured JSON logs rather than raw text to enable consistent querying. For example, logging a payment success event should output structured keys like `timestamp`, `level`, `service`, `amount_cents`, `order_id`, and `duration_ms` so they can be instantly filtered and aggregated in dashboards.

### Operational Excellence Anti-Patterns

- **Alarm fatigue** — every alarm must be actionable. If an alarm fires and the correct response is "wait and see," delete the alarm. Non-actionable alarms train engineers to ignore pages.
- **Manual deployments** — any deployment that requires manual steps will eventually be done wrong at 2 AM during an incident.
- **Undifferentiated toil** — ticket rotation, manual certificate renewal, account provisioning by hand. Measure toil as a percentage of engineering hours. If toil > 20%, it's an operational excellence failure.

---

## 3. Security

### Design Principles

**Apply security at every layer.** Network, compute, application, data — never rely on a single control. A misconfigured security group is not a data breach if encryption-at-rest and IAM resource policies are also correct.

**Automate security.** Manual security reviews at deployment time don't scale. Shift security left: SAST in CI, IaC scanning pre-merge, runtime posture management continuously.

**Enable traceability.** Every action by every principal in every account should be logged, retained, and queryable. You will need this during an incident.

**Minimize blast radius.** Least-privilege IAM, separate AWS accounts per workload, VPC boundaries. When (not if) something is compromised, the damage should be contained.

### IAM Least Privilege in Practice

The gap between "least privilege" as a principle and in practice is large. Most teams start with `AdministratorAccess` and never tighten it. Enable AWS IAM Access Analyzer across your accounts via AFT global customizations to continuously evaluate role permissions and generate fine-grained, least-privilege IAM policies directly from actual CloudTrail usage history.

To prevent developers from inadvertently escalating their own access when creating application roles, enforce a global **Permission Boundary** policy pattern. For example, apply an IAM policy that allows developers to manage app-specific actions (e.g., S3, DynamoDB, Lambda) but denies any role creation or modification that does not carry your corporate developer permission boundary:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowWithinBoundary",
      "Effect": "Allow",
      "Action": [
        "s3:*", "dynamodb:*", "lambda:*",
        "logs:*", "cloudwatch:*", "xray:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyPrivilegeEscalation",
      "Effect": "Deny",
      "Action": [
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy",
        "iam:PassRole"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "iam:PermissionsBoundary": "arn:aws:iam::123:policy/DeveloperBoundary"
        }
      }
    }
  ]
}
```

### Secrets Management

Never store passwords, tokens, or private certificates in raw environment variables within your ECS task definitions or codebases, and avoid plain unencrypted parameters in SSM Parameter Store. Instead, leverage **AWS Secrets Manager** with automatic, Lambda-driven credential rotation. Reference secret ARNs directly inside container task definitions so keys are injected into the runtime container securely without displaying in the AWS Console or CI logs:

```hcl
resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id           = aws_secretsmanager_secret.db.id
  rotation_lambda_arn = aws_lambda_function.rotate_db_secret.arn

  rotation_rules {
    automatically_after_days = 30   # Rotate monthly
  }
}
```

### Encryption Strategy

Protecting data throughout its lifecycle requires consistent policies for both storage and transport:

| Category | Target Service | Production Enforced Control |
|---|---|---|
| **Data at Rest** | Amazon S3 | Server-Side Encryption with Customer-Managed Keys (SSE-KMS) |
| | Amazon EBS | Enforce KMS-encrypted volumes organization-wide using SCPs |
| | Amazon RDS | KMS encryption enabled at creation (mandatory, cannot be added later) |
| | DynamoDB | Table-level customer-managed KMS keys for sensitive tables |
| | Secrets Manager | KMS-encrypted by default |
| **Data in Transit** | Public Load Balancers | TLS 1.2 minimum (TLS 1.3 preferred) enforced via ALB security policy |
| | Inter-Service Traffic | Enforce HTTPS/TLS between internal microservices or use a service mesh |
| | S3 API Calls | Deny HTTP requests via S3 Bucket Policy (SecureTransport check) |

Always enforce secure transport (HTTPS) on S3 buckets using a restrictive bucket policy:

```json
{
  "Sid": "DenyNonTLS",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::my-bucket",
    "arn:aws:s3:::my-bucket/*"
  ],
  "Condition": {
    "Bool": {"aws:SecureTransport": "false"}
  }
}
```

### Threat Detection Stack

Deploy a unified detective framework to identify anomalies and verify your security posture:

*   **GuardDuty:** Performs continuous machine learning and threat intelligence analysis on VPC Flow Logs, DNS logs, and CloudTrail events.
*   **Security Hub:** Aggregates, scores, and prioritizes findings against standards like CIS and AWS Foundational Security Best Practices.
*   **Inspector v2:** Continuously scans EC2 instances, ECR container images, and Lambda functions for software vulnerabilities.
*   **Macie:** Classifies and protects S3 data by discovering and alerting on exposed PII or credentials.
*   **AWS Config:** Tracks full resource history and evaluates configuration drift against corporate policies.
*   **Detective:** Graph-based analysis tool to reconstruct security events and investigate GuardDuty alerts.

Automate incident response using EventBridge rules that trigger Lambda functions to isolate compromised resources. For instance, if GuardDuty flags cryptocurrency activity on an EC2 instance, the Lambda can immediately swap its security groups to a deny-all quarantine group and take forensic snapshots of its EBS volumes before notifying security.

### Security Anti-Patterns

- **Shared IAM users across services** — when the shared user's key is rotated (or compromised), every service that uses it breaks simultaneously.
- **VPC security group as the only control** — a misconfigured ingress rule defeats all your security. Always pair network controls with IAM resource policies and encryption.
- **Ignoring Security Hub findings** — a suppressed finding backlog is not a security posture. Set SLAs: Critical = 24h, High = 7 days, Medium = 30 days.
- **CMK key policies granting `kms:*` to `*`** — this is equivalent to no encryption. Key policies must be explicit about which roles can Decrypt.

---

## 4. Reliability

### Design Principles

**Design for failure.** Every component will fail eventually. Your architecture should tolerate component failures without impacting the customer. If a single EC2 instance failure brings down your service, you have a reliability problem.

**Stop guessing capacity.** Auto-scaling, not over-provisioning. Fixed capacity that handles peak load wastes money at off-peak and still fails at super-peak.

**Test recovery procedures.** Backup files that have never been restored are not backups. Disaster recovery procedures that have never been tested will fail when you need them.

### Availability Target Reality Check

| Availability | Max Annual Downtime | What It Requires |
|---|---|---|
| **99%** | 87.6 hours | Two Availability Zones (AZs), basic auto-scaling compute groups. |
| **99.9%** | 8.76 hours | Multi-AZ architecture, application health checks, auto-recovery setups. |
| **99.95%** | 4.38 hours | Active-active multi-AZ setup with automated, fast failover (<1 min). |
| **99.99%** | 52.6 minutes | Multi-region active-active or hot standby configuration. |
| **99.999%** | 5.26 minutes | Multi-region active-active with zero manual intervention in failover logic. |

> [!IMPORTANT]
> **99.99% and above requires multi-region.** No single AWS region, regardless of how many AZs you use, can guarantee a 99.99%+ SLA. AWS's per-region SLA for many primary services is 99.99%, meaning a region-level event will put you outside your SLA without region failover.

### Multi-AZ Database Redundancy

For production databases, enable Multi-AZ synchronous replication. For instance, provisioning a PostgreSQL database with a synchronous standby instance in a secondary AZ ensures that any primary database failure triggers a fast, automatic DNS failover:

```hcl
resource "aws_db_instance" "main" {
  identifier           = "payments-db"
  engine               = "postgres"
  engine_version       = "16.2"
  instance_class       = "db.r6g.xlarge"
  multi_az             = true      # Synchronous standby in second AZ
  deletion_protection  = true
  skip_final_snapshot  = false

  backup_retention_period = 35     # 35 days — can point-in-time restore
}
```

While standard RDS Multi-AZ failover takes 20–40 seconds, workloads requiring sub-10-second failovers should utilize **Amazon Aurora** for rapid storage-level replication.

### Circuit Breaker Pattern

To prevent cascading failures when a downstream API degrades, implement a circuit breaker pattern (e.g., using Python resilience libraries or Envoy/AWS App Mesh sidecars). If a downstream dependency throws errors exceeding a set threshold, the breaker trips to **OPEN**, immediately rejecting upstream requests with a fallback response rather than allowing threads to queue and crash your system. 

Prefer managed sidecar proxies like **AWS App Mesh** or **API Gateway** circuit breakers over custom application-level code to standardize error budgets and collect metrics out of the box.

### Backup & Recovery Requirements

Align your backup architectures with realistic business Recovery Point Objectives (RPO) and Recovery Time Objectives (RTO):

*   **RPO 0, RTO 0:** Active-active multi-region deployment. (Extremely high cost and engineering overhead).
*   **RPO < 1 min, RTO < 5 min:** Multi-region hot standby with automated DNS failover.
*   **RPO < 1 hour, RTO < 1 hour:** Multi-AZ architecture, automated hourly snapshots, and programmatically tested restore procedures.
*   **RPO < 24 hours, RTO < 24 hours:** Daily automated snapshots and documented, manual recovery runbooks.

Ensure you automate backup validation. Write a scheduled Lambda function that periodically restores production RDS snapshots to a temporary, downsized test instance, performs basic validation queries, and tears the instance down to prove that backups are recoverable and not corrupted.

### Reliability Anti-Patterns

- **Single point of failure masquerading as HA** — a "multi-AZ" deployment where the application layer is single-instance is not HA. Check every tier of your stack.
- **Health checks that don't check health** — a TCP health check returning 200 while the app can't connect to the database is not useful. Health checks should validate actual dependencies.
- **Untested disaster recovery** — documented but untested DR procedures have a >50% failure rate when actually needed. Test quarterly.
- **Cascading timeouts** — upstream service timeout is 30s, downstream is 28s. If downstream is slow, upstream waits, threads exhaust, upstream dies. Timeout budgets must decrease as you go deeper in the call chain.

---

## 5. Performance Efficiency

### Design Principles

**Use serverless and managed services first.** You are not in the business of managing databases, message brokers, or compute schedulers. AWS's operational overhead for RDS, ElastiCache, MSK, and ECS Fargate is the right trade for most teams.

**Profile before optimizing.** Premature optimization is the root of many over-engineered architectures. Measure with X-Ray and CloudWatch before redesigning.

**Go global in minutes.** CloudFront, Global Accelerator, and multi-region active-active are table stakes for global products, not aspirational.

### Compute Selection Framework

Match your application workload characteristics with the optimal AWS compute choice:

| Workload Type | Recommended AWS Compute | Optimization Advantage |
|---|---|---|
| **Stateless Web/API** | ECS Fargate or AWS Lambda | Rapid scaling, no node patching, scale-to-zero |
| **Long-Running Compute** | ECS Fargate or EC2 | Stable resource profile, Graviton3 (ARM64) |
| **Batch / Scheduled Jobs** | AWS Batch or Step Functions | Automated scheduling, Spot instances |
| **ML Inference** | SageMaker Endpoint or AWS Inferentia | High-throughput, optimized hardware |
| **ML Training** | EC2 P4d/P5 or Trainium (trn1) | Large scale GPU clustering, high bandwidth |
| **Container Orchestration** | EKS (complex workloads) or ECS (standard) | Choose based on Kubernetes operational capacity |

Enforce Graviton3 (ARM64) usage in your ECS task definitions to instantly capture up to 40% better price-to-performance over standard x86 architectures:

```hcl
resource "aws_ecs_task_definition" "app" {
  family                   = "payments-api"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"   # Graviton3 (ARM)
  }
}
```

### Caching Strategy

Minimize database load and lower response times by caching data at the appropriate tier:

1.  **CloudFront (CDN):** Cache static assets and public API responses close to edge locations. Enforce strict `Cache-Control` headers (e.g., `stale-while-revalidate` for safe dynamic API endpoints).
2.  **ElastiCache (Redis):** Cache high-read session data, compiled dashboard queries, and database rows. Never use the cache as a durable source of truth.
3.  **Application-Level (In-Process):** Store fast-changing application configurations, lookup tables, and feature flags in local application memory. Clear the cache on deployment.
4.  **Database-Level:** Optimize memory buffers and enable caching pools (e.g., Aurora Query Cache) for read-heavy OLTP databases.

Leverage a **cache-aside pattern** to query Redis first, fetching from the database and backfilling Redis only on cache misses. To prevent stale cache states, trigger cache invalidations via DynamoDB Streams or RDS event notifications whenever a database write or delete is executed.

### Database Performance Patterns

Choose database engines tailored to your queries:

*   **Read-heavy, low latency:** ElastiCache (Redis) in front of RDS/DynamoDB.
*   **Read-heavy, complex reporting:** Aurora Read Replicas scoped to a dedicated reader endpoint.
*   **Write-heavy, key-value lookup:** DynamoDB (optionally with DAX for microsecond reads).
*   **Time-series metrics:** Amazon Timestream or DynamoDB utilizing time-based TTLs.
*   **Full-text search:** Amazon OpenSearch Service.
*   **Graph/relationship data:** Amazon Neptune.
*   **Analytical/OLAP reporting:** Amazon Redshift or Athena queries on S3 rather than transactional OLTP databases.

Implement target tracking scaling policies on DynamoDB tables to automatically adjust read/write capacity units when table utilization exceeds 70%:

```hcl
resource "aws_appautoscaling_policy" "dynamodb_read" {
  name               = "DynamoDBReadCapacityUtilization"
  policy_type        = "TargetTrackingScaling"
  resource_id        = "table/Orders"
  scalable_dimension = "dynamodb:table:ReadCapacityUnits"
  service_namespace  = "dynamodb"

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "DynamoDBReadCapacityUtilization"
    }
    target_value = 70.0   # Scale up when 70% utilized
  }
}
```

### Performance Anti-Patterns

- **N+1 queries** — fetching a list of IDs, then querying each individually. Use batch operations (DynamoDB BatchGetItem, RDS IN clauses) or DataLoader pattern.
- **Synchronous calls in the critical path** — sending email, generating reports, resizing images synchronously during a user request. Offload to SQS + Lambda.
- **Right-sizing neglect** — EC2 instances chosen at launch and never re-evaluated. AWS Compute Optimizer analyzes CloudWatch metrics and recommends right-sizing. Run it quarterly.
- **Lambda cold starts in latency-sensitive paths** — Lambda provisioned concurrency for paths with <100ms SLAs. Cold starts are 200ms–2s depending on runtime and package size.

---

## 6. Cost Optimization

### Design Principles

**Implement cloud financial management.** Cost optimization is not a one-time event. Tag everything, allocate costs to teams, create budgets with alerts, and review monthly.

**Measure consumption, not spend.** Track unit economics: cost per API call, cost per GB processed, cost per active user. Absolute spend growing is fine if unit cost is decreasing.

**Use the right pricing model.** On-Demand is the most expensive option and the right choice only for unpredictable or short-lived workloads. Committed use (Savings Plans, Reserved Instances) is the default for stable workloads.

### Tagging Strategy — The Foundation

Without consistent resource tagging, cost allocation is guesswork. Enforce a mandatory tagging policy at the AWS Organizations level utilizing SCPs that reject any resource creation missing essential tags: `team`, `environment`, `cost-center`, and `service`.

Use Python and the AWS Cost Explorer API to automate monthly cost reports and group costs by the `team` tag to allocate chargebacks programmatically.

### Savings Plans & Reserved Instances

Stable production environments should leverage committed-use pricing to save up to 72% over On-Demand rates:

1.  **Compute Savings Plans (Most Flexible):** Applies automatically across regions, instance families, and compute engines (EC2, ECS Fargate, Lambda). Offers up to 35% savings over 1-3 year terms.
2.  **EC2 Instance Savings Plans:** Commit to an instance family and region (e.g., m6g in ap-southeast-1) for higher discounts (up to 60%).
3.  **RDS Reserved Instances:** Covers specific database engines and instance classes. Crucial for production databases that run 24/7.
4.  **ElastiCache/Redshift Reserved Nodes:** Yields significant cost reductions for persistent caching and analytical clusters.

> [!TIP]
> Never buy Savings Plans to cover 100% of your peak capacity. Analyze Cost Explorer recommendations based on your steady-state baseline over the past 60 days, and buy Savings Plans to cover that minimum. Let On-Demand pricing absorb temporary spikes.

### EC2 Spot Instances

Spot Instances offer up to a 90% discount over On-Demand rates by utilizing spare AWS capacity, with the caveat that AWS can reclaim the instance with a 2-minute interruption notice.

*   **Ideal Workloads:** Batch processing pipelines (AWS Batch), CI/CD runner agents, stateless web tiers using mixed instance auto-scaling groups, ML training, and EMR/Glue data processing.
*   **Unsuitable Workloads:** Stateful databases, real-time latency-sensitive APIs with strict SLAs, and long-running non-checkpointable computations.

In your stateless application web clusters, mix Spot and On-Demand tasks to maintain high availability:

```hcl
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name
  capacity_providers = [
    aws_ecs_capacity_provider.spot.name,
    aws_ecs_capacity_provider.ondemand.name
  ]
  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.spot.name
    weight            = 80      # 80% Spot instances
    base              = 0
  }
  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ondemand.name
    weight            = 20      # 20% On-Demand instances
    base              = 2       # Maintain at least 2 On-Demand tasks always
  }
}
```

### S3 Storage Optimization

Establish a structured data lifecycle strategy to transition files automatically to cheaper storage classes based on access requirements:

*   **S3 Standard:** Accessed daily (raw intake, active user files).
*   **S3 Standard-IA:** Accessed weekly (30-day minimum, has data retrieval fees).
*   **S3 Glacier Instant Retrieval:** Accessed monthly (requires immediate millisecond retrieval).
*   **S3 Glacier Flexible Retrieval:** Accessed less than quarterly (retrieval takes 3-5 hours).
*   **S3 Glacier Deep Archive:** Accessed less than annually (cheapest storage, 12-hour retrieval).
*   **S3 Intelligent-Tiering:** Recommended for unknown or highly variable access patterns.

Enforce S3 lifecycle configurations in Terraform to automate these transitions:

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "tiering"
    status = "Enabled"
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7  # Remove incomplete uploads to save hidden costs
    }
  }
}
```

### Cost Optimization Anti-Patterns

- **Cost optimization as a one-time project** — costs drift. Unused resources, forgotten dev environments, and over-provisioned instances accumulate weekly. Make it a monthly ritual.
- **Optimizing before product-market fit** — do not spend 3 weeks right-sizing Lambda memory for a service with 50 users. Optimize when the unit economics actually matter at scale.
- **Shared accounts with no tag enforcement** — without tags, cost is unallocatable. Teams won't optimize spend they can't see.
- **Ignoring data transfer costs** — NAT Gateway, inter-AZ traffic, and egress to internet are frequently the largest surprise line items. Always check your Cost Explorer service breakdown.

---

## 7. Sustainability

### Design Principles

**Understand your impact.** Use the AWS Customer Carbon Footprint Tool and CloudWatch to baseline your energy consumption before optimizing.

**Maximize utilization.** Underutilized resources waste energy. A Lambda function with 128MB memory cap on a workload that needs 512MB runs 4x longer, consuming more energy than a correctly sized function.

**Use managed services.** AWS's managed services (RDS, DynamoDB, Lambda) have significantly better utilization rates than self-managed equivalents — the shared resource model means less idle capacity.

### Practical Sustainability Wins

#### Choose Green AWS Regions

When latency requirements are flexible, host workloads or analytical batch pipelines in AWS regions that maintain a high percentage of renewable energy grid matches:

*   **High Renewable Grid Match:** `us-west-2` (Oregon, ~95%), `eu-west-1` (Ireland, ~82%), `eu-central-1` (Frankfurt, ~72%).
*   **Standard Grid Match:** `ap-southeast-1` (Singapore, ~24%), `us-east-1` (N. Virginia, ~50%).

#### Graviton Compute Migration

Migrating compute tasks to Graviton-based processors is a simultaneous win for both costs and emissions. Graviton3 processors require up to **60% less energy** for the same operational performance compared to equivalent x86 chips, and they are widely supported across ECS, EKS, Lambda, and Amazon RDS.

#### Scale compute to zero

Unlike standard EC2 nodes that draw power even at 3% idle CPU, serverless architectures scale to zero during idle periods. For highly variable or spiky workloads, serverless results in a much smaller carbon footprint. In non-production environments, deploy auto-scaling schedules to shut down EC2/ECS tasks completely during off-business hours (e.g., 8 PM to 7 AM on weekdays and all day on weekends).

#### Storage Footprint Minimization

Unused storage is ongoing, wasted server power. Build data minimization into your pipelines: delete temporary transformation files immediately, aggregate raw transactional logs, and use lifecycle policies to transition cold data to deep archival states or delete it when retention compliance rules expire.

---

## 8. Pillar Tensions & Trade-off Navigation

Architectural decisions require conscious trade-offs between WAF pillars. Evaluate these tensions using logical frameworks rather than arbitrary choices.

### Reliability vs Cost

Redundancy across multiple AZs and regions significantly increases cost profiles.

*   *Resolution Framework:* Calculate the business cost of downtime (lost revenue, SLA penalties, customer churn) and multiply it by the probability of failure. If the expected loss exceeds the cost of the reliability upgrade, fund the upgrade.
*   *Example:* A nightly internal batch job can tolerate a 24-hour delay without customer impact. Single-AZ hosting ($500/mo) is highly rational over Multi-AZ ($800/mo) here. Conversely, a customer checkout API losing $50,000/hour during an outage makes Multi-AZ redundancy ($1,000/mo additional) an obvious investment.

### Security vs Performance

Intensive L7 packet inspection, TLS handshake negotiation, and continuous KMS encryption add latency to request paths.

*   *Resolution Patterns:* Terminate TLS handshakes at the ALB level using dedicated AWS crypto hardware. Cache KMS data keys locally for up to 5 minutes to bypass direct KMS API calls on every single database read/write. Use VPC PrivateLink to establish direct, internal service connections rather than routing traffic out through the public internet.

### Operational Excellence vs Security

Strict security controls, multi-factor authentication, and rigid SCPs can slow down operational teams during an active production outage.

*   *Resolution Patterns:* Provide dedicated break-glass IAM roles that bypass certain security constraints during verified emergencies. Document pre-authorized playbooks that explicitly allow on-call engineers to modify target groups or WAF rules without going through standard CAB reviews during verified DDoS attacks.

### Cost vs Performance

caching layers, read replicas, and fast memory cost money, while down-sizing resources saves money at the cost of performance.

*   *Resolution Framework:* Profile first using X-Ray to isolate the 20% of code paths driving 80% of latency. Set strict, user-centric latency budgets (e.g., p99 < 500ms). Only fund performance upgrades (like ElastiCache instances or RDS Read Replicas) when they directly resolve a bottleneck blocking your SLA target.

---

## 9. AWS Well-Architected Tool — Practical Usage

The AWS Well-Architected Tool (WAT) in the AWS Management Console acts as your central registry to track workload reviews and improvement plans.

### Key Concepts

*   **Workload:** A collection of assets and code that delivers business value (e.g., a microservice or an entire payment platform).
*   **Milestone:** A read-only snapshot of a workload review state at a specific point in time (e.g., "Pre-Launch Review").
*   **Lens:** A set of domain-specific review questions. Always apply the core *AWS Well-Architected Lens*, and supplement it with relevant specialized lenses (e.g., *Serverless*, *SaaS*, or *Software Lifecycle*).
*   **High Risk Issue (HRI):** A critical architecture gap that must be resolved before launching to production.
*   **Medium Risk Issue (MRI):** A notable gap that should be resolved within 90 days of the review.

### Conducting a Review — Facilitation Guide

1.  **Preparation (1 week out):** Share the question checklist with all engineering stakeholders. No one should see the questions cold. Gather architecture diagrams, SLOs, and recent post-mortems.
2.  **During the Review (2–4 hours for Tier 1):**
    *   Walk through questions sequentially.
    *   Focus on capturing architecture gaps rather than defending current implementations. Gaps represent future tickets.
    *   Time-box each pillar to 30 minutes to maintain momentum.
    *   Every identified HRI must be assigned a ticket and an engineering owner before the meeting adjourns.
3.  **Post-Review Follow-up:**
    *   Export the review PDF and store it in your internal documentation registry.
    *   Create corresponding JIRA tickets for all HRIs (P1 priority) and MRIs (P2 priority).
    *   Track remediation progress. Re-evaluate the workload in the WAT every 90 days and save a new milestone to visually track your risk reduction over time.