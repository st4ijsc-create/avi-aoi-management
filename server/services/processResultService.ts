/**
 * Sprint F2 — Process Result Service.
 *
 * Records a generic process/station-step RESULT from ANY machine type and links
 * it into the tamper-evident genealogy ledger as a "station" event (re-using the
 * existing event type — the hash-chain schema is NOT widened).
 *
 * This is telemetry of an OUTCOME, not a control command: there is no write path
 * to actuate a machine here (that is deferred to F4).
 *
 * Failure isolation: if the genealogy append fails, the process result is still
 * persisted (we only log the chain error) so result capture never blocks on the
 * ledger.
 *
 * ── Doc 56 Đ1 (nhóm B, migration 0288) — DURABILITY/PROVENANCE ────────────────
 * The generic PROCESS FEED (machineApi.submitProcessResult) needs the same
 * exactly-once guarantee the inspection feed got in doc 51 P1. When the machine
 * sends an explicit `idempotencyKey`, this service CLAIMS it in the plain
 * process_idempotency_keys ledger FIRST (inside one transaction), then inserts
 * the process_results row and back-fills the ledger — mirroring
 * db/inspection.ts createProductInspection bit-for-bit. A retry of the SAME key
 * resolves to the ORIGINAL row (duplicate:true) and writes NO second row and NO
 * second genealogy event. Machines that send no key keep the exact pre-doc-56
 * path (plain insert, no transaction) — backward-compatible for every existing
 * caller (processResultRouter, F2/W2-B2 tests).
 */
import { and, eq } from "drizzle-orm";
import * as db from "../db";
import {
  hashEntry,
  type GenealogyInput,
} from "../utils/genealogyChain";
// doc 44 W2-B2 (G5.17) — stamp the ALS correlation id on the genealogy row (trace
// metadata, OUTSIDE the hash input → verifyChain unaffected).
import { getCorrelationId } from "./observability/correlation";
import type { InsertProcessResult } from "../../drizzle/schema";
// Doc 56 Đ1 — value imports for the idempotency-ledger claim (engaged only when a
// machine sends an explicit idempotencyKey; the plain path never touches them).
import { processResults, processIdempotencyKeys } from "../../drizzle/schema";
import type { MachineType } from "../constants/machineTypes";

/**
 * Doc 56 Đ1 — a STRUCTURED metric straight from the "ST4I Standard Process Feed
 * v1" envelope (name/value plus the machine's declared unit + spec limits). The
 * service flattens it into the scalar `metrics` jsonb: `name → value`, and each
 * of unit/lsl/usl/nominal under a suffixed key (`${name}__unit`, `__lsl`, …) so
 * they never break the numeric metric-series queries in db/processResult.ts
 * (which cast `metrics->>key` and skip non-numeric values). Keeping mapping in
 * the service means the router (and doc 57's REST feed) just pass the array.
 */
export interface ProcessMetricSpec {
  name: string;
  value: number;
  unit?: string;
  lsl?: number;
  usl?: number;
  nominal?: number;
}

export interface RecordProcessResultInput {
  serialNumber: string;
  machineId: number;
  stepType: string;
  result: "pass" | "fail" | "warn" | "skip";
  machineType?: MachineType;
  stationId?: number;
  lineCode?: string;
  productionOrderCode?: string;
  lotCode?: string;
  /** Pre-built scalar metric map (legacy callers). Merged UNDER metricSpecs. */
  metrics?: Record<string, number | string | boolean>;
  /** Structured metrics from the envelope; flattened into `metrics` (see above). */
  metricSpecs?: ProcessMetricSpec[];
  recipeRef?: string;
  measuredAt?: Date;
  // ── Doc 56 Đ1 (migration 0288) durability/provenance — all optional/additive ──
  /** Client-generated, stable across retries → exactly-once via the ledger. */
  idempotencyKey?: string;
  /** When the SERVER received the submission (the clock a machine cannot lie about). */
  serverReceivedAt?: Date;
  /** 'device' (machine sent ts with offset) | 'server' (server stamped now()). */
  timeSource?: "device" | "server";
  /** Curve arrays (torque-angle, weld current…), capped at the app layer. */
  waveforms?: Array<{ name: string; unit?: string; rateHz?: number; samples: Array<[number, number]> }>;
}

export interface RecordProcessResultOutput {
  processResultId: number;
  genealogy: { id: number; prevHash: string; currHash: string } | null;
  /** Doc 56 Đ1 — true ⇒ an idempotencyKey retry hit; the ORIGINAL row is returned. */
  duplicate?: boolean;
}

/**
 * Merge the legacy `metrics` record with the structured `metricSpecs`, flattening
 * each spec into scalar keys. Returns undefined when there is nothing to store.
 */
function buildMetricsRecord(
  input: RecordProcessResultInput,
): Record<string, number | string | boolean> | undefined {
  const base: Record<string, number | string | boolean> = { ...(input.metrics ?? {}) };
  for (const spec of input.metricSpecs ?? []) {
    if (!spec || typeof spec.name !== "string" || spec.name.length === 0) continue;
    base[spec.name] = spec.value;
    if (spec.unit != null) base[`${spec.name}__unit`] = spec.unit;
    if (spec.lsl != null) base[`${spec.name}__lsl`] = spec.lsl;
    if (spec.usl != null) base[`${spec.name}__usl`] = spec.usl;
    if (spec.nominal != null) base[`${spec.name}__nominal`] = spec.nominal;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Doc 56 Đ1 — CLAIM the idempotency ledger, INSERT the process_results row and
 * BACK-FILL the ledger id, ALL in ONE transaction. Same protocol/ordering as
 * db/inspection.ts createProductInspection: CLAIM FIRST so two concurrent retries
 * of one key serialise — the loser sees the winner's committed row and reports
 * duplicate. A crash mid-way rolls the claim back with the row, so a lost cycle
 * never leaves a poisoned key behind. Throws (→ transient → WAL buffers) when a
 * committed claim has no resultId, never invents an id.
 */
async function claimAndInsertProcessResult(
  row: InsertProcessResult,
  machineId: number,
  idempotencyKey: string,
  measuredAt: Date,
): Promise<{ id: number; duplicate: boolean }> {
  const dbi = await db.getDb();
  if (!dbi) throw new Error("Database not available");
  return dbi.transaction(async (tx) => {
    const claimed = await tx
      .insert(processIdempotencyKeys)
      .values({ machineId, idempotencyKey, measuredAt })
      .onConflictDoNothing()
      .returning({ machineId: processIdempotencyKeys.machineId });

    if (claimed.length === 0) {
      // Key already used by a COMMITTED submission → this is a retry.
      const prior = await tx
        .select({ resultId: processIdempotencyKeys.resultId })
        .from(processIdempotencyKeys)
        .where(and(
          eq(processIdempotencyKeys.machineId, machineId),
          eq(processIdempotencyKeys.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      const priorId = prior[0]?.resultId;
      if (priorId == null) {
        throw new Error(
          `recordProcessResult: idempotency key claimed but unresolved ` +
            `(machineId=${machineId}, idempotencyKey=${idempotencyKey})`,
        );
      }
      return { id: priorId, duplicate: true };
    }

    // We own the key → insert the row and point the claim at it.
    const [inserted] = await tx
      .insert(processResults)
      .values(row)
      .returning({ id: processResults.id });
    await tx
      .update(processIdempotencyKeys)
      .set({ resultId: inserted.id })
      .where(and(
        eq(processIdempotencyKeys.machineId, machineId),
        eq(processIdempotencyKeys.idempotencyKey, idempotencyKey),
      ));
    return { id: inserted.id, duplicate: false };
  });
}

export async function recordProcessResult(
  input: RecordProcessResultInput,
  userId: number | null,
): Promise<RecordProcessResultOutput> {
  const measuredAt = input.measuredAt ?? new Date();
  const metrics = buildMetricsRecord(input);

  const row: InsertProcessResult = {
    serialNumber: input.serialNumber,
    machineId: input.machineId,
    machineType: input.machineType ?? null,
    stepType: input.stepType,
    stationId: input.stationId ?? null,
    lineCode: input.lineCode ?? null,
    productionOrderCode: input.productionOrderCode ?? null,
    lotCode: input.lotCode ?? null,
    result: input.result,
    metrics: metrics ?? null,
    recipeRef: input.recipeRef ?? null,
    measuredAt,
    recordedBy: userId,
    // Doc 56 Đ1 (0288) provenance/durability — all nullable, OFF-safe.
    serverReceivedAt: input.serverReceivedAt ?? null,
    timeSource: input.timeSource ?? null,
    idempotencyKey: input.idempotencyKey?.trim() || null,
    waveforms: input.waveforms ?? null,
  };

  // ── Doc 56 Đ1 — exactly-once via the ledger (only when a key was sent) ───────
  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  let processResultId: number;
  let duplicate = false;
  if (idempotencyKey) {
    const claim = await claimAndInsertProcessResult(row, input.machineId, idempotencyKey, measuredAt);
    processResultId = claim.id;
    duplicate = claim.duplicate;
  } else {
    // No key → the exact pre-doc-56 path (plain insert, no transaction).
    processResultId = await db.insertProcessResult(row);
  }

  // A retry of an already-persisted cycle: the genealogy "station" event was
  // appended the first time; re-appending would fork/duplicate the tamper-evident
  // chain, so short-circuit before it (mirrors the inspection duplicate path).
  if (duplicate) {
    return { processResultId, genealogy: null, duplicate: true };
  }

  // Append a genealogy "station" event. Isolated so chain errors never lose the result.
  let genealogy: RecordProcessResultOutput["genealogy"] = null;
  try {
    const recordedAt = new Date();
    const eventInput: GenealogyInput = {
      serialNumber: input.serialNumber,
      eventType: "station",
      stationCode: input.stationId != null ? String(input.stationId) : null,
      lotCode: input.lotCode ?? null,
      payload: {
        kind: "processResult",
        processResultId,
        stepType: input.stepType,
        result: input.result,
        metrics: metrics ?? {},
      },
      recordedAt,
    };
    // G5.17 (0255) — trace id; null outside an ALS context. NOT hashed.
    const correlationId = getCorrelationId() ?? null;
    // R4 fork-fix: read-tail → compute currHash → insert ATOMICALLY (serialised
    // advisory lock inside appendGenealogyChainRow) so concurrent station events
    // cannot fork the tamper-evident hash-chain.
    const inserted = await db.appendGenealogyChainRow((prevHash) => ({
      prevHash,
      currHash: hashEntry(prevHash, eventInput),
      serialNumber: input.serialNumber,
      parentSerial: null,
      eventType: "station",
      stationCode: eventInput.stationCode ?? null,
      lotCode: input.lotCode ?? null,
      productModelId: null,
      payload: eventInput.payload as Record<string, any>,
      recordedBy: userId,
      recordedAt,
      // Conditional so pre-0255 databases keep working when no context is active.
      ...(correlationId ? { correlationId } : {}),
    }));
    genealogy = { id: inserted.id, prevHash: inserted.prevHash, currHash: inserted.currHash };
  } catch (err) {
    console.error(
      `[processResultService] genealogy append failed for processResult ${processResultId}:`,
      err,
    );
  }

  return { processResultId, genealogy, duplicate: false };
}
