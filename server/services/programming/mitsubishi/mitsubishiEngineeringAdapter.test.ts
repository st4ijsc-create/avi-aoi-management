/**
 * Doc 09 / Phase D3 — Mitsubishi engineering adapter unit tests (vitest; no hardware).
 */
import { describe, it, expect } from "vitest";
import { MitsubishiEngineeringAdapter } from "./mitsubishiEngineeringAdapter";
import { programmingRegistry } from "../programmingAdapter";

const RECIPE = `D100 = 1234   ' set point
D101 = 50
M0 := TRUE
Y10 := FALSE`;

describe("MitsubishiEngineeringAdapter.validate", () => {
  const a = new MitsubishiEngineeringAdapter();

  it("empty → error", async () => {
    expect((await a.validate({ kind: "mitsubishi-engineering", language: "device", content: "" })).ok).toBe(false);
  });

  it("invalid device → error", async () => {
    const r = await a.validate({ kind: "mitsubishi-engineering", language: "device", content: "Q999 = 1" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => /Invalid MELSEC/.test(d.message))).toBe(true);
  });

  it("non-assignment line → error", async () => {
    const r = await a.validate({ kind: "mitsubishi-engineering", language: "device", content: "MOVE 1 2" });
    expect(r.ok).toBe(false);
  });

  it("valid recipe → ok", async () => {
    const r = await a.validate({ kind: "mitsubishi-engineering", language: "device", content: RECIPE });
    expect(r.ok).toBe(true);
  });
});

describe("MitsubishiEngineeringAdapter.compile + simulate", () => {
  const a = new MitsubishiEngineeringAdapter();

  it("compile: builds a device param map", async () => {
    const b = await a.compile({ kind: "mitsubishi-engineering", language: "device", content: RECIPE });
    expect(b.ok).toBe(true);
    expect(b.outputRef).toContain("melsec://recipe/");
    expect(b.meta?.devices).toBe(4);
    expect((b.meta?.paramMap as any).D100).toBe("1234");
  });

  it("simulate: one preview step per param", async () => {
    const b = await a.compile({ kind: "mitsubishi-engineering", language: "device", content: RECIPE });
    const sim = await a.simulate(b, {});
    expect(sim.timeline.length).toBe(4);
    expect(sim.timeline[0].note).toMatch(/param-write/);
  });
});

describe("MitsubishiEngineeringAdapter.deploy (honest guard) + registry", () => {
  it("deploy → failed (push path not wired), never fake success", async () => {
    const a = new MitsubishiEngineeringAdapter();
    const r = await a.deploy({ ok: true, diagnostics: [] }, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "x", requestedBy: 1 } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("registry: mitsubishi-engineering implemented", () => {
    expect(programmingRegistry.isImplemented("mitsubishi-engineering")).toBe(true);
  });
});
