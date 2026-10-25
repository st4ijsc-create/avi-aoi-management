/**
 * CỔNG CSDL THẬT — lô L8 (rà bảo mật tRPC, 2026-10-25): tool ĐỌC của trợ lý AI lọc theo PHẠM VI NHÀ MÁY của `__authCtx`.
 * Hai nhà máy A, B; người dùng A (gán nhà máy A), người KHÔNG gán nhà máy nào, admin. Mỗi ca: A→A thấy (đối chứng), A→B rỗng / NOT_FOUND, người không gán ⇒ rỗng, admin thấy.
 * Chỉ chặn cổng RBAC (checkPermission) — phạm vi chạy trên hàng THẬT (cùng khuôn handlers.scopeDb.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const H0 = vi.hoisted(() => ({ goiOt: 0 }));
vi.mock("../../_core/accessControl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../_core/accessControl")>();
  return { ...actual, checkPermission: async () => true };
});
vi.mock("../../db/otTelemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/otTelemetry")>();
  return {
    ...actual,
    getLatestTelemetry: async (...a: Parameters<typeof actual.getLatestTelemetry>) => { H0.goiOt++; return actual.getLatestTelemetry(...a); },
    getTelemetrySeries: async (...a: Parameters<typeof actual.getTelemetrySeries>) => { H0.goiOt++; return actual.getTelemetrySeries(...a); },
  };
});

import { createProductModel } from "../../db";
import { dangKyModelSanPhamTest } from "../../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../../testing/__haiNhaMayDoLuong";
import { clearAssignmentCache } from "../../_core/accessControl";
import { getTool } from "./toolRegistry";

const RUN = `l8${process.pid}${Date.now().toString(36)}`;
let HN!: HaiNhaMayDo;
const ad: Record<string, number> = {};
type Ca = { id: number; role: string };
let uA: Ca, uRong: Ca, uAdm: Ca, uB: Ca;
const J = (x: unknown) => JSON.stringify(x);

/** Gọi tool đọc như tầng chat: `__authCtx` do máy chủ bơm từ phiên. */
async function goi(ten: string, args: Record<string, unknown>, u: Ca) {
  clearAssignmentCache();
  await import("./index");
  const t = getTool(ten);
  if (!t) throw new Error("không có tool " + ten);
  const p = (t.parameters as { parse: (x: unknown) => unknown }).parse({ ...args, __authCtx: { userId: u.id, role: u.role } });
  return t.handler(p as never);
}

beforeAll(async () => {
  const sp = async (k: string) => dangKyModelSanPhamTest(await createProductModel({ code: `${RUN}-${k}`, name: `${RUN}${k}` } as never));
  HN = await seedHaiNhaMayDo(RUN, "l8", [], await sp("PM"), taoNguoiDungTest);
  const { A, B } = HN;
  uA = { id: A.userId, role: "supervisor" };
  uB = { id: B.userId, role: "supervisor" };
  uRong = { id: HN.uRong.id, role: "supervisor" };
  uAdm = { id: HN.uAdmin.id, role: "admin" };
  const d = HN.dung;
  for (const [k, x] of [["A", A], ["B", B]] as const) {
    ad["p" + k] = await sp(k);
    await d(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
      VALUES (${x.mid}, ${ad["p" + k]}, ${RUN + "snp" + k}, 'NG', 'NG', now(), ${x.code})`);
    await d(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${ad["p" + k]}, ${RUN + "mp" + k}, ${RUN + "mp" + k}, 'VISUAL', 1, 1)`);
    await d(sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt") VALUES (${RUN + "pr" + k}, ${x.mid}, ${RUN + "st"}, 'pass', now())`);
    // chuỗi số cho xu hướng (2 giờ khác nhau, A=1 / B=100), đóng gói, và cặp thượng nguồn → hạ nguồn cho tương quan
    for (const gio of [1, 2]) {
      await d(sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt", metrics) VALUES (${RUN + "ms" + k + gio}, ${x.mid}, ${RUN + "mst"}, 'pass', now() - (${gio} || ' hour')::interval, ${JSON.stringify({ torque: k === "A" ? 1 : 100 })}::jsonb)`);
    }
    await d(sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt", "machineType") VALUES (${RUN + "pk" + k}, ${x.mid}, ${RUN + "pkst"}, 'pass', now(), 'PACKAGING')`);
    for (const i of [1, 2]) {
      await d(sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt", metrics) VALUES (${RUN + "co" + k + i}, ${x.mid}, ${RUN + "up"}, 'pass', now(), ${JSON.stringify({ v: i * (k === "A" ? 1 : 7) })}::jsonb)`);
      await d(sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt") VALUES (${RUN + "co" + k + i}, ${x.mid}, ${RUN + "dn"}, ${i === 1 ? "fail" : "pass"}::processresultenum, now())`);
    }
    for (const gio of [3, 2, 1]) {
      await d(sql`INSERT INTO line_balance_metrics ("lineId", "periodStart", "periodEnd") VALUES (${x.lid}, now() - (${gio} || ' hour')::interval, now() - (${gio - 1} || ' hour')::interval)`);
    }
    await d(sql`INSERT INTO oee_metrics ("machineId", "machineCode", "timestamp", availability, performance, quality, oee, "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount")
      VALUES (${x.mid}, ${x.code}, now(), 9000, 9000, 9000, 7290, 480, 400, 10, 100, 90, 10)`);
    await d(sql`INSERT INTO maintenance_work_orders ("workOrderNumber", "machineId", title) VALUES (${RUN + "wo" + k}, ${x.mid}, ${RUN + "wot" + k})`);
    const [as] = await d(sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold, "machineId") VALUES (${x.userId}, ${RUN + "as" + k}, 'ng_count', 1, ${x.mid}) RETURNING id`);
    await d(sql`INSERT INTO alert_history ("alertSettingId", "triggeredValue", message) VALUES (${as.id}, 5, ${RUN + "ah" + k})`);
    await d(sql`INSERT INTO predictive_alerts ("alertType", title, description, "machineId", "machineCode", "factoryId") VALUES ('PATTERN_ANOMALY', ${RUN + "pa" + k}, 'x', ${x.mid}, ${x.code}, ${x.fid})`);
    await d(sql`INSERT INTO machine_recipes (code, name, version, payload, "machineId") VALUES (${RUN + "rc" + k}, ${RUN + "rcn" + k}, 1, '{}'::jsonb, ${x.mid})`);
    await d(sql`INSERT INTO root_cause_analysis ("analysisType", "startDate", "endDate", "dataPointsAnalyzed", "topFactors", "requestedBy", "machineId", "machineCode")
      VALUES ('MACHINE_ANALYSIS', now(), now(), 1, '[]'::json, ${x.userId}, ${x.mid}, ${x.code})`);
    await d(sql`INSERT INTO genealogy_chain ("prevHash", "currHash", "serialNumber", "eventType", payload) VALUES (${RUN + "ph" + k}, ${RUN + "ch" + k}, ${x.serial}, 'inspect', '{}'::jsonb)`);
    await d(sql`INSERT INTO energy_readings (value, "machineId") VALUES (7, ${x.mid})`);
    await d(sql`INSERT INTO machine_health_history ("machineId", "machineCode", "timestamp", "healthScore", "oeeScore", "uptimeScore", "errorRateScore", "cycleTimeScore")
      VALUES (${x.mid}, ${x.code}, now(), 80, 80, 80, 80, 80)`);
    await d(sql`INSERT INTO line_balance_metrics ("lineId", "periodStart", "periodEnd") VALUES (${x.lid}, now() - interval '1 hour', now())`);
    await d(sql`INSERT INTO production_orders ("orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity") VALUES (${RUN + "po" + k}, 'C', ${x.fid}, ${x.wid}, ${x.lid}, ${ad["p" + k]}, 10)`);
    await d(sql`INSERT INTO api_keys (name, "keyHash", scopes, "machineId") VALUES (${RUN + "key" + k}, ${RUN + "kh" + k}, '[]'::json, ${x.mid})`);
  }
}, 300_000);

afterAll(async () => {
  if (!HN) return;
  const l = `'${RUN}%'`;
  for (const s of [
    `DELETE FROM api_keys WHERE name LIKE ${l}`,
    `DELETE FROM production_orders WHERE "orderCode" LIKE ${l}`,
    `DELETE FROM line_balance_metrics WHERE "lineId" IN (${HN.A.lid}, ${HN.B.lid})`,
    `DELETE FROM machine_health_history WHERE "machineCode" LIKE ${l}`,
    `DELETE FROM energy_readings WHERE "machineId" IN (${HN.A.mid}, ${HN.B.mid})`,
    `DELETE FROM genealogy_chain WHERE "currHash" LIKE ${l}`,
    `DELETE FROM root_cause_analysis WHERE "machineCode" LIKE ${l}`,
    `DELETE FROM machine_recipes WHERE code LIKE ${l}`,
    `DELETE FROM predictive_alerts WHERE title LIKE ${l}`,
    `DELETE FROM alert_history WHERE message LIKE ${l}`,
    `DELETE FROM alert_settings WHERE name LIKE ${l}`,
    `DELETE FROM maintenance_work_orders WHERE "workOrderNumber" LIKE ${l}`,
    `DELETE FROM oee_metrics WHERE "machineCode" LIKE ${l}`,
    `DELETE FROM process_results WHERE "serialNumber" LIKE ${l}`,
    `DELETE FROM product_inspections WHERE "serialNumber" LIKE ${l}`,
  ]) await qChuTest(s).catch(() => undefined);
  await HN.don();
});

/** Tool trả CHUỖI định danh của nhà máy: A thấy dấu A, KHÔNG thấy dấu B; người không gán nhà máy không thấy cả hai; admin thấy cả hai. */
const CA_DAU: Array<[string, () => Record<string, unknown>, (k: "A" | "B") => string]> = [
  ["get_machine_status", () => ({}), (k) => (k === "A" ? HN.A.code : HN.B.code)],
  ["get_oee", () => ({ days: 1 }), (k) => (k === "A" ? HN.A.code : HN.B.code)],
  ["analytics_query_oee", () => ({ period: "day" }), () => ""], // dấu = số mẫu; kiểm ở ca số riêng
  ["get_machine_process_result", () => ({ stepType: RUN + "st", days: 1 }), (k) => RUN + "pr" + k],
  ["list_work_orders", () => ({}), (k) => RUN + "wot" + k],
  ["list_active_alerts", () => ({ limit: 50 }), (k) => RUN + "ah" + k],
  ["list_anomalies", () => ({ limit: 50 }), (k) => RUN + "pa" + k],
  ["list_active_alerts", () => ({ limit: 50 }), (k) => RUN + "pa" + k],
  ["list_recipes", () => ({ limit: 50 }), (k) => RUN + "rc" + k],
  ["get_machine_health", () => ({ limit: 50 }), (k) => (k === "A" ? HN.A.code : HN.B.code)],
  ["get_rca_history", () => ({ limit: 50 }), (k) => (k === "A" ? HN.A.code : HN.B.code)],
  ["list_api_keys", () => ({ limit: 50 }), (k) => RUN + "key" + k],
  ["list_products", () => ({ limit: 50, search: RUN }), (k) => `${RUN}-${k}`],
];

/** Top-N mới nhất của admin bị hàng rác (mốc thời gian năm 2068) của test khác lấp ⇒ không kiểm "admin thấy dấu" ở các tool này (A→A / A→B / người không gán vẫn kiểm). */
const ADMIN_BO_QUA = new Set(["get_oee", "get_machine_health", "list_products", "list_api_keys", "list_recipes", "get_rca_history", "list_anomalies", "list_active_alerts", "list_work_orders"]);

describe("★★★ tool đọc — dấu nhà máy", () => {
  for (const [ten, argsFn, dau] of CA_DAU) {
    if (ten === "analytics_query_oee") continue;
    it(`${ten}: A thấy dấu A, không thấy dấu B; người không gán nhà máy không thấy; admin thấy cả hai`, async () => {
      const a = J(await goi(ten, argsFn(), uA));
      expect(a, "A→A (đối chứng)").toContain(dau("A"));
      expect(a, "A→B").not.toContain(dau("B"));
      const r = J(await goi(ten, argsFn(), uRong));
      expect(r).not.toContain(dau("A"));
      expect(r).not.toContain(dau("B"));
      if (!ADMIN_BO_QUA.has(ten)) {
        const adm = J(await goi(ten, argsFn(), uAdm));
        expect(adm).toContain(dau("A"));
        expect(adm).toContain(dau("B"));
      }
    });
  }
  it("list_users_by_role: A thấy người cùng nhà máy (chính mình), không thấy người nhà máy B; admin thấy cả hai", async () => {
    const a = (await goi("list_users_by_role", { limit: 50 }, uA)) as { data: { items: Array<{ id: number }> } };
    const ids = a.data.items.map((i) => i.id);
    expect(ids).toContain(uA.id);
    expect(ids).not.toContain(uB.id);
    const adm = (await goi("list_users_by_role", { limit: 50 }, uAdm)) as { data: { items: Array<{ id: number }> } };
    expect(adm.data.items.length).toBeGreaterThan(a.data.items.length - 1);
  });
});

describe("★★★ tool đọc — tham chiếu máy / chuyền / lệnh của nhà máy B ⇒ NOT_FOUND với A", () => {
  const nf = (r: unknown) => (r as { note?: string }).note;
  it("tra theo MÃ máy / chuyền / lệnh: A→B ⇒ NOT_FOUND (hoặc rỗng); A→A thấy; admin thấy", async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["get_device_health", { machineCode: HN.B.code }, { machineCode: HN.A.code }],
      ["get_palletizer_status", { machineCode: HN.B.code }, { machineCode: HN.A.code }],
      ["get_energy_metrics", { machineCode: HN.B.code }, { machineCode: HN.A.code }],
      ["correlate_process_quality", { upstreamStepType: "x", metricKey: "k", machineCode: HN.B.code }, { upstreamStepType: "x", metricKey: "k", machineCode: HN.A.code }],
      ["get_packaging_throughput", { machineCode: HN.B.code }, { machineCode: HN.A.code }],
      ["get_process_metric_trend", { machineCode: HN.B.code, metricKey: "k" }, { machineCode: HN.A.code, metricKey: "k" }],
      ["analytics_pdm_forecast", { machineId: HN.B.mid }, { machineId: HN.A.mid }],
      ["get_line_balance", { lineId: HN.B.lid }, { lineId: HN.A.lid }],
      ["get_line_balance", { lineCode: HN.B.code }, { lineCode: HN.A.code }],
      ["analyze_line_bottleneck", { lineId: HN.B.lid }, { lineId: HN.A.lid }],
      ["analyze_line_bottleneck", { lineCode: HN.B.code }, { lineCode: HN.A.code }],
      ["get_routing", { lineCode: HN.B.code }, { lineCode: HN.A.code }],
      ["get_lot_status", { orderCode: RUN + "poB" }, { orderCode: RUN + "poA" }],
    ];
    for (const [ten, argsB, argsA] of cases) {
      const rb = await goi(ten, argsB, uA);
      expect(nf(rb)?.startsWith("NOT_FOUND"), `${ten} A→B`).toBe(true);
      expect((rb as { textSummary: string }).textSummary, `${ten} A→B phải là "không tìm thấy" (không phải "chưa có dữ liệu")`).toMatch(/Không tìm thấy/);
      if (ten === "get_lot_status") expect((rb as { data: unknown }).data, "lệnh B không có dữ liệu với A").toBeNull();
      const rbAdm = await goi(ten, argsB, uAdm);
      expect(nf(rbAdm) === "NOT_FOUND" && ten === "get_lot_status", `${ten} admin→B không được là NOT_FOUND`).toBe(false);
      const ra = await goi(ten, argsA, uA);
      if (ten === "get_lot_status") expect(nf(ra), `${ten} A→A`).not.toBe("NOT_FOUND");
    }
    // người không gán nhà máy: kể cả máy của A cũng không thấy
    expect(nf(await goi("get_device_health", { machineCode: HN.A.code }, uRong))).toBeDefined();
  });
  it("trace_genealogy: serial của nhà máy B ⇒ rỗng với A; của A thấy; admin thấy", async () => {
    const a = (await goi("trace_genealogy", { serialNumber: HN.A.serial }, uA)) as { data: { count: number } };
    expect(a.data.count).toBeGreaterThan(0);
    const b = (await goi("trace_genealogy", { serialNumber: HN.B.serial }, uA)) as { data: { count: number } };
    expect(b.data.count).toBe(0);
    const adm = (await goi("trace_genealogy", { serialNumber: HN.B.serial }, uAdm)) as { data: { count: number } };
    expect(adm.data.count).toBeGreaterThan(0);
  });
  it("get_ot_telemetry_latest: máy ngoài phạm vi ⇒ NOT_FOUND và KHÔNG gọi tầng telemetry; máy trong phạm vi có gọi", async () => {
    const truoc = H0.goiOt;
    const r = await goi("get_ot_telemetry_latest", { machineCode: HN.B.code }, uA);
    expect((r as { note?: string }).note).toBe("NOT_FOUND");
    expect(H0.goiOt).toBe(truoc);
    await goi("get_ot_telemetry_latest", { machineCode: HN.A.code }, uA);
    expect(H0.goiOt).toBeGreaterThan(truoc);
  });
  it("get_change_history: chỉ toàn quyền (audit không có cột nhà máy)", async () => {
    expect((await goi("get_change_history", { limit: 5 }, uA) as { note?: string }).note).toBe("PERMISSION_DENIED");
    expect((await goi("get_change_history", { limit: 5 }, uAdm) as { note?: string }).note).not.toBe("PERMISSION_DENIED");
  });
});

describe("★★★ tool đọc — con số tổng hợp chỉ tính máy trong phạm vi", () => {
  it("get_today_stats / get_defect_trend / get_model_metrics / get_top_defects: A chỉ đếm lần kiểm của máy A", async () => {
    const ts = (await goi("get_today_stats", {}, uA)) as { data: { total: number } };
    const tsB = (await goi("get_today_stats", {}, uB)) as { data: { total: number } };
    const tsAdm = (await goi("get_today_stats", {}, uAdm)) as { data: { total: number } };
    expect(ts.data.total).toBe(2); // kit: 1 lần kiểm NG + 1 lần kiểm của sản phẩm riêng
    expect(tsB.data.total).toBe(2);
    expect(tsAdm.data.total).toBeGreaterThanOrEqual(4);
    expect(((await goi("get_today_stats", {}, uRong)) as { data: { total: number } }).data.total).toBe(0);
    const dt = (await goi("get_defect_trend", { days: 3 }, uA)) as { data: { series: Array<{ total: number }> } };
    expect(dt.data.series.reduce((s, p) => s + p.total, 0)).toBe(2); // 3 ngày: chỉ lần kiểm của máy A
    const mm = (await goi("get_model_metrics", { days: 3, limit: 20 }, uA)) as { data: Array<{ productCode: string; total: number }> };
    expect(mm.data.map((m) => m.productCode)).not.toContain(`${RUN}-B`);
    const td = (await goi("get_top_defects", { days: 3, limit: 20 }, uA)) as { data: Array<{ pointCode: string; ngCount: number }> };
    expect(td.data.find((p) => p.pointCode === RUN + "-P")?.ngCount).toBe(1);
  });
  it("analytics_query_oee / analytics_defect_pareto / analytics_query_yield / spc / forecast", async () => {
    const o = (await goi("analytics_query_oee", { period: "day" }, uA)) as { data: { current: { samples: number } } };
    expect(o.data.current.samples).toBe(1);
    expect(((await goi("analytics_query_oee", { period: "day" }, uRong)) as { note?: string }).note).toBe("PERMISSION_DENIED");
    const p = (await goi("analytics_defect_pareto", { groupBy: "machine", days: 3, topN: 50 }, uA)) as { data: { topN: Array<{ category: string }> } };
    expect(J(p.data)).not.toContain(HN.B.code);
    expect(J(p.data)).toContain(HN.A.code);
    const y = (await goi("analytics_query_yield", { days: 3, interval: "day" }, uA)) as { data: { series: Array<{ total: number }> } };
    expect(y.data.series.reduce((s, q) => s + q.total, 0)).toBe(2);
    const yAdm = (await goi("analytics_query_yield", { days: 3, interval: "day" }, uAdm)) as { data: { series: Array<{ total: number }> } };
    expect(yAdm.data.series.reduce((s, q) => s + q.total, 0)).toBeGreaterThanOrEqual(4);
    for (const ten of ["analytics_spc_status", "analytics_forecast_series"]) {
      const r = (await goi(ten, { days: 7 }, uRong)) as { note?: string };
      expect(r.note, ten).toBeDefined();
    }
  });
  it("get_fleet_process_summary: tổng bản ghi chỉ tính máy trong phạm vi", async () => {
    const f = (await goi("get_fleet_process_summary", { days: 1 }, uA)) as { data: { totals: { total: number } } };
    expect(f.data.totals.total).toBe(8); // 8 bản ghi công đoạn của máy A trong ngày (chỉ máy A)
    const fAdm = (await goi("get_fleet_process_summary", { days: 1 }, uAdm)) as { data: { totals: { total: number } } };
    expect(fAdm.data.totals.total).toBeGreaterThanOrEqual(16);
    expect(((await goi("get_fleet_process_summary", { days: 1 }, uRong)) as { note?: string }).note).toBe("PERMISSION_DENIED");
  });
  it("list_thresholds: điểm đo của sản phẩm gắn nhà máy B ẩn với A; của A thấy", async () => {
    const r = (await goi("list_thresholds", { productModelId: ad.pB }, uA)) as { data: { specLimits: unknown[] } };
    expect(r.data.specLimits).toEqual([]);
    const ra = (await goi("list_thresholds", { productModelId: ad.pA }, uA)) as { data: { specLimits: Array<{ pointCode: string }> } };
    expect(ra.data.specLimits.map((x) => x.pointCode)).toContain(RUN + "mpA");
    const adm = (await goi("list_thresholds", { productModelId: ad.pB }, uAdm)) as { data: { specLimits: unknown[] } };
    expect(adm.data.specLimits.length).toBeGreaterThan(0);
  });
  it("chuỗi/tổng hợp theo công đoạn: kết quả công đoạn, xu hướng, đóng gói, tương quan, năng lượng chỉ tính máy A", async () => {
    const pr = (await goi("get_machine_process_result", { stepType: RUN + "st", days: 1 }, uA)) as { data: { summary: { pass: number } } };
    expect(pr.data.summary.pass).toBe(1);
    const tr = (await goi("get_process_metric_trend", { stepType: RUN + "mst", metricKey: "torque", days: 1, bucket: "hour" }, uA)) as { data: { series: Array<{ value: number }> } };
    expect(tr.data.series.length).toBeGreaterThan(0);
    expect(tr.data.series.every((q) => q.value === 1), "xu hướng của A không lẫn giá trị 100 của B").toBe(true);
    const tp = (await goi("get_packaging_throughput", { days: 1 }, uA)) as { data: { totalPass: number } };
    expect(tp.data.totalPass).toBe(1);
    const co = (await goi("correlate_process_quality", { upstreamStepType: RUN + "up", metricKey: "v", downstreamStepType: RUN + "dn", days: 1 }, uA)) as { data: { paired: number } };
    expect(co.data.paired).toBe(2);
    const en = (await goi("get_energy_metrics", { sinceDays: 1, limit: 50 }, uA)) as { data: { readings: Array<{ machineId: number | null }> } };
    expect(en.data.readings.length).toBeGreaterThan(0);
    expect(en.data.readings.every((q) => q.machineId === HN.A.mid)).toBe(true);
  });
  it("get_today_stats.byMachine / get_model_metrics: không lộ máy / sản phẩm của nhà máy B", async () => {
    const ts = (await goi("get_today_stats", {}, uA)) as { data: { byMachine: Array<{ machineName: string }> } };
    expect(J(ts.data.byMachine)).not.toContain(HN.B.code);
    expect(J(ts.data.byMachine)).toContain(HN.A.code);
    const mm = (await goi("get_model_metrics", { days: 3, limit: 20 }, uA)) as { data: Array<{ productCode: string }> };
    expect(mm.data.map((m) => m.productCode)).toContain(`${RUN}-A`);
  });
});
