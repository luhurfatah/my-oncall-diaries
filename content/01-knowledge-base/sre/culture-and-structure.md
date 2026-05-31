# SRE — Humans and Organizations

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [The SRE Engagement Model](#1-the-sre-engagement-model) | How SRE teams formally structure their relationship with product development teams and why that structure exists. |
| **02** | [Production Readiness Reviews](#2-production-readiness-reviews) | The structured assessment that gates SRE acceptance of a service, what it evaluates, and what happens when a service fails it. |
| **03** | [The On-Call Handoff](#3-the-on-call-handoff) | How pager ownership transfers from development to SRE, the prerequisites for a safe handoff, and what a botched handoff looks like. |
| **04** | [On-Call Design and Sustainability](#4-on-call-design-and-sustainability) | The SRE model for structuring sustainable on-call rotations, load limits, alert hygiene, and what happens when those limits are breached. |
| **05** | [Operational Load Reviews](#5-operational-load-reviews) | The quarterly review mechanism, how to measure and categorize operational load, and using data to escalate when load becomes unsustainable. |
| **06** | [SRE Team Topologies](#6-sre-team-topologies) | The different structural models for embedding SRE capability in an organization and the trade-offs of each. |
| **07** | [SRE vs DevOps vs Platform Engineering](#7-sre-vs-devops-vs-platform-engineering) | How the three models relate, where they differ, which problems each is designed to solve, and the failure modes of applying each without prerequisites. |
| **08** | [Starting an SRE Practice](#8-starting-an-sre-practice) | The sequenced approach to introducing SRE practices into an organization that does not yet have them, and the most common failure modes. |

---

## 1. The SRE Engagement Model

The relationship between SRE teams and product development teams is one of the most carefully designed aspects of the Google SRE model. Without explicit structure, the relationship defaults to its natural adversarial state: SRE wants fewer changes for stability, development wants more changes for velocity, and neither side has a shared framework for navigating the tension. Left unmanaged, this dynamic produces either a dysfunctional ops team that blocks everything or an SRE team that is rolled over by development and becomes a pager-carrying support function with no engineering mandate.

The Google SRE model addresses this by defining the relationship contractually. The SRE team is not obligated to accept responsibility for every service that development produces. A service must meet a defined minimum bar of reliability, operability, and observability before the SRE team agrees to run it. The mechanism for assessing this bar is the Production Readiness Review. The mechanism for transferring responsibility is the on-call handoff. And the mechanism for enforcing sustainable load is the operational load limit with its associated escalation path.

These three mechanisms together create a relationship where the SRE team is a partner with defined expectations, not a service desk that absorbs whatever development ships. The clarity of the contract is what makes the partnership functional.

### The Reciprocal Obligation

The engagement model is not one-directional. In exchange for accepting on-call responsibility and providing reliability expertise, the SRE team takes on a reciprocal obligation to the development team: to treat the service's problems as engineering problems worth solving, to consult on architecture decisions that affect reliability, to build the automation and tooling that reduces operational burden, and to share the operational knowledge they accumulate back to the development team in a form that improves how the service is built going forward.

An SRE team that only enforces the bar — refusing services that fail PRRs, escalating when load is too high — without investing in helping development teams meet the bar is applying the model selectively in a way that produces resentment rather than collaboration. The production readiness review works because the SRE team is willing to work with development teams to address its findings, not just issue a verdict.

### Embedded vs. Centralized SRE

The structure of the engagement varies depending on whether the SRE function is organized as a central team serving multiple product teams or as embedded SREs within individual product teams. Both models have distinct engagement dynamics.

In the centralized model, a single SRE team runs on-call for multiple services across multiple product teams. The PRR process is the primary engagement surface — each new service goes through a formal review before the central SRE team accepts it. The central team has stronger platform and tooling leverage because their investments benefit all services they support. The risk is that the central SRE team becomes a bottleneck, the PRR process becomes bureaucratic, and product teams feel distant from their reliability partners.

In the embedded model, SREs are assigned to specific product teams, attending their planning meetings, participating in architecture discussions, and sharing the team's on-call rotation. The engagement is continuous rather than formal-gated. The risk is that embedded SREs lose their identity as reliability specialists, get absorbed into feature development work, and drift away from the engineering practices that distinguish SRE from DevOps.

---

## 2. Production Readiness Reviews

A Production Readiness Review (PRR) is a structured assessment of a service's readiness to be operated in production by an SRE team. It is conducted before the SRE team accepts on-call responsibility for a new service, and before a service passes a traffic or load threshold that changes its operational requirements significantly. The PRR is not a bureaucratic hurdle — it is a reliability design review that surfaces gaps before they become production incidents.

### Why the PRR Exists

Without a PRR, the implicit contract for SRE acceptance is "if development ships it, SRE runs it." This contract produces a perverse incentive: development teams have no operational consequence for shipping services that are difficult to operate. The SRE team absorbs the operational complexity regardless of whether the service was designed with operability in mind. Over time, the team's operational load grows proportionally with the number of services they own, not with the engineering quality of those services.

The PRR changes the incentive structure. Development teams that want SRE support must build services that meet the SRE team's operability bar. This creates a strong incentive to instrument services properly, design for failure, document runbooks, and define SLOs before asking the SRE team to carry the pager. It also creates a clear mechanism for SRE teams to decline services that would add unsustainable operational load — not as a personal rejection but as an evidence-based decision grounded in the PRR findings.

### What a PRR Evaluates

A PRR evaluates the service across six dimensions. Each dimension has a set of questions that the SRE team works through with the development team, producing findings that are either approved, conditionally approved pending specific changes, or blocking.

**Architecture and failure design** examines whether the service is built to fail gracefully. Does it have circuit breakers that prevent cascading failures when downstream dependencies degrade? Does it implement proper retry logic with exponential backoff and jitter? Are timeout budgets configured at each layer of the call chain, and do they decrease as calls go deeper to prevent cascading waits? Does the service degrade gracefully when non-critical dependencies are unavailable, or does it fail completely?

**Observability** examines whether the service emits the signals the SRE team needs to understand its production behavior. Are the four golden signals — latency, traffic, errors, saturation — instrumented and visible in dashboards? Does the service emit structured logs that support diagnosis, or unstructured text that requires grep and intuition? Is distributed tracing instrumented across service boundaries so that a slow request can be followed through the dependency chain? Are there alerting rules that fire on symptoms the SRE team would need to respond to, or is the SRE team expected to discover problems by watching dashboards?

**Deployment and rollback** examines whether the service can be changed and recovered safely and quickly. Is the deployment process fully automated with no manual steps in the happy path? Can the service be rolled back to the previous version in a single command or automated process? Has the rollback procedure been tested, or does it only exist as documentation? Does a deployment gone wrong require coordinated action across multiple teams, or can the SRE team on-call execute the rollback independently?

**Capacity and scaling** examines whether the service can handle expected load and whether it will degrade predictably under unexpected load. Has the service been load tested at peak traffic projections? Does it scale horizontally, and has horizontal scaling been validated? What happens when it hits its scaling limits — does it queue, shed load gracefully, or fail hard? Are resource limits and requests set correctly in Kubernetes, or are they left at defaults?

**Runbooks and documentation** examines whether the operational knowledge needed to run the service exists in a form that an on-call engineer who did not build the service can use under pressure. Are there runbooks for the failure modes that are predictable from the service's design — dependency failures, high error rates, memory exhaustion? Do the runbooks reflect the current version of the service, or were they written at launch and never updated? Is the on-call engineer expected to have deep familiarity with the service's internals to respond to alerts, or are the runbooks self-contained enough that a generalist SRE can follow them?

**SLO definition and error budget policy** examines whether the service has defined SLIs and SLOs that the SRE team and development team have agreed on, and whether the error budget policy specifying what happens when the budget is consumed has been negotiated and documented. An SRE team accepting a service without agreed SLOs has no objective measure of what "healthy" looks like and no shared framework for deciding when to freeze feature development in favor of reliability work.

### PRR Outcomes

A PRR produces one of three outcomes. An approved PRR means the service meets the bar and the SRE team will accept on-call responsibility on an agreed date. A conditionally approved PRR identifies specific blocking issues that must be resolved before handoff, with a timeline for resolution and a follow-up review. A deferred PRR means the service has fundamental reliability or operability gaps that require significant engineering investment — typically an architectural change or a substantial observability build-out — before the conversation about SRE acceptance is appropriate.

The deferred outcome is the one that requires the most care in delivery. It must be communicated as a collaborative finding, not a rejection. The SRE team should provide a concrete list of what would need to change for the service to pass a future PRR, and should offer to consult on the engineering approach to those changes. A deferred PRR that leaves the development team unclear on what they need to build to get SRE support has failed its purpose.

### PRR Anti-Patterns

The PRR process fails in two directions. It fails by being too permissive — approving services that do not meet the bar because of organizational pressure, relationship dynamics, or a desire to avoid conflict. Each approval below the bar adds operational burden that the SRE team absorbs indefinitely. It fails by being too rigid — treating the PRR as a checklist audit rather than a reliability design review, applying the same bar to an internal batch job and a customer-facing payment API, and creating a reputation as a bureaucratic gatekeeper rather than an engineering partner.

The calibration principle is that the PRR bar should be proportional to the operational consequences of the service failing. A service that, if unavailable, causes revenue loss and customer churn requires a high bar. A service that, if unavailable, inconveniences internal users requires a lower bar. Applying the same checklist to both is not rigorous — it is indiscriminate.

---

## 3. The On-Call Handoff

The on-call handoff is the formal transfer of pager ownership from the development team to the SRE team. It is a milestone, not a moment — a process that takes weeks and ends with the SRE team having sufficient familiarity with the service to respond to production incidents with speed and judgment, not with confusion and escalation to the development team for every alert.

### Prerequisites for a Safe Handoff

A safe handoff requires the SRE team to reach a threshold of operational familiarity before they carry the pager. The threshold is not about reading documentation — it is about having seen the service behave in production, having participated in at least one incident response, and having validated that the runbooks reflect reality rather than theory.

The practical mechanism for building this familiarity is a shadowing period. During shadowing, the development team carries the primary pager while the SRE team shadows the rotation — receiving the same alerts, joining incident calls, observing remediation steps, and asking questions. The SRE team documents what they learn, updates runbooks where they find gaps, and identifies the failure modes the runbooks do not cover. After the shadowing period, the teams reverse: the SRE team carries the primary pager while the development team shadows, available to answer questions but not taking action unless the SRE team explicitly asks. Full handoff happens only after this reverse-shadow period confirms the SRE team can operate the service independently.

Skipping the shadowing period — handing the pager to the SRE team because a deadline requires it, because the development team is moving on to a new project, or because the PRR was approved and the handoff feels like a formality — produces an on-call team that pages the development team for guidance on every non-trivial alert. The operational load does not transfer; it duplicates.

### The Handoff Document

The handoff culminates in a handoff document that captures the operational knowledge the SRE team will need going forward. A complete handoff document covers the service's architecture and its most critical components, the SLOs and their current performance, the dependency map with the failure behavior of each dependency, the known failure modes and their runbooks, the deployment and rollback procedure, the escalation path for issues that require development team involvement, and the list of open reliability improvements that the development team committed to during the PRR.

The last item is important. The PRR often produces conditional approvals — items the development team agreed to address after handoff. The handoff document is the accountability mechanism: it records what was promised, and the SRE team references it in operational load reviews to track whether promised improvements were delivered.

### What a Botched Handoff Looks Like

A botched handoff is recognizable within the first month of the SRE team carrying the pager. The on-call engineer is paged for alerts they cannot diagnose without escalating to the development team. Runbooks lead to dead ends or describe procedures that no longer match the current system. The SRE team does not know which components are critical and which are non-critical, so every alert feels equally urgent. Incident resolution time is high not because the problems are hard but because the on-call engineer does not have the context to act quickly.

The correct response to a botched handoff is not to absorb the pain and learn over time — it is to formally revert the handoff, return the pager to the development team, and redo the shadowing and reverse-shadow period properly. This is a legitimate escalation path in the Google SRE model, and teams that use it produce better long-term outcomes than teams that do not.

---

## 4. On-Call Design and Sustainability

On-call is the mechanism by which SRE teams provide continuous coverage for production systems. The Google SRE model has explicit constraints on what constitutes sustainable on-call — not out of softness, but out of a practical understanding that an exhausted, demoralized on-call engineer responds more slowly, makes more errors under pressure, and eventually leaves the organization, taking irreplaceable operational knowledge with them.

### The Two On-Call Load Constraints

Google's SRE guidelines establish two specific limits on on-call load that, together, define what sustainable on-call looks like.

The first constraint is on incident volume during a shift. During a primary on-call shift, an engineer should deal with at most two significant events. A significant event is one that requires active investigation and remediation — not a brief acknowledgment of a self-resolving alert, but an incident where the engineer must engage, diagnose, and take action. More than two significant events per shift means the on-call engineer cannot adequately handle each incident. Response quality degrades as context switches accumulate. Engineers make mistakes when they are simultaneously tracking multiple open incidents without the cognitive space to think through each one carefully.

The second constraint is on the team-wide toil percentage. Averaged across the entire team — including both on-call and off-call rotations — operational and toil work should not exceed 50% of total engineering time. On-call shifts that are frequently overwhelming drain engineers of the capacity they need for the engineering work that reduces future operational burden. A team spending 70% of its time on reactive work has no capacity to build the automation that would make the reactive work unnecessary.

### Rotation Design

A sustainable on-call rotation has enough engineers to keep the primary on-call frequency reasonable — no engineer should be on-call more than once per week in a primary rotation, with once per two weeks as the more comfortable target for services with moderate alert volumes. Smaller teams with fewer engineers face a structural tension: a four-person team rotating weekly means every engineer is on-call one week in four, which is acceptable if alert volume is low but quickly becomes unsustainable if incidents are frequent.

The rotation should include both a primary on-call and a secondary on-call. The secondary exists for two purposes: as an escalation path when the primary engineer is overwhelmed or needs a second opinion, and as a training opportunity for engineers who are new to a service and not yet ready to carry the primary pager alone. Secondary on-call is the practical mechanism for onboarding new team members to a rotation without exposing them to full responsibility prematurely.

Geographic distribution of on-call engineers follows the sun — if the team spans multiple time zones, structuring the rotation so that each engineer is on-call during their own business hours rather than their sleep hours significantly improves both engineer wellbeing and incident response quality. A well-rested engineer who is paged at 2pm local time responds better than an engineer paged at 2am who is then expected to work a full day afterward.

### Alert Hygiene as a First-Class Activity

Alert fatigue is the state reached when on-call engineers receive so many alerts — many of which are non-actionable, auto-resolving, or of unclear significance — that they begin treating all alerts with reduced urgency. The engineer who has been woken up three times this week for alerts that resolved themselves before they could act becomes the engineer who silences their phone during the fourth alert. Alert fatigue does not just cause missed incidents — it destroys the on-call engineer's trust in the alerting system entirely.

Alert hygiene is not a one-time cleanup activity — it is a recurring operational responsibility. Every alert in the system should be reviewed against two criteria: is this alert actionable (does receiving it require a specific response from the engineer), and is this alert significant (does it represent a condition that warrants interrupting someone's work or sleep). Alerts that fail either criterion should be deleted, demoted to a ticket-only notification, or converted to a dashboard warning that an engineer reviews proactively rather than responds to reactively.

The practical cadence for alert review is monthly. During each monthly review, the team examines every alert that fired in the past month and asks: did it require action, did the action taken improve the situation, and if the alert had not fired would the situation have resolved itself or been caught by another signal? Alerts with consistently "no" answers to these questions are candidates for removal.

### The Cost of Ignoring Sustainability

The organizational cost of unsustainable on-call is not immediately visible to leadership because it manifests through engineer turnover rather than system metrics. The engineers who leave first when on-call is unsustainable are almost always the best ones — they have the most options and the clearest sense of what sustainable work looks like. They are replaced by engineers who are either less experienced or who have not yet recognized the pattern. Operational knowledge leaves with the departing engineers. The new engineers take longer to respond to incidents and make more errors. The on-call becomes more painful. The next best engineer leaves. The cycle accelerates.

Preventing this requires treating on-call sustainability as a measurable, trackable engineering metric — not as a matter of team culture or individual resilience. When the two-incident-per-shift limit is breached consistently, it must trigger an operational load review and a concrete remediation plan, not encouragement to push through.

---

## 5. Operational Load Reviews

An operational load review is a structured, periodic examination of the volume and composition of work the SRE team is performing, compared against the sustainability thresholds defined in the Google SRE model. The review is not a performance evaluation — it is a diagnostic instrument that surfaces whether the team's operational load is at a level that allows them to fulfill their engineering mandate.

### Review Cadence and Inputs

Google's SRE teams conduct operational load reviews quarterly. The inputs to the review are the data collected during the quarter on how the team's time was actually spent: on-call incident count and duration, ticket volume, toil hours as self-reported by team members, and engineering hours spent on automation and reliability projects.

The time-tracking methodology does not need to be precise to be useful. Engineers categorizing their time in roughly one-hour blocks as toil, overhead, or engineering work — even imprecisely — produces a signal that is far more actionable than having no data at all. The goal is a directional picture of the team's toil percentage, not an exact accounting.

```python
def calculate_operational_load_summary(team_time_logs: list) -> dict:
    """
    Aggregate time logs from all team members for a quarter.
    Each log entry: {'engineer': str, 'category': str, 'hours': float}
    Categories: 'toil', 'overhead', 'engineering'
    """
    totals = {'toil': 0.0, 'overhead': 0.0, 'engineering': 0.0}

    for entry in team_time_logs:
        category = entry['category']
        if category in totals:
            totals[category] += entry['hours']

    total_hours = sum(totals.values())
    if total_hours == 0:
        return {'error': 'No time logged'}

    toil_pct = round(totals['toil'] / total_hours * 100, 1)
    engineering_pct = round(totals['engineering'] / total_hours * 100, 1)

    return {
        'total_hours': round(total_hours, 1),
        'toil_hours': round(totals['toil'], 1),
        'engineering_hours': round(totals['engineering'], 1),
        'overhead_hours': round(totals['overhead'], 1),
        'toil_pct': toil_pct,
        'engineering_pct': engineering_pct,
        'status': (
            'critical' if toil_pct > 60 else
            'at_limit' if toil_pct > 50 else
            'healthy'
        ),
        'recommendation': (
            'Immediate escalation required — team cannot fulfill engineering mandate'
            if toil_pct > 60 else
            'Escalate to engineering leadership — toil exceeds sustainable threshold'
            if toil_pct > 50 else
            'Within sustainable range — continue monitoring'
        ),
    }
```

### What to Do When Load Is Unsustainable

When the operational load review shows that toil has exceeded the 50% threshold, the SRE team has an organizational mechanism for escalating that is defined in the Google SRE model. The team formally documents the load data — incidents per week, ticket volume, toil hours — and presents it to engineering leadership and the product teams whose services are generating the load.

The escalation is not a complaint — it is a business case. The data shows what operational work is consuming team capacity, which services are generating disproportionate load, and what engineering investment would be needed to reduce that load. The escalation asks for a decision: either the product team invests in reliability improvements that reduce the SRE team's operational burden, or the SRE team returns the pager for the overloading service until those improvements are made.

This escalation mechanism is what gives the 50% limit organizational teeth. Without it, SRE teams absorb operational overload indefinitely. The best engineers leave. The remaining team becomes less effective. The operational burden grows. With the escalation mechanism functioning, operational overload becomes a visible organizational problem that leadership must address — not an invisible tax paid entirely by the SRE team.

### Services Generating Disproportionate Load

Not all services generate equal operational load. In most SRE team portfolios, a small number of services generate a disproportionate share of incidents, tickets, and toil. The operational load review should identify these services explicitly and surface them as priority targets for reliability investment.

A service that generates more than 20% of the team's total incident volume but represents less than 10% of the team's service portfolio is a reliability outlier. The appropriate response is a focused reliability sprint — a time-boxed period where SRE and development engineering effort is directed at the specific failure modes driving the incident volume. If a reliability sprint does not bring the service into proportion, the question of whether the SRE team should continue supporting it must be raised explicitly.

---

## 6. SRE Team Topologies

The organizational structure of an SRE function significantly affects both its effectiveness and its relationship with development teams. There is no universally correct topology — the right structure depends on the organization's size, engineering maturity, and the nature of the systems being run.

### Centralized SRE

In the centralized model, a single SRE team provides reliability services to multiple product teams across the organization. The SRE team owns the on-call rotation for all supported services, conducts PRRs for new services, and develops shared tooling and platforms that benefit all services they support.

The centralized model scales well in terms of tooling investment — an automation or observability platform built by the central SRE team benefits every service it supports. It also concentrates reliability expertise, making it easier to share knowledge across service boundaries and to identify patterns that span multiple systems. The weakness is distance: a centralized SRE team serving ten product teams may not have deep enough familiarity with any individual service to provide the partnership that the PRR and handoff model requires. The PRR process can become procedural rather than collaborative when the SRE team does not have ongoing context about the service's evolution.

### Embedded SRE

In the embedded model, individual SREs are assigned to specific product teams. They attend product planning meetings, participate in architecture discussions, influence design decisions from a reliability perspective before services are built, and share the team's on-call rotation as a full participant rather than an external operator.

The embedded model produces the deepest reliability partnership — embedded SREs accumulate the service context that makes their reliability guidance valuable, and their continuous presence in the team means reliability is considered in design decisions rather than evaluated after the fact in a PRR. The weakness is that embedded SREs can lose their identity as reliability specialists. Without a community of practice — regular cross-team SRE meetings, shared standards, a connection to the broader SRE discipline — embedded SREs drift toward becoming senior software engineers with operational responsibilities, which is DevOps rather than SRE.

### SRE as a Consulting Function

A third model, appropriate for smaller organizations or those early in their SRE adoption, treats SRE as a consulting function rather than an operational owner. The SRE team provides reliability consulting — architecture reviews, SLO definition workshops, incident management training, observability audits — without taking on-call ownership of any service. Development teams retain operational responsibility while SRE provides the expertise to improve how they exercise that responsibility.

This model is a pragmatic starting point when the organization does not yet have the service maturity, tooling investment, or headcount to support the full SRE model. It builds the reliability culture and practices that make a future operational handoff viable, without creating an on-call obligation before the prerequisites are in place.

| Topology | Best For | Key Strength | Key Risk |
| :--- | :--- | :--- | :--- |
| Centralized | Large orgs, many services, strong tooling investment | Shared platform leverage, concentrated expertise | Distance from individual service context |
| Embedded | Product-led orgs, deep partnership needed | Continuous reliability influence in design | SRE identity dilution, inconsistent standards |
| Consulting | Early SRE adoption, small org, immature services | Builds culture without premature on-call commitment | No operational accountability, advice may not be acted on |

---

## 7. SRE vs DevOps vs Platform Engineering

The three models — SRE, DevOps, and Platform Engineering — are often treated as competing alternatives or conflated as synonyms. They are neither. They address related but distinct problems and are complementary when applied to the right problems at the right organizational scale.

### DevOps as the Cultural Foundation

DevOps is the cultural model that both SRE and Platform Engineering build on. It establishes the principle that development and operations should share responsibility for the full software lifecycle — from coding through deployment through production operation. DevOps does not specify how that shared responsibility should be structured, what tools should be used, or what metrics should be tracked. It is a philosophy, not an implementation.

The essential DevOps insight is that the historical separation between development and operations creates misaligned incentives: developers are rewarded for shipping features and not penalized for operational consequences, while operators are penalized for outages caused by code they did not write. DevOps aligns incentives by making developers responsible for what they ship in production, and by giving operators influence over how systems are built.

### SRE as a Specific DevOps Implementation

Google describes SRE as "a specific, opinionated implementation of DevOps." Where DevOps says "developers and operators should collaborate," SRE specifies the structure of that collaboration: error budgets that give both teams a shared quantitative objective, production readiness reviews that define the bar for SRE acceptance, operational load limits that prevent SRE from becoming pure ops, and an engineering mandate that requires SRE teams to spend at least 50% of their time on software development.

SRE adds the precision that DevOps lacks. It answers questions that DevOps leaves open: how much reliability is enough (SLOs), what happens when reliability is not met (error budget policy), who is responsible when a service fails the reliability bar (the PRR and handoff model), and how do you prevent operations work from crowding out engineering work (the 50% toil limit).

SRE is most appropriate at the organizational scale where dedicated reliability teams are economically justified — when the systems are complex enough that operational expertise is specialized, when the user impact of reliability failures is significant enough to justify the investment, and when the organization has the engineering maturity to execute the model without it collapsing into renamed ops.

### Platform Engineering as the Scaling Layer

Platform Engineering addresses a problem that SRE does not: the cognitive overhead on application developers of consuming cloud infrastructure, Kubernetes, CI/CD, and observability tooling. An SRE team can define SLOs and manage production reliability for a service, but it does not solve the problem of every development team needing to become experts in Terraform, Helm, and ArgoCD to deploy that service.

Platform Engineering builds Internal Developer Platforms — the paved roads, the Golden Paths — that abstract infrastructure complexity behind self-service interfaces. A developer should be able to provision a production-ready service that automatically has the SRE team's SLO instrumentation, the security team's guardrails, and the platform team's deployment pipeline without understanding the implementation of any of those components.

The relationship between SRE and Platform Engineering is complementary. Platform Engineering reduces the operational complexity of the systems SRE teams run, by ensuring that services are provisioned with correct observability, deployment automation, and baseline configuration from the start. SRE provides the reliability standards that Platform Engineering's Golden Paths are designed to satisfy automatically. Each makes the other more effective.

### The Failure Modes of Each Model

Every model has characteristic failure modes when applied without its prerequisites.

DevOps without automation is just developers being asked to do operations manually, with added responsibility and no added tooling. The culture shift without the engineering investment produces burnout rather than velocity.

SRE without the engineering mandate becomes an expensive operations team with a different name. If the SRE team is not spending 50% of its time on engineering work — if the operational load consumes everything — the model has failed. The team is doing ops, not SRE. This failure is common in organizations that adopt SRE titles without adopting SRE structures, particularly the 50% limit and the escalation mechanism that enforces it.

Platform Engineering without user research produces tooling that is technically sophisticated but practically unused. If the platform team builds what they think developers need rather than what developers actually need, developers work around the platform rather than through it. The Golden Path becomes the road that nobody walks because the terrain it covers is not where anyone is trying to go.

| Model | Primary Problem Solved | Key Mechanism | When to Apply | Failure Mode |
| :--- | :--- | :--- | :--- | :--- |
| DevOps | Silo between Dev and Ops | Shared ownership, cultural shift | Always — it is the foundation | Without automation: manual ops with more responsibility |
| SRE | Reliability management at scale | Error budgets, SLOs, toil elimination, PRR | When dedicated reliability expertise is economically justified | Without engineering mandate: renamed ops team |
| Platform Engineering | Developer cognitive overhead | Internal Developer Platform, Golden Paths | When infrastructure complexity creates development friction | Without user research: unused tooling, bypassed platform |

---

## 8. Starting an SRE Practice

Organizations adopting SRE for the first time almost universally make the same mistake: they start with the org chart change — renaming the ops team or hiring engineers with SRE titles — without changing the underlying practices, structures, and expectations that distinguish SRE from operations. The result is an SRE team in name that operates as an ops team in practice, with the added frustration of engineers who were hired with the promise of interesting technical work spending 80% of their time on tickets and incidents.

### The Sequenced Approach

Introducing SRE practices successfully requires a deliberate sequence. The practices build on each other, and implementing them out of order produces the conditions for the model to fail.

The first step is establishing measurement. Before changing any team structure or accepting any on-call responsibility, define SLIs and SLOs for the services that will eventually be supported. Without SLOs, there is no error budget, and without an error budget, the core negotiating mechanism between SRE and development does not exist. This step requires working with product teams to agree on what "good enough" reliability looks like — a conversation that is often uncomfortable and always worth having explicitly rather than leaving implicit.

The second step is measuring the current toil percentage. Spend four to six weeks with the team that will become the SRE team, classifying how they currently spend their time. This baseline is the starting point for demonstrating improvement over time and for justifying automation investment. It is also often the evidence that convinces leadership that the current operational model is unsustainable — teams that believe their toil is "manageable" are frequently surprised to discover it is running at 70% or higher when measured honestly.

The third step is defining the PRR bar for the first service the SRE team will own. Start with a single service — the most important one, or the one with the most motivated development team — rather than attempting to onboard everything at once. The first PRR is as much about the SRE team learning what they need to know as it is about evaluating the service. It sets the template for every subsequent PRR and produces the first runbook library.

The fourth step is the first on-call handoff, executed with the full shadowing and reverse-shadow process. The first handoff takes longer than subsequent ones because the process is being developed, not just executed. The investment is worth it: a first handoff done properly builds the organizational muscle memory for every handoff that follows.

Only after these four steps are in place — SLOs defined, toil measured, PRR process working, first handoff completed — should the SRE team begin scaling to additional services or additional team members. Scaling before the foundation is established scales the chaos rather than the capability.

### Common Failure Modes at Startup

The most common reason SRE practices fail to take hold in an organization is that the org chart change happens without the structural changes that the model requires. Renaming the ops team "SRE" does not produce SRE outcomes. The 50% engineering time requirement, the PRR process, the on-call load limits, and the escalation mechanism that enforces them must all be implemented explicitly. Each one will face organizational resistance from teams accustomed to the old model, and each one requires leadership support to be sustained against that resistance.

The second common failure mode is starting too large. Attempting to define SLOs for thirty services simultaneously, conduct PRRs for every service the ops team currently runs, and implement the full Google SRE model across the entire engineering organization in a single initiative produces a program that is too complex to execute and too abstract to sustain momentum. The model that works is the one that produces a demonstrable success on one service — an SLO that is being met, an error budget that is being managed, a handoff that produced a measurable reduction in on-call toil — and uses that success as the template for expansion.

The third failure mode is SRE without buy-in from the development teams. The SRE model depends on development teams believing that the reliability bar, the PRR process, and the error budget policy serve their interests as well as the SRE team's. Development teams that experience the PRR as an obstacle, the error budget policy as a constraint imposed on them rather than a tool they co-own, and the SRE team as a gatekeeper rather than a partner will work around the model rather than through it. Building that buy-in requires involving development leads in the design of the SLOs, the PRR criteria, and the error budget policy from the beginning — not presenting them with a model designed by the SRE team and asking for compliance.
