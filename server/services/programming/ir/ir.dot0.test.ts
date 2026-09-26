/**
 * Doc 80 Đợt 0 — Task 5 (Phụ lục C §3 IR-01 / IR-03 / IR-04). PURE / in-memory only.
 *
 *   • IR-01 — every string field that reaches generated code passes a whitelist:
 *       lint reports an ERROR (io-ref-invalid / invalid-identifier / unsafe-string), the
 *       gated transpile yields NO code, and the emitters THROW (defence layer 2) — a fuzz
 *       corpus of ≥50 payloads × every string field × {URScript, ROS2} ⇒ 0 foreign lines.
 *   • IR-03 — acceleration is IR mm/s² (like every other IR length unit) → URScript m/s²
 *       and a ROS2 MoveIt acceleration-scaling factor; lint `accel-limit` blocks over-ceiling.
 *   • IR-04 — nested count-loops get their OWN counter per depth; a 2×3 nest runs its body
 *       6 times (checked by EXECUTING the generated URScript with a tiny interpreter).
 */
import { describe, it, expect } from "vitest";
import type { Flow, IrBlock, FunctionBlockDef } from "./irModel";
import { lintFlow } from "./irSafetyLinter";
import { transpileFlow } from "./transpilers/registry";
import { transpileToUrscript } from "./transpilers/irToUrscript";
import { transpileToRos2 } from "./transpilers/irToRos2";
import { IrUnsafeTokenError } from "./irSafeTokens";

// ── IR-01 fuzz corpus (≥50). Every payload holds at least one character that is illegal in
// EVERY whitelist context (identifier, IO ref, label, unit, flow id). ────────────────────
const CORPUS: string[] = [
  `1"`,
  `1)`,
  `1)\nmovel(p[0.9,0.9,0.1,0,0,0], a=40, v=3)\n#`,
  `2, True)\nmovej([0,0,0,0,0,0], a=1.4, v=6)\n#`,
  `x"); os.system("id"); ("`,
  `x")\nimport os\nos.system("id")\n#`,
  `__import__('os').system('id')`,
  `os.system("id")`,
  `a;b`,
  `a#b`,
  `# comment`,
  `line1\nline2`,
  `line1\rline2`,
  `line1\r\nline2`,
  `a\u2028b`,
  `a\u2029b`,
  `a\u0085b`,
  `a\u000bb`,
  `a\u000cb`,
  `a\u0000b`,
  `a\tb`,
  `a\\b`,
  `a\\"b`,
  `\\n`,
  `'`,
  `'''`,
  `"""`,
  `a'b`,
  "a`b",
  "${x}",
  `{x}`,
  `a=1`,
  `a,b`,
  `a(b)`,
  `a[0]`,
  `a<b`,
  `a>b`,
  `a!b`,
  `a|b`,
  `a&b`,
  `a*b`,
  `a+b`,
  `a@b`,
  `a?b`,
  `a:b`,
  `a~b`,
  `a^b`,
  `\u202eevil`,
  `a\u200bb`,
  `（1）`,
  `😀`,
  `ｏｓ．ｓｙｓｔｅｍ（"id"）`,
  `\ud800`,
  `a\u00a0b`,
  `end\n`,
  `1) or True #`,
  `" + str(__import__("os").system("id")) + "`,
  `\\x22`,
  "A".repeat(65) + `"`,
  `\n`,
  `)`,
  `;`,
  ` leading`,
];

const SAFE = "SAFE1";

const moveLin = (accel = 500): IrBlock => ({
  id: "m1", type: "move_linear",
  target_pose: { x: 100, y: 100, z: 300, rx: 0, ry: 0, rz: 0 },
  speed_mms: 100, acceleration: accel, blend_radius: 0,
});

function base(blocks: IrBlock[], extra: Partial<Flow> = {}): Flow {
  return { flow_id: "fz", target_device_type: "universal-robots", version: 1, blocks, ...extra };
}

/** One string field of the IR that reaches generated code, and the lint rule guarding it. */
interface FieldCase {
  field: string;
  rule: "io-ref-invalid" | "invalid-identifier" | "unsafe-string";
  build: (tok: string) => Flow;
}

const FIELDS: FieldCase[] = [
  { field: "set_output.signal", rule: "io-ref-invalid", build: (t) => base([{ id: "a", type: "set_output", signal: t, value: true }]) },
  { field: "wait.signal_ref", rule: "io-ref-invalid", build: (t) => base([{ id: "a", type: "wait", signal_ref: t }]) },
  {
    field: "if_condition.signal_ref", rule: "io-ref-invalid",
    build: (t) => base([{ id: "a", type: "if_condition", signal_ref: t, operator: "eq", value: true, true_branch: [{ id: "c", type: "wait", ms: 10 }], false_branch: [] }]),
  },
  {
    field: "if_condition.value(string)", rule: "unsafe-string",
    build: (t) => base([{ id: "a", type: "if_condition", signal_ref: "1", operator: "eq", value: t, true_branch: [{ id: "c", type: "wait", ms: 10 }], false_branch: [] }]),
  },
  {
    field: "loop.while.signal_ref", rule: "io-ref-invalid",
    build: (t) => base([{ id: "a", type: "loop", while: { signal_ref: t, operator: "eq", value: true }, body: [{ id: "c", type: "wait", ms: 10 }] }]),
  },
  {
    field: "loop.while.value(string)", rule: "unsafe-string",
    build: (t) => base([{ id: "a", type: "loop", while: { signal_ref: "1", operator: "eq", value: t }, body: [{ id: "c", type: "wait", ms: 10 }] }]),
  },
  { field: "grip.tool_id", rule: "unsafe-string", build: (t) => base([{ id: "a", type: "grip", tool_id: t, force_limit_n: 10, timeout_ms: 100 }]) },
  { field: "release.tool_id", rule: "unsafe-string", build: (t) => base([{ id: "a", type: "release", tool_id: t }]) },
  { field: "set_analog.channel", rule: "io-ref-invalid", build: (t) => base([{ id: "a", type: "set_analog", channel: t, value: 1 }]) },
  { field: "set_analog.unit", rule: "unsafe-string", build: (t) => base([{ id: "a", type: "set_analog", channel: "AO1", value: 1, unit: t }]) },
  {
    field: "pid_control.input_channel", rule: "io-ref-invalid",
    build: (t) => base([{ id: "a", type: "pid_control", output_channel: "AO2", input_channel: t, setpoint: 1, kp: 1, ki: 0, kd: 0, output_min: 0, output_max: 10 }]),
  },
  {
    field: "pid_control.output_channel", rule: "io-ref-invalid",
    build: (t) => base([{ id: "a", type: "pid_control", output_channel: t, input_channel: "AI1", setpoint: 1, kp: 1, ki: 0, kd: 0, output_min: 0, output_max: 10 }]),
  },
  {
    field: "set_variable.name + expr var", rule: "invalid-identifier",
    build: (t) => base([
      { id: "a", type: "set_variable", name: t, expr: { kind: "lit", value: 1 } },
      { id: "b", type: "set_output", signal: "1", value: { kind: "var", name: t } },
    ]),
  },
  {
    field: "counter.name", rule: "invalid-identifier",
    build: (t) => base([{ id: "a", type: "counter", name: t, op: "reset", amount: 0 }]),
  },
  {
    field: "function_block.name + call_block.fb_name", rule: "invalid-identifier",
    build: (t) => base([{ id: "a", type: "call_block", fb_name: t, args: [] }], {
      function_blocks: [{ id: "fb1", name: t, params: [], body: [{ id: "c", type: "wait", ms: 10 }] } as FunctionBlockDef],
    }),
  },
  {
    field: "function_block param + call arg", rule: "invalid-identifier",
    build: (t) => base([{ id: "a", type: "call_block", fb_name: "sub", args: [{ name: t, value: 1 }] }], {
      function_blocks: [{ id: "fb1", name: "sub", params: [{ name: t, kind: "input", type: "number" }], body: [{ id: "c", type: "wait", ms: 10 }] }],
    }),
  },
  { field: "block.id", rule: "unsafe-string", build: (t) => base([{ id: t, type: "wait", ms: 10 }]) },
  {
    field: "function_block.id", rule: "unsafe-string",
    build: (t) => base([{ id: "a", type: "call_block", fb_name: "sub", args: [] }], {
      function_blocks: [{ id: t, name: "sub", params: [], body: [{ id: "c", type: "wait", ms: 10 }] }],
    }),
  },
  { field: "flow_id", rule: "unsafe-string", build: (t) => ({ ...base([{ id: "a", type: "wait", ms: 10 }]), flow_id: t }) },
];

/**
 * Structural skeleton of one generated line: string literals collapse to "S", comment text is
 * dropped. Two lines with the same skeleton differ ONLY inside a literal or a comment.
 */
function skeleton(line: string): string {
  const noStr = line.replace(/"(?:[^"\\\n]|\\.)*"/g, `"S"`);
  const hash = noStr.indexOf("#");
  return hash >= 0 ? noStr.slice(0, hash + 1) : noStr;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 0 foreign lines: same line count as the benign baseline, every skeleton equal to the
 * baseline's with the benign token allowed to become an identifier-safe token (sanitised
 * names), and no raw line-break / bidi / NUL characters anywhere in the output.
 */
function foreignLines(code: string, baseline: string): string[] {
  const out: string[] = [];
  const got = code.split("\n");
  const exp = baseline.split("\n");
  if (got.length !== exp.length) out.push(`line count ${got.length} ≠ baseline ${exp.length}`);
  // eslint-disable-next-line no-control-regex
  if (/[\r\u2028\u2029\u0085\u000b\u000c\u0000\u202a-\u202e\u2066-\u2069]/.test(code)) out.push("raw control/line-break char in output");
  const n = Math.min(got.length, exp.length);
  for (let i = 0; i < n; i++) {
    const pat = new RegExp("^" + escapeRe(skeleton(exp[i])).split(SAFE).join("[A-Za-z0-9_]+") + "$");
    if (!pat.test(skeleton(got[i]))) out.push(`L${i + 1}: ${JSON.stringify(got[i])} (baseline ${JSON.stringify(exp[i])})`);
  }
  return out;
}

const EMITTERS = [
  { name: "urscript", fn: transpileToUrscript },
  { name: "ros2", fn: transpileToRos2 },
] as const;

describe("IR-01 — string-field whitelist (fuzz corpus)", () => {
  it("corpus has ≥50 payloads and every field's benign baseline is lint-clean", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(50);
    for (const f of FIELDS) {
      const r = lintFlow(f.build(SAFE));
      expect(r.diagnostics.filter((d) => d.severity === "error"), f.field).toEqual([]);
    }
  });

  for (const f of FIELDS) {
    it(`lint blocks every payload in ${f.field} (rule ${f.rule})`, () => {
      const misses: string[] = [];
      for (const p of CORPUS) {
        const r = lintFlow(f.build(p));
        if (r.ok || !r.diagnostics.some((d) => d.rule === f.rule && d.severity === "error")) misses.push(JSON.stringify(p));
      }
      expect(misses).toEqual([]);
    });

    it(`gated transpile emits NO code for any payload in ${f.field}`, () => {
      for (const target of ["urscript", "ros2"] as const) {
        for (const p of CORPUS) {
          const res = transpileFlow(f.build(p), target);
          expect(res.ok, `${target} ${JSON.stringify(p)}`).toBe(false);
          expect(res.code).toBeUndefined();
        }
      }
    });

    for (const em of EMITTERS) {
      it(`${em.name} emitter: 0 foreign lines for every payload in ${f.field} (throws or stays inert)`, () => {
        const baseline = em.fn(f.build(SAFE)).code;
        const bad: string[] = [];
        let blocked = 0;
        for (const p of CORPUS) {
          let code: string;
          try {
            code = em.fn(f.build(p)).code;
          } catch (e) {
            if (e instanceof IrUnsafeTokenError) { blocked++; continue; }
            throw e;
          }
          const fl = foreignLines(code, baseline);
          if (fl.length > 0) bad.push(`${JSON.stringify(p)} → ${fl.join(" | ")}`);
        }
        expect(bad).toEqual([]);
        // defence layer 2: the emitter itself refuses every payload (not just the linter).
        expect(blocked).toBe(CORPUS.length);
      });
    }
  }

  it("identifier context also rejects keywords / reserved codegen names / leading digit", () => {
    const bad = ["end", "def", "while", "self", "run", "set_io", "ir_i_1", "__init__", "import", "True", "1abc", "a-b", "a.b", "x".repeat(65)];
    for (const name of bad) {
      const flow = base([{ id: "a", type: "set_variable", name, expr: { kind: "lit", value: 1 } }]);
      const r = lintFlow(flow);
      expect(r.diagnostics.some((d) => d.rule === "invalid-identifier"), name).toBe(true);
      expect(() => transpileToUrscript(flow), name).toThrow(IrUnsafeTokenError);
      expect(() => transpileToRos2(flow), name).toThrow(IrUnsafeTokenError);
    }
  });

  it("IO ref context accepts channel numbers + identifiers, rejects keywords / huge numbers", () => {
    for (const ok of ["0", "2", "12345", "DO1", "DI_3", "sensor_a"]) {
      expect(lintFlow(base([{ id: "a", type: "set_output", signal: ok, value: true }])).ok, ok).toBe(true);
    }
    for (const bad of ["123456", "end", "while", "-1", "1.5", "DO 1"]) {
      const r = lintFlow(base([{ id: "a", type: "set_output", signal: bad, value: true }]));
      expect(r.diagnostics.some((d) => d.rule === "io-ref-invalid"), bad).toBe(true);
    }
  });

  it("keeps existing legitimate values lint-clean (tool ids with '-', units like % / °C, free-text flow ids)", () => {
    const flow = base([
      { id: "n1abc2", type: "grip", tool_id: "gripper-1", force_limit_n: 10, timeout_ms: 100 },
      { id: "b-2", type: "set_analog", channel: "AO1", value: 1, unit: "%" },
      { id: "b3", type: "set_analog", channel: "AO1", value: 1, unit: "°C" },
      { id: "b4", type: "release", tool_id: "gripper_a" },
    ], { flow_id: "flow-1 luồng 2" });
    const r = lintFlow(flow);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ur = transpileToUrscript(flow).code;
    expect(ur).toContain("# unit=\\u00b0C");
    expect(ur).toContain('flow "flow-1 lu\\u1ed3ng 2"');
    expect(ur).toContain("def flow_1_lu_ng_2():");
    // every generated line is printable ASCII (static — em dash in fixed comments excluded)
    expect(/[^\x20-\x7e\n—]/.test(ur)).toBe(false);
  });

  it("ROS2 string literals are Python-escaped (defence layer 3 even behind the whitelist)", () => {
    const ros = transpileToRos2(base([{ id: "a", type: "grip", tool_id: "gripper-1", force_limit_n: 10, timeout_ms: 100 }])).code;
    expect(ros).toContain('self._gripper(True, "gripper-1", force_limit_n=10, timeout_ms=100)');
  });

  it("audit reproductions (doc 80 C §3 IR-01) are now lint errors with no code", () => {
    const urInj = base([{ id: "a", type: "set_output", signal: "1, True)\n  movel(p[0.9,0.9,0.1,0,0,0], a=40, v=3)\n  set_standard_digital_out(1", value: true }]);
    const rosInj = { ...base([{ id: "a", type: "wait", signal_ref: 'x")\n        os.system("id")\n        self.wait_signal("y' }]), target_device_type: "ros2" as const };
    for (const [flow, target] of [[urInj, "urscript"], [rosInj, "ros2"]] as const) {
      const lint = lintFlow(flow);
      expect(lint.ok).toBe(false);
      expect(lint.diagnostics.some((d) => d.rule === "io-ref-invalid")).toBe(true);
      const res = transpileFlow(flow, target);
      expect(res.ok).toBe(false);
      expect(res.code).toBeUndefined();
    }
  });
});

// ── IR-03 acceleration unit ─────────────────────────────────────────────────────────────
describe("IR-03 — acceleration unit (IR mm/s² → URScript m/s², ROS2 scaling) + accel-limit", () => {
  it("default new-block accel 500 mm/s² emits a=0.5 in URScript", () => {
    const code = transpileToUrscript(base([moveLin(500)])).code;
    expect(code).toMatch(/movel\(p\[0\.1, 0\.1, 0\.3, 0, 0, 0\], a=0\.5, v=0\.1, r=0\)/);
    expect(code).toContain("accel mm/s^2->m/s^2");
  });

  it("1200 mm/s² emits a=1.2 (UR pendant default) and stays lint-clean", () => {
    const flow = base([moveLin(1200)]);
    expect(transpileToUrscript(flow).code).toContain("a=1.2,");
    expect(lintFlow(flow).diagnostics.some((d) => d.rule === "accel-limit")).toBe(false);
  });

  it("ROS2 binds acceleration via set_max_acceleration_scaling_factor (nominal 1000 mm/s² = 1.0)", () => {
    const code = transpileToRos2(base([moveLin(500)])).code;
    expect(code).toContain("self.move_group.set_max_acceleration_scaling_factor(0.5)");
    const hi = transpileToRos2(base([moveLin(1200)])).code;
    expect(hi).toContain("self.move_group.set_max_acceleration_scaling_factor(1)");
  });

  it("lint accel-limit ERRORS over the ceiling (audit: a=40 m/s² and acceleration=100000)", () => {
    for (const a of [40_000, 100_000, 1_501]) {
      const r = lintFlow(base([moveLin(a)]));
      expect(r.ok, String(a)).toBe(false);
      expect(r.diagnostics.some((d) => d.rule === "accel-limit" && d.severity === "error"), String(a)).toBe(true);
    }
    expect(lintFlow(base([moveLin(1_500)])).ok).toBe(true);
    // env/profile override raises the ceiling
    expect(lintFlow(base([moveLin(40_000)]), { maxAccelMms2: 50_000 }).ok).toBe(true);
  });
});

// ── IR-04 nested loops ──────────────────────────────────────────────────────────────────
/**
 * Minimal URScript interpreter for the subset the IR emits around count-loops:
 * `X = N`, `X = X + N`, `while (X < N):` … `end`, comments, and counted call lines.
 * Returns how many times a line starting with `countPrefix` executed.
 */
function runUrscript(code: string, countPrefix: string): number {
  type Node = { kind: "assign"; v: string; n: number } | { kind: "inc"; v: string; n: number }
    | { kind: "while"; v: string; lim: number; body: Node[] } | { kind: "call"; counted: boolean };
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let i = 0;
  const parse = (): Node[] => {
    const out: Node[] = [];
    while (i < lines.length) {
      const l = lines[i++];
      if (l === "end") return out;
      let m: RegExpMatchArray | null;
      if (/^def \w+\(\):$/.test(l)) { out.push(...parse()); continue; }
      if ((m = l.match(/^while \((\w+) < (\d+)\):$/))) { out.push({ kind: "while", v: m[1], lim: Number(m[2]), body: parse() }); continue; }
      if ((m = l.match(/^(\w+) = (\d+)$/))) { out.push({ kind: "assign", v: m[1], n: Number(m[2]) }); continue; }
      if ((m = l.match(/^(\w+) = (\w+) \+ (\d+)$/)) && m[1] === m[2]) { out.push({ kind: "inc", v: m[1], n: Number(m[3]) }); continue; }
      out.push({ kind: "call", counted: l.startsWith(countPrefix) });
    }
    return out;
  };
  const prog = parse();
  const env = new Map<string, number>();
  let hits = 0;
  let steps = 0;
  const exec = (nodes: Node[]) => {
    for (const n of nodes) {
      if (++steps > 100_000) throw new Error("runaway");
      if (n.kind === "assign") env.set(n.v, n.n);
      else if (n.kind === "inc") env.set(n.v, (env.get(n.v) ?? 0) + n.n);
      else if (n.kind === "call") { if (n.counted) hits++; }
      else while ((env.get(n.v) ?? 0) < n.lim) exec(n.body);
    }
  };
  exec(prog);
  return hits;
}

describe("IR-04 — nested count-loops use a counter per depth", () => {
  const nested = (outer: number, inner: number): Flow => base([
    { id: "L1", type: "loop", count: outer, body: [
      { id: "L2", type: "loop", count: inner, body: [
        { id: "o", type: "set_output", signal: "1", value: true },
      ] },
    ] },
  ]);

  it("2×3 nest executes its body 6 times (URScript, interpreted)", () => {
    expect(runUrscript(transpileToUrscript(nested(2, 3)).code, "set_standard_digital_out(")).toBe(6);
  });

  it("3×2 and 1×4 nests also count right; a 3-deep 2×2×2 nest runs 8", () => {
    expect(runUrscript(transpileToUrscript(nested(3, 2)).code, "set_standard_digital_out(")).toBe(6);
    expect(runUrscript(transpileToUrscript(nested(1, 4)).code, "set_standard_digital_out(")).toBe(4);
    const deep = base([{ id: "A", type: "loop", count: 2, body: [{ id: "B", type: "loop", count: 2, body: [
      { id: "C", type: "loop", count: 2, body: [{ id: "o", type: "set_output", signal: "1", value: true }] },
    ] }] }]);
    expect(runUrscript(transpileToUrscript(deep).code, "set_standard_digital_out(")).toBe(8);
  });

  it("outer and inner counters are distinct identifiers", () => {
    const code = transpileToUrscript(nested(2, 3)).code;
    const vars = [...code.matchAll(/^\s*while \((\w+) < \d+\):$/gm)].map((m) => m[1]);
    expect(vars).toHaveLength(2);
    expect(new Set(vars).size).toBe(2);
  });

  it("ROS2 nests two independent for-loops (Python scoping) — body under the inner loop", () => {
    const lines = transpileToRos2(nested(2, 3)).code.split("\n");
    const outer = lines.findIndex((l) => /^ {8}for \w+ in range\(2\):$/.test(l));
    const inner = lines.findIndex((l) => /^ {12}for \w+ in range\(3\):$/.test(l));
    const body = lines.findIndex((l) => /^ {16}self\.set_io\("1", True\)$/.test(l));
    expect(outer).toBeGreaterThan(-1);
    expect(inner).toBeGreaterThan(outer);
    expect(body).toBeGreaterThan(inner);
  });
});
