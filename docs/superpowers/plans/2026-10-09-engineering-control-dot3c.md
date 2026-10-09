# Đợt 3c — close the Đợt 3b open items — Plan

**Goal:** close the three open items left in doc 81 §12 (Đợt 3b, "Còn mở"). The owner asked on 2026-10-09: "làm nốt các phần còn mở".

**Global constraints:** identical to `.superpowers/sdd/2026-10-06-engineering-control-dot3b/global-constraints.md`, plus every R-2-*/R-3-*/R-3b-* ruling.
- No migration.
- Never connect to `aoi_management` (dev); use `_test` only.
- Commit by pathspec. Messages carry no diacritics, end with "(doc 81 dot 3c task N)", and carry the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- RED → GREEN → mutation for every behaviour change.

## Task 1: Snooze covers the server-side notifications on the bell
- Today the bell's "tạm tắt 1 giờ" (snooze) hides the socket alerts, but the server-unread count from `notification.*` (Đợt 3b Task 3) still shows on the badge.
- Rule (Ruling R-3c-a):
  - Snooze silences the badge for ALL non-critical items, both socket alerts and server notifications.
  - Items with priority `critical`/`urgent` (whatever the table and alerts use for the top level) still show the badge and stay in the list during snooze. Snooze never hides safety-critical information (R-2-y spirit).
  - The list still opens and shows everything. Snooze affects only the badge and any sound or toast.
- Tests:
  - snoozed + normal server unread ⇒ badge hidden;
  - snoozed + critical ⇒ badge shown;
  - snooze expiry ⇒ badge back.
  - Add mutations.

## Task 2: "Current shift" uses the factory's time zone
- `ProductionShifts.tsx` picks the default shift ("the one active shift containing now") using the browser clock.
- Instead, use the time zone of the factory of the selected line or station (`factories.timezone`, `drizzle/schema/hierarchy.ts:86`, default Asia/Ho_Chi_Minh). Reuse the existing factory-time helper (`server/utils/factoryTime.ts`, or the client equivalent if one exists; grep). Don't write a new tz library.
- Overnight shifts (end < start) must work.
- If the factory time zone is unknown, fall back to the browser clock as today, and show it.
- The server never trusts a client-computed "now"; this is only a UI default.
- Tests:
  - a browser in UTC with the factory in Asia/Ho_Chi_Minh picks the right shift;
  - an overnight shift;
  - the fallback.
  - Add mutations.

## Task 3: Real HTTP test of the SAML ACS RelayState path
- Đợt 3b fixed the open redirect in `server/_core/samlProvider.ts` (`samlRelayTarget = safeInternalPath(raw) ?? "/"`, at `:339`, `:355`, `:390`). The ACS callback is covered only by a source regex.
- Add an HTTP-level test that POSTs to the real ACS route with RelayState values `//evil`, `/\evil`, `/..//evil`, `https://evil`, `javascript:` and a valid `/engineering`. Assert the redirect `Location` is "/" for the bad values and the path for the valid one.
- Stub ONLY the SAML assertion validation at the narrowest seam (the library's validate call), so the route, middleware and redirect code all run for real. If the ACS only redirects after a successful assertion, the stub returns a successful test user in `_test`; clean it up afterwards.
- Add a mutation: the old `startsWith("/")` makes the test go red.

## Task 4: Review and merge
- The controller dispatches a review (one reviewer covers all three tasks, since they are small), then a fix round if needed.
- Update doc 81 §12 "Còn mở".
- Ask the owner about merge and push.
