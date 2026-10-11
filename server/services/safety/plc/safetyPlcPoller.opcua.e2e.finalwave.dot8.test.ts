/**
 * doc 81 Đợt 8 final wave M8 — the background safety-PLC poller END TO END against a REAL OPC-UA server (node-opcua) running
 * in this process on 127.0.0.1, port assigned by the OS (port 0 probe), closed in afterAll. Production read path: the
 * poller's defaultBackendFor ⇒ OtReadSafetyPlcBackend("opcua") ⇒ the OT registry's OpcuaDriver (connect → readTags →
 * disconnect). Only the record doors, the durable store and the leader gate are faked (no DB, no other instance).
 * Oracles independent of product code: the SERVER's own variable store (what the PLC says) and a server-side WRITE
 * counter (L-7: the poller must never write — any write attempt is counted by the server's setter).
 * PKI of node-opcua (APPDATA / XDG / OPCUA_PKI_DIR) is redirected under os.tmpdir() and removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "opcua-m8-"));
const SAVED_ENV: Record<string, string | undefined> = {};
for (const k of ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "OPCUA_PKI_DIR", "OPCUA_ALLOW_TRUST_ON_FIRST_USE", "OT_OPCUA_MONITORED_ITEMS", "SAFETY_PLC_POLL_READ_TIMEOUT_MS", "OAUTH_SERVER_URL"]) SAVED_ENV[k] = process.env[k];
delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;
delete process.env.OT_OPCUA_MONITORED_ITEMS;
process.env.APPDATA = path.join(TMP, "appdata");
process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
process.env.XDG_CONFIG_HOME = path.join(TMP, "xdg");
process.env.OPCUA_PKI_DIR = path.join(TMP, "client-pki");
process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "8000";
process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";

import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import type { RecordSafetyEventInput } from "../safetyAuditService";
import type { PollStateRow, PollStateStore } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

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

const PLC = { ESTOP: false, GUARD_OK: true, writes: 0 }; // GUARD_OK true = light curtain clear (mapped activeWhen "falsy")
let server: any;
let cm: any;
let url = "";
let ns = 0;

beforeAll(async () => {
  const o = req("node-opcua");
  const port = await freePort();
  cm = new o.OPCUACertificateManager({ rootFolder: path.join(TMP, "server-pki"), automaticallyAcceptUnknownCertificate: true });
  await cm.initialize();
  server = new o.OPCUAServer({
    port,
    hostname: "127.0.0.1",
    securityModes: [o.MessageSecurityMode.None],
    securityPolicies: [o.SecurityPolicy.None],
    serverCertificateManager: cm,
    allowAnonymous: true,
    nodeset_filename: [o.nodesets.standard],
  });
  await server.initialize();
  const space = server.engine.addressSpace;
  const own = space.getOwnNamespace();
  for (const name of ["ESTOP", "GUARD_OK"] as const) {
    own.addVariable({
      organizedBy: space.rootFolder.objects,
      browseName: name,
      nodeId: `s=${name}`,
      dataType: "Boolean",
      accessLevel: "CurrentRead | CurrentWrite",
      userAccessLevel: "CurrentRead | CurrentWrite",
      value: {
        get: () => new o.Variant({ dataType: o.DataType.Boolean, value: PLC[name] }),
        set: () => {
          PLC.writes += 1; // L-7 oracle: ANY write attempt is counted here
          return o.StatusCodes.BadNotWritable;
        },
      },
    });
  }
  await server.start();
  url = `opc.tcp://127.0.0.1:${port}`;
  ns = own.index;
}, 90_000);

afterAll(async () => {
  await withTimeout(server?.shutdown(0) ?? Promise.resolve(), 15_000, "server shutdown").catch(() => undefined);
  await cm?.dispose?.().catch?.(() => undefined);
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

function cfg(): SafetyPlcConfig {
  return {
    id: 81, code: "M8-OPCUA", name: "m8", vendor: "sick", backend: "opcua", endpoint: url,
    statusMap: { estop: { address: `ns=${ns};s=ESTOP` }, zoneOccupied: { address: `ns=${ns};s=GUARD_OK`, activeWhen: "falsy" }, pollIntervalMs: 1000 },
    robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2,
    createdAt: new Date(), updatedAt: new Date(),
  } as SafetyPlcConfig;
}
function memStore(): PollStateStore & { rows: Map<number, PollStateRow> } {
  const rows = new Map<number, PollStateRow>();
  return {
    rows,
    async load(id) {
      return rows.get(id) ?? null;
    },
    async save(r) {
      rows.set(r.configId, JSON.parse(JSON.stringify(r)));
    },
    async list() {
      return [...rows.values()];
    },
    async claimStaleAlarm() {
      return false;
    },
  };
}

describe("final wave M8 — background poller ⇄ in-process OPC-UA server (production read path)", () => {
  it("★ e-stop press / release and a guard trip are observed and recorded through the TRUSTED door (approved); the PLC is never written", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const { SafetyPlcPoller } = await import("./safetyPlcPoller");
    const recs: Array<{ door: string; input: RecordSafetyEventInput }> = [];
    const store = memStore();
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [cfg()],
      // backendFor: NOT faked — the production defaultBackendFor (OtReadSafetyPlcBackend + the registry's OPC-UA driver)
      recordPlain: async (i) => (recs.push({ door: "plain", input: i }), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push({ door: "trusted", input: i }), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: store,
    });
    try {
      await withTimeout(p.refreshConfigs(), 60_000, "refresh (driver registration)");
      const poll = () => withTimeout(p.pollNow(81), 30_000, "poll");
      await poll(); // clear ⇒ online silently
      expect(recs).toEqual([]);
      expect(p.snapshot()[0].lastRead).toMatchObject({ kind: "decided", flags: { estop: false, zoneOccupied: false }, unreadable: [] });
      PLC.ESTOP = true;
      await poll();
      PLC.GUARD_OK = false; // light curtain interrupted
      await poll();
      PLC.ESTOP = false;
      PLC.GUARD_OK = true;
      await poll();
      expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([
        ["trusted", "estop"],
        ["trusted", "zone_intrusion"],
        ["trusted", "estop_released"],
      ]);
      expect(recs[0].input).toMatchObject({ robotId: 4, factoryId: 2, detectedBy: "plc", handledBy: "advisory" });
      expect(String(recs[0].input.notes)).not.toContain("127.0.0.1"); // endpoint never in a feed row
      expect(store.rows.get(81)).toMatchObject({ link: "online", flags: { estop: false, zoneOccupied: false } });
      expect(PLC.writes).toBe(0); // L-7: read-only
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it("★ unapproved config ⇒ the same trip goes through the PLAIN door; a node that does not exist ⇒ unreadable ⇒ 'plc_offline', never 'released'", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const { SafetyPlcPoller } = await import("./safetyPlcPoller");
    const recs: Array<{ door: string; input: RecordSafetyEventInput }> = [];
    const c = cfg();
    let missing = false;
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [missing ? { ...c, statusMap: { ...(c.statusMap as object), estop: { address: `ns=${ns};s=NO_SUCH_NODE` } } as never } : c],
      recordPlain: async (i) => (recs.push({ door: "plain", input: i }), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push({ door: "trusted", input: i }), { ok: true, enabled: true }),
      isTrustApproved: async () => false,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: memStore(),
    });
    try {
      PLC.ESTOP = false;
      PLC.GUARD_OK = true;
      await withTimeout(p.refreshConfigs(), 60_000, "refresh");
      const poll = () => withTimeout(p.pollNow(81), 30_000, "poll");
      await poll();
      PLC.ESTOP = true;
      await poll();
      expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["plain", "estop"]]);
      expect(String(recs[0].input.notes)).toMatch(/not approved by a second person/);
      missing = true; // the tag map now points at a node the server does not have (identity change ⇒ re-baseline)
      await withTimeout(p.refreshConfigs(), 60_000, "refresh 2");
      await poll();
      const types = recs.map((r) => r.input.eventType);
      expect(types).toContain("plc_offline");
      expect(types).not.toContain("estop_released");
      expect(PLC.writes).toBe(0);
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });
});
