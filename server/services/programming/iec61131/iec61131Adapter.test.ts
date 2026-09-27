/**
 * Doc 09 / Phase D5 — Native IEC 61131-3 adapters + boolean evaluator tests (vitest).
 */
import { describe, it, expect } from "vitest";
import { evalBool } from "./boolEval";
import { Iec61131StAdapter, Iec61131LdAdapter } from "./iec61131Adapter";
import { programmingRegistry } from "../programmingAdapter";

describe("boolEval", () => {
  it("AND / NOT / OR / parens", () => {
    expect(evalBool("X0 AND NOT X1", { X0: true, X1: false }).value).toBe(true);
    expect(evalBool("X0 AND NOT X1", { X0: true, X1: true }).value).toBe(false);
    expect(evalBool("(A OR B) AND C", { A: false, B: true, C: true }).value).toBe(true);
    expect(evalBool("A XOR B", { A: true, B: true }).value).toBe(false);
  });
  it("unknown symbol → false + reported", () => {
    const r = evalBool("X0 AND Z9", { X0: true });
    expect(r.value).toBe(false);
    expect(r.unknownSymbols).toContain("Z9");
  });
  it("malformed → throws", () => {
    expect(() => evalBool("X0 AND", {})).toThrow();
    expect(() => evalBool("(X0", {})).toThrow();
  });
});

describe("Iec61131StAdapter", () => {
  const a = new Iec61131StAdapter();
  it("balanced ST → ok; unbalanced IF → error", async () => {
    expect((await a.validate({ kind: "iec61131-st", language: "st", content: "VAR x: BOOL; END_VAR\nx := TRUE;" })).ok).toBe(true);
    expect((await a.validate({ kind: "iec61131-st", language: "st", content: "IF x THEN\n  y := 1;" })).ok).toBe(false);
  });
  it("compile → openplc://st ref + honest preview sim", async () => {
    // doc 80 Đợt 1 Task 7 — trước đây `x := TRUE;\ny := FALSE;` (x, y KHÔNG khai báo) vẫn "biên dịch"
    // vì validator chỉ đếm từ khoá. Nay phải khai báo.
    const b = await a.compile({ kind: "iec61131-st", language: "st", content: "VAR x : BOOL; y : BOOL; END_VAR\nx := TRUE;\ny := FALSE;" });
    expect(b.outputRef).toContain("openplc://st/");
    const sim = await a.simulate(b, {});
    expect(sim.warnings.join(" ")).toMatch(/OpenPLC/);
  });
  it("Task 7 — biến chưa khai báo ⇒ compile KHÔNG ra tham chiếu build", async () => {
    const b = await a.compile({ kind: "iec61131-st", language: "st", content: "x := TRUE;\ny := FALSE;" });
    expect(b.ok).toBe(false);
    expect(b.outputRef).toBeUndefined();
    const undeclared = b.diagnostics.filter((d) => d.code === "stUndeclared");
    expect(undeclared.map((d) => [d.line, d.col, d.params?.name])).toEqual([[1, 1, "x"], [2, 1, "y"]]);
  });
  it("Task 7 — ký hiệu từ bảng tag của project (ProgramSource.symbols) coi như đã khai báo", async () => {
    const v = await a.validate({ kind: "iec61131-st", language: "st", content: "Motor := Start;", symbols: [{ name: "Motor" }, { name: "start" }] });
    expect(v.ok).toBe(true);
  });
  it("Task 7 — dạng 'mảnh' của skeleton Copilot (VAR ở đầu + lệnh, không POU) hợp lệ", async () => {
    const v = await a.validate({ kind: "iec61131-st", language: "st", content: "(* bật chạy *)\nVAR\n  run : BOOL;\nEND_VAR\nrun := TRUE;" });
    expect(v.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it("Task 7 — lồng bệnh lý (5000 '(' / 5000 IF) ⇒ lỗi cú pháp có vị trí, KHÔNG ném RangeError", async () => {
    const deepParen = `PROGRAM P\nVAR a : INT; END_VAR\na := ${"(".repeat(5000)}1${")".repeat(5000)};\nEND_PROGRAM`;
    const v1 = await a.validate({ kind: "iec61131-st", language: "st", content: deepParen });
    expect(v1.ok).toBe(false);
    expect(v1.diagnostics.some((d) => d.severity === "error" && d.line === 3)).toBe(true);
    const deepIf = `PROGRAM P\nVAR a : BOOL; END_VAR\n${"IF a THEN\n".repeat(5000)}a := TRUE;\n${"END_IF;\n".repeat(5000)}END_PROGRAM`;
    const v2 = await a.validate({ kind: "iec61131-st", language: "st", content: deepIf });
    expect(v2.ok).toBe(false);
  });
  it("Task 7 — chẩn đoán mang code + params (khoá i18n engineering.stDiag.<code>) + dòng/cột", async () => {
    const v = await a.validate({ kind: "iec61131-st", language: "st", content: "PROGRAM P\nVAR t : TON; y : BOOL; END_VAR\ny := t.OUT;\nEND_PROGRAM" });
    expect(v.ok).toBe(false);
    const d = v.diagnostics.find((x) => x.code === "stNoMember")!;
    expect(d).toMatchObject({ severity: "error", line: 3, col: 8, params: { type: "TON", member: "OUT" } });
    expect(d.message).toMatch(/TON.*OUT/);
  });
  it("deploy → failed (open runtime only, none configured)", async () => {
    const r = await a.deploy({ ok: true, diagnostics: [] }, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "x", requestedBy: 1 } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OPEN runtime|OpenPLC/);
  });
});

describe("Iec61131LdAdapter — REAL one-scan evaluation", () => {
  const a = new Iec61131LdAdapter();
  const LD = `Y0 := X0 AND NOT X1
Y1 := Y0 OR X2`;

  it("validate ok; bad rung → error", async () => {
    expect((await a.validate({ kind: "iec61131-ld", language: "ld", content: LD })).ok).toBe(true);
    expect((await a.validate({ kind: "iec61131-ld", language: "ld", content: "this is not a rung" })).ok).toBe(false);
  });

  it("compile transpiles rungs → ST + openplc ref", async () => {
    const b = await a.compile({ kind: "iec61131-ld", language: "ld", content: LD });
    expect(b.ok).toBe(true);
    expect(b.outputRef).toContain("openplc://ld/");
    expect(String(b.meta?.st)).toContain("Y0 := X0 AND NOT X1;");
  });

  it("simulate computes real outputs with scan-forward", async () => {
    const b = await a.compile({ kind: "iec61131-ld", language: "ld", content: LD });
    // X0=1,X1=0 → Y0=TRUE; Y1 = Y0 OR X2 = TRUE
    const sim = await a.simulate(b, { assumedInputs: { X0: true, X1: false, X2: false } });
    expect(sim.timeline.find((s) => s.label.startsWith("Y0"))!.label).toContain("TRUE");
    expect(sim.timeline.find((s) => s.label.startsWith("Y1"))!.label).toContain("TRUE");
    // X0=1,X1=1 → Y0=FALSE; Y1 = FALSE OR X2(false) = FALSE
    const sim2 = await a.simulate(b, { assumedInputs: { X0: true, X1: true, X2: false } });
    expect(sim2.timeline.find((s) => s.label.startsWith("Y0"))!.label).toContain("FALSE");
    expect(sim2.timeline.find((s) => s.label.startsWith("Y1"))!.label).toContain("FALSE");
  });
});

describe("registry", () => {
  it("both IEC kinds implemented; gcode still pending", () => {
    expect(programmingRegistry.isImplemented("iec61131-st")).toBe(true);
    expect(programmingRegistry.isImplemented("iec61131-ld")).toBe(true);
    expect(programmingRegistry.isImplemented("gcode")).toBe(false);
  });
});
