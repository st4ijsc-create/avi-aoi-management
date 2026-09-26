/**
 * Interlock rule `commandValue` — parse/serialize pair for the plain-text
 * `<Input>` in `InterlockRuleManagement.tsx` (ILK-05, doc 80 Phụ lục D §7.4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Fix round 1 (reviewer finding, doc 80 Task 2) — SAFETY:
 *   `commandValue` is not decorative: `server/services/interlock/interlockEngine.ts:284`
 *   sends `value: rule.commandValue ?? true` straight to `dispatch()` for a
 *   PLC/adapter write. Whatever this pair round-trips WRONG becomes the actual
 *   command payload — silently, on ANY edit (including a pure rename), because
 *   `submitRule()` always re-sends `commandValueOrNull(form.commandValue)`
 *   even when the operator never touched that field.
 *
 *   BEFORE this fix, `openEdit()` used `String(r.commandValue)` to populate the
 *   form field. `String({...})` → the literal text "[object Object]" — an
 *   object commandValue is DESTROYED (replaced by an unparseable string) the
 *   first time ANYONE opens-and-saves the rule for an unrelated reason (e.g. a
 *   rename), with the approver seeing only a name diff.
 *
 *   FIX: `serializeCommandValueForEdit` keeps a string AS-IS (unquoted — the
 *   existing "type a plain tag name" UX for the common case) but JSON.stringifies
 *   every non-string value, so `commandValueOrNull(serializeCommandValueForEdit(x))`
 *   round-trips exactly for object/array/number/boolean/null.
 *
 *   ⚠ RESIDUAL, KNOWN LIMITATION (documented, not silently masked): a stored
 *   STRING that happens to look like a JSON number/boolean (e.g. the string
 *   "1" or "true") still does NOT round-trip as a string — `serialize` returns
 *   it unquoted (by design, so a plain string like "STOP_LINE" stays readable
 *   without quotes), and `commandValueOrNull` then parses "1"/"true" as the
 *   JSON primitives `1`/`true`, not the original string. A plain single-line
 *   text field cannot express "this text is deliberately a STRING" vs "this
 *   text IS the number/boolean" without a quoting convention — closing this
 *   gap needs a real JSON-aware editor (out of Đợt 0 "vá ngay" scope). The
 *   round-trip test below asserts this EXACT known behavior so it stays a
 *   visible, intentional trade-off instead of a silent regression.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** DB value (any JSON-serializable value, or null) → text for the edit `<Input>`. */
export function serializeCommandValueForEdit(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Text from the edit `<Input>` → value sent to the router (JSON when parseable, else the raw string; empty ⇒ null). */
export function commandValueOrNull(s: string): unknown {
  const v = s.trim();
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
