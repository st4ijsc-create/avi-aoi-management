/**
 * doc 81 Đợt 9 task U1 — END TO END against a REAL OPC-UA server (node-opcua) in this process on 127.0.0.1, OS-assigned
 * port, closed in afterAll. Production path: defaultBackendFor ⇒ OpcuaSubscriptionSafetyPlcBackend ⇒ the registry's
 * OpcuaDriver.subscribeQueued (queueSize > 1, discardOldest false). Only the record doors, the durable store and the leader
 * gate are seams. Oracles independent of product code: the SERVER's own variable store (what the PLC says), a server-side
 * WRITE counter (L-7) and the OPC-UA overflow bit as the server itself sets it.
 *   • ★ a press + release between two polls ⇒ BOTH events (a polling backend on the same sequence sees nothing — control);
 *   • ★ the server's queue overflows (small queue, many changes in one publish) ⇒ lost counted ⇒ one events-lost marker;
 *   • ★ the server goes away ⇒ the subscription is lost ⇒ "plc_offline", never "released"; the PLC is never written.
 * PKI of node-opcua (APPDATA / XDG / OPCUA_PKI_DIR) is redirected under os.tmpdir() and removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "opcua-u1-"));
const SAVED_ENV: Record<string, string | undefined> = {};
for (const k of ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "OPCUA_PKI_DIR", "OPCUA_ALLOW_TRUST_ON_FIRST_USE", "OT_OPCUA_MONITORED_ITEMS", "SAFETY_PLC_POLL_READ_TIMEOUT_MS", "OAUTH_SERVER_URL"]) SAVED_ENV[k] = process.env[k];
delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
delete process.env.OT_OPCUA_MONITORED_ITEMS;
process.env.APPDATA = path.join(TMP, "appdata");
process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
process.env.XDG_CONFIG_HOME = path.join(TMP, "xdg");
process.env.OPCUA_PKI_DIR = path.join(TMP, "client-pki");
process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "10000";
process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";

import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import type { RecordSafetyEventInput } from "../safetyAuditService";
import type { PollStateRow, PollStateStore } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: test deadline ${ms}ms exceeded`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

interface Plc {
  vals: { ESTOP: boolean; GUARD_OK: boolean };
  writes: number;
  url: string;
  ns: number;
  server: any;
  cm: any;
}
async function startServer(tag: string): Promise<Plc> {
  const o = req("node-opcua");
  const port = await freePort();
  const plc = { vals: { ESTOP: false, GUARD_OK: true }, writes: 0 } as Plc;
  plc.cm = new o.OPCUACertificateManager({ rootFolder: path.join(TMP, `server-pki-${tag}`), automaticallyAcceptUnknownCertificate: true });
  await plc.cm.initialize();
  plc.server = new o.OPCUAServer({
    port,
    hostname: "127.0.0.1",
    securityModes: [o.MessageSecurityMode.None],
    securityPolicies: [o.SecurityPolicy.None],
    serverCertificateManager: plc.cm,
    allowAnonymous: true,
    nodeset_filename: [o.nodesets.standard],
  });
  await plc.server.initialize();
  const space = plc.server.engine.addressSpace;
  const own = space.getOwnNamespace();
  for (const name of ["ESTOP", "GUARD_OK"] as const) {
    own.addVariable({
      organizedBy: space.rootFolder.objects,
      browseName: name,
      nodeId: `s=${name}`,
      dataType: "Boolean",
      minimumSamplingInterval: 50, // the PLC samples fast enough for a human press (a slower one ⇒ visible poll fallback)
      accessLevel: "CurrentRead | CurrentWrite",
      userAccessLevel: "CurrentRead | CurrentWrite",
      value: {
        get: () => new o.Variant({ dataType: o.DataType.Boolean, value: plc.vals[name] }),
        set: () => {
          plc.writes += 1; // L-7 oracle: ANY write attempt is counted here
          return o.StatusCodes.BadNotWritable;
        },
      },
    });
  }
  // a node whose server-side sampling is SLOW (getter without minimumSamplingInterval ⇒ node-opcua revises to 1000 ms)
  own.addVariable({
    organizedBy: space.rootFolder.objects,
    browseName: "ESTOP_SLOW",
    nodeId: "s=ESTOP_SLOW",
    dataType: "Boolean",
    value: { get: () => new o.Variant({ dataType: o.DataType.Boolean, value: plc.vals.ESTOP }) },
  });
  await plc.server.start();
  plc.url = `opc.tcp://127.0.0.1:${port}`;
  plc.ns = own.index;
  return plc;
}
async function stopServer(plc: Plc | undefined) {
  if (!plc) return;
  await withTimeout(plc.server?.shutdown(0) ?? Promise.resolve(), 15_000, "server shutdown").catch(() => undefined);
  await plc.cm?.dispose?.().catch?.(() => undefined);
}

let A: Plc;
beforeAll(async () => {
  A = await startServer("a");
}, 90_000);
afterAll(async () => {
  await stopServer(A);
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

function cfg(plc: Plc, id = 94): SafetyPlcConfig {
  return {
    id, code: `U1-UA-${id}`, name: "u1", vendor: "sick", backend: "opcua", endpoint: plc.url,
    statusMap: { estop: { address: `ns=${plc.ns};s=ESTOP` }, zoneOccupied: { address: `ns=${plc.ns};s=GUARD_OK`, activeWhen: "falsy" }, pollIntervalMs: 1000 },
    robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2,
    createdAt: new Date(), updatedAt: new Date(),
  } as SafetyPlcConfig;
}
function memStore(): PollStateStore & { rows: Map<number, PollStateRow> } {
  const rows = new Map<number, PollStateRow>();
  return { rows, load: async (id) => rows.get(id) ?? null, save: async (r) => void rows.set(r.configId, JSON.parse(JSON.stringify(r))), list: async () => [...rows.values()], claimStaleAlarm: async () => false };
}
async function mkPoller(c: SafetyPlcConfig, backendFor?: (cfg: SafetyPlcConfig, t: number) => { backend: any }) {
  const { SafetyPlcPoller } = await import("./safetyPlcPoller");
  const recs: Array<{ door: string; input: RecordSafetyEventInput }> = [];
  const store = memStore();
  const p = new SafetyPlcPoller({
    loadConfigs: async () => [c],
    ...(backendFor ? { backendFor } : {}), // default: the PRODUCTION defaultBackendFor
    recordPlain: async (i) => (recs.push({ door: "plain", input: i }), { ok: true, enabled: true }),
    recordTrusted: async (i) => (recs.push({ door: "trusted", input: i }), { ok: true, enabled: true }),
    isTrustApproved: async () => true,
    leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
    state: store,
  });
  return { p, recs, store };
}
const types = (recs: Array<{ input: RecordSafetyEventInput }>) => recs.map((r) => r.input.eventType);
/** Oracle on the SERVER side: the monitored items the server actually holds (its own parameters). */
function serverItems(plc: Plc): Array<{ discardOldest: boolean; queueSize: number; samplingInterval: number }> {
  const out: Array<{ discardOldest: boolean; queueSize: number; samplingInterval: number }> = [];
  for (const session of Object.values(plc.server.engine._sessions ?? {}) as any[]) {
    for (const sub of session.publishEngine?.subscriptions ?? []) {
      for (const mi of Object.values(sub.monitoredItems ?? {}) as any[]) out.push({ discardOldest: mi.discardOldest, queueSize: mi.queueSize, samplingInterval: mi.samplingInterval });
    }
  }
  return out;
}

describe("Đợt 9 U1 — background poller ⇄ in-process OPC-UA server through a QUEUED subscription", () => {
  it("★ press + release between two polls ⇒ BOTH events (trusted door); readMode 'subscription'; no write", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const c = cfg(A);
    const { p, recs, store } = await mkPoller(c);
    try {
      A.vals.ESTOP = false;
      A.vals.GUARD_OK = true;
      await withTimeout(p.refreshConfigs(), 60_000, "refresh");
      await withTimeout(p.pollNow(c.id), 30_000, "poll 1"); // subscribes; initial values ⇒ online silently
      expect(recs).toEqual([]);
      expect(p.snapshot()[0].readMode).toBe("subscription");
      // the server holds 2 queued items: discardOldest false, queue > 1, fast sampling
      const items = serverItems(A);
      expect(items).toHaveLength(2);
      for (const it of items) {
        expect(it.discardOldest).toBe(false);
        expect(it.queueSize).toBeGreaterThan(1);
        expect(it.samplingInterval).toBeLessThanOrEqual(250);
      }
      // a short press: pressed and released again BEFORE the next poll (well inside one publishing interval)
      A.vals.ESTOP = true;
      await sleep(250);
      A.vals.ESTOP = false;
      const t0 = Date.now();
      while (types(recs).length < 2 && Date.now() - t0 < 10_000) {
        await sleep(400);
        await withTimeout(p.pollNow(c.id), 30_000, "poll");
      }
      expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["trusted", "estop"], ["trusted", "estop_released"]]);
      expect(String(recs[0].input.notes)).not.toContain("127.0.0.1");
      expect(store.rows.get(c.id)).toMatchObject({ link: "online", readMode: "subscription", flags: { estop: false } });
      expect(A.writes).toBe(0);
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it("control: a POLLING backend on the same short press sees nothing (what the subscription adds)", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const { OtReadSafetyPlcBackend } = await import("./safetyPlcAdapter");
    const c = cfg(A, 95);
    const { p, recs } = await mkPoller(c, (cc, t) => ({ backend: new OtReadSafetyPlcBackend("opcua", cc.endpoint!, cc.statusMap as never, t) }));
    try {
      A.vals.ESTOP = false;
      await withTimeout(p.refreshConfigs(), 60_000, "refresh");
      await withTimeout(p.pollNow(c.id), 30_000, "poll 1");
      expect(p.snapshot()[0].readMode).toBe("poll");
      A.vals.ESTOP = true;
      await sleep(250);
      A.vals.ESTOP = false;
      await withTimeout(p.pollNow(c.id), 30_000, "poll 2");
      expect(recs).toEqual([]); // missed by design of polling
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it("★ the SERVER's queue overflows (queue 2, many changes in one publish) ⇒ lost counted ⇒ an events-lost marker (once per batch, before that batch's events), final state right", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const { OpcuaSubscriptionSafetyPlcBackend } = await import("./safetyPlcOpcuaSubscription");
    const c = cfg(A, 96);
    // test seam: a tiny queue (the poller itself always requests opcuaQueueSizeFor(interval) ≥ 10)
    const { p, recs } = await mkPoller(c, (cc, t) => ({ backend: new OpcuaSubscriptionSafetyPlcBackend(cc.endpoint!, cc.statusMap as never, t, { intervalMs: 1000, queueSize: 2 }) }));
    try {
      A.vals.ESTOP = false;
      await withTimeout(p.refreshConfigs(), 60_000, "refresh");
      await withTimeout(p.pollNow(c.id), 30_000, "poll 1");
      expect(recs).toEqual([]);
      for (let i = 0; i < 9; i++) {
        A.vals.ESTOP = !A.vals.ESTOP; // 9 changes ⇒ ends PRESSED
        await sleep(90);
      }
      const t0 = Date.now();
      while (!types(recs).includes("plc_events_lost") && Date.now() - t0 < 10_000) {
        await sleep(400);
        await withTimeout(p.pollNow(c.id), 30_000, "poll");
      }
      await sleep(1200);
      await withTimeout(p.pollNow(c.id), 30_000, "poll last");
      const t = types(recs);
      const markers = recs.filter((r) => r.input.eventType === "plc_events_lost");
      expect(markers.length).toBeGreaterThanOrEqual(1); // the toggles may straddle a publish ⇒ one marker per affected batch
      expect(markers.length).toBeLessThanOrEqual(2);
      for (const m of markers) expect(String(m.input.notes)).toMatch(/OPC-UA subscription reported lost value changes/);
      // with discardOldest=false the server kept the OLDEST changes and overwrote the last slot: fewer events than changes
      expect(t.filter((x) => x === "estop" || x === "estop_released").length).toBeLessThan(9);
      expect(p.snapshot()[0].lastRead).toMatchObject({ kind: "decided", flags: { estop: true } }); // the final state is right
      expect(A.writes).toBe(0);
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it("★ the server samples too slowly for a short press (revised 1000 ms) ⇒ VISIBLE poll fallback; a held press is still seen", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const base = cfg(A, 98);
    const c = { ...base, statusMap: { ...(base.statusMap as object), estop: { address: `ns=${A.ns};s=ESTOP_SLOW` } } } as SafetyPlcConfig;
    const { p, recs, store } = await mkPoller(c);
    try {
      A.vals.ESTOP = false;
      await withTimeout(p.refreshConfigs(), 60_000, "refresh");
      await withTimeout(p.pollNow(c.id), 30_000, "poll 1");
      expect(p.snapshot()[0].readMode).toBe("poll_fallback");
      expect(store.rows.get(c.id)?.readMode).toBe("poll_fallback");
      A.vals.ESTOP = true;
      await withTimeout(p.pollNow(c.id), 30_000, "poll 2");
      expect(types(recs)).toEqual(["estop"]);
      A.vals.ESTOP = false;
      expect(A.writes).toBe(0);
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it("★ the server goes away ⇒ subscription lost ⇒ 'plc_offline', never 'estop_released'", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
    const B = await startServer("b");
    const c = cfg(B, 97);
    const { p, recs } = await mkPoller(c);
    try {
      B.vals.ESTOP = true; // held e-stop
      await withTimeout(p.refreshConfigs(), 60_000, "refresh");
      await withTimeout(p.pollNow(c.id), 30_000, "poll 1");
      expect(types(recs)).toEqual(["estop"]);
      await stopServer(B);
      const t0 = Date.now();
      while (!types(recs).includes("plc_offline") && Date.now() - t0 < 20_000) {
        await sleep(500);
        await withTimeout(p.pollNow(c.id), 30_000, "poll");
      }
      expect(types(recs)).toEqual(["estop", "plc_offline"]);
      expect(B.writes).toBe(0);
    } finally {
      await p.stop();
      await stopServer(B);
      quiet.forEach((q) => q.mockRestore());
    }
  });
});
