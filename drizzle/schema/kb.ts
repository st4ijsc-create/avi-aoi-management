// Schema domain: Knowledge Base vector store (Phase 4 WS4.1 — production RAG).
// Mirrors ai_image_embeddings: a TEXT `embedding` (JSON array, always present,
// brute-force fallback) + a pgvector `embedding_vec` column added by migration
// 0121 (guarded). The legacy file-based knowledge/*.jsonl path stays intact;
// this store is opt-in via KB_PGVECTOR_ENABLED.
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";

export const kbChunks = pgTable("kb_chunks", {
  id: serial("id").primaryKey(),
  docId: varchar("docId", { length: 255 }).notNull(),
  chunkIndex: integer("chunkIndex").notNull(),
  content: text("content").notNull(),
  // TEXT JSON array of the embedding (back-compat + brute-force fallback).
  embedding: text("embedding"),
  embeddingDim: integer("embeddingDim"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // NOTE: embedding_vec vector(1024) is added by migration 0121 (pgvector),
  // not declared here (Drizzle has no native vector type) — accessed via raw SQL.
}, (table) => [
  unique("uq_kb_chunks_doc_chunk").on(table.docId, table.chunkIndex),
  index("idx_kb_chunks_doc").on(table.docId),
]);

export type KbChunk = typeof kbChunks.$inferSelect;
export type InsertKbChunk = typeof kbChunks.$inferInsert;
