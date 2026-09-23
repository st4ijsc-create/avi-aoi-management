/**
 * ★ F4 phần 2 (2026-09-23) — khối "Vì sao model đề xuất" đặt NGAY TRÊN thẻ duyệt diff.
 * Chỉ đọc; gấp mặc định (diff mới là thứ phải đọc trước). Logic: `lyDoDuyetLogic.ts`.
 */
import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react";
import type { LyDoDuyet as LyDo } from "./lyDoDuyetLogic";

export function LyDoDuyet({ lyDo }: { lyDo: LyDo }) {
  const { t } = useTranslation();
  return (
    <details className="mb-2 rounded-md border border-border bg-muted/30 text-xs" data-testid="ly-do-duyet">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2 py-1.5 font-medium">
        <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>{t("repoWs.nghi.lyDoDuyet", "Vì sao model đề xuất thay đổi này")}</span>
        <span className="tabular-nums text-muted-foreground">· {t("repoWs.nghi.soKyTu", "{{n}} ký tự", { n: lyDo.soKyTu })}</span>
      </summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-1.5 font-sans text-muted-foreground">
        {lyDo.duoi}
      </pre>
      <p className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
        {t("repoWs.nghi.lyDoGhiChu", "Trích suy luận của model ở lượt này — chỉ để tham khảo; bạn vẫn là người duyệt.")}
      </p>
    </details>
  );
}
