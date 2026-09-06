/**
 * DongThoiGian.tsx — thanh TUA LẠI 24 giờ (§9.8).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ ĐÂY CHỈ LÀ BỘ ĐIỀU KHIỂN — KHÔNG chứa luật nào về trạng thái/tuổi/màu
 * ════════════════════════════════════════════════════════════════════════════
 * Toàn bộ phép tính nằm ở `khoTrangThai.ts` (module thuần), và cả trực tiếp lẫn
 * tua lại đều đi qua đúng `apDung()` ở đó. Component này chỉ phát ra MỘT con số:
 * mốc thời gian đang xem (`null` = trực tiếp). Nhờ vậy §9.8 ("cùng một store")
 * không thể bị phá từ tầng giao diện — ở đây không có gì để phá.
 *
 * ★ Mã hoá DƯ THỪA (§10.3 luật 2): chế độ tua lại được báo bằng **màu + chữ +
 *   vị trí con trượt**, không chỉ bằng màu. Người không phân biệt màu vẫn đọc
 *   được nhãn "Xem lại HH:MM".
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";

/** Trần cửa sổ tua lại — §9.8 "thanh kéo 24 h qua". */
export const CUA_SO_TUA_MS = 24 * 60 * 60 * 1000;

/** Các tốc độ phát lại (§9.8 "×1/×5/×20"). */
export const TOC_DO = [1, 5, 20] as const;
export type TocDo = (typeof TOC_DO)[number];

/** Bước nhảy của nút ◁ ▷ — 5 phút, đủ mịn để bắt một sự kiện, đủ thô để đi nhanh. */
export const BUOC_MS = 5 * 60 * 1000;

export interface DongThoiGianProps {
  /** Mốc đang xem (ms epoch); `null` = đang ở trực tiếp. */
  moc: number | null;
  /** Đồng hồ hiện tại — THAM SỐ, không đọc `Date.now()` bên trong (test được). */
  bayGio: number;
  dangPhat: boolean;
  tocDo: TocDo;
  onDoiMoc: (moc: number | null) => void;
  onDoiPhat: (dangPhat: boolean) => void;
  onDoiTocDo: (tocDo: TocDo) => void;
}

/**
 * Kẹp mốc vào cửa sổ hợp lệ [bayGio - 24h, bayGio].
 *
 * ★ Kẹp chứ không từ chối: thanh trượt phát ra giá trị liên tục khi kéo, và một
 *   lỗi giữa chừng làm cảnh nhấp nháy. Biên vẫn được cưỡng chế — không có đường
 *   nhìn trộm tương lai.
 */
export function kepMoc(moc: number, bayGio: number): number {
  return Math.min(Math.max(moc, bayGio - CUA_SO_TUA_MS), bayGio);
}

/** Nhãn giờ:phút của một mốc — `—` khi đang trực tiếp (NT-3.5). */
export function nhanMoc(moc: number | null): string {
  if (moc == null) return "—";
  const d = new Date(moc);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DongThoiGian({
  moc,
  bayGio,
  dangPhat,
  tocDo,
  onDoiMoc,
  onDoiPhat,
  onDoiTocDo,
}: DongThoiGianProps) {
  const { t } = useTranslation();
  const dangTua = moc != null;

  /*
   * Vòng phát lại. `setInterval` 1 giây, mỗi nhịp tiến `tocDo` giây dữ liệu.
   *
   * ⚠ Dừng ở HIỆN TẠI rồi tự chuyển về trực tiếp (`onDoiMoc(null)`) — nếu không,
   *   con trượt dính ở mép phải và người dùng tưởng đang xem trực tiếp trong khi
   *   thực ra vẫn ở chế độ tua với một mốc đứng im. Đó đúng là kiểu "màn hình
   *   không đổi mà không ai biết vì sao" mà NT-3 sinh ra để chặn.
   */
  const refPhat = useRef<{ moc: number | null; tocDo: TocDo; bayGio: number }>({ moc, tocDo, bayGio });
  refPhat.current = { moc, tocDo, bayGio };

  useEffect(() => {
    if (!dangPhat || moc == null) return;
    const id = setInterval(() => {
      const { moc: m, tocDo: td, bayGio: bg } = refPhat.current;
      if (m == null) return;
      const moi = m + td * 1000;
      if (moi >= bg) {
        onDoiPhat(false);
        onDoiMoc(null); // về trực tiếp
      } else {
        onDoiMoc(moi);
      }
    }, 1000);
    return () => clearInterval(id);
    // `moc` cố ý KHÔNG nằm trong deps: nó đổi mỗi giây và sẽ dựng lại interval
    // liên tục. Giá trị mới nhất đọc qua `refPhat`.
  }, [dangPhat, moc == null, onDoiMoc, onDoiPhat]);

  const nhay = (delta: number) => {
    const goc = moc ?? bayGio;
    onDoiMoc(kepMoc(goc + delta, bayGio));
  };

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t px-2 py-1"
      data-testid="dong-thoi-gian"
      data-dang-tua={dangTua ? "1" : "0"}
    >
      {/* Về trực tiếp — mã hoá dư thừa: icon + chữ + trạng thái nút */}
      <Button
        size="sm"
        variant={dangTua ? "outline" : "default"}
        className="h-7 px-2 text-[11px]"
        data-testid="nut-truc-tiep"
        aria-pressed={!dangTua}
        onClick={() => {
          onDoiPhat(false);
          onDoiMoc(null);
        }}
      >
        <Radio className="mr-1 h-3 w-3" />
        {t("twin3d.tua.trucTiep", "Trực tiếp")}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        data-testid="nut-lui"
        aria-label={t("twin3d.tua.lui", "Lùi 5 phút")}
        onClick={() => nhay(-BUOC_MS)}
      >
        <SkipBack className="h-3.5 w-3.5" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        data-testid="nut-phat"
        aria-label={dangPhat ? t("twin3d.tua.dung", "Tạm dừng") : t("twin3d.tua.phat", "Phát")}
        disabled={!dangTua}
        onClick={() => onDoiPhat(!dangPhat)}
      >
        {dangPhat ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        data-testid="nut-tien"
        aria-label={t("twin3d.tua.tien", "Tiến 5 phút")}
        onClick={() => nhay(BUOC_MS)}
      >
        <SkipForward className="h-3.5 w-3.5" />
      </Button>

      {/* Thanh kéo 24 h */}
      <input
        type="range"
        className="min-w-0 flex-1 accent-sky-600"
        data-testid="thanh-tua"
        min={bayGio - CUA_SO_TUA_MS}
        max={bayGio}
        step={60_000}
        value={moc ?? bayGio}
        aria-label={t("twin3d.tua.thanhKeo", "Tua lại 24 giờ qua")}
        aria-valuetext={dangTua ? nhanMoc(moc) : t("twin3d.tua.trucTiep", "Trực tiếp")}
        onChange={(e) => onDoiMoc(kepMoc(Number(e.target.value), bayGio))}
      />

      {/* Nhãn mốc — CHỮ, không chỉ màu (§10.3 luật 2) */}
      <span
        className={`w-28 shrink-0 text-right text-[11px] tabular-nums ${
          dangTua ? "font-medium text-sky-700 dark:text-sky-300" : "text-muted-foreground"
        }`}
        data-testid="nhan-moc-tua"
        data-moc={moc ?? ""}
      >
        {dangTua
          ? t("twin3d.tua.xemLai", "Xem lại {{gio}}", { gio: nhanMoc(moc) })
          : t("twin3d.tua.trucTiep", "Trực tiếp")}
      </span>

      {/* Tốc độ */}
      <div className="flex shrink-0 gap-0.5">
        {TOC_DO.map((v) => (
          <Button
            key={v}
            size="sm"
            variant={tocDo === v ? "secondary" : "ghost"}
            className="h-7 px-1.5 text-[10px]"
            data-testid={`nut-toc-do-${v}`}
            aria-pressed={tocDo === v}
            onClick={() => onDoiTocDo(v)}
          >
            ×{v}
          </Button>
        ))}
      </div>
    </div>
  );
}
