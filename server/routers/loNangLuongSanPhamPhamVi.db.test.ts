/**
 * CỔNG CSDL THẬT — lô L6a-3 (rà bảo mật tRPC, 2026-10-25): ĐỌC của energy (5 + enpi) · realtimeReport · goldenSample (5) · thresholdSuggestion (2) · componentLibrary.linkStats · dashboardStats.overviewCounts · semantics.compute theo PHẠM VI người dùng.
 * Lỗ: người nhà máy A đọc công suất / EnPI / sức khoẻ máy, golden sample (ảnh chuẩn), ngưỡng gợi ý theo điểm đo, thống kê vật liệu, số lượng nhà máy-chuyền-máy và chỉ số KPI của MỌI nhà máy.
 * Luật: dữ liệu theo máy ⇒ chỉ máy trong phạm vi; golden / điểm đo theo sản phẩm ⇒ sản phẩm trong phạm vi; vật liệu theo mã nhà máy; ngoài phạm vi ≡ không tồn tại; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l6e${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = { energy: any; rt: any; golden: any; thr: any; lib: any; dash: any; sem: any };
let cA: C, cAdm: C, cRong: C;
let pmA = 0, pmB = 0, pdA = 0, pdB = 0, gA = 0, gB = 0, gAma = 0, gBma = 0, gKhong = 0, goiId = 0;
const homQua = new Date(Date.now() - 86_400_000);
const ngayMai = new Date(Date.now() + 86_400_000);
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const [e, r, g, t, l, d, s] = await Promise.all([
    import("./energyRouter").then((x) => x.energyRouter.createCaller(ctx)),
    import("./realtimeReportRouter").then((x) => x.realtimeReportRouter.createCaller(ctx)),
    import("./goldenSampleRouter").then((x) => x.goldenSampleRouter.createCaller(ctx)),
    import("./thresholdSuggestionRouter").then((x) => x.thresholdSuggestionRouter.createCaller(ctx)),
    import("./componentLibraryRouter").then((x) => x.componentLibraryRouter.createCaller(ctx)),
    import("./dashboardStatsRouters").then((x) => x.dashboardRouter.createCaller(ctx)),
    import("./semanticsRouter").then((x) => x.semanticsRouter.createCaller(ctx)),
  ]);
  return { energy: e, rt: r, golden: g, thr: t, lib: l, dash: d, sem: s };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6e", [["production", "energy"], ["production", "masterdata"]]);
  const d = H.dung;
  // hai sản phẩm RIÊNG: A chỉ chạy trên máy A, B chỉ trên máy B (vị từ "sản phẩm trong phạm vi" đi qua lần kiểm tra của máy)
  pmA = (await d(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PMA"}, ${RUN}) RETURNING id`))[0].id;
  pmB = (await d(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PMB"}, ${RUN}) RETURNING id`))[0].id;
  for (const [nm, pm] of [[H.A, pmA], [H.B, pmB]] as const) {
    await d(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode") VALUES (${nm.mid}, ${pm}, ${nm.code + "-P2"}, 'OK', 'OK', now(), ${nm.code})`);
  }
  pdA = (await d(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "machineId") VALUES (${pmA}, ${RUN + "-PA"}, ${RUN + "-PA"}, 'DIMENSION', 1, 1, ${H.A.mid}) RETURNING id`))[0].id;
  pdB = (await d(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "machineId") VALUES (${pmB}, ${RUN + "-PB"}, ${RUN + "-PB"}, 'DIMENSION', 1, 1, ${H.B.mid}) RETURNING id`))[0].id;
  for (const [nm, pd] of [[H.A, pdA], [H.B, pdB]] as const) {
    for (let i = 0; i < 12; i++) {
      await d(sql`INSERT INTO measurement_samples ("pointDefId", "machineId", "serialNumber", "stationCode", value, "isOk", "sampledAt") VALUES (${pd}, ${nm.mid}, ${nm.code + "-S" + i}, ${nm.code}, ${10 + (i % 3)}, true, now())`);
    }
  }
  goiId = (await d(sql`INSERT INTO component_packages (code, family) VALUES (${RUN + "-PKG"}, 'test') RETURNING id`))[0].id;
  // năng lượng + EnPI + sức khoẻ máy
  for (const nm of [H.A, H.B]) {
    await d(sql`INSERT INTO energy_readings ("machineId", source, value, unit, "powerKw", "powerFactor", "recipeRef", "timestamp") VALUES (${nm.mid}, 'electricity', 5, 'kWh', 7, 0.9, ${nm.code + "-RC"}, now())`);
    await d(sql`INSERT INTO enpi_metrics ("machineId", "periodStart", "periodEnd", "totalKwh") VALUES (${nm.mid}, now() - interval '1 hour', now(), 3)`);
    await d(sql`INSERT INTO machine_health_history ("machineId", "machineCode", "timestamp", "healthScore", "oeeScore", "uptimeScore", "errorRateScore", "cycleTimeScore") VALUES (${nm.mid}, ${nm.code}, now(), 90, 1, 1, 1, 1)`);
    await d(sql`INSERT INTO materials (code, name, "factoryCode", "packageId") VALUES (${nm.code + "-MAT"}, ${nm.code + "-MAT"}, ${nm.code}, ${goiId})`);
  }
  // B có thêm 3 kết quả OK ⇒ DPMO của B khác A (A 1/1, cả hai 2/5) — để phép so sánh phạm vi có nghĩa
  for (let i = 0; i < 3; i++) await d(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result) VALUES (${H.B.insp}, ${H.pointId}, 'OK')`);
  gA = (await d(sql`INSERT INTO golden_sample_references ("productCode", "productModelId", "grayBase64", width, height, active, status) VALUES (${RUN + "-PMA"}, ${pmA}, 'AA==', 1, 1, true, 'approved') RETURNING id`))[0].id;
  gB = (await d(sql`INSERT INTO golden_sample_references ("productCode", "productModelId", "grayBase64", width, height, active, status) VALUES (${RUN + "-PMB"}, ${pmB}, 'AA==', 1, 1, true, 'approved') RETURNING id`))[0].id;
  // golden cũ theo MÃ (productModelId NULL) và golden không xác định được sản phẩm
  gAma = (await d(sql`INSERT INTO golden_sample_references ("productCode", "recipeCode", "grayBase64", width, height, active, status) VALUES (${RUN + "-PMA"}, 'ma', 'AA==', 1, 1, true, 'approved') RETURNING id`))[0].id;
  gBma = (await d(sql`INSERT INTO golden_sample_references ("productCode", "recipeCode", "grayBase64", width, height, active, status) VALUES (${RUN + "-PMB"}, 'ma', 'AA==', 1, 1, true, 'approved') RETURNING id`))[0].id;
  gKhong = (await d(sql`INSERT INTO golden_sample_references ("productCode", "grayBase64", width, height, active, status) VALUES (${RUN + "-KHONG"}, 'AA==', 1, 1, true, 'approved') RETURNING id`))[0].id;
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const like = `'${RUN}%'`;
  const ms = `${H.A.mid}, ${H.B.mid}`;
  for (const q of [
    `DELETE FROM energy_readings WHERE "machineId" IN (${ms})`,
    `DELETE FROM enpi_metrics WHERE "machineId" IN (${ms})`,
    `DELETE FROM machine_health_history WHERE "machineId" IN (${ms})`,
    `DELETE FROM materials WHERE code LIKE ${like}`,
    `DELETE FROM component_packages WHERE code LIKE ${like}`,
    `DELETE FROM golden_sample_references WHERE "productCode" LIKE ${like}`,
    `DELETE FROM measurement_samples WHERE "serialNumber" LIKE ${like}`,
  ]) await qChuTest(q).catch(() => undefined);
  await H.don();
});

describe("★★★ energy + realtimeReport — ĐỌC theo phạm vi", () => {
  const r = () => ({ from: homQua, to: ngayMai });
  it("peakDemand / powerFactor — công suất đỉnh: A thấy 7 kW (máy A); khai machineId của B ⇒ không thấy; admin thấy máy B", async () => {
    expect((await cA.energy.peakDemand({ ...r(), machineId: H.A.mid })).instantaneousPeakKw).toBe(7);
    expect((await cA.energy.peakDemand({ ...r(), machineId: H.B.mid })).instantaneousPeakKw).toBeNull();
    expect((await cAdm.energy.peakDemand({ ...r(), machineId: H.B.mid })).instantaneousPeakKw).toBe(7);
    expect((await cRong.energy.peakDemand({ ...r(), machineId: H.A.mid })).instantaneousPeakKw).toBeNull();
    expect((await cA.energy.powerFactor({ ...r(), machineId: H.B.mid })).samples).toBe(0);
    expect((await cAdm.energy.powerFactor({ ...r(), machineId: H.B.mid })).samples).toBe(1);
  });
  it("không khai máy: số mẫu PF của A KHÔNG gồm máy B (admin nhiều hơn ≥ 1)", async () => {
    const a = (await cA.energy.powerFactor(r())).samples;
    const adm = (await cAdm.energy.powerFactor(r())).samples;
    expect(adm - a).toBeGreaterThanOrEqual(1);
  });
  it("forecast / demandResponse / recipeEnergy — máy B ngoài phạm vi: rỗng cho A", async () => {
    const fb = await cA.energy.forecast({ ...r(), machineId: H.B.mid });
    const fa = await cAdm.energy.forecast({ ...r(), machineId: H.B.mid });
    expect(JSON.stringify(fb)).not.toBe(JSON.stringify(fa));
    expect((await cA.energy.demandResponse({ ...r(), machineId: H.B.mid, thresholdKw: 1 })).peak.instantaneousPeakKw).toBeNull();
    const re = async (c: C, m: number) => JSON.stringify(await c.energy.recipeEnergy({ ...r(), machineId: m }));
    expect(await re(cA, H.B.mid)).not.toContain(H.B.code);
    expect(await re(cAdm, H.B.mid)).toContain(H.B.code);
    expect(await re(cA, H.A.mid)).toContain(H.A.code);
    const fp = async (c: C) => JSON.stringify(await c.energy.forecast({ ...r(), machineId: H.B.mid, metric: "powerKw" }));
    expect(await fp(cA)).not.toBe(await fp(cAdm));
    const dr = async (c: C) => JSON.stringify((await c.energy.demandResponse({ ...r(), machineId: H.B.mid, thresholdKw: 1 })).forecast);
    expect(await dr(cA)).not.toBe(await dr(cAdm));
  });
  it("enpi / enpiSummary — chỉ EnPI của máy trong phạm vi", async () => {
    const mids = (rows: { machineId: number | null }[]) => rows.map((x) => x.machineId);
    expect(mids(await cA.energy.enpi({ machineId: H.B.mid }))).not.toContain(H.B.mid);
    expect(mids(await cAdm.energy.enpi({ machineId: H.B.mid }))).toContain(H.B.mid);
    expect(mids(await cA.energy.enpi({ machineId: H.A.mid }))).toContain(H.A.mid);
    expect(mids(await cA.rt.enpiSummary({ machineId: H.B.mid }))).not.toContain(H.B.mid);
    expect(mids(await cAdm.rt.enpiSummary({ machineId: H.B.mid }))).toContain(H.B.mid);
    // người không gán nhà máy nào: không khai máy cũng KHÔNG thấy EnPI nào của hai bên
    const tuRong = mids(await cRong.rt.enpiSummary({ limit: 500 }));
    expect(tuRong).not.toContain(H.A.mid);
    expect(tuRong).not.toContain(H.B.mid);
  });
  it("healthSeries — máy B ⇒ chuỗi rỗng cho A, có điểm cho admin", async () => {
    expect((await cA.rt.healthSeries({ machineId: H.B.mid, hours: 24 })).length).toBe(0);
    expect((await cAdm.rt.healthSeries({ machineId: H.B.mid, hours: 24 })).length).toBeGreaterThan(0);
    expect((await cA.rt.healthSeries({ machineId: H.A.mid, hours: 24 })).length).toBeGreaterThan(0);
  });
});

describe("★★★ goldenSample + thresholdSuggestion — ĐỌC theo SẢN PHẨM trong phạm vi", () => {
  it("listManaged / listForProduct / listByProduct — golden của sản phẩm B ẩn với A", async () => {
    const ids = (rows: { id: number }[]) => rows.map((x) => x.id);
    const a = ids(await cA.golden.listForProduct({ productCode: RUN + "-PMB", activeOnly: false }));
    expect(a).not.toContain(gB);
    expect(ids(await cAdm.golden.listForProduct({ productCode: RUN + "-PMB", activeOnly: false }))).toContain(gB);
    expect(ids(await cA.golden.listForProduct({ productCode: RUN + "-PMA", activeOnly: false }))).toContain(gA);
    expect(ids(await cA.golden.listByProduct({ productModelId: pmB }))).not.toContain(gB);
    expect(ids(await cAdm.golden.listByProduct({ productModelId: pmB }))).toContain(gB);
    expect(ids(await cA.golden.listByProduct({ productModelId: pmA }))).toContain(gA);
    const man = ids(await cA.golden.listManaged({ productCode: RUN + "-PMB", activeOnly: false }));
    expect(man).not.toContain(gB);
    expect(ids(await cRong.golden.listManaged({ productCode: RUN + "-PMA", activeOnly: false }))).not.toContain(gA);
  });
  it("golden cũ theo MÃ sản phẩm (productModelId NULL) và golden không xác định được sản phẩm", async () => {
    const ids = (rows: { id: number }[]) => rows.map((x) => x.id);
    const kA = ids(await cA.golden.listManaged({ productCode: RUN + "-PMA", activeOnly: false }));
    expect(kA).toContain(gAma);
    expect(ids(await cA.golden.listManaged({ productCode: RUN + "-PMB", activeOnly: false }))).not.toContain(gBma);
    expect(ids(await cAdm.golden.listManaged({ productCode: RUN + "-PMB", activeOnly: false }))).toContain(gBma);
    expect(ids(await cA.golden.listManaged({ productCode: RUN + "-KHONG", activeOnly: false }))).not.toContain(gKhong);
    expect(ids(await cAdm.golden.listManaged({ productCode: RUN + "-KHONG", activeOnly: false }))).toContain(gKhong);
  });
  it("getActiveForKey / getThumbnail — golden sản phẩm B: A thấy found:false / NOT_FOUND giống không tồn tại", async () => {
    expect((await cA.golden.getActiveForKey({ productCode: RUN + "-PMB" })).found).toBe(false);
    expect((await cAdm.golden.getActiveForKey({ productCode: RUN + "-PMB" })).found).toBe(true);
    expect((await cA.golden.getActiveForKey({ productCode: RUN + "-PMA" })).found).toBe(true);
    const khong = await loi(() => cA.golden.getThumbnail({ id: 2147483000 }));
    expect(await loi(() => cA.golden.getThumbnail({ id: gB }))).toBe(khong);
  });
  it("suggestForPoint / suggestForProductModel — điểm đo & sản phẩm B ẩn với A; sản phẩm A hiện", async () => {
    expect(await loi(() => cA.thr.suggestForPoint({ pointDefId: pdB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:measurementPoint");
    expect(await loi(() => cA.thr.suggestForPoint({ pointDefId: pdA }))).toBeNull();
    expect(await loi(() => cAdm.thr.suggestForPoint({ pointDefId: pdB }))).toBeNull();
    expect((await cA.thr.suggestForProductModel({ productModelId: pmB })).count).toBe(0);
    expect((await cAdm.thr.suggestForProductModel({ productModelId: pmB })).count).toBeGreaterThan(0);
    expect((await cA.thr.suggestForProductModel({ productModelId: pmA })).count).toBeGreaterThan(0);
  });
});

describe("★★★ componentLibrary.linkStats · dashboardStats.overviewCounts · semantics.compute", () => {
  it("linkStats — A đếm đúng vật liệu của nhà máy A (1); admin đếm ≥ 2; không phạm vi 0", async () => {
    expect((await cA.lib.linkStats()).totalMaterials).toBe(1);
    expect((await cAdm.lib.linkStats()).totalMaterials).toBeGreaterThanOrEqual(2);
    expect((await cRong.lib.linkStats()).totalMaterials).toBe(0);
    const goi = (s: { byPackage: { packageId: number; count: number }[] }) => s.byPackage.find((x) => x.packageId === goiId)?.count ?? 0;
    expect(goi(await cA.lib.linkStats())).toBe(1);
    expect(goi(await cAdm.lib.linkStats())).toBe(2);
  });
  it("overviewCounts — A thấy 1 nhà máy · 1 chuyền · 1 máy (của mình); admin nhiều hơn; bộ nhớ đệm của admin không lọt sang A", async () => {
    const adm = await cAdm.dash.overviewCounts(); // nạp đệm của admin trước
    expect(adm.machines).toBeGreaterThanOrEqual(2);
    expect(await cA.dash.overviewCounts()).toEqual({ factories: 1, lines: 1, machines: 1 });
    expect(await cRong.dash.overviewCounts()).toEqual({ factories: 0, lines: 0, machines: 0 });
  });
  it("semantics.compute — dpmo: A chỉ tính máy A; khai equipment của B ⇒ NOT_FOUND; admin tính cả hai", async () => {
    const q = { metric: "dpmo", from: homQua, to: ngayMai };
    const a = await cA.sem.compute({ ...q, scope: "factory" });
    const adm = await cAdm.sem.compute({ ...q, scope: "factory" });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(adm));
    expect(await loi(() => cA.sem.compute({ ...q, scope: "equipment", scopeId: H.B.mid }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:machine");
    expect(await loi(() => cAdm.sem.compute({ ...q, scope: "equipment", scopeId: H.B.mid }))).toBeNull();
    const oee = { metric: "oee", from: homQua, to: ngayMai };
    expect(await loi(() => cA.sem.compute({ ...oee, scope: "line", scopeId: H.B.lid }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:line");
    expect(await loi(() => cA.sem.compute({ ...oee, scope: "line", scopeId: H.A.lid }))).not.toBe("NOT_FOUND:ENTITY_NOT_FOUND:line");
  });
});
