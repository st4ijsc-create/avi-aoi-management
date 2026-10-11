# Đợt 8 — remaining open items after Đợt 7 — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each group is one brief.

**Goal:** the owner's 2026-10-11 decisions on the items left open in doc 81 §15.

**Spec:**
- doc 81 §15 "Còn mở";
- the Đợt 5–7 reports under `.superpowers/sdd/2026-10-1*-engineering-control-dot*/`;
- the owner decisions below.

## Owner decisions (2026-10-11)
- **Background safety-PLC poller: build it now with the simulation backend.**
  - It only ever reads; it never actuates.
  - It is behind a feature flag that is OFF by default.
  - It produces trusted safety events (R-5-h).
- **API-key holder identity:** stay on option C (API-started runs never actuate). Not in this đợt.
- **IDE/IR/POU sheets:** move them to FlyoutHost now, so Back, F5, deep links and the "discard changes?" prompt work.
- **Controller program checksum:** build the framework now, starting with OpenPLC and the simulation.
  - When an adapter supports it, the approval binding digest includes the checksum.
  - When it does not, the approval screen says plainly that the program can't be verified.
- **Still open, not in this đợt:**
  - API-key holder identity (option A);
  - replay of trusted events across multiple instances;
  - owner tasks: provisioning the TLS key, rotating the keystore password, testing APK 1.0.18 on a real device.

## Global Constraints
1. Same as Đợt 7: `.superpowers/sdd/2026-10-11-engineering-control-dot7/global-constraints.md` and every R-* ruling.
   - Commit by pathspec.
   - No hook bypass.
   - Mutants only on untracked copies.
   - Read tsc's REAL exit code.
   - Use `_test` only.
   - Never touch `.env`.
2. **L-7:**
   - Nothing slows or gates a STOP.
   - Security checks fail closed.
   - Every exemption states what happens when the system can't decide.
3. **The :3000 server is running production.** Never stop it, restart it or bind to it. Never touch ProgramData, the repo's `data/` folder, or port 8884.
4. **Migrations, if needed:** 0368 and up, following the 0363 pattern, applied with `--test-only`.
5. **i18n:** vi/en/zh, per R-5-c. Censuses are instruments.
6. **Commit message:** "(doc 81 dot 8 task X)" plus the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Group N — background safety-PLC poller
- **N1:** a server-side poller reads every enabled `safety_plc_configs` row periodically, through the existing READ-ONLY safety-PLC adapter.
  - Flag `SAFETY_PLC_POLLER_ENABLED`, default false.
  - Interval per config, bounded to at least 250 ms.
  - Per-config backoff on errors.
  - It never writes to and never actuates the PLC.
- **N2:** state transitions produce safety events through the device-ingest path:
  - e-stop pressed / released;
  - guard or light curtain tripped;
  - PLC offline / back online.

  Each event carries the server-set trusted marker (R-5-h), so a real trip overrides notification opt-outs, subject to the per-robot/type cap (P-F4) and the throttle (downgrade only, never drop). A user can never set the trusted marker through any input path.
- **N3:**
  - Edge-triggered with dedup: no event per poll while the state is stable.
  - Bounded memory.
  - The poller stops and restarts cleanly.
  - Undecidable reads (timeout, parse error) produce "PLC unknown/offline" events. They never produce a false "released" or "ok".
- **N4:** tests against the sim backend and an in-process Modbus/OPC-UA server on port 0. Show that real trip events take the trusted bypass and that user-recorded events don't.

## Group O — controller program checksum
- **O1:** an adapter capability `readProgramChecksum()`, returning `{supported, checksum?, source}`.
  - Implement it for OpenPLC (find what the runtime exposes) and for the simulation driver.
  - Every other adapter returns `supported:false`.
- **O2:** the approval binding digest (Đợt 5 E3) includes the checksum of every adapter a run's steps write to, when that adapter supports it.
  - A changed checksum after approval ⇒ `staleApproval`, in the engine and in both dispatchers.
  - An unreadable checksum on an adapter that supports it ⇒ refuse (fail closed).
  - Unsupported ⇒ recorded as "not verifiable".
- **O3:** the approval screen lists, per adapter, "program verified (checksum …)" or "program cannot be verified on this controller", in vi/en/zh.
- **O4:** tests with the sim driver: change the program after approval ⇒ stale; unsupported adapter ⇒ shown and allowed; a read failure on a supported adapter ⇒ refused.

## Group P — IDE/IR/POU sheets onto FlyoutHost
- **P1:** move the 5 sheets on IDE/IR/POU to `FlyoutHost`, the same pattern as the other screens:
  - URL sync;
  - Back/F5/deep links;
  - the dirty "discard changes?" prompt;
  - focus return.
- **P2:**
  - Existing behaviour and safety flows are unchanged (deploy preview before OTP, R-7-c OTP truthfulness, Copilot).
  - Re-measure IDE/IR/POU with the layout instrument at 1600/1366/1024 and 390, on your own ports and `_test`.

## Group Q — leftovers
- **Q1:** wire the edge half of the central abort into the production edge path (`server/edge/edgeGatewayMain.ts` / the edge runtime), so `setCentralSync` and `executeAssignedRun` have a real caller. If the edge gateway has no run execution in production, say so and keep it latent.
- **Q2:** `provision-mqtt-tls.ps1 -Repair`: lock the folder first, then re-check its children, so there is no junction-swap window.
- **Q3:** `qtRunner.ts`: when the template-row lookup fails, compensations are NOT silently skipped; fail closed with a truthful note.
- **Q4:** the red tests inside engineering scope: qtRunner fix #6, orchestrationDot0 ORC-06, plugins/manifest (expects 5 seeds, finds 6).
  - Find the cause.
  - Fix the code if it is wrong. If the test is out of date, re-pin it per its own procedure with a dated note.

## Task Z
- A task review per group.
- A whole-branch review.
- One final fix wave, then a re-review.
- doc 81 §16 plus a pointer in doc 80.
- Ask the owner about merge and push, any dev migration, and the build and restart.
