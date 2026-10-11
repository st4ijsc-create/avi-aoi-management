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

## 8. Run execution on the edge (doc 81 Đợt 9 task S — owner decision 2026-10-12)

By default the gateway only reads, publishes and buffers. With **`EDGE_EXECUTION_ENABLED=true`** it also **executes the
orchestration runs central hands to this node** — through the same engine, the same gates and its own device connections.
Everything below is OFF until an operator turns it on, and nothing starts without the node's own credential.

### 8.1 How it works (what is decided where)

- **Topology.** The gateway's `DATABASE_URL` is the **central control-plane DB** (§3, compose file). The node therefore
  executes **the central run row itself** — same run id, same workflow id (the *ID mapping*, migration 0370). No copy run
  is ever created on the edge.
- **Assignment.** A run is handed to a node when it is started: tRPC `orchestration.startRun({ …, edgeNodeCode })` or
  API v1 `POST /api/v1/orchestration/runs { workflowRef, params, edgeNodeCode }`. The node must be inside the starter's
  factory scope (a node with no `factoryCode` only for an unrestricted user / global key). The run is created `queued`
  with its edge assignment in one transaction; **central never walks it**.
- **Pull → claim → walk → report** (`/api/v1/edge/node/*`, authenticated **only** by the node's credential):
  1. `pull` — the node's claimable runs, each with the **definition snapshot** and **central's binding digest**;
  2. the node checks locally: snapshot hash = assignment = the workflow row in its DB, and **its own** binding digest (its
     drivers read the controllers' program checksums) = central's. Any difference ⇒ it does not claim;
  3. `claim` — compare-and-set `queued → running` and a fresh claim token (only its SHA-256 is stored);
  4. the node walks the run with the shared engine: **approval with the API-key identity rule, binding digest, program
     checksum, R-4-x and the STOP exemptions are the same code over the same rows as central.** Before every **non-STOP**
     command it asks the run guard (claim current, credential active, central has not stopped the run). A STOP never asks;
  5. `progress` every `EDGE_ABORT_POLL_MS` (claim-bound, strictly increasing sequence; a replay is refused) — the answer
     carries `abortRequested`; `complete` when the segment ends (decided by the run row, never by the report).
- **Gates.** An un-approved `hitl_gate` pauses the run (`awaiting_confirm`); the approver approves it in the Studio as
  usual (screen-bound to central's digest). The run goes back to `queued` and the node claims the next segment.
- **Abort / reject (L-7).** Central's abort writes `aborted` and runs its own STOP sweep (central usually cannot reach the
  line's devices — those STOPs are recorded as failed there). The node learns it from the next protocol answer **or from
  the run row** (run guard / progress fallback): its walker stops at once — no further non-STOP step — and the node's own
  sweep **sends the remaining STOP steps and due STOP compensations** through its dispatchers. A STOP confirmed sent by
  either side is never shown as failed by the other. A run is never moved out of `aborted`.
- **Abort while no walker is left** (the run was paused at a gate, or between segments, when central aborted it): the next
  `pull` lists it under `stopsUnconfirmed` when central's own sweep could not confirm a STOP; the node re-sends exactly those
  STOPs through its dispatchers (the engine's re-send: never a STOP already confirmed, only within the 15-minute re-send
  window, at most once per `EDGE_STOP_RESEND_MIN_MS`).

### 8.2 Provision a node credential (on the CENTRAL host)

1. Apply migration 0370 to the target DB (`node scripts/apply-migration-0370.mjs --dev-only` — owner decision).
2. Make sure the node is registered (it registers itself on its first heartbeat, or `edgeRuntime.registerNode`) with its
   `factoryCode` set — runs are only handed to nodes inside the starter's factories.
3. Issue the credential as an **active admin** (the actor is checked and recorded), writing the secret to a NEW file
   **outside the repo checkout** (never into the repository — `*.cred` and `deploy/edge/secrets/*` are git-ignored as a
   safety net only):

   ```bash
   npx tsx scripts/edge-node-credential.ts issue --node edge-line1 --actor-user-id <admin id> \
       --reason "commission line 1 gateway" --out /root/edge-line1.cred
   ```

   The secret (`edn_<12 hex>.<43 chars>`) exists **only** in that file (created mode 0600; an existing file is refused).
   The DB keeps its SHA-256; audit rows keep the prefix only.
4. Move the file to the edge host, **outside any repo checkout**, readable only by the gateway's account, then delete the
   central copy:
   - Linux: `sudo install -d -m 700 /etc/avi-edge && sudo install -m 600 -o <app uid> edge-line1.cred /etc/avi-edge/edge-node.cred`
     (the container's `app` uid: `docker compose -f deploy/edge/docker-compose.edge.yml run --rm --entrypoint id edge-gateway`);
   - Windows: `icacls C:\avi-edge\edge-node.cred /inheritance:r /grant:r "<gateway account>:R"`.

   The gateway reads it ONLY as a file (`EDGE_NODE_CREDENTIAL_FILE`; a secret in an environment variable is refused) and
   **refuses to start execution if the file is readable or writable by group / others** (POSIX). On Windows it cannot check
   and logs a warning naming the `icacls` command.
5. **Rotate** (no overlap — the old secret stops at once; update the edge right after):
   `npx tsx scripts/edge-node-credential.ts rotate --node edge-line1 --actor-user-id <id> --reason "…" --out /root/new.cred`
6. **Revoke** (terminal; the node can no longer pull, claim or report, and its in-flight non-STOP steps are refused):
   `npx tsx scripts/edge-node-credential.ts revoke --node edge-line1 --actor-user-id <id> --reason "…"`
7. **List** (never shows a hash): `npx tsx scripts/edge-node-credential.ts list --node edge-line1`.
   A node that executed runs cannot be deleted — revoke its credential instead.

### 8.3 Run the gateway with execution on

Add the overlay — it turns execution on and hands the credential to the container as a compose **file-based secret**
(`/run/secrets/edge_node_credential`; only its PATH is in the environment):

```bash
export EDGE_NODE_CREDENTIAL_HOST_FILE=/etc/avi-edge/edge-node.cred EDGE_CENTRAL_URL=https://central.example:3000
docker compose -f deploy/edge/docker-compose.edge.yml -f deploy/edge/docker-compose.edge.execution.yml --env-file .env.edge up -d
```

| Env (edge) | Default | Purpose |
|---|---|---|
| `EDGE_EXECUTION_ENABLED` | `false` | Turns run execution on. Off ⇒ the gateway is read + publish + buffer only. |
| `EDGE_CENTRAL_URL` | — | Central server base URL (`https://…`; use TLS — the abort signal travels in its answers). |
| `EDGE_NODE_CREDENTIAL_FILE` | — | PATH of the node secret file (mode 600 on POSIX, else refused). `EDGE_NODE_CREDENTIAL` (the secret in the env) is refused. |
| `FOE_ENABLED` | `false` | Must be `true` on the edge (the engine executes the runs). |
| `EDGE_RUNTIME_ENABLED` | `false` | Must be `true` (also on central — the node routes answer 503 otherwise). |
| `ROBOT_GATEWAY_ENABLED` / `OT_GATEWAY_ENABLED` | `false` | The edge's own device connections (its dispatchers). |
| `EDGE_PULL_INTERVAL_MS` | `5000` | How often the node asks for work. |
| `EDGE_ABORT_POLL_MS` | `2000` | Progress / abort-signal cadence while a run walks (50 ms – 60 s). |
| `EDGE_MAX_CONCURRENT_RUNS` | `4` | Runs walked at once. |
| `EDGE_REQUEST_TIMEOUT_MS` | `10000` | Per-request bound. |
| `EDGE_STOP_RESEND_MIN_MS` | `10000` | Minimum time between two re-sends of the unconfirmed STOPs of one aborted run. |
| `EDGE_GUARD_DEADLINE_MS` | `2000` | Bound of the run-guard read before a non-STOP command (past it ⇒ that command is refused). |
| `EDGE_CLAIM_STALE_MS` (central) | `30000` | A claim with no progress for this long may be declared interrupted by its node. |

Any missing piece (flag, URL, credential, `FOE_ENABLED`) ⇒ the agent starts **nothing** and says why once in the log.
Run **exactly one** executing gateway per node code.

### 8.4 Offline behaviour and limits (said plainly)

- **Central unreachable ⇒ no new run is started** (nothing is claimed without central). A run already walking goes on; its
  non-STOP steps are still gated by the run guard, which reads the run row: a central abort written while the HTTP link is
  down still stops them, and from then on only STOP steps and STOP compensations go out.
- **Database unreachable too** ⇒ the guard cannot decide ⇒ every further non-STOP command is refused (the step fails, the
  run fails and compensates; STOPs still go). The edge cannot act on a run it cannot read.
- **Gateway restart mid-walk** ⇒ the walker is gone; once the claim has had no progress for `EDGE_CLAIM_STALE_MS` the node
  declares it interrupted ⇒ the run is `held` (a person may Continue — the node then claims a new segment). It is never
  re-walked silently.
- **Program checksum.** The claim compares the node's binding digest with central's: a checksum-capable controller that
  central cannot read (no route from central to the line) makes the digest unreadable ⇒ such a run is not claimed — and
  could not be approved either (the approver's screen needs central's reading). Give central read access to those
  controllers, or leave checksum verification off for them.
- **Trust boundary.** The node credential binds the protocol to ONE node (scope, claims, reports). It is **not** a boundary
  against a compromised edge host: that host holds the control-plane `DATABASE_URL` (pre-existing in this topology).
  Restricting the edge's DB role is a separate step, not in this đợt.
- **Two gateways with the same node code** are a misconfiguration: the run guard makes a walker whose claim was taken over
  let go without writing, but both would poll the same devices (§6).
- A run handed to a node that never comes back stays where it is: abort it centrally (STOPs from central, if it can reach
  the devices) and use the machines' direct STOP / E-STOP.
- The Studio has no "run on edge node" picker yet: assign through the tRPC / API v1 `edgeNodeCode` field.
