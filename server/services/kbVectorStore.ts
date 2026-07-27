/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — multi-corpus pgvector chunk store for the Knowledge &
 * Training Studio doc-ingest pipeline (table `kb_studio_chunks`, migration
 * drizzle/0304_kb_studio_chunks_pgvector.sql, schema drizzle/schema/kbStudio.ts).
 *
 * NOT `server/services/kb/kbVectorStore.ts` (the existing, single-corpus ops-KB pgvector
 * mirror — table `kb_chunks`, migration 0121). That file/table pair is untouched by this
 * task; this is a SEPARATE store so operator-uploaded Studio documents never leak into the
 * existing ops-KB retrieval (see drizzle/schema/kbStudio.ts's header comment for the full
 * rationale).
 *
 * Discipline mirrors server/services/aiImageEmbedding.ts:
 *  - INSERT the known columns via raw parameterized SQL — never let drizzle's `.insert()`
 *    touch `embedding_vec` directly (it always emits the column, which fails on a DB where
 *    the column/table doesn't exist yet, i.e. before migration 0304 is applied).
 *  - `embedding_vec` is written as a SEPARATE best-effort UPDATE (only for 1024-dim rows);
 *    a pgvector-unavailable failure there is swallowed — the TEXT `embedding` column always
 *    carries the data.
 *  - `corpus` is ALWAYS a bound SQL parameter (drizzle's tagged-template `sql` — never
 *    string-concatenated), so a corpus value can never inject SQL.
 *  - Every entry point catches pg error 42P01 ("relation does not exist") and degrades to
 *    an empty/no-op result — the table ships unapplied until an operator with the `aoi`
 *    role runs the migration.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

/** Dimension written to the pgvector column (matches GGUF_EMBED_DIM's default, aiGgufEngine.ts). */
const VECTOR_DIM = 1024;

export interface KbChunkInput {
  /** Chunk position within its source document (0-based). */
  index: number;
  text: string;
  embedding: number[];
  sourceType: string;
  sourceRef: string;
  tokenCount?: number;
  createdBy?: number;
}

export interface UpsertChunksResult {
  /** false when kb_studio_chunks isn't migrated yet — caller must degrade, not throw. */
  tableAvailable: boolean;
  inserted: number;
  skipped: number;
}

export interface KbChunkHit {
  id: number;
  corpus: string;
  sourceType: string;
  sourceRef: string;
  chunkIndex: number;
  text: string;
  score: number;
}

function isMissingTableError(e: unknown): boolean {
  return (e as { code?: string } | null | undefined)?.code === "42P01";
}

function formatVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Insert/replace all chunks of ONE document into a `corpus` namespace, inside a single DB
 * transaction so a mid-batch failure never leaves a half-written document (either every
 * chunk lands, or none do — the caller sees the thrown error and must not report success).
 *
 * CLEAN-SLATE per document: before inserting, every existing row for each distinct
 * `(corpus, sourceRef)` pair present in `chunks` is DELETEd first, inside the SAME
 * transaction as the inserts. This guarantees a re-ingest fully REPLACES that document's
 * chunk set — if the document shrank (fewer chunks than the previous ingest), the old rows
 * at the now-unused higher `chunkIndex` values are removed instead of lingering with stale
 * text and continuing to surface in `searchCorpus`. The DELETE is scoped per `sourceRef`
 * (not the whole `corpus`), so a call that (re-)writes one document never touches any other
 * document already stored under the same corpus namespace. Both the DELETEs and the INSERTs
 * are inside the same `db.transaction(...)`, so a failure anywhere rolls back atomically —
 * no half-deleted/half-written corpus.
 *
 * Fail-safe ONLY for the "table not migrated yet" case (pg 42P01): that degrades to
 * `{tableAvailable:false, inserted:0, skipped:chunks.length}` instead of throwing. Any OTHER
 * database error (bad connection, constraint violation unrelated to the missing table, …)
 * is a REAL failure and is rethrown — kbIngestService.ts must surface it as a clear error,
 * never silently report a successful ingest.
 */
export async function upsertChunks(corpus: string, chunks: KbChunkInput[]): Promise<UpsertChunksResult> {
  const db = await getDb();
  if (!db) return { tableAvailable: false, inserted: 0, skipped: chunks.length };
  const trimmedCorpus = (corpus ?? "").trim();
  if (!trimmedCorpus || chunks.length === 0) return { tableAvailable: true, inserted: 0, skipped: 0 };

  // Distinct sourceRefs being (re-)written by this call. A clean-slate DELETE is scoped to
  // exactly these — never the whole corpus — so other documents already ingested into the
  // same corpus namespace are left untouched.
  const sourceRefs = Array.from(new Set(chunks.map((c) => c.sourceRef)));

  try {
    await db.transaction(async (tx) => {
      // Clean slate: remove every existing row for each (corpus, sourceRef) pair being
      // written BEFORE inserting the fresh set, so a re-ingest with fewer chunks than before
      // leaves no stale rows at now-unused higher chunkIndex values. Both params are bound
      // (never string-concatenated).
      for (const sourceRef of sourceRefs) {
        await tx.execute(sql`
          DELETE FROM kb_studio_chunks WHERE "corpus" = ${trimmedCorpus} AND "sourceRef" = ${sourceRef}
        `);
      }

      for (const chunk of chunks) {
        const embStr = formatVectorLiteral(chunk.embedding);
        const rows = (await tx.execute(sql`
          INSERT INTO kb_studio_chunks
            ("corpus", "sourceType", "sourceRef", "chunkIndex", "text", "embedding", "embeddingDim", "tokenCount", "createdBy")
          VALUES
            (${trimmedCorpus}, ${chunk.sourceType}, ${chunk.sourceRef}, ${chunk.index}, ${chunk.text},
             ${embStr}, ${chunk.embedding.length}, ${chunk.tokenCount ?? null}, ${chunk.createdBy ?? null})
          ON CONFLICT ("corpus", "sourceRef", "chunkIndex")
          DO UPDATE SET
            "text" = EXCLUDED."text",
            "embedding" = EXCLUDED."embedding",
            "embeddingDim" = EXCLUDED."embeddingDim",
            "tokenCount" = EXCLUDED."tokenCount"
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        const id = rows?.[0]?.id;

        // Best-effort pgvector write — mirrors aiImageEmbedding.storeEmbedding. NEVER aborts
        // the transaction: on a DB without the `vector` extension, the TEXT `embedding`
        // column already carries the real data (written by the INSERT above).
        if (id != null && chunk.embedding.length === VECTOR_DIM) {
          try {
            await tx.execute(
              sql`UPDATE kb_studio_chunks SET embedding_vec = ${embStr}::vector(${sql.raw(String(VECTOR_DIM))}) WHERE id = ${id}`,
            );
          } catch {
            /* pgvector unavailable — TEXT embedding remains the source of truth */
          }
        }
      }
    });
    return { tableAvailable: true, inserted: chunks.length, skipped: 0 };
  } catch (e) {
    if (isMissingTableError(e)) {
      return { tableAvailable: false, inserted: 0, skipped: chunks.length };
    }
    throw e; // real failure — the transaction rolled back, nothing was written
  }
}

function mapRow(r: Record<string, unknown>): KbChunkHit {
  return {
    id: Number(r.id),
    corpus: String(r.corpus),
    sourceType: String(r.sourceType),
    sourceRef: String(r.sourceRef),
    chunkIndex: Number(r.chunkIndex),
    text: String(r.text),
    score: Number(r.score),
  };
}

/**
 * Cosine-similarity top-k search, scoped to ONE corpus namespace (`corpus` is a bound
 * param). Mirrors aiImageEmbedding.ts's `<=>` cosine-distance operator
 * (`1 - (embedding_vec <=> $vec)` = cosine similarity). Tries the pgvector HNSW column
 * first, falls back to a Node brute-force cosine scan over the TEXT `embedding` column
 * (bounded scan, for the small corpora this task ships with).
 *
 * Fail-safe: a missing table (42P01), a missing/empty corpus, or any other DB error all
 * degrade to an empty array — never throws (a search failing is not a reason to break the
 * caller's UX; kbIngestService write-path errors are handled separately and DO throw).
 */
export async function searchCorpus(corpus: string, queryEmbedding: number[], k: number): Promise<KbChunkHit[]> {
  const db = await getDb();
  if (!db) return [];
  const trimmedCorpus = (corpus ?? "").trim();
  if (!trimmedCorpus || !Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];
  const safeK = Math.max(1, Math.min(Number(k) || 5, 50));
  const embStr = formatVectorLiteral(queryEmbedding);

  // ── Tier 1: pgvector HNSW (only meaningful for the configured embedding dimension). ──
  if (queryEmbedding.length === VECTOR_DIM) {
    try {
      const rows = (await db.execute(sql`
        SELECT id, "corpus", "sourceType", "sourceRef", "chunkIndex", "text",
               1 - (embedding_vec <=> ${embStr}::vector(${sql.raw(String(VECTOR_DIM))})) AS score
        FROM kb_studio_chunks
        WHERE "corpus" = ${trimmedCorpus} AND embedding_vec IS NOT NULL
        ORDER BY embedding_vec <=> ${embStr}::vector(${sql.raw(String(VECTOR_DIM))})
        LIMIT ${safeK}
      `)) as unknown as Array<Record<string, unknown>>;
      // Return here even when `rows` is empty — an empty result IS the answer (no matches
      // in this corpus), not a reason to also run the brute-force tier. Only a THROWN error
      // falls through below (mirrors aiImageEmbedding.ts's findSimilarByVectorWithMode).
      return Array.isArray(rows) ? rows.map(mapRow) : [];
    } catch (e) {
      if (isMissingTableError(e)) return [];
      // Any other tier-1 failure (extension unavailable, column not yet backfilled, …)
      // falls through to the brute-force tier below rather than surfacing to the caller.
    }
  }

  // ── Tier 2: Node brute-force cosine over the TEXT embedding column. ──
  try {
    const rows = (await db.execute(sql`
      SELECT id, "corpus", "sourceType", "sourceRef", "chunkIndex", "text", "embedding"
      FROM kb_studio_chunks
      WHERE "corpus" = ${trimmedCorpus} AND "embedding" IS NOT NULL
      LIMIT 5000
    `)) as unknown as Array<Record<string, unknown>>;
    const scored: KbChunkHit[] = [];
    for (const r of rows ?? []) {
      let vec: number[];
      try {
        vec = JSON.parse(String(r.embedding));
      } catch {
        continue;
      }
      scored.push({ ...mapRow(r), score: cosine(queryEmbedding, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, safeK);
  } catch (e) {
    if (isMissingTableError(e)) return [];
    return []; // fail-safe: search errors never throw
  }
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
