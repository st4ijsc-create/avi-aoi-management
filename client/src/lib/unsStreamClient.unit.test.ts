/**
 * doc 44 W6-2 / G5.13 — UNS stream client (reducer + controller), node env.
 */
import { describe, it, expect } from "vitest";
import {
  unsStreamReducer,
  initialUnsState,
  createUnsStream,
  unsStreamLive,
  unsMachineSnapshot,
  isa95Slug,
  type UnsSocketLike,
  type UnsClientSnapshot,
} from "./unsStreamClient";

const snap = (over: Partial<UnsClientSnapshot>): UnsClientSnapshot => ({
  path: over.path ?? "site1/area1/line1/cell1/eq1",
  ts: over.ts ?? "2026-07-12T00:00:00.000Z",
  state: over.state ?? "EXECUTE",
  machineId: over.machineId,
  ...over,
});

describe("unsStreamReducer — snapshot then delta", () => {
  it("snapshot sets the base; a later delta patches it (order preserved)", () => {
    let s = initialUnsState();
    s = unsStreamReducer(s, {
      type: "snapshot",
      msg: {
        path_prefix: "site1",
        ts: "2026-07-12T00:00:00.000Z",
        snapshots: [snap({ path: "site1/a/l/c/eq1", state: "IDLE", machineId: 1 })],
      },
    });
    expect(unsStreamLive(s)).toBe(true);
    expect(s.snapshots.get("site1/a/l/c/eq1")!.state).toBe("IDLE");

    // delta patches the SAME path to EXECUTE
    s = unsStreamReducer(s, {
      type: "delta",
      msg: { aspect: "state", path: "site1/a/l/c/eq1", ts: "2026-07-12T00:01:00.000Z", snapshot: snap({ path: "site1/a/l/c/eq1", state: "EXECUTE", machineId: 1 }) },
    });
    expect(s.snapshots.get("site1/a/l/c/eq1")!.state).toBe("EXECUTE");
    expect(unsMachineSnapshot(s, 1)!.state).toBe("EXECUTE");
    expect(s.lastDeltaTs).toBe("2026-07-12T00:01:00.000Z");
  });

  it("a state delta for a NEW path just adds it (robust if it precedes snapshot)", () => {
    let s = initialUnsState();
    s = unsStreamReducer(s, {
      type: "delta",
      msg: { aspect: "state", path: "site1/a/l/c/eq9", ts: "t", snapshot: snap({ path: "site1/a/l/c/eq9", machineId: 9 }) },
    });
    expect(s.snapshots.get("site1/a/l/c/eq9")).toBeTruthy();
    // no snapshot yet → NOT live (honest)
    expect(unsStreamLive(s)).toBe(false);
  });

  it("snapshot RESYNC drops stale entries under the prefix (reconnect)", () => {
    let s = initialUnsState();
    s = unsStreamReducer(s, {
      type: "snapshot",
      msg: { path_prefix: "site1", snapshots: [snap({ path: "site1/a/l/c/old", machineId: 1 }), snap({ path: "site1/a/l/c/keep", machineId: 2 })] },
    });
    expect(s.snapshots.size).toBe(2);
    // reconnect snapshot only has "keep" → "old" must be evicted
    s = unsStreamReducer(s, {
      type: "snapshot",
      msg: { path_prefix: "site1", snapshots: [snap({ path: "site1/a/l/c/keep", state: "STOPPED", machineId: 2 })] },
    });
    expect(s.snapshots.has("site1/a/l/c/old")).toBe(false);
    expect(s.snapshots.get("site1/a/l/c/keep")!.state).toBe("STOPPED");
    expect(s.byMachineId.has(1)).toBe(false);
  });

  it("coalesced dropped frame marks the stream thinned + applies its deltas", () => {
    let s = initialUnsState();
    s = unsStreamReducer(s, { type: "snapshot", msg: { path_prefix: "site1", snapshots: [] } });
    s = unsStreamReducer(s, {
      type: "delta",
      msg: {
        coalesced: true,
        dropped: true,
        deltas: [
          { aspect: "state", path: "site1/a/l/c/eq1", ts: "t", snapshot: snap({ path: "site1/a/l/c/eq1", machineId: 1 }) },
          { aspect: "events", path: "site1/a/l/c/eq1", ts: "t", event: { event_id: "e1", type: "andon:x", severity: "critical", ts: "t" } },
        ],
      },
    });
    expect(s.thinned).toBe(true);
    expect(s.snapshots.has("site1/a/l/c/eq1")).toBe(true);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].path).toBe("site1/a/l/c/eq1");
  });

  it("disconnect → conn=disconnected; reconnect keeps live if we already had a snapshot", () => {
    let s = initialUnsState();
    s = unsStreamReducer(s, { type: "snapshot", msg: { path_prefix: "site1", snapshots: [] } });
    s = unsStreamReducer(s, { type: "disconnect" });
    expect(s.conn).toBe("disconnected");
    s = unsStreamReducer(s, { type: "connect" });
    expect(s.conn).toBe("live"); // snapshotCount > 0
  });

  it("does not mutate the previous state object", () => {
    const s0 = initialUnsState();
    const s1 = unsStreamReducer(s0, { type: "snapshot", msg: { path_prefix: "site1", snapshots: [snap({})] } });
    expect(s1).not.toBe(s0);
    expect(s0.snapshots.size).toBe(0); // original untouched
  });
});

// ─── Fake socket: records emits + lets tests fire server events ───────────────

class FakeSocket implements UnsSocketLike {
  connected = true;
  emitted: Array<{ event: string; args: unknown[] }> = [];
  private handlers = new Map<string, Set<(...a: any[]) => void>>();
  on(event: string, cb: (...a: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
    return this;
  }
  off(event: string, cb: (...a: any[]) => void) {
    this.handlers.get(event)?.delete(cb);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    return this;
  }
  /** Simulate a server → client event. */
  fire(event: string, payload?: unknown) {
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }
}

describe("createUnsStream — controller over a fake socket", () => {
  it("emits uns:subscribe on create with the requested prefix/aspects", () => {
    const sock = new FakeSocket();
    const ctrl = createUnsStream(sock, { pathPrefix: "site1", aspects: ["state"], minSeverity: "warning" });
    const sub = sock.emitted.find((e) => e.event === "uns:subscribe");
    expect(sub).toBeTruthy();
    expect(sub!.args[0]).toMatchObject({ path_prefix: "site1", aspects: ["state"], min_severity: "warning" });
    ctrl.dispose();
  });

  it("snapshot-before-delta: applies snapshot then delta, notifies subscribers", () => {
    const sock = new FakeSocket();
    const ctrl = createUnsStream(sock, { pathPrefix: "site1" });
    let notifications = 0;
    ctrl.subscribe(() => (notifications += 1));

    sock.fire("uns:snapshot", {
      path_prefix: "site1",
      snapshots: [snap({ path: "site1/a/l/c/eq1", state: "IDLE", machineId: 1 })],
    });
    expect(unsStreamLive(ctrl.getState())).toBe(true);
    expect(ctrl.getState().snapshots.get("site1/a/l/c/eq1")!.state).toBe("IDLE");

    sock.fire("uns:delta", { aspect: "state", path: "site1/a/l/c/eq1", ts: "t", snapshot: snap({ path: "site1/a/l/c/eq1", state: "EXECUTE", machineId: 1 }) });
    expect(ctrl.getState().snapshots.get("site1/a/l/c/eq1")!.state).toBe("EXECUTE");
    expect(notifications).toBeGreaterThanOrEqual(2);
    ctrl.dispose();
  });

  it("resubscribes on reconnect (connect event → another uns:subscribe)", () => {
    const sock = new FakeSocket();
    const ctrl = createUnsStream(sock, { pathPrefix: "site1" });
    const before = sock.emitted.filter((e) => e.event === "uns:subscribe").length;
    sock.fire("connect");
    const after = sock.emitted.filter((e) => e.event === "uns:subscribe").length;
    expect(after).toBe(before + 1);
    ctrl.dispose();
  });

  it("dispose sends uns:unsubscribe and detaches handlers", () => {
    const sock = new FakeSocket();
    const ctrl = createUnsStream(sock, { pathPrefix: "site1" });
    ctrl.dispose();
    expect(sock.emitted.some((e) => e.event === "uns:unsubscribe")).toBe(true);
    // after dispose, a fired snapshot must NOT change state
    const stateBefore = ctrl.getState();
    sock.fire("uns:snapshot", { path_prefix: "site1", snapshots: [snap({})] });
    expect(ctrl.getState()).toBe(stateBefore);
  });

  it("does NOT go live when the server flag is off (no snapshot ever arrives)", () => {
    const sock = new FakeSocket();
    const ctrl = createUnsStream(sock, { pathPrefix: "site1" });
    // server no-op: nothing fired back
    expect(unsStreamLive(ctrl.getState())).toBe(false);
    expect(ctrl.getState().conn).toBe("connecting");
    ctrl.dispose();
  });
});

describe("isa95Slug mirrors the server slugSegment", () => {
  it("lowercases, strips diacritics, collapses non-alnum to '-'", () => {
    expect(isa95Slug("Line A")).toBe("line-a");
    expect(isa95Slug("Nhà máy Đông")).toBe("nha-may-dong");
    expect(isa95Slug("F-01")).toBe("f-01");
    expect(isa95Slug("")).toBe("unassigned");
    expect(isa95Slug(null)).toBe("unassigned");
  });
});
