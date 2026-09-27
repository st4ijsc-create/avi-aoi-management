/**
 * doc 81 Đợt 1C Task 5b — `mqttClient.bindMachine` trên DB `_test` THẬT + broker aedes THẬT.
 *
 * Task 5 khoá dữ liệu MQTT vào máy mà thiết bị được gắn (`mqtt_clients."machineId"`), nhưng chưa có
 * đường nào trong ứng dụng đặt cột ấy. Nghiệm thu đường đặt/gỡ:
 *   • cổng: admin/engineer + settings_factory canEdit; phạm vi CẢ HAI phía (thiết bị qua trạm, máy qua
 *     `idsTrongPhamVi("machine")`, và máy ĐANG gắn);
 *   • luật: máy đích đang hoạt động (không ngừng/retired/decommissioned); thiết bị REJECTED hoặc không
 *     có passwordHash ⇒ không GẮN được (gỡ thì được);
 *   • `control_audit_log` (trước/sau/lý do/người sửa) + `audit_logs` trong CÙNG transaction; audit hỏng ⇒
 *     ràng buộc không đổi;
 *   • hai lượt gắn đồng thời được TUẦN TỰ HOÁ (FOR UPDATE): ảnh "trước" của lượt sau = ảnh "sau" của lượt
 *     trước;
 *   • sau commit, phiên MQTT sống của thiết bị bị ĐÓNG: thiết bị gắn A publish được, đổi sang B ⇒ phiên cũ
 *     bị ngắt; nối lại ⇒ chỉ publish được với tư cách B.
 *
 * Broker khởi bằng đúng `initMqttBroker()` sản phẩm trên 127.0.0.1 cổng 0; client là gói `mqtt` thật.
 * Oracle độc lập: đọc bảng/audit bằng `SELECT` thô qua kết nối `postgres` riêng; "bị từ chối publish" =
 * broker đóng kết nối (sự kiện `close` của mqtt.js). Dấu chân: `control_audit_log` và `audit_logs` là WORM
 * (mig 0224/0279) — avi_app không xoá được; các dòng audit mang entityId = id `mqtt_clients` thử (đã xoá).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import mqtt, { type MqttClient } from "mqtt";

const h = vi.hoisted(() => {
  // mqttService đọc MQTT_ENABLED lúc nạp module ⇒ đặt TRƯỚC mọi import.
  const saved: Record<string, string | undefined> = {};
  for (const k of ["MQTT_ENABLED", "UNS_BRIDGE_ENABLED", "UNS_SPARKPLUG_ENABLED", "EXTERNAL_MQTT_ENABLED", "MQTT_TOPIC_ACL_WARN_ONLY", "MQTT_TOPIC_ACL_ENABLED", "MQTT_REQUIRE_PASSWORD", "MQTT_AUTO_REGISTER_UNKNOWN"]) {
    saved[k] = process.env[k];
  }
  process.env.MQTT_ENABLED = "true";
  process.env.UNS_BRIDGE_ENABLED = "false";
  process.env.UNS_SPARKPLUG_ENABLED = "false";
  process.env.EXTERNAL_MQTT_ENABLED = "false";
  delete process.env.MQTT_TOPIC_ACL_WARN_ONLY;
  delete process.env.MQTT_TOPIC_ACL_ENABLED;
  delete process.env.MQTT_REQUIRE_PASSWORD;
  delete process.env.MQTT_AUTO_REGISTER_UNKNOWN;
  return { saved, auditHong: false, treAudit: 0 };
});
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...actual,
    recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      if (h.auditHong) throw new Error("T5B-forced-audit-failure");
      // Nới cửa sổ giữa "đọc trước" và commit: không có khoá hàng thì hai lượt đồng thời cùng đọc `null`.
      if (h.treAudit > 0) await new Promise((r) => setTimeout(r, h.treAudit));
      return actual.recordAuditEvent(...args);
    },
  };
});

import { mqttClientRouter } from "./mqttOeeRouters";
import * as mqttSvc from "../services/mqttService";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;
const RUN = `T5B${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const PW = "mat-khau-T5B";

let sql: ReturnType<typeof postgres>;
let port = 0;
const openClients: MqttClient[] = [];
const fx = {
  factory: 0, factoryNgoai: 0, workshops: [] as number[], lines: [] as number[], stations: [] as number[],
  tram: 0, tramNgoai: 0,
  ma: 0, mb: 0, mDead: 0, mRetired: 0, mNgoai: 0,
  admin: 0, eng: 0, engKhongQuyen: 0, sup: 0,
  dev: {} as Record<string, number>,
};
const DEV = (k: string) => `${RUN}-${k}`;

function caller(userId: number, role: string) {
  return mqttClientRouter.createCaller({
    user: { id: userId, role, name: `probe-${role}`, twoFactorEnabled: true },
    req: { headers: { "user-agent": "T5B-test" }, ip: "127.0.0.1" },
  } as any);
}
const boundOf = async (k: string): Promise<number | null> =>
  (await sql<{ m: number | null }[]>`SELECT "machineId" AS m FROM mqtt_clients WHERE id = ${fx.dev[k]}`)[0].m;
const auditRows = async (k: string) =>
  sql<{ id: number; action: string; actorId: number | null; beforeJson: any; afterJson: any; reason: string | null }[]>`
    SELECT id, action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
     WHERE "entityType" = 'mqtt_client_machine_binding' AND "entityId" = ${String(fx.dev[k])} ORDER BY id`;
const auditLogRows = async (k: string) =>
  sql<{ action: string; userId: number | null; details: string; entityName: string | null }[]>`
    SELECT action, "userId", details, "entityName" FROM audit_logs
     WHERE action = 'mqttClient.bindMachine' AND "entityType" = 'mqtt_client' AND "entityId" = ${fx.dev[k]} ORDER BY id`;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
async function waitFor(cond: () => boolean, ms: number, label: string) {
  await withTimeout((async () => { while (!cond()) await new Promise((r) => setTimeout(r, 20)); })(), ms, label);
}
function connect(dev: string): Promise<MqttClient> {
  return withTimeout(new Promise<MqttClient>((resolve, reject) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: `${dev}:T5B:M`, password: PW, clientId: `${dev}-c-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 0, connectTimeout: 5000,
    });
    let done = false;
    c.on("connect", () => { if (!done) { done = true; openClients.push(c); resolve(c); } });
    c.on("error", (e) => { if (!done) { done = true; c.end(true); reject(e); } });
    c.on("close", () => { if (!done) { done = true; reject(new Error("closed before CONNACK")); } });
  }), 8000, `connect ${dev}`);
}
function tryConnect(dev: string, password: string): Promise<{ ok: boolean; code?: number; client?: MqttClient }> {
  return withTimeout(new Promise((resolve) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: `${dev}:T5B:M`, password, clientId: `${dev}-t-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 0, connectTimeout: 5000,
    });
    let done = false;
    c.on("connect", () => { if (!done) { done = true; openClients.push(c); resolve({ ok: true, client: c }); } });
    c.on("error", (e: any) => { if (!done) { done = true; c.end(true); resolve({ ok: false, code: typeof e?.code === "number" ? e.code : -1 }); } });
    c.on("close", () => { if (!done) { done = true; resolve({ ok: false, code: -2 }); } });
  }), 8000, `tryConnect ${dev}`);
}
function closedWithin(c: MqttClient, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!c.connected) return resolve(true);
    const t = setTimeout(() => { c.removeListener("close", on); resolve(false); }, ms);
    const on = () => { clearTimeout(t); resolve(true); };
    c.once("close", on);
  });
}
const publishAcked = (c: MqttClient, topic: string) =>
  withTimeout(new Promise<void>((res, rej) => c.publish(topic, "x", { qos: 1 }, (e) => (e ? rej(e) : res()))), 5000, `puback ${topic}`);

describe.skipIf(!DB_URL)("doc 81 Đợt 1C Task 5b — mqttClient.bindMachine (DB _test + broker thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 3, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const nhanh = async (hau: string) => {
      const f = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${RUN}${hau}`}, 'T5B f', true) RETURNING id`);
      const w = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`W-${RUN}${hau}`}, 'T5B w') RETURNING id`);
      const l = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`L-${RUN}${hau}`}, 'T5B l') RETURNING id`);
      const s = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l}, ${`S-${RUN}${hau}`}, 'T5B s') RETURNING id`);
      fx.workshops.push(w); fx.lines.push(l); fx.stations.push(s);
      return { f, s };
    };
    const trong = await nhanh("");
    const ngoai = await nhanh("-NGOAI");
    fx.factory = trong.f; fx.factoryNgoai = ngoai.f; fx.tram = trong.s; fx.tramNgoai = ngoai.s;
    const may = (st: number, hau: string, active = true, lifecycle = "active") =>
      one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "lifecycleStatus")
              VALUES (${st}, ${`${RUN}-${hau}`}, ${`T5B ${hau}`}, 'IOT_SENSOR', ${active}, ${lifecycle}) RETURNING id`);
    fx.ma = await may(trong.s, "MA");
    fx.mb = await may(trong.s, "MB");
    fx.mDead = await may(trong.s, "MDEAD", false);
    fx.mRetired = await may(trong.s, "MRET", true, "retired");
    fx.mNgoai = await may(ngoai.s, "MNGOAI");

    const hash = await bcrypt.hash(PW, 10);
    const tb = (k: string, st: number, o: { pw?: boolean; status?: string; machineId?: number | null; active?: boolean; fcm?: string; plain?: string } = {}) =>
      one(sql`INSERT INTO mqtt_clients ("clientId", "deviceId", "deviceName", "deviceModel", "approvalStatus", "mappingType",
                "connectionStatus", "isActive", "passwordHash", "machineId", "stationId", "fcmToken", "password")
              VALUES (${DEV(k) + "-seed"}, ${DEV(k)}, 'T5B', 'T5B', ${o.status ?? "APPROVED"}, 'MANUAL', 'OFFLINE', ${o.active ?? true},
                ${o.pw === false || o.plain ? null : hash}, ${o.machineId ?? null}, ${st}, ${o.fcm ?? null}, ${o.plain ?? null}) RETURNING id`);
    fx.dev.ok = await tb("ok", trong.s);
    fx.dev.nopw = await tb("nopw", trong.s, { pw: false });
    fx.dev.nopwBound = await tb("nopwb", trong.s, { pw: false, machineId: fx.ma });
    fx.dev.rej = await tb("rej", trong.s, { status: "REJECTED" });
    fx.dev.ngoai = await tb("ngoai", ngoai.s);
    fx.dev.boundNgoai = await tb("boundngoai", trong.s, { machineId: fx.mNgoai });
    fx.dev.conc = await tb("conc", trong.s);
    fx.dev.live = await tb("live", trong.s);
    // ── fix round 1 ──
    fx.dev.fcm = await tb("fcm", trong.s, { fcm: `FCM-SECRET-${RUN}` });
    fx.dev.plain = await tb("plain", trong.s, { plain: `PLAIN-SECRET-${RUN}` });
    fx.dev.rot = await tb("rot", trong.s, { pw: false });
    fx.dev.rotRej = await tb("rotrej", trong.s, { status: "REJECTED" });
    fx.dev.rotNgoai = await tb("rotngoai", ngoai.s);
    fx.dev.rotDel = await tb("rotdel", trong.s, { active: false });
    fx.dev.rotLive = await tb("rotlive", trong.s);
    fx.dev.del1 = await tb("del1", trong.s);
    fx.dev.del2 = await tb("del2", trong.s);
    fx.dev.resurrect = await tb("resur", trong.s, { active: false, machineId: fx.ma });
    fx.dev.cev = await tb("cev", trong.s, { machineId: fx.ma });
    fx.dev.noEnforce = await tb("noenf", trong.s);

    const user = async (hau: string, role: string) =>
      one(sql`INSERT INTO users ("openId", username, name, role, "isActive")
              VALUES (${`${RUN}-${hau}`}, ${`${RUN}-${hau}`}, ${`T5B ${hau}`}, ${role}, true) RETURNING id`);
    fx.admin = await user("admin", "admin");
    fx.eng = await user("eng", "engineer");
    fx.engKhongQuyen = await user("eng0", "engineer");
    fx.sup = await user("sup", "supervisor");
    const cap = async (uid: number, canEdit: boolean) =>
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
          VALUES (${uid}, 'settings'::permissioncategoryenum, ${resolvePermissionModule("settings_factory")}, true, false, ${canEdit}, false, false)`;
    await cap(fx.eng, true);
    await cap(fx.engKhongQuyen, false);
    await cap(fx.sup, true);
    for (const uid of [fx.eng, fx.engKhongQuyen, fx.sup]) {
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${`F-${RUN}`})`;
    }

    mqttSvc.initMqttBroker({ host: "127.0.0.1", port: 0, wsPort: 0 });
    await waitFor(() => mqttSvc.mqttHandlersReady() && !!mqttSvc.getMqttListenPorts().tcp, 15000, "broker ready");
    port = mqttSvc.getMqttListenPorts().tcp!;
    expect([1883, 8883, 1884]).not.toContain(port);
  }, 120_000);

  afterEach(() => {
    h.auditHong = false;
    h.treAudit = 0;
  });

  afterAll(async () => {
    for (const c of openClients) c.end(true);
    await withTimeout(mqttSvc.shutdownMqttBroker(), 10_000, "shutdownMqttBroker").catch(() => {});
    if (sql) {
      const devIds = Object.values(fx.dev).filter((x) => x > 0);
      const may = [fx.ma, fx.mb, fx.mDead, fx.mRetired, fx.mNgoai].filter((x) => x > 0);
      const uids = [fx.admin, fx.eng, fx.engKhongQuyen, fx.sup].filter((x) => x > 0);
      await sql`DELETE FROM mqtt_subscriptions WHERE "clientId" = ANY(${devIds})`;
      await sql`DELETE FROM mqtt_clients WHERE id = ANY(${devIds})`;
      await sql`DELETE FROM machines WHERE id = ANY(${may})`;
      await sql`DELETE FROM stations WHERE id = ANY(${fx.stations})`;
      await sql`DELETE FROM production_lines WHERE id = ANY(${fx.lines})`;
      await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshops})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.factory, fx.factoryNgoai]})`;
      await sql`DELETE FROM permissions WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM users WHERE id = ANY(${uids})`;
      await sql.end({ timeout: 5 });
    }
    for (const [k, v] of Object.entries(h.saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 60_000);

  it("cổng: supervisor (có canEdit) và engineer KHÔNG canEdit ⇒ FORBIDDEN; không đổi, không audit", async () => {
    await expect(caller(fx.sup, "supervisor").bindMachine({ clientId: fx.dev.ok, machineId: fx.ma, reason: "T5B sup" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(fx.engKhongQuyen, "engineer").bindMachine({ clientId: fx.dev.ok, machineId: fx.ma, reason: "T5B eng0" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await boundOf("ok")).toBeNull();
    expect(await auditRows("ok")).toHaveLength(0);
  });

  it("★ engineer gắn thiết bị với máy A ⇒ cột đổi; MỘT dòng control_audit_log trước null / sau A / lý do / actor; MỘT dòng audit_logs cùng trước/sau", async () => {
    const r = await caller(fx.eng, "engineer").bindMachine({ clientId: fx.dev.ok, machineId: fx.ma, reason: "T5B gan A" });
    expect(r).toMatchObject({ clientId: fx.dev.ok, machineId: fx.ma, previousMachineId: null, changed: true });
    expect(await boundOf("ok")).toBe(fx.ma);
    const rows = await auditRows("ok");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "mqtt_machine_bind", actorId: fx.eng, reason: "T5B gan A" });
    expect(rows[0].beforeJson).toMatchObject({ deviceId: DEV("ok"), machineId: null });
    expect(rows[0].afterJson).toMatchObject({ deviceId: DEV("ok"), machineId: fx.ma, machineCode: `${RUN}-MA`, factoryId: fx.factory });
    const logs = await auditLogRows("ok");
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(fx.eng);
    expect(logs[0].entityName).toBe(DEV("ok"));
    const d = JSON.parse(logs[0].details);
    expect(d.before.machineId).toBeNull();
    expect(d.after.machineId).toBe(fx.ma);
    expect(d.metadata.reason).toBe("T5B gan A");
  });

  it("gắn lại CÙNG máy ⇒ changed:false, không có dòng audit mới; GỠ (null) ⇒ audit unbind trước A / sau null", async () => {
    const r = await caller(fx.eng, "engineer").bindMachine({ clientId: fx.dev.ok, machineId: fx.ma, reason: "T5B lai A" });
    expect(r.changed).toBe(false);
    expect(await auditRows("ok")).toHaveLength(1);
    expect(await auditLogRows("ok")).toHaveLength(1);
    const u = await caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.ok, machineId: null, reason: "T5B go" });
    expect(u).toMatchObject({ machineId: null, previousMachineId: fx.ma, changed: true });
    expect(await boundOf("ok")).toBeNull();
    const last = (await auditRows("ok")).at(-1)!;
    expect(last).toMatchObject({ action: "mqtt_machine_unbind", actorId: fx.admin });
    expect(last.beforeJson.machineId).toBe(fx.ma);
    expect(last.afterJson.machineId).toBeNull();
  });

  it("phạm vi phía THIẾT BỊ: engineer không gắn được thiết bị ở trạm ngoài phạm vi (NOT_FOUND), cũng không đổi/gỡ được thiết bị đang gắn máy ngoài phạm vi (FORBIDDEN); admin thì được", async () => {
    const eng = caller(fx.eng, "engineer");
    await expect(eng.bindMachine({ clientId: fx.dev.ngoai, machineId: fx.ma, reason: "T5B ngoai" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const eDoi = await eng.bindMachine({ clientId: fx.dev.boundNgoai, machineId: fx.ma, reason: "T5B doi" }).catch((x) => x);
    // FR1 #6: một từ chối QUYỀN ⇒ mã PERMISSION_DENIED (action có khoá dịch), không phải INVALID_VALUE.
    expect(eDoi).toMatchObject({ code: "FORBIDDEN" });
    expect(eDoi.cause).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "changeMqttDeviceOfOtherScope", reason: "mqttBoundMachineOutOfScope" } });
    await expect(eng.bindMachine({ clientId: fx.dev.boundNgoai, machineId: null, reason: "T5B go" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await boundOf("ngoai")).toBeNull();
    expect(await boundOf("boundNgoai")).toBe(fx.mNgoai);
    expect(await auditRows("ngoai")).toHaveLength(0);
    expect(await auditRows("boundNgoai")).toHaveLength(0);
    await caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.ngoai, machineId: fx.mNgoai, reason: "T5B admin" });
    expect(await boundOf("ngoai")).toBe(fx.mNgoai);
  });

  it("phạm vi phía MÁY: engineer không gắn được thiết bị của mình vào máy ngoài phạm vi (NOT_FOUND, không đổi)", async () => {
    await expect(caller(fx.eng, "engineer").bindMachine({ clientId: fx.dev.conc, machineId: fx.mNgoai, reason: "T5B may ngoai" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await boundOf("conc")).toBeNull();
    expect(await auditRows("conc")).toHaveLength(0);
  });

  it("máy đích đã ngừng (isActive=false) hoặc vòng đời retired ⇒ BAD_REQUEST mqttMachineNotBindable; không tồn tại ⇒ không đổi", async () => {
    const ad = caller(fx.admin, "admin");
    for (const m of [fx.mDead, fx.mRetired, 2_000_000_000]) {
      const e = await ad.bindMachine({ clientId: fx.dev.conc, machineId: m, reason: "T5B chet" }).catch((x) => x);
      expect(e).toMatchObject({ code: "BAD_REQUEST" });
      expect((e as any).cause?.appParams).toMatchObject({ field: "machineId", reason: "mqttMachineNotBindable" });
    }
    expect(await boundOf("conc")).toBeNull();
    expect(await auditRows("conc")).toHaveLength(0);
  });

  it("thiết bị KHÔNG có passwordHash ⇒ không GẮN được (mqttDeviceNoCredential); REJECTED ⇒ mqttDeviceRejected; nhưng GỠ thiết bị không mật khẩu thì được", async () => {
    const ad = caller(fx.admin, "admin");
    const e1 = await ad.bindMachine({ clientId: fx.dev.nopw, machineId: fx.ma, reason: "T5B nopw" }).catch((x) => x);
    expect(e1).toMatchObject({ code: "BAD_REQUEST" });
    expect(e1.cause?.appParams).toMatchObject({ field: "clientId", reason: "mqttDeviceNoCredential" });
    const e2 = await ad.bindMachine({ clientId: fx.dev.rej, machineId: fx.ma, reason: "T5B rej" }).catch((x) => x);
    expect(e2).toMatchObject({ code: "BAD_REQUEST" });
    expect(e2.cause?.appParams).toMatchObject({ field: "clientId", reason: "mqttDeviceRejected" });
    expect(await boundOf("nopw")).toBeNull();
    expect(await boundOf("rej")).toBeNull();
    await ad.bindMachine({ clientId: fx.dev.nopwBound, machineId: null, reason: "T5B go nopw" });
    expect(await boundOf("nopwBound")).toBeNull();
  });

  it("★ audit HỎNG giữa transaction ⇒ lệnh ném VÀ ràng buộc KHÔNG đổi", async () => {
    h.auditHong = true;
    await expect(caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.conc, machineId: fx.ma, reason: "T5B hong" })).rejects.toThrow("T5B-forced-audit-failure");
    expect(await boundOf("conc")).toBeNull();
    expect(await auditLogRows("conc")).toHaveLength(0);
  });

  it("★ hai lượt gắn ĐỒNG THỜI được tuần tự hoá: cả hai thành công, ảnh 'trước' của lượt sau = ảnh 'sau' của lượt trước", async () => {
    h.treAudit = 300;
    const ad = caller(fx.admin, "admin");
    const [r1, r2] = await withTimeout(
      Promise.all([
        ad.bindMachine({ clientId: fx.dev.conc, machineId: fx.ma, reason: "T5B conc A" }),
        ad.bindMachine({ clientId: fx.dev.conc, machineId: fx.mb, reason: "T5B conc B" }),
      ]),
      15_000,
      "concurrent binds",
    );
    expect(r1.changed && r2.changed).toBe(true);
    const rows = await auditRows("conc");
    expect(rows).toHaveLength(2);
    expect(rows[0].beforeJson.machineId).toBeNull();
    expect(rows[1].beforeJson.machineId).toBe(rows[0].afterJson.machineId);
    expect(await boundOf("conc")).toBe(rows[1].afterJson.machineId);
  }, 30_000);

  it("★ broker thật: gắn A ⇒ publish nhánh A được; đổi sang B ⇒ phiên cũ BỊ NGẮT; nối lại ⇒ chỉ publish được với tư cách B", async () => {
    const ad = caller(fx.admin, "admin");
    await ad.bindMachine({ clientId: fx.dev.live, machineId: fx.ma, reason: "T5B live A" });
    const topicA = `factory/${fx.factory}/${RUN}-MA/state`;
    const topicB = `factory/${fx.factory}/${RUN}-MB/state`;
    const c1 = await connect(DEV("live"));
    await publishAcked(c1, topicA);
    expect(c1.connected).toBe(true);

    const closed = closedWithin(c1, 5000);
    const r = await ad.bindMachine({ clientId: fx.dev.live, machineId: fx.mb, reason: "T5B live B" });
    expect(r.sessionsClosed).toBeGreaterThanOrEqual(1);
    expect(await closed).toBe(true);

    const c2 = await connect(DEV("live"));
    c2.publish(topicA, "x", { qos: 0 });
    expect(await closedWithin(c2, 5000)).toBe(true); // A không còn là máy của thiết bị
    const c3 = await connect(DEV("live"));
    await publishAcked(c3, topicB);
    expect(c3.connected).toBe(true);

    // GỠ ⇒ phiên B cũng bị ngắt; nối lại không publish được dưới factory/.
    const closed3 = closedWithin(c3, 5000);
    await ad.bindMachine({ clientId: fx.dev.live, machineId: null, reason: "T5B live go" });
    expect(await closed3).toBe(true);
    const c4 = await connect(DEV("live"));
    c4.publish(topicB, "x", { qos: 0 });
    expect(await closedWithin(c4, 5000)).toBe(true);
  }, 60_000);

  it("★ phiên lọt qua đợt quét (xác thực với thế hệ ràng buộc CŨ): publish ⇒ bị đóng; subscribe ⇒ bị đóng — không dùng ràng buộc cũ", async () => {
    await caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.live, machineId: fx.mb, reason: "T5B stale" });
    const topicB = `factory/${fx.factory}/${RUN}-MB/state`;
    const lamCu = (c: MqttClient) => {
      // Dựng đúng trạng thái của cuộc đua: phiên đã đăng ký nhưng mang thế hệ ràng buộc đã bị thay.
      const sv = (mqttSvc.aedes as any).clients[(c.options as any).clientId];
      expect(sv).toBeTruthy();
      sv[mqttSvc.MQTT_ACL_BINDING_EPOCH_PROP] = -1;
    };
    const c1 = await connect(DEV("live"));
    lamCu(c1);
    c1.publish(topicB, "x", { qos: 0 });
    expect(await closedWithin(c1, 5000)).toBe(true);
    const c2 = await connect(DEV("live"));
    lamCu(c2);
    c2.subscribe(`factory/${fx.factory}/${RUN}-MB/#`, { qos: 0 });
    expect(await closedWithin(c2, 5000)).toBe(true);
    // Đối chứng: phiên mới đúng thế hệ vẫn publish được.
    const c3 = await connect(DEV("live"));
    await publishAcked(c3, topicB);
    expect(c3.connected).toBe(true);
    c3.end(true);
  }, 30_000);
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Fix round 1 (FIX_BASE 5877442d0)
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const SECRET_KEYS = ["passwordHash", "password", "fcmToken"];

  it("FR1 #1 ★ list/getById KHÔNG trả passwordHash / password / fcmToken (mọi vai); chỉ hasCredential / hasPushToken", async () => {
    for (const [uid, role] of [[fx.admin, "admin"], [fx.eng, "engineer"]] as const) {
      const rows = await caller(uid, role).list({});
      const mine = rows.filter((r: any) => String(r.deviceId).startsWith(RUN));
      expect(mine.length).toBeGreaterThan(3);
      for (const r of mine) for (const k of SECRET_KEYS) expect(Object.keys(r), `${role} list ${r.deviceId}`).not.toContain(k);
      const json = JSON.stringify(mine);
      expect(json).not.toContain(`FCM-SECRET-${RUN}`);
      expect(json).not.toContain(`PLAIN-SECRET-${RUN}`);
      expect(json).not.toMatch(/\$2[aby]\$/); // không một bcrypt hash nào
      const by = (k: string) => mine.find((r: any) => r.id === fx.dev[k]) as any;
      expect(by("ok").hasCredential).toBe(true);
      expect(by("nopw").hasCredential).toBe(false);
      expect(by("plain").hasCredential).toBe(true); // mật khẩu cũ dạng thô vẫn là một credential
      expect(by("fcm").hasPushToken).toBe(true);
      expect(by("ok").hasPushToken).toBe(false);
      for (const k of ["fcm", "plain", "ok"]) {
        const one = (await caller(uid, role).getById({ id: fx.dev[k] })) as any;
        expect(one).toBeTruthy();
        for (const s of SECRET_KEYS) expect(Object.keys(one), `${role} getById ${k}`).not.toContain(s);
        expect(JSON.stringify(one)).not.toMatch(/\$2[aby]\$|FCM-SECRET|PLAIN-SECRET/);
      }
    }
    const pend = await caller(fx.admin, "admin").pendingCount();
    expect(typeof pend.count).toBe("number");
  });

  it("FR1 #2 cổng rotatePassword: supervisor / engineer không canEdit ⇒ FORBIDDEN; trạm ngoài phạm vi ⇒ NOT_FOUND; đã xoá mềm ⇒ NOT_FOUND; REJECTED ⇒ mqttDeviceRejected; không đổi gì", async () => {
    const hashOf = async (k: string) => (await sql<{ h: string | null }[]>`SELECT "passwordHash" AS h FROM mqtt_clients WHERE id = ${fx.dev[k]}`)[0].h;
    await expect(caller(fx.sup, "supervisor").rotatePassword({ clientId: fx.dev.rot, reason: "T5B sup" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(fx.engKhongQuyen, "engineer").rotatePassword({ clientId: fx.dev.rot, reason: "T5B eng0" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(fx.eng, "engineer").rotatePassword({ clientId: fx.dev.rotNgoai, reason: "T5B ngoai" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(fx.admin, "admin").rotatePassword({ clientId: fx.dev.rotDel, reason: "T5B del" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const e = await caller(fx.admin, "admin").rotatePassword({ clientId: fx.dev.rotRej, reason: "T5B rej" }).catch((x) => x);
    expect(e).toMatchObject({ code: "BAD_REQUEST" });
    expect(e.cause?.appParams).toMatchObject({ field: "clientId", reason: "mqttDeviceRejected" });
    expect(await hashOf("rot")).toBeNull();
    const rows = await sql`SELECT id FROM control_audit_log WHERE "entityType" = 'mqtt_client_machine_binding' AND action = 'mqtt_password_rotate'
                           AND "entityId" = ANY(${[fx.dev.rot, fx.dev.rotNgoai, fx.dev.rotDel, fx.dev.rotRej].map(String)})`;
    expect(rows).toHaveLength(0);
  });

  it("FR1 #2 ★ rotatePassword: bcrypt ở passwordHash, password = NULL; bản thô trả về ĐÚNG MỘT lần; KHÔNG ở console, audit, lượt gọi sau, list/getById", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => vi.spyOn(console, m));
    let p1 = "";
    let p2 = "";
    let logged: string[] = [];
    try {
      const r1 = await caller(fx.eng, "engineer").rotatePassword({ clientId: fx.dev.rot, reason: "T5B cap mat khau" });
      p1 = r1.password;
      expect(r1).toMatchObject({ clientId: fx.dev.rot, deviceId: DEV("rot") });
      expect(p1).toMatch(/^[A-Za-z0-9_-]{32}$/); // randomBytes(24) → base64url 32 ký tự
      const r2 = await caller(fx.admin, "admin").rotatePassword({ clientId: fx.dev.rot, reason: "T5B xoay lai" });
      p2 = r2.password;
      expect(p2).not.toBe(p1);
      expect(JSON.stringify(r2)).not.toContain(p1); // lượt gọi sau không trả lại bản cũ
    } finally {
      // ⚠ Đọc lời gọi TRƯỚC mockRestore — mockRestore xoá luôn mock.calls (bản đầu đọc SAU ⇒ khẳng định
      // rỗng theo cấu tạo; đột biến R6 "console.log bản thô" đã sống sót vì thế).
      logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
      for (const s of spies) s.mockRestore();
    }
    expect(logged.length).toBeGreaterThan(0); // thước còn nhìn thấy: lượt xoay có in dòng "[MQTT] Binding changed …"
    for (const pw of [p1, p2]) expect(logged.filter((l) => l.includes(pw))).toEqual([]);

    const [row] = await sql<{ h: string | null; p: string | null }[]>`SELECT "passwordHash" AS h, password AS p FROM mqtt_clients WHERE id = ${fx.dev.rot}`;
    expect(row.p).toBeNull();
    expect(row.h).not.toBe(p2);
    expect(await bcrypt.compare(p2, row.h!)).toBe(true);
    expect(await bcrypt.compare(p1, row.h!)).toBe(false);

    const audits = await sql<{ beforeJson: any; afterJson: any; reason: string; actorId: number; action: string }[]>`
      SELECT "beforeJson", "afterJson", reason, "actorId", action FROM control_audit_log
       WHERE "entityType" = 'mqtt_client_machine_binding' AND "entityId" = ${String(fx.dev.rot)} ORDER BY id`;
    expect(audits.map((a) => a.action)).toEqual(["mqtt_password_rotate", "mqtt_password_rotate"]);
    expect(audits[0]).toMatchObject({ actorId: fx.eng, reason: "T5B cap mat khau" });
    expect(audits[0].beforeJson).toEqual({ deviceId: DEV("rot"), hadCredential: false });
    expect(audits[0].afterJson).toEqual({ deviceId: DEV("rot"), hasCredential: true });
    expect(audits[1].beforeJson).toEqual({ deviceId: DEV("rot"), hadCredential: true });
    const logs = await sql<{ details: string }[]>`SELECT details FROM audit_logs
       WHERE action = 'mqttClient.rotatePassword' AND "entityType" = 'mqtt_client' AND "entityId" = ${fx.dev.rot} ORDER BY id`;
    expect(logs).toHaveLength(2);
    // Không nơi nào của audit chứa bản thô hay hash (kể cả dòng trpc_mutation của middleware).
    const allAudit = JSON.stringify(audits) + JSON.stringify(logs) + JSON.stringify(
      await sql`SELECT details FROM audit_logs WHERE "userId" = ANY(${[fx.eng, fx.admin]}) AND action = 'mqttClient.rotatePassword'`);
    for (const pw of [p1, p2]) expect(allAudit).not.toContain(pw);
    expect(allAudit).not.toContain(row.h!);

    const listed = JSON.stringify(await caller(fx.admin, "admin").list({})) + JSON.stringify(await caller(fx.admin, "admin").getById({ id: fx.dev.rot }));
    for (const pw of [p1, p2]) expect(listed).not.toContain(pw);
    expect(listed).not.toContain(row.h!);
  });

  it("FR1 #2 ★ broker thật: sau rotatePassword phiên cũ bị ngắt, mật khẩu CŨ bị từ chối (CONNACK 4), mật khẩu MỚI vào được", async () => {
    const c1 = await connect(DEV("rotlive")); // mật khẩu cũ = PW
    const closed = closedWithin(c1, 5000);
    const r = await caller(fx.admin, "admin").rotatePassword({ clientId: fx.dev.rotLive, reason: "T5B xoay live" });
    expect(r.sessionsClosed).toBeGreaterThanOrEqual(1);
    expect(await closed).toBe(true);
    const cu = await tryConnect(DEV("rotlive"), PW);
    expect(cu.ok).toBe(false);
    expect(cu.code).toBe(4);
    const moi = await tryConnect(DEV("rotlive"), r.password);
    expect(moi.ok).toBe(true);
    moi.client!.end(true);
  }, 30_000);

  it("FR1 #3 MQTT_REQUIRE_PASSWORD=false ⇒ GẮN bị từ chối (mqttPasswordNotEnforced), GỠ vẫn được", async () => {
    process.env.MQTT_REQUIRE_PASSWORD = "false";
    try {
      const e = await caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.noEnforce, machineId: fx.ma, reason: "T5B noenf" }).catch((x) => x);
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(e.cause?.appParams).toMatchObject({ field: "clientId", reason: "mqttPasswordNotEnforced" });
      expect(await boundOf("noEnforce")).toBeNull();
    } finally {
      delete process.env.MQTT_REQUIRE_PASSWORD;
    }
    await caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.noEnforce, machineId: fx.ma, reason: "T5B noenf gan" });
    process.env.MQTT_REQUIRE_PASSWORD = "false";
    try {
      await caller(fx.admin, "admin").bindMachine({ clientId: fx.dev.noEnforce, machineId: null, reason: "T5B noenf go" });
      expect(await boundOf("noEnforce")).toBeNull();
    } finally {
      delete process.env.MQTT_REQUIRE_PASSWORD;
    }
  });

  it("FR1 #4 ★ xoá mềm (delete) và updateSettings(isActive=false) GỠ ràng buộc máy trong cùng transaction + audit unbind; phiên sống bị ngắt", async () => {
    const ad = caller(fx.admin, "admin");
    await ad.bindMachine({ clientId: fx.dev.del1, machineId: fx.ma, reason: "T5B del1" });
    await ad.bindMachine({ clientId: fx.dev.del2, machineId: fx.mb, reason: "T5B del2" });
    const c = await connect(DEV("del1"));
    const closed = closedWithin(c, 5000);
    await ad.delete({ id: fx.dev.del1 });
    expect(await closed).toBe(true);
    await ad.updateSettings({ id: fx.dev.del2, isActive: false });
    for (const [k, m] of [["del1", fx.ma], ["del2", fx.mb]] as const) {
      const [r] = await sql<{ m: number | null; a: boolean }[]>`SELECT "machineId" AS m, "isActive" AS a FROM mqtt_clients WHERE id = ${fx.dev[k]}`;
      expect(r).toEqual({ m: null, a: false });
      const last = (await auditRows(k)).at(-1)!;
      expect(last).toMatchObject({ action: "mqtt_machine_unbind", actorId: fx.admin });
      expect(last.beforeJson.machineId).toBe(m);
      expect(last.afterJson.machineId).toBeNull();
      expect(last.reason).toMatch(/soft-deleted|deactivated/);
    }
  }, 30_000);

  it("FR1 #4 ★ thiết bị đã xoá mềm (hàng cũ vẫn còn machineId) được tự đăng ký lại ⇒ phiên KHÔNG kế thừa ràng buộc cũ", async () => {
    process.env.MQTT_AUTO_REGISTER_UNKNOWN = "true";
    try {
      const c = await connect(DEV("resur"));
      c.publish(`factory/${fx.factory}/${RUN}-MA/state`, "x", { qos: 0 });
      expect(await closedWithin(c, 5000)).toBe(true);
    } finally {
      delete process.env.MQTT_AUTO_REGISTER_UNKNOWN;
    }
  }, 30_000);

  it("FR1 #5 ★ guard sự kiện 'client': phiên được đăng ký SAU đợt quét (thế hệ đã bị thay giữa xác thực và đăng ký) bị đóng NGAY, không cần publish/subscribe", async () => {
    const broker = mqttSvc.aedes as any;
    const goc = broker.authenticate;
    broker.authenticate = (client: any, u: any, p: any, cb: any) =>
      goc(client, u, p, (err: any, ok: any) => {
        // Xác thực xong (thế hệ đã đóng dấu) — một lượt gắn lại commit + quét NGAY LÚC NÀY.
        if (ok && String(u).startsWith(DEV("cev"))) mqttSvc.disconnectMqttDevice(DEV("cev"));
        cb(err, ok);
      });
    try {
      const r = await new Promise<boolean>((resolve) => {
        const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, { username: `${DEV("cev")}:T5B:M`, password: PW, clientId: `${DEV("cev")}-x`, reconnectPeriod: 0, connectTimeout: 5000 });
        openClients.push(c);
        const t = setTimeout(() => resolve(false), 4000);
        c.on("close", () => { clearTimeout(t); resolve(true); });
      });
      expect(r).toBe(true);
    } finally {
      broker.authenticate = goc;
    }
    // Đối chứng: không có cuộc đua ⇒ phiên ở lại.
    const c2 = await connect(DEV("cev"));
    expect(await closedWithin(c2, 1500)).toBe(false);
    c2.end(true);
  }, 30_000);
});
