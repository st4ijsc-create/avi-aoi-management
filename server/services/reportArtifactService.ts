/**
 * Report Artifact Service (doc 32 Wave R2 · §3 archive layer · decision #4).
 * ============================================================================
 * THE SINGLE PERSISTENCE PATH for every rendered report file. On-demand (web),
 * scheduled, external (mobile / third-party) and future callers all funnel
 * their bytes through `persistArtifact` so a report can be re-downloaded from a
 * stable, retention-governed store instead of the pre-R2 mix of a volatile
 * in-memory Map (TTL 30'), base64 blobs and ad-hoc S3 keys.
 *
 * Pipeline: bytes → storagePut (server/storage.ts — S3/Forge or local FS) +
 * one `report_artifacts` row (sha256 + size + expiresAt = now + retention). The
 * daily cleanup job (REPORT_ARTIFACT_CLEANUP_ENABLED, default true) deletes the
 * storage object AND the row once expiresAt has passed — retention default 365
 * days (decision #4: >= 1 year), env REPORT_ARTIFACT_RETENTION_DAYS.
 *
 * ACCESS CONTROL: an artifact is readable by its creator, or by a privileged
 * role (admin / supervisor / quality_inspector). System / scheduled artifacts
 * (createdBy = NULL) are readable only by privileged roles.
 *
 * This module owns ONLY persistence + retrieval + retention. It does NOT render
 * bytes (that is universalExportService / the render engine, R2-A) — it takes a
 * finished buffer and archives it.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, lt, sql, type SQL } from "drizzle-orm";
import { getDb, getJobsDb } from "../db/connection";
import { reportArtifacts, type ReportArtifact } from "../../drizzle/schema/reportArtifact";

// ── Domain vocab ──────────────────────────────────────────────────────────────

export type ReportArtifactFormat = "pdf" | "xlsx" | "csv" | "html" | "pptx";
export type ReportArtifactSource = "on_demand" | "scheduled" | "external" | "mobile";

export const ARTIFACT_FORMATS: ReportArtifactFormat[] = ["pdf", "xlsx", "csv", "html", "pptx"];
export const ARTIFACT_SOURCES: ReportArtifactSource[] = ["on_demand", "scheduled", "external", "mobile"];

/** Minimal viewer shape for access checks (a tRPC ctx.user or an API principal). */
export interface ArtifactViewer {
  id?: number | null;
  role?: string | null;
  /** Trusted server-to-server principal (valid scoped API key) — privileged read. */
  privileged?: boolean;
}

const PRIVILEGED_ROLES = new Set(["admin", "supervisor", "quality_inspector"]);

/** Reasons a request against an artifact can be denied. */
export type ArtifactErrorReason = "not_found" | "forbidden" | "expired";

export class ArtifactError extends Error {
  constructor(public readonly reason: ArtifactErrorReason, message?: string) {
    super(message ?? reason);
    this.name = "ArtifactError";
  }
}

// ── Pure helpers (unit-testable, no I/O) ───────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 365;

export function resolveRetentionDays(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) return override;
  const env = Number(process.env.REPORT_ARTIFACT_RETENTION_DAYS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_RETENTION_DAYS;
}

const CONTENT_TYPE_BY_FORMAT: Record<ReportArtifactFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function contentTypeForFormat(format: ReportArtifactFormat): string {
  return CONTENT_TYPE_BY_FORMAT[format] ?? "application/octet-stream";
}

export function sha256Hex(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Deterministic storage key: report-artifacts/{yyyy}/{mm}/{hash}.{ext}. Hash-based
 * so identical bytes map to the same object (idempotent storagePut) — pairs with
 * content-hash dedupe below.
 */
export function buildStorageKey(hash: string, format: ReportArtifactFormat, at: Date = new Date()): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `report-artifacts/${yyyy}/${mm}/${hash}.${format}`;
}

/** Auth-gated REST re-download path (decision #5 — mobile opens this web link). */
export function artifactDownloadPath(id: number): string {
  return `/api/reports/artifacts/${id}/download`;
}

/** Creator OR privileged role. System artifacts (createdBy NULL) → privileged only. */
export function canAccessArtifact(
  viewer: ArtifactViewer | null | undefined,
  artifact: Pick<ReportArtifact, "createdBy">,
): boolean {
  if (!viewer) return false;
  if (viewer.privileged) return true;
  if (viewer.role && PRIVILEGED_ROLES.has(viewer.role)) return true;
  return artifact.createdBy != null && viewer.id != null && artifact.createdBy === viewer.id;
}

export function isExpired(artifact: Pick<ReportArtifact, "expiresAt">, now: Date = new Date()): boolean {
  return artifact.expiresAt != null && artifact.expiresAt.getTime() <= now.getTime();
}

// ── persistArtifact — the single write path ────────────────────────────────────

export interface PersistArtifactInput {
  buffer: Buffer | Uint8Array;
  format: ReportArtifactFormat;
  reportType: string;
  title?: string | null;
  params?: Record<string, unknown> | null;
  createdBy?: number | null;
  source?: ReportArtifactSource;
  contentType?: string;
  /** Return an existing non-expired artifact with the same bytes instead of re-uploading. Default true. */
  dedupe?: boolean;
  /** Override retention window in days (default env REPORT_ARTIFACT_RETENTION_DAYS or 365). */
  retentionDays?: number;
}

export interface PersistArtifactResult {
  id: number;
  storageKey: string;
  storageUrl: string;
  downloadUrl: string;
  fileHash: string;
  fileSize: number;
  expiresAt: Date;
  /** True when an identical prior artifact was returned (no new upload/row). */
  deduped: boolean;
}

/**
 * Store report bytes on the storage layer + record one report_artifacts row.
 * Fails loudly (throws) if the DB is unavailable — a report the caller believes
 * was archived must actually be archived.
 */
export async function persistArtifact(input: PersistArtifactInput): Promise<PersistArtifactResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available — cannot persist report artifact");

  const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer);
  const fileHash = sha256Hex(buffer);
  const fileSize = buffer.length;
  const format = input.format;
  const reportType = input.reportType;
  const dedupe = input.dedupe !== false;

  // Content-hash dedupe: same bytes + type + format, still within retention.
  if (dedupe) {
    const existing = await db
      .select()
      .from(reportArtifacts)
      .where(
        and(
          eq(reportArtifacts.fileHash, fileHash),
          eq(reportArtifacts.reportType, reportType),
          eq(reportArtifacts.format, format),
          gt(reportArtifacts.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(reportArtifacts.createdAt))
      .limit(1);
    const hit = existing[0];
    if (hit) {
      return {
        id: hit.id,
        storageKey: hit.storageKey,
        storageUrl: hit.storageUrl,
        downloadUrl: artifactDownloadPath(hit.id),
        fileHash: hit.fileHash,
        fileSize: hit.fileSize,
        expiresAt: hit.expiresAt,
        deduped: true,
      };
    }
  }

  const contentType = input.contentType ?? contentTypeForFormat(format);
  const storageKey = buildStorageKey(fileHash, format);

  // Dynamic import keeps this module light for unit tests (mockable seam).
  const { storagePut } = await import("../storage");
  const put = await storagePut(storageKey, buffer, contentType);

  const retentionDays = resolveRetentionDays(input.retentionDays);
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(reportArtifacts)
    .values({
      reportType,
      format,
      title: input.title ?? null,
      params: input.params ?? null,
      storageKey: put.key,
      storageUrl: put.url,
      fileHash,
      fileSize,
      contentType,
      createdBy: input.createdBy ?? null,
      source: input.source ?? "on_demand",
      expiresAt,
    })
    .returning();

  return {
    id: row.id,
    storageKey: row.storageKey,
    storageUrl: row.storageUrl,
    downloadUrl: artifactDownloadPath(row.id),
    fileHash: row.fileHash,
    fileSize: row.fileSize,
    expiresAt: row.expiresAt,
    deduped: false,
  };
}

// ── Read paths ─────────────────────────────────────────────────────────────────

/** Access-checked fetch. Throws ArtifactError('not_found' | 'forbidden'). Does NOT enforce expiry. */
export async function getArtifact(id: number, viewer: ArtifactViewer | null): Promise<ReportArtifact> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(reportArtifacts).where(eq(reportArtifacts.id, id)).limit(1);
  const artifact = rows[0];
  if (!artifact) throw new ArtifactError("not_found", `Report artifact ${id} not found`);
  if (!canAccessArtifact(viewer, artifact)) {
    throw new ArtifactError("forbidden", "You do not have access to this report artifact");
  }
  return artifact;
}

export interface DownloadTarget {
  artifact: ReportArtifact;
  /** Fresh (possibly signed) storage URL to fetch the bytes. */
  directUrl: string;
  filename: string;
  downloadUrl: string;
}

/**
 * Access + expiry-checked resolution for a re-download. Throws
 * ArtifactError('not_found' | 'forbidden' | 'expired'). 'expired' → HTTP 410.
 */
export async function getDownloadTarget(id: number, viewer: ArtifactViewer | null): Promise<DownloadTarget> {
  const artifact = await getArtifact(id, viewer);
  if (isExpired(artifact)) {
    throw new ArtifactError("expired", "This report artifact has expired (retention window passed)");
  }
  const { storageGet } = await import("../storage");
  const { url } = await storageGet(artifact.storageKey);
  const filename = defaultFilename(artifact);
  return { artifact, directUrl: url, filename, downloadUrl: artifactDownloadPath(artifact.id) };
}

export function defaultFilename(artifact: Pick<ReportArtifact, "id" | "reportType" | "format">): string {
  const base = (artifact.reportType || "report").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `${base}-${artifact.id}.${artifact.format}`;
}

export interface ListArtifactsFilters {
  createdBy?: number;
  reportType?: string;
  format?: ReportArtifactFormat;
  source?: ReportArtifactSource;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  /** Include artifacts already past expiresAt (default false). */
  includeExpired?: boolean;
}

export interface ListArtifactsResult {
  items: ReportArtifact[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Paginated listing. A non-privileged viewer is HARD-SCOPED to their own
 * artifacts regardless of the createdBy filter; privileged viewers see all and
 * may filter by createdBy.
 */
export async function listArtifacts(
  viewer: ArtifactViewer | null,
  filters: ListArtifactsFilters = {},
): Promise<ListArtifactsResult> {
  const db = await getDb();
  if (!db) return { items: [], total: 0, limit: filters.limit ?? 50, offset: filters.offset ?? 0 };

  const privileged = !!viewer?.privileged || (!!viewer?.role && PRIVILEGED_ROLES.has(viewer.role));
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);

  const conds: SQL[] = [];
  if (privileged) {
    if (filters.createdBy != null) conds.push(eq(reportArtifacts.createdBy, filters.createdBy));
  } else {
    // Non-privileged: only own rows (viewer must be identified).
    if (viewer?.id == null) return { items: [], total: 0, limit, offset };
    conds.push(eq(reportArtifacts.createdBy, viewer.id));
  }
  if (filters.reportType) conds.push(eq(reportArtifacts.reportType, filters.reportType));
  if (filters.format) conds.push(eq(reportArtifacts.format, filters.format));
  if (filters.source) conds.push(eq(reportArtifacts.source, filters.source));
  if (filters.from) conds.push(gt(reportArtifacts.createdAt, filters.from));
  if (filters.to) conds.push(lt(reportArtifacts.createdAt, filters.to));
  if (!filters.includeExpired) conds.push(gt(reportArtifacts.expiresAt, new Date()));

  const where = conds.length > 0 ? and(...conds) : undefined;

  const items = await db
    .select()
    .from(reportArtifacts)
    .where(where)
    .orderBy(desc(reportArtifacts.createdAt))
    .limit(limit)
    .offset(offset);

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reportArtifacts)
    .where(where);
  const total = countRows[0]?.n ?? 0;

  return { items, total, limit, offset };
}

/** Access-checked delete of the storage object + the row. Returns true when removed. */
export async function deleteArtifact(id: number, viewer: ArtifactViewer | null): Promise<boolean> {
  const artifact = await getArtifact(id, viewer); // throws not_found / forbidden
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await deleteStorageObjectSafe(artifact.storageKey);
  await db.delete(reportArtifacts).where(eq(reportArtifacts.id, id));
  return true;
}

// ── Retention cleanup ──────────────────────────────────────────────────────────

/** Delete a storage object, never throwing (retention must not wedge on a blob). */
async function deleteStorageObjectSafe(storageKey: string): Promise<void> {
  try {
    const { storageDelete } = await import("../storage");
    const r = await storageDelete(storageKey);
    if (!r.deleted && r.error) {
      console.warn(`[ReportArtifact] storage delete ${storageKey} not confirmed: ${r.error}`);
    }
  } catch (err: any) {
    console.warn(`[ReportArtifact] storage delete ${storageKey} failed:`, err?.message ?? err);
  }
}

export interface CleanupResult {
  deleted: number;
  scanned: number;
}

/**
 * One retention sweep: delete artifacts past expiresAt (storage object + row),
 * bounded batch. Uses the background-jobs DB pool so it can never starve
 * interactive queries. Exported for tests + manual ops runs.
 */
export async function runReportArtifactCleanupOnce(opts?: { batch?: number; now?: Date }): Promise<CleanupResult> {
  const db = (await getJobsDb()) ?? (await getDb());
  if (!db) return { deleted: 0, scanned: 0 };

  const batch = Math.max(1, Math.min(10_000, opts?.batch ?? (Number(process.env.REPORT_ARTIFACT_CLEANUP_BATCH) || 500)));
  const now = opts?.now ?? new Date();

  let deleted = 0;
  let scanned = 0;
  // Bounded loop — clears a large backlog over several batches in one run.
  for (let i = 0; i < 1000; i++) {
    const rows = await db
      .select({ id: reportArtifacts.id, storageKey: reportArtifacts.storageKey })
      .from(reportArtifacts)
      .where(lt(reportArtifacts.expiresAt, now))
      .limit(batch);
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const row of rows) {
      await deleteStorageObjectSafe(row.storageKey);
      await db.delete(reportArtifacts).where(eq(reportArtifacts.id, row.id));
      deleted++;
    }
    if (rows.length < batch) break;
  }
  if (deleted > 0) {
    console.log(`[ReportArtifact] retention cleanup: deleted ${deleted} expired artifact(s)`);
  }
  return { deleted, scanned };
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

let cleanupTimer: NodeJS.Timeout | null = null;

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Start the daily retention cleanup. Default ON; disable with
 * REPORT_ARTIFACT_CLEANUP_ENABLED=false. Interval env
 * REPORT_ARTIFACT_CLEANUP_INTERVAL_MS (default 24h). First run shortly after
 * boot so a fresh deploy reclaims a backlog without waiting a full day.
 */
export function startReportArtifactCleanup(): void {
  if (process.env.REPORT_ARTIFACT_CLEANUP_ENABLED === "false") return;
  if (cleanupTimer) return;

  const intervalMs = Math.max(60_000, envInt("REPORT_ARTIFACT_CLEANUP_INTERVAL_MS", 24 * 60 * 60 * 1000));

  setTimeout(() => {
    void runReportArtifactCleanupOnce().catch((e) =>
      console.error("[ReportArtifact] cleanup failed:", e?.message ?? e),
    );
  }, 60_000);
  cleanupTimer = setInterval(() => {
    void runReportArtifactCleanupOnce().catch((e) =>
      console.error("[ReportArtifact] cleanup failed:", e?.message ?? e),
    );
  }, intervalMs);
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

  console.log(
    `[ReportArtifact] retention cleanup enabled — sweeping every ${Math.round(intervalMs / 3_600_000)}h ` +
      `(retention default ${resolveRetentionDays()}d)`,
  );
}

export function stopReportArtifactCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
