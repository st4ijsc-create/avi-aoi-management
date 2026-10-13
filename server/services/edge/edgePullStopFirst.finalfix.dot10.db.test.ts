/**
 * doc 81 Đợt 10 final fix wave — I-1 (ruling R-10-br): the v2 pull serves the node's STOP commands FIRST and independently of the
 * run / sweep work. A run whose sweep picture cannot be built or signed (the review's case: > 64 pins, or a transient read error in
 * the run analysis) must never turn the pull into a 503 — the STOP queued for that node is delivered, the bad run is left out and
 * the answer says `partial: true`; another aborted run's picture is still there. A failure of the COMMANDS read itself is still
 * 503 (M-3: "no commands" is never said for "none pending").
 * Real `_test` DB (central kit); the fault is injected into edgeRunAnalysis.analyseDefinition for ONE run id only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupKit, kitSteps, type Kit } from "./__edgeCentralKit.dot10";

const fault = vi.hoisted(() => ({ poisonedRuns: new Set<number>(), commandsThrow: false }));
vi.mock("./edgeRunAnalysis", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./edgeRunAnalysis")>();
  return {
    ...orig,
    analyseDefinition: (async (...args: Parameters<typeof orig.analyseDefinition>) => {
      if (fault.poisonedRuns.has(args[1] as number)) throw new Error("injected: run analysis read failed");
      return orig.analyseDefinition(...args);
    }) as typeof orig.analyseDefinition,
  };
});
vi.mock("./edgeNodeCommands", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./edgeNodeCommands")>();
  return {
    ...orig,
    commandsForNode: (async (...args: Parameters<typeof orig.commandsForNode>) => {
      if (fault.commandsThrow) throw new Error("injected: command queue read failed");
      return orig.commandsForNode(...args);
    }) as typeof orig.commandsForNode,
  };
});

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;

describe.skipIf(!onTest)("doc 81 Đợt 10 final fix wave I-1 — pull: STOPs first, run sections isolated (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("FFI1");
  }, 120_000);
  afterAll(async () => {
    fault.poisonedRuns.clear();
    fault.commandsThrow = false;
    await k?.teardown();
  }, 120_000);

  async function abortedWithFailedStop(tag: string): Promise<number> {
    const s = kitSteps(k);
    const run = await k.newRun(tag, "A", [s.gate, s.robotStop]);
    await k.sql`UPDATE orchestration_runs SET status = 'aborted', "finishedAt" = now() WHERE id = ${run.runId}`;
    await k.sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson") VALUES (${run.runId}, 'abort:s1', 'command', 'failed', 0, ${k.sql.json({ stepId: "s1" })})`;
    return run.runId;
  }

  it("★ an aborted run whose sweep picture cannot be built ⇒ the pull still answers 200, the node's pending STOP IS delivered, the bad run is left out (partial), another aborted run is still listed", async () => {
    const c = await import("./edgeExecutionCentral");
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const bad = await abortedWithFailedStop("poisoned");
    const good = await abortedWithFailedStop("healthy");
    fault.poisonedRuns.add(bad);
    const stop = (await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console stop (I-1)", requestedBy: k.u.admin })).requestId;
    const r = await c.pullForNodeV2(await k.principal("A"), {});
    expect(r.http, JSON.stringify(r).slice(0, 400)).toBe(200);
    const payloads = r.data!.commands.map((e) => JSON.parse(e.payload) as { requestId: number; kind: string });
    expect(payloads.find((p) => p.requestId === stop)?.kind).toBe("stop");
    expect(r.data!.partial).toBe(true);
    const listed = r.data!.stopsUnconfirmed.map((x) => x.runId);
    expect(listed).not.toContain(bad);
    expect(listed).toContain(good);
    // the answer is still a valid pull answer for the edge's strict schema
    const proto = await import("./edgeProtocol");
    expect(proto.edgePullAnswerSchema.safeParse(r.data).success).toBe(true);
    // healthy again ⇒ no partial flag, both listed
    fault.poisonedRuns.delete(bad);
    const r2 = await c.pullForNodeV2(await k.principal("A"), {});
    expect(r2.http).toBe(200);
    expect(r2.data!.partial).toBeUndefined();
    expect(r2.data!.stopsUnconfirmed.map((x) => x.runId)).toEqual(expect.arrayContaining([bad, good]));
  });

  it("★ M-3 kept: the COMMANDS read failing is still 503 (never a quiet 'no commands')", async () => {
    const c = await import("./edgeExecutionCentral");
    fault.commandsThrow = true;
    try {
      const r = await c.pullForNodeV2(await k.principal("A"), {});
      expect(r.http).toBe(503);
    } finally {
      fault.commandsThrow = false;
    }
  });
});
