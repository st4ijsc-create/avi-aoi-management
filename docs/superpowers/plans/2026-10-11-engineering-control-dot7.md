# Đợt 7 — the open items left after Đợt 6 — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each group is one brief. Read the doc 81 §14 "Còn mở" lines and the Đợt 5/6 reports named in your brief before coding.

**Goal:** close the items still open after Đợt 6 that need no hardware, following the owner's decisions of 2026-10-11.

**Spec:**
- doc 81 §14 "Còn mở", including the Đợt 6 paragraph;
- the Đợt 5 final reviews: `.superpowers/sdd/2026-10-10-engineering-control-dot5/final-review-report.md` and `re-review-final-wave-report.md`;
- the Đợt 6 reviews: `.superpowers/sdd/2026-10-11-engineering-control-dot6/re-review2-report.md`;
- the owner decisions below.

## Owner decisions (2026-10-11)
- **Tablet ↔ built-in broker connection:**
  - Add TLS in this đợt: a site self-signed certificate, and an app that pins the certificate fingerprint (app 1.0.18).
  - The plain port stays open until migration is done.
- **APK:** Claude builds the APK (debug, or release if a signing key exists in the repo) and runs it on an emulator if one is available. The owner tests it on a real tablet.
- **Machine API keys:**
  - NEW machine keys no longer get `edge:sync` by default.
  - Claude lists the test/QA machine keys on dev read-only and reports the list.
  - After the owner approves the list, those keys are REVOKED, never hard-deleted.
- **VDA5050/ROS2 automation self-grant:**
  - Keep the current bound, single-use, TTL-limited and audited grant.
  - Document the policy in doc 81.
  - Add a per-robot switch that turns automation off.
- **Still open, not in this đợt:**
  - the background safety-PLC poller (until a real safety PLC is on the bench);
  - checksums of programs stored inside robot/PLC controllers (needs hardware);
  - API-key holder identity, option A (until an integration needs actuating API runs);
  - replay of trusted events across multiple instances (only relevant for multi-instance deployments);
  - item 18: sheets not kept in the URL (deferred).

## Global Constraints
1. Same as Đợt 5/6:
   - commit by pathspec, never bypass a hook (R-5-c);
   - mutants only on untracked copies;
   - read tsc's REAL exit code;
   - use `_test` only; dev is read-only, except key revocation after owner approval;
   - never edit `.env`;
   - no push, and no build of `dist` until Task Z.
2. **L-7:**
   - nothing slows or gates a STOP;
   - security checks fail closed;
   - every exemption names what happens when the system cannot decide (lesson from Đợt 6).
3. i18n in vi/en/zh. Census tests are measuring instruments.
4. The :3000 server is RUNNING (started 2026-10-11). Never stop it, restart it, or bind to its port. Measurement instances use their own ports and `aoi_management_test`.
5. Commit messages end with "(doc 81 dot 7 task X)" plus the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Group I — orchestration leftovers
- **I1:** a central abort or reject also stops the walker of a run executing on an edge node.
  - Propagate through edge sync.
  - The edge stops non-STOP steps; it never stops STOPs.
  - A central 'aborted' state is never overwritten by an edge sync.
- **I2:** the approver's screen is bound to the binding digest (an `expectedBindingDigest` like `expectedDefHash`). A mismatch ⇒ "configuration changed, reload".
- **I3:** factory-related leaks:
  - the `orchestration.run.finished` webhook goes only to subscribers whose scope contains the run's factory;
  - workflow-ref probing via duplicate/deploy gives answers identical to the nonexistent case;
  - run visibility follows the version the run actually executed.
- **I4:** minor oracles and census gaps:
  - timing parity for the Đợt 5 M-1/M-2 and P-H1 leftovers;
  - the `registerDriver` census catches renamed imports and functions passed as values.
- **I5:** a per-robot "automation off" switch.
  - When off, the VDA5050/ROS2 automation grant is refused (STOP is unaffected).
  - Audited, with i18n.
  - Document the automation policy in doc 81.
- **I6:** Đợt 6 leftovers. A reject with a QT hook whose reply is lost finishes its own sweep, still without double compensation.

## Group J — tablet TLS and APK
- **J1:** the built-in broker gets a real TLS listener (MQTT over TLS, and WSS if the app uses WebSocket).
  - A site self-signed certificate is generated on first start, stored outside git, and its fingerprint shown in the admin UI.
  - The plain listener is kept behind the existing flag until migration is done.
  - The rollout note is updated.
- **J2:** app 1.0.18 connects with TLS and pins the certificate fingerprint. The fingerprint is entered or scanned by the technician next to the password, and the password is still pinned to its endpoint (R-5-a).
  - The password is never sent over plain TCP once a fingerprint is set.
  - A fingerprint mismatch ⇒ refuse and show "certificate changed".
- **J3:** build the APK.
  - Use release if a signing config exists in the repo; otherwise build debug and say so.
  - Run the JVM checks and app tests, and run on an emulator if one is available (report what ran).
  - The APK goes to a gitignored output folder. Report its path, size and SHA-256.

## Group K — keys and platform
- **K1:** new machine API keys no longer get `edge:sync` by default. Existing keys are unchanged by code.
- **K2:** produce a READ-ONLY list of the dev machine keys that belong to test/QA machines (FUYU-F, QATD-*, T12-*, seed/e2e machines), with machine code, key id, created date and last used.
  - Also produce a revoke script that runs in ONE transaction and sets keys inactive or revoked (never DELETE). It refuses to run without an explicit list file.
  - Do NOT run it on dev. The controller asks the owner.
- **K3:** the plugin driver handshake gets a generation number, the same as the late-disconnect fix (Đợt 5 F2), with a contract test.
- **K4:** find out why `SELECT refresh_qw_caches()` fails at startup on dev.
  - Check the logs and code; dev is read-only.
  - If a migration is needed: write it, apply it to `_test` only, and prove it.
  - Otherwise fix it in code.
- **K5:** fix the base red of `dataErrorStringCensus` at `server/services/machineDataContract.ts:189` the sanctioned way.

## Group L — browser checks (Playwright on `_test`, own ports)
- **L1:** the OTP dialog over the deploy wizard. Go to the OTP step and cancel; check layering and focus.
- **L2:** flyout history: F5 and Back on 3 pages that use FlyoutHost.
- **L3:** a Copilot stream while the window is resized across 1024 px, on IDE, IR and POU.
- **L4:** phone widths (390 px and 412 px) on the 14 engineering screens. Check what is reachable and that critical chips stay visible.
- **Output:**
  - Write the findings as a report with screenshots kept in scratch.
  - Fix small defects found, as one commit per defect with a test.
  - Report larger ones.

## Task Z
- A task review per group, then a whole-branch review, one final fix wave and a re-review.
- doc 81 §15 plus a doc 80 pointer.
- Ask the owner about merge and push, and about revoking the K2 keys.
- After the merge: build and restart :3000 (stop the running instance cleanly first), then verify.
