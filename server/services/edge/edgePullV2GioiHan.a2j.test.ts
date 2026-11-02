/**
 * SCADA R1b-2b-2a A2(j) polish (AMENDMENT 1) — pullForNodeV2 runs its answer through THE assertion (giuTrongGioiHanTraLoi) even when a selector
 * upstream misbehaves: a claims selector that returns 250 claims (over the schema's 200, aborts LAST) must still yield an answer the edge accepts —
 * ≤ 200 claims, abort-carrying claims first, runStateUnavailable — never an over-limit answer (the edge would drop it whole, STOPs included).
 * Pure: the database is a chainable fake that answers [] to every read; protocol version / commands / config version are stubbed.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  // every query chain resolves to [] (no rows anywhere); the db object itself is not thenable
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => res([]) : chain),
    apply: () => chain,
  });
  const db: Record<string, unknown> = { select: () => chain, selectDistinct: () => chain, insert: () => chain, update: () => chain, execute: async () => [] };
  db.transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { ...real, getDb: async () => db };
});
vi.mock("./edgeCentralCommon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./edgeCentralCommon")>()),
  nodeProtocolVersion: async () => 2,
  centralSigner: () => null,
}));
vi.mock("./edgeNodeCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./edgeNodeCommands")>()),
  commandsForNode: async () => ({ signed: [], unsignedStops: [], incomplete: false }),
  noteEdgeNodePull: () => undefined,
}));
vi.mock("./edgeConfigCentral", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./edgeConfigCentral")>()),
  currentConfigVersion: async () => 1,
}));
vi.mock("../robot/criticalStopAlert", () => ({ raiseCriticalStopAlert: vi.fn(async () => undefined) }));
// THE selector bug: the claims selector returns 250 claims, aborts last, and says "fits"
vi.mock("./docHetTheoTrang", async (importOriginal) => {
  const real = await importOriginal<typeof import("./docHetTheoTrang")>();
  return {
    ...real,
    chonClaimsChoTraLoi: () => ({
      chon: [
        ...Array.from({ length: 240 }, (_, i) => ({ runId: i + 1, claimSeq: 1, status: "running" as const, abortRequested: false, stale: false })),
        ...Array.from({ length: 10 }, (_, i) => ({ runId: 900 + i, claimSeq: 1, status: "aborted" as const, abortRequested: true, stale: false })),
      ],
      vuot: false,
    }),
  };
});

import { pullForNodeV2 } from "./edgeExecutionCentral";
import { edgePullAnswerSchema, EDGE_PULL_CLAIMS_MAX } from "./edgeProtocol";

describe("A2(j) polish — pullForNodeV2 never returns an over-limit answer, even past a misbehaving selector", () => {
  it("★ 250 claims from the selector ⇒ the answer carries 200 (the 10 aborts first), runStateUnavailable, and passes the edge's answer schema", async () => {
    const logs: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    let ans: Awaited<ReturnType<typeof pullForNodeV2>>;
    try {
      ans = await pullForNodeV2({ credentialId: 1, nodeId: 5150, nodeCode: "N5150", factoryCode: null }, {});
    } finally {
      err.mockRestore();
    }
    expect(ans.http).toBe(200);
    const data = (ans as { data: { claims: Array<{ runId: number; abortRequested: boolean }>; runStateUnavailable?: true } }).data;
    expect(data.claims).toHaveLength(EDGE_PULL_CLAIMS_MAX);
    expect(data.claims.slice(0, 10).every((c) => c.abortRequested)).toBe(true);
    expect(data.runStateUnavailable).toBe(true);
    expect(edgePullAnswerSchema.safeParse(data).success).toBe(true);
    expect(logs.some((l) => l.includes("ASSERTION"))).toBe(true); // the backstop fired (the selector did not fit)
  });
});
