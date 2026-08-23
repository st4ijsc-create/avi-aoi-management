/**
 * ★★★ 2026-08-23 · BỘ CHỌN PHIÊN — NÚT LỊCH SỬ + POPOVER, thay cho cột "Phiên" 190 px.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO ĐỔI HÌNH DẠNG — và cái ĐỔI mua được gì (số đo, không phải khẩu vị)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mẫu là bộ chọn phiên của Claude Code trong VS Code: danh sách phiên KHÔNG chiếm một cột thường
 * trực — nó là một nút đồng hồ ở góc phải thanh đầu hội thoại, bấm mới xoè ra (tìm kiếm + danh
 * sách + thời gian tương đối), kèm một nút ＋ tạo phiên mới. Cột 190 px cũ trả giá THƯỜNG TRỰC cho
 * một thứ chỉ dùng VÀI LẦN mỗi phiên làm việc; bỏ nó, đo được (Playwright 2026-08-23):
 *   · khung 1240 (cửa sổ 1600): Trình xem 370 → 560 px;
 *   · khung  920 (cửa sổ 1280): thoát hẳn chế độ một-khung — ba khung cùng hiện.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH TỆP RIÊNG + VÌ SAO `NoiDungBoChonPhien` ĐƯỢC XUẤT KHẨU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cùng lý do với `TheDuyetDiff` (đọc docblock tệp ấy): nằm trong trang thì không render được ngoài
 * trang, mọi lưới buộc phải quét VĂN BẢN — và lưới quét văn bản mù với đường thoát thật. Thêm một
 * tầng nữa riêng cho popover: Radix `Portal` trả `null` khi không có `document` (SSR), nên một lưới
 * `renderToStaticMarkup` dựng `BoChonPhien` sẽ KHÔNG BAO GIỜ thấy nội dung bên trong popover — nó
 * xanh hay đỏ đều vì lý do sai. Vì thế phần ruột (ô tìm · danh sách · trạng thái · câu quyền riêng
 * tư) là `NoiDungBoChonPhien`, xuất khẩu để lưới `boChonPhien.unit.test.ts` dựng THẲNG cây thật;
 * `BoChonPhien` chỉ là vỏ: hai nút + dây nối popover (một census canh vỏ có nối đúng ruột).
 *
 * ⚠⚠ THUẦN HIỂN THỊ + BA CALLBACK — như cột cũ, thành phần này không giữ một mảnh trạng thái sống
 * nào của không gian làm việc: không thẻ duyệt, không vòng tự động, không đường dẫn. Mọi việc dựng
 * lại trạng thái vẫn ở `chonPhien`/`phienMoi` của trang (lưới `aiCodingWorkspacePhien.unit.test.ts`
 * đếm). Hỏi-xác-nhận-trước-khi-xoá cũng ở trang (`xoaPhienNay`) — MỘT đường xoá, một chỗ hỏi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Tóm tắt một phiên như server trả về ở `repoWorkspace.danhSachPhien`. */
export interface TomTatPhienUI {
  id: string;
  title: string;
  turnCount: number;
  updatedAt: string;
}

/**
 * Hình dạng `t` mà hai hàm thuần dưới đây cần — khai hẹp để hàm đo được bằng lưới đơn vị
 * (truyền một `t` giả tra thẳng `vi.json`) mà không kéo theo kiểu generic của i18next.
 */
type HamDich = (khoa: string, macDinh: string, tham?: Record<string, unknown>) => string;

/**
 * Thời gian tương đối kiểu bộ chọn phiên Claude Code ("1m/13h/2d") — nhưng CHỮ qua i18n:
 * "vừa xong" · "{{n}} phút" · "{{n}} giờ" · "{{n}} ngày" (vi/en/zh đủ ba, lưới §5 phiên canh).
 * ⚠ THUẦN và nhận `bayGio` tường minh — không gọi `new Date()` bên trong, để lưới hỏi được
 *   "13 giờ trước ra chữ gì" bằng một mốc cố định thay vì đuổi theo đồng hồ thật.
 * ⚠ Mốc TƯƠNG LAI (đồng hồ máy lệch) kẹp về "vừa xong" thay vì ra "-3 phút".
 */
export function thoiGianTuongDoi(iso: string, bayGio: Date, t: HamDich): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const giay = Math.max(0, Math.floor((bayGio.getTime() - d.getTime()) / 1000));
  if (giay < 60) return t("repoWs.sessions.rel.now", "vừa xong");
  const phut = Math.floor(giay / 60);
  if (phut < 60) return t("repoWs.sessions.rel.min", "{{n}} phút", { n: phut });
  const gio = Math.floor(phut / 60);
  if (gio < 24) return t("repoWs.sessions.rel.hour", "{{n}} giờ", { n: gio });
  return t("repoWs.sessions.rel.day", "{{n}} ngày", { n: Math.floor(gio / 24) });
}

/**
 * Lọc CLIENT-SIDE trên danh sách ĐÃ TẢI (server trả trọn danh sách của một người/một dự án — vài
 * chục hàng, không phải vài nghìn; thêm một đường tìm server-side là thêm một API cho việc một
 * `filter` làm xong). Khớp chứa, không phân biệt hoa thường; từ khoá rỗng ⇒ trả nguyên danh sách.
 */
export function locPhienTheoTen(phien: TomTatPhienUI[], tuKhoa: string): TomTatPhienUI[] {
  const q = tuKhoa.trim().toLowerCase();
  if (!q) return phien;
  return phien.filter((p) => (p.title ?? "").toLowerCase().includes(q));
}

interface NoiDungProps {
  phien: TomTatPhienUI[];
  /** id phiên ĐANG MỞ — hàng của nó được tô đậm + `aria-current`. */
  dangChon: string | null;
  dangTai: boolean;
  biTuChoi: boolean;
  /** Ô tìm là CONTROLLED — vỏ giữ chữ, để lưới render được trạng thái "đã gõ từ khoá". */
  tuKhoa: string;
  onDoiTuKhoa: (tuKhoa: string) => void;
  onChon: (id: string) => void;
  onXoa: (id: string) => void;
}

/**
 * RUỘT của popover — xuất khẩu CHỈ để lưới dựng cây thật (xem docblock đầu tệp).
 * ⚠ ĐỪNG nhúng nó ở một chỗ thứ hai ngoài `BoChonPhien`: hai bộ chọn phiên là hai chỗ phải giữ
 *   đồng bộ bằng tay — đúng lớp lỗi "hai chỗ, một sự thật" mà repo đã trả giá.
 */
export function NoiDungBoChonPhien({
  phien, dangChon, dangTai, biTuChoi, tuKhoa, onDoiTuKhoa, onChon, onXoa,
}: NoiDungProps) {
  const { t, i18n } = useTranslation();
  const bayGio = new Date();
  const daLoc = locPhienTheoTen(phien, tuKhoa);
  /** Ngày đầy đủ chỉ còn ở tooltip — hàng danh sách dùng thời gian tương đối như mẫu. */
  const dinhDangNgay = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div data-noi-dung-phien className="flex max-h-80 flex-col">
      <div className="shrink-0 border-b p-2">
        <input
          data-o-tim
          type="text"
          value={tuKhoa}
          onChange={(e) => onDoiTuKhoa(e.target.value)}
          placeholder={t("repoWs.sessions.search", "Tìm phiên theo tên…")}
          aria-label={t("repoWs.sessions.search", "Tìm phiên theo tên…")}
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
        {biTuChoi ? (
          <p className="px-2 py-3 text-[11px] text-destructive">
            {t("repoWs.sessions.denied", "Server từ chối đọc phiên: thiếu quyền ai_repo_read.")}
          </p>
        ) : dangTai ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("repoWs.sessions.loading", "Đang tải phiên…")}</p>
        ) : phien.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
            {t("repoWs.sessions.empty", "Phiên bạn bắt đầu sẽ hiện ở đây.")}
          </p>
        ) : daLoc.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            {t("repoWs.sessions.noMatch", "Không phiên nào khớp từ khoá.")}
          </p>
        ) : (
          daLoc.map((p) => (
            <div
              key={p.id}
              data-hang-phien
              className={cn(
                "group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted",
                dangChon === p.id && "bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => onChon(p.id)}
                aria-current={dangChon === p.id ? "true" : undefined}
                title={t("repoWs.sessions.meta", "{{n}} lượt · {{luc}}", { n: p.turnCount, luc: dinhDangNgay(p.updatedAt) })}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className={cn("min-w-0 flex-1 truncate text-[11px] leading-snug", dangChon === p.id ? "font-semibold text-primary" : "font-medium")}>
                  {p.title || t("repoWs.sessions.untitled", "Phiên chưa đặt tên")}
                </span>
                {/* Căn PHẢI như mẫu ("1m/13h/2d") — `shrink-0` để tên dài không nuốt mất giờ. */}
                <span data-thoi-gian className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {thoiGianTuongDoi(p.updatedAt, bayGio, t)}
                </span>
              </button>
              <button
                type="button"
                data-nut-xoa
                onClick={() => onXoa(p.id)}
                title={t("repoWs.sessions.delete", "Xoá phiên")}
                aria-label={t("repoWs.sessions.delete", "Xoá phiên")}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
      <p className="shrink-0 border-t px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        {t("repoWs.sessions.scopeNote", "Phiên lưu trên máy chủ, riêng theo tài khoản và theo dự án — người khác không đọc được.")}
      </p>
    </div>
  );
}

interface BoChonPhienProps {
  phien: TomTatPhienUI[];
  dangChon: string | null;
  dangTai: boolean;
  biTuChoi: boolean;
  onChon: (id: string) => void;
  onMoi: () => void;
  onXoa: (id: string) => void;
  /** Chỉ để trang đặt vị trí (vd `ml-auto` trên thanh đầu Hội thoại). Không mang trạng thái. */
  className?: string;
}

/** VỎ: nút đồng hồ (mở popover lịch sử) + nút ＋ (phiên mới) — góc phải thanh đầu, như mẫu. */
export function BoChonPhien({
  phien, dangChon, dangTai, biTuChoi, onChon, onMoi, onXoa, className,
}: BoChonPhienProps) {
  const { t } = useTranslation();
  const [mo, setMo] = useState(false);
  const [tuKhoa, setTuKhoa] = useState("");

  return (
    <div data-bo-chon-phien className={cn("flex items-center gap-1", className)}>
      <Popover
        open={mo}
        onOpenChange={(o) => {
          setMo(o);
          // Mỗi lượt MỞ bắt đầu với ô tìm sạch — từ khoá của lượt trước không được lọc ngầm
          // danh sách của lượt này (một danh sách "thiếu phiên" không rõ vì đâu là một lời nói dối).
          if (o) setTuKhoa("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-nut-lich-su
            className="h-6 w-6"
            title={t("repoWs.sessions.history", "Lịch sử phiên")}
            aria-label={t("repoWs.sessions.history", "Lịch sử phiên")}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        {/* `p-0 w-80`: ruột tự chia ô tìm/danh sách/chân — đệm mặc định của PopoverContent làm
            danh sách hụt bề ngang. `align="end"` để popover nở về phía trong màn, không tràn phải. */}
        <PopoverContent align="end" sideOffset={6} className="w-80 p-0">
          <NoiDungBoChonPhien
            phien={phien}
            dangChon={dangChon}
            dangTai={dangTai}
            biTuChoi={biTuChoi}
            tuKhoa={tuKhoa}
            onDoiTuKhoa={setTuKhoa}
            onChon={(id) => {
              // Chọn xong thì ĐÓNG — người dùng quay về hội thoại vừa nạp, không phải popover.
              setMo(false);
              onChon(id);
            }}
            onXoa={onXoa}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        data-nut-phien-moi
        className="h-6 w-6"
        onClick={onMoi}
        title={t("repoWs.sessions.new", "Phiên mới")}
        aria-label={t("repoWs.sessions.new", "Phiên mới")}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
