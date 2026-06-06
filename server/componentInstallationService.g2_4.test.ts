/**
 * Sprint G2.4 — componentInstallationService tests.
 *
 * Exercised against a mocked `../db` so it runs without Postgres. Asserts:
 *  - 1 installation row + 1 genealogy "merge" row with payload.kind=
 *    "componentInstallation"; single-row chain verifies.
 *  - failure isolation: genealogy append throwing → installation still kept,
 *    genealogyHash null, output.genealogy null.
 *  - stock decrement clamps ≥0 for feeder + supplier lot.
 *  - reorder → raiseAndon only when MES_BOM_ENABLED=true (idempotent signal).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GENESIS_HASH, verifyChain, type ChainRow } from "./utils/genealogyChain";

const genealogyRows: any[] = [];
let nextInstallId = 500;
let feederState = { qty: 10, reorderLevel: 2, found: true };
let lotState = { remaining: 5, found: true };
let lastInstallGenealogyHash: string | null = null;

const raiseAndonMock = vi.fn(async (_input: any, _actor: any) => ({ id: 1 }));

vi.mock("./db", () => ({
  insertComponentInstallation: vi.fn(async (_row: any) => nextInstallId++),
  updateComponentInstallationGenealogyHash: vi.fn(async (_id: number, hash: string | null) => {
    lastInstallGenealogyHash = hash;
  }),
  consumeFeederMaterial: vi.fn(async (_id: number, qty: number) => {
    if (!feederState.found) return { found: false, remaining: 0, reorderFlag: false, status: null };
    const remaining = Math.max(0, feederState.qty - Math.max(0, qty));
    feederState.qty = remaining;
    return { found: true, remaining, reorderFlag: remaining <= feederState.reorderLevel, status: remaining <= 0 ? "depleted" : "active" };
  }),
  consumeSupplierLot: vi.fn(async (_id: number, qty: number) => {
    if (!lotState.found) return { found: false, remaining: 0, status: null };
    const remaining = Math.max(0, lotState.remaining - Math.max(0, qty));
    lotState.remaining = remaining;
    return { found: true, remaining, status: remaining <= 0 ? "consumed" : "received" };
  }),
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

vi.mock("./services/andon/andonService", () => ({
  raiseAndon: (...args: any[]) => raiseAndonMock(args[0], args[1]),
}));

import { recordComponentInstallation } from "./services/componentInstallationService";
import * as db from "./db";

beforeEach(() => {
  genealogyRows.length = 0;
  nextInstallId = 500;
  feederState = { qty: 10, reorderLevel: 2, found: true };
  lotState = { remaining: 5, found: true };
  lastInstallGenealogyHash = null;
  raiseAndonMock.mockClear();
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
  }));
}

describe("G2.4 — recordComponentInstallation", () => {
  it("inserts 1 install + 1 genealogy 'merge' row (payload.kind=componentInstallation); chain verifies", async () => {
    const out = await recordComponentInstallation(
      {
        serialNumber: "BOARD-1",
        componentCode: "R-100",
        componentSerial: "COMP-9",
        supplierLotId: 7,
        feederMaterialId: 3,
        machineId: 12,
        qty: 1,
        refDesignator: "R1",
        lotCode: "LOT-BOARD-1",
      },
      55,
    );

    expect(db.insertComponentInstallation).toHaveBeenCalledTimes(1);
    expect(db.insertGenealogyChainRow).toHaveBeenCalledTimes(1);
    expect(out.installationId).toBe(500);
    expect(out.genealogy).not.toBeNull();

    const row = genealogyRows[0];
    expect(row.eventType).toBe("merge");
    expect(row.prevHash).toBe(GENESIS_HASH);
    expect(row.parentSerial).toBe("COMP-9");
    expect(row.payload.kind).toBe("componentInstallation");
    expect(row.payload.installationId).toBe(500);
    expect(row.payload.componentCode).toBe("R-100");

    expect(lastInstallGenealogyHash).toBe(row.currHash);
    expect(verifyChain(toChain()).ok).toBe(true);
  });

  it("keeps the install even if genealogy append throws (hash null)", async () => {
    (db.insertGenealogyChainRow as any).mockRejectedValueOnce(new Error("chain down"));
    const out = await recordComponentInstallation(
      { serialNumber: "BOARD-2", componentCode: "C-1" },
      null,
    );
    expect(out.installationId).toBe(500);
    expect(out.genealogy).toBeNull();
    expect(lastInstallGenealogyHash).toBeNull();
  });

  it("decrements feeder + supplier lot, clamped at ≥0", async () => {
    feederState = { qty: 1, reorderLevel: 0, found: true };
    lotState = { remaining: 1, found: true };
    const out = await recordComponentInstallation(
      { serialNumber: "BOARD-3", componentCode: "C-1", feederMaterialId: 3, supplierLotId: 7, qty: 5 },
      1,
    );
    expect(out.feederRemaining).toBe(0);
    expect(out.supplierLotRemaining).toBe(0);
  });

  it("reorder → raiseAndon ONLY when MES_BOM_ENABLED=true", async () => {
    feederState = { qty: 1, reorderLevel: 5, found: true }; // remaining 0 ≤ 5 → reorder

    // flag off: no andon
    await recordComponentInstallation(
      { serialNumber: "BOARD-4", componentCode: "C-1", feederMaterialId: 3, qty: 1 },
      1,
    );
    expect(raiseAndonMock).not.toHaveBeenCalled();

    // flag on: andon raised, reason 'material', system-raised
    feederState = { qty: 1, reorderLevel: 5, found: true };
    process.env.MES_BOM_ENABLED = "true";
    const out = await recordComponentInstallation(
      { serialNumber: "BOARD-5", componentCode: "C-1", feederMaterialId: 3, machineId: 12, qty: 1 },
      1,
    );
    expect(out.reorderTriggered).toBe(true);
    expect(raiseAndonMock).toHaveBeenCalledTimes(1);
    expect(raiseAndonMock.mock.calls[0][0]).toMatchObject({ reason: "material", raisedBySystem: true, machineId: 12 });
  });

  it("a merge install on top of a prior born event still verifies (mixed event types)", async () => {
    // seed a prior 'born' row
    genealogyRows.push({
      id: 1,
      prevHash: GENESIS_HASH,
      currHash: (await import("./utils/genealogyChain")).hashEntry(GENESIS_HASH, {
        serialNumber: "BOARD-6",
        eventType: "born",
        payload: { kind: "born" },
        recordedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      serialNumber: "BOARD-6",
      parentSerial: null,
      eventType: "born",
      stationCode: null,
      lotCode: null,
      productModelId: null,
      payload: { kind: "born" },
      recordedBy: null,
      recordedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await recordComponentInstallation(
      { serialNumber: "BOARD-6", componentCode: "C-1", componentSerial: "X-1" },
      1,
    );
    expect(genealogyRows).toHaveLength(2);
    expect(verifyChain(toChain()).ok).toBe(true);
  });
});
