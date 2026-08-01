/**
 * WIP quality-HOLD policy (doc 35 Wave W4-B, task 1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Two problems this closes:
 *
 *  (1) ENUM-VALUE MISMATCH — wipIngestService wrote wip_tracking.status='on_hold'
 *      but wipstatusenum only defines 'hold'. A pgEnum rejects unknown values, so
 *      the NG-serial upsert was silently failing (the whole ingest body is
 *      try/caught), meaning held serials were NEVER even recorded as held. The
 *      fix standardises on the CANONICAL enum value 'hold' (see HELD_WIP_STATUS)
 *      — no ALTER TYPE needed. 'on_hold' is kept in the exclusion list ONLY so a
 *      legacy row (if any slipped through via a non-enum path) is still caught.
 *
 *  (2) DISPATCHABLE-DESPITE-HOLD — the WIP dispatch/advance filter excluded only
 *      ('completed','scrapped'), so a held serial was still recommended for
 *      dispatch. dispatchExcludedStatuses() adds the held statuses when the
 *      WIP_HOLD_ENFORCED flag is ON.
 *
 * FLAG: WIP_HOLD_ENFORCED (default OFF) — when off, behaviour is byte-identical
 * to before (held serials are still dispatchable), so enabling the fix is an
 * explicit opt-in that cannot break current flows.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Canonical enum value a held WIP unit is written with (matches wipstatusenum). */
export const HELD_WIP_STATUS = "hold" as const;

/**
 * Held statuses used in the DB not-in filter. ONLY enum-valid values may appear
 * here: wip_tracking.status is a pgEnum (wipstatusenum), so comparing it against
 * a literal Postgres cannot cast to the enum (e.g. the legacy 'on_hold') raises
 * "invalid input value for enum". 'hold' is the only valid held value, and the
 * broken 'on_hold' writes never persisted anyway (the enum rejected them), so
 * there is nothing legacy to catch.
 */
export const HELD_WIP_STATUSES = ["hold"] as const;

/** Statuses that are never dispatchable regardless of the flag. */
export const TERMINAL_WIP_STATUSES = ["completed", "scrapped"] as const;

/** Read the enforcement flag per-call (so ops/tests can toggle at runtime). */
export function isWipHoldEnforced(): boolean {
  return process.env.WIP_HOLD_ENFORCED === "true";
}

/**
 * The status list excluded from dispatch/advance. Terminal statuses are always
 * excluded; held statuses are added only when WIP_HOLD_ENFORCED is ON.
 */
export function dispatchExcludedStatuses(): string[] {
  return isWipHoldEnforced()
    ? [...TERMINAL_WIP_STATUSES, ...HELD_WIP_STATUSES]
    : [...TERMINAL_WIP_STATUSES];
}
