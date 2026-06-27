/**
 * B3 — Data access cho anomaly memory bank + profiles.
 *
 * Mọi hàm getDb() null-guard:
 *   • read  → trả rỗng/null an toàn (best-effort, không throw trên hot path).
 *   • write → throw "Database not available" (admin action, cần biết thất bại).
 *
 * pgvector OPTIONAL: ghi cột embedding_vec là best-effort (try/catch). Cột
 * embedding TEXT luôn là nguồn raw → load brute-force JS hoạt động kể cả khi
 * thiếu pgvector.
 */
import { getDb } from "./connection";
import { and, eq, desc, sql, SQL } from "drizzle-orm";
import {
  aiAnomalyMemoryBank,
  aiAnomalyProfiles,
  type AiAnomalyProfile,
} from "../../drizzle/schema";

const DEFAULT_EMBEDDING_DIM = 1024;

export interface AnomalyScope {
  productModelId: number | null;
  machineId: number | null;
  modelCode: string;
}

function scopeConditions(scope: AnomalyScope): SQL[] {
  const conds: SQL[] = [eq(aiAnomalyMemoryBank.modelCode, scope.modelCode)];
  conds.push(
    scope.productModelId == null
      ? (sql`${aiAnomalyMemoryBank.productModelId} IS NULL` as SQL)
      : eq(aiAnomalyMemoryBank.productModelId, scope.productModelId),
  );
  conds.push(
    scope.machineId == null
      ? (sql`${aiAnomalyMemoryBank.machineId} IS NULL` as SQL)
      : eq(aiAnomalyMemoryBank.machineId, scope.machineId),
  );
  return conds;
}

function formatVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function parseVectorLiteral(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

// ─── Bank CRUD ─────────────────────────────────────────────────────────────────

export async function clearBank(scope: AnomalyScope): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(aiAnomalyMemoryBank).where(and(...scopeConditions(scope)));
}

export interface BankRowInput {
  vector: number[];
  dim: number;
  source: string;
  imageUrl?: string | null;
}

export async function insertBankRows(scope: AnomalyScope, rows: BankRowInput[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (rows.length === 0) return 0;

  // Insert qua raw SQL CHỈ các cột chắc chắn tồn tại (KHÔNG đụng embedding_vec — cột
  // pgvector OPTIONAL, có thể chưa được migrate). embedding_vec điền best-effort bên dưới.
  const inserted: Array<{ id: number }> = [];
  for (const r of rows) {
    const res = await db.execute(sql`
      INSERT INTO ai_anomaly_memory_bank
        ("productModelId", "machineId", "modelCode", "embedding", "embeddingDim", "source", "imageUrl")
      VALUES (
        ${scope.productModelId}, ${scope.machineId}, ${scope.modelCode},
        ${formatVectorLiteral(r.vector)}, ${r.dim}, ${r.source}, ${r.imageUrl ?? null}
      )
      RETURNING id
    `);
    const resRows = ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as Array<{ id: number | string }>;
    if (resRows[0]) inserted.push({ id: Number(resRows[0].id) });
  }

  // Best-effort: ghi cột pgvector embedding_vec cho dòng 1024-dim. Thiếu pgvector/cột → bỏ qua.
  for (let i = 0; i < inserted.length; i++) {
    const r = rows[i];
    if (r.dim !== DEFAULT_EMBEDDING_DIM) continue;
    try {
      const lit = formatVectorLiteral(r.vector);
      await db.execute(
        sql`UPDATE ai_anomaly_memory_bank SET embedding_vec = ${lit}::vector(${sql.raw(String(DEFAULT_EMBEDDING_DIM))}) WHERE id = ${inserted[i].id}`,
      );
    } catch {
      // pgvector/cột chưa sẵn sàng → cột TEXT vẫn là nguồn raw.
      break; // nếu 1 dòng lỗi do thiếu cột thì các dòng sau cũng lỗi → dừng sớm.
    }
  }

  return inserted.length;
}

/**
 * Tải bank về dạng vector[] (parse TEXT embedding). Giới hạn `limit` dòng (bảo vệ
 * RAM/CPU brute-force JS). getDb null → []. Đây là đường brute-force JS độc lập
 * pgvector → luôn hoạt động offline.
 */
export async function loadBank(scope: AnomalyScope, limit: number): Promise<number[][]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ embedding: aiAnomalyMemoryBank.embedding })
    .from(aiAnomalyMemoryBank)
    .where(and(...scopeConditions(scope)))
    .orderBy(desc(aiAnomalyMemoryBank.createdAt))
    .limit(Math.max(1, limit));

  const out: number[][] = [];
  for (const r of rows) {
    const v = parseVectorLiteral(r.embedding);
    if (v.length > 0) out.push(v);
  }
  return out;
}

// ─── Stored embedding read (ai_image_embeddings) ──────────────────────────────

export interface StoredEmbeddingRow {
  id: number;
  vector: number[];
  dim: number;
  imageUrl: string | null;
}

export interface StoredEmbeddingFilter {
  machineId?: number | null;
  productModelId?: number | null;
  modelCode: string;
  /** Khi true → JOIN product_inspections, chỉ giữ overallResult='OK'. */
  okOnly?: boolean;
  limit?: number;
}

/**
 * Đọc vector đã LƯU trong ai_image_embeddings theo scope (machine/product/modelCode).
 * Không cần ảnh gốc — parse cột TEXT embedding "[...]" → number[].
 *
 * okOnly=true → JOIN product_inspections trên inspectionId, giữ overallResult='OK'
 * (chỉ ảnh OK để dựng memory bank PatchCore).
 *
 * getDb null → [] (đường brute-force JS, fail-safe).
 */
export async function readStoredEmbeddings(filter: StoredEmbeddingFilter): Promise<StoredEmbeddingRow[]> {
  const db = await getDb();
  if (!db) return [];

  const conds: SQL[] = [sql`e."modelCode" = ${filter.modelCode}`];
  if (filter.machineId != null) conds.push(sql`e."machineId" = ${filter.machineId}`);
  if (filter.productModelId != null) conds.push(sql`e."productModelId" = ${filter.productModelId}`);

  const joinClause = filter.okOnly
    ? sql`JOIN product_inspections pi ON pi."id" = e."inspectionId"`
    : sql``;
  if (filter.okOnly) conds.push(sql`pi."overallResult" = 'OK'`);

  const whereClause = sql.join(conds, sql` AND `);
  const lim = Math.max(1, Math.min(filter.limit ?? 100000, 1000000));

  const result = await db.execute(sql`
    SELECT e."id" AS id, e."embedding" AS embedding, e."embeddingDim" AS dim, e."imageUrl" AS image_url
    FROM ai_image_embeddings e
    ${joinClause}
    WHERE ${whereClause}
    ORDER BY e."id" ASC
    LIMIT ${lim}
  `);

  const rows = ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<{
    id: number | string;
    embedding: string | null;
    dim: number | string | null;
    image_url: string | null;
  }>;

  const out: StoredEmbeddingRow[] = [];
  for (const r of rows) {
    const vec = parseVectorLiteral(r.embedding);
    if (vec.length === 0) continue;
    out.push({
      id: Number(r.id),
      vector: vec,
      dim: r.dim != null ? Number(r.dim) : vec.length,
      imageUrl: r.image_url ?? null,
    });
  }
  return out;
}

/**
 * Ghi kết quả anomaly vào ai_image_embeddings.metadata->'anomaly' (idempotent jsonb
 * merge: giữ khóa cũ, ghi đè "anomaly"). Trùng shape worker ghi + cờ backfill:true.
 * getDb null → no-op (fail-safe). Throw để caller đếm lỗi per-row nếu cần.
 */
export async function writeAnomalyMetadata(embeddingId: number, anomaly: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const metaStr = JSON.stringify({ anomaly });
  await db.execute(sql`
    UPDATE ai_image_embeddings
    SET metadata = (COALESCE(metadata::jsonb, '{}'::jsonb) || ${metaStr}::jsonb)::json
    WHERE id = ${embeddingId}
  `);
}

// ─── Profile CRUD ────────────────────────────────────────────────────────────

export interface ProfileInput {
  threshold: number;
  k: number;
  distStats: AiAnomalyProfile["distStats"];
  bankSize: number;
  source: string;
  degraded: boolean;
}

function profileScopeConds(scope: AnomalyScope): SQL[] {
  const conds: SQL[] = [eq(aiAnomalyProfiles.modelCode, scope.modelCode)];
  conds.push(
    scope.productModelId == null
      ? (sql`${aiAnomalyProfiles.productModelId} IS NULL` as SQL)
      : eq(aiAnomalyProfiles.productModelId, scope.productModelId),
  );
  conds.push(
    scope.machineId == null
      ? (sql`${aiAnomalyProfiles.machineId} IS NULL` as SQL)
      : eq(aiAnomalyProfiles.machineId, scope.machineId),
  );
  return conds;
}

export async function upsertProfile(scope: AnomalyScope, input: ProfileInput): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [existing] = await db
    .select({ id: aiAnomalyProfiles.id })
    .from(aiAnomalyProfiles)
    .where(and(...profileScopeConds(scope)))
    .limit(1);

  const payload = {
    productModelId: scope.productModelId,
    machineId: scope.machineId,
    modelCode: scope.modelCode,
    threshold: input.threshold.toFixed(8),
    k: input.k,
    distStats: input.distStats,
    bankSize: input.bankSize,
    source: input.source,
    degraded: input.degraded,
    builtAt: new Date(),
  };

  if (existing) {
    await db.update(aiAnomalyProfiles).set(payload).where(eq(aiAnomalyProfiles.id, existing.id));
  } else {
    await db.insert(aiAnomalyProfiles).values(payload);
  }
}

export async function getProfile(scope: AnomalyScope): Promise<AiAnomalyProfile | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(aiAnomalyProfiles)
    .where(and(...profileScopeConds(scope)))
    .limit(1);
  return row ?? null;
}

export async function deleteScope(scope: AnomalyScope): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(aiAnomalyMemoryBank).where(and(...scopeConditions(scope)));
  await db.delete(aiAnomalyProfiles).where(and(...profileScopeConds(scope)));
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

export async function getBankStats(filter: { productModelId: number | null; machineId: number | null }) {
  const empty = { totalVectors: 0, profiles: [] as AiAnomalyProfile[], distinctModelCodes: 0 };
  const db = await getDb();
  if (!db) return empty;

  const bankConds: SQL[] = [];
  if (filter.productModelId != null) bankConds.push(eq(aiAnomalyMemoryBank.productModelId, filter.productModelId));
  if (filter.machineId != null) bankConds.push(eq(aiAnomalyMemoryBank.machineId, filter.machineId));

  const [agg] = await db
    .select({
      totalVectors: sql<number>`count(*)`,
      distinctModelCodes: sql<number>`count(distinct ${aiAnomalyMemoryBank.modelCode})`,
    })
    .from(aiAnomalyMemoryBank)
    .where(bankConds.length > 0 ? and(...bankConds) : undefined);

  const profConds: SQL[] = [];
  if (filter.productModelId != null) profConds.push(eq(aiAnomalyProfiles.productModelId, filter.productModelId));
  if (filter.machineId != null) profConds.push(eq(aiAnomalyProfiles.machineId, filter.machineId));

  const profiles = await db
    .select()
    .from(aiAnomalyProfiles)
    .where(profConds.length > 0 ? and(...profConds) : undefined)
    .orderBy(desc(aiAnomalyProfiles.builtAt))
    .limit(50);

  return {
    totalVectors: Number(agg?.totalVectors ?? 0),
    distinctModelCodes: Number(agg?.distinctModelCodes ?? 0),
    profiles,
  };
}
