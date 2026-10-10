/**
 * doc 81 Đợt 5 task F2 (item 28) — DRIVER CONTRACT over EVERY built-in OT driver:
 *
 *   a `disconnect()` whose transport close completes LATE — after a subsequent `connect()` on the SAME driver object
 *   opened a fresh session — must leave `isConnected()` true, the NEW handle in place and never closed.
 *
 * Why: ConnectionSupervisor.resetSession (and otManager's legacy path) bound the disconnect step and then reconnect the
 * SAME `ep.driver`; a STOP right after a session reset rides that fresh session. A driver that writes its fields AFTER
 * awaiting the old transport's close (`await old.drop(); this.conn = null; connected = false`) clears the NEW session.
 * Before this task s7Driver and ethernetIpDriver did exactly that.
 *
 * Harness: each driver's transport library is a hand-written fake injected through `loadPackage` (no module mocks, no
 * network) whose close/drop of a given handle resolves only when the test releases it. SLMP uses a real in-process TCP
 * server on 127.0.0.1 port 0. Every wait is bounded by an explicit timer (not the vitest timeout).
 * Census: the protocol list is read from ot/index.ts `registerDriver("…")` calls, so a new built-in driver without a
 * harness here fails this file.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { OtDriver, OtConnectionConfig } from "../otDriver";
import { createS7Driver } from "./s7Driver";
import { createEthernetIpDriver } from "./ethernetIpDriver";
import { createModbusDriver } from "./modbusDriver";
import { createMitsubishiMcDriver } from "./mitsubishiMcDriver";
import { createOpcuaDriver } from "./opcuaDriver";
import { createSlmpDriver } from "./slmpDriver";
import { createStubDriver } from "./stubDriver";

// ── Đợt 5 F fix 1 (R-5-e) — the plugin sidecar driver's process spawner is faked: no child process; each spawn yields one
//    fake transport (JSON-lines RPC) whose `disconnect` RPC answers only when the test releases it.
const PS = vi.hoisted(() => ({
  spawn: null as null | ((onSpawn: (t: unknown, h: unknown) => void) => unknown),
  /** every onSpawn callback handed to a spawner (index = spawner/supervisor order) */
  onSpawns: [] as Array<(t: unknown, h: unknown) => void>,
}));
vi.mock("../../plugins/sidecar/nodeSpawner", () => ({
  createSupervisedTransportSpawner: (onSpawn: (t: unknown, h: unknown) => void) => {
    PS.onSpawns.push(onSpawn);
    return () => PS.spawn!(onSpawn);
  },
}));
import { createPluginDriver } from "../../plugins/pluginDriverBridge";

/** Bounded wait: rejects (fails the test) if `p` has not settled within `ms`. */
function within<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: not settled within ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
const tick = () => new Promise<void>((r) => setImmediate(r));

/** A fake transport handle: records listeners, counts close calls, close completes only on release(). */
type FakeHandle = {
  id: number;
  closeCalls: number;
  /** Once released, later close steps of the same handle complete at once. */
  released: boolean;
  pendingClose: Array<() => void>;
  listeners: Map<string, Array<(...a: unknown[]) => void>>;
  on(ev: string, fn: (...a: unknown[]) => void): FakeHandle;
};
let seq = 0;
function fakeHandle<T extends object>(extra: T): FakeHandle & T {
  const h: FakeHandle = {
    id: ++seq,
    closeCalls: 0,
    released: false,
    pendingClose: [],
    listeners: new Map(),
    on(ev, fn) {
      const arr = this.listeners.get(ev) ?? [];
      arr.push(fn);
      this.listeners.set(ev, arr);
      return this;
    },
  };
  return Object.assign(h, extra);
}
function release(h: FakeHandle): void {
  h.released = true;
  const fns = h.pendingClose.splice(0);
  for (const f of fns) f();
}
/** Queue one close step of `h`: completes when the test releases `h` (at once if already released). */
function defer(h: FakeHandle, done: () => void): void {
  h.closeCalls++;
  if (h.released) done();
  else h.pendingClose.push(done);
}
/** After the late close: the old transport also reports its link loss — must not touch the new session. */
function emitLinkLoss(h: FakeHandle): void {
  for (const ev of ["close", "error", "Disconnected", "connection_lost", "abort"]) {
    for (const fn of h.listeners.get(ev) ?? []) {
      try {
        fn(new Error(`old ${ev}`));
      } catch {
        /* a listener may throw on a fake — irrelevant */
      }
    }
  }
}

type Harness = {
  make(): { driver: OtDriver; handles: FakeHandle[]; cfg: OtConnectionConfig };
  /** The driver's current transport handle (private field). */
  handleOf(d: OtDriver): unknown;
  /** true ⇔ the harness gives a handle whose close is deferred (stub has no transport). */
  deferred: boolean;
  /**
   * Late completion on a REAL transport: fired on the OLD handle after the fresh connect (SLMP — its disconnect has no
   * await at all; the only thing that can complete late is the old socket's own 'close'/'error' events).
   */
  lateOld?: (old: unknown) => void;
};

function withPackage(d: OtDriver, mod: unknown): OtDriver {
  (d as unknown as { loadPackage: () => Promise<unknown> }).loadPackage = async () => mod;
  return d;
}

// ── s7 (nodes7: callback API; dropConnection(cb)) ────────────────────────────────────────────────────────────────
const s7: Harness = {
  deferred: true,
  make() {
    const handles: FakeHandle[] = [];
    function NodeS7(this: unknown) {
      const h = fakeHandle({
        initiateConnection: (_o: unknown, cb: (e?: unknown) => void) => cb(),
        dropConnection(cb: () => void) {
          defer(h, cb);
        },
      });
      handles.push(h);
      return h;
    }
    const driver = withPackage(createS7Driver(), { default: NodeS7 });
    return { driver, handles, cfg: { endpoint: "tcp://127.0.0.1:102" } };
  },
  handleOf: (d) => (d as unknown as { conn: unknown }).conn,
};

// ── ethernet-ip (st-ethernet-ip: promise API; disconnect()) ──────────────────────────────────────────────────────
const eip: Harness = {
  deferred: true,
  make() {
    const handles: FakeHandle[] = [];
    class Controller {
      constructor() {
        const h = fakeHandle({
          connect: async () => undefined,
          disconnect: () => new Promise<void>((r) => defer(h, r)),
        });
        handles.push(h);
        return h as unknown as Controller;
      }
    }
    const driver = withPackage(createEthernetIpDriver(), { Controller });
    return { driver, handles, cfg: { endpoint: "tcp://127.0.0.1" } };
  },
  handleOf: (d) => (d as unknown as { plc: unknown }).plc,
};

// ── modbus (modbus-serial: close(cb), bounded by closeModbusClient) ──────────────────────────────────────────────
const modbus: Harness = {
  deferred: true,
  make() {
    const handles: FakeHandle[] = [];
    function ModbusRTU(this: unknown) {
      const h = fakeHandle({
        connectTCP: async () => undefined,
        setID: () => undefined,
        setTimeout: () => undefined,
        close(cb: () => void) {
          defer(h, cb);
        },
      });
      handles.push(h);
      return h;
    }
    const driver = withPackage(createModbusDriver(), { default: ModbusRTU });
    return { driver, handles, cfg: { endpoint: "tcp://127.0.0.1:502" } };
  },
  handleOf: (d) => (d as unknown as { client: unknown }).client,
};

// ── mitsubishi-mc (mcprotocol: dropConnection() without callback; socket 'close' ends it) ────────────────────────
const mc: Harness = {
  deferred: true,
  make() {
    const handles: FakeHandle[] = [];
    function MC(this: unknown) {
      const closeWaiters: Array<() => void> = [];
      const sock = {
        destroyed: false,
        connecting: false,
        once(ev: string, fn: () => void) {
          if (ev === "close") closeWaiters.push(fn);
        },
        on() {
          return sock;
        },
        listeners: () => [],
        destroy() {
          sock.destroyed = true;
        },
      };
      const h = fakeHandle({
        isoclient: sock,
        initiateConnection: (_o: unknown, cb: (e?: unknown) => void) => cb(),
        dropConnection() {
          defer(h, () => {
            for (const f of closeWaiters.splice(0)) f();
          });
        },
      });
      handles.push(h);
      return h;
    }
    const driver = withPackage(createMitsubishiMcDriver(), { default: MC });
    return { driver, handles, cfg: { endpoint: "tcp://127.0.0.1:1281" } };
  },
  handleOf: (d) => (d as unknown as { conn: unknown }).conn,
};

// ── opcua (node-opcua: session.close() + client.disconnect(), each bounded 1 s by the driver) ────────────────────
const opcua: Harness = {
  deferred: true,
  make() {
    const handles: FakeHandle[] = [];
    const OPCUAClient = {
      create() {
        const h = fakeHandle({
          connect: async () => undefined,
          createSession: async () => ({
            close: () => new Promise<void>((r) => defer(h, r)),
          }),
          disconnect: () => new Promise<void>((r) => defer(h, r)),
        });
        handles.push(h);
        return h;
      },
    };
    const driver = withPackage(createOpcuaDriver(), { OPCUAClient, AttributeIds: { Value: 13 }, DataType: {}, Variant: class {} });
    return { driver, handles, cfg: { endpoint: "opc.tcp://127.0.0.1:4840", options: { securityMode: "None" } } };
  },
  handleOf: (d) => (d as unknown as { client: unknown }).client,
};

// ── slmp (node:net, real in-process TCP server; disconnect destroys synchronously) ───────────────────────────────
const servers: net.Server[] = [];
const slmpPort = (async () => {
  const srv = net.createServer((s) => s.on("error", () => undefined));
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return (srv.address() as net.AddressInfo).port;
})();
let slmpCfgPort = 0;
const slmp: Harness = {
  deferred: false,
  make() {
    return { driver: createSlmpDriver(), handles: [], cfg: { endpoint: `tcp://127.0.0.1:${slmpCfgPort}`, timeoutMs: 2000 } };
  },
  handleOf: (d) => (d as unknown as { socket: unknown }).socket,
  // SLMP's disconnect() clears socket/connected and destroys the socket SYNCHRONOUSLY (no await), so an "await then
  // clear" clobber cannot exist; what can arrive late is the OLD socket's 'close'/'error' — replayed here after the
  // fresh connect (the driver's `this.socket === socket` guard must ignore them).
  lateOld: (old) => {
    const sock = old as net.Socket;
    sock.emit("close", true);
    sock.emit("error", new Error("old socket late error"));
  },
};

// ── plugin sidecar (pluginDriverBridge: RPC `disconnect` awaited, then supervisor.stop + transport.close) ────────────
const plugin: Harness = {
  deferred: true,
  make() {
    const handles: FakeHandle[] = [];
    PS.spawn = (onSpawn) => {
      const h = fakeHandle({
        request: (method: string) =>
          method === "disconnect" ? new Promise<void>((r) => defer(h, r)) : Promise.resolve({ ok: true }),
        close() {
          h.closeCalls++;
        },
      });
      const child = {
        kill() {
          h.closeCalls++;
        },
        onExit() {
          /* the fake child never exits by itself */
        },
      };
      handles.push(h);
      onSpawn(h, child);
      return child;
    };
    const driver = createPluginDriver(
      {
        id: "f2-plugin",
        name: "F2 plugin",
        version: "1.0.0",
        apiVersion: "1",
        kind: "device-connector",
        protocols: ["f2-vendor"],
        sidecar: { command: "never-spawned", args: [] },
        signed: { pluginId: "f2-plugin", version: "1.0.0", artifactSha256: "0".repeat(64) },
      } as unknown as Parameters<typeof createPluginDriver>[0],
      { publisherPublicKeyPem: null, requireSignature: false, callTimeoutMs: 3000, rate: { capacity: 100, refillPerSec: 100 } },
    );
    return { driver, handles, cfg: { endpoint: "plugin://f2" } };
  },
  handleOf: (d) => (d as unknown as { transport: unknown }).transport,
};

// ── stub (no transport) ──────────────────────────────────────────────────────────────────────────────────────────
const stub: Harness = {
  deferred: false,
  make: () => ({ driver: createStubDriver(), handles: [], cfg: { endpoint: "stub://x" } }),
  handleOf: () => null,
};

const HARNESS: Record<string, Harness> = {
  s7,
  "ethernet-ip": eip,
  modbus,
  "mitsubishi-mc": mc,
  opcua,
  slmp,
  stub,
  "plugin-sidecar": plugin,
};

/**
 * Census map: every `registerDriver(` CALL SITE in server/ (non-test) ⇒ the harness that covers it. A literal protocol in
 * ot/index.ts maps to its own key; the plugin bridge's dynamic registration (any manifest protocol, one driver class) maps
 * to "plugin-sidecar". A call site missing here — a driver registered ANYWHERE without a harness — fails the census.
 */
const CALL_SITE_HARNESS: Record<string, string> = {
  'services/plugins/pluginDriverBridge.ts|protocol as OtProtocol, () => createPluginDriver(dm, opts)': "plugin-sidecar",
};
/**
 * final wave P-F1 (F re-review N1) — every `registerDriver` token of ONE file's text: a CALL (arguments read by paren
 * matching, so a call split over several lines is collected whole) or any other reference (the function passed as a value
 * / aliased — reported as `<reference>`, never covered). Import statements and whole-line comments are not sites.
 */
export function registerDriverSitesIn(src: string): string[] {
  // import statements and brace re-exports (`export { registerDriver } from "…"`) name the function, they do not register.
  const text = src
    .replace(/^import\s+(?:type\s+)?[\w*{}\s,]+\sfrom\s*["'][^"']+["'];?/gm, "")
    .replace(/^export\s*(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["'];?/gm, "");
  const out: string[] = [];
  const re = /\bregisterDriver\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
    const after = text.slice(m.index + m[0].length);
    const open = /^\s*\(/.exec(after);
    if (!open) {
      out.push("<reference>");
      continue;
    }
    let depth = 0;
    let i = m.index + m[0].length + open[0].length - 1;
    const from = i + 1;
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) break;
    }
    out.push(text.slice(from, i).replace(/\s+/g, " ").trim().replace(/,$/, "").trim());
  }
  return out;
}

function registerDriverCallSites(): Array<{ file: string; key: string }> {
  const root = path.resolve(__dirname, "../../..");
  const out: Array<{ file: string; key: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel === "services/ot/driverRegistry.ts") continue; // the definition
        // final wave P-F1 — the whole file text (multi-line calls, references passed as values), not one line at a time.
        for (const args of registerDriverSitesIn(fs.readFileSync(full, "utf8"))) out.push({ file: rel, key: `${rel}|${args}` });
      }
    }
  };
  walk(root);
  return out;
}

// Expected noise only (OPC UA "securityMode None" posture warning) — kept out of the test output.
// final wave P-F3 (F re-review N3) — ONLY those OPC UA security-posture lines are silenced (counted in `silencedWarns`);
// every other warning still prints.
const OPCUA_POSTURE_WARNING = /^\[OPCUA\] securityMode (not configured|None set explicitly)/;
const silencedWarns: string[] = [];
let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeAll(() => {
  const realWarn = console.warn.bind(console);
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    if (typeof a[0] === "string" && OPCUA_POSTURE_WARNING.test(a[0])) {
      silencedWarns.push(a[0]);
      return;
    }
    realWarn(...a);
  });
});
afterAll(async () => {
  warnSpy?.mockRestore();
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
});

describe("Đợt 5 F2 — census: every OT driver registered ANYWHERE in server/ has a harness here", () => {
  it("built-ins: registerDriver(\"…\") protocols of ot/index.ts == the built-in harness keys", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");
    const registered = [...src.matchAll(/registerDriver\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(registered.length).toBeGreaterThanOrEqual(7);
    expect(registered).toEqual(Object.keys(HARNESS).filter((k) => k !== "plugin-sidecar").sort());
  });

  it("final wave P-F1: the site reader SEES a call split over several lines and a reference passed as a value", () => {
    const multi = `import { registerDriver } from "../ot/driverRegistry";
export { registerDriver } from "../ot/driverRegistry";
// registerDriver("commented", x) is not a site
registerDriver(
  "x" as OtProtocol,
  () => createX({ a: 1 }),
);
const reg = registerDriver;
reg("y" as OtProtocol, createY);`;
    expect(registerDriverSitesIn(multi)).toEqual(['"x" as OtProtocol, () => createX({ a: 1 })', "<reference>"]);
  });

  it("every registerDriver( call site in server/ (non-test) is covered; every harness is reached by a call site", () => {
    const sites = registerDriverCallSites();
    expect(sites.length).toBeGreaterThanOrEqual(8); // 7 built-ins + the plugin bridge
    const uncovered: string[] = [];
    const reached = new Set<string>();
    for (const s of sites) {
      if (s.file === "services/ot/index.ts") {
        const lit = /^"([^"]+)"/.exec(s.key.split("|")[1]) ?? /^"([^"]+)" as OtProtocol/.exec(s.key.split("|")[1]);
        if (lit && HARNESS[lit[1]]) reached.add(lit[1]);
        else uncovered.push(s.key);
        continue;
      }
      const h = CALL_SITE_HARNESS[s.key];
      if (h && HARNESS[h]) reached.add(h);
      else uncovered.push(s.key);
    }
    expect(uncovered).toEqual([]);
    expect([...reached].sort()).toEqual(Object.keys(HARNESS).sort());
  });
});

describe("Đợt 5 F fix 1 (R-5-e) — plugin sidecar: a watchdog restart of the OLD supervisor is never adopted", () => {
  it("disconnect pending → connect (new supervisor) → the old supervisor respawns a child ⇒ its transport is closed, not adopted", async () => {
    PS.onSpawns.length = 0;
    const { driver: d, handles, cfg } = plugin.make();
    await within(d.connect(cfg), 3000, "plugin connect #1");
    const late = d.disconnect();
    await within(d.connect(cfg), 3000, "plugin connect #2");
    const current = plugin.handleOf(d);
    expect(PS.onSpawns).toHaveLength(2);
    // The OLD supervisor's watchdog restarts its child while the old disconnect RPC is still pending.
    const stray = fakeHandle({ request: async () => ({ ok: true }), close() { stray.closeCalls++; } });
    PS.onSpawns[0]!(stray, { kill() {}, onExit() {} });
    expect(plugin.handleOf(d)).toBe(current);
    expect(stray.closeCalls).toBe(1);
    release(handles[0]!);
    await within(late, 3000, "plugin late disconnect");
    expect(d.isConnected()).toBe(true);
    expect(plugin.handleOf(d)).toBe(current);
    const p = d.disconnect();
    for (const x of handles) release(x);
    await within(p, 3000, "plugin cleanup");
  });
});

describe("Đợt 5 F2 — a LATE disconnect() completion never tears down the newer session (every driver)", () => {
  for (const [protocol, h] of Object.entries(HARNESS)) {
    it(`${protocol}: disconnect (close pending) → connect → old close resolves ⇒ still connected, new handle intact`, async () => {
      if (protocol === "slmp") slmpCfgPort = await slmpPort;
      const { driver: d, handles, cfg } = h.make();

      await within(d.connect(cfg), 3000, `${protocol} connect #1`);
      expect(d.isConnected()).toBe(true);
      const oldHandle = h.handleOf(d);

      const late = d.disconnect(); // the old transport's close does NOT complete yet
      // capture-and-null-first: the driver says "not connected" synchronously, before the old close completes.
      expect(d.isConnected()).toBe(false);
      await tick();
      if (h.deferred) {
        expect(handles).toHaveLength(1);
        expect(handles[0]!.closeCalls).toBeGreaterThan(0);
      }

      await within(d.connect(cfg), 3000, `${protocol} connect #2`);
      expect(d.isConnected()).toBe(true);
      const newHandle = h.handleOf(d);
      if (protocol !== "stub") expect(newHandle).not.toBe(oldHandle);

      // The old session's close completes NOW — after the fresh connect.
      if (h.deferred) release(handles[0]!);
      await within(late, 3000, `${protocol} late disconnect`);
      if (h.deferred) emitLinkLoss(handles[0]!); // the old transport also reports its own death
      h.lateOld?.(oldHandle);
      await tick();

      expect(d.isConnected()).toBe(true);
      expect(h.handleOf(d)).toBe(newHandle);
      if (h.deferred) {
        expect(handles).toHaveLength(2);
        expect(handles[1]!.closeCalls).toBe(0);
      }

      await within(
        (async () => {
          const p = d.disconnect();
          for (const x of handles) release(x);
          await p;
        })(),
        3000,
        `${protocol} cleanup`,
      );
    });
  }
});

describe("final wave P-F3 — only the expected OPC UA posture warning is silenced", () => {
  it("the silenced lines are exactly OPC UA security-posture warnings (and the filter really met them)", () => {
    expect(silencedWarns.length).toBeGreaterThan(0);
    expect(silencedWarns.filter((w) => !OPCUA_POSTURE_WARNING.test(w))).toEqual([]);
  });
});
