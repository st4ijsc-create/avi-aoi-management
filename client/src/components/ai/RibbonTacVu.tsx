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
import { RefreshCw, Wrench, StopCircle, FolderTree, MessagesSquare, TerminalSquare, AlertTriangle, Plus } from "lucide-react";
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
  // ── Nhóm PANEL + PHIÊN (2026-08-24, theo yêu cầu chủ dự án: ribbon dày hơn) ──
  /** Trạng thái cửa sổ dưới (Terminal/Vấn đề) — để tô nút đang bật. MỘT nguồn sự thật với tab ở đáy. */
  duoiChat: "dong" | "terminal" | "problems";
  /** Bật/tắt cửa Terminal ở đáy (toggle như bấm tab). */
  onToggleTerminal: () => void;
  /** Bật/tắt cửa Vấn đề ở đáy. */
  onToggleProblems: () => void;
  /** Số vấn đề của lượt lệnh mới nhất — huy hiệu trên nút Vấn đề (0 ⇒ không huy hiệu). */
  soVanDe: number;
  /** Mở một phiên hội thoại mới. */
  onPhienMoi: () => void;
  /** Chỉ để TRANG đặt vị trí (vd `ml-auto` trên thanh công cụ). Không mang trạng thái. */
  className?: string;
}

/**
 * Một hàng nút icon gọn (`h-8`), hợp thẩm mỹ thanh công cụ hiện có. Mỗi nút mang một `data-*` để
 * lưới bắt, cùng `title`/`aria-label` từ i18n (chữ duy nhất trên một nút chỉ-icon).
 */
export function RibbonTacVu({
  hep, dangStream, coTheChayKiemChung,
  onLamMoiCay, onChayKiemChung, onDung, onNhayTep, onNhayChat,
  duoiChat, onToggleTerminal, onToggleProblems, soVanDe, onPhienMoi, className,
}: RibbonTacVuProps) {
  const { t } = useTranslation();
  const nutBat = "bg-primary/10 text-primary"; // nền nút đang bật (cửa panel đang mở)

  // ── RESPONSIVE (Lỗi 1): một HÀNG cuộn ngang khi chật — `flex-nowrap` giữ đúng một hàng, `overflow-x-auto`
  //    cho phép CUỘN thay vì cắt cụt/đẩy nút ra ngoài ở màn rất hẹp (~10 nút icon + 2 vạch ngăn). KHÔNG
  //    dùng `flex-wrap`: thanh này là dải `shrink-0 border-b` cao cố định (nút `h-8` + `py-1`), xuống hàng
  //    sẽ ĐỘI chiều cao dải ⇒ vỡ layout khung. Nút đã `shrink-0` sẵn (buttonVariants) và các vạch ngăn cũng
  //    `shrink-0` ⇒ không nút nào bị bóp méo khi cuộn.
  return (
    <div data-ribbon-tac-vu className={cn("flex flex-nowrap items-center gap-1 overflow-x-auto", className)}>
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

      {/* ── Nhóm CỬA SỔ DƯỚI + PHIÊN — vạch ngăn cho dễ đọc. Toggle Terminal/Vấn đề dùng CÙNG state
          `duoiChat` với tab ở đáy (một nguồn sự thật), như "Terminal" menu của VSCode song hành với
          tab panel. Không nới quyền, không mutation — chỉ callback. */}
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-nut-terminal
        onClick={onToggleTerminal}
        title={t("repoWs.ribbon.terminal", "Cửa sổ Terminal")}
        aria-label={t("repoWs.ribbon.terminal", "Cửa sổ Terminal")}
        className={cn(duoiChat === "terminal" && nutBat)}
      >
        <TerminalSquare className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-nut-problems
        onClick={onToggleProblems}
        title={t("repoWs.ribbon.problems", "Cửa sổ Vấn đề")}
        aria-label={t("repoWs.ribbon.problems", "Cửa sổ Vấn đề")}
        className={cn("relative", duoiChat === "problems" && nutBat)}
      >
        <AlertTriangle className="h-4 w-4" />
        {/* Huy hiệu số vấn đề (Lỗi 2) — CÙNG cặp màu với tab "Vấn đề" ở đáy (AICodingWorkspace ~L1800):
            `bg-amber-100/text-amber-700` (+dark) đạt tương phản AA, thay `amber-500`+chữ trắng (~1.8:1 TRƯỢT
            AA) và chấm dứt cảnh "cùng con số vẽ 3-4 kiểu". `leading-none` thay `leading-3.5` (nấc `3.5` KHÔNG
            tồn tại ⇒ trước đây mất line-height, chữ lệch tâm); flex canh tâm khi `min-w-3.5` rộng hơn chữ. */}
        {soVanDe > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-3.5 items-center justify-center rounded-full bg-amber-100 px-0.5 text-[9px] font-semibold leading-none text-amber-700 tabular-nums dark:bg-amber-950/40 dark:text-amber-300">
            {soVanDe}
          </span>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-nut-phien-moi
        onClick={onPhienMoi}
        title={t("repoWs.ribbon.newSession", "Phiên mới")}
        aria-label={t("repoWs.ribbon.newSession", "Phiên mới")}
      >
        <Plus className="h-4 w-4" />
      </Button>

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
