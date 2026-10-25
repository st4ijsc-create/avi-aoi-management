/**
 * CỔNG CSDL THẬT — lô L6c-C3 (rà bảo mật tRPC, 2026-10-25): hierarchyTree ×4 · federation ×7 (+ quyền admin_system) · equipmentStandards (đọc danh mục) · twin.models list|resolve · ecosystemAdmin.softRefIntegrity.
 * Luật: nhà máy ngoài phạm vi ≡ không tồn tại; trang liên bang theo MÃ tập đoàn, trang cục bộ (isLocal) chỉ toàn quyền; hàng chuẩn có thẻ tenant của nhà máy khác ẩn, hàng không thẻ / SEED dùng chung;
 * mô hình 3D không gắn gì = dùng chung; softRef: người hẹp chỉ thấy số đếm (mẫu rỗng); admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l6c3${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
const Q: Array<[string, string]> = [["machine_monitoring", "machine_status"], ["admin", "admin_system"]];
type C = Record<string, any>;
let cA: C, cAdm: C, cRong: C, cThuong: C;
const ad: Record<string, number> = {};
const J = (x: unknown) => JSON.stringify(x);
const CA = RUN + "CA";
const CB = RUN + "CB";
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return {
    ht: await mk("./hierarchyTreeRouter", "hierarchyTreeRouter"),
    fed: await mk("./federationRouter", "federationRouter"),
    es: await mk("./equipmentStandardsRouter", "equipmentStandardsRouter"),
    tw: await mk("./twinRouter", "twinRouter"),
    eco: await mk("./ecosystemAdminRouter", "ecosystemAdminRouter"),
  };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6c3", Q, dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const { A, B } = H;
  await H.dung(sql`INSERT INTO user_corporate_assignments ("userId", "corporateCode") VALUES (${A.userId}, ${CA})`);
  // người KHÔNG có quyền admin_system (chỉ machine_status) để kiểm requirePermission của federation
  const th = await taoNguoiDungTest("th", "supervisor", { tienTo: "l6c3", ts: RUN, ten: "l6c3 th" });
  await H.dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${th.id}, ${A.code})`);
  await H.dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${th.id}, 'machine_monitoring'::permissioncategoryenum, 'machine_status', true, true, true, true)`);
  ad.thuong = th.id;
  // liên bang: trang tập đoàn A, tập đoàn B, trang cục bộ, trang không tập đoàn
  const trang = async (k: string, cc: string | null, local: boolean) => {
    const [s] = await H.dung(sql`INSERT INTO sites (code, name, "baseUrl", "corporateCode", "isLocal") VALUES (${RUN + "s" + k}, ${RUN + "s" + k}, 'http://x', ${cc}, ${local}) RETURNING id`);
    ad["site" + k] = s.id;
    await H.dung(sql`INSERT INTO site_kpi_rollup ("siteId", "asOf", "window", category, "bucketStart", "totalInspections", "okCount", "ngCount") VALUES (${s.id}, now(), 'snapshot', 'overall', NULL, ${k === "A" ? 100 : 1000}, 1, 1)`);
    await H.dung(sql`INSERT INTO site_kpi_rollup ("siteId", "asOf", "window", category, "bucketStart", "totalInspections") VALUES (${s.id}, now(), 'day', 'overall', now(), 5)`);
    await H.dung(sql`INSERT INTO site_sync_log ("siteId") VALUES (${s.id})`);
  };
  await trang("A", CA, false);
  await trang("B", CB, false);
  await trang("L", CA, true);
  await trang("N", null, false);
  // chuẩn thiết bị: thẻ nhà máy A / B / không thẻ
  for (const [k, fid] of [["A", A.fid], ["B", B.fid], ["N", null]] as const) {
    await H.dung(sql`INSERT INTO device_types ("typeKey", status, "factoryId") VALUES (${RUN + "dt" + k}, 'published', ${fid})`);
    await H.dung(sql`INSERT INTO alarm_taxonomy (vendor, "nativeCode", "standardCode", "factoryId") VALUES (${RUN + "v" + k}, '1', ${RUN + "std" + k}, ${fid})`);
    await H.dung(sql`INSERT INTO master_alarms ("alarmKey", "factoryId") VALUES (${RUN + "ma" + k}, ${fid})`);
    await H.dung(sql`INSERT INTO device_type_change_requests ("crKey", "targetTypeKey", kind, "factoryId") VALUES (${RUN + "cr" + k}, ${RUN + "dt" + k}, 'modify', ${fid})`);
  }
  // mô hình 3D: máy A / máy B / nhà máy B / dùng chung theo lớp
  await H.dung(sql`INSERT INTO equipment_3d_models ("modelKey", "modelUri", "machineId", status) VALUES (${RUN + "mdA"}, 'u', ${A.mid}, 'active')`);
  await H.dung(sql`INSERT INTO equipment_3d_models ("modelKey", "modelUri", "machineId", status) VALUES (${RUN + "mdB"}, 'u', ${B.mid}, 'active')`);
  await H.dung(sql`INSERT INTO equipment_3d_models ("modelKey", "modelUri", "factoryId", status) VALUES (${RUN + "mdFB"}, 'u', ${B.fid}, 'active')`);
  await H.dung(sql`INSERT INTO equipment_3d_models ("modelKey", "modelUri", "equipmentClass", status) VALUES (${RUN + "mdN"}, 'u', ${RUN + "cls"}, 'active')`);
  // mồ côi để softRefIntegrity có mẫu cho admin
  await H.dung(sql`INSERT INTO safety_events ("eventType", "robotId") VALUES (${RUN + "se"}, 2147483000)`);
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
  cThuong = await caller({ id: th.id, role: "supervisor", name: "l6c3 th" });
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const l = `'${RUN}%'`;
  for (const s of [
    `DELETE FROM safety_events WHERE "eventType" LIKE ${l}`,
    `DELETE FROM equipment_3d_models WHERE "modelKey" LIKE ${l}`,
    `DELETE FROM device_type_change_requests WHERE "crKey" LIKE ${l}`,
    `DELETE FROM master_alarms WHERE "alarmKey" LIKE ${l}`,
    `DELETE FROM alarm_taxonomy WHERE vendor LIKE ${l}`,
    `DELETE FROM device_types WHERE "typeKey" LIKE ${l}`,
    `DELETE FROM site_sync_log WHERE "siteId" IN (SELECT id FROM sites WHERE code LIKE ${l})`,
    `DELETE FROM site_kpi_rollup WHERE "siteId" IN (SELECT id FROM sites WHERE code LIKE ${l})`,
    `DELETE FROM sites WHERE code LIKE ${l}`,
    `DELETE FROM permissions WHERE "userId" = ${ad.thuong ?? 0}`,
    `DELETE FROM user_factory_assignments WHERE "userId" = ${ad.thuong ?? 0}`,
    `DELETE FROM user_corporate_assignments WHERE "corporateCode" LIKE ${l}`,
  ]) await qChuTest(s).catch(() => undefined);
  await H.don();
  await qChuTest(`DELETE FROM users WHERE id = ${ad.thuong ?? 0}`).catch(() => undefined);
});

describe("★★★ hierarchyTree ×4", () => {
  it("getTree / getSummary / getMqttTopics chỉ nhà máy của A; getFactoryTree nhà máy B ⇒ null; admin thấy cả hai; thời gian đo được", async () => {
    const t0 = Date.now();
    const treeA = await cA.ht.getTree();
    const msA = Date.now() - t0;
    const t1 = Date.now();
    const treeAdm = await cAdm.ht.getTree();
    const msAdm = Date.now() - t1;
    console.log(`[L6c-C3] hierarchyTree.getTree: người hẹp ${msA} ms · admin ${msAdm} ms (${treeAdm.length} nhà máy)`);
    expect(treeA.map((f: any) => f.code)).toEqual([H.A.code]);
    expect(J(treeAdm)).toContain(H.B.code);
    expect(await cA.ht.getFactoryTree({ factoryId: H.B.fid })).toBeNull();
    expect((await cA.ht.getFactoryTree({ factoryId: H.A.fid }))?.code).toBe(H.A.code);
    expect((await cAdm.ht.getFactoryTree({ factoryId: H.B.fid }))?.code).toBe(H.B.code);
    expect((await cA.ht.getSummary()).factories).toBe(1);
    expect((await cAdm.ht.getSummary()).factories).toBeGreaterThanOrEqual(2);
    // topic MQTT chỉ sinh cho cây trong phạm vi: nhà máy B ngoài phạm vi ⇒ không topic nào
    expect(await cA.ht.getMqttTopics({ level: "factory", factoryId: H.B.fid })).toEqual([]);
    expect((await cA.ht.getMqttTopics({ level: "factory", factoryId: H.A.fid })).length).toBeGreaterThan(0);
    expect((await cAdm.ht.getMqttTopics({ level: "factory", factoryId: H.B.fid })).length).toBeGreaterThan(0);
    const tatCa = await cA.ht.getMqttTopics({ level: "all" });
    expect(tatCa.length).toBeGreaterThan(0);
    expect(tatCa.every((t: any) => t.topic.startsWith(`avi/factory/${H.A.fid}/`))).toBe(true); // không wildcard factory/+
    expect((await cAdm.ht.getMqttTopics({ level: "all" })).some((t: any) => t.topic.startsWith("avi/factory/+/"))).toBe(true);
    expect((await cRong.ht.getTree()).length).toBe(0);
  });
});

describe("★★★ federation ×7 + requirePermission(admin_system)", () => {
  it("người không có admin_system bị FORBIDDEN ở mọi thủ tục đọc", async () => {
    for (const g of [() => cThuong.fed.siteRollups(), () => cThuong.fed.aggregateSummary(), () => cThuong.fed.alertRollup(), () => cThuong.fed.categoryRollup({ category: "overall" }),
      () => cThuong.fed.siteDetail({ siteCode: RUN + "sA" }), () => cThuong.fed.siteKpiHistory({ siteId: ad.siteA }), () => cThuong.fed.syncLog(), () => cThuong.fed.status()]) {
      expect((await loi(g))?.startsWith("FORBIDDEN")).toBe(true);
    }
  });
  it("siteRollups / aggregateSummary / alertRollup / categoryRollup: chỉ trang tập đoàn A; trang cục bộ & không tập đoàn chỉ toàn quyền", async () => {
    const codes = (r: any) => r.map((x: any) => x.site.code);
    const ra = codes(await cA.fed.siteRollups());
    expect(ra).toContain(RUN + "sA");
    for (const x of ["sB", "sL", "sN"]) expect(ra).not.toContain(RUN + x);
    const radm = codes(await cAdm.fed.siteRollups());
    for (const x of ["sA", "sB", "sL", "sN"]) expect(radm).toContain(RUN + x);
    expect((await cA.fed.aggregateSummary()).totals.totalInspections).toBe(100);
    expect((await cAdm.fed.aggregateSummary()).totals.totalInspections).toBeGreaterThanOrEqual(1000);
    expect((await cA.fed.alertRollup()).sitesTotal).toBe(1);
    const cr = await cA.fed.categoryRollup({ category: "overall" });
    expect(cr.perSite.map((p: any) => p.siteCode)).toEqual([RUN + "sA"]);
    expect((await cRong.fed.siteRollups()).length).toBe(0);
  });
  it("siteDetail / siteKpiHistory / syncLog theo trang thấy được", async () => {
    expect(await loi(() => cA.fed.siteDetail({ siteCode: RUN + "sB" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:site");
    expect(await loi(() => cA.fed.siteDetail({ siteCode: RUN + "sL" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:site");
    expect(await loi(() => cA.fed.siteDetail({ siteCode: RUN + "sA" }))).toBeNull();
    expect(await loi(() => cAdm.fed.siteDetail({ siteCode: RUN + "sB" }))).toBeNull();
    expect(await cA.fed.siteKpiHistory({ siteId: ad.siteB })).toEqual([]);
    expect((await cA.fed.siteKpiHistory({ siteId: ad.siteA })).length).toBe(1);
    expect((await cAdm.fed.siteKpiHistory({ siteId: ad.siteB })).length).toBe(1);
    const sl = (await cA.fed.syncLog({ limit: 200 })).map((r: any) => r.siteId);
    expect(sl).toContain(ad.siteA);
    for (const x of ["siteB", "siteL", "siteN"]) expect(sl).not.toContain(ad[x]);
    expect(await cA.fed.syncLog({ siteId: ad.siteB })).toEqual([]);
    expect((await cAdm.fed.syncLog({ siteId: ad.siteB })).length).toBe(1);
  });
});

describe("★★★ equipmentStandards — đọc danh mục", () => {
  it("hierarchyTree / resolveType: kiểu thiết bị có thẻ nhà máy B ẩn; không thẻ + của A thấy", async () => {
    const t = J(await cA.es.hierarchyTree());
    expect(t).toContain(RUN + "dtA");
    expect(t).toContain(RUN + "dtN");
    expect(t).not.toContain(RUN + "dtB");
    expect(J(await cAdm.es.hierarchyTree())).toContain(RUN + "dtB");
    expect(await loi(() => cA.es.resolveType({ typeKey: RUN + "dtB" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:deviceType");
    expect(await loi(() => cA.es.resolveType({ typeKey: RUN + "dtA" }))).toBeNull();
    expect(await loi(() => cAdm.es.resolveType({ typeKey: RUN + "dtB" }))).toBeNull();
  });
  it("listAlarmMappings / mapAlarm / listMasterAlarms / listChangeRequests", async () => {
    const m = J(await cA.es.listAlarmMappings());
    expect(m).toContain(RUN + "stdA");
    expect(m).toContain(RUN + "stdN");
    expect(m).not.toContain(RUN + "stdB");
    expect(J(await cAdm.es.listAlarmMappings())).toContain(RUN + "stdB");
    expect(J(await cA.es.mapAlarm({ vendor: RUN + "vB", nativeCode: "1" }))).not.toContain(RUN + "stdB");
    expect(J(await cAdm.es.mapAlarm({ vendor: RUN + "vB", nativeCode: "1" }))).toContain(RUN + "stdB");
    const ma = J(await cA.es.listMasterAlarms());
    expect(ma).toContain(RUN + "maA");
    expect(ma).toContain(RUN + "maN");
    expect(ma).not.toContain(RUN + "maB");
    expect(J(await cAdm.es.listMasterAlarms())).toContain(RUN + "maB");
    const cr = J(await cA.es.listChangeRequests({ limit: 500 }));
    expect(cr).toContain(RUN + "crA");
    expect(cr).toContain(RUN + "crN");
    expect(cr).not.toContain(RUN + "crB");
    expect(J(await cAdm.es.listChangeRequests({ limit: 500 }))).toContain(RUN + "crB");
  });
});

describe("★★★ twin.models list|resolve", () => {
  it("mô hình gắn máy / nhà máy B ẩn; mô hình không gắn gì dùng chung; admin thấy hết", async () => {
    const ds = J(await cA.tw.models.list({ limit: 1000 }));
    expect(ds).toContain(RUN + "mdA");
    expect(ds).toContain(RUN + "mdN");
    expect(ds).not.toContain(RUN + "mdB");
    expect(ds).not.toContain(RUN + "mdFB");
    const adm = J(await cAdm.tw.models.list({ limit: 1000 }));
    expect(adm).toContain(RUN + "mdB");
    expect(adm).toContain(RUN + "mdFB");
    expect((await cA.tw.models.resolve({ machineId: H.B.mid }))?.modelKey ?? null).not.toBe(RUN + "mdB");
    expect((await cAdm.tw.models.resolve({ machineId: H.B.mid }))?.modelKey).toBe(RUN + "mdB");
    expect((await cA.tw.models.resolve({ machineId: H.A.mid }))?.modelKey).toBe(RUN + "mdA");
    expect((await cA.tw.models.resolve({ equipmentClass: RUN + "cls" }))?.modelKey).toBe(RUN + "mdN");
  });
});

describe("★★★ ecosystemAdmin.softRefIntegrity", () => {
  it("admin thấy mẫu mồ côi; người hẹp chỉ số đếm (mẫu rỗng) và số đếm vẫn khớp", async () => {
    const adm = await cAdm.eco.softRefIntegrity();
    const a = await cA.eco.softRefIntegrity();
    expect(adm.rules.some((r: any) => r.sample.length > 0)).toBe(true);
    expect(a.rules.every((r: any) => r.sample.length === 0)).toBe(true);
    expect(a.totalOrphans).toBe(adm.totalOrphans);
  });
});
