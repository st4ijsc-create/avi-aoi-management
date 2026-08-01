/**
 * Event-sourced run state + crash-resume — SYNAPSE §5.1.2/§5.1.6 (doc 33 §3.6 / F8 · H3).
 *
 * The FOE runtime today is in-process: a crash marks interrupted runs `held` for MANUAL resume.
 * SYNAPSE requires DURABLE execution — reconstruct exact state from an append-only event log and
 * AUTO-continue. This is that primitive: a pure reducer that replays events → run state, plus a
 * resume planner that (with the DAG) says which tasks to re-dispatch, so no run gets stuck.
 *
 * Non-breaking/additive: the existing engine can adopt this by persisting these events per
 * transition (it already writes per-step rows) and replaying on boot instead of holding. Pure —
 * timestamps come from events, never Date.now().
 */
import { readySet, type DagNode } from "./dag";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "compensated" | "paused";
export type RunStatus = "created" | "running" | "completed" | "failed" | "compensating";

export type RunEventType =
  | "RUN_CREATED"
  | "TASK_STARTED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_PAUSED"
  | "TASK_COMPENSATED"
  | "RUN_COMPLETED"
  | "RUN_FAILED";

export interface RunEvent {
  seq: number;
  type: RunEventType;
  taskId?: string;
  ts: number;
  data?: unknown;
}

export interface RunState {
  runId: string;
  status: RunStatus;
  tasks: Record<string, TaskStatus>;
  lastSeq: number;
  lastTs: number;
}

/** Replay an append-only event log into the current run state (pure reducer). */
export function replayRun(runId: string, events: readonly RunEvent[]): RunState {
  const state: RunState = { runId, status: "created", tasks: {}, lastSeq: 0, lastTs: 0 };
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  for (const e of sorted) {
    state.lastSeq = e.seq;
    state.lastTs = e.ts;
    switch (e.type) {
      case "RUN_CREATED":
        state.status = "running";
        break;
      case "TASK_STARTED":
        if (e.taskId) state.tasks[e.taskId] = "running";
        break;
      case "TASK_COMPLETED":
        if (e.taskId) state.tasks[e.taskId] = "completed";
        break;
      case "TASK_FAILED":
        if (e.taskId) state.tasks[e.taskId] = "failed";
        state.status = "compensating";
        break;
      case "TASK_PAUSED":
        if (e.taskId) state.tasks[e.taskId] = "paused";
        break;
      case "TASK_COMPENSATED":
        if (e.taskId) state.tasks[e.taskId] = "compensated";
        break;
      case "RUN_COMPLETED":
        state.status = "completed";
        break;
      case "RUN_FAILED":
        state.status = "failed";
        break;
    }
  }
  return state;
}

export interface ResumePlan {
  /** Tasks that were RUNNING at the crash → resume/re-dispatch (must be idempotent). */
  resume: string[];
  /** Tasks whose DAG deps are satisfied and not yet started → dispatch next. */
  dispatch: string[];
  /** True when the run is terminal (nothing to do). */
  terminal: boolean;
  reason: string;
}

/**
 * Given the replayed state + the run's DAG, compute what to do on restart — AUTO-continue rather
 * than park as `held`. Running-at-crash tasks resume (idempotent); ready tasks dispatch.
 */
export function resumePlan(state: RunState, dag: readonly DagNode[]): ResumePlan {
  if (state.status === "completed" || state.status === "failed") {
    return { resume: [], dispatch: [], terminal: true, reason: `run ${state.status}` };
  }
  const resume = Object.entries(state.tasks)
    .filter(([, s]) => s === "running")
    .map(([id]) => id)
    .sort();
  const completed = new Set(
    Object.entries(state.tasks)
      .filter(([, s]) => s === "completed")
      .map(([id]) => id),
  );
  // Ready = DAG deps satisfied, not already running/paused/failed/done.
  const busy = new Set(Object.keys(state.tasks).filter((id) => state.tasks[id] !== "completed"));
  // During a saga rollback (`compensating`) we ONLY resume compensations — hold ALL new forward
  // dispatch, matching the reason string. Previously `dispatch` was computed regardless of status,
  // so an unstarted independent branch could be launched mid-rollback. — doc 33 §11 fix.
  const dispatch =
    state.status === "compensating"
      ? []
      : readySet(dag, completed).filter((id) => !busy.has(id));
  return {
    resume,
    dispatch,
    terminal: false,
    reason:
      state.status === "compensating"
        ? "run compensating — resume compensations, hold new dispatch"
        : "auto-continue: resume interrupted + dispatch ready",
  };
}
