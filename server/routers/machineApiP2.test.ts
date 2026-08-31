/**
 * Doc 51 P2 — submitInspection hardening at the ROUTER level:
 *   • §11.2 residual #1 — measurement-tx failure DELETES the orphaned header
 *     (compensation) and the deferred ERP-outbox / order-bump side-effects DON'T
 *     run; on success they DO.
 *   • CASE #8 — a serial already seen from a DIFFERENT machine in the window TAGS
 *     the board + raises an alert, but the board is STILL saved; a same-machine
 *     retry (P0 duplicate) never reaches the collision check.
 *   • §5.6 — request-level audit fires (flag on) after a submit, off by default.
 *
 * Each assertion is a mutation test — remove the corresponding fix and it goes RED.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  selectRows: [] as Array<{ machineId: number }>,
  txShouldReject: false,
};

vi.mock("../db", () => {
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    if (state.txShouldReject) throw new Error("measurement insert failed (simulated)");
    return fn({
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    });
  });
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => state.selectRows }),
        orderBy: () => ({ limit: async () => state.selectRows }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
    // no `execute` → persistSuspectedDuplicateSerial cleanly skips in tests.
  };
  return {
    __transaction: transaction,
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(async () => undefined),
    getProductionOrderByCode: vi.fn(),
    updateProductionOrderQuantities: vi.fn(async () => undefined),
    createProductInspection: vi.fn(),
    createMeasurementResults: vi.fn(async () => undefined),
    deleteInspectionForCompensation: vi.fn(async () => undefined),
    createAuditLog: vi.fn(async () => ({ id: 1 })),
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
    // A resolvable point def so measurements build WITHOUT the auto-provision path.
    getMeasurementPointDefByMachineAndCode: vi.fn(async () => ({
      id: 900, code: "MP001", name: "Point 1", referenceImageUrl: null,
      workstationId: null, normalizedX: null, normalizedY: null, normalizedRadius: null,
      unit: null,
    })),
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
// Mock auth so the shared fakeDb.select (used by state.selectRows for the
// collision lookup) is NOT also consumed by authenticateMachine's key lookup.
vi.mock("../services/machineAuthService", () => ({
  authenticateMachine: vi.fn(async () => ({
    machine: { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true },
    method: "shared-key",
  })),
  enforceMachineIngestRateLimit: vi.fn(),
  issueMachineKey: vi.fn(),
  rotateMachineKey: vi.fn(),
  revokeMachineKey: vi.fn(),
  listMachineKeys: vi.fn(),
}));
vi.mock("../services/aiSmartAlertRouter", () => ({
  routeAlert: vi.fn(async () => ({ alertType: "PATTERN_ANOMALY", targets: [], consolidated: false, escalationLevel: "L1" })),
}));

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import { publishToOutbox } from "../services/integration/outboxProducers";
import { routeAlert } from "../services/aiSmartAlertRouter";
import type { CreateInspectionOutcome } from "../db/inspection";
import type { InsertProductInspection } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };
const ORDER = { id: 42, code: "WO-2026-001" };

function ctx(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
function payload(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: "SHARED-KEY",
    serialNumber: "SN-P2-1",
    overallResult: "OK" as const,
    inspectionTime: "2026-07-15T08:00:00.000Z",
    measurements: [] as unknown[],
    ...overrides,
  };
}
/** natural-key idempotent fake (same semantics as the P0 test). */
function installIdempotentInsertFake() {
  const natural = new Map<string, number>();
  let nextId = 1000;
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(
    async (data: InsertProductInspection, outcome?: CreateInspectionOutcome) => {
      const nk = `${data.machineId}|${data.serialNumber}|${(data.inspectionTime as Date).toISOString()}`;
      const hit = natural.get(nk);
      if (hit !== undefined) { if (outcome) outcome.duplicate = true; return hit; }
      const id = nextId++;
      natural.set(nk, id);
      if (outcome) outcome.duplicate = false;
      return id;
    },
  );
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  delete process.env.AI_INLINE_GATE_ENABLED;
  delete process.env.INGEST_SERIAL_COLLISION_DETECT;
  delete process.env.INGEST_REQUEST_AUDIT_ENABLED;
  delete process.env.INGEST_COMPENSATE_ORPHAN_HEADER;
  state.selectRows = [];
  state.txShouldReject = false;
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getProductionOrderByCode as ReturnType<typeof vi.fn>).mockResolvedValue(ORDER);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100 });
  installIdempotentInsertFake();
});

// ════════════════════════════════════════════════════════════════════════════
describe("§11.2 residual #1 — measurement-tx failure compensation", () => {
  const withPoint = () => payload({
    serialNumber: "SN-COMP-1",
    idempotencyKey: "board-comp-0001-xyz",
    productionOrderCode: ORDER.code,
    measurements: [{ pointCode: "MP001", result: "OK", measuredValue: 1.0 }],
  });

  it("★ measurement tx fails → header DELETED, order-bump + ERP outbox NEVER ran", async () => {
    state.txShouldReject = true;
    const caller = machineApiRouter.createCaller(ctx());

    await expect(caller.submitInspection(withPoint())).rejects.toThrow(/measurement insert failed/);

    // header compensated (id + machine + idempotencyKey handed to the deleter)
    expect(db.deleteInspectionForCompensation).toHaveBeenCalledTimes(1);
    expect(db.deleteInspectionForCompensation).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: MACHINE.id, idempotencyKey: "board-comp-0001-xyz" }),
    );
    // deferred side-effects did NOT fire on the failed board (no phantom +1, no ERP event)
    expect(db.updateProductionOrderQuantities).not.toHaveBeenCalled();
    expect(publishToOutbox).not.toHaveBeenCalled();
  });

  it("happy path (tx ok) → NO compensation, order-bump + outbox DO run (deferral still fires them)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitInspection(withPoint());
    expect(res.success).toBe(true);
    expect(db.deleteInspectionForCompensation).not.toHaveBeenCalled();
    expect(db.updateProductionOrderQuantities).toHaveBeenCalledTimes(1);
    expect(publishToOutbox).toHaveBeenCalledTimes(1);
  });

  it("compensation flag OFF → header NOT deleted (revert switch works)", async () => {
    process.env.INGEST_COMPENSATE_ORPHAN_HEADER = "false";
    state.txShouldReject = true;
    const caller = machineApiRouter.createCaller(ctx());
    await expect(caller.submitInspection(withPoint())).rejects.toThrow();
    expect(db.deleteInspectionForCompensation).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("CASE #8 — serial-collision soft detect (QĐ#3)", () => {
  it("★ same serial from a DIFFERENT machine in window → TAG + alert, board STILL saved", async () => {
    process.env.INGEST_SERIAL_COLLISION_DETECT = "true";
    state.selectRows = [{ machineId: 999 }]; // another machine already has this serial
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspection(payload({ serialNumber: "SN-COLLIDE" }));
    expect(res.success).toBe(true); // NOT rejected (QĐ#3)
    expect(db.createProductInspection).toHaveBeenCalledTimes(1); // board saved

    await vi.waitFor(() => expect(routeAlert).toHaveBeenCalledTimes(1));
    expect(routeAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: "serial_collision", otherMachineId: 999 }),
      }),
    );
  });

  it("no other-machine row in window → NO tag, NO alert", async () => {
    process.env.INGEST_SERIAL_COLLISION_DETECT = "true";
    state.selectRows = []; // the ne(machineId) query found nothing
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ serialNumber: "SN-CLEAN" }));
    await new Promise((r) => setImmediate(r));
    expect(routeAlert).not.toHaveBeenCalled();
  });

  it("detection flag OFF (default) → collision lookup never runs, no alert", async () => {
    state.selectRows = [{ machineId: 999 }];
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload({ serialNumber: "SN-OFF" }));
    await new Promise((r) => setImmediate(r));
    expect(routeAlert).not.toHaveBeenCalled();
  });

  it("same-machine retry (P0 duplicate) short-circuits BEFORE the collision check → no alert", async () => {
    process.env.INGEST_SERIAL_COLLISION_DETECT = "true";
    state.selectRows = [{ machineId: 999 }];
    const caller = machineApiRouter.createCaller(ctx());
    const p = payload({ serialNumber: "SN-RETRY-DUP" });
    await caller.submitInspection(p);
    vi.clearAllMocks();
    (routeAlert as ReturnType<typeof vi.fn>).mockClear();
    const retry = await caller.submitInspection(p); // duplicate
    expect((retry as { duplicate?: boolean }).duplicate).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(routeAlert).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Task 3 (BG-89, 2026-09-02) — `db.createAuditLog` nay CŨNG được gọi bởi tín hiệu ĐẾM
// hình dạng ingest (`ghiTinHieuHinhDangIngest`, action `ingest_shape_legacy`/`ingest_shape_v2`)
// — MỘT tín hiệu ĐỘC LẬP, KHÔNG gated bởi `INGEST_REQUEST_AUDIT_ENABLED`, ghi ở `.input()`
// TRƯỚC `auditInspectionSubmission` (ghi trong thân `.mutation()`, action
// `machine.inspection.submit`). Từ đây, `db.createAuditLog` không còn là "chỉ §5.6 gọi" — ba ca
// dưới đây LỌC theo `action` để tiếp tục canh ĐÚNG mệnh đề của MÌNH (§5.6), không lẫn với tín
// hiệu ĐẾM hình dạng của Task 3 (canh riêng ở `dangKyTinHieuHinhDangIngestBg89.test.ts`).
function goiAuditTheoHanhDong(hanhDong: string) {
  return (db.createAuditLog as ReturnType<typeof vi.fn>).mock.calls.filter(([arg]) => arg?.action === hanhDong);
}

describe("§5.6 — request-level ingest audit", () => {
  it("★ flag ON → audit row written after submit (who/what/when, no payload)", async () => {
    process.env.INGEST_REQUEST_AUDIT_ENABLED = "true";
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitInspection(payload({ serialNumber: "SN-AUDIT", overallResult: "NG" }));

    const goi = goiAuditTheoHanhDong("machine.inspection.submit");
    expect(goi).toHaveLength(1);
    expect(goi[0][0]).toEqual(
      expect.objectContaining({
        action: "machine.inspection.submit",
        entityType: "product_inspection",
        entityId: (res as { inspectionId: number }).inspectionId,
        entityName: "SN-AUDIT",
        details: expect.objectContaining({
          machineId: MACHINE.id, machineCode: "AOI-01",
          serialNumber: "SN-AUDIT", overallResult: "NG",
          authMethod: "shared-key", duplicate: false,
        }),
      }),
    );
  });

  it("flag OFF (default) → NO audit row TỪ §5.6 (perf-safe default) — tín hiệu ĐẾM hình dạng (BG-89, KHÔNG gated) vẫn ghi riêng, đó là hành vi ĐÚNG Ý ĐỊNH, không phải hồi quy của §5.6", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    await caller.submitInspection(payload());
    expect(goiAuditTheoHanhDong("machine.inspection.submit")).toHaveLength(0);
  });

  it("duplicate submission is also audited (flag on) with duplicate:true", async () => {
    process.env.INGEST_REQUEST_AUDIT_ENABLED = "true";
    const caller = machineApiRouter.createCaller(ctx());
    const p = payload({ serialNumber: "SN-AUDIT-DUP" });
    await caller.submitInspection(p);
    await caller.submitInspection(p); // duplicate
    const goi = goiAuditTheoHanhDong("machine.inspection.submit");
    expect(goi).toHaveLength(2);
    expect(goi[1][0].details.duplicate).toBe(true);
  });
});
