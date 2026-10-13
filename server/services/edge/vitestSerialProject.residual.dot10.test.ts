/**
 * doc 81 Đợt 10 final fix wave residual — I-6 / MIN-5 (ruling R-10-bt): the suites that change SHARED `_test` state for minutes
 * (the two-process E2E + attack suites through the F1 harness — its enabled, real-mapped safety-PLC row is, by design R-4-c, in
 * force for every UNRESOLVABLE-scope target, which is what made safetySimOnly.dot1c ×5 red beside it — the seed guard census, and
 * edgeControlSchema.dot10.db whose apply-script re-run deadlocks under parallel DDL load) never run in parallel with the others:
 *   • the default config (`vitest run`, `npm test` part 1) EXCLUDES them;
 *   • `vitest.serial.config.ts` runs exactly them, ONE FILE AT A TIME (fileParallelism false, one fork);
 *   • `npm test` runs both, one after the other.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import base from "../../../vitest.config";
import serial, { SERIAL_SUITES } from "../../../vitest.serial.config";

const ROOT = path.resolve(__dirname, "../../..");

describe("residual I-6 / MIN-5 — the shared-state suites run in a serial project", () => {
  it("★ the serial set: E2E + attack + adapted dot9 E2E + seed census + edgeControlSchema", () => {
    for (const f of [
      "server/services/edge/edgeExecution.dot10.e2e.db.test.ts",
      "server/services/edge/edgeAttack.dot10.e2e.db.test.ts",
      "server/services/edge/edgeExecution.s3.dot9.db.test.ts",
      "server/services/edge/edgeExecution.s4.e2e.dot9.db.test.ts",
      "server/services/edge/safetySeedIntact.finalfix.dot10.db.test.ts",
      "server/services/edge/edgeControlSchema.dot10.db.test.ts",
    ]) {
      expect(SERIAL_SUITES, f).toContain(f);
    }
  });
  it("★ the default config excludes every serial suite; the serial config includes only them, one file at a time", () => {
    const ex = (base.test?.exclude ?? []) as string[];
    for (const f of SERIAL_SUITES) expect(ex, f).toContain(f);
    expect(serial.test?.include).toEqual([...SERIAL_SUITES]);
    expect(serial.test?.fileParallelism).toBe(false);
    expect(serial.test?.exclude ?? []).not.toEqual(expect.arrayContaining([...SERIAL_SUITES]));
  });
  it("★ `npm test` runs the default run AND the serial run", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe("vitest run && vitest run --config vitest.serial.config.ts");
  });
});
