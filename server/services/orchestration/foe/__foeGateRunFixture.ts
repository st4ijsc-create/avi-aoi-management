/**
 * doc 81 Đợt 4 fix round 1 (R-4-i) — TEST FIXTURE (DB `_test` only): a real orchestration workflow + run + gate row, so
 * the dispatchers' DB layer (foeGateApproval.foeApprovalDbRefusal) has real rows to re-derive the run owner and the gate
 * approver from. Not imported by product code.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows } from "../../../../drizzle/schema";
import { FOE_APPROVAL_SOURCE_SERVER, computeBindingDigest, hashWorkflowDefinition } from "./foeGateApproval";
import { orchestrationRunsWithApiKey } from "./runApiKeyIdentity";
import { edgeAssignedRunIdsAmong } from "../../edge/edgeExecutionSchema";
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
  /** doc 81 Đợt 8 O2 — steps after the gate (e.g. an OT command on a sim adapter whose program checksum the digest covers). */
  steps?: WorkflowDefinition["steps"];
  /**
   * doc 81 Đợt 9 R fix 1 — an API-started run: the run's paramsJson / contextJson carry the API marker and, when given, the
   * key is written IN THE INSERT (mig 0369 refuses every later update of the column).
   */
  api?: { keyId: number | null };
}): Promise<FoeGateRunFixture> {
  const d = await getDb();
  if (!d) throw new Error("no db");
  const def: WorkflowDefinition = { ref: `${opts.tag}-wf`.slice(0, 120), name: opts.tag, steps: [{ id: "g0", type: "hitl_gate", prompt: "fixture" }, ...(opts.steps ?? [])] };
  const [wf] = await d.insert(orchestrationWorkflows).values({ ref: def.ref, name: def.name, definitionJson: def, status: "active" }).returning();
  const base = {
    workflowId: wf.id,
    workflowRef: def.ref,
    status: "running" as const,
    paramsJson: opts.api ? { __foeStartedViaApi: true } : {},
    contextJson: opts.api ? { startedViaApi: true } : {},
    startedBy: opts.owner,
    startedAt: new Date(),
  };
  const [run] =
    opts.api && opts.api.keyId !== null
      ? await d.insert(orchestrationRunsWithApiKey).values({ ...base, startedViaApiKeyId: opts.api.keyId }).returning()
      : await d.insert(orchestrationRuns).values(base).returning();
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
        bindingDigest: await computeBindingDigest(d, def), // doc 81 Đợt 5 task E3
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

/** TEST-DB-RUN-SOT — the statuses the FOE boot scan takes (foeEngine rehydrateInterruptedRuns: activeStatuses). */
const TRANG_THAI_QUET_BOOT = ["queued", "running", "compensating"] as const;
/** TEST-DB-RUN-SOT — the bound of each read of chanRunSot (RUN-SOT-POOL). */
export const HAN_DOC_RUN_SOT_MS = 10_000;

/**
 * TEST-DB-RUN-SOT (HST 27/11) — before a DB case runs the FOE boot scan (rehydrateInterruptedRuns): the runs that scan would take besides the
 * case's own — queued / running / compensating, not assigned to an edge node (the product's own edgeAssignedRunIdsAmong). The scan takes them
 * whatever FOE_DURABLE says (queued / running ⇒ held; compensating ⇒ failed, or held / re-sent once); FOE_DURABLE only adds continuing them.
 * Read on `doc`: in a case, the POOL (it sees COMMITTED rows only, so the case's own runs are not there); the case's transaction only in the
 * self-tests (RUN-SOT-DOC-QUA-TX). Any ⇒ THROWS naming each as "#<id> <status>;" and the scan is not run. Reads only: one SELECT, plus one of
 * the edge assignments when a run is found. Writes nothing. Each read is bounded by `hanMs` (RUN-SOT-POOL: the case's transaction holds one
 * connection of the pool; with none free the read would wait until the case's own timeout) ⇒ it THROWS "RUN-SOT-POOL (…)" instead.
 */
export async function chanRunSot(doc: { select: (...a: any[]) => any }, ten: string, hanMs = HAN_DOC_RUN_SOT_MS): Promise<void> {
  const coHan = async <T>(viec: PromiseLike<T>, cai: string): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(viec),
        new Promise<never>((_, rej) => {
          t = setTimeout(() => rej(new Error(`RUN-SOT-POOL (${ten}): ${cai} did not answer in ${hanMs} ms (no free pool connection? DB_POOL_MAX) — the boot scan is NOT run.`)), hanMs);
        }),
      ]);
    } finally {
      if (t !== undefined) clearTimeout(t);
    }
  };
  const hang: Array<{ id: number; status: string }> = await coHan(
    doc
      .select({ id: orchestrationRuns.id, status: orchestrationRuns.status })
      .from(orchestrationRuns)
      .where(inArray(orchestrationRuns.status, [...TRANG_THAI_QUET_BOOT])),
    "the read of the runs",
  );
  if (hang.length === 0) return;
  const edge = await coHan(edgeAssignedRunIdsAmong(doc, hang.map((h) => h.id)), "the read of the edge assignments");
  const sot = hang.filter((h) => !edge.has(h.id)).sort((a, b) => a.id - b.id);
  if (sot.length === 0) return;
  throw new Error(
    `TEST-DB-RUN-SOT (${ten}): the boot scan is NOT run — it would take ${sot.length} run(s) this case did not make: ${sot.map((h) => `#${h.id} ${h.status};`).join(" ")} Count them read-only and tell chu-du-an-HST; never delete them.`,
  );
}
