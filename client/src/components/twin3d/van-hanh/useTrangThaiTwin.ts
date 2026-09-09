/**
 * `useTrangThaiTwin` — T-3 của §15.5.2: **vỏ React** quanh `duongDanTwin.ts`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO HOOK NÀY TỒN TẠI — QĐ-19 CHỨ KHÔNG PHẢI "CHO GỌN"
 * ════════════════════════════════════════════════════════════════════════════
 * QĐ-19 (§14p) chốt **BA MÀN RIÊNG**, mỗi màn **một `<Canvas>`**: `/twin` (nhà
 * máy) · `/twin/line/:id` · `/twin/may/:id`. Ba màn ấy **dùng chung** các mảnh
 * đọc/dẫn xuất. Nghĩa là một mảnh dùng chung **không được tự đọc route của
 * trang cha** — nó không biết mình đang đứng trên route nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G37 — MÀN TỰ ĐỌC ROUTE HỎNG **CÂM** KHI ĐẶT NGOÀI ROUTE CỦA NÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Tiền lệ đo được trong chính dự án này: `RobotCockpit` / `StationAnalysis` gọi
 * `useRoute("/…/:id")` ở thân component. Nhúng chúng vào một trang khác thì
 * `useRoute` **không khớp**, `id` thành `NaN`, và **không exception nào nổ** —
 * màn chỉ hiện rỗng. `tsc` xanh, unit test xanh, người dùng thấy trang trắng.
 *
 * ⇒ Hook này **KHÔNG gọi `useSearch()`/`useRoute()`**. Nó **nhận** `search` và
 *   `dieuHuong` qua tham số. Trang cha — thứ DUY NHẤT biết mình ở route nào —
 *   là nơi gọi `useSearch()`. Mọi mảnh dưới nó nhận qua prop.
 *
 * ⚠ Đây là bất biến, không phải sở thích. Nếu ai đó thêm `useSearch()` vào tệp
 *   này, ba màn sẽ cùng chạy nhưng **hai trong ba đọc sai query của màn kia**,
 *   và lớp lỗi đó **không nổ** — nó chỉ hiện sai.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ `window.location` — ĐỌC TẠI THỜI ĐIỂM GHI, CÓ CHỦ Ý
 * ════════════════════════════════════════════════════════════════════════════
 * `ghiUrl`/`ghiXem`/`doiThu` đọc `window.location.search` **tại lúc gọi** chứ
 * không đóng gói (`closure`) giá trị `search` của lần render. Đó là hành vi
 * NGUYÊN BẢN của `TwinVanHanh.tsx` (`:317`, `:351`, `:2270`) và phải giữ:
 * `tronTrangThaiUrl` **hợp nhất** thay đổi vào query hiện có, nên đọc bản cũ
 * của một render trước sẽ **xoá mất** thay đổi vừa ghi bởi một handler khác
 * trong cùng một tick. Giữ nguyên = giữ hành vi (G5/G32).
 *
 * `pathname` cũng đọc từ `window.location` ⇒ hook giữ nguyên route đang đứng.
 * Đây chính là thứ làm nó dùng được cho **cả ba màn** mà không cần biết tên
 * route: ghi query trên `/twin/line/2` ở lại `/twin/line/2`.
 */

import { useCallback, useMemo } from "react";

import {
  docTrangThaiUrl,
  kieuGhiLichSu,
  tronTrangThaiUrl,
  type PhamVi,
  type ThayDoiTwinUrl,
  type TrangThaiTwinUrl,
} from "./duongDanTwin";
import {
  docXemTuQuery,
  tronXemVaoQuery,
  type NganNhungMo,
} from "./nhungTaiCho";

/**
 * Cách trang cha điều hướng. Chính là `setLocation` của `useLocation()` —
 * nhận qua tham số để hook không phải gọi `useLocation()` (xem G37 ở trên).
 */
export type DieuHuongTwin = (url: string) => void;

export interface TrangThaiTwin {
  /** Trạng thái đã phân giải từ query — `pv`, `chon`, `cam`, `lop`, `tg`, `thu`, `nap`. */
  urlState: TrangThaiTwinUrl;
  /** Ngăn chi tiết tại chỗ (`?xem=machine:42`), `null` khi không mở. */
  nganNhung: NganNhungMo | null;
  /** Ghi thay đổi vào query. `push` khi đổi phạm vi/chọn, `replace` khi xoay camera. */
  ghiUrl: (thayDoi: ThayDoiTwinUrl) => void;
  /** Mở/đóng ngăn chi tiết. `null` = đóng. Luôn `push` ⇒ Back đóng ngăn. */
  ghiXem: (ngan: NganNhungMo | null) => void;
  /** Đổi phạm vi cảnh (`pv`). */
  doiPhamVi: (pv: PhamVi) => void;
  /** Bật/tắt một panel thu được (`thu`). Đọc lại query hiện tại trước khi đảo. */
  doiThu: (ten: string) => void;
}

/**
 * @param search  query string của trang **cha** (`useSearch()` gọi ở trang cha).
 * @param dieuHuong  `setLocation` của trang cha.
 */
export function useTrangThaiTwin(
  search: string,
  dieuHuong: DieuHuongTwin,
): TrangThaiTwin {
  const urlState = useMemo(() => docTrangThaiUrl(search), [search]);
  const nganNhung = useMemo(() => docXemTuQuery(search), [search]);

  const ghiUrl = useCallback(
    (thayDoi: ThayDoiTwinUrl) => {
      const qs = tronTrangThaiUrl(window.location.search, thayDoi);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (kieuGhiLichSu(thayDoi) === "push") dieuHuong(url);
      else window.history.replaceState(null, "", url);
    },
    [dieuHuong],
  );

  const ghiXem = useCallback(
    (ngan: NganNhungMo | null) => {
      const qs = tronXemVaoQuery(window.location.search, ngan);
      dieuHuong(`${window.location.pathname}${qs ? `?${qs}` : ""}`);
    },
    [dieuHuong],
  );

  const doiPhamVi = useCallback((pv: PhamVi) => ghiUrl({ phamVi: pv }), [ghiUrl]);

  const doiThu = useCallback(
    (ten: string) => {
      const hienTai = docTrangThaiUrl(window.location.search).thu;
      const moi = hienTai.includes(ten) ? hienTai.filter((x) => x !== ten) : [...hienTai, ten];
      ghiUrl({ thu: moi });
    },
    [ghiUrl],
  );

  return { urlState, nganNhung, ghiUrl, ghiXem, doiPhamVi, doiThu };
}
