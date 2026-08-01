/**
 * doc 44 W6-1 (G5.11 phần đo) — ISA-18.2 Alarm KPI router (READ-ONLY).
 *
 * Đọc andon_events + predictive_alerts (KHÔNG sửa alert router hiện có), chuẩn hóa
 * về AlarmEventLite rồi tính KPI ISA-18.2 bằng alarmKpiMath (pure): tần suất
 * alarm/giờ/operator, flood (>10/10ph), standing (>24h chưa xử lý), top-10 bad
 * actors, phân bố ưu tiên. Cửa sổ mặc định 8h (1 ca).
 *
 * RBAC: protectedProcedure (đọc); route FE gate riêng bằng RouteGuard. operatorCount
 * suy từ số user role 'operator' đang hoạt động (fallback 1) nếu client không truyền.
 */
import { z } from "zod";
import { and, eq, gte, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { andonEvents, predictiveAlerts, machines, users } from "../../drizzle/schema";
import {
  summarizeAlarmKpi,
  normalizeAndonState,
  normalizePredictiveSeverity,
  type AlarmEventLite,
} from "../services/alarmKpiMath";

function ms(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

export const alarmKpiRouter = router({
  /**
   * KPI tổng hợp ISA-18.2 cho cửa sổ `windowHours` (mặc định 8h). Gộp andon (đèn
   * xưởng) + predictive (cảnh báo AI) làm nguồn báo động — hai kênh vận hành mà
   * operator phải phản ứng.
   */
  summary: protectedProcedure
    .input(
      z
        .object({
          windowHours: z.number().int().min(1).max(24 * 30).optional(),
          operatorCount: z.number().int().min(1).max(10_000).optional(),
          lineId: z.number().int().positive().nullable().optional(),
          machineId: z.number().int().positive().nullable().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const windowHours = input?.windowHours ?? 8;
      const now = Date.now();
      const since = new Date(now - windowHours * 3600_000);

      // ── Andon events (đèn xưởng) ──────────────────────────────────────────────
      const andonConds = [gte(andonEvents.raisedAt, since)];
      if (input?.lineId) andonConds.push(eq(andonEvents.lineId, input.lineId));
      const andonRows = await db
        .select({
          id: andonEvents.id,
          state: andonEvents.state,
          raisedAt: andonEvents.raisedAt,
          acknowledgedAt: andonEvents.acknowledgedAt,
          resolvedAt: andonEvents.resolvedAt,
          machineId: andonEvents.machineId,
          stationId: andonEvents.stationId,
          lineId: andonEvents.lineId,
          title: andonEvents.title,
        })
        .from(andonEvents)
        .where(and(...andonConds));

      // ── Predictive alerts (cảnh báo AI) ───────────────────────────────────────
      const predRows = await db
        .select({
          id: predictiveAlerts.id,
          severity: predictiveAlerts.severity,
          createdAt: predictiveAlerts.createdAt,
          acknowledgedAt: predictiveAlerts.acknowledgedAt,
          resolvedAt: predictiveAlerts.resolvedAt,
          status: predictiveAlerts.status,
          machineId: predictiveAlerts.machineId,
          machineCode: predictiveAlerts.machineCode,
          title: predictiveAlerts.title,
        })
        .from(predictiveAlerts)
        .where(gte(predictiveAlerts.createdAt, since));

      // ── Nhãn máy (bad-actor readable) — tra code cho các machineId liên quan ────
      const machineIds = Array.from(
        new Set(
          [...andonRows.map((r) => r.machineId), ...predRows.map((r) => r.machineId)].filter(
            (x): x is number => x != null,
          ),
        ),
      );
      const machineMap = new Map<number, string>();
      if (machineIds.length > 0) {
        const mrows = await db
          .select({ id: machines.id, code: machines.code, name: machines.name })
          .from(machines)
          .where(inArray(machines.id, machineIds));
        for (const m of mrows) machineMap.set(m.id, m.code || m.name || `#${m.id}`);
      }

      const events: AlarmEventLite[] = [];

      for (const r of andonRows) {
        if (input?.machineId && r.machineId !== input.machineId) continue;
        const { actorKey, actorLabel } = resolveActor(r.machineId, r.stationId, r.lineId, machineMap);
        events.push({
          id: `andon:${r.id}`,
          source: "andon",
          priority: normalizeAndonState(r.state),
          raisedAt: ms(r.raisedAt) ?? now,
          acknowledgedAt: ms(r.acknowledgedAt),
          resolvedAt: ms(r.resolvedAt),
          actorKey,
          actorLabel,
          title: r.title,
        });
      }
      for (const r of predRows) {
        if (input?.machineId && r.machineId !== input.machineId) continue;
        const label = r.machineId != null ? machineMap.get(r.machineId) ?? r.machineCode ?? `#${r.machineId}` : (r.machineCode ?? null);
        const isResolved = r.resolvedAt != null || r.status === "RESOLVED" || r.status === "DISMISSED";
        events.push({
          id: `pred:${r.id}`,
          source: "predictive",
          priority: normalizePredictiveSeverity(r.severity),
          raisedAt: ms(r.createdAt) ?? now,
          acknowledgedAt: ms(r.acknowledgedAt),
          resolvedAt: isResolved ? ms(r.resolvedAt) ?? now : null,
          actorKey: r.machineId != null ? `machine:${r.machineId}` : label ? `code:${label}` : null,
          actorLabel: label,
          title: r.title,
        });
      }

      // ── operatorCount: input > số operator active > 1 ─────────────────────────
      let operatorCount = input?.operatorCount ?? 0;
      if (!operatorCount) {
        try {
          const ops = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.role, "operator"), eq(users.isActive, true)));
          operatorCount = ops.length;
        } catch {
          operatorCount = 0;
        }
      }
      operatorCount = Math.max(operatorCount, 1);

      return {
        ...summarizeAlarmKpi(events, { windowMs: windowHours * 3600_000, now, operatorCount }),
        sourceCounts: { andon: andonRows.length, predictive: predRows.length },
        generatedAt: new Date(now).toISOString(),
      };
    }),
});

function resolveActor(
  machineId: number | null,
  stationId: number | null,
  lineId: number | null,
  machineMap: Map<number, string>,
): { actorKey: string | null; actorLabel: string | null } {
  if (machineId != null) return { actorKey: `machine:${machineId}`, actorLabel: machineMap.get(machineId) ?? `Máy #${machineId}` };
  if (stationId != null) return { actorKey: `station:${stationId}`, actorLabel: `Trạm #${stationId}` };
  if (lineId != null) return { actorKey: `line:${lineId}`, actorLabel: `Tuyến #${lineId}` };
  return { actorKey: null, actorLabel: null };
}
