# Đợt 9 — close the remaining open items (owner: "hoàn tất các phần đang mở") — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each group is one brief.

**Goal:** close every item still open in doc 81 §16, per the owner decisions of 2026-10-12.

**Spec:**
- doc 81 §14–§16 "Còn mở";
- the Đợt 5–8 reports under `.superpowers/sdd/2026-10-1*-engineering-control-dot*/`;
- the owner decisions below.

## Owner decisions (2026-10-12)
- **API-key holder identity — do option A** (this replaces option C as the final design).
  - A key records who it is "issued to".
  - A run records which key started it.
  - An approver must differ from the holder, the creator and the starter.
  - API-started runs may actuate only after that two-person gate. STOPs are always allowed.
- **Edge workflow execution — do it fully:**
  - an authenticated per-node pull endpoint;
  - a per-node edge key;
  - ID sync between central and edge;
  - a real abort that reaches the edge.
- **Real controller checksum — Siemens S7, built from the protocol documentation.**
  - Read the block checksum via SZL / block info.
  - Test against a protocol simulator we write ourselves.
  - Mark the result "not verified on a real device" until FAT.
- **Short e-stop presses:**
  - OPC-UA safety-PLC configs use subscriptions with a queue, so short pulses are captured.
  - Modbus configs support a PLC-side latch bit, with guidance for the latch program.
- **Multi-instance replay of trusted events:** close it (bind trust to durable rows, never to instance memory).
- **Owner actions, not in this đợt:** provision the TLS key, rotate the keystore password, test APK 1.0.18 on a real tablet. Claude prepares the exact steps.

## Global Constraints
1. Same as Đợt 8. All of the following still apply:
   - `.superpowers/sdd/2026-10-11-engineering-control-dot8/global-constraints.md` and every R-* ruling;
   - commit by pathspec only, never `git add -A`;
   - no hook bypass;
   - mutation runners only on untracked copies, and they must refuse to touch tracked files;
   - read tsc's REAL exit code;
   - `_test` only, never `.env`.
2. **L-7:**
   - nothing slows or gates a STOP;
   - security checks fail closed;
   - every exemption says what happens when the system can't decide.
3. **:3000 is running production:**
   - never stop, restart or bind it;
   - never touch ProgramData, `data/` or `:8884`.
4. **Migrations:**
   - Group R: **0369**;
   - Group S: **0370**;
   - Group U: **0371** (if needed).

   Each follows the 0363 pattern and is applied with `--test-only`.
5. i18n in vi/en/zh, following R-5-c. Censuses are instruments.
6. Commit messages end with "(doc 81 dot 9 task X)" and the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Group R — API-key holder identity (option A)
- **R1, migration 0369:**
  - `api_keys.holderUserId`: who the key is issued to; defaults to the creator; editable only by an admin, and every change is audited;
  - `orchestration_runs.startedViaApiKeyId`.
- **R2: the approval rule.** For an API-started run, an approval counts only if the approver ∉ {starter, key holder, key creator}.
  - The engine and both dispatchers re-derive this set from the DB (R-4-i style). It is never taken from the action.
  - The E1 rule "API runs never actuate" is replaced: an API run may actuate once the gate is satisfied under this rule.
  - A key with no holder ⇒ `ownerUnknown`, refused, as today.
- **R3:**
  - the API keys UI shows "Issued to";
  - the Studio approval screen shows "started via API key X, issued to Y" and explains why some users can't approve;
  - i18n.
- **R4: tests.**
  - The holder, the creator and the starter each fail to approve.
  - A different user succeeds.
  - STOP is unaffected.
  - Edge and retry paths are covered.
  - Mutate each check.

## Group S — edge workflow execution (after R)
- **S1, migration 0370:**
  - a per-node edge credential (hashed) with rotation and revoke;
  - `orchestration_runs` gets an edge assignment, with an ID mapping so the edge uses the central run and workflow IDs.
- **S2: central endpoints, authenticated by the node credential and scoped to that node:**
  - pull assigned runs (with the definition snapshot and the binding digest);
  - push progress and step results;
  - receive abort/reject signals.
- **S3: the edge gateway (`server/edge/edgeGatewayMain.ts` + `edgeRuntime`):**
  - pulls work;
  - executes steps through the edge's local dispatchers, with the same gates (approval, binding digest, checksum where supported, R-4-x, STOP exemptions);
  - syncs progress;
  - honours a central abort: stops non-STOP steps, still sends STOPs, never resurrects a run.
  - **Offline behaviour:**
    - no new runs are started while offline;
    - a run already running continues only through STOP and compensation steps after the abort signal arrives;
    - every limitation is documented.
- **S4: end-to-end tests.** One process plays central, another plays edge, over HTTP on port 0, against `_test`:
  - assign → pull → run → complete;
  - abort mid-run;
  - credential revoked;
  - an out-of-scope node;
  - replayed progress.
- **S5: operator docs:** how to provision a node credential and run the gateway.

## Group T — Siemens S7 program checksum
- **T1:** implement `readProgramChecksum()` for the S7 adapter by reading block info (checksum per OB/FB/FC/DB) through the documented S7comm functions.
  - Combine the per-block checksums into one deterministic program checksum.
  - Bound every read with a deadline.
  - An unreadable result ⇒ refuse (fail closed), as in Đợt 8 O.
- **T2:** an in-process S7comm protocol simulator in tests, written by us from the protocol documentation, on port 0.
  - Change a block ⇒ the checksum changes ⇒ the approval goes stale.
  - The results screen marks S7 as "checksum per protocol documentation — not yet verified on a real device".
- **T3:** cite the documentation used in the code and the report.

## Group U — short e-stop capture and multi-instance trust
- **U1:** OPC-UA safety-PLC configs use a subscription with monitored items (queue size > 1, discardOldest false) instead of polling.
  - Every queued value change becomes a transition: a press and release within one interval yields both events.
  - Fall back to polling, with a visible "polling (short presses may be missed)" state, if subscriptions fail.
  - Health and durability rules from Đợt 8 still apply.
- **U2:** Modbus configs gain an optional latch tag.
  - The poller reads the latch and, when set, records the press.
  - Clearing the latch is a PLC-side or operator action. The server NEVER writes it, because the poller stays read-only.
  - Document a sample PLC latch program (ladder/ST snippet) in the guide.
  - The config approval digest covers the latch tag.
- **U3, multi-instance replay:** trusted-event identity is bound to durable rows (event row id + digest) and consumed exactly once in the DB. A replay from another instance or from Redis can't reuse it. Add tests.

## Task Z
- A task review per group.
- A whole-branch review, then one final fix wave, then a re-review.
- Write doc 81 §17 and a doc 80 pointer.
- Ask the owner about merge/push, dev migrations 0369–0371, and build + restart.
- Hand over the owner-action steps: TLS key provisioning, keystore password rotation, APK device test.
