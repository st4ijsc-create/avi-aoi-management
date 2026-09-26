/**
 * ============================================================================
 * taiVanHanhTwin.ts — PHẦN THUẦN của việc sinh DỮ LIỆU VẬN HÀNH cho tải Twin
 * ============================================================================
 *
 * Lô P đợt 14. Dùng bởi `scripts/sinh-tai-twin.ts` (ghi) và
 * `scripts/go-tai-twin.ts` (gỡ). Module này KHÔNG chạm DB — nó chỉ quy
 * (máy, trạm, mốc thời gian) → hàng sẽ ghi, để test được mà không cần CSDL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHẦN NÀY TỒN TẠI — MỘT CẢNH 3D ĐẸP VỚI MỌI LỚP PHỦ TRỐNG
 * ════════════════════════════════════════════════════════════════════════════
 * `sinh-tai-twin.ts` dựng được HÌNH HỌC (nhà máy/tầng/line/trạm/máy + đặt chỗ).
 * Nhưng màn Vận hành không chỉ vẽ hình — nó vẽ WIP, nút thắt, cảnh báo, màu
 * sức khoẻ. Những thứ đó đọc từ bảng KHÁC, và trên CSDL này chúng RỖNG hoặc
 * QUÁ HẠN — đo được, không phải suy đoán (đo 2026-09-07, `aoi_management`):
 *
 *   `wip_tracking`          7.048 hàng · **0 hàng trong 24h** · mới nhất
 *                           `enteredAt` = 2026-08-21 (17 ngày)
 *                           ⇒ `digitalTwin.predictionOverlay` có `lookbackHours`
 *                             VIẾT CỨNG = 24 và cần ≥3 điểm ⇒ luôn trả
 *                             `available:false, reason:"insufficient_data"`.
 *   `product_inspections`   **0 hàng** ⇒ `defectHeatmap` vĩnh viễn `[]`.
 *   `machines.lastHeartbeat` nhóm `running` (3 máy) mới nhất = 2026-07-17
 *                           ⇒ `trungThucDuLieu` ghi đè hết về `khong_ro`.
 *
 * ⇒ Sinh 240 máy mà KHÔNG sinh kèm mấy bảng này thì giao đúng cái bẫy G5: cổng
 *   xanh, cảnh dựng được, và mọi lớp phủ trống — "đo trên tập rỗng".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G30 — MỐC THỜI GIAN PHẢI GẦN HIỆN TẠI, KHÔNG PHẢI "MỘT LÚC NÀO ĐÓ"
 * ════════════════════════════════════════════════════════════════════════════
 * Ba cửa lọc theo tuổi, ba ngưỡng KHÁC NHAU, và dữ liệu phải qua được CẢ BA:
 *
 *   `NGUONG_TUOI_MS`      (`mauTrangThai`)  — máy "tươi"
 *   `HAN_KHAI_NGHEN_MS`   (`wipTram`) = 8h — lời khai nút thắt còn hiệu lực
 *   `lookbackHours` = 24h (`predictionOverlay`, viết cứng ở router)
 *
 * Nên mọi mốc sinh ở đây tính LÙI TỪ `bayGio` (tham số), không dùng ngày cố
 * định. Một hằng ngày tháng viết cứng sẽ "tươi" hôm nay và hết hạn tuần sau —
 * đúng lớp lỗi "lý do hoãn có HẠN SỬ DỤNG" mà Khối D đã trả giá để học.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NHẬN DẠNG ĐỂ GỠ — TIỀN TỐ SERIAL, KHÔNG PHẢI CỜ
 * ════════════════════════════════════════════════════════════════════════════
 * Cùng lý do như `sinh-tai-twin.ts`: không có cột nào nói "hàng này là tải thử",
 * và thêm cột/enum là đổi lược đồ (ngoài phạm vi duyệt). `wip_tracking` gỡ được
 * qua `currentStationId ∈ trạm của nhà máy tải` — một đường TRUY VẾT THẬT, hơn
 * hẳn một quy ước đặt tên. `serialNumber` mang tiền tố mã nhà máy là đường thứ
 * HAI, độc lập, để đối chiếu (BG-127) chứ không phải để thay thế.
 *
 * ★ Module THUẦN — không postgres, không `Date.now()` ẩn: `bayGio` luôn là
 *   THAM SỐ, nên test tất định và không phụ thuộc đồng hồ máy.
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NGƯỠNG — SUY TỪ CÁC CỬA LỌC CÓ THẬT, KHÔNG PHẢI SỐ TRÒN TUỲ HỨNG            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bề rộng cửa sổ lịch sử WIP, ms. **22 giờ, không phải 24.**
 *
 * `predictionOverlay` lấy `since = now - 24h` rồi gom bucket. Nếu ta rải đúng
 * 24 giờ thì bucket đầu tiên nằm NGAY MÉP cửa sổ và sẽ rơi ra ngoài khi truy vấn
 * chạy chậm vài giây sau lúc sinh — số điểm tụt xuống, và ở cấu hình bucket lớn
 * thì nó tụt qua ngưỡng `< 3` và overlay tắt. 2 giờ đệm là cái giá rẻ cho việc
 * không phải điều tra một `available:false` ngẫu nhiên.
 */
export const CUA_SO_WIP_MS = 22 * 60 * 60 * 1000;

/**
 * Số bucket WIP rải trong cửa sổ. `predictionOverlay` cần **≥3 điểm** sau khi
 * gom theo `bucketMin` (mặc định 30 phút). 24 mốc / 22 giờ ⇒ ~55 phút một mốc
 * ⇒ ở bucket 30 phút vẫn ra ≥20 bucket không rỗng. Dư nhiều lần ngưỡng 3.
 */
export const SO_MOC_WIP = 24;

/**
 * ★★★ Cửa sổ `station_dwell_time`, ms — **22 giờ**, CÙNG bề rộng với WIP.
 *
 * `wipRouter.dwellByStation` / `db/lineBalance.getStationDwellAgg` lọc
 * `enteredAt >= since` với `since` do người gọi truyền; `stationLoadHeatmap`
 * truyền `now - 24h`. Dùng lại đúng 22 giờ của `CUA_SO_WIP_MS` cho hai lý do:
 *
 *   1. Cùng lề 2 giờ, cùng lý do (mép cửa sổ 24h — xem `CUA_SO_WIP_MS`).
 *   2. Hai lớp phủ đọc HAI BẢNG khác nhau cho CÙNG một chuyền. Rải chúng trên
 *      hai bề rộng khác nhau thì khi một lớp trống mà lớp kia đầy, không ai
 *      phân biệt được "bảng này thiếu dữ liệu" với "hai cửa sổ lệch nhau".
 */
export const CUA_SO_DWELL_MS = CUA_SO_WIP_MS;

/**
 * Số bản ghi dwell mỗi trạm.
 *
 * `getStationDwellAgg` gom `avg()` theo `stationId` — một mẫu cho ra một trung
 * bình bằng chính nó, tức là một con số KHÔNG đo được độ tản. 6 mẫu/trạm đủ để
 * trung bình có nghĩa và vẫn rẻ: 240 máy × 6 = 1.440 hàng.
 */
export const DWELL_MOI_TRAM = 6;

/**
 * Hạn để lời khai nút thắt còn hiệu lực, ms — PHẢI khớp `HAN_KHAI_NGHEN_MS`
 * của `client/src/components/twin3d/van-hanh/wipTram.ts` (8 giờ = một ca).
 *
 * ⚠ Đây là bản sao thứ hai của một con số, tức là đúng thứ G12 cảnh báo. Không
 *   import trực tiếp được vì script chạy bằng `tsx` ngoài đồ hình build của
 *   client. Nên có `taiVanHanhTwin.unit.test.ts` ĐỌC hằng bên kia và so — bản
 *   sao được phép tồn tại, nhưng KHÔNG được phép lệch trong im lặng.
 */
export const HAN_KHAI_NGHEN_MS = 8 * 60 * 60 * 1000;

/** Bản ghi `line_balance` sinh ra cách hiện tại bao lâu. Phải < hạn trên. */
export const TUOI_LINE_BALANCE_MS = 2 * 60 * 60 * 1000;

/** Cửa sổ kiểm tra sản phẩm — `defectHeatmap` mặc định `hours=24`. */
export const CUA_SO_KIEM_TRA_MS = 20 * 60 * 60 * 1000;

/** Số bản ghi kiểm tra mỗi máy. Đủ để tỉ lệ NG có nghĩa, không phải một mẫu. */
export const KIEM_TRA_MOI_MAY = 12;

/**
 * ★★★ Tuổi heartbeat khi ghi. **5 giây** — và con số nhỏ này là một PHÁT HIỆN,
 * không phải một lựa chọn thẩm mỹ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ DỮ LIỆU SINH RA HỎNG SAU 5 PHÚT ĐỒNG HỒ TƯỜNG — ĐO ĐƯỢC, KHÔNG SUY LUẬN
 * ════════════════════════════════════════════════════════════════════════════
 * `mauTrangThai` (đo tại nguồn, lô P): `NGUONG_TUOI_MS = 60_000` (1 phút) và
 * `NGUONG_CU_MS = 300_000` (5 phút). `mucTuoi()` quy:
 *
 *   tuổi < 1 phút   → `tuoi`      màu đầy đủ
 *   1–5 phút        → `cu`        cùng màu, nhạt 40%
 *   **> 5 phút**    → `khong_ro`  **XÁM GẠCH CHÉO, thắng mọi trạng thái báo cáo**
 *
 * ⇒ Đây là ràng buộc NẶNG NHẤT của cả lô, và nó KHÔNG giống mấy cửa 8h/24h kia:
 *   những cửa đó tính bằng giờ, cửa này tính bằng PHÚT. Nghĩa là:
 *
 *   ▸ Một mốc "gần hiện tại" kiểu 90 giây đã là `cu` NGAY LÚC GHI.
 *   ▸ Và **5 phút sau khi sinh xong, 240 máy chuyển hết sang xám `khong_ro`** —
 *     kể cả khi mọi bảng đều đầy dữ liệu. Cảnh vẫn dựng, 240 khối vẫn vẽ, WIP
 *     và andon vẫn còn (chúng dùng cửa 8h/24h), nhưng MÀU MÁY chết.
 *
 * Nên: 5 giây để lúc ghi xong là `tuoi` thật, và ai muốn nghiệm thu thị giác
 * MÀU máy thì phải chụp trong vòng 5 phút sau khi sinh — hoặc chạy lại
 * `--chi-nhip` để làm tươi lại nhịp tim mà không đụng hình học.
 *
 * ★ Đây KHÔNG phải khiếm khuyết của bộ sinh; đó là NT-3 đang làm đúng việc của
 *   nó (dữ liệu ngừng tiến ⇒ nói "không biết"). Một bộ sinh cố lách bằng mốc
 *   tương lai sẽ phá đúng cái cầu chì mà màn hình này tồn tại để giữ.
 */
export const TUOI_HEARTBEAT_MS = 5 * 1000;

/**
 * Ngưỡng mà quá nó máy hoá xám, ms — **bản sao đo từ `mauTrangThai.NGUONG_CU_MS`**.
 * Dùng để script in ra HẠN DÙNG của lần sinh, thay vì để người dùng tự phát hiện.
 * Bài test đối chiếu với hằng gốc, nên nó không lệch trong im lặng (G12).
 */
export const HAN_MAU_MAY_MS = 300 * 1000;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* NGẪU NHIÊN TẤT ĐỊNH — dùng lại đúng LCG/FNV của `sinh-tai-twin.ts`          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** LCG 32-bit. Cùng `hat` ⇒ cùng dãy trên mọi máy, mọi lần chạy. */
export function taoNgauNhien(hat: number): () => number {
  let s = hat >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** FNV-1a: chuỗi → 32-bit. Đủ tản để gieo; không phải mật mã. */
export function bamChuoi(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* KIỂU DỮ LIỆU                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Một trạm của nhà máy tải, đã có id thật từ DB. */
export interface TramTai {
  stationId: number;
  machineId: number;
  lineId: number;
  /** Thứ tự trạm trong line (0-based) — quyết định hình dạng dòng chảy. */
  thuTu: number;
  /** Tổng số trạm của line — để biết trạm này ở đầu hay cuối chuyền. */
  soTramCuaLine: number;
}

/** Một hàng `wip_tracking` sẽ ghi. */
export interface HangWip {
  serialNumber: string;
  lineId: number;
  currentStationId: number;
  currentMachineId: number;
  status: string;
  quantity: number;
  enteredAtMs: number;
}

/** Một hàng `product_inspections` sẽ ghi. */
export interface HangKiemTra {
  machineId: number;
  serialNumber: string;
  overallResult: "OK" | "NG";
  inspectionTimeMs: number;
}

/**
 * Một hàng `station_dwell_time` sẽ ghi.
 *
 * ⚠ `stationId`, `dwellMs`, `processingMs`, `starvedMs`, `blockedMs`,
 *   `enteredAt` đều **NOT NULL** trong lược đồ (đo bằng
 *   `information_schema.columns`) — bỏ sót một cột là `23502`, không phải một
 *   hàng thiếu dữ liệu im lặng.
 */
export interface HangDwell {
  lineId: number;
  stationId: number;
  machineId: number;
  serialNumber: string;
  dwellMs: number;
  processingMs: number;
  starvedMs: number;
  blockedMs: number;
  enteredAtMs: number;
  exitedAtMs: number;
}

/** Một hàng `machine_health_history` sẽ ghi. */
export interface HangSucKhoe {
  machineId: number;
  machineCode: string;
  timestampMs: number;
  healthScore: number;
  oeeScore: number;
  uptimeScore: number;
  errorRateScore: number;
  cycleTimeScore: number;
  predictedFailureRisk: number;
}

/** Một hàng `andon_events` sẽ ghi. */
export interface HangAndon {
  lineId: number;
  stationId: number;
  machineId: number;
  state: "red" | "yellow";
  reason: "quality" | "material" | "maintenance" | "safety" | "setup" | "other";
  status: "raised" | "acknowledged";
  title: string;
  raisedAtMs: number;
}

/** Một hàng `line_balance_metrics` sẽ ghi. */
export interface HangCanBangLine {
  lineId: number;
  periodStartMs: number;
  periodEndMs: number;
  bottleneckStationId: number;
  bottleneckMachineId: number;
  utilizationPct: number;
  balanceRatePct: number;
  throughputUnits: number;
  wipCount: number;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SINH WIP                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ WIP của một trạm — HÌNH CHỮ U theo vị trí trong chuyền, KHÔNG PHẲNG.
 *
 * Một chuyền thật không có WIP đều nhau mọi trạm. Và quan trọng hơn cho việc
 * NGHIỆM THU: nếu mọi trạm bằng nhau thì `laNghen` (cần `soWip >= BOI_NGHEN ×
 * trung vị`) sẽ trả `false` ở MỌI trạm, và lớp phủ nút thắt tuy "có dữ liệu"
 * vẫn không vẽ gì. Cổng xanh, màn hình trống — đúng G5.
 *
 * ⇒ Cố ý dựng **một trạm nghẽn** mỗi line (trạm giữa chuyền), WIP cao gấp bội
 *   trung vị, để lớp phủ có cái để vẽ VÀ để phép đo phân biệt được
 *   "vẽ đúng chỗ" với "vẽ đại".
 *
 * @param t     trạm
 * @param nghen thứ tự trạm được chọn làm nút thắt trong line này
 */
export function soWipCuaTram(t: TramTai, nghen: number): number {
  const rnd = taoNgauNhien(bamChuoi(`wip:${t.lineId}:${t.thuTu}`));
  if (t.thuTu === nghen) return 60 + Math.floor(rnd() * 20); // 60–79
  // Trạm thường: 3–9. Trung vị ~6 ⇒ nghẽn gấp ~10 lần, vượt xa BOI_NGHEN.
  return 3 + Math.floor(rnd() * 7);
}

/** Trạm nào là nút thắt của line — giữa chuyền, tất định theo `lineId`. */
export function tramNghenCuaLine(lineId: number, soTram: number): number {
  if (soTram <= 0) return 0;
  return Math.floor(soTram / 2);
}

/**
 * Sinh toàn bộ hàng `wip_tracking` của một line.
 *
 * ★ `exitedAt` để NULL: `getWipByStation` lọc `isNull(exitedAt)` — hàng đã ra
 *   khỏi chuyền không được đếm. Đây là lý do 7.048 hàng cũ vẫn "đang trong
 *   chuyền" (đo được: `chua_ra = 7048`) mà vẫn không giúp gì cho overlay dự
 *   báo: overlay lọc theo `enteredAt` trong 24h, không theo `exitedAt`.
 *
 * ★ Mốc `enteredAt` rải đều trong `CUA_SO_WIP_MS` để `getWipCountSeries` gom
 *   được ≥3 bucket. Rải hết vào MỘT mốc thì 7.048 hàng cũng chỉ ra 1 điểm và
 *   `predictionOverlay` vẫn `insufficient_data` — số hàng KHÔNG phải thứ nó đo.
 */
export function sinhWipChoLine(
  maNhaMay: string,
  lineId: number,
  tramCuaLine: readonly TramTai[],
  bayGio: number,
): HangWip[] {
  const ra: HangWip[] = [];
  const nghen = tramNghenCuaLine(lineId, tramCuaLine.length);
  let stt = 0;
  for (const t of tramCuaLine) {
    const soWip = soWipCuaTram(t, nghen);
    for (let i = 0; i < soWip; i++) {
      // Rải mốc vào SO_MOC_WIP khe đều nhau trong cửa sổ. Khe 0 = xa nhất.
      const khe = (stt + i) % SO_MOC_WIP;
      const enteredAtMs =
        bayGio - CUA_SO_WIP_MS + Math.round((khe * CUA_SO_WIP_MS) / SO_MOC_WIP);
      ra.push({
        serialNumber: `${maNhaMay}-WIP-${lineId}-${t.stationId}-${i}`,
        lineId,
        currentStationId: t.stationId,
        currentMachineId: t.machineId,
        status: "in_process",
        quantity: 1,
        enteredAtMs,
      });
    }
    stt += soWip;
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SINH DWELL TRẠM (cho `stationLoadHeatmap` / `wipRouter.dwellByStation`)      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `station_dwell_time` LÀ NGUỒN THỨ HAI, VÀ NÓ KHÔNG PHẢI NGUỒN CỦA
 *     `predictionOverlay` — BRIEF LÔ S NÓI SAI CHỖ NÀY
 * ════════════════════════════════════════════════════════════════════════════
 * Brief đợt 15 lô S khai: *"`predictionOverlay` vẫn chặn ... vì
 * `station_dwell_time` mới nhất 17 ngày"*. Đo lại tại nguồn thì KHÔNG PHẢI:
 *
 *   `digitalTwinRouter.predictionOverlay`  → CHỈ `getWipCountSeries(...)`
 *                                            → đọc **`wip_tracking`**
 *   `digitalTwinRouter.stationLoadHeatmap` → `getStationDwellAgg(...)`
 *                                            → đọc **`station_dwell_time`**
 *
 * Hai thủ tục, hai bảng. `station_dwell_time` có cũ 17 ngày hay mới 1 phút thì
 * `predictionOverlay` cũng KHÔNG đổi một bit — nó chặn vì `wip_tracking` không
 * có ≥3 bucket trong 24 giờ.
 *
 * ⇒ Vì sao vẫn sinh bảng này: G50. `stationLoadHeatmap` là một lớp phủ THẬT
 *   đang trống vì đúng lý do brief mô tả, chỉ gán nhầm tên thủ tục. Sửa nguồn
 *   đúng thì cả hai lớp phủ cùng sống; sửa theo brief thì lớp phủ dự báo vẫn
 *   trống và không ai biết vì sao.
 *
 * ★★★ NÚT THẮT PHẢI TRÙNG NÚT THẮT WIP
 * `stationLoadHeatmap` tô theo `avgDwellMs`, còn cột WIP tô theo `soWipCuaTram`.
 * Hai lớp phủ vẽ trên CÙNG một cảnh, cho CÙNG một chuyền. Nếu trạm dwell cao
 * nhất khác trạm WIP cao nhất, màn hình tự mâu thuẫn — đúng lỗi Đợt 8 đo được
 * trên dữ liệu thật, và không phép đo tự động nào phân biệt được nó với một lỗi
 * ghép nối. Nên dwell dùng CHÍNH `tramNghenCuaLine` mà WIP dùng.
 */
export function sinhDwellChoLine(
  maNhaMay: string,
  lineId: number,
  tramCuaLine: readonly TramTai[],
  bayGio: number,
): HangDwell[] {
  const ra: HangDwell[] = [];
  if (tramCuaLine.length === 0) return ra;
  const nghen = tramNghenCuaLine(lineId, tramCuaLine.length);
  for (const t of tramCuaLine) {
    const rnd = taoNgauNhien(bamChuoi(`dwell:${maNhaMay}:${lineId}:${t.thuTu}`));
    for (let i = 0; i < DWELL_MOI_TRAM; i++) {
      // Rải mốc đều trong cửa sổ, khe 0 = xa nhất. Cùng cách rải như WIP.
      const enteredAtMs =
        bayGio - CUA_SO_DWELL_MS + Math.round((i * CUA_SO_DWELL_MS) / DWELL_MOI_TRAM);
      // Trạm nghẽn: dwell gấp bội và phần lớn thời gian là BLOCKED (hàng phía
      // sau không nhận được) — đó là hình dạng vật lý của một nút thắt thật.
      // Trạm thường: dwell thấp, phần chờ chủ yếu là STARVED (đói hàng).
      const laNghen = t.thuTu === nghen;
      const processingMs = 8_000 + Math.floor(rnd() * 4_000); // 8–12s, mọi trạm
      const blockedMs = laNghen ? 45_000 + Math.floor(rnd() * 20_000) : Math.floor(rnd() * 2_000);
      const starvedMs = laNghen ? Math.floor(rnd() * 2_000) : 3_000 + Math.floor(rnd() * 5_000);
      // dwell = tổng thời gian nằm ở trạm. Phải ≥ ba thành phần cộng lại, nếu
      // không thì hàng tự mâu thuẫn (một trạm "chờ" lâu hơn cả lúc nó ở đó).
      const dwellMs = processingMs + blockedMs + starvedMs;
      ra.push({
        lineId,
        stationId: t.stationId,
        machineId: t.machineId,
        serialNumber: `${maNhaMay}-DWL-${lineId}-${t.stationId}-${i}`,
        dwellMs,
        processingMs,
        starvedMs,
        blockedMs,
        enteredAtMs,
        exitedAtMs: enteredAtMs + dwellMs,
      });
    }
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SINH KIỂM TRA SẢN PHẨM (cho `defectHeatmap`)                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `product_inspections` cho một máy.
 *
 * ★ Tỉ lệ NG KHÔNG đều giữa các máy — `defectHeatmap` trả `ngRate` và lớp nhiệt
 *   tô theo nó. Mọi máy cùng tỉ lệ ⇒ bản đồ nhiệt MỘT MÀU, tức là một lớp phủ
 *   "có dữ liệu" nhưng không mang tin nào. Cùng họ với bẫy WIP phẳng ở trên.
 */
export function sinhKiemTraChoMay(
  maNhaMay: string,
  machineId: number,
  bayGio: number,
): HangKiemTra[] {
  const rnd = taoNgauNhien(bamChuoi(`kt:${maNhaMay}:${machineId}`));
  // Tỉ lệ NG mục tiêu 0–25%, tất định theo máy.
  const tiLeNg = rnd() * 0.25;
  const ra: HangKiemTra[] = [];
  for (let i = 0; i < KIEM_TRA_MOI_MAY; i++) {
    const inspectionTimeMs =
      bayGio - CUA_SO_KIEM_TRA_MS + Math.round((i * CUA_SO_KIEM_TRA_MS) / KIEM_TRA_MOI_MAY);
    ra.push({
      machineId,
      serialNumber: `${maNhaMay}-INS-${machineId}-${i}`,
      overallResult: rnd() < tiLeNg ? "NG" : "OK",
      inspectionTimeMs,
    });
  }
  return ra;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SINH SỨC KHOẺ MÁY                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `machine_health_history` — một bản ghi/máy, mốc gần hiện tại.
 *
 * `digitalTwin.twinState` lấy bản ghi `timestamp` mới nhất mỗi máy rồi đưa vào
 * `colorForTwin(operationStatus, healthScore)`. Điểm sức khoẻ trải rộng 40–99
 * để màu twin có nhiều hơn một giá trị — cùng lý do như tỉ lệ NG ở trên.
 */
export function sinhSucKhoeChoMay(
  maNhaMay: string,
  machineId: number,
  machineCode: string,
  bayGio: number,
): HangSucKhoe {
  const rnd = taoNgauNhien(bamChuoi(`sk:${maNhaMay}:${machineId}`));
  const healthScore = 40 + Math.floor(rnd() * 60); // 40–99
  return {
    machineId,
    machineCode,
    timestampMs: bayGio - TUOI_HEARTBEAT_MS,
    healthScore,
    oeeScore: Math.max(0, Math.min(100, healthScore + Math.floor(rnd() * 11) - 5)),
    uptimeScore: Math.max(0, Math.min(100, healthScore + Math.floor(rnd() * 11) - 5)),
    errorRateScore: Math.max(0, Math.min(100, healthScore + Math.floor(rnd() * 11) - 5)),
    cycleTimeScore: Math.max(0, Math.min(100, healthScore + Math.floor(rnd() * 11) - 5)),
    // Rủi ro hỏng NGƯỢC chiều sức khoẻ — không phải một số ngẫu nhiên thứ hai.
    predictedFailureRisk: Math.max(0, Math.min(100, 100 - healthScore)),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SINH ANDON                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Lý do andon theo thứ tự enum `andonreasonenum` (đo bằng `enum_range`). */
export const LY_DO_ANDON = Object.freeze([
  "quality", "material", "maintenance", "safety", "setup", "other",
] as const);

/**
 * Andon cho ĐÚNG trạm nút thắt của mỗi line — không rải ngẫu nhiên.
 *
 * Cảnh báo phải TRÙNG chỗ nghẽn thì màn hình mới tự nhất quán: dải cảnh báo,
 * cột WIP và nút thắt cùng chỉ một trạm. Rải ngẫu nhiên sẽ cho một màn hình
 * "có cảnh báo" mà cảnh báo nói một đằng, WIP nói một nẻo — và không phép đo
 * nào phân biệt được nó với một lỗi ghép nối thật.
 */
export function sinhAndonChoLine(
  lineId: number,
  tramCuaLine: readonly TramTai[],
  bayGio: number,
): HangAndon[] {
  if (tramCuaLine.length === 0) return [];
  const nghen = tramNghenCuaLine(lineId, tramCuaLine.length);
  const t = tramCuaLine[nghen];
  if (!t) return [];
  const rnd = taoNgauNhien(bamChuoi(`andon:${lineId}`));
  const lyDo = LY_DO_ANDON[Math.floor(rnd() * LY_DO_ANDON.length)];
  return [
    {
      lineId,
      stationId: t.stationId,
      machineId: t.machineId,
      state: rnd() < 0.5 ? "red" : "yellow",
      reason: lyDo,
      status: "raised",
      title: `Un tac tai tram ${t.thuTu + 1} (tai tong hop)`,
      raisedAtMs: bayGio - 15 * 60 * 1000,
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SINH CÂN BẰNG LINE                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `line_balance_metrics` — lời khai nút thắt của server.
 *
 * ★★★ `bottleneckStationId` PHẢI trỏ đúng trạm mà WIP cũng đang cao nhất.
 *
 * `laNghen` cho lời khai server THẮNG khi còn hạn 8 giờ. Nếu ta khai một trạm
 * KHÁC với trạm WIP cao, ta tái tạo lại đúng lỗi mà Đợt 8 đã đo trên dữ liệu
 * thật: cột đỏ nằm ở trạm 124 WIP trong khi trạm 3.152 WIP vẽ bình thường. Ở
 * đây ta có toàn quyền chọn, nên chọn cho hai đường ĐỒNG Ý — và bài test giữ
 * ràng buộc đó, để một lần sửa cẩu thả sau này không âm thầm phá nó.
 */
export function sinhCanBangLine(
  lineId: number,
  tramCuaLine: readonly TramTai[],
  bayGio: number,
): HangCanBangLine | null {
  if (tramCuaLine.length === 0) return null;
  const nghen = tramNghenCuaLine(lineId, tramCuaLine.length);
  const t = tramCuaLine[nghen];
  if (!t) return null;
  const tongWip = tramCuaLine.reduce((a, x) => a + soWipCuaTram(x, nghen), 0);
  return {
    lineId,
    periodStartMs: bayGio - TUOI_LINE_BALANCE_MS - 60 * 60 * 1000,
    periodEndMs: bayGio - TUOI_LINE_BALANCE_MS,
    bottleneckStationId: t.stationId,
    bottleneckMachineId: t.machineId,
    utilizationPct: 72.5,
    balanceRatePct: 64.0,
    throughputUnits: 480,
    wipCount: tongWip,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TRẠNG THÁI + NHỊP TIM MÁY — nguồn THẬT của MÀU trên cảnh                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ ĐÂY LÀ THỨ QUYẾT ĐỊNH MÀU MÁY — KHÔNG PHẢI `machine_health_history`.
 *
 * Đo được (lô P, 2026-09-07) bằng cách truy đường dữ liệu THẬT của cảnh:
 * màu instance không đi qua `digitalTwin.twinState`. Nó đi qua
 *
 *   `db/twinCanh.traTrangThaiHangLoat` → socket `twin:trangThai`
 *     → `khoTrangThai.apDung` → `trungThucDuLieu.trangThaiHienThi`
 *
 * và hàm đó đọc ĐÚNG HAI cột: `machines.operationStatus` (giá trị được báo cáo)
 * và tuổi = `max(machine_heartbeats.timestamp, machines.lastHeartbeat)`.
 *
 * ⇒ Sinh `machine_health_history` mà KHÔNG đặt `lastHeartbeat` thì 240 máy sẽ
 *   hiện **xám `khong_ro`** hết — vì `trangThaiHienThi` cho `khong_ro` THẮNG mọi
 *   trạng thái được báo cáo khi dữ liệu quá hạn. Cảnh dựng được, 240 khối vẽ ra,
 *   và không khối nào mang màu vận hành nào. Đúng bẫy G5 ở dạng tinh vi nhất:
 *   lớp phủ KHÔNG trống (có 240 máy) nhưng mọi ô đều là "không biết".
 *
 * ★ `machines.lastHeartbeat` là cột của một hàng ta TỰ TẠO ⇒ đặt nó KHÔNG chạm
 *   dữ liệu gốc, và gỡ máy là gỡ luôn cột. Không cần bảng phụ nào.
 */

/** 8 giá trị `operationstatusenum` — đo bằng `enum_range(NULL::operationstatusenum)`. */
export const TRANG_THAI_VAN_HANH: readonly string[] = Object.freeze([
  "running", "stopped", "error", "maintenance",
  "warming_up", "changeover", "starved", "blocked",
]);

/**
 * Trạng thái vận hành của một máy — tất định, ĐA DẠNG có chủ đích.
 *
 * ~70% `running`, phần còn lại rải qua `stopped/error/maintenance/warming_up/
 * changeover/starved/blocked`. Mọi máy cùng `running` cho một cảnh MỘT MÀU —
 * cùng lớp lỗi như WIP phẳng và tỉ lệ NG phẳng: có dữ liệu, không mang tin.
 */
export function trangThaiCuaMay(maNhaMay: string, machineId: number): string {
  const rnd = taoNgauNhien(bamChuoi(`tt:${maNhaMay}:${machineId}`));
  const x = rnd();
  if (x < 0.7) return "running";
  if (x < 0.78) return "stopped";
  if (x < 0.84) return "error";
  if (x < 0.89) return "maintenance";
  if (x < 0.93) return "warming_up";
  if (x < 0.96) return "changeover";
  if (x < 0.98) return "starved";
  return "blocked";
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CẦU CHÌ                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ Cầu chì G30: mốc thời gian có lọt qua CẢ BA cửa lọc tuổi không.
 *
 * Gọi SAU KHI ghi, trên mốc ĐỌC LẠI TỪ DB — không phải trên biến trong bộ nhớ.
 * Đo biến mình vừa đặt là `f(x)=x`: nó xanh kể cả khi `INSERT` ghi sai kiểu,
 * sai múi giờ, hoặc trigger đổi giá trị.
 */
export function mocConHieuLuc(mocMs: number, bayGio: number, hanMs: number): boolean {
  if (!Number.isFinite(mocMs)) return false;
  const tuoi = bayGio - mocMs;
  // Mốc TƯƠNG LAI cũng là hỏng: một hàng "sẽ xảy ra" lọt cửa `gte(since)` nhưng
  // nó là dấu hiệu sai múi giờ, không phải dữ liệu tốt.
  return tuoi >= 0 && tuoi <= hanMs;
}
