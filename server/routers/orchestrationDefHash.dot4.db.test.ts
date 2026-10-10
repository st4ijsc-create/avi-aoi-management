/**
 * doc 81 Đợt 4 fix round 2 (ruling R-4-k, re-review N2) — an approval carries the hash of the definition the approver's
 * screen LOADED (`getRun().defHash` → `resumeRun({ expectedDefHash })`). A redeploy since then ⇒ CONFLICT
 * (reason definitionChanged, "reload") and nothing changes. CSDL THẬT `_test`, `orchestrationRouter.createCaller` THẬT.
 * The workflow is gate → delay (no device command), so the run completes without any OT/robot path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const REF = `d4f2-defhash-${Date.now()}`;
const OWNER = { id: 990_852_101, role: "engineer", name: "owner" };
const ADMIN_CTX = { user: { id: 990_852_102, role: "admin", name: "approver", twoFactorEnabled: true } } as never;
let sql: ReturnType<typeof postgres>;
const saved = { FOE_ENABLED: process.env.FOE_ENABLED };

const def = (ms: number) => ({ ref: REF, name: "DefHash", steps: [{ id: "g", type: "hitl_gate" as const, prompt: "approve" }, { id: "d", type: "delay" as const, ms }] });

describe.skipIf(!DB_URL)("doc 81 Đợt 4 fix round 2 — approval bound to the definition the screen loaded (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    process.env.FOE_ENABLED = "true";
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  });

  afterAll(async () => {
    if (sql) {
      const runs = await sql`SELECT id FROM orchestration_runs WHERE "workflowRef" = ${REF}`;
      const ids = runs.map((r) => Number(r.id));
      if (ids.length) {
        await sql`DELETE FROM orchestration_run_steps WHERE "runId" IN ${sql(ids)}`;
        await sql`DELETE FROM orchestration_runs WHERE id IN ${sql(ids)}`;
      }
      await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" IN (SELECT id FROM orchestration_workflows WHERE ref = ${REF})`.catch(() => undefined);
      await sql`DELETE FROM orchestration_workflows WHERE ref = ${REF}`;
      await sql.end();
    }
    if (saved.FOE_ENABLED === undefined) delete process.env.FOE_ENABLED;
    else process.env.FOE_ENABLED = saved.FOE_ENABLED;
  });

  const router = async () => (await import("./orchestrationRouter")).orchestrationRouter.createCaller(ADMIN_CTX);
  const engine = () => import("../services/orchestration/foe/foeEngine");

  it("★ match: the hash getRun returned ⇒ the approval goes through, run completes, gate recorded", async () => {
    const { deployWorkflow, startRun } = await engine();
    expect((await deployWorkflow(def(1), OWNER)).ok).toBe(true);
    const started = await startRun(REF, {}, OWNER);
    expect(started.status).toBe("awaiting_confirm");
    const view = await (await router()).getRun({ runId: started.runId! });
    expect(view?.defHash).toMatch(/^[0-9a-f]{64}$/);
    const res = await (await router()).resumeRun({ runId: started.runId!, approved: true, expectedStepId: "g", expectedDefHash: view!.defHash! });
    expect(res.status).toBe("completed");
    const [g] = await sql`SELECT "resultJson" FROM orchestration_run_steps WHERE "runId" = ${started.runId!} AND "stepId" = 'g'`;
    expect(g.resultJson).toMatchObject({ approved: true, approvedBy: 990_852_102, approvalSource: "server", defHash: view!.defHash });
  });

  it("★ mismatch: redeploy after the screen loaded ⇒ CONFLICT definitionChanged, run still awaiting, gate untouched; reload ⇒ approval works", async () => {
    const { deployWorkflow, startRun } = await engine();
    expect((await deployWorkflow(def(2), OWNER)).ok).toBe(true);
    const started = await startRun(REF, {}, OWNER);
    const seen = (await (await router()).getRun({ runId: started.runId! }))!.defHash!;
    expect((await deployWorkflow(def(3), OWNER)).ok).toBe(true); // redeploy while the approver looks at the old one
    const err = await (await router())
      .resumeRun({ runId: started.runId!, approved: true, expectedStepId: "g", expectedDefHash: seen })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "CONFLICT" });
    expect(err.cause?.appParams).toMatchObject({ operation: "resumeOrchestrationRun", reason: "definitionChanged" });
    const [run] = await sql`SELECT status, "currentStepId" FROM orchestration_runs WHERE id = ${started.runId!}`;
    expect(run).toMatchObject({ status: "awaiting_confirm", currentStepId: "g" });
    const [g] = await sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${started.runId!} AND "stepId" = 'g'`;
    expect(g.status).toBe("awaiting_confirm");
    const fresh = (await (await router()).getRun({ runId: started.runId! }))!.defHash!;
    expect(fresh).not.toBe(seen);
    expect((await (await router()).resumeRun({ runId: started.runId!, approved: true, expectedStepId: "g", expectedDefHash: fresh })).status).toBe("completed");
  });

  it("an approval WITHOUT expectedDefHash is refused at the input (BAD_REQUEST); a rejection does not need it", async () => {
    const { startRun } = await engine();
    const started = await startRun(REF, {}, OWNER);
    await expect((await router()).resumeRun({ runId: started.runId!, approved: true, expectedStepId: "g" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const rej = await (await router()).resumeRun({ runId: started.runId!, approved: false, expectedStepId: "g" });
    expect(rej.status).toBe("aborted");
  });
});
