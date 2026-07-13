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
 */
import * as db from "../db";
import {
  hashEntry,
  type GenealogyInput,
} from "../utils/genealogyChain";
// doc 44 W2-B2 (G5.17) — stamp the ALS correlation id on the genealogy row (trace
// metadata, OUTSIDE the hash input → verifyChain unaffected).
import { getCorrelationId } from "./observability/correlation";
import type { InsertProcessResult } from "../../drizzle/schema";
import type { MachineType } from "../constants/machineTypes";

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
  metrics?: Record<string, number | string | boolean>;
  recipeRef?: string;
  measuredAt?: Date;
}

export interface RecordProcessResultOutput {
  processResultId: number;
  genealogy: { id: number; prevHash: string; currHash: string } | null;
}

export async function recordProcessResult(
  input: RecordProcessResultInput,
  userId: number | null,
): Promise<RecordProcessResultOutput> {
  const measuredAt = input.measuredAt ?? new Date();

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
    metrics: input.metrics ?? null,
    recipeRef: input.recipeRef ?? null,
    measuredAt,
    recordedBy: userId,
  };

  const processResultId = await db.insertProcessResult(row);

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
        metrics: input.metrics ?? {},
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

  return { processResultId, genealogy };
}
