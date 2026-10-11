/**
 * doc 81 Đợt 9 task S3 — the EDGE AGENT's own decisions, with a scripted central (fake fetch) and the engine / DB replaced:
 *   • it never claims a run whose snapshot, local workflow row or local binding digest differ from what central handed out;
 *   • offline (network error / 401) ⇒ nothing is claimed;
 *   • an `abortRequested` answer (or the run guard reading 'stopped' while central cannot be reached) ⇒ the local walker is
 *     aborted ONCE through the engine;
 *   • a claim it cannot execute is released; a stale claim with no walker here is declared interrupted (and a fresh one is not);
 *   • the segment end is reported, and retried until central takes it; the credential never appears in a log line.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  wfHash: "a".repeat(64),
  localDigest: "d".repeat(64) as string | null,
  drive: vi.fn(),
  stopLive: vi.fn(),
  resend: vi.fn(),
  guard: vi.fn(),
  runStatus: "running",
}));

vi.mock("../orchestration/foe/foeGateApproval", () => ({
  hashWorkflowDefinition: (def: { tag?: string }) => (def?.tag === "other" ? "b".repeat(64) : def?.tag === "local" ? h.wfHash : "a".repeat(64)),
  computeBindingDigest: async () => h.localDigest,
}));
vi.mock("../orchestration/foe/foeEngine", () => ({ driveEdgeClaimedRun: h.drive, stopLiveRunForCentralAbort: h.stopLive, resendStopsOfAbortedRun: h.resend }));
vi.mock("./edgeRunGuard", () => ({ readEdgeRunGuard: h.guard }));
vi.mock("../../db/connection", () => ({
  getDb: async () => ({
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => {
            const name = String((t as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "");
            if (name === "orchestration_runs") return [{ status: h.runStatus }];
            return [{ id: 7, definitionJson: { tag: "local" } }];
          },
        }),
      }),
    }),
  }),
}));

import { EdgeExecutionAgent, edgeExecutionConfigFromEnv } from "./edgeExecutionAgent";

const TOKEN = `edn_0123456789ab.${"S".repeat(43)}`;
type Call = { path: string; body: any };

function central(script: (path: string, body: any) => { status: number; body: any } | "network") {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const path = url.replace(/^.*\/api\/v1/, "");
    const body = JSON.parse(init.body);
    calls.push({ path, body });
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const r = script(path, body);
    if (r === "network") throw new TypeError("fetch failed");
    return { ok: r.status < 300, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const ok = (data: unknown) => ({ status: 200, body: { ok: true, data } });
const err = (status: number, code: string, details?: unknown) => ({ status, body: { ok: false, error: { code, message: code, details } } });
const pulledRun = (over: Record<string, unknown> = {}) => ({
  runId: 11,
  workflowId: 7,
  workflowVersion: 1,
  defHash: "a".repeat(64),
  claimSeq: 0,
  definition: { tag: "pulled" },
  bindingDigest: "d".repeat(64),
  ...over,
});
function agent(fetchImpl: typeof fetch) {
  return new EdgeExecutionAgent({ centralUrl: "http://central.test", credential: TOKEN, pullIntervalMs: 60_000, progressMs: 20, maxConcurrent: 4, requestTimeoutMs: 1000, stopResendMinMs: 60_000, fetchImpl });
}

beforeEach(() => {
  h.localDigest = "d".repeat(64);
  h.runStatus = "running";
  h.drive.mockReset();
  h.stopLive.mockReset();
  h.resend.mockReset();
  h.resend.mockResolvedValue({ ok: true, enabled: true, abortStops: { sent: ["s1"], failed: [] } });
  h.guard.mockReset();
  h.stopLive.mockResolvedValue({ live: true });
  h.guard.mockResolvedValue("ok");
});

describe("doc 81 Đợt 9 S3 — the edge agent", () => {
  it("★ config: anything missing ⇒ it does not start (fail-closed); the secret comes ONLY from a file that others cannot read", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(os.tmpdir(), "s9-cred-"));
    try {
      const file = path.join(dir, "node.cred");
      writeFileSync(file, `${TOKEN}\n`, { mode: 0o600 });
      const bad = path.join(dir, "bad.cred");
      writeFileSync(bad, "ak_live_123\n", { mode: 0o600 });
      const good = { EDGE_EXECUTION_ENABLED: "true", FOE_ENABLED: "true", EDGE_RUNTIME_ENABLED: "true", EDGE_CENTRAL_URL: "https://c.example", EDGE_NODE_CREDENTIAL_FILE: file };
      const posix600 = { platform: "linux" as const, stat: async () => ({ mode: 0o100600, isFile: () => true }) };
      const ok = await edgeExecutionConfigFromEnv(good as never, posix600);
      expect("error" in ok ? ok.error : (ok as { credential: string }).credential).toBe(TOKEN);
      for (const k of Object.keys(good)) {
        const env = { ...good, [k]: "" };
        expect("error" in (await edgeExecutionConfigFromEnv(env as never, posix600)), k).toBe(true);
      }
      expect("error" in (await edgeExecutionConfigFromEnv({ ...good, EDGE_NODE_CREDENTIAL_FILE: bad } as never, posix600))).toBe(true);
      expect("error" in (await edgeExecutionConfigFromEnv({ ...good, EDGE_CENTRAL_URL: "ftp://x" } as never, posix600))).toBe(true);
      // the secret in an env var is refused even with a valid file
      expect(await edgeExecutionConfigFromEnv({ ...good, EDGE_NODE_CREDENTIAL: TOKEN } as never, posix600)).toEqual({ error: expect.stringMatching(/not accepted/) });
      // POSIX: group / world bits ⇒ refused
      for (const mode of [0o100644, 0o100640, 0o100604, 0o100660]) {
        const r = await edgeExecutionConfigFromEnv(good as never, { platform: "linux", stat: async () => ({ mode, isFile: () => true }) });
        expect(r, mode.toString(8)).toEqual({ error: expect.stringMatching(/group \/ others/) });
      }
      // Windows: no POSIX mode — accepted with a warning naming the ACL to set
      const warns: string[] = [];
      const w = await edgeExecutionConfigFromEnv(good as never, { platform: "win32", stat: async () => ({ mode: 0o100666, isFile: () => true }), warn: (m) => warns.push(m) });
      expect("error" in w).toBe(false);
      expect(warns.join(" ")).toMatch(/icacls/);
      expect(warns.join(" ")).not.toContain(TOKEN.split(".")[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("★ offline (network error / 401): nothing is claimed", async () => {
    for (const answer of ["network", err(401, "unauthorized")] as const) {
      const c = central(() => answer as never);
      const r = await agent(c.fetchImpl).tick();
      expect(r.online).toBe(false);
      expect(c.calls.map((x) => x.path)).toEqual(["/edge/node/pull"]);
    }
    expect(h.drive).not.toHaveBeenCalled();
  });

  it.each([
    ["the snapshot does not hash to its defHash", { definition: { tag: "other" } }],
    ["central refused it", { refused: "definitionChanged", definition: undefined }],
    ["its binding digest differs from this edge's", { bindingDigest: "e".repeat(64) }],
    ["central's binding digest is null", { bindingDigest: null }],
  ])("★ never claims when %s", async (_label, over) => {
    const c = central((p) => (p === "/edge/node/pull" ? ok({ runs: [pulledRun(over)], claims: [] }) : err(500, "x")));
    const r = await agent(c.fetchImpl).tick();
    expect(r.skipped.map((s) => s.runId)).toEqual([11]);
    expect(c.calls.some((x) => x.path.endsWith("/claim"))).toBe(false);
  });

  it("★ never claims when ITS OWN digest is unreadable, or its DB holds another definition under that workflow id (ID mapping)", async () => {
    h.localDigest = null;
    const c1 = central((p) => (p === "/edge/node/pull" ? ok({ runs: [pulledRun()], claims: [] }) : err(500, "x")));
    expect((await agent(c1.fetchImpl).tick()).claimed).toEqual([]);
    h.localDigest = "d".repeat(64);
    h.wfHash = "c".repeat(64); // the local row hashes differently from the assignment's defHash
    try {
      const c2 = central((p) => (p === "/edge/node/pull" ? ok({ runs: [pulledRun({ defHash: "a".repeat(64) })], claims: [] }) : err(500, "x")));
      const r = await agent(c2.fetchImpl).tick();
      expect(r.claimed).toEqual([]);
      expect(r.skipped[0].why).toMatch(/ID mapping/);
    } finally {
      h.wfHash = "a".repeat(64);
    }
  });

  it("★ claims, walks, reports progress, and an abortRequested answer aborts the local walker ONCE; the segment end is reported", async () => {
    let release!: () => void;
    h.drive.mockImplementation(() => new Promise((r) => (release = () => r({ ok: false, status: "aborted" }))));
    let progress = 0;
    const c = central((p, body) => {
      if (p === "/edge/node/pull") return ok({ runs: [pulledRun()], claims: [] });
      if (p.endsWith("/claim")) return ok({ runId: 11, claimSeq: 1, claimToken: `ect_${"T".repeat(43)}` });
      if (p.endsWith("/progress")) return ok({ abortRequested: ++progress >= 2, status: "running", consistent: true });
      if (p.endsWith("/complete")) return ok({ abortRequested: true, status: body.status });
      return err(500, "x");
    });
    const a = agent(c.fetchImpl);
    expect((await a.tick()).claimed).toEqual([11]);
    for (let i = 0; i < 100 && h.drive.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.drive).toHaveBeenCalledWith(11, { claimSeq: 1, claimTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), defHash: "a".repeat(64) });
    for (let i = 0; i < 100 && h.stopLive.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 80)); // more abortRequested answers arrive — applied once
    expect(h.stopLive).toHaveBeenCalledTimes(1);
    expect(h.stopLive.mock.calls[0][0]).toBe(11);
    release();
    await a.idle();
    const seqs = c.calls.filter((x) => x.path.endsWith("/progress") || x.path.endsWith("/complete")).map((x) => x.body.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y)); // strictly increasing
    expect(new Set(seqs).size).toBe(seqs.length);
    const done = c.calls.find((x) => x.path.endsWith("/complete"))!;
    expect(done.body).toMatchObject({ claimSeq: 1, claimToken: `ect_${"T".repeat(43)}`, status: "aborted" });
  });

  it("★ central unreachable mid-walk: the run guard reading 'stopped' aborts the walker (the row tells even offline)", async () => {
    let release!: () => void;
    h.drive.mockImplementation(() => new Promise((r) => (release = () => r({ ok: false, status: "aborted" }))));
    h.guard.mockResolvedValue("stopped");
    let online = true;
    const c = central((p) => {
      if (!online) return "network";
      if (p === "/edge/node/pull") return ok({ runs: [pulledRun()], claims: [] });
      if (p.endsWith("/claim")) return ok({ runId: 11, claimSeq: 1, claimToken: `ect_${"T".repeat(43)}` });
      return err(500, "x");
    });
    const a = agent(c.fetchImpl);
    await a.tick();
    online = false;
    for (let i = 0; i < 100 && h.stopLive.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.stopLive).toHaveBeenCalledTimes(1);
    release();
    await a.idle();
  });

  it("★ a claim it cannot execute is RELEASED (never walked); the segment end is retried until central takes it", async () => {
    h.drive.mockResolvedValue({ ok: false, refused: "the run has no active owner on this edge" });
    const c = central((p) => {
      if (p === "/edge/node/pull") return ok({ runs: [pulledRun()], claims: [] });
      if (p.endsWith("/claim")) return ok({ runId: 11, claimSeq: 1, claimToken: `ect_${"T".repeat(43)}` });
      if (p.endsWith("/release")) return ok({ status: "held" });
      return err(500, "x");
    });
    const a = agent(c.fetchImpl);
    await a.tick();
    await a.idle();
    const rel = c.calls.find((x) => x.path.endsWith("/release"));
    expect(rel?.body).toMatchObject({ claimSeq: 1, reason: "the run has no active owner on this edge" });
    expect(c.calls.some((x) => x.path.endsWith("/complete"))).toBe(false);

    // completion lost (central 503) ⇒ kept, re-sent on the next tick with a larger seq
    h.drive.mockResolvedValue({ ok: true, status: "completed" });
    let fail = true;
    const c2 = central((p) => {
      if (p === "/edge/node/pull") return ok({ runs: c2.calls.some((x) => x.path.endsWith("/claim")) ? [] : [pulledRun({ runId: 12 })], claims: [] });
      if (p.endsWith("/claim")) return ok({ runId: 12, claimSeq: 1, claimToken: `ect_${"U".repeat(43)}` });
      if (p.endsWith("/complete")) return fail ? err(503, "edge_unavailable") : ok({ abortRequested: false, status: "completed" });
      return ok({ abortRequested: false });
    });
    const b = agent(c2.fetchImpl);
    await b.tick();
    await b.idle();
    fail = false;
    await b.tick();
    const completes = c2.calls.filter((x) => x.path.endsWith("/complete"));
    expect(completes.length).toBe(2);
    expect(completes[1].body.seq).toBeGreaterThan(completes[0].body.seq);
    await b.tick();
    expect(c2.calls.filter((x) => x.path.endsWith("/complete")).length).toBe(2); // taken: not sent again
  });

  it("★ a STALE claim with no walker here is declared interrupted; a fresh one is left alone; an aborted claim with a walker is aborted", async () => {
    const c = central((p) => {
      if (p === "/edge/node/pull")
        return ok({ runs: [], claims: [{ runId: 21, claimSeq: 3, abortRequested: false, stale: true }, { runId: 22, claimSeq: 1, abortRequested: false, stale: false }] });
      if (p.endsWith("/interrupted")) return ok({ status: "held" });
      return err(500, "x");
    });
    const r = await agent(c.fetchImpl).tick();
    expect(r.interrupted).toEqual([21]);
    expect(c.calls.filter((x) => x.path.endsWith("/interrupted")).map((x) => [x.path, x.body])).toEqual([["/edge/node/runs/21/interrupted", { claimSeq: 3 }]]);
  });

  it("★ L-7: a run central aborted after its segment here, with a STOP central could not confirm, has its STOPs re-sent from this node — at most once per interval", async () => {
    const c = central((p) => (p === "/edge/node/pull" ? ok({ runs: [], claims: [], stopsUnconfirmed: [31] }) : err(500, "x")));
    const a = agent(c.fetchImpl);
    expect((await a.tick()).stopsResent).toEqual([31]);
    expect(h.resend).toHaveBeenCalledTimes(1);
    expect(h.resend.mock.calls[0][0]).toBe(31);
    expect((await a.tick()).stopsResent).toEqual([]); // within EDGE_STOP_RESEND_MIN_MS: not again
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it("★ the credential never appears in what the agent logs", async () => {
    const logs: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.join(" "))));
    try {
      const c = central(() => "network");
      await agent(c.fetchImpl).tick();
      const c2 = central((p) => (p === "/edge/node/pull" ? ok({ runs: [pulledRun({ bindingDigest: null })], claims: [] }) : err(401, "unauthorized")));
      await agent(c2.fetchImpl).tick();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(TOKEN.split(".")[1]);
  });
});
