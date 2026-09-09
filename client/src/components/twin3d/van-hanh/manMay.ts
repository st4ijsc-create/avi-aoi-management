/**
 * ════════════════════════════════════════════════════════════════════════════
 * `manMay.ts` — LÁT THUẦN của **màn MÁY riêng** (`/twin/may/:id`, QĐ-19/QĐ-21)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đợt 31 dựng màn Máy thành **màn riêng, canvas riêng** (QĐ-19), theo đúng khuôn
 * `manLine.ts` của Đợt 30. Tệp này giữ đúng phần **KHÔNG có sẵn ở đâu** — phần
 * lắp ráp riêng của cấp Máy — và **không** viết lại thứ đã nghiệm thu:
 *
 *   ĐÃ CÓ, DÙNG LẠI (G12 — không có phép tính thứ hai):
 *     · `manLine.idLineTuDuongDan` — đọc `:id` (CÙNG luật, xem ①)
 *     · `manLine.mayCuaLine`       — tập máy của một chuyền (TRẠM thắng `lineId`)
 *     · `cayVanHanh.lineCuaMay`    — máy → trạm → chuyền
 *     · `hopNhatCanh.dungMayVe` / `dungNhanMay` / `dungCanhBao3D`
 *     · `phamViCanh.khungNhinCho`  — camera cấp `may` (≤ 8 m, §10C.2)
 *     · `sucKhoeMay.hangSucKhoe` / `vienSucKhoe` — vòng viền đế (A-4)
 *     · `nhungTaiCho.lyDoNganNhung` — BA lý do L-5, không đẻ nhánh thứ tư
 *
 *   TỆP NÀY LÀM, và chỉ làm bấy nhiêu:
 *     · `idMayTuDuongDan`   — đọc `:id` đã bắt được thành số, an toàn
 *     · `phamViCuaManMay`   — khớp nối sang `trongPhamVi` (G93, đo bằng GIÁ TRỊ)
 *     · `lineCuaMayTheoTram`— chuyền của máy, cho breadcrumb `‹ Line N`
 *     · `mayHangXom`        — máy ĐÍCH + hàng xóm cùng chuyền (định vị, §15.3.3)
 *     · `mucTieuTrongCanh`  — khối ĐÃ DỰNG của máy đích (neo nhãn/viền/camera)
 *     · `khungNhinMay`      — camera orbit gần quanh MỘT máy
 *     · `tomTatMay`         — chip (B): mã · loại · sức khoẻ % + hạng
 *     · `lyDoMoManMay`      — vì sao màn mở được / không (L-5, ba câu)
 *
 *   ⛔ **KHÔNG** có WIP, KHÔNG đếm chạy/dừng, KHÔNG đường tâm chuyền: cấp Máy
 *      trả lời *"máy này thế nào"*, không phải *"chuyền chảy ra sao"*. Lưới ⑦
 *      ở `manMay.unit.test.ts` ghim danh sách khoá ĐÓNG của `TomTatMay`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÀ HÀM THUẦN, NHẬN QUA THAM SỐ — **G37**
 * ════════════════════════════════════════════════════════════════════════════
 * Không hàm nào ở đây gọi `useRoute()`/`useSearch()`. Một màn tự đọc route
 * **hỏng CÂM** khi đặt ngoài route của nó: `id` ra `NaN`, không exception nào
 * nổ, người xem thấy một máy RỖNG thay vì một lỗi. `RobotCockpit`/
 * `StationAnalysis` đã dính đúng lớp ấy — và chính `MachineCockpit.tsx:1216`
 * vẫn còn `Number(params?.id)` (nó được cứu vì `MachineCockpitBody` tự kiểm
 * `validId`). Trang cha bắt `:id`, gọi `idMayTuDuongDan` một lần, truyền số xuống.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G93 — TÁCH RA LÀ **MUA THÊM MỘT BỀ MẶT LỖI Ở KHỚP NỐI**
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 29 đo được ba đột biến ở **chỗ gọi** sống sót cả 1.998 test. Nên tệp này
 * đi kèm **hai** lưới:
 *   · `manMay.unit.test.ts`          — hàm đúng không
 *   · `manMayNoiVaoTrang.unit.test.ts` — **trang gọi bằng đối số nào**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ KHÔNG TRÙNG VIỆC VỚI `/machine/:id` — §11b, ĐỌC TRƯỚC KHI XOÁ
 * ════════════════════════════════════════════════════════════════════════════
 * `/machine/:id` (`App.tsx`, `MachineCockpit.tsx` 1.220 dòng) là **cockpit 2D
 * toàn trang** (`DashboardLayout`), và với `isWorkspaceShellEnabled()` nó
 * **redirect** sang `/device-monitor?machine=` (Machine Workspace). Màn
 * `/twin/may/:id` là **3D định vị + cockpit NHÚNG + `NganXuLy`** — nó **dùng**
 * `MachineCockpitBody` chứ không thay thế nó. Hai thứ KHÁC NHAU; tên gần nhau
 * là lý do đúng để ghi dòng này, không phải lý do để xoá một trong hai.
 */

import { idLineTuDuongDan, mayCuaLine, type MayThuocLine, type TramCuaLine } from "./manLine";
import { lineCuaMay } from "./cayVanHanh";
import type { PhamVi } from "./duongDanTwin";
import {
  bboxCuaTap,
  khungNhinCho,
  KHOANG_CACH_TOI_DA_CAP_MAY,
  type KhungNhin,
} from "./phamViCanh";
import { hangSucKhoe, type HangSucKhoe, type KhaiSucKhoe, type MucKhanBaoTri } from "./sucKhoeMay";
import { lyDoNganNhung, type CanhXetNgan, type LyDoNgan } from "./nhungTaiCho";
import { mmSangMet } from "../heToaDo";

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① ĐỌC `:id` — CÙNG LUẬT VỚI CHUYỀN, MỘT CÀI ĐẶT (G12)                        */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * `:id` của `/twin/may/:id` → số, hoặc `null`.
 *
 * ★★★ UỶ THÁC THẲNG cho `idLineTuDuongDan` — KHÔNG chép lại. `machines.id` và
 *   `production_lines.id` cùng là `serial` nguyên dương; luật đọc (chỉ chữ số,
 *   an toàn, > 0, từ chối `"0x2"`/`"2e3"`/`"2.5"`/`"+2"`) là **một luật**. Hai
 *   bản cài đặt hiếm khi chỉ lệch một chỗ (G12), và lưới ① của tệp test đối
 *   chiếu hai hàm trên CÙNG bảng mẫu để ai tách chúng ra phải làm lưới ĐỎ.
 *
 * ★ Vì sao vẫn có TÊN riêng: trang Máy đọc `idMayTuDuongDan`, không đọc một
 *   hàm mang chữ "Line" — tên sai làm người sau tưởng trang này đọc id chuyền.
 */
export function idMayTuDuongDan(tho: string | undefined | null): number | null {
  return idLineTuDuongDan(tho);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② KHỚP NỐI SANG `dungMayVe` — **G93**, ĐO ĐƯỢC BẰNG GIÁ TRỊ                   */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Phạm vi mà màn Máy truyền cho `trongPhamVi` khi dựng cảnh.
 *
 * `trongPhamVi` ở cấp `may` so `v.machineId === pv.id` (`phamViCanh.ts:70`):
 * máy ĐÍCH giữ màu thật, **hàng xóm pha về nền 72 %** (`dungMayVe` +
 * `TI_LE_PHA_NGOAI_PHAM_VI`) — đúng Hình C §15.3.3: *"hàng xóm của máy VẪN
 * THẤY (định vị)"*, và đúng cách `/twin?pv=may:…` đang làm.
 *
 * ★★★ HAI ĐỘT BIẾN MÀ HÀM NÀY BẮT, VÀ MỘT LƯỚI VĂN BẢN THÌ KHÔNG:
 *   ① `cap: "may"` → `cap: "line"`: mọi hàng xóm cùng chuyền thành "trong
 *      phạm vi" ⇒ máy đích **không còn nổi bật** giữa 12 khối cùng màu — cảnh
 *      vẫn "hợp lý", không ảnh nào kêu.
 *   ② `id: machineId` → `id: null`: `trongPhamVi` trả `true` vô điều kiện
 *      (`phamViCanh.ts:59`) — cùng hậu quả, câm hơn.
 */
export function phamViCuaManMay(machineId: number): PhamVi {
  return { cap: "may", id: machineId };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ CHUYỀN CỦA MÁY — cho breadcrumb `‹ Nhà máy › Line N › Máy`                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Chuyền của một máy. **TRẠM THẮNG `lineId` KHAI** — cùng luật với
 * `manLine.mayCuaLine`, vì `machines` **không có cột `lineId`** (đo 2026-09-09):
 * trường ấy trên client là giá trị đã suy, còn `stations.lineId` có khoá ngoại.
 *
 * ★ Đường trạm đi qua `cayVanHanh.lineCuaMay` (G12); chỉ khi trạm KHÔNG tra ra
 *   chuyền mới rơi về `m.lineId` — máy chưa gán trạm nhưng đã gán chuyền vẫn
 *   phải có nút `‹ Line N` (bỏ nó là khai thiếu đường ra, NT-3).
 *
 * @returns `null` khi không tìm thấy máy, hoặc máy không thuộc chuyền nào.
 */
export function lineCuaMayTheoTram(
  machineId: number,
  may: readonly MayThuocLine[],
  tram: readonly TramCuaLine[],
): number | null {
  const m = may.find((x) => x.id === machineId);
  if (!m) return null;
  const stationCuaMay = new Map<number, number | null>([[m.id, m.stationId ?? null]]);
  const lineCuaTram = new Map<number, number>();
  for (const s of tram) if (s.lineId != null) lineCuaTram.set(s.id, s.lineId);
  return lineCuaMay(machineId, stationCuaMay, lineCuaTram) ?? m.lineId ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ TẬP MÁY VẼ — máy đích + HÀNG XÓM cùng chuyền                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Máy để dựng trên cảnh của màn Máy: **máy đích + mọi máy cùng chuyền**.
 *
 * ★★★ VÌ SAO KHÔNG CHỈ MỘT MÁY, VÀ VÌ SAO KHÔNG CẢ NHÀ MÁY.
 *   · Chỉ một máy ⇒ mất **định vị** — §14.8: *"3D được biện minh cho ĐỊNH VỊ"*;
 *     một khối đứng giữa sàn trống không nói máy này ở ĐÂU. Hình C §15.3.3
 *     vẽ rõ *"hàng xóm của máy VẪN THẤY"*.
 *   · Cả nhà máy ⇒ đúng lỗi **F2** ở dạng khác: 31 máy chuyền khác dựng thành
 *     khối lạ quanh máy đang xem (đo 2026-09-09: 43 máy, chuyền 2 có 12).
 *
 * ★ Máy đích **LUÔN có mặt** kể cả khi không thuộc chuyền nào (chưa gán trạm):
 *   `mayCuaLine(null, …)` trả `[]`, và nếu tin nó thì máy đích biến mất khỏi
 *   chính màn của nó — một màn Máy không có máy, không lỗi nào nổ.
 *
 * @returns `[]` khi máy đích KHÔNG có trong `may` — trang rẽ nhánh L-5.
 */
export function mayHangXom<T extends MayThuocLine>(
  machineId: number,
  may: readonly T[],
  tram: readonly TramCuaLine[],
): T[] {
  const dich = may.find((m) => m.id === machineId);
  if (!dich) return [];
  const lineId = lineCuaMayTheoTram(machineId, may, tram);
  const cungChuyen = mayCuaLine(lineId, may, tram);
  return cungChuyen.some((m) => m.id === machineId) ? cungChuyen : [dich, ...cungChuyen];
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ MÁY ĐÍCH ĐÃ DỰNG — neo cho nhãn, viền, cảnh báo, camera                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Khối đã dựng, đúng phần cấp Máy đọc — khớp `MayDaDung`/`MayTrongLo` mà không nhập. */
export interface KhoiMayDaDung {
  machineId: number;
  /** Hệ CẢNH (mét), đã hoán vị trục — **`y` là ĐỘ CAO** (`heToaDo.ts`). */
  viTri: { x: number; y: number; z: number };
  kichThuocMm: { rongMm: number; caoMm: number; sauMm: number };
}

/**
 * Khối ĐÃ DỰNG của máy đích trong tập `mayVe`, hoặc `null` khi máy chưa có chỗ
 * trên bố cục (`dungMayVe` bỏ máy không có hàng đặt chỗ / `hienThi=false`).
 *
 * ★ Nhãn, badge, viền và camera của màn Máy đều neo vào **`[mucTieu]`**, không
 *   vào `mayVe`: §15.6.2 cấp Máy có trần **≤ 3** thứ neo — tên + cảnh báo +
 *   viền — và *"thừa ngân sách KHÔNG phải lý do để tiêu"*. Hàng xóm đọc bằng
 *   màu pha, không bằng nhãn.
 */
export function mucTieuTrongCanh<T extends { machineId: number }>(
  mayVe: readonly T[],
  machineId: number,
): T | null {
  return mayVe.find((m) => m.machineId === machineId) ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ CAMERA — orbit GẦN quanh một máy (§10C.2 cấp `may`, ≤ 8 m)                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ HỆ SỐ LÙI THÊM cho camera màn Máy — ĐO ĐƯỢC, không phải thẩm mỹ.
 *
 * Nghiệm thu ảnh lần đầu (2026-09-09, `dist`, 1600×900, máy 14): với
 * `khungNhinCho(bbox, "may")` nguyên bản (`HE_SO_LUI.may = 1.1`) camera cách
 * tâm máy ~2 m; khối 1,8 m **bị cắt nóc** và nhãn tên trên nóc (`neoTrenNoc`
 * + `HO_NHAN_MAY`) nằm NGOÀI khung ⇒ `LopNhan` declutter ẩn nó, chip
 * *"1 more names hidden"* hiện ra — màn Máy **mất 1/3 thứ neo** của §15.6.1
 * (tên · badge · viền). Hình học: FOV dọc của `KhungCanh` là **45°**
 * (`KhungCanh.tsx:207`), nửa góc 22,5°; ở 2 m nhãn lệch trục nhìn ~40°.
 *
 * ⇒ Lùi camera thêm theo hệ số này (giữ NGUYÊN mục nhìn và hướng nhìn, chỉ
 *   nhân véc-tơ lùi), rồi vẫn kẹp từng trục ≤ `KHOANG_CACH_TOI_DA_CAP_MAY`.
 *   Không sửa `HE_SO_LUI.may`: hằng ấy dùng chung với `/twin?pv=may` (canvas
 *   lớn, tỉ lệ khác) — đổi là đổi cả hai màn. Lưới ⑥ tính GÓC của 8 đỉnh khối
 *   + điểm nhãn nóc so với trục nhìn và đòi < 22,5° — tức là cả máy lẫn nhãn
 *   nằm trong nón FOV với MỌI tỉ lệ canvas ≥ 1:1.
 */
export const HE_SO_NOI_KHUNG_MAY = 2.2;

/**
 * Khung nhìn cho MỘT máy.
 *
 * ★ Uỷ thác cho `khungNhinCho(bbox, "may")` — nơi `HE_SO_LUI.may`/`HE_SO_CAO.may`
 *   và trần `KHOANG_CACH_TOI_DA_CAP_MAY = 8` sống (G12). Bbox dựng bằng
 *   `bboxCuaTap` từ tâm đáy + kích thước **quy về mét**; sau đó lùi thêm theo
 *   {@link HE_SO_NOI_KHUNG_MAY} và kẹp lại trần 8 m.
 *
 * ⚠⚠ BẪY HOÁN VỊ TRỤC: `viTri` của khối đã ở hệ cảnh (**`y` = độ cao**), nên
 *   truyền thẳng làm `tam`. Ai "sửa" thành `{x, y: viTri.z, z: viTri.y}` sẽ
 *   đặt camera nhìn vào một điểm dưới sàn — cảnh vẫn vẽ, không gì nổ. Lưới
 *   ghim `muc[1]` = độ cao tâm khối.
 *
 * @returns `null` khi chưa có khối (máy chưa đặt chỗ) — trang GIỮ camera, không
 *   bay tới `Infinity` (G8).
 */
export function khungNhinMay(
  mucTieu: KhoiMayDaDung | null,
  heSoNoi: number = HE_SO_NOI_KHUNG_MAY,
): KhungNhin | null {
  if (!mucTieu) return null;
  const bbox = bboxCuaTap([
    {
      tam: mucTieu.viTri,
      co: {
        rong: mmSangMet(mucTieu.kichThuocMm.rongMm),
        cao: mmSangMet(mucTieu.kichThuocMm.caoMm),
        sau: mmSangMet(mucTieu.kichThuocMm.sauMm),
      },
    },
  ]);
  const k = khungNhinCho(bbox, "may");
  if (!k) return null;
  const kep = (d: number) =>
    Math.sign(d) * Math.min(Math.abs(d) * heSoNoi, KHOANG_CACH_TOI_DA_CAP_MAY);
  return {
    muc: k.muc,
    viTri: [
      k.muc[0] + kep(k.viTri[0] - k.muc[0]),
      k.muc[1] + kep(k.viTri[1] - k.muc[1]),
      k.muc[2] + kep(k.viTri[2] - k.muc[2]),
    ],
    banKinh: k.banKinh * heSoNoi,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑦ TÓM TẮT — chip (B) của §15.6.1 cấp Máy                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Danh tính máy, đúng phần chip cần. */
export interface DanhTinhMay {
  id: number;
  ma: string;
  ten: string;
  loaiMay: string;
}

export interface TomTatMay {
  ma: string;
  ten: string;
  loaiMay: string;
  /** Hạng qua `hangSucKhoe` — `chua_do` khi KHÔNG có lời khai nào cho máy này. */
  hangSucKhoe: HangSucKhoe;
  /** `healthScore` nguyên văn, `null` = chưa đo — **KHÔNG** `0`. */
  diem: number | null;
  nguyCo: number | null;
  mucKhan: MucKhanBaoTri | null;
  /** Mốc lời khai (ms) để chip nói được *"đo lúc …"*; `null` = không rõ. */
  mocMs: number | null;
}

/**
 * Chip trái nhóm (B): `mã · loại · sức khoẻ % + hạng`.
 *
 * ★★★ KHÔNG có `NG 24h` — §15.6.1 ⁽²⁾ đo được `product_inspections` **2.880/2.880
 *   `factoryCode` NULL** ⇒ rỗng với mọi vai không-admin; và `NganXuLy` đã hiện
 *   `dashboard.getMachineStats` (`NganXuLy.tsx:247`) — một chip thứ hai cho cùng
 *   con số là **D-5** (hai bản đếm, hai cơ hội lệch). KHÔNG có *xu hướng 24h* —
 *   C-9 **CHƯA có** nguồn.
 *
 * ★ Hạng đi qua `hangSucKhoe` — CÙNG hàm với vòng viền đế, để chip nói
 *   `nguy_kích` đúng khi viền đỏ (G12). `diem` giữ nguyên văn kể cả khi
 *   `het_han`: chip in *"31 % · quá hạn"* thay vì giấu con số — người vận hành
 *   cần thấy cả số lẫn lý do không tin nó.
 *
 * @returns `null` khi chưa có danh tính máy (đang tải / không tìm thấy).
 */
export function tomTatMay(
  may: DanhTinhMay | null,
  khai: readonly KhaiSucKhoe[],
  bayGio: number,
): TomTatMay | null {
  if (!may) return null;
  const k = khai.find((x) => x.machineId === may.id) ?? null;
  return {
    ma: may.ma,
    ten: may.ten,
    loaiMay: may.loaiMay,
    hangSucKhoe: k ? hangSucKhoe(k, bayGio) : "chua_do",
    diem: k?.diem ?? null,
    nguyCo: k?.nguyCo ?? null,
    mucKhan: k?.mucKhan ?? null,
    mocMs: k?.mocMs ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑧ VÌ SAO MÀN MỞ ĐƯỢC / KHÔNG — L-5, BA CÂU, KHÔNG NHÁNH IM LẶNG THỨ TƯ        */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Lý do màn Máy mở được (`mo`) hay không (`ngoaiPhamVi` / `thieuQuyen`).
 *
 * ★★★ §15.3.3 L-5 bắt buộc: *"Cấp Máy mới phải dùng lại ĐÚNG ba lý do đó,
 *   không đẻ nhánh im lặng thứ tư."* Nên hàm này **uỷ thác** cho
 *   `lyDoNganNhung` với `{ loai: "machine" }` — cùng thứ tự kiểm (đang tải ⇒
 *   `mo` · có trong tập ⇒ `mo` · phạm vi rỗng ⇒ `thieuQuyen` · còn lại ⇒
 *   `ngoaiPhamVi`), cùng câu (`cauChoLyDoNgan`). Một `machineId` không có trong
 *   nhà máy đang xem KHÔNG được thành một màn trống câm.
 */
export function lyDoMoManMay(machineId: number, canh: CanhXetNgan): LyDoNgan {
  return lyDoNganNhung({ loai: "machine", id: machineId }, canh) ?? "mo";
}
