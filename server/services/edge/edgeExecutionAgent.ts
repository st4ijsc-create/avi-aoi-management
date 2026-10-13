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
  /** final fix wave (I-2) — the UPPER bound of the pull interval; the interval used is central's signed limits.pullMs ≤ this */
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

/** doc 81 Đợt 10 final fix wave (M-4) — a loopback host (the same machine): plain http never leaves it. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * EDGE_CENTRAL_URL as an http(s) URL without a trailing slash, or why not.
 * doc 81 Đợt 10 final fix wave (M-4) — plain `http://` is refused unless the host is loopback: the signed config carries the node's
 * DECRYPTED device secrets (D4) and every request the bearer node credential — signatures protect integrity, not confidentiality.
 * EDGE_ALLOW_INSECURE_CENTRAL=1 accepts it for a lab only, with a loud warning on every start.
 */
export function edgeCentralUrlFromEnv(env: NodeJS.ProcessEnv = process.env): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(String(env.EDGE_CENTRAL_URL ?? ""));
  } catch {
    return { error: "EDGE_CENTRAL_URL is not a URL (e.g. https://central.example:3000)" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "EDGE_CENTRAL_URL must be http(s)" };
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    if (env.EDGE_ALLOW_INSECURE_CENTRAL !== "1" && env.EDGE_ALLOW_INSECURE_CENTRAL !== "true") {
      return {
        error:
          "EDGE_CENTRAL_URL uses plain http:// to a non-loopback host — refused: the config carries this node's decrypted device secrets and every request its node credential; use https:// (EDGE_ALLOW_INSECURE_CENTRAL=1 accepts it for a lab only)",
      };
    }
    console.warn(
      `[EdgeExec] ⚠ INSECURE: EDGE_CENTRAL_URL ${url.origin} is plain http (EDGE_ALLOW_INSECURE_CENTRAL=1) — device secrets and the node credential cross the network UNENCRYPTED. Never in production.`,
    );
  }
  return { url: url.toString().replace(/\/+$/, "") };
}

/** doc 81 Đợt 10 final fix wave (I-2) — the design's pull interval (§2.8: commands reach the edge within 2 s). */
export const EDGE_DEFAULT_PULL_INTERVAL_MS = 2_000;
/**
 * EDGE_PULL_INTERVAL_MS — the UPPER bound of the agent's pull interval (default 2 s, 200 ms … 300 s). The interval actually used
 * is central's signed limits.pullMs (verified config), never above this bound: the env can make the pull faster, never slower.
 */
export function edgePullIntervalBoundFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return clampInt(env.EDGE_PULL_INTERVAL_MS, EDGE_DEFAULT_PULL_INTERVAL_MS, 200, 300_000);
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
    pullIntervalMs: edgePullIntervalBoundFromEnv(env),
    progressMs: clampInt(env.EDGE_ABORT_POLL_MS, 2000, 50, 60_000),
    maxConcurrent: clampInt(env.EDGE_MAX_CONCURRENT_RUNS, 4, 1, 32),
    requestTimeoutMs: clampInt(env.EDGE_REQUEST_TIMEOUT_MS, 10_000, 500, 60_000),
    stopResendMinMs: clampInt(env.EDGE_STOP_RESEND_MIN_MS, 10_000, 200, 600_000),
    claimBackoffMaxMs: clampInt(env.EDGE_CLAIM_BACKOFF_MAX_MS, 120_000, 1_000, 3_600_000),
  };
}

/** fix review 3/4 (F-3, M-3) — re-acks of one executed STOP request before an anomaly; their time back-off */
export const EDGE_STOP_REACK_MAX = 10;
export const EDGE_STOP_REACK_BACKOFF_MS = 2_000;
export const EDGE_STOP_REACK_BACKOFF_MAX_MS = 300_000;
/** R-10-bn (F1-4) — the longest interval between two STOP re-sends of one unconfirmed sweep picture */
export const EDGE_SWEEP_RESEND_MAX_MS = 30_000;
/** fix review 4 (M-2) — at most one notOwnedHere answer per STOP request per minute */
export const EDGE_NOT_OWNED_HERE_MIN_MS = 60_000;
/** fix review 4 (M-3) — STOP memories older than this are dropped */
export const EDGE_STOP_MEMORY_MAX_AGE_MS = 3_600_000;
/** fix review 3 (F-1) — a STOP pending on an unknown target this long ⇒ an edge alert */
export const EDGE_STOP_PENDING_ALERT_MS = 30_000;

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

/** the owner epoch of a device in the edge's VERIFIED config (null: the config does not name it) */
export type EdgeOwnerEpochOf = (target: { robotId: number } | { adapterId: number }) => number | null;

/**
 * R-10-bn (F1-4) — the `sweep_stop` record (B's shape, edgeSweepStopEventRecordSchema) of a STOP re-sent from a VERIFIED sweep
 * picture: bound to the picture (run, its verified STOP step, that step's target, the device's owner epoch from the verified
 * config, the picture's issuedAt). Central records it as the step's STOP ledger row and, unless `failed`, confirms abort:<step>
 * (the run leaves stopsUnconfirmed ⇒ no more re-sends). null ⇒ no owner epoch known (central could not record it anyway).
 */
export function edgeSweepStopRecord(
  picture: EdgeSweepPicture,
  stepId: string,
  target: { robotId: number } | { adapterId: number },
  status: "completed" | "failed" | "simulated",
  at: number,
  ownerEpochOf: EdgeOwnerEpochOf | undefined,
): { kind: "sweep_stop"; runId: number; stepId: string; target: { robotId: number } | { adapterId: number }; ownerEpoch: number; pictureIssuedAt: number; status: "completed" | "failed" | "simulated"; at: number } | null {
  const ownerEpoch = ownerEpochOf?.(target) ?? null;
  if (ownerEpoch === null) return null;
  return { kind: "sweep_stop", runId: picture.runId, stepId, target, ownerEpoch, pictureIssuedAt: picture.issuedAt, status, at };
}

export interface EdgeWalker {
  /** foeEngine.driveEdgeRunFromPackage(pkg, claim, createEdgeRunStore(io)) — group C */
  drive(pkg: EdgeRunPackage, io: EdgeRunIo): Promise<EdgeSegmentOutcome>;
  /** abort the live walker of a run (its STOP sweep runs locally) */
  abortLive(runId: number): Promise<{ live: boolean }>;
  /**
   * the engine's STOP re-send of a VERIFIED sweep picture (foeEngine.resendStopsOfAbortedRun + edgeRunStore's sweep store):
   * the outcome of each STOP is reported as a `stop` event (no claim exists any more). Absent ⇒ the device port re-sends.
   */
  resendStops?(picture: EdgeSweepPicture, sink: EdgeReportSink, ownerEpochOf?: EdgeOwnerEpochOf): Promise<{ sent: number; failed: number }>;
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
  /**
   * fix review 4 (F-2 leftover) — does this edge hold a SESSION for the (owned) device? false ⇒ its STOPs are answered
   * notOwnedHere (central's fallback executes them, R-10-ay). Absent ⇒ assumed yes.
   */
  hasSession?: (target: { robotId: number } | { adapterId: number }) => boolean;
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
  private pulling: Promise<{ report: TickReport; rest: unknown[] | null; answer: EdgePullAnswer | null; cycle: number; deferred?: unknown[] }> | null = null;
  /** the WORK phase (config refresh, non-STOP commands, segment ends, claims) — single-flight, skipped while busy */
  private working: Promise<void> | null = null;
  private readonly segments = new Map<number, Segment>();
  private readonly pending = new Map<number, PendingComplete>();
  private online: boolean | null = null;
  private readonly warned = new Map<number, string>();
  /** R-10-bn (F1-4) — per run of `stopsUnconfirmed`: re-sends so far + the next one allowed (back-off) */
  private readonly resentAt = new Map<number, { n: number; next: number }>();
  private readonly claimBackoff = new Map<number, { failures: number; nextAt: number }>();
  /** requestId → kind of commands already executed (central re-delivers until acknowledged) */
  private readonly handled = new Map<number, string>();
  /**
   * fix reviews 2 + 3 (S-1 / F-3, R-10-ar / R-10-au) — STOP memories by (requestId, target), each de-duplicating only its own
   * kind: a VERIFIED copy is a duplicate only of a VERIFIED execution (an unsigned or evidence-only run never satisfies it:
   * the signed copy re-executes, then acks); an unsigned copy is a duplicate of either. A duplicate is RE-ACKED (bounded) —
   * central re-delivers until it holds the ack. Evidence runs (missing / failing signature) are never acked. A STOP is never
   * discarded for its age (R-10-k).
   */
  /** executed by a VERIFIED copy (a later signed copy is a duplicate — and is re-acked) */
  private readonly stopsVerified = new Set<string>();
  /** fix review 3 (F-3) — executed by the explicit UNSIGNED envelope: de-duplicates unsigned copies only, NEVER a signed one */
  private readonly stopsUnsigned = new Set<string>();
  private readonly stopsEvidence = new Set<string>();
  /** fix review 3/4 (F-3, M-3) — re-acks per STOP request: a time back-off (never a re-delivery count), pruned by age */
  private readonly reacks = new Map<string, { count: number; next: number; at: number }>();
  /** fix review 2 (S-2) — the last answer named a newer config / keyset than the one verified here */
  private refreshPending = false;
  /**
   * fix review 4 (M-1) — refresh state PER PULL: every pull gets a cycle id; a device is "not ours" only after a verified
   * refresh made for THAT cycle (an overlapping work phase of an older pull can never vouch for a newer pull's STOPs)
   */
  private cycleSeq = 0;
  private lastRefreshedCycle = -1;
  /** fix review 4 (M-2) — notOwnedHere answers per STOP request: rate-limited, one alert */
  private readonly notOwnedSent = new Map<string, number>();
  /** fix review 3 (F-1) — an unknown target asks for a refresh now, whatever the answer's version says */
  private forceRefresh = false;
  /** fix review 3 (F-1) — STOPs waiting for a verified refresh to know their target, since when (alert after a bound) */
  private readonly pendingSince = new Map<string, number>();
  private readonly pendingAlerted = new Set<string>();
  private pullStartedAt = 0;
  private stopped = false;
  /**
   * R-10-bs — the LAST pull answer said central's run side is unavailable (`runStateUnavailable`): every NON-STOP work is held
   * (no non-STOP command, no claim / interrupted, a walking run's next non-STOP step answered `unavailable` ⇒ held) until a pull
   * answer without it. STOPs, aborts named by central and STOP re-sends still go. Missing run data is never read as "no abort".
   */
  private runStateHold = false;

  constructor(
    private readonly cfg: EdgeAgentConfig,
    private readonly deps: EdgeAgentDeps,
  ) {}

  private now(): number {
    return (this.cfg.now ?? Date.now)();
  }

  /**
   * doc 81 Đợt 10 final fix wave (I-2, R-10-br) — the pull interval NOW: central's SIGNED limits.pullMs from the verified config
   * (design §2.8: 2 s), 2 s while no config is verified; never above the configured bound (EDGE_PULL_INTERVAL_MS), never below
   * 200 ms. Read before every pull, so a new config takes effect at the next one.
   */
  pullIntervalNowMs(): number {
    const cfgSrc = this.deps.config as { limits?: () => { pullMs?: number } | null };
    let signed: number | undefined;
    try {
      signed = typeof cfgSrc.limits === "function" ? cfgSrc.limits()?.pullMs : undefined;
    } catch {
      signed = undefined;
    }
    const base = typeof signed === "number" && Number.isFinite(signed) && signed > 0 ? signed : EDGE_DEFAULT_PULL_INTERVAL_MS;
    return Math.max(200, Math.min(base, this.cfg.pullIntervalMs));
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const schedule = () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        void this.tick().catch(() => undefined);
        schedule();
      }, this.pullIntervalNowMs());
      if (typeof this.timer.unref === "function") this.timer.unref();
    };
    schedule();
    void this.tick().catch(() => undefined);
  }

  /** Stops pulling. Walkers already running finish their segment (their runs are not aborted by a shutdown). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
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
      if (r.answer && r.rest) await this.workPhase(r.answer, r.rest, r.report, r.cycle, r.deferred);
      return r.report;
    })();
  }

  /**
   * Single-flight — but BOUNDED (fix review 2, N-4): a pull still running after 2 × requestTimeoutMs + 1 s (a STOP call that never
   * settles) no longer holds the next one; that next pull's STOPs go (a double STOP is harmless, the ack is de-duplicated).
   */
  private pullPhase(): Promise<{ report: TickReport; rest: unknown[] | null; answer: EdgePullAnswer | null; cycle: number; deferred?: unknown[] }> {
    if (this.pulling && Date.now() - this.pullStartedAt < 2 * this.cfg.requestTimeoutMs + 1_000) return this.pulling;
    const p = this.pullOnce().finally(() => {
      if (this.pulling === p) this.pulling = null;
    });
    this.pulling = p;
    this.pullStartedAt = Date.now();
    return p;
  }

  private async pullOnce(): Promise<{ report: TickReport; rest: unknown[] | null; answer: EdgePullAnswer | null; cycle: number; deferred?: unknown[] }> {
    const cycle = ++this.cycleSeq;
    this.pruneMemories();
    const report: TickReport = { online: false, claimed: [], stopsResent: [], skipped: [], interrupted: [], aborted: [], commands: [] };
    const pulled = await this.deps.client.post("pull", {});
    if (!pulled.ok) {
      if (this.online !== false) {
        console.warn(`[EdgeExec] central not reachable / refused the node (HTTP ${pulled.status || "network"}${pulled.code ? ` ${pulled.code}` : ""}): no new run is started; a walking run's next non-STOP step is held (STOPs still go)`);
      }
      this.online = false;
      return { report, rest: null, answer: null, cycle };
    }
    if (this.online !== true) console.log("[EdgeExec] central reachable — pulling assigned runs");
    this.online = true;
    report.online = true;
    const p = pulled.data;
    this.refreshPending = p.configVersion > this.deps.config.version() || p.keysetVersion > this.deps.config.trust().version;
    const hold = p.runStateUnavailable === true;
    if (hold && !this.runStateHold) console.warn("[EdgeExec] central's run state is UNAVAILABLE (runStateUnavailable) — every non-STOP work is held; STOPs still go");
    if (!hold && this.runStateHold) console.log("[EdgeExec] central's run state is available again — non-STOP work resumes");
    this.runStateHold = hold;
    // STOP FAST PATH (fix review 1, I-4): every STOP of the answer, against the trust we have NOW (a stale keyset ⇒ the
    // unverified-STOP path; the verified copy later re-executes and acks) — before anything else
    const all = [...p.commands, ...unsignedStopsOf(p)];
    const verified = verifyCommands(this.deps.config.trust(), all, this.deps.config.credentialId());
    const isStop = (v: EdgeVerifiedCommand) => (v.ok ? v.command.kind : v.unverified?.kind) === "stop";
    // S-2 — a STOP for a device not in the CURRENT config while a newer config is pending is deferred to the work phase
    // (after the refresh: executed if the incoming config has the device); never acked `refused` before that
    const deferred: unknown[] = [];
    for (let i = 0; i < all.length; i++) {
      if (!isStop(verified[i])) continue;
      try {
        const r = await this.handleCommand(verified[i], cycle);
        report.commands.push(r);
        if (r.outcome.includes("pending:")) deferred.push(all[i]); // signed, unsigned and evidence alike
      } catch (err) {
        console.error(`[EdgeExec] STOP handling failed: ${(err as Error)?.message ?? err}`);
      }
    }
    // L-7 — STOPs of runs aborted after their segment here that central could not confirm (STOP-class: fast path too)
    // R-10-bn (F1-4) — central confirms a re-sent STOP (bound to its picture) ⇒ the run leaves `stopsUnconfirmed` ⇒ no more
    // re-sends; until then the re-send BACKS OFF per run: stopResendMinMs (1 s) doubling, at most EDGE_SWEEP_RESEND_MAX_MS
    const listed = new Set(p.stopsUnconfirmed.map((s) => s.runId));
    // final fix wave (I-1) — a PARTIAL answer may omit a run whose picture could not be built: nothing is inferred from that
    if (!p.runStateUnavailable) for (const id of [...this.resentAt.keys()]) if (!listed.has(id)) this.resentAt.delete(id); // confirmed / window over
    for (const s of p.stopsUnconfirmed) {
      if (this.segments.has(s.runId)) continue;
      const st = this.resentAt.get(s.runId);
      if (st !== undefined && this.now() < st.next) continue;
      const n = (st?.n ?? 0) + 1;
      const base = Math.max(1, this.cfg.stopResendMinMs);
      this.resentAt.set(s.runId, { n, next: this.now() + Math.min(Math.max(base, EDGE_SWEEP_RESEND_MAX_MS), base * 2 ** Math.min(n - 1, 20)) });
      await this.resendStops(s.runId, s.picture);
      report.stopsResent.push(s.runId);
    }
    return { report, rest: [...deferred, ...all.filter((_, i) => !isStop(verified[i]))], answer: p, cycle, deferred };
  }

  /** final fix wave (M-8) — the deferred-STOP phase run while a work phase is busy (single-flight, bounded like the pull) */
  private deferring: Promise<void> | null = null;
  private deferringSince = 0;

  private workPhase(p: EdgePullAnswer, rest: unknown[], report: TickReport, cycle: number, deferred: unknown[] = []): Promise<void> {
    if (this.working) {
      // busy: this answer's non-STOP work waits for the next pull (STOPs went already) — but the STOPs the fast path DEFERRED
      // (target unknown until a refresh) run NOW, in this pull (M-8): a refresh made for THIS cycle, then those STOPs only
      return deferred.length === 0 ? Promise.resolve() : this.deferredStopPhase(deferred, report, cycle);
    }
    this.working = this.workOnce(p, rest, report, cycle, deferred)
      .catch((err) => console.error(`[EdgeExec] work phase failed: ${(err as Error)?.message ?? err}`))
      .finally(() => {
        this.working = null;
      });
    return this.working;
  }

  private deferredStopPhase(deferred: unknown[], report: TickReport, cycle: number): Promise<void> {
    if (this.deferring && Date.now() - this.deferringSince < 2 * this.cfg.requestTimeoutMs + 1_000) return this.deferring;
    const p = (async () => {
      this.forceRefresh = false;
      const r = await this.deps.config.refresh();
      if (r.ok) this.lastRefreshedCycle = Math.max(this.lastRefreshedCycle, cycle);
      else console.warn(`[EdgeExec] config refresh for deferred STOPs failed (${r.reason}) — they stay pending (re-delivered)`);
      report.commands.push(...(await this.handleCommands(deferred, cycle)));
    })()
      .catch((err) => console.error(`[EdgeExec] deferred STOP phase failed: ${(err as Error)?.message ?? err}`))
      .finally(() => {
        if (this.deferring === p) this.deferring = null;
      });
    this.deferring = p;
    this.deferringSince = Date.now();
    return p;
  }

  private async workOnce(p: EdgePullAnswer, rest: unknown[], report: TickReport, cycle: number, deferred: unknown[] = []): Promise<void> {
    const held = p.runStateUnavailable === true; // R-10-bs — only the deferred STOPs of this answer run; nothing else non-STOP
    const { client, config } = this.deps;
    // a newer config / keyset — or a STOP / command for a device this config does not know (F-1: the answer's version may be
    // a cached one) ⇒ fetch + verify NOW, before acting on anything else signed
    if (this.forceRefresh || p.configVersion > config.version() || p.keysetVersion > config.trust().version) {
      this.forceRefresh = false;
      const r = await config.refresh();
      if (r.ok) this.lastRefreshedCycle = Math.max(this.lastRefreshedCycle, cycle);
      if (!r.ok) console.warn(`[EdgeExec] config refresh failed (${r.reason}) — commands for devices it would name stay pending`);
    }
    this.refreshPending = this.lastRefreshedCycle !== cycle && (p.configVersion > config.version() || p.keysetVersion > config.trust().version);
    if (p.programCheckRequested) void this.deps.programChecks.report().catch(() => undefined);
    // non-STOP commands (lock / clear …), verified against the (possibly refreshed) trust — held while the run state is unavailable
    report.commands.push(...(await this.handleCommands(held ? deferred : rest, cycle)));
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
      if (c.stale && !held) {
        const r = await client.post("interrupted", { claimSeq: c.claimSeq }, { runId: c.runId });
        if (r.ok) report.interrupted.push(c.runId);
      }
    }
    // 5) claimable runs (none while central's run state is unavailable — R-10-bs)
    if (held) return;
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
    outcome: "done" | "refused" | "failed" | "expired" | "notOwnedHere",
    generation: number | null,
    acted: { target: { robotId: number } | { adapterId: number }; ownerEpoch: number; unsigned?: boolean },
  ): Promise<boolean> {
    const r = await this.deps.sink
      // R-10-z — stop-class: never dropped when the journal is full, bounded wait
      .event({ kind: "command_ack", requestId, outcome, generation, at: this.now(), target: acted.target, ownerEpoch: acted.ownerEpoch, ...(acted.unsigned ? { unsigned: true as const } : {}) }, { stop: true })
      .catch(() => ({ seq: null }));
    return r.seq !== null;
  }

  /**
   * F-3 / M-3 — central re-delivers a STOP until it holds its ack: a re-delivered STOP already executed here is RE-ACKED
   * (central's ack is idempotent) on a TIME back-off (2 s doubling, at most every 5 min) — never consumed by the pull cadence;
   * after EDGE_STOP_REACK_MAX re-sends, one anomaly (central keeps refusing / losing the ack), and the 5-min re-acks go on.
   */
  private async reack(sk: string, requestId: number, acted: { target: { robotId: number } | { adapterId: number }; ownerEpoch: number; unsigned?: boolean }): Promise<void> {
    const now = this.now();
    const st = this.reacks.get(sk) ?? { count: 0, next: 0, at: now };
    if (this.reacks.size > 5_000 && !this.reacks.has(sk)) this.reacks.delete(this.reacks.keys().next().value as string);
    if (now < st.next) return;
    st.count++;
    st.at = now;
    st.next = now + Math.min(EDGE_STOP_REACK_BACKOFF_MAX_MS, EDGE_STOP_REACK_BACKOFF_MS * 2 ** Math.min(st.count - 1, 20));
    this.reacks.set(sk, st);
    await this.ack(requestId, "done", null, acted);
    if (st.count === EDGE_STOP_REACK_MAX) {
      this.anomaly("EDGE_STOP_ACK_UNCONFIRMED", null, `STOP request ${requestId} (${JSON.stringify(acted.target)}) was executed here but central still re-delivers it after ${EDGE_STOP_REACK_MAX} acks — re-acked every ${EDGE_STOP_REACK_BACKOFF_MAX_MS / 60_000} min; check the request at central`);
    }
  }

  /**
   * M-2 — `notOwnedHere` (central's fallback executes it, R-10-ay): answered at most once per EDGE_NOT_OWNED_HERE_MIN_MS per
   * STOP request, one alert the first time.
   */
  private async answerNotOwnedHere(sk: string, requestId: number, ackWith: { target: { robotId: number } | { adapterId: number }; ownerEpoch: number; unsigned?: boolean }, tag: string, why: string): Promise<TickReport["commands"][number]> {
    const last = this.notOwnedSent.get(sk);
    if (last !== undefined && this.now() - last < EDGE_NOT_OWNED_HERE_MIN_MS) return { requestId, kind: "stop", outcome: `${tag}notOwnedHere:rate_limited` };
    if (last === undefined) this.anomaly("EDGE_STOP_NOT_OWNED_HERE", null, `STOP request ${requestId} (${JSON.stringify(ackWith.target)}): ${why} — answered notOwnedHere so central's fallback executes it`);
    // fix review 5 (nit) — the rate limit starts only once the ack is JOURNALED: a failed append is retried on the next delivery
    if (await this.ack(requestId, "notOwnedHere", null, ackWith)) this.notOwnedSent.set(sk, this.now());
    else return { requestId, kind: "stop", outcome: `${tag}notOwnedHere:ack_not_journaled` };
    return { requestId, kind: "stop", outcome: `${tag}notOwnedHere` };
  }

  /** M-3 — memories of STOPs that stopped arriving are pruned by age (bounded memory). */
  private pruneMemories(): void {
    const old = this.now() - EDGE_STOP_MEMORY_MAX_AGE_MS;
    for (const [k, v] of this.reacks) if (v.at < old) this.reacks.delete(k);
    for (const [k, t] of this.notOwnedSent) if (t < old) this.notOwnedSent.delete(k);
    for (const [k, t] of this.pendingSince) {
      if (t < old) {
        this.pendingSince.delete(k);
        this.pendingAlerted.delete(k);
      }
    }
  }

  /** F-1 — a STOP waiting for a verified refresh: an edge alert once it waited longer than the bound. */
  private notePending(sk: string, requestId: number): void {
    const since = this.pendingSince.get(sk) ?? this.now();
    this.pendingSince.set(sk, since);
    if (this.now() - since >= EDGE_STOP_PENDING_ALERT_MS && !this.pendingAlerted.has(sk)) {
      this.pendingAlerted.add(sk);
      this.anomaly("EDGE_STOP_TARGET_UNKNOWN", null, `STOP request ${requestId} names a device this node's verified config does not know, and no config refresh has succeeded for ${Math.round((this.now() - since) / 1000)} s — the STOP is still pending here`);
      console.error(`[EdgeExec] STOP request ${requestId}: target unknown and the config cannot be refreshed — still pending (alert raised)`);
    }
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

  private readonly ownerEpochOfTarget: EdgeOwnerEpochOf = (t) =>
    "robotId" in t ? (this.deps.config.robot(t.robotId)?.ownerEpoch ?? null) : (this.deps.config.adapter(t.adapterId)?.ownerEpoch ?? null);

  private ownerEpochOf(c: EdgeCommand): number | null {
    const cfg = this.deps.config;
    if (c.kind === "stop") return "robotId" in c.target ? (cfg.robot(c.target.robotId)?.ownerEpoch ?? null) : (cfg.adapter(c.target.adapterId)?.ownerEpoch ?? null);
    return cfg.robot(c.robotId)?.ownerEpoch ?? null;
  }

  /** `cycle`: the pull these commands came with (-1 = none: no refresh of its own ⇒ an unknown target stays pending) */
  async handleCommands(envs: readonly unknown[], cycle = -1): Promise<TickReport["commands"]> {
    if (envs.length === 0) return [];
    return this.handleVerified(verifyCommands(this.deps.config.trust(), envs, this.deps.config.credentialId()), cycle);
  }

  private async handleVerified(verified: readonly EdgeVerifiedCommand[], cycle = -1): Promise<TickReport["commands"]> {
    const out: TickReport["commands"] = [];
    // STOPs first (L-7): nothing else delays them
    const order = (v: EdgeVerifiedCommand) => ((v.ok ? v.command.kind : v.unverified?.kind) === "stop" ? 0 : 1);
    for (const v of [...verified].sort((a, b) => order(a) - order(b))) {
      try {
        out.push(await this.handleCommand(v, cycle));
      } catch (err) {
        console.error(`[EdgeExec] command handling failed: ${(err as Error)?.message ?? err}`);
      }
    }
    return out;
  }

  private stopKey(requestId: number, target: { robotId: number } | { adapterId: number }): string {
    return `${requestId}|${"robotId" in target ? `r${target.robotId}` : `a${target.adapterId}`}`;
  }
  private remember(set: Set<string>, key: string): void {
    set.add(key);
    if (set.size > 5_000) set.delete(set.values().next().value as string);
  }
  private owns(target: { robotId: number } | { adapterId: number }): boolean {
    return "robotId" in target ? this.deps.config.ownsRobot(target.robotId) : this.deps.config.ownsAdapter(target.adapterId);
  }

  private async handleCommand(v: EdgeVerifiedCommand, cycle = -1): Promise<TickReport["commands"][number]> {
    const refreshed = cycle >= 0 && this.lastRefreshedCycle === cycle;
    if (!v.ok && !(v.unsigned && v.unverified?.kind === "stop")) {
      const u = v.unverified;
      if (u?.kind === "stop") {
        // L-7: a STOP whose signature is missing / fails is still sent — as EVIDENCE only: to a device this node owns (its
        // VERIFIED config), reported with requestId null, NEVER acknowledged, and it never satisfies a later verified copy (S-1)
        this.anomaly("EDGE_COMMAND_INVALID", null, `stop command refused by verification (${v.reason}) request ${u.requestId} — STOP sent anyway as evidence (L-7)`);
        if (!this.owns(u.target)) {
          if (refreshed) return { requestId: null, kind: "stop", outcome: "unverified:not_owned" };
          this.forceRefresh = true;
          return { requestId: null, kind: "stop", outcome: "unverified:pending:not_yet_known" };
        }
        const key = this.stopKey(u.requestId, u.target);
        if (this.stopsEvidence.has(key)) return { requestId: null, kind: "stop", outcome: "duplicate" };
        const r = await this.stopTarget(u.target, "anomaly", null, `unverified STOP command (request ${u.requestId})`);
        if (r.outcome !== "failed") this.remember(this.stopsEvidence, key);
        return { requestId: null, kind: "stop", outcome: `unverified:${r.outcome}` };
      }
      this.anomaly("EDGE_COMMAND_INVALID", null, `${u?.kind ?? "unparsable"} command refused (${v.reason})${u ? ` request ${u.requestId}` : ""} — only a STOP acts without a valid signature`);
      return { requestId: null, kind: u?.kind ?? "unknown", outcome: `refused:${v.reason}` };
    }
    // a VERIFIED command, or the explicit unsigned-STOP envelope (R-10-k / R-10-p — acked, marked unsigned)
    const unsigned = !v.ok;
    const c = (v.ok ? v.command : v.unverified) as EdgeCommand;
    const tag = unsigned ? "unsigned:" : "";
    const remember = () => {
      this.handled.set(c.requestId, c.kind);
      if (this.handled.size > 2_000) this.handled.delete(this.handled.keys().next().value as number);
    };
    if (c.kind === "stop") {
      // a STOP goes even past its expiry / with a stale owner epoch (L-7, R-10-k: never discarded for its age); the device
      // must be this node's
      const sk = this.stopKey(c.requestId, c.target);
      const ackWith = { target: c.target, ownerEpoch: c.ownerEpoch, ...(unsigned ? { unsigned: true } : {}) };
      // F-3 — a signed copy is de-duplicated ONLY against a verified execution; an unsigned copy against either
      if (this.stopsVerified.has(sk) || (unsigned && this.stopsUnsigned.has(sk))) {
        await this.reack(sk, c.requestId, ackWith); // a lost / refused ack is re-sent on each re-delivery (bounded)
        return { requestId: c.requestId, kind: "stop", outcome: "duplicate" };
      }
      const sessionless = this.owns(c.target) && this.deps.hasSession !== undefined && !this.deps.hasSession(c.target);
      if (!this.owns(c.target) || sessionless) {
        // F-1 (R-10-au) — NEVER refused for ownership. Unknown here ⇒ a forced refresh, the STOP stays pending (an alert after
        // a bound); only a VERIFIED refresh of this cycle that still omits the device ⇒ ack `notOwnedHere` (central keeps it
        // pending and routes it to the current owner / its central fallback — never terminal)
        // F-2 leftover (R-10-az / R-10-ay) — owned, but this edge holds NO session for it (not attached): no executor here ⇒
        // notOwnedHere at once, so central's fallback executes it — never a STOP left to fail forever
        if (!refreshed && !sessionless) {
          this.forceRefresh = true;
          this.notePending(sk, c.requestId);
          return { requestId: c.requestId, kind: "stop", outcome: `${tag}pending:not_yet_known` };
        }
        this.pendingSince.delete(sk);
        return this.answerNotOwnedHere(sk, c.requestId, ackWith, tag, sessionless ? "owned but not attached on this edge (no session)" : "a verified refresh still does not list it");
      }
      this.pendingSince.delete(sk);
      // S-1 / F-3 — EXECUTED here, by THIS copy (even after an evidence or unsigned run); only then acknowledged
      const r = await this.stopTarget(c.target, "command", c.requestId, `${unsigned ? "unsigned " : ""}central STOP request ${c.requestId}${v.ok && v.expired ? " (overdue — sent anyway)" : ""}`);
      if (r.outcome === "failed") return { requestId: c.requestId, kind: "stop", outcome: `${tag}failed` }; // not acked: re-delivered, retried
      this.remember(unsigned ? this.stopsUnsigned : this.stopsVerified, sk);
      if (!unsigned) remember();
      await this.ack(c.requestId, "done", null, ackWith);
      return { requestId: c.requestId, kind: "stop", outcome: `${tag}${r.outcome}` };
    }
    if (!v.ok) return { requestId: null, kind: c.kind, outcome: "refused:unsigned" };
    const prior = this.handled.get(c.requestId);
    if (prior !== undefined) return { requestId: c.requestId, kind: c.kind, outcome: "duplicate" };
    const epoch = this.ownerEpochOf(c);
    const robotTarget = { robotId: c.robotId };
    if (epoch === null && !refreshed) {
      this.forceRefresh = true;
      return { requestId: c.requestId, kind: c.kind, outcome: "pending:not_yet_known" }; // F-1 — never refused before a verified refresh
    }
    // fix review 3 — a `clear` (raises energy) is never applied against a STALE config: it waits for the refresh
    if (c.kind === "clear" && this.refreshPending) return { requestId: c.requestId, kind: "clear", outcome: "pending:stale_config" };
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
        const r = await this.deps.walker.resendStops(v.picture, this.deps.sink, this.ownerEpochOfTarget);
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
      const target = s.kind === "robot" ? { robotId: s.robotId } : { adapterId: s.adapterId };
      const r = s.kind === "robot" ? await this.stopTarget(target, "local", null, why) : await this.stopTarget(target, "local", null, why, verifiedPins ? s.pins : null);
      if (r.outcome === "failed") failed++;
      else sent++;
      // R-10-bn (F1-4) — a VERIFIED picture's re-send is reported bound to it (central confirms the step's STOP from it)
      const sweep = v.ok ? edgeSweepStopRecord(v.picture, s.stepId, target, r.outcome === "failed" ? "failed" : r.outcome === "simulated" ? "simulated" : "completed", this.now(), this.ownerEpochOfTarget) : null;
      if (sweep) await this.deps.sink.event(sweep, { stop: true }).catch(() => undefined);
      else if (v.ok) this.anomaly("EDGE_SWEEP_STOP_UNBOUND", runId, `step ${s.stepId}: no owner epoch for ${JSON.stringify(target)} in the verified config — central cannot confirm this re-send`);
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
      // R-10-bs — while central's run state is unavailable, a non-STOP step is never authorised (held, D5); STOPs never ask
      authorize: {
        authorize: async (x) => (this.runStateHold ? { ok: false as const, verdict: "unavailable" as const, code: "run_state_unavailable", reason: "central's run state is unavailable (runStateUnavailable) — non-STOP step held" } : d.authorize.authorize(x)),
        nonceSentAt: (n) => d.authorize.nonceSentAt(n),
        isNoncePending: (n) => d.authorize.isNoncePending(n),
        settleNonce: (n) => d.authorize.settleNonce(n),
        pendingCount: () => d.authorize.pendingCount(),
      },
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
    // R-10-ag — only durable records ship: make the segment's records durable first; BOUNDED (fix review 2, N-3) — a hung disk
    // never wedges the work phase: the records stay un-durable, the segment end stays pending (retried), STOPs never wait here
    await Promise.race([
      this.deps.journal.flush(),
      new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), this.cfg.requestTimeoutMs);
        if (typeof t.unref === "function") t.unref();
      }),
    ]);
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
    resendStops: async (picture, sink, ownerEpochOf) => {
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
          // R-10-bn (F1-4) — bound to the VERIFIED picture: central confirms it as the step's STOP ledger row
          const res = rec.result as { status?: unknown; simulated?: unknown } | null;
          const simulated = res?.status === "simulated" || res?.simulated === true;
          const sweep = edgeSweepStopRecord(picture, s.stepId, target, rec.status === "completed" ? (simulated ? "simulated" : "completed") : "failed", rec.at, ownerEpochOf);
          if (sweep) await sink.event(sweep, { stop: true });
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
  console.log(`[EdgeExec] run execution started (pull every ${agent.pullIntervalNowMs()} ms — central's limits.pullMs, at most ${cfg.pullIntervalMs} ms; progress every ${cfg.progressMs} ms, at most ${cfg.maxConcurrent} runs)`);
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
