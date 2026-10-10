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
import { describe, it, expect, afterAll } from "vitest";
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
};

afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
});

describe("Đợt 5 F2 — census: every built-in OT driver registered in ot/index.ts has a harness here", () => {
  it("registerDriver(...) protocols == harness keys", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");
    const registered = [...src.matchAll(/registerDriver\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(registered.length).toBeGreaterThanOrEqual(7);
    expect(registered).toEqual(Object.keys(HARNESS).sort());
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
