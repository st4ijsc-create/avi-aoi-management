# Đợt 4 — close the remaining open items (security · robot/OT · UX/data · server-side user prefs) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each task is a brief; the implementer reads the code in place. Facts come from the 2026-10-09 code survey (file:line references inside each task).

**Goal:** close the open items listed in doc 81 §8–§12 ("Còn mở") that the owner chose on 2026-10-09: groups A (security/scope), B (robot/OT correctness), C (UX + data) and D (server-side user preferences).

**Spec:** the "Còn mở" lines of doc 81 §8–§12 and the owner's choice of 2026-10-09 (A+B+C+D). The decisions marked **[QĐ-4x]** are asked when the plan is approved.

## Global Constraints
1. Same as Đợt 3b/3c (`.superpowers/sdd/2026-10-09-engineering-control-dot3c/global-constraints.md`) plus every R-2-*/R-3-*/R-3b-*/R-3c-* ruling:
   - commit by pathspec;
   - no push or build;
   - don't edit .env;
   - **never connect to `aoi_management` (dev)**; use `_test` only.
2. **Migrations:** 0364 (`robot_motion_locks`, Task B4) and 0365 (`user_settings.uiPrefs`, Task D1).
   - Each follows the 0362/0363 pattern: idempotent, `lock_timeout`, an explicit target flag, permission checks and a ledger entry.
   - Apply them to `_test` only. The owner decides on dev.
3. **Energy direction (L-7):** STOP is never blocked. Nothing in this đợt may make a STOP slower than a bounded, documented limit.
4. **Fail-closed:** a security fix that can't decide the scope must deny, never allow.
5. RED → GREEN → mutation for every behaviour change. i18n in vi/en/zh. Censuses are measuring instruments.
6. Commit messages: no diacritics, "(doc 81 dot 4 task X)", trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus
1. **A1:** a config not tied to any target must still apply globally. A target that can't be resolved must count as in scope (fail-closed).
2. **A2/A3:** admin output is unchanged; non-admin output never shows another factory's data.
3. **A5:** OT and robot steps of orchestration can't run without a separate human approval, chosen per [QĐ-4a]. Existing runs and gates must not get stuck without a clear message.
4. **B3:** a STOP waits at most the grace time chosen in [QĐ-4b], never indefinitely.
5. **B4:** a robot locked before a restart is still locked after it, cleared only by STOP or by an audited operator action.

---

## Group A — security and scope

### Task A1: Safety-PLC config by target
- `getSafetyStatus` (`server/services/ot/adapterFacade.ts:264`) currently reads every enabled config. Change it to read only configs for the target plus configs with no target.
  - The table already has `robotId`/`stationId`/`lineId`/`factoryId` (`drizzle/schema/safetyVision.ts:92-120`), and `PlcConfigFilter` already filters on them (`safetyPlcAdapter.ts:250-270`).
  - Add `robotId` to the facade context. The robot path currently passes `adapterId:-1, machineId:null` (`robotCommandDispatcher.ts:891`).
  - Resolve robot → line/station via `robots`, and machine → station → line → factory.
- Update `safetySourceHealth.ts:176` so it predicts the same result.
- Tests:
  - an offline real PLC at line 2 does not block a write at line 1;
  - a config with no target still blocks everything;
  - a target that can't be resolved means every config applies;
  - mutations.

### Task A2: Audit log readers by scope
- `activityFeed` (`enhancedAuditRouter.ts:302-343`) gets `requirePermission`.
- `activityFeed` and `masterDataList` (:496+) filter for non-admin users:
  - hierarchy entity rows whose id is in `idsTrongPhamVi(...)` are shown;
  - rows that can't be classified are hidden, or have `details` removed;
  - admin output is unchanged.
- Tests per reader, plus mutations.

### Task A3: Twin factory endpoints
- Add the `trongPhamVi("factory", input.factoryId, phamViCua(ctx))` check, following `usdExport` at `twinRouter.ts:342-344`, to `occupancyGrid` (:379), `sceneGraph` (:289), `twinModels` (:299) and `replay` (:361).
- Out of scope gives the same response as not found.
- Fleet client: query only when the factory is known (the earlier FINAL-WAVE item).
- Tests plus mutations.

### Task A4: Retiring a machine disconnects its MQTT session
- `revokeLinkedMqttClientsTx` (`server/db/hierarchy.ts:1037-1052`) returns `deviceId`s.
- After the transaction commits, the callers (:1112, around :1604, :1632) call `disconnectMqttDevice`, the same way rotatePassword does (`mqttOeeRouters.ts:275-330`). Use a dynamic import to avoid a cycle.
- Test: a retired machine's live session is closed and cannot publish.

### Task A5: The orchestration engine stops approving itself — following [QĐ-4a]
- `ensureOrchestrationAction` (`foeEngine.ts:522-583`) currently creates `confirmed` actions for OT and robot steps, with the run owner as confirmer.
- Option (a) [recommended]:
  - OT and robot steps only get `confirmed` when an earlier `hitl_gate` step of the same run was approved by someone OTHER than the run owner;
  - record `approvedBy` in the gate result (:1520) and check it;
  - with no such gate, the step stops with a clear message (`gateRequired`).
  - `verifyActionBinding` (`commandDispatcher.ts:1545`) also checks confirmer ≠ run owner for actions from the engine.
- Option (b):
  - create the action as `proposed` and wait for confirmation in the existing approval inbox;
  - the run pauses at that step.
- Tests:
  - an OT step without an approved gate does not run;
  - a gate approved by the run owner does not count;
  - a gate approved by someone else runs exactly once;
  - mutations.

## Group B — robot and OT correctness

### Task B1: VDA5050 sends each order once
- Remove the second publish at `vda5050Adapter.ts:319`.
- `published` takes its value from the driver's result.
- Keep the second STOP channel at `sendInstantActions` (:405-410) as it is.
- Test: the fake broker receives exactly one order.

### Task B2: STOP log in dry-run has a time limit
- Apply `withDeadline(…, ROBOT_STOP_DB_STEP_DEADLINE_MS)` to the two `record(...,"simulated")` calls (`robotCommandDispatcher.ts:755-757`, `:785-791`) when `stopDb`.
- Test: a hung database still returns within 1 s.

### Task B3: STOP never overlaps a write that timed out — following [QĐ-4b]
- In `executeWriteAndVerify` (`commandDispatcher.ts:1261-1282`), when the write times out, keep the queue slot until the old `writeTags` promise settles or a grace period expires.
- If the grace expires, reset the driver session through the connection supervisor, so the STOP runs on a fresh session.
- Clear the timer and catch the dangling promise.
- Tests: a STOP queued behind a hung write starts no later than the grace period, and never while the old write is still running on the old session. Add mutations.

### Task B4: Motion lock survives a restart (migration 0364)
- New table `robot_motion_locks(robotId pk, reasonCode, detail, generation, lockedAt)`:
  - written when `lock()` runs;
  - deleted on `clearByStop` / `clearByOperator`;
  - loaded at driver registration, so a robot locked before a restart starts locked.
- The in-memory lock stays authoritative while running. A failed database write must not block `lock()`; it is logged.
- Tests on `_test`: lock → simulated restart → still locked; STOP clears it; operator clear is audited.

### Task B5: Date in `docGioTuongNhaMay`
- Replace the regex at `factoryTime.ts:277` with `coMuiGioTuongMinh`.
- Test `"09-28-2026"`.

### Task B6: Clock-drift table excludes server-stamped samples
- Add `tsSource: "device"|"server"` to `OtSample` and `CanonicalSample`.
- Drivers that stamp the time themselves set `"server"`. OPC-UA uses `"device"` only when the source timestamp is present.
- `gateSampleTs` (`telemetryBus.ts:565-600`) skips the drift record for `"server"`. When the field is absent, behaviour is unchanged.

## Group C — UX and data

### Task C1: Stop pin and adapter warnings
- The tag edit form asks first (reuse the `confirmOff.*` keys) when saving would remove a stop pin. The rule is in a shared module, so client and server use the same one (`lyDoGoStopPinKhiSuaTag`, `stopPin.ts:391`).
- `adapter.update` returns `stopPinsCleared`, and the client shows a notice.

### Task C2: CLI import records who ran it
- `--actor <userId|email>` is required when `--apply` is used. It is resolved from `users` in the same transaction and recorded in the audit.

### Task C3: "Commissioning needs rechecking" on screen
- `commissioning.status` returns the latest stop-pin change made after the current signature that is flagged for recheck.
- The "Sổ ký" dialog (SystemHealth) shows a persistent chip, cleared when the machine is signed again.

### Task C4: Exact location of nested errors
- `validateMachinePayload` (`machineDataContract.ts:186-190`) uses a validate-only mode in which `mocThoiGianMay` calls `ctx.addIssue`, so the error path is right. The ingest path still throws, as now.

### Task C5: Late fleet results
- Call `deployToFleetM.reset()` on `project/select`.
- Test switching A → B → A.

### Task C6: Assignee search beyond 300
- `assignableUsers` gets `search` (escaped ilike) and `selectedId`.
- `EntityPicker` gets `onSearchChange`, debounced.
- Add a `truncated` flag that shows "narrow your search".

### Task C7: STOP command key in the message
- Add `{{stopKey}}` to `errors.OT_COMMAND_SUPERSEDED_BY_STOP` in vi/en/zh, and update the test.

### Task C8: Check the Causal canvas
- Grant the test user the `MOD_AI` licence (in `_test`) and `analytics_root_cause` canView/canEdit.
- Check dark and light mode in the browser and take screenshots (not committed).
- Clean up the test user afterwards.

## Group D — server-side user preferences

### Task D1: `user_settings.uiPrefs` (migration 0365)
- Add a `uiPrefs jsonb NOT NULL DEFAULT '{}'` column to `user_settings`.
- The router merges an allowlisted set of keys, starting with `showLabs` and the panel sizes from `userLayoutKey`.
- On the client, `useShowLabs` and the layout helpers keep localStorage as an immediate cache and sync it to the server. On first login on a new machine, the server preference applies.
- Tests: the preference follows the account across two browsers; an unknown key is refused.

## Task E: Review, measure and merge
- Controller reviews each group, then the whole branch, then one fix round and a re-review.
- Re-measure layouts if the screens changed.
- Write doc 81 §13.
- Ask the owner about applying 0364/0365 to dev, and about merging and pushing.
