/**
 * Doc 51 P2 batch-2 (§12.2 #2) — VERSION-EXACT spec-gate WIRING in submitInspection.
 *
 * The pure pick lives in pointResultEvaluator.versionGate.test.ts. This proves the
 * ROUTER path: under SPEC_GATE_SNAPSHOT_ENABLED, for a STALE board, loadPointLimitSnapshots
 * reads measurement_point_versions.productPointsConfigVersion (0282) and gates by the
 * limits at the DECLARED version — provably NOT by the instant proxy nor by live.
 *
 * Mutation-test: it goes RED if the wiring drops the declared version, ignores the
 * stamp column, or reverts to the instant/live path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Stamped edit-history rows the fake db returns for loadPointLimitSnapshots.
let snapshotRows: Array<{ changedAt: Date; snapshotJson: Record<string, unknown>; productPointsConfigVersion: number | null }> = [];
const capturedMeasurementInserts: Array<Record<string, unknown>[]> = [];

vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ url: `/uploads/${key}`, key })),
  storageGet: vi.fn(async () => ({ key: "", url: "" })),
  storageDelete: vi.fn(async () => ({ deleted: true })),
  resolveImageToDataUrl: vi.fn(async () => ""),
}));

vi.mock("../db", () => {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({
        values: async (vals: Record<string, unknown>[]) => {
          capturedMeasurementInserts.push(Array.isArray(vals) ? vals : [vals]);
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
  );
  const fakeDb = {
    // loadPointLimitSnapshots: select(projection).from().where().orderBy() → snapshotRows
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => snapshotRows,
          limit: async () => [],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
    execute: async () => undefined,
  };
  return {
    getDb: vi.fn(async () => fakeDb),
    // 0282 column is present in this scenario.
    measurementPointVersionsHasConfigVersionColumn: vi.fn(async () => true),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(async () => undefined),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    createProductInspection: vi.fn(async () => 4242),
    getMachineStats: vi.fn(async () => ({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 })),
    // ⚠ 2026-08-18 — CHUỖI PHÂN CẤP PHẢI PHÂN GIẢI ĐƯỢC. Đường ingest nay SUY mã tenant từ máy
    // (`phamViGhiMay.macTenantChoGhi`) và TỪ CHỐI một máy không ra được nhà máy. Bốn stub cũ trả
    // `undefined` mô tả một cái máy KHÔNG THUỘC NHÀ MÁY NÀO — trạng thái mà lược đồ KHÔNG cho
    // phép tồn tại (`machines.stationId` NOT NULL + ba FK `ON DELETE RESTRICT`), nên stub cũ là
    // một lời khai SAI VỀ THẾ GIỚI, không phải một lối tắt vô hại.
    getStationById: vi.fn(async () => ({ id: 1, code: "ST-MOCK", lineId: 1 })),
    getLineById: vi.fn(async () => ({ id: 1, code: "LINE-MOCK", workshopId: 1 })),
    getWorkshopById: vi.fn(async () => ({ id: 1, code: "WS-MOCK", factoryId: 1 })),
    getFactoryById: vi.fn(async () => ({ id: 1, code: "FAC-MOCK", corporateCode: "CORP-MOCK" })),
    getDefectCatalogByCode: vi.fn(async () => undefined),
    recordUnmatchedDefectCodes: vi.fn(async () => undefined),
    getMeasurementPointDefByCode: vi.fn(async () => undefined),
    getMeasurementPointDefByMachineAndCode: vi.fn(async () => undefined),
  };
});

vi.mock("../_core/socket", () => ({
  emitNGAlert: vi.fn(), emitYieldWarning: vi.fn(), emitDashboardUpdate: vi.fn(),
}));
vi.mock("../services/mqttService", () => ({
  publishNGAlert: vi.fn(async () => undefined),
  publishPointsConfigChanged: vi.fn(async () => undefined),
}));
vi.mock("../services/integration/outboxProducers", () => ({ publishToOutbox: vi.fn() }));

import { machineApiRouter, _resetGateConfigVersionProbe } from "./machineApiRouters";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI", stationId: 1, isActive: true };

function ctx(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] } as TrpcContext;
}

function payload(over: Record<string, unknown> = {}) {
  return { apiKey: "SHARED-KEY", serialNumber: "SN-V", overallResult: "OK" as const, productModel: "PM-1", measurements: [] as Record<string, unknown>[], ...over };
}

function lastRows(): Record<string, unknown>[] {
  return capturedMeasurementInserts[capturedMeasurementInserts.length - 1] ?? [];
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
  delete process.env.POINT_LIMIT_EVAL_ENABLED; // default ON
  delete process.env.AI_INLINE_GATE_ENABLED;
  snapshotRows = [];
  capturedMeasurementInserts.length = 0;
  _resetGateConfigVersionProbe();
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.measurementPointVersionsHasConfigVersionColumn as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 });
});

describe("QĐ#2 version-exact — router wiring (0282)", () => {
  // live upperLimit=10; product at v9; board declares v5 (stale). measured 12.
  const DEF = { id: 42, code: "P1", upperLimit: "10" };
  const measured = [{ pointCode: "P1", result: "OK" as const, measuredValue: 12 }];

  it("★ declared v5 → gates by the v5 STAMP (upperLimit 50 → OK), NOT by instant (11→NG) NOR live (10→NG)", async () => {
    (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    (db.getMeasurementPointDefByCode as ReturnType<typeof vi.fn>).mockResolvedValue(DEF);
    // Two stamped snapshots. The v5 snapshot (limits 50) has a PAST changedAt; the
    // v7 snapshot (limits 11) has a FUTURE changedAt → the instant pick would take
    // the future one (11) and downgrade 12→NG. The version pick takes v5's 50 → OK.
    snapshotRows = [
      { changedAt: new Date(Date.now() - 3_600_000), snapshotJson: { upperLimit: "50" }, productPointsConfigVersion: 5 },
      { changedAt: new Date(Date.now() + 3_600_000), snapshotJson: { upperLimit: "11" }, productPointsConfigVersion: 7 },
    ];
    await machineApiRouter.createCaller(ctx()).submitInspection(payload({ pointsConfigVersion: 4 + 1, measurements: measured }));
    // pointsConfigVersion 5 (declared) < live 9 → stale → version-exact gate.
    expect(lastRows()[0].result).toBe("OK");
  });

  it("★ declared v8 (unchanged since — all stamps < 8) → gated by LIVE (10 → 12 NG)", async () => {
    (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    (db.getMeasurementPointDefByCode as ReturnType<typeof vi.fn>).mockResolvedValue(DEF);
    snapshotRows = [
      { changedAt: new Date(Date.now() - 7_200_000), snapshotJson: { upperLimit: "50" }, productPointsConfigVersion: 5 },
      { changedAt: new Date(Date.now() - 3_600_000), snapshotJson: { upperLimit: "20" }, productPointsConfigVersion: 7 },
    ];
    // declared v8 — no stamp >= 8 → point unchanged since v8 → live 10 gates 12 → NG.
    await machineApiRouter.createCaller(ctx()).submitInspection(payload({ pointsConfigVersion: 8, measurements: measured }));
    expect(lastRows()[0].result).toBe("NG");
  });

  it("★ unstamped legacy rows (0282 absent) → falls back to INSTANT path, no crash", async () => {
    (db.measurementPointVersionsHasConfigVersionColumn as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    (db.getMeasurementPointDefByCode as ReturnType<typeof vi.fn>).mockResolvedValue(DEF);
    // No stamp; a single snapshot with a FUTURE changedAt (upperLimit 15) → instant
    // path gates 12 ≤ 15 → OK (proves the fallback still works, P1 behaviour intact).
    snapshotRows = [{ changedAt: new Date(Date.now() + 3_600_000), snapshotJson: { upperLimit: "15" }, productPointsConfigVersion: null }];
    await machineApiRouter.createCaller(ctx()).submitInspection(payload({ pointsConfigVersion: 4, measurements: measured }));
    expect(lastRows()[0].result).toBe("OK");
  });
});
