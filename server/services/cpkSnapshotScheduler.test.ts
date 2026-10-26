/**
 * Doc 31 OP9 — the periodic Cpk snapshot job writes cpk_history.
 * Integration: seed a point with spec limits + N measured values, run the job,
 * assert a cpk_history row was written for that point over the window.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../routers";
import * as db from "../db";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  cpkHistory,
} from "../../drizzle/schema";
import { runCpkSnapshotNow } from "./cpkSnapshotScheduler";
import { issueMachineKey } from "./machineAuthService";

// runCpkSnapshotNow quét MỌI điểm đo có giới hạn (~1 500 trên _test) và chạy một truy vấn SPC cho mỗi điểm (~0,3 s/điểm đo được ⇒ >8 phút) — vượt mọi trần hợp lý của một ca.
// Ca này kiểm LOGIC bộ lập lịch (tính Cpk + ghi cpk_history) trên điểm đo ĐÃ GIEO ⇒ chỉ thu hẹp DANH SÁCH điểm về điểm của ca (mọi thứ còn lại — truy vấn SPC, ước lượng σ, ghi lịch sử — là mã thật).
const G = vi.hoisted(() => ({ ids: [] as number[] }));
vi.mock("../db/spc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/spc")>();
  return { ...actual, listPointDefsWithSpecLimits: async () => (await actual.listPointDefsWithSpecLimits()).filter((d) => G.ids.includes(d.id)) };
});

const STAMP = Date.now();
let API_KEY = ""; // khoá mk_ cấp trong beforeAll
const MODEL_CODE = `OP9_MODEL_${STAMP}`;
const POINT_CODE = `OP9_PT_${STAMP}`;
const CONST_CODE = `OP9_CONST_${STAMP}`;

let machineId: number;
let productModelId: number;
let pointDefId: number;
let constPointDefId: number;
const inspectionIds: number[] = [];

function caller() {
  return appRouter.createCaller({ user: null } as never);
}

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, code: `OP9-${STAMP}`, name: "OP9 cpk snapshot test", machineType: "AOI", isActive: true,
  });
  // Đường xác thực MẠNH hiện hành (doc 51-P0): khoá riêng mk_ của máy, KHÔNG phải shared-key trên cột machines.apiKey
  // (MachineAuth từ chối đường yếu — cờ không được nới).
  const cred = await issueMachineKey({ machineId, name: `op9-cpk-${STAMP}`, scopes: ["ingest:write"] });
  API_KEY = cred.plaintextKey;
  productModelId = dangKyModelSanPhamTest(await db.createProductModel({ code: MODEL_CODE, name: "OP9 test model" }));
  pointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: POINT_CODE,
    name: "OP9 dimensional point",
    measurementType: "DIMENSION",
    lowerLimit: "9",
    upperLimit: "11",
    nominalValue: "10",
    positionX: 10,
    positionY: 10,
  });
  // Điểm thứ hai: dữ liệu HẰNG (σ ≈ 0 / nhiễu dấu phẩy động) — trước đây Cp ~ 1e14 làm tràn decimal(10,4) và INSERT lỗi.
  constPointDefId = await db.createMeasurementPointDef({
    productModelId,
    code: CONST_CODE,
    name: "OP9 constant point",
    measurementType: "DIMENSION",
    lowerLimit: "9",
    upperLimit: "11",
    nominalValue: "10",
    positionX: 20,
    positionY: 20,
  });

  // 12 in-spec values around nominal 10 (spread so σ > 0).
  const values = [9.8, 10.1, 9.9, 10.2, 10.0, 9.7, 10.3, 9.95, 10.05, 9.85, 10.15, 10.0];
  for (let i = 0; i < values.length; i++) {
    const r = await caller().machineApi.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-OP9-${STAMP}-${i}`,
      productModel: MODEL_CODE,
      overallResult: "OK",
      measurements: [
        { pointCode: POINT_CODE, result: "OK", measuredValue: values[i] },
        { pointCode: CONST_CODE, result: "OK", measuredValue: 10.01 },
      ],
    });
    inspectionIds.push(r.inspectionId!);
  }
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    await d.delete(cpkHistory).where(inArray(cpkHistory.measurementPointDefId, [pointDefId, constPointDefId]));
    if (inspectionIds.length) {
      await d.delete(measurementResults).where(inArray(measurementResults.inspectionId, inspectionIds));
      // product_inspections là bảng WORM (mig 0224/0279): avi_app KHÔNG có DELETE ⇒ hàng của lượt này ở lại (serial/mã có STAMP riêng).
    }
    await d.delete(measurementPointDefs).where(inArray(measurementPointDefs.id, [pointDefId, constPointDefId]));
  }
  if (machineId) await db.deleteMachine(machineId);
});

describe("runCpkSnapshotNow (OP9)", () => {
  it("computes + persists a cpk_history snapshot for a capable point", async () => {
    G.ids = [pointDefId];
    const stats = await runCpkSnapshotNow({ minSamples: 5, windowDays: 3650 });
    expect(stats.snapshotted).toBeGreaterThanOrEqual(1);

    const d = await db.getDb();
    const rows = await d!
      .select()
      .from(cpkHistory)
      .where(eq(cpkHistory.measurementPointDefId, pointDefId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const snap = rows[rows.length - 1];
    expect(snap.sampleSize).toBe(12);
    expect(Number(snap.usl)).toBe(11);
    expect(Number(snap.lsl)).toBe(9);
    expect(snap.cpk).not.toBeNull();
    expect(Number(snap.mean)).toBeGreaterThan(9);
    expect(Number(snap.mean)).toBeLessThan(11);
    expect(stats.points).toBe(1); // danh sách đã thu hẹp về điểm của ca (xem vi.mock ở đầu tệp)
  }, 60_000);

  it("★ dữ liệu HẰNG (σ ≈ 0): KHÔNG lỗi, ghi hàng với mọi chỉ số năng lực = NULL, stdDev = 0, đếm vào stats.degenerate; dữ liệu thường vẫn như cũ", async () => {
    G.ids = [constPointDefId, pointDefId];
    const stats = await runCpkSnapshotNow({ minSamples: 5, windowDays: 3650 });
    expect(stats.points).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.snapshotted).toBe(2);
    expect(stats.degenerate).toBe(1);
    const d = await db.getDb();
    const hang = await d!.select().from(cpkHistory).where(eq(cpkHistory.measurementPointDefId, constPointDefId));
    expect(hang.length).toBeGreaterThanOrEqual(1);
    const h = hang[hang.length - 1]!;
    expect(h.sampleSize).toBe(12);
    for (const k of ["cp", "cpk", "pp", "ppk", "cpl", "cpu"] as const) expect(h[k], k).toBeNull();
    expect(Number(h.stdDev)).toBe(0);
    expect(Number(h.mean)).toBeCloseTo(10.01, 6);
    const thuong = await d!.select().from(cpkHistory).where(eq(cpkHistory.measurementPointDefId, pointDefId));
    expect(thuong[thuong.length - 1]!.cpk).not.toBeNull(); // điểm σ > 0 không bị ảnh hưởng
    // Giao diện SPC: xu hướng Cpk của điểm hằng KHÔNG coi NULL là 0 (trước: latestCpk = 0 ⇒ cảnh báo "critical" giả); điểm thường vẫn có Cpk.
    const { cpkTrendRouter } = await import("../routers/spcAdvancedRouter");
    const admin = cpkTrendRouter.createCaller({ user: { id: 1, role: "admin", name: "adm", openId: "adm", twoFactorEnabled: true } } as never);
    const xuHuong = await admin.trend({ measurementPointDefId: constPointDefId });
    expect(xuHuong.latestCpk).toBeNull();
    expect(xuHuong.alert).toBeNull();
    expect(xuHuong.data[0]!.cpk).toBeNull();
    const xuHuongThuong = await admin.trend({ measurementPointDefId: pointDefId });
    expect(xuHuongThuong.latestCpk).not.toBeNull();
  }, 60_000);
});

describe("chuanHoaChiSoGhi (thuần)", () => {
  it("σ ≈ 0 ⇒ NULL cả sáu chỉ số + stdDev '0'; σ thường ⇒ giữ nguyên; giá trị ≥ 1e6 ⇒ NULL (không tràn decimal(10,4)); giá trị âm lớn hợp lệ giữ", async () => {
    const { chuanHoaChiSoGhi } = await import("./cpkSnapshotScheduler");
    const hang = chuanHoaChiSoGhi({ cp: 5.9e14, cpk: -4.2e12, pp: null, ppk: null, cpl: 1e15, cpu: -4e12, mean: 2.01, overallStdDev: 9.1e-16 }, 9.1e-16);
    expect(hang).toMatchObject({ stdDev: "0", cp: null, cpk: null, pp: null, ppk: null, cpl: null, cpu: null, degenerate: true });
    const thuong = chuanHoaChiSoGhi({ cp: 1.5, cpk: 1.2, pp: 1.4, ppk: 1.1, cpl: 1.2, cpu: 1.8, mean: 10, overallStdDev: 0.1 }, 0.09);
    expect(thuong).toMatchObject({ stdDev: "0.1", cp: "1.5", cpk: "1.2", degenerate: false });
    const tran = chuanHoaChiSoGhi({ cp: 2e6, cpk: -2e6, pp: 999999.5, ppk: -3.5, cpl: 1, cpu: 2, mean: 10, overallStdDev: 0.001 }, 0.001);
    expect(tran).toMatchObject({ cp: null, cpk: null, pp: "999999.5", ppk: "-3.5", degenerate: false });
    // ngưỡng tỉ lệ theo |mean|: mean lớn, σ 1e-7 vẫn là nhiễu (1e-9 × 1e6 = 1e-3)
    expect(chuanHoaChiSoGhi({ cp: 1e10, cpk: 1e10, mean: 1e6, overallStdDev: 1e-7 }, 1e-7).degenerate).toBe(true);
  });
});
