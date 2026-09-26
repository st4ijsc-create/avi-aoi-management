/**
 * doc 81 Đợt 1B Task 6 — HITL BINDING for OT writes: the ONE canonical payload hash.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY: before this module a confirmed `ai_pending_actions` row authorised ANY OT
 * write — the dispatcher only checked status + owner (BE2 §L2, commandDispatcher
 * :472-475), so one confirmed/executed row (594 of them from the AI coding tools)
 * could be replayed for any adapter/tag/value. Now the row carries, at CREATION
 * time, a hash of exactly the write a human confirmed; the dispatcher recomputes
 * the hash from the command it is about to execute and refuses on any difference.
 *
 * ONE DEFINITION, TWO CALL SITES — the same `otPayloadHash()` is used:
 *   • where pending actions are CREATED (aiCopilotActions.proposeAction via the
 *     tool's `otWriteBinding`, foeEngine.ensureOrchestrationAction), and
 *   • where they are VERIFIED (commandDispatcher, inside the FOR UPDATE tx).
 * A second, hand-written serialisation at either site would drift; don't add one.
 *
 * STORAGE (no migration): the hash lives in `ai_pending_actions.previewJson`
 * under `__otPayloadHash` — the same server-owned previewJson channel already
 * used for `__projectRoot` / `contract`. `argsJson` is NOT used: it is the tool's
 * zod-`.strict()` parameter object and an extra key would break execute().
 *
 * CANONICAL FORM: `{ v, tool, adapterId, machineId, commandType, writes[] }`,
 * keys sorted recursively, `writes` kept IN ORDER and reduced to `{tagKey,value}`
 * (extra fields a caller may carry are not part of the confirmed intent),
 * `undefined` → `null`. Types are NOT coerced: `"1"` and `1` are different
 * values (a human confirming 1 did not confirm the string "1").
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";

/** previewJson key that carries the canonical OT payload hash (server-owned). */
export const OT_PAYLOAD_HASH_FIELD = "__otPayloadHash";

/** Canonical form version — bump if the canonical shape ever changes. */
const CANONICAL_VERSION = 1;

/** Everything that identifies one OT write command. */
export interface OtWriteBindingPayload {
  /** The tool / actor that created the pending action (ai_pending_actions.tool). */
  tool: string;
  adapterId: number;
  machineId?: number | null;
  commandType: string;
  writes: ReadonlyArray<{ tagKey: string; value: unknown }>;
}

/** The part of the payload a write tool resolves from its params (tool is added by the caller). */
export type OtWriteTarget = Omit<OtWriteBindingPayload, "tool">;

function canonicalValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "bigint") return { $bigint: v.toString() };
  if (typeof v === "number") return Number.isFinite(v) ? v : { $number: String(v) };
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(canonicalValue);
  if (typeof v === "object") {
    // Long-like objects (Sparkplug Int64) or plain objects: keys sorted, values canonical.
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v; // string | boolean
}

/** Stable JSON of the payload (exported for tests / diagnostics only). */
export function canonicalOtPayload(p: OtWriteBindingPayload): string {
  return JSON.stringify(
    canonicalValue({
      v: CANONICAL_VERSION,
      tool: p.tool,
      adapterId: p.adapterId,
      machineId: p.machineId ?? null,
      commandType: p.commandType,
      writes: p.writes.map((w) => ({ tagKey: w.tagKey, value: canonicalValue(w.value) })),
    }),
  );
}

/** `sha256:<hex>` of the canonical payload. */
export function otPayloadHash(p: OtWriteBindingPayload): string {
  return `sha256:${createHash("sha256").update(canonicalOtPayload(p), "utf8").digest("hex")}`;
}

/** Return a copy of previewJson carrying the payload hash. */
export function withOtPayloadHash(
  preview: Record<string, unknown> | null | undefined,
  hash: string,
): Record<string, unknown> {
  return { ...(preview ?? {}), [OT_PAYLOAD_HASH_FIELD]: hash };
}

/** Read the stored payload hash (null when absent/malformed ⇒ the row binds NO OT write). */
export function readOtPayloadHash(preview: unknown): string | null {
  if (!preview || typeof preview !== "object") return null;
  const h = (preview as Record<string, unknown>)[OT_PAYLOAD_HASH_FIELD];
  return typeof h === "string" && h.startsWith("sha256:") ? h : null;
}
