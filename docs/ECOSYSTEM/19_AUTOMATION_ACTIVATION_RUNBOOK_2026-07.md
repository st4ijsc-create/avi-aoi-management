# 19 — Automation Ecosystem: Activation Runbook (V1)

> Staged flag-enable + smoke-validation runbook for the Automation Orchestration upgrade.
> Branch: `automation-orchestration-r0` · Date: 2026-07-01 · Scope: doc 18 §6 Group B (V1).
> Migrations 0141–0150 are ALREADY applied to the dev DB. Demo rows are seeded by
> `scripts/seed-automation-demo.mjs`. **No product code changes here — this is an
> operations document.**

---

## 0. Golden rules (read first)

- **Everything is flag-OFF by default.** Each new capability is a complete no-op until its
  `*_ENABLED` env flag is set to `true`. Enabling a flag only *surfaces* already-built,
  already-gated code — it does **not** add an autonomous device-control path.
- **No new device-control path.** Every actual robot/machine command still routes through the
  existing gated dispatchers (`robotCommandDispatcher` / `commandDispatcher`, dry-run + HITL +
  idempotency). The new tables are orchestration/monitoring **STATE** only.
- **Seed rows are harmless demo data.** They are inert until a flag is on, and they carry a
  `scope='demo'` tag (where the column exists) so they are trivially identifiable and deletable.
- **Enable ONE flag at a time, in the order below, smoke-check, then proceed.** Rollback is
  always: set the flag back to `false` and restart — the feature reverts to inert.
- **Honest seams remain honest.** Anything requiring real hardware (a registered robot, a real
  glTF asset, a FOCAS/Euromap connector, a Safety PLC) is *not* faked. Where a smoke step needs
  a real device that dev doesn't have, it is marked **(needs real device)**.

---

## 1. One-time prep — seed the demo data

```bash
# from the repo root, with DATABASE_URL set in .env (dev DB)
node scripts/seed-automation-demo.mjs
```

The seed is **idempotent** (`ON CONFLICT DO NOTHING` / existence checks keyed on the unique
`code`/`modelKey`/`taskKey`) — re-running is safe and prints an inserted/skipped tally per table.
It anchors to **real** existing ids (factory/line/station/machine/user/skill/program) and never
fabricates FK ids. What it seeds (dev DB result 2026-07-01, anchor factory `FAC-HN` id=2):

| Table | Rows | Notes |
|---|---|---|
| `zones` | 4 | production / transit / charging / human_shared, with `maxConcurrentRobots` + bounds |
| `operation_codes` | 3 | `PICK_PLACE`, `SCREW_DRIVE`, `INSPECT_AOI` (real skill ids, toolType, cycle ms) |
| `operation_program_map` | 1 | PICK_PLACE → a real `program_projects` row (scara) |
| `program_variants` | 3 | A / B / control split on that program |
| `shared_resources` | 3 | gripper / jig / fixture, status `available` |
| `charger_stations` | 2 | tied to the charging zone |
| `equipment_3d_models` | 2 | 1 machine-bound + 1 class fallback; **`conversionStatus='external'`, PLACEHOLDER glTF URI (no real asset)** |
| `operator_assignments` | 2 | real operator users on the line/station (1 active, 1 planned) |
| `tasks` | 2 | status `pending`, `assignedDeviceId=NULL` — Fleet queue shows a real backlog |

**Left intentionally EMPTY (runtime-generated — never seeded):** `safety_events`,
`collaboration_sessions`, `zone_reservations`, `resource_reservations`,
`battery_charging_plans`, robot anomalies, model rollbacks.
**Not seeded here:** `device_types` / `alarm_taxonomy` — E1 seeds `device_types` from
`capabilityModel` and ships the ISA-18.2 taxonomy through its own service/CI when `EQ_GOVERN` is
enabled (§2, step 5). Hand-seeding would duplicate that.

**Anchor honesty (dev DB):** `robots` is **EMPTY** in dev. So tasks are seeded `pending` with a
NULL device, and NO robot-FK rows (charging plans, safety events, collaboration sessions) are
fabricated. To exercise allocation/charging/collaboration end-to-end you must first register a
real (or `vendor='sim'`) robot — see the golden thread §3 seams.

---

## 2. Staged flag-enable order + per-flag smoke assertions

Enable in `.env` (the operator's step — **this runbook does not modify `.env`**), then restart
(`npm run dev`). Flags are read as `=== "true"` (or `"1"` for the ERP ones). All new pages are
`RouteGuard`-gated on the `machine_monitoring` permission, so smoke-check as an admin/supervisor.

> Order rationale (doc 18 §6 V1): fleet core → resource layer → twin → safety/workforce →
> governance → integration → field → AI closed-loop → ERP gateway → PdM. Each layer builds on the
> state the previous one surfaces.

### Step 1 — `FLEET_ORCH_ENABLED=true`  (Khối 2 core — G1)
- **Turns on:** the Dynamic Task Allocation engine + Zone/Traffic manager; the `order.created`
  → task decomposition hook; the Fleet page data.
- **Check:** **`/fleet-orchestration`** → the **Tasks** queue shows the 2 seeded `pending` tasks;
  the **Zones** view shows the 4 seeded zones with their concurrency caps.
- **Smoke assertion:** the 2 demo tasks render as `pending`. Creating a task (or firing an ERP
  order, §2 step 10) yields a `pending` row; with a registered robot, the allocator moves it to
  `assigned` (**needs real/sim robot** for the assign step). No device command is emitted.

### Step 2 — `FLEET_RESOURCE_ENABLED=true`  (Khối 2 resource/skill/charging — G2)
- **Turns on:** Operation→Skill→Program registry, A/B variant picker, shared-resource
  reservations, predictive charging planner + charging cron.
- **Check:** **`/fleet-orchestration`** resource tabs → **Operations** (3 codes), **Resources**
  (3 shared resources, `available`), **Chargers** (2, in the charging zone), **Variants** (A/B/control).
- **Smoke assertion:** the operation codes resolve `requiredCapability` + skill ids; reserving a
  shared resource flips its derived availability and a second claim queues (FIFO). Charging plans
  stay empty until a robot's projected battery dips below the floor (**needs real/sim robot**).

### Step 3 — `TWIN_LIVE_ENABLED=true`  (Khối 7 — T1)
- **Turns on:** the model-registry resolve, scene-graph builder, WS twin stream
  (`twin:{factoryId}` room, ≤10 Hz), and the replay scrubber.
- **Check:** **`/digital-twin-center`** → the scene renders the zone→station→device graph; the
  seeded machine shows its registered model entry.
- **Smoke assertion:** because the seeded model is `conversionStatus='external'` with a
  **placeholder** URI, the drei loader **falls back to a primitive block** (honest — no real glTF
  ships). The live stream animates only when telemetry flows (**needs real/sim device**); the
  replay scrubber works against any recorded Timescale window.

### Step 4 — `SAFETY_AUDIT_ENABLED=true` + `WORKFORCE_ENABLED=true` + `ANDON_ROBOT_DISPATCH_ENABLED=true`  (Khối 3 — S1)
- **Turns on:** the SIL-tagged **advisory** `safety_events` log + e-stop/interlock hook; the mixed
  workforce board + `operator_assignments` (double-book + skill-match checks); the collaboration
  handover FSM; and the Andon→robot dispatch bridge (still routes through the gated dispatcher).
- **Check:** **`/safety-workforce`** → the workforce board shows the 2 seeded assignments (1
  active, 1 planned); the safety-events panel is **empty** (correct — events are runtime-only).
- **Smoke assertion:** creating an overlapping assignment for the same operator is **blocked**
  (double-book); a station skill mismatch **warns, not blocks**. Every `safety_events` row is
  `outcome='logged_only'` by default — **advisory only, NOT a safety-rated stop** (doc 18 N-4).
  Andon→robot dispatch produces a *gated* (dry-run/HITL) job, never an autonomous move.

### Step 5 — `EQ_GOVERN_ENABLED=true`  (Khối 5 — E1)
- **Turns on:** the versioned Device Type registry (seeded from `capabilityModel`), the ISA-18.2
  alarm taxonomy, and the Standards-Board change-request workflow + conformance gate.
- **Check:** **`/equipment-standards`** → the device-type hierarchy populates (Equipment → Robot →
  CollaborativeRobot, plus AOI/CNC classes); the alarm taxonomy lists the seeded vendor mappings.
- **Smoke assertion:** a change request walks `pending → in_review → approved → published` and a
  publish that removes/alters a published field is **flagged backward-incompatible** (requires a
  major SemVer bump). Governance metadata only — no device-control path.

### Step 6 — `EQ_INTEG_ENABLED=true`  (Khối 1B — I1)
- **Turns on:** the FOCAS + Euromap **read-only frameworks**, recipe versioning + genealogy, and
  alarm normalization wiring E1's taxonomy into Andon.
- **Check:** **`/equipment-integration`** → the integration panels render; recipe versioning shows
  the genealogy view.
- **Smoke assertion:** the FOCAS/Euromap snapshot returns `source:'none'` honestly (no fabricated
  machine data) until a real connector/sidecar exists (**needs real device / Fwlib32 / Euromap
  connector**, doc 18 N-1). A normalized alarm maps a native code → standard code via `mapAlarm`.

### Step 7 — `FIELD_V2_ENABLED=true`  (Khối 1 — X1)
- **Turns on:** the UDM extension surface (battery / joint_states / safety_zone_id / firmware /
  last_heartbeat), the heartbeat liveness sweep, the tiered device push-stream, hot-plug
  discovery, and command-level authz (fail-closed; does **not** weaken the HITL gate).
- **Check:** **`/field-devices`** → the device list + health/staleness view renders.
- **Smoke assertion:** devices without a heartbeat show as `stale` after the TTL; `joint_states` /
  `firmware` render as honest `NULL` until a driver supplies them (doc 18 N-5). OPC-UA hot-plug
  discovery works against a real OPC-UA endpoint; other transports are seams (**needs real device**).

### Step 8 — `DPC_IR_V2_ENABLED=true`  (Khối 6 — D1, IR/Transpiler)
- **Turns on:** the IR programming layer (motion/IO block AST), the semantic safety linter, and
  the URScript / ROS2 transpilers — all flowing through the **existing** programming/deploy gate.
- **Check:** **`/ir-editor`** → the IR editor loads; a sample IR program lints and transpiles.
- **Smoke assertion:** the safety linter flags speed/workspace/torque violations; transpile emits
  URScript/ROS2 for review. Deploy still requires the existing HITL 2-eyes gate (doc 09) — no
  autonomous download. *(Note: D1 is listed in doc 18 §6 Group A as software-remaining; the flag
  exists and is inert until enabled — include it here for completeness of the staged order.)*

### Step 9 — `AI_ROBOT_ANOMALY_ENABLED=true` + `AI_MODEL_AUTOROLLBACK_ENABLED=true`  (Khối 4 — I2)
- **Turns on:** robot-behavior anomaly detection (trajectory / grip-force / cycle-time drift,
  advisory) and the model auto-rollback sweep (drift → roll back to the last stable version).
- **Check:** **`/robot-model-health`** → the anomaly + model-health panels render; the rollback
  history is **empty** (correct — runtime-generated).
- **Smoke assertion:** with a registered robot emitting telemetry, an injected trajectory/cycle
  anomaly raises an **advisory** record (no stop). A modeled accuracy drop past the threshold
  triggers a rollback entry. Manual rollback is a HITL action. (**needs real/sim robot + model
  telemetry** to fire naturally.)

### Step 10 — `ERP_INBOUND_ENABLED=true` + `ERP_OUTBOX_ENABLED=true`  (Khối 0 — R0)
- **Turns on:** the `/api/v1/orders` + `/api/v1/bom` inbound intake (idempotent, schemaVersion)
  and the durable outbox drain worker (circuit-breaker).
- **Check:** `POST /api/v1/orders` with a demo order → **`/fleet-orchestration`** shows a new
  `pending` task decomposed from it (needs Step 1 on).
- **Smoke assertion:** a duplicate POST (same idempotency key) is a no-op; the outbox worker drains
  queued events and trips its breaker on repeated downstream failure. With `ERP_INBOUND_ENABLED`
  off, the endpoint returns a structured `503 erp_inbound_disabled`.

### Step 11 — `PDM_SENSOR_INGEST_ENABLED=true` + `PDM_AUTO_WORKORDER_ENABLED=true`  (Khối 4 — R0)
- **Turns on:** MQTT sensor ingest → `machineSensorReadings`, and the risk→auto **PREDICTIVE**
  work-order closer.
- **Check:** the maintenance/work-order view shows an auto-created PREDICTIVE work order once a
  sensor-derived risk crosses the threshold.
- **Smoke assertion:** publishing a high-risk sensor reading (**needs an MQTT broker + sensor
  feed**) yields exactly one PREDICTIVE work order (idempotent), not a duplicate storm.

---

## 3. Golden-thread end-to-end walkthrough

The intended integrated flow, with **honest seams** marked where real hardware is required.

```
1. ERP order in        POST /api/v1/orders            (ERP_INBOUND_ENABLED)
        │                emits event order.created
        ▼
2. Task created        order.created → decompose       (FLEET_ORCH_ENABLED)
        │                → tasks row (status=pending)   ← seeded demo tasks show here
        ▼
3. Allocate            allocator scores candidates      (FLEET_ORCH) + skills/op codes (FLEET_RESOURCE)
        │                assigns best robot              ── SEAM: needs a registered robot (dev has none)
        ▼
4. Zone reserve        traffic manager grants a         (FLEET_ORCH)
        │                zone_reservation (concurrency)  ── runtime-generated (empty until a device moves)
        ▼
5. Twin shows device   scene-graph + WS stream          (TWIN_LIVE_ENABLED)
        │                device appears in the zone      ── SEAM: placeholder glTF → primitive fallback;
        │                                                    live pose needs real/sim telemetry
        ▼
6. Safety (advisory)   e-stop/interlock/near-miss →     (SAFETY_AUDIT_ENABLED)
        │                safety_events (logged_only)     ── ADVISORY ONLY, not a rated stop (N-4)
        ▼
7. Alarm normalized    native code → mapAlarm →          (EQ_GOVERN + EQ_INTEG)
        │                standard ISA-18.2 code → Andon
        ▼
8. ERP outbox          completion/OEE event → outbox →   (ERP_OUTBOX_ENABLED)
                         durable drain → upstream ERP     ── SEAM: producers not yet all rewired (N-7)
```

**Which parts run fully in dev today (no hardware):** steps 1–2 (order → pending task), the Fleet
queue/zones/resources/chargers views, the workforce board, the governance/standards workflow, the
IR editor lint/transpile, and the twin scene-graph (with primitive fallback). **Which parts need
real devices:** allocation→dispatch (step 3), live twin pose (step 5), naturally-raised safety and
anomaly events (steps 6, §2-step 9), FOCAS/Euromap real reads (§2-step 6), PdM sensor ingest
(§2-step 11), and full ERP outbox producer coverage (step 8, N-7). Registering a `vendor='sim'`
robot lets steps 3–6 be exercised without physical hardware.

---

## 4. Exact commands

```bash
# 1. Seed the demo data (idempotent — safe to re-run)
node scripts/seed-automation-demo.mjs

# 2. Enable flags — operator edits .env (example: bring up the fleet core only)
#    (this runbook does NOT modify .env; the operator sets these)
#    FLEET_ORCH_ENABLED=true
#    ...then the next flag in §2 order, one at a time.

# 3. Run the app and smoke-check each page after each flag
npm run dev
```

---

## 5. Disable / rollback path

- **Per-feature rollback:** set the flag back to `false` (or remove it) in `.env` and restart.
  The capability reverts to a **complete no-op** — routers self-gate, cron sweeps self-gate, the
  page shows its disabled/empty state. No migration rollback is needed; the tables just go unused.
- **Full rollback:** set every `*_ENABLED` flag from §2 to `false` and restart. The system is
  identical to its pre-activation behavior.
- **Removing the demo rows (optional):** the seed rows are harmless and `scope='demo'`-tagged.
  To delete them, remove by their stable keys, e.g.:
  ```sql
  DELETE FROM tasks               WHERE "taskKey"  LIKE 'DEMO-TASK-%';
  DELETE FROM equipment_3d_models WHERE "modelKey" LIKE 'MODEL-%';
  DELETE FROM operator_assignments WHERE scope = 'demo';
  DELETE FROM program_variants    WHERE scope = 'demo';
  DELETE FROM operation_program_map WHERE notes = 'demo mapping (seed)';
  DELETE FROM charger_stations    WHERE scope = 'demo';
  DELETE FROM shared_resources    WHERE scope = 'demo';
  DELETE FROM operation_codes     WHERE scope = 'demo';
  DELETE FROM zones               WHERE code LIKE 'ZONE-%';
  ```
  (No FKs cascade from these demo rows because the runtime-generated child tables were left empty.)

---

## 6. Safety note (summary)

All new behavior is **flag-OFF by default** and routes through the **existing gated dispatchers**
(`robotCommandDispatcher` / `commandDispatcher`, dry-run + HITL 2-eyes + idempotency). Enabling a
flag surfaces monitoring/orchestration **state and advisories only** — it opens **no new
autonomous device-control path**. The `safety_events` log is **advisory** and is **not** a
substitute for a safety-rated controller (a real SIL 2/3 stop is deferred to S2, hardware).
```
