/**
 * doc 81 Đợt 10 task D fix review 3 — ruling R-10-am (from B): changeDeviceOwner hands a device ONLY to an edge node of the device's
 * own factory. Robot: COALESCE(its station's line, its own line) → workshop → factory; adapter: machine → station → line → workshop →
 * factory; compared with the node's factoryCode. NULL on either side ⇒ refused; the chain unreadable ⇒ refused (fail-closed). Back to
 * central is never gated by it. `_test` as avi_app, every case in a rolled-back transaction.
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any, breakFactoryRead: false, detached: [] as number[] }));
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(async () => {
      if (!H.tx) return actual.getDb();
      // the owner change runs as a savepoint of the test's transaction; optionally its factory-chain read FAILS (unreadable)
      const wrap = (t: any): any =>
        new Proxy(t, {
          get(target, k) {
            if (k === "execute")
              return async (q: any) => {
                if (H.breakFactoryRead && JSON.stringify(q?.queryChunks ?? "").includes("public.factories")) throw new Error("permission denied for table factories");
                return target.execute(q);
              };
            if (k === "transaction") return (fn: any) => target.transaction((sp: any) => fn(wrap(sp)));
            const v = Reflect.get(target, k);
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
      return wrap(H.tx);
    }),
  };
});
vi.mock("./robotManager", () => ({
  detachRobot: async (id: number) => (H.detached.push(id), true),
  attachRobot: async () => false,
  isCentralRobotGatewayOn: () => false,
  isRobotGatewayRunning: () => false,
  getActiveRobot: () => undefined,
  activeRobotIds: () => [],
}));
vi.mock("../ot/otManager", () => ({ detachOtAdapter: async (id: number) => (H.detached.push(id), true), attachOtAdapter: async () => false, isOtGatewayOn: () => false, isOtRunning: () => false }));

import { getDb } from "../../db/connection";
import { changeDeviceOwner } from "./deviceOwnershipService";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
const TAG = `D10F-${Date.now()}`;
class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx);
      } finally {
        H.tx = null;
        H.breakFactoryRead = false;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const id = async (tx: any, q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as Array<Record<string, any>>)[0].id);
let seq = 0;
async function chain(tx: any, s: string) {
  const f = await id(tx, sql`INSERT INTO factories (code, name) VALUES (${`${TAG}-F${s}`}, 'f') RETURNING id`);
  const w = await id(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`${TAG}-W${s}`}, 'w') RETURNING id`);
  const line = await id(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`${TAG}-L${s}`}, 'l') RETURNING id`);
  const station = await id(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`${TAG}-S${s}`}, 's') RETURNING id`);
  return { code: `${TAG}-F${s}`, line, station };
}
const node = (tx: any, factoryCode: string | null) => id(tx, sql`INSERT INTO edge_nodes (code, name, status, "factoryCode") VALUES (${`${TAG}-N${seq++}`}, 'n', 'offline', ${factoryCode}) RETURNING id`);
const robot = (tx: any, at: { lineId?: number | null; stationId?: number | null }) =>
  id(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${`${TAG}-R${seq++}`}, 'r', 'sim', 'sim://t', true, ${at.lineId ?? null}, ${at.stationId ?? null}) RETURNING id`);
async function adapter(tx: any, stationId: number | null) {
  let machineId: number | null = null;
  if (stationId != null) {
    const [{ t }] = (await tx.execute(sql`SELECT udt_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'machines' AND column_name = 'machineType'`)) as Array<{ t: string }>;
    const [{ v }] = (await tx.execute(sql`SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid WHERE ty.typname = ${t} ORDER BY e.enumsortorder LIMIT 1`)) as Array<{ v: string }>;
    machineId = await id(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${stationId}, ${`${TAG}-M${seq++}`}, 'm', ${v}::${sql.raw(`"${t}"`)}) RETURNING id`);
  }
  return id(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "machineId") VALUES (${`${TAG}-A${seq++}`}, 'a', 'stub', 'stub://t', ${machineId}) RETURNING id`);
}
const move = (kind: "robot" | "adapter", deviceId: number, to: number | null) => changeDeviceOwner({ kind, deviceId, toEdgeNodeId: to, actorUserId: 1, actorName: "test" });
const ownerOf = async (tx: any, kind: "robot" | "adapter", deviceId: number) =>
  ((await tx.execute(kind === "robot" ? sql`SELECT "edgeNodeId" FROM robots WHERE id = ${deviceId}` : sql`SELECT "edgeNodeId" FROM device_adapters WHERE id = ${deviceId}`)) as Array<Record<string, any>>)[0].edgeNodeId;

describe.skipIf(!onTest)("R-10-am — a device goes only to an edge node of its own factory (_test, rolled back)", () => {
  it("★ same factory ⇒ accepted (robot via its station's line, robot via its own line, adapter via machine → station)", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "a");
      const n = await node(tx, a.code);
      const r1 = await robot(tx, { stationId: a.station });
      const r2 = await robot(tx, { lineId: a.line });
      const ad = await adapter(tx, a.station);
      expect(await move("robot", r1, n)).toMatchObject({ ok: true, toEdgeNodeId: n });
      expect(await move("robot", r2, n)).toMatchObject({ ok: true });
      expect(await move("adapter", ad, n)).toMatchObject({ ok: true });
      expect(await ownerOf(tx, "adapter", ad)).toBe(n);
    });
  });

  it("★ different factory ⇒ refused, owner unchanged (the station's line WINS over the robot's own line)", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "b1");
      const b = await chain(tx, "b2");
      const nB = await node(tx, b.code);
      const r = await robot(tx, { stationId: a.station, lineId: b.line }); // its station is in factory A
      const ad = await adapter(tx, a.station);
      const rr = await move("robot", r, nB);
      expect(rr).toMatchObject({ ok: false, reason: "refused" });
      expect((rr as { detail: string }).detail).toMatch(/factory/);
      expect(await move("adapter", ad, nB)).toMatchObject({ ok: false, reason: "refused" });
      expect(await ownerOf(tx, "robot", r)).toBeNull();
      expect(await ownerOf(tx, "adapter", ad)).toBeNull();
    });
  });

  it("★ NULL on either side ⇒ refused: node without factoryCode; robot / adapter with no factory chain", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "c");
      const nNull = await node(tx, null);
      const nEmpty = await node(tx, "  ");
      const n = await node(tx, a.code);
      const placed = await robot(tx, { lineId: a.line });
      const unplaced = await robot(tx, {});
      const loose = await adapter(tx, null);
      expect(await move("robot", placed, nNull)).toMatchObject({ ok: false, reason: "refused" });
      expect(await move("robot", placed, nEmpty)).toMatchObject({ ok: false, reason: "refused" });
      expect(await move("robot", unplaced, n)).toMatchObject({ ok: false, reason: "refused" });
      expect(await move("adapter", loose, n)).toMatchObject({ ok: false, reason: "refused" });
      expect(await ownerOf(tx, "robot", placed)).toBeNull();
    });
  });

  it("★ the chain UNREADABLE ⇒ refused (fail-closed), owner unchanged; back to central is never gated", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "d");
      const n = await node(tx, a.code);
      const r = await robot(tx, { lineId: a.line });
      H.breakFactoryRead = true;
      const rr = await move("robot", r, n);
      expect(rr).toMatchObject({ ok: false, reason: "refused" });
      expect((rr as { detail: string }).detail).toMatch(/could not be read/);
      expect(await ownerOf(tx, "robot", r)).toBeNull();
      H.breakFactoryRead = false;
      expect(await move("robot", r, n)).toMatchObject({ ok: true });
      H.breakFactoryRead = true;
      expect(await move("robot", r, null)).toMatchObject({ ok: true, toEdgeNodeId: null }); // to central: no factory read at all
    });
  });
});
