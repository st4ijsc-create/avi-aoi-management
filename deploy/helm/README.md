# Helm — SYNAPSE Site Edition (K8s HA)

> doc 33 §11 / ADR-007 "collapsible deployment". ONE app image → three editions
> (`machine` | `line` | `site`). This chart targets the **Site** edition (whole plant,
> HA, **external** managed infra). Single-node editions ship elsewhere:
> `machine` → [`../compose/docker-compose.machine.yml`](../compose/docker-compose.machine.yml),
> `line`/edge → [`../k3s/`](../k3s/README.md).

The chart lives in [`synapse/`](./synapse). The **same** app image (built from the repo-root
`Dockerfile`) runs in every edition — infra (EMQX / TimescaleDB / Redis / Postgres) is a
**profile**, never bundled by this chart. Site edition points at your **external managed**
services via connection strings.

## What it deploys

| Object | Notes |
| --- | --- |
| `Deployment` (server, `ROLE=api`) | HTTP/socket/MQTT/ingest. Probes hit the **real** `GET /health` on container port **3000**. |
| `Deployment` (worker, `ROLE=worker`) | `node dist/worker.js` — cron/schedulers only. **Pinned to 1 replica** (no leader election). Gated by `worker.enabled`. |
| `Service` | Selects the **server** pods only (component=server); port `3000`. |
| `Ingress` | Gated by `ingress.enabled`. |
| `ConfigMap` | Non-secret env incl. `EDITION` / `INFRA_PROFILE` / `EDITION_PROFILE`. |
| `Secret` | `DATABASE_URL`, `REDIS_URL`, `TSDB_URL`, `UNS_BROKER_URL`, `JWT_SECRET`, `SIGNOFF_SECRET`, `MASTER_API_KEY`. Provide at install (or `existingSecret`). |
| `HPA` | Gated by `autoscaling.enabled` — targets the **server** only. |
| `PodDisruptionBudget` | Gated by `podDisruptionBudget.enabled`. |
| `Job` (migrate, Helm hook) | `pre-install`/`pre-upgrade`: `scripts/migrate-standalone.mjs` + core-table verify. Gated by `migrations.enabled`. |
| `ServiceAccount`, `PVC` | SA always (unless disabled); PVC only when `persistence.enabled`. |

Real endpoint used by every probe: **`GET /health`** (`server/_core/index.ts`) → `200 {"status":"ok",...}`
when the DB is connected, `503 {"status":"degraded"}` otherwise. Container port **3000**
(`process.env.PORT || 3000`).

## 0. Build & push the image (once)

No public registry ships in-repo — build the repo-root `Dockerfile` and push it:

```bash
docker build -t <your-registry>/synapse:1.0.0 .
docker push  <your-registry>/synapse:1.0.0
```

Then set `image.repository=<your-registry>/synapse` below.

## 1. Install — Site (default)

External managed Postgres/TimescaleDB/EMQX/Redis. Provide the connection strings + app
secrets at install (never commit them):

```bash
helm upgrade --install synapse deploy/helm/synapse \
  --namespace synapse --create-namespace \
  --set image.repository=<your-registry>/synapse \
  --set-string secrets.databaseUrl='postgres://user:pass@pg-host:5432/aoi_management' \
  --set-string secrets.redisUrl='redis://redis-host:6379' \
  --set-string secrets.tsdbUrl='postgres://user:pass@tsdb-host:5432/avi_aoi_ts' \
  --set-string secrets.unsBrokerUrl='mqtt://emqx-host:1883' \
  --set-string secrets.jwtSecret="$(openssl rand -base64 64)" \
  --set-string secrets.signoffSecret="$(openssl rand -base64 24)" \
  --set-string secrets.masterApiKey="$(openssl rand -hex 24)" \
  --set-string env.ALLOWED_ORIGINS='https://app.example.com'
```

## 2. Install — Site HA

Layer the HA overrides (≥3 replicas, HPA, PDB, zone/host topology spread, Ingress):

```bash
helm upgrade --install synapse deploy/helm/synapse \
  --namespace synapse --create-namespace \
  -f deploy/helm/synapse/values.yaml \
  -f deploy/helm/synapse/values-site-ha.yaml \
  --set image.repository=<your-registry>/synapse \
  --set-string secrets.databaseUrl='postgres://user:pass@pg-host:5432/aoi_management' \
  --set-string secrets.redisUrl='redis://redis-host:6379' \
  --set-string secrets.tsdbUrl='postgres://user:pass@tsdb-host:5432/avi_aoi_ts' \
  --set-string secrets.unsBrokerUrl='mqtt://emqx-host:1883' \
  --set-string secrets.jwtSecret="$(openssl rand -base64 64)" \
  --set-string secrets.signoffSecret="$(openssl rand -base64 24)" \
  --set-string secrets.masterApiKey="$(openssl rand -hex 24)" \
  --set-string env.ALLOWED_ORIGINS='https://app.example.com' \
  --set ingress.hosts[0].host=synapse.example.com
```

**Production tip:** instead of `--set-string secrets.*`, pre-create a Secret (same keys as
[`synapse/templates/secret.yaml`](./synapse/templates/secret.yaml)) via an ExternalSecret
operator and pass `--set existingSecret=<name>` — the chart then renders no Secret.

## 3. Verify

```bash
# Lint / render without a cluster
helm lint deploy/helm/synapse
helm template synapse deploy/helm/synapse -f deploy/helm/synapse/values-site-ha.yaml \
  --set-string secrets.jwtSecret=x --set-string secrets.databaseUrl=y | less

# After install
helm test  synapse -n synapse   # (no test hooks yet)
kubectl -n synapse rollout status deploy/synapse
kubectl -n synapse port-forward svc/synapse 3000:3000 &
curl -fsS http://127.0.0.1:3000/health          # → {"status":"ok",...}
kubectl -n synapse logs deploy/synapse | grep '\[edition\]'   # → [edition] Site Edition (site) · infra=external ...
```

## Key values

| Value | Default | Purpose |
| --- | --- | --- |
| `image.repository` / `image.tag` | `synapse` / appVersion `1.0.0` | image ref (tag falls back to `Chart.appVersion`) |
| `edition.code` / `.infraProfile` / `.enforceProfile` | `site` / `external` / `true` | `EDITION` / `INFRA_PROFILE` / `EDITION_PROFILE` |
| `replicaCount` | `2` | server replicas (ignored when `autoscaling.enabled`) |
| `service.type` / `.port` | `ClusterIP` / `3000` | must match the app `PORT` |
| `ingress.enabled` | `false` | toggle Ingress |
| `worker.enabled` | `true` | ROLE=worker scheduler (always 1 replica) |
| `autoscaling.enabled` | `false` | HPA on the server |
| `podDisruptionBudget.enabled` | `false` | PDB on the server |
| `migrations.enabled` | `true` | pre-install/upgrade migration hook Job |
| `persistence.enabled` | `false` | uploads/backups PVC (single-replica only; site should use object storage) |
| `secrets.*` / `existingSecret` | `""` | DB/broker/JWT — **provide at install** |

> ADR-007 invariant: this chart sets `EDITION=site` + `INFRA_PROFILE=external`, but the app
> must also boot with the **embedded** profile (machine compose / k3s edge). Infra is a
> profile, never a hard prerequisite. Keep both green — see
> [`../../.github/workflows/edition-smoke.yml`](../../.github/workflows/edition-smoke.yml).
