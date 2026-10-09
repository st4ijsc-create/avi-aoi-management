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

/**
 * Canonical string of ONE value — the same canonical form the payload hash uses. Exported so
 * other exact-match checks (interlock rule commandValue vs written value) cannot drift from it.
 */
export function canonicalOtValue(v: unknown): string {
  return JSON.stringify(canonicalValue(v));
}

/**
 * doc 81 Đợt 1B Task 6 fix round 1 — a varchar(128) key that stays UNIQUE: unchanged when it
 * fits, else `<prefix>~<16 hex of sha256(full key)>` (exactly `max` chars). A bare slice would
 * drop the distinguishing tail (e.g. the ':<idx>' of a per-write key).
 */
export function boundedKey(key: string, max = 128): string {
  if (key.length <= max) return key;
  const h = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
  return `${key.slice(0, max - 17)}~${h}`;
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

// ─── doc 81 Đợt 1B final wave (item 2) — the ROBOT twin of the OT binding ──────────
/**
 * One confirmed `ai_pending_actions` row authorises EXACTLY one robot job: robotId + jobType +
 * params. Same `canonicalValue`, same previewJson field (`__otPayloadHash`), same `sha256:`
 * prefix; the canonical shape carries `kind: "robot"` so an OT hash can never be replayed as a
 * robot one (or vice versa). `tool` is NOT part of the robot hash: a RobotDispatchInput names no
 * tool (the row's `tool` stays audit metadata). ONE DEFINITION, every call site — the producers
 * (foeEngine.ensureOrchestrationAction via equipment/robotJobMapping.toRobotJob) and the
 * consumer (robotCommandDispatcher, under FOR UPDATE) call THIS function; don't hand-roll one.
 */
export interface RobotJobBindingPayload {
  robotId: number;
  jobType: string;
  /** The job's params exactly as the dispatcher receives them (undefined/null ⇒ null). */
  params?: Record<string, unknown> | null;
}

/** Stable JSON of the robot payload (exported for tests / diagnostics only). */
export function canonicalRobotPayload(p: RobotJobBindingPayload): string {
  return JSON.stringify(
    canonicalValue({
      v: CANONICAL_VERSION,
      kind: "robot",
      robotId: p.robotId,
      jobType: p.jobType,
      params: p.params ?? null,
    }),
  );
}

/** `sha256:<hex>` of the canonical robot payload. */
export function robotPayloadHash(p: RobotJobBindingPayload): string {
  return `sha256:${createHash("sha256").update(canonicalRobotPayload(p), "utf8").digest("hex")}`;
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

// ════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 4 Task A5 (QĐ-4a option (a), ruling R-4-a) — the orchestration engine no longer
// approves itself. An engine-created action ('foe.orchestration') for an OT/robot step carries
// WHO approved the earlier hitl_gate it rides on; both dispatchers refuse one whose confirmer is
// the run owner (defence in depth — the engine already refuses to create it).
// ════════════════════════════════════════════════════════════════════════════

/** ai_pending_actions.tool of every orchestration-engine action (= foeEngine.FOE_ACTION_TOOL). */
export const FOE_ENGINE_TOOL = "foe.orchestration";

/** previewJson key carrying the gate approval an engine action rides on (server-owned). */
export const FOE_APPROVAL_FIELD = "__foeGateApproval";

export interface FoeGateApproval {
  runId: number;
  /** orchestration_runs.startedBy — null when the run was not started by a user (API / system). */
  runOwner: number | null;
  /** users.id who approved the gate (never 0 / system). */
  approvedBy: number;
  gateStepId: string;
}

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Return a copy of previewJson carrying the gate approval. */
export function withFoeGateApproval(preview: Record<string, unknown> | null | undefined, a: FoeGateApproval): Record<string, unknown> {
  return { ...(preview ?? {}), [FOE_APPROVAL_FIELD]: { ...a } };
}

/** Read the stored gate approval; null when absent/malformed (⇒ no separate approval on record). */
export function readFoeGateApproval(preview: unknown): FoeGateApproval | null {
  if (!preview || typeof preview !== "object") return null;
  const a = (preview as Record<string, unknown>)[FOE_APPROVAL_FIELD] as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || !("runOwner" in a)) return null;
  if (!posInt(a.approvedBy) || !posInt(a.runId) || typeof a.gateStepId !== "string" || a.gateStepId.length === 0) return null;
  if (a.runOwner !== null && !posInt(a.runOwner)) return null;
  return { runId: a.runId, runOwner: a.runOwner as number | null, approvedBy: a.approvedBy, gateStepId: a.gateStepId };
}

/**
 * PURE — null when `pending` is NOT an engine action, or is one confirmed by a SEPARATE gate approver.
 * Otherwise the refusal detail: no approval on record (legacy self-approved row), confirmer ≠ the recorded
 * approver, confirmer = the run owner, or confirmer = the requester the command names.
 */
export function foeSelfApprovalRefusal(
  pending: { tool: string; userId: number; previewJson: unknown },
  requestedBy?: number | null,
): string | null {
  if (pending.tool !== FOE_ENGINE_TOOL) return null;
  const a = readFoeGateApproval(pending.previewJson);
  if (!a) return "orchestration action carries no separate gate approval (FOE_GATE_REQUIRED) — an engine step needs an earlier hitl_gate approved by someone other than the run owner";
  if (pending.userId !== a.approvedBy) return "orchestration action is not confirmed by the gate approver on record";
  if (a.runOwner !== null && pending.userId === a.runOwner) return "orchestration action is confirmed by the run owner — a separate approval is required";
  if (requestedBy != null && requestedBy > 0 && pending.userId === requestedBy) return "orchestration action is confirmed by its own requester — a separate approval is required";
  return null;
}
