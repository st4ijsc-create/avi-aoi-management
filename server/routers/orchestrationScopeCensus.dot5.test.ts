/**
 * doc 81 Đợt 5 task E2 fix (ruling R-5-d) — CENSUS of the orchestration factory scope: EVERY procedure / engine entry
 * point that takes a run id, a workflow id or a workflow ref applies the ONE scope check before doing anything.
 *
 * It counts, it does not trust a list: it reads the SOURCE of orchestrationRouter.ts, edgeRuntimeRouter.ts and the
 * exported functions of foeEngine.ts, finds each procedure / function, decides whether it takes an id (from its input
 * schema / parameters) and whether its body carries the scope check:
 *   • routers: `scopeOf(ctx.user)` in the body, or a call to a SCOPED engine entry with `toFoeUser(ctx.user)` (the engine
 *     resolves the scope from that user — fail-closed);
 *   • engine: `scopeFor(` / `definitionVisibleTo(` / `runVisibleTo(` / `scopeVerdict(` in the body.
 * Anything that takes an id without the check must be in ALLOW with a reason — otherwise RED. §3 proves the instrument
 * sees: a synthetic unscoped procedure / engine function is flagged by the SAME functions.
 * Behaviour (same NOT_FOUND for out-of-scope and missing ids) is measured on _test: orchestrationScope.dot5.db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** Engine entries that resolve + check the caller's scope themselves (from the FoeUser they are given). */
const SCOPED_ENGINE = ["deployWorkflow", "rollbackWorkflow", "startRun", "resumeRun", "abortRun"];
const TAKES_ID = /\b(runId|workflowId|workflowRef|id|ref)\s*:/;

/** procedure name → its source block (from `  name: xxxProcedure` to the next one at the same indent). */
export function proceduresOf(src: string): Array<{ name: string; block: string }> {
  const re = /^ {2}(\w+): (\w+)\b/gm;
  const hits = [...src.matchAll(re)].filter((m) => /Procedure$|^protectedProcedure$|^deployProcedure$/.test(m[2]));
  return hits.map((m, i) => ({ name: m[1], block: src.slice(m.index!, i + 1 < hits.length ? hits[i + 1].index! : src.length) }));
}

export function unscopedProcedures(src: string, allow: Record<string, string>): string[] {
  return proceduresOf(src)
    .filter(({ name, block }) => {
      const input = block.slice(block.indexOf(".input("), block.search(/\.(query|mutation)\(/));
      if (!TAKES_ID.test(input)) return false;
      const scoped =
        block.includes("scopeOf(ctx.user)") || SCOPED_ENGINE.some((f) => block.includes(`${f}(`) && block.includes("toFoeUser(ctx.user)"));
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
      const scoped = /\b(scopeFor|definitionVisibleTo|runVisibleTo|scopeVerdict)\(/.test(body);
      return !scoped && !(name in allow);
    })
    .map((e) => e.name);
}

const ALLOW_ROUTER: Record<string, string> = {};
const ALLOW_EDGE: Record<string, string> = {
  deleteNode: "takes an EDGE NODE id, not a run / workflow id (the node registry is not orchestration data)",
  heartbeat: "edge NODE heartbeat by node code — no run / workflow id",
  registerNode: "registers an edge NODE — no run / workflow id",
};
const ALLOW_ENGINE: Record<string, string> = {
  getRun: "internal read (no caller identity); every caller that serves a person checks first: orchestrationRouter.getRun, api/v1 GET /orchestration/runs/:id (runVisibleTo), qtRunner / edgeRuntime are system paths",
  autoResumeInterruptedRuns: "boot-time system sweep of runs interrupted by a restart (no caller); resumes them as the system user, whose decision never counts as an approval",
  runIdVisibleTo: "IS the shared check",
};

describe("doc 81 Đợt 5 E2 fix (R-5-d) — every orchestration id-taking entry point carries the scope check", () => {
  it("§1 orchestrationRouter: no id-taking procedure without the check", () => {
    const src = read("server/routers/orchestrationRouter.ts");
    const procs = proceduresOf(src).map((p) => p.name);
    // the instrument found the population (not an empty scan)
    expect(procs).toEqual(expect.arrayContaining(["getRun", "listRuns", "getWorkflow", "abortRun", "resumeRun", "deleteWorkflow", "duplicateWorkflow", "getVersion", "listVersions", "rollbackWorkflow", "simulate", "startRun", "deployWorkflow"]));
    expect(procs).toHaveLength(15); // 2026-10-10: a NEW procedure changes this pin ⇒ decide its scope, then re-pin
    expect(unscopedProcedures(src, ALLOW_ROUTER)).toEqual([]);
  });

  it("§1b edgeRuntimeRouter: run-taking procedures carry the check (node-only ones are allow-listed with a reason)", () => {
    const src = read("server/routers/edgeRuntimeRouter.ts");
    expect(proceduresOf(src).map((p) => p.name)).toEqual(expect.arrayContaining(["assignRun", "syncRunResult", "nodeStatus"]));
    expect(unscopedProcedures(src, ALLOW_EDGE)).toEqual([]);
  });

  it("§2 foeEngine: every exported entry taking a run / workflow id checks the scope (or is allow-listed with a reason)", () => {
    const src = read("server/services/orchestration/foe/foeEngine.ts");
    const names = engineEntries(src).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["startRun", "resumeRun", "abortRun", "rollbackWorkflow", "getRun"]));
    expect(unscopedEngineEntries(src, ALLOW_ENGINE)).toEqual([]);
  });

  it("§2b api/v1: every /orchestration and /edge route declares the key scope and passes it to the check", () => {
    const src = read("server/api/v1/router.ts");
    const routes = [...src.matchAll(/r\.(get|post)\(\s*"(\/(?:orchestration|edge)[^"]*)",([\s\S]*?)\n  \);/g)];
    expect(routes.map((m) => m[2]).sort()).toEqual(["/edge/sync", "/orchestration/runs", "/orchestration/runs/:id", "/orchestration/simulate", "/orchestration/workflows"]);
    for (const m of routes) {
      expect(m[3], m[2]).toContain("requireDeclaredTenantScope()");
      expect(m[3], m[2]).toContain("orchestrationScopeOf(req.apiPrincipal?.tenantScope)");
    }
  });

  it("§3 the instrument SEES: an unscoped procedure / engine entry is flagged (mutation of the census input)", () => {
    const leakyRouter = `export const r = router({
  peek: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ runId: z.number() }))
    .query(async ({ input }) => getRun(input.runId)),
  fine: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .query(async ({ input, ctx }) => runVisibleTo({ workflowId: 1 }, scopeOf(ctx.user))),
  noId: protectedProcedure
    .query(() => 1),
});`;
    expect(unscopedProcedures(leakyRouter, {})).toEqual(["peek"]);
    const leakyEngine = `export async function retryStep(runId: number, user: FoeUser): Promise<void> {
  await db();
}
export async function okOne(runId: number, user: FoeUser): Promise<void> {
  await runVisibleTo({ workflowId: 1 }, scopeFor(user, undefined));
}
`;
    expect(unscopedEngineEntries(leakyEngine, {})).toEqual(["retryStep"]);
  });
});
