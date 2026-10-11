/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — an EDGE gateway loads ONLY its node's robots (`_test`, real rows).
 *
 * Before: edgeGatewayRuntime started robotManager.startRobots() → loadEnabledRobots() = every enabled robot of the control
 * plane (cross-factory included). Now the edge passes its scope (EDGE_GATEWAY_LINE_CODES + EDGE_GATEWAY_FACTORY_CODE):
 *   • a robot on one of the node's lines (robots.lineId), or on a station of one (stations.lineId) ⇒ loaded;
 *   • another line, the same line code in ANOTHER factory, disabled, or no line binding at all ⇒ not loaded;
 *   • no line codes configured ⇒ NOTHING (fail-closed);
 *   • central (no scope) ⇒ every enabled robot, as before.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import postgres from "postgres";

// the loader only BUILDS a driver per row (never connects); a stub keeps the sim vendor out of the registry question
vi.mock("./driverRegistry", () => ({ createRobotDriver: () => ({ vendor: "sim" }) }));

const DB_URL = process.env.DATABASE_URL;
const DAU = `FW1-${Date.now()}`;
const ids: Record<string, number> = {};
const robotIds: number[] = [];
let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("Đợt 9 final wave F1 — the edge's robot set is its node's lines only (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const fac = async (code: string) => Number((await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`)[0].id);
    ids.facA = await fac(`${DAU}-FA`);
    ids.facB = await fac(`${DAU}-FB`);
    const ws = async (f: number, code: string) => Number((await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${code}, ${code}) RETURNING id`)[0].id);
    ids.wsA = await ws(ids.facA, `${DAU}-WA`);
    ids.wsB = await ws(ids.facB, `${DAU}-WB`);
    const line = async (w: number, code: string) => Number((await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${code}, ${code}) RETURNING id`)[0].id);
    ids.l1 = await line(ids.wsA, `${DAU}-L1`);
    ids.l2 = await line(ids.wsA, `${DAU}-L2`);
    ids.l1b = await line(ids.wsB, `${DAU}-L1`); // the SAME line code in another factory
    ids.st1 = Number((await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.l1}, ${`${DAU}-S1`}, 's1') RETURNING id`)[0].id);
    const robot = async (tag: string, lineId: number | null, stationId: number | null, enabled = true) => {
      const id = Number(
        (await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${`${DAU}-${tag}`}, ${tag}, 'sim', 'sim://local', ${enabled}, ${lineId}, ${stationId}) RETURNING id`)[0].id,
      );
      robotIds.push(id);
      ids[tag] = id;
    };
    await robot("onLine", ids.l1, null);
    await robot("onStation", null, ids.st1);
    await robot("otherLine", ids.l2, null);
    await robot("otherFactory", ids.l1b, null);
    await robot("disabled", ids.l1, null, false);
    await robot("unbound", null, null);
  }, 60_000);

  afterAll(async () => {
    if (robotIds.length) await sql`DELETE FROM robots WHERE id IN ${sql(robotIds)}`;
    if (ids.st1) await sql`DELETE FROM stations WHERE id = ${ids.st1}`;
    for (const l of [ids.l1, ids.l2, ids.l1b].filter(Boolean)) await sql`DELETE FROM production_lines WHERE id = ${l}`;
    for (const w of [ids.wsA, ids.wsB].filter(Boolean)) await sql`DELETE FROM workshops WHERE id = ${w}`;
    for (const f of [ids.facA, ids.facB].filter(Boolean)) await sql`DELETE FROM factories WHERE id = ${f}`;
    await sql.end();
  }, 60_000);

  const mine = (rs: Array<{ id: number }>) => rs.map((r) => r.id).filter((id) => robotIds.includes(id)).sort((a, b) => a - b);
  const tags = (...t: string[]) => t.map((x) => ids[x]).sort((a, b) => a - b);

  it("★ node scope (its line + its factory) ⇒ the line's robots only (lineId or via its station); never another line / factory / disabled / unbound", async () => {
    const { loadEnabledRobots } = await import("./robotAdapter");
    const rs = await loadEnabledRobots({ lineCodes: [`${DAU}-L1`], factoryCode: `${DAU}-FA` });
    expect(mine(rs)).toEqual(tags("onLine", "onStation"));
  });

  it("★ a line code shared by two factories: without a factory code both lines' robots match the code; with it only the node's", async () => {
    const { loadEnabledRobots } = await import("./robotAdapter");
    expect(mine(await loadEnabledRobots({ lineCodes: [`${DAU}-L1`], factoryCode: null }))).toEqual(tags("onLine", "onStation", "otherFactory"));
    expect(mine(await loadEnabledRobots({ lineCodes: [`${DAU}-L1`], factoryCode: `${DAU}-FB` }))).toEqual(tags("otherFactory"));
  });

  it("★ no line codes configured ⇒ NO robot (fail-closed), whatever the factory", async () => {
    const { loadEnabledRobots } = await import("./robotAdapter");
    expect(await loadEnabledRobots({ lineCodes: [], factoryCode: `${DAU}-FA` })).toEqual([]);
    expect(await loadEnabledRobots({ lineCodes: ["  ", ""], factoryCode: null })).toEqual([]);
  });

  it("central (no scope) ⇒ every enabled robot, as before", async () => {
    const { loadEnabledRobots } = await import("./robotAdapter");
    expect(mine(await loadEnabledRobots())).toEqual(tags("onLine", "onStation", "otherLine", "otherFactory", "unbound"));
  });
});

describe("Đợt 9 final wave F1 — the edge gateway passes its own scope (env) and turns ingest off", () => {
  const keys = ["EDGE_GATEWAY_LINE_CODES", "EDGE_GATEWAY_FACTORY_CODE"] as const;
  const saved: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  it("EDGE_GATEWAY_LINE_CODES / _FACTORY_CODE ⇒ the scope; unset ⇒ no line codes (nothing loaded); ingest is always off on the edge", async () => {
    for (const k of keys) saved[k] = process.env[k];
    const { edgeRobotStartOptions } = await import("../edge/edgeGatewayRuntime");
    process.env.EDGE_GATEWAY_LINE_CODES = " L1, L2 ,";
    process.env.EDGE_GATEWAY_FACTORY_CODE = "F1";
    expect(edgeRobotStartOptions()).toEqual({ scope: { lineCodes: ["L1", "L2"], factoryCode: "F1" }, ingest: false });
    delete process.env.EDGE_GATEWAY_LINE_CODES;
    delete process.env.EDGE_GATEWAY_FACTORY_CODE;
    expect(edgeRobotStartOptions()).toEqual({ scope: { lineCodes: [], factoryCode: null }, ingest: false });
  });
});
