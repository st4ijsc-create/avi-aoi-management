/**
 * doc 81 Đợt 11 Group K — OT_CMD_SERIALIZE_ENABLED load / STOP-bound MEASUREMENT harness (measurement only, `_test` only).
 *
 * REAL `dispatch()` on `_test` (adapter / tag / pin / HITL action rows are real) over a REAL ModbusDriver talking to an in-process
 * `ServerTCP` (127.0.0.1, port 0) whose write / read latency and "hang" are set by the test. Each phase runs once with the flag OFF and
 * once ON (process.env is read at call time), so every number has its own baseline. Raw numbers are printed as `KRESULT {json}` lines and,
 * if K_OUT is set, appended to that file. The assertions are only invariants the flag promises (not performance gates):
 *   - ON: at most ONE write on the wire per adapter; several adapters DO overlap.
 *   - ON: a pinned STOP runs right after the in-flight write and is the LAST value on the device.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import postgres from "postgres";
import * as ModbusSerialNs from "modbus-serial";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 60_000 });

const fake = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fps: new Map<number, string>(),
  driverWrites: [] as Array<{ adapterId: number; t0: number; t1: number; tags: string; conc: number }>,
}));

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (id: number) => (fake.drivers.has(id) ? fake.drivers.get(id) : orig.getActiveDriver(id)) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (id: number) => (fake.fps.has(id) ? fake.fps.get(id) : orig.getActiveConnectionFingerprint(id)),
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { dispatch, type DispatchInput, _adapterCommandQueueDepthForTests, _adapterCommandQueueCountForTests, _resetAdapterCommandQueuesForTests } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { createModbusDriver } from "./drivers/modbusDriver";
import { adapterTargetFingerprint } from "./adapterTarget";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;
const DB_URL = process.env.DATABASE_URL;
const DAU = `D11K-${Date.now()}`;
const OWNER = 990_911_001;
const MACHINE_BASE = 990_911_100;
const K_OUT = process.env.K_OUT;
const now = () => performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── simulated device: one in-process Modbus server per adapter ───────────────────────────────────
interface Dev {
  port: number;
  regs: Map<number, number>;
  writeMs: number;
  readMs: number;
  hang: boolean;
  hangNext: number;
  readHang: boolean;
  hung: Array<() => void>;
  wlog: Array<{ addr: number; value: number; t0: number; t1: number }>;
  close: () => Promise<void>;
}
async function startDev(): Promise<Dev> {
  const dev: Dev = { port: 0, regs: new Map(), writeMs: 20, readMs: 10, hang: false, hangNext: 0, readHang: false, hung: [], wlog: [], close: async () => undefined };
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
  dev.port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const vector = {
    getCoil: () => false,
    getDiscreteInput: () => false,
    getInputRegister: () => 0,
    getHoldingRegister: (addr: number, _u: number, cb: (e: Error | null, v: number) => void) => {
      if (dev.readHang) {
        dev.hung.push(() => cb(null, dev.regs.get(addr) ?? 0));
        return;
      }
      setTimeout(() => cb(null, dev.regs.get(addr) ?? 0), dev.readMs);
    },
    setCoil: (_a: number, _v: boolean, _u: number, cb: (e: Error | null) => void) => cb(null),
    setRegister: (addr: number, value: number, _u: number, cb: (e: Error | null) => void) => {
      const rec = { addr, value, t0: now(), t1: 0 };
      dev.wlog.push(rec);
      const done = () => {
        dev.regs.set(addr, value);
        rec.t1 = now();
        cb(null);
      };
      if (dev.hang || dev.hangNext > 0) {
        if (dev.hangNext > 0) dev.hangNext--;
        dev.hung.push(done);
        return;
      }
      setTimeout(done, dev.writeMs);
    },
  };
  const srv = new ServerTCP(vector, { host: "127.0.0.1", port: dev.port, unitID: 1 });
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  dev.close = () => new Promise<void>((r) => srv.close(() => r()));
  return dev;
}

// ── setup ────────────────────────────────────────────────────────────────────────────────────
let sql: ReturnType<typeof postgres>;
const adapters: Array<{ id: number; machineId: number; dev: Dev; drv: ReturnType<typeof createModbusDriver> }> = [];
let seq = 0;
const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "OT_CMD_QUEUE_MAX", "OT_CONTROL_TIMEOUT_MS", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
const TAG_W = "w1"; // holding:40001 int, unpinned
const TAG_STOP = "speed_sp"; // holding:40020 int, pinned stop value 0

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}
function emit(obj: Record<string, unknown>) {
  const line = JSON.stringify(obj);
  console.log("KRESULT " + line);
  if (K_OUT) fs.appendFileSync(K_OUT, line + "\n");
}
function pct(a: number[], p: number): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] * 10) / 10;
}
const stats = (a: number[]) => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: a.length ? Math.round(Math.max(...a) * 10) / 10 : NaN });

type W = { tagKey: string; value: unknown };
const TOOL = "set_machine_param";
async function makeAction(adapterId: number, machineId: number, commandType: string, writes: W[]): Promise<string> {
  const id = `${DAU}-a-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} load`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return id;
}
async function prep(a: (typeof adapters)[number], commandType: string, writes: W[]): Promise<DispatchInput> {
  const actionId = await makeAction(a.id, a.machineId, commandType, writes);
  return {
    adapterId: a.id,
    machineId: a.machineId,
    commandType,
    writes,
    triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER },
    idempotencyKey: `${DAU}-k-${++seq}`,
  };
}

/** wrap a real ModbusDriver so the test sees wire concurrency per adapter */
function wrapDriver(adapterId: number, real: ReturnType<typeof createModbusDriver>) {
  let conc = 0;
  return {
    isConnected: () => real.isConnected(),
    async writeTags(w: Array<{ tagKey: string; value: unknown }>) {
      conc++;
      const rec = { adapterId, t0: now(), t1: 0, tags: w.map((x) => `${x.tagKey}=${String(x.value)}`).join(","), conc };
      fake.driverWrites.push(rec);
      try {
        return await (real as any).writeTags(w);
      } finally {
        rec.t1 = now();
        conc--;
      }
    },
    readTags: (t: any) => (real as any).readTags(t),
  };
}

async function mkAdapter(i: number) {
  const x = await d();
  const machineId = MACHINE_BASE + i;
  const [row] = await x.insert(deviceAdapters).values({ code: `${DAU}-A${i}`, name: `${DAU} A${i}`, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", isEnabled: true, machineId }).returning();
  await x.insert(deviceTags).values([
    { adapterId: row!.id, tagKey: TAG_W, address: "holding:40001", dataType: "int", writable: true },
    { adapterId: row!.id, tagKey: "w2", address: "holding:40002", dataType: "int", writable: true },
    { adapterId: row!.id, tagKey: TAG_STOP, address: "holding:40020", dataType: "int", writable: true },
  ]);
  await sql`UPDATE device_tags SET stop_value = ${sql.json(0)}, stop_pinned_by = ${String(OWNER)}, stop_pinned_at = now() WHERE "adapterId" = ${row!.id} AND "tagKey" = ${TAG_STOP}`;
  const dev = await startDev();
  const drv = createModbusDriver();
  await drv.connect({ protocol: "modbus", endpoint: `tcp://127.0.0.1:${dev.port}`, options: { unitId: 1 }, timeoutMs: 5000 } as never);
  fake.drivers.set(row!.id, wrapDriver(row!.id, drv));
  const [fresh] = await x.select().from(deviceAdapters).where(eq(deviceAdapters.id, row!.id));
  fake.fps.set(row!.id, adapterTargetFingerprint(fresh!));
  adapters.push({ id: row!.id, machineId, dev, drv });
}

function setEnv(flag: boolean, over: Record<string, string> = {}) {
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  process.env.OT_READBACK_ENABLED = "true";
  process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
  delete process.env.OT_CMD_QUEUE_MAX;
  delete process.env.OT_CONTROL_TIMEOUT_MS;
  delete process.env.SEC_PLATFORM;
  delete process.env.UNS_CMD_ACK_ENABLED;
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
}
function reset(a: (typeof adapters)[number], writeMs = 20, readMs = 10) {
  a.dev.writeMs = writeMs;
  a.dev.readMs = readMs;
  a.dev.hang = false;
  a.dev.hangNext = 0;
  a.dev.readHang = false;
  for (const f of a.dev.hung.splice(0)) f();
  a.dev.wlog.length = 0;
  a.dev.regs.clear();
}

/** run `inputs` concurrently; sample queue depth; return per-command records */
async function burst(inputs: DispatchInput[], ids: number[], delaysMs: number[] = []) {
  fake.driverWrites.length = 0;
  let maxDepth = 0;
  const samples: number[] = [];
  const iv = setInterval(() => {
    const dep = ids.reduce((s, id) => s + _adapterCommandQueueDepthForTests(id), 0);
    samples.push(dep);
    if (dep > maxDepth) maxDepth = dep;
  }, 2);
  const t0 = now();
  const recs = await Promise.all(
    inputs.map(async (inp, i) => {
      if (delaysMs[i] > 0) await sleep(delaysMs[i]);
      else if (delaysMs[i] < 0) {
        // negative delay = submit once the adapter queue holds >= |delay| commands (all earlier writes are really queued), 3 s cap
        const until = now() + 3000;
        while (ids.reduce((sm, id) => sm + _adapterCommandQueueDepthForTests(id), 0) < -delaysMs[i] && now() < until) await sleep(1);
      }
      const ts = now();
      const res = await dispatch(inp);
      return { i, key: inp.idempotencyKey, submit: ts - t0, ms: now() - ts, end: now() - t0, status: res.status, reason: res.reason, ok: res.ok, results: res.results, pinned: res.pinnedStop === true };
    }),
  );
  clearInterval(iv);
  await sleep(5);
  return { recs, maxDepth, wall: now() - t0, t0 };
}
function maxConcPerAdapter(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const w of fake.driverWrites) out[w.adapterId] = Math.max(out[w.adapterId] ?? 0, w.conc);
  return out;
}
function concurrentTotalMax(): number {
  // max number of writes simultaneously on the wire across ALL adapters (sweep line)
  const ev: Array<[number, number]> = [];
  for (const w of fake.driverWrites) {
    ev.push([w.t0, 1], [w.t1 || w.t0, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0;
  let m = 0;
  for (const [, dlt] of ev) {
    c += dlt;
    m = Math.max(m, c);
  }
  return m;
}

describe.skipIf(!DB_URL)("Đợt 11 K — OT_CMD_SERIALIZE_ENABLED load + STOP bound (_test, in-process Modbus)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV) saved[k] = process.env[k];
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const [cot] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='device_tags' AND column_name IN ('stop_value','stop_pinned_by','stop_pinned_at')`;
    expect(cot.n).toBe(3);
    await import("./adapterFacade");
    for (let i = 0; i < 4; i++) await mkAdapter(i);
    setEnv(false);
    // warm-up (cold module load must not pollute the first phase)
    for (const f of [false, true]) {
      setEnv(f);
      const a = adapters[0];
      reset(a);
      await dispatch(await prep(a, "set", [{ tagKey: TAG_W, value: 1 }]));
    }
    _resetAdapterCommandQueuesForTests();
  });

  afterAll(async () => {
    for (const a of adapters) {
      a.dev.hang = false;
      for (const f of a.dev.hung.splice(0)) f();
      try {
        await a.drv.disconnect();
      } catch {
        /* ignore */
      }
      try {
        await a.dev.close();
      } catch {
        /* ignore */
      }
    }
    fake.drivers.clear();
    fake.fps.clear();
    if (sql) {
      await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${DAU + "%"}`;
      for (const a of adapters) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${a.id}`;
        await sql`DELETE FROM device_adapters WHERE id = ${a.id}`.catch(() => undefined); // command_log rows (WORM) may pin the adapter row
      }
      await sql.end();
    }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  for (const flag of [false, true]) {
    const F = flag ? "ON" : "OFF";

    it(`[${F}] A1 — one adapter, burst of 8 distinct values to ONE tag (ordering / readback)`, async () => {
      setEnv(flag);
      const a = adapters[0];
      reset(a, 20, 10);
      const inputs: DispatchInput[] = [];
      for (let v = 1; v <= 8; v++) inputs.push(await prep(a, "set", [{ tagKey: TAG_W, value: v }]));
      const r = await burst(inputs, [a.id]);
      const mism = r.recs.filter((x) => x.status === "acked_unverified").length;
      const verified = r.recs.filter((x) => x.status === "acked_verified").length;
      const wireOrder = a.dev.wlog.map((w) => w.value);
      const last = a.dev.regs.get(0);
      emit({ phase: "A1", flag: F, n: 8, lat: stats(r.recs.map((x) => x.ms)), maxDepth: r.maxDepth, wall: Math.round(r.wall), verified, readbackMismatch: mism, otherStatus: r.recs.filter((x) => !["acked_verified", "acked_unverified"].includes(x.status)).map((x) => x.status), wireOrder, finalRegister: last, maxConc: maxConcPerAdapter()[a.id] });
      if (flag) {
        expect(maxConcPerAdapter()[a.id]).toBe(1);
        expect(mism).toBe(0);
        expect(verified).toBe(8);
        expect(last).toBe(wireOrder[wireOrder.length - 1]);
      }
    });

    it(`[${F}] A2 — one adapter, burst of 40 (OT_CMD_QUEUE_MAX=1000): latency distribution`, async () => {
      setEnv(flag, { OT_CMD_QUEUE_MAX: "1000" });
      const a = adapters[0];
      reset(a, 20, 10);
      const inputs: DispatchInput[] = [];
      for (let v = 1; v <= 40; v++) inputs.push(await prep(a, "set", [{ tagKey: v % 2 ? TAG_W : "w2", value: v }]));
      const r = await burst(inputs, [a.id]);
      emit({ phase: "A2", flag: F, n: 40, lat: stats(r.recs.map((x) => x.ms)), maxDepth: r.maxDepth, wall: Math.round(r.wall), throughputPerS: Math.round((40 / r.wall) * 1000 * 10) / 10, byStatus: r.recs.reduce((m: Record<string, number>, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {}), maxConc: maxConcPerAdapter()[a.id] });
      if (flag) expect(maxConcPerAdapter()[a.id]).toBe(1);
    });

    it(`[${F}] A3 — one adapter, burst of 25 with the DEFAULT queue bound (10): BUSY`, async () => {
      setEnv(flag);
      const a = adapters[0];
      reset(a, 20, 10);
      const inputs: DispatchInput[] = [];
      for (let v = 1; v <= 25; v++) inputs.push(await prep(a, "set", [{ tagKey: TAG_W, value: v }]));
      const r = await burst(inputs, [a.id]);
      emit({ phase: "A3", flag: F, n: 25, byStatus: r.recs.reduce((m: Record<string, number>, x) => ((m[x.status + ":" + (x.reason ?? "")] = (m[x.status + ":" + (x.reason ?? "")] ?? 0) + 1), m), {}), maxDepth: r.maxDepth, latAccepted: stats(r.recs.filter((x) => x.reason !== "BUSY").map((x) => x.ms)), latBusy: stats(r.recs.filter((x) => x.reason === "BUSY").map((x) => x.ms)) });
      if (flag) expect(r.recs.filter((x) => x.reason === "BUSY").length).toBeGreaterThan(0);
      else expect(r.recs.filter((x) => x.reason === "BUSY").length).toBe(0);
    });

    it(`[${F}] B — 4 adapters x 8 concurrent writes: adapters are independent, each serialized`, async () => {
      setEnv(flag);
      const inputs: DispatchInput[] = [];
      for (const a of adapters) reset(a, 20, 10);
      for (let v = 1; v <= 8; v++) for (const a of adapters) inputs.push(await prep(a, "set", [{ tagKey: TAG_W, value: v }]));
      const r = await burst(inputs, adapters.map((a) => a.id));
      const per = maxConcPerAdapter();
      emit({ phase: "B", flag: F, n: 32, lat: stats(r.recs.map((x) => x.ms)), maxDepthSum: r.maxDepth, wall: Math.round(r.wall), throughputPerS: Math.round((32 / r.wall) * 1000 * 10) / 10, maxConcPerAdapter: per, maxConcAcrossAdapters: concurrentTotalMax(), readbackMismatch: r.recs.filter((x) => x.status === "acked_unverified").length, verified: r.recs.filter((x) => x.status === "acked_verified").length });
      if (flag) {
        for (const a of adapters) expect(per[a.id]).toBe(1);
        expect(concurrentTotalMax()).toBeGreaterThan(1);
      }
    });

    for (const lat of [20, 200, 1000]) {
      it(`[${F}] D — pinned STOP while 6 writes are queued (device write ${lat} ms, read-back on)`, async () => {
        setEnv(flag);
        const a = adapters[1];
        reset(a, lat, 10);
        const inputs: DispatchInput[] = [];
        for (let v = 1; v <= 6; v++) inputs.push(await prep(a, "set", [{ tagKey: TAG_STOP, value: 100 + v }])); // same tag the STOP pins to 0
        const stop = await prep(a, "stop", [{ tagKey: TAG_STOP, value: 0 }]);
        inputs.push(stop);
        const STOP_AT = Math.min(60, lat + 10); // after the first write is on the wire
        const r = await burst(inputs, [a.id], [0, 0, 0, 0, 0, 0, flag ? -5 : STOP_AT]); // ON: STOP is sent once 5 commands are queued (a write that is still in its pre-queue gates when the STOP is queued lands AFTER it - measured separately, flag-independent)
        await sleep(lat * 2 + 100); // let every device write settle before reading the final state
        const s = r.recs[6];
        const stopWrite = fake.driverWrites.find((w) => w.tags === `${TAG_STOP}=0`);
        const stopSubmitAbs = r.t0 + s.submit;
        const finalReg = a.dev.regs.get(19);
        const superseded = r.recs.filter((x) => x.reason === "SUPERSEDED_BY_STOP").length;
        const lastWire = a.dev.wlog.length ? a.dev.wlog[a.dev.wlog.length - 1].value : null;
        emit({ phase: "D", flag: F, deviceWriteMs: lat, stopStatus: s.status, stopPinned: s.pinned, stopDispatchMs: Math.round(s.ms), stopToWireMs: stopWrite ? Math.round(stopWrite.t0 - stopSubmitAbs) : null, supersededWrites: superseded, writesReachedDevice: a.dev.wlog.length, writeOrder: a.dev.wlog.map((w) => w.value), finalRegister: finalReg, finalIsStopValue: finalReg === 0, lastWireValue: lastWire, maxConc: maxConcPerAdapter()[a.id] });
        if (flag) {
          expect(s.pinned).toBe(true);
          expect(finalReg).toBe(0); // L-7: the STOP is the last word on the device
        }
      });
    }

    it(`[${F}] E — UNPINNED stop-typed command (value not the pin) behind 6 queued writes; then with a full queue`, async () => {
      setEnv(flag);
      const a = adapters[2];
      reset(a, 200, 10);
      const inputs: DispatchInput[] = [];
      for (let v = 1; v <= 6; v++) inputs.push(await prep(a, "set", [{ tagKey: TAG_W, value: v }]));
      inputs.push(await prep(a, "stop", [{ tagKey: TAG_W, value: 0 }])); // stop-typed but not the pin ⇒ NOT pinned
      const r = await burst(inputs, [a.id], [0, 0, 0, 0, 0, 0, 60]);
      const s = r.recs[6];
      emit({ phase: "E1", flag: F, stopStatus: s.status, stopReason: s.reason ?? null, stopPinned: s.pinned, stopDispatchMs: Math.round(s.ms), writeMs: 200, queuedAhead: 6 });
      // full queue
      reset(a, 200, 10);
      setEnv(flag, { OT_CMD_QUEUE_MAX: "3" });
      const inputs2: DispatchInput[] = [];
      for (let v = 1; v <= 3; v++) inputs2.push(await prep(a, "set", [{ tagKey: TAG_W, value: v }]));
      inputs2.push(await prep(a, "stop", [{ tagKey: TAG_W, value: 0 }]));
      const r2 = await burst(inputs2, [a.id], [0, 0, 0, 60]);
      const s2 = r2.recs[3];
      emit({ phase: "E2", flag: F, queueMax: 3, stopStatus: s2.status, stopReason: s2.reason ?? null, stopDispatchMs: Math.round(s2.ms) });
    });

    it(`[${F}] H — write answers, its READ-BACK hangs (default control timeout 5000 ms) with a pinned STOP queued behind it`, async () => {
      setEnv(flag); // default OT_CONTROL_TIMEOUT_MS = 5000
      const a = adapters[3];
      reset(a, 20, 10);
      a.dev.readHang = true;
      const inputs: DispatchInput[] = [];
      inputs.push(await prep(a, "set", [{ tagKey: TAG_STOP, value: 55 }]));
      inputs.push(await prep(a, "stop", [{ tagKey: TAG_STOP, value: 0 }]));
      const rp = burst(inputs, [a.id], [0, 100]);
      const r = await rp;
      a.dev.readHang = false;
      for (const f of a.dev.hung.splice(0)) f();
      await sleep(150);
      const w = r.recs[0];
      const s = r.recs[1];
      const stopWrite = fake.driverWrites.find((x) => x.tags === `${TAG_STOP}=0`);
      emit({ phase: "H", flag: F, controlTimeoutMs: 5000, inflightStatus: w.status, inflightMs: Math.round(w.ms), stopStatus: s.status, stopDispatchMs: Math.round(s.ms), stopToWireMs: stopWrite ? Math.round(stopWrite.t0 - (r.t0 + s.submit)) : null });
    });

    for (const tmo of [1000, 5000]) {
      it(`[${F}] F — first write HANGS (control timeout ${tmo} ms; later requests answer normally) with a pinned STOP queued behind it`, async () => {
        setEnv(flag, { OT_CONTROL_TIMEOUT_MS: String(tmo) });
        const a = adapters[3];
        reset(a, 20, 10);
        a.dev.hangNext = 1; // only the FIRST write on the wire never answers (released at the end of the test)
        const inputs: DispatchInput[] = [];
        inputs.push(await prep(a, "set", [{ tagKey: TAG_STOP, value: 77 }]));
        inputs.push(await prep(a, "stop", [{ tagKey: TAG_STOP, value: 0 }]));
        const r = await burst(inputs, [a.id], [0, 100]);
        await sleep(300);
        for (const f of a.dev.hung.splice(0)) f(); // release the abandoned request AFTER the measurement
        await sleep(100);
        const w = r.recs[0];
        const s = r.recs[1];
        const stopWrite = fake.driverWrites.find((x) => x.tags === `${TAG_STOP}=0`);
        emit({ phase: "F", flag: F, controlTimeoutMs: tmo, hungWriteStatus: w.status, hungWriteMs: Math.round(w.ms), stopStatus: s.status, stopDispatchMs: Math.round(s.ms), stopToWireMs: stopWrite ? Math.round(stopWrite.t0 - (r.t0 + s.submit)) : null, stopSubmitMsAfterFirstSubmit: Math.round(s.submit), finalRegister: a.dev.regs.get(19) });
      });
    }
  }

  // L-7 defect D-1 (measured E2): with the flag ON a STOP-typed command whose values are not the pins (unpinned) was answered
  // BUSY when the adapter queue was full, and otherwise waited FIFO behind every queued write. Fixed by K-fix (ruling R-11-c):
  // every stop-typed command is never BUSY and goes to the front (tryEnqueueAdapterCommand `stopTyped`). Was it.fails.
  it("L-7: with the flag ON a stop-typed command is never answered BUSY because the queue is full", async () => {
    setEnv(true, { OT_CMD_QUEUE_MAX: "3" });
    const a = adapters[2];
    reset(a, 200, 10);
    const inputs: DispatchInput[] = [];
    for (let v = 1; v <= 3; v++) inputs.push(await prep(a, "set", [{ tagKey: TAG_W, value: v }]));
    inputs.push(await prep(a, "stop", [{ tagKey: TAG_W, value: 0 }])); // stop-typed, value is not the pin
    const r = await burst(inputs, [a.id], [0, 0, 0, 60]);
    expect(r.recs[3].reason).not.toBe("BUSY");
  });

  it("G — edge/offline interplay: a driver-less adapter never touches the queue", async () => {
    setEnv(true);
    _resetAdapterCommandQueuesForTests();
    const a = adapters[0];
    const saveDrv = fake.drivers.get(a.id);
    fake.drivers.delete(a.id); // no central driver ≙ the state of an edge-owned (or offline) adapter
    // getActiveDriver falls to the real otManager which has no such adapter ⇒ undefined
    try {
      const w = await dispatch(await prep(a, "set", [{ tagKey: TAG_W, value: 5 }]));
      const st = await dispatch(await prep(a, "stop", [{ tagKey: TAG_STOP, value: 0 }]));
      emit({ phase: "G", writeReason: w.reason, stopReason: st.reason, queueEntries: _adapterCommandQueueCountForTests(), queueDepth: _adapterCommandQueueDepthForTests(a.id) });
      expect(_adapterCommandQueueCountForTests()).toBe(0);
    } finally {
      if (saveDrv) fake.drivers.set(a.id, saveDrv);
    }
  });
});
