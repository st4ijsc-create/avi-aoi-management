/**
 * doc 67 W3 — model dùng chung cho Ops Console (trang + các component con).
 * Tách từ OpsConsole.tsx để AlertGroupCard/AgeLabel dùng chung mà không import
 * ngược trang. GIỮ nguyên ngữ nghĩa W1 (isResolveOnly/isAckOnly) — nhãn nút
 * phải nói đúng hành vi mutation server.
 */
import type { ReactNode } from "react";
import { Bell, Cpu, ShieldAlert, TrendingDown, Wifi } from "lucide-react";
import {
  TONE_DOT_CLASS,
  TONE_TILE_CLASS,
  severityDotClass,
  severityTileClass,
} from "@/components/patterns/isaStateBadges";

export type Severity = "critical" | "high" | "medium" | "low";
export type AlertSource = "andon" | "predictive" | "interlock" | "mqtt" | "threshold";

export interface NormalAlert {
  key: string;            // unique across sources: `${source}:${id}`
  source: AlertSource;
  id: number;
  title: string;
  message: string;
  severity: Severity;
  acknowledged: boolean;
  resolved: boolean;
  raisedAt: Date;
  group: string;          // line / station / machine label for grouping
  raisedBySystem?: boolean;
  // Wave 3 §4.5/§7 — chỉ nguồn "predictive" mang hai trường này (bảng
  // predictive_alerts). confidenceScore là decimal pg ⇒ tRPC trả CHUỖI.
  // occurrenceCount có thể VẮNG MẶT nếu migration 0308 chưa chạy — coi như 1.
  confidenceScore?: number | string | null;
  occurrenceCount?: number | null;
  // Vòng sửa cuối (review toàn nhánh, mục 2) — chỉ nguồn "predictive" mang trường
  // này (predictive_alerts.lastOccurredAt, đã tới client từ Task 7). Dùng để tính
  // "hết hạn dự báo" (xem isForecastExpired) — KHÔNG dùng raisedAt/createdAt, vì
  // từ Task 3 một dòng predictive được UPDATE tại chỗ mỗi lần tái diễn thay vì
  // insert dòng mới, nên createdAt có thể cũ hàng tuần trong khi máy vẫn đang tái
  // diễn mỗi ngày. Vắng mặt (nguồn khác, hoặc chưa từng tái diễn) ⇒ null.
  lastOccurredAt?: Date | null;
}

/**
 * doc 67 W3 (việc 3) — escalation thị giác, tính bằng coarse tick (30s):
 *  - overdue: critical CHƯA ack quá 10 phút → viền destructive + "QUÁ HẠN Xm"
 *    + đẩy lên đầu.
 *  - expired: predictive quá cửa sổ dự báo 5 ngày → "HẾT HẠN DỰ BÁO" + xếp
 *    cuối + mờ đi (KHÔNG xóa — trung thực: dự báo cũ vẫn là bản ghi thật).
 */
export interface DecoratedAlert extends NormalAlert {
  overdue: boolean;
  overdueMin: number;     // số phút quá hạn (đã trừ 10 phút cửa sổ)
  expired: boolean;
}

/**
 * doc 67 W3 (việc 1) — nhóm coalesce theo (source + title + vị trí). Bão 48
 * bản MQTT cùng rule → 1 thẻ "×48 lần". Andon KHÔNG bao giờ gộp (mỗi Andon là
 * 1 sự cố riêng) → nhóm Andon luôn count=1.
 */
export interface AlertGroup {
  gkey: string;
  source: AlertSource;
  title: string;
  location: string;
  severity: Severity;        // mức cao nhất trong nhóm
  items: DecoratedAlert[];   // mới nhất trước
  latest: DecoratedAlert;
  count: number;
  unackedCount: number;
  overdue: boolean;          // có ít nhất 1 bản ghi quá hạn
  overdueMin: number;        // max phút quá hạn trong nhóm
  expired: boolean;          // TOÀN BỘ bản ghi hết hạn dự báo mới coi nhóm là hết hạn
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * doc 67 W7 GĐ2 — severity map lấy từ nguồn chuẩn GĐ1 (isaStateBadges) thay bản
 * local đã trôi. Hai chỗ LỆCH CÓ CHỦ Ý so với severityTone() shared:
 *  - `high` GIỮ warning (shared gộp high→danger): console này phân biệt
 *    critical≠high ở MỌI mặt (KPI text-destructive vs text-warning, TV header
 *    ▲đỏ/●vàng, AUD-08) — để high đỏ như critical là mất một bậc escalation.
 *  - `medium` mất bậc sáng /70 cũ (chấp nhận: cùng họ warning, còn kênh chữ).
 *  - `low`: theo spec ĐÃ DUYỆT → muted (bỏ info-xanh cũ — blue local không mang
 *    ngữ nghĩa riêng; low gồm cả Andon green thường nhật, xám trung tính đúng
 *    mức "ít quan trọng nhất").
 */
export const SEVERITY_TILE: Record<Severity, string> = {
  critical: severityTileClass("critical"),
  high: TONE_TILE_CLASS.warning, // giữ-local: critical≠high (xem chú thích trên)
  medium: severityTileClass("medium"),
  low: severityTileClass("low"),
};

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: severityDotClass("critical"),
  high: TONE_DOT_CLASS.warning, // giữ-local: critical≠high
  medium: severityDotClass("medium"),
  low: severityDotClass("low"),
};

/**
 * TV-mode (fullscreen, nhìn từ 3-5m) — GIỮ nền ĐẶC local theo quyết định đã
 * duyệt (b): soft-tint 10-15% không đọc được từ xa trên TV treo xưởng. CHỈ TV
 * dùng map này; thẻ thường dùng SEVERITY_TILE soft-tint ở trên.
 */
export const SEVERITY_TILE_SOLID: Record<Severity, string> = {
  critical: "bg-destructive text-white border-destructive",
  high: "bg-warning text-white border-warning",
  medium: "bg-warning/70 text-black border-warning",
  low: "bg-info text-white border-info",
};

export const SOURCE_ICON: Record<AlertSource, ReactNode> = {
  andon: <Bell className="h-4 w-4" />,
  predictive: <TrendingDown className="h-4 w-4" />,
  interlock: <ShieldAlert className="h-4 w-4" />,
  mqtt: <Wifi className="h-4 w-4" />,
  threshold: <Cpu className="h-4 w-4" />,
};

/**
 * Khả năng hành động theo nguồn — nhãn nút phải nói đúng hành vi mutation (W1):
 *  - interlock/mqtt: server CHỈ có resolve (đóng vĩnh viễn), không có ack riêng
 *    → một nút "Xử lý xong" duy nhất, bọc xác nhận.
 *  - predictive/threshold: console này CHỈ nối mutation acknowledge
 *    (/predictive-alerts redirect về /ops-console — không còn trang riêng)
 *    → một nút "Xác nhận" duy nhất, không hiện nút resolve giả.
 *  - andon: có đủ cả ack lẫn resolve.
 */
export const isResolveOnly = (s: AlertSource) => s === "interlock" || s === "mqtt";
export const isAckOnly = (s: AlertSource) => s === "predictive" || s === "threshold";

/** Escalation (việc 3). Critical-quá-hạn nổi trên critical thường; hết hạn dự báo chìm đáy. */
export const OVERDUE_AFTER_MS = 10 * 60_000;
export const FORECAST_EXPIRE_MS = 5 * 24 * 60 * 60_000;

/**
 * Vòng sửa cuối (review toàn nhánh, mục 2) — "hết hạn dự báo" phải đo theo LẦN TÁI
 * DIỄN GẦN NHẤT (lastOccurredAt), không phải tuổi dòng (raisedAt = createdAt).
 * Trước sửa này, công thức cũ `age(raisedAt) > FORECAST_EXPIRE_MS` coi tuổi dòng
 * là "độ tươi" — đúng khi mỗi lần tái diễn từng là một dòng MỚI (trước Wave 3). Từ
 * Task 3, routeAlert() UPDATE tại chỗ một dòng đang mở thay vì insert, nên một máy
 * tái diễn liên tục 6 ngày vẫn giữ NGUYÊN createdAt của lần đầu — công thức cũ sẽ
 * dán nhãn "HẾT HẠN DỰ BÁO" (mờ + chìm đáy) lên đúng cảnh báo đang sống động nhất,
 * ngay cả khi Task 7 vừa hiện "đã tái diễn 23 lần" cạnh nó.
 * `lastOccurredAt` vắng mặt (nguồn khác "predictive", hoặc dòng chưa từng tái diễn
 * lần nào sau khi cột này tồn tại) ⇒ lùi về raisedAt như hành vi cũ — không làm vỡ
 * dòng cũ.
 */
export function isForecastExpired(
  a: { source: AlertSource; raisedAt: Date; lastOccurredAt?: Date | null },
  now: number,
): boolean {
  if (a.source !== "predictive") return false;
  const anchor = a.lastOccurredAt ?? a.raisedAt;
  return now - anchor.getTime() > FORECAST_EXPIRE_MS;
}

/**
 * Task 6 (Wave 4) — "cảnh báo vừa đóng" (predictive status=EXPIRED). Đây KHÔNG
 * phải NormalAlert: nó không đi qua `alerts`/`decorated`/`groups` (War Room +
 * KPI đếm) — trộn vào đó sẽ khiến một dòng đã đóng bị tính là đang mở (đúng lỗi
 * bài học nêu trong brief: "không trộn lẫn khiến người ta tưởng còn đang mở").
 * Đây là một danh sách phụ, chỉ hiện ở Alert Center khi bật công tắc, với hàng
 * được đánh dấu "đã đóng" tách bạch.
 */
export interface ClosedAlertRow {
  key: string;
  id: number;
  title: string;
  message: string;
  severity: Severity;
  group: string;
  raisedAt: Date;   // predictive_alerts.createdAt — khi cảnh báo lần đầu xuất hiện
  closedAt: Date;   // predictive_alerts.updatedAt — khi bị đóng (EXPIRED không có resolvedAt)
  resolutionNotes: string | null;
}

/**
 * Task 6 (Wave 4) — `resolutionNotes` có thể null/rỗng/toàn khoảng-trắng (dòng
 * đóng bằng đường khác, không qua alertExpirySweeper). Trả về chuỗi ĐÃ TRIM khi
 * có nội dung thật, ngược lại `null` — nơi gọi dùng giá trị này để QUYẾT ĐỊNH có
 * render dòng "Lý do: …" hay không. Tuyệt đối không được render khi giá trị này
 * là null (sẽ in ra "Lý do: undefined"/"Lý do: null"/"Lý do: " rỗng).
 */
export function closedReasonText(resolutionNotes: string | null | undefined): string | null {
  const trimmed = (resolutionNotes ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function escalationRank(a: { severity: Severity; overdue: boolean; expired: boolean }): number {
  if (a.expired) return 100;               // hết hạn dự báo → đáy
  if (a.overdue) return -1;                // critical quá hạn ack → đỉnh
  return SEVERITY_RANK[a.severity];
}

/**
 * Sort escalation: rank tăng dần; trong cùng rank: chưa-ack trước đã-ack,
 * chưa-ack CŨ NHẤT trước (chờ lâu nhất cần mắt người nhất), đã-ack mới nhất trước.
 */
export function compareEscalation(
  a: { severity: Severity; overdue: boolean; expired: boolean; acknowledged: boolean; raisedAt: Date },
  b: { severity: Severity; overdue: boolean; expired: boolean; acknowledged: boolean; raisedAt: Date },
): number {
  const r = escalationRank(a) - escalationRank(b);
  if (r !== 0) return r;
  if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
  return a.acknowledged
    ? b.raisedAt.getTime() - a.raisedAt.getTime()   // đã-ack: mới nhất trước
    : a.raisedAt.getTime() - b.raisedAt.getTime();  // chưa-ack: cũ nhất trước
}
