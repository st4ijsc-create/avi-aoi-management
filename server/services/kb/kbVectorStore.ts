/**
 * KB production vector store (Phase 4 WS4.1) — pgvector-backed RAG.
 *
 * Ingests the existing knowledge/chunks.jsonl into the kb_chunks table with GGUF
 * embeddings, then serves similarity search via pgvector (HNSW) with a Node
 * brute-force fallback (mirrors aiImageEmbedding). Additive: the legacy
 * file-based KB path is untouched; switch over with KB_PGVECTOR_ENABLED.
 */
import fs from "fs";
import { DbUnavailableError } from "../../_core/dbErrors";
import path from "path";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { kbChunks } from "../../../drizzle/schema";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const DIM = 1024;
const BRUTEFORCE_LIMIT = 5000;

export function isKbPgvectorEnabled(): boolean {
  return process.env.KB_PGVECTOR_ENABLED === "true";
}

interface RawChunk {
  id?: string;
  sourcePath?: string;
  title?: string;
  text?: string;
  keywords?: string[];
  [k: string]: unknown;
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

/** Ingest knowledge/chunks.jsonl → kb_chunks (with embeddings). Idempotent upsert. */
export async function ingestKbChunks(opts?: { limit?: number }): Promise<{ ingested: number; skipped: number }> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  if (!fs.existsSync(CHUNKS_FILE)) throw new Error(`chunks file not found: ${CHUNKS_FILE}`);

  const { generateEmbedding } = await import("../aiGgufEngine");
  const lines = fs.readFileSync(CHUNKS_FILE, "utf-8").split("\n").filter((l) => l.trim());
  const limit = opts?.limit ?? lines.length;

  // dot2 Task 4 (bổ sung) — ba đường skipped++ khác nhau đổ chung vào một biến; đếm riêng để
  // dòng tổng kết :~100 phân biệt được "N dòng JSON hỏng" / "N chunk rỗng" / "N lần nhúng lỗi"
  // (ba nguyên nhân, ba cách xử lý khác nhau — trước đây một con số "skipped" gộp không đọc
  // được). KHÔNG đổi kiểu trả về { ingested, skipped } — kbVectorRouter.ts gọi nguyên hình dạng
  // này, tách số chỉ nằm trong log.
  let ingested = 0, skipped = 0;
  let skippedParseError = 0, skippedEmptyContent = 0, skippedEmbedError = 0;
  for (let i = 0; i < Math.min(lines.length, limit); i++) {
    let chunk: RawChunk;
    try {
      chunk = JSON.parse(lines[i]);
    } catch (err) {
      // Trước đây: catch trần, không một chữ nào — dòng hỏng biến mất hoàn toàn không dấu vết.
      // Chưa parse được nên chưa có docId; chỉ số dòng i là định danh duy nhất còn lại.
      console.error(`[KB] parse failed at line ${i}:`, (err as Error)?.message ?? err);
      skipped++;
      skippedParseError++;
      continue;
    }
    const content = (chunk.text ?? "").trim();
    const docId = String(chunk.id ?? chunk.sourcePath ?? `chunk-${i}`);
    if (!content) {
      // Trước đây: skip câm lặng — nếu một bước sinh chunk thượng nguồn hỏng và đẻ ra hàng loạt
      // chunk rỗng, người vận hành chỉ thấy con số skipped tăng mà không biết vì sao.
      console.error(`[KB] empty content for ${docId} (line ${i}) — skipped`);
      skipped++;
      skippedEmptyContent++;
      continue;
    }

    try {
      const { embedding } = await generateEmbedding(content);
      const embStr = JSON.stringify(embedding);
      const [row] = await db.insert(kbChunks).values({
        docId,
        chunkIndex: 0,
        content,
        embedding: embStr,
        embeddingDim: embedding.length,
        metadata: { sourcePath: chunk.sourcePath, title: chunk.title, keywords: chunk.keywords },
      }).onConflictDoUpdate({
        target: [kbChunks.docId, kbChunks.chunkIndex],
        set: { content, embedding: embStr, embeddingDim: embedding.length },
      }).returning({ id: kbChunks.id });

      // Write the pgvector column (guarded — no-op if pgvector absent).
      if (row?.id && embedding.length === DIM) {
        try {
          await db.execute(sql`UPDATE kb_chunks SET embedding_vec = ${`[${embedding.join(",")}]`}::vector(${sql.raw(String(DIM))}) WHERE id = ${row.id}`);
        } catch {
          /* pgvector unavailable — TEXT embedding remains the source */
        }
      }
      ingested++;
      if (ingested % 50 === 0) console.log(`[KB] ingested ${ingested} chunks...`);
    } catch (err) {
      console.error(`[KB] embed/store failed for ${docId}:`, (err as Error)?.message ?? err);
      skipped++;
      skippedEmbedError++;
    }
  }
  console.log(
    `[KB] ingest done — ${ingested} ingested, ${skipped} skipped ` +
      `(parseError:${skippedParseError} emptyContent:${skippedEmptyContent} embedError:${skippedEmbedError})`,
  );
  return { ingested, skipped };
}

export interface KbSearchHit {
  id: number;
  docId: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number;
}

/** Similarity search: pgvector HNSW → Node brute-force fallback. */
export async function searchKb(query: string, topK = 5): Promise<KbSearchHit[]> {
  const db = await getDb();
  if (!db) return [];
  const { generateEmbedding } = await import("../aiGgufEngine");
  const { embedding } = await generateEmbedding(query);
  const vecStr = `[${embedding.join(",")}]`;

  // 1) pgvector HNSW (cosine distance <=>).
  try {
    const rows = (await db.execute(sql`
      SELECT id, "docId", content, metadata,
             1 - (embedding_vec <=> ${vecStr}::vector(${sql.raw(String(DIM))})) AS score
      FROM kb_chunks
      WHERE embedding_vec IS NOT NULL
      ORDER BY embedding_vec <=> ${vecStr}::vector(${sql.raw(String(DIM))})
      LIMIT ${topK}
    `)) as unknown as Array<{ id: number; docId: string; content: string; metadata: Record<string, unknown> | null; score: number }>;
    if (Array.isArray(rows) && rows.length) {
      return rows.map((r) => ({ id: r.id, docId: r.docId, content: r.content, metadata: r.metadata, score: Number(r.score) }));
    }
  } catch {
    /* fall through to brute-force */
  }

  // 2) Brute-force cosine in Node over the TEXT embedding column.
  const rows = await db.select().from(kbChunks).limit(BRUTEFORCE_LIMIT);
  const scored: KbSearchHit[] = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    let vec: number[];
    try {
      vec = JSON.parse(r.embedding);
    } catch {
      continue;
    }
    scored.push({ id: r.id, docId: r.docId, content: r.content, metadata: r.metadata, score: cosine(embedding, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
