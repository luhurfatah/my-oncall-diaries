# GCP Professional Cloud Architect — Exam Cheatsheet (Deep Edition)

Comprehensive reference for the exam and for real design decisions. Organized by the five official exam domains, with case study deep dives, service internals, comparison tables, scenario walkthroughs, and an AWS-to-GCP mapping since your daily work is AWS-heavy.

---

## 1. Exam Domains and How Points Are Actually Distributed

| Domain | Approx weight | What it actually tests |
|---|---|---|
| Designing and planning a cloud solution architecture | ~24% | Requirements mapping, TCO/cost-performance tradeoffs, migration planning, business continuity |
| Managing and provisioning solution infrastructure | ~15% | Compute, storage, network provisioning choices, IaC |
| Designing for security and compliance | ~18% | IAM, org policy, data protection, compliance regimes |
| Analyzing and optimizing technical/business processes | ~18% | CI/CD, monitoring strategy, cost management, dev velocity |
| Ensuring solution and operations reliability | ~25% | SRE practices, DR, incident response, SLIs/SLOs/SLAs, capacity planning |

Exam mechanics: 2 hours, ~50 questions, multiple choice/multiple select, delivered via Kryterion or onsite testing center. No labs, pure scenario reasoning. A meaningful fraction of questions reference the named case studies without repeating the requirements text, so you're expected to recall them from memory.

**How to read a scenario question fast:** identify (1) the business requirement, usually cost/time/compliance driven, (2) the technical requirement, usually a constraint like "must support X QPS" or "must integrate with on-prem AD", then eliminate any answer that violates a stated constraint before comparing the survivors on cost/complexity. Most wrong answers fail step one, they're technically valid architectures that just ignore a stated business constraint (e.g., proposing a rebuild when the case study explicitly says "minimize re-engineering cost").

---

## 2. The Four Case Studies, In Depth

### Mountkirk Games
**Business:** Small games studio, wants to build a new multiplayer game expected to scale globally and fast, previous titles had trouble scaling database and web servers during peak.
**Technical requirements:** Dynamic scaling to match load, near-real-time analytics on 10M+ events/day, minimize latency to players globally, support A/B testing of game features, all in a way that avoids a repeat of past scaling failures.
**Architecture implications:**
- Compute: GKE or Compute Engine MIGs behind a global external HTTP(S) LB for the game backend API, regional if the game protocol is not HTTP-friendly (use TCP/SSL proxy LB for custom UDP/TCP game protocols)
- Analytics: Pub/Sub ingesting game telemetry, Dataflow for real-time aggregation, BigQuery for querying, this is the textbook streaming analytics pipeline
- Database: Depends on consistency needs, Spanner if truly global strong consistency for player state is required, Bigtable if it's high-throughput event/leaderboard data
- Avoid vendor lock-in on compute → containers (GKE) over proprietary PaaS

### TerramEarth
**Business:** Manufacturer of heavy equipment (tractors, harvesters), 2 million+ vehicles in the field, dealer network, moving from a legacy data center model, wants predictive maintenance and better dealer data sharing.
**Technical requirements:** Vehicles generate ~200MB/day generating in bursts, connectivity to vehicles is unreliable/intermittent (rural areas), need both batch (nightly upload) and streaming ingestion paths, ML for predictive maintenance, restrict dealer access to only their own data.
**Architecture implications:**
- Ingestion: Pub/Sub for streaming when connected, Transfer Appliance/Storage Transfer Service or batch upload jobs for when vehicles reconnect after being offline, this dual-path is the signature of this case study
- Storage: Bigtable for high-volume time-series sensor data, BigQuery for aggregated analytics
- Dealer isolation: separate service accounts/IAM per dealer, or partitioned BigQuery datasets with row-level/column-level security, sometimes tested as "how do you let each dealer see only their fleet" → IAM conditions or authorized views
- ML: Vertex AI for predictive maintenance models trained on sensor history

### EHR Healthcare
**Business:** Healthcare SaaS platform for insurance/patient management, currently on-prem and colocated, needs to modernize while staying HIPAA compliant, wants hybrid connectivity since some systems can't move yet.
**Technical requirements:** 99.9%+ uptime for patient-facing apps, HIPAA compliance (BAA, encryption, audit logging), hybrid connectivity to remaining on-prem systems, minimize disruption during migration, legacy app has tightly coupled monolith components.
**Architecture implications:**
- Hybrid networking: Dedicated or Partner Interconnect for production traffic volume, Cloud VPN as backup path or for lower-volume dev/test connectivity
- Compliance: CMEK via Cloud KMS, VPC Service Controls around the perimeter holding PHI, Data Access audit logs explicitly enabled, signed BAA, only HIPAA-eligible services in scope
- Migration: phased/hybrid approach, not a big-bang rebuild, since the case explicitly wants to minimize risk to a live patient-facing system, this is the case study where "hybrid, incremental" beats "full rebuild" answers
- HA: regional Cloud SQL or Spanner depending on scale, Managed Instance Groups across zones minimum, consider multi-region for the patient portal tier

### Helicopter Racing League (HRL)
**Business:** Live-streams helicopter races globally, cameras on aircraft, wants to grow viewership, currently struggles with the media processing pipeline and global stream delivery.
**Technical requirements:** Ingest high-bitrate video from remote race locations with unreliable connectivity, transcode at scale, deliver low-latency video globally, handle extremely spiky traffic (race day vs. non-race day), analyze viewer engagement in near-real time.
**Architecture implications:**
- Ingest: often from remote/rural race sites, so bandwidth-constrained uplinks matter, consider Transfer Appliance for non-live archival footage vs. live streaming protocols for the race itself
- Processing: Compute Engine or GKE running transcoding workloads, autoscaled hard for race-day spikes, this is the classic "instance group scales from near-zero to large fast" scenario, Spot/Preemptible fits since transcoding jobs are often restartable/fault-tolerant batch work
- Delivery: Cloud CDN + global external HTTP(S) LB for viewers, Cloud DNS geolocation routing to send viewers to nearest edge/backend
- Analytics: Pub/Sub + Dataflow + BigQuery again for viewer engagement telemetry, same pipeline shape as Mountkirk, different domain

**Cross-cutting pattern:** three of the four case studies (Mountkirk, TerramEarth, HRL) resolve to the same ingestion pipeline shape: **Pub/Sub → Dataflow → BigQuery/Bigtable**. If you see "high volume events, need near-real-time analytics" in any scenario, this pipeline is very likely part of the correct answer even if the case study isn't named.

---

## 3. Compute, In Depth

### Machine family selection
| Family | Best for |
|---|---|
| E2 | Cost-optimized general purpose, dev/test, non-critical workloads |
| N2/N2D | Balanced general purpose production workloads, N2D is AMD-based, usually cheaper |
| C2/C2D | Compute-optimized, high-performance computing, gaming servers, ad serving |
| M2/M3 | Memory-optimized, in-memory databases (SAP HANA), large caches |
| A2/A3 | GPU-accelerated (A100/H100), ML training |
| T2D/T2A | Scale-out ARM/x86 workloads, cost-sensitive horizontally-scaled apps |

Custom machine types let you pick exact vCPU/memory ratios when predefined types waste resources, this comes up when a scenario mentions a memory-heavy but not compute-heavy app that doesn't fit standard ratios.

### Sole-tenant nodes
Dedicated physical server for your VMs only, use case: licensing that requires dedicated hardware (some BYOL scenarios), strict compliance requiring physical isolation. This is a niche but real exam distractor/answer.

### GKE deep dive
- **Autopilot vs Standard**: Autopilot is fully managed (Google manages nodes, security hardening, patching), Standard gives you node-level control. Exam trend favors Autopilot as the "least operational overhead" answer unless the scenario needs privileged workloads, custom node config, or DaemonSets that Autopilot restricts.
- **Node pools**: group nodes by machine type/purpose (e.g., a GPU node pool for ML workloads, separate from a general pool), lets you target specific workloads to specific hardware via node selectors/taints
- **Workload Identity**: binds a Kubernetes service account to a Google service account without static key files, this is the direct GCP equivalent of what you already do with IRSA and Pod Identity on EKS, same underlying goal (short-lived, scoped credentials for pods)
- **Binary Authorization**: enforce that only signed/verified container images deploy to the cluster, maps conceptually to your Cosign keyless signing work, likely to appear in a "how do we ensure only approved images run in production" question
- **Multi-cluster**: Anthos/GKE Enterprise for fleet management across clusters/clouds, comes up in "avoid vendor lock-in, run consistently across GCP and on-prem" scenarios

### Autoscaling matrix
| Layer | Mechanism | Scales based on |
|---|---|---|
| Compute Engine MIG | Managed Instance Group autoscaler | CPU utilization, LB serving capacity, custom Cloud Monitoring metric, schedule |
| GKE pods | Horizontal Pod Autoscaler (HPA) | CPU/memory/custom metrics per pod |
| GKE pod sizing | Vertical Pod Autoscaler (VPA) | Historical resource usage, recommends/adjusts requests |
| GKE nodes | Cluster Autoscaler | Pending unschedulable pods, scales existing node pools |
| GKE nodes, cross-pool | Node Auto-Provisioning (NAP) | Creates new node pools automatically to match workload shape, not just scaling existing pools |

The Cluster Autoscaler vs NAP distinction you already worked through in your labs is a real exam distinction: Cluster Autoscaler only scales nodes within pools you defined, NAP will create entirely new node pools if none of the existing ones fit the pending pod's requirements.

---

## 4. Storage, In Depth

### Persistent Disk / Hyperdisk types
| Type | Use case |
|---|---|
| pd-standard | Cheapest, lowest IOPS, batch/sequential workloads |
| pd-balanced | Default general-purpose SSD |
| pd-ssd | High IOPS, databases |
| pd-extreme / Hyperdisk Extreme | Highest performance, SAP HANA, large DBs, IOPS provisioned independently of size |
| Hyperdisk Balanced/Throughput | Next-gen PD, decouple capacity/IOPS/throughput provisioning |

Regional PD replicates synchronously across two zones in a region for HA at the disk layer, but it is still not a backup, snapshots remain necessary for point-in-time recovery and cross-region durability.

### Cloud SQL vs AlloyDB vs Spanner vs Bigtable (the classic 4-way exam trap)
| | Cloud SQL | AlloyDB | Spanner | Bigtable |
|---|---|---|---|---|
| Model | Relational (MySQL/Postgres/SQL Server) | PostgreSQL-compatible | Relational, horizontally scalable | Wide-column NoSQL |
| Scale | Vertical, read replicas | Vertical + read pool, better for analytics-heavy Postgres | Horizontal, petabyte scale | Horizontal, petabyte scale, very high throughput |
| Consistency | Strong (single region) | Strong | Strong, globally (with multi-region config) | Eventually consistent by default, strong within a row |
| When it's the answer | Standard transactional app, single-region OK, cost matters | Postgres workload needing analytics performance without moving to a separate warehouse | Need global strong consistency + relational semantics + massive scale, cost is not the primary constraint | Extremely high write throughput, time-series/IoT, don't need SQL joins |

**AlloyDB** is a relatively newer addition worth knowing even if it's less case-study-anchored: it's Google's PostgreSQL-compatible service pitched as faster than stock Postgres for transactional + analytical mixed workloads, tends to show up as the answer for "we're on Postgres, need better performance, don't want to change our app."

### BigQuery internals worth knowing cold
- Storage and compute are billed and scaled separately, this is why "just add more compute" is never the answer to a BigQuery cost problem
- **Partitioning**: by ingestion time, by a DATE/TIMESTAMP column, or by an INTEGER range, reduces bytes scanned by pruning partitions
- **Clustering**: sorts data within partitions by up to 4 columns, further reduces bytes scanned for filtered/aggregated queries, stacks with partitioning
- **Materialized views**: precomputed, auto-refreshed, use when the same aggregation query runs repeatedly
- **BI Engine**: in-memory analysis layer for fast dashboard queries, use when the pain point is dashboard latency not raw query cost
- **Pricing models**: on-demand (pay per bytes scanned) vs. capacity-based editions (Standard/Enterprise/Enterprise Plus, pay for slots), capacity-based is the answer once query volume is high and predictable enough that flat-rate beats variable on-demand cost
- **Authorized views / row-level security / column-level security**: the mechanism for "let this team see only their slice of the warehouse" questions, this is the TerramEarth dealer-isolation pattern applied to BigQuery specifically

### Cloud Storage deep notes
- Object versioning vs. lifecycle rules are separate features, versioning keeps old object generations, lifecycle rules act on age/class/version state
- Signed URLs: time-limited access to private objects without making them public, common answer for "let an external partner download one file without a GCP account"
- Requester Pays: shifts egress/request cost to whoever accesses the bucket, useful for public datasets you don't want to fund indefinitely
- Turbo Replication (dual-region): near-real-time replication SLA between two specific regions when standard multi-region replication lag isn't good enough

---

## 5. Networking, In Depth

### VPC internals
- VPC networks and their routes are global, subnets are regional, firewall rules are global but can target by network tag/service account and are enforced at the hypervisor level (distributed stateful firewall, not a single choke point), this maps to the same mental model as security groups but applied globally per VPC rather than being explicitly tied to an instance-level ENI construct
- Firewall rule evaluation: implied allow egress + implied deny ingress exist by default, explicit rules are evaluated by priority (lower number = higher priority), deny rules can override allow rules of lower priority
- Alias IP ranges: let a single VM/pod have multiple internal IPs from a defined range, this is what GKE uses under the hood for pod IP allocation in VPC-native clusters

### Shared VPC roles (frequently tested specifics)
- **Shared VPC Admin**: set at the org/folder level, can attach/detach service projects to a host project
- **Network Admin**: full control over network resources in the host project (subnets, routes, firewall) but cannot assign VMs to the network
- **Network User**: granted on specific subnets to service project owners, lets them deploy resources into that subnet without touching network config
This three-way split is the standard "central network team keeps control, application teams self-serve within their subnet" pattern, expect a question shaped exactly like this.

### VPC Peering vs Shared VPC vs PSC, disambiguated
| | Shared VPC | VPC Peering | Private Service Connect |
|---|---|---|---|
| Relationship | One host, many service projects, same org typically | Two independent VPCs, any org | Consumer VPC to a published service (Google API or another VPC's service) |
| Transitivity | N/A, all in one network | Non-transitive | N/A, point-to-point via endpoint |
| Best for | Centralized governance across teams in one org | Connecting a small number of independent VPCs, including across orgs | Consuming a service privately without full network peering, or exposing your own service to consumers without exposing your whole VPC |

### Hybrid connectivity decision factors
| Requirement | Choice |
|---|---|
| Need it working today, moderate bandwidth, encrypted over internet | Cloud VPN (HA VPN gives 99.99% SLA with two tunnels) |
| Sustained high bandwidth, lowest latency, willing to colocate | Dedicated Interconnect |
| High bandwidth but no colocation facility access | Partner Interconnect |
| Connecting VPCs across different cloud providers directly | Cross-Cloud Interconnect |
| Encrypted traffic over Interconnect (Interconnect itself isn't encrypted by default) | HA VPN over Interconnect, or MACsec where supported |

### Load balancer selection, full matrix
| Type | Layer | Global/Regional | Traffic | Typical use |
|---|---|---|---|---|
| Global external Application LB | L7 | Global | HTTP(S) | Public web apps, anycast IP, CDN/Armor integration |
| Regional external Application LB | L7 | Regional | HTTP(S) | Data residency requirement for LB itself |
| Classic external Application LB | L7 | Global (legacy) | HTTP(S) | Legacy, being phased toward the newer global external ALB |
| Global external Proxy Network LB (SSL/TCP proxy) | L4 | Global | TCP/SSL non-HTTP | Global reach for non-HTTP protocols |
| External passthrough Network LB | L4 | Regional | TCP/UDP | Preserve client source IP, need raw protocol passthrough |
| Internal Application LB | L7 | Regional | HTTP(S) | Internal microservices, service mesh ingress |
| Internal passthrough Network LB | L4 | Regional | TCP/UDP | Internal non-HTTP services |

### Cloud Armor specifics
- **Edge security policies**: applied at Google's edge before traffic hits your backend, use for geo-blocking, blocking known bad IPs at scale
- **Backend security policies**: standard WAF rules (OWASP Top 10 preconfigured rulesets), rate limiting, bot management
- Adaptive Protection: ML-based DDoS/anomaly detection layered on top

### Cloud NAT specifics
- Regional resource, requires a Cloud Router in the same region/network
- Outbound only, by design, never the answer when inbound connectivity from the internet is required
- No SLA-impacting single point of failure the way a self-managed NAT instance would be, this is the "why not just run a NAT VM yourself" answer

---

## 6. IAM & Security, In Depth

### Resource hierarchy example
```
Organization (example.com)
├── Folder: Production
│   ├── Project: prod-web
│   └── Project: prod-data
├── Folder: Non-Production
│   ├── Project: dev
│   └── Project: staging
└── Folder: Shared Services
    └── Project: shared-vpc-host
```
IAM bindings set at Organization apply everywhere below. A binding at Folder: Production applies to prod-web and prod-data but not to dev/staging. This is the standard exam diagram, expect a question asking "where do you grant a role so it applies to only the two production projects" → answer is the Production folder, not the org, not each project individually.

### Org Policy constraints worth memorizing
| Constraint | Purpose |
|---|---|
| `constraints/iam.disableServiceAccountKeyCreation` | Block creation of SA key files org-wide |
| `constraints/compute.vmExternalIpAccess` | Restrict which VMs can have external IPs |
| `constraints/compute.restrictLoadBalancerCreationForTypes` | Limit which LB types can be created |
| `constraints/gcp.resourceLocations` | Restrict where resources can be created, common data-residency answer |
| `constraints/compute.requireOsLogin` | Enforce OS Login instead of metadata-based SSH keys |
| `constraints/sql.restrictPublicIp` | Block Cloud SQL instances from having public IPs |

Org Policy answers the "how do we enforce this regardless of who has IAM permissions" question. IAM answers "who can do what." If a scenario says "even project owners should not be able to do X," that is always an Org Policy answer, never an IAM answer, since IAM Owner would otherwise be able to override it.

### Service account best practices, ranked
1. Workload Identity Federation (GKE, or external identity providers like AWS/Azure/on-prem AD) — no keys at all
2. Impersonation (short-lived tokens via `iam.serviceAccounts.getAccessToken`) — no long-lived keys
3. Attached service accounts on Compute Engine (VM's identity, metadata server issues short-lived tokens automatically) — no keys
4. Downloaded JSON key files — last resort, avoid in production, this is almost always the wrong exam answer when a better option is listed

### VPC Service Controls vs Firewall vs IAM (the exfiltration triangle)
- **IAM** stops unauthorized *identities* from accessing a resource
- **Firewall rules** stop unauthorized *network paths* from reaching a resource
- **VPC Service Controls** stops *authorized* identities/services from moving data to an *unauthorized perimeter* (e.g., a compromised or misconfigured service account copying BigQuery data to a personal project)
The exam likes to test that these are complementary, not substitutes. A question describing an insider threat or credential-compromise data exfiltration scenario wants VPC-SC specifically, since IAM/firewall alone don't stop an authorized identity from moving data across projects.

### Compliance quick reference
| Regime | Key GCP mechanisms |
|---|---|
| HIPAA | BAA with Google, HIPAA-eligible services list, CMEK, audit logging, VPC-SC |
| PCI DSS | Network segmentation (separate VPC/project for cardholder data), restricted service perimeter, logging |
| GDPR | Data residency (`resourceLocations` org policy), right to erasure processes, DPA with Google |
| FedRAMP | Assured Workloads, restricted regions, personnel controls |

---

## 7. Data & Analytics, In Depth

### Pub/Sub specifics
- At-least-once delivery by default, exactly-once delivery is available but adds latency/throughput cost, only enable it when duplicate processing is genuinely unacceptable and the consumer can't dedupe itself
- Push vs pull subscriptions: push for low-latency delivery to an HTTP endpoint (e.g., Cloud Run/Functions), pull when the consumer wants to control its own read rate (e.g., Dataflow)
- Dead-letter topics: capture messages that fail repeated delivery attempts instead of blocking the subscription
- Ordering keys: guarantee order within a key while still parallelizing across keys, use when a scenario needs ordering guarantees per-entity but not globally

### Dataflow specifics
- Apache Beam under the hood, so pipelines are portable across GCP/other runners in theory, exam sometimes frames this as the "avoid lock-in" answer for data pipelines
- Autoscaling workers based on backlog, no manual cluster sizing the way Dataproc requires
- Templates (classic and Flex) let non-engineers launch pre-built pipelines with parameters, this is the answer for "let analysts run ETL jobs without writing code"

### Dataproc vs Dataflow
| | Dataproc | Dataflow |
|---|---|---|
| Underlying tech | Managed Hadoop/Spark | Managed Apache Beam |
| Best fit | Lift-and-shift existing Spark/Hadoop jobs | New pipelines, unified batch+streaming model |
| Cluster management | You size/manage clusters (or use autoscaling policies) | Fully serverless, no cluster sizing |
| Exam signal | "We already have Spark jobs, migrate with minimal rewrite" | "We're building something new" or "need both batch and streaming in one model" |

### Composer (managed Airflow)
Use when a scenario needs DAG-based orchestration across multiple GCP services and possibly external systems, distinct from Dataflow/Dataproc which run the actual processing, Composer just orchestrates the sequence and dependencies between jobs.

---

## 8. Reliability, DR, and SRE, In Depth

### DR pattern selection with concrete GCP services
| Pattern | RTO | RPO | GCP implementation |
|---|---|---|---|
| Backup and restore | Hours to days | Hours | Scheduled snapshots/backups to Cloud Storage, restore on demand |
| Pilot light | Tens of minutes to hours | Minutes | Minimal always-on core (e.g., a small Cloud SQL replica), scale up on failover |
| Warm standby | Minutes | Seconds to minutes | Scaled-down but running full stack in a second region, promote on failover |
| Multi-site active-active | Near zero | Near zero | Global LB + multi-region Spanner/multi-region GKE, both regions serving live traffic |

### SRE math worth having memorized
- Error budget = 1 - SLO. A 99.9% SLO gives roughly 43 minutes of allowed downtime per month.
- If burn rate exceeds budget pace, the standard SRE response is to freeze feature releases and prioritize reliability work, this is a common "what should the team do" scenario answer.
- SLA is a subset/looser version of SLO with financial or contractual consequences attached, never the other way around, an SLA tighter than your internal SLO would be an unforced error.

### Monitoring and observability stack
- **Cloud Monitoring**: metrics, dashboards, alerting policies, uptime checks
- **Cloud Logging**: centralized logs, log-based metrics (turn a log pattern into a metric you can alert on), log sinks (route logs to BigQuery/Cloud Storage/Pub/Sub for retention or analysis)
- **Cloud Trace**: distributed tracing, latency breakdown across service calls
- **Cloud Profiler**: continuous CPU/memory profiling in production
- **Error Reporting**: aggregates and groups application errors automatically
This maps directly onto the OpenTelemetry centralized observability work you've already done across your Kubernetes clusters, same layered model: metrics/logs/traces, just GCP-native tooling instead of an OTel collector pipeline.

### Incident management
Google's SRE model (the actual book this exam draws from) emphasizes blameless postmortems, clear incident commander roles during an outage, and treating toil reduction as an engineering priority, not just an ops afterthought. Expect at least one question framed around "how should the team respond after an outage" where the correct answer is blameless postmortem plus concrete follow-up actions, not disciplinary action against an individual.

---

## 9. Cost Optimization, In Depth

| Lever | Mechanism | When it's the right answer |
|---|---|---|
| Committed Use Discounts | 1 or 3 year commit on vCPU/memory or spend-based | Stable, predictable baseline load |
| Sustained Use Discounts | Automatic, no commitment | Already happens on Compute Engine, not something you configure |
| Spot VMs | Up to ~60-91% off, can be preempted | Fault-tolerant batch, stateless workers, CI runners |
| Rightsizing recommendations | Recommender API suggests machine type changes | Ongoing hygiene, "we're overprovisioned" scenarios |
| BigQuery slot reservations/editions | Flat-rate capacity instead of per-query | High, predictable query volume |
| Storage Autoclass/lifecycle | Automatic or rule-based tiering | Unpredictable or well-known access decay patterns respectively |
| Egress minimization | Keep traffic within a region/zone, use Cloud CDN, Private Google Access | Any architecture with heavy inter-service or internet-facing traffic |

**Billing tools**: Budgets and alerts (proactive notification), Billing export to BigQuery (detailed cost analysis), Cost Table/Reports in console (quick visual breakdown). A scenario asking "how do we get notified before we blow the budget" wants Budgets and Alerts, not a dashboard someone has to check manually.

---

## 10. Migration Strategy, In Depth

### The 4 Rs, applied
| Strategy | Description | Signal in a question |
|---|---|---|
| Rehost (lift and shift) | Move VMs as-is | "minimize changes," "fastest path," tight deadline |
| Replatform (improve and move) | Swap a component for a managed equivalent during the move | "modernize the database but keep the app mostly as-is" |
| Refactor/rearchitect (rebuild) | Redesign for cloud-native | "long-term scalability," greenfield, no urgency constraint |
| Repurchase | Replace with SaaS | Rare on this exam, occasionally for things like email/collab tools |

### Migration tooling
- **Migrate to Virtual Machines**: for VM lift-and-shift from on-prem/other clouds into Compute Engine
- **Database Migration Service (DMS)**: homogeneous migrations (MySQL→Cloud SQL MySQL, Postgres→Cloud SQL/AlloyDB Postgres), minimal downtime via CDC
- **Datastream**: change data capture streaming into BigQuery/Cloud Storage/Bigtable, use when the target is analytics rather than an operational replica
- **Storage Transfer Service**: bulk data movement between on-prem/other clouds and Cloud Storage, scheduled/repeating transfers
- **Transfer Appliance**: physical device for large one-time transfers where bandwidth makes online transfer impractical, this is the answer whenever a case study mentions petabyte-scale data and limited/unreliable bandwidth (TerramEarth, HRL archival footage)

---

## 11. AWS-to-GCP Concept Mapping (since your daily reasoning is AWS-first)

| AWS | GCP | Notes |
|---|---|---|
| IAM Role + OIDC (IRSA) / EKS Pod Identity | Workload Identity Federation / Workload Identity (GKE) | Same goal: short-lived, scoped credentials for workloads, no static keys |
| VPC | VPC | GCP VPCs are global, subnets regional; AWS VPCs are regional, subnets are zonal, this trips people up in both directions |
| Security Groups | Firewall Rules (targeted by tag/service account) | GCP firewall rules are distributed/stateful at hypervisor level, not attached to an ENI construct |
| Transit Gateway | Network Connectivity Center (NCC) | You've already compared these directly in recent work |
| Direct Connect | Dedicated/Partner Interconnect | Similar tiering (colocation vs. partner-provided) |
| ALB/NLB | External Application LB / External passthrough Network LB | GCP splits by L7 vs L4 similarly |
| Route 53 routing policies | Cloud DNS routing policies | Geolocation/weighted/failover exist on both |
| S3 storage classes | Cloud Storage classes | Standard/Nearline/Coldline/Archive roughly mirrors Standard/IA/Glacier/Deep Archive |
| RDS | Cloud SQL | Similar managed relational model |
| Aurora | AlloyDB | Both pitched as faster, more scalable variants of open-source engines |
| DynamoDB | Firestore (docs) / Bigtable (wide-column, high throughput) | DynamoDB spans both use cases that GCP splits into two services |
| Redshift | BigQuery | BigQuery is more serverless by default, Redshift needs more cluster sizing decisions unless using Serverless |
| Kinesis | Pub/Sub + Dataflow | Kinesis Data Streams ~ Pub/Sub, Kinesis Data Analytics ~ Dataflow |
| KMS | Cloud KMS | Conceptually near-identical |
| Secrets Manager | Secret Manager | Conceptually near-identical |
| Organizations + SCPs | Resource Manager (Org/Folder/Project) + Org Policy | SCPs ~ Org Policy constraints |
| CloudTrail | Cloud Audit Logs (Admin Activity + Data Access) | Admin Activity is always-on like CloudTrail management events |
| CloudWatch | Cloud Monitoring + Cloud Logging | Split into two products where AWS keeps one |
| Terraform (already your daily tool) | Same, plus Deployment Manager/Config Connector as GCP-native alternatives | Exam accepts Terraform as a valid IaC answer |

---

## 12. Scenario Walkthroughs (worked examples)

**Scenario A:** "A retailer needs a database that supports strong consistency for inventory counts across three regions, with no planned downtime for schema changes, and query volume will scale from 1K to 500K QPS over the next year."
Reasoning: strong consistency + multi-region + massive horizontal scale → eliminate Cloud SQL (vertical, single-region-focused) and Bigtable (eventually consistent by default) → **Cloud Spanner** is the answer, cost is implicitly accepted since the requirements explicitly demand what only Spanner provides.

**Scenario B:** "A company wants to prevent any employee, including project owners, from ever creating a Cloud SQL instance with a public IP address, org-wide."
Reasoning: "including project owners" is the tell, IAM roles can't be restricted below what Owner grants without an override mechanism → **Org Policy constraint `constraints/sql.restrictPublicIp`** set at the organization node.

**Scenario C:** "An analytics team runs the same three dashboard queries against a 50TB BigQuery table hundreds of times per day, and query cost has become the largest line item on the bill."
Reasoning: repeated identical aggregation queries at high frequency → **materialized views** to avoid recomputation, plus check whether **partitioning/clustering** on the underlying table would further cut bytes scanned, consider **BI Engine** if the actual complaint is dashboard latency rather than billing cost.

**Scenario D:** "A healthcare company must ensure that even if a data analyst's credentials are compromised, exported patient data cannot be copied to a project outside the security team's control."
Reasoning: authorized identity, unauthorized destination → this is not an IAM problem (the identity is legitimately authorized) → **VPC Service Controls** perimeter around the BigQuery/GCS resources holding PHI.

**Scenario E:** "A gaming company's matchmaking service needs to preserve the original client IP address for logging and anti-cheat purposes, and traffic is a custom UDP-based protocol, not HTTP."
Reasoning: non-HTTP + need original client IP → eliminate HTTP(S) LBs and proxy-based LBs (which don't preserve original IP by default) → **External passthrough Network Load Balancer**.

---

## 13. High-Yield Gotchas (expanded)

- Shared VPC vs VPC Peering: Shared VPC centralizes governance within one org; Peering connects independent VPCs (including cross-org), non-transitive, no overlapping CIDRs allowed.
- Regional Persistent Disk gives cross-zone HA, not a substitute for snapshots/backups.
- Cloud NAT is outbound only, never the fix for an inbound connectivity requirement.
- "Prevent data exfiltration by an authorized identity" → VPC Service Controls, not IAM or firewall rules.
- Basic roles (Owner/Editor/Viewer) are a red flag in any security-focused answer choice.
- IAM is additive-only; restricting behavior below what a broader grant allows is an Org Policy job, not an IAM job.
- BigQuery cost problems are fixed by partitioning/clustering/materialized views/editions pricing, never by "add more compute."
- Cloud Spanner is a cost/complexity trap when the scenario is actually single-region relational, Cloud SQL or AlloyDB is usually correct there.
- Preemptible/Spot VMs are never correct for stateful, latency-sensitive, or user-facing production traffic.
- Dedicated Interconnect requires colocation, if the scenario doesn't mention colocation facility access, Partner Interconnect is likely the intended answer instead.
- Workload Identity Federation is the answer whenever a scenario wants an external system (another cloud, on-prem, CI/CD) to authenticate to GCP without a downloaded key file.
- A "global" GCP resource (VPC, image, snapshot) versus a "regional" one (subnet, Cloud SQL instance, most managed services) is a recurring trick in answer choices, read resource scope carefully.
- Multi-region Cloud Storage buckets improve availability/durability across geography, they do not automatically make an application multi-region, compute and databases still need their own multi-region design.

---

## 14. Quick IaC Note

The official exam guide still frames native IaC around Deployment Manager and Config Connector, but Terraform via the Google provider is an accepted correct answer in current material. The principles you already apply with Terraform/Terragrunt (declarative state, drift detection, per-environment modularity) transfer directly, GKE's Config Connector is the closest GCP-native equivalent to "manage cloud resources as Kubernetes custom resources," worth knowing exists even if you'd reach for Terraform in practice.

---

## 15. Exam-Day Strategy

- Read the question stem fully before looking at answer choices, several questions bury the actual constraint in the second sentence.
- Eliminate any answer that violates an explicit business constraint (cost, timeline, "minimize changes") before comparing technical merit.
- When two answers both seem technically valid, the more "boring"/managed option is usually correct, GCP PCA rewards operational simplicity over cleverness.
- Flag and move on for anything requiring case-study recall you're unsure of, come back after finishing the rest.
- If a question doesn't name a case study, don't force one, some questions are fully standalone.

---

*If you want, I can turn the case studies and scenario walkthroughs into a spaced-repetition flashcard set, or build an interactive quiz artifact to drill the decision tables.*
