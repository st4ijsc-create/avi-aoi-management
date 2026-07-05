#!/usr/bin/env sh
# =============================================================================
# SYNAPSE — Line/edge installer for a single-node K3s. doc 33 §11 / ADR-007.
# Applies: namespace → secrets (generated if absent) → configmap → co-located infra
# (Postgres + Redis) → app (EDITION=line, INFRA_PROFILE=embedded → in-process Aedes
# broker + main-DB time-series). Idempotent — re-run safely.
#
# Prereqs: kubectl pointing at the K3s cluster, and the app image present in the node's
# containerd. Build & import it first, e.g.:
#     docker build -t synapse:1.0.0 ../..
#     docker save synapse:1.0.0 | sudo k3s ctr images import -
#
# Env overrides (all optional):
#     KUBECTL          kubectl binary (default: kubectl)
#     SYNAPSE_IMAGE    app image ref  (default: synapse:1.0.0)
#     POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB   (default: aoi / aoi / aoi_management)
#     JWT_SECRET / SIGNOFF_SECRET / MASTER_API_KEY      (default: randomly generated)
# =============================================================================
set -eu

NS=synapse-edge
DIR="$(cd "$(dirname "$0")" && pwd)"
KUBECTL="${KUBECTL:-kubectl}"
IMAGE="${SYNAPSE_IMAGE:-synapse:1.0.0}"

PG_USER="${POSTGRES_USER:-aoi}"
PG_PASS="${POSTGRES_PASSWORD:-aoi}"
PG_DB="${POSTGRES_DB:-aoi_management}"

rand() { openssl rand "$@" 2>/dev/null || head -c 48 /dev/urandom | base64; }

echo "==> [1/6] Namespace"
"$KUBECTL" apply -f "$DIR/namespace.yaml"

echo "==> [2/6] Secret 'synapse-secrets' (generated if absent)"
if "$KUBECTL" -n "$NS" get secret synapse-secrets >/dev/null 2>&1; then
  echo "    already exists — leaving as-is (delete it to regenerate)"
else
  JWT="${JWT_SECRET:-$(rand -base64 64 | tr -d '\n')}"
  SIGNOFF="${SIGNOFF_SECRET:-$(rand -base64 24 | tr -d '\n')}"
  MASTER="${MASTER_API_KEY:-$(rand -hex 24 | tr -d '\n')}"
  "$KUBECTL" -n "$NS" create secret generic synapse-secrets \
    --from-literal=DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@synapse-postgres:5432/${PG_DB}" \
    --from-literal=JWT_SECRET="$JWT" \
    --from-literal=SIGNOFF_SECRET="$SIGNOFF" \
    --from-literal=MASTER_API_KEY="$MASTER"
  echo "    created (random JWT/SIGNOFF/MASTER — retrieve via: kubectl -n $NS get secret synapse-secrets -o yaml)"
fi

echo "==> [3/6] ConfigMap"
"$KUBECTL" apply -f "$DIR/configmap.yaml"

echo "==> [4/6] Co-located infra (Postgres + Redis)"
"$KUBECTL" apply -f "$DIR/infra.yaml"
"$KUBECTL" -n "$NS" rollout status deploy/synapse-postgres --timeout=180s
"$KUBECTL" -n "$NS" rollout status deploy/synapse-redis --timeout=120s

echo "==> [5/6] App (image: $IMAGE)"
# Substitute the image tag on the fly, then apply from stdin (still `kubectl apply`).
sed "s|image: synapse:1.0.0|image: ${IMAGE}|g" "$DIR/deployment.yaml" | "$KUBECTL" apply -f -
"$KUBECTL" apply -f "$DIR/service.yaml"
"$KUBECTL" -n "$NS" rollout status deploy/synapse-app --timeout=300s

echo "==> [6/6] Done"
NODE_PORT="$("$KUBECTL" -n "$NS" get svc synapse-app -o jsonpath='{.spec.ports[0].nodePort}')"
echo "    Liveness: curl http://<node-ip>:${NODE_PORT}/health   (→ {\"status\":\"ok\",...})"
echo "    Edition : kubectl -n $NS logs deploy/synapse-app | grep '\\[edition\\]'   (→ ... (line) · infra=embedded ...)"
