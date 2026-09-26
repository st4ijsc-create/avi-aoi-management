/**
 * Doc 80 Đợt 0 — Task 5 (IR-01, defence layer 2 wiring): if the linter and the emitter
 * whitelist ever DRIFT (lint says ok, emitter refuses a token), the gated transpile must fail
 * CLOSED as a normal blocked build — ok:false, no code, a diagnostic — never a thrown 500.
 * The linter is mocked to "ok" to simulate that drift.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./irSafetyLinter", () => ({
  lintFlow: () => ({ ok: true, diagnostics: [] }),
}));

import { transpileFlow } from "./transpilers/registry";
import type { Flow } from "./irModel";

describe("IR-01 — registry converts an emitter refusal into a blocked build", () => {
  it("lint (mocked) passes a malicious signal ⇒ emitter throws ⇒ ok:false, no code, io-ref-invalid", () => {
    const flow: Flow = {
      flow_id: "drift", target_device_type: "universal-robots", version: 1,
      blocks: [{ id: "a", type: "set_output", signal: "1, True)\nmovel(p[0.9,0.9,0.1,0,0,0], a=40, v=3)\n#", value: true }],
    };
    for (const target of ["urscript", "ros2"] as const) {
      const res = transpileFlow(flow, target);
      expect(res.ok).toBe(false);
      expect(res.code).toBeUndefined();
      expect(res.diagnostics.some((d) => d.rule === "io-ref-invalid" && d.severity === "error")).toBe(true);
    }
  });
});
