/**
 * Durable orchestration tests — SYNAPSE §5.1/§5.3 (doc 33 F8 · H3).
 * DAG + topo/cycle · event-sourced replay + crash-resume · priority/SLA/four-eyes.
 */
import { describe, it, expect } from "vitest";

import { validateDag, readySet, type DagNode } from "./dag";
import { replayRun, resumePlan, type RunEvent } from "./eventSourcing";
import {
  effectivePriority,
  orderQueue,
  canPreempt,
  requiresFourEyes,
  DEFAULT_AGING_MS,
  type PrioritizedTask,
} from "./slaPolicy";

describe("DAG — topological check", () => {
  const good: DagNode[] = [
    { id: "print", deps: [] },
    { id: "spi", deps: ["print"] },
    { id: "place", deps: ["spi"] },
    { id: "reflow", deps: ["place"] },
    { id: "aoi", deps: ["reflow"] },
  ];
  it("valid recipe → topo order", () => {
    const r = validateDag(good);
    expect(r.valid).toBe(true);
    expect(r.order).toEqual(["print", "spi", "place", "reflow", "aoi"]);
  });
  it("detects a cycle", () => {
    const cyclic: DagNode[] = [
      { id: "a", deps: ["c"] },
      { id: "b", deps: ["a"] },
      { id: "c", deps: ["b"] },
    ];
    const r = validateDag(cyclic);
    expect(r.valid).toBe(false);
    expect(r.cycle.sort()).toEqual(["a", "b", "c"]);
  });
  it("flags missing dep + duplicate id", () => {
    expect(validateDag([{ id: "x", deps: ["ghost"] }]).valid).toBe(false);
    expect(validateDag([{ id: "x", deps: [] }, { id: "x", deps: [] }]).valid).toBe(false);
  });
  it("readySet = deps satisfied, not done", () => {
    expect(readySet(good, new Set())).toEqual(["print"]);
    expect(readySet(good, new Set(["print"]))).toEqual(["spi"]);
    expect(readySet(good, new Set(["print", "spi"]))).toEqual(["place"]);
  });
});

describe("event-sourced replay + crash-resume", () => {
  const dag: DagNode[] = [
    { id: "t1", deps: [] },
    { id: "t2", deps: ["t1"] },
    { id: "t3", deps: ["t2"] },
  ];
  it("replays to current state", () => {
    const events: RunEvent[] = [
      { seq: 1, type: "RUN_CREATED", ts: 1 },
      { seq: 2, type: "TASK_STARTED", taskId: "t1", ts: 2 },
      { seq: 3, type: "TASK_COMPLETED", taskId: "t1", ts: 3 },
      { seq: 4, type: "TASK_STARTED", taskId: "t2", ts: 4 },
    ];
    const s = replayRun("run-1", events);
    expect(s.status).toBe("running");
    expect(s.tasks).toEqual({ t1: "completed", t2: "running" });
    expect(s.lastSeq).toBe(4);
  });
  it("auto-continues after crash: resumes running + dispatches ready (not 'held')", () => {
    // Crash while t2 running (t1 done). Resume t2; t3 not ready yet.
    const s = replayRun("run-1", [
      { seq: 1, type: "RUN_CREATED", ts: 1 },
      { seq: 2, type: "TASK_STARTED", taskId: "t1", ts: 2 },
      { seq: 3, type: "TASK_COMPLETED", taskId: "t1", ts: 3 },
      { seq: 4, type: "TASK_STARTED", taskId: "t2", ts: 4 },
    ]);
    const plan = resumePlan(s, dag);
    expect(plan.terminal).toBe(false);
    expect(plan.resume).toEqual(["t2"]);
    expect(plan.dispatch).toEqual([]); // t3 waits for t2
  });
  it("terminal run has nothing to do", () => {
    const s = replayRun("r", [
      { seq: 1, type: "RUN_CREATED", ts: 1 },
      { seq: 2, type: "RUN_COMPLETED", ts: 2 },
    ]);
    expect(resumePlan(s, dag).terminal).toBe(true);
  });
  it("holds forward dispatch during a saga rollback (compensating)", () => {
    // A fails → run enters `compensating`; the independent branch B is unstarted but must NOT be
    // dispatched mid-rollback (only compensations resume). Regression: dispatch was ['B'] before.
    const dag2: DagNode[] = [
      { id: "A", deps: [] },
      { id: "B", deps: [] },
    ];
    const s = replayRun("run-x", [
      { seq: 1, type: "RUN_CREATED", ts: 1 },
      { seq: 2, type: "TASK_STARTED", taskId: "A", ts: 2 },
      { seq: 3, type: "TASK_FAILED", taskId: "A", ts: 3 },
    ]);
    expect(s.status).toBe("compensating");
    const plan = resumePlan(s, dag2);
    expect(plan.terminal).toBe(false);
    expect(plan.dispatch).toEqual([]); // hold new forward dispatch
    expect(plan.reason).toMatch(/compensating/);
  });
});

describe("priority / SLA / four-eyes", () => {
  const now = 1_000_000_000;
  it("aging promotes a waiting task one band per window (anti-starvation)", () => {
    const t: PrioritizedTask = { id: "a", priority: 3, createdTs: now - 2 * DEFAULT_AGING_MS };
    expect(effectivePriority(t, now)).toBe(1); // P3 → promoted 2 bands → P1
    const fresh: PrioritizedTask = { id: "b", priority: 3, createdTs: now };
    expect(effectivePriority(fresh, now)).toBe(3);
  });
  it("orders P0 first, then EDF, then FIFO", () => {
    const tasks: PrioritizedTask[] = [
      { id: "p2", priority: 2, createdTs: now },
      { id: "p0", priority: 0, createdTs: now },
      { id: "p1-early", priority: 1, createdTs: now, deadlineTs: now + 1000 },
      { id: "p1-late", priority: 1, createdTs: now, deadlineTs: now + 9000 },
    ];
    expect(orderQueue(tasks, now).map((t) => t.id)).toEqual(["p0", "p1-early", "p1-late", "p2"]);
  });
  it("preemption: higher band preempts only a preemptible running task", () => {
    const p0: PrioritizedTask = { id: "p0", priority: 0, createdTs: now };
    const p2Preempt: PrioritizedTask = { id: "p2", priority: 2, createdTs: now, preemptible: true };
    const p2Fixed: PrioritizedTask = { id: "p2f", priority: 2, createdTs: now, preemptible: false };
    expect(canPreempt(p0, p2Preempt, now)).toBe(true);
    expect(canPreempt(p0, p2Fixed, now)).toBe(false);
  });
  it("four-eyes delegates to the F5 policy engine", () => {
    // deny → approval required (blocking)
    expect(requiresFourEyes({ action: "skip_step", step: { type: "AOI" }, product: { class: 3 } }).required).toBe(true);
    // require_approval → four-eyes
    expect(requiresFourEyes({ action: "manual_override", zone: { density: 0.9 } }).required).toBe(true);
    // benign → no approval
    expect(requiresFourEyes({ action: "skip_step", step: { type: "AOI" }, product: { class: 1 } }).required).toBe(false);
  });
});
