/**
 * SCADA R1a Task 3 fix round 1 (I-1) — the early channel gate (3b) must not block a STOP that step 4 would ROUTE.
 *
 * On an EDGE-owned adapter (central holds no driver), `routeEdgeOwnedAdapterCommand` turns any stop-typed command into an
 * adapter-wide STOP of the PINNED values (queued for the owning node, or central's fallback) — the caller's values never reach
 * a wire. So a stop-typed command that fails 3b (here: an out-of-range, non-pin value) is routed as before, not refused
 * OUT_OF_RANGE. A CENTRAL adapter without a driver (not edge-owned) keeps the 3b refusal; a non-STOP write to the edge adapter
 * keeps it too (only stops are routed).
 *
 * Real `_test` DB (central kit: adapterA is owned by node A); the alert sink and the transient-session STOP are recorders
 * (pattern of otEdgeOwnedStop.finalfix.dot10.db.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKit, type Kit } from "../edge/__edgeCentralKit.dot10";

const rec = vi.hoisted(() => ({ alerts: [] as Array<{ kind: string; message: string }>, fallback: [] as number[] }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; message: string }) => {
    rec.alerts.push(a);
  },
}));
vi.mock("../robot/deviceOwnershipService", async importOriginal => {
  const orig = await importOriginal<typeof import("../robot/deviceOwnershipService")>();
  return {
    ...orig,
    sendCentralAdapterStop: async (adapterId: number) => {
      rec.fallback.push(adapterId);
      return { ok: true, sent: "sent" as const, detail: "pinned stop written on a transient session (recorded)" };
    },
  };
});

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
let centralAdapter = 0;
let seq = 0;

/** A declared write channel: int, range 10..100 (mig 0431 columns written straight into the row). */
const TAG_KHAI = "r1a_sp";

describe.skipIf(!onTest)("R1a T3 fix round 1 I-1 — 3b never blocks a STOP routed to the owning edge node (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("R1T3E");
    await k.sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, write_min, write_max) VALUES (${k.ids.adapterA}, ${TAG_KHAI}, 'D300', 'int', true, 10, 100)`;
    const [m] = await k.sql`SELECT "machineId" FROM device_adapters WHERE id = ${k.ids.adapterA}`;
    const [a] = await k.sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`R1T3C-${k.DAU}`}, 'central adapter', 'stub', 'stub://r1t3c', true, ${m.machineId}) RETURNING id`;
    centralAdapter = Number(a.id);
    await k.sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, write_min, write_max) VALUES (${centralAdapter}, ${TAG_KHAI}, 'D300', 'int', true, 10, 100)`;
  }, 120_000);

  afterAll(async () => {
    if (centralAdapter) {
      await k.sql`DELETE FROM device_tags WHERE "adapterId" = ${centralAdapter}`.catch(() => undefined);
      await k.sql`DELETE FROM device_adapters WHERE id = ${centralAdapter}`.catch(() => undefined);
    }
    await k?.teardown();
  }, 120_000);

  beforeEach(() => {
    rec.alerts.length = 0;
    rec.fallback.length = 0;
  });

  const hitl = () => ({ kind: "hitl" as const, requestedBy: k.u.admin, confirmedBy: k.u.admin });

  it("★ edge-owned adapter: `stop` with an OUT-OF-RANGE non-pin value ⇒ routed (edgeStopRequest + a queued stop request row), NOT OUT_OF_RANGE", async () => {
    const { dispatch } = await import("./commandDispatcher");
    (await import("../edge/edgeNodeCommands")).noteEdgeNodePull(k.ids.nodeA); // the owner is pulling (reachable)
    const r = await dispatch({ adapterId: k.ids.adapterA, commandType: "stop", writes: [{ tagKey: TAG_KHAI, value: 500 }], triggeredBy: hitl(), idempotencyKey: `r1t3e-stop-${++seq}-${k.DAU}` });
    expect(r.reason).not.toBe("OUT_OF_RANGE");
    expect(r).toMatchObject({ reason: "ADAPTER_OWNED_BY_EDGE", edgeStopRequest: { edgeNodeId: k.ids.nodeA } });
    const [row] = await k.sql`SELECT kind, "adapterId", "edgeNodeId" FROM robot_motion_lock_requests WHERE id = ${r.edgeStopRequest!.requestId}`;
    expect(row).toMatchObject({ kind: "stop", adapterId: k.ids.adapterA, edgeNodeId: k.ids.nodeA });
  });

  it("edge-owned adapter: a NON-stop write out of range ⇒ still OUT_OF_RANGE (only stop-typed commands are routed), nothing queued", async () => {
    const { dispatch } = await import("./commandDispatcher");
    const before = Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n);
    const r = await dispatch({ adapterId: k.ids.adapterA, commandType: "set_param", writes: [{ tagKey: TAG_KHAI, value: 500 }], triggeredBy: hitl(), idempotencyKey: `r1t3e-set-${++seq}-${k.DAU}` });
    expect(r).toMatchObject({ status: "rejected", reason: "OUT_OF_RANGE" });
    expect(Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n)).toBe(before);
  });

  it("CENTRAL adapter without a driver (not edge-owned): the same `stop` ⇒ still OUT_OF_RANGE, no fallback STOP", async () => {
    const { dispatch } = await import("./commandDispatcher");
    const r = await dispatch({ adapterId: centralAdapter, commandType: "stop", writes: [{ tagKey: TAG_KHAI, value: 500 }], triggeredBy: hitl(), idempotencyKey: `r1t3e-c-${++seq}-${k.DAU}` });
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "OUT_OF_RANGE" });
    expect(r.edgeStopRequest).toBeUndefined();
    expect(rec.fallback).toEqual([]);
  });
});
