/**
 * HOT-FOLDER INGESTION service (doc 27 §3 gap C1 — P0 · Đợt 2 / agent W2-A).
 *
 * Real AOI/AVI machines (I.C.T, Saki, Mirtec, custom …) export per-board result
 * files (CSV/XML/JSON) into a local/SMB folder — the dominant integration mode of
 * commercial AOI. This service watches those folders (one chokidar watcher per
 * enabled hot_folder_configs row), parses each dropped file, normalizes it via the
 * REGISTERED vision adapter (resolved by adapterKey string — the list is never
 * hardcoded, so adapters added in parallel just work), and persists through the
 * EXISTING machineApi.submitInspection path — the exact same code path
 * visionAdapterRouter.ingest uses (no duplicated insert logic).
 *
 * PRODUCTION-GRADE FILE HANDLING:
 *   • Partial-write safety — chokidar awaitWriteFinish: a file is only processed
 *     after its size has been stable for `stabilityWindowMs` (vendor exporters
 *     write big XML/CSV in chunks; SMB flushes late).
 *   • File-lock / EBUSY retry — reads retry with exponential backoff on
 *     EBUSY/EPERM/EACCES/EAGAIN (Windows exporters keep the handle open briefly).
 *   • Idempotent dedup — ledger row in hot_folder_files with UNIQUE
 *     idempotencyKey = machineId + sha256(content) + fileName. The row is CLAIMED
 *     (status 'processing') BEFORE submitting, so identical content can never
 *     double-insert an inspection — across re-drops, restarts, and concurrent
 *     scans. A re-drop with DIFFERENT content (new hash) processes normally.
 *     Stale 'processing' claims (crash mid-flight) and previous 'error' rows are
 *     taken over and retried.
 *   • Archive / error folders — success → archivePath (default <watch>/archive);
 *     failure → errorPath (default <watch>/error) + a "<name>.reason.txt" sidecar
 *     with the exact failure reason. Moves survive cross-device (EXDEV → copy+unlink,
 *     required for SMB shares) and name collisions (timestamp suffix).
 *   • Startup catch-up — watchers run with ignoreInitial:false, so files dropped
 *     while the service was down are ingested on boot (dedup keeps it safe).
 *   • SMB fallback — configs with pollFallbackMs > 0 use stat polling instead of
 *     FS events (network shares often emit none).
 *   • Archive retention — files in archivePath older than deleteAfterDays are
 *     removed by a daily sweep (0 = keep forever).
 *
 * GATING / SAFETY: master flag HOT_FOLDER_INGEST_ENABLED (default OFF — no watcher,
 * no fs access). Every entry point is fail-safe: a bad config/file/DB error never
 * crashes the process; per-config error counters surface in the status endpoint.
 */
import fs from "node:fs";
import { appError } from "../../_core/appError";
import { DbUnavailableError } from "../../_core/dbErrors";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  hotFolderConfigs,
  hotFolderFiles,
  machines,
  type HotFolderConfig,
} from "../../../drizzle/schema";
import { getVisionAdapter } from "./index"; // side-effect: registers built-in adapters
import type { CanonicalInspection } from "./visionAdapterRegistry";
import { matchesPattern, parseResultFile, sha256Hex } from "./hotFolderParsers";

// ── Flag ──────────────────────────────────────────────────────────────────────

/** Read at call time so config toggles / tests take effect (mirrors edgeRuntimeEnabled). */
export function hotFolderIngestEnabled(): boolean {
  return (
    process.env.HOT_FOLDER_INGEST_ENABLED === "true" ||
    process.env.HOT_FOLDER_INGEST_ENABLED === "1"
  );
}

// ── db helper (fail-safe, mirrors edgeCoordinator) ───────────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

// ── Submit seam (the ONE persistence path — machineApi.submitInspection) ──────

export type SubmitInspectionFn = (
  canonical: CanonicalInspection,
) => Promise<{ inspectionId: number | null }>;

let submitOverride: SubmitInspectionFn | null = null;

/** Test-only: replace the submitInspection call (never used in production). */
export function __setSubmitForTests(fn: SubmitInspectionFn | null): void {
  submitOverride = fn;
}

/**
 * Persist a canonical inspection through the EXISTING submit pipeline —
 * machineApiRouters.processInspectionSubmission, the exact function behind
 * machineApi.submitInspection (auth → inspection row → measurements/images →
 * NG/MQTT alerts → cache invalidation; also the WAL replay path). Called with
 * rateLimit:false because the hot folder is a trusted internal caller with its
 * own idempotency ledger — a startup catch-up scan of hundreds of files must
 * not trip the per-machine LIVE ingest rate limit (same rule as WAL backfill).
 * Dynamic import keeps this module light for unit tests and avoids load-order
 * coupling with the router module.
 */
async function submitCanonical(canonical: CanonicalInspection): Promise<{ inspectionId: number | null }> {
  if (submitOverride) return submitOverride(canonical);
  const { processInspectionSubmission } = await import("../../routers/machineApiRouters");
  const result = await processInspectionSubmission(
    canonical as Parameters<typeof processInspectionSubmission>[0],
    { rateLimit: false },
  );
  return { inspectionId: result.inspectionId ?? null };
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/** Extensions/prefixes that must never be ingested (sidecars, temp/partial files).
 *  Includes the V12/V13 height-map depth sidecars (`<stem>.heightmap.*`) — those are
 *  consumed by the height-map seam (vision/heightMapSource.ts), never as results. */
const IGNORED_SUFFIXES = [
  ".reason.txt", ".tmp", ".part", ".partial", ".writing", ".lock", ".crdownload", "~",
  ".heightmap.json", ".heightmap.csv", ".heightmap.png",
];

/** Whether a base file name is a candidate for ingestion under this config. */
export function shouldProcessFileName(baseName: string, filePattern: string): boolean {
  if (!baseName || baseName.startsWith(".")) return false;
  const lower = baseName.toLowerCase();
  if (IGNORED_SUFFIXES.some((s) => lower.endsWith(s))) return false;
  return matchesPattern(baseName, filePattern);
}

/** Resolve archive/error dirs with their <watchPath>/... defaults. */
export function resolveConfigDirs(cfg: Pick<HotFolderConfig, "watchPath" | "archivePath" | "errorPath">): {
  archiveDir: string;
  errorDir: string;
} {
  return {
    archiveDir: cfg.archivePath?.trim() || path.join(cfg.watchPath, "archive"),
    errorDir: cfg.errorPath?.trim() || path.join(cfg.watchPath, "error"),
  };
}

/** Dedup anchor: machine + content-hash + filename (matches the DB unique index). */
export function buildIdempotencyKey(machineId: number, contentHash: string, fileName: string): string {
  return `${machineId}:${contentHash}:${fileName}`.slice(0, 700);
}

/** chokidar options for one config (exported so tests can assert the safety knobs). */
export function buildWatchOptions(cfg: Pick<HotFolderConfig, "stabilityWindowMs" | "pollFallbackMs">) {
  const stability = Math.max(200, cfg.stabilityWindowMs ?? 2000);
  const usePolling = (cfg.pollFallbackMs ?? 0) > 0;
  return {
    // Catch-up: report files that already exist at watch start (dedup keeps it safe).
    ignoreInitial: false,
    // Partial-write safety: size must be stable for the whole window before "add" fires.
    awaitWriteFinish: {
      stabilityThreshold: stability,
      pollInterval: Math.min(500, Math.max(100, Math.floor(stability / 4))),
    },
    // SMB/NFS shares often emit no FS events — fall back to stat polling.
    usePolling,
    interval: usePolling ? Math.max(250, cfg.pollFallbackMs) : 1000,
    // Only the folder itself — archive/ and error/ subfolders are never re-ingested.
    depth: 0,
    alwaysStat: false,
  } as const;
}

// ── Retry / move primitives ───────────────────────────────────────────────────

const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "EACCES", "EAGAIN", "EMFILE", "ENFILE"]);

export interface ReadRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Injected for tests. */
  readFn?: (p: string) => Promise<Buffer>;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Read a file, retrying with exponential backoff on transient lock errors
 * (EBUSY/EPERM/EACCES/… — Windows exporters and SMB keep handles open briefly).
 * Returns null when the file vanished (ENOENT — exporter renamed/moved it).
 */
export async function readFileWithRetry(filePath: string, opts?: ReadRetryOptions): Promise<Buffer | null> {
  const attempts = Math.max(1, opts?.attempts ?? 5);
  const base = Math.max(10, opts?.baseDelayMs ?? 250);
  const readFn = opts?.readFn ?? ((p: string) => fs.promises.readFile(p));
  const sleep = opts?.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let i = 0; i < attempts; i++) {
    try {
      return await readFn(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return null; // vanished — someone else moved it
      if (!code || !RETRYABLE_CODES.has(code) || i === attempts - 1) throw err;
      await sleep(base * 2 ** i);
    }
  }
  return null; // unreachable
}

/**
 * Move a file into destDir. Handles: missing destDir (mkdir -p), name collisions
 * (timestamp suffix), and cross-device moves (EXDEV → copy + unlink, required when
 * archive lives on a different volume than an SMB watch folder).
 */
export async function moveFileSafe(srcPath: string, destDir: string): Promise<string> {
  await fs.promises.mkdir(destDir, { recursive: true });
  const base = path.basename(srcPath);
  let dest = path.join(destDir, base);
  if (fs.existsSync(dest)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    dest = path.join(destDir, `${stem}-${Date.now()}${ext}`);
  }
  try {
    await fs.promises.rename(srcPath, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EXDEV") {
      await fs.promises.copyFile(srcPath, dest);
      await fs.promises.unlink(srcPath);
    } else {
      throw err;
    }
  }
  return dest;
}

// ── Runtime state (per config) ────────────────────────────────────────────────

interface ConfigRuntime {
  watcher: FSWatcher | null;
  /** Serial processing queue — one file at a time per config (no stampede). */
  queue: Promise<void>;
  watching: boolean;
  usePolling: boolean;
  startedAt: Date | null;
  lastFile: string | null;
  lastFileAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  processedCount: number;
  errorCount: number;
  duplicateCount: number;
}

const runtimes = new Map<number, ConfigRuntime>();
let running = false;
let sweepTimer: NodeJS.Timeout | null = null;

function getRuntime(configId: number): ConfigRuntime {
  let rt = runtimes.get(configId);
  if (!rt) {
    rt = {
      watcher: null,
      queue: Promise.resolve(),
      watching: false,
      usePolling: false,
      startedAt: null,
      lastFile: null,
      lastFileAt: null,
      lastError: null,
      lastErrorAt: null,
      processedCount: 0,
      errorCount: 0,
      duplicateCount: 0,
    };
    runtimes.set(configId, rt);
  }
  return rt;
}

function recordError(rt: ConfigRuntime, message: string): void {
  rt.lastError = message.slice(0, 2000);
  rt.lastErrorAt = new Date();
  rt.errorCount++;
}

// ── The processing pipeline ───────────────────────────────────────────────────

export type ProcessOutcome = "processed" | "duplicate" | "error" | "skipped";

export interface ProcessFileResult {
  outcome: ProcessOutcome;
  /** null = accepted but queued in the durable WAL (DB flapped mid-submit). */
  inspectionId?: number | null;
  reason?: string;
  movedTo?: string;
}

/** Claims older than this are considered crashed mid-flight and retried. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface ProcessDeps {
  submit?: SubmitInspectionFn;
  read?: ReadRetryOptions;
  nowFn?: () => Date;
}

/**
 * Process ONE dropped file end-to-end: read (lock-retry) → hash → claim ledger row
 * (idempotent) → parse → adapter.normalize → submitInspection → archive; any failure
 * → errorPath + .reason.txt sidecar + ledger status 'error'. Never throws.
 */
export async function processHotFolderFile(
  cfg: HotFolderConfig,
  filePath: string,
  deps?: ProcessDeps,
): Promise<ProcessFileResult> {
  const rt = getRuntime(cfg.id);
  const baseName = path.basename(filePath);
  const now = deps?.nowFn ?? (() => new Date());
  const { archiveDir, errorDir } = resolveConfigDirs(cfg);

  if (!shouldProcessFileName(baseName, cfg.filePattern)) {
    return { outcome: "skipped", reason: "name does not match filePattern / temp file" };
  }

  // Never ingest our own archive/error output even if misconfigured to overlap.
  const parent = path.resolve(path.dirname(filePath));
  if (parent === path.resolve(archiveDir) || parent === path.resolve(errorDir)) {
    return { outcome: "skipped", reason: "inside archive/error folder" };
  }

  // ── 1. Read (transient-lock retry) ──
  let buf: Buffer | null;
  try {
    buf = await readFileWithRetry(filePath, deps?.read);
  } catch (err) {
    const reason = `Read failed: ${err instanceof Error ? err.message : String(err)}`;
    recordError(rt, `${baseName}: ${reason}`);
    const movedTo = await quarantine(filePath, errorDir, reason);
    await recordLedger(cfg, baseName, "unreadable", "error", { errorReason: reason });
    return { outcome: "error", reason, movedTo };
  }
  if (buf === null) return { outcome: "skipped", reason: "file vanished before read" };

  const contentHash = sha256Hex(buf);
  const idempotencyKey = buildIdempotencyKey(cfg.machineId, contentHash, baseName);

  // ── 2. Claim the ledger row (idempotent dedup, crash-safe) ──
  let claim: { claimed: boolean; rowId?: number; reason?: string };
  try {
    claim = await claimLedgerRow(cfg, baseName, contentHash, idempotencyKey, now());
  } catch (err) {
    const reason = `Ledger claim failed: ${err instanceof Error ? err.message : String(err)}`;
    recordError(rt, `${baseName}: ${reason}`);
    // Leave the file in place — with no ledger claim we must not risk losing it.
    return { outcome: "error", reason };
  }
  if (!claim.claimed) {
    rt.duplicateCount++;
    rt.lastFile = baseName;
    rt.lastFileAt = now();
    // Identical content already ingested — archive the re-drop (suffix keeps both).
    const movedTo = await moveQuietly(filePath, archiveDir);
    return { outcome: "duplicate", reason: claim.reason, movedTo };
  }

  // ── 3. Parse → normalize → submit ──
  try {
    const { payload } = parseResultFile(baseName, buf.toString("utf8"));

    const adapter = getVisionAdapter(cfg.adapterKey); // throws a clear Error for unknown keys

    const machineRows = await (await db())
      .select()
      .from(machines)
      .where(eq(machines.id, cfg.machineId))
      .limit(1);
    const machine = machineRows[0];
    if (!machine) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, `Machine id=${cfg.machineId} not found`);

    const canonical = adapter.normalize(payload, { machineCode: machine.code });
    if (!canonical.machineCode && !canonical.apiKey) canonical.machineCode = machine.code;

    // V13 (doc 27 Đợt 7.6) — native SPI enrichment via the height-map seam. The hot
    // folder is where the "file" kind is real: a depth sidecar (<stem>.heightmap.*)
    // dropped next to the result file. Flag-gated (SPI_3D_NATIVE_ENABLED) and
    // fail-safe: any error degrades to the untouched canonical (never blocks ingest).
    let toSubmit = canonical;
    try {
      const { maybeEnrichCanonicalWithHeightMap } = await import("./heightMapSource");
      const enrichment = await maybeEnrichCanonicalWithHeightMap(canonical, {
        machineCode: machine.code,
        resultFilePath: filePath,
      });
      toSubmit = enrichment.canonical;
    } catch {
      /* 3D enrichment must never block ingest */
    }

    const submit = deps?.submit ?? submitCanonical;
    const { inspectionId } = await submit(toSubmit);

    await updateLedger(claim.rowId!, { status: "processed", inspectionId, errorReason: null });

    const movedTo = await moveFileSafe(filePath, archiveDir);
    rt.processedCount++;
    rt.lastFile = baseName;
    rt.lastFileAt = now();
    return { outcome: "processed", inspectionId, movedTo };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordError(rt, `${baseName}: ${reason}`);
    rt.lastFile = baseName;
    rt.lastFileAt = now();
    try {
      await updateLedger(claim.rowId!, { status: "error", errorReason: reason.slice(0, 4000) });
    } catch {
      /* ledger update must not mask the real failure */
    }
    const movedTo = await quarantine(filePath, errorDir, reason);
    return { outcome: "error", reason, movedTo };
  }
}

/** Move to errorDir + write "<name>.reason.txt" sidecar. Never throws. */
async function quarantine(filePath: string, errorDir: string, reason: string): Promise<string | undefined> {
  try {
    const movedTo = await moveFileSafe(filePath, errorDir);
    const sidecar = `${movedTo}.reason.txt`;
    await fs.promises.writeFile(
      sidecar,
      `Hot-folder ingest failed at ${new Date().toISOString()}\nFile: ${path.basename(filePath)}\nReason: ${reason}\n`,
      "utf8",
    );
    return movedTo;
  } catch (err) {
    console.error(
      `[HotFolder] failed to quarantine ${filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

/** Archive a duplicate re-drop quietly (a move failure only logs). */
async function moveQuietly(filePath: string, destDir: string): Promise<string | undefined> {
  try {
    return await moveFileSafe(filePath, destDir);
  } catch (err) {
    console.error(`[HotFolder] failed to archive ${filePath}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

// ── Ledger (claim → update) ───────────────────────────────────────────────────

async function claimLedgerRow(
  cfg: HotFolderConfig,
  fileName: string,
  contentHash: string,
  idempotencyKey: string,
  now: Date,
): Promise<{ claimed: boolean; rowId?: number; reason?: string }> {
  const d = await db();
  try {
    const inserted = await d
      .insert(hotFolderFiles)
      .values({
        configId: cfg.id,
        machineId: cfg.machineId,
        fileName: fileName.slice(0, 512),
        contentHash,
        idempotencyKey,
        status: "processing",
        processedAt: now,
      })
      .returning();
    return { claimed: true, rowId: inserted[0]!.id };
  } catch (err) {
    if ((err as { code?: string })?.code !== "23505") throw err;
  }

  // Unique hit → identical content was seen before. Decide takeover vs duplicate.
  const existingRows = await d
    .select()
    .from(hotFolderFiles)
    .where(eq(hotFolderFiles.idempotencyKey, idempotencyKey))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    // Row vanished between insert-conflict and select (concurrent cleanup) — treat as duplicate.
    return { claimed: false, reason: "duplicate (ledger row concurrent)" };
  }
  const staleClaim =
    existing.status === "processing" &&
    now.getTime() - new Date(existing.processedAt as unknown as string | Date).getTime() > STALE_CLAIM_MS;

  if (existing.status === "error" || staleClaim) {
    // Previous attempt failed or crashed mid-flight → take over and retry.
    await d
      .update(hotFolderFiles)
      .set({ status: "processing", processedAt: now, errorReason: null })
      .where(eq(hotFolderFiles.id, existing.id));
    return { claimed: true, rowId: existing.id };
  }
  return {
    claimed: false,
    reason: `duplicate (already ${existing.status}${existing.inspectionId ? `, inspection #${existing.inspectionId}` : ""})`,
  };
}

async function updateLedger(
  rowId: number,
  patch: { status: string; inspectionId?: number | null; errorReason?: string | null },
): Promise<void> {
  const d = await db();
  await d
    .update(hotFolderFiles)
    .set({ ...patch, processedAt: new Date() })
    .where(eq(hotFolderFiles.id, rowId));
}

async function recordLedger(
  cfg: HotFolderConfig,
  fileName: string,
  contentHash: string,
  status: string,
  extra?: { errorReason?: string },
): Promise<void> {
  try {
    const d = await db();
    await d.insert(hotFolderFiles).values({
      configId: cfg.id,
      machineId: cfg.machineId,
      fileName: fileName.slice(0, 512),
      contentHash,
      idempotencyKey: buildIdempotencyKey(cfg.machineId, `${contentHash}-${Date.now()}`, fileName),
      status,
      errorReason: extra?.errorReason?.slice(0, 4000),
    });
  } catch {
    /* best-effort bookkeeping — never masks the pipeline outcome */
  }
}

// ── Watcher lifecycle ─────────────────────────────────────────────────────────

function enqueue(cfg: HotFolderConfig, filePath: string): void {
  const rt = getRuntime(cfg.id);
  rt.queue = rt.queue
    .then(() => processHotFolderFile(cfg, filePath))
    .then((r) => {
      if (r.outcome === "processed") {
        console.log(`[HotFolder] cfg#${cfg.id} ingested ${path.basename(filePath)} → inspection #${r.inspectionId}`);
      } else if (r.outcome === "error") {
        console.error(`[HotFolder] cfg#${cfg.id} FAILED ${path.basename(filePath)}: ${r.reason}`);
      }
    })
    .catch((err) => {
      // processHotFolderFile never throws, but the chain must never break.
      console.error(`[HotFolder] cfg#${cfg.id} queue error:`, err instanceof Error ? err.message : err);
    });
}

function startWatcherFor(cfg: HotFolderConfig): void {
  const rt = getRuntime(cfg.id);
  if (rt.watcher) return; // already watching

  if (!cfg.watchPath?.trim() || !fs.existsSync(cfg.watchPath)) {
    recordError(rt, `watchPath does not exist: ${cfg.watchPath}`);
    rt.watching = false;
    console.error(`[HotFolder] cfg#${cfg.id} watchPath missing/unreachable: ${cfg.watchPath}`);
    return;
  }

  const options = buildWatchOptions(cfg);
  const watcher = watch(cfg.watchPath, options);

  watcher.on("add", (filePath) => {
    const base = path.basename(filePath);
    if (!shouldProcessFileName(base, cfg.filePattern)) return;
    enqueue(cfg, filePath);
  });
  watcher.on("error", (err) => {
    recordError(rt, `watcher error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[HotFolder] cfg#${cfg.id} watcher error:`, err instanceof Error ? err.message : err);
  });

  rt.watcher = watcher;
  rt.watching = true;
  rt.usePolling = options.usePolling;
  rt.startedAt = new Date();
  console.log(
    `[HotFolder] cfg#${cfg.id} watching ${cfg.watchPath} (pattern=${cfg.filePattern}, ` +
      `stability=${cfg.stabilityWindowMs}ms${options.usePolling ? `, polling=${cfg.pollFallbackMs}ms` : ""})`,
  );
}

async function stopWatcherFor(configId: number): Promise<void> {
  const rt = runtimes.get(configId);
  if (!rt?.watcher) return;
  const w = rt.watcher;
  rt.watcher = null;
  rt.watching = false;
  try {
    await w.close();
  } catch {
    /* closing must never throw */
  }
}

/**
 * Start watchers for every enabled config + the daily archive-retention sweep.
 * No-op (with a log line) when HOT_FOLDER_INGEST_ENABLED is off. Fail-safe: a bad
 * config never prevents the others from starting; a DB outage logs and returns.
 */
export async function startHotFolderIngest(): Promise<{ started: boolean; watchers: number }> {
  if (!hotFolderIngestEnabled()) {
    console.log("[HotFolder] disabled (set HOT_FOLDER_INGEST_ENABLED=true to enable)");
    return { started: false, watchers: 0 };
  }
  if (running) return { started: true, watchers: [...runtimes.values()].filter((r) => r.watching).length };
  running = true;

  let configs: HotFolderConfig[] = [];
  try {
    configs = await (await db())
      .select()
      .from(hotFolderConfigs)
      .where(eq(hotFolderConfigs.enabled, true));
  } catch (err) {
    console.error("[HotFolder] could not load configs:", err instanceof Error ? err.message : err);
    return { started: true, watchers: 0 };
  }

  for (const cfg of configs) {
    try {
      startWatcherFor(cfg);
    } catch (err) {
      recordError(getRuntime(cfg.id), err instanceof Error ? err.message : String(err));
      console.error(`[HotFolder] cfg#${cfg.id} failed to start:`, err instanceof Error ? err.message : err);
    }
  }

  // Daily archive-retention sweep (deleteAfterDays per config; 0 = keep forever).
  sweepTimer = setInterval(() => {
    void sweepArchives().catch((e) =>
      console.error("[HotFolder] archive sweep failed:", e instanceof Error ? e.message : e),
    );
  }, 24 * 60 * 60 * 1000);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  const active = [...runtimes.values()].filter((r) => r.watching).length;
  console.log(`[HotFolder] enabled — ${active}/${configs.length} folder watcher(s) active`);
  return { started: true, watchers: active };
}

/** Graceful stop: close every watcher + the sweep timer (used on SIGTERM/SIGINT). */
export async function stopHotFolderIngest(): Promise<void> {
  running = false;
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  await Promise.all([...runtimes.keys()].map((id) => stopWatcherFor(id)));
}

/** Restart the watcher of ONE config after a CRUD change (create/update/delete). */
export async function refreshConfigWatcher(configId: number): Promise<void> {
  await stopWatcherFor(configId);
  if (!running || !hotFolderIngestEnabled()) return;
  try {
    const rows = await (await db())
      .select()
      .from(hotFolderConfigs)
      .where(and(eq(hotFolderConfigs.id, configId), eq(hotFolderConfigs.enabled, true)))
      .limit(1);
    if (rows[0]) startWatcherFor(rows[0]);
  } catch (err) {
    console.error(`[HotFolder] refresh cfg#${configId} failed:`, err instanceof Error ? err.message : err);
  }
}

/** Test-only: wipe runtime state so tests do not leak watchers/counters. */
export async function __resetHotFolderRuntimeForTests(): Promise<void> {
  await stopHotFolderIngest();
  runtimes.clear();
  submitOverride = null;
}

// ── Archive retention sweep ───────────────────────────────────────────────────

/** Delete archived files older than each config's deleteAfterDays (0 = keep). */
export async function sweepArchives(nowMs = Date.now()): Promise<{ deleted: number }> {
  let deleted = 0;
  let configs: HotFolderConfig[] = [];
  try {
    configs = await (await db()).select().from(hotFolderConfigs);
  } catch {
    return { deleted };
  }
  for (const cfg of configs) {
    const days = cfg.deleteAfterDays ?? 0;
    if (days <= 0) continue;
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    const { archiveDir } = resolveConfigDirs(cfg);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(archiveDir, { withFileTypes: true });
    } catch {
      continue; // no archive yet
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const p = path.join(archiveDir, e.name);
      try {
        const st = await fs.promises.stat(p);
        if (st.mtimeMs < cutoff) {
          await fs.promises.unlink(p);
          deleted++;
        }
      } catch {
        /* file vanished mid-sweep */
      }
    }
  }
  if (deleted > 0) console.log(`[HotFolder] archive sweep removed ${deleted} expired file(s)`);
  return { deleted };
}

// ── Manual "process folder now" (also the catch-up primitive) ────────────────

export interface ScanResult {
  scanned: number;
  processed: number;
  duplicates: number;
  errors: number;
  skipped: number;
}

/**
 * Scan a config's watchPath once and run every matching file through the SAME
 * pipeline (dedup makes this always safe to call). Used by the router's manual
 * trigger and usable as a poll-style fallback.
 */
export async function scanConfigNow(configId: number, deps?: ProcessDeps): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, processed: 0, duplicates: 0, errors: 0, skipped: 0 };
  const rows = await (await db())
    .select()
    .from(hotFolderConfigs)
    .where(eq(hotFolderConfigs.id, configId))
    .limit(1);
  const cfg = rows[0];
  if (!cfg) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "hotFolderConfig" }, `Hot-folder config #${configId} not found`);

  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(cfg.watchPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read watchPath "${cfg.watchPath}": ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!shouldProcessFileName(e.name, cfg.filePattern)) continue;
    result.scanned++;
    const r = await processHotFolderFile(cfg, path.join(cfg.watchPath, e.name), deps);
    if (r.outcome === "processed") result.processed++;
    else if (r.outcome === "duplicate") result.duplicates++;
    else if (r.outcome === "error") result.errors++;
    else result.skipped++;
  }
  return result;
}

// ── Dry-run (wizard "test a sample file" — parses + normalizes, persists NOTHING) ──

export interface DryRunInput {
  adapterKey: string;
  fileName: string;
  content: string;
  machineCode?: string;
}

export type DryRunResult =
  | {
      ok: true;
      format: string;
      canonical: CanonicalInspection;
      summary: {
        serialNumber: string;
        overallResult: string;
        measurementCount: number;
        ngCount: number;
        machineIdentityResolved: boolean;
      };
    }
  | { ok: false; stage: "parse" | "normalize"; error: string };

/** Pure preview: file text → parse → adapter.normalize. NO db, NO fs, NO persist. */
export function dryRunSample(input: DryRunInput): DryRunResult {
  let parsed;
  try {
    parsed = parseResultFile(input.fileName, input.content);
  } catch (err) {
    return { ok: false, stage: "parse", error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const adapter = getVisionAdapter(input.adapterKey);
    const canonical = adapter.normalize(parsed.payload, { machineCode: input.machineCode });
    return {
      ok: true,
      format: parsed.format,
      canonical,
      summary: {
        serialNumber: canonical.serialNumber,
        overallResult: canonical.overallResult,
        measurementCount: canonical.measurements.length,
        ngCount: canonical.measurements.filter((m) => m.result === "NG").length,
        machineIdentityResolved: Boolean(canonical.machineCode || canonical.apiKey),
      },
    };
  } catch (err) {
    return { ok: false, stage: "normalize", error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Config CRUD (used by hotFolderRouter — validation lives here) ─────────────

export interface HotFolderConfigInput {
  machineId: number;
  adapterKey: string;
  watchPath: string;
  filePattern?: string;
  archivePath?: string | null;
  errorPath?: string | null;
  enabled?: boolean;
  pollFallbackMs?: number;
  stabilityWindowMs?: number;
  deleteAfterDays?: number;
}

function validateConfigInput(input: Partial<HotFolderConfigInput>): void {
  if (input.adapterKey !== undefined) {
    getVisionAdapter(input.adapterKey); // throws "No vision adapter registered …"
  }
  if (input.watchPath !== undefined) {
    const p = input.watchPath.trim();
    if (!p) throw new Error("watchPath is required");
    if (!path.isAbsolute(p)) throw new Error(`watchPath must be an absolute path (got "${p}")`);
  }
  for (const key of ["archivePath", "errorPath"] as const) {
    const v = input[key];
    if (v != null && v.trim() && !path.isAbsolute(v.trim())) {
      throw new Error(`${key} must be an absolute path (got "${v}")`);
    }
  }
}

async function assertMachineExists(machineId: number): Promise<void> {
  const rows = await (await db()).select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!rows[0]) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, `Machine id=${machineId} not found`);
}

export async function listHotFolderConfigs(): Promise<HotFolderConfig[]> {
  return (await db()).select().from(hotFolderConfigs).orderBy(asc(hotFolderConfigs.id));
}

export async function createHotFolderConfig(input: HotFolderConfigInput): Promise<HotFolderConfig> {
  validateConfigInput(input);
  await assertMachineExists(input.machineId);
  const inserted = await (await db())
    .insert(hotFolderConfigs)
    .values({
      machineId: input.machineId,
      adapterKey: input.adapterKey.trim(),
      watchPath: input.watchPath.trim(),
      filePattern: input.filePattern?.trim() || "*.{csv,xml,json}",
      archivePath: input.archivePath?.trim() || null,
      errorPath: input.errorPath?.trim() || null,
      enabled: input.enabled ?? true,
      pollFallbackMs: Math.max(0, input.pollFallbackMs ?? 0),
      stabilityWindowMs: Math.max(200, input.stabilityWindowMs ?? 2000),
      deleteAfterDays: Math.max(0, input.deleteAfterDays ?? 30),
    })
    .returning();
  const cfg = inserted[0]!;
  await refreshConfigWatcher(cfg.id);
  return cfg;
}

export async function updateHotFolderConfig(
  id: number,
  patch: Partial<HotFolderConfigInput>,
): Promise<HotFolderConfig> {
  validateConfigInput(patch);
  if (patch.machineId !== undefined) await assertMachineExists(patch.machineId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.machineId !== undefined) set.machineId = patch.machineId;
  if (patch.adapterKey !== undefined) set.adapterKey = patch.adapterKey.trim();
  if (patch.watchPath !== undefined) set.watchPath = patch.watchPath.trim();
  if (patch.filePattern !== undefined) set.filePattern = patch.filePattern.trim() || "*.{csv,xml,json}";
  if (patch.archivePath !== undefined) set.archivePath = patch.archivePath?.trim() || null;
  if (patch.errorPath !== undefined) set.errorPath = patch.errorPath?.trim() || null;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.pollFallbackMs !== undefined) set.pollFallbackMs = Math.max(0, patch.pollFallbackMs);
  if (patch.stabilityWindowMs !== undefined) set.stabilityWindowMs = Math.max(200, patch.stabilityWindowMs);
  if (patch.deleteAfterDays !== undefined) set.deleteAfterDays = Math.max(0, patch.deleteAfterDays);

  const updated = await (await db())
    .update(hotFolderConfigs)
    .set(set)
    .where(eq(hotFolderConfigs.id, id))
    .returning();
  if (!updated[0]) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "hotFolderConfig" }, `Hot-folder config #${id} not found`);
  await refreshConfigWatcher(id);
  return updated[0];
}

export async function deleteHotFolderConfig(id: number): Promise<HotFolderConfig> {
  await stopWatcherFor(id);
  const removed = await (await db())
    .delete(hotFolderConfigs)
    .where(eq(hotFolderConfigs.id, id))
    .returning();
  if (!removed[0]) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "hotFolderConfig" }, `Hot-folder config #${id} not found`);
  runtimes.delete(id);
  return removed[0];
}

// ── Status (config + live runtime, honest about what is actually watching) ───

export interface HotFolderStatusRow {
  config: HotFolderConfig;
  watching: boolean;
  usePolling: boolean;
  startedAt: Date | null;
  lastFile: string | null;
  lastFileAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  processedCount: number;
  errorCount: number;
  duplicateCount: number;
}

export async function getHotFolderStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  configs: HotFolderStatusRow[];
}> {
  let configs: HotFolderConfig[] = [];
  try {
    configs = await listHotFolderConfigs();
  } catch {
    /* DB down → still report flag state honestly */
  }
  return {
    enabled: hotFolderIngestEnabled(),
    running,
    configs: configs.map((config) => {
      const rt = runtimes.get(config.id);
      return {
        config,
        watching: rt?.watching ?? false,
        usePolling: rt?.usePolling ?? false,
        startedAt: rt?.startedAt ?? null,
        lastFile: rt?.lastFile ?? null,
        lastFileAt: rt?.lastFileAt ?? null,
        lastError: rt?.lastError ?? null,
        lastErrorAt: rt?.lastErrorAt ?? null,
        processedCount: rt?.processedCount ?? 0,
        errorCount: rt?.errorCount ?? 0,
        duplicateCount: rt?.duplicateCount ?? 0,
      };
    }),
  };
}

/** Recent ledger rows for ONE config (newest first) — the UI's audit tail. */
export async function listRecentHotFolderFiles(configId: number, limit = 20) {
  return (await db())
    .select()
    .from(hotFolderFiles)
    .where(eq(hotFolderFiles.configId, configId))
    .orderBy(desc(hotFolderFiles.processedAt))
    .limit(Math.min(100, Math.max(1, limit)));
}
