# Editions & Collapsible Deployment (SYNAPSE ADR-007)

> doc 33 §3.1 / F1. ONE codebase → THREE editions. Source of truth: [`shared/editions.ts`](../shared/editions.ts).
> The edition **bounds** the license (allowed modules + quota ceilings + infra default); it never
> grants beyond the license. Default (EDITION unset) = **site** = fully backward-compatible.

## Matrix

| | **Machine** | **Line** | **Site** |
|---|---|---|---|
| Đối tượng | Bán kèm 1 máy (OEM) | Cụm máy / 1 dây chuyền | Toàn nhà máy, đa line |
| Topology | single-node | line-cluster | site-ha |
| Infra profile (default) | `embedded` (Aedes nhúng, TS degrade→main DB) | `external` | `external` (EMQX cluster + TimescaleDB) |
| Module ceiling | monitoring, data-mgmt, production, alerts, AI, OT-control | + analytics | `*` (tất cả) |
| Quota (vd MAX_DEVICE_ADAPTERS) | 16 | 64 | không giới hạn |
| Compose | `deploy/compose/docker-compose.machine.yml` | (K3s — `deploy/k3s/`) | `docker-compose.yml` / `deploy/helm/` |

## Env
```
EDITION=machine|line|site      # default: site (full, backward-compatible)
INFRA_PROFILE=embedded|external# default: edition's own default
EDITION_PROFILE=true|false     # F1 flag — when false, resolution is advisory-only (default)
```
Resolved shape is reported by the read-only API `trpc.edition.current` and the startup log
line `[edition] …` (see [`server/_core/deploymentProfile.ts`](../server/_core/deploymentProfile.ts)).

## Run
```bash
# Machine Edition (collapsed single-node): postgres(ts-ha) + redis + app, embedded broker
docker compose -f deploy/compose/docker-compose.machine.yml --env-file .env up -d

# Site Edition (full stack): postgres + redis + emqx + timescaledb + app
docker compose -f docker-compose.yml up -d
```

## Upgrade path (seamless — SYNAPSE §4.5)
`machine × N` → (Join wizard: bridge Aedes→EMQX, mDNS discover) → **line** → (thêm line/zone) →
**site** → (liên nhà máy) → federation. **Không cài lại, không mất dữ liệu**; license cũ trừ vào
giá mới. *(Join wizard + bridge = phase sau; F1 chốt descriptor + hồ sơ triển khai.)*

## Status (F1 — non-breaking, advisory)
- ✅ Edition descriptor + resolution semantics (`shared/editions.ts`, tested).
- ✅ Deployment-profile resolver + startup log + `/edition` API (informational).
- ✅ Machine single-node compose profile.
- 🔜 (later phases) enforce module ceiling/quota in license middleware; Join wizard + UNS bridge;
  Helm/K3s HA manifests; CI 2-profile smoke.
