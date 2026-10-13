/**
 * doc 81 Đợt 10 final fix wave — the EDGE AGENT against a FAKE CENTRAL (edgeFakeCentral.testkit), rulings R-10-br:
 *   • I-2 — the pull interval is central's SIGNED limits.pullMs (verified config), falling back to 2 s; EDGE_PULL_INTERVAL_MS
 *     (default 2 s) can only make it FASTER; the commands-only gateway agent is not hard-coded to 5 s any more;
 *   • M-4 — EDGE_CENTRAL_URL over plain http:// is refused unless the host is loopback or EDGE_ALLOW_INSECURE_CENTRAL=1 (loud);
 *   • M-8 — a STOP deferred by the fast path (its target needs a config refresh) runs in the SAME pull even while an older work
 *     phase is still busy (it used to wait for the next pull);
 *   • I-1 (edge half) — a `partial` pull answer: nothing is inferred from what it omits (the STOP re-send back-off of a run
 *     missing from a partial `stopsUnconfirmed` is kept, not reset).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeCentralClient, createEdgeAuthorizeClient } from "./edgeCentralClient";
import { EdgeConfigSource } from "./edgeConfigSource";
import { EdgeExecutionAgent, edgeCentralUrlFromEnv, edgeExecutionConfigFromEnv, type EdgeAgentConfig, type EdgeDevicePort } from "./edgeExecutionAgent";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";
import { EdgeJournal } from "./edgeJournal";
import { EdgeProgramChecks, EdgeStreamShipper, createEdgeAuthUnusedReporter, createEdgeJournalConsume, createEdgeReportSink } from "./edgeStreams";

const dirs: string[] = [];
const agents: EdgeExecutionAgent[] = [];
const journals: EdgeJournal[] = [];
let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(async () => {
  vi.useRealTimers();
  for (const a of agents.splice(0)) await a.stop();
  for (const j of journals.splice(0)) await j.close().catch(() => undefined);
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
  vi.restoreAllMocks();
});

async function harness(o: { pullIntervalMs?: number; limitsPullMs?: number } = {}) {
  const central = new FakeCentral();
  if (o.limitsPullMs !== undefined) {
    const base = central.makeConfig();
    central.setConfig({ limits: { ...base.limits, pullMs: o.limitsPullMs } });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-agent-ff-"));
  dirs.push(dir);
  const journal = await EdgeJournal.open({ dir, groupCommitMs: 1 });
  journals.push(journal);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl });
  const config = await EdgeConfigSource.create({ client, pin: central.pin, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir });
  expect(await config.refresh()).toMatchObject({ ok: true });
  const shipper = new EdgeStreamShipper(journal, client);
  const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
  const programChecks = new EdgeProgramChecks({ config, client, read: async () => ({ status: "unsupported", source: "stub" }) });
  const authorize = createEdgeAuthorizeClient({
    client,
    trust: () => config.trust(),
    credentialId: () => config.credentialId(),
    maxTtlMs: () => 10_000,
    isJtiConsumed: (j) => journal.isJtiConsumed(j),
    programChecks: () => programChecks.latest(),
    anomaly: () => undefined,
    unused: createEdgeAuthUnusedReporter(journal, sink),
  });
  const calls: string[] = [];
  const devices: EdgeDevicePort = {
    stopRobot: async (id) => (calls.push(`stopRobot:${id}`), { outcome: "sent" }),
    stopAdapter: async (id) => (calls.push(`stopAdapter:${id}`), { outcome: "sent" }),
    lockRobot: async (id) => (calls.push(`lock:${id}`), { ok: true, generation: 4 }),
    clearRobot: async () => ({ ok: false as const, reason: "error" as const, generation: null }),
  };
  const cfg: EdgeAgentConfig = { centralUrl: "http://central.test", credential: KIT_TOKEN, pullIntervalMs: o.pullIntervalMs ?? 60_000, progressMs: 60_000, maxConcurrent: 2, requestTimeoutMs: 2_000, stopResendMinMs: 10_000, claimRuns: false };
  const agent = new EdgeExecutionAgent(cfg, { client, config, journal, shipper, sink, consume: createEdgeJournalConsume(journal), authorize, programChecks, walker: null, devices, hashDefinition: kitHashDefinition });
  agents.push(agent);
  return { central, config, agent, calls };
}

describe("final fix wave I-2 — the pull interval", () => {
  it("★ default env: the agent's upper bound is 2 s (was 5 s); EDGE_PULL_INTERVAL_MS still parsed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-cred-ff-"));
    dirs.push(dir);
    const file = path.join(dir, "node.cred");
    await fs.writeFile(file, `edn_0123456789ab.${"S".repeat(43)}\n`, { mode: 0o600 });
    const good = { EDGE_EXECUTION_ENABLED: "true", FOE_ENABLED: "true", EDGE_RUNTIME_ENABLED: "true", EDGE_CENTRAL_URL: "https://c.example", EDGE_NODE_CREDENTIAL_FILE: file };
    const host = { platform: "linux" as const, stat: async () => ({ mode: 0o100600, isFile: () => true }) };
    const d = await edgeExecutionConfigFromEnv(good as never, host);
    expect((d as EdgeAgentConfig).pullIntervalMs).toBe(2_000);
    const x = await edgeExecutionConfigFromEnv({ ...good, EDGE_PULL_INTERVAL_MS: "700" } as never, host);
    expect((x as EdgeAgentConfig).pullIntervalMs).toBe(700);
  });

  it("★ the timer follows central's SIGNED limits.pullMs (1 s here) — the env bound only makes it faster", async () => {
    const h = await harness({ pullIntervalMs: 60_000, limitsPullMs: 1_000 });
    expect(h.agent.pullIntervalNowMs()).toBe(1_000);
    const fast = await harness({ pullIntervalMs: 300, limitsPullMs: 1_000 });
    expect(fast.agent.pullIntervalNowMs()).toBe(300);
    const slowCentral = await harness({ pullIntervalMs: 2_000, limitsPullMs: 10_000 });
    expect(slowCentral.agent.pullIntervalNowMs()).toBe(2_000);
    // measured on the running timer (fake clock): ~6 pulls in 5.5 s at 1 s, not 1
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const before = h.central.callsTo("pull").length;
    h.agent.start();
    for (let i = 0; i < 11; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
    const pulls = h.central.callsTo("pull").length - before;
    expect(pulls).toBeGreaterThanOrEqual(5);
    expect(pulls).toBeLessThanOrEqual(7);
  });

  it("★ the commands-only gateway agent is not hard-coded to a 5 s pull", () => {
    const rt = readFileSync(path.join(process.cwd(), "server/services/edge/edgeGatewayRuntime.ts"), "utf8");
    expect(rt).not.toMatch(/pullIntervalMs:\s*5_000/);
    expect(rt).toMatch(/pullIntervalMs:\s*agentMod\.edgePullIntervalBoundFromEnv\(\)/);
  });
});

describe("final fix wave M-4 — EDGE_CENTRAL_URL over plain http", () => {
  it("★ http:// to a non-loopback host is refused; loopback, https and the explicit lab flag are accepted (the flag loudly)", () => {
    expect(edgeCentralUrlFromEnv({ EDGE_CENTRAL_URL: "http://central.example:3000" } as never)).toEqual({ error: expect.stringMatching(/https/) });
    expect(edgeCentralUrlFromEnv({ EDGE_CENTRAL_URL: "http://10.1.2.3:3000" } as never)).toHaveProperty("error");
    for (const ok of ["https://central.example:3000", "http://127.0.0.1:3016", "http://localhost:3016", "http://[::1]:3016"]) {
      expect(edgeCentralUrlFromEnv({ EDGE_CENTRAL_URL: ok } as never), ok).toHaveProperty("url");
    }
    logs = [];
    expect(edgeCentralUrlFromEnv({ EDGE_CENTRAL_URL: "http://central.example:3000", EDGE_ALLOW_INSECURE_CENTRAL: "1" } as never)).toEqual({ url: "http://central.example:3000" });
    expect(logs.join("\n")).toMatch(/INSECURE/);
  });
});

describe("final fix wave M-8 — deferred STOPs run in the same pull even while a work phase is busy", () => {
  it("★ an older work phase hangs (claim); the next pull's STOP for a robot of the INCOMING config is executed in that pull", async () => {
    const h = await harness();
    // make the agent claim-capable for one run whose claim HANGS ⇒ the first work phase stays busy
    (h.agent as unknown as { cfg: EdgeAgentConfig }).cfg.claimRuns = true;
    (h.agent as unknown as { deps: { walker: unknown } }).deps.walker = { drive: async () => ({ outcome: "completed" }), abortLive: async () => ({ live: false }) };
    h.central.addRun(9);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.central.handlers.claim = async () => {
      await gate;
      return { status: 409, code: "claim_conflict" };
    };
    const tickA = h.agent.tick();
    await vi.waitFor(() => expect(h.central.callsTo("claim")).toHaveLength(1), { timeout: 2_000, interval: 5 });
    // robot 13 is assigned now; the next pull carries its STOP (fast path defers it: target unknown until the refresh)
    const base = h.central.makeConfig();
    h.central.setConfig({ robots: [...base.robots, { ...base.robots[0], id: 13, code: "rb-13" }] });
    h.central.runs = [];
    h.central.commands = [h.central.sign("cmd", h.central.commandPayload({ requestId: 300, kind: "stop", target: { robotId: 13 } }))];
    const rB = await h.agent.tick();
    expect(rB.commands.filter((c) => c.requestId === 300).map((c) => c.outcome)).toEqual(["pending:not_yet_known", "sent"]);
    expect(h.calls).toContain("stopRobot:13");
    release();
    await tickA;
  });
});

describe("final fix wave I-1 (edge half) — a partial pull answer", () => {
  it("★ a run missing from a PARTIAL stopsUnconfirmed keeps its re-send back-off (nothing is inferred from an omission)", async () => {
    let now = 5_000_000;
    const h = await harness();
    (h.agent as unknown as { cfg: { now: () => number } }).cfg.now = () => now;
    const listed = [{ runId: 41, picture: h.central.sign("runpkg", h.central.sweepPicture(41)) }];
    const kit = h.central as unknown as { defaults: (route: string, body: unknown, runId?: number) => { status: number; data: Record<string, unknown> } };
    h.central.stopsUnconfirmed = listed;
    expect((await h.agent.tick()).stopsResent).toEqual([41]);
    // a PARTIAL answer leaves run 41 out (its picture could not be built this time)
    h.central.stopsUnconfirmed = [];
    h.central.handlers.pull = (b) => {
      const a = kit.defaults("pull", b);
      return { status: 200, data: { ...a.data, partial: true } };
    };
    now += 1_000;
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    delete h.central.handlers.pull;
    h.central.stopsUnconfirmed = listed;
    now += 1_000; // still inside the 10 s back-off of the first re-send
    expect((await h.agent.tick()).stopsResent).toEqual([]);
    expect((h.agent as unknown as { resentAt: Map<number, unknown> }).resentAt.has(41)).toBe(true);
  });
});
