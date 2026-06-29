/**
 * Doc 09 / Phase D4 — Robot (Techman) job-list adapter unit tests (vitest; no hardware).
 */
import { describe, it, expect } from "vitest";
import { RobotTmAdapter } from "./robotTmAdapter";
import { programmingRegistry } from "../programmingAdapter";

const JOB = `POINT P1 = (100,0,200,180,0,0)
POINT P2 = (100,50,80,180,0,0)
HOME
MOVE P1
GRIP
MOVEL P2
WAIT t=500
RELEASE
HOME`;

describe("RobotTmAdapter.validate", () => {
  const a = new RobotTmAdapter();

  it("empty → error", async () => {
    expect((await a.validate({ kind: "robot-tm", language: "tmscript", content: "" })).ok).toBe(false);
  });

  it("unknown verb → error", async () => {
    const r = await a.validate({ kind: "robot-tm", language: "tmscript", content: "FLY P1" });
    expect(r.ok).toBe(false);
  });

  it("move to undefined point → error", async () => {
    const r = await a.validate({ kind: "robot-tm", language: "tmscript", content: "MOVE P9" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => /undefined point/.test(d.message))).toBe(true);
  });

  it("valid job → ok", async () => {
    const r = await a.validate({ kind: "robot-tm", language: "tmscript", content: JOB });
    expect(r.ok).toBe(true);
  });
});

describe("RobotTmAdapter.compile + simulate", () => {
  const a = new RobotTmAdapter();

  it("compile: job descriptor with steps + points", async () => {
    const b = await a.compile({ kind: "robot-tm", language: "tmscript", content: JOB });
    expect(b.ok).toBe(true);
    expect(b.outputRef).toContain("tm://job/");
    expect(b.meta?.points).toBe(2);
    expect(b.meta?.steps).toBe(7); // HOME, MOVE P1, GRIP, MOVEL P2, WAIT, RELEASE, HOME
  });

  it("simulate: motion + wait timeline; WAIT honours t=", async () => {
    const b = await a.compile({ kind: "robot-tm", language: "tmscript", content: JOB });
    const sim = await a.simulate(b, {});
    expect(sim.timeline.some((s) => s.note === "motion")).toBe(true);
    const wait = sim.timeline.find((s) => s.label.startsWith("WAIT"));
    expect(wait && wait.endMs - wait.startMs).toBe(500);
  });
});

describe("RobotTmAdapter.deploy (honest guard) + registry", () => {
  it("deploy → failed (download path not wired)", async () => {
    const a = new RobotTmAdapter();
    const r = await a.deploy({ ok: true, diagnostics: [] }, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "x", requestedBy: 1 } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("registry: robot-tm implemented + canTeach", () => {
    expect(programmingRegistry.isImplemented("robot-tm")).toBe(true);
    expect(programmingRegistry.getAdapter("robot-tm").capabilities.canTeach).toBe(true);
  });
});
