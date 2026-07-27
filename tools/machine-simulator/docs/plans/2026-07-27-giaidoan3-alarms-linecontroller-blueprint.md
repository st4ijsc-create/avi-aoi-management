# Giai đoạn 3 — Sub-project 4: AlarmEngine (ISA-18.2) + LineController (PackML) — Blueprint/Spec

> APPROVED (brainstorming, 27/07/2026). Branch feat/machine-simulator (GĐ3 OPC-UA @ d637c320). Code-grounded by the alarm-source/fleet-state surface map. Two integrated subsystems (WS-G 2nd pass). Additive; the manual fleet start/stop/estop stays as the underlying mechanism the PackML layer drives.

## Goal
Two integrated supervisory subsystems: (A) an **AlarmEngine** that raises/clears/acks prioritized (ISA-18.2) alarms from Policy DENYs + driver-health + NG-rate, persisted, with an Alarm Center UI; and (B) a **LineController** exposing the fleet's operational state as a standard **PackML/ISA-88** state machine over the API + UNS. A Critical alarm can drive the line to HELD.

## Key code-grounded facts (surface map) — the build gaps
- **Policy DENY hook** = `PolicyResults.DenyAsync` (`src/St4i.EngineApi/Policy/PolicyResults.cs:10-24`) — the ONE place a deny is observed (only the 5 policy-gated fleet/scenario actions); carries `PolicyReasonCode` (SAFETY_BLOCKED/POLICY_DENIED/…) + message. Net-new: raise an alarm here.
- **`IDeviceDriver.Health`** (Connected/Degraded/Down) is **read by NOBODY in production** — FleetHost holds `slot.Driver` only for disposal (`FleetHost.cs:219-226`); there is no `GetDriverHealth()`. Net-new end-to-end (expose per-slot health + observe transitions).
- **NG-rate is CUMULATIVE** (`FleetHost._totalPass/_totalJudged`, never reset; `MachineState.PassRate`). No windowed/rolling rate. Net-new windowing (a delta-per-interval NG-rate).
- **No hold/pause concept** — FleetHost has only Start/Stop/Estop/ResetEstop + `IsRunning`/`EstopEngaged`; no `Hold/Unhold/Pause/Abort`. PackML Execute↔Held is entirely net-new.
- **No background loop in St4i.EngineApi** — zero `IHostedService`/`AddHostedService`/`PeriodicTimer` in the API host. The AlarmEngine's periodic evaluation is the FIRST one. Precedent: `AuditRecorder.RecordSystemAsync` (`AuditRecorder.cs:73-76`) + the `ApplicationStarted` `system.startup` write (`Program.cs:843-860`) for a non-request write.
- **UNS has no generic state/alarm publish** — `IUnsPublisher` has only reading/lifecycle methods; `AspectFor` = result/telemetry/inspection only. A `syn/.../state` line-state needs a NEW `IUnsPublisher` method (ripples to fakes) + aspect.
- **Reuse:** SQLite store (`SecurityDb`/`AssetRegistryStore` migration-ladder idiom → `AlarmStore` `alarms.db`, env `ST4I_ALARMS_DIR`); `AssetEndpoints`/`AuditEndpoints` (list/detail/paged/audited-mutate + `RbacPolicyTests.ExpectedRoutes` sweep); `FleetEndpoints` policy-gated command template (for `/v1/line`); `AssetRegistry.tsx`/`Audit.tsx` + `api.ts` hooks + Sidebar/Shell (for `AlarmCenter.tsx`).

## Locked decisions
1. **Alarm model** (ISA-18.2): `Alarm { Id, Source(Policy/DriverHealth/NgRate), Code, Priority(Critical/High/Medium/Low), State(Active/Acked/Cleared), Message, Runbook, FirstRaisedUtc, LastRaisedUtc, AckedUtc?, AckedBy? }`. Same alarm (source+code+target) re-raised → UPDATE lastRaised, PRESERVE firstRaised + ack state (upsert idiom).
2. **Sources:** Policy DENY (on `DenyAsync`; SAFETY_BLOCKED=Critical); DriverHealth (Degraded=High, Down=Critical, via a periodic poll of `FleetHost.GetDriverHealth()`); NG-rate (a windowed/per-interval fleet NG-rate > threshold=High, via the periodic loop).
3. **Periodic evaluation** = ONE `IHostedService` (`PeriodicTimer`, e.g. 5s) in St4i.EngineApi — the first in this host. Evaluates health + NG-rate, raises/clears. Never-throws.
4. **LineController = PackML supervisory layer over FleetHost.** States Idle/Starting/Execute/Holding/Held/Unholding/Stopping/Stopped/Aborting/Aborted/Resetting (a workable subset); commands Start/Hold/Unhold/Stop/Abort/Reset. Map: Start→Execute (FleetHost.Start), Stop→Stopped, Abort→Aborted (Estop), Reset→Idle (ResetEstop). **HOLD = resumable pause** (FleetHost.Stop the slots + remember "held" intent; Unhold→Execute/Start) — distinct from a full Stop. Fleet-wide (per-machine hold deferred).
5. **`/v1/line`** GET state + `POST /v1/line/{command}` (Operator, policy-gated + audited, mirroring `/v1/fleet`). UNS: a new `PublishLineState` → retained `syn/{site}/{area}/{line}/{cell}/_line/state` (additive `IUnsPublisher` method; update fakes). **Alarm→hold:** a Critical (SAFETY_BLOCKED) active alarm drives the LineController → Held.
6. **AlarmStore** SQLite `alarms.db` under `%ProgramData%\ST4I\sim\alarms` (env `ST4I_ALARMS_DIR`), active-alarms table + history/log table, migration ladder + never-throw writes.

## Tasks (SDD; per-task review)
- **LC-1** — Alarm model + `AlarmStore` (SQLite) + `AlarmEngine` (in-memory raise/clear/ack over the store, never-throws) + **Policy-DENY source** (hook `PolicyResults.DenyAsync` → raise; SAFETY_BLOCKED=Critical + a runbook) + endpoints `GET /v1/alarms` (active, Operator) / `GET /v1/alarms/history` (paged, Operator) / `POST /v1/alarms/{id}/ack` (Operator, audited) + RbacPolicyTests + tests.
- **LC-2** — the periodic `IHostedService` (PeriodicTimer) + `FleetHost.GetDriverHealth()` (per-slot health snapshot — new read-only accessor) + **DriverHealth source** (raise on Degraded/Down, clear on recover) + **windowed NG-rate source** (a small FleetHost raw-KPI accessor `{totalPass,totalJudged}` → the evaluator keeps last-poll values → delta NG-rate per interval > threshold) + tests (deterministic — drive the evaluator directly, not real time).
- **LC-3** — `LineController` (PackML state machine over FleetHost) + `GET /v1/line` + `POST /v1/line/{command}` (policy-gated + audited) + `IUnsPublisher.PublishLineState` (new `_line/state` retained aspect; update all fakes) + **alarm→hold** (a Critical active alarm forces Held) + RbacPolicyTests + tests.
- **LC-4** — Web: `AlarmCenter.tsx` (active-alarms table, priority colors, ack, history tab) + a Line-state panel (PackML state + commands, Operator/Engineer) + nav + i18n vi/en + `api.ts` hooks + `npm run build` clean.
- **LC-5** — README docs (Alarms + LineController: env vars, endpoints, PackML states, alarm sources/priorities) + sub-4 whole-branch review + push.

## Global constraints
.NET/C# (backend) + React/i18n (web). No new NuGet (SQLite/hosting/PeriodicTimer all in-box). Do NOT edit the shared SDK. **Additive:** alarms/line are supervisory layers over the unchanged FleetHost mechanism; a fleet with no alarms + a never-commanded line behaves as today. Never-throws (alarm raises + the periodic loop must never crash the host/pipeline). Reuse the SQLite-store / Map*Endpoints / policy-gated-command / TanStack-Query idioms. TDD; per-task review (LC-3 touches UNS + safety-adjacent hold → careful); full `St4i.EngineApi.Tests` + `St4i.EdgeCore.Tests` green + web build clean; deterministic tests (drive the evaluator/state-machine directly, no real-time waits). Commit `feat(alarms):`/`feat(line):` with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## Deferred
Per-machine hold (fleet-wide only); NCMD inbound line commands from a Site; alarm shelving/suppression/rationalization workflow; full PackML mode/unit machinery; alarm-driven auto-abort (only alarm→HELD for MVP).
