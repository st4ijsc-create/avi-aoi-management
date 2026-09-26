/**
 * Doc 27 Đợt 2 / W2-C — submitInspection DURABILITY tests (gap C3/R11).
 *
 * Simulates a DB failure mid-submit (createProductInspection rejects) through
 * the REAL tRPC mutation → asserts the payload lands in the disk WAL and the
 * machine gets a `{ success:true, queued:true }` ACK instead of an error; then
 * "recovers" the DB and asserts the backfill replays it through the SAME
 * pipeline EXACTLY ONCE (machine-side duplicate retries + live-retry-then-
 * replay races never double-insert). Also: permanent auth errors still throw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../db", () => {
  // chainable drizzle-ish fake: select().from().where().limit() → dbSelectRows
  const state = { dbSelectRows: [] as unknown[] };
  const fakeDb = {
    select: (..._a: unknown[]) => ({
      from: () => ({
        where: () => ({ limit: async () => state.dbSelectRows }),
        orderBy: () => ({ limit: async () => state.dbSelectRows }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
  };
  return {
    __state: state,
    getDb: vi.fn(async () => fakeDb),
    getMachineByApiKey: vi.fn(),
    getMachineByCode: vi.fn(),
    getMachineById: vi.fn(),
    updateMachineHeartbeat: vi.fn(async () => undefined),
    getProductModelByCode: vi.fn(),
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
  };
});

import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import {
  bufferedInspectionCount,
  backfillInspections,
  getInspectionStoreForwardStatus,
  _resetInspectionStoreForward,
} from "../services/inspection/inspectionStoreForward";
import type { TrpcContext } from "../_core/context";

const MACHINE = { id: 5, code: "AOI-01", name: "AOI Machine", stationId: 1, isActive: true };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function payload(serial: string) {
  return {
    apiKey: "SHARED-KEY",
    serialNumber: serial,
    overallResult: "OK" as const,
    inspectionTime: "2026-07-04T08:00:00.000Z",
    measurements: [],
  };
}

let walPath: string;

beforeEach(() => {
  walPath = path.join(
    os.tmpdir(),
    `insp-wal-router-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  process.env.INSPECTION_STORE_FORWARD_FILE = walPath;
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
  _resetInspectionStoreForward();
  vi.clearAllMocks();
  (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineById as ReturnType<typeof vi.fn>).mockResolvedValue(MACHINE);
  (db.getMachineStats as ReturnType<typeof vi.fn>).mockResolvedValue({
    total: 10, ok: 10, ng: 0, ntf: 0, yieldRate: 100,
  });
  (db.updateMachineHeartbeat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(async () => {
  _resetInspectionStoreForward();
  for (const f of [walPath, walPath.replace(/\.jsonl$/, "") + ".dead.jsonl"]) {
    try {
      await fs.unlink(f);
    } catch {
      /* may not exist */
    }
  }
});

describe("submitInspection durability (kill-DB simulation)", () => {
  it("DB failure mid-submit → queued ACK + WAL entry; recovery → exactly-once insert", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    );

    // 1) submit while the DB is down → ACK with queued:true, payload in the WAL
    const ack = await caller.submitInspection(payload("SN-KILL-1"));
    expect(ack.success).toBe(true);
    expect((ack as { queued?: boolean }).queued).toBe(true);
    expect((ack as { submissionId?: string }).submissionId).toMatch(/^[0-9a-f]{64}$/);
    expect(ack.inspectionId).toBeNull();
    expect(bufferedInspectionCount()).toBe(1);
    const walRaw = await fs.readFile(walPath, "utf8");
    expect(walRaw).toContain("SN-KILL-1");

    // 2) "recovery": inserts succeed again → backfill replays the pipeline
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockResolvedValue(321);
    const bf = await backfillInspections();
    expect(bf.drained).toBe(1);
    expect(bf.remaining).toBe(0);

    // exactly-once: 1 failed attempt + 1 successful replay
    expect(db.createProductInspection).toHaveBeenCalledTimes(2);
    const replayArgs = (db.createProductInspection as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(replayArgs.serialNumber).toBe("SN-KILL-1");
    expect(replayArgs.machineId).toBe(MACHINE.id);

    // a further backfill inserts nothing
    const bf2 = await backfillInspections();
    expect(bf2.drained).toBe(0);
    expect(db.createProductInspection).toHaveBeenCalledTimes(2);
  });

  it("machine-side duplicate retry while DB is down → single WAL entry, single insert", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );

    const first = await caller.submitInspection(payload("SN-RETRY"));
    const second = await caller.submitInspection(payload("SN-RETRY")); // vendor client retry
    expect((first as { submissionId?: string }).submissionId).toBe(
      (second as { submissionId?: string }).submissionId,
    );
    expect(bufferedInspectionCount()).toBe(1);

    // recovery — count ACTUAL successful inserts from here on
    let successfulInserts = 0;
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      successfulInserts += 1;
      return 77;
    });
    const bf = await backfillInspections();
    expect(bf.drained).toBe(1);
    // 2 failed live attempts, then exactly 1 replay insert
    expect(successfulInserts).toBe(1);
  });

  it("live retry after recovery + WAL replay → deduped, never double-inserted", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    );

    await caller.submitInspection(payload("SN-RACE")); // queued
    expect(bufferedInspectionCount()).toBe(1);

    // DB recovers and the MACHINE retries directly (live path wins the race).
    // Count ACTUAL successful inserts from here on.
    let successfulInserts = 0;
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      successfulInserts += 1;
      return 500;
    });
    const live = await caller.submitInspection(payload("SN-RACE"));
    expect(live.inspectionId).toBe(500);

    // let the opportunistic drain (void backfill) settle, then force one more
    await new Promise((r) => setImmediate(r));
    const bf = await backfillInspections();
    expect(bf.remaining).toBe(0);

    // exactly 1 successful insert (the live one); the WAL entry deduped
    expect(successfulInserts).toBe(1);
    expect(getInspectionStoreForwardStatus().deduped).toBeGreaterThanOrEqual(1);
  });

  it("permanent errors (invalid key) still throw — never buffered", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    (db.getMachineByApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await expect(caller.submitInspection(payload("SN-AUTH"))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(bufferedInspectionCount()).toBe(0);
  });

  it("flag OFF → DB failure surfaces as an error (exact old behaviour)", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    const caller = machineApiRouter.createCaller(ctx());
    (db.createProductInspection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );
    await expect(caller.submitInspection(payload("SN-OFF"))).rejects.toThrow();
    expect(bufferedInspectionCount()).toBe(0);
  });
});
