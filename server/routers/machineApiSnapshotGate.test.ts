/**
 * Doc 51 P1 — submitInspection / deltaSyncPoints WIRING for:
 *   • QĐ#2 SNAPSHOT SPEC-GATE (SPEC_GATE_SNAPSHOT_ENABLED, default OFF): a STALE
 *     board is gated by the limits reconstructed for the instant it was received,
 *     not by the LIVE limits — so a tightened limit can't retro-fail it. When no
 *     usable snapshot exists → gate SKIPPED (safe), never gated by newer limits.
 *   • CASE #5 IMAGE ATOMICITY: measurement-tx failure AFTER an image upload →
 *     the orphan is storageDelete-d (compensation); an upload that FAILED marks
 *     its measurement row [IMG_UPLOAD_FAILED] instead of silently dropping it;
 *     an oversized imageBase64 is rejected by zod.
 *   • CASE #4 TOMBSTONES: deltaSyncPoints returns deletedCodes/deletedPoints.
 *
 * Each test goes RED if the corresponding fix is removed (verified by mutation).
 * The pure split-brain proof lives in
 * server/services/pointResultEvaluator.snapshotGate.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── mutable test knobs the fake db/storage read (set per test) ──────────────
let snapshotRows: Array<{ changedAt: Date; snapshotJson: Record<string, unknown> }> = [];
let txShouldThrow = false;
let storagePutShouldFail = false;
const capturedMeasurementInserts: Array<Record<string, unknown>[]> = [];
let executeCalls = 0;

vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => {
    if (storagePutShouldFail) throw new Error("storage down");
    return { url: `/uploads/${key}`, key };
  }),
  storageGet: vi.fn(async () => ({ key: "", url: "" })),
  storageDelete: vi.fn(async () => ({ deleted: true })),
  resolveImageToDataUrl: vi.fn(async () => ""),
}));

vi.mock("../db", () => {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    if (txShouldThrow) throw new Error("measurement tx boom");
    return fn({
      insert: () => ({
        values: async (vals: Record<string, unknown>[]) => {
          capturedMeasurementInserts.push(Array.isArray(vals) ? vals : [vals]);
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    });
  });
  // The ONLY getDb().select in the OK ingest path is loadPointLimitSnapshots.
  const fakeDb = {
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
    execute: async () => {
      executeCalls += 1;
      return undefined;
    },
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
    // deltaSyncPoints deps
    getPointsChangedSinceVersion: vi.fn(),
    getFiducialMarksByProductModel: vi.fn(async () => []),
    listMpLightingProfilesByPointDefIds: vi.fn(async () => new Map()),
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

import { machineApiRouter, _resetGateConfigVersionProbe } from "./machineApiRouters";
import * as db from "../db";
import { storageDelete, storagePut } from "../storage";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
// > 200 chars ⇒ treated as an upload job by the pre-upload pass.
const IMG_B64 = "a".repeat(400);

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
    serialNumber: "SN-GATE-1",
    overallResult: "OK" as const,
    productModel: "PM-1",
    measurements: [] as Record<string, unknown>[],
    ...over,
  };
}

const setDef = (def: Record<string, unknown> | undefined) =>
  (db.getMeasurementPointDefByCode as ReturnType<typeof vi.fn>).mockResolvedValue(def);
const setProduct = (p: Record<string, unknown> | undefined) =>
  (db.getProductModelByCode as ReturnType<typeof vi.fn>).mockResolvedValue(p);

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.SPEC_GATE_SNAPSHOT_ENABLED;
  delete process.env.POINT_LIMIT_EVAL_ENABLED; // default ON
  delete process.env.AI_INLINE_GATE_ENABLED;
  snapshotRows = [];
  txShouldThrow = false;
  storagePutShouldFail = false;
  capturedMeasurementInserts.length = 0;
  executeCalls = 0;
  _resetGateConfigVersionProbe();
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineByCode as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({
    total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100,
  });
});

/** Last batch of measurement rows written into the transaction. */
function lastInsertedRows(): Record<string, unknown>[] {
  return capturedMeasurementInserts[capturedMeasurementInserts.length - 1] ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
describe("QĐ#2 — snapshot spec-gate (flag SPEC_GATE_SNAPSHOT_ENABLED)", () => {
  // Live limit upperLimit=10; the board measured 12 (machine said OK). Live gating
  // downgrades → NG; snapshot gating with the older looser limit keeps it OK.
  const DEF = { id: 42, code: "P1", upperLimit: "10" };
  const measured = [{ pointCode: "P1", result: "OK" as const, measuredValue: 12 }];

  it("★ flag OFF (default) → LIVE gating downgrades OK→NG (baseline / today's behaviour)", async () => {
    setProduct({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    setDef(DEF);
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ pointsConfigVersion: 4, measurements: measured }));

    expect(lastInsertedRows()[0].result).toBe("NG"); // live limit 10 < 12
  });

  it("★ flag ON + STALE + snapshot(15 after board) → gated by OLD limit → stays OK (split-brain closed)", async () => {
    process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
    setProduct({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    setDef(DEF);
    // Snapshot: the limit was tightened to 10 at a changedAt AFTER this board was
    // received; the snapshotJson holds the previous (looser) upperLimit 15.
    snapshotRows = [{ changedAt: new Date(Date.now() + 3_600_000), snapshotJson: { upperLimit: "15" } }];
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ pointsConfigVersion: 4, measurements: measured }));

    expect(lastInsertedRows()[0].result).toBe("OK"); // 12 ≤ snapshot 15 → NOT downgraded
    expect(executeCalls).toBeGreaterThan(0); // gateConfigVersion persist attempted
  });

  it("★ flag ON + STALE + NO usable snapshot → gate SKIPPED (safe), NOT gated by live 10", async () => {
    process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
    setProduct({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    setDef(DEF);
    snapshotRows = []; // no history → cannot confirm old limits → skip
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ pointsConfigVersion: 4, measurements: measured }));

    // Live gating would have said NG; the skip leaves the machine's OK intact.
    expect(lastInsertedRows()[0].result).toBe("OK");
  });

  it("flag ON but board CURRENT (declared == live) → LIVE gating (snapshot mode only for stale)", async () => {
    process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
    setProduct({ id: 70, code: "PM-1", pointsConfigVersion: 9 });
    setDef(DEF);
    snapshotRows = [{ changedAt: new Date(Date.now() + 3_600_000), snapshotJson: { upperLimit: "15" } }];
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ pointsConfigVersion: 9, measurements: measured }));

    expect(lastInsertedRows()[0].result).toBe("NG"); // current board → live limit 10
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("CASE #5 — image atomicity", () => {
  const DEF = { id: 42, code: "P1" };
  it("★ measurement tx fails AFTER upload → orphan image is storageDelete-d (compensation)", async () => {
    setDef(DEF);
    txShouldThrow = true;
    const caller = machineApiRouter.createCaller(ctx());

    await expect(
      caller.submitInspection(
        payload({ measurements: [{ pointCode: "P1", result: "OK", imageBase64: IMG_B64 }] }),
      ),
    ).rejects.toThrow();

    expect(storagePut).toHaveBeenCalledTimes(1);
    expect(storageDelete).toHaveBeenCalledTimes(1);
    const key = (storageDelete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(key).toContain("inspections/4242/"); // the key uploaded for this board
  });

  it("★ upload FAILS → measurement row tagged [IMG_UPLOAD_FAILED], NOT dropped silently", async () => {
    setDef(DEF);
    storagePutShouldFail = true;
    const caller = machineApiRouter.createCaller(ctx());

    await caller.submitInspection(
      payload({ measurements: [{ pointCode: "P1", result: "NG", imageBase64: IMG_B64 }] }),
    );

    const row = lastInsertedRows()[0];
    expect(String(row.remark)).toContain("[IMG_UPLOAD_FAILED]");
    expect(row.imageUrl).toBeUndefined();
    // No orphan to clean here — the upload never produced a key (tx succeeded).
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("★ oversized imageBase64 → BAD_REQUEST, never reaches the DB", async () => {
    process.env.MACHINE_INGEST_MAX_IMAGE_B64 = "500"; // won't affect the already-built schema…
    setDef(DEF);
    const caller = machineApiRouter.createCaller(ctx());
    // …so build a payload above the compiled-in default (20,000,000 chars).
    const huge = "a".repeat(20_000_001);
    await expect(
      caller.submitInspection(
        payload({ measurements: [{ pointCode: "P1", result: "OK", imageBase64: huge }] }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createProductInspection).not.toHaveBeenCalled();
  });

  it("happy path (upload OK, tx OK) → no compensation, image url stored", async () => {
    setDef(DEF);
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(
      payload({ measurements: [{ pointCode: "P1", result: "OK", imageBase64: IMG_B64 }] }),
    );
    expect(storageDelete).not.toHaveBeenCalled();
    const row = lastInsertedRows()[0];
    expect(String(row.imageUrl)).toContain("/uploads/inspections/4242/");
    expect(String(row.remark ?? "")).not.toContain("IMG_UPLOAD_FAILED");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("CASE #4 — deltaSyncPoints ships tombstones", () => {
  it("★ returns deletedCodes + deletedPoints so a machine STOPS inspecting retired points", async () => {
    setProduct({ id: 70, code: "PM-1", pointsConfigVersion: 9, imageWidth: null, imageHeight: null });
    (db.getPointsChangedSinceVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      points: [],
      deletedPoints: [
        { id: 11, code: "OLD-A", deletedAt: new Date("2026-07-10T00:00:00Z"), deletedAtVersion: 7 },
        { id: 12, code: "OLD-B", deletedAt: null, deletedAtVersion: null },
      ],
      deletedCodes: ["OLD-A", "OLD-B"],
      currentVersion: 9,
    });

    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.deltaSyncPoints({
      apiKey: "SHARED-KEY",
      productModelCode: "PM-1",
      sinceVersion: 4,
    });

    expect(res.hasChanges).toBe(true);
    expect(res.deletedCodes).toEqual(["OLD-A", "OLD-B"]);
    expect(res.deletedPoints).toEqual([
      { id: 11, code: "OLD-A", deletedAt: "2026-07-10T00:00:00.000Z", deletedAtVersion: 7 },
      { id: 12, code: "OLD-B", deletedAt: null, deletedAtVersion: null },
    ]);
  });

  it("no version change → empty tombstone arrays (shape parity, no crash)", async () => {
    setProduct({ id: 70, code: "PM-1", pointsConfigVersion: 4, imageWidth: null, imageHeight: null });
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.deltaSyncPoints({
      apiKey: "SHARED-KEY",
      productModelCode: "PM-1",
      sinceVersion: 4,
    });
    expect(res.hasChanges).toBe(false);
    expect(res.deletedCodes).toEqual([]);
    expect(res.deletedPoints).toEqual([]);
  });
});
