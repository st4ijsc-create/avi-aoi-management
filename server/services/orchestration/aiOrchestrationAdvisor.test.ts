/**
 * Phase E5 — Factory Control Plane: AI-ASSISTED ORCHESTRATION ADVISOR tests.
 *
 * Covers (vitest; the GGUF engine is mocked so no model is needed):
 *   • suggestWorkflow returns a VALID + simulated WorkflowDefinition from a mocked
 *     generateJSON (validate + twin-simulate passed).
 *   • an INVALID model output → repair retry → still invalid → honest degrade
 *     (valid:false, message set), and the repair path WAS attempted.
 *   • a repairable output → first attempt invalid, second (repair) valid → valid:true.
 *   • optimizeWorkflow returns a revised valid def + a diff + a fresh simulation.
 *   • flag-off → disabled no-op (available:false, model NOT called).
 *   • NEVER imports/calls deploy/run (purity assertion on the module source).
 *   • fail-safe on AI error (generateJSON throws) → honest degrade, no throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Mock the GGUF engine. aiModelRouter imports ggufModelFileExists statically, and the
//    advisor dynamically imports generateJSON + isGgufAvailable — all controllable here. ──
const isGgufAvailable = vi.fn(async () => true);
const generateJSON = vi.fn();
const ggufModelFileExists = vi.fn(() => false);
vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateJSON: (...a: unknown[]) => generateJSON(...a),
  ggufModelFileExists: (...a: unknown[]) => ggufModelFileExists(...a),
}));

import {
  suggestWorkflow,
  optimizeWorkflow,
  advisorEnabled,
} from "./aiOrchestrationAdvisor";
import type { WorkflowDefinition } from "./foe/workflowModel";

const MACHINES = [
  { id: 1, machineType: "AOI", name: "AOI-1" },
  { id: 2, machineType: "AUTOMATION", name: "Conveyor" },
  { id: 3, machineType: "ROBOT", name: "Robot" },
];

/** A VALID workflow the model "returns": AOI start → robot run_job. start/run_job are real verbs. */
function validRaw() {
  return {
    ref: "ai-line-a",
    name: "AI proposed",
    rationale: "Coordinate AOI then robot sort.",
    steps: [
      { id: "s1", type: "command", machineId: 1, command: "start" },
      { id: "s2", type: "command", machineId: 3, command: "run_job", args: { jobType: "pick_place" } },
    ],
  };
}

/** An INVALID workflow: unknown command + bad machine reference. */
function invalidRaw() {
  return {
    ref: "ai-bad",
    name: "Bad",
    rationale: "nope",
    steps: [
      { id: "x1", type: "command", machineId: 1, command: "frobnicate" }, // not a real verb on AOI
      { id: "x2", type: "command", machineId: 99, command: "start" }, // machine 99 does not exist
    ],
  };
}

function mockReturn(data: unknown) {
  generateJSON.mockResolvedValue({ data, raw: "", tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 0, tokensPerSecond: 0, modelId: "m" });
}

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  process.env.AI_ORCHESTRATION_ADVISOR_ENABLED = "true";
});

describe("advisorEnabled flag", () => {
  it("is OFF by default and ON when set truthy", () => {
    process.env.AI_ORCHESTRATION_ADVISOR_ENABLED = "";
    expect(advisorEnabled()).toBe(false);
    process.env.AI_ORCHESTRATION_ADVISOR_ENABLED = "true";
    expect(advisorEnabled()).toBe(true);
  });
});

describe("suggestWorkflow", () => {
  it("returns a VALID + simulated workflow from a mocked model", async () => {
    mockReturn(validRaw());
    const res = await suggestWorkflow({ goal: "khởi động line A", machines: MACHINES, lang: "vi" });

    expect(res.available).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.validationErrors).toEqual([]);
    expect(res.workflow?.ref).toBe("ai-line-a");
    expect(res.workflow?.steps).toHaveLength(2);
    // It was validated + simulated.
    expect(res.simulation).not.toBeNull();
    expect(res.simulation?.valid).toBe(true);
    expect(res.rationale).toContain("Coordinate");
    expect(generateJSON).toHaveBeenCalledTimes(1);
  });

  it("restricts to machineIds and still validates", async () => {
    mockReturn(validRaw());
    const res = await suggestWorkflow({ goal: "g", machineIds: [1, 3], machines: MACHINES });
    expect(res.valid).toBe(true);
  });

  it("repairs an invalid first attempt when the retry is valid", async () => {
    generateJSON
      .mockResolvedValueOnce({ data: invalidRaw(), raw: "", tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 0, tokensPerSecond: 0, modelId: "m" })
      .mockResolvedValueOnce({ data: validRaw(), raw: "", tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 0, tokensPerSecond: 0, modelId: "m" });

    const res = await suggestWorkflow({ goal: "g", machines: MACHINES });
    expect(generateJSON).toHaveBeenCalledTimes(2); // first + repair retry
    expect(res.valid).toBe(true);
    expect(res.workflow?.ref).toBe("ai-line-a");
  });

  it("rejects honestly when both the first attempt AND the repair are invalid", async () => {
    mockReturn(invalidRaw()); // both calls return invalid
    const res = await suggestWorkflow({ goal: "g", machines: MACHINES, lang: "en" });

    expect(generateJSON).toHaveBeenCalledTimes(2); // attempted a repair
    expect(res.available).toBe(true);
    expect(res.valid).toBe(false);
    expect(res.validationErrors.length).toBeGreaterThan(0);
    expect(res.message).toBeTruthy(); // honest "could not produce a valid workflow"
  });

  it("flag-off → disabled no-op, model NOT called", async () => {
    process.env.AI_ORCHESTRATION_ADVISOR_ENABLED = "false";
    const res = await suggestWorkflow({ goal: "g", machines: MACHINES });
    expect(res.available).toBe(false);
    expect(res.valid).toBe(false);
    expect(res.message).toBeTruthy();
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("honest degrade when AI is unavailable (no model loaded)", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const res = await suggestWorkflow({ goal: "g", machines: MACHINES });
    expect(res.available).toBe(false);
    expect(res.message).toBeTruthy();
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("fail-safe when inference throws — honest degrade, never throws", async () => {
    generateJSON.mockRejectedValue(new Error("boom"));
    const res = await suggestWorkflow({ goal: "g", machines: MACHINES });
    expect(res.available).toBe(true);
    expect(res.valid).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it("honest message when no eligible machines supplied", async () => {
    const res = await suggestWorkflow({ goal: "g", machines: [] });
    expect(res.workflow).toBeNull();
    expect(res.message).toBeTruthy();
    expect(generateJSON).not.toHaveBeenCalled();
  });
});

describe("optimizeWorkflow", () => {
  const current: WorkflowDefinition = {
    ref: "line-a",
    name: "Line A v1",
    steps: [
      { id: "a", type: "command", machineId: 1, command: "start" },
      { id: "b", type: "command", machineId: 2, command: "start" },
    ],
  };

  it("returns a revised valid def + a diff + a fresh simulation", async () => {
    // Revised: parallelize the two independent starts + add a hitl gate.
    mockReturn({
      ref: "line-a",
      name: "Line A v2",
      rationale: "Parallelized the two independent starts; added a human gate.",
      steps: [
        { id: "g", type: "hitl_gate", prompt: "Confirm line A start?" },
        {
          id: "p",
          type: "parallel",
          steps: [
            { id: "a", type: "command", machineId: 1, command: "start" },
            { id: "b", type: "command", machineId: 2, command: "start" },
          ],
        },
      ],
    });

    const res = await optimizeWorkflow({ workflow: current, machines: MACHINES, lang: "en" });
    expect(res.available).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.workflow?.ref).toBe("line-a"); // ref preserved
    expect(res.simulation).not.toBeNull();
    expect(res.diff.length).toBeGreaterThan(0);
    expect(res.rationale).toContain("Parallelized");
  });

  it("flag-off → disabled no-op", async () => {
    process.env.AI_ORCHESTRATION_ADVISOR_ENABLED = "false";
    const res = await optimizeWorkflow({ workflow: current, machines: MACHINES });
    expect(res.available).toBe(false);
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("honest degrade when the revision is invalid", async () => {
    mockReturn(invalidRaw());
    const res = await optimizeWorkflow({ workflow: current, machines: MACHINES });
    expect(res.valid).toBe(false);
    expect(res.message).toBeTruthy();
  });
});

describe("HITL purity — the advisor never deploys or runs", () => {
  it("the module source imports/calls NO deploy/run path", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "aiOrchestrationAdvisor.ts"), "utf8");
    // Strip comments so doc-comments naming deployWorkflow/startRun (to state we DON'T call
    // them) don't trip the scan — we only forbid actual imports/invocations.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // No import from foeEngine (the executor) or a dispatcher.
    expect(code).not.toMatch(/from\s+["'][^"']*foeEngine["']/);
    expect(code).not.toMatch(/sendCommand/);
    // No invocation of deployWorkflow(...) / startRun(...).
    expect(code).not.toMatch(/\bdeployWorkflow\s*\(/);
    expect(code).not.toMatch(/\bstartRun\s*\(/);
  });
});
