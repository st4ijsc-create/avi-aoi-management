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

To register it, add the `kind` to `ADAPTER_KINDS` and its `build()` branch in `equipmentAdapter.ts` (core change, reviewed), or — for an OT transport — register a new driver in `server/services/ot/driverRegistry` and reuse the existing `ot-*` kinds.

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
