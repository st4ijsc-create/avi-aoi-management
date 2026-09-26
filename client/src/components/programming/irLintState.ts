/**
 * Doc 80 Đợt 0 — Task 5 (Phụ lục C §3 IR-02): THREE-state lint view for the IR editor.
 *
 * The editor used `lint?.ok ?? true`, so a lint query that FAILED (e.g. HTTP 431 once the
 * flow outgrows the GET URL) or had not answered yet showed "Lint OK / Pass" — a false green
 * next to the Save / Build buttons. Now the badge, the KPI and the action gating all read
 * one derived state:
 *
 *   • ok          — the linter answered for the CURRENT draft and found no error.
 *   • errors      — the linter answered and found ≥1 error (Save stays allowed: the server
 *                   records "saved with lint issues"; Build is still gated server-side).
 *   • unreadable  — the query errored, is (re)fetching, has no data yet, or the answer is for
 *                   an older draft (debounce pending) ⇒ Save / Build are LOCKED and the UI
 *                   shows why.
 *
 * PURE (no React) so it is unit-tested directly.
 */

export type IrLintStatus = "ok" | "errors" | "unreadable";
export type IrLintUnreadableReason = "error" | "loading";

export interface IrLintQueryLike {
  data: { ok: boolean } | undefined;
  error: { message: string } | null | undefined;
  isFetching: boolean;
}

export interface IrLintView {
  status: IrLintStatus;
  /** Why the result is unreadable (null when readable). */
  reason: IrLintUnreadableReason | null;
  /** The query's error message when reason === "error". */
  errorMessage?: string;
  /** Save / Build are allowed only when the lint result is readable. */
  canSaveOrBuild: boolean;
}

/**
 * @param q                the lint query state (react-query shape).
 * @param inputIsCurrent   false while the debounced lint input still lags the live draft.
 */
export function deriveIrLintState(q: IrLintQueryLike, inputIsCurrent: boolean): IrLintView {
  if (q.error) {
    return { status: "unreadable", reason: "error", errorMessage: q.error.message, canSaveOrBuild: false };
  }
  if (q.isFetching || !inputIsCurrent || q.data === undefined) {
    return { status: "unreadable", reason: "loading", canSaveOrBuild: false };
  }
  return { status: q.data.ok ? "ok" : "errors", reason: null, canSaveOrBuild: true };
}
