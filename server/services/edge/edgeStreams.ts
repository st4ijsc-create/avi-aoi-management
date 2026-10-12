/**
 * doc 81 Đợt 10 task E (design §2.2, §2.6, §2.7, §2.11) — how the edge's local records reach central:
 *
 *   • EdgeReportSink — THE port groups C (edge run store) and D (edge dispatchers, motion-lock persistence) write through:
 *     a run-stream record, an `events` record, a robot-state sample. Each is journaled first (edgeJournal: durable, with the
 *     STOP bound) and then shipped; nothing here ever waits on central.
 *   • EdgeJournalConsume — THE port D's edge dispatch uses for single use: `consumeAuthorization` (fsynced before the driver
 *     call), `isJtiConsumed`, `admitNonStop` (false when the journal is full / unhealthy — STOP never asks).
 *   • EdgeStreamShipper — sends every stream's un-acknowledged records in order, from the cursor (`(epoch, stream, seq)`):
 *     `run:*` → POST runs/:id/report (needs the claim token, kept in memory only), `events` → POST locks/events,
 *     `robot_state` → POST robots/state. A duplicate is acknowledged, a gap is resent from central's expectedSeq. A run stream
 *     that can no longer be reported (claim token lost on restart — tokens are never journaled — or central no longer knows the
 *     claim) is converted into `events` evidence: its STOP results become `stop` events, the rest one anomaly.
 *   • edgeTelemetryPersistFn — the telemetryBus insert-function seam on the edge (D12): canonical rows → POST telemetry;
 *     a transport failure THROWS so the storeForward WAL buffers the rows and replays them through the same function.
 *   • Motion-lock helpers (for D's robotManager / robotMotionLockStore on the edge): the persistence hooks that turn the
 *     authority's in-memory MotionLock transitions into `lock` events, and the boot seed (journal ⊕ config row ⊕ floor —
 *     never backwards; unknown ⇒ locked persistUnknown).
 *   • EdgeProgramChecks — reads the program checksum of the node's capable adapters (D7) at most every programReportMs and on
 *     request; central uses them at approval and in /authorize, the claim and every /authorize carry the latest.
 */
import type { InsertOtTelemetry } from "../../../drizzle/schema/ot";
import { MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, type MotionLockPersistence, type MotionLockState, type RobotState } from "../robot/robotDriver";
import type { EdgeCentralClient } from "./edgeCentralClient";
import type { EdgeConfigRobot, EdgeConfigSource } from "./edgeConfigSource";
import type { EdgeAppendResult, EdgeConsumeResult, EdgeEventRecordInput, EdgeJournal, EdgeRobotStateInput, EdgeRunRecordInput } from "./edgeJournal";
import {
  EDGE_REPORT_BATCH_MAX,
  EDGE_STREAM_EVENTS,
  EDGE_STREAM_ROBOT_STATE,
  EDGE_TELEMETRY_BATCH_MAX,
  edgeRunStream,
  parseEdgeStream,
  type EdgeEventRecord,
  type EdgeProgramCheck,
  type EdgeRobotStateRecord,
  type EdgeRunReportRecord,
  type EdgeTelemetrySample,
} from "./edgeProtocol";

// ── ports for groups C and D ────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeReportSink {
  /** step / context / abort_stop / ledger of a claimed run; `{stop:true}` ⇒ bounded by the STOP bound (L-7) */
  run(runId: number, claimSeq: number, rec: EdgeRunRecordInput, opts?: { stop?: boolean }): Promise<EdgeAppendResult>;
  /** lock / stop / refusal / anomaly / command_ack; a `stop` record is always bounded */
  event(rec: EdgeEventRecordInput, opts?: { stop?: boolean }): Promise<EdgeAppendResult>;
  /** a robot state sample of an OWNED robot (dropped, counted, while the journal is full) */
  robotState(rec: EdgeRobotStateInput): Promise<EdgeAppendResult>;
}
export interface EdgeJournalConsume {
  consumeAuthorization(c: { jti: string; runId: number; claimSeq: number; stepId: string; attempt: number }): Promise<EdgeConsumeResult>;
  isJtiConsumed(jti: string): boolean;
  admitNonStop(): boolean;
}

export function createEdgeJournalConsume(journal: EdgeJournal): EdgeJournalConsume {
  return {
    consumeAuthorization: (c) => journal.consumeAuthorization(c),
    isJtiConsumed: (jti) => journal.isJtiConsumed(jti),
    admitNonStop: () => journal.admitNonStop(),
  };
}

/** The sink: journal first, then a (non-awaited) nudge of the shipper. */
export function createEdgeReportSink(journal: EdgeJournal, nudge?: (stream: string) => void): EdgeReportSink {
  const kick = (stream: string) => {
    try {
      nudge?.(stream);
    } catch {
      /* shipping is best-effort; the journal holds the record */
    }
  };
  return {
    run: async (runId, claimSeq, rec, opts) => {
      const r = await journal.appendRun(runId, claimSeq, rec, opts);
      if (r.seq !== null) kick(edgeRunStream(runId, claimSeq));
      return r;
    },
    event: async (rec, opts) => {
      const r = await journal.appendEvent(rec, opts);
      if (r.seq !== null) kick(EDGE_STREAM_EVENTS);
      return r;
    },
    robotState: async (rec) => {
      const r = await journal.appendRobotState(rec);
      if (r.seq !== null) kick(EDGE_STREAM_ROBOT_STATE);
      return r;
    },
  };
}

// ── shipper ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EdgeFlushResult = "ok" | "unavailable" | "no_token" | "claim_gone" | "refused";

export class EdgeStreamShipper {
  private readonly tokens = new Map<string, { claimSeq: number; claimToken: string }>();
  private readonly inflight = new Map<string, Promise<EdgeFlushResult>>();
  private timer: NodeJS.Timeout | null = null;
  private readonly log: (m: string) => void;
  private readonly warned = new Set<string>();

  constructor(
    private readonly journal: EdgeJournal,
    private readonly client: EdgeCentralClient,
    opts: { log?: (m: string) => void } = {},
  ) {
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /** The claim of a run stream (memory only — a restart forgets it, by design). */
  setClaim(runId: number, claimSeq: number, claimToken: string): void {
    this.tokens.set(edgeRunStream(runId, claimSeq), { claimSeq, claimToken });
  }
  forgetClaim(runId: number, claimSeq: number): void {
    this.tokens.delete(edgeRunStream(runId, claimSeq));
  }
  hasClaim(stream: string): boolean {
    return this.tokens.has(stream);
  }

  nudge(stream: string): void {
    void this.flush(stream).catch(() => undefined);
  }

  /** Ship every stream with pending records (tokens known); never throws. */
  async flushAll(): Promise<Record<string, EdgeFlushResult>> {
    const out: Record<string, EdgeFlushResult> = {};
    for (const s of this.journal.streamsWithPending()) {
      if (parseEdgeStream(s)?.kind === "run" && !this.tokens.has(s)) continue;
      out[s] = await this.flush(s);
    }
    return out;
  }

  /** Ship one stream until nothing is pending (serialised per stream). */
  flush(stream: string): Promise<EdgeFlushResult> {
    const prev = this.inflight.get(stream) ?? Promise.resolve("ok" as EdgeFlushResult);
    const p: Promise<EdgeFlushResult> = prev.catch(() => "refused" as EdgeFlushResult).then(() => this.flushOnce(stream));
    this.inflight.set(stream, p);
    void p.finally(() => {
      if (this.inflight.get(stream) === p) this.inflight.delete(stream);
    }).catch(() => undefined);
    return p;
  }

  private async flushOnce(stream: string): Promise<EdgeFlushResult> {
    const parsed = parseEdgeStream(stream);
    if (!parsed) return "refused";
    for (let guard = 0; guard < 10_000; guard++) {
      const batch = this.journal.pending(stream, EDGE_REPORT_BATCH_MAX);
      if (batch.length === 0) return "ok";
      const epoch = this.journal.epoch;
      const lastSent = batch[batch.length - 1].seq;
      let r;
      if (parsed.kind === "run") {
        const tok = this.tokens.get(stream);
        if (!tok) return "no_token";
        r = await this.client.post(
          "report",
          { claimSeq: tok.claimSeq, claimToken: tok.claimToken, epoch, stream, records: batch.map((b) => b.record as EdgeRunReportRecord) },
          { runId: parsed.runId },
        );
      } else if (parsed.kind === "events") {
        r = await this.client.post("locksEvents", { epoch, stream: EDGE_STREAM_EVENTS, records: batch.map((b) => b.record as EdgeEventRecord) });
      } else {
        r = await this.client.post("robotsState", { epoch, stream: EDGE_STREAM_ROBOT_STATE, records: batch.map((b) => b.record as EdgeRobotStateRecord) });
      }
      if (r.ok) {
        const before = this.journal.ackedSeq(stream);
        this.journal.ack(stream, Math.min(r.data.ackedSeq, lastSent));
        if (this.journal.ackedSeq(stream) <= before) {
          this.warnOnce(stream, `[EdgeStreams] ${stream}: central acknowledged nothing new (ackedSeq ${r.data.ackedSeq}) — retried later`);
          return "refused";
        }
        continue;
      }
      if (r.unavailable) return "unavailable";
      const data = (r.data ?? {}) as { expectedSeq?: unknown };
      if (r.code === "gap" && typeof data.expectedSeq === "number") {
        const acked = this.journal.ackedSeq(stream);
        if (data.expectedSeq > acked + 1) {
          this.journal.ack(stream, data.expectedSeq - 1); // central already holds them
          continue;
        }
        this.warnOnce(stream, `[EdgeStreams] ${stream}: central expects seq ${data.expectedSeq} but this journal already dropped it (acked ${acked}) — stream stuck, see EDGE anomaly`);
        return "refused";
      }
      if (parsed.kind === "run" && (r.code === "claim_stale" || r.code === "not_found" || r.status === 404)) return "claim_gone";
      if (parsed.kind === "events") {
        // R-10-o — a refused events batch may hold command acks: every STOP it acknowledges was EXECUTED and stays done
        // locally; the batch is kept and retried, and the refusal is an anomaly an operator must see
        console.error(`[EdgeStreams] ANOMALY: central refused the events stream (${r.code ?? r.status}) — acks / STOP evidence kept in the journal and retried; executed STOPs stay done`);
      }
      this.warnOnce(stream, `[EdgeStreams] ${stream}: central refused the report (${r.code ?? r.status}) — kept in the journal, retried later`);
      return "refused";
    }
    return "refused";
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(`${key}|${msg}`)) return;
    this.warned.add(`${key}|${msg}`);
    this.log(msg);
  }

  /**
   * A run stream that cannot be reported any more (no claim token after a restart, or central no longer knows the claim):
   * its STOP results become `stop` events (evidence central records without a claim), the rest one anomaly; then the stream
   * is acknowledged locally. Returns the number of records converted.
   */
  async orphanRunStream(stream: string, why: string): Promise<number> {
    const parsed = parseEdgeStream(stream);
    if (parsed?.kind !== "run") return 0;
    const recs = this.journal.pending(stream);
    if (recs.length === 0) return 0;
    const kinds = new Map<string, number>();
    for (const e of recs) {
      const r = e.record as EdgeRunReportRecord;
      kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
      if (r.kind === "ledger" && r.stop) {
        const target = "robotId" in r.target ? { robotId: r.target.robotId } : { adapterId: r.target.adapterId };
        await this.journal.appendEvent(
          { kind: "stop", target, source: "local", requestId: null, outcome: /fail/i.test(r.status) ? "failed" : r.status === "simulated" ? "simulated" : "sent", at: r.at, detail: `run ${parsed.runId} step ${r.stepId} (${why})`.slice(0, 500) },
          { stop: true },
        );
      }
    }
    const summary = [...kinds.entries()].map(([k, n]) => `${k}=${n}`).join(", ");
    await this.journal.appendEvent({ kind: "anomaly", code: "EDGE_RUN_REPORT_ORPHANED", runId: parsed.runId, detail: `claim ${parsed.claimSeq}: ${recs.length} record(s) not reported (${summary}) — ${why}`.slice(0, 1_000), at: Date.now() });
    this.journal.ack(stream, recs[recs.length - 1].seq);
    this.tokens.delete(stream);
    this.nudge(EDGE_STREAM_EVENTS);
    return recs.length;
  }

  /** Boot: every pending run stream has lost its claim token (never journaled) ⇒ evidence events. */
  async orphanUntokened(why: string): Promise<number> {
    let n = 0;
    for (const s of this.journal.streamsWithPending()) if (parseEdgeStream(s)?.kind === "run" && !this.tokens.has(s)) n += await this.orphanRunStream(s, why);
    return n;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flushAll().catch(() => undefined), Math.max(200, intervalMs));
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.inflight.values()]);
  }
}

// ── telemetry (the telemetryBus insert-function seam on the edge) ───────────────────────────────────────────────────

export class EdgeCentralUnavailableError extends Error {
  constructor(what: string) {
    super(`central unreachable (${what}) — buffered`);
    this.name = "EdgeCentralUnavailableError";
  }
}

/** Canonical ot_telemetry rows → protocol samples (only rows of an OT adapter: meta.adapterId). */
export function telemetryRowsToSamples(rows: InsertOtTelemetry[]): { samples: EdgeTelemetrySample[]; skipped: number } {
  const samples: EdgeTelemetrySample[] = [];
  let skipped = 0;
  for (const row of rows) {
    const meta = (row.meta ?? null) as { adapterId?: unknown; tagKey?: unknown } | null;
    const adapterId = typeof meta?.adapterId === "number" && Number.isSafeInteger(meta.adapterId) && meta.adapterId > 0 ? meta.adapterId : null;
    const tagKey = typeof meta?.tagKey === "string" && meta.tagKey ? meta.tagKey : typeof row.metric === "string" ? row.metric : "";
    if (adapterId === null || !tagKey || tagKey.length > 128) {
      skipped++;
      continue;
    }
    const ts = row.ts instanceof Date && Number.isFinite(row.ts.getTime()) ? row.ts.getTime() : null;
    const value =
      typeof row.numValue === "number" && Number.isFinite(row.numValue)
        ? row.numValue
        : typeof row.boolValue === "boolean"
          ? row.boolValue
          : typeof row.textValue === "string"
            ? row.textValue.slice(0, 1_000)
            : null;
    const quality = row.quality === "good" || row.quality === "bad" || row.quality === "uncertain" ? row.quality : undefined;
    samples.push({
      adapterId,
      tagKey,
      ts,
      ...(ts === null ? { tsSource: "server" as const } : {}),
      value,
      ...(quality ? { quality } : {}),
      ...(typeof row.unit === "string" && row.unit.length <= 50 ? { unit: row.unit } : {}),
    });
  }
  return { samples, skipped };
}

/**
 * The insert function the edge sets on telemetryBus (setTelemetryPersistFn). Returns the rows handled (accepted, or refused
 * by central for ownership / content — counted and logged, never retried in a loop); THROWS when central cannot be reached so
 * the rows are buffered by storeForward.
 */
export function edgeTelemetryPersistFn(client: EdgeCentralClient, log: (m: string) => void = (m) => console.warn(m)): (rows: InsertOtTelemetry[]) => Promise<number> {
  let refusedTotal = 0;
  return async (rows) => {
    const { samples, skipped } = telemetryRowsToSamples(rows);
    if (skipped > 0) log(`[EdgeStreams] ${skipped} telemetry row(s) without an OT adapter id not sent (edge ingests only its own adapters)`);
    for (let i = 0; i < samples.length; i += EDGE_TELEMETRY_BATCH_MAX) {
      const r = await client.post("telemetry", { samples: samples.slice(i, i + EDGE_TELEMETRY_BATCH_MAX) });
      if (!r.ok) {
        if (r.unavailable) throw new EdgeCentralUnavailableError(r.code ?? `HTTP ${r.status || "network"}`);
        log(`[EdgeStreams] central refused a telemetry batch (${r.code ?? r.status}) — ${Math.min(EDGE_TELEMETRY_BATCH_MAX, samples.length - i)} sample(s) dropped`);
        continue;
      }
      if (r.data.refused > 0) {
        refusedTotal += r.data.refused;
        log(`[EdgeStreams] central refused ${r.data.refused} telemetry sample(s) (not owned by this node?) — ${refusedTotal} so far`);
      }
    }
    return rows.length;
  };
}

// ── motion lock (for D: the edge is the lock authority of its robots, design §2.11) ─────────────────────────────────

const isoMs = (s: string | undefined, fallback: number) => {
  const t = s ? Date.parse(s) : Number.NaN;
  return Number.isFinite(t) && t >= 0 ? Math.trunc(t) : fallback;
};

/** MotionLock persistence hooks on the edge: every transition becomes a `lock` event (journal → central mirror). */
export function edgeMotionLockPersistence(sink: EdgeReportSink, robotId: number, ownerEpoch: () => number): MotionLockPersistence {
  const emit = (event: "locked" | "cleared", s: MotionLockState) => {
    const generation = typeof s.generation === "number" && s.generation > 0 ? s.generation : null;
    if (generation === null) return;
    void sink.event(
      {
        kind: "lock",
        robotId,
        event,
        generation,
        ownerEpoch: ownerEpoch(),
        reasonCode: String(s.reasonCode ?? "unknown").slice(0, 64) || "unknown",
        since: isoMs(s.since, Date.now()),
        clearedBy: event === "cleared" ? (s.clearedBy === "operator" ? "operator" : "stop") : null,
        requestId: null,
      },
      { stop: event === "cleared" && s.clearedBy !== "operator" },
    );
  };
  return { locked: (s) => emit("locked", s), cleared: (s) => emit("cleared", s) };
}

export interface EdgeMotionLockSeed {
  /** start LOCKED with this (MotionLock.restore), or null = start clear */
  locked: null | { reasonCode: string; since: string; generation: number; detail: string };
  /** the generation the robot's MotionLock must not go below (journal ⊕ config row ⊕ floor) */
  generationBase: number;
  source: "journal" | "config" | "unknown" | "ownerChanged" | "clear";
}

/**
 * Boot state of an owned robot's motion lock: never backwards (max of journal, the config's mirrored row and the
 * ownership floor). Journal unknown (fresh / reset) ⇒ locked persistUnknown above every known generation (fail-closed).
 * A journal of an older owner epoch ⇒ locked ownerChanged.
 */
export function edgeMotionLockSeed(journal: Pick<EdgeJournal, "motionLock">, robot: EdgeConfigRobot, nowMs = Date.now()): EdgeMotionLockSeed {
  const j = journal.motionLock(robot.id);
  const rowGen = robot.motionLock?.generation ?? 0;
  const jGen = j.kind === "unknown" ? 0 : j.generation;
  const base = Math.max(rowGen, jGen, robot.motionLockGenerationFloor);
  const since = new Date(nowMs).toISOString();
  if (j.kind === "unknown") {
    return { locked: { reasonCode: MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, since, generation: base + 1, detail: "edge journal has no state for this robot (fresh / reset) — fail-closed" }, generationBase: base + 1, source: "unknown" };
  }
  if (j.ownerEpoch !== robot.ownerEpoch) {
    return { locked: { reasonCode: "ownerChanged", since, generation: base + 1, detail: `owner epoch ${j.ownerEpoch} → ${robot.ownerEpoch}` }, generationBase: base + 1, source: "ownerChanged" };
  }
  if (robot.motionLock && robot.motionLock.generation > jGen) {
    return { locked: { reasonCode: robot.motionLock.reasonCode, since: new Date(robot.motionLock.lockedAt).toISOString(), generation: base, detail: "mirrored lock row newer than the journal" }, generationBase: base, source: "config" };
  }
  if (j.kind === "locked") {
    return { locked: { reasonCode: j.reasonCode, since: new Date(j.since).toISOString(), generation: base, detail: "restored from the edge journal" }, generationBase: base, source: "journal" };
  }
  return { locked: null, generationBase: base, source: "clear" };
}

/** A driver RobotState → the protocol record (no trust field exists: e-stop transitions are derived centrally, D6). */
export function robotStateToRecord(robotId: number, st: RobotState): EdgeRobotStateInput {
  const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const ts = st.timestamp instanceof Date && Number.isFinite(st.timestamp.getTime()) ? st.timestamp.getTime() : Date.now();
  const pose = st.pose
    ? {
        ...(Array.isArray(st.pose.joints) && st.pose.joints.every(fin) ? { joints: st.pose.joints.slice(0, 32) } : {}),
        ...(st.pose.cartesian && fin(st.pose.cartesian.x) && fin(st.pose.cartesian.y) && fin(st.pose.cartesian.z)
          ? {
              cartesian: {
                x: st.pose.cartesian.x,
                y: st.pose.cartesian.y,
                z: st.pose.cartesian.z,
                ...(fin(st.pose.cartesian.rx) ? { rx: st.pose.cartesian.rx } : {}),
                ...(fin(st.pose.cartesian.ry) ? { ry: st.pose.cartesian.ry } : {}),
                ...(fin(st.pose.cartesian.rz) ? { rz: st.pose.cartesian.rz } : {}),
              },
            }
          : {}),
        ...(typeof st.pose.frame === "string" ? { frame: st.pose.frame.slice(0, 64) } : {}),
      }
    : undefined;
  return {
    robotId,
    ts,
    ...(typeof st.mode === "string" ? { mode: st.mode.slice(0, 32) } : {}),
    ...(typeof st.busy === "boolean" ? { busy: st.busy } : {}),
    ...(typeof st.estop === "boolean" ? { estop: st.estop } : {}),
    ...(pose ? { pose } : {}),
    ...(fin(st.payloadKg) ? { payloadKg: st.payloadKg } : {}),
    ...(fin(st.speedPct) ? { speedPct: st.speedPct } : {}),
    ...(typeof st.error === "string" ? { error: st.error.slice(0, 1_000) } : {}),
    ...(fin(st.batteryPct) ? { batteryPct: st.batteryPct } : {}),
    ...(Array.isArray(st.jointStates) ? { jointStates: st.jointStates.slice(0, 32) } : {}),
    ...(typeof st.safetyZoneId === "number" && Number.isSafeInteger(st.safetyZoneId) && st.safetyZoneId > 0 ? { safetyZoneId: st.safetyZoneId } : {}),
    ...(typeof st.firmwareVersion === "string" ? { firmwareVersion: st.firmwareVersion.slice(0, 64) } : {}),
  };
}

// ── program checks (D7) ─────────────────────────────────────────────────────────────────────────────────────────────

export interface EdgeProgramChecksOptions {
  config: EdgeConfigSource;
  client: EdgeCentralClient;
  /** default: programChecksum.readAdapterProgramCheck (reads this process's own drivers) */
  read?: (row: { id: number; code: string; protocol: string; connectionOptions: unknown }) => Promise<{ status: "verified" | "unsupported" | "unreadable"; checksum?: string; reason?: string; source?: string }>;
  now?: () => number;
}

export class EdgeProgramChecks {
  private readings: EdgeProgramCheck[] = [];
  private running: Promise<EdgeProgramCheck[]> | null = null;
  constructor(private readonly opts: EdgeProgramChecksOptions) {}

  latest(): EdgeProgramCheck[] {
    return [...this.readings];
  }

  /** Read every owned adapter now (single-flight). */
  readNow(): Promise<EdgeProgramCheck[]> {
    if (this.running) return this.running;
    this.running = this.readOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async readOnce(): Promise<EdgeProgramCheck[]> {
    const cfg = this.opts.config.current();
    if (!cfg) return this.latest();
    const read = this.opts.read ?? (async (row) => (await import("../ot/programChecksum")).readAdapterProgramCheck(row));
    const now = this.opts.now ?? Date.now;
    const out: EdgeProgramCheck[] = [];
    for (const a of cfg.adapters.slice(0, 256)) {
      try {
        const c = await read({ id: a.id, code: a.code, protocol: a.protocol, connectionOptions: a.connectionOptions });
        const base = { adapterId: a.id, readAt: Math.trunc(now()), ...(c.source ? { source: String(c.source).slice(0, 32) } : {}) };
        if (c.status === "verified" && typeof c.checksum === "string") out.push({ ...base, status: "verified", checksum: c.checksum.slice(0, 256) });
        else if (c.status === "unsupported") out.push({ ...base, status: "unsupported" });
        else {
          const reason = (["notConnected", "timeout", "error", "invalid", "inconsistent"] as const).find((x) => x === c.reason) ?? "error";
          out.push({ ...base, status: "unreadable", reason });
        }
      } catch {
        out.push({ adapterId: a.id, readAt: Math.trunc(now()), status: "unreadable", reason: "error" });
      }
    }
    this.readings = out;
    return this.latest();
  }

  /** Read and POST program-checks (no-op without owned adapters). */
  async report(): Promise<boolean> {
    const readings = await this.readNow();
    if (readings.length === 0) return true;
    const r = await this.opts.client.post("programChecks", { readings });
    return r.ok;
  }
}
