/**
 * nhanSaBan2D.ts — cho **bản 2D** biết lớp phủ DOM đang nằm ở đâu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO BẢN 2D CẦN PIXEL, TRONG KHI NÓ VẼ BẰNG MÉT
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhVanHanh2D` vẽ trong hệ toạ độ MÔ HÌNH (mét) và để `viewBox` co giãn.
 * Lớp phủ che nhãn (`panel-trai`, thẻ `Metrics`, dải trạng thái…) thì lại nằm ở
 * hệ PIXEL của trang. Không bắc cầu giữa hai hệ ấy thì cảnh 2D **không thể** biết
 * nhãn của nó có đọc được hay không — và đo được ở khung mặc định 1280×720,
 * KHÔNG thu panel (`.qa-tapdoan/n1-truoc.json`), hậu quả là:
 *
 *   qatd_quanly   "Công ty A" ← `SPAN#co-che-giao-so` phủ **123 %** ⇒ 0/1
 *   qatd_congnhan "Công ty C" ← cùng lớp phủ ấy                    ⇒ 0/1
 *   qatd_kythuat  "Công ty A" ← `DIV#panel-trai` 90,6 %
 *                 "Công ty B" ← `DIV#panel-phai` 89,4 %             ⇒ 0/2
 *
 * ⇒ Ba trong bốn vai **không đọc được tên công ty nào**. Cầu nối là hook này:
 *   đo hộp pixel của `<svg>`, dựng lại đúng phép ánh xạ `preserveAspectRatio`
 *   mặc định (`xMidYMid meet`), đọc vùng cấm bằng CHÍNH `layVungCam()` mà bản 3D
 *   dùng, chọn chỗ bằng CHÍNH `datNhanSaBan()` mà bản 3D dùng, rồi đổi kết quả
 *   ngược về mét cho `<text>`.
 *
 * ★ Trả về ĐỘ DỜI (`dx/dy`), không phải toạ độ tuyệt đối. Lý do đo được: `getBBox()`
 *   bỏ qua `transform` của CHÍNH phần tử, nên hộp chữ đo được giữ nguyên sau khi
 *   đã dời ⇒ vòng "đo → dời → đo lại" hội tụ ngay lượt hai thay vì dao động.
 *
 * ★ Thiếu bố cục (jsdom, hoặc `<svg>` chưa có kích thước) ⇒ trả kết quả RỖNG:
 *   nhãn giữ nguyên neo mặc định và **không ai bị ẩn** (G8). Lưới DOM hiện có đi
 *   đúng đường này, nên chúng không phải đổi một dòng.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";

import { layVungCam, THUOC_TINH_CHE_NHAN } from "../loi/LopNhan";
import { taoBoNgheDoiCho } from "../loi/theoDoiDoiCho";
import { datNhanSaBan, type HopNhanPx, type UuTienNhan } from "./datNhanSaBan";

/** Một nhãn cần đặt: hộp của thứ nó gọi tên, trong hệ toạ độ MÔ HÌNH. */
export interface MucNhan2D {
  khoa: string;
  hopMo: HopNhanPx;
  uuTien: UuTienNhan;
}

export interface KetQuaNhan2D {
  /** Khoá → độ dời (mét) so với neo mặc định. Vắng mặt = giữ nguyên neo. */
  doi: ReadonlyMap<string, { dx: number; dy: number }>;
  /** Khoá của nhãn KHÔNG còn chỗ nào đọc được ⇒ màn phải ẩn **và đếm ra**. */
  an: ReadonlySet<string>;
  dem: { ve: number; an: number; tong: number };
}

const RONG: KetQuaNhan2D = { doi: new Map(), an: new Set(), dem: { ve: 0, an: 0, tong: 0 } };

/** Hai kết quả có như nhau không — chặn vòng `setState` vô hạn. */
function giongNhau(a: KetQuaNhan2D, b: KetQuaNhan2D): boolean {
  if (a.dem.ve !== b.dem.ve || a.dem.an !== b.dem.an || a.dem.tong !== b.dem.tong) return false;
  if (a.doi.size !== b.doi.size || a.an.size !== b.an.size) return false;
  for (const k of a.an) if (!b.an.has(k)) return false;
  for (const [k, v] of a.doi) {
    const w = b.doi.get(k);
    if (!w || Math.abs(w.dx - v.dx) > 1e-6 || Math.abs(w.dy - v.dy) > 1e-6) return false;
  }
  return true;
}

/**
 * @param svgRef  `<svg>` của cảnh 2D — gốc toạ độ pixel và cũng là khung cắt vùng cấm
 * @param nhanRef khoá → phần tử `<text>` (để đo hộp chữ bằng `getBBox()`)
 * @param muc     danh sách nhãn cần đặt
 * @param oNhin   `viewBox` đang dùng, theo mét
 */
export function useDatNhanSaBan2D(
  svgRef: RefObject<SVGSVGElement | null>,
  nhanRef: MutableRefObject<Map<string, SVGTextElement | null>>,
  muc: readonly MucNhan2D[],
  oNhin: { x: number; y: number; rong: number; sau: number },
): KetQuaNhan2D {
  const [ketQua, datKetQua] = useState<KetQuaNhan2D>(RONG);
  const mucRef = useRef(muc);
  mucRef.current = muc;
  const oNhinRef = useRef(oNhin);
  oNhinRef.current = oNhin;

  const tinhLai = useCallback(() => {
    const svg = svgRef.current;
    const ds = mucRef.current;
    const o = oNhinRef.current;
    if (!svg || ds.length === 0) {
      datKetQua((cu) => (cu === RONG ? cu : RONG));
      return;
    }
    const r = svg.getBoundingClientRect();
    // Chưa có bố cục ⇒ GIỮ NGUYÊN, không ẩn ai (G8). jsdom luôn rơi vào đây.
    if (!(r.width > 0) || !(r.height > 0) || !(o.rong > 0) || !(o.sau > 0)) return;
    const s = Math.min(r.width / o.rong, r.height / o.sau);
    if (!(s > 0) || !Number.isFinite(s)) return;
    const tx = (r.width - o.rong * s) / 2 - o.x * s;
    const ty = (r.height - o.sau * s) / 2 - o.y * s;
    const vungCam = layVungCam(svg);
    const khung = { rong: r.width, cao: r.height };

    const doi = new Map<string, { dx: number; dy: number }>();
    const an = new Set<string>();
    let ve = 0;
    /*
     * ★★★ NHÃN ĐÃ ĐẶT CŨNG LÀ VÙNG CẤM — cùng luật với bản 3D, cùng lý do đo được:
     *   cứu được nhiều nhãn hơn nghĩa là thả nhiều chữ hơn vào cùng một khoảng
     *   trống, và thứ bị đè đầu tiên chính là cái tên công ty. `muc` được người
     *   gọi xếp CỤM TRƯỚC, TOÀ SAU, nên tên công ty giữ chỗ trước.
     */
    const daDat: HopNhanPx[] = [];
    for (const m of ds) {
      const el = nhanRef.current.get(m.khoa);
      if (!el) continue;
      let bb: { x: number; y: number; width: number; height: number } | null = null;
      try {
        bb = el.getBBox();
      } catch {
        bb = null;
      }
      const co = bb ? { rong: bb.width * s, cao: bb.height * s } : { rong: 0, cao: 0 };
      const hopPx: HopNhanPx = {
        trai: tx + m.hopMo.trai * s,
        phai: tx + m.hopMo.phai * s,
        tren: ty + m.hopMo.tren * s,
        duoi: ty + m.hopMo.duoi * s,
      };
      const d = datNhanSaBan(hopPx, co, [...vungCam, ...daDat], khung, m.uuTien);
      if (d === null) {
        an.add(m.khoa);
        continue;
      }
      ve += 1;
      if (co.rong > 0 && co.cao > 0)
        daDat.push({
          trai: d.x - co.rong / 2,
          phai: d.x + co.rong / 2,
          tren: d.y - co.cao / 2,
          duoi: d.y + co.cao / 2,
        });
      if (!bb || !(bb.width > 0) || !(bb.height > 0)) continue;
      doi.set(m.khoa, {
        dx: (d.x - tx) / s - (bb.x + bb.width / 2),
        dy: (d.y - ty) / s - (bb.y + bb.height / 2),
      });
    }
    const moi: KetQuaNhan2D = { doi, an, dem: { ve, an: an.size, tong: ds.length } };
    datKetQua((cu) => (giongNhau(cu, moi) ? cu : moi));
  }, [svgRef, nhanRef]);

  // Dữ liệu/khung nhìn đổi ⇒ tính lại. `useEffect` (không phải layout) để lượt đo
  // chạy SAU khi trình duyệt đã dựng xong `<text>` mới.
  const khoaMuc = useMemo(
    () => muc.map((m) => `${m.khoa}:${m.hopMo.trai},${m.hopMo.tren},${m.hopMo.phai},${m.hopMo.duoi}`).join("|"),
    [muc],
  );
  useEffect(() => {
    tinhLai();
  }, [tinhLai, khoaMuc, oNhin.x, oNhin.y, oNhin.rong, oNhin.sau]);

  /*
   * Lớp phủ ĐỔI CỠ (ResizeObserver) và DỜI CHỖ (`transitionend`) — đúng cặp cảm
   * biến mà `theoDoiDoiCho.ts` đã phải dựng cho bản 3D sau QA lần 10: panel thu
   * rồi mở lại làm tay nắm trượt 288 px mà **không đổi một pixel kích thước nào**,
   * nên `ResizeObserver` im lặng và nhãn ở lì dưới nó ≥ 17 s.
   */
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || typeof document === "undefined") return;
    const ro = new ResizeObserver(() => tinhLai());
    const svg = svgRef.current;
    if (svg) ro.observe(svg);
    for (const el of document.querySelectorAll(`[${THUOC_TINH_CHE_NHAN}]`)) ro.observe(el);
    const nghe = taoBoNgheDoiCho(tinhLai, THUOC_TINH_CHE_NHAN);
    document.addEventListener("transitionend", nghe, true);
    document.addEventListener("transitioncancel", nghe, true);
    return () => {
      ro.disconnect();
      document.removeEventListener("transitionend", nghe, true);
      document.removeEventListener("transitioncancel", nghe, true);
    };
  }, [tinhLai, svgRef]);

  return ketQua;
}
