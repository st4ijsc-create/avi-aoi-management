/**
 * ⚠ 2026-08-17 — TRẠNG THÁI RỖNG TRUNG THỰC (một nguồn cho mọi bề mặt).
 *
 * Một màn hình toàn số 0 / 0 dòng của tài khoản **chưa được gán nhà máy** trông y hệt một dây
 * chuyền chưa chạy hay một bộ lọc không khớp. Trình bày nó thành "không có dữ liệu" dạy người
 * vận hành rằng **hệ thống hỏng**, trong khi sự thật là **phạm vi của họ rỗng** — và họ sẽ đi
 * chỉnh bộ lọc, đi tìm lỗi, đi báo hỏng ở đúng chỗ không có gì để tìm.
 *
 * Máy chủ khai lý do máy-đọc-được ở `scopeEmptyReason` (`server/_core/accessControlLabels.ts`);
 * component này chỉ việc đọc. Đặt câu chữ ở MỘT chỗ (khoá i18n `common.scopeEmpty.*`, có
 * vi/en/zh) để ba bề mặt không lặng lẽ lệch câu chữ rồi không ai phát hiện.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ 2026-08-17 lượt 2 — DẢI TRÊN ĐẦU KHÔNG ĐỦ, và đây là bằng chứng
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu thị giác thấy dải này hiện ĐÚNG ở đầu `/dashboard`, còn khối cảnh báo yield ngay
 * bên dưới vẫn nói *"Tạm chưa có dữ liệu kiểm"*. Một câu đúng đặt cạnh nhiều câu sai không
 * chữa được gì: mắt người đọc khối GẦN NHẤT với chỗ đang nhìn. Vì thế có thêm
 * `<ScopeAwareEmpty/>` — bọc TỪNG khối rỗng, đổi câu tại CHỖ nó được đọc.
 */
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT, isScopeEmpty } from "@/lib/scopeEmpty";

export { SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT, isScopeEmpty, scopeEmptyReasonOf } from "@/lib/scopeEmpty";

interface ScopeEmptyNoticeProps {
  /** Giá trị `scopeEmptyReason` lấy thẳng từ phản hồi máy chủ. */
  reason?: string | null;
  /**
   * `banner` = dải ngang trên đầu khối · `block` = khối trống giữa danh sách ·
   * `inline` = MỘT dòng, cho ô rỗng bé (thẻ theo ca, top/bottom máy) mà một khối 12 dòng
   * sẽ phá vỡ bố cục.
   */
  variant?: "banner" | "block" | "inline";
  className?: string;
}

/**
 * Trả `null` khi phạm vi bình thường — nên gọi vô điều kiện ở mọi bề mặt đọc dữ liệu, kể cả
 * lúc chưa biết người dùng có gán hay không.
 */
export function ScopeEmptyNotice({ reason, variant = "banner", className }: ScopeEmptyNoticeProps) {
  const { t } = useTranslation();

  if (!isScopeEmpty(reason)) return null;

  if (variant === "inline") {
    return (
      <p role="status" className={`py-2 text-center text-sm text-warning ${className ?? ""}`}>
        {t("common.scopeEmpty.badge")}
      </p>
    );
  }

  if (variant === "block") {
    return (
      <div role="status" className={`flex flex-col items-center justify-center py-12 text-center ${className ?? ""}`}>
        <AlertTriangle className="mb-3 h-12 w-12 text-warning" aria-hidden />
        <p className="font-medium">{t("common.scopeEmpty.title")}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("common.scopeEmpty.hint")}</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-lg border border-warning bg-warning/10 px-4 py-3 ${className ?? ""}`}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{t("common.scopeEmpty.title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("common.scopeEmpty.hint")}</p>
      </div>
    </div>
  );
}

interface ScopeAwareEmptyProps extends ScopeEmptyNoticeProps {
  /** Câu rỗng CŨ — vẫn là câu đúng khi phạm vi bình thường mà thật sự chưa có sản lượng. */
  children: ReactNode;
}

/**
 * ★ Cổng HAI CHIỀU cho một khối rỗng.
 *
 *  · `reason === "no_factory_assignment"` ⇒ nói ĐÚNG lý do (phạm vi rỗng).
 *  · mọi giá trị khác (kể cả `null`) ⇒ **giữ nguyên** `children`, tức câu "chưa có dữ liệu" cũ.
 *
 * ⚠ Chiều thứ hai quan trọng ngang chiều thứ nhất: một dây chuyền thật sự chưa chạy hôm nay
 * PHẢI tiếp tục được báo là chưa có dữ liệu. Đổi câu cho người CÓ gán nhà máy là nói dối theo
 * hướng ngược lại, và lưới `scopeEmpty.unit.test.ts` canh cả hai chiều.
 */
export function ScopeAwareEmpty({ reason, variant = "block", className, children }: ScopeAwareEmptyProps) {
  if (!isScopeEmpty(reason)) return <>{children}</>;
  return <ScopeEmptyNotice reason={reason} variant={variant} className={className} />;
}
