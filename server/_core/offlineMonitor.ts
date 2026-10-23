import * as db from "../db";
import { notificationConfigured, notifyOwner } from "./notification";
import { getIO } from "./socket";
import { phatTheoNhaMay } from "./socketPhatTheoNhaMay";

const OFFLINE_THRESHOLD_MINUTES = 5;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

let intervalId: NodeJS.Timeout | null = null;

/**
 * ★ H1b (2026-10-23) — MỖI ĐỢT offline của một máy chỉ PHÁT `machine:offline_alert` MỘT lần.
 *
 * Lỗi đo được trên :3000: hàm này chạy mỗi 60 s và phát LẠI cho mọi máy offline "chưa gửi" — mà khi dịch vụ thông báo chưa cấu hình thì KHÔNG máy nào được đánh dấu đã
 * gửi ⇒ phát mãi (3.400 tin trong 75 s vào phòng `admin`, không client nào nghe).
 *
 * "Đợt offline" = MỘT hàng `machine_status_logs` (`log.id`): máy online lại rồi offline lần nữa tạo hàng MỚI ⇒ đợt mới ⇒ phát lại. Việc ghi nhớ "đã phát" ĐỘC LẬP với
 * việc gửi thông báo thành công (`markOfflineNotificationSent` giữ nguyên nghĩa: chỉ đánh dấu khi `notifyOwner` gửi được). Bộ nhớ trong tiến trình: khởi động lại ⇒ tối đa một lần
 * phát lại mỗi đợt đang diễn ra. Mỗi chu kỳ dọn các id không còn trong danh sách offline (đợt đã kết thúc) ⇒ bộ nhớ bị chặn theo số máy đang offline.
 */
const daPhatDotOffline = new Set<number>();

/** Chỉ lưới: quên các đợt đã phát (mô phỏng khởi động lại). */
export function __quenDotOfflineChoTest(): void {
  daPhatDotOffline.clear();
}

export async function checkOfflineMachines(): Promise<void> {
  try {
    let unnotifiedMachines;
    try {
      unnotifiedMachines = await db.getUnnotifiedOfflineMachines(OFFLINE_THRESHOLD_MINUTES);
    } catch (dbError: any) {
      // Graceful handling for DB connection timeouts
      const code = dbError?.cause?.code || dbError?.code;
      if (code === 'CONNECT_TIMEOUT' || code === 'CONNECTION_CLOSED' || code === 'ECONNREFUSED') {
        console.warn(`[OfflineMonitor] DB temporarily unreachable (${code}), will retry next interval`);
        return;
      }
      throw dbError;
    }
    
    if (unnotifiedMachines.length === 0) {
      daPhatDotOffline.clear(); // không máy nào còn offline-chưa-gửi ⇒ mọi đợt đã kết thúc (hoặc đã gửi)
      return;
    }
    // đợt đã kết thúc (máy online lại / đã đánh dấu gửi) ⇒ quên, để đợt sau phát lại
    const conOffline = new Set<number>(unnotifiedMachines.map((x) => x.log.id));
    for (const id of daPhatDotOffline) if (!conOffline.has(id)) daPhatDotOffline.delete(id);

    console.log(`[OfflineMonitor] Found ${unnotifiedMachines.length} machines offline for more than ${OFFLINE_THRESHOLD_MINUTES} minutes`);

    /*
     * ════════════════════════════════════════════════════════════════════════
     * ★★★ HỎI MỘT LẦN MỖI CHU KỲ, KHÔNG MỘT LẦN MỖI MÁY
     * ════════════════════════════════════════════════════════════════════════
     * Khi dịch vụ thông báo CHƯA cấu hình, `notifyOwner` trả `false` cho **mọi** máy, nên
     * vòng dưới đây: gọi → ghi 1 dòng ở `notification.ts` → ghi thêm 1 dòng "Failed to send"
     * → **không** đánh dấu đã gửi → chu kỳ sau lặp lại **toàn đội**.
     *
     * Đo được 2026-09-21: ~1.700 máy × 2 dòng × mỗi 60 giây ⇒ `dist/e2e-3000.err.log` đạt
     * **827 MB** và vẫn phình. Trong 2.000 dòng cuối, **1.000 dòng** là đúng một câu.
     *
     * ⇒ Thiếu cấu hình là chuyện của **cả chu kỳ**, không phải của từng máy. Ghi **một** dòng
     *   rồi bỏ bước gửi. KHÔNG im lặng (khoảng trống cấu hình vẫn phải thấy được), và KHÔNG
     *   đánh dấu "đã gửi" (không gửi được thì không được nói là đã gửi).
     *
     * ⚠ Phát WebSocket cho admin **vẫn giữ nguyên**: đó là một đường báo KHÁC và nó đang chạy.
     */
    const coTheGui = notificationConfigured();
    if (!coTheGui) {
      console.warn(
        `[OfflineMonitor] Notification service not configured — skipping ${unnotifiedMachines.length} owner notification(s) this cycle ` +
          "(1 dòng/chu kỳ, không phải 1 dòng/máy).",
      );
    }

    for (const { log, machine } of unnotifiedMachines) {
      const offlineDuration = Math.round((Date.now() - new Date(log.timestamp).getTime()) / 60000);
      
      // Send notification to owner — bỏ qua hẳn khi chưa cấu hình (xem khối trên).
      const notificationSent = !coTheGui ? false : await notifyOwner({
        title: `⚠️ Máy ${machine.name} (${machine.code}) đã offline`,
        content: `Máy ${machine.name} (${machine.code}) đã mất kết nối trong ${offlineDuration} phút.\n\nThời gian offline: ${new Date(log.timestamp).toLocaleString('vi-VN')}\nIP cuối cùng: ${log.ipAddress || 'Không xác định'}\n\nVui lòng kiểm tra kết nối mạng và trạng thái máy.`,
      });

      if (notificationSent) {
        // Mark notification as sent
        await db.markOfflineNotificationSent(log.id);
        console.log(`[OfflineMonitor] Notification sent for machine ${machine.code}`);
      } else if (coTheGui) {
        // ⚠ Chỉ ghi khi dịch vụ CÓ cấu hình mà vẫn hỏng — đó mới là tin. Khi chưa cấu hình,
        //   một dòng tổng ở trên đã nói đủ.
        console.warn(`[OfflineMonitor] Failed to send notification for machine ${machine.code}`);
      }

      // WebSocket: MỖI ĐỢT offline phát ĐÚNG MỘT lần (xem `daPhatDotOffline`), theo PHÒNG NHÀ MÁY của máy (P-S1b) thay vì `admin` — người trong nhà máy đó (và người toàn quyền) nhận.
      // Hiện KHÔNG client nào nghe sự kiện này; giữ lại vì rẻ khi chỉ phát một lần.
      if (!daPhatDotOffline.has(log.id)) {
        daPhatDotOffline.add(log.id);
        const io = getIO();
        if (io) {
          phatTheoNhaMay(
            io,
            "machine:offline_alert",
            {
              machineId: machine.id,
              machineCode: machine.code,
              machineName: machine.name,
              offlineSince: log.timestamp,
              offlineDurationMinutes: offlineDuration,
            },
            { machineId: machine.id, machineCode: machine.code },
          );
        }
      }
    }
  } catch (error) {
    console.error("[OfflineMonitor] Error checking offline machines:", error);
  }
}

export function startOfflineMonitor(): void {
  if (intervalId) {
    console.log("[OfflineMonitor] Already running");
    return;
  }

  console.log(`[OfflineMonitor] Starting offline monitor (threshold: ${OFFLINE_THRESHOLD_MINUTES} minutes, interval: ${CHECK_INTERVAL_MS / 1000}s)`);
  
  // Run immediately on start
  checkOfflineMachines();
  
  // Then run at interval
  intervalId = setInterval(checkOfflineMachines, CHECK_INTERVAL_MS);
}

export function stopOfflineMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[OfflineMonitor] Stopped");
  }
}
