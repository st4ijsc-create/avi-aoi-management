/**
 * doc 81 Đợt 4 Task A4 — cho máy NGỪNG (decommission/retire), TỪ CHỐI máy, hay thu hồi credential máy ⇒ phiên MQTT
 * ĐANG SỐNG của thiết bị gắn máy bị ĐÓNG ngay sau commit. CSDL `_test` THẬT + broker aedes THẬT (`initMqttBroker()`
 * sản phẩm, 127.0.0.1 cổng 0, tắt ở afterAll) + client gói `mqtt` thật.
 *
 * Trước: revokeLinkedMqttClientsTx chỉ đặt mật khẩu "chết" (lần đăng nhập SAU bị từ chối) — phiên đã mở vẫn publish
 * dữ liệu của một máy đã ngừng cho tới khi tự rớt. Nay: sau commit gọi disconnectMqttDevice (khuôn rotatePassword).
 * Oracle: "bị đóng" = sự kiện `close` của mqtt.js; "không publish được" = nối lại bằng mật khẩu cũ bị CONNACK từ chối
 * và không phiên nào còn mở. Ca rollback: một khoá hàng của kết nối thử giữ UPDATE mqtt_clients của transaction sản
 * phẩm lại, rồi pg_cancel_backend huỷ câu ấy ⇒ transaction ROLLBACK THẬT ⇒ không được ngắt phiên nào.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import mqtt, { type MqttClient } from "mqtt";

const h = vi.hoisted(() => {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["MQTT_ENABLED", "UNS_BRIDGE_ENABLED", "UNS_SPARKPLUG_ENABLED", "EXTERNAL_MQTT_ENABLED", "MQTT_TOPIC_ACL_WARN_ONLY", "MQTT_TOPIC_ACL_ENABLED", "MQTT_REQUIRE_PASSWORD", "MQTT_AUTO_REGISTER_UNKNOWN", "IOT_DEVICE_CLASS_ENABLED"]) {
    saved[k] = process.env[k];
  }
  process.env.MQTT_ENABLED = "true"; // mqttService reads it at module load
  process.env.UNS_BRIDGE_ENABLED = "false";
  process.env.UNS_SPARKPLUG_ENABLED = "false";
  process.env.EXTERNAL_MQTT_ENABLED = "false";
  delete process.env.MQTT_TOPIC_ACL_WARN_ONLY;
  delete process.env.MQTT_TOPIC_ACL_ENABLED;
  delete process.env.MQTT_REQUIRE_PASSWORD;
  delete process.env.MQTT_AUTO_REGISTER_UNKNOWN;
  process.env.IOT_DEVICE_CLASS_ENABLED = "true";
  return { saved };
});

// ⚠ No vi.mock of mqttService: measured 2026-10-09 that hierarchy.ts's dynamic import of it bypasses a test-file mock on
//   this Windows checkout (it received the ORIGINAL export). The oracles below are therefore the broker itself: the
//   client's `close` event, and the mqtt_clients row read by a SEPARATE connection AT THE MOMENT the session closes.
import * as mqttSvc from "../services/mqttService";
import { transitionMachineLifecycle, rejectMachine, revokeMachineCredentials } from "./hierarchy";

const DB_URL = process.env.DATABASE_URL;
const RUN = `D4A4${Date.now().toString(36).toUpperCase()}`;
const PW = "mat-khau-D4A4";
let sql: ReturnType<typeof postgres>;
let port = 0;
const openClients: MqttClient[] = [];
const fx = { f: 0, w: 0, l: 0, s: 0, m: {} as Record<string, number>, dev: {} as Record<string, number> };
const DEV = (k: string) => `${RUN}-${k}`;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
async function waitFor(cond: () => boolean | Promise<boolean>, ms: number, label: string) {
  await withTimeout((async () => { while (!(await cond())) await new Promise((r) => setTimeout(r, 20)); })(), ms, label);
}
function tryConnect(dev: string, password = PW): Promise<{ ok: boolean; code?: number; client?: MqttClient }> {
  return withTimeout(new Promise((resolve) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: `${dev}:D4A4:M`, password, clientId: `${dev}-c-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 0, connectTimeout: 5000,
    });
    let done = false;
    c.on("connect", () => { if (!done) { done = true; openClients.push(c); resolve({ ok: true, client: c }); } });
    c.on("error", (e: any) => { if (!done) { done = true; c.end(true); resolve({ ok: false, code: typeof e?.code === "number" ? e.code : -1 }); } });
    c.on("close", () => { if (!done) { done = true; resolve({ ok: false, code: -2 }); } });
  }), 8000, `connect ${dev}`);
}
async function connect(dev: string): Promise<MqttClient> {
  const r = await tryConnect(dev);
  if (!r.ok) throw new Error(`connect ${dev} refused (${r.code})`);
  return r.client!;
}
function closedWithin(c: MqttClient, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!c.connected) return resolve(true);
    const t = setTimeout(() => { c.removeListener("close", on); resolve(false); }, ms);
    const on = () => { clearTimeout(t); resolve(true); };
    c.once("close", on);
  });
}
/** Resolves when the session closes, with the device row's approvalStatus as ANOTHER connection sees it at that moment. */
function closeObserved(c: MqttClient, k: string, ms: number): Promise<{ closed: boolean; stateAtClose: string | null }> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { c.removeListener("close", on); resolve({ closed: false, stateAtClose: null }); }, ms);
    const on = () => {
      clearTimeout(t);
      void stateOf(k).then((s) => resolve({ closed: true, stateAtClose: s }), () => resolve({ closed: true, stateAtClose: null }));
    };
    c.once("close", on);
  });
}
const publishAcked = (c: MqttClient, topic: string) =>
  withTimeout(new Promise<void>((res, rej) => c.publish(topic, "x", { qos: 1 }, (e) => (e ? rej(e) : res()))), 5000, `puback ${topic}`);
const topicOf = (k: string) => `factory/${fx.f}/${RUN}-${k}/state`;
const stateOf = async (k: string) =>
  (await sql<{ s: string }[]>`SELECT "approvalStatus" AS s FROM mqtt_clients WHERE id = ${fx.dev[k]}`)[0].s;

describe.skipIf(!DB_URL)("doc 81 Đợt 4 Task A4 — máy ngừng/từ chối/thu hồi ⇒ phiên MQTT sống bị đóng (DB _test + broker thật)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 3, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    fx.f = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${RUN}`}, 'A4 f', true) RETURNING id`);
    fx.w = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${fx.f}, ${`W-${RUN}`}, 'A4 w') RETURNING id`);
    fx.l = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${fx.w}, ${`L-${RUN}`}, 'A4 l') RETURNING id`);
    fx.s = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${fx.l}, ${`S-${RUN}`}, 'A4 s') RETURNING id`);
    const hash = await bcrypt.hash(PW, 10);
    for (const k of ["RET", "REJ", "REV", "RB", "CTL"]) {
      fx.m[k] = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "lifecycleStatus")
                               VALUES (${fx.s}, ${`${RUN}-${k}`}, ${`A4 ${k}`}, 'IOT_SENSOR', true, 'active') RETURNING id`);
      fx.dev[k] = await one(sql`INSERT INTO mqtt_clients ("clientId", "deviceId", "deviceName", "deviceModel", "approvalStatus", "mappingType",
                                  "connectionStatus", "isActive", "passwordHash", "machineId", "stationId")
                                VALUES (${DEV(k) + "-seed"}, ${DEV(k)}, 'A4', 'A4', 'APPROVED', 'MANUAL', 'OFFLINE', true, ${hash}, ${fx.m[k]}, ${fx.s}) RETURNING id`);
    }
    mqttSvc.initMqttBroker({ host: "127.0.0.1", port: 0, wsPort: 0 });
    await waitFor(() => mqttSvc.mqttHandlersReady() && !!mqttSvc.getMqttListenPorts().tcp, 15000, "broker ready");
    port = mqttSvc.getMqttListenPorts().tcp!;
    expect([1883, 8883, 1884]).not.toContain(port);
  }, 120_000);

  afterAll(async () => {
    for (const c of openClients) c.end(true);
    await withTimeout(mqttSvc.shutdownMqttBroker(), 10_000, "shutdownMqttBroker").catch(() => {});
    if (sql) {
      const devIds = Object.values(fx.dev).filter((x) => x > 0);
      const may = Object.values(fx.m).filter((x) => x > 0);
      await sql`DELETE FROM mqtt_subscriptions WHERE "clientId" = ANY(${devIds})`;
      await sql`DELETE FROM mqtt_clients WHERE id = ANY(${devIds})`;
      await sql`DELETE FROM machines WHERE id = ANY(${may})`;
      await sql`DELETE FROM stations WHERE id = ${fx.s}`;
      await sql`DELETE FROM production_lines WHERE id = ${fx.l}`;
      await sql`DELETE FROM workshops WHERE id = ${fx.w}`;
      await sql`DELETE FROM factories WHERE id = ${fx.f}`;
      await sql.end({ timeout: 5 });
    }
    for (const [k, v] of Object.entries(h.saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 60_000);

  it("đối chứng: thiết bị gắn máy đang hoạt động nối được và publish nhánh máy của nó (PUBACK)", async () => {
    const c = await connect(DEV("CTL"));
    await publishAcked(c, topicOf("CTL"));
    expect(c.connected).toBe(true);
    c.end(true);
  });

  it("★ máy active → decommissioned: phiên sống bị ĐÓNG sau commit; nối lại bằng mật khẩu cũ bị từ chối ⇒ không publish được nữa", async () => {
    const c = await connect(DEV("RET"));
    await publishAcked(c, topicOf("RET"));
    const obs = closeObserved(c, "RET", 5000);
    const r = await transitionMachineLifecycle(fx.m.RET, "decommissioned");
    expect(r.revoked?.mqttClientsRevoked).toBe(1);
    const o = await obs;
    expect(o.closed).toBe(true);
    expect(o.stateAtClose).toBe("REJECTED"); // closed only AFTER the revoke was committed (another connection sees it)
    const again = await tryConnect(DEV("RET"));
    expect(again.ok).toBe(false);
    // decommissioned → retired revokes again: still no way back in
    await transitionMachineLifecycle(fx.m.RET, "retired");
    expect((await tryConnect(DEV("RET"))).ok).toBe(false);
  }, 60_000);

  it("★ rejectMachine và revokeMachineCredentials cũng đóng phiên sống của thiết bị gắn máy", async () => {
    for (const [k, act] of [["REJ", () => rejectMachine(fx.m.REJ, "A4 reject")], ["REV", () => revokeMachineCredentials(fx.m.REV)]] as const) {
      const c = await connect(DEV(k));
      await publishAcked(c, topicOf(k));
      const obs = closeObserved(c, k, 5000);
      await act();
      const o = await obs;
      expect(o.closed, k).toBe(true);
      expect(o.stateAtClose, k).toBe("REJECTED");
      expect((await tryConnect(DEV(k))).ok, k).toBe(false);
    }
  }, 60_000);

  it("★ transaction ROLLBACK (câu UPDATE mqtt_clients bị huỷ) ⇒ KHÔNG ngắt phiên nào; máy vẫn active; thiết bị vẫn publish được", async () => {
    const c = await connect(DEV("RB"));
    await publishAcked(c, topicOf("RB"));
    const stillOpen = closeObserved(c, "RB", 1500);
    let waitingPid: number | null = null;
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM mqtt_clients WHERE id = ${fx.dev.RB} FOR UPDATE`; // hold the row
      const p = transitionMachineLifecycle(fx.m.RB, "decommissioned").then(() => "committed", (e) => `failed: ${String(e?.message ?? e).slice(0, 80)}`);
      await waitFor(async () => {
        const w = await sql<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND state = 'active' AND query ILIKE ${'%update "mqtt_clients"%'} AND pid <> pg_backend_pid()`;
        waitingPid = w[0]?.pid ?? null;
        return waitingPid !== null;
      }, 10_000, "product UPDATE waiting on the row lock");
      await sql`SELECT pg_cancel_backend(${waitingPid})`;
      const outcome = await withTimeout(p, 10_000, "transition after cancel");
      expect(outcome.startsWith("failed")).toBe(true);
    });
    expect((await stillOpen).closed).toBe(false); // no disconnect after a rolled-back retire
    expect((await sql<{ s: string }[]>`SELECT "lifecycleStatus" AS s FROM machines WHERE id = ${fx.m.RB}`)[0].s).toBe("active");
    expect(await stateOf("RB")).toBe("APPROVED");
    expect(c.connected).toBe(true);
    await publishAcked(c, topicOf("RB"));
    c.end(true);
  }, 60_000);

  it("★ ngắt phiên lỗi ⇒ chỉ ghi log, việc cho máy ngừng VẪN thành công (credential đã chết)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broker = mqttSvc.aedes as unknown as Record<string, unknown>;
    const desc = Object.getOwnPropertyDescriptor(broker, "clients");
    // Throw ONLY for disconnectMqttDevice's read; the broker's own reads keep the real value.
    Object.defineProperty(broker, "clients", {
      configurable: true,
      get: () => {
        if ((new Error().stack ?? "").includes("disconnectMqttDevice")) throw new Error("A4 injected broker failure");
        return desc?.get ? desc.get.call(broker) : desc?.value;
      },
    });
    try {
      const r = await transitionMachineLifecycle(fx.m.CTL, "decommissioned");
      expect(r.after.lifecycleStatus).toBe("decommissioned");
      expect(await stateOf("CTL")).toBe("REJECTED");
      expect(warn.mock.calls.some((a) => String(a[0]).includes("closing live MQTT sessions of a revoked device failed"))).toBe(true);
    } finally {
      if (desc) Object.defineProperty(broker, "clients", desc);
      else delete broker.clients;
      warn.mockRestore();
    }
  });
});
