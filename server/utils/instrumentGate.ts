/**
 * P4.B G19 — Hard gate ensuring an instrument is fit-for-use before being
 * referenced in inspection workflows.
 *
 * An instrument is "ready" iff:
 *   • The instrument row exists, isActive = true, deletedAt IS NULL.
 *   • There is at least one calibration certificate whose validUntil is in
 *     the future AND result IN ('pass','conditional').
 *   • There is at least one MSA record whose validUntil is in the future
 *     AND verdict IN ('good','acceptable').
 *
 * `assertInstrumentReady` throws TRPCError({code:'FORBIDDEN'}) on failure.
 * `checkInstrumentReady` returns a structured report without throwing.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  measurementInstruments,
  instrumentCalibrations,
  instrumentMsaRecords,
} from "../../drizzle/schema/product";

export interface InstrumentReadinessReport {
  ready: boolean;
  instrumentId: number;
  reasons: string[];
  calibration?: {
    id: number;
    validUntil: Date;
    result: string;
  };
  msa?: {
    id: number;
    validUntil: Date;
    verdict: string;
  };
}

export async function checkInstrumentReady(instrumentId: number): Promise<InstrumentReadinessReport> {
  const reasons: string[] = [];
  const report: InstrumentReadinessReport = {
    ready: false,
    instrumentId,
    reasons,
  };

  const db = await getDb();
  if (!db) {
    reasons.push("Database unavailable");
    return report;
  }

  const [instr] = await db
    .select()
    .from(measurementInstruments)
    .where(eq(measurementInstruments.id, instrumentId))
    .limit(1);
  if (!instr) {
    reasons.push(`Instrument ${instrumentId} not found`);
    return report;
  }
  if (instr.deletedAt) reasons.push("Instrument is deleted");
  if (!instr.isActive) reasons.push("Instrument is inactive");

  const now = new Date();

  const [cal] = await db
    .select()
    .from(instrumentCalibrations)
    .where(and(
      eq(instrumentCalibrations.instrumentId, instrumentId),
      isNull(instrumentCalibrations.deletedAt),
      gt(instrumentCalibrations.validUntil, now),
      inArray(instrumentCalibrations.result, ["pass", "conditional"]),
    ))
    .orderBy(desc(instrumentCalibrations.validUntil))
    .limit(1);
  if (!cal) {
    reasons.push("No valid calibration certificate (must be in-date and result pass/conditional)");
  } else {
    report.calibration = { id: cal.id, validUntil: cal.validUntil, result: cal.result };
  }

  const [msa] = await db
    .select()
    .from(instrumentMsaRecords)
    .where(and(
      eq(instrumentMsaRecords.instrumentId, instrumentId),
      isNull(instrumentMsaRecords.deletedAt),
      gt(instrumentMsaRecords.validUntil, now),
      inArray(instrumentMsaRecords.verdict, ["good", "acceptable"]),
    ))
    .orderBy(desc(instrumentMsaRecords.validUntil))
    .limit(1);
  if (!msa) {
    reasons.push("No valid MSA record (must be in-date and verdict good/acceptable)");
  } else {
    report.msa = { id: msa.id, validUntil: msa.validUntil, verdict: msa.verdict };
  }

  report.ready = reasons.length === 0;
  return report;
}

export async function assertInstrumentReady(instrumentId: number): Promise<InstrumentReadinessReport> {
  const report = await checkInstrumentReady(instrumentId);
  if (!report.ready) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Instrument ${instrumentId} is not fit-for-use: ${report.reasons.join("; ")}`,
    });
  }
  return report;
}
