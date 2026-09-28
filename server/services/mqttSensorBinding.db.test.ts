/**
 * doc 81 Đợt 1C Task 5 — MQTT: ĐÓNG đường ghi sensor/telemetry CHÉO MÁY + subscribe rộng.
 *
 * Quyết định chủ dự án 2026-09-27 (4c): thiết bị MQTT đã xác thực chỉ ghi được dữ liệu cho ĐÚNG máy
 * mà nó được gắn (`mqtt_clients."machineId"`, mig 0292) và đúng nhà máy của máy đó; chỉ subscribe
 * được nhánh `factory/…` / `syn/…` của CHÍNH máy mình. Client nội bộ của server không bị ảnh hưởng.
 *
 * Đo trên broker THẬT khởi bằng đúng hàm sản phẩm `initMqttBroker()` (bind 127.0.0.1, cổng 0 do HĐH
 * cấp — không đụng :1883/:8883 của :3000, không EMQX :1884), client là gói `mqtt` thật, DB là `_test`
 * (vitest.setup ép). Oracle ĐỘC LẬP với mã sản phẩm:
 *   · số dòng `machine_sensor_readings` / `ot_telemetry` đếm bằng SELECT thô qua kết nối `postgres`
 *     RIÊNG (không qua drizzle/mã sản phẩm), lọc theo sensorType/metric riêng của lượt chạy;
 *   · "publish bị từ chối" = broker ĐÓNG kết nối (aedes: authorizePublish trả lỗi ⇒ đóng client),
 *     quan sát bằng sự kiện `close` của mqtt.js; "subscribe bị từ chối" = SUBACK 0x80 (MQTT 3.1.1
 *     §3.9.3) đọc từ mqtt.js;
 *   · mỗi phép "không có dòng" đi kèm một ĐỐI CHỨNG dương gửi SAU nó trên cùng broker (một publish
 *     hợp lệ phải ra đúng một dòng) — tránh kết luận "0 dòng" chỉ vì chưa kịp ghi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import mqtt, { type MqttClient } from "mqtt";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `T5C${process.pid}${Date.now().toString(36)}`;
const SENSOR = `t5c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`; // sensorType ≤ 50
const METRIC = `t5c.${RUN}`;
const PW = "mat-khau-T5-dot1C";
const DEV = {
  a: `${RUN}-devA`,
  b: `${RUN}-devB`,
  un: `${RUN}-devUnbound`,
  dead: `${RUN}-devDead`,
};
const CODE = { a: `${RUN}-MA`, b: `${RUN}-MB`, dead: `${RUN}-MDEAD` };
const ISA = { a: `t5/${RUN}/l1/c1/ma`, b: `t5/${RUN}/l1/c1/mb` };

type Mod = typeof import("./mqttService");
let mod: Mod;
let sql: ReturnType<typeof postgres>;
let port = 0;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, a: 0, b: 0, dead: 0, tomb: 0 };
const openClients: MqttClient[] = [];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms: number, label: string): Promise<void> {
  await withTimeout((async () => {
    while (!(await cond())) await new Promise((r) => setTimeout(r, 25));
  })(), ms, label);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connect with the REAL mqtt.js client (never hangs); throws if the CONNECT is refused. */
function connect(dev: string): Promise<MqttClient> {
  const p = new Promise<MqttClient>((resolve, reject) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: `${dev}:T5:M`,
      password: PW,
      clientId: `${dev}-c-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 0,
      connectTimeout: 5000,
    });
    let done = false;
    c.on("connect", () => { if (!done) { done = true; openClients.push(c); resolve(c); } });
    c.on("error", (e) => { if (!done) { done = true; c.end(true); reject(e); } });
    c.on("close", () => { if (!done) { done = true; reject(new Error("closed before CONNACK")); } });
  });
  return withTimeout(p, 8000, `connect ${dev}`);
}

/** Resolves true when the broker closes this client within `ms` (publish denied), false otherwise. */
function closedWithin(c: MqttClient, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!c.connected) return resolve(true);
    const t = setTimeout(() => { c.removeListener("close", onClose); resolve(false); }, ms);
    const onClose = () => { clearTimeout(t); resolve(true); };
    c.once("close", onClose);
  });
}

/** QoS 1 publish; resolves once the broker PUBACKs (authorizePublish passed + message handled). */
function publishAcked(c: MqttClient, topic: string, payload: string): Promise<void> {
  return withTimeout(new Promise<void>((resolve, reject) => {
    c.publish(topic, payload, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
  }), 5000, `puback ${topic}`);
}

/** SUBSCRIBE one filter; true = granted, false = SUBACK 0x80 (or an error). Bounded. */
function trySubscribe(c: MqttClient, filter: string): Promise<boolean> {
  return withTimeout(new Promise<boolean>((resolve) => {
    c.subscribe(filter, { qos: 0 }, (err, granted) => {
      if (err) return resolve(false);
      resolve(Array.isArray(granted) && granted.length === 1 && granted[0].qos !== 128);
    });
  }), 5000, `subscribe ${filter}`);
}

async function demSensor(machineId?: number): Promise<number> {
  const r = machineId == null
    ? await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM machine_sensor_readings WHERE "sensorType" = ${SENSOR}`
    : await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM machine_sensor_readings WHERE "sensorType" = ${SENSOR} AND "machineId" = ${machineId}`;
  return Number(r[0].n);
}
async function demTelemetry(machineId?: number): Promise<number> {
  const r = machineId == null
    ? await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ot_telemetry WHERE metric = ${METRIC}`
    : await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ot_telemetry WHERE metric = ${METRIC} AND "machineId" = ${machineId}`;
  return Number(r[0].n);
}

const sensorTopic = (factory: number | string, code: string) => `factory/${factory}/${code}/sensor/${SENSOR}`;
const telemetryFrame = (assetId: string, value = 1) =>
  JSON.stringify({
    asset_id: assetId,
    ts: new Date().toISOString(),
    metrics: [{ name: METRIC, value, unit: "C", quality: "good" }],
  });

const FLAG_KEYS = [
  "MQTT_AUTO_REGISTER_UNKNOWN", "MQTT_REQUIRE_PASSWORD", "MQTT_ADMISSION_ENFORCE",
  "MQTT_TOPIC_ACL_WARN_ONLY", "MQTT_TOPIC_ACL_ENABLED", "MQTT_MTLS_ENABLED", "MQTT_TLS_ENABLED",
  "MQTT_ALLOW_PASSWORDLESS_REGISTERED", "MQTT_MTLS_MODE", "SENSOR_INGEST_BATCH_ENABLED",
  "TELEMETRY_BATCH_ENABLED", "CONTRACT_VALIDATE_INGEST_MODE",
];
const OTHER_KEYS = [
  "MQTT_ENABLED", "UNS_BRIDGE_ENABLED", "UNS_SPARKPLUG_ENABLED", "EXTERNAL_MQTT_ENABLED",
  "PDM_SENSOR_INGEST_ENABLED", "MQTT_TELEMETRY_BRIDGE_ENABLED",
];
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("doc 81 Đợt 1C Task 5 — MQTT sensor/telemetry chéo máy + subscribe rộng (broker thật, DB _test)", () => {
  beforeAll(async () => {
    for (const k of [...FLAG_KEYS, ...OTHER_KEYS]) savedEnv[k] = process.env[k];
    for (const k of FLAG_KEYS) delete process.env[k]; // đo MẶC ĐỊNH trong mã
    process.env.MQTT_ENABLED = "true";
    process.env.UNS_BRIDGE_ENABLED = "false";
    process.env.UNS_SPARKPLUG_ENABLED = "false";
    process.env.EXTERNAL_MQTT_ENABLED = "false";
    process.env.PDM_SENSOR_INGEST_ENABLED = "true"; // như dev .env
    process.env.MQTT_TELEMETRY_BRIDGE_ENABLED = "true"; // bật cầu để đo luật asset_id

    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T5C factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T5C ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T5C line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T5C station') RETURNING id`);
    // Tombstone CÙNG MÃ với máy A, tạo TRƯỚC (id nhỏ hơn): `machines.code` chỉ duy nhất trong hàng
    // đang hoạt động — tra máy theo mã mà không ghim sẽ có thể rơi vào tombstone này.
    ids.tomb = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${ids.station}, ${CODE.a}, 'T5C tombstone A', 'IOT_SENSOR', false) RETURNING id`);
    ids.a = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", isa95_path)
      VALUES (${ids.station}, ${CODE.a}, 'T5C A', 'IOT_SENSOR', true, ${ISA.a}) RETURNING id`);
    ids.b = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", isa95_path)
      VALUES (${ids.station}, ${CODE.b}, 'T5C B', 'IOT_SENSOR', true, ${ISA.b}) RETURNING id`);
    ids.dead = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${ids.station}, ${CODE.dead}, 'T5C dead', 'IOT_SENSOR', false) RETURNING id`);

    const hash = await bcrypt.hash(PW, 10);
    const seed = (dev: string, machineId: number | null) => sql`
      INSERT INTO mqtt_clients ("clientId", "deviceId", "deviceName", "deviceModel", "approvalStatus",
        "mappingType", "connectionStatus", "isActive", "passwordHash", "machineId")
      VALUES (${dev + "-seed"}, ${dev}, 'T5C', 'T5C', 'APPROVED', 'MANUAL', 'OFFLINE', true, ${hash}, ${machineId})`;
    await seed(DEV.a, ids.a);
    await seed(DEV.b, ids.b);
    await seed(DEV.un, null);
    await seed(DEV.dead, ids.dead);

    mod = await import("./mqttService");
    mod.initMqttBroker({ host: "127.0.0.1", port: 0, wsPort: 0 });
    await waitFor(() => mod.mqttHandlersReady() && !!mod.getMqttListenPorts().tcp, 15000, "broker ready");
    port = mod.getMqttListenPorts().tcp!;
    expect(port).toBeGreaterThan(0);
    expect([1883, 8883, 1884]).not.toContain(port);
  }, 60_000);

  afterAll(async () => {
    for (const c of openClients) c.end(true);
    if (mod) await withTimeout(mod.shutdownMqttBroker(), 10_000, "shutdownMqttBroker");
    if (sql) {
      await sql`DELETE FROM machine_sensor_readings WHERE "sensorType" = ${SENSOR}`;
      await sql`DELETE FROM ot_telemetry WHERE metric = ${METRIC}`;
      await sql`DELETE FROM mqtt_subscriptions WHERE "clientId" IN (SELECT id FROM mqtt_clients WHERE "deviceId" LIKE ${RUN + "%"})`;
      await sql`DELETE FROM mqtt_clients WHERE "deviceId" LIKE ${RUN + "%"}`;
      await sql`DELETE FROM machines WHERE id IN ${sql([ids.a, ids.b, ids.dead, ids.tomb].filter((x) => x > 0))}`;
      await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
      await sql.end();
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  // ── sensor: factory/{fId}/{machineCode}/sensor/* ────────────────────────────────────────────
  it("đường HỢP LỆ: thiết bị gắn máy A publish sensor của CHÍNH máy A ⇒ ghi đúng 1 dòng, machineId = A (không rơi vào tombstone cùng mã)", async () => {
    const before = await demSensor(ids.a);
    const c = await connect(DEV.a);
    await publishAcked(c, sensorTopic(ids.factory, CODE.a), "1.5");
    await waitFor(async () => (await demSensor(ids.a)) === before + 1, 8000, "row for A");
    expect(await demSensor(ids.tomb)).toBe(0);
    expect(c.connected).toBe(true);
    c.end(true);
  }, 30_000);

  it("publish CHÉO MÁY (A → mã của B) ⇒ broker từ chối (đóng kết nối), DB KHÔNG có dòng cho B", async () => {
    const bBefore = await demSensor(ids.b);
    const c = await connect(DEV.a);
    c.publish(sensorTopic(ids.factory, CODE.b), "9.9", { qos: 0 });
    expect(await closedWithin(c, 5000)).toBe(true);
    // Đối chứng dương: thiết bị B ghi cho chính nó ⇒ đúng +1 (lượt chéo máy ở trên sẽ làm thành +2).
    const cb = await connect(DEV.b);
    await publishAcked(cb, sensorTopic(ids.factory, CODE.b), "2.5");
    await waitFor(async () => (await demSensor(ids.b)) >= bBefore + 1, 8000, "control row for B");
    await sleep(300);
    expect(await demSensor(ids.b)).toBe(bBefore + 1);
    cb.end(true);
  }, 30_000);

  it("đúng mã máy nhưng SAI nhà máy ⇒ từ chối, không có dòng", async () => {
    const aBefore = await demSensor(ids.a);
    const c = await connect(DEV.a);
    c.publish(sensorTopic(ids.factory + 1_000_000, CODE.a), "7.7", { qos: 0 });
    expect(await closedWithin(c, 5000)).toBe(true);
    const c2 = await connect(DEV.a);
    await publishAcked(c2, sensorTopic(ids.factory, CODE.a), "1.6");
    await waitFor(async () => (await demSensor(ids.a)) >= aBefore + 1, 8000, "control row for A");
    await sleep(300);
    expect(await demSensor(ids.a)).toBe(aBefore + 1);
    c2.end(true);
  }, 30_000);

  it("thiết bị CHƯA gắn máy, hoặc gắn máy đã ngừng ⇒ không publish được factory/…/sensor (kể cả mã máy nào)", async () => {
    const total = await demSensor();
    for (const [dev, code] of [[DEV.un, CODE.a], [DEV.un, CODE.b], [DEV.dead, CODE.dead], [DEV.dead, CODE.a]] as const) {
      const c = await connect(dev);
      c.publish(sensorTopic(ids.factory, code), "3.3", { qos: 0 });
      expect(await closedWithin(c, 5000), `${dev} → ${code}`).toBe(true);
    }
    const cb = await connect(DEV.b);
    await publishAcked(cb, sensorTopic(ids.factory, CODE.b), "2.6");
    await waitFor(async () => (await demSensor()) >= total + 1, 8000, "control row");
    await sleep(300);
    expect(await demSensor()).toBe(total + 1);
    cb.end(true);
  }, 30_000);

  it("lớp INGEST (độc lập với ACL): ACL warn-only cho publish chéo máy đi qua broker, nhưng mẫu bị LOẠI và ĐẾM, không có dòng", async () => {
    process.env.MQTT_TOPIC_ACL_WARN_ONLY = "true";
    try {
      const statsBefore = mod.getMqttBindingDropStats();
      const bBefore = await demSensor(ids.b);
      const c = await connect(DEV.a);
      await publishAcked(c, sensorTopic(ids.factory, CODE.b), "8.8"); // warn-only ⇒ PUBACK
      expect(c.connected).toBe(true);
      const cun = await connect(DEV.un);
      await publishAcked(cun, sensorTopic(ids.factory, CODE.b), "8.9");
      const cb = await connect(DEV.b);
      await publishAcked(cb, sensorTopic(ids.factory, CODE.b), "2.7");
      await waitFor(async () => (await demSensor(ids.b)) >= bBefore + 1, 8000, "control row for B");
      await sleep(300);
      expect(await demSensor(ids.b)).toBe(bBefore + 1);
      expect(mod.getMqttBindingDropStats().sensorMessages - statsBefore.sensorMessages).toBe(2);
      c.end(true); cun.end(true); cb.end(true);
    } finally {
      delete process.env.MQTT_TOPIC_ACL_WARN_ONLY;
    }
  }, 30_000);

  // ── cầu telemetry: asset_id phải khớp máy của thiết bị ─────────────────────────────────────
  it("cầu telemetry: asset_id LỆCH máy của thiết bị ⇒ loại mẫu + đếm; KHỚP (mã hoặc machine:<id>) ⇒ ghi, machineId = máy của thiết bị", async () => {
    const statsBefore = mod.getMqttBindingDropStats();
    const topicA = `synapse/client/${DEV.a}/telemetry`;
    const c = await connect(DEV.a);
    await publishAcked(c, topicA, telemetryFrame(`machine:${ids.b}`, 11)); // lệch (id)
    await publishAcked(c, topicA, telemetryFrame(CODE.b, 12)); // lệch (mã)
    const cun = await connect(DEV.un);
    await publishAcked(cun, `synapse/client/${DEV.un}/telemetry`, telemetryFrame(CODE.a, 13)); // chưa gắn máy
    expect(c.connected).toBe(true); // topic của chính thiết bị: không bị ACL đóng
    await publishAcked(c, topicA, telemetryFrame(CODE.a, 21)); // khớp mã
    await publishAcked(c, topicA, telemetryFrame(`machine:${ids.a}`, 22)); // khớp id
    await waitFor(async () => (await demTelemetry(ids.a)) >= 2, 8000, "telemetry rows for A");
    await sleep(300);
    expect(await demTelemetry()).toBe(2);
    expect(await demTelemetry(ids.a)).toBe(2);
    const after = mod.getMqttBindingDropStats();
    expect(after.telemetrySamples - statsBefore.telemetrySamples).toBe(3);
    c.end(true); cun.end(true);
  }, 30_000);

  // ── subscribe ───────────────────────────────────────────────────────────────────────────────
  it("subscribe rộng / nhánh máy khác ⇒ SUBACK 0x80; nhánh CHÍNH máy mình + topic APK ⇒ được", async () => {
    const c = await connect(DEV.a);
    const denied = [
      "factory/#",
      "syn/#",
      "#",
      `factory/${ids.factory}/#`,
      `factory/${ids.factory}/+/sensor/+`,
      `factory/${ids.factory}/${CODE.b}/sensor/+`,
      `factory/+/${CODE.a}/sensor/+`,
      `factory/${ids.factory + 1_000_000}/${CODE.a}/#`,
      `syn/${ISA.b}/#`,
      "syn/+/+/+/+/+/telemetry",
      `+/${ids.factory}/${CODE.a}/sensor/+`,
    ];
    for (const f of denied) expect(await trySubscribe(c, f), `must deny ${f}`).toBe(false);
    expect(c.connected).toBe(true); // từ chối subscribe KHÔNG đóng kết nối
    const allowed = [
      `factory/${ids.factory}/${CODE.a}/sensor/+`,
      `factory/${ids.factory}/${CODE.a}/#`,
      `syn/${ISA.a}/#`,
      `syn/${ISA.a}/telemetry`,
      `avi/client/${DEV.a}/configure`,
      "avi/factory/+/workshop/+/station/+/errors",
      "avi/factory-alert/update",
    ];
    for (const f of allowed) expect(await trySubscribe(c, f), `must allow ${f}`).toBe(true);

    const cun = await connect(DEV.un);
    expect(await trySubscribe(cun, `factory/${ids.factory}/${CODE.a}/#`)).toBe(false);
    expect(await trySubscribe(cun, `syn/${ISA.a}/#`)).toBe(false);
    expect(await trySubscribe(cun, "avi/factory/+/workshop/+/station/+/errors")).toBe(true);
    c.end(true); cun.end(true);
  }, 30_000);

  // ── fix round 1 (ruling R-1C-e): publish đối xứng với subscribe — kênh LỆNH của máy khác ─────
  it("fix round 1: A publish vào kênh LỆNH của B (syn/{B}/cmd, factory/{f}/{B}/cmd) ⇒ bị từ chối, subscriber của B KHÔNG nhận gì; nhánh của chính A ⇒ được", async () => {
    const broker = mod.aedes!;
    const cmdB = [`syn/${ISA.b}/cmd`, `factory/${ids.factory}/${CODE.b}/cmd`];
    const cb = await connect(DEV.b);
    for (const f of cmdB) expect(await trySubscribe(cb, f), `B own ${f}`).toBe(true);
    const gotB: string[] = [];
    cb.on("message", (topic, payload) => gotB.push(`${topic}|${payload.toString()}`));

    for (const t of cmdB) {
      const ca = await connect(DEV.a);
      ca.publish(t, "FORGED", { qos: 0 });
      expect(await closedWithin(ca, 5000), `A → ${t}`).toBe(true);
    }
    const cun = await connect(DEV.un);
    cun.publish(cmdB[0], "FORGED", { qos: 0 });
    expect(await closedWithin(cun, 5000), "unbound → syn cmd").toBe(true);

    // Đối chứng dương: server (trong tiến trình) phát lên kênh lệnh của B ⇒ B NHẬN đúng một tin.
    await withTimeout(new Promise<void>((r) => broker.publish({ topic: cmdB[0], payload: Buffer.from("SERVER"), qos: 0, retain: false, cmd: "publish", dup: false } as any, () => r())), 5000, "internal publish");
    await waitFor(() => gotB.length >= 1, 5000, "B got the control message");
    await sleep(300);
    expect(gotB).toEqual([`${cmdB[0]}|SERVER`]);

    // Nhánh CHÍNH của A (lệnh/trạng thái dưới factory/ và syn/) ⇒ PUBACK, kết nối giữ nguyên.
    const ca = await connect(DEV.a);
    for (const t of [`syn/${ISA.a}/cmd/ack`, `factory/${ids.factory}/${CODE.a}/state`]) await publishAcked(ca, t, "ok");
    expect(ca.connected).toBe(true);
    ca.end(true); cb.end(true);
  }, 30_000);

  // ── client nội bộ của server ────────────────────────────────────────────────────────────────
  it("client NỘI BỘ không bị ảnh hưởng: aedes.subscribe('factory/#') trong tiến trình nhận publish của thiết bị; aedes.publish trong tiến trình tới thiết bị đã subscribe nhánh của nó", async () => {
    const broker = mod.aedes!;
    expect(broker).toBeTruthy();
    const got: string[] = [];
    const deliver = (packet: { topic: string }, cb: () => void) => { got.push(packet.topic); cb(); };
    await withTimeout(new Promise<void>((r) => broker.subscribe("factory/#", deliver as any, () => r())), 5000, "internal subscribe");
    try {
      const cb = await connect(DEV.b);
      const t = sensorTopic(ids.factory, CODE.b);
      await publishAcked(cb, t, "4.4");
      await waitFor(() => got.includes(t), 5000, "internal subscriber got device publish");

      const ca = await connect(DEV.a);
      const own = `factory/${ids.factory}/${CODE.a}/cmd/ping`;
      expect(await trySubscribe(ca, `factory/${ids.factory}/${CODE.a}/#`)).toBe(true);
      const received = new Promise<string>((resolve) => ca.on("message", (topic) => resolve(topic)));
      await withTimeout(new Promise<void>((r) => broker.publish({ topic: own, payload: Buffer.from("x"), qos: 0, retain: false, cmd: "publish", dup: false } as any, () => r())), 5000, "internal publish");
      expect(await withTimeout(received, 5000, "device got internal publish")).toBe(own);
      cb.end(true); ca.end(true);
    } finally {
      await new Promise<void>((r) => broker.unsubscribe("factory/#", deliver as any, () => r()));
    }
    // Hàm quyết định thuần: ngữ cảnh server (isServer) vẫn toàn quyền.
    const server = { clientId: "<internal>", isServer: true };
    expect(mod.canSubscribe(server, "factory/#", {} as NodeJS.ProcessEnv).allow).toBe(true);
    expect(mod.canSubscribe(server, "syn/#", {} as NodeJS.ProcessEnv).allow).toBe(true);
    expect(mod.canPublish(server, sensorTopic(ids.factory, CODE.b), {} as NodeJS.ProcessEnv).allow).toBe(true);
  }, 30_000);
});
