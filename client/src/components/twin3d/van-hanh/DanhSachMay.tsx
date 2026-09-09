/**
 * DanhSachMay.tsx — danh sách máy ở panel trái. **§9.9 — BẮT BUỘC, KHÔNG PHẢI
 * TUỲ CHỌN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO NÓ TỒN TẠI: CANVAS 3D VÔ HÌNH VỚI TRÌNH ĐỌC MÀN HÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Một `<canvas>` WebGL không có cây DOM bên trong — trình đọc màn hình thấy MỘT
 * ô trống, và bàn phím không có gì để Tab vào. Nếu chọn máy chỉ làm được bằng
 * cách click lên canvas thì người dùng bàn phím và người khiếm thị **mất hoàn
 * toàn** đường xử lý công việc, không phải mất một tính năng phụ.
 *
 * ⇒ Danh sách này là DOM THẬT: mỗi máy một `<button>`, bàn phím tới được, Enter
 *   chọn được, focus ring rõ. Selection ở đây và selection trên 3D là **CÙNG
 *   MỘT state** ở `TwinVanHanh` — đồng bộ hai chiều, không phải hai bản sao.
 *
 * ★ Và vì `NganXuLy` mở theo selection, đường
 *      **(vào danh sách) → Enter → (ngăn mở) → Tab → Enter trên nút Xác nhận**
 *   là một đường ack alarm KHÔNG đi qua WebGL một bước nào. Đó chính là phép đo
 *   §9.9 mà cổng ra số 5 yêu cầu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NT-3 — DANH SÁCH PHẢI NÓI CÙNG MỘT CÂU VỚI CẢNH 3D
 * ════════════════════════════════════════════════════════════════════════════
 * `trangThaiTheoMay` truyền vào ĐÃ qua `trangThaiHienThi()`, nên một máy khai
 * `running` với dữ liệu hai tháng tuổi hiện là "Không rõ" ở ĐÂY y như trên cảnh.
 * Nếu danh sách đọc `operationStatus` thô, hai bề mặt sẽ nói hai câu khác nhau
 * về cùng một máy — và bảng chữ luôn được tin hơn một ô màu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 10 LÔ H1 — ẢO HOÁ, VÀ VÌ SAO NÓ BUỘC PHẢI ĐỔI KHUÔN BÀN PHÍM
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trước (lô E, `DanhSachMay.tsx:109`, tải FUYU-F 549 máy): `.map()` toàn
 * mảng ⇒ **549 `<li>` thật trong DOM**, một lần gõ bộ lọc **263 ms**.
 *
 * ⚠⚠ **ẢO HOÁ MỘT DANH SÁCH MỖI Ô MỘT `tabIndex` LÀ MỘT BẢN VÁ PHÁ A11Y.**
 *   Nếu chỉ cắt mảng mà giữ nguyên "mỗi máy một `<button>` Tab tới được", thì
 *   máy thứ 400 **không tồn tại trong DOM** ⇒ Tab KHÔNG BAO GIỜ tới nó. Người
 *   dùng bàn phím mất 449/549 máy mà **không lỗi nào nổ, không test nào đỏ** —
 *   đúng lớp "cổng xanh mà không đo gì" (họ G5/G6). Bản vá hiệu năng khi đó
 *   **nguy hiểm hơn thứ nó vá**.
 *
 * ⇒ Nên bản này chuyển sang **đúng khuôn ARIA mà docblock cũ đã tự khai nhưng
 *   mã cũ KHÔNG cài**: `role="listbox"` + **một điểm dừng Tab duy nhất** +
 *   `aria-activedescendant` + điều hướng bằng phím mũi tên / Home / End /
 *   PageUp / PageDown. Khuôn này **độc lập với việc ô có được render hay
 *   không**: chỉ số con trỏ chạy trên MẢNG ĐÃ LỌC (549 phần tử), không chạy
 *   trên DOM (~20 phần tử). Di chuyển tới máy 400 thì cửa sổ ảo cuộn tới đó.
 *
 * ★ `aria-setsize` / `aria-posinset` trên từng `<li>`: nếu không có, trình đọc
 *   màn hình đếm **các ô ĐANG render** và đọc "mục 3 trên 20" khi thật ra là
 *   "mục 403 trên 549" — một lời khai sai về thế giới, đúng thứ NT-3 cấm.
 *
 * ★ Dùng lại `computeVirtualWindow` của `DataTable.tsx:289` — hàm THUẦN đã có
 *   `dataTableVirtual.unit.test.ts` canh (9 ca, gồm rowCount=0 và scrollTop âm).
 *   Viết bản thứ hai của cùng phép toán là dựng **bản sao thứ hai của một bảng
 *   dữ liệu** (họ G6): hai bản sẽ lệch, và bản không có test sẽ lệch trước.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { computeVirtualWindow } from "@/components/DataTable";
import { giaiMauCanh, mauChoTrangThai } from "../mauTrangThai";
import { nhanDoTuoi, nhanTuoiDocDuoc, type MayVanHanh } from "./trungThucDuLieu";

/**
 * Chiều cao MỘT hàng, px. Phải khớp với chiều cao thật mà CSS cho ra, nếu
 * không thanh cuộn nói dối: `py-1` (2×4px) + `text-xs`/`leading-4` (16px) = 24px.
 *
 * ⚠ Con số này là một HỢP ĐỒNG với `className` của `<button>` bên dưới. Đổi
 *   `py-1` mà quên đổi đây thì danh sách trôi dần khi cuộn — và không gì nổ.
 *   `caoHangDo.dom.test.tsx` đo chiều cao THẬT của một hàng và so với hằng này.
 */
export const CAO_HANG_PX = 24;

/**
 * Ngưỡng bật ảo hoá. Dưới ngưỡng, render thẳng — một danh sách 43 máy (DB thật)
 * không cần spacer, và không ảo hoá giữ DOM đơn giản nhất có thể cho ca thường.
 *
 * ★ Ngưỡng KHÔNG lấy từ ngân sách §4 (`≤30 nhãn CSS2D`). Đó là bài toán KHÁC:
 *   nhãn CSS2D là 30 phần tử được **đặt lại vị trí mỗi khung hình** bởi vòng
 *   render 3D; `<li>` ở đây chỉ bị đụng tới khi lọc/cuộn. Suy từ 30 sang đây là
 *   đúng lớp lỗi "mượn con số của phép đo khác" — nên ngưỡng này đo riêng.
 */
export const NGUONG_AO_HOA = 60;

/** Số hàng render thêm ngoài khung nhìn ở mỗi đầu — chống nháy khi cuộn nhanh. */
const DU_TRU = 8;

export interface DanhSachMayProps {
  may: readonly MayVanHanh[];
  /** Trạng thái ĐÃ xét tuổi — cùng nguồn với cảnh 3D. */
  trangThaiTheoMay: ReadonlyMap<number, string>;
  machineIdChon: number | null;
  onChonMay: (machineId: number) => void;
  bayGio: number;
  dangTai: boolean;
  /**
   * Chiều cao khung cuộn, px — CHỈ để test bơm số vào. jsdom trả
   * `clientHeight = 0` cho mọi phần tử (không có layout engine), nên nếu phép
   * đo chỉ dựa vào `clientHeight` thì trong test cửa sổ ảo luôn rỗng và mọi
   * assertion về nội dung sẽ đo **hư không** — cổng xanh trên tập rỗng (G5).
   */
  caoKhungTest?: number;
}

export function DanhSachMay({
  may,
  trangThaiTheoMay,
  machineIdChon,
  onChonMay,
  bayGio,
  dangTai,
  caoKhungTest,
}: DanhSachMayProps) {
  const { t } = useTranslation();
  const [loc, setLoc] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [caoKhung, setCaoKhung] = useState(caoKhungTest ?? 0);
  const khungRef = useRef<HTMLUListElement | null>(null);

  const hienThi = useMemo(() => {
    const q = loc.trim().toLowerCase();
    const ds = q
      ? may.filter((m) => m.ma.toLowerCase().includes(q) || m.ten.toLowerCase().includes(q))
      : [...may];
    /**
     * Sắp: BẤT THƯỜNG trước, rồi "không rõ", rồi theo mã.
     * Máy cần chú ý phải ở đầu danh sách — người dùng bàn phím đi từ trên
     * xuống, nên thứ tự này quyết định họ gặp việc gấp sau mấy lần bấm.
     */
    return ds.sort((a, b) => {
      const ta = trangThaiTheoMay.get(a.id) ?? "khong_ro";
      const tb = trangThaiTheoMay.get(b.id) ?? "khong_ro";
      const wa = mauChoTrangThai(ta).laBatThuong ? 0 : ta === "khong_ro" ? 1 : 2;
      const wb = mauChoTrangThai(tb).laBatThuong ? 0 : tb === "khong_ro" ? 1 : 2;
      if (wa !== wb) return wa - wb;
      return a.ma.localeCompare(b.ma);
    });
  }, [may, loc, trangThaiTheoMay]);

  /**
   * Con trỏ bàn phím — CHỈ SỐ trong `hienThi`, không phải `machineId`. Nó phải
   * là chỉ số vì `aria-activedescendant` cần trỏ tới một ô có thật trong DOM,
   * và cửa sổ ảo cuộn theo chỉ số.
   */
  const [conTro, setConTro] = useState(0);

  /* Lọc đổi ⇒ danh sách đổi ⇒ con trỏ cũ trỏ vào máy khác. Về đầu và cuộn về
     đầu: giữ nguyên chỉ số sau khi lọc là để con trỏ "nhảy" sang một máy người
     dùng không chọn. */
  useEffect(() => {
    setConTro(0);
    setScrollTop(0);
    if (khungRef.current) khungRef.current.scrollTop = 0;
  }, [loc]);

  /* Con trỏ không được ra ngoài mảng khi dữ liệu co lại (máy bị gỡ khỏi phạm vi). */
  const conTroAnToan = hienThi.length === 0 ? 0 : Math.min(conTro, hienThi.length - 1);

  /**
   * Đo chiều cao khung THẬT. `ResizeObserver` chứ không phải một hằng: panel
   * trái co giãn theo cửa sổ, và một hằng sai chỉ sai ở máy có màn khác — tức
   * là không ai thấy cho tới khi người dùng thấy.
   */
  useLayoutEffect(() => {
    if (caoKhungTest != null) return;
    const el = khungRef.current;
    if (!el) return;
    const doLai = () => setCaoKhung(el.clientHeight);
    doLai();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(doLai);
    ro.observe(el);
    return () => ro.disconnect();
  }, [caoKhungTest]);

  const aoHoa = hienThi.length > NGUONG_AO_HOA && caoKhung > 0;

  const cuaSo = useMemo(
    () =>
      aoHoa
        ? computeVirtualWindow({
            scrollTop,
            viewportHeight: caoKhung,
            rowHeight: CAO_HANG_PX,
            rowCount: hienThi.length,
            overscan: DU_TRU,
          })
        : { startIndex: 0, endIndex: hienThi.length, paddingTop: 0, paddingBottom: 0 },
    [aoHoa, scrollTop, caoKhung, hienThi.length],
  );

  const veHang = hienThi.slice(cuaSo.startIndex, cuaSo.endIndex);

  /**
   * Kéo một chỉ số vào tầm nhìn. Đây là mảnh nối giữa "con trỏ chạy trên mảng"
   * và "DOM chỉ có ~20 ô": không có nó, mũi tên xuống tới máy thứ 30 sẽ đổi
   * `aria-activedescendant` sang một `id` **không tồn tại trong DOM**, và trình
   * đọc màn hình im lặng — lại một lời khai sai mà không gì nổ.
   */
  const keoVaoTam = useCallback(
    (i: number) => {
      const el = khungRef.current;
      if (!el) return;
      const cao = caoKhungTest ?? el.clientHeight;
      const tren = i * CAO_HANG_PX;
      const duoi = tren + CAO_HANG_PX;
      if (tren < el.scrollTop) el.scrollTop = tren;
      else if (duoi > el.scrollTop + cao) el.scrollTop = duoi - cao;
      setScrollTop(el.scrollTop);
    },
    [caoKhungTest],
  );

  const diChuyen = useCallback(
    (toi: number) => {
      if (hienThi.length === 0) return;
      const i = Math.min(Math.max(0, toi), hienThi.length - 1);
      setConTro(i);
      keoVaoTam(i);
    },
    [hienThi.length, keoVaoTam],
  );

  const onPhim = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      const buoc = Math.max(1, Math.floor((caoKhungTest ?? caoKhung) / CAO_HANG_PX) - 1);
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          diChuyen(conTroAnToan + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          diChuyen(conTroAnToan - 1);
          break;
        case "Home":
          e.preventDefault();
          diChuyen(0);
          break;
        case "End":
          e.preventDefault();
          diChuyen(hienThi.length - 1);
          break;
        case "PageDown":
          e.preventDefault();
          diChuyen(conTroAnToan + buoc);
          break;
        case "PageUp":
          e.preventDefault();
          diChuyen(conTroAnToan - buoc);
          break;
        case "Enter":
        case " ":
          // ★ Enter/Space CHỌN — đây là bước đầu của đường ack alarm §9.9.
          if (hienThi[conTroAnToan]) {
            e.preventDefault();
            onChonMay(hienThi[conTroAnToan].id);
          }
          break;
        default:
          return;
      }
    },
    [caoKhung, caoKhungTest, conTroAnToan, diChuyen, hienThi, onChonMay],
  );

  const idOChon = hienThi[conTroAnToan] ? `may-oo-${hienThi[conTroAnToan].id}` : undefined;

  return (
    // ★ ĐỢT 22 — `basis-0` thêm vào: không có nó, một anh em flex khác được cấp
    //   chiều cao NỘI DUNG trước và khối này còn 0 px. Đo được: dải cảnh báo
    //   (27 hàng) lấy 715/849 px và danh sách máy về **h=0**; ablation xác nhận
    //   nguyên nhân. Xem docblock chỗ bọc dải cảnh báo ở `TwinVanHanh.tsx`.
    <div className="flex min-h-0 flex-1 basis-0 flex-col" data-testid="danh-sach-may">
      <div className="shrink-0 p-2">
        <Input
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          placeholder={t("twin3d.cay.loc", "Lọc theo tên hoặc mã…")}
          className="h-7 text-xs"
          data-testid="o-loc-may"
          aria-label={t("twin3d.cay.loc", "Lọc theo tên hoặc mã…")}
        />
      </div>

      {/*
        `role="listbox"` + `aria-activedescendant` là khuôn ARIA đúng cho một
        danh sách CHỌN ĐƯỢC (khác `list`, vốn chỉ để đọc) — VÀ là khuôn duy nhất
        sống được cùng ảo hoá: một điểm dừng Tab, con trỏ chạy trên MẢNG.
      */}
      <ul
        ref={khungRef}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        role="listbox"
        tabIndex={0}
        aria-label={t("twin3d.vanHanh.danhSachMay", "Danh sách máy")}
        aria-activedescendant={idOChon}
        onKeyDown={onPhim}
        onScroll={(e) => setScrollTop((e.currentTarget as HTMLUListElement).scrollTop)}
        data-so-may={hienThi.length}
        data-ao-hoa={aoHoa ? "1" : "0"}
        data-so-hang-ve={dangTai || hienThi.length === 0 ? 0 : veHang.length}
      >
        {dangTai ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">—</li>
        ) : hienThi.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted-foreground" data-testid="danh-sach-rong">
            {t("twin3d.cay.khongKhop", "Không có mục nào khớp")}
          </li>
        ) : (
          <>
            {/*
              Đệm TRÊN — giữ thanh cuộn trung thực. `aria-hidden` + `role="none"`:
              nếu để nguyên `<li>` trong một `listbox`, trình đọc màn hình đếm nó
              là MỘT MỤC và tổng số mục sai đi 1–2.
            */}
            {cuaSo.paddingTop > 0 && (
              <li aria-hidden="true" role="none" style={{ height: cuaSo.paddingTop }} />
            )}
            {veHang.map((m, k) => {
              const viTri = cuaSo.startIndex + k;
              const tt = trangThaiTheoMay.get(m.id) ?? "khong_ro";
              const kieu = mauChoTrangThai(tt);
              const mau = giaiMauCanh(kieu.token) ?? "#94a3b8";
              const tuoi = nhanDoTuoi(m.thoiDiemDuLieu, bayGio);
              const daChon = m.id === machineIdChon;
              const duoiConTro = viTri === conTroAnToan;
              return (
                <li
                  key={m.id}
                  id={`may-oo-${m.id}`}
                  role="option"
                  aria-selected={daChon}
                  /*
                   * ★ `aria-setsize`/`aria-posinset` — BẮT BUỘC khi ảo hoá.
                   *   Không có chúng, trình đọc màn hình đếm các ô ĐANG render
                   *   ("mục 3 trên 20") thay vì vị trí thật ("mục 403 trên 549").
                   */
                  aria-setsize={hienThi.length}
                  aria-posinset={viTri + 1}
                  style={{ height: CAO_HANG_PX }}
                >
                  <button
                    type="button"
                    /*
                     * `tabIndex={-1}` — MỘT điểm dừng Tab cho cả danh sách, ở
                     * `<ul>`. Để mỗi nút tự nhận Tab thì ở 549 máy người dùng
                     * bàn phím phải bấm Tab 549 lần để ra khỏi panel, và các ô
                     * chưa render **không bao giờ** tới lượt.
                     */
                    tabIndex={-1}
                    data-testid={`may-hang-${m.id}`}
                    data-trang-thai={tt}
                    data-vi-tri={viTri}
                    className={`flex h-full w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                      daChon ? "bg-accent font-medium" : "hover:bg-accent/60"
                    } ${duoiConTro ? "outline outline-2 outline-offset-[-2px] outline-ring" : ""}`}
                    onClick={() => {
                      setConTro(viTri);
                      onChonMay(m.id);
                    }}
                  >
                    {/*
                      Chấm màu + HOẠ TIẾT — mã hoá dư thừa (§10.3 luật 2). Chỉ màu
                      là không đủ: mù màu đỏ-lục là ~8 % nam giới.
                    */}
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: mau,
                        opacity: kieu.doMo,
                        // Gạch chéo cho `khong_ro` — vòng ngoài rỗng thay vì đặc.
                        boxShadow:
                          kieu.hoaTiet === "gach_cheo" ? `inset 0 0 0 1px ${mau}` : undefined,
                        backgroundImage:
                          kieu.hoaTiet === "gach_cheo"
                            ? `repeating-linear-gradient(45deg, transparent 0 1px, ${mau} 1px 2px)`
                            : undefined,
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{m.ma}</span>
                    {/* Chữ trạng thái — chiều thứ ba của mã hoá dư thừa. */}
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {t(kieu.khoaNhan)}
                    </span>
                    {/*
                      ★ NT-3.5 — máy chưa từng báo cáo hiện `—`, KHÔNG hiện `0s`.
                      "0 giây trước" nghĩa là vừa cập nhật — đúng ngược sự thật.
                      ★★★ ĐỢT 36 (Pareto #8) — TUỔI ĐỌC ĐƯỢC, KHÔNG GIÂY SỐNG. QA Đợt 32/34 đo ô này in
                        **"4733902s"** (= 54 ngày) trên 39/42 máy, cạnh `NganXuLy` in "54 days" cho CÙNG
                        máy. Uỷ thác cho `nhanTuoiDocDuoc` (một chỗ, nay BA người gọi — G12: không viết
                        bộ định dạng thứ hai); số THÔ giữ ở `data-giay` cho thiết bị đo (NhanDoTuoi doc).
                    */}
                    <span
                      className={`min-w-10 shrink-0 whitespace-nowrap text-right text-[10px] ${tuoi.do ? "text-destructive" : "text-muted-foreground"}`}
                      data-testid={`tuoi-${m.id}`}
                      data-giay={tuoi.giay ?? undefined}
                    >
                      {nhanTuoiDocDuoc(tuoi, t)}
                    </span>
                  </button>
                </li>
              );
            })}
            {/* Đệm DƯỚI — cùng lý do với đệm trên. */}
            {cuaSo.paddingBottom > 0 && (
              <li aria-hidden="true" role="none" style={{ height: cuaSo.paddingBottom }} />
            )}
          </>
        )}
      </ul>
    </div>
  );
}

export default DanhSachMay;
