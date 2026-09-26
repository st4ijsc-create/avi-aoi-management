/**
 * Doc 55 Item 3 (Task 1) — submitInspection SPEC-GATE with VARIANT OVERRIDES (QĐ#11).
 *
 * A board that carries a NON-BASE variant must be graded against that variant's
 * effective limits, not the base point's raw limits:
 *   • a base point the variant OVERRIDES  → gated by the PATCHED limit (patchJson).
 *   • a base point the variant EXCLUDES    → NOT gated at all (machine verdict stands).
 *   • flag OFF / base board                → gated by the base limit (byte-identical).
 *
 * The override map is loaded ONCE per board (getVariantOverrides), so this also guards
 * the hot-path "load once, not N+1" contract by asserting a single call.
 *
 * Mirrors machineApiSnapshotGate.test.ts: measurement rows are captured from the
 * transaction insert so the persisted `result` can be asserted directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let capturedMeasurementInserts: Record<string, unknown>[][] = [];

vi.mock("../storage", () => ({
  storagePut: vi.fn(async () => ({ url: "/uploads/x", key: "k" })),
  storageGet: vi.fn(async () => null),
  storageDelete: vi.fn(async () => undefined),
  resolveImageToDataUrl: vi.fn(async () => null),
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
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: async () => [], limit: async () => [] }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
    execute: async () => undefined,
  };
  return {
    getDb: vi.fn(async () => fakeDb),
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
    // ── variant surface ──
    getVariantByCode: vi.fn(async () => undefined),
    getBaseVariant: vi.fn(async () => undefined),
    getVariantsByModel: vi.fn(async () => [] as any[]),
    getVariantOverrides: vi.fn(async () => [] as any[]),
    resolveEffectivePoints: vi.fn(async () => [] as any[]),
    createProductSyncLog: vi.fn(async () => undefined),
  };
});

vi.mock("../_core/socket", () => ({
  emitNGAlert: vi.fn(),
  emitYieldWarning: vi.fn(),
  emitDashboardUpdate: vi.fn(),
}));
vi.mock("../services/mqttService", () => ({
  publishNGAlert: vi.fn(async () => undefined),
  publishPointsConfigChanged: vi.fn(async () => undefined),
}));
vi.mock("../services/integration/outboxProducers", () => ({
  publishToOutbox: vi.fn(),
}));

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
const spy = <T extends keyof typeof db>(name: T) => db[name] as unknown as ReturnType<typeof vi.fn>;

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

function payload(over: Record<string, unknown> = {}) {
  return {
    apiKey: "SHARED-KEY",
    serialNumber: "SN-VG-1",
    overallResult: "OK" as const,
    productModel: "PM-1",
    measurements: [] as Record<string, unknown>[],
    ...over,
  };
}

function lastInsertedRows(): Record<string, unknown>[] {
  return capturedMeasurementInserts[capturedMeasurementInserts.length - 1] ?? [];
}

// Base point P1: upperLimit 10. A measured value of 15 → base gate would DOWNGRADE OK→NG.
const BASE_DEF = { id: 100, code: "P1", upperLimit: "10" };
const MEASURED_15 = [{ pointCode: "P1", result: "OK" as const, measuredValue: 15 }];

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.PRODUCT_VARIANT_ENABLED;
  delete process.env.SPEC_GATE_SNAPSHOT_ENABLED;
  delete process.env.POINT_LIMIT_EVAL_ENABLED; // default ON
  capturedMeasurementInserts = [];
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 });
  (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 70, code: "PM-1", pointsConfigVersion: 3 });
  (db.getMeasurementPointDefByCode as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DEF);
});

describe("Task 1 — variant OVERRIDE patches the spec-gate limit", () => {
  it("★ flag OFF ⇒ base limit 10 gates 15 → NG, getVariantOverrides never called (byte-identical)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ variantCode: "EU", measurements: MEASURED_15 }));

    expect(lastInsertedRows()[0].result).toBe("NG");
    expect(spy("getVariantOverrides")).not.toHaveBeenCalled();
  });

  it("★ flag ON + variant OVERRIDE upperLimit→20 ⇒ 15 ≤ 20 → stays OK (patched limit wins)", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 5 });
    spy("getVariantOverrides").mockResolvedValue([
      { basePointDefId: 100, action: "override", patchJson: { upperLimit: "20" } },
    ]);
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ variantCode: "EU", measurements: MEASURED_15 }));

    expect(lastInsertedRows()[0].result).toBe("OK");
    // hot-path contract: overrides loaded exactly once per board (not per measurement).
    expect(spy("getVariantOverrides")).toHaveBeenCalledTimes(1);
    expect(spy("getVariantOverrides")).toHaveBeenCalledWith(42);
  });

  it("★ flag ON + variant EXCLUDE ⇒ gate SKIPPED → machine OK stands (base 10 would have said NG)", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 5 });
    spy("getVariantOverrides").mockResolvedValue([
      { basePointDefId: 100, action: "exclude", patchJson: null },
    ]);
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ variantCode: "EU", measurements: MEASURED_15 }));

    expect(lastInsertedRows()[0].result).toBe("OK");
  });

  it("flag ON + BASE variant (no override rows) ⇒ base limit 10 gates 15 → NG (base parity)", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    // variantCode resolves to a BASE variant ⇒ pointDefVariantId null ⇒ overrides not loaded.
    spy("getVariantByCode").mockResolvedValue({ id: 1, isBase: true, code: "BASE", pointsConfigVersion: 3 });
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ variantCode: "BASE", measurements: MEASURED_15 }));

    expect(lastInsertedRows()[0].result).toBe("NG");
    expect(spy("getVariantOverrides")).not.toHaveBeenCalled();
  });

  it("flag ON + variant OVERRIDE on a DIFFERENT base id ⇒ this point keeps base gating → NG", async () => {
    process.env.PRODUCT_VARIANT_ENABLED = "true";
    spy("getVariantByCode").mockResolvedValue({ id: 42, isBase: false, code: "EU", pointsConfigVersion: 5 });
    spy("getVariantOverrides").mockResolvedValue([
      { basePointDefId: 999, action: "override", patchJson: { upperLimit: "20" } }, // not P1's id (100)
    ]);
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(payload({ variantCode: "EU", measurements: MEASURED_15 }));

    expect(lastInsertedRows()[0].result).toBe("NG"); // override doesn't match P1 → base 10
  });
});
