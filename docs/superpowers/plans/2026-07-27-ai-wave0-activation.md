# AI Wave 0 — Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (fresh implementer per task → adversarial task-review → fix loop → re-review). Each implementer does TDD within its task. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Make the already-built (doc-69) AI capabilities actually LIVE where users touch them — fix dead wiring, open mis-gated surfaces, and turn on proactive analysis — without adding new capability.

**Architecture:** Targeted last-mile fixes across four independent areas (KB data, vision wiring, nav gating, proactive schedulers) in the existing Node+tRPC+React codebase. Everything additive/default-safe; each task committed separately (stage ONLY that task's files; the branch has pre-existing uncommitted simulator/twin/aiActiveLearning changes that MUST stay untouched — never `git add -A`).

**Tech Stack:** Node/tRPC/drizzle(postgres-js), React/wouter, node-cron schedulers, GGUF local models.

## Global Constraints (bind every task, copy verbatim)
- **Branch:** `feat/hmi-dep`. Commit per-task, stage ONLY that task's files, do NOT `git add -A`, do NOT push (controller pushes at the Wave-0 checkpoint).
- **postgres-js/drizzle:** `db.execute(sql\`…\`)` returns ROWS DIRECTLY. Any missing-table/column fail-safe MUST use the cause-walker `server/_core/dbErrors.ts` `isMissingTable`/`isUniqueViolation` (walks `err.cause`) — NOT a naive `.code === "42P01"` (drizzle wraps the code in `.cause`; this bug was caught live).
- **Default-safe:** new schedulers/flags default OFF or gated + SERVER_ROLE=api skip + safe no-op; a failure in one must not break the app. Proactive alerts are advisory/HITL only — never auto-actuate.
- **Verify:** `npx tsc --noEmit` clean for touched files (`NODE_OPTIONS=--max-old-space-size=8192`; the pre-existing `SessionManagement.tsx` error is NOT yours). FE tasks also run `npx vite build` + the i18n-parity check. Paste command+output in the report.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task A — KB embed activation + staleness gate *(controller runs the embed; implementer builds the gate)*

**Context:** `knowledge/embeddings.jsonl` is from 2026-06-29 (2186 vectors) while `knowledge/chunks.jsonl` is current (2026-07-27, 5370 chunks incl. 161 `operational` cards). So the assistant's operational grounding + citation deep-links + ask→do are wired but DEAD (no embeddings). The controller runs `npm run kb:embed:inc` to embed the missing chunks (ops-run, GPU). This task adds a **staleness gate** so it can't silently recur.

**Files:**
- Modify: `scripts/ai-kb/check-kb-stale.mjs` (or the B1 autosync eval-gate `server/services/kbSyncScheduler.ts`) — add an embeddings-vs-chunks freshness check.
- Test: alongside the touched file.

**Deliverable:** a check that FAILS/warns loudly when `embeddings-meta.json.generatedAt` trails `chunks-stats.json.generatedAt` by > a threshold (env `KB_EMBED_STALE_HOURS`, default e.g. 24), usable in CI + surfaced in KB health. Fail-safe: missing files → honest "unknown", never crash.

**Tests:** stale (embeddings older) → detected/non-zero; fresh → clean; missing meta → honest unknown (no crash).
**Acceptance:** staleness reliably detected; controller's `kb:embed:inc` run produces `embeddings-meta.json` with `totalEmbedded ≈ 5370` incl. operational chunks (controller verifies live).

- [ ] Step 1: write the staleness-check test (stale/fresh/missing).
- [ ] Step 2: implement the check; run tests.
- [ ] Step 3: `npx tsc --noEmit` (touched); commit `feat(ai/w0-A): KB embeddings staleness gate (embeddings-vs-chunks freshness)`.

---

### Task B — Vision last-mile wiring (2 silent bugs)

**Context:** The vision backend auto-scores anomalies, auto-generates a VLM defect description, and auto-publishes an alert — but two wiring bugs swallow it before any screen.

**Files:**
- Modify: `server/services/aiActionInbox.ts` (~:209-216) — it dynamically imports `./aiAnomalyDetection` and calls a non-existent `latestForMachine` (real source is `aiAnomalyRouter.ts`'s `readMachineStatuses`, exposed as tRPC `aiAnomaly.latestForMachine`) → the `typeof` guard silently fails → `listAlerts` always returns `[]`. Point it at the real function so anomaly alerts actually reach the Action Inbox.
- Modify: `server/services/aoiImageEmbeddingWorker.ts` (~:340-358) — `runAnomalyAndEscalation` writes the VLM `visionDescription` only to `ai_image_embeddings.metadata.anomaly`. Repair Station's inline "Sparkles" blurb reads `measurement_results.aiAnalysisResult`. Add one best-effort UPDATE that also writes the description (+ provenance) into `measurement_results.aiAnalysisResult` for the escalated result, so the auto-generated explanation appears in the existing Repair UI with zero new UI. Fail-safe (missing row/column → log + continue, never break the worker).
- Test: `server/services/aiActionInbox.test.ts` (or new) + the worker's test.

**Deliverable:** Action Inbox returns real per-user anomaly alerts; escalation VLM description lands in `measurement_results.aiAnalysisResult` (surfaced by Repair Station automatically).

**Tests:** (1) `listAlerts` returns the anomaly alert from the real source (mock it) instead of `[]`. (2) after an escalation with a VLM description, `measurement_results.aiAnalysisResult` is updated for that result (mock db); a missing row/column → worker still completes (fail-safe). (3) the `aiAnalysisResult` write does NOT clobber a manual analysis if one already exists (decide: only write when empty, or tag provenance).
**Acceptance:** the two silent no-ops are gone; both proven by tests; worker/inbox never throw.

- [ ] Step 1: failing tests for both fixes.
- [ ] Step 2: fix the Action-Inbox source + the worker UPDATE (fail-safe); run tests.
- [ ] Step 3: tsc; commit `fix(ai/w0-B): Action-Inbox anomaly source + route escalation VLM description to measurement_results.aiAnalysisResult`.

---

### Task C — Nav/permission gate fixes + AIHome stale card (FE)

**Context:** The AI nav uses a binary `requiredRole:'admin'|'user'`, hiding surfaces the BACKEND already grants to non-admins → dead permissions. A persona model already exists (`client/src/lib/aiRole.ts`).

**Files:**
- Modify: `client/src/lib/navigation.tsx` — (1) widen `NavItem.requiredRole` from `'admin'|'user'` to a role-set/array (and update the nav-filter logic that reads it). (2) `/ai-brain` + `/ai-command-center`: gate → `['admin','engineer']` (backend is `roleProcedure("admin","engineer")`). (3) `/ai-active-learning`: backend is `protectedProcedure` — open to the appropriate roles (engineer/maintenance/quality per its use). (4) `/mask-annotation`: change `requiredRole:'admin'` → `requiredPermission:'annotation_ai'` (quality_inspector is seeded with it).
- Modify: `client/src/App.tsx` — ensure `/mask-annotation`'s `<RouteGuard>` no longer inherits an admin-only gate (align with the permission gate).
- Modify: `client/src/pages/AIHome.tsx` (~:329-350) — replace the hardcoded "Sắp ra mắt" Agent-activity card with a live summary from `trpc.aiAgentCenter.getSavingsSummary`/`getReadModel`, gated the same `isOpsRole` (admin/engineer) way. Honest empty/disabled state when not ops-role or KB_STUDIO/agents off.
- i18n: any new strings in en/vi/zh (identical keys).

**Deliverable:** engineer can discover+open `/ai-command-center` + `/ai-brain`; quality_inspector can reach `/mask-annotation`; the AIHome card shows live agent activity instead of "coming soon".

**Tests / verify:** the nav-filter unit (if present) grants the new role/permission combos; `npx tsc --noEmit` clean; `npx vite build` succeeds; i18n-parity 0 mismatches. (Controller live-verifies role visibility.)
**Acceptance:** no route the backend already allows is hidden by the nav; no regression to admin's full menu; AIHome card live.

- [ ] Step 1: widen the type + fix the 4 gate entries + App.tsx guard.
- [ ] Step 2: refresh the AIHome card (live query, isOpsRole, honest empty); i18n.
- [ ] Step 3: tsc + vite build + i18n-check; commit `feat(ai/w0-C): persona-correct AI nav gates (engineer→Agent-Ops, QC→mask-annotation, active-learning) + live AIHome agent card`.

---

### Task D — Proactive schedulers: predictive-alert + SPC-alert

**Context:** The analytical engine is strong but pull-only: `predictiveAlertRouter.generatePredictions` (`aiRouters.ts:~573`) has NO scheduler; `aiInspectionAnalytics.triggerSpcAlerts()` has ZERO callers. A real analyst pushes what matters.

**Files:**
- Create: `server/services/aiPredictiveAlertScheduler.ts` (mirror `server/services/aiBatchRcaScheduler.ts`: node-cron, own ENABLED flag e.g. `AI_PREDICTIVE_ALERT_SCHED_ENABLED`, SERVER_ROLE=api skip, best-effort never-throws, init/stop) — periodically runs the predictive-alert generation across active machines/scopes.
- Modify: `server/services/aiInspectionAnalytics.ts` (or a small caller) — wire `triggerSpcAlerts()` into a recurring pass (either inside the predictive scheduler's tick, or a small SPC-sweep) so Western-Electric/Nelson violations become advisory alerts (persist + broadcast on the existing bus that `aiAutoProposer` already listens to). Gated + fail-safe per machine.
- Modify: `server/_core/backgroundJobs.ts` — register `initAiPredictiveAlertScheduler()` next to the other AI schedulers (+ stop hook).
- Test: `server/services/aiPredictiveAlertScheduler.test.ts`.

**Deliverable:** predictive defect-spike alerts + SPC-violation alerts are produced on a schedule (advisory/HITL, gated, fail-safe), reaching the Action Inbox / auto-proposer.

**Tests:** the scheduler invokes `generatePredictions` when enabled, no-op when disabled/SERVER_ROLE=api; a per-machine throw doesn't abort the sweep; `triggerSpcAlerts` is invoked for a machine with a violation (mock) and NOT for a clean one.
**Acceptance:** proactive alerting runs on a timer, gated, safe.

- [ ] Step 1: failing tests (enabled→invokes, disabled→no-op, per-machine fail-safe).
- [ ] Step 2: implement scheduler + SPC wiring + register; run tests.
- [ ] Step 3: tsc; commit `feat(ai/w0-D): schedule predictive-alert generation + wire SPC-violation alerts (advisory, gated, fail-safe)`.

---

### Task E — Expert-signal activation: quantitative-RCA + engineer briefing

**Context:** The most process-engineer-grade RCA signal (`defectCorrelationService.correlateStationDefect`, per-serial upstream causal correlation) is gated OFF (`RCA_QUANTITATIVE_ENABLED`). And `aiTodayBriefing.briefingRoleOf()` drops `engineer` into the generic `viewer` payload.

**Files:**
- Modify: `.env` (controller — add `RCA_QUANTITATIVE_ENABLED=true` to the doc-69 activation block) + confirm `aiRcaCopilot.gatherEvidence` actually consumes `defectCorrelationService` when the flag is on (it does — verify, no code change if already wired) and that its quantitative finding is surfaced in the RCA narrative/evidence list.
- Modify: `server/services/aiTodayBriefing.ts` (`briefingRoleOf` ~:112-127 + the payload builder) — add an `engineer` branch with its own payload (open RCA proposals for machines they own, active-learning queue depth, agent tasks awaiting their approval), mirroring the existing `maintenance` branch. i18n for any new strings.
- Test: `server/services/aiTodayBriefing.test.ts` + an RCA evidence test asserting the quantitative signal appears when enabled.

**Deliverable:** quantitative causal-correlation contributes to RCA evidence when enabled; engineers get a real role-specific daily briefing.

**Tests:** `briefingRoleOf('engineer')` → engineer bucket (not viewer); the engineer payload contains the expected sections; RCA evidence includes the quantitative correlation signal when `RCA_QUANTITATIVE_ENABLED=true` (mock the correlation service) and omits it honestly when off.
**Acceptance:** engineer briefing is role-appropriate; quantitative-RCA is live behind the flag; both proven by tests.

- [ ] Step 1: failing tests (engineer briefing branch + quantitative-RCA-in-evidence).
- [ ] Step 2: add the engineer branch + confirm/surface the quantitative signal; run tests.
- [ ] Step 3: tsc; commit `feat(ai/w0-E): engineer daily-briefing branch + surface quantitative-RCA correlation (flag-gated)`.

---

## Self-Review
- **Coverage vs the approved Wave-0 design:** data-activation (Task A + controller embed run) ✓ · vision 2 bugs (Task B) ✓ · nav 3 gate fixes + AIHome card (Task C) ✓ · predictive+SPC schedulers (Task D) ✓ · quantitative-RCA + engineer briefing (Task E) ✓. The staleness-gate (A) prevents recurrence of the stale-embeddings root cause.
- **Placeholder scan:** none — each task names exact files + the specific bug/wiring + tests + acceptance; implementers do TDD.
- **Type consistency:** the `isMissingTable` cause-walker (dbErrors.ts) is the mandated fail-safe across tasks; `isOpsRole` = admin/engineer (matches aiAgentCenterRouter); role-set nav gate is introduced in C and consumed nowhere else in W0.
- **Ordering:** A/B/D/E are independent (dispatch any order); C is FE-independent; controller runs the embed (A's data half) + pushes at the checkpoint. Live-verify (nav visibility per role, assistant grounding) after C + the embed.
