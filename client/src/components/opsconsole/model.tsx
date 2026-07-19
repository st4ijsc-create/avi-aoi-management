/**
 * doc 67 W3 — model dùng chung cho Ops Console (trang + các component con).
 * Tách từ OpsConsole.tsx để AlertGroupCard/AgeLabel dùng chung mà không import
 * ngược trang. GIỮ nguyên ngữ nghĩa W1 (isResolveOnly/isAckOnly) — nhãn nút
 * phải nói đúng hành vi mutation server.
 */
import type { ReactNode } from "react";
import { Bell, Cpu, ShieldAlert, TrendingDown, Wifi } from "lucide-react";

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

export const SEVERITY_TILE: Record<Severity, string> = {
  critical: "bg-destructive text-white border-destructive",
  high: "bg-warning text-white border-warning",
  medium: "bg-warning/70 text-black border-warning",
  low: "bg-info text-white border-info",
};

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-warning/70",
  low: "bg-info",
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
