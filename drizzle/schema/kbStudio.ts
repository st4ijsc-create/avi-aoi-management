// Schema domain: Knowledge & Training Studio — multi-corpus pgvector chunk store
// (doc69 Giai đoạn 5 / Wave E3, task E3-1).
//
// NOT the same table as `kb_chunks` (migration 0121, drizzle/schema/kb.ts) — that table is
// the SINGLE-corpus pgvector mirror of the existing file-based ops-KB
// (knowledge/chunks.jsonl, ingested via server/services/kb/kbVectorStore.ts +
// server/routers/kbVectorRouter.ts), unnamespaced (every row implicitly belongs to the one
// ops corpus). This table (`kb_studio_chunks`) is the NEW, EXPLICITLY namespaced
// multi-corpus store behind the Training Studio doc-ingest pipeline
// (server/services/kbDocParser.ts + kbIngestService.ts + kbVectorStore.ts — note: a
// DIFFERENT file from server/services/kb/kbVectorStore.ts) for operator-uploaded pdf/docx/
// md/txt documents, each tagged with an arbitrary `corpus` key so multiple training corpora
// can coexist without namespace collisions.
//
// Deliberately kept as a SEPARATE table rather than an ALTER on `kb_chunks`: the existing
// `kb/kbVectorStore.ts`'s `searchKb()` runs an UNFILTERED `SELECT ... FROM kb_chunks` — if
// Studio-ingested chunks landed in that same table, they would silently leak into the
// existing ops-KB retrieval, violating the "does not touch the existing JSONL KB or its
// retrieval" requirement (see the E3-1 task report for the full rationale).
//
// Mirrors ai_image_embeddings (drizzle/schema/ai.ts ~:1286): a TEXT `embedding` column
// (JSON array "[0.1,0.2,...]", always present, Node brute-force fallback) + a pgvector
// `embeddingVec` column. Index HNSW (idx_kb_studio_chunks_vec_hnsw, vector_cosine_ops) is
// kept MANUALLY in drizzle/0304_kb_studio_chunks_pgvector.sql (drizzle-kit cannot emit
// `USING hnsw`).
import { pgTable, serial, integer, varchar, text, timestamp, index, unique, customType } from "drizzle-orm/pg-core";

/**
 * pgvector `vector(N)` column type — local copy of the helper in drizzle/schema/ai.ts
 * (~:16), which is file-local (not exported). Same shape: dimension embedded in the DDL
 * string via dataType(); values read/written as pgvector-formatted strings "[v1,v2,...]".
 */
const pgvector = (dimensions: number) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
  });

export const kbStudioChunks = pgTable("kb_studio_chunks", {
  id: serial("id").primaryKey(),
  // Namespace/corpus key (e.g. "programming-vendor-x", "product-line-a"). Arbitrary
  // operator-chosen string — ALWAYS a bound SQL parameter at the call sites in
  // server/services/kbVectorStore.ts (never string-concatenated into a query).
  corpus: varchar("corpus", { length: 120 }).notNull(),
  // pdf | docx | md | txt today; url | video are future E3-3/E3-4 source types the column
  // already accommodates (kept as varchar, not a pg enum, so those don't need a migration).
  sourceType: varchar("sourceType", { length: 20 }).notNull(),
  sourceRef: varchar("sourceRef", { length: 500 }).notNull(), // filename or URL
  chunkIndex: integer("chunkIndex").notNull(),
  text: text("text").notNull(),
  // TEXT JSON array of the embedding (back-compat + brute-force fallback), mirrors
  // kb_chunks/ai_image_embeddings.
  embedding: text("embedding"),
  embeddingDim: integer("embeddingDim"),
  tokenCount: integer("tokenCount"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // pgvector(1024) — mirrors ai_image_embeddings.embeddingVec. Nullable: only populated for
  // 1024-dim rows (the configured GGUF_EMBED_DIM). The HNSW index is manual, see above.
  embeddingVec: pgvector(1024)("embedding_vec"),
}, (table) => [
  index("idx_kb_studio_chunks_corpus").on(table.corpus),
  index("idx_kb_studio_chunks_source").on(table.corpus, table.sourceRef),
  unique("uq_kb_studio_chunks_corpus_source_chunk").on(table.corpus, table.sourceRef, table.chunkIndex),
]);

export type KbStudioChunk = typeof kbStudioChunks.$inferSelect;
export type InsertKbStudioChunk = typeof kbStudioChunks.$inferInsert;
