import * as db from "../db";
import { notifyOwner } from "./notification";
import { getIO } from "./socket";

const OFFLINE_THRESHOLD_MINUTES = 5;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

let intervalId: NodeJS.Timeout | null = null;

export async function checkOfflineMachines(): Promise<void> {
  try {
    const unnotifiedMachines = await db.getUnnotifiedOfflineMachines(OFFLINE_THRESHOLD_MINUTES);
    
    if (unnotifiedMachines.length === 0) {
      return;
    }

    console.log(`[OfflineMonitor] Found ${unnotifiedMachines.length} machines offline for more than ${OFFLINE_THRESHOLD_MINUTES} minutes`);

    for (const { log, machine } of unnotifiedMachines) {
      const offlineDuration = Math.round((Date.now() - new Date(log.timestamp).getTime()) / 60000);
      
      // Send notification to owner
      const notificationSent = await notifyOwner({
        title: `⚠️ Máy ${machine.name} (${machine.code}) đã offline`,
        content: `Máy ${machine.name} (${machine.code}) đã mất kết nối trong ${offlineDuration} phút.\n\nThời gian offline: ${new Date(log.timestamp).toLocaleString('vi-VN')}\nIP cuối cùng: ${log.ipAddress || 'Không xác định'}\n\nVui lòng kiểm tra kết nối mạng và trạng thái máy.`,
      });

      if (notificationSent) {
        // Mark notification as sent
        await db.markOfflineNotificationSent(log.id);
        console.log(`[OfflineMonitor] Notification sent for machine ${machine.code}`);
      } else {
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
