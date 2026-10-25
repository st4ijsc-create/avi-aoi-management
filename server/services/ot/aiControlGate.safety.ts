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
 *   (So sánh: `commandDispatcher.preflightSafety` cũng trả `"UNKNOWN"` khi lỗi; từ
 *   doc 81 Đợt 1B Task 6 dispatcher cũng CHẶN `"UNKNOWN"` (SAFETY_UNKNOWN) — trước
 *   đó ở đó `"UNKNOWN"` nghĩa là CHO QUA.)
 */

import { and, eq, inArray } from "drizzle-orm";
import type { MucRuiRo, TrangThaiSafety } from "./aiControlGate";
import { getDb } from "../../db/connection";
import { deviceTags } from "../../../drizzle/schema";
import { mucTacDongKenh } from "../scada/kenhScada";

/**
 * SCADA R1a T10 (K5) — mức KÊNH của một lệnh AI `(adapterId, writes, commandType)` cho cổng AI (`DauVaoCongAi.mucKenh`) và cho
 * sàn vai + 2FA lúc `confirmAction`. CHỈ ĐỌC `device_tags`.
 *
 * Hai kết cục:
 *   · `{ dungGhim: true }` — fix round 1, phán quyết c1: lệnh là một DỪNG GHIM — lệnh loại dừng (`isStopCommandType`, cùng hàm
 *     dispatcher) mà TOÀN BỘ writes khớp `device_tags.stop_value` (MỘT `matchPinnedStop` trên `stopPinsFromTagRows` của chính các
 *     hàng tag đích — đúng luật cả-lệnh của dispatcher: tag ghim, giá trị ghim, không trùng). Người gọi dùng mức của TOOL, KHÔNG
 *     lấy max với mức kênh (kênh chưa khai = 5 không được chặn một DỪNG ghim). Lệnh dừng trộn ghim với BẤT KỲ write nào khác /
 *     sai giá trị ⇒ không phải dừng ghim ⇒ nhánh dưới.
 *     kiem-dinh R1b-1 I-A (fix round 2, 2026-10-25): chỉ ghim ĐỦ ĐIỀU KIỆN STOP (`phanLoaiGhimStopHmi(...).gui` — tag `actuationLevel ≤ 1`, NULL ⇒ 5 ⇒
 *     không đủ; CÙNG luật STOP HMI / khảo sát khả năng dừng) mới được coi là dừng ghim. Ghim trên tag mức cao / chưa khai mức (vd. ghim cũ do
 *     operator đặt trước H1 a) ⇒ KHÔNG phải dừng ghim ⇒ mức kênh (5 ⇒ AI từ chối MUC_QUA_CAO).
 *   · `{ dungGhim: false, muc }` — mức CAO NHẤT của các kênh đích.
 *
 * ★ FAIL-CLOSED: không có write / tagKey không phải chuỗi khác rỗng / adapter không hợp lệ / CSDL vắng / truy vấn ném / MỘT tag
 *   không tìm thấy ⇒ `muc: 5`. Cột `actuation_level` NULL ⇒ 5 (`mucTacDongKenh`). Lỗi ở nhánh ghim ⇒ không phải dừng ghim.
 */
export type MucKenhAi = { dungGhim: true } | { dungGhim: false; muc: MucRuiRo };

const MUC_5: MucKenhAi = Object.freeze({ dungGhim: false, muc: 5 }) as MucKenhAi;

export async function mucKenhChoAi(
  adapterId: number,
  writes: ReadonlyArray<{ tagKey: string; value: unknown }>,
  commandType?: string | null,
): Promise<MucKenhAi> {
  try {
    if (!Number.isInteger(adapterId) || adapterId <= 0) return MUC_5;
    if (!Array.isArray(writes) || writes.length === 0) return MUC_5;
    if (writes.some((x) => !x || typeof x.tagKey !== "string" || x.tagKey === "")) return MUC_5;
    const keys = [...new Set(writes.map((x) => x.tagKey))];
    const db = await getDb();
    if (!db) return MUC_5;
    const rows = await db
      .select({
        tagKey: deviceTags.tagKey,
        actuationLevel: deviceTags.actuationLevel,
        dataType: deviceTags.dataType,
        stopValue: deviceTags.stopValue,
        writable: deviceTags.writable,
        isEnabled: deviceTags.isEnabled,
      })
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapterId), inArray(deviceTags.tagKey, keys)));

    if (typeof commandType === "string" && commandType !== "") {
      // import động: giữ mô-đun này nhẹ (dispatcher + stopPin kéo cả dây chuyền audit/bảo mật).
      const { isStopCommandType } = await import("./commandDispatcher");
      if (isStopCommandType(commandType)) {
        const { matchPinnedStop, phanLoaiGhimStopHmi } = await import("./stopPin");
        // I-A — CHỈ ghim đủ điều kiện STOP (mức ≤ 1); một luật cho STOP HMI, AI machine_stop và khảo sát khả năng dừng.
        const ghim = matchPinnedStop(phanLoaiGhimStopHmi(rows).gui, writes.map((x) => ({ tagKey: x.tagKey, value: x.value })));
        if (ghim.ok) return { dungGhim: true };
      }
    }

    let muc: MucRuiRo = 1;
    for (const k of keys) {
      const r = rows.find((x) => x.tagKey === k);
      if (!r) return MUC_5;
      const m = mucTacDongKenh(r);
      if (m > muc) muc = m;
    }
    return { dungGhim: false, muc };
  } catch {
    return MUC_5;
  }
}

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
