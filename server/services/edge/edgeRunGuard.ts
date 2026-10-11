/**
 * doc 81 Đợt 9 task S3 — the EDGE RUN GUARD: may a walker on this edge still send a NON-STOP command of `runId`?
 *
 * Read from the run row and its assignment (the shared control-plane DB — the edge executes the central run itself), bounded:
 *   • 'stopped' — central aborted the run, or a central gate rejection claimed it (edgeCoordinator.centralStopped): the walker
 *                 must stop its non-STOP steps NOW and still send its STOPs (the engine's abort sweep) — even when the HTTP
 *                 signal never arrives (central unreachable, the answer lost);
 *   • 'stale'   — this walker's claim is no longer the current one (released, declared interrupted, re-claimed): another
 *                 segment owns the run, or nobody does;
 *   • 'revoked' — the credential that claimed this segment has been revoked: the node's in-flight work stops with it;
 *   • 'unknown' — the guard could not decide (DB error, deadline): NOT allowed (fail-closed — a STOP never asks);
 *   • 'ok'      — the claim is current, its credential active, central has not stopped the run.
 * Only NON-STOP commands consult it (foeEngine.execCommand, `rc.edgeGuard`); a STOP is never delayed or refused by it (L-7).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { orchestrationRuns } from "../../../drizzle/schema";
import { centralStopped } from "./edgeCoordinator";
import { edgeNodeCredentials, runEdgeAssignments } from "./edgeExecutionSchema";
import { sameDigest } from "./edgeNodeCredentials";

export type EdgeGuardVerdict = "ok" | "stopped" | "stale" | "revoked" | "unknown";

/** Bound of one guard read (default 2 s, [200 ms, 10 s]). Past it ⇒ 'unknown' ⇒ the non-STOP step is refused. */
export function edgeGuardDeadlineMs(): number {
  const n = parseInt(process.env.EDGE_GUARD_DEADLINE_MS || "2000", 10);
  return Number.isFinite(n) ? Math.min(10_000, Math.max(200, n)) : 2000;
}

export async function readEdgeRunGuard(runId: number, claim: { claimSeq: number; claimTokenHash: string }): Promise<EdgeGuardVerdict> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<EdgeGuardVerdict>((resolve) => {
    timer = setTimeout(() => resolve("unknown"), edgeGuardDeadlineMs());
    if (typeof timer.unref === "function") timer.unref();
  });
  const read = (async (): Promise<EdgeGuardVerdict> => {
    try {
      const d = await getDb();
      if (!d) return "unknown";
      const [row] = await d
        .select({
          status: orchestrationRuns.status,
          contextJson: orchestrationRuns.contextJson,
          claimSeq: runEdgeAssignments.claimSeq,
          claimTokenHash: runEdgeAssignments.claimTokenHash,
          credStatus: edgeNodeCredentials.status,
        })
        .from(orchestrationRuns)
        .innerJoin(runEdgeAssignments, eq(runEdgeAssignments.runId, orchestrationRuns.id))
        .leftJoin(edgeNodeCredentials, and(eq(edgeNodeCredentials.id, runEdgeAssignments.claimedByCredentialId)))
        .where(eq(orchestrationRuns.id, runId))
        .limit(1);
      if (!row) return "stale"; // no assignment (or no run) — nothing here may act on it
      if (centralStopped(row)) return "stopped";
      if (row.claimSeq !== claim.claimSeq || !sameDigest(row.claimTokenHash, claim.claimTokenHash)) return "stale";
      if (row.credStatus !== "active") return "revoked";
      return "ok";
    } catch {
      return "unknown";
    }
  })();
  try {
    return await Promise.race([read, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
