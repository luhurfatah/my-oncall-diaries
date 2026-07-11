# GCP Professional Cloud Architect — Exam Cheatsheet (v6.1 Edition)

Google overhauled the PCA exam on **October 30, 2025** (guide version 6.1). This is a full rewrite of the previous cheatsheet to match the current guide: new domain weights, a required Well-Architected Framework lens, heavy new AI/Gemini content, and — critically — **all four case studies changed except EHR Healthcare**. If you studied Mountkirk Games, TerramEarth, or Helicopter Racing League, that material is now off the current standard exam.

---

## 0. What Changed vs. the Old Exam (so you don't waste study time)

| Area | Old exam | v6.1 exam (current) |
|---|---|---|
| Case studies | Mountkirk Games, TerramEarth, EHR Healthcare, Helicopter Racing League | **Altostrat Media, Cymbal Retail, EHR Healthcare (retained), KnightMotives Automotive** |
| Domains | 5 domains | **6 domains**, reweighted (see below) |
| Well-Architected Framework | Implicit best practice | **Explicit, required** — its 6 pillars are named directly in the guide and woven through every section |
| AI/ML content | One data/analytics subsection | **Two entire new sections** (2.4, 2.5) on Gemini Enterprise Agent Platform, AI Hypercomputer, Model Garden, plus "Securing AI" under the security domain |
| Security | Standard IAM/VPC-SC/KMS | Adds **Model Armor, Sensitive Data Protection, securing the software supply chain** |
| IaC | Mentioned generically | **Terraform explicitly named** as required knowledge (alongside Deployment Manager) |
| Certification structure | One exam | **Two paths**: standard exam (first-time or lapsed certs) and a shorter **renewal exam** (existing cert holders) |
| Existing certifications | — | Stay valid until normal expiration; you don't need to retake anything early |

---

## 1. Exam Mechanics

**Standard exam** (first-time certification or renewing >60 days from expiry):
- 2 hours, ~50–60 multiple choice/multiple select questions
- Delivered via Kryterion/Webassessor, onsite or remote proctored
- No labs — pure scenario reasoning
- **2 case studies appear per exam sitting**, drawn from the pool of 4. Case-study questions make up **20–30%** of the exam. You can view case studies on a split screen during the test.
- Retake policy: 14 days after a first fail, 60 days after a second, 1 year after a third
- Recommended experience: 3+ years industry experience, 1+ year designing/managing GCP solutions specifically

**Renewal exam** (existing cert holders, within 60 days of expiration):
- ~1 hour, ~25 questions, $100 USD, notably cheaper/shorter than the standard exam
- **1 case study** drawn from a smaller pool of 2 (currently Altostrat Media and Cymbal Retail), both explicitly gen-AI-solution-oriented
- **90–100% of questions are case-study-based** — this exam is almost entirely scenario application, not standalone recall
- Sensible strategy if you're an active daily GCP user; if you haven't touched GCP much since your last cert, treat it like a fresh study effort since it leans on current services (Vertex AI/Agent Builder, Cloud Run functions) more than legacy fundamentals

**How to read a scenario question fast:** identify (1) the business requirement — usually cost/time/compliance driven, (2) the technical requirement — usually a constraint like "must support X QPS" or "must integrate with on-prem AD" — then eliminate any answer that violates a stated constraint before comparing survivors on cost/complexity. Most wrong answers are technically valid architectures that ignore a stated business constraint (e.g., proposing a rebuild when the case study explicitly wants to "minimize re-engineering cost").

---

## 2. Domain Weights (v6.1)

| Domain | Weight | What it actually tests |
|---|---|---|
| 1. Designing and planning a cloud solution architecture | **~25%** | Requirements mapping, WAF application, migration planning, business continuity, envisioning future improvements |
| 2. Managing and provisioning solution infrastructure | **~17.5%** | Network/storage/compute provisioning, container orchestration, **Gemini Enterprise Agent Platform for ML workflows**, prebuilt AI APIs |
| 3. Designing for security and compliance | **~17.5%** | IAM, org policy, data protection, **securing AI**, compliance regimes |
| 4. Analyzing and optimizing technical/business processes | **~15%** | SDLC, CI/CD, DR, stakeholder/change management, cost optimization |
| 5. Managing implementation | **~12.5%** | Advising dev/ops teams, API management (Apigee), **Gemini Cloud Assist**, programmatic GCP access (SDKs, Terraform) |
| 6. Ensuring solution and operations excellence | **~12.5%** | Well-Architected Framework operational excellence pillar, observability, reliability practices, chaos/load/penetration testing |

Note the biggest structural change: the old "ensuring reliability" domain (~25%) has been split and folded partly into domain 1 (business continuity), and a large chunk of what used to be reliability-only content is now framed through the Well-Architected Framework lens across every domain, rather than concentrated in one place.

---

## 3. The Well-Architected Framework — now mandatory knowledge

The guide states familiarity with the framework is "paramount" and its six pillars are "implicitly and explicitly woven throughout the exam objectives." Know these cold:

| Pillar | Core idea |
|---|---|
| Operational excellence | Efficient deployment, operation, and monitoring; has its own explicit exam subsection (6.1) |
| Security | Defense in depth, least privilege, securing AI workloads specifically |
| Reliability | HA, DR, failover design, capacity planning |
| Performance optimization | Right resource for the workload, latency/throughput tuning |
| Cost optimization | CapEx/OpEx tradeoffs, rightsizing, discount commitments |
| Sustainability | Newly emphasized pillar — carbon-aware region/workload choices, efficient resource use |

Expect the exam to frame tradeoff questions explicitly in these terms now — e.g., "which pillar does this decision prioritize, and what does it cost the others" is a legitimate v6.1 question shape, not just "which service is fastest."

---

## 4. The Four Case Studies (Current Set)

### Altostrat Media *(new)*
**Business:** Media company with a large library of podcasts, interviews, news broadcasts, and documentaries. Wants to modernize content management and user engagement with generative AI.
**Existing environment:** GKE for the content platform (scalability/HA), Cloud Storage for the media library (audio/video/docs), BigQuery as the analytics warehouse (user behavior, consumption patterns, audience demographics), Cloud Run functions for event-driven tasks (transcoding, metadata extraction, personalized recommendations). Some legacy on-prem ingestion/archival systems still in use during migration.
**Business goals:** personalized recommendations, natural-language interactions, self-service support, dynamic pricing, targeted marketing — plus positioning Altostrat as an AI-forward media brand while keeping AI outputs appropriate and explainable.
**Architecture implications:**
- Event-driven media pipeline: Cloud Storage upload triggers → Cloud Run functions → Video Intelligence API / Vision AI for metadata extraction and content moderation
- Vertex AI / Gemini models for recommendations and natural-language interfaces; avoid proposing a custom-trained CV/NLP stack when a managed API already fits — that's the classic wrong-answer trap here
- Hybrid connectivity (Partner/Dedicated Interconnect or HA VPN) while legacy on-prem ingestion is phased out
- BigQuery stays the analytics backbone; don't replace it wholesale, extend it

### Cymbal Retail *(new)*
**Business:** Fast-growing online retailer across several retail sub-verticals, struggling to manage an extensive, constantly-changing product catalog.
**Existing environment:** Mix of on-prem and cloud systems, an IVR system routing calls to a call center where agents manually enter orders customers couldn't complete online, and open-source monitoring (Grafana, Nagios, Elastic).
**Business goals — three pillars:**
1. **Catalog and content enrichment** — use gen AI to generate product attributes, descriptions, and images from raw supplier data, cutting manual effort/errors and keeping the catalog consistent across channels.
2. **Conversational commerce with product discovery** — AI virtual agents on web/mobile using Google's Discovery AI / Vertex AI Search & Conversation to handle natural-language shopping queries and reduce reliance on the manual call center.
3. **Technical stack modernization** — move to cloud infrastructure with secure data handling, third-party integration, and proactive monitoring/security to cut manual-process costs.
**Architecture implications:**
- Retail-specific managed services (Vertex AI Search for Retail / Recommendations AI) are usually the "least effort, most fit" answer over training a custom recommender on GKE
- Datastream + Dataflow to consolidate siloed on-prem/cloud data sources into BigQuery for a unified customer view, rather than manual nightly file dumps
- Apigee or similar API layer to expose catalog/order data to the new conversational agent without exposing entire backend systems
- Cost-consciousness is an explicit business requirement here — an answer that's technically impressive but always-on/over-provisioned is the wrong-answer pattern for this case

### EHR Healthcare *(retained from the previous exam cycle)*
**Business:** Healthcare SaaS platform for insurance/patient management, migrating from colocation to Google Cloud, must stay HIPAA compliant, needs hybrid connectivity for systems that can't move yet.
**Technical requirements:** 99.9%+ uptime for patient-facing apps, HIPAA compliance (BAA, encryption, audit logging), hybrid connectivity to remaining on-prem/colo systems, minimize migration disruption, faster deployment of containerized EHR software.
**Architecture implications:**
- Dedicated/Partner Interconnect for production traffic, Cloud VPN as backup or for lower-volume dev/test
- CMEK via Cloud KMS, VPC Service Controls around PHI, Data Access audit logs explicitly enabled, signed BAA, only HIPAA-eligible services in scope
- Phased/incremental migration, not a big-bang rebuild — this is still the case study where "hybrid, incremental" beats "full rebuild" answers
- Regional Cloud SQL or Spanner depending on scale, MIGs across zones minimum for the customer portal tier
- This is also the case study ExamTopics and others note can often be answered on pure GCP fundamentals (e.g., a Pub/Sub batching-vs-latency tradeoff question) without needing the business narrative at all — don't over-invest in memorizing narrative details at the expense of core service tradeoffs

### KnightMotives Automotive *(new, replaces TerramEarth/Mountkirk Games/HRL)*
**Business:** Automotive company providing connected-car services — telemetry from vehicles (location, sensor readings) for predictive maintenance and driver services, with selective data sharing to partners (insurers, dealerships).
**Existing environment:** Vehicles batch-upload telemetry to an on-premises data center, which limits scale and real-time analysis. Moving to Google Cloud to handle global scale/velocity.
**Constraints:** data locality/residency (keep regional data in-region), very high ingestion rates, cost control for storage/processing, secure partner data exposure via APIs.
**Architecture implications:**
- Ingestion: Pub/Sub for streaming telemetry at scale, buffering/retry patterns for vehicles with intermittent connectivity — same dual-path signature (streaming + batch) that TerramEarth used to test, now under a different case name
- Storage: Bigtable keyed by vehicle ID + timestamp for high-throughput time-series lookups, periodic export/stream into BigQuery for analytics — this exact pairing is a near-guaranteed correct-answer pattern whenever the case is invoked
- Data residency: regional processing/storage segregation rather than one global region, to respect data locality regulation — a single-region design is the classic wrong answer here
- Partner data sharing: Apigee as an API gateway layer for controlled, secured exposure to insurers/dealerships — SFTP file drops or broad database access are the wrong-answer traps
- ML: Vertex AI / Gemini Enterprise Agent Platform pipelines for predictive maintenance models trained on sensor history

**Cross-cutting pattern:** despite the new names, the underlying architecture shapes barely moved. High-volume IoT/telemetry → Pub/Sub → Bigtable/BigQuery is still the signature "real-time analytics at scale" answer (now under KnightMotives instead of TerramEarth), and gen-AI-forward customer experience → Vertex AI/Agent Builder + existing GKE/BigQuery stack is the signature "modernize with AI" answer (now under Altostrat Media and Cymbal Retail). If you understand the *service tradeoffs*, the company names are mostly flavor text.

---

## 5. New AI/Gemini Content (Sections 2.4, 2.5, and Security 3.1)

This is the single biggest content addition in v6.1. Know these at a conceptual level even if you've never touched them hands-on:

| Concept | What it is / when it's the answer |
|---|---|
| **Gemini Enterprise Agent Platform** | The umbrella platform for building/orchestrating agentic and ML workflows; "Agent Platform Pipelines" automate/orchestrate the ML lifecycle end to end |
| **AI Hypercomputer** | Google's integrated compute system (GPUs/TPUs + optimized software stack) for large-scale AI model training/serving; the answer when a scenario needs to train or serve large models at scale, not just call an API |
| **Model Garden** | Catalog of foundation models (Google's and third-party) you can deploy/fine-tune rather than building from scratch |
| **Agent Builder** | Tooling for building custom conversational/task agents on top of Gemini models — this is what Cymbal Retail's conversational commerce agent and Altostrat's natural-language interactions map to |
| **Gemini Cloud Assist** | AI-assisted help for architecture design, troubleshooting, and operations woven throughout domains 1, 2, and 5 — expect it as an answer option for "how do we get AI-assisted recommendations on our own GCP setup," distinct from Gemini models used *in* a customer-facing product |
| **Google AI APIs (prebuilt)** | Search, Conversation, Vision, Image, Video, Audio — the "don't build it yourself" answer whenever a scenario just needs standard content/media analysis (this is the direct successor to the old Video AI/Vision AI answer pattern) |
| **Model Armor** | Security layer for AI models — screening prompts/responses for policy violations, prompt injection, sensitive content; the answer for "how do we secure what goes in/out of our LLM" |
| **Sensitive Data Protection** (formerly Cloud DLP) | Detects/redacts/tokenizes sensitive data (PII, PHI, credit card numbers) — relevant to EHR Healthcare's HIPAA data and Cymbal Retail's customer PII specifically |
| **Secure model deployment** | Least-privilege service accounts, VPC-SC perimeters, and supply-chain integrity (Binary Authorization-style signing) applied specifically to model artifacts and endpoints, not just application containers |

**Exam-writer's own caution (worth internalizing):** more AI content in the guide does *not* mean "pick the AI-flavored answer whenever one is offered." Many questions still test a fundamental non-AI tradeoff (e.g., a Pub/Sub batching-latency question under the EHR Healthcare case) where the correct answer has nothing to do with AI at all. Don't pattern-match to AI options just because they're novel.

---

## 6. Compute, In Depth

### Machine family selection
| Family | Best for |
|---|---|
| E2 | Cost-optimized general purpose, dev/test, non-critical workloads |
| N2/N2D | Balanced general purpose production workloads, N2D is AMD-based, usually cheaper |
| C2/C2D | Compute-optimized, HPC, gaming servers, ad serving |
| M2/M3 | Memory-optimized, in-memory databases (SAP HANA), large caches |
| A2/A3 | GPU-accelerated (A100/H100), ML training — now explicitly tied to AI Hypercomputer scenarios |
| T2D/T2A | Scale-out ARM/x86 workloads, cost-sensitive horizontally-scaled apps |

Custom machine types let you pick exact vCPU/memory ratios when predefined types waste resources — comes up when a scenario mentions a memory-heavy but not compute-heavy app that doesn't fit standard ratios.

### Sole-tenant nodes
Dedicated physical server for your VMs only. Use case: licensing requiring dedicated hardware (BYOL), strict compliance requiring physical isolation. Niche but real exam distractor/answer.

### GKE deep dive
- **Autopilot vs Standard**: Autopilot is fully managed (Google manages nodes, security hardening, patching); Standard gives node-level control. Exam trend favors Autopilot as the "least operational overhead" answer unless the scenario needs privileged workloads, custom node config, or DaemonSets that Autopilot restricts.
- **Node pools**: group nodes by machine type/purpose (e.g., a GPU node pool for ML workloads), lets you target workloads to hardware via node selectors/taints
- **Workload Identity**: binds a Kubernetes service account to a Google service account without static key files
- **Binary Authorization**: enforce only signed/verified images deploy — now explicitly connected to "securing the software supply chain" in domain 3
- **Multi-cluster**: Anthos/GKE Enterprise for fleet management across clusters/clouds — "avoid vendor lock-in, run consistently across GCP and on-prem" scenarios

### Autoscaling matrix
| Layer | Mechanism | Scales based on |
|---|---|---|
| Compute Engine MIG | Managed Instance Group autoscaler | CPU utilization, LB serving capacity, custom Cloud Monitoring metric, schedule |
| GKE pods | Horizontal Pod Autoscaler (HPA) | CPU/memory/custom metrics per pod |
| GKE pod sizing | Vertical Pod Autoscaler (VPA) | Historical resource usage, recommends/adjusts requests |
| GKE nodes | Cluster Autoscaler | Pending unschedulable pods, scales existing node pools |
| GKE nodes, cross-pool | Node Auto-Provisioning (NAP) | Creates new node pools automatically to match workload shape |

Cluster Autoscaler only scales nodes within pools you defined; NAP creates entirely new node pools if none fit the pending pod's requirements.

### GKE fleet and service mesh, deep dive
- **Fleets**: a logical grouping of GKE (and non-GKE, via Attached Clusters) clusters registered under one umbrella for unified policy, monitoring, and feature management — the organizing concept behind Anthos/GKE Enterprise multi-cluster management, not a separate product of its own.
- **Config Sync**: GitOps-style continuous reconciliation of Kubernetes config from a Git repo across every cluster in a fleet — the answer for "keep N clusters consistently configured without manually applying manifests to each one."
- **Cloud Service Mesh** (managed Istio-based mesh): mutual TLS between services, traffic splitting/canarying, and observability across a fleet — comes up when a scenario wants zero-trust service-to-service communication or fine-grained traffic shifting inside GKE rather than at the external LB layer.
- **Multi-cluster Gateway/Ingress**: a single external LB config that routes across clusters/regions — the fleet-level equivalent of a global external Application LB, but load-balancing across GKE clusters instead of instance groups.

### Mapping compute to platform products (explicit exam subsection 1.3) — full comparison

The guide now explicitly calls out choosing between **Compute Engine, GKE, Cloud Run, Cloud Run functions, and App Engine** as its own tested skill, not an afterthought. This is one of the highest-yield "pick the right platform" tables to memorize:

| | Compute Engine | GKE Standard | GKE Autopilot | Cloud Run (services) | Cloud Run Jobs | Cloud Run functions | App Engine Standard | App Engine Flexible |
|---|---|---|---|---|---|---|---|---|
| Abstraction level | Lowest — full VM control | Node/cluster-level control | Pod-level only, nodes fully managed | Container, fully serverless | Container, run-to-completion | Function, fully serverless | Sandboxed runtime, fully serverless | VM-backed container, managed |
| Billing unit | Per VM/instance-hour | Per node-hour (+ control plane) | Per pod resource requested | Per request / CPU+memory during processing | Per job execution | Per invocation + resources | Per instance-hour | Per instance-hour |
| Scale-to-zero | No | No (nodes) | No (still pod-based minimums) | **Yes** | N/A (runs then stops) | **Yes** | Yes (Standard only) | No |
| Cold start | N/A (always running) | N/A | Minutes for new node capacity | Seconds | Seconds–minutes | Can be notable, esp. larger deps | Fast (sandboxed) | Slow (VM boot) |
| Stateful workloads | Yes, full control | Yes (StatefulSets, PVCs) | Yes, but with Autopilot's resource constraints | No — must be stateless | No — task-oriented, not long-running | No | No | Limited |
| Custom networking / DaemonSets / node-level access | N/A | Yes | **No** — restricted by design | No | No | No | No | Limited |
| Event/message consumption (Kafka-style continuous pull) | Yes, self-managed | Yes | Yes | No (push/HTTP-triggered only) | Via Pub/Sub push or Eventarc trigger | Yes (event-driven trigger) | Limited | Limited |
| GPU support | Full range (A2/A3, etc.) | Full range, custom node pools | L4 GPUs supported, broader accelerators restricted | Up to NVIDIA L4 | Up to NVIDIA L4 | No | No | No |
| Best fit | Legacy/non-containerized apps, licensing needs, sole-tenant/HPC | 10+ microservices, need Kubernetes primitives (CRDs, operators, service mesh, network policies) | Same as Standard but "least ops overhead" is an explicit requirement | Stateless HTTP APIs, bursty/variable traffic, fast iteration | Batch/cron-style containerized tasks that run to completion | Event-driven glue code: file-upload triggers, Pub/Sub handlers, webhook responders | Simple web apps wanting fastest possible scale-to-zero without containers | Custom runtime/language needs beyond Standard's sandboxed set, still App-Engine-managed |

**Decision heuristics for the exam:**
- "Stateless container, bursty/variable traffic, fastest path to production, minimal ops" → **Cloud Run**, and it's usually the *default* recommended starting point in current guidance — you can graduate to GKE later since the workload is already containerized.
- "Short-lived code responding to one event (upload, Pub/Sub message, webhook)" → **Cloud Run functions** — this is the mechanism behind Altostrat Media's upload-triggered transcoding/metadata pipeline.
- "Need Kubernetes-specific primitives" (DaemonSets, CRDs/operators, custom node config, service mesh, privileged workloads) → **GKE**, and specifically **Standard** if Autopilot's restrictions (no DaemonSets, limited node-level access) block the requirement.
- "Need Kubernetes but want the least operational overhead" and nothing above rules it out → **GKE Autopilot** is the exam's preferred "least ops" answer.
- "Continuous, always-on message consumption from a pull-based/Kafka-style system" → Cloud Run doesn't fit (push/HTTP-triggered only) — this needs **GKE** or **Compute Engine**.
- "Batch job that runs to completion, not an HTTP service" → **Cloud Run Jobs**, triggered by Cloud Scheduler, Pub/Sub via Eventarc, or Workflows.
- "Existing non-containerized application, specialized licensing, or hardware needs" → **Compute Engine**, the fallback when nothing above fits.
- App Engine is legacy-but-supported — expect it mainly as a **wrong-answer distractor** or in scenarios explicitly describing an existing App Engine app that must keep working (ties back to the Firestore Datastore-mode compatibility story above), not as the recommended new-build answer in v6.1.



## 7. Storage, In Depth

### Persistent Disk / Hyperdisk types
| Type | Use case |
|---|---|
| pd-standard | Cheapest, lowest IOPS, batch/sequential workloads |
| pd-balanced | Default general-purpose SSD |
| pd-ssd | High IOPS, databases |
| pd-extreme / Hyperdisk Extreme | Highest performance, SAP HANA, large DBs, IOPS provisioned independently of size |
| Hyperdisk Balanced/Throughput | Next-gen PD, decouple capacity/IOPS/throughput provisioning |

Regional PD replicates synchronously across two zones for HA at the disk layer, but it is not a backup — snapshots remain necessary for point-in-time recovery and cross-region durability.

### The full GCP database decision table (all managed DB tech, not just the classic 4)
| | Cloud SQL | AlloyDB | Spanner | Bigtable | Firestore (Native mode) | Firestore (Datastore mode) | Memorystore | BigQuery |
|---|---|---|---|---|---|---|---|---|
| Model | Relational (MySQL/Postgres/SQL Server) | PostgreSQL-compatible | Relational, horizontally scalable | Wide-column NoSQL | Document NoSQL | Document NoSQL (Datastore API) | In-memory key-value (Valkey/Redis/Memcached) | Columnar analytical warehouse |
| Scale | Vertical, read replicas | Vertical + read pool | Horizontal, petabyte scale | Horizontal, petabyte scale, very high throughput | Horizontal autoscale, millions of concurrent clients | Horizontal autoscale, millions of writes/sec | In-memory, up to 250 nodes (Valkey/Redis Cluster) | Serverless, storage/compute scale independently |
| Consistency | Strong (single region) | Strong | Strong, globally (multi-region config) | Eventually consistent by default, strong within a row | Strongly consistent, ACID transactions | Strongly consistent (removed legacy eventual-consistency/entity-group limits) | N/A (cache, not source of truth) | Strong per-table, eventual across some replicated read paths |
| Availability SLA | 99.95% regional / 99.99% HA | 99.99% regional HA | 99.999% multi-region | 99.9%–99.999% depending on replication | 99.999% multi-region / 99.99% regional | Same as Native mode | 99.9% standalone / 99.99% cluster | N/A (serverless) |
| When it's the answer | Standard transactional app, single-region OK, cost matters | Postgres workload needing analytics performance without a separate warehouse | Global strong consistency + relational semantics + massive scale | Extremely high write throughput, time-series/IoT — the KnightMotives telemetry pattern | Mobile/web apps needing real-time sync, offline support, flexible document schema | Existing App Engine/Datastore-API workload migrating in with zero code change | Sub-millisecond caching/session layer in front of a system of record — never the system of record itself | Analytics/BI over large historical datasets, not transactional workloads |

### Firestore — Native mode vs. Datastore mode, deep dive
Firestore is the current generation of what used to be Cloud Datastore; both modes run on the same underlying storage engine but expose different APIs and capabilities. **This choice is made once per database and is difficult to reverse** (you can only switch mode while the database is empty) — a classic exam "pick the constraint that can't be undone" detail.
- **Native mode**: the modern default, recommended for **all new applications** (server, mobile, web). Document/collection model, real-time listeners that push changes to connected clients, offline support with automatic sync in mobile/web SDKs. This is the answer whenever a scenario mentions live UI updates, offline-first mobile apps, or Firebase integration (Altostrat Media's or Cymbal Retail's customer-facing apps are the natural fit).
- **Datastore mode**: recommended **only** when an application already depends on the legacy Datastore API (entities/kinds/ancestors instead of documents/collections) — e.g., a lift-and-shift of an existing App Engine app. No real-time listeners, no offline support, but removes old Datastore limitations (all queries now strongly consistent, transactions no longer restricted to ancestor queries/25 entity groups).
- Both modes share pricing structure and available locations (regional or multi-region); multi-region gives a materially higher availability SLA (99.999% vs. 99.99%) and survives a full regional outage — the answer whenever a scenario demands surviving the loss of an entire region for this tier of database.
- **Don't confuse Firestore with Bigtable**: both are "NoSQL," but Firestore is for **application-facing, flexible-schema, document-shaped data at moderate-to-high scale with client SDK support**; Bigtable is for **massive, high-throughput, single-row-key time-series/analytical workloads** with no client-side sync/offline story. A mobile app's user profiles/game state → Firestore. Millions of IoT sensor readings/minute → Bigtable.

### Memorystore — deep dive (in-memory caching layer)
Memorystore is GCP's fully managed in-memory data store family — never a system of record, always a caching/session layer in front of one (Cloud SQL, Spanner, Firestore, etc.).
- **Memorystore for Valkey**: the current forward path. Valkey is the open-source, BSD-licensed fork of Redis (post Redis's 2024 license change), fully wire-compatible with Redis clients. Supports Cluster Mode Enabled/Disabled, zero-downtime scaling to 250 nodes/terabytes of keyspace, PSC connectivity, and even approximate/exact nearest-neighbor vector search for gen-AI use cases (relevant to Altostrat Media/Cymbal Retail's recommendation and conversational-agent features needing a low-latency vector cache).
- **Memorystore for Redis** / **Redis Cluster**: still supported but frozen at Redis 7.2 (Google is not tracking newer Redis releases due to the licensing change) — pick Valkey for new builds unless there's a specific reason to stay on Redis proper.
- **Memorystore for Memcached**: being phased out — **no longer a recommended service as of January 2026**, can't be created in new projects after February 2027. If a scenario describes a *new* simple key-value cache requirement, Memcached is now a wrong-answer trap; Valkey is the intended replacement even for pure cache-only workloads.
- Exam framing: "reduce read load on our primary database with sub-millisecond latency" → Memorystore (specify Valkey for anything new); "we need a durable system of record" → Memorystore is never correct, regardless of how the question is worded.

### Beyond the core managed lineup (know these exist, low-depth needed)
- **Bare Metal Solution**: dedicated bare-metal hardware in a GCP-adjacent facility for workloads like Oracle databases that can't run on standard virtualized Compute Engine — the answer whenever a scenario explicitly needs to lift-and-shift a licensed Oracle DB into a GCP-adjacent environment without re-platforming.
- **MongoDB Atlas on Google Cloud**: a third-party, Google-supported managed MongoDB offering (not a native GCP service) — comes up if a scenario has an existing MongoDB-based application and wants to stay on that data model while moving infrastructure to GCP, rather than migrating to Firestore.

### BigQuery internals worth knowing cold
- Storage and compute are billed/scaled separately — "just add more compute" is never the answer to a BigQuery cost problem
- **Partitioning**: by ingestion time, DATE/TIMESTAMP column, or INTEGER range
- **Clustering**: sorts data within partitions by up to 4 columns, stacks with partitioning
- **Materialized views**: precomputed, auto-refreshed, for repeated identical aggregation queries
- **BI Engine**: in-memory layer for fast dashboard queries, when the pain point is dashboard latency not query cost
- **Pricing models**: on-demand vs. capacity-based editions (Standard/Enterprise/Enterprise Plus) — capacity-based wins once query volume is high and predictable
- **Authorized views / row-level / column-level security**: "let this team see only their slice of the warehouse" — the Cymbal Retail unified-customer-view pattern and the old TerramEarth/KnightMotives dealer-isolation pattern both resolve here
- **Fine-Grained Access Control for BigQuery** (now GA): a more centrally-managed evolution of the same idea — policy tags and access bindings enforced down to the column level without hand-building a separate authorized view per team. Cite this by name if a scenario stresses "centrally governed, column-level least privilege" rather than "per-team custom views."

### Cloud Storage deep notes
- Object versioning vs. lifecycle rules are separate features
- Signed URLs: time-limited private-object access without a GCP account — the "let a supplier upload catalog images" pattern for Cymbal Retail
- Requester Pays: shifts egress/request cost to the accessor
- Turbo Replication (dual-region): near-real-time replication SLA when standard multi-region lag isn't good enough

---

## 8. Networking, In Depth

### VPC internals
- VPC networks/routes are global, subnets are regional, firewall rules are global but enforced at the hypervisor level (distributed stateful firewall)
- Firewall evaluation: implied allow egress + implied deny ingress by default; explicit rules evaluated by priority (lower number = higher priority)
- Alias IP ranges: multiple internal IPs per VM/pod from a defined range — what GKE uses for pod IP allocation in VPC-native clusters
- **Hierarchical firewall policies** (called out explicitly in v6.1): apply firewall policy at the org/folder level so it cascades to projects below, complementing per-VPC rules for multi-project segmentation. This is the answer whenever a scenario wants one security baseline enforced across many projects that individual project admins can't override.

### Shared VPC roles
- **Shared VPC Admin**: org/folder level, attach/detach service projects to a host project
- **Network Admin**: full control over host-project network resources, cannot assign VMs to the network
- **Network User**: granted on specific subnets, lets service-project owners deploy without touching network config

### Network Connectivity Center (NCC) — deep dive

NCC is the modern, exam-relevant answer to "we have too many point-to-point connections and it doesn't scale" — it is GCP's closest analogue to **AWS Transit Gateway**, and it shows up whenever a scenario describes a "tangled mesh" of VPC peerings, VPNs, and Interconnects that needs centralizing.

**Core model:** NCC is a global orchestration framework built around a **hub** (the central resource) and **spokes** (the network resources attached to it). A single hub can hold spokes across multiple regions.

**Why NCC over plain VPC Peering:**
- VPC Peering is **non-transitive** — if A peers with B and B peers with C, A cannot reach C. To fully mesh N networks with peering you need N(N-1)/2 connections (10 VPCs = 45 peerings), and peering has hard per-network quota limits.
- NCC solves this by exchanging routes through the hub, giving **transitive connectivity** with **linear scaling** — adding a 5th network is one new spoke, not four new connections.
- Trade-off to know: NCC doesn't ship an integrated firewall — security enforcement (via hierarchical firewall policies, Cloud NGFW, or third-party appliances) is still the user's responsibility, layered on top.

**Spoke types (know all of these — a "which spoke type fits this resource" question is a realistic exam pattern):**
| Spoke type | Connects |
|---|---|
| VPC spoke | Another VPC network (same org or different org) — exchanges subnet routes with the hub |
| Hybrid spoke — HA VPN | On-prem/branch site over VPN tunnels |
| Hybrid spoke — Interconnect VLAN attachment | On-prem/branch site over Dedicated/Partner Interconnect |
| Hybrid spoke — Router appliance VM | Third-party virtual appliance for site-to-site/site-to-cloud routing |
| Producer VPC spoke | Makes a VPC-Peering-based producer service (already peered to one spoke) reachable by all other spokes on the hub |
| NCC Gateway spoke | Regional spoke enabling third-party **Security Service Edge (SSE)** inspection of Cross-Cloud Network traffic |

**Topologies:** a hub is created with a topology that **cannot be changed later** — pick correctly up front.
- **Mesh (full intercommunication)**: every spoke can reach every other spoke — the default choice when workloads across all VPCs need any-to-any communication.
- **Star (center/edge groups)**: resources in the "center" group can talk to center and edge; resources in an "edge" group can talk only to center, not to other edge groups. This is the pattern for **hub-and-spoke with strict spoke isolation** — e.g., a shared-services hub reachable by many business-unit VPCs that must not talk to each other directly.

**Constraints worth remembering for exam traps:**
- A hub generally connects Google Cloud VPCs to each other, or to external networks — mixing both roles carelessly is a documented limitation, not a free-for-all.
- NCC cannot mix hybrid and VPC spokes in a way that lets you create custom routes pointing back at the hub as a next hop from within a spoke — sometimes requires supplementary designs (e.g., PSC + internal LB) to route traffic back to on-prem/peered networks.
- **PSC connection propagation through NCC**: when a hub has propagation enabled, Private Service Connect endpoints attached to one spoke automatically become reachable from other spokes on the same hub (unless explicitly excluded) — this is how you make a single "common services" PSC endpoint available org-wide without re-publishing it per VPC.
- Billing: the hub itself is free; you pay for **active spoke-hours** plus the underlying resources (VPN tunnels, Interconnect attachments) and applicable data transfer.

**When NCC is the answer vs. Shared VPC vs. Peering:**
- Small number of networks (2–3), simple relationship → VPC Peering still fine.
- Centralized governance where application teams self-serve within one org's network → Shared VPC.
- Many networks, multiple orgs, hybrid sites, or a requirement for transitive any-to-any or hub-and-spoke connectivity → **NCC**.

### Private Service Connect (PSC) — deep dive

PSC lets a **consumer** VPC privately reach a **producer's** service without VPC Peering, without a VPN, and without traversing the public internet — traffic stays inside Google's network end-to-end. This is the default answer for **any "expose our service to another team/org/customer privately" scenario** that doesn't want full network peering.

**Two consumption models:**
- **PSC endpoints**: a forwarding rule with an internal IP in the consumer VPC that points at a producer's service attachment — simplest model, one endpoint per service.
- **PSC backends**: used with Google Cloud proxy load balancers (Application or Network LB) for more granular consumer-side control — the answer when the consumer wants to layer their own LB, WAF (Cloud Armor), or routing logic in front of the private connection.

**Producer side:**
- Publishes an internal load balancer, then creates a **service attachment** pointing at that LB's forwarding rule.
- The service attachment defines a **consumer accept list** (specific projects, networks, or "accept all") and a dedicated **NAT subnet** (purpose `PRIVATE_SERVICE_CONNECT`) that the physical host machines use to NAT consumer traffic directly — this is why PSC bandwidth is limited only by host machine capacity, not by a NAT gateway bottleneck.
- Producers never need to manage firewall rules based on every consumer's VPC ranges — only the NAT subnet's range needs an allow rule on the producer side, regardless of how many consumers connect.

**Consumer side:** creates an endpoint or backend referencing the service attachment URI; sees only a private IP, with zero visibility into the producer's VPC topology — a clean trust boundary that's the correct answer whenever a scenario needs strict producer/consumer isolation across org boundaries (e.g., a SaaS vendor exposing an API to many customer VPCs, or a partner-data-sharing requirement like KnightMotives Automotive's dealer/insurer access).

**PSC for Google APIs:** an alternative to Private Google Access or public API endpoints — lets you reach Google APIs (and regional endpoints) via a private endpoint inside your VPC instead of through the internet-facing path.

**PSC interfaces (producer-initiated / "managed service egress"):** the reverse direction from a normal PSC endpoint — lets a **producer** VPC initiate connections *into* a consumer's network attachment, useful when a managed service needs to reach back into customer infrastructure (rare but a real distinguishing detail vs. the standard consumer-initiated endpoint model).

**Known gotchas (good exam distractors):**
- TCP idle timeout on PSC NAT is 20 minutes by default — a service with long-lived connections may need tuning.
- NAT subnet IP exhaustion is a common real-world failure mode — the fix is adding another `PRIVATE_SERVICE_CONNECT`-purpose subnet to the service attachment, not resizing the LB.
- PSC connections are **not transitive between VPC spokes** on their own — that transitivity only comes from **NCC's PSC propagation** feature layered on top.

### Cross-Cloud Network and NCC Gateway
Google's architecture pattern for a unified network spanning GCP, on-prem, and other clouds, built on NCC as the connectivity backbone. **NCC Gateway spokes** integrate third-party **Security Service Edge (SSE)** providers to inspect this cross-cloud traffic — relevant when a scenario wants centralized security inspection of hybrid/multi-cloud traffic rather than per-VPC firewall rules alone.

### VPC Peering vs Shared VPC vs PSC vs NCC (four-way disambiguation)
| | Shared VPC | VPC Peering | Private Service Connect | Network Connectivity Center |
|---|---|---|---|---|
| Relationship | One host, many service projects, same org | Two independent VPCs, any org | Consumer VPC to a published service | Many VPCs/hybrid sites to a central hub |
| Transitivity | N/A, one network | Non-transitive | Point-to-point (transitive only via NCC propagation) | Transitive across all attached spokes |
| Scaling | N/A | Quadratic (N(N-1)/2 for full mesh) | Linear per service published | Linear per spoke added |
| Best for | Centralized governance in one org | A handful of independent VPCs, cross-org | Exposing/consuming a single service privately, strict producer/consumer isolation | Many networks, hybrid sites, multi-cloud, needing hub-and-spoke or full-mesh at scale |

### Hybrid connectivity decision factors
| Requirement | Choice |
|---|---|
| Moderate bandwidth, encrypted over internet | Cloud VPN (HA VPN gives 99.99% SLA) |
| Sustained high bandwidth, lowest latency, willing to colocate | Dedicated Interconnect |
| High bandwidth, no colocation access | Partner Interconnect |
| Cross-cloud VPC connectivity | Cross-Cloud Interconnect |
| Encrypted traffic over Interconnect | HA VPN over Interconnect, or MACsec |
| Centralizing many hybrid sites/VPCs under one connectivity model | NCC hybrid spokes (VPN, Interconnect, or Router appliance) attached to a single hub |

### Cloud DNS routing policies
- **Geolocation routing**: route clients to the nearest regional endpoint — the HRL/media-style global-delivery pattern.
- **Weighted round robin**: gradual traffic shifting, canary-style rollouts between backend versions.
- **Failover routing**: automatic failover to a backup endpoint on health-check failure.
- **DNS peering**: share a private zone's records across VPCs without merging the zones themselves — distinct from NCC, which shares network reachability, not name resolution.

### Load balancer selection
| Type | Layer | Global/Regional | Traffic | Typical use |
|---|---|---|---|---|
| Global external Application LB | L7 | Global | HTTP(S) | Public web apps, anycast IP, CDN/Armor |
| Regional external Application LB | L7 | Regional | HTTP(S) | Data residency for the LB itself |
| Global external Proxy Network LB | L4 | Global | TCP/SSL non-HTTP | Global reach, non-HTTP protocols |
| External passthrough Network LB | L4 | Regional | TCP/UDP | Preserve client source IP |
| Internal Application LB | L7 | Regional | HTTP(S) | Internal microservices, mesh ingress |
| Internal passthrough Network LB | L4 | Regional | TCP/UDP | Internal non-HTTP services |
| Cross-region internal Application LB | L7 | Multi-region | HTTP(S) | Internal service reachable from multiple regions — can be a PSC service-attachment target directly |

### Cloud Armor / Cloud NAT
- Edge security policies: geo-blocking, bad IPs at scale, applied before backend
- Backend security policies: WAF rules, rate limiting, bot management
- Cloud NAT: regional, requires a Cloud Router, outbound only — never the answer for inbound internet connectivity
- Cloud NAT vs. PSC NAT subnets: don't conflate the two — Cloud NAT gives VMs *outbound internet* access without external IPs; a PSC NAT subnet is a completely separate mechanism used only to translate *consumer-to-producer* PSC traffic and has no relation to internet egress

---

## 9. IAM & Security, In Depth

### Resource hierarchy
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
IAM bindings at Organization apply everywhere below. A binding at Folder: Production applies only to prod-web/prod-data.

### Org Policy constraints worth memorizing
| Constraint | Purpose |
|---|---|
| `constraints/iam.disableServiceAccountKeyCreation` | Block SA key file creation org-wide |
| `constraints/compute.vmExternalIpAccess` | Restrict which VMs can have external IPs |
| `constraints/compute.restrictLoadBalancerCreationForTypes` | Limit LB types allowed |
| `constraints/gcp.resourceLocations` | Restrict resource locations — the KnightMotives data-residency answer |
| `constraints/compute.requireOsLogin` | Enforce OS Login over metadata SSH keys |
| `constraints/sql.restrictPublicIp` | Block Cloud SQL public IPs |

If a scenario says "even project owners should not be able to do X," that's always Org Policy, never IAM.

### Service account best practices, ranked
1. Workload Identity Federation (GKE or external IdPs) — no keys at all
2. Impersonation (short-lived tokens) — no long-lived keys
3. Attached service accounts on Compute Engine — no keys
4. Downloaded JSON key files — last resort, almost always the wrong exam answer when a better option is listed

### IAM Deny policies, PAM, and Principal Access Boundary — deep dive

Standard IAM is **additive-only by design**: if any binding anywhere in the hierarchy grants a permission, the principal has it, and there's no native "except for this person" clause on an allow policy. Three newer mechanisms close that gap without resorting to Org Policy (which is coarse — it turns a whole capability off/on for a resource, not for specific principals):

- **IAM Deny policies**: explicitly forbid named principals (or even `allUsers`) from using specific permissions, regardless of what any allow policy grants. Deny policies are attached at org/folder/project level, are inherited down the hierarchy exactly like allow policies, and **always win** over an allow grant when both apply. You can carve out exceptions for specific principals within an otherwise-broad deny rule (e.g., deny "modify org policy" org-wide, except for the two named platform-admin accounts). This is the answer for "deny this one dangerous permission to almost everyone, with a couple of narrow named exceptions" — a shape Org Policy can't express since Org Policy has no concept of "except this specific user."
- **Privileged Access Manager (PAM)**: just-in-time, time-bound privilege elevation. You define an **entitlement** (who's eligible, what access, max duration, optional approval workflow), and a principal requests a **grant** that's automatically revoked after the window expires. This is the modern answer to "how do we avoid standing access to production for on-call engineers" — replacing the old pattern of a permanently-provisioned break-glass service account. PAM grants can also be scoped as exceptions to Deny policies and VPC-SC perimeters for the duration of the grant only.
- **Principal Access Boundary (PAB)**: a hard ceiling on *which resources* a principal can ever access, independent of what roles they're granted — e.g., preventing a principal from ever touching resources outside your organization at all, which blocks a whole class of phishing/exfiltration attacks even if a role binding mistake would otherwise allow it.

**How the three security layers now stack (updated exfiltration/least-privilege model):**
| Mechanism | Answers |
|---|---|
| IAM allow policy | "What can this identity normally do" |
| IAM Deny policy | "What must this identity never do, no matter what it's granted" |
| Org Policy | "What must never be possible on this resource, for anyone, including Owners" |
| Principal Access Boundary | "What resources can this identity ever reach, period" |
| Privileged Access Manager | "How do we grant #1 only temporarily, with audit trail, instead of permanently" |
| VPC Service Controls | "Where can authorized data movement land" |

**Agent-specific governance (new, tracks the AI content expansion):** IAM Allow/Deny policies and Principal Access Boundary now extend explicitly to **Agent Identity** — a distinct principal type for autonomous AI agents, separate from human users and service accounts. This matters for any scenario involving Gemini Enterprise Agent Platform agents that need scoped, auditable, revocable access to tools/APIs/data rather than inheriting a broad service account's full permission set.

**Custom Organization Policy** now covers 130+ Google Cloud services, letting you write org policy constraints beyond the built-in list for products that didn't previously have one — worth knowing exists as the escape hatch when a scenario needs an org-wide restriction on a service with no predefined constraint.

### VPC Service Controls vs Firewall vs IAM (the exfiltration triangle)
- **IAM** stops unauthorized *identities*
- **Firewall rules** stop unauthorized *network paths*
- **VPC Service Controls** stops *authorized* identities/services from moving data to an *unauthorized perimeter* — the answer for insider-threat/credential-compromise exfiltration scenarios, including new AI-specific variants (e.g., an agent or pipeline copying training data out of a HIPAA perimeter)

### Securing AI (new, v6.1 section 3.1)
- **Model Armor**: guardrails on prompts/responses (jailbreak/injection detection, content policy enforcement)
- **Sensitive Data Protection**: detect/redact/tokenize PII/PHI/PCI before it reaches a model or gets logged
- **Secure model deployment**: least-privilege service accounts for model endpoints, VPC-SC around model/data resources, signed model artifacts

### Compliance quick reference
| Regime | Key GCP mechanisms |
|---|---|
| HIPAA | BAA with Google, HIPAA-eligible services list, CMEK, audit logging, VPC-SC — EHR Healthcare's whole case |
| PCI DSS | Segmented VPC/project for cardholder data, restricted perimeter, logging — relevant to Cymbal Retail's payment data |
| GDPR | Data residency (`resourceLocations`), right to erasure, DPA with Google |
| SOC 2 | Now explicitly named in the guide as an "industry certification" consideration under compliance |
| FedRAMP | Assured Workloads, restricted regions, personnel controls |

---

## 10. Data & Analytics, In Depth

### Pub/Sub specifics
- At-least-once by default; exactly-once adds latency/throughput cost, only enable when duplicates are genuinely unacceptable
- Push vs pull: push for low-latency HTTP endpoint delivery (Cloud Run/functions), pull when the consumer controls its own read rate (Dataflow)
- Dead-letter topics for repeatedly-failing messages
- Ordering keys: order within a key, parallel across keys
- **Batching vs. latency tradeoff**: publisher client batching improves throughput but adds latency waiting for a batch to fill/timeout — reducing/disabling batch settings is the answer whenever a scenario explicitly wants *lower publishing latency* (this exact tradeoff appears as a documented sample question under the current EHR Healthcare case)

### Dataflow / Dataproc / Dataproc Serverless / Data Fusion
| | Dataproc (clusters) | Dataproc Serverless | Dataflow | Data Fusion |
|---|---|---|---|---|
| Underlying tech | Managed Hadoop/Spark/Hive/Pig | Managed Spark, no cluster to size | Managed Apache Beam | Visual, code-optional pipeline builder (CDAP-based) |
| Cluster management | You size/manage (or use autoscaling policies) | None — submit a job, Google provisions/tears down automatically | Fully serverless | Fully managed, visual canvas |
| Billing | Per VM instance-hour, **charged even while idle** | Pay only for compute used during job execution (Dataflow-like) | Pay for vCPU-hours/GB-hours actually used, autoscaled | Per-instance + pipeline execution |
| Best fit | Lift-and-shift existing Spark/Hadoop/Hive jobs with heavy custom tuning | Same Spark ecosystem, but "don't want to manage clusters" | New pipelines, unified batch+streaming, event-time windowing/stateful processing | Non-engineers building ETL visually, need built-in lineage/governance UI |
| Exam signal | "We already have Spark jobs, minimal rewrite, need fine cluster control" | "Spark workload, but avoid idle cluster cost and cluster-lifecycle ops" | "Building something new," "need both batch and streaming in one model," complex transforms | "Visual pipeline builder," "minimal coding," "need native lineage" |

**Dataproc cost gotcha**: a standard Dataproc cluster **bills per VM-hour even when idle** between jobs — if a scenario stresses unpredictable/intermittent Spark workloads and cost sensitivity, **Dataproc Serverless** (not classic Dataproc) is usually the better-fitting answer, since it only bills for the execution window itself, much like Dataflow.

**Dataflow specifics worth knowing cold:**
- Apache Beam under the hood — pipelines are portable across runners in theory, sometimes framed as the "avoid lock-in" answer for data pipelines.
- GPU support exists for ML-inference-in-pipeline use cases (e.g., running model inference as a pipeline stage) — relevant if a scenario wants real-time enrichment of a streaming pipeline with a model call rather than a separate downstream step.
- Templates (classic and Flex) let non-engineers launch pre-built parameterized pipelines without writing code — the answer for "let analysts run ETL jobs without writing code," distinct from Data Fusion's fully visual canvas.
- Dataflow commits pipeline results exactly once even though user code can be retried — side effects in custom transforms calling external services must be made idempotent, a subtle correctness gotcha in "why did my external API get called twice" scenarios.

### Datastream + Dataflow (Cymbal Retail's signature pattern)
Continuous CDC (change data capture) replication from siloed on-prem/legacy databases into BigQuery or Cloud Storage to build a unified analytics view — the correct answer over manual nightly file dumps or federated queries when the requirement is an **ongoing, low-latency consolidated warehouse**, not a one-time migration. Datastream is the ingestion/CDC layer; Dataflow (or a native BigQuery load) is often paired with it for transformation before landing in BigQuery.

### Composer (managed Airflow) — deep dive
- Composer runs on GKE under the hood, with prebuilt operators for BigQuery, Dataflow, Dataproc, Cloud Storage, and more — it **orchestrates** the sequence and dependencies between jobs across all these services; it does not do the actual data processing itself.
- The correct answer whenever a scenario needs **DAG-based dependency management across multiple heterogeneous tools** — e.g., "run a Dataproc job, then load results to BigQuery, then trigger a Dataflow pipeline, with retries and SLA alerting on the whole chain."
- **Cloud Workflows + Cloud Scheduler** is the lighter-weight alternative when a scenario doesn't need full Airflow DAG complexity — a good "is Composer over-engineered here" distractor check: if the pipeline is a simple linear sequence with no complex dependency graph, Workflows is often the leaner, cheaper answer over standing up a full Composer environment.
- Composer is explicitly **less serverless than Dataflow** — you're still responsible for sizing/understanding the underlying Airflow environment (workers, schedulers), which is worth remembering if a scenario stresses "minimal operational overhead" as the deciding constraint.

---

## 11. Reliability, DR, and Operational Excellence

### DR pattern selection
| Pattern | RTO | RPO | GCP implementation |
|---|---|---|---|
| Backup and restore | Hours to days | Hours | Scheduled snapshots/backups to Cloud Storage |
| Pilot light | Tens of minutes to hours | Minutes | Minimal always-on core, scale up on failover |
| Warm standby | Minutes | Seconds to minutes | Scaled-down full stack in a second region |
| Multi-site active-active | Near zero | Near zero | Global LB + multi-region Spanner/multi-region GKE |

### SRE math
- Error budget = 1 - SLO. A 99.9% SLO ≈ 43 minutes allowed downtime/month.
- Burn rate exceeding budget pace → freeze feature releases, prioritize reliability work
- SLA is a looser version of SLO with contractual consequences, never tighter than the internal SLO

### Monitoring and observability stack
- **Cloud Monitoring**: metrics, dashboards, alerting, uptime checks
- **Cloud Logging**: centralized logs, log-based metrics, log sinks
- **Cloud Trace**: distributed tracing
- **Cloud Profiler**: continuous production CPU/memory profiling
- **Error Reporting**: aggregates/groups application errors automatically

### Domain 6 specifics (operational excellence, now its own explicit pillar-mapped section)
- Deployment/release management
- Supporting deployed solutions in production
- Quality control evaluation
- **Reliability validation**: chaos engineering, penetration testing, load testing are now named explicitly as tested topics, not just implied SRE practice

### Incident management
Blameless postmortems, clear incident commander roles, toil reduction as an engineering priority — "how should the team respond after an outage" questions want blameless postmortem plus concrete follow-up, not disciplinary action.

---

## 12. Cost Optimization

| Lever | Mechanism | When it's the right answer |
|---|---|---|
| Committed Use Discounts | 1/3-year commit on vCPU/memory or spend | Stable, predictable baseline load |
| Sustained Use Discounts | Automatic, no commitment | Already happens on Compute Engine |
| Spot VMs | Up to ~60–91% off, preemptible | Fault-tolerant batch, stateless workers, CI runners |
| Rightsizing recommendations | Recommender API | Ongoing hygiene, "we're overprovisioned" |
| BigQuery slot reservations/editions | Flat-rate capacity | High, predictable query volume |
| Storage Autoclass/lifecycle | Automatic/rule-based tiering | Unpredictable or well-known access decay |
| Egress minimization | Region/zone locality, CDN, Private Google Access | Any heavy inter-service/internet-facing traffic |

**Billing tools**: Budgets and alerts (proactive), Billing export to BigQuery (detailed analysis), Cost Table/Reports (quick breakdown). "How do we get notified before we blow the budget" → Budgets and Alerts.

---

## 13. Migration Strategy

### The 4 Rs
| Strategy | Description | Signal in a question |
|---|---|---|
| Rehost (lift and shift) | Move VMs as-is | "minimize changes," "fastest path" |
| Replatform | Swap a component for a managed equivalent during the move | "modernize the database but keep the app mostly as-is" |
| Refactor/rearchitect | Redesign cloud-native | "long-term scalability," greenfield, no urgency constraint |
| Repurchase | Replace with SaaS | Rare on this exam |

### Migration tooling (note: **Migration Center** now explicitly named in the guide as the assessment tool)
- **Migration Center**: assessment/discovery for planning a migration at the portfolio level — the new explicit answer for "how do we assess what to migrate and estimate cost/effort"
- **Migrate to Virtual Machines**: VM lift-and-shift into Compute Engine
- **Database Migration Service (DMS)**: homogeneous migrations, minimal downtime via CDC
- **Datastream**: CDC streaming into BigQuery/Cloud Storage/Bigtable when the target is analytics
- **Storage Transfer Service**: bulk/scheduled data movement between on-prem/other clouds and Cloud Storage
- **Transfer Appliance**: physical device for large one-time transfers when bandwidth makes online transfer impractical

---

## 14. AWS-to-GCP Concept Mapping (updated with AI services)

| AWS | GCP | Notes |
|---|---|---|
| IAM Role + OIDC (IRSA) / EKS Pod Identity | Workload Identity Federation / Workload Identity (GKE) | Same goal: short-lived, scoped credentials |
| VPC | VPC | GCP VPCs global, subnets regional; AWS VPCs regional, subnets zonal |
| Security Groups | Firewall Rules (+ Hierarchical Firewall Policies) | Distributed/stateful at hypervisor level; hierarchical policies are the new org/folder-level equivalent of layered SCP-style network controls |
| Transit Gateway | Network Connectivity Center (NCC) | — |
| Direct Connect | Dedicated/Partner Interconnect | Colocation vs. partner-provided tiers |
| ALB/NLB | External Application LB / External passthrough Network LB | Split by L7 vs L4 similarly |
| S3 storage classes | Cloud Storage classes | Standard/Nearline/Coldline/Archive |
| RDS | Cloud SQL | Similar managed relational model |
| Aurora | AlloyDB | Both pitched as faster, more scalable open-source-engine variants |
| DynamoDB | Firestore (docs) / Bigtable (wide-column) | DynamoDB spans both use cases GCP splits into two services |
| ElastiCache (Redis/Memcached) | Memorystore (Valkey/Redis/Memcached) | Prefer Valkey for new builds; Memorystore Memcached is being phased out |
| DocumentDB | Firestore (Native mode) | Both document-model, though APIs/SDKs differ |
| Redshift | BigQuery | BigQuery more serverless by default |
| Kinesis | Pub/Sub + Dataflow | Data Streams ~ Pub/Sub, Data Analytics ~ Dataflow |
| KMS | Cloud KMS | Conceptually near-identical |
| Secrets Manager | Secret Manager | Conceptually near-identical |
| Organizations + SCPs | Resource Manager (Org/Folder/Project) + Org Policy | — |
| CloudTrail | Cloud Audit Logs (Admin Activity + Data Access) | — |
| CloudWatch | Cloud Monitoring + Cloud Logging | Split into two products |
| Bedrock (model access) | Model Garden + Vertex AI | Foundation model catalog + deploy/fine-tune tooling |
| Bedrock Agents | Gemini Enterprise Agent Platform / Agent Builder | Agent orchestration layer |
| SageMaker training infra | AI Hypercomputer | Integrated GPU/TPU training/serving stack |
| Macie | Sensitive Data Protection | PII/PHI/PCI detection and redaction |
| Bedrock Guardrails | Model Armor | Prompt/response safety screening |
| Terraform (already your daily tool) | Same, plus Deployment Manager/Config Connector | Exam accepts Terraform as a valid IaC answer, now explicitly named |

---

## 15. Scenario Walkthroughs (updated to current case studies)

**Scenario A (Altostrat Media):** "A media company wants to automatically extract metadata and flag inappropriate content the moment a file is uploaded, with minimal custom engineering."
Reasoning: event-driven trigger + standard media-analysis task → **Cloud Storage upload event → Cloud Run function → Video Intelligence API / Vision AI**, not a custom-trained model on GKE. Building your own CV pipeline is the classic over-engineering trap here.

**Scenario B (Cymbal Retail):** "An online retailer wants personalized product recommendations added to its site with minimal development effort."
Reasoning: "minimal development effort" + personalization → **Vertex AI Search & Conversation / Recommendations AI (managed retail API)**, not a custom GKE-hosted model or a nightly BigQuery ML batch job that isn't truly real-time.

**Scenario C (KnightMotives Automotive):** "An automotive company must ingest millions of telemetry points per minute, support real-time lookups by vehicle, and also run historical analysis, while respecting regional data-residency law."
Reasoning: high-throughput time-series + dual access pattern → **Bigtable (keyed by vehicle ID + timestamp) for real-time lookups, streamed/exported into BigQuery for analytics**; enforce data residency via `constraints/gcp.resourceLocations` and regional resource placement, not a single global-region design.

**Scenario D (EHR Healthcare):** "A healthcare company must ensure that even if a data analyst's credentials are compromised, exported patient data cannot be copied to a project outside the security team's control."
Reasoning: authorized identity, unauthorized destination → not an IAM problem → **VPC Service Controls** perimeter around the BigQuery/GCS resources holding PHI.

**Scenario E (cross-cutting, any case):** "A company wants to prevent any employee, including project owners, from ever creating a Cloud SQL instance with a public IP, org-wide."
Reasoning: "including project owners" is the tell → **Org Policy constraint `constraints/sql.restrictPublicIp`** at the organization node, since IAM Owner would otherwise override an IAM-only restriction.

**Scenario F (new AI-security pattern):** "A retailer's new conversational shopping agent must be prevented from leaking system prompts or being manipulated into recommending competitor products via crafted user input."
Reasoning: this is a prompt-injection/model-safety concern, not a data-access concern → **Model Armor** screening on the agent's inputs/outputs, potentially paired with **Sensitive Data Protection** if customer PII could also leak through responses.

---

## 16. High-Yield Gotchas (updated)

- The case studies changed — don't waste exam-day recall effort on Mountkirk Games/TerramEarth/HRL details; know Altostrat Media, Cymbal Retail, EHR Healthcare, KnightMotives Automotive instead.
- More AI content in the guide ≠ AI is more often the correct answer. Plenty of questions (confirmed by Google's own sample material) are pure fundamentals — e.g., a Pub/Sub batching/latency tradeoff — dressed up in an AI-company case study.
- Shared VPC vs VPC Peering: Shared VPC centralizes governance within one org; Peering connects independent VPCs, non-transitive, no overlapping CIDRs.
- Regional Persistent Disk gives cross-zone HA, not a substitute for snapshots/backups.
- Cloud NAT is outbound only, never the fix for inbound connectivity.
- "Prevent data exfiltration by an authorized identity" → VPC Service Controls, not IAM or firewall rules.
- Basic roles (Owner/Editor/Viewer) are a red flag in any security-focused answer choice.
- IAM is additive-only; restricting behavior below what a broader grant allows is an Org Policy job.
- BigQuery cost problems are fixed by partitioning/clustering/materialized views/editions pricing, never "add more compute."
- Cloud Spanner is a cost/complexity trap when the scenario is actually single-region relational — Cloud SQL or AlloyDB is usually correct there.
- Preemptible/Spot VMs are never correct for stateful, latency-sensitive, or user-facing production traffic.
- Dedicated Interconnect requires colocation; if the scenario doesn't mention colocation access, Partner Interconnect is likely intended.
- Workload Identity Federation is the answer whenever an external system (another cloud, on-prem, CI/CD) needs to authenticate to GCP without a downloaded key file.
- A "global" resource (VPC, image, snapshot) vs. "regional" (subnet, Cloud SQL instance, most managed services) is a recurring trick — read resource scope carefully.
- Multi-region Cloud Storage buckets improve availability/durability across geography; they do not automatically make an application multi-region.
- Model Armor / Sensitive Data Protection are new distractors/answers specifically for AI-pipeline security questions — don't confuse them with VPC-SC (network/data perimeter) or IAM (identity access); they operate at the model input/output layer.
- Terraform is now explicitly named as an accepted correct IaC answer — you no longer need to default to Deployment Manager reasoning.
- VPC Peering's non-transitivity is the single most common networking trap: don't assume A can reach C just because A-B and B-C are peered. If a scenario needs transitive reachability across many networks, it wants NCC, not "just add more peerings."
- Don't confuse **PSC** (privately consuming/exposing one specific service, point-to-point) with **NCC** (broad network-to-network reachability across many spokes). A scenario about "let a partner call our one API privately" wants PSC; a scenario about "unify connectivity across dozens of VPCs and on-prem sites" wants NCC.
- **IAM Deny policy vs. Org Policy**, disambiguated further: Deny policy targets specific *principals and permissions* with exceptions per-principal; Org Policy targets a *resource capability* for everyone including Owners, with no per-principal exception mechanism. "Deny this to everyone except these two admins" → Deny policy. "Make this impossible for anyone, ever, on this resource" → Org Policy.
- Privileged Access Manager is the modern answer to "avoid standing/permanent elevated access" — a permanently-provisioned break-glass service account is now the wrong-answer pattern where PAM's time-bound grants fit.
- Firestore mode selection (Native vs. Datastore) is a one-way door once the database has data — an exam scenario emphasizing this irreversibility wants you to pick correctly the first time, not "switch later if needed."
- Memorystore is a caching layer, full stop — if any answer choice proposes Memorystore as the sole/durable data store with no separate system of record behind it, that answer is wrong regardless of how the rest of it reads.
- Memorystore for Memcached is now a legacy/deprecated-path answer for anything new — Memorystore for Valkey is the current default recommendation even for simple caching.
- Don't default to Bigtable just because a scenario says "NoSQL" — if the workload is application-facing with a need for real-time sync/offline support (mobile, web), Firestore is the fit; Bigtable is for extreme-throughput, single-row-key, time-series/analytical NoSQL, not general app data.
- Cloud Run is now the default "start here" recommendation for new stateless containerized workloads in current guidance — don't over-reach for GKE just because a workload is containerized; GKE earns its complexity only when a specific Kubernetes primitive (DaemonSets, CRDs/operators, service mesh, custom node config) is actually required.
- GKE Autopilot explicitly cannot run DaemonSets or give node-level access — if a scenario requires either, Autopilot is a trap answer and Standard is correct even though Autopilot is usually the "least ops overhead" default.
- Classic Dataproc clusters bill per VM-hour even while idle between jobs — a cost-sensitive, intermittent-Spark-workload scenario wants Dataproc Serverless (or Dataflow if a rewrite is acceptable), not classic Dataproc.
- Don't reach for Cloud Composer for a simple linear job sequence — that's over-engineering; Cloud Workflows + Cloud Scheduler is the leaner answer when the pipeline doesn't need full Airflow DAG complexity.

---

## 17. Exam-Day Strategy

- Read the question stem fully before looking at answer choices — several questions bury the actual constraint in the second sentence.
- Eliminate any answer that violates an explicit business constraint (cost, timeline, "minimize changes," data residency) before comparing technical merit.
- When two answers both seem technically valid, the more "boring"/managed option is usually correct — GCP PCA rewards operational simplicity over cleverness, and this now explicitly extends to AI: a managed API beats a custom-trained model whenever both would work.
- Only 2 of the 4 case studies appear in your sitting — don't panic if one of the four feels unfamiliar going in, but ideally know all four since you won't know in advance which pair you'll get.
- If a question doesn't name a case study, don't force one — some questions are fully standalone fundamentals.
- Budget ~1.5 minutes per standalone question; save extra time for case-study questions since you'll be cross-referencing the split-screen scenario text.