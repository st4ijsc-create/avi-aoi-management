/**
 * ★★★ Lô W14b — phạm vi nhà máy của GHI chạm khoá API · OAuth ERP · khoá máy · MQTT · bản tin · dò thiết bị · hot-folder · nút edge · dự án chương trình · mô hình 3D · hàng rào tham số,
 * kiểm định phamViGhi 2026-10-25 (dieu-phoi duyệt phân loại + 6 điều kiện). Giám sát viên CHỈ gán nhà máy A: B ⇒ NOT_FOUND (hoặc FORBIDDEN SCOPE_MISMATCH cho phạm vi khoá RỘNG HƠN người cấp)
 * + dữ liệu B không đổi; đối chứng A→A thành công. Đột biến: gỡ cổng từng tệp ⇒ đỏ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

process.env.ERP_OAUTH_ENABLED = "true";
process.env.FIELD_V2_ENABLED = "true";
process.env.VISION_ADAPTERS_ENABLED = "true";
process.env.TWIN_LIVE_ENABLED = "true";
process.env.FLEET_RESOURCE_ENABLED = "true";
const RUN = `pw17${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
const so = async (q: ReturnType<typeof sql>) => Number((await one(q)).n);
const NF = "NOT_FOUND";

interface NhaMay {
  fid: number;
  wid: number;
  lid: number;
  sid: number;
  mid: number;
  code: string;
  corp: string;
  keyTenant: number;
  keyMay: number;
  oauth: number;
  outbox: number;
  profile: number;
  assign: number;
  mqttAlert: number;
  edge: number;
  hot: number;
  prog: number;
  model: number;
  guard: number;
  worker: string;
}
let A!: NhaMay;
let B!: NhaMay;
let uid = 0;
let guardType = 0;
const factories: string[] = [];
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const ma = String((e as { code?: string }).code ?? "LOI_LA");
    return ma === NF ? ma : `${ma}:${(e as Error).message.slice(0, 110)}`;
  }
}
const ma = (x: string | null) => (x ?? "").split(":")[0];

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const corp = `${code}C`;
  await dung(sql`INSERT INTO corporates (code, name) VALUES (${corp}, ${corp})`);
  const [f] = await dung(sql`INSERT INTO factories (code, name, "corporateCode") VALUES (${code}, ${code + " f"}, ${corp}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  const [k1] = await dung(sql`INSERT INTO api_keys (name, "keyHash", scopes, "dataScopeMode", "factoryCode") VALUES (${code + "-k1"}, ${code + "h1"}, '["ingest:write"]'::json, 'factory', ${code}) RETURNING id`);
  const [k2] = await dung(sql`INSERT INTO api_keys (name, "keyHash", scopes, "machineId") VALUES (${code + "-k2"}, ${code + "h2"}, '[]'::json, ${m.id}) RETURNING id`);
  const [oc] = await dung(sql`INSERT INTO erp_oauth_clients ("clientId", "clientSecretHash", name, "corporateCode") VALUES (${code + "-cl"}, 'x', ${code + "-cl"}, ${corp}) RETURNING id`);
  const [ob] = await dung(sql`INSERT INTO integration_outbox ("eventType", payload, "targetEndpoint", status, "corporateCode") VALUES ('x', '{}'::jsonb, 'http://x', 'dead', ${corp}) RETURNING id`);
  const [pf] = await dung(sql`INSERT INTO mqtt_client_profiles (name, "brokerUrl") VALUES (${code + "-pf"}, 'mqtt://x') RETURNING id`);
  const [as] = await dung(sql`INSERT INTO mqtt_profile_assignments ("profileId", "targetType", "targetId") VALUES (${pf.id}, 'machine', ${m.id}) RETURNING id`);
  const [al] = await dung(sql`INSERT INTO mqtt_connection_alerts ("profileId", "assignmentId", "targetType", "targetId", "alertType", title) VALUES (${pf.id}, ${as.id}, 'machine', ${m.id}, 'connection_lost', ${code + "-al"}) RETURNING id`);
  const [ed] = await dung(sql`INSERT INTO edge_nodes (code, name, "factoryCode") VALUES (${code + "-ed"}, ${code + "-ed"}, ${code}) RETURNING id`);
  const [hf] = await dung(sql`INSERT INTO hot_folder_configs ("machineId", "adapterKey", "watchPath") VALUES (${m.id}, 'x', ${"/tmp/" + code}) RETURNING id`);
  const [pp] = await dung(sql`INSERT INTO program_projects (code, name, kind, "factoryId") VALUES (${code + "-pp"}, ${code + "-pp"}, 'stub', ${f.id}) RETURNING id`);
  const [md] = await dung(sql`INSERT INTO equipment_3d_models ("modelKey", "modelUri", "machineId", "factoryId") VALUES (${code + "-mk"}, '/x.glb', ${m.id}, ${f.id}) RETURNING id`);
  const [gr] = await dung(sql`INSERT INTO parameter_guardrails (scope, "machine_id", param_key, min_value, max_value) VALUES ('machine', ${m.id}, ${code + "-p"}, 0, 10) RETURNING id`);
  factories.push(code);
  return {
    fid: Number(f.id), wid: Number(w.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), code, corp,
    keyTenant: Number(k1.id), keyMay: Number(k2.id), oauth: Number(oc.id), outbox: Number(ob.id), profile: Number(pf.id), assign: Number(as.id), mqttAlert: Number(al.id),
    edge: Number(ed.id), hot: Number(hf.id), prog: Number(pp.id), model: Number(md.id), guard: Number(gr.id), worker: `${code}-wk`,
  };
}

let c!: {
  key: ReturnType<typeof import("./apiKeyRouter").apiKeyRouter.createCaller>;
  erp: ReturnType<typeof import("./erpAdminRouter").erpAdminRouter.createCaller>;
  mach: ReturnType<typeof import("./machineApiRouters").machineApiRouter.createCaller>;
  mqtt: ReturnType<typeof import("./mqttClientManagementRouter").mqttClientManagementRouter.createCaller>;
  bul: ReturnType<typeof import("./mqttBulletinRouter").mqttBulletinRouter.createCaller>;
  ng: ReturnType<typeof import("./mqttNgAlertSettingsRouter").mqttNgAlertSettingsRouter.createCaller>;
  field: ReturnType<typeof import("./fieldRouter").fieldRouter.createCaller>;
  vis: ReturnType<typeof import("./visionAdapterRouter").visionAdapterRouter.createCaller>;
  hot: ReturnType<typeof import("./hotFolderRouter").hotFolderRouter.createCaller>;
  edge: ReturnType<typeof import("./edgeRuntimeRouter").edgeRuntimeRouter.createCaller>;
  fleet: ReturnType<typeof import("./fleetRouter").fleetRouter.createCaller>;
  twin: ReturnType<typeof import("./twinRouter").twinRouter.createCaller>;
  guard: ReturnType<typeof import("./parameterGuardrailRouter").parameterGuardrailRouter.createCaller>;
  secs: ReturnType<typeof import("./secsGemRouter").secsGemRouter.createCaller>;
};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  const u = await taoNguoiDungTest("ua", "supervisor", { tienTo: "pw17", ts: RUN, ten: "PW17 ua" });
  uid = u.id;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  guardType = Number((await one(sql`INSERT INTO parameter_guardrails (scope, machine_type, param_key, min_value, max_value) VALUES ('machine_type', 'AOI', ${RUN + "-pt"}, 0, 10) RETURNING id`)).id);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.code})`);
  for (const [cat, mod] of [
    ["settings", "admin_system"],
    ["machine_monitoring", "mqtt_monitoring"],
    ["settings", "mqtt_bulletin"],
    ["settings", "mqtt_alerts"],
    ["machine_monitoring", "machine_control"],
    ["machine_monitoring", "machine_alerts"],
    ["machine_monitoring", "machine_monitoring"],
    ["machine_monitoring", "machine_status"],
  ] as const) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`);
  }
  const ctx = { user: { id: u.id, role: "supervisor", name: u.name, twoFactorEnabled: true } } as never;
  c = {
    key: (await import("./apiKeyRouter")).apiKeyRouter.createCaller(ctx),
    erp: (await import("./erpAdminRouter")).erpAdminRouter.createCaller(ctx),
    mach: (await import("./machineApiRouters")).machineApiRouter.createCaller(ctx),
    mqtt: (await import("./mqttClientManagementRouter")).mqttClientManagementRouter.createCaller(ctx),
    bul: (await import("./mqttBulletinRouter")).mqttBulletinRouter.createCaller(ctx),
    ng: (await import("./mqttNgAlertSettingsRouter")).mqttNgAlertSettingsRouter.createCaller(ctx),
    field: (await import("./fieldRouter")).fieldRouter.createCaller(ctx),
    vis: (await import("./visionAdapterRouter")).visionAdapterRouter.createCaller(ctx),
    hot: (await import("./hotFolderRouter")).hotFolderRouter.createCaller(ctx),
    edge: (await import("./edgeRuntimeRouter")).edgeRuntimeRouter.createCaller(ctx),
    fleet: (await import("./fleetRouter")).fleetRouter.createCaller(ctx),
    twin: (await import("./twinRouter")).twinRouter.createCaller(ctx),
    guard: (await import("./parameterGuardrailRouter")).parameterGuardrailRouter.createCaller(ctx),
    secs: (await import("./secsGemRouter")).secsGemRouter.createCaller(ctx),
  };
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM parameter_guardrails WHERE param_key LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM equipment_3d_models WHERE "modelKey" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM program_variants WHERE "programProjectId" IN (${A?.prog ?? 0}, ${B?.prog ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM program_projects WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM hot_folder_configs WHERE "adapterKey" = 'x' AND "watchPath" LIKE ${"/tmp/" + like}`).catch(() => undefined);
  await dung(sql`DELETE FROM edge_nodes WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_bulletin_settings WHERE "stationId" IN (${A?.sid ?? 0}, ${B?.sid ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_ng_alert_settings WHERE "stationId" IN (${A?.sid ?? 0}, ${B?.sid ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_connection_alerts WHERE title LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_connection_status WHERE "profileId" IN (${A?.profile ?? 0}, ${B?.profile ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_reconnect_logs WHERE "profileId" IN (${A?.profile ?? 0}, ${B?.profile ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_connection_logs WHERE "profileId" IN (${A?.profile ?? 0}, ${B?.profile ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_profile_assignments WHERE "profileId" IN (${A?.profile ?? 0}, ${B?.profile ?? 0})`).catch(() => undefined);
  await dung(sql`DELETE FROM mqtt_client_profiles WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM integration_outbox WHERE "corporateCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM erp_oauth_clients WHERE name LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM api_keys WHERE name LIKE ${like}`).catch(() => undefined);
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM corporates WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("apiKey — phạm vi khoá KHÔNG rộng hơn người cấp", () => {
  it("tạo khoá global / chưa khai / nhà máy B ⇒ FORBIDDEN; khoá nhà máy A ⇒ được", async () => {
    const l = [
      await maLoi(() => c.key.create({ name: `${RUN}-g`, scopes: ["ingest:write"], dataScopeMode: "global" } as never)),
      await maLoi(() => c.key.create({ name: `${RUN}-n`, scopes: ["ingest:write"] } as never)),
      await maLoi(() => c.key.create({ name: `${RUN}-b`, scopes: ["ingest:write"], dataScopeMode: "factory", factoryCode: B.code } as never)),
    ];
    expect(l.map(ma)).toEqual(["FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM api_keys WHERE name IN (${RUN + "-g"}, ${RUN + "-n"}, ${RUN + "-b"})`)).toBe(0);
    expect(await maLoi(() => c.key.create({ name: `${RUN}-a`, scopes: ["ingest:write"], dataScopeMode: "factory", factoryCode: A.code } as never))).toBeNull();
  });
  it("khoá của nhà máy B (sửa · thu hồi · xoá) ⇒ NOT_FOUND; nới khoá A thành global ⇒ FORBIDDEN; khoá A sửa được", async () => {
    const l = [
      await maLoi(() => c.key.update({ id: B.keyTenant, name: "hack" } as never)),
      await maLoi(() => c.key.revoke({ id: B.keyTenant })),
      await maLoi(() => c.key.delete({ id: B.keyTenant })),
    ];
    expect(l).toEqual([NF, NF, NF]);
    expect(ma(await maLoi(() => c.key.update({ id: A.keyTenant, dataScopeMode: "global" } as never)))).toBe("FORBIDDEN");
    expect(await so(sql`SELECT count(*)::int AS n FROM api_keys WHERE id = ${B.keyTenant} AND "isActive" = true AND name = ${B.code + "-k1"}`)).toBe(1);
    expect(await maLoi(() => c.key.update({ id: A.keyTenant, name: `${RUN}-ok` } as never))).toBeNull();
  });
});

describe("erpAdmin — OAuth client + outbox", () => {
  it("client của tập đoàn B ⇒ NOT_FOUND; tạo client global / tập đoàn B ⇒ FORBIDDEN; tập đoàn A được", async () => {
    const l = [
      await maLoi(() => c.erp.rotateOauthClientSecret({ id: B.oauth })),
      await maLoi(() => c.erp.setOauthClientEnabled({ id: B.oauth, enabled: false })),
      await maLoi(() => c.erp.updateOauthClient({ id: B.oauth, name: "hack" })),
    ];
    expect(l).toEqual([NF, NF, NF]);
    expect([ma(await maLoi(() => c.erp.createOauthClient({ name: `${RUN}-g`, scopes: ["ingest:write"] } as never))), ma(await maLoi(() => c.erp.createOauthClient({ name: `${RUN}-b`, scopes: ["ingest:write"], corporateCode: B.corp } as never)))]).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    expect(await so(sql`SELECT count(*)::int AS n FROM erp_oauth_clients WHERE id = ${B.oauth} AND enabled = true AND name = ${B.code + "-cl"}`)).toBe(1);
    expect(await maLoi(() => c.erp.setOauthClientEnabled({ id: A.oauth, enabled: true }))).toBeNull();
  });
  it("retryOutboxDeadLetters: người hẹp chỉ đưa lại dòng của tập đoàn A; B vẫn 'dead'; mảng id của B ⇒ 0", async () => {
    const r1 = await c.erp.retryOutboxDeadLetters({ ids: [B.outbox] });
    expect(r1.requeued).toBe(0);
    expect(await so(sql`SELECT count(*)::int AS n FROM integration_outbox WHERE id = ${B.outbox} AND status = 'dead'`)).toBe(1);
    await c.erp.retryOutboxDeadLetters();
    expect(await so(sql`SELECT count(*)::int AS n FROM integration_outbox WHERE id = ${B.outbox} AND status = 'dead'`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM integration_outbox WHERE id = ${A.outbox} AND status = 'pending'`)).toBe(1);
  });
});

describe("machineApi — khoá máy + stationId tự khai", () => {
  it("thu hồi / xoay khoá của máy B ⇒ NOT_FOUND, khoá còn hiệu lực; khoá máy A thu hồi được", async () => {
    const l = [await maLoi(() => c.mach.revokeKey({ keyId: B.keyMay })), await maLoi(() => c.mach.rotateKey({ keyId: B.keyMay }))];
    expect(l).toEqual([NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM api_keys WHERE id = ${B.keyMay} AND "isActive" = true`)).toBe(1);
    expect(await maLoi(() => c.mach.revokeKey({ keyId: A.keyMay }))).toBeNull();
  });
  it("tramCungNhaMayVoiMay: trạm cùng nhà máy ⇒ true; trạm nhà máy khác / không tồn tại ⇒ false", async () => {
    const { tramCungNhaMayVoiMay } = await import("./_cauHinhPhamVi");
    expect([await tramCungNhaMayVoiMay(A.mid, A.sid), await tramCungNhaMayVoiMay(A.mid, B.sid), await tramCungNhaMayVoiMay(A.mid, 2_000_000_000)]).toEqual([true, false, false]);
  });
});

describe("mqttClientManagement · bản tin · cảnh báo NG theo trạm", () => {
  it("sự kiện / trạng thái / cảnh báo theo gán của máy B ⇒ NOT_FOUND; chỉ profileId ⇒ NOT_FOUND; gán A được; cấu hình cảnh báo cấp hồ sơ ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => c.mqtt.logConnectionEvent({ assignmentId: B.assign, clientId: "x", brokerUrl: "mqtt://x", eventType: "connect" })),
      await maLoi(() => c.mqtt.updateConnectionStatus({ profileId: B.profile, assignmentId: B.assign, status: "connected" })),
      await maLoi(() => c.mqtt.updateConnectionStatus({ profileId: B.profile, status: "connected" })),
      await maLoi(() => c.mqtt.logReconnectEvent({ profileId: B.profile, targetType: "machine", targetId: B.mid, eventType: "attempt" })),
      await maLoi(() => c.mqtt.createAlert({ profileId: B.profile, assignmentId: B.assign, alertType: "connection_lost", title: `${RUN}-x` })),
      await maLoi(() => c.mqtt.acknowledgeAlert({ alertId: B.mqttAlert })),
      await maLoi(() => c.mqtt.resolveAlert({ alertId: B.mqttAlert })),
      await maLoi(() => c.mqtt.updateAlertConfig({ profileId: B.profile, connectionLostThreshold: 5 })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_connection_alerts WHERE id = ${B.mqttAlert} AND "isAcknowledged" = false AND "isResolved" = false`)).toBe(1);
    expect(await maLoi(() => c.mqtt.updateConnectionStatus({ profileId: A.profile, assignmentId: A.assign, status: "connected" }))).toBeNull();
    expect(await maLoi(() => c.mqtt.acknowledgeAlert({ alertId: A.mqttAlert }))).toBeNull();
  });
  it("bản tin / cảnh báo NG: trạm B hoặc lô có trạm B ⇒ NOT_FOUND cả lô; trạm A được", async () => {
    const l = [
      await maLoi(() => c.bul.upsertSetting({ stationId: B.sid } as never)),
      await maLoi(() => c.bul.bulkToggle({ stationIds: [A.sid, B.sid], enabled: true })),
      await maLoi(() => c.bul.triggerNow({ stationId: B.sid })),
      await maLoi(() => c.bul.quickSetup({ stationIds: [B.sid] } as never)),
      await maLoi(() => c.ng.upsertSetting({ stationId: B.sid } as never)),
      await maLoi(() => c.ng.bulkToggle({ stationIds: [B.sid], enabled: true })),
    ];
    expect(l).toEqual([NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM mqtt_bulletin_settings WHERE "stationId" IN (${A.sid}, ${B.sid})`)).toBe(0);
    expect(await maLoi(() => c.ng.upsertSetting({ stationId: A.sid } as never))).toBeNull();
  });
});

describe("field · secsGem · visionAdapter · hotFolder · edge · fleet · twin · guardrail", () => {
  it("dò / đăng ký thiết bị: không nêu nhà máy hoặc nhà máy B ⇒ NOT_FOUND TRƯỚC khi mở kết nối; secsGem.testConnection chỉ toàn quyền", async () => {
    const l = [
      await maLoi(() => c.field.discover({ protocol: "opcua", endpoint: "opc.tcp://127.0.0.1:1" })),
      await maLoi(() => c.field.discover({ protocol: "opcua", endpoint: "opc.tcp://127.0.0.1:1", factoryId: B.fid })),
      await maLoi(() => c.field.registerDiscovered({ candidate: { protocol: "opcua", endpoint: "opc.tcp://127.0.0.1:1", name: `${RUN}-d` }, factoryId: B.fid })),
      await maLoi(() => c.secs.testConnection({ host: "127.0.0.1", port: 1 })),
    ];
    expect(l).toEqual([NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM device_adapters WHERE name LIKE ${RUN + "-d%"}`)).toBe(0);
  });
  it("vision ingest máy B / worker máy B ⇒ NOT_FOUND; hot-folder máy B (tạo · sửa · xoá · quét) ⇒ NOT_FOUND; A→A đổi cấu hình được", async () => {
    const l = [
      await maLoi(() => c.vis.ingest({ vendorKey: "generic-json", payload: {}, machineCode: B.code })),
      await maLoi(() => c.vis.startAcquisitionWorker({ id: `${RUN}-w`, source: { kind: "mock" }, machineCode: B.code } as never)),
      await maLoi(() => c.hot.createConfig({ machineId: B.mid, adapterKey: "x", watchPath: "/tmp/x" })),
      await maLoi(() => c.hot.updateConfig({ id: B.hot, patch: { enabled: false } })),
      await maLoi(() => c.hot.updateConfig({ id: A.hot, patch: { machineId: B.mid } })),
      await maLoi(() => c.hot.deleteConfig({ id: B.hot })),
      await maLoi(() => c.hot.processNow({ configId: B.hot })),
    ];
    expect(l.map(ma)).toEqual([NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM hot_folder_configs WHERE id = ${B.hot}`)).toBe(1);
  });
  it("xoá nút edge B / tạo biến thể chương trình cho dự án B / đăng ký lại mô hình 3D của B / lưu archive ⇒ NOT_FOUND; hàng rào tham số B + theo loại máy ⇒ NOT_FOUND", async () => {
    const l = [
      await maLoi(() => c.edge.deleteNode({ id: B.edge })),
      await maLoi(() => c.fleet.createVariant({ programProjectId: B.prog, variant: "A" } as never)),
      await maLoi(() => c.twin.models.archive({ id: B.model })),
      await maLoi(() => c.twin.models.register({ modelKey: B.code + "-mk", modelUri: "/y.glb", machineId: A.mid })),
      await maLoi(() => c.twin.models.register({ modelKey: `${RUN}-mk-moi`, modelUri: "/y.glb", machineId: B.mid })),
      await maLoi(() => c.guard.set({ scope: "machine", machineId: B.mid, paramKey: `${RUN}-p`, minValue: 0, maxValue: 5 })),
      await maLoi(() => c.guard.set({ scope: "machine_type", machineType: "AOI", paramKey: `${RUN}-pt2`, minValue: 0, maxValue: 5 })),
      await maLoi(() => c.guard.delete({ id: B.guard })),
      await maLoi(() => c.guard.delete({ id: guardType })),
    ];
    expect(l.map(ma)).toEqual([NF, NF, NF, NF, NF, NF, NF, NF, NF]);
    expect(await so(sql`SELECT count(*)::int AS n FROM program_variants WHERE "programProjectId" = ${B.prog}`)).toBe(0);
    expect(await maLoi(() => c.fleet.createVariant({ programProjectId: A.prog, variant: "A" } as never))).toBeNull();
    expect(await so(sql`SELECT count(*)::int AS n FROM edge_nodes WHERE id = ${B.edge}`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM equipment_3d_models WHERE id = ${B.model} AND status = 'active' AND "machineId" = ${B.mid}`)).toBe(1);
    expect(await so(sql`SELECT count(*)::int AS n FROM parameter_guardrails WHERE id IN (${B.guard}, ${guardType})`)).toBe(2);
    // đối chứng A→A
    expect(await maLoi(() => c.guard.set({ scope: "machine", machineId: A.mid, paramKey: `${RUN}-pa`, minValue: 0, maxValue: 5 }))).toBeNull();
    expect(await maLoi(() => c.edge.deleteNode({ id: A.edge }))).toBeNull();
    expect(await maLoi(() => c.twin.models.archive({ id: A.model }))).toBeNull();
  });
});
