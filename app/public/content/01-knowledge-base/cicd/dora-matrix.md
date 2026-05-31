# DORA Metrics — Measuring Software Delivery Performance

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [What DORA Is and Why It Matters](#1-what-dora-is-and-why-it-matters) | The research origin, the elite vs. low performer gap, and why these four metrics and not others. |
| **02** | [Deployment Frequency](#2-deployment-frequency) | What counts as a deployment, how to measure it, and what low frequency actually indicates. |
| **03** | [Lead Time for Changes](#3-lead-time-for-changes) | The precise definition, where time actually goes in most pipelines, and how to reduce it. |
| **04** | [Change Failure Rate](#4-change-failure-rate) | What constitutes a failure, how to measure it without gaming, and its relationship to deployment frequency. |
| **05** | [Time to Restore Service](#5-time-to-restore-service) | MTTR definition, the incident lifecycle, and why fast restore is a better goal than zero failures. |
| **06** | [Performance Benchmarks](#6-performance-benchmarks) | The four performance tiers — Elite, High, Medium, Low — with thresholds for each metric. |
| **07** | [Measurement Implementation](#7-measurement-implementation) | Data sources, pipeline instrumentation, dashboards, and the metrics collection architecture. |
| **08** | [The Interplay Between Metrics](#8-the-interplay-between-metrics) | How the four metrics constrain and inform each other, and how to read them as a system. |
| **09** | [Anti-Patterns & Gaming](#9-anti-patterns-gaming) | The most common ways teams inadvertently or deliberately corrupt their DORA data. |
| **10** | [Using DORA to Drive Improvement](#10-using-dora-to-drive-improvement) | How to move from measurement to action, what levers actually move the metrics, and the improvement loop. |

---

## 1. What DORA Is and Why It Matters

DORA — the DevOps Research and Assessment program — began as an independent research initiative in 2014, led by Dr. Nicole Forsgren, Jez Humble, and Gene Kim. It became one of the most rigorous longitudinal studies in software engineering: six years of survey data from tens of thousands of practitioners across thousands of organizations, analyzed with academic-grade statistical methods to identify which engineering practices actually predict organizational outcomes — not just productivity by feel, but business outcomes including profitability, market share, and the ability to exceed customer satisfaction goals.

The research produced a central finding that is counterintuitive to the intuition many engineering leaders carry: throughput and stability are not a trade-off. The teams that deploy most frequently also have the lowest failure rates and the fastest recovery times. Speed and reliability reinforce each other when the underlying engineering practices are sound. The teams that deploy infrequently to "reduce risk" consistently have higher failure rates and longer recovery times — because their infrequent deployments are large, their systems are less practiced at the mechanics of deployment, and their engineers have less real feedback about production behavior.

From this research emerged four specific metrics — now called the DORA metrics — that together characterize software delivery performance with the highest predictive validity for organizational outcomes. They are not arbitrary KPIs chosen for convenience. They are the variables that the research identified as causally linked to business performance, rather than merely correlated with it.

### The Four Metrics

The four metrics split cleanly into two dimensions. Deployment Frequency and Lead Time for Changes measure **throughput** — how fast the team delivers software. Change Failure Rate and Time to Restore Service measure **stability** — how reliably the software behaves in production. A healthy delivery system scores well on both dimensions simultaneously. A team that is fast but unstable, or stable but slow, is suboptimal in ways that the metrics make visible.

### The Elite Performer Gap

The gap between elite and low-performing organizations in the DORA research is not marginal — it is measured in orders of magnitude. Elite performers deploy 973 times more frequently than low performers. They have lead times measured in hours versus months. Their change failure rate is half that of low performers despite deploying hundreds of times more often. This gap is not explained by team size, industry, or technology stack. It is explained by engineering practices: automated testing, trunk-based development, continuous integration, loosely-coupled architecture, and a culture of learning from failure.

---

## 2. Deployment Frequency

Deployment Frequency measures how often an organization successfully deploys code to production. It is the most visible of the four metrics and the one most commonly misunderstood.

### Precise Definition

A deployment is any push of new code or configuration to the production environment that reaches real users. The definition is intentionally narrow on one axis and broad on another. It is narrow in that it counts only production deployments — not deployments to dev or staging. It is broad in that it counts any change: a feature, a bug fix, a configuration update, a dependency bump, a database migration. Every change that reaches production is a deployment.

The metric answers the question: how often does working software get into the hands of users?

### What Counts and What Does Not

Staging deployments, feature branch builds, and test environment releases do not count toward Deployment Frequency. They are a means to an end, not the end itself. A team that deploys to staging twenty times a day but promotes to production once a month has a monthly Deployment Frequency, regardless of the internal pipeline activity.

Partial rollouts — canary deployments, blue-green switches, feature flag activations — do count if they result in new code or configuration reaching a subset of real users. A canary to 5% of production traffic is a production deployment. A feature flag flip that activates a dormant code path for 100% of users is a production deployment. The question is always whether real users experience the change.

### What Low Frequency Actually Indicates

Low Deployment Frequency is almost never a policy decision made for sound technical reasons. It is almost always a symptom of one or more underlying problems: a slow, fragile CI pipeline that makes deploying painful; a manual deployment process requiring multiple approvals and coordination; a large, tangled codebase where every change risks breaking unrelated functionality; a culture where deployments are treated as high-risk events requiring special ceremony.

Each of these underlying problems is worth fixing on its own merits. Deployment Frequency is useful as a diagnostic signal — a low number tells you there is friction in the delivery path, and the job is to find and remove the friction, not to set a higher frequency target and find ways to hit it numerically.

### Measurement

Deployment Frequency is measured by counting production deployments over a time window, typically reported as deployments per day, per week, or per month depending on the team's current cadence.

```python
# Example: query deployments from a CI/CD system event log
import boto3
from datetime import datetime, timedelta

def get_deployment_frequency(service_name: str, days: int = 30) -> dict:
    """
    Query CloudWatch custom metrics or a deployment events DynamoDB table
    to calculate deployment frequency for a service over the past N days.
    """
    client = boto3.client('cloudwatch')

    response = client.get_metric_statistics(
        Namespace='DORA/Deployments',
        MetricName='DeploymentCount',
        Dimensions=[{'Name': 'Service', 'Value': service_name}],
        StartTime=datetime.utcnow() - timedelta(days=days),
        EndTime=datetime.utcnow(),
        Period=86400,       # Daily granularity
        Statistics=['Sum']
    )

    datapoints = response['Datapoints']
    total_deployments = sum(dp['Sum'] for dp in datapoints)
    days_with_deployments = len([dp for dp in datapoints if dp['Sum'] > 0])

    return {
        'service': service_name,
        'period_days': days,
        'total_deployments': int(total_deployments),
        'deployments_per_day': round(total_deployments / days, 2),
        'days_with_at_least_one_deployment': days_with_deployments,
    }
```

The event that triggers metric emission should be the moment a deployment reaches production and passes its initial health check — not the moment the CI pipeline starts, not the moment the image is built. A deployment that is rolled back immediately is still a deployment and should be counted. The rollback itself may or may not be counted depending on whether you treat it as a separate deployment — the key is to be consistent.

---

## 3. Lead Time for Changes

Lead Time for Changes measures the time elapsed between a developer committing a code change and that change running in production. It is the end-to-end throughput metric for the delivery pipeline.

### Precise Definition

The DORA definition of lead time is specific: it begins at the **first commit** of the change to the shared repository (not when a pull request is opened, not when a ticket is created, not when the feature is conceived) and ends when that **commit is deployed and running in production**. The clock starts with the first `git commit` that contains the change and stops when production health checks confirm the deployment.

This definition is important to hold precisely because different organizations measure different things and call them all "lead time." Measuring from ticket creation to production deployment conflates lead time with planning cycle time. Measuring from pull request open to deployment conflates it with review time. The DORA metric is specifically about code-to-production — the technical delivery pipeline.

### Where Time Actually Goes

In most organizations, the raw pipeline execution time — the time the CI system is actively doing work — is a small fraction of total lead time. The majority of elapsed time accumulates in queues: code waiting for review, a reviewed PR waiting to be merged, a merged commit waiting in a deployment queue, a deployment waiting for a manual approval gate.

Understanding this is critical for improvement. A team that reduces their CI build time from 20 minutes to 10 minutes while leaving a 3-day pull request review queue untouched has achieved a 0.2% reduction in lead time. The same effort spent on improving review culture, reducing PR size, or removing a manual deployment gate would have an order-of-magnitude greater impact.

| Phase | Typical Duration | Primary Lever |
| :--- | :--- | :--- |
| Coding (commit to PR open) | Hours to days | PR size, feature flag usage, trunk-based development |
| Review (PR open to merge) | Hours to days | Review culture, PR size, number of required approvals |
| CI pipeline execution | Minutes to hours | Test suite speed, parallelization, caching |
| Deployment queue wait | Minutes to hours | Pipeline concurrency, release train frequency |
| Manual approval gates | Hours to days | Automated quality gates replacing manual checks |
| Environment health check | Minutes | Health check timeout configuration |

### Reducing Lead Time

The highest-leverage interventions for reducing lead time, in rough order of impact, are:

Reducing pull request size is consistently the single most impactful change. A PR with 50 lines of change takes minutes to review. A PR with 1,500 lines takes days, generates long comment threads, and often sits in review limbo while the author context-switches to other work. Trunk-based development with feature flags enables developers to merge small incremental changes continuously rather than accumulating work in long-lived feature branches.

Removing manual approval gates replaces human sign-off steps with automated quality gates. A manual "QA approval" that fires before every production deployment adds days to lead time and provides weak safety guarantees compared to a comprehensive automated test suite that fires in minutes. The automation does not eliminate the judgment — it moves the judgment to the point of writing the test, not the point of deployment.

Parallelizing the CI pipeline runs test suites, security scans, and build steps concurrently rather than sequentially. A pipeline with four sequential 10-minute stages has a 40-minute lead time contribution. The same four stages running in parallel contribute 10 minutes.

### Measurement

```python
def calculate_lead_time(commit_sha: str, deployment_timestamp: datetime,
                        git_log: list) -> dict:
    """
    Calculate lead time for a deployment.
    commit_sha: the SHA of the first commit in this deployment batch
    deployment_timestamp: when the deployment reached production health check passing
    git_log: list of commits included in this deployment
    """
    first_commit = min(git_log, key=lambda c: c['timestamp'])
    first_commit_time = datetime.fromisoformat(first_commit['timestamp'])

    lead_time_seconds = (deployment_timestamp - first_commit_time).total_seconds()
    lead_time_hours = lead_time_seconds / 3600

    return {
        'deployment_sha': commit_sha,
        'first_commit_sha': first_commit['sha'],
        'first_commit_author': first_commit['author'],
        'lead_time_hours': round(lead_time_hours, 2),
        'lead_time_human': format_duration(lead_time_seconds),
        'commits_in_batch': len(git_log),
    }
```

Lead time should be reported as a median (p50) and a high percentile (p90 or p95), not a mean. A single extremely large change or an emergency hotfix can skew the mean significantly. The median tells you what a typical change experiences. The p90 tells you what the tail looks like — and tail lead time is often where the real pain lives.

---

## 4. Change Failure Rate

Change Failure Rate (CFR) measures the percentage of deployments to production that result in a degraded service requiring remediation — a hotfix, a rollback, or a patch. It is the primary stability metric and the one most directly connected to service reliability.

### Precise Definition

A deployment is counted as a failure if it causes a production incident that requires intervention beyond the normal deployment process. This includes service outages, elevated error rates, data corruption, performance degradation severe enough to impact users, and security incidents caused by a deployed change. It does not include pre-existing issues unrelated to the deployment.

The denominator is total production deployments. The numerator is deployments that resulted in a failure requiring remediation. The result is expressed as a percentage.

### What Constitutes a Failure

The definition of failure must be established clearly and applied consistently, because CFR is the metric most susceptible to interpretation drift. Teams under pressure to show low CFR have strong incentives to reclassify failures as "not caused by the deployment" or to handle incidents informally without creating tickets that would count toward the numerator.

A failure is any production event where an engineer had to take corrective action in response to a change. The action taken — rollback, hotfix, configuration revert, feature flag disable — is what marks the event as a failure, regardless of the root cause debate. If someone had to fix it because of a change, it counts.

Events that do not count: planned maintenance, infrastructure failures unrelated to recent changes, external dependency outages with no mitigating action available, and pre-existing bugs that existed before the deployment window.

### The Paradox of High Frequency and Low Failure Rate

The counterintuitive DORA finding is that elite teams — who deploy most frequently — also have the lowest Change Failure Rate. This seems impossible if you believe that more deployments equals more risk. The explanation is that elite teams have smaller deployments. A deployment containing 20 lines of change in a single function is easier to test, easier to review, easier to roll back, and much easier to understand when it fails. A deployment containing 3,000 lines across 40 files is a complexity bomb in production.

Teams with low Deployment Frequency accumulate large batches of changes between deployments. Each deployment is a high-risk event precisely because it contains so much change. Their Change Failure Rate is high not despite their caution but because of it — the caution manifests as infrequent large deployments, which are more likely to fail than frequent small ones.

### Measurement

```python
def calculate_change_failure_rate(service_name: str, days: int = 30) -> dict:
    """
    CFR = (deployments causing incidents / total deployments) * 100
    Requires: deployment log and incident log with timestamps and service tags.
    """
    deployments = get_deployments(service_name, days)
    incidents = get_production_incidents(service_name, days)

    failed_deployments = set()

    for incident in incidents:
        # Find the most recent deployment before the incident started
        causal_deployment = find_preceding_deployment(
            deployments=deployments,
            incident_start=incident['started_at'],
            lookback_window_hours=4    # Deployments in the 4 hours before the incident
        )
        if causal_deployment:
            failed_deployments.add(causal_deployment['id'])

    total = len(deployments)
    failures = len(failed_deployments)

    return {
        'service': service_name,
        'period_days': days,
        'total_deployments': total,
        'failed_deployments': failures,
        'change_failure_rate_pct': round((failures / total * 100) if total > 0 else 0, 1),
    }
```

The 4-hour lookback window for linking incidents to deployments is a reasonable default for most services. A change that causes a memory leak may not manifest as an incident until hours after the deployment; a change that breaks an API endpoint manifests within seconds. Calibrate the lookback window to your service's failure mode characteristics.

---

## 5. Time to Restore Service

Time to Restore Service (TTRS), sometimes called Mean Time to Restore (MTTR), measures how long it takes to recover from a production failure. It is the second stability metric and the one most directly connected to user-facing availability.

### Precise Definition

TTRS begins when a production incident starts — defined as the moment the service degradation begins, not the moment an alert fires or an engineer acknowledges the incident. It ends when the service is fully restored to its expected behavior for all affected users.

This definition requires honest incident timestamping. If the monitoring system detects an anomaly at 14:00 and the on-call engineer acknowledges the PagerDuty alert at 14:08, the incident started at 14:00. The 8-minute gap before acknowledgment is part of the incident duration and should not be hidden by starting the clock at acknowledgment time.

### The Incident Lifecycle

Understanding where time goes during an incident is a prerequisite for reducing TTRS. The incident lifecycle has four phases, each with distinct time contributions and distinct levers.

**Detection** is the time between the failure starting and a human or automated system becoming aware of it. Detection time is reduced by better observability — alerts that fire on symptoms users experience (error rate, latency, availability) rather than infrastructure metrics (CPU usage, disk space) that may or may not correlate with user impact. Alert fatigue — too many low-fidelity alerts — increases detection time because engineers learn to ignore pages.

**Diagnosis** is the time between detection and identifying the root cause. Diagnosis time is the most variable phase and the hardest to systematically reduce. It depends on the quality of observability tooling (logs, metrics, traces), the engineer's familiarity with the system, the clarity of runbooks, and whether the change that caused the failure is obvious from the deployment history. Teams with good distributed tracing and structured logging diagnose faster than teams with fragmented, unstructured logs.

**Remediation** is the time between identifying the cause and taking corrective action — rolling back, applying a hotfix, or disabling a feature flag. For deployment-caused incidents, the fastest remediation is almost always a rollback to the previous known-good artifact. Teams that can execute a rollback in 2 minutes have a significantly lower TTRS ceiling than teams whose rollback process takes 20 minutes.

**Verification** is the time between applying the fix and confirming the service is healthy. Automated health checks and dashboards that reset to baseline quickly enable fast verification. Manual verification — watching metrics for 30 minutes to "make sure it's stable" — extends TTRS without adding safety.

| Phase | Time Driver | Primary Lever |
| :--- | :--- | :--- |
| Detection | Alert fidelity, monitoring coverage | Symptom-based alerts, SLO-driven alerting |
| Diagnosis | Observability quality, system familiarity | Structured logs, distributed traces, runbooks |
| Remediation | Rollback speed, fix deployment speed | Fast rollback, feature flags, automated rollback triggers |
| Verification | Health check clarity | Automated health checks, clear SLO dashboards |

### Fast Restore vs. Zero Failures

A common executive instinct is to focus on eliminating failures entirely. DORA research consistently shows this is the wrong optimization. Elite performers do not have zero failures — they have fast restore times. A system that fails twice a month and restores in 4 minutes has better availability than a system that fails once a month and takes 4 hours to restore. The first system's users experience 8 minutes of downtime per month; the second system's users experience 4 hours.

Optimizing for TTRS — through practiced incident response, automated rollback, and fast diagnosis tooling — produces better availability outcomes than optimizing for zero failures through deployment caution, which instead produces low Deployment Frequency and paradoxically higher Change Failure Rate.

### Measurement

```python
def calculate_time_to_restore(incidents: list) -> dict:
    """
    TTRS = time from incident start to service restoration.
    incidents: list of dicts with 'started_at' and 'resolved_at' timestamps.
    """
    durations_minutes = []

    for incident in incidents:
        start = datetime.fromisoformat(incident['started_at'])
        end = datetime.fromisoformat(incident['resolved_at'])
        duration_minutes = (end - start).total_seconds() / 60
        durations_minutes.append(duration_minutes)

    if not durations_minutes:
        return {'incident_count': 0}

    durations_minutes.sort()
    n = len(durations_minutes)

    return {
        'incident_count': n,
        'mttr_minutes_p50': round(durations_minutes[n // 2], 1),
        'mttr_minutes_p90': round(durations_minutes[int(n * 0.9)], 1),
        'mttr_minutes_mean': round(sum(durations_minutes) / n, 1),
        'longest_incident_minutes': round(max(durations_minutes), 1),
    }
```

Report TTRS as both median and p90. The median reflects the typical incident experience. The p90 reflects the tail — the long, painful incidents that dominate user memory and on-call burnout. A team with a 15-minute median TTRS and a 6-hour p90 TTRS has a serious tail problem that the median hides.

---

## 6. Performance Benchmarks

The DORA research categorizes organizations into four performance tiers based on their metric values. These tiers are derived from cluster analysis of the actual survey data, not from arbitrary round numbers. They represent natural groupings in how real organizations perform.

### The Four Tiers

| Metric | Elite | High | Medium | Low |
| :--- | :--- | :--- | :--- | :--- |
| **Deployment Frequency** | On-demand (multiple per day) | Between once per day and once per week | Between once per week and once per month | Between once per month and once per six months |
| **Lead Time for Changes** | Less than one hour | Between one day and one week | Between one week and one month | Between one month and six months |
| **Change Failure Rate** | 0–15% | 0–15% | 0–15% | 46–60% |
| **Time to Restore Service** | Less than one hour | Less than one day | Between one day and one week | Between one week and one month |

The Change Failure Rate thresholds are notable: elite, high, and medium performers all cluster in the 0–15% range. The sharp differentiation is between medium and low performers, not across the top three tiers. This reflects the DORA finding that once teams clear a basic bar of engineering practice, CFR does not continue to improve as Deployment Frequency increases — in fact, elite teams often have slightly higher CFR than medium teams (within the same 0–15% band) because they are moving faster and taking more shots.

### Using the Benchmarks

The tier thresholds are a diagnostic tool, not a target-setting framework. A team discovering they are a Low performer should not set a goal of "deploy daily by Q4" — they should investigate what is making deployment painful and fix the underlying causes. The metric will improve as a consequence.

Comparing across teams within an organization is useful only when the teams have similar system complexity and similar customer-facing risk profiles. Comparing a team maintaining a payments API (where a failure has immediate financial consequences) to a team maintaining an internal reporting dashboard is not informative — they operate under fundamentally different reliability constraints that should produce different deployment patterns.

---

## 7. Measurement Implementation

Reliable DORA measurement requires instrumentation at three data sources: the CI/CD pipeline (for Deployment Frequency and Lead Time), the incident management system (for Change Failure Rate and Time to Restore Service), and the version control system (for the commit timestamps that anchor Lead Time).

### Data Sources

**CI/CD pipeline** is the primary source for Deployment Frequency. Every successful production deployment should emit an event — to a CloudWatch custom metric, a Datadog event, a database row, or a webhook — at the moment the deployment completes and passes health checks. The event payload should include the service name, the environment (`production`), the deployed commit SHA, the deployment timestamp, and the pipeline run ID.

**Version control** provides the commit timestamps that define the start of lead time. The Git commit SHA that triggers a pipeline run, and the timestamp of the first commit in the change batch, are the anchors for Lead Time calculation. GitHub, GitLab, and Bitbucket all expose this data via API or webhook.

**Incident management system** is the source for Change Failure Rate and TTRS. PagerDuty, OpsGenie, and Jira Service Management all provide APIs for querying incidents with timestamps, affected services, and resolution times. The incident data must be linked to deployment data to calculate CFR — the causal link between a deployment and an incident is the critical join.

### Pipeline Instrumentation

```yaml
# GitHub Actions — emit DORA deployment event after successful production deploy
- name: Emit Deployment Metric
  if: success() && github.ref == 'refs/heads/main'
  run: |
    aws cloudwatch put-metric-data \
      --namespace "DORA/Deployments" \
      --metric-name "DeploymentCount" \
      --value 1 \
      --dimensions \
        Service=${{ env.SERVICE_NAME }},\
        Environment=production,\
        CommitSHA=${{ github.sha }} \
      --timestamp $(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Also record lead time: time from first commit to now
    FIRST_COMMIT_TIME=$(git log --reverse --format="%aI" | head -1)
    DEPLOY_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    aws cloudwatch put-metric-data \
      --namespace "DORA/LeadTime" \
      --metric-name "LeadTimeSeconds" \
      --value $(( $(date -d "$DEPLOY_TIME" +%s) - $(date -d "$FIRST_COMMIT_TIME" +%s) )) \
      --dimensions Service=${{ env.SERVICE_NAME }},Environment=production
```

### Incident Linkage

Linking incidents to deployments is the technically hardest part of DORA measurement. The naive approach — any incident within N hours of a deployment is caused by that deployment — has both false positives (incidents caused by infrastructure failures unrelated to the deployment) and false negatives (incidents caused by a deployment that manifest slowly).

A more robust approach uses a combination of automated linkage and human confirmation. Automated linkage flags any incident that starts within the lookback window of a deployment. The incident manager or on-call engineer confirms or denies the link during the post-incident review. This produces higher-quality data than either pure automation or pure manual attribution.

```python
# Webhook receiver: PagerDuty incident resolved → calculate TTRS and check deployment linkage
import json
from datetime import datetime
import boto3

def handle_incident_resolved(event: dict):
    incident = event['incident']
    service_name = incident['service']['name']
    started_at = datetime.fromisoformat(incident['created_at'].replace('Z', '+00:00'))
    resolved_at = datetime.fromisoformat(incident['resolved_at'].replace('Z', '+00:00'))
    duration_minutes = (resolved_at - started_at).total_seconds() / 60

    cw = boto3.client('cloudwatch')

    # Emit TTRS metric
    cw.put_metric_data(
        Namespace='DORA/Incidents',
        MetricData=[{
            'MetricName': 'TimeToRestoreMinutes',
            'Value': duration_minutes,
            'Dimensions': [
                {'Name': 'Service', 'Value': service_name},
                {'Name': 'Severity', 'Value': incident['urgency']},
            ]
        }]
    )

    # Check for deployment linkage
    recent_deployments = get_deployments_before(service_name, started_at, lookback_hours=4)
    if recent_deployments:
        # Flag for human confirmation — do not auto-increment CFR
        flag_for_cfr_review(incident['id'], recent_deployments[0]['id'])
```

### Dashboard Architecture

A DORA dashboard needs to answer three questions at a glance: where are we now, how have we trended, and which services are outliers. The following CloudWatch dashboard structure covers these:

```json
{
  "widgets": [
    {
      "type": "metric",
      "title": "Deployment Frequency — Org-wide (Daily)",
      "properties": {
        "metrics": [["DORA/Deployments", "DeploymentCount", "Environment", "production"]],
        "period": 86400,
        "stat": "Sum",
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "title": "Lead Time for Changes — p50 and p90 (Hours)",
      "properties": {
        "metrics": [
          ["DORA/LeadTime", "LeadTimeSeconds", {"stat": "p50", "label": "p50"}],
          ["DORA/LeadTime", "LeadTimeSeconds", {"stat": "p90", "label": "p90"}]
        ],
        "period": 604800,
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "title": "Change Failure Rate (%) — Weekly",
      "properties": {
        "metrics": [["DORA/CFR", "ChangeFailureRatePct"]],
        "period": 604800,
        "stat": "Average",
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "title": "Time to Restore — p50 and p90 (Minutes)",
      "properties": {
        "metrics": [
          ["DORA/Incidents", "TimeToRestoreMinutes", {"stat": "p50"}],
          ["DORA/Incidents", "TimeToRestoreMinutes", {"stat": "p90"}]
        ],
        "period": 604800,
        "view": "timeSeries"
      }
    }
  ]
}
```

---

## 8. The Interplay Between Metrics

The four DORA metrics are not independent. They form a system of checks and balances where each metric constrains the interpretation of the others. Reading them in isolation produces misleading conclusions.

### Frequency and Failure Rate as Mutual Validators

Deployment Frequency and Change Failure Rate must be read together. A team reporting high Deployment Frequency and high Change Failure Rate is shipping fast and breaking things frequently — a sign that the speed is not supported by adequate automated testing, or that deployments are not actually small (they are counted frequently but are still large in scope). A team reporting low Deployment Frequency and low Change Failure Rate may look stable but is actually accumulating risk in large, infrequent releases — the low CFR reflects that not many things have been deployed to fail yet.

The healthy pattern is high frequency and low failure rate simultaneously. This combination is only achievable when deployments are genuinely small, automated testing coverage is high, and the production environment closely mirrors the test environment.

### Lead Time and Frequency as Pipeline Health Indicators

If Lead Time is long and Deployment Frequency is low, the pipeline itself is the problem — there is friction between commit and production that makes every deployment expensive. If Lead Time is short but Frequency is still low, the pipeline is fast but something else is limiting deployment: manual approval gates, change advisory board reviews, release train schedules, or a cultural reluctance to push the button.

Identifying which pattern applies tells you where to intervene. A slow pipeline problem is solved with engineering investment (parallelization, caching, faster tests). A cultural or process problem is solved with policy and organizational change.

### TTRS as a Safety Net for High Frequency

High Deployment Frequency is only sustainable if TTRS is low. A team deploying twenty times a day with a 2-hour TTRS will spend most of their time in incident response rather than development. The fast deployment cadence amplifies the cost of each failure because failures happen more often.

This is why elite performers invest heavily in rollback automation, feature flag infrastructure, and observability tooling — not as optional enhancements, but as the safety net that makes high Deployment Frequency operationally viable. The sequence of investment matters: build fast rollback before pushing for higher deployment frequency.

### Reading the Four Together

| Pattern | DF | LT | CFR | TTRS | Diagnosis |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Elite | High | Low | Low | Low | Healthy — sustain and protect the practices |
| Fast but fragile | High | Low | High | High | Insufficient automated testing, deployments too large |
| Slow and stable | Low | High | Low | Low | Accumulating risk, pipeline friction, process overhead |
| Crisis mode | Low | High | High | High | Fundamental delivery model problems, start with pipeline and testing |
| Hidden risk | Low | Low | Low | Low | Low activity — is anyone actually shipping? |

---

## 9. Anti-Patterns & Gaming

DORA metrics, like any metric that organizational leaders pay attention to, are subject to gaming — intentional or inadvertent manipulation that improves the number without improving the underlying reality. Most gaming is not malicious; it emerges naturally when teams are under pressure to show improvement and the metric definition has ambiguity they can exploit.

### Counting Non-Production Deployments

Counting staging, dev, or QA deployments toward Deployment Frequency. This is the most common gaming pattern. A team that deploys to staging fifty times a week but production once a week reports a high frequency number by including non-production environments in the count.

Detection: ensure the metric source filters strictly on `environment=production`. Tag every deployment event with its target environment and make the filter explicit in every dashboard and report.

### Artificial Deployment Splitting

Splitting a single logical change into many small deployments — each touching one file, one function, or one configuration key — to increase Deployment Frequency without increasing the actual rate of valuable change delivered to users. The number goes up; the delivery throughput does not.

Detection: track the average number of commits per deployment and the average lines of change per deployment alongside Deployment Frequency. Artificial splitting produces deployments with single-digit line changes and single commits while the pace of actual feature delivery remains unchanged.

### Incident Misclassification

Closing incidents quickly without resolving them, reclassifying production failures as "planned maintenance" or "known issues," or handling incidents informally (via Slack, without creating a ticket) to avoid them appearing in the TTRS and CFR data.

Detection: cross-reference incident management data with customer-reported issues, support tickets, and on-call engineer activity logs. A discrepancy between the number of PagerDuty incidents and the number of Slack threads discussing production problems is a signal of misclassification. Blameless post-mortem culture is the cultural prerequisite for accurate incident reporting.

### Excluding Services From Measurement

Silently scoping DORA measurement to only the services with favorable metrics — high-frequency, low-failure services — while excluding legacy systems, shared platform services, or services with known problems. The org-wide average looks healthy; the struggling services are invisible.

Detection: maintain an explicit, audited list of services in scope for DORA measurement. Any service excluded from measurement should have a documented, time-bounded reason for the exclusion. Unnamed exclusions are gaming.

### Lead Time Clock Manipulation

Starting the Lead Time clock at pull request open (rather than first commit) or at merge (rather than first commit) to hide time spent in coding. This systematically understates Lead Time by excluding the time a developer spent iterating on the change before it was review-ready.

The correct clock start is the first commit of the change to the shared repository. This is measurable from the Git log and is not subject to interpretation drift in the way that "when did coding begin" is.

---

## 10. Using DORA to Drive Improvement

Measurement without action is reporting theater. The value of DORA metrics is not in producing a dashboard — it is in providing a feedback loop that tells the team which interventions are actually working and which are not.

### The Improvement Loop

The improvement loop has four steps: measure the current state, identify the binding constraint, run an intervention, and measure again. The binding constraint is the metric or metric component that, if improved, would most improve the overall delivery performance. The DORA metrics point to where the constraint lives; engineering judgment determines what specific intervention to run.

A team with a 3-week Lead Time should decompose where those 3 weeks go before picking an intervention. If 2 weeks are in pull request review and 1 week is in pipeline execution, reducing pipeline execution time by 50% saves 3.5 days off a 21-day lead time — a 17% improvement. Reducing review time by 50% saves 7 days — a 33% improvement. Same engineering investment, very different impact.

### What Actually Moves Each Metric

**Deployment Frequency** is moved by reducing the cost and friction of deploying. The highest-leverage interventions are: automated deployment pipelines with no manual steps in the happy path, feature flags that decouple deployment from release, trunk-based development that eliminates long-lived branches, and a culture where deploying is unremarkable rather than ceremonial.

**Lead Time** is moved by reducing batch size and queue time. The highest-leverage interventions are: smaller pull requests (enforced by team norms or automated PR size checks), fewer required approvals (automated quality gates replacing human gates), trunk-based development, and parallelized CI pipelines.

**Change Failure Rate** is moved by improving confidence in the change before it reaches production. The highest-leverage interventions are: comprehensive automated testing (unit, integration, contract, end-to-end), smaller deployments (less surface area to fail), better pre-production environments that closely mirror production, and canary or blue-green deployment strategies that limit the blast radius of failures.

**Time to Restore Service** is moved by improving the speed and reliability of the incident response process. The highest-leverage interventions are: fast rollback automation (one-command or automated rollback to the previous artifact), feature flags (instant remediation without a deployment), better observability (structured logs, distributed traces, SLO-based alerting), and practiced incident runbooks (engineers who have rehearsed the response are faster than engineers who are improvising).

### Team-Level vs. Organization-Level Metrics

DORA metrics at the organization level hide team-level variation. An org-wide Deployment Frequency of "twice per week" may consist of some teams deploying daily and some teams deploying monthly. The org-wide average is not actionable for either group. DORA metrics are most useful when measured per team, per service, or per bounded context — at the granularity where a specific engineering team can act on the findings.

Using DORA metrics to rank teams or tie them to performance reviews is consistently counterproductive. It produces the gaming behaviors described in Section 09 and destroys the psychological safety needed for honest measurement of failure-related metrics (CFR and TTRS). DORA metrics are diagnostic tools for teams to improve their own delivery, not evaluation instruments for management to judge teams.

### Starting From a Low Baseline

For teams starting from a Low performer baseline, the sequence of interventions that produces the fastest compounding improvement is consistent across the DORA research:

First, establish a reliable CI pipeline with automated testing. Without a trustworthy automated test suite, every deployment is a gamble and both CFR and TTRS will remain high regardless of other improvements. This is the prerequisite for everything else.

Second, implement automated deployment with fast rollback. Once CI is reliable, make deploying and rolling back mechanical and fast. One-command rollback to the previous artifact eliminates the majority of long TTRS incidents.

Third, reduce pull request and batch size. With a reliable pipeline and fast rollback, the risk of each deployment drops enough that teams can comfortably deploy smaller changes more frequently. This is the flywheel that drives Deployment Frequency and Lead Time improvement together.

Fourth, invest in observability. Better observability directly reduces detection and diagnosis time, improving TTRS. It also provides the feedback that makes teams confident enough to deploy more frequently — you can only deploy fast if you trust that you will know quickly when something is wrong.

| Starting Point | First Intervention | Expected Impact |
| :--- | :--- | :--- |
| No automated testing | Build a reliable unit and integration test suite | CFR decreases, enables everything else |
| Slow, manual deployment | Automate deployment pipeline end-to-end | DF increases, LT decreases |
| Manual rollback (30+ min) | Implement one-command automated rollback | TTRS decreases dramatically |
| Large, infrequent PRs | Establish PR size norms (< 400 lines) | LT decreases, CFR decreases |
| Poor observability | Structured logging, distributed tracing, SLO alerts | TTRS detection and diagnosis phases shrink |
| Manual approval gates | Replace with automated quality gates | LT decreases, DF increases |