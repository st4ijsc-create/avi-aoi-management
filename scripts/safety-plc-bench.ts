/**
 * doc 81 Đợt 11 task L — bench of the background safety-PLC poller (SAFETY_PLC_POLLER_ENABLED path) against ANY Modbus TCP PLC.
 *
 *   pnpm tsx scripts/safety-plc-bench.ts --self-test                      # in-process Modbus server (proves the script)
 *   pnpm tsx scripts/safety-plc-bench.ts --endpoint tcp://127.0.0.1:502   # a real OpenPLC (see group-L-report.md)
 *       [--estop-coil 1] [--zone-coil 2] [--latch-coil 3] [--interval-ms 500]
 *
 * Needs no DB, no :3000, no .env: doors and poll-state are in memory, the leader gate is a stub. The poller is the REAL class on
 * the REAL ModbusDriver. External mode drives the inputs with a SEPARATE "operator" Modbus client (the fixture plays the PLC's
 * wiring: the poller itself never writes). The poller's own writes are counted only in --self-test (server-side counter);
 * against a real PLC prove it with a capture (function codes seen from the poller must be 01/02/03 only).
 */
import * as ModbusSerialNs from "modbus-serial";
import type { SafetyPlcConfig } from "../drizzle/schema";
import type { RecordSafetyEventInput } from "../server/services/safety/safetyAuditService";
import type { PollStateRow, PollStateStore } from "../server/services/safety/plc/safetyPlcPollerHealth";
import "../server/services/ot";
import { SafetyPlcPoller } from "../server/services/safety/plc/safetyPlcPoller";

const NS: any = ModbusSerialNs;
const ServerTCP: any = NS.ServerTCP ?? NS.default?.ServerTCP;
const ModbusRTU: any = NS.default ?? NS;

export interface BenchOptions { endpoint?: string; estopCoil: number; zoneCoil: number; latchCoil: number; intervalMs: number; selfTest: boolean }
export interface BenchStep { step: string; expected: string; got: string; ok: boolean; ms: number }
export interface BenchResult { mode: string; steps: BenchStep[]; events: Array<{ door: string; eventType: string; transition: unknown }>; serverWrites: number | string; ok: boolean }

export interface Plc { set(addr0: number, v: boolean): Promise<void>; offline(): Promise<void>; online(): Promise<void>; endpoint: string; writes(): number | null; close(): Promise<void> }

export async function selfServer(): Promise<Plc> {
  const coils = new Map<number, boolean>();
  let writes = 0;
  let srv: any;
  let port = 0;
  const start = async () => {
    srv = new ServerTCP(
      { getCoil: (a: number) => coils.get(a) ?? false, getDiscreteInput: () => false, getHoldingRegister: () => 0, getInputRegister: () => 0, setCoil: () => { writes++; }, setRegister: () => { writes++; } },
      { host: "127.0.0.1", port: port ? String(port) : "0", unitID: 1 },
    );
    await new Promise<void>((res, rej) => { srv.once("initialized", () => res()); srv.once("serverError", rej); });
    port = srv._server.address().port;
  };
  const stop = () => new Promise<void>((res) => {
    for (const s of srv?.socks?.keys?.() ?? []) (s as any).destroy();
    srv ? srv.close(() => res()) : res();
  });
  await start();
  return { set: async (a, v) => void coils.set(a, v), offline: stop, online: start, get endpoint() { return `tcp://127.0.0.1:${port}`; }, writes: () => writes, close: stop };
}

const waitEnter = () => new Promise<void>((r) => process.stdin.once("data", () => r()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Optional automation of the offline/online steps for a Dockerised OpenPLC (env BENCH_PLC_CONTAINER, BENCH_PLC_WEB). */
async function dockerCycle(kind: "stop" | "start"): Promise<boolean> {
  const name = process.env.BENCH_PLC_CONTAINER;
  if (!name) return false;
  const { execFileSync } = await import("node:child_process");
  execFileSync("docker", [kind, name], { stdio: "ignore", timeout: 60_000 });
  if (kind === "start") {
    const web = process.env.BENCH_PLC_WEB; // e.g. http://127.0.0.1:18080 - OpenPLC v3 web UI (default credentials, local only)
    for (let i = 0; i < 40; i++) {
      try {
        if (!web) break;
        const r = await fetch(web + "/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=openplc&password=openplc", redirect: "manual" });
        const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
        await fetch(web + "/start_plc", { headers: { cookie }, redirect: "manual" });
        break;
      } catch { await sleep(1000); }
    }
    await sleep(3000);
  }
  return true;
}

export async function externalPlc(endpoint: string): Promise<Plc> {
  const u = new URL(endpoint.replace(/^tcp:/, "http:"));
  const c = new ModbusRTU();
  await c.connectTCP(u.hostname, { port: Number(u.port || 502) });
  c.setID(1);
  c.setTimeout(3000);
  return {
    set: async (a, v) => { await c.writeCoil(a, v); },
    offline: async () => { if (await dockerCycle("stop")) return; console.log("  >>> take the PLC offline now (stop the OpenPLC runtime / container), then press Enter"); await waitEnter(); },
    online: async () => { if (await dockerCycle("start")) { try { c.close(() => undefined); } catch { /* ignore */ } await c.connectTCP(u.hostname, { port: Number(u.port || 502) }); c.setID(1); return; } console.log("  >>> bring the PLC back online, then press Enter"); await waitEnter(); },
    endpoint, writes: () => null, close: async () => { try { c.close(() => undefined); } catch { /* ignore */ } },
  };
}

export async function runBench(o: BenchOptions): Promise<BenchResult> {
  const plc = o.selfTest ? await selfServer() : await externalPlc(o.endpoint!);
  const events: BenchResult["events"] = [];
  const rows = new Map<number, PollStateRow>();
  const rec = (door: string) => async (i: RecordSafetyEventInput) => {
    events.push({ door, eventType: i.eventType, transition: (i.humanPosition as Record<string, unknown> | undefined)?.transition });
    return { ok: true, enabled: true };
  };
  const store: PollStateStore = { load: async (id) => rows.get(id) ?? null, save: async (r) => void rows.set(r.configId, JSON.parse(JSON.stringify(r))), list: async () => [...rows.values()], claimStaleAlarm: async () => false };
  const cfg = (withLatch: boolean): SafetyPlcConfig => ({
    id: 9011, code: "BENCH-L", name: "bench L", vendor: "openplc", backend: "modbus", endpoint: plc.endpoint,
    statusMap: { estop: { address: `coil:${o.estopCoil}` }, zoneOccupied: { address: `coil:${o.zoneCoil}` }, ...(withLatch ? { estopLatch: { address: `coil:${o.latchCoil}` } } : {}), pollIntervalMs: o.intervalMs },
    robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date(),
  }) as SafetyPlcConfig;
  const E = o.estopCoil - 1, Z = o.zoneCoil - 1, L = o.latchCoil - 1;
  const steps: BenchStep[] = [];
  const mk = (withLatch: boolean) => {
    rows.clear();
    return new SafetyPlcPoller({
      loadConfigs: async () => [cfg(withLatch)], recordPlain: rec("plain"), recordTrusted: rec("trusted"), isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined }, state: store,
    } as never);
  };
  const check = async (step: string, expected: string | ((got: string) => boolean), label: string, act: () => Promise<void>) => {
    const from = events.length;
    const t0 = Date.now();
    await act();
    const ms = Date.now() - t0;
    const got = events.slice(from).map((e) => `${e.eventType}:${e.transition}`).join(",") || "(none)";
    steps.push({ step, expected: label, got, ok: typeof expected === "string" ? got === expected : expected(got), ms });
  };
  for (const a of [E, Z, L]) await plc.set(a, false);

  // A) latch-enabled poller
  let p = mk(true);
  await p.refreshConfigs();
  await p.pollNow(9011);
  await check("A0 all clear -> online silently", "(none)", "(none)", async () => { await p.pollNow(9011); });
  await check("A1 e-stop press held across a poll (seen live)", "estop:active", "estop:active", async () => { await plc.set(E, true); await plc.set(L, true); await p.pollNow(9011); });
  await check("A2 e-stop release (latch still set)", "estop_released:released", "estop_released:released", async () => { await plc.set(E, false); await p.pollNow(9011); });
  await check("A3 operator reset clears the latch", "(none)", "(none)", async () => { await plc.set(L, false); await p.pollNow(9011); });
  await check("A4 SHORT press+release inside one interval, WITH latch", "estop:latched,estop_released:released", "estop:latched,estop_released:released", async () => { await plc.set(E, true); await plc.set(L, true); await plc.set(E, false); await p.pollNow(9011); });
  await plc.set(L, false);
  await p.pollNow(9011);
  await check("A5 guard (zone) trip", (g) => g !== "(none)" && !g.includes("estop") && !g.includes(","), "exactly one non-estop event", async () => { await plc.set(Z, true); await p.pollNow(9011); });
  await check("A6 guard clear (informational)", () => true, "any", async () => { await plc.set(Z, false); await p.pollNow(9011); });
  await check("A7 PLC offline -> plc_offline, no false e-stop", "plc_offline:offline", "plc_offline:offline", async () => { await plc.offline(); for (let i = 0; i < 2; i++) await p.pollNow(9011).catch(() => undefined); });
  await check("A8 PLC back online -> plc_online, no e-stop", "plc_online:online", "plc_online:online", async () => {
    await plc.online();
    await sleep(300);
    for (let i = 0; i < 3; i++) { await p.pollNow(9011).catch(() => undefined); await sleep(o.intervalMs); }
  });
  const link = (rows.get(9011) as { link?: string } | undefined)?.link;
  steps.push({ step: "A9 durable poll state after recovery", expected: "link=online", got: `link=${link}`, ok: link === "online", ms: 0 });
  await p.stop();

  // B) no-latch poller: the short press is expected to be MISSED (documents why the latch exists)
  await plc.set(L, false);
  p = mk(false);
  await p.refreshConfigs();
  await p.pollNow(9011);
  await check("B1 SHORT press+release WITHOUT latch (expected missed)", "(none)", "(none)", async () => { await plc.set(E, true); await plc.set(E, false); await p.pollNow(9011); });
  await p.stop();

  const writes = plc.writes();
  await plc.close();
  const ok = steps.every((s) => s.ok) && (writes === null || writes === 0);
  return { mode: o.selfTest ? "self-test (in-process Modbus server)" : `external ${o.endpoint}`, steps, events, serverWrites: writes ?? "n/a (external PLC: use a capture)", ok };
}

function parse(argv: string[]): BenchOptions {
  const g = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  return { selfTest: argv.includes("--self-test"), endpoint: g("--endpoint"), estopCoil: Number(g("--estop-coil", "1")), zoneCoil: Number(g("--zone-coil", "2")), latchCoil: Number(g("--latch-coil", "3")), intervalMs: Number(g("--interval-ms", "500")) };
}

if (process.argv[1] && /safety-plc-bench\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const o = parse(process.argv.slice(2));
  if (!o.selfTest && !o.endpoint) { console.error("usage: --self-test | --endpoint tcp://host:port"); process.exit(2); }
  runBench(o).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }).catch((e) => { console.error(e); process.exit(1); });
}
