/**
 * DaiSucKhoe.tsx — dải "Sức khoẻ dữ liệu" trên cùng màn Thiết kế (§7.1).
 *
 * Spec §7.1 nói rõ vì sao nó nằm ở chỗ dễ thấy nhất chứ không giấu trong
 * tooltip: nó là *"hiện thực hoá NT-3 và NT-4 ngay ở chỗ dễ thấy nhất"*.
 *
 * ★★★ NT-3.5 — "ĐẾM RỖNG KHÁC ĐẾM BẰNG 0".
 *   `chuaTai` ⇒ hiện `—`, KHÔNG hiện `0`. Gộp hai ca đó lại thì "đang tải" trông
 *   y hệt "đã đo xong, không có máy nào", và người dùng tin vào một sự thật
 *   không ai đo. Khuôn này tái dùng `WipLineBalance.tsx:110-127` của repo.
 *
 * ★★★ Ô `datChoMoCoi` — chỗ dữ liệu LỆCH tự kêu.
 *   Đo được trên DB dev 2026-09-06: 1 hàng `twin_dat_cho` (id 776) giữ vị trí
 *   cho `machines.id=250` đang `isActive=false`. Không có ô này thì con số "đã
 *   xếp chỗ" phải chọn giữa 41 (đúng) và 42 (khớp số hàng trong bảng), và cả hai
 *   lựa chọn đều giấu đi sự thật rằng hai con số không khớp nhau. NT-3 cấm làm
 *   tròn một chỗ lệch thành "bình thường".
 */

import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SucKhoeDuLieu } from "./trangThaiThietKe";

/** Hiện số, hoặc `—` khi chưa có gì để đếm (NT-3.5). */
function so(n: number, chuaTai: boolean): string {
  return chuaTai ? "—" : String(n);
}

export function DaiSucKhoe({ sucKhoe }: { sucKhoe: SucKhoeDuLieu }) {
  const { t } = useTranslation();
  const ct = sucKhoe.chuaTai;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-1 text-[11px]"
      data-testid="dai-suc-khoe"
    >
      <span className="font-medium text-muted-foreground">{t("twin3d.sucKhoe.tieuDe")}:</span>

      <span data-testid="sk-da-xep-cho">
        {t("twin3d.sucKhoe.daXepCho", { n: so(sucKhoe.daXepCho, ct) })}
      </span>
      <span className="text-muted-foreground">·</span>

      <span
        data-testid="sk-cho-xep-cho"
        className={!ct && sucKhoe.choXepCho > 0 ? "text-amber-700 dark:text-amber-400" : undefined}
      >
        {t("twin3d.sucKhoe.choXepCho", { n: so(sucKhoe.choXepCho, ct) })}
      </span>
      <span className="text-muted-foreground">·</span>

      {/* ★ NT-4 — số kích thước còn là GIẢ ĐỊNH. */}
      <span
        data-testid="sk-chua-do"
        className={
          !ct && sucKhoe.chuaDoKichThuoc > 0 ? "text-amber-700 dark:text-amber-400" : undefined
        }
      >
        {t("twin3d.sucKhoe.chuaDoKichThuoc", { n: so(sucKhoe.chuaDoKichThuoc, ct) })}
      </span>

      {/* ★★★ Chỗ lệch TỰ KÊU — chỉ hiện khi thật sự có. */}
      {!ct && sucKhoe.datChoMoCoi > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="gap-1 border-destructive/60 text-[10px] text-destructive"
              data-testid="sk-mo-coi"
            >
              <AlertTriangle className="h-3 w-3" />
              {t("twin3d.sucKhoe.moCoi", { n: sucKhoe.datChoMoCoi })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-72 text-xs">
            {t("twin3d.sucKhoe.moCoiGiaiThich")}
          </TooltipContent>
        </Tooltip>
      ) : null}

      {ct ? (
        <span className="text-muted-foreground" data-testid="sk-chua-tai">
          {t("twin3d.sucKhoe.chuaTai")}
        </span>
      ) : null}
    </div>
  );
}

export default DaiSucKhoe;
