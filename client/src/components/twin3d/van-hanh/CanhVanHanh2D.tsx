/**
 * CanhVanHanh2D.tsx — bản 2D của cảnh vận hành (§9.9).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG DÙNG THẲNG `factory-scene/FactoryScene2D.tsx`
 * ════════════════════════════════════════════════════════════════════════════
 * `FactoryScene2D` (361 dòng, đã có sẵn) nhận `MachineNode` với tập trạng thái
 * **`running | idle | down | offline | maintenance`** — hợp đồng của
 * `factoryCommand.overview`. Màn Vận hành chạy trên tập trạng thái KHÁC: 8 giá
 * trị `operationStatusEnum` của DB **cộng hai trạng thái riêng của cảnh**
 * (`khong_ro`, `ngung_khai_thac`).
 *
 * Nối thẳng vào nó sẽ ép 8+2 giá trị xuống 5 ô, và `starved`/`blocked`/
 * `warming_up`/`changeover` KHÔNG có ô nào — chúng sẽ rơi vào một ô mặc định.
 * Đúng cảnh báo mà `CanhNhaMay.tsx` (Đợt 1) đã ghi sẵn cho đợt này:
 *
 *   > "Hợp nhất hai hệ trạng thái là việc của màn `/twin` mới (Đợt 5), nơi dữ
 *   > liệu đến từ `trangThaiHangLoat` với đúng enum của DB."
 *
 * ⇒ Bản 2D ở đây vẽ từ **cùng một `MayTrongLo`** mà bản 3D dùng, qua **cùng một
 *   `mauTrangThai.ts`**. Đó là điều kiện của §9.9 ("bản 2D render từ CHÍNH dữ
 *   liệu đó") — nếu hai bản đọc hai nguồn thì chúng sẽ lệch nhau, và lúc đó bản
 *   fallback lại nói khác bản chính về cùng một nhà máy.
 *
 * ★ SVG, không canvas — mỗi máy là một `<rect>` DOM thật, nên:
 *   • Playwright click được, trình đọc màn hình đọc được
 *   • KHÔNG tốn WebGL context (đây là fallback khi WebGL hỏng — RB-4)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI ĐƠN VỊ VẼ — VÀ CHÚNG PHẢI GIỐNG BẢN 3D Ở CẢ HAI CẤP
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp này vẽ MỘT trong hai đơn vị, không bao giờ cả hai:
 *
 *   `saBan` RỖNG      ⇒ **khối máy** — cấp nhà máy/toà/tầng, y như trước.
 *   `saBan` KHÁC RỖNG ⇒ **biểu tượng toà nhà** — cấp tập đoàn, cùng mảng
 *                        `dungSaBanVe()` mà bản 3D nhận.
 *
 * Luật rẽ nhánh sao chép ĐÚNG bản 3D (`CanhVanHanh` + `LopSaBan`, Task 20), và
 * đó là chủ đích: trước lượt này hai chế độ kể hai câu chuyện khác nhau ở cấp
 * tập đoàn mà không câu nào trên màn nói ra. Lý lẽ đầy đủ + số đo nằm ở khối
 * chú thích ngay trên nhánh `veSaBan ?` trong thân hàm; lưới ghim là
 * `saBan2D.dom.test.tsx` (hành vi) và `saBanHaiCheDo.unit.test.ts` (khớp nối).
 */

import { useMemo, useRef } from "react";

import { useOptionalTheme } from "@/components/factory-scene/useOptionalTheme";

/*
 * ★ `apDungMucTuoi` NHẬP THẲNG, không chép luật: đây là CÙNG hàm mà đường vẽ 3D
 *   (`hopNhatCanh.dungMayVe`) gọi từ commit `4482aaaaa`. Hệ số 40 % vì thế vẫn
 *   chỉ có ĐÚNG MỘT bản (`HE_SO_NHAT_DU_LIEU_CU`) — một bản sao ở đây sẽ chỉ
 *   đồng ý tới lần sửa đầu tiên, rồi âm thầm cho hai bề mặt nhạt khác nhau về
 *   cùng một máy (G12). Hàm là phép nhân THUẦN, không kéo DOM theo.
 */
import { apDungMucTuoi, giaiMauCanh, mauChoTrangThai, type MucTuoi } from "../mauTrangThai";
import { mmSangMet } from "../heToaDo";
import { useDatNhanSaBan2D, type MucNhan2D } from "./nhanSaBan2D";
import {
  MAU_BIEU_TUONG_TOA,
  NEN_CUM_SANG,
  NEN_CUM_TOI,
  type BieuTuongToaVe,
  type CumSaBanVe,
} from "./hopNhatCanh";
import type { MayTrongLo } from "../loi";

/**
 * Mặc định RỖNG bằng HẰNG MODULE, không `[]` literal ở chỗ khai tham số: một
 * literal dựng mảng MỚI mỗi render và mọi `useMemo([saBan])` phía dưới mất tác
 * dụng — cùng bẫy mà `CanhVanHanh` đã phải dựng `EMPTY_SA_BAN` để tránh.
 */
const SA_BAN_2D_RONG: readonly BieuTuongToaVe[] = [];
const SA_BAN_2D_CUM_RONG: readonly CumSaBanVe[] = [];
/**
 * Bản đồ mức tươi RỖNG — cùng lý lẽ hằng-module như hai hằng trên: một
 * `new Map()` ở chỗ khai tham số dựng đối tượng MỚI mỗi render và `useMemo`
 * phía dưới mất tác dụng ngay.
 */
const MUC_TUOI_2D_RONG: ReadonlyMap<number, MucTuoi> = new Map();

/**
 * Khoá bảng tra màu = **TỔ HỢP** (trạng thái × mức tươi), không phải trạng thái.
 *
 * ⚠ Ngăn cách bằng `\u0000` chứ không bằng `-`/`|`: khoá trạng thái là chuỗi tự
 *   do — kiểu khai là `ReadonlyMap<number, string>`, KHÔNG phải union — nên một
 *   ngăn cách xuất hiện trong chính giá trị sẽ gộp hai tổ hợp khác nhau vào CÙNG
 *   một khoá: hai máy khác tuổi vẽ giống hệt nhau, im lặng, không lỗi nào nổ.
 *   `\u0000` là ký tự Postgres KHÔNG chấp nhận trong một giá trị
 *   `text`, nên nó không thể đến từ dữ liệu.
 */
function khoaToHopMau(trangThai: string, tuoi: MucTuoi): string {
  return `${trangThai}\u0000${tuoi}`;
}

/**
 * Tên cho `<title>` của khối toà: "‹cụm› — ‹toà›", nhưng KHÔNG lặp khi tên toà
 * đã mở đầu bằng chính tên cụm.
 *
 * ⚠ Đo được, không phải lo xa: ở `qatd_admin` 2D, toà 90 cho ra
 *   "FUYU-F (tai tong hop) — FUYU-F (tai tong hop) — toa chinh" — tên cụm hiện
 *   HAI lần trong một dòng mách. Dữ liệu thật đặt tên toà theo kiểu
 *   "‹tên nhà máy› — toa chinh", nên phép nối ngây thơ tự sinh ra bản sao.
 */
export function nhanKhoiCoCum(tenCum: string | undefined, tenToa: string): string {
  const cum = (tenCum ?? "").trim();
  const toa = tenToa.trim();
  if (!cum || toa === cum || toa.startsWith(`${cum} `)) return toa;
  return `${cum} — ${toa}`;
}

/**
 * Cỡ chữ nhãn tính theo **TỈ LỆ cạnh sa bàn**, không theo hằng mét.
 *
 * `<svg viewBox>` co giãn toàn bộ hệ toạ độ, nên một cỡ chữ cố định *bằng mét*
 * cho ra số pixel khác nhau ở mỗi sa bàn: khuôn viên QATD (sa bàn 673 m) và một
 * khuôn viên gấp đôi sẽ ra chữ to gấp đôi / bé một nửa. Buộc cỡ chữ vào cạnh sa
 * bàn giữ số PIXEL gần như không đổi — và pixel mới là thứ người ta đọc.
 *
 * Hai mẫu số đo trên khung mặc định 1280×720 (canvas 968×489, sa bàn 677×557 m):
 *   cụm 677/48 ≈ 14,1 m × 0,877 px/m ≈ **12,4 px**
 *   toà 677/62 ≈ 10,9 m × 0,877 px/m ≈ **9,6 px**
 */
const TI_LE_CHU_CUM = 1 / 48;
const TI_LE_CHU_TOA = 1 / 62;

export interface CanhVanHanh2DProps {
  may: readonly MayTrongLo[];
  /** Trạng thái ĐÃ xét tuổi, tra theo `machineId` — cùng nguồn với bản 3D. */
  trangThaiTheoMay: ReadonlyMap<number, string>;
  /**
   * ★★★ `machineId → MỨC TƯƠI của dữ liệu` — ô THỨ HAI của `trangThaiHienThi()`,
   * CÙNG bản đồ mà `hopNhatCanh.dungMayVe()` nhận cho bản 3D (commit `4482aaaaa`).
   *
   * ════════════════════════════════════════════════════════════════════════
   * VÌ SAO **MỨC** CHỨ KHÔNG PHẢI `bayGio` + `thoiDiemDuLieu`
   * ════════════════════════════════════════════════════════════════════════
   * Cám dỗ là cho component nhận `bayGio` rồi tự gọi `mauTheoTuoi(tt, ts, bayGio)`.
   * Làm vậy là buộc màu thành hàm của ĐỒNG HỒ: trang khai `Date.now()` MỖI
   * RENDER, nên `useMemo` dưới đây sẽ dựng lại bảng tra mỗi render — tức gọi
   * `getComputedStyle` lại từ đầu mỗi lần một gói socket về. `MucTuoi` chỉ có BA
   * giá trị, nên nó là phép **lượng tử hoá tự nhiên** của `bayGio`: bảng tra chỉ
   * đổi khi một máy thật sự VƯỢT NGƯỠNG — đúng lúc nó phải đổi.
   *
   * ⚠ Và KHÔNG áp lại luật `khong_ro` ở đây: `trangThaiHienThi` đã cưỡng chế nó ở
   *   tầng DỮ LIỆU. Máy `ngung_khai_thac` luôn mang `tuoi = "khong_ro"`, nên một
   *   nhánh thứ hai sẽ đẩy `doMo` 0,35 → 1 và xoá ý nghĩa "đã lùi khỏi tiền
   *   cảnh". Cả hai bề mặt đi qua CÙNG `apDungMucTuoi`, vốn chỉ mang MỘT luật.
   *
   * ⚠⚠ **TUỲ CHỌN, và đó là một khe hở có thật.** Bản đồ vắng ⇒ mọi máy coi như
   *   `tuoi` ⇒ không nhạt = hành vi trước bản vá. Bản 3D để trường này BẮT BUỘC
   *   đúng vì lý do ấy (`ThamSoMayVe.mucTuoiTheoMay`); ở đây không làm được vì
   *   `CanhVanHanh2D` còn được dựng ở `saBan2D.dom.test.tsx` với bộ props khác,
   *   và đổi chúng nằm ngoài phạm vi ghi của lượt này. Chỗ gọi sản phẩm là
   *   `TwinVanHanh.tsx` (`<CanhVanHanh2D`) — nó PHẢI truyền `mucTuoiTheoMay`,
   *   nếu không bản 2D vẫn nói "bình thường" về máy mà bản 3D đã nói "dữ liệu
   *   cũ". Lưới `tuoiDuLieuBan2D.dom.test.tsx` đo bề mặt này khi bản đồ CÓ được
   *   truyền; nó KHÔNG thay được một ca ghim chỗ gọi ở trang.
   */
  mucTuoiTheoMay?: ReadonlyMap<number, MucTuoi>;
  /** Mã máy để hiện nhãn + đọc bằng trình đọc màn hình. */
  maTheoMay: ReadonlyMap<number, string>;
  machineIdChon: number | null;
  onChonMay: (machineId: number | null) => void;
  sanRongM: number;
  sanSauM: number;
  /** Nhãn trạng thái ĐÃ qua `t()` — component không gọi `t()` (RB-8.3). */
  nhanTrangThai: (trangThai: string) => string;
  ariaLabel: string;
  /**
   * ★★★ SA BÀN QUY HOẠCH — **ĐƠN VỊ VẼ** của phạm vi tập đoàn.
   *
   * Không rỗng ⇒ cảnh 2D vẽ biểu tượng toà nhà và **bỏ** lớp khối máy, đúng
   * luật mà bản 3D (`CanhVanHanh` + `LopSaBan`) đã theo từ Task 20. Rỗng ⇒ cây
   * cũ y nguyên, không một thuộc tính nào đổi.
   *
   * Cùng mảng `dungSaBanVe()` mà bản 3D nhận — KHÔNG dựng bản thứ hai: hai bề
   * mặt đọc hai nguồn là cách chắc chắn nhất để chúng nói khác nhau về cùng một
   * khuôn viên.
   */
  saBan?: readonly BieuTuongToaVe[];
  /** Nền từng cụm (một cụm = một nhà máy) — đi kèm `saBan`. */
  saBanCum?: readonly CumSaBanVe[];
}

/** Lề quanh mặt sàn, mét — để máy sát mép không bị cắt. */
const LE_M = 2;

export function CanhVanHanh2D({
  may,
  trangThaiTheoMay,
  mucTuoiTheoMay = MUC_TUOI_2D_RONG,
  maTheoMay,
  machineIdChon,
  onChonMay,
  sanRongM,
  sanSauM,
  nhanTrangThai,
  ariaLabel,
  saBan = SA_BAN_2D_RONG,
  saBanCum = SA_BAN_2D_CUM_RONG,
}: CanhVanHanh2DProps) {
  const theme = useOptionalTheme();
  const toi = theme === "dark";

  /**
   * ★★★ SA BÀN **THAY** LỚP MÁY, KHÔNG ĐỨNG CẠNH NÓ.
   *
   * Suy từ ĐỘ DÀI chứ không từ một cờ riêng: một cờ tách "có dữ liệu" khỏi "vẽ
   * lớp nào" và mở đúng khe cho một cảnh TRẮNG im lặng (`CanhVanHanh.tsx` đã ghi
   * cùng lý lẽ cho bản 3D).
   */
  const veSaBan = saBan.length > 0;

  const chuCum = Math.max(sanRongM, sanSauM) * TI_LE_CHU_CUM;
  const chuToa = Math.max(sanRongM, sanSauM) * TI_LE_CHU_TOA;
  /*
   * Lề: sa bàn cần chỗ cho nhãn cụm nằm NGAY TRÊN tấm nền — cụm hàng đầu chỉ có
   * `vien = kheToa` phía trên và chữ sẽ bị cắt ở mép viewBox. Một dòng chữ rưỡi
   * là đủ, và nó lấy đi ~3 % bề rộng sa bàn — trả giá ít hơn hẳn một nhãn cụt.
   */
  const le = veSaBan ? Math.max(LE_M, chuCum * 1.6) : LE_M;
  const rong = Math.max(sanRongM, 10) + le * 2;
  const sau = Math.max(sanSauM, 10) + le * 2;

  /** Màu chữ + quầng chữ: quầng làm nhãn đọc được TRÊN CẢ nền cụm lẫn mặt sàn. */
  const mauChu = toi ? "#e2e8f0" : "#0f172a";
  const quangChu = toi ? "#0f172a" : "#ffffff";

  /**
   * Phân giải màu MỘT LẦN cho mỗi **TỔ HỢP** (trạng thái × mức tươi) xuất hiện,
   * không mỗi máy: mỗi lượt `giaiMauCanh` gọi `getComputedStyle`, và gọi nó 42
   * lần mỗi render là một reflow không cần thiết.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ 2026-09-18 — TRỤC THỨ HAI: TUỔI DỮ LIỆU (nối tiếp `4482aaaaa`)
   * ════════════════════════════════════════════════════════════════════════
   * Trước lượt này bảng tra chỉ có MỘT trục, nên bản 2D vẽ một máy im lặng 90
   * giây **giống hệt** một máy vừa gửi tín hiệu — trong khi bản 3D (từ
   * `4482aaaaa`) đã vẽ nó nhạt 40 %. Hai bề mặt của CÙNG một cảnh nói hai câu
   * khác nhau về cùng một máy, và bản 2D là đường DỰ PHÒNG khi WebGL hỏng
   * (`che2D = epChe2D || webglHong`), tức người dùng không rời khỏi nó được.
   *
   * ★ Vẫn là bảng tra theo TỔ HỢP, **không** phải bản đồ theo máy: số tổ hợp bị
   *   chặn trên bởi (số trạng thái × 3), còn số máy thì không — ở cấp tập đoàn
   *   đã đo được 1.108 máy. Lưới `tuoiDuLieuBan2D.dom.test.tsx` ĐẾM số lượt
   *   `giaiMauCanh` để câu này không trôi thành lời khai.
   * ★ `apDungMucTuoi` áp SAU `mauChoTrangThai`, trên KẾT QUẢ — y hệt `dungMayVe`:
   *   `doMo` 0,35 của `ngung_khai_thac` được NHÂN (giữ tỉ lệ), không bị đè.
   * ⚠ Khoá `useMemo` phải gồm `mucTuoiTheoMay`, nếu không bảng tra đóng băng ở
   *   mức tươi của lần dựng đầu và không máy nào bao giờ nhạt đi.
   */
  const mauTheoToHop = useMemo(() => {
    const m = new Map<string, { mau: string; doMo: number; gachCheo: boolean }>();
    for (const [machineId, tt] of trangThaiTheoMay) {
      const tuoi = mucTuoiTheoMay.get(machineId) ?? "tuoi";
      const khoa = khoaToHopMau(tt, tuoi);
      if (m.has(khoa)) continue;
      const kieu = apDungMucTuoi(mauChoTrangThai(tt), tuoi);
      m.set(khoa, {
        mau: giaiMauCanh(kieu.token) ?? "#94a3b8",
        doMo: kieu.doMo,
        gachCheo: kieu.hoaTiet === "gach_cheo",
      });
    }
    return m;
  }, [trangThaiTheoMay, mucTuoiTheoMay]);

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ NHÃN SA BÀN PHẢI BIẾT LỚP PHỦ DOM — ĐO TRƯỚC, SỐ Ở `nhanSaBan2D.ts`
   * ════════════════════════════════════════════════════════════════════════
   * Trước bản vá, nhãn cụm nằm cứng ở mép TRÊN tấm nền, và mép trên ấy là đúng
   * chỗ thẻ `Metrics` + dải trạng thái ngồi. Đo @1280×720 khung mặc định: tên
   * công ty đọc được `qatd_quanly` **0/1** · `qatd_congnhan` **0/1** ·
   * `qatd_kythuat` **0/2** — ba trong bốn vai không đọc được tên nào.
   *
   * ⚠ KHÔNG bê nguyên lớp né của `LopSaBan` sang: nó chỉ trượt DỌC, mà hai nhãn
   *   của `qatd_kythuat` nằm dưới `panel-trai`/`panel-phai` **cao suốt khung** —
   *   mô phỏng cho 0/2, y như chưa vá. Xem `.qa-tapdoan/n3-sim.mjs`.
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nhanRef = useRef<Map<string, SVGTextElement | null>>(new Map());
  /** factoryId → tên cụm, cho `<title>` của khối toà (đường đọc lại tên khi nhãn bị ẩn). */
  const tenCumTheoFactory = useMemo(
    () => new Map(saBanCum.map((c) => [c.factoryId, c.nhan])),
    [saBanCum],
  );
  const mucNhan = useMemo<MucNhan2D[]>(() => {
    if (!veSaBan) return [];
    return [
      ...saBanCum.map((c) => ({
        khoa: `cum-${c.factoryId}`,
        hopMo: {
          trai: c.viTri.x - c.co.rong / 2,
          phai: c.viTri.x + c.co.rong / 2,
          tren: c.viTri.z - c.co.sau / 2,
          duoi: c.viTri.z + c.co.sau / 2,
        },
        // Neo mặc định = mép TRÊN tấm nền, đúng chỗ bản chưa vá đặt.
        uuTien: "tren" as const,
      })),
      ...saBan.map((v) => ({
        khoa: `toa-${v.toaNhaId}`,
        hopMo: {
          trai: v.viTri.x - v.co.rong / 2,
          phai: v.viTri.x + v.co.rong / 2,
          tren: v.viTri.z - v.co.sau / 2,
          duoi: v.viTri.z + v.co.sau / 2,
        },
        // Nhãn toà vốn nằm GIỮA khối — giữ nguyên.
        uuTien: "trong" as const,
      })),
    ];
  }, [veSaBan, saBan, saBanCum]);
  const oNhin = useMemo(() => ({ x: -le, y: -le, rong, sau }), [le, rong, sau]);
  const datNhan = useDatNhanSaBan2D(svgRef, nhanRef, mucNhan, oNhin);
  /** Ghi `ref` của `<text>` theo khoá — hook đo hộp chữ bằng `getBBox()` trên chính nó. */
  const ghiNhan = (khoa: string) => (el: SVGTextElement | null) => {
    if (el) nhanRef.current.set(khoa, el);
    else nhanRef.current.delete(khoa);
  };
  /** Thuộc tính đặt/ẩn cho một nhãn — một chỗ, để hai loại nhãn không lệch nhau. */
  const theNhan = (khoa: string) => {
    const d = datNhan.doi.get(khoa);
    const an = datNhan.an.has(khoa);
    return {
      ref: ghiNhan(khoa),
      /*
       * ẨN bằng `visibility`, KHÔNG bằng `display`/không render: `getBBox()` của
       * một phần tử `display:none` trả 0 ở nhiều bộ dựng, và mất hộp chữ thì lượt
       * đo sau không bao giờ đặt lại được nhãn ấy — nó sẽ ở lì trạng thái ẩn kể
       * cả khi lớp phủ đã đi chỗ khác.
       */
      visibility: an ? ("hidden" as const) : undefined,
      "aria-hidden": an ? true : undefined,
      "data-an": an ? "1" : "0",
      transform: d ? `translate(${d.dx} ${d.dy})` : undefined,
    };
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${-le} ${-le} ${rong} ${sau}`}
      className="h-full w-full"
      role="img"
      aria-label={ariaLabel}
      data-testid="canh-van-hanh-2d"
      /*
       * ★★★ MÀN NÓI RA ĐƠN VỊ VẼ, không bắt người đọc suy từ số hình trên cảnh.
       *   Câu dành cho NGƯỜI nằm ở `banner-vi-tri-tam-sinh` và ở `aria-label`;
       *   thuộc tính này là bản dành cho PHÉP ĐO — nó cho nghiệm thu khẳng định
       *   "hai chế độ cùng đơn vị vẽ" bằng một giá trị đọc được, thay vì bằng
       *   một ấn tượng về ảnh chụp.
       */
      data-don-vi-ve={veSaBan ? "toa-nha" : "may"}
      onClick={(e) => {
        /*
         * Click nền = bỏ chọn.
         *
         * ⚠ Dòng chú thích cũ khai đây là *"cùng hành vi `onPointerMissed` của
         *   bản 3D"* — LỜI KHAI SAI suốt từ lúc viết: census lúc phân xử PH-41
         *   đếm được **0** điểm gắn `onPointerMissed` trên toàn cây `twin3d`.
         *   Bản 3D mới có hành vi ấy từ bản vá PH-41, ở ĐÚNG MỘT chỗ:
         *   `loi/LoBatchMay.tsx` (lưới `loi/bamNenBoChon.dom.test.tsx` ghim cả
         *   hành vi lẫn census "đúng một điểm gắn").
         *
         * ⚠ HAI BẢN KHÔNG KHỚP TUYỆT ĐỐI, và chỗ lệch là ngưỡng: bản 2D bỏ chọn
         *   với MỌI cú click rơi thẳng vào `<svg>` (không có ngưỡng kéo), còn bản
         *   3D chỉ bỏ chọn khi con trỏ dịch ≤ 2 px giữa pointerdown và click
         *   (hằng số nội bộ của R3F). Kéo xoay camera là cử chỉ chỉ có ở 3D, nên
         *   chênh lệch này là có lý do — nhưng nó là chênh lệch, không phải "cùng
         *   hành vi".
         */
        if (e.target === e.currentTarget) onChonMay(null);
      }}
    >
      <defs>
        {/*
          ★ NT-3 — HOẠ TIẾT GẠCH CHÉO cho `khong_ro`, y hệt bản 3D.
          Mã hoá dư thừa (§10.3 luật 2): người mù màu vẫn phân biệt được "không
          rõ" với "đang chạy" nhờ hoạ tiết, không chỉ nhờ sắc xám.
        */}
        <pattern id="twin-gach-cheo" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="currentColor" opacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" opacity="0.9" />
        </pattern>
      </defs>

      {/* Mặt sàn — xám trung tính (§10.1). */}
      <rect x="0" y="0" width={sanRongM} height={sanSauM} className="fill-muted/40 stroke-border" strokeWidth="0.1" />

      {/*
        ════════════════════════════════════════════════════════════════════════
        ★★★ SA BÀN QUY HOẠCH — ĐƠN VỊ VẼ CỦA PHẠM VI TẬP ĐOÀN
        ════════════════════════════════════════════════════════════════════════
        Số đo bắt bản vá này (trình duyệt thật, `?pv=tapdoan`, 1280×720, khung
        mặc định, canvas 968×489):

          bản 3D (sau Task 20) · 12 biểu tượng · rộng 56,5 .. 83,0 px · 15 nhãn
          bản 2D (trước đây)   · 1.108 khối máy · rộng **0,11 .. 3,95 px**
                                 (trung vị 1,32 px) · **1.108/1.108 dưới 4 px**
                                 · 0 nhãn · ảnh gần như ĐEN

        Đây là **cùng khuyết tật PH-44** mà Task 20 vá cho bản 3D, còn nguyên ở
        chế độ kia — không phải hai chế độ cố ý vẽ hai thứ. Đối chứng trên bản
        dựng TRƯỚC Task 20 cho trung vị **0,65 px** và 924/1.108 dưới 1 px, nên
        2D vốn đã hỏng ở cấp này; Task 20 không gây ra và cũng không chữa nó.

        ★ Phép chia quyết định giống hệt `saBanTapDoan`: muốn một vật thể rộng
          24 px trên 968 px thì trường nhìn phải ≤ 81 m. Khuôn viên là 673 m
          (2.240 m trước khi sa bàn nén). Không khung nhìn nào bù nổi 8,3 lần —
          **phải vẽ ít vật thể hơn và to hơn**.

        ★★★ VÌ SAO KHÔNG CHỌN "GIỮ MÁY + THÊM MỘT CÂU GIẢI THÍCH": bản 2D là
          đường DỰ PHÒNG khi WebGL hỏng (`che2D = epChe2D || webglHong`, và nút
          chuyển `disabled={webglHong}`). Lúc ấy người dùng không rời khỏi nó
          được, nên một lời khai trung thực về một ô đen vẫn để họ ở lại với một
          ô đen.

        ⚠ THAY, không ĐỨNG CẠNH: vẽ cả hai là tự mâu thuẫn — nhãn máy lơ lửng
          trên một khối nhà mà không bấm được vào máy nào (nguyên văn lý lẽ của
          `LopSaBan.tsx` cho bản 3D).
      */}
      {veSaBan ? (
        <g
          data-testid="lop-sa-ban-2d"
          data-so-toa={saBan.length}
          data-so-cum={saBanCum.length}
          /*
            ★★★ NHÃN BỊ ẨN PHẢI ĐƯỢC ĐẾM RA — cùng hợp đồng `__demSaBan.soNhan()`
              của bản 3D, nhưng ở đây là THUỘC TÍNH DOM chứ không phải cửa sổ đo:
              số của bản 2D chỉ đổi khi bố cục đổi (không phải mỗi khung), và một
              thuộc tính đọc được KHÔNG cần `?do=1` thì mọi phép đo đều thấy.
              Một nhãn biến mất im lặng là lời khai sai (§4).
          */
          data-nhan-ve={datNhan.dem.ve}
          data-nhan-an={datNhan.dem.an}
          data-nhan-tong={datNhan.dem.tong}
        >
          {/*
            ★★★ ẨN PHẢI CÓ ĐƯỜNG ĐỌC LẠI — `<title>` LÀ ĐƯỜNG ẤY.
            ────────────────────────────────────────────────────────────────
            `datNhanSaBan` chứng minh được bằng phép chia rằng ở `qatd_admin`
            (5 cụm) **tối đa 2/5 tên cụm có chỗ sạch**: `panel-trai`/`panel-phai`
            cao suốt khung, và dải ngang của tấm nền không nằm dưới panel hẹp hơn
            chính cái tên (thiếu 25,3 / 58,8 / 89,8 px). Ẩn là kết cục ĐÚNG — số
            đã được ĐẾM RA ở `data-nhan-an`. Nhưng "đếm ra" mới là trung thực với
            phép đo, chưa trung thực với NGƯỜI DÙNG: họ thấy một tấm nền không tên
            và không có cách nào biết nó là công ty nào.

            ⇒ `<title>` trên CHÍNH tấm nền và CHÍNH khối toà: di chuột là đọc được
              tên, dù nhãn có được vẽ hay không. Chọn `<title>` chứ không phải một
              con chip "còn N tên bị ẩn" là một QUYẾT ĐỊNH có lý do đo được: chip
              là một LỚP PHỦ MỚI trong đúng một cảnh vừa được chứng minh là hết
              chỗ — nó sẽ tự ăn thêm nhãn, đúng lớp hazard mà bản vá trước đã phải
              trả giá (nhãn đè nhãn 1 → 5 cặp).
            ⚠ Khối toà vẽ ĐÈ LÊN tấm nền, nên phần nền còn thò ra khỏi panel có thể
              bị chính khối toà chiếm; vì thế khối toà mang tên CỤM kèm tên toà,
              nếu không thì cụm `qatd_admin`/`Công ty A` (dải thò ra chỉ 19,4 px và
              bị hai khối toà phủ kín) sẽ không di chuột vào đâu được.
          */}
          {/* Nền cụm TRƯỚC — vẽ sau biểu tượng thì tấm nền đè mất chính thứ nó nền cho. */}
          {saBanCum.map((c) => (
            <rect
              key={`cum-${c.factoryId}`}
              data-testid="cum-2d-sa-ban"
              data-factory-id={c.factoryId}
              x={c.viTri.x - c.co.rong / 2}
              y={c.viTri.z - c.co.sau / 2}
              width={c.co.rong}
              height={c.co.sau}
              fill={(toi ? NEN_CUM_TOI : NEN_CUM_SANG)[c.chiSoCum % NEN_CUM_SANG.length]}
            >
              <title>{c.nhan}</title>
            </rect>
          ))}
          {saBan.map((v) => (
            <rect
              key={`toa-${v.toaNhaId}`}
              data-testid="toa-2d-sa-ban"
              data-toa-nha-id={v.toaNhaId}
              data-factory-id={v.factoryId}
              data-chi-so-cum={v.chiSoCum}
              /*
                ★ Nhìn TỪ TRÊN XUỐNG: trục dọc của màn là `z` của scene — đúng
                  phép chiếu mà lớp máy phía dưới đã dùng (`translate(x z)`).
                  `co.cao` (chiều đứng) cố ý KHÔNG dùng: mặt bằng không có nó.
              */
              x={v.viTri.x - v.co.rong / 2}
              y={v.viTri.z - v.co.sau / 2}
              width={v.co.rong}
              height={v.co.sau}
              fill={toi ? MAU_BIEU_TUONG_TOA.toi : MAU_BIEU_TUONG_TOA.sang}
              stroke={quangChu}
              strokeWidth={Math.max(v.co.rong, v.co.sau) * 0.012}
            >
              <title>{nhanKhoiCoCum(tenCumTheoFactory.get(v.factoryId), v.nhan)}</title>
            </rect>
          ))}
          {/*
            Nhãn SAU hình — chữ nằm dưới khối là chữ không đọc được.
            `paint-order: stroke` cho quầng chữ chạy TRƯỚC nét chữ, nên chữ đọc
            được trên cả nền cụm sáng lẫn mặt sàn tối mà không cần một tấm nền
            riêng (tấm nền lại che mất biểu tượng bên dưới).
          */}
          {saBanCum.map((c) => (
            <text
              key={`nhan-cum-${c.factoryId}`}
              {...theNhan(`cum-${c.factoryId}`)}
              data-testid="nhan-cum-sa-ban-2d"
              data-factory-id={c.factoryId}
              x={c.viTri.x}
              y={c.viTri.z - c.co.sau / 2 - chuCum * 0.45}
              textAnchor="middle"
              fontSize={chuCum}
              fontWeight={600}
              fill={mauChu}
              stroke={quangChu}
              strokeWidth={chuCum * 0.26}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {c.nhan}
            </text>
          ))}
          {saBan.map((v) => (
            <text
              key={`nhan-toa-${v.toaNhaId}`}
              {...theNhan(`toa-${v.toaNhaId}`)}
              data-testid="nhan-toa-sa-ban-2d"
              data-toa-nha-id={v.toaNhaId}
              x={v.viTri.x}
              y={v.viTri.z + chuToa * 0.36}
              textAnchor="middle"
              fontSize={chuToa}
              fill={mauChu}
              stroke={quangChu}
              strokeWidth={chuToa * 0.26}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {v.nhan}
            </text>
          ))}
        </g>
      ) : null}

      {veSaBan ? null : may.map((m) => {
        const tt = trangThaiTheoMay.get(m.machineId) ?? "khong_ro";
        /*
         * ⚠ Mặc định `"tuoi"` (KHÔNG nhạt) chứ không phải `"cu"`: máy vắng khỏi
         *   bản đồ mức tươi là máy ta KHÔNG BIẾT tuổi, và vẽ nó nhạt là khẳng
         *   định một điều chưa đo được. Luật "không biết" đã do `trangThaiTheoMay`
         *   mang (`khong_ro`) — đúng chỗ nó được cưỡng chế. Cùng mặc định mà
         *   `dungMayVe` dùng cho bản 3D.
         */
        const tuoi = mucTuoiTheoMay.get(m.machineId) ?? "tuoi";
        const kieu = mauTheoToHop.get(khoaToHopMau(tt, tuoi)) ?? {
          mau: "#94a3b8",
          doMo: 1,
          gachCheo: true,
        };
        const rongM = mmSangMet(m.kichThuocMm.rongMm);
        const sauM = mmSangMet(m.kichThuocMm.sauMm);
        const daChon = m.machineId === machineIdChon;
        const ma = maTheoMay.get(m.machineId) ?? `#${m.machineId}`;

        return (
          <g
            key={m.machineId}
            transform={`translate(${m.viTri.x} ${m.viTri.z}) rotate(${(-m.gocXoayRad * 180) / Math.PI})`}
            data-testid={`may-2d-${m.machineId}`}
            data-trang-thai={tt}
            style={{ cursor: "pointer" }}
            onClick={() => onChonMay(m.machineId)}
          >
            <rect
              x={-rongM / 2}
              y={-sauM / 2}
              width={rongM}
              height={sauM}
              fill={kieu.mau}
              fillOpacity={kieu.doMo}
              stroke={daChon ? "currentColor" : kieu.mau}
              strokeWidth={daChon ? 0.28 : 0.05}
            />
            {/* Lớp hoạ tiết chồng lên — chỉ cho `khong_ro`. */}
            {kieu.gachCheo ? (
              <rect
                x={-rongM / 2}
                y={-sauM / 2}
                width={rongM}
                height={sauM}
                fill="url(#twin-gach-cheo)"
                color={kieu.mau}
                pointerEvents="none"
              />
            ) : null}
            {/* Trình đọc màn hình đọc được TỪNG máy — không chỉ tóm tắt cả cảnh. */}
            <title>{`${ma} — ${nhanTrangThai(tt)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export default CanhVanHanh2D;
