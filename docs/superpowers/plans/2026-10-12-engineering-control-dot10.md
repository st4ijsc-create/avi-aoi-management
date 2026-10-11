# Đợt 10 — Edge gateway without a central DB login — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The full design, with file:line references, lives in `.superpowers/sdd/2026-10-12-engineering-control-dot10/design.md`. **Read your group's section there before you code.** This plan is the binding summary.

**Goal:**
- The edge host holds no `DATABASE_URL` and no central secret (`SECRET_ENCRYPTION_KEY` / `JWT_SECRET`).
- Central is the only writer of run state, approvals, safety events, ledgers and audit.
- The edge drives only its own devices, and only under a fresh, single-use authorisation signed by central.
- STOP is never gated (L-7).

**Spec:**
- The owner's decision of 2026-10-12: "Đợt 10: bỏ DB login khỏi edge".
- The design document named above.
- doc 81 §17.

## Owner decisions
See the D1–D14 table in the design. The recommended options apply unless the ledger records otherwise.

## Global Constraints
1. All Đợt 9 constraints still apply:
   - commit by pathspec only; never `git add -A`; never bypass a hook;
   - the mutation runner works on untracked copies only;
   - read tsc's REAL exit code;
   - test against `_test` only; never touch `.env`;
   - never touch :3000, :8884, ProgramData or `data/`.
2. **L-7.** Robot abort and pinned OT stops are sent without authorisation or central, even with a full journal or an unknown keyset. Nothing slows a STOP beyond the existing bounds.
3. **Fail-closed.** If authorisation, signature, nonce, TTL, jti, ownership or scope can't be confirmed, nothing is actuated.
4. **The central path stays unchanged.** Engine and dispatcher refactors are extract/port only, and every existing test suite must stay green without edits.
5. **Migrations 0372–0375.** They follow the 0363–0371 pattern and use narrow projections only. Apply them with `--test-only`.
6. **Shared files.** Only the controller commits these, in one integration commit:
   - `openapi.ts`
   - the census tests
   - the locale files
   - `OrchestrationStudio.tsx`
   - `server/_core/index.ts`

   Groups leave their hunks in these files uncommitted and list them in their report.
7. Commit messages end with "(doc 81 dot 10 task X)" plus the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Groups

Ownership is exclusive; see design §4.

| Group | Scope | Notes |
|---|---|---|
| **A** | Contract, signing, migrations, DB trap | Lands first, as a contract commit |
| **B** | Central authority endpoints | config, claim with signed package, authorize, reports, ingest, commands. Also N4/N5/N6. |
| **C** | Engine port | `RunStore`: a central store (verbatim) and an edge store; `driveEdgeRunFromPackage`; delete `edgeRunGuard`; parity test |
| **D** | Device side | Dispatcher extraction, edge dispatch front ends, authorisation verifier, device ownership, motion-lock authority. Also N1/N2/N3. |
| **E** | Edge runtime | Journal, central client, config sources, agent rewrite, gateway boot without DB |
| **F** | Verification and ops | Two-process E2E with no DB, attack suite A1–A7, hygiene, docs, compose (remove `DATABASE_URL`), CLI. Also N7/N8 and the Đợt 9 T minors (citation, golden byte 8, FAT note, sort-before-refusal, document check-to-write gap). |

## Sequencing
- **Step 1.** Group A's contract commit.
- **Step 2.** In parallel: B, C (central store first), D (extractions first), E. F scaffolds against fakes.
- **Step 3.** Controller integration commit.
- **Step 4.** F runs the real E2E and attack suites.
- **Step 5.** Per-group reviews.
- **Step 6.** Whole-branch review → final fix wave → re-review.
- **Step 7.** doc 81 §18.
- **Step 8.** Ask the owner about merge, migrations, cutover actions, and build + restart.
