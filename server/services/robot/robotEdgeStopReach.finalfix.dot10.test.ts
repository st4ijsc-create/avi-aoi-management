/**
 * doc 81 Đợt 10 final fix wave — I-3 (ruling R-10-br, L-7): a console STOP queued for an edge node that central cannot reach
 * (its pulls / heartbeat are stale, or that cannot be read) is NEVER answered as a plain success:
 *   • the outcome says `edgeUnreachable` (the router answers `queued_edge_unreachable`, a warning — not ok-green);
 *   • a central fallback STOP is attempted AT ONCE (transient session), bounded by the reply bound;
 *   • a DURABLE critical alert is raised at once, deduplicated per request (`stop_undelivered:request:<id>`).
 * A reachable node keeps today's answer (queued, no fallback, no alert). The queue and the reachability read go through the port.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: async () => null }));
const alerts = vi.hoisted(() => ({ list: [] as Array<{ kind: string; dedupKey: string; message: string }> }));
vi.mock("./criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { kind: string; dedupKey: string; message: string }) => {
    alerts.list.push(a);
  },
}));
import { sendConsoleStopForEdgeRobot, setEdgeDeviceRequestPort } from "./robotEdgeCommandPort";

let reach: { reachable: boolean; basis: string; ageMs: number | null } = { reachable: true, basis: "pull", ageMs: 100 };
beforeEach(() => {
  alerts.list.length = 0;
  reach = { reachable: true, basis: "pull", ageMs: 100 };
  setEdgeDeviceRequestPort({
    async enqueue() {
      return { requestId: 501, edgeNodeId: 4, ownerEpoch: 2 };
    },
    async reachable() {
      return reach as never;
    },
  });
});
const base = { robotId: 12, requestedBy: 7, reason: "console stop" };

describe("final fix wave I-3 — console STOP for an UNREACHABLE edge owner", () => {
  it("★ reachable owner ⇒ queued, no fallback STOP, no alert (today's answer)", async () => {
    const fallback = vi.fn(async () => ({ ok: true, sent: "sent", detail: "x" }));
    const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => null, fallbackStop: fallback });
    expect(r).toMatchObject({ ok: true, via: "edge_queue", requestId: 501 });
    expect(r.edgeUnreachable).toBeFalsy();
    expect(fallback).not.toHaveBeenCalled();
    await new Promise((x) => setTimeout(x, 10));
    expect(alerts.list).toEqual([]);
  });

  it("★ stale owner ⇒ edgeUnreachable + the central fallback STOP at once + a durable critical alert keyed by the request", async () => {
    reach = { reachable: false, basis: "pull", ageMs: 45_000 };
    const fallback = vi.fn(async () => ({ ok: true, sent: "sent", detail: "abort sent on a transient session" }));
    const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => null, fallbackStop: fallback });
    expect(r).toMatchObject({ ok: true, via: "edge_queue", requestId: 501, edgeUnreachable: true, centralFallback: { state: "done", value: { ok: true, sent: "sent" } } });
    expect(fallback).toHaveBeenCalledTimes(1);
    await new Promise((x) => setTimeout(x, 10));
    expect(alerts.list).toHaveLength(1);
    expect(alerts.list[0]).toMatchObject({ kind: "stop_undelivered", dedupKey: "stop_undelivered:request:501" });
    expect(alerts.list[0].message).toMatch(/unreachable/i);
  });

  it("★ the reachability read FAILS ⇒ treated as unreachable (never a false 'accepted')", async () => {
    setEdgeDeviceRequestPort({
      async enqueue() {
        return { requestId: 502, edgeNodeId: 4, ownerEpoch: 2 };
      },
      async reachable() {
        throw new Error("db down");
      },
    });
    const fallback = vi.fn(async () => ({ ok: false, sent: "failed", detail: "connect timed out" }));
    const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => null, fallbackStop: fallback });
    expect(r).toMatchObject({ ok: true, edgeUnreachable: true, centralFallback: { state: "done", value: { ok: false } } });
    await new Promise((x) => setTimeout(x, 10));
    expect(alerts.list.map((a) => a.dedupKey)).toEqual(["stop_undelivered:request:502"]);
    expect(alerts.list[0].message).toMatch(/E-STOP/);
  });

  it("★ a fallback STOP slower than the reply bound ⇒ answered at the bound as pending (never waits for it)", async () => {
    reach = { reachable: false, basis: "heartbeat", ageMs: 90_000 };
    const fallback = vi.fn(() => new Promise<{ ok: boolean; sent: string; detail: string }>(() => undefined));
    const t0 = Date.now();
    const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => null, fallbackStop: fallback, replyBoundMs: 150 });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(r).toMatchObject({ ok: true, edgeUnreachable: true, centralFallback: { state: "pending" } });
  });
});
