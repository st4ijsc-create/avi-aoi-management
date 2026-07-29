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
import { andonEvents, predictiveAlerts, predictiveAlertOccurrences, machines, users } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";
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
      // Wave 4 §4 — KPI đếm theo LẦN TÁI DIỄN, không theo dòng cảnh báo.
      // Wave 3 gộp trùng ⇒ đếm theo dòng làm KPI báo thiếu và làm cảnh báo
      // đang sống rơi khỏi cửa sổ (vì createdAt được cố ý giữ nguyên).
      const loadPredRows = async () => {
        return db
          .select({
            occurrenceId: predictiveAlertOccurrences.id,
            occurredAt: predictiveAlertOccurrences.occurredAt,
            occurrenceSeverity: predictiveAlertOccurrences.severity,
            id: predictiveAlerts.id,
            severity: predictiveAlerts.severity,
            acknowledgedAt: predictiveAlerts.acknowledgedAt,
            resolvedAt: predictiveAlerts.resolvedAt,
            status: predictiveAlerts.status,
            machineId: predictiveAlerts.machineId,
            machineCode: predictiveAlerts.machineCode,
            title: predictiveAlerts.title,
          })
          .from(predictiveAlertOccurrences)
          .innerJoin(predictiveAlerts, eq(predictiveAlerts.id, predictiveAlertOccurrences.alertId))
          .where(gte(predictiveAlertOccurrences.occurredAt, since));
      };
      // Vòng sửa cuối §2 — bảng nhật ký (predictive_alert_occurrences, mig
      // 0308/0309) có thể CHƯA tồn tại nếu mã được deploy trước khi migration
      // chạy trên một môi trường nào đó. Không guard ⇒ 42P01 lọt tới tRPC ⇒
      // 500 sập CẢ /alarm-kpi lẫn panel alarmHealth ở Control Tower — kể cả
      // phần Andon vốn không liên quan gì tới bảng này. Theo đúng mẫu
      // isMissingTable đã dùng ở pruneOldOccurrences (alertExpirySweeper.ts).
      let predRows: Awaited<ReturnType<typeof loadPredRows>> = [];
      try {
        predRows = await loadPredRows();
      } catch (err) {
        if (!isMissingTable(err)) throw err;
        console.warn("[alarmKpi] bảng nhật ký lần-tái-diễn chưa có (migration 0309 chưa chạy?) — coi predictive alerts là rỗng.");
      }

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
      // Vòng sửa cuối §1 — hồi quy do CHÍNH Wave 4 gây ra: computeStanding()
      // (alarmKpiMath.ts, KHÔNG đụng ở đây) lọc `resolvedAt==null && tuổi≥24h`
      // trên TOÀN BỘ sự kiện — nó đếm LƯỢT KÍCH HOẠT, còn ISA-18.2 "standing
      // alarm" đếm BÁO ĐỘNG. Trước sửa, MỌI lần tái diễn của một cảnh báo còn
      // mở đều giữ resolvedAt=null (vì chỉ nhìn trạng thái dòng CHA) ⇒ N lần
      // tái diễn = N dòng "tồn đọng" cho MỘT cảnh báo (đo được: 1 cảnh báo
      // tái diễn 22 lần/ngày × 3 ngày, cửa sổ 72h ⇒ 43, đúng ra là 1).
      //
      // Sửa — KHÔNG bỏ bớt sự kiện (sẽ phá lại đúng thứ Wave 4 vừa sửa: đếm đủ
      // N lần + phát hiện ngập). Gom theo cảnh báo cha (r.id), sắp theo
      // occurredAt: mỗi lần tái diễn (trừ lần MỚI NHẤT) coi như "kết thúc" tại
      // thời điểm lần kế tiếp xảy ra — resolvedAt = occurredAt của lần sau.
      // Chỉ lần MỚI NHẤT giữ resolvedAt theo trạng thái thật của dòng cha (null
      // nếu còn mở) ⇒ computeStanding() không còn cách nào đếm >1 dòng "còn
      // mở" cho cùng một cảnh báo — standing trở lại đếm THEO CẢNH BÁO.
      type PredRow = (typeof predRows)[number];
      const predRowsByAlert = new Map<number, PredRow[]>();
      for (const r of predRows) {
        if (input?.machineId && r.machineId !== input.machineId) continue;
        const arr = predRowsByAlert.get(r.id);
        if (arr) arr.push(r);
        else predRowsByAlert.set(r.id, [r]);
      }
      for (const rows of predRowsByAlert.values()) {
        rows.sort((a, b) => (ms(a.occurredAt) ?? 0) - (ms(b.occurredAt) ?? 0));
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const label = r.machineId != null ? machineMap.get(r.machineId) ?? r.machineCode ?? `#${r.machineId}` : (r.machineCode ?? null);
          // EXPIRED (alertExpirySweeper, Wave 3) tự đóng cảnh báo và KHÔNG set
          // resolvedAt — thiếu nhánh này thì cảnh báo tự hết hạn vẫn bị coi là
          // "đang mở" (Task 6 đã sửa đúng status này ở `list`; chỗ này bỏ sót).
          const isResolved = r.resolvedAt != null || r.status === "RESOLVED" || r.status === "DISMISSED" || r.status === "EXPIRED";
          const isLatest = i === rows.length - 1;
          const resolvedAt = isLatest
            ? (isResolved ? ms(r.resolvedAt) ?? now : null)
            : ms(rows[i + 1].occurredAt) ?? now;
          events.push({
            // id phải DUY NHẤT mỗi lần tái diễn, nếu không summarize sẽ gộp nhầm.
            id: `pred:${r.id}:${r.occurrenceId}`,
            source: "predictive",
            // Mức độ của CHÍNH LẦN NÀY; thiếu thì lùi về mức của dòng cha.
            priority: normalizePredictiveSeverity(r.occurrenceSeverity ?? r.severity),
            // raisedAt = thời điểm LẦN NÀY xảy ra — đây là thứ sửa cả 3 lỗi Wave 4.
            raisedAt: ms(r.occurredAt) ?? now,
            acknowledgedAt: ms(r.acknowledgedAt),
            resolvedAt,
            actorKey: r.machineId != null ? `machine:${r.machineId}` : label ? `code:${label}` : null,
            actorLabel: label,
            title: r.title,
          });
        }
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
