# K3s — Line Edition / edge-per-zone — scaffolding

> doc 33 §3.1 / F1 (SYNAPSE ADR-007). **Scaffold only** — full manifests are a later phase.

Line Edition = one production line on a single industrial server or a small K3s cluster; also the
per-zone **edge** runtime under a Site (low-latency Integration Hub + local broker + store-and-forward).

Planned layout (later F1 wave, `EDITION_PROFILE`-gated):
```
deploy/k3s/
├── install-edge.sh        # install K3s + join site; label node edition=line / role=edge
├── line/                  # app Deployment (EDITION=line), edge EMQX, local PG, migrate Job
└── edge/                  # Integration Hub + edge broker + store-and-forward only (bridges to Site)
```
Edge-first (ADR-007 / SYNAPSE §2.5): the edge keeps running when the Site link drops
(store-and-forward buffer ≥24h already exists — `server/services/ot/storeForward.ts`), then
reconciles on reconnect. Broker/DB are a **profile**, not a prerequisite.

Until manifests land, run Line via the Machine compose (embedded) or a trimmed Site compose.
