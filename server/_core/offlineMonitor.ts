import * as db from "../db";
import { notificationConfigured, notifyOwner } from "./notification";
import { getIO } from "./socket";

const OFFLINE_THRESHOLD_MINUTES = 5;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

let intervalId: NodeJS.Timeout | null = null;

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
      return;
    }

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

      // Also emit to connected admin clients via WebSocket
      const io = getIO();
      if (io) {
        io.to("admin").emit("machine:offline_alert", {
          machineId: machine.id,
          machineCode: machine.code,
          machineName: machine.name,
          offlineSince: log.timestamp,
          offlineDurationMinutes: offlineDuration,
        });
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
