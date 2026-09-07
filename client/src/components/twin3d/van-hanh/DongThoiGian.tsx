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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #37 — SCRUB THEO **BIÊN STEP**, VÀ PHÍM ←/→                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ Mốc kế tiếp khi bấm ◁/▷ hoặc phím ←/→ — **CĂN VỀ BIÊN**, không cộng thô.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG PHẢI `moc + delta` (đó chính là `nhay()` cũ)
 * ════════════════════════════════════════════════════════════════════════════
 * Spec §11 #37 đòi *"scrub … **theo biên step**"*, và cộng thô KHÔNG cho ra
 * biên. Mốc khởi điểm gần như luôn lệch biên, vì hai đường vào đều sinh số lẻ:
 *   • thả thanh trượt → `step={60_000}` của `<input>` căn theo `min`, mà `min`
 *     = `bayGio − 24h` là một mili-giây bất kỳ (`Date.now()`);
 *   • vòng phát lại → `m + tocDo*1000`, tức bội số của 1 s, không của 5 phút.
 * Nên từ 09:03:47 mà cộng thô 5 phút được 09:08:47, rồi 09:13:47 — người dùng
 * bấm ◁ ba lần vẫn không bao giờ đứng trên một mốc tròn, và hai người tua tới
 * "cùng một chỗ" nhận hai mốc khác nhau. Đó cũng là thứ phá tính khứ hồi của
 * `?tg=`: mốc chia sẻ mang một offset ngẫu nhiên vô nghĩa.
 *
 * Căn biên khiến lưới mốc chỉ phụ thuộc `BUOC_MS`, KHÔNG phụ thuộc điểm khởi
 * hành — hai người bấm ←/→ từ hai chỗ khác nhau hội tụ về cùng một tập mốc.
 *
 * ★ HAI luật con, cả hai đều cần thiết:
 *   1. **Đang lệch biên thì bước ĐẦU TIÊN chỉ căn về biên**, không nhảy trọn ô.
 *      Từ 09:03:47 bấm ◁ ra 09:00:00 (lùi 3'47"), bấm tiếp ra 08:55:00. Nếu bỏ
 *      luật này mà luôn nhảy trọn ô thì ◁ từ 09:03:47 ra 08:55:00 — **vượt qua**
 *      09:00:00 mà không dừng lại, tức có những biên người dùng KHÔNG BAO GIỜ
 *      tới được bằng phím, kể cả bấm bao nhiêu lần.
 *   2. **Đã đúng biên thì đi trọn một ô** — nếu không, bấm ◁ trên một mốc tròn
 *      sẽ căn về chính nó và phím trở nên chết cứng (`f(x)=x`, G5/G32: đầu ra
 *      phải KHÁC đầu vào).
 *
 * ★ `goc == null` (đang trực tiếp): điểm khởi hành là `bayGio`. Bấm ◁ từ chế độ
 *   trực tiếp là cách vào chế độ tua, nên nó PHẢI trả một mốc, không trả `null`.
 *
 * ⚠ Kết quả luôn qua `kepMoc`: căn biên có thể ném ra ngoài cửa sổ 24 h (căn lên
 *   từ một mốc sát `bayGio` cho ra một biên ở TƯƠNG LAI), và biên vẫn phải được
 *   cưỡng chế — không có đường nhìn trộm tương lai.
 */
export function mocTheoBuoc(
  goc: number | null,
  huong: -1 | 1,
  bayGio: number,
  buocMs: number = BUOC_MS,
): number {
  const tu = goc ?? bayGio;
  // Lưới neo vào epoch (0), không vào `bayGio`: neo vào `bayGio` làm lưới trôi
  // mỗi render vì `Date.now()` đổi, và cùng một `?tg=` mở hai lúc ra hai biên.
  const duoi = Math.floor(tu / buocMs) * buocMs;
  const ke =
    huong < 0
      ? // lệch biên ⇒ về biên dưới; đúng biên ⇒ lùi trọn một ô
        (duoi < tu ? duoi : tu - buocMs)
      : // lên: biên trên của ô hiện tại; đúng biên ⇒ tiến trọn một ô
        duoi + buocMs;
  return kepMoc(ke, bayGio);
}

/**
 * Phím ←/→ có phải thao tác tua không, và theo hướng nào.
 *
 * ★ `null` cho MỌI thứ khác — kể cả ←/→ đi kèm phím bổ trợ. `Alt+←` là **Back
 *   của trình duyệt** và `Cmd+←` là về đầu dòng; nuốt chúng để tua 5 phút là
 *   cướp một phím hệ thống mà người dùng không hề yêu cầu.
 */
export function huongTuPhim(e: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): -1 | 1 | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === "ArrowLeft") return -1;
  if (e.key === "ArrowRight") return 1;
  return null;
}

/**
 * Ô đang gõ có được quyền GIỮ phím ←/→ không.
 *
 * ★★★ Đây không phải phòng thủ thừa. `/twin` có ô lọc máy, ô tìm kiếm và chính
 *   `<input type="range">` của thanh này. Bắt ←/→ ở cấp `window` mà không hỏi
 *   tiêu điểm thì người dùng đang sửa một chữ trong ô lọc bấm ← để lùi con trỏ
 *   sẽ **tua cả nhà máy về 5 phút trước** — và không có lỗi nào nổ để báo.
 *
 * ⚠ `<input type="range">` cũng nằm trong danh sách này: trình duyệt đã cho ←/→
 *   nghĩa "giảm/tăng một `step`" khi nó có tiêu điểm. Cướp phím ở đó tạo HAI bộ
 *   xử lý cho một phím (G12), và mốc sẽ nhảy hai lần một lần bấm.
 */
export function oDangGo(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
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

  /**
   * #37 — một BƯỚC tua. Dùng chung cho nút ◁/▷ và phím ←/→, nên hai đường vào
   * không thể lệch nhau (G12: hai bản cài đặt của cùng một luật sớm muộn cũng
   * cho hai kết quả, và ở đây "bấm nút" với "bấm phím" phải là MỘT thao tác).
   */
  const buoc = (huong: -1 | 1) => {
    onDoiMoc(mocTheoBuoc(moc, huong, bayGio));
  };

  /*
   * #37 — PHÍM ←/→ ở cấp `window`.
   *
   * ★ Bắt ở `window` chứ không trên thanh này: người vận hành đang nhìn cảnh 3D
   *   không có tiêu điểm trên thanh tua, và bắt họ Tab tới nó trước mới tua được
   *   thì phím tắt không mua thêm gì so với cái nút đã có.
   *
   * ⚠ HAI cửa kiểm trước khi nuốt phím, và bỏ cửa nào cũng hỏng:
   *   • `huongTuPhim` → `null` khi có phím bổ trợ ⇒ `Alt+←` vẫn là Back.
   *   • `oDangGo` ⇒ ←/→ trong ô lọc/ô tìm/thanh trượt vẫn là di chuyển con trỏ.
   * `preventDefault` CHỈ chạy sau khi cả hai cửa đã cho qua — gọi nó sớm hơn là
   * cướp phím của người khác rồi mới hỏi có nên cướp không.
   */
  useEffect(() => {
    const xuLy = (e: KeyboardEvent) => {
      const huong = huongTuPhim(e);
      if (huong === null) return;
      if (oDangGo(document.activeElement)) return;
      e.preventDefault();
      buoc(huong);
    };
    window.addEventListener("keydown", xuLy);
    return () => window.removeEventListener("keydown", xuLy);
    // `buoc` đọc `moc`/`bayGio` mới nhất qua closure ⇒ phải gắn lại khi chúng đổi.
  });

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
        onClick={() => buoc(-1)}
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
        onClick={() => buoc(1)}
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
