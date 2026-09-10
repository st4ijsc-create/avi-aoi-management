/**
 * trangThaiMayTuoi.ts — ★★★ MỘT HỢP ĐỒNG TRẠNG THÁI MÁY (Đợt 34 · Pareto #1 của QA Đợt 32).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — SỐ ĐO CỦA CHÍNH DB NÀY, KHÔNG PHẢI LÝ THUYẾT
 * ════════════════════════════════════════════════════════════════════════════
 * Đo 2026-09-10 trên `aoi_management` (SQL thô, `.qa-dot34/db.mjs` — đường ĐỘC LẬP với tRPC):
 *
 *   · **43/43** máy có `machine_status_logs` mới nhất = `online`, ghi lúc 2026-09-06 11:51 — **42 máy
 *     trong cùng ~8 giây**, ngay sau 42 hàng `offline` lúc 11:50:15. Đó là MỘT lần simulator/server
 *     khởi động lại, không phải 42 máy cùng báo cáo.
 *   · `machine_heartbeats` mới nhất của MỌI máy = 2026-07-16 (**54 ngày**); `machines.lastHeartbeat` cũng vậy.
 *   · máy 18 `operationStatus = running` ⇒ `mapMachineStatus("online", "running")` cũ trả **"running"**
 *     cho một máy im lặng 54 ngày; máy 14 `stopped` ⇒ **"idle"**.
 *   · `assetCockpitService` cũ: `connected = status==="online" || hb < 5′` ⇒ nhánh đầu **không có tuổi**
 *     ⇒ **"ONLINE · Connected"** cho cùng máy ấy.
 *
 * Hệ quả người dùng thấy (QA Đợt 32 a4/a9): trên MỘT màn `/twin/may/14`, chip twin "Unknown · 54 days"
 * đứng cạnh header cockpit "ONLINE · Connected"; `/twin` "Unknown 41" trong khi `/factory-command`
 * "Idle/Running" — **cùng một API**. Bốn hợp đồng, bốn câu, cho một máy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BRIEF ĐỢT 34 SAI Ở TIỀN ĐỀ (G83) — VÀ MODULE NÀY LÀM KHÁC BRIEF, CÓ CHỦ Ý
 * ════════════════════════════════════════════════════════════════════════════
 * Brief: *"log `online` cũ hơn ngưỡng ⇒ không phải running"* — gate theo **tuổi của hàng log**.
 * Đọc người ghi `machine_status_logs`:
 *   · `machinePresenceService.recordPresence` — *"CHỐNG TRÙNG: chỉ ghi khi trạng thái ĐỔI"*;
 *   · `_core/socket.ts:320/440/605/786` — ghi lúc máy **connect / disconnect / approve / sync**.
 * ⇒ Hàng log là **SỰ KIỆN CHUYỂN TRẠNG THÁI**, không phải nhịp định kỳ. Một máy nối ổn định 3 ngày
 *   có đúng MỘT hàng `online` 3 ngày tuổi — gate theo tuổi log sẽ tô nó `offline` sau 5 phút. Gate ấy
 *   không giết máy chết, nó giết **máy sống**.
 *
 * Đợt 6 đã đo và ghim đúng điều này ở `db/twinCanh.ts` `chonNguonMocTuoi` (THƯỜNG-4): *"mốc tươi CHỈ
 * lấy từ NHỊP TIM… một hàng log trạng thái là SỰ KIỆN, không phải phép đo 'máy này còn nói chuyện với
 * ta không'"*. Kho realtime của twin (`twin:trangThai`) đã đi theo luật đó từ Đợt 6. Nên hợp đồng
 * MỘT của Đợt 34 là **đưa fleet API và cockpit về CÙNG luật ấy**, không phải đẻ luật thứ hai theo
 * tuổi log — hai luật ở hai tầng sẽ cho `/twin/may/14` một cặp mốc 3 ngày ↔ 54 ngày lật nhau mỗi khi
 * gói socket tới.
 *
 * ⇒ BẰNG CHỨNG KẾT NỐI = NHỊP TIM (mốc `max(machines.lastHeartbeat, machine_heartbeats)`, đúng
 *   `chonNguonMocTuoi`) còn tươi; hàng log `offline` chỉ THẮNG khi nó được ghi **SAU** nhịp tim cuối
 *   (máy ngắt kết nối rồi, nhịp tim cũ hơn không cứu được). Log `online` tự nó không chứng minh gì.
 *
 * ★ Module THUẦN: không DB, không `Date.now()` ẩn — `now` luôn là THAM SỐ, test tất định.
 * ★ FAIL-CLOSED: không có nhịp tim (chưa từng / caller không truyền) ⇒ KHÔNG kết nối ⇒ `offline`.
 */

/** Trạng thái máy đã chuẩn hóa cho lăng kính chỉ huy (`factoryCommand.overview` / `machineDetail`). */
export type CommandMachineStatus = "running" | "idle" | "down" | "offline" | "maintenance";

/**
 * ★★★ NGƯỠNG "NHỊP TIM CÒN TƯƠI" (ms) — **MỘT** con số, khai **MỘT** lần ở phía server.
 *
 * 5 phút, và không phải số mới: nó BẰNG
 *   · client `NGUONG_CU_MS` (`client/src/components/twin3d/mauTrangThai.ts:246`) — quá nó là `khong_ro`
 *     (NT-3 "quá 5 phút"); `trangThaiMayTuoi.test.ts` ghim đẳng thức này để hai bên không lệch câm;
 *   · `getUnnotifiedOfflineMachines(thresholdMinutes = 5)` (`server/db/machine.ts:266`) và
 *     `alertSettings.thresholdMinutes: 5` (`:467`) — ngưỡng cảnh báo máy offline có sẵn;
 *   · cửa heartbeat `< 5 * 60 * 1000` viết cứng trong `assetCockpitService` trước Đợt 34 (nay đọc hằng này).
 *
 * ⚠ Đổi số này = đổi nghĩa của "máy sống" trên cả ba màn twin lẫn cockpit — đổi ở đây, và CHỈ ở đây.
 */
export const NGUONG_TRANG_THAI_TUOI_MS = 5 * 60 * 1000;

/** Mốc thời gian (Date / ISO / epoch) → ms epoch; `null` khi vắng hoặc không đọc được. */
export function msCua(ts: Date | string | number | null | undefined): number | null {
  if (ts == null) return null;
  const ms = ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Mốc thời gian → chuỗi ISO cho hợp đồng tRPC; `null` khi vắng/không đọc được. */
export function isoCua(ts: Date | string | number | null | undefined): string | null {
  const ms = msCua(ts);
  return ms == null ? null : new Date(ms).toISOString();
}

/**
 * Mốc có còn tươi không: `now - ts < NGUONG_TRANG_THAI_TUOI_MS`.
 * `ts` vắng ⇒ `false` (fail-closed). Đồng hồ client/server lệch âm (ts > now) ⇒ vẫn tươi (tuổi ≤ 0).
 */
export function mocConTuoi(ts: Date | string | number | null | undefined, now: number): boolean {
  const ms = msCua(ts);
  if (ms == null) return false;
  return now - ms < NGUONG_TRANG_THAI_TUOI_MS;
}

/** Ba mẩu bằng chứng một máy có "còn nói chuyện với ta" — cùng hình dạng cho fleet lẫn cockpit. */
export interface BangChungKetNoi {
  /** `machine_status_logs.status` mới nhất (`online`/`offline`) — SỰ KIỆN chuyển trạng thái; vắng = chưa có log. */
  logStatus: string | null | undefined;
  /** Mốc của chính hàng log ấy. */
  logTs: Date | string | number | null | undefined;
  /** Mốc NHỊP TIM mới nhất = `chonNguonMocTuoi` (`max(machines.lastHeartbeat, machine_heartbeats)`); `null` = chưa từng. */
  nhipTimTs: Date | string | number | null | undefined;
}

/**
 * ★★★ HÀM TRUNG TÂM — máy có ĐANG KẾT NỐI không.
 *
 *   1. Nhịp tim vắng hoặc cũ hơn ngưỡng          → `false`  (không có bằng chứng sống ⇒ không sống)
 *   2. Log mới nhất = `offline` ghi SAU nhịp tim  → `false`  (đã ngắt kết nối, nhịp tim cũ hơn không cứu)
 *   3. Còn lại (nhịp tim tươi)                    → `true`
 *
 * Log `online` KHÔNG có mặt trong luật — nó chỉ nói "lúc ấy máy đã nối", không nói "bây giờ còn nối".
 */
export function dangKetNoi(bc: BangChungKetNoi, now: number): boolean {
  const hb = msCua(bc.nhipTimTs);
  if (hb == null || !mocConTuoi(hb, now)) return false;
  const lt = msCua(bc.logTs);
  if (bc.logStatus === "offline" && lt != null && lt > hb) return false;
  return true;
}

/**
 * Map (bằng chứng kết nối ⊕ `machines.operationStatus`) → 5 trạng thái.
 *
 *   · không kết nối (`dangKetNoi` = false)                                 → `offline`
 *   · kết nối: `maintenance` → `maintenance` · `error` → `down` · `stopped` → `idle` ·
 *     còn lại (`running`/`warming_up`/`changeover`/`starved`/`blocked`/null) → `running`
 *
 * ★ Chọn `offline` thay vì thêm giá trị enum thứ sáu: `CommandMachineStatus` là **danh sách đóng**
 *   (G67) với consumer ở `factoryCommandPriority.ts`, `factory-scene/sceneTypes.ts`,
 *   `FactoryCommandView.tsx` `STATUS_META`, `twin3d/van-hanh/kpiNoiLogic.ts` … — một tên mới sẽ bị
 *   các bảng tra ấy nuốt im lặng. Về nghĩa, "54 ngày không nhịp tim" chính là *mất kết nối* — đúng ô
 *   `offline` đang có (client tô `khong_ro` cho cùng máy, cùng ngưỡng, cùng mốc).
 *
 * ⚠ KHÁC hợp đồng cũ ở một ca, có chủ ý: máy CHƯA có hàng log nào nhưng nhịp tim tươi ⇒ nay `running`/
 *   `idle`… (cũ: `offline` vì "chưa có log"). Nhịp tim là bằng chứng mạnh hơn sự vắng mặt của một sự kiện.
 */
export function mapMachineStatus(
  bc: BangChungKetNoi,
  operationStatus: string | null | undefined,
  now: number,
): CommandMachineStatus {
  if (!dangKetNoi(bc, now)) return "offline";
  switch (operationStatus) {
    case "maintenance":
      return "maintenance";
    case "error":
      return "down";
    case "stopped":
      return "idle";
    default:
      return "running";
  }
}

/**
 * ★★★ ĐỢT 38 (Pareto #2 QA Đợt 37) — TRẠNG THÁI TẠI MỘT MỐC cho ẢNH LỊCH SỬ (tua lại) — CÙNG TỪ ĐIỂN VỚI LIVE.
 *
 * Đo D-4 Đợt 37 (`.qa-dot37/bon-nguon/`): máy 14 im lặng 54 ngày ⇒ live `offline`, mà `twinCanh.anhLichSu` (tua tại
 * "bây giờ") khai **`running 3,2 ngày`** vì bản cũ `nhatKyRaTrangThaiCanh` đọc TRẠNG THÁI + TUỔI từ hàng
 * `machine_status_logs` mới nhất ≤ mốc (`online` ⇒ `running`); chèn một hàng log `online` `now()` ⇒ replay nói
 * **`running 1 s`** cho cùng cái máy chết. G105: hàng log là SỰ KIỆN CHUYỂN (connect/disconnect), không phải tín hiệu
 * sống — Đợt 34 đã đưa fleet + cockpit về luật nhịp tim; replay là đường thứ ba còn sót, và `khoTrangThai.ts` (§9.8)
 * đổ nó vào CÙNG kho với gói socket nên hai đường nói hai chữ cho một máy ở cùng một mốc.
 *
 * ⇒ Replay đi qua ĐÚNG `mapMachineStatus` với bằng chứng ĐÃ CẮT TẠI MỐC (log ≤ mốc, nhịp tim ≤ mốc) và `now = mốc`:
 *   · không nhịp tim tươi tại mốc ⇒ `offline` (kể cả khi có log `online` vừa ghi);
 *   · nhịp tim tươi tại mốc ⇒ `running` — XẤP XỈ CÓ KHAI (`twinCanh.LICH_SU_LA_XAP_XI`): DB không lưu
 *     `operationStatus` theo thời gian nên chỉ nói được "đã kết nối", không nói được "đang làm gì" (NT-4);
 *   · KHÔNG CÓ bằng chứng nào ≤ mốc (chưa từng log, chưa từng nhịp tim) ⇒ `null` — "ta không biết nó thế nào lúc
 *     08:00 nếu bản ghi đầu tiên là 09:00"; điền gì vào đây cũng là bịa quá khứ.
 */
export function trangThaiLichSuTaiMoc(bc: BangChungKetNoi, mocMs: number): CommandMachineStatus | null {
  if (bc.logStatus == null && msCua(bc.nhipTimTs) == null) return null;
  return mapMachineStatus(bc, null, mocMs);
}
