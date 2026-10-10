/**
 * doc 81 Đợt 4 fix round 1 (R-4-i) — TEST FIXTURE (DB `_test` only): a real orchestration workflow + run + gate row, so
 * the dispatchers' DB layer (foeGateApproval.foeApprovalDbRefusal) has real rows to re-derive the run owner and the gate
 * approver from. Not imported by product code.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows } from "../../../../drizzle/schema";
import { FOE_APPROVAL_SOURCE_SERVER, hashWorkflowDefinition } from "./foeGateApproval";
import type { WorkflowDefinition } from "./workflowModel";

export interface FoeGateRunFixture {
  runId: number;
  workflowId: number;
  cleanup: () => Promise<void>;
}

export async function makeFoeGateRun(opts: {
  tag: string;
  owner: number | null;
  /** null ⇒ no gate row at all. */
  approvedBy: number | null;
  source?: string;
  /** true ⇒ the gate's defHash does not match the deployed definition (a redeploy happened after the approval). */
  stale?: boolean;
}): Promise<FoeGateRunFixture> {
  const d = await getDb();
  if (!d) throw new Error("no db");
  const def: WorkflowDefinition = { ref: `${opts.tag}-wf`.slice(0, 120), name: opts.tag, steps: [{ id: "g0", type: "hitl_gate", prompt: "fixture" }] };
  const [wf] = await d.insert(orchestrationWorkflows).values({ ref: def.ref, name: def.name, definitionJson: def, status: "active" }).returning();
  const [run] = await d
    .insert(orchestrationRuns)
    .values({ workflowId: wf.id, workflowRef: def.ref, status: "running", paramsJson: {}, contextJson: {}, startedBy: opts.owner, startedAt: new Date() })
    .returning();
  if (opts.approvedBy !== null) {
    await d.insert(orchestrationRunSteps).values({
      runId: run.id,
      stepId: "g0",
      stepType: "hitl_gate",
      status: "completed",
      attempt: 0,
      resultJson: {
        approved: true,
        approvedBy: opts.approvedBy,
        approvalSource: opts.source ?? FOE_APPROVAL_SOURCE_SERVER,
        defHash: opts.stale ? "0".repeat(64) : hashWorkflowDefinition(def),
      },
      finishedAt: new Date(),
    });
  }
  return {
    runId: run.id,
    workflowId: wf.id,
    cleanup: async () => {
      await d.delete(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, run.id));
      await d.delete(orchestrationRuns).where(inArray(orchestrationRuns.id, [run.id]));
      await d.delete(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, wf.id));
    },
  };
}
