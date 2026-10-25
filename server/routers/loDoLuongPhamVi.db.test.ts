/**
 * CỔNG CSDL THẬT — lô L6a-2 (rà bảo mật tRPC, 2026-10-25): ĐỌC của productionDashboard · reportingMart · measurementCorrections · stationTriangulation.correlationMatrix · spc (controlChart · topNGPoints) theo PHẠM VI người dùng.
 * Lỗ: người nhà máy A xem sản lượng / yield / lỗi / xu hướng / mart / hiệu chỉnh đo / tương quan trạm / biểu đồ kiểm soát gồm số liệu của MỌI nhà máy;
 * bộ nhớ đệm `getStationOverview` khóa chỉ theo input ⇒ người B nhận bản của A.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";

const RUN = `l6d${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = { dash: any; mart: any; corr: any; tri: any; spc: any };
let cA: C, cAdm: C, cRong: C;
let maB2 = 0;
const homQua = new Date(Date.now() - 86_400_000);
const ngayMai = new Date(Date.now() + 86_400_000);
const dstr = (d: Date) => d.toISOString().slice(0, 10);
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [d, m, c, t, s] = await Promise.all([
    import("./productionDashboardRouter").then((x) => x.productionDashboardRouter.createCaller(ctx)),
    import("./reportingMartRouter").then((x) => x.reportingMartRouter.createCaller(ctx)),
    import("./measurementCorrectionsRouter").then((x) => x.measurementCorrectionsRouter.createCaller(ctx)),
    import("./stationTriangulationRouter").then((x) => x.stationTriangulationRouter.createCaller(ctx)),
    import("./spcAnalysisRouter").then((x) => x.spcAnalysisRouter.createCaller(ctx)),
  ]);
  return { dash: d, mart: m, corr: c, tri: t, spc: s };
};

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6d", [], dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  // mart theo giờ: một hàng mỗi nhà máy trên cùng mẫu sản phẩm / ca
  const gio = new Date().toISOString().slice(0, 13) + ":00:00";
  for (const nm of [H.A, H.B]) {
    await H.dung(sql`INSERT INTO fact_inspection_hourly ("bucketHour", "factoryId", "machineId", "productModelId", "shiftCode", "totalCount", "okCount", "ngCount", "ntfCount") VALUES (${gio}, ${nm.fid}, ${nm.mid}, ${H.modelId}, ${RUN}, 10, 7, 3, 0)`);
  }
  // hiệu chỉnh đo (measurement_corrections) mỗi nhà máy một dòng
  for (const nm of [H.A, H.B]) {
    await H.dung(sql`INSERT INTO measurement_corrections ("measurementResultId", "inspectionId", "machineId", "pointDefId", "originalResult", "correctedResult", source, "operatorUserId") VALUES (${nm.mr}, ${nm.insp}, ${nm.mid}, ${H.pointId}, 'NG', 'OK', 'correct_result', ${H.uA.id})`);
  }
  // máy chỉ có hiệu chỉnh (không có lần kiểm NG trong cửa sổ) ở nhà máy B — vẫn phải ẩn với A
  const [b2] = await H.dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${H.B.sid}, ${H.B.code + "2"}, ${H.B.code + "2"}, 'AOI') RETURNING id`);
  maB2 = Number(b2.id);
  await H.dung(sql`INSERT INTO measurement_corrections ("inspectionId", "machineId", "originalResult", "correctedResult", source, "operatorUserId") VALUES (${H.B.insp}, ${maB2}, 'NG', 'OK', 'correct_result', ${H.uA.id})`);
  // mẫu đo theo lô (tương quan trạm): mỗi nhà máy 1 trạm riêng, 3 serial
  for (const [nm, st] of [[H.A, RUN + "SA"], [H.B, RUN + "SB"]] as const) {
    for (let i = 0; i < 3; i++) {
      await H.dung(sql`INSERT INTO measurement_samples ("pointDefId", "machineId", "serialNumber", "stationCode", value, "isOk", "lotCode", "sampledAt") VALUES (${H.pointId}, ${nm.mid}, ${nm.code + "-L" + i}, ${st}, ${1 + i}, ${i !== 1}, ${RUN + "-LOT"}, now())`);
    }
  }
  // giá trị đo cho biểu đồ kiểm soát: mỗi nhà máy 3 kết quả có measuredValue trên lần kiểm của mình
  for (const nm of [H.A, H.B]) {
    for (let i = 0; i < 3; i++) {
      await H.dung(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "measuredValue") VALUES (${nm.insp}, ${H.pointId}, 'OK', ${10 + i})`);
    }
  }
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 240_000);

afterAll(async () => {
  if (H) {
    await qChuTest(`DELETE FROM fact_inspection_hourly WHERE "shiftCode" = '${RUN}'`).catch(() => undefined);
    await qChuTest(`DELETE FROM measurement_corrections WHERE "inspectionId" IN (SELECT id FROM product_inspections WHERE "serialNumber" LIKE '${RUN}%')`).catch(() => undefined);
    await qChuTest(`DELETE FROM measurement_samples WHERE "lotCode" = '${RUN}-LOT'`).catch(() => undefined);
    await H.don();
  }
});

const khung = { startDate: homQua, endDate: ngayMai };

describe("★★★ productionDashboard — ĐỌC theo phạm vi", () => {
  it("getStationOverview — A chỉ thấy trạm A; bộ nhớ đệm không đưa bản của A cho B (gọi A rồi gọi người không phạm vi cùng input)", async () => {
    const lay = async (c: C, o: object) => (await c.dash.getStationOverview({ ...khung, ...o })).map((r: { station: { id: number } }) => r.station.id);
    expect(await lay(cA, { lineId: H.A.lid })).toContain(H.A.sid);
    expect(await lay(cA, { lineId: H.B.lid })).not.toContain(H.B.sid);
    expect(await lay(cAdm, { lineId: H.B.lid })).toContain(H.B.sid);
    // cùng input với bản A đã nạp đệm ⇒ người không gán nhà máy KHÔNG được thấy trạm A
    expect(await lay(cRong, { lineId: H.A.lid })).not.toContain(H.A.sid);
  });
  it("getFalseCallEscape — A không thấy số của máy B (khai machineId của B ⇒ 0)", async () => {
    const tong = async (c: C, o: object) => JSON.stringify(await c.dash.getFalseCallEscape({ startDate: dstr(homQua), endDate: dstr(ngayMai), ...o }));
    const b = JSON.parse(await tong(cA, { machineId: H.B.mid }));
    const bAdm = JSON.parse(await tong(cAdm, { machineId: H.B.mid }));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(bAdm));
  });
  it("getDefectAnalysis — số lỗi của điểm đo chung (lọc theo chuyền: bảng 15 dòng đầu không bị dữ liệu lạ chen): A thấy chuyền A (1) · chuyền B (0) · admin thấy chuyền B (1) · không phạm vi 0", async () => {
    const dem = async (c: C, lineId: number) => {
      const r = await c.dash.getDefectAnalysis({ ...khung, lineId });
      return (r.defectsByType as { pointDefId: number; ngCount: number }[]).filter((x) => x.pointDefId === H.pointId).reduce((s, x) => s + Number(x.ngCount), 0);
    };
    expect(await dem(cA, H.A.lid)).toBe(1);
    expect(await dem(cA, H.B.lid)).toBe(0);
    expect(await dem(cAdm, H.B.lid)).toBe(1);
    expect(await dem(cAdm, H.A.lid)).toBe(1);
    expect(await dem(cRong, H.A.lid)).toBe(0);
  });
  it("getTrendData / getSpcSummary — A không thấy máy B (lọc theo chuyền B ⇒ rỗng)", async () => {
    expect((await cA.dash.getTrendData({ ...khung, lineId: H.B.lid })).length).toBe(0);
    expect((await cAdm.dash.getTrendData({ ...khung, lineId: H.B.lid })).length).toBeGreaterThan(0);
    expect((await cA.dash.getSpcSummary({ ...khung, lineId: H.B.lid })).length).toBe(0);
    expect((await cAdm.dash.getSpcSummary({ ...khung, lineId: H.B.lid })).length).toBeGreaterThan(0);
    expect((await cA.dash.getTrendData({ ...khung, lineId: H.A.lid })).length).toBeGreaterThan(0);
    expect((await cRong.dash.getTrendData({ ...khung, lineId: H.A.lid })).length).toBe(0);
  });
});

describe("★★★ reportingMart — ĐỌC theo phạm vi", () => {
  const w = () => ({ startDate: dstr(homQua), endDate: dstr(ngayMai), productModelId: H.modelId });
  it("yieldByShift / productMix / yieldTrendHourly — tổng của A = 10 (chỉ máy A); admin 20; không phạm vi 0", async () => {
    const tong = (rows: { total: number }[]) => rows.reduce((s, r) => s + r.total, 0);
    expect(tong(await cA.mart.yieldByShift(w()))).toBe(10);
    expect(tong(await cAdm.mart.yieldByShift(w()))).toBe(20);
    expect(tong(await cRong.mart.yieldByShift(w()))).toBe(0);
    expect(tong(await cA.mart.productMix(w()))).toBe(10);
    expect(tong(await cAdm.mart.productMix(w()))).toBe(20);
    expect(tong(await cA.mart.yieldTrendHourly(w()))).toBe(10);
    expect(tong(await cAdm.mart.yieldTrendHourly(w()))).toBe(20);
  });
});

describe("★★★ measurementCorrections — ĐỌC theo phạm vi", () => {
  const r = () => ({ startDate: dstr(homQua), endDate: dstr(ngayMai) });
  it("machineFalseCallSummary — A thấy máy A, không thấy máy B; admin thấy cả hai", async () => {
    const ms = (rows: { machineId: number }[]) => rows.map((x) => x.machineId);
    const a = ms(await cA.corr.machineFalseCallSummary({ ...r(), limit: 100 }));
    expect(a).not.toContain(H.B.mid);
    const adm = ms(await cAdm.corr.machineFalseCallSummary({ ...r(), machineId: H.B.mid }));
    expect(adm).toContain(H.B.mid);
    expect(ms(await cA.corr.machineFalseCallSummary({ ...r(), machineId: H.B.mid }))).not.toContain(H.B.mid);
    expect(ms(await cRong.corr.machineFalseCallSummary({ ...r(), machineId: H.A.mid }))).not.toContain(H.A.mid);
    // máy chỉ có hiệu chỉnh (không lần kiểm NG): nhà máy B — A không thấy, admin thấy
    expect(ms(await cA.corr.machineFalseCallSummary({ ...r(), machineId: maB2 }))).not.toContain(maB2);
    expect(ms(await cAdm.corr.machineFalseCallSummary({ ...r(), machineId: maB2 }))).toContain(maB2);
  });
  it("agreementTrend — khai machineId của B: A thấy 0, admin thấy ≥ 1", async () => {
    const tong = (rows: Record<string, unknown>[]) => rows.reduce((s, x) => s + Object.values(x).filter((v) => typeof v === "number").reduce((a: number, b) => a + (b as number), 0), 0);
    expect(tong(await cA.corr.agreementTrend({ ...r(), machineId: H.B.mid }))).toBe(0);
    expect(tong(await cAdm.corr.agreementTrend({ ...r(), machineId: H.B.mid }))).toBeGreaterThan(0);
  });
});

describe("★★★ stationTriangulation.correlationMatrix + spc — ĐỌC theo phạm vi", () => {
  it("correlationMatrix — chỉ trạm của mẫu máy A", async () => {
    const st = (m: unknown) => JSON.stringify(m);
    expect(st(await cA.tri.correlationMatrix({ lotCode: RUN + "-LOT" }))).toContain(RUN + "SA");
    expect(st(await cA.tri.correlationMatrix({ lotCode: RUN + "-LOT" }))).not.toContain(RUN + "SB");
    expect(st(await cAdm.tri.correlationMatrix({ lotCode: RUN + "-LOT" }))).toContain(RUN + "SB");
    expect(st(await cRong.tri.correlationMatrix({ lotCode: RUN + "-LOT" }))).not.toContain(RUN + "SA");
  });
  it("spc.controlChart — số mẫu: A 3 · admin 6 · không phạm vi 0; khai machineId của B ⇒ A 0", async () => {
    const q = { measurementPointDefId: H.pointId, chartType: "individual_mr" as const, subgroupSize: 2, startDate: homQua.toISOString(), endDate: ngayMai.toISOString() };
    expect((await cA.spc.controlChart(q)).sampleCount).toBe(3);
    expect((await cAdm.spc.controlChart(q)).sampleCount).toBe(6);
    expect((await cRong.spc.controlChart(q)).sampleCount).toBe(0);
    expect((await cA.spc.controlChart({ ...q, machineId: H.B.mid })).sampleCount).toBe(0);
  });
  it("spc.topNGPoints — số NG của điểm đo chung: A 1 · admin 2 (đã có phạm vi qua userId/userRole — khoá hồi quy)", async () => {
    const dem = async (c: C) => {
      const rows = await c.spc.topNGPoints({ startDate: homQua.toISOString(), endDate: ngayMai.toISOString(), productModelId: H.modelId, limit: 50 });
      return (rows as { ngCount: number }[]).reduce((s, x) => s + Number(x.ngCount), 0);
    };
    expect(await dem(cA)).toBe(1);
    expect(await dem(cAdm)).toBe(2);
  });
});
