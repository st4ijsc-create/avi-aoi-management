/**
 * doc 81 Đợt 7 task J1 — the built-in broker's REAL MQTTS listener.
 *
 * The broker is started by the product function `initMqttBroker()` on 127.0.0.1 with port 0 for every listener
 * (never :1883/:8883/:8884 of the running :3000, never EMQX :1884) and a temp MQTT_TLS_DIR (never the repo's
 * data/ dir). Clients are the real `mqtt` package. DB = `_test` (forced by vitest.setup).
 * Independent oracles:
 *   · the fingerprint is recomputed from the certificate file's PEM (base64 → DER → sha256);
 *   · admission = the CONNACK seen by mqtt.js; the TLS client trusts the broker ONLY by that fingerprint;
 *   · "the TLS port never speaks plaintext MQTT" = raw MQTT CONNECT bytes (MQTT 3.1.1 §3.1) written to the port.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import { like } from "drizzle-orm";

// The broker logs every connect/listen; keep the run output pristine (restored in afterAll).
const consoleSpies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

const RUN = `J1-${process.pid}-${Date.now().toString(36)}`;
const DEV = `${RUN}-tablet`;
const PW = "Zk3n0QxV9u-ra8T_hb1LwYc2sPq4Ee7m";

type Mod = typeof import("./mqttService");
let mod: Mod;
let db: any;
let schema: typeof import("../../drizzle/schema");
const openClients: MqttClient[] = [];
const dirs: string[] = [];
const ENV_KEYS = [
  "MQTT_ENABLED", "UNS_BRIDGE_ENABLED", "UNS_SPARKPLUG_ENABLED", "EXTERNAL_MQTT_ENABLED", "MQTT_TLS_ENABLED",
  "MQTT_PLAIN_ENABLED", "MQTT_TLS_CERT", "MQTT_TLS_KEY", "MQTT_TLS_DIR", "MQTT_MTLS_ENABLED", "MQTT_AUTO_REGISTER_UNKNOWN",
  "MQTT_REQUIRE_PASSWORD", "MQTT_ALLOW_PASSWORDLESS_REGISTERED", "MQTT_ADMISSION_ENFORCE",
];
const savedEnv: Record<string, string | undefined> = {};
let SAFETY_DIR = "";

/** J fix 3: the site folder must NOT exist yet (first start builds it private-from-birth); an existing,
 * unprotected temp folder would be refused (TLS_KEY_ACL_UNPROTECTED). */
function siteDir(): string {
  return path.join(tempDir(), "mqtt-tls");
}
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dot7-j1l-"));
  dirs.push(d);
  return d;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
async function waitFor(cond: () => boolean, ms: number, label: string): Promise<void> {
  await withTimeout((async () => { while (!cond()) await new Promise((r) => setTimeout(r, 20)); })(), ms, label);
}

function fingerprintFromPem(text: string): string {
  const b64 = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)![1].replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").toUpperCase().match(/../g)!.join(":");
}
function certPemOf(text: string): string {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)![0];
}

type Result = { ok: boolean; code?: number; err?: string };

function connectMqtts(port: number, caPem: string, pin: string, username: string, password?: string): Promise<Result> {
  return withTimeout(new Promise<Result>((resolve) => {
    const c = mqtt.connect(`mqtts://127.0.0.1:${port}`, {
      username, password, reconnectPeriod: 0, connectTimeout: 5000,
      clientId: `${RUN}-${Math.random().toString(16).slice(2, 10)}`,
      ca: caPem,
      // trust by FINGERPRINT only (the site certificate is self-signed; its name is not the IP)
      checkServerIdentity: (_h: string, cert: { fingerprint256: string }) =>
        (cert.fingerprint256 === pin ? undefined : new Error("PIN_MISMATCH")),
    } as any);
    let done = false;
    c.on("connect", () => { if (done) return; done = true; openClients.push(c); resolve({ ok: true }); });
    c.on("error", (e: any) => {
      if (done) return; done = true; c.end(true);
      resolve({ ok: false, code: typeof e?.code === "number" ? e.code : undefined, err: String(e?.message ?? e) });
    });
    c.on("close", () => { if (done) return; done = true; resolve({ ok: false, err: "closed" }); });
  }), 8000, "mqtts connect");
}

function connectPlain(port: number, username: string, password?: string): Promise<Result> {
  return withTimeout(new Promise<Result>((resolve) => {
    const c = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username, password, reconnectPeriod: 0, connectTimeout: 5000, clientId: `${RUN}-p-${Math.random().toString(16).slice(2, 8)}`,
    });
    let done = false;
    c.on("connect", () => { if (done) return; done = true; openClients.push(c); resolve({ ok: true }); });
    c.on("error", (e: any) => { if (done) return; done = true; c.end(true); resolve({ ok: false, code: e?.code }); });
    c.on("close", () => { if (done) return; done = true; resolve({ ok: false, err: "closed" }); });
  }), 8000, "plain connect");
}

/** MQTT 3.1.1 CONNECT (clientId "j1", no flags) as raw bytes: what a plaintext client sends first. */
const RAW_CONNECT = Buffer.from([0x10, 0x0e, 0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c, 0x00, 0x02, 0x6a, 0x31]);

/** Write a plaintext CONNECT to `port`; resolve with whether a CONNACK (0x20 0x02) ever came back. */
function rawConnectGetsConnack(port: number): Promise<boolean> {
  return withTimeout(new Promise<boolean>((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(RAW_CONNECT));
    let got = Buffer.alloc(0);
    s.on("data", (d) => { got = Buffer.concat([got, d]); });
    const finish = () => resolve(got.length >= 2 && got[0] === 0x20 && got[1] === 0x02);
    s.on("close", finish);
    s.on("error", () => { /* close follows */ });
    setTimeout(() => s.destroy(), 1500);
  }), 5000, "raw connect");
}

async function startBroker(listen: Parameters<Mod["initMqttBroker"]>[0]) {
  mod.initMqttBroker(listen);
  await waitFor(() => mod.mqttHandlersReady(), 15000, "handlers");
}
async function stopBroker() {
  for (const c of openClients.splice(0)) c.end(true);
  await withTimeout(mod.shutdownMqttBroker(), 10_000, "shutdown");
}
const deviceUser = `${DEV}:FactoryAlertApp:SM-T505`;

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MQTT_ENABLED = "true";
  process.env.UNS_BRIDGE_ENABLED = "false";
  process.env.UNS_SPARKPLUG_ENABLED = "false";
  process.env.EXTERNAL_MQTT_ENABLED = "false";
  // Safety net: even a regression that starts TLS without `listen.tls.dir` writes into a temp dir, never the repo's
  // data/mqtt-tls (a test certificate there would become the site certificate at the next server start).
  SAFETY_DIR = tempDir();
  process.env.MQTT_TLS_DIR = SAFETY_DIR;

  schema = await import("../../drizzle/schema");
  const { getDb } = await import("../db");
  db = await getDb();
  expect(db).toBeTruthy();
  await db.insert(schema.mqttClients).values({
    clientId: `${DEV}-seed`, deviceId: DEV, deviceName: "J1", deviceModel: "J1", mappingType: "MANUAL",
    connectionStatus: "OFFLINE", isActive: true, approvalStatus: "APPROVED", passwordHash: await bcrypt.hash(PW, 10),
  });
  mod = await import("./mqttService");
}, 60_000);

afterAll(async () => {
  for (const c of openClients) c.end(true);
  if (mod) await withTimeout(mod.shutdownMqttBroker(), 10_000, "shutdown").catch(() => {});
  if (db) await db.delete(schema.mqttClients).where(like(schema.mqttClients.deviceId, `${RUN}%`));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  consoleSpies.forEach((s) => s.mockRestore());
});

describe("J1 — MQTTS listener of the built-in broker", () => {
  it("default: plaintext AND TLS listen; the site certificate is generated in MQTT_TLS_DIR; its fingerprint is reported", async () => {
    const dir = siteDir();
    await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0, tls: { port: 0, dir } });
    await waitFor(() => !!mod.getMqttListenPorts().tls && !!mod.getMqttListenPorts().tcp, 30_000, "listeners");
    const ports = mod.getMqttListenPorts();
    for (const p of [ports.tcp, ports.ws, ports.tls]) expect([1883, 1884, 8883, 8884]).not.toContain(p);

    const text = fs.readFileSync(path.join(dir, "broker-tls.pem"), "utf8");
    const fp = fingerprintFromPem(text);
    const st = mod.getMqttBrokerTlsStatus();
    expect(st).toMatchObject({ enabled: true, listening: true, port: ports.tls, fingerprintSha256: fp, source: "generated", error: null, plainEnabled: true });
    expect(JSON.stringify(st)).not.toContain("PRIVATE KEY");

    // the tablet's path: MQTTS, broker trusted by fingerprint only, device password ⇒ admitted
    expect(await connectMqtts(ports.tls!, certPemOf(text), fp, deviceUser, PW)).toEqual({ ok: true });
    // wrong password over TLS ⇒ CONNACK 4 (the TLS listener has the same admission as plaintext)
    expect((await connectMqtts(ports.tls!, certPemOf(text), fp, deviceUser, "wrong-password")).code).toBe(4);
    // a client pinning ANOTHER fingerprint never completes the handshake (so it never sends CONNECT)
    const other = await connectMqtts(ports.tls!, certPemOf(text), "00:".repeat(31) + "00", deviceUser, PW);
    expect(other.ok).toBe(false);
    expect(other.err).toContain("PIN_MISMATCH");
    // the TLS port never speaks plaintext MQTT; the plaintext port still does (kept until migration is done)
    expect(await rawConnectGetsConnack(ports.tls!)).toBe(false);
    expect(await rawConnectGetsConnack(ports.tcp!)).toBe(true);
    expect(await connectPlain(ports.tcp!, deviceUser, PW)).toEqual({ ok: true });

    // restart: the SAME certificate (fingerprint stable — pinned tablets keep working)
    await stopBroker();
    expect(mod.getMqttListenPorts().tls).toBeNull();
    await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0, tls: { port: 0, dir } });
    await waitFor(() => !!mod.getMqttListenPorts().tls, 30_000, "tls again");
    expect(mod.getMqttBrokerTlsStatus().fingerprintSha256).toBe(fp);
    expect(fs.readFileSync(path.join(dir, "broker-tls.pem"), "utf8")).toBe(text);
    await stopBroker();
  }, 60_000);

  it("MQTT_PLAIN_ENABLED=false ⇒ MQTTS only (no plaintext TCP/WS listener), and shutdown still closes the broker", async () => {
    process.env.MQTT_PLAIN_ENABLED = "false";
    try {
      const dir = siteDir();
      await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0, tls: { port: 0, dir } });
      await waitFor(() => !!mod.getMqttListenPorts().tls, 30_000, "tls");
      const ports = mod.getMqttListenPorts();
      expect(ports.tcp).toBeNull();
      expect(ports.ws).toBeNull();
      expect(mod.getMqttBrokerTlsStatus().plainEnabled).toBe(false);
      const text = fs.readFileSync(path.join(dir, "broker-tls.pem"), "utf8");
      expect(await connectMqtts(ports.tls!, certPemOf(text), fingerprintFromPem(text), deviceUser, PW)).toEqual({ ok: true });
      await stopBroker();
      expect(mod.mqttHandlersReady()).toBe(false);
    } finally {
      delete process.env.MQTT_PLAIN_ENABLED;
    }
  }, 60_000);

  it("fail-closed: a corrupt certificate file ⇒ NO TLS listener, error shown, file untouched, plaintext broker unaffected", async () => {
    const dir = siteDir();
    // a first start creates the private folder + key; then the file content gets damaged (its ACL stays private)
    await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0, tls: { port: 0, dir } });
    await waitFor(() => !!mod.getMqttListenPorts().tls, 30_000, "tls first");
    await stopBroker();
    fs.writeFileSync(path.join(dir, "broker-tls.pem"), "not a pem");
    await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0, tls: { port: 0, dir } });
    await waitFor(() => !!mod.getMqttListenPorts().tcp && mod.getMqttBrokerTlsStatus().error !== null, 30_000, "status");
    expect(mod.getMqttListenPorts().tls).toBeNull();
    expect(mod.getMqttBrokerTlsStatus()).toMatchObject({ enabled: true, listening: false, fingerprintSha256: null, error: "TLS_FILE_CORRUPT" });
    expect(fs.readFileSync(path.join(dir, "broker-tls.pem"), "utf8")).toBe("not a pem");
    expect(await connectPlain(mod.getMqttListenPorts().tcp!, deviceUser, PW)).toEqual({ ok: true });
    await stopBroker();
  }, 60_000);

  it("the TLS port taken ⇒ only TLS is down (error EADDRINUSE shown); the broker keeps serving plaintext", async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const taken = (blocker.address() as { port: number }).port;
    try {
      await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0, tls: { port: taken, dir: siteDir() } });
      await waitFor(() => !!mod.getMqttListenPorts().tcp && mod.getMqttBrokerTlsStatus().error !== null, 30_000, "status");
      expect(mod.getMqttBrokerTlsStatus()).toMatchObject({ listening: false, error: "EADDRINUSE" });
      expect(mod.getMqttBrokerTlsStatus().fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      await new Promise((r) => setTimeout(r, 300)); // a broker shutdown (old EADDRINUSE path) would land here
      expect(mod.mqttHandlersReady()).toBe(true);
      expect(await connectPlain(mod.getMqttListenPorts().tcp!, deviceUser, PW)).toEqual({ ok: true });
      await stopBroker();
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  }, 60_000);

  it("listen overrides WITHOUT `tls` (every older broker test) ⇒ no TLS listener, nothing written", async () => {
    const before = fs.existsSync(path.resolve(process.cwd(), "data", "mqtt-tls", "broker-tls.pem"));
    await startBroker({ host: "127.0.0.1", port: 0, wsPort: 0 });
    await waitFor(() => !!mod.getMqttListenPorts().tcp, 10_000, "tcp");
    await new Promise((r) => setTimeout(r, 200));
    expect(mod.getMqttListenPorts().tls).toBeNull();
    expect(mod.getMqttBrokerTlsStatus()).toMatchObject({ enabled: false, listening: false });
    expect(fs.existsSync(path.resolve(process.cwd(), "data", "mqtt-tls", "broker-tls.pem"))).toBe(before);
    expect(fs.existsSync(path.join(SAFETY_DIR, "broker-tls.pem"))).toBe(false);
    await stopBroker();
  }, 60_000);
});
