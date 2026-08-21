/**
 * Doc 35 W4-C.3 — Stencil cycle counter.
 *
 * Accrues stencil print cycles into stencil_usage_logs and computes a worn status
 * by comparing total prints against the tool's lifeLimit. The `tools` master is
 * read ONLY here (never written): total prints = tools.lifeUsed (baseline) +
 * SUM(stencil_usage_logs.printCount). Clean / tension checks are recorded on each
 * usage entry.
 *
 * SAFETY / GATING: recording usage always works. The advisory side-effect (flagging
 * a stencil as worn / raising an alert) is gated by STENCIL_TRACKING_ENABLED
 * (DEFAULT OFF). Nothing here writes the tools master or controls a machine.
 */
import { getDb } from "../db";
import { DbUnavailableError } from "../_core/dbErrors";
import { chayTheoPhamViTenantHienTai } from "../db/tenantContext";
import { eq, desc, sql } from "drizzle-orm";
import { stencilUsageLogs, tools, type InsertStencilUsageLog } from "../../drizzle/schema";

export function isStencilTrackingEnabled(): boolean {
  return process.env.STENCIL_TRACKING_ENABLED === "true" || process.env.STENCIL_TRACKING_ENABLED === "1";
}

export interface RecordPrintsInput {
  stencilToolId: number;
  printCount: number;
  machineId?: number | null;
  cleanedAt?: Date | null;
  tensionCheckAt?: Date | null;
  tensionValue?: number | null;
  recordedBy?: number | null;
  notes?: string | null;
}

/**
 * Record a batch of print cycles (and optional clean / tension check) for a stencil.
 * Returns the freshly recomputed status.
 */
export async function recordPrints(input: RecordPrintsInput) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  if (input.printCount < 0) throw new Error("printCount must be >= 0");

  const values: InsertStencilUsageLog = {
    stencilToolId: input.stencilToolId,
    printCount: Math.trunc(input.printCount),
    machineId: input.machineId ?? null,
    cleanedAt: input.cleanedAt ?? null,
    tensionCheckAt: input.tensionCheckAt ?? null,
    tensionValue: input.tensionValue == null ? null : String(input.tensionValue),
    recordedBy: input.recordedBy ?? null,
    notes: input.notes ?? null,
  };

  const [row] = await db.insert(stencilUsageLogs).values(values).returning({ id: stencilUsageLogs.id });
  const status = await getStatus(input.stencilToolId);
  return { id: row.id, ...status };
}

export interface StencilStatus {
  stencilToolId: number;
  code: string | null;
  name: string | null;
  baselineUsed: number;      // tools.lifeUsed (read-only baseline)
  accruedPrints: number;     // SUM(stencil_usage_logs.printCount)
  totalPrints: number;       // baselineUsed + accruedPrints
  lifeLimit: number | null;  // tools.lifeLimit (null = unlimited)
  remaining: number | null;  // lifeLimit - totalPrints (null when unlimited)
  worn: boolean;             // totalPrints >= lifeLimit (false when unlimited)
  lastCleanedAt: Date | null;
  lastTensionCheckAt: Date | null;
  trackingEnabled: boolean;
}

/**
 * Compute the live status of a stencil from the read-only tools master + the usage
 * ledger. `worn` is advisory; whether it drives an alert is gated by
 * STENCIL_TRACKING_ENABLED (this function only reports the flag state).
 */
export async function getStatus(stencilToolId: number): Promise<StencilStatus> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();

  // `tools` BẬT RLS (mig 0122, vị từ theo factoryCode/corporateCode). Đọc bản ghi
  // khuôn in dưới phạm vi tenant của người gọi ⇒ người thuộc nhà máy khác không
  // đọc được thông số khuôn của nhà máy này (`tool` = undefined ⇒ trạng thái
  // rỗng, KHÔNG ném lỗi — hàm này vốn đã chịu được `tool` rỗng, xem `?? null`
  // bên dưới). Tác vụ nền / cờ tắt ⇒ pass-through y như trước.
  const [tool] = await chayTheoPhamViTenantHienTai(db, (h) =>
    h
      .select({ id: tools.id, code: tools.code, name: tools.name, lifeLimit: tools.lifeLimit, lifeUsed: tools.lifeUsed })
      .from(tools)
      .where(eq(tools.id, stencilToolId))
      .limit(1),
  );

  const [agg] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${stencilUsageLogs.printCount}), 0)`,
      lastCleanedAt: sql<Date | null>`MAX(${stencilUsageLogs.cleanedAt})`,
      lastTensionCheckAt: sql<Date | null>`MAX(${stencilUsageLogs.tensionCheckAt})`,
    })
    .from(stencilUsageLogs)
    .where(eq(stencilUsageLogs.stencilToolId, stencilToolId));

  const baselineUsed = Number(tool?.lifeUsed ?? 0);
  const accruedPrints = Number(agg?.total ?? 0);
  const totalPrints = baselineUsed + accruedPrints;
  const lifeLimit = tool?.lifeLimit ?? null;
  const remaining = lifeLimit == null ? null : lifeLimit - totalPrints;
  const worn = lifeLimit != null && totalPrints >= lifeLimit;

  return {
    stencilToolId,
    code: tool?.code ?? null,
    name: tool?.name ?? null,
    baselineUsed,
    accruedPrints,
    totalPrints,
    lifeLimit,
    remaining,
    worn,
    lastCleanedAt: agg?.lastCleanedAt ?? null,
    lastTensionCheckAt: agg?.lastTensionCheckAt ?? null,
    trackingEnabled: isStencilTrackingEnabled(),
  };
}

/** Recent usage log entries for a stencil (newest first). */
export async function listUsage(stencilToolId: number, limit = 100) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db
    .select()
    .from(stencilUsageLogs)
    .where(eq(stencilUsageLogs.stencilToolId, stencilToolId))
    .orderBy(desc(stencilUsageLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
