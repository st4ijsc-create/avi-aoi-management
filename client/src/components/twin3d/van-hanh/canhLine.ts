/**
 * `canhLine.ts` — T-2 (§15.5.2), lát **dẫn xuất cảnh của cấp LINE**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÁT NÀY ĐƯỢC TÁCH RA, CÒN CẢ T-2 THÌ KHÔNG
 * ════════════════════════════════════════════════════════════════════════════
 * §15.5.2 hình dung T-2 là MỘT hook `useCanhVe` gom `mayVe` + `hinhLine` +
 * `bangWip` + `cotWipCanh`. Đo lại trên mã thật (Đợt 27) thì ba thứ kia còn
 * dính vào chuỗi truy vấn xếp tầng của trang, nhưng **`hinhLine` thì không**:
 * nó chỉ cần **dữ liệu thuần** — danh sách trạm, danh sách máy đã tính vị trí,
 * bảng đặt chỗ — và **không đụng React, không đụng route, không đụng `trpc`**.
 *
 * ⇒ Đây đúng là mảnh mà **màn LINE** (`/twin/line/:id`, QĐ-19) cần. Tách nó ra
 *   dạng HÀM THUẦN cho phép cả ba màn dùng chung **một** phép dựng hình học
 *   Line, thay vì màn mới chép lại phép tính thứ hai (**G12**).
 *
 * ★ `hinhHocLine` (`phamViLine.ts:164`) **đã có và đã test** — tệp này KHÔNG
 *   tính lại hình học. Nó chỉ làm phần **lắp ráp**: từ trạm/máy của trang, dựng
 *   hai mảng `ViTriDaDat` rồi giao cho `hinhHocLine`. Ranh giới đó có chủ ý:
 *   toán hình học ở một chỗ, luật chọn-điểm-neo ở chỗ này.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ LUẬT "TRẠM CHƯA CÓ ĐẶT CHỖ" — GIỮ NGUYÊN, KHÔNG PHẢI PHÁT MINH LẠI
 * ════════════════════════════════════════════════════════════════════════════
 * Một trạm chưa được đặt chỗ trong `twin_dat_cho` vẫn phải nằm trên đường tâm
 * Line: suy tâm từ **máy của chính trạm đó**. Bỏ trạm ấy đi sẽ làm đường tâm
 * **đứt quãng mà không nói vì sao** — người xem tưởng chuyền thiếu trạm. Đây là
 * hành vi nguyên bản của `TwinVanHanh.tsx` và được bê nguyên sang (G5/G32:
 * refactor đúng thì đầu ra KHÔNG khác đầu vào).
 */

import { hinhHocLine, type HinhHocLine, type ViTriDaDat } from "../phamViLine";
import { mmSangMet } from "../heToaDo";

/**
 * Một chỗ đã đặt trong `twin_dat_cho` — chỉ những trường lát này cần.
 *
 * ★ Ba toạ độ khai `number` chứ KHÔNG `number | string`: hợp đồng
 *   `twinCanh.canhThietKe` trả số, và `mmSangMet` nhận `number`. Nới kiểu ở đây
 *   để "cho chắc" sẽ đẩy một `parseFloat` ngầm vào lát này — đúng chỗ một chuỗi
 *   rác biến thành `NaN` toạ độ mà không lỗi nào nổ.
 */
export interface DatChoTho {
  loaiThucThe: string;
  thucTheId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
}

/** Trạm trong cảnh thiết kế. */
export interface TramTho {
  id: number;
  lineId?: number | null;
  thuTu?: number | null;
}

/** Máy ĐÃ tính được vị trí trên cảnh (kết quả của `mayVe`). */
export interface MayCoViTri {
  machineId: number;
  viTri: { x: number; y: number; z: number };
}

/** Tra cứu line/trạm của một máy — trang lấy từ `mayVanHanh`. */
export interface ThuocVeMay {
  id: number;
  lineId?: number | null;
  stationId?: number | null;
}

export interface HinhLine {
  hh: HinhHocLine;
  tram: ViTriDaDat[];
}

/**
 * Tuỳ chọn dựng hình Line.
 *
 * ★★★ `boQuaDatCho` — CHO CHẾ ĐỘ SƠ ĐỒ (`soDoLine.ts`), KHÔNG PHẢI MỘT CÔNG TẮC TIỆN TAY.
 *
 * Khi màn Line trải máy thành **sơ đồ**, vị trí máy trên cảnh không còn là toạ độ đặt chỗ. Tâm
 * trạm thì vẫn đọc từ `twin_dat_cho` — tức **THẬT**. Hai hệ toạ độ trong cùng một cảnh, và hậu
 * quả không nổ một lỗi nào: cột WIP và mũi tên dòng chảy đứng ở chỗ THẬT của trạm, cách xa hàng
 * chục mét khỏi chính những cái máy chúng nói về.
 *
 * ⇒ `true` ⇒ tâm trạm **luôn** suy từ máy của trạm đó — cùng đường mà trạm chưa đặt chỗ vẫn đi,
 *   nên không đẻ ra phép tính thứ hai (G12). Máy đã ở hệ nào thì trạm theo hệ ấy.
 *
 * ⚠ Trạm **không có máy nào** vẫn rơi về `{0,0,0}` y như trước — `boQuaDatCho` không tạo thêm
 *   ca mới, nó chỉ bỏ nhánh đọc đặt chỗ. Ở chế độ sơ đồ trạm rỗng là trạm không có gì để trải.
 */
export interface TuyChonHinhLine {
  boQuaDatCho?: boolean;
}

/**
 * Dựng hình học của MỘT line từ dữ liệu cảnh.
 *
 * @param lineId  line đang xem. `null` ⇒ trả `null` (không ở cấp Line).
 * @returns `null` khi line không có trạm NÀO và cũng không có máy nào — vẽ một
 *   đường tâm cho tập rỗng là bịa ra một chuyền không tồn tại.
 */
export function dungHinhLine(
  lineId: number | null,
  tram: readonly TramTho[],
  mayVe: readonly MayCoViTri[],
  thuocVe: readonly ThuocVeMay[],
  datCho: readonly DatChoTho[],
  tuyChon: TuyChonHinhLine = {},
): HinhLine | null {
  if (lineId === null) return null;

  /*
   * ★ Đổi mm → m NGAY tại đây, và hoán trục: `viTriZMm` của bản ghi là **chiều
   *   cao**, còn `y` của cảnh three là chiều cao. Nhầm hai trục này làm trạm
   *   nằm ngửa trên sàn mà KHÔNG lỗi nào nổ — giữ đúng thứ tự của bản gốc.
   *
   * ⚠⚠⚠ **MÓN NỢ CÒN MỞ (Task 17c) — CHỖ NÀY CHƯA CỘNG GỐC TOÀ NHÀ.**
   *   `hopNhatCanh.dungMayVe` đã cộng `twin_toa_nha.viTri*Mm` cho MÁY
   *   (xem `gocToaTheoTang`), nhưng đường tâm chuyền ở đây vẫn dựng tâm trạm
   *   từ `twin_dat_cho` TRẦN. Hôm nay **không lệch**, và lý do phải nói rõ:
   *   cả ba màn vận hành chỉ nạp tầng của MỘT toà và neo cảnh vào chính toà
   *   ấy, nên mọi chỗ dời đều bằng 0.
   *
   *   ⇒ Ngay khi một cảnh mang HAI toà (gộp nhiều nhà máy — Task 18/19), máy
   *     sẽ dời mà trạm thì không: đường tâm chuyền **đứt khỏi chính máy của
   *     nó**, và không lỗi nào nổ. Ai làm Task 18/19 phải truyền cùng bản đồ
   *     `gocToaTheoTang` xuống đây TRƯỚC khi bỏ neo một-toà. Đây là lời khai
   *     có hạn sử dụng, không phải một chú thích vĩnh viễn.
   */
  const datChoTram = new Map<number, { x: number; y: number; z: number }>();
  for (const d of datCho) {
    if (d.loaiThucThe === "station") {
      datChoTram.set(d.thucTheId, {
        x: mmSangMet(d.viTriXMm),
        y: mmSangMet(d.viTriZMm),
        z: mmSangMet(d.viTriYMm),
      });
    }
  }

  const tramCuaLine: ViTriDaDat[] = tram
    .filter((s) => s.lineId === lineId)
    .map((s) => {
      const v = datChoTram.get(s.id);
      // ★ Chưa có đặt chỗ ⇒ suy tâm từ MÁY của trạm (xem docblock đầu tệp).
      const mayCuaTram = mayVe.filter(
        (m) => thuocVe.find((x) => x.id === m.machineId)?.stationId === s.id,
      );
      const tamMay =
        mayCuaTram.length > 0
          ? {
              x: mayCuaTram.reduce((a, m) => a + m.viTri.x, 0) / mayCuaTram.length,
              y: 0,
              z: mayCuaTram.reduce((a, m) => a + m.viTri.z, 0) / mayCuaTram.length,
            }
          : null;
      return {
        khoa: `station:${s.id}`,
        // ★ `boQuaDatCho` ⇒ BỎ HẲN `v`, không "ưu tiên `tamMay` rồi mới tới `v`": nửa vời thì
        //   trạm rỗng lại nhảy về toạ độ thật và ta có hai hệ toạ độ trong cùng một cảnh.
        tam: (tuyChon.boQuaDatCho ? null : v) ?? tamMay ?? { x: 0, y: 0, z: 0 },
        thuTu: s.thuTu ?? undefined,
      };
    });

  const mayCuaLine: ViTriDaDat[] = mayVe
    .filter((m) => thuocVe.find((x) => x.id === m.machineId)?.lineId === lineId)
    .map((m) => ({ khoa: `machine:${m.machineId}`, tam: m.viTri }));

  if (tramCuaLine.length === 0 && mayCuaLine.length === 0) return null;

  return { hh: hinhHocLine(tramCuaLine, mayCuaLine), tram: tramCuaLine };
}
