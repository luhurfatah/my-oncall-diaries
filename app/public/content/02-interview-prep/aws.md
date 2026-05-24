# AWS Interview Questions: The Ultimate Cheatsheet

### Q: How do you design multi-account AWS environments?

<details>
<summary>Show Answer</summary>

Use **AWS Organizations** to group accounts into Organizational Units (OUs) based on function (Security, Infrastructure, Workloads, Sandbox). Enforce guardrails using **Service Control Policies (SCPs)** (e.g., deny leaving org, restrict regions). Centralize networking using Transit Gateway in a Network account, and delegate security tools (GuardDuty) to a Security account. Use **AWS IAM Identity Center** for centralized user access and **AWS Control Tower** (or AFT) to automate account vending via Infrastructure as Code.

| OU | Accounts | Purpose |
| :--- | :--- | :--- |
| **Management** | Root/Payer | Billing and SCP management only — no workloads |
| **Security** | Log Archive, Security Tooling | Immutable CloudTrail/Flow Logs, GuardDuty delegated admin |
| **Infrastructure** | Network, Shared Services | Transit Gateway, Route 53 Resolver, shared CI/CD runners |
| **Workloads** | Prod-App1, Dev-App1 | Actual apps, split by environment |
| **Sandbox** | Dev-1, Sandbox-A | High freedom, budget-capped, disconnected from prod network |

</details>

### Q: How would you architect a highly available, fault-tolerant application on AWS?

<details>
<summary>Show Answer</summary>

Eliminate single points of failure. Deploy compute across at least **3 Availability Zones** within an Auto Scaling Group behind an Application Load Balancer (ALB). Use **Amazon RDS Multi-AZ** for synchronous database replication and failover. Store state externally (sessions in ElastiCache, static assets in S3/CloudFront). Use Route 53 with health checks for DNS failover. For extreme HA, design Active-Active multi-region with DynamoDB Global Tables.

</details>

### Q: Can you explain AWS Well-Architected Framework and how you apply it?

<details>
<summary>Show Answer</summary>

It consists of 6 pillars:

| Pillar | Focus |
| :--- | :--- |
| **Operational Excellence** | IaC, CI/CD, observability, runbooks |
| **Security** | IAM least privilege, encryption, GuardDuty |
| **Reliability** | Multi-AZ, auto-healing, DR strategies |
| **Performance Efficiency** | Right-sizing, serverless, caching |
| **Cost Optimization** | Spot instances, Savings Plans, tagging |
| **Sustainability** | Reducing carbon footprint via efficient resource use |

I apply it by running Well-Architected Reviews in design phase and using AWS Trusted Advisor + Config rules for continuous compliance monitoring.

</details>

### Q: How do you design secure, multi-tenant AWS architectures?

<details>
<summary>Show Answer</summary>

Multi-tenancy depends on the required isolation tier:

- **Silo Model:** Dedicated account or VPC per tenant. Highest isolation, highest cost. Best for enterprise/regulated customers.
- **Pool Model (Shared):** All tenants share compute and databases. Use Row-Level Security (RLS) in databases, tenant IDs as DynamoDB partition keys, and ABAC IAM policies using `aws:PrincipalTag` to restrict S3/KMS access dynamically. Use AWS Cognito for tenant identity federation.

</details>

### Q: How do you choose a database in AWS?

<details>
<summary>Show Answer</summary>

Match the database to the access pattern:

| Use Case | AWS Service |
| :--- | :--- |
| Relational / Transactional (ACID) | Amazon Aurora or RDS (MySQL/PostgreSQL) |
| Key-Value / High-Throughput | DynamoDB (single-digit ms latency at any scale) |
| Caching / Session State | ElastiCache (Redis or Memcached) |
| Data Warehousing / OLAP | Amazon Redshift |
| Document Store | Amazon DocumentDB |
| Graph Database | Amazon Neptune |

</details>

### Q: Explain your experience with VPC, subnets, and security groups.

<details>
<summary>Show Answer</summary>

A VPC is an isolated network boundary. I segment it using **Public Subnets** (route to Internet Gateway for ALBs/NAT GWs) and **Private Subnets** (route to NAT GW for compute/databases). **Security Groups** act as stateful, instance-level firewalls (allow-rules only, referenced by SG ID not IP). **NACLs** provide stateless, subnet-level protection (useful for blocking specific bad CIDRs at the perimeter).

</details>

### Q: What are the various hybrid networking options available in AWS?

<details>
<summary>Show Answer</summary>

| Option | Bandwidth | Latency | Setup Time | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **Site-to-Site VPN** | Up to 1.25 Gbps/tunnel | Variable (over internet) | Hours | Quick connectivity, lower cost |
| **AWS Direct Connect** | 1 – 100 Gbps | Consistent, low | Weeks–months | Production, latency-sensitive workloads |
| **Client VPN** | Per-user | Variable | Hours | Remote individual access |

</details>

### Q: How do you use Transit Gateway (TGW) to manage inter-VPC communication at scale?

<details>
<summary>Show Answer</summary>

TGW acts as a central hub router, replacing full-mesh VPC peering (which doesn't scale past ~10 VPCs). Spoke VPCs attach to the TGW and route RFC1918 traffic through it. I use **TGW Route Table segmentation** to isolate environments (Prod route table has no route to Non-Prod) and send `0.0.0.0/0` through a central Egress VPC with AWS Network Firewall for inspection.

</details>

### Q: How would you design a secure public/private hybrid cloud using AWS Direct Connect?

<details>
<summary>Show Answer</summary>

Terminate DX at a **Direct Connect Gateway** attached to a Transit Gateway. Use **MACsec** on the DX link for Layer 2 encryption, or run a Site-to-Site VPN *over* the DX public VIF for end-to-end IPsec encryption (Layer 3). Propagate on-premises routes via BGP. Restrict access to AWS APIs from on-premises using PrivateLink (VPC Endpoints) instead of public endpoints.

</details>

### Q: How do you diagnose network latency issues in AWS VPC?

<details>
<summary>Show Answer</summary>

1. Use **VPC Flow Logs** to check for accepted/rejected packets and identify which source/destination pairs are affected.
2. Use **VPC Reachability Analyzer** to trace paths and pinpoint SG/NACL/Route Table misconfigurations.
3. Check EC2 metrics for **NetworkIn/NetworkOut** bottlenecks and CPU credit depletion (for burstable instances).
4. For hybrid, check Direct Connect or VPN CloudWatch metrics for packet drops or tunnel saturation.

</details>

### Q: How do you manage hybrid identity (AWS SSO, Active Directory integration)?

<details>
<summary>Show Answer</summary>

I use **AWS IAM Identity Center** (formerly SSO). For hybrid environments, I connect it to a corporate IdP (Entra ID/Azure AD, Okta, or on-prem AD via AD Connector). We use **SAML 2.0** for authentication federation and **SCIM** for automated user/group provisioning. Users authenticate once against the corporate IdP and receive short-lived STS credentials for any assigned AWS account.

</details>

### Q: Describe your experience with AWS IAM and implementing least privilege.

<details>
<summary>Show Answer</summary>

I start by denying all access by default. I use **Identity-Based Policies** attached to roles (never long-lived IAM Users with access keys), scoped down to specific resource ARNs. I use **IAM Access Analyzer** to review unused permissions and auto-generate least-privilege policies from CloudTrail. For delegated environments, I enforce **Permission Boundaries** on developer-created roles and **SCPs** at the org level.

</details>

### Q: What are some of the security best practices for AWS?

<details>
<summary>Show Answer</summary>

- **Compute:** Use IMDSv2 only. No SSH keys — use SSM Session Manager. Use Graviton/Bottlerocket for a reduced attack surface.
- **Database:** Keep databases in private subnets. Enable KMS encryption at rest. Use Secrets Manager with auto-rotation.
- **Storage:** Block S3 public access at the account level. Enable S3 Object Lock (WORM) against ransomware.
- **Networking:** Use PrivateLink (VPC Endpoints) so traffic to AWS APIs never traverses the public internet. Centralize egress filtering via Network Firewall.

</details>

### Q: How do you handle cross-account access in AWS?

<details>
<summary>Show Answer</summary>

Using **IAM Role Assumption**. Account B (trusting) has a role with a Trust Policy allowing Account A's principal (`sts:AssumeRole`). Account A's principal must also have an identity policy granting `sts:AssumeRole` on that role ARN — both sides must allow it. For resource sharing (S3/KMS), I use Resource-Based Policies. For third-party integrations, I always mandate an `ExternalId` condition to prevent confused deputy attacks.

</details>

### Q: What strategies do you use to secure access to your S3 buckets?

<details>
<summary>Show Answer</summary>

1. Enable Account-level **Block Public Access** — prevents any misconfiguration from making a bucket public.
2. Force HTTPS-only in bucket policies (`aws:SecureTransport: true`).
3. Restrict access to specific VPC Endpoints (`aws:SourceVpce`) or specific IAM roles.
4. Enable Server-Side Encryption with KMS Customer Managed Keys (SSE-KMS).
5. Enable **Amazon Macie** to scan for PII or secrets accidentally committed.

</details>

### Q: How would you protect sensitive data in transit and at rest in AWS?

<details>
<summary>Show Answer</summary>

- **At Rest:** Enable AWS KMS encryption for all EBS volumes, S3 buckets, RDS databases, and SQS queues. Use CMKs (Customer Managed Keys) to control key rotation and access via key policies.
- **In Transit:** Terminate TLS 1.2+ at the ALB/API Gateway using ACM certificates. Enforce HTTPS between the ALB and backend targets. For microservices, use AWS App Mesh with mTLS between services.

</details>

### Q: How do you enforce least-privilege access controls in your AWS environment?

<details>
<summary>Show Answer</summary>

Layer multiple controls: **SCPs** set hard maximum limits for the entire account/OU. **IAM Identity Center** maps human access to specific permission sets per account. **Permission Boundaries** cap what developer-created roles can ever do. **Resource Policies** (S3, KMS) add an explicit resource-side allow requirement. Continuously audit with CloudTrail, AWS Config rules, and IAM Access Analyzer.

</details>

### Q: How would you secure an API Gateway deployed on AWS?

<details>
<summary>Show Answer</summary>

1. Attach **AWS WAF** to block SQLi, XSS, and volumetric attacks.
2. Implement authorization: Cognito User Pool authorizer, Lambda custom authorizer, or IAM authorization (`aws_iam`).
3. Set throttling limits and usage plans to prevent DDoS and API key abuse.
4. Enable **mTLS** for B2B partner APIs using ACM Private CA.
5. Use a **VPC Endpoint** with resource policy to keep the API fully private if only consumed internally.

</details>

### Q: What is the difference between ECS and EKS, and when would you use each?

<details>
<summary>Show Answer</summary>

| | ECS | EKS |
| :--- | :--- | :--- |
| **Type** | AWS-native orchestration | Managed Kubernetes |
| **Complexity** | Lower | Higher |
| **Ecosystem** | AWS-specific | Huge open-source K8s (Helm, Istio, Argo) |
| **Portability** | AWS-only | Multi-cloud / on-prem portable |
| **Use when** | Speed, simplicity, AWS-first teams | K8s expertise, multi-cloud, complex workloads |

</details>

### Q: What's your experience with event-driven architectures?

<details>
<summary>Show Answer</summary>

I build decoupled systems using **EventBridge** as the central event bus for routing and filtering rules, **SNS** for pub/sub fan-out (pushing one event to multiple SQS queues simultaneously), and **SQS** to buffer traffic bursts so downstream consumers (Lambda, ECS tasks) aren't overwhelmed. This pattern ensures resilience — if one consumer goes down, messages queue up and are retried automatically.

</details>

### Q: How would you implement auto-scaling for an application with unpredictable traffic?

<details>
<summary>Show Answer</summary>

- **Compute:** Put EC2 instances in an Auto Scaling Group (ASG) with **Target Tracking Policies** (e.g., target 60% CPU). Or use **Fargate** / **Lambda** to remove capacity management entirely.
- **Database:** Use **Aurora Serverless v2**, which scales ACUs (Aurora Capacity Units) up/down instantly without connection interruption.
- **Queue-based scaling:** Buffer requests in SQS and scale ECS/Lambda consumers based on `ApproximateNumberOfMessagesVisible`.

</details>

### Q: Which is the best service to host APIs? ALB vs API Gateway.

<details>
<summary>Show Answer</summary>

| | API Gateway | ALB |
| :--- | :--- | :--- |
| **Best for** | Serverless / Lambda backends, managed APIs | Containers, EC2, high-throughput microservices |
| **Features** | Rate limiting, usage plans, request transforms, API keys | Simple routing, gRPC, WebSocket, very cheap at scale |
| **Cost** | Higher per-million requests | Lower per-million requests |
| **Choose when** | You need rich API management features | You need raw throughput and low cost |

</details>

### Q: What are the different Load Balancers available in AWS?

<details>
<summary>Show Answer</summary>

| Load Balancer | OSI Layer | Protocols | Best For |
| :--- | :--- | :--- | :--- |
| **ALB** (Application) | Layer 7 | HTTP/HTTPS/WebSocket | Web apps, path/host-based routing, Lambda targets |
| **NLB** (Network) | Layer 4 | TCP/UDP/TLS | Ultra-low latency, static IP, millions of req/sec |
| **GWLB** (Gateway) | Layer 3+4 | IP | Inline third-party virtual appliances (firewalls, IDS) |

</details>

### Q: What AWS services would you use for CI/CD, and how would you set up the pipeline?

<details>
<summary>Show Answer</summary>

I prefer **CodePipeline** as the orchestrator for AWS-native setups:

1. **Source:** CodeCommit (or GitHub via CodeStar connection).
2. **Build:** **CodeBuild** — compile, unit test, build Docker image, push to ECR.
3. **Deploy:** **CodeDeploy** for blue/green deployments to ECS or EC2; CloudFormation for infrastructure.

In practice, I often use **GitHub Actions** or **GitLab CI** integrating with AWS via OIDC (no stored IAM keys) for tighter developer workflows.

</details>

### Q: Can you explain what CloudFormation is and when it is preferable over Terraform?

<details>
<summary>Show Answer</summary>

**CloudFormation (CFN)** is AWS's native IaC service using JSON/YAML templates.

- **CFN is preferable when:** Building Serverless apps with SAM, delivering to customers via Service Catalog, or when you want state management fully handled by AWS (no remote backend to manage).
- **Terraform is better when:** Managing multi-cloud resources, needing faster drift detection, benefiting from the massive Terraform provider ecosystem, or organizing large codebases with reusable modules.

</details>

### Q: How do you ensure smooth and error-free deployments in AWS environments?

<details>
<summary>Show Answer</summary>

1. **Immutable Infrastructure:** Build new AMIs/container images on every release — never patch live instances.
2. **Blue/Green or Canary Deployments:** Use CodeDeploy or Route 53 weighted routing to shift traffic gradually.
3. **Automated testing:** Unit, integration, and smoke tests gate every pipeline stage.
4. **Automated rollbacks:** CloudWatch Alarms monitor HTTP 5xx errors — if they spike post-deployment, CodeDeploy automatically reverts.

</details>

### Q: What's your approach to designing DR (Disaster Recovery) strategies in AWS?

<details>
<summary>Show Answer</summary>

It depends on the RTO (Recovery Time Objective) and RPO (Recovery Point Objective) the business can tolerate:

| Strategy | RTO | RPO | Cost | How |
| :--- | :--- | :--- | :--- | :--- |
| **Backup & Restore** | Hours | Hours | $ | AWS Backup + S3 cross-region replication |
| **Pilot Light** | ~30 min | Minutes | $$ | Core DB replicating to DR; compute spun up on failover |
| **Warm Standby** | Minutes | Seconds | $$$ | Scaled-down full stack in DR region, scale up on event |
| **Active-Active** | Near-zero | Near-zero | $$$$ | Multi-region with Route 53 latency/failover routing |

</details>

### Q: How do you respond to a major AWS service outage affecting your production environment?

<details>
<summary>Show Answer</summary>

1. Verify scope on the **AWS Health Dashboard** and Personal Health Dashboard — do not act on assumptions.
2. **Do not push deployments** during an active incident; you'll add noise.
3. If Multi-Region, trigger Route 53 failover to the healthy region.
4. If single-region, isolate failing components using circuit breakers, serve static fallback pages via CloudFront/S3.
5. Communicate proactively with stakeholders on status and ETA using a pre-defined incident response runbook.

</details>

### Q: What is your approach to logging and monitoring AWS resources?

<details>
<summary>Show Answer</summary>

- **Metrics:** CloudWatch Metrics for CPU, memory, latency, and custom application metrics.
- **Logs:** Centralize application logs, VPC Flow Logs, and CloudTrail into S3. Query with **Athena** or ship to **OpenSearch/CloudWatch Logs Insights**.
- **Tracing:** AWS **X-Ray** to trace requests across distributed microservices and identify bottlenecks.
- **Alerts:** CloudWatch Alarms trigger SNS → PagerDuty/Slack for actionable incidents. Use **Composite Alarms** to reduce alert fatigue.

</details>

### Q: How do you design for compliance (HIPAA, PCI-DSS, GDPR) in AWS?

<details>
<summary>Show Answer</summary>

1. Verify the AWS services in your architecture are **in-scope** for the relevant compliance program (check aws.amazon.com/compliance).
2. Encrypt everything at rest (KMS CMKs) and in transit (TLS 1.2+).
3. Use **AWS Config Rules** to continuously detect non-compliant resources (unencrypted EBS, open S3 buckets).
4. Use **CloudTrail** for a complete audit trail of all API calls.
5. Store logs in a dedicated, immutable **Security account** using S3 Object Lock (WORM) — even admins cannot delete them.

</details>

### Q: How do you monitor and optimize AWS costs in a production environment?

<details>
<summary>Show Answer</summary>

Use **AWS Cost Explorer** for spend visualization and trend analysis. Set **AWS Budgets** with forecasted thresholds that alert via SNS/Slack before you overspend. Look for:
- Orphaned resources (unattached EBS volumes, unused Elastic IPs, idle RDS instances)
- Old S3 data to transition to Glacier via **Lifecycle Policies**
- Underutilized EC2 instances to right-size using **AWS Compute Optimizer**
- Services with high idle time to replace with Serverless equivalents

</details>

### Q: How do you manage AWS budgets and ensure cost-efficiency in large environments?

<details>
<summary>Show Answer</summary>

Implement strict **Cost Allocation Tags** (`Project`, `Environment`, `Owner`, `Team`). Enforce them via AWS Organizations **Tag Policies** and SCPs that require tags on resource creation. Set up **AWS Budgets** per OU, account, or team. Use **AWS Cost Anomaly Detection** with ML-based alerts for unexpected usage spikes.

</details>

### Q: Can you explain how AWS Reserved Instances and Spot Instances can help reduce costs?

<details>
<summary>Show Answer</summary>

| Purchase Model | Discount | Commitment | Best For |
| :--- | :--- | :--- | :--- |
| **Savings Plans** | Up to 72% | 1 or 3 year hourly spend | Any EC2, Fargate, Lambda — most flexible |
| **Reserved Instances** | Up to 72% | 1 or 3 year specific instance type | Steady-state workloads (databases, core services) |
| **Spot Instances** | Up to 90% | None (interruptible with 2 min notice) | Stateless, fault-tolerant batch/CI/CD/data workloads |

**Strategy:** Cover baseline with Savings Plans, top up with On-Demand, run variable/batch workloads on Spot.

</details>
