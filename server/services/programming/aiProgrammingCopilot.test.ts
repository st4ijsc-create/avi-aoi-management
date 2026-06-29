/**
 * Doc 09 / Phase D7 — AI Engineering Copilot unit tests (vitest).
 *
 * Covers HITL purity + safety refusal + validated suggestions + flag gate.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { suggestProgram, explainProgram, copilotEnabled } from "./aiProgrammingCopilot";

beforeEach(() => {
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
});

describe("aiProgrammingCopilot — gating + purity", () => {
  it("flag off → available:false", async () => {
    process.env.AI_PROGRAMMING_COPILOT_ENABLED = "false";
    expect(copilotEnabled()).toBe(false);
    const r = await suggestProgram({ kind: "zmotion-basic", intent: "move to home" });
    expect(r.available).toBe(false);
  });

  it("REFUSES safety intents (e-stop / interlock / SIL)", async () => {
    for (const intent of ["add an e-stop", "build the safety interlock", "SIL2 guard logic"]) {
      const r = await suggestProgram({ kind: "iec61131-ld", intent });
      expect(r.refused).toBe(true);
      expect(r.source).toBeUndefined();
    }
  });

  it("PURITY: the copilot module has no deploy/dispatch import", () => {
    const src = readFileSync(new URL("./aiProgrammingCopilot.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/deployBuild|commandDispatcher|robotCommandDispatcher|sendCommand|dispatchRobotJob/);
  });
});

describe("aiProgrammingCopilot — validated suggestions", () => {
  it("zmotion suggestion is valid through the real adapter", async () => {
    const r = await suggestProgram({ kind: "zmotion-basic", intent: "move axis 0 to origin" });
    expect(r.available).toBe(true);
    expect(r.refused).toBe(false);
    expect(r.source).toContain("MOVEABS");
    expect(r.valid).toBe(true); // validated via ZmotionBasicAdapter.validate
  });

  it("ladder suggestion is valid + uses bool rungs", async () => {
    const r = await suggestProgram({ kind: "iec61131-ld", intent: "seal-in start/stop" });
    expect(r.valid).toBe(true);
    expect(r.source).toMatch(/Y0 :=/);
  });

  it("robot suggestion defines points it references", async () => {
    const r = await suggestProgram({ kind: "robot-tm", intent: "pick and place" });
    expect(r.valid).toBe(true);
  });

  it("explainProgram returns deterministic metrics", () => {
    const r = explainProgram("zmotion-basic", "BASE(0)\nMOVEABS(10,0)\nMOVE(5,0)");
    expect(r.available).toBe(true);
    expect(r.metrics.moves).toBe(2);
  });
});
