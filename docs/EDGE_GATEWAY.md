# Edge Gateway (Tầng-1 §5) — standalone edge node per line

> doc 44 · Batch W7-1 · gap **G1.14** — "tách edge gateway process thật" (the biggest
> Tầng-1 architecture gap). SYNAPSE Tầng-1 spec: `Chương 5 Edge Gateway & runtime`,
> `§5.2 mô hình triển khai`, `§2.1 / §17.2 biên tự chủ`.

## 1. What this is (and the gap it closes)

Before W7-1 the "gateway" was **`otManager` running INSIDE the central server
process** — not a separate edge node/container per line. The store-and-forward WAL
only covered **DB-down** (server-side); it did **not** cover loss of the **central /
UNS broker**. When the edge lost the central UNS link, telemetry that would be
published northbound was **log-and-dropped** (`server/services/ot/ingest.ts:190-192`).

W7-1 adds a **standalone edge-gateway process** that runs the *same code* at the edge,
near the devices, with a true **autonomous edge**:

| Concern | Central all-in-one (`dist/index.js`) | **Edge gateway (`dist/edgeGatewayMain.js`)** |
|---|---|---|
| HTTP API / Socket.IO / MQTT broker | binds all | **binds none** |
| Southbound OT collectors | yes | yes (reuses `otManager` + `ConnectionSupervisor`) |
| Northbound UNS bridge | yes | yes (Sparkplug / normalized) — the **only** bridge |
| DB-down store-forward | yes | yes (unchanged) |
| **UNS/central-down store-forward (≥24h)** | n/a | **yes — new** |
| Registers into `edge_nodes` + heartbeat | n/a | yes (degraded-aware) |

**The default topology is unchanged.** With `EDGE_GATEWAY_MODE` unset, the all-in-one
server runs everything in one process and the edge entrypoint is simply never used.

## 2. Architecture

```
        ▲ NORTHBOUND — central UNS broker (EMQX)  [Sparkplug NBIRTH/DBIRTH/DDATA]
        │        ▲ when unreachable → store-and-forward WAL (≥24h), ordered replay
┌───────┴────────┴──────────────────── EDGE GATEWAY PROCESS ───────────────────┐
│  edgeGatewayMain.ts  →  edgeGatewayRuntime.ts (orchestrator)                  │
│    • initUnsPublisher (northbound client)      • register self + heartbeat    │
│    • startOt  (otManager + ConnectionSupervisor)  • UNS store-forward drain   │
│    • ingest → persist (DB store-forward) + publish-or-BUFFER (UNS store-fwd)  │
│  NO express · NO Socket.IO · NO in-process MQTT broker                        │
└───────┬──────────────────────────────────────────────────────────────────────┘
        │  SOUTHBOUND — OPC UA · Modbus · S7 · EtherNet/IP · MC …  (per DB adapters)
        ▼  robot · PLC · máy · băng tải · IoT      (SEPARATE from the safety-PLC)
```

Files:

- `server/edge/edgeGatewayMain.ts` — the process entrypoint (mirrors `server/worker.ts`).
- `server/services/edge/edgeGatewayRuntime.ts` — orchestrator: config load, wiring,
  central reachability, heartbeat/degraded health, UNS-backfill drain loop, graceful stop.
- `server/services/ot/storeForward.ts` — **extended** with a UNS-publish store-and-forward
  buffer (a generic `DurableBuffer<T>`; the DB buffer is left byte-for-byte).
- `server/services/ot/ingest.ts` — in edge mode, publish-or-buffer instead of log-and-drop.

## 3. Deploy — one gateway per line

Each line runs its **own** edge-gateway container (each is a distinct Sparkplug Edge
Node). Point every gateway at the **central** EMQX and control-plane DB.

```bash
# 1) Build the edge image (from repo root)
docker build -f deploy/edge/Dockerfile.edge -t synapse-edge-gateway:latest .

# 2) Per line: create .env.edge + config, then bring one stack up
docker compose -f deploy/edge/docker-compose.edge.yml --env-file .env.edge up -d
```

Per-line overrides (env or `deploy/gitops/edge-node.yaml`):
`EDGE_GATEWAY_NODE_CODE`, `EDGE_GATEWAY_LINE_CODES`, `UNS_SPARKPLUG_EDGE_NODE_ID`.

The container binds **no port**. Its Docker `HEALTHCHECK` checks the heartbeat-refreshed
**liveness marker** (`EDGE_GATEWAY_LIVENESS_FILE`, default `/app/data/edge-gateway.alive`)
is fresh (< 2 min) — there is no HTTP `/health` to probe.

> **Safety boundary (Tầng-1 §18):** the gateway is READ + publish + buffer only. Run it
> on the edge server, **separate from the certified safety-PLC**. It never writes safety
> functions. A real device write still routes through the gated `commandDispatcher`.

## 4. Autonomous edge (biên tự chủ)

When the **central UNS broker is unreachable** (`isUnsPublisherConnected()` is false, or
an injected reachability probe returns false):

1. **Keep collecting** — the OT adapters keep polling devices (unchanged); each sample is
   still persisted locally via the canonical bus (its own DB store-forward covers DB-down).
2. **Buffer instead of drop** — the northbound UNS publish is **buffered** to a durable WAL
   (`EDGE_UNS_STORE_FORWARD_FILE`, default `./data/edge-uns-store-forward.jsonl`), bounded by
   `EDGE_UNS_STORE_FORWARD_MAX` entries + `EDGE_UNS_STORE_FORWARD_MAX_AGE_MS` (**default 24h**).
   Overflow/age drops are **counted + warned**, never silent.
3. **Resync on recovery** — a drain loop (`EDGE_UNS_STORE_FORWARD_DRAIN_MS`, default 30s) and
   the heartbeat replay the backlog **in order** through the real publisher once the broker is
   back. Replay is **idempotent** by natural key `deviceId|tag|ts` — no loss, no duplicates,
   even across a crash-restart (the WAL is restored on boot).
4. **Degraded health** — the heartbeat to `edge_nodes` reports `degraded` while central is
   unreachable **or** either buffer (UNS / DB) has a backlog; `online` only when reachable +
   both buffers empty.

The UNS buffer honours the same **all-or-nothing per batch** contract as the DB buffer: the
injected publish fn returns `items.length` only when the broker is connected (batch handed to
the client), else `0` (batch left buffered) — so an un-sent tail can never be dropped.

## 5. Configuration

| Env | Default | Purpose |
|---|---|---|
| `EDGE_GATEWAY_MODE` | *(entrypoint sets `true`)* | Master switch for edge-autonomy behaviour. The all-in-one server never sets it. |
| `EDGE_RUNTIME_ENABLED` | `false` | Enables the `edge_nodes` registry + heartbeat writes. Set `true` at the edge. |
| `EDGE_GATEWAY_NODE_CODE` | `edge-<hostname>` | Identity this gateway registers/heartbeats as (falls back to `EDGE_NODE_CODE`). |
| `EDGE_GATEWAY_NODE_NAME` / `_FACTORY_CODE` / `_LINE_CODES` | — | Registry metadata (ISA-95 scope). |
| `EDGE_GATEWAY_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat cadence. |
| `EDGE_GATEWAY_CONFIG_FILE` | — | GitOps `edge-node.yaml` (identity/scope + optional mappings). |
| `EDGE_GATEWAY_LIVENESS_FILE` | `./data/edge-gateway.alive` | Heartbeat-refreshed marker for the no-HTTP healthcheck. |
| `EDGE_UNS_STORE_FORWARD_FILE` | `./data/edge-uns-store-forward.jsonl` | UNS backlog WAL. |
| `EDGE_UNS_STORE_FORWARD_MAX` | `500000` | Max buffered UNS samples (overflow drops oldest, counted). |
| `EDGE_UNS_STORE_FORWARD_MAX_AGE_MS` | `86400000` (24h) | Max age of a buffered sample. |
| `EDGE_UNS_STORE_FORWARD_DRAIN_MS` | `30000` | Backfill drain cadence. |
| `EDGE_UNS_STORE_FORWARD_ENABLED` | `false` | Alternative opt-in for the UNS buffer without full edge mode (tests). |

Reused southbound/northbound flags: `OT_GATEWAY_ENABLED`, `OT_CONN_HA_ENABLED`,
`OT_STORE_FORWARD_ENABLED`, `OT_INGEST_TO_UNS`, `UNS_BRIDGE_ENABLED`,
`UNS_SPARKPLUG_ENABLED`, `UNS_BROKER_URL`, `UNS_SPARKPLUG_EDGE_NODE_ID`.

### Config-as-code (GitOps)

`deploy/gitops/edge-node.yaml` declares **identity + scope** and (optionally) points at a
`mappingsDir` of `*.mapping.yaml` contracts. On boot `loadEdgeConfig()`:

- applies node identity/scope to the process (env **wins** if already set), and
- optionally imports the declarative tag mappings (reuses `mappingAsCode`, W2-B3):
  `applyMappings: false` → dry-run (diff/changeCount only, **safe default**);
  `applyMappings: true` → upsert `device_tags` + `uns_tag_mappings`.

The adapter **connection** config (endpoint/credentials) stays in the DB **Asset Registry**
(Tầng-1 §6) — the GitOps file carries no secrets.

## 6. Cutover from the in-process gateway

The two run **side by side without conflict** — but the same adapter set must be polled by
**exactly one** of them (two pollers double-poll the device).

1. **Prepare** — stand up the central EMQX (`deploy/emqx`) and confirm the central server
   already publishes to UNS (`UNS_BRIDGE_ENABLED=true`).
2. **Deploy the edge gateway** for a pilot line (§3), pointed at the central broker + DB.
   Verify it appears in `edge_nodes` (heartbeat `online`) and telemetry arrives on the UNS
   tree just like the in-process path.
3. **Move ownership** — on the CENTRAL server, disable the in-process OT gateway
   (`OT_GATEWAY_ENABLED=false`) **for the adapters now owned by the edge**, so only the edge
   node polls those devices. (If the central still owns other lines, keep it on for those.)
4. **Validate autonomy** — cut the edge→central UNS link; confirm the edge keeps collecting,
   the UNS WAL grows, the heartbeat flips `degraded`; restore the link and confirm the backlog
   replays **in order** with no loss/dup and the node returns `online`.
5. **Roll out** the remaining lines, one gateway per line.

## 7. Verification

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit          # 0 errors
node --check server/edge/edgeGatewayMain.ts                       # (after build: dist/edgeGatewayMain.js)
npx vitest run server/services/ot/storeForward.uns.test.ts \
               server/services/edge/edgeGateway.test.ts \
               server/services/ot/storeForward.test.ts \
               server/services/edge/edge.test.ts
```

The edge tests assert: buffer-when-central-down, ordered idempotent backfill (no loss / no
dup), degraded heartbeat, the UNS-failure store-forward path, and a **source guard** that the
entrypoint imports no `express` / `socket.io` / aedes / `_core/index` and calls no `.listen(`.
