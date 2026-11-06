/**
 * Durable orchestration tests — SYNAPSE §5.1/§5.3 (doc 33 F8 · H3).
 * DAG + topo/cycle · event-sourced replay + crash-resume. (priority/SLA/four-eyes: `slaPolicy` đã gỡ cùng orchestrationGov, dọn vệ sinh E0-3.)
 */
import { describe, it, expect } from "vitest";

import { validateDag, readySet, type DagNode } from "./dag";
import { replayRun, resumePlan, type RunEvent } from "./eventSourcing";

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

