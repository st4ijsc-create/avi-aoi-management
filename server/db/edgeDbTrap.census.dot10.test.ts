/**
 * doc 81 Đợt 10 task A fix review 1 (I2) — the edge-role DB trap covers EVERY postgres client construction under server/,
 * not only connection.ts's three pools.
 *
 * (1) CENSUS (a measuring instrument — fix what it counts, never hide a construction from it): every non-test file under
 *     server/ that imports the `postgres` driver as a VALUE (static, dynamic `import("postgres")`, require) is listed below
 *     with its number of constructions; every construction (`postgres(`, or the local binding the import was given) is
 *     preceded — after the previous construction — by an `edgeDbRefused(` call. A new raw construction, a new importing file
 *     or a removed guard fails here.
 * (2) BEHAVIOUR (driver mocked: a construction is OBSERVED, never a real connection): in an edge process each site constructs
 *     nothing and counts its accessor (default mode), or throws EdgeDbTrapError (EDGE_DB_TRAP=throw).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SERVER = path.resolve(__dirname, "..");
/** file (relative to server/) → number of client constructions. Adding a file / construction is a reviewed change. */
const KNOWN: Record<string, number> = {
  "db/connection.ts": 3,
  "db/timescale.ts": 1,
  "services/safety/plc/safetyPlcPollerLeader.ts": 1,
  "_core/workerLeader.ts": 1,
  "_core/healthProbes.ts": 1,
  "services/backupService.ts": 2,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    // test-support files are not product code: *.test.ts / *.spec.ts / *.testkit.ts / a "__"-prefixed fixture kit (e.g. the
    // Group B suites' __edgeCentralKit.dot10.ts — imported only by *.db.test.ts, never by server code)
    else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !/\.testkit\.ts$/.test(name) && !/\.d\.ts$/.test(name) && !name.startsWith("__")) out.push(p);
  }
  return out;
}

/** Census of one source text: the driver bindings it imports and, per construction, whether a guard precedes it. */
export function censusOf(src: string): { imports: boolean; constructions: Array<{ line: number; guarded: boolean }> } {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  const names = new Set<string>(["postgres"]);
  let imports = false;
  for (const m of code.matchAll(/import\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']postgres["']/g)) {
    imports = true;
    names.add(m[1]);
  }
  for (const m of code.matchAll(/\{\s*default\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*await\s+import\(\s*["']postgres["']\s*\)/g)) {
    imports = true;
    names.add(m[1]);
  }
  if (/import\(\s*["']postgres["']\s*\)|require\(\s*["']postgres["']\s*\)/.test(code)) imports = true;
  const sites: number[] = [];
  for (const n of names) for (const m of code.matchAll(new RegExp(`(?<![\\w$."'/])${n.replace(/\$/g, "\\$")}\\s*\\(`, "g"))) sites.push(m.index ?? 0);
  sites.sort((a, b) => a - b);
  const constructions: Array<{ line: number; guarded: boolean }> = [];
  let prev = 0;
  for (const at of sites) {
    const between = code.slice(prev, at);
    const line = code.slice(0, at).split("\n").length;
    const guardAt = between.lastIndexOf("edgeDbRefused(");
    const linesSinceGuard = guardAt < 0 ? Infinity : between.slice(guardAt).split("\n").length - 1;
    constructions.push({ line, guarded: guardAt >= 0 && linesSinceGuard <= 12 });
    prev = at + 1;
  }
  return { imports, constructions };
}

describe("edge DB trap — census of every postgres client construction under server/", () => {
  it("only the known files import the driver; each construction is preceded by edgeDbRefused(…)", () => {
    const found: Record<string, number> = {};
    const unguarded: string[] = [];
    for (const abs of walk(SERVER)) {
      const rel = path.relative(SERVER, abs).replace(/\\/g, "/");
      const c = censusOf(readFileSync(abs, "utf8"));
      if (!c.imports && c.constructions.length === 0) continue;
      if (!c.imports) continue; // a local function merely named like the driver, with no driver import
      found[rel] = c.constructions.length;
      for (const k of c.constructions) if (!k.guarded) unguarded.push(`${rel}:${k.line}`);
    }
    expect(found).toEqual(KNOWN);
    expect(unguarded).toEqual([]);
  });

  it("the census instrument itself: a raw / aliased / unguarded construction is caught; a guarded one passes", () => {
    expect(censusOf(`import postgres from "postgres";\nconst c = postgres(url);`).constructions).toEqual([{ line: 2, guarded: false }]);
    expect(censusOf(`import postgres from "postgres";\nif (edgeDbRefused("x")) return null;\nconst c = postgres(url);`).constructions).toEqual([{ line: 3, guarded: true }]);
    expect(censusOf(`const { default: pg } = await import("postgres");\nconst c = pg(url);`)).toEqual({ imports: true, constructions: [{ line: 2, guarded: false }] });
    // one guard never covers two constructions
    const two = censusOf(`import postgres from "postgres";\nif (edgeDbRefused("a")) return;\nconst a = postgres(u);\nconst b = postgres(u);`);
    expect(two.constructions.map((x) => x.guarded)).toEqual([true, false]);
    // a guard in a comment does not count
    expect(censusOf(`import postgres from "postgres";\n// edgeDbRefused("a")\nconst a = postgres(u);`).constructions[0].guarded).toBe(false);
    expect(censusOf(`import type postgres from "postgres";\nlet x: postgres.Sql;`).imports).toBe(false);
  });
});

// ── behaviour ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const constructed: string[] = [];
vi.mock("postgres", () => ({
  default: (url: string) => {
    constructed.push(url);
    const fake = Object.assign(async () => [], {
      end: async () => undefined,
      reserve: async () => Object.assign(async () => [{ locked: false }], { release: () => undefined }),
      options: { parsers: {}, serializers: {} },
    });
    return fake;
  },
}));
vi.mock("../queryMonitor", () => ({ instrumentPostgresClient: () => undefined }));

const ENV_KEYS = ["AVI_PROCESS_ROLE", "EDGE_DB_TRAP", "DATABASE_URL", "TSDB_URL"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  constructed.length = 0;
  process.env.DATABASE_URL = "postgresql://trap-probe:x@127.0.0.1:1/never_test";
  process.env.TSDB_URL = "postgresql://trap-probe:x@127.0.0.1:1/never_tsdb_test";
  process.env.AVI_PROCESS_ROLE = "edge";
  delete process.env.EDGE_DB_TRAP;
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});
const trap = () => import("./edgeDbTrap");

describe("edge DB trap — every raw site, in an edge process", () => {
  it("default mode: timescale / poller leader / worker leader / health ping / backup construct NOTHING and count their accessor", async () => {
    const ts = await import("./timescale");
    expect(ts.getTsdb()).toBeNull();
    expect(await ts.insertOtTelemetryRows([{} as never])).toBeNull(); // telemetryBus.persistRows ⇒ falls back to getDb ⇒ trapped too
    const leader = (await import("../services/safety/plc/safetyPlcPollerLeader")).pgPollerLeaderGate();
    expect(await leader.acquire()).toBe(false);
    const wl = await import("../_core/workerLeader");
    await expect(wl.acquireWorkerLeadership({ retryMs: 1 })).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    const hp = await import("../_core/healthProbes");
    expect(await hp.layNguonPingRieng()).toBeNull();
    const bk = await import("../services/backupService");
    await expect(bk.createPgDump({ databaseUrl: process.env.DATABASE_URL! })).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    await expect(bk.restoreFromBackup({ databaseUrl: process.env.DATABASE_URL!, filePath: "__none__" })).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    expect(constructed).toEqual([]);
    const stats = (await trap()).edgeDbTrapStats();
    expect(stats.byAccessor).toMatchObject({
      getTsdb: 2,
      safetyPlcPollerLeader: 1,
      workerLeader: 1,
      "healthProbes.ping": 1,
      "backupService.createPgDump": 1,
      "backupService.restoreFromBackup": 1,
    });
  });

  it("EDGE_DB_TRAP=throw: the sites throw EdgeDbTrapError (the poller leader stays NOT leader) and construct nothing", async () => {
    process.env.EDGE_DB_TRAP = "throw";
    const ts = await import("./timescale");
    expect(() => ts.getTsdb()).toThrow(expect.objectContaining({ code: "EDGE_DB_TRAP" }));
    const leader = (await import("../services/safety/plc/safetyPlcPollerLeader")).pgPollerLeaderGate();
    expect(await leader.acquire()).toBe(false);
    const hp = await import("../_core/healthProbes");
    await expect(hp.layNguonPingRieng()).rejects.toMatchObject({ code: "EDGE_DB_TRAP" });
    expect(constructed).toEqual([]);
    expect((await trap()).edgeDbTrapStats().byAccessor).toMatchObject({ getTsdb: 1, safetyPlcPollerLeader: 1, "healthProbes.ping": 1 });
  });

  it("a central process is unaffected: the same sites construct their client as before", async () => {
    delete process.env.AVI_PROCESS_ROLE;
    const ts = await import("./timescale");
    expect(ts.getTsdb()).not.toBeNull();
    const hp = await import("../_core/healthProbes");
    expect(await hp.layNguonPingRieng()).not.toBeNull();
    expect(constructed).toEqual([process.env.TSDB_URL, process.env.DATABASE_URL]);
    expect((await trap()).edgeDbTrapCount()).toBe(0);
    await hp.dongClientPing();
  });
});
