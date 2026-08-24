/**
 * ★★★ 2026-08-24 · RIBBON TÁC VỤ — MỘT hàng nút icon gom các tác vụ thường dùng của không gian
 * lập trình AI: làm mới cây tệp · chạy kiểm chứng · dừng stream · và (ở màn HẸP một-khung) nhảy
 * qua khung Cây tệp / khung Hội thoại.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH TỆP RIÊNG — cùng lý do `BoChonPhien` (đọc docblock tệp ấy cho số đo)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thành phần nằm TRONG trang thì không render được ngoài trang, nên mọi lưới buộc phải quét VĂN
 * BẢN — mà lưới quét văn bản mù với đường thoát thật (nó xanh hay đỏ đều vì lý do sai). Tách ra tệp
 * riêng để `ribbonTacVu.unit.test.ts` dựng THẲNG cây thật bằng `renderToStaticMarkup` rồi hỏi "cái
 * gì RA HTML", không phải "mã có chuỗi ấy không".
 *
 * ⚠⚠ THUẦN HIỂN THỊ — 0 mutation, 0 tRPC, 0 trạng thái sống (như `BoChonPhien`).
 * Thành phần chỉ nhận props + gọi CALLBACK; nó không giữ một mảnh trạng thái nào của không gian làm
 * việc (không thẻ duyệt, không vòng tự động, không stream). Mọi hành động THẬT do TRANG thực hiện ở
 * Wave nối-dây.
 *
 * ⚠⚠ "CHẠY KIỂM CHỨNG" KHÔNG phải một đường tắt bỏ qua cửa duyệt. Ở đây nó CHỈ là một callback; tại
 * trang, nó đi qua đúng con đường cũ của ba nút gợi ý: chat → propose → NGƯỜI DUYỆT → chạy. Và
 * ribbon KHÔNG nới quyền: nút này chỉ HIỆN khi trang khẳng định `coTheChayKiemChung`
 * (= `canExec && có lệnh gợi ý`); tài khoản thiếu quyền chạy lệnh thì nút vắng mặt, y như gợi ý
 * chạy test bị ẩn — và server vẫn chặn nếu có ai gọi thẳng.
 */
import { useTranslation } from "react-i18next";
import { RefreshCw, Wrench, StopCircle, FolderTree, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RibbonTacVuProps {
  /** true ⇒ HIỆN 2 nút "nhảy khung" (màn HẸP chỉ đủ một khung); false ⇒ ẩn cả hai. */
  hep: boolean;
  /** true ⇒ HIỆN nút Dừng (đang có một lượt stream để cắt). */
  dangStream: boolean;
  /** false ⇒ ẨN nút Chạy kiểm chứng (thiếu quyền chạy lệnh, hoặc không có lệnh gợi ý nào). */
  coTheChayKiemChung: boolean;
  onLamMoiCay: () => void;
  onChayKiemChung: () => void;
  onDung: () => void;
  /** Chỉ dùng khi `hep` — nhảy tới khung Cây tệp. */
  onNhayTep: () => void;
  /** Chỉ dùng khi `hep` — nhảy về khung Hội thoại. */
  onNhayChat: () => void;
  /** Chỉ để TRANG đặt vị trí (vd `ml-auto` trên thanh công cụ). Không mang trạng thái. */
  className?: string;
}

/**
 * Một hàng nút icon gọn (`h-8`), hợp thẩm mỹ thanh công cụ hiện có. Mỗi nút mang một `data-*` để
 * lưới bắt, cùng `title`/`aria-label` từ i18n (chữ duy nhất trên một nút chỉ-icon).
 */
export function RibbonTacVu({
  hep, dangStream, coTheChayKiemChung,
  onLamMoiCay, onChayKiemChung, onDung, onNhayTep, onNhayChat, className,
}: RibbonTacVuProps) {
  const { t } = useTranslation();

  return (
    <div data-ribbon-tac-vu className={cn("flex items-center gap-1", className)}>
      {/* Làm mới cây — LUÔN hiện (không phụ thuộc quyền hay trạng thái stream). */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-nut-lam-moi-cay
        onClick={onLamMoiCay}
        title={t("repoWs.ribbon.refreshTree", "Làm mới cây tệp")}
        aria-label={t("repoWs.ribbon.refreshTree", "Làm mới cây tệp")}
      >
        <RefreshCw className="h-4 w-4" />
      </Button>

      {/* Chạy kiểm chứng — CHỈ khi trang cho phép; ẩn nút KHÔNG nới quyền (server vẫn là chốt cuối). */}
      {coTheChayKiemChung && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-nut-chay-kiem-chung
          onClick={onChayKiemChung}
          title={t("repoWs.ribbon.runVerify", "Chạy kiểm chứng")}
          aria-label={t("repoWs.ribbon.runVerify", "Chạy kiểm chứng")}
        >
          <Wrench className="h-4 w-4" />
        </Button>
      )}

      {/* Dừng — CHỈ khi đang có lượt stream để cắt. Tô màu destructive để báo hành động cắt ngang. */}
      {dangStream && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-nut-dung
          onClick={onDung}
          title={t("repoWs.ribbon.stop", "Dừng")}
          aria-label={t("repoWs.ribbon.stop", "Dừng")}
          className="text-destructive hover:text-destructive"
        >
          <StopCircle className="h-4 w-4" />
        </Button>
      )}

      {/* Nhảy khung — CHỈ ở màn HẸP một-khung; ngăn cách nhóm bằng một vạch mảnh cho dễ đọc. */}
      {hep && (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-nut-nhay-tep
            onClick={onNhayTep}
            title={t("repoWs.ribbon.jumpFiles", "Xem cây tệp")}
            aria-label={t("repoWs.ribbon.jumpFiles", "Xem cây tệp")}
          >
            <FolderTree className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-nut-nhay-chat
            onClick={onNhayChat}
            title={t("repoWs.ribbon.jumpChat", "Về hội thoại")}
            aria-label={t("repoWs.ribbon.jumpChat", "Về hội thoại")}
          >
            <MessagesSquare className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
