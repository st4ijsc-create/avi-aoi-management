import { and, desc, eq, lt, SQL } from "drizzle-orm";
import { getDb } from "./connection";
import {
  aiSpecialistSessions,
  aiSpecialistSessionSteps,
  type InsertAiSpecialistSession,
  type InsertAiSpecialistSessionStep,
} from "../../drizzle/schema";

export async function createAiSpecialistSession(data: InsertAiSpecialistSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(aiSpecialistSessions).values(data).returning();
  return result;
}

export async function appendAiSpecialistSessionStep(data: InsertAiSpecialistSessionStep) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(aiSpecialistSessionSteps).values(data).returning();
  return result;
}

export async function completeAiSpecialistSession(
  sessionId: number,
  userId: number,
  payload: { status: "completed" | "failed"; summary?: string; aggregateOutput?: unknown },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .update(aiSpecialistSessions)
    .set({
      status: payload.status,
      summary: payload.summary,
      aggregateOutput: payload.aggregateOutput,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(aiSpecialistSessions.id, sessionId), eq(aiSpecialistSessions.userId, userId)))
    .returning();

  return result;
}

export async function listAiSpecialistSessions(
  userId: number,
  options?: {
    limit?: number;
    offset?: number;
    moduleName?: string;
    status?: string;
  },
) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [eq(aiSpecialistSessions.userId, userId)];
  if (options?.moduleName) conditions.push(eq(aiSpecialistSessions.moduleName, options.moduleName));
  if (options?.status) conditions.push(eq(aiSpecialistSessions.status, options.status));

  return db
    .select()
    .from(aiSpecialistSessions)
    .where(and(...conditions))
    .orderBy(desc(aiSpecialistSessions.createdAt))
    .limit(options?.limit ?? 20)
    .offset(options?.offset ?? 0);
}

export async function getAiSpecialistSessionDetail(sessionId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;

  const [session] = await db
    .select()
    .from(aiSpecialistSessions)
    .where(and(eq(aiSpecialistSessions.id, sessionId), eq(aiSpecialistSessions.userId, userId)))
    .limit(1);

  if (!session) return null;

  const steps = await db
    .select()
    .from(aiSpecialistSessionSteps)
    .where(eq(aiSpecialistSessionSteps.sessionId, sessionId))
    .orderBy(aiSpecialistSessionSteps.stepOrder, aiSpecialistSessionSteps.createdAt);

  return {
    ...session,
    steps,
  };
}

export async function getAiSpecialistSessionById(sessionId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;

  const [session] = await db
    .select()
    .from(aiSpecialistSessions)
    .where(and(eq(aiSpecialistSessions.id, sessionId), eq(aiSpecialistSessions.userId, userId)))
    .limit(1);

  return session ?? null;
}

/** Wave 1 — đánh dấu failed cho phiên đã chạy quá lâu (tiến trình nền chết giữa chừng). */
export async function expireStaleSpecialistSessions(timeoutMs: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - timeoutMs);
  const updated = await db
    .update(aiSpecialistSessions)
    .set({ status: "failed", summary: "Hết thời gian chờ — tiến trình nền không hoàn tất.", updatedAt: new Date() })
    .where(and(eq(aiSpecialistSessions.status, "running"), lt(aiSpecialistSessions.startedAt, cutoff)))
    .returning({ id: aiSpecialistSessions.id });
  return updated.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Improvement Score
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleImprovementStats {
  moduleName: string;
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  runningSessions: number;
  completionRate: number;
  avgTokensPerSecond: number | null;
  avgTimePerStepMs: number | null;
  improvementScore: number;
}

export async function getModuleImprovementStats(
  userId: number,
  moduleName?: string,
): Promise<ModuleImprovementStats | null> {
  const db = await getDb();
  if (!db) return null;

  const conditions: SQL[] = [eq(aiSpecialistSessions.userId, userId)];
  if (moduleName) conditions.push(eq(aiSpecialistSessions.moduleName, moduleName));

  const sessionRows = await db
    .select({ status: aiSpecialistSessions.status })
    .from(aiSpecialistSessions)
    .where(and(...conditions))
    .orderBy(desc(aiSpecialistSessions.createdAt))
    .limit(500);

  const total = sessionRows.length;
  const completed = sessionRows.filter((r) => r.status === "completed").length;
  const failed = sessionRows.filter((r) => r.status === "failed").length;
  const running = sessionRows.filter((r) => r.status === "running").length;

  const stepConditions: SQL[] = [
    eq(aiSpecialistSessions.userId, userId),
    eq(aiSpecialistSessionSteps.status, "completed"),
  ];
  if (moduleName) stepConditions.push(eq(aiSpecialistSessions.moduleName, moduleName));

  const stepRows = await db
    .select({
      totalTimeMs: aiSpecialistSessionSteps.totalTimeMs,
      tokensPerSecond: aiSpecialistSessionSteps.tokensPerSecond,
    })
    .from(aiSpecialistSessionSteps)
    .innerJoin(
      aiSpecialistSessions,
      eq(aiSpecialistSessionSteps.sessionId, aiSpecialistSessions.id),
    )
    .where(and(...stepConditions))
    .limit(1000);

  const validTimeRows = stepRows.filter((s) => s.totalTimeMs !== null);
  const avgTimePerStepMs =
    validTimeRows.length > 0
      ? Math.round(
          validTimeRows.reduce((acc, s) => acc + (s.totalTimeMs ?? 0), 0) / validTimeRows.length,
        )
      : null;

  const validTpsRows = stepRows.filter((s) => s.tokensPerSecond !== null);
  const avgTokensPerSecond =
    validTpsRows.length > 0
      ? parseFloat(
          (
            validTpsRows.reduce((acc, s) => acc + parseFloat(s.tokensPerSecond ?? "0"), 0) /
            validTpsRows.length
          ).toFixed(2),
        )
      : null;

  const completionRate = total > 0 ? completed / total : 0;
  // Score components (total 100 pts):
  //   completionRate (0–1) × 60 → up to 60 pts
  //   avgTokensPerSecond capped at 25 t/s  → up to 25 pts
  //   avgTimePerStep < 30 s bonus          → up to 15 pts
  const speedScore =
    avgTokensPerSecond !== null ? Math.min((avgTokensPerSecond / 25) * 25, 25) : 0;
  const timeScore =
    avgTimePerStepMs !== null
      ? Math.min((30_000 / Math.max(avgTimePerStepMs, 1)) * 15, 15)
      : 0;
  const improvementScore = Math.min(
    Math.round(completionRate * 60 + speedScore + timeScore),
    100,
  );

  return {
    moduleName: moduleName ?? "all",
    totalSessions: total,
    completedSessions: completed,
    failedSessions: failed,
    runningSessions: running,
    completionRate: parseFloat(completionRate.toFixed(3)),
    avgTokensPerSecond,
    avgTimePerStepMs,
    improvementScore,
  };
}
