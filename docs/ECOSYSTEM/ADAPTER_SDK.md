# Adapter SDK & Unified Machine API (`/api/v1`) — Integration Guide

**Phase E1 · Factory Control Plane**
Design ref: [`08_FACTORY_CONTROL_PLANE_STRATEGY_2026-06.md`](./08_FACTORY_CONTROL_PLANE_STRATEGY_2026-06.md) (Part C + E.0).

This document is the contract a **3rd party** uses to (1) write an **EquipmentAdapter** (or a Vision adapter) that plugs a new machine/protocol into the platform without touching the core, and (2) integrate an external system over the single, versioned **Unified Machine API** at `/api/v1`.

> **Safety invariant (non-negotiable).** Every control command — from the API or an orchestration run — routes through the **existing HITL command dispatcher** with a **dry-run gate** (`OT_CONTROL_ENABLED` / `ROBOT_CONTROL_ENABLED`, both default OFF). When the gate is off, a command is **simulated** and **nothing is written** to a device. Adapters and the API **never** open a direct device-control path.

---

## 1. Concepts

| Concept | What it is | Where |
|---|---|---|
| **Equipment Capability Model** | The vendor-neutral contract a machine exposes: `{ supportedCommands, telemetryTags, supportedStates (PackML), adapterKind }`. | `server/services/equipment/capabilityModel.ts` |
| **EquipmentAdapter** | The unified facade interface: `testConnection`, `readTelemetry`, `sendCommand`, `getState?`. One per `adapterKind`. | `server/services/equipment/equipmentAdapter.ts` |
| **PackML state model** | The canonical 17-state device state machine (ISA-TR88). Orchestration sequences by *state*, not by vendor. | `server/services/equipment/packml.ts` |
| **Unified Machine API** | The external REST surface (`/api/v1`) over the above. | `server/api/v1/` |

---

## 2. Writing an `EquipmentAdapter`

An adapter is a **thin facade** that maps a machine's real driver onto the unified interface and **delegates control to the existing HITL dispatcher**. The interface (from `equipmentAdapter.ts`):

```ts
export interface EquipmentAdapter {
  readonly kind: AdapterKind;            // e.g. "ot-opcua", "vision", "robot"
  readonly delegatesTo: DelegateRegistry; // which existing registry it uses
  testConnection(cfg: EquipmentConnConfig): Promise<EquipmentTestResult>; // read-only
  readTelemetry(cfg: EquipmentConnConfig): Promise<EquipmentSample[]>;     // read-only
  sendCommand(command: EquipmentCommand): Promise<EquipmentCommandResult>; // → HITL dispatcher
  getState?(cfg: EquipmentConnConfig): Promise<{ state?: string; raw?: Record<string, unknown> }>;
}
```

### Rules
1. **No protocol logic in core.** Delegate to your driver/SDK; the facade only normalizes shapes.
2. **`sendCommand` MUST route through a dispatcher** (`commandDispatcher.dispatch` for OT/PLC, `robotCommandDispatcher.dispatchRobotJob` for robot/AGV). Never write to the device directly. Pass the HITL provenance (`actionId`, `requestedBy`) through unchanged.
3. **Reads are read-only and fail-safe** — return a typed empty/`ok:false` result on error, never throw.
4. **Declare capability**, not vendor specifics — add a default profile in `capabilityModel.ts` (`DEFAULT_PROFILES[<EquipmentClass>]`) or let it resolve via the per-machine `machines.capabilities` jsonb override (`extraCommands`, `extraTelemetry`, `adapterKind`, …).

### Minimal example skeleton

```ts
// myVendorAdapter.ts — a 3rd-party adapter skeleton.
import type {
  EquipmentAdapter, EquipmentConnConfig, EquipmentTestResult,
  EquipmentSample, EquipmentCommand, EquipmentCommandResult,
} from "server/services/equipment/equipmentAdapter";
// Route control through the EXISTING dispatcher (do NOT write to the device yourself).
import { dispatch as otDispatch } from "server/services/ot/commandDispatcher";

export class MyVendorAdapter implements EquipmentAdapter {
  readonly kind = "ot-opcua" as const;     // pick the kind that fits the transport
  readonly delegatesTo = "ot" as const;

  async testConnection(cfg: EquipmentConnConfig): Promise<EquipmentTestResult> {
    try {
      // ...probe your driver with cfg.endpoint / cfg.options...
      return { ok: true, latencyMs: 5, detail: { vendor: "acme" } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readTelemetry(_cfg: EquipmentConnConfig): Promise<EquipmentSample[]> {
    // ...read your tags, normalize to {key,value,unit?,timestamp}...
    return [{ key: "state", value: "Execute", timestamp: new Date() }];
  }

  async sendCommand(command: EquipmentCommand): Promise<EquipmentCommandResult> {
    // ALWAYS via the HITL dispatcher (honours OT_CONTROL_ENABLED dry-run gate).
    const res = await otDispatch({
      adapterId: command.adapterId!,
      machineId: command.machineId ?? null,
      commandType: command.name,
      writes: command.writes ?? [],
      triggeredBy: { kind: "hitl", actionId: command.hitl.actionId, requestedBy: command.hitl.requestedBy },
      idempotencyKey: command.idempotencyKey,
    });
    return {
      ok: res.ok,
      status: res.status,           // "simulated" when the dry-run gate is off
      routedTo: "ot-dispatcher",
      detail: { simulated: res.simulated },
    };
  }
}
```

To register it, call **`registerEquipmentAdapter(kind, factory)`** at module load (register-and-go — no core switch edit; see §8), or — for an OT transport — register a new driver in `server/services/ot/driverRegistry` and reuse the existing `ot-*` kinds.

---

## 3. Writing a **Vision** adapter (E0 / P1a)

A vision machine (AOI/AVI/SPI/AXI) does not "control" a PLC — it **ingests inspection results**. The integration is:

1. The machine authenticates with its **per-machine API key** (or a scoped key with `ingest:write`).
2. It **POSTs inspection results** to `POST /api/v1/ingest/inspection` (or the legacy tRPC `machineApi.submitInspection`). The server resolves measurement points, stores results, fires NG alerts and webhooks.
3. Capability resolves to `adapterKind: "vision"` with `supportedCommands` like `start / stop / select_recipe / acknowledge_machine_alarm`.

Vision adapters are **telemetry/ingest-first**; their `sendCommand` (recipe select, etc.) still routes through the dispatcher when an OT control path is configured via the `machines.capabilities` override (`adapterKind`).

---

## 4. The Unified Machine API (`/api/v1`)

The published OpenAPI 3.0 document is served at **`GET /api/v1/openapi.json`** (no auth — describes the contract only).

### 4.1 Authentication

Send a scoped API key as either:

```
Authorization: Bearer <apiKey>
# or
X-API-Key: <apiKey>
```

Three credential kinds are accepted:
- **`MASTER_API_KEY`** — super-key, all scopes.
- **A `api_keys` row** — least-privilege, carries `scopes[]`, `isActive`, `expiresAt` (only a SHA-256 hash is stored).
- **A per-machine `apiKey`** — narrow `ingest:write` only (lets existing machine clients post inspections).

### 4.2 Scopes

| Scope | Grants |
|---|---|
| `equipment:read` | List equipment, capabilities, telemetry, state. |
| `equipment:command` | Propose/dispatch equipment commands (HITL dry-run). |
| `ingest:write` | Ingest inspection results. |
| `orchestration:read` | Read workflows / run status (E2). |
| `orchestration:write` | Create workflows / start runs (E2). |
| `erp:write` | Inbound ERP intake: production orders + BOM master data (R0). |
| `fleet:read` | **U4a** — read fleet tasks + zones (occupancy). |
| `safety:read` | **U4a** — read ADVISORY safety events + zones (not safety-rated). |
| `twin:read` | **U4a** — read digital-twin scene graph + 3D model registry. |
| `programs:read` | **U4a** — read device programs (projects) + deployments. |
| `pdm:read` | **U4a** — read predictive-maintenance failure risk for a machine. |
| `anomaly:read` | **U4a** — read ADVISORY robot-behaviour anomaly events. |
| `standards:read` | **U4a** — read device types, ISA-18.2 alarm taxonomy, compliance. |

Wildcards: `*` = all scopes; `equipment:*` = the whole `equipment` namespace. Missing auth → **401**; insufficient scope → **403**.

### 4.3 Endpoints

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /api/v1/equipment` | `equipment:read` | List machines + resolved capabilities. |
| `GET /api/v1/equipment/:id/capabilities` | `equipment:read` | Resolved `EquipmentCapability`. |
| `GET /api/v1/equipment/:id/telemetry?from=&to=` | `equipment:read` | Recent telemetry (latest known). |
| `GET /api/v1/equipment/:id/state` | `equipment:read` | PackML state projection + allowed commands. |
| `POST /api/v1/equipment/:id/commands` | `equipment:command` | `{ command, args, idempotencyKey }` → HITL dispatcher (dry-run). **Never a direct write.** |
| `POST /api/v1/ingest/inspection` | `ingest:write` | Ingest an inspection (reuses `submitInspection`). |
| `POST /api/v1/orchestration/workflows` | `orchestration:write` | **501** — coming in E2. |
| `POST /api/v1/orchestration/runs` | `orchestration:write` | **501** — coming in E2. |
| `GET /api/v1/orchestration/runs/:id` | `orchestration:read` | **501** — coming in E2. |
| `GET /api/v1/openapi.json` | (public) | This contract. |

**U4a — upper-layer module READ endpoints** (all READ-ONLY; each REUSES the same service function the corresponding tRPC router calls — no logic duplication; no new device-control path):

| Method & path | Scope | Purpose (reused service) |
|---|---|---|
| `GET /api/v1/fleet/tasks?status=&deviceId=&limit=` | `fleet:read` | Fleet tasks (same query as `fleetRouter.listTasks`). |
| `GET /api/v1/fleet/zones` | `fleet:read` | Fleet zones + derived occupancy (`trafficManager.getZoneOccupancy`). |
| `GET /api/v1/safety/events?eventType=&robotId=&sinceHours=&limit=` | `safety:read` | ADVISORY safety events (`safetyAuditService.queryFeed`). |
| `GET /api/v1/safety/zones?robotId=&stationId=&lineId=` | `safety:read` | ADVISORY safety zones (`safetyZoneService.listZones`). Rated stop is hardware. |
| `GET /api/v1/twin/scene-graph?factoryId=` | `twin:read` | Twin scene graph (`twin/sceneGraph.buildSceneGraph`). |
| `GET /api/v1/twin/models?equipmentClass=&status=&limit=` | `twin:read` | 3D model registry (`twin/modelRegistry.listModels`). |
| `GET /api/v1/programs?limit=` | `programs:read` | Programming projects (same query as `programmingRouter.listProjects`). |
| `GET /api/v1/programs/:id/deployments` | `programs:read` | A program's deployments (same query as `programmingRouter.listDeployments`). |
| `GET /api/v1/pdm/risk?machineId=&windowHours=` | `pdm:read` | Failure risk (`predictiveMaintenanceService.computeFailureRisk`). |
| `GET /api/v1/anomaly/events?robotId=&status=&limit=` | `anomaly:read` | ADVISORY robot-behaviour anomalies (same query as `aiRobotAnomalyRouter.listAnomalies`). |
| `GET /api/v1/standards/device-types` | `standards:read` | Device-type hierarchy tree, SEED ∪ published (`deviceTypeRegistry.buildTree`). |
| `GET /api/v1/standards/alarm-taxonomy?vendor=` | `standards:read` | ISA-18.2 alarm taxonomy, SEED ∪ persisted (`alarmTaxonomy`). |
| `GET /api/v1/standards/compliance` | `standards:read` | Governance compliance metrics (`complianceService.computeCompliance`). |
| `GET /api/v1/ecosystem/hierarchy?factoryId=&corporateCode=` | `equipment:read` | Single-pane live hierarchy roll-up (`commandCenterService.buildHierarchy`). |
| `GET /api/v1/ecosystem/kpi?factoryId=&corporateCode=` | `equipment:read` | Ecosystem KPI strip, honest nulls (`commandCenterService.buildKpiSummary`). |
| `GET /api/v1/machines/:id/detail` | `equipment:read` | Full per-machine cockpit (`assetCockpitService.machineDetail`). `gatedActions` are metadata only. |
| `GET /api/v1/robots/:id/detail` | `equipment:read` | Full per-robot cockpit (`assetCockpitService.robotDetail`). `gatedActions` are metadata only. |

> **U4a scope — deliberately READ-ONLY.** No write/action is exposed. Every mutation on these modules (create/allocate task, deploy/rollback a build, record/audit a safety event, publish a device type, roll a model back, acknowledge an anomaly) stays behind the **existing gated tRPC flow** (RBAC permission + module flag + HITL). The ecosystem roll-up + cockpit reuse `equipment:read` (a caller already trusted to read equipment gets the whole-ecosystem view); the KPI endpoint runs `buildKpiSummary` under a synthetic `id:0` api principal (reads only, never writes).

### 4.4 Response envelope

Every response uses a consistent envelope:

```jsonc
// success
{ "ok": true, "data": { /* ... */ } }
// error
{ "ok": false, "error": { "code": "forbidden", "message": "...", "details": { } } }
```

Status codes: `200` ok · `201` ingest committed · `400` bad request · `401` unauthorized · `403` forbidden · `404` not found · `501` not implemented (E2). Handlers are fail-safe — an unexpected throw becomes a structured `500` envelope, never a process crash.

### 4.5 Command POST — example

```bash
curl -X POST "$HOST/api/v1/equipment/1/commands" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{ "command": "start", "idempotencyKey": "run-2026-06-28-001" }'
```

```jsonc
// with the control flag OFF (default) — dispatcher SIMULATED, nothing written:
{ "ok": true, "data": { "machineId": 1, "command": "start",
  "routedTo": "ot-dispatcher", "status": "simulated", "accepted": true,
  "detail": { "simulated": true } } }
```

---

## 5. Webhooks (outbound)

External systems subscribe to events via the existing webhook subscriptions (`webhook_configs` table / `webhookRouter`). The `/api/v1` layer fans these events out, **HMAC-signed** (`X-Webhook-Signature: sha256=...` using the subscription `secret`), with retry, fully fail-safe (delivery never blocks the emitter).

Published event types: `inspection.committed`, `andon.raised`, `equipment.command.executed`, `spc.violation`, `ng.alert`.

> **Flag-gated:** outbound delivery is enabled only when **`WEBHOOKS_ENABLED=true`** (default OFF). Subscriptions can be registered at any time; only the actual POST is gated.

### Verifying a webhook signature (subscriber side)

```ts
import { createHmac } from "node:crypto";
function verify(rawBody: string, header: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header === expected;
}
```

---

## 6. Versioning & roadmap

- The contract is **versioned** (`/api/v1`); breaking changes ship under a new version.
- **E2** adds the Factory Orchestration Engine behind the already-published `/orchestration/*` paths (currently `501`).
- Everything is **additive · flag-gated · HITL-preserved**.

---

## 7. Writing a `ProgrammingAdapter` (Doc 09 / DPC tier)

Where an `EquipmentAdapter` handles **telemetry + scalar commands**, a **`ProgrammingAdapter`** handles **device PROGRAMS** (Zmotion BASIC, G-code, native IEC 61131-3, robot job-lists, vendor engineering). It is the LOGIC-tier sibling, used by the Unified Engineering Workspace (`/engineering`). Design ref: [`09_DEVICE_PROGRAMMING_CONTROL_STRATEGY_2026-06.md`](./09_DEVICE_PROGRAMMING_CONTROL_STRATEGY_2026-06.md).

Interface (`server/services/programming/programmingAdapter.ts`):

```ts
interface ProgrammingAdapter {
  readonly kind: ProgrammingKind;              // 'zmotion-basic' | 'iec61131-ld' | ...
  readonly capabilities: ProgrammingCapability; // canCompile/Simulate/Download/Upload/OnlineMonitor/Force/Teach + languages[]
  validate(src): Promise<Diagnostics>;          // ALWAYS safe — lint/parse, no device I/O
  compile(src): Promise<BuildResult>;           // ALWAYS safe — emit a transferable output
  simulate?(build, scenario): Promise<ProgSimResult>; // ALWAYS safe — twin/emulator
  deploy(build, opts): Promise<ProgDeployResult>;     // GATED — see safety note
  upload?(target): Promise<ProgramSource>;
}
```

**Register** a new kind by calling **`registerProgrammingAdapter(kind, factory)`** at module load (register-and-go — no `build()` switch edit; see §8), and add the enum value in `drizzle/schema/enums.ts (programmingKindEnum)`.

### Safety invariants (non-negotiable)
- **The deploy GATE lives in `programmingService.deployBuild`, not in the adapter or router.** `deploy()` reaches a device ONLY when `DPC_DEPLOY_ENABLED` is on **AND** a human signed off (`hitl.confirmedBy`). Otherwise the deploy is recorded **`simulated`** and the adapter's hardware path is never invoked. Every attempt writes an append-only `program_deployments` row (idempotent).
- An adapter **never authors or deploys safety logic** (E-stop / interlock / SIL). That stays on the certified PLC.
- **Native IEC 61131-3** (`iec61131-st` / `iec61131-ld`) compiles to and deploys on an **OPEN runtime ONLY** (OpenPLC). Never auto-push generated logic into a certified vendor PLC.
- An adapter that cannot truthfully complete a deploy must return **`failed`** with a clear reason — **never a fake `deployed`** (see the Zmotion/Mitsubishi/Robot adapters' honest guards).

### Online Monitor (D6)
High-rate symbol watches stream over the Socket.IO room `engineering:{machineId}` via `emitEngineeringSamples`, gated by `DPC_STREAMING_ENABLED`. This channel is **ephemeral** — it is NOT persisted to TimescaleDB (the 5s telemetry ingest is unchanged). Watches are **read-only**; `force()` is a separate, heavily-gated path under `DPC_ONLINE_FORCE_ENABLED`.

### AI Engineering Copilot (D7)
`aiProgrammingCopilot.suggestProgram` proposes a skeleton that is **validated through the same adapter** before it is shown, **refuses safety intents**, and has **no deploy/dispatch path** (HITL absolute). Flag `AI_PROGRAMMING_COPILOT_ENABLED`.

### Flags (all default OFF)
`DPC_DEPLOY_ENABLED` · `DPC_STREAMING_ENABLED` · `DPC_ONLINE_FORCE_ENABLED` · `AI_PROGRAMMING_COPILOT_ENABLED`. Migration `0130_device_programming.sql` provisions the `program_*` tables (operator applies).

---

## 8. Register-and-go — adding a vendor / kind / module (U4b · doc 21 §6 / G-8)

Adapter/kind/module resolution is now **data-driven** — a `Map<key, factory>` per family, seeded at module load, exactly like `server/services/ot/driverRegistry`. Adding a new vendor/kind/module is **one `register…()` call at load — no core switch/array edit**. The compile-time **union types are retained** for exhaustiveness (`AdapterKind`, `EquipmentClass`, `ProgrammingKind`); only the *runtime* resolution is registry-driven.

| Family | Register API | Resolution | Seeded from |
|---|---|---|---|
| Equipment adapter | `registerEquipmentAdapter(kind, (kind)=>adapter)` | `equipmentRegistry.getAdapter(kind)` (memoised) | historical kinds at load |
| Capability profile | `registerCapabilityProfile(equipmentClass, profile)` | `getDefaultCapability(machineType)` | the 17 `DEFAULT_PROFILES` at load |
| Programming adapter | `registerProgrammingAdapter(kind, ()=>adapter)` | `programmingRegistry.getAdapter(kind)` (memoised) | implemented kinds at load |
| System module | `registerModule(manifest)` | `getModuleByCode/Route/NavGroup`, `listModules()` | `SEED_MODULES` at load |

### Add a new equipment vendor/kind (no core edit)
```ts
import { registerEquipmentAdapter } from "server/services/equipment/equipmentAdapter";
import { registerCapabilityProfile } from "server/services/equipment/capabilityModel";

// 1) register the adapter factory (register-and-go — no build() switch edit)
registerEquipmentAdapter("acme-laser", (kind) => new AcmeLaserAdapter(kind));

// 2) (optional) register a default capability profile for a new equipment class
registerCapabilityProfile("LASER", {
  equipmentClass: "LASER", adapterKind: "acme-laser",
  supportedCommands: [/* … */], telemetryTags: [/* … */], supportedStates: ["Idle","Execute","Stopped"],
});
```
Both calls run once at module load (put them in the adapter's own module, imported for its side-effect — same as `ot/index.ts` registering the 6 OT drivers). Existing kinds already seed themselves, so resolution for every current kind is **identical** — this is behaviour-preserving.

### Add a new programming kind
```ts
import { registerProgrammingAdapter } from "server/services/programming/programmingAdapter";
registerProgrammingAdapter("acme-lang", () => new AcmeLangAdapter());
// + add the enum value to drizzle/schema/enums.ts (programmingKindEnum)
```
A **planned** kind (declared in `PROGRAMMING_KINDS` but not yet registered — e.g. `gcode`) still resolves to the honest `"not yet implemented"` error; an entirely unknown kind still errors `"Unknown"`.

### Add a new system module
```ts
import { registerModule } from "shared/module-registry";
registerModule({ code: "MOD_ACME", name: "Acme", description: "…", version: "1.0.0",
  isCore: false, routes: ["/acme"], permissionCategories: ["admin"], features: [], navGroupId: "acme" });
```
Re-registering an existing `code` **replaces** that manifest in place (no duplicate). `SYSTEM_MODULES` remains a load-time snapshot for backward-compat; use `listModules()` to see modules registered after load.

> **Behaviour-preserving guarantee.** Every existing adapter kind / programming kind / equipment class / module resolves **exactly as before** — proven by `registryU4b.test.ts` (equipment + programming) and `module-registry.test.ts`, plus the full equipment/programming/standards/fleet regression suites (all green).
