/**
 * doc 81 Đợt 10 task E (design §2.3, §2.8–2.10, §2.14) — the EDGE half of run execution, protocol v2: the edge holds NO
 * central DB login. Every EDGE_PULL_INTERVAL_MS it asks central (`POST /api/v1/edge/node/pull`, its node credential):
 *
 *   1. COMMANDS (signed `typ cmd`, verified with the node's own trust store): `stop` is sent to the owned device at once — even
 *      when its signature does not verify (L-7: the failure is an anomaly, the STOP still goes), when central sent it UNSIGNED
 *      because its signer is unavailable (R-10-k: acknowledged), and when it is overdue (never discarded for its age; one
 *      execution per (requestId, target)); `lock` needs a valid signature;
 *      `clear` raises energy ⇒ valid signature, not expired, the owner epoch of the config and a generation match
 *      (compare-and-clear). Every command is acknowledged on the `events` stream.
 *   2. CLAIMS: `abortRequested` aborts the local walker (non-STOP steps stop, STOPs still sent); a stale claim with no walker
 *      here is declared interrupted (→ held; a restart forgets every claim token by design).
 *   3. STOPS UNCONFIRMED: a run central aborted after its segment here, whose STOPs central could not confirm, comes with a
 *      SIGNED sweep picture; its verified STOPs not yet confirmed are re-sent from HERE (at most once per EDGE_STOP_RESEND_MIN_MS).
 *      An unverifiable picture still yields STOPs — robot aborts and OT stops with the pins of the VERIFIED config, never pins
 *      from the unverified message.
 *   4. RUNS: claim (CAS + token) with this node's latest program checks ⇒ a SIGNED run package, verified (node, run, claim,
 *      defHash = hash of the shipped definition) ⇒ `driveEdgeRunFromPackage` (group C) with the edge store's IO: the report
 *      sink (journal → central), single-use consumption, the per-step authorize client. Nothing is claimed without a verified
 *      config, a walker, room in the journal (a full journal admits no new non-STOP work) or below maxConcurrent.
 *   5. PROGRESS every EDGE_ABORT_POLL_MS (claim-bound sequence) — `abortRequested` ⇒ local abort, `commands` handled as in 1.
 *   6. SEGMENT END: the run stream is shipped first, then `complete {outcome, epoch, reportedThrough}` (retried until central
 *      takes it). A claim it cannot execute is released.
 *
 * REMOVED (design §1b): the local check of the workflow row (ID mapping), the local binding digest, the local run status and
 * the run-guard fallback — the edge reads no DB. OFFLINE: no pull ⇒ nothing claimed; a walking run's next non-STOP step cannot
 * be authorised ⇒ HELD (D5), its STOPs still go. The credential is never logged.
 */
import { promises as fs } from "node:fs";
import type { EdgeAuthorizeClient, EdgeCentralClient, EdgeVerifiedCommand } from "./edgeCentralClient";
import { edgeTrustAdapter, verifyCommands, verifyRunPackage } from "./edgeCentralClient";
import type { EdgeConfigSource } from "./edgeConfigSource";
import type { EdgeJournal } from "./edgeJournal";
import { EDGE_NODE_TOKEN_RE } from "./edgeNodeCredentials";
import {
  EDGE_HELD_REASONS,
  edgeRunStream,
  edgeSweepPictureSchema,
  type EdgeCommand,
  type EdgeHeldReason,
  type EdgePullAnswer,
  type EdgeProgramCheck,
  type EdgeRunPackage,
  type EdgeSweepPicture,
  type EdgeVerifiedStop,
} from "./edgeProtocol";
import { parseEdgeCanonicalJson, type EdgeTrustStore } from "./edgeSigning";
import type { EdgeJournalConsume, EdgeProgramChecks, EdgeReportSink, EdgeStreamShipper } from "./edgeStreams";

// ── configuration ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeAgentConfig {
  centralUrl: string;
  credential: string;
  pullIntervalMs: number;
  progressMs: number;
  maxConcurrent: number;
  requestTimeoutMs: number;
  /** minimum time between two STOP re-sends of one aborted run (default 10 s) */
  stopResendMinMs: number;
  /** upper bound of the per-run claim back-off (default 120 s) */
  claimBackoffMaxMs?: number;
  fetchImpl?: typeof fetch;
  /** test seam — the clock of the back-off / re-send intervals */
  now?: () => number;
  /**
   * false ⇒ COMMANDS-ONLY (EDGE_EXECUTION_ENABLED off): the agent still pulls, so a central STOP / lock / clear of an
   * edge-owned device and the STOP re-sends reach this node — but it never claims a run.
   */
  claimRuns?: boolean;
}

const clampInt = (raw: string | undefined, dflt: number, min: number, max: number) => {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/**
 * The node credential, read ONLY from a FILE (EDGE_NODE_CREDENTIAL_FILE — a compose file-based secret), never from an env
 * var, a label or a log. POSIX: the file must not be readable / writable by group or others. Windows: a warning (icacls).
 */
export async function readEdgeNodeCredential(
  env: NodeJS.ProcessEnv = process.env,
  host: { platform?: NodeJS.Platform; stat?: (p: string) => Promise<{ mode: number; isFile(): boolean }>; warn?: (msg: string) => void } = {},
): Promise<{ credential: string } | { error: string }> {
  if (env.EDGE_NODE_CREDENTIAL) return { error: "EDGE_NODE_CREDENTIAL (a secret in an environment variable) is not accepted — use EDGE_NODE_CREDENTIAL_FILE" };
  const file = String(env.EDGE_NODE_CREDENTIAL_FILE ?? "").trim();
  if (!file) return { error: "EDGE_NODE_CREDENTIAL_FILE is not set" };
  const platform = host.platform ?? process.platform;
  let credential = "";
  try {
    const st = await (host.stat ?? fs.stat)(file);
    if (!st.isFile()) return { error: "EDGE_NODE_CREDENTIAL_FILE is not a file" };
    if (platform !== "win32") {
      if ((st.mode & 0o077) !== 0) return { error: `EDGE_NODE_CREDENTIAL_FILE is readable or writable by group / others (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it` };
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
  return { credential };
}

/** EDGE_CENTRAL_URL as an http(s) URL without a trailing slash, or why not. */
export function edgeCentralUrlFromEnv(env: NodeJS.ProcessEnv = process.env): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(String(env.EDGE_CENTRAL_URL ?? ""));
  } catch {
    return { error: "EDGE_CENTRAL_URL is not a URL (e.g. https://central.example:3000)" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "EDGE_CENTRAL_URL must be http(s)" };
  return { url: url.toString().replace(/\/+$/, "") };
}

/** The agent's configuration from the environment, or why it cannot start (it then starts NOTHING — fail-closed). */
export async function edgeExecutionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  host: { platform?: NodeJS.Platform; stat?: (p: string) => Promise<{ mode: number; isFile(): boolean }>; warn?: (msg: string) => void } = {},
): Promise<EdgeAgentConfig | { error: string }> {
  if (env.EDGE_EXECUTION_ENABLED !== "true" && env.EDGE_EXECUTION_ENABLED !== "1") return { error: "EDGE_EXECUTION_ENABLED is off" };
  if (env.FOE_ENABLED !== "true" && env.FOE_ENABLED !== "1") return { error: "FOE_ENABLED is off on this edge (the engine is needed to execute runs)" };
  if (env.EDGE_RUNTIME_ENABLED !== "true" && env.EDGE_RUNTIME_ENABLED !== "1") return { error: "EDGE_RUNTIME_ENABLED is off" };
  const u = edgeCentralUrlFromEnv(env);
  if ("error" in u) return u;
  const c = await readEdgeNodeCredential(env, host);
  if ("error" in c) return c;
  return {
    centralUrl: u.url,
    credential: c.credential,
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

// ── the ports this agent drives (implemented by groups C and D; fakes in tests) ─────────────────────────────────────

/** Everything the edge run store (group C, edge/edgeRunStore.ts) needs for ONE claimed segment. */
export interface EdgeRunIo {
  runId: number;
  claimSeq: number;
  claimToken: string;
  /** journal-backed reports of this run stream + events */
  sink: EdgeReportSink;
  /** single use of authorisations (fsynced before the driver call), admission of new non-STOP work */
  consume: EdgeJournalConsume;
  /** per non-STOP command step (design §2.5) */
  authorize: EdgeAuthorizeClient;
  trust: () => EdgeTrustStore;
  config: EdgeConfigSource;
  programChecks: () => EdgeProgramCheck[];
  /** aborted when central says abortRequested (or the agent stops the run): the walker sweeps locally */
  signal: AbortSignal;
}

/** The segment outcome a walker returns (maps 1:1 onto POST complete). */
export type EdgeSegmentOutcome =
  | { outcome: "completed" }
  | { outcome: "failed"; error?: string }
  | { outcome: "aborted"; error?: string }
  | { outcome: "paused"; gateStepId: string }
  | { outcome: "held"; heldReason: EdgeHeldReason; error?: string }
  /** the package cannot be executed here: the claim is released, nothing was sent */
  | { refused: string };

export interface EdgeWalker {
  /** foeEngine.driveEdgeRunFromPackage(pkg, claim, createEdgeRunStore(io)) — group C */
  drive(pkg: EdgeRunPackage, io: EdgeRunIo): Promise<EdgeSegmentOutcome>;
  /** abort the live walker of a run (its STOP sweep runs locally) */
  abortLive(runId: number): Promise<{ live: boolean }>;
  /**
   * the engine's STOP re-send of a VERIFIED sweep picture (foeEngine.resendStopsOfAbortedRun + edgeRunStore's sweep store):
   * the outcome of each STOP is reported as a `stop` event (no claim exists any more). Absent ⇒ the device port re-sends.
   */
  resendStops?(picture: EdgeSweepPicture, sink: EdgeReportSink): Promise<{ sent: number; failed: number }>;
}

/** `journaled`: the device front end already wrote the `stop` event (D's edge dispatch) — the agent does not write a second */
export type EdgeStopOutcome = { outcome: "sent" | "failed" | "simulated"; detail?: string; journaled?: boolean };
export interface EdgeStopContext {
  source: "command" | "anomaly" | "local";
  requestId: number | null;
}
/** Device actions central's commands ask for (edgeDispatchDevicePort: group D's edge dispatch, R-10-ad). */
export interface EdgeDevicePort {
  stopRobot(robotId: number, why: string, ctx: EdgeStopContext): Promise<EdgeStopOutcome>;
  /** pins null ⇒ the STOP pins of the VERIFIED config */
  stopAdapter(adapterId: number, pins: Array<{ tagKey: string; value: unknown }> | null, why: string, ctx: EdgeStopContext): Promise<EdgeStopOutcome>;
  lockRobot(robotId: number, reason: string): Promise<{ ok: boolean; generation: number | null; detail?: string }>;
  clearRobot(robotId: number, expectedGeneration: number, clearedBy: number, reason: string): Promise<{ ok: true; generation: number } | { ok: false; reason: "generation_mismatch" | "no_driver" | "error"; generation: number | null }>;
}

export interface EdgeAgentDeps {
  client: EdgeCentralClient;
  config: EdgeConfigSource;
  journal: EdgeJournal;
  shipper: EdgeStreamShipper;
  sink: EdgeReportSink;
  consume: EdgeJournalConsume;
  authorize: EdgeAuthorizeClient;
  programChecks: EdgeProgramChecks;
  walker: EdgeWalker | null;
  devices: EdgeDevicePort;
  /** foeGateApproval.hashWorkflowDefinition (injected: this module stays DB-free) */
  hashDefinition: (def: Record<string, unknown>) => string;
}

// ── agent ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Segment {
  runId: number;
  claimSeq: number;
  token: string;
  seq: number;
  aborted: boolean;
  controller: AbortController;
  done: Promise<void>;
}
interface PendingComplete {
  runId: number;
  claimSeq: number;
  token: string;
  seq: number;
  outcome: Exclude<EdgeSegmentOutcome, { refused: string }>;
}

export interface TickReport {
  online: boolean;
  claimed: number[];
  /** aborted runs whose unconfirmed STOPs this node re-sent (L-7) */
  stopsResent: number[];
  skipped: Array<{ runId: number; why: string }>;
  interrupted: number[];
  aborted: number[];
  commands: Array<{ requestId: number | null; kind: string; outcome: string }>;
}

export class EdgeExecutionAgent {
  private timer: NodeJS.Timeout | null = null;
  /** the PULL (+ STOP fast path) — single-flight, never behind the work phase (L-7) */
  private pulling: Promise<{ report: TickReport; rest: unknown[] | null; answer: EdgePullAnswer | null }> | null = null;
  /** the WORK phase (config refresh, non-STOP commands, segment ends, claims) — single-flight, skipped while busy */
  private working: Promise<void> | null = null;
  private readonly segments = new Map<number, Segment>();
  private readonly pending = new Map<number, PendingComplete>();
  private online: boolean | null = null;
  private readonly warned = new Map<number, string>();
  private readonly resentAt = new Map<number, number>();
  private readonly claimBackoff = new Map<number, { failures: number; nextAt: number }>();
  /** requestId → kind of commands already executed (central re-delivers until acknowledged) */
  private readonly handled = new Map<number, string>();
  /** STOPs already executed, by (requestId, target): a STOP is de-duplicated by its request, never discarded for its age
   *  (R-10-k), and an unverified copy can never suppress a genuine STOP of ANOTHER device under the same requestId */
  private readonly stopsDone = new Set<string>();
  /** fix review 1 (I-3) — STOPs whose request central has been acknowledged (a STOP executed unverified first is acked once
   *  a verified / explicit-unsigned copy arrives) */
  private readonly stopsAcked = new Set<string>();
  private stopped = false;

  constructor(
    private readonly cfg: EdgeAgentConfig,
    private readonly deps: EdgeAgentDeps,
  ) {}

  private now(): number {
    return (this.cfg.now ?? Date.now)();
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.cfg.pullIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    void this.tick().catch(() => undefined);
  }

  /** Stops pulling. Walkers already running finish their segment (their runs are not aborted by a shutdown). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // bounded: a work phase stuck on a central call that never answers must not hold a shutdown
    const bound = new Promise<void>((r) => {
      const t = setTimeout(r, this.cfg.requestTimeoutMs + 1_000);
      if (typeof t.unref === "function") t.unref();
    });
    await Promise.race([Promise.allSettled([this.pulling, this.working]), bound]);
  }

  liveRunIds(): number[] {
    return [...this.segments.keys()];
  }

  async idle(): Promise<void> {
    while (this.segments.size > 0) await Promise.allSettled([...this.segments.values()].map((s) => s.done));
  }

  private warnOnce(runId: number, why: string): void {
    if (this.warned.get(runId) === why) return;
    this.warned.set(runId, why);
    console.warn(`[EdgeExec] run ${runId}: ${why}`);
  }

  private anomaly(code: string, runId: number | null, detail: string): void {
    void this.deps.sink.event({ kind: "anomaly", code, runId, detail: detail.slice(0, 1_000), at: this.now() }).catch(() => undefined);
  }

  /**
   * One pull: its STOPs are executed FIRST (fast path, L-7 — before any config refresh, segment end, claim or other call to
   * central); then the work phase. The pull is single-flight on its own and NEVER waits for a previous work phase: a work
   * phase stuck on slow central calls cannot delay the STOPs of the next pull.
   */
  tick(): Promise<TickReport> {
    return (async () => {
      const r = await this.pullPhase();
      if (r.answer && r.rest) await this.workPhase(r.answer, r.rest, r.report);
      return r.report;
    })();
  }

  private pullPhase(): Promise<{ report: TickReport; rest: unknown[] | null; answer: EdgePullAnswer | null }> {
    if (this.pulling) return this.pulling;
    this.pulling = this.pullOnce().finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async pullOnce(): Promise<{ report: TickReport; rest: unknown[] | null; answer: EdgePullAnswer | null }> {
    const report: TickReport = { online: false, claimed: [], stopsResent: [], skipped: [], interrupted: [], aborted: [], commands: [] };
    const pulled = await this.deps.client.post("pull", {});
    if (!pulled.ok) {
      if (this.online !== false) {
        console.warn(`[EdgeExec] central not reachable / refused the node (HTTP ${pulled.status || "network"}${pulled.code ? ` ${pulled.code}` : ""}): no new run is started; a walking run's next non-STOP step is held (STOPs still go)`);
      }
      this.online = false;
      return { report, rest: null, answer: null };
    }
    if (this.online !== true) console.log("[EdgeExec] central reachable — pulling assigned runs");
    this.online = true;
    report.online = true;
    const p = pulled.data;
    // STOP FAST PATH (fix review 1, I-4): every STOP of the answer, against the trust we have NOW (a stale keyset ⇒ the
    // unverified-STOP path, then acked once a verified copy arrives) — before anything else
    const all = [...p.commands, ...unsignedStopsOf(p)];
    const verified = verifyCommands(this.deps.config.trust(), all, this.deps.config.credentialId());
    const isStop = (v: EdgeVerifiedCommand) => (v.ok ? v.command.kind : v.unverified?.kind) === "stop";
    report.commands.push(...(await this.handleVerified(verified.filter(isStop))));
    // L-7 — STOPs of runs aborted after their segment here that central could not confirm (STOP-class: fast path too)
    for (const s of p.stopsUnconfirmed) {
      if (this.segments.has(s.runId)) continue;
      const last = this.resentAt.get(s.runId);
      if (last !== undefined && this.now() - last < this.cfg.stopResendMinMs) continue;
      this.resentAt.set(s.runId, this.now());
      await this.resendStops(s.runId, s.picture);
      report.stopsResent.push(s.runId);
    }
    return { report, rest: all.filter((_, i) => !isStop(verified[i])), answer: p };
  }

  private workPhase(p: EdgePullAnswer, rest: unknown[], report: TickReport): Promise<void> {
    if (this.working) return Promise.resolve(); // busy: this answer's non-STOP work waits for the next pull (STOPs went already)
    this.working = this.workOnce(p, rest, report)
      .catch((err) => console.error(`[EdgeExec] work phase failed: ${(err as Error)?.message ?? err}`))
      .finally(() => {
        this.working = null;
      });
    return this.working;
  }

  private async workOnce(p: EdgePullAnswer, rest: unknown[], report: TickReport): Promise<void> {
    const { client, config } = this.deps;
    // a newer config / keyset ⇒ fetch + verify it before acting on anything else signed
    if (p.configVersion > config.version() || p.keysetVersion > config.trust().version) await config.refresh();
    if (p.programCheckRequested) void this.deps.programChecks.report().catch(() => undefined);
    // non-STOP commands (lock / clear …), verified against the (possibly refreshed) trust
    report.commands.push(...(await this.handleCommands(rest)));
    // 2) segment ends central has not taken yet
    for (const pc of [...this.pending.values()]) await this.sendComplete(pc);
    // 3) the node's current claims
    for (const c of p.claims) {
      const seg = this.segments.get(c.runId);
      if (seg) {
        if (c.abortRequested && (await this.abortSegment(seg))) report.aborted.push(c.runId);
        continue;
      }
      if (this.pending.has(c.runId)) continue;
      if (c.stale) {
        const r = await client.post("interrupted", { claimSeq: c.claimSeq }, { runId: c.runId });
        if (r.ok) report.interrupted.push(c.runId);
      }
    }
    // 5) claimable runs
    const listed = new Set(p.runs.map((r) => r.runId));
    for (const id of [...this.claimBackoff.keys()]) if (!listed.has(id)) this.claimBackoff.delete(id);
    for (const r of p.runs) {
      if (this.stopped || this.cfg.claimRuns === false) break;
      if (this.segments.size >= this.cfg.maxConcurrent) break;
      const runId = r.runId;
      if (this.segments.has(runId) || this.pending.has(runId)) continue;
      const skip = (why: string, backOff = false) => {
        report.skipped.push({ runId, why });
        this.warnOnce(runId, `not claimed — ${why}`);
        if (backOff) this.backOff(runId);
      };
      if (r.refused) {
        skip(`central refused it (${r.refused})`);
        continue;
      }
      const back = this.claimBackoff.get(runId);
      if (back && this.now() < back.nextAt) {
        report.skipped.push({ runId, why: `backing off after ${back.failures} refused attempt(s)` });
        continue;
      }
      if (!this.deps.walker) {
        skip("no edge walker is available in this build (driveEdgeRunFromPackage)");
        continue;
      }
      if (config.credentialId() === null) {
        skip("no verified config yet");
        continue;
      }
      if (!this.deps.consume.admitNonStop()) {
        skip("the journal is full or unhealthy — no new non-STOP work");
        continue;
      }
      const programChecks = await this.deps.programChecks.readNow().catch(() => [] as EdgeProgramCheck[]);
      const claimed = await client.post("claim", { claimSeq: r.claimSeq, defHash: r.defHash, programChecks }, { runId });
      if (!claimed.ok) {
        skip(`claim refused (${claimed.code ?? claimed.status})`, true);
        continue;
      }
      const v = verifyRunPackage(config.trust(), claimed.data.package, {
        runId,
        claimSeq: claimed.data.claimSeq,
        credentialId: config.credentialId(),
        defHash: r.defHash,
        hashDefinition: this.deps.hashDefinition,
      });
      if (!v.ok) {
        this.anomaly("EDGE_RUN_PACKAGE_INVALID", runId, `claim ${claimed.data.claimSeq}: ${v.reason}`);
        await client.post("release", { claimSeq: claimed.data.claimSeq, claimToken: claimed.data.claimToken, seq: 1, reason: `run package refused (${v.reason})` }, { runId });
        skip(`run package refused (${v.reason})`, true);
        continue;
      }
      this.claimBackoff.delete(runId);
      this.warned.delete(runId);
      report.claimed.push(runId);
      this.startSegment(v.pkg, claimed.data.claimSeq, claimed.data.claimToken);
    }
  }

  private backOff(runId: number): void {
    const failures = (this.claimBackoff.get(runId)?.failures ?? 0) + 1;
    const cap = this.cfg.claimBackoffMaxMs ?? 120_000;
    const delay = Math.min(cap, this.cfg.pullIntervalMs * 2 ** Math.min(failures, 20));
    this.claimBackoff.set(runId, { failures, nextAt: this.now() + delay });
  }

  // ── commands (design §2.8) ────────────────────────────────────────────────────────────────────────────────────────

  /**
   * R-10-o — every acknowledgement names the device ACTUALLY acted on and the owner epoch the command quoted (central closes
   * request X only when they are X's), `unsigned: true` for the explicit unsigned-STOP envelope.
   */
  private async ack(
    requestId: number,
    outcome: "done" | "refused" | "failed" | "expired",
    generation: number | null,
    acted: { target: { robotId: number } | { adapterId: number }; ownerEpoch: number; unsigned?: boolean },
  ): Promise<void> {
    await this.deps.sink
      // R-10-z — stop-class: never dropped when the journal is full, bounded wait
      .event({ kind: "command_ack", requestId, outcome, generation, at: this.now(), target: acted.target, ownerEpoch: acted.ownerEpoch, ...(acted.unsigned ? { unsigned: true as const } : {}) }, { stop: true })
      .catch(() => undefined);
  }

  private async stopTarget(target: { robotId: number } | { adapterId: number }, source: "command" | "anomaly" | "local", requestId: number | null, why: string, pins: Array<{ tagKey: string; value: unknown }> | null = null): Promise<EdgeStopOutcome> {
    let out: EdgeStopOutcome;
    try {
      const ctx = { source, requestId };
      out = "robotId" in target ? await this.deps.devices.stopRobot(target.robotId, why, ctx) : await this.deps.devices.stopAdapter(target.adapterId, pins, why, ctx);
    } catch (err) {
      out = { outcome: "failed", detail: (err as Error)?.message ?? String(err) };
    }
    if (!out.journaled) await this.deps.sink.event({ kind: "stop", target, source, requestId, outcome: out.outcome, at: this.now(), detail: (out.detail ?? why).slice(0, 500) }, { stop: true }).catch(() => undefined);
    if (out.outcome === "failed") console.error(`[EdgeExec] STOP ${JSON.stringify(target)} FAILED (${why}) — use the machine's direct STOP / E-STOP`);
    return out;
  }

  private ownerEpochOf(c: EdgeCommand): number | null {
    const cfg = this.deps.config;
    if (c.kind === "stop") return "robotId" in c.target ? (cfg.robot(c.target.robotId)?.ownerEpoch ?? null) : (cfg.adapter(c.target.adapterId)?.ownerEpoch ?? null);
    return cfg.robot(c.robotId)?.ownerEpoch ?? null;
  }

  async handleCommands(envs: readonly unknown[]): Promise<TickReport["commands"]> {
    if (envs.length === 0) return [];
    return this.handleVerified(verifyCommands(this.deps.config.trust(), envs, this.deps.config.credentialId()));
  }

  private async handleVerified(verified: readonly EdgeVerifiedCommand[]): Promise<TickReport["commands"]> {
    const out: TickReport["commands"] = [];
    // STOPs first (L-7): nothing else delays them
    const order = (v: EdgeVerifiedCommand) => ((v.ok ? v.command.kind : v.unverified?.kind) === "stop" ? 0 : 1);
    for (const v of [...verified].sort((a, b) => order(a) - order(b))) {
      try {
        out.push(await this.handleCommand(v));
      } catch (err) {
        console.error(`[EdgeExec] command handling failed: ${(err as Error)?.message ?? err}`);
      }
    }
    return out;
  }

  private stopKey(requestId: number, target: { robotId: number } | { adapterId: number }): string {
    return `${requestId}|${"robotId" in target ? `r${target.robotId}` : `a${target.adapterId}`}`;
  }
  private rememberStop(key: string): void {
    this.stopsDone.add(key);
    if (this.stopsDone.size > 5_000) {
      const old = this.stopsDone.values().next().value as string;
      this.stopsDone.delete(old);
      this.stopsAcked.delete(old);
    }
  }

  private async handleCommand(v: EdgeVerifiedCommand): Promise<TickReport["commands"][number]> {
    if (!v.ok) {
      const u = v.unverified;
      const tag = v.unsigned ? "unsigned" : "unverified";
      if (u?.kind === "stop") {
        // L-7 / R-10-k: a STOP goes without a valid signature (unsigned on purpose, or a signature that fails) — only to a
        // device this node owns (its VERIFIED config), once per (requestId, target), whatever its age
        const owned = "robotId" in u.target ? this.deps.config.ownsRobot(u.target.robotId) : this.deps.config.ownsAdapter(u.target.adapterId);
        if (!v.unsigned) this.anomaly("EDGE_COMMAND_INVALID", null, `stop command refused by verification (${v.reason}) request ${u.requestId} — STOP sent anyway (L-7)`);
        if (!owned) return { requestId: null, kind: "stop", outcome: `${tag}:not_owned` };
        const key = this.stopKey(u.requestId, u.target);
        if (this.stopsDone.has(key)) {
          // I-3 — executed before as evidence only (bad signature); this explicit unsigned copy may close the request
          if (v.unsigned && !this.stopsAcked.has(key)) {
            await this.ack(u.requestId, "done", null, { target: u.target, ownerEpoch: u.ownerEpoch, unsigned: true });
            this.stopsAcked.add(key);
          }
          return { requestId: v.unsigned ? u.requestId : null, kind: "stop", outcome: "duplicate" };
        }
        const r = await this.stopTarget(u.target, v.unsigned ? "command" : "anomaly", v.unsigned ? u.requestId : null, `${tag} STOP command (request ${u.requestId})`);
        // a STOP that could not be executed is NOT remembered: the next delivery retries it (never given up on)
        if (r.outcome !== "failed") this.rememberStop(key);
        // only the explicit unsigned-STOP envelope (R-10-p) is acknowledged — with the target ACTUALLY stopped (R-10-o); a STOP
        // whose signature is missing / fails is evidence only: reported with requestId null, never acknowledged
        if (v.unsigned && r.outcome !== "failed") {
          await this.ack(u.requestId, "done", null, { target: u.target, ownerEpoch: u.ownerEpoch, unsigned: true });
          this.stopsAcked.add(key);
        }
        return { requestId: v.unsigned ? u.requestId : null, kind: "stop", outcome: `${tag}:${r.outcome}` };
      }
      this.anomaly("EDGE_COMMAND_INVALID", null, `${u?.kind ?? "unparsable"} command refused (${v.reason})${u ? ` request ${u.requestId}` : ""} — only a STOP acts without a valid signature`);
      return { requestId: null, kind: u?.kind ?? "unknown", outcome: `refused:${v.reason}` };
    }
    const c = v.command;
    const prior = this.handled.get(c.requestId);
    if (prior !== undefined) return { requestId: c.requestId, kind: c.kind, outcome: "duplicate" };
    const remember = () => {
      this.handled.set(c.requestId, c.kind);
      if (this.handled.size > 2_000) this.handled.delete(this.handled.keys().next().value as number);
    };
    const epoch = this.ownerEpochOf(c);
    if (c.kind === "stop") {
      // a STOP goes even past its expiry / with a stale owner epoch (L-7, R-10-k: never discarded for its age); the device
      // must still be this node's
      const sk = this.stopKey(c.requestId, c.target);
      if (this.stopsDone.has(sk)) {
        // fix review 1 (I-3) — executed earlier through the unverified path (e.g. keyset rotation lag) and never acknowledged:
        // this VERIFIED copy acknowledges it, with the target actually stopped (R-10-o)
        if (!this.stopsAcked.has(sk)) {
          await this.ack(c.requestId, "done", null, { target: c.target, ownerEpoch: c.ownerEpoch });
          this.stopsAcked.add(sk);
        }
        remember();
        return { requestId: c.requestId, kind: "stop", outcome: "duplicate" };
      }
      if (epoch === null) {
        remember();
        await this.ack(c.requestId, "refused", null, { target: c.target, ownerEpoch: c.ownerEpoch });
        return { requestId: c.requestId, kind: "stop", outcome: "refused:not_owned" };
      }
      const r = await this.stopTarget(c.target, "command", c.requestId, `central STOP request ${c.requestId}${v.expired ? " (overdue — sent anyway)" : ""}`);
      if (r.outcome === "failed") return { requestId: c.requestId, kind: "stop", outcome: "failed" }; // not acked: re-delivered, retried
      this.rememberStop(sk);
      remember();
      await this.ack(c.requestId, "done", null, { target: c.target, ownerEpoch: c.ownerEpoch });
      this.stopsAcked.add(sk);
      return { requestId: c.requestId, kind: "stop", outcome: r.outcome };
    }
    const robotTarget = { robotId: c.robotId };
    if (epoch === null || epoch !== c.ownerEpoch) {
      remember();
      await this.ack(c.requestId, "refused", null, { target: robotTarget, ownerEpoch: c.ownerEpoch });
      return { requestId: c.requestId, kind: c.kind, outcome: epoch === null ? "refused:not_owned" : "refused:owner_epoch" };
    }
    if (c.kind === "lock") {
      const r = await this.deps.devices.lockRobot(c.robotId, c.reason || `central lock request ${c.requestId}`).catch(() => ({ ok: false, generation: null }));
      remember();
      await this.ack(c.requestId, r.ok ? "done" : "failed", r.generation ?? null, { target: robotTarget, ownerEpoch: c.ownerEpoch });
      return { requestId: c.requestId, kind: "lock", outcome: r.ok ? "done" : "failed" };
    }
    // clear — raises energy: valid, in its window, generation match (compare-and-clear)
    if (v.expired || v.notYetValid) {
      remember();
      await this.ack(c.requestId, "expired", null, { target: robotTarget, ownerEpoch: c.ownerEpoch });
      return { requestId: c.requestId, kind: "clear", outcome: "expired" };
    }
    const r = await this.deps.devices.clearRobot(c.robotId, c.expectedGeneration, c.clearedBy, c.reason).catch(() => ({ ok: false as const, reason: "error" as const, generation: null }));
    remember();
    if (r.ok) {
      await this.ack(c.requestId, "done", r.generation, { target: robotTarget, ownerEpoch: c.ownerEpoch });
      return { requestId: c.requestId, kind: "clear", outcome: "done" };
    }
    await this.ack(c.requestId, r.reason === "generation_mismatch" ? "refused" : "failed", r.generation ?? null, { target: robotTarget, ownerEpoch: c.ownerEpoch });
    return { requestId: c.requestId, kind: "clear", outcome: `refused:${r.reason}` };
  }

  // ── STOP re-send from the sweep picture (L-7) ─────────────────────────────────────────────────────────────────────

  private async resendStops(runId: number, env: unknown): Promise<void> {
    const v = edgeTrustAdapter.sweepPicture(this.deps.config.trust(), env, { runId, credentialId: this.deps.config.credentialId() });
    let stops: EdgeVerifiedStop[];
    let sentBefore: Set<string>;
    let verifiedPins = true;
    if (v.ok && this.deps.walker?.resendStops) {
      try {
        const r = await this.deps.walker.resendStops(v.picture, this.deps.sink);
        console.warn(`[EdgeExec] run ${runId}: aborted centrally after its segment here — STOPs re-sent from this node by the engine sweep (sent ${r.sent}, failed ${r.failed})`);
        return;
      } catch (err) {
        console.error(`[EdgeExec] run ${runId}: engine STOP re-send failed (${(err as Error)?.message ?? err}) — re-sending through the device port`);
      }
    }
    if (v.ok) {
      stops = v.picture.verifiedStops;
      sentBefore = new Set(v.picture.prior.abortSentBefore);
    } else {
      // unverifiable picture: still STOP — robot aborts, OT stops with the VERIFIED config's pins only (never the message's)
      this.anomaly("EDGE_SWEEP_PICTURE_INVALID", runId, `sweep picture refused by verification (${v.reason}) — STOPs sent with the config's pins`);
      verifiedPins = false;
      let pic: EdgeSweepPicture | null = null;
      try {
        const p = edgeSweepPictureSchema.safeParse(parseEdgeCanonicalJson(String((env as { payload?: unknown })?.payload ?? "")));
        pic = p.success && p.data.runId === runId ? p.data : null;
      } catch {
        pic = null;
      }
      stops = pic?.verifiedStops ?? [];
      sentBefore = new Set(); // fix review 1 (M-7) — an UNVERIFIED picture never skips a STOP (its "sent before" is not trusted)
    }
    let sent = 0;
    let failed = 0;
    for (const s of stops) {
      if (sentBefore.has(s.stepId)) continue;
      const owned = s.kind === "robot" ? this.deps.config.ownsRobot(s.robotId) : this.deps.config.ownsAdapter(s.adapterId);
      if (!owned) continue;
      const why = `run ${runId} step ${s.stepId}: STOP re-sent (central could not confirm it)`;
      const r = s.kind === "robot" ? await this.stopTarget({ robotId: s.robotId }, "local", null, why) : await this.stopTarget({ adapterId: s.adapterId }, "local", null, why, verifiedPins ? s.pins : null);
      if (r.outcome === "failed") failed++;
      else sent++;
    }
    console.warn(`[EdgeExec] run ${runId}: aborted centrally after its segment here — STOPs re-sent from this node (sent ${sent}, failed ${failed})`);
  }

  // ── segments ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private startSegment(pkg: EdgeRunPackage, claimSeq: number, token: string): void {
    const runId = pkg.runId;
    const seg: Segment = { runId, claimSeq, token, seq: 1, aborted: false, controller: new AbortController(), done: Promise.resolve() };
    this.segments.set(runId, seg);
    this.deps.shipper.setClaim(runId, claimSeq, token);
    seg.done = this.runSegment(seg, pkg).finally(() => {
      if (this.segments.get(runId) === seg) this.segments.delete(runId);
    });
  }

  private io(seg: Segment): EdgeRunIo {
    const d = this.deps;
    return {
      runId: seg.runId,
      claimSeq: seg.claimSeq,
      claimToken: seg.token,
      sink: d.sink,
      consume: d.consume,
      authorize: d.authorize,
      trust: () => d.config.trust(),
      config: d.config,
      programChecks: () => d.programChecks.latest(),
      signal: seg.controller.signal,
    };
  }

  private async runSegment(seg: Segment, pkg: EdgeRunPackage): Promise<void> {
    const stopWatch = this.watch(seg);
    let outcome: EdgeSegmentOutcome;
    try {
      outcome = normaliseOutcome(await this.deps.walker!.drive(pkg, this.io(seg)));
    } catch (err) {
      console.error(`[EdgeExec] run ${seg.runId}: walker error — ${(err as Error)?.message ?? err}`);
      outcome = { outcome: "failed", error: `edge walker error: ${String((err as Error)?.message ?? err).slice(0, 300)}` };
    } finally {
      await stopWatch();
    }
    if ("refused" in outcome) {
      const r = await this.deps.client.post("release", { claimSeq: seg.claimSeq, claimToken: seg.token, seq: ++seg.seq, reason: outcome.refused.slice(0, 300) }, { runId: seg.runId });
      if (!r.ok) console.error(`[EdgeExec] run ${seg.runId}: not executed here (${outcome.refused}); release not confirmed (HTTP ${r.status || "network"}) — it will be declared interrupted once stale`);
      await this.finishStream(seg.runId, seg.claimSeq, "released");
      return;
    }
    await this.sendComplete({ runId: seg.runId, claimSeq: seg.claimSeq, token: seg.token, seq: seg.seq, outcome });
  }

  /** Progress every progressMs (claim-bound sequence); abortRequested ⇒ local abort; commands handled. */
  private watch(seg: Segment): () => Promise<void> {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<void> | null = null;
    const tick = async () => {
      if (stopped) return;
      const r = await this.deps.client.post("progress", { claimSeq: seg.claimSeq, claimToken: seg.token, seq: ++seg.seq }, { runId: seg.runId });
      if (stopped) return;
      if (r.ok) {
        const cmds = [...r.data.commands, ...unsignedStopsOf(r.data)];
        if (cmds.length > 0) await this.handleCommands(cmds);
        if (r.data.abortRequested) await this.abortSegment(seg);
      } else if (r.code === "claim_stale" && (r.data as { abortRequested?: unknown } | undefined)?.abortRequested === true) {
        await this.abortSegment(seg);
      }
      // unreachable: nothing to read locally — the next non-STOP step cannot be authorised (held), STOPs still go
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

  /** Abort the LOCAL walker once (non-STOP steps stop; STOPs still sent). true ⇔ applied now. */
  private async abortSegment(seg: Segment): Promise<boolean> {
    if (seg.aborted) return false;
    seg.aborted = true;
    seg.controller.abort();
    try {
      const r = await this.deps.walker!.abortLive(seg.runId);
      console.warn(`[EdgeExec] run ${seg.runId}: central stopped it — local walker ${r.live ? "aborted (non-STOP steps stopped, STOPs sent)" : "already finished"}`);
    } catch (err) {
      console.error(`[EdgeExec] run ${seg.runId}: local abort failed — ${(err as Error)?.message ?? err}; use the machine's direct STOP / E-STOP`);
    }
    return true;
  }

  /** Ship the run stream; done ⇒ forget the claim token. */
  private async finishStream(runId: number, claimSeq: number, why: string): Promise<void> {
    const stream = edgeRunStream(runId, claimSeq);
    const f = await this.deps.shipper.flush(stream);
    if (f === "claim_gone") await this.deps.shipper.orphanRunStream(stream, `claim ${why}`);
    if (this.deps.journal.pending(stream, 1).length === 0) this.deps.shipper.forgetClaim(runId, claimSeq);
  }

  private async sendComplete(p: PendingComplete): Promise<void> {
    const stream = edgeRunStream(p.runId, p.claimSeq);
    await this.deps.journal.flush(); // R-10-ag — only durable records ship: make the segment's records durable first
    const f = await this.deps.shipper.flush(stream);
    if (f === "claim_gone") {
      await this.deps.shipper.orphanRunStream(stream, "claim no longer current at segment end");
      this.pending.delete(p.runId);
      return;
    }
    if (this.deps.journal.pending(stream, 1).length > 0 || this.deps.journal.undurableCount(stream) > 0) {
      this.pending.set(p.runId, p); // reports first: complete only once central holds every record
      return;
    }
    const o = p.outcome;
    const r = await this.deps.client.post(
      "complete",
      {
        claimSeq: p.claimSeq,
        claimToken: p.token,
        seq: ++p.seq,
        outcome: o.outcome,
        ...(o.outcome === "paused" ? { gateStepId: o.gateStepId } : {}),
        ...(o.outcome === "held" ? { heldReason: o.heldReason } : {}),
        ...((o.outcome === "failed" || o.outcome === "held" || o.outcome === "aborted") && o.error ? { error: o.error.slice(0, 4_000) } : {}),
        epoch: this.deps.journal.epoch,
        reportedThrough: this.deps.journal.ackedSeq(stream),
      },
      { runId: p.runId },
    );
    if (r.ok || (!r.unavailable && r.code !== "gap" && r.code !== "not_finished")) {
      // taken — or the claim is gone (stale / not found): nothing left to report for this segment
      this.pending.delete(p.runId);
      this.deps.shipper.forgetClaim(p.runId, p.claimSeq);
      if (!r.ok) console.warn(`[EdgeExec] run ${p.runId}: segment end not taken (${r.code ?? r.status}) — the claim is no longer current`);
      return;
    }
    this.pending.set(p.runId, p);
  }
}

/**
 * R-10-k / R-10-p — STOP requests central delivers UNSIGNED (its signer unavailable): the answer's `unsignedStops` (group B's
 * strict envelope, edgeProtocol.edgeUnsignedStopSchema). Only that envelope for THIS node + credential is treated as unsigned
 * (edgeCentralClient.parseEdgeUnsignedStop); it acts ONLY as a STOP of an owned device.
 */
function unsignedStopsOf(answer: unknown): unknown[] {
  const a = answer as { unsignedStops?: unknown } | null;
  const out: unknown[] = [];
  if (Array.isArray(a?.unsignedStops)) out.push(...a.unsignedStops.slice(0, 100));
  return out;
}

function normaliseOutcome(o: unknown): EdgeSegmentOutcome {
  const v = o as Record<string, unknown> | null;
  if (v && typeof v.refused === "string") return { refused: v.refused };
  switch (v?.outcome) {
    case "completed":
      return { outcome: "completed" };
    case "aborted":
      return { outcome: "aborted", ...(typeof v.error === "string" ? { error: v.error } : {}) };
    case "failed":
      return { outcome: "failed", ...(typeof v.error === "string" ? { error: v.error } : {}) };
    case "paused":
      if (typeof v.gateStepId === "string" && v.gateStepId) return { outcome: "paused", gateStepId: v.gateStepId };
      break;
    case "held":
      if ((EDGE_HELD_REASONS as readonly unknown[]).includes(v.heldReason)) return { outcome: "held", heldReason: v.heldReason as EdgeHeldReason, ...(typeof v.error === "string" ? { error: v.error } : {}) };
      break;
  }
  // foeEngine.EdgeDriveResult without a segment end: the run status alone
  if (v?.outcome === undefined && typeof v?.status === "string") {
    if (v.status === "completed") return { outcome: "completed" };
    if (v.status === "aborted") return { outcome: "aborted", ...(typeof v.error === "string" ? { error: v.error } : {}) };
    if (v.status === "failed") return { outcome: "failed", ...(typeof v.error === "string" ? { error: v.error } : {}) };
  }
  return { outcome: "failed", error: "the edge walker returned an unknown outcome" };
}

// ── default bindings (production) ───────────────────────────────────────────────────────────────────────────────────

/**
 * Group C's walker (e4959fff5): foeEngine.driveEdgeRunFromPackage(pkg, claim, edgeRunStore.createEdgeRunStore(pkg, io)); the
 * local abort is foeEngine.stopLiveRunForCentralAbort; the STOP re-send of a verified sweep picture is
 * foeEngine.resendStopsOfAbortedRun(picture, user, edgeRunStore.createEdgeSweepStore(picture, …)).
 */
export async function loadDefaultEdgeWalker(): Promise<EdgeWalker> {
  const [engine, store] = await Promise.all([import("../orchestration/foe/foeEngine"), import("./edgeRunStore")]);
  return {
    drive: async (pkg, io) =>
      normaliseOutcome(await engine.driveEdgeRunFromPackage(pkg, { runId: io.runId, claimSeq: io.claimSeq, claimToken: io.claimToken, defHash: pkg.defHash }, store.createEdgeRunStore(pkg, io))),
    abortLive: (runId) => engine.stopLiveRunForCentralAbort(runId, { ...EDGE_AGENT_ABORT_USER }),
    resendStops: async (picture, sink) => {
      let sent = 0;
      let failed = 0;
      const targetOf = (stepId: string) => picture.verifiedStops.find((x) => x.stepId === stepId);
      const sweep = store.createEdgeSweepStore(picture, {
        abortStop: async (rec) => {
          const s = targetOf(rec.stepId);
          if (rec.status === "completed") sent++;
          else failed++;
          if (!s) return;
          const target = s.kind === "robot" ? { robotId: s.robotId } : { adapterId: s.adapterId };
          await sink.event({ kind: "stop", target, source: "local", requestId: null, outcome: rec.status === "completed" ? "sent" : "failed", at: rec.at, detail: `run ${picture.runId} step ${rec.stepId}: STOP re-sent (central could not confirm it)` }, { stop: true });
        },
        event: (rec) => sink.event(rec),
      });
      await engine.resendStopsOfAbortedRun(picture, { ...EDGE_AGENT_ABORT_USER }, sweep);
      return { sent, failed };
    },
  };
}

/** foeGateApproval.hashWorkflowDefinition — the SAME hash central bound the assignment's defHash to. */
export async function defaultEdgeHashDefinition(): Promise<(def: Record<string, unknown>) => string> {
  const { hashWorkflowDefinition } = await import("../orchestration/foe/foeGateApproval");
  return (def) => hashWorkflowDefinition(def as never);
}


/**
 * R-10-ad — central STOP / lock / clear of an edge-owned device go through group D's edge dispatch: a robot STOP is
 * robotEdgeDispatch's canonical abort (no authorisation; a robot the snapshot KNOWS is uncommissioned ⇒ simulated, R-1C-d), an
 * OT STOP is otEdgeDispatch's verified PINNED stop (pins checked against the signed snapshot + the running connection
 * fingerprint — never a write the snapshot does not pin). Both journal their own `stop` record. Lock / clear act on the
 * authority's in-memory MotionLock of D's robotManager (compare-and-clear on the generation).
 */
export function edgeDispatchDevicePort(config: EdgeConfigSource): EdgeDevicePort {
  const robotOf = async (id: number) => (await import("../robot/robotManager")).getActiveRobot(id);
  const idem = (kind: string, id: number, ctx: EdgeStopContext) => `edge-${ctx.source}-${ctx.requestId ?? "local"}-${kind}${id}-${Date.now()}`;
  return {
    async stopRobot(robotId, why, ctx) {
      const { dispatchRobotOnEdge } = await import("../robot/robotEdgeDispatch");
      const r = await dispatchRobotOnEdge({ robotId, job: { jobType: "abort" }, idempotencyKey: idem("r", robotId, ctx), source: ctx.source, requestId: ctx.requestId });
      const outcome = r.ok ? (r.status === "simulated" ? "simulated" : "sent") : "failed";
      return { outcome, detail: r.reason ?? r.error ?? why, journaled: true };
    },
    async stopAdapter(adapterId, pins, why, ctx) {
      const a = config.adapter(adapterId);
      const usePins = pins ?? (a?.tags ?? []).filter((t) => t.stopValue !== null && t.stopValue !== undefined).map((t) => ({ tagKey: t.tagKey, value: t.stopValue }));
      if (!a || usePins.length === 0) return { outcome: "failed", detail: !a ? `adapter ${adapterId} is not this node's` : `adapter ${adapterId} has no pinned STOP tag` };
      const { dispatchOtOnEdge } = await import("../ot/otEdgeDispatch");
      const r = await dispatchOtOnEdge({ adapterId, machineId: a.machineId, commandType: "stop", writes: usePins, idempotencyKey: idem("a", adapterId, ctx), source: ctx.source, requestId: ctx.requestId });
      if (!r.stop) return { outcome: "failed", detail: r.reason ?? r.detail ?? `not a verified pinned STOP (${why})`, journaled: true };
      const outcome = r.ok ? (r.status === "simulated" ? "simulated" : "sent") : "failed";
      return { outcome, detail: r.reason ?? why, journaled: true };
    },
    async lockRobot(robotId, reason) {
      const lock = (await robotOf(robotId))?.driver.motionLockController?.();
      if (!lock) return { ok: false, generation: null, detail: "no motion lock on this edge" };
      lock.lock("centralLock", reason);
      return { ok: true, generation: lock.snapshot().generation ?? null };
    },
    async clearRobot(robotId, expectedGeneration, clearedBy, reason) {
      const lock = (await robotOf(robotId))?.driver.motionLockController?.();
      if (!lock) return { ok: false, reason: "no_driver", generation: null };
      try {
        const st = lock.clearByOperator({ reason, userId: clearedBy, expectedGeneration });
        return { ok: true, generation: st.generation ?? expectedGeneration };
      } catch (err) {
        if ((err as Error)?.name === "MotionLockConflictError") return { ok: false, reason: "generation_mismatch", generation: lock.snapshot().generation ?? null };
        return { ok: false, reason: "error", generation: lock.snapshot().generation ?? null };
      }
    },
  };
}

let agent: EdgeExecutionAgent | null = null;

/** Start the agent (edge gateway boot) with the gateway's runtime; refuses (starts nothing) on any missing piece. */
export async function startEdgeExecution(cfg: EdgeAgentConfig | { error: string }, deps: EdgeAgentDeps): Promise<EdgeExecutionAgent | null> {
  if (agent) return agent;
  if ("error" in cfg) {
    console.log(`[EdgeExec] run execution NOT started: ${cfg.error}`);
    return null;
  }
  if (!deps.walker) console.warn("[EdgeExec] no edge walker (driveEdgeRunFromPackage) in this build — runs are NOT claimed; commands and STOP re-sends still work");
  agent = new EdgeExecutionAgent(cfg, deps);
  await deps.shipper.orphanUntokened("claim token lost on restart (never journaled) — the claim is declared interrupted");
  agent.start();
  console.log(`[EdgeExec] run execution started (pull every ${cfg.pullIntervalMs} ms, progress every ${cfg.progressMs} ms, at most ${cfg.maxConcurrent} runs)`);
  return agent;
}

export function currentEdgeExecutionAgent(): EdgeExecutionAgent | null {
  return agent;
}

export async function stopEdgeExecution(): Promise<void> {
  const a = agent;
  agent = null;
  if (a) await a.stop();
}
