/**
 * Doc 24 Wave-3 / P4 — structured IEC 61131-3 POU model tests (vitest). PURE / in-memory.
 *
 * Covers:
 *   (a) PLCopen TC6 XML round-trip is MODEL-STABLE for a sample LAD + FBD + SFC POU
 *       (import→export→import is a fixpoint) + imports a hand-authored PLCopen LD file.
 *   (b) LAD / FBD / SFC → ST transpile GOLDEN lowering (+ `(* [IEC ...] *)` provenance + determinism).
 *   (c) the semantic linter catches undeclared var + type mismatch + unreachable SFC step.
 *   (d) the POU adapter flows through the ProgrammingAdapter contract; the linter HARD-GATES
 *       codegen; and the EXISTING iec61131-st / iec61131-ld adapters are unchanged (registered + work).
 */
import { describe, it, expect } from "vitest";
import {
  parsePouProject,
  type PouProject,
} from "./pouModel";
import { transpilePouProject } from "./pouToSt";
import { lintPouProject } from "./pouLinter";
import { exportPlcopenXml, importPlcopenXml } from "./plcopenXml";
import {
  Iec61131PouAdapter, Iec61131StAdapter, Iec61131LdAdapter,
  previewPouTranspile,
} from "./iec61131Adapter";
import { programmingRegistry } from "../programmingAdapter";

// ── Fixtures ──────────────────────────────────────────────────────────────────
function ladPou(): PouProject {
  return parsePouProject({
    name: "LadProj",
    pous: [{
      name: "MotorControl",
      pouType: "program",
      vars: [
        { name: "Start", type: "BOOL", section: "VAR_INPUT" },
        { name: "Stop", type: "BOOL", section: "VAR_INPUT" },
        { name: "Interlock", type: "BOOL", section: "VAR_INPUT" },
        { name: "Motor", type: "BOOL", section: "VAR_OUTPUT" },
      ],
      body: {
        language: "LD",
        networks: [{
          // seal-in: (Start OR Motor) AND NOT Stop AND Interlock
          logic: { kind: "series", elements: [
            { kind: "parallel", elements: [
              { kind: "contact", variable: "Start" },
              { kind: "contact", variable: "Motor" },
            ] },
            { kind: "contact", variable: "Stop", negated: true },
            { kind: "contact", variable: "Interlock" },
          ] },
          coils: [{ variable: "Motor", kind: "coil" }],
        }],
      },
    }],
  } as unknown).project as PouProject;
}

function fbdPou(): PouProject {
  return parsePouProject({
    name: "FbdProj",
    pous: [{
      name: "Compute",
      pouType: "functionBlock",
      vars: [
        { name: "A", type: "INT", section: "VAR_INPUT" },
        { name: "B", type: "INT", section: "VAR_INPUT" },
        { name: "Enable", type: "BOOL", section: "VAR_INPUT" },
        { name: "Big", type: "BOOL", section: "VAR_OUTPUT" },
        { name: "Sum", type: "INT", section: "VAR_OUTPUT" },
      ],
      body: {
        language: "FBD",
        networks: [{
          blocks: [
            { id: "b1", type: "ADD", inputs: [
              { name: "IN1", source: { kind: "var", name: "A" } },
              { name: "IN2", source: { kind: "var", name: "B" } },
            ] },
            { id: "b2", type: "GT", inputs: [
              { name: "IN1", source: { kind: "block", blockId: "b1" } },
              { name: "IN2", source: { kind: "const", value: 100 } },
            ] },
            { id: "b3", type: "AND", inputs: [
              { name: "IN1", source: { kind: "block", blockId: "b2" } },
              { name: "IN2", source: { kind: "var", name: "Enable" } },
            ] },
          ],
          outputs: [
            { variable: "Sum", source: { kind: "block", blockId: "b1" } },
            { variable: "Big", source: { kind: "block", blockId: "b3" } },
          ],
        }],
      },
    }],
  } as unknown).project as PouProject;
}

function sfcPou(): PouProject {
  return parsePouProject({
    name: "SfcProj",
    pous: [{
      name: "Sequence",
      pouType: "program",
      vars: [
        { name: "GoNext", type: "BOOL", section: "VAR_INPUT" },
        { name: "Done", type: "BOOL", section: "VAR_INPUT" },
        { name: "Lamp", type: "BOOL", section: "VAR_OUTPUT" },
      ],
      body: {
        language: "SFC",
        steps: [
          { name: "Init", initial: true, actions: [{ qualifier: "N", actionText: "Lamp := FALSE;" }] },
          { name: "Run", actions: [{ qualifier: "N", actionText: "Lamp := TRUE;" }] },
          { name: "Finish", actions: [] },
        ],
        transitions: [
          { from: "Init", to: "Run", condition: "GoNext" },
          { from: "Run", to: "Finish", condition: "Done" },
          { from: "Finish", to: "Init", condition: "NOT GoNext" },
        ],
      },
    }],
  } as unknown).project as PouProject;
}

/** A single project carrying all three graphical bodies (for the round-trip test). */
function mixedProject(): PouProject {
  return parsePouProject({
    name: "Mixed",
    pous: [ladPou().pous[0], fbdPou().pous[0], sfcPou().pous[0]],
  } as unknown).project as PouProject;
}

// ══════════════════════════════════════════════════════════════════════════════
// (a) PLCopen XML round-trip — model-stable
// ══════════════════════════════════════════════════════════════════════════════
describe("PLCopen TC6 XML round-trip (import→export→import is a fixpoint)", () => {
  it("is model-stable for a LAD + FBD + SFC project", () => {
    const M0 = mixedProject();
    const xml1 = exportPlcopenXml(M0);
    expect(xml1).toContain('xmlns="http://www.plcopen.org/xml/tc6_0201"');

    const imp1 = importPlcopenXml(xml1);
    expect(imp1.ok).toBe(true);
    if (!imp1.ok) return;
    const M1 = imp1.project;

    const xml2 = exportPlcopenXml(M1);
    const imp2 = importPlcopenXml(xml2);
    expect(imp2.ok).toBe(true);
    if (!imp2.ok) return;
    const M2 = imp2.project;

    // Fixpoint: a second round-trip is identical (structurally stable).
    expect(M2).toEqual(M1);
    expect(xml2).toEqual(xml1);

    // And the POUs themselves survive the first round-trip unchanged (only a default
    // fileHeader is added on export).
    expect(M1.pous).toEqual(M0.pous);
  });

  it("imports a hand-authored PLCopen LD file (interop, not just our own output)", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201">
  <contentHeader name="Hand"/>
  <types><pous>
    <pou name="P" pouType="program">
      <interface>
        <inputVars><variable name="X"><type><BOOL/></type></variable></inputVars>
        <outputVars><variable name="Y"><type><BOOL/></type></variable></outputVars>
      </interface>
      <body><LD>
        <leftPowerRail localId="1"><position x="0" y="20"/><connectionPointOut/></leftPowerRail>
        <contact localId="2"><position x="100" y="20"/><connectionPointIn><connection refLocalId="1"/></connectionPointIn><variable>X</variable></contact>
        <coil localId="3"><position x="200" y="20"/><connectionPointIn><connection refLocalId="2"/></connectionPointIn><variable>Y</variable></coil>
      </LD></body>
    </pou>
  </pous></types>
</project>`;
    const res = importPlcopenXml(xml);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project.name).toBe("Hand");
    const pou = res.project.pous[0];
    expect(pou.name).toBe("P");
    expect(pou.body.language).toBe("LD");
    if (pou.body.language !== "LD") return;
    expect(pou.body.networks[0].logic).toEqual({ kind: "contact", variable: "X" });
    expect(pou.body.networks[0].coils).toEqual([{ variable: "Y", kind: "coil" }]);
    // Round-trips to ST.
    expect(transpilePouProject(res.project).code).toContain("Y := X;");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (b) LAD / FBD / SFC → ST GOLDEN lowering
// ══════════════════════════════════════════════════════════════════════════════
describe("POU → ST transpile (golden lowering + provenance + determinism)", () => {
  it("LAD lowers series/parallel + seal-in with an (* [IEC LD ...] *) marker", () => {
    const { code, iecCommentMap } = transpilePouProject(ladPou());
    expect(code).toContain("(* [IEC LD #rung1] *)");
    expect(code).toContain("Motor := ((Start OR Motor) AND NOT Stop AND Interlock);");
    expect(code).toContain("PROGRAM MotorControl");
    expect(code).toContain("VAR_INPUT");
    expect(iecCommentMap["(* [IEC LD #rung1] *)"]).toBe("rung1");
  });

  it("negated / set / reset coils lower to the right ST", () => {
    const p = parsePouProject({
      name: "Coils", pous: [{
        name: "C", pouType: "program",
        vars: [{ name: "A", type: "BOOL", section: "VAR_INPUT" }, { name: "Q", type: "BOOL", section: "VAR_OUTPUT" }],
        body: { language: "LD", networks: [{ logic: { kind: "contact", variable: "A" }, coils: [
          { variable: "Q", kind: "set" }, { variable: "Q", kind: "reset" }, { variable: "Q", kind: "negated" },
        ] }] },
      }],
    } as unknown).project as PouProject;
    const { code } = transpilePouProject(p);
    expect(code).toContain("IF A THEN Q := TRUE; END_IF;");
    expect(code).toContain("IF A THEN Q := FALSE; END_IF;");
    expect(code).toContain("Q := NOT (A);");
  });

  it("FBD inlines the block DAG into fully-parenthesised ST expressions", () => {
    const { code } = transpilePouProject(fbdPou());
    expect(code).toContain("(* [IEC FBD #net1] *)");
    expect(code).toContain("Sum := (A + B);");
    expect(code).toContain("Big := (((A + B) > 100) AND Enable);");
    expect(code).toContain("FUNCTION_BLOCK Compute");
  });

  it("FBD stateful FB (TON) → declared VAR instance + per-scan call + `.Q` read (not inlined)", () => {
    const p = parsePouProject({
      name: "TimerProj", pous: [{
        name: "Delay", pouType: "program",
        vars: [
          { name: "Trig", type: "BOOL", section: "VAR_INPUT" },
          { name: "Pre", type: "TIME", section: "VAR_INPUT" },
          { name: "Q", type: "BOOL", section: "VAR_OUTPUT" },
        ],
        body: { language: "FBD", networks: [{
          blocks: [{ id: "t1", type: "TON", inputs: [
            { name: "IN", source: { kind: "var", name: "Trig" } },
            { name: "PT", source: { kind: "var", name: "Pre" } },
          ] }],
          outputs: [{ variable: "Q", source: { kind: "block", blockId: "t1", pin: "Q" } }],
        }] },
      }],
    } as unknown).project as PouProject;
    // The linter must NOT block a stateful FB (feature is reachable through the gated flow).
    expect(lintPouProject(p).ok).toBe(true);
    const { code } = transpilePouProject(p);
    // instance declared in VAR (with the FB type as the declared type token)
    expect(code).toContain("fb_net1_t1 : TON;");
    // per-scan instance call (never re-inlined as a sub-expression)
    expect(code).toContain("fb_net1_t1(IN := Trig, PT := Pre);");
    // the output reads the instance pin, not a fresh call
    expect(code).toContain("Q := fb_net1_t1.Q;");
    // regression: no inline formal call for the timer
    expect(code).not.toContain("TON(IN");
  });

  it("FBD chained stateful FBs emit calls in dependency order (feeding FB first)", () => {
    const p = parsePouProject({
      name: "Chain", pous: [{
        name: "C", pouType: "program",
        vars: [
          { name: "In1", type: "BOOL", section: "VAR_INPUT" },
          { name: "Pre", type: "TIME", section: "VAR_INPUT" },
          { name: "Cnt", type: "INT", section: "VAR_OUTPUT" },
        ],
        body: { language: "FBD", networks: [{
          blocks: [
            { id: "t1", type: "TON", inputs: [
              { name: "IN", source: { kind: "var", name: "In1" } },
              { name: "PT", source: { kind: "var", name: "Pre" } },
            ] },
            // CTU counts the timer's rising Q → its CU input reads t1.Q
            { id: "c1", type: "CTU", inputs: [
              { name: "CU", source: { kind: "block", blockId: "t1", pin: "Q" } },
              { name: "PV", source: { kind: "const", value: 10 } },
            ] },
          ],
          outputs: [{ variable: "Cnt", source: { kind: "block", blockId: "c1", pin: "CV" } }],
        }] },
      }],
    } as unknown).project as PouProject;
    const { code } = transpilePouProject(p);
    const iTon = code.indexOf("fb_net1_t1(");
    const iCtu = code.indexOf("fb_net1_c1(");
    expect(iTon).toBeGreaterThanOrEqual(0);
    expect(iCtu).toBeGreaterThan(iTon); // feeding FB called before the consumer
    expect(code).toContain("fb_net1_c1(CU := fb_net1_t1.Q, PV := 10);");
    expect(code).toContain("Cnt := fb_net1_c1.CV;");
  });

  it("SFC lowers to a CASE-of-state machine with a synthesised state var", () => {
    const { code } = transpilePouProject(sfcPou());
    expect(code).toContain("(* [IEC SFC #Sequence] *)");
    expect(code).toContain("sfc_Sequence_step : INT := 0;");
    expect(code).toContain("CASE sfc_Sequence_step OF");
    expect(code).toContain("0: (* step Init [initial] *)");
    expect(code).toContain("IF (GoNext) THEN sfc_Sequence_step := 1;");
    expect(code).toContain("IF (Done) THEN sfc_Sequence_step := 2;");
    expect(code).toContain("END_CASE;");
  });

  it("keeps the safety caveat header + is deterministic across runs", () => {
    const a = transpilePouProject(mixedProject()).code;
    const b = transpilePouProject(mixedProject()).code;
    expect(a).toBe(b);
    expect(a).toContain("E-stop / SIL safety stays on the certified L1 PLC");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (c) Semantic linter
// ══════════════════════════════════════════════════════════════════════════════
describe("POU semantic linter (blocking gate)", () => {
  it("passes a clean project (no errors)", () => {
    expect(lintPouProject(mixedProject()).ok).toBe(true);
  });

  it("catches an UNDECLARED variable (LD contact on an undeclared name)", () => {
    const p = parsePouProject({
      name: "U", pous: [{
        name: "P", pouType: "program",
        vars: [{ name: "Y", type: "BOOL", section: "VAR_OUTPUT" }],
        body: { language: "LD", networks: [{ logic: { kind: "contact", variable: "GHOST" }, coils: [{ variable: "Y", kind: "coil" }] }] },
      }],
    } as unknown).project as PouProject;
    const r = lintPouProject(p);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "undefined-variable" && /GHOST/.test(d.message))).toBe(true);
  });

  it("catches a TYPE MISMATCH (coil driving a non-BOOL var) + (REAL into a logical block)", () => {
    const coilBad = parsePouProject({
      name: "T1", pous: [{
        name: "P", pouType: "program",
        vars: [{ name: "A", type: "BOOL", section: "VAR_INPUT" }, { name: "Count", type: "INT", section: "VAR_OUTPUT" }],
        body: { language: "LD", networks: [{ logic: { kind: "contact", variable: "A" }, coils: [{ variable: "Count", kind: "coil" }] }] },
      }],
    } as unknown).project as PouProject;
    const r1 = lintPouProject(coilBad);
    expect(r1.ok).toBe(false);
    expect(r1.diagnostics.some((d) => d.rule === "type-mismatch")).toBe(true);

    const logicBad = parsePouProject({
      name: "T2", pous: [{
        name: "P", pouType: "program",
        vars: [{ name: "R", type: "REAL", section: "VAR_INPUT" }, { name: "Q", type: "BOOL", section: "VAR_OUTPUT" }],
        body: { language: "FBD", networks: [{
          blocks: [{ id: "b1", type: "AND", inputs: [
            { name: "IN1", source: { kind: "var", name: "R" } },
            { name: "IN2", source: { kind: "const", value: true } },
          ] }],
          outputs: [{ variable: "Q", source: { kind: "block", blockId: "b1" } }],
        }] },
      }],
    } as unknown).project as PouProject;
    const r2 = lintPouProject(logicBad);
    expect(r2.ok).toBe(false);
    expect(r2.diagnostics.some((d) => d.rule === "type-mismatch")).toBe(true);
  });

  it("BLOCKS an unsupported SFC action qualifier (S/R/P/L/D) — only N is lowered", () => {
    for (const q of ["S", "R", "P", "L", "D"]) {
      const p = parsePouProject({
        name: "Q", pous: [{
          name: "P", pouType: "program",
          vars: [{ name: "Go", type: "BOOL", section: "VAR_INPUT" }, { name: "Lamp", type: "BOOL", section: "VAR_OUTPUT" }],
          body: { language: "SFC",
            steps: [
              { name: "Init", initial: true, actions: [] },
              { name: "Run", actions: [{ qualifier: q, actionText: "Lamp := TRUE;" }] },
            ],
            transitions: [{ from: "Init", to: "Run", condition: "Go" }, { from: "Run", to: "Init", condition: "NOT Go" }],
          },
        }],
      } as unknown).project as PouProject;
      const r = lintPouProject(p);
      expect(r.ok, `qualifier ${q} must block`).toBe(false);
      expect(r.diagnostics.some((d) => d.rule === "unsupported-sfc-qualifier")).toBe(true);
    }
  });

  it("does NOT block the N qualifier (the correct, supported path stays green)", () => {
    expect(lintPouProject(sfcPou()).ok).toBe(true); // sfcPou uses only N actions
  });

  it("if lint is bypassed, transpile OMITS a non-N action body (never silently-wrong ST)", () => {
    const p = parsePouProject({
      name: "Q", pous: [{
        name: "P", pouType: "program",
        vars: [{ name: "Go", type: "BOOL", section: "VAR_INPUT" }, { name: "Lamp", type: "BOOL", section: "VAR_OUTPUT" }],
        body: { language: "SFC",
          steps: [
            { name: "Init", initial: true, actions: [] },
            { name: "Run", actions: [{ qualifier: "S", actionText: "Lamp := TRUE;" }] },
          ],
          transitions: [{ from: "Init", to: "Run", condition: "Go" }, { from: "Run", to: "Init", condition: "NOT Go" }],
        },
      }],
    } as unknown).project as PouProject;
    const { code } = transpilePouProject(p);
    expect(code).not.toContain("Lamp := TRUE;"); // the wrong body is NOT emitted
    expect(code).toContain("UNSUPPORTED in POU→ST lowering");
  });

  it("catches an UNREACHABLE SFC step (no incoming transition, not initial)", () => {
    const p = parsePouProject({
      name: "S", pous: [{
        name: "P", pouType: "program",
        vars: [{ name: "Go", type: "BOOL", section: "VAR_INPUT" }],
        body: { language: "SFC",
          steps: [{ name: "A", initial: true, actions: [] }, { name: "B", actions: [] }, { name: "Orphan", actions: [] }],
          transitions: [{ from: "A", to: "B", condition: "Go" }],
        },
      }],
    } as unknown).project as PouProject;
    const r = lintPouProject(p);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.rule === "unreachable-step" && /Orphan/.test(d.message))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (d) Adapter contract + hard gate + existing ST/LD unchanged
// ══════════════════════════════════════════════════════════════════════════════
describe("Iec61131PouAdapter (flows through the ProgrammingAdapter contract)", () => {
  const adapter = new Iec61131PouAdapter();
  const src = (p: PouProject) => ({ kind: "iec61131-pou" as const, language: "pou-json", content: JSON.stringify(p) });

  it("validate() ok for a clean project", async () => {
    expect((await adapter.validate(src(mixedProject()))).ok).toBe(true);
  });

  it("compile() emits ST + openplc ref for a clean project", async () => {
    const b = await adapter.compile(src(ladPou()));
    expect(b.ok).toBe(true);
    expect(b.outputRef).toMatch(/^openplc:\/\/pou\//);
    expect(String(b.meta?.st)).toContain("Motor := ((Start OR Motor) AND NOT Stop AND Interlock);");
    expect(b.meta?.iecCommentMap).toBeDefined();
  });

  it("compile() HARD-GATES codegen on a linter error (non-ok build, no ST)", async () => {
    const bad = parsePouProject({
      name: "B", pous: [{
        name: "P", pouType: "program", vars: [{ name: "Y", type: "BOOL", section: "VAR_OUTPUT" }],
        body: { language: "LD", networks: [{ logic: { kind: "contact", variable: "GHOST" }, coils: [{ variable: "Y", kind: "coil" }] }] },
      }],
    } as unknown).project as PouProject;
    const b = await adapter.compile(src(bad));
    expect(b.ok).toBe(false);
    expect(b.meta?.st).toBeUndefined();
    expect(b.meta?.blocked).toBe(true);
  });

  it("deploy() → failed (open runtime only, none configured)", async () => {
    const r = await adapter.deploy({ ok: true, diagnostics: [] }, { stage: "staging", idempotencyKey: "k", hitl: { actionId: "a", requestedBy: 1 } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OPEN runtime|OpenPLC/);
  });

  it("previewPouTranspile blocks on lint error (ok false, code null)", () => {
    const bad = parsePouProject({
      name: "B", pous: [{
        name: "P", pouType: "program", vars: [{ name: "Y", type: "BOOL", section: "VAR_OUTPUT" }],
        body: { language: "LD", networks: [{ logic: { kind: "contact", variable: "GHOST" }, coils: [{ variable: "Y", kind: "coil" }] }] },
      }],
    } as unknown).project as PouProject;
    const p = previewPouTranspile(bad);
    expect(p.ok).toBe(false);
    expect(p.code).toBeNull();
  });
});

describe("registry + existing IEC adapters unchanged", () => {
  it("registers iec61131-pou alongside the existing iec61131-st / iec61131-ld", () => {
    expect(programmingRegistry.isImplemented("iec61131-pou")).toBe(true);
    expect(programmingRegistry.isImplemented("iec61131-st")).toBe(true);
    expect(programmingRegistry.isImplemented("iec61131-ld")).toBe(true);
  });

  it("the existing ST/LD adapters still validate + compile as before (goldens intact)", async () => {
    const st = new Iec61131StAdapter();
    const stB = await st.compile({ kind: "iec61131-st", language: "st", content: "x := TRUE;\ny := FALSE;" });
    expect(stB.outputRef).toContain("openplc://st/");

    const ld = new Iec61131LdAdapter();
    const ldB = await ld.compile({ kind: "iec61131-ld", language: "ld", content: "Y0 := X0 AND NOT X1\nY1 := Y0 OR X2" });
    expect(ldB.ok).toBe(true);
    expect(String(ldB.meta?.st)).toContain("Y0 := X0 AND NOT X1;");
  });
});
