/**
 * doc 81 Đợt 10 task F1 — the EDGE PROCESS of the two-process, NO-DB end-to-end suites (edgeExecution.dot10.e2e.db,
 * edgeAttack.dot10.e2e.db, and the Đợt 9 S3 / S4 suites adapted to v2). Spawned as a SEPARATE `vitest run` process by
 * __edgeE2eHarness.dot10.ts; in a normal test run it is skipped (F1_EDGE_CHILD unset).
 *
 * It runs the PRODUCTION entry point: `server/edge/edgeGatewayMain.ts` (edgeRole FIRST ⇒ AVI_PROCESS_ROLE=edge, dotenv from the
 * node's own env file — DOTENV_CONFIG_PATH, the role of `.env.edge` — then runEdgeGateway → bootstrapEdgeGateway: verified
 * config from central, journal, OT (Modbus TCP to the parent's simulator), robots (the SIM robot driver), agent).
 *
 * PROVEN UNABLE TO REACH THE DB (design §5a):
 *   • the spawn environment is an allow-list built by the parent (no DATABASE_URL / PG* / JWT_SECRET / SECRET_ENCRYPTION_KEY);
 *     vitest.setup derives a _test URL from the repo's .env for EVERY vitest process — it is deleted here before any import,
 *     and asserted absent again after the entry point loaded its own env file;
 *   • EDGE_DB_TRAP=throw: getDb / getJobsDb / getReadDb / a raw postgres() would throw and be counted (edgeDbTrapStats);
 *   • network tripwire: net.Socket.prototype.connect records every (host, port) — the parent asserts 0 connects to the PG port;
 *   • driver tripwire: `postgres` is mocked to throw when constructed — asserted never constructed;
 *   • explicit probe at the end: a deliberate getDb() must throw EDGE_DB_TRAP (and is then counted — the instrument check).
 *
 * The only harness addition (device simulation, not product behaviour): every runJob / abort reaching the SIM robot driver is
 * counted with a wall-clock timestamp (its MotionLock is the product driver's own since doc 81 Đợt 12 task N). The counts
 * and the runtime's state are written to <dir>/counts.json every 100 ms; the final measurement to <dir>/report.json.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const removed: string[] = [];
  for (const k of Object.keys(process.env)) {
    if (k === "DATABASE_URL" || k === "TEST_DATABASE_URL" || k.startsWith("PG") || k === "JWT_SECRET" || k === "SECRET_ENCRYPTION_KEY" || k === "MIGRATION_DB_URL") {
      removed.push(k);
      delete process.env[k];
    }
  }
  return { removed, connects: [] as Array<{ host: string; port: number; at: number }>, pgConstructed: 0 };
});

vi.mock("postgres", () => {
  const ctor = () => {
    h.pgConstructed++;
    throw new Error("postgres client constructed on the edge");
  };
  return { default: ctor };
});

import net from "node:net";
import { existsSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

const DIR = process.env.F1_EDGE_DIR ?? "";
const PG_PORT = Number(process.env.F1_EDGE_PG_PORT ?? "0");

type Ev = { jobType: string; robotId: number | null; at: number };

describe.skipIf(!process.env.F1_EDGE_CHILD)("doc 81 Đợt 10 F1 — child: the edge gateway process (no DB)", () => {
  it("runs edgeGatewayMain until the parent says stop, then measures the DB tripwires", async () => {
    // ── the env the process was GIVEN (vitest.setup's derived URL removed above) ──
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.JWT_SECRET).toBeUndefined();
    expect(process.env.SECRET_ENCRYPTION_KEY).toBeUndefined();
    expect(Object.keys(process.env).filter((k) => k.startsWith("PG"))).toEqual([]);
    process.env.EDGE_DB_TRAP = "throw";

    // ── network tripwire ──
    const realConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
      const a = args[0] as { host?: string; port?: number | string } | number | string;
      const port = typeof a === "object" && a !== null ? Number(a.port) : Number(a);
      const host = typeof a === "object" && a !== null ? String(a.host ?? "localhost") : typeof args[1] === "string" ? String(args[1]) : "localhost";
      h.connects.push({ host, port, at: Date.now() });
      return (realConnect as (...x: unknown[]) => net.Socket).apply(this, args);
    } as typeof net.Socket.prototype.connect;

    // ── the SIM robot: counted calls. Its MotionLock is the PRODUCT driver's own since doc 81 Đợt 12 task N (no patch) ──
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const { MotionLock } = await import("../robot/robotDriver");
    const motions: Ev[] = [];
    const stops: Ev[] = [];
    const origConnect = SimRobotDriver.prototype.connect;
    SimRobotDriver.prototype.connect = async function (this: { _endpoint?: string }, cfg: { endpoint?: string }) {
      this._endpoint = String(cfg?.endpoint ?? "");
      return origConnect.call(this, cfg as never);
    };
    const robotOf = (self: { _endpoint?: string }) => {
      const m = /#(\d+)$/.exec(self._endpoint ?? "");
      return m ? Number(m[1]) : null;
    };
    const origRunJob = SimRobotDriver.prototype.runJob;
    SimRobotDriver.prototype.runJob = async function (this: { _endpoint?: string }, job: { jobType: string }) {
      const ev = { jobType: String(job?.jobType), robotId: robotOf(this), at: Date.now() };
      (ev.jobType === "abort" ? stops : motions).push(ev);
      return origRunJob.call(this, job as never);
    };
    const origAbort = SimRobotDriver.prototype.abort;
    SimRobotDriver.prototype.abort = async function (this: { _endpoint?: string }) {
      stops.push({ jobType: "driver.abort", robotId: robotOf(this), at: Date.now() });
      return origAbort.call(this);
    };

    // ── THE PRODUCTION ENTRY POINT ──
    const t0 = Date.now();
    await import("../../edge/edgeGatewayMain");
    const rtMod = await import("./edgeGatewayRuntime");
    const conn = await import("../../db/connection");
    expect(process.env.AVI_PROCESS_ROLE).toBe("edge");
    expect(conn.isEdgeProcessRole()).toBe(true);
    // the node's env file was loaded (dotenv) — and it carries no DB / central secret either
    expect(process.env.EDGE_CENTRAL_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.JWT_SECRET).toBeUndefined();
    expect(process.env.SECRET_ENCRYPTION_KEY).toBeUndefined();

    const rm = await import("../robot/robotManager");
    const om = await import("../ot/otManager");
    const state = () => {
      const rt = rtMod.getEdgeRuntime();
      const robots = rm.activeRobotIds().map((id) => {
        const r = rm.getActiveRobot(id) as { driver?: { motionLockController?: () => InstanceType<typeof MotionLock> } } | undefined;
        const s = r?.driver?.motionLockController?.().snapshot();
        return { id, locked: s?.locked ?? null, generation: s?.generation ?? null, reasonCode: s?.reasonCode ?? null };
      });
      const j = rt?.journal.stats();
      return {
        pid: process.pid,
        bootMs: Date.now() - t0,
        configVersion: rt?.config.current()?.configVersion ?? null,
        configHash: rt?.config.hash() ?? null,
        journal: j ? { epoch: j.epoch, backlog: j.backlog, full: j.full, healthy: j.healthy } : null,
        robots,
        adapters: om.listActiveAdapters().map((a: { adapterId?: number; id?: number }) => Number(a.adapterId ?? a.id)),
        motions,
        stops,
        trap: conn.edgeDbTrapStats(),
        pgConnects: h.connects.filter((c) => c.port === PG_PORT).length,
        pgConstructed: h.pgConstructed,
        at: Date.now(),
      };
    };
    const writeAtomic = (name: string, v: unknown) => {
      const tmp = path.join(DIR, `${name}.tmp`);
      writeFileSync(tmp, JSON.stringify(v));
      renameSync(tmp, path.join(DIR, name));
    };
    const timer = setInterval(() => {
      try {
        writeAtomic("counts.json", state());
      } catch {
        /* the next tick writes it */
      }
    }, 100);

    // ready = a verified config is in use (the runtime exists) — or the boot gave up (fail-closed, reported)
    const readyBy = Date.now() + 120_000;
    while (Date.now() < readyBy && !(rtMod.getEdgeRuntime()?.config.current() && (process.env.F1_EDGE_WAIT_ROBOT !== "1" || rm.activeRobotIds().length > 0))) {
      await new Promise((r) => setTimeout(r, 100));
    }
    writeAtomic("counts.json", state());
    writeFileSync(path.join(DIR, "ready"), String(process.pid));

    const deadline = Date.now() + Number(process.env.F1_EDGE_MAX_MS ?? 900_000);
    while (!existsSync(path.join(DIR, "stop")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    clearInterval(timer);

    // ── the measurement (before the instrument check, which itself increments the trap counter) ──
    const final = state();
    await rtMod.stopEdgeGateway();
    let probe: string;
    try {
      const d = await conn.getDb();
      probe = d === null ? "null" : "CONNECTED";
    } catch (err) {
      probe = String((err as { code?: string }).code ?? (err as Error).message);
    }
    writeAtomic("report.json", { ...final, removedFromEnv: h.removed, connectsAll: h.connects.length, probe, trapAfterProbe: conn.edgeDbTrapCount() });
    net.Socket.prototype.connect = realConnect;
  }, 1_000_000);
});
