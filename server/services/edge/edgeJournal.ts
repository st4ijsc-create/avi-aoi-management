/**
 * doc 81 Đợt 10 task E (design §2.2, D3) — the EDGE JOURNAL: the edge's only durable local state now that it has no central
 * DB login. Append-only JSONL segments (the storeForward idiom, no native dependency — Node 20) plus an atomically renamed
 * `state.json` snapshot, under EDGE_JOURNAL_DIR (a compose volume).
 *
 * RECORDS. Every line is `{e: epoch, s: stream, q: seq, k: kind, t: at, d: data, h: checksum}`:
 *   • epoch — 128-bit random, created with a new journal (a reset opens a new one; central accepts a new epoch only from seq 1);
 *   • streams — `run:<runId>:<claimSeq>` (step / context / abort_stop / ledger → POST runs/:id/report), `events` (lock / stop /
 *     refusal / anomaly / command_ack → POST locks/events), `robot_state` (→ POST robots/state), and the LOCAL stream `auth`
 *     (`auth.consumed` write-ahead of a single-use authorisation; never reported). OT telemetry is NOT here: it reuses the
 *     storeForward WAL with the HTTP insert function (telemetryBus seam);
 *   • seq — strictly increasing per (epoch, stream), starting at 1; never reused (restart, compaction).
 *
 * DURABILITY CLASSES.
 *   • `auth.consumed` — fsynced BEFORE consumeAuthorization() resolves (the caller sends to the driver only after). The jti is
 *     marked consumed in memory at once (a concurrent second use is refused). A sync that fails / overruns ⇒ io_error ⇒ the
 *     non-STOP step is not sent (fail-closed) and the jti stays consumed.
 *   • step / context / ledger / lock / stop / refusal / anomaly / ack records — group commit (one fsync per window, default
 *     50 ms). With `{stop: true}` the wait is bounded by STOP_DB_STEP_DEADLINE_MS (the same bound as today's bounded STOP DB
 *     write): a STOP never waits on the disk beyond it (L-7) — the record still sits in memory for the report.
 *   • robot_state — group commit; DROPPED (counted) while the journal is full or unhealthy (telemetry-like).
 *
 * BOUNDS. `maxBytes` (config limits.journalMaxBytes): when the bytes on disk + queued reach it the journal is FULL —
 * admitNonStop() is false and auth.consumed is refused (no new non-STOP actuation), robot_state is dropped; STOP, step, lock and
 * every other record is still written (never dropped). Compaction (segment size, or explicitly) rewrites only the records central
 * has not acknowledged, then the snapshot, then deletes the old segments — a crash at any point leaves a readable journal
 * (duplicate lines of an interrupted compaction are identical and skipped).
 *
 * STARTUP. A truncated LAST line of the last segment (no trailing newline: a torn append) is ignored and cut off (never
 * glued to the next record). Anything else unreadable — the snapshot, a line in the middle, segments without a snapshot — RESETS the journal: the
 * old files are moved aside (`reset-<ts>/`, evidence), a new epoch is opened, every robot's lock state is `unknown` (the caller
 * starts it locked `persistUnknown`, robotMotionLockStore's fail-closed rule) and an EDGE_JOURNAL_RESET anomaly is reported.
 * Claim tokens are never journaled (a restart declares the claim interrupted). Never throws after open().
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../ot/storeForward";
import { STOP_DB_STEP_DEADLINE_MS } from "../robot/stopJob";
import {
  EDGE_AUTH_TTL_MAX_MS,
  EDGE_EPOCH_RE,
  EDGE_STREAM_EVENTS,
  EDGE_STREAM_RE,
  EDGE_STREAM_ROBOT_STATE,
  edgeEventRecordSchema,
  edgeRobotStateRecordSchema,
  edgeRunReportRecordSchema,
  edgeRunStream,
  newEdgeEpoch,
  type EdgeEventRecord,
  type EdgeRobotStateRecord,
  type EdgeRunReportRecord,
} from "./edgeProtocol";

// ── IO seam (tests observe write / sync ordering) ───────────────────────────────────────────────────────────────────

export interface EdgeJournalFile {
  write(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface EdgeJournalIo {
  mkdir(dir: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  /** rejects with code ENOENT when absent */
  readFile(file: string): Promise<string>;
  openAppend(file: string): Promise<EdgeJournalFile>;
  writeFileAtomic(file: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
  truncate(file: string, len: number): Promise<void>;
}
export const nodeEdgeJournalIo: EdgeJournalIo = Object.freeze({
  mkdir: async (dir: string) => {
    await fs.mkdir(dir, { recursive: true });
  },
  readdir: (dir: string) => fs.readdir(dir),
  readFile: (file: string) => fs.readFile(file, "utf8"),
  openAppend: async (file: string): Promise<EdgeJournalFile> => {
    const fh = await fs.open(file, "a");
    return {
      write: async (data: string) => {
        await fh.write(data);
      },
      sync: () => fh.sync(),
      close: () => fh.close(),
    };
  },
  writeFileAtomic: (file: string, data: string) => writeFileAtomic(file, data),
  rename: (a: string, b: string) => fs.rename(a, b),
  unlink: (f: string) => fs.unlink(f),
  truncate: (f: string, len: number) => fs.truncate(f, len),
});

// ── types ───────────────────────────────────────────────────────────────────────────────────────────────────────────

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type EdgeRunRecordInput = DistributiveOmit<EdgeRunReportRecord, "seq">;
export type EdgeEventRecordInput = DistributiveOmit<EdgeEventRecord, "seq">;
export type EdgeRobotStateInput = Omit<EdgeRobotStateRecord, "seq">;
export type EdgeReportableRecord = EdgeRunReportRecord | EdgeEventRecord | EdgeRobotStateRecord;

export interface EdgeJournalEntry<R = EdgeReportableRecord> {
  epoch: string;
  stream: string;
  seq: number;
  /** the protocol record, `seq` included — exactly what the stream route takes */
  record: R;
}
export type EdgeAppendResult = { seq: number; durable: boolean } | { seq: null; dropped: true; reason: "journal_full" | "unhealthy" | "invalid" | "closed" };
export type EdgeConsumeResult = { ok: true } | { ok: false; reason: "journal_full" | "jti_consumed" | "io_error" | "closed" };
export type EdgeJournalLockState =
  | { kind: "unknown" }
  | { kind: "locked"; generation: number; reasonCode: string; ownerEpoch: number; since: number }
  | { kind: "clear"; generation: number; ownerEpoch: number };
export interface EdgeJournalOpened {
  kind: "fresh" | "restored" | "reset";
  /** a torn last line was ignored and cut off */
  truncatedTail: boolean;
  reset: null | { reason: string; previousEpoch: string | null };
}
export interface EdgeJournalStats {
  epoch: string;
  /** reportable records not yet acknowledged by central */
  backlog: number;
  bytes: number;
  maxBytes: number;
  full: boolean;
  healthy: boolean;
  droppedRobotStates: number;
  opened: EdgeJournalOpened["kind"];
}
export interface EdgeJournalOptions {
  dir: string;
  /** default 64 MiB; config limits.journalMaxBytes */
  maxBytes?: number;
  /** compaction trigger (active segment bytes), default 4 MiB */
  segmentMaxBytes?: number;
  /** group-commit window, default 50 ms */
  groupCommitMs?: number;
  /** the STOP bound, default STOP_DB_STEP_DEADLINE_MS */
  stopBoundMs?: number;
  /** auth.consumed fsync bound (a hung disk ⇒ io_error), default 5 s */
  authSyncTimeoutMs?: number;
  /** consumed jtis are kept at least this long, default 2 × EDGE_AUTH_TTL_MAX_MS */
  jtiRetentionMs?: number;
  now?: () => number;
  io?: EdgeJournalIo;
  log?: (msg: string) => void;
}

export const EDGE_JOURNAL_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const EDGE_JOURNAL_STATE_FILE = "state.json";
export const EDGE_JOURNAL_AUTH_STREAM = "auth";
export const EDGE_JOURNAL_RESET_CODE = "EDGE_JOURNAL_RESET";
const SEG_RE = /^seg-([0-9a-f]{32})-(\d{6})\.jsonl$/;
const segName = (epoch: string, n: number) => `seg-${epoch}-${String(n).padStart(6, "0")}.jsonl`;

// ── snapshot ────────────────────────────────────────────────────────────────────────────────────────────────────────

const zPosInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.strictObject({
  v: z.literal(1),
  epoch: z.string().regex(EDGE_EPOCH_RE),
  firstSegment: z.number().int().positive().max(999_999),
  streams: z.record(z.string(), z.strictObject({ nextSeq: z.number().int().positive(), ackedSeq: zPosInt })),
  jtis: z.array(z.tuple([z.string().min(1).max(64), zPosInt])),
  locks: z.record(
    z.string().regex(/^[1-9][0-9]*$/),
    z.strictObject({ state: z.enum(["locked", "cleared"]), generation: zPosInt, reasonCode: z.string().max(64), ownerEpoch: zPosInt, since: zPosInt }),
  ),
  configHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  savedAt: zPosInt,
});
type Snapshot = z.infer<typeof snapshotSchema>;
type LockRow = Snapshot["locks"][string];

interface Line {
  e: string;
  s: string;
  q: number;
  k: string;
  t: number;
  d: unknown;
  h: string;
}
function checksum(e: string, s: string, q: number, k: string, t: number, d: unknown): string {
  return createHash("sha256").update(JSON.stringify([e, s, q, k, t, d]), "utf8").digest("hex").slice(0, 16);
}
function parseLine(text: string): Line | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const l = v as Line;
  if (typeof l.e !== "string" || typeof l.s !== "string" || !Number.isSafeInteger(l.q) || l.q <= 0 || typeof l.k !== "string" || !Number.isSafeInteger(l.t) || typeof l.h !== "string") return null;
  if (checksum(l.e, l.s, l.q, l.k, l.t, l.d) !== l.h) return null;
  return l;
}

interface Pending {
  seq: number;
  kind: string;
  at: number;
  data: unknown;
  line: string;
  written: boolean;
}
interface StreamState {
  nextSeq: number;
  ackedSeq: number;
  pending: Pending[];
}

class JournalCorrupt extends Error {}

export class EdgeJournal {
  private epochValue = "";
  private openedValue: EdgeJournalOpened = { kind: "fresh", truncatedTail: false, reset: null };
  private readonly streams = new Map<string, StreamState>();
  private readonly jtis = new Map<string, number>();
  private readonly locks = new Map<number, LockRow>();
  private configHashValue: string | null = null;
  private firstSegment = 1;
  private activeSegment = 1;
  private fh: EdgeJournalFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private group: { started: boolean; promise: Promise<boolean> } | null = null;
  private bytes = 0;
  private activeBytes = 0;
  private queuedBytes = 0;
  private ioFailed = false;
  private closed = false;
  private droppedRobotStates = 0;
  private compactScheduled = false;
  private readonly io: EdgeJournalIo;
  private readonly now: () => number;
  private readonly log: (m: string) => void;
  private readonly maxBytes: number;
  private readonly segmentMaxBytes: number;
  private readonly groupCommitMs: number;
  private readonly stopBoundMs: number;
  private readonly authSyncTimeoutMs: number;
  private readonly jtiRetentionMs: number;
  readonly dir: string;

  private constructor(opts: EdgeJournalOptions) {
    this.dir = path.resolve(opts.dir);
    this.io = opts.io ?? nodeEdgeJournalIo;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m) => console.warn(m));
    const pos = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : d);
    this.maxBytes = pos(opts.maxBytes, EDGE_JOURNAL_DEFAULT_MAX_BYTES);
    this.segmentMaxBytes = pos(opts.segmentMaxBytes, 4 * 1024 * 1024);
    this.groupCommitMs = typeof opts.groupCommitMs === "number" && opts.groupCommitMs >= 0 ? opts.groupCommitMs : 50;
    this.stopBoundMs = pos(opts.stopBoundMs, STOP_DB_STEP_DEADLINE_MS);
    this.authSyncTimeoutMs = pos(opts.authSyncTimeoutMs, 5_000);
    this.jtiRetentionMs = pos(opts.jtiRetentionMs, 2 * EDGE_AUTH_TTL_MAX_MS);
  }

  /** Open (or create, or reset) the journal in `dir`. Throws only when the directory itself cannot be used. */
  static async open(opts: EdgeJournalOptions): Promise<EdgeJournal> {
    const j = new EdgeJournal(opts);
    await j.init();
    return j;
  }

  get epoch(): string {
    return this.epochValue;
  }
  get opened(): EdgeJournalOpened {
    return { ...this.openedValue, reset: this.openedValue.reset ? { ...this.openedValue.reset } : null };
  }

  // ── startup ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    await this.io.mkdir(this.dir);
    const names = await this.io.readdir(this.dir);
    const segs = names.filter((n) => SEG_RE.test(n));
    let snapText: string | null = null;
    let snapUnreadable = false;
    try {
      snapText = await this.io.readFile(path.join(this.dir, EDGE_JOURNAL_STATE_FILE));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") snapUnreadable = true;
    }
    if (snapText === null && !snapUnreadable) {
      if (segs.length === 0) {
        await this.startNewEpoch();
        this.openedValue = { kind: "fresh", truncatedTail: false, reset: null };
        return;
      }
      await this.reset(names, "segments without a snapshot (state.json missing)", null);
      return;
    }
    let snap: Snapshot | null = null;
    if (snapText !== null) {
      try {
        const p = snapshotSchema.safeParse(JSON.parse(snapText));
        if (p.success) snap = p.data;
      } catch {
        snap = null;
      }
    }
    if (!snap) {
      await this.reset(names, "snapshot unreadable (state.json)", null);
      return;
    }
    try {
      const truncatedTail = await this.restore(snap, segs);
      this.openedValue = { kind: "restored", truncatedTail, reset: null };
    } catch (err) {
      if (!(err instanceof JournalCorrupt)) throw err;
      this.clearState();
      await this.reset(await this.io.readdir(this.dir), `corrupt journal: ${err.message}`, snap.epoch);
    }
  }

  private clearState(): void {
    this.streams.clear();
    this.jtis.clear();
    this.locks.clear();
    this.configHashValue = null;
  }

  /** Replays the snapshot's segments; returns whether a torn tail was cut. Throws JournalCorrupt. */
  private async restore(snap: Snapshot, segNames: string[]): Promise<boolean> {
    this.epochValue = snap.epoch;
    this.firstSegment = snap.firstSegment;
    for (const [s, st] of Object.entries(snap.streams)) this.streams.set(s, { nextSeq: st.nextSeq, ackedSeq: st.ackedSeq, pending: [] });
    for (const [jti, at] of snap.jtis) this.jtis.set(jti, at);
    for (const [rid, row] of Object.entries(snap.locks)) this.locks.set(Number(rid), { ...row });
    this.configHashValue = snap.configHash;

    const mine: Array<{ name: string; n: number }> = [];
    for (const name of segNames) {
      const m = SEG_RE.exec(name)!;
      const n = Number(m[2]);
      if (m[1] !== snap.epoch) throw new JournalCorrupt(`segment ${name} of another epoch`);
      if (n < snap.firstSegment) {
        // superseded by a finished compaction (crash before the old segments were deleted)
        await this.io.unlink(path.join(this.dir, name)).catch(() => undefined);
        continue;
      }
      mine.push({ name, n });
    }
    mine.sort((a, b) => a.n - b.n);
    if (mine.length > 0 && mine[0].n !== snap.firstSegment) throw new JournalCorrupt(`first segment ${snap.firstSegment} missing`);
    let truncated = false;
    const lastSeen = new Map<string, { seq: number; h: Map<number, string> }>();
    let bytes = 0;
    let activeBytes = 0;
    for (let i = 0; i < mine.length; i++) {
      const file = path.join(this.dir, mine[i].name);
      let text: string;
      try {
        text = await this.io.readFile(file);
      } catch {
        throw new JournalCorrupt(`segment ${mine[i].name} unreadable`);
      }
      const isLastSeg = i === mine.length - 1;
      const parts = text.split("\n");
      const tailPartial = parts[parts.length - 1]; // "" when the file ends with a newline
      const complete = parts.slice(0, -1);
      let goodBytes = 0;
      for (let li = 0; li < complete.length; li++) {
        const raw = complete[li];
        const l = raw.length === 0 ? null : parseLine(raw);
        // a torn append never ends with its newline (one write of the line + newline): a bad line that DOES is corruption ⇒ reset
        if (!l) throw new JournalCorrupt(`bad line ${li + 1} of ${mine[i].name}`);
        if (l.e !== snap.epoch) throw new JournalCorrupt(`line ${li + 1} of ${mine[i].name} has another epoch`);
        const seen = lastSeen.get(l.s) ?? { seq: 0, h: new Map<number, string>() };
        if (l.q <= seen.seq) {
          // an interrupted compaction copies lines verbatim: identical ⇒ skip; anything else ⇒ corrupt
          if (seen.h.get(l.q) !== l.h) throw new JournalCorrupt(`stream ${l.s} seq ${l.q} out of order`);
        } else {
          seen.seq = l.q;
          seen.h.set(l.q, l.h);
          lastSeen.set(l.s, seen);
          this.applyReplayed(l, raw);
        }
        goodBytes += Buffer.byteLength(raw, "utf8") + 1;
      }
      if (tailPartial !== "") {
        if (!isLastSeg) throw new JournalCorrupt(`segment ${mine[i].name} ends without a newline`);
        truncated = true;
      }
      if (isLastSeg && truncated) await this.io.truncate(file, goodBytes);
      bytes += goodBytes;
      if (isLastSeg) activeBytes = goodBytes;
    }
    this.activeSegment = mine.length > 0 ? mine[mine.length - 1].n : snap.firstSegment;
    this.bytes = bytes;
    this.activeBytes = activeBytes;
    this.fh = await this.io.openAppend(path.join(this.dir, segName(this.epochValue, this.activeSegment)));
    return truncated;
  }

  private applyReplayed(l: Line, raw: string): void {
    const st = this.stream(l.s);
    st.nextSeq = Math.max(st.nextSeq, l.q + 1);
    if (l.s === EDGE_JOURNAL_AUTH_STREAM) {
      const d = l.d as { jti?: unknown };
      if (l.k === "auth.consumed" && typeof d?.jti === "string") this.jtis.set(d.jti, l.t);
      return;
    }
    if (l.k === "lock") this.applyLock(l.d as Omit<Extract<EdgeEventRecord, { kind: "lock" }>, "seq">);
    if (l.q > st.ackedSeq) st.pending.push({ seq: l.q, kind: l.k, at: l.t, data: l.d, line: raw + "\n", written: true });
  }

  /** Moves every journal file aside, opens a new epoch, reports EDGE_JOURNAL_RESET. */
  private async reset(names: string[], reason: string, previousEpoch: string | null): Promise<void> {
    this.log(`[EdgeJournal] RESET — ${reason}: a new epoch is opened; every robot starts locked (persistUnknown) until a confirmed STOP / operator clear`);
    const aside = path.join(this.dir, `reset-${this.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await this.io.mkdir(aside);
    for (const n of names) {
      if (SEG_RE.test(n) || n === EDGE_JOURNAL_STATE_FILE) await this.io.rename(path.join(this.dir, n), path.join(aside, n)).catch(() => undefined);
    }
    this.clearState();
    await this.startNewEpoch();
    this.openedValue = { kind: "reset", truncatedTail: false, reset: { reason, previousEpoch } };
    await this.appendEvent({ kind: "anomaly", code: EDGE_JOURNAL_RESET_CODE, runId: null, detail: `${reason}${previousEpoch ? ` (previous epoch ${previousEpoch})` : ""}`.slice(0, 1_000), at: this.now() });
  }

  private async startNewEpoch(): Promise<void> {
    this.epochValue = newEdgeEpoch();
    this.firstSegment = 1;
    this.activeSegment = 1;
    this.bytes = 0;
    this.activeBytes = 0;
    await this.io.writeFileAtomic(path.join(this.dir, segName(this.epochValue, 1)), "");
    await this.writeSnapshot();
    this.fh = await this.io.openAppend(path.join(this.dir, segName(this.epochValue, 1)));
  }

  private snapshot(): Snapshot {
    const streams: Snapshot["streams"] = {};
    for (const [s, st] of this.streams) streams[s] = { nextSeq: st.nextSeq, ackedSeq: st.ackedSeq };
    const locks: Snapshot["locks"] = {};
    for (const [rid, row] of this.locks) locks[String(rid)] = { ...row };
    return {
      v: 1,
      epoch: this.epochValue,
      firstSegment: this.firstSegment,
      streams,
      jtis: [...this.jtis.entries()],
      locks,
      configHash: this.configHashValue,
      savedAt: Math.max(0, Math.trunc(this.now())),
    };
  }
  private async writeSnapshot(): Promise<void> {
    await this.io.writeFileAtomic(path.join(this.dir, EDGE_JOURNAL_STATE_FILE), JSON.stringify(this.snapshot()) + "\n");
  }

  // ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private stream(s: string): StreamState {
    let st = this.streams.get(s);
    if (!st) {
      st = { nextSeq: 1, ackedSeq: 0, pending: [] };
      this.streams.set(s, st);
    }
    return st;
  }

  private applyLock(d: { robotId: number; event: "locked" | "cleared"; generation: number; ownerEpoch: number; reasonCode: string; since: number }): void {
    const cur = this.locks.get(d.robotId);
    if (cur && d.generation < cur.generation) return; // never backwards
    this.locks.set(d.robotId, { state: d.event, generation: d.generation, reasonCode: d.reasonCode.slice(0, 64), ownerEpoch: d.ownerEpoch, since: d.since });
  }

  isFull(): boolean {
    return this.bytes + this.queuedBytes >= this.maxBytes;
  }
  /** May NEW non-STOP actuation start? false when full, unhealthy (an IO error) or closed. STOP never asks. */
  admitNonStop(): boolean {
    return !this.closed && !this.ioFailed && !this.isFull();
  }
  isJtiConsumed(jti: string): boolean {
    return this.jtis.has(jti);
  }
  ackedSeq(stream: string): number {
    return this.streams.get(stream)?.ackedSeq ?? 0;
  }
  /** What the journal knows of a robot's motion lock (`unknown` ⇒ the caller starts it locked persistUnknown). */
  motionLock(robotId: number): EdgeJournalLockState {
    const r = this.locks.get(robotId);
    if (!r) return { kind: "unknown" };
    return r.state === "locked"
      ? { kind: "locked", generation: r.generation, reasonCode: r.reasonCode, ownerEpoch: r.ownerEpoch, since: r.since }
      : { kind: "clear", generation: r.generation, ownerEpoch: r.ownerEpoch };
  }
  get configHash(): string | null {
    return this.configHashValue;
  }
  setConfigHash(h: string | null): void {
    if (h === null || /^[0-9a-f]{64}$/.test(h)) this.configHashValue = h;
  }
  stats(): EdgeJournalStats {
    let backlog = 0;
    for (const [s, st] of this.streams) if (s !== EDGE_JOURNAL_AUTH_STREAM) backlog += st.pending.length;
    return {
      epoch: this.epochValue,
      backlog,
      bytes: this.bytes + this.queuedBytes,
      maxBytes: this.maxBytes,
      full: this.isFull(),
      healthy: !this.ioFailed && !this.closed,
      droppedRobotStates: this.droppedRobotStates,
      opened: this.openedValue.kind,
    };
  }
  streamsWithPending(): string[] {
    return [...this.streams.entries()].filter(([s, st]) => s !== EDGE_JOURNAL_AUTH_STREAM && st.pending.length > 0).map(([s]) => s);
  }
  /** Un-acknowledged records of a stream, oldest first (at most `max`) — the next report batch. */
  pending(stream: string, max = Number.MAX_SAFE_INTEGER): EdgeJournalEntry[] {
    const st = this.streams.get(stream);
    if (!st || stream === EDGE_JOURNAL_AUTH_STREAM) return [];
    return st.pending.slice(0, Math.max(0, max)).map((p) => ({ epoch: this.epochValue, stream, seq: p.seq, record: { ...(p.data as object), seq: p.seq } as EdgeReportableRecord }));
  }
  /** Central acknowledged everything up to `seq` of `stream` (monotonic; clamped to what was written). */
  ack(stream: string, seq: number): void {
    const st = this.streams.get(stream);
    if (!st || !Number.isSafeInteger(seq)) return;
    const top = Math.min(seq, st.nextSeq - 1);
    if (top <= st.ackedSeq) return;
    st.ackedSeq = top;
    while (st.pending.length > 0 && st.pending[0].seq <= top) st.pending.shift();
    this.maybeCompact();
  }

  // ── writing ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private fail(err: unknown): void {
    if (!this.ioFailed) this.log(`[EdgeJournal] IO error — the journal is UNHEALTHY: no new non-STOP actuation until restart (${(err as Error)?.message ?? err})`);
    this.ioFailed = true;
  }

  /** Queue a line; seq is assigned synchronously by the caller (order = call order). */
  private enqueue(stream: string, kind: string, data: unknown, reportable: boolean): { seq: number; written: Promise<boolean> } {
    const st = this.stream(stream);
    const seq = st.nextSeq++;
    const at = Math.max(0, Math.trunc(this.now()));
    const h = checksum(this.epochValue, stream, seq, kind, at, data);
    const line = JSON.stringify({ e: this.epochValue, s: stream, q: seq, k: kind, t: at, d: data, h }) + "\n";
    const len = Buffer.byteLength(line, "utf8");
    const entry: Pending = { seq, kind, at, data, line, written: false };
    if (reportable) st.pending.push(entry);
    this.queuedBytes += len;
    const written = this.chain.then(async () => {
      this.queuedBytes -= len;
      if (this.ioFailed || !this.fh) return false;
      try {
        await this.fh.write(line);
        entry.written = true;
        this.bytes += len;
        this.activeBytes += len;
        return true;
      } catch (err) {
        this.fail(err);
        return false;
      }
    });
    this.chain = written;
    return { seq, written };
  }

  private syncChained(): Promise<boolean> {
    const p = this.chain.then(async () => {
      if (this.ioFailed || !this.fh) return false;
      try {
        await this.fh.sync();
        return true;
      } catch (err) {
        this.fail(err);
        return false;
      }
    });
    this.chain = p;
    return p;
  }

  /** Group commit: one fsync for every line queued within the window. */
  private syncSoon(): Promise<boolean> {
    if (this.group && !this.group.started) return this.group.promise;
    const g: { started: boolean; promise: Promise<boolean> } = { started: false, promise: Promise.resolve(false) };
    g.promise = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        g.started = true;
        if (this.group === g) this.group = null;
        void this.syncChained().then(resolve);
      }, this.groupCommitMs);
      if (typeof t.unref === "function") t.unref();
    });
    this.group = g;
    return g.promise;
  }

  private async durable(written: Promise<boolean>, boundMs: number | null): Promise<boolean> {
    const work = (async () => (await written) && (await this.syncSoon()))();
    if (boundMs === null) return work;
    let timer: NodeJS.Timeout | null = null;
    const bound = new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), boundMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    try {
      return await Promise.race([work, bound]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * WRITE-AHEAD of single use (design §2.13): fsynced before this resolves `{ok:true}`; only then may the caller send the
   * non-STOP command. Refused when the jti was consumed before, the journal is full / unhealthy / closed.
   */
  async consumeAuthorization(c: { jti: string; runId: number; claimSeq: number; stepId: string; attempt: number }): Promise<EdgeConsumeResult> {
    if (this.closed) return { ok: false, reason: "closed" };
    if (typeof c?.jti !== "string" || c.jti.length === 0 || c.jti.length > 64) return { ok: false, reason: "io_error" };
    if (this.jtis.has(c.jti)) return { ok: false, reason: "jti_consumed" };
    if (this.ioFailed) return { ok: false, reason: "io_error" };
    if (this.isFull()) return { ok: false, reason: "journal_full" };
    this.jtis.set(c.jti, Math.max(0, Math.trunc(this.now()))); // at once: a concurrent second use is refused
    const { written } = this.enqueue(EDGE_JOURNAL_AUTH_STREAM, "auth.consumed", { jti: c.jti, runId: c.runId, claimSeq: c.claimSeq, stepId: c.stepId, attempt: c.attempt }, false);
    const synced = (async () => (await written) && (await this.syncChained()))();
    let timer: NodeJS.Timeout | null = null;
    const bound = new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), this.authSyncTimeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    let ok: boolean;
    try {
      ok = await Promise.race([synced, bound]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!ok) {
      if (!this.ioFailed) this.fail(new Error(`auth.consumed fsync did not finish within ${this.authSyncTimeoutMs} ms`));
      return { ok: false, reason: "io_error" }; // the jti stays consumed (fail-closed)
    }
    return { ok: true };
  }

  private appendReportable(stream: string, kind: string, data: unknown, stop: boolean): Promise<EdgeAppendResult> {
    if (this.closed) return Promise.resolve({ seq: null, dropped: true, reason: "closed" });
    const { seq, written } = this.enqueue(stream, kind, data, true);
    if (this.isFull() || this.activeBytes > this.segmentMaxBytes) this.maybeCompact();
    return this.durable(written, stop ? this.stopBoundMs : null).then((durable) => ({ seq, durable }));
  }

  /** A run-stream record (step / context / abort_stop / ledger). `{stop:true}` ⇒ the wait is bounded (L-7). */
  appendRun(runId: number, claimSeq: number, rec: EdgeRunRecordInput, opts: { stop?: boolean } = {}): Promise<EdgeAppendResult> {
    let stream: string;
    try {
      stream = edgeRunStream(runId, claimSeq);
    } catch {
      return Promise.resolve({ seq: null, dropped: true, reason: "invalid" });
    }
    const p = edgeRunReportRecordSchema.safeParse({ ...rec, seq: 1 });
    if (!p.success) {
      this.log(`[EdgeJournal] refused an invalid ${String((rec as { kind?: unknown })?.kind)} record for ${stream} (it would block the stream at central)`);
      return Promise.resolve({ seq: null, dropped: true, reason: "invalid" });
    }
    const { seq: _s, ...data } = p.data;
    return this.appendReportable(stream, data.kind, data, opts.stop === true || data.kind === "abort_stop");
  }

  /** An `events` record (lock / stop / refusal / anomaly / command_ack). STOP records are bounded (L-7). */
  appendEvent(rec: EdgeEventRecordInput, opts: { stop?: boolean } = {}): Promise<EdgeAppendResult> {
    const p = edgeEventRecordSchema.safeParse({ ...rec, seq: 1 });
    if (!p.success) {
      this.log(`[EdgeJournal] refused an invalid ${String((rec as { kind?: unknown })?.kind)} event record`);
      return Promise.resolve({ seq: null, dropped: true, reason: "invalid" });
    }
    const { seq: _s, ...data } = p.data;
    if (data.kind === "lock") this.applyLock(data);
    return this.appendReportable(EDGE_STREAM_EVENTS, data.kind, data, opts.stop === true || data.kind === "stop");
  }

  /** A robot state sample — dropped (counted) while the journal is full or unhealthy. */
  appendRobotState(rec: EdgeRobotStateInput): Promise<EdgeAppendResult> {
    if (this.closed) return Promise.resolve({ seq: null, dropped: true, reason: "closed" });
    if (this.isFull() || this.ioFailed) {
      this.droppedRobotStates++;
      if (this.droppedRobotStates === 1 || this.droppedRobotStates % 1_000 === 0) {
        this.log(`[EdgeJournal] robot state dropped (journal ${this.ioFailed ? "unhealthy" : "full"}) — ${this.droppedRobotStates} so far`);
      }
      return Promise.resolve({ seq: null, dropped: true, reason: this.ioFailed ? "unhealthy" : "journal_full" });
    }
    const p = edgeRobotStateRecordSchema.safeParse({ ...rec, seq: 1 });
    if (!p.success) return Promise.resolve({ seq: null, dropped: true, reason: "invalid" });
    const { seq: _s, ...data } = p.data;
    return this.appendReportable(EDGE_STREAM_ROBOT_STATE, "robot_state", data, false);
  }

  /** fsync now (everything queued so far). */
  async flush(): Promise<boolean> {
    return this.syncChained();
  }

  private maybeCompact(): void {
    if (this.compactScheduled || this.closed) return;
    if (!(this.activeBytes > this.segmentMaxBytes || this.isFull())) return;
    this.compactScheduled = true;
    const t = setTimeout(() => {
      this.compactScheduled = false;
      void this.compact().catch(() => undefined);
    }, 0);
    if (typeof t.unref === "function") t.unref();
  }

  /**
   * Rewrites the un-acknowledged records into a new segment (fsynced), then the snapshot (atomic), then deletes the old
   * segments. Prunes consumed jtis older than the retention.
   */
  compact(): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.closed || this.ioFailed || !this.fh) return;
      const now = this.now();
      for (const [jti, at] of this.jtis) if (now - at > this.jtiRetentionMs) this.jtis.delete(jti);
      const next = this.activeSegment + 1;
      const lines: string[] = [];
      for (const [s, st] of this.streams) {
        if (s === EDGE_JOURNAL_AUTH_STREAM) continue;
        for (const p of st.pending) if (p.written) lines.push(p.line);
      }
      const body = lines.join("");
      const nextFile = path.join(this.dir, segName(this.epochValue, next));
      try {
        await this.io.writeFileAtomic(nextFile, body);
        const old = this.firstSegment;
        const oldActive = this.activeSegment;
        this.firstSegment = next;
        this.activeSegment = next;
        await this.writeSnapshot();
        await this.fh.close().catch(() => undefined);
        this.fh = await this.io.openAppend(nextFile);
        for (let n = old; n <= oldActive; n++) await this.io.unlink(path.join(this.dir, segName(this.epochValue, n))).catch(() => undefined);
        const size = Buffer.byteLength(body, "utf8");
        this.bytes = size;
        this.activeBytes = size;
      } catch (err) {
        this.fail(err);
      }
    });
    this.chain = run;
    return run;
  }

  /** Flush, persist the snapshot, close. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    const run = this.chain.then(async () => {
      try {
        if (this.fh && !this.ioFailed) await this.fh.sync();
        if (!this.ioFailed) await this.writeSnapshot();
      } catch (err) {
        this.fail(err);
      }
      await this.fh?.close().catch(() => undefined);
      this.fh = null;
    });
    this.chain = run;
    this.closed = true;
    await run;
  }
}
