/**
 * P4.C G11 — Genealogy hash-chain utilities.
 *
 * Tamper-evident append-only ledger. Each entry stores the SHA-256 of the
 * canonical JSON of the previous entry plus the current payload. Verifying
 * the chain is a single linear scan recomputing each hash.
 */
import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export type GenealogyEventType =
  | "born"
  | "station"
  | "merge"
  | "split"
  | "rework"
  | "scrap"
  | "ship"
  | "custom";

export interface GenealogyInput {
  serialNumber: string;
  parentSerial?: string | null;
  eventType: GenealogyEventType | string;
  stationCode?: string | null;
  lotCode?: string | null;
  productModelId?: number | null;
  payload: Record<string, any>;
  recordedBy?: number | null;
  recordedAt?: Date;
}

/**
 * Stable JSON: keys are sorted recursively so the produced string is
 * deterministic regardless of insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function hashEntry(prevHash: string, input: GenealogyInput): string {
  const canonical = canonicalJson({
    prevHash,
    serialNumber: input.serialNumber,
    parentSerial: input.parentSerial ?? null,
    eventType: input.eventType,
    stationCode: input.stationCode ?? null,
    lotCode: input.lotCode ?? null,
    productModelId: input.productModelId ?? null,
    payload: input.payload,
    recordedAt: (input.recordedAt ?? new Date()).toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ChainRow {
  id: number;
  prevHash: string;
  currHash: string;
  serialNumber: string;
  parentSerial: string | null;
  eventType: string;
  stationCode: string | null;
  lotCode: string | null;
  productModelId: number | null;
  payload: Record<string, any>;
  recordedBy: number | null;
  recordedAt: Date;
}

export interface VerifyResult {
  ok: boolean;
  total: number;
  firstBadId: number | null;
  reason: string | null;
}

/**
 * Verify that for every row n: hashEntry(rows[n-1].currHash, rows[n]) === rows[n].currHash
 * and rows[0].prevHash === GENESIS_HASH.
 *
 * Rows MUST be ordered by id ascending.
 */
export function verifyChain(rows: ChainRow[]): VerifyResult {
  if (rows.length === 0) {
    return { ok: true, total: 0, firstBadId: null, reason: null };
  }
  let prev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return {
        ok: false,
        total: rows.length,
        firstBadId: row.id,
        reason: `prevHash mismatch at id=${row.id}: expected ${prev}, got ${row.prevHash}`,
      };
    }
    const expected = hashEntry(prev, {
      serialNumber: row.serialNumber,
      parentSerial: row.parentSerial,
      eventType: row.eventType,
      stationCode: row.stationCode,
      lotCode: row.lotCode,
      productModelId: row.productModelId,
      payload: row.payload,
      recordedAt: row.recordedAt,
    });
    if (expected !== row.currHash) {
      return {
        ok: false,
        total: rows.length,
        firstBadId: row.id,
        reason: `currHash mismatch at id=${row.id}: expected ${expected}, got ${row.currHash}`,
      };
    }
    prev = row.currHash;
  }
  return { ok: true, total: rows.length, firstBadId: null, reason: null };
}
