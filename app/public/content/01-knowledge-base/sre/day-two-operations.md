# SRE — Keeping the Lights On

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Toil — Definition and Elimination](#1-toil-definition-and-elimination) | What toil is precisely, why it is an organizational tax, and how SRE teams systematically identify and reduce it. |
| **02** | [Eliminating Toil with Automation](#2-eliminating-toil-with-automation) | The automation hierarchy, where to invest engineering effort, and when not to automate. |
| **03** | [Monitoring and Observability](#3-monitoring-and-observability) | The four golden signals, symptom-based vs. cause-based alerting, and burn-rate alert tiers. |
| **04** | [Incident Management](#4-incident-management) | The incident lifecycle, severity classification, command structure, and the SRE approach to managing production failures. |
| **05** | [Postmortems](#5-postmortems) | The blameless postmortem as a learning instrument, its anatomy, and the failure modes of postmortem culture. |

---

## 1. Toil — Definition and Elimination

Toil is one of the most precisely defined concepts in the SRE lexicon, and the precision matters because "work we don't like" and "toil" are not the same thing. The SRE definition of toil has specific properties, and only work that meets all of them qualifies.

### The Six Properties of Toil

Google defines toil as operational work tied to running a production service that is manual, repetitive, automatable, tactical, lacking enduring value, and scaling linearly with service growth. Each property is load-bearing.

**Manual** means a human is required to perform the work. A script that runs automatically is not toil even if someone wrote it manually. A ticket that requires a human to log into a server and run a command is toil.

**Repetitive** means the same work is done multiple times, not a one-time activity. Designing a new deployment pipeline is not toil. Re-running the same deployment steps for each of forty microservices every release is toil.

**Automatable** means a machine could, in principle, do the work without human judgment. Toil is not inherently difficult — it is inherently mechanical. If a process could be scripted, it is automatable. If it genuinely requires human judgment at every step, it may be legitimate operational work rather than toil.

**Tactical** means it is reactive and interrupt-driven rather than strategic. Toil arrives as a ticket, a page, or a request — pulling engineers out of planned work into reactive response. Strategic engineering work — building automation, improving reliability, reducing complexity — is not toil.

**Lacking enduring value** means completing the task returns the system to the state it was in before the task was triggered, rather than improving the system. Restarting a service that crashes every week does not make the service better; it just restores the previous state. Fixing the crash so it no longer requires restarting creates enduring value.

**Linear scaling** means as the service grows — more users, more traffic, more instances — the amount of toil grows proportionally. This is the property that makes toil existentially threatening at scale. If each new service requires 4 hours of manual setup, and the organization adds 10 new services per quarter, toil grows by 40 hours per quarter indefinitely. The team gets consumed.

### Toil vs. Overhead vs. Legitimate Engineering Work

Not all unpleasant work is toil. Overhead — administrative meetings, performance reviews, documentation, on-call training — is a necessary cost of operating an organization. It does not scale with service growth and most of it has enduring value. It is not toil.

Responding to a genuinely novel production failure — one that requires real-time diagnosis, judgment calls, and creative problem-solving — is not toil. It is difficult operational work, but it is not repetitive or automatable in the moment. The postmortem that follows it, which leads to automation preventing the next occurrence, is the toil-elimination activity.

### Why Toil Is an Organizational Tax

Google's guidance is that SRE teams should spend no more than 50% of their time on toil. The remaining 50% must be spent on engineering work — writing software, building automation, improving systems — that either eliminates toil or improves reliability. If toil exceeds 50%, the team has entered a state where the operational burden crowds out the engineering work needed to reduce that burden. It is a self-reinforcing trap.

The 50% boundary is not arbitrary. It reflects a calculation about sustainable growth: if an SRE team spends 50% of its time on engineering work that reduces future toil, the team can absorb service growth without proportional headcount growth. If the team spends 80% on toil, it cannot keep pace with growth without hiring more people who will also spend 80% of their time on toil — linear scaling of the team with service growth, which defeats the purpose.

### Measuring Toil

Teams that have not measured their toil have no baseline for improvement and no evidence to justify automation investment to leadership. The measurement methodology is simple: for two to four weeks, every team member tracks how they spend their time in roughly one-hour buckets, classifying each block as toil, overhead, or engineering. The aggregate produces a toil percentage that can be tracked over time and used to validate that automation investments are paying off.

---

## 2. Eliminating Toil with Automation

The SRE mandate to eliminate toil is not an aspiration — it is the core engineering discipline of the role. The Google SRE model expects that when a team identifies toil, they write software to eliminate it, not just document it or accept it as the cost of doing business.

### The Automation Hierarchy

Not all automation is equally valuable. The SRE book describes a hierarchy of automation sophistication, from lowest to highest value. Understanding where on the hierarchy a given automation falls clarifies how much toil it actually eliminates and what the next improvement step should be.

The lowest form is an operator-triggered script — a human must decide when to run it, initiate it manually, and verify its output. This eliminates the manual execution of individual steps but preserves the human judgment and interrupt cost of the triggering decision.

The intermediate form is automation that runs on a schedule or in response to a simple threshold trigger — a cron job that rotates logs, a CloudWatch alarm that triggers a Lambda function when disk usage exceeds 80%. This eliminates the interrupt and decision cost for the cases the trigger covers, but it handles only the cases the designer anticipated.

The highest form is automation that observes system state, diagnoses problems, determines the appropriate remediation from a range of options, executes the remediation, and verifies the outcome — all without human involvement. This is the automation that eliminates entire categories of toil rather than individual instances of it.

| Tier | Description | Toil Eliminated | Example |
| :--- | :--- | :--- | :--- |
| **Operator-triggered** | Human decides when to run, initiates manually | Individual execution steps | A script that restarts a service when given a flag |
| **Threshold-triggered** | Runs automatically on schedule or simple trigger | Interrupt and decision cost for anticipated cases | CloudWatch alarm → Lambda restarts unhealthy ECS tasks |
| **Self-diagnosing** | Observes state, selects remediation, executes, verifies | Entire categories of operational work | Auto-remediation that detects, roots, fixes, and confirms resolution |

Most operational automation sits between tier one and tier two. Moving automation toward tier three — context-aware, self-diagnosing, self-healing — is the long-term engineering goal.

### When Not to Automate

Automating the wrong thing is worse than not automating. Automation that encodes a broken process makes the broken process faster and harder to change. Before automating any toil, verify that the underlying process is worth preserving. If a deployment process involves ten manual steps because the system was not designed for automated deployment, the correct response is to redesign the system, not to script the ten steps.

The second failure mode is automating before the process is stable. If a process changes every few weeks as the system evolves, automating it creates automation debt — the automation must be updated every time the process changes, and the update is often more work than the manual process would have been. Stabilize the process first, then automate it.

### Automation as Engineering Justification

The toil elimination mandate gives SRE teams a framework for justifying engineering investment that operations teams historically could not make. An SRE team can quantify toil as a percentage of team capacity, project how that toil will grow with service scale, and show what engineering work is being crowded out by the toil — the reliability improvements and automation that are not getting built because the team is doing manual work instead. This is the ROI argument that makes automation investment legible to engineering leadership.

---

## 3. Monitoring and Observability

SRE monitoring philosophy differs from traditional infrastructure monitoring in one foundational way: it starts with user experience and works backward to the infrastructure, rather than starting with infrastructure metrics and hoping they correlate with user experience.

### The Four Golden Signals

Google's SRE book defines four signals that, if monitored for any service, give a comprehensive picture of service health. These are the four golden signals: latency, traffic, errors, and saturation.

**Latency** is the time it takes to service a request. The critical distinction is between the latency of successful requests and the latency of failed requests. A service that fails fast may show artificially good latency numbers if failed requests are excluded from the measurement. Both must be tracked. Latency should be measured at high percentiles — p95 and p99 — not just as a mean or median, because the mean hides the tail experience that affects the worst-served users most severely.

**Traffic** is the demand being placed on the system, measured in a unit appropriate for the service type. For a web API, traffic is requests per second. For a streaming system, it is messages per second or bytes per second. Traffic provides context for all other signals — an elevated error rate at 100 requests per second is a different situation from the same error rate at 10,000 requests per second.

**Errors** is the rate of requests that fail, defined explicitly. The definition of failure must be precise: an HTTP 500 is clearly a failure; an HTTP 200 with an error payload may also be a failure depending on the service contract; a successful response that exceeds the SLO latency threshold is arguably a failure from the user's perspective. Different types of errors may warrant different alert thresholds and different response procedures.

**Saturation** is how full the service is — the degree to which a constrained resource is being used relative to its capacity. Saturation is particularly important as a leading indicator: a service at 90% CPU utilization is not yet failing, but it is approaching a condition where small increases in traffic will produce failures. Saturation metrics predict failures before they occur, which is why they are a critical complement to the reactive signals of latency and errors.

| Signal | What It Measures | Key Consideration |
| :--- | :--- | :--- |
| Latency | Time to service a request | Track separately for success and failure; use high percentiles |
| Traffic | Volume of demand on the service | Provides context for all other signals |
| Errors | Rate of failed requests | Define "failure" explicitly, including partial failures |
| Saturation | Proximity to resource limits | Leading indicator — predicts problems before users feel them |

### Symptom-Based vs. Cause-Based Alerting

Traditional monitoring alerts on infrastructure causes: CPU above 80%, disk usage above 90%, memory usage above 70%. SRE monitoring alerts on user-facing symptoms: error rate above 1%, p99 latency above 500ms, availability below 99.9%. The distinction determines whether an alert represents a problem users are experiencing or a potential problem that may or may not manifest in user experience.

A CPU spike to 95% that resolves in 10 seconds without affecting request latency or error rate is not worth waking an engineer for. The same spike that causes p99 latency to jump to 2 seconds is. Cause-based alerting wakes engineers for the former; symptom-based alerting wakes them only for the latter.

The practical implication is alert design: primary page-worthy alerts should be expressed in terms of the four golden signals and the SLO. Secondary alerts on infrastructure metrics — CPU, memory, disk — should inform diagnosis once an engineer is already investigating a symptom-level alert. They should not be the trigger for waking someone up unless they directly predict an imminent symptom-level failure.

### Alerting on SLO Burn Rate

The highest-signal alert design in SRE monitoring is alerting on error budget burn rate rather than on instantaneous metric thresholds. A burn rate alert fires when the rate of budget consumption over a short window indicates that the full budget will be exhausted within a defined time horizon, even if the current instantaneous error rate is within the SLO.

Google's recommended multi-window alerting approach uses two lookback windows for each alert: a short window to detect rapidly accelerating problems, and a long window to detect slow, sustained degradations. An alert fires only when both windows show elevated burn rate, reducing false positives caused by short traffic anomalies.

| Alert Tier | Burn Rate | Short Window | Long Window | Time to Budget Exhaustion | Response |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Page (critical) | 14.4x | 5 minutes | 1 hour | ~2 hours | Immediate on-call response |
| Page (high) | 6x | 30 minutes | 6 hours | ~5 hours | On-call response within 30 minutes |
| Ticket (medium) | 3x | 6 hours | 3 days | ~10 days | Investigate within one day |
| Ticket (low) | 1x | — | 7 days | At window end | Review in weekly reliability meeting |

---

## 4. Incident Management

An incident is any event that disrupts or degrades a production service in a way that affects users. The SRE approach to incident management is structured and deliberate — the chaos of a production failure is not the time to improvise roles, communication channels, and escalation paths.

### Severity Classification

Every organization needs an explicit severity taxonomy that defines what constitutes a Sev1 versus a Sev2 versus a Sev3. Without explicit definitions, severity assignment becomes subjective and inconsistent — which means response urgency becomes inconsistent, and on-call engineers cannot calibrate how aggressively to escalate.

| Severity | User Impact | Response SLA | Examples |
| :--- | :--- | :--- | :--- |
| **Sev1 (Critical)** | Complete service outage or severe data loss affecting all or most users | Immediate, all-hands | Payment system down, data corruption, security breach |
| **Sev2 (High)** | Major feature unavailable or significant performance degradation for a large user subset | Within 30 minutes | Checkout failing for 20% of users, API latency 5x baseline |
| **Sev3 (Medium)** | Minor feature degraded, workaround available, small user subset affected | Within 2 hours | Single-region slowness, non-critical feature broken |
| **Sev4 (Low)** | Cosmetic issue, no user impact, or known and accepted degradation | Next business day | UI rendering issue, minor logging errors |

### The Incident Command Structure

Google's incident management model assigns explicit roles to prevent the chaos of everyone trying to do everything simultaneously during a high-pressure event. The three critical roles are the Incident Commander, the Communications Lead, and the Operations Lead.

The **Incident Commander (IC)** owns the incident. They are not necessarily the most technically expert person in the room — they are the person responsible for organizing the response, assigning work, making escalation decisions, and declaring resolution. The IC delegates all technical investigation and remediation to others. Their job is coordination, not hands-on-keyboard work. An IC who is simultaneously debugging the problem and commanding the incident is doing neither well.

The **Communications Lead** is responsible for all stakeholder communication: status page updates, executive notifications, customer-facing messages, and internal incident updates. Separating communication from technical response prevents the technical responders from being interrupted by status requests every ten minutes.

The **Operations Lead** is the technical responder — the engineer with hands on keyboard, implementing remediations, running diagnostic commands, and reporting findings back to the IC. In a large incident, there may be multiple operations leads, each responsible for a different system component.

### The Incident Lifecycle

A well-managed incident moves through four phases, each with distinct goals and actions.

**Detection and Triage** begins when an alert fires or a user report arrives. The on-call engineer acknowledges the alert, assesses the scope and severity, declares an incident at the appropriate severity level, and convenes the response team if the severity warrants it. Speed in this phase determines whether a brief degradation becomes a customer-visible outage.

**Investigation and Diagnosis** is the technical work of understanding what is wrong. The operations lead examines logs, metrics, and traces. They form and test hypotheses. The IC manages the pace — ensuring the team does not get stuck down a single diagnostic path when evidence is inconclusive, and that mitigation attempts are tracked clearly.

**Mitigation and Remediation** covers the actions taken to restore service. Mitigation is any action that reduces user impact without permanently fixing the root cause — a rollback, a traffic reroute, a feature flag disable. Remediation is the permanent fix. Mitigation should almost always come before remediation during an active incident. Restoring service quickly matters more than understanding the root cause in the moment.

**Resolution and Closure** begins when service is restored to normal levels. The IC declares resolution, the communications lead sends the all-clear notification, and the team documents the incident timeline before context is lost. A postmortem is scheduled within 24 to 48 hours of resolution for Sev1 and Sev2 incidents.

| Phase | Goal | IC Action | Ops Lead Action |
| :--- | :--- | :--- | :--- |
| Detection & Triage | Understand scope and severity | Declare incident, convene team | Assess blast radius, identify affected components |
| Investigation & Diagnosis | Find root cause | Keep team focused, prevent rabbit holes | Examine logs, metrics, traces; form hypotheses |
| Mitigation & Remediation | Restore service | Authorize mitigation attempts | Execute rollback, flag disable, traffic reroute |
| Resolution & Closure | Confirm recovery and capture timeline | Declare resolution, schedule postmortem | Document timeline while context is fresh |

---

## 5. Postmortems

The blameless postmortem is the mechanism by which the SRE model converts production failures from purely negative events into organizational learning. Google's SRE book treats the postmortem as one of the most important reliability practices — not because it prevents individual incidents, but because it builds the institutional knowledge and cultural habits that reduce the frequency and severity of future incidents over time.

### The Blameless Philosophy

Blameless postmortems rest on a foundational assumption: when a reasonably skilled engineer, working with the tools and information they had access to at the time, takes an action that causes an incident, the root cause is the system that put that engineer in a position where that action was possible — not the engineer themselves.

This is not a philosophical position about human nature — it is a practical observation about systems safety. Finding a human to blame for an incident produces one outcome: the blamed human feels bad. It does not fix the system. It does not prevent the next engineer from being put in the same position and making the same choice. It does not produce the vulnerability analysis and systemic fixes that actually improve reliability.

Blameless postmortems produce different outcomes. By focusing on system conditions rather than human errors, they surface the design flaws, missing safeguards, inadequate monitoring, and documentation gaps that made the incident possible. Fixing those produces lasting reliability improvement.

### The Anatomy of a Good Postmortem

A well-structured postmortem document has six components, each serving a specific function in the learning process.

The **incident summary** provides context: when the incident started and ended, what its user impact was, and its severity classification. This section is one paragraph — enough for a reader to understand the scope without reading the full document.

The **timeline** is a factual, chronological record of events: when the problem started, when it was detected, when each diagnostic step was taken, when mitigations were applied, and when service was restored. The timeline is not an analysis — it is evidence. It should be written as close to the incident as possible, before memory degrades.

The **root cause analysis** explains why the incident happened. Google's SRE book strongly recommends the "five whys" technique as a starting point — repeatedly asking why an event occurred until reaching a root cause that, if addressed, would prevent recurrence. The five whys technique surfaces the distinction between symptoms (the service failed), immediate causes (a memory leak caused OOM), and root causes (the memory leak was introduced because integration tests do not cover the code path under production load patterns).

The **impact assessment** quantifies what the incident cost: duration of user impact, estimated number of affected users, SLO budget consumed, and any business metrics affected. This section connects the technical incident to the business consequences and provides data for prioritizing remediation.

The **action items** section is the most important part of the document operationally. Each action item must have an owner, a severity, and a deadline. A postmortem without action items is a chronicle, not an improvement mechanism. Action items that are not tracked to completion defeat the purpose of the postmortem entirely.

The **lessons learned** section captures the insights from the incident that are not specific to a single action item: patterns that appear across multiple incidents, assumptions that were revealed as incorrect, architectural decisions that contributed to the failure mode. This section is what makes postmortems a long-term learning resource, not just a point-in-time record.

### Postmortem Failure Modes

Postmortem culture fails in predictable ways. The most common failure is blame creeping back into ostensibly blameless postmortems — through language that assigns intent ("the engineer forgot to," "the developer carelessly"), through a focus on who made a decision rather than what conditions made that decision understandable, or through organizational dynamics where junior engineers are implicitly held responsible for incidents that senior engineers or architects contributed to.

A second failure mode is postmortem theater — documents produced to satisfy a process requirement, reviewed once, and never acted on. The action items section is never completed; the lessons learned section is never referenced. The postmortem exists as evidence that the organization follows a process, not as a genuine learning mechanism. Detecting this requires tracking postmortem action item completion rates over time.

The third failure mode is postmortem avoidance — a culture where engineers are reluctant to declare incidents or write postmortems because they associate the process with blame or career consequences, even when the organization claims to be blameless. The solution is leadership behavior: senior engineers and managers who publicly own their incidents, write candid postmortems about their own mistakes, and treat incident involvement as evidence of learning rather than failure.

| Failure Mode | Symptom | Root Cause | Fix |
| :--- | :--- | :--- | :--- |
| Blame creep | Language assigns intent; junior engineers own postmortems disproportionately | Organizational dynamics override stated culture | Senior engineers model blameless writing publicly |
| Postmortem theater | Action items never closed; documents not referenced after filing | No tracking mechanism; no accountability | Integrate action items into ticket tracker; review in weekly reliability meeting |
| Postmortem avoidance | Incidents handled informally; low postmortem count relative to incident count | Fear of blame despite stated blamelessness | Leadership owns their own postmortems visibly |
