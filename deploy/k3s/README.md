# K3s — SYNAPSE Line Edition / edge-per-zone

> doc 33 §11 / ADR-007 "collapsible deployment". Plain Kubernetes manifests for the
> **Line/edge** edition: a single-node K3s appliance running `EDITION=line` with
> **embedded** infra (in-process Aedes broker + time-series degrading to the main DB),
> plus a co-located Postgres (TimescaleDB + pgvector) and Redis on the same node.
>
> The **same** app image runs here as in the Site Helm chart and the Machine compose —
> infra is a *profile*, not a prerequisite (ADR-007). Site (HA, external infra) → use
> [`../helm/`](../helm/README.md). Single machine (OEM) → use
> [`../compose/docker-compose.machine.yml`](../compose/docker-compose.machine.yml).

## Files

| File | Purpose |
| --- | --- |
| `namespace.yaml` | `synapse-edge` namespace |
| `configmap.yaml` | Non-secret env — `EDITION=line`, `INFRA_PROFILE=embedded`, `EDITION_PROFILE=true`, `REDIS_URL`, ports |
| `infra.yaml` | Co-located Postgres (`timescale/timescaledb-ha:pg17` + extensions init) + Redis + their Services/PVC |
| `deployment.yaml` | App (`synapse-app`, `ROLE=api`) with a migration **init container**; probes hit real `GET /health` on **3000** |
| `service.yaml` | `NodePort` 30080 → app port 3000 |
| `install-edge.sh` | Applies everything in order; generates the `synapse-secrets` Secret if absent |

Secrets (`DATABASE_URL`, `JWT_SECRET`, `SIGNOFF_SECRET`, `MASTER_API_KEY`) are **not** committed
as a manifest — `install-edge.sh` creates the `synapse-secrets` Secret imperatively (random
values by default, overridable via env). The app fail-fasts without them.

## 1. Build & import the image into K3s

K3s uses its own containerd, so a locally-built image must be imported (or pulled from a
registry you control):

```bash
# from the repo root
docker build -t synapse:1.0.0 .
docker save synapse:1.0.0 | sudo k3s ctr images import -
```

## 2. Install

```bash
cd deploy/k3s
chmod +x install-edge.sh
./install-edge.sh
# Override anything via env, e.g.:
#   SYNAPSE_IMAGE=registry.local/synapse:1.0.0 JWT_SECRET=... ./install-edge.sh
```

The script waits for Postgres/Redis, runs the migration init container, then rolls out the app.

## 3. Verify

```bash
kubectl -n synapse-edge get pods
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
curl -fsS "http://$NODE_IP:30080/health"                      # → {"status":"ok",...}
kubectl -n synapse-edge logs deploy/synapse-app | grep '\[edition\]'
#   → [edition] Line Edition (line) · topology=line-cluster · infra=embedded · broker=embedded-aedes · ts=main-db · EDITION_PROFILE=on
```

## Uninstall

```bash
kubectl delete namespace synapse-edge
```

> ADR-007 invariant: the edge keeps running when a Site link drops (store-and-forward buffer
> ≥24h already exists — `server/services/ot/storeForward.ts`), then reconciles on reconnect.
> The `machine` (compose) and `line`/`site` profiles must all boot green — CI enforces two of
> them in [`../../.github/workflows/edition-smoke.yml`](../../.github/workflows/edition-smoke.yml).
