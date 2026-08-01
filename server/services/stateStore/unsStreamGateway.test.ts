/**
 * W2-B1 (doc 44 G2.17) — WS snapshot-then-stream tests: flag OFF = no-op,
 * snapshot ALWAYS precedes deltas, prefix + aspect + min_severity filtering,
 * unsubscribe, guard (machine sockets denied), backpressure coalescing with an
 * honest dropped:true mark.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── mocks (hoisted) ──────────────────────────────────────────────────────────
vi.mock("../cacheService", () => ({
  cacheService: {
    getAsync: vi.fn(async () => null),
    setAsync: vi.fn(async () => undefined),
  },
}));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../db/otTelemetry", () => ({ getLatestTelemetry: vi.fn(async () => []) }));
vi.mock("../../../drizzle/schema", () => ({
  machines: { __mockName: "machines" },
  machineStatusLogs: { __mockName: "machineStatusLogs" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => a,
  and: (...a: unknown[]) => a,
  desc: (x: unknown) => x,
}));
vi.mock("../uns/isa95Resolver", () => ({
  resolveIsa95Path: vi.fn(async (machineId: number) =>
    machineId === 1 ? { site: "f1", area: "a", line: "l1", cell: "c1", equipment: "m1" } : null,
  ),
}));

import { eventBus, EventTypes } from "../../_core/eventBus";
import { setState, _resetStateStoreForTests, type StateSnapshot } from "./stateStore";
import {
  registerUnsStreamHandlers,
  fanoutDelta,
  _resetUnsStreamForTests,
  _unsStreamSubscriberCount,
} from "./unsStreamGateway";

// ── mock socket ───────────────────────────────────────────────────────────────
interface MockSocket {
  id: string;
  data: Record<string, unknown>;
  handlers: Record<string, Array<(...a: unknown[]) => void>>;
  emitted: Array<{ event: string; payload: any }>;
  on(ev: string, cb: (...a: unknown[]) => void): void;
  emit(ev: string, payload?: unknown): void;
  join(room: string): void;
  leave(room: string): void;
  trigger(ev: string, payload?: unknown): void;
}

function makeSocket(id: string, clientType = "browser"): MockSocket {
  return {
    id,
    data: { clientType },
    handlers: {},
    emitted: [],
    on(ev, cb) {
      (this.handlers[ev] ??= []).push(cb);
    },
    emit(ev, payload) {
      this.emitted.push({ event: ev, payload });
    },
    join: vi.fn() as unknown as MockSocket["join"],
    leave: vi.fn() as unknown as MockSocket["leave"],
    trigger(ev, payload) {
      for (const cb of this.handlers[ev] ?? []) cb(payload);
    },
  };
}

function liveSnap(path: string, state = "EXECUTE"): StateSnapshot {
  return { path, ts: new Date().toISOString(), state, source: "live", machineId: 1 };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  _resetStateStoreForTests();
  _resetUnsStreamForTests();
  vi.unstubAllEnvs();
});
afterEach(() => {
  _resetUnsStreamForTests();
  vi.unstubAllEnvs();
});

describe("G2.17 — flag gate & guard", () => {
  it("WS_UNS_STREAM_ENABLED OFF (default) → uns:subscribe is a complete no-op", () => {
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1" });
    expect(s.emitted).toEqual([]);
    expect(s.join).not.toHaveBeenCalled();
    expect(_unsStreamSubscriberCount()).toBe(0);
  });

  it("machine sockets (cookie-auth bypass) cannot subscribe", () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    const s = makeSocket("s1", "machine");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1" });
    expect(s.emitted).toEqual([]);
    expect(_unsStreamSubscriberCount()).toBe(0);
  });

  it("missing path_prefix → uns:error", () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", {});
    expect(s.emitted[0].event).toBe("uns:error");
    expect(s.emitted[0].payload.code).toBe("bad_request");
  });
});

describe("G2.17 — snapshot-then-stream", () => {
  it("subscribe → snapshot of the prefix FIRST, then deltas on state-store updates", () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1"));
    setState("f2/x/l9/c9/m9", liveSnap("f2/x/l9/c9/m9")); // outside prefix

    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1" });

    // (a) snapshot first — only paths under the prefix
    expect(s.emitted[0].event).toBe("uns:snapshot");
    expect(s.emitted[0].payload.count).toBe(1);
    expect(s.emitted[0].payload.snapshots[0].path).toBe("f1/a/l1/c1/m1");
    expect(s.join).toHaveBeenCalledWith("uns:f1/a/l1");

    // (b) stream — a state-store write under the prefix arrives as a delta
    setState("f1/a/l1/c2/m2", liveSnap("f1/a/l1/c2/m2", "IDLE"));
    const deltas = s.emitted.filter((e) => e.event === "uns:delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].payload.aspect).toBe("state");
    expect(deltas[0].payload.snapshot.state).toBe("IDLE");
    // snapshot index strictly before delta index
    expect(s.emitted.findIndex((e) => e.event === "uns:snapshot")).toBeLessThan(
      s.emitted.findIndex((e) => e.event === "uns:delta"),
    );

    // outside-prefix writes are NOT delivered
    setState("f2/x/l9/c9/m9", liveSnap("f2/x/l9/c9/m9", "FAULTED"));
    expect(s.emitted.filter((e) => e.event === "uns:delta")).toHaveLength(1);
  });

  it("unsubscribe stops the stream", () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1" });
    s.trigger("uns:unsubscribe", { path_prefix: "f1/a/l1" });
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1"));
    expect(s.emitted.filter((e) => e.event === "uns:delta")).toHaveLength(0);
    expect(_unsStreamSubscriberCount()).toBe(0);
  });
});

describe("G2.17 — event aspect + min_severity filter", () => {
  it("bus events below min_severity are filtered server-side; matching ones stream", async () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1", aspects: ["events"], min_severity: "error" });

    // yellow andon = warning → filtered out
    eventBus.publish(EventTypes.ANDON, { id: 5, state: "yellow", reason: "quality", machineId: 1, status: "raised", title: "t" }, "test");
    await sleep(30);
    expect(s.emitted.filter((e) => e.event === "uns:delta")).toHaveLength(0);

    // red andon = critical → delivered
    eventBus.publish(EventTypes.ANDON, { id: 6, state: "red", reason: "quality", machineId: 1, status: "raised", title: "t" }, "test");
    await sleep(30);
    const deltas = s.emitted.filter((e) => e.event === "uns:delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].payload.aspect).toBe("events");
    expect(deltas[0].payload.event.severity).toBe("critical");
    expect(deltas[0].payload.event.type).toBe("andon:quality");
    expect(deltas[0].payload.path).toBe("f1/a/l1/c1/m1");
  });

  it("bus events WITHOUT a resolvable machineId are skipped (honest, never fabricated)", async () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1", aspects: ["events"] });
    eventBus.publish(EventTypes.ANDON, { id: 7, state: "red", reason: "safety", lineId: 3, status: "raised", title: "no machine" }, "test");
    await sleep(30);
    expect(s.emitted.filter((e) => e.event === "uns:delta")).toHaveLength(0);
  });

  it("state deltas are excluded when aspects=['events']", () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1", aspects: ["events"] });
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1"));
    expect(s.emitted.filter((e) => e.event === "uns:delta")).toHaveLength(0);
  });
});

describe("G2.17 — backpressure", () => {
  it("over the per-second budget deltas coalesce into ONE frame marked dropped:true", async () => {
    vi.stubEnv("WS_UNS_STREAM_ENABLED", "true");
    vi.stubEnv("WS_UNS_MAX_DELTAS_PER_SEC", "2");
    vi.stubEnv("WS_UNS_COALESCE_FLUSH_MS", "50");
    const s = makeSocket("s1");
    registerUnsStreamHandlers(s as never);
    s.trigger("uns:subscribe", { path_prefix: "f1/a/l1", aspects: ["state"] });
    s.emitted.length = 0; // drop the snapshot frame

    for (let i = 0; i < 5; i++) {
      fanoutDelta({
        aspect: "state",
        path: "f1/a/l1/c1/m1",
        ts: new Date().toISOString(),
        snapshot: liveSnap("f1/a/l1/c1/m1", `S${i}`),
      });
    }
    // 2 immediate singles within budget
    const immediate = s.emitted.filter((e) => e.event === "uns:delta" && !e.payload.coalesced);
    expect(immediate).toHaveLength(2);

    await sleep(120); // wait for the flush timer
    const coalesced = s.emitted.filter((e) => e.event === "uns:delta" && e.payload.coalesced);
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0].payload.dropped).toBe(true); // older same-path deltas were replaced — honest mark
    expect(coalesced[0].payload.deltas).toHaveLength(1); // latest-wins per path
    expect(coalesced[0].payload.deltas[0].snapshot.state).toBe("S4");
  });
});
