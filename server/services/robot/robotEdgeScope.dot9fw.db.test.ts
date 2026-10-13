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
// Đợt 10 integration — counts DB-ingest calls (the edge must never make one); the real module is kept otherwise
const INGEST = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./robotIngest", async (importOriginal) => {
  const real = await importOriginal<typeof import("./robotIngest")>();
  return { ...real, ingestRobotState: async (...a: Parameters<typeof real.ingestRobotState>) => { INGEST.calls++; return real.ingestRobotState(...a); } };
});

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

  // Re-pinned 2026-10-13 (doc 81 Đợt 10 integration, ruling R-10-r). The Đợt 9 assertion here was "without a factory code both
  // factories' robots match the shared line code" — that IS the N3 defect the Đợt 10 D re-review cited (a scope with no factory
  // loaded another factory's robots). D (c68a0a573) made N3 literal: a scope WITHOUT its factory loads NOTHING (+ a warning) and
  // the SQL always filters on the factory. The second half (with the other factory's code ⇒ only that factory's robot) is kept.
  it("★ a line code shared by two factories: without a factory code NOTHING is loaded (N3, fail-closed); with it only that factory's", async () => {
    const { loadEnabledRobots } = await import("./robotAdapter");
    expect(mine(await loadEnabledRobots({ lineCodes: [`${DAU}-L1`], factoryCode: null }))).toEqual([]);
    expect(mine(await loadEnabledRobots({ lineCodes: [`${DAU}-L1`], factoryCode: "  " }))).toEqual([]);
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

// Adapted 2026-10-13 (doc 81 Đợt 10 integration). Đợt 10 E (e8de9a115) removed `edgeRobotStartOptions()` (env line / factory
// codes ⇒ a DB-scoped `startRobots({scope, ingest:false})`): a v2 edge has NO DB, its robots are the OWNED robots of the VERIFIED
// config snapshot (`startRobots({configRobots: runtimeRobotsFromConfig(cfg.robots), stateSink, attachLock})`). The two claims
// this test guarded are re-measured on the new API, not dropped:
//   (1) the edge's robot set is ITS node's only — now: exactly the enabled robots of its verified config; the env codes cannot
//       widen (or narrow) it, and no `scope` (DB load) is ever passed by the gateway;
//   (2) ingest is always off on the edge — now: robot state goes to the injected journal sink, the DB ingest is never called.
// (The not-provisioned ⇒ no robot case is edgeGatewayRobotStart.dot9fw; the full boot is edgeGatewayBoot.dot10.)
describe("Đợt 9 final wave F1 (re-measured for Đợt 10 v2) — the edge gateway starts its VERIFIED config's robots, ingest off", () => {
  const keys = ["EDGE_GATEWAY_LINE_CODES", "EDGE_GATEWAY_FACTORY_CODE", "ROBOT_GATEWAY_ENABLED"] as const;
  const saved: Record<string, string | undefined> = {};
  afterEach(async () => {
    const { stopRobots } = await import("./robotManager");
    await stopRobots();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("★ the gateway's ONLY startRobots call passes configRobots from the verified config — never a DB scope, never ingest, never the env codes", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("../edge/edgeGatewayRuntime.ts", import.meta.url)), "utf8");
    const calls = src.match(/\bstartRobots\(\{[^\n]*\}\)/g) ?? [];
    expect(calls).toEqual(["startRobots({ configRobots: runtimeRobotsFromConfig(cfg.robots), ...(await edgeRobotStartExtras(rt)) })"]);
    expect(src.match(/\bstartRobots\(/g)?.length, "every startRobots( call of the gateway is the one above").toBe(1);
    expect(src).not.toMatch(/EDGE_GATEWAY_LINE_CODES|EDGE_GATEWAY_FACTORY_CODE|loadEnabledRobots|ingest:\s*true/);
  });

  it("★ the robots are exactly the ENABLED robots of the config (env line / factory codes change nothing); their state goes to the sink, never the DB ingest", async () => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.EDGE_GATEWAY_LINE_CODES = "SOME-OTHER-LINE";
    process.env.EDGE_GATEWAY_FACTORY_CODE = "SOME-OTHER-FACTORY";
    process.env.ROBOT_GATEWAY_ENABLED = "true";
    INGEST.calls = 0;
    const { runtimeRobotsFromConfig } = await import("./robotAdapter");
    const row = (id: number, isEnabled: boolean) => ({ id, code: `cfg-${id}`, vendor: "sim", endpoint: `sim://${id}`, connectionOptions: null, pollIntervalMs: 1000, isEnabled });
    const rt = runtimeRobotsFromConfig([row(901, true), row(902, false), row(903, true)]);
    expect(rt.map((r) => r.id)).toEqual([901, 903]); // disabled config row ⇒ not a robot here; env codes irrelevant
    const st = { link: "connected", mode: "auto" } as never;
    const states: Array<[number, unknown]> = [];
    // the loader's driver is a stub (driverRegistry mock above): give each a minimal live driver, no motion lock
    for (const r of rt) {
      r.driver = {
        vendor: "sim",
        connect: async () => undefined,
        disconnect: async () => undefined,
        isConnected: () => true,
        subscribeState: async (cb: (s: unknown) => void) => {
          cb(st);
          return { close: async () => undefined };
        },
      } as never;
    }
    const { startRobots, getActiveRobot } = await import("./robotManager");
    expect(await startRobots({ configRobots: rt, stateSink: (robot, s) => states.push([robot.id, s]), attachLock: () => undefined })).toBe(true);
    expect([901, 902, 903].map((id) => getActiveRobot(id) != null)).toEqual([true, false, true]);
    expect(states.sort((a, b) => a[0] - b[0])).toEqual([[901, st], [903, st]]);
    expect(INGEST.calls, "ingest is always off on the edge").toBe(0);
  });
});
