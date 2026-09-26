import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Ô trống TỰ KHAI cho chỗ đáng lẽ có ảnh nhưng chưa có.
 * Cố ý KHÔNG vẽ gì giống ảnh thật. Trước đây chỗ này là `PcbThumbnail` — một tấm
 * PCB sinh bằng PRNG, cùng kích thước, cùng bo góc, nên "chưa có ảnh" và "đã có ảnh"
 * trông y hệt nhau.
 */
export function AnhChuaCo({ className, nhan }: { className?: string; nhan?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 text-muted-foreground shrink-0 overflow-hidden ${className ?? ""}`}
      data-testid="anh-chua-co"
    >
      <ImageOff className="h-4 w-4 opacity-60" aria-hidden />
      <span className="text-[10px] leading-none">{nhan ?? t("common.chuaCoAnh", "Chưa có ảnh")}</span>
    </div>
  );
}
