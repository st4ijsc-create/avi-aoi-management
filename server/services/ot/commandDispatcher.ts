/**
 * Sprint F4a/F4b — Command Dispatcher (the ONE entry to send a machine command).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This module is NOT exported to tRPC. It is reachable ONLY from a write-tool's
 *     execute(), which itself runs ONLY after the HITL confirm flow
 *     (proposeAction → confirmAction; RBAC #1 + #2 + audit) in aiCopilotActions.
 *   - dispatch() is the ONLY caller of driver.writeTags() (which reaches the
 *     physical device). No other code path may call writeTags / dispatch.
 *   - Defense-in-depth: dispatch() re-verifies the ai_pending_actions row is
 *     confirmed/executed AND owned by `confirmedBy` before doing anything.
 *   - Mode gate: when OT_CONTROL_ENABLED !== "true" (the DEFAULT) the dispatcher
 *     NEVER calls driver.writeTags — it records a `simulated` commandLog row and
 *     returns { simulated: true }.
 *   - F4b (OT_CONTROL_ENABLED==="true"): after ALL F4a gates pass, dispatch calls
 *     driver.writeTags() under a timeout (OT_CONTROL_TIMEOUT_MS, default 5000ms).
 *     write ok → status='acked' (ack=write-ok; read-back verify is a later TODO);
 *     write ok:false → 'failed'; timeout → 'timeout'; throw → 'failed'.
 *     opcua+modbus drivers write for real; s7/mitsubishi-mc/ethernet-ip still
 *     return ok:false (capability enabled incrementally).
 *   - Every branch (rejected / failed / simulated / acked / timeout) writes a
 *     commandLog row. The tag.writable allowlist is enforced BEFORE any write.
 *   - Idempotency: a prior terminal commandLog for the same idempotencyKey is
 *     returned as-is (no second dispatch / no blind retry).
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
    const cachedOk =
      existing.status === "simulated" || existing.status === "acked" || existing.status === "sent";
    return {
      ok: cachedOk,
      simulated: existing.status === "simulated",
      status: existing.status,
      reason: existing.errorText ?? undefined,
      results: input.writes.map((w) => ({ tagKey: w.tagKey, address: existing.address ?? undefined, ok: cachedOk, status: existing.status, error: existing.errorText ?? undefined })),
      commandLogIds: [existing.id],
    };
  }

  // ── (3) Resolve adapter + tags; assert enabled + writable. ───────────────────
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.adapterId)).limit(1);
  if (!adapter || !adapter.isEnabled) {
    const ids = await writeRejected(db, input, "ADAPTER_DISABLED", "Adapter not found or disabled");
    return { ok: false, simulated: false, status: "rejected", reason: "ADAPTER_DISABLED", results: failedResults(input, "ADAPTER_DISABLED"), commandLogIds: ids };
  }

  const resolved: Array<{
    write: DispatchWrite;
    address: string;
    dataType?: string;
    scale?: number;
    offset?: number;
  }> = [];
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
    resolved.push({
      write: w,
      address: tag.address,
      dataType: tag.dataType ?? undefined,
      // scale/offset là decimal → string trong DB; ép sang number cho driver.
      scale: tag.scale != null ? Number(tag.scale) : undefined,
      offset: tag.offset != null ? Number(tag.offset) : undefined,
    });
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

  // ── (5b) F4b — REAL WRITE PATH. Reachable ONLY when OT_CONTROL_ENABLED==="true"
  //         AND only after every F4a gate above (confirm+owner, idempotency,
  //         allowlist writable, driver active). driver.writeTags() reaches the
  //         physical device. ack (F4b) = write returned ok; read-back verify is a
  //         TODO for a later sprint. NO blind retry.
  const sentAt = new Date();
  const commandLogIds: number[] = [];

  // Map resolved → driver writes (carry dataType/scale/offset for INVERSE scale).
  const driverWrites = resolved.map((r) => ({
    tagKey: r.write.tagKey,
    address: r.address,
    value: r.write.value,
    dataType: r.dataType as any,
    scale: r.scale,
    offset: r.offset,
  }));

  const timeoutMs = Number(process.env.OT_CONTROL_TIMEOUT_MS ?? 5000) || 5000;
  const TIMEOUT = Symbol("timeout");

  let writeResults: Awaited<ReturnType<typeof driver.writeTags>> | typeof TIMEOUT;
  let threwError: string | null = null;
  try {
    writeResults = await Promise.race([
      driver.writeTags(driverWrites),
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), timeoutMs)),
    ]);
  } catch (err) {
    threwError = (err as Error)?.message || String(err);
    writeResults = [];
  }

  // Decide a per-write status from the outcome.
  const timedOut = writeResults === TIMEOUT;
  const resultsArr = Array.isArray(writeResults) ? writeResults : [];

  const results: DispatchPerWrite[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    let status: DispatchStatus;
    let ok: boolean;
    let errorText: string | null;

    if (timedOut) {
      status = "timeout";
      ok = false;
      errorText = `write timeout after ${timeoutMs}ms`;
    } else if (threwError) {
      status = "failed";
      ok = false;
      errorText = threwError;
    } else {
      const wr =
        resultsArr.find((x) => x.tagKey === r.write.tagKey) ??
        { tagKey: r.write.tagKey, ok: false, error: "no result" };
      ok = wr.ok === true;
      status = ok ? "acked" : "failed";
      errorText = ok ? null : (wr.error ?? "write failed");
    }

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
        errorText,
        idempotencyKey: perWriteKey(input.idempotencyKey, r.write.tagKey, i),
        sentAt,
        ackedAt: ok ? new Date() : null,
      })
      .returning({ id: commandLog.id });
    commandLogIds.push(row.id);
    results.push({ tagKey: r.write.tagKey, address: r.address, ok, status, error: errorText ?? undefined });
  }

  const allOk = results.length > 0 && results.every((x) => x.ok);
  const overall: DispatchStatus = allOk ? "acked" : timedOut ? "timeout" : "failed";
  return { ok: allOk, simulated: false, status: overall, results, commandLogIds };
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
