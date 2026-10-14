# Đợt 12 — open items left after Đợt 11 that need no owner decision — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each group is one brief.

**Goal:** close the code items doc 81 §19 left open ("Tiếp tục các đợt còn lại và các phần còn mở", 2026-10-15). Owner-only items (edge trial setup with admin credentials, TLS key, keystore, APK, real safety PLC / S7 FAT, OT queue flag) stay with the owner.

## Global Constraints
1. All Đợt 10/11 constraints: pathspec commits only, never `git add -A`, no hook bypass, mutants on untracked copies only (never weaken a tracked file), read tsc's REAL exit code (8 GB heap), `_test` only, never `.env`, never ProgramData / `data/` / :8884 / :3000.
2. L-7: nothing slows or gates a STOP; fail closed. A lock may be cleared only through an audited, authorised, scoped path.
3. Migration (if needed): **0378**, 0372–0377 pattern, `--test-only`, fresh-apply rehearsal.
4. i18n vi/en/zh per R-5-c; censuses are instruments.
5. Commit messages: no diacritics, "(doc 81 dot 12 task X)" + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Groups
- **N — sim robot motion lock + clearing a lock on a robot returned from an edge.** `SimRobotDriver` gets a real motion-lock controller (the dot10 harness patches one in — make it product code). Central: a robot whose driver has no motion-lock controller but whose DB row carries a lock (e.g. `ownerChanged` after release from an edge) must be clearable through the audited `robot.clearMotionLock` path (scope, permission, reason, generation) — today it answers `motionLockUnsupported` and the robot stays locked forever. Never clear without an operator action.
- **O — retire an edge node.** `scripts/edge-node-credential.ts retire-node --node … --actor … --reason …` (+ tRPC admin-only): proven admin, refuses while the node owns any device or has an unacked STOP/lock request, revokes every credential, marks the node retired (WORM evidence stays; no delete), audited. If a status value/column is missing, migration 0378.
- **P — cross-replica STOP epoch.** The per-adapter stop epoch (R-11-d) is per process. Broadcast verified-STOP epoch bumps across central replicas (pg NOTIFY on a dedicated channel, or reuse `device_owner_changed` infra), so a non-STOP write in another replica issued before the STOP is cancelled too; bounded, best effort, never delays the STOP itself; document the remaining window (NOTIFY latency).

## Task Z
Per-group review → whole-branch review → one fix wave → re-review; doc 81 §20 + doc 80 §26; ask owner: merge/push (+ the two unmerged Đợt 11 commits 764fcd1df, 8b08e5867), mig 0378 on dev if any, build + restart.
