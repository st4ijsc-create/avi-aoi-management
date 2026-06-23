# Observability stack (Phase 1 WS1.5)

Turn-key Prometheus + Grafana for the AVI/AOI platform. These are **config
artifacts** — the application code already exposes metrics; this wires a
dashboard on top. Nothing here runs automatically.

## What the app already exposes

- `GET /metrics` (Prometheus format) — active only when `METRICS_ENABLED=true`
  **and** the optional `prom-client` package is installed (the metrics module
  dynamic-imports it and no-ops if missing).
- Metric prefix: `avi_aoi_`. Includes Node default metrics (CPU, RSS, heap,
  event-loop lag) plus:
  - `avi_aoi_http_requests_total{method,route,status}`
  - `avi_aoi_http_request_duration_seconds_bucket{method,route,status}`

OpenTelemetry tracing + Sentry are separately available via
`server/_core/observability.ts` (flag-gated) — out of scope for this dashboard.

## Enable it

```bash
# 1) Install the metrics dependency (one-time)
pnpm add prom-client

# 2) Enable in the app .env, then restart the app
echo "METRICS_ENABLED=true" >> .env

# 3) Launch Prometheus + Grafana
docker compose -f monitoring/docker-compose.observability.yml up -d
```

- Grafana: http://localhost:3001 (admin / admin) → folder **AVI-AOI** →
  dashboard **"AVI-AOI — Service Overview"**.
- Prometheus: http://localhost:9090 — check Targets are `UP`.

## Files

| File | Purpose |
|---|---|
| `prometheus/prometheus.yml` | Scrape config (adjust the app target host:port) |
| `grafana/provisioning/datasources/prometheus.yml` | Auto-wire Prometheus datasource |
| `grafana/provisioning/dashboards/dashboards.yml` | Auto-load dashboards from disk |
| `grafana/dashboards/avi-aoi-overview.json` | Service overview dashboard |
| `docker-compose.observability.yml` | Prometheus + Grafana stack |

## Notes

- Default Prometheus target is `host.docker.internal:3000`. If the app runs in
  the same docker network, change it to the service name (e.g. `app:3000`).
- For multi-instance deployments, scrape each instance and add an `instance`
  label; the dashboard aggregates with `sum(...)`.
- Retention for Prometheus TSDB is 15d here; tune `--storage.tsdb.retention.time`.

> The `*.jsonl` files in this directory are unrelated AI-analytics rollout logs.
