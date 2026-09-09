/**
 * ════════════════════════════════════════════════════════════════════════════
 * `manLine.ts` — LÁT THUẦN của **màn LINE riêng** (`/twin/line/:id`, QĐ-19/QĐ-21)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đợt 30 dựng màn Line thành **màn riêng, canvas riêng** (QĐ-19). Tệp này giữ
 * đúng phần **KHÔNG có sẵn ở đâu** — phần lắp ráp riêng của cấp Line — và
 * **không** viết lại thứ đã nghiệm thu:
 *
 *   ĐÃ CÓ, DÙNG LẠI (G12 — không có phép tính thứ hai):
 *     · `hopNhatCanh.dungMayVe` / `dungNhanMay` / `dungCanhBao3D` / `neoTrenNoc`
 *     · `canhLine.dungHinhLine`   — hình học đường tâm Line
 *     · `phamViCanh.khungNhinLine` — camera bay dọc chuyền
 *     · `wipTram.cotWip` / `xepHangWip` / `nhipTuCanBang`
 *     · `phamViLine.hinhHocLine`   — toán hình học
 *
 *   TỆP NÀY LÀM, và chỉ làm bấy nhiêu:
 *     · `idLineTuDuongDan`  — đọc `:id` **đã bắt được** thành số, an toàn
 *     · `mayCuaLine`        — tập máy thuộc một chuyền (qua `stationId`, xem dưới)
 *     · `hangDaiLine`       — dòng cho `DaiLine` (2D song song, §11.5)
 *     · `tinhWipLine`       — đầu vào DUY NHẤT cho cột 3D + bảng 2D
 *     · `tomTatLine`        — cỡ chuyền + nút thắt CÒN HẠN + tổng WIP
 *
 *   ⛔ **KHÔNG** đếm chạy/dừng/bảo trì ở đây: `kpiNoiLogic.tinhKpiNoi` đã đếm
 *      theo đúng từ vựng hợp đồng (`running`/`down`/`idle`/`offline`). Xem
 *      docblock `tomTatLine` — bản đầu của tệp này đã tự đếm bằng từ vựng SAI
 *      và ba ô cùng ra 0 mà không lỗi nào nổ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÀ HÀM THUẦN, NHẬN QUA THAM SỐ — **G37**
 * ════════════════════════════════════════════════════════════════════════════
 * Không tệp nào ở đây được gọi `useRoute()`/`useSearch()`. Một màn tự đọc route
 * **hỏng CÂM** khi bị đặt ngoài route của nó: `id` ra `NaN`, **không exception
 * nào nổ**, và người xem thấy một chuyền rỗng thay vì một lỗi. `RobotCockpit`
 * và `StationAnalysis` đã dính đúng lớp ấy. Trang cha bắt `:id`, gọi
 * `idLineTuDuongDan` một lần, rồi **truyền số xuống**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G93 — TÁCH RA LÀ **MUA THÊM MỘT BỀ MẶT LỖI Ở KHỚP NỐI**
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 29 đo được: ba đột biến ở **chỗ gọi** sống sót cả 1.998 test, vì lưới
 * module chỉ chứng minh *hàm đúng khi được gọi đúng*. Nên tệp này đi kèm **hai**
 * lưới:
 *   · `manLine.unit.test.ts`         — hàm đúng không
 *   · `manLineNoiVaoTrang.unit.test.ts` — **trang gọi bằng đối số nào**
 * Bỏ lưới thứ hai là lặp lại đúng G93.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠ `machines` **KHÔNG CÓ CỘT `lineId`** — ĐO ĐƯỢC, KHÔNG SUY
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trên CSDL đang chạy 2026-09-09: cột của `machines` gồm `stationId`, **không**
 * có `lineId`. Máy thuộc về chuyền **gián tiếp qua trạm**. Hợp đồng
 * `factoryCommand.overview` bù cho việc đó bằng một trường `lineId` **đã suy**,
 * nên client thấy nó — nhưng tệp này KHÔNG được giả định trường ấy luôn có:
 * `mayCuaLine` chấp nhận **cả hai** đường (khai trực tiếp, hoặc suy từ trạm), và
 * ưu tiên đường trạm khi hai bên mâu thuẫn, vì trạm là **nguồn có ràng buộc khoá
 * ngoại trong CSDL** còn `lineId` trên máy là một giá trị đã đi qua một phép suy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ KHÔNG TRÙNG VIỆC VỚI `/line-view/:lineId` — §11b, ĐỌC TRƯỚC KHI XOÁ
 * ════════════════════════════════════════════════════════════════════════════
 * `client/src/pages/LineView.tsx` (**418 dòng**) đã tồn tại và **0 tham chiếu
 * 3D** (`Canvas`/`three`/`KhungCanh`): nó là màn **2D** điều khiển tuyến (lệnh
 * tuyến, gate `machine_control` + 2FA phía server). Màn Line 3D này là màn
 * **XEM** (QĐ-18: `analytics_oee|machine_status`), không có mặt ghi nào.
 * **Hai thứ KHÁC NHAU.** Tên gần nhau là lý do đúng để ghi dòng này, không phải
 * lý do để ai đó xoá một trong hai vì "tưởng trùng lặp" (đúng lớp lỗi §11b: xoá
 * màn vì tưởng không ai dùng).
 */

import { gopNhieuBBox, type BBox } from "../heToaDo";
import { conHieuLuc, type KhaiNghen, type TinhWip } from "./wipTram";
import type { PhamVi } from "./duongDanTwin";

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① ĐỌC `:id` — chỗ DUY NHẤT chuỗi thành số                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * `:id` của `/twin/line/:id` → số, hoặc `null`.
 *
 * ★★★ `null` chứ **KHÔNG** `NaN`, và đó là toàn bộ điểm của hàm này.
 *   `Number("abc")` ra `NaN`; `NaN` đi tiếp vào `mayCuaLine` sẽ lọc ra **tập
 *   rỗng** — tức là màn hiện một chuyền TRỐNG thay vì nói "id không hợp lệ".
 *   Đúng lớp lỗi G37 (`id = NaN`, **không exception**). Trả `null` buộc trang
 *   phải rẽ nhánh tường minh.
 *
 * ⚠ Từ chối cả số âm, số 0 và số thập phân: khoá chính `production_lines.id` là
 *   `serial` ⇒ nguyên dương. `"2.5"` mà nhận thành `2` là **đoán ý người dùng**.
 */
export function idLineTuDuongDan(tho: string | undefined | null): number | null {
  if (tho == null) return null;
  const s = tho.trim();
  // ★ `/^\d+$/` chứ không `Number()`: `Number(" 2 ")`, `Number("0x2")`,
  //   `Number("2e3")` và `Number("")` đều ra số — cả bốn đều KHÔNG phải id người
  //   dùng gõ, và cả bốn đều lọt nếu chỉ kiểm `Number.isFinite`.
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② MÁY CỦA MỘT CHUYỀN                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Trạm của cảnh thiết kế — chỉ những trường lát này cần. */
export interface TramCuaLine {
  id: number;
  lineId?: number | null;
  thuTu?: number | null;
  ma?: string;
  ten?: string;
}

/** Máy như trang đã hợp nhất (`hopNhat(mayNen, kho)`). */
export interface MayThuocLine {
  id: number;
  stationId?: number | null;
  lineId?: number | null;
}

/**
 * Lọc máy thuộc `lineId`.
 *
 * ★★★ ĐƯỜNG TRẠM THẮNG ĐƯỜNG KHAI — xem docblock đầu tệp. Một máy có
 *   `stationId` trỏ tới trạm của chuyền khác thì nó **thuộc chuyền kia**, dù
 *   `lineId` trên chính nó khai gì; `stations.lineId` có ràng buộc khoá ngoại,
 *   `machines.lineId` không tồn tại trong lược đồ và chỉ là giá trị suy ra.
 *
 * ★ Máy KHÔNG có trạm mà có `lineId` khai đúng thì VẪN nhận: đó là máy chưa gán
 *   trạm nhưng đã gán chuyền. Bỏ nó đi làm màn khai thiếu máy — và "thiếu" là
 *   một lời khai sai, không phải một khoảng trống vô hại (NT-3).
 */
export function mayCuaLine<T extends MayThuocLine>(
  lineId: number | null,
  may: readonly T[],
  tram: readonly TramCuaLine[],
): T[] {
  if (lineId === null) return [];
  const tramCuaLine = new Set(tram.filter((s) => s.lineId === lineId).map((s) => s.id));
  const moiTram = new Map(tram.map((s) => [s.id, s.lineId ?? null]));
  return may.filter((m) => {
    if (m.stationId != null && moiTram.has(m.stationId)) {
      // Trạm BIẾT chuyền nào ⇒ trạm quyết định, kể cả khi nó phủ định `m.lineId`.
      return tramCuaLine.has(m.stationId);
    }
    return m.lineId === lineId;
  });
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ②b KHỚP NỐI SANG `dungMayVe` — **G93**, ĐO ĐƯỢC BẰNG GIÁ TRỊ                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Phạm vi mà màn Line truyền cho `trongPhamVi` khi dựng cảnh.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MỘT HÀM MỘT-DÒNG XỨNG ĐÁNG TỒN TẠI — G93, KHÔNG PHẢI THÓI QUEN
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 29 đo được: **ba đột biến ở CHỖ GỌI sống sót cả 1.998 test**, vì lưới
 * module chỉ chứng minh *hàm đúng khi được gọi đúng* — nó không biết trang gọi
 * bằng đối số nào. Kết luận rút ra: *mọi refactor "tách ra cho sạch" đều MUA
 * thêm một bề mặt lỗi ở KHỚP NỐI.*
 *
 * Đợt 29 trả giá ấy bằng một lưới **đọc VĂN BẢN** của trang (hạng thấp hơn
 * đo-bằng-giá-trị, nhưng là hạng cao nhất có được cho một khớp nối nằm trong
 * thân `useMemo` của một trang 3.5 nghìn dòng). Đợt 30 làm **tốt hơn một bậc**:
 * kéo chính khớp nối ấy ra thành hàm thuần, nên lưới đo được **GIÁ TRỊ THẬT**
 * thay vì chính tả của một dòng mã.
 *
 * ★★★ HAI ĐỘT BIẾN MÀ HÀM NÀY BẮT, VÀ MỘT LƯỚI VĂN BẢN THÌ KHÔNG:
 *   ① `{ cap: "line", id: lineId }` → `{ cap: "tang", id: tangId }`
 *      `trongPhamVi` ở cấp `tang` so `v.tangId === pv.id` (`phamViCanh.ts:64`),
 *      còn ở cấp `line` so `v.lineId === pv.id` (`:66`). Trên CSDL này **mọi
 *      máy nằm CÙNG một tầng** (đo 2026-09-09: 82/82 hàng `twin_dat_cho` ở
 *      `tangId=28`) ⇒ đột biến ấy làm **MỌI máy "trong phạm vi"**, tức lớp pha
 *      12 % mất hiệu lực **im lặng** và không ảnh nào phân biệt được.
 *   ② `id: lineId` → `id: null`. `trongPhamVi` **trả `true` vô điều kiện** khi
 *      `pv.id === null` (`:59`) — cùng hậu quả, và còn câm hơn.
 */
export function phamViCuaManLine(lineId: number): PhamVi {
  return { cap: "line", id: lineId };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ WIP — đầu vào DUY NHẤT cho cột 3D và bảng 2D (§11.5 + G12)                */
/* ══════════════════════════════════════════════════════════════════════════ */

export interface ThamSoTinhWipLine {
  lineId: number | null;
  tram: readonly TramCuaLine[];
  /** Tâm trạm ĐÃ quy về mét, khoá `station:<id>` — ra từ `dungHinhLine`. */
  tamTram: ReadonlyMap<number, { x: number; z: number }>;
  /** Đã có câu trả lời THÀNH CÔNG chưa. `false` ⇒ mọi `soWip` là `null`. */
  daDo: boolean;
  soTheoTram: ReadonlyMap<number, number>;
}

/**
 * Ghép số WIP với vị trí trạm — **một phép ghép, hai người đọc**.
 *
 * ★★★ `soWip = null` **KHÔNG PHẢI `0`**, và khác biệt ấy là toàn bộ vấn đề.
 *   Một trạm vắng mặt trong kết quả có hai nghĩa hoàn toàn khác nhau:
 *     • truy vấn ĐÃ trả lời (`daDo`) ⇒ trạm thật sự trống ⇒ **0 thật**
 *     • truy vấn chưa xong / 403 / lỗi ⇒ ta KHÔNG BIẾT ⇒ **`null`**
 *   In "0 WIP" cho người không có quyền là lời khai *"đã kiểm tra, chuyền
 *   trống"*. Đây là hành vi nguyên bản của `TwinVanHanh.tsx` bê nguyên sang
 *   (G5/G32: refactor đúng thì đầu ra KHÔNG khác đầu vào).
 *
 * ★ Trạm chưa có toạ độ ⇒ `x/z = 0`: cột WIP về gốc toạ độ chứ không biến mất,
 *   giữ đúng bản gốc. (Trạm CHƯA đặt chỗ vẫn được `dungHinhLine` suy tâm từ máy
 *   của nó, nên ca này chỉ xảy ra khi trạm không có cả máy lẫn đặt chỗ.)
 */
export function tinhWipLine(ts: ThamSoTinhWipLine): TinhWip[] {
  if (ts.lineId === null) return [];
  return ts.tram
    .filter((s) => s.lineId === ts.lineId)
    .map((s) => {
      const v = ts.tamTram.get(s.id);
      return {
        stationId: s.id,
        ma: s.ma ?? `S${s.id}`,
        ten: s.ten ?? `Trạm ${s.id}`,
        thuTu: s.thuTu ?? 0,
        soWip: ts.daDo ? (ts.soTheoTram.get(s.id) ?? 0) : null,
        x: v?.x ?? 0,
        z: v?.z ?? 0,
      };
    })
    .sort((a, b) => a.thuTu - b.thuTu || a.ma.localeCompare(b.ma));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ DÒNG CHO `DaiLine` — bản 2D SONG SONG (§11.5)                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Một dòng của `DaiLine` — hình dạng khớp `TramTrenDai`. */
export interface HangDaiLine {
  id: number;
  ma: string;
  ten: string;
  thuTu: number;
  soMay: number;
  trangThai: string;
  soWip: number | null;
  nghen: boolean;
  hang: number | null;
}

export interface ThamSoHangDaiLine {
  lineId: number | null;
  tram: readonly TramCuaLine[];
  may: readonly MayThuocLine[];
  trangThaiTheoMay: ReadonlyMap<number, string>;
  /** Ra từ `xepHangWip(tinhWipLine(...), khaiNghen)` — **cùng nguồn** với cột 3D. */
  bangWip: readonly { stationId: number; soWip: number | null; nghen: boolean; hang: number | null }[];
}

/**
 * Dựng dòng cho `DaiLine`.
 *
 * ★★★ §11.5 — MÀU KHÔNG CHO PHÉP SO SÁNH CHÍNH XÁC. Nhìn 12 ô màu người ta đọc
 *   được *"trạm 5 nóng hơn trạm 4"* nhưng KHÔNG đọc được *"nóng hơn bao nhiêu"*
 *   — và câu hỏi vận hành thật luôn là câu thứ hai. Dải này đặt SỐ cạnh màu.
 *
 * ★★★ `nghen`/`hang` LẤY TỪ `bangWip`, KHÔNG tính lại. Nếu 3D tô đỏ trạm 7 thì
 *   dòng trạm 7 ở đây **bắt buộc** mang `nghen: true` — không có đường nào để
 *   hai bề mặt lệch nhau, vì không có phép tính thứ hai (G12). Ai thay dòng này
 *   bằng một `laNghen()` gọi lại sẽ tạo đúng cơ hội lệch mà §11.5 sinh ra để
 *   chặn.
 *
 * ★ `soWip: w?.soWip ?? null` — `?? 0` ở đây in "0 chiếc đang chờ" cho một trạm
 *   ta **chưa đo**; xem docblock `tinhWipLine`.
 */
export function hangDaiLine(ts: ThamSoHangDaiLine): HangDaiLine[] {
  if (ts.lineId === null) return [];
  const wTheoTram = new Map(ts.bangWip.map((w) => [w.stationId, w]));
  return ts.tram
    .filter((s) => s.lineId === ts.lineId)
    .map((s) => {
      const mayTram = ts.may.filter((m) => m.stationId === s.id);
      const w = wTheoTram.get(s.id);
      return {
        id: s.id,
        ma: s.ma ?? `S${s.id}`,
        ten: s.ten ?? `Trạm ${s.id}`,
        thuTu: s.thuTu ?? 0,
        soMay: mayTram.length,
        // ★ Máy ĐẦU TIÊN của trạm làm đại diện — hành vi nguyên bản của
        //   `TwinVanHanh.tsx:3521`. Trạm không máy ⇒ `khong_ro`, KHÔNG `chay`.
        trangThai: mayTram.map((m) => ts.trangThaiTheoMay.get(m.id) ?? "khong_ro")[0] ?? "khong_ro",
        soWip: w?.soWip ?? null,
        nghen: w?.nghen ?? false,
        hang: w?.hang ?? null,
      };
    })
    .sort((a, b) => a.thuTu - b.thuTu || a.ma.localeCompare(b.ma));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ TÓM TẮT — chip đọc-liếc, NHÓM (B) của §15.6                               */
/* ══════════════════════════════════════════════════════════════════════════ */

export interface TomTatLine {
  soMay: number;
  soTram: number;
  /** `stations.id` của nút thắt, hoặc `null` khi **chưa đo được / hết hạn**. */
  tramNghen: number | null;
  /** WIP toàn chuyền. `null` khi chưa đo được — **KHÔNG** `0`. */
  tongWip: number | null;
}

/**
 * Chip trái của §15.6.1 nhóm (B): `Line N · 12 máy · nhịp · nút thắt · WIP`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HÀM NÀY **KHÔNG ĐẾM** CHẠY/DỪNG/BẢO TRÌ — `tinhKpiNoi` ĐÃ LÀM (G12)
 * ════════════════════════════════════════════════════════════════════════════
 * Bản đầu của tệp này có ba ô `chay`/`dung`/`chuaRo` tự đếm. Bỏ đi, vì
 * `kpiNoiLogic.tinhKpiNoi` (`:121`) đã đếm **đúng bốn** ô `dangChay`/`dungLoi`/
 * `baoTri`/`matKetNoi` theo hợp đồng `factoryCommand.overview`, cùng luật
 * honest-null (`chuaDo` THẮNG dữ liệu) mà `BangKpiNoi` đang vẽ. Một bản đếm thứ
 * hai ở đây sẽ:
 *   ① dùng **sai từ vựng** — bản đầu của tôi so `"chay"`/`"dung"` trong khi
 *      hợp đồng thật là `"running"`/`"down"`/`"idle"`/`"offline"`. Không lỗi nào
 *      nổ; ba ô cùng ra **0** và màn khai "chuyền không có máy nào chạy";
 *   ② đẻ ra hai con số cho cùng một câu hỏi, và **hai cơ hội để lệch nhau**.
 * ⇒ Màn Line gọi `tinhKpiNoi(mayCuaLine(...))` cho các ô trạng thái. Hàm này chỉ
 *   giữ phần **KHÔNG ai đếm hộ**: cỡ chuyền, nút thắt còn hạn, tổng WIP.
 *
 * ★★★ `tongWip = null` khi CÓ BẤT KỲ trạm nào chưa đo được. Cộng những trạm đã
 *   đo rồi in ra một con số là khai một TỔNG mà ta chỉ có một PHẦN — con số ấy
 *   nhỏ hơn sự thật và không nói ra điều đó. `hienSo` in `—` cho `null`.
 *
 * ★ `tramNghen` đi qua `conHieuLuc` — CÙNG cửa kiểm hạn 8 giờ, CÙNG hàm với cột
 *   3D. Đợt 8 đo được một lời khai `line_balance` **16 ngày tuổi tô đỏ SAI
 *   trạm**: một lời khai hết hạn vẫn là lời khai, nó không được bác một phép đo
 *   SỐNG.
 */
export function tomTatLine(
  may: readonly { id: number }[],
  tram: readonly unknown[],
  wip: readonly TinhWip[],
  khai: KhaiNghen,
): TomTatLine {
  let tongWip: number | null = 0;
  for (const w of wip) {
    if (w.soWip == null) {
      tongWip = null;
      break;
    }
    tongWip += w.soWip;
  }

  return {
    soMay: may.length,
    soTram: tram.length,
    tramNghen: conHieuLuc(khai.mocKhai, khai.bayGio) ? (khai.nghenTheoServer ?? null) : null,
    tongWip,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★ ĐỢT 35 (Pareto #5) — bbox KÈM đỉnh cột WIP, để khớp khung không cắt cột       */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Gộp bbox hình học chuyền với các CỘT WIP (`OngWip`: trụ từ y=0 tới `cao`,
 * tới 6 m — `CAO_TOI_DA_M` của `wipTram.ts`). `hinhHocLine` chỉ bao trạm + máy
 * (cao ~1,6 m); khớp khung theo bbox ấy để cột WIP xuyên mép trên — đúng ảnh QA
 * Đợt 32 a3. Cột rỗng ⇒ trả bbox gốc nguyên vẹn (không cấp phát vô ích).
 */
export function bboxKemCotWip(
  bbox: BBox,
  cot: readonly { x: number; z: number; cao: number }[],
): BBox {
  if (cot.length === 0) return bbox;
  return gopNhieuBBox([
    bbox,
    ...cot.map((c) => ({ minX: c.x, maxX: c.x, minY: 0, maxY: Math.max(0, c.cao), minZ: c.z, maxZ: c.z })),
  ]);
}
