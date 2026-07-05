# 34 — SYNAPSE Flag-Flip & Activation Runbook (C1)

> doc 33 §5B decision-flow / C1. How to safely turn ON the SYNAPSE capabilities built in doc 33
> (foundation F1–F8, integration I1–I6, remaining H4/H6/P6/W4). Every flag ships **OFF**; this is
> the staged order to enable them with a smoke test + rollback per stage. Do this on **staging
> first**, one stage at a time, watching logs/SLOs between stages.

## Pre-flight
1. **Apply migrations** (worktree `synapse-foundation`): `0220` (control-audit hash columns),
   `0221` (decision_traces), `0222` (orchestration_run_events). All additive/idempotent (`IF NOT
   EXISTS`). Verify: the 3 tables/columns exist.
2. **Baseline green**: `npx tsc --noEmit` = 0; SYNAPSE + touched-production suites green.
3. **Note**: `LICENSE_NEVER_STOP_PRODUCTION` already defaults **true** (F4) — production never
   halts on license. Leave it true.

## Staged activation (safe order: observe → govern → behave)

| Stage | Flag(s) | Enables | Smoke test | Rollback |
|---|---|---|---|---|
| **A. Observe** (zero risk) | `OBSERVABILITY` | decision-trace persistence + SLO/burn API | Run a fleet allocation (FLEET_ORCH on) → `trpc.observability.persistedDecisions` returns rows | flag→false |
| | `DEV_PORTAL` | published specs + plugin scaffold | `trpc.devPortal.index` returns spec counts | flag→false |
| | `SCHEMA_REGISTRY` | BACKWARD gate + reconciliation cycle | `trpc.contracts.openapi` served; CI contract-gate green | flag→false |
| **B. Edition/Plugin** | `EDITION_PROFILE` + `EDITION=machine` | module-ceiling enforced | `trpc.license.getAllowedModules` hides Site-only modules; `trpc.edition.current` shows machine | EDITION_PROFILE→false |
| | `PLUGIN_MANIFEST` | manifest catalogue + apiVersion gate | `trpc.plugin.list` = 5 OT connectors, all apiCompatible | flag→false |
| | `PLUGIN_SIDECAR` | out-of-process supervisor available | `trpc.plugin.sidecarCapabilities` returns lifecycle+policy | flag→false |
| **C. Govern** (behavior) | `SEC_PLATFORM` | policy-gate on write-gate + hash-chain audit | A `deny`-matching command is rejected (POLICY_DENIED); `trpc.security.verifyAuditChain` = ok | flag→false → gate skipped, plain audit |
| **D. Durable/Traffic/AI** | `FOE_DURABLE` (needs `FOE_ENABLED`) | auto-resume interrupted runs + RunEvent log | Kill mid-run → on restart the run auto-continues (not `held`); `trpc.orchestrationGov.runEvents` shows RUN_CREATED | flag→false → manual `held` resume |
| | `TRAFFIC_SPACETIME` | space-time reservation + infra coordinator | `trpc.trafficGov.planRoute` waits around a reserved slot | flag→false |
| | `TWIN_DRIFT` / `RL_ADVISOR` | twin drift alerts + RL advice (shadow first!) | `trpc.twinGov.driftReport` flags a >10% metric; RL `mode:shadow` emits heuristic | flag→false |
| | `RECONCILE_CRON` | daily reconciliation (after wiring MES/ERP providers) | `trpc.contracts.reconcileCycle` runs providers | flag→false |

**RL escalation** (SDD §5.3.4): `RL_ADVISOR` runs **shadow → suggest → auto** only after the shadow
logs show it beats the heuristic; the circuit breaker reverts to heuristic on 2 worse cycles.

## Rollback principle
Every flag is a clean OFF switch → the code path returns to the proven pre-SYNAPSE behavior; no
migration rollback needed (columns/tables are additive and unused when the flag is off).

## Blocked without hardware (doc 33 §7 C2)
Real-device proof of: Safety PLC SIL + UWB/LiDAR (S2), FOCAS Fwlib32, GigE/GenICam, real robot
FAT, EtherCAT — these need physical hardware and are out of software scope. The software gates,
sidecar contract, and Local Agent spec are ready to receive them.
