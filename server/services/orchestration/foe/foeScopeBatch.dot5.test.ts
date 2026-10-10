/**
 * doc 81 Đợt 5 task E fix 2 (review N3) — the list scope filter is BATCHED: for any number of definitions,
 * `resolveVisibleWorkflowIds` reads the workflow definitions ONCE, the bound adapters at most ONCE and the stop pins
 * (device_tags) ONCE — not once per definition / per adapter (the N+1 the re-review measured). Semantics are unchanged:
 * the same definitions are visible as with one-by-one evaluation, and a pin-read failure is reported (`ok: false`).
 * The scope judge is driven by the test (restricted: machine 1 in scope, machine 2 out); everything else is real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

// The dispatcher's OWN connection check (runningConnectionMatchesAdapterRow) runs for real: the running connection of
// every adapter is registered with the fingerprint of its current row (no stale connection in this file).
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  const { adapterTargetFingerprint } = await import("../../ot/adapterTarget");
  return {
    ...orig,
    getActiveConnectionFingerprint: (adapterId: number) =>
      adapterTargetFingerprint({ protocol: "modbus", endpoint: `tcp://10.0.0.${adapterId % 250}:502`, machineId: 2, connectionOptions: null } as never),
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return {
    ...orig,
    makeScopeJudge: async () => ({
      unrestricted: false,
      failed: false,
      outOf: async (t: { machines: Map<number, boolean> }, o?: { nonStopOnly?: boolean }) => ({
        machines: [...t.machines.entries()].filter(([id, nonStop]) => id === 2 && (!o?.nonStopOnly || nonStop)).map(([id]) => id),
        robots: [],
        adapters: [],
      }),
    }),
  };
});

const fake = new FakeDb();
const COUNT = new Map<string, number>();
const FAIL = { table: "" };
{
  const NAME = Symbol.for("drizzle:Name");
  const realSelect = fake.select.bind(fake);
  (fake as any).select = (proj?: Record<string, any>) => {
    const b = realSelect(proj);
    const from = b.from.bind(b);
    b.from = (t: any) => {
      const n = t[NAME];
      COUNT.set(n, (COUNT.get(n) ?? 0) + 1);
      if (FAIL.table === n) throw new Error("pin read failed");
      return from(t);
    };
    return b;
  };
}
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const inArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]);
  return { ...actual, eq: makeEq, and: makeAnd, inArray };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationWorkflows, machines, deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import { resolveVisibleWorkflowIds, definitionVisibleTo } from "./foeEngine";
import type { WorkflowDefinition } from "./workflowModel";

const N = 12;
const defs: WorkflowDefinition[] = [];
beforeEach(() => {
  fake.store.clear();
  resetSeq();
  COUNT.clear();
  FAIL.table = "";
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "A", stationId: 1 },
    { id: 2, machineType: "AUTOMATION", capabilities: null, code: "M2", name: "B", stationId: 2 },
  ]);
  const adapters: Array<Record<string, unknown>> = [];
  const tags: Array<Record<string, unknown>> = [];
  defs.length = 0;
  const wfs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < N; i++) {
    const adapterId = 900 + i;
    adapters.push({ id: adapterId, machineId: 2, isEnabled: false, protocol: "modbus", endpoint: `tcp://10.0.0.${adapterId % 250}:502`, connectionOptions: null });
    tags.push({ id: 5000 + i, adapterId, tagKey: "estop", dataType: "bool", stopValue: true, writable: true, isEnabled: true });
    // even i: an A-only workflow + a PINNED stop of B (visible); odd i: an UNPINNED stop of B (not visible)
    const pinned = i % 2 === 0;
    const def: WorkflowDefinition = {
      ref: `wf${i}`,
      name: `wf${i}`,
      steps: [
        { id: "a", type: "command", machineId: 1, command: "start" },
        { id: "s", type: "command", machineId: 2, command: "stop", args: { adapterId, writes: [{ tagKey: pinned ? "estop" : "run", value: true }] } },
      ] as never,
    };
    defs.push(def);
    wfs.push({ id: 100 + i, ref: def.ref, name: def.name, definitionJson: def, status: "active" });
  }
  fake.seed(deviceAdapters, adapters);
  fake.seed(deviceTags, tags);
  fake.seed(orchestrationWorkflows, wfs);
});

describe("doc 81 Đợt 5 E fix 2 (review N3) — the list scope filter is batched (no N+1), semantics unchanged", () => {
  it(`★ ${N} definitions ⇒ ONE definitions read, ONE stop-pin read, no per-definition adapter read; the same rows as one-by-one`, async () => {
    const r = await resolveVisibleWorkflowIds({ userId: 1, userRole: "engineer" });
    expect(r.ok).toBe(true);
    const visible = (r as { ok: true; ids: number[] }).ids;
    expect(COUNT.get("orchestration_workflows")).toBe(1);
    expect(COUNT.get("device_tags")).toBe(1);
    // device_adapters: at most one bound-adapter read + the dispatcher's connection check ONCE per distinct pinned adapter
    // (6 here — every even definition has its own adapter); never once per definition × adapter.
    expect(COUNT.get("device_adapters") ?? 0).toBeLessThanOrEqual(1 + N / 2);
    // semantics: identical to evaluating each definition on its own
    const oneByOne: number[] = [];
    for (let i = 0; i < N; i++) if (await definitionVisibleTo(defs[i], { userId: 1, userRole: "engineer" })) oneByOne.push(100 + i);
    expect(visible.sort()).toEqual(oneByOne.sort());
    expect(visible.sort()).toEqual([...Array(N).keys()].filter((i) => i % 2 === 0).map((i) => 100 + i).sort());
  });

  it("★ many definitions sharing ONE adapter ⇒ its pins read once and its connection checked once", async () => {
    const wfs = (fake.store.get("orchestration_workflows") ?? []) as Array<Record<string, any>>;
    for (const w of wfs) {
      const st = w.definitionJson.steps[1];
      st.args = { ...st.args, adapterId: 900 };
    }
    const r = await resolveVisibleWorkflowIds({ userId: 1, userRole: "engineer" });
    expect(r.ok).toBe(true);
    expect(COUNT.get("device_tags")).toBe(1);
    expect(COUNT.get("device_adapters") ?? 0).toBeLessThanOrEqual(2);
    expect((r as { ok: true; ids: number[] }).ids.length).toBe(N / 2);
  });

  it("a stop-pin read failure ⇒ reported (ok: false — the hub shows the count degraded), never a silent 'nothing visible'", async () => {
    FAIL.table = "device_tags";
    // final wave F3 (2026-10-10) — still `ok: false` (degraded); `decidedIds` now lists the workflows DECIDED visible
    // despite the failure: none here (every definition is out of scope unless its unverifiable stop is a stop).
    expect(await resolveVisibleWorkflowIds({ userId: 1, userRole: "engineer" })).toEqual({ ok: false, decidedIds: [] });
  });
});
