/**
 * HopThoaiChuaLuu.tsx — ★★★ H1: cửa chặn lượt ĐỔI TẦNG khi còn thay đổi chưa lưu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỒN TẠI — MỘT KHUYẾT TẬT MẤT DỮ LIỆU ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * Đo sống vòng 2 trong `/twin-studio`: bật Lock trên một khối ⇒ *"1 unsaved
 * changes"*. **Đổi tầng ⇒ đếm về 0, không hộp thoại, không toast, quay lại tầng
 * cũ không khôi phục.** `<XuongThietKe key={tangId}>` remount ⇒ buffer bị vứt.
 *
 * §7.3 đã có `beforeunload` cho lượt RỜI TRANG; lượt đổi tầng TRONG trang thì
 * trình duyệt không biết gì, nên phải tự hỏi. Đây chính là cái hỏi đó.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA LỰA CHỌN, KHÔNG PHẢI HAI
 * ════════════════════════════════════════════════════════════════════════════
 * Lưu · Bỏ · **Huỷ**. Bỏ nút Huỷ (kiểu `confirm()` hai nút) biến một cú lỡ tay
 * trên ô chọn thành một quyết định bắt buộc về dữ liệu — người dùng chỉ muốn
 * quay lại chỗ cũ thì không còn đường nào.
 *
 * ★ KHÔNG dùng `AlertDialogAction`/`AlertDialogCancel` của Radix: hai primitive
 *   ấy TỰ ĐÓNG hộp thoại khi bấm. Lượt "Lưu rồi đổi" là bất đồng bộ và có thể
 *   THẤT BẠI — đóng trước khi biết kết quả là lại mất dữ liệu trong im lặng,
 *   đúng thứ đang chữa. `open` do người gọi giữ, và chỉ họ mới đóng.
 *
 * ★ Component THUẦN TRÌNH BÀY: 0 `trpc`, 0 state. Quyết định "đổi hay không"
 *   nằm ở `TwinStudio` — nơi duy nhất biết cả ý muốn lẫn số thay đổi.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface HopThoaiChuaLuuProps {
  mo: boolean;
  /** Số thay đổi SẼ MẤT nếu đổi — con số thật từ `gomThayDoi`, không phải một cờ. */
  soThayDoi: number;
  /** Đang chạy `luu()` ⇒ khoá ba nút để không bấm chồng lượt ghi. */
  dangLuu?: boolean;
  onLuuRoiDoi: () => void;
  onBoThayDoi: () => void;
  onHuy: () => void;
}

export function HopThoaiChuaLuu({
  mo,
  soThayDoi,
  dangLuu = false,
  onLuuRoiDoi,
  onBoThayDoi,
  onHuy,
}: HopThoaiChuaLuuProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={mo}
      /* Bấm Esc / ra ngoài = HUỶ (giữ nguyên thay đổi), không phải "bỏ". Mặc
         định an toàn phải là mặc định KHÔNG mất gì. */
      onOpenChange={(o) => {
        if (!o && !dangLuu) onHuy();
      }}
    >
      <AlertDialogContent data-testid="hop-thoai-chua-luu">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t("twin3d.studioUi.chuaLuuTieuDe", "Còn thay đổi chưa lưu")}
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="hop-thoai-chua-luu-mo-ta">
            {t(
              "twin3d.studioUi.chuaLuuMoTa",
              "{{n}} thay đổi trên mặt sàn này sẽ MẤT nếu bạn chuyển đi. Lưu chúng trước?",
              { n: soThayDoi },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="ghost"
            data-testid="nut-huy-doi"
            disabled={dangLuu}
            onClick={onHuy}
          >
            {t("twin3d.studioUi.huyDoiTang", "Ở lại tầng này")}
          </Button>
          <Button
            variant="outline"
            data-testid="nut-bo-thay-doi"
            disabled={dangLuu}
            onClick={onBoThayDoi}
          >
            {t("twin3d.studioUi.boThayDoi", "Bỏ thay đổi")}
          </Button>
          <Button data-testid="nut-luu-roi-doi" disabled={dangLuu} onClick={onLuuRoiDoi}>
            {dangLuu
              ? t("twin3d.studioUi.dangLuu")
              : t("twin3d.studioUi.luuRoiDoi", "Lưu rồi chuyển")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default HopThoaiChuaLuu;
