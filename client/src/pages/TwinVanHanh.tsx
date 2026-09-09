/**
 * `/twin` — MÀN VẬN HÀNH của Nhà máy 3D Digital Twin (§9).
 *
 * Đây là **trung tâm** mà chủ sở hữu yêu cầu: *"mọi hoạt động quản lý cũng như
 * theo dõi sau này đều có thể xử lý trên 3D Digital Twin này"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-4 — MỘT `<Canvas>` DUY NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * `CanhVanHanh` (chứa `KhungCanh`) được dựng ĐÚNG MỘT LẦN, và bản 2D **THAY
 * THẾ** nó chứ không đứng cạnh nó — `che2D ? <2D/> : <3D/>`, không bao giờ cả
 * hai. `window.__soCanvas` phải luôn ≤ 1 và `KhungCanh` tự `console.error` nếu
 * vượt.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NT-3 — TRUNG THỰC DỮ LIỆU LÀ ĐIỀU KIỆN SỐNG CÒN
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trên DB dev 2026-09-06 (SQL thô): **42/42 máy `isActive` có dữ liệu quá 5
 * phút**, trong đó 3 máy khai `operationStatus='running'` với tim đập từ
 * 2026-07-17. Một bản cài đặt ngây thơ sẽ vẽ 3 ô XANH trên một nhà máy đã im
 * lặng gần hai tháng.
 *
 * ⇒ Mọi trạng thái đi qua `trangThaiHienThi()` TRƯỚC khi tới màu, tới bảng, tới
 *   ô đếm. Không có đường nào để một giá trị thô lọt thẳng ra giao diện.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QUYỀN — MỘT LỐI VÀO RỒI TỪ CHỐI (bài học Khối D)
 * ════════════════════════════════════════════════════════════════════════════
 * `/twin` gate `analytics_oee` (nav + RouteGuard, ghim bởi `navigation.unit.test.ts`).
 * Nhưng dữ liệu HÌNH HỌC đến từ `twinCanh.canhThietKe`, gate
 * `settings_factory` **HOẶC** `machine_control`. Hai tập quyền KHÁC NHAU ⇒ một
 * người qua được cổng route vẫn có thể bị thủ tục từ chối.
 *
 * Đo được trên 4 tài khoản không-admin: chỉ `supervisor1` có `analytics_oee`,
 * và may mắn cũng có `machine_control`. Nghĩa là ca "vào được màn, bị từ chối dữ
 * liệu" CHƯA xảy ra với dữ liệu hiện tại — nhưng nó là một tai nạn đang chờ, vì
 * hai cổng không có gì ràng chúng với nhau.
 *
 * ⇒ Màn này BẮT lỗi FORBIDDEN của truy vấn hình học và nói RÕ *"bạn xem được màn
 *   này nhưng chưa có quyền đọc bố cục"*, thay vì hiện một cảnh trống trông như
 *   nhà máy chưa xây. Xem `thieuQuyenBoCuc` bên dưới.
 *
 * ⚠ Phép đo quyền PHẢI bằng tài khoản KHÔNG-admin — admin bypass.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSharedSocket } from "@/lib/socketManager";
import { useTranslation } from "react-i18next";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  Maximize2,
  Minimize2,
  OctagonAlert,
  PencilRuler,
  RefreshCw,
  Tags,
} from "lucide-react";
import type * as THREE from "three";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { isScopeEmpty, scopeEmptyReasonOf } from "@/lib/scopeEmpty";
import { trpc } from "@/lib/trpc";

import { mmSangMet } from "@/components/twin3d/heToaDo";
// ── T-4 (§15.5.2) — KHỐI HỢP NHẤT DỮ LIỆU, hàm THUẦN dùng chung cho cả ba màn ──
import {
  dungMayVe,
  idMayChuaDat,
  mepMatBang,
  dungNhanMay,
  gopNhan,
  dungCanhBao3D,
  CO_DU_PHONG,
} from "@/components/twin3d/van-hanh/hopNhatCanh";
import { hinhKhoiCho } from "@/components/twin3d/hinhKhoiMay";
import { mauChoTrangThai } from "@/components/twin3d/mauTrangThai";
import { mauCss } from "@/components/twin3d/van-hanh/mauThree";
// ── T-2 (§15.5.2) — lắp hình học Line, HÀM THUẦN dùng chung cho cả ba màn ──
import { dungHinhLine } from "@/components/twin3d/van-hanh/canhLine";
import type { MayTrongLo, NhanTheGioi } from "@/components/twin3d/loi";

import { CanhVanHanh } from "@/components/twin3d/van-hanh/CanhVanHanh";
import { CanhVanHanh2D } from "@/components/twin3d/van-hanh/CanhVanHanh2D";
import { DanhSachMay } from "@/components/twin3d/van-hanh/DanhSachMay";
import { NganXuLy } from "@/components/twin3d/van-hanh/NganXuLy";
import { DaiCanhBao } from "@/components/twin3d/van-hanh/DaiCanhBao";
import {
  chuanHoaHang,
  type CanhBaoDai,
  type ChonMuc,
  type TapPhamVi,
} from "@/components/twin3d/van-hanh/daiCanhBaoLogic";
import { DaiLine } from "@/components/twin3d/van-hanh/DaiLine";
import { xuatUsd, type KetQuaXuatUsd } from "@/components/twin3d/van-hanh/xuatUsd";
import type { CanhBaoTheGioi, MucCanhBao } from "@/components/twin3d/van-hanh/LopCanhBao";
import {
  duongDanManLine,
  duongDanManMay,
  ghiCamera,
  trangThaiVe,
  type PhamVi,
} from "@/components/twin3d/van-hanh/duongDanTwin";
// ── Đợt 33 (QĐ-23) — `/twin` là CỬA VÀO: `?pv=line:`/`?chon=machine:`/`?xem=machine:` đi màn riêng ──
import { dichManRieng } from "@/components/twin3d/bo-cuc/dinhTuyenTwinCu";
// ── T-3 (§15.5.2) — vỏ React của trạng thái URL, dùng chung cho CẢ BA MÀN ──
import { useTrangThaiTwin } from "@/components/twin3d/van-hanh/useTrangThaiTwin";
import { useMoPhongTwin } from "@/components/twin3d/van-hanh/useMoPhongTwin";
import { usePhanTichLine } from "@/components/twin3d/van-hanh/usePhanTichLine";
import { useTrangThaiSong } from "@/components/twin3d/van-hanh/useTrangThaiSong";
import { useAnhLichSu } from "@/components/twin3d/van-hanh/useAnhLichSu";
// ── Đợt 10 lô F (§11e.6 F1/F2/F3) — bộ chọn Nhà máy/Toà/Tầng ──────────────
import {
  phamViThuc,
  phanGiaiNap,
  tapDoiSoatTheoNap,
  yeuCauBiBoQua,
  type MucChon,
} from "@/components/twin3d/van-hanh/boChonNap";
import { cn } from "@/lib/utils";
import { BoChonNapUI } from "@/components/twin3d/van-hanh/BoChonNapUI";
// ── ĐỢT 22 Z4 (G-7) — cây phân cấp CÓ ROLL-UP, TÁI DÙNG `CayPhanCap` ────────
// ★ Lý lẽ đầy đủ (đo được, G70/G12) nằm ở docblock đầu `cayVanHanh.ts`. Tóm
//   tắt: `CayPhanCap` là component ĐIỀU KHIỂN THUẦN, `CayThietKe` là CẤU TRÚC
//   DỮ LIỆU (không phải trạng thái sửa), và `canhQ` ĐÃ trả sẵn cả năm mảng
//   nó cần — nên đây là 0 truy vấn mới và 0 bản cài đặt thứ hai.
import { CayPhanCap } from "@/components/twin3d/thiet-ke/CayPhanCap";
import { dungCayThietKe, type KhoaNode } from "@/components/twin3d/thiet-ke/trangThaiThietKe";
import { demTrucTiep } from "@/components/twin3d/thiet-ke/cayPhanCapLogic";
import {
  demMayTrucTiep,
  dieuHuongTuKhoa,
  tapChonTuUrl,
} from "@/components/twin3d/van-hanh/cayVanHanh";
import {
  bboxCuaTap,
  dungBreadcrumb,
  khungNhinCho,
  khungNhinLine,
  phaVeNen,
  trongPhamVi,
  TI_LE_PHA_NGOAI_PHAM_VI,
  type KhungNhin,
} from "@/components/twin3d/van-hanh/phamViCanh";
import {
  demTheoTuoi,
  doiSoatCanh,
  gopTinhTrang,
  hienSo,
  nhanDoTuoi,
  nhanTuoiDocDuoc,
  thoiDiemDuLieuMoiNhat,
  trangThaiHienThi,
  type MayVanHanh,
} from "@/components/twin3d/van-hanh/trungThucDuLieu";
import type { CanhBaoDangMo, QuyenXuLy } from "@/components/twin3d/van-hanh/nganXuLyLogic";
// ── Đợt 11 lô J — §11 #16: KPI ĐỌC ĐƯỢC TRÊN CẢNH 3D (yêu cầu #6) ──────────
import { tinhKpiNoi, type MayTongQuanKpi } from "@/components/twin3d/van-hanh/kpiNoiLogic";
import { BangKpiNoi } from "@/components/twin3d/van-hanh/BangKpiNoi";
import {
  dungDauVaoWhatIf,
  kep,
  HORIZON_MIN,
  HORIZON_MAX,
  HE_SO_MIN,
  HE_SO_MAX,
} from "@/components/twin3d/van-hanh/moPhongLogic";
import { NganMoPhong } from "@/components/twin3d/van-hanh/NganMoPhong";
// ── Đợt 10 mục 5 (lô G) — ngăn `?xem=` từng import `nhungTaiCho` ở đây. Đợt 33
//    (QĐ-23): `?xem=machine:N` redirect sang `/twin/may/N` (vỏ bên dưới), màn này
//    không còn dùng gì của `nhungTaiCho`. ──
// ── Đợt 6 (§9.8/§10.2) — kho trạng thái DÙNG CHUNG cho trực tiếp và tua lại ──
import { dongHoHienThi, hopNhat } from "@/components/twin3d/van-hanh/khoTrangThai";
// ── Đóng nợ trước Đợt 7 — §11 #50 (UNS), #53 (khu chờ), #54 (nhãn Line) ──
import { useUnsStream, isa95Slug } from "@/lib/unsStreamClient";
import { mocTuAnhChupUns } from "@/components/twin3d/van-hanh/phuUns";
import {
  xepKhuCho,
  nhanLineTaiCentroid,
  PHA_KHU_CHO,
} from "@/components/twin3d/van-hanh/khuChoVaNhanLine";
import { useKhoTrangThai } from "@/components/twin3d/van-hanh/useKhoTrangThai";
import { DongThoiGian, type TocDo } from "@/components/twin3d/van-hanh/DongThoiGian";
// ── Đợt 6 (§11 #26/#51/#52) — an toàn nổi lên Twin + xuất xứ dữ liệu ──
import { tomTatAnToan } from "@/components/twin3d/van-hanh/canhBaoAnToan";
/*
 * ★★★ ĐỢT 21 — hạ tầng của LÔ Z, nối vào ở lô Y (xem ba chỗ gọi bên dưới).
 *   Lô Z dựng ba module này rồi dừng ở ranh giới phạm vi tệp; nếu không có ba
 *   dòng `import` này và ba chỗ gọi của chúng thì cả ba là **G16** — hàm không
 *   ai gọi = chưa xong.
 */
import { vienSucKhoe, type KhaiSucKhoe } from "@/components/twin3d/van-hanh/sucKhoeMay";
import { khaiNguonSo } from "@/components/twin3d/van-hanh/xuatXuNhip";
import { vungTuDanhSach, type HangVung } from "@/components/twin3d/thiet-ke/vungAnToan";
import {
  NHIP_CO_LUONG_MS,
  coLuongTheoKetNoi,
  laGiaDinh,
  nhipHoiMs,
  nhipHoiToiDa,
  xuatXuHienTai,
} from "@/components/twin3d/van-hanh/nguonDuLieu";
// ── Đợt 8 (§11 #61/#32/#36) — WIP theo trạm, nút thắt, nhịp chuyền thật ──
import {
  cotWip,
  nhipTuCanBang,
  xepHangWip,
  type TinhWip,
} from "@/components/twin3d/van-hanh/wipTram";

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 21 LÔ Y — BỐ CỤC MỚI (§13b) + QD-16 GỘP MỘT TRANG (§13c.1)
 * ════════════════════════════════════════════════════════════════════════════
 * Ba nhập khẩu dưới đây là toàn bộ bề mặt mới của đợt. Lý lẽ đầy đủ nằm trong
 * docblock của chính ba tệp ấy; ở đây chỉ ghi cái mà người đọc `TwinVanHanh`
 * cần biết ngay:
 *
 *  • `DaiHopNhat`  — TÁM dải ngang (ca xấu nhất 280 px) thành MỘT dải 26 px.
 *    Không banner nào bị bỏ; chỉ đổi HÌNH DẠNG của lời khai (§13b 14.4).
 *  • `vungQuyen`   — ★★★ QĐ-18 (§13c.2, thay QĐ-16): `/twin` nay **CHỈ ĐỌC**.
 *    Màn này KHÔNG còn mang vùng sửa; `coQuyenSuaNhaXuong` ở đây chỉ còn quyết
 *    định **có hiện LIÊN KẾT sang `/twin-studio` hay không** — luật
 *    ẩn-không-disable (§12b.3). `operator1` không thấy liên kết, và cũng không
 *    mất gì: họ vốn chưa từng có quyền sửa (đo trên `permissions` 2026-09-09).
 *
 * ⚠ `TwinStudio` **KHÔNG còn được nạp từ tệp này** (QĐ-18). Nó là trang riêng
 *   `/twin-studio` với `RouteGuard` của chính nó. Hệ quả tốt cho RB-4: hai
 *   `<Canvas>` nay nằm ở hai TRANG, nên chúng không thể cùng sống — mạnh hơn
 *   cách cũ (`? :` trong một cây React) vì không còn phụ thuộc vào việc ai đó
 *   sau này đổi `? :` thành `hidden`.
 */
import DaiHopNhat from "@/components/twin3d/bo-cuc/DaiHopNhat";
import type { MucViec } from "@/components/twin3d/bo-cuc/daiHopNhatLogic";
import { coQuyenSuaNhaXuong } from "@/components/twin3d/bo-cuc/vungQuyen";

/*
 * ★★★ RB-4 SAU QĐ-18 — VÌ SAO TÁCH TRANG LÀM HÀNG RÀO NÀY **CHẶT HƠN**, KHÔNG LỎNG ĐI
 *
 * Trước đợt này ở đây có một `React.lazy` trỏ vào trang TwinStudio,
 * và RB-4 (một `<Canvas>` WebGL sống tại một thời điểm) được giữ bằng một `? :`
 * trong cây React: vùng sửa và cảnh vận hành **loại trừ nhau** ở chỗ render.
 * Điều đó đúng nhưng **mong manh** — ngày ai đó đổi `? :` thành `hidden` để giữ
 * camera, cả hai context cùng sống và trình duyệt giết context cũ TRONG IM LẶNG.
 *
 * QĐ-18 tách hai màn thành hai TRANG. Hai `<Canvas>` nay nằm ở hai tuyến khác
 * nhau, nên wouter unmount trang cũ trước khi mount trang mới — RB-4 được giữ
 * bởi **kiến trúc định tuyến**, không bởi một toán tử ai cũng sửa được.
 */

/** Phạm vi mặc định khi URL không nói gì. */
const PHAM_VI_MAC_DINH: PhamVi = { cap: "tang", id: null };

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 33 — VỎ: `/twin` LÀ **CỬA VÀO**, KHÔNG PHẢI NƠI XEM LINE/MÁY (QĐ-23)
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 32 đo được `/twin?pv=line:2` dựng màn Line **tại chỗ** song song với
 * `/twin/line/2`, và `/twin?chon=machine:14`/`?xem=machine:14` mở panel/ngăn
 * nhúng thay vì màn Máy. Chủ dự án chốt: ba dạng URL ấy là **đường cũ** tới hai
 * màn riêng ⇒ redirect ≤ 1 chặng (G40), bảng tham số ở `dichManRieng`.
 *
 * ★ Vì sao ở VỎ chứ không ở `App.tsx` hay giữa thân: `<Route>` của wouter chỉ
 *   render lại khi **pathname** đổi (nó không theo dõi search), còn thân có
 *   ~90 hook — một `return <Redirect>` chen giữa thân là "rendered fewer hooks".
 *   Vỏ này gọi `useSearch()` (theo dõi cả search) rồi rẽ nhánh TRƯỚC khi thân
 *   mount ⇒ không một truy vấn, không một canvas nào dựng lên cho URL sắp rời.
 * ★ Cùng khuôn với `TwinLine`/`TwinMay`: vỏ đọc route (G37), thân nhận qua prop.
 */
export default function TwinVanHanh() {
  const search = useSearch();
  const dichRieng = useMemo(() => dichManRieng(search), [search]);
  if (dichRieng) return <Redirect to={dichRieng} replace />;
  return <ThanTwinVanHanh />;
}

export function ThanTwinVanHanh() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { hasPermission } = usePermissions();

  /*
   * ★★★ THƯỜNG-3 — ĐO chiều cao chrome thay vì ĐOÁN nó.
   *
   * Đặt `--twin-top` = khoảng cách từ đỉnh viewport tới đỉnh khung này, để
   * `height: calc(100vh - var(--twin-top))` luôn vừa khít DÙ chrome cao bao
   * nhiêu. Đo lại khi cửa sổ đổi kích thước (chrome có thể xuống dòng).
   *
   * ⚠ Vì sao không dùng một hằng số khác: đo được `top=133px` trong khi CSS trừ
   * `5rem`=80px ⇒ tràn đúng 77px ở CẢ 1366×768 lẫn 1280×1249. Một hằng số mới
   * cũng chỉ đúng tới lần đổi chrome kế tiếp, và sai thì KHÔNG có lỗi nào nổ.
   */
  const khungRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = khungRef.current;
    if (!el) return;
    const doLai = () => {
      const node = khungRef.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top + window.scrollY;
      /*
       * ★★★ CỘNG CẢ ĐỆM DƯỚI CỦA VỎ ỨNG DỤNG.
       *
       * Đo được (Playwright 2026-09-07): sau khi trừ đúng `top=133`, vẫn còn tràn
       * ĐÚNG 24px. Truy ra: `<main>` của vỏ ứng dụng mang `p-6` ⇒ `paddingBottom
       * = 24px`. Khung này cao vừa khít tới đáy viewport, rồi 24px đệm của CHA
       * đẩy tài liệu dài thêm 24px.
       *
       * ⚠ KHÔNG sửa `p-6` của vỏ: nó là đệm dùng chung của MỌI trang, đổi nó là
       * đổi bố cục toàn hệ để chữa một màn. Thay vào đó trang này tự trừ phần
       * đệm CỦA CHA — đọc từ `getComputedStyle`, không phải hằng số đoán.
       */
      const cha = node.parentElement;
      const demDuoi = cha ? parseFloat(getComputedStyle(cha).paddingBottom) || 0 : 0;
      node.style.setProperty("--twin-top", `${Math.max(0, Math.round(top + demDuoi))}px`);
    };
    doLai();
    window.addEventListener("resize", doLai);
    // Chrome có thể đổi chiều cao mà không có `resize` (băng cảnh báo hiện ra).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(doLai) : null;
    if (ro && el.parentElement) ro.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", doLai);
      ro?.disconnect();
    };
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* Trạng thái từ URL (§9.4)                                                */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /*
   * ★★★ T-3 (§15.5.2) — TRẠNG THÁI URL ĐÃ TÁCH RA `useTrangThaiTwin`.
   *
   * Hook đó là **vỏ React thuần** quanh `duongDanTwin.ts` + `nhungTaiCho.ts`.
   * Nó **KHÔNG tự gọi `useSearch()`** — trang này (thứ DUY NHẤT biết mình đứng
   * ở route nào) gọi `useSearch()` ở `:253` rồi TRUYỀN XUỐNG. Đó là **G37**:
   * `RobotCockpit`/`StationAnalysis` từng tự đọc route, và khi bị nhúng ngoài
   * route của chúng thì `id = NaN` **không exception nào nổ**.
   *
   * ⇒ Nhờ vậy hook dùng được cho **cả ba màn** của QĐ-19 (`/twin`,
   *   `/twin/line/:id`, `/twin/may/:id`) mà không màn nào đọc nhầm query của
   *   màn khác. Lý lẽ đầy đủ ở docblock đầu `useTrangThaiTwin.ts`.
   *
   * ★ Ngăn chi tiết (`?xem=machine:42`) sống trong URL chứ không trong
   *   `useState`: F5 giữa lúc đang xem mà mất ngăn là đúng nỗi bất tiện chủ sở
   *   hữu than phiền, chỉ đổi nguyên nhân. Và vì trạng thái ở URL, **nút Back
   *   của trình duyệt đóng ngăn** — miễn phí.
   */
  const { urlState, ghiUrl, doiPhamVi, doiThu } = useTrangThaiTwin(search, setLocation);
  const phamViYeuCau = urlState.phamVi ?? PHAM_VI_MAC_DINH;
  const machineIdChon = urlState.chon?.loai === "machine" ? urlState.chon.id : null;

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 33 (QĐ-23) — BẤM LINE ⇒ `/twin/line/:id`, BẤM MÁY ⇒ `/twin/may/:id`
   * ════════════════════════════════════════════════════════════════════════
   * Trước đợt này `chonMay` = `ghiUrl({ chon: machine })` (ở lại `/twin`, mở
   * panel) và chạm node Line = `ghiUrl({ phamVi: line })` (màn Line TẠI CHỖ).
   * Đợt 32 đo: kết cục *"chọn Line → Line 3D, chọn máy → Machine 3D"* **không
   * đạt** — `/twin` có 0 href tới hai màn mới. Nay MỌI cú bấm Line/máy trong
   * `/twin` (cây, danh sách, cảnh 3D/2D, dải cảnh báo, dải Line, breadcrumb) đi
   * qua ĐÚNG HAI hàm dưới — không nơi nào tự ghép `/twin/...` (G12).
   *
   * ★ `state: trangThaiVe(...)` — mang `?pv=` hiện tại sang màn con để link
   *   "‹ Nhà máy" về đúng tầng/nhà máy vừa xem (QĐ-23 #5; G37: màn con không
   *   tự đọc route cha). `window.location` đọc TẠI LÚC bấm — cùng lý do với
   *   `ghiUrl` (xem docblock `useTrangThaiTwin`).
   * ★ `chonMay(null)` (bấm nền cảnh để bỏ chọn) vẫn là ghi URL — nó không phải
   *   "đi tới đâu".
   * ★ `?xem=` (ngăn nhúng `NganNhung`) **mất đường vào** từ `/twin`: không còn
   *   `onMoTaiCho`/`nganNhung` truyền xuống `NganXuLy`. Tệp `NganNhung.tsx`
   *   KHÔNG xoá (QĐ-23 #4) — `NganXuLy` vẫn dựng nó khi được truyền, ở màn khác.
   */
  const dieuHuongToiMan = useCallback(
    (duong: string) =>
      setLocation(duong, {
        state: trangThaiVe(`${window.location.pathname}${window.location.search}`),
      }),
    [setLocation],
  );
  const chonMay = useCallback(
    (id: number | null) => {
      if (id === null) {
        ghiUrl({ chon: null });
        return;
      }
      dieuHuongToiMan(duongDanManMay(id));
    },
    [ghiUrl, dieuHuongToiMan],
  );
  const chonLine = useCallback(
    (id: number) => dieuHuongToiMan(duongDanManLine(id)),
    [dieuHuongToiMan],
  );
  /** Breadcrumb: hai cấp dưới đi màn riêng; ba cấp trên ở lại `/twin`. */
  const chonPhamVi = useCallback(
    (pv: PhamVi) => {
      if (pv.cap === "line" && pv.id !== null) return chonLine(pv.id);
      if (pv.cap === "may" && pv.id !== null) return chonMay(pv.id);
      doiPhamVi(pv);
    },
    [chonLine, chonMay, doiPhamVi],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* Dữ liệu                                                                  */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const factoriesQ = trpc.factory.list.useQuery();
  const factories = useMemo(
    () => (factoriesQ.data ?? []) as Array<{ id: number; name?: string; code?: string }>,
    [factoriesQ.data],
  );

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 10 LÔ F — BA CHỈ SỐ `[0]` VIẾT CỨNG ĐÃ BỊ GỠ (§11e.6 F1)
   * ════════════════════════════════════════════════════════════════════════
   * Trước bản này: `factories[0]` (:227) → `toaNha[0]` (:270) → `tangs[0]`
   * (:278). Lô E đo được hậu quả — **không đường nào trong UI hiện hơn một
   * tầng, của một toà, của một nhà máy**, và banner khai sai 373 máy "chưa xếp
   * chỗ" (chúng chỉ ở tầng không được hỏi).
   *
   * ★ Nguồn sự thật của lựa chọn là **URL**, không phải `useState`. Bản cũ giữ
   *   `factoryId` trong state ⇒ không chia sẻ được, không tải lại được, và nút
   *   Back không quay về tầng vừa xem. `phanGiaiNap` chỉ phân giải; nó KHÔNG
   *   ghi — mọi lượt ghi đi qua `ghiUrl` để có đúng một đường vào lịch sử.
   *
   * ⚠ KHÔNG có ngưỡng chặn theo số máy ở đây. Lô E đo 549 máy/tầng: 3 draw
   *   call, 57–59 FPS — §4 đạt rộng rãi. Thêm giới hạn là bịa ràng buộc.
   */
  const mucNhaMay = useMemo<MucChon[]>(
    () => factories.map((f) => ({ id: f.id, nhan: f.name ?? f.code ?? `#${f.id}` })),
    [factories],
  );
  const factoryId = useMemo(
    () =>
      phanGiaiNap(
        { nhaMayId: urlState.nap.nm, toaNhaId: null, tangId: null },
        { nhaMay: mucNhaMay, toaNha: [], tang: [] },
      ).nhaMayId,
    [urlState.nap.nm, mucNhaMay],
  );

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ F3 — `?pv=tapdoan` ĐANG NÓI DỐI, VÀ ĐÂY LÀ CHỖ NÓ THÔI NÓI DỐI
   * ════════════════════════════════════════════════════════════════════════
   * Lô E đo: breadcrumb ghi "Tập đoàn" trong khi `dem-may=549` — **1.592 máy
   * của 3 nhà máy khác vắng mặt**. Hai lối thoát, và lô F chọn có căn cứ:
   *
   *   (a) hiện đủ 4 nhà máy — `canhThietKe` nhận ĐÚNG MỘT `factoryId`
   *       (`twinCanhRouter.ts:646-651`); làm (a) là đổi hợp đồng server, ngoài
   *       phạm vi lô F. Và §11e.6 đã ghi §10C.6 còn lỗi hình học riêng (bước
   *       lưới 400 m làm 4 khối 3 km lồng vào nhau) chưa ai sửa.
   *   (b) nói ĐÚNG phạm vi đang hiện — chọn (b).
   *
   * ★ Hạ cấp mà IM LẶNG cũng là nói dối, chỉ theo chiều ngược. Nên `daHaCap`
   *   bật một dòng giải thích trên màn (xem `banner-ha-cap` phía render).
   * ★ Khi tập đoàn chỉ có MỘT nhà máy, "Tập đoàn" là câu ĐÚNG và không bị hạ —
   *   đó cũng chính là mục nghiệm thu §10C.6 mà lô E đo được là đang hỏng:
   *   tạo nhà máy thứ hai PHẢI làm hành vi này đổi.
   */
  const phamViKq = useMemo(
    () => phamViThuc(phamViYeuCau, factories.length, factoryId === null ? 0 : 1),
    [phamViYeuCau, factories.length, factoryId],
  );
  const phamVi = phamViKq.pv;

  const bayGioThat = Date.now();

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 6 — REALTIME `twin:trangThai` + TUA LẠI, CÙNG MỘT KHO (§9.8)     */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★ Kho là lớp PHỦ lên `mayNen` (nền từ `factoryCommand.overview`), không
   *   thay thế nó: lúc chưa có gói realtime nào, cảnh vẫn phải vẽ đúng dữ liệu
   *   nền — một cảnh trống ở giây đầu chính là "0 giả" mà NT-3 cấm.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 8 — HOOK NÀY ĐỨNG **TRƯỚC** MỌI `useQuery` LÀ CÓ CHỦ Ý
   * ════════════════════════════════════════════════════════════════════════
   * `ketNoi` là đầu vào của `nhipHoiMs` (#51), và `refetchInterval` phải biết
   * nhịp NGAY TẠI chỗ khai truy vấn. Đặt hook ở dưới (như bản Đợt 6) thì nhịp
   * thích nghi không thể tới được các truy vấn — đó chính là lý do cơ học khiến
   * ba `refetchInterval` nằm nguyên dạng hằng số cứng suốt hai đợt.
   */
  const { kho, ketNoi, datAnhLichSu, datMocUns } = useKhoTrangThai(factoryId, bayGioThat);

  /**
   * ★★★ §11 #51 — NHỊP HỎI THÍCH NGHI, CHỖ GỌI THẬT.
   *
   * Đợt 7 đo được (L-1): `nhipHoiMs` viết đúng, có test, **0 chỗ gọi sản phẩm**.
   * Bẫy là *tệp* `nguonDuLieu.ts` ĐÃ được import (cho `xuatXuHienTai`), nên grep
   * theo TÊN TỆP báo "đã nối" trong khi grep theo TÊN HÀM ra 0. Đây là chỗ gọi.
   *
   * ⚠ `coLuongTheoKetNoi` KHÔNG phải `ketNoi !== "chua_ket_noi"`: `im_lang`
   *   (socket còn nối nhưng 25 s không phát gì) phải kéo nhịp XUỐNG 5 s, vì đó
   *   đúng là lúc poll là đường dữ liệu duy nhất còn lại.
   */
  const coLuongDay = coLuongTheoKetNoi(ketNoi);
  const nhipTongQuanMs = nhipHoiMs(coLuongDay);

  // Toà nhà → tầng (hình học sàn). `canhThietKe` KHÔNG trả toà nhà/tầng.
  const toaNhaQ = trpc.twinCanh.danhSachToaNha.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId !== null, retry: false },
  );
  const dsToaNha = useMemo(
    () =>
      (toaNhaQ.data ?? []) as Array<{
        id: number;
        ma?: string;
        ten?: string;
        rongMm: string | number;
        sauMm: string | number;
      }>,
    [toaNhaQ.data],
  );
  const mucToaNha = useMemo<MucChon[]>(
    () => dsToaNha.map((b) => ({ id: b.id, nhan: b.ten || b.ma || `#${b.id}` })),
    [dsToaNha],
  );

  /** Toà ĐANG CHỌN — từ URL, rơi về phần tử đầu khi id không tồn tại. */
  const toaNhaId = useMemo(
    () =>
      phanGiaiNap(
        { nhaMayId: null, toaNhaId: urlState.nap.toa, tangId: null },
        { nhaMay: [], toaNha: mucToaNha, tang: [] },
      ).toaNhaId,
    [urlState.nap.toa, mucToaNha],
  );
  const toaNhaDangChon = useMemo(
    () => dsToaNha.find((b) => b.id === toaNhaId) ?? null,
    [dsToaNha, toaNhaId],
  );

  const chiTietQ = trpc.twinCanh.chiTietToaNha.useQuery(
    { id: toaNhaId ?? 0 },
    { enabled: toaNhaId !== null, retry: false },
  );
  const dsTang = useMemo(
    () => (chiTietQ.data?.tangs ?? []) as Array<{ id: number; capSo?: number; ten?: string }>,
    [chiTietQ.data],
  );
  const mucTang = useMemo<MucChon[]>(
    () =>
      dsTang.map((s) => ({
        id: s.id,
        nhan: s.ten || (s.capSo != null ? `Tầng ${s.capSo}` : `#${s.id}`),
      })),
    [dsTang],
  );

  /** Tầng ĐANG HIỆN — từ URL, rơi về tầng đầu của toà đang chọn. */
  const tangId = useMemo(
    () =>
      phanGiaiNap(
        { nhaMayId: null, toaNhaId: null, tangId: urlState.nap.tang },
        { nhaMay: [], toaNha: [], tang: mucTang },
      ).tangId,
    [urlState.nap.tang, mucTang],
  );

  /**
   * Link người dùng mở có trỏ vào thứ không còn tồn tại không?
   *
   * ⚠ Chỉ tính khi danh sách ĐÃ có ít nhất một mục: lúc truy vấn chưa xong thì
   *   mọi danh sách đều rỗng và `phanGiaiNap` trả `null` — kết luận "link hỏng"
   *   ở khoảnh khắc đó là đọc một phép đo CHƯA CHẠY (đúng lớp lỗi NT-3.5:
   *   "đếm rỗng khác đếm bằng 0").
   */
  const linkBiBoQua =
    (mucNhaMay.length > 0 &&
      yeuCauBiBoQua(
        { nhaMayId: urlState.nap.nm, toaNhaId: null, tangId: null },
        { nhaMayId: factoryId, toaNhaId: null, tangId: null },
      )) ||
    (mucToaNha.length > 0 &&
      yeuCauBiBoQua(
        { nhaMayId: null, toaNhaId: urlState.nap.toa, tangId: null },
        { nhaMayId: null, toaNhaId, tangId: null },
      )) ||
    (mucTang.length > 0 &&
      yeuCauBiBoQua(
        { nhaMayId: null, toaNhaId: null, tangId: urlState.nap.tang },
        { nhaMayId: null, toaNhaId: null, tangId },
      ));

  const tangDau = useMemo(() => {
    if (!toaNhaDangChon || tangId === null) return null;
    // ★ `numeric(14,3)` về từ drizzle là STRING. `Number(...)` tường minh là bắt
    //   buộc: cộng hai string sẽ NỐI CHUỖI ("38400"+"0"="384000") — không throw,
    //   và nhà xưởng to gấp 10 lần.
    return {
      tangId,
      rongMm: Number(toaNhaDangChon.rongMm),
      sauMm: Number(toaNhaDangChon.sauMm),
    };
  }, [toaNhaDangChon, tangId]);

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ F2 — HỎI **MỌI TẦNG CỦA TOÀ ĐANG CHỌN**, KHÔNG CHỈ TẦNG ĐANG HIỆN
   * ════════════════════════════════════════════════════════════════════════
   * Đây là nửa thứ hai của bản vá "373 máy chưa xếp chỗ", và nó KHÔNG phải là
   * "nạp nhiều hơn cho chắc". Lý do cơ học:
   *
   *   `canhThietKe` trả `may` của **cả nhà máy** nhưng `datCho` chỉ của
   *   `tangIds` được hỏi. Đem hai tập LỆCH PHẠM VI đó so với nhau
   *   (`doiSoatCanh`) là đếm ĐẦU VÀO ≠ ĐẦU RA — họ G7. Máy tầng 2/3 có hàng
   *   `twin_dat_cho` thật, nhưng client không thấy nên khai chúng "chưa xếp
   *   chỗ".
   *
   * ⇒ Hỏi đủ tầng của toà thì client BIẾT máy nào đã có chỗ ở tầng khác, và
   *   `tapDoiSoatTheoNap` loại chúng khỏi banner (xếp vào một con số có nhãn
   *   riêng "ở tầng khác"), thay vì khai sai.
   *
   * ★ Chi phí: `traDatChoTheoTang` chạy một `nhaMayCuaTang` mỗi tầng (bounded
   *   ≤50 theo Zod). Đo được ở lô E: hiệu năng VẼ không phải nút thắt (3 draw
   *   call ở 549 máy), nên đổi thêm vài truy vấn lấy một câu khai ĐÚNG là đánh
   *   đổi rõ ràng có lợi. Máy ngoài tầng đang hiện KHÔNG được vẽ — bộ lọc vẽ là
   *   `d.tangId === tangId`, xem `mayVe` bên dưới.
   */
  const tangIdsHoi = useMemo(() => dsTang.map((s) => s.id).slice(0, 50), [dsTang]);

  // Hình học + cây phân cấp.
  const canhQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: factoryId ?? 0, tangIds: tangIdsHoi },
    { enabled: factoryId !== null, retry: false },
  );

  /**
   * ★★★ T-1 TẦNG 2 (§15.5.2 / Đợt 28) — BỐN TRUY VẤN TRẠNG THÁI LIVE ĐÃ TÁCH.
   *
   * ⚠⚠⚠ **TẦNG NÀY MANG BẤT BIẾN AN TOÀN.** `andon.active` và
   *   `twinCanh.anToanRobot` có **TRẦN 20 s**, `sucKhoeMay` có trần 60 s. Luật
   *   (Đợt 8): nhịp thích nghi **chỉ được RÚT NGẮN, không được KÉO DÀI** —
   *   *"an toàn không được chậm đi vì một tối ưu"*.
   *
   * ★ Trần nay là HẰNG CÓ TÊN (`TRAN_NHIP_AN_TOAN_MS` / `TRAN_NHIP_SUC_KHOE_MS`)
   *   trong `useTrangThaiSong.ts`, không còn là số rải rác ở chỗ gọi. Nhờ vậy
   *   `nhipAnToan.unit.test.ts` đo được **GIÁ TRỊ THẬT** mà react-query nhận,
   *   thay vì đếm chính tả một dòng mã — phép đo cũ chết khi mã dời nhà và mù
   *   với cách viết khác.
   */
  const { overviewQ, andonQ, anToanQ, sucKhoeQ } = useTrangThaiSong({
    factoryId,
    coLuongDay,
    nhipTongQuanMs,
  });

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 8 — §11 #61 + #32 + #36: WIP, NÚT THẮT, NHỊP CHUYỀN             */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ BA truy vấn này CHỈ BẬT Ở PHẠM VI LINE, và đó không phải tối ưu.
   *
   * WIP là đại lượng CỦA MỘT CHUYỀN. Cả ba thủ tục đều nhận `lineId` bắt buộc
   * (hoặc chỉ có nghĩa với nó). Gọi chúng ở cấp Tầng/Xưởng thì hoặc phải bịa một
   * `lineId`, hoặc phải gộp WIP của nhiều chuyền vào một cột — và một cột "tổng
   * WIP toàn xưởng" đứng tại tâm một trạm là câu trả lời cho câu hỏi mà không ai
   * hỏi. §10C.3 vốn đã xếp ống WIP và đường dòng chảy vào riêng phạm vi Line.
   */
  const lineDangXem = phamVi.cap === "line" ? phamVi.id : null;

  /**
   * ★★★ T-1 TẦNG 3 (§15.5.2 / Đợt 28) — HAI TRUY VẤN PHÂN TÍCH LINE ĐÃ TÁCH.
   *
   * `usePhanTichLine` giữ `digitalTwin.wipFlowState` (#61) + `wip.lineBalance`
   * (#32 + #36). Chúng chia CHUNG đúng một cửa `lineDangXem !== null`, nên tách
   * cùng nhau giữ khớp nối ấy ở MỘT chỗ thay vì hai chỗ phải nhớ trùng nhau.
   *
   * ★ HAI NHỊP KHÁC NHAU và sự khác nhau ấy CÓ CHỦ Ý: `wipFlowState` dùng nhịp
   *   THÍCH NGHI (WIP đổi theo từng chiếc rời trạm), `lineBalance` dùng
   *   `NHIP_CO_LUONG_MS` CỐ ĐỊNH (số liệu tổng hợp theo KỲ — hỏi 5 giây một lần
   *   khi socket chết chỉ đọc lại đúng một hàng). Gộp hai nhịp là ĐỔI HÀNH VI.
   *
   * ★ Tầng 3 KHÔNG mang bất biến an toàn: cả hai đều không gọi `nhipHoiToiDa`,
   *   nên không thể vi phạm trần 20 s/60 s của tầng 2. WIP chậm một nhịp là một
   *   con số cũ; CẢNH BÁO chậm một nhịp là người đứng cạnh máy chưa biết dừng.
   */
  const { wipQ, canBangQ } = usePhanTichLine({ lineDangXem, nhipTongQuanMs });

  /**
   * ★★★ "MỘT LỐI VÀO RỒI TỪ CHỐI" — bắt FORBIDDEN của truy vấn hình học.
   * Người dùng qua cổng `analytics_oee` nhưng `canhThietKe` đòi
   * `settings_factory`/`machine_control`. Không bắt thì họ thấy một cảnh TRỐNG
   * trông y như nhà máy chưa dựng — lời khai sai về thế giới.
   */
  const thieuQuyenBoCuc =
    (canhQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (toaNhaQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN";

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 23 M3 (L-4) — `EmptyState` CÓ TRONG MÃ MÀ **KHÔNG BAO GIỜ HIỆN**
   * ════════════════════════════════════════════════════════════════════════
   * ĐO ĐƯỢC 2026-09-08 trên `dist`, vai `operator1` (KHÔNG-admin, **0 hàng**
   * `user_factory_assignments` — G76 đã kiểm bằng SQL độc lập):
   *
   *     `factory.list`              → **[] (n=0)**      ⇒ `factoryId = null`
   *     `twinCanh.canhThietKe`      → **0 lần gọi**     (`enabled: factoryId !== null`)
   *     `canhQ.data`                → `undefined`
   *     `phamViRong`                → **false**         ⇒ `EmptyState` KHÔNG hiện
   *     màn thật                    → 0 máy · 0 nhãn · mọi KPI `—`
   *     nhưng vỏ vẫn khai           → **"Alarms (7)"**
   *
   * ⇒ Màn TỰ MÂU THUẪN: sàn trống trơn mà ô đếm vẫn khai có cảnh báo.
   *
   * ★★★ CHẨN ĐOÁN CỦA BRIEF ĐÚNG TRIỆU CHỨNG, **SAI MỘT BƯỚC VỀ GỐC RỄ**.
   *   Brief nói *"nếu `canhQ` không trả cờ… `EmptyState` không hiện"*, ngụ ý
   *   `canhThietKe` chạy rồi thiếu cờ. Đo ra thì **thủ tục KHÔNG HỀ CHẠY** —
   *   nó bị `enabled: factoryId !== null` chặn từ trước. Khác biệt này quan
   *   trọng: vá bằng cách "thêm cờ vào `canhThietKe`" sẽ **không đổi được gì**,
   *   vì đáp ứng ấy không bao giờ tồn tại. Server đã trả đúng nhãn rồi
   *   (`twinCanhRouter.ts:1057` `...nhan.labels`); chỗ hỏng nằm ở CHỖ ĐỌC.
   *
   * ⇒ Nguồn sự thật phải là truy vấn **LUÔN CHẠY** và không phụ thuộc
   *   `factoryId`: `factory.list`. Danh sách nhà máy RỖNG **sau khi đã tải
   *   xong** chính là định nghĩa của "chưa được gán nhà máy".
   *
   * ★ G12 — dùng `scopeEmptyReasonOf` (`lib/scopeEmpty.ts:58`), thứ đã tồn tại
   *   ĐÚNG cho bài toán "gom lý do từ NHIỀU nguồn cùng màn", thay vì viết phép
   *   hợp nhất thứ hai.
   *
   * ⚠ `!factoriesQ.isLoading` là ĐIỀU KIỆN BẮT BUỘC: trong lượt tải đầu
   *   `factories` cũng rỗng, và thiếu vế này thì MỌI người dùng thấy
   *   `EmptyState` nhấp nháy một nhịp trước khi cảnh hiện — biến một bản vá
   *   thành một lỗi mới cho toàn bộ người dùng. `isError` cũng loại trừ: lỗi
   *   mạng KHÔNG phải "chưa được gán" (hai câu, hai hành động khác nhau).
   */
  const phamViRong =
    isScopeEmpty(
      scopeEmptyReasonOf(
        canhQ.data as { scopeEmptyReason?: string | null } | undefined,
        toaNhaQ.data as { scopeEmptyReason?: string | null } | undefined,
      ),
    ) ||
    (!factoriesQ.isLoading && !factoriesQ.isError && factories.length === 0);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* Hợp nhất dữ liệu — MỘT nguồn cho cả 3D, 2D, bảng và ô đếm                */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * `machineId` → dấu thời gian DỮ LIỆU TRẠNG THÁI mới nhất (ms), hoặc `null`.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ CHỈ NHẬN `kind === "offline"` — MỘT LỖI NT-3 ĐO ĐƯỢC, ĐÃ VÁ
   * ════════════════════════════════════════════════════════════════════════
   * Bản đầu nhận MỌI `issues[].ageMinutes` làm "tuổi dữ liệu". Nghiệm thu trên
   * trình duyệt thật bắt được hậu quả ngay: sau khi RAISE một andon lên máy 2,
   * ô "tươi" nhảy từ 0 lên 1 và máy 2 hiện `16s` — **một cảnh báo mới làm máy
   * trông như vừa gửi tín hiệu**, trong khi SQL thô nói nó im lặng từ 2026-09-03.
   *
   * Gốc rễ đọc tại nguồn (`server/services/factoryCommandService.ts`):
   *   :342 `kind:"andon"`    → `ageMinutes` = tuổi của `andon_events.raisedAt`
   *   :385 `kind:"workorder"`→ tuổi của `scheduledFor`
   *   :373 `kind:"pdm"`      → tuổi của bản ghi health
   *   :404 `kind:"offline"`  → `st.ts` = `machine_status_logs."timestamp"` ★
   * Chỉ dòng cuối là THỜI ĐIỂM ĐO TRẠNG THÁI. Bốn dòng kia là tuổi của những
   * SỰ KIỆN KHÁC, và trộn chúng vào đây biến "máy vừa được báo lỗi" thành "máy
   * vừa gửi tín hiệu" — đúng lớp lỗi giả-tươi mà NT-3.2 sinh ra để chặn.
   *
   * ⚠ Hệ quả trung thực: máy KHÔNG offline thì hợp đồng fleet hiện tại **không
   *   mang** dấu thời gian nào, nên ta để `null` ⇒ `khong_ro` (xám gạch chéo).
   *   Đó là câu trả lời ĐÚNG: ta thật sự không biết dữ liệu của nó cũ bao nhiêu.
   *   Đoán một con số ở đây là bịa. Nợ đã ghi: thêm `statusTs` vào
   *   `CommandMachineNode` (giá trị đã có sẵn tại `factoryCommandService.ts:211`).
   */
  const tsTheoMay = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const iss of overviewQ.data?.issues ?? []) {
      if (iss.kind !== "offline") continue;
      if (iss.machineId == null || typeof iss.ageMinutes !== "number") continue;
      const ts = Date.now() - iss.ageMinutes * 60_000;
      const cu = m.get(iss.machineId);
      if (cu == null || ts > cu) m.set(iss.machineId, ts);
    }
    return m;
  }, [overviewQ.data]);

  const may = canhQ.data?.may ?? [];
  const tram = canhQ.data?.tram ?? [];
  const chuyen = canhQ.data?.chuyen ?? [];

  /** Trạm → line, để suy `lineId` của máy (máy chỉ mang `stationId`). */
  const lineCuaTram = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of tram) m.set(s.id, s.lineId);
    return m;
  }, [tram]);

  /** Danh sách máy đã hợp nhất trạng thái + tuổi dữ liệu (NT-3). */
  const mayNen = useMemo<MayVanHanh[]>(() => {
    const tt = new Map<number, string>();
    for (const n of overviewQ.data?.machines ?? []) tt.set(n.id, n.status);
    return may.map((m) => ({
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
  }, [may, overviewQ.data, tsTheoMay, lineCuaTram]);

  // ★ `bayGioThat` + `useKhoTrangThai` đã khai ở TRÊN mọi `useQuery` (§11 #51) —
  //   `ketNoi` phải có mặt trước khi các truy vấn khai `refetchInterval`.

  /* ── Tua lại (§9.8) ─────────────────────────────────────────────────── */

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 12 LÔ L — MỐC TUA SỐNG TRONG **URL** (`?tg=`), KHÔNG TRONG STATE
   * ════════════════════════════════════════════════════════════════════════
   * `duongDanTwin.ts` đã có `docThoiGian`/`ghiThoiGian`, khoá `tg=` đã nằm
   * trong `TrangThaiTwinUrl`, `docTrangThaiUrl` đã phân tích nó, và
   * `tronTrangThaiUrl`/`kieuGhiLichSu` đã xử lý nó — **có test, có mã, và
   * KHÔNG MỘT CHỖ GỌI SẢN PHẨM NÀO** (đo 2026-09-07: `grep -rn "\.tg\b|
   * docThoiGian|ghiThoiGian" client/src` ngoài chính `duongDanTwin*` ⇒ rỗng).
   * Đây đúng lớp lỗi G16 mà Đợt 7 phát hiện với `nhipHoiMs` và lớp phủ WIP: hạ
   * tầng dựng xong, cổng xanh, và người dùng không nhận được gì.
   *
   * Hậu quả CỤ THỂ của bản `useState` cũ, cả ba đều là thứ người dùng gặp:
   *   • F5 giữa lúc đang xem lại 08:30 ⇒ văng về trực tiếp, mất chỗ đang xem;
   *   • không gửi được "anh xem giúp em lúc 08:30" thành một đường link —
   *     đúng công dụng mà `?pv=`/`?chon=`/`?cam=` sinh ra để phục vụ;
   *   • nút Back không quay lại mốc vừa xem.
   *
   * ★ `replace` chứ không `push` (`kieuGhiLichSu` đã quyết định vậy cho `tg`):
   *   vòng phát lại ×20 ghi MỘT mốc mỗi giây, và đẩy từng cái vào history sẽ
   *   biến nút Back thành vô dụng — đúng lý do camera cũng dùng `replace`.
   */
  const mocTua = urlState.tg;
  const setMocTua = useCallback(
    (moc: number | null) => ghiUrl({ tg: moc }),
    [ghiUrl],
  );

  /*
   * ★ `dangPhat`/`tocDo` Ở LẠI `useState`, CÓ CHỦ Ý — không phải bỏ sót.
   *   Chúng là cách ĐANG ĐI TỚI một mốc, không phải CHỖ đang đứng. Người nhận
   *   link phải thấy đúng khung hình 08:30, chứ không phải một cảnh đang tự
   *   chạy ×20 mà họ không bấm; và ghi `dangPhat` vào URL còn thêm một lượt
   *   ghi history mỗi lần vòng phát tự dừng ở hiện tại.
   */
  const [dangPhat, setDangPhat] = useState(false);
  const [tocDo, setTocDo] = useState<TocDo>(1);

  /**
   * ★★★ ẢNH LỊCH SỬ (§9.8) ĐÃ TÁCH RA `useAnhLichSu` — Đợt 28.
   *
   * ★ Truy vấn này KHÔNG đi cùng "tầng 4" dù brief xếp chung: ba truy vấn mô
   *   phỏng chỉ TRẢ dữ liệu cho một ngăn đọc, còn cái này GHI vào kho trạng
   *   thái dùng chung (`datAnhLichSu`). Nó có TÁC DỤNG PHỤ, chúng thì không —
   *   và `useEffect` ghi kho nay nằm ngay cạnh truy vấn nuôi nó.
   */
  const { lichSuQ } = useAnhLichSu({ factoryId, mocTua, datAnhLichSu });

  /**
   * ★★★ MỘT đồng hồ cho MỌI phép xét tuổi. Khi đang tua, đây là MỐC ĐANG XEM
   *   chứ không phải giờ hiện tại — nếu không, mọi máy trong ảnh lịch sử đều
   *   thành `khong_ro` vì "cũ 3 tiếng", và tua lại trở nên vô dụng.
   */
  const bayGio = dongHoHienThi(kho, bayGioThat);

  /**
   * Máy SAU khi phủ realtime/lịch sử — nguồn duy nhất cho 3D, 2D, bảng, ô đếm.
   *
   * ★★★ TÊN `mayVanHanh` CỐ Ý TRỎ VÀO BẢN **ĐÃ HỢP NHẤT**.
   *
   * Bản nền giờ tên `mayNen` và KHÔNG có call site nào ngoài dòng này. Làm vậy
   * để không thể "quên" một chỗ tiêu thụ: nếu ai đó thêm một bề mặt mới và đọc
   * `mayVanHanh`, họ tự động lấy bản có realtime/tua lại. Cách ngược lại (đặt
   * tên mới cho bản hợp nhất rồi đi sửa 15 chỗ) là cách chắc chắn bỏ sót một
   * chỗ, và chỗ bỏ sót đó sẽ hiện dữ liệu cũ mà KHÔNG kêu.
   */
  const mayVanHanh = useMemo(() => hopNhat(mayNen, kho), [mayNen, kho]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ §11 #50 — UNS STREAM ISA-95, NGUỒN REALTIME THỨ HAI                  */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Di trú từ `FactoryLiveMap3D.tsx:87` — màn DUY NHẤT trong repo dùng
   * `useUnsStream`, và Đợt 7 sẽ xoá nó. Không di trú = mất một đường dữ liệu thật.
   *
   * ★ Tiền tố là slug ISA-95 của MÃ nhà máy (`isa95Slug(factory.code)`), y hệt
   *   bản gốc. Nhà máy chưa chọn ⇒ `null` ⇒ hook tự trơ, không mở socket.
   */
  const nhaMayHienTai = useMemo(
    () => factories.find((f) => f.id === factoryId) ?? null,
    [factories, factoryId],
  );
  const tienToUns = nhaMayHienTai?.code ? isa95Slug(nhaMayHienTai.code) : null;
  const uns = useUnsStream({ pathPrefix: tienToUns, aspects: ["state"], enabled: true });

  /**
   * ★★★ Đổ ảnh chụp UNS vào KHO DÙNG CHUNG, không vẽ thẳng.
   *
   * ⚠⚠ HAI CỔNG, và cả hai đều cần thiết:
   *   1. `uns.live` — hook tự khai khi CHƯA có snapshot/mất kết nối. Phủ khi
   *      chưa live là bịa dữ liệu; `useUnsStream` nói rõ *"this hook never
   *      fabricates data"* và người gọi phải giữ nguồn cũ.
   *   2. `mocTua === null` — đang TUA LẠI thì một gói realtime tới KHÔNG được
   *      kéo cảnh về hiện tại trong khi nhãn vẫn nói "Xem lại 14:32". Đúng lớp
   *      lỗi mà §9.8 và docblock `datAnhLichSu` đã ghi.
   */
  useEffect(() => {
    if (!uns.live || mocTua !== null) return;
    const isActiveTheoMay = new Map(mayNen.map((m) => [m.id, m.isActive]));
    /*
     * ⚠⚠ `byMachineId` là **`Map`**, KHÔNG phải object (`unsStreamClient.ts:93`).
     * Bản viết đầu dùng `Object.values(...)` — `tsc` XANH, và nó trả **mảng
     * RỖNG** trong im lặng: UNS sẽ không bao giờ phủ được gì, và màn hình trông
     * y hệt lúc stream chưa bật. Đúng lớp lỗi G5 "đo trên tập rỗng", chỉ khác
     * là tập bị làm cho rỗng bởi chính bản vá.
     */
    const anhChup = [...uns.byMachineId.values()];
    const moc = mocTuAnhChupUns(anhChup, isActiveTheoMay);
    if (moc.length > 0) datMocUns(moc, bayGioThat);
    // `bayGioThat` đổi mỗi render nên KHÔNG đưa vào deps — nó chỉ là nhãn "nhận
    // lúc", không phải thứ quyết định có bơm hay không (thứ ấy là `byMachineId`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uns.live, uns.byMachineId, mocTua, mayNen, datMocUns]);

  /* ── §11 #26 — E-STOP nổi lên tổng quan ───────────────────────────────── */

  /**
   * ★★★ NỢ ĐỢT 6 ĐÃ ĐÓNG — trước đây ô này là `tomTatAnToan([])`, một MẢNG RỖNG
   * HARDCODE, nên badge E-STOP không thể nổi lên dù có robot đang nhấn thật.
   *
   * Nguồn nay là `twinCanh.anToanRobot` — thủ tục riêng, cùng cổng quyền với
   * `/twin`, phạm vi nhà máy đi qua `traCayPhanCapNhaMay`. Robot KHÔNG cần vào
   * được `twin_dat_cho`: §3 NT-2 luật 1 đòi badge an toàn vẽ ở KHÔNG GIAN MÀN
   * HÌNH, nên dải này chỉ cần biết robot NÀO, không cần toạ độ của nó.
   *
   * ⚠ `anToanQ.data?.robot ?? []` — khi truy vấn CHƯA XONG hoặc BỊ TỪ CHỐI thì
   *   ta không có dữ liệu an toàn nào, và mảng rỗng ở đây nói đúng câu ấy: dải
   *   không hiện. Điều KHÔNG được làm là để trạng thái lỗi tự suy thành "mọi
   *   robot đã nhả E-STOP" — và `tomTatAnToan` không có đường nào ra kết luận
   *   đó từ một mảng rỗng (`coCanhBao` chỉ bật khi có phần tử `nhan`).
   */
  const anToan = useMemo(() => tomTatAnToan(anToanQ.data?.robot ?? []), [anToanQ.data]);

  /** Trạng thái HIỂN THỊ (đã xét tuổi) — nguồn duy nhất cho mọi bề mặt. */
  const trangThaiTheoMay = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayVanHanh) m.set(mv.id, trangThaiHienThi(mv, bayGio).trangThai);
    return m;
  }, [mayVanHanh, bayGio]);

  const maTheoMay = useMemo(() => {
    const m = new Map<number, string>();
    for (const mv of mayVanHanh) m.set(mv.id, mv.ma);
    return m;
  }, [mayVanHanh]);

  /**
   * Đặt chỗ theo máy **CỦA TẦNG ĐANG HIỆN** — nguồn vị trí 3D.
   *
   * ★★★ F2 — `canhQ` nay hỏi MỌI tầng của toà (để đối soát nói đúng), nên bản
   *   đồ này PHẢI lọc lại theo `tangId`. Không lọc thì máy ba tầng chồng lên
   *   nhau trên cùng mặt sàn — và không có lỗi nào nổ, chỉ là một nhà xưởng
   *   trông đông gấp ba (đúng lớp "sai mà không kêu" của §5.2).
   */
  const datChoTheoMay = useMemo(() => {
    // `NonNullable` vì `canhQ.data` là `… | undefined` lúc chưa tải xong; ta chỉ
    // cần KIỂU của phần tử, không cần giá trị.
    type HangDatCho = NonNullable<typeof canhQ.data>["datCho"][number];
    const m = new Map<number, HangDatCho>();
    for (const d of canhQ.data?.datCho ?? []) {
      if (d.loaiThucThe !== "machine") continue;
      if (tangId !== null && d.tangId !== tangId) continue;
      m.set(d.thucTheId, d);
    }
    return m;
  }, [canhQ.data, tangId]);

  /**
   * Máy có chỗ ở **BẤT KỲ tầng nào của toà đang chọn** — vế thứ hai của F2.
   * Đây là tập cho phép phân biệt "chưa xếp chỗ" với "ở tầng khác".
   */
  const idCoDatChoDaHoi = useMemo(() => {
    const s = new Set<number>();
    for (const d of canhQ.data?.datCho ?? []) {
      if (d.loaiThucThe === "machine") s.add(d.thucTheId);
    }
    return [...s];
  }, [canhQ.data]);

  /**
   * Nhà máy chỉ có MỘT toà ⇒ lượt hỏi đã phủ mọi tầng của nhà máy, nên câu
   * "chưa xếp chỗ" suy được. Nhiều toà ⇒ KHÔNG suy được, và ta khai "chưa đo"
   * thay vì khai sai (G9: một phép đếm chỉ đúng trong phạm vi mẫu của nó).
   */
  const moiToaDaHoi = dsToaNha.length <= 1;

  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ F2 — ĐỐI SOÁT CHỈ TRÊN TẬP MÀ LƯỢT NẠP NÀY PHÁT BIỂU ĐƯỢC
   * ════════════════════════════════════════════════════════════════════════
   * Bản cũ đưa CẢ `mayVanHanh` (máy của cả nhà máy) so với `datChoTheoMay` (chỉ
   * tầng[0]) — hai tập lệch phạm vi, và chênh lệch đó bị in ra như "N máy chưa
   * xếp chỗ". Ở FUYU-F 549 máy trải 176/187/186, con số đó là **373**, và cả
   * 373 máy ấy ĐỀU đã có hàng `twin_dat_cho` thật.
   *
   * `tapDoiSoatTheoNap` cắt tập máy xuống đúng phần lượt nạp này có thẩm quyền
   * nói về, và trả `soNgoaiLuotNap` để phần bị cắt vẫn được KHAI — nhưng khai
   * đúng câu ("ở tầng/toà khác"), không phải câu sai ("chưa xếp chỗ").
   */
  const tapDs = useMemo(
    () =>
      tapDoiSoatTheoNap(
        mayVanHanh.filter((m) => m.isActive).map((m) => m.id),
        [...datChoTheoMay.keys()],
        idCoDatChoDaHoi,
        moiToaDaHoi,
      ),
    [mayVanHanh, datChoTheoMay, idCoDatChoDaHoi, moiToaDaHoi],
  );

  const kichThuocTheoLoai = useMemo(() => {
    const m = new Map<string, { rongMm: number; caoMm: number; sauMm: number }>();
    for (const k of canhQ.data?.kichThuoc ?? []) {
      m.set(k.loaiMay, { rongMm: k.rongMm, caoMm: k.caoMm, sauMm: k.sauMm });
    }
    return m;
  }, [canhQ.data]);

  /* ── Máy để VẼ (3D và 2D dùng CHUNG mảng này) ───────────────────────── */
  /**
   * Màu nền cảnh, phân giải từ token `--background` (§10.4: 3D phải đúng ở CẢ
   * hai theme). Dùng làm ĐÍCH PHA cho vật thể ngoài phạm vi — pha về nền cho ra
   * "nhạt đi" đúng nghĩa, khác hẳn làm tối (xem `phaVeNen`).
   */
  /*
   * ★★★ `mauCss` CHỨ KHÔNG `giaiMauCanh` TRẦN — G29, ĐO ĐƯỢC 84 WARNING.
   *
   * `giaiMauCanh("--background")` trả nguyên chuỗi `oklch(14.5% .015 260)`.
   * Chuỗi đó chảy vào `phaVeNen()` (nơi `tachRgb` cũ trả `null` ⇒ **không pha
   * gì**) rồi vào `LoBatchMay.tsx:189` `c.set(m.mau)` — three **warn rồi trả
   * TRẮNG** cho từng máy, từng lần cập nhật. 42 máy ⇒ hàng chục warning và
   * **mọi máy trắng như nhau**: cảnh 3D chở 0 bit về trạng thái.
   *
   * `mauCss` quy qua canvas 2D ra `rgb(r, g, b)` thật — three đọc được, và
   * `tachRgb` của `phaVeNen` cũng đọc được, nên "mờ 12 % cho Line ngoài phạm
   * vi" (§10C) bắt đầu **có hiệu lực lần đầu**.
   */
  const mauNenCanh = mauCss("--background", "#f8fafc");

  const mayVe = useMemo<MayTrongLo[]>(
    () =>
      /*
       * ★ T-4 — thân vòng lặp đã dời sang `hopNhatCanh.dungMayVe` (hàm THUẦN),
       *   để màn Line và màn Machine dùng lại CÙNG một bản. Đặc biệt phép HOÁN
       *   VỊ TRỤC (DB Y = mặt bằng → scene z) nay đi qua `mmSangScene()` của
       *   `heToaDo.ts` — MỘT chỗ quy đổi thay vì một bản sao viết tay ở đây.
       *   Lưới `hopNhatCanh.unit.test.ts` ghim từng trục vào đúng nguồn.
       *
       * ★ `mauCss`/`phaVeNen`/`mauChoTrangThai`/`hinhKhoiCho` TIÊM xuống chứ
       *   không để module tự import: `mauCss` đọc `getComputedStyle`, và một
       *   module thuần không được kéo theo DOM.
       */
      dungMayVe({
        may: mayVanHanh,
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
            phamVi,
          ),
        mauNenCanh,
        tiLePhaNgoaiPhamVi: TI_LE_PHA_NGOAI_PHAM_VI,
        congCu: { mauCss, phaVeNen, mauChoTrangThai, hinhKhoiCho },
      }),
    [mayVanHanh, datChoTheoMay, kichThuocTheoLoai, trangThaiTheoMay, phamVi, factoryId, mauNenCanh],
  );

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 21 — A-4: VÒNG VIỀN SỨC KHOẺ, quy từ lời khai + chỗ đặt
   * ════════════════════════════════════════════════════════════════════════
   * `vienSucKhoe()` (lô Z, `sucKhoeMay.ts:333`) nhận **lời khai** và **chỗ đặt**
   * rồi trả danh sách vòng CÓ MÀU. Nó tự loại hạng `khoe`/`chua_do` ngay trong
   * hàm, nên tầng này KHÔNG được thêm một bộ lọc thứ hai (G12: một luật, một
   * chỗ — hai bản cài đặt sẽ lệch và không ai biết tin cái nào).
   *
   * ★ `cho` dựng từ **`mayVe`**, không phải từ `mayVanHanh`: `mayVe` là tập đã
   *   qua `datChoTheoMay` + `hienThi`, tức là **đúng những máy đang được vẽ**.
   *   Lấy từ `mayVanHanh` sẽ sinh vòng cho máy không có trên cảnh — một vòng
   *   viền lơ lửng ở gốc toạ độ, và không lỗi nào nổ.
   *
   * ⚠ `viTri` của `mayVe` đã đổi trục (DB Y = mặt bằng → scene z). `ChoDatVien`
   *   nhận `{x, z}` theo hệ **CẢNH**, nên truyền thẳng `viTri.x`/`viTri.z` là
   *   đúng. Lấy nhầm `viTri.y` (độ cao) sẽ dán mọi vòng lên một đường thẳng —
   *   đúng BẪY HOÁN VỊ TRỤC đã ghi ở sổ, và nó KHÔNG làm gì nổ.
   */
  const vienSucKhoeCanh = useMemo(
    () =>
      vienSucKhoe(
        (sucKhoeQ.data?.khai ?? []) as KhaiSucKhoe[],
        mayVe.map((m) => ({
          machineId: m.machineId,
          viTri: { x: m.viTri.x, z: m.viTri.z },
          kichThuocMm: { rong: m.kichThuocMm.rongMm, sau: m.kichThuocMm.sauMm },
        })),
        bayGio,
      ),
    [sucKhoeQ.data, mayVe, bayGio],
  );

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 21 — A-6: VÙNG AN TOÀN LÊN MẶT VẬN HÀNH (chỉ ĐỌC)
   * ════════════════════════════════════════════════════════════════════════
   * ★ TÁI DÙNG `vungTuDanhSach` + `LopVung` của màn **Thiết kế** (G12) — 49 lưới
   *   đã canh chúng. Viết bản thứ hai cho mặt vận hành là mở đường cho hai bề
   *   mặt vẽ hai đa giác khác nhau từ cùng một hàng DB.
   *
   * ★★★ **KHÔNG truyền `onChon`**: mặt Vận hành là **chỉ đọc hình học**
   *   (`canhThietKe` ở đây là nguồn đọc). Cho phép chọn/kéo vùng ở đây là mời
   *   người ta sửa nhà xưởng trong khi đang xem cảnh báo — đúng lý lẽ §12b.4 đã
   *   dùng để tách hai mặt, và nay QD-16 giữ tách ấy bằng VÙNG chứ không bằng
   *   trang.
   *
   * ⚠⚠ **NGUỒN HIỆN ĐANG RỖNG, VÀ ĐÓ LÀ ĐÚNG.** Lô Z đo: `twin_vat_the` có
   *   **4 hàng, toàn `loai='tuong'`, 0 hàng `vung`** trên toàn hệ. Nên sau khi
   *   nối, cảnh **sẽ không vẽ vùng nào**. Đừng "sửa" bằng dữ liệu giả — một
   *   vùng an toàn bịa ra là lời khai sai về chỗ người được đứng.
   */
  const vungCanh = useMemo(
    () => vungTuDanhSach((canhQ.data?.vung ?? []) as HangVung[]),
    [canhQ.data],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ §11 #53 — KHU CHỜ XẾP CHỖ: máy chưa đặt = BÁN TRONG SUỐT             */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ⚠⚠ Trước bản này máy chưa có `twin_dat_cho` **không được vẽ chút nào** —
   * vòng `mayVe` ở trên có `if (!d || !d.hienThi) continue`. Banner đối soát ĐẾM
   * chúng ("N máy chưa xếp chỗ") nhưng cảnh thì im lặng bỏ qua, nên người dùng
   * đọc được một con số mà không bao giờ thấy được nó trỏ vào cái gì.
   *
   * ⇒ #53 không phải "đổi độ mờ của thứ đang vẽ" mà là CHO NÓ MỘT CHỖ ĐỨNG
   *   trước đã: một khu chờ ngoài rìa mặt bằng, pha về nền `PHA_KHU_CHO` (xem
   *   `khuChoVaNhanLine.ts` về vì sao pha-về-nền chứ không phải alpha, và vì
   *   sao KHÔNG dùng kênh `doMo` — nó LÀM TỐI, và tối = "đang lỗi" theo ISA-101).
   *
   * ★ Neo khu chờ vào bbox của phần ĐÃ đặt, không vào một hằng số toạ độ: mặt
   *   bằng mỗi nhà máy một kích thước, và một hằng số sẽ hoặc chồng lên nhà
   *   xưởng, hoặc trôi ra xa tới mức không ai cuộn tới.
   */
  const mayKhuCho = useMemo<MayTrongLo[]>(() => {
    /*
     * ★★★ ĐIỀU KIỆN PHẢI LÀ **PHỦ ĐỊNH CHÍNH XÁC** CỦA ĐIỀU KIỆN VẼ.
     *
     * ⚠⚠ Bản viết đầu lọc `!datChoTheoMay.has(mv.id)` — chỉ bắt máy KHÔNG CÓ
     * hàng đặt chỗ. Nhưng vòng `mayVe` bỏ qua theo `if (!d || !d.hienThi)`, tức
     * máy CÓ hàng nhưng `hienThi = false` **rơi vào khe giữa hai điều kiện**: nó
     * không được vẽ trên mặt bằng (mayVe bỏ) và cũng không vào khu chờ (vì
     * `has()` trả true) ⇒ **biến mất khỏi cảnh hoàn toàn**, đúng cái mà #53 sinh
     * ra để chấm dứt. Và `hienThi = false` nghĩa CHÍNH LÀ "hiện chưa xếp lên mặt
     * bằng", tức đúng tập mà khu chờ phục vụ.
     *
     * ⇒ Hai điều kiện phải là phủ định của nhau, viết bằng CÙNG một biểu thức.
     */
    /*
     * ★★★ F2 — KHU CHỜ CŨNG PHẢI THEO ĐÚNG TẬP CỦA LƯỢT NẠP.
     *
     * Không có `duoc.has(mv.id)` thì 373 máy của tầng 2/3 (đã có chỗ THẬT ở tầng
     * khác) sẽ bị dựng thành 373 khối trong khu chờ ngoài rìa tầng đang xem —
     * cùng một lời nói dối như banner, chỉ đổi từ chữ sang hình khối, và lần này
     * người dùng THẤY chúng nên còn tin hơn.
     */
    /*
     * ★ T-4 — cả hai phép trên đã dời sang `hopNhatCanh`:
     *   `idMayChuaDat` giữ PHỦ ĐỊNH CHÍNH XÁC của điều kiện vẽ ở CÙNG một tệp
     *   với `dungMayVe`, nên hai điều kiện không thể trôi khỏi nhau nữa —
     *   `hopNhatCanh.unit.test.ts` đo thẳng bất biến "hợp = mọi máy, giao = ∅".
     *   `mepMatBang` giữ luật "rỗng ⇒ neo gốc, KHÔNG Infinity".
     */
    const chuaDat = idMayChuaDat({
      may: mayVanHanh,
      datChoTheoMay,
      idDuocNap: new Set(tapDs.idMay),
    });
    if (chuaDat.length === 0) return [];

    const loaiTheoMay = new Map(mayVanHanh.map((mv) => [mv.id, mv.loaiMay]));
    return xepKhuCho(chuaDat, mepMatBang(mayVe)).map((k) => {
      const loai = loaiTheoMay.get(k.machineId) ?? "";
      const co = kichThuocTheoLoai.get(loai) ?? CO_DU_PHONG;
      return {
        machineId: k.machineId,
        khoi: hinhKhoiCho(loai),
        kichThuocMm: co,
        viTri: k.viTri,
        gocXoayRad: 0,
        // BÁN TRONG SUỐT = pha về nền. `doMo: 1` để KHÔNG bị làm tối thêm.
        mau: phaVeNen(mauCss("--muted-foreground", "#94a3b8"), mauNenCanh, PHA_KHU_CHO),
        doMo: 1,
        hien: true,
      };
    });
  }, [mayVanHanh, datChoTheoMay, mayVe, kichThuocTheoLoai, mauNenCanh, tapDs]);

  /** Máy đã đặt + máy khu chờ — CÙNG một lô vẽ (RB-4: một `BatchedMesh`). */
  const mayVeTatCa = useMemo<MayTrongLo[]>(() => [...mayVe, ...mayKhuCho], [mayVe, mayKhuCho]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ §11 #54 — NHÃN TÊN CHUYỀN TẠI CENTROID                              */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★ Centroid tính từ TÂM MÁY thuộc line (không phải tâm bbox) — xem
   *   `nhanLineTaiCentroid` về vì sao hai thứ đó khác nhau và vì sao chọn cái này.
   *
   * ⚠ Chỉ dựng nhãn cho line CÓ máy đã đặt trên mặt bằng: một nhãn "Chuyền 3"
   *   trôi giữa khoảng trống nói rằng có một chuyền ở đó, và đó là lời khai sai
   *   (NT-3). `nhanLineTaiCentroid` tự bỏ qua line rỗng.
   */
  const nhanLine = useMemo(() => {
    const tamTheoLine = new Map<number, { x: number; y: number; z: number }[]>();
    const viTriMay = new Map(mayVe.map((m) => [m.machineId, m]));
    for (const mv of mayVanHanh) {
      if (mv.lineId == null) continue;
      const m = viTriMay.get(mv.id);
      if (!m) continue;
      const ds = tamTheoLine.get(mv.lineId) ?? [];
      ds.push({ x: m.viTri.x, y: m.viTri.y + mmSangMet(m.kichThuocMm.caoMm), z: m.viTri.z });
      tamTheoLine.set(mv.lineId, ds);
    }
    const tenTheoLine = new Map<number, { ma: string; ten: string }>();
    for (const c of canhQ.data?.chuyen ?? []) tenTheoLine.set(c.id, { ma: c.ma, ten: c.ten });

    return nhanLineTaiCentroid(
      [...tamTheoLine.entries()].map(([lineId, tamVatThe]) => ({
        lineId,
        ma: tenTheoLine.get(lineId)?.ma ?? `L${lineId}`,
        ten: tenTheoLine.get(lineId)?.ten ?? `Line ${lineId}`,
        tamVatThe,
      })),
    );
  }, [mayVanHanh, mayVe, canhQ.data]);

  /* ── Nhãn thế giới ──────────────────────────────────────────────────── */
  const nhan = useMemo<NhanTheGioi[]>(
    /*
     * ★ T-4 — `dungNhanMay` neo nhãn qua `neoTrenNoc`, hàm CHỈ cộng chiều cao
     *   vào trục `y`. Bản cũ ở đây viết phép cộng ấy inline; cộng nhầm vào `z`
     *   sẽ đẩy nhãn ra SAU máy trên mặt bằng, và trên một cảnh nhìn từ trên
     *   xuống nó TRÔNG VẪN HỢP LÝ — không nghiệm thu ảnh nào bắt được.
     */
    () =>
      dungNhanMay({
        mayVe,
        trangThaiTheoMay,
        maTheoMay,
        mauChoTrangThai,
        t,
      }),
    [mayVe, trangThaiTheoMay, maTheoMay, t],
  );

  /**
   * ★★★ #54 — nhãn Line đi CHUNG lớp nhãn với nhãn máy.
   *
   * ⚠ Dùng chung `LopNhan` chứ KHÔNG dựng lớp thứ hai, vì `LopNhan` là nơi luật
   *   declutter (§9.6) sống: 300 nhãn CSS2D đã lag, nên nhãn phải đi qua bộ cull
   *   và trần `TRAN_NHAN_DOM`. Một lớp nhãn riêng cho Line sẽ nằm NGOÀI trần ấy
   *   và phá đúng ngân sách mà §9.6 dựng ra.
   *
   * ★ `machineId` âm (`-lineId`) — khoá không gian máy và không gian line phải
   *   KHÔNG va nhau: `LopNhan` dùng `machineId` để so với `dangChon`/`dangHover`,
   *   và một nhãn Line mang id trùng một máy sẽ sáng lên khi máy đó được chọn.
   */
  const nhanTatCa = useMemo<NhanTheGioi[]>(() => gopNhan(nhan, nhanLine), [nhan, nhanLine]);

  /* ── Cảnh báo ───────────────────────────────────────────────────────── */
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
    /*
     * ★ T-4 — cùng `neoTrenNoc` với nhãn máy, chỉ khác khoảng hở (cảnh báo cao
     *   hơn nhãn để hai thứ không chồng lên nhau; lưới ghim đúng bất đẳng thức
     *   ấy). Mức andon LẠ quy về `call` chứ không im lặng bỏ cảnh báo.
     */
    () =>
      dungCanhBao3D(andonRows, mayVe, maTheoMay).map((c) => ({
        ...c,
        muc: c.muc as MucCanhBao,
      })),
    [andonRows, mayVe, maTheoMay],
  );

  const canhBaoCuaMay = useMemo<CanhBaoDangMo[]>(
    () =>
      andonRows
        .filter((a) => a.machineId === machineIdChon)
        .map((a) => ({
          id: a.id,
          mucDo: a.state,
          trangThai: a.status,
          tieuDe: a.title,
          raisedAt: new Date(a.raisedAt).getTime(),
          machineId: a.machineId,
        })),
    [andonRows, machineIdChon],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ §11 #12/#13/#14/#15 — DẢI CẢNH BÁO HỢP NHẤT (lô B dựng, lô D NỐI)   */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ G16 — LÔ B GIAO `DaiCanhBao.tsx` + 35 TEST LOGIC VỚI **0 CHỖ GỌI**.
   *
   * Điểm nối duy nhất là tệp này, và lô B không được sửa nó (hàng rào chống đụng
   * tay giữa ba lô song song). Nó **tự khai đúng** thay vì nhận là xong: hàm
   * không ai gọi thì chưa giao được gì. Đây là chỗ gọi.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ G25 — MỘT SỰ KIỆN PHÁT VÀO BA PHÒNG: "TRÙNG" KHÔNG PHẢI LỖI CLIENT
   * ════════════════════════════════════════════════════════════════════════
   * `server/_core/socket.ts:1392-1394` phát CÙNG MỘT `andon:event` vào `global`
   * + `line:{id}` + `machine:{id}`. Một client nghe nhiều phòng nhận **2–3 bản**
   * của cùng một raise. Cộng thêm: id seed nhúng `seq` đơn điệu ⇒ **cùng một
   * hàng andon ra id khác nhau mỗi lần refetch**, nên dedupe theo `id` khử được
   * **0**. `gopCanhBao` khoá theo `{nguon}:{idNguon}` — ổn định qua hai lần đọc.
   */

  /** Cảnh báo đến qua socket, giữ trong state để `gopCanhBao` trộn với seed. */
  const [canhBaoSong, setCanhBaoSong] = useState<readonly CanhBaoDai[]>([]);

  useEffect(() => {
    const socket = getSharedSocket();
    const nhan = (goi: unknown) => {
      const tho = goi as Parameters<typeof chuanHoaHang>[0] | null;
      if (!tho || typeof tho.id !== "number") return;
      // ★ `mocDuPhong` = thời điểm NHẬN GÓI, không `Date.now()` bên trong
      //   `chuanHoaHang` (RB-8.1: hàm thuần không tự đọc đồng hồ).
      const c = chuanHoaHang(tho, Date.now());
      // Giữ mảng có trần: `gopCanhBao` cũng cap 100, nhưng cắt ở đây để state
      // không phình vô hạn giữa hai lần render.
      setCanhBaoSong((truoc) => [c, ...truoc].slice(0, 200));
    };
    socket.on("andon:event", nhan);
    return () => {
      socket.off("andon:event", nhan);
    };
  }, []);

  /** Seed từ `andon.active`, chuẩn hoá bằng CÙNG hàm với đường socket. */
  const canhBaoSeed = useMemo<readonly CanhBaoDai[]>(
    () => andonRows.map((a) => chuanHoaHang(a, bayGio)),
    [andonRows, bayGio],
  );

  /** Chip mức đang chọn (#14). */
  const [chonMucCanhBao, setChonMucCanhBao] = useState<ChonMuc>("tat_ca");

  /**
   * ★ Z4 — panel trái đang ở chế độ CÂY hay DANH SÁCH. Hai thứ LOẠI TRỪ nhau
   *   (xem docblock chỗ render): chúng trả lời cùng một câu hỏi, và bày cả hai
   *   trong một cột 224 px làm `DanhSachMay` bị bóp về h=0 cùng hai ô lọc chồng
   *   lên nhau — cả hai đều đo được trên ảnh nghiệm thu đầu tiên.
   *
   * ★ Mặc định `false` = DANH SÁCH: đó là thứ đang dùng được từ trước Đợt 22.
   *   Một tính năng mới không được tự đẩy tính năng cũ ra khỏi màn.
   */
  const [hienCay, setHienCay] = useState(false);

  /**
   * #15 — phạm vi đang chọn dưới dạng bốn tập id.
   *
   * ★ `null` khi cấp `tapDoan`/`nhaMay` hoặc `id` chưa phân giải: đó là "chưa
   *   thu hẹp", KHÁC hẳn "nhánh này rỗng" (xem docblock `locTheoPhamVi`).
   *   Gộp hai ca làm một sẽ giấu sạch cảnh báo mỗi khi chưa chọn nhánh.
   */
  const phamViCanhBao = useMemo<TapPhamVi | null>(() => {
    if (phamVi.id === null || phamVi.cap === "tapDoan" || phamVi.cap === "nhaMay") return null;
    const machineIds = new Set<number>();
    const lineIds = new Set<number>();
    const stationIds = new Set<number>();
    if (phamVi.cap === "may") {
      machineIds.add(phamVi.id);
    } else if (phamVi.cap === "line") {
      lineIds.add(phamVi.id);
      for (const mv of mayVanHanh) {
        if (mv.lineId === phamVi.id) {
          machineIds.add(mv.id);
          if (mv.stationId !== null) stationIds.add(mv.stationId);
        }
      }
    } else {
      // Cấp `tang` — máy thuộc tầng suy từ chỗ đặt, không từ cột nào của máy.
      for (const mv of mayVanHanh) {
        if (datChoTheoMay.get(mv.id)?.tangId === phamVi.id) {
          machineIds.add(mv.id);
          if (mv.lineId !== null) lineIds.add(mv.lineId);
          if (mv.stationId !== null) stationIds.add(mv.stationId);
        }
      }
    }
    return { workshopIds: new Set<number>(), lineIds, stationIds, machineIds };
  }, [phamVi, mayVanHanh, datChoTheoMay]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 22 · Z4 (G-7) — CÂY PHÂN CẤP CÓ ROLL-UP, TRÊN MÀN VẬN HÀNH      */
  /* ═══════════════════════════════════════════════════════════════════════ */
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ §12b.2 NÓI G-7 LÀ "MẶT ĐIỀU HƯỚNG ĐA SITE DUY NHẤT" — VÀ TRƯỚC ĐỢT
   *     NÀY `/twin` **KHÔNG CÓ CÂY NÀO**
   * ════════════════════════════════════════════════════════════════════════
   * Đo được 2026-09-08 (G70 — đếm bằng `<CayPhanCap`, KHÔNG bằng tên chuỗi):
   *   · `<CayPhanCap` render : **1** chỗ — `XuongThietKe.tsx:946` (màn Thiết kế)
   *   · `import { CayPhanCap }` : **1** — `XuongThietKe.tsx:102`
   *   · `TwinVanHanh.tsx` khớp chuỗi "CayPhanCap" **1** lần, và đó là một
   *     CHÚ THÍCH nhắc `traCayPhanCapNhaMay` — G44: ba dạng đếm riêng.
   * Điều hướng của `/twin` trước đợt này là **breadcrumb một nhánh** (`:2143`
   * `dungBreadcrumb`) + ba `<select>` (`BoChonNapUI`). Cả hai đều KHÔNG cho
   * nhìn thấy hai nhánh cùng lúc, nên câu "line nào đang đỏ" phải đi qua từng
   * lượt chọn — đúng thứ một cây gộp trả lời trong một cái liếc.
   *
   * ★★★ CÂY NÀY **CHỈ ĐỌC**. `onChon` KHÔNG sửa gì; nó dịch khoá node thành
   *   thay đổi URL. Đây đúng khuôn lô Z dùng với `LopVung`: tái dùng BỀ MẶT,
   *   không tái dùng ngữ nghĩa GHI. Cụ thể, ba prop mang nghĩa sửa của màn
   *   Thiết kế **không được truyền**: không `onDoiPhamVi` kiểu ghi, và
   *   `soChoXepCho` chỉ là con số hiển thị.
   */

  /**
   * Cây phân cấp dựng từ CHÍNH `canhQ` — **0 truy vấn mới**.
   *
   * ⚠ `dungCayThietKe` đòi `datCho` để tách "đứng trên sàn" khỏi "khu chờ", và
   *   `canhQ.datCho` chỉ có khi `tangIds` đã phân giải. Trước lúc đó cây rỗng
   *   và mọi máy rơi vào khu chờ — ĐÚNG câu ("chưa biết máy nào ở đâu"), nhưng
   *   nó nhấp nháy một khung. Chấp nhận: sai lệch duy nhất là nhánh khu chờ
   *   đầy trong ~1 lượt render, và nó tự đúng ngay sau đó.
   */
  const cayVanHanhData = useMemo(
    () =>
      dungCayThietKe(
        // ★ `traCayPhanCapNhaMay` KHÔNG trả `tangId` (xưởng chưa gắn tầng ở mô
        //   hình hiện tại). Bù `null` TƯỜNG MINH — cùng cách `XuongThietKe.tsx:254`
        //   làm, và `null` ở đây nghĩa "chưa gắn", không phải "tầng 0".
        (canhQ.data?.xuong ?? []).map((x) => ({ ...x, tangId: null })),
        canhQ.data?.chuyen ?? [],
        canhQ.data?.tram ?? [],
        (canhQ.data?.may ?? []).map((m) => ({
          id: m.id,
          ma: m.ma,
          ten: m.ten,
          loaiMay: String(m.loaiMay),
          isActive: m.isActive,
          stationId: m.stationId,
        })),
        canhQ.data?.datCho ?? [],
      ),
    [canhQ.data],
  );

  /** Roll-up SỐ MÁY — component cộng dồn bằng `ropCanhBao` (một phép cộng). */
  const soMayTrucTiepCay = useMemo(() => demMayTrucTiep(cayVanHanhData), [cayVanHanhData]);

  /**
   * Roll-up SỐ CẢNH BÁO — **đại lượng KHÁC**, bản đồ RỜI (chống §13d Z3).
   *
   * ★ Nguồn là `canhBaoSeed` + `canhBaoSong` — CÙNG nguồn mà `DaiCanhBao` đọc,
   *   nên hai bề mặt không thể nói hai con số khác nhau về cùng một nhà máy.
   *
   * ⚠ `stationId` là **NULL ở 7/7 hàng andon đang mở** trên DB dev (đo được,
   *   ghi ở docblock `demTrucTiep`), nên gắn qua `machine:` là đường DUY NHẤT
   *   thật sự trúng. Gắn thêm qua `line:` sẽ **đếm hai lần** khi một cảnh báo
   *   mang cả `machineId` lẫn `lineId` — nên ở đây CHỈ dùng `machineId`.
   */
  const canhBaoTrucTiepCay = useMemo(() => {
    const khoa: KhoaNode[] = [];
    for (const c of [...canhBaoSeed, ...canhBaoSong]) {
      if (c.machineId != null) khoa.push(`machine:${c.machineId}`);
    }
    return demTrucTiep(khoa);
  }, [canhBaoSeed, canhBaoSong]);

  /** Node đang chọn — vế NGƯỢC của đồng bộ hai chiều (click 3D ⇒ cây bung). */
  const tapChonCay = useMemo(
    () => tapChonTuUrl(urlState.chon ?? null, phamVi),
    [urlState.chon, phamVi],
  );

  /**
   * ★★★ CHẠM NODE CÂY = ĐIỀU HƯỚNG. Không một đường ghi nào ở đây.
   *
   * ★ Chạm MÁY đặt CẢ HAI: `chon` (mở panel) **và** `phamVi` về line chứa nó.
   *   Chỉ đặt `chon` thì bấm một máy ở line khác mở panel cho một máy **không
   *   có trên cảnh đang xem** — hai bề mặt nói hai câu khác nhau.
   * ★ `lineCuaMay` trả `null` ⇒ GIỮ NGUYÊN phạm vi (không "về gốc").
   * ★ `giuShift` bị BỎ QUA có chủ đích: chọn-nhiều là ngữ nghĩa của trình SỬA
   *   (kéo cả cụm máy). Màn Vận hành xem một thứ tại một thời điểm.
   */
  const chamNodeCay = useCallback(
    (khoa: KhoaNode | null) => {
      if (khoa === null) {
        ghiUrl({ chon: null });
        return;
      }
      const dh = dieuHuongTuKhoa(khoa);
      if (dh === null) return;
      // ★ Đợt 33 (QĐ-23): MÁY và LINE là hai MÀN RIÊNG — chạm node = rời `/twin`.
      //   Chú thích "đặt CẢ HAI `chon` + `phamVi`" ở trên mô tả hành vi TRƯỚC
      //   Đợt 33; nay màn Máy tự đứng trong Line của nó (`lineCuaMayTheoTram`).
      if (dh.chon?.loai === "machine") {
        chonMay(dh.chon.id);
        return;
      }
      if (dh.chon?.loai === "line") {
        chonLine(dh.chon.id);
        return;
      }
      // Xưởng: `{phamVi:null, chon:null}` ⇒ KHÔNG ghi gì. Node vẫn mở/gập được
      // bằng mũi tên (component tự lo) — nó là node GỘP, không phải đích đến.
      if (dh.phamVi === null && dh.chon === null) return;
      ghiUrl({
        ...(dh.phamVi !== null ? { phamVi: dh.phamVi } : {}),
        ...(dh.chon !== null ? { chon: dh.chon } : {}),
      });
    },
    [ghiUrl, chonMay, chonLine],
  );

  /* ── Phạm vi Line (§10C.3) ──────────────────────────────────────────── */
  /*
   * ★ T-2 (§15.5.2) — phép LẮP hình học Line đã tách sang `canhLine.ts` dạng
   *   HÀM THUẦN, để màn LINE mới (`/twin/line/:id`, QĐ-19) dùng CHUNG đúng một
   *   phép tính thay vì chép bản thứ hai (G12).
   */
  const hinhLine = useMemo(
    () =>
      dungHinhLine(
        phamVi.cap === "line" ? phamVi.id : null,
        tram,
        mayVe,
        mayVanHanh,
        canhQ.data?.datCho ?? [],
      ),
    [phamVi, tram, mayVe, mayVanHanh, canhQ.data],
  );

  /* ══════════════════════════════════════════════════════════════════════ */
  /* ★★★ §11 #61 + #32 — GHÉP SỐ WIP VỚI VỊ TRÍ TRẠM                        */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * Đầu vào DUY NHẤT cho cả hai bề mặt: cột 3D (`cotWip`) và bảng 2D
   * (`xepHangWip`). Một phép ghép, hai người đọc — §11.5 đòi hai bề mặt và G12
   * cấm hai bản cài đặt.
   *
   * ★★★ `soWip = null` KHÔNG PHẢI `0`, VÀ SỰ KHÁC BIỆT LÀ TOÀN BỘ VẤN ĐỀ.
   *   `wipFlowState` chỉ trả những trạm CÓ serial đang chờ (SQL đã `GROUP BY` +
   *   loại `exitedAt`). Một trạm vắng mặt trong kết quả có hai nghĩa hoàn toàn
   *   khác nhau:
   *     • truy vấn ĐÃ trả lời (`isSuccess`) ⇒ trạm thật sự trống ⇒ **0 thật**;
   *     • truy vấn chưa xong / 403 / lỗi   ⇒ ta KHÔNG BIẾT ⇒ **`null`**.
   *   Gộp hai ca này thành `0` là đúng lớp lỗi CHẶN-2 mà `tinhTrang` ở dưới đã
   *   phải vá một lần cho ô đếm cảnh báo: in "0 WIP" cho một người không có
   *   quyền `machine_control` là lời khai *"đã kiểm tra, chuyền trống"*.
   */
  const tinhWip = useMemo<TinhWip[]>(() => {
    if (lineDangXem === null || !hinhLine) return [];
    // `khoa` của `hinhLine.tram` là `station:<id>` — nguồn toạ độ ĐÃ quy về mét.
    const tamTram = new Map<number, { x: number; z: number }>();
    for (const t of hinhLine.tram) {
      const id = Number(t.khoa.slice("station:".length));
      if (Number.isFinite(id)) tamTram.set(id, { x: t.tam.x, z: t.tam.z });
    }
    const daDo = wipQ.isSuccess;
    const soTheoTram = new Map<number, number>();
    for (const s of wipQ.data?.stations ?? []) soTheoTram.set(s.stationId, s.wipCount);
    return tram
      .filter((s) => s.lineId === lineDangXem)
      .map((s) => {
        const v = tamTram.get(s.id);
        return {
          stationId: s.id,
          ma: s.ma,
          ten: s.ten,
          thuTu: s.thuTu,
          // trạm vắng mặt trong kết quả THÀNH CÔNG ⇒ 0 thật; chưa/không trả lời ⇒ null
          soWip: daDo ? (soTheoTram.get(s.id) ?? 0) : null,
          x: v?.x ?? 0,
          z: v?.z ?? 0,
        };
      })
      .sort((a, b) => a.thuTu - b.thuTu || a.ma.localeCompare(b.ma));
  }, [lineDangXem, hinhLine, tram, wipQ.isSuccess, wipQ.data]);

  /**
   * ★★★ #32 — LỜI KHAI NÚT THẮT CỦA SERVER, **KÈM TUỔI CỦA NÓ**.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ `mocKhai` KHÔNG PHẢI TRANG TRÍ — NGHIỆM THU ĐỢT 8 ĐO ĐƯỢC HẬU QUẢ
   * ════════════════════════════════════════════════════════════════════════
   * Bản đầu chỉ lấy `bottleneckStationId` và cho nó thắng vô điều kiện. Mở
   * `/twin?pv=line:1` trên dữ liệu SIM-FAC thật thì màn hình tô đỏ trạm **10
   * (124 WIP)** trong khi trạm **1 đang giữ 3.152 chiếc** — vì bản ghi
   * `line_balance` mới nhất của Line 1 đã **16 ngày 18 giờ tuổi**.
   * Một lời khai hết hạn vẫn là một lời khai; nó không được phép bác một phép
   * đo SỐNG. `conHieuLuc` (8 giờ = một ca) là cửa kiểm đó.
   *
   * ★ Tuổi VÀ giá trị lấy từ CÙNG một hàng `wip.lineBalance` — xem chú thích ở
   *   chỗ khai `canBangQ` về vì sao `stationLoadHeatmap` không dùng được cho
   *   việc này (nó không trả `periodStart`, nên không tự kiểm hạn được).
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

  /** #61 — cột 3D. Đây là thứ thay hằng rỗng viết cứng ở chỗ gọi `CanhVanHanh`. */
  const cotWipCanh = useMemo(() => cotWip(tinhWip, khaiNghen), [tinhWip, khaiNghen]);

  /** §11.5 — bảng 2D SONG SONG, cùng đầu vào, cùng `laNghen`. */
  const bangWip = useMemo(() => xepHangWip(tinhWip, khaiNghen), [tinhWip, khaiNghen]);

  /**
   * #36 — nhịp chuyền THẬT (ms/chiếc) cho mũi tên dòng chảy.
   * `null` ⇒ mũi tên đứng yên, đúng cam kết của `DongChayLine`.
   */
  const nhipChuyenMs = useMemo(
    () => nhipTuCanBang(canBangQ.data?.[0]?.avgCycleTimeMs),
    [canBangQ.data],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 19 LÔ X — §11 #30 what-if + #35 phát lại: NGĂN "MÔ PHỎNG"       */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ ĐÂY LÀ MẶT **SẼ THẾ NÀO NẾU** DUY NHẤT CỦA `/twin` — §12b.2 G-2 gọi nó
   *   là *"mặt mô phỏng duy nhất trong cả 4 trang, đúng nghĩa digital **twin**
   *   chứ không phải digital shadow"*. Mọi truy vấn khác trên màn này trả lời
   *   *"nhà máy ĐANG thế nào"*.
   *
   * ★ `digitalTwin.whatIf` là **hàm thuần, không chạm CSDL**
   *   (`digitalTwinRouter.ts:207-232`) ⇒ Q1 cố ý MIỄN TRỪ nó khỏi hàng rào
   *   tenant, và miễn trừ ấy có lý do đo được: mọi con số nó trả về suy từ
   *   chính `input` ta gửi lên. Hệ quả PHẢI nhớ khi sửa chỗ này: **rủi ro nằm ở
   *   đầu vào TA dựng**, không ở server. Server không có cách nào biết
   *   `cycleTimeSec` ta gửi lên đã 18 ngày tuổi.
   */
  const [horizonHours, datHorizon] = useState(8);
  const [heSoCycle, datHeSoCycle] = useState(1);

  /**
   * ★★★ CỬA KIỂM HẠN ĐỨNG Ở ĐÂY, TRƯỚC KHI GỌI — G30, và là bài học Đợt 8.
   *
   * `dungDauVaoWhatIf` dùng lại `conHieuLuc` (8 giờ) của `wipTram.ts` — CÙNG
   * hằng số, CÙNG hàm với lời khai nút thắt (G12: đừng viết bản thứ hai). Nếu
   * bỏ cửa này, ngăn sẽ in ra một bảng năng suất trông rất thuyết phục dựng
   * trên nhịp chuyền của tháng trước — đúng lớp lỗi mà `khaiNghen` ở trên đã
   * trả giá để học (một lời khai 16 ngày tô đỏ SAI trạm).
   *
   * ⚠ ĐO ĐƯỢC trên CSDL này 2026-09-08: hàng `line_balance` mới nhất của chuyền
   *   1 là **2026-08-21 (18 ngày)** và chính hàng ấy có `avgCycleTimeMs`
   *   **NULL**. Nên trên dữ liệu hiện tại ngăn này ra `ban_ghi_khong_co_nhip` —
   *   hiện `—` kèm lý do, KHÔNG hiện `0`. Đó là kết quả ĐÚNG (G45/G50), không
   *   phải phần chưa làm xong.
   */
  const dungWhatIf = useMemo(
    () =>
      dungDauVaoWhatIf({
        lineId: lineDangXem,
        tram: tram
          .filter((s) => s.lineId === lineDangXem)
          .map((s) => ({ stationId: s.id, ten: s.ten ?? null })),
        // `undefined` = chưa đo (đang tải / bị từ chối / chưa bật); `null` = đã
        // chạy xong nhưng 0 hàng. Hai câu KHÁC NHAU, và ngăn nói ra khác nhau.
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
    [lineDangXem, tram, canBangQ.isSuccess, canBangQ.data, khaiNghen.mocKhai, horizonHours, heSoCycle, bayGioThat],
  );

  /**
   * ★★★ T-1 TẦNG 4 (§15.5.2 / Đợt 28) — BA TRUY VẤN MÔ PHỎNG ĐÃ TÁCH RA.
   *
   * `useMoPhongTwin` giữ `digitalTwin.whatIf` + `orchestration.listWorkflows` +
   * `orchestration.simulate`, cùng hai mẩu state chỉ chúng dùng (`daBamChay`,
   * `workflowRef`) và `useEffect` hạ cờ khi đổi tham số.
   *
   * ★ Tầng 4 đi TRƯỚC vì nó **rời nhất theo phép đo**, không phải theo cảm
   *   giác: 0 truy vấn nào khác đọc kết quả của nó (chúng là **lá** của chuỗi
   *   phụ thuộc), và **không cái nào mang `refetchInterval`** ⇒ tầng này không
   *   chạm được vào bất biến nhịp an toàn (đó là tầng 2).
   *
   * ★ G37: hook KHÔNG tự đọc route và KHÔNG tự gọi `hasPermission` — trang này
   *   đọc quyền rồi TRUYỀN XUỐNG. Một mảnh tự đọc quyền có thể bắn truy vấn mà
   *   người dùng không được phép gọi, và 403 chỉ hiện ra dưới dạng một ngăn
   *   trống trông hệt như "chưa có quy trình nào".
   */
  const coQuyenXemQuyTrinh = hasPermission("machine_monitoring", "canView");
  const { whatIfQ, dsWorkflowQ, phatLaiQ, daBamChay, datDaBamChay, workflowRef, datWorkflowRef } =
    useMoPhongTwin({ dungWhatIf, coQuyenXemQuyTrinh, lineDangXem, horizonHours, heSoCycle });

  /**
   * Ngăn Mô phỏng mở/thu — DÙNG CHUNG khoá `?thu=` (G40), như bảng KPI.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 23 M2 — NGĂN NÀY **MẶC ĐỊNH THU**, và đây là một phép đo
   * ════════════════════════════════════════════════════════════════════════
   * Đo trên `dist`, 1280×720, `?thu=trai,phai` (chế độ "3D toàn màn"):
   *
   *     canvas          968 × 489 = **473.352 px²**
   *     bảng Metrics    208 × 220 =   45.760 px²
   *     ngăn Simulation 257 × 165 =   42.437 px²
   *     ────────────────────────────────────────────
   *     hai lớp phủ che **88.197 px² = 18,6 % canvas**, VĨNH VIỄN
   *
   * ⇒ Đợt 21 mua canvas rộng bằng cách cho panel **nổi đè**; hai lớp phủ này
   *   trả lại **gần một phần năm** cái giá đó. Đó là số, không phải cảm giác.
   *
   * ★★★ VÌ SAO THU **MÔ PHỎNG** MÀ KHÔNG THU **KPI** — hai ngăn không cùng
   *   loại, nên không cùng cách chữa:
   *     · `BangKpiNoi` trả lời *"nhà máy đang thế nào"* — câu hỏi người xem
   *       LUÔN có, và §11 #16 dựng nó chính để màn hình treo tường ở chế độ
   *       `?thu=trai,phai` không còn là "3D đẹp mà 0 con số". Thu nó đi là
   *       phá lại đúng thứ Đợt 11 vừa mua.
   *     · `NganMoPhong` là **công cụ what-if gọi theo nhu cầu**. Ở trạng thái
   *       mặc định nó hiện đúng *"— Select a line to simulate throughput"* và
   *       một ô chọn workflow RỖNG (đọc được trong ảnh
   *       `.qa-dot23/M1-nhan-thu-ca-hai.png`) — tức là nó tiêu **42.437 px²**
   *       để nói rằng nó chưa có gì để nói.
   *
   * ★ G40 — KHÔNG đẻ khoá thứ bảy. Ngữ nghĩa `thu=` GIỮ NGUYÊN ("liệt kê panel
   *   ĐANG THU", vắng = mở), nên `docThu`/`ghiThu` không phải đổi một dòng và
   *   vòng đọc-ghi URL vẫn tất định. Chỗ đổi duy nhất là **mặc định khi khoá
   *   VẮNG**, và nó nằm ở đây — tầng đọc của màn, không ở tầng URL.
   *
   * ⚠ Hệ quả phải nói ra: `?thu=` rỗng nay KHÔNG còn nghĩa "mở tất cả" với
   *   riêng `moPhong`. Người dùng mở ngăn bằng nút của chính nó, và lượt ghi
   *   ấy đi qua `doiThu("moPhong")` như cũ — nút vẫn là nguồn sự thật.
   */
  const thuMoPhong = !urlState.thu.includes("moPhongMo");

  /** Tên trạm theo id — để bảng what-if không chỉ in `#7`. */
  const tenTramTheoId = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of tram) if (s.ten) m.set(s.id, s.ten);
    return m;
  }, [tram]);

  /* ── §11 #52 — XUẤT XỨ: SHADOW / mô phỏng / chỉ sơ đồ ──────────────── */

  /**
   * ★ "Có số liệu thật" = có ÍT NHẤT một máy mang dấu thời gian dữ liệu. Đo bằng
   *   `thoiDiemDuLieu != null` chứ KHÔNG bằng "có máy nào không": một cảnh 42
   *   máy mà không máy nào từng báo cáo là SƠ ĐỒ, không phải SHADOW.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 19 LÔ X — `dangMoPhong` THÔI HARDCODE. ĐÂY LÀ MỤC CUỐI CỦA §11.
   * ════════════════════════════════════════════════════════════════════════
   * Ô này từng là `false` viết cứng, kèm lời hứa *"khi ngăn Mô phỏng nối vào,
   * chỉ cần đổi đúng ô này"*. Đây là lượt đổi ấy.
   *
   * ★ ĐIỀU KIỆN ĐÚNG là **kết quả what-if ĐANG HIỆN TRÊN MÀN HÌNH**, không phải
   *   "ngăn Mô phỏng có mở không". Hai câu khác hẳn nhau, và chọn nhầm thì badge
   *   xuất xứ nói dối theo một trong hai chiều:
   *     • lấy "ngăn đang mở" ⇒ badge kêu "MÔ PHỎNG" khi người dùng chỉ mới mở
   *       ngăn ra xem, trong khi cảnh 3D vẫn đang vẽ dữ liệu THẬT;
   *     • lấy "đã bấm Chạy" mà không xét có kết quả chưa ⇒ badge lật trong
   *       khoảng chờ mạng, rồi lật lại nếu truy vấn hỏng.
   *   Nên điều kiện là: đã bấm Chạy **VÀ** đầu vào dựng được **VÀ** đã có dữ
   *   liệu trả về. Ba vế, và `whatIfQ.data` là vế quyết định.
   *
   * ⚠ `xuatXuHienTai` cho `dangMoPhong` THẮNG mọi thứ (`nguonDuLieu.ts:80-89`),
   *   nên vế này phải chặt: nó có quyền phủ nhận cả một cảnh đầy dữ liệu thật.
   */
  const dangMoPhong = daBamChay && dungWhatIf.chay && whatIfQ.data != null;
  const xuatXu = useMemo(
    () =>
      xuatXuHienTai(
        {
          coSoLieuThat: mayVanHanh.some((m) => m.thoiDiemDuLieu != null),
          dangMoPhong,
        },
        (canhQ.data?.datCho?.length ?? 0) > 0,
      ),
    [mayVanHanh, canhQ.data, dangMoPhong],
  );

  /* ── Khung nhìn theo phạm vi ────────────────────────────────────────── */
  const khungNhin = useMemo<KhungNhin | null>(() => {
    if (phamVi.cap === "line" && hinhLine) {
      return khungNhinLine(hinhLine.hh.bbox, hinhLine.hh.truc, hinhLine.hh.trucDangTin);
    }
    if (phamVi.cap === "may" && phamVi.id !== null) {
      const m = mayVe.find((x) => x.machineId === phamVi.id);
      if (m) {
        return khungNhinCho(
          bboxCuaTap([
            {
              tam: m.viTri,
              co: {
                rong: mmSangMet(m.kichThuocMm.rongMm),
                cao: mmSangMet(m.kichThuocMm.caoMm),
                sau: mmSangMet(m.kichThuocMm.sauMm),
              },
            },
          ]),
          "may",
        );
      }
    }
    return khungNhinCho(
      bboxCuaTap(
        mayVe.map((m) => ({
          tam: m.viTri,
          co: {
            rong: mmSangMet(m.kichThuocMm.rongMm),
            cao: mmSangMet(m.kichThuocMm.caoMm),
            sau: mmSangMet(m.kichThuocMm.sauMm),
          },
        })),
      ),
      phamVi.cap,
    );
  }, [phamVi, hinhLine, mayVe]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* NT-3 — đếm, đối soát, độ tươi                                            */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ CHẶN-2 (Đợt 5) — TRUY VẤN BỊ TỪ CHỐI KHÔNG ĐƯỢC HIỆN THÀNH `0`.
   *
   * Bản trước chỉ truyền `isLoading` vào `hienSo(...)`. Với `maint1` (không có
   * quyền `andon.active`), truy vấn trả 403, mảng rơi về `[]`, `isLoading` đã
   * `false` ⇒ màn in **"Cảnh báo (0)"** — lời khai *"đã kiểm tra, không có cảnh
   * báo nào"* nói với một người không được phép thấy cảnh báo nào cả.
   *
   * `hienSo` VỐN ĐÃ đúng (trả `—` khi cờ bật); khuyết tật nằm ở đúng một chỗ:
   * tầng trang không nối `isError` vào. Nên bản vá là NỐI ĐỦ, không phải viết
   * lại hàm — và gộp một lần ở đây để không call site nào quên.
   */
  const tinhTrang = useMemo(
    () =>
      gopTinhTrang([
        {
          ten: "factory.list",
          dangTai: factoriesQ.isLoading,
          loi: factoriesQ.isError,
          ma: (factoriesQ.error?.data as { code?: string } | undefined)?.code,
        },
        {
          ten: "twinCanh.canhThietKe",
          dangTai: canhQ.isLoading,
          loi: canhQ.isError,
          ma: (canhQ.error?.data as { code?: string } | undefined)?.code,
          // `enabled: factoryId !== null` ⇒ chưa có nhà máy thì truy vấn này
          // KHÔNG chạy, và react-query báo isLoading=false/isError=false.
          chuaChay: factoryId === null,
        },
        {
          ten: "factoryCommand.overview",
          dangTai: overviewQ.isLoading,
          loi: overviewQ.isError,
          ma: (overviewQ.error?.data as { code?: string } | undefined)?.code,
          chuaChay: factoryId === null,
        },
        {
          ten: "andon.active",
          dangTai: andonQ.isLoading,
          loi: andonQ.isError,
          ma: (andonQ.error?.data as { code?: string } | undefined)?.code,
        },
      ]),
    [
      factoriesQ.isLoading, factoriesQ.isError, factoriesQ.error,
      canhQ.isLoading, canhQ.isError, canhQ.error,
      overviewQ.isLoading, overviewQ.isError, overviewQ.error,
      andonQ.isLoading, andonQ.isError, andonQ.error,
      factoryId,
    ],
  );

  /**
   * Cờ cho các ô đếm dựng từ `canhQ` + `overviewQ`. `isError` gộp vào cùng
   * `isLoading`: với ô hiển thị, "đang tải" và "hỏi bị từ chối" nói CÙNG một
   * câu — *con số này chưa có nghĩa* — nên cả hai phải ra `—`.
   */
  const dangTai =
    canhQ.isLoading ||
    overviewQ.isLoading ||
    canhQ.isError ||
    overviewQ.isError ||
    factoriesQ.isLoading ||
    factoriesQ.isError ||
    // ★ Chưa có nhà máy nào ⇒ hai truy vấn nền chưa từng chạy. Ô đếm phải là
    //   `—`, không phải `0`: chưa hỏi thì chưa có câu trả lời nào để in.
    factoryId === null;
  const demTuoi = useMemo(() => demTheoTuoi(mayVanHanh, bayGio), [mayVanHanh, bayGio]);
  const tsNen = useMemo(() => thoiDiemDuLieuMoiNhat(mayVanHanh), [mayVanHanh]);
  const doTuoiNen = nhanDoTuoi(tsNen, bayGio);

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 21 — B-3: HUY HIỆU "TRỰC TIẾP" ĐANG **KHAI SAI ĐẠI LƯỢNG** (họ G7)
   * ════════════════════════════════════════════════════════════════════════
   * Phát hiện của lô Z, và tôi đã **kiểm lại trên mã thật** trước khi nối:
   *
   *   `nguonDuLieu.ts:37`  `NHIP_CO_LUONG_MS = 30_000`
   *   `nguonDuLieu.ts:52`  `nhipHoiMs(coLuong) → coLuong ? 30_000 : 5_000`
   *   ⇒ khi ĐÃ có luồng đẩy, `refetchInterval` **KHÔNG tắt** — nó hạ xuống 30 s
   *     và **ở lại đó** (cố ý: docblock `nhipHoiMs` viết rõ *"tắt hẳn nghĩa là
   *     một luồng chết âm thầm sẽ đóng băng màn hình vĩnh viễn"*).
   *
   * ⇒ Huy hiệu `ketNoi === "truc_tiep"` khai đúng về **ĐƯỜNG KẾT NỐI**, nhưng
   *   người đọc hiểu nó nói về **CON SỐ**. Một phần số trên màn vẫn tới bằng
   *   poll 30 s. Đây đúng họ G7: **đếm ĐẦU VÀO ≠ ĐẦU RA** — ta khai tình trạng
   *   socket rồi để người dùng suy ra tuổi của dữ liệu.
   *
   * ★ `khaiNguonSo()` (lô Z) phân biệt **5 hạng**: `day` · `hon_hop` · `hoi` ·
   *   `lich_su` · `chua_ro`. Hạng `hon_hop` chính là ô mà huy hiệu cũ không có
   *   từ để nói.
   *
   * ⚠ `mocPollCuoi` lấy `overviewQ.dataUpdatedAt` — mốc lượt POLL cuối **thành
   *   công**, do react-query giữ. KHÔNG dùng `Date.now()`: NT-3.4 đã ghi, lấy
   *   đồng hồ lúc render làm mọi thứ trông như vừa cập nhật kể cả khi ta chỉ
   *   nhận lại một snapshot cũ.
   * ⚠ `mocGoiCuoi` chỉ tính khi `kho.nguon === "socket"`. `kho.nhanLuc` được ghi
   *   cho CẢ lượt truy vấn (`nguon: "truy_van"`), nên truyền thẳng nó sẽ làm mọi
   *   lượt poll trông như một gói đẩy — tức là chính lời khai sai ta đang chữa,
   *   chỉ chuyển sang chỗ khác.
   */
  const khaiNguon = useMemo(
    () =>
      khaiNguonSo(
        {
          ketNoi,
          mocGoiCuoi: kho.nguon === "socket" ? kho.nhanLuc : null,
          mocPollCuoi: overviewQ.dataUpdatedAt > 0 ? overviewQ.dataUpdatedAt : null,
          dangXemLai: kho.mocXemLai != null,
        },
        bayGio,
      ),
    [ketNoi, kho.nguon, kho.nhanLuc, kho.mocXemLai, overviewQ.dataUpdatedAt, bayGio],
  );
  /**
   * ★★★ CHỈ CẮT VẾ "THIẾU", KHÔNG CẮT VẾ "THỪA".
   *
   * `doiSoatCanh` đo HAI CHIỀU (xem docblock của nó): máy thiếu chỗ, và chỗ trỏ
   * vào máy đã ngừng (`datChoMoCoi`). F2 chỉ nói về chiều THỨ NHẤT.
   *
   * ⚠ Bản vá đầu của lô F lọc CẢ HAI vế theo `tapDs.idMay` — và đo được ngay
   *   trên trình duyệt thật: banner mất luôn dòng "1 đặt chỗ trỏ vào máy đã
   *   ngừng" của SIM-FAC. `tapDs.idMay` chỉ chứa máy `isActive`, nên mọi hàng
   *   mồ côi (theo định nghĩa trỏ vào máy KHÔNG `isActive`) bị lọc sạch. Vá một
   *   lời khai sai bằng cách làm câm một lời khai ĐÚNG là đổi lỗi lấy lỗi.
   *
   * ⇒ Vế "thừa" nhận NGUYÊN tập máy + NGUYÊN tập đặt chỗ của tầng đang hiện.
   *   Vế "thiếu" nhận tập đã cắt. Hai vế hai phạm vi là CÓ CHỦ Ý, vì chúng trả
   *   lời hai câu hỏi khác nhau.
   */
  const doiSoat = useMemo(() => {
    const duoc = new Set(tapDs.idMay);
    const idTangNay = [...datChoTheoMay.keys()];
    const thieu = doiSoatCanh(
      mayVanHanh.filter((m) => duoc.has(m.id)),
      idTangNay.filter((id) => duoc.has(id)),
    );
    const thua = doiSoatCanh(mayVanHanh, idTangNay);
    return { ...thieu, datChoMoCoi: thua.datChoMoCoi, lech: thieu.lech || thua.datChoMoCoi.length > 0 };
  }, [mayVanHanh, datChoTheoMay, tapDs]);

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* ★★★ ĐỢT 11 LÔ J — §11 #16: KPI TRÊN CẢNH 3D (yêu cầu #6 chủ sở hữu)     */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * ★★★ NGUỒN LÀ `factoryCommand.overview`, VÀ ĐÓ LÀ MỘT LỰA CHỌN CÓ CĂN CỨ.
   *
   * `overview` gate bằng **`machine_status`** (`factoryCommandRouter.ts:32-33`)
   * — CÙNG cổng nav mà `/twin` đã đi qua. Truy vấn HÌNH HỌC (`canhThietKe`) thì
   * đòi `settings_factory`/`machine_control`, và §11e.6 đo được hậu quả: người
   * qua cổng nav rồi bị từ chối ở tầng dữ liệu ⇒ màn trắng. Dựng KPI trên
   * `overview` vì vậy KHÔNG đẻ thêm một "lối vào rồi từ chối" nào.
   *
   * ★ KHÔNG gọi thêm truy vấn nào. `overviewQ` đã có mặt ở `:511` cho badge
   *   trạng thái; gọi lần hai chỉ để lấy KPI là tạo NGUỒN SỰ THẬT THỨ HAI, và
   *   hai lần fetch cách nhau vài giây sẽ cho cảnh 3D và bảng KPI khai khác
   *   nhau về cùng một máy (G12).
   */
  const mayKpi = useMemo<MayTongQuanKpi[]>(() => {
    const tatCa = overviewQ.data?.machines ?? [];
    /*
     * ★★★ KPI PHẢI ĐO ĐÚNG THỨ ĐANG HIỆN TRÊN CẢNH.
     *
     * `phamViCanhBao` là tập id ĐÃ được tính cho dải cảnh báo — dùng lại nó thay
     * vì lọc lần hai ở đây. Hai phép lọc song song là đúng chỗ G12 hay chui vào:
     * chúng chỉ đồng ý tới lần sửa đầu tiên, rồi âm thầm cho bảng KPI và dải
     * cảnh báo nói về hai tập máy khác nhau mà không gì nổ.
     *
     * `null` = cấp `tapDoan`/`nhaMay` ⇒ KHÔNG lọc: ở hai cấp đó cảnh hiện toàn
     * bộ máy `overview` trả về, nên mẫu số của KPI cũng phải là toàn bộ.
     */
    const loc = phamViCanhBao?.machineIds ?? null;
    const ds = loc === null ? tatCa : tatCa.filter((m) => loc.has(m.id));
    return ds.map((m) => ({
      id: m.id,
      status: String(m.status),
      // ★ `?? null` chứ KHÔNG `?? 0` — honest-null đi suốt từ server tới ô hiển
      //   thị. Đo được trên DB này: `oeePercent` null cho MỌI máy.
      oeePercent: typeof m.oeePercent === "number" ? m.oeePercent : null,
      andonActive: Boolean(m.andonActive),
      pdmRiskHigh: Boolean(m.pdmRiskHigh),
    }));
  }, [overviewQ.data, phamViCanhBao]);

  /**
   * ★ Cờ `chuaDo` nhận RIÊNG tình trạng của `overviewQ`, KHÔNG dùng `dangTai`
   *   chung. `dangTai` gộp cả `canhQ` (hình học) — mà một `canhQ` 403 KHÔNG làm
   *   các con số trạng thái của `overview` sai đi. Gộp vào sẽ làm bảng KPI câm
   *   ở đúng ca nó hữu ích nhất: người không có quyền xem bố cục vẫn được phép
   *   biết bao nhiêu máy đang chạy.
   */
  const kpiChuaDo =
    overviewQ.isLoading || overviewQ.isError || factoryId === null;
  const kpiNoi = useMemo(() => tinhKpiNoi(mayKpi, kpiChuaDo), [mayKpi, kpiChuaDo]);

  /** Bảng KPI mở/thu — dùng CHUNG khoá `?thu=` với hai panel bên (G40). */
  const thuKpi = urlState.thu.includes("kpi");

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 24 VIỆC 2 — BẬC "CHỈ NHÃN BẤT THƯỜNG", NAY CÓ NÚT
   * ════════════════════════════════════════════════════════════════════════
   * Đợt 23 dựng `chiNhanBatThuong` trong `locNhan.ts` (+ lưới) và nối nó xuống
   * `LopNhan`/`CanhVanHanh` — nhưng **không ai truyền `true`**. `grep` trước
   * đợt này: 0 chỗ gọi ngoài mặc định `?? false` ⇒ **G16, chưa xong**.
   *
   * ★ VÌ SAO BẬC NÀY ĐÁNG CÓ, ĐO ĐƯỢC (`.qa-dot23/M1-do-nhan.json`):
   *     tổng 45 · vẽ **8** · bị giấu **37** — tức **82 % máy mất tên**, và
   *     trần 30 **chưa hề chạm** (`soVuotTran = 0`). Nghĩa là cắt bớt trần
   *     không sửa được gì: thứ giấu 37 cái tên là phép khử chồng bbox, và nó
   *     chọn theo *máy nào tình cờ thắng phép so hộp*, không theo *máy nào
   *     đáng đọc*. Bậc này đổi **chính sách chọn**, đúng chỗ đau.
   *
   * ★ G40 — dùng lại khoá `thu=`, không đẻ khoá thứ tám; tên đã vào
   *   `PANEL_THU_DUOC` (G67) nếu không nó bị nuốt im lặng.
   */
  const chiNhanBatThuong = urlState.thu.includes("nhanBatThuong");

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* Quyền xử lý (§9.2)                                                       */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const quyen: QuyenXuLy = {
    ackAlarm: hasPermission("andon", "canEdit"),
    anTamAlarm: hasPermission("machine_control", "canCreate"),
    // `machine_monitoring` resolve về `machine_status` ở CẢ hai phía — khai đúng
    // tên router dùng để hai bên không thể lệch.
    taoPhieu: hasPermission("machine_monitoring", "canCreate"),
    suaPhieu: hasPermission("machine_monitoring", "canEdit"),
  };

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* 2D / 3D — toggle VÀ fallback tự động khi WebGL hỏng (§9.9)               */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const [epChe2D, setEpChe2D] = useState(false);
  const [webglHong, setWebglHong] = useState(false);
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      setWebglHong(!gl);
    } catch {
      setWebglHong(true);
    }
  }, []);
  // ★ RB-4: `che2D` quyết định THAY THẾ, không bao giờ dựng cả hai.
  const che2D = epChe2D || webglHong;

  /* `chonMay`/`chonLine` khai ở đầu thân (sau `machineIdChon`) — Đợt 33 (QĐ-23). */

  /* ── ★★★ F4 — THU/MỞ PANEL BÊN, trạng thái ở URL ─────────────────────── */
  /* `doiPhamVi`/`doiThu` đến từ `useTrangThaiTwin` (T-3) — KHÔNG định nghĩa
     lại ở đây, đó sẽ là bản cài đặt thứ hai của cùng một phép ghi (G12). */
  const thuTrai = urlState.thu.includes("trai");
  const thuPhai = urlState.thu.includes("phai");


  /**
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ QĐ-18 (§13c.2) — `/twin` LÀ MÀN **CHỈ ĐỌC**. MỘT DÒNG, KHÔNG BA.
   * ════════════════════════════════════════════════════════════════════════
   * Đợt 21 (QĐ-16) gộp hai màn nên ở đây từng có ba dòng: đọc `?che-do=` từ
   * URL → kẹp theo quyền → khai hạ cấp. Cả ba đã bị gỡ, và điều đó **đúng**:
   *
   *   • Không còn `?che-do=` ⇒ không còn URL nào đòi vùng sửa ⇒ không còn
   *     `kepVungTheoQuyen` để hạ cấp, cũng không còn ai bị hạ cấp để mà khai.
   *   • Vùng sửa nay là **một trang khác**, có `RouteGuard` của chính nó.
   *     Hàng rào chuyển từ "kẹp trong trang" sang "cổng ở cửa" — và cổng ở
   *     cửa là thứ `RouteGuard navHref` đã cưỡng chế sẵn từ nav.
   *
   * ⇒ Còn lại **đúng một** thứ ở màn này: có hiện LIÊN KẾT sang `/twin-studio`
   *   hay không. Chủ sở hữu nói *"2 trang **liên kết** với nhau"*, nên liên
   *   kết phải có; luật ẩn-không-disable nói ai không sửa được thì **không
   *   thấy** nó, chứ không phải thấy rồi bị chặn.
   *
   * ⚠ Đây vẫn KHÔNG phải hàng rào bảo mật, y như trước: ẩn một liên kết không
   *   ngăn ai gõ thẳng `/twin-studio`. Hàng rào thật là `RouteGuard` ở
   *   `App.tsx` (đường VÀO) + `requireAnyPermission` ở `twinCanhRouter.ts:63`
   *   (đường GHI). Đợt này không đụng vào cả hai.
   */
  const duocSuaNhaXuong = coQuyenSuaNhaXuong(hasPermission);

  /** Ghi camera vào URL — `replaceState`, và chỉ khi chuỗi THẬT SỰ đổi. */
  const camCuoi = useRef("");
  const khiCameraDoi = useCallback(
    (viTri: THREE.Vector3, muc: THREE.Vector3) => {
      const s = ghiCamera({ x: viTri.x, y: viTri.y, z: viTri.z, mucX: muc.x, mucZ: muc.z });
      if (s === camCuoi.current) return;
      camCuoi.current = s;
      ghiUrl({ cam: { x: viTri.x, y: viTri.y, z: viTri.z, mucX: muc.x, mucZ: muc.z } });
    },
    [ghiUrl],
  );

  const napLai = useCallback(() => {
    void andonQ.refetch();
    void overviewQ.refetch();
  }, [andonQ, overviewQ]);

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ §11 #1 — XUẤT USD/USDA. VÌ SAO NÚT NẰM Ở ĐÂY, KHÔNG Ở `NganXuLy`
   * ════════════════════════════════════════════════════════════════════════
   * Sổ kiểm §11 ghi đích là `NganXuLy`. **Đích đó SAI, và đo được là sai:**
   * `NganXuLyProps` có phạm vi MỘT MÁY (`machineId: number | null`), trong khi
   * `twin.usdExport` nhận `{ factoryId }` và xuất TOÀN nhà máy. Đặt một nút cấp
   * nhà máy vào ngăn chi tiết của một máy nghĩa là: nút biến mất khi chưa chọn
   * máy nào (lúc người ta muốn xuất cả cảnh nhất), và khi đã chọn thì nó nói dối
   * về phạm vi — người dùng tưởng đang xuất cái máy đang xem.
   *
   * ⇒ Nút thuộc THANH CÔNG CỤ của màn, cạnh `napLai`/`che2D` — những nút khác
   *   cũng có phạm vi TOÀN MÀN. Báo lại thay vì tự sửa spec.
   *
   * ★ QUYỀN — vì sao chỗ này KHÔNG đẻ thêm "một lối vào rồi từ chối":
   *   `twin.usdExport` gate `machine_monitoring`, mà `_core/accessControl.ts:213`
   *   phân giải alias `machine_monitoring → machine_status`. Nút chỉ hiện khi
   *   `hasPermission("machine_status","canView")` — ĐÚNG quyền mà thủ tục cưỡng
   *   chế, lấy từ chính nơi cưỡng chế chứ không đoán.
   *
   *   ⚠ CÒN MỘT KHE HỞ, ghi lại để đợt sau không tưởng là đã kín: cổng vào
   *   `/twin` là `analytics_oee` **HOẶC** `machine_status` (`quyenVanHanh`),
   *   còn `usdExport` chỉ nhận `machine_status`. Một người chỉ có `analytics_oee`
   *   sẽ vào được màn mà không có nút. Đo trên `permissions` thật ngày
   *   2026-09-07: **0 tài khoản** rơi vào khe đó (mọi hàng `analytics_oee` đều
   *   kèm `machine_status`) — nên hôm nay nó là rủi ro tiềm tàng, không phải lỗi
   *   đang xảy ra. Nút ẨN (không hiện-rồi-chặn) là ứng xử đúng cho khe này.
   *
   * ★ G28 — `buildFactoryUsda` DEGRADE-SAFE: nhà máy rỗng trả một stage USDA
   *   **hợp lệ mà 0 prim** (đo được: factory 2 → 115 byte, 0 prim) chứ không ném
   *   lỗi. Nên `xuatUsd` THẨM ĐỊNH nội dung (đếm prim) trước khi cho tải, và
   *   trạng thái dưới đây giữ lại `soPrim`/`soByte` để thanh công cụ nói ra CON
   *   SỐ thay vì một chữ "Xong" không đo gì.
   */
  const [dangXuatUsd, setDangXuatUsd] = useState(false);
  const [ketQuaXuatUsd, setKetQuaXuatUsd] = useState<KetQuaXuatUsd | null>(null);
  const utils = trpc.useUtils();

  const xuatUsdNhaMay = useCallback(async () => {
    if (factoryId === null) {
      setKetQuaXuatUsd({ xong: false, lyDo: "khong-nha-may", ten: "", soPrim: 0, soByte: 0 });
      return;
    }
    setDangXuatUsd(true);
    setKetQuaXuatUsd(null);
    try {
      const res = await utils.twin.usdExport.fetch({
        factoryId,
        includeMaterials: true,
        includePhysics: false,
      });
      const ten = factories.find((f) => f.id === factoryId)?.name ?? `factory-${factoryId}`;
      setKetQuaXuatUsd(xuatUsd(res, document, ten, new Date()));
    } catch {
      // Truy vấn hỏng (mạng / FORBIDDEN) — KHÔNG im lặng. `rong` là lý do đúng:
      // không có chuỗi USDA nào để thẩm định.
      setKetQuaXuatUsd({ xong: false, lyDo: "rong", ten: "", soPrim: 0, soByte: 0 });
    } finally {
      setDangXuatUsd(false);
    }
  }, [factoryId, factories, utils]);

  /*
   * ★ Đợt 24 việc 3 (L-5) từng tính `lyDoNgan` cho ngăn nhúng `?xem=` ở đây.
   *   Đợt 33 (QĐ-23): `?xem=machine:N` redirect sang `/twin/may/N` (vỏ), và
   *   `TwinMay` nói lý do bằng `lyDoMoManMay` — cùng câu `cauChoLyDoNgan`. Ngăn
   *   nhúng không còn đường vào từ `/twin` nên phép tính này rời trang.
   */

  const mayDangChon = mayVanHanh.find((m) => m.id === machineIdChon) ?? null;
  const sanRongM = tangDau ? mmSangMet(tangDau.rongMm) : 40;
  const sanSauM = tangDau ? mmSangMet(tangDau.sauMm) : 30;

  const breadcrumb = dungBreadcrumb(phamVi, (cap, id) => {
    if (cap === "line" && id !== null) {
      return chuyen.find((c) => c.id === id)?.ten ?? `Line ${id}`;
    }
    if (cap === "may" && id !== null) return maTheoMay.get(id) ?? `#${id}`;
    if (cap === "nhaMay") return factories.find((f) => f.id === factoryId)?.name ?? t("common.factory");
    return t(`twin3d.vanHanh.cap.${cap}`, cap);
  });

  /**
   * ⚠ Nhãn phải nói ĐÚNG chế độ đang hiện. Bản đầu cứng chuỗi "Cảnh 3D" và
   *   nghiệm thu bắt được nó vẫn đọc "Cảnh 3D" khi đang ở chế độ 2D — với người
   *   dùng trình đọc màn hình, đó là bề mặt DUY NHẤT mô tả cảnh, nên nói sai
   *   chế độ là nói sai toàn bộ thứ họ đang xem.
   */
  const ariaLabel = t(
    che2D ? "twin3d.vanHanh.canhAria2D" : "twin3d.vanHanh.canhAria",
    { may: mayVe.length, canhBao: andonRows.length, khongRo: demTuoi.khongRo },
  );

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 21 (§13b 14.4) — TÁM DẢI NGANG THÀNH MỘT DANH SÁCH DỮ LIỆU
   * ════════════════════════════════════════════════════════════════════════
   * Trước đợt này, mỗi banner là một khối JSX `shrink-0` riêng xếp chồng DỌC
   * trên canvas; ca xấu nhất đo được **280 px = 39 % của 720** (§13b 14.1.2).
   *
   * ★★★ KHÔNG MỘT LỜI KHAI NÀO BỊ BỎ. Mỗi mục dưới đây là **đúng** banner cũ,
   *   mang **đúng** `data-testid` cũ, bật bởi **đúng** biểu thức điều kiện cũ.
   *   Cái đổi là HÌNH DẠNG: `DaiHopNhat` vẽ chúng thành một dải 26 px, và phần
   *   chi tiết khi mở là lớp phủ `absolute` — canvas KHÔNG co lại (§13b 14.1.1
   *   "đổi từ chia-đất sang chồng-lớp").
   *
   * ⚠ Thứ tự khai báo ở đây KHÔNG quyết định thứ tự hiện — `locVaSap()` sắp
   *   theo nhóm. Nhóm mới là thứ mang ý nghĩa, và nó là dữ liệu chứ không phải
   *   vị trí dòng, nên một lần chèn thêm mục ở giữa không làm E-STOP tụt hạng.
   *
   * ★ G9 — `demViec()` đếm mục ĐANG BẬT, không đếm số dòng khai báo dưới đây.
   */
  const mucViec = useMemo((): MucViec[] => {
    const ds: MucViec[] = [];

    // ── AN TOÀN — §11 #26. LUÔN hiện riêng, đỏ, KHÔNG ẩn được, KHÔNG gộp.
    //    Nguồn `twinCanh.anToanRobot`. Nghiệm thu bằng CA DƯƠNG dựng tay: đặt
    //    một robot sang `status='estop'` ⇒ mục này nổi lên; khôi phục ⇒ tắt.
    ds.push({
      testId: "canh-bao-estop",
      nhom: "anToan",
      hien: anToan.coCanhBao,
      noiDung: t("twin3d.anToan.estopDangNhan", "E-STOP đang được nhấn: {{ds}}", {
        ds: anToan.dangNhan.map((r) => r.ma).join(", "),
      }),
    });

    // ── CHẶN-2 — nêu ĐÍCH DANH truy vấn bị chặn, không nói chung chung.
    ds.push({
      testId: "banner-thieu-quyen-truy-van",
      nhom: "duLieu",
      hien: tinhTrang.biTuChoi.length > 0,
      noiDung: t(
        "twin3d.vanHanh.thieuQuyenTruyVan",
        "Không đủ quyền xem dữ liệu — liên hệ quản trị viên. Truy vấn bị từ chối: {{ds}}",
        { ds: tinhTrang.biTuChoi.join(", ") },
      ),
      dataPhu: { "data-truy-van": tinhTrang.biTuChoi.join(",") },
    });

    // ── NT-3.3 đối soát — thuốc chống model drift.
    //    ★ QD-16: nút này trước đây `setLocation("/twin-studio")`. Nay hai màn
    //      là MỘT trang, nên nó chuyển VÙNG. Và nó chỉ hiện với ai sửa được —
    //      luật ẩn-không-disable: mời `operator1` đi sửa bố cục rồi chặn họ ở
    //      đó là đúng lớp lỗi "một lối vào rồi TỪ CHỐI".
    ds.push({
      testId: "banner-doi-soat",
      nhom: "duLieu",
      hien: !dangTai && doiSoat.lech,
      noiDung: t(
        "twin3d.vanHanh.doiSoatLech",
        "{{thieu}} máy chưa xếp chỗ · {{moCoi}} đặt chỗ trỏ vào máy đã ngừng",
        { thieu: doiSoat.thieuTrenMatBang.length, moCoi: doiSoat.datChoMoCoi.length },
      ),
      hanhDong: duocSuaNhaXuong
        ? { khoa: "moXuongDung", nhan: t("twin3d.vanHanh.moXuongDung", "Mở Xưởng dựng") }
        : undefined,
      dataPhu: { "data-ngoai-luot-nap": tapDs.soNgoaiLuotNap },
    });

    // ── F2 — 373 máy ở tầng/toà khác. KHAI ĐÚNG CÂU, không khai "chưa xếp chỗ".
    ds.push({
      testId: "banner-ngoai-luot-nap",
      nhom: "phamVi",
      hien: !dangTai && tapDs.soNgoaiLuotNap > 0,
      noiDung: moiToaDaHoi
        ? t(
            "twin3d.vanHanh.mayTangKhac",
            "{{so}} máy nữa đã có chỗ ở tầng khác của toà này — đổi ô Tầng để xem",
            { so: tapDs.soNgoaiLuotNap },
          )
        : t(
            "twin3d.vanHanh.mayToaKhac",
            "{{so}} máy không nằm trong lượt nạp này (toà khác chưa được hỏi) — chưa kết luận được chúng đã xếp chỗ hay chưa",
            { so: tapDs.soNgoaiLuotNap },
          ),
      dataPhu: {
        "data-so": tapDs.soNgoaiLuotNap,
        "data-moi-toa-da-hoi": moiToaDaHoi ? "1" : "0",
      },
    });

    // ── F3 — phạm vi bị hạ cấp, nói thẳng vì sao.
    ds.push({
      testId: "banner-ha-cap",
      nhom: "phamVi",
      hien: phamViKq.daHaCap,
      noiDung: t(
        "twin3d.vanHanh.haCapPhamVi",
        "Đang hiện dữ liệu của MỘT nhà máy ({{soNhaMay}} nhà máy trong hệ). Phạm vi Tập đoàn chưa nạp được nhiều nhà máy cùng lúc — dùng ô Nhà máy để chuyển.",
        { soNhaMay: factories.length },
      ),
      dataPhu: { "data-cap-yeu-cau": phamViKq.capYeuCau, "data-cap-thuc": phamVi.cap },
    });

    // ── Link cũ trỏ vào thứ không còn.
    ds.push({
      testId: "banner-link-bi-bo-qua",
      nhom: "phamVi",
      hien: !dangTai && linkBiBoQua,
      noiDung: t(
        "twin3d.vanHanh.linkBiBoQua",
        "Đường link mở màn này trỏ tới nhà máy/toà/tầng không còn tồn tại — đang hiện lựa chọn gần nhất.",
      ),
    });

    /*
     * ── ★★★ QĐ-18 GỠ BANNER "VÙNG SỬA BỊ HẠ CẤP" — và vì sao gỡ là ĐÚNG.
     *
     * Đợt 21 có một mục `banner-vung-sua-ha-cap` ở đây, vì `?che-do=botri` đưa
     * `operator1` tới trang này VỚI Ý ĐỊNH SỬA rồi bị hạ về xem — im lặng hạ
     * cấp là để họ tưởng công cụ hỏng, nên phải nói ra.
     *
     * QĐ-18 làm cái cớ ấy **biến mất**: không còn `?che-do=`, không còn ai tới
     * `/twin` với ý định sửa, nên không còn ai bị hạ cấp. Giữ lại một banner
     * `hien: false` vĩnh viễn là để lại một lời khai không bao giờ đúng.
     *
     * ⚠ Người thiếu quyền gõ thẳng `/twin-studio` KHÔNG rơi vào im lặng: họ gặp
     *   `RouteGuard` — màn từ chối có chữ, ở đúng nơi họ đòi vào.
     */

    // ── §11 #1 — kết quả xuất USD. G28: khoe SỐ PRIM, không khoe chữ "Xong".
    ds.push({
      testId: "bang-ket-qua-xuat-usd",
      nhom: "duLieu",
      hien: ketQuaXuatUsd !== null,
      noiDung:
        ketQuaXuatUsd === null
          ? ""
          : ketQuaXuatUsd.xong
            ? t("twin3d.vanHanh.xuatUsdXong", "Đã xuất {{ten}} — {{prim}} vật thể, {{byte}} byte", {
                ten: ketQuaXuatUsd.ten,
                prim: ketQuaXuatUsd.soPrim,
                byte: ketQuaXuatUsd.soByte,
              })
            : ketQuaXuatUsd.lyDo === "canh-trong"
              ? t(
                  "twin3d.vanHanh.xuatUsdCanhTrong",
                  "Chưa xuất: nhà máy này chưa có vật thể nào trên mặt bằng (tệp sẽ rỗng).",
                )
              : ketQuaXuatUsd.lyDo === "khong-nha-may"
                ? t("twin3d.vanHanh.xuatUsdChuaChonNhaMay", "Chưa chọn nhà máy để xuất.")
                : t("twin3d.vanHanh.xuatUsdHong", "Xuất USD thất bại ({{lyDo}}).", {
                    lyDo: ketQuaXuatUsd.lyDo ?? "?",
                  }),
      dataPhu:
        ketQuaXuatUsd === null
          ? undefined
          : {
              "data-xong": ketQuaXuatUsd.xong ? "1" : "0",
              "data-so-prim": ketQuaXuatUsd.soPrim,
              "data-so-byte": ketQuaXuatUsd.soByte,
              "data-ly-do": ketQuaXuatUsd.lyDo ?? "",
            },
    });

    return ds;
  }, [
    t,
    anToan,
    tinhTrang.biTuChoi,
    dangTai,
    doiSoat,
    tapDs.soNgoaiLuotNap,
    moiToaDaHoi,
    phamViKq,
    phamVi.cap,
    factories.length,
    linkBiBoQua,
    ketQuaXuatUsd,
    duocSuaNhaXuong,
  ]);

  /**
   * Tra khoá hành động của `DaiHopNhat` → hàm thật. Khoá lạ ⇒ nút không hiện.
   *
   * ★ QĐ-18: `moXuongDung` trước đây đổi VÙNG trong cùng trang (`doiVung("sua")`).
   *   Nay nó **đi sang trang khác**. Khoá và nhãn giữ nguyên — người dùng vẫn
   *   thấy đúng chữ "Mở Xưởng dựng"; chỉ đích đổi. Và nó vẫn chỉ hiện khi
   *   `duocSuaNhaXuong` (chỗ dựng `banner-doi-soat`), nên không ai bị mời đi
   *   tới một cửa sẽ đóng sập vào mặt họ.
   */
  const hanhDongDai = useMemo(
    () => ({ moXuongDung: () => setLocation("/twin-studio") }),
    [setLocation],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* Render                                                                   */
  /* ═══════════════════════════════════════════════════════════════════════ */

  // ★ Không có quyền đọc bố cục — nói THẲNG, không hiện cảnh trống.
  if (thieuQuyenBoCuc) {
    return (
      <div className="p-6" data-testid="man-twin-van-hanh">
        <EmptyState
          title={t("twin3d.vanHanh.thieuQuyenBoCuc", "Chưa có quyền đọc bố cục nhà xưởng")}
          description={t(
            "twin3d.vanHanh.thieuQuyenBoCucMoTa",
            "Bạn xem được màn Vận hành, nhưng dữ liệu mặt bằng 3D cần quyền cấu hình nhà máy hoặc điều khiển thiết bị. Liên hệ quản trị để được cấp.",
          )}
        />
      </div>
    );
  }

  if (phamViRong) {
    return (
      <div className="p-6" data-testid="man-twin-van-hanh">
        <EmptyState scopeEmptyReason="no_factory_assignment" />
      </div>
    );
  }

  return (
    <div
      /*
       * ★★★ ĐỢT 6 VÁ THƯỜNG-3 — CHIỀU CAO ĐO TỪ VỊ TRÍ THẬT, KHÔNG TRỪ HẰNG SỐ ĐOÁN.
       *
       * ⚠ ĐO ĐƯỢC trên trình duyệt thật (Playwright, 2026-09-07), CẢ HAI kích thước:
       *     1366×768  → innerHeight=768  scrollHeight=845  TRÀN 77px
       *     1280×1249 → innerHeight=1249 scrollHeight=1326 TRÀN 77px
       *   `man-twin-van-hanh` bắt đầu ở **top=133**, nhưng CSS chỉ trừ `5rem` = **80px**.
       *   77 = 133 − 80 + 24 (đệm dưới). Tức đây KHÔNG phải lỗi flex/cuộn — nó là một
       *   PHÉP TRỪ SAI: hằng số `5rem` là lời ĐOÁN về chiều cao chrome, và chrome thật
       *   cao 133px. Cùng một con số tràn 77px ở HAI viewport rất khác nhau chính là
       *   dấu hiệu: sai lệch KHÔNG phụ thuộc chiều cao màn hình ⇒ nó là hằng số, không
       *   phải hiệu ứng cuộn.
       *
       * ⇒ Đừng thay 5rem bằng một hằng số đoán khác (8.5rem…): lần sau chrome đổi là
       *   sai lại, và không có lỗi nào nổ. Lấy ĐÚNG vị trí thật của chính khung này
       *   (`getBoundingClientRect().top`) rồi trừ khỏi `100vh` — tự đúng với mọi chrome.
       *
       * ★ `--twin-top` do `useEffect` bên dưới đặt; giá trị đầu `5rem` chỉ là mồi cho
       *   lượt render đầu tiên (trước khi đo được), và nó KHÔNG bao giờ là số cuối.
       */
      ref={khungRef}
      className="flex min-h-0 flex-col overflow-hidden"
      style={{ height: "calc(100vh - var(--twin-top, 5rem))" }}
      data-testid="man-twin-van-hanh"
    >
      {/* ── Breadcrumb + độ tươi + chế độ ──────────────────────────────── */}
      {/*
        ★★★ F4 — HEADER MỘT DÒNG. `flex-wrap` bị bỏ CÓ CHỦ Ý.
        Đo được: với `flex-wrap`, ba ô chọn mới của F1 đẩy header từ 48 lên
        85 px ở 1280×720, và 37 px ấy trừ thẳng vào canvas. Thay vì cho nó xuống
        dòng, cho breadcrumb TRUNG BỚT (`min-w-0 truncate`) — breadcrumb là thứ
        duy nhất ở đây có độ dài không đoán trước được (tên nhà máy do người
        dùng đặt), nên nó phải là thứ nhường chỗ.
      */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <nav
          className="flex min-w-0 items-center gap-1 overflow-hidden text-xs"
          aria-label="breadcrumb"
          data-testid="breadcrumb-twin"
        >
          {breadcrumb.map((m, i) => (
            <span key={`${m.cap}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <span className="text-muted-foreground">›</span> : null}
              <button
                type="button"
                className="max-w-[9rem] truncate rounded px-1 hover:bg-accent focus-visible:outline focus-visible:outline-2"
                data-testid={`breadcrumb-${m.cap}`}
                onClick={() => chonPhamVi({ cap: m.cap, id: m.id })}
              >
                {m.nhan}
              </button>
            </span>
          ))}
        </nav>

        {/*
          ── ★★★ F1 — BA Ô CHỌN Nhà máy / Toà / Tầng ───────────────────────
          Chỗ gọi duy nhất của `BoChonNapUI`. Trước bản này màn `/twin` có
          **0 `<select>`** — màn duy nhất trong hệ thiếu picker (đối chứng
          `FactoryFloorEditor.tsx`: 9). Mọi lượt đổi đi qua `ghiUrl` ⇒ vào URL,
          chia sẻ và tải lại được, và nút Back quay về tầng vừa xem.
        */}
        <BoChonNapUI
          nhaMay={mucNhaMay}
          toaNha={mucToaNha}
          tang={mucTang}
          nhaMayId={factoryId}
          toaNhaId={toaNhaId}
          tangId={tangId}
          dangTai={factoriesQ.isLoading || toaNhaQ.isLoading || chiTietQ.isLoading}
          onDoiNhaMay={(id) => ghiUrl({ nap: { nm: id } })}
          onDoiToaNha={(id) => ghiUrl({ nap: { toa: id } })}
          onDoiTang={(id) => ghiUrl({ nap: { tang: id } })}
        />

        <div className="flex shrink-0 items-center gap-2">
          {/*
            ★★★ G15 — TRẠNG THÁI ĐƯỜNG SỐ LIỆU, NĂM ô chứ không phải một boolean.

            `chua_ket_noi` (chưa từng nhận gì) PHẢI phân biệt được với "đã kết nối
            và giá trị bằng 0". Bản cũ (`useTwinStream.isStreaming`) không diễn đạt
            nổi điều đó: cờ một chiều false→true, nên "chưa kết nối", "đã nối chưa
            có gói" và "stream vừa chết" đều cho cùng một `false`.
          */}
          <span
            className={
              "rounded px-1.5 py-0.5 text-[10px] font-medium " +
              (ketNoi === "truc_tiep"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : ketNoi === "xem_lai"
                  ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                  : ketNoi === "im_lang"
                    ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-muted text-muted-foreground")
            }
            data-testid="trang-thai-ket-noi"
            data-ket-noi={ketNoi}
            title={t(`twin3d.ketNoi.${ketNoi}.moTa`, {
              defaultValue: {
                chua_ket_noi: "Chưa kết nối luồng trực tiếp — các số dưới đây là ảnh chụp lúc tải trang.",
                dang_cho: "Đã kết nối, đang chờ gói dữ liệu đầu tiên.",
                truc_tiep: "Đang nhận dữ liệu trực tiếp.",
                im_lang: "Đã kết nối nhưng không nhận được gói nào gần đây — dữ liệu đang cũ dần.",
                xem_lai: "Đang xem lại lịch sử, không phải dữ liệu trực tiếp.",
              }[ketNoi],
            })}
          >
            {t(`twin3d.ketNoi.${ketNoi}.nhan`, {
              defaultValue: {
                chua_ket_noi: "Chưa kết nối",
                dang_cho: "Đang chờ…",
                truc_tiep: "Trực tiếp",
                im_lang: "Im lặng",
                xem_lai: "Xem lại",
              }[ketNoi],
            })}
          </span>

          {/*
            ════════════════════════════════════════════════════════════════
            ★★★ ĐỢT 21 B-3 — CƠ CHẾ GIAO SỐ, ĐẶT NGAY CẠNH "Trực tiếp"
            ════════════════════════════════════════════════════════════════
            Huy hiệu bên trái khai **ĐƯỜNG KẾT NỐI**; huy hiệu này khai **CON SỐ
            TỚI BẰNG ĐƯỜNG NÀO**. Hai đại lượng khác nhau, và trước Đợt 21 chỉ
            có cái đầu — nên người đọc suy ra cái sau, sai (họ G7: đếm ĐẦU VÀO
            rồi kết luận về ĐẦU RA). Lý lẽ và số đo ở docblock `khaiNguon`.

            ★ `hon_hop` là ô mà huy hiệu cũ **không có từ để nói**: socket sống,
              mà một phần số vẫn tới bằng poll 30 s (`nhipHoiMs` cố ý không tắt
              poll — nó là lưới an toàn cho luồng chết âm thầm).

            ★ GIỮ NGUYÊN `data-testid="trang-thai-ket-noi"` ở huy hiệu trên —
              bánh cóc e2e sẵn có tra chuỗi đó. Huy hiệu này mang testid RIÊNG,
              không giành chỗ của nó (đổi bố cục không được đổi hợp đồng đo).

            ★ ISA-101: chỉ hạng **`hoi`** (số CHỈ tới bằng poll) được màu cảnh
              báo. `day`/`hon_hop` dùng xám trung tính — bình thường thì im.
          */}
          <span
            className={
              "rounded px-1.5 py-0.5 text-[10px] font-medium " +
              (khaiNguon.chiTuHoi
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                : "bg-muted text-muted-foreground")
            }
            data-testid="co-che-giao-so"
            data-co-che={khaiNguon.coChe}
            data-chi-tu-hoi={khaiNguon.chiTuHoi ? "1" : "0"}
            data-nhip-ms={khaiNguon.nhipHieuLucMs ?? ""}
            data-tuoi-ms={khaiNguon.tuoiMs ?? ""}
            title={t(`twin3d.coCheGiao.${khaiNguon.coChe}.moTa`, {
              defaultValue: {
                day: "Mọi con số tới bằng luồng đẩy thời gian thực.",
                hon_hop:
                  "Luồng đẩy đang sống, nhưng một phần số vẫn tới bằng lượt hỏi định kỳ 30 giây.",
                hoi: "Không có luồng đẩy — mọi con số tới bằng lượt hỏi định kỳ.",
                lich_su: "Đang xem lịch sử — các số không tự làm mới.",
                chua_ro: "Chưa xác định được cơ chế giao số.",
              }[khaiNguon.coChe],
            })}
          >
            {t(`twin3d.coCheGiao.${khaiNguon.coChe}.nhan`, {
              defaultValue: {
                day: "đẩy",
                hon_hop: "đẩy + hỏi 30s",
                hoi: "hỏi định kỳ",
                lich_su: "lịch sử",
                chua_ro: "—",
              }[khaiNguon.coChe],
            })}
          </span>
          {/*
            ★★★ NT-3.2 — "cập nhật lần cuối" là max(timestamp) của DỮ LIỆU NỀN.
            Đỏ khi > 60 giây. `—` khi chưa từng có dữ liệu (KHÔNG hiện "vừa xong").
          */}
          {/*
            ★★★ §11 #52/#62 — BADGE XUẤT XỨ. SHADOW và TWIN trông giống hệt nhau
            trên màn hình nhưng trả lời hai câu khác hẳn ("đang thế nào" vs "sẽ
            thế nào nếu"). Không khai xuất xứ = để người vận hành đọc một con số
            mô phỏng như số đo thật (NT-4).
          */}
          <span
            className={
              "rounded px-1.5 py-0.5 text-[10px] font-medium " +
              (laGiaDinh(xuatXu)
                ? "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-300"
                : xuatXu === "bong"
                  ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  : "bg-muted text-muted-foreground")
            }
            data-testid="badge-xuat-xu"
            data-xuat-xu={xuatXu}
            title={t(`twin3d.xuatXu.${xuatXu}.moTa`, {
              defaultValue: {
                bong: "SHADOW — màu phản ánh telemetry/heartbeat THỰC của thiết bị.",
                mo_phong: "MÔ PHỎNG — các số này là giả định what-if, KHÔNG phải số đo.",
                so_do: "SƠ ĐỒ — chỉ có bố cục, chưa có số liệu vận hành nào.",
                khong_ro: "Chưa xác định được xuất xứ của dữ liệu đang hiện.",
              }[xuatXu],
            })}
          >
            {t(`twin3d.xuatXu.${xuatXu}.nhan`, {
              defaultValue: {
                bong: "SHADOW", mo_phong: "MÔ PHỎNG", so_do: "SƠ ĐỒ", khong_ro: "—",
              }[xuatXu],
            })}
          </span>
          {/*
            ════════════════════════════════════════════════════════════════
            ★★★ ĐỢT 23 M4 — "Updated 1572061s ago" LÀ **GIÂY SỐNG**, VÀ NÓ CŨ
                             18 NGÀY MÀ HIỆN RA NHƯ BÌNH THƯỜNG
            ════════════════════════════════════════════════════════════════
            Ảnh tự chụp `.qa-dot23/M1-nhan-thu-ca-hai.png` in đúng chuỗi ấy.
            HAI lỗi trong một dòng, và chúng cần hai bản vá khác nhau:

              1. **ĐỊNH DẠNG** — 1.572.061 giây không ai đọc được. Dùng
                 `doTuoiNen.rut` (`{so, donVi}` do `nhanTuoi` rút — G12/G72)
                 từ 60 giây trở lên; **dưới 60 giây vẫn in GIÂY** vì đó là
                 nhịp làm mới của màn và giây là đơn vị đúng ở đó.
              2. **HẠN HIỆU LỰC (G30)** — `do` chỉ nói "hơi cũ", không phân
                 biệt 61 giây với 18 ngày. `NganXuLy.tsx:300` đã có badge
                 `duLieuQuaCu` cho ca này; thanh công cụ thì không, nên cùng
                 một sự thật có hai câu trả lời trên cùng một màn. Nay thanh
                 công cụ nói **cùng câu ấy** khi `quaCu`.

            ★ `data-giay` GIỮ NGUYÊN số thô — nghiệm thu đọc số, không đọc chữ.
              Thêm `data-qua-cu` để đo được cờ mới mà không phải suy từ chuỗi.
          */}
          <span
            className={`text-[11px] ${doTuoiNen.do ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="do-tuoi-nen"
            data-giay={doTuoiNen.giay ?? ""}
            data-qua-cu={doTuoiNen.quaCu ? "1" : "0"}
            title={
              doTuoiNen.quaCu && doTuoiNen.giay !== null
                ? t("twin3d.vanHanh.duLieuQuaCu", "Dữ liệu quá cũ — trạng thái không đáng tin")
                : undefined
            }
          >
            {doTuoiNen.giay === null
              ? `${t("twin3d.tuoi.capNhatLanCuoi")}: —`
              : t("twin3d.vanHanh.capNhatTruoc", "Cập nhật {{tuoi}} trước", {
                  tuoi: nhanTuoiDocDuoc(doTuoiNen, t),
                })}
          </span>
          {/* ★ Badge "quá cũ" — CÙNG chuỗi `duLieuQuaCu` mà `NganXuLy` dùng, để
              hai chỗ không thể lệch câu. Chỉ hiện khi thật sự quá hạn. */}
          {doTuoiNen.quaCu && doTuoiNen.giay !== null ? (
            <span
              className="rounded border border-amber-500/40 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              data-testid="badge-qua-cu-nen"
            >
              {t("twin3d.vanHanh.duLieuQuaCu", "Dữ liệu quá cũ — trạng thái không đáng tin")}
            </span>
          ) : null}
          <Button size="sm" variant="ghost" onClick={napLai} data-testid="nut-nap-lai">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {/*
            ── §11 #1 — XUẤT USD/USDA ────────────────────────────────────────
            Nút ẨN khi thiếu `machine_status` (quyền mà `twin.usdExport` thật sự
            cưỡng chế qua alias `machine_monitoring`) — ẩn chứ không hiện-rồi-chặn.
            `data-so-prim` là thứ e2e/nghiệm thu đọc: nó là SỐ ĐO nội dung, khác
            hẳn một cờ "đã bấm được nút".
          */}
          {hasPermission("machine_status", "canView") ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="nut-xuat-usd"
              data-so-prim={ketQuaXuatUsd?.soPrim ?? ""}
              data-so-byte={ketQuaXuatUsd?.soByte ?? ""}
              data-ly-do={ketQuaXuatUsd?.lyDo ?? ""}
              disabled={dangXuatUsd || factoryId === null}
              onClick={() => void xuatUsdNhaMay()}
              title={t(
                "twin3d.vanHanh.xuatUsdMoTa",
                "Xuất toàn bộ cảnh nhà máy ra tệp USD (.usda) để mở trong Omniverse / Isaac Sim",
              )}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {dangXuatUsd
                ? t("twin3d.vanHanh.xuatUsdDang", "Đang xuất…")
                : t("twin3d.vanHanh.xuatUsd", "Xuất USD")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            data-testid="nut-che-2d"
            aria-pressed={che2D}
            disabled={webglHong}
            onClick={() => setEpChe2D((v) => !v)}
          >
            {che2D ? <LayoutGrid className="mr-1 h-3.5 w-3.5" /> : <Boxes className="mr-1 h-3.5 w-3.5" />}
            {che2D ? "2D" : "3D"}
          </Button>

          {/*
            ── ★★★ ĐỢT 21 (§13b HÌNH E) — NÚT 3D GẦN TOÀN MÀN ────────────────
            Đường `?thu=trai,phai` **đã có** từ F4; nó chỉ **không tìm thấy
            được** — người dùng phải tự sửa URL, hoặc bấm lần lượt hai tay nắm
            ở mép canvas. Một tính năng chỉ dùng được bởi người đã biết nó tồn
            tại là một tính năng chưa giao.

            ★ `aria-pressed` chứ không phải hai nút: đây là một công tắc, và
              trình đọc màn hình cần biết trạng thái chứ không chỉ nhãn.
          */}
          <Button
            size="sm"
            variant="outline"
            data-testid="nut-toan-man"
            aria-pressed={thuTrai && thuPhai}
            title={t("twin3d.vanHanh.toanManMoTa", "3D gần toàn màn (thu cả hai bảng bên)")}
            onClick={() => ghiUrl({ thu: thuTrai && thuPhai ? [] : ["trai", "phai"] })}
          >
            {thuTrai && thuPhai ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>

          {/*
            ── ★★★ ĐỢT 24 VIỆC 2 — CÔNG TẮC "CHỈ NHÃN BẤT THƯỜNG" ────────────

            Đây là dòng biến `chiNhanBatThuong` từ **một hàm không ai gọi**
            (Đợt 23, G16) thành một bậc người vận hành bấm được. Cùng khuôn
            `nut-toan-man` ngay trên: MỘT nút `aria-pressed`, không phải hai
            nút, vì trình đọc màn hình cần TRẠNG THÁI chứ không chỉ nhãn.

            ★ Vì sao đặt cạnh 2D/3D và toàn-màn: cả ba là "cách NHÌN cảnh",
              không phải "xem cái gì". Bỏ nó vào panel trái sẽ chôn một bậc
              mật độ nhãn dưới hai cú cuộn — đúng lỗi "có mà không tìm thấy
              được" mà nút toàn-màn ở trên sinh ra để sửa.
          */}
          <Button
            size="sm"
            variant="outline"
            data-testid="nut-chi-nhan-bat-thuong"
            aria-pressed={chiNhanBatThuong}
            title={t(
              "twin3d.vanHanh.chiNhanBatThuongMoTa",
              "Chỉ hiện tên máy đang bất thường (và máy đang chọn)",
            )}
            onClick={() => doiThu("nhanBatThuong")}
          >
            {chiNhanBatThuong ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Tags className="h-3.5 w-3.5" />
            )}
          </Button>

          {/*
            ── ★★★ QĐ-18 (§13c.2) — **LIÊN KẾT** SANG `/twin-studio` ─────────

            Chủ sở hữu: *"2 trang **liên kết** với nhau nhưng mục đích hoàn
            toàn khác nhau."* Đây là cái liên kết ấy, và nó là một **điều
            hướng**, không còn là một công tắc bật/tắt vùng.

            ★★★ VÌ SAO KHÔNG CÒN `aria-pressed` / "Thoát sửa":
            Trước QĐ-18 nút này là toggle hai trạng thái, vì vùng sửa nằm
            TRONG trang. Nay nó rời đi nơi khác, nên "đang bật" không còn
            nghĩa gì trên màn này — giữ `aria-pressed` sẽ khai với trình đọc
            màn hình một trạng thái không tồn tại. Đường về là nút Back của
            trình duyệt và mục nav, đúng như mọi cặp trang khác trong app.

            ★★★ ẨN, KHÔNG DISABLE (§12b.3) — `duocSuaNhaXuong` false ⇒ **không
            render**. Không xám, không tooltip "bạn thiếu quyền". Mời
            `operator1` bấm vào một liên kết mà `RouteGuard` sẽ chặn ở đầu kia
            đúng là lớp lỗi "một lối vào rồi TỪ CHỐI" của Khối D.

            ⚠ Hàng rào GIAO DIỆN, không phải bảo mật. Ẩn liên kết không ngăn ai
              gõ thẳng `/twin-studio`; hàng rào thật là `RouteGuard navHref`
              (App.tsx, đường VÀO) + `requireAnyPermission` ở
              `twinCanhRouter.ts:63` (đường GHI). Đợt này không đụng cả hai.

            ⚠ Với `operator1` nhánh này cho `null`. Đo trên `permissions`
              (2026-09-09): họ có `machine_status` nhưng KHÔNG có
              `settings_factory` lẫn `machine_control` ⇒ họ **không mất gì**
              khi tách, vì vùng sửa với họ vốn đã không tồn tại.
          */}
          {duocSuaNhaXuong ? (
            <Button asChild size="sm" variant="outline">
              {/*
                ⚠ `asChild` HỢP NHẤT props vào PHẦN TỬ CON — nên mọi
                  `data-testid` phải nằm trên `<Link>`, KHÔNG trên `<Button>`.
                  Đo được: đặt `nut-sua-bo-cuc` trên `<Button>` cho **0 phần
                  tử** trong DOM, trong khi `lien-ket-twin-studio` (trên
                  `<Link>`) cho 1 — một lỗi CÂM, không lưới unit nào bắt vì
                  cả hai tệp vẫn biên dịch và trang vẫn trông đúng.

                ★ ĐỔI TÊN khoá `nut-sua-bo-cuc` → `lien-ket-twin-studio`, và
                  các suite cũ được sửa theo (Đợt 21/22). Giữ tên cũ sẽ là nói
                  dối về hình dạng: đây không còn là một NÚT bật/tắt vùng, nó
                  là một LIÊN KẾT sang trang khác. Một khoá đo nói sai bản chất
                  là thứ đợt sau sẽ đọc nhầm.
              */}
              <Link
                href="/twin-studio"
                data-testid="lien-ket-twin-studio"
                title={t(
                  "twin3d.vanHanh.moTwinStudioMoTa",
                  "Sang trang Xưởng dựng: thiết kế nhà xưởng, kéo thả máy, lưu bố cục",
                )}
              >
                <PencilRuler className="mr-1 h-3.5 w-3.5" />
                {t("twin3d.vanHanh.moTwinStudio", "Xưởng dựng")}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {/*
        ════════════════════════════════════════════════════════════════════
        ★★★ ĐỢT 21 LÔ Y (§13b 14.4) — TÁM DẢI NGANG → MỘT DẢI 26 px
        ════════════════════════════════════════════════════════════════════
        Ở CHỖ NÀY trước Đợt 21 có **bảy khối JSX `shrink-0`** xếp chồng dọc
        (kết quả xuất USD · thiếu quyền truy vấn · đối soát · ngoài lượt nạp ·
        hạ cấp phạm vi · link bị bỏ qua · E-STOP), cộng header 48 px và
        `DongThoiGian` 37 px là **tám dải**. Ca xấu nhất đo được **280 px =
        39 % của 720** (§13b 14.1.2) — và đó là gốc rễ THẬT của "3D bé", nặng
        hơn chuyện bề ngang panel mà brief Đợt 20 nhắm vào.

        ★★★ KHÔNG BANNER NÀO BỊ BỎ. Mỗi lời khai là thứ các đợt trước đổ công
          vá vào (NT-3, honest-null, F2/F3, CHẶN-2); bỏ chúng là đổi một lời
          khai ĐÚNG lấy một chỗ IM LẶNG. Nội dung, điều kiện bật và
          `data-testid` chuyển NGUYÊN VẸN sang `mucViec` ở trên; `DaiHopNhat`
          chỉ đổi HÌNH DẠNG.

        ★ Dải AN TOÀN vẫn hiện RIÊNG, đỏ, luôn mở, không ẩn được — `tachAnToan()`
          cưỡng chế ở tầng dữ liệu (`daiHopNhatLogic.ts` LUẬT CỨNG 1), nên một lượt
          render không thể "quên" tách.
      */}
      <DaiHopNhat muc={mucViec} hanhDong={hanhDongDai} />

      {/* ── Thân: canvas TOÀN KHUNG, panel NỔI ĐÈ ────────────────────────
        ════════════════════════════════════════════════════════════════════
        ★★★ ĐỢT 21 LÔ Y (§13b 14.1.1) — TỪ **CHIA ĐẤT** SANG **CHỒNG LỚP**
        ════════════════════════════════════════════════════════════════════
        Trước Đợt 21 đây là `flex` ba cột: panel trái, canvas, panel phải —
        và ba cột **chia nhau bề ngang**. Hệ quả đo được: mỗi thông tin thêm
        vào panel làm cảnh 3D **teo lại**. Với `w-56`+`w-64` = 480 px trên
        khung 968 px, canvas còn **488 px** (đo Playwright 1280×720:
        488×453 = **24,0 %** viewport).

        Nay canvas chiếm **toàn khung** (`absolute inset-0`), và hai panel
        **nổi ĐÈ** lên nó. Thêm một thông tin vào panel không lấy đi một
        pixel nào của cảnh — đúng khuôn mà mẫu FanRuan dùng, và đúng khuôn
        `BangKpiNoi` đã dùng trong chính tệp này từ Đợt 11 (lớp phủ DOM,
        **0 draw call**).

        ⚠ `relative` ở đây là bắt buộc: nó là gốc toạ độ cho mọi `absolute`
          bên trong. Bỏ nó thì panel neo vào `<body>` và trôi lên đè navbar —
          một lỗi không nổ, chỉ nhìn thấy bằng ảnh.
      */}
      {/*
        ════════════════════════════════════════════════════════════════════
        ★★★ QĐ-18 (§13c.2) — VÙNG SỬA ĐÃ RỜI KHỎI TRANG NÀY
        ════════════════════════════════════════════════════════════════════
        Ở ĐÚNG CHỖ NÀY, Đợt 21 (QĐ-16) có một nhánh ba ngôi chọn giữa vùng sửa
        nhà xưởng (nạp lười) và cảnh vận hành — hai bên loại trừ nhau.

        QĐ-18 gỡ nó: `/twin` là màn **TRÌNH DIỄN / XEM / REALTIME, không chỉnh
        sửa được**. Vùng sửa nay là trang riêng `/twin-studio`, tới bằng liên
        kết ở header (chỉ hiện với ai có quyền).

        ★★★ RB-4 **KHÔNG BỊ MẤT, MÀ CHẶT HƠN** — đọc trước khi lo:
        Cái `? :` bị gỡ ở đây từng là thứ giữ luật "một `<Canvas>` WebGL sống
        tại một thời điểm". Nay hai `<Canvas>` nằm ở **hai tuyến**, nên wouter
        unmount trang cũ trước khi mount trang mới. Hàng rào chuyển từ một
        toán tử (ai cũng đổi thành `hidden` được, và Đợt 21 đã phải ghi hẳn
        một cảnh báo về đúng nguy cơ ấy) sang **kiến trúc định tuyến**.

        ★ Cái giá của Đợt 21 cũng biến mất theo: khi ấy rời vùng sửa rồi quay
          lại thì camera xưởng dựng về mặc định, vì cây React bị unmount. Nay
          đó là hai trang, nên việc mất camera là hành vi **đúng và mong đợi**
          của một lần điều hướng, không còn là cái giá phải giải thích.
      */}
      <div className="relative min-h-0 flex-1">
        {/* PANEL TRÁI — DOM thật, tab được, MỌI hành động làm được từ đây (§9.9) */}
        <div
          /*
           * ════════════════════════════════════════════════════════════════
           * ★★★ F4 — PANEL THU ĐƯỢC, VÀ BỀ NGANG THEO VIEWPORT
           * ════════════════════════════════════════════════════════════════
           * Đo được (Playwright 1280×720, 2026-09-07): khung twin rộng 968 px;
           * `w-72`(288) + `w-80`(320) = **608 px = 63 %** ⇒ canvas 360 px, tức
           * 3D chiếm 360×416/1280×720 = **16,9 %** viewport.
           *
           * Hai phép sửa, cả hai đều đo được, không phép nào là "làm cho đẹp":
           *   1. `w-56 2xl:w-72` — dưới 1536 px panel trái co về 224 px. Nội
           *      dung của nó (ô đếm 2 cột, dải cảnh báo, danh sách máy) vốn đã
           *      cuộn dọc; 64 px kia không mua thêm dòng nào mà lấy đi 64 px
           *      của thứ duy nhất KHÔNG cuộn được là cảnh 3D.
           *   2. `?thu=trai` — thu hẳn về 0. Đây là đường tới "3D toàn màn".
           *
           * ⚠ KHÔNG unmount panel khi thu: §9.9 đòi mọi hành động làm được từ
           *   DOM thật, và `DanhSachMay`/`DaiCanhBao` giữ trạng thái lọc/chọn.
           *   Ẩn bằng `hidden` + `w-0` giữ cây React nguyên vẹn, mở lại tức thì
           *   và không mất một cú gõ nào của người dùng.
           */
          /*
           * ════════════════════════════════════════════════════════════════
           * ★★★ ĐỢT 21 — PANEL **NỔI ĐÈ**, KHÔNG CÒN CHIA ĐẤT (§13b 14.1.1)
           * ════════════════════════════════════════════════════════════════
           * `absolute left-0 top-0 bottom-0` thay cho một cột flex: panel
           * không còn ĐẨY canvas nữa, nó **nằm trên** canvas. Đo được sau
           * đổi: canvas 968×519 = **53,3 %** viewport (nền 488×453 = 24,0 %).
           *
           * ★ `z-20` — dưới dải hợp nhất (`z-30`) nhưng TRÊN canvas. Nhãn drei
           *   ở z-index 20 (`LopNhan.tsx` `zIndexRange={[20,0]}`), nên panel
           *   phải ≥20 hoặc nhãn 3D sẽ xuyên qua chữ (G41). ★ `bg-background`
           *   ĐỤC, không `/90`: chữ đọc trên nền cảnh 3D đang xoay là thứ
           *   không ai đọc được, và đó chính là bẫy G41 ở dạng thứ hai.
           *
           * ★ `pointer-events-auto` trên panel, còn khung cha KHÔNG chặn
           *   chuột: bỏ sót điều này thì kéo xoay camera ở vùng dưới panel sẽ
           *   chết mà không lỗi nào nổ.
           *
           * ⚠ KHÔNG unmount panel khi thu (giữ nguyên từ F4): §9.9 đòi mọi
           *   hành động làm được từ DOM thật, và `DanhSachMay`/`DaiCanhBao`
           *   giữ trạng thái lọc/chọn. `hidden` + `w-0` giữ cây React nguyên
           *   vẹn, mở lại tức thì.
           */
          className={
            "pointer-events-auto absolute bottom-0 left-0 top-0 z-20 flex min-h-0 flex-col overflow-hidden border-r bg-background transition-[width] duration-200 " +
            (thuTrai ? "w-0 border-r-0" : "w-56 2xl:w-72")
          }
          data-testid="panel-trai"
          data-thu={thuTrai ? "1" : "0"}
          aria-hidden={thuTrai}
          hidden={thuTrai}
        >
          {/* Tổng quan + tươi dữ liệu */}
          <div className="shrink-0 border-b p-2 text-xs" data-testid="khoi-tong-quan">
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground">{t("twin3d.vanHanh.soMay", "Máy")}</span>
              <span className="text-right font-medium" data-testid="dem-may">
                {hienSo(mayVanHanh.length, dangTai)}
              </span>
              <span className="text-muted-foreground">{t("twin3d.tuoi.tuoi")}</span>
              <span className="text-right font-medium" data-testid="dem-tuoi">
                {hienSo(demTuoi.tuoi, dangTai)}
              </span>
              <span className="text-muted-foreground">{t("twin3d.tuoi.cu")}</span>
              <span className="text-right font-medium" data-testid="dem-cu">
                {hienSo(demTuoi.cu, dangTai)}
              </span>
              <span className="text-muted-foreground">{t("twin3d.trangThai.khongRo")}</span>
              <span className="text-right font-medium text-amber-700 dark:text-amber-400" data-testid="dem-khong-ro">
                {hienSo(demTuoi.khongRo, dangTai)}
              </span>
              <span className="text-muted-foreground">{t("twin3d.trangThai.ngungKhaiThac")}</span>
              <span className="text-right font-medium" data-testid="dem-ngung">
                {hienSo(demTuoi.ngungKhaiThac, dangTai)}
              </span>
            </div>
          </div>

          {/* ★★★ §11 #12/#13/#14/#15 — DẢI CẢNH BÁO (lô B dựng, nối ở đây)
              Thay khối `<ul>` phẳng trước đó: khối cũ KHÔNG dedupe (G25: một
              `andon:event` phát vào 3 phòng ⇒ 2-3 dòng cho một sự cố), KHÔNG
              tách nhóm >24h (#13), KHÔNG có chip lọc mức (#14), và hiện "0
              cảnh báo" khi truy vấn 403 thay vì `—` (G15). */}
          {/*
            ════════════════════════════════════════════════════════════════
            ★★★ ĐỢT 22 — LỖI **CÓ SẴN**: DẢI CẢNH BÁO NUỐT CẢ PANEL TRÁI
            ════════════════════════════════════════════════════════════════
            Đo được 2026-09-08 trên `dist` (1920×1080, `e2e_tai_loE`), panel
            trái cao 849 px:
              · `khoi-tong-quan`  h=105  (`flex-grow: 0`)
              · `dai-canh-bao`    h=715  (`flex-grow: 0`)  ← 84 % panel
              · `danh-sach-may`   h=  0  (`flex-grow: 1`)  ← **BIẾN MẤT**

            ★★★ ABLATION (chống G5 — "cái gì gây ra?" chứ không "cái gì có mặt"):
              gỡ khối cây khỏi DOM  ⇒ `danh-sach-may` VẪN **0**  (cây vô can)
              gỡ thêm `dai-canh-bao` ⇒ `danh-sach-may` = **744**  ← nguyên nhân

            ⇒ Đây là lỗi **CÓ TRƯỚC Đợt 22**, không phải hồi quy của Z4. Gốc rễ:
              `DaiCanhBao` gốc khai `h-full min-h-0 flex-col` nhưng ở đây nó là
              một flex item **không có `flex-1` cũng không có trần**, nên nó lấy
              chiều cao theo NỘI DUNG (27 cảnh báo × ~26 px), và anh em `flex-1`
              của nó chỉ còn phần dư — bằng 0.

            ⇒ Bọc bằng `min-h-0 flex-1` và cho `danh-sach-may` cùng hạng: hai
              khối cùng co được thì phần dư chia theo nội dung thay vì một bên
              lấy hết. `basis-0` là điều BẮT BUỘC — không có nó, flexbox chia
              phần dư SAU khi đã cấp chiều cao nội dung, và 715 px kia vẫn được
              cấp trước.
          */}
          <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">
          <DaiCanhBao
            seed={canhBaoSeed}
            song={canhBaoSong}
            phamVi={phamViCanhBao}
            chonMuc={chonMucCanhBao}
            onChonMuc={setChonMucCanhBao}
            bayGio={bayGio}
            dangTai={andonQ.isLoading}
            khongDoDuoc={andonQ.isError}
            onChonCanhBao={(c) => c.machineId != null && chonMay(c.machineId)}
          />
          </div>

          {/*
            ════════════════════════════════════════════════════════════════
            ★★★ ĐỢT 22 · Z4 (G-7) — CÂY PHÂN CẤP CÓ ROLL-UP
            ════════════════════════════════════════════════════════════════
            §12b.2 xếp G-7 là "mặt điều hướng đa site duy nhất", và trước đợt
            này `/twin` **không có cây nào** (đo được, G70 — xem docblock
            `cayVanHanhData` ở trên).

            ════════════════════════════════════════════════════════════════
            ★★★ CÂY và DANH SÁCH MÁY **LOẠI TRỪ NHAU** — và bản đầu của Z4
                KHÔNG thế, nghiệm thu thị giác bắt được ba hậu quả
            ════════════════════════════════════════════════════════════════
            Bản đầu dùng `<details open:flex-1>` đứng CẠNH `DanhSachMay`
            (cũng `flex-1`), với lý lẽ "hai khối chia nhau phần co được". Ảnh
            `Z4-cay-mo-1080.png` bác bỏ cả ba vế của lý lẽ ấy:

              1. `DanhSachMay` KHÔNG co lại — nó bị bóp về **h = 0**
                 (`hien: false`, đo được). Không phải "nhường chỗ", mà là
                 **biến mất**, và không lỗi nào nổ.
              2. **HAI ô "Filter by name or code…" chồng lên nhau** ở y≈777 và
                 y≈808 — một của `DanhSachMay`, một của `CayPhanCap`. Hai ô
                 tìm kiếm cho cùng một câu hỏi, đè lên cả nhãn "HIERARCHY".
              3. Cây tràn khỏi khung: hộp y=784 h=393 ⇒ đáy **1177 > 1080**,
                 hàng line cuối nằm sau thanh thời gian.

            ★★★ GỐC RỄ KHÔNG PHẢI CSS — nó là **IA**: cây và danh sách máy trả
              lời **CÙNG MỘT CÂU HỎI** ("chọn máy/line nào"), chỉ khác hình
              dạng (phân cấp vs phẳng). §13b 14.1.3 đã đặt tên cho đúng bệnh
              này: *"bảy tab là bảy câu trả lời cho cùng một câu hỏi"*. Bày cả
              hai cùng lúc trong một cột 224 px là tái phạm ở quy mô nhỏ.

            ⇒ Chúng **LOẠI TRỪ NHAU** bằng một công tắc thật (`? :`, không phải
              ẩn bằng CSS): đúng một khối `flex-1` tồn tại tại một thời điểm,
              nên `DanhSachMay` không thể bị bóp về 0 và không thể có hai ô lọc.
              Mặc định là DANH SÁCH (thứ đang dùng được từ trước); cây là chế
              độ người dùng CHỌN vào.

            ★ Công tắc là hai nút `aria-pressed` chứ không phải `<details>`:
              `<details>` diễn đạt "mở thêm ra", còn cái ta cần là "đổi cách
              nhìn" — và một `<details>` không thể tắt khối anh em của nó.
          */}
          <div
            className="flex shrink-0 items-center gap-1 border-t px-2 py-1"
            role="group"
            aria-label={t("twin3d.cay.tieuDe", "Cây phân cấp")}
            data-testid="khoi-cay-phan-cap"
          >
            <button
              type="button"
              aria-pressed={!hienCay}
              onClick={() => setHienCay(false)}
              data-testid="chon-danh-sach-may"
              className={cn(
                "flex-1 rounded px-2 py-0.5 text-[11px] font-medium",
                !hienCay ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {t("twin3d.vanHanh.soMay", "Máy")}
            </button>
            <button
              type="button"
              aria-pressed={hienCay}
              onClick={() => setHienCay(true)}
              data-testid="mo-cay-phan-cap"
              className={cn(
                "flex-1 rounded px-2 py-0.5 text-[11px] font-medium",
                hienCay ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {t("twin3d.cay.tieuDe", "Cây phân cấp")}
            </button>
          </div>

          {hienCay ? (
            /* ★ `basis-0` — cùng lý lẽ với khối dải cảnh báo ở trên: không có
                nó thì khối này được cấp chiều cao NỘI DUNG trước, rồi mới chia
                phần dư, và anh em lại về 0. */
            <div className="min-h-0 flex-1 basis-0 overflow-hidden">
              {/*
                ★★★ CHỈ ĐỌC — ba điều làm nên điều ấy, và cả ba đều nhìn thấy
                  ở đây chứ không giấu trong một hàm:
                  1. `onChon` gọi `chamNodeCay` = **ghi URL**, không ghi DB.
                  2. `onDoiPhamVi` **KHÔNG truyền** — nó là đường #15 của màn
                     Thiết kế; phạm vi ở đây đã do URL cầm.
                  3. `soChoXepCho={0}` — màn Vận hành không có khái niệm "chờ
                     xếp chỗ" để mà hành động; số 0 làm nhánh ấy hiện "—".
              */}
              <CayPhanCap
                cay={cayVanHanhData}
                chon={tapChonCay}
                onChon={(khoa) => chamNodeCay(khoa)}
                soChoXepCho={0}
                soMayTrucTiep={soMayTrucTiepCay}
                soCanhBaoTrucTiep={canhBaoTrucTiepCay}
              />
            </div>
          ) : (
            /* ★ DANH SÁCH MÁY — DOM thật, mọi hành động làm được từ đây (§9.9) */
            <DanhSachMay
              may={mayVanHanh}
              trangThaiTheoMay={trangThaiTheoMay}
              machineIdChon={machineIdChon}
              onChonMay={chonMay}
              bayGio={bayGio}
              dangTai={dangTai}
            />
          )}
        </div>

        {/*
          ── CANVAS — ★ RB-4: 2D THAY THẾ 3D, không bao giờ cả hai ──────────

          ★★★ ĐỢT 21 — `absolute inset-0` thay cho `flex-1`.
          Đây là dòng mua toàn bộ con số của lô Y: canvas chiếm **trọn khung**
          và hai panel nổi ĐÈ lên nó, thay vì ba cột chia nhau bề ngang. Đo
          được trên 1280×720: **488×453 (24,0 %) → 968×519 (53,3 %)**.

          ⚠ `z` KHÔNG khai ở đây (mặc định `auto`, dưới `z-20` của panel). Cho
            nó một `z` dương sẽ đưa cảnh 3D lên TRÊN panel — panel vẫn "hiện"
            trong DOM, vẫn qua mọi lưới `toBeVisible()`, mà người dùng không
            đọc được chữ nào. Đúng lớp G41, và chỉ ẢNH bắt được.
        */}
        <div className="absolute inset-0 min-h-0 min-w-0">
          {che2D ? (
            <CanhVanHanh2D
              may={mayVeTatCa}
              trangThaiTheoMay={trangThaiTheoMay}
              maTheoMay={maTheoMay}
              machineIdChon={machineIdChon}
              onChonMay={chonMay}
              sanRongM={sanRongM}
              sanSauM={sanSauM}
              nhanTrangThai={(tt) => t(mauChoTrangThai(tt).khoaNhan)}
              ariaLabel={ariaLabel}
            />
          ) : (
            <CanhVanHanh
              may={mayVeTatCa}
              nhan={nhanTatCa}
              canhBao={canhBao3D}
              dongChay={
                hinhLine && hinhLine.hh.coHinhHoc
                  ? { diem: hinhLine.hh.diemDuongTam, nhipMs: nhipChuyenMs }
                  : null
              }
              wip={cotWipCanh}
              /* ★★★ ĐỢT 21 — hai chỗ gọi biến hạ tầng của lô Z thành tính năng
                 (trước hai dòng này, `grep` ra 0 chỗ gọi ⇒ G16). Lý lẽ đầy đủ ở
                 docblock của `vienSucKhoeCanh` và `vungCanh` phía trên. */
              vienSucKhoe={vienSucKhoeCanh}
              vung={vungCanh}
              machineIdChon={machineIdChon}
              onChonMay={chonMay}
              khungNhin={khungNhin}
              sanRongM={sanRongM}
              sanSauM={sanSauM}
              tatNhan={false}
              /*
                ★★★ ĐỢT 23 M1 — KHAI BÁO SỰ THIẾU thay vì giấu im lặng.
                Đo được (`.qa-dot23/M1-do-nhan.json`): 45 ứng viên → **8 nhãn**,
                37 bị khử vì chồng bbox, `capConChong = 0`. Bộ lọc chạy đúng
                hợp đồng, nhưng 82 % máy không có tên và màn KHÔNG nói ra.
                `t()` gọi Ở ĐÂY rồi truyền chuỗi xuống — cảnh nằm trong cây
                Canvas và không được gọi `t()` (RB-8.3).
              */
              chuNhanAn={(n) =>
                t("twin3d.vanHanh.nhanBiAn", "còn {{n}} tên bị ẩn", { n })
              }
              /* ★ ĐỢT 24 VIỆC 2 — chỗ gọi THẬT của `chiNhanBatThuong`. Trước
                 dòng này `grep` ra 0 người truyền `true` (G16). */
              chiNhanBatThuong={chiNhanBatThuong}
              chuMatContext={t("twin3d.loi.matContext")}
              ariaLabel={ariaLabel}
              onCameraDoi={khiCameraDoi}
            />
          )}
          {/*
            ════════════════════════════════════════════════════════════════
            ★★★ ĐỢT 21 LÔ Y — KHUNG NEO CHO HAI LỚP PHỦ, THỤT VÀO SAU PANEL
            ════════════════════════════════════════════════════════════════
            ⚠ Khối này SINH RA TỪ MỘT LỖI ĐO ĐƯỢC CỦA CHÍNH ĐỢT 21, ghi lại
              nguyên văn vì nó là hệ quả trực tiếp của việc đổi bố cục:

              `BangKpiNoi` neo `absolute left-2 top-2` và `NganMoPhong` neo
              `absolute right-2 top-2` — **vào khung canvas**. Trước Đợt 21
              khung canvas bắt đầu SAU panel trái (x=512), nên hai lớp phủ rơi
              gọn vào phần cảnh trống. Sau khi canvas thành `inset-0` (x=288),
              hai lớp phủ **trượt theo** và nằm ĐÈ LÊN panel: ảnh
              `.qa-loY/Y-macdinh.png` cho thấy bảng "Metrics" phủ kín phần trên
              của panel trái. Không lỗi nào nổ, không lưới nào đỏ — **chỉ ẢNH
              bắt được**, đúng lớp G41 mà lô J đã trả giá một lần.

            ⇒ Chữa bằng một khung neo TRUNG GIAN thụt vào đúng bề rộng panel
              đang mở. Hai lớp phủ giữ nguyên `left-2`/`right-2` của chúng, chỉ
              đổi thứ mà `absolute` đo vào.

            ⚠ VÌ SAO KHÔNG SỬA THẲNG `BangKpiNoi`/`NganMoPhong`: hai tệp ấy nằm
              dưới `van-hanh/**`, do lô Z giữ trong đợt này. Sửa chéo phạm vi là
              cách chắc chắn nhất để hai lô ghi đè nhau. Khung neo ở đây đạt
              cùng kết quả mà không chạm một byte nào của họ.

            ★ `pointer-events-none` + `inset-0`: khung này KHÔNG được nuốt chuột
              của canvas (kéo xoay camera). Hai lớp phủ con tự bật lại
              `pointer-events` cho phần tương tác của chúng — đó là khuôn chúng
              đã dùng sẵn.

            ★ `z-30` KHÔNG khai lại ở đây: hai con đã tự mang `z-30` (trên nhãn
              drei z-index 20 — G41). Thêm một tầng `z` nữa chỉ tạo một ngữ cảnh
              xếp chồng mới và làm `z-30` của con mất nghĩa so với panel `z-20`.
          */}
          <div
            className={
              "pointer-events-none absolute inset-y-0 " +
              (thuTrai ? "left-0 " : "left-56 2xl:left-72 ") +
              (thuPhai ? "right-0" : "right-64 2xl:right-80")
            }
            data-testid="khung-neo-lop-phu"
          >
          {/*
            ── ★★★ ĐỢT 11 LÔ J — §11 #16: BẢNG KPI NỔI TRÊN CẢNH (yêu cầu #6) ──

            ĐẶT Ở ĐÂY, TRONG khung canvas, chứ không trong panel trái — và đó là
            toàn bộ điểm của yêu cầu #6. Mọi con số của màn này trước bản J sống
            trong `khoi-tong-quan` của panel trái; `?thu=trai,phai` (đường tới
            "3D toàn màn", đo được: canvas 488→968 px) làm mất sạch chúng. Một
            màn hình treo tường chạy đúng chế độ đó sẽ hiện một nhà máy 3D đẹp
            mà KHÔNG một con số nào.

            ★ Lớp phủ DOM, KHÔNG phải chữ trong cảnh: đo 2026-09-07 cảnh này là
              **3 draw calls**; 8 nhãn troika sẽ thành 11 (§4 trần 150 — còn
              rộng, nhưng chữ trong cảnh xoay/bị che/nhỏ dần theo camera, tức là
              không đọc được đúng lúc cần đọc). Xem docblock `kpiNoiLogic.ts`.
          */}
          <BangKpiNoi
            kpi={kpiNoi}
            dangTai={kpiChuaDo}
            mo={!thuKpi}
            onDoiMo={() => doiThu("kpi")}
            /* ★ Nói RÕ đang đo phạm vi nào — một bảng KPI không khai phạm vi thì
               người xem mặc định hiểu là toàn nhà máy, trong khi cảnh chỉ nạp
               một tầng (đúng lớp lỗi `?pv=tapdoan` của §11e.6 F3). */
            nhanPhamVi={breadcrumb.map((m) => m.nhan).join(" · ")}
          />

          {/*
            ── ★★★ ĐỢT 19 LÔ X — §11 #30 + #35: NGĂN "MÔ PHỎNG" ──────────────

            ĐẶT Ở ĐÂY, cạnh `BangKpiNoi`, vì cùng một lý do: đây là lớp phủ DOM
            **anh em** của `<Canvas>`, không nằm trong cây three (0 draw call,
            §4). Nó ở góc PHẢI trên để không đè bảng KPI ở góc TRÁI trên.

            ★ `z-30` — nhãn drei ở z-index 20 (`LopNhan.tsx:180`
              `zIndexRange={[20,0]}`). Ngăn ở `z-10` sẽ HIỆN RA ĐỦ MÀ ĐỌC KHÔNG
              ĐƯỢC (G41). Lô J đã trả giá cho đúng lỗi này, và chỉ ẢNH bắt được.

            ★ G63 KHÔNG áp dụng: ngăn này ngoài `<Canvas>`, thanh phát lại chạy
              bằng `setInterval` của DOM chứ không phải `useFrame`, nên
              `frameloop="demand"` không làm nó đứng im.
          */}
          <NganMoPhong
            mo={!thuMoPhong}
            /* ★ ĐỢT 23 M2 — bật/tắt tên chiều-NGƯỢC `moPhongMo` (ngăn mặc
                 định THU). Dùng nhầm `"moPhong"` ở đây thì nút bấm không đổi
                 được gì: `thuMoPhong` đọc `moPhongMo`. */
            onDoiMo={() => doiThu("moPhongMo")}
            dungDauVao={dungWhatIf}
            horizonHours={horizonHours}
            onDoiHorizon={(g) => datHorizon(kep(g, HORIZON_MIN, HORIZON_MAX, 8))}
            heSo={heSoCycle}
            onDoiHeSo={(h) => datHeSoCycle(kep(h, HE_SO_MIN, HE_SO_MAX, 1))}
            ketQua={whatIfQ.data}
            dangChayWhatIf={daBamChay && whatIfQ.isLoading}
            onChayWhatIf={() => datDaBamChay(true)}
            tenTram={tenTramTheoId}
            /* ★ `null` = thiếu quyền ⇒ ngăn ẨN cả mục #35 (luật ẩn-không-disable,
                 `nganXuLyLogic.ts:102-111`). `[]` = có quyền, chưa có quy trình
                 nào — câu đó ngăn nói ra chứ không im lặng biến mất. */
            workflow={coQuyenXemQuyTrinh ? (dsWorkflowQ.data ?? []) : null}
            workflowRef={workflowRef}
            onDoiWorkflow={datWorkflowRef}
            phatLai={phatLaiQ.data}
            dangChayPhatLai={workflowRef !== null && phatLaiQ.isLoading}
          />
          </div>

          {/*
            ── ★★★ F4 — HAI TAY NẮM THU/MỞ, NỔI TRÊN MÉP CANVAS ──────────────
            Đặt Ở ĐÂY chứ không trong panel, và lý do là cơ học: một nút nằm
            TRONG panel sẽ biến mất cùng panel khi thu (`hidden`), và người dùng
            mất luôn đường mở lại — một trạng thái không thoát ra được.

            ★ `aria-expanded` + nhãn nói rõ panel nào: với trình đọc màn hình,
              hai nút chỉ khác nhau ở một mũi tên là hai nút không phân biệt
              được. §9.9 đòi mọi hành động làm được bằng bàn phím.
          */}
          <button
            type="button"
            /* ★ ĐỢT 21 — `z-30` thay `z-10`: panel nay o `z-20`, nen mot tay nam
               `z-10` se nam DUOI panel va bien mat khi panel MO. Nguoi dung mat
               duong thu panel, va khong loi nao no. */
            className="absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-r border border-l-0 bg-background/90 px-0.5 py-3 text-muted-foreground shadow-sm hover:bg-accent focus-visible:outline focus-visible:outline-2"
            data-testid="nut-thu-trai"
            aria-expanded={!thuTrai}
            aria-label={
              thuTrai
                ? t("twin3d.vanHanh.moPanelTrai", "Mở bảng bên trái")
                : t("twin3d.vanHanh.thuPanelTrai", "Thu bảng bên trái")
            }
            title={
              thuTrai
                ? t("twin3d.vanHanh.moPanelTrai", "Mở bảng bên trái")
                : t("twin3d.vanHanh.thuPanelTrai", "Thu bảng bên trái")
            }
            onClick={() => doiThu("trai")}
          >
            {thuTrai ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            /* ★ ĐỢT 21 — `z-30`, xem chu thich tay nam trai. */
            className="absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-l border border-r-0 bg-background/90 px-0.5 py-3 text-muted-foreground shadow-sm hover:bg-accent focus-visible:outline focus-visible:outline-2"
            data-testid="nut-thu-phai"
            aria-expanded={!thuPhai}
            aria-label={
              thuPhai
                ? t("twin3d.vanHanh.moPanelPhai", "Mở ngăn xử lý bên phải")
                : t("twin3d.vanHanh.thuPanelPhai", "Thu ngăn xử lý bên phải")
            }
            title={
              thuPhai
                ? t("twin3d.vanHanh.moPanelPhai", "Mở ngăn xử lý bên phải")
                : t("twin3d.vanHanh.thuPanelPhai", "Thu ngăn xử lý bên phải")
            }
            onClick={() => doiThu("phai")}
          >
            {thuPhai ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {/*
            ── ★★★ ĐỢT 21 — THANH TUA LẠI, NAY LÀ **LỚP PHỦ ĐÁY CANVAS** ─────

            Trước Đợt 21 `DongThoiGian` là một dải `shrink-0` thứ chín trong
            dòng chảy dọc, ăn **37 px** của canvas ở MỌI lượt hiện — mà nó LUÔN
            hiện. Nay nó neo `absolute bottom-0`, nên canvas cao thêm đúng 37 px
            mà không mất bộ điều khiển nào.

            ⚠ Bài học của chú thích cũ VẪN NGUYÊN GIÁ TRỊ và không bị bản này
              phủ nhận: dải này từng bị đặt SAU thân trang và bị đẩy ra ngoài
              màn hình (`top: 1265` trên viewport cao 1249) — *"một bộ điều
              khiển người dùng không nhìn thấy là một bộ điều khiển không tồn
              tại, và không có lỗi nào nổ để báo điều đó"*. `absolute bottom-0`
              trong một cha `absolute inset-0` KHÔNG thể rơi vào bẫy ấy: nó neo
              vào đáy khung, không phải vào cuối dòng chảy. Nghiệm thu vẫn phải
              làm **bằng ảnh** (§13b 14.10.A), không bằng lý lẽ.

            ★ `z-30` — ngang `DaiHopNhat`, TRÊN nhãn drei (z-index 20). Ở `z-10`
              nó sẽ hiện ra đủ mà đọc không được (G41).
          */}
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur-sm"
            data-testid="lop-phu-dong-thoi-gian"
          >
            <DongThoiGian
              moc={mocTua}
              bayGio={bayGioThat}
              dangPhat={dangPhat}
              tocDo={tocDo}
              onDoiMoc={setMocTua}
              onDoiPhat={setDangPhat}
              onDoiTocDo={setTocDo}
            />
          </div>

          {/* Trình đọc màn hình: canvas WebGL vô hình với nó (§9.9). */}
          <p className="sr-only" data-testid="tom-tat-canh">
            {ariaLabel}
          </p>
        </div>

        {/* NGĂN XỬ LÝ PHẢI — ★★★ nơi mọi việc được XỬ LÝ (§9.2) */}
        <div
          /* ★ F4 — xem chú thích panel trái. `w-64 2xl:w-80`: 256 px vẫn đủ cho
             mọi nút của `NganXuLy` (đo bằng ảnh, không phải đoán). */
          /* ★ ĐỢT 21 — nổi đè, xem chú thích dài ở panel trái. `border-l` là
             mới: khi panel không còn chia đất, nó cần một đường viền để mắt
             tách được nó khỏi cảnh phía dưới. */
          className={
            "pointer-events-auto absolute bottom-0 right-0 top-0 z-20 flex min-h-0 flex-col overflow-hidden border-l bg-background transition-[width] duration-200 " +
            (thuPhai ? "w-0 border-l-0" : "w-64 2xl:w-80")
          }
          data-testid="panel-phai"
          data-thu={thuPhai ? "1" : "0"}
          aria-hidden={thuPhai}
          hidden={thuPhai}
        >
          <NganXuLy
            machineId={machineIdChon}
            ma={mayDangChon?.ma ?? ""}
            ten={mayDangChon?.ten ?? ""}
            trangThai={
              mayDangChon
                ? trangThaiHienThi(mayDangChon, bayGio)
                : { trangThai: "khong_ro", tuoi: "khong_ro", daGhiDe: false }
            }
            thoiDiemDuLieu={mayDangChon?.thoiDiemDuLieu ?? null}
            bayGio={bayGio}
            canhBao={canhBaoCuaMay}
            quyen={quyen}
            coQuyenXem={(m) => hasPermission(m, "canView")}
            onDaXuLy={napLai}
            onDieuHuong={setLocation}
            /* ★ Đợt 33 (QĐ-23 #4): KHÔNG `onMoTaiCho`/`nganNhung` — ngăn nhúng
               `NganNhung` mất đường vào từ `/twin`; bấm máy đã rời sang
               `/twin/may/:id` nên panel này chỉ còn gặp `machineId === null`
               (chọn trạm/line) và các nút điều hướng rơi về `onDieuHuong`. */
          />
        </div>
      </div>

      {/*
        ── Dải dưới: dải Line 2D đồng bộ hai chiều (§10C.3 mục 3) ───────

        ★★★ ĐỢT 6 VÁ THƯỜNG-3 — `shrink-0` VÀ KHUNG NGOÀI `overflow-hidden`.
        Đo được trên trình duyệt thật ở 1366×768: trang tràn **77 px** mà
        KHÔNG có cuộn nội bộ — `khoi-canh-3d` và `ngan-xu-ly` bottom=821 trong
        khi việwport chỉ cao 768, panes `overflow-y:visible`, `canScroll:false`.
        Người dùng phải cuộn CẢ TRANG, đẩy header và thanh tua lên khỏi tầm
        nhìn — đúng lớp lỗi mà chú thích của `DongThoiGian` ở trên đã tả, nhưng
        mới chỉ vá được MỘT NỬA (dải tua), còn dải Line này vẫn nằm sau thân.

        ★ Ba ô `min-h-0` (khung ngoài, cột canvas, cột phải) là bắt buộc: một
          flex item MẶC ĐẮNH có `min-height:auto`, nghĩa là nó TỪ CHỐI co nhỏ
          hơn nội dung. Thiếu chúng thì `overflow-y-auto` của `ngan-xu-ly` không
          bao giờ kích hoạt — nó phình ra thay vì cuộn.
      */}
      {phamVi.cap === "line" && hinhLine ? (
        <DaiLine
          /*
            ★★★ §11.5 — BẢNG 2D SONG SONG VỚI LỚP PHỦ WIP 3D.

            `bangWip` và `cotWipCanh` (truyền vào `CanhVanHanh` ở trên) ra từ
            CÙNG `tinhWip` và CÙNG `laNghen()`. Nếu 3D tô đỏ trạm 7 thì dòng
            trạm 7 ở đây bắt buộc mang `nghen: true` — không có đường nào để hai
            bề mặt lệch nhau, vì không có phép tính thứ hai (G12).
          */
          tram={tram
            .filter((s) => s.lineId === phamVi.id)
            .map((s) => {
              const w = bangWip.find((d) => d.stationId === s.id);
              return {
                id: s.id,
                ma: s.ma,
                ten: s.ten,
                thuTu: s.thuTu,
                soMay: mayVanHanh.filter((m) => m.stationId === s.id).length,
                trangThai:
                  mayVanHanh
                    .filter((m) => m.stationId === s.id)
                    .map((m) => trangThaiTheoMay.get(m.id) ?? "khong_ro")[0] ?? "khong_ro",
                // ★ `?? null` chứ không `?? 0`: trạm không có dòng trong `bangWip`
                //   là "chưa đo được", và `hienSo` sẽ in `—`.
                soWip: w?.soWip ?? null,
                nghen: w?.nghen ?? false,
                hang: w?.hang ?? null,
              };
            })}
          nhipChuyenMs={nhipChuyenMs}
          stationIdChon={mayDangChon?.stationId ?? null}
          onChonTram={(stationId) => {
            const mayDau = mayVanHanh.find((m) => m.stationId === stationId);
            if (mayDau) chonMay(mayDau.id);
          }}
        />
      ) : null}
    </div>
  );
}
