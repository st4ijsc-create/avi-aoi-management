/**
 * Doc 27 Đợt 2 / W2-C ↔ W2-D seam — SOFT commissioning gate tag on ingest
 * (gaps C4/M8). Integration test against the isolated test DB:
 *
 *   • machine WITHOUT a signed commissioning record → submission ACCEPTED and
 *     TAGGED product_inspections.ingestMode = 'commissioning' (never rejected)
 *   • machine WITH a signed ('commissioned') record → untagged (NULL)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import { aoiCommissioningRecords, productInspections } from "../../drizzle/schema";
import { invalidateAoiCommissioningCache } from "../services/aoiCommissioningService";
// ── Xác thực: KHAI BÁO TƯỜNG MINH, không mượn mặc định ───────────────────────────
// Các ca trong file này đo LOGIC INGEST (gate, phân loại lỗi, phạm vi ghi…), không đo
// xác thực. Từ 2026-08-22 (mig 0334) hai đường yếu mặc định `deny`, nên nền mà chúng
// vẫn ngầm dựa vào không còn nữa.
//
// ⚠ Một bộ test mượn mặc định ngầm là một bộ test sẽ NÓI DỐI vào ngày mặc định đổi:
// nó đỏ vì một lý do hoàn toàn khác thứ nó đang canh, và người đọc kết quả sẽ đi sửa
// nhầm chỗ. Khai ra đây thì mỗi file tự nói mình đang đứng trên nền nào.
//
// Đường MẠNH (khoá `mk_` riêng từng máy) có test riêng, KHÔNG bị nới ở đây:
//   server/routers/machineApiBatchIngest.test.ts
process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
process.env.MACHINE_CODE_ONLY_ALLOWED = "true";

const STAMP = Date.now();
const API_KEY = `W2C-COMM-${STAMP}`;
let machineId: number;
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, // soft-ref (no FK on master data yet — gap M1, Đợt 3)
    code: `W2C-COMM-${STAMP}`,
    name: "W2-C commissioning-tag test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
  invalidateAoiCommissioningCache(machineId);
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (machineId) {
      await d.delete(aoiCommissioningRecords).where(eq(aoiCommissioningRecords.machineId, machineId));
    }
    for (const id of inspectionIds) {
      await d.delete(productInspections).where(eq(productInspections.id, id));
    }
  }
  if (machineId) await db.deleteMachine(machineId);
  invalidateAoiCommissioningCache();
});

describe("submitInspection × commissioning gate (SOFT — tag, never reject)", () => {
  it("machine without a commissioning record → submission tagged 'commissioning'", async () => {
    const caller = appRouter.createCaller({ user: null } as never);
    const r = await caller.machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-COMM-${STAMP}-1`,
      overallResult: "OK",
      measurements: [],
    });
    expect(r.success).toBe(true);
    expect(r.inspectionId).toBeTruthy();
    inspectionIds.push(r.inspectionId!);

    const inspection = await db.getProductInspectionById(r.inspectionId!);
    expect(inspection?.ingestMode).toBe("commissioning");
  });

  it("machine with a signed 'commissioned' record → submission untagged (NULL)", async () => {
    const d = await db.getDb();
    await d!.insert(aoiCommissioningRecords).values({
      machineId,
      status: "commissioned",
      signedBy: 1,
      signedAt: new Date(),
      note: "W2-C test sign-off",
    });
    invalidateAoiCommissioningCache(machineId); // mutation seam contract

    const caller = appRouter.createCaller({ user: null } as never);
    const r = await caller.machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-COMM-${STAMP}-2`,
      overallResult: "OK",
      measurements: [],
    });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const inspection = await db.getProductInspectionById(r.inspectionId!);
    expect(inspection?.ingestMode).toBeNull();
  });
});
