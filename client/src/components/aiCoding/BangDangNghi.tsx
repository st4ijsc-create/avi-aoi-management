/**
 * ★ F1 (2026-09-22) — **BẢNG "MODEL ĐANG NGHĨ"** cho `/ai-coding-workspace`.
 *
 * Nguồn: sự kiện SSE `reasoning` (mảnh `reasoning_content` của llama-server, đã qua bộ che bí mật riêng ở
 * `streamCodingModel`). Hiện ĐUÔI chuỗi nghĩ + tổng ký tự; mở khi chưa có mã, tự gấp khi mã bắt đầu, người dùng
 * bấm thì ý họ thắng. Không nối vào câu trả lời, không lưu phiên — suy luận là hiện vật của LƯỢT, không của TÀI LIỆU.
 * Logic thuần ở `bangDangNghiLogic.ts` (có lưới).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { nenMoBang, tomTatNghi } from "./bangDangNghiLogic";

export function BangDangNghi({
  vanBan,
  dangStream,
  daCoChu,
  tokensNghi,
}: {
  /** Suy luận tích luỹ của lượt đang stream. Rỗng ⇒ không vẽ gì. */
  vanBan: string;
  dangStream: boolean;
  /** Đã có ký tự mã/câu trả lời chảy ra chưa (⇒ gấp bảng theo mặc định). */
  daCoChu: boolean;
  /** ★ F4 — số token nghĩ từ sự kiện `usage` (B7), hiện sau lượt; vắng ⇒ chỉ hiện ký tự (không bịa token). */
  tokensNghi?: number;
}) {
  const { t } = useTranslation();
  const [nguoiChon, datNguoiChon] = useState<boolean | null>(null);
  if (!vanBan) return null;
  const tt = tomTatNghi(vanBan);
  const mo = nenMoBang({ daCoChu, nguoiChon });
  const Icon = mo ? ChevronDown : ChevronRight;
  return (
    <div data-testid="bang-dang-nghi" className="rounded-md border border-dashed border-primary/30 bg-primary/5 text-[12px]">
      <button
        type="button"
        onClick={() => datNguoiChon(!mo)}
        aria-expanded={mo}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-primary/10"
      >
        <Brain className={`h-3.5 w-3.5 shrink-0 text-primary ${dangStream && !daCoChu ? "animate-pulse" : ""}`} aria-hidden />
        <span className="font-medium">
          {dangStream && !daCoChu ? t("repoWs.nghi.dang", "Model đang nghĩ…") : t("repoWs.nghi.daNghi", "Model đã nghĩ")}
        </span>
        <span className="tabular-nums text-muted-foreground">{t("repoWs.nghi.soKyTu", "{{n}} ký tự", { n: tt.soKyTu })}</span>
        {typeof tokensNghi === "number" && Number.isFinite(tokensNghi) && (
          <span className="tabular-nums text-muted-foreground">· {t("repoWs.nghi.token", "{{n}} token", { n: tokensNghi })}</span>
        )}
        <Icon className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {mo && (
        <pre
          data-testid="bang-dang-nghi-duoi"
          className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-2 pb-2 font-sans text-[11px] leading-snug text-muted-foreground"
        >
          {tt.duoi}
        </pre>
      )}
    </div>
  );
}
