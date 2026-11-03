/**
 * SCADA R1b-2b-2a A2(l) (AN TOÀN, L-7) — the robot interlock gate gates robot MOTION by the machines WHERE the robot is, never by "machine id =
 * robot id".
 *
 * Hole (before A2(l)): robotInterlockTarget(robotId) = { adapterId: -1, machineId: robotId } — a rule on machine N blocked robot N (ids collide:
 * DEV robots 1–3 = machines SPI/AOI/AVI) and a rule on the machine(s) where the robot works never applied to it.
 *
 * Cases (DB THẬT `_test`, everything inside ONE transaction per case that is ROLLED BACK — no committed row, no explicit id in a WORM table):
 *   R1 rule on machine N, robot N (same number) placed on ANOTHER line ⇒ motion NOT blocked (the collision is gone);
 *   R2 robot at station S: a rule on a machine of S ⇒ blocked; a rule on a machine of another station (same line) ⇒ not blocked;
 *   R3 line-level robot: a rule on ANY machine of its line ⇒ blocked; the preview names the machine + same line;
 *   R4 unplaced / dangling station / dangling line / contradictory ⇒ ROBOT_CHUA_DINH_VI for motion, the STOP goes out;
 *   R5 resolver lookup error ⇒ motion refused fail-closed (INTERLOCK_BLOCKED), the STOP goes out;
 *   R6 the three sites agree (dispatcher, robot.interlockPreview, edge robotGates) on the same rows;
 *   R8 L-7 — a blocking rule on EVERY machine of the robot's line, and an unplaced robot: abort / stop / e_stop reach the driver, the resolver and
 *      the gate are never consulted.
 * Real dispatcher + real gate + real edge robotGates + real router; FAKE driver (counts jobs). Machine ids / robot ids are fresh (serial) except
 * R1's robot, inserted with the id of a fresh machine (robots is not a WORM table) to reproduce the collision.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  jobs: new Map<number, string[]>(),
  loiTraCuu: false,
  traCuu: 0,
  congHoi: 0,
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return { ...real, getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb, __realGetDb: real.getDb };
});
vi.mock("../robot/robotManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/robotManager")>();
  return {
    ...orig,
    getActiveRobot: (id: number) =>
      H.jobs.has(id)
        ? {
            driver: {
              vendor: "sim",
              isConnected: () => true,
              getMotionLock: () => ({ locked: false }),
              runJob: async (job: { jobType: string }) => {
                H.jobs.get(id)!.push(job.jobType);
                return { ok: true, status: "done", detail: { fake: true } };
              },
              abort: async () => undefined,
              health: async () => ({ vendor: "sim", connected: true }),
            },
          }
        : undefined,
  };
});
// counts every resolver call; R5 turns it into a lookup error (the resolver's own `loi` result — what a DB failure gives)
vi.mock("./tapMayChoRobot", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./tapMayChoRobot")>();
  return {
    ...orig,
    tapMayChoRobot: async (d: Parameters<typeof orig.tapMayChoRobot>[0], robotId: number) => {
      H.traCuu++;
      return H.loiTraCuu ? { loai: "loi" as const, robotId, loi: "simulated lookup failure" } : orig.tapMayChoRobot(d, robotId);
    },
  };
});
vi.mock("./interlockGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./interlockGate")>();
  return {
    ...orig,
    evaluateInterlockGate: async (p: Parameters<typeof orig.evaluateInterlockGate>[0]) => {
      H.congHoi++;
      return orig.evaluateInterlockGate(p);
    },
  };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async () => undefined };
});

import * as conn from "../../db/connection";
import { interlockRules } from "../../../drizzle/schema";
import { tapMayChoRobot, ROBOT_CHUA_DINH_VI, type ViTriRobot } from "./tapMayChoRobot";
import { dispatchRobotJob } from "../robot/robotCommandDispatcher";
import { robotGates } from "../edge/edgeAuthorizeCentral";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2L-${Date.now()}`;
const OWNER = 990_912_401;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

async function one(tx: Tx, q: ReturnType<typeof sql>): Promise<number> {
  const r = (await tx.execute(q)) as unknown as Array<{ id: number | string }>;
  return Number((Array.isArray(r) ? r : (r as unknown as { rows: Array<{ id: number }> }).rows)[0]!.id);
}

interface Cay {
  L1: number;
  L2: number;
  S1a: number;
  S1b: number;
  S2: number;
  /** machines: two at S1a, one at S1b (line 1), one at S2 (line 2) */
  mA1: number;
  mA2: number;
  mB: number;
  m2: number;
  /** an edge node of the factory (the edge robot gate states the safety-PLC ids for the node's factory) */
  node: number;
}

/** a short unique suffix (factory / workshop / line / station codes are varchar(50)) */
const ngan = () => randomUUID().slice(0, 8);

/** factory → workshop → lines L1, L2 → stations S1a, S1b (L1), S2 (L2) → machines. Inside the rolled-back transaction only. */
async function taoCay(tx: Tx): Promise<Cay> {
  const fCode = `F-${DAU}-${ngan()}`;
  const f = await one(tx, sql`INSERT INTO factories (code, name, "isActive") VALUES (${fCode}, 'a2l', true) RETURNING id`);
  const node = await one(tx, sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N-${DAU}-${ngan()}`}, 'a2l node', ${fCode}, 'online') RETURNING id`);
  const w = await one(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`W-${DAU}-${ngan()}`}, 'a2l ws') RETURNING id`);
  const L1 = await one(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`L1-${DAU}-${ngan()}`}, 'a2l line 1') RETURNING id`);
  const L2 = await one(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`L2-${DAU}-${ngan()}`}, 'a2l line 2') RETURNING id`);
  const tram = (l: number, k: string) => one(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${l}, ${`${k}-${DAU}-${ngan()}`}, ${k}) RETURNING id`);
  const S1a = await tram(L1, "S1a");
  const S1b = await tram(L1, "S1b");
  const S2 = await tram(L2, "S2");
  const may = (s: number, k: string) =>
    one(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s}, ${`${k}-${DAU}`.slice(0, 50)}, ${k}, 'AUTOMATION', true) RETURNING id`);
  return { L1, L2, S1a, S1b, S2, mA1: await may(S1a, "MA1"), mA2: await may(S1a, "MA2"), mB: await may(S1b, "MB"), m2: await may(S2, "M2"), node };
}

/** an enabled robot; `id` explicit only for R1 (robots is not WORM). */
async function taoRobot(tx: Tx, p: { lineId: number | null; stationId: number | null; id?: number }): Promise<number> {
  const code = `R-${DAU}-${randomUUID()}`;
  const id =
    p.id != null
      ? await one(tx, sql`INSERT INTO robots (id, code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${p.id}, ${code}, 'a2l', 'sim', 'sim://a2l', true, ${p.lineId}, ${p.stationId}) RETURNING id`)
      : await one(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${code}, 'a2l', 'sim', 'sim://a2l', true, ${p.lineId}, ${p.stationId}) RETURNING id`);
  H.jobs.set(id, []);
  return id;
}

/** enabled + approved `stop_line` rule aimed ONLY at machine `may` (no adapter, no tag); condition always met (spc_violation count >= 0). */
async function taoLuat(tx: Tx, may: number): Promise<number> {
  const [r] = await tx
    .insert(interlockRules)
    .values({
      name: `${DAU} rule machine ${may}`,
      scope: "machine",
      machineId: may,
      sourceType: "spc_violation",
      comparisonOperator: "gte",
      threshold: "0",
      action: "stop_line",
      targetMachineId: may,
      requiresHumanConfirm: true,
      enabled: true,
      approvedBy: OWNER,
      approvedAt: new Date(),
    })
    .returning({ id: interlockRules.id });
  return r!.id;
}

const chuyenDong = (robotId: number) =>
  dispatchRobotJob({ robotId, job: { jobType: "move", params: { x: 1 } }, triggerKind: "manual", requestedBy: OWNER, confirmedBy: OWNER, idempotencyKey: `${DAU}-m-${randomUUID()}` });
const dung = (robotId: number, jobType: "abort" | "stop" | "e_stop" = "abort") =>
  dispatchRobotJob({ robotId, job: { jobType: jobType as never, params: {} }, triggerKind: "manual", requestedBy: OWNER, idempotencyKey: `${DAU}-s-${randomUUID()}` });

/** the edge robot gate on the same rows (real mode: ROBOT_CONTROL_ENABLED + no commissioning required). */
async function congEdge(tx: Tx, c: Cay, robotId: number) {
  const rb = { kind: "robot", step: { id: "s1", type: "command" }, cmd: {}, robotId, jobType: "move", params: { x: 1 }, payloadHash: null, isStop: false } as never;
  return robotGates(tx as never, c.node, rb, OWNER, OWNER, 1);
}

/** robot.interlockPreview as an admin (full scope — robotThayDuoc passes; the scope rule is covered by loThietBiPhamVi.db). */
async function xemTruoc(robotId: number) {
  const { robotRouter } = await import("../../routers/robotRouter");
  const c = robotRouter.createCaller({ user: { id: OWNER, role: "admin", name: "a2l", twoFactorEnabled: true } } as never);
  return c.interlockPreview({ robotId });
}

const ENV = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_SAFETY_PREFLIGHT_ENABLED", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_CONTROL_TIMEOUT_MS"] as const;
const saved: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(l) — robot interlock by the machines WHERE the robot is (CSDL _test, ROLLBACK)", () => {
  beforeAll(() => {
    expect(DB_URL).toMatch(/_test/); // never the DEV database
    for (const k of ENV) saved[k] = process.env[k];
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "false"; // the safety-PLC preflight is measured elsewhere; this suite measures the interlock
    delete process.env.FIELD_V2_ENABLED;
    delete process.env.SEC_PLATFORM;
  });
  afterAll(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  beforeEach(() => {
    H.jobs.clear();
    H.loiTraCuu = false;
    H.traCuu = 0;
    H.congHoi = 0;
  });

  it("decision table of the resolver on real rows (station / line / unplaced / dangling / contradictory / missing)", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const rTram = await taoRobot(tx, { lineId: c.L1, stationId: c.S1a });
      const rTramKhongChuyen = await taoRobot(tx, { lineId: null, stationId: c.S1b });
      const rChuyen = await taoRobot(tx, { lineId: c.L1, stationId: null });
      const rKhong = await taoRobot(tx, { lineId: null, stationId: null });
      const rTramMo = await taoRobot(tx, { lineId: null, stationId: 2_000_000_001 });
      const rChuyenMo = await taoRobot(tx, { lineId: 2_000_000_002, stationId: null });
      const rMauThuan = await taoRobot(tx, { lineId: c.L1, stationId: c.S2 });
      const v = (id: number) => tapMayChoRobot(tx as never, id);
      expect(await v(rTram)).toEqual({ loai: "tram", robotId: rTram, stationId: c.S1a, lineId: c.L1, machineIds: [c.mA1, c.mA2].sort((a, b) => a - b) });
      expect(await v(rTramKhongChuyen)).toEqual({ loai: "tram", robotId: rTramKhongChuyen, stationId: c.S1b, lineId: c.L1, machineIds: [c.mB] });
      expect(await v(rChuyen)).toEqual({ loai: "chuyen", robotId: rChuyen, lineId: c.L1, machineIds: [c.mA1, c.mA2, c.mB].sort((a, b) => a - b) });
      expect(await v(rKhong)).toEqual({ loai: "chua_dinh_vi", robotId: rKhong, lyDo: "khong_vi_tri" });
      expect(await v(rTramMo)).toEqual({ loai: "chua_dinh_vi", robotId: rTramMo, lyDo: "tram_khong_ton_tai" });
      expect(await v(rChuyenMo)).toEqual({ loai: "chua_dinh_vi", robotId: rChuyenMo, lyDo: "chuyen_khong_ton_tai" });
      expect(await v(rMauThuan)).toEqual({ loai: "chua_dinh_vi", robotId: rMauThuan, lyDo: "mau_thuan" });
      expect(await v(2_000_000_003)).toEqual({ loai: "chua_dinh_vi", robotId: 2_000_000_003, lyDo: "khong_co_robot" });
      // the robot id itself is never in its set
      for (const id of [rTram, rChuyen]) expect(((await v(id)) as Extract<ViTriRobot, { machineIds: number[] }>).machineIds).not.toContain(id);
    });
  });

  it("R1 — rule on machine N; robot N (same number) placed on ANOTHER line ⇒ motion NOT blocked, sent; the 3 sites agree (clear)", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const [ton] = (await tx.execute(sql`SELECT 1 AS x FROM robots WHERE id = ${c.m2}`)) as unknown as unknown[];
      expect(ton, "a robot already has the fresh machine's id — cannot reproduce the collision").toBeUndefined();
      const robotN = await taoRobot(tx, { id: c.m2, lineId: c.L1, stationId: c.S1a }); // robot id == machine m2's id, m2 is on line 2
      expect(robotN).toBe(c.m2);
      await taoLuat(tx, c.m2);
      const r = await chuyenDong(robotN);
      expect(r).toMatchObject({ ok: true, status: "done" });
      expect(H.jobs.get(robotN)).toEqual(["move"]);
      expect(await xemTruoc(robotN)).toMatchObject({ blocked: false, failClosed: false, maTuChoi: null, violations: [] });
      expect(await congEdge(tx, c, robotN)).toMatchObject({ mode: "real", verdicts: { interlock: "clear" } });
    });
  });

  it("R2 — robot at station S1a: a rule on a machine of S1a ⇒ blocked at all 3 sites; a rule on S1b's machine (same line, other station) ⇒ not blocked", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const rTram = await taoRobot(tx, { lineId: c.L1, stationId: c.S1a });
      const luatKhac = await taoLuat(tx, c.mB);
      expect(await chuyenDong(rTram)).toMatchObject({ ok: true, status: "done" });
      expect(await xemTruoc(rTram)).toMatchObject({ blocked: false, violations: [] });
      expect(await congEdge(tx, c, rTram)).toMatchObject({ verdicts: { interlock: "clear" } });
      expect(luatKhac).toBeGreaterThan(0);

      const luat = await taoLuat(tx, c.mA2);
      const r = await chuyenDong(rTram);
      expect(r).toMatchObject({ ok: false, status: "rejected", error: "INTERLOCK_BLOCKED" });
      expect(H.jobs.get(rTram)).toEqual(["move"]); // only the first (clear) motion reached the driver
      const p = await xemTruoc(rTram);
      expect(p).toMatchObject({ blocked: true, failClosed: false, maTuChoi: null, viTri: "tram" });
      expect(p.violations).toEqual([expect.objectContaining({ ruleId: luat, machineId: c.mA2, cungChuyen: false })]);
      expect(await congEdge(tx, c, rTram)).toEqual({ gate: "interlock", detail: `interlock rule(s) #${luat}` });
    });
  });

  it("R3 — line-level robot: a rule on ANY machine of its line ⇒ blocked at all 3 sites; the preview names that machine + same line; a rule on line 2 ⇒ not", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const rChuyen = await taoRobot(tx, { lineId: c.L1, stationId: null });
      await taoLuat(tx, c.m2); // other line
      expect(await chuyenDong(rChuyen)).toMatchObject({ ok: true, status: "done" });
      const luat = await taoLuat(tx, c.mB); // a machine of S1b — the robot may be at any station of line 1
      expect(await chuyenDong(rChuyen)).toMatchObject({ ok: false, status: "rejected", error: "INTERLOCK_BLOCKED" });
      const p = await xemTruoc(rChuyen);
      expect(p).toMatchObject({ blocked: true, viTri: "chuyen" });
      expect(p.violations).toEqual([expect.objectContaining({ ruleId: luat, machineId: c.mB, machineCode: expect.stringContaining("MB-"), cungChuyen: true })]);
      expect(await congEdge(tx, c, rChuyen)).toEqual({ gate: "interlock", detail: `interlock rule(s) #${luat}` });
    });
  });

  it("R4 — unplaced / dangling station / dangling line / contradictory ⇒ ROBOT_CHUA_DINH_VI for motion at all 3 sites (gate not consulted); the STOP goes out", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const robots = [
        await taoRobot(tx, { lineId: null, stationId: null }),
        await taoRobot(tx, { lineId: null, stationId: 2_000_000_011 }),
        await taoRobot(tx, { lineId: 2_000_000_012, stationId: null }),
        await taoRobot(tx, { lineId: c.L2, stationId: c.S1a }),
      ];
      for (const id of robots) {
        H.congHoi = 0;
        const r = await chuyenDong(id);
        expect(r).toMatchObject({ ok: false, status: "rejected", error: ROBOT_CHUA_DINH_VI });
        const p = await xemTruoc(id);
        expect(p).toMatchObject({ blocked: true, failClosed: false, maTuChoi: ROBOT_CHUA_DINH_VI, viTri: "chua_dinh_vi", violations: [] });
        const e = await congEdge(tx, c, id);
        expect(e).toMatchObject({ gate: "interlock", detail: expect.stringContaining(ROBOT_CHUA_DINH_VI) });
        expect(H.congHoi, "the gate is never consulted for an unplaced robot").toBe(0);
        const s = await dung(id);
        expect(s).toMatchObject({ ok: true, status: "done" });
        expect(H.jobs.get(id)).toEqual(["abort"]);
      }
      // the refusal is on the ledger with its own code
      const [row] = (await tx.execute(sql`SELECT result FROM robot_jobs WHERE "robotId" = ${robots[0]!} AND status = 'rejected' ORDER BY id DESC LIMIT 1`)) as unknown as Array<{ result: { reasonCode?: string } }>;
      expect(row?.result?.reasonCode).toBe(ROBOT_CHUA_DINH_VI);
    });
  });

  it("R5 — resolver lookup error ⇒ motion refused fail-closed (INTERLOCK_BLOCKED; preview failClosed; edge 'interlock'); the STOP goes out without a lookup", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const rTram = await taoRobot(tx, { lineId: c.L1, stationId: c.S1a });
      H.loiTraCuu = true;
      expect(await chuyenDong(rTram)).toMatchObject({ ok: false, status: "rejected", error: "INTERLOCK_BLOCKED" });
      expect(await xemTruoc(rTram)).toMatchObject({ blocked: true, failClosed: true, maTuChoi: null });
      expect(await congEdge(tx, c, rTram)).toMatchObject({ gate: "interlock", detail: expect.stringContaining("placement lookup error") });
      expect(H.congHoi).toBe(0);
      H.traCuu = 0;
      expect(await dung(rTram)).toMatchObject({ ok: true, status: "done" });
      expect(H.jobs.get(rTram)).toEqual(["abort"]);
      expect(H.traCuu).toBe(0);
    });
  });

  it("R8 (L-7) — a blocking rule on EVERY machine of the robot's line (+ an unplaced robot): abort / stop / e_stop reach the driver; resolver and gate never consulted", async () => {
    await trongGiaoDich(async (tx) => {
      const c = await taoCay(tx);
      const rChuyen = await taoRobot(tx, { lineId: c.L1, stationId: null });
      const rTram = await taoRobot(tx, { lineId: c.L1, stationId: c.S1a });
      const rKhong = await taoRobot(tx, { lineId: null, stationId: null });
      for (const m of [c.mA1, c.mA2, c.mB]) await taoLuat(tx, m);
      // the motion IS blocked (the environment is hostile) …
      expect(await chuyenDong(rChuyen)).toMatchObject({ error: "INTERLOCK_BLOCKED" });
      expect(await chuyenDong(rTram)).toMatchObject({ error: "INTERLOCK_BLOCKED" });
      expect(await chuyenDong(rKhong)).toMatchObject({ error: ROBOT_CHUA_DINH_VI });
      // … the STOP is not
      for (const id of [rChuyen, rTram, rKhong]) {
        for (const jt of ["abort", "stop", "e_stop"] as const) {
          H.traCuu = 0;
          H.congHoi = 0;
          const s = await dung(id, jt);
          expect(s, `${jt} on robot ${id}`).toMatchObject({ ok: true, status: "done" });
          expect(H.traCuu).toBe(0);
          expect(H.congHoi).toBe(0);
        }
        expect(H.jobs.get(id)).toEqual(["abort", "abort", "abort"]); // canonical abort, 3 times
      }
    });
  });
});
