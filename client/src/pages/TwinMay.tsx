/**
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinMay.tsx` — MÀN **MÁY 3D** RIÊNG (`/twin/may/:id`) — ĐỢT 31
 * ════════════════════════════════════════════════════════════════════════════
 *
 * QĐ-19: *"1 màn canvas là dành cho factory thôi, còn Line/Machine là 2 màn
 * hình khác"* ⇒ **BA MÀN RIÊNG, mỗi màn MỘT canvas**. QĐ-21: URL **phân cấp**
 * `/twin` · `/twin/line/:id` · `/twin/may/:id` · `/twin-studio`. Tiền đề đã đo
 * (`bo-cuc/duongDanBaMan.unit.test.ts`): `/twin` **không nuốt** `/twin/may/5`,
 * đo bằng `regexparam` — chính bộ khớp wouter 3.7.1 dùng bên trong.
 *
 * Khuôn trực tiếp: `TwinLine.tsx` (Đợt 30). Mọi chỗ tệp này làm KHÁC khuôn đều
 * ghi lý do tại chỗ; chỗ nào không ghi là bê nguyên.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BỐ CỤC — HÌNH C (§15.3.3), DỊCH SANG "MÀN RIÊNG"
 * ════════════════════════════════════════════════════════════════════════════
 * §15 đo và nói rõ: *"ở cấp Máy, canvas 3D chỉ chiếm 620×300 = 20 % viewport —
 * phần còn lại là `NganXuLy` + thẻ chỉ số. Càng đi sâu, tỉ lệ 3D càng GIẢM"*
 * (§15.7.1), và §14.8: *"3D được biện minh cho ĐỊNH VỊ, không cho ĐIỀU KHIỂN"*.
 * ⇒ Cảnh 3D ở đây **NHỎ và có trần chiều cao** (`clamp(320px, 36vh, 360px)` —
 *   sàn 320 là `minHeight` của `KhungCanh`, xem chú thích tại khối canvas);
 *   phần lớn màn là **cockpit 2D**. ⛔ Đừng cho khối canvas `flex-1` "cho đẹp" —
 *   đó là đảo ngược một kết luận có nguồn, và lưới khớp nối ghim điều này.
 *
 *     ┌ ‹ Nhà máy › Line N › M-114 ───────────────────────────────────────┐ 44px
 *     ├──────────────────────────────────────────┬────────────────────────┤
 *     │ CẢNH 3D MÁY — 1 canvas, orbit ≤ 8 m       │ NGĂN XỬ LÝ (`NganXuLy`) │
 *     │ + chip (B): mã · loại · trạng thái ·      │ cảnh báo · tạo phiếu ·  │
 *     │   sức khoẻ % + hạng (DOM, 0 draw call)    │ mở chức năng           │
 *     ├──────────────────────────────────────────┤ — mặt GHI duy nhất —    │
 *     │ COCKPIT 2D — `MachineCockpitBody embedded`│ (2 mutation W1/W2, tự   │
 *     │ (cuộn dọc, `flex-1`)                       │  gate từng nút)         │
 *     └──────────────────────────────────────────┴────────────────────────┘
 *
 * §15.6 — thông tin lên 3D, theo NHÓM, cấp Máy:
 *   (A) neo vật thể : **≤ 3** — tên máy · badge cảnh báo · vòng viền sức khoẻ
 *       — chỉ neo vào **MÁY ĐÍCH** (`neoMucTieu`), hàng xóm đọc bằng màu pha.
 *   (B) lớp phủ 2D  : chip trái (DOM, `pointer-events-none`).
 *   (C) panel       : `NganXuLy` (phải) + `MachineCockpitBody` (dưới canvas).
 *   (D) KHÔNG lên 3D: **D-1** nút lệnh OT · **D-8** song ánh khớp robot (không
 *       có nguồn góc khớp — vẽ là BỊA) · **D-9** ảnh AOI từng bo · **D-10** biểu
 *       đồ dài hạn (cockpit 2D có tab Telemetry, đúng chỗ của nó) · **D-11**
 *       công cụ sửa bố cục · **D-12** `vung` (0 hàng).
 *
 * Hàng xóm: Hình C ghi *"nền = cảnh LINE pha về nền 72 % — hàng xóm của máy VẪN
 * THẤY (định vị)"*. Ở màn riêng không có "cảnh thứ hai để pha", nên cách giữ
 * đúng ý là: **vẽ máy đích + máy cùng chuyền** (`mayHangXom`), và `trongPhamVi`
 * cấp `may` làm `dungMayVe` pha hàng xóm 72 % về nền — CÙNG cơ chế `/twin?pv=may`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G87 — MỘT `<CanhVanHanh>`; và MỘT CHỖ `__soCanvas` **MÙ** (ĐO ĐƯỢC)
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp này dựng đúng MỘT `<CanhVanHanh>` (`KhungCanh` đếm `window.__soCanvas`,
 * phải = 1). Nhánh "chưa đặt chỗ" là loại-trừ (`? :`), không song song.
 *
 * ⚠⚠⚠ NHƯNG `MachineCockpitBody` có tab **"3D"** (`MachineCockpit.tsx:281`) dựng
 *   `<Canvas>` của `@react-three/fiber`/drei — **KHÔNG qua `KhungCanh`**, nên
 *   `__soCanvas` **không đếm nó**. Radix `TabsContent` không mount tab không
 *   chọn, nên lúc mở màn chỉ có 1 WebGL context; **bấm tab "3D" ⇒ 2 context**
 *   sống cùng lúc, và phép đo `__soCanvas = 1` vẫn XANH. Đây là **nợ có sẵn**:
 *   `/twin` mở cùng cockpit ấy qua `NganNhung` (`NganNhung.tsx:92`) và mắc y
 *   hệt. Không vá ở đây vì `MachineCockpit.tsx` nằm ngoài tệp của đợt này và
 *   có consumer ngoài Twin (`MachineWorkspace`, §11b). **Viết thành test**
 *   (`manMayNoiVaoTrang.unit.test.ts` ⑧) để nợ có chỗ sống trong mã (G91).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QĐ-18 — MÀN **XEM** Ở CỔNG ROUTE; MẶT GHI TỰ GATE BÊN TRONG `NganXuLy`
 * ════════════════════════════════════════════════════════════════════════════
 * Cổng route thừa `/twin` (`analytics_oee` HOẶC `machine_status`), **không**
 * cổng studio. ⚠⚠⚠ G67: `navHref="/twin"`, KHÔNG `"/twin/may/:id"` —
 * `hasAccessToItem` tìm href **khớp chính xác** trong `navGroups` và `return
 * false` khi không thấy ⇒ từ chối MỌI người, im lặng. Khai ở `App.tsx`.
 *
 * Khác màn Line (0 mutation), cấp Máy **có** `NganXuLy` — §15.3.3 gọi nó là
 * *"mặt ghi duy nhất"*, và nó tự gate từng nút bằng `quyen` (G24: tên module
 * grep ra được — `andon`, `machine_control`, `machine_monitoring`). Tệp này
 * **không có `useMutation` nào của riêng nó**; lưới ⑦ ghim.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔⛔ KHÔNG TRÙNG VIỆC VỚI `/machine/:id` — §11b, ĐỌC TRƯỚC KHI XOÁ
 * ════════════════════════════════════════════════════════════════════════════
 *   `/machine/:id`     → cockpit 2D **toàn trang** (`DashboardLayout`), và với
 *                        `isWorkspaceShellEnabled()` nó REDIRECT sang
 *                        `/device-monitor?machine=` (`App.tsx`). Gate
 *                        `requirePermission="machine_status"`.
 *   `/twin/may/:id`    → **3D định vị + cockpit NHÚNG + `NganXuLy`**  ← TỆP NÀY
 * Màn này **DÙNG** `MachineCockpitBody`, không thay thế nó. Hai thứ KHÁC NHAU.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G37 — VỎ đọc route; THÂN nhận qua tham số
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinMay` (default export) là chỗ **duy nhất** gọi `useRoute`. Nó phân giải
 * `:id` bằng `idMayTuDuongDan` rồi truyền **số** xuống `ThanManMay`. Chính
 * `MachineCockpit.tsx:1216` vẫn còn `Number(params?.id)` — nó được cứu nhờ
 * `validId` bên trong; ở đây ta không dựa vào may mắn ấy.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { useHistoryState } from "wouter/use-browser-location";
import { ArrowLeft } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { isScopeEmpty, scopeEmptyReasonOf } from "@/lib/scopeEmpty";

import { MachineCockpitBody } from "@/pages/MachineCockpit";
import { CanhVanHanh } from "@/components/twin3d/van-hanh/CanhVanHanh";
import { NganXuLy } from "@/components/twin3d/van-hanh/NganXuLy";
import { mauCss } from "@/components/twin3d/van-hanh/mauThree";
import { mauChoTrangThai } from "@/components/twin3d/mauTrangThai";
import { hinhKhoiCho } from "@/components/twin3d/hinhKhoiMay";
import {
  dungCanhBao3D,
  dungMayVe,
  dungNhanMay,
} from "@/components/twin3d/van-hanh/hopNhatCanh";
import {
  khungNhinTuCamera,
  phaVeNen,
  TI_LE_PHA_NGOAI_PHAM_VI,
  trongPhamVi,
} from "@/components/twin3d/van-hanh/phamViCanh";
// ── Đợt 33 (QĐ-23): đường sang màn Line/Máy, đường về `/twin?pv=…`, và `?cam=` ──
import {
  docDuongVeTwin,
  docTrangThaiUrl,
  duongDanManLine,
  duongDanManMay,
  trangThaiVe,
  type TuTheCamera,
} from "@/components/twin3d/van-hanh/duongDanTwin";
import { dongHoHienThi, hopNhat } from "@/components/twin3d/van-hanh/khoTrangThai";
import { useKhoTrangThai } from "@/components/twin3d/van-hanh/useKhoTrangThai";
import { useTrangThaiSong } from "@/components/twin3d/van-hanh/useTrangThaiSong";
import { coLuongTheoKetNoi, nhipHoiMs } from "@/components/twin3d/van-hanh/nguonDuLieu";
import {
  hienSo,
  trangThaiHienThi,
  type MayVanHanh,
  tsTrangThaiTheoMay,
} from "@/components/twin3d/van-hanh/trungThucDuLieu";
import {
  vienSucKhoe,
  type HangSucKhoe,
  type KhaiSucKhoe,
} from "@/components/twin3d/van-hanh/sucKhoeMay";
import type { CanhBaoDangMo, QuyenXuLy } from "@/components/twin3d/van-hanh/nganXuLyLogic";

import { chieuCaoTruDinh, useTruDinhKhung } from "@/components/twin3d/van-hanh/useTruDinhKhung";
import { khoaBanDo, khoaMayVanHanh, useOnDinhTheoGiaTri } from "@/components/twin3d/van-hanh/onDinhTheoGiaTri";
import { giuKhiCungNhaMay } from "@/components/twin3d/van-hanh/giuDuLieuTruoc";
import {
  SAN_KHOI_CANH_MAY_PX,
  chieuCaoKhoiCanhMay,
  idMayTuDuongDan,
  khungNhinMay,
  lineCuaMayTheoTram,
  lyDoMoManMay,
  cauChoLyDoManMay,
  mayHangXom,
  mucTieuTrongCanh,
  phamViCuaManMay,
  tomTatMay,
} from "@/components/twin3d/van-hanh/manMay";
import type { MayTrongLo, NhanTheGioi } from "@/components/twin3d/loi";
import type { CanhBaoTheGioi, MucCanhBao } from "@/components/twin3d/van-hanh/LopCanhBao";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* VỎ — chỗ DUY NHẤT đọc route (G37)                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function TwinMay() {
  const { t } = useTranslation();
  const [khop, tsRoute] = useRoute("/twin/may/:id");

  /*
   * ★★★ `idMayTuDuongDan` TRẢ `null`, KHÔNG `NaN`. `NaN` chảy xuống
   *   `mayHangXom` cho ra `[]` ⇒ màn hiện "máy ngoài phạm vi" về một máy mà ta
   *   chưa từng hỏi — một câu sai thay vì câu đúng "id không hợp lệ".
   */
  const machineId = idMayTuDuongDan(khop ? tsRoute?.id : null);
  /*
   * ★ Đợt 33 — vỏ đọc thêm `?cam=` (Pareto #9) và `history.state.twinVe`
   *   (QĐ-23 #5) rồi TRUYỀN xuống thân — cùng khuôn `TwinLine` (G37). Gọi
   *   TRƯỚC nhánh `return` sớm để thứ tự hook không đổi.
   */
  const search = useSearch();
  const camUrl = useMemo(() => docTrangThaiUrl(search).cam, [search]);
  const duongVe = docDuongVeTwin(useHistoryState());

  if (machineId === null) {
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="may-id-khong-hop-le">
        <EmptyState
          title={t("twin3d.may.idKhongHopLe", "Không đọc được máy từ đường dẫn")}
          description={t(
            "twin3d.may.idKhongHopLeMo",
            "Đường dẫn phải có dạng /twin/may/<số>. Hãy chọn một máy từ màn nhà máy hoặc màn chuyền.",
          )}
        />
      </div>
    );
  }

  return <ThanManMay machineId={machineId} camUrl={camUrl} duongVe={duongVe} />;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* THÂN — nhận `machineId` qua THAM SỐ, không đọc route (G37)                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

export interface ThanManMayProps {
  /** Đã phân giải và ĐÃ kiểm — thân không bao giờ thấy `NaN`. */
  machineId: number;
  /** `?cam=` đã phân tích (vỏ đọc) — `null`/vắng ⇒ orbit gần máy như cũ. */
  camUrl?: TuTheCamera | null;
  /** Đường về `/twin?pv=…` (từ `history.state`, vỏ đọc) — vắng ⇒ `/twin`. */
  duongVe?: string | null;
}

/** Nhãn hạng sức khoẻ — chữ ĐÃ dịch cho chip (B). */
function nhanHang(hang: HangSucKhoe, t: (k: string, d: string) => string): string {
  switch (hang) {
    case "nguy_kich":
      return t("twin3d.may.hang.nguyKich", "nguy kịch");
    case "canh":
      return t("twin3d.may.hang.canh", "cảnh báo");
    case "theo_doi":
      return t("twin3d.may.hang.theoDoi", "theo dõi");
    case "khoe":
      return t("twin3d.may.hang.khoe", "khoẻ");
    case "het_han":
      return t("twin3d.may.hang.hetHan", "quá hạn");
    case "chua_do":
      return t("twin3d.may.hang.chuaDo", "chưa đo");
  }
}

/**
 * ★★★ ĐỢT 38 (phần dư Pareto #1) — HẰNG MODULE, không phải `wip={[]}` tại chỗ gọi: `CanhVanHanh` có
 *   `useEffect([wip]) → invalidate()` (`CanhVanHanh.tsx:312`), nên một mảng rỗng MỚI mỗi render là **một khung vẽ
 *   cho mỗi re-render** của trang (mỗi phản hồi poll, mỗi gói socket) dù cảnh không đổi gì. Đo: 16–18 → 13 khung/40 s
 *   sau khi ổn định `mayTatCa`, phần còn lại là đây.
 */
const KHONG_WIP: never[] = [];

export function ThanManMay({ machineId, camUrl = null, duongVe = null }: ThanManMayProps) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const [, setLocation] = useLocation();

  const bayGioThat = Date.now();

  /**
   * ★★★ CHIỀU CAO ĐO TỪ VỊ TRÍ THẬT — G23/G41, bê nguyên bài học Đợt 30.
   *   `h-full` ở màn Line tràn 69 px và đẩy 12 ô trạm xuống dưới mép 900 trong
   *   khi mọi `toBeVisible()` XANH. ⇒ ĐO `getBoundingClientRect().top` của chính
   *   khung này rồi trừ khỏi `100vh`. Biến **riêng** `--twin-may-top`: hai màn
   *   không sống cùng lúc, nhưng dùng chung một biến CSS toàn cục là để lại giá
   *   trị của màn TRƯỚC cho màn SAU đọc — một khớp nối ẩn.
   */
  const khungRef = useRef<HTMLDivElement | null>(null);
  // ★ Đợt 35 — MỘT hook cho ba màn (G12), tên biến vẫn RIÊNG. Xem docblock `useTruDinhKhung`.
  useTruDinhKhung(khungRef, "--twin-may-top");

  /* ── Nhà máy ─────────────────────────────────────────────────────────── */
  const factoriesQ = trpc.factory.list.useQuery();
  const factories = useMemo(
    () => (factoriesQ.data ?? []) as Array<{ id: number; name?: string; code?: string }>,
    [factoriesQ.data],
  );
  /*
   * ★ Nhà máy ĐẦU TIÊN — cùng giới hạn có chủ ý với màn Line: `canhThietKe`
   *   nhận ĐÚNG MỘT `factoryId`; trên CSDL này mọi máy có chỗ đều ở nhà máy
   *   đầu (82/82 hàng `twin_dat_cho` ở `tangId=28`). Máy ở nhà máy thứ hai sẽ
   *   ra `ngoaiPhamVi` và màn NÓI RA (L-5) thay vì vẽ sai.
   */
  const factoryId = factories[0]?.id ?? null;

  /* ── Realtime + nhịp thích nghi (đứng TRƯỚC mọi useQuery, có chủ ý) ──── */
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
  /* ★ Hỏi MỌI tầng của toà (F2) — máy là đơn vị, tầng chỉ là chỗ nó đứng. */
  // ★ Đợt 40 (QA Đợt 39 #5) — `placeholderData` cùng luật ba màn (`giuDuLieuTruoc.ts`); `chuaDatCho` đã hỏi
  //   `!canhQ.isFetching` từ Đợt 34 nên pha-2-đang-chạy không bị đọc nhầm là "đã có bố cục".
  const canhQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: factoryId ?? 0, tangIds: tangIdsHoi },
    { enabled: factoryId !== null, retry: false, placeholderData: giuKhiCungNhaMay(factoryId) },
  );

  const tram = useMemo(() => canhQ.data?.tram ?? [], [canhQ.data]);
  const chuyen = useMemo(() => canhQ.data?.chuyen ?? [], [canhQ.data]);

  /* ── Trạng thái sống ─────────────────────────────────────────────────── */
  /*
   * ⚠⚠⚠ TẦNG MANG BẤT BIẾN AN TOÀN (trần 20 s / 60 s là hằng CÓ TÊN trong
   *   `useTrangThaiSong.ts`). Màn này KHÔNG khai lại con số nào.
   *
   * ★★★ `anToanQ` CỐ Ý KHÔNG lấy ra — Hình C vẽ dải *"Máy đang E-STOP"*, nhưng
   *   `twinCanh.anToanRobot` trả **ROBOT** (`robots.status`/`estop`), và
   *   `robot.id` KHÔNG cùng không gian với `machines.id`. Khớp `r.id ===
   *   machineId` là **trùng id ngẫu nhiên**, không phải cùng thực thể; và
   *   `twin_dat_cho` không có `robot` (`canhBaoAnToan.ts` docblock). Không có
   *   nguồn E-STOP theo máy ⇒ KHÔNG vẽ dải, thay vì vẽ một dải bịa. Lưới ⑧ ghim.
   */
  const { overviewQ, andonQ, sucKhoeQ } = useTrangThaiSong({
    factoryId,
    coLuongDay,
    nhipTongQuanMs,
  });

  /* ── Máy đã hợp nhất trạng thái + tuổi (NT-3) ────────────────────────── */
  const lineCuaTram = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of tram) m.set(s.id, s.lineId);
    return m;
  }, [tram]);

  /* ★★★ Đợt 34 (Pareto #1) — MỘT hàm cho ba màn: `tsTrangThai` (nhịp tim, cùng mốc với kho) thắng;
     issue `offline` chỉ là đường lùi cho server cũ. Xem docblock `tsTrangThaiTheoMay` và `TwinLine.tsx`. */
  const tsTheoMay = useMemo(
    // ★ Đợt 38 — mốc = lúc NHẬN dữ liệu (`Date.now()` trong memo), không phải `bayGioThat` mỗi render: `ageMinutes`
    //   do server tính lúc trả lời, và một dep đổi mỗi render kéo cả chuỗi `mayNen → mayTatCa → mayVe` dựng lại
    //   ⇒ một khung vẽ cho mỗi re-render dù dữ liệu y nguyên (xem `onDinhTheoGiaTri.ts`).
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

  /*
   * ★★★ ĐỢT 38 (phần dư Pareto #1) — ỔN ĐỊNH THEO GIÁ TRỊ: `kho` là đối tượng mới mỗi gói socket 10 s dù 42 máy y nguyên
   *   (nhịp tim 54 ngày), `mayNen` mới mỗi phản hồi poll ⇒ `mayTatCa` mới ⇒ `mayVe` mới ⇒ `LoBatchMay` tô lại ⇒
   *   khung vẽ (đo 16–18 khung/40 s sau khi hết tween; chặn tRPC ⇒ 10). Giữ tham chiếu khi khoá giá trị không đổi.
   */
  const mayTatCaTho = useMemo(() => hopNhat(mayNen, kho), [mayNen, kho]);
  const mayTatCa = useOnDinhTheoGiaTri(mayTatCaTho, khoaMayVanHanh(mayTatCaTho));

  const mayNay = useMemo(() => mayTatCa.find((m) => m.id === machineId) ?? null, [mayTatCa, machineId]);

  /* ★ Chuyền của máy — TRẠM thắng `lineId` khai (`machines` không có cột `lineId`). */
  const lineId = useMemo(() => lineCuaMayTheoTram(machineId, mayTatCa, tram), [machineId, mayTatCa, tram]);
  const lineHienTai = useMemo(() => chuyen.find((c) => c.id === lineId) ?? null, [chuyen, lineId]);

  /**
   * ★★★ TẬP MÁY VẼ = máy đích + hàng xóm cùng chuyền (`mayHangXom`).
   *   KHÔNG `mayTatCa` (F2: 31 máy chuyền khác thành khối lạ) và KHÔNG
   *   `[mayNay]` (mất định vị — §14.8). Lưới ③ ghim cả hai chiều.
   */
  const hangXom = useMemo(() => mayHangXom(machineId, mayTatCa, tram), [machineId, mayTatCa, tram]);

  const trangThaiTheoMayTho = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayTatCa) m.set(mv.id, trangThaiHienThi(mv, bayGio).trangThai);
    return m;
  }, [mayTatCa, bayGio]);
  // ★ Đợt 38 — `bayGio` đổi mỗi render nên bản thô dựng lại mỗi render; chỉ đổi tham chiếu khi một trạng thái ĐỔI.
  const trangThaiTheoMay = useOnDinhTheoGiaTri(trangThaiTheoMayTho, khoaBanDo(trangThaiTheoMayTho));

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
   * ★★★ `dungMayVe` — CÙNG hàm `/twin` và màn Line dùng (G12). Ba khớp nối được
   *   ghim bằng `manMayNoiVaoTrang.unit.test.ts` (G93):
   *     ① `may: hangXom`
   *     ② `trongPhamVi(..., phamViCuaManMay(machineId))` — máy đích giữ màu,
   *        hàng xóm pha 72 % về nền (định vị, Hình C)
   *     ③ `tangId` của HÀNG ĐẶT CHỖ — màn này không có "tầng đang xem"
   */
  const mayVe = useMemo<MayTrongLo[]>(
    () =>
      dungMayVe({
        may: hangXom,
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
            phamViCuaManMay(machineId),
          ),
        mauNenCanh,
        tiLePhaNgoaiPhamVi: TI_LE_PHA_NGOAI_PHAM_VI,
        congCu: { mauCss, phaVeNen, mauChoTrangThai, hinhKhoiCho },
      }),
    [hangXom, datChoTheoMay, kichThuocTheoLoai, trangThaiTheoMay, machineId, factoryId, mauNenCanh],
  );

  /**
   * ★★★ NHÓM (A) NEO VÀO **MỘT** MÁY — trần ≤ 3 ở cấp Máy (§15.6.2).
   *   Nhãn, badge cảnh báo, vòng viền và camera đều dựng từ `neoMucTieu`
   *   (0 hoặc 1 phần tử), KHÔNG từ `mayVe`. Hàng xóm không có nhãn: *"thừa
   *   ngân sách KHÔNG phải lý do để tiêu"*.
   */
  const mucTieu = useMemo(() => mucTieuTrongCanh(mayVe, machineId), [mayVe, machineId]);
  const neoMucTieu = useMemo(() => (mucTieu ? [mucTieu] : []), [mucTieu]);

  const nhan = useMemo<NhanTheGioi[]>(
    () => dungNhanMay({ mayVe: neoMucTieu, trangThaiTheoMay, maTheoMay, mauChoTrangThai, t }),
    [neoMucTieu, trangThaiTheoMay, maTheoMay, t],
  );

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
      dungCanhBao3D(andonRows, neoMucTieu, maTheoMay).map((c) => ({
        ...c,
        muc: c.muc as MucCanhBao,
      })),
    [andonRows, neoMucTieu, maTheoMay],
  );

  /* Cảnh báo của máy này cho `NganXuLy` — cùng ánh xạ với `TwinVanHanh.tsx`. */
  const canhBaoCuaMay = useMemo<CanhBaoDangMo[]>(
    () =>
      andonRows
        .filter((a) => a.machineId === machineId)
        .map((a) => ({
          id: a.id,
          mucDo: a.state,
          trangThai: a.status,
          tieuDe: a.title,
          raisedAt: new Date(a.raisedAt).getTime(),
          machineId: a.machineId,
        })),
    [andonRows, machineId],
  );

  /*
   * ★★★ A-4 — VÒNG VIỀN SỨC KHOẺ ở đế máy ĐÍCH. `vienSucKhoe` tự loại hạng
   *   `khoe`/`chua_do` (một luật, một chỗ). `viTri.x/.z` là hệ CẢNH — lấy nhầm
   *   `viTri.y` (độ cao) là dán vòng lên một đường thẳng, không gì nổ.
   */
  const khai = useMemo(() => (sucKhoeQ.data?.khai ?? []) as KhaiSucKhoe[], [sucKhoeQ.data]);
  const vienSucKhoeTho = useMemo(
    () =>
      vienSucKhoe(
        khai,
        neoMucTieu.map((m) => ({
          machineId: m.machineId,
          viTri: { x: m.viTri.x, z: m.viTri.z },
          kichThuocMm: { rong: m.kichThuocMm.rongMm, sau: m.kichThuocMm.sauMm },
        })),
        bayGio,
      ),
    [khai, neoMucTieu, bayGio],
  );
  // ★ Đợt 38 — cùng lý do với `mayTatCa`: `bayGio` đổi mỗi render; vòng viền chỉ đổi khi hạng/vị trí đổi.
  const vienSucKhoeCanh = useOnDinhTheoGiaTri(vienSucKhoeTho, JSON.stringify(vienSucKhoeTho));

  /* ── Camera orbit GẦN quanh máy đích (≤ 8 m) — trừ khi deep-link nói rõ `?cam=` (Đợt 33) ── */
  const khungNhinTho = useMemo(() => (camUrl ? khungNhinTuCamera(camUrl) : khungNhinMay(mucTieu)), [camUrl, mucTieu]);
  /*
   * ★★★ ĐỢT 38 (Pareto #1 QA Đợt 37) — ỔN ĐỊNH THEO GIÁ TRỊ, cùng khuôn `TwinLine` (Đợt 35) và `/twin` (Đợt 36).
   *   `mucTieu` dựng lại từ `mayVe` mỗi gói `twin:trangThai` (10 s) ⇒ `khungNhinTho` là ĐỐI TƯỢNG MỚI cùng giá trị
   *   ⇒ `DieuKhien` (effect `[khungNhin]`) khởi động tween về CÙNG chỗ ⇒ đo được **143–230 khung/40 s** khi đứng
   *   yên, camera không đổi (`.qa-dot37/ablation-may/`, `.qa-dot38/truoc/p1-may-*`: 179). Chặn socket ⇒ 230, chặn
   *   tRPC ⇒ 107: trigger NỘI TẠI, không phải mạng. Vá cùng lớp ở HAI màn kia mà không quét màn thứ ba là G110 —
   *   nay `cuaVaoTwin` ghim bằng BẤT BIẾN trên MỌI trang dựng `<CanhVanHanh>`, không bằng danh sách tên.
   *   Khoá = toạ độ làm tròn mm ở CẢ `viTri` lẫn `muc`; cùng khoá ⇒ cùng đối tượng ⇒ không tween.
   */
  const khoaKhungNhin = khungNhinTho
    ? `${khungNhinTho.viTri.map((v) => v.toFixed(3)).join(",")}|${khungNhinTho.muc.map((v) => v.toFixed(3)).join(",")}`
    : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cố ý: chỉ đổi đối tượng khi GIÁ TRỊ đổi
  const khungNhin = useMemo(() => khungNhinTho, [khoaKhungNhin]);

  /* ── (B) chip trái ───────────────────────────────────────────────────── */
  const tomTat = useMemo(() => tomTatMay(mayNay, khai, bayGio), [mayNay, khai, bayGio]);
  const trangThaiMay = useMemo(
    () =>
      mayNay
        ? trangThaiHienThi(mayNay, bayGio)
        : { trangThai: "khong_ro", tuoi: "khong_ro" as const, daGhiDe: false },
    [mayNay, bayGio],
  );

  /* ── Quyền xử lý (§9.2) — CÙNG bốn dòng với `TwinVanHanh.tsx`, G24 ──── */
  const quyen: QuyenXuLy = {
    ackAlarm: hasPermission("andon", "canEdit"),
    anTamAlarm: hasPermission("machine_control", "canCreate"),
    taoPhieu: hasPermission("machine_monitoring", "canCreate"),
    suaPhieu: hasPermission("machine_monitoring", "canEdit"),
  };

  const napLai = useCallback(() => {
    void andonQ.refetch();
    void overviewQ.refetch();
  }, [andonQ, overviewQ]);

  /* ── L-5: vì sao màn mở được / không ──────────────────────────────────── */
  const phamViRong =
    isScopeEmpty(
      scopeEmptyReasonOf(
        canhQ.data as { scopeEmptyReason?: string | null } | undefined,
        toaNhaQ.data as { scopeEmptyReason?: string | null } | undefined,
      ),
    ) ||
    (!factoriesQ.isLoading && !factoriesQ.isError && factories.length === 0);

  /*
   * ★ Gồm cả `toaNhaQ`/`chiTietQ`: chuỗi truy vấn xếp tầng (nhà máy → toà →
   *   tầng → cảnh), thiếu một mắt là "đã tải xong" sớm một nhịp.
   */
  const dangTai =
    factoriesQ.isLoading ||
    toaNhaQ.isLoading ||
    chiTietQ.isLoading ||
    canhQ.isLoading ||
    overviewQ.isLoading;

  /*
   * ★★★ `dangTai` là điều kiện BẮT BUỘC: lượt tải đầu `mayTatCa` cũng rỗng, và
   *   thiếu nó thì MỌI máy hợp lệ nháy câu "ngoài phạm vi" một nhịp trước khi
   *   mở (NT-3.5 — đếm rỗng khác đếm bằng 0).
   */
  const idTrongTam = useMemo(() => mayTatCa.map((m) => m.id), [mayTatCa]);
  /*
   * ★ Đợt 34 (D) — THIẾU QUYỀN THẬT = server TỪ CHỐI (`FORBIDDEN`) một truy vấn nền của màn; KHÁC
   *   "chưa được gán nhà máy" (HTTP 200 + mảng rỗng ⇒ `phamViRong`). Cùng cách bắt với
   *   `thieuQuyenBoCuc` của `/twin`. Đo: `operator1` (0 gán, có `machine_status`) từng nhận câu
   *   "You do not have permission" — sai cửa; nay nhận `chuaGanNhaMay`.
   */
  const thieuQuyen =
    (canhQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (toaNhaQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (overviewQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN";
  const lyDo = lyDoMoManMay(machineId, { idTrongTam, phamViRong, dangTai, thieuQuyen });

  /*
   * Máy CÓ trong nhà máy nhưng CHƯA có chỗ trên bố cục ⇒ chỉ khối 3D trống.
   * ★ `!canhQ.isFetching`: `canhThietKe` được hỏi HAI lượt (tangIds `[]` rồi
   *   tangIds thật); giữa hai lượt `datCho` còn rỗng ⇒ thiếu vế này màn khai
   *   *"máy chưa có chỗ"* một nhịp về một máy CÓ chỗ (NT-3.5, đúng lớp T10).
   */
  const chuaDatCho =
    !dangTai && canhQ.isSuccess && !canhQ.isFetching && mayNay !== null && mucTieu === null;

  /*
   * ★★★ ĐỢT 35 (Pareto #4) — CHIỀU CAO KHỐI CẢNH THEO PHẦN CÒN LẠI, KHÔNG `clamp(320px, 36vh, 360px)`.
   *   QA Đợt 32 ở 1280×720: cột trái còn 595 px, sàn 320 ⇒ cảnh 320 > cockpit 275 — vi phạm bất biến
   *   `cockpit.h > khoiCanh.h` (e2e Đợt 31 ghim ở 1600×900). ĐO chiều cao cột trái bằng `ResizeObserver`
   *   rồi để `chieuCaoKhoiCanhMay` (thuần, có test) kẹp: ở 900 vẫn **324/451** như Đợt 31, ở 720 ra 259/336.
   *   Effect phụ thuộc `[lyDo, dangTai]` vì cột trái chỉ mount ở nhánh `mo` — mount xong mới đo được.
   */
  const cotTraiRef = useRef<HTMLDivElement | null>(null);
  const [doCotTrai, datDoCotTrai] = useState<{ caoConLai: number; caoVp: number } | null>(null);
  useEffect(() => {
    const el = cotTraiRef.current;
    if (!el) return;
    const doLai = () =>
      datDoCotTrai({ caoConLai: el.getBoundingClientRect().height, caoVp: window.innerHeight });
    doLai();
    const ro = new ResizeObserver(doLai);
    ro.observe(el);
    window.addEventListener("resize", doLai);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", doLai);
    };
  }, [lyDo, dangTai]);
  const caoKhoiCanhPx = chieuCaoKhoiCanhMay(
    doCotTrai?.caoConLai ?? null,
    doCotTrai?.caoVp ?? (typeof window !== "undefined" ? window.innerHeight : 900),
  );

  const tenMay =
    mayNay?.ten || mayNay?.ma || t("twin3d.may.maySo", "Máy #{{n}}", { n: machineId });
  const tenLine =
    lineHienTai?.ten || lineHienTai?.ma || (lineId != null ? t("twin3d.line.chuyenSo", "Chuyền {{n}}", { n: lineId }) : "");

  const sanRongM = toaNhaDau ? Number(toaNhaDau.rongMm) / 1000 : 60;
  const sanSauM = toaNhaDau ? Number(toaNhaDau.sauMm) / 1000 : 40;

  return (
    <div
      ref={khungRef}
      className="relative flex min-h-0 flex-col overflow-hidden"
      style={{ height: chieuCaoTruDinh("--twin-may-top") }}
      data-testid="man-twin-may"
    >
      {/* ── Thanh trên: breadcrumb ‹ Nhà máy › Line N › Máy ─────────────── */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm"
        data-testid="thanh-tren-may"
      >
        {/* ★ ĐƯỜNG RA — `<Link>` của wouter (giữ SPA + một mục lịch sử). G85:
            `data-testid` đặt TRÊN `<Link>`, không trên `<Button asChild>`. */}
        <Link
          /* ★ Đợt 33 (QĐ-23 #5): về ĐÚNG `?pv=` vừa xem (từ `history.state`), không về mặc định. */
          href={duongVe ?? "/twin"}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid="ve-man-nha-may"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("twin3d.line.veNhaMay", "Nhà máy")}
        </Link>
        {lineId != null ? (
          <>
            <span className="text-muted-foreground">›</span>
            <Link
              href={duongDanManLine(lineId)}
              /* ★ mang tiếp đường về để màn Line cũng về đúng `?pv=` (QĐ-23 #5). */
              state={trangThaiVe(duongVe)}
              className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              data-testid="ve-man-line"
            >
              {tenLine}
            </Link>
          </>
        ) : null}
        <span className="text-muted-foreground">›</span>
        <span className="font-medium" data-testid="ten-may">
          {tenMay}
        </span>
      </div>

      {lyDo !== "mo" ? (
        /*
         * ★★★ L-5 — máy KHÔNG mở được thì màn NÓI RA, bằng đúng câu của
         *   `cauChoLyDoManMay` (`ngoaiPhamVi` / `thieuQuyen` / `chuaGanNhaMay` — Đợt 34 (D) tách
         *   "chưa được gán nhà máy" khỏi "thiếu quyền"), không một màn trống.
         */
        <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="may-khong-mo-duoc" data-ly-do={lyDo}>
          <EmptyState
            title={t("twin3d.may.khongMoDuoc", "Không mở được máy #{{n}}", { n: machineId })}
            description={t(cauChoLyDoManMay(lyDo).khoa, cauChoLyDoManMay(lyDo).duPhong)}
            actionLabel={t("twin3d.line.veNhaMay", "Nhà máy")}
            onAction={() => setLocation(duongVe ?? "/twin")}
          />
        </div>
      ) : dangTai ? (
        /*
         * ★★★ CHƯA BIẾT máy có mở được không thì CHƯA mount cảnh/cockpit/ngăn.
         *   Nghiệm thu ảnh lần đầu: với máy ngoài phạm vi (257) và với
         *   `operator1`, cockpit + `NganXuLy` được mount trong lúc `dangTai`
         *   (`lyDo` còn là `"mo"`), tự hỏi server về một máy người dùng KHÔNG
         *   được xem ⇒ toast *"Could not find machine."* nổi lên cạnh câu L-5 —
         *   hai câu cho một sự việc, và câu toast là câu SAI (máy có tồn tại).
         *   Kèm theo là một canvas dựng rồi huỷ trong ~1 s (WebGL context vô ích).
         */
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
          data-testid="may-dang-tai"
        >
          {t("twin3d.may.dangTai", "Đang tải máy…")}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* ── Cột trái: cảnh 3D NHỎ (trên) + cockpit 2D (dưới, chiếm phần lớn) ── */}
          <div ref={cotTraiRef} className="flex min-h-0 flex-1 flex-col">
            {/*
              ★★★ TRẦN CHIỀU CAO cho cảnh 3D — §15.7.1: cấp Máy ≈ 20 % viewport.
                `shrink-0` + chiều cao TÍNH (`chieuCaoKhoiCanhMay`); KHÔNG `flex-1`.
                Cho nó `flex-1` là đảo ngược kết luận §14.8 và đẩy cockpit 2D
                xuống dưới mép (G41).
              ⚠ SÀN của canvas phải ≤ SÀN của khung, nếu không canvas CHUI: Đợt 31
                đặt khung 306 < sàn kit 320 ⇒ canvas TRÀN 14 px xuống dưới header
                cockpit — bbox DOM của khung vẫn "đúng", chỉ ảnh + bbox của CANVAS
                bắt được. Đợt 35: khung ≥ `SAN_KHOI_CANH_MAY_PX` (240) và canvas
                nhận CÙNG sàn ấy qua `sanCaoPx` (một hằng, hai chỗ đọc — G12);
                `overflow-hidden` để khung là trần thật.
            */}
            <div
              className="relative shrink-0 overflow-hidden"
              style={{ height: caoKhoiCanhPx }}
              data-testid="khoi-canh-may"
              data-cao-px={caoKhoiCanhPx}
            >
              {chuaDatCho ? (
                <div className="flex h-full items-center justify-center p-4" data-testid="may-chua-dat-cho">
                  <EmptyState
                    compact
                    title={t("twin3d.may.chuaDatCho", "Máy này chưa có chỗ trên bố cục 3D")}
                    description={t(
                      "twin3d.may.chuaDatChoMo",
                      "Xếp chỗ trong Twin Studio để thấy máy giữa hàng xóm của nó. Buồng lái và ngăn xử lý bên dưới vẫn dùng được.",
                    )}
                  />
                </div>
              ) : (
                <>
                  {/*
                    ★★★ **ĐÚNG MỘT `<CanhVanHanh>`** — không nằm trong nhánh có thể
                      dựng thêm bản thứ hai. Nhánh `chuaDatCho` ở trên là loại-trừ.
                  */}
                  <CanhVanHanh
                    may={mayVe}
                    nhan={nhan}
                    canhBao={canhBao3D}
                    /* ★ Không đường tâm, không cột WIP: câu hỏi cấp Máy là "máy này
                         thế nào", không phải "chuyền chảy ra sao" (D-6/D-7 cùng
                         lý do). `vung` không truyền (D-12, 0 hàng). */
                    dongChay={null}
                    wip={KHONG_WIP}
                    /* ★ Đợt 35 (#4): sàn canvas = sàn khung (240) — xem chú thích khối `khoi-canh-may`. */
                    sanCaoPx={SAN_KHOI_CANH_MAY_PX}
                    vienSucKhoe={vienSucKhoeCanh}
                    machineIdChon={machineId}
                    /* ★ Bấm hàng xóm ⇒ ĐỔI MÁY tại chỗ (§15.3.3 đường ra ⑥: "chọn máy
                         khác — thay tại chỗ, không chồng lớp"). */
                    onChonMay={(id) => {
                      if (id != null && id !== machineId)
                        setLocation(duongDanManMay(id), { state: trangThaiVe(duongVe) });
                    }}
                    khungNhin={khungNhin}
                    sanRongM={sanRongM}
                    sanSauM={sanSauM}
                    tatNhan={false}
                    chuNhanAn={(n) => t("twin3d.vanHanh.nhanBiAn", "còn {{n}} tên bị ẩn", { n })}
                    chuMatContext={t("twin3d.loi.matContext")}
                    ariaLabel={t("twin3d.may.ariaCanh", "Cảnh 3D của {{ten}}", { ten: tenMay })}
                  />

                  {/* ★ (B) chip trái — DOM, 0 draw call, `pointer-events-none` để kéo
                        xoay camera xuyên qua (khuôn `BangKpiNoi`). Mã · loại · trạng
                        thái · sức khoẻ — MỘT chỗ, không lặp ở header (D-5). */}
                  <div
                    /* ★ Đợt 35 (Pareto #5): chip ở GÓC DƯỚI-TRÁI, không phải trên-trái. Nhãn nóc máy neo sát mép
                         trên (camera cấp Máy ép sát, Đợt 31) và chip là vùng cấm nhãn (`data-che-nhan`): ở 1280×720
                         canvas chỉ 680 px rộng ⇒ chip [8..343] đè đúng lên nhãn [267..413] ⇒ tên máy trên nóc biến mất
                         (đo `.qa-dot35/sau-BCE/e2-may-14-1280x720.json`: `biChe: 1`, nhãn 0). Đáy canvas không có gì
                         neo (chip nhãn ẩn ở giữa), chip xuống đó thành chú thích ngay trên cockpit. */
                    className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/85 px-2 py-1 text-xs shadow-sm backdrop-blur"
                    data-testid="chip-may"
                    /* ★ Đợt 35 (Pareto #5): lớp phủ ĐÈ canvas tự khai — `LopNhan` không vẽ nhãn dưới nó. */
                    data-che-nhan="1"
                  >
                    <span className="font-mono font-medium" data-testid="ma-may">
                      {tomTat?.ma ?? "—"}
                    </span>
                    <span className="text-muted-foreground" data-testid="loai-may">
                      {tomTat?.loaiMay ?? "—"}
                    </span>
                    <span data-testid="trang-thai-may" data-trang-thai={trangThaiMay.trangThai}>
                      {t(mauChoTrangThai(trangThaiMay.trangThai).khoaNhan)}
                    </span>
                    <span data-testid="suc-khoe-may" data-hang={tomTat?.hangSucKhoe ?? "chua_do"}>
                      {t("twin3d.may.sucKhoe", "Sức khoẻ")} {hienSo(tomTat?.diem, dangTai)}
                      {tomTat?.diem != null ? " %" : ""}
                      {" · "}
                      {nhanHang(tomTat?.hangSucKhoe ?? "chua_do", t)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/*
              ── COCKPIT 2D — `MachineCockpitBody` NHÚNG (G12: dùng lại, không viết
                 bản thứ hai). `embedded` chỉ giấu nút "Back" của nó. `flex-1` +
                 `overflow-y-auto` + `min-h-0`: nó là phần được phép cuộn.
              ⚠ Tab "3D" bên trong có `<Canvas>` drei riêng — xem docblock đầu tệp
                 (nợ có sẵn, `__soCanvas` mù, đã viết thành test).
            */}
            <div className="min-h-0 flex-1 overflow-y-auto border-t" data-testid="cockpit-2d">
              <Suspense
                fallback={
                  <div className="p-4 text-sm text-muted-foreground">
                    {t("twin3d.may.dangTaiCockpit", "Đang tải buồng lái…")}
                  </div>
                }
              >
                <MachineCockpitBody machineId={machineId} embedded />
              </Suspense>
            </div>
          </div>

          {/* ── Ngăn xử lý PHẢI — mặt GHI duy nhất (§15.3.3), 288 px như Hình C ── */}
          <div
            className="flex w-72 shrink-0 min-h-0 flex-col overflow-hidden border-l bg-background"
            data-testid="panel-phai-may"
          >
            <NganXuLy
              machineId={machineId}
              ma={mayNay?.ma ?? ""}
              ten={mayNay?.ten ?? ""}
              trangThai={trangThaiMay}
              thoiDiemDuLieu={mayNay?.thoiDiemDuLieu ?? null}
              bayGio={bayGio}
              canhBao={canhBaoCuaMay}
              quyen={quyen}
              coQuyenXem={(m) => hasPermission(m, "canView")}
              onDaXuLy={napLai}
              onDieuHuong={setLocation}
              /* ★ KHÔNG `onMoTaiCho`: cockpit ĐÃ nhúng ngay bên trái. Mở thêm một
                   `NganNhung` chứa cùng `MachineCockpitBody` là hai bản của một
                   thứ (hai socket subscribe, hai lần fetch). Nút điều hướng rơi
                   về `onDieuHuong` — rời màn CÓ Ý THỨC (§15.3.3). */
            />
          </div>
        </div>
      )}
    </div>
  );
}
