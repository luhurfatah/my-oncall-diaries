# Cloud Architecture Best Practices Cheatsheet

> ## 📌 Quick Summary — Top Best Practices to Remember
>
> 1. **Design for failure** — assume every component can fail; multi-AZ, health checks, circuit breakers, retries with backoff+jitter
> 2. **Start with a modular monolith** — don't jump to microservices; extract services only when you feel the pain of coupling
> 3. **Stateless services** — externalize state to Redis/DynamoDB; enables horizontal scaling and instance replacement
> 4. **Async over sync** — use queues (SQS) and events (SNS/Kafka) for non-user-facing work; decouples producer from consumer
> 5. **Right database for the job** — polyglot persistence is fine; RDBMS for transactions, DynamoDB for scale, Redis for caching
> 6. **Cache strategically** — cache-aside with TTL for most cases; event-driven invalidation for consistency-sensitive data
> 7. **Idempotency on all mutations** — retries must not cause duplicates; use idempotency keys especially for payments/orders
> 8. **SLI/SLO-driven alerting** — alert on symptoms (error rate), not causes (CPU); use error budgets to balance velocity vs reliability
> 9. **Feature flags** — decouple deploy from release; use kill switches; remove flags after full rollout
> 10. **Document decisions with ADRs** — record context, decision, consequences, and alternatives; store alongside code in Git

---

## 1. Core Architectural Principles

- **Design for failure** — assume every component will fail; build resilience in
- **Loose coupling** — minimize dependencies between components; change one without breaking others
- **High cohesion** — keep related logic together; single responsibility per service
- **Stateless where possible** — externalize state to databases/caches; enables horizontal scaling
- **Defense in depth** — multiple layers of security; no single control is sufficient
- **Shift left** — security, testing, cost awareness built in from design, not bolted on
- **Automate everything** — manual processes are toil and risk; if you do it twice, automate it
- **Observability by default** — logs, metrics, traces designed in, not added later
- **Immutable infrastructure** — replace, don't patch; rebuild from code
- **Evolutionary architecture** — design to change; avoid irreversible decisions early

---

## 2. Architecture Patterns

### Monolith vs Microservices vs Modular Monolith

```
Monolith
└── All features in one deployable unit
    ✓ Simple to develop early, easy to debug
    ✗ Hard to scale independently, risky large deploys

Modular Monolith (Start Here)
└── Clear internal module boundaries, single deployment
    ✓ Best of both worlds for early-stage products
    ✓ Easy to extract to microservices later

Microservices
└── Independent services, each owning its data
    ✓ Independent scaling, deploy, and tech choices
    ✗ Distributed system complexity (latency, consistency, observability)
```

**Rule:** Don't start with microservices. Start with a well-structured monolith or modular monolith. Extract services when you feel the pain of coupling — not before.

### Event-Driven Architecture

```
Producer → Event Broker → Consumer
             (Kafka / SNS+SQS / EventBridge)

Benefits:
  - Loose coupling between producer and consumer
  - Async processing; producer doesn't wait
  - Fan-out: one event → many consumers
  - Replay: reprocess historical events

Patterns:
  - Event Notification    → "something happened" (thin payload)
  - Event-Carried State   → full state in event (consumer self-sufficient)
  - Event Sourcing        → state is the sequence of events (audit log)
  - CQRS                  → separate read and write models
```

### CQRS + Event Sourcing

```
Write Side:  Command → Aggregate → Event Store → Event Stream
Read Side:   Event Stream → Projections → Read Models (optimized for queries)

Use when:
  - Read/write patterns diverge significantly
  - Complete audit trail is required
  - Complex business logic with many state transitions

Avoid when:
  - Simple CRUD; overhead not worth it
  - Team not familiar with eventual consistency
```

### Saga Pattern (Distributed Transactions)

```
Choreography Saga (event-based):
  Service A → Event → Service B → Event → Service C
  Each service listens and reacts; no central coordinator
  ✓ Decoupled   ✗ Hard to trace, debug

Orchestration Saga (central coordinator):
  Saga Orchestrator → calls Service A → calls Service B → calls Service C
  ✓ Easier to follow   ✗ Introduces coordinator coupling
```

- Use sagas instead of 2-phase commit across microservices
- Every step must have a **compensating transaction** for rollback
- Idempotency is mandatory — retries must not cause duplicate effects

---

## 3. Service Communication

### Synchronous (Request/Response)

```
REST       → HTTP/JSON; simple, widely supported; best for CRUD APIs
gRPC       → HTTP/2, Protocol Buffers; best for internal high-performance services
GraphQL    → Client-specified queries; best for flexible frontend APIs
```

### Asynchronous (Message/Event)

```
Message Queue  (SQS, RabbitMQ)  → point-to-point, guaranteed delivery, work queues
Pub/Sub        (SNS, Kafka)     → broadcast, fan-out, event streams
Streaming      (Kafka, Kinesis) → ordered, replayable, high-throughput event streams
```

### Choosing Communication Style

| Situation | Pattern |
|---|---|
| User-facing, needs immediate response | Synchronous REST / gRPC |
| Background work, can be async | Queue (SQS) |
| One event → many consumers | Pub/Sub (SNS + SQS, Kafka) |
| Ordered, replayable stream | Kafka / Kinesis |
| Cross-service long-running workflow | Saga (orchestration or choreography) |
| High-performance internal service | gRPC |

### API Design Best Practices

- **Versioning** — `/v1/`, `/v2/`; never break existing clients
- **Idempotency** — `PUT`/`DELETE` idempotent by design; `POST` with idempotency keys
- **Pagination** — cursor-based over offset for large datasets
- **Rate limiting** — protect backends; communicate via `429 Too Many Requests` + `Retry-After`
- **Circuit breaker** — fail fast when downstream is unhealthy (Resilience4j, AWS App Mesh)
- **Backward compatible changes** — add fields, never remove/rename without versioning
- **Contract testing** — consumer-driven contracts (Pact) over integration tests

---

## 4. Data Architecture

### Database Selection Guide

| Type | Examples | Use For |
|---|---|---|
| Relational (RDBMS) | PostgreSQL, MySQL, Aurora | Transactions, complex joins, strong consistency |
| Document | MongoDB, DynamoDB | Flexible schema, hierarchical data, high scale |
| Key-Value | Redis, DynamoDB, ElastiCache | Sessions, caches, leaderboards, fast lookups |
| Wide-Column | Cassandra, Bigtable | Time-series, IoT, write-heavy at massive scale |
| Graph | Neptune, Neo4j | Relationships, social graphs, fraud detection |
| Search | OpenSearch, Elasticsearch | Full-text search, log analytics |
| Time-Series | InfluxDB, Timestream | Metrics, monitoring, IoT sensor data |
| Data Warehouse | Redshift, BigQuery, Snowflake | Analytics, BI, OLAP queries |
| In-Memory | Redis, Memcached | Sub-millisecond latency, ephemeral data |

**Rule:** Use the right tool for the right job. Polyglot persistence is fine — don't force everything into one database.

### Data Consistency Models

```
Strong Consistency     → Read always returns latest write (single-region SQL)
Eventual Consistency   → Read may return stale data temporarily (DynamoDB, Cassandra)
Read-Your-Writes       → You always see your own writes (important for UX)
Monotonic Reads        → Same client doesn't see older data after newer data
Causal Consistency     → Causally related events seen in order

CAP Theorem:
  Only two of three: Consistency, Availability, Partition Tolerance
  In practice: choose between CP (sacrifice availability) or AP (sacrifice consistency)
  Modern systems often choose AP + tunable consistency
```

### Data Partitioning Strategies

```
Horizontal Sharding  → Rows split across nodes by shard key (user_id % N)
Vertical Partitioning → Columns split (hot columns separate from cold)
Range Partitioning   → By date range (logs_2024_01, logs_2024_02)
Hash Partitioning    → Consistent hashing; even distribution; good for DynamoDB

Pitfalls:
  Hot partition / hot shard → poor key choice causes uneven load
  Cross-shard queries       → expensive; avoid or denormalize
  Rebalancing               → moving data when adding nodes is complex
```

### Caching Strategies

```
Cache-Aside (Lazy Loading):
  App checks cache → miss → load from DB → write to cache
  ✓ Only caches requested data   ✗ First request always slow

Write-Through:
  Write to cache AND DB synchronously
  ✓ Cache always fresh   ✗ Write latency; cache fills with unused data

Write-Behind (Write-Back):
  Write to cache → async write to DB
  ✓ Fast writes   ✗ Data loss risk if cache fails before flush

Read-Through:
  Cache sits in front; auto-loads from DB on miss
  ✓ Transparent   ✗ Cold start on first read

TTL Strategy:
  Short TTL  → fresh data, high DB load
  Long TTL   → stale risk, low DB load
  Stale-while-revalidate → serve stale, refresh async (best UX)
```

**Cache Invalidation Patterns:**
- Event-driven invalidation — publish event on write → consumer clears cache
- TTL-based — accept eventual staleness; simplest approach
- Write-through — invalidate/update on every write; strong consistency

---

## 5. Resilience Patterns

### The Core Resilience Toolkit

```
Retry with Exponential Backoff + Jitter
  → Transient failures (network blip, rate limit, cold start)
  → Jitter prevents thundering herd
  → Set max retry limit; not all failures are transient

Circuit Breaker
  CLOSED → requests flow normally
  OPEN   → fail fast when error threshold exceeded; don't hammer failing service
  HALF-OPEN → probe with limited requests; reclose if healthy
  Tools: Resilience4j, AWS App Mesh, Istio, Envoy

Bulkhead
  → Isolate resource pools per consumer/service
  → Thread pool per downstream; failure of one doesn't starve others

Timeout
  → Always set timeouts on all network calls
  → Fail fast > hanging forever; cascade timeout = cascade failure

Rate Limiting & Throttling
  → Protect services from overload
  → Token bucket or leaky bucket algorithms
  → Communicate via 429 + Retry-After header

Fallback
  → Return cached data, default value, or degraded response on failure
  → Better than error; maintain partial availability

Idempotency
  → Design all mutation operations to be safe to retry
  → Use idempotency keys (UUID per request)
  → Especially critical for payments, order creation
```

### Health Endpoints Pattern

```json
GET /health/live    → Am I alive? (liveness: restart if not)
GET /health/ready   → Can I serve traffic? (readiness: remove from LB if not)
GET /health/startup → Have I finished initializing?

Response:
{
  "status": "healthy",
  "checks": {
    "database": "healthy",
    "cache": "healthy",
    "downstream_api": "degraded"
  },
  "version": "1.2.3",
  "timestamp": "2024-01-15T10:00:00Z"
}
```

### Load Shedding

- Reject requests proactively when system is overloaded
- Return `503 Service Unavailable` with `Retry-After` rather than slow degraded responses
- Prioritize critical traffic (payments) over non-critical (analytics)

---

## 6. Scalability Patterns

### Horizontal vs Vertical Scaling

```
Vertical (Scale Up)
  → Bigger instance (more CPU/RAM)
  → Simple; no code changes
  → Hard limit; single point of failure; downtime for resize
  → Use for: stateful services hard to distribute (short term)

Horizontal (Scale Out)  ← Prefer This
  → More instances behind a load balancer
  → Requires stateless application design
  → Unlimited scale; resilient to instance failure
  → Use for: stateless web/API tiers, workers
```

### Stateless Design

```
✗ Stateful (don't do in prod):
  Session stored in memory on server → sticky sessions needed → uneven load → AZ failure = session loss

✓ Stateless (correct):
  Session stored in Redis / DynamoDB → any instance handles any request → horizontal scale freely
```

### Async Processing Patterns

```
Job Queue Pattern:
  API → enqueue job (SQS) → Worker pool → process job → update DB → notify

Fan-Out Pattern:
  One event → SNS → multiple SQS queues → multiple worker types in parallel

Competing Consumers:
  Multiple workers pulling from same queue → auto-scales with queue depth

Scheduled Jobs:
  EventBridge Scheduler → Lambda / ECS task → avoid cron on EC2
```

### Autoscaling Decision Framework

```
CPU-based     → General stateless compute (target 60-70%)
Queue depth   → Worker pools (SQS ApproximateNumberOfMessages per instance)
Request rate  → API servers (requests per target on ALB)
Custom metric → Business-level (orders/s, active users)
Scheduled     → Predictable patterns (scale up before business hours)
Predictive    → ML-based; anticipate before traffic arrives
```

---

## 7. Security Architecture

### Zero Trust Model

```
"Never trust, always verify"

Principles:
  1. Verify explicitly   → Authenticate and authorize every request
  2. Least privilege     → Minimal access, just-in-time, just-enough
  3. Assume breach       → Segment everything; limit blast radius

Implementation:
  → mTLS between services (service mesh: Istio, Linkerd, App Mesh)
  → Short-lived tokens (JWT with low TTL) over long-lived API keys
  → Network policies / security groups deny by default
  → Secrets never in env vars baked into images
  → Runtime threat detection (GuardDuty, Falco)
```

### Threat Modeling (STRIDE)

| Threat | Example | Mitigation |
|---|---|---|
| **S**poofing | Impersonate service/user | Strong authentication, mTLS |
| **T**ampering | Modify data in transit/at rest | TLS, HMAC, encryption at rest |
| **R**epudiation | Deny performing an action | Audit logs, signed events |
| **I**nformation Disclosure | Expose sensitive data | Encryption, RBAC, data masking |
| **D**enial of Service | Overwhelm service | Rate limiting, WAF, autoscaling |
| **E**levation of Privilege | Gain unauthorized access | Least privilege, IAM, pod security |

### Encryption Strategy

```
In Transit:
  TLS 1.2 minimum; TLS 1.3 preferred
  mTLS for internal service-to-service
  Certificate management: cert-manager (K8s), ACM (AWS)

At Rest:
  Database: encryption enabled (AWS RDS, DynamoDB default)
  S3: SSE-KMS with customer-managed keys for sensitive data
  EBS: encrypted volumes
  Secrets: Secrets Manager / Vault (never plaintext)

Key Management:
  Use managed KMS (AWS KMS, GCP Cloud KMS, HashiCorp Vault)
  Separate keys per environment and data classification
  Rotate keys regularly; enable automatic rotation
  Key access audited via CloudTrail / Vault audit log
```

---

## 8. Networking Architecture

### Hub-and-Spoke (Recommended for Multi-Account)

```
                    ┌──────────────────┐
                    │  Network Account  │
                    │  Transit Gateway  │
                    └──────┬───────────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
    │  Prod VPC   │ │ Staging VPC │ │ Shared Svcs  │
    └─────────────┘ └─────────────┘ └──────────────┘
```

- Central **inspection VPC** for egress filtering (AWS Network Firewall)
- Centralize **DNS** via Route 53 Resolver with forward/conditional rules
- **Private link** for SaaS / partner connectivity without public internet

### Service Mesh (East-West Traffic)

```
Without mesh: Service A → Service B (plaintext, no retry, no observability)
With mesh:    Service A → Sidecar Proxy → mTLS → Sidecar Proxy → Service B
                          (retry, circuit break, observe, auth)

Tools:
  Istio        → Full-featured; complex; CNCF graduated
  Linkerd      → Lightweight, simpler; CNCF graduated
  AWS App Mesh → Managed; integrates with ECS/EKS/EC2
  Cilium       → eBPF-based; no sidecar; high performance
```

### CDN & Edge

```
Static Assets:  S3 → CloudFront (cache at edge, < 50ms globally)
Dynamic APIs:   ALB → CloudFront (cache where possible, WAF at edge)
Edge Compute:   CloudFront Functions / Lambda@Edge (auth, redirect, rewrite)

Best Practices:
  Cache-Control headers set correctly on all responses
  Invalidate on deploy, not constantly
  WAF at CloudFront layer — blocks before reaching origin
  Custom error pages served from edge
  HTTPS only; HSTS header enforced
```

---

## 9. Observability Architecture

### Three Pillars + Context

```
Metrics    → What is happening? (rates, errors, durations, saturation)
Logs       → Why is it happening? (structured events with context)
Traces     → Where is it happening? (request flow across services)
Events     → When did it change? (deployments, config changes, incidents)
```

### RED Method (Services)

```
Rate        → Requests per second
Errors      → Error rate (%)
Duration    → Latency distribution (p50, p95, p99)
```

### USE Method (Resources)

```
Utilization → % of time resource is busy (CPU, memory, disk)
Saturation  → Queue depth, wait time
Errors      → Error count (disk errors, network drops)
```

### The Four Golden Signals (Google SRE)

```
Latency      → Time to serve a request (distinguish error latency)
Traffic      → Demand on the system (requests/s, transactions/s)
Errors       → Rate of failed requests
Saturation   → How "full" the service is (CPU %, queue depth)
```

### SLI / SLO / SLA

```
SLI (Indicator)  → Measurement: "99.2% of requests < 200ms in the last 30 days"
SLO (Objective)  → Target:      "99.5% of requests < 200ms" (internal agreement)
SLA (Agreement)  → Contract:    "99% uptime or we pay credits" (external, legal)

Error Budget = 1 - SLO
  If SLO = 99.9%, error budget = 0.1% = ~43 min/month
  Burn rate alert: "budget consumed 2x faster than expected"
```

### Alerting Principles

```
Alert on symptoms, not causes
  ✗ "CPU > 80%"      (cause — may not matter)
  ✓ "Error rate > 1%" (symptom — users affected)

Page only on actionable alerts
  ✗ Alert no one cares about → alert fatigue → ignored alerts
  ✓ Every alert wakes someone up → someone acts on it

Severity tiers:
  P1 (Critical)  → Page immediately; customer impacted; revenue at risk
  P2 (High)      → Page in business hours; degraded experience
  P3 (Medium)    → Ticket; fix next sprint
  P4 (Low)       → Log; fix someday
```

---

## 10. Deployment Architecture

### Environment Promotion Strategy

```
Feature Branch → Dev → Staging → Prod
                 ↑       ↑         ↑
              Auto     1 review  2 reviews +
              merge    + tests    manual gate
```

### Release Patterns

```
Big Bang         → Deploy everything at once; high risk; avoid in prod
Rolling Update   → Gradually replace instances; zero-downtime; default for K8s
Blue/Green       → Two identical envs; instant cutover; easy rollback; costly
Canary           → Route % traffic to new version; real user validation; low risk
Shadow           → Duplicate real traffic to new version; no user impact; test in prod
Dark Launch      → Deploy code hidden behind feature flag; decouple deploy from release
A/B Testing      → Different versions to different user segments; measure outcomes
```

### Feature Flags

```
Types:
  Release toggles     → Decouple deploy from release
  Experiment toggles  → A/B testing
  Ops toggles         → Kill switch for features under load
  Permission toggles  → Beta users, role-based access

Tools: LaunchDarkly, AWS AppConfig, Unleash, Flipt, ConfigCat

Best Practices:
  → Remove flags after full rollout (flag debt is real debt)
  → Store flags in external system, not code
  → Test both flag states in CI
  → Have a kill switch for every major feature
```

---

## 11. Cost Architecture

### Design for Cost from Day One

```
Unit Economics:
  Cost per request, cost per user, cost per transaction
  Track over time; alert on regressions

Right Tool = Right Cost:
  Lambda for sporadic → don't keep EC2 running idle
  Spot for batch → don't use On-Demand for fault-tolerant workloads
  S3 + CloudFront → don't serve static files from EC2

Egress is the Hidden Cost:
  Cross-AZ traffic     → ~$0.01/GB (use same-AZ replicas for reads)
  Cross-region         → ~$0.02-0.09/GB
  Internet egress      → ~$0.09/GB
  VPC Endpoints        → eliminate S3/DynamoDB egress cost
  CloudFront           → cheaper egress than direct from origin
```

### FinOps Practices

```
Tag everything     → Environment, Team, Application, CostCenter
Budgets + alerts   → Know before the bill arrives
Showback / Chargeback → Each team sees their cost; ownership drives efficiency
Weekly cost review → Trending up? Find the culprit before EOQ
Rightsizing cadence → Monthly review of Compute Optimizer recommendations
Waste hunter       → Unattached EBS, unused EIPs, idle RDS, old snapshots
```

---

## 12. Multi-Region Architecture

### Active-Passive

```
Primary Region (active)    → Serves all traffic
Secondary Region (passive) → Warm standby; synced data; idle compute

Failover:
  Route 53 health check → DNS failover → secondary takes over
  RTO: minutes   RPO: seconds (replication lag)
```

### Active-Active

```
Both regions serve traffic simultaneously
  → Route 53 latency or geolocation routing
  → Data: DynamoDB Global Tables / Aurora Global Database / CockroachDB
  → Sessions: global cache (Redis Global Datastore)
  → Storage: S3 Cross-Region Replication

Challenges:
  Conflict resolution on concurrent writes
  Latency for globally consistent operations
  Complexity of testing and operations
```

### Data Residency & Compliance

```
GDPR    → EU data must stay in EU; right to erasure
PDPA    → Thailand data residency requirements
PCI-DSS → Cardholder data environment isolation
HIPAA   → Healthcare data encryption + access control

Architecture implications:
  → Region selection locked by compliance, not just latency
  → Data classification required before architecture
  → Audit trails mandatory; retention periods defined
```

---

## 13. Architecture Decision Records (ADR)

```markdown
# ADR-001: Use PostgreSQL over DynamoDB for Order Service

## Status: Accepted

## Context
Order service requires complex queries across multiple dimensions,
strong consistency for financial transactions, and support for
ad-hoc reporting.

## Decision
Use Amazon Aurora PostgreSQL in Multi-AZ configuration.

## Consequences
+ Strong consistency for financial data
+ Complex joins and ad-hoc queries supported
+ Familiar SQL interface for the team
- Less horizontal scale than DynamoDB
- Higher operational cost at extreme scale
- Requires schema migrations (managed via Flyway)

## Alternatives Considered
- DynamoDB: rejected — complex queries hard to model; no joins
- MongoDB: rejected — team unfamiliar; licensing concerns
```

- Document **every significant architecture decision**
- Record **context, decision, consequences, alternatives considered**
- Store ADRs in the **repository alongside the code**
- Revisit ADRs when context changes

---

## 14. Architecture Anti-Patterns

- ❌ **Distributed monolith** — microservices that are tightly coupled; worst of both worlds
- ❌ **Chatty services** — services making hundreds of synchronous calls per request
- ❌ **Shared database** — multiple services writing to same schema; coupling via data model
- ❌ **Synchronous chains** — A calls B calls C calls D; one failure cascades everything
- ❌ **No circuit breakers** — one slow downstream hangs all threads; cascading failure
- ❌ **Stateful services without sticky sessions** — sessions lost on instance failure
- ❌ **No idempotency** — retries cause double charges, duplicate records
- ❌ **God service** — one service does everything; bottleneck for all teams
- ❌ **Premature microservices** — splitting before understanding domain boundaries
- ❌ **No backpressure** — fast producer overwhelms slow consumer; queue grows unbounded
- ❌ **Synchronous everything** — no async; no queues; no resilience to downstream slowness
- ❌ **Ignoring the fallacies of distributed computing** — network is not reliable, not zero-latency, not infinite bandwidth
- ❌ **No data ownership** — services sharing write access to same tables
- ❌ **Architecture by committee** — no clear decision maker; design by consensus is slow
- ❌ **Over-engineering day one** — event sourcing, CQRS, sagas for a 3-table CRUD app

---

## 15. The Fallacies of Distributed Computing

> Know these — they are the root cause of most distributed system failures.

1. The network is reliable
2. Latency is zero
3. Bandwidth is infinite
4. The network is secure
5. Topology doesn't change
6. There is one administrator
7. Transport cost is zero
8. The network is homogeneous

**Every architecture decision must account for these realities.**

---

## 16. Architecture Review Checklist

```
Reliability
  □ Every component has at least 2 instances across 2+ AZs
  □ Health checks and circuit breakers on all downstream calls
  □ Retry with backoff + jitter on transient failures
  □ DR strategy defined with RTO/RPO targets tested

Security
  □ All data encrypted in transit (TLS 1.2+) and at rest
  □ No secrets in code, env vars (baked), or logs
  □ Least privilege IAM for all services
  □ Network segmentation — services can only reach what they need

Performance
  □ Caching strategy defined for read-heavy paths
  □ Database queries optimized; indexes on query columns
  □ Async for all non-user-facing work
  □ Load tested to 2x expected peak

Cost
  □ Right instance types / serverless where appropriate
  □ Auto Scaling configured; not over-provisioned
  □ Data transfer costs estimated and minimized
  □ Tagging strategy applied for cost attribution

Operability
  □ Structured logging with correlation IDs
  □ Metrics and dashboards for RED/USE signals
  □ Runbooks for common failure scenarios
  □ Deployment is automated, tested, and reversible

Compliance
  □ Data classification complete
  □ Audit trail enabled for sensitive operations
  □ Data residency requirements met
  □ Retention and deletion policies implemented
```

---

*Good luck with the interview!*