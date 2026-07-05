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
import { isGgufAvailable, chatCompletion } from "../aiGgufEngine";
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
    // Offline path probes isGgufAvailable twice (warmCodeModel + runCodeModel); both false.
    // Use two Once() so the override is fully consumed and does not leak to later tests.
    vi.mocked(isGgufAvailable).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
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
});
