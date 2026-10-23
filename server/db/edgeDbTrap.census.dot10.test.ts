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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** the tree the census scans (DOT10_TRAP_ROOT: a mirror copy, for RED / mutation runs only) */
const SERVER = process.env.DOT10_TRAP_ROOT || path.resolve(__dirname, "..");
/** file (relative to server/) → number of client constructions. Adding a file / construction is a reviewed change. */
const KNOWN: Record<string, number> = {
  "db/connection.ts": 5, // + getNotifyClient (doc 81 Dot 12 task P fix 1, M-1: dedicated LISTEN/NOTIFY client) + openSessionClient (Đợt 8.0: phiên riêng cho advisory lock bầu chủ Luồng AI)
  "db/timescale.ts": 1,
  "services/safety/plc/safetyPlcPollerLeader.ts": 1,
  "_core/workerLeader.ts": 1,
  "_core/healthProbes.ts": 1,
  "services/backupService.ts": 2,
};

const isTestFile = (name: string) => /\.(test|spec)\.tsx?$/.test(name);
/** test-support by NAME: a "__"-prefixed fixture kit or *.testkit.ts — exempt ONLY while no product file imports it (fix review 3, N3) */
const isKitName = (name: string) => name.startsWith("__") || /\.testkit\.ts$/.test(name);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !isTestFile(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}
/** relative import / re-export specifiers of a source text, resolved to absolute .ts paths */
function importsOf(abs: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    const base = path.resolve(path.dirname(abs), m[1]);
    out.push(/\.ts$/.test(base) ? base : base.replace(/\.js$/, "") + ".ts", path.join(base, "index.ts"));
  }
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
const esc = (n: string) => n.replace(/\$/g, "\\$").replace(/\./g, "\\.");

/**
 * Census of one source text (fix review 3, N3 — hardened): every binding of the `postgres` driver (default, `{ default as x }`,
 * `* as ns` ⇒ ns(…) / ns.default(…), dynamic `{ default: x } = await import`, `(await import(…)).default`, `require`), every
 * re-export of it (forbidden: a re-export hides the driver from this census), and every drizzle-orm/postgres-js `drizzle(…)` that
 * is given a URL / config instead of an already-built client (drizzle then builds its own client). A construction is guarded only
 * by an `if (edgeDbRefused(…))` since the previous construction, within 12 lines — a bare `edgeDbRefused(…);` whose result is
 * ignored guards nothing.
 */
export function censusOf(src: string): { imports: boolean; reexports: boolean; constructions: Array<{ line: number; guarded: boolean }> } {
  const code = stripComments(src);
  const names = new Set<string>();
  let imports = false;
  const PG = `["']postgres["']`;
  const bind = (n: string) => {
    imports = true;
    names.add(n);
  };
  for (const m of code.matchAll(new RegExp(`import\\s+(?!type\\b)([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{[^}]*\\})?\\s*from\\s*${PG}`, "g"))) bind(m[1]);
  for (const m of code.matchAll(new RegExp(`import\\s+(?!type\\b)(?:[A-Za-z_$][\\w$]*\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*${PG}`, "g"))) {
    for (const part of m[1].split(",")) {
      const d = part.trim().match(/^(?:type\s+)?default\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (d && !/^type\s/.test(part.trim())) bind(d[1]);
    }
  }
  for (const m of code.matchAll(new RegExp(`import\\s+(?!type\\b)\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*${PG}`, "g"))) {
    bind(m[1]);
    bind(`${m[1]}.default`);
  }
  for (const m of code.matchAll(new RegExp(`\\{\\s*default\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*\\}\\s*=\\s*await\\s+import\\(\\s*${PG}\\s*\\)`, "g"))) bind(m[1]);
  for (const m of code.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\(\\s*await\\s+import\\(\\s*${PG}\\s*\\)\\s*\\)\\s*\\.default`, "g"))) bind(m[1]);
  for (const m of code.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*${PG}\\s*\\)`, "g"))) bind(m[1]);
  if (new RegExp(`import\\(\\s*${PG}\\s*\\)|require\\(\\s*${PG}\\s*\\)`).test(code)) imports = true;
  const reexports = new RegExp(`export\\s+(?:\\*|\\{[^}]*\\}|\\*\\s+as\\s+[\\w$]+)\\s*from\\s*${PG}`).test(code);
  const sites: number[] = [];
  for (const n of names) for (const m of code.matchAll(new RegExp(`(?<![\\w$."'/])${esc(n)}\\s*\\(`, "g"))) sites.push(m.index ?? 0);
  // drizzle-orm/postgres-js given a URL / config builds its OWN client
  const DZ = `["']drizzle-orm/postgres-js["']`;
  const drizzleNames = new Set<string>();
  for (const m of code.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*${DZ}`, "g"))) {
    for (const part of m[1].split(",")) {
      const d = part.trim().match(/^drizzle(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (d) drizzleNames.add(d[1] ?? "drizzle");
    }
  }
  for (const m of code.matchAll(new RegExp(`\\{\\s*drizzle(?:\\s*:\\s*([A-Za-z_$][\\w$]*))?\\s*\\}\\s*=\\s*await\\s+import\\(\\s*${DZ}\\s*\\)`, "g"))) drizzleNames.add(m[1] ?? "drizzle");
  for (const n of drizzleNames) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w$."'/])${esc(n)}\\s*\\(\\s*([^)]*)`, "g"))) {
      const arg = m[1].trim();
      const plainClient = /^[A-Za-z_$][\w$]*(\s*(,|$))/.test(arg) && !/url|uri|conn|config|options|env/i.test(arg.split(/[\s,]/)[0]);
      if (!plainClient) {
        imports = true;
        sites.push(m.index ?? 0);
      }
    }
  }
  sites.sort((a, b) => a - b);
  const constructions: Array<{ line: number; guarded: boolean }> = [];
  let prev = 0;
  for (const at of sites) {
    const between = code.slice(prev, at);
    const line = code.slice(0, at).split("\n").length;
    const guards = [...between.matchAll(/\bif\s*\(\s*edgeDbRefused\s*\(/g)];
    const guardAt = guards.length ? (guards[guards.length - 1].index ?? -1) : -1;
    const linesSinceGuard = guardAt < 0 ? Infinity : between.slice(guardAt).split("\n").length - 1;
    constructions.push({ line, guarded: guardAt >= 0 && linesSinceGuard <= 12 });
    prev = at + 1;
  }
  return { imports, reexports, constructions };
}

/** The whole census of a tree: per file construction count, unguarded sites, re-exports, kit files used by product code. */
export function trapCensus(root: string): { found: Record<string, number>; unguarded: string[]; reexports: string[] } {
  const files = walk(root);
  const product = new Set(files.filter((f) => !isKitName(path.basename(f))));
  // a kit imported by a product file IS product code (fix review 3, N3: the filename exemption cannot hide a real construction)
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of [...product]) {
      for (const dep of importsOf(f, readFileSync(f, "utf8"))) {
        if (files.includes(dep) && !product.has(dep)) {
          product.add(dep);
          grew = true;
        }
      }
    }
  }
  const found: Record<string, number> = {};
  const unguarded: string[] = [];
  const reexports: string[] = [];
  for (const abs of [...product].sort()) {
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    const c = censusOf(readFileSync(abs, "utf8"));
    if (c.reexports) reexports.push(rel);
    if (!c.imports) continue; // a local function merely named like the driver, with no driver import
    found[rel] = c.constructions.length;
    for (const k of c.constructions) if (!k.guarded) unguarded.push(`${rel}:${k.line}`);
  }
  return { found, unguarded, reexports };
}

describe("edge DB trap — census of every postgres client construction under server/", () => {
  it("only the known files import the driver; each construction is preceded by if (edgeDbRefused(…)); no re-export", () => {
    const c = trapCensus(SERVER);
    expect(c.found).toEqual(KNOWN);
    expect(c.unguarded).toEqual([]);
    expect(c.reexports).toEqual([]);
  });

  it("the census instrument itself: a raw / aliased / unguarded construction is caught; a guarded one passes", () => {
    expect(censusOf(`import postgres from "postgres";\nconst c = postgres(url);`).constructions).toEqual([{ line: 2, guarded: false }]);
    expect(censusOf(`import postgres from "postgres";\nif (edgeDbRefused("x")) return null;\nconst c = postgres(url);`).constructions).toEqual([{ line: 3, guarded: true }]);
    expect(censusOf(`const { default: pg } = await import("postgres");\nconst c = pg(url);`)).toMatchObject({ imports: true, constructions: [{ line: 2, guarded: false }] });
    // one guard never covers two constructions
    const two = censusOf(`import postgres from "postgres";\nif (edgeDbRefused("a")) return;\nconst a = postgres(u);\nconst b = postgres(u);`);
    expect(two.constructions.map((x) => x.guarded)).toEqual([true, false]);
    // a guard in a comment does not count
    expect(censusOf(`import postgres from "postgres";\n// if (edgeDbRefused("a")) return;\nconst a = postgres(u);`).constructions[0].guarded).toBe(false);
    expect(censusOf(`import type postgres from "postgres";\nlet x: postgres.Sql;`).imports).toBe(false);
  });

  it("★ fix review 3 (N3): each form the re-review listed turns the census RED", () => {
    const un = (src: string) => censusOf(src).constructions.filter((x) => !x.guarded).length;
    expect(un(`import * as pgNs from "postgres";\nconst c = pgNs.default(url);`)).toBe(1); // namespace import
    expect(un(`import * as pgNs from "postgres";\nconst c = pgNs(url);`)).toBe(1);
    expect(un(`import { default as pg } from "postgres";\nconst c = pg(url);`)).toBe(1); // { default as x }
    expect(un(`const pg = (await import("postgres")).default;\nconst c = pg(url);`)).toBe(1);
    expect(un(`const pg = require("postgres");\nconst c = pg(url);`)).toBe(1);
    expect(un(`import { drizzle } from "drizzle-orm/postgres-js";\nexport const db = drizzle(process.env.DATABASE_URL!);`)).toBe(1); // drizzle(url)
    expect(un(`import { drizzle as dz } from "drizzle-orm/postgres-js";\nexport const db = dz({ connection: url });`)).toBe(1);
    expect(un(`import { drizzle } from "drizzle-orm/postgres-js";\nconst db = drizzle(databaseUrl);`)).toBe(1);
    expect(un(`import { drizzle } from "drizzle-orm/postgres-js";\nconst db = drizzle(_client);`)).toBe(0); // an already-built client: not a construction
    expect(censusOf(`export { default as pg } from "postgres";`).reexports).toBe(true); // re-export
    expect(censusOf(`export * from "postgres";`).reexports).toBe(true);
    // a guard whose result is ignored guards nothing
    expect(un(`import postgres from "postgres";\nedgeDbRefused("x");\nconst c = postgres(url);`)).toBe(1);
  });

  it("★ fix review 3 (N3): a `__` / *.testkit.ts file is exempt only while no product file imports it; a re-export hides nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trap-census-"));
    try {
      mkdirSync(path.join(dir, "db"));
      writeFileSync(path.join(dir, "db", "__kit.ts"), `import postgres from "postgres";\nexport const c = postgres("x");\n`);
      writeFileSync(path.join(dir, "db", "real.testkit.ts"), `import postgres from "postgres";\nexport const c = postgres("x");\n`);
      expect(trapCensus(dir)).toEqual({ found: {}, unguarded: [], reexports: [] }); // kits nobody in product code imports
      writeFileSync(path.join(dir, "app.ts"), `import { c } from "./db/__kit";\nimport { c as d } from "./db/real.testkit";\nexport const x = [c, d];\n`);
      writeFileSync(path.join(dir, "reexp.ts"), `export { default as pg } from "postgres";\n`);
      const r = trapCensus(dir);
      expect(r.found).toEqual({ "db/__kit.ts": 1, "db/real.testkit.ts": 1 });
      expect(r.unguarded).toEqual(["db/__kit.ts:2", "db/real.testkit.ts:2"]);
      expect(r.reexports).toEqual(["reexp.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
