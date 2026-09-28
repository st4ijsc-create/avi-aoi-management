# Đợt 1D — OT soft-stop ghim theo máy + ts ZIP/tree v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a software STOP through the OT path reach a machine even when the safety PLC is SIM-only, unreadable or reporting NOT OK, but only when the stop writes exactly one pinned stop tag/value. Also reject timezone-less device times on the AOI ZIP and tree v2 paths.

**Architecture:**
- OT stop mirrors the robot `stopJob.ts` pattern. A stop tag/value pinned per tag in `device_tags` (mig 0362) is the only thing that exempts an OT stop from the safety preflight. The dispatcher canonicalises a qualifying stop to the pinned writes, so no caller value ever reaches the wire.
- The ZIP/tree v2 timestamps reuse `requireTimeOffset()` + `coMuiGioTuongMinh` and the coded `INVALID_VALUE`/`timeOffsetRequired` error that already exists for `inspectionTime`.

**Tech Stack:** Express + tRPC v11, Drizzle/Postgres, vitest (DB tests on `_test`), React client with i18n vi/en/zh.

**Spec:** owner decisions 2026-09-28 (doc 81 §8 "Cần chủ dự án quyết" 1 and 3):
- (1) "Làm ngay": pin a per-machine stop tag/value so an OT soft-stop can pass safely.
- (3) "Có, cùng cờ": ZIP/tree v2 `completedAt`/`startedAt` without a timezone are rejected under `INGEST_REQUIRE_TIME_OFFSET`.
- Principles: L-7 (the thing that keeps it safe is UNFILLED data ⇒ fail-closed; gates follow the energy direction, STOP is never blocked once it is proven to be a stop) and R-1C-g (never exempt by command name).

## Global Constraints

1. Shared branch `feat/ai-local-L7-hang-rao`: commit by pathspec only. No `git add -A`/stash/checkout --/reset/rebase/worktree. No push.
2. Do not run npm install/ci, and don't touch node_modules/dist. Do not edit `.env`. Do not restart :3000.
3. DB tests use the `_test` DB only (vitest.setup). NEVER connect to `aoi_management` (dev), not even a ping.
4. The migration is written as SQL + `scripts/apply-migration-0362.mjs`, modelled on `scripts/apply-migration-0361.mjs` (`--dev-only`, idempotent). The OWNER applies it to dev. Tests apply it to `_test`.
5. Census tests are measuring instruments: never evade them (no renames, no dynamic imports, no budget widening). Re-pin only with a dated note naming each new entry.
6. Every user-visible string goes through i18n vi/en/zh and contains no env-var names. Errors use the appError pattern (`appCode` + `appParams.reason`).
7. Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
8. RED → GREEN → MUTATION for every behaviour, with raw runner lines in the report.
9. The safety invariant: a stop exempted from the safety preflight writes ONLY pinned (tagKey, value) pairs of the target adapter; everything else stays fail-closed exactly as today.

## Review Focus

1. **A caller smuggles a non-stop write inside a "stop":** `commandType:"stop"` with the pinned tag plus one extra tag, or the pinned tag with a different value ⇒ it must NOT be exempt, and it goes through the full preflight (today's behaviour).
2. **The pinned value is edited to mean "start":** changing a stop pin is safety configuration. It needs the canEdit permission plus a reason, writes an audit record with the before/after values (no secrets), and any change voids the target's commissioning for that adapter. If voiding commissioning is too invasive, record the ruling and at least surface it in the commissioning checklist.
3. **Types:** the pinned value must match the tag's `dataType` (bool/int/float/string). A non-writable or disabled tag cannot be pinned. Pinning a tag on another adapter or machine is refused.
4. **Two stop tags on one adapter:** allowed, and a stop may write any subset of the pinned tags. Each write must equal its own pin.
5. **ZIP path error surfacing:** a rejected ZIP commit returns the coded error with vi/en/zh text, and does NOT half-commit (no `inspection_packages` or `product_inspections` row).

---

### Task 1: Pin a stop tag/value per OT tag (schema + service + API)

**Files:**
- Create: `drizzle/0362_device_tag_stop_pin.sql`, `scripts/apply-migration-0362.mjs`
- Modify: `drizzle/schema/ot.ts` (`deviceTags` at :53-78)
- Modify: the tRPC router that owns device tag CRUD (the one `client/src/pages/DeviceAdapterManagement.tsx` calls; find it via its `trpc.*.useMutation` names)
- Create: `server/services/ot/stopPin.ts`
- Test: `server/services/ot/stopPin.test.ts` (pure), `server/services/ot/stopPin.dot1d.db.test.ts` (_test DB)

**Interfaces:**
- Produces, in `drizzle/schema/ot.ts`:
  - `deviceTags.stopValue: jsonb | null`. NULL means not a stop tag.
  - `deviceTags.stopPinnedBy: varchar(64) | null`, `deviceTags.stopPinnedAt: timestamptz | null`.
- Produces, in `server/services/ot/stopPin.ts`:
  - `type StopPin = { tagKey: string; value: unknown }`
  - `loadStopPins(db, adapterId: number): Promise<StopPin[]>`. It returns only enabled + writable tags with `stopValue` not null.
  - `matchPinnedStop(pins: StopPin[], writes: {tagKey: string; value: unknown}[]): { ok: true; writes: StopPin[] } | { ok: false; reason: "no_pins" | "empty_writes" | "unpinned_tag" | "value_mismatch" | "duplicate_tag" }`
    - `ok` only when `writes` is non-empty and every write's tagKey has a pin.
    - Values are compared by canonical equality: the number 1 equals `true` only if the tag's dataType is bool. Otherwise the match is strict, using the tag's dataType coercion from the existing OT write path.
    - The returned `writes` are the PIN values, never the caller's.
  - `validateStopValue(dataType: string, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string }`

Migration SQL (idempotent):
```sql
ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS stop_value jsonb;
ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS stop_pinned_by varchar(64);
ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS stop_pinned_at timestamptz;
COMMENT ON COLUMN device_tags.stop_value IS 'Gia tri DUNG ghim (doc 81 §8 QD1). NULL = khong phai tag dung. Chi tag writable+enabled.';
```

API: add a mutation `setStopPin({ adapterId, tagKey, stopValue: unknown | null, reason: string(min 5) })`:
- Needs the same edit permission as tag update, plus an adapter scope check.
- Refuses non-writable or disabled tags (`INVALID_VALUE`, reason `stopPinTagNotWritable`), and a value whose type mismatches (`stopPinTypeMismatch`).
- One transaction with `FOR UPDATE` on the tag row. It writes a `control_audit_log` record with `{tagKey, before, after, reason}` and an `audit_logs` record, using `createAuditContext`.
- `null` clears the pin, with the same audit.
- Pin changes interact with commissioning. Read how commissioning is stored for the adapter/machine: if the target is commissioned, the pin change is still allowed, and the audit is flagged `commissioningRecheckRequired: true`. The commissioning checklist (if one exists in code) lists pinned stop tags. Record which option you implemented, as a Ruling line in the report.

Tag update and tag delete: when a tag becomes non-writable or disabled, or is deleted, its pin is cleared in the same transaction, with the same audit.

- [ ] Step 1: Write `stopPin.test.ts` covering `matchPinnedStop` and `validateStopValue`:
  - an exact pin ⇒ ok, returning the pin values;
  - an extra unpinned tag ⇒ `unpinned_tag`;
  - the same tag with a different value ⇒ `value_mismatch`;
  - empty writes ⇒ `empty_writes`;
  - no pins ⇒ `no_pins`;
  - the same tag twice ⇒ `duplicate_tag`;
  - a bool pin `true` with a caller value of `1` on a bool tag ⇒ ok, returning `true`;
  - a float pin `0` with a caller value of `"0"` ⇒ `value_mismatch`.
- [ ] Step 2: Run `npx vitest run server/services/ot/stopPin.test.ts`. Expected: FAIL (module missing).
- [ ] Step 3: Implement `stopPin.ts`.
- [ ] Step 4: Run it again. Expected: PASS.
- [ ] Step 5: Write the SQL and the apply script (copy the 0361 script structure: `--dev-only`, prints the columns after applying). Add the columns to `drizzle/schema/ot.ts`. Apply to `_test` the way the 0361 tests did (read `server/services/ot/*0361*` or the Task 4 test setup to find how).
- [ ] Step 6: Write `stopPin.dot1d.db.test.ts` for `setStopPin`:
  - canEdit is required;
  - a non-writable tag is refused;
  - a type mismatch is refused;
  - the audit record has before/after and no secrets;
  - clearing works;
  - making a tag non-writable clears its pin;
  - another adapter's tag is refused.
- [ ] Step 7: Run RED → implement the router mutation → GREEN.
- [ ] Step 8: Mutations: drop the writable check ⇒ red; drop the audit ⇒ red; `matchPinnedStop` returns the caller values ⇒ red.
- [ ] Step 9: Commit by pathspec: "feat(ot): ghim tag/gia tri DUNG theo tag (mig 0362) ... (doc 81 dot 1D task 1)".

### Task 2: The dispatcher lets a pinned OT stop through the safety preflight

**Files:**
- Modify: `server/services/ot/commandDispatcher.ts`: the safety step at :758-818, `isStopCommandType` at :475-478, and the refusal helpers at :481-501
- Modify: `server/services/aiLocalTools/writeHandlers/machineControl.ts:197-217` (the lifecycle `stop` verb)
- Test: `server/services/ot/pinnedStop.dot1d.db.test.ts`, and extend `server/services/ot/commandDispatcher.safety.test.ts`

**Interfaces:**
- Consumes: `loadStopPins`, `matchPinnedStop` (Task 1).
- Produces: the ledger/audit field `pinnedStop: true | false`, and an exported `classifyOtStop(commandType, writes, pins)`.

Behaviour:
- Before the safety step, if `isStopCommandType(commandType)`, load the pins for the target adapter and run `matchPinnedStop`.
  - `ok` ⇒ replace `input.writes` with the returned pin writes (canonicalised), set `pinnedStop: true`, and SKIP the safety preflight (BLOCKED, SIM_ONLY and UNKNOWN alike, since a stop reduces energy). Log it in the ledger.
  - Not ok ⇒ unchanged: full preflight. On refusal the existing `softwareStopRefusedUseHardwareEstop` wording applies, plus `appParams.stopPinReason` set to the match reason, so the operator sees why (for example "no stop tag pinned for this machine").
- Every other gate is unchanged for a pinned stop: authN/authZ, target scope, commissioning of the target, idempotency, and the HITL binding when an actionId is supplied. Read the robot rulings R-1C-c/R-1C-d in `.superpowers/sdd/2026-09-27-engineering-control-dot1c/progress.md`. If the policy engine or interlock can DENY a pinned stop, apply the robot rule: a pinned stop is not blocked by a policy DENY/REQUIRE_APPROVAL, and an override is logged. Record this as a ruling.
- If loading the pins fails because of a DB error, there is no exemption (fail-closed to today's behaviour): the pins are the safety data.
- `machineControl.ts` stop verb: when the target adapter has pins, the tool sends exactly the pinned writes (ignoring the `tagKey`/`value` override). When it has none, today's behaviour applies.

- [ ] Step 1: In `pinnedStop.dot1d.db.test.ts`, use a commissioned target with only SIM safety (the fixture pattern from `safetySimOnly.dot1c.db.test.ts:405-491`):
  - (a) a stop with the exact pin ⇒ dispatched, the fake adapter receives exactly the pin value, and the ledger has `pinnedStop: true`;
  - (b) a stop with the pin plus an extra tag ⇒ `SAFETY_SIM_ONLY` refusal with `stopPinReason: "unpinned_tag"`;
  - (c) a stop with the pinned tag and another value ⇒ refused with `value_mismatch`;
  - (d) `commandType:"start"` with the pinned tag and value ⇒ refused (not a stop);
  - (e) safety BLOCKED and UNKNOWN, with a pinned stop ⇒ dispatched;
  - (f) no pins ⇒ refused with `no_pins`;
  - (g) the pin load throws ⇒ refused (fail-closed);
  - (h) an unauthorised caller with a pinned stop ⇒ refused by authz.
- [ ] Step 2: Run it. Expected: (a) and (e) FAIL; the others pass or fail per the current behaviour. Record the raw lines.
- [ ] Step 3: Implement.
- [ ] Step 4: GREEN. Extend `commandDispatcher.safety.test.ts` so the stop refusal carries `stopPinReason`.
- [ ] Step 5: Mutations:
  - use the caller writes instead of the pin writes ⇒ (a) red, because the fake receives the caller's value (make the test send a caller value equal after coercion but a different JS value, e.g. `1` vs `true`, to observe it);
  - drop the `every` check ⇒ (b) red;
  - skip the preflight for any stop ⇒ (f) red;
  - swallow the pin-load error as `ok` ⇒ (g) red.
- [ ] Step 6: `machineControl.ts` stop verb test: with pins, a human `tagKey` override is ignored and the pinned writes are sent. Add a mutation.
- [ ] Step 7: Commit: "fix(ot): lenh DUNG OT ghim theo may qua preflight an toan ... (doc 81 dot 1D task 2)".

### Task 3: UI for setting the stop pin

**Files:**
- Modify: `client/src/pages/DeviceAdapterManagement.tsx` (tag form ~:91-105, fields ~:494-524, table ~:463-477)
- Modify: `client/src/locales/{vi,en,zh}.json` (use the repo's actual locale paths)
- Test: the page's existing test file if there is one, otherwise `client/src/pages/DeviceAdapterManagement.stopPin.test.tsx`

Behaviour:
- In the tag table, a pinned tag shows a "Tag dừng" chip with its value.
- In the tag form (writable tags only), a section "Tag dừng phần mềm" with:
  - a switch;
  - a value input typed by `dataType` (a bool select, a number input, or text);
  - a required reason field;
  - a warning line: "Giá trị này sẽ được ghi khi có lệnh DỪNG, kể cả khi PLC an toàn không đọc được. Sai giá trị = lệnh dừng có thể khởi động máy."
- Saving calls `setStopPin` (separately from the tag update). Errors show through the repo's client error helper (`toastTrpcError`/`describeError`); never show a raw `error.message`.
- The section is hidden or disabled for non-writable tags.

- [ ] Step 1: Write the component test: the switch is hidden for a non-writable tag; save calls `setStopPin` with a typed value and the reason; the chip renders for a pinned tag. RED.
- [ ] Step 2: Implement, then GREEN. Run `i18n-check` and the `clientErrorCoverage`/`rawErrorMessageCensus` censuses; no new reds.
- [ ] Step 3: Commit: "feat(ot): UI ghim tag DUNG ... (doc 81 dot 1D task 3)".

### Task 4: ZIP/tree v2 `completedAt`/`startedAt` follow `INGEST_REQUIRE_TIME_OFFSET`

**Files:**
- Modify: `server/routers/aoiPackageRouter.ts:1440` and `:1610-1614`
- Modify: `server/routers/machineApiRouters.ts:3875` (`submitInspectionTreeV2`, starts :3765). `requireTimeOffset` is at :349-352 and `InspectionTimeOffsetRequiredError` at :363-374: export them, or move them to a small shared module, e.g. `server/utils/timeOffsetPolicy.ts`, and import them in both routers.
- Modify: `server/contracts/machineDataContractV2.ts:175-176,195-196,214-215,277-278` for leaf-level times
- Modify: `server/utils/factoryTime.ts:345-350` (the comment that says ZIP/tree does NOT follow the flag)
- Test: `server/routers/thoiGianMotHeQuyChieu.db.test.ts:192-228` (update the naive case), plus a new `server/routers/aoiPackageTimeOffset.dot1d.test.ts` (the ZIP path)

Behaviour:
- When `requireTimeOffset()` is true (the default), any present `completedAt`/`startedAt` (board level AND leaf level: surface/position/capture/component) that `coMuiGioTuongMinh` says has no timezone ⇒ reject the whole submission. Use the same coded error: `INVALID_VALUE`, `field` = `completedAt` or `startedAt`, `reason: "timeOffsetRequired"`. The message contains `time_offset_required`.
- Add i18n keys `errors.field.completedAt` and `errors.field.startedAt` in vi/en/zh if they are missing.
- An absent field keeps today's fallback, `new Date()` at the server.
- With `INGEST_REQUIRE_TIME_OFFSET=false`, today's behaviour applies (a naive time is read as UTC and marked `machine_naive` where provenance exists).
- ZIP path: validate BEFORE any write, so a rejection leaves no `inspection_packages` or `product_inspections` row. Name the check's position in the report.
- Leaf level: enforce in the translator or the contract `superRefine`, whichever is the single chokepoint for both the ZIP and the direct tree v2. Name it in the report.
- `apidocs/MACHINE_API.md`: add `completedAt`/`startedAt` to the "timezone required" paragraph.

- [ ] Step 1: Tests:
  - direct tree v2 with a naive board `completedAt` ⇒ rejected with the code (the default);
  - the same with the flag `false` ⇒ accepted and read as UTC (keep the old assertion under the explicit flag);
  - a naive leaf `capture.startedAt` ⇒ rejected;
  - `Z` or `+07:00` ⇒ accepted with the correct instant;
  - the BG-72 form `… GMT+0700 (Indochina Time)` ⇒ accepted;
  - a naive ZIP `metaData.completedAt` ⇒ rejected, with 0 rows in `inspection_packages` and `product_inspections` for that package.
  RED.
- [ ] Step 2: Implement, then GREEN.
- [ ] Step 3: Mutations: remove the ZIP check ⇒ red; remove the leaf check ⇒ red; the flag reads false by default ⇒ red.
- [ ] Step 4: Run `fakeUtcCensus`, `appErrorCoverage`, `appErrorParamsCoverage` and `rawErrorCensus`: no new reds beyond the known twinCanhRouter reds.
- [ ] Step 5: Commit: "fix(ingest): completedAt/startedAt ZIP + tree v2 theo INGEST_REQUIRE_TIME_OFFSET ... (doc 81 dot 1D task 4)".

---

## After all tasks
The controller runs the whole-branch review, one fix wave and a re-review. Then doc 81 §9 results. The owner applies `node scripts/apply-migration-0362.mjs --dev-only`, and the owner decides on merge and push.
