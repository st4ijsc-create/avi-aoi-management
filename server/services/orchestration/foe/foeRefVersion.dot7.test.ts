/**
 * doc 81 Đợt 7 task I3 — engine units (FakeDb; the real engine + the real stop classifier; the factory-scope JUDGE is driven
 * by the test: machine 1 / adapter 501 are in the caller's scope, everything else is out):
 *   • ref probing: a RESTRICTED deployer always creates under a server-made `<ref>~<8 hex>` (taken or free alike) and the
 *     definition is re-stamped; an unrestricted scope and the system loader keep plain refs; a visible workflow is updated
 *     in place; an UNDECIDED scope over the existing workflow ⇒ refused `scopeUnverified` (no silent second copy);
 *   • run visibility follows the executed VERSIONS: runVisibilityDefinitions (legacy ⇒ head; recorded ⇒ head or snapshot;
 *     a missing snapshot / workflow ⇒ null).
 * The same rules on the real `_test` database: server/routers/orchestrationScope.dot5.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { judge, conn } = vi.hoisted(() => ({
  // final wave F3 — "failed": the scope lookups fail (judge.failed); keyFail: the namespace key cannot be resolved
  judge: { mode: "scoped" as "scoped" | "admin" | "failed", keyFail: false },
  conn: { fp: new Map<number, string>() },
}));
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  return { ...orig, getActiveConnectionFingerprint: (adapterId: number) => conn.fp.get(adapterId) };
});
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return {
    isStopCommandType: orig.isStopCommandType,
    classifyOtStop: orig.classifyOtStop,
    runningConnectionMatchesAdapterRow: orig.runningConnectionMatchesAdapterRow,
    dispatch: vi.fn(async () => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return {
    ...orig,
    resolveUserFoeScope: (u: { id: number; role: string }) => ({ userId: u.id, userRole: u.role }),
    // doc 81 Đợt 7 I fix 1 — the namespace of a scope: user 10 ⇒ factory A ('f:1'), user 11 ⇒ factory B ('f:2'), null ⇒ global
    workflowScopeKeyOf: async (scope: { userId?: number; tenantScope?: unknown } | null) => {
      if (scope !== null && judge.keyFail) throw new Error("scope lookup failed");
      return scope === null ? "global" : scope.userId === 11 ? "f:2" : scope.userId === 10 ? "f:1" : "f:";
    },
    makeScopeJudge: async (scope: unknown) => {
      if (judge.mode === "admin" || scope === null) return { unrestricted: true, failed: false, outOf: async () => ({ machines: [], robots: [], adapters: [] }) };
      if (judge.mode === "failed") {
        const all = (m: Map<number, boolean>) => [...m.keys()];
        return { unrestricted: false, failed: true, outOf: async (t: { machines: Map<number, boolean>; robots: Map<number, boolean>; adapters: Map<number, boolean> }) => ({ machines: all(t.machines), robots: all(t.robots), adapters: all(t.adapters) }) };
      }
      const mine = (scope as { userId?: number }).userId === 11 ? { m: 2, a: 502 } : { m: 1, a: 501 };
      const pick = (m: Map<number, boolean>, o?: { nonStopOnly?: boolean }) => [...m.entries()].filter(([, ns]) => !o?.nonStopOnly || ns).map(([id]) => id);
      return {
        unrestricted: false,
        failed: false,
        outOf: async (t: { machines: Map<number, boolean>; robots: Map<number, boolean>; adapters: Map<number, boolean> }, o?: { nonStopOnly?: boolean }) => ({
          machines: pick(t.machines, o).filter((id) => id !== mine.m),
          robots: pick(t.robots, o),
          adapters: pick(t.adapters, o).filter((id) => id !== mine.a),
        }),
      };
    },
  };
});

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const ne = (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] !== v;
  const inArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]);
  const notInArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => !vs.includes(row[col.name]);
  const isNull = (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null;
  const desc = (col: { name: string }) => ({ name: col.name, dir: "desc" as const });
  return { ...actual, eq: makeEq, and: makeAnd, ne, inArray, notInArray, isNull, desc };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, orchestrationWorkflows, machines, deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, runVisibilityDefinitions, runVisibleTo } from "./foeEngine";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";

type Row = Record<string, any>;
const ENG = { id: 10, role: "engineer", name: "eng" }; // factory A
const ENG_B = { id: 11, role: "engineer", name: "eng-b" }; // factory B
const ADMIN_SCOPE = { scope: null };
const LOADER = { id: 0, role: "system", name: "loader" };
const wfRows = (): Row[] => fake.store.get("orchestration_workflows") ?? [];
const def = (ref: string, steps: unknown[]) => ({ ref, name: ref, steps }) as never;
const A_START = { id: "a", type: "command", machineId: 1, command: "start" };
const B_START = { id: "b", type: "command", machineId: 2, command: "start" };
const B_PINNED_STOP = { id: "sb", type: "command", machineId: 2, command: "stop", args: { adapterId: 502, writes: [{ tagKey: "estop", value: true }] } };
const GATE = { id: "g", type: "hitl_gate", prompt: "p" };

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.setUnique(orchestrationWorkflows, [["ref", "scopeKey"]]); // mig 0367
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "A", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "AUTOMATION", capabilities: null, code: "M2", name: "B", operationStatus: "stopped", stationId: 2 },
  ]);
  fake.seed(deviceAdapters, [
    { id: 501, machineId: 1, isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null },
    { id: 502, machineId: 2, isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null },
  ]);
  fake.seed(deviceTags, [{ id: 9001, adapterId: 502, tagKey: "estop", dataType: "bool", stopValue: true, writable: true, isEnabled: true }]);
  conn.fp = new Map([[502, adapterTargetFingerprint({ protocol: "modbus", endpoint: "tcp://127.0.0.1:1", machineId: 2, connectionOptions: null } as never)]]);
  judge.mode = "scoped";
  judge.keyFail = false;
  process.env.FOE_ENABLED = "true";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

describe("doc 81 Đợt 7 I fix 1 — refs per scope NAMESPACE (owner decision, mig 0367)", () => {
  const norm = (x: Row, n: number) => ({ ...x, workflowId: n });
  const rowsOf = (ref: string) => wfRows().filter((w) => w.ref === ref);

  it("★ two factories deploy the SAME ref without interfering; each redeploy updates its own (idempotent)", async () => {
    const a1 = await deployWorkflow(def("shared", [A_START]), ENG);
    const b1 = await deployWorkflow(def("shared", [B_START]), ENG_B);
    expect(a1).toMatchObject({ ok: true, ref: "shared", version: 1 });
    expect(b1).toMatchObject({ ok: true, ref: "shared", version: 1 });
    expect(rowsOf("shared").map((w) => w.scopeKey).sort()).toEqual(["f:1", "f:2"]);
    const a2 = await deployWorkflow(def("shared", [A_START, { id: "d", type: "delay", ms: 1 }]), ENG);
    expect(a2).toMatchObject({ ok: true, ref: "shared", workflowId: a1.workflowId, version: 2 });
    expect(rowsOf("shared")).toHaveLength(2);
    expect(rowsOf("shared").find((w) => w.scopeKey === "f:2")!.version).toBe(1); // B's untouched
    expect(rowsOf("shared").find((w) => w.scopeKey === "f:2")!.definitionJson.steps[0].machineId).toBe(2);
  });

  it("★ probing: a ref used only by ANOTHER factory answers exactly like a free ref — deploy and start", async () => {
    expect((await deployWorkflow(def("taken", [GATE, B_START]), ENG_B)).ok).toBe(true);
    const taken = await deployWorkflow(def("taken", [GATE, A_START]), ENG);
    const free = await deployWorkflow(def("free", [GATE, A_START]), ENG);
    expect(norm({ ...(taken as Row), ref: "R" }, 0)).toEqual(norm({ ...(free as Row), ref: "R" }, 0));
    // start of a ref only another factory uses ⇒ the same answer as a missing ref
    expect((await deployWorkflow(def("bonly", [GATE, B_START]), ENG_B)).ok).toBe(true);
    const out = await startRun("bonly", {}, ENG);
    const missing = await startRun("nope", {}, ENG);
    expect(out).toEqual({ ...missing, message: missing.message!.replace("nope", "bonly") });
    // each factory starts ITS OWN workflow of the shared ref
    const rA = await startRun("taken", {}, ENG);
    const rB = await startRun("taken", {}, ENG_B);
    const runs = fake.store.get("orchestration_runs") as Row[];
    const wfOf = (id: number) => runs.find((r) => r.id === id)!.workflowId;
    expect(wfOf(rA.runId!)).toBe(taken.workflowId);
    expect(wfOf(rB.runId!)).not.toBe(taken.workflowId);
  });

  it("★ admin sees all: a ref in several factory namespaces (no global) ⇒ refAmbiguous for a plain start / deploy; by workflowId ⇒ that one", async () => {
    const a = await deployWorkflow(def("both", [GATE, A_START]), ENG);
    expect((await deployWorkflow(def("both", [GATE, B_START]), ENG_B)).ok).toBe(true);
    expect(await startRun("both", {}, ENG, { scope: null })).toMatchObject({ ok: false, reason: "refAmbiguous" });
    expect(await deployWorkflow(def("both", [GATE, A_START]), ENG, ADMIN_SCOPE)).toMatchObject({ ok: false, reason: "refAmbiguous" });
    const pinned = await startRun("both", {}, ENG, { scope: null, workflowId: a.workflowId });
    expect(pinned.status).toBe("awaiting_confirm");
    const upd = await deployWorkflow(def("both", [GATE, A_START, { id: "x", type: "delay", ms: 1 }]), ENG, { scope: null, targetWorkflowId: a.workflowId });
    expect(upd).toMatchObject({ ok: true, workflowId: a.workflowId, version: 2 });
    // admin's own namespace is 'global' (a new ref ⇒ global)
    expect((await deployWorkflow(def("adm", [A_START]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    expect(rowsOf("adm")[0].scopeKey).toBe("global");
  });

  it("★ a VISIBLE 'global' workflow (pre-0367 / admin) is updated in place by a scoped user (no copy); an invisible one is not touched", async () => {
    const g = await deployWorkflow(def("glob", [GATE, A_START]), ENG, ADMIN_SCOPE);
    const again = await deployWorkflow(def("glob", [GATE, A_START, { id: "d", type: "delay", ms: 1 }]), ENG);
    expect(again).toMatchObject({ ok: true, workflowId: g.workflowId, version: 2 });
    expect(rowsOf("glob")).toHaveLength(1);
    expect((await deployWorkflow(def("globB", [GATE, B_START]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    const mine = await deployWorkflow(def("globB", [GATE, A_START]), ENG); // B's global is invisible to A
    expect(mine).toMatchObject({ ok: true, ref: "globB", version: 1 });
    expect(rowsOf("globB").map((w) => w.scopeKey).sort()).toEqual(["f:1", "global"]);
  });

  it("★ preference: own namespace › 'global' › the single visible one — a visible global and a visible foreign-namespace workflow ⇒ the global one (not ambiguous)", async () => {
    const g = await deployWorkflow(def("pref", [GATE, A_START]), ENG, ADMIN_SCOPE);
    // a workflow of ANOTHER namespace whose targets the caller can see (e.g. created before the caller's factory set changed)
    fake.store.set("orchestration_workflows", [...wfRows(), { id: 990, ref: "pref", scopeKey: "f:9", name: "x", version: 1, status: "active", definitionJson: { ref: "pref", name: "x", steps: [GATE, A_START] } }]);
    const r = await startRun("pref", {}, ENG);
    const run = (fake.store.get("orchestration_runs") as Row[]).find((x) => x.id === r.runId)!;
    expect(run.workflowId).toBe(g.workflowId);
    // and once the caller has its OWN workflow of the ref, that one wins
    fake.store.set("orchestration_workflows", [...wfRows(), { id: 991, ref: "pref", scopeKey: "f:1", name: "mine", version: 1, status: "active", definitionJson: { ref: "pref", name: "mine", steps: [GATE, A_START] } }]);
    const r2 = await startRun("pref", {}, ENG);
    expect((fake.store.get("orchestration_runs") as Row[]).find((x) => x.id === r2.runId)!.workflowId).toBe(991);
  });

  it("★ final wave F3 (R-7-d, replaces M-1): an UNDECIDABLE workflow of this ref (its pinned STOP's adapter is down) ⇒ deploy refused scopeUnverified — no silent copy", async () => {
    expect((await deployWorkflow(def("undec", [A_START, B_PINNED_STOP]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    conn.fp.delete(502);
    const r = await deployWorkflow(def("undec", [A_START]), ENG);
    expect(r).toMatchObject({ ok: false, reason: "scopeUnverified" });
    expect(rowsOf("undec").map((w) => w.scopeKey)).toEqual(["global"]); // no f:1 shadow
    // once decidable again (adapter back): visible ⇒ updated in place (no copy), as before
    conn.fp.set(502, adapterTargetFingerprint({ protocol: "modbus", endpoint: "tcp://127.0.0.1:1", machineId: 2, connectionOptions: null } as never));
    expect(await deployWorkflow(def("undec", [A_START]), ENG)).toMatchObject({ ok: false, reason: "refOutOfScope" }); // its B STOP is not ENG's
    expect(rowsOf("undec")).toHaveLength(1);
  });

  it("★ final wave F3 — the scope JUDGE fails ⇒ deploy and start refused scopeUnverified (never 'none' ⇒ copy, never a fallback)", async () => {
    expect((await deployWorkflow(def("jf", [GATE, A_START]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    judge.mode = "failed";
    expect(await startRun("jf", {}, ENG)).toMatchObject({ ok: false, reason: "scopeUnverified" });
    // the deploy refuses at the target check already (out of scope when the lookups fail); the resolver answers the same
    const { resolveWorkflowByRef } = await import("./foeEngine");
    expect(await resolveWorkflowByRef(fake as never, "jf", { userId: 10, userRole: "engineer" } as never, "f:1", { ownAnyVisibility: true })).toEqual({ kind: "unverified" });
    expect(await resolveWorkflowByRef(fake as never, "nope", { userId: 10, userRole: "engineer" } as never, "f:1")).toEqual({ kind: "unverified" });
    expect(rowsOf("jf")).toHaveLength(1);
  });

  it("★ final wave F3 — the starter's NAMESPACE key cannot be resolved ⇒ start refused scopeUnverified, the SAME answer for a missing ref; no fallback to the global X", async () => {
    expect((await deployWorkflow(def("gx", [GATE, A_START]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    judge.keyFail = true;
    const r = await startRun("gx", {}, ENG);
    const missing = await startRun("nope", {}, ENG);
    expect(r).toMatchObject({ ok: false, reason: "scopeUnverified" });
    expect(missing).toEqual(r);
    expect(fake.store.get("orchestration_runs") ?? []).toHaveLength(0);
    expect(await deployWorkflow(def("gx", [GATE, A_START]), ENG)).toMatchObject({ ok: false, reason: "scopeUnverified" });
  });

  it("★ final wave F3 — the caller's OWN X is undecidable and a global X is visible ⇒ start refused (not the global X); a foreign undecidable X does not block the global X", async () => {
    const g = await deployWorkflow(def("ow", [GATE, A_START]), ENG, ADMIN_SCOPE);
    fake.store.set("orchestration_workflows", [...wfRows(), { id: 995, ref: "ow", scopeKey: "f:1", name: "mine", version: 1, status: "active", definitionJson: { ref: "ow", name: "mine", steps: [GATE, A_START, B_PINNED_STOP] } }]);
    conn.fp.delete(502);
    expect(await startRun("ow", {}, ENG)).toMatchObject({ ok: false, reason: "scopeUnverified" });
    expect(fake.store.get("orchestration_runs") ?? []).toHaveLength(0);
    // the same undecidable row in ANOTHER namespace cannot outrank the visible global one ⇒ the global X starts
    (wfRows().find((w) => w.id === 995) as Row).scopeKey = "f:9";
    const r = await startRun("ow", {}, ENG);
    expect((fake.store.get("orchestration_runs") as Row[]).find((x) => x.id === r.runId)!.workflowId).toBe(g.workflowId);
  });

  it("★ final wave F9 (N5) — deploy with a STALE targetWorkflowId while the own namespace holds the ref ⇒ refTargetStale (not 'retry')", async () => {
    const mine = await deployWorkflow(def("st", [A_START]), ENG);
    expect(mine).toMatchObject({ ok: true, ref: "st" });
    const stale = await deployWorkflow(def("st", [A_START]), ENG, { targetWorkflowId: 4242 }); // gone / never visible
    expect(stale).toMatchObject({ ok: false, reason: "refTargetStale" });
    expect(String(stale.message)).not.toMatch(/retry/i);
    // the own row named by id ⇒ updated as before
    expect(await deployWorkflow(def("st", [A_START]), ENG, { targetWorkflowId: mine.workflowId })).toMatchObject({ ok: true, version: 2 });
  });

  it("★ M-2: a concurrent create (unique (ref, scope) violation) ⇒ refConflict, never the database text", async () => {
    const realInsert = (fake as any).insert.bind(fake);
    (fake as any).insert = (t: any) => {
      if (t?.[Symbol.for("drizzle:Name")] === "orchestration_workflows") {
        return { values: () => ({ returning: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "uq_orch_workflows_ref_scope"'), { code: "23505" }); } }) };
      }
      return realInsert(t);
    };
    try {
      const r = await deployWorkflow(def("race", [A_START]), ENG);
      expect(r).toMatchObject({ ok: false, reason: "refConflict" });
      expect(String(r.message)).not.toMatch(/duplicate key|uq_orch/);
    } finally {
      (fake as any).insert = realInsert;
    }
  });

  it("control: the system loader deploys into 'global' and keeps refusing a global workflow it cannot cover", async () => {
    expect((await deployWorkflow(def("tpl", [GATE]), LOADER)).ok).toBe(true);
    expect(rowsOf("tpl")[0].scopeKey).toBe("global");
    expect((await deployWorkflow(def("bonly2", [B_START]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    expect(await deployWorkflow(def("bonly2", [GATE]), LOADER)).toMatchObject({ ok: false, reason: "refOutOfScope" });
  });
});

describe("doc 81 Đợt 7 I3 — runVisibilityDefinitions / listVisibleRuns", () => {
  const seedWf = (id: number, version: number, steps: unknown[]) =>
    fake.store.set("orchestration_workflows", [...wfRows(), { id, ref: `w${id}`, name: `w${id}`, version, status: "active", definitionJson: { ref: `w${id}`, name: `w${id}`, steps } }]);
  const seedSnap = (workflowId: number, version: number, steps: unknown[]) =>
    fake.store.set("orchestration_workflow_versions", [...(fake.store.get("orchestration_workflow_versions") ?? []), { id: workflowId * 100 + version, workflowId, ref: `w${workflowId}`, version, name: "s", definitionJson: { ref: `w${workflowId}`, name: "s", steps } }]);

  it("★ legacy (no record) ⇒ the head; recorded ⇒ the head or the snapshot of each version; missing snapshot / workflow ⇒ null", async () => {
    seedWf(1, 2, [A_START]);
    seedSnap(1, 1, [B_START]);
    const defs = await runVisibilityDefinitions(fake as never, [
      { workflowId: 1, paramsJson: {} },
      { workflowId: 1, paramsJson: { __foeDefVersions: [1] } },
      { workflowId: 1, paramsJson: { __foeDefVersions: [1, 2] } },
      { workflowId: 1, paramsJson: { __foeDefVersions: [3] } },
      { workflowId: 9, paramsJson: { __foeDefVersions: [1] } },
      { workflowId: 1, paramsJson: { __foeDefVersions: ["1", -2] } }, // nothing valid ⇒ legacy (head)
    ]);
    const machinesOf = (ds: unknown) => (ds as Array<{ steps: Array<{ machineId: number }> }> | null)?.map((d) => d.steps[0].machineId) ?? null;
    expect(defs.map(machinesOf)).toEqual([[1], [2], [2, 1], null, null, [1]]);
  });

  it("★ a run is visible only when EVERY version it executed is (one out ⇒ hidden), whatever its head", async () => {
    seedWf(1, 2, [A_START]); // head v2: A
    seedSnap(1, 1, [B_START]); // v1: B
    const scope = { userId: 10, userRole: "engineer" } as never;
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [2] } }, scope)).toBe(true);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [1] } }, scope)).toBe(false);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [1, 2] } }, scope)).toBe(false);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [2, 1] } }, scope)).toBe(false);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: null }, scope)).toBe(true); // legacy ⇒ head (A)
  });

  // listVisibleRuns now filters IN SQL (doc 81 Đợt 7 I fix 1) — measured on the real `_test` database:
  // server/routers/orchestrationScope.dot5.db.test.ts ("bounded run list").
});
