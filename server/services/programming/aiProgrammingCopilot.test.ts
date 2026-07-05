/**
 * Doc 09 / Phase D7 + Doc 34 / P2 — AI Engineering Copilot unit tests (vitest).
 *
 * D7 (deterministic): HITL purity + safety refusal + validated suggestions + flag gate.
 * P2 (LLM codegen): the LLM + RAG are MOCKED (no GGUF load). Covers — safety hard-refusal,
 * validate-before-return through the REAL programmingAdapter, disabled-flag path, citation
 * passthrough, explain mode, and graceful GGUF-offline degrade.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

// ── Mock the heavy services generateProgram dynamically imports (no model, no disk) ──
vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  warmModel: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => ({
    text: "",
    tokensGenerated: 0,
    tokensPrompt: 0,
    totalTimeMs: 1,
    tokensPerSecond: 0,
    modelId: "mock",
  })),
  generateText: vi.fn(async () => ({
    text: "",
    tokensGenerated: 0,
    tokensPrompt: 0,
    totalTimeMs: 1,
    tokensPerSecond: 0,
    modelId: "mock",
  })),
  // P4 (1b): grammar-constrained JSON codegen for structured kinds (ir-flow / iec61131-pou).
  generateJSON: vi.fn(async () => ({
    data: {},
    raw: "{}",
    tokensGenerated: 0,
    tokensPrompt: 0,
    totalTimeMs: 1,
    tokensPerSecond: 0,
    modelId: "mock",
  })),
  stripThinking: (t: string) => ({ answer: t, thinking: "" }),
}));
vi.mock("../aiModelRouter", () => ({
  route: () => ({
    tier: 2,
    modelId: undefined,
    requiresHitl: false,
    maxTokens: 1024,
    temperature: 0.3,
    jsonMode: false,
    reason: "mock",
  }),
}));
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: vi.fn(async () => ({
    query: "",
    enabled: false,
    semanticUsed: false,
    answerContext: "",
    citations: [],
    chunks: [],
  })),
}));

import {
  suggestProgram,
  explainProgram,
  copilotEnabled,
  generateProgram,
} from "./aiProgrammingCopilot";
import { isGgufAvailable, chatCompletion, generateJSON } from "../aiGgufEngine";
import { searchProgrammingKb } from "../aiProgrammingKnowledgeService";

/** Build a GgufGenerateResult-shaped mock return from a text body. */
function llm(text: string) {
  return { text, tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 1, tokensPerSecond: 0, modelId: "mock" };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_PROGRAMMING_COPILOT_ENABLED = "true";
});
afterEach(() => {
  delete process.env.AI_PROGRAMMING_COPILOT_ENABLED;
});

// ════════════════════════════════════════════════════════════════════════════
// D7 — deterministic template copilot (unchanged, back-compat)
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// P2 — LLM code generation wired into the safety substrate (LLM + RAG mocked)
// ════════════════════════════════════════════════════════════════════════════

describe("generateProgram (doc 34 · P2) — LLM codegen on the safety substrate", () => {
  it("disabled flag → well-formed disabled result (ok:false, no code, no model call)", async () => {
    process.env.AI_PROGRAMMING_COPILOT_ENABLED = "false";
    const r = await generateProgram({ kind: "iec61131-st", request: "moving average filter" });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.code).toBeUndefined();
    expect(r.note).toMatch(/off/i);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("HARD-REFUSES safety-function requests BEFORE calling the model", async () => {
    for (const request of ["add an e-stop interlock", "generate the light curtain muting logic", "SIL3 safety relay reset", "急停回路"]) {
      const r = await generateProgram({ kind: "iec61131-ld", request, mode: "generate" });
      expect(r.refused).toBe(true);
      expect(r.ok).toBe(false);
      expect(r.code).toBeUndefined();
    }
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("VALIDATE-BEFORE-RETURN: invalid ST is run through the REAL adapter → ok:false + diagnostics, code STILL returned", async () => {
    // Missing END_VAR → the real Iec61131StAdapter reports an unbalanced VAR/END_VAR error.
    vi.mocked(chatCompletion).mockResolvedValueOnce(llm("```st\nVAR\n  run : BOOL;\n  run := TRUE;\n```"));
    const r = await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" });
    expect(r.refused).toBe(false);
    expect(r.code).toContain("VAR");
    expect(r.validation).toBeDefined();
    expect(r.validation!.ok).toBe(false);
    expect(r.validation!.diagnostics.some((d) => /END_VAR/i.test(d.message))).toBe(true);
    expect(r.ok).toBe(false); // PROG_CODEGEN_VALIDATE_REQUIRED default true → validation gates ok
  });

  it("valid ST passes the real adapter → ok:true, validation.ok:true", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(llm("```st\nVAR\n  run : BOOL;\nEND_VAR\nrun := TRUE;\n```"));
    const r = await generateProgram({ kind: "iec61131-st", request: "toggle a run bit" });
    expect(r.validation!.ok).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.code).toContain("run := TRUE");
  });

  it("attaches RAG citations from searchProgrammingKb (grounded, not fabricated)", async () => {
    vi.mocked(searchProgrammingKb).mockResolvedValueOnce({
      query: "movel",
      enabled: true,
      semanticUsed: true,
      answerContext: "[1] URScript Manual (Universal Robots, p.46)\nmovel(pose, a, v)",
      citations: [
        { id: "ur#1", vendor: "Universal Robots", docTitle: "URScript Manual", page: 46, section: null, sourcePath: "x", score: 0.9 },
      ],
      chunks: [],
    });
    vi.mocked(chatCompletion).mockResolvedValueOnce(llm("```st\nVAR\n x : BOOL;\nEND_VAR\nx := TRUE;\n```"));
    const r = await generateProgram({ kind: "iec61131-st", request: "linear move", vendor: "Universal Robots" });
    expect(r.citations).toContainEqual({ vendor: "Universal Robots", docTitle: "URScript Manual", page: 46 });
  });

  it("explain mode → grounded explanation, NO codegen, NO validation", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(llm("This program debounces a digital input using a TON timer [1]."));
    const r = await generateProgram({
      kind: "iec61131-st",
      mode: "explain",
      request: "what does this do",
      contextCode: "DebounceTmr(IN := x, PT := T#20ms);",
    });
    expect(r.ok).toBe(true);
    expect(r.explanation).toMatch(/debounce/i);
    expect(r.code).toBeUndefined();
    expect(r.validation).toBeUndefined();
  });

  it("GGUF offline → graceful degrade (ok:false, note, no code, no crash)", async () => {
    // Offline: runCodeModel probes isGgufAvailable (warmModel is mocked separately, so it
    // does not consume this mock). One Once(false), fully consumed — no leak to later tests.
    vi.mocked(isGgufAvailable).mockResolvedValueOnce(false);
    const r = await generateProgram({ kind: "iec61131-st", request: "moving average filter" });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe(false);
    expect(r.code).toBeUndefined();
    expect(r.note).toMatch(/offline/i);
  });

  it("translate mode routes to targetKind and validates the OUTPUT kind", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce(llm("```basic\nBASE(0)\nMOVEABS(150)\nWAIT IDLE\n```"));
    const r = await generateProgram({
      kind: "iec61131-st",
      targetKind: "zmotion-basic",
      mode: "translate",
      request: "translate this move to Zmotion",
      contextCode: "VAR x : BOOL; END_VAR\nx := TRUE;",
    });
    expect(r.kind).toBe("zmotion-basic");
    expect(r.code).toContain("MOVEABS");
    expect(r.validation!.ok).toBe(true); // validated via the ZmotionBasicAdapter (output kind)
    expect(r.ok).toBe(true);
  });

  // ── P4 (1b): STRUCTURED-JSON kinds route through GBNF grammar-constrained generateJSON ──
  it("STRUCTURED KIND iec61131-pou → GBNF JSON path (generateJSON), NOT free-text, returns validated parseable JSON with the `pous` wrapper", async () => {
    // The eval's failure was a MISSING `pous` wrapper; the grammar forces it. Here the model's
    // content is a known-valid single-POU LAD project INSIDE that wrapper.
    const project = {
      name: "Demo",
      pous: [
        {
          name: "P",
          pouType: "program",
          vars: [
            { name: "A", type: "BOOL", section: "VAR_INPUT" },
            { name: "Y", type: "BOOL", section: "VAR_OUTPUT" },
          ],
          body: {
            language: "LD",
            networks: [{ logic: { kind: "contact", variable: "A" }, coils: [{ variable: "Y", kind: "coil" }] }],
          },
        },
      ],
    };
    vi.mocked(generateJSON).mockResolvedValueOnce({
      data: project, raw: JSON.stringify(project),
      tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 1, tokensPerSecond: 0, modelId: "mock",
    });
    const r = await generateProgram({ kind: "iec61131-pou", request: "seal-in start/stop program" });
    // Routed through the grammar path — NOT the free-text chatCompletion path.
    expect(generateJSON).toHaveBeenCalledTimes(1);
    expect(chatCompletion).not.toHaveBeenCalled();
    // Output is parseable JSON carrying the (previously-missing) `pous` array wrapper.
    expect(r.code).toBeDefined();
    const parsed = JSON.parse(r.code!);
    expect(Array.isArray(parsed.pous)).toBe(true);
    expect(parsed.pous[0].name).toBe("P");
    // Validated + compiled through the REAL Iec61131PouAdapter → ok.
    expect(r.validation!.ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("STRUCTURED KIND ir-flow → GBNF JSON path produces validated parseable JSON with the `blocks` wrapper (no trailing text)", async () => {
    // The grammar stops at the closing brace, so the eval's "trailing text after JSON" failure
    // cannot occur. `safe_move` is the linter's canonical safe fixture (lints + transpiles ok).
    const flow = {
      flow_id: "safe_move",
      target_device_type: "universal-robots",
      version: 1,
      blocks: [
        { id: "b1", type: "move_linear", target_pose: { x: 100, y: 100, z: 300, rx: 0, ry: 0, rz: 0 }, speed_mms: 100, acceleration: 1, blend_radius: 0 },
      ],
    };
    vi.mocked(generateJSON).mockResolvedValueOnce({
      data: flow, raw: JSON.stringify(flow),
      tokensGenerated: 0, tokensPrompt: 0, totalTimeMs: 1, tokensPerSecond: 0, modelId: "mock",
    });
    const r = await generateProgram({ kind: "ir-flow", request: "move linearly to a pick pose" });
    expect(generateJSON).toHaveBeenCalledTimes(1);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(r.code).toBeDefined();
    const parsed = JSON.parse(r.code!);
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect(parsed.blocks[0].type).toBe("move_linear");
    expect(r.validation!.ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("STRUCTURED KIND falls back to the free-text path when grammar generation throws (no crash)", async () => {
    // generateJSON throwing (e.g. a grammar-build failure) must NOT crash — it degrades to the
    // free-text chatCompletion path, which then validates as usual.
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error("grammar build failed"));
    vi.mocked(chatCompletion).mockResolvedValueOnce(
      llm('```json\n{"flow_id":"f","target_device_type":"generic","version":1,"blocks":[{"id":"b1","type":"wait","ms":100}]}\n```'),
    );
    const r = await generateProgram({ kind: "ir-flow", request: "wait a moment" });
    expect(generateJSON).toHaveBeenCalledTimes(1);
    expect(chatCompletion).toHaveBeenCalledTimes(1); // fell back to free-text
    expect(r.code).toBeDefined();
    expect(JSON.parse(r.code!).flow_id).toBe("f");
  });
});
