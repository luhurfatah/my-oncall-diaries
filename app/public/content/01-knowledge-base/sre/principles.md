# SRE — What and Why

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [What SRE Is — and What It Is Not](#1-what-sre-is-and-what-it-is-not) | The origin at Google, the core thesis, and how SRE differs from traditional Ops, DevOps, and Platform Engineering. |
| **02** | [The SRE Reliability Stack](#2-the-sre-reliability-stack) | Service Level Indicators, Objectives, and Agreements as a layered system of reliability measurement and commitment. |
| **03** | [Error Budgets](#3-error-budgets) | How error budgets operationalize the trade-off between reliability and feature velocity, and what it means to spend or exhaust one. |

---

## 1. What SRE Is — and What It Is Not

Site Reliability Engineering was invented at Google in 2003 when Ben Treynor Sloss was asked to lead a team responsible for running Google's production systems. His answer to the question of how to staff and run the team became the definition of the discipline: hire software engineers and ask them to solve operational problems the way a software engineer would — with code, automation, and systems thinking rather than manual procedures, heroic effort, and institutional knowledge locked in individuals.

The canonical SRE definition from the Google SRE book is precise: SRE is what happens when you ask a software engineer to design an operations function. The implication is significant. An operations function designed by a software engineer looks radically different from one designed by a traditional systems administrator. It prioritizes automation over manual work, measurement over intuition, learning systems over blame cultures, and sustainable operations over perpetual firefighting.

### The Core Thesis

The Google SRE model rests on a single foundational insight: reliability is a feature, and like all features it must be designed, built, measured, and traded off against other features. Reliability is not a property that a system has or lacks in some binary sense — it is a continuous variable that can be precisely measured, targeted at a specific level appropriate for the product and its users, and managed against a budget of allowed unreliability.

This framing is what distinguishes SRE from traditional operations philosophy. Traditional ops treats reliability as a goal to maximize — more uptime is always better, every outage is a failure. SRE treats reliability as a parameter to optimize — the right level of reliability for a given service is the level that serves users without over-investing in reliability they do not notice or need. A service at 99.999% availability when users cannot perceive the difference from 99.9% has over-invested in reliability at the cost of feature velocity.

### What Produced SRE at Google

The conditions at Google in 2003 that produced SRE are worth understanding because they explain why the model takes the shape it does. Google was growing faster than any traditional operations model could scale. Hiring one operator per N servers was not economically viable at Google's growth rate. The only scalable answer was to make the systems easier to operate — not by hiring more operators, but by investing in software that eliminated the need for operator intervention. This is the origin of the automation imperative that runs through all of SRE practice: the goal is never to hire your way out of operational complexity, but to engineer your way out of it.

### What SRE Is Not

SRE is not a job title applied to everyone doing operations work. Calling a team "SRE" without changing how they work — without the software engineering mandate, the error budget model, the operational load limits, and the expectation that they will automate away their own toil — produces a renamed ops team, not an SRE team.

SRE is not a synonym for DevOps, though the two share philosophical roots. DevOps is a cultural model for breaking down silos between development and operations. SRE is a specific implementation of that culture with concrete practices, metrics, and organizational structures. Google itself describes SRE as "a specific way to implement DevOps with some opinionated extensions."

SRE is not appropriate for every service or every organization. The full SRE model — dedicated SRE teams, error budgets, production readiness reviews — is designed for large-scale systems where reliability failures have significant user and business impact and where the operational complexity justifies the investment. A small team running a single internal service at moderate scale does not need a full SRE team; they need SRE practices applied proportionally.

---

## 2. The SRE Reliability Stack

The SRE approach to measuring and managing reliability operates through three layers of abstraction: Service Level Indicators, Service Level Objectives, and Service Level Agreements. These three concepts are often conflated or used interchangeably in practice, which produces poorly specified reliability targets and broken expectations between engineering and stakeholders. Understanding each precisely is the prerequisite for building a functioning reliability measurement system.

### Service Level Indicators

A Service Level Indicator (SLI) is a quantitative measure of some aspect of the level of service provided. It is a ratio: the number of good events divided by the total number of events, expressed as a percentage. The definition of "good" is what makes an SLI meaningful — it must be defined from the user's perspective, not from the infrastructure's perspective.

The canonical SLI formula is: **SLI = (count of good events / count of total events) × 100**

A good event is one that satisfies the user's expectation of correct, fast, and available service. For a request-based system, a good event is a request that returns a successful response within an acceptable latency threshold. For a data pipeline, a good event is a batch that completes within its deadline. For a storage system, a good event is a read that returns the correct, current data.

The selection of SLIs is the most consequential design decision in the reliability stack. An SLI that does not track what users actually experience is not measuring reliability — it is measuring a proxy that may or may not correlate with user experience. CPU utilization is not an SLI. Memory usage is not an SLI. Request success rate, request latency at the 99th percentile, and data freshness are SLIs.

### Choosing the Right SLIs

Good SLIs share three properties. They are measurable with the instrumentation that already exists or can be added without restructuring the system. They are meaningful — they track something users actually care about, not something that is easy to measure. And they are proportional — small changes in the SLI value correspond to meaningful changes in user experience.

| Service Type | Appropriate SLIs | Poor SLI Choices |
| :--- | :--- | :--- |
| Web API | Request success rate, p99 latency, availability | Server CPU %, memory usage |
| Data pipeline | Freshness (age of most recent data), completeness (% records processed) | Pipeline job duration |
| Storage system | Durability (data not lost), read success rate, write success rate | Disk I/O throughput |
| Batch job | Completion rate (% jobs completing before deadline) | Job queue depth |
| Streaming system | Consumer lag, message delivery success rate | Broker partition count |

### Service Level Objectives

A Service Level Objective (SLO) is a target value or range for an SLI, over a specified time window. It is the internal reliability commitment — the level of service the SRE team and the product team agree the service should achieve. An SLO is not a promise to users; it is a target that, if met, should produce an acceptable user experience.

The anatomy of a well-formed SLO is: `[SLI] >= [target] over [window]`.

- "99.9% of requests to the payments API will succeed over a rolling 28-day window."
- "99th percentile latency for checkout page loads will be below 800ms over a rolling 28-day window."
- "Data in the recommendations pipeline will be no more than 4 hours stale, measured over a rolling 7-day window."

The time window is as important as the target. A 28-day rolling window produces more stable, actionable data than a calendar month window, which creates artificial discontinuities at month boundaries. The window must be long enough to smooth out normal traffic variation but short enough that a sustained reliability problem produces a meaningful signal within a useful timeframe.

### Setting SLO Targets

The most common SLO design mistake is setting the target too high — at 99.99% or above — without evidence that users need or notice that level of reliability. Setting an ambitious SLO is not aspirational; it is operationally expensive. Every additional nine of reliability requires disproportionately more engineering investment. The correct SLO target is the level of reliability below which users begin to notice and complain, plus a small margin of safety.

Google's practical guidance on SLO target selection follows a deliberate process. Start by measuring actual current performance. If the current SLI is 99.7%, do not set an SLO of 99.99% — set it at 99.5% to establish a baseline, then improve incrementally as the system matures. The SLO target should be achievable with the current system and engineering capacity, then raised as reliability investments pay off.

A second critical principle is that the SLO should be set lower than the maximum technically achievable reliability, intentionally. If the system routinely achieves 99.98% and the SLO is 99.95%, there is a meaningful error budget to spend on feature velocity. If the SLO is set at 99.98% to match current performance, any incident immediately threatens it, engineers become defensive about all changes, and the error budget model breaks down.

### Service Level Agreements

A Service Level Agreement (SLA) is an external commitment to users or customers, with defined consequences if the commitment is not met. The consequences are typically financial — service credits, refunds, or contract penalties — but may also include reputational or legal dimensions.

The relationship between SLOs and SLAs is asymmetric by design. The SLO should always be more stringent than the SLA. If the SLA commits to 99.9% availability, the internal SLO should target 99.95% or higher. This buffer provides the SRE team time to detect and respond to a reliability degradation before it breaches the externally-committed SLA. If the SLO is breached but the SLA is not, the team has time to remediate without triggering customer consequences. If the SLO equals the SLA, every SLO breach is an SLA breach.

| Concept | Defined By | Audience | Consequence of Breach |
| :--- | :--- | :--- | :--- |
| SLI | Engineering (measurement) | Internal | No direct consequence — it is a measurement |
| SLO | Engineering + Product | Internal | Error budget consumed, velocity may be restricted |
| SLA | Business + Legal | External (customers) | Financial penalty, contract consequences, churn |

---

## 3. Error Budgets

The error budget is the single most powerful concept in SRE because it converts the abstract goal of "reliability" into a concrete, quantitative resource that can be managed, spent, and tracked like money. It is the mechanism that operationalizes the trade-off between reliability and feature velocity.

### What an Error Budget Is

An error budget is the maximum amount of unreliability a service is allowed to have while still meeting its SLO, expressed as a fraction of time or a count of bad events over the SLO window.

If the SLO is 99.9% request success rate over 28 days, the error budget is the complement: 0.1% of requests are allowed to fail. In a system processing 1 million requests per day, the error budget is 1,000 failed requests per day, or 28,000 failed requests over the 28-day window. When incidents occur and requests fail, they consume the error budget. When no incidents occur, the budget accumulates.

The error budget has two states: remaining and exhausted. When remaining, the team has permission to move fast — deploy frequently, take risks with new features, run experiments. When exhausted, the team's reliability contract with users has been violated, and the appropriate response is to freeze feature releases and direct engineering effort toward reliability improvements.

### The Error Budget Policy

The error budget policy is the document that specifies what the team does when the budget reaches specific thresholds. Without an explicit policy, error budget management becomes ad hoc and the concept loses its operational value. The policy must be agreed upon by the SRE team, the product team, and engineering leadership before it is needed — not negotiated during an incident.

A standard error budget policy has three thresholds. When more than 50% of the budget remains with more than half the window left, the team operates normally — feature releases proceed, new experiments are allowed, and the SRE team focuses on automation and proactive reliability work. When the budget is between 25% and 50% consumed ahead of pace, the team increases scrutiny — change review cadence increases, risky deployments require additional testing. When the budget is exhausted or within 10% of exhaustion, the team implements a feature freeze — no new features or risky changes are released until reliability is restored.

```python
def calculate_error_budget(slo_target_pct: float,
                           window_days: int,
                           total_requests: int,
                           failed_requests: int) -> dict:
    """
    Calculate error budget remaining for a request-based SLO.
    """
    allowed_failure_rate = 1.0 - (slo_target_pct / 100.0)
    budget_total_requests = int(total_requests * allowed_failure_rate)
    budget_remaining_requests = budget_total_requests - failed_requests
    budget_consumed_pct = (failed_requests / budget_total_requests * 100
                           if budget_total_requests > 0 else 0)

    current_sli = ((total_requests - failed_requests) / total_requests * 100
                   if total_requests > 0 else 100)

    return {
        'slo_target_pct': slo_target_pct,
        'current_sli_pct': round(current_sli, 4),
        'budget_total_failed_allowed': budget_total_requests,
        'budget_consumed_failed': failed_requests,
        'budget_remaining_failed': max(budget_remaining_requests, 0),
        'budget_consumed_pct': round(budget_consumed_pct, 1),
        'budget_exhausted': failed_requests > budget_total_requests,
        'policy_threshold': (
            'freeze' if budget_consumed_pct >= 90 else
            'scrutiny' if budget_consumed_pct >= 50 else
            'normal'
        ),
    }
```

### Why Error Budgets Change the Conversation

Before error budgets, the conversation between SRE and product development about production risk was adversarial. SRE wanted fewer changes because every change was a potential failure. Product wanted more changes because that was how they delivered value. Neither side had a shared, quantitative framework for navigating the tension.

Error budgets create a shared language. The question is no longer "is it safe to deploy?" — a question with no objective answer — but "how much of our error budget will this deployment risk consuming?" If the budget is healthy and the change is well-tested, the answer is easy. If the budget is nearly exhausted and the change is risky, the policy provides the answer: not yet. The SRE team is not the change police; the policy is.

### Error Budget Burn Rate

A key concept for managing error budgets in real time is the burn rate — how fast the budget is being consumed relative to how fast it should be consumed if failures were distributed evenly across the window. A burn rate of 1.0 means the budget is being consumed at exactly the pace that would exhaust it at the end of the window. A burn rate of 10.0 means the budget is being consumed 10 times faster than that pace — an ongoing incident that, if unaddressed, will exhaust the month's budget in three days.

Alerting on burn rate rather than on instantaneous SLI value produces much more actionable signals. An SLI that dips to 99.7% for 5 minutes during a traffic spike may not require waking anyone up. The same SLI at 99.7% sustained for 3 hours represents a significant budget burn that requires response. Burn-rate-based alerting captures this distinction; threshold-based alerting does not.

```python
def calculate_burn_rate(budget_consumed_pct: float,
                        window_days: int,
                        elapsed_days: float) -> float:
    """
    Burn rate > 1.0 means budget is being consumed faster than the window allows.
    Burn rate of 14.4 exhausts a monthly budget in ~2 hours — critical incident level.
    """
    expected_consumption_pct = (elapsed_days / window_days) * 100
    if expected_consumption_pct == 0:
        return 0.0
    return round(budget_consumed_pct / expected_consumption_pct, 2)
```