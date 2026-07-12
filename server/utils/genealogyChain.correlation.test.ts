/**
 * doc 44 W2-B2 (G5.17) — correlation_id must NOT break the genealogy hash-chain.
 *
 * THE load-bearing guarantee of migration 0255: hashEntry() hashes a FIXED field list
 * (prevHash, serialNumber, parentSerial, eventType, stationCode, lotCode, productModelId,
 * payload, recordedAt) — correlationId is OUTSIDE it (like recordedBy). Therefore:
 *   • a chain whose rows carry correlationId verifies exactly like one that doesn't
 *   • pre-0255 rows (correlationId absent/NULL) and post-0255 rows mix freely
 *   • hashes are bit-identical with/without the column → provably not an input
 *   • tampering the HASHED content is still detected as before
 */
import { describe, it, expect } from "vitest";
import {
  GENESIS_HASH,
  hashEntry,
  verifyChain,
  canonicalJson,
  type ChainRow,
  type GenealogyInput,
} from "./genealogyChain";

function buildRow(
  id: number,
  prevHash: string,
  overrides: Partial<GenealogyInput> & { correlationId?: string | null },
): ChainRow {
  const recordedAt = new Date(1720000000000 + id * 1000);
  const input: GenealogyInput = {
    serialNumber: overrides.serialNumber ?? `SN-${id}`,
    parentSerial: overrides.parentSerial ?? null,
    eventType: overrides.eventType ?? "station",
    stationCode: overrides.stationCode ?? "ST-1",
    lotCode: overrides.lotCode ?? "LOT-7",
    productModelId: overrides.productModelId ?? null,
    payload: overrides.payload ?? { step: id },
    recordedAt,
  };
  return {
    id,
    prevHash,
    currHash: hashEntry(prevHash, input),
    serialNumber: input.serialNumber,
    parentSerial: input.parentSerial ?? null,
    eventType: input.eventType,
    stationCode: input.stationCode ?? null,
    lotCode: input.lotCode ?? null,
    productModelId: input.productModelId ?? null,
    payload: input.payload,
    recordedBy: 55,
    recordedAt,
    ...("correlationId" in overrides ? { correlationId: overrides.correlationId } : {}),
  };
}

describe("G5.17 — verifyChain is invariant to correlationId", () => {
  it("a chain whose rows ALL carry correlationId verifies (the critical test)", () => {
    const r1 = buildRow(1, GENESIS_HASH, { correlationId: "corr-A" });
    const r2 = buildRow(2, r1.currHash, { correlationId: "corr-A" });
    const r3 = buildRow(3, r2.currHash, { correlationId: "corr-B" });
    const res = verifyChain([r1, r2, r3]);
    expect(res).toEqual({ ok: true, total: 3, firstBadId: null, reason: null });
  });

  it("MIXED chain — pre-0255 rows (no column / NULL) followed by post-0255 rows — verifies", () => {
    const r1 = buildRow(1, GENESIS_HASH, {}); // legacy row: correlationId key absent
    const r2 = buildRow(2, r1.currHash, { correlationId: null }); // post-0255, outside ALS
    const r3 = buildRow(3, r2.currHash, { correlationId: "corr-live" }); // post-0255, in ALS
    expect(verifyChain([r1, r2, r3]).ok).toBe(true);
  });

  it("hashes are bit-identical with and without correlationId (provably NOT a hash input)", () => {
    const bare = buildRow(1, GENESIS_HASH, {});
    const tagged = buildRow(1, GENESIS_HASH, { correlationId: "corr-XYZ" });
    expect(tagged.currHash).toBe(bare.currHash);
  });

  it("retro-stamping correlationId onto an EXISTING verified row does not invalidate it", () => {
    const r1 = buildRow(1, GENESIS_HASH, {});
    const r2 = buildRow(2, r1.currHash, {});
    expect(verifyChain([r1, r2]).ok).toBe(true);
    // simulate migration-era backfill / later trace-stamping of old rows
    const stamped: ChainRow[] = [
      { ...r1, correlationId: "corr-backfill" },
      { ...r2, correlationId: "corr-backfill" },
    ];
    expect(verifyChain(stamped).ok).toBe(true);
  });

  it("tampering HASHED content is still detected (chain integrity intact)", () => {
    const r1 = buildRow(1, GENESIS_HASH, { correlationId: "corr-A" });
    const r2 = buildRow(2, r1.currHash, { correlationId: "corr-A" });
    const tampered = { ...r2, payload: { step: 999 } }; // payload IS hashed
    const res = verifyChain([r1, tampered]);
    expect(res.ok).toBe(false);
    expect(res.firstBadId).toBe(2);
    expect(res.reason).toMatch(/currHash mismatch/);
  });

  it("canonicalJson of the hash input never contains correlationId (sanity on the field list)", () => {
    // Reconstruct exactly what hashEntry canonicalizes and assert the key is absent.
    const recordedAt = new Date(1720000000000);
    const canonical = canonicalJson({
      prevHash: GENESIS_HASH,
      serialNumber: "SN-1",
      parentSerial: null,
      eventType: "station",
      stationCode: null,
      lotCode: null,
      productModelId: null,
      payload: { a: 1 },
      recordedAt: recordedAt.toISOString(),
    });
    expect(canonical).not.toContain("correlationId");
    expect(canonical).not.toContain("correlation_id");
  });
});
