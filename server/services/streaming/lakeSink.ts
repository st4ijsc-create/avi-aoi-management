/**
 * doc 48 R3 — COLD-TIER LAKE SINK (audit L2: "no lake/Parquet cold tier for
 * telemetry; marts are plain-PG"). Archives the LIVE telemetry stream — the one
 * `telemetryStreamTap` (R1) republishes onto the SYNAPSE bus as
 * `syn/telemetry/{line}` — into a time-partitioned columnar-ready cold tier.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT: a DURABLE NATS JetStream pull consumer over the `${prefix}_bridge` stream
 * (the same durable log the bridge/tap write to). It batches messages (size OR
 * time), flushes each batch to a partitioned file, then ACKs — at-least-once, so a
 * crash between write and ack re-delivers (idempotent-ish filenames dedupe on
 * re-write). Partition layout (Hive-style, UTC event time):
 *
 *     <LAKE_DIR>/date=YYYY-MM-DD/hour=HH/aspect=<aspect>/part-<consumer>-<lo>-<hi>-<hash>.ndjson.gz
 *
 * `aspect` = the 2nd subject segment (`syn.telemetry.l1` → `telemetry`), so a
 * widened filter naturally fans out into per-aspect partitions.
 *
 * FORMAT: **gzipped NDJSON** (`.ndjson.gz`), NOT Parquet. HONEST REASON: no Parquet
 * lib is a dependency, and adding one (parquetjs = unmaintained; parquet-wasm /
 * apache-arrow = heavy/native) is out of scope per the "no heavy native dep" rule.
 * NDJSON+gzip is a columnar-READY tier — DuckDB (`read_json_auto`), Spark, ClickHouse
 * and `pandas` all read `.ndjson.gz` directly, and it converts to Parquet in one
 * `COPY … TO '*.parquet'`. The partitioning + schema below is exactly what a Parquet
 * writer would consume.  TODO(doc 48 R4): swap the writer for Parquet once a
 * vetted, dependency-light lib is chosen — only `ndjsonGzip()` changes.
 *
 * SINK TARGET: local FS (`LAKE_DIR`, default `./data/lake`) OR MinIO/S3 when
 * `LAKE_S3_ENDPOINT` + `LAKE_S3_BUCKET` are set (uses the already-present
 * `@aws-sdk/client-s3`, path-style for MinIO). No new dependency either way.
 *
 * HONEST-DEGRADE (mirrors natsAdapter / telemetryStreamTap):
 *   • flag off ................ clean no-op (startLakeSink returns null).
 *   • nats selected, unreachable / lib absent .. no-op + one honest log line; it
 *     NEVER falls back to the in-process ring pretending to be durable, and NEVER
 *     fabricates a lake. Boot is never blocked.
 *   • in-process backend (dev/zero-infra) ..... consumes via the bridge as a
 *     NON-durable source (clearly labelled) so single-process editions + the
 *     `lake:verify` smoke still land real files.
 *
 * SAFETY: telemetry archive only — never a device-command path (same invariant as
 * the bus/tap it reads).
 *
 * Flag: LAKE_SINK_ENABLED (default OFF — the orchestrator flips it on).
 * Env: LAKE_DIR (./data/lake) · LAKE_SOURCE_TOPIC (syn/telemetry/*) ·
 *      LAKE_CONSUMER (lake_sink) · LAKE_BATCH_MAX (500) · LAKE_FLUSH_MS (10000) ·
 *      LAKE_ACK_WAIT_MS (60000) · LAKE_DELIVER_POLICY (all|new, default all) ·
 *      LAKE_S3_ENDPOINT / LAKE_S3_BUCKET / LAKE_S3_REGION / LAKE_S3_ACCESS_KEY /
 *      LAKE_S3_SECRET_KEY / LAKE_S3_FORCE_PATH_STYLE (true) / LAKE_S3_PREFIX.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "crypto";
import { gzipSync } from "zlib";
import { promises as fs } from "fs";
import path from "path";
import { natsUrl, natsStreamPrefix, topicToSubject } from "./natsAdapter";
import type { StreamBridge, StreamMessage, Subscription } from "./streamBridge";

// ─── Flags / tunables (read at call time — test-friendly) ─────────────────────

export function isLakeSinkEnabled(): boolean {
  return process.env.LAKE_SINK_ENABLED === "true";
}
export function lakeDir(): string {
  return process.env.LAKE_DIR?.trim() || "./data/lake";
}
export function lakeSourceTopic(): string {
  return process.env.LAKE_SOURCE_TOPIC?.trim() || "syn/telemetry/*";
}
export function lakeConsumerName(): string {
  return (process.env.LAKE_CONSUMER?.trim() || "lake_sink").replace(/[^A-Za-z0-9_-]/g, "_");
}
function intEnv(name: string, def: number, min: number): number {
  const n = parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(n) && n >= min ? n : def;
}
export function lakeBatchMax(): number {
  return intEnv("LAKE_BATCH_MAX", 500, 1);
}
export function lakeFlushMs(): number {
  return intEnv("LAKE_FLUSH_MS", 10_000, 250);
}
function lakeAckWaitMs(): number {
  return intEnv("LAKE_ACK_WAIT_MS", 60_000, 1_000);
}
function lakeDeliverPolicy(): "all" | "new" {
  return process.env.LAKE_DELIVER_POLICY === "new" ? "new" : "all";
}

export interface LakeS3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  prefix: string;
}

/** S3/MinIO config when both endpoint + bucket are set; else null (→ local FS). */
export function lakeS3Config(): LakeS3Config | null {
  const endpoint = process.env.LAKE_S3_ENDPOINT?.trim();
  const bucket = process.env.LAKE_S3_BUCKET?.trim();
  if (!endpoint || !bucket) return null;
  return {
    endpoint,
    bucket,
    region: process.env.LAKE_S3_REGION?.trim() || "us-east-1",
    accessKeyId: process.env.LAKE_S3_ACCESS_KEY?.trim() || process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.LAKE_S3_SECRET_KEY?.trim() || process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    forcePathStyle: process.env.LAKE_S3_FORCE_PATH_STYLE !== "false",
    prefix: (process.env.LAKE_S3_PREFIX?.trim() || "").replace(/^\/+|\/+$/g, ""),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PURE CORE — row shaping, partitioning, file naming (unit-tested, no I/O)
// ═══════════════════════════════════════════════════════════════════════════

/** One flattened lake record: the sample plus stream provenance (`_`-prefixed). */
export interface LakeRow {
  _topic: string;
  _seq: number;
  _aspect: string;
  /** Bus append (publish) time, ISO. */
  _ingest_ts: string;
  /** Event time (sample `ts` when present, else ingest), ISO — the partition key. */
  _event_ts: string;
  [k: string]: unknown;
}

/** Aspect = 2nd subject segment: `syn/telemetry/l1` → `telemetry`. Honest fallback. */
export function aspectOfTopic(topic: string): string {
  const parts = topic.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "syn") return parts[1] || "unknown";
  return parts[0] || "unknown";
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export interface Partition {
  date: string;
  hour: string;
  aspect: string;
  /** Relative Hive-style path `date=…/hour=…/aspect=…` (always UTC). */
  dir: string;
}

/** Hive-style UTC partition for an event-time ms + aspect. */
export function partitionOf(eventMs: number, aspect: string): Partition {
  const d = new Date(Number.isFinite(eventMs) ? eventMs : Date.now());
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const hour = pad2(d.getUTCHours());
  const a = aspect || "unknown";
  return { date, hour, aspect: a, dir: `date=${date}/hour=${hour}/aspect=${a}` };
}

function parseTsMs(v: unknown, fallbackMs: number): number {
  if (v == null) return fallbackMs;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : fallbackMs;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : fallbackMs;
}

/**
 * Expand a StreamMessage into lake rows. The tap publishes `RawTelemetrySample[]`
 * per line; each sample becomes one row stamped with topic/seq/aspect + event time.
 * A non-array payload (e.g. a derived node) becomes a single row. Fabricates nothing.
 */
export function messageToRows(msg: StreamMessage): LakeRow[] {
  const aspect = aspectOfTopic(msg.topic);
  const ingestMs = Number.isFinite(msg.ts) ? msg.ts : Date.now();
  const ingestIso = new Date(ingestMs).toISOString();
  const items: unknown[] = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
  const rows: LakeRow[] = [];
  for (const item of items) {
    const rec: Record<string, unknown> =
      item && typeof item === "object" ? (item as Record<string, unknown>) : { value: item };
    const eventMs = parseTsMs(rec.ts, ingestMs);
    rows.push({
      ...rec,
      _topic: msg.topic,
      _seq: msg.seq,
      _aspect: aspect,
      _ingest_ts: ingestIso,
      _event_ts: new Date(eventMs).toISOString(),
    });
  }
  return rows;
}

/** Group rows by their event-time UTC partition (date/hour/aspect). */
export function groupRowsByPartition(rows: LakeRow[]): Map<string, { partition: Partition; rows: LakeRow[] }> {
  const map = new Map<string, { partition: Partition; rows: LakeRow[] }>();
  for (const row of rows) {
    const eventMs = Date.parse(row._event_ts);
    const partition = partitionOf(Number.isFinite(eventMs) ? eventMs : Date.now(), row._aspect);
    let g = map.get(partition.dir);
    if (!g) {
      g = { partition, rows: [] };
      map.set(partition.dir, g);
    }
    g.rows.push(row);
  }
  return map;
}

/** NDJSON (one JSON object per line) → gzip Buffer. TODO(R4): swap for Parquet. */
export function ndjsonGzip(rows: LakeRow[]): Buffer {
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  return gzipSync(Buffer.from(ndjson, "utf8"));
}

/**
 * Idempotent-ish filename: `part-<consumer>-<loSeq>-<hiSeq>-<hash8>`. Deterministic
 * from the batch's (topic,seq) set → re-processing the SAME messages after a crash
 * re-writes the SAME file (overwrite, not duplicate). The hash disambiguates the
 * in-process case where `seq` is per-topic (nats stream seq is already global).
 */
export function partFileName(consumer: string, rows: LakeRow[]): string {
  let lo = Infinity;
  let hi = -Infinity;
  const h = createHash("sha1");
  for (const r of rows) {
    if (r._seq < lo) lo = r._seq;
    if (r._seq > hi) hi = r._seq;
    h.update(`${r._topic}#${r._seq};`);
  }
  const loStr = Number.isFinite(lo) ? lo : 0;
  const hiStr = Number.isFinite(hi) ? hi : 0;
  return `part-${consumer}-${loStr}-${hiStr}-${h.digest("hex").slice(0, 8)}.ndjson.gz`;
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITERS — local FS (default) or S3/MinIO (optional, already-present aws-sdk)
// ═══════════════════════════════════════════════════════════════════════════

interface LakeWriter {
  /** Human-readable target for boot/status logs. */
  readonly target: string;
  /** Write `data` at `<dir>/<filename>`; returns the resolved location. Idempotent overwrite. */
  write(dir: string, filename: string, data: Buffer): Promise<string>;
}

class LocalFsWriter implements LakeWriter {
  readonly target: string;
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
    this.target = `local:${this.root}`;
  }
  async write(dir: string, filename: string, data: Buffer): Promise<string> {
    const absDir = path.join(this.root, ...dir.split("/"));
    await fs.mkdir(absDir, { recursive: true });
    const finalPath = path.join(absDir, filename);
    // Write to a temp file then rename → readers never see a partial file.
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, finalPath);
    return finalPath;
  }
}

class S3Writer implements LakeWriter {
  readonly target: string;
  private readonly cfg: LakeS3Config;
  private readonly client: any;
  private readonly PutObjectCommand: any;
  private constructor(cfg: LakeS3Config, client: any, PutObjectCommand: any) {
    this.cfg = cfg;
    this.client = client;
    this.PutObjectCommand = PutObjectCommand;
    this.target = `s3:${cfg.endpoint}/${cfg.bucket}${cfg.prefix ? "/" + cfg.prefix : ""}`;
  }
  /** Computed-specifier import so tsc never hard-resolves the optional path at build. */
  static async create(cfg: LakeS3Config): Promise<S3Writer> {
    const pkg = "@aws-sdk/client-s3";
    const mod: any = await import(pkg);
    const client = new mod.S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
    });
    return new S3Writer(cfg, client, mod.PutObjectCommand);
  }
  async write(dir: string, filename: string, data: Buffer): Promise<string> {
    const key = [this.cfg.prefix, dir, filename].filter(Boolean).join("/");
    await this.client.send(
      new this.PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: data,
        // Store faithful gzip bytes (NOT ContentEncoding:gzip — lake readers want the raw .gz).
        ContentType: "application/gzip",
      }),
    );
    return `s3://${this.cfg.bucket}/${key}`;
  }
}

async function resolveWriter(): Promise<LakeWriter> {
  const s3 = lakeS3Config();
  if (s3) {
    try {
      return await S3Writer.create(s3);
    } catch (err) {
      console.error(
        `[LakeSink] S3 writer init failed (${(err as Error)?.message ?? err}); falling back to local FS ${lakeDir()}`,
      );
    }
  }
  return new LocalFsWriter(lakeDir());
}

// ═══════════════════════════════════════════════════════════════════════════
// SINK — durable NATS source (primary) or in-process bridge source (dev)
// ═══════════════════════════════════════════════════════════════════════════

export type LakeSinkMode = "off" | "nats-durable" | "bridge";

interface LakeSinkStats {
  filesWritten: number;
  rowsWritten: number;
  bytesWritten: number;
  batches: number;
  lastFlushAt: string | null;
  lastError: string | null;
}

export class LakeSink {
  private writer: LakeWriter | null = null;
  private sub: Subscription | null = null;
  private buffer: StreamMessage[] = []; // in-process source only
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private nc: any = null; // dedicated nats connection (durable source)
  private mode: LakeSinkMode = "off";
  private readonly stats: LakeSinkStats = {
    filesWritten: 0,
    rowsWritten: 0,
    bytesWritten: 0,
    batches: 0,
    lastFlushAt: null,
    lastError: null,
  };

  /**
   * Start consuming + writing. Returns the resolved mode string:
   *   "disabled" | "nats-durable" | "bridge" | "nats-unavailable". Never throws.
   */
  async start(): Promise<string> {
    if (!isLakeSinkEnabled()) return "disabled";
    if (this.running) return this.mode;
    this.writer = await resolveWriter();

    const { streamBackend, getStreamBridge } = await import("./streamBridge");
    if (streamBackend() === "nats" && natsUrl()) {
      this.running = true; // set before scheduling the fetch loop
      const ok = await this.startNatsDurableSource();
      if (ok) {
        this.mode = "nats-durable";
        return this.mode;
      }
      // Honest degrade: nats chosen but unreachable → no-op. Do NOT silently read
      // the in-process ring (a DIFFERENT, empty log) and imply durability we lack.
      this.running = false;
      this.mode = "off";
      return "nats-unavailable";
    }

    // In-process backend (dev / zero-infra): a real but NON-durable source.
    const bridge = await getStreamBridge();
    this.running = true;
    this.startBridgeSource(bridge);
    this.mode = "bridge";
    return this.mode;
  }

  private async startNatsDurableSource(): Promise<boolean> {
    try {
      const pkg = "nats";
      const mod: any = await import(pkg).catch(() => null);
      if (!mod?.connect) return false;
      const nc = await mod.connect({ servers: natsUrl(), name: "synapse-lake-sink", maxReconnectAttempts: -1 });
      this.nc = nc;

      const prefix = natsStreamPrefix();
      const stream = `${prefix}_bridge`;
      const filter = topicToSubject(lakeSourceTopic()); // syn/telemetry/* → syn.telemetry.>
      const durable = lakeConsumerName();

      const jsm = await nc.jetstreamManager();
      // Defensive: the bridge normally creates the stream on first publish; ensure it.
      try {
        await jsm.streams.add({ name: stream, subjects: [`${prefix}.>`] });
      } catch {
        /* already exists */
      }
      // Create the DURABLE, explicit-ack consumer (idempotent — ignore "exists").
      const deliver = lakeDeliverPolicy() === "new" ? mod.DeliverPolicy.New : mod.DeliverPolicy.All;
      try {
        await jsm.consumers.add(stream, {
          durable_name: durable,
          ack_policy: mod.AckPolicy.Explicit,
          deliver_policy: deliver,
          filter_subject: filter,
          ack_wait: lakeAckWaitMs() * 1_000_000, // ms → ns
          max_deliver: -1,
        });
      } catch {
        /* consumer already exists (durable resumes from its stored ack floor) */
      }

      const js = nc.jetstream();
      const consumer = await js.consumers.get(stream, durable);
      void this.runFetchLoop(consumer);

      console.log(
        `[LakeSink] durable NATS consumer '${durable}' on '${stream}' filter='${filter}' ` +
          `deliver=${lakeDeliverPolicy()} → ${this.writer!.target} ` +
          `(batch≤${lakeBatchMax()}, flush ${lakeFlushMs()}ms, ack_wait ${lakeAckWaitMs()}ms)`,
      );
      return true;
    } catch (err) {
      console.error("[LakeSink] NATS durable source init failed:", (err as Error)?.message ?? err);
      try {
        await this.nc?.drain?.();
      } catch {
        /* best-effort */
      }
      this.nc = null;
      return false;
    }
  }

  /** Pull-fetch loop: batch (size or `expires` time) → write → ack. At-least-once. */
  private async runFetchLoop(consumer: any): Promise<void> {
    const max_messages = lakeBatchMax();
    const expires = lakeFlushMs();
    while (this.running && this.nc) {
      try {
        const iter = await consumer.fetch({ max_messages, expires });
        const msgs: any[] = [];
        for await (const m of iter) msgs.push(m);
        if (msgs.length === 0) continue;
        const streamMsgs = msgs.map((m) => this.jsMsgToStreamMessage(m));
        // Write BEFORE ack — a write failure leaves the batch un-acked → redelivered.
        await this.writeMessages(streamMsgs);
        for (const m of msgs) {
          try {
            m.ack();
          } catch {
            /* not acked → redelivered after ack_wait */
          }
        }
      } catch (err) {
        this.stats.lastError = (err as Error)?.message ?? String(err);
        // Never hot-loop on a transient broker/write error.
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  private jsMsgToStreamMessage(m: any): StreamMessage {
    const subject: string = m.subject ?? "";
    const topic = subject.replace(/\./g, "/");
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(m.data).toString("utf8"));
    } catch {
      // Non-JSON payload: keep it honestly rather than dropping (never poisons the loop).
      payload = { _raw_base64: Buffer.from(m.data).toString("base64") };
    }
    const tsNanos = m.info?.timestampNanos;
    const ts = tsNanos ? Math.floor(Number(tsNanos) / 1e6) : Date.now();
    return { topic, seq: Number(m.seq ?? m.info?.streamSequence ?? 0), ts, payload };
  }

  // ── In-process (NON-durable) source ─────────────────────────────────────────

  private startBridgeSource(bridge: StreamBridge): void {
    this.sub = bridge.subscribe(lakeSourceTopic(), (m) => {
      this.buffer.push(m as StreamMessage);
      if (this.buffer.length >= lakeBatchMax()) void this.flushBuffer();
    });
    this.timer = setInterval(() => {
      void this.flushBuffer();
    }, lakeFlushMs());
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
    console.log(
      `[LakeSink] in-process NON-durable source: subscribed '${lakeSourceTopic()}' → ${this.writer!.target} ` +
        `(batch≤${lakeBatchMax()}, flush ${lakeFlushMs()}ms). Set STREAM_BRIDGE_BACKEND=nats for a durable cold tier.`,
    );
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length); // synchronous drain (no double-processing)
    try {
      await this.writeMessages(batch);
    } catch (err) {
      this.stats.lastError = (err as Error)?.message ?? String(err);
      console.error("[LakeSink] in-process flush failed (batch dropped — non-durable tier):", this.stats.lastError);
    }
  }

  // ── Shared write path ────────────────────────────────────────────────────────

  /** Convert → partition → gzip → write one file per partition. Throws on write failure. */
  private async writeMessages(msgs: StreamMessage[]): Promise<void> {
    const rows: LakeRow[] = [];
    for (const m of msgs) for (const r of messageToRows(m)) rows.push(r);
    if (rows.length === 0) return;
    const consumer = lakeConsumerName();
    for (const { partition, rows: prows } of groupRowsByPartition(rows).values()) {
      const buf = ndjsonGzip(prows);
      const filename = partFileName(consumer, prows);
      const where = await this.writer!.write(partition.dir, filename, buf);
      this.stats.filesWritten++;
      this.stats.rowsWritten += prows.length;
      this.stats.bytesWritten += buf.length;
      if (this.stats.filesWritten <= 3 || this.stats.filesWritten % 50 === 0) {
        console.log(`[LakeSink] wrote ${prows.length} row(s) (${buf.length}B gz) → ${where}`);
      }
    }
    this.stats.batches++;
    this.stats.lastFlushAt = new Date().toISOString();
    this.stats.lastError = null;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.sub) {
      try {
        await this.sub.unsubscribe();
      } catch {
        /* best-effort */
      }
      this.sub = null;
    }
    try {
      await this.flushBuffer(); // final drain of any buffered in-process messages
    } catch {
      /* best-effort */
    }
    if (this.nc) {
      try {
        await this.nc.drain();
      } catch {
        /* best-effort */
      }
      this.nc = null;
    }
    this.mode = "off";
  }

  status(): { enabled: boolean; running: boolean; mode: LakeSinkMode; target: string | null } & LakeSinkStats {
    return {
      enabled: isLakeSinkEnabled(),
      running: this.running,
      mode: this.mode,
      target: this.writer?.target ?? null,
      ...this.stats,
    };
  }
}

// ─── Module-level lifecycle (started by the app boot when the flag is on) ─────

let sink: LakeSink | null = null;

/**
 * Start the process-wide lake sink. Returns null when the flag is off (clean no-op),
 * else `{ mode, target }` for the boot log. Never throws.
 */
export async function startLakeSink(): Promise<{ mode: string; target: string | null } | null> {
  if (!isLakeSinkEnabled()) return null;
  if (!sink) sink = new LakeSink();
  const mode = await sink.start();
  return { mode, target: sink.status().target };
}

/** Stop + clear the sink (shutdown / tests / smoke). */
export async function stopLakeSink(): Promise<void> {
  if (sink) {
    await sink.stop();
    sink = null;
  }
}

export function getLakeSinkStatus() {
  return sink ? sink.status() : { enabled: isLakeSinkEnabled(), running: false, mode: "off" as LakeSinkMode };
}
