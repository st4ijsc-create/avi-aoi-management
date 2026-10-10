/**
 * doc 81 Đợt 5 task E2 fix (ruling R-5-d) + E fix 1 (review #4) — CENSUS of the orchestration factory scope.
 *
 * The POPULATION is found MECHANICALLY, not from a hand list: every non-test `.ts` file under `server/` that imports an
 * orchestration table (`orchestrationRuns` / `orchestrationWorkflows` / `orchestrationRunSteps` / `orchestrationRunEvents`
 * / `orchestrationWorkflowVersions`) or a module that reaches runs by id (`foeEngine`, `runEventStore`,
 * `engineeringAssignment/assignmentService`, `edge/edgeCoordinator`) — static or dynamic import. The population is PINNED:
 * a new file changes the pin, and the file must be classified below before the pin is updated.
 *
 * Every file of the population is either
 *   • a tRPC ROUTER: every procedure whose input takes an id (runId / workflowId / workflowRef / entityId / id / ref /
 *     entityIds) must pass the caller's scope into a call (`scopeOf(ctx.user)` / `foeScopeOf(ctx.user)` / a scoped engine
 *     entry with `toFoeUser(ctx.user)`), or be allow-listed with a reason; plus per-file REQUIRED USAGES (e.g. the
 *     oversight hub passes the scope into BOTH its run queries);
 *   • the API v1 router: every /orchestration + /edge route declares the key scope and passes it to the check;
 *   • the engine: every exported entry taking a run / workflow id checks the scope (§2);
 *   • a scoped-by-parameter service: its run readers take the scope parameter (required usages);
 *   • or ALLOW-listed with a reason (system paths, the stores whose readers are checked here, fixtures).
 * §3 proves the instrument sees (synthetic leaks are flagged). Behaviour (identical NOT_FOUND, filtered counts) is
 * measured on _test: orchestrationScope.dot5.db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const TABLES = /\b(orchestrationRuns|orchestrationWorkflows|orchestrationRunSteps|orchestrationRunEvents|orchestrationWorkflowVersions)\b/;
const RUN_MODULES = /(foe\/foeEngine|\.\/foeEngine|runEventStore|engineeringAssignment\/assignmentService|edge\/edgeCoordinator)$/;

/** Source with comments removed (line + block) — raw-SQL table names in comments are not readers. */
export function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Raw-SQL / string use of an orchestration table name (E fix 2, review N5). */
const RAW_TABLES = /\borchestration_(runs|workflows|run_steps|run_events|workflow_versions)\b/;

export function importsOrchestration(src: string): boolean {
  // named (+ optional default) imports, single OR double quotes — E fix 2 (review N5)
  for (const m of src.matchAll(/import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    if (TABLES.test(m[1]) || RUN_MODULES.test(m[2])) return true;
  }
  // namespace imports: of a run module, or of any module whose namespace is used for an orchestration table
  for (const m of src.matchAll(/import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s+["']([^"']+)["']/g)) {
    if (RUN_MODULES.test(m[2])) return true;
    if (new RegExp(`\\b${m[1]}\\.(orchestrationRuns|orchestrationWorkflows|orchestrationRunSteps|orchestrationRunEvents|orchestrationWorkflowVersions)\\b`).test(src)) return true;
  }
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) if (RUN_MODULES.test(m[1])) return true;
  // raw SQL / string table names outside comments
  if (RAW_TABLES.test(withoutComments(src))) return true;
  return false;
}

function population(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "node_modules") walk(p);
      } else if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts") && !/\.(__mut__|zzmut\w*)\.ts$/.test(f)) {
        // ↑ E fix 2 — transient untracked MUTANT copies (`*.__mut__.ts`, `*.zzmut*.ts`) are never product code
        if (importsOrchestration(readFileSync(p, "utf8"))) out.push(relative(ROOT, p).split("\\").join("/"));
      }
    }
  };
  walk(join(ROOT, "server"));
  return out.sort();
}

/** Engine entries that resolve + check the caller's scope themselves (from the FoeUser they are given). */
const SCOPED_ENGINE = ["deployWorkflow", "rollbackWorkflow", "startRun", "resumeRun", "abortRun"];
const TAKES_ID = /\b(runId|runIds|workflowId|workflowIds|workflowRef|entityId|entityIds|id|ids|ref)\s*:/; // + bulk inputs (E fix 2, N5)
const SCOPE_IN_CALL = /\((?:[^()]|\([^()]*\))*\b(scopeOf|foeScopeOf)\(\s*ctx\.user\s*\)/;

/** procedure name → its source block (from `  name: xxxProcedure` to the next one at the same indent). */
export function proceduresOf(src: string): Array<{ name: string; block: string }> {
  const re = /^ {2}(\w+): (\w+)\b/gm;
  const hits = [...src.matchAll(re)].filter((m) => /Procedure$/.test(m[2]));
  return hits.map((m, i) => ({ name: m[1], block: src.slice(m.index!, i + 1 < hits.length ? hits[i + 1].index! : src.length) }));
}

export function unscopedProcedures(src: string, allow: Record<string, string>): string[] {
  return proceduresOf(src)
    .filter(({ name, block }) => {
      const cut = block.search(/\.(query|mutation)\(/);
      const input = cut > 0 ? block.slice(block.indexOf(".input("), cut) : "";
      if (!TAKES_ID.test(input)) return false;
      const v = /const (\w+) = (?:scopeOf|foeScopeOf)\(\s*ctx\.user\s*\)/.exec(block);
      const viaVar = !!v && new RegExp(`\\w\\([^;]*\\b${v[1]}\\)`).test(block.slice(v.index + v[0].length));
      const scoped =
        SCOPE_IN_CALL.test(block) || viaVar || SCOPED_ENGINE.some((f) => block.includes(`${f}(`) && block.includes("toFoeUser(ctx.user)"));
      return !scoped && !(name in allow);
    })
    .map((p) => p.name);
}

/** exported async functions of the engine: name, parameter list, body. */
export function engineEntries(src: string): Array<{ name: string; params: string; body: string }> {
  const re = /^export async function (\w+)(?:<[^>]*>)?\(([\s\S]*?)\):[^{]*\{/gm;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({
    name: m[1],
    params: m[2],
    body: src.slice(m.index! + m[0].length, i + 1 < hits.length ? hits[i + 1].index! : src.length),
  }));
}

export function unscopedEngineEntries(src: string, allow: Record<string, string>): string[] {
  return engineEntries(src)
    .filter(({ name, params, body }) => {
      if (!/\b(runId|workflowId|workflowRef|runIds)\b/.test(params)) return false;
      const scoped = /\b(scopeFor|definitionVisibleTo|runVisibleTo|scopeVerdict|boundedRunScopeDecision|filterRunsVisibleTo)\(/.test(body);
      return !scoped && !(name in allow);
    })
    .map((e) => e.name);
}

type Kind =
  | { kind: "router"; allow?: Record<string, string>; requires?: RegExp[] }
  | { kind: "api" }
  | { kind: "engine" }
  | { kind: "service"; requires: RegExp[] }
  | { kind: "allow"; reason: string };

/** ★ The classified population. A file found by the scan but missing here ⇒ RED (classify it first). */
const CLASSIFIED: Record<string, Kind> = {
  "server/_core/index.ts": { kind: "allow", reason: "boot only: rehydrateInterruptedRuns / QT template registration (system principal, no caller identity, no run id from a caller)" },
  "server/api/v1/router.ts": { kind: "api" },
  "server/routers/edgeRuntimeRouter.ts": {
    kind: "router",
    allow: {
      deleteNode: "takes an EDGE NODE id, not a run / workflow id",
      heartbeat: "edge NODE heartbeat by node code — no run / workflow id",
      registerNode: "registers an edge NODE — no run / workflow id",
    },
    requires: [/filterRunsVisibleTo\(await listRunsForNode\(node\.id\), scopeOf\(ctx\.user\)\)/],
  },
  "server/routers/engineeringAssignmentRouter.ts": {
    kind: "router",
    requires: [/runIdVisibleTo\(input\.entityId, foeScopeOf\(ctx\.user\)\)/, /visibleRunIds\(ids, foeScopeOf\(ctx\.user\)\)/],
  },
  "server/routers/orchestrationGovRouter.ts": {
    kind: "router",
    allow: {
      validateDag: "`id` of DAG NODES in the request body (a pure check over caller data), not a run / workflow id",
      orderQueue: "`id` of queue TASKS in the request body (pure ordering of caller data), not a run / workflow id",
    },
  },
  "server/routers/orchestrationRouter.ts": { kind: "router" },
  "server/routers/oversightRouter.ts": {
    kind: "router",
    requires: [
      /resolveVisibleWorkflowIds\(resolveUserFoeScope\(\{ id: ctx\.user\.id/,
      /orchScope\.ok \? fetchOrchestrationHeld\(d, orchestrationWorkflowIds\)/,
      /orchestrationWorkflowIds, \/\/ E fix 1/,
    ],
  },
  "server/services/edge/edgeCoordinator.ts": { kind: "allow", reason: "service: run-id entries (assignRun / syncRunResult / listRunsForNode) are reached only through edgeRuntimeRouter + api/v1 /edge/sync, both checked here" },
  "server/services/edge/edgeRuntime.ts": { kind: "allow", reason: "runs ON an edge host (no caller identity); executeAssignedRun has no production caller" },
  "server/services/engineeringAssignment/assignmentService.ts": {
    kind: "service",
    requires: [
      /export async function fetchMineSummary\([\s\S]*?orchestrationWorkflowIds: number\[\] \| null/,
      /export async function fetchMineCategory\([\s\S]*?orchestrationWorkflowIds: number\[\] \| null/,
      /\$\{runScopeSql\}/,
    ],
  },
  "server/services/orchestration/foe/__foeGateRunFixture.ts": { kind: "allow", reason: "test fixture (_test only), not imported by product code" },
  "server/services/orchestration/foe/foeEngine.ts": { kind: "engine" },
  "server/services/orchestration/foe/foeGateApproval.ts": { kind: "allow", reason: "dispatcher DB layer: reads the run named by an engine-written action inside the reservation tx (no caller-supplied id, no caller identity)" },
  "server/services/orchestration/runEventStore.ts": { kind: "allow", reason: "store; its readers (orchestrationGovRouter.runEvents / replayRun) are checked here" },
  "server/services/orchestration/templates/qtRunner.ts": { kind: "allow", reason: "system principal (QT_SYSTEM_USER): the engine resolves an EMPTY scope for it (fail-closed); no caller identity" },
  "server/services/orchestration/templates/qtStepHandlers.ts": { kind: "allow", reason: "QT step handlers run inside qtRunner (system path), read a workflow by a template ref" },
  "server/services/orchestration/templates/registerQtTemplates.ts": { kind: "allow", reason: "boot-time template registration as the system loader (EMPTY scope in the engine ⇒ only target-free definitions)" },
};

const ALLOW_ENGINE: Record<string, string> = {
  getRun: "internal read (no caller identity); every caller that serves a person checks first (orchestrationRouter.getRun, api/v1 GET /orchestration/runs/:id)",
  autoResumeInterruptedRuns: "boot-time system sweep of runs interrupted by a restart (no caller)",
  runIdVisibleTo: "IS the shared check",
  visibleRunIds: "IS the shared check (batch)",
};

describe("doc 81 Đợt 5 E2 fix (R-5-d) + E fix 1 — every orchestration id-taking entry point carries the scope check", () => {
  const POP = population();

  it("§0 the population is found mechanically and is PINNED (a new file ⇒ classify it, then re-pin)", () => {
    expect(POP).toEqual(Object.keys(CLASSIFIED).sort());
  });

  it("§1 routers: every id-taking procedure passes the caller's scope; required usages present", () => {
    const bad: string[] = [];
    for (const [file, k] of Object.entries(CLASSIFIED)) {
      if (k.kind !== "router") continue;
      const src = read(file);
      expect(proceduresOf(src).length, `${file}: no procedures found — the instrument is blind`).toBeGreaterThan(0);
      for (const p of unscopedProcedures(src, k.allow ?? {})) bad.push(`${file}#${p}`);
      for (const r of k.requires ?? []) if (!r.test(src)) bad.push(`${file} lacks ${r}`);
    }
    expect(bad).toEqual([]);
  });

  it("§1b scoped-by-parameter services carry the scope parameter into their run queries", () => {
    const bad: string[] = [];
    for (const [file, k] of Object.entries(CLASSIFIED)) {
      if (k.kind !== "service") continue;
      const src = read(file);
      for (const r of k.requires) if (!r.test(src)) bad.push(`${file} lacks ${r}`);
    }
    expect(bad).toEqual([]);
  });

  it("§2 foeEngine: every exported entry taking a run / workflow id checks the scope (or is allow-listed with a reason)", () => {
    const src = read("server/services/orchestration/foe/foeEngine.ts");
    const names = engineEntries(src).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["startRun", "resumeRun", "abortRun", "rollbackWorkflow", "getRun"]));
    expect(unscopedEngineEntries(src, ALLOW_ENGINE)).toEqual([]);
  });

  it("§2b api/v1: every /orchestration and /edge route declares the key scope and passes it to the check", () => {
    const src = read("server/api/v1/router.ts");
    const routes = [...src.matchAll(/r\.(get|post|put|patch|delete)\(\s*"(\/(?:orchestration|edge)[^"]*)",([\s\S]*?)\n  \);/g)];
    expect(routes.map((m) => m[2]).sort()).toEqual(["/edge/sync", "/orchestration/runs", "/orchestration/runs/:id", "/orchestration/simulate", "/orchestration/workflows"]);
    for (const m of routes) {
      expect(m[3], m[2]).toContain('requireDeclaredTenantScope("orchestration")');
      expect(m[3], m[2]).toMatch(/\w+\([^;]*orchestrationScopeOf\(req\.apiPrincipal\?\.tenantScope\)/);
    }
  });

  it("§4 the instrument would have caught the code BEFORE E fix 1 (base c13210e53, read from git — the tree is not touched)", () => {
    const BASE = "c13210e53";
    const at = (file: string) => {
      try {
        return execFileSync("git", ["show", `${BASE}:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, "\n");
      } catch {
        return null; // shallow clone without the base commit ⇒ nothing to replay
      }
    };
    const gov = at("server/routers/orchestrationGovRouter.ts");
    if (gov === null) return;
    const govK = CLASSIFIED["server/routers/orchestrationGovRouter.ts"] as Extract<Kind, { kind: "router" }>;
    expect(unscopedProcedures(gov, govK.allow ?? {})).toEqual(["runEvents", "replayRun"]);
    const ov = at("server/routers/oversightRouter.ts")!;
    const ovK = CLASSIFIED["server/routers/oversightRouter.ts"] as Extract<Kind, { kind: "router" }>;
    expect((ovK.requires ?? []).filter((r) => !r.test(ov)).length).toBe(3);
    const ear = at("server/routers/engineeringAssignmentRouter.ts")!;
    expect(importsOrchestration(ear)).toBe(true);
    expect(unscopedProcedures(ear, {})).toEqual(["assign", "unassign", "assignments"]);
    const svc = at("server/services/engineeringAssignment/assignmentService.ts")!;
    const svcK = CLASSIFIED["server/services/engineeringAssignment/assignmentService.ts"] as Extract<Kind, { kind: "service" }>;
    expect(svcK.requires.filter((r) => !r.test(svc)).length).toBe(3);
  });

  it("§3 the instrument SEES: an unscoped procedure / engine entry / new importing file is flagged", () => {
    const leakyRouter = `export const r = router({
  peek: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ runId: z.number() }))
    .query(async ({ input }) => loadRunEvents(input.runId)),
  fine: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ input, ctx }) => runIdVisibleTo(input.runId, scopeOf(ctx.user))),
  printsScope: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ input, ctx }) => { const s = scopeOf; return loadRunEvents(input.runId); }),
  viaVar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => { const scope = scopeOf(ctx.user); return getVersionScoped(input.id, scope); }),
  noId: protectedProcedure
    .query(() => 1),
});`;
    expect(unscopedProcedures(leakyRouter, {})).toEqual(["peek", "printsScope"]);
    const leakyEngine = `export async function retryStep(runId: number, user: FoeUser): Promise<void> {
  await db();
}
export async function okOne(runId: number, user: FoeUser): Promise<void> {
  await runVisibleTo({ workflowId: 1 }, scopeFor(user, undefined));
}
`;
    expect(unscopedEngineEntries(leakyEngine, {})).toEqual(["retryStep"]);
    expect(importsOrchestration(`import { orchestrationRuns } from "../../drizzle/schema";`)).toBe(true);
    expect(importsOrchestration(`const { getRun } = await import("../services/orchestration/foe/foeEngine");`)).toBe(true);
    expect(importsOrchestration(`import { machines } from "../../drizzle/schema";`)).toBe(false);
    // E fix 2 (review N5) — each shape the first version missed is now caught (fixtures):
    expect(importsOrchestration(`import * as schema from "../../drizzle/schema";\nconst r = await db.select().from(schema.orchestrationRuns);`)).toBe(true);
    expect(importsOrchestration(`import * as schema from "../../drizzle/schema";\nconst r = await db.select().from(schema.machines);`)).toBe(false);
    expect(importsOrchestration(`import * as eng from "../services/orchestration/foe/foeEngine";`)).toBe(true);
    expect(importsOrchestration(`import { orchestrationWorkflows } from '../../drizzle/schema';`)).toBe(true);
    expect(importsOrchestration(`import schemaDefault, { orchestrationRunSteps } from "../../drizzle/schema";`)).toBe(true);
    expect(importsOrchestration("const rows = await db.execute(sql`SELECT * FROM orchestration_runs WHERE id = ${id}`);")).toBe(true);
    expect(importsOrchestration("// reads orchestration_runs only in this comment\n/* and orchestration_workflows here */ const x = 1;")).toBe(false);
    const bulk = `export const r = router({
  bulk: protectedProcedure
    .input(z.object({ runIds: z.array(z.number()) }))
    .query(async ({ input }) => input.runIds),
  bulk2: protectedProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .query(async ({ input }) => input.ids),
});`;
    expect(unscopedProcedures(bulk, {})).toEqual(["bulk", "bulk2"]);
  });
});
