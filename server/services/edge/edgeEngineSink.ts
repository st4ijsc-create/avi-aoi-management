/**
 * doc 81 Đợt 10 task B — the THIN ADAPTER between central's report endpoints and the engine (Group C owns the engine).
 *
 * Central is the ONLY writer of an edge run's step rows and run row, and the writes follow the engine's OWN rules, so they
 * come from the engine (Group C, foeRunStore — re-exported by foeEngine):
 *   recordEdgeStepRows(db, runId, rows)  — upsertStep's guards per row on the given handle (B's transaction);
 *   applyEdgeSegmentEnd(db, runId, end)  — finishWalk / setRunStatusUnlessAborted semantics for the end of an edge segment.
 * B never re-implements them (a second copy could drift from the central walk's rules).
 */
import { applyEdgeSegmentEnd, recordEdgeStepRows, type EdgeSegmentEndApply, type EdgeSegmentEndResult, type EdgeStepRowWrite } from "../orchestration/foe/foeRunStore";
import type { Db } from "./edgeCentralCommon";

export type { EdgeStepRowWrite, EdgeSegmentEndResult };
export type EdgeSegmentEnd = EdgeSegmentEndApply;

export interface EdgeEngineSink {
  recordEdgeStepRows(db: Db, runId: number, rows: EdgeStepRowWrite[]): Promise<void>;
  applyEdgeSegmentEnd(db: Db, runId: number, end: EdgeSegmentEnd): Promise<EdgeSegmentEndResult>;
}

const engineSink: EdgeEngineSink = {
  recordEdgeStepRows: (db, runId, rows) => recordEdgeStepRows(db as never, runId, rows),
  applyEdgeSegmentEnd: (db, runId, end) => applyEdgeSegmentEnd(db as never, runId, end),
};

export async function resolveEngineSink(): Promise<EdgeEngineSink> {
  return engineSink;
}
