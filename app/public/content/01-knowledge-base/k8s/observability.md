# Kubernetes — Observability: Metrics, Logs & Traces

> **Scope:** Production observability stack for K8s. Covers the full Prometheus/Grafana/Loki/Tempo stack, alerting design, structured logging, OpenTelemetry, and non-obvious gotchas when running observability at scale.

---

## Table of Contents

| Section | Topic | Description |
| :---: | :--- | :--- |
| **01** | [Observability Philosophy](#1-observability-philosophy) | Three pillars mapped to use cases and the Four Golden Signals (USE + RED). |
| **02** | [Metrics — Prometheus Stack](#2-metrics--prometheus-stack) | kube-prometheus-stack setup, ServiceMonitor, PodMonitor, and PrometheusRule patterns. |
| **03** | [Key Metrics to Monitor](#3-key-metrics-to-monitor) | Node, pod, control plane, application RED, and HPA autoscaling metrics. |
| **04** | [Alerting Design](#4-alerting-design) | Alert fatigue prevention, severity tiers, Alertmanager routing, and dead man's switch. |
| **05** | [Logging — Loki Stack](#5-logging--loki-stack) | Loki vs ELK tradeoffs, Promtail setup, LogQL patterns, and log-based alerting. |
| **06** | [Distributed Tracing — Tempo & OpenTelemetry](#6-distributed-tracing--tempo--opentelemetry) | OTel Collector deployment, auto-instrumentation, log-trace correlation, and sampling strategy. |
| **07** | [Dashboards & Grafana Patterns](#7-dashboards--grafana-patterns) | Dashboard hierarchy, template variables, and SLO dashboard queries. |
| **08** | [Observability at Scale — Gotchas](#8-observability-at-scale--gotchas) | Cardinality issues, remote write for long-term storage, and log volume control. |

---

## 1. Observability Philosophy

### Three Pillars Mapped to Use Cases

```
Metrics  → "What is broken, is it getting worse, should I page someone?"
Logs     → "Why is it broken, what happened step by step?"
Traces   → "Which service in the call chain caused it, where is the latency?"
```

They're complementary — metrics alert you, logs tell you why, traces show you where in the system.

### The Four Golden Signals (USE + RED)

For **infrastructure/resources** — USE:
- **U**tilization — how busy is the resource
- **S**aturation — how much work is queued
- **E**rrors — rate of errors

For **services** — RED:
- **R**ate — requests per second
- **E**rrors — error rate
- **D**uration — latency (p50, p95, p99)

Design your dashboards and alerts around these. Avoid metric sprawl — teams drown in dashboards that don't drive action.

---

## 2. Metrics — Prometheus Stack

### kube-prometheus-stack (Recommended Install)

The Helm chart `kube-prometheus-stack` installs everything:
- Prometheus Operator + Prometheus
- Alertmanager
- Grafana (with pre-built dashboards)
- kube-state-metrics (cluster state metrics)
- node-exporter (host-level metrics)
- Prometheus Adapter (custom metrics for HPA)

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f values-monitoring.yaml
```

```yaml
# values-monitoring.yaml key overrides
prometheus:
  prometheusSpec:
    retention: 15d
    retentionSize: 50GB
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 100Gi
    resources:
      requests:
        cpu: 500m
        memory: 2Gi
      limits:
        memory: 8Gi
    # Scrape all ServiceMonitors/PodMonitors in all namespaces
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 10Gi
```

### ServiceMonitor — Defining What to Scrape

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: myapp-metrics
  namespace: app-prod
  labels:
    app: myapp
spec:
  selector:
    matchLabels:
      app: myapp          # Targets Services with this label
  endpoints:
    - port: metrics       # Service port name (not number)
      path: /metrics
      interval: 30s       # Scrape every 30s
      scrapeTimeout: 10s
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_label_version]
          targetLabel: version    # Add version label from pod label
```

### PodMonitor — When There's No Service

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: myapp-pod-metrics
  namespace: app-prod
spec:
  selector:
    matchLabels:
      app: myapp
  podMetricsEndpoints:
    - port: metrics
      path: /metrics
      interval: 30s
```

Use PodMonitor for headless services or when you want per-pod granularity without a Service aggregating them.

### PrometheusRule — Alerting & Recording Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: myapp-rules
  namespace: app-prod
  labels:
    prometheus: kube-prometheus   # Must match Prometheus CRD selector
spec:
  groups:
    - name: myapp.rules
      interval: 30s
      rules:
        # Recording rule — pre-compute expensive query
        - record: myapp:request_rate5m
          expr: sum(rate(http_requests_total{job="myapp"}[5m])) by (status_code)

        # Alerting rule
        - alert: MyAppHighErrorRate
          expr: |
            sum(rate(http_requests_total{job="myapp",status_code=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{job="myapp"}[5m]))
            > 0.05
          for: 2m
          labels:
            severity: critical
            team: payments
          annotations:
            summary: "High error rate on {{ $labels.job }}"
            description: "Error rate is {{ $value | humanizePercentage }} over last 5 minutes"
            runbook_url: "https://wiki.example.com/runbooks/myapp-high-error-rate"
```

---

## 3. Key Metrics to Monitor

### Node Level

```promql
# CPU utilization per node
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) by (node)

# Memory available
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes

# Disk usage
(node_filesystem_size_bytes - node_filesystem_avail_bytes) / node_filesystem_size_bytes

# Network errors
rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m])
```

### Pod/Container Level

```promql
# CPU throttling ratio (key metric — often overlooked)
rate(container_cpu_cfs_throttled_periods_total{container!=""}[5m])
/ rate(container_cpu_cfs_periods_total{container!=""}[5m])

# Memory working set (actual usage, not cache)
container_memory_working_set_bytes{container!=""}

# Restarts (crashloop detection)
increase(kube_pod_container_status_restarts_total[1h]) > 3

# OOMKill detection
kube_pod_container_status_last_terminated_reason == "OOMKilled"
```

### Kubernetes Control Plane

```promql
# API server request latency (p99)
histogram_quantile(0.99,
  sum(rate(apiserver_request_duration_seconds_bucket[5m])) by (le, verb)
)

# etcd leader changes (should be near 0)
increase(etcd_server_leader_changes_seen_total[1h])

# Scheduler pending pods
scheduler_pending_pods

# API server errors
rate(apiserver_request_total{code=~"5.."}[5m])
```

### Application — RED Metrics

Your app should expose these (via Prometheus client library):

```promql
# Request rate
sum(rate(http_requests_total{job="myapp"}[5m])) by (status_code, path)

# Error rate
sum(rate(http_requests_total{job="myapp",status_code=~"5.."}[5m]))
/ sum(rate(http_requests_total{job="myapp"}[5m]))

# p95 latency
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{job="myapp"}[5m])) by (le, path)
)
```

### HPA & Autoscaling Metrics

```promql
# HPA replica lag (desired vs actual)
kube_horizontalpodautoscaler_status_desired_replicas
- kube_horizontalpodautoscaler_status_current_replicas

# HPA at max replicas (scaling ceiling hit)
kube_horizontalpodautoscaler_status_current_replicas
== kube_horizontalpodautoscaler_spec_max_replicas

# Pending pods (node scaling trigger)
count(kube_pod_status_phase{phase="Pending"}) by (namespace)
```

---

## 4. Alerting Design

### Alert Fatigue Prevention

Bad alerts have two failure modes:
- **Too noisy:** Pages on non-actionable events → team ignores alerts → real incidents missed
- **Too quiet:** Only alerts on obviously broken things → too late to prevent impact

Design principle: **alert on symptoms, not causes.**

```
Bad:  "CPU > 80%" → Is this actually causing user impact?
Good: "p99 latency > 2s for 5 minutes" → Users are experiencing slow responses

Bad:  "Pod restarted" → Pods restart all the time (rolling updates, etc.)
Good: "Pod restart rate > 5 in 1 hour" → Something is actually wrong
```

### Alert Severity Tiers

```yaml
# Critical — page immediately (wakes people up)
labels:
  severity: critical
# Condition: user-visible impact happening NOW
# Examples: error rate >5%, p99 >3s, payment service down

# Warning — create ticket, investigate during business hours
labels:
  severity: warning
# Condition: degradation or will-be-critical trend
# Examples: memory growing steadily, HPA at max replicas, cert expires in 14 days

# Info — visible in dashboards, no action required
labels:
  severity: info
# Condition: useful context, non-actionable alone
# Examples: deployment rolled out, pod count changed
```

### Alertmanager Routing

```yaml
# alertmanager.yaml
route:
  group_by: ['alertname', 'cluster', 'namespace']
  group_wait: 30s           # Wait before sending first alert (group similar ones)
  group_interval: 5m        # How long to wait before sending new alerts in same group
  repeat_interval: 4h       # Re-notify if alert still firing
  receiver: 'default-slack'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      repeat_interval: 1h

    - match:
        team: payments
      receiver: 'payments-slack'
      continue: true         # Keep routing to next matchers too

receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - routing_key: '<PD_KEY>'
        description: '{{ .CommonAnnotations.summary }}'

  - name: 'payments-slack'
    slack_configs:
      - api_url: '<WEBHOOK_URL>'
        channel: '#payments-alerts'
        text: '{{ .CommonAnnotations.description }}'
        title: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
```

### Dead Man's Switch — Alert on Alerting System Health

```yaml
# Fire an alert that should ALWAYS be firing
# If Alertmanager stops receiving it → PagerDuty escalates
- alert: Watchdog
  expr: vector(1)
  labels:
    severity: none
  annotations:
    summary: "Watchdog alert — this should always be firing"
```

Configure your Alertmanager receiver to send this to a "dead man's switch" service (PagerDuty's Dead Man's Snitch, Cronitor, etc.) that alerts if it stops receiving the heartbeat.

---

## 5. Logging — Loki Stack

### Loki vs ELK Tradeoffs

| | Loki | Elasticsearch + Kibana |
|---|---|---|
| Storage cost | Low (index labels only, not full text) | High (full text index = 10x raw log size) |
| Query | LogQL (simple, label-first) | Lucene/KQL (powerful full-text search) |
| Scaling | Easy (object storage backend) | Complex (shard management) |
| Grafana integration | Native | Via plugin |
| Full-text search | Limited (regex only) | ✅ Rich |
| Best for | Label-based filtering, Grafana-native teams | Full-text search, complex log analysis |

### Promtail — Log Collection DaemonSet

```yaml
# Promtail discovers pods and tails their logs
config:
  scrape_configs:
    - job_name: kubernetes-pods
      kubernetes_sd_configs:
        - role: pod
      pipeline_stages:
        - cri: {}              # Parse CRI log format (containerd)
        - json:                # Parse JSON logs
            expressions:
              level: level
              msg: message
              trace_id: trace_id
        - labels:
            level:             # Promote JSON field to Loki label
            trace_id:          # Enable log-trace correlation
        - drop:
            expression: '.*healthz.*'   # Drop health check noise
```

### LogQL Patterns

```logql
# Basic label filter
{namespace="app-prod", app="myapp"} |= "ERROR"

# JSON parsing + filter on parsed field
{namespace="app-prod"} | json | level="error" | msg =~ ".*database.*"

# Rate of error logs (for alerting)
sum(rate({namespace="app-prod"} | json | level="error" [5m])) by (app)

# Log volume by app (cost/noise visibility)
sum(count_over_time({namespace="app-prod"}[1h])) by (app)

# Latency from logs (if latency logged as JSON field)
histogram_quantile(0.95,
  sum(rate({app="myapp"} | json | unwrap duration_ms [5m])) by (le)
)
```

### Structured Logging — Application Requirements

Apps must emit structured JSON for Loki to parse effectively:

```json
{
  "timestamp": "2026-05-24T10:30:00Z",
  "level": "error",
  "message": "Database connection failed",
  "service": "payment-api",
  "trace_id": "abc123def456",
  "span_id": "span789",
  "user_id": "usr_123",
  "request_id": "req_456",
  "duration_ms": 1234,
  "error": "connection timeout after 5000ms"
}
```

Key fields to always include: `level`, `message`, `trace_id` (for log-trace correlation), `service`, and any business context relevant to debugging.

### Log-Based Alerting with Loki

```yaml
# PrometheusRule for Loki (via Prometheus recording from Loki ruler)
groups:
  - name: loki-app-alerts
    rules:
      - alert: HighErrorLogRate
        expr: |
          sum(rate({namespace="app-prod"} | json | level="error" [5m])) by (app)
          > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error log rate for {{ $labels.app }}"
```

---

## 6. Distributed Tracing — Tempo & OpenTelemetry

### OpenTelemetry — The Standard

OpenTelemetry (OTel) is the vendor-neutral standard for traces, metrics, and logs. Use the OTel SDK in applications, OTel Collector as the aggregation layer.

```
App (OTel SDK) → OTel Collector → Tempo (traces)
                               → Prometheus (metrics)
                               → Loki (logs)
```

### OTel Collector Deployment

```yaml
# Deploy as DaemonSet (sidecar-less approach)
apiVersion: opentelemetry.io/v1alpha1
kind: OpenTelemetryCollector
metadata:
  name: cluster-collector
  namespace: monitoring
spec:
  mode: DaemonSet
  config: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      batch:
        timeout: 5s
        send_batch_size: 512
      memory_limiter:
        check_interval: 1s
        limit_percentage: 75
        spike_limit_percentage: 25
      resource:
        attributes:
          - key: cluster
            value: "prod-cluster"
            action: upsert

    exporters:
      otlp/tempo:
        endpoint: tempo.monitoring.svc:4317
        tls:
          insecure: true
      prometheusremotewrite:
        endpoint: http://prometheus.monitoring.svc:9090/api/v1/write

    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, batch, resource]
          exporters: [otlp/tempo]
```

### Auto-Instrumentation (No Code Changes)

OTel Operator can inject auto-instrumentation into pods without code changes:

```yaml
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: auto-instrumentation
  namespace: app-prod
spec:
  exporter:
    endpoint: http://otel-collector.monitoring.svc:4317
  propagators:
    - tracecontext
    - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "0.1"             # Sample 10% of traces
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:latest
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:latest
```

```yaml
# Annotate deployment to enable auto-instrumentation
metadata:
  annotations:
    instrumentation.opentelemetry.io/inject-java: "true"
    # instrumentation.opentelemetry.io/inject-python: "true"
    # instrumentation.opentelemetry.io/inject-nodejs: "true"
```

### Log-Trace Correlation

The key to powerful observability — being able to jump from a log line to the trace that produced it:

1. Inject `trace_id` and `span_id` into structured logs (OTel SDK does this automatically)
2. In Loki, promote `trace_id` as a label
3. In Grafana, configure Loki datasource with `derivedFields`:

```yaml
# Grafana Loki datasource config
derivedFields:
  - name: TraceID
    matcherRegex: '"trace_id":"(\w+)"'
    url: '$${__value.raw}'
    datasourceUid: tempo-datasource    # Links to Tempo
```

Now in Grafana Explore, clicking a trace ID in a log line jumps directly to the trace in Tempo.

### Sampling Strategy

100% trace sampling is expensive. Use tail-based or head-based sampling:

```yaml
# Head-based (probabilistic) — simple
sampler:
  type: parentbased_traceidratio
  argument: "0.05"     # Sample 5% of traces

# Tail-based (via OTel Collector) — sample based on outcome
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: errors-policy
        type: status_code
        status_code:
          status_codes: [ERROR]   # Always sample error traces (100%)
      - name: slow-traces
        type: latency
        latency:
          threshold_ms: 1000      # Always sample slow traces
      - name: probabilistic
        type: probabilistic
        probabilistic:
          sampling_percentage: 5  # 5% of everything else
```

---

## 7. Dashboards & Grafana Patterns

### Dashboard Hierarchy

```
1. Cluster Overview  → Node health, pod status, resource utilization
2. Namespace View    → Per-namespace resource usage, pod counts, quotas
3. Workload View     → Per-Deployment: RED metrics, HPA status, pod restarts
4. Service View      → Per-service: latency, error rate, throughput
5. Business View     → Transactions/second, revenue-impacting metrics
```

### Grafana Variable Templates — DRY Dashboards

Use template variables to make dashboards reusable across clusters/namespaces:

```
Variable: $namespace
Type: Query
Query: label_values(kube_pod_info, namespace)
Multi-value: true, Include All: true

Variable: $deployment  
Type: Query
Query: label_values(kube_deployment_labels{namespace="$namespace"}, deployment)
```

All panels use `{namespace="$namespace"}` — one dashboard works across all namespaces.

### SLO Dashboards

```promql
# SLO: 99.9% of requests succeed
# Error budget = 0.1% = 43.8 min/month allowed downtime

# Current error rate
sum(rate(http_requests_total{job="myapp",status_code=~"5.."}[1h]))
/ sum(rate(http_requests_total{job="myapp"}[1h]))

# Error budget remaining (30-day window)
1 - (
  sum(increase(http_requests_total{status_code=~"5.."}[30d]))
  / sum(increase(http_requests_total[30d]))
) / 0.001     # 1 - (error_ratio / error_budget_ratio)
```

---

## 8. Observability at Scale — Gotchas

### Prometheus Cardinality — The Silent Killer

High cardinality metrics (unique label combinations) cause Prometheus to OOM. Common offenders:

```
# BAD — user_id or request_id as label = millions of series
http_requests_total{user_id="usr_123456", path="/api/v1/payments"}

# GOOD — use bounded labels only
http_requests_total{status_code="200", path="/api/v1/payments", method="POST"}
```

Signs of cardinality problems:
- Prometheus memory climbing steadily
- Scrapes taking longer than interval
- TSDB head chunks growing unboundedly

```promql
# Find high-cardinality metrics
topk(10, count by (__name__)({__name__=~".+"}))
```

Rules:
- Labels must have **bounded value sets** (status codes, methods, paths — not IDs)
- Limit unique metric time series to < 1M per Prometheus instance
- Use `prometheus_tsdb_head_series` metric to monitor series count

### Remote Write for Long-Term Storage

Prometheus retention should be short (15-30 days) and offload to Thanos, Cortex, or Amazon Managed Prometheus for long-term:

```yaml
prometheusSpec:
  remoteWrite:
    - url: https://aps-workspaces.ap-southeast-1.amazonaws.com/workspaces/<ID>/api/v1/remote_write
      sigv4:
        region: ap-southeast-1
      queueConfig:
        capacity: 10000
        maxSamplesPerSend: 1000
        batchSendDeadline: 5s
```

### Log Volume Control

Uncontrolled log volume will fill your Loki storage and overwhelm collectors. Strategies:

```yaml
# Promtail: drop noisy, low-value logs
pipeline_stages:
  - match:
      selector: '{app="ingress-nginx"}'
      stages:
        - drop:
            expression: '.*"status":"200".*"path":"/healthz".*'   # Drop health check 200s
  - match:
      selector: '{app="myapp"}'
      stages:
        - drop:
            expression: '.*level="debug".*'                        # Drop debug in prod
```

Set log level appropriately per environment — DEBUG in dev, INFO/WARN in prod.

### Sidecar Container Metrics — Common Miss

When using sidecar containers (Envoy, log agents), remember to expose their metrics too:

```yaml
# Envoy sidecar metrics via ServiceMonitor
spec:
  endpoints:
    - port: envoy-admin
      path: /stats/prometheus
      interval: 30s
```

Missing sidecar metrics means blind spots — Envoy handles all your traffic but you're not monitoring it.

### Observability in Cost Management

Observability stack itself has costs:
- Prometheus storage at scale (EBS gp3 for TSDB)
- Loki S3 storage (grows with log volume)
- OTel Collector CPU (batch processing at high trace volume)

Monitor your monitoring:
```promql
# Prometheus storage usage
prometheus_tsdb_storage_blocks_bytes / 1e9   # GB

# Loki ingestion rate
sum(rate(loki_ingester_streams_created_total[5m]))
```

Set retention policies on Loki and S3 lifecycle rules on the Loki bucket.

---

*Last updated: 2026-05 | Author: Personal KB | Stack: kube-prometheus-stack, Loki, Tempo, OTel Operator*