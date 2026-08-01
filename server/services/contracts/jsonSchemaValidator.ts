/**
 * Minimal JSON-Schema draft-07 SUBSET validator — doc 44 Batch W0-E (gap G2.5).
 *
 * No ajv in the dependency tree (checked package.json + node_modules) and the batch rule is
 * "no new deps", so this is a deliberate pure-TS validator covering exactly the keywords the
 * canonical LDS-L1 contracts (contracts/canonical/*.schema.json) use:
 *
 *   • type       — "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
 *   • required   — on objects
 *   • properties — recursive
 *   • enum       — scalar membership
 *   • items      — single-schema arrays (tuple form not supported — not used by our contracts)
 *   • additionalProperties: false — rejected keys (our contracts keep this OPEN for BACKWARD
 *     extension; supported anyway so an intentionally-closed schema behaves correctly)
 *
 * Everything else ($ref, allOf/anyOf, pattern, format, min/max…) is intentionally IGNORED —
 * unknown keywords must not cause false rejections. If a contract ever needs them, that is the
 * moment to adopt ajv, not to grow this file.
 *
 * Pure + fail-safe: never throws on malformed schema/payload; returns error strings instead.
 */

import type { JsonSchema } from "./schemaRegistry";

/** JSON-typeof with draft-07 names (array ≠ object, null ≠ object, integer ⊂ number). */
function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "number") return "number"; // "integer" handled in matchesType
  return t; // "string" | "boolean" | "object" | "undefined" | ...
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return jsonTypeOf(value) === type;
}

/**
 * Validate `value` against `schema` (draft-07 subset above). Returns a flat list of
 * human-readable errors ("path: problem"); empty list = valid.
 */
export function validateAgainstSchema(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object") return errors; // empty/invalid schema → permissive

  // type — string or array of strings (any match passes).
  const type = schema.type;
  if (typeof type === "string") {
    if (!matchesType(value, type)) {
      errors.push(`${path}: expected type "${type}", got "${jsonTypeOf(value)}"`);
      return errors; // wrong shape — deeper checks would only cascade noise
    }
  } else if (Array.isArray(type) && type.length > 0) {
    if (!type.some((t) => typeof t === "string" && matchesType(value, t))) {
      errors.push(`${path}: expected one of types ${JSON.stringify(type)}, got "${jsonTypeOf(value)}"`);
      return errors;
    }
  }

  // enum — scalar membership (deep-equality for objects is out of subset scope).
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!(schema.enum as unknown[]).some((v) => v === value)) {
      errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    }
  }

  // object keywords
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as unknown[]) {
        if (typeof key === "string" && !(key in obj)) errors.push(`${path}: missing required property "${key}"`);
      }
    }
    const props = schema.properties;
    if (props && typeof props === "object") {
      for (const [key, sub] of Object.entries(props as Record<string, JsonSchema>)) {
        if (key in obj) errors.push(...validateAgainstSchema(sub, obj[key], `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in (props as object))) errors.push(`${path}: additional property "${key}" not allowed`);
        }
      }
    }
  }

  // array keyword — single-schema `items` only.
  if (Array.isArray(value)) {
    const items = schema.items;
    if (items && typeof items === "object" && !Array.isArray(items)) {
      value.forEach((item, i) => errors.push(...validateAgainstSchema(items as JsonSchema, item, `${path}[${i}]`)));
    }
  }

  return errors;
}
