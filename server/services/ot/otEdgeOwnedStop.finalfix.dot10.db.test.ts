/**
 * doc 81 Đợt 10 final fix wave — I-4 (ruling R-10-br, L-7): a CENTRAL OT command to an EDGE-owned adapter (central holds no driver
 * for it) is never answered by the silent `ADAPTER_OFFLINE` any more:
 *   • stop-typed (stop / e_stop — console, interlock auto-block, central run abort) ⇒ an adapter STOP request is QUEUED for the
 *     owning node (robot_motion_lock_requests, kind stop, adapterId), the result says so (reason ADAPTER_OWNED_BY_EDGE +
 *     edgeStopRequest), and a durable alert is raised; the queue failing ⇒ central's fallback STOP on a transient session
 *     (R-10-ay) + a critical alert, never silence;
 *   • non-STOP writes ⇒ refused with the explicit ADAPTER_OWNED_BY_EDGE code (nothing queued, nothing written);
 *   • a CENTRAL-owned adapter without a driver keeps ADAPTER_OFFLINE (central path unchanged).
 * Real `_test` DB (central kit: adapterA is owned by node A); the alert sink and the transient-session STOP are recorders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKit, type Kit } from "../edge/__edgeCentralKit.dot10";

const rec = vi.hoisted(() => ({ alerts: [] as Array<{ kind: string; message: string; dedupKey: string }>, fallback: [] as number[] }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; message: string; dedupKey: string }) => {
    rec.alerts.push(a);
  },
}));
vi.mock("../robot/deviceOwnershipService", async (importOriginal) => {
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

describe.skipIf(!onTest)("doc 81 Đợt 10 final fix wave I-4 — central OT command to an edge-owned adapter (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("FFI4");
    const [m] = await k.sql`SELECT "machineId" FROM device_adapters WHERE id = ${k.ids.adapterA}`;
    const [a] = await k.sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`AC-${k.DAU}`}, 'central adapter', 'stub', 'stub://c', true, ${m.machineId}) RETURNING id`;
    centralAdapter = Number(a.id);
    await k.sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value, stop_pinned_by, stop_pinned_at) VALUES (${centralAdapter}, 'stop_cmd', 'M0', 'bool', true, ${k.sql.json(true)}, ${String(k.u.admin)}, now())`;
  }, 120_000);
  afterAll(async () => {
    if (centralAdapter) {
      await k.sql`DELETE FROM command_log WHERE "adapterId" = ${centralAdapter}`.catch(() => undefined);
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

  it("★ STOP to an edge-owned adapter ⇒ an adapter STOP request queued for its owner + a durable alert; never ADAPTER_OFFLINE", async () => {
    const { dispatch } = await import("./commandDispatcher");
    (await import("../edge/edgeNodeCommands")).noteEdgeNodePull(k.ids.nodeA); // the owner is pulling (reachable)
    const r = await dispatch({ adapterId: k.ids.adapterA, commandType: "stop", writes: [{ tagKey: "stop_cmd", value: true }], triggeredBy: hitl(), idempotencyKey: `ffi4-stop-${++seq}-${k.DAU}` });
    expect(r.reason).not.toBe("ADAPTER_OFFLINE");
    expect(r).toMatchObject({ reason: "ADAPTER_OWNED_BY_EDGE", edgeStopRequest: { edgeNodeId: k.ids.nodeA } });
    const id = r.edgeStopRequest!.requestId;
    const [row] = await k.sql`SELECT kind, "adapterId", "robotId", "edgeNodeId", "ackedAt" FROM robot_motion_lock_requests WHERE id = ${id}`;
    expect(row).toMatchObject({ kind: "stop", adapterId: k.ids.adapterA, robotId: null, edgeNodeId: k.ids.nodeA, ackedAt: null });
    await new Promise((x) => setTimeout(x, 20));
    expect(rec.alerts.some((a) => a.kind === "ot_stop_routed_to_edge" && a.message.includes(`#${id}`))).toBe(true);
    expect(rec.fallback).toEqual([]);
    // the ledger says what happened (no silent failure)
    const led = await k.sql`SELECT status, "errorText" FROM command_log WHERE "adapterId" = ${k.ids.adapterA} AND "idempotencyKey" LIKE ${`ffi4-stop-${seq}-%`}`;
    expect(led.length).toBeGreaterThan(0);
    expect(String(led[0].errorText ?? "")).toMatch(new RegExp(`#${id}`));
  });

  it("★ residual MIN-2 (R-10-bt): the owning node is UNREACHABLE ⇒ queued AND central's pinned fallback STOP at once + a stop_undelivered alert (I-3 parity)", async () => {
    const { dispatch } = await import("./commandDispatcher");
    const cmds = await import("../edge/edgeNodeCommands");
    cmds.__resetEdgeNodePullsForTests();
    await k.sql`UPDATE edge_nodes SET "lastHeartbeatAt" = NULL WHERE id = ${k.ids.nodeA}`;
    const r = await dispatch({ adapterId: k.ids.adapterA, commandType: "stop", writes: [{ tagKey: "stop_cmd", value: true }], triggeredBy: hitl(), idempotencyKey: `ffi4-unr-${++seq}-${k.DAU}` });
    expect(r).toMatchObject({ reason: "ADAPTER_OWNED_BY_EDGE", edgeStopRequest: { edgeNodeId: k.ids.nodeA } });
    expect(rec.fallback).toEqual([k.ids.adapterA]);
    await new Promise((x) => setTimeout(x, 20));
    expect(rec.alerts.some((a) => a.kind === "stop_undelivered" && a.dedupKey === `stop_undelivered:request:${r.edgeStopRequest!.requestId}` && /UNREACHABLE/.test(a.message))).toBe(true);
  });

  it("★ the queue cannot take it (edge runtime off) ⇒ central's fallback STOP (transient session) + a critical alert — never silence", async () => {
    const { dispatch } = await import("./commandDispatcher");
    const saved = process.env.EDGE_RUNTIME_ENABLED;
    process.env.EDGE_RUNTIME_ENABLED = "false";
    try {
      const r = await dispatch({ adapterId: k.ids.adapterA, commandType: "e_stop", writes: [{ tagKey: "stop_cmd", value: true }], triggeredBy: hitl(), idempotencyKey: `ffi4-fb-${++seq}-${k.DAU}` });
      expect(r.reason).toBe("ADAPTER_OWNED_BY_EDGE");
      expect(rec.fallback).toEqual([k.ids.adapterA]);
      await new Promise((x) => setTimeout(x, 20));
      expect(rec.alerts.some((a) => a.kind === "ot_stop_not_queued")).toBe(true);
    } finally {
      process.env.EDGE_RUNTIME_ENABLED = saved;
    }
  });

  it("★ a NON-STOP write to an edge-owned adapter ⇒ refused ADAPTER_OWNED_BY_EDGE (nothing queued); a central adapter without a driver keeps ADAPTER_OFFLINE", async () => {
    const { dispatch } = await import("./commandDispatcher");
    const before = Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n);
    const w = await dispatch({ adapterId: k.ids.adapterA, commandType: "set_param", writes: [{ tagKey: "speed_sp", value: 9 }], triggeredBy: hitl(), idempotencyKey: `ffi4-w-${++seq}-${k.DAU}` });
    expect(w).toMatchObject({ ok: false, status: "rejected", reason: "ADAPTER_OWNED_BY_EDGE" });
    expect(Number((await k.sql`SELECT count(*)::int AS n FROM robot_motion_lock_requests WHERE "adapterId" = ${k.ids.adapterA}`)[0].n)).toBe(before);
    const c = await dispatch({ adapterId: centralAdapter, commandType: "stop", writes: [{ tagKey: "stop_cmd", value: true }], triggeredBy: hitl(), idempotencyKey: `ffi4-c-${++seq}-${k.DAU}` });
    expect(c).toMatchObject({ ok: false, status: "failed", reason: "ADAPTER_OFFLINE" });
    expect(rec.fallback).toEqual([]);
  });
});
