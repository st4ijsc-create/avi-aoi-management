/**
 * Interlock rule `commandValue` — edit-form contract for `InterlockRuleManagement.tsx`
 * (ILK-05, doc 80 Phụ lục D §7.4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY: `commandValue` is not decorative — `server/services/interlock/interlockEngine.ts:284`
 * sends `value: rule.commandValue ?? true` straight to `dispatch()` for a
 * PLC/adapter write. Whatever this module round-trips WRONG becomes the actual
 * command payload, silently, on ANY edit (including a pure rename), because
 * `submitRule()` always re-sends a `commandValue`.
 *
 * Fix round 1 (object corruption): `openEdit()` used to populate the edit field
 * with `String(r.commandValue)`. `String({...})` → the literal text
 * "[object Object]" — an object commandValue was DESTROYED (replaced by an
 * unparseable string) the first time anyone opened-and-saved the rule for an
 * unrelated reason. `serializeCommandValueForEdit` fixed that (JSON.stringify
 * for non-strings).
 *
 * Fix round 2 (type drift — the part round 1 left open): a single auto-detecting
 * parser (`JSON.parse` with a raw-string fallback) cannot tell "the stored value
 * IS the string '1'" from "the stored value is the number 1" — both display as
 * the text `1`. Re-review found this still let ANY edit (a rename included)
 * silently turn a stored string "1"/"true" into the number 1 / boolean true.
 * Closed with TWO complementary mechanisms, neither of which requires quoting
 * plain tag-name strings:
 *
 *   1. PRESERVE-IF-UNTOUCHED (`resolveCommandValueForSubmit`) — if the edit
 *      field's text is byte-identical to what it was when the dialog opened,
 *      the ORIGINAL captured value is sent back VERBATIM (exact reference/type,
 *      no re-parse at all) — regardless of what the type selector says. A
 *      rename, or editing any OTHER field, can therefore never alter the
 *      command payload, full stop — this guarantee does not depend on
 *      `parseCommandValueByType`/`inferCommandValueType` being bug-free.
 *   2. EXPLICIT TYPE ON EDIT (`parseCommandValueByType` + `inferCommandValueType`) —
 *      when the operator DOES change the text, a "Kiểu giá trị" selector
 *      (Văn bản/Số/Đúng-Sai/JSON) says unambiguously how to parse it. No more
 *      auto-detection: typing `1` with type=Văn bản yields the STRING "1";
 *      typing `1` with type=Số yields the NUMBER 1. Invalid input for the
 *      selected type (e.g. "abc" as Số, "{bad" as JSON) is REJECTED
 *      (`CommandValueParseError`) rather than silently coerced or dropped.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** DB value (any JSON-serializable value, or null) → text for the edit `<Input>`. */
export function serializeCommandValueForEdit(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export type CommandValueType = "text" | "number" | "boolean" | "json";

export type CommandValueParseErrorCode = "invalid_number" | "invalid_boolean" | "invalid_json";

/** Thrown by `parseCommandValueByType`/`resolveCommandValueForSubmit` on input that doesn't match the selected type. */
export class CommandValueParseError extends Error {
  readonly code: CommandValueParseErrorCode;
  constructor(code: CommandValueParseErrorCode) {
    super(code);
    this.name = "CommandValueParseError";
    this.code = code;
  }
}

/** Default the "Kiểu giá trị" selector from a stored value's actual JS type. */
export function inferCommandValueType(v: unknown): CommandValueType {
  if (v == null) return "text";
  if (typeof v === "string") return "text";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "json"; // object / array
}

/**
 * Parse edit-field text STRICTLY per an explicit type — no auto-detection.
 * Empty (whitespace-only) text always means "clear the value" ⇒ null,
 * regardless of the selected type.
 */
export function parseCommandValueByType(text: string, type: CommandValueType): unknown {
  const t = text.trim();
  if (!t) return null;
  switch (type) {
    case "text":
      return t;
    case "number": {
      const n = Number(t);
      if (!Number.isFinite(n)) throw new CommandValueParseError("invalid_number");
      return n;
    }
    case "boolean": {
      if (t === "true") return true;
      if (t === "false") return false;
      throw new CommandValueParseError("invalid_boolean");
    }
    case "json": {
      try {
        return JSON.parse(t);
      } catch {
        throw new CommandValueParseError("invalid_json");
      }
    }
    default:
      return t;
  }
}

export interface ResolveCommandValueInput {
  /** action === "alert" ⇒ commandValue is always forced to null (unchanged from before ILK-05). */
  actionIsAlert: boolean;
  /** Current text of the edit `<Input>`. */
  currentText: string;
  /** Text the edit `<Input>` was initialized with when the dialog opened (`serializeCommandValueForEdit(original)`). */
  initialText: string;
  /** The ORIGINAL stored value (captured verbatim when the dialog opened). */
  initialRaw: unknown;
  /** The "Kiểu giá trị" selector's current value — consulted ONLY when the text has actually changed. */
  selectedType: CommandValueType;
}

/**
 * The submit-time contract (Fix round 2). See module docblock for the two
 * mechanisms this composes: preserve-if-untouched, then explicit-type parse.
 */
export function resolveCommandValueForSubmit(input: ResolveCommandValueInput): unknown {
  if (input.actionIsAlert) return null;
  if (input.currentText === input.initialText) return input.initialRaw;
  return parseCommandValueByType(input.currentText, input.selectedType);
}
