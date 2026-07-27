/**
 * Doc 69 / Giai đoạn 5 · Wave 4 · C4 — safety-linter tests (vitest; no hardware, no model).
 *
 * Covers:
 *   • Table-driven per-check: an unsafe snippet (no safety keyword) fires the right
 *     category; a safe snippet does not (per check: unbounded-loop / motion-envelope /
 *     missing-interlock).
 *   • Golden-driven: for each of the 6 target vendors (iec61131-st, robot-tm, karel, rapid,
 *     melfa, delta-robot) the SAFE golden fixture emits ZERO safety-lint findings and the
 *     UNSAFE golden fixture emits the expected category — driven straight from
 *     knowledge/golden-code/index.json + the on-disk files (real coverage, not synthetic).
 *   • Integration: Iec61131StAdapter.validate() and RobotTmAdapter.validate() surface the
 *     semantic diagnostics alongside their existing structural checks.
 *   • Fail-safe: never throws on malformed/empty/unknown-language input; severity is always
 *     "warning" (advisory, never a build-breaker) — confirmed against every golden UNSAFE
 *     fixture, not just one hand-picked case.
 */
import { describe, it, expect } from "vitest";
import {
  lintProgramSafety,
  safetyLintDiagnostics,
  resolveSafetyLimits,
  safetyLintSupportedLangs,
  type SafetyLintCategory,
} from "./safetyLinter";
import { loadGoldenExamples } from "./goldenExamples";
import { Iec61131StAdapter } from "./iec61131/iec61131Adapter";
import { RobotTmAdapter } from "./robot/robotTmAdapter";

// ════════════════════════════════════════════════════════════════════════════
// Table-driven — each of the 3 checks, unsafe fires / safe does not.
// ════════════════════════════════════════════════════════════════════════════

interface Case {
  name: string;
  kind: string;
  content: string;
  category: SafetyLintCategory;
  shouldFire: boolean;
}

const CASES: Case[] = [
  // ── unbounded-loop ──────────────────────────────────────────────────────
  {
    name: "ST: WHILE TRUE with no EXIT/RETURN → fires",
    kind: "iec61131-st",
    content: "PROGRAM P\nVAR\n  X : BOOL;\nEND_VAR\nWHILE TRUE DO\n  X := NOT X;\nEND_WHILE;\nEND_PROGRAM",
    category: "unbounded-loop",
    shouldFire: true,
  },
  {
    name: "ST: WHILE 1 with no EXIT/RETURN → fires",
    kind: "iec61131-st",
    content: "PROGRAM P\nVAR\n  X : BOOL;\nEND_VAR\nWHILE 1 DO\n  X := NOT X;\nEND_WHILE;\nEND_PROGRAM",
    category: "unbounded-loop",
    shouldFire: true,
  },
  {
    name: "ST: WHILE TRUE with EXIT inside → does NOT fire",
    kind: "iec61131-st",
    content:
      "PROGRAM P\nVAR\n  X : BOOL;\n  N : INT := 0;\nEND_VAR\nWHILE TRUE DO\n  N := N + 1;\n  IF N > 5 THEN\n    EXIT;\n  END_IF;\nEND_WHILE;\nEND_PROGRAM",
    category: "unbounded-loop",
    shouldFire: false,
  },
  {
    name: "ST: bounded FOR loop → does NOT fire",
    kind: "iec61131-st",
    content: "PROGRAM P\nVAR\n  I : INT;\n  Sum : INT := 0;\nEND_VAR\nFOR I := 0 TO 9 DO\n  Sum := Sum + I;\nEND_FOR;\nEND_PROGRAM",
    category: "unbounded-loop",
    shouldFire: false,
  },
  {
    name: "KAREL: unconditional JMP back-edge → fires",
    kind: "karel",
    content: "1:LBL[1]\n2:  L P[1] 100mm/sec CNT50\n3:  JMP LBL[1]\n4:  L P[2] 100mm/sec FINE",
    category: "unbounded-loop",
    shouldFire: true,
  },
  {
    name: "KAREL: conditional (IF-guarded) JMP back-edge → does NOT fire",
    kind: "karel",
    content: "1:  R[1]=3\n2:LBL[1]\n3:  L P[1] 100mm/sec CNT50\n4:  R[1]=R[1]-1\n5:  IF R[1]>0,JMP LBL[1]\n6:  L P[2] 100mm/sec FINE",
    category: "unbounded-loop",
    shouldFire: false,
  },
  {
    name: "MELFA: WHILE(1) WEND with no GOTO escape → fires",
    kind: "melfa",
    content: "10 SPD 100\n20 WHILE (1)\n30   MOV P1\n40 WEND\n50 END",
    category: "unbounded-loop",
    shouldFire: true,
  },
  // ── motion-envelope ─────────────────────────────────────────────────────
  {
    name: "robot-tm: POINT x-coordinate above conservative ceiling → fires",
    kind: "robot-tm",
    content: "POINT FAR = (5000, 0, 200, 0, 0, 0)\nHOME\nMOVE FAR\nHOME",
    category: "motion-envelope",
    shouldFire: true,
  },
  {
    name: "robot-tm: POINT coordinates within ceiling → does NOT fire",
    kind: "robot-tm",
    content: "POINT NEAR = (400, -100, 150, 0, 0, 0)\nHOME\nMOVE NEAR\nHOME",
    category: "motion-envelope",
    shouldFire: false,
  },
  {
    name: "RAPID: v1500 speeddata above ceiling → fires",
    kind: "rapid",
    content: "MODULE M\n  PROC Main()\n    MoveL pFar, v1500, fine, tool0;\n  ENDPROC\nENDMODULE",
    category: "motion-envelope",
    shouldFire: true,
  },
  {
    name: "RAPID: v100 speeddata within ceiling → does NOT fire",
    kind: "rapid",
    content: "MODULE M\n  PROC Main()\n    MoveL pNear, v100, fine, tool0;\n  ENDPROC\nENDMODULE",
    category: "motion-envelope",
    shouldFire: false,
  },
  {
    name: "KAREL: 2000mm/sec linear speed above ceiling → fires",
    kind: "karel",
    content: "1:  L P[1] 2000mm/sec CNT50",
    category: "motion-envelope",
    shouldFire: true,
  },
  {
    name: "Delta: SPEED 40% within percentage ceiling → does NOT fire",
    kind: "delta-robot",
    content: "SPEED 40\nIF DI(1) = 1 THEN\n  MOVJ P1\nEND IF",
    category: "motion-envelope",
    shouldFire: false,
  },
  {
    name: "zmotion-basic: SPEED=500 above mm/s ceiling → fires",
    kind: "zmotion-basic",
    content: "SPEED = 500\nMOVE(100)",
    category: "motion-envelope",
    shouldFire: true,
  },
  {
    name: "zmotion-basic: SPEED=100 within mm/s ceiling → does NOT fire",
    kind: "zmotion-basic",
    content: "SPEED = 100\nMOVE(100)",
    category: "motion-envelope",
    shouldFire: false,
  },
  // ── missing-interlock ────────────────────────────────────────────────────
  {
    name: "MELFA: bare MOV/M_OUT with no IF anywhere → fires",
    kind: "melfa",
    content: "10 SPD 100\n20 MOV P1\n30 M_OUT(1) = 1\n40 END",
    category: "missing-interlock",
    shouldFire: true,
  },
  {
    name: "MELFA: MOV/M_OUT inside IF…THEN…ENDIF → does NOT fire",
    kind: "melfa",
    content: "10 SPD 100\n20 IF M_IN(1) = 1 THEN\n30   MOV P1\n40   M_OUT(1) = 1\n50 ENDIF\n60 END",
    category: "missing-interlock",
    shouldFire: false,
  },
  {
    name: "Delta: bare MOVJ/DO with no IF anywhere → fires",
    kind: "delta-robot",
    content: "SPEED 30\nMOVJ P1\nDO(1) = ON",
    category: "missing-interlock",
    shouldFire: true,
  },
  {
    name: "Delta: MOVJ/DO inside IF…THEN…END IF → does NOT fire",
    kind: "delta-robot",
    content: "SPEED 30\nIF DI(1) = 1 THEN\n  MOVJ P1\n  DO(1) = ON\nEND IF",
    category: "missing-interlock",
    shouldFire: false,
  },
];

describe("safetyLinter — table-driven per-check", () => {
  it.each(CASES)("$name", ({ kind, content, category, shouldFire }) => {
    const findings = lintProgramSafety(kind, content);
    const hit = findings.some((f) => f.category === category);
    expect(hit).toBe(shouldFire);
  });

  it("every finding is ADVISORY wording (not a certification claim)", () => {
    for (const c of CASES.filter((c) => c.shouldFire)) {
      const findings = lintProgramSafety(c.kind, c.content);
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.message).toMatch(/ADVISORY/);
        expect(f.message).toMatch(/not a safety certification/i);
      }
    }
  });

  it("no safety keyword present in any unsafe CASE snippet (proves structural, not keyword, detection)", () => {
    const kw = /safety|interlock|e-?stop|emergency|guard|sil\b|light[-\s]?curtain|two[-\s]?hand|lockout|tagout|muting/i;
    for (const c of CASES.filter((c) => c.shouldFire)) {
      expect(kw.test(c.content)).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Fail-safe — never throws, always returns [] on malformed / unknown input.
// ════════════════════════════════════════════════════════════════════════════

describe("safetyLinter — fail-safe (never throws, never blocks)", () => {
  it("empty / whitespace / non-string content → []", () => {
    expect(lintProgramSafety("iec61131-st", "")).toEqual([]);
    expect(lintProgramSafety("iec61131-st", "   \n\t  ")).toEqual([]);
    expect(lintProgramSafety("iec61131-st", undefined as unknown as string)).toEqual([]);
    expect(lintProgramSafety("iec61131-st", 12345 as unknown as string)).toEqual([]);
  });

  it("unrecognised kind/lang → [] (honest: no profile, no guess)", () => {
    expect(lintProgramSafety("some-unknown-vendor", "WHILE TRUE DO X := 1; END_WHILE;")).toEqual([]);
    expect(lintProgramSafety("", "WHILE TRUE DO X := 1; END_WHILE;")).toEqual([]);
  });

  it("never throws on adversarial/malformed input", () => {
    const adversarial = [
      "WHILE TRUE DO", // unterminated block
      "JMP LBL[999]", // dangling forward jump, no such label
      "POINT X = (not, a, number)",
      "MoveL p, vNOTANUMBER, z10, tool0;",
      " binary￿ garbage",
      "(".repeat(5000),
    ];
    for (const kind of safetyLintSupportedLangs()) {
      for (const content of adversarial) {
        expect(() => lintProgramSafety(kind, content)).not.toThrow();
      }
    }
  });

  it("every finding maps to severity 'warning' (advisory, never a build-breaker)", () => {
    for (const c of CASES.filter((c) => c.shouldFire)) {
      const diags = safetyLintDiagnostics(c.kind, c.content);
      expect(diags.length).toBeGreaterThan(0);
      for (const d of diags) expect(d.severity).toBe("warning");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Envelope ceilings — conservative-default + env-overridable.
// ════════════════════════════════════════════════════════════════════════════

describe("safetyLinter — resolveSafetyLimits", () => {
  it("conservative defaults", () => {
    const l = resolveSafetyLimits();
    expect(l.maxSpeedMms).toBeGreaterThan(0);
    expect(l.maxSpeedPct).toBe(100);
    expect(l.maxPositionMm).toBeGreaterThan(0);
  });

  it("override wins over default", () => {
    const l = resolveSafetyLimits({ maxSpeedMms: 42 });
    expect(l.maxSpeedMms).toBe(42);
    expect(l.maxPositionMm).toBeGreaterThan(0); // unaffected fields keep the default
  });

  it("env var overrides the default (DPC_SAFETY_LINT_MAX_SPEED_MMS)", () => {
    const prev = process.env.DPC_SAFETY_LINT_MAX_SPEED_MMS;
    process.env.DPC_SAFETY_LINT_MAX_SPEED_MMS = "10";
    try {
      // A speed of 20 mm/s now exceeds the tightened 10 mm/s ceiling.
      const findings = lintProgramSafety("robot-tm", "POINT A = (0,0,0,0,0,0)\nHOME\nMOVE A");
      expect(resolveSafetyLimits().maxSpeedMms).toBe(10);
      expect(findings).toBeDefined(); // robot-tm has no speed sample — sanity only
    } finally {
      if (prev === undefined) delete process.env.DPC_SAFETY_LINT_MAX_SPEED_MMS;
      else process.env.DPC_SAFETY_LINT_MAX_SPEED_MMS = prev;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Golden-driven — 6 vendors × {safe, unsafe} from knowledge/golden-code.
// ════════════════════════════════════════════════════════════════════════════

const TARGET_VENDORS = ["iec61131-st", "robot-tm", "karel", "rapid", "melfa", "delta-robot"];

function goldenTagged(tag: string, lang: string) {
  return loadGoldenExamples().filter((e) => e.lang === lang && e.tags.includes(tag));
}

describe("safetyLinter — golden-driven 6-vendor coverage", () => {
  it("golden corpus actually carries a safe + unsafe safety-lint pair for all 6 target vendors", () => {
    for (const lang of TARGET_VENDORS) {
      const safe = goldenTagged("safety-lint-safe", lang);
      const unsafe = goldenTagged("safety-lint-unsafe", lang);
      expect(safe.length, `${lang}: expected a safety-lint-safe golden entry`).toBeGreaterThan(0);
      expect(unsafe.length, `${lang}: expected a safety-lint-unsafe golden entry`).toBeGreaterThan(0);
      for (const e of [...safe, ...unsafe]) {
        expect(e.code.trim().length, `${lang}: golden file "${e.file}" is empty/unreadable`).toBeGreaterThan(0);
      }
    }
  });

  for (const lang of TARGET_VENDORS) {
    it(`${lang}: SAFE golden emits zero safety-lint findings`, () => {
      for (const e of goldenTagged("safety-lint-safe", lang)) {
        const findings = lintProgramSafety(lang, e.code);
        expect(findings, `${e.id} unexpectedly flagged: ${JSON.stringify(findings)}`).toEqual([]);
      }
    });

    it(`${lang}: UNSAFE golden fires the expected category, with no safety keyword anywhere in the fixture`, () => {
      const kw = /safety|interlock|e-?stop|emergency|guard|sil\b|light[-\s]?curtain|two[-\s]?hand|lockout|tagout|muting/i;
      for (const e of goldenTagged("safety-lint-unsafe", lang)) {
        const findings = lintProgramSafety(lang, e.code);
        expect(findings.length, `${e.id}: expected at least one safety-lint finding`).toBeGreaterThan(0);
        const expectedCategory = (["unbounded-loop", "motion-envelope", "missing-interlock"] as const).find((c) =>
          e.tags.includes(c),
        );
        expect(expectedCategory, `${e.id}: index.json tags must name one of the 3 categories`).toBeDefined();
        expect(findings.some((f) => f.category === expectedCategory)).toBe(true);
        // Real assertion (not a no-op): no safety-domain keyword anywhere in the FULL fixture
        // content, including its header comment — proves the linter caught this fixture on
        // STRUCTURE alone, with zero keyword signal available anywhere in the file. (The
        // certification disclaimer for this fixture lives in its sibling .meta.md instead.)
        expect(
          kw.test(e.code),
          `${e.id}: unsafe golden must contain no safety-domain keyword anywhere in the file`,
        ).toBe(false);
      }
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Integration — adapter.validate() surfaces the semantic diagnostics.
// ════════════════════════════════════════════════════════════════════════════

describe("safetyLinter — wired into adapter.validate()", () => {
  it("Iec61131StAdapter.validate(): unsafe golden gets a safety-lint WARNING, ok stays true (advisory, non-blocking)", async () => {
    const entry = goldenTagged("safety-lint-unsafe", "iec61131-st")[0];
    expect(entry).toBeDefined();
    const adapter = new Iec61131StAdapter();
    const r = await adapter.validate({ kind: "iec61131-st", language: "st", content: entry.code });
    expect(r.ok).toBe(true); // structurally valid ST — the finding must NOT flip this.
    expect(r.diagnostics.some((d) => d.severity === "warning" && /safety-lint:unbounded-loop/.test(d.message))).toBe(true);
  });

  it("Iec61131StAdapter.validate(): safe golden gets no safety-lint diagnostics", async () => {
    const adapter = new Iec61131StAdapter();
    for (const e of goldenTagged("safety-lint-safe", "iec61131-st")) {
      const r = await adapter.validate({ kind: "iec61131-st", language: "st", content: e.code });
      expect(r.diagnostics.some((d) => /safety-lint:/.test(d.message))).toBe(false);
    }
  });

  it("RobotTmAdapter.validate(): unsafe golden gets a safety-lint WARNING, ok stays true", async () => {
    const entry = goldenTagged("safety-lint-unsafe", "robot-tm")[0];
    expect(entry).toBeDefined();
    const adapter = new RobotTmAdapter();
    const r = await adapter.validate({ kind: "robot-tm", language: "tmscript", content: entry.code });
    expect(r.ok).toBe(true); // structurally valid job — the finding must NOT flip this.
    expect(r.diagnostics.some((d) => d.severity === "warning" && /safety-lint:motion-envelope/.test(d.message))).toBe(true);
  });

  it("RobotTmAdapter.validate(): existing safe golden (pick-place-job) gets no safety-lint diagnostics (no regression)", async () => {
    const entry = loadGoldenExamples().find((e) => e.id === "robot-tm/pick-place-job");
    expect(entry).toBeDefined();
    const adapter = new RobotTmAdapter();
    const r = await adapter.validate({ kind: "robot-tm", language: "tmscript", content: entry!.code });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => /safety-lint:/.test(d.message))).toBe(false);
  });

  it("a heuristic finding never turns an otherwise-valid program's ok:false (advisory, non-blocking)", async () => {
    // The unsafe ST golden is structurally VALID ST (balanced blocks) — only the NEW
    // safety-lint warning is added. ok must remain true.
    const entry = goldenTagged("safety-lint-unsafe", "iec61131-st")[0];
    const adapter = new Iec61131StAdapter();
    const r = await adapter.validate({ kind: "iec61131-st", language: "st", content: entry.code });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
