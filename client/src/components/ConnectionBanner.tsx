/**
 * Phase 5 WS5.1 — Global realtime connection / staleness banner.
 *
 * Closes the audit gap: the app had no app-wide "live vs delayed/disconnected"
 * indicator (only a small wifi icon in the NotificationCenter). Shows a fixed
 * banner when the network is offline or the realtime socket is disconnected.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSharedSocket } from "../lib/socketManager";

export function ConnectionBanner() {
  const { t } = useTranslation();
  const [socketUp, setSocketUp] = useState(true);
  const [netUp, setNetUp] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const socket = getSharedSocket();
    setSocketUp(socket.connected);
    const onConnect = () => setSocketUp(true);
    const onDisconnect = () => setSocketUp(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    const onNetUp = () => setNetUp(true);
    const onNetDown = () => setNetUp(false);
    window.addEventListener("online", onNetUp);
    window.addEventListener("offline", onNetDown);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      window.removeEventListener("online", onNetUp);
      window.removeEventListener("offline", onNetDown);
    };
  }, []);

  if (netUp && socketUp) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[2000] bg-amber-500 text-black text-xs sm:text-sm font-medium text-center py-1 px-3 shadow-md"
    >
      {!netUp
        ? t("connectionBanner.netDown", "Mất kết nối mạng — dữ liệu có thể không cập nhật. Đang chờ khôi phục…")
        : t("connectionBanner.socketDown", "Mất kết nối thời gian thực — đang thử kết nối lại…")}
    </div>
  );
}
