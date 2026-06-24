# Phase 2 — OT device enablement runbook (WS2.1)

The OT framework is **code-complete**: drivers for `stub`, `opcua`, `modbus`,
`s7`, `mitsubishi-mc`, `ethernet-ip` are implemented and unit-tested, registered
in `server/services/ot/index.ts`. What remains is **real device / simulator
testing** and flipping the flags — that is operator/hardware work, sequenced
below for safety.

## Defense-in-depth recap (already enforced in code)
Writes flow through a single `commandDispatcher` with, in order: trigger auth
(HITL-confirmed `ai_pending_actions` OR approved interlock rule) → idempotency →
`writable=true` tag allow-list → connected driver → **mode gate** → optional
read-back verify → append-only `command_log`. Telemetry ingest never receives
commands.

## Staged enablement (do NOT skip stages)

1. **Stub first (no hardware).** Configure a `stub` adapter + tags; verify
   telemetry lands in `ot_telemetry` and the dashboards update.
   ```env
   OT_GATEWAY_ENABLED=true
   ```

2. **Real driver, READ-ONLY.** Add a real adapter (e.g. `modbus`) pointing at a
   device **simulator** (e.g. ModbusPal / a PLC sim) or a non-critical device.
   Install the driver's native lib if needed (e.g. `modbus-serial`). Confirm
   reads/telemetry. `OT_CONTROL_ENABLED` stays false → any write is DRY-RUN
   (logged as `simulated`, no device I/O).

3. **Control in DRY-RUN end-to-end.** Exercise the HITL path (AI proposes →
   human confirms) and/or an approved interlock rule. Confirm `command_log`
   rows are `simulated` and no device write occurred.

4. **Enable real writes on a test cell.** Only after stages 1–3 pass on a
   non-production cell:
   ```env
   OT_CONTROL_ENABLED=true
   OT_READBACK_ENABLED=true        # G2.1 single read-back verify
   OT_CONTROL_TIMEOUT_MS=5000
   # INTERLOCK_AUTO_BLOCK_ENABLED=true   # only with approved interlock rules
   ```
   Verify writes complete and read-back yields `acked_verified`.

5. **Ingest to UNS (optional).** With EMQX TLS up (deploy/emqx):
   ```env
   OT_INGEST_TO_UNS=true
   ```

## Notes
- Each driver lazy-imports its native lib; a missing lib makes that adapter skip
  on connect (the process never crashes).
- Keep `OT_CONTROL_ENABLED=false` in any environment that should never write.
- Orchestration (Phase 2 WS2.3) may surface a *proposal*, but device control
  always goes through the dispatcher above — never directly from a rule.
