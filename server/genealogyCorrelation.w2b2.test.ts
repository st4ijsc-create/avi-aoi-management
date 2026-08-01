/**
 * doc 44 W2-B2 (G5.17) — genealogy write points stamp the ALS correlation id.
 *
 * Against a mocked `../db` (pattern: processResultService.f2.test.ts /
 * componentInstallationService.g2_4.test.ts):
 *   • recordProcessResult / recordComponentInstallation inside withCorrelation(...)
 *     → the inserted genealogy row carries correlationId
 *   • outside any correlation context → the key is NOT sent at all (conditional spread —
 *     pre-0255 databases keep working)
 *   • a chain mixing rows with/without correlationId still verifies (hash excludes it)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyChain, type ChainRow } from "./utils/genealogyChain";
import { withCorrelation } from "./services/observability/correlation";

const genealogyRows: any[] = [];
let nextProcessResultId = 100;
let nextInstallId = 500;

vi.mock("./db", () => ({
  // processResultService
  insertProcessResult: vi.fn(async () => nextProcessResultId++),
  // componentInstallationService
  insertComponentInstallation: vi.fn(async () => nextInstallId++),
  updateComponentInstallationGenealogyHash: vi.fn(async () => {}),
  consumeFeederMaterial: vi.fn(async () => ({ found: false, remaining: 0, reorderFlag: false, status: null })),
  consumeSupplierLot: vi.fn(async () => ({ found: false, remaining: 0, status: null })),
  // shared genealogy ledger
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

vi.mock("./services/andon/andonService", () => ({ raiseAndon: vi.fn(async () => ({ id: 1 })) }));

import { recordProcessResult } from "./services/processResultService";
import { recordComponentInstallation } from "./services/componentInstallationService";
import * as db from "./db";

beforeEach(() => {
  genealogyRows.length = 0;
  nextProcessResultId = 100;
  nextInstallId = 500;
  vi.clearAllMocks();
  delete process.env.MES_BOM_ENABLED;
});

function toChain(): ChainRow[] {
  return genealogyRows.map((r) => ({
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
    correlationId: r.correlationId ?? null,
  }));
}

describe("G5.17 — processResultService correlation stamping", () => {
  it("inside withCorrelation → genealogy row carries the correlation id", async () => {
    await withCorrelation({ correlationId: "corr-PR-1" }, async () =>
      recordProcessResult(
        { serialNumber: "SN-1", machineId: 42, stepType: "torque", result: "pass" },
        55,
      ),
    );
    expect(db.insertGenealogyChainRow).toHaveBeenCalledTimes(1);
    expect(genealogyRows[0].correlationId).toBe("corr-PR-1");
  });

  it("outside any correlation context → correlationId key is NOT sent (pre-0255 safe)", async () => {
    await recordProcessResult({ serialNumber: "SN-2", machineId: 1, stepType: "x", result: "fail" }, null);
    expect(genealogyRows).toHaveLength(1);
    expect("correlationId" in genealogyRows[0]).toBe(false);
  });
});

describe("G5.17 — componentInstallationService correlation stamping", () => {
  it("inside withCorrelation → genealogy 'merge' row carries the correlation id", async () => {
    await withCorrelation({ correlationId: "corr-CI-1" }, async () =>
      recordComponentInstallation(
        { serialNumber: "BOARD-1", componentCode: "R-100", componentSerial: "COMP-9", qty: 1 },
        55,
      ),
    );
    expect(genealogyRows).toHaveLength(1);
    expect(genealogyRows[0].eventType).toBe("merge");
    expect(genealogyRows[0].correlationId).toBe("corr-CI-1");
  });

  it("outside any correlation context → correlationId key is NOT sent", async () => {
    await recordComponentInstallation({ serialNumber: "BOARD-2", componentCode: "C-1" }, null);
    expect("correlationId" in genealogyRows[0]).toBe(false);
  });
});

describe("G5.17 — the mixed chain still verifies (correlation is OUTSIDE the hash)", () => {
  it("row without correlation + row with correlation chain-verify together", async () => {
    await recordProcessResult({ serialNumber: "SN-A", machineId: 1, stepType: "s", result: "pass" }, 1);
    await withCorrelation({ correlationId: "corr-mix" }, async () =>
      recordProcessResult({ serialNumber: "SN-A", machineId: 1, stepType: "s2", result: "pass" }, 1),
    );
    expect(genealogyRows).toHaveLength(2);
    expect(genealogyRows[0].correlationId ?? null).toBeNull();
    expect(genealogyRows[1].correlationId).toBe("corr-mix");
    expect(genealogyRows[1].prevHash).toBe(genealogyRows[0].currHash); // truly chained
    const res = verifyChain(toChain());
    expect(res.ok).toBe(true);
    expect(res.total).toBe(2);
  });
});
