# Helm — Site Edition (K8s HA) — scaffolding

> doc 33 §3.1 / F1 (SYNAPSE ADR-007). **Scaffold only** — full chart is a later phase.

Site Edition target topology (SYNAPSE §6.1): PostgreSQL HA + TimescaleDB + EMQX 3-node cluster +
Redis + app (N replicas) + optional edge K3s per zone (see [`../k3s/`](../k3s/README.md)).

Planned chart layout (to be filled in a later F1 wave, `EDITION_PROFILE`-gated):
```
deploy/helm/synapse/
├── Chart.yaml
├── values.yaml            # edition=site, infraProfile=external, replicaCount, resources
├── values-site-ha.yaml    # 3-node broker/DB, PodDisruptionBudget, anti-affinity
└── templates/             # app Deployment+HPA, Service, Ingress, ConfigMap (EDITION/INFRA_PROFILE),
                           #   emqx StatefulSet, postgres/timescale StatefulSet, migrate Job
```
Rule (ADR-007): the chart sets `EDITION=site` + `INFRA_PROFILE=external`; the SAME app image runs
here as in the Machine single-node compose. Infra (EMQX/K8s) is a **profile**, never a hard
prerequisite — the app must boot with the embedded profile too.

Until the chart lands, Site Edition runs via the root [`docker-compose.yml`](../../docker-compose.yml).
