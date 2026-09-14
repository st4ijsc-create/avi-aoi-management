/**
 * ThanhCongCuCanh.tsx — thanh công cụ CỦA CANVAS (§11.9 #58 Fit + Fullscreen,
 * #57 Export PNG) và mini-map click-to-navigate (#56).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA CÔNG CỤ NÀY KHÔNG GHI GÌ ⇒ HIỆN CẢ Ở CHẾ ĐỘ CHỈ ĐỌC
 * ════════════════════════════════════════════════════════════════════════════
 * §6.4 (CHẶN-2) đòi **ẩn** mọi đường GHI khi thiếu quyền. Fit, Fullscreen,
 * Export PNG và mini-map chỉ đổi CÁCH NHÌN — ẩn chúng biến "chỉ đọc" thành
 * "xem được ít hơn", đúng lý do `XuongThietKe.tsx` giữ lại công tắc Lưới và nút
 * Đo khoảng cách. Khuôn đã có trong repo, ta theo nó.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ FIT-ALL DÙNG BBOX **THẬT**, KHÔNG DÙNG HẰNG SỐ (G5)
 * ════════════════════════════════════════════════════════════════════════════
 * `onFit` nhận danh sách máy đang vẽ và tính bbox từ đó (`khungNhin.bboxNoiDung`
 * — 34 test). Cảnh RỖNG lùi về mặt sàn, và đó là một nhánh KHÁC, gọi hàm KHÁC
 * (`bboxSan`), nên không có đường nào để một phép đo trên cảnh rỗng "chứng minh"
 * fit đúng.
 *
 * ★ Toàn bộ hình học ở `khungNhin.ts` / `banDoNho.ts` (62 test). Tệp này chỉ
 *   nối chúng với DOM và với `CauNoiCanh`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Maximize, Minimize, Scan } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { bboxCoThuc, type BBox, type DiemScene } from "../heToaDo";
import {
  BAN_KINH_CHAM_PX,
  CANH_BAN_DO_PX,
  camDiToi,
  canhBanDoTheoKhung,
  diemNgamTuClick,
  dungCham,
  dungPhepChieu,
  sceneSangPx,
} from "./banDoNho";
import {
  bboxNoiDung,
  bboxSan,
  congFullscreen,
  doiFullscreen,
  fitBBox,
  type VatTheTrongKhung,
} from "./khungNhin";
import { xuatPng } from "./xuatAnh";
import {
  apDiemNgam,
  apKhungNhin,
  diemDangNgam,
  fovCua,
  tiLeKhungCua,
  veNgay,
  type RefCanh,
} from "./CauNoiCanh";

/** Một máy trên mini-map và trong phép fit. */
export interface MayTrenCanh extends VatTheTrongKhung {
  khoa: string;
  mau: string;
  chon?: boolean;
}

export interface ThanhCongCuCanhProps {
  refCanh: RefCanh;
  /** Phần tử được đưa vào toàn màn hình (bọc canvas). */
  refBoc: React.RefObject<HTMLElement | null>;
  may: readonly MayTrenCanh[];
  /** Kích thước sàn (mét) — dự phòng khi chưa có máy nào. */
  sanRongM: number;
  sanSauM: number;
  /** Nhãn đưa vào tên tệp PNG (thường là tên tầng). */
  nhanAnh: string;
  /** Click một chấm trên mini-map cũng CHỌN máy đó, không chỉ dời camera. */
  onChonMay?: (khoa: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export function ThanhCongCuCanh({
  refCanh,
  refBoc,
  may,
  sanRongM,
  sanSauM,
  nhanAnh,
  onChonMay,
}: ThanhCongCuCanhProps) {
  const { t } = useTranslation();
  const refSvg = useRef<SVGSVGElement | null>(null);
  const [dangToanManHinh, setDangToanManHinh] = useState(false);
  /*
   * ★ Đợt 45 (mục 5) — cạnh mini-map theo VÙNG CẢNH THẬT (`refBoc`, `ResizeObserver`), không hằng.
   *   Chỉ setState khi số đo đổi (không re-render vì rung nửa pixel). Chưa đo ⇒ 148.
   */
  const [canhPx, datCanhPx] = useState<number>(CANH_BAN_DO_PX);
  useEffect(() => {
    const el = refBoc.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const doLai = () => {
      const r = el.getBoundingClientRect();
      const c = canhBanDoTheoKhung(r.width, r.height);
      datCanhPx((cu) => (cu === c ? cu : c));
    };
    doLai();
    const ro = new ResizeObserver(doLai);
    ro.observe(el);
    return () => ro.disconnect();
  }, [refBoc]);

  /**
   * ★★★ BBOX THẬT — đây là dòng làm nên #58. Đổi vị trí một máy là đổi giá trị
   *   này, và phép fit đi theo.
   */
  const bboxMay: BBox = useMemo(() => bboxNoiDung(may), [may]);

  /** Vùng mini-map: nội dung THẬT nếu có, ngược lại mặt sàn (nhánh KHÁC, G5). */
  const vungBanDo: BBox = useMemo(
    () => (bboxCoThuc(bboxMay) ? bboxMay : bboxSan(sanRongM, sanSauM)),
    [bboxMay, sanRongM, sanSauM],
  );

  const chieu = useMemo(() => dungPhepChieu(vungBanDo), [vungBanDo]);
  const cham = useMemo(
    () => dungCham(may.map((m) => ({ khoa: m.khoa, viTri: m.viTri, mau: m.mau, chon: m.chon })), chieu),
    [may, chieu],
  );

  /* ── #58 Fit all in view ─────────────────────────────────────────────── */
  const fitTatCa = useCallback(() => {
    const canh = refCanh.current;
    if (!canh) return;
    // ★ Cảnh có vật ⇒ fit NỘI DUNG. Cảnh rỗng ⇒ fit MẶT SÀN. Hai nhánh, hai
    //   hàm — không có đường nào để nhánh rỗng "chứng minh" nhánh có vật.
    const b = bboxCoThuc(bboxMay) ? bboxMay : bboxSan(sanRongM, sanSauM);
    const kn = fitBBox(b, fovCua(canh), tiLeKhungCua(canh));
    if (!apKhungNhin(canh, kn)) toast.error(t("twin3d.canvasUi.fitKhongSan"));
  }, [refCanh, bboxMay, sanRongM, sanSauM, t]);

  /* ── #58 Fullscreen ──────────────────────────────────────────────────── */
  const doiToanManHinh = useCallback(() => {
    const doc = typeof document === "undefined" ? null : document;
    const kq = doiFullscreen(refBoc.current ?? null, congFullscreen(doc));
    if (kq === "khong-ho-tro") {
      toast.error(t("twin3d.canvasUi.toanManHinhKhongHoTro"));
      return;
    }
    setDangToanManHinh(kq === "vao");
    // Khung nhìn đổi kích thước ⇒ tỉ lệ khung đổi ⇒ phép fit trước đó không còn
    // đúng. Vẽ lại là tối thiểu; người dùng bấm Fit lại nếu muốn.
    refCanh.current?.invalidate();
  }, [refBoc, refCanh, t]);

  /* ── #57 Export PNG ──────────────────────────────────────────────────── */
  const xuatAnhPng = useCallback(() => {
    const canh = refCanh.current;
    if (!canh) {
      toast.error(t("twin3d.canvasUi.xuatAnhLoi"));
      return;
    }
    const kq = xuatPng(
      canh.gl.domElement,
      // ★★★ VẼ LẠI NGAY TRƯỚC KHI CHỤP — `preserveDrawingBuffer` là `false`,
      //   xem docblock `xuatAnh.ts`. Bỏ dòng này ⇒ ảnh TRẮNG, không lỗi nào.
      () => veNgay(canh),
      typeof document === "undefined" ? null : document,
      nhanAnh,
      new Date(),
    );
    if (kq.xong) toast.success(t("twin3d.canvasUi.xuatAnhXong", { ten: kq.ten }));
    else toast.error(t("twin3d.canvasUi.xuatAnhLoi"));
  }, [refCanh, nhanAnh, t]);

  /* ── #56 Mini-map click-to-navigate ──────────────────────────────────── */
  const clickBanDo = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const canh = refCanh.current;
      const svg = refSvg.current;
      if (!canh || !svg) return;
      const hop = svg.getBoundingClientRect();
      const ngamMoi = diemNgamTuClick(
        { clientX: e.clientX, clientY: e.clientY },
        { left: hop.left, top: hop.top, width: hop.width, height: hop.height },
        chieu,
        vungBanDo,
      );
      const cam = canh.camera.position;
      const ngamCu: DiemScene = diemDangNgam(canh) ?? { x: 0, y: 0, z: 0 };
      apDiemNgam(canh, camDiToi({ x: cam.x, y: cam.y, z: cam.z }, ngamCu, ngamMoi));

      // Click TRÚNG một chấm cũng CHỌN máy đó: mini-map là công cụ định vị, và
      // "đi tới rồi vẫn phải tìm lại trong cây" là nửa việc.
      if (onChonMay) {
        let gan: { khoa: string; d: number } | null = null;
        for (const m of may) {
          const p = sceneSangPx(m.viTri, chieu);
          const pc = {
            px: ((e.clientX - hop.left) * chieu.rongPx) / (hop.width || chieu.rongPx),
            py: ((e.clientY - hop.top) * chieu.caoPx) / (hop.height || chieu.caoPx),
          };
          const d = Math.hypot(p.px - pc.px, p.py - pc.py);
          if (!gan || d < gan.d) gan = { khoa: m.khoa, d };
        }
        if (gan && gan.d <= BAN_KINH_CHAM_PX * 2.4) onChonMay(gan.khoa);
      }
    },
    [refCanh, chieu, vungBanDo, may, onChonMay],
  );

  const vienBanDo = useMemo(() => {
    const a = sceneSangPx({ x: vungBanDo.minX, y: 0, z: vungBanDo.minZ }, chieu);
    const b = sceneSangPx({ x: vungBanDo.maxX, y: 0, z: vungBanDo.maxZ }, chieu);
    return { x: a.px, y: a.py, w: Math.max(b.px - a.px, 1), h: Math.max(b.py - a.py, 1) };
  }, [vungBanDo, chieu]);

  /* ═════════════════════════════════════════════════════════════════════ */
  return (
    <>
      {/* ── Thanh công cụ — góc trên phải canvas ─────────────────────── */}
      <div
        className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1"
        data-testid="thanh-cong-cu-canh"
      >
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-sm backdrop-blur">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid="nut-fit-tat-ca"
                aria-label={t("twin3d.canvasUi.fitTatCa")}
                onClick={fitTatCa}
              >
                <Scan className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{t("twin3d.canvasUi.fitTatCa")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid="nut-xuat-png"
                aria-label={t("twin3d.canvasUi.xuatAnh")}
                onClick={xuatAnhPng}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{t("twin3d.canvasUi.xuatAnh")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid="nut-toan-man-hinh"
                aria-pressed={dangToanManHinh}
                aria-label={t("twin3d.canvasUi.toanManHinh")}
                onClick={doiToanManHinh}
              >
                {dangToanManHinh ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {t("twin3d.canvasUi.toanManHinh")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Mini-map — GÓC DƯỚI PHẢI canvas (§11.9 #56) ───────────────── */}
      <div
        className="absolute bottom-2 right-2 z-10 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur"
        data-testid="mini-map"
        data-canh-px={canhPx}
      >
        <svg
          ref={refSvg}
          /* ★ Đợt 45 (mục 5) — kích thước CSS theo vùng cảnh; `viewBox` giữ 148 ⇒ toạ độ chấm không đổi. */
          width={canhPx}
          height={canhPx}
          viewBox={`0 0 ${CANH_BAN_DO_PX} ${CANH_BAN_DO_PX}`}
          role="button"
          tabIndex={0}
          aria-label={t("twin3d.canvasUi.miniMap")}
          className="cursor-crosshair rounded-sm"
          data-testid="mini-map-svg"
          onClick={clickBanDo}
        >
          {/* Khung nhà xưởng */}
          <rect
            x={vienBanDo.x}
            y={vienBanDo.y}
            width={vienBanDo.w}
            height={vienBanDo.h}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
            data-testid="mini-map-vien"
          />
          {cham.map((c) => (
            <circle
              key={c.khoa}
              cx={c.px}
              cy={c.py}
              r={c.chon ? BAN_KINH_CHAM_PX * 1.9 : BAN_KINH_CHAM_PX}
              fill={c.mau}
              stroke={c.chon ? "currentColor" : "none"}
              strokeWidth={c.chon ? 1.2 : 0}
              data-testid="mini-map-cham"
              data-khoa={c.khoa}
            />
          ))}
          {/* ★ NT-3 — bản đồ RỖNG phải TỰ KHAI là rỗng. Một ô vuông trống trơn
              trông y hệt "đã tải xong và không có máy nào" lẫn "chưa tải". */}
          {cham.length === 0 ? (
            <text
              x={CANH_BAN_DO_PX / 2}
              y={CANH_BAN_DO_PX / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.55}
              data-testid="mini-map-rong"
            >
              {t("twin3d.canvasUi.miniMapRong")}
            </text>
          ) : null}
        </svg>
      </div>
    </>
  );
}

export default ThanhCongCuCanh;
