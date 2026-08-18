/**
 * Doc 55 Item 1 (PA-A "reserve-id") — submitInspection SINGLE-TX wiring tests.
 *
 * These prove the ROUTER wiring of INSPECTION_SINGLE_TX_ENABLED (the DB-layer
 * atomicity + dedup themselves are proven against a real Postgres in
 * server/db/persistInspectionAtomic.db.test.ts). With the flag ON the ingest path:
 *   • reserves the inspection id UP FRONT (db.reserveInspectionId), NOT via
 *     createProductInspection;
 *   • embeds that reserved id in the pre-uploaded image object keys
 *     (inspections/<reservedId>/…) and in every measurement row;
 *   • commits header + measurements via db.persistInspectionAtomic (ONE tx) and runs
 *     the deferred side-effects (order-qty / ERP outbox) only when it is NOT a dup;
 *   • on a duplicate → short-circuits with the ORIGINAL id + duplicate:true and runs
 *     NO side-effect (exactly like the two-phase duplicate short-circuit);
 *   • on a persist FAILURE → re-throws WITHOUT deleteInspectionForCompensation and
 *     WITHOUT image cleanup (atomic tx already rolled back; images → orphan reaper).
 * With the flag OFF the historical two-phase path (createProductInspection) is used
 * and neither reserveInspectionId nor persistInspectionAtomic is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../db", () => {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
  );
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
  };
  return {
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    // ── doc 55 Item 1 — the single-tx surface under test ──
    reserveInspectionId: vi.fn(async () => 7777),
    persistInspectionAtomic: vi.fn(),
    createProductInspection: vi.fn(),
    deleteInspectionForCompensation: vi.fn(async () => undefined),
    createMeasurementResults: vi.fn(async () => undefined),
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
    getMeasurementPointDefByMachineAndCode: vi.fn(async () => ({
      id: 900,
      code: "MP001",
      name: "Point 1",
      referenceImageUrl: null,
      workstationId: null,
      normalizedX: null,
      normalizedY: null,
      normalizedRadius: null,
    })),
  };
});

// Spy the object storage so we can assert the reserved id is embedded in the key,
// and that the ON-path failure does NOT delete images (relies on the orphan reaper).
vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ url: `http://store/${key}` })),
  storageGet: vi.fn(async () => null),
  storageDelete: vi.fn(async () => ({ deleted: true })),
  resolveImageToDataUrl: vi.fn(async () => null),
}));

// Side-effect surfaces a duplicate/short-circuit MUST NOT re-trigger.
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
import { storagePut, storageDelete } from "../storage";
import { emitNGAlert } from "../_core/socket";
import { publishToOutbox } from "../services/integration/outboxProducers";
import type { InsertProductInspection } from "../../drizzle/schema";
import type { CreateInspectionOutcome } from "../db/inspection";
import type { TrpcContext } from "../_core/context";

const RESERVED_ID = 7777;
const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
const ORDER = { id: 42, code: "WO-2026-001" };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

/** A payload whose single measurement carries an image → exercises the pre-upload. */
function imagePayload(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: "SHARED-KEY",
    serialNumber: "SN-ST-1",
    overallResult: "OK" as const,
    inspectionTime: "2026-07-16T08:00:00.000Z",
    productionOrderCode: ORDER.code,
    measurements: [
      {
        pointCode: "MP001",
        result: "OK" as const,
        measuredValue: 1.23,
        imageBase64: "data:image/png;base64," + "A".repeat(400),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  process.env.INSPECTION_SINGLE_TX_ENABLED = "true";
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.AI_INLINE_GATE_ENABLED;
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getProductionOrderByCode as ReturnType<typeof vi.fn>).mockResolvedValue(ORDER);
  (db.reserveInspectionId as ReturnType<typeof vi.fn>).mockResolvedValue(RESERVED_ID);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({
    total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100,
  });
});

afterEach(() => {
  delete process.env.INSPECTION_SINGLE_TX_ENABLED;
});

describe("submitInspection single-tx ON (doc 55 Item 1 / PA-A)", () => {
  it("happy path — reserves id, embeds it in the image key + measurement rows, persists atomically, runs deferred side-effects", async () => {
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        data: InsertProductInspection & { id: number },
        _rows: unknown[],
        opts?: { outcome?: CreateInspectionOutcome },
      ) => {
        if (opts?.outcome) opts.outcome.duplicate = false;
        return { id: data.id, duplicate: false };
      },
    );
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspection(imagePayload());

    // 1) reserve-id path (NOT createProductInspection)
    expect(db.reserveInspectionId).toHaveBeenCalledTimes(1);
    expect(db.createProductInspection).not.toHaveBeenCalled();

    // 2) persisted atomically with the reserved id; rows carry the same id
    expect(db.persistInspectionAtomic).toHaveBeenCalledTimes(1);
    const [dataArg, rowsArg, optsArg] = (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(dataArg.id).toBe(RESERVED_ID);
    expect(rowsArg).toHaveLength(1);
    expect(rowsArg[0].inspectionId).toBe(RESERVED_ID);
    expect(optsArg.promoteOverallToNg).toBe(false);

    // 3) ★ the reserved id is embedded in the pre-uploaded image object key
    expect(storagePut).toHaveBeenCalledTimes(1);
    const putKey = (storagePut as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(putKey).toMatch(/^inspections\/7777\/MP001-/);

    // 4) success with the reserved id + deferred side-effects fired (not a dup)
    expect(res).toEqual({ success: true, inspectionId: RESERVED_ID });
    expect((res as { duplicate?: boolean }).duplicate).toBeUndefined();
    expect(db.updateProductionOrderQuantities).toHaveBeenCalledTimes(1);
    expect(publishToOutbox).toHaveBeenCalledTimes(1);
  });

  it("duplicate — short-circuits with the ORIGINAL id, runs NO side-effect, never double-persists", async () => {
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (_d: unknown, _r: unknown, opts?: { outcome?: CreateInspectionOutcome }) => {
        if (opts?.outcome) opts.outcome.duplicate = true;
        return { id: 999, duplicate: true };
      },
    );
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspection(imagePayload({ serialNumber: "SN-DUP" }));

    expect(res).toEqual({ success: true, inspectionId: 999, duplicate: true });
    expect(db.persistInspectionAtomic).toHaveBeenCalledTimes(1);
    // Exactly-once: EVERY side-effect is skipped on the duplicate short-circuit.
    expect(db.updateProductionOrderQuantities).not.toHaveBeenCalled();
    expect(publishToOutbox).not.toHaveBeenCalled();
    expect(emitNGAlert).not.toHaveBeenCalled();
  });

  it("NG duplicate — the Andon NG alert does NOT re-fire", async () => {
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (_d: unknown, _r: unknown, opts?: { outcome?: CreateInspectionOutcome }) => {
        if (opts?.outcome) opts.outcome.duplicate = true;
        return { id: 888, duplicate: true };
      },
    );
    const caller = machineApiRouter.createCaller(ctx());
    const retry = await caller.submitInspection(
      imagePayload({ serialNumber: "SN-NG", overallResult: "NG" as const }),
    );
    expect((retry as { duplicate?: boolean }).duplicate).toBe(true);
    expect(emitNGAlert).not.toHaveBeenCalled();
  });

  it("persist failure — re-throws WITHOUT header compensation or image cleanup (atomic tx rolled back; images → reaper)", async () => {
    (db.persistInspectionAtomic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("measurement insert failed"),
    );
    const caller = machineApiRouter.createCaller(ctx());

    await expect(
      caller.submitInspection(imagePayload({ serialNumber: "SN-FAIL" })),
    ).rejects.toThrow();

    // No two-phase compensation on the single-tx path — the tx already rolled back.
    expect(db.deleteInspectionForCompensation).not.toHaveBeenCalled();
    // No proactive image cleanup either (orphan images are the reaper's job — QĐ#3).
    expect(storageDelete).not.toHaveBeenCalled();
    // And the two-phase header insert is never used on this path.
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });
});

describe("submitInspection single-tx OFF (default) — two-phase path unchanged", () => {
  it("flag OFF → createProductInspection is used; reserveInspectionId / persistInspectionAtomic untouched", async () => {
    delete process.env.INSPECTION_SINGLE_TX_ENABLED;
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockResolvedValue(555);
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspection({
      apiKey: "SHARED-KEY",
      serialNumber: "SN-OFF",
      overallResult: "OK" as const,
      inspectionTime: "2026-07-16T09:00:00.000Z",
      productionOrderCode: ORDER.code,
      measurements: [],
    });

    expect(res).toEqual({ success: true, inspectionId: 555 });
    expect(db.createProductInspection).toHaveBeenCalledTimes(1);
    expect(db.reserveInspectionId).not.toHaveBeenCalled();
    expect(db.persistInspectionAtomic).not.toHaveBeenCalled();
  });
});
