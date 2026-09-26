/**
 * ★★★ G7 (audit 2026-09-21 · P8) — **TRẦN SỰ-THẬT-THIẾT-BỊ**: dư địa không bao giờ được lớn hơn
 * số byte card THỰC SỰ còn trống.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC — BROKER HỨA 22 GiB KHI CARD CÒN 3 GiB
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đo sống hai lần, hai cấu hình khác nhau, cùng một hình dạng sai:
 *
 *   | thiết bị còn trống | broker khai rawBytes | broker khai effective |
 *   |--------------------|----------------------|-----------------------|
 *   | 2,65 GiB           | **27,88 GiB**        | 24,66 GiB             |
 *   | 3,15 GiB           | **22,03 GiB**        | 19,03 GiB             |
 *
 * Và hậu quả KHÔNG phải giả thuyết — sổ `vram_events` ghi nguyên văn chuỗi:
 *   `reserve 16.846 MB → driver_refused → release → retry` (lặp)
 * tức **broker CẤP PHÉP, driver TỪ CHỐI**. Một lượt nạp 16,7 GB được duyệt trên một card còn
 * 3 GB, 79 lần trong một phiên, mỗi lần đốt ~30 s. Đó là cái giá của một con số lạc quan.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GỐC RỄ — `attributable` KHÔNG BAO GỒM TIẾN TRÌNH NGOÀI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Công thức là `headroom = trần − max(sổ, attributable) − đệm`, với
 * `attributable = deviceUsed − baselineUsed`. Nó trả lời *"TA đã tiêu bao nhiêu kể từ lúc chụp nền"*.
 *
 * Một `llama-server` khởi động **SAU** lúc chụp nền giữ 23,5 GB mà **không nằm trong nền** (nền
 * chụp trước) và **không nằm trong sổ** (nó không phải hộ của ta) ⇒ nó rơi vào "không quy trách
 * nhiệm được", và công thức **không trừ nó**. Khi `baseline.verified = false` (nền quá cũ — đúng
 * trạng thái đo được cả hai lần) thì sai số này là HỆ THỐNG, không phải ngẫu nhiên.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO VÁ Ở ĐÂY, VÀ VÌ SAO NÓ KHÔNG PHÁ BẤT BIẾN CỦA `vramEnforcement`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vramEnforcement` có một bất biến viết ra: *"không nhánh nào trả về một số LỚN HƠN
 * `headroomBytes`; thêm một lý do thì con số chỉ có thể NHỎ ĐI"*. Hàm này là một phép **MIN**, nên
 * nó **chỉ có thể làm nhỏ đi** — đúng hình dạng mà file kia cho phép siết.
 *
 * ⚠ Nó KHÔNG sửa `computeHeadroom()`: phép `max(sổ, attributable)` ở đó vẫn đúng với câu hỏi nó
 *   trả lời. Cái thiếu là một câu hỏi THỨ HAI — *"card còn trống thật bao nhiêu?"* — và câu đó chỉ
 *   có một nguồn: chính thiết bị.
 * ⚠ `null` (chưa đo được thiết bị) ⇒ **KHÔNG cap**, giữ nguyên hành vi cũ. Đây là chỗ duy nhất
 *   trong file có thể bị đọc nhầm là "fail-open": nó không nới gì cả, nó chỉ không siết thêm — và
 *   mọi lý do suy giảm cũ (`no-tick`, `probe-blind`, `unverified-baseline`) vẫn áp nguyên.
 */

/** Số đọc được của THIẾT BỊ ở nhịp gần nhất. `null` ở bất kỳ ô nào ⇒ coi như chưa đo được. */
export interface SoThietBi {
  readonly totalBytes: number | null;
  readonly usedBytes: number | null;
}

const huuHan = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Byte card THỰC SỰ còn trống, sau khi đã chừa đệm an toàn. `null` = không tính được.
 * Hàm THUẦN.
 *
 * ⚠ Không kẹp về 0: card đã tiêu quá đệm thì con số ÂM là SỰ THẬT, và độ lớn phần âm là thông tin
 *   của lời từ chối — cùng kỷ luật với `computeHeadroom` ("KHÔNG kẹp về 0").
 */
export function tranTheoThietBi(tb: SoThietBi | null | undefined, demAnToanBytes: number): number | null {
  if (!tb) return null;
  if (!huuHan(tb.totalBytes) || !huuHan(tb.usedBytes)) return null;
  if (tb.totalBytes <= 0 || tb.usedBytes < 0) return null;
  const dem = huuHan(demAnToanBytes) && demAnToanBytes >= 0 ? demAnToanBytes : 0;
  return tb.totalBytes - tb.usedBytes - dem;
}

export interface KetQuaCap {
  readonly bytes: number;
  /** `true` ⇔ trần thiết bị THẮNG, tức con số cũ là một lời hứa card không giữ nổi. */
  readonly daCap: boolean;
  /** Phần bị cắt đi (≥ 0). Đây là con số đáng đưa vào nhật ký/lời từ chối. */
  readonly catBotBytes: number;
}

/**
 * Áp trần: `min(hieuLuc, tranThietBi)`. Không có số thiết bị ⇒ trả nguyên `hieuLuc`.
 * Hàm THUẦN, và **chỉ có thể trả về số ≤ `hieuLuc`** — đó là toàn bộ hợp đồng của nó.
 */
export function apTranThietBi(hieuLuc: number, tran: number | null): KetQuaCap {
  if (tran === null || !huuHan(tran) || !huuHan(hieuLuc)) {
    return { bytes: hieuLuc, daCap: false, catBotBytes: 0 };
  }
  if (tran >= hieuLuc) return { bytes: hieuLuc, daCap: false, catBotBytes: 0 };
  return { bytes: tran, daCap: true, catBotBytes: hieuLuc - tran };
}
