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
    const b = await a.compile({ kind: "iec61131-st", language: "st", content: "x := TRUE;\ny := FALSE;" });
    expect(b.outputRef).toContain("openplc://st/");
    const sim = await a.simulate(b, {});
    expect(sim.warnings.join(" ")).toMatch(/OpenPLC/);
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
