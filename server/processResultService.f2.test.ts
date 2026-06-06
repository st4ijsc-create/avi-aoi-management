/**
 * Sprint F2 — processResultService + zod contract tests.
 *
 * The service is exercised against a mocked `../db` so it runs without Postgres.
 * We assert it persists ONE process result and appends ONE genealogy row with
 * event type "station" + payload.kind "processResult", and that the resulting
 * single-row chain verifies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { MACHINE_TYPES } from "./constants/machineTypes";
import { GENESIS_HASH, verifyChain, type ChainRow } from "./utils/genealogyChain";

// ── Mock the DB barrel used by the service ──────────────────────────────────
const genealogyRows: any[] = [];
let nextProcessResultId = 100;

vi.mock("./db", () => ({
  insertProcessResult: vi.fn(async (_row: any) => nextProcessResultId++),
  getLastGenealogyHash: vi.fn(async () => {
    const last = genealogyRows[genealogyRows.length - 1];
    return last ? last.currHash : null;
  }),
  insertGenealogyChainRow: vi.fn(async (row: any) => {
    const inserted = { id: genealogyRows.length + 1, ...row };
    genealogyRows.push(inserted);
    return { id: inserted.id, currHash: inserted.currHash };
  }),
}));

import { recordProcessResult } from "./services/processResultService";
import * as db from "./db";

beforeEach(() => {
  genealogyRows.length = 0;
  nextProcessResultId = 100;
  vi.clearAllMocks();
});

describe("F2 — recordProcessResult", () => {
  it("inserts 1 process result + 1 genealogy 'station' row; chain verifies", async () => {
    const out = await recordProcessResult(
      {
        serialNumber: "SN-F2-001",
        machineId: 42,
        machineType: "SCREWDRIVE",
        stepType: "torque_check",
        result: "pass",
        stationId: 7,
        lotCode: "LOT-9",
        metrics: { torqueNm: 1.2, ok: true },
      },
      55,
    );

    expect(db.insertProcessResult).toHaveBeenCalledTimes(1);
    expect(db.insertGenealogyChainRow).toHaveBeenCalledTimes(1);
    expect(out.processResultId).toBe(100);
    expect(out.genealogy).not.toBeNull();

    expect(genealogyRows).toHaveLength(1);
    const row = genealogyRows[0];
    expect(row.eventType).toBe("station");
    expect(row.prevHash).toBe(GENESIS_HASH);
    expect(row.payload.kind).toBe("processResult");
    expect(row.payload.processResultId).toBe(100);
    expect(row.payload.result).toBe("pass");
    expect(row.recordedBy).toBe(55);

    const chain: ChainRow[] = genealogyRows.map((r) => ({
      id: r.id,
      prevHash: r.prevHash,
      currHash: r.currHash,
      serialNumber: r.serialNumber,
      parentSerial: r.parentSerial ?? null,
      eventType: r.eventType,
      stationCode: r.stationCode ?? null,
      lotCode: r.lotCode ?? null,
      productModelId: r.productModelId ?? null,
      payload: r.payload,
      recordedBy: r.recordedBy ?? null,
      recordedAt: r.recordedAt,
    }));
    expect(verifyChain(chain).ok).toBe(true);
  });

  it("keeps the process result even if genealogy append throws", async () => {
    (db.insertGenealogyChainRow as any).mockRejectedValueOnce(new Error("chain down"));
    const out = await recordProcessResult(
      { serialNumber: "SN-F2-002", machineId: 1, stepType: "x", result: "fail" },
      null,
    );
    expect(out.processResultId).toBe(100);
    expect(out.genealogy).toBeNull();
  });
});

describe("F2 — zod machineType contract (z.enum(MACHINE_TYPES))", () => {
  const schema = z.enum(MACHINE_TYPES);

  it("accepts FEEDER / DISPENSING / ROBOT and legacy AVI / AOI", () => {
    for (const v of ["FEEDER", "DISPENSING", "ROBOT", "AVI", "AOI"]) {
      expect(schema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects an unknown type 'FOO'", () => {
    expect(schema.safeParse("FOO").success).toBe(false);
  });
});
