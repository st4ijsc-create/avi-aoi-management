/**
 * Zod → JSON-Schema config form — SYNAPSE §6.4.4 (doc 33 §3.2 / F2).
 *
 * A plugin declares its config as a Zod schema; the Hub converts it to JSON-Schema so the
 * Setup Wizard can AUTO-GENERATE a config form — no core/UI edit when a new vendor is added.
 * Uses zod v4's native `z.toJSONSchema`. Fail-safe: returns an honest empty object schema on
 * error rather than throwing (a bad plugin config must not crash the Hub).
 */
import { z } from "zod";

/** Convert a Zod schema into a JSON-Schema object for auto-form generation. */
export function zodToConfigForm(schema: z.ZodType): Record<string, unknown> {
  try {
    // zod v4: z.toJSONSchema(schema) → JSON-Schema (draft 2020-12).
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    // Honest fallback: an open object schema (form shows no fields rather than crashing).
    return { type: "object", additionalProperties: true, "x-conversion": "failed" };
  }
}
