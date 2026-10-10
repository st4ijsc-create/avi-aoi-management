# Đợt 5 — the remaining open items (doc 81 §7–§13) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each task is a brief. The facts, with file:line references, come from the 2026-10-10 survey: `.superpowers/sdd/2026-10-10-engineering-control-dot5/survey-1-19.md` and `survey-20-37.md`. Read the survey row for your item before coding.

**Goal:** close every item that is still open after Đợt 4 (31 of the 37 surveyed; 6 were already closed), following the owner's decisions of 2026-10-10.

**Spec:** the "Còn mở" lines of doc 81 §7–§13, the two survey files, and the owner decisions below.

## Owner decisions (2026-10-10)
- **14 smaller items** follow the survey's recommendations: 4+9, 10, 13, 16, 18, 19, 22, 25, 27, 29, 30, 32, 33, 34.
  - 13 (deploy timing channel): accepted and closed.
  - 16 (ECN form after "Bỏ thay đổi?"): accepted and closed.
  - 18 (IDE/IR/POU sheets not URL-synced): deferred until those pages are next reworked.
- **24:** option C. A run started through an API key never executes OT or robot steps that are not STOPs. STOPs still run (L-7). No migration.
- **26:** orchestration gets a factory scope. Keys with an empty `dataScopeMode` are refused. An out-of-scope STOP is blocked at deploy but allowed at start and run (L-7), with an audit entry.
- **37:** Claude builds and restarts :3000 after Đợt 5 is merged (0364/0365 are already on dev).

## Global Constraints
1. These are the same as Đợt 4: `.superpowers/sdd/2026-10-09-engineering-control-dot4/global-constraints.md` and every R-2-*/R-3-*/R-4-* ruling.
   - Commit by pathspec only.
   - No push and no build until Task Z.
   - Do not edit `.env`.
   - Use `_test` only.
2. **Data change on dev (item 19a only):** list the affected zones first and report them. Write nothing to dev until the controller has authorisation.
3. **L-7:** no STOP, e-stop or abort is gated or slowed beyond a documented bound. Exemptions for STOP must be scoped to STOP steps only; never let motion or energising writes through (lesson R-4-x).
4. **Fail-closed:** for security and scope checks.
5. RED → GREEN → mutation for every behaviour change.
6. i18n in vi/en/zh. Census tests are measurement instruments.
7. Commit messages end with "(doc 81 dot 5 task X)" and the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus
1. **26:** the scope check covers every way a definition is stored or started: deploy, rollback, API v1, QT registration, start and resume approval. Out-of-scope reads look exactly like "not found". STOPs are blocked at deploy only.
2. **24:** an API-started run can never actuate a non-STOP step, by any path: resume, edge replay or retry.
3. **25:** the approval binding digest is computed on the server. Any change to the adapter, tag or robot configuration ⇒ `staleApproval`. Robot programs stored inside the controller are a documented residual risk.
4. **4+9:** flipping the passwordless default must not lock out a tablet that was given a password through the new app setting. Document the rollout order.
5. **28:** a late `disconnect()` completion never tears down a newer session, for every driver.

---

## Group E — orchestration security (foeEngine, orchestrationRouter, api/v1)
- **E1 (24, option C):** mark runs started through an API key (`contextJson.startedViaApi` or similar, set on the server only). In `findSeparateGateApproval` / `foeApprovalDbRefusal`, a non-STOP OT or robot step of such a run is refused with reason `apiRun`, translated into vi/en/zh. STOP steps are unaffected.
- **E2 (26):** one `scopeRefusal(def, scope)` check, per the survey sketch:
  - targets = the definition's machines plus the robots of robot steps;
  - applies to all steps at deploy and rollback;
  - applies to non-STOP steps at `startRun`;
  - the approver's scope is checked at the resume approval (CONFLICT `outOfScope`);
  - `getRun` / `getWorkflow` return NOT_FOUND out of scope, and `listRuns` / `listWorkflows` are filtered;
  - API keys use `dataScopeMode`: `global` ⇒ no limit, `factory` ⇒ that factory's ids, NULL ⇒ refused;
  - an out-of-scope STOP at start or run is allowed and audited;
  - admins are unchanged.
- **E3 (25):** a binding digest is stored in the gate `resultJson` at approval and recomputed on both checks. It covers:
  - the resolved adapterId and the adapter's `updatedAt`;
  - the tag rows used (id, address, dataType, scale, `updatedAt`);
  - the robot row (id, vendor, hash of `connectionOptions`).

  A mismatch gives `staleApproval`. Robot programs are a documented residual risk.
- **E4 (35+36):**
  - A robot STOP creates no `ensureOrchestrationAction` row.
  - For an OT STOP, `ensureOrchestrationAction` and the `upsertStep(running)` before it are bounded by the existing STOP DB deadline. When the deadline passes, the STOP continues through the dispatcher's own error path.
  - Test with a hung DB.

## Group F — OT/robot runtime
- **F1 (27):**
  - Add a `runJob` branch to the VDA5050 driver for `params.vda5050 === "instantActions"`.
  - The adapter's second publish is for STOP only; for motion, take `published` from the driver.
  - Flip the pinned test to expect exactly 1 instantActions message.
- **F2 (28):**
  - The S7 and EtherNet/IP drivers use the capture-and-null-first idiom.
  - Add a driver-contract test over EVERY driver: when a late `disconnect()` resolves after a subsequent `connect()`, `isConnected()` stays true and the new handle stays intact.
- **F3 (29):** the risk window per adapter is the larger of 10 s and twice the driver's request/connect timeout.
- **F4 (34):** `recheckSafetyIfStale` skips only `stopCls.pinnedStop`, no longer every stop-type name.
- **F5 (6):** VDA5050 state `parseTimestamp` uses `docTsThietBi` (no timezone ⇒ rejected; more than 24 h in the future ⇒ rejected). On reject it falls back to server time and logs. Test that a future heartbeat no longer hides staleness.
- **F6 (33):** add a safety-critical class to `sendNotification` that ignores the in-app opt-out flags; quiet hours already work this way for URGENT. Use it for the B3 alarm and for existing safety-critical callers, listing them in the report.
- **F7 (31):** take `pg_advisory_xact_lock(adapterId)` in both `createRecord` and the stop-pin change transaction, so a signature and a pin change are strictly ordered. Add a concurrency test.

## Group G — MQTT, ingest, docs, tests
- **G1 (4+9):**
  - (a) The FactoryAlertSystem tablet app gets a Settings field for the MQTT password, kept in secure storage, and uses it to connect. Admin `rotatePassword` already shows the password once.
  - (b) Then the code default of `MQTT_ALLOW_PASSWORDLESS_REGISTERED` becomes **false**. Check the current `.env` without editing it, and report whether dev sets it explicitly.
  - Document the rollout: provision passwords, update the app, then flip.
  - Tests for both.
- **G2 (8):**
  - Fix `IoTTelemetrySection` and doc 61 §5.2: gateway allowlist, `ts` must carry a timezone, and the 403/400 codes.
  - Also fix `deploy/helm/README.md:29`.
- **G3 (11):** add a DB test that the connection fingerprint goes through the real `loadEnabledAdapters`.
- **G4 (12):** add a contention test with two concurrent stop-pin writes (FOR UPDATE): no lost update, and the audit "before" value is correct.
- **G5 (21):** add the exact path `/api/saml/acs` to the originCheck exempt list. Test it under `enforce`.
- **G6 (23):** the d3b1 suite stops leaving `audit_logs` rows; follow the survey's suggested approach.

## Group H — UX and measurement
- **H1 (15):** in POU, collapsing the right panel closes Copilot, and the AI button while collapsed expands the panel.
- **H2 (17):** on narrow screens, Interlock row selection no longer switches the tab; only the explicit "Mở panel Sự kiện" button does.
- **H3 (19):**
  - (b) The Fleet map's factory selector comes from the caller's scoped factory list.
  - (a) List the dev zones that have no `factoryId`, with the suggested factory for each, into the report. The controller asks the owner before writing anything.
- **H4 (22):** if every factory shares one valid timezone, the admin with no line selected uses it. Otherwise keep the browser clock and the label.
- **H5 (30):** the assignee roster only includes users who share at least one factory with the target, or with the assigner when the entity has no factory. Admins are unchanged.
- **H6 (10):** a Playwright end-to-end test on `_test`, on your own ports, through an existing surface (an orchestration run with an OT STOP step). The refusal sentence must render, translated. No new STOP button.
- **H7 (32):** a licensed Causal canvas check.
  - Add an env override for the licence state-cache path (test process only).
  - Check once with a licence that includes MOD_AI (renders) and once with one that excludes it (gated correctly).
- **H8 (20):** re-measure Fleet at 1600 with the layout instrument. Re-calibrate only per the instrument's own procedure, with a dated note.

## Task Z — review, merge, build
- Run a task review per group, then a whole-branch review, one final fix wave and a re-review.
- Write doc 81 §14 and add a pointer in doc 80.
- Ask the owner about merge and push.
- After the merge: `npm run build`, then restart :3000 with NODE_ENV=production (owner decision 37). Verify the build info and the main pages, and report.
