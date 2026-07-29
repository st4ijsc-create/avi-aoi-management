/**
 * Sprint 5 §3.2 — chọn câu giải thích cho số 0 trên bảng KPI báo động.
 * Trả null khi không cần giải thích gì (có dữ liệu, hoặc đang có cảnh báo).
 */
export type OccurrenceLogNotice =
  | { kind: "table-missing" }
  | { kind: "log-empty" }
  | { kind: "log-younger-than-window"; firstOccurredAt: string }
  | null;

export function pickOccurrenceLogNotice(input: {
  predictiveCount: number;
  occurrenceLog: { available: boolean; firstOccurredAt: string | null } | undefined;
  generatedAt: string | undefined;
  windowHours: number;
}): OccurrenceLogNotice {
  if (input.predictiveCount > 0) return null;
  const log = input.occurrenceLog;
  if (!log) return null; // server cũ chưa trả trường này — không bịa
  if (!log.available) return { kind: "table-missing" };
  if (log.firstOccurredAt == null) return { kind: "log-empty" };
  if (!input.generatedAt) return null;
  const since = new Date(input.generatedAt).getTime() - input.windowHours * 3600_000;
  const first = new Date(log.firstOccurredAt).getTime();
  if (Number.isFinite(first) && first > since) {
    return { kind: "log-younger-than-window", firstOccurredAt: log.firstOccurredAt };
  }
  return null;
}
