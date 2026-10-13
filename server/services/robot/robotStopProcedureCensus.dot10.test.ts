/**
 * doc 81 Đợt 10 task D fix review 6 — NF5-6 (R-10-bb hardening). `robotStopProcedure` carries the STOP-only degraded auth (memory-
 * based when the DB does not answer) and the census exemption in three `_core` auth censuses is per FILE. This census pins, by
 * STRUCTURE (the middleware function object in each procedure's chain — not a name list):
 *   • robot.consoleStop is the ONLY procedure on the whole appRouter whose chain carries the STOP-only auth middleware;
 *   • STOP_ONLY_PATHS (the context's bounded branch) is exactly that set;
 *   • the only production files that mention `robotStopProcedure` are its definition and robotRouter;
 *   • the middleware itself refuses a non-STOP verb (robotStopDegradedAuth.dot10.db pins it through the real chain).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { appRouter } from "../../routers";
import { publicProcedure } from "../../_core/trpc";
import { robotStopProcedure, STOP_ONLY_VERBS } from "./robotStopAuth";
import { STOP_ONLY_PATHS } from "./robotStopAuthMemo";

const mw = (p: unknown) => ((p as { _def?: { middlewares?: unknown[] } })._def?.middlewares ?? []) as unknown[];
const base = new Set(mw(publicProcedure));
const STOP_MW = mw(robotStopProcedure).filter((m) => !base.has(m));
const PROCS = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;

describe("NF5-6 — robot.consoleStop is the ONLY user of the STOP-only procedure", () => {
  it("fuse: the STOP-only middlewares are found and the router is large", () => {
    expect(STOP_MW.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(PROCS).length).toBeGreaterThan(2000);
  });

  it("★ ∀ procedures of appRouter: only robot.consoleStop carries the STOP-only auth middleware", () => {
    const users = Object.keys(PROCS).filter((path) => mw(PROCS[path]).some((m) => STOP_MW.includes(m)));
    expect(users).toEqual(["robot.consoleStop"]);
  });

  it("★ STOP_ONLY_PATHS (createContext's bounded branch) is exactly that set; the verbs are stop / abort", () => {
    expect([...STOP_ONLY_PATHS]).toEqual(["robot.consoleStop"]);
    expect([...STOP_ONLY_VERBS].sort()).toEqual(["abort", "stop"]);
  });

  it("★ only robotStopAuth.ts (definition) and robotRouter.ts mention robotStopProcedure in production code", () => {
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (n === "node_modules") continue;
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && readFileSync(f, "utf8").includes("robotStopProcedure")) hits.push(relative(root, f).replace(/\\/g, "/"));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(["routers/robotRouter.ts", "services/robot/robotStopAuth.ts"]);
  });
});
