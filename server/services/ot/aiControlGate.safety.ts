/**
 * L-7 — Cầu nối đọc trạng thái safety-PLC cho cổng AI.
 *
 * TÁCH RIÊNG KHỎI `aiControlGate.ts` CÓ CHỦ ĐÍCH:
 *   `aiControlGate.ts` phải là **hàm thuần** — không I/O, không DB, không import
 *   dây chuyền adapter/driver. Đó là điều kiện để nó test được không cần môi
 *   trường, và cũng là điều kiện để đọc nó mà tin được.
 *
 *   Nhưng cổng vẫn cần BIẾT trạng thái safety. Giải: cổng nhận trạng thái qua
 *   THAM SỐ; tệp này là chỗ duy nhất thực sự đi đọc, và chỗ gọi tool sẽ dùng nó
 *   để lấy giá trị rồi truyền vào cổng.
 *
 * ★ FAIL-CLOSED: mọi đường thất bại — không đọc được, ném lỗi, cấu hình thiếu —
 *   đều trả `"UNKNOWN"`. Và `kiemCongAi` coi `"UNKNOWN"` là TỪ CHỐI. Nên một
 *   lỗi ở tệp này KHÔNG BAO GIỜ biến thành một lệnh lọt xuống máy.
 *
 *   (So sánh: `commandDispatcher.preflightSafety` cũng trả `"UNKNOWN"` khi lỗi,
 *   nhưng ở đó `"UNKNOWN"` nghĩa là CHO QUA. Cùng một giá trị, hai số phận
 *   ngược nhau — khác biệt nằm ở người tiêu thụ, không ở người đo.)
 */

import type { TrangThaiSafety } from "./aiControlGate";

/**
 * Đọc trạng thái safety-PLC cho một adapter, dùng CHÍNH đường đọc mà dispatcher
 * dùng (adapter facade → `driver.getSafetyStatus` → bộ đọc safety-PLC).
 *
 * CHỈ ĐỌC. Không ghi gì, không gửi lệnh nào xuống thiết bị.
 *
 * @returns `"OK"` | `"BLOCKED"` | `"UNKNOWN"` — mọi thất bại ⇒ `"UNKNOWN"`.
 */
export async function preflightSafetyChoAi(
  adapterId: number,
  machineId?: number | null,
): Promise<TrangThaiSafety> {
  try {
    // import động: giữ `aiControlGate.ts` (và test của nó) hoàn toàn không dính
    // dây chuyền adapter/driver.
    const { createAdapterFacade } = await import("./adapterFacade");
    const state = await createAdapterFacade({
      adapterId,
      machineId: machineId ?? undefined,
    }).getSafetyStatus();

    // ★ Trường là `state`, KHÔNG phải `status` (SafetyState trong otDriver.ts:136).
    //   Đọc nhầm tên trường ở đây sẽ trả UNKNOWN VĨNH VIỄN mà không báo lỗi gì —
    //   fail-closed nên "an toàn", nhưng cổng sẽ chặn 100% lệnh kể cả khi
    //   safety-PLC đang OK, và không ai biết vì sao. Đối chiếu:
    //   commandDispatcher.ts:171 đọc đúng `state.state`.
    const raw = (state as { state?: unknown } | null | undefined)?.state;
    if (raw === "OK" || raw === "BLOCKED" || raw === "UNKNOWN") return raw;

    // Hình dạng lạ ⇒ không dám suy diễn ⇒ UNKNOWN (⇒ AI bị chặn).
    return "UNKNOWN";
  } catch {
    // Ném lỗi ⇒ UNKNOWN, KHÔNG BAO GIỜ tự ý coi là OK.
    return "UNKNOWN";
  }
}
