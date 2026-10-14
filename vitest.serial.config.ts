/**
 * doc 81 Đợt 10 final fix wave residual — I-6 / MIN-5 (ruling R-10-bt): the SERIAL project.
 *
 * These suites change SHARED `_test` state for minutes and must never run beside the others:
 *   • the two-process E2E + attack suites (the F1 harness, __edgeE2eHarness.dot10.ts): its enabled, real-mapped safety-PLC row is —
 *     by design (R-4-c: a target whose scope cannot be resolved is guarded by EVERY enabled config) — in force for every
 *     unresolvable-scope target of another suite (measured: safetySimOnly.dot1c ×5 `acked` instead of SAFETY_SIM_ONLY), and the
 *     seed SIM-SAFETY-PLC-1 is off while they run;
 *   • the seed-guard census (safetySeedIntact) — it toggles that seed;
 *   • edgeControlSchema.dot10.db — its apply-script re-run (DDL) deadlocks under parallel DB load (14/14 alone).
 * The default config (vitest.config.ts) EXCLUDES exactly this list; this config runs exactly it, ONE FILE AT A TIME.
 * `npm test` = the default run only; `npm run test:serial` = this project; `npm run test:all` = both (scripts/test-all.mjs: the
 * serial run goes even if the default one fails; non-zero if either failed). A single serial file:
 *     npx vitest run --config vitest.serial.config.ts server/services/edge/edgeAttack.dot10.e2e.db.test.ts
 */
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export const SERIAL_SUITES = [
  "server/services/edge/edgeExecution.dot10.e2e.db.test.ts",
  "server/services/edge/edgeAttack.dot10.e2e.db.test.ts",
  "server/services/edge/edgeExecution.s3.dot9.db.test.ts",
  "server/services/edge/edgeExecution.s4.e2e.dot9.db.test.ts",
  "server/services/edge/safetySeedIntact.finalfix.dot10.db.test.ts",
  "server/services/edge/edgeControlSchema.dot10.db.test.ts",
  "server/services/edge/edgeSimRobotLock.dot12.e2e.db.test.ts", // doc 81 Dot 12 task N (the F1 harness)
] as const;

// one file at a time, each in its own fork (NOT singleFork: vitest.setup derives the _test URL from the process env per file)
const merged = mergeConfig(base, defineConfig({ test: { fileParallelism: false } }));
// include / exclude are REPLACED (not merged): exactly the serial list, nothing excluded from it
export default {
  ...merged,
  test: { ...merged.test, include: [...SERIAL_SUITES], exclude: ["**/node_modules/**", "**/dist/**"] },
};
