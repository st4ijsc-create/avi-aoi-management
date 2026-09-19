/**
 * BangKpiNoi.tsx — §11 #16: LỚP PHỦ KPI ĐỌC ĐƯỢC TRÊN CẢNH 3D.
 *
 * Yêu cầu #6 của chủ sở hữu: *"Các thông tin thống kê và các chỉ số nên hiển
 * thị trên màn hình 3D Digital Twin"*. Trước bản này mọi con số chỉ sống trong
 * panel trái — thu panel lại (`?thu=trai,phai`, đường tới "3D toàn màn") là mất
 * sạch số liệu, và đó chính là chế độ xem mà một màn hình treo tường sẽ dùng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO DOM, KHÔNG PHẢI CHỮ TRONG CẢNH — §4, ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trên trình duyệt thật 2026-09-07 (`e2e_tai_loE`, `/twin`, 1280×720):
 * `window.__thongKeVe.calls` = **3 draw calls**, canvas 488×453.
 * §4: draw calls ≤ 150, FPS xoay ≥ 30, nhãn cap ở **30** (300 nhãn CSS2D đã đo
 * được là laggy; `troika-three-text` tốn 1 draw call MỖI nhãn).
 *
 * Tám ô KPI dựng bằng text-in-scene = 3 → 11 draw calls, chữ xoay theo camera,
 * bị máy che, và nhỏ dần khi zoom ra — tức là không đọc được đúng lúc cần đọc.
 * Lớp phủ DOM tốn **0 draw call**, luôn hướng thẳng, chọn/copy được, và trình
 * đọc màn hình thấy (§9.9 — canvas WebGL vô hình với nó).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ KHÔNG CHE CẢNH, VÀ KHÔNG NUỐT CHUỘT
 * ════════════════════════════════════════════════════════════════════════════
 * `pointer-events-none` trên khung ngoài là BẮT BUỘC, không phải tinh chỉnh:
 * canvas nằm dưới và nhận drag để xoay camera. Một lớp phủ "trong suốt" mà vẫn
 * bắt sự kiện sẽ làm chết một mảng thao tác xoay ở góc màn hình — hỏng câm,
 * không lỗi nào nổ. Riêng nút thu/mở phải bấm được nên nó bật lại
 * `pointer-events-auto` cho CHÍNH nó.
 */

import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";

import { hienSo } from "./trungThucDuLieu";
import type { KetQuaKpiNoi, SacThaiKpi } from "./kpiNoiLogic";

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ QA LẦN 11 · PH-31 — LỚP PHỦ KPI KHÔNG ĐƯỢC CHE LỜI KHAI CỦA SẢN PHẨM   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Chiều cao MỘT dòng của dải việc `DaiHopNhat`, px — **suy từ CSS đã build,
 * calibrate khớp số đo thật của QA lần 11**, không phải một con số ưa thích.
 *
 * `DaiHopNhat.veMuc()` vẽ mỗi dòng là `px-3 py-1 text-[11px]` + `border-t`
 * (dòng đầu `first:border-t-0`), icon `h-3.5` = 14 px:
 *   · `text-[11px]` chỉ đặt cỡ chữ; `line-height` thừa kế 1,5 của preflight
 *     ⇒ 11 × 1,5 = **16,5 px**, lớn hơn icon 14 px nên nó quyết chiều cao dòng;
 *   · `py-1` = 4 px × 2 = **8 px**;
 *   · viền = **1 px**.
 *   ⇒ 16,5 + 8 + 1 = **25,5 px**.
 *
 * ★ ĐỐI CHIẾU VỚI ẢNH THẬT `.qa-tapdoan/anh/AB-B7-qatd_giamdoc-tapdoan.png`
 *   (1600×900, 2 mục): lớp phủ chi tiết đo được **≈51 px** (y≈207→258) —
 *   2 × 25,5 = 51. Khớp.
 */
export const CAO_MOT_DONG_DAI_VIEC_PX = 25.5;

/**
 * ★★★ Bao nhiêu px trên cùng của khung cảnh phải CHỪA cho dải việc.
 *
 * `DaiHopNhat` vẽ phần MỞ của nó bằng `absolute inset-x-0 top-full z-30` — tức
 * nó **thả xuống ĐÈ lên khung cảnh**, đúng bằng chiều cao các dòng đang bật
 * (`gopDuoc`; dải AN TOÀN nằm TRONG dòng chảy nên không thả xuống, không tính).
 * Trong khi đó lớp phủ KPI neo `absolute left-2 top-2` **của khung cảnh** ⇒ hai
 * thứ dùng chung y ∈ [0, chiều cao dải]. Cùng `z-30`, và lớp phủ KPI đứng SAU
 * trong DOM nên nó thắng: **sản phẩm nói thật về hạn chế của mình rồi tự che**.
 *
 * Đo được (PH-31, ba ảnh vai giám đốc): lớp phủ `bang-kpi-noi` đè lên banner
 * *"326 machines are outside this load"* và lên cả hai dòng banner của
 * `?pv=tapdoan`, **cắt câu giải thích ở giữa** — 43 px chồng lấn.
 *
 * ⚠⚠ VÌ SAO CHỪA CẢ KHI DẢI ĐANG THU: trạng thái mở/đóng sống TRONG
 *   `DaiHopNhat` (`useState`), trang không đọc được nó, và nâng state ấy lên là
 *   sửa một tệp thuộc lô khác. Chừa theo SỐ MỤC ĐANG BẬT là bất biến hình học
 *   duy nhất trang tự biết chắc. Giá phải trả: khi dải đang thu, lớp phủ KPI
 *   nằm thấp hơn cần thiết `soMuc × 25,5` px — **thà thừa chỗ còn hơn che một
 *   câu nói thật**, và ca thường gặp nhất (`soMuc = 0`) chừa ĐÚNG 0 px.
 *
 * @param soMucGop Số mục đang bật trong nhóm GỘP (`tachAnToan(...).gopDuoc`).
 */
export function chuaChoDaiViec(soMucGop: number): number {
  if (!Number.isFinite(soMucGop) || soMucGop <= 0) return 0;
  return Math.ceil(soMucGop * CAO_MOT_DONG_DAI_VIEC_PX);
}

/**
 * Sắc thái → lớp Tailwind.
 *
 * ★★★ G29 — `THREE.Color` KHÔNG đọc `oklch()`: nó WARN rồi trả **trắng**, không
 *   ném lỗi. Các lớp dưới đây là màu **CSS của DOM**, không bao giờ đi vào
 *   three, nên chúng an toàn ở đây và CHỈ ở đây. Màu cho vật thể trong cảnh
 *   phải qua `mauThree.ts`/`byteMau.ts` (G12: đừng viết bản thứ hai).
 */
const LOP_SAC_THAI: Readonly<Record<SacThaiKpi, string>> = {
  trung_tinh: "text-foreground",
  tot: "text-emerald-600 dark:text-emerald-400",
  canh_bao: "text-amber-600 dark:text-amber-400",
  xau: "text-destructive",
};

export interface BangKpiNoiProps {
  /** Kết quả từ `tinhKpiNoi()` — tầng trang tính, ở đây chỉ VẼ (một nguồn, G12). */
  kpi: KetQuaKpiNoi;
  /**
   * `true` khi truy vấn đang tải / bị từ chối. Chuyền thẳng vào `hienSo` để ô
   * ra `—` chứ không phải `0` (NT-3.5). Cố ý nhận RIÊNG cờ này thay vì suy từ
   * `kpi`: `tinhKpiNoi(_, chuaDo)` đã trả null, và hai đường cùng nói một câu
   * thì đường nào cũng phải đúng.
   */
  dangTai?: boolean;
  /** Bảng đang mở? Trạng thái do tầng trang giữ (nó đi vào URL — §9.4). */
  mo: boolean;
  onDoiMo: (mo: boolean) => void;
  /**
   * Nhãn phạm vi đang đo, ví dụ `"FUYU-F · Tầng trệt"`. Hiện NGUYÊN VĂN.
   * ★ Một bảng KPI không nói mình đo cái gì là một bảng nói dối theo mặc định:
   *   người xem mặc định cho rằng nó đo TOÀN nhà máy, trong khi cảnh chỉ nạp
   *   một tầng (§11e.6 F3 — đúng lớp lỗi `?pv=tapdoan` đã mắc).
   */
  nhanPhamVi?: string | null;
}

export function BangKpiNoi({ kpi, dangTai = false, mo, onDoiMo, nhanPhamVi }: BangKpiNoiProps) {
  const { t } = useTranslation();

  return (
    /*
     * ★ `pointer-events-none`: canvas dưới phải nhận được drag xoay camera.
     *
     * ════════════════════════════════════════════════════════════════════════
     * ★★★ `z-30` — HAI KHUYẾT TẬT ĐO ĐƯỢC BẰNG ẢNH TỰ CHỤP, KHÔNG PHẢI SUY LUẬN
     * ════════════════════════════════════════════════════════════════════════
     * Bản đầu dùng `z-10` + `max-w-[min(20rem,60%)]`. Cả hai cổng (`check`,
     * `vitest`) đều XANH, và ảnh chụp trên trình duyệt thật bắt được hai lỗi mà
     * không assertion nào chạm tới:
     *
     *   1. NHÃN 3D ĐÈ LÊN SỐ. `LopNhan.tsx:180` render nhãn qua drei
     *      `<Html fullscreen zIndexRange={[20, 0]}>` ⇒ nhãn ở **z-index 20**.
     *      Với `z-10`, các dòng Maintenance/Offline/Running rate bị chuỗi
     *      "SIM-L2-ICT · Unknown" phủ kín — bảng KPI hiện ra nhưng ĐỌC KHÔNG
     *      ĐƯỢC, tức là hỏng đúng thứ yêu cầu #6 đòi.
     *   2. DÒNG CUỐI BỊ CẮT. Ở canvas 488 px, `60%` cho 196 px — hẹp hơn dòng
     *      "OEE measured on 0/41 machines", và chữ tràn ra ngoài mép bo góc.
     *
     * ⇒ `z-30` (trên nhãn 20, dưới các lớp modal của vỏ) và bề ngang tính theo
     *   `min-w` + `max-w` rộng hơn. Trần vẫn còn để bảng không nuốt cảnh.
     */
    <div
      /*
       * ★★★ HM-2(a) — BẢNG NÀY PHẢI CO THEO KHUNG. Trước bản vá `min-w-[13rem]` là một con số
       *   CỨNG bất kể khung nhìn, nên nó là lớp phủ **bất tương xứng duy nhất** của màn:
       *   đo được nó ăn **5,2 %** canvas @1920×1080 nhưng **13,8 %** @1280×720 — trong khi hai
       *   panel trái/phải đều co. Ở 1280, lớp phủ ăn 70,8 % canvas và chỉ **1/24** máy hỏng còn
       *   đọc được tên trên cảnh (`chip-ten-bi-che` khai 18 tên bị che).
       * ★ Co theo `min-w` + bậc chữ, KHÔNG giấu bớt dòng nào: đây là bảng CHỈ SỐ, mọi con số
       *   vẫn phải ở đó — thu hẹp khác với giấu.
       */
      className="pointer-events-none absolute left-2 top-2 z-30 w-max min-w-[9rem] max-w-[min(14rem,calc(100%-1rem))] lg:min-w-[11rem] lg:max-w-[min(17rem,calc(100%-1rem))] xl:min-w-[13rem] xl:max-w-[min(20rem,calc(100%-1rem))]"
      data-testid="bang-kpi-noi"
      /* ★ Đợt 35 (Pareto #5): lớp phủ ĐÈ canvas tự khai — `LopNhan` không vẽ nhãn dưới nó. */
      data-che-nhan="1"
      data-mo={mo ? "1" : "0"}
      data-mau-so={kpi.mauSo}
      data-mau-so-oee={kpi.mauSoOee}
    >
      <div className="rounded-md border bg-background/85 shadow-sm backdrop-blur-sm">
        {/* ── Đầu bảng: tên + mẫu số + nút thu/mở ───────────────────────── */}
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 xl:gap-2 xl:px-2 xl:py-1">
          <span className="text-xs font-semibold">{t("twin3d.kpiNoi.tieuDe", "Chỉ số")}</span>
          {/*
            ★ MẪU SỐ LUÔN HIỆN, kể cả khi bảng thu. "72 %" không có mẫu số là
              nửa sự thật — 72 % trên 1 máy và trên 42 máy là hai câu khác nhau.
          */}
          <span className="text-[11px] text-text-2" data-testid="kpi-mau-so">
            {/* ★ Đợt 36: `count` ⇒ `mauSo_one`/`mauSo_other` (en) — "1 machines" là lỗi cùng lớp với `DaiLine`. */}
            {t("twin3d.kpiNoi.mauSo", "{{n}} máy", {
              n: hienSo(kpi.mauSo || null, dangTai),
              ...(kpi.mauSo && !dangTai ? { count: kpi.mauSo } : {}),
            })}
          </span>
          <button
            type="button"
            /* ★ Bật lại con trỏ cho RIÊNG nút — khung ngoài đã tắt. */
            className="pointer-events-auto ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2"
            data-testid="nut-thu-kpi"
            aria-expanded={mo}
            aria-controls="than-bang-kpi"
            aria-label={
              mo
                ? t("twin3d.kpiNoi.thu", "Thu bảng chỉ số")
                : t("twin3d.kpiNoi.mo", "Mở bảng chỉ số")
            }
            title={
              mo
                ? t("twin3d.kpiNoi.thu", "Thu bảng chỉ số")
                : t("twin3d.kpiNoi.mo", "Mở bảng chỉ số")
            }
            onClick={() => onDoiMo(!mo)}
          >
            {mo ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/*
          ★ `hidden` chứ không unmount: giữ cây React để mở lại tức thì, và để
            trạng thái `data-*` phía trên vẫn đo được khi bảng đang thu.
        */}
        <div id="than-bang-kpi" className="border-t px-1.5 py-1 xl:px-2 xl:py-1.5" hidden={!mo}>
          {nhanPhamVi ? (
            <p className="mb-1 truncate text-[11px] text-text-2" data-testid="kpi-pham-vi">
              {nhanPhamVi}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-2 gap-y-0 text-[11px] leading-tight xl:gap-x-3 xl:gap-y-0.5 xl:text-xs">
            {kpi.o.map((x) => (
              <div key={x.khoa} className="contents">
                <dt className="truncate text-muted-foreground">
                  {t(`twin3d.kpiNoi.o.${x.khoa}`, x.khoa)}
                </dt>
                <dd
                  className={`text-right font-medium tabular-nums ${LOP_SAC_THAI[x.sacThai]}`}
                  data-testid={`kpi-${x.khoa}`}
                  data-sac-thai={x.sacThai}
                >
                  {hienSo(x.giaTri, dangTai)}
                  {/*
                    ★ Đơn vị CHỈ hiện khi có số. "— %" đọc như một phép đo đã
                      xong mà ra rỗng; "—" trơn nói đúng điều đang xảy ra.
                  */}
                  {x.donVi !== null && !dangTai && x.giaTri !== null ? (
                    <span className="ml-0.5 text-[10px] text-text-2">{x.donVi}</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>

          {/*
            ★★★ MẪU SỐ RIÊNG CỦA OEE — không gộp vào mẫu số chung.
            Đo được trên DB này (2026-09-07): `oeePercent` null cho MỌI máy, nên
            dòng này in "0/42". Nó là lời giải thích cho ô OEE đang hiện `—`, và
            thiếu nó thì `—` trông như một lỗi tải trang.
          */}
          {/* ★ `break-words`: dòng này DÀI nhất bảng và từng bị cắt ở mép (xem
              docblock `z-30` phía trên). Xuống dòng còn đọc được; tràn thì không. */}
          <p
            className="mt-1 break-words text-[10px] leading-tight text-text-2"
            data-testid="kpi-mau-so-oee"
          >
            {t("twin3d.kpiNoi.mauSoOee", "OEE đo được trên {{co}}/{{tong}} máy", {
              co: kpi.mauSoOee,
              tong: kpi.mauSo,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
