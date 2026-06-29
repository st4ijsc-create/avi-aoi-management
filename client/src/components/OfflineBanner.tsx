/**
 * Doc 10 / U16 — operator OFFLINE indicator.
 *
 * Shop-floor connectivity drops happen. This surfaces a clear banner the moment the browser
 * goes offline (navigator.onLine + the online/offline events) so an operator knows scans /
 * reports won't reach the server right now, instead of silently failing.
 *
 * HONEST SCOPE: this is an INDICATOR, not an offline queue. True store-and-forward (buffer
 * scans/reports locally and sync on reconnect) is a larger piece tracked as a follow-up; the
 * edge runtime already does buffered sync server-side for orchestration, but the operator UI
 * does not yet queue. Until then, the banner sets correct expectations.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>{t("offline.banner", "Mất kết nối — thao tác quét/báo cáo sẽ không gửi được cho tới khi có mạng lại.")}</span>
    </div>
  );
}

export default OfflineBanner;
