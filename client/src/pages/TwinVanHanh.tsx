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
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, Boxes, LayoutGrid, OctagonAlert, RefreshCw } from "lucide-react";
import type * as THREE from "three";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { isScopeEmpty } from "@/lib/scopeEmpty";
import { trpc } from "@/lib/trpc";

import { gocTuQuatTrucDung, mmSangMet } from "@/components/twin3d/heToaDo";
import { hinhKhoiCho } from "@/components/twin3d/hinhKhoiMay";
import { mauChoTrangThai } from "@/components/twin3d/mauTrangThai";
import { mauCss } from "@/components/twin3d/van-hanh/mauThree";
import { hinhHocLine, type ViTriDaDat } from "@/components/twin3d/phamViLine";
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
import type { CanhBaoTheGioi, MucCanhBao } from "@/components/twin3d/van-hanh/LopCanhBao";
import {
  docTrangThaiUrl,
  ghiCamera,
  kieuGhiLichSu,
  tronTrangThaiUrl,
  type PhamVi,
} from "@/components/twin3d/van-hanh/duongDanTwin";
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
  thoiDiemDuLieuMoiNhat,
  trangThaiHienThi,
  type MayVanHanh,
} from "@/components/twin3d/van-hanh/trungThucDuLieu";
import type { CanhBaoDangMo, QuyenXuLy } from "@/components/twin3d/van-hanh/nganXuLyLogic";
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

/** Phạm vi mặc định khi URL không nói gì. */
const PHAM_VI_MAC_DINH: PhamVi = { cap: "tang", id: null };

export default function TwinVanHanh() {
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

  const urlState = useMemo(() => docTrangThaiUrl(search), [search]);
  const phamVi = urlState.phamVi ?? PHAM_VI_MAC_DINH;
  const machineIdChon = urlState.chon?.loai === "machine" ? urlState.chon.id : null;

  /**
   * Ghi trạng thái vào URL. `push` khi đổi phạm vi/chọn (nút Back quay lại cấp
   * trước), `replace` khi chỉ xoay camera — xoay sinh hàng trăm sự kiện mỗi
   * giây và đẩy hết vào history làm nút Back vô dụng (§9.4).
   */
  const ghiUrl = useCallback(
    (thayDoi: Parameters<typeof tronTrangThaiUrl>[1]) => {
      const qs = tronTrangThaiUrl(window.location.search, thayDoi);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (kieuGhiLichSu(thayDoi) === "push") setLocation(url);
      else window.history.replaceState(null, "", url);
    },
    [setLocation],
  );

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* Dữ liệu                                                                  */
  /* ═══════════════════════════════════════════════════════════════════════ */

  const factoriesQ = trpc.factory.list.useQuery();
  const factories = useMemo(
    () => (factoriesQ.data ?? []) as Array<{ id: number; name?: string; code?: string }>,
    [factoriesQ.data],
  );
  const [factoryId, setFactoryId] = useState<number | null>(null);
  useEffect(() => {
    if (factoryId === null && factories.length > 0) setFactoryId(factories[0].id);
  }, [factories, factoryId]);

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
  const toaNhaDau = (toaNhaQ.data ?? [])[0] as
    | { id: number; rongMm: string | number; sauMm: string | number }
    | undefined;
  const chiTietQ = trpc.twinCanh.chiTietToaNha.useQuery(
    { id: toaNhaDau?.id ?? 0 },
    { enabled: toaNhaDau !== undefined, retry: false },
  );
  const tangDau = useMemo(() => {
    const tang = (chiTietQ.data?.tangs ?? [])[0] as { id: number } | undefined;
    if (!toaNhaDau || !tang) return null;
    // ★ `numeric(14,3)` về từ drizzle là STRING. `Number(...)` tường minh là bắt
    //   buộc: cộng hai string sẽ NỐI CHUỖI ("38400"+"0"="384000") — không throw,
    //   và nhà xưởng to gấp 10 lần.
    return { tangId: tang.id, rongMm: Number(toaNhaDau.rongMm), sauMm: Number(toaNhaDau.sauMm) };
  }, [toaNhaDau, chiTietQ.data]);

  // Hình học + cây phân cấp.
  const canhQ = trpc.twinCanh.canhThietKe.useQuery(
    { factoryId: factoryId ?? 0, tangIds: tangDau ? [tangDau.tangId] : [] },
    { enabled: factoryId !== null, retry: false },
  );

  /**
   * Trạng thái sống + OEE + andon (hợp đồng `factoryCommand.overview`).
   *
   * ★★★ #51 — nhịp ĐẦY ĐỦ 5 s ↔ 30 s. Đây là truy vấn tổng quan, cùng hạng với
   *   `machineStatus.listWithStatus` mà `FactoryLiveMap3D.tsx:68` áp luật này.
   */
  const overviewQ = trpc.factoryCommand.overview.useQuery(
    { factoryId: factoryId ?? undefined },
    { enabled: factoryId !== null, retry: false, refetchInterval: nhipTongQuanMs },
  );

  /**
   * Cảnh báo đang mở — nguồn cho badge 3D và cho `NganXuLy`.
   *
   * ★★★ #51 CÓ TRẦN 20 s — và trần này KHÔNG phải sự thận trọng thừa.
   *   `nhipHoiMs(true)` = 30 s. Áp thẳng nó vào đây sẽ làm truy vấn cảnh báo
   *   **CHẬM ĐI** (20 → 30 s) mỗi khi socket khoẻ — một hồi quy an toàn đội lốt
   *   "nối tính năng #51". Luật đúng: nhịp thích nghi chỉ được rút NGẮN.
   */
  const andonQ = trpc.andon.active.useQuery(undefined, {
    retry: false,
    refetchInterval: nhipHoiToiDa(coLuongDay, 20_000),
  });

  /**
   * ★★★ §11 #26 — NGUỒN DỮ LIỆU AN TOÀN (E-STOP). Đây là ô đã đóng nợ Đợt 6.
   *
   * ★ Nhịp làm mới 20 s, BẰNG `andonQ` chứ không bằng `overviewQ` (30 s): E-STOP
   *   cùng hạng với cảnh báo đang mở, không cùng hạng với số liệu tổng quan.
   *   ★★★ #51 giữ nguyên bất biến đó qua `nhipHoiToiDa(_, 20_000)`: socket chết
   *   thì rút về 5 s, socket khoẻ thì ở lại 20 s — KHÔNG bao giờ trôi lên 30 s.
   */
  const anToanQ = trpc.twinCanh.anToanRobot.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId !== null, retry: false, refetchInterval: nhipHoiToiDa(coLuongDay, 20_000) },
  );

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
   * #61 — số WIP theo trạm. Nhịp thích nghi (#51) áp luôn ở đây: WIP đổi theo
   * từng chiếc rời trạm, nên nó cùng hạng "số liệu vận hành" với `overviewQ`.
   */
  const wipQ = trpc.digitalTwin.wipFlowState.useQuery(
    { lineId: lineDangXem ?? 0 },
    { enabled: lineDangXem !== null, retry: false, refetchInterval: nhipTongQuanMs },
  );

  /**
   * ★★★ #32 + #36 — MỘT truy vấn cho CẢ nút thắt LẪN nhịp chuyền.
   *
   * ⚠ Bản đầu gọi THÊM `digitalTwin.stationLoadHeatmap` chỉ để lấy
   *   `bottleneckStationId`. Đã BỎ, và lý do là một luật chứ không phải tiết
   *   kiệm: thủ tục đó KHÔNG trả `periodStart`, nên lời khai của nó không tự
   *   chứng minh được mình còn hạn — mà nghiệm thu Đợt 8 đo được rằng một lời
   *   khai 16 ngày tuổi tô đỏ sai trạm. Ghép `bottleneckStationId` của truy vấn
   *   này với `periodStart` của truy vấn kia là mời G12 vào cửa: hai con số từ
   *   hai bản ghi khác nhau, trình bày như thể thuộc về một.
   *   `wip.lineBalance` trả NGUYÊN HÀNG — `periodStart`, `avgCycleTimeMs`,
   *   `bottleneckStationId` chắc chắn cùng một bản ghi.
   *
   * #36 — NHỊP CHUYỀN THẬT cho mũi tên dòng chảy.
   *
   * ★★★ SPEC §11 #36 GHI SAI NGUỒN. Nó chỉ `commandLog.avgDurations`, nhưng thủ
   *   tục đó tính `avg(ackedAt − sentAt) GROUP BY commandType` — **độ trễ ACK
   *   của lệnh điều khiển**, gộp theo LOẠI LỆNH, không theo chuyền. Một chuyền
   *   12 s/chiếc mà lệnh `START` ack trong 80 ms sẽ cho mũi tên chạy nhanh gấp
   *   150 lần sự thật (họ G7 — đo nhầm đại lượng).
   *   Nguồn ĐÚNG dùng ở đây: `line_balance_metrics.avgCycleTimeMs` qua
   *   `wip.lineBalance` — ms/chiếc, theo TỪNG LINE.
   *
   * ★ `limit: 1` — chỉ cần bản ghi gần nhất; thủ tục đã `orderBy periodStart desc`.
   * ★ Nhịp CỐ ĐỊNH ở `NHIP_CO_LUONG_MS` (30 s) và KHÔNG thích nghi: cân bằng
   *   chuyền là số liệu tổng hợp theo KỲ, không phải trạng thái tức thời. Hỏi
   *   nó 5 giây một lần khi socket chết chỉ đọc lại đúng một hàng — nhịp thích
   *   nghi ở đây sẽ tốn băng thông mà không đổi được một chữ số nào.
   */
  const canBangQ = trpc.wip.lineBalance.useQuery(
    { lineId: lineDangXem ?? 0, limit: 1 },
    { enabled: lineDangXem !== null, retry: false, refetchInterval: NHIP_CO_LUONG_MS },
  );

  /**
   * ★★★ "MỘT LỐI VÀO RỒI TỪ CHỐI" — bắt FORBIDDEN của truy vấn hình học.
   * Người dùng qua cổng `analytics_oee` nhưng `canhThietKe` đòi
   * `settings_factory`/`machine_control`. Không bắt thì họ thấy một cảnh TRỐNG
   * trông y như nhà máy chưa dựng — lời khai sai về thế giới.
   */
  const thieuQuyenBoCuc =
    (canhQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN" ||
    (toaNhaQ.error?.data as { code?: string } | undefined)?.code === "FORBIDDEN";

  const phamViRong = isScopeEmpty(
    (canhQ.data as { scopeEmptyReason?: string | null } | undefined)?.scopeEmptyReason,
  );

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
  const [mocTua, setMocTua] = useState<number | null>(null);
  const [dangPhat, setDangPhat] = useState(false);
  const [tocDo, setTocDo] = useState<TocDo>(1);

  /**
   * ★★★ ẢNH LỊCH SỬ ĐỔ VÀO **CÙNG** KHO — đây là chỗ §9.8 được thực thi.
   *
   * Không có `khoReplay` riêng. Gói lịch sử đi qua đúng `apDung()` mà gói socket
   * đi qua, chỉ khác `nguon` và có `mocXemLai`. Nhờ vậy mọi luật phía sau (tuổi
   * → `khong_ro`, đếm rỗng ≠ đếm 0) áp y hệt nhau cho hai chế độ.
   */
  const lichSuQ = trpc.twinCanh.anhLichSu.useQuery(
    { factoryId: factoryId ?? 0, moc: mocTua ?? 0 },
    { enabled: factoryId !== null && mocTua !== null, retry: false },
  );

  useEffect(() => {
    if (mocTua === null) {
      datAnhLichSu(null, null);
      return;
    }
    // Chưa có dữ liệu ⇒ chỉ đánh dấu đang tua (UI hiện "Xem lại"), CHƯA thay
    // cảnh. Thay cảnh bằng dữ liệu trực tiếp mà gắn nhãn lịch sử là nói dối.
    datAnhLichSu(mocTua, lichSuQ.data?.may ?? null);
  }, [mocTua, lichSuQ.data, datAnhLichSu]);

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

  /* ── §11 #52 — XUẤT XỨ: SHADOW / mô phỏng / chỉ sơ đồ ──────────────── */

  /**
   * ★ "Có số liệu thật" = có ÍT NHẤT một máy mang dấu thời gian dữ liệu. Đo bằng
   *   `thoiDiemDuLieu != null` chứ KHÔNG bằng "có máy nào không": một cảnh 42
   *   máy mà không máy nào từng báo cáo là SƠ ĐỒ, không phải SHADOW.
   */
  const xuatXu = useMemo(
    () =>
      xuatXuHienTai(
        {
          coSoLieuThat: mayVanHanh.some((m) => m.thoiDiemDuLieu != null),
          // Twin hiện chưa có chế độ what-if trên màn Vận hành (ngăn "Mô phỏng"
          // là việc của Đợt 5/7) ⇒ luôn `false` ở đây. KHÔNG hardcode `bong`:
          // khi ngăn đó nối vào, chỉ cần đổi đúng ô này.
          dangMoPhong: false,
        },
        (canhQ.data?.datCho?.length ?? 0) > 0,
      ),
    [mayVanHanh, canhQ.data],
  );

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

  /** Đặt chỗ theo máy — nguồn vị trí 3D. */
  const datChoTheoMay = useMemo(() => {
    // `NonNullable` vì `canhQ.data` là `… | undefined` lúc chưa tải xong; ta chỉ
    // cần KIỂU của phần tử, không cần giá trị.
    type HangDatCho = NonNullable<typeof canhQ.data>["datCho"][number];
    const m = new Map<number, HangDatCho>();
    for (const d of canhQ.data?.datCho ?? []) {
      if (d.loaiThucThe === "machine") m.set(d.thucTheId, d);
    }
    return m;
  }, [canhQ.data]);

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

  const mayVe = useMemo<MayTrongLo[]>(() => {
    const ra: MayTrongLo[] = [];
    for (const mv of mayVanHanh) {
      const d = datChoTheoMay.get(mv.id);
      if (!d || !d.hienThi) continue;
      const co = kichThuocTheoLoai.get(mv.loaiMay) ?? { rongMm: 1000, caoMm: 1800, sauMm: 1000 };
      const kieu = mauChoTrangThai(trangThaiTheoMay.get(mv.id));
      const trong = trongPhamVi(
        {
          machineId: mv.id,
          stationId: mv.stationId,
          lineId: mv.lineId,
          workshopId: null,
          factoryId,
          tangId: d.tangId,
        },
        phamVi,
      );
      ra.push({
        machineId: mv.id,
        khoi: hinhKhoiCho(mv.loaiMay),
        kichThuocMm: {
          rongMm: d.rongMm ?? co.rongMm,
          caoMm: d.caoMm ?? co.caoMm,
          sauMm: d.sauMm ?? co.sauMm,
        },
        // DB: X = Đông, Y = mặt bằng, Z = độ cao → scene: x, y = độ cao, z = mặt bằng.
        viTri: { x: mmSangMet(d.viTriXMm), y: mmSangMet(d.viTriZMm), z: mmSangMet(d.viTriYMm) },
        gocXoayRad: gocTuQuatTrucDung({ x: d.quatX, y: d.quatY, z: d.quatZ, w: d.quatW }),
        /**
         * ★★★ "MỜ ĐI" PHẢI LÀ PHA VỀ NỀN, KHÔNG PHẢI LÀM TỐI (lỗi thị giác đo được)
         *
         * `doMo` của `LoBatchMay` (Đợt 1, không được sửa) là kênh LÀM TỐI:
         * `LoBatchMay.tsx:196` nhân màu với `0.35 + 0.65*doMo`, vì vật liệu của
         * `BatchedMesh` là ĐỤC (bật `transparent` cho cả lô sẽ phá thứ tự vẽ).
         *
         * ⚠ Nghiệm thu bằng ẢNH bắt được: trên theme SÁNG, làm tối một màu vốn
         *   nhạt (`--muted` = oklch 0.94) cho ra khối gần như ĐEN trên nền sàn
         *   sáng — đọc như MÁY HỎNG, không như "lùi khỏi tiền cảnh". Đó là lời
         *   khai sai theo đúng kiểu §10.1 cấm: độ tương phản CAO dành cho bất
         *   thường, mà ở đây nó lại rơi vào những máy bình thường ngoài phạm vi.
         *
         * ⇒ Ta pha màu về phía NỀN ngay ở tầng này (`pha()` bên dưới) rồi truyền
         *   `doMo: 1`, tức là dùng đúng kênh mà kit cho phép mà không phải sửa
         *   kit. Kết quả: máy ngoài phạm vi nhạt đi đúng nghĩa, ở CẢ hai theme.
         */
        mau: trong
          ? mauCss(kieu.token, "#94a3b8")
          : phaVeNen(mauCss(kieu.token, "#94a3b8"), mauNenCanh, TI_LE_PHA_NGOAI_PHAM_VI),
        doMo: trong ? kieu.doMo : 1,
      });
    }
    return ra;
  }, [mayVanHanh, datChoTheoMay, kichThuocTheoLoai, trangThaiTheoMay, phamVi, factoryId, mauNenCanh]);

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
    const chuaDat = mayVanHanh
      .filter((mv) => {
        if (!mv.isActive) return false;
        const d = datChoTheoMay.get(mv.id);
        return !d || !d.hienThi;
      })
      .map((mv) => mv.id);
    if (chuaDat.length === 0) return [];

    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    for (const m of mayVe) {
      if (m.viTri.x < minX) minX = m.viTri.x;
      if (m.viTri.z < minZ) minZ = m.viTri.z;
    }
    // Chưa có máy nào trên mặt bằng ⇒ neo về gốc, khu chờ vẫn hiện được.
    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(minZ)) minZ = 0;

    const loaiTheoMay = new Map(mayVanHanh.map((mv) => [mv.id, mv.loaiMay]));
    return xepKhuCho(chuaDat, { mepX: minX, mepZ: minZ }).map((k) => {
      const loai = loaiTheoMay.get(k.machineId) ?? "";
      const co = kichThuocTheoLoai.get(loai) ?? { rongMm: 1000, caoMm: 1800, sauMm: 1000 };
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
  }, [mayVanHanh, datChoTheoMay, mayVe, kichThuocTheoLoai, mauNenCanh]);

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
    () =>
      mayVe.map((m) => {
        const tt = trangThaiTheoMay.get(m.machineId) ?? "khong_ro";
        return {
          khoa: `may-${m.machineId}`,
          machineId: m.machineId,
          viTri: { x: m.viTri.x, y: m.viTri.y + mmSangMet(m.kichThuocMm.caoMm) + 0.4, z: m.viTri.z },
          ma: maTheoMay.get(m.machineId) ?? `#${m.machineId}`,
          phu: t(mauChoTrangThai(tt).khoaNhan),
          batThuong: mauChoTrangThai(tt).laBatThuong,
        };
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
  const nhanTatCa = useMemo<NhanTheGioi[]>(
    () => [
      ...nhan,
      ...nhanLine.map((l) => ({
        khoa: `line-${l.lineId}`,
        machineId: -l.lineId,
        viTri: l.viTri,
        ma: l.ma,
        phu: l.ten,
        batThuong: false,
      })),
    ],
    [nhan, nhanLine],
  );

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

  const canhBao3D = useMemo<CanhBaoTheGioi[]>(() => {
    const viTriMay = new Map(mayVe.map((m) => [m.machineId, m]));
    const ra: CanhBaoTheGioi[] = [];
    for (const a of andonRows) {
      if (a.machineId == null) continue;
      const m = viTriMay.get(a.machineId);
      if (!m) continue;
      ra.push({
        id: a.id,
        machineId: a.machineId,
        viTri: { x: m.viTri.x, y: m.viTri.y + mmSangMet(m.kichThuocMm.caoMm) + 0.9, z: m.viTri.z },
        muc: (["red", "yellow", "call"].includes(a.state) ? a.state : "call") as MucCanhBao,
        nhan: maTheoMay.get(a.machineId) ?? `#${a.machineId}`,
        daAck: a.status === "acknowledged",
      });
    }
    return ra;
  }, [andonRows, mayVe, maTheoMay]);

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

  /* ── Phạm vi Line (§10C.3) ──────────────────────────────────────────── */
  const hinhLine = useMemo(() => {
    if (phamVi.cap !== "line" || phamVi.id === null) return null;
    const datChoTram = new Map<number, { x: number; y: number; z: number }>();
    for (const d of canhQ.data?.datCho ?? []) {
      if (d.loaiThucThe === "station") {
        datChoTram.set(d.thucTheId, {
          x: mmSangMet(d.viTriXMm),
          y: mmSangMet(d.viTriZMm),
          z: mmSangMet(d.viTriYMm),
        });
      }
    }
    const tramCuaLine: ViTriDaDat[] = tram
      .filter((s) => s.lineId === phamVi.id)
      .map((s) => {
        const v = datChoTram.get(s.id);
        // ★ Trạm chưa có đặt chỗ ⇒ suy tâm từ MÁY của nó, thay vì bỏ trạm khỏi
        //   Line (bỏ đi làm đường tâm đứt quãng mà không nói vì sao).
        const mayCuaTram = mayVe.filter(
          (m) => mayVanHanh.find((x) => x.id === m.machineId)?.stationId === s.id,
        );
        const tamMay =
          mayCuaTram.length > 0
            ? {
                x: mayCuaTram.reduce((a, m) => a + m.viTri.x, 0) / mayCuaTram.length,
                y: 0,
                z: mayCuaTram.reduce((a, m) => a + m.viTri.z, 0) / mayCuaTram.length,
              }
            : null;
        return { khoa: `station:${s.id}`, tam: v ?? tamMay ?? { x: 0, y: 0, z: 0 }, thuTu: s.thuTu };
      });
    const mayCuaLine: ViTriDaDat[] = mayVe
      .filter((m) => mayVanHanh.find((x) => x.id === m.machineId)?.lineId === phamVi.id)
      .map((m) => ({ khoa: `machine:${m.machineId}`, tam: m.viTri }));
    if (tramCuaLine.length === 0 && mayCuaLine.length === 0) return null;
    return { hh: hinhHocLine(tramCuaLine, mayCuaLine), tram: tramCuaLine };
  }, [phamVi, tram, mayVe, mayVanHanh, canhQ.data]);

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
  const doiSoat = useMemo(
    () => doiSoatCanh(mayVanHanh, [...datChoTheoMay.keys()]),
    [mayVanHanh, datChoTheoMay],
  );

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

  const chonMay = useCallback(
    (id: number | null) => {
      ghiUrl({ chon: id === null ? null : { loai: "machine", id } });
    },
    [ghiUrl],
  );

  const doiPhamVi = useCallback((pv: PhamVi) => ghiUrl({ phamVi: pv }), [ghiUrl]);

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
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
        <nav className="flex items-center gap-1 text-xs" aria-label="breadcrumb" data-testid="breadcrumb-twin">
          {breadcrumb.map((m, i) => (
            <span key={`${m.cap}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <span className="text-muted-foreground">›</span> : null}
              <button
                type="button"
                className="rounded px-1 hover:bg-accent focus-visible:outline focus-visible:outline-2"
                data-testid={`breadcrumb-${m.cap}`}
                onClick={() => doiPhamVi({ cap: m.cap, id: m.id })}
              >
                {m.nhan}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2">
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
          <span
            className={`text-[11px] ${doTuoiNen.do ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="do-tuoi-nen"
            data-giay={doTuoiNen.giay ?? ""}
          >
            {doTuoiNen.giay === null
              ? `${t("twin3d.tuoi.capNhatLanCuoi")}: —`
              : t("twin3d.vanHanh.capNhatTruoc", "Cập nhật {{giay}} giây trước", {
                  giay: hienSo(doTuoiNen.giay),
                })}
          </span>
          <Button size="sm" variant="ghost" onClick={napLai} data-testid="nut-nap-lai">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
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
        </div>
      </header>

      {/*
        ── ★★★ CHẶN-2 — BANNER TRUY VẤN BỊ TỪ CHỐI ──────────────────────
        Nêu ĐÍCH DANH truy vấn nào bị chặn. Một banner chung chung ("thiếu
        quyền") để người dùng và người trực tổng đài đoán mò xem thiếu cái gì;
        tên tRPC nguyên văn cho họ đúng chuỗi để đọc cho quản trị viên.
        Đặt TRƯỚC banner đối soát: đối soát tính trên dữ liệu, mà dữ liệu đang
        thiếu ⇒ câu nói về quyền phải tới trước.
      */}
      {tinhTrang.biTuChoi.length > 0 ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1 text-[11px] text-destructive"
          data-testid="banner-thieu-quyen-truy-van"
          data-truy-van={tinhTrang.biTuChoi.join(",")}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t(
              "twin3d.vanHanh.thieuQuyenTruyVan",
              "Không đủ quyền xem dữ liệu — liên hệ quản trị viên. Truy vấn bị từ chối: {{ds}}",
              { ds: tinhTrang.biTuChoi.join(", ") },
            )}
          </span>
        </div>
      ) : null}

      {/* ── Banner đối soát (NT-3.3) — thuốc chống model drift ─────────── */}
      {!dangTai && doiSoat.lech ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-700 dark:text-amber-400"
          data-testid="banner-doi-soat"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t("twin3d.vanHanh.doiSoatLech", "{{thieu}} máy chưa xếp chỗ · {{moCoi}} đặt chỗ trỏ vào máy đã ngừng", {
              thieu: doiSoat.thieuTrenMatBang.length,
              moCoi: doiSoat.datChoMoCoi.length,
            })}
          </span>
          <button
            type="button"
            className="underline"
            onClick={() => setLocation("/twin-studio")}
            data-testid="nut-mo-xuong-dung"
          >
            {t("twin3d.vanHanh.moXuongDung", "Mở Xưởng dựng")}
          </button>
        </div>
      ) : null}

      {/*
        ★★★ §11 #26 — E-STOP NỔI LÊN TWIN. An toàn phải thấy được từ tổng quan,
        không phải mở từng buồng lái mới biết. Đặt TRÊN mọi banner khác: đây là
        thông tin an toàn, nó không xếp hàng sau cảnh báo bố cục.

        ★ Nguồn: `twinCanh.anToanRobot` (đã nối 2026-09-07 — đóng nợ Đợt 6).
        Nghiệm thu bằng CA DƯƠNG dựng tay: đặt một robot sang `status='estop'`,
        mở `/twin`, dải này NỔI LÊN; khôi phục xong nó tắt. Không dựng ca dương
        thì "không dải nào hiện" trông y hệt nhau dù mã đúng hay hỏng (G5/G22).
      */}
      {anToan.coCanhBao ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-destructive bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive"
          role="alert"
          data-testid="canh-bao-estop"
        >
          <OctagonAlert className="h-4 w-4 shrink-0" />
          <span>
            {t("twin3d.anToan.estopDangNhan", "E-STOP đang được nhấn: {{ds}}", {
              ds: anToan.dangNhan.map((r) => r.ma).join(", "),
            })}
          </span>
        </div>
      ) : null}

      {/*
        ── Dải tua lại 24 h (§9.8) — CÙNG kho với trực tiếp ─────────────
        ⚠ ĐẶT TRƯỚC thân trang, KHÔNG phải sau. Đo được trên trình duyệt thật:
        khung ngoài là `h-[calc(100vh-5rem)] flex-col`, thân giữa `flex-1` chiếm
        1054 px và KHÔNG co lại, nên một dải 37 px đặt sau thân bị đẩy xuống
        `top: 1265` trong khi viewport chỉ cao 1249 — thanh tua **render nhưng
        nằm ngoài màn hình**. Một bộ điều khiển người dùng không nhìn thấy là
        một bộ điều khiển không tồn tại, và không có lỗi nào nổ để báo điều đó.
      */}
      <DongThoiGian
        moc={mocTua}
        bayGio={bayGioThat}
        dangPhat={dangPhat}
        tocDo={tocDo}
        onDoiMoc={setMocTua}
        onDoiPhat={setDangPhat}
        onDoiTocDo={setTocDo}
      />

      {/* ── Thân: trái | canvas | phải ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* PANEL TRÁI — DOM thật, tab được, MỌI hành động làm được từ đây (§9.9) */}
        <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r">
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

          {/* ★ DANH SÁCH MÁY — DOM thật, mọi hành động làm được từ đây (§9.9) */}
          <DanhSachMay
            may={mayVanHanh}
            trangThaiTheoMay={trangThaiTheoMay}
            machineIdChon={machineIdChon}
            onChonMay={chonMay}
            bayGio={bayGio}
            dangTai={dangTai}
          />
        </div>

        {/* CANVAS GIỮA — ★ RB-4: 2D THAY THẾ 3D, không bao giờ cả hai */}
        <div className="relative min-h-0 min-w-0 flex-1">
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
              machineIdChon={machineIdChon}
              onChonMay={chonMay}
              khungNhin={khungNhin}
              sanRongM={sanRongM}
              sanSauM={sanSauM}
              tatNhan={false}
              chuMatContext={t("twin3d.loi.matContext")}
              ariaLabel={ariaLabel}
              onCameraDoi={khiCameraDoi}
            />
          )}
          {/* Trình đọc màn hình: canvas WebGL vô hình với nó (§9.9). */}
          <p className="sr-only" data-testid="tom-tat-canh">
            {ariaLabel}
          </p>
        </div>

        {/* NGĂN XỬ LÝ PHẢI — ★★★ nơi mọi việc được XỬ LÝ (§9.2) */}
        <div className="flex w-80 min-h-0 shrink-0 flex-col overflow-hidden">
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
