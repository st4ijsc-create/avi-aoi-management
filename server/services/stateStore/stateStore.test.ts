/**
 * W2-B1 (doc 44 G2.12) — state store tests: get/set roundtrip, prefix view,
 * LIVE-vs-fallback precedence, honest db-fallback rebuild (source stamped,
 * canonical state, values reduced), honest null when nothing maps, flag default.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── mocks (hoisted) ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  l2: new Map<string, unknown>(),
  machineRows: [] as unknown[],
  presenceRows: [] as unknown[],
  latestTelemetry: [] as Array<{ tagKey: string; valueNumeric: number | null; valueText: string | null; quality: string; timestamp: string; unit: string | null }>,
}));

vi.mock("../cacheService", () => ({
  cacheService: {
    getAsync: vi.fn(async (key: string) => h.l2.get(key) ?? null),
    setAsync: vi.fn(async (key: string, value: unknown) => {
      h.l2.set(key, value);
    }),
  },
}));

function chain(rows: unknown[]) {
  const p: any = Promise.resolve(rows);
  p.from = () => p;
  p.leftJoin = () => p;
  p.innerJoin = () => p;
  p.where = () => p;
  p.orderBy = () => p;
  p.limit = () => p;
  return p;
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (table: any) => {
        const key = (table && table.__mockName) || "";
        if (key === "machines") return chain(h.machineRows);
        if (key === "machineStatusLogs") return chain(h.presenceRows);
        return chain([]);
      },
    }),
  })),
}));

vi.mock("../../../drizzle/schema", () => ({
  machines: { __mockName: "machines", id: "id", operationStatus: "operationStatus", lastHeartbeat: "lastHeartbeat", isa95Path: "isa95Path", isActive: "isActive" },
  machineStatusLogs: { __mockName: "machineStatusLogs", machineId: "machineId", status: "status", timestamp: "timestamp" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => a,
  and: (...a: unknown[]) => a,
  desc: (x: unknown) => x,
  sql: Object.assign((s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }), { raw: (x: unknown) => x }),
}));

vi.mock("../../db/otTelemetry", () => ({
  getLatestTelemetry: vi.fn(async () => h.latestTelemetry),
}));

import {
  getState,
  setState,
  getByPrefix,
  onStateUpdate,
  stateStoreEnabled,
  normalizePath,
  _resetStateStoreForTests,
  type StateSnapshot,
} from "./stateStore";

function liveSnap(path: string, state = "EXECUTE"): StateSnapshot {
  return { path, ts: new Date().toISOString(), state, source: "live", machineId: 1 };
}

beforeEach(() => {
  _resetStateStoreForTests();
  h.l2.clear();
  h.machineRows = [];
  h.presenceRows = [];
  h.latestTelemetry = [];
  vi.unstubAllEnvs();
});

describe("G2.12 — flag & path normalization", () => {
  it("STATE_STORE_ENABLED defaults OFF", () => {
    expect(stateStoreEnabled()).toBe(false);
    vi.stubEnv("STATE_STORE_ENABLED", "true");
    expect(stateStoreEnabled()).toBe(true);
  });

  it("normalizePath trims slashes and rejects empty/oversized", () => {
    expect(normalizePath("/f1/assy/line1/")).toBe("f1/assy/line1");
    expect(normalizePath("")).toBeNull();
    expect(normalizePath("x".repeat(600))).toBeNull();
  });
});

describe("G2.12 — set/get/prefix", () => {
  it("setState → getState roundtrip (L1)", async () => {
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1"));
    const snap = await getState("f1/a/l1/c1/m1", { backfill: false });
    expect(snap?.state).toBe("EXECUTE");
    expect(snap?.source).toBe("live");
  });

  it("getByPrefix returns ONLY paths under the prefix, sorted", () => {
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1"));
    setState("f1/a/l1/c2/m2", liveSnap("f1/a/l1/c2/m2"));
    setState("f2/b/l9/c9/m9", liveSnap("f2/b/l9/c9/m9"));
    const snaps = getByPrefix("f1/a/l1");
    expect(snaps.map((s) => s.path)).toEqual(["f1/a/l1/c1/m1", "f1/a/l1/c2/m2"]);
    // prefix must match SEGMENTS — "f1/a/l" is not a segment prefix of anything
    expect(getByPrefix("f1/a/l")).toEqual([]);
  });

  it("a db-fallback snapshot never clobbers a fresher live one", async () => {
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1", "EXECUTE"));
    setState("f1/a/l1/c1/m1", { ...liveSnap("f1/a/l1/c1/m1", "STOPPED"), source: "db-fallback" });
    const snap = await getState("f1/a/l1/c1/m1", { backfill: false });
    expect(snap?.state).toBe("EXECUTE");
    expect(snap?.source).toBe("live");
  });

  it("onStateUpdate fires for every accepted setState", () => {
    const seen: string[] = [];
    const off = onStateUpdate((s) => seen.push(s.path));
    setState("f1/a/l1/c1/m1", liveSnap("f1/a/l1/c1/m1"));
    off();
    setState("f1/a/l1/c2/m2", liveSnap("f1/a/l1/c2/m2"));
    expect(seen).toEqual(["f1/a/l1/c1/m1"]);
  });

  it("L2 hit repopulates L1 (per-path read path via cache facade)", async () => {
    h.l2.set("uns:state:f9/a/l/c/m", liveSnap("f9/a/l/c/m", "IDLE"));
    const snap = await getState("f9/a/l/c/m", { backfill: false });
    expect(snap?.state).toBe("IDLE");
  });
});

describe("G2.12 — honest db-fallback", () => {
  it("miss → rebuilt from machines + latest telemetry + presence, stamped db-fallback", async () => {
    h.machineRows = [{ id: 7, operationStatus: "running", lastHeartbeat: null }];
    h.presenceRows = [{ status: "online" }];
    h.latestTelemetry = [
      { tagKey: "temp", valueNumeric: 41.5, valueText: null, quality: "good", timestamp: "2026-07-12T00:00:00.000Z", unit: "C" },
      { tagKey: "temp", valueNumeric: 40.0, valueText: null, quality: "good", timestamp: "2026-07-11T00:00:00.000Z", unit: "C" }, // older dup — deduped
    ];
    const snap = await getState("f1/assy/line1/cell3/screw01");
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe("db-fallback"); // HONEST provenance
    expect(snap!.state).toBe("EXECUTE"); // running → canonical EXECUTE
    expect(snap!.machineId).toBe(7);
    expect(snap!.health).toBe("online");
    expect(snap!.values).toEqual({ temp: { v: 41.5, unit: "C", q: "GOOD" } });
  });

  it("miss + no machine with that isa95_path → null (REST layer turns into 404)", async () => {
    h.machineRows = [];
    expect(await getState("nope/nope/nope/nope/nope")).toBeNull();
  });

  it("no presence record → health omitted (never fabricated)", async () => {
    h.machineRows = [{ id: 7, operationStatus: "stopped", lastHeartbeat: null }];
    h.presenceRows = [];
    const snap = await getState("f1/assy/line1/cell3/screw01");
    expect(snap!.health).toBeUndefined();
    expect(snap!.state).toBe("STOPPED");
  });
});
