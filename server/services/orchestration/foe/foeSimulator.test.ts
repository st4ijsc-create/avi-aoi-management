/**
 * Phase E3a — Factory Control Plane: FOE DIGITAL-TWIN SIMULATOR unit tests.
 *
 * Covers (vitest; NO mocks — the simulator is PURE so nothing to stub):
 *   • a command SEQUENCE → ordered timeline + per-machine PackML state trace evolves
 *     via packml.nextOnCommand (Idle → Starting → Execute …).
 *   • parallel duration = max(child durations); children share a start.
 *   • branch picks the path by the safe condition evaluator (params/state).
 *   • wait_state resolves when a prior step drove the target state, else would_timeout.
 *   • wait_telemetry vs assumed telemetry (satisfied / would_timeout).
 *   • precondition fail → blocked + the onPreconditionFail action recorded.
 *   • hitl_gate → a 'gate' timeline entry + needs_human warning.
 *   • invalid machine / unsupported command → warning / blocked.
 *   • totalDurationMs sums correctly; malformed def → { valid:false, errors }.
 *   • PURITY — the simulator module imports NO dispatcher/DB module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { simulateWorkflow } from "./foeSimulator";
import type { WorkflowDefinition } from "./workflowModel";

// AOI/AVI/AUTOMATION machineTypes resolve real E0 capabilities (start→Start, stop→Stop,
// select_recipe→non-PackML). Supplied to the PURE simulator (never DB-loaded).
const MACHINES = [
  { id: 1, machineType: "AOI" },
  { id: 2, machineType: "AOI" },
  { id: 3, machineType: "AUTOMATION" },
];

describe("foeSimulator — command sequence + PackML trace", () => {
  it("walks an ordered timeline and evolves the per-machine PackML state", () => {
    const def: WorkflowDefinition = {
      ref: "wf.seq",
      name: "Seq",
      steps: [
        { id: "s1", type: "command", machineId: 1, command: "start" },
        { id: "s2", type: "command", machineId: 1, command: "select_recipe", args: { recipeCode: "R1" } },
      ],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });

    expect(res.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.timeline.map((t) => t.stepId)).toEqual(["s1", "s2"]);
    // ordered by startMs
    expect(res.timeline[0].startMs).toBe(0);
    expect(res.timeline[0].endMs).toBe(2000);
    expect(res.timeline[1].startMs).toBe(2000);
    // start drives Idle → Starting → (settle) Execute
    expect(res.timeline[0].predictedState).toBe("Execute");
    // select_recipe is non-PackML → no state move (stays Execute), warning recorded
    expect(res.timeline[1].predictedState).toBe("Execute");
    expect(res.warnings.some((w) => w.kind === "non_packml_command")).toBe(true);

    // state trace evolves: Idle (0) → Starting (mid) → Execute (end)
    const trace = res.machineStateTrace[1];
    expect(trace[0]).toEqual({ atMs: 0, state: "Idle" });
    expect(trace.map((p) => p.state)).toEqual(["Idle", "Starting", "Execute"]);
    expect(res.totalDurationMs).toBe(4000);
  });

  it("honours per-command duration overrides + default", () => {
    const def: WorkflowDefinition = {
      ref: "wf.dur",
      name: "Dur",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" },
        { id: "b", type: "delay", ms: 500 },
        { id: "c", type: "command", machineId: 1, command: "stop" },
      ],
    };
    const res = simulateWorkflow(def, {}, {
      machines: MACHINES,
      commandDurations: { start: 1000 },
      defaultCommandMs: 3000,
    });
    // 1000 (start override) + 500 (delay) + 3000 (stop default) = 4500
    expect(res.totalDurationMs).toBe(4500);
  });
});

describe("foeSimulator — parallel / branch", () => {
  it("parallel duration = max(child durations); children share a start", () => {
    const def: WorkflowDefinition = {
      ref: "wf.par",
      name: "Par",
      steps: [
        {
          id: "p",
          type: "parallel",
          steps: [
            { id: "p1", type: "command", machineId: 1, command: "start" }, // 2000
            { id: "p2", type: "delay", ms: 5000 }, // 5000
          ],
        },
      ],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });
    const p1 = res.timeline.find((t) => t.stepId === "p1")!;
    const p2 = res.timeline.find((t) => t.stepId === "p2")!;
    const p = res.timeline.find((t) => t.stepId === "p")!;
    expect(p1.startMs).toBe(0);
    expect(p2.startMs).toBe(0);
    expect(p.endMs).toBe(5000); // max child
    expect(res.totalDurationMs).toBe(5000);
  });

  it("branch picks the path by the safe condition evaluator", () => {
    const def: WorkflowDefinition = {
      ref: "wf.branch",
      name: "Branch",
      steps: [
        {
          id: "b",
          type: "branch",
          condition: { source: "param", key: "go", op: "eq", value: true },
          then: [{ id: "t1", type: "command", machineId: 1, command: "start" }],
          else: [{ id: "e1", type: "command", machineId: 2, command: "start" }],
        },
      ],
    };
    const taken = simulateWorkflow(def, { go: true }, { machines: MACHINES });
    expect(taken.timeline.some((t) => t.stepId === "t1")).toBe(true);
    expect(taken.timeline.some((t) => t.stepId === "e1")).toBe(false);
    expect(taken.timeline.find((t) => t.stepId === "b")!.note).toContain("then");

    const notTaken = simulateWorkflow(def, { go: false }, { machines: MACHINES });
    expect(notTaken.timeline.some((t) => t.stepId === "e1")).toBe(true);
    expect(notTaken.timeline.some((t) => t.stepId === "t1")).toBe(false);
  });
});

describe("foeSimulator — wait_state / wait_telemetry", () => {
  it("wait_state resolves when a prior step drove the target state", () => {
    const def: WorkflowDefinition = {
      ref: "wf.wait.ok",
      name: "WaitOk",
      steps: [
        { id: "s1", type: "command", machineId: 1, command: "start" }, // → Execute
        { id: "w1", type: "wait_state", machineId: 1, targetStates: ["Execute"], timeoutMs: 10000 },
      ],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });
    const w = res.timeline.find((t) => t.stepId === "w1")!;
    expect(w.status).toBe("ok");
    expect(w.endMs).toBe(w.startMs); // resolves immediately
    expect(res.warnings.some((x) => x.kind === "would_timeout")).toBe(false);
  });

  it("wait_state would time out when the target state is never reached", () => {
    const def: WorkflowDefinition = {
      ref: "wf.wait.to",
      name: "WaitTimeout",
      steps: [{ id: "w1", type: "wait_state", machineId: 1, targetStates: ["Complete"], timeoutMs: 7000 }],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });
    const w = res.timeline.find((t) => t.stepId === "w1")!;
    expect(w.status).toBe("warning");
    expect(w.endMs - w.startMs).toBe(7000);
    expect(res.warnings.some((x) => x.kind === "would_timeout")).toBe(true);
  });

  it("wait_telemetry satisfied by assumed telemetry vs would time out", () => {
    const def: WorkflowDefinition = {
      ref: "wf.tele",
      name: "Tele",
      steps: [
        {
          id: "t1",
          type: "wait_telemetry",
          condition: { source: "telemetry", machineId: 1, key: "ng_count", op: "eq", value: 0 },
          timeoutMs: 3000,
        },
      ],
    };
    const ok = simulateWorkflow(def, {}, { machines: MACHINES, assumedTelemetry: { 1: { ng_count: 0 } } });
    expect(ok.timeline[0].status).toBe("ok");

    const to = simulateWorkflow(def, {}, { machines: MACHINES, assumedTelemetry: { 1: { ng_count: 5 } } });
    expect(to.timeline[0].status).toBe("warning");
    expect(to.warnings.some((x) => x.kind === "would_timeout")).toBe(true);
  });
});

describe("foeSimulator — precondition / hitl_gate", () => {
  it("precondition fail → blocked + the onPreconditionFail action recorded", () => {
    const def: WorkflowDefinition = {
      ref: "wf.pre",
      name: "Pre",
      steps: [
        {
          id: "s1",
          type: "command",
          machineId: 1,
          command: "start",
          precondition: { source: "param", key: "ready", op: "eq", value: true },
          onPreconditionFail: "hold",
        },
      ],
    };
    const res = simulateWorkflow(def, { ready: false }, { machines: MACHINES });
    const s = res.timeline.find((t) => t.stepId === "s1")!;
    expect(s.status).toBe("blocked");
    expect(s.note).toContain("hold");
    expect(res.warnings.some((w) => w.kind === "precondition_fail")).toBe(true);
    expect(res.ok).toBe(false);
  });

  it("precondition fail with skip → skipped (not blocked)", () => {
    const def: WorkflowDefinition = {
      ref: "wf.pre.skip",
      name: "PreSkip",
      steps: [
        {
          id: "s1",
          type: "command",
          machineId: 1,
          command: "start",
          precondition: { source: "param", key: "ready", op: "eq", value: true },
          onPreconditionFail: "skip",
        },
        { id: "s2", type: "command", machineId: 2, command: "start" },
      ],
    };
    const res = simulateWorkflow(def, { ready: false }, { machines: MACHINES });
    expect(res.timeline.find((t) => t.stepId === "s1")!.status).toBe("skipped");
    expect(res.timeline.find((t) => t.stepId === "s2")!.status).toBe("ok");
    expect(res.ok).toBe(true); // skip is not a block
  });

  it("precondition fail with abort → blocked + subsequent steps skipped", () => {
    const def: WorkflowDefinition = {
      ref: "wf.pre.abort",
      name: "PreAbort",
      steps: [
        {
          id: "s1",
          type: "command",
          machineId: 1,
          command: "start",
          precondition: { source: "param", key: "ready", op: "eq", value: true },
          onPreconditionFail: "abort",
        },
        { id: "s2", type: "command", machineId: 2, command: "start" },
      ],
    };
    const res = simulateWorkflow(def, { ready: false }, { machines: MACHINES });
    expect(res.timeline.find((t) => t.stepId === "s1")!.status).toBe("blocked");
    expect(res.timeline.find((t) => t.stepId === "s2")!.status).toBe("skipped");
  });

  it("hitl_gate → a 'gate' timeline entry + needs_human warning (0 duration default)", () => {
    const def: WorkflowDefinition = {
      ref: "wf.gate",
      name: "Gate",
      steps: [{ id: "g1", type: "hitl_gate", prompt: "Approve?" }],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });
    const g = res.timeline.find((t) => t.stepId === "g1")!;
    expect(g.status).toBe("gate");
    expect(g.endMs).toBe(g.startMs);
    expect(res.warnings.some((w) => w.kind === "needs_human")).toBe(true);
  });
});

describe("foeSimulator — invalid machine / command", () => {
  it("unsupported command → blocked + warning", () => {
    const def: WorkflowDefinition = {
      ref: "wf.unsup",
      name: "Unsup",
      // FEEDER supports start/stop/ack only — "select_recipe" is unsupported.
      steps: [{ id: "s1", type: "command", machineId: 9, command: "select_recipe" }],
    };
    const res = simulateWorkflow(def, {}, { machines: [{ id: 9, machineType: "FEEDER" }] });
    const s = res.timeline.find((t) => t.stepId === "s1")!;
    expect(s.status).toBe("blocked");
    expect(res.warnings.some((w) => w.kind === "unsupported_command")).toBe(true);
    expect(res.ok).toBe(false);
  });

  it("unknown machine (no machineType supplied) → warning (state un-predicted)", () => {
    const def: WorkflowDefinition = {
      ref: "wf.unkmach",
      name: "UnkMach",
      steps: [{ id: "s1", type: "command", machineId: 99, command: "start" }],
    };
    // no machines[] → capability cannot be resolved
    const res = simulateWorkflow(def, {}, {});
    const s = res.timeline.find((t) => t.stepId === "s1")!;
    expect(s.status).toBe("warning");
    expect(res.warnings.some((w) => w.kind === "invalid_machine")).toBe(true);
  });

  it("illegal PackML transition → blocked", () => {
    const def: WorkflowDefinition = {
      ref: "wf.illegal",
      name: "Illegal",
      // stop drives Idle→Stopping→Stopped; then start is illegal from Stopped.
      steps: [
        { id: "s1", type: "command", machineId: 1, command: "stop" },
        { id: "s2", type: "command", machineId: 1, command: "start" },
      ],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });
    const s2 = res.timeline.find((t) => t.stepId === "s2")!;
    expect(s2.status).toBe("blocked");
    expect(res.warnings.some((w) => w.kind === "illegal_transition")).toBe(true);
  });
});

describe("foeSimulator — totals + malformed", () => {
  it("totalDurationMs sums the sequence correctly", () => {
    const def: WorkflowDefinition = {
      ref: "wf.tot",
      name: "Tot",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" }, // 2000
        { id: "b", type: "delay", ms: 1500 }, // 1500
        { id: "c", type: "command", machineId: 1, command: "stop" }, // 2000
      ],
    };
    const res = simulateWorkflow(def, {}, { machines: MACHINES });
    expect(res.totalDurationMs).toBe(5500);
  });

  it("malformed def → { ok:false, valid:false, errors }, no throw", () => {
    const bad = { ref: "", name: "", steps: [] } as unknown as WorkflowDefinition;
    const res = simulateWorkflow(bad, {});
    expect(res.ok).toBe(false);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);

    // utterly malformed (no steps array)
    const worse = simulateWorkflow(null as unknown as WorkflowDefinition, {});
    expect(worse.ok).toBe(false);
    expect(worse.valid).toBe(false);
  });

  it("is deterministic — identical inputs → identical results", () => {
    const def: WorkflowDefinition = {
      ref: "wf.det",
      name: "Det",
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" },
        { id: "b", type: "command", machineId: 1, command: "stop" },
      ],
    };
    const r1 = simulateWorkflow(def, {}, { machines: MACHINES });
    const r2 = simulateWorkflow(def, {}, { machines: MACHINES });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });
});

describe("foeSimulator — PURITY", () => {
  it("the simulator module imports NO dispatcher / DB / equipmentAdapter module", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "foeSimulator.ts"), "utf8");
    // Inspect ONLY the import statements (prose in docstrings may mention these names).
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    // must not import the executor (which dispatches), the registry, dispatchers, or DB.
    expect(importLines).not.toMatch(/equipmentAdapter/);
    expect(importLines).not.toMatch(/equipmentRegistry/);
    expect(importLines).not.toMatch(/commandDispatcher/);
    expect(importLines).not.toMatch(/robotCommandDispatcher/);
    expect(importLines).not.toMatch(/foeEngine/);
    expect(importLines).not.toMatch(/db\/connection/);
    expect(importLines).not.toMatch(/sendCommand/);
  });
});
