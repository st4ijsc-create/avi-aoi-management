# Đợt 11 — remaining open items after Đợt 10 — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each group is one brief.

**Goal:** the owner's 2026-10-14 decisions on what doc 81 §18 left open ("Tiếp tục phần còn lại và các phần đang mở").

**Spec:** doc 81 §18 "Còn mở"; `.superpowers/sdd/2026-10-12-engineering-control-dot10/progress.md` (parked items); the decisions below.

## Owner decisions (2026-10-14)
- WORM tables of Đợt 10: **keep forever, alert on size only** (no deletion path).
- Edge: **prepare and trial ONE sim node on this machine** against dev (SIM-FAC, sim devices), report, then turn execution off again; real nodes stay off.
- `OT_CMD_SERIALIZE_ENABLED`: **measure on `_test` with the flag on**, then propose (owner decides before dev).
- Cleanup: the 6 pre-existing red censuses; pin the remaining 6 INVOKER functions + one lock order for STOP ack ↔ owner change; run `lechGioTruyVanTho.db.test.ts`; bench the safety-PLC poller against a local OpenPLC if available.

## Global Constraints
1. All Đợt 10 constraints: pathspec commits only, never `git add -A`, no hook bypass, mutants on untracked copies only (never weaken a tracked file), read tsc's REAL exit code (8 GB heap), `_test` only, never `.env`, never ProgramData / `data/` / :8884.
2. :3000 runs production build 52c2c1485 — never stop/restart/bind it (the controller does the edge trial restart).
3. L-7: nothing slows or gates a STOP; fail closed.
4. Migration **0377** (Group H) follows the 0372–0376 pattern (`--test-only`; pins, grants, behaviour probe rolled back, ledger row); must pass the R-10-e pin census and the fresh-apply rehearsal style check.
5. i18n vi/en/zh per R-5-c; censuses are instruments — fix code, re-pin only by the census's own procedure with a dated note.
6. Commit messages: no diacritics, end "(doc 81 dot 11 task X)" + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Groups
- **G — WORM size alert:** a periodic check of the Đợt 10 WORM tables (and other append-only safety ledgers) size/row count vs configurable thresholds ⇒ durable alert (existing alert path), admin UI line in system health; no deletion anywhere.
- **H — DB hardening (mig 0377):** pin the 6 INVOKER functions listed as backlog in Đợt 10 Group A fix round 3 (catalog inventory on `_test`), same bodies; one lock order (device row → request row, or the reverse — pick the one all writers can follow) for `edge_stop_ack_edge` / `edge_stop_ack_central` vs the owner-change trigger, with a two-session deadlock test.
- **I — red censuses + timestamp test:** the 6 pre-existing reds (client raw-message twin3d/AOIPackages, twinCanh i18n keys, appErrorCoverage, aiLocalKbStreamEvents, kpiCongThucCensus, fakeUtcCensus): fix code the sanctioned way; run `server/db/lechGioTruyVanTho.db.test.ts` and fix what it finds.
- **K — OT serialize measurement:** run the OT/dispatcher suites and a load measurement with `OT_CMD_SERIALIZE_ENABLED=true` on `_test` + an own port; report latency, STOP bound, failures, recommendation. No dev change.
- **L — safety-PLC poller bench:** find a local OpenPLC (Docker or install already present — do NOT install software without asking); if present, bench the poller (read-only) incl. e-stop press/release, offline, short press; report. If absent, say so with the exact steps for the owner.
- **M — edge sim node trial (controller-led):** signing key, register node SIM-FAC, credential bundle, ownership of one sim robot + one sim adapter, gateway on this machine without DB, one sim workflow end-to-end with central `EDGE_EXECUTION_ENABLED=true` set for that process only (no `.env` edit); then unassign, revoke, restart central without the flag. Admin password/2FA typed by the owner.

## Task Z
Per-group review; whole-branch review → one fix wave → re-review; doc 81 §19 + doc 80 §25; ask owner: merge/push, mig 0377 on dev, OT serialize on dev.
