# AWS Interview Preparation

### Q: How do you design multi-account AWS environments?

<details>
<summary>Show Answer</summary>

Use **AWS Organizations** to group accounts into Organizational Units (OUs) by function (Security, Infrastructure, Workloads, Sandbox). Enforce guardrails with **Service Control Policies (SCPs)** (deny leaving the org, restrict regions). Centralize networking with **Transit Gateway** in a Network account, delegate security tools (GuardDuty) to a Security account, and use **IAM Identity Center** plus **Control Tower** or **AFT** for account vending via IaC.

**Typical OU layout:**

| OU | Accounts | Purpose |
| :--- | :--- | :--- |
| **Management** | Root/Payer | Billing and SCP management only — no workloads |
| **Security** | Log Archive, Security Tooling | Immutable CloudTrail/Flow Logs, GuardDuty delegated admin |
| **Infrastructure** | Network, Shared Services | Transit Gateway, Route 53 Resolver, shared CI/CD runners |
| **Workloads** | Prod-App1, Dev-App1 | Applications, split by environment |
| **Sandbox** | Dev-1, Sandbox-A | High freedom, budget-capped, isolated from prod network |

**Key architectural points:**
- SCPs apply to all principals *except* the management account root — design break-glass and automation roles carefully.
- Log archive and security tooling accounts should be in a separate OU with SCPs that deny destructive changes to audit data.

> **Gotcha:** Running workloads in the management (payer) account breaks the security model and complicates SCP inheritance. Keep it billing and org administration only.

See [Landing Zone](../01-knowledge-base/aws/landing-zone.md) for Control Tower and AFT detail.

</details>

---

### Q: How would you architect a highly available, fault-tolerant application on AWS?

<details>
<summary>Show Answer</summary>

Eliminate single points of failure: deploy compute across **at least three Availability Zones** in an Auto Scaling Group behind an **Application Load Balancer**. Use **Amazon RDS Multi-AZ** for synchronous DB failover. Externalize state (ElastiCache sessions, S3/CloudFront for static assets). Use **Route 53** health checks for DNS failover. For extreme HA, design **active-active multi-region** with DynamoDB Global Tables or Aurora Global Database.

**Key architectural points:**
- Multi-AZ protects against AZ failure, not regional outages — clarify RTO/RPO before calling it "HA."
- ALB health checks must match application readiness, not just TCP port open.

> **Gotcha:** RDS Multi-AZ failover is automatic but not instant — plan connection retry logic and DNS/cache TTLs. Multi-AZ is not a substitute for cross-region DR if the business requires regional failure tolerance.

</details>

---

### Q: Can you explain AWS Well-Architected Framework and how you apply it?

<details>
<summary>Show Answer</summary>

The **Well-Architected Framework** has six pillars you use as a design and review lens, not a one-time checklist:

| Pillar | Focus |
| :--- | :--- |
| **Operational Excellence** | IaC, CI/CD, observability, runbooks |
| **Security** | IAM least privilege, encryption, GuardDuty |
| **Reliability** | Multi-AZ, auto-healing, DR strategies |
| **Performance Efficiency** | Right-sizing, serverless, caching |
| **Cost Optimization** | Spot, Savings Plans, tagging |
| **Sustainability** | Efficient resource use, Graviton where appropriate |

**How I apply it:** Run Well-Architected Reviews in design phase; use **Trusted Advisor**, **AWS Config**, and automated checks in CI for continuous alignment.

> **Gotcha:** Treating WAF as documentation-only misses the value — high-risk workloads need workload-specific review questions (data classification, blast radius), not generic pillar slides.

See [Well-Architected Framework](../01-knowledge-base/aws/well-architected-framework.md).

</details>

---

### Q: How do you design secure, multi-tenant AWS architectures?

<details>
<summary>Show Answer</summary>

Isolation tier drives the model:

| Model | Isolation | Cost | Best for |
| :--- | :--- | :--- | :--- |
| **Silo** | Dedicated account or VPC per tenant | Highest | Enterprise, regulated tenants |
| **Pool (shared)** | Logical separation in shared compute/data | Lower | SaaS with strong app-layer controls |

**Pool model controls:**
- Row-Level Security (RLS) in relational DBs; tenant ID as DynamoDB partition key.
- **ABAC** with `aws:PrincipalTag` on IAM for dynamic S3/KMS scoping.
- **Amazon Cognito** (or external IdP) for per-tenant identity and claims.

> **Gotcha:** Pool models fail interviews if you only mention "tags on resources" — explain data-plane isolation (RLS, partition keys, encryption context) and how you prevent cross-tenant reads via misconfigured IAM or shared caches.

</details>

---

### Q: How do you choose a database in AWS?

<details>
<summary>Show Answer</summary>

Match the **access pattern**, not the brand name:

| Use Case | AWS Service |
| :--- | :--- |
| Relational / ACID | Aurora or RDS (PostgreSQL/MySQL) |
| Key-value / extreme scale | DynamoDB |
| Caching / sessions | ElastiCache (Redis/Memcached) |
| OLAP / warehousing | Redshift |
| Document | DocumentDB |
| Graph | Neptune |

**Key decision factors:** consistency needs, query flexibility, ops model (serverless vs provisioned), multi-region requirements, and licensing.

> **Gotcha:** Defaulting to Aurora for every workload ignores DynamoDB's operational model for high-cardinality, key-based access — and vice versa. Interviewers want "access pattern first," not "we always use Postgres."

</details>

---

### Q: Explain your experience with VPC, subnets, and security groups.

<details>
<summary>Show Answer</summary>

A **VPC** is the isolated network boundary. I segment with **public subnets** (IGW for ALB/NAT) and **private subnets** (NAT for outbound-only compute, no direct inbound from internet). **Security groups** are stateful, ENI-level firewalls (allow-only, reference by SG ID). **NACLs** are stateless subnet filters — useful for explicit deny of CIDR blocks at the edge.

**Evaluation order (conceptual):** route table → NACL → security group → host firewall.

> **Gotcha:** Security groups are not a replacement for NACLs when you need subnet-wide deny rules — SGs cannot deny. Relying on IP allow-lists in SGs instead of SG-to-SG references breaks when autoscaling changes instance IPs.

</details>

---

### Q: What are the various hybrid networking options available in AWS?

<details>
<summary>Show Answer</summary>

| Option | Bandwidth | Latency | Setup | Best for |
| :--- | :--- | :--- | :--- | :--- |
| **Site-to-Site VPN** | Up to ~1.25 Gbps/tunnel | Variable (internet) | Hours | Quick, lower-cost links |
| **Direct Connect** | 1–100 Gbps | Consistent, low | Weeks–months | Production, latency-sensitive |
| **Client VPN** | Per user | Variable | Hours | Remote workforce access |

**Key architectural points:**
- VPN over the public internet is encrypted but not SLA-backed like DX.
- Hybrid designs usually terminate on **Transit Gateway** or **Virtual Private Gateway** with BGP route propagation.

> **Gotcha:** A single VPN tunnel or single DX connection is still a SPOF — production hybrid designs need redundant tunnels, diverse paths, or DX + VPN backup.

</details>

---

### Q: How do you use Transit Gateway (TGW) to manage inter-VPC communication at scale?

<details>
<summary>Show Answer</summary>

**Transit Gateway** is a regional hub router that replaces full-mesh **VPC peering** (peering does not scale operationally past roughly a dozen VPCs). Spoke VPCs attach to the TGW; RFC1918 traffic routes through hub route tables.

**Key architectural points:**
- **TGW route table segmentation** isolates environments (prod table has no route to non-prod).
- Central **egress VPC** with `0.0.0.0/0` via NAT and **AWS Network Firewall** (or GWLB appliances) for inspection.
- Share TGW across accounts via **RAM** in multi-account designs.

> **Gotcha:** Attaching a VPC to TGW does not automatically fix routing — you must update subnet route tables *and* TGW route tables. Blackholes often come from missing return paths or overlapping CIDRs across spokes.

See [Centralized egress](../01-knowledge-base/aws/centralized-egress-tgw-nat.md).

</details>

---

### Q: How would you design a secure public/private hybrid cloud using AWS Direct Connect?

<details>
<summary>Show Answer</summary>

Terminate **Direct Connect** on a **Direct Connect Gateway** attached to **Transit Gateway**. Encrypt the link with **MACsec** (L2) or run **Site-to-Site VPN over the DX public VIF** (L3 IPsec). Propagate on-prem routes via **BGP**. Reach AWS APIs from on-prem through **interface VPC endpoints (PrivateLink)** instead of public endpoints.

**Key architectural points:**
- Separate **private VIF** (RFC1918 to VPC) from **public VIF** (AWS public services) based on traffic type.
- DNS: **Route 53 Resolver** endpoints and forwarding rules for hybrid name resolution.

> **Gotcha:** DX provides a private path to AWS networks, not automatic encryption of all application traffic — clarify MACsec/VPN requirements for compliance interviews.

</details>

---

### Q: How do you diagnose network latency issues in AWS VPC?

<details>
<summary>Show Answer</summary>

Work top-down from symptom to path:

1. **VPC Flow Logs** — accepted/rejected flows; identify affected ENI pairs.
2. **VPC Reachability Analyzer** — path tests through SGs, NACLs, and route tables.
3. **EC2 metrics** — `NetworkIn`/`NetworkOut`, CPU credit exhaustion on burstable instances.
4. **Hybrid** — DX/VPN CloudWatch metrics for packet loss and tunnel saturation.

**Key architectural points:**
- Cross-AZ traffic adds latency and data transfer cost — placement groups and AZ-aware architectures matter.
- NAT Gateway and TGW are common choke points under burst egress.

> **Gotcha:** High latency with zero Flow Log rejects often points to application or DNS issues, not security groups — don't stop at the VPC layer if the path is green in Reachability Analyzer.

</details>

---

### Q: How do you manage hybrid identity (AWS SSO, Active Directory integration)?

<details>
<summary>Show Answer</summary>

**IAM Identity Center** (formerly AWS SSO) is the hub for human access across accounts. Federate to corporate IdP (**Entra ID**, **Okta**, or on-prem **AD** via **AD Connector**). Use **SAML 2.0** for authentication and **SCIM** for automated user/group provisioning. Users get **short-lived STS credentials** per assigned account via permission sets.

**Key architectural points:**
- Permission sets are templates — map groups to sets per account/OU, not per-user IAM users.
- Break-glass roles live outside normal SSO paths with stronger auditing.

> **Gotcha:** Long-lived **IAM users with access keys** for humans still appear in audits — Identity Center does not remove the need to eliminate static keys in workload accounts.

</details>

---

### Q: Describe your experience with AWS IAM and implementing least privilege.

<details>
<summary>Show Answer</summary>

Start from **deny by default**. Use **identity-based policies** on **roles** (not long-lived users with access keys), scoped to resource ARNs. Use **IAM Access Analyzer** (unused access, policy generation from CloudTrail activity). In delegated environments, add **permission boundaries** on developer-created roles and **SCPs** at the org level.

**Key practices:**
- Prefer **role assumption** and **OIDC** for CI over static keys.
- Separate human, machine, and break-glass principals with different review cadences.

> **Gotcha:** Access Analyzer shows *unused* permissions, not *excessive* ones that were never invoked — least privilege still needs intentional policy design and periodic review, not automation alone.

</details>

---

### Q: What are some of the security best practices for AWS?

<details>
<summary>Show Answer</summary>

Layer controls by surface:

| Surface | Practices |
| :--- | :--- |
| **Compute** | IMDSv2 required; SSM Session Manager instead of SSH keys; Graviton/Bottlerocket where possible |
| **Database** | Private subnets; KMS at rest; Secrets Manager with rotation |
| **Storage** | Account-level S3 Block Public Access; Object Lock (WORM) for ransomware resilience |
| **Networking** | VPC endpoints for AWS APIs; centralized egress inspection (Network Firewall/GWLB) |

> **Gotcha:** Block Public Access stops *new* public exposure — existing bucket ACLs and misconfigured bucket policies still need Config rules and continuous scanning (e.g., Macie, CSPM).

</details>

---

### Q: How do you handle cross-account access in AWS?

<details>
<summary>Show Answer</summary>

Primary pattern: **IAM role assumption**. The trusting account defines a role whose **trust policy** allows the source principal (`sts:AssumeRole`). The source principal needs an **identity policy** allowing `sts:AssumeRole` on that role ARN — **both sides must allow**.

| Pattern | When |
| :--- | :--- |
| **Role assumption** | Human/CI access into another account |
| **Resource-based policies** | S3, KMS, SNS cross-account without assuming a role in the resource account |
| **ExternalId condition** | Third-party SaaS assuming roles — prevents confused deputy |

> **Gotcha:** Trust policy alone is insufficient — candidates often forget the identity-side `sts:AssumeRole` permission. For KMS, the key policy *and* IAM on the caller must align.

</details>

---

### Q: What strategies do you use to secure access to your S3 buckets?

<details>
<summary>Show Answer</summary>

Defense in depth for object storage:

1. Account-level **Block Public Access** — blocks new public ACLs/policies.
2. Bucket policy: deny unless `aws:SecureTransport` is true.
3. Restrict to **VPC endpoints** (`aws:SourceVpce`) or specific role ARNs.
4. **SSE-KMS** with CMKs and tight key policies.
5. **Amazon Macie** for sensitive data discovery.

> **Gotcha:** SSE-S3 vs SSE-KMS affects who can decrypt via IAM vs key policy — interview answers should mention KMS when tenants or cross-account access matter.

</details>

---

### Q: How would you protect sensitive data in transit and at rest in AWS?

<details>
<summary>Show Answer</summary>

| Layer | Approach |
| :--- | :--- |
| **At rest** | KMS CMKs on EBS, S3, RDS, SQS; separate keys per data classification where required |
| **In transit** | TLS 1.2+ at ALB/API Gateway (ACM); HTTPS to targets; **App Mesh mTLS** for east-west microservices |

**Key architectural points:**
- CMK key policies are part of the authorization model — not only IAM on roles.
- Certificate renewal and private CA lifecycle are operational requirements, not one-time setup.

> **Gotcha:** Encrypting S3 at rest does not protect data exfiltration if IAM allows `s3:GetObject` — encryption complements access control; it does not replace it.

</details>

---

### Q: How do you enforce least-privilege access controls in your AWS environment?

<details>
<summary>Show Answer</summary>

Stack controls from org boundary to resource:

| Layer | Mechanism |
| :--- | :--- |
| **Organization** | SCPs — maximum permissions ceiling |
| **Human access** | IAM Identity Center permission sets per account |
| **Delegated IAM** | Permission boundaries on developer-created roles |
| **Resource** | S3/KMS resource policies — explicit resource-side allows |
| **Continuous** | CloudTrail, Config, Access Analyzer |

> **Gotcha:** SCPs filter effective permissions but do not grant access — you still need identity policies. An "SCP-only" security model is incomplete in interviews.

</details>

---

### Q: How would you secure an API Gateway deployed on AWS?

<details>
<summary>Show Answer</summary>

1. **AWS WAF** on the API stage — OWASP rules, rate-based rules.
2. **Authorization** — Cognito user pool, Lambda authorizer, or IAM (`aws:iam`) for internal APIs.
3. **Throttling** and usage plans — abuse and cost protection.
4. **mTLS** with **ACM Private CA** for B2B partners.
5. **Private API** + **VPC endpoint** + resource policy for internal-only consumption.

> **Gotcha:** Regional vs edge-optimized API Gateway changes WAF attachment and CloudFront integration — pick intentionally for public internet vs private consumers.

</details>

---

### Q: What is the difference between ECS and EKS, and when would you use each?

<details>
<summary>Show Answer</summary>

| | ECS | EKS |
| :--- | :--- | :--- |
| **Type** | AWS-native orchestration | Managed Kubernetes |
| **Complexity** | Lower | Higher |
| **Ecosystem** | AWS-centric (Copilot, ECS integrations) | Full K8s (Helm, Argo, Istio) |
| **Portability** | AWS-only | Multi-cloud / on-prem |
| **Use when** | Speed, AWS-first teams, simpler ops | Existing K8s skills, multi-cloud, complex platform needs |

Both support **Fargate** (serverless tasks/pods) or EC2-backed capacity.

> **Gotcha:** "We need Kubernetes" is not always "we need EKS" — ECS on Fargate solves many container workloads with less control-plane overhead. Conversely, forcing ECS when the team already operates GitOps on EKS creates friction.

</details>

---

### Q: What's your experience with event-driven architectures?

<details>
<summary>Show Answer</summary>

Decouple producers and consumers with managed messaging:

| Service | Role |
| :--- | :--- |
| **EventBridge** | Central bus, schema registry, content-based routing |
| **SNS** | Fan-out pub/sub to many subscribers |
| **SQS** | Buffering, retries, back-pressure for Lambda/ECS consumers |

**Pattern:** API → queue → workers; failed consumers retain messages with DLQ for replay and inspection.

> **Gotcha:** SNS delivers at-least-once to multiple subscribers — design idempotent consumers. EventBridge is for event routing, not long-term buffering — pair with SQS when you need durable backlog.

</details>

---

### Q: How would you implement auto-scaling for an application with unpredictable traffic?

<details>
<summary>Show Answer</summary>

| Layer | Approach |
| :--- | :--- |
| **Compute** | ASG **target tracking** (e.g., 60% CPU); or **Fargate** / **Lambda** to shed capacity planning |
| **Database** | **Aurora Serverless v2** for ACU scaling without connection storms |
| **Async** | SQS depth-driven scaling on `ApproximateNumberOfMessagesVisible` |

**Key architectural points:**
- Scale-out is fast; scale-in should be conservative to avoid flapping.
- Warm pools or pre-warmed containers reduce cold-start latency for spiky traffic.

> **Gotcha:** Target tracking on CPU alone misses memory-bound or request-latency SLO breaches — use ALB request count per target or custom CloudWatch metrics where needed.

</details>

---

### Q: Which is the best service to host APIs? ALB vs API Gateway.

<details>
<summary>Show Answer</summary>

| | API Gateway | ALB |
| :--- | :--- | :--- |
| **Best for** | Serverless/Lambda, API management features | Containers/EC2, high throughput L7/L4 |
| **Features** | Throttling, usage plans, API keys, request transforms | Path routing, gRPC, WebSocket, lower $/request at scale |
| **Cost** | Higher per-million requests | Lower at high volume |
| **Choose when** | Managed API product surface | Raw routing throughput and simplicity |

> **Gotcha:** Many architectures use **both** — API Gateway for edge auth/throttling and ALB for internal service-to-service traffic. "One or the other globally" is usually wrong.

</details>

---

### Q: What are the different Load Balancers available in AWS?

<details>
<summary>Show Answer</summary>

| Load Balancer | OSI | Protocols | Best for |
| :--- | :--- | :--- | :--- |
| **ALB** | L7 | HTTP/HTTPS/WebSocket | Path/host routing, Lambda targets |
| **NLB** | L4 | TCP/UDP/TLS | Ultra-low latency, static IP, millions RPS |
| **GWLB** | L3/L4 | IP | Inline appliances (firewall, IDS) via GENEVE |

> **Gotcha:** NLB preserves client IP and supports TLS passthrough; ALB terminates HTTP and integrates with WAF — picking the wrong LB layer breaks observability and security controls.

</details>

---

### Q: What AWS services would you use for CI/CD, and how would you set up the pipeline?

<details>
<summary>Show Answer</summary>

**AWS-native reference pipeline:**

1. **Source** — CodeCommit or GitHub via CodeStar Connections.
2. **Build** — CodeBuild (test, Docker build, push to ECR).
3. **Deploy** — CodeDeploy (blue/green to ECS/EC2) or CloudFormation for infra.

**Common production variant:** **GitHub Actions** / **GitLab CI** with **OIDC federation** to IAM — no long-lived access keys in CI.

> **Gotcha:** OIDC trust policies must pin `sub`/`aud` claims to the repo and environment — a overly broad `StringLike` on the federated subject is a common CI security finding.

See [CI/CD knowledge base](../01-knowledge-base/cicd/00-index.md).

</details>

---

### Q: Can you explain what CloudFormation is and when it is preferable over Terraform?

<details>
<summary>Show Answer</summary>

**CloudFormation** is AWS-native IaC (JSON/YAML); state and drift detection are managed by AWS.

| Prefer CloudFormation | Prefer Terraform |
| :--- | :--- |
| SAM/serverless-first AWS apps | Multi-cloud or multi-vendor |
| Service Catalog / AWS-only delivery | Large module ecosystem, Terragrunt patterns |
| No remote backend to operate | Faster iteration for platform teams already on TF |

> **Gotcha:** "Native = better" fails when the org standardizes on Terraform modules and multi-account Terragrunt — CFN wins on AWS-only guardrailed vending (Control Tower customizations), not on every workload.

</details>

---

### Q: How do you ensure smooth and error-free deployments in AWS environments?

<details>
<summary>Show Answer</summary>

1. **Immutable infrastructure** — new AMI/image per release; no SSH patching in place.
2. **Blue/green or canary** — CodeDeploy, App Mesh, or Route 53 weighted routing.
3. **Automated gates** — unit, integration, smoke tests per stage.
4. **Automated rollback** — CloudWatch alarms on 5xx/latency trigger CodeDeploy rollback.

> **Gotcha:** Blue/green doubles capacity during cutover — cost and license limits matter. Canary needs metric-backed promotion, not just "deploy 10% and hope."

</details>

---

### Q: What's your approach to designing DR (Disaster Recovery) strategies in AWS?

<details>
<summary>Show Answer</summary>

Strategy follows **RTO** and **RPO** the business accepts:

| Strategy | RTO | RPO | Cost | How |
| :--- | :--- | :--- | :--- | :--- |
| **Backup & Restore** | Hours | Hours | $ | AWS Backup, S3 CRR |
| **Pilot Light** | ~30 min | Minutes | $$ | Core data replicated; compute scaled on failover |
| **Warm Standby** | Minutes | Seconds | $$$ | Reduced stack always running in DR region |
| **Active-Active** | Near-zero | Near-zero | $$$$ | Multi-region + Route 53 routing |

> **Gotcha:** Backup & Restore RTO includes restore *and* validation time — run game days; advertised "hours" often becomes a day without tested runbooks.

</details>

---

### Q: How do you respond to a major AWS service outage affecting your production environment?

<details>
<summary>Show Answer</summary>

1. Confirm scope on **AWS Health Dashboard** and **Personal Health Dashboard** — no changes based on rumors.
2. **Freeze deployments** during the incident.
3. If multi-region, execute **Route 53 failover** to the healthy region.
4. If single-region, **circuit breakers**, degrade gracefully, static fallback via **CloudFront/S3**.
5. Communicate via the **incident runbook** — status, impact, ETA, next update time.

> **Gotcha:** Failing over to DR during a partial AWS outage can amplify damage if DR dependencies share the same blast radius — verify DR region health before mass failover.

</details>

---

### Q: What is your approach to logging and monitoring AWS resources?

<details>
<summary>Show Answer</summary>

| Signal | Tools |
| :--- | :--- |
| **Metrics** | CloudWatch (infra + custom app metrics) |
| **Logs** | Centralize app, VPC Flow, CloudTrail to S3; query with Athena or OpenSearch / Logs Insights |
| **Traces** | X-Ray across distributed services |
| **Alerting** | CloudWatch Alarms → SNS → PagerDuty/Slack; **composite alarms** to reduce noise |

**Key architectural points:**
- Security logs land in a **central security account** with restricted delete permissions.
- Define SLOs before alert thresholds — alert on user impact, not every metric twitch.

> **Gotcha:** CloudTrail is audit-grade, not real-time threat detection — pair with GuardDuty, Security Hub, or SIEM for actionable security monitoring.

</details>

---

### Q: How do you design for compliance (HIPAA, PCI-DSS, GDPR) in AWS?

<details>
<summary>Show Answer</summary>

1. Confirm services are **in scope** for the framework (AWS compliance programs documentation).
2. Encrypt at rest (KMS CMKs) and in transit (TLS 1.2+).
3. **AWS Config** rules for continuous misconfiguration detection.
4. **CloudTrail** organization trail for API audit evidence.
5. Immutable logs in a **security account** (S3 Object Lock / WORM).

> **Gotcha:** AWS compliance attestation does not make *your* workload compliant — shared responsibility means you own IAM, network segmentation, app logging, and data handling proofs.

</details>

---

### Q: How do you monitor and optimize AWS costs in a production environment?

<details>
<summary>Show Answer</summary>

Use **Cost Explorer** for trends, **AWS Budgets** with forecast alerts (SNS/Slack), and operational hygiene:

- Orphaned EBS, unused EIPs, idle RDS
- S3 **lifecycle** transitions to colder tiers
- **Compute Optimizer** for right-sizing
- Replace chronically idle fixed capacity with serverless where fit

> **Gotcha:** Right-sizing production without performance testing causes regressions — optimize on utilization *and* latency/error SLOs, not CPU alone.

See [FinOps](../01-knowledge-base/aws/finops.md).

</details>

---

### Q: How do you manage AWS budgets and ensure cost-efficiency in large environments?

<details>
<summary>Show Answer</summary>

Enforce **cost allocation tags** (`Project`, `Environment`, `Owner`, `Team`) via Organizations **tag policies** and SCPs that block untagged creates. Set **AWS Budgets** per OU/account/team. Enable **Cost Anomaly Detection** for ML-based spike alerts. Chargeback/showback dashboards per product line.

> **Gotcha:** Tag policies enforce future creates — retroactive tagging campaigns are still required for legacy resources or cost reports stay incomplete.

</details>

---

### Q: Can you explain how AWS Reserved Instances and Spot Instances can help reduce costs?

<details>
<summary>Show Answer</summary>

| Purchase model | Discount | Commitment | Best for |
| :--- | :--- | :--- | :--- |
| **Savings Plans** | Up to ~72% | 1–3 yr hourly spend commit | Flexible across EC2, Fargate, Lambda |
| **Reserved Instances** | Up to ~72% | 1–3 yr instance family/region | Steady, predictable capacity |
| **Spot** | Up to ~90% | None (2-min interruption notice) | Fault-tolerant, stateless, batch |

**Strategy:** Cover baseline with Savings Plans, burst with On-Demand, run interruptible work on Spot with diversified capacity pools.

> **Gotcha:** Savings Plans commit to *spend*, not instance type — better flexibility than standard RIs, but still a financial lock-in; Spot without interruption handling fails batch jobs silently in interviews.

</details>

---

## 📚 Question Reference

Additional questions and topic coverage sourced from **[acecloudinterviews.com/questions](https://www.acecloudinterviews.com/questions/)**.
