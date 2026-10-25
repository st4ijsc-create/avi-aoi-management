/**
 * CỔNG CSDL THẬT — lô L6c-C2 (rà bảo mật tRPC, 2026-10-25): đọc theo TRỤC TRẠM / MQTT / MÃ:
 * mqttBulletin ×5 · mqttNgAlertSettings ×2 · mqttSoftwareVersion.deviceVersionSummary · mqttClientManagement ×6 (đích đa hình) · edgeRuntime.listNodes · erpAdmin ×3 · apiKey.list.
 * Luật: trạm / đích / mã ngoài phạm vi ≡ không tồn tại; hàng không định vị chỉ toàn quyền; hồ sơ MQTT là danh mục dùng chung; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `l6c2${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
const Q: Array<[string, string]> = [["machine_monitoring", "machine_status"], ["admin", "admin_system"]];
type C = Record<string, any>;
let cA: C, cAdm: C, cRong: C;
const ad: Record<string, number> = {};
const J = (x: unknown) => JSON.stringify(x);
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return {
    bl: await mk("./mqttBulletinRouter", "mqttBulletinRouter"),
    ng: await mk("./mqttNgAlertSettingsRouter", "mqttNgAlertSettingsRouter"),
    sv: await mk("./mqttSoftwareVersionRouter", "mqttSoftwareVersionRouter"),
    cm: await mk("./mqttClientManagementRouter", "mqttClientManagementRouter"),
    ed: await mk("./edgeRuntimeRouter", "edgeRuntimeRouter"),
    erp: await mk("./erpAdminRouter", "erpAdminRouter"),
    key: await mk("./apiKeyRouter", "apiKeyRouter"),
  };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}
const CA = RUN + "CA";
const CB = RUN + "CB";

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6c2", Q, dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  const { A, B } = H;
  await H.dung(sql`INSERT INTO user_corporate_assignments ("userId", "corporateCode") VALUES (${A.userId}, ${CA})`);
  const [pf] = await H.dung(sql`INSERT INTO mqtt_client_profiles (name, "brokerUrl") VALUES (${RUN + "pf"}, 'mqtt://x') RETURNING id`);
  ad.pf = pf.id;
  for (const [k, x] of [["A", A], ["B", B]] as const) {
    await H.dung(sql`INSERT INTO mqtt_bulletin_settings ("stationId") VALUES (${x.sid})`);
    await H.dung(sql`INSERT INTO mqtt_bulletin_history ("stationId", "periodStart", "periodEnd", payload, "totalCount") VALUES (${x.sid}, now(), now(), ${JSON.stringify({ k: RUN + k })}::json, ${k === "A" ? 7 : 11})`);
    const [h] = await H.dung(sql`SELECT id FROM mqtt_bulletin_history WHERE "stationId" = ${x.sid}`);
    ad["bh" + k] = h.id;
    await H.dung(sql`INSERT INTO mqtt_ng_alert_settings ("stationId") VALUES (${x.sid})`);
    await H.dung(sql`INSERT INTO mqtt_clients ("clientId", "deviceId", "stationId", "appVersion") VALUES (${RUN + "c" + k}, ${RUN + "d" + k}, ${x.sid}, ${RUN + "v" + k})`);
    const [asg] = await H.dung(sql`INSERT INTO mqtt_profile_assignments ("profileId", "targetType", "targetId") VALUES (${pf.id}, 'machine', ${x.mid}) RETURNING id`);
    ad["asg" + k] = asg.id;
    await H.dung(sql`INSERT INTO mqtt_connection_logs ("assignmentId", "clientId", "brokerUrl", "eventType") VALUES (${asg.id}, ${RUN + "log" + k}, 'mqtt://x', 'error')`);
    await H.dung(sql`INSERT INTO mqtt_connection_status ("profileId", "targetType", "targetId") VALUES (${pf.id}, 'machine', ${x.mid})`);
    await H.dung(sql`INSERT INTO mqtt_reconnect_logs ("profileId", "targetType", "targetId", "eventType") VALUES (${pf.id}, 'machine', ${x.mid}, 'failure')`);
    await H.dung(sql`INSERT INTO edge_nodes (code, name, "factoryCode") VALUES (${RUN + "en" + k}, ${RUN + "en" + k}, ${x.code})`);
    await H.dung(sql`INSERT INTO api_keys (name, "keyHash", scopes, "machineId") VALUES (${RUN + "km" + k}, ${RUN + "hm" + k}, '[]'::json, ${x.mid})`);
    await H.dung(sql`INSERT INTO api_keys (name, "keyHash", scopes, "dataScopeMode", "factoryCode") VALUES (${RUN + "kf" + k}, ${RUN + "hf" + k}, '[]'::json, 'factory', ${x.code})`);
    const cc = k === "A" ? CA : CB;
    await H.dung(sql`INSERT INTO erp_oauth_clients ("clientId", "clientSecretHash", name, scopes, "corporateCode") VALUES (${RUN + "oc" + k}, ${RUN + "oh" + k}, ${RUN + "oc" + k}, '[]'::json, ${cc})`);
    await H.dung(sql`INSERT INTO integration_outbox ("eventType", payload, "targetEndpoint", status, "corporateCode", "idempotencyKey") VALUES ('t', '{}'::jsonb, 'http://x', 'dead', ${cc}, ${RUN + "ob" + k})`);
  }
  // hàng không định vị: máy MQTT chưa gán · nhật ký chỉ có profileId · client ERP toàn cục · khoá toàn cục / chưa khai · nút edge không nhà máy
  await H.dung(sql`INSERT INTO mqtt_clients ("clientId", "deviceId", "appVersion") VALUES (${RUN + "cU"}, ${RUN + "dU"}, ${RUN + "vU"})`);
  await H.dung(sql`INSERT INTO mqtt_connection_logs ("profileId", "clientId", "brokerUrl", "eventType") VALUES (${pf.id}, ${RUN + "logP"}, 'mqtt://x', 'error')`);
  await H.dung(sql`INSERT INTO erp_oauth_clients ("clientId", "clientSecretHash", name, scopes) VALUES (${RUN + "ocG"}, ${RUN + "ohG"}, ${RUN + "ocG"}, '[]'::json)`);
  await H.dung(sql`INSERT INTO api_keys (name, "keyHash", scopes, "dataScopeMode") VALUES (${RUN + "kG"}, ${RUN + "hG"}, '[]'::json, 'global')`);
  await H.dung(sql`INSERT INTO api_keys (name, "keyHash", scopes) VALUES (${RUN + "kN"}, ${RUN + "hN"}, '[]'::json)`);
  await H.dung(sql`INSERT INTO edge_nodes (code, name) VALUES (${RUN + "enN"}, ${RUN + "enN"})`);
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  const l = `'${RUN}%'`;
  for (const s of [
    `DELETE FROM user_corporate_assignments WHERE "corporateCode" LIKE ${l}`,
    `DELETE FROM integration_outbox WHERE "idempotencyKey" LIKE ${l}`,
    `DELETE FROM erp_oauth_clients WHERE "clientId" LIKE ${l}`,
    `DELETE FROM api_keys WHERE name LIKE ${l}`,
    `DELETE FROM edge_nodes WHERE code LIKE ${l}`,
    `DELETE FROM mqtt_reconnect_logs WHERE "profileId" IN (SELECT id FROM mqtt_client_profiles WHERE name LIKE ${l})`,
    `DELETE FROM mqtt_connection_status WHERE "profileId" IN (SELECT id FROM mqtt_client_profiles WHERE name LIKE ${l})`,
    `DELETE FROM mqtt_connection_logs WHERE "clientId" LIKE ${l}`,
    `DELETE FROM mqtt_profile_assignments WHERE "profileId" IN (SELECT id FROM mqtt_client_profiles WHERE name LIKE ${l})`,
    `DELETE FROM mqtt_client_profiles WHERE name LIKE ${l}`,
    `DELETE FROM mqtt_clients WHERE "clientId" LIKE ${l}`,
    `DELETE FROM mqtt_ng_alert_settings WHERE "stationId" IN (${H.A.sid}, ${H.B.sid})`,
    `DELETE FROM mqtt_bulletin_history WHERE "stationId" IN (${H.A.sid}, ${H.B.sid})`,
    `DELETE FROM mqtt_bulletin_settings WHERE "stationId" IN (${H.A.sid}, ${H.B.sid})`,
  ]) await qChuTest(s).catch(() => undefined);
  await H.don();
});

describe("★★★ mqttBulletin ×5 · mqttNgAlertSettings ×2", () => {
  it("listSettings / getSetting / getHistory / getHistoryDetail / getDashboardStats chỉ trạm của A", async () => {
    const ls = await cA.bl.listSettings();
    expect(ls.map((s: any) => s.stationId)).toEqual([H.A.sid]);
    expect((await cAdm.bl.listSettings()).length).toBeGreaterThanOrEqual(2);
    expect(await cA.bl.getSetting({ stationId: H.B.sid })).toBeNull();
    expect((await cA.bl.getSetting({ stationId: H.A.sid }))?.stationId).toBe(H.A.sid);
    const hs = await cA.bl.getHistory({});
    expect(hs.items.map((i: any) => i.stationId)).toEqual([H.A.sid]);
    expect(hs.total).toBe(1);
    expect(await loi(() => cA.bl.getHistoryDetail({ id: ad.bhB }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:bulletin");
    expect(await loi(() => cA.bl.getHistoryDetail({ id: ad.bhA }))).toBeNull();
    expect(await loi(() => cAdm.bl.getHistoryDetail({ id: ad.bhB }))).toBeNull();
    const st = await cA.bl.getDashboardStats({});
    expect(st.summary.totalInspections).toBe(7);
    expect(st.summary.activeStations).toBe(1);
    expect(st.byStation.map((s: any) => s.stationId)).toEqual([H.A.sid]);
    expect((await cRong.bl.getDashboardStats({})).summary.totalBulletins).toBe(0);
  });
  it("ngAlert listSettings / getSetting", async () => {
    expect((await cA.ng.listSettings()).map((s: any) => s.stationId)).toEqual([H.A.sid]);
    expect(await cA.ng.getSetting({ stationId: H.B.sid })).toBeNull();
    expect((await cA.ng.getSetting({ stationId: H.A.sid }))?.stationId).toBe(H.A.sid);
    expect((await cAdm.ng.getSetting({ stationId: H.B.sid }))?.stationId).toBe(H.B.sid);
  });
});

describe("★★★ mqttSoftwareVersion.deviceVersionSummary", () => {
  it("thiết bị theo trạm trong phạm vi; thiết bị chưa gán chỉ toàn quyền", async () => {
    const a = J(await cA.sv.deviceVersionSummary());
    expect(a).toContain(RUN + "vA");
    expect(a).not.toContain(RUN + "vB");
    expect(a).not.toContain(RUN + "vU");
    const adm = J(await cAdm.sv.deviceVersionSummary());
    expect(adm).toContain(RUN + "vB");
    expect(adm).toContain(RUN + "vU");
  });
});

describe("★★★ mqttClientManagement ×6 — đích đa hình", () => {
  it("listAssignments / exportAssignmentReport / getConnectionStatus / getReconnectStatsByTarget chỉ đích của A", async () => {
    const la = J(await cA.cm.listAssignments({ profileId: ad.pf }));
    expect(la).toContain(`"id":${ad.asgA}`);
    expect(la).not.toContain(`"id":${ad.asgB}`);
    expect(J(await cAdm.cm.listAssignments({ profileId: ad.pf }))).toContain(`"id":${ad.asgB}`);
    const ex = J(await cA.cm.exportAssignmentReport({ profileId: ad.pf, format: "json" }));
    expect(ex).toContain(`"targetId":${H.A.mid}`);
    expect(ex).not.toContain(`"targetId":${H.B.mid}`);
    const cs = await cA.cm.getConnectionStatus({ profileId: ad.pf });
    expect(cs.items.map((i: any) => i.targetId)).toEqual([H.A.mid]);
    expect(cs.total).toBe(1);
    const rc = await cA.cm.getReconnectStatsByTarget({ targetType: "machine" });
    expect(rc.map((r: any) => r.targetId)).toEqual([H.A.mid]);
    expect((await cAdm.cm.getReconnectStatsByTarget({ targetType: "machine" })).length).toBeGreaterThanOrEqual(2);
  });
  it("getAvailableTargets chỉ máy / trạm / nhà máy trong phạm vi", async () => {
    const m = J(await cA.cm.getAvailableTargets({ targetType: "machine" }));
    expect(m).toContain(H.A.code);
    expect(m).not.toContain(H.B.code);
    expect(J(await cA.cm.getAvailableTargets({ targetType: "station" }))).not.toContain(H.B.code);
    expect(J(await cA.cm.getAvailableTargets({ targetType: "factory" }))).not.toContain(H.B.code);
    expect(J(await cAdm.cm.getAvailableTargets({ targetType: "factory" }))).toContain(H.B.code);
  });
  it("getDashboardStats: hồ sơ đếm chung; gán theo đích; nhật ký có assignmentId theo đích, nhật ký chỉ có profileId chỉ toàn quyền", async () => {
    const a = await cA.cm.getDashboardStats();
    const logsA = a.recentLogs.map((l: any) => l.clientId);
    expect(logsA).toContain(RUN + "logA");
    expect(logsA).not.toContain(RUN + "logB");
    expect(logsA).not.toContain(RUN + "logP");
    expect(a.assignments.machines).toBe(1);
    expect(a.errorsLast24h).toBe(1);
    expect(a.profiles.total).toBeGreaterThanOrEqual(1); // danh mục dùng chung — không lọc
    const adm = await cAdm.cm.getDashboardStats();
    expect(adm.recentLogs.map((l: any) => l.clientId)).toEqual(expect.arrayContaining([RUN + "logB", RUN + "logP"]));
  });
});

describe("★★★ edgeRuntime.listNodes · erpAdmin ×3 · apiKey.list", () => {
  it("listNodes theo mã nhà máy; nút không nhà máy chỉ toàn quyền", async () => {
    const a = J(await cA.ed.listNodes());
    expect(a).toContain(RUN + "enA");
    expect(a).not.toContain(RUN + "enB");
    expect(a).not.toContain(RUN + "enN");
    expect(J(await cA.ed.listNodes({ factoryCode: H.B.code }))).not.toContain(RUN + "enB");
    const adm = J(await cAdm.ed.listNodes());
    expect(adm).toContain(RUN + "enB");
    expect(adm).toContain(RUN + "enN");
  });
  it("erpAdmin: client / outbox theo tập đoàn; breakers chỉ toàn quyền", async () => {
    const oc = J(await cA.erp.listOauthClients());
    expect(oc).toContain(RUN + "ocA");
    expect(oc).not.toContain(RUN + "ocB");
    expect(oc).not.toContain(RUN + "ocG");
    expect(J(await cAdm.erp.listOauthClients())).toContain(RUN + "ocG");
    const dl = await cA.erp.outboxDeadLetters();
    expect(dl.count).toBe(1);
    expect((await cAdm.erp.outboxDeadLetters()).count).toBeGreaterThanOrEqual(2);
    const os = await cA.erp.outboxStatus();
    expect(os.counts.dead).toBe(1);
    expect(os.breakers).toEqual([]);
    expect(Number((await cAdm.erp.outboxStatus()).counts.dead)).toBeGreaterThanOrEqual(2);
  });
  it("apiKey.list: khoá máy / mã trong phạm vi; khoá toàn cục + chưa khai chỉ toàn quyền; không lộ băm", async () => {
    const a = J(await cA.key.list());
    expect(a).toContain(RUN + "kmA");
    expect(a).toContain(RUN + "kfA");
    for (const x of ["kmB", "kfB", "kG", "kN"]) expect(a).not.toContain(RUN + x);
    expect(a).not.toContain(RUN + "hmA");
    const adm = J(await cAdm.key.list());
    for (const x of ["kmB", "kfB", "kG", "kN"]) expect(adm).toContain(RUN + x);
    expect(J(await cRong.key.list())).not.toContain(RUN + "k");
  });
});
