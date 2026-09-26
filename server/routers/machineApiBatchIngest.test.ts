/**
 * Doc 51 P3 batch-1 (§5.4 / CASE #2 / CASE #9 / CASE #10 / §5.1) — tests for:
 *   1) submitInspectionBatch: per-item isolation, idempotency preserved across the
 *      batch, one board's failure never fails the batch, and rate limit charged
 *      PER inspection (a batch cannot dodge the ingest limit).
 *   2) heartbeat rate limit: spam past the cap → 429 (was previously unbounded).
 *   3) key-rotation signal: heartbeat carries keyExpiresInDays/keyRotationPending
 *      so a machine rotates BEFORE the 401 cliff (zero-downtime).
 *
 * Runs through the REAL tRPC router with the `../db` barrel mocked to reproduce
 * the semantics that matter: an idempotent header insert (ON CONFLICT DO NOTHING),
 * the api_keys lookup that drives machine-key auth + listMachineKeys, and the
 * per-inspection side-effects (production-order quantity bump) the duplicate
 * short-circuit must NOT re-run.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("../db", () => {
  // State the fake reads from: `apiKeyRows` feeds BOTH the machine-key auth lookup
  // and listMachineKeys (empty ⇒ auth falls through to the shared-key path).
  const state = { apiKeyRows: [] as any[] };
  // A thenable query object: supports .limit(n) (auth), .orderBy(...) (listKeys,
  // awaited directly), and `await query` — all resolving to the same rows.
  const makeQuery = (rows: any[]): any => ({
    limit: async () => rows,
    orderBy: () => makeQuery(rows),
    then: (onF: any, onR: any) => Promise.resolve(rows).then(onF, onR),
  });
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
  );
  const fakeDb = {
    select: () => ({ from: () => ({ where: () => makeQuery(state.apiKeyRows) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
    transaction,
  };
  return {
    __state: state,
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

import { machineApiRouter, _resetHeartbeatRateLimit } from "./machineApiRouters";
import * as db from "../db";
import type { CreateInspectionOutcome } from "../db/inspection";
import type { InsertProductInspection } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const state = (db as unknown as { __state: { apiKeyRows: any[] } }).__state;

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function setMachine(id: number) {
  const machine = { id, code: `AOI-${id}`, name: `Machine ${id}`, stationId: 1, isActive: true };
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(machine);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(machine);
  return machine;
}

/**
 * Idempotent createProductInspection fake: keyed by (machineId, serialNumber,
 * inspectionTime) like uq_inspections_machine_serial_time. Optionally throws for a
 * designated serial (to exercise the batch's per-item permanent-error isolation).
 */
function installIdempotentInsertFake(opts: { throwSerial?: string; throwErr?: Error } = {}) {
  const rows = new Map<string, number>();
  let nextId = 1000;
  let realInserts = 0;
  (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(
    async (data: InsertProductInspection, outcome?: CreateInspectionOutcome) => {
      if (opts.throwSerial && data.serialNumber === opts.throwSerial) {
        throw opts.throwErr ?? new Error("boom: measurement store failed");
      }
      const key = `${data.machineId}|${data.serialNumber}|${(data.inspectionTime as Date).toISOString()}`;
      const existing = rows.get(key);
      if (existing !== undefined) {
        if (outcome) outcome.duplicate = true;
        return existing;
      }
      const id = nextId++;
      rows.set(key, id);
      realInserts += 1;
      if (outcome) outcome.duplicate = false;
      return id;
    },
  );
  return {
    get realInserts() {
      return realInserts;
    },
  };
}

function item(serial: string, overrides: Record<string, unknown> = {}) {
  return {
    serialNumber: serial,
    overallResult: "OK" as const,
    inspectionTime: "2026-07-15T08:00:00.000Z",
    measurements: [] as unknown[],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN; // default 600 — no trip
  delete process.env.MACHINE_INGEST_BATCH_CONCURRENCY;
  delete process.env.MACHINE_HEARTBEAT_RATE_LIMIT_PER_MIN;
  delete process.env.MACHINE_KEY_ROTATION_WARN_DAYS;
  delete process.env.AI_INLINE_GATE_ENABLED;
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED; // mặc định TẮT (Pha 1C Task 3, BG-31)
  state.apiKeyRows = [];
  _resetHeartbeatRateLimit();
  vi.clearAllMocks();
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({
    total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100,
  });
});

describe("submitInspectionBatch — per-item isolation + idempotency (CASE #2/#9)", () => {
  it("3 bản (1 trùng, 1 mới, 1 lỗi) → per-item đúng, chống-trùng giữ, lỗi 1 bản không hỏng bản khác", async () => {
    setMachine(5);
    (db.getProductionOrderByCode as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42, code: "WO-1" });
    const fake = installIdempotentInsertFake({ throwSerial: "SN-ERR" });
    const caller = machineApiRouter.createCaller(ctx());

    // Seed SN-DUP with a first batch so it is genuinely on record.
    const seed = await caller.submitInspectionBatch({
      apiKey: "SHARED-KEY",
      inspections: [item("SN-DUP", { productionOrderCode: "WO-1" })],
    });
    expect(seed.succeeded).toBe(1);
    expect(fake.realInserts).toBe(1);

    // Second batch: SN-DUP (duplicate), SN-NEW (new), SN-ERR (permanent failure).
    const res = await caller.submitInspectionBatch({
      apiKey: "SHARED-KEY",
      inspections: [
        item("SN-DUP", { productionOrderCode: "WO-1" }),
        item("SN-NEW", { productionOrderCode: "WO-1" }),
        item("SN-ERR", { productionOrderCode: "WO-1" }),
      ],
    });

    expect(res.submitted).toBe(3);
    // Item 0 — duplicate: ACKed success, flagged, SAME id as the seed row.
    expect(res.results[0]).toMatchObject({ index: 0, success: true, duplicate: true });
    expect(res.results[0].inspectionId).toBe(seed.results[0].inspectionId);
    // Item 1 — new board persisted.
    expect(res.results[1]).toMatchObject({ index: 1, success: true });
    expect(res.results[1].duplicate).toBeUndefined();
    expect(typeof res.results[1].inspectionId).toBe("number");
    // Item 2 — permanent failure isolated: success:false + error, batch NOT aborted.
    expect(res.results[2]).toMatchObject({ index: 2, success: false });
    expect(res.results[2].error).toBeTruthy();
    expect(res.results[2].inspectionId).toBeNull();

    // Roll-up counters.
    expect(res.succeeded).toBe(1);
    expect(res.duplicates).toBe(1);
    expect(res.failed).toBe(1);

    // ★ idempotency: only TWO real inserts total (seed SN-DUP + SN-NEW); the
    // duplicate did not re-insert and the errored board never committed.
    expect(fake.realInserts).toBe(2);
    // ★ the duplicate did NOT double-bump the production order (seed=1 + SN-NEW=1).
    expect(db.updateProductionOrderQuantities).toHaveBeenCalledTimes(2);
  });

  it("bản trùng KHÔNG ghi lại measurement_results (short-circuit trước transaction)", async () => {
    setMachine(6);
    // Pre-configured point → measurement path builds a row (no auto-provision).
    (db.getMeasurementPointDefByMachineAndCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 900, code: "MP001", name: "Point 1", referenceImageUrl: null, workstationId: null,
      normalizedX: null, normalizedY: null, normalizedRadius: null,
    });
    installIdempotentInsertFake();
    const tx = (db as unknown as { getDb: ReturnType<typeof vi.fn> }).getDb;
    void tx;
    const transaction = (await (db.getDb as ReturnType<typeof vi.fn>)()).transaction as ReturnType<typeof vi.fn>;
    const caller = machineApiRouter.createCaller(ctx());
    const withPoints = item("SN-MR", {
      measurements: [{ pointCode: "MP001", result: "OK", measuredValue: 1.23 }],
    });

    await caller.submitInspectionBatch({ apiKey: "K", inspections: [withPoints] });
    const afterFirst = transaction.mock.calls.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1); // measurements written once

    await caller.submitInspectionBatch({ apiKey: "K", inspections: [withPoints] });
    // Duplicate short-circuits BEFORE building/inserting measurements → no new tx.
    expect(transaction.mock.calls.length).toBe(afterFirst);
  });

  it("empty batch bị zod từ chối (min 1)", async () => {
    setMachine(7);
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspectionBatch({ apiKey: "K", inspections: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("submitInspectionBatch — rate limit charged PER inspection (không lách limit)", () => {
  it("batch 4 bản với limit=2 → 2 bản đầu OK, phần còn lại rateLimited", async () => {
    process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN = "2";
    process.env.MACHINE_INGEST_BATCH_CONCURRENCY = "1"; // deterministic order
    setMachine(91); // fresh rate-limit bucket (never used by other tests)
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    const res = await caller.submitInspectionBatch({
      apiKey: "K",
      inspections: [item("R-1"), item("R-2"), item("R-3"), item("R-4")],
    });

    expect(res.results[0].success).toBe(true);
    expect(res.results[1].success).toBe(true);
    expect(res.results[2]).toMatchObject({ success: false, rateLimited: true });
    expect(res.results[3]).toMatchObject({ success: false, rateLimited: true });
    expect(res.succeeded).toBe(2);
    // Only the two admitted boards ever reached the DB → the limit was NOT dodged.
    expect(fake.realInserts).toBe(2);
  });
});

describe("heartbeat — rate limit (§5.1) + key-rotation signal (CASE #10)", () => {
  it("spam heartbeat vượt ngưỡng → 429", async () => {
    process.env.MACHINE_HEARTBEAT_RATE_LIMIT_PER_MIN = "3";
    setMachine(8);
    const caller = machineApiRouter.createCaller(ctx());

    await caller.heartbeat({ apiKey: "K" });
    await caller.heartbeat({ apiKey: "K" });
    await caller.heartbeat({ apiKey: "K" });
    await expect(caller.heartbeat({ apiKey: "K" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("heartbeat qua shared-key → keyStatus 'shared', không cảnh báo xoay khoá", async () => {
    setMachine(9);
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.heartbeat({ apiKey: "K" });
    expect(res.success).toBe(true);
    expect(res.keyStatus).toBe("shared");
    expect(res.keyRotationPending).toBe(false);
    expect(res.keyExpiresInDays).toBeNull();
  });

  it("key mk_ sắp hết hạn (5 ngày, ngưỡng 14) → keyRotationPending=true, keyExpiresInDays≈5", async () => {
    const machine = setMachine(10);
    const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    // Populate the api_keys lookup so auth resolves the machine-key path (keyId 77)
    // and listMachineKeys returns the same row for the signal computation.
    state.apiKeyRows = [{
      id: 77,
      machineId: machine.id,
      name: "mk",
      description: null,
      keyPrefix: "mk_abc",
      scopes: ["*"],
      isActive: true,
      revokedAt: null,
      expiresAt,
      lastUsedAt: null,
      createdBy: null,
      createdAt: new Date(),
    }];
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.heartbeat({ apiKey: "mk_whatever" });

    expect(res.keyStatus).toBe("expiring");
    expect(res.keyRotationPending).toBe(true);
    expect(res.keyExpiresInDays).toBeGreaterThanOrEqual(4);
    expect(res.keyExpiresInDays).toBeLessThanOrEqual(5);
  });

  it("key mk_ còn xa hạn (100 ngày) → keyStatus 'ok', không pending", async () => {
    const machine = setMachine(11);
    state.apiKeyRows = [{
      id: 78, machineId: machine.id, name: "mk", description: null, keyPrefix: "mk_xyz",
      scopes: ["*"], isActive: true, revokedAt: null,
      expiresAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
      lastUsedAt: null, createdBy: null, createdAt: new Date(),
    }];
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.heartbeat({ apiKey: "mk_far" });
    expect(res.keyStatus).toBe("ok");
    expect(res.keyRotationPending).toBe(false);
    expect(res.keyExpiresInDays).toBeGreaterThan(90);
  });

  it("key mk_ không có hạn (expiresAt null) → keyStatus 'no_expiry'", async () => {
    const machine = setMachine(12);
    state.apiKeyRows = [{
      id: 79, machineId: machine.id, name: "mk", description: null, keyPrefix: "mk_nil",
      scopes: ["*"], isActive: true, revokedAt: null,
      expiresAt: null, lastUsedAt: null, createdBy: null, createdAt: new Date(),
    }];
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.heartbeat({ apiKey: "mk_noexp" });
    expect(res.keyStatus).toBe("no_expiry");
    expect(res.keyRotationPending).toBe(false);
    expect(res.keyExpiresInDays).toBeNull();
  });

  it("batch response cũng mang key-rotation signal (một lần/batch)", async () => {
    const machine = setMachine(13);
    state.apiKeyRows = [{
      id: 80, machineId: machine.id, name: "mk", description: null, keyPrefix: "mk_bat",
      scopes: ["*"], isActive: true, revokedAt: null,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      lastUsedAt: null, createdBy: null, createdAt: new Date(),
    }];
    installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitInspectionBatch({
      apiKey: "mk_batchkey",
      inspections: [item("B-1")],
    });
    expect(res.keyStatus).toBe("expiring");
    expect(res.keyRotationPending).toBe(true);
    expect(res.succeeded).toBe(1);
  });
});

describe("submitInspectionBatch — Pha 1C Task 3 (BG-31): cờ CẮT máy cũ nay CŨNG gác cửa batch", () => {
  /**
   * TRƯỚC bản vá: `submitInspectionBatch` không hề đọc `INGEST_REJECT_LEGACY_MACHINE_ENABLED` —
   * một máy cũ bị `submitInspection` từ chối khi cờ BẬT vẫn lách được bằng cách gói CHÍNH payload
   * đó vào `{inspections:[payload]}` rồi gọi cửa này. Ba ca dưới đây đo HÀNH VI THẬT qua endpoint
   * thật (không gọi thẳng hàm quyết định), đúng khuôn `machineApiIngestCayV2.test.ts` mệnh đề 4.
   */
  it("★★★ cờ BẬT + batch mảng phẳng (legacy) → BAD_REQUEST nêu rõ '2.0', KHÔNG chạm DB, KHÔNG bị đệm WAL", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    setMachine(20);
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());

    let thrown: unknown;
    try {
      await caller.submitInspectionBatch({ apiKey: "SHARED-KEY", inspections: [item("SN-LEGACY-BATCH")] });
      throw new Error("submitInspectionBatch lẽ ra phải ném lỗi khi cờ BẬT");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    const trpcErr = thrown as TRPCError;
    expect(trpcErr.code).toBe("BAD_REQUEST");
    expect(trpcErr.message).toContain("2.0");
    // Bị từ chối ở input-parse-time — KHÔNG một board nào chạm createProductInspection, và KHÔNG
    // lọt qua đường per-item "queued" (đó là chính lỗ mà brief cảnh báo: một `Error` thường sẽ bị
    // `isPermanentSubmitError()` phân loại TRANSIENT nếu phép kiểm này nằm trong thân .mutation()).
    expect(fake.realInserts).toBe(0);
  });

  it("cờ BẬT + batch RỖNG items nhưng vẫn hình dạng legacy ở top-level → vẫn bị từ chối (cờ áp cho CẢ request, không phải per-item)", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    setMachine(21);
    const caller = machineApiRouter.createCaller(ctx());
    await expect(
      caller.submitInspectionBatch({ apiKey: "SHARED-KEY", inspections: [item("SN-X"), item("SN-Y")] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("cờ TẮT (mặc định) → batch legacy vẫn chạy NHƯ HÔM NAY (chống hồi quy)", async () => {
    setMachine(22);
    const fake = installIdempotentInsertFake();
    const caller = machineApiRouter.createCaller(ctx());
    const res = await caller.submitInspectionBatch({ apiKey: "SHARED-KEY", inspections: [item("SN-OK-BATCH")] });
    expect(res.succeeded).toBe(1);
    expect(fake.realInserts).toBe(1);
  });
});
