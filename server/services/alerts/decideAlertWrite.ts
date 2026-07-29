/**
 * Wave 3 §3 — MỘT-CẢNH-BÁO-MỞ cho mỗi (máy × loại).
 *
 * Tách khỏi routeAlert để test được KHÔNG CẦN DB. Bài học Wave 2: logic rủi ro
 * nằm lẫn trong hàm có I/O thì không test nào chạy qua nó.
 *
 * Hàm này KHÔNG quyết định có nên phát cảnh báo hay không — việc đó do
 * predictiveMaintenanceService quyết trước khi gọi. Nó chỉ quyết GHI MỚI hay
 * CẬP NHẬT dòng đang mở.
 */
export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface OpenAlertSnapshot {
  id: number;
  severity: AlertSeverity;
  occurrenceCount: number;
}

export interface IncomingAlert {
  machineId: number | null | undefined;
  alertType: string;
  severity: AlertSeverity;
}

export type AlertWriteDecision =
  | { action: "insert"; reason: "no-machine" | "no-open-alert" | "lookup-failed" }
  | { action: "update"; id: number; severity: AlertSeverity; occurrenceCount: number };

const RANK: Record<AlertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Mức độ chỉ đi LÊN — một tình trạng đã CRITICAL không được âm thầm tụt xuống. */
export function maxSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

export function decideAlertWrite(
  existing: OpenAlertSnapshot | null,
  incoming: IncomingAlert,
  lookupFailed = false,
): AlertWriteDecision {
  // FAIL-OPEN, ngược hướng cổng bảo mật Wave 2: bỏ sót cảnh báo hỏng máy tốn
  // một cái máy; cảnh báo trùng chỉ tốn một dòng.
  if (lookupFailed) return { action: "insert", reason: "lookup-failed" };

  // Không có máy ⇒ không có khoá gộp. Không bịa khoá từ dữ liệu không có.
  if (incoming.machineId == null) return { action: "insert", reason: "no-machine" };

  if (!existing) return { action: "insert", reason: "no-open-alert" };

  return {
    action: "update",
    id: existing.id,
    severity: maxSeverity(existing.severity, incoming.severity),
    occurrenceCount: existing.occurrenceCount + 1,
  };
}
