# Phase 3 — Robotics framework

Adds the Robotics pillar (previously empty). Mirrors the OT framework's
safety-first design: robots are configured in a registry, the runtime polls
state into telemetry, and every motion command is recorded (append-only) and
gated (dry-run by default).

## Vendors
`sim` (functional, no hardware) + scaffolds for the vendors in use:
**Fanuc, Mitsubishi (MELFA), Delta, Techman (TM cobot)**. Each scaffold's
`connect()` throws until its real SDK/protocol client is wired; the integration
approach is documented in each driver file:

| Vendor | Suggested integration |
|---|---|
| Fanuc | RMI (Robot Motion Interface) TCP, or KAREL socket / EtherNet-IP |
| Mitsubishi MELFA | TCP socket (Real-time external control / MXT), or SLMP |
| Delta | Modbus TCP, or Delta ASCII / DMCNET |
| Techman | Modbus TCP + TMflow "Listen Node" (TMSCT/TMSTA external script) |

## Pipeline (no hardware needed)
1. Register a robot (vendor `sim`) via `trpc.robot.create`, then `robot.setEnabled`.
2. ```env
   ROBOT_GATEWAY_ENABLED=true
   ```
   On boot the manager connects enabled robots and polls state into
   `robot_telemetry`. View via `trpc.robot.telemetry`.
3. Motion jobs run through the **internal** `dispatchRobotJob` (not exposed on
   tRPC). With `ROBOT_CONTROL_ENABLED` unset, jobs are **dry-run** → recorded in
   `robot_jobs` as `simulated`, no driver call.

## Safe enablement with real robots
1. `sim` first — verify registry → telemetry → job log E2E.
2. Wire one vendor driver (replace the scaffold throw with the real client,
   lazy-import its lib), connect **read-only**, confirm `robot.testConnection`
   and telemetry.
3. Exercise motion in **dry-run** (`ROBOT_CONTROL_ENABLED` off) end-to-end via
   the HITL path; confirm `robot_jobs` rows are `simulated`.
4. Only on a guarded test cell:
   ```env
   ROBOT_CONTROL_ENABLED=true
   ROBOT_CONTROL_TIMEOUT_MS=10000
   ```

## Safety
- The dispatcher gates: idempotency → HITL (`triggerKind='hitl'` needs a
  `confirmedBy`) → active+connected driver → mode gate (dry-run default) →
  timed run → append-only `robot_jobs`.
- Vision-guided motion should pass target poses as job `params`; the
  Computer-Vision → pose mapping (hand-eye calibration) is a follow-up.

## Deferred (follow-ups)
- **Vision-guided pick** (CV → pose, hand-eye calibration).
- **AGV/AMR fleet traffic** (the `agv` kind exists in the registry; traffic /
  charging / zone management is a later workstream).
- **UI** (robot fleet / teach-jog / job console) — backend-only this phase.
- A `MOD_ROBOTICS` license module lands with the UI.
