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
  hangDaiLine,
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

  return <ThanManLine lineId={lineId} camUrl={camUrl} duongVe={duongVe} />;
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
}

export function ThanManLine({ lineId, camUrl = null, duongVe = null }: ThanManLineProps) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [moKpi, datMoKpi] = useState(true);

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
  useEffect(() => {
    const el = khungRef.current;
    if (!el) return;
    const doLai = () => {
      const tren = el.getBoundingClientRect().top;
      el.style.setProperty("--twin-line-top", `${Math.max(0, Math.round(tren))}px`);
    };
    doLai();
    // ★ Vỏ ứng dụng đổi chiều cao khi thu/mở sidebar hay đổi cỡ cửa sổ.
    const ro = new ResizeObserver(doLai);
    ro.observe(document.body);
    window.addEventListener("resize", doLai);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", doLai);
    };
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
  const canhQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: factoryId ?? 0, tangIds: tangIdsHoi },
    { enabled: factoryId !== null, retry: false },
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
    () => tsTrangThaiTheoMay(overviewQ.data?.machines ?? [], overviewQ.data?.issues ?? [], bayGioThat),
    [overviewQ.data, bayGioThat],
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

  const mayTatCa = useMemo(() => hopNhat(mayNen, kho), [mayNen, kho]);

  /**
   * ★★★ TẬP MÁY CỦA CHUYỀN — qua `mayCuaLine`, nơi **TRẠM THẮNG `lineId` khai**.
   *   Đo được 2026-09-09: bảng `machines` **không có cột `lineId`**; máy thuộc
   *   chuyền **gián tiếp qua `stationId`**, và `stations.lineId` là cột có ràng
   *   buộc khoá ngoại. Trường `lineId` mà client thấy là một giá trị **đã suy**.
   */
  const mayLine = useMemo(() => mayCuaLine(lineId, mayTatCa, tram), [lineId, mayTatCa, tram]);

  const trangThaiTheoMay = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayTatCa) m.set(mv.id, trangThaiHienThi(mv, bayGio).trangThai);
    return m;
  }, [mayTatCa, bayGio]);

  const maTheoMay = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayTatCa) m.set(mv.id, mv.ma);
    return m;
  }, [mayTatCa]);

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

  const cotWipCanh = useMemo(() => cotWip(tinhWip, khaiNghen), [tinhWip, khaiNghen]);
  const bangWip = useMemo(() => xepHangWip(tinhWip, khaiNghen), [tinhWip, khaiNghen]);
  const nhipChuyenMs = useMemo(
    () => nhipTuCanBang(canBangQ.data?.[0]?.avgCycleTimeMs),
    [canBangQ.data],
  );

  /* ── Nhãn + cảnh báo neo vật thể — NHÓM (A), trần ≤ 13 ở cấp Line ────── */
  const nhan = useMemo<NhanTheGioi[]>(
    () => dungNhanMay({ mayVe, trangThaiTheoMay, maTheoMay, mauChoTrangThai, t }),
    [mayVe, trangThaiTheoMay, maTheoMay, t],
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
  const khungNhin = useMemo(
    () =>
      camUrl
        ? khungNhinTuCamera(camUrl)
        : hinhLine && hinhLine.hh.coHinhHoc
          ? khungNhinLine(hinhLine.hh.bbox, hinhLine.hh.truc, hinhLine.hh.trucDangTin)
          : null,
    [camUrl, hinhLine],
  );

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

  return (
    <div
      ref={khungRef}
      className="relative flex min-h-0 flex-col overflow-hidden"
      style={{ height: "calc(100vh - var(--twin-line-top, 5rem))" }}
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
            {t("twin3d.vanHanh.soMay", "Máy")} {hienSo(tomTat.soMay, dangTai)}
          </span>
          <span data-testid="dem-tram-line">
            {t("twin3d.line.soTram", "Trạm")} {hienSo(tomTat.soTram, dangTai)}
          </span>
          {/* ★ `hienSo` in `—` cho `null` — tổng WIP chỉ đo được một phần thì
              KHÔNG in một con số nhỏ hơn sự thật. */}
          <span data-testid="tong-wip-line">
            WIP {hienSo(tomTat.tongWip, dangTai)}
          </span>
        </span>
      </div>

      {/* ── Khung cảnh: canvas chiếm trọn, lớp phủ ĐÈ lên ───────────────── */}
      <div className="relative min-h-0 flex-1">
        {rongThat ? (
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

        ★ `shrink-0` + `overflow-x-auto`: dải giữ nguyên chiều cao nội dung
          (≈93 px cho 12 ô) và **cuộn NGANG** khi chuyền dài, thay vì bóp ô trạm
          hay đẩy canvas. ⚠ KHÔNG cho nó `flex-1`: Đợt 22 đo được `DaiCanhBao`
          không có trần đã lấy 84 % panel trái và bóp `danh-sach-may` về
          **h = 0** — một flex item không có trần lấy chiều cao theo NỘI DUNG,
          và anh em `flex-1` của nó chỉ còn phần dư.
      */}
      {hangDai.length > 0 ? (
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
