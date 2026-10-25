/**
 * ★★★ Lô W17a — KIỂM CHỨNG các miễn trừ "SỞ HỮU THEO NGƯỜI DÙNG" của sổ phamViGhi (kiểm định 2026-10-25), bằng CSDL thật.
 * Người B (cùng vai, cùng tài khoản loại) gọi bằng id tài nguyên của người A ⇒ dữ liệu A KHÔNG đổi; đối chứng: chủ gọi được.
 * Phát hiện được vá trong lô: (1) dashboardWidget.duplicateCustomDashboard sao chép được bảng RIÊNG của người khác;
 * (2) reportArtifact: vai supervisor / quality_inspector xem-tải-XOÁ được tệp của mọi nhà máy (nay theo phạm vi người tạo);
 * (3) aiJobQueue.cancelJob: người dùng huỷ được job HỆ THỐNG (không chủ).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw21${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
const tenTep = (u: { id: number; name: string }) => ({ user: { id: u.id, role: "supervisor", name: u.name, openId: u.name, twoFactorEnabled: true } }) as never;

let A!: { id: number; name: string };
let B!: { id: number; name: string };
const codes: string[] = [];
let ids: Record<string, number> = {};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 ua" });
  B = await taoNguoiDungTest("ub", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 ub" });
  for (const u of [A, B]) await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_monitoring', 'ai_repo_read', true, true, true, true)`);
  // bảng điều khiển riêng + công khai của A
  ids.dRieng = Number((await one(sql`INSERT INTO user_custom_dashboards ("userId", name, widgets, "isPublic") VALUES (${A.id}, ${RUN + "-riêng"}, '[]'::jsonb, false) RETURNING id`)).id);
  ids.dCongKhai = Number((await one(sql`INSERT INTO user_custom_dashboards ("userId", name, widgets, "isPublic") VALUES (${A.id}, ${RUN + "-cong"}, '[]'::jsonb, true) RETURNING id`)).id);
  ids.preset = Number((await one(sql`INSERT INTO widget_style_presets (name, "createdBy", "presetType", "isPublic") VALUES (${RUN + "-preset"}, ${A.id}, 'user', false) RETURNING id`)).id);
  ids.alert = Number((await one(sql`INSERT INTO alert_settings ("userId", name, "alertType", threshold) VALUES (${A.id}, ${RUN + "-al"}, 'yield_rate', 90) RETURNING id`)).id);
  ids.alertHis = Number((await one(sql`INSERT INTO alert_history ("alertSettingId", "triggeredValue", message) VALUES (${ids.alert}, 80, ${RUN + "-m"}) RETURNING id`)).id);
  ids.notif = Number((await one(sql`INSERT INTO notifications ("userId", title, message) VALUES (${A.id}, ${RUN + "-n"}, 'm') RETURNING id`)).id);
  ids.session = Number((await one(sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${A.id}, ${RUN + "-tok"}, now() + interval '1 day', true) RETURNING id`)).id);
  ids.token = Number((await one(sql`INSERT INTO ai_gateway_tokens ("userId", "tokenHash", "tienTo", ten, "hetHanLuc") VALUES (${A.id}, ${"a".repeat(64)}, ${"avgw_abcd12"}, ${RUN + "-t"}, now() + interval '1 day') RETURNING id`)).id);
  ids.mau = Number((await one(sql`INSERT INTO annotation_templates (name, "createdBy", "isSystem") VALUES (${RUN + "-mau"}, ${A.id}, false) RETURNING id`)).id);
  ids.mauHeThong = Number((await one(sql`INSERT INTO annotation_templates (name, "createdBy", "isSystem") VALUES (${RUN + "-sys"}, ${A.id}, true) RETURNING id`)).id);
  await dung(sql`INSERT INTO ai_agent_sessions (id, "userId", "userRole", goal, "expiresAt", status) VALUES (${RUN + "-ss"}, ${A.id}, 'supervisor', 'goal', now() + interval '1 day', 'awaiting_approval')`);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM user_custom_dashboards WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM widget_style_presets WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM alert_history WHERE message LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM alert_settings WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM notifications WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_sessions WHERE "sessionToken" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_gateway_tokens WHERE ten LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM annotation_templates WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM ai_agent_sessions WHERE id LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM report_artifacts WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("dashboardWidget — bảng điều khiển & preset cá nhân", () => {
  it("B sửa / xoá / bật-tắt / lưu thành mẫu bảng RIÊNG của A ⇒ không đổi gì; A (chủ) làm được", async () => {
    const { dashboardWidgetRouter } = await import("./dashboardWidgetRouters");
    const b = dashboardWidgetRouter.createCaller(tenTep(B));
    const a = dashboardWidgetRouter.createCaller(tenTep(A));
    const truoc = await one(sql`SELECT name, "isFavorite", "isPublic", "updatedAt" FROM user_custom_dashboards WHERE id = ${ids.dRieng}`);
    await b.updateCustomDashboard({ id: ids.dRieng, name: `${RUN}-hack` } as never).catch(() => undefined);
    await b.toggleCustomDashboardFavorite({ id: ids.dRieng }).catch(() => undefined);
    await b.toggleCustomDashboardPublic({ id: ids.dRieng }).catch(() => undefined);
    await b.deleteCustomDashboard({ id: ids.dRieng }).catch(() => undefined);
    expect(await maLoi(() => b.saveCustomDashboardAsTemplate({ dashboardId: ids.dRieng, name: `${RUN}-tpl` }))).toBe("NOT_FOUND");
    const sau = await one(sql`SELECT name, "isFavorite", "isPublic", "updatedAt" FROM user_custom_dashboards WHERE id = ${ids.dRieng}`);
    expect(sau).toEqual(truoc);
    expect(await so(sql`SELECT count(*)::int AS n FROM dashboard_templates WHERE name = ${RUN + "-tpl"}`)).toBe(0);
    // đối chứng: chủ
    await a.toggleCustomDashboardFavorite({ id: ids.dRieng });
    expect((await one(sql`SELECT "isFavorite" AS f FROM user_custom_dashboards WHERE id = ${ids.dRieng}`)).f).toBe(true);
  });
  it("★ PHÁT HIỆN: B sao chép bảng RIÊNG của A ⇒ không tạo bản sao (≡ không tồn tại); bảng CÔNG KHAI ⇒ sao chép được; A sao chép bảng của mình ⇒ được", async () => {
    const { dashboardWidgetRouter } = await import("./dashboardWidgetRouters");
    const b = dashboardWidgetRouter.createCaller(tenTep(B));
    const a = dashboardWidgetRouter.createCaller(tenTep(A));
    const dem = () => so(sql`SELECT count(*)::int AS n FROM user_custom_dashboards WHERE name LIKE ${RUN + "-%(Copy)"}`);
    expect(await b.duplicateCustomDashboard({ id: ids.dRieng })).toBeNull();
    expect(await dem()).toBe(0);
    expect(await b.duplicateCustomDashboard({ id: ids.dCongKhai })).toMatchObject({ id: expect.any(Number) });
    expect(await a.duplicateCustomDashboard({ id: ids.dRieng })).toMatchObject({ id: expect.any(Number) });
    expect(await dem()).toBe(2);
  });
  it("B sửa / xoá / nhân bản preset RIÊNG của A ⇒ NOT_FOUND (≡ không tồn tại), preset còn nguyên", async () => {
    const { dashboardWidgetRouter } = await import("./dashboardWidgetRouters");
    const b = dashboardWidgetRouter.createCaller(tenTep(B));
    const l = [
      await maLoi(() => b.updateStylePreset({ id: ids.preset, name: `${RUN}-hack` })),
      await maLoi(() => b.deleteStylePreset({ id: ids.preset })),
      await maLoi(() => b.cloneSharedPreset({ id: ids.preset })),
    ];
    expect(l).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM widget_style_presets WHERE id = ${ids.preset} AND name = ${RUN + "-preset"}`)).toBe(1);
  });
});

describe("cảnh báo · thông báo · phiên · token · mẫu chú thích", () => {
  it("alertRouter: B update / delete / test / acknowledge cảnh báo của A ⇒ NOT_FOUND, không đổi", async () => {
    const { alertRouter } = await import("./alertRouters");
    const b = alertRouter.createCaller(tenTep(B));
    const l = [
      await maLoi(() => b.update({ id: ids.alert, name: `${RUN}-hack`, threshold: 1 })),
      await maLoi(() => b.delete({ id: ids.alert })),
      await maLoi(() => b.test({ id: ids.alert })),
      await maLoi(() => b.acknowledge({ id: ids.alertHis })),
    ];
    expect(l).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM alert_settings WHERE id = ${ids.alert} AND name = ${RUN + "-al"} AND threshold = 90`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM alert_history WHERE id = ${ids.alertHis} AND "acknowledgedAt" IS NULL`)).toBe(1);
    const a = alertRouter.createCaller(tenTep(A));
    expect(await maLoi(() => a.acknowledge({ id: ids.alertHis }))).toBeNull();
  });
  it("notification.markAsRead / delete bằng id của A do B gọi ⇒ hàng của A không đổi; A đọc được", async () => {
    const { notificationRouter } = await import("./notificationRouters");
    const b = notificationRouter.createCaller(tenTep(B));
    await b.markAsRead({ id: ids.notif }).catch(() => undefined);
    await b.delete({ id: ids.notif }).catch(() => undefined);
    expect(await so(sql`SELECT count(*)::int AS n FROM notifications WHERE id = ${ids.notif} AND "isRead" = false`)).toBe(1);
    await notificationRouter.createCaller(tenTep(A)).markAsRead({ id: ids.notif });
    expect(await so(sql`SELECT count(*)::int AS n FROM notifications WHERE id = ${ids.notif} AND "isRead" = true`)).toBe(1);
  });
  it("session.revoke / user.revokeSession bằng id phiên của A do B gọi ⇒ phiên A còn hoạt động", async () => {
    const { sessionRouter } = await import("./sessionRouter");
    const { userRouter } = await import("./userRouters");
    await sessionRouter.createCaller(tenTep(B)).revoke({ sessionId: ids.session }).catch(() => undefined);
    await userRouter.createCaller(tenTep(B)).revokeSession({ sessionId: ids.session }).catch(() => undefined);
    expect(await so(sql`SELECT count(*)::int AS n FROM user_sessions WHERE id = ${ids.session} AND "isActive" = true`)).toBe(1);
    await sessionRouter.createCaller(tenTep(A)).revoke({ sessionId: ids.session });
    expect(await so(sql`SELECT count(*)::int AS n FROM user_sessions WHERE id = ${ids.session} AND "isActive" = false`)).toBe(1);
  });
  it("aiGatewayToken.thuHoi bằng id token của A do B gọi ⇒ token A còn hiệu lực; A thu hồi được", async () => {
    const { aiGatewayTokenRouter } = await import("./aiGatewayTokenRouter");
    expect(await aiGatewayTokenRouter.createCaller(tenTep(B)).thuHoi({ id: ids.token })).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await so(sql`SELECT count(*)::int AS n FROM ai_gateway_tokens WHERE id = ${ids.token} AND "thuHoiLuc" IS NULL`)).toBe(1);
    expect(await aiGatewayTokenRouter.createCaller(tenTep(A)).thuHoi({ id: ids.token })).toMatchObject({ ok: true });
    expect(await so(sql`SELECT count(*)::int AS n FROM ai_gateway_tokens WHERE id = ${ids.token} AND "thuHoiLuc" IS NOT NULL`)).toBe(1);
  });
  it("annotationTemplate.delete: B xoá mẫu của A ⇒ NOT_FOUND; mẫu hệ thống ⇒ FORBIDDEN ngay cả chủ; chủ xoá mẫu thường được", async () => {
    const { annotationTemplateRouter } = await import("./annotationRouters");
    const b = annotationTemplateRouter.createCaller(tenTep(B));
    const a = annotationTemplateRouter.createCaller(tenTep(A));
    expect(await maLoi(() => b.delete({ id: ids.mau }))).toBe("NOT_FOUND");
    expect(await maLoi(() => a.delete({ id: ids.mauHeThong }))).toBe("FORBIDDEN");
    expect(await so(sql`SELECT count(*)::int AS n FROM annotation_templates WHERE id IN (${ids.mau}, ${ids.mauHeThong})`)).toBe(2);
    expect(await maLoi(() => a.delete({ id: ids.mau }))).toBeNull();
  });
  it("aiAgent: B approvePlan / confirmStep / cancelSession phiên của A ⇒ phiên A không đổi", async () => {
    const { aiAgentRouter } = await import("./aiAgentRouter");
    const b = aiAgentRouter.createCaller(tenTep(B));
    const sid = `${RUN}-ss`;
    await b.approvePlan({ sessionId: sid }).catch(() => undefined);
    await b.confirmStep({ sessionId: sid, actionId: "x", token: "y" }).catch(() => undefined);
    await b.cancelSession({ sessionId: sid }).catch(() => undefined);
    expect(await so(sql`SELECT count(*)::int AS n FROM ai_agent_sessions WHERE id = ${sid} AND status = 'awaiting_approval'`)).toBe(1);
  });
});

describe("★ reportArtifact — phạm vi nhà máy của người tạo (vai đặc quyền không phải admin)", () => {
  it("giám sát viên chỉ nhà máy A: thấy tệp của mình + người tạo nằm trong A; KHÔNG thấy / xoá tệp người tạo nhà máy B, người tạo nhiều nhà máy, toàn quyền, hệ thống; admin thấy hết", async () => {
    const fa = `${RUN}fa`;
    const fb = `${RUN}fb`;
    await dung(sql`INSERT INTO factories (code, name) VALUES (${fa}, ${fa}), (${fb}, ${fb})`);
    codes.push(fa, fb);
    const viewer = await taoNguoiDungTest("va", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 va" });
    const cA = await taoNguoiDungTest("ca", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 ca" });
    const cB = await taoNguoiDungTest("cb", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 cb" });
    const cAB = await taoNguoiDungTest("cab", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 cab" });
    const adm = await taoNguoiDungTest("adm", "admin", { tienTo: "pw21", ts: RUN, ten: "PW21 adm" });
    for (const [u, f] of [[viewer, fa], [cA, fa], [cB, fb], [cAB, fa], [cAB, fb]] as const) {
      await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${f})`);
    }
    const mk = async (by: number | null, ten: string) =>
      Number((await one(sql`INSERT INTO report_artifacts ("reportType", format, title, "storageKey", "storageUrl", "fileHash", "createdBy")
        VALUES ('t', 'csv', ${RUN + "-" + ten}, ${RUN + ten}, 'http://x/' || ${RUN + ten}, ${"b".repeat(64)}, ${by}) RETURNING id`)).id);
    const aMine = await mk(viewer.id, "mine");
    const aA = await mk(cA.id, "ca");
    const aB = await mk(cB.id, "cb");
    const aAB = await mk(cAB.id, "cab");
    const aAdm = await mk(adm.id, "adm");
    const aSys = await mk(null, "sys");
    const { reportArtifactRouter } = await import("./reportArtifactRouter");
    const v = reportArtifactRouter.createCaller({ user: { id: viewer.id, role: "supervisor", name: viewer.name, twoFactorEnabled: true } } as never);
    const thay = (await v.list({ limit: 200 })).items.map((x) => x.id).filter((id) => [aMine, aA, aB, aAB, aAdm, aSys].includes(id)).sort();
    expect(thay).toEqual([aMine, aA].sort());
    const ngoai = [aB, aAB, aAdm, aSys];
    for (const id of ngoai) {
      expect(await maLoi(() => v.get({ id })), `get ${id}`).toBe("NOT_FOUND");
      expect(await maLoi(() => v.download({ id })), `download ${id}`).toBe("NOT_FOUND");
      expect(await maLoi(() => v.delete({ id })), `delete ${id}`).toBe("NOT_FOUND");
    }
    expect(await so(sql`SELECT count(*)::int AS n FROM report_artifacts WHERE id IN (${aB}, ${aAB}, ${aAdm}, ${aSys})`)).toBe(4);
    expect(await maLoi(() => v.get({ id: aA }))).toBeNull();
    expect(await maLoi(() => v.delete({ id: aA }))).toBeNull();
    expect(await so(sql`SELECT count(*)::int AS n FROM report_artifacts WHERE id = ${aA}`)).toBe(0);
    // admin thấy hết và xoá được
    const ad = reportArtifactRouter.createCaller({ user: { id: adm.id, role: "admin", name: adm.name, twoFactorEnabled: true } } as never);
    const tatCa = (await ad.list({ limit: 200 })).items.map((x) => x.id);
    for (const id of [aMine, aB, aAB, aAdm, aSys]) expect(tatCa).toContain(id);
    expect(await maLoi(() => ad.delete({ id: aB }))).toBeNull();
  });

  it("★ W17b — khoá API export:read có phạm vi HẸP (nhà máy A) cùng luật: tải được tệp người tạo trong A; tệp người tạo B / nhiều nhà máy / toàn quyền / hệ thống ⇒ not_found; khoá TOÀN CỤC thấy hết", async () => {
    const { getArtifact, listArtifacts } = await import("../services/reportArtifactService");
    const fa = `${RUN}ka`;
    const fb = `${RUN}kb`;
    await dung(sql`INSERT INTO factories (code, name) VALUES (${fa}, ${fa}), (${fb}, ${fb})`);
    const cA = await taoNguoiDungTest("kca", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 kca" });
    const cB = await taoNguoiDungTest("kcb", "supervisor", { tienTo: "pw21", ts: RUN, ten: "PW21 kcb" });
    const adm = await taoNguoiDungTest("kadm", "admin", { tienTo: "pw21", ts: RUN, ten: "PW21 kadm" });
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${cA.id}, ${fa}), (${cB.id}, ${fb})`);
    const mk = async (by: number | null, ten: string) =>
      Number((await one(sql`INSERT INTO report_artifacts ("reportType", format, title, "storageKey", "storageUrl", "fileHash", "createdBy")
        VALUES ('t', 'csv', ${RUN + "-k" + ten}, ${RUN + "k" + ten}, 'http://x/' || ${RUN + "k" + ten}, ${"c".repeat(64)}, ${by}) RETURNING id`)).id);
    const aA = await mk(cA.id, "a");
    const aB = await mk(cB.id, "b");
    const aAdm = await mk(adm.id, "adm");
    const aSys = await mk(null, "sys");
    const khoaA = { privileged: true, tenantScope: { factoryCode: fa } };
    expect((await getArtifact(aA, khoaA)).id).toBe(aA);
    for (const id of [aB, aAdm, aSys]) await expect(getArtifact(id, khoaA), `khoá A / ${id}`).rejects.toMatchObject({ reason: "not_found" });
    const thay = (await listArtifacts(khoaA, { limit: 200 })).items.map((x) => x.id).filter((id) => [aA, aB, aAdm, aSys].includes(id));
    expect(thay).toEqual([aA]);
    const toanCuc = { privileged: true };
    for (const id of [aA, aB, aAdm, aSys]) expect((await getArtifact(id, toanCuc)).id).toBe(id);
    // khoá nhà máy rỗng (mã không tồn tại) ⇒ không thấy gì
    await expect(getArtifact(aA, { privileged: true, tenantScope: { factoryCode: "khong-co-" + RUN } })).rejects.toMatchObject({ reason: "not_found" });
  });
});
