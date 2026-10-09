# Đợt 3b — six follow-up items (owner decisions 2026-10-06) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each task is a brief with requirements and acceptance criteria; implementers read the code in place.

**Goal:** Carry out the six follow-up items the owner chose on 2026-10-06 (doc 81 §12, "Đã chốt 2026-10-06").

**Architecture:**
- These are small changes on top of Đợt 3.
- Task 1 changes one server procedure and the assign payload. It uses the existing `operator_assignments.shiftConfigId` column, so no migration is needed.
- Task 3 wires the existing notification bell to the existing `notifications` table.
- Everything else is client-only, except one server code comment.

**Tech Stack:** React 19 + Vite + shadcn, tRPC v11, Drizzle/Postgres, Vitest, Playwright layout instrument.

**Spec:** doc 81 §12, "Đã chốt (2026-10-06)". Owner approved doing these six items as Đợt 3b on 2026-10-06.

## Global Constraints
1. These are identical to `.superpowers/sdd/2026-10-05-engineering-control-dot3/global-constraints.md`, plus every R-2-*/R-3-* ruling.
   - Shared branch: commit by pathspec only. No push, no build, don't touch dist/, don't edit .env, don't restart :3000.
   - **Never connect to `aoi_management` (dev).**
   - **No migration** in this đợt.
2. R-2-n: no new actuation. A payload may change only where the owner decided it (Task 1, shift on assign).
3. Censuses are instruments. Strings go in vi/en/zh with no env-var names. Follow RED → GREEN → mutation.
4. Commit messages carry no diacritics and end with "(doc 81 dot 3b task N)" plus the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus
1. **Task 1:** server-side shift filtering must keep tenant/factory scoping and the old `limit` semantics. An assignment without a shift remains valid (the field is optional).
2. **Task 3:** the bell shows only the CURRENT user's notifications. `actionUrl` must be an internal relative path (no open redirect). Mark-read is scoped to the owner.
3. **Task 2 (chips):** a critical/pinned chip (R-2-p, R-2-i licence) is never folded into "+N" at any width.

---

## Task 1: Shift on assignment plus a server-side shift filter (Sản xuất › Ca)
- Server:
  - `safety.listAssignments` accepts an optional `shiftConfigId`, filtered in SQL. Keep the current `{status, limit}` behaviour when it is absent.
  - `assignOperator` and `reassignOperator` accept an optional `shiftConfigId`. Validate that it exists, is active and is in the caller's scope. Write it to `operator_assignments.shiftConfigId`.
- Client:
  - `ProductionShifts.tsx`: the shift filter (`?shift=`) now queries the server instead of filtering the latest 200 rows on the client. The "≥200" hint goes away for shift filtering.
  - The assign and reassign sheets get an optional shift picker. It defaults to the shift whose time window contains now, if exactly one matches.
  - "Chưa gắn ca" stays as a filter value (`shiftConfigId IS NULL`).
- Tests:
  - server, on `_test`: filter by shift; scoping; an invalid shift is refused; omitting the shift still works;
  - DOM: the picker, and the query parameters sent;
  - mutations.
- Re-measure Sản xuất › Ca with the instrument.

## Task 2: Four small UI items
- (a) **Hub catalog follows the Labs toggle:** Fleet and any `labs` item are hidden from the Hub tool catalog when "Hiện Labs" is off. User pins are untouched. The R-2-y deadlock alert is unaffected. Add a test.
- (b) **Header chips at 640–1023 px:** fold non-pinned chips into "+N" (the existing StatusChipStrip/NoticeStack overflow) so nothing is clipped. Critical/pinned chips stay visible, and so does the R-2-i licence bar/chip. Test at 768 and 1024 px. Measure with the instrument at 768 if the instrument supports it; otherwise use a DOM geometry test and a manual Playwright check.
- (c) **Archive needs confirmation on Integration too:** in the fallback mode (R-3-h), archive gets the same confirm step as Recipes. Permission stays canCreate as before; only the confirmation is added. Add a test.
- (d) **ECN 2FA comment:** fix the code comment that claims ECN approval requires 2FA (`ecnRouter.ts` around `:51`) so it states the actual rule: role floor, with 2FA per the deployment-wide setting. No behaviour change.

## Task 3: Notification bell reads `notifications`
- Find the existing bell component and whatever it reads today. Wire it to the `notifications` table (`drizzle/schema/system.ts:236`) for the current user:
  - the unread count;
  - the latest N items;
  - a click navigates to `actionUrl` (internal relative only, validated) and marks the item read;
  - "đánh dấu tất cả đã đọc".
- Reuse an existing notifications router if one exists. If none does, add a minimal one: `list({limit})`, `markRead({id})`, `markAllRead()`, each scoped to `ctx.user.id`.
- Live update by polling while the tab is visible, at a modest interval. Use the socket instead if one already pushes notifications.
- Keep whatever the bell already shows. Merge the two sources if it currently shows something else; don't drop existing content.
- Tests:
  - server, on `_test`: a user sees only their own items, can't mark another user's item read, and a non-relative `actionUrl` is never followed;
  - DOM: count, list, click → navigate + read.
  - Mutations.

## Task 4: Final review and merge preparation
- Controller dispatches a whole-branch review of Đợt 3b, then one fix wave and a re-review.
- Update doc 81 §12 with a "Đợt 3b" paragraph.
- Ask the owner about merge and push.
