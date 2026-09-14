/**
 * ★★★ ĐỢT 45 (mục 6 · kỹ thuật nhỏ 11) — Ô CUỘN NGANG CÓ MÉP MỜ + MŨI TÊN.
 *
 * QA Đợt 44: thanh tab cockpit @1280 (và @1600) cắt "Cảnh b…"/"Tru…" mà KHÔNG một dấu hiệu nào —
 * `ScrollArea` Radix chỉ vẽ thanh cuộn khi rê chuột, và headless ẩn thanh cuộn hẳn. Một hàng tab
 * còn 4 mục nằm ngoài tầm nhìn mà trông như đã hết là một hàng tab nói dối.
 *
 * Ba tín hiệu, đo được từ DOM (`data-cuon-duoc`, `data-mep-trai`, `data-mep-phai`):
 *   • mép mờ (mask) ở phía CÒN nội dung — chữ cuối "tan" vào mép thay vì bị cắt cụt;
 *   • nút ‹ › nổi ở mép ấy — bấm cuộn một bước; bàn phím vẫn cuộn qua tiêu điểm tab (Radix roving);
 *   • thuộc tính `data-*` nói trạng thái để lưới thị giác đọc, không suy từ ảnh.
 * Không có gì thay đổi khi nội dung VỪA khung: 0 mask, 0 nút, 0 px chiếm thêm.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CuonNgangCoMepProps {
  children: React.ReactNode;
  className?: string;
  /** `data-testid` của khung ngoài; nút mang `${nutTestid}-trai|-phai`. */
  testid?: string;
  nutTestid?: string;
  /** Nhãn đọc màn hình cho hai nút (đã qua `t()` ở người gọi). */
  nhanTrai: string;
  nhanPhai: string;
  /** Bước cuộn mỗi lần bấm (px). */
  buocPx?: number;
}

/** Trạng thái mép — tính từ số đo thật của ô cuộn. */
export function tinhMep(scrollLeft: number, clientWidth: number, scrollWidth: number): { cuonDuoc: boolean; trai: boolean; phai: boolean } {
  const cuonDuoc = scrollWidth > clientWidth + 1;
  return { cuonDuoc, trai: cuonDuoc && scrollLeft > 1, phai: cuonDuoc && scrollLeft + clientWidth < scrollWidth - 1 };
}

/** Mask CSS theo mép còn nội dung (rỗng ⇒ không mask). */
export function maskTheoMep(trai: boolean, phai: boolean, moPx = 36): string {
  if (!trai && !phai) return "";
  const dau = trai ? `transparent, black ${moPx}px` : "black 0";
  const cuoi = phai ? `black calc(100% - ${moPx}px), transparent` : "black 100%";
  return `linear-gradient(to right, ${dau}, ${cuoi})`;
}

export function CuonNgangCoMep({
  children,
  className,
  testid = "cuon-ngang-co-mep",
  nutTestid = "nut-cuon",
  nhanTrai,
  nhanPhai,
  buocPx = 240,
}: CuonNgangCoMepProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [mep, setMep] = React.useState({ cuonDuoc: false, trai: false, phai: false });
  const doLai = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const m = tinhMep(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setMep((cu) => (cu.cuonDuoc === m.cuonDuoc && cu.trai === m.trai && cu.phai === m.phai ? cu : m));
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    doLai();
    // Đo lại khi khung HOẶC nội dung đổi cỡ (đổi tab/ngôn ngữ/font) — không chỉ khi cuộn.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(doLai);
    ro?.observe(el);
    for (const c of Array.from(el.children)) ro?.observe(c);
    el.addEventListener("scroll", doLai, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", doLai);
    };
  }, [doLai]);
  const cuon = (huong: -1 | 1) => ref.current?.scrollBy({ left: huong * buocPx, behavior: "smooth" });
  const mask = maskTheoMep(mep.trai, mep.phai);
  const nutCls =
    "absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2";
  return (
    <div
      className={cn("relative", className)}
      data-testid={testid}
      data-cuon-duoc={mep.cuonDuoc ? "1" : "0"}
      data-mep-trai={mep.trai ? "1" : "0"}
      data-mep-phai={mep.phai ? "1" : "0"}
    >
      <div
        ref={ref}
        data-o-cuon="1"
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
      {mep.trai ? (
        <button type="button" className={cn(nutCls, "left-0")} aria-label={nhanTrai} title={nhanTrai} data-testid={`${nutTestid}-trai`} onClick={() => cuon(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      {mep.phai ? (
        <button type="button" className={cn(nutCls, "right-0")} aria-label={nhanPhai} title={nhanPhai} data-testid={`${nutTestid}-phai`} onClick={() => cuon(1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export default CuonNgangCoMep;
