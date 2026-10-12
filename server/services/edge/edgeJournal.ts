/**
 * doc 81 Đợt 10 task E (design §2.2, D3; fix review 1 — ruling R-10-ag) — the EDGE JOURNAL: the edge's only durable local state
 * now that it has no central DB login. APPEND-ONLY JSONL segments (no native dependency — Node 20) plus an atomically renamed
 * `state.json` snapshot, under EDGE_JOURNAL_DIR (a compose volume).
 *
 * RECORDS. Every line is `{e: epoch, s: stream, q: seq, k: kind, t: at, d: data, h: checksum}`:
 *   • epoch — 128-bit random. A new epoch opens with a new journal, after a RESET, and after an UNCLEAN shutdown (R-10-ag: the
 *     seq high-water of a crashed epoch cannot be known, so its seqs are never written again — the new epoch starts every stream
 *     at 1; central accepts a new epoch only from seq 1). The un-acknowledged DURABLE records of earlier epochs are still shipped
 *     under THEIR epoch (central keeps one cursor per (node, stream, epoch));
 *   • streams — `run:<runId>:<claimSeq>` (→ POST runs/:id/report), `events` (→ POST locks/events), `robot_state` (→ POST
 *     robots/state), and the LOCAL stream `auth` (`auth.consumed`; never reported). OT telemetry is NOT here (storeForward WAL);
 *   • seq — strictly increasing per (epoch, stream), from 1; never reused.
 *
 * DURABILITY (R-10-ag: ONLY DURABLE records are shipped). A record is durable once an fsync that started after its write
 * succeeded; pending() returns only the durable prefix of a stream, so central never holds a record the edge could lose (and a
 * crash can never make the edge send different content under a seq central already has).
 *   • `auth.consumed` — fsynced BEFORE consumeAuthorization() resolves (the driver call comes after); a sync that fails / overruns
 *     ⇒ io_error, the jti stays consumed, the journal unhealthy (fail-closed).
 *   • `lock` events — fsynced at once (the motion-lock state must survive a crash; a STOP-confirmed clear bounded like a STOP).
 *   • everything else — group commit (one fsync per window, default 50 ms); `{stop:true}` bounds the wait by
 *     STOP_DB_STEP_DEADLINE_MS (L-7: a STOP never waits on the disk beyond it — the record becomes durable / shipped later).
 *   • robot_state — DROPPED (counted) while the journal is full or unhealthy.
 *
 * BOUNDS + COMPACTION (R-10-ag). Appends are O(1): they only append to the active segment (rolled at segmentMaxBytes).
 * Compaction NEVER rewrites a record: it deletes the oldest closed segments whose every reportable record central has
 * acknowledged (after the snapshot that captures the state they carried). FULL (bytes on disk + queued ≥ maxBytes) ⇒
 * admitNonStop() false, auth.consumed refused, robot_state dropped; every other record is still appended (never dropped).
 *
 * STARTUP. A torn LAST line (no trailing newline) is cut off. Anything else unreadable — the snapshot, a newline-terminated bad
 * line, a seq repeated with other content, segments without a snapshot — RESETS the journal: files moved aside (`reset-<ts>/`),
 * a new epoch, every robot's lock state `unknown` (locked persistUnknown by the caller), an EDGE_JOURNAL_RESET anomaly that
 * COUNTS the readable records that were never confirmed reported. An unclean shutdown (no clean close) ⇒ new epoch +
 * EDGE_JOURNAL_UNCLEAN_SHUTDOWN anomaly (records of the last group-commit window may be lost; they were never shipped).
 * Claim tokens are never journaled. Never throws after open().
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
  /** the previous process did not close the journal (a new epoch was opened) */
  unclean: boolean;
  reset: null | { reason: string; previousEpoch: string | null; unreported: number };
}
export interface EdgeJournalStats {
  epoch: string;
  /** reportable records not yet acknowledged by central (every epoch) */
  backlog: number;
  bytes: number;
  maxBytes: number;
  full: boolean;
  healthy: boolean;
  droppedRobotStates: number;
  segments: number;
  opened: EdgeJournalOpened["kind"];
}
export interface EdgeStreamRef {
  epoch: string;
  stream: string;
}
export interface EdgeJournalOptions {
  dir: string;
  /** default 64 MiB; config limits.journalMaxBytes */
  maxBytes?: number;
  /** active segment roll size, default 4 MiB */
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
export const EDGE_JOURNAL_UNCLEAN_CODE = "EDGE_JOURNAL_UNCLEAN_SHUTDOWN";
const SEG_RE = /^seg-(\d{8})\.jsonl$/;
const LEGACY_SEG_RE = /^seg-[0-9a-f]{32}-\d{6}\.jsonl$/;
const segName = (n: number) => `seg-${String(n).padStart(8, "0")}.jsonl`;
const key = (epoch: string, stream: string) => `${epoch}|${stream}`;
const unkey = (k: string): EdgeStreamRef => {
  const i = k.indexOf("|");
  return { epoch: k.slice(0, i), stream: k.slice(i + 1) };
};
const REPORTABLE_KINDS = new Set(["step", "context", "abort_stop", "ledger", "lock", "stop", "refusal", "anomaly", "command_ack", "actuation", "robot_state"]);

// ── snapshot ────────────────────────────────────────────────────────────────────────────────────────────────────────

const zN = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.strictObject({
  v: z.literal(2),
  epoch: z.string().regex(EDGE_EPOCH_RE),
  firstSegment: z.number().int().positive().max(99_999_999),
  streams: z.record(z.string(), z.strictObject({ nextSeq: z.number().int().positive(), ackedSeq: zN })),
  jtis: z.array(z.tuple([z.string().min(1).max(64), zN])),
  locks: z.record(
    z.string().regex(/^[1-9][0-9]*$/),
    z.strictObject({ state: z.enum(["locked", "cleared"]), generation: zN, reasonCode: z.string().max(64), ownerEpoch: zN, since: zN }),
  ),
  configHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  configVersion: zN.nullable(),
  /** true while a process has the journal open — found true at open ⇒ the previous process did not close it (unclean) */
  open: z.boolean(),
  savedAt: zN,
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
  data: unknown;
  durable: boolean;
}
interface StreamState {
  nextSeq: number;
  ackedSeq: number;
  pending: Pending[];
}
interface SegmentInfo {
  n: number;
  bytes: number;
  /** highest seq of each reportable stream key written in this segment */
  maxSeq: Map<string, number>;
}

class JournalCorrupt extends Error {}

export class EdgeJournal {
  private epochValue = "";
  private openedValue: EdgeJournalOpened = { kind: "fresh", truncatedTail: false, unclean: false, reset: null };
  private readonly streams = new Map<string, StreamState>();
  private readonly jtis = new Map<string, number>();
  private readonly locks = new Map<number, LockRow>();
  private configHashValue: string | null = null;
  private configVersionValue: number | null = null;
  private readonly segments: SegmentInfo[] = [];
  private fh: EdgeJournalFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private group: { started: boolean; promise: Promise<boolean> } | null = null;
  /** written to the OS but not yet covered by a successful fsync */
  private unsynced: Pending[] = [];
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
    const segs = names.filter((n) => SEG_RE.test(n) || LEGACY_SEG_RE.test(n));
    let snapText: string | null = null;
    let snapUnreadable = false;
    try {
      snapText = await this.io.readFile(path.join(this.dir, EDGE_JOURNAL_STATE_FILE));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") snapUnreadable = true;
    }
    if (snapText === null && !snapUnreadable) {
      if (segs.length === 0) {
        await this.startFresh(1);
        this.openedValue = { kind: "fresh", truncatedTail: false, unclean: false, reset: null };
        return;
      }
      await this.reset(names, "segments without a snapshot (state.json missing)", null, null);
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
      await this.reset(names, "snapshot unreadable (state.json)", null, null);
      return;
    }
    let truncatedTail: boolean;
    try {
      if (segs.some((n) => LEGACY_SEG_RE.test(n))) throw new JournalCorrupt("segment of an older journal format");
      truncatedTail = await this.restore(snap, segs);
    } catch (err) {
      if (!(err instanceof JournalCorrupt)) throw err;
      this.clearState();
      await this.reset(await this.io.readdir(this.dir), `corrupt journal: ${err.message}`, snap.epoch, snap);
      return;
    }
    const unclean = snap.open === true;
    if (unclean) {
      // R-10-ag — the crashed epoch's seq high-water is unknowable (records of the last window may be lost): never write it
      // again. Its durable records stay and are shipped under it; new records go to a NEW epoch from seq 1.
      const prev = this.epochValue;
      this.epochValue = newEdgeEpoch();
      await this.fsyncActive(); // what the crashed process wrote is made durable before anything of it is shipped
      await this.writeSnapshot(true);
      this.openedValue = { kind: "restored", truncatedTail, unclean: true, reset: null };
      await this.appendEvent({
        kind: "anomaly",
        code: EDGE_JOURNAL_UNCLEAN_CODE,
        runId: null,
        detail: `epoch ${prev} was not closed cleanly: records appended in its last group-commit window may be lost (never shipped — only durable records are); new epoch ${this.epochValue}`,
        at: this.now(),
      });
      return;
    }
    await this.writeSnapshot(true);
    this.openedValue = { kind: "restored", truncatedTail, unclean: false, reset: null };
  }

  private async fsyncActive(): Promise<void> {
    try {
      await this.fh?.sync();
    } catch (err) {
      this.fail(err);
    }
  }

  private clearState(): void {
    this.streams.clear();
    this.jtis.clear();
    this.locks.clear();
    this.segments.length = 0;
    this.configHashValue = null;
    this.configVersionValue = null;
  }

  /** Replays the snapshot's segments; returns whether a torn tail was cut. Throws JournalCorrupt. */
  private async restore(snap: Snapshot, segNames: string[]): Promise<boolean> {
    this.epochValue = snap.epoch;
    for (const [k, st] of Object.entries(snap.streams)) this.streams.set(k, { nextSeq: st.nextSeq, ackedSeq: st.ackedSeq, pending: [] });
    for (const [jti, at] of snap.jtis) this.jtis.set(jti, at);
    for (const [rid, row] of Object.entries(snap.locks)) this.locks.set(Number(rid), { ...row });
    this.configHashValue = snap.configHash;
    this.configVersionValue = snap.configVersion;

    const mine: number[] = [];
    for (const name of segNames) {
      const n = Number(SEG_RE.exec(name)![1]);
      if (n < snap.firstSegment) {
        await this.io.unlink(path.join(this.dir, name)).catch(() => undefined); // dropped by a finished compaction
        continue;
      }
      mine.push(n);
    }
    mine.sort((a, b) => a - b);
    if (mine.length === 0 || mine[0] !== snap.firstSegment) throw new JournalCorrupt(`first segment ${snap.firstSegment} missing`);
    for (let i = 1; i < mine.length; i++) if (mine[i] !== mine[i - 1] + 1) throw new JournalCorrupt(`segment ${mine[i - 1] + 1} missing`);
    let truncated = false;
    const lastSeen = new Map<string, number>();
    for (let i = 0; i < mine.length; i++) {
      const n = mine[i];
      const file = path.join(this.dir, segName(n));
      let text: string;
      try {
        text = await this.io.readFile(file);
      } catch {
        throw new JournalCorrupt(`segment ${segName(n)} unreadable`);
      }
      const isLast = i === mine.length - 1;
      const parts = text.split("\n");
      const tail = parts[parts.length - 1];
      const complete = parts.slice(0, -1);
      const info: SegmentInfo = { n, bytes: 0, maxSeq: new Map() };
      for (let li = 0; li < complete.length; li++) {
        const raw = complete[li];
        const l = raw.length === 0 ? null : parseLine(raw);
        // a torn append never ends with its newline (one write of the line + newline): a bad line that DOES is corruption
        if (!l) throw new JournalCorrupt(`bad line ${li + 1} of ${segName(n)}`);
        if (!EDGE_EPOCH_RE.test(l.e)) throw new JournalCorrupt(`line ${li + 1} of ${segName(n)} has no valid epoch`);
        const k = key(l.e, l.s);
        if (l.q <= (lastSeen.get(k) ?? 0)) throw new JournalCorrupt(`stream ${l.s} seq ${l.q} out of order`);
        lastSeen.set(k, l.q);
        this.applyReplayed(l, info);
        info.bytes += Buffer.byteLength(raw, "utf8") + 1;
      }
      if (tail !== "") {
        if (!isLast) throw new JournalCorrupt(`segment ${segName(n)} ends without a newline`);
        truncated = true;
        await this.io.truncate(file, info.bytes);
      }
      this.segments.push(info);
    }
    this.fh = await this.io.openAppend(path.join(this.dir, segName(mine[mine.length - 1])));
    return truncated;
  }

  private applyReplayed(l: Line, seg: SegmentInfo): void {
    const k = key(l.e, l.s);
    const st = this.stream(k);
    st.nextSeq = Math.max(st.nextSeq, l.q + 1);
    if (l.s === EDGE_JOURNAL_AUTH_STREAM) {
      const d = l.d as { jti?: unknown };
      if (l.k === "auth.consumed" && typeof d?.jti === "string") this.jtis.set(d.jti, l.t);
      return;
    }
    seg.maxSeq.set(k, Math.max(seg.maxSeq.get(k) ?? 0, l.q));
    if (l.k === "lock") this.applyLock(l.d as LockEventData);
    if (l.q > st.ackedSeq) st.pending.push({ seq: l.q, kind: l.k, data: l.d, durable: true });
  }

  /** Counts the readable, reportable lines of files about to be moved aside (never confirmed reported to central). */
  private async countUnreported(names: string[], snap: Snapshot | null): Promise<{ total: number; byKind: Map<string, number> }> {
    const byKind = new Map<string, number>();
    let total = 0;
    for (const n of names) {
      if (!SEG_RE.test(n) && !LEGACY_SEG_RE.test(n)) continue;
      let text = "";
      try {
        text = await this.io.readFile(path.join(this.dir, n));
      } catch {
        continue;
      }
      for (const raw of text.split("\n")) {
        const l = raw ? parseLine(raw) : null;
        if (!l || !REPORTABLE_KINDS.has(l.k)) continue;
        const acked = snap?.streams[key(l.e, l.s)]?.ackedSeq ?? 0;
        if (l.q <= acked) continue;
        total++;
        byKind.set(l.k, (byKind.get(l.k) ?? 0) + 1);
      }
    }
    return { total, byKind };
  }

  /** Moves every journal file aside, opens a new epoch, reports EDGE_JOURNAL_RESET with the evidence it could not keep. */
  private async reset(names: string[], reason: string, previousEpoch: string | null, snap: Snapshot | null): Promise<void> {
    this.log(`[EdgeJournal] RESET — ${reason}: a new epoch is opened; every robot starts locked (persistUnknown) until a confirmed STOP / operator clear`);
    const lost = await this.countUnreported(names, snap);
    const aside = path.join(this.dir, `reset-${this.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await this.io.mkdir(aside);
    for (const n of names) {
      if (SEG_RE.test(n) || LEGACY_SEG_RE.test(n) || n === EDGE_JOURNAL_STATE_FILE) await this.io.rename(path.join(this.dir, n), path.join(aside, n)).catch(() => undefined);
    }
    this.clearState();
    await this.startFresh(1);
    this.openedValue = { kind: "reset", truncatedTail: false, unclean: false, reset: { reason, previousEpoch, unreported: lost.total } };
    const kinds = [...lost.byKind.entries()].map(([k, n]) => `${k}=${n}`).join(", ");
    await this.appendEvent({
      kind: "anomaly",
      code: EDGE_JOURNAL_RESET_CODE,
      runId: null,
      detail: `${reason}${previousEpoch ? ` (previous epoch ${previousEpoch})` : ""}; ${lost.total} readable record(s) never confirmed reported were moved aside (${kinds || "none"}) — see ${path.basename(aside)}`.slice(0, 1_000),
      at: this.now(),
    });
  }

  private async startFresh(n: number): Promise<void> {
    this.epochValue = newEdgeEpoch();
    await this.io.writeFileAtomic(path.join(this.dir, segName(n)), "");
    this.segments.push({ n, bytes: 0, maxSeq: new Map() });
    await this.writeSnapshot(true);
    this.fh = await this.io.openAppend(path.join(this.dir, segName(n)));
  }

  private snapshot(open: boolean): Snapshot {
    const now = this.now();
    for (const [jti, at] of this.jtis) if (now - at > this.jtiRetentionMs) this.jtis.delete(jti);
    const streams: Snapshot["streams"] = {};
    for (const [k, st] of this.streams) streams[k] = { nextSeq: st.nextSeq, ackedSeq: st.ackedSeq };
    const locks: Snapshot["locks"] = {};
    for (const [rid, row] of this.locks) locks[String(rid)] = { ...row };
    return {
      v: 2,
      epoch: this.epochValue,
      firstSegment: this.segments[0]?.n ?? 1,
      streams,
      jtis: [...this.jtis.entries()],
      locks,
      configHash: this.configHashValue,
      configVersion: this.configVersionValue,
      open,
      savedAt: Math.max(0, Math.trunc(now)),
    };
  }
  private async writeSnapshot(open: boolean): Promise<void> {
    await this.io.writeFileAtomic(path.join(this.dir, EDGE_JOURNAL_STATE_FILE), JSON.stringify(this.snapshot(open)) + "\n");
  }

  // ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private stream(k: string): StreamState {
    let st = this.streams.get(k);
    if (!st) {
      st = { nextSeq: 1, ackedSeq: 0, pending: [] };
      this.streams.set(k, st);
    }
    return st;
  }

  private applyLock(d: LockEventData): void {
    const cur = this.locks.get(d.robotId);
    if (cur && d.generation < cur.generation) return; // never backwards
    this.locks.set(d.robotId, { state: d.event, generation: d.generation, reasonCode: String(d.reasonCode).slice(0, 64), ownerEpoch: d.ownerEpoch, since: d.since });
  }

  private bytesOnDisk(): number {
    let b = 0;
    for (const s of this.segments) b += s.bytes;
    return b;
  }
  isFull(): boolean {
    return this.bytesOnDisk() + this.queuedBytes >= this.maxBytes;
  }
  /** May NEW non-STOP actuation start? false when full, unhealthy (an IO error) or closed. STOP never asks. */
  admitNonStop(): boolean {
    return !this.closed && !this.ioFailed && !this.isFull();
  }
  isJtiConsumed(jti: string): boolean {
    return this.jtis.has(jti);
  }
  ackedSeq(stream: string, epoch: string = this.epochValue): number {
    return this.streams.get(key(epoch, stream))?.ackedSeq ?? 0;
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
  /** The highest config version this node ever accepted (a rollback floor that survives a lost config-state.json). */
  get configVersion(): number | null {
    return this.configVersionValue;
  }
  setConfigHash(h: string | null, version?: number | null): void {
    if (h === null || /^[0-9a-f]{64}$/.test(h)) this.configHashValue = h;
    if (typeof version === "number" && Number.isSafeInteger(version) && version > 0) this.configVersionValue = Math.max(this.configVersionValue ?? 0, version);
  }
  stats(): EdgeJournalStats {
    let backlog = 0;
    for (const [k, st] of this.streams) if (unkey(k).stream !== EDGE_JOURNAL_AUTH_STREAM) backlog += st.pending.length;
    return {
      epoch: this.epochValue,
      backlog,
      bytes: this.bytesOnDisk() + this.queuedBytes,
      maxBytes: this.maxBytes,
      full: this.isFull(),
      healthy: !this.ioFailed && !this.closed,
      droppedRobotStates: this.droppedRobotStates,
      segments: this.segments.length,
      opened: this.openedValue.kind,
    };
  }
  /** Streams of the CURRENT epoch with records not yet acknowledged. */
  streamsWithPending(): string[] {
    return this.pendingStreams()
      .filter((r) => r.epoch === this.epochValue)
      .map((r) => r.stream);
  }
  /** Every (epoch, stream) with records not yet acknowledged — earlier epochs first. */
  pendingStreams(): EdgeStreamRef[] {
    const out: EdgeStreamRef[] = [];
    for (const [k, st] of this.streams) {
      const r = unkey(k);
      if (r.stream === EDGE_JOURNAL_AUTH_STREAM || st.pending.length === 0) continue;
      out.push(r);
    }
    return out.sort((a, b) => (a.epoch === b.epoch ? 0 : a.epoch === this.epochValue ? 1 : b.epoch === this.epochValue ? -1 : 0));
  }
  /**
   * The next report batch: the DURABLE prefix of a stream's un-acknowledged records, oldest first (at most `max`). A record not
   * yet fsynced is never returned (R-10-ag) — nor anything after it.
   */
  pending(stream: string, max = Number.MAX_SAFE_INTEGER, epoch: string = this.epochValue): EdgeJournalEntry[] {
    const st = this.streams.get(key(epoch, stream));
    if (!st || stream === EDGE_JOURNAL_AUTH_STREAM) return [];
    const out: EdgeJournalEntry[] = [];
    for (const p of st.pending) {
      if (out.length >= max || !p.durable) break;
      out.push({ epoch, stream, seq: p.seq, record: { ...(p.data as object), seq: p.seq } as EdgeReportableRecord });
    }
    return out;
  }
  /** Records of a stream still waiting for an fsync (not shippable yet). */
  undurableCount(stream: string, epoch: string = this.epochValue): number {
    return this.streams.get(key(epoch, stream))?.pending.filter((p) => !p.durable).length ?? 0;
  }
  /** Central acknowledged everything up to `seq` (monotonic; clamped to the DURABLE records). */
  ack(stream: string, seq: number, epoch: string = this.epochValue): void {
    const st = this.streams.get(key(epoch, stream));
    if (!st || !Number.isSafeInteger(seq)) return;
    let top = Math.min(seq, st.nextSeq - 1);
    const firstUndurable = st.pending.find((p) => !p.durable);
    if (firstUndurable) top = Math.min(top, firstUndurable.seq - 1);
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

  /** Queue a line; seq is assigned synchronously by the caller (order = call order). O(1). */
  private enqueue(stream: string, kind: string, data: unknown, reportable: boolean): { seq: number; written: Promise<boolean> } {
    const k = key(this.epochValue, stream);
    const st = this.stream(k);
    const seq = st.nextSeq++;
    const at = Math.max(0, Math.trunc(this.now()));
    const h = checksum(this.epochValue, stream, seq, kind, at, data);
    const line = JSON.stringify({ e: this.epochValue, s: stream, q: seq, k: kind, t: at, d: data, h }) + "\n";
    const len = Buffer.byteLength(line, "utf8");
    const entry: Pending = { seq, kind, data, durable: false };
    if (reportable) st.pending.push(entry);
    this.queuedBytes += len;
    const written = this.chain.then(async () => {
      this.queuedBytes -= len;
      if (this.ioFailed || !this.fh) return false;
      try {
        await this.fh.write(line);
        const seg = this.segments[this.segments.length - 1];
        seg.bytes += len;
        if (reportable) seg.maxSeq.set(k, Math.max(seg.maxSeq.get(k) ?? 0, seq));
        this.unsynced.push(entry);
        if (seg.bytes >= this.segmentMaxBytes) await this.roll();
        return true;
      } catch (err) {
        this.fail(err);
        return false;
      }
    });
    this.chain = written;
    return { seq, written };
  }

  /** Inside the chain: fsync + close the active segment, open the next one. */
  private async roll(): Promise<void> {
    if (!this.fh) return;
    await this.fh.sync();
    this.markDurable(this.unsynced.splice(0));
    await this.fh.close().catch(() => undefined);
    const n = this.segments[this.segments.length - 1].n + 1;
    await this.io.writeFileAtomic(path.join(this.dir, segName(n)), "");
    this.segments.push({ n, bytes: 0, maxSeq: new Map() });
    this.fh = await this.io.openAppend(path.join(this.dir, segName(n)));
    this.maybeCompact();
  }

  private markDurable(batch: Pending[]): void {
    for (const p of batch) p.durable = true;
  }

  private syncChained(): Promise<boolean> {
    const p = this.chain.then(async () => {
      if (this.ioFailed || !this.fh) return false;
      const batch = this.unsynced.splice(0);
      try {
        await this.fh.sync();
        this.markDurable(batch);
        return true;
      } catch (err) {
        this.unsynced.unshift(...batch);
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

  private async bounded(work: Promise<boolean>, boundMs: number | null): Promise<boolean> {
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
    const ok = await this.bounded(synced, this.authSyncTimeoutMs);
    if (!ok) {
      if (!this.ioFailed) this.fail(new Error(`auth.consumed fsync did not finish within ${this.authSyncTimeoutMs} ms`));
      return { ok: false, reason: "io_error" }; // the jti stays consumed (fail-closed)
    }
    return { ok: true };
  }

  private appendReportable(stream: string, kind: string, data: unknown, cls: "group" | "stop" | "now"): Promise<EdgeAppendResult> {
    if (this.closed) return Promise.resolve({ seq: null, dropped: true, reason: "closed" });
    const { seq, written } = this.enqueue(stream, kind, data, true);
    const work = (async () => (await written) && (await (cls === "now" ? this.syncChained() : this.syncSoon())))();
    return this.bounded(work, cls === "group" ? null : this.stopBoundMs).then((durable) => ({ seq, durable }));
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
    return this.appendReportable(stream, data.kind, data, opts.stop === true || data.kind === "abort_stop" ? "stop" : "group");
  }

  /** An `events` record. STOP records are bounded (L-7); lock events are fsynced at once (bounded). */
  appendEvent(rec: EdgeEventRecordInput, opts: { stop?: boolean } = {}): Promise<EdgeAppendResult> {
    const p = edgeEventRecordSchema.safeParse({ ...rec, seq: 1 });
    if (!p.success) {
      this.log(`[EdgeJournal] refused an invalid ${String((rec as { kind?: unknown })?.kind)} event record`);
      return Promise.resolve({ seq: null, dropped: true, reason: "invalid" });
    }
    const { seq: _s, ...data } = p.data;
    if (data.kind === "lock") {
      this.applyLock(data);
      return this.appendReportable(EDGE_STREAM_EVENTS, data.kind, data, "now");
    }
    return this.appendReportable(EDGE_STREAM_EVENTS, data.kind, data, opts.stop === true || data.kind === "stop" ? "stop" : "group");
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
    return this.appendReportable(EDGE_STREAM_ROBOT_STATE, "robot_state", data, "group");
  }

  /** fsync now (everything queued so far). */
  async flush(): Promise<boolean> {
    return this.syncChained();
  }

  private maybeCompact(): void {
    if (this.compactScheduled || this.closed || this.segments.length < 2) return;
    this.compactScheduled = true;
    const t = setTimeout(() => {
      this.compactScheduled = false;
      void this.compact().catch(() => undefined);
    }, 0);
    if (typeof t.unref === "function") t.unref();
  }

  /** A closed segment can go when central acknowledged every reportable record in it. */
  private droppable(seg: SegmentInfo): boolean {
    for (const [k, maxSeq] of seg.maxSeq) if ((this.streams.get(k)?.ackedSeq ?? 0) < maxSeq) return false;
    return true;
  }

  /**
   * Deletes the oldest CLOSED segments that hold only acknowledged records — after a snapshot that carries their state
   * (consumed jtis, lock states, cursors). Never rewrites a record; O(segments).
   */
  compact(): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.closed || this.ioFailed) return;
      let drop = 0;
      while (drop < this.segments.length - 1 && this.droppable(this.segments[drop])) drop++;
      try {
        const gone = this.segments.splice(0, drop);
        await this.writeSnapshot(true);
        for (const s of gone) await this.io.unlink(path.join(this.dir, segName(s.n))).catch(() => undefined);
      } catch (err) {
        this.fail(err);
      }
    });
    this.chain = run;
    return run;
  }

  /** Flush, persist the snapshot (clean), close. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    const run = this.chain.then(async () => {
      try {
        if (this.fh && !this.ioFailed) {
          await this.fh.sync();
          this.markDurable(this.unsynced.splice(0));
        }
        if (!this.ioFailed) await this.writeSnapshot(false);
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

type LockEventData = { robotId: number; event: "locked" | "cleared"; generation: number; ownerEpoch: number; reasonCode: string; since: number };
