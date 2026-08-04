/**
 * ★★★ Pha 2B Task 5 — CHÍNH SÁCH SUY GIẢM: biến những thứ hệ **BIẾT** thành những thứ hệ **LÀM**.
 *
 * Task 2 dựng `computeHeadroom()` và để lại `blind` · `trusted` · `degradedReasons` · `baselineVerified`
 * với một câu bàn giao thẳng: *"chính sách 'mù thì chặt hơn' là của Task 5"*. File này là chính sách
 * đó, và nó chỉ có MỘT hình dạng đầu ra:
 *
 *     effective = headroomBytes − biênTuổiTick − byteĐãChạyNgoàiSổ − phụPhíMẤTTINCẬY
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO CẢ BA SỐ HẠNG ĐỀU **TRỪ**, KHÔNG SỐ HẠNG NÀO CỘNG — VÀ ĐÓ LÀ TOÀN BỘ BẤT BIẾN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vì `headroom = trần − max(L, A) − đệm` và `max(L, A) ≥ L`, **`attributableBytes = null` là CHẶN
 * TRÊN của mọi headroom**. Nên mọi phản ứng kiểu *"không chắc thì rơi về chỉ-sổ"* là một phép **LÀM
 * LỎNG**, không phải suy biến an toàn (ràng buộc toàn cục 10, đính chính 2026-08-04).
 *
 * ⇒ Bất biến của file này, và là thứ có ca test khoá cho MỌI tập con lý do:
 *
 *     applyEnforcement(x).effectiveHeadroomBytes  ≤  x.headroom.headroomBytes,
 *     và THÊM một lý do bất kỳ thì con số đó chỉ có thể NHỎ ĐI.
 *
 * Không có nhánh nào trong file này trả về một số LỚN HƠN `headroomBytes`. Nếu một bản sửa tương lai
 * cần "nới" ở đâu đó, nó phải nới bằng cách sửa `computeHeadroom()` (nơi có phép `max`), không phải
 * bằng cách cộng vào đây — cộng vào đây là mở đúng cái cửa mà cả pha này tồn tại để đóng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ TICK CŨ LÀ **PHẠM TRÙ THỨ BA**, KHÔNG PHẢI MỘT ĐƯỜNG `blind`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một tick cũ khai **số có thể sai kèm dấu ĐÁNG TIN** (`blind: false`, `trusted` có thể `true`).
 * Chính sách hết hạn ĐÚNG là **GIỮ số và CỘNG một biên theo tuổi** rồi hạ `trusted` — **TUYỆT ĐỐI
 * không** đi qua `attributableBytes = null`, vì đó là tự nâng dư địa lên chặn TRÊN, tức phản ứng với
 * *"số của tôi có thể đã cũ"* bằng *"vậy coi như thiết bị trống"*.
 *
 * ⚠ VÀ BIÊN PHẢI CÓ TRẦN. Tốc độ cấp phát lớn nhất đo được (§5.6c chỉ đúng vật liệu này) là
 * **17.511.354.368 B / 11.000 ms ≈ 1,52 MiB/ms** — nhân với một tuổi 60 s đã ra **95 GB**, tức lớn
 * hơn cả tấm card ba lần. Một biên không trần biến "một nhịp đối chiếu chết" thành "từ chối 100%
 * lượt xin", và **một hệ từ chối mọi thứ thì không phải hệ cưỡng chế** — nó là một hệ đã dừng.
 * ⇒ Biên bị kẹp ở **một đơn vị mất-tin-cậy**, và phần vượt quá KHÔNG bị bịa thành số: nó hiện ra
 * bằng lý do `"stale-tick"` (+ `"tick-failing"` khi nhịp đang hỏng liên tiếp), tức bằng **tầm nhìn**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐƠN VỊ MẤT-TIN-CẬY LÀ MỘT **BIÊN**, KHÔNG PHẢI MỘT **ƯỚC LƯỢNG** CỦA PHẦN KHÔNG THẤY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phần không thấy được đo trong chính dự án này là: sidecar thị giác **7,8 GB** · ONNX/DirectML
 * **+339 MiB** · cron 03:00 **+1.251 MiB** · nền thiết bị **996–2.112 MiB**. Cộng hết lại rồi trừ đi
 * là **đóng băng cả hệ**: chỉ riêng sidecar đã chiếm một phần tư card. Nên con số ở đây CỐ Ý lấy
 * **cận DƯỚI** của dải đo được (996 MiB → làm tròn lên bội số 1.024) và tự khai đúng vai của nó:
 *
 *   > **một biên đủ để loại những lượt xin SÁT MÉP khi hệ không nhìn rõ — KHÔNG phải một lời hứa
 *   > rằng phần không thấy đã được tính vào.**
 *
 * Ai đọc con số này như một bảo đảm sẽ lặp lại đúng lỗi *"tuyên bố mạnh hơn mã"* đã bị bắt bảy lần
 * trong chuỗi này. Phần "không bảo đảm" nằm trong báo cáo Task 5, mục cùng tên.
 *
 * ⚠ Đọc `.env` ở MỖI lượt gọi (không đóng băng lúc nạp module) — cùng khuôn với
 * `vramLoadOutcome.vramLoadRetries()`: người vận hành phải chỉnh được mà không build lại.
 *
 * File này **thuần · đồng bộ · không import gì ngoài KIỂU** (`reserve()` phải giữ đồng bộ, ràng
 * buộc 1) và **KHÔNG BAO GIỜ NÉM** (một cú ném trên đường `reserve()` bị `vramWiring` nuốt và làm
 * mất luôn giấy phép — C-1 của Task 2).
 */
import type { HeadroomResult } from "./vramHeadroom";
import type { VramDegradationReason, VramUnledgeredFact } from "./vramRefusal";

const MIB = 1024 * 1024;

/**
 * ĐƠN VỊ MẤT-TIN-CẬY (BYTE). Mặc định **1.024 MiB** = cận DƯỚI đo được của nền thiết bị ngoài sổ
 * (996 MiB, làm tròn lên bội số 1.024). Xem khối docstring đầu file trước khi nâng nó lên "cho an
 * toàn": mỗi đơn vị là VRAM bị khoá khỏi mọi lượt nạp, và ở tiến trình `api` (mù VĨNH VIỄN — xem
 * `no-tick`) hệ luôn trả **ba** đơn vị.
 */
export const DISTRUST_UNIT_DEFAULT_BYTES = 1024 * MIB;

export function distrustUnitBytes(): number {
  const raw = Number(process.env.VRAM_DISTRUST_UNIT_MB);
  // ⚠ `0` HỢP LỆ và có nghĩa: người vận hành TẮT hẳn phụ phí mất-tin-cậy (hệ vẫn giữ `max(L,A)` và
  // đệm an toàn). Chỉ số vô nghĩa/âm mới về mặc định.
  return Number.isFinite(raw) && raw >= 0 ? raw * MIB : DISTRUST_UNIT_DEFAULT_BYTES;
}

/**
 * Tick già hơn mốc này ⇒ lý do `"stale-tick"`.
 *
 * ⚠ **120.000 ms KHÔNG PHẢI ngưỡng của cái CHUÔNG** (ràng buộc 8 cấm thừa kế `512 MiB` và cấm dùng
 * `alarm` boolean cho cưỡng chế). Nó là **HAI CHU KỲ XUẤT BẢN** của chính ô tick
 * (`startVramReconciler` chạy `__runReconcileTick()` mỗi 60 s): một nhịp lỡ là bình thường, hai
 * nhịp lỡ nghĩa là nguồn số đã hỏng. Cưỡng chế ở đây vẫn quyết định trên **SỐ** (`attributable` +
 * biên byte), không trên một cờ báo động.
 */
export const TICK_STALE_AFTER_MS = 120_000;

/**
 * Tốc độ cấp phát lớn nhất QUAN SÁT ĐƯỢC, dùng cho biên theo tuổi (§5.6c). Đo được: khối 30B
 * **17.511.354.368 B** nạp xong trong **11 s** (dải quan sát 11–43 s ⇒ lấy đầu NHANH nhất).
 */
export const OBSERVED_MAX_ALLOC_BYTES_PER_MS = Math.ceil(17_511_354_368 / 11_000);

/** Số đơn vị mất-tin-cậy cho mỗi lý do. Xem docstring đầu file để biết vì sao KHÔNG lớn hơn. */
const DISTRUST_UNITS: Record<VramDegradationReason, number> = {
  // `-Infinity` đã từ chối mọi lượt xin (fail-closed CÓ TÊN của Task 2) — cộng thêm phụ phí không
  // làm nó chặt hơn được nữa, chỉ làm con số khó đọc.
  "invalid-input": 0,
  // CẤU TRÚC, KHÔNG TỰ LÀNH (`api` mù vĩnh viễn) ⇒ nặng gấp đôi mù TẠM THỜI.
  "no-tick": 2,
  "probe-blind": 1,
  "unverified-baseline": 1,
  "stale-tick": 1,
  "tick-failing": 1,
  "unledgered-unasked": 1,
  // nhân với số lượt, KẸP ở 4 — xem `unknownUnits()`.
  "unledgered-unknown": 1,
};

/**
 * ⚠ KẸP Ở 4 ĐƠN VỊ, và đây là một giới hạn ĐƯỢC KHAI chứ không phải một chỗ quên: mỗi lượt cấp phát
 * chạy ngoài sổ mà không ước được byte là một khối VRAM có thật, kích thước không biết. Nhân tuyến
 * tính không trần thì đủ 32 lượt hỏng là hệ từ chối cả những lượt xin 0 byte — tức **dừng dây
 * chuyền vì cuốn sổ hỏng**, trong khi thiết bị có thể đang trống. Trần này đổi "từ chối tất cả" lấy
 * "chặt hơn + NÓI RA": lý do `"unledgered-unknown"` luôn có mặt trong câu từ chối, và
 * `vramRefusal.caveat` nâng nó lên mức nghiêm trọng cao nhất (*"đừng dùng con số này để tính"*).
 */
const UNKNOWN_UNITS_CAP = 4;

export interface EnforcementInput {
  /** Kết quả `computeHeadroom()` — nguồn của `headroomBytes` và bốn lý do đầu tiên. */
  readonly headroom: HeadroomResult;
  /**
   * `nowMs − tick.atMs` (BYTE-KHÔNG-LIÊN-QUAN: đây là mili giây). `null` ⇔ **KHÔNG CÓ TICK NÀO** —
   * ca đó đã có lý do `"no-tick"` riêng, không cộng thêm biên tuổi cho một con số không tồn tại.
   * ⚠ Số không hữu hạn / âm ⇒ coi như **tuổi không biết** ⇒ lấy TRẦN biên (chiều CHẶT).
   */
  readonly tickAgeMs: number | null;
  /** `VramTickRecord.consecutiveFailures`. `≥ 1` ⇒ ô tick sẽ KHÔNG tự lành ⇒ lý do riêng. */
  readonly tickConsecutiveFailures: number;
  /** `vramWiring.vramBeginFailureState()`. ⚠ `null` = **CHƯA HỎI**, KHÔNG phải "không có lượt nào". */
  readonly unledgered: VramUnledgeredFact;
}

export interface EnforcementDecision {
  /** Con số mà cưỡng chế thật sự so với lượt xin. **Luôn ≤ `headroom.headroomBytes`.** */
  readonly effectiveHeadroomBytes: number;
  /** Biên theo tuổi tick (BYTE) — đã kẹp trần. */
  readonly staleMarginBytes: number;
  /** Byte đã chạy NGOÀI SỔ, trừ như thứ **ĐÃ TIÊU** (bàn giao Task 3). */
  readonly unledgeredChargeBytes: number;
  /** Tổng phụ phí mất-tin-cậy (BYTE) = Σ đơn vị × `distrustUnitBytes()`. */
  readonly distrustChargeBytes: number;
  /** Mọi lý do, thứ tự CỐ ĐỊNH (so sánh trực tiếp được), gồm cả bốn lý do của `computeHeadroom`. */
  readonly reasons: readonly VramDegradationReason[];
  readonly trusted: boolean;
}

/** Số dùng được cho phép cộng trừ byte. Cùng vị từ với `vramHeadroom.usable()`. */
function huuHan(v: number): boolean {
  return Number.isFinite(v);
}

/**
 * Biên theo tuổi. **Không bao giờ trả `null`** — cả file này không có một đường nào biến một con số
 * đã có thành "không có số".
 */
function bienTheoTuoi(tickAgeMs: number | null, capBytes: number): number {
  if (tickAgeMs === null) return 0;
  // Tuổi không đọc được ⇒ CHẶT: lấy trần biên, không lấy 0.
  if (!huuHan(tickAgeMs) || tickAgeMs < 0) return capBytes;
  return Math.min(tickAgeMs * OBSERVED_MAX_ALLOC_BYTES_PER_MS, capBytes);
}

function unknownUnits(unknownCount: number): number {
  if (!huuHan(unknownCount)) return UNKNOWN_UNITS_CAP;   // không đếm được ⇒ chặt nhất
  if (unknownCount <= 0) return 0;
  return Math.min(Math.ceil(unknownCount), UNKNOWN_UNITS_CAP);
}

/**
 * Áp chính sách suy giảm lên một kết quả `computeHeadroom()`. Thuần, đồng bộ, KHÔNG BAO GIỜ NÉM.
 */
export function applyEnforcement(input: EnforcementInput): EnforcementDecision {
  const unit = distrustUnitBytes();
  const reasons: VramDegradationReason[] = [...input.headroom.degradedReasons];

  // ── biên theo tuổi ────────────────────────────────────────────────────────────────────────
  const staleMarginBytes = bienTheoTuoi(input.tickAgeMs, unit);
  const tuoiKhongDoc = input.tickAgeMs !== null && (!huuHan(input.tickAgeMs) || input.tickAgeMs < 0);
  if (input.tickAgeMs !== null && (tuoiKhongDoc || input.tickAgeMs > TICK_STALE_AFTER_MS)) {
    reasons.push("stale-tick");
  }
  // Nhịp đang hỏng LIÊN TIẾP: tuổi và "sẽ không tự lành" là HAI câu khác nhau (M-5, Task 2) — một
  // tick chưa tới hạn và một tick đã hỏng 5 lần có TUỔI GIỐNG NHAU.
  if (!huuHan(input.tickConsecutiveFailures) || input.tickConsecutiveFailures >= 1) {
    reasons.push("tick-failing");
  }

  // ── ống NGOÀI SỔ ──────────────────────────────────────────────────────────────────────────
  let unledgeredChargeBytes = 0;
  let donViUnknown = 0;
  if (input.unledgered === null) {
    reasons.push("unledgered-unasked");
  } else {
    const bytes = input.unledgered.bytes;
    if (huuHan(bytes) && bytes >= 0) {
      // ⚠ TRỪ NHƯ THỨ ĐÃ TIÊU (bàn giao Task 3). Đây là ƯỚC LƯỢNG: `fileBytes` của khối 30B CAO
      // HƠN số đo 170,8 MiB, còn reranker thì THẤP HƠN 2,1 lần ⇒ KHÔNG có hệ số chung để hiệu
      // chỉnh. Dùng nó làm TÍN DỤNG/TRẦN mới là chiều nguy hiểm; trừ đi thì không.
      unledgeredChargeBytes = bytes;
    } else if (bytes !== 0) {
      // Có ô byte nhưng số không dùng được ⇒ ngang một lượt "không ước được byte".
      donViUnknown = UNKNOWN_UNITS_CAP;
      reasons.push("unledgered-unknown");
    }
    const dv = unknownUnits(input.unledgered.unknownCount);
    if (dv > 0) {
      // ⚠ ĐỌC `unledgeredBytes` MÀ BỎ `unknownCount` LÀ CHIỀU NGUY HIỂM ĐÃ ĐƯỢC GỌI TÊN: mọi hộ
      // ONNX/sidecar/`gguf-context` đóng góp **0 byte** vào ô byte và **chỉ** hiện ở ô đếm này.
      donViUnknown = Math.max(donViUnknown, dv);
      if (!reasons.includes("unledgered-unknown")) reasons.push("unledgered-unknown");
    }
  }

  // ── phụ phí mất-tin-cậy ───────────────────────────────────────────────────────────────────
  let donVi = 0;
  for (const r of reasons) donVi += r === "unledgered-unknown" ? donViUnknown : DISTRUST_UNITS[r];
  const distrustChargeBytes = donVi * unit;

  /**
   * ⚠ MỘT PHÉP TRỪ, BA SỐ HẠNG, KHÔNG SỐ HẠNG NÀO ĐƯỢC ĐỔI DẤU. `-Infinity − hữu hạn = -Infinity`
   * (fail-closed giữ nguyên); không nhánh nào cho ra `NaN` vì cả ba số hạng đã được lọc hữu hạn.
   */
  const effectiveHeadroomBytes =
    input.headroom.headroomBytes - staleMarginBytes - unledgeredChargeBytes - distrustChargeBytes;

  return {
    effectiveHeadroomBytes,
    staleMarginBytes,
    unledgeredChargeBytes,
    distrustChargeBytes,
    // Đông cứng: `readonly` chỉ là kiểu, không chặn `push` lúc chạy — và danh sách này đi thẳng vào
    // câu từ chối mà người trực đọc.
    reasons: Object.freeze(reasons),
    trusted: reasons.length === 0,
  };
}
