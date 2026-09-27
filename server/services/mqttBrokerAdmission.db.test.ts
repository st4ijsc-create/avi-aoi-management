/**
 * doc 81 dot 1B task 10 — MQTT broker (aedes nhúng): KHÔNG nhận thiết bị lạ không mật khẩu,
 * KHÔNG flood log.
 *
 * Đo trên broker THẬT khởi bằng đúng hàm sản phẩm `initMqttBroker()` (bind 127.0.0.1, cổng 0 do
 * HĐH cấp — không đụng :1883/:8883 của :3000, không EMQX :1884), client là gói `mqtt` thật, DB
 * là `_test` (vitest.setup ép). Oracle ĐỘC LẬP với mã sản phẩm:
 *   · mã CONNACK đọc từ client mqtt.js (MQTT 3.1.1 §3.2.2.3: 4 = bad user name or password,
 *     5 = not authorized) — không đọc từ hàm quyết định của server;
 *   · số dòng `mqtt_clients` đếm thẳng bằng SELECT trên DB `_test` theo tiền tố của file này;
 *   · số dòng log đếm bằng spy trên console (logger thật của mqttService).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import mqtt, { type MqttClient } from "mqtt";
import { like, eq } from "drizzle-orm";

const RUN = `T10-${process.pid}-${Date.now().toString(36)}`;
const DEV_OK = `${RUN}-ok`;
const DEV_LEGACY = `${RUN}-legacy`;
const DEV_PENDING = `${RUN}-pend`;
const DEV_DELETED = `${RUN}-del`;
const PW = "dung-mat-khau-T10";

type Mod = typeof import("./mqttService");
let mod: Mod;
let db: any;
let schema: typeof import("../../drizzle/schema");
let port = 0;
const openClients: MqttClient[] = [];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms: number, label: string): Promise<void> {
  await withTimeout((async () => {
    while (!(await cond())) await new Promise((r) => setTimeout(r, 20));
  })(), ms, label);
}

type ConnectResult = { ok: boolean; code?: number; client?: MqttClient };

/** Connect with the REAL mqtt.js client; resolve with the CONNACK outcome (never hang). */
function tryConnect(username: string | undefined, password?: string): Promise<ConnectResult> {
  const p = new Promise<ConnectResult>((resolve) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username,
      password,
      clientId: `${RUN}-c-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 0,
      connectTimeout: 5000,
    });
    let done = false;
    c.on("connect", () => {
      if (done) return;
      done = true;
      openClients.push(c);
      resolve({ ok: true, client: c });
    });
    c.on("error", (err: any) => {
      if (done) return;
      done = true;
      c.end(true);
      resolve({ ok: false, code: typeof err?.code === "number" ? err.code : -1 });
    });
    c.on("close", () => {
      if (done) return;
      done = true;
      resolve({ ok: false, code: -2 });
    });
  });
  return withTimeout(p, 8000, `connect ${username}`);
}

async function rowsLike(prefix: string) {
  return db.select().from(schema.mqttClients).where(like(schema.mqttClients.deviceId, `${prefix}%`));
}

function countMqttLines(spy: { mock: { calls: unknown[][] } }, needle = "[MQTT"): number {
  return spy.mock.calls.filter((a) => typeof a[0] === "string" && (a[0] as string).includes(needle)).length;
}

const FLAG_KEYS = [
  "MQTT_AUTO_REGISTER_UNKNOWN", "MQTT_REQUIRE_PASSWORD", "MQTT_ADMISSION_ENFORCE",
  "MQTT_TOPIC_ACL_WARN_ONLY", "MQTT_TOPIC_ACL_ENABLED", "MQTT_MTLS_ENABLED", "MQTT_TLS_ENABLED",
];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of [...FLAG_KEYS, "MQTT_ENABLED", "UNS_BRIDGE_ENABLED", "UNS_SPARKPLUG_ENABLED", "EXTERNAL_MQTT_ENABLED"]) {
    savedEnv[k] = process.env[k];
  }
  for (const k of FLAG_KEYS) delete process.env[k]; // đo MẶC ĐỊNH trong mã
  process.env.MQTT_ENABLED = "true";
  process.env.UNS_BRIDGE_ENABLED = "false";
  process.env.UNS_SPARKPLUG_ENABLED = "false";
  process.env.EXTERNAL_MQTT_ENABLED = "false";

  schema = await import("../../drizzle/schema");
  const { getDb } = await import("../db");
  db = await getDb();
  expect(db).toBeTruthy();

  const hash = await bcrypt.hash(PW, 10);
  const base = {
    deviceName: "T10", deviceModel: "T10", mappingType: "MANUAL" as const,
    connectionStatus: "OFFLINE" as const, isActive: true,
  };
  await db.insert(schema.mqttClients).values([
    { ...base, clientId: `${DEV_OK}-seed`, deviceId: DEV_OK, approvalStatus: "APPROVED", passwordHash: hash },
    { ...base, clientId: `${DEV_LEGACY}-seed`, deviceId: DEV_LEGACY, approvalStatus: "APPROVED" },
    { ...base, clientId: `${DEV_PENDING}-seed`, deviceId: DEV_PENDING, approvalStatus: "PENDING", passwordHash: hash },
    { ...base, clientId: `${DEV_DELETED}-seed`, deviceId: DEV_DELETED, approvalStatus: "APPROVED", isActive: false },
  ]);

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
  if (db) await db.delete(schema.mqttClients).where(like(schema.mqttClients.deviceId, `${RUN}%`));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}, 30_000);

describe("task 10 — admission: thiết bị lạ / mật khẩu", () => {
  it("username lạ KHÔNG mật khẩu ⇒ CONNACK từ chối (4/5), KHÔNG có dòng mqtt_clients mới", async () => {
    const dev = `${RUN}-unk-single`;
    const r = await tryConnect(`${dev}:Hacker:X`);
    expect(r.ok).toBe(false);
    expect([4, 5]).toContain(r.code);
    expect(await rowsLike(dev)).toHaveLength(0);
  });

  it("200 kết nối lạ ⇒ 0 INSERT mqtt_clients, log bị gộp (không 1 dòng/kết nối)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const results: ConnectResult[] = [];
      for (let b = 0; b < 4; b++) {
        results.push(...await Promise.all(
          Array.from({ length: 50 }, (_, i) => tryConnect(`${RUN}-unk-${b * 50 + i}:X:Y`)),
        ));
      }
      expect(results.filter((r) => r.ok)).toHaveLength(0);
      expect(results.every((r) => r.code === 4 || r.code === 5)).toBe(true);
      expect(await rowsLike(`${RUN}-unk-`)).toHaveLength(0);
      const lines = countMqttLines(logSpy) + countMqttLines(warnSpy) + countMqttLines(errSpy);
      expect(lines).toBeLessThanOrEqual(10);
    } finally {
      logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
    }
  }, 60_000);

  it("thiết bị hợp lệ, đúng mật khẩu ⇒ kết nối được (CONNACK 0)", async () => {
    const r = await tryConnect(`${DEV_OK}:Tablet:M1`, PW);
    expect(r.ok).toBe(true);
    r.client!.end(true);
  });

  it("thiết bị có mật khẩu: SAI hoặc THIẾU mật khẩu ⇒ CONNACK 4 (mặc định trong mã, không cần env)", async () => {
    const wrong = await tryConnect(`${DEV_OK}:Tablet:M1`, "sai-mat-khau");
    expect(wrong.ok).toBe(false);
    expect(wrong.code).toBe(4);
    const missing = await tryConnect(`${DEV_OK}:Tablet:M1`);
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe(4);
  });

  it("lối thoát MQTT_REQUIRE_PASSWORD=false (đặt tường minh) ⇒ hành vi cũ: mật khẩu không bị kiểm", async () => {
    process.env.MQTT_REQUIRE_PASSWORD = "false";
    try {
      const r = await tryConnect(`${DEV_OK}:Tablet:M1`, "sai-mat-khau");
      expect(r.ok).toBe(true);
      r.client!.end(true);
    } finally {
      delete process.env.MQTT_REQUIRE_PASSWORD;
    }
  });

  it("thiết bị ĐÃ BIẾT chưa cấu hình mật khẩu (đường cũ hợp lệ) ⇒ vẫn kết nối được", async () => {
    const r = await tryConnect(`${DEV_LEGACY}:Tablet:M1`);
    expect(r.ok).toBe(true);
    r.client!.end(true);
  });

  it("thiết bị đã XOÁ MỀM (isActive=false) + cờ tắt ⇒ từ chối, KHÔNG tự hồi sinh thành PENDING", async () => {
    const r = await tryConnect(`${DEV_DELETED}:Tablet:M1`);
    expect(r.ok).toBe(false);
    expect([4, 5]).toContain(r.code);
    const [row] = await db.select().from(schema.mqttClients).where(eq(schema.mqttClients.deviceId, DEV_DELETED));
    expect(row.isActive).toBe(false);
    expect(row.approvalStatus).toBe("APPROVED");
  });

  it("MQTT_AUTO_REGISTER_UNKNOWN=true ⇒ tự đăng ký PENDING như cũ nhưng ≤ 10/phút/IP", async () => {
    (mod as any)._resetMqttAuthLimiters?.();
    process.env.MQTT_AUTO_REGISTER_UNKNOWN = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const results: ConnectResult[] = [];
      for (let i = 0; i < 30; i++) results.push(await tryConnect(`${RUN}-auto-${i}:Tab:M`));
      const accepted = results.filter((r) => r.ok);
      expect(accepted).toHaveLength(10);
      expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
      expect(results.slice(10).every((r) => !r.ok && (r.code === 4 || r.code === 5))).toBe(true);
      for (const r of accepted) r.client!.end(true);
      const rows = await rowsLike(`${RUN}-auto-`);
      expect(rows).toHaveLength(10);
      expect(rows.every((x: any) => x.approvalStatus === "PENDING")).toBe(true);
    } finally {
      delete process.env.MQTT_AUTO_REGISTER_UNKNOWN;
      warnSpy.mockRestore(); logSpy.mockRestore(); errSpy.mockRestore();
    }
  }, 60_000);
});

describe("task 10 — nhánh anh em: listener MQTT-over-WebSocket dùng CÙNG cổng xác thực", () => {
  it("username lạ qua ws:// ⇒ từ chối, không INSERT", async () => {
    mod._resetMqttAuthLimiters(); // để bộ giới hạn KHÔNG che đột biến cổng cờ (lớp ngoài che lớp trong)
    const wsPort = mod.getMqttListenPorts().ws!;
    expect(wsPort).toBeGreaterThan(0);
    const dev = `${RUN}-unk-ws`;
    const r = await withTimeout(new Promise<ConnectResult>((resolve) => {
      const c = mqtt.connect(`ws://127.0.0.1:${wsPort}`, { username: `${dev}:X:Y`, reconnectPeriod: 0, connectTimeout: 5000 });
      c.on("connect", () => { c.end(true); resolve({ ok: true }); });
      c.on("error", (e: any) => { c.end(true); resolve({ ok: false, code: e?.code }); });
    }), 8000, "ws connect");
    expect(r.ok).toBe(false);
    expect([4, 5]).toContain(r.code);
    expect(await rowsLike(dev)).toHaveLength(0);
  });
});

describe("task 10 — đơn vị: cờ, bộ giới hạn, bộ gộp log (đồng hồ giả)", () => {
  it("mặc định trong mã: AUTO_REGISTER tắt, REQUIRE_PASSWORD bật; chỉ false/0/off mới tắt mật khẩu", () => {
    expect(mod.mqttAutoRegisterUnknown({})).toBe(false);
    expect(mod.mqttAutoRegisterUnknown({ MQTT_AUTO_REGISTER_UNKNOWN: "true" })).toBe(true);
    expect(mod.mqttAutoRegisterUnknown({ MQTT_AUTO_REGISTER_UNKNOWN: "yes-please" })).toBe(false);
    expect(mod.mqttRequirePassword({})).toBe(true);
    expect(mod.mqttRequirePassword({ MQTT_REQUIRE_PASSWORD: "true" })).toBe(true);
    expect(mod.mqttRequirePassword({ MQTT_REQUIRE_PASSWORD: "nonsense" })).toBe(true);
    for (const off of ["false", "0", "off", "FALSE"]) {
      expect(mod.mqttRequirePassword({ MQTT_REQUIRE_PASSWORD: off })).toBe(false);
    }
  });

  it("limiter: 10/phút theo khoá, khoá khác độc lập, hết cửa sổ thì mở lại", () => {
    let t = 1_000_000;
    const lim = new mod.MqttSlidingWindowLimiter(10, 60_000, () => t);
    const a = Array.from({ length: 15 }, () => lim.tryTake("10.0.0.1"));
    expect(a.filter(Boolean)).toHaveLength(10);
    expect(lim.tryTake("10.0.0.2")).toBe(true);
    t += 59_999;
    expect(lim.tryTake("10.0.0.1")).toBe(false);
    t += 1;
    expect(lim.tryTake("10.0.0.1")).toBe(true);
  });

  it("decideMqttSelfRegistration: trần toàn cục chặn cả khi mỗi IP còn dưới 10", () => {
    mod._resetMqttAuthLimiters();
    const env = { MQTT_AUTO_REGISTER_UNKNOWN: "true" };
    let ok = 0;
    for (let ip = 0; ip < 20; ip++) {
      for (let k = 0; k < 5; k++) if (mod.decideMqttSelfRegistration(`10.9.0.${ip}`, env).ok) ok++;
    }
    expect(ok).toBe(mod.MQTT_AUTO_REGISTER_GLOBAL_PER_MIN);
    expect(mod.decideMqttSelfRegistration("10.9.9.9", {}).ok).toBe(false);
    mod._resetMqttAuthLimiters();
  });

  it("coalescer: 1 dòng đầu, gộp trong cửa sổ, 1 dòng tóm tắt có SỐ LẦN; ngân sách chặn xoay khoá", () => {
    let t = 5_000_000;
    const out: string[] = [];
    const co = new mod.MqttLogCoalescer({ label: "[X]", emit: (l) => out.push(l), windowMs: 60_000, maxLinesPerWindow: 5, now: () => t });
    for (let i = 0; i < 10_000; i++) co.hit("k", "line-k");
    expect(out).toEqual(["line-k"]);
    t += 60_000;
    co.sweep();
    expect(out).toHaveLength(2);
    expect(out[1]).toContain("line-k");
    expect(out[1]).toContain("9999");
    // xoay khoá 1.000 lần trong một cửa sổ ⇒ ≤ ngân sách + tóm tắt tràn
    out.length = 0;
    for (let i = 0; i < 1000; i++) co.hit(`topic-${i}`, `line-${i}`);
    expect(out).toHaveLength(5);
    t += 60_000;
    co.sweep();
    expect(out.some((l) => l.startsWith("[X] 995 further"))).toBe(true);
    co.reset();
  });
});

describe("task 10 — log 'publish ngoài phạm vi' được gộp", () => {
  it("thiết bị PENDING publish 10.000 message ngoài phạm vi ⇒ ≤ vài dòng WARN (vẫn còn ≥ 1 dòng)", async () => {
    const r = await tryConnect(`${DEV_PENDING}:Tablet:M1`, PW);
    expect(r.ok).toBe(true);
    const c = r.client!;
    const topic = `avi/client/${DEV_PENDING}/ack`; // ngoài pairing scope ⇒ admission violation (warn mặc định)
    let seen = 0;
    const onPub = (packet: any, client: any) => { if (client && packet.topic === topic) seen++; };
    mod.aedes!.on("publish", onPub);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const payload = JSON.stringify({ type: "NOOP" });
      for (let i = 0; i < 10_000; i++) c.publish(topic, payload, { qos: 0 });
      await waitFor(() => seen >= 10_000, 30_000, "10k publishes processed");
      const aclLines = countMqttLines(warnSpy, "[MQTT ACL]");
      expect(aclLines).toBeGreaterThanOrEqual(1);
      expect(aclLines).toBeLessThanOrEqual(3);
    } finally {
      mod.aedes?.removeListener("publish", onPub);
      warnSpy.mockRestore();
      c.end(true);
    }
  }, 60_000);
});
