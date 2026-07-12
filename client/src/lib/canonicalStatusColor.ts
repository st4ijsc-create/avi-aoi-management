/**
 * doc 44 W6-1 (G5.12) — NGUỒN DUY NHẤT ánh xạ trạng thái canonical → mã màu.
 *
 * SYNAPSE LDS-L5 §5.1: "Mã màu trạng thái thống nhất: dùng đúng enum canonical
 * (LDS-L1 Ch.8.7): EXECUTE/IDLE/HELD/FAULTED… ánh xạ màu CỐ ĐỊNH toàn hệ."
 *
 * ISA-101 (high-performance HMI): nền TRUNG TÍNH, màu CHỈ dành cho BẤT THƯỜNG.
 * Vì vậy:
 *   • IDLE / OFFLINE / mất-kết-nối / UNKNOWN  → neutral (xám muted, KHÔNG đỏ) —
 *     mất tín hiệu là "không dữ liệu", không phải sự cố quá trình.
 *   • EXECUTE / RUNNING / PRODUCING           → success (đang chạy tốt).
 *   • READY / COMPLETING / recovering         → info (tiến trình, không cần chú ý gấp).
 *   • HELD / SUSPENDED / CHANGEOVER / STOPPED → warning (cần chú ý, không nguy cấp).
 *   • FAULTED / ABORTED / DOWN / ERROR / NG   → danger (bất thường thực sự → đỏ).
 *
 * MÀU = token oklch trong index.css (success/info/warning/destructive/muted) qua
 * lớp Tailwind — KHÔNG hex. Tích hợp <StatusBadge> qua canonicalBadgeTone().
 * (Ngoại lệ WebGL/canvas không parse được oklch: xem canonicalToneCssVar() để đọc
 * biến CSS lúc chạy — vẫn 1 nguồn, không hardcode hex trong file này.)
 */

import type { Tone } from "@/components/patterns/tokens";

/** Tông ngữ nghĩa nội bộ (ISA-101). */
export type SemanticTone = "neutral" | "success" | "info" | "warning" | "danger";

/** Enum canonical (PackML op-state + vòng đời máy/tuyến). */
export type CanonicalStatus =
  // PackML / operation
  | "IDLE"
  | "STARTING"
  | "EXECUTE"
  | "COMPLETING"
  | "COMPLETE"
  | "HOLDING"
  | "HELD"
  | "UNHOLDING"
  | "SUSPENDING"
  | "SUSPENDED"
  | "UNSUSPENDING"
  | "RESETTING"
  | "STOPPING"
  | "STOPPED"
  | "ABORTING"
  | "ABORTED"
  | "CLEARING"
  // Vòng đời máy / tuyến / kết quả
  | "RUNNING"
  | "READY"
  | "PRODUCING"
  | "CHANGEOVER"
  | "MAINTENANCE"
  | "FAULTED"
  | "FAULT"
  | "DOWN"
  | "OFFLINE"
  | "UNKNOWN";

/** Canonical status → tông ngữ nghĩa (bảng CỐ ĐỊNH toàn hệ). */
const STATUS_TONE: Record<CanonicalStatus, SemanticTone> = {
  // running-well → success
  EXECUTE: "success",
  RUNNING: "success",
  PRODUCING: "success",
  STARTING: "success",
  // tiến trình / phục hồi → info
  READY: "info",
  COMPLETING: "info",
  COMPLETE: "info",
  UNHOLDING: "info",
  UNSUSPENDING: "info",
  RESETTING: "info",
  CLEARING: "info",
  MAINTENANCE: "info",
  // cần chú ý (không nguy cấp) → warning
  HELD: "warning",
  HOLDING: "warning",
  SUSPENDED: "warning",
  SUSPENDING: "warning",
  CHANGEOVER: "warning",
  STOPPING: "warning",
  STOPPED: "warning",
  // bất thường thực sự → danger
  FAULTED: "danger",
  FAULT: "danger",
  ABORTED: "danger",
  ABORTING: "danger",
  DOWN: "danger",
  // không dữ liệu → neutral (ISA-101: mất comms KHÔNG phải sự cố quá trình)
  IDLE: "neutral",
  OFFLINE: "neutral",
  UNKNOWN: "neutral",
};

/**
 * Alias các nhãn thô hay gặp (từ UNS/machine_status/kết quả) → canonical.
 * Khóa đã UPPER + gạch-dưới-hóa; đọc qua canonicalizeStatus().
 */
const ALIASES: Record<string, CanonicalStatus> = {
  ON: "RUNNING",
  ACTIVE: "RUNNING",
  ONLINE: "RUNNING",
  OK: "RUNNING",
  PASS: "RUNNING",
  PASSED: "RUNNING",
  RUN: "RUNNING",
  BUSY: "EXECUTE",
  WORKING: "EXECUTE",
  STANDBY: "READY",
  WAIT: "IDLE",
  WAITING: "IDLE",
  PAUSE: "HELD",
  PAUSED: "HELD",
  HOLD: "HELD",
  SUSPEND: "SUSPENDED",
  STOP: "STOPPED",
  OFF: "OFFLINE",
  DISCONNECTED: "OFFLINE",
  LOST_CONNECTION: "OFFLINE",
  NO_DATA: "UNKNOWN",
  UNAVAILABLE: "UNKNOWN",
  ERROR: "FAULT",
  FAILED: "FAULT",
  FAIL: "FAULT",
  NG: "FAULT",
  ALARM: "FAULT",
  CRITICAL: "FAULT",
  DEGRADED: "STOPPED",
  IDLING: "IDLE",
  SETUP: "CHANGEOVER",
  CHANGE_OVER: "CHANGEOVER",
  REPAIR: "MAINTENANCE",
  SERVICE: "MAINTENANCE",
  PM: "MAINTENANCE",
};

const CANONICAL_SET = new Set<string>(Object.keys(STATUS_TONE));

/** Chuẩn hóa một nhãn trạng thái BẤT KỲ về canonical (fail-safe → UNKNOWN, không bịa). */
export function canonicalizeStatus(raw: unknown): CanonicalStatus {
  const key = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-]+/g, "_");
  if (key === "") return "UNKNOWN";
  if (CANONICAL_SET.has(key)) return key as CanonicalStatus;
  if (key in ALIASES) return ALIASES[key];
  // substring cứu hộ (ví dụ "MACHINE_FAULTED", "LINE_PRODUCING").
  for (const c of CANONICAL_SET) if (key.includes(c)) return c as CanonicalStatus;
  for (const [a, c] of Object.entries(ALIASES)) if (key.includes(a)) return c;
  return "UNKNOWN";
}

/** Canonical/thô → tông ngữ nghĩa. */
export function statusTone(raw: unknown): SemanticTone {
  return STATUS_TONE[canonicalizeStatus(raw)];
}

/** SemanticTone → StatusBadge Tone (patterns/tokens). */
const TONE_TO_BADGE: Record<SemanticTone, Exclude<Tone, "accent">> = {
  neutral: "default",
  success: "success",
  info: "info",
  warning: "warning",
  danger: "error",
};

/** Canonical/thô → tông <StatusBadge> (dùng làm nguồn cho inferTone). */
export function canonicalBadgeTone(raw: unknown): Exclude<Tone, "accent"> {
  return TONE_TO_BADGE[statusTone(raw)];
}

// ── Lớp Tailwind theo token (theme-aware, KHÔNG hex) ─────────────────────────

const DOT_CLASS: Record<SemanticTone, string> = {
  neutral: "bg-muted-foreground/50",
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-destructive",
};

const TEXT_CLASS: Record<SemanticTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-destructive",
};

const BADGE_CLASS: Record<SemanticTone, string> = {
  neutral: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  success: "border-success/30 bg-success/15 text-success",
  info: "border-info/30 bg-info/15 text-info",
  warning: "border-warning/30 bg-warning/15 text-warning",
  danger: "border-destructive/30 bg-destructive/15 text-destructive",
};

const RING_CLASS: Record<SemanticTone, string> = {
  neutral: "ring-muted-foreground/30",
  success: "ring-success/50",
  info: "ring-info/50",
  warning: "ring-warning/50",
  danger: "ring-destructive/50",
};

/** Chấm trạng thái (bg token). */
export function canonicalDotClass(raw: unknown): string {
  return DOT_CLASS[statusTone(raw)];
}
/** Chữ màu trạng thái (text token). */
export function canonicalTextClass(raw: unknown): string {
  return TEXT_CLASS[statusTone(raw)];
}
/** Badge tint (border+bg+text token). */
export function canonicalBadgeClass(raw: unknown): string {
  return BADGE_CLASS[statusTone(raw)];
}
/** Ring nhấn (khi highlight ô/card). */
export function canonicalRingClass(raw: unknown): string {
  return RING_CLASS[statusTone(raw)];
}

/**
 * Tên biến CSS token cho một tông — dùng cho ngữ cảnh KHÔNG dùng được lớp Tailwind
 * (WebGL/canvas). Đọc lúc chạy: getComputedStyle(el).getPropertyValue(canonicalToneCssVar(t)).
 * Giữ 1 nguồn (biến oklch trong index.css) thay vì rải hex.
 */
export function canonicalToneCssVar(raw: unknown): string {
  const tone = statusTone(raw);
  switch (tone) {
    case "success": return "--success";
    case "info": return "--info";
    case "warning": return "--warning";
    case "danger": return "--destructive";
    case "neutral":
    default: return "--muted-foreground";
  }
}

/** Danh sách canonical (cho showcase/test). */
export const CANONICAL_STATUSES = Object.keys(STATUS_TONE) as CanonicalStatus[];
