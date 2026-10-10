# Đợt 6 — aborting a run still sends its STOP steps — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. A single task.

**Goal:** owner decision of 2026-10-11 ("Huỷ vẫn chạy bước DỪNG"). Today `abortRun` cancels the run's remaining STOP steps and its STOP compensations, so aborting "start → wait → stop" halfway leaves the equipment running. After this change, abort skips every non-STOP step and still SENDS the remaining STOP steps and the STOP compensations that are due.

**Spec:**
- the owner decision above;
- doc 81 §14;
- the Đợt 5 re-review finding: `foeEngine.ts` `abortRun` (around :2525-2590) sets a flag, fires the abort signal and cancels later STOP steps (around :753, :840) and STOP compensations (around :826).

## Global Constraints
1. Same as Đợt 5: `.superpowers/sdd/2026-10-10-engineering-control-dot5/global-constraints.md` and every R-* ruling.
   - commit by pathspec; no push or build; no `.env`; `_test` only;
   - no hook bypass;
   - mutants only on untracked copies.
2. **L-7:** this change can only ADD STOPs; it never delays or blocks one.
3. **Which steps count as STOP:** only REAL STOPs, using the shared classifier from Đợt 5 (OT pinned stop, robot stop job). Never classify by command name (R-5-j).
4. **No new actuation:** abort never sends a non-STOP step or a non-STOP compensation (R-2-n).

## Task 1: abort runs the remaining STOP steps
- On abort:
  - mark the run "aborting" and skip all pending non-STOP steps, including those inside sequences, parallels and branches;
  - send each remaining real STOP step;
  - then send the STOP compensations that are due: those of steps that completed or were running, in reverse order, the usual compensation order;
  - each send is bounded by the existing STOP deadlines and audited (`abortStopSent` / `abortStopFailed`);
  - end in the terminal "aborted" state.
- **A STOP step already running:** let it finish (it is never cancelled).
- **A non-STOP step running at abort time:** cancel it as today.
- **Branches whose condition was never evaluated:**
  - send STOP steps of branches already taken;
  - for untaken branches, do NOT guess; list them in the audit as `abortStopSkippedUntakenBranch`.
- **Gates:** a STOP step behind an unpassed hitl_gate is still sent on abort, because STOPs never need a gate (QĐ-4a exempts STOP).
- **Scope:**
  - abort keeps its R-5-l scope check;
  - the STOPs it sends use the existing dispatcher path with the run's identity, so the dispatcher's own checks (pinned stop, R-4-x) still apply.
- **UI:**
  - the abort confirmation in Orchestration Studio says the remaining STOP steps will still be sent (i18n vi/en/zh);
  - the run timeline shows them.
- **Tests:** RED → GREEN → mutation, all on `_test`:
  - "start → delay → stop" aborted during the delay ⇒ the stop is sent and the run ends "aborted";
  - an unpinned "stop" step is NOT sent (it is not a real STOP);
  - a nested STOP inside a sequence/parallel is sent;
  - a STOP compensation of a completed step is sent; a non-STOP compensation is not;
  - with a hung DB, the abort still completes within the documented bound;
  - abort of an API-started run still sends its STOPs.

## Task Z
- Run a task review, then a re-review.
- Add a short paragraph to doc 81 §14.
- Ask the owner about merge, push and the restart. Combine with the pending restart if possible.
