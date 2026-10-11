# Đợt 10 design: remove the central DB login from the edge gateway

**Scope of this design.**
- **Goal:** the edge host holds no `DATABASE_URL` and no central secret. Central is the only writer of run state, approvals, safety events, ledgers and audit. The edge only drives its own devices, and it does so only under a fresh authorisation that central has signed. STOP is never gated (L-7).
- **How it was produced:** read-only. I read §17 of doc 81, the Đợt 9 S report, the final review (I1–I3, "edge design: grade C", the size table) and the final-wave re-review (N1–N8), then traced the code below.

---

## 0. Principles

1. **One walker, two stores.**
   - Today the edge runs the same `foeEngine` walker against the central DB rows (`foeEngine.ts:4616` `driveEdgeClaimedRun`).
   - Keep the single walker so the step semantics cannot drift. Route every persistence and gate call through a `RunStore` port carried on `RunContext`:
     - central store = today's functions, moved unchanged;
     - edge store = run package + local journal + HTTP.
2. **Central decides, the edge executes.**
   - **Decided centrally**, at a per-step `/authorize`:
     - approval identity, binding digest and approvals;
     - robot enabled, commissioning, policy, interlock (central holds the observations);
     - motion lock, ownership and revocation.
   - **Decided on the edge**, because only the edge sees the devices:
     - driver connected;
     - in-memory motion lock and motion slot;
     - safety-PLC preflight;
     - readback and stop-watch;
     - checking the signed authorisation.
3. **One owner per device.** A new owner column on robots and on OT adapters says who connects to the device, ingests its data, controls it and holds its motion lock. This removes the shared-robot cases behind N1 and N2, and the duplicate polling.
4. **Being honest about what this protects.**
   - A compromised edge host can still move its own devices directly. It can also misreport its own telemetry and the program checksums of its own controllers.
   - What it loses:
     - access to approvals, runs, adapters and robots outside its node;
     - forging trusted safety events;
     - reading users, API keys or other nodes' credentials;
     - writing any central row.

---

## 1. Inventory: every central-DB access reachable from the edge process today

The entry point is `server/edge/edgeGatewayMain.ts:24`, which calls `runEdgeGateway` (`edgeGatewayRuntime.ts:580`), which calls `bootstrapEdgeGateway` (`:471`).

### 1a. Gateway boot, registry and config

| Path | Code | DB access |
|---|---|---|
| GitOps mapping import | `edgeGatewayRuntime.ts:423-428`, `:444-449` → `ot/mappingAsCode.ts:483` `importMapping` | **W** `device_tags` / mappings (apply mode) |
| OT start | `edgeGatewayRuntime.ts:496-498` → `otManager.ts:639` → `ot/deviceAdapter.ts:52-67` | **R** `device_adapters` (all enabled adapters, not only this node's) and `device_tags` |
| OT ingest | `ot/ingest.ts:72`, `:92` → `telemetryBus.ts:828` → `:485-509` | **W** `ot_telemetry` (plus the DB-backed store-forward backfill) |
| Self-registration | `edgeGatewayRuntime.ts:283-302` → `edgeCoordinator.ts:125-170` | **R/W** `edge_nodes` (the node can rename itself and change its factory and lines) |
| Heartbeat | `edgeGatewayRuntime.ts:316-332` → `edgeCoordinator.ts:203-236` | **R/W** `edge_nodes` |
| Robot start | `edgeGatewayRuntime.ts:515-516` → `robotManager.ts:41-42` → `robotCommandDispatcher.ts:527-533` (`reconcileOrphanedRobotJobs`) | **W** `robot_jobs` |
| Robot load | `robotManager.ts:58` → `robotAdapter.ts:31-52` | **R** `robots`, `stations`, `production_lines`, `workshops`, `factories` (N3 at `:49`) |
| Motion-lock restore | `robotManager.ts:72-75` → `robotMotionLockStore.ts:129-135` | **R** `robot_motion_locks` |
| Motion-lock persist | `robotMotionLockStore.ts:65-84` (upsert), `:108-113` (delete) | **W** `robot_motion_locks`. This is how N2 arises: one shared row, generations not coordinated. |

### 1b. The execution agent (Đợt 9 S3)

| Path | Code | DB access |
|---|---|---|
| Local check (ID mapping) | `edgeExecutionAgent.ts:327-338` | **R** `orchestration_workflows` |
| Local digest | same function → `foeGateApproval.ts:263`, `:374-410` `loadBinding` | **R** `machines`, `device_adapters`, `device_tags`, `robots`, plus controller reads |
| Local status | `edgeExecutionAgent.ts:413-423` | **R** `orchestration_runs` |
| Run guard when central is down | `edgeExecutionAgent.ts:389-390` → `edgeRunGuard.ts:38-52` | **R** `orchestration_runs`, `orchestration_run_edge_assignments`, `edge_node_credentials` |
| STOP re-send | `edgeExecutionAgent.ts:264-265` → `foeEngine.ts:4650-4662` → `resendAbortStops` | **R** runs; **W** `abort:` step rows |
| Local abort | `edgeExecutionAgent.ts:430-431` → `foeEngine.ts:4673` → sweep `readRunStepRows` `:3842-3846`, `verifyStopsForAbort` `:3963-3966` (`makeStopVerifier` reads tag pins) | **R** step rows and `device_tags`; **W** `abort:` rows |

### 1c. The engine walk (`driveEdgeClaimedRun`, `foeEngine.ts:4616-4641`)

| Code | DB access |
|---|---|
| `:4619`, `:4622` (`edgeExecutionSchema.ts:56`), `:4631`, `:4635` | **R** `orchestration_runs`, the assignment, `orchestration_workflows`, `users` |
| `buildRunContext` `:2346` → `loadMachines` `:564-576`, `loadCompletedSteps` `:583-595` | **R** `machines`, `orchestration_run_steps` |
| `upsertStep` `:679-742` (called from `execStep` `:1007`, `:1024`, `:1044`, `:1058`; `runStepBody` `:1103`, `:1118`; waits `:2217`, `:2235`; compensation `:2259`, `:2263`; result `:2160`) | **W** `orchestration_run_steps` |
| `setRunStatusUnlessAborted` `:650-677` (`finishWalk` `:2313-2339`, compensation `:2256`) and `persistContext` `:744-758` | **W** `orchestration_runs` |
| `appendRunEvent` (`runEventStore.ts:28`, from `:639`, `:741`) | **W** run event log |
| `findSeparateGateApproval` `:1145-1177` → `deriveRunApprovalIdentity` (`foeGateApproval.ts:118`) → `runApiKeyIdentity.ts:84-85`, `:105-122`; `computeBindingDetail` / `recordedProgramDigests` (`foeGateApproval.ts:274`, `:345`) | **R** runs, run steps, `api_keys`, `api_key_holder_changes`, binding tables |
| `withResolvedAdapter` `:1211-1236` | **R** `device_adapters` |
| `ensureOrchestrationAction` `:818-884` (called at `:2137-2139`) | **R/W** `ai_pending_actions` |
| Edge guard `:2074-2090` (`rc.edgeGuard`, set at `:4639`) | **R** see `edgeRunGuard` |

### 1d. OT dispatcher (`ot/commandDispatcher.ts`), reached through `equipmentAdapter.ts:28` → `dispatch` `:1041`

- **`:1048-1050`: with no DB the dispatcher refuses everything, STOPs included (`DB_UNAVAILABLE`).** An edge without a DB therefore cannot send even a pinned OT stop through today's dispatcher.
- **HITL:** `:1064`, `:1076` read `ai_pending_actions`.
- **Idempotency:** `:1105` reads `command_log`.
- **Adapter and tags:** `:1115` reads `device_adapters`; `:1134` reads `device_tags`.
- **Commissioning:** `:1183` → `commissioningService.ts:71-75`.
- **Pinned stop:** `:923` (`labelUnpinnedStop`) and `:867-871` (`runningConnectionMatchesAdapterRow`) read `device_adapters` / tags.
- **Safety preflight:** `:1313`, `:1496` → `adapterFacade.ts:266-276` → `safetyPlcAdapter.ts:320-329` (`safety_plc_configs`) and `safetyTarget.ts:101-140` (adapters, machines, stations, robots).
- **Interlock:** `:1385` → `interlock/interlockGate.ts:48-114` reads `spc_rule_violations`, `process_results`, `cpk_history`, `ot_telemetry`. The trigger path (`:2449-2509`) reads `interlock_rules` / `interlock_events`.
- **Reservation:** `reserveRealWrite` `:2283-2390` takes an advisory lock, reads `command_log`, and consumes `ai_pending_actions` through `foeApprovalDbRefusal` (`foeGateApproval.ts:587-627`).
- **Ledger:** `:2561-2662` writes `command_log`.
- **Control audit:** `:2085-2137` writes `control_audit_log`.

### 1e. Robot dispatcher (`robot/robotCommandDispatcher.ts`), reached through `equipmentAdapter.ts:31`

- **Idempotency:** `:609` reads `robot_jobs` (STOP bounded).
- **HITL:** `:703-712` reads `ai_pending_actions`.
- **FIELD_V2 authorisation:** `:133-140` reads `robots` and `users`.
- **Enabled check:** `:793` → `robotEnabledGate.ts:18-23` reads `robots.isEnabled`.
- **Persisted lock:** `:801-802` → `robotSharedMotionLockGate.ts:38-47` reads `robot_motion_locks`. This is where N1 arises: on central the read happens only when `:28` is true.
- **Commissioning:** `:103-109` reads `robot_commissioning_records`.
- **Safety preflight:** `:949-956` → the same facade / target reads as OT.
- **Interlock:** `:991-993` → `interlockGate`.
- **Reservation:** `reserveRobotJob` `:1100-1150`:
  - `preReadProgramChecksForAction` (`foeGateApproval.ts:309-326`);
  - `ai_pending_actions FOR UPDATE` plus a consume;
  - `foeApprovalDbRefusal`;
  - `readRobotAutomationState` (`robotAutomationAction.ts:68`).
- **Ledger:** `record` / `finalize` `:365-433` write `robot_jobs`.
- **Control audit:** `:1354-1361` writes `control_audit_log`.

### 1f. Paths not taken on the edge today, but taken after this đợt

- `robotIngest.ts:153-171` writes `robot_telemetry`; `:255-265` → `safetyAuditService` writes `safety_events`, `safety_event_trust` and notifications. The edge passes `ingest:false` today (`robotManager.ts:79`); after this đợt the edge's robots feed central over HTTP.
- The safety-PLC poller runs on central only (`server/_core/index.ts`).
- `policyGate.evaluateActionPolicy` uses no DB.

### 1g. Secrets the edge needs today besides the DB

The OPC-UA passwords in `device_adapters.connectionOptions` are sealed by `secretBox`. That keys off `SECRET_ENCRYPTION_KEY` or `JWT_SECRET` (`security/secretBox.ts:25`), so today the edge holds a **central master secret**. The design removes it too (decision D4).

**Count:** about 111 direct call sites in engine and dispatchers (final review), plus about 25 in boot, ingest, robots and locks. Every row above must be either served by central over the node protocol or replaced by local, journal-backed state.

---

## 2. Target architecture

### 2.1 Topology

```
EDGE (no DATABASE_URL, no SECRET_ENCRYPTION_KEY)              CENTRAL (sole DB writer)
 devices ⇄ drivers ⇄ edge dispatchers ⇄ walker(edge store)     /api/v1/edge/node/*  (node credential only)
             │            ▲ verify signed auth                  ├ config, heartbeat, program-checks
             ▼            │                                     ├ pull (+commands), claim (+signed run package)
        local journal ───► HTTP client (node credential, TLS) ─►├ runs/:id/authorize  (per non-STOP step)
        (JSONL+fsync)                                           ├ runs/:id/report, complete, release, interrupted
                                                                └ telemetry, robots/state, locks/events
```

### 2.2 Local state on the edge: the journal

**New file `server/services/edge/edgeJournal.ts`.**

- **Format:** append-only JSONL segments, the same idiom as `ot/storeForward.ts`.
  - Files live under `EDGE_JOURNAL_DIR` (a compose volume), plus an atomically renamed `state.json` snapshot.
  - Decision D3: JSONL, no new native dependency. The image runs Node 20, so there is no `node:sqlite`.
- **Epoch:** a 128-bit random epoch is created with a new journal. Every record carries `(epoch, stream, seq)`.
- **Streams:**
  - `run:<runId>:<claimSeq>` — step / context / segment reports;
  - `events` — STOPs sent, lock events, local refusals and anomalies;
  - `robot_state`;
  - OT telemetry reuses the existing `storeForward` WAL with an injected HTTP insert function (`setInsertFn`). No second buffer is needed.
- **Durability classes:**
  - `auth.consumed` is fsynced before the driver call (write-ahead of single-use).
  - Step, STOP and lock records use group commit (fsync within 50 ms). On a STOP path the write is bounded by `STOP_DB_STEP_DEADLINE_MS`, the same as today's `stopBoundedWrite` (`foeEngine.ts:980`), so it never holds a STOP.
- **Snapshot contents:**
  - the epoch and per-stream `nextSeq` / `ackedSeq`;
  - the consumed `jti`s, pruned after 2 × the maximum TTL;
  - the motion-lock state and generation per owned robot;
  - the hash of the cached signed config.
  - Claim tokens are **not** persisted, because a restart declares the claim interrupted anyway (`edgeExecutionCentral.ts:492`).
- **Bounds:**
  - Telemetry may drop its oldest records, counted and warned, as today.
  - `auth.consumed`, `step`, `stop` and `lock` records are never dropped. A full journal means no new non-STOP actuation; STOP is unaffected. Health reports `degraded`.
- **Startup:**
  - A truncated last line is ignored.
  - An unreadable snapshot means every owned robot starts locked `persistUnknown` (the same fail-closed rule as `robotMotionLockStore.ts:170-174`) and a new epoch is opened. Central audits `EDGE_JOURNAL_RESET`.

### 2.3 Node protocol

All routes are under `/api/v1/edge/node/*`. Authentication is only `requireEdgeNode` (`edgeNodeRoutes.ts:24-40`). Every run or device that is not the caller's gets the same 404. The routes are already licence-critical (`guard.ts:61`).

| Route | Purpose | Idempotency | Replaces |
|---|---|---|---|
| `POST config` | Signed **config snapshot** (§2.4); `If-None-Match: configHash` | read-only | `deviceAdapter.ts:52`, `robotAdapter.ts:31`, `listPlcConfigs`, `edgeGatewayRuntime` YAML identity, secretBox key |
| `POST heartbeat` | status, version, capacity (live / max runs), journal backlog, config hash in use, protocol version, wall clock | last-write | `edgeCoordinator.ts:125`, `:203` (the node can no longer rename itself or change its factory or lines) |
| `POST program-checks` | latest checksum readings of the node's capable adapters | upsert per (node, adapter) | central reading edge-owned controllers (D7; S Concern 3) |
| `POST pull` | as today, plus `commands[]` (signed STOP / lock / clear), `configVersion`, `keysetVersion`, `programCheckRequested`, and the per-run sweep picture for `stopsUnconfirmed` | read-only | `localStatus`, run-guard reads |
| `POST runs/:id/claim` | as today (CAS + token), **plus a signed run package** (§2.4); the edge also sends its `programChecks` | CAS on `claimSeq` | `localCheck` DB reads; `driveEdgeClaimedRun` DB reads |
| `POST runs/:id/authorize` | per non-STOP command step (§2.5) | unique (run, claim, step, attempt); same nonce returns the same token | `findSeparateGateApproval`, `ensureOrchestrationAction`, `edgeRunGuard`, `foeApprovalDbRefusal`, the dispatchers' DB gates |
| `POST runs/:id/report` | step rows, context patch, `abort:` STOP results, ledger outcomes `(epoch, stream, seq)` | strict per-stream sequence; duplicate means `200 {dup:true}`; a gap means `409 gap` | `upsertStep`, `persistContext`, `robot_jobs` / `command_log` writes |
| `POST runs/:id/complete` | segment outcome: completed / failed / aborted / paused@gate / held(reason) | the existing claim-bound sequence | `setRunStatusUnlessAborted` and `finishWalk` writes |
| `POST runs/:id/release`, `interrupted` | unchanged | unchanged | — |
| `POST telemetry` | OT sample batches for **owned** adapters → central `ingestTelemetry` (`telemetryBus.ts:828`) | storeForward natural key (adapterId, tag, ts) | `telemetryBus.ts:485-509` on the edge |
| `POST robots/state` | robot state batches for **owned** robots → central ingest | stream sequence | the "edge-only robot is invisible" grade C |
| `POST locks/events` | motion-lock events from the edge (§2.11) | stream sequence | `robotMotionLockStore.ts:65`, `:108` on the edge |

### 2.4 Signed config snapshot and run package

- **Config snapshot.** Contents:
  - `node` (id, code, factory, lines — central-owned);
  - **owned** adapters with their tags (`address`, `dataType`, `scale`, `offset`, `writable`, `isEnabled`, **`stopValue` pins**, `updatedAt`) and a connection fingerprint;
  - **owned** robots, each with `commissioned`, `isEnabled` and its current motion-lock row and generation;
  - the machines those reference;
  - the safety-PLC configs that guard the owned targets (resolved centrally with the `safetyTarget.ts` matcher, including trust digest and approval);
  - the signing keyset;
  - limits: auth TTL, maximum clock skew, journal bounds.

  Device secrets are decrypted centrally and shipped only for the node's own devices (D4). The edge caches the snapshot encrypted with `HKDF(node credential)`.
- **Run package.** Returned with the claim. Contents:
  - `definition` (the edge re-checks `hashWorkflowDefinition == defHash`);
  - `owner {id, role}`, validated centrally as active;
  - the resolved adapter per OT step (the same rule as `withResolvedAdapter`);
  - the verified STOP list with pins (the `makeStopVerifier` result);
  - the prior picture: completed / settled / attempted / startOrder / branches / `abortSentBefore` (what `loadCompletedSteps` and `priorStepsOf` compute);
  - the run context (branch decisions and `foeDispatchedSteps`);
  - an **approvals snapshot**, informational only (for logs and fail-fast; never used to decide);
  - central's binding digest, informational.
- **Why both are signed.** Pinned OT stops are sent without authorisation, using pins from the snapshot. An unsigned snapshot altered in transit could turn a "STOP" into an arbitrary write. Both objects are therefore Ed25519-signed with their own `typ` values (§2.13).

### 2.5 Per-step authorisation

**Request:**
```
{ claimSeq, claimToken, stepId, attempt, idempotencyKey, reqNonce,
  command: {kind:"ot", adapterId, machineId, commandType, writes[]} | {kind:"robot", robotId, jobType, params},
  payloadHash, programChecks:[{adapterId,status,checksum?}] }
```

**Central checks, cheapest first (the lesson of N5).** The new file is `server/services/edge/edgeAuthorizeCentral.ts`.

1. **Node and run:**
   - the assignment belongs to the caller, and the run is in the node's scope; otherwise the same 404;
   - the claim is current (`checkCurrentClaim`, `edgeExecutionCentral.ts:365`); otherwise `409 claim_stale {abortRequested}`;
   - `centralStopped` (`edgeCoordinator.ts:407`) gives `409 stopped`;
   - the run is `running` or `compensating`;
   - the node is on protocol v2.
2. **Definition and step:**
   - the head definition is still the assignment's `defHash`;
   - `stepId` is a command step, or a compensation of one, in the definition;
   - `attempt` is at most `maxAttempts + 1`.
3. **Payload binding.** Central rebuilds the command from the definition with `buildEquipmentCommand` (`foeStepClass.ts:71`) and its own adapter resolution, then hashes it with `otPayloadHash` / `robotPayloadHash` (`otActionBinding.ts:102`, `:137`). Any difference from the request gives `409 payload_mismatch` plus an anomaly audit. Central never trusts the edge's command body.
4. **Ownership.** The target robot or adapter must have `edgeNodeId = node`.
5. **Not a STOP.** A verified STOP (robot abort, or a pinned OT stop) gets `400 stop_needs_no_authorization`, because STOP must never depend on central. An unpinned stop-typed write counts as non-STOP, as on central today.
6. **Identity and approval:**
   - `deriveRunApprovalIdentity` (`foeGateApproval.ts:118`);
   - then `evaluateWithPrograms` (`:567`) with `computeBindingDetail(db, def, pre)` (`:274`), where `pre` = the edge's `programChecks` for the node's adapters. That is the existing pre-read seam.
   - A refusal gives `409 gate_required {reason}`, reusing the `FOE_GATE_REQUIRED(<reason>)` text.
7. **Device gates:**
   - **Robot:**
     - enabled (`robotEnabledGate`);
     - **no `robot_motion_locks` row of any authority, and no pending central lock request**;
     - commissioning;
     - FIELD_V2 authorisation;
     - policy (`evaluateActionPolicy`);
     - interlock (`evaluateInterlockGate(robotInterlockTarget)`).
   - **OT:**
     - adapter enabled;
     - tags enabled and writable (the semantics of `commandDispatcher.ts:1115-1148`);
     - commissioning;
     - inline interlock (`:1385`);
     - policy.
8. **Mode.** Central's `ROBOT_/OT_CONTROL_ENABLED` gives `mode: real | simulated`. The edge applies the stricter of this and its own environment, which gives central a kill switch over edge actuation.
9. **One transaction:**
   - insert an `ai_pending_actions` row with status `executed`, bound to `payloadHash` and the approval, so today's audit and inbox semantics hold;
   - insert `edge_step_authorizations` (jti, …);
   - a unique conflict with the same `reqNonce` returns the stored token; a different nonce gives `409 already_authorized`.
10. **Sign and return** `{authorization, ttlMs}`, and audit `EDGE_STEP_AUTHORIZED`.

**Authorisation claims:**
```
{ typ:"avi-edge-auth+v1", kid, jti, nodeId, credentialId, runId, claimSeq, stepId, attempt, idempotencyKey,
  kind, target:{adapterId,writes[{tagKey,address,dataType,scale,offset}]|robotId,jobType},
  payloadHash, approval:{approvedBy,gateStepId}, mode, verdicts:{commissioned,policy,interlock},
  safetyConfigIds:[…], reqNonce, iat, ttlMs }
```

### 2.6 Reporting and journal replay

- **Ordering.** Every report carries `(epoch, stream, seq)`. Central keeps one cursor per (node, stream, epoch):
  - `seq == last + 1` is applied;
  - `seq <= last` is a duplicate acknowledgement;
  - a higher `seq` gives `409 gap`, and the edge resends from the cursor.
  - A new epoch is accepted only from `seq = 1` and is audited.
- **How central applies reports:**
  - Step rows use the same guards as `upsertStep` (`foeEngine.ts:713-720`): `running` never overwrites a finished row, and a completed `abort:` row is never overwritten by `failed`.
  - Non-STOP command results must quote a `jti` issued for that (run, claim, step, attempt). Otherwise central answers `409 unauthorised_actuation` and audits `EDGE_ANOMALY`.
  - STOP results need no `jti`; they are recorded as source `edge:<node>`.
  - Results reported after the claim went stale are still recorded as evidence (step rows, `abort:` rows, ledger), but they never change run status.
  - Central writes `robot_jobs` and `command_log` rows itself, with `result.edge = {nodeId, jti}`, deduplicated by `jti`.
- **Segment end.** `complete` carries the edge's outcome. Central applies `setRunStatusUnlessAborted` semantics (`foeEngine.ts:650`):
  - `paused@gate` means central writes `awaiting_confirm`, sets `currentStepId` and writes the gate row;
  - `completed` is accepted only when the reported rows show every top-level step completed or skipped and nothing `running`.
  - Central is the only writer of the run row.

### 2.7 Ingest and trust

**Telemetry.**
- The edge-side insert-function seam in `telemetryBus` posts to `telemetry` through `storeForward`.
- Central checks that the adapter is owned by the node, then calls `ingestTelemetry`.
- UNS publishing stays as it is: it is non-authoritative and touches no DB.

**Robot state.**
- Central checks ownership, then runs the logic of `ingestRobotState` (`robotIngest.ts:153`): `robot_telemetry`, registry status, socket emit, and e-stop transitions derived **centrally** from consecutive accepted states.
- **Trust (D6):** the edge has no field that can make an event trusted. The schema is strict, so `trusted`, `origin` or `safetyCritical` gives a 400.
  - Central uses `recordFromDeviceIngest("edge_robot_telemetry")` only when (node, robot) has a maker-checker approval (0375) and the vendor is in `TRUSTED_ROBOT_TELEMETRY_VENDORS` (`trustedSafetyOrigin.ts`).
  - Otherwise central uses a plain `record()`, so the notice is normal.
  - The edge never reaches `safetyAuditService`.

**Program checks.**
- The edge reads its capable adapters (`readAdapterProgramCheck`, `programChecksum.ts:131`) at most every `EDGE_PROGRAM_REPORT_MS` (default 30 s), and also when pull says `programCheckRequested`.
- For edge runs, central uses the latest report (age at most `EDGE_PROGRAM_REPORT_MAX_AGE_MS`) both:
  - at approval (`foeEngine.ts:3310`) and on the approver's screen (`getRun`);
  - inside `/authorize`, where the readings come fresh in the request.
- Central never reads an edge-owned controller.

### 2.8 Abort, reject and other central-to-edge signals

- **Unchanged channels:**
  - `abortRequested` and `claim_stale` on progress, pull and authorize answers;
  - a central abort or reject makes the next `/authorize` answer `409 stopped`, and the walker then runs the local sweep (`stopLiveRunForCentralAbort`, `foeEngine.ts:4673`).
- **New `commands[]` on pull and progress.** Entries are signed with `typ:"avi-edge-cmd+v1"`, and each is one of:
  - `stop {robotId | adapterId, requestId}` — a console STOP for an edge-owned device;
  - `lock {robotId, requestId}`;
  - `clear {robotId, expectedGeneration, requestId}`.

  Commands reach the edge at the progress cadence (2 s). Long-poll can come later (D10).
- **Verification rules:**
  - STOP is sent even if the signature check fails; the failure is logged as an anomaly (L-7).
  - `clear` raises energy, so it requires a valid signature, an unexpired command and a generation match.

### 2.9 STOP on the edge (L-7)

- **What counts as a STOP:**
  - a robot `CANONICAL_STOP_JOB` (`robotCommandDispatcher.ts:213`) sent straight to the driver;
  - an OT **pinned** stop: `classifyOtStop` / `canonicalisePinnedStop` (`commandDispatcher.ts:836`, `:901`) using pins from the signed snapshot, with the connection fingerprint compared against the snapshot (this replaces `runningConnectionMatchesAdapterRow`, `:867`).
- **What a STOP never needs:** authorisation, central, or a DB.
- **Simulated rule.** A robot the snapshot knows to be uncommissioned has its STOP recorded as `simulated` (R-1C-d). Unknown means the STOP is sent.
- **Afterwards:** the STOP is journaled (bounded) and reported, and central writes the `abort:` / ledger rows.

### 2.10 Offline behaviour

- **No claim, no package, no new run.**
- **Walking run, non-STOP step.** The authorisation cannot be fetched, so the walker gets the store verdict `unavailable`. Under D5 the step outcome is **held**: the run pauses with reason `centralUnreachable`, nothing is sent, and there is no compensation of that step.
- **Authorisation already fetched.** It is valid only while `now_mono < requestSentMono + ttlMs`, so it lapses within seconds.
- **STOPs and STOP compensations** still go out.
- **Reconnect.** The journal is replayed in sequence. Central deduplicates and applies, and run status follows the segment report (`held(centralUnreachable)`), after which a person can Continue.
- **Restart.** The existing `interrupted` → `held` path applies. Consumed `jti`s stay in the journal.

### 2.11 Motion lock: two-way, one authority per robot

- **The lock authority** of a robot is `central` when `robots.edgeNodeId` is null, otherwise `edge:<nodeId>`. Only the authority holds a driver session that can move the robot:
  - central's `robotManager` skips edge-owned robots;
  - the edge's config contains only its own.
- **Source of truth** is the authority's in-memory `MotionLock` (`robotDriver.ts:186-260`). `robot_motion_locks` is a mirror **written only by central** and gets a new `authority` column.
- **Generation:**
  - the authority's `MotionLock.generation`, monotonic per robot;
  - the edge persists it in the journal and at boot takes `max(journal, snapshot.row.generation)`, so it never goes backwards, even after journal loss;
  - on an ownership change the new authority starts from `max(row.generation, robots.motionLockGenerationFloor) + 1` with the robot **locked** (`ownerChanged`) until a confirmed STOP.
- **Edge lock event `{robotId, event, generation, reasonCode, since, clearedBy}`:**
  - `locked` → central upserts with `authority = 'edge:<node>'` where the stored generation is at most `g`;
  - `cleared` → central deletes `WHERE authority = 'edge:<node>' AND generation <= g`;
  - a report for a robot the node does not own is refused.
  - **This closes N2:** an edge can never delete central's row, and central's console clear never deletes an edge row directly.
- **A central lock blocks edge motion:**
  - an operator lock creates a `robot_motion_lock_requests` row, and `/authorize` refuses motion at once (offline-safe, because no authorisation means no motion);
  - the request is delivered as a signed command; the edge locks and reports; central acknowledges.
  - A central `clear` is delivered signed with `expectedGeneration`. The edge uses `clearByOperator` compare-and-clear (`robotDriver.ts:250-260`) and reports.
- **An edge lock blocks central motion:**
  - a row of any authority means central's dispatcher refuses (`persistedMotionLockCheckRequired`, `robotSharedMotionLockGate.ts:28`, becomes always true — closes **N1**);
  - motion on an edge-owned robot from central is refused with `ROBOT_OWNED_BY_EDGE` in any case, because central has no session;
  - `robotRouter.ts:180` `clearMotionLock` for an edge-owned robot enqueues a `clear` command instead of calling the driver.

### 2.12 Device ownership

- `robots.edgeNodeId` and `device_adapters.edgeNodeId` (0374, nullable, null = central) together decide **connect, ingest, control and lock authority**.
- Central's `otManager` and `robotManager` skip edge-owned devices. This fixes the duplicate poll and duplicate e-stop recording of final-review I1.
- An assignment must name only targets owned by the node. This is checked at `startEdgeAssignedRun` and again at `/authorize`.
- An ownership change is an admin action: CLI or admin tRPC, recorded in WORM history. It is refused while a `robot_jobs` / `command_log` row is `running`.

### 2.13 Signing

- **Algorithm:** Ed25519, already used in the repo by `license/ed25519License.ts` and `security/x509Mint.ts`.
- **Signed object:** `canonicalJSON(claims)` prefixed with a domain string `"avi-edge-v1\n" + typ + "\n"`. The `typ` values are `auth`, `config`, `runpkg`, `cmd` and `keyset`. The domain separation means a signed config cannot be passed off as an authorisation.
- **Key custody, central side** (the same discipline as the internal CA, `internalCa.ts:1-14`):
  - the private key comes from `EDGE_SIGNING_KEY_PEM` or `EDGE_SIGNING_KEY_FILE` (mode 0600) and is **never in the DB**;
  - `scripts/edge-signing-key.ts generate|rotate|list` manages it;
  - public keys with kid, status (`next` / `active` / `retired`) and validity are recorded in `edge_auth_signing_keys` for audit and distribution;
  - every central instance loads the same key.
- **Rotation:**
  1. publish `next` at least two config cycles before use;
  2. switch the signer;
  3. keep `retired` in the keyset until the maximum TTL plus skew has passed.

  Each keyset update is signed by an already-trusted key (a chain). Recovering from a compromise means re-provisioning: the credential bundle re-pins the keyset.
- **Trust on the edge:**
  - the keyset is pinned at provisioning: the CLI writes `edge-keyset.json` (read-only) next to the credential file;
  - after that, only keyset updates chained from a pinned key are accepted.
- **Replay window:**
  - `ttlMs` defaults to 10 s, bounded to 3–30 s;
  - the edge measures validity **from when it sent the request**, on its monotonic clock, so neither clock skew nor slow delivery widens the window;
  - single use: a `jti` is never consumed twice (journal, fsynced before the send);
  - `reqNonce` must be one this process issued and is still waiting on, which defeats a replay after a restart even if the journal was lost;
  - central enforces one `jti` per (run, claim, step, attempt), and accepts one result report per `jti`.
- **The edge verifier** (`edgeAuthorizationVerifier.ts`) checks, right before the driver call and after the local gates:
  - signature and trusted kid, and the right `typ`;
  - `nodeId` is its own;
  - run, claim, step, attempt and idempotency key match the command context;
  - **the recomputed hash of the exact bytes about to be sent equals `payloadHash`**;
  - the nonce is pending, the TTL holds and the `jti` is unused.

### 2.14 How the engine and dispatchers change

**Engine (`foeEngine.ts`).** `RunContext` (`:476`) gains `store: RunStore`:

```ts
interface RunStore {
  upsertStep(runId, stepId, stepType, patch): Promise<void>;           // :679
  setStatusUnlessAborted(runId, status, patch, onlyFrom?): Promise<boolean>; // :650
  persistContext(rc): Promise<void>;                                      // :744
  appendEvent(runId, kind, data): void;                                   // runEventStore
  resolveAdapter(kind, machineId, args, stepId): Promise<Record<string,unknown>>; // :1211
  authorizeCommand(rc, step, attempt, cmd, isStop):                       // :1145 + :818 + :2074
    Promise<{ok:true; approval; authToken?} | {ok:false; verdict:"refused"|"stopped"|"stale"|"unavailable"; reason?}>;
  sweepSource(rc | storedPicture): Promise<AbortSweepSource>;             // :3872 / :3917
}
```

- The central store wraps the existing functions **verbatim**, so the existing foe suites, including the L-7 timing ones, must stay green unchanged.
- `rc.edgeGuard` (`:526`, `:2074-2090`) and `edgeRunGuard.ts` are deleted.
- `driveEdgeClaimedRun` (`:4616`) becomes `driveEdgeRunFromPackage(pkg, claim, store)`, which reads no DB.
- `resendStopsOfAbortedRun` (`:4650`) takes the stored picture from the pull.

**Dispatchers.**
- Extract the device stage, with no change to central behaviour:
  - `commandDispatcher` → `ot/otDeviceWrite.ts`: queue (`tryEnqueueAdapterCommand` `:637`), write, readback, stop-watch (`:1910`), hold slot after a timed-out write (`:1831`);
  - `robotCommandDispatcher` → `robot/robotDeviceRun.ts`: motion slot (`:504`), timeout race and `stopAfterUnknownOutcome` (`:435`), `lockMotion` (`:1293-1305`).
- New thin edge front ends `ot/otEdgeDispatch.ts` and `robot/robotEdgeDispatch.ts`, each doing: verify → local gates (driver, in-memory lock, slot, safety preflight from snapshot configs) → journal consume → device stage → journal / report.
- `equipmentAdapter.ts:28`, `:31` route to them in edge mode, with `cmd.edgeAuthorization`.

### 2.15 Runtime guard against the DB

- `server/db/connection.ts`: when `AVI_PROCESS_ROLE=edge`, `getDb`, `getJobsDb` and the read pool:
  - return null, log loudly once and increment a counter (production);
  - throw under `EDGE_DB_TRAP=throw` (tests and CI).
- `edgeGatewayMain.ts` sets the role before any import.

---

## 3. Migrations

All four follow the 0363–0370 pattern:
- the owner `aoi` runs the DDL; `apply-migration-03xx.mjs --test-only|--dev-only`; the script refuses to run with no flag;
- `lock_timeout 5s`; idempotent;
- the avi_app behaviour is probed inside a transaction that is always rolled back;
- tables are declared only as **narrow projections** in `server/services/edge/edgeControlSchema.ts`. That avoids the 0368 lesson: a new column on `robots` or `device_adapters` in the full drizzle tables would break every `select().from(robots)` when the migration is missing.

| # | Content |
|---|---|
| **0372** `edge_step_authorizations` | jti (uuid PK), edgeNodeId, credentialId, runId, claimSeq, stepId, attempt, idempotencyKey, kind, payloadHash, approvalJson, verdictJson, kid, reqNonceHash, issuedAt, expiresAt, resultReportedAt, resultStatus, supersededAt. **UNIQUE** (runId, claimSeq, stepId, attempt). Write-once trigger on identity columns using `IS DISTINCT FROM`. avi_app: SELECT / INSERT plus column UPDATE on (resultReportedAt, resultStatus, supersededAt); no DELETE. FK to the run with ON DELETE CASCADE. |
| **0373** report streams and keys | `edge_node_report_cursors` (edgeNodeId, stream, epoch, lastSeq, updatedAt; PK of the first three; monotonic trigger). `edge_node_program_reports` (edgeNodeId, adapterId, status, checksum, readAt, receivedAt; PK node+adapter). `edge_auth_signing_keys` (kid, publicKeyPem write-once, status, notBefore, retiredAt, createdBy). `edge_nodes."protocolVersion" smallint DEFAULT 1`. |
| **0374** ownership and lock authority | `robots."edgeNodeId"`, `device_adapters."edgeNodeId"` (FK `edge_nodes`, ON DELETE RESTRICT). `robots."motionLockGenerationFloor" integer DEFAULT 0`. `robot_motion_locks."authority" varchar(40) NOT NULL DEFAULT 'central' CHECK (authority='central' OR authority ~ '^edge:[0-9]+$')`. `robot_motion_lock_requests` (id, robotId, edgeNodeId, kind lock/clear/stop, expectedGeneration, reason, requestedBy, createdAt, deliveredAt, ackedAt, ackGeneration, outcome). `device_owner_changes` (WORM history). Trigger: an owner change is refused while a ledger row is `running`, and the change raises the floor. |
| **0375** (only if D6 = trust allowed) | extend `ck_safety_event_trust_origin` (0371 line 38) with `'edge_robot_telemetry'`. `edge_robot_trust_approvals` (node, robot, digest, approvedBy ≠ editedBy — maker-checker like 0368). |

**Safe order: 0372 → 0373 → 0374 → 0375**, after 0368–0371.

**If missing:**
- the v2 node routes answer 503 `edge_unavailable`;
- assignment to a v2 node is refused;
- central paths are unchanged (narrow projections).

---

## 4. Work breakdown

Six groups. A lands first, a small contract commit by about day 2. B–E then run in parallel against A's contract with fakes. F scaffolds early and finishes last.

### Group A: contract, signing, migrations, DB trap

- **New files:**
  - `server/services/edge/edgeProtocol.ts` — zod schemas for every body and answer, error codes, stream names;
  - `server/services/edge/edgeSigning.ts` — sign / verify, canonical JSON, domain separation, keyset chain;
  - `server/services/edge/edgeControlSchema.ts`;
  - `scripts/edge-signing-key.ts` (with a test);
  - `drizzle/0372–0375*.sql` and `scripts/apply-migration-0372…0375.mjs`;
  - `edgeSigning.dot10.test.ts`, with vectors and a tamper test per field.
- **Edits:** `server/db/connection.ts`, the edge-role trap (a single small hunk, committed early by pathspec; it is a hot shared file).
- **Outcome:** B, C, D and E code against fixed types.

### Group B: central authority endpoints

- **Owns:**
  - `edgeExecutionCentral.ts`:
    - the claim returns the signed package;
    - pull carries commands, `configVersion` and `programCheckRequested`;
    - **N4**: hold only when the heartbeat is stale, and say "waiting for edge capacity" when the node is at `maxConcurrent`, never "unreachable";
    - **N5**: run the claimSeq / status / type checks before any device or digest work, plus a per-run minimum interval;
    - **N6**: `resolveAssignableNode` gives `unavailable` when `EDGE_RUNTIME_ENABLED` is off, so `startRun` refuses.
  - New files: `edgeAuthorizeCentral.ts`, `edgeReportsCentral.ts`, `edgeIngestCentral.ts`, `edgeConfigCentral.ts`, `edgeNodeCommands.ts` (command and lock-request queue).
  - Existing files: `edgeNodeRoutes.ts`; `edgeNodeHealthScheduler.ts`; `edgeCoordinator.ts` (v2 heartbeat from the principal; `registerNode` no longer self-registers for v2).
- **Uses read-only:**
  - from `foeGateApproval`: `deriveRunApprovalIdentity`, `evaluateWithPrograms`, `computeBindingDetail(pre)`;
  - `foeStepClass.buildEquipmentCommand`, the `otActionBinding` hashes, `interlockGate`, `commissioningService`, `robotEnabledGate`, `policyGate`;
  - C's exports `applyEdgeSegmentEnd` / `recordEdgeStepRows`.
- **Tests:** `edgeAuthorize.dot10.db.test.ts` (each refusal reason, single use, idempotent nonce), `edgeReports.dot10.db.test.ts` (sequence, gap, epoch, stale-claim evidence, a result with no jti), `edgeIngest.dot10.db.test.ts`, `edgeConfig.dot10.db.test.ts` (scope: no other node's device or secret).

### Group C: engine, one walker with two stores

- **Owns:**
  - `foeEngine.ts` exclusively (port, removal of `edgeGuard`, `driveEdgeRunFromPackage`, exports for B; **N4 part**: Continue at `:3315` clears the `edgeUnreachable` / `interrupted` marks; approval-time digest for edge runs from node reports at `:3310` and in `getRun`);
  - new `foe/foeRunStore.ts` (interface and central store);
  - new `edge/edgeRunStore.ts` (edge store: package, journal, authorise client, through E's client interface);
  - deletes `edge/edgeRunGuard.ts`.
- **Tests:**
  - every existing foe suite passes unchanged;
  - new `foeRunStoreParity.dot10.test.ts`: the same definitions walked through the central store and an in-memory edge store must give the same step-row and outcome sequence (gate pause, branch, parallel, retry, compensation, abort sweep).

### Group D: edge dispatch, device ownership, motion-lock authority

- **Owns:**
  - `ot/commandDispatcher.ts` (extraction to new `ot/otDeviceWrite.ts`; export the classify / canonicalise helpers);
  - `robot/robotCommandDispatcher.ts` (extraction to new `robot/robotDeviceRun.ts`; central `ROBOT_OWNED_BY_EDGE`; persisted-lock read always on — **N1**);
  - new `ot/otEdgeDispatch.ts`, `robot/robotEdgeDispatch.ts`, `edge/edgeAuthorizationVerifier.ts`;
  - `equipment/equipmentAdapter.ts` (routing);
  - `robot/robotMotionLockStore.ts` (authority column; edge persistence through an injected journal / report sink — **N2**);
  - `robot/robotSharedMotionLockGate.ts`;
  - `robot/robotManager.ts` (config-sourced robots on the edge; state sink instead of `ingest:false`; central skips edge-owned robots);
  - `robot/robotAdapter.ts` (**N3**: the factory is required whenever a scope is given, otherwise `[]`; central excludes edge-owned robots);
  - `safety/plc/safetyPlcAdapter.ts` and `ot/safetyTarget.ts` (config-source seam on the edge);
  - `routers/robotRouter.ts` (clear / lock / STOP for edge-owned robots go through B's `edgeNodeCommands`; no new procedure).
- **Tests:**
  - `otEdgeDispatch.dot10.test.ts`, `robotEdgeDispatch.dot10.test.ts` (verifier fakes; STOP never asks);
  - `motionLockAuthority.dot10.db.test.ts` (an edge clear cannot delete central's row; a generation-mismatched clear is refused; ownership transfer starts locked);
  - every existing dispatcher suite unchanged.

### Group E: edge runtime (journal, client, agent, sources)

- **Owns:**
  - new `edge/edgeJournal.ts`, `edge/edgeCentralClient.ts` (node credential, timeouts, verification of signed config / package / commands), `edge/edgeConfigSource.ts`, `edge/edgeStreams.ts`;
  - a rewrite of `edgeExecutionAgent.ts`: removes `localCheck` (`:322`), `localStatus` (`:413`) and the run-guard fallback (`:389`); claim → package → `driveEdgeRunFromPackage`; commands; STOP re-send from the package picture;
  - `edgeGatewayRuntime.ts`: HTTP heartbeat; remove `registerSelf` (`:283`) and the mapping import (`:423`, `:435`); boot order config → sources → OT → robots → agent;
  - `server/edge/edgeGatewayMain.ts` (role);
  - `ot/deviceAdapter.ts` (adapter-source seam, plus central filtering of edge-owned adapters);
  - `telemetryBus.ts` (insert-function seam; one small shared hunk).
- **Tests:**
  - `edgeJournal.dot10.test.ts` (truncated tail, fsync ordering, epoch, compaction, a full journal blocks only non-STOP);
  - `edgeExecutionAgent.dot10.test.ts` (fake central);
  - `edgeGatewayBoot.dot10.test.ts` (boots and runs OT plus the agent with `DATABASE_URL` unset and the trap set to throw).

### Group F: verification, operations and the Đợt 9 minors

- **Owns:**
  - the two-process E2E and attack suites (§5);
  - `edgeNoDb.hygiene.dot10.test.ts`, and updates to `edgeCredentialHygiene.dot9.test.ts`;
  - a rewrite of §8 of `docs/EDGE_GATEWAY.md`;
  - `deploy/edge/docker-compose.edge.yml` (**remove `DATABASE_URL` at `:93`**; add the journal volume), `docker-compose.edge.execution.yml` (a keyset file secret), `Dockerfile.edge`;
  - `scripts/edge-node-credential.ts`:
    - **N7**: read the password from stdin when there is no TTY, refuse the env var, refuse any `--password*` / `--otp*` prefix;
    - new `register-node --factory --lines`;
    - the bundle writes the keyset pin;
  - `edgeNodeCredentials.ts` (**N8**: audit `login_2fa` failures and count them into the lockout);
  - census re-pins in `edgeRuntimeLatent.dot8.test.ts` and `orchestrationScopeCensus`.

### Shared files that need a controller integration commit

- `server/api/v1/openapi.ts` (new routes);
- `server/routers/phamViTuyenCensus.test.ts` (D +8 routes, plus the total);
- `congGiayPhepAiCensus.test.ts`, only if admin tRPC procedures for ownership or keys are added (the CLI alone avoids it);
- the vi / en / zh locale files: N4's "waiting for edge capacity", `ROBOT_OWNED_BY_EDGE`, and `FOE_GATE_REQUIRED` reasons shown for edge runs;
- `client/.../OrchestrationStudio.tsx:2941` (N4: badge gated on status);
- `server/_core/index.ts` (central boot: the command-queue sweeper; otManager and robotManager filters, if they are wired there);
- `server/db/connection.ts` and `telemetryBus.ts`, if A or E did not land them alone.

### Sequencing

| Days | Work |
|---|---|
| 1–2 | A's contract commit. In parallel: C's central-store port (behaviour-neutral), D's extractions (behaviour-neutral), E's journal. |
| 3–8 | B's endpoints; C's edge store; D's edge dispatch and lock authority; E's agent and sources; F's hygiene, CLI, docs and attack scaffolding against fakes. |
| 9–11 | Integration commit; F's real two-process E2E and attack suite; per-group review and fix rounds. |
| After | Final review, a fix wave, then re-review. |

---

## 5. Test strategy

### 5a. Two-process E2E: `edgeExecution.dot10.e2e.db.test.ts` with child `edgeE2eChild.dot10.test.ts`

**Parent (central):**
- the real `/api/v1` router and engine on `_test`;
- the signing key generated into a temp file.

**Child (edge), proven unable to reach the DB:**
- **Spawn environment:** built from an **allowlist only** (PATH, SystemRoot, TEMP, the `EDGE_*` values, `FOE_ENABLED`, `ROBOT_*`), so `DATABASE_URL` and every `PG*` variable are absent. The child asserts `process.env.DATABASE_URL === undefined`.
- **Trap:** `AVI_PROCESS_ROLE=edge` with `EDGE_DB_TRAP=throw`. The trap counter is written to `report.json`; **the parent asserts 0**.
- **Network tripwire:** `net.Socket.prototype.connect` is wrapped to record (host, port). The parent passes only the PG **port number**, and asserts **0 connects** to it.
- **Driver tripwire:** `vi.mock("postgres", …)` throws if it is ever constructed. Assert it was never constructed.
- **Explicit probe:** `await (await import("../../db/connection")).getDb()` must be null or throw. This proves that even a deliberate attempt cannot connect.

**Scenarios:**
1. assign → claim (signed package) → authorise → run → complete, with a central gate approval in between;
2. central console motion on the edge robot is refused (`ROBOT_OWNED_BY_EDGE`);
3. abort mid-run: m2 is never sent, the STOP is sent by the edge exactly once, the run stays aborted;
4. offline mid-run: the next non-STOP step is held, the STOP still goes out, and reconnect replays every report exactly once (central row counts measured);
5. edge restart: interrupted → held; a consumed `jti` is never reused;
6. two-way motion lock:
   - an edge outcome-unknown motion locks the robot, and the row has `authority = edge:A`;
   - a central lock request makes `/authorize` refuse at once;
   - a clear with a wrong generation is refused, and the right generation clears;
7. robot state ingest: `robot_telemetry` rows appear; the e-stop becomes a plain `safety_events` row with no `safety_event_trust`;
8. telemetry ingest for owned adapters only.

### 5b. Attack suite: `edgeAttack.dot10.e2e.db.test.ts`

Every case also asserts that the device counts and central rows are unchanged.

| # | Attack | Expected |
|---|---|---|
| A1 forged authorisation | (a) signed by an attacker key under a valid kid; (b) a valid token with one claim altered (payloadHash, robotId, runId, attempt, nodeId, ttl); (c) a signed config or command presented as an authorisation (domain separation); (d) `alg:none` or an empty signature | Refused locally; driver count 0; anomaly reported and audited centrally |
| A2 replayed authorisation | (a) the same token twice; (b) after an edge restart with the journal intact; (c) after a restart with the journal wiped; (d) after the TTL, measured from the request; (e) the same `jti` reported under a new sequence number; (f) a captured `/authorize` body replayed | (a)–(d) refused (consumed jti, non-pending nonce, TTL); (e) central 409, one `robot_jobs` row only; (f) same nonce returns the identical token with no second `ai_pending_actions` row, a changed nonce gets `409 already_authorized` |
| A3 node A acting for node B | A's credential against B's run: claim, authorize, report, complete; A's telemetry for B's adapter; robot state and lock events for B's robot; A's config | The run routes return a 404 **byte-identical** to a missing run; the device routes write 0 rows (no `ot_telemetry`, `robot_telemetry`, `safety_events` or `robot_motion_locks` change); A's config holds none of B's codes or secrets (string scan); an authorisation minted for B fed to A's verifier gives `NODE_MISMATCH` |
| A4 offline actuation | Network cut; use of an authorisation obtained before the cut once its TTL is past; a rogue POST of a non-STOP result with no jti | Non-STOP refused and held; STOP still sent; the rogue POST gets `409 unauthorised_actuation` plus an audit |
| A5 forged trusted event | (a) e-stop state with `trusted:true` / `origin` / `safetyCritical`; (b) without those fields, (node, robot) not approved; (c) the same for a robot owned by another node | (a) 400; (b) a plain event, `safety_event_trust` = 0, `consumeSafetyCriticalTrust` false; (c) nothing written |
| A6 payload swap | The command authorised differs from the command sent | Central `payload_mismatch`, or the edge verifier refuses on the hash |
| A7 STOP is never blocked | Central down, keyset unknown, journal full | Robot abort and pinned OT stop are still sent |

### 5c. Other checks

- **Hygiene:**
  - no `DATABASE_URL`, `SECRET_ENCRYPTION_KEY` or `JWT_SECRET` in the edge compose files or the Dockerfile;
  - the edge boot test runs with the trap set to throw;
  - a census pins the modules reachable from `edgeGatewayMain` that contain `getDb`, as an allowlist proven unexecuted on the edge by the E2E trap count of 0.
- **Mutation testing** (repo practice; mutants that must die):
  - signature check removed; nonce check removed; jti check removed;
  - TTL measured from receipt instead of the request; authority predicate removed from lock apply;
  - ownership check removed from ingest; strict schema relaxed;
  - unique (run, claim, step, attempt) dropped; `payloadHash` comparison removed;
  - the central `ROBOT_OWNED_BY_EDGE` refusal removed.
- **Regression:** all foe, dispatcher and robot / OT suites; the S12 / S3 suites adapted to v2; the census re-pins.

---

## 6. Risks, owner decisions and size

### Risks

1. **Engine port regressions in L-7 timing.** `foeEngine.ts` has about 4.7k lines and carries the bounded-STOP proofs. Mitigation: the central store is the moved code unchanged, the existing suites run unchanged, a parity harness compares the two stores, and one owner (C) holds the file exclusively.
2. **Dispatcher extraction regressions.** The OT dispatcher is about 2.7k lines with many suites. Mitigation: extract only; no behaviour change on the central path; D owns both files.
3. **Central becomes a hard dependency for non-STOP edge actuation, by design.** A central outage stops lines at their next non-STOP step (held), while STOPs keep working. The owner must accept this (D5).
4. **Interlock evaluated on central** sees edge telemetry late, by batch interval plus TTL (a few seconds). This is a documented residual.
5. **Signing-key compromise** would allow forging authorisations for every node. Mitigation: the key is never in the DB, file mode 0600, rotation CLI, kid pinning, short TTL.
6. **Telemetry volume over HTTP.** Mitigation: batching, gzip, a per-node rate limit, and the storeForward bound.
7. **Mixed versions during cutover:** v1 nodes (with the DB) next to v2 nodes. `edge_nodes.protocolVersion` gates this: central refuses v1 claims for v2 nodes.
8. **Removing `DATABASE_URL` does not revoke what the edge hosts already know.** The `avi_app` password must be rotated after cutover (owner action), and `:5432` blocked from the OT subnet.
9. **Residual: a compromised edge** still controls its own devices and can lie about its own controllers' checksums and telemetry. The checksum gate remains change detection, not tamper-proofing (as already stated for group T).

### Owner decisions (recommendation first)

| # | Decision | Recommended |
|---|---|---|
| D1 | Full removal now, or the interim per-node Postgres role | **Full removal.** RLS was found inert in this deployment, and the interim would be thrown away. |
| D2 | One owner column for both control and ingest, or separate owners | **One owner.** It avoids two sessions on single-client controllers and makes the lock authority well-defined. |
| D3 | Journal technology | **JSONL + fsync** (no native dependency; Node 20) rather than better-sqlite3. |
| D4 | Device secrets on the edge | **Central decrypts and ships only the node's own secrets** in the signed config; the edge caches them with `HKDF(credential)`. The edge never holds `SECRET_ENCRYPTION_KEY`. |
| D5 | Offline non-STOP step | **Held** (pause, Continue later), rather than fail + compensate as today. |
| D6 | Trust for edge-ingested robot e-stops | **Plain by default.** Trusted only after a maker-checker approval per (node, robot) (0375). |
| D7 | Program checksums for edge-owned controllers | **Node-reported** for both approval and authorise; central never reads them. This also fixes S Concern 3. |
| D8 | Authorisation TTL and the window | **10 s, measured from the edge's request send on its monotonic clock.** |
| D9 | Signing key custody | **File / env PEM like the internal CA**, public keys in the DB, keyset pinned at provisioning. |
| D10 | How central signals reach the edge | **Piggyback on progress and pull (2 s)** now; long-poll later. |
| D11 | The v1 (DB) execution path | Keep it behind a per-node version **for one release**, refused for v2 nodes; delete it in Đợt 11. |
| D12 | OT telemetry transport | **HTTP batches.** No central UNS→DB consumer exists (`federation/unsSubscriber.ts` is KPI-only). |
| D13 | Mapping-as-code import | **Move it to a central CLI**; remove it from the edge. |
| D14 | Node registration | **Admin-only** (`register-node`); no self-registration. |

### Owner actions at cutover

1. Apply 0372 → 0375 with `--dev-only`.
2. Generate the signing key on central.
3. Mark device ownership.
4. Re-issue each node's bundle (credential plus keyset pin).
5. Remove `DATABASE_URL` from `.env.edge`.
6. **Rotate the `avi_app` password.**
7. Firewall `:5432` from the edge subnet.
8. Turn `EDGE_EXECUTION_ENABLED` on only after the dot10 E2E and attack suite are green.

### Size estimate (realistic)

| Group | Production | Tests | Migrations, scripts, docs |
|---|---|---|---|
| A | ~0.9k | ~0.6k | ~1.3k |
| B | ~1.8k | ~1.8k | — |
| C | ~0.9k net, plus ~0.4k moved | ~1.0k | — |
| D | ~1.5k, of which ~0.7k moved | ~1.3k | — |
| E | ~1.3k | ~0.9k | — |
| F | ~0.25k (CLI, N7/N8) | ~1.6k | ~0.4k |
| **Total** | **~6.5–7k** | **~7k** | **~1.7k** |

- **About 13–15k changed lines in all**, roughly 2.3× Group S (S was about 6.0k insertions across its 10 commits).
- The final review's 6–7k figure covered only the endpoints, the walker and the dispatcher mode. It left out:
  - config and ingest replacing the edge's DB reads and writes;
  - ownership and two-way locks (N1/N2, grade C);
  - the journal;
  - signing and keyset;
  - the dispatcher extractions;
  - the no-DB E2E and attack suite.
- **Schedule:** one full đợt with 5–6 parallel groups plus one review / fix wave. Expect about 1.5 đợt if C (engine) or D (dispatchers) needs a second fix round.

---

### Critical Files for Implementation
- D:\SOURCES\avi-aoi-management\server\services\orchestration\foe\foeEngine.ts
- D:\SOURCES\avi-aoi-management\server\services\edge\edgeExecutionCentral.ts
- D:\SOURCES\avi-aoi-management\server\services\edge\edgeExecutionAgent.ts
- D:\SOURCES\avi-aoi-management\server\services\robot\robotCommandDispatcher.ts
- D:\SOURCES\avi-aoi-management\server\services\ot\commandDispatcher.ts