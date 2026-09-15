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
  type CanhDaNoi,
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

/**
 * Nhịp của vòng chờ cảnh sẵn sàng (ms) — xem docblock H5 trong component.
 *
 * ★ Xuất ra để lưới `thanhCongCuCanh.dom.test.tsx` quay đồng hồ giả đúng nhịp
 *   sản phẩm dùng, thay vì ngủ thật hoặc đoán một con số.
 */
export const NHIP_CHO_CANH_MS = 40;

/** Số nhịp tối đa (≈ 2 s). Hết mà cảnh chưa sẵn sàng ⇒ thôi, không quay vô hạn. */
const SO_NHIP_CHO_CANH = 50;

/**
 * Hai cặp (camera, tâm ngắm) có TRÙNG chỗ không — để biết người dùng đã dời chưa.
 *
 * ★ Dung sai 1 mm, KHÔNG phải bằng-hệt-bit. `OrbitControls` bật `enableDamping`
 *   và `update()` mỗi khung dựng lại vị trí camera từ toạ độ cầu; vòng qua
 *   spherical → cartesian để lại sai số float cỡ 1e-9 tương đối. Đòi bằng tuyệt
 *   đối sẽ đọc sai số ấy thành "người dùng đã dời camera" và bỏ luôn lượt
 *   auto-fit — tức tự tay dựng lại đúng khuyết tật H5.
 *   Chiều ngược lại an toàn: một cú rê chuột dời camera hàng MÉT, không phải mm.
 */
const DO_LECH_COI_LA_DUNG_YEN_M = 1e-3;
function cungCho(a: { c: DiemScene; n: DiemScene }, b: { c: DiemScene; n: DiemScene }): boolean {
  const e = DO_LECH_COI_LA_DUNG_YEN_M;
  const gan = (u: DiemScene, v: DiemScene) =>
    Math.abs(u.x - v.x) < e && Math.abs(u.y - v.y) < e && Math.abs(u.z - v.z) < e;
  return gan(a.c, b.c) && gan(a.n, b.n);
}

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
  /*
   * ★ H5 — `refCanh` là một REF: nó đổi giá trị mà React không hề render lại.
   *   Biến đếm này là cách vòng chờ (a) đánh thức hiệu ứng fit (b) khi cảnh vừa
   *   sẵn sàng. Không có nó, ref đã có `.current` mà chẳng hiệu ứng nào chạy lại.
   */
  const [canhSanSang, datCanhSanSang] = useState(0);
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

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ PH-29 + H5 — FIT MỘT LẦN, VÀ CHẠY ĐƯỢC NGAY Ở LƯỢT MOUNT ĐẦU
   * ════════════════════════════════════════════════════════════════════════
   * QA lần 11 (`.qa-tapdoan/PHAT-HIEN.md` PH-29) đo ảnh Studio: *"sàn lưới ở rất
   * xa, 45 máy co thành vệt mờ, mini-map CÓ chấm"* ⇒ camera KHÔNG khung hình lấy
   * nội dung của chính nó. Mini-map có chấm là dữ kiện quan trọng: dữ liệu VỀ
   * ĐỦ, chỉ camera đứng sai chỗ — nên đây là lỗi khung nhìn, không phải lỗi nạp.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ H5 — BẢN PH-29 CŨ CHỈ FIT Ở LƯỢT `bboxMay` ĐỔI **TIẾP THEO**
   * ════════════════════════════════════════════════════════════════════════
   * Đo sống vòng 2 (`.qa-tapdoan/tho/V2/H5.json`): mở `/twin-studio` KHÔNG chạm
   * gì ⇒ bbox tâm khối chỉ **4,74 %** khung nhìn (182×81 trên 726×431). Chỉ cần
   * **bấm một khối** — tức ép thêm MỘT lượt render — là nhảy lên **19,72 %**, và
   * bấm nút Fit sau đó cho **y hệt 19,72 %**. Tức phép fit vẫn đúng; thứ thiếu
   * là một lượt chạy.
   *
   * Nguyên nhân là chính cái ngoại lệ mà bản cũ tự ghi: ở lượt render đầu
   * `refCanh.current` còn `null` (`CauNoiCanh` ghi ref trong một `useEffect` nằm
   * BÊN TRONG `<Canvas>` — cây R3F riêng), nên hiệu ứng thoát sớm và chỉ thử lại
   * khi `may` đổi. Với một tầng nạp xong trước khi Canvas mount, `may` KHÔNG BAO
   * GIỜ đổi nữa ⇒ không bao giờ fit.
   *
   * ⇒ Vá bằng một VÒNG CHỜ ngắn cho tới khi cảnh sẵn sàng, thay vì chờ một lượt
   *   render tình cờ. `setTimeout` chứ không `requestAnimationFrame`: jsdom
   *   không chạy rAF, và một nhịp đo được là điều kiện để lưới ghim được nó.
   *
   * ★ Dùng LẠI `fitTatCa` (`nut-fit-tat-ca`), không viết phép fit thứ hai: hai
   *   phép fit là hai chỗ để nút bấm và lượt tự động cho hai khung hình khác nhau.
   *
   * ★ ĐÚNG MỘT LẦN, và chỉ khi CÓ NỘI DUNG THẬT (`bboxCoThuc`). Fit lại mỗi lần
   *   `may` đổi sẽ giật camera về mỗi khi người dùng kéo một máy — tức biến một
   *   tiện ích thành một thứ không dùng được.
   *
   * ★★★ VÀ KHÔNG CƯỚP CAMERA. Thứ tự thường gặp thứ hai là *Canvas xong TRƯỚC,
   *   dữ liệu về SAU*; giữa hai mốc ấy người dùng đã xoay/kéo được rồi. Một lượt
   *   fit ập vào lúc đó tệ hơn hẳn việc không fit. Nên lúc cảnh sẵn sàng ta chụp
   *   một MỐC camera, và chỉ tự fit nếu camera vẫn ĐÚNG mốc ấy. Khác mốc ⇒ nhường
   *   quyền cho người dùng (và nút Fit vẫn còn đó cho họ).
   *
   * ⚠ Suy biến an toàn: cảnh không bao giờ sẵn sàng ⇒ hết `SO_NHIP_CHO_CANH`
   *   nhịp thì thôi, hành vi đúng bằng hành vi CŨ (người dùng bấm nút).
   */
  const daTuFit = useRef(false);
  /** Mốc camera lúc cảnh vừa sẵn sàng; `null` = chưa kịp chụp. */
  const mocCamera = useRef<{ c: DiemScene; n: DiemScene } | null>(null);

  /** Đọc cặp (vị trí camera, tâm ngắm) — đủ để biết người dùng đã dời hay chưa. */
  const chupMoc = useCallback((canh: CanhDaNoi): { c: DiemScene; n: DiemScene } => {
    const p = canh.camera.position;
    return { c: { x: p.x, y: p.y, z: p.z }, n: diemDangNgam(canh) ?? { x: 0, y: 0, z: 0 } };
  }, []);

  /* ── (a) chờ cảnh sẵn sàng rồi CHỤP MỐC — độc lập với việc đã có máy chưa ── */
  useEffect(() => {
    if (mocCamera.current) return;
    if (refCanh.current) {
      mocCamera.current = chupMoc(refCanh.current);
      return;
    }
    let con = SO_NHIP_CHO_CANH;
    let hen: ReturnType<typeof setTimeout> | null = null;
    const nhip = () => {
      const canh = refCanh.current;
      if (canh) {
        mocCamera.current = chupMoc(canh);
        datCanhSanSang((n) => n + 1); // đánh thức (b) — ref đổi không tự re-render
        return;
      }
      if (--con <= 0) return;
      hen = setTimeout(nhip, NHIP_CHO_CANH_MS);
    };
    hen = setTimeout(nhip, NHIP_CHO_CANH_MS);
    return () => {
      if (hen) clearTimeout(hen);
    };
  }, [refCanh, chupMoc]);

  /* ── (b) có mốc + có nội dung + người dùng chưa dời ⇒ fit ĐÚNG MỘT LẦN ───── */
  useEffect(() => {
    if (daTuFit.current) return;
    if (!bboxCoThuc(bboxMay)) return;
    const canh = refCanh.current;
    if (!canh) return;
    const moc = mocCamera.current;
    if (moc && !cungCho(chupMoc(canh), moc)) {
      // Người dùng đã tự dời camera sau khi cảnh mở ⇒ nhường quyền, thôi hẳn.
      daTuFit.current = true;
      return;
    }
    daTuFit.current = true;
    fitTatCa();
  }, [bboxMay, fitTatCa, refCanh, chupMoc, canhSanSang]);

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
