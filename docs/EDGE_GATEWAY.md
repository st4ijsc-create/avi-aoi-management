# Edge Gateway (Tầng-1 §5) — standalone edge node per line

> doc 44 · Batch W7-1 · gap **G1.14** — "tách edge gateway process thật" (the biggest
> Tầng-1 architecture gap). SYNAPSE Tầng-1 spec: `Chương 5 Edge Gateway & runtime`,
> `§5.2 mô hình triển khai`, `§2.1 / §17.2 biên tự chủ`.
>
> **doc 81 Đợt 10 (2026-10-13): the edge has NO central DB login any more** — no `DATABASE_URL`, `JWT_SECRET` or
> `SECRET_ENCRYPTION_KEY` on the edge host. Identity, owned devices and run packages come from central over the signed
> node protocol; local state is the journal. Sections 1–7 describe the W7-1 telemetry gateway; where they mention the DB,
> the edge_nodes registry or GitOps config on the edge, **section 8 supersedes them** (provisioning, ownership, cutover).

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

Each node runs its **own** edge-gateway container (each is a distinct Sparkplug Edge
Node). Point every gateway at the **central** EMQX and the **central HTTPS** node protocol — never at the DB (Đợt 10).

```bash
# 1) Build the edge image (from repo root)
docker build -f deploy/edge/Dockerfile.edge -t synapse-edge-gateway:latest .

# 2) Per node: .env.edge (from deploy/edge/.env.edge.example) + the node bundle (section 8.3), then one stack up
docker compose -f deploy/edge/docker-compose.edge.yml --env-file .env.edge --env-file /etc/avi-edge/edge-node.env up -d
```

Per-node values come from the bundle (`edge-node.env`): `EDGE_GATEWAY_NODE_CODE` (also the Sparkplug edge-node id),
`EDGE_CENTRAL_URL`, `EDGE_CENTRAL_NODE_ID`, `EDGE_CENTRAL_CREDENTIAL_ID`, the credential and pin host files.

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
| `EDGE_RUNTIME_ENABLED` | `false` | Node protocol (HTTP heartbeat, signed config, commands). Set `true` at the edge (compose does). |
| `EDGE_GATEWAY_NODE_CODE` | `edge-<hostname>` | Sparkplug edge-node id. The node's IDENTITY is central's signed config (Đợt 10). |
| `EDGE_GATEWAY_NODE_NAME` / `_FACTORY_CODE` / `_LINE_CODES` | — | **Ignored since Đợt 10** (identity / scope / devices come from central). |
| `EDGE_GATEWAY_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat cadence. |
| `EDGE_GATEWAY_CONFIG_FILE` | — | **Ignored on the edge since Đợt 10** (warns at boot); mapping-as-code is a central CLI (D13). |
| node protocol + journal | — | See section 8.5 (`EDGE_CENTRAL_*`, `EDGE_NODE_CREDENTIAL_FILE`, `EDGE_KEYSET_PIN_FILE`, `EDGE_JOURNAL_*`). |
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

0. **Đợt 10:** device ownership is now an explicit column — assign the adapters / robots to the node with
   `scripts/edge-device-owner.ts` (section 8.4); central then skips them (no double polling). Steps 2–3 below that mention
   the DB / `OT_GATEWAY_ENABLED` per adapter are the W7-1 procedure; follow section 8.6 for the Đợt 10 cutover.
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

## 8. The edge without a central DB login (doc 81 Đợt 10 — owner decisions 2026-10-12)

Since Đợt 10 the edge host holds **no `DATABASE_URL`, no `JWT_SECRET` and no `SECRET_ENCRYPTION_KEY`**. Central is the only
writer of run state, approvals, safety events, ledgers and audit. The edge drives only the devices it OWNS, and every
non-STOP actuation needs a fresh authorisation that central signed. **STOP is never gated (L-7).**

The Đợt 9 v1 path (the edge walking the central run row over its own DB login) is gone: a v1 node no longer executes runs
(ruling R-10-l — edge execution was OFF in production, so nothing is lost).

### 8.1 What is decided where

- **Central decides**, at a per-step `POST /api/v1/edge/node/runs/:id/authorize`: approval identity, binding digest,
  robot enabled / commissioning / policy / interlock, motion lock, ownership and revocation. The answer is a signed
  authorisation (Ed25519, `typ auth`), single use (`jti`), bound to (run, claim, step, attempt), to the exact payload hash
  of the command and to a nonce the edge issued; it is valid for **10 s measured from the edge's own request** (3–30 s,
  `EDGE_AUTH_TTL_MS` on central).
- **The edge decides** what only it can see: driver connected, its in-memory motion lock and slot, the safety-PLC
  preflight (from the safety configs in its signed config), readback and stop-watch — and it verifies the signed
  authorisation right before the driver call (signature, kid, `typ`, node, run / claim / step / attempt, payload hash, nonce
  pending, TTL, `jti` unused).
- **Everything the edge knows comes signed**: its identity, the devices it owns (with their connection secrets, sealed for
  this node), the safety configs, run packages, commands and keyset updates. A config signed for another node, a run package
  presented as an authorisation, an unknown kid or a rolled-back keyset is refused.
- **Local state is the journal** (§8.7), never a database.
- **One owner per device** (`robots."edgeNodeId"`, `device_adapters."edgeNodeId"`, mig 0374; NULL = central): the owner
  connects, ingests, controls and holds the motion lock. Central's `otManager` / `robotManager` skip edge-owned devices;
  central console motion on an edge-owned robot answers `ROBOT_OWNED_BY_EDGE`; central's STOP / lock / clear of an
  edge-owned device are queued to the node as signed commands.

### 8.2 Provision the signing key (CENTRAL host)

Central signs with a private key that lives in FILES only — never in the DB, never on argv. The DB table
`edge_auth_signing_keys` is an audit / distribution mirror (avi_app may only read it; a row planted there is never trusted).

Every write below is made by a **proven** active admin: `--actor <username>`, then the password and, with 2FA on, the
current code — at a hidden prompt, or PIPED on stdin (line 1 password, line 2 code), exactly as for the other operator CLIs
(§8.3, N7). `EDGE_SIGNING_ADMIN_PASSWORD` / `_OTP` are REFUSED (exit 2); `--by`, and any `--password…` / `--otp…` spelling on
the command line, are refused.

```bash
# 1. GENERATE the first key — it becomes the ROOT (active). Keyring dir mode 700, <kid>.pem mode 600.
npx tsx scripts/edge-signing-key.ts generate --dir /etc/avi/edge-keys --actor <admin>
# 2. Point EVERY central instance at it, then restart central:
#      EDGE_SIGNING_KEY_DIR=/etc/avi/edge-keys   EDGE_SIGNING_KEY_FILE=/etc/avi/edge-keys/<kid>.pem
# 3. PIN — the provisioning pin each edge trusts (the ROOT, at the current keyring version; file mode 444):
npx tsx scripts/edge-signing-key.ts pin --dir /etc/avi/edge-keys --out /root/edge-keyset.json --actor <admin>
#    (the node bundle, §8.3, writes the same pin for you)
# LIST — the files and the mirror side by side; every difference is printed ("the FILES are authoritative"):
npx tsx scripts/edge-signing-key.ts list --dir /etc/avi/edge-keys
```

**Rotate** (no edge re-provisioning — keyset updates are chained from the pinned root):
1. `generate` again ⇒ a `next` key (published to the edges in the next config cycles);
2. `rotate --activate <new kid>` ⇒ both active; wait **≥ 2 config cycles** so every edge has the new keyset;
3. point `EDGE_SIGNING_KEY_FILE` of every central instance at `<dir>/<new kid>.pem` and restart central;
4. `rotate --retire <old kid>` ⇒ kept in the keyset for `EDGE_KEY_RETIRED_GRACE_MS` (default 10 min ≫ auth TTL + skew),
   pruned later (the keyring holds at most 16 keys).

The ROOT is never retired: replacing it (e.g. after a compromise) means a new keyring and **re-provisioning every edge**
with a new pin. A compromised signing key can forge authorisations for every node — keep the key directory on central only,
mode 700, readable by central's service account.

### 8.3 Register a node, issue its credential and its bundle (CENTRAL host)

1. Apply migrations 0372 → 0375 and 0376 on the central DB (`node scripts/apply-migration-03xx.mjs --dev-only`, owner) —
   **only in the order of the cutover runbook (§8.13)**: the running pre-Đợt-10 build is stopped FIRST.
   ⚠ R-10-t: re-applying 0316 / 0363 / 0369 / 0370 / 0371 (or 0125 through `migrate-standalone`) after 0376 would un-pin
   its functions — those runners refuse unless given `--then-0376`, which re-applies 0376 right after.
2. Register the node (decision D14 — a proven admin only; the v2 gateway never registers itself):

   ```bash
   npx tsx scripts/edge-node-credential.ts register-node --node edge-line1 --factory FB --lines LINE1,LINE2        [--name "Line 1 gateway"] --actor <admin> --reason "commission line 1"
   ```

   The factory must exist and every line must be a production line OF THAT FACTORY; a node without a factory is given no
   device and no run. Re-running with the same factory / lines is a no-op ("unchanged"); a different factory or lines is
   refused (release the node's devices first, then change it deliberately). Audited `EDGE_NODE_REGISTER` (success / failure).

   **How the operator CLIs take the admin's secret (N7):** a hidden prompt on a terminal; without a terminal, PIPED STDIN —
   line 1 the password, line 2 the current 2FA code (`printf '%s
%s
' "$PW" "$CODE" | npx tsx scripts/…`, or `< file` with a
   0600 file). Never on the command line (any `--password…` / `--otp…` spelling is refused) and never in an environment
   variable: `EDGE_CRED_ADMIN_PASSWORD` / `_OTP` and `EDGE_OWNER_ADMIN_PASSWORD` / `_OTP` are REFUSED (exit 2). A wrong or
   replayed 2FA code is audited (`login_2fa` failure) and counted into the account lockout (N8): 5 wrong codes ⇒ the account
   is locked 15 min, exactly like 5 wrong passwords. `edge-signing-key.ts` follows the same rule (`EDGE_SIGNING_ADMIN_*` refused).
3. Issue the credential AND the bundle in one step, as a proven admin:

   ```bash
   npx tsx scripts/edge-node-credential.ts issue --node edge-line1 --actor <admin> --reason "commission line 1" \
       --bundle /root/edge-line1-bundle --keyring-dir /etc/avi/edge-keys \
       --central-url https://central.example:3000 [--edge-dir /etc/avi-edge] [--journal-max-bytes 67108864]
   ```

   It creates a NEW directory (an existing one is refused; nothing is changed then) holding:
   - `edge-node.cred` — the credential `edn_…` (mode 600, its ONLY copy — never on stdout, never in the DB: only its SHA-256);
   - `edge-keyset.json` — the keyset pin, built from the keyring FILES (mode 444);
   - `edge-node.env` — `EDGE_GATEWAY_NODE_CODE`, `EDGE_CENTRAL_URL`, `EDGE_CENTRAL_NODE_ID`, `EDGE_CENTRAL_CREDENTIAL_ID`,
     `EDGE_NODE_CREDENTIAL_HOST_FILE`, `EDGE_KEYSET_PIN_HOST_FILE`, `EDGE_JOURNAL_MAX_BYTES` — and nothing secret.
   The keyring is read and the pin built BEFORE anything is issued; a refused issue leaves no directory.
4. Move the bundle to the edge host under `/etc/avi-edge` (dir mode 700; `edge-node.cred` mode 600 and owned by the container's
   `app` uid: `docker compose -f deploy/edge/docker-compose.edge.yml run --rm --entrypoint id edge-gateway`; Windows:
   `icacls C:\avi-edge\edge-node.cred /inheritance:r /grant:r "<gateway account>:R"`), then delete the central copy.
5. **Rotate** the credential: `issue` → `rotate` with a new `--bundle` (no overlap: the old secret stops at the commit; copy
   the new `edge-node.cred` and `edge-node.env` to the edge right after). **Revoke**: `revoke --node … --reason …` (terminal).

### 8.4 Mark device ownership (CENTRAL host)

```bash
npx tsx scripts/edge-device-owner.ts assign  --robot 12  --node edge-line1 --actor <admin> --reason "commission line 1"
npx tsx scripts/edge-device-owner.ts assign  --adapter 7 --node edge-line1 --actor <admin> --reason "commission line 1"
npx tsx scripts/edge-device-owner.ts release --robot 12  --actor <admin> --reason "gateway replaced"      # back to central
npx tsx scripts/edge-device-owner.ts list    [--node edge-line1]
```

- Proven admin (prompt or piped stdin, §8.3 N7 — the environment variables are refused); a reason is required;
  every assign / release — done or refused — is an `audit_logs` row, and the WORM history `device_owner_changes` names the
  admin and the reason.
- A device goes only to a node of **its own factory** (robot: its station's line, else its own line → workshop → factory;
  adapter: machine → station → line → workshop → factory). Otherwise: `refused (cross-factory, R-10-am)` — fix the chain or
  the node's `factoryCode`.
- Refused while a robot job is running, or while an adapter has an UNRESOLVED write (an intent without a result, at any age;
  a `timeout` result or a legacy `sent` row younger than 10 min) — see §8.9 for an orphaned intent.
- The change bumps the owner epoch and **locks the robot** (`ownerChanged`) under its new owner: clear it there after
  checking the robot. Unacknowledged STOPs of the previous ownership are carried to the new edge owner; on a release to
  central, central executes them (in the CLI process when its control flags allow, and in any case by the server's sweep
  within 10 s). The running server applies the change live (NOTIFY `device_owner_changed`, reconcile ≤ 30 s).

### 8.5 Run the gateway

```bash
# .env.edge from deploy/edge/.env.edge.example (broker, journal size); edge-node.env from the bundle
docker compose -f deploy/edge/docker-compose.edge.yml --env-file .env.edge --env-file /etc/avi-edge/edge-node.env up -d
# run execution (non-STOP actuation under per-step authorisation) on top — only after the dot10 E2E + attack suites are green:
docker compose -f deploy/edge/docker-compose.edge.yml -f deploy/edge/docker-compose.edge.execution.yml \
    --env-file .env.edge --env-file /etc/avi-edge/edge-node.env up -d
```

| Env (edge) | Default | Purpose |
|---|---|---|
| `AVI_PROCESS_ROLE` | `edge` (entrypoint + image) | Every central-DB accessor refuses (counted, logged once; `EDGE_DB_TRAP=throw` in tests). |
| `EDGE_CENTRAL_URL` | — (required) | Central base URL. **https://** — plain `http://` is REFUSED unless the host is loopback (final fix wave M-4: the signed config carries this node's DECRYPTED device secrets and every request its node credential; signatures protect integrity, not confidentiality). |
| `EDGE_ALLOW_INSECURE_CENTRAL` | unset | `1` accepts plain `http://` to a non-loopback central — a LAB only; a loud warning at every start. Never in production. |
| `EDGE_PULL_INTERVAL_MS` | `2000` | UPPER bound of the agent's pull (200 ms … 300 s). The interval used is central's signed `limits.pullMs` (`EDGE_PULL_MS` on central, default 2 s), never above this bound: the env can make the pull faster, never slower. Commands (STOPs) reach the edge within one pull (design §2.8). |
| `EDGE_CENTRAL_NODE_ID` / `EDGE_CENTRAL_CREDENTIAL_ID` | — (required) | This node's `edge_nodes.id` and credential id (from the bundle). |
| `EDGE_NODE_CREDENTIAL_FILE` | `/run/secrets/edge_node_credential` | PATH of the credential (compose file-based secret; mode 600 on POSIX or refused). The secret in an env var (`EDGE_NODE_CREDENTIAL`) is refused. |
| `EDGE_KEYSET_PIN_FILE` | `/run/secrets/edge_keyset_pin` | PATH of the keyset pin. Missing / unreadable ⇒ no device starts. |
| `EDGE_JOURNAL_DIR` | `/app/data/edge-journal` | The journal (on the `edgedata` volume). |
| `EDGE_JOURNAL_MAX_BYTES` | `67108864` (64 MiB) | Journal bound (§8.7). |
| `EDGE_EXECUTION_ENABLED` / `FOE_ENABLED` | `false` | Run execution (overlay). |
| `EDGE_RUNTIME_ENABLED` | `true` (compose) | Node protocol on (also needed on central). |
| `EDGE_AUTH_TTL_MS` (central) | `10000` | Authorisation TTL (3–30 s). |
| `EDGE_PULL_MS` (central) | `2000` | The pull interval signed into every node's config (`limits.pullMs`, 0.5–60 s). |
| `EDGE_STOP_ACK_SLACK_MS` (central) | `2000` | A queued STOP not acknowledged within 3 × pullMs + this ⇒ a durable critical alert `stop_undelivered` (once per request). |
| `EDGE_STOP_DELIVERY_CHECK_MS` (central) | = `EDGE_PULL_MS` | How often central sweeps for unacknowledged STOPs. |
| `ROBOT_MOTION_LOCK_PENDING_DIR` (central) | `./data/robot-motion-lock-pending` | One fsynced marker per robot whose motion lock is not yet persisted (I-5): a restart with a marker and no DB row starts that robot LOCKED (`persistUnknown`). Keep it on persistent storage. |
| `EDGE_KEY_RETIRED_GRACE_MS` (central) | `600000` | How long a retired key stays in the keyset. |

Any missing piece ⇒ the gateway starts **no device** and says why once (fail-closed). `EDGE_GATEWAY_CONFIG_FILE`,
`EDGE_GATEWAY_FACTORY_CODE` / `_LINE_CODES` are ignored: identity, devices and mappings come from central's signed config
(mapping-as-code is a central CLI, D13).

**Device secrets in the config (D4, M-4).** The signed config snapshot carries the node's OWN devices' connection secrets,
decrypted centrally (`enc:v1:` values opened only for that node's devices). On the wire they are protected only by TLS — hence the
`https://` rule above; on the edge the cached config is sealed with the node credential (`EDGE_JOURNAL_DIR`, mode 600). A node
never receives another node's devices. Rotating a device password = change it centrally; the next config cycle ships it.

### 8.6 Cutover from Đợt 9 v1 (a node that still has the DB login)

1. Central: follow the **cutover runbook (§8.13)** — stop the running build, apply 0372 → 0376 (`--dev-only`), build, start;
   generate the signing key and set `EDGE_SIGNING_KEY_DIR` / `EDGE_SIGNING_KEY_FILE` on every central instance before the start.
2. Give the global seed row **`SIM-SAFETY-PLC-1`** (mig 0270: enabled, `scope 'sim'`, no factory, no target) a factory /
   targets, or **disable it**. While it is enabled, central applies it to every target but can never hand it to an edge
   (an untargeted row without a factory is never shipped), so **every real-mode, preflight-on edge authorisation is refused**
   (`device_refused {safety}`, R-10-aw).
3. Mark device ownership (§8.4). Re-issue each node's credential with `--bundle` (§8.3).
4. On each edge host: replace `.env.edge` from the template; **remove `DATABASE_URL`, `JWT_SECRET` and
   `SECRET_ENCRYPTION_KEY`** (from `.env.edge`, the shell, any override file). The gateway warns at boot while
   `DATABASE_URL` is still set — even unused, it is a live password on that host.
5. **Rotate the `avi_app` password** on the central DB and update central's `DATABASE_URL`: removing the variable does not
   revoke what the edge hosts already know.
6. **Firewall `:5432`** (the central Postgres) from the edge / OT subnet.
7. Turn `EDGE_EXECUTION_ENABLED` on only after the dot10 E2E and attack suites are green.

### 8.7 The journal: sizing, durability, Windows

- Append-only JSONL segments + an atomically renamed `state.json`. `auth.consumed` is fsynced BEFORE the driver call; lock
  events at once; the rest by group commit (≤ 50 ms; a STOP never waits past its DB step bound). Only DURABLE records are
  shipped; central dedupes by (epoch, stream, seq) + content hash and refuses a same-seq different-content record (409).
- **Full** (bytes on disk + queued ≥ `EDGE_JOURNAL_MAX_BYTES`): no new non-STOP actuation, `auth.consumed` refused,
  robot_state dropped (counted); step / STOP / lock / event records are still appended — **never dropped** — and health
  reports degraded. STOP is unaffected. Compaction deletes only closed segments every record of which central acknowledged.
- **Sizing**: records are a few hundred bytes; size for the longest central outage you must ride with runs active
  (step + event records accumulate until central acknowledges them) plus robot-state samples (dropped first). 64 MiB holds
  on the order of 100 000 records; raise it for many robots or long outages, and watch the degraded health.
- **Windows hosts**: there is no directory fsync (renames use MoveFileEx without write-through), so a rolled segment or the
  snapshot rename may not survive a power cut. The journal does not depend on it: EVERY start opens a new epoch (seq never
  reused), un-acknowledged durable records of earlier epochs are shipped under their own epoch, an unreadable journal is
  moved aside and every robot starts LOCKED (`persistUnknown`). Prefer Linux hosts with a journaling FS for edge gateways.

### 8.8 Degraded STOP authentication on central (R-10-bb / R-10-be) — and its limits

The console STOP (`robot.consoleStop`, the ONLY user of it) verifies the session JWT statelessly first, then runs the session
/ permission / factory-scope reads in parallel under 300 ms. If the DB does not answer in time, a valid unexpired token whose
**remembered** identity (from a full authentication of the same session in the last 15 min — memory, per session, LRU 5000)
passes the actuation role floor + 2FA and carries machine_control may still **STOP** — audited (retried) with a durable
critical alert "STOP accepted on degraded auth". Limits, said plainly:
- **STOP only — never MOVE**; motion keeps the full chain and refuses when the DB is unreachable.
- **Nothing remembered ⇒ refused** (a user who has not used the app in the last 15 min, or right after a central restart).
- A logout / revoke / disable / role-permission-scope change invalidates the memory **of this process** (per user / session,
  with a tombstone against late writes); another replica keeps its own memory until its TTL (≤ 15 min).
- Factory scope: the DB scope when readable, else the remembered scope + robotManager's robot → factory map; refused only
  when both are known and differ; unknown ⇒ allowed with an anomaly audit (L-7: a STOP is never lost to a scope read).
- A robot with no live session here and a dead DB: no STOP can be sent from central (truthful alert) — use the machine's own
  E-STOP. The certified safety-PLC remains the safety function.

### 8.9 Resolve a STOP / an orphaned write (admin or supervisor)

Robot Control → **"Pending STOPs and orphaned writes"** (tRPC `edgeResolution.*`; admin / supervisor with 2FA +
machine_control:canEdit; your factory scope; the audit row is written in the same transaction as the change):
- The panel lists every unacknowledged STOP (`device_pending_stops`) with its flags: **needs resolution** (refused / failed —
  never retried automatically), **owner cannot list** (the edge owner cannot reach the device; central executes it),
  **overdue** (a STOP never expires — still owed), **undeliverable** (its node has no active credential).
- **Record resolution** (refused / failed STOPs only): only after the device was stopped another way and checked on site.
  A's guarded `edge_stop_resolve` records who and why; the STOP stays listed as resolved by a person. A pending STOP cannot be
  closed by hand — it is executed.
- **Orphaned OT write intent** (a write-ahead intent with no result: the process died mid-write) blocks the adapter's
  ownership change for ever. Once it is ≥ 10 min old, **Record unknown outcome** appends its RESULT row (status `timeout` =
  outcome unknown, linked by `intentId`, nothing edited or deleted) with your reason. The owner change is possible again
  after the DB's 10-minute stale-write window (that `timeout` result holds it like any other). Check the real value on the
  device first. The result row is written ONLY by the guarded `ot_write_intent_resolve` (it re-checks the actor, the reason,
  the 10-minute age and "no result yet"; a direct INSERT of such a row is refused).
- **Late device result** (A fix round 11, R-10-bl): if the device's REAL result arrives after that manual resolution, the DB
  keeps it as evidence (`command_log` ledger `late_result`, never lost, its own key `late:<id>:<key>`) and **holds the adapter's
  ownership change until a person reviews it** — independent of the 10-minute window. The panel lists it under "Write results
  that arrived AFTER an 'outcome unknown' resolution"; **Mark reviewed** (admin / supervisor + 2FA, machine_control:canEdit,
  your factory scope, a note ≥ 3 characters, audited in the same transaction) calls the guarded `ot_write_late_result_review`
  (WORM `ot_write_late_result_reviews`, once per row). Compare the device's real value with what the run assumed before
  marking it.

### 8.10 Retention of the Đợt 10 WORM tables (R-10-an)

None yet. `edge_node_report_records` (one row per accepted record: (node, stream, epoch, seq) + content hash),
`edge_stop_ack_refusals`, `central_stop_executions`, `device_owner_changes` and `edge_step_authorizations` are append-only
and are not pruned in this đợt — volume is bounded by edge traffic. Watch their size; a retention job (partition + drop by
age, kept ≥ the audit horizon) is backlog.

### 8.11 What this does NOT protect (said plainly)

- A compromised edge host still controls **its own** devices directly and can misreport its own telemetry and its own
  controllers' program checksums (change detection, not tamper-proofing). It can no longer read or write any central row,
  approvals, runs or devices of other nodes, users, API keys, or forge a trusted safety event.
- Central down ⇒ non-STOP steps are **held** (D5); STOPs still go out. The interlock evaluated on central sees edge telemetry
  a few seconds late.
- Robot e-stops ingested from an edge are plain safety events (no `safety_event_trust`) unless a maker-checker approval per
  (node, robot) exists (D6, mig 0375).

### 8.12 STOP delivery and the console (doc 81 Đợt 10 final fix wave)

- **Pull, STOPs first (I-1, R-10-bs).** Central reads a node's commands (STOPs first) BEFORE any run work; a failure there is 503.
  A failure in the run side (an unsignable sweep picture, a transient analysis read) never fails the pull: the STOPs are
  delivered and the answer says `runStateUnavailable: true`. While it is set the edge HOLDS every non-STOP work — no lock / clear
  command, no claim, a walking run's next non-STOP step is held (not even asked) — and never reads a missing section as "no abort".
- **Cadence (I-2, M-8).** The agent pulls every `limits.pullMs` (2 s). A STOP whose target needs a config refresh runs in the SAME
  pull, even while an older work phase is still busy.
- **Console STOP to an edge-owned robot (I-3).** Queued for the owning node. If central cannot reach that node (no pull seen here
  within 3 × pullMs, else a heartbeat older than max(3 × pullMs, 2 × heartbeatMs), or unreadable), the answer is
  `queued_edge_unreachable` — a WARNING in the console, never a green "accepted" — central's fallback STOP is sent at once
  (its session, else a transient one), and a durable critical alert is raised. Any STOP not acknowledged within 3 × pullMs + 2 s
  raises the same alert (one per request); it stays queued and is delivered when the node pulls. `queued_on_edge` shows as
  pending, not as done.
- **OT STOP to an edge-owned adapter (I-4).** Central's OT dispatcher (console, interlock auto-block, a central run's abort) no
  longer answers `ADAPTER_OFFLINE` for it: a stop / e_stop is QUEUED for the owning node (result `ADAPTER_OWNED_BY_EDGE` +
  `edgeStopRequest`, durable alert); if it cannot be queued, central writes the adapter's PINNED stop values on a transient
  session (R-10-ay) + a critical alert. A non-STOP write is refused `ADAPTER_OWNED_BY_EDGE`. There is no separate OT console STOP
  button: the OT console STOP goes through the same dispatcher and is routed this way.
- **Operator lock (M-5).** `robot.requestMotionLock` (machine_control:canEdit, a reason, audited first, the caller's factory
  scope — fail-closed) holds a robot: queued as a signed `lock` for an edge-owned robot, set in memory (and persisted) for a robot
  with a session here. An operator lock (`centralLock`, also when added on top of an existing lock) is NOT cleared by a
  confirmed STOP — only by the audited `robot.clearMotionLock`.
- **Central connect (M-1).** If the robots' edge ownership cannot be read, central connects to NONE of them (an alert; the
  ownership reconcile attaches the central-owned ones within 30 s).

### 8.13 Cutover runbook — central build + migrations 0372–0376 (owner, in this order)

**Why the order (I-5).** 0374's `robot_motion_lock_writer_guard` refuses every `robot_motion_locks` INSERT without a writer
instance id — `INSERT … ON CONFLICT DO UPDATE` included. The pre-Đợt-10 build (today on :3000) writes none: under 0374 its lock
persist FAILS (logged) and an outcome-unknown lock taken then would be gone after the restart. The Đợt 10 build tolerates a DB
without 0372–0376 (narrow projections, `isEdgeControlSchemaMissing`; only log noise, M-2: said once), and it never starts a robot
unlocked after a persist that did not land (I-5: the pending marker ⇒ `persistUnknown`).

**Before (read-only, on dev):**
1. Duplicate RESULT rows per OT intent must be **0** — `0374` builds `CREATE UNIQUE INDEX` on that link and would abort the
   whole file otherwise:
   ```sql
   SELECT "ackValue"->>'intentId' FROM command_log
   WHERE "ackValue"->>'ledger'='result' AND "ackValue" ? 'intentId'
   GROUP BY 1 HAVING count(*)>1;   -- must return no row
   ```
   Any row: resolve those intents first (keep the evidence; do not delete ledger rows) — then re-run the query.
2. **0125 / 0327 (M-3).** On dev `0125` is `success = false`. Do NOT just record it: `migrate-standalone` now proves the 0327
   body of `app_tenant_allows` (the NULL/NULL shared-data branch) before recording 0125, and REFUSES (exit 1, nothing applied)
   when a past 0125 re-run reverted it. Then: `node scripts/apply-migration-0327.mjs` (owner) and afterwards 0376
   (`--then-0376` / `apply-migration-0376.mjs --dev-only`), and run `migrate-standalone` again.
3. **SIM-SAFETY-PLC-1** (mig 0270: enabled, `scope 'sim'`, no factory, no target) — owner decision before any preflight-on edge
   execution: give it a factory / targets, or disable it. While it is enabled central applies it to EVERY target and can never ship
   it to an edge ⇒ every real-mode, preflight-on edge authorisation is refused `device_refused {gate: safety}` (R-10-aw).
   (The test harnesses disable only this row, only on `_test`, through `__edgeSeedGuard.dot10.ts`.)

**The cutover (a quiet window — M-6):**
1. **Stop :3000** (the running pre-Đợt-10 build). Nothing may write `robot_motion_locks` between step 2 and step 4 with the old code.
2. **Apply 0372 → 0373 → 0374 → 0375 → 0376** in that order, each `node scripts/apply-migration-03xx.mjs --dev-only` (owner `aoi`,
   `lock_timeout` 5 s, `statement_timeout` 60 s, one implicit transaction per file; every file verifies itself as avi_app and
   writes exactly one ledger row; re-running a file is idempotent). **M-6:** 0374's unique index on `command_log` is built
   NON-concurrently inside that transaction — it holds a SHARE lock that blocks OT ledger writes until it is done (bounded by the
   60 s statement timeout; on a timeout everything rolls back and nothing changed). Apply in the quiet window, with :3000 stopped.
   ⚠ R-10-t: never re-apply 0316 / 0363 / 0369–0371 (or 0125) after 0376 without `--then-0376`.
3. **Build** the Đợt 10 code (`npm run build` — it stops nothing that is still running once :3000 is down).
4. **Start** central; check the log: no `persistUnknown` storm (a robot that starts LOCKED `persistUnknown` had a lock whose
   persist did not land — check it, then clear it with the audited action), no `0374 not applied` line.
5. Then §8.3 (keys, nodes, bundles) and §8.4 (ownership). Keep `EDGE_EXECUTION_ENABLED` off until the dot10 E2E + attack suites are
   green on the release.

**Rehearsed (I-7, 2026-10-13):** the final 0372–0376 applied in order onto a scratch database brought to the 0371 state by the
repo's own runner, then re-applied (idempotent) — see `.superpowers/sdd/2026-10-12-engineering-control-dot10/final-fix-wave-report.md`.
