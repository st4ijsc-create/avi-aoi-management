/**
 * Doc 09 / Phase D2 — Zmotion BASIC adapter unit tests (vitest; no hardware).
 *
 * Covers the REAL parts (validate/compile/simulate) + the honest deploy guard:
 *   • validate: empty → error; no-motion → warning; unbalanced blocks → error; ok program.
 *   • compile: ok build with a zmc:// outputRef + move/op meta.
 *   • simulate: a motion timeline whose move steps dominate the duration.
 *   • deploy: no endpoint → 'failed' (never a fake success), non-crashing.
 *   • registry: zmotion-basic is now implemented + advertises canDownload/Monitor.
 */
import { describe, it, expect } from "vitest";
import { ZmotionBasicAdapter } from "./zmotionBasicAdapter";
import { programmingRegistry } from "../programmingAdapter";

const MOTION = `BASE(0,1)
ATYPE = 1,1
UNITS = 100,100
SPEED = 200,200
MOVEABS(100,50)
MOVE(20,0)
WAIT IDLE
PRINT "done"`;

describe("ZmotionBasicAdapter.validate", () => {
  const a = new ZmotionBasicAdapter();

  it("empty → error", async () => {
    const r = await a.validate({ kind: "zmotion-basic", language: "basic", content: "   " });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("no motion op → warning (but still ok)", async () => {
    const r = await a.validate({ kind: "zmotion-basic", language: "basic", content: 'PRINT "hi"' });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  it("unbalanced IF/ENDIF → error", async () => {
    const r = await a.validate({ kind: "zmotion-basic", language: "basic", content: "IF IN(0)=1 THEN\nMOVE(10)" });
    expect(r.ok).toBe(false);
  });

  it("valid motion program → ok, no errors", async () => {
    const r = await a.validate({ kind: "zmotion-basic", language: "basic", content: MOTION });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });
});

describe("ZmotionBasicAdapter.compile + simulate", () => {
  const a = new ZmotionBasicAdapter();

  it("compile: ok with zmc:// ref + move meta", async () => {
    const b = await a.compile({ kind: "zmotion-basic", language: "basic", content: MOTION });
    expect(b.ok).toBe(true);
    expect(b.outputRef).toContain("zmc://build/");
    expect(b.meta?.moves).toBe(2); // MOVEABS + MOVE
  });

  it("simulate: motion timeline produced", async () => {
    const b = await a.compile({ kind: "zmotion-basic", language: "basic", content: MOTION });
    const sim = await a.simulate(b, {});
    expect(sim.ok).toBe(true);
    expect(sim.timeline.length).toBeGreaterThan(0);
    expect(sim.timeline.some((s) => s.note === "motion")).toBe(true);
    expect(sim.totalDurationMs).toBeGreaterThan(0);
  });
});

describe("ZmotionBasicAdapter.deploy (honest guard)", () => {
  it("no endpoint → failed, never a fake success", async () => {
    const a = new ZmotionBasicAdapter();
    const r = await a.deploy({ ok: true, diagnostics: [] }, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "x", requestedBy: 1 } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/endpoint/i);
  });
});

describe("registry", () => {
  it("zmotion-basic is implemented with download/monitor caps", () => {
    expect(programmingRegistry.isImplemented("zmotion-basic")).toBe(true);
    const a = programmingRegistry.getAdapter("zmotion-basic");
    expect(a.capabilities.canDownload).toBe(true);
    expect(a.capabilities.canOnlineMonitor).toBe(true);
  });
});
