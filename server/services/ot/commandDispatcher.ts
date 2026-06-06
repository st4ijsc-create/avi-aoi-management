/**
 * Sprint F4a — Command Dispatcher (the ONE entry to send a machine command).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (F4a — DRY-RUN, no device write):
 *   - This module is NOT exported to tRPC. It is reachable ONLY from a write-tool's
 *     execute(), which itself runs ONLY after the HITL confirm flow
 *     (proposeAction → confirmAction; RBAC #1 + #2 + audit) in aiCopilotActions.
 *   - Defense-in-depth: dispatch() re-verifies the ai_pending_actions row is
 *     confirmed/executed AND owned by `confirmedBy` before doing anything.
 *   - Mode gate: when OT_CONTROL_ENABLED !== "true" (the F4a default) the
 *     dispatcher NEVER calls driver.writeTags — it records a `simulated`
 *     commandLog row and returns { simulated: true }. The 5 real drivers'
 *     writeTags still return ok:false until F4b explicitly opens the path.
 *   - Every branch (rejected / failed / simulated) writes a commandLog row.
 *   - Idempotency: a prior terminal commandLog for the same idempotencyKey is
 *     returned as-is (no second dispatch).
 *   - NO auto-chaining: dispatch handles exactly one command request.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  aiPendingActions,
  deviceAdapters,
  deviceTags,
  commandLog,
  type CommandLog,
} from "../../../drizzle/schema";
import { getActiveDriver } from "./otManager";

/** True when the operator has explicitly enabled real OT control (F4b). */
export function isOtControlEnabled(): boolean {
  return process.env.OT_CONTROL_ENABLED === "true";
}

export type DispatchStatus = CommandLog["status"]; // simulated | sent | acked | failed | timeout | rejected

export interface DispatchWrite {
  tagKey: string;
  value: unknown;
}

export interface DispatchInput {
  /** ai_pending_actions.id of the confirmed HITL action (defense-in-depth). */
  actionId?: string;
  adapterId: number;
  machineId?: number | null;
  commandType: string;
  writes: DispatchWrite[];
  /** User who confirmed the HITL action (must own the pending row). */
  confirmedBy: number;
  /** User who originally requested (proposed) the action. */
  requestedBy: number;
  lang?: "vi" | "en" | "zh";
  /** Unique key → at most one effective dispatch. */
  idempotencyKey: string;
}

export interface DispatchPerWrite {
  tagKey: string;
  address?: string;
  ok: boolean;
  status: DispatchStatus;
  error?: string;
}

export interface DispatchResult {
  ok: boolean;
  simulated: boolean;
  status: DispatchStatus;
  reason?: string;
  results: DispatchPerWrite[];
  commandLogIds: number[];
}

const TERMINAL_STATUSES: ReadonlySet<DispatchStatus> = new Set([
  "simulated",
  "acked",
  "failed",
  "timeout",
  "rejected",
]);

/**
 * Dispatch a machine command. In F4a this is always DRY-RUN unless
 * OT_CONTROL_ENABLED === "true" (reserved for F4b). Returns a structured result
 * and records commandLog rows on every branch. Never throws for the expected
 * failure modes (offline / not writable / not confirmed).
 */
export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const db = await getDb();
  if (!db) {
    return { ok: false, simulated: false, status: "failed", reason: "DB_UNAVAILABLE", results: [], commandLogIds: [] };
  }

  // ── (1) Defense-in-depth: the HITL pending action must be confirmed/executed
  //        AND owned by the confirming user. ──────────────────────────────────
  if (input.actionId) {
    const [pending] = await db
      .select()
      .from(aiPendingActions)
      .where(eq(aiPendingActions.id, input.actionId))
      .limit(1);

    const confirmedOk =
      !!pending &&
      (pending.status === "confirmed" || pending.status === "executed") &&
      pending.userId === input.confirmedBy;

    if (!confirmedOk) {
      const ids = await writeRejected(db, input, "NOT_CONFIRMED", "HITL action not confirmed or owner mismatch");
      return { ok: false, simulated: false, status: "rejected", reason: "NOT_CONFIRMED", results: failedResults(input, "NOT_CONFIRMED"), commandLogIds: ids };
    }
  }

  // ── (2) Idempotency: a prior terminal command for this key → return cached. ──
  // commandLog rows store a per-write key; probe the deterministic first one
  // (index 0, first tagKey) so a repeat dispatch with the same base key matches.
  const probeKey = perWriteKey(input.idempotencyKey, input.writes[0]?.tagKey ?? "_", 0);
  const [existing] = await db
    .select()
    .from(commandLog)
    .where(eq(commandLog.idempotencyKey, probeKey))
    .limit(1);
  if (existing && TERMINAL_STATUSES.has(existing.status)) {
    return {
      ok: existing.status === "simulated" || existing.status === "acked" || existing.status === "sent",
      simulated: existing.status === "simulated",
      status: existing.status,
      reason: existing.errorText ?? undefined,
      results: input.writes.map((w) => ({ tagKey: w.tagKey, address: existing.address ?? undefined, ok: existing.status === "simulated", status: existing.status, error: existing.errorText ?? undefined })),
      commandLogIds: [existing.id],
    };
  }

  // ── (3) Resolve adapter + tags; assert enabled + writable. ───────────────────
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.adapterId)).limit(1);
  if (!adapter || !adapter.isEnabled) {
    const ids = await writeRejected(db, input, "ADAPTER_DISABLED", "Adapter not found or disabled");
    return { ok: false, simulated: false, status: "rejected", reason: "ADAPTER_DISABLED", results: failedResults(input, "ADAPTER_DISABLED"), commandLogIds: ids };
  }

  const resolved: Array<{ write: DispatchWrite; address: string }> = [];
  for (const w of input.writes) {
    const [tag] = await db
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, input.adapterId), eq(deviceTags.tagKey, w.tagKey)))
      .limit(1);

    if (!tag || !tag.isEnabled) {
      const ids = await writeRejected(db, input, "TAG_NOT_FOUND", `Tag "${w.tagKey}" not found or disabled`, w.tagKey);
      return { ok: false, simulated: false, status: "rejected", reason: "TAG_NOT_FOUND", results: failedResults(input, "TAG_NOT_FOUND"), commandLogIds: ids };
    }
    if (tag.writable !== true) {
      // Tag not writable → reject WITHOUT sending anything.
      const ids = await writeRejected(db, input, "TAG_NOT_WRITABLE", `Tag "${w.tagKey}" is not writable`, w.tagKey, tag.address);
      return { ok: false, simulated: false, status: "rejected", reason: "TAG_NOT_WRITABLE", results: failedResults(input, "TAG_NOT_WRITABLE"), commandLogIds: ids };
    }
    resolved.push({ write: w, address: tag.address });
  }

  // ── (4) Resolve a connected driver. ─────────────────────────────────────────
  const driver = getActiveDriver(input.adapterId);
  if (!driver) {
    const ids = await writeFailed(db, input, "ADAPTER_OFFLINE", "No connected driver for adapter");
    return { ok: false, simulated: false, status: "failed", reason: "ADAPTER_OFFLINE", results: failedResults(input, "ADAPTER_OFFLINE", "failed"), commandLogIds: ids };
  }

  // ── (5) MODE GATE. F4a default → DRY-RUN: do NOT call driver.writeTags. ───────
  if (!isOtControlEnabled()) {
    const commandLogIds: number[] = [];
    const results: DispatchPerWrite[] = [];
    for (const r of resolved) {
      const [row] = await db
        .insert(commandLog)
        .values({
          actionId: input.actionId ?? null,
          adapterId: input.adapterId,
          machineId: input.machineId ?? null,
          tagKey: r.write.tagKey,
          address: r.address,
          commandType: input.commandType,
          requestedValue: r.write.value as any,
          requestedBy: input.requestedBy,
          confirmedBy: input.confirmedBy,
          status: "simulated",
          idempotencyKey: perWriteKey(input.idempotencyKey, r.write.tagKey, results.length),
        })
        .returning({ id: commandLog.id });
      commandLogIds.push(row.id);
      results.push({ tagKey: r.write.tagKey, address: r.address, ok: true, status: "simulated" });
    }
    return { ok: true, simulated: true, status: "simulated", results, commandLogIds };
  }

  // ── (5b) F4b ONLY — real write path. NOT reachable in F4a (gate above).
  // TODO(F4b): when OT_CONTROL_ENABLED === "true", call driver.writeTags(...)
  //            with the resolved {tagKey,address,value}, map OtCommandResult →
  //            commandLog status sent/acked/failed/timeout, set sentAt/ackedAt.
  //            Until F4b lands, the 5 protocol drivers' writeTags() still return
  //            ok:false, so even this branch would not mutate a device.
  const commandLogIds: number[] = [];
  const results: DispatchPerWrite[] = [];
  const writeResults = await driver.writeTags(
    resolved.map((r) => ({ tagKey: r.write.tagKey, address: r.address, value: r.write.value })),
  );
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    const wr = writeResults.find((x) => x.tagKey === r.write.tagKey) ?? { tagKey: r.write.tagKey, ok: false, error: "no result" };
    const status: DispatchStatus = wr.ok ? "sent" : "failed";
    const [row] = await db
      .insert(commandLog)
      .values({
        actionId: input.actionId ?? null,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        tagKey: r.write.tagKey,
        address: r.address,
        commandType: input.commandType,
        requestedValue: r.write.value as any,
        requestedBy: input.requestedBy,
        confirmedBy: input.confirmedBy,
        status,
        errorText: wr.ok ? null : (wr.error ?? "write failed"),
        idempotencyKey: perWriteKey(input.idempotencyKey, r.write.tagKey, i),
        sentAt: wr.ok ? new Date() : null,
      })
      .returning({ id: commandLog.id });
    commandLogIds.push(row.id);
    results.push({ tagKey: r.write.tagKey, address: r.address, ok: wr.ok, status, error: wr.ok ? undefined : (wr.error ?? "write failed") });
  }
  const allOk = results.every((x) => x.ok);
  return { ok: allOk, simulated: false, status: allOk ? "sent" : "failed", results, commandLogIds };
}

// ─── commandLog writers (one row per write so the ledger is complete) ─────────

async function writeRejected(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  reason: string,
  detail: string,
  onlyTagKey?: string,
  address?: string,
): Promise<number[]> {
  return writeAll(db, input, "rejected", reason, detail, onlyTagKey, address);
}

async function writeFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  reason: string,
  detail: string,
): Promise<number[]> {
  return writeAll(db, input, "failed", reason, detail);
}

async function writeAll(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: DispatchInput,
  status: DispatchStatus,
  reason: string,
  detail: string,
  onlyTagKey?: string,
  address?: string,
): Promise<number[]> {
  const ids: number[] = [];
  const writes = onlyTagKey ? input.writes.filter((w) => w.tagKey === onlyTagKey) : input.writes;
  const list = writes.length > 0 ? writes : [{ tagKey: null as any, value: null }];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const [row] = await db
      .insert(commandLog)
      .values({
        actionId: input.actionId ?? null,
        adapterId: input.adapterId,
        machineId: input.machineId ?? null,
        tagKey: w.tagKey ?? null,
        address: address ?? null,
        commandType: input.commandType,
        requestedValue: w.value as any,
        requestedBy: input.requestedBy,
        confirmedBy: input.confirmedBy,
        status,
        errorText: `${reason}: ${detail}`,
        idempotencyKey: perWriteKey(input.idempotencyKey, w.tagKey ?? "_", i),
      })
      .returning({ id: commandLog.id });
    ids.push(row.id);
  }
  return ids;
}

function failedResults(input: DispatchInput, reason: string, status: DispatchStatus = "rejected"): DispatchPerWrite[] {
  return input.writes.map((w) => ({ tagKey: w.tagKey, ok: false, status, error: reason }));
}

/** Make a per-write idempotency key so a multi-write command keeps the unique constraint. */
function perWriteKey(base: string, tagKey: string, index: number): string {
  const k = `${base}:${tagKey}:${index}`;
  return k.length <= 128 ? k : k.slice(0, 128);
}
