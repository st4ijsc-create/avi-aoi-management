/**
 * CỔNG CSDL THẬT — lô L9 (rà bảo mật tRPC, 2026-10-25): sổ nợ ĐỌC cấu hình còn lại —
 * shiftConfig (list · defaults) · layout (listByWorkshop · getById) · maintenanceSchedule (list · get) · ngRateThreshold (list · getById · alertHistory · currentNgRates)
 * · process (getLineAssignments · getAssignmentsByProcess) · productVariant (getVariant · getEffectivePoints) · thresholdApproval (list · getById · countPendingByProduct)
 * · alertRouter (getById · listAll).
 * Luật: đọc cùng luật GHI của W13/W17 — ngoài phạm vi ≡ không tồn tại; ca toàn cục (factoryId NULL) dùng chung, chỉ GHI là toàn quyền; sản phẩm theo luật L3 (kể cả sản phẩm nháp);
 * alertRouter.getById chỉ chủ hoặc admin; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l9${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
const Q: Array<[string, string]> = [["machine_monitoring", "machine_status"], ["production", "settings_products"]];
type C = Record<string, any>;
let cA: C, cAdm: C, cRong: C;
const ad: Record<string, number> = {};
const J = (x: unknown) => JSON.stringify(x);
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return {
    sh: await mk("./shiftConfigRouter", "shiftConfigRouter"),
    ly: await mk("./layoutRouters", "layoutRouter"),
    ms: await mk("./maintenanceScheduleRouter", "maintenanceScheduleRouter"),
    ng: await mk("./ngRateThresholdRouter", "ngRateThresholdRouter"),
    pr: await mk("./processRouter", "processRouter"),
    pv: await mk("./productVariantRouter", "productVariantRouter"),
    ta: await mk("./thresholdApprovalRouter", "thresholdApprovalRouter"),
    al: await mk("./alertRouters", "alertRouter"),
  };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}

beforeAll(async () => {
  const sp = async (k: string) => dangKyModelSanPhamTest(await createProductModel({ code: `${RUN}-${k}`, name: `${RUN}${k}` } as never));
  H = await seedHaiNhaMayDo(RUN, "l9", Q, await sp("PM"), taoNguoiDungTest);
  const { A, B } = H;
  const d = H.dung;
  await d(sql`INSERT INTO shift_configs (name, code, "startHour", "endHour") VALUES (${RUN + "caG"}, ${RUN + "caG"}, 6, 14)`);
  const [pr] = await d(sql`INSERT INTO processes (code, name) VALUES (${RUN + "qt"}, ${RUN + "qt"}) RETURNING id`);
  ad.proc = pr.id;
  for (const [k, x] of [["A", A], ["B", B]] as const) {
    await d(sql`INSERT INTO shift_configs (name, code, "startHour", "endHour", "factoryId") VALUES (${RUN + "ca" + k}, ${RUN + "ca" + k}, 6, 14, ${x.fid})`);
    const [ly] = await d(sql`INSERT INTO factory_layouts (name, "workshopId", "factoryId") VALUES (${RUN + "ly" + k}, ${x.wid}, ${x.fid}) RETURNING id`);
    ad["ly" + k] = ly.id;
    const [ms] = await d(sql`INSERT INTO maintenance_schedules ("machineId", "taskName") VALUES (${x.mid}, ${RUN + "ms" + k}) RETURNING id`);
    ad["ms" + k] = ms.id;
    const [th] = await d(sql`INSERT INTO mqtt_ng_rate_thresholds ("stationId", name, "warningThreshold", "criticalThreshold") VALUES (${x.sid}, ${RUN + "th" + k}, 5, 10) RETURNING id`);
    ad["th" + k] = th.id;
    await d(sql`INSERT INTO mqtt_ng_rate_alert_history ("thresholdId", "stationId", "currentNgRate", "thresholdValue", "totalInspections", "ngCount", severity, message) VALUES (${th.id}, ${x.sid}, 12, 10, 100, 12, 'critical', ${RUN + "ah" + k})`);
    await d(sql`INSERT INTO line_process_assignments ("lineId", "processId") VALUES (${x.lid}, ${pr.id})`);
    ad["p" + k] = await sp(k);
    await d(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
      VALUES (${x.mid}, ${ad["p" + k]}, ${RUN + "snp" + k}, 'OK', 'OK', now(), ${x.code})`);
    const [pt] = await d(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${ad["p" + k]}, ${RUN + "mp" + k}, ${RUN + "mp" + k}, 'VISUAL', 1, 1) RETURNING id`);
    const [va] = await d(sql`INSERT INTO product_variants ("productModelId", code) VALUES (${ad["p" + k]}, ${RUN + "va" + k}) RETURNING id`);
    ad["va" + k] = va.id;
    const [ta] = await d(sql`INSERT INTO threshold_approvals ("pointDefId", "requestedBy", suggestion) VALUES (${pt.id}, ${x.userId}, '{}'::jsonb) RETURNING id`);
    ad["ta" + k] = ta.id;
    const [as] = await d(sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold) VALUES (${x.userId}, ${RUN + "as" + k}, 'ng_count', 1) RETURNING id`);
    ad["as" + k] = as.id;
  }
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const l = `'${RUN}%'`;
  for (const s of [
    `DELETE FROM alert_settings WHERE name LIKE ${l}`,
    `DELETE FROM threshold_approvals WHERE "pointDefId" IN (SELECT id FROM measurement_point_defs WHERE code LIKE ${l})`,
    `DELETE FROM product_variants WHERE code LIKE ${l}`,
    `DELETE FROM measurement_point_defs WHERE code LIKE ${l}`,
    `DELETE FROM line_process_assignments WHERE "processId" = ${ad.proc ?? 0}`,
    `DELETE FROM processes WHERE code LIKE ${l}`,
    `DELETE FROM mqtt_ng_rate_alert_history WHERE message LIKE ${l}`,
    `DELETE FROM mqtt_ng_rate_thresholds WHERE name LIKE ${l}`,
    `DELETE FROM maintenance_schedules WHERE "taskName" LIKE ${l}`,
    `DELETE FROM factory_layouts WHERE name LIKE ${l}`,
    `DELETE FROM shift_configs WHERE code LIKE ${l}`,
    `DELETE FROM product_inspections WHERE "serialNumber" LIKE ${l}`,
  ]) await qChuTest(s).catch(() => undefined);
  await H.don();
});

describe("★★★ shiftConfig · layout · maintenanceSchedule", () => {
  it("shiftConfig.list: ca nhà máy B ẩn, ca toàn cục + ca A thấy; shiftConfig.defaults: ca toàn cục dùng chung", async () => {
    const a = J(await cA.sh.list());
    expect(a).toContain(RUN + "caA");
    expect(a).toContain(RUN + "caG");
    expect(a).not.toContain(RUN + "caB");
    expect(J(await cA.sh.list({ factoryId: H.B.fid }))).not.toContain(RUN + "caB");
    expect(J(await cA.sh.list({ factoryId: H.B.fid }))).toContain(RUN + "caG");
    expect(J(await cAdm.sh.list())).toContain(RUN + "caB");
    // defaults = ca toàn cục (factoryId NULL) — dùng chung cho mọi người có quyền
    expect(J(await cRong.sh.defaults())).toContain(RUN + "caG");
    expect(J(await cRong.sh.list())).not.toContain(RUN + "caA");
  });
  it("layout.listByWorkshop / getById theo xưởng-nhà máy", async () => {
    expect((await cA.ly.listByWorkshop({ workshopId: H.A.wid })).length).toBe(1);
    expect(await cA.ly.listByWorkshop({ workshopId: H.B.wid })).toEqual([]);
    expect((await cAdm.ly.listByWorkshop({ workshopId: H.B.wid })).length).toBe(1);
    expect(await loi(() => cA.ly.getById({ id: ad.lyB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:factoryLayout");
    expect(await loi(() => cA.ly.getById({ id: ad.lyA }))).toBeNull();
    expect(await loi(() => cAdm.ly.getById({ id: ad.lyB }))).toBeNull();
  });
  it("maintenanceSchedule.list / get theo máy", async () => {
    const a = J(await cA.ms.list());
    expect(a).toContain(RUN + "msA");
    expect(a).not.toContain(RUN + "msB");
    expect(J(await cAdm.ms.list())).toContain(RUN + "msB");
    expect(await loi(() => cA.ms.get({ id: ad.msB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:maintenanceSchedule");
    expect(await loi(() => cA.ms.get({ id: ad.msA }))).toBeNull();
    expect(await loi(() => cAdm.ms.get({ id: ad.msB }))).toBeNull();
  });
});

describe("★★★ ngRateThreshold · process", () => {
  it("ngRateThreshold: list / alertHistory / getById / currentNgRates theo trạm-máy", async () => {
    const a = J(await cA.ng.list());
    expect(a).toContain(RUN + "thA");
    expect(a).not.toContain(RUN + "thB");
    expect(J(await cAdm.ng.list())).toContain(RUN + "thB");
    const h = J(await cA.ng.alertHistory({ limit: 200 }));
    expect(h).toContain(RUN + "ahA");
    expect(h).not.toContain(RUN + "ahB");
    expect(J(await cAdm.ng.alertHistory({ limit: 200 }))).toContain(RUN + "ahB");
    expect(await loi(() => cA.ng.getById({ id: ad.thB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:ngRateThreshold");
    expect(await loi(() => cA.ng.getById({ id: ad.thA }))).toBeNull();
    expect((await loi(() => cA.ng.currentNgRates({ stationId: H.B.sid })))?.startsWith("NOT_FOUND")).toBe(true);
    expect(await loi(() => cA.ng.currentNgRates({ stationId: H.A.sid }))).toBeNull();
    expect(await loi(() => cAdm.ng.currentNgRates({ stationId: H.B.sid }))).toBeNull();
  });
  it("process: gán quy trình chỉ theo chuyền / trạm trong phạm vi", async () => {
    expect((await cA.pr.getLineAssignments({ lineId: H.A.lid })).length).toBe(1);
    expect(await cA.pr.getLineAssignments({ lineId: H.B.lid })).toEqual([]);
    expect((await cAdm.pr.getLineAssignments({ lineId: H.B.lid })).length).toBe(1);
    const ps = await cA.pr.getAssignmentsByProcess({ processId: ad.proc });
    expect(ps.map((x: any) => x.lineId)).toEqual([H.A.lid]);
    expect((await cAdm.pr.getAssignmentsByProcess({ processId: ad.proc })).length).toBe(2);
    expect(await cRong.pr.getAssignmentsByProcess({ processId: ad.proc })).toEqual([]);
  });
});

describe("★★★ productVariant · thresholdApproval · alertRouter", () => {
  it("productVariant.getVariant / getEffectivePoints theo sản phẩm (luật L3)", async () => {
    expect(await loi(() => cA.pv.getVariant({ variantId: ad.vaB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:productVariant");
    expect(await loi(() => cA.pv.getVariant({ variantId: ad.vaA }))).toBeNull();
    expect(await loi(() => cAdm.pv.getVariant({ variantId: ad.vaB }))).toBeNull();
    expect((await cA.pv.getEffectivePoints({ productModelId: ad.pB })).count).toBe(0);
    expect((await cA.pv.getEffectivePoints({ productModelId: ad.pA })).count).toBeGreaterThan(0);
    expect((await cAdm.pv.getEffectivePoints({ productModelId: ad.pB })).count).toBeGreaterThan(0);
  });
  it("thresholdApproval.list / getById / countPendingByProduct theo sản phẩm của điểm đo", async () => {
    const ids = (r: any) => (r.rows ?? r.items ?? r).map((x: any) => x.id);
    const la = ids(await cA.ta.list({ limit: 500 }));
    expect(la).toContain(ad.taA);
    expect(la).not.toContain(ad.taB);
    expect(ids(await cAdm.ta.list({ limit: 500 }))).toContain(ad.taB);
    expect((await loi(() => cA.ta.getById({ id: ad.taB })))?.startsWith("NOT_FOUND")).toBe(true);
    expect(await loi(() => cA.ta.getById({ id: ad.taA }))).toBeNull();
    expect(await loi(() => cAdm.ta.getById({ id: ad.taB }))).toBeNull();
    expect((await cA.ta.countPendingByProduct({ productModelId: ad.pB })).total).toBe(0);
    expect((await cA.ta.countPendingByProduct({ productModelId: ad.pA })).total).toBeGreaterThan(0);
  });
  it("alertRouter.getById: chủ hoặc admin, ngoài ≡ NOT_FOUND · alertRouter.listAll: chỉ admin", async () => {
    expect(await loi(() => cA.al.getById({ id: ad.asA }))).toBeNull();
    expect(await loi(() => cA.al.getById({ id: ad.asB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:alertSetting");
    expect(await loi(() => cAdm.al.getById({ id: ad.asB }))).toBeNull();
    expect((await loi(() => cA.al.listAll()))?.startsWith("FORBIDDEN")).toBe(true);
    expect(J(await cAdm.al.listAll())).toContain(RUN + "asB");
  });
});
