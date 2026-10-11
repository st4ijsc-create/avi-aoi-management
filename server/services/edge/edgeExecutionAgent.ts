/**
 * doc 81 Đợt 9 task S3 (owner decision 2026-10-12, "edge workflow execution — do it fully") — the EDGE half: the agent the
 * edge gateway runs (server/edge/edgeGatewayMain.ts → edgeGatewayRuntime, flag EDGE_EXECUTION_ENABLED, default OFF).
 *
 * Every EDGE_PULL_INTERVAL_MS it asks central (`POST /api/v1/edge/node/pull`, its OWN node credential) for the runs assigned to
 * it, and for each one:
 *   1. checks locally that the snapshot central handed out is the one it will execute: the snapshot's hash = the assignment's
 *      defHash = the hash of the workflow row in ITS database under the same id (ID mapping — an edge whose DB is not the
 *      central DB, or a different workflow under that id, never claims), and reads ITS binding digest of that definition (its
 *      own drivers read the controllers' program checksums) — unreadable ⇒ not claimed. Final wave F2: read only here (right
 *      before the claim), never on every pull; a refused run is retried with a bounded exponential back-off;
 *   2. claims it with that digest (central's compare-and-set; central reads ITS digest fresh at the claim and refuses a
 *      mismatch; a claim token only this walker holds);
 *   3. walks THE CENTRAL RUN through the shared engine (foeEngine.driveEdgeClaimedRun): the SAME gates as central (approval
 *      with the Group R identity rule, binding digest, program checksum, R-4-x, STOP exemptions) through the edge's own
 *      dispatchers; before every NON-STOP command the engine asks the run guard (edgeRunGuard: claim current, credential
 *      active, central has not stopped the run — read from the run row, so it holds even when HTTP is down);
 *   4. reports progress every EDGE_ABORT_POLL_MS (claim-bound, strictly increasing sequence) — an answer with
 *      `abortRequested`, or a run guard reading 'stopped' when central cannot be reached, aborts the LOCAL walker through the
 *      shared engine: its non-STOP steps stop at once, its remaining STOP steps and due STOP compensations are still SENT
 *      (Đợt 6 sweep), a STOP already on its way finishes. A run is never moved out of 'aborted' (the engine's writes are
 *      conditional) — never resurrected;
 *   5. reports the segment's end (`complete`; retried until central takes it). A claim it cannot execute is `release`d.
 *
 * OFFLINE (central unreachable): no pull ⇒ NO new run is started (nothing is claimed without central). A run already walking
 * goes on, its non-STOP steps still gated by the run guard: a central abort written to the run row stops them even offline;
 * once the abort is known, only STOP steps and STOP compensations go out. Limits (said in docs/EDGE_GATEWAY.md):
 *   • if the DATABASE is unreachable too, the guard cannot decide ⇒ every further non-STOP command is refused (the run fails
 *     and compensates; its STOPs still go) — the edge cannot act on a run it cannot read;
 *   • a central abort that only lives in central's memory (never written) cannot reach the edge — central's abort always
 *     writes the row first, so this is the DB-unreachable case above;
 *   • the agent restarting mid-walk loses the walker: the claim goes stale and is declared interrupted (→ 'held', a person
 *     may Continue) — the run is never re-walked silently.
 * The credential is never logged; HTTP errors are logged by status code only.
 */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { EDGE_NODE_TOKEN_RE } from "./edgeNodeCredentials";

export interface EdgeAgentConfig {
  centralUrl: string;
  credential: string;
  pullIntervalMs: number;
  progressMs: number;
  maxConcurrent: number;
  requestTimeoutMs: number;
  /** minimum time between two STOP re-sends of one aborted run (default 10 s) */
  stopResendMinMs: number;
  /**
   * doc 81 Đợt 9 final wave F2 — upper bound of the per-run claim back-off (default 120 s): a run this edge could not claim (its
   * local checks refused it, or central refused the claim) is retried after pullInterval × 2^failures, capped here — never a
   * full device-configuration read (S7 block info) on every pull.
   */
  claimBackoffMaxMs?: number;
  fetchImpl?: typeof fetch;
  /** test seam — the clock of the claim back-off */
  now?: () => number;
}

const clampInt = (raw: string | undefined, dflt: number, min: number, max: number) => {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/**
 * The agent's configuration from the environment, or why it cannot start (it then starts NOTHING — fail-closed).
 * doc 81 Đợt 9 S fix (security scan "secret-exposure") — the node credential is read ONLY from a FILE
 * (EDGE_NODE_CREDENTIAL_FILE — a compose file-based secret, docs/EDGE_GATEWAY.md §8.2), never from an env var, a label or a log.
 * On POSIX the file must not be readable / writable by group or others (mode & 0o077 === 0) — otherwise the gateway REFUSES to
 * start execution. Windows has no POSIX mode: a warning tells the operator to restrict it with an ACL (icacls).
 */
export async function edgeExecutionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  host: { platform?: NodeJS.Platform; stat?: (p: string) => Promise<{ mode: number; isFile(): boolean }>; warn?: (msg: string) => void } = {},
): Promise<EdgeAgentConfig | { error: string }> {
  if (env.EDGE_EXECUTION_ENABLED !== "true" && env.EDGE_EXECUTION_ENABLED !== "1") return { error: "EDGE_EXECUTION_ENABLED is off" };
  if (env.FOE_ENABLED !== "true" && env.FOE_ENABLED !== "1") return { error: "FOE_ENABLED is off on this edge (the engine is needed to execute runs)" };
  if (env.EDGE_RUNTIME_ENABLED !== "true" && env.EDGE_RUNTIME_ENABLED !== "1") return { error: "EDGE_RUNTIME_ENABLED is off" };
  let url: URL;
  try {
    url = new URL(String(env.EDGE_CENTRAL_URL ?? ""));
  } catch {
    return { error: "EDGE_CENTRAL_URL is not a URL (e.g. https://central.example:3000)" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "EDGE_CENTRAL_URL must be http(s)" };
  if (env.EDGE_NODE_CREDENTIAL) return { error: "EDGE_NODE_CREDENTIAL (a secret in an environment variable) is not accepted — use EDGE_NODE_CREDENTIAL_FILE" };
  const file = String(env.EDGE_NODE_CREDENTIAL_FILE ?? "").trim();
  if (!file) return { error: "EDGE_NODE_CREDENTIAL_FILE is not set" };
  const platform = host.platform ?? process.platform;
  let credential = "";
  try {
    const st = await (host.stat ?? fs.stat)(file);
    if (!st.isFile()) return { error: "EDGE_NODE_CREDENTIAL_FILE is not a file" };
    if (platform !== "win32") {
      if ((st.mode & 0o077) !== 0) {
        return { error: `EDGE_NODE_CREDENTIAL_FILE is readable or writable by group / others (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it` };
      }
    } else {
      (host.warn ?? ((m: string) => console.warn(m)))(
        "[EdgeExec] Windows: the node credential file's permissions cannot be checked here — restrict it to the gateway's account (icacls <file> /inheritance:r /grant:r <account>:R)",
      );
    }
    credential = (await fs.readFile(file, "utf8")).trim();
  } catch {
    return { error: "EDGE_NODE_CREDENTIAL_FILE cannot be read" };
  }
  if (!EDGE_NODE_TOKEN_RE.test(credential)) return { error: "EDGE_NODE_CREDENTIAL_FILE holds no valid node credential" };
  return {
    centralUrl: url.toString().replace(/\/+$/, ""),
    credential,
    pullIntervalMs: clampInt(env.EDGE_PULL_INTERVAL_MS, 5000, 200, 300_000),
    progressMs: clampInt(env.EDGE_ABORT_POLL_MS, 2000, 50, 60_000),
    maxConcurrent: clampInt(env.EDGE_MAX_CONCURRENT_RUNS, 4, 1, 32),
    requestTimeoutMs: clampInt(env.EDGE_REQUEST_TIMEOUT_MS, 10_000, 500, 60_000),
    stopResendMinMs: clampInt(env.EDGE_STOP_RESEND_MIN_MS, 10_000, 200, 600_000),
    claimBackoffMaxMs: clampInt(env.EDGE_CLAIM_BACKOFF_MAX_MS, 120_000, 1_000, 3_600_000),
  };
}

/** The principal an edge-side abort is recorded under (never a person). */
export const EDGE_AGENT_ABORT_USER = { id: 0, role: "system", name: "edge: central abort" } as const;

type Http = { ok: true; status: number; data: any } | { ok: false; status: number; code: string | null; data?: any };

interface Segment {
  runId: number;
  claimSeq: number;
  token: string;
  tokenHash: string;
  seq: number;
  aborted: boolean;
  done: Promise<void>;
}
interface PendingComplete {
  runId: number;
  claimSeq: number;
  token: string;
  status: string;
}

export interface TickReport {
  online: boolean;
  claimed: number[];
  /** aborted runs whose unconfirmed STOPs this node re-sent (L-7) */
  stopsResent: number[];
  skipped: Array<{ runId: number; why: string }>;
  interrupted: number[];
  aborted: number[];
}

export class EdgeExecutionAgent {
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<TickReport> | null = null;
  private readonly segments = new Map<number, Segment>();
  private readonly pending = new Map<number, PendingComplete>();
  private online: boolean | null = null;
  private readonly warned = new Map<number, string>();
  /** run id → when this agent last re-sent its unconfirmed STOPs (bounded retry of a STOP central could not confirm). */
  private readonly resentAt = new Map<number, number>();
  /** doc 81 Đợt 9 final wave F2 — run id → claim back-off after a refused local check / claim (failures, next attempt time). */
  private readonly claimBackoff = new Map<number, { failures: number; nextAt: number }>();

  constructor(private readonly cfg: EdgeAgentConfig) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.cfg.pullIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    void this.tick().catch(() => undefined);
  }

  /** Stops pulling. Walkers already running finish their segment (their runs are not aborted by a shutdown). */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ticking) await this.ticking.catch(() => undefined);
  }

  /** Runs walking on this agent now (central run ids). */
  liveRunIds(): number[] {
    return [...this.segments.keys()];
  }

  /** Resolves once every walker started so far has finished its segment and reported (tests / shutdown). */
  async idle(): Promise<void> {
    while (this.segments.size > 0) await Promise.allSettled([...this.segments.values()].map((s) => s.done));
  }

  private async post(path: string, body: unknown): Promise<Http> {
    const f = this.cfg.fetchImpl ?? fetch;
    try {
      const res = await f(`${this.cfg.centralUrl}/api/v1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.credential}` },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (res.ok && json?.ok === true) return { ok: true, status: res.status, data: json.data };
      return { ok: false, status: res.status, code: json?.error?.code ?? null, data: json?.error?.details };
    } catch {
      return { ok: false, status: 0, code: null }; // network / timeout — never the credential in a log line
    }
  }

  private warnOnce(runId: number, why: string): void {
    if (this.warned.get(runId) === why) return;
    this.warned.set(runId, why);
    console.warn(`[EdgeExec] run ${runId}: ${why}`);
  }

  /** One pull + work cycle. Overlapping calls share the cycle in flight. */
  tick(): Promise<TickReport> {
    if (this.ticking) return this.ticking;
    this.ticking = this.tickOnce().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async tickOnce(): Promise<TickReport> {
    const report: TickReport = { online: false, claimed: [], stopsResent: [], skipped: [], interrupted: [], aborted: [] };
    const pulled = await this.post("/edge/node/pull", {});
    if (!pulled.ok) {
      if (this.online !== false) {
        console.warn(`[EdgeExec] central not reachable / refused the node (HTTP ${pulled.status || "network"}): no new run is started; runs already walking go on, gated by the run guard`);
      }
      this.online = false;
      return report;
    }
    if (this.online !== true) console.log("[EdgeExec] central reachable — pulling assigned runs");
    this.online = true;
    report.online = true;
    // 1) segment ends central has not taken yet
    for (const p of [...this.pending.values()]) await this.sendComplete(p);
    // 2) the node's current claims: abort live walkers central stopped; declare interrupted the ones with no walker here
    for (const c of (pulled.data?.claims ?? []) as Array<{ runId: number; claimSeq: number; abortRequested: boolean; stale: boolean }>) {
      const seg = this.segments.get(c.runId);
      if (seg) {
        if (c.abortRequested && (await this.applyAbort(seg))) report.aborted.push(c.runId);
        continue;
      }
      if (this.pending.has(c.runId)) continue;
      if (c.stale) {
        const r = await this.post(`/edge/node/runs/${c.runId}/interrupted`, { claimSeq: c.claimSeq });
        if (r.ok) report.interrupted.push(c.runId);
      }
    }
    // 2b) L-7 — runs central aborted after their last segment here, with a STOP central could not confirm: re-sent from HERE
    //     (no walker of them is left, so no signal could reach one). At most once per EDGE_STOP_RESEND_MIN_MS per run.
    for (const runId of (pulled.data?.stopsUnconfirmed ?? []) as number[]) {
      if (this.segments.has(runId)) continue;
      const last = this.resentAt.get(runId);
      if (last !== undefined && Date.now() - last < this.cfg.stopResendMinMs) continue;
      this.resentAt.set(runId, Date.now());
      try {
        const { resendStopsOfAbortedRun } = await import("../orchestration/foe/foeEngine");
        const r = await resendStopsOfAbortedRun(runId, { ...EDGE_AGENT_ABORT_USER });
        report.stopsResent.push(runId);
        console.warn(`[EdgeExec] run ${runId}: aborted centrally after its segment here — STOPs not confirmed by central re-sent from this node (sent ${r.abortStops?.sent.length ?? 0}, failed ${r.abortStops?.failed.length ?? 0})`);
      } catch (err) {
        console.error(`[EdgeExec] run ${runId}: STOP re-send failed — ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
      }
    }
    // 3) claimable runs
    // doc 81 Đợt 9 final wave F2 (final review I2) — the device configuration (binding digest: program checksums, an S7 block-info
    // read per controller) is read ONLY when this edge is about to claim, and a run it could not claim is retried with a bounded
    // exponential back-off (never every pull). Central holds a run nobody claims within EDGE_UNCLAIMED_HOLD_MS ("edge
    // unreachable", visible) — so it leaves the pull and the polling ends.
    const pulledRuns = (pulled.data?.runs ?? []) as Array<Record<string, any>>;
    const listed = new Set(pulledRuns.map((r) => Number(r.runId)));
    for (const id of [...this.claimBackoff.keys()]) if (!listed.has(id)) this.claimBackoff.delete(id);
    const now = this.cfg.now ?? Date.now;
    for (const r of pulledRuns) {
      if (this.segments.size >= this.cfg.maxConcurrent) break;
      const runId = Number(r.runId);
      if (this.segments.has(runId)) continue;
      const back = this.claimBackoff.get(runId);
      if (back && now() < back.nextAt) {
        report.skipped.push({ runId, why: `backing off after ${back.failures} refused attempt(s)` });
        continue;
      }
      const checked = await this.localCheck(r);
      if ("why" in checked) {
        report.skipped.push({ runId, why: checked.why });
        this.warnOnce(runId, `not claimed — ${checked.why}`);
        this.backOff(runId);
        continue;
      }
      // the edge's OWN digest, read now; central reads its own fresh at the claim and compares (no digest travels in the pull)
      const claimed = await this.post(`/edge/node/runs/${runId}/claim`, { claimSeq: r.claimSeq, defHash: r.defHash, bindingDigest: checked.digest });
      if (!claimed.ok) {
        report.skipped.push({ runId, why: `claim refused (${claimed.code ?? claimed.status})` });
        this.backOff(runId);
        continue;
      }
      this.claimBackoff.delete(runId);
      this.warned.delete(runId);
      report.claimed.push(runId);
      this.startSegment(runId, Number(claimed.data.claimSeq), String(claimed.data.claimToken), String(r.defHash));
    }
    return report;
  }

  /** doc 81 Đợt 9 final wave F2 — the next attempt of a refused run: pullInterval × 2^failures, capped (bounded back-off). */
  private backOff(runId: number): void {
    const now = (this.cfg.now ?? Date.now)();
    const failures = (this.claimBackoff.get(runId)?.failures ?? 0) + 1;
    const cap = this.cfg.claimBackoffMaxMs ?? 120_000;
    const delay = Math.min(cap, this.cfg.pullIntervalMs * 2 ** Math.min(failures, 20));
    this.claimBackoff.set(runId, { failures, nextAt: now + delay });
  }

  /** `{ digest }` ⇔ this edge may claim the pulled run (see header, step 1) — its OWN binding digest, read now; else `{ why }`. */
  private async localCheck(r: Record<string, any>): Promise<{ digest: string } | { why: string }> {
    const why = (w: string) => ({ why: w });
    if (r.refused) return why(`central refused it (${r.refused})`);
    if (!r.definition || typeof r.defHash !== "string") return why("no definition snapshot");
    try {
      const [{ hashWorkflowDefinition, computeBindingDigest }, { getDb }, { orchestrationWorkflows }, { eq }] = await Promise.all([
        import("../orchestration/foe/foeGateApproval"),
        import("../../db/connection"),
        import("../../../drizzle/schema"),
        import("drizzle-orm"),
      ]);
      if (hashWorkflowDefinition(r.definition) !== r.defHash) return why("the snapshot does not hash to its defHash");
      const d = await getDb();
      if (!d) return why("this edge's database is not reachable");
      const [wf] = await d.select({ id: orchestrationWorkflows.id, definitionJson: orchestrationWorkflows.definitionJson }).from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, Number(r.workflowId))).limit(1);
      if (!wf || hashWorkflowDefinition(wf.definitionJson as never) !== r.defHash) return why(`workflow ${r.workflowId} in this edge's database is not the assigned snapshot (ID mapping)`);
      const digest = await computeBindingDigest(d, r.definition);
      if (digest === null) return why("this edge's view of the device configuration cannot be read");
      return { digest };
    } catch {
      return why("local check failed");
    }
  }

  private startSegment(runId: number, claimSeq: number, token: string, defHash: string): void {
    const seg: Segment = { runId, claimSeq, token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex"), seq: 0, aborted: false, done: Promise.resolve() };
    this.segments.set(runId, seg);
    seg.done = this.runSegment(seg, defHash).finally(() => {
      if (this.segments.get(runId) === seg) this.segments.delete(runId);
    });
  }

  private async runSegment(seg: Segment, defHash: string): Promise<void> {
    const engine = await import("../orchestration/foe/foeEngine");
    const stopWatch = this.watch(seg);
    let status = "failed";
    try {
      const out = await engine.driveEdgeClaimedRun(seg.runId, { claimSeq: seg.claimSeq, claimTokenHash: seg.tokenHash, defHash });
      if (out.refused) {
        await stopWatch();
        const r = await this.post(`/edge/node/runs/${seg.runId}/release`, { claimSeq: seg.claimSeq, claimToken: seg.token, seq: ++seg.seq, reason: out.refused });
        if (!r.ok) console.error(`[EdgeExec] run ${seg.runId}: not executed here (${out.refused}); release not confirmed (HTTP ${r.status || "network"}) — it will be declared interrupted once stale`);
        return;
      }
      status = out.status ?? "failed";
    } catch (err) {
      console.error(`[EdgeExec] run ${seg.runId}: walker error — ${(err as Error)?.message ?? err}`);
    } finally {
      await stopWatch();
    }
    await this.sendComplete({ runId: seg.runId, claimSeq: seg.claimSeq, token: seg.token, status }, seg);
  }

  /** Progress every progressMs; abortRequested (or the run guard reading 'stopped' while central is unreachable) ⇒ local abort. */
  private watch(seg: Segment): () => Promise<void> {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<void> | null = null;
    const tick = async () => {
      if (stopped) return;
      const r = await this.post(`/edge/node/runs/${seg.runId}/progress`, { claimSeq: seg.claimSeq, claimToken: seg.token, seq: ++seg.seq, status: await this.localStatus(seg.runId) });
      if (stopped) return;
      if (r.ok ? r.data?.abortRequested === true : r.code === "claim_stale" && r.data?.abortRequested === true) {
        await this.applyAbort(seg);
      } else if (!r.ok) {
        // central unreachable / refusing this node (revoked ⇒ 401, 5xx): the run row still tells (the shared DB) — the walk is
        // never left blind to an abort written there
        const { readEdgeRunGuard } = await import("./edgeRunGuard");
        if ((await readEdgeRunGuard(seg.runId, { claimSeq: seg.claimSeq, claimTokenHash: seg.tokenHash })) === "stopped") await this.applyAbort(seg);
      }
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        inFlight = tick()
          .catch(() => undefined)
          .finally(() => {
            inFlight = null;
            schedule();
          });
      }, this.cfg.progressMs);
      if (typeof timer.unref === "function") timer.unref();
    };
    schedule();
    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    };
  }

  private async localStatus(runId: number): Promise<string | null> {
    try {
      const [{ getDb }, { orchestrationRuns }, { eq }] = await Promise.all([import("../../db/connection"), import("../../../drizzle/schema"), import("drizzle-orm")]);
      const d = await getDb();
      if (!d) return null;
      const [row] = await d.select({ status: orchestrationRuns.status }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
      return row?.status ?? null;
    } catch {
      return null;
    }
  }

  /** Abort the LOCAL walker once (non-STOP steps stop; STOPs still sent). true ⇔ applied now. */
  private async applyAbort(seg: Segment): Promise<boolean> {
    if (seg.aborted) return false;
    seg.aborted = true;
    try {
      const { stopLiveRunForCentralAbort } = await import("../orchestration/foe/foeEngine");
      const r = await stopLiveRunForCentralAbort(seg.runId, { ...EDGE_AGENT_ABORT_USER });
      console.warn(`[EdgeExec] run ${seg.runId}: central stopped it — local walker ${r.live ? "aborted (non-STOP steps stopped, STOPs sent)" : "already finished"}`);
      return true;
    } catch (err) {
      seg.aborted = false; // the next answer retries
      console.error(`[EdgeExec] run ${seg.runId}: local abort failed — ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
      return false;
    }
  }

  private async sendComplete(p: PendingComplete, seg?: Segment): Promise<void> {
    const seq = seg ? ++seg.seq : Date.now(); // a retried completion uses a fresh, larger sequence
    const r = await this.post(`/edge/node/runs/${p.runId}/complete`, { claimSeq: p.claimSeq, claimToken: p.token, seq, status: p.status });
    if (r.ok || (r.status >= 400 && r.status < 500 && r.code !== "not_finished")) {
      this.pending.delete(p.runId); // taken — or the claim is gone (stale / not found): nothing left to report
      return;
    }
    this.pending.set(p.runId, p);
  }
}

let agent: EdgeExecutionAgent | null = null;

/** Start the agent from the environment (edge gateway boot). Refuses (starts nothing) on any missing piece. */
export async function startEdgeExecutionFromEnv(): Promise<EdgeExecutionAgent | null> {
  if (agent) return agent;
  const cfg = await edgeExecutionConfigFromEnv();
  if ("error" in cfg) {
    console.log(`[EdgeExec] run execution NOT started: ${cfg.error}`);
    return null;
  }
  agent = new EdgeExecutionAgent(cfg);
  agent.start();
  console.log(`[EdgeExec] run execution started (pull every ${cfg.pullIntervalMs} ms, progress every ${cfg.progressMs} ms, at most ${cfg.maxConcurrent} runs)`);
  return agent;
}

export async function stopEdgeExecution(): Promise<void> {
  const a = agent;
  agent = null;
  if (a) await a.stop();
}
