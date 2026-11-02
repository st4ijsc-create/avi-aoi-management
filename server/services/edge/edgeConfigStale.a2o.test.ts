/**
 * R1b-2b-2a A2(o) item 5 + AMENDMENT 1 — the edge's config is STALE once central announces a newer version (pull / heartbeat) and
 * stays stale until a refresh ADOPTS it; meanwhile every non-STOP write is refused (edgeNonStopConfigGate), STOPs still go.
 * Real EdgeConfigSource + EdgeExecutionAgent against the fake central (edgeFakeCentral.testkit — signs what central signs); the
 * OT front end with a fake driver.
 *   • noteCentralConfigVersion: newer ⇒ stale (since when); same / older ⇒ fresh; 0 (central could not build) ⇒ the mark is kept;
 *   • the agent's PULL marks it; a failed refresh keeps it; a successful refresh clears it (O7 wiring);
 *   • (c) central UNREACHABLE while stale ⇒ the non-STOP write is refused with the reason AND the config's age, the pinned STOP
 *     is still sent; central back + refreshed ⇒ the write goes;
 *   • the heartbeat and the device-runtime install are wired to the same source (source scan).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const H = vi.hoisted(() => ({
  driver: null as null | { writes: Array<Array<Record<string, unknown>>>; writeTags: (w: Array<Record<string, unknown>>) => Promise<unknown>; readTags: () => Promise<unknown[]> },
  fingerprint: undefined as string | undefined,
}));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    throw new Error("EDGE_DB_TRAP: getDb() on the edge");
  },
  isEdgeProcessRole: () => true,
}));
vi.mock("../ot/otManager", () => ({
  getActiveDriver: () => H.driver ?? undefined,
  getActiveConnectionFingerprint: () => H.fingerprint,
  listActiveAdapters: () => [],
  adapterSessionResetBoundMs: () => 1000,
  resetAdapterSession: async () => ({ reset: true, via: "test" }),
}));
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: new Date().toISOString() }) }),
}));

import { EdgeCentralClient, createEdgeAuthorizeClient } from "./edgeCentralClient";
import { EdgeConfigSource } from "./edgeConfigSource";
import { EdgeExecutionAgent, type EdgeAgentConfig, type EdgeDevicePort } from "./edgeExecutionAgent";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";
import { EdgeJournal } from "./edgeJournal";
import { EdgeProgramChecks, EdgeStreamShipper, createEdgeAuthUnusedReporter, createEdgeJournalConsume, createEdgeReportSink } from "./edgeStreams";
import { EDGE_TYP_NAME } from "./edgeSigning";
import { edgeCommandPayloadHash, type EdgeStepAuthorization } from "./edgeAuthorizationVerifier";
import type { EdgeDeviceRuntime, EdgeDispatchJournal } from "./edgeDeviceRuntime";
import { dispatchOtOnEdge } from "../ot/otEdgeDispatch";
import { _resetAdapterCommandQueuesForTests } from "../ot/otDeviceWrite";

const dirs: string[] = [];
const agents: EdgeExecutionAgent[] = [];
const journals: EdgeJournal[] = [];
let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  _resetAdapterCommandQueuesForTests();
  const writes: Array<Array<Record<string, unknown>>> = [];
  H.driver = {
    writes,
    writeTags: async (w) => {
      writes.push(w.map((x) => ({ ...x })));
      return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.OT_READBACK_ENABLED;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const a of agents.splice(0)) await a.stop();
  for (const j of journals.splice(0)) await j.close().catch(() => undefined);
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

async function source(central = new FakeCentral(), now?: () => number) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-a2o-"));
  dirs.push(dir);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl });
  const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir, ...(now ? { now } : {}) });
  expect(await config.refresh()).toMatchObject({ ok: true });
  return { central, client, config, dir };
}

async function agentOn(s: Awaited<ReturnType<typeof source>>) {
  const journal = await EdgeJournal.open({ dir: s.dir, groupCommitMs: 1 });
  journals.push(journal);
  const shipper = new EdgeStreamShipper(journal, s.client);
  const sink = createEdgeReportSink(journal, (x) => shipper.nudge(x));
  const programChecks = new EdgeProgramChecks({ config: s.config, client: s.client, read: async () => ({ status: "unsupported", source: "stub" }) });
  const authorize = createEdgeAuthorizeClient({
    client: s.client,
    trust: () => s.config.trust(),
    credentialId: () => s.config.credentialId(),
    maxTtlMs: () => 10_000,
    isJtiConsumed: (j) => journal.isJtiConsumed(j),
    programChecks: () => programChecks.latest(),
    anomaly: () => undefined,
    unused: createEdgeAuthUnusedReporter(journal, sink),
  });
  const devices: EdgeDevicePort = {
    stopRobot: async () => ({ outcome: "sent" }),
    stopAdapter: async () => ({ outcome: "sent" }),
    lockRobot: async () => ({ ok: true, generation: 1 }),
    clearRobot: async () => ({ ok: true as const, generation: 1 }),
  };
  const cfg: EdgeAgentConfig = { centralUrl: "http://central.test", credential: KIT_TOKEN, pullIntervalMs: 60_000, progressMs: 60_000, maxConcurrent: 1, requestTimeoutMs: 2_000, stopResendMinMs: 10_000, claimRuns: false };
  const agent = new EdgeExecutionAgent(cfg, { client: s.client, config: s.config, journal, shipper, sink, consume: createEdgeJournalConsume(journal), authorize, programChecks, walker: null, devices, hashDefinition: kitHashDefinition });
  agents.push(agent);
  return agent;
}

describe("A2(o) item 5 — EdgeConfigSource staleness", () => {
  it("★ newer announced ⇒ stale (versions, since when, the config's issuedAt); 0 keeps the mark; the same version ⇒ fresh", async () => {
    const T = Date.now();
    let now = T;
    const s = await source(new FakeCentral(), () => now);
    expect(s.config.version()).toBe(1);
    expect(s.config.staleness()).toBeNull();
    s.config.noteCentralConfigVersion(2);
    expect(s.config.staleness()).toEqual({ centralVersion: 2, localVersion: 1, sinceMs: T, configIssuedAt: s.config.current()!.issuedAt });
    now += 5_000;
    s.config.noteCentralConfigVersion(3); // newer again: the FIRST sighting is kept
    s.config.noteCentralConfigVersion(0); // central could not build its config: says nothing
    s.config.noteCentralConfigVersion("7" as never);
    expect(s.config.staleness()).toMatchObject({ centralVersion: 3, sinceMs: T });
    s.config.noteCentralConfigVersion(1); // central now serves what we hold
    expect(s.config.staleness()).toBeNull();
  });

  it("★ a refresh that ADOPTS the announced version clears it; a failed one keeps it", async () => {
    const s = await source();
    s.central.setConfig({}); // v2 at central
    s.config.noteCentralConfigVersion(2);
    s.central.handlers.config = () => "network";
    expect(await s.config.refresh()).toMatchObject({ ok: false });
    expect(s.config.staleness()).toMatchObject({ centralVersion: 2, localVersion: 1 });
    delete s.central.handlers.config;
    expect(await s.config.refresh()).toMatchObject({ ok: true, version: 2 });
    expect(s.config.staleness()).toBeNull();
  });

  it("requestRefresh: single-flight, at most one per second, never throws", async () => {
    let now = Date.now();
    const s = await source(new FakeCentral(), () => now);
    const before = s.central.callsTo("config").length;
    s.config.requestRefresh();
    s.config.requestRefresh();
    await new Promise((r) => setTimeout(r, 20));
    s.config.requestRefresh(); // < 1 s later
    expect(s.central.callsTo("config").length - before).toBe(1);
    now += 1_001;
    s.config.requestRefresh();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.central.callsTo("config").length - before).toBe(2);
  });
});

describe("A2(o) O7 wiring — the agent's PULL marks the config stale; only an adopted refresh clears it", () => {
  it("★ pull announces v2, its refresh fails ⇒ stale; the next pull refreshes ⇒ fresh", async () => {
    const s = await source();
    const agent = await agentOn(s);
    s.central.setConfig({});
    s.central.handlers.config = () => "network";
    await agent.tick();
    expect(s.config.staleness()).toMatchObject({ centralVersion: 2, localVersion: 1 });
    delete s.central.handlers.config;
    await agent.tick();
    expect(s.config.version()).toBe(2);
    expect(s.config.staleness()).toBeNull();
  });
});

describe("A2(o) AMENDMENT 1 (c) — central UNREACHABLE while the config is marked stale", () => {
  function journal(): EdgeDispatchJournal & { consumed: string[]; events: any[] } {
    const j = {
      consumed: [] as string[],
      events: [] as any[],
      async consumeAuthorization(c: { jti: string }) {
        if (j.consumed.includes(c.jti)) return { ok: false as const, reason: "jti_consumed" };
        j.consumed.push(c.jti);
        return { ok: true as const };
      },
      isJtiConsumed: (jti: string) => j.consumed.includes(jti),
      admitNonStop: () => true,
      async appendRun() {
        return { seq: 1, durable: true };
      },
      async appendEvent(rec: unknown) {
        j.events.push(rec);
        return { seq: j.events.length, durable: true };
      },
    };
    return j;
  }
  const NONCE = "n0nce_BBBBBBBBBBBBBBBBBB";
  const START = { adapterId: 21, machineId: 5, commandType: "start", writes: [{ tagKey: "run", value: true }] };
  const run = { runId: 9, claimSeq: 2, stepId: "w1", attempt: 1 };
  function auth(central: FakeCentral, jti: string): EdgeStepAuthorization {
    const claims = {
      typ: EDGE_TYP_NAME.auth, kid: central.key.kid, jti, nodeId: central.nodeId, credentialId: central.credentialId, runId: 9, claimSeq: 2, stepId: "w1", attempt: 1,
      idempotencyKey: "foe:9:w1:1", kind: "ot", target: { adapterId: 21, writes: [{ tagKey: "run", address: "coil:1", dataType: "bool", scale: null, offset: null }] },
      payloadHash: edgeCommandPayloadHash({ kind: "ot", ...START }), approval: { approvedBy: 4, gateStepId: "g" }, mode: "real",
      verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: Date.now(), ttlMs: 10_000,
    };
    return { envelope: central.sign("auth", claims), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
  }
  function runtimeOn(config: EdgeConfigSource, j: EdgeDispatchJournal): EdgeDeviceRuntime {
    // exactly the gateway's wiring (edgeGatewayRuntime.installDeviceRuntime)
    return {
      nodeId: 7,
      config: () => config.current(),
      journal: j,
      configStale: () => config.staleness(),
      requestConfigRefresh: () => config.requestRefresh(),
      auth: () => ({ trust: config.trust(), credentialId: config.credentialId(), maxTtlMs: 10_000, pendingNonce: (n: string) => (n === NONCE ? { sentMonoMs: 1_000 } : null), nowMonoMs: () => 1_500 }),
      otControlEnabled: () => true,
    };
  }

  it("★ (c) stale + central down ⇒ the non-STOP write is refused naming WHY and the config's AGE (anomaly too), the pinned STOP is still SENT; central back + refreshed ⇒ the write goes", async () => {
    const s = await source();
    const agent = await agentOn(s);
    H.fingerprint = s.config.current()!.adapters[0].connectionFingerprint;
    s.central.setConfig({}); // central has v2
    s.central.handlers.config = () => "network";
    await agent.tick(); // the pull announces v2; the refresh fails ⇒ stale
    s.central.down = true; // and now central is unreachable altogether
    await agent.tick();
    const st = s.config.staleness();
    expect(st).toMatchObject({ centralVersion: 2, localVersion: 1 });

    const j = journal();
    const r = await dispatchOtOnEdge({ ...START, idempotencyKey: "foe:9:w1:1", authorization: auth(s.central, "1b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81"), run }, runtimeOn(s.config, j));
    await new Promise((x) => setTimeout(x, 30));
    expect(r).toMatchObject({ ok: false, status: "rejected", reason: "CONFIG_STALE" });
    expect(r.detail).toMatch(/central announced config v2 [0-9]+ s ago; this edge still holds v1 \(issued [0-9]+ s ago\)/);
    expect(r.detail).toContain("STOPs still go");
    expect(j.events).toMatchObject([{ kind: "anomaly", code: "EDGE_CONFIG_STALE", runId: 9 }]);
    expect(j.events[0].detail).toContain("adapter 21");
    expect(j.consumed).toHaveLength(0);
    expect(H.driver!.writes).toHaveLength(0);
    expect(s.config.staleness()).not.toBeNull(); // the requested refresh could not reach central: still stale

    const stop = await dispatchOtOnEdge({ adapterId: 21, machineId: 5, commandType: "stop", writes: [{ tagKey: "run", value: false }], idempotencyKey: "stop-1", source: "local" }, runtimeOn(s.config, j));
    expect(stop).toMatchObject({ ok: true, stop: true, pinnedStop: true });
    expect(H.driver!.writes).toEqual([[expect.objectContaining({ tagKey: "run", value: false })]]);

    // central back: the next pull refreshes (adopts v2) ⇒ not stale ⇒ the write goes
    s.central.down = false;
    delete s.central.handlers.config;
    await agent.tick();
    expect(s.config.staleness()).toBeNull();
    const ok = await dispatchOtOnEdge({ ...START, idempotencyKey: "foe:9:w1:1", authorization: auth(s.central, "2b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a82"), run }, runtimeOn(s.config, j));
    expect(ok).toMatchObject({ ok: true, status: "acked" });
    expect(H.driver!.writes).toHaveLength(2);
  });
});

describe("A2(o) wiring — the heartbeat and the device runtime use the SAME source (source scan)", () => {
  const src = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
  it("edgeExecutionAgent pull + edgeGatewayRuntime heartbeat note central's configVersion; installDeviceRuntime passes staleness + refresh", () => {
    const agent = src("edgeExecutionAgent.ts");
    expect(agent).toMatch(/const p = pulled\.data;[\s\S]{0,400}this\.deps\.config\.noteCentralConfigVersion\?\.\(p\.configVersion\)/);
    const gw = src("edgeGatewayRuntime.ts");
    expect(gw).toMatch(/if \(r\.ok\) \{\s*rt\.config\.noteCentralConfigVersion\?\.\(r\.data\.configVersion\)/);
    expect(gw).toContain("configStale: () => rt.config.staleness(),");
    expect(gw).toContain("requestConfigRefresh: () => rt.config.requestRefresh(),");
  });
});

describe("A2(o) AMENDMENT 2 — a stale-config authorisation is journaled + reported NEVER used (reason config_stale)", () => {
  it("★ createEdgeAuthUnusedReporter: the jti is consumed-as-unused first (never usable again), then an auth_unused record central accepts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-a2o-j-"));
    dirs.push(dir);
    const journal = await EdgeJournal.open({ dir, groupCommitMs: 1 });
    journals.push(journal);
    const recs: unknown[] = [];
    const sink = { run: async (_r: number, _c: number, rec: unknown) => (recs.push(rec), { seq: recs.length, durable: true }) } as never;
    // central advertised auth_unused.config_stale (A2(o) r3/r4: else the journaled wire reason is the baseline — edgeAuthUnusedCompat.a2o)
    const report = createEdgeAuthUnusedReporter(journal, sink, { centralAccepts: (t) => t === "auth_unused.config_stale" });
    const jti = "3b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a83";
    expect(await report({ runId: 9, claimSeq: 2, jti, stepId: "r2", attempt: 1, reason: "config_stale" })).toBe(true);
    expect(journal.isJtiConsumed(jti)).toBe(true);
    expect(await journal.consumeAuthorization({ jti, runId: 9, claimSeq: 2, stepId: "r2", attempt: 1 })).toMatchObject({ ok: false });
    const { edgeRunReportRecordSchema } = await import("./edgeProtocol");
    expect(edgeRunReportRecordSchema.safeParse({ ...(recs[0] as object), seq: 1 }).success).toBe(true);
    expect(recs[0]).toMatchObject({ kind: "auth_unused", jti, stepId: "r2", attempt: 1, reason: "config_stale" });
    // a jti already consumed (used) is never reported unused
    expect(await report({ runId: 9, claimSeq: 2, jti, stepId: "r2", attempt: 1, reason: "config_stale" })).toBe(false);
  });
});
