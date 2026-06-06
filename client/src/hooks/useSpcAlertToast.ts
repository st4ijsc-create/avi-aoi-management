import { useEffect } from "react";
import { toast } from "sonner";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";

/**
 * Sprint 2c — Global SPC violation toast hook.
 *
 * Listens to `spc:violation` events from the server (emitted via
 * `emitSpcViolationAlert` in `server/_core/socket.ts`, fed by the new
 * `socket` sink in `server/utils/spcAlertSink.ts`) and surfaces them as
 * sonner toasts so operators see SPC issues regardless of which page is open.
 *
 * Mount once in `DashboardLayout` so every authenticated page benefits.
 */

export interface SpcViolationAlert {
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  metric: string;
  pointIndices: number[];
  violationCount: number;
  detectedAt: string | Date;
  message: string;
  machineCode?: string;
}

export function useSpcAlertToast() {
  useEffect(() => {
    const socket = getSharedSocket();

    const handler = (alert: SpcViolationAlert) => {
      const title = `SPC ${alert.severity.toUpperCase()}: ${alert.ruleName}`;
      const description = alert.machineCode
        ? `${alert.machineCode} — ${alert.message}`
        : alert.message;

      const opts = {
        description,
        duration: alert.severity === "critical" ? 10000 : 6000,
      };

      if (alert.severity === "critical") {
        toast.error(title, opts);
      } else if (alert.severity === "warning") {
        toast.warning(title, opts);
      } else {
        toast.info(title, opts);
      }
    };

    socket.on("spc:violation", handler);

    return () => {
      socket.off("spc:violation", handler);
      releaseSharedSocket();
    };
  }, []);
}
