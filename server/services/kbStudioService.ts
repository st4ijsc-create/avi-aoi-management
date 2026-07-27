/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio corpus/job REGISTRY service.
 *
 * The management layer over E3-1's `kb_studio_chunks` (server/services/kbVectorStore.ts,
 * table `kb_studio_chunks`, migration 0304): this file owns `kb_corpora` (named corpus
 * registry) + `kb_ingest_jobs` (one row per ingest attempt), migration
 * drizzle/0305_kb_studio_registry.sql. It does NOT reimplement parse/chunk/embed/store —
 * server/routers/kbStudioRouter.ts calls E3-1's kbIngestService.ingestDocument / E3-3's
 * kbWebFetcher.ingestUrl directly and uses this file only for the registry/job bookkeeping
 * around those calls.
 *
 * Fail-safe triage (mirrors kbVectorStore.ts / aiModelCardGate.ts's established split):
 *  - READ paths (listCorpora, listJobs, previewCorpus) catch pg 42P01 ("relation does not
 *    exist") and degrade to an empty/`tableAvailable:false` result — NEVER throw. A page
 *    rendered before migration 0305 is applied sees "no corpora yet", not a crash.
 *  - The job-tracking WRITE paths used INSIDE the ingest flow (ensureCorpusRegistered,
 *    createJob, markJobSucceeded, markJobFailed) are all BEST-EFFORT: the actual document
 *    ingest (kb_studio_chunks, already migrated independently in 0304) must never be blocked
 *    or fail just because the NEWER registry tables from this task haven't been migrated yet
 *    or a bookkeeping write hits some other fault. 42P01 no-ops silently (the expected,
 *    unmigrated-table case); any OTHER error is logged via `console.warn("[kbStudio] …")`
 *    and then ALSO swallowed (never blocks ingest) — so a real, persistent DB fault stays
 *    operationally visible instead of vanishing with zero signal. `createJob` returns
 *    `{tableAvailable:false, job:null}` rather than throwing; the router proceeds to ingest
 *    regardless and simply reports `jobId: null` (no job row was written).
 *  - The EXPLICIT registry WRITE paths (createCorpus, deleteCorpus) are the "this write IS
 *    the point of the call" case — same discipline as kbIngestService.ingestDocument's
 *    kb_studio_chunks check and aiModelRouter's rethrowCardTableError: a 42P01 here throws
 *    {@link KbStudioTableUnavailableError} rather than silently no-op'ing (reporting
 *    "corpus created" when it wasn't would be an honest-sounding lie).
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { isMissingTable } from "../_core/dbErrors";
import {
  kbCorpora,
  kbIngestJobs,
  kbStudioChunks,
  type KbCorpus,
  type KbIngestJob,
} from "../../drizzle/schema/kbStudio";

/** Thrown by the EXPLICIT registry writes (createCorpus/deleteCorpus) when kb_corpora /
 * kb_ingest_jobs isn't migrated yet — see the module doc comment's fail-safe triage. */
export class KbStudioTableUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbStudioTableUnavailableError";
  }
}

/** Thrown by createCorpus when the name is already registered (23505 unique violation on
 * kb_corpora.name), and by deleteCorpus when the named corpus has no registry row. */
export class KbCorpusNotFoundError extends Error {
  constructor(name: string) {
    super(`No corpus registered with name "${name}".`);
    this.name = "KbCorpusNotFoundError";
  }
}

/** Delegates to `_core/dbErrors.ts`'s cause-chain walk — a naive `(e as {code}).code ===
 * "42P01"` misses drizzle-orm's `DrizzleQueryError` wrapper (the real driver error, code and
 * all, lives on `.cause`), which is exactly the shape this codebase's DB layer produces. */
function isMissingTableError(e: unknown): boolean {
  return isMissingTable(e);
}

// ─── Corpus registry ────────────────────────────────────────────────────────

export interface CorpusWithStats extends KbCorpus {
  chunkCount: number;
  jobCount: number;
  lastIngestAt: Date | null;
}

export interface ListCorporaResult {
  /** false when kb_corpora isn't migrated yet — caller must degrade, not throw. */
  tableAvailable: boolean;
  corpora: CorpusWithStats[];
}

/**
 * Registered corpora + per-corpus stats. Stats are computed from kb_studio_chunks (chunk
 * count) and kb_ingest_jobs (job count + last ingest timestamp), each queried and
 * fail-safed INDEPENDENTLY of kb_corpora itself and of each other — a corpus can be
 * registered (kb_corpora exists) while the OTHER two tables are in any migration state,
 * and this must never crash the Corpus tab, just show zeros for whichever piece is missing.
 */
export async function listCorpora(): Promise<ListCorporaResult> {
  const db = await getDb();
  if (!db) return { tableAvailable: false, corpora: [] };

  let rows: KbCorpus[];
  try {
    rows = await db.select().from(kbCorpora).orderBy(desc(kbCorpora.createdAt));
  } catch (e) {
    if (isMissingTableError(e)) return { tableAvailable: false, corpora: [] };
    throw e;
  }
  if (rows.length === 0) return { tableAvailable: true, corpora: [] };

  const chunkStats = await getChunkCountsByCorpus();
  const jobStats = await getJobStatsByCorpus();

  return {
    tableAvailable: true,
    corpora: rows.map((c) => ({
      ...c,
      chunkCount: chunkStats.get(c.name) ?? 0,
      jobCount: jobStats.get(c.name)?.jobCount ?? 0,
      lastIngestAt: jobStats.get(c.name)?.lastIngestAt ?? null,
    })),
  };
}

/** Fail-safe (own try/catch) — a missing/unmigrated kb_studio_chunks never blocks the
 * Corpus tab from rendering the registry rows, just shows chunkCount:0 for every corpus. */
async function getChunkCountsByCorpus(): Promise<Map<string, number>> {
  const db = await getDb();
  const out = new Map<string, number>();
  if (!db) return out;
  try {
    const rows = (await db
      .select({ corpus: kbStudioChunks.corpus, cnt: sql<number>`count(*)::int` })
      .from(kbStudioChunks)
      .groupBy(kbStudioChunks.corpus)) as Array<{ corpus: string; cnt: number }>;
    for (const r of rows) out.set(r.corpus, Number(r.cnt));
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
  }
  return out;
}

/** Fail-safe (own try/catch) — mirrors getChunkCountsByCorpus for kb_ingest_jobs. */
async function getJobStatsByCorpus(): Promise<Map<string, { jobCount: number; lastIngestAt: Date | null }>> {
  const db = await getDb();
  const out = new Map<string, { jobCount: number; lastIngestAt: Date | null }>();
  if (!db) return out;
  try {
    const rows = (await db
      .select({
        corpus: kbIngestJobs.corpus,
        cnt: sql<number>`count(*)::int`,
        lastAt: sql<string | null>`max("createdAt")`,
      })
      .from(kbIngestJobs)
      .groupBy(kbIngestJobs.corpus)) as Array<{ corpus: string; cnt: number; lastAt: string | null }>;
    for (const r of rows) {
      out.set(r.corpus, { jobCount: Number(r.cnt), lastIngestAt: r.lastAt ? new Date(r.lastAt) : null });
    }
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
  }
  return out;
}

export interface CreateCorpusInput {
  name: string;
  description?: string;
  createdBy?: number;
}

/** Explicit registry write — throws {@link KbStudioTableUnavailableError} on 42P01 (see
 * module doc comment). Unique-violation (duplicate name) is left to the caller (the router)
 * to map via `_core/dbErrors.ts`'s isUniqueViolation, same as every other CRUD router. */
export async function createCorpus(input: CreateCorpusInput): Promise<KbCorpus> {
  const db = await getDb();
  if (!db) throw new KbStudioTableUnavailableError("Database not available");
  try {
    const [row] = await db
      .insert(kbCorpora)
      .values({ name: input.name, description: input.description, createdBy: input.createdBy })
      .returning();
    return row!;
  } catch (e) {
    if (isMissingTableError(e)) {
      throw new KbStudioTableUnavailableError(
        "kb_corpora is not migrated yet (apply drizzle/0305_kb_studio_registry.sql as owner \"aoi\").",
      );
    }
    throw e;
  }
}

/**
 * Best-effort auto-registration used by the job-tracked ingest mutations — NEVER throws
 * (any failure, including 42P01 or a race against a concurrent createCorpus, is swallowed):
 * this is metadata convenience only, never allowed to block the actual document ingest.
 * `ON CONFLICT DO NOTHING` so re-ingesting into an already-registered corpus is a silent
 * no-op, not a duplicate-key error.
 */
export async function ensureCorpusRegistered(name: string, createdBy?: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(kbCorpora).values({ name, createdBy }).onConflictDoNothing();
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn("[kbStudio] ensureCorpusRegistered failed (non-42P01, swallowed):", (e as Error)?.message ?? e);
    }
    /* best-effort — registry bookkeeping never blocks ingest */
  }
}

export interface DeleteCorpusResult {
  chunksRemoved: number;
  jobsRemoved: number;
}

/**
 * Transactional delete of a corpus: its kb_studio_chunks rows + kb_ingest_jobs rows + the
 * kb_corpora registry row, all inside ONE `db.transaction` so a mid-delete failure never
 * leaves the corpus half-removed (either everything is gone, or nothing changed). Throws
 * {@link KbCorpusNotFoundError} if no registry row exists for `name` (checked BEFORE the
 * transaction, so a typo'd name never reaches the DB as a no-op "success"), or
 * {@link KbStudioTableUnavailableError} if kb_corpora/kb_ingest_jobs isn't migrated yet —
 * this call requires ALL THREE tables to be present to complete atomically; a corpus that
 * needs deleting deserves a clear "run the migration first" error, not a partial delete.
 */
export async function deleteCorpus(name: string): Promise<DeleteCorpusResult> {
  const db = await getDb();
  if (!db) throw new KbStudioTableUnavailableError("Database not available");

  let existing: KbCorpus | undefined;
  try {
    [existing] = await db.select().from(kbCorpora).where(eq(kbCorpora.name, name)).limit(1);
  } catch (e) {
    if (isMissingTableError(e)) {
      throw new KbStudioTableUnavailableError(
        "kb_corpora is not migrated yet (apply drizzle/0305_kb_studio_registry.sql as owner \"aoi\").",
      );
    }
    throw e;
  }
  if (!existing) throw new KbCorpusNotFoundError(name);

  try {
    return await db.transaction(async (tx) => {
      const chunksDeleted = await tx
        .delete(kbStudioChunks)
        .where(eq(kbStudioChunks.corpus, name))
        .returning({ id: kbStudioChunks.id });
      const jobsDeleted = await tx
        .delete(kbIngestJobs)
        .where(eq(kbIngestJobs.corpus, name))
        .returning({ id: kbIngestJobs.id });
      await tx.delete(kbCorpora).where(eq(kbCorpora.name, name));
      return { chunksRemoved: chunksDeleted.length, jobsRemoved: jobsDeleted.length };
    });
  } catch (e) {
    if (isMissingTableError(e)) {
      throw new KbStudioTableUnavailableError(
        "kb_studio_chunks or kb_ingest_jobs is not migrated yet — deleteCorpus requires every " +
          "Training Studio table to exist so the delete stays atomic (apply drizzle/0304_kb_studio_chunks_pgvector.sql " +
          "AND drizzle/0305_kb_studio_registry.sql as owner \"aoi\").",
      );
    }
    throw e;
  }
}

// ─── Ingest jobs ────────────────────────────────────────────────────────────

export interface ListJobsInput {
  corpus?: string;
  limit?: number;
}

export interface ListJobsResult {
  tableAvailable: boolean;
  jobs: KbIngestJob[];
}

export async function listJobs(input: ListJobsInput): Promise<ListJobsResult> {
  const db = await getDb();
  if (!db) return { tableAvailable: false, jobs: [] };
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  try {
    const where = input.corpus ? eq(kbIngestJobs.corpus, input.corpus) : undefined;
    const rows = await db
      .select()
      .from(kbIngestJobs)
      .where(where)
      .orderBy(desc(kbIngestJobs.createdAt))
      .limit(limit);
    return { tableAvailable: true, jobs: rows };
  } catch (e) {
    if (isMissingTableError(e)) return { tableAvailable: false, jobs: [] };
    throw e;
  }
}

export interface CreateJobInput {
  corpus: string;
  sourceType: string;
  sourceRef: string;
  createdBy?: number;
}

export interface CreateJobResult {
  /** false when kb_ingest_jobs isn't migrated — `job` is null; the CALLER (kbStudioRouter)
   * must still proceed with the actual ingest, just without a tracked job row. */
  tableAvailable: boolean;
  job: KbIngestJob | null;
}

/** Inserts a `running` job row. Best-effort against a missing table (see module doc
 * comment) — never throws; a 42P01 degrades to `{tableAvailable:false, job:null}`. */
export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  try {
    const db = await getDb();
    if (!db) return { tableAvailable: false, job: null };
    const [row] = await db
      .insert(kbIngestJobs)
      .values({
        corpus: input.corpus,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        status: "running",
        createdBy: input.createdBy,
      })
      .returning();
    return { tableAvailable: true, job: row ?? null };
  } catch (e) {
    if (isMissingTableError(e)) return { tableAvailable: false, job: null };
    // Any OTHER failure inserting the job row (e.g. a real connection error) must not
    // block the caller's actual ingest either — job tracking is secondary bookkeeping —
    // but it deserves operational visibility since it's NOT the expected unmigrated case.
    console.warn("[kbStudio] createJob failed (non-42P01, swallowed):", (e as Error)?.message ?? e);
    return { tableAvailable: false, job: null };
  }
}

/** Best-effort — swallows ALL errors (including 42P01 and a missing/already-finished job
 * id). NEVER throws: called from the SUCCESS path of the ingest mutation, and a bookkeeping
 * failure here must never turn an actually-successful ingest into a reported failure. */
export async function markJobSucceeded(jobId: number | null, chunksAdded: number): Promise<void> {
  if (jobId == null) return;
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(kbIngestJobs)
      .set({ status: "succeeded", chunksAdded, finishedAt: new Date() })
      .where(eq(kbIngestJobs.id, jobId));
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn("[kbStudio] markJobSucceeded failed (non-42P01, swallowed):", (e as Error)?.message ?? e);
    }
    /* best-effort — see doc comment */
  }
}

/** Best-effort — swallows ALL errors. Called from the CATCH path of the ingest mutation
 * (see kbStudioRouter.ts) so a throw from ingestDocument/ingestUrl ALWAYS ends with the job
 * marked 'failed' when the table is available, and NEVER masks the original error when it
 * isn't (the caller re-throws the original error regardless of what happens here). */
export async function markJobFailed(jobId: number | null, error: string): Promise<void> {
  if (jobId == null) return;
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(kbIngestJobs)
      .set({ status: "failed", error: error.slice(0, 4000), finishedAt: new Date() })
      .where(eq(kbIngestJobs.id, jobId));
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn("[kbStudio] markJobFailed failed (non-42P01, swallowed):", (e as Error)?.message ?? e);
    }
    /* best-effort — see doc comment */
  }
}

// ─── Corpus preview (Eval-lite) ─────────────────────────────────────────────

export interface CorpusPreviewChunk {
  id: number;
  sourceType: string;
  sourceRef: string;
  chunkIndex: number;
  /** Truncated to a display-safe length — this is a SAMPLE for a human to eyeball what got
   * ingested, not a retrieval result; the full text is never needed here. */
  text: string;
  tokenCount: number | null;
  createdAt: Date;
}

export interface CorpusPreviewResult {
  tableAvailable: boolean;
  totalChunks: number;
  distinctSources: number;
  sample: CorpusPreviewChunk[];
}

const PREVIEW_TEXT_MAX_CHARS = 600;

/**
 * Eval-lite: a sample of chunks + counts for a corpus, read directly from kb_studio_chunks.
 * NO embedding, NO model call, NO similarity search — this is a plain browse so an operator
 * can SEE what was ingested. A full RAG-answer-quality eval (does the model actually answer
 * well FROM this corpus) needs a live embed/LLM model and is intentionally NOT built here —
 * see kbStudioRouter.ts's corpusPreview doc comment for the documented ops-step pointer
 * (reuse the existing eval-rag* tooling).
 */
export async function previewCorpus(corpus: string, limit: number): Promise<CorpusPreviewResult> {
  const db = await getDb();
  if (!db) return { tableAvailable: false, totalChunks: 0, distinctSources: 0, sample: [] };
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const trimmed = (corpus ?? "").trim();
  if (!trimmed) return { tableAvailable: true, totalChunks: 0, distinctSources: 0, sample: [] };

  try {
    const [{ total }] = (await db
      .select({ total: sql<number>`count(*)::int` })
      .from(kbStudioChunks)
      .where(eq(kbStudioChunks.corpus, trimmed))) as Array<{ total: number }>;
    const [{ distinct }] = (await db
      .select({ distinct: sql<number>`count(distinct "sourceRef")::int` })
      .from(kbStudioChunks)
      .where(eq(kbStudioChunks.corpus, trimmed))) as Array<{ distinct: number }>;
    const rows = await db
      .select({
        id: kbStudioChunks.id,
        sourceType: kbStudioChunks.sourceType,
        sourceRef: kbStudioChunks.sourceRef,
        chunkIndex: kbStudioChunks.chunkIndex,
        text: kbStudioChunks.text,
        tokenCount: kbStudioChunks.tokenCount,
        createdAt: kbStudioChunks.createdAt,
      })
      .from(kbStudioChunks)
      .where(eq(kbStudioChunks.corpus, trimmed))
      .orderBy(kbStudioChunks.sourceRef, kbStudioChunks.chunkIndex)
      .limit(safeLimit);

    return {
      tableAvailable: true,
      totalChunks: Number(total) || 0,
      distinctSources: Number(distinct) || 0,
      sample: rows.map((r) => ({
        ...r,
        text: r.text.length > PREVIEW_TEXT_MAX_CHARS ? `${r.text.slice(0, PREVIEW_TEXT_MAX_CHARS)}…` : r.text,
      })),
    };
  } catch (e) {
    if (isMissingTableError(e)) return { tableAvailable: false, totalChunks: 0, distinctSources: 0, sample: [] };
    throw e;
  }
}
