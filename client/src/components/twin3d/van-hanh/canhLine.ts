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
  /**
   * Tầng chứa chỗ đặt — khoá để tra chỗ dời của TOÀ (xem {@link TuyChonHinhLine.gocToaTheoTang}).
   *
   * Thiếu/`null` ⇒ **không dời**, giữ đúng hành vi trước Task 17c. Bịa một `0` ở đây là biến
   * "chưa biết tầng nào" thành "biết rồi, tầng gốc" — đúng lớp lỗi NT-3.
   */
  tangId?: number | null;
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
  /**
   * ════════════════════════════════════════════════════════════════════════════
   * ★★★ TASK 17c — CHỖ DỜI CỦA TOÀ NHÀ, CHO **TÂM TRẠM**
   * ════════════════════════════════════════════════════════════════════════════
   * `hopNhatCanh.dungMayVe` cộng `twin_toa_nha.viTri*Mm` cho MÁY từ lâu; tâm trạm ở tệp này thì
   * vẫn dựng từ `twin_dat_cho` **TRẦN**. Hôm nay không lệch — và lý do phải nói rõ: cả ba màn vận
   * hành chỉ nạp tầng của MỘT toà và neo cảnh vào chính toà ấy, nên mọi chỗ dời đều bằng 0.
   *
   * ⚠ Đó là một tiền đề **không ai cưỡng chế**. Ngay khi một cảnh mang HAI toà, máy sẽ dời mà
   *   trạm thì không: đường tâm chuyền **đứt khỏi chính máy của nó**, cột WIP đứng lệch, và
   *   **không một lỗi nào nổ**. Vòng này vừa trả giá đúng lớp ấy: cột WIP sai 16,6 m qua nhiều
   *   đợt mà không lưới nào đỏ.
   *
   * ⇒ Truyền CÙNG bản đồ mà `dungMayVe` dùng. Thiếu ⇒ không dời (hành vi cũ), nên bản vá này
   *   **không đổi một pixel nào hôm nay** — nó chỉ gỡ ngòi.
   */
  gocToaTheoTang?: ReadonlyMap<number, { xMm: number; yMm: number; zMm: number }>;
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
   * ════════════════════════════════════════════════════════════════════════
   * ✅ TASK 17c — MÓN NỢ NÀY **ĐÃ TRẢ**. Khối cảnh báo cũ để ở đây quá hạn.
   * ════════════════════════════════════════════════════════════════════════
   * Nguyên văn cảnh báo cũ: *"CHỖ NÀY CHƯA CỘNG GỐC TOÀ NHÀ … đường tâm chuyền
   * vẫn dựng tâm trạm từ `twin_dat_cho` TRẦN … ai làm Task 18/19 phải truyền
   * cùng bản đồ `gocToaTheoTang` xuống đây TRƯỚC khi bỏ neo một-toà."*
   *
   * Việc ấy **đã làm**: ngay dưới đây `gocToaTheoTang` được tra theo `tangId` và
   * cộng vào cả ba trục, **kèm hoán trục** (`y ← g.zMm`, `z ← g.yMm`). Ca kiểm
   * `tamTramCongGocToa.unit.test.ts` giữ 8 ca cho đúng chỗ này.
   *
   * ★★★ VÀ ĐÂY LÀ BÀI HỌC ĐÁNG GIÁ HƠN CẢ MÓN NỢ:
   *   Khối cũ tự nhận mình là *"lời khai có hạn sử dụng, không phải một chú
   *   thích vĩnh viễn"* — rồi **nằm quá hạn**, mâu thuẫn với chính đoạn mã ba
   *   dòng bên dưới nó. Một cảnh báo hết hạn nguy hiểm hơn không có cảnh báo:
   *   người đọc tin nó, và đi vá một thứ đã được vá.
   *   ⇒ Lời khai có hạn thì **phải gỡ trong cùng lượt trả nợ**, đúng luật đã
   *     ghi cho banner ở PH-50.
   */
  const datChoTram = new Map<number, { x: number; y: number; z: number }>();
  for (const d of datCho) {
    if (d.loaiThucThe === "station") {
      /*
       * ★★★ HOÁN TRỤC **KÈM** CHỖ DỜI, và hai thứ phải hoán CÙNG MỘT KIỂU.
       *   cảnh `y` (chiều cao) ← bản ghi `Z`; cảnh `z` (chiều sâu) ← bản ghi `Y`.
       *   Cộng `g.yMm` vào `y` thay vì `g.zMm` là dựng đứng chỗ dời của toà — trạm bay lên trời
       *   hoặc chui xuống đất đúng bằng toạ độ NGANG của toà, và không lỗi nào nổ.
       */
      const g =
        (d.tangId != null ? tuyChon.gocToaTheoTang?.get(d.tangId) : undefined) ??
        { xMm: 0, yMm: 0, zMm: 0 };
      datChoTram.set(d.thucTheId, {
        x: mmSangMet(g.xMm + d.viTriXMm),
        y: mmSangMet(g.zMm + d.viTriZMm),
        z: mmSangMet(g.yMm + d.viTriYMm),
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
              /*
               * ★★★ CAO ĐỘ SÀN CỦA TRẠM — trước đây viết cứng `0`, và con số 0 ấy đi thẳng
               *   xuống cột WIP: `OngWip` đặt đáy trụ ở `y` này. Đo ở `/twin/line/526`, chuyền
               *   nằm trên **tầng 3 (y = 16,6 m)**: **0/39** cột đứng đúng chỗ trạm của nó,
               *   lệch **111 px @1280×720** / **240 px @1920×1080** — xa hơn một ô lưới, nên
               *   người vận hành đọc "trạm này ùn" từ cây cột đứng dưới MỘT CÁI MÁY KHÁC.
               * ★ Lấy trung bình cao độ máy của chính trạm: một trạm ở đâu là nơi máy của nó ở.
               */
              y: mayCuaTram.reduce((a, m) => a + m.viTri.y, 0) / mayCuaTram.length,
              z: mayCuaTram.reduce((a, m) => a + m.viTri.z, 0) / mayCuaTram.length,
            }
          : null;
      /*
       * ★★★ MẶT BẰNG lấy từ đặt chỗ, CAO ĐỘ lấy từ MÁY — và hai nguồn khác nhau ở đây là có lý
       *   do, không phải cẩu thả. `twin_dat_cho.viTriZMm` (chiều cao) **chưa cộng gốc toà nhà**
       *   — chính món nợ Task 17c ghi ở đầu tệp này — trong khi `mayVe` thì ĐÃ cộng
       *   (`gocToaTheoTang`). Lấy cao độ từ đặt chỗ là đặt cột WIP vào một hệ toạ độ khác với
       *   hệ của máy, tức tái tạo đúng khuyết tật vừa vá, chỉ khác con số.
       * ⚠ Trạm KHÔNG có máy nào ⇒ vẫn dùng trọn `v` (cả ba trục): không có gì tốt hơn để lấy.
       */
      const datCho = tuyChon.boQuaDatCho ? null : v;
      const tamGhep =
        datCho && tamMay ? { x: datCho.x, y: tamMay.y, z: datCho.z } : (datCho ?? tamMay);
      return {
        khoa: `station:${s.id}`,
        // ★ `boQuaDatCho` ⇒ BỎ HẲN `v`, không "ưu tiên `tamMay` rồi mới tới `v`": nửa vời thì
        //   trạm rỗng lại nhảy về toạ độ thật và ta có hai hệ toạ độ trong cùng một cảnh.
        tam: tamGhep ?? { x: 0, y: 0, z: 0 },
        thuTu: s.thuTu ?? undefined,
      };
    });

  const mayCuaLine: ViTriDaDat[] = mayVe
    .filter((m) => thuocVe.find((x) => x.id === m.machineId)?.lineId === lineId)
    .map((m) => ({ khoa: `machine:${m.machineId}`, tam: m.viTri }));

  if (tramCuaLine.length === 0 && mayCuaLine.length === 0) return null;

  return { hh: hinhHocLine(tramCuaLine, mayCuaLine), tram: tramCuaLine };
}
