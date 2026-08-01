/**
 * Doc 34 · P2 — unit tests for the PROGRAMMING (Automation Programming Copilot) tools.
 *
 * Strategy (mirrors analyticsTools.test.ts): mock the HEAVY deps (RAG service,
 * programming adapter, codegen copilot, RBAC) and exercise the REAL logic for the
 * two safety-critical pieces — the `calc` arithmetic evaluator and the workspace
 * path-confinement (read + write). No real Postgres, no GPU, no device.
 *
 * Asserts:
 *   - read tools: kind 'read' + requiredPermission machine_monitoring/canView + handler,
 *     no write surface; RBAC fail-safe (missing/denied __authCtx → no data, service NOT called).
 *   - calc: rejects non-arithmetic / prototype-escape input; computes correctly (REAL).
 *   - read/write reject `..` / absolute / escaping paths (REAL fs, temp workspace).
 *   - write_project_file requires HITL: kind 'write', preview does NOT mutate disk,
 *     execute is the hard confinement gate (writes a valid file; refuses an oob path).
 *   - syntax_check surfaces the adapter's diagnostics.
 *   - all 9 tools are registered.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── mock RBAC ──
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

// ── mock the vendor-manual RAG service ──
const searchProgrammingKbMock = vi.fn();
vi.mock("../aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: (...a: unknown[]) => searchProgrammingKbMock(...a),
}));

// ── mock the programming adapter registry (validate/compile/simulate are device-free) ──
const validateMock = vi.fn();
const compileMock = vi.fn();
const simulateMock = vi.fn();
const isImplementedMock = vi.fn();
const getAdapterMock = vi.fn();
const fakeAdapter = {
  capabilities: {},
  validate: (...a: unknown[]) => validateMock(...a),
  compile: (...a: unknown[]) => compileMock(...a),
  simulate: (...a: unknown[]) => simulateMock(...a),
};
vi.mock("../programming/programmingAdapter", () => ({
  programmingRegistry: {
    getAdapter: (...a: unknown[]) => getAdapterMock(...a),
    isImplemented: (...a: unknown[]) => isImplementedMock(...a),
  },
}));

// ── mock the codegen copilot (concurrent agent's generateProgram) ──
const generateProgramMock = vi.fn();
vi.mock("../programming/aiProgrammingCopilot", () => ({
  generateProgram: (...a: unknown[]) => generateProgramMock(...a),
}));

import {
  retrieveProgrammingKb,
  lookupErrorCode,
  syntaxCheckProgram,
  compileProgram,
  simulateProgram,
  generateProgramTool,
  calcTool,
  readProjectFile,
  evaluateArithmetic,
} from "./readToolsProgramming";
import { writeProjectFileTool } from "./writeHandlers/programmingFile";
import { getTool } from "./toolRegistry";

const AUTH = { userId: 42, role: "engineer" } as const;
const CTX = { user: { id: 42, role: "engineer" }, lang: "vi" as const };

const READ_TOOLS = [
  retrieveProgrammingKb,
  lookupErrorCode,
  syntaxCheckProgram,
  compileProgram,
  simulateProgram,
  generateProgramTool,
  calcTool,
  readProjectFile,
];

let ws = "";

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "progws-"));
  process.env.PROG_WORKSPACE_DIR = ws;
});

afterAll(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  delete process.env.PROG_WORKSPACE_DIR;
});

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionMock.mockResolvedValue(true);
  isImplementedMock.mockReturnValue(true);
  getAdapterMock.mockReturnValue(fakeAdapter);
  validateMock.mockResolvedValue({ ok: true, diagnostics: [] });
  compileMock.mockResolvedValue({ ok: true, diagnostics: [], outputRef: "stub://build/3", bytes: 42, meta: {} });
  simulateMock.mockResolvedValue({ ok: true, timeline: [{ index: 0, label: "line 1", startMs: 0, endMs: 100 }], warnings: [], totalDurationMs: 100 });
  searchProgrammingKbMock.mockResolvedValue({
    query: "",
    enabled: true,
    semanticUsed: true,
    answerContext: "[1] URScript Manual (universal-robots, p.46)\nmovel(pose, a, v)",
    citations: [{ id: "c1", vendor: "universal-robots", docTitle: "URScript Manual", page: 46, section: null, sourcePath: "x", score: 0.9 }],
    chunks: [],
  });
  generateProgramMock.mockResolvedValue({ ok: true, refused: false, kind: "iec61131-st", code: "run := TRUE;", validation: { ok: true }, citations: [], explanation: "Sets an output true." });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("read tools — READ-ONLY + RBAC contract", () => {
  it("every read tool is kind 'read', machine_monitoring/canView, handler, no write surface", () => {
    for (const t of READ_TOOLS) {
      expect(t.kind).toBe("read");
      expect(typeof t.handler).toBe("function");
      expect(t.preview).toBeUndefined();
      expect(t.execute).toBeUndefined();
      expect(t.requiredPermission).toEqual({ module: "machine_monitoring", action: "canView" });
    }
  });

  it("schemas are strict (reject unknown keys / bad kind)", () => {
    expect(calcTool.parameters.safeParse({ expression: "1+1", bogus: 1 }).success).toBe(false);
    expect(syntaxCheckProgram.parameters.safeParse({ kind: "nope", code: "x" }).success).toBe(false);
    expect(readProjectFile.parameters.safeParse({ path: "a.st", extra: 1 }).success).toBe(false);
    // valid
    expect(calcTool.parameters.safeParse({ expression: "1+1", __authCtx: AUTH }).success).toBe(true);
    expect(syntaxCheckProgram.parameters.safeParse({ kind: "iec61131-st", code: "x" }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("RBAC gating (fail-safe)", () => {
  it("denies (no data) when __authCtx is missing — RAG NOT called", async () => {
    const r = await retrieveProgrammingKb.handler!({ query: "movel" } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(searchProgrammingKbMock).not.toHaveBeenCalled();
    expect(checkPermissionMock).not.toHaveBeenCalled(); // missing ctx short-circuits before lookup
  });

  it("denies (no data) when checkPermission=false — RAG NOT called", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const r = await retrieveProgrammingKb.handler!({ query: "movel", __authCtx: AUTH } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
    expect(checkPermissionMock).toHaveBeenCalledWith(AUTH.userId, AUTH.role, "machine_monitoring", "canView");
    expect(searchProgrammingKbMock).not.toHaveBeenCalled();
  });

  it("calc is RBAC-gated too (missing ctx → denied, evaluator not reached)", async () => {
    const r = await calcTool.handler!({ expression: "1+1" } as any);
    expect(r.note).toBe("PERMISSION_DENIED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("retrieve_programming_kb / lookup_error_code", () => {
  it("returns cited chunks + the assembled answerContext as textSummary", async () => {
    const r = await retrieveProgrammingKb.handler!({ query: "movel", __authCtx: AUTH } as any);
    expect(r.data.count).toBe(1);
    expect(r.data.citations[0].page).toBe(46);
    expect(r.data.citations[0].vendor).toBe("universal-robots");
    expect(r.textSummary).toContain("p.46");
  });

  it("degrades gracefully when the KB is disabled", async () => {
    searchProgrammingKbMock.mockResolvedValue({ query: "x", enabled: false, semanticUsed: false, answerContext: "", citations: [], chunks: [] });
    const r = await retrieveProgrammingKb.handler!({ query: "movel", __authCtx: AUTH } as any);
    expect(r.note).toBe("PROG_KB_DISABLED");
  });

  it("lookup_error_code scopes the query to the code + fault vocabulary", async () => {
    await lookupErrorCode.handler!({ code: "AL.037", vendor: "mitsubishi", __authCtx: AUTH } as any);
    expect(searchProgrammingKbMock).toHaveBeenCalledTimes(1);
    const arg = searchProgrammingKbMock.mock.calls[0][0] as any;
    expect(arg.query).toContain("AL.037");
    expect(arg.vendor).toBe("mitsubishi");
    expect(String(arg.query).toLowerCase()).toMatch(/error|alarm|fault/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("syntax_check / compile / simulate — adapter (device-free)", () => {
  it("syntax_check surfaces the adapter diagnostics", async () => {
    validateMock.mockResolvedValue({ ok: false, diagnostics: [{ severity: "error", message: "BOOM unbalanced", line: 3 }] });
    const r = await syntaxCheckProgram.handler!({ kind: "iec61131-st", code: "IF x", __authCtx: AUTH } as any);
    expect(r.data.ok).toBe(false);
    expect(r.data.errorCount).toBe(1);
    expect(r.data.diagnostics[0].message).toBe("BOOM unbalanced");
    expect(r.textSummary).toContain("BOOM unbalanced");
    expect(validateMock).toHaveBeenCalledTimes(1);
  });

  it("syntax_check returns ADAPTER_NOT_IMPLEMENTED for a planned kind", async () => {
    isImplementedMock.mockReturnValue(false);
    const r = await syntaxCheckProgram.handler!({ kind: "gcode", code: "G0", __authCtx: AUTH } as any);
    expect(r.note).toBe("ADAPTER_NOT_IMPLEMENTED");
    expect(getAdapterMock).not.toHaveBeenCalled();
  });

  it("compile returns the build token (never deploys)", async () => {
    const r = await compileProgram.handler!({ kind: "iec61131-st", code: "run := TRUE;", __authCtx: AUTH } as any);
    expect(r.data.ok).toBe(true);
    expect(r.data.buildToken).toBe("stub://build/3");
    expect(r.data.bytes).toBe(42);
  });

  it("simulate compiles then simulates → timeline", async () => {
    const r = await simulateProgram.handler!({ kind: "iec61131-st", code: "run := TRUE;", __authCtx: AUTH } as any);
    expect(compileMock).toHaveBeenCalledTimes(1);
    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(r.data.supported).toBe(true);
    expect(r.data.stepCount).toBe(1);
    expect(r.data.totalDurationMs).toBe(100);
  });

  it("simulate reports SIMULATE_UNSUPPORTED when the adapter has no simulate()", async () => {
    getAdapterMock.mockReturnValue({ capabilities: {}, validate: validateMock, compile: compileMock });
    const r = await simulateProgram.handler!({ kind: "mitsubishi-engineering", code: "D100 = 0", __authCtx: AUTH } as any);
    expect(r.note).toBe("SIMULATE_UNSUPPORTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("generate_program — copilot codegen (text only)", () => {
  it("returns code + explanation from the copilot", async () => {
    const r = await generateProgramTool.handler!({ kind: "iec61131-st", request: "set an output", __authCtx: AUTH } as any);
    expect(r.data.code).toBe("run := TRUE;");
    expect(r.data.refused).toBe(false);
    expect(r.textSummary).toContain("run := TRUE;");
    expect(generateProgramMock).toHaveBeenCalledTimes(1);
  });

  it("honours a safety refusal", async () => {
    generateProgramMock.mockResolvedValue({ ok: false, refused: true, reason: "E-stop logic is authored by a certified engineer.", kind: "iec61131-st" });
    const r = await generateProgramTool.handler!({ kind: "iec61131-st", request: "estop interlock", __authCtx: AUTH } as any);
    expect(r.note).toBe("REFUSED");
    expect(r.data.refused).toBe(true);
    expect(r.textSummary).toMatch(/certified/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("calc — SAFE arithmetic evaluator (no eval)", () => {
  it("computes arithmetic correctly", async () => {
    const cases: Array<[string, number]> = [
      ["1+2*3", 7],
      ["(1+2)*3", 9],
      ["2^10", 1024],
      ["10%3", 1],
      ["sqrt(16)", 4],
      ["max(3,7,1)", 7],
      ["min(3,7,1)", 1],
      ["-5+2", -3],
      ["100/8", 12.5],
      ["round(3.6)", 4],
      ["pow(2,8)", 256],
      ["abs(-9)", 9],
      ["1.5e2 + 0.5", 150.5],
      ["pi*0", 0],
    ];
    for (const [expr, val] of cases) {
      const r = await calcTool.handler!({ expression: expr, __authCtx: AUTH } as any);
      expect(r.note).toBeUndefined();
      expect(r.data.value).toBeCloseTo(val, 6);
    }
  });

  it("rejects non-arithmetic / malicious / prototype-escape input", async () => {
    const bad = [
      "process.exit(1)",
      "require('fs')",
      "1; drop table x",
      "alert(1)",
      "__proto__",
      "constructor(1)",
      "valueOf()",
      "toString()",
      "1 + foo",
      "2 + ",
      "()",
      "9/0", // Infinity → not finite
      "1..2",
      "0x10", // hex not supported
      "import(1)",
    ];
    for (const expr of bad) {
      const r = await calcTool.handler!({ expression: expr, __authCtx: AUTH } as any);
      expect(r.note, `expected rejection for: ${expr}`).toBe("INVALID_EXPRESSION");
      expect(r.data.value).toBeNull();
    }
  });

  it("evaluateArithmetic throws directly on non-arithmetic and computes on valid", () => {
    expect(() => evaluateArithmetic("require('fs')")).toThrow();
    expect(() => evaluateArithmetic("constructor(1)")).toThrow();
    expect(() => evaluateArithmetic("9/0")).toThrow();
    expect(evaluateArithmetic("2+2")).toBe(4);
    expect(evaluateArithmetic("sqrt(9)*2")).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("read_project_file — workspace confinement (REAL fs)", () => {
  it("reads a valid in-root file", async () => {
    fs.writeFileSync(path.join(ws, "prog.st"), "run := TRUE;");
    const r = await readProjectFile.handler!({ path: "prog.st", __authCtx: AUTH } as any);
    expect(r.note).toBeUndefined();
    expect(r.data.content).toContain("run := TRUE;");
    expect(r.data.path).toBe("prog.st");
  });

  it("reads a nested in-root file", async () => {
    fs.mkdirSync(path.join(ws, "sub"), { recursive: true });
    fs.writeFileSync(path.join(ws, "sub", "a.txt"), "hello");
    const r = await readProjectFile.handler!({ path: "sub/a.txt", __authCtx: AUTH } as any);
    expect(r.data.content).toBe("hello");
  });

  it("returns NOT_FOUND for a missing in-root file", async () => {
    const r = await readProjectFile.handler!({ path: "does-not-exist.st", __authCtx: AUTH } as any);
    expect(r.note).toBe("NOT_FOUND");
  });

  it("rejects traversal / absolute / escaping paths (no read)", async () => {
    // Create a secret OUTSIDE the workspace to prove it is never read.
    const outside = path.join(os.tmpdir(), `secret-${Date.now()}.txt`);
    fs.writeFileSync(outside, "TOP-SECRET");
    const badPaths = ["../secret.txt", "../../etc/passwd", "sub/../../escape.txt", outside, "/etc/passwd", "C:\\Windows\\win.ini", "..\\..\\x"];
    for (const p of badPaths) {
      const r = await readProjectFile.handler!({ path: p, __authCtx: AUTH } as any);
      expect(r.note, `expected reject for: ${p}`).toBe("PATH_REJECTED");
      expect(r.data.content).toBeNull();
    }
    fs.rmSync(outside, { force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("write_project_file — HITL + confinement (REAL fs)", () => {
  it("is a write tool: kind 'write', machine_monitoring/canEdit, preview+execute+summarize, no handler", () => {
    expect(writeProjectFileTool.kind).toBe("write");
    expect(writeProjectFileTool.requiredPermission).toEqual({ module: "machine_monitoring", action: "canEdit" });
    expect(typeof writeProjectFileTool.preview).toBe("function");
    expect(typeof writeProjectFileTool.execute).toBe("function");
    expect(typeof writeProjectFileTool.summarize).toBe("function");
    expect(writeProjectFileTool.handler).toBeUndefined();
  });

  it("preview does NOT mutate disk (HITL: dry-run only)", async () => {
    const target = path.join(ws, "preview-only.st");
    if (fs.existsSync(target)) fs.rmSync(target);
    const pv = await writeProjectFileTool.preview!({ path: "preview-only.st", content: "X := 1;" }, CTX as any);
    expect(fs.existsSync(target)).toBe(false); // preview wrote nothing
    expect(pv.entityType).toBe("project_file");
    expect(pv.changes.length).toBeGreaterThan(0);
  });

  it("preview rejects a traversal path (warning, empty changes, no throw)", async () => {
    const pv = await writeProjectFileTool.preview!({ path: "../evil.st", content: "X" }, CTX as any);
    expect(pv.changes).toEqual([]);
    expect(pv.warnings.length).toBeGreaterThan(0);
  });

  it("execute writes a valid file (simulating post-confirm)", async () => {
    const res = await writeProjectFileTool.execute!({ path: "out/gen.st", content: "run := TRUE;" }, CTX as any);
    expect(res.data.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, "out", "gen.st"), "utf8")).toBe("run := TRUE;");
  });

  it("execute REFUSES traversal / absolute paths and writes nothing outside", async () => {
    const sentinel = path.join(os.tmpdir(), `should-not-exist-${Date.now()}.st`);
    const badPaths = ["../escape.st", "/tmp/escape.st", "C:\\escape.st", "sub/../../escape.st"];
    for (const p of badPaths) {
      const res = await writeProjectFileTool.execute!({ path: p, content: "PWNED" }, CTX as any);
      expect(res.data.ok, `expected refuse for: ${p}`).toBe(false);
      expect(res.note).toBe("PATH_REJECTED");
    }
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("registration", () => {
  it("registers all 9 programming tools", () => {
    const names = [
      "retrieve_programming_kb",
      "lookup_error_code",
      "syntax_check_program",
      "compile_program",
      "simulate_program",
      "generate_program",
      "calc",
      "read_project_file",
      "write_project_file",
    ];
    for (const name of names) {
      const t = getTool(name);
      expect(t, `tool not registered: ${name}`).toBeDefined();
      expect(t!.name).toBe(name);
    }
    expect(getTool("write_project_file")!.kind).toBe("write");
    expect(getTool("calc")!.kind).toBe("read");
  });
});
