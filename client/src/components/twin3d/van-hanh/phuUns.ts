/**
 * phuUns.ts — §11 #50: **UNS STREAM ISA-95 di trú sang `/twin`**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VIỆC CỦA MODULE NÀY
 * ════════════════════════════════════════════════════════════════════════════
 * `FactoryLiveMap3D.tsx` (màn sắp bị Đợt 7 xoá) là nơi DUY NHẤT trong repo dùng
 * `useUnsStream` — nguồn realtime THỨ HAI, chạy song song với socket
 * `twin:trangThai` mà Đợt 6 đã nối. Xoá màn ấy mà không di trú mục này là mất
 * một đường dữ liệu thật.
 *
 * Module chỉ giữ phần THUẦN: quy một ảnh chụp UNS về đúng `MocTrangThai` mà
 * `khoTrangThai.apDung()` đã nhận. Việc mở socket vẫn là của `useUnsStream`
 * (hook có sẵn, không chép lại).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO QUY VỀ `MocTrangThai` CHỨ KHÔNG DỰNG ĐƯỜNG PHỦ RIÊNG
 * ════════════════════════════════════════════════════════════════════════════
 * `FactoryLiveMap3D` phủ UNS bằng `overlayFromUns()` **ngay tại chỗ vẽ**, tức
 * nguồn realtime thứ hai ghi thẳng vào biến render. Chép khuôn ấy sang `/twin`
 * sẽ dựng đường thứ hai đi vòng qua `khoTrangThai` — và §9.8 nói rõ điều gì xảy
 * ra khi live và replay không dùng chung một `apDung()`: hai đường trôi khỏi
 * nhau, rồi tua lại cho một kết quả khác trực tiếp mà không gì kêu.
 *
 * ⇒ UNS đi vào ĐÚNG cửa mà socket `twin:trangThai` đi: sinh `MocTrangThai`, rồi
 *   `apDung()`. Nhờ vậy mọi luật NT-3 (tuổi dữ liệu, `khong_ro`, `capNhatLuc`
 *   `null` khi chưa từng báo cáo) áp cho UNS y hệt, miễn phí.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `ts` CỦA UNS LÀ MỐC DỮ LIỆU — VÀ ĐÓ LÀ Ô DỄ LÀM SAI NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * NT-3.4: *"Cập nhật lần cuối phải là `max(timestamp)` của dữ liệu nền, KHÔNG
 * phải thời điểm render trang"*. Một gói UNS mang `ts` của chính phép đo; lấy
 * `Date.now()` lúc gói tới sẽ làm MỌI máy trông như vừa cập nhật xong ngay cả
 * khi thiết bị đã im lặng và ta chỉ đang nhận lại một snapshot cũ.
 * ⇒ `capNhatLuc` lấy từ `ts`, và `ts` không phân giải được ⇒ `null`, KHÔNG phải
 *   `Date.now()` và cũng KHÔNG phải `0`.
 *
 * ★ Module THUẦN (RB-8.1) — không react, không socket, không `Date.now()` ẩn.
 */
import type { MocTrangThai } from "./khoTrangThai";

/** Ô tối thiểu của một ảnh chụp UNS mà phép quy này cần (khớp `UnsClientSnapshot`). */
export interface AnhChupUns {
  /** ISO-8601 của PHÉP ĐO, không phải lúc gói tới. */
  ts?: string | null;
  /** PackML state, hoa/thường tuỳ nguồn. */
  state?: string | null;
  health?: "online" | "degraded" | "offline" | null;
  machineId?: number | null;
}

/**
 * ★★★ PackML → khoá trạng thái của `mauTrangThai.ts`.
 *
 * ⚠ Bảng này chép NGHĨA từ `FactoryLiveMap3D.overlayFromUns` (dòng 43-46) chứ
 *   KHÔNG chép mã: bản gốc quy về `heartbeatStatus` (`running|idle|stopped`)
 *   của `MachineNode`, còn `/twin` dùng khoá của `mauTrangThai`. Hai bộ từ vựng
 *   khác nhau, nên quy thẳng là cách duy nhất không đẻ tầng dịch thứ hai.
 *
 * ⚠⚠ `health === "offline"` THẮNG mọi `state`: một thiết bị mất kết nối có thể
 *   còn mang `state` cuối cùng nó kịp gửi, và vẽ `EXECUTE` cho một máy đã offline
 *   đúng là lỗi *"tag Quality=Good trong khi timestamp ngừng tiến"* (NT-3).
 *
 * ★ `state` KHÔNG nhận ra ⇒ `null` (⇒ `khong_ro` sau khi qua `trangThaiHienThi`),
 *   TUYỆT ĐỐI không rơi về `"stopped"`: một trạng thái lạ nghĩa là ta không hiểu
 *   thiết bị đang nói gì, không phải là ta biết chắc nó đã dừng.
 */
export function trangThaiTuUns(anh: AnhChupUns): string | null {
  if (anh.health === "offline") return "offline";
  const s = String(anh.state ?? "").trim().toUpperCase();
  if (s === "") return null;
  if (["EXECUTE", "STARTING", "RUNNING", "PRODUCING", "PROCESSING"].includes(s)) return "running";
  if (["IDLE", "STANDBY", "READY"].includes(s)) return "idle";
  // ★ Đợt 38 (Pareto #2): nhóm dừng ⇒ `idle` — CÙNG từ điển chỉ huy (`mapMachineStatus`: `stopped→idle`) mà server
  //   nay dùng cho kho twin và fleet; giữ `stopped` ở đây là mở lại đường thứ hai cho cùng một trạng thái.
  if (["STOPPED", "HELD", "HOLD", "ABORTED", "SUSPENDED", "COMPLETE", "OFFLINE"].includes(s)) return "idle";
  return null;
}

/**
 * Phân giải `ts` của UNS về ms epoch.
 *
 * ★ Trả `null` cho mọi thứ không phân giải được — xem docblock đầu file về vì
 *   sao `Date.now()` ở đây là một lời khai bịa về độ tươi.
 */
export function mocTuUns(ts: string | null | undefined): number | null {
  if (ts == null) return null;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Quy một tập ảnh chụp UNS về gói mà `khoTrangThai.apDung()` nhận.
 *
 * ★ `isActive` KHÔNG suy từ UNS: luồng UNS nói về TÍN HIỆU của thiết bị, còn
 *   `isActive` là quyết định KHAI THÁC của con người (`machines.isActive`). Suy
 *   một cái từ cái kia sẽ làm một máy mất mạng vài phút tự khai là "đã ngừng
 *   khai thác". Người gọi giữ `isActive` từ truy vấn nền và truyền vào đây.
 *
 * ⚠ Ảnh chụp KHÔNG có `machineId` bị BỎ QUA (không đoán theo `path`): một dòng
 *   không neo được vào máy nào là một dòng ta không biết đặt ở đâu, và đoán sai
 *   sẽ tô trạng thái của thiết bị A lên thiết bị B.
 */
export function mocTuAnhChupUns(
  anhChup: readonly AnhChupUns[],
  isActiveTheoMay: ReadonlyMap<number, boolean>,
): MocTrangThai[] {
  const ra: MocTrangThai[] = [];
  for (const a of anhChup) {
    const id = a.machineId;
    if (id == null || !Number.isFinite(id)) continue;
    ra.push({
      machineId: id,
      trangThai: trangThaiTuUns(a),
      capNhatLuc: mocTuUns(a.ts),
      // Máy không có trong bảng nền ⇒ mặc định CÒN khai thác: `undefined` nghĩa
      // là "chưa biết", và suy "đã ngừng" từ chỗ đó là bịa (cùng luật `nguoiGanDuoc`).
      isActive: isActiveTheoMay.get(id) ?? true,
    });
  }
  return ra;
}
