# Đợt 1E — Pinned OT STOP jumps a full queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `OT_CMD_SERIALIZE_ENABLED` is on and an adapter's command queue is full, a correctly pinned OT STOP (`pinnedStop: true` from Đợt 1D) is never rejected `BUSY`. It runs right after the write currently in flight, and every command still waiting in that adapter's queue is cancelled, so nothing queued before the STOP can restart the machine after it.

**Architecture:**
- Replace the tail-promise chain in `tryEnqueueAdapterCommand` (`server/services/ot/commandDispatcher.ts:383-415`) with an explicit per-adapter queue: one in-flight job plus an array of pending jobs, each with a settle callback.
- A pinned STOP takes an `enqueueStop` path. It cancels all pending (not in-flight) jobs, which resolve as rejected with reason `SUPERSEDED_BY_STOP` and are written to the ledger like BUSY. The STOP is placed first, and the depth limit never applies to it.
- The in-flight write is never interrupted; a STOP cannot preempt bytes already on the wire.
- With the flag off (the default), behaviour is byte-identical: no queue.

**Tech Stack:** TypeScript, vitest (unit tests with a fake driver; a DB test on `_test` for the ledger rows).

**Spec:** owner decision 2026-10-02: "DỪNG ghim chen hàng đợi: Có". This follows the energy-direction rule (L-7). Cancelling commands queued before a STOP mirrors the robot abort fence of Đợt 1B ("không byte chuyển động sau STOP"). Ruling R-1E-a below records that choice.

## Global Constraints
1. These are identical to Đợt 1D's `.superpowers/sdd/2026-09-28-engineering-control-dot1d/global-constraints.md` items 1–18, minus the migration permission: **no migration**.
2. Only `pinnedStop === true` gets the priority. Any other command, including an unpinned "stop", keeps today's queue semantics exactly: FIFO, BUSY at `OT_CMD_QUEUE_MAX`.
3. A cancelled job never reaches `driver.writeTags`. Its ledger RESULT row has status `rejected`, reason `SUPERSEDED_BY_STOP`, and names the STOP's command id (in `ackExtra` or the reason text). A user-visible reason string goes through the existing appError/i18n path (vi/en/zh), with no env-var names.
4. Commit messages end with `(doc 81 dot 1E task 1)` and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus
1. **Two STOPs arrive back to back:** the second must not cancel the first. A pending pinned STOP is never cancelled; consecutive STOPs run in arrival order.
2. **A STOP arrives while the queue is empty:** it runs at once, exactly as before.
3. **Queue map cleanup:** the adapter entry is still deleted when the queue drains. No leaks, and no stuck in-flight flag after a driver throw or timeout.
4. **A cancelled job's caller** gets a resolved `{ ok:false, status:"rejected", reason:"SUPERSEDED_BY_STOP" }`. It must not hang or throw.
5. **Flag off:** `executeWriteAndVerify` runs immediately; no queue object is created.

---

### Task 1: Priority STOP in the per-adapter queue

**Files:**
- Modify: `server/services/ot/commandDispatcher.ts:345-415` (the queue) and `:1244-1267` (the call site)
- Test: create `server/services/ot/commandQueueStop.dot1e.test.ts` (pure queue tests). Extend `server/services/ot/pinnedStop.dot1d.db.test.ts` with one end-to-end case (`OT_CMD_SERIALIZE_ENABLED=true`, `OT_CMD_QUEUE_MAX=1`).

**Interfaces:**
- Produces:
  - `tryEnqueueAdapterCommand<T>(adapterId, fn, opts?: { priorityStop?: boolean }): EnqueueOutcome<T>`, where `EnqueueOutcome<T>` gains the variant `{ accepted: true; result: Promise<T | Superseded> }`.
  - `type Superseded = { superseded: true; byStop: true }`.
  - `_resetAdapterCommandQueuesForTests()` keeps working.
- At the call site, a job's result of `Superseded` means: write the ledger rejection `SUPERSEDED_BY_STOP` and return `{ ok:false, simulated:false, status:"rejected", reason:"SUPERSEDED_BY_STOP", results: failedResults(input,"SUPERSEDED_BY_STOP"), commandLogIds }`.

- [ ] **Step 1: Write the failing pure tests** in `commandQueueStop.dot1e.test.ts`, using a controllable fake job (a deferred promise per job and a call log). Cases:
  - (a) max=2: in-flight A, pending B; enqueue a non-priority C ⇒ `accepted:false` (BUSY), unchanged.
  - (b) max=2: in-flight A, pending B; enqueue priority S ⇒ accepted. B resolves `Superseded` and never runs. After A settles, S runs. The call log is exactly `[A, S]`.
  - (c) an empty queue plus priority S ⇒ S runs immediately.
  - (d) in-flight A, pending S1 (priority), then S2 (priority) ⇒ neither cancels the other. The log is `[A, S1, S2]`.
  - (e) A throws ⇒ S still runs, and the map entry is deleted after S settles (assert via an exported test-only size getter, or by enqueueing again with a fresh depth).
  - (f) non-priority after S: in-flight A, pending S, then enqueue D ⇒ D is queued behind S (FIFO) and is not cancelled by S, because only commands queued before the STOP are cancelled. The log is `[A, S, D]`.
- [ ] **Step 2:** Run `npx vitest run server/services/ot/commandQueueStop.dot1e.test.ts`. Expected: FAIL, because `priorityStop` doesn't exist and (b) gets BUSY.
- [ ] **Step 3: Implement** the explicit queue: `{ inFlight: boolean; pending: Array<{ run: () => void; cancel: () => void; priorityStop: boolean }>; depth: number }`.
  - Depth counts the in-flight job plus the pending ones.
  - The BUSY check applies only when `!priorityStop`.
  - A priority enqueue cancels every pending job that is not `priorityStop`, then inserts itself after the last pending `priorityStop` job (or at the front).
  - The pump runs the next pending job when the in-flight one settles, whether it fulfils or rejects.
  - The map entry is deleted when there is nothing in flight and nothing pending.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Wire the call site** (`:1250-1264`): pass `{ priorityStop: stopCls.pinnedStop === true }`. Handle `Superseded` as in Interfaces. Add `SUPERSEDED_BY_STOP` to the dispatch reason union/type, and to the client i18n reason map if OT dispatch reasons are translated there (grep `"BUSY"` under `client/src` and `shared/`).
- [ ] **Step 6: DB e2e test** in `pinnedStop.dot1d.db.test.ts`, with `OT_CMD_SERIALIZE_ENABLED=true`, `OT_CMD_QUEUE_MAX=1`, and a fake driver whose first write is held open:
  - dispatch a normal write W1 (in flight);
  - dispatch a normal W2 ⇒ BUSY, unchanged;
  - with `OT_CMD_QUEUE_MAX=2`, dispatch W2 (pending), then a pinned STOP ⇒ W2 gets `SUPERSEDED_BY_STOP` with a ledger row, the driver never receives W2's value, and the STOP's pin value is written right after W1 is released;
  - an unpinned `stop` in the same setup ⇒ BUSY or FIFO as before.
- [ ] **Step 7: Mutations**, each must turn a test red:
  - (m1) the BUSY check also applies to priority ⇒ (b) red;
  - (m2) don't cancel pending ⇒ (b) red, because B runs;
  - (m3) cancel pending priority STOPs too ⇒ (d) red;
  - (m4) cancel jobs enqueued after S ⇒ (f) red;
  - (m5) don't pump after a throw ⇒ (e) red.
- [ ] **Step 8:** Sweep: `server/services/ot` (all tests), the four censuses, `tsc --noEmit`. No new reds.
- [ ] **Step 9: Commit** by pathspec.

## Ruling R-1E-a (recorded by the controller)
A pinned STOP cancels every non-STOP command still WAITING (not in flight) in that adapter's queue, because executing them after a STOP could re-energise the machine. Commands enqueued AFTER the STOP are kept (FIFO), because they are new operator intent. Cost if wrong: an operator's queued parameter write is dropped and must be resent; its ledger row says why.
