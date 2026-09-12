/**
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinLine.tsx` — MÀN **LINE 3D** RIÊNG (`/twin/line/:id`) — ĐỢT 30
 * ════════════════════════════════════════════════════════════════════════════
 *
 * QĐ-19 (chủ sở hữu chốt 2026-09-09): *"1 màn canvas là dành cho factory thôi,
 * còn Line/Machine là 2 màn hình khác"*. ⇒ **BA MÀN RIÊNG, mỗi màn MỘT canvas** —
 * không phải một trang đổi nội dung cảnh.
 *
 * QĐ-21: URL **phân cấp** — `/twin` · `/twin/line/:id` · `/twin/may/:id` ·
 * `/twin-studio`. Tiền đề đã đo (`bo-cuc/duongDanBaMan.unit.test.ts`, 9 ca):
 * `/twin` **không nuốt** `/twin/line/2`, đo bằng `regexparam` — CHÍNH bộ khớp
 * mà wouter 3.7.1 `import` bên trong (`node_modules/wouter/esm/index.js:1`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G87 — BA MÀN RIÊNG LÀM RB-4 **SẠCH HƠN** MỘT TRANG ĐỔI NỘI DUNG
 * ════════════════════════════════════════════════════════════════════════════
 * `KhungCanh.tsx:221-232` đếm canvas đang mount cùng lúc và `console.error` khi
 * `> 1` (lý do ghi trong mã: cạn WebGL context, *biểu hiện là canvas ĐEN, không
 * phải một lỗi đọc được*). Ba màn riêng thì ba canvas **KHÔNG BAO GIỜ sống cùng
 * lúc — VÌ ROUTER**, không vì một biểu thức điều kiện ai đó có thể sửa nhầm.
 * `window.__soCanvas` vẫn **= 1** ở màn này.
 *
 * ⇒ Đúng bài học G84 (Đợt 26, `/twin-studio`): **tách lại làm hàng rào CHẶT
 *   hơn, không lỏng hơn**. Hai lần liên tiếp, cùng một kết luận: *kiến trúc
 *   định tuyến mạnh hơn cơ chế điều kiện.*
 *
 * ★ CÁI THẬT SỰ ĐÁNH ĐỔI (nêu trước, không phải phát hiện sau): mất **ngữ cảnh
 *   không gian** (ở màn Line không còn thấy Line nằm đâu trong nhà máy) và
 *   **tốc độ chuyển màn** (thu dọn cảnh cũ, dựng cảnh mới). Nếu một đợt sau
 *   thấy *"giật khi mở Line"*, **đây là nguyên nhân đã biết trước**, không phải
 *   lỗi mới.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QĐ-18 — MÀN **XEM**, KHÔNG PHẢI CỔNG STUDIO
 * ════════════════════════════════════════════════════════════════════════════
 * Màn này thừa cổng quyền của `/twin` (`analytics_oee` **HOẶC**
 * `machine_status`), **không** cổng của `/twin-studio`
 * (`settings_factory`/`machine_control`). Nó **không có mặt GHI nào**: không
 * mutation, không nút lệnh OT (§15.6 **D-1**), không công cụ sửa bố cục
 * (**D-11**).
 *
 * ⚠⚠⚠ **G67 — CỔNG PHẢI KHAI `navHref="/twin"`, KHÔNG PHẢI `"/twin/line/:id"`.**
 *   `hasAccessToItem` (`navigation.tsx:2546`) duyệt `navGroups` tìm ô có `href`
 *   **khớp chính xác**, và **`return false`** khi không tìm thấy. Một
 *   `navHref="/twin/line/:id"` (không có ô nav nào mang href ấy) sẽ **từ chối
 *   MỌI người dùng, kể cả người có đủ quyền** — và triệu chứng là thẻ "Không có
 *   quyền truy cập", **không phải một lỗi**. Đúng lớp G67: tên không có trong
 *   **danh sách đóng** thì bị nuốt im lặng. Cổng khai ở `App.tsx`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔⛔ **KHÔNG TRÙNG VIỆC VỚI `/line-view/:lineId`** — §11b, ĐỌC TRƯỚC KHI XOÁ
 * ════════════════════════════════════════════════════════════════════════════
 * `client/src/pages/LineView.tsx` (**418 dòng**) đã tồn tại từ doc 44 W3-B4 và
 * có **0 tham chiếu 3D** (`Canvas`/`three`/`KhungCanh`). Nó là màn **2D điều
 * khiển tuyến**: nó CÓ mặt ghi (lệnh tuyến, tự gate `machine_control`/`edit`,
 * server đòi 2FA qua `actuationProcedure`).
 *
 *   `/line-view/:lineId`  →  màn **2D**, có LỆNH, gate `machine_status` + ghi
 *   `/twin/line/:id`      →  màn **3D**, chỉ XEM, 0 mutation   ← TỆP NÀY
 *
 * **HAI THỨ KHÁC NHAU.** Tên gần nhau là lý do đúng để ghi khối này, **không
 * phải** lý do để ai đó xoá một trong hai vì tưởng là bản trùng lặp (đúng lớp
 * lỗi §11b: xoá màn vì tưởng không ai dùng).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G37 — TRANG NÀY LÀ **VỎ** ĐỌC ROUTE; THÂN NHẬN QUA THAM SỐ
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinLine` (default export) là chỗ **duy nhất** gọi `useRoute`. Nó phân giải
 * `:id` bằng `idLineTuDuongDan` rồi truyền **số** xuống `ThanManLine`. Vì sao
 * quan trọng: một màn tự đọc route **hỏng CÂM** khi bị đặt ngoài route của nó —
 * `id` ra `NaN`, **không exception nào nổ**, và người xem thấy một chuyền RỖNG
 * thay vì một lỗi. `RobotCockpit`/`StationAnalysis` đã dính đúng lớp ấy.
 * Nhờ tách vỏ/thân, `ThanManLine` cũng **test được** mà không cần dựng router.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ BỐ CỤC — HÌNH B (§15.3.2), DỊCH SANG NGÔN NGỮ "MÀN RIÊNG"
 * ════════════════════════════════════════════════════════════════════════════
 * §15.3.2 vẽ Hình B cho phương án **lớp nổi trong cùng canvas** (QĐ-17/L2).
 * QĐ-19 **thay** phương án ấy bằng màn riêng, nên khối "nền = cảnh nhà máy pha
 * 72 %" **không còn tồn tại** ở đây — không có cảnh thứ hai để pha. Giữ nguyên
 * phần còn lại của Hình B:
 *
 *     ┌ breadcrumb ‹ Nhà máy · Line N ────────────── [badge nguồn] ┐  44px
 *     ├ chip trái: N máy · M trạm · nhịp · nút thắt · WIP ─────────┤  (B) lớp phủ
 *     │                                                            │
 *     │   CẢNH 3D LINE — 1 canvas, camera DỌC theo chuyền          │
 *     │                                                            │
 *     ├ DaiLine — dòng chảy trạm + WIP + nhịp (2D song song §11.5) ┤  84px
 *     └────────────────────────────────────────────────────────────┘
 *
 * §15.6 — thông tin lên 3D, theo NHÓM:
 *   (A) neo vật thể : nhãn máy + badge cảnh báo, trần **≤ 13** ở cấp Line
 *   (B) lớp phủ 2D  : chip trái (`BangKpiNoi` — 0 draw call)
 *   (C) panel       : `DaiLine` dưới đáy
 *   (D) KHÔNG lên 3D: **D-1** nút lệnh OT · **D-6** từng bo mạch · **D-7** hoạt
 *       ảnh băng tải · **D-10** biểu đồ dài hạn · **D-11** công cụ sửa bố cục ·
 *       **D-12** `twin_vat_the` kiểu `vung` (đo 2026-09-08: **0 hàng**).
 *   ★★★ Nhóm (D) quan trọng NGANG (A): một màn nhồi mọi thứ **không đọc được**.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { useHistoryState } from "wouter/use-browser-location";
import { ArrowLeft } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc";

import { CanhVanHanh } from "@/components/twin3d/van-hanh/CanhVanHanh";
import { DaiLine } from "@/components/twin3d/van-hanh/DaiLine";
import { BangKpiNoi } from "@/components/twin3d/van-hanh/BangKpiNoi";
import { mauCss } from "@/components/twin3d/van-hanh/mauThree";
import { mauChoTrangThai } from "@/components/twin3d/mauTrangThai";
import { hinhKhoiCho } from "@/components/twin3d/hinhKhoiMay";
import { dungHinhLine } from "@/components/twin3d/van-hanh/canhLine";
import {
  dungCanhBao3D,
  dungMayVe,
  dungNhanMay,
} from "@/components/twin3d/van-hanh/hopNhatCanh";
import {
  dichKhungDoc,
  khungNhinLine,
  khungNhinTuCamera,
  phaVeNen,
  TI_LE_PHA_NGOAI_PHAM_VI,
  trongPhamVi,
} from "@/components/twin3d/van-hanh/phamViCanh";
// ── Đợt 33 (QĐ-23): đường sang màn Máy, đường về `/twin?pv=…`, và `?cam=` ──
import {
  docDuongVeTwin,
  docTrangThaiUrl,
  duongDanManMay,
  trangThaiVe,
  type TuTheCamera,
} from "@/components/twin3d/van-hanh/duongDanTwin";
import { cotWip, nhipTuCanBang, xepHangWip } from "@/components/twin3d/van-hanh/wipTram";
import { tinhKpiNoi, type MayTongQuanKpi } from "@/components/twin3d/van-hanh/kpiNoiLogic";
// ── ★★★ Đợt 34 (QĐ-24) — NGĂN "MÔ PHỎNG" (§11 #30 what-if + #35 phát lại) CHUYỂN TỪ `/twin` SANG ĐÂY ──
//    Lý do đo được (Đợt 33 K11): sau QĐ-23 `/twin` không bao giờ ở cấp Line ⇒ `lineDangXem` luôn `null`
//    ⇒ ngăn luôn khai `chua_chon_line`; màn Line lại KHÔNG có ngăn ⇒ tính năng mất lối vào. Hook đã nhận
//    `lineDangXem` qua tham số (G37) nên chuyển được nguyên vẹn; chỉ truy vấn ĐỌC (`whatIf` thuần,
//    `listWorkflows`/`simulate`), không thêm mutation (§15.6 D-1).
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useMoPhongTwin } from "@/components/twin3d/van-hanh/useMoPhongTwin";
import { chieuCaoTruDinh, useTruDinhKhung } from "@/components/twin3d/van-hanh/useTruDinhKhung";
import { khoaBanDo, khoaMayVanHanh, useOnDinhTheoGiaTri } from "@/components/twin3d/van-hanh/onDinhTheoGiaTri";
import { giuKhiCungNhaMay } from "@/components/twin3d/van-hanh/giuDuLieuTruoc";
import { rutTienTo, tienToChung } from "@/components/twin3d/van-hanh/maNgan";
// ★ Đợt 35 (Pareto #7): DÙNG LẠI câu `chuaGanNhaMay` của màn Máy (Đợt 34 D) — không khai câu thứ hai (G12).
import { cauChoLyDoManMay } from "@/components/twin3d/van-hanh/manMay";
import { NganMoPhong } from "@/components/twin3d/van-hanh/NganMoPhong";
import {
  dungDauVaoWhatIf,
  kep,
  HORIZON_MIN,
  HORIZON_MAX,
  HE_SO_MIN,
  HE_SO_MAX,
} from "@/components/twin3d/van-hanh/moPhongLogic";
import { dongHoHienThi, hopNhat } from "@/components/twin3d/van-hanh/khoTrangThai";
import { useKhoTrangThai } from "@/components/twin3d/van-hanh/useKhoTrangThai";
import { useTrangThaiSong } from "@/components/twin3d/van-hanh/useTrangThaiSong";
import { usePhanTichLine } from "@/components/twin3d/van-hanh/usePhanTichLine";
import { coLuongTheoKetNoi, nhipHoiMs } from "@/components/twin3d/van-hanh/nguonDuLieu";
import {
  hienSo,
  trangThaiHienThi,
  type MayVanHanh,
  tsTrangThaiTheoMay,
} from "@/components/twin3d/van-hanh/trungThucDuLieu";
import {
  bboxKemCotWip,
  hangDaiLine,
  lyDoMoManLine,
  idLineTuDuongDan,
  mayCuaLine,
  phamViCuaManLine,
  tinhWipLine,
  tomTatLine,
} from "@/components/twin3d/van-hanh/manLine";
import type { MayTrongLo, NhanTheGioi } from "@/components/twin3d/loi";
import type { CanhBaoTheGioi, MucCanhBao } from "@/components/twin3d/van-hanh/LopCanhBao";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* VỎ — chỗ DUY NHẤT đọc route (G37)                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function TwinLine() {
  const { t } = useTranslation();
  const [khop, tsRoute] = useRoute("/twin/line/:id");

  /*
   * ★★★ `idLineTuDuongDan` TRẢ `null`, KHÔNG `NaN` — và đó là toàn bộ điểm.
   *   `Number("abc")` ra `NaN`; `NaN` chảy tiếp vào `mayCuaLine` cho ra tập
   *   RỖNG, tức màn hiện **một chuyền trống** thay vì nói "id không hợp lệ".
   *   Không exception nào nổ. Đây là lớp G37 ở dạng dữ liệu.
   */
  const lineId = idLineTuDuongDan(khop ? tsRoute?.id : null);
  /*
   * ★ Đợt 33 — hai thứ nữa vỏ đọc từ "bên ngoài" rồi TRUYỀN xuống (G37):
   *   · `?cam=` (Pareto #9): tư thế camera của deep-link, đọc bằng ĐÚNG bộ đọc
   *     của `/twin` (`docTrangThaiUrl`). Đợt 32 a3b đo màn này NUỐT nó im lặng.
   *   · `history.state.twinVe` (QĐ-23 #5): đường về `/twin?pv=…` do `/twin` đặt
   *     lúc rời đi; thiếu/rác ⇒ `null` ⇒ link "Nhà máy" rơi về `/twin`.
   *   Cả hai gọi TRƯỚC nhánh `return` sớm — thứ tự hook không đổi giữa các lượt.
   */
  const search = useSearch();
  const camUrl = useMemo(() => docTrangThaiUrl(search).cam, [search]);
  /*
   * ★ Đợt 34 (QĐ-24): `?thu=moPhongMo` — CÙNG khoá và CÙNG tên chiều-ngược mà `/twin` đã dùng (Đợt 23
   *   M2, `PANEL_THU_DUOC`; G40 không đẻ khoá thứ bảy) — đọc MỘT LẦN lúc mount làm trạng thái ban đầu
   *   của ngăn. Màn này KHÔNG ghi ngược `?thu=` (panel của nó là state cục bộ như `moKpi`, và `?cam=`
   *   ở đây cũng chỉ đọc); mặc định vắng khoá = THU, đúng phép đo 42.437 px² của Đợt 23.
   */
  const moPhongMoBanDau = useMemo(() => docTrangThaiUrl(search).thu.includes("moPhongMo"), [search]);
  const duongVe = docDuongVeTwin(useHistoryState());

  if (lineId === null) {
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="line-id-khong-hop-le">
        <EmptyState
          title={t("twin3d.line.idKhongHopLe", "Không đọc được chuyền từ đường dẫn")}
          description={t(
            "twin3d.line.idKhongHopLeMo",
            "Đường dẫn phải có dạng /twin/line/<số>. Hãy chọn một chuyền từ màn nhà máy.",
          )}
        />
      </div>
    );
  }

  return <ThanManLine lineId={lineId} camUrl={camUrl} duongVe={duongVe} moPhongMoBanDau={moPhongMoBanDau} />;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* THÂN — nhận `lineId` qua THAM SỐ, không đọc route (G37)                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

export interface ThanManLineProps {
  /** Đã phân giải và ĐÃ kiểm — thân không bao giờ thấy `NaN`. */
  lineId: number;
  /** `?cam=` đã phân tích (vỏ đọc) — `null`/vắng ⇒ camera bay dọc chuyền như cũ. */
  camUrl?: TuTheCamera | null;
  /** Đường về `/twin?pv=…` (từ `history.state`, vỏ đọc) — vắng ⇒ `/twin`. */
  duongVe?: string | null;
  /** Đợt 34 (QĐ-24): ngăn Mô phỏng MỞ sẵn khi mount (`?thu=moPhongMo`, vỏ đọc). Vắng ⇒ THU. */
  moPhongMoBanDau?: boolean;
}

export function ThanManLine({
  lineId,
  camUrl = null,
  duongVe = null,
  moPhongMoBanDau = false,
}: ThanManLineProps) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission } = usePermissions();
  const [moKpi, datMoKpi] = useState(true);
  const [moMoPhong, datMoMoPhong] = useState(moPhongMoBanDau);

  /*
   * ★★★ ĐỢT 33 (QĐ-23 #2) — BẤM MÁY = ĐI `/twin/may/:id`, KHÔNG CÒN CHỌN TẠI CHỖ.
   *   Đợt 32 a3 đo: bấm `o-tram-14` ⇒ URL **không đổi** (state cục bộ
   *   `datMachineIdChon`, đã bỏ). Nay cảnh 3D và dải trạm cùng gọi MỘT hàm;
   *   `state` mang tiếp đường về `/twin` để màn Máy cũng về đúng `?pv=`.
   */
  const dieuHuongToiMay = useCallback(
    (id: number | null) => {
      if (id != null) setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) });
    },
    [setLocation, duongVe],
  );

  const bayGioThat = Date.now();

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ CHIỀU CAO ĐO TỪ VỊ TRÍ THẬT, KHÔNG TRỪ MỘT HẰNG SỐ ĐOÁN
   * ════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ **BẢN ĐẦU CỦA TỆP NÀY DÙNG `h-full`, VÀ ẢNH TỰ CHỤP BẮT ĐƯỢC HẬU QUẢ.**
   *   Đo trên `dist`, 1600×900, `e2e_tai_loE` (`.qa-dot30/do-dai-line.json`):
   *
   *       man-twin-line   y= 80  h=889  ⇒ đáy ở **969**, tràn **69 px**
   *       khoi-dai-line   y=876  h= 93
   *       12 ô trạm       y=904  h= 55  ← **NẰM DƯỚI MÉP 900 px, không ai thấy**
   *
   *   Cả 12 ô **CÓ trong DOM**, **CÓ kích thước thật** (82×55), và **mọi lưới
   *   `toBeVisible()` đều XANH** — chúng chỉ nằm ngoài màn hình. Đúng lớp G41:
   *   **chỉ ẢNH bắt được**. Và nó cũng là lý do phải tự chụp tự đọc thay vì tin
   *   `soNutTrongDai = 12`: con số ấy ĐÚNG mà màn vẫn hỏng.
   *
   * ★★★ GỐC RỄ: `h-full` kế thừa chiều cao của khung cha **không trừ vỏ ứng
   *   dụng** (thanh trên cùng cao 80 px ở bố cục này). `TwinVanHanh.tsx:2481`
   *   đã trả giá đúng bài học này một lần và ghi lại: *"Đừng thay `5rem` bằng
   *   một hằng số đoán khác — lần sau chrome đổi là sai lại, và không có lỗi
   *   nào nổ."* Nên ở đây cũng **ĐO** `getBoundingClientRect().top` của chính
   *   khung này rồi trừ khỏi `100vh` — tự đúng với mọi chiều cao vỏ.
   *
   * ★ `--twin-line-top` là biến RIÊNG, không dùng chung `--twin-top` của
   *   `/twin`: hai màn là hai route, không bao giờ sống cùng lúc (QĐ-19), nhưng
   *   dùng chung một biến CSS toàn cục sẽ để lại giá trị của màn trước cho màn
   *   sau đọc — một khớp nối ẩn giữa hai thứ đáng lẽ độc lập.
   */
  const khungRef = useRef<HTMLDivElement | null>(null);
  // ★ Đợt 35 — MỘT hook cho ba màn (G12), tên biến vẫn RIÊNG. Xem docblock `useTruDinhKhung`.
  useTruDinhKhung(khungRef, "--twin-line-top");

  /*
   * ★★★ ĐỢT 35 (Pareto #5) — KÍCH THƯỚC KHUNG CẢNH (px) ĐO LÚC CHẠY, để `khungNhinLine` KHỚP
   *   frustum theo tỉ lệ canvas THẬT. QA Đợt 32: 6/12 máy trong khung, cột WIP xuyên mép — vì khung
   *   nhìn cấp Line không biết canvas rộng/cao bao nhiêu. `ResizeObserver` trên khung chứa canvas;
   *   chỉ setState khi số đo đổi ≥ 1 px (không re-render vì rung nửa pixel).
   */
  const khungCanhRef = useRef<HTMLDivElement | null>(null);
  const [kichThuocKhung, datKichThuocKhung] = useState<{ rongPx: number; caoPx: number } | null>(null);
  useEffect(() => {
    const el = khungCanhRef.current;
    if (!el) return;
    const doLai = () => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      datKichThuocKhung((cu) =>
        cu && Math.abs(cu.rongPx - r.width) < 1 && Math.abs(cu.caoPx - r.height) < 1
          ? cu
          : { rongPx: r.width, caoPx: r.height },
      );
    };
    doLai();
    const ro = new ResizeObserver(doLai);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Nhà máy ─────────────────────────────────────────────────────────── */
  const factoriesQ = trpc.factory.list.useQuery();
  const factories = useMemo(
    () => (factoriesQ.data ?? []) as Array<{ id: number; name?: string; code?: string }>,
    [factoriesQ.data],
  );
  /*
   * ★ Nhà máy ĐẦU TIÊN — và đó là một GIỚI HẠN có chủ ý, không phải sơ suất.
   *   `production_lines.id` là khoá toàn cục nên `:id` đã xác định duy nhất một
   *   chuyền; nhưng `canhThietKe` nhận ĐÚNG MỘT `factoryId`
   *   (`twinCanhRouter.ts:646-651`), nên trang phải chọn một. Trên CSDL này
   *   (đo 2026-09-09: **2 nhà máy**, và **toàn bộ 82 hàng `twin_dat_cho` nằm ở
   *   MỘT tầng** — `tangId=28` của toà 24) mọi chuyền đều thuộc nhà máy đầu.
   *   ⇒ Nếu một ngày chuyền nằm ở nhà máy thứ hai, màn này sẽ hiện **rỗng**, và
   *   `EmptyState` phía dưới nói ra điều đó thay vì vẽ một chuyền sai. Ghi nợ ở
   *   đây thay vì để người sau đoán.
   */
  const factoryId = factories[0]?.id ?? null;

  /* ── Realtime + nhịp thích nghi ──────────────────────────────────────── */
  /*
   * ★ Hook này đứng TRƯỚC mọi `useQuery` là CÓ CHỦ Ý (giữ nguyên luật của
   *   `TwinVanHanh.tsx`): `ketNoi` là đầu vào của `nhipHoiMs`, và
   *   `refetchInterval` phải biết nhịp NGAY TẠI chỗ khai truy vấn.
   */
  const { kho, ketNoi } = useKhoTrangThai(factoryId, bayGioThat);
  const coLuongDay = coLuongTheoKetNoi(ketNoi);
  const nhipTongQuanMs = nhipHoiMs(coLuongDay);
  const bayGio = dongHoHienThi(kho, bayGioThat);

  /* ── Hình học nhà xưởng ──────────────────────────────────────────────── */
  const toaNhaQ = trpc.twinCanh.danhSachToaNha.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId !== null, retry: false },
  );
  const toaNhaDau = useMemo(
    () =>
      ((toaNhaQ.data ?? []) as Array<{ id: number; rongMm: string | number; sauMm: string | number }>)[0] ??
      null,
    [toaNhaQ.data],
  );
  const chiTietQ = trpc.twinCanh.chiTietToaNha.useQuery(
    { id: toaNhaDau?.id ?? 0 },
    { enabled: toaNhaDau != null, retry: false },
  );
  const tangIdsHoi = useMemo(
    () =>
      ((chiTietQ.data?.tangs ?? []) as Array<{ id: number }>).map((s) => s.id).slice(0, 50),
    [chiTietQ.data],
  );

  /*
   * ★★★ HỎI **MỌI TẦNG CỦA TOÀ**, KHÔNG CHỈ MỘT — F2, và ở màn Line lý do CÒN
   *   MẠNH HƠN: một chuyền **không nhất thiết nằm gọn trong một tầng**. Màn
   *   `/twin` có "tầng đang xem" từ URL để lọc; màn này **không có** khái niệm
   *   ấy — chuyền là đơn vị, tầng chỉ là chỗ máy đứng. Lọc theo một tầng ở đây
   *   sẽ **giấu im lặng** những trạm của chính chuyền đang xem, và đường tâm
   *   Line **đứt quãng mà không nói vì sao**.
   */
  // ★ Đợt 40 (QA Đợt 39 #5) — `placeholderData` giữ dữ liệu pha `tangIds: []` trong lúc hỏi pha tầng thật (cùng
  //   nhà máy) ⇒ ô trạm `o-tram-*` không biến mất ~250 ms giữa hai pha (`.qa-dot39/cua-so-som/`, 6/12 lần).
  const canhQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: factoryId ?? 0, tangIds: tangIdsHoi },
    { enabled: factoryId !== null, retry: false, placeholderData: giuKhiCungNhaMay(factoryId) },
  );

  const tram = useMemo(() => canhQ.data?.tram ?? [], [canhQ.data]);
  const chuyen = useMemo(() => canhQ.data?.chuyen ?? [], [canhQ.data]);
  const lineHienTai = useMemo(() => chuyen.find((c) => c.id === lineId) ?? null, [chuyen, lineId]);

  /* ── Trạng thái sống ─────────────────────────────────────────────────── */
  /*
   * ⚠⚠⚠ TẦNG NÀY MANG **BẤT BIẾN AN TOÀN**: `andon.active` và
   *   `twinCanh.anToanRobot` có TRẦN **20 s**, `sucKhoeMay` trần **60 s**. Luật
   *   (Đợt 8): nhịp thích nghi chỉ được **RÚT NGẮN, không được KÉO DÀI** — *an
   *   toàn không được chậm đi vì một tối ưu*. Trần là hằng CÓ TÊN bên trong
   *   `useTrangThaiSong.ts`; màn này KHÔNG được khai lại một con số nào.
   */
  const { overviewQ, andonQ } = useTrangThaiSong({
    factoryId,
    coLuongDay,
    nhipTongQuanMs,
  });

  /*
   * ★ `lineDangXem` = `lineId` LUÔN — màn này **theo định nghĩa** ở cấp Line.
   *   Ở `/twin` giá trị ấy là `phamVi.cap === "line" ? phamVi.id : null`, tức
   *   phụ thuộc một trạng thái URL có thể là cấp khác. Đây chính là chỗ QĐ-19
   *   mua được sự đơn giản: không có nhánh "nếu đang ở cấp Line".
   */
  const { wipQ, canBangQ } = usePhanTichLine({ lineDangXem: lineId, nhipTongQuanMs });

  /* ── Máy đã hợp nhất trạng thái + tuổi (NT-3) ────────────────────────── */
  const lineCuaTram = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of tram) m.set(s.id, s.lineId);
    return m;
  }, [tram]);

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ TUỔI DỮ LIỆU — **CHỈ** `kind === "offline"`. MỘT LỖI NT-3 ĐÃ TRẢ GIÁ.
   * ════════════════════════════════════════════════════════════════════════
   * Bản đầu của tệp này đọc `n.lastHeartbeat` — **trường ấy KHÔNG TỒN TẠI** trên
   * `CommandMachineNode` (`npm run check` bắt được, 2 lỗi TS2339). Đó là một
   * suy đoán về hợp đồng, và nó suýt tái lập đúng lớp lỗi mà `TwinVanHanh.tsx`
   * (`:685-719`) đã vá một lần: bản đầu ở đó nhận MỌI `issues[].ageMinutes` làm
   * "tuổi dữ liệu", và nghiệm thu trên trình duyệt thật bắt được hậu quả — sau
   * khi RAISE một andon lên máy 2, ô "tươi" nhảy 0→1 và máy 2 hiện `16s`: **một
   * cảnh báo mới làm máy trông như vừa gửi tín hiệu**, trong khi SQL thô nói nó
   * im lặng từ 2026-09-03.
   *
   * Gốc rễ đọc tại nguồn (`server/services/factoryCommandService.ts`):
   *   :342 `kind:"andon"`     → tuổi của `andon_events.raisedAt`
   *   :385 `kind:"workorder"` → tuổi của `scheduledFor`
   *   :373 `kind:"pdm"`       → tuổi của bản ghi health
   *   :404 `kind:"offline"`   → `machine_status_logs."timestamp"`   ★ DUY NHẤT
   * Chỉ dòng cuối là THỜI ĐIỂM ĐO TRẠNG THÁI.
   *
   * ★★★ ĐỢT 34 (Pareto #1) — hợp đồng fleet NAY MANG mốc: `machines[].tsTrangThai` = nhịp tim
   *   `max(machines.lastHeartbeat, machine_heartbeats)` qua ĐÚNG `chonNguonMocTuoi` của kho realtime.
   *   Đo 2026-09-10: 0 issue `offline` trên 43 máy ⇒ vòng lặp cũ cho bản đồ RỖNG ⇒ 42 máy đã từng báo
   *   cáo hiện "Never reported". Ba trang gọi CÙNG `tsTrangThaiTheoMay` (G12), không chép vòng lặp nữa.
   */
  const tsTheoMay = useMemo(
    // ★ Đợt 38 — mốc = lúc NHẬN dữ liệu, không phải `bayGioThat` mỗi render (xem `onDinhTheoGiaTri.ts`).
    () => tsTrangThaiTheoMay(overviewQ.data?.machines ?? [], overviewQ.data?.issues ?? [], Date.now()),
    [overviewQ.data],
  );

  const mayNen = useMemo<MayVanHanh[]>(() => {
    const tt = new Map<number, string>();
    for (const n of overviewQ.data?.machines ?? []) tt.set(n.id, n.status);
    return (canhQ.data?.may ?? []).map((m) => ({
      id: m.id,
      ma: m.ma,
      ten: m.ten,
      loaiMay: String(m.loaiMay),
      trangThaiBaoCao: tt.get(m.id) ?? null,
      thoiDiemDuLieu: tsTheoMay.get(m.id) ?? null,
      isActive: m.isActive,
      stationId: m.stationId,
      lineId: m.stationId != null ? (lineCuaTram.get(m.stationId) ?? null) : null,
    }));
  }, [canhQ.data, overviewQ.data, tsTheoMay, lineCuaTram]);

  // ★★★ Đợt 38 (phần dư Pareto #1) — ổn định theo GIÁ TRỊ, cùng khuôn `TwinMay`/`/twin` (xem `onDinhTheoGiaTri.ts`).
  const mayTatCaTho = useMemo(() => hopNhat(mayNen, kho), [mayNen, kho]);
  const mayTatCa = useOnDinhTheoGiaTri(mayTatCaTho, khoaMayVanHanh(mayTatCaTho));

  /**
   * ★★★ TẬP MÁY CỦA CHUYỀN — qua `mayCuaLine`, nơi **TRẠM THẮNG `lineId` khai**.
   *   Đo được 2026-09-09: bảng `machines` **không có cột `lineId`**; máy thuộc
   *   chuyền **gián tiếp qua `stationId`**, và `stations.lineId` là cột có ràng
   *   buộc khoá ngoại. Trường `lineId` mà client thấy là một giá trị **đã suy**.
   */
  const mayLine = useMemo(() => mayCuaLine(lineId, mayTatCa, tram), [lineId, mayTatCa, tram]);

  const trangThaiTheoMayTho = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayTatCa) m.set(mv.id, trangThaiHienThi(mv, bayGio).trangThai);
    return m;
  }, [mayTatCa, bayGio]);
  // ★ Đợt 38 — `bayGio` đổi mỗi render; chỉ đổi tham chiếu khi một trạng thái ĐỔI.
  const trangThaiTheoMay = useOnDinhTheoGiaTri(trangThaiTheoMayTho, khoaBanDo(trangThaiTheoMayTho));

  const maTheoMay = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayTatCa) m.set(mv.id, mv.ma);
    return m;
  }, [mayTatCa]);
  /*
   * ★★★ ĐỢT 38 (Pareto #7 QA Đợt 37) — NHÃN 3D cấp Line dùng MÃ NGẮN (rút tiền tố chung `SIM-L2-`). Đo 1280×720:
   *   12 nóc máy cách nhau ~60 px, nhãn 144–191 px ⇒ declutter giấu 5/12 ("5 more names hidden"); 1600: 1/12.
   *   Tiền tố chung của CẢ chuyền không mang thông tin ở màn chỉ-có-chuyền-này (breadcrumb + tiêu đề đã nói);
   *   mã đầy đủ vẫn ở danh sách máy, chip, cảnh báo (`dungCanhBao3D` nhận `maTheoMay` nguyên). Cùng hàm với
   *   `DaiLine` (G12) — tiền tố rút ở dải cũng in ra ở đầu dải.
   * ⚠ Tính trên `mayLine` (12 máy CỦA CHUYỀN), KHÔNG trên `mayTatCa` (cả nhà máy): đo lần đầu trên `mayTatCa`
   *   ⇒ tiền tố chung của 42 máy nhiều chuyền là rỗng ⇒ nhãn vẫn `SIM-L2-…`, 5/12 vẫn bị giấu (`.qa-dot38/sau/`).
   */
  const tienToMa = useMemo(() => tienToChung(mayLine.map((m) => m.ma)), [mayLine]);
  const maNganTheoMay = useMemo(() => {
    const m = new Map<number, string>();
    for (const [id, ma] of maTheoMay) m.set(id, rutTienTo(ma, tienToMa));
    return m;
  }, [maTheoMay, tienToMa]);

  const kichThuocTheoLoai = useMemo(() => {
    const m = new Map<string, { rongMm: number; caoMm: number; sauMm: number }>();
    for (const k of canhQ.data?.kichThuoc ?? []) {
      m.set(k.loaiMay, { rongMm: k.rongMm, caoMm: k.caoMm, sauMm: k.sauMm });
    }
    return m;
  }, [canhQ.data]);

  /*
   * ★ Đặt chỗ theo máy — **KHÔNG lọc theo tầng** ở màn này. Xem docblock của
   *   `canhQ` phía trên: chuyền là đơn vị, tầng chỉ là chỗ máy đứng.
   */
  const datChoTheoMay = useMemo(() => {
    type HangDatCho = NonNullable<typeof canhQ.data>["datCho"][number];
    const m = new Map<number, HangDatCho>();
    for (const d of canhQ.data?.datCho ?? []) {
      if (d.loaiThucThe !== "machine") continue;
      m.set(d.thucTheId, d);
    }
    return m;
  }, [canhQ.data]);

  /* ── CẢNH 3D ─────────────────────────────────────────────────────────── */
  const mauNenCanh = mauCss("--background", "#f8fafc");

  /**
   * ★★★ `dungMayVe` — CÙNG hàm mà `/twin` dùng (`hopNhatCanh.ts:169`, G12).
   *
   * ⚠⚠⚠ **G93 — ĐÂY LÀ MỘT KHỚP NỐI MỚI, TỨC LÀ MỘT BỀ MẶT LỖI MỚI.** Đợt 29
   *   đo được: ba đột biến **ở chỗ gọi** sống sót cả 1.998 test, vì lưới module
   *   chỉ chứng minh *hàm đúng khi được gọi đúng* — nó **không biết trang gọi
   *   bằng đối số nào**. Ba đối số dưới đây được ghim bằng
   *   `manLineNoiVaoTrang.unit.test.ts`:
   *     ① `may: mayLine` (KHÔNG `mayTatCa`) — vẽ cả 43 máy trên màn Line là
   *        đúng lỗi F2 ở dạng khác: 31 máy chuyền khác dựng thành khối lạ.
   *     ② `trongPhamVi(..., { cap: "line", id: lineId })` — phạm vi là CHUYỀN
   *        này, không phải tầng đang xem.
   *     ③ `tangId` của **HÀNG ĐẶT CHỖ** (`tangIdCuaDatCho`), không phải một
   *        `tangId` của trang — màn này không có "tầng đang xem".
   */
  const mayVe = useMemo<MayTrongLo[]>(
    () =>
      dungMayVe({
        may: mayLine,
        datChoTheoMay,
        kichThuocTheoLoai,
        trangThaiTheoMay,
        trongPhamVi: (mv, tangIdCuaDatCho) =>
          trongPhamVi(
            {
              machineId: mv.id,
              stationId: mv.stationId,
              lineId: mv.lineId,
              workshopId: null,
              factoryId,
              tangId: tangIdCuaDatCho,
            },
            phamViCuaManLine(lineId),
          ),
        mauNenCanh,
        tiLePhaNgoaiPhamVi: TI_LE_PHA_NGOAI_PHAM_VI,
        congCu: { mauCss, phaVeNen, mauChoTrangThai, hinhKhoiCho },
      }),
    [mayLine, datChoTheoMay, kichThuocTheoLoai, trangThaiTheoMay, lineId, factoryId, mauNenCanh],
  );

  /**
   * Hình học đường tâm chuyền — `dungHinhLine` (`canhLine.ts:79`), CÙNG hàm mà
   * `/twin` dùng. `thuocVe` là **`mayTatCa`** chứ không `mayLine`: hàm tra
   * `lineId`/`stationId` của một máy qua bảng này, và thu hẹp nó không đổi kết
   * quả nhưng làm hàm mất khả năng nhận ra máy nằm ngoài (giữ đúng bản gốc).
   */
  const hinhLine = useMemo(
    () => dungHinhLine(lineId, tram, mayVe, mayTatCa, canhQ.data?.datCho ?? []),
    [lineId, tram, mayVe, mayTatCa, canhQ.data],
  );

  /* ── WIP: một phép ghép, hai người đọc (§11.5 + G12) ─────────────────── */
  const tamTram = useMemo(() => {
    const m = new Map<number, { x: number; z: number }>();
    for (const s of hinhLine?.tram ?? []) {
      const id = Number(s.khoa.slice("station:".length));
      if (Number.isFinite(id)) m.set(id, { x: s.tam.x, z: s.tam.z });
    }
    return m;
  }, [hinhLine]);

  const tinhWip = useMemo(
    () =>
      tinhWipLine({
        lineId,
        tram,
        tamTram,
        // ★★★ `isSuccess`, KHÔNG `!isLoading`: 403/lỗi cũng làm `isLoading` tắt,
        //   và khi ấy mọi trạm sẽ nhận `0` — lời khai *"đã kiểm tra, chuyền
        //   trống"* cho một người chỉ đơn giản là không có quyền.
        daDo: wipQ.isSuccess,
        soTheoTram: new Map((wipQ.data?.stations ?? []).map((s) => [s.stationId, s.wipCount])),
      }),
    [lineId, tram, tamTram, wipQ.isSuccess, wipQ.data],
  );

  /**
   * ★ Lời khai nút thắt của server **KÈM TUỔI**. Đợt 8 đo được trên chính CSDL
   *   này: bản ghi `line_balance` mới nhất của chuyền 1 đã **16 ngày 18 giờ
   *   tuổi**, và nó tô đỏ trạm 10 (124 WIP) trong khi trạm 1 giữ **3.152 chiếc**.
   *   Một lời khai hết hạn vẫn là lời khai; nó không được bác một phép đo SỐNG.
   *   ⛔ **KHÔNG** dùng `stationLoadHeatmap` cho việc này (§15.6 **D-2**): nó
   *   không trả `periodStart` nên **không tự kiểm hạn được**.
   */
  const khaiNghen = useMemo(() => {
    const hang = canBangQ.data?.[0];
    const moc = hang?.periodStart ? new Date(hang.periodStart).getTime() : null;
    return {
      nghenTheoServer: hang?.bottleneckStationId ?? null,
      mocKhai: Number.isFinite(moc) ? moc : null,
      bayGio: bayGioThat,
    };
  }, [canBangQ.data, bayGioThat]);

  const cotWipTho = useMemo(() => cotWip(tinhWip, khaiNghen), [tinhWip, khaiNghen]);
  // ★ Đợt 38 — `CanhVanHanh` có `useEffect([wip]) → invalidate()`; gói WIP 2 s dựng mảng mới dù số y nguyên ⇒ ổn định theo giá trị.
  const cotWipCanh = useOnDinhTheoGiaTri(cotWipTho, JSON.stringify(cotWipTho));
  const bangWip = useMemo(() => xepHangWip(tinhWip, khaiNghen), [tinhWip, khaiNghen]);
  const nhipChuyenMs = useMemo(
    () => nhipTuCanBang(canBangQ.data?.[0]?.avgCycleTimeMs),
    [canBangQ.data],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 34 (QĐ-24) ← ĐỢT 19 LÔ X — §11 #30 what-if + #35 phát lại      */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ ĐÂY LÀ MẶT **SẼ THẾ NÀO NẾU** DUY NHẤT của cả ba màn twin — §12b.2 G-2 gọi nó là *"mặt mô
   *   phỏng duy nhất, đúng nghĩa digital **twin** chứ không phải digital shadow"*. Nó ở màn LINE vì
   *   what-if là đại lượng CỦA MỘT CHUYỀN (mọi tham số đều theo `lineId`), và ở đây `lineId` là chắc
   *   chắn — không có nhánh "nếu đang ở cấp Line" (QĐ-19 mua được đúng sự đơn giản này).
   *
   * ★ `digitalTwin.whatIf` là **hàm thuần, không chạm CSDL** (`digitalTwinRouter.ts:207-232`) ⇒ Q1 cố
   *   ý MIỄN TRỪ nó khỏi hàng rào tenant: mọi con số nó trả về suy từ chính `input` ta gửi lên. Hệ quả
   *   PHẢI nhớ: **rủi ro nằm ở đầu vào TA dựng** — server không biết `cycleTimeSec` đã 18 ngày tuổi.
   */
  const [horizonHours, datHorizon] = useState(8);
  const [heSoCycle, datHeSoCycle] = useState(1);

  /**
   * ★★★ CỬA KIỂM HẠN ĐỨNG Ở ĐÂY, TRƯỚC KHI GỌI — G30, bài học Đợt 8. `dungDauVaoWhatIf` dùng lại
   *   `conHieuLuc` (8 giờ) của `wipTram.ts` — CÙNG hằng, CÙNG hàm với lời khai nút thắt (G12).
   *
   * ⚠ ĐO ĐƯỢC trên CSDL này (2026-09-08, đo lại 2026-09-10): hàng `line_balance` mới nhất của chuyền 1
   *   là 2026-08-21 và có `avgCycleTimeMs` **NULL** ⇒ ngăn ra `ban_ghi_khong_co_nhip` — hiện `—` kèm
   *   lý do, KHÔNG hiện `0`. Đó là kết quả ĐÚNG (G45/G50), không phải phần chưa làm xong.
   */
  const dungWhatIf = useMemo(
    () =>
      dungDauVaoWhatIf({
        lineId,
        tram: tram
          .filter((s) => s.lineId === lineId)
          .map((s) => ({ stationId: s.id, ten: s.ten ?? null })),
        // `undefined` = chưa đo (đang tải / bị từ chối); `null` = đã chạy xong nhưng 0 hàng — hai câu
        // KHÁC NHAU, và ngăn nói ra khác nhau.
        nhip: canBangQ.isSuccess
          ? canBangQ.data?.[0]
            ? {
                avgCycleTimeMs: canBangQ.data[0].avgCycleTimeMs ?? null,
                mocKhai: khaiNghen.mocKhai,
              }
            : null
          : undefined,
        horizonHours,
        cycleTimeMultiplier: heSoCycle,
        bayGio: bayGioThat,
      }),
    [lineId, tram, canBangQ.isSuccess, canBangQ.data, khaiNghen.mocKhai, horizonHours, heSoCycle, bayGioThat],
  );

  /*
   * ★ G37: hook KHÔNG tự đọc route và KHÔNG tự gọi `hasPermission` — trang đọc quyền rồi TRUYỀN XUỐNG
   *   (`orchestration.listWorkflows`/`simulate` đòi `machine_monitoring/canView`; thiếu ⇒ ngăn ẨN mục
   *   #35, không bắn truy vấn, `nganXuLyLogic.ts:102-111`).
   */
  const coQuyenXemQuyTrinh = hasPermission("machine_monitoring", "canView");
  const { whatIfQ, dsWorkflowQ, phatLaiQ, daBamChay, datDaBamChay, workflowRef, datWorkflowRef } =
    useMoPhongTwin({ dungWhatIf, coQuyenXemQuyTrinh, lineDangXem: lineId, horizonHours, heSoCycle });

  /** Tên trạm theo id — để bảng what-if không chỉ in `#7`. */
  const tenTramTheoId = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of tram) if (s.ten) m.set(s.id, s.ten);
    return m;
  }, [tram]);

  /* ── Nhãn + cảnh báo neo vật thể — NHÓM (A), trần ≤ 13 ở cấp Line ────── */
  /*
   * ★★★ Đợt 35 (Pareto #5) — máy có andon MỞ ⇒ nhãn `batThuong` (NT-2 cho luật ưu tiên nhãn + chip
   *   "N sự cố ngoài khung"). Đọc thẳng `andonQ.data` (cùng bộ lọc `resolved` với `andonRows` khai ở dưới —
   *   thứ tự hook không cho dùng `andonRows` ở đây).
   */
  const andonTheoMay = useMemo(
    () =>
      new Set(
        ((andonQ.data ?? []) as Array<{ machineId: number | null; status: string }>)
          .filter((a) => a.status !== "resolved" && a.machineId != null)
          .map((a) => a.machineId as number),
      ),
    [andonQ.data],
  );
  const nhan = useMemo<NhanTheGioi[]>(
    () => dungNhanMay({ mayVe, trangThaiTheoMay, maTheoMay: maNganTheoMay, mauChoTrangThai, t, andonTheoMay }),
    [mayVe, trangThaiTheoMay, maNganTheoMay, t, andonTheoMay],
  );

  /*
   * ★★★ KHÔNG `gopNhan(nhan, nhanLine)` Ở ĐÂY — và đó là một QUYẾT ĐỊNH, không
   *   phải một chỗ bỏ sót. Nhãn Line (#54) trả lời câu *"chuyền nào?"*; ở màn
   *   này câu ấy **đã có trong breadcrumb và tiêu đề**. Neo thêm một nhãn
   *   "Chuyền 2" giữa cảnh chỉ-có-chuyền-2 là tiêu ngân sách nhãn (§15.6.2: trần
   *   30 là trần **MẮT NGƯỜI**, thừa ngân sách KHÔNG phải lý do để tiêu) để lặp
   *   lại một sự thật người xem vừa đọc.
   */

  const andonRows = useMemo(
    () =>
      ((andonQ.data ?? []) as Array<{
        id: number;
        machineId: number | null;
        state: string;
        status: string;
        title: string;
        raisedAt: string | Date;
      }>).filter((a) => a.status !== "resolved"),
    [andonQ.data],
  );

  const canhBao3D = useMemo<CanhBaoTheGioi[]>(
    () =>
      dungCanhBao3D(andonRows, mayVe, maTheoMay).map((c) => ({
        ...c,
        muc: c.muc as MucCanhBao,
      })),
    [andonRows, mayVe, maTheoMay],
  );

  /* ── Camera bay DỌC theo chuyền — trừ khi deep-link nói rõ `?cam=` (Đợt 33) ── */
  /*
   * ★★★ ĐỢT 35 (Pareto #5) — bbox KÈM đỉnh cột WIP (`bboxKemCotWip`, cột tới 6 m) + KHUNG canvas
   *   thật (`kichThuocKhung`) ⇒ `khungNhinLine` khớp khoảng cách để 12/12 máy VÀ cột WIP lọt khung,
   *   chừa lề nhãn. Chưa đo được khung (khung hình đầu) ⇒ hành vi cũ, rồi khớp lại khi có số đo.
   */
  /*
   * ★ Đợt 45 (mục 3) — SAU khớp khoảng cách, DỊCH KHUNG DỌC (`dichKhungDoc`): dải máy về nửa
   *   giữa-dưới canvas (QA Đợt 44: tâm nhãn ~48 %, nửa dưới trống). Ghép ở ĐÂY — cách trình
   *   bày của màn Line — không đổi hợp đồng `khungNhinLine`. `?cam=` deep-link vẫn đi thẳng.
   */
  const khungNhinTho = useMemo(() => {
    if (camUrl) return khungNhinTuCamera(camUrl);
    if (!hinhLine || !hinhLine.hh.coHinhHoc) return null;
    const bbox = bboxKemCotWip(hinhLine.hh.bbox, cotWipCanh);
    const k = khungNhinLine(bbox, hinhLine.hh.truc, hinhLine.hh.trucDangTin, kichThuocKhung ?? undefined);
    return k && kichThuocKhung ? dichKhungDoc(bbox, k, kichThuocKhung) : k;
  }, [camUrl, hinhLine, cotWipCanh, kichThuocKhung]);
  /*
   * ★★★ ỔN ĐỊNH THEO GIÁ TRỊ — `DieuKhien` (CanhVanHanh) khởi động TWEEN mỗi khi `khungNhin` đổi THAM
   *   CHIẾU, không so giá trị. `hinhLine` dựng lại mỗi khi `mayVe` đổi (trạng thái/tuổi làm mới theo
   *   nhịp), `cotWipCanh` đổi theo WIP ⇒ không có bước này camera bay lại về CÙNG chỗ mỗi nhịp: giật
   *   camera người dùng vừa xoay, và vẽ ~30 khung/lần khi đứng yên (một phần của Pareto #6 mà brief
   *   không nêu). Khoá = toạ độ làm tròn mm; cùng khoá ⇒ cùng đối tượng.
   */
  const khoaKhungNhin = khungNhinTho
    ? `${khungNhinTho.viTri.map((v) => v.toFixed(3)).join(",")}|${khungNhinTho.muc.map((v) => v.toFixed(3)).join(",")}`
    : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cố ý: chỉ đổi đối tượng khi GIÁ TRỊ đổi
  const khungNhin = useMemo(() => khungNhinTho, [khoaKhungNhin]);

  /* ── (B) LỚP PHỦ 2D — chip trái ──────────────────────────────────────── */
  /*
   * ★★★ ĐẾM CHẠY/DỪNG QUA `tinhKpiNoi`, KHÔNG TỰ ĐẾM (G12). Từ vựng hợp đồng là
   *   `running`/`down`/`idle`/`offline` — một bản đếm thứ hai so `"chay"`/
   *   `"dung"` sẽ ra **0 ở mọi ô** mà không lỗi nào nổ.
   * ★ `chuaDo` THẮNG dữ liệu: overview đang tải / bị từ chối ⇒ mọi ô ra `—`,
   *   không phải `0` (NT-3.5).
   */
  const kpi = useMemo(() => {
    const theoId = new Map(
      ((overviewQ.data?.machines ?? []) as Array<{
        id: number;
        status: string;
        oeePercent?: number | null;
        andonActive?: boolean;
        pdmRiskHigh?: boolean;
      }>).map((n) => [n.id, n]),
    );
    const dsKpi: MayTongQuanKpi[] = mayLine.map((m) => {
      const n = theoId.get(m.id);
      return {
        id: m.id,
        status: n?.status ?? "offline",
        oeePercent: n?.oeePercent ?? null,
        andonActive: n?.andonActive ?? false,
        pdmRiskHigh: n?.pdmRiskHigh ?? false,
      };
    });
    return tinhKpiNoi(dsKpi, !overviewQ.isSuccess);
  }, [mayLine, overviewQ.data, overviewQ.isSuccess]);

  const tomTat = useMemo(
    () => tomTatLine(mayLine, tram.filter((s) => s.lineId === lineId), tinhWip, khaiNghen),
    [mayLine, tram, lineId, tinhWip, khaiNghen],
  );

  /* ── (C) PANEL — dải trạm 2D SONG SONG (§11.5) ───────────────────────── */
  const hangDai = useMemo(
    () => hangDaiLine({ lineId, tram, may: mayTatCa, trangThaiTheoMay, bangWip }),
    [lineId, tram, mayTatCa, trangThaiTheoMay, bangWip],
  );

  /** Ô trạm trên dải 2D ⇒ máy đầu của trạm ⇒ màn Máy (QĐ-23 #2). */
  const chonTram = useCallback(
    (stationId: number) => {
      const mayDau = mayLine.find((m) => m.stationId === stationId);
      if (mayDau) dieuHuongToiMay(mayDau.id);
    },
    [mayLine, dieuHuongToiMay],
  );

  const tenLine =
    lineHienTai?.ten || lineHienTai?.ma || t("twin3d.line.chuyenSo", "Chuyền {{n}}", { n: lineId });

  const sanRongM = toaNhaDau ? Number(toaNhaDau.rongMm) / 1000 : 60;
  const sanSauM = toaNhaDau ? Number(toaNhaDau.sauMm) / 1000 : 40;

  const dangTai = canhQ.isLoading || overviewQ.isLoading;
  /*
   * ★★★ "CHƯA TẢI XONG" **KHÁC** "CHUYỀN NÀY KHÔNG CÓ MÁY" — NT-3.5 (đếm rỗng
   *   khác đếm bằng 0). Hiện `EmptyState` trong lúc truy vấn còn chạy sẽ khai
   *   *"chuyền rỗng"* về một chuyền ta chưa hỏi xong.
   */
  const rongThat = !dangTai && canhQ.isSuccess && mayLine.length === 0;
  /*
   * ★★★ ĐỢT 35 (Pareto #7) — 0 NHÀ MÁY (operator1, 0 gán) PHẢI NÓI RA. `rongThat` không bao giờ tới được ca
   *   này vì `canhQ` TẮT khi `factoryId = null` ⇒ trước đợt này màn hiện sàn trống + "— machines" câm. Lý do
   *   qua lát thuần `lyDoMoManLine`; câu qua `cauChoLyDoManMay("chuaGanNhaMay")` (i18n ×3 có sẵn).
   * ★ `chuaBiet`: ba ô đếm ở thanh trên in `—` (NT-3.5: chưa được gán ≠ chuyền có 0 máy).
   */
  /*
   * ★★★ ĐỢT 36 — THIẾU QUYỀN THẬT = server TỪ CHỐI (`FORBIDDEN`) một truy vấn nền của màn (cùng cách bắt
   *   với `TwinMay.tsx` Đợt 34 D). Đo trước vá: user chỉ `analytics_oee` + gán nhà máy ⇒ `overview` 403 mà
   *   màn vẫn mở canvas, "Machines 12", 12 máy "Unknown", không một câu — nay `line-khong-mo-duoc`
   *   `data-ly-do="thieuQuyen"`, 0 canvas, ba ô đếm `—` (`chuaBiet`). Bốn truy vấn: ba hình học
   *   (`quyenDocHinhHoc`) + `overview` (`machine_status`) — hai cổng KHÁC nhau, thiếu một là thiếu.
   */
  const thieuQuyen =
    (canhQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (toaNhaQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (chiTietQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (overviewQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN";
  const lyDoLine = lyDoMoManLine({
    factoriesDangTai: factoriesQ.isLoading,
    factoriesLoi: factoriesQ.isError,
    soNhaMay: factories.length,
    thieuQuyen,
  });
  const chuaBiet = dangTai || lyDoLine !== "mo";

  return (
    <div
      ref={khungRef}
      className="relative flex min-h-0 flex-col overflow-hidden"
      style={{ height: chieuCaoTruDinh("--twin-line-top") }}
      data-testid="man-twin-line"
    >
      {/* ── Thanh trên: breadcrumb + tiêu đề ─────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm"
        data-testid="thanh-tren-line"
      >
        {/*
          ★ ĐƯỜNG RA #1 — về màn nhà máy. `<Link>` của wouter chứ không
            `window.location`: giữ SPA và giữ đúng một mục lịch sử, nên Back của
            trình duyệt (đường ra #2) hoạt động.
          ⚠ G85 — `data-testid` đặt TRÊN `<Link>` chứ không trên một `<Button
            asChild>`: Radix `asChild` THAY THẾ phần tử con, và thuộc tính trên
            cha **biến mất không báo lỗi**.
        */}
        <Link
          /* ★ Đợt 33 (QĐ-23 #5): về ĐÚNG `?pv=` vừa xem (từ `history.state`), không về mặc định. */
          href={duongVe ?? "/twin"}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid="ve-man-nha-may"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("twin3d.line.veNhaMay", "Nhà máy")}
        </Link>
        <span className="text-muted-foreground">›</span>
        <span className="font-medium" data-testid="ten-line">
          {tenLine}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span data-testid="dem-may-line">
            {t("twin3d.vanHanh.soMay", "Máy")} {hienSo(tomTat.soMay, chuaBiet)}
          </span>
          <span data-testid="dem-tram-line">
            {t("twin3d.line.soTram", "Trạm")} {hienSo(tomTat.soTram, chuaBiet)}
          </span>
          {/* ★ `hienSo` in `—` cho `null` — tổng WIP chỉ đo được một phần thì
              KHÔNG in một con số nhỏ hơn sự thật. */}
          <span data-testid="tong-wip-line">
            WIP {hienSo(tomTat.tongWip, chuaBiet)}
          </span>
        </span>
      </div>

      {/* ── Khung cảnh: canvas chiếm trọn, lớp phủ ĐÈ lên ───────────────── */}
      <div ref={khungCanhRef} className="relative min-h-0 flex-1">
        {lyDoLine !== "mo" ? (
          /*
           * ★★★ Đợt 35 (Pareto #7) — L-5 cho cấp Line: KHÔNG canvas, KHÔNG "— machines" câm. Nhánh này đứng
           *   TRƯỚC `rongThat` (loại-trừ `? :`, không song song — G87 vẫn đúng MỘT `<CanhVanHanh>`).
           */
          <div
            className="flex h-full items-center justify-center p-6"
            data-testid="line-khong-mo-duoc"
            data-ly-do={lyDoLine}
          >
            <EmptyState
              title={t("twin3d.line.khongMoDuoc", "Không mở được chuyền #{{n}}", { n: lineId })}
              description={t(cauChoLyDoManMay(lyDoLine).khoa, cauChoLyDoManMay(lyDoLine).duPhong)}
              actionLabel={t("twin3d.line.veNhaMay", "Nhà máy")}
              onAction={() => setLocation(duongVe ?? "/twin")}
            />
          </div>
        ) : rongThat ? (
          <div className="flex h-full items-center justify-center p-6" data-testid="line-rong">
            <EmptyState
              title={t("twin3d.line.rong", "Chuyền này chưa có máy nào trên bố cục")}
              description={t(
                "twin3d.line.rongMo",
                "Chuyền có thể chưa được xếp chỗ trong Twin Studio, hoặc thuộc một nhà máy khác.",
              )}
            />
          </div>
        ) : (
          <>
            {/*
              ★★★ **ĐÚNG MỘT `<CanhVanHanh>`** — và nó KHÔNG nằm trong một nhánh
                điều kiện nào có thể dựng thêm một cái thứ hai. `KhungCanh` bên
                trong đếm `window.__soCanvas`; ở màn này nó phải **= 1** (G87).
                Nhánh `rongThat` ở trên là loại-trừ (`? :`), không phải song song.
            */}
            <CanhVanHanh
              may={mayVe}
              nhan={nhan}
              canhBao={canhBao3D}
              /* ★ Mũi tên dòng chảy — `nhipMs = null` ⇒ ĐỨNG YÊN, đúng cam kết
                   của `DongChayLine`. §15.6 **D-7** cấm hoạt ảnh băng tải; đây
                   là mũi tên chỉ HƯỚNG, tốc độ mã hoá nhịp THẬT. */
              dongChay={
                hinhLine && hinhLine.hh.coHinhHoc
                  ? { diem: hinhLine.hh.diemDuongTam, nhipMs: nhipChuyenMs }
                  : null
              }
              wip={cotWipCanh}
              /* ★★★ §15.6 **D-12** — `vung` KHÔNG truyền: đo 2026-09-08 có **0
                   hàng `twin_vat_the` kiểu `vung`**, và ở cấp Line/Máy nó nằm
                   trong nhóm (D). Dành chỗ cho một nguồn rỗng là hứa mà không
                   giao. `vienSucKhoe` cũng KHÔNG truyền: §15.6.1 xếp nó vào cấp
                   **Máy** (≤ 3 nhãn), không phải cấp Line. */
              /* ★ Đợt 33 (QĐ-23 #2): không còn "máy đang chọn" ở màn này — bấm là ĐI. */
              machineIdChon={null}
              onChonMay={dieuHuongToiMay}
              khungNhin={khungNhin}
              sanRongM={sanRongM}
              sanSauM={sanSauM}
              tatNhan={false}
              chuNhanAn={(n) => t("twin3d.vanHanh.nhanBiAn", "còn {{n}} tên bị ẩn", { n })}
              /* ★ Đợt 35 (Pareto #5): chip "N sự cố ngoài khung" — andon trên máy ngoài frustum
                   không được câm (QA Đợt 32 `raised/`). `t()` ở đây, cảnh không gọi (RB-8.3). */
              chuSuCoNgoaiKhung={(n) =>
                t("twin3d.vanHanh.suCoNgoaiKhung", "{{n}} sự cố ngoài khung", { n })
              }
              /* ★ Đợt 49 (mục D): chip "còn N cảnh báo ẩn" — badge bị lớp phủ che / hết chỗ dời. */
              chuCanhBaoAn={(n) => t("twin3d.vanHanh.canhBaoBiAn", "còn {{n}} cảnh báo ẩn", { n })}
              chuMatContext={t("twin3d.loi.matContext")}
              ariaLabel={t("twin3d.line.ariaCanh", "Cảnh 3D của {{ten}}", { ten: tenLine })}
            />

            {/* ★ (B) chip trái — 0 draw call, `pointer-events-none` bên trong
                  `BangKpiNoi` để kéo xoay camera vẫn xuyên qua được. */}
            <BangKpiNoi
              kpi={kpi}
              dangTai={!overviewQ.isSuccess}
              mo={moKpi}
              onDoiMo={datMoKpi}
              nhanPhamVi={tenLine}
            />

            {/*
              ── ★★★ Đợt 34 (QĐ-24) — NGĂN "MÔ PHỎNG" (§11 #30 + #35), góc PHẢI trên ──
              Lớp phủ DOM anh em của `<Canvas>` (0 draw call, §4), `z-30` trên nhãn drei z-20 (G41),
              khung ngoài `pointer-events-none` để kéo xoay camera vẫn xuyên qua (ngăn tự bật lại cho
              phần tương tác). Cùng props với bản `/twin` trước QĐ-24 — hook và ngăn không đổi một luật.
            */}
            <NganMoPhong
              mo={moMoPhong}
              onDoiMo={datMoMoPhong}
              dungDauVao={dungWhatIf}
              horizonHours={horizonHours}
              onDoiHorizon={(g) => datHorizon(kep(g, HORIZON_MIN, HORIZON_MAX, 8))}
              heSo={heSoCycle}
              onDoiHeSo={(h) => datHeSoCycle(kep(h, HE_SO_MIN, HE_SO_MAX, 1))}
              ketQua={whatIfQ.data}
              dangChayWhatIf={daBamChay && whatIfQ.isLoading}
              onChayWhatIf={() => datDaBamChay(true)}
              tenTram={tenTramTheoId}
              /* ★ `null` = thiếu quyền ⇒ ngăn ẨN cả mục #35 (luật ẩn-không-disable); `[]` = có quyền,
                   chưa có quy trình nào — câu đó ngăn nói ra chứ không im lặng biến mất. */
              workflow={coQuyenXemQuyTrinh ? (dsWorkflowQ.data ?? []) : null}
              workflowRef={workflowRef}
              onDoiWorkflow={datWorkflowRef}
              phatLai={phatLaiQ.data}
              dangChayPhatLai={workflowRef !== null && phatLaiQ.isLoading}
            />
          </>
        )}
      </div>

      {/* ── (C) DẢI TRẠM 2D — bản SONG SONG của lớp phủ WIP 3D (§11.5) ──── */}
      {/*
        ★★★ `bangWip` và `cotWipCanh` ra từ CÙNG `tinhWip` và CÙNG `laNghen()`.
          Nếu 3D tô đỏ trạm 7 thì dòng trạm 7 ở đây BẮT BUỘC mang `nghen: true`
          — không có đường nào để hai bề mặt lệch nhau, vì không có phép tính
          thứ hai (G12).
        ★ Dải hiện cả khi `rongThat`: một chuyền có trạm mà chưa có máy vẫn phải
          đọc được danh sách trạm của nó.
        ★★★ Đợt 36 — nhưng KHÔNG hiện khi `lyDoLine !== "mo"`: ảnh tự chụp `i6-forbidden-line` (user chỉ
          `analytics_oee`) cho thấy "Cannot open line #2" mà dải 12 trạm + WIP vẫn nằm dưới — hình học
          qua `quyenDocHinhHoc` (được), `overview` bị 403. Một màn vừa nói "không mở được" vừa bày dữ
          liệu là hai câu trả lời trên một màn (D-5). Với `chuaGanNhaMay` dải vốn rỗng (canhQ tắt) —
          nay hai lý do cùng một hình.

        ★ `shrink-0` + `overflow-x-auto`: dải giữ nguyên chiều cao nội dung
          (≈93 px cho 12 ô) và **cuộn NGANG** khi chuyền dài, thay vì bóp ô trạm
          hay đẩy canvas. ⚠ KHÔNG cho nó `flex-1`: Đợt 22 đo được `DaiCanhBao`
          không có trần đã lấy 84 % panel trái và bóp `danh-sach-may` về
          **h = 0** — một flex item không có trần lấy chiều cao theo NỘI DUNG,
          và anh em `flex-1` của nó chỉ còn phần dư.
      */}
      {hangDai.length > 0 && lyDoLine === "mo" ? (
        <div className="shrink-0 overflow-x-auto" data-testid="khoi-dai-line">
          <DaiLine
            tram={hangDai}
            nhipChuyenMs={nhipChuyenMs}
            stationIdChon={null}
            onChonTram={chonTram}
          />
        </div>
      ) : null}
    </div>
  );
}
