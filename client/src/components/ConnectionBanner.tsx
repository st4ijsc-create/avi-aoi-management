/**
 * Phase 5 WS5.1 — Global realtime connection / staleness banner.
 *
 * Closes the audit gap: the app had no app-wide "live vs delayed/disconnected"
 * indicator (only a small wifi icon in the NotificationCenter). Shows a fixed
 * banner when the network is offline or the realtime socket is disconnected.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSharedSocket, layTrangThaiNoiLai, theoDoiTrangThaiNoiLai } from "../lib/socketManager";

export function ConnectionBanner() {
  const { t } = useTranslation();
  const [socketUp, setSocketUp] = useState(true);
  const [netUp, setNetUp] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  // F5 đầy đủ — server ngắt socket vì quyền / phạm vi đổi ⇒ trạng thái "đang nối lại" riêng (khác mất kết nối thường).
  const [noiLai, setNoiLai] = useState(layTrangThaiNoiLai());

  useEffect(() => {
    const socket = getSharedSocket();
    setSocketUp(socket.connected);
    const onConnect = () => setSocketUp(true);
    const onDisconnect = () => setSocketUp(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    const goNoiLai = theoDoiTrangThaiNoiLai(setNoiLai);

    const onNetUp = () => setNetUp(true);
    const onNetDown = () => setNetUp(false);
    window.addEventListener("online", onNetUp);
    window.addEventListener("offline", onNetDown);

    return () => {
      goNoiLai();
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
        : noiLai === "dang_noi_lai"
          ? t("connectionBanner.quyenDoi", "Quyền truy cập vừa thay đổi — đang kết nối lại…")
          : noiLai === "cho_dich_vu"
            ? t("connectionBanner.choDichVu", "Máy chủ tạm thời chưa xác thực được kết nối — đang tự thử lại…")
            : noiLai === "dung"
              ? t("connectionBanner.noiLaiDung", "Đã dừng kết nối lại kênh thời gian thực — sẽ thử lại khi có mạng hoặc khi bạn quay lại tab; hoặc tải lại trang.")
              : noiLai === "het_phien"
                ? t("connectionBanner.hetPhien", "Phiên đăng nhập không còn hiệu lực — đang chuyển tới trang đăng nhập…")
                : t("connectionBanner.socketDown", "Mất kết nối thời gian thực — đang thử kết nối lại…")}
    </div>
  );
}
