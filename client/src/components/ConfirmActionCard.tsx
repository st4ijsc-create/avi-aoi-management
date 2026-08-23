/**
 * ConfirmActionCard — shared HITL write-action confirm card.
 *
 * P3/W3.1 (doc 11) — extracted VERBATIM from AILocalChatBubble so the bubble AND
 * the full-page /ai-chat can render the SAME inline confirm/cancel card for a
 * proposed WRITE (SSE `pending_action`). Pure presentation + Confirm/Cancel
 * buttons; the parent owns the mutation. i18n flows in via the passed-in `t`.
 *
 * Shared by:
 *   - the inline chat pending_action (bubble + /ai-chat)
 *   - the agentic write step (bubble's AgentPlanCard confirmCard)
 */

import { useState, useEffect } from "react";
import { AlertCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
/**
 * ★★★ 2026-08-23 · UX LÔ 1 (A2/B3) — dấu máy-đọc-được server đặt trong `preview.warnings`:
 *   • `[CMD_*] …` (`timMaChan`)       — lời chặn-CHẮC-CHẮN: `execute` chạy LẠI đúng phán quyết đã
 *     chặn ở preview, nên cú bấm Xác nhận KHÔNG THỂ thành công ⇒ khoá nút + nói "gõ lại".
 *   • `[DANH_SACH_LENH]` (`docDanhSachLenh`) — bảng 9 lệnh đầy đủ, GẤP sau nút "Xem cả danh sách"
 *     (trước đây nó là bức tường ~2.300 ký tự đập vào mặt người dùng mỗi lượt gõ sai).
 * MỘT nguồn ở `shared/` — server ghi dấu, client đọc dấu bằng đúng cặp hàm này; xem docblock ở đó.
 * ⚠ Cảnh báo THÔNG TIN (tệp sạch/ghi đè/hạn giờ…) KHÔNG mang dấu ⇒ `timMaChan` trả `null` ⇒ nút
 *   giữ nguyên — khoá nhầm vì một cảnh báo bình thường là đổi lỗi UX này lấy lỗi UX khác.
 */
import { docDanhSachLenh, timMaChan } from "@shared/aiCodingTuChoi";

// ─── Shared types ──────────────────────────────────────────────────────────────
// GĐ2 — pending write-action proposed by the AI Copilot (HITL confirm).
export interface PendingActionChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  displayName?: string;
}
export interface PendingAction {
  actionId: string;
  token: string;
  tool: string;
  summary: string;
  preview: {
    entityType: string;
    entityId?: number;
    entityName?: string;
    changes: PendingActionChange[];
    warnings: string[];
    humanSummary: string;
  };
  expiresAt: string;
}

/** Confirm-card UI state for the current pending write. */
export type ActionState = "pending" | "executed" | "cancelled" | "denied" | "expired";

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Render a primitive value for the before/after cells (handles null/undefined).
export function formatActionValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return String(v);
}

// Live TTL countdown — recomputes "mm:ss" remaining until expiresAt every second.
export function useTtlCountdown(expiresAt: string, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, expiresAt]);
  const msLeft = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSec = Math.floor(msLeft / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return {
    expired: msLeft <= 0,
    label: `${mm}:${ss.toString().padStart(2, "0")}`,
    urgent: msLeft > 0 && msLeft <= 60_000, // < 1 min remaining
  };
}

// ─── Reusable HITL write confirm card ─────────────────────────────────────────
// Shared by the inline chat pending_action AND the agentic write step. Pure
// presentation + Confirm/Cancel buttons; the parent owns the mutation.
export function ConfirmActionCard({
  action,
  state,
  message,
  busy,
  onConfirm,
  onCancel,
  t,
}: {
  action: PendingAction;
  // Accept undefined too (the bubble's ChatMessage.actionState is optional) — the
  // card simply renders the non-pending result row in that case. Matches the
  // original in-bubble prop signature exactly.
  state: ActionState | undefined;
  message?: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: string, fallback: string) => string;
}) {
  const ttl = useTtlCountdown(action.expiresAt, state === "pending");
  // Prefer the richer human-readable summary when present.
  const summaryLine = action.preview.humanSummary || action.summary;
  // (A2) mã chặn-chắc-chắn từ preview — `null` với mọi thẻ bình thường (đường ghi/diff không đổi).
  const maChan = timMaChan(action.preview.warnings);
  // (B3) tách cảnh báo thường khỏi bảng-danh-sách-lệnh (nếu server đính kèm).
  const canhBaoThuong = action.preview.warnings.filter((w) => docDanhSachLenh(w) === null);
  const danhSachLenh = action.preview.warnings.map(docDanhSachLenh).find((d) => d !== null) ?? null;

  return (
    <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2.5 text-[13px]">
      {/* Header + live TTL countdown */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 text-[13px]">
          <AlertCircle className="size-4 shrink-0" />
          {t("copilot.confirmTitle", "Xác nhận thao tác ghi")}
        </div>
        {state === "pending" && (
          <span
            className={cn(
              "flex items-center gap-1 shrink-0 rounded-full border px-2 py-0.5 text-[12px] font-mono font-semibold tabular-nums",
              ttl.urgent
                ? "border-red-300 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
            )}
            title={t("copilot.expiresLabel", "Thời gian còn lại")}
          >
            <Clock className="size-3.5" />
            {ttl.expired ? "0:00" : ttl.label}
          </span>
        )}
      </div>

      {/* Bold large plain-language summary line first */}
      <p className="text-[14px] font-bold leading-snug text-foreground">{summaryLine}</p>

      {/* Color-coded before → after (old gray, new green) */}
      {action.preview.changes.length > 0 && (
        <div className="space-y-1.5">
          {action.preview.changes.map((c, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-1.5 rounded-md bg-background/70 border border-border/50 px-2 py-1.5 text-[13px]"
            >
              <span className="font-medium text-foreground">{c.displayName ?? c.field}:</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground line-through decoration-muted-foreground/50">
                {formatActionValue(c.oldValue)}
              </span>
              <span className="text-muted-foreground" aria-hidden>
                {t("copilot.arrow", "→")}
              </span>
              <span className="rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-800 dark:bg-green-950/50 dark:text-green-300">
                {formatActionValue(c.newValue)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings with icon + plain language */}
      {action.preview.warnings.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/50 dark:bg-red-950/30">
          <div className="mb-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-red-700 dark:text-red-400">
            <AlertCircle className="size-3.5 shrink-0" />
            {t("copilot.warningsTitle", "Lưu ý quan trọng")}
          </div>
          <ul className="space-y-0.5 text-[13px] text-red-700 dark:text-red-300">
            {canhBaoThuong.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span aria-hidden className="mt-px shrink-0">⚠️</span>
                <span className="leading-snug whitespace-pre-wrap break-words">{w}</span>
              </li>
            ))}
          </ul>
          {/* ★ (B3) bảng đầy đủ GẤP LẠI — `<details>` thuần HTML, không thêm state/JS nào. */}
          {danhSachLenh && (
            <details data-danh-sach-lenh className="mt-1 text-[12px] text-red-700 dark:text-red-300">
              <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">
                {t("copilot.showAllCmds", "Xem cả danh sách lệnh được phép")} ({danhSachLenh.length})
              </summary>
              <ul className="mt-1 space-y-0.5 pl-1">
                {danhSachLenh.map((d, i) => (
                  <li key={i} className="leading-snug">{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Larger Confirm / Cancel buttons (min 44px height) */}
      {state === "pending" ? (
        <div className="flex items-center gap-2 pt-0.5">
          {/* ★ (A2) `maChan` ⇒ KHOÁ nút: thẻ này tự khai lệnh sẽ bị chặn — chìa nút Xác nhận cho nó
              là mời một cú bấm không bao giờ thành công. Nhãn đổi thành việc-phải-làm ("gõ lại"). */}
          <Button
            className="h-11 min-h-[44px] flex-1 text-[14px] font-semibold"
            disabled={busy || ttl.expired || maChan !== null}
            data-ma-chan={maChan ?? undefined}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
            {maChan !== null
              ? t("copilot.blockedRetype", "Lệnh không hợp lệ — gõ lại")
              : t("copilot.confirm", "Xác nhận")}
          </Button>
          <Button
            variant="outline"
            className="h-11 min-h-[44px] flex-1 text-[14px]"
            disabled={busy}
            onClick={onCancel}
          >
            {t("copilot.cancel", "Hủy")}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "text-[13px] font-medium",
            state === "executed" ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
          )}
        >
          {state === "executed" && t("copilot.executed", "Đã thực thi.")}
          {state === "cancelled" && t("copilot.cancelled", "Đã hủy.")}
          {state === "denied" && (message ?? t("copilot.denied", "Không có quyền."))}
          {state === "expired" && t("copilot.expired", "Đã hết hạn.")}
        </div>
      )}
    </div>
  );
}
