/**
 * SCADA R1a Task 14 — nghe `scada:cmd` (tiến trình / kết cục lệnh HMI) trên socket DÙNG CHUNG (`getSharedSocket`, không mở kết nối mới).
 *
 * Máy chủ chỉ phát vào phòng `user:{id}` của chủ yêu cầu (`lenhHmi.phatScadaCmd`). Socket trình duyệt KHÔNG tự vào phòng đó: phòng mở
 * bằng `auth:user` (notificationService — máy chủ kiểm `duocVaoPhongNguoiDung`: chỉ socket người dùng, chỉ phòng CỦA CHÍNH người đó).
 * Trước Task 14 không client nào phát `auth:user` (xem NotificationCenter) ⇒ hook này phát nó lúc gắn và mỗi lần nối lại (phòng mất khi
 * socket rớt).
 *
 * Chỉ chuyển sự kiện của `requestId` đang theo dõi. Socket là đường BỔ SUNG: kết quả chính vẫn là giá trị trả về của `confirm`.
 */
import { useEffect, useRef } from "react";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { useAuth } from "@/_core/hooks/useAuth";

export interface SuKienScadaCmd {
  requestId: string;
  status: string;
  at: string;
  reason?: string;
  readBackValue?: unknown;
}

export function useScadaCmd(requestId: string | null, onSuKien: (e: SuKienScadaCmd) => void): void {
  const { user } = useAuth();
  const userId = (user as { id?: number } | null | undefined)?.id ?? null;
  const cbRef = useRef(onSuKien);
  useEffect(() => {
    cbRef.current = onSuKien;
  }, [onSuKien]);

  useEffect(() => {
    if (!requestId) return;
    const socket = getSharedSocket();
    const vaoPhong = () => {
      if (userId !== null) socket.emit("auth:user", userId);
    };
    const nhan = (p: unknown) => {
      const e = p as Partial<SuKienScadaCmd> | null;
      if (!e || typeof e !== "object" || e.requestId !== requestId || typeof e.status !== "string") return;
      cbRef.current(e as SuKienScadaCmd);
    };
    socket.on("connect", vaoPhong);
    socket.on("scada:cmd", nhan);
    if (socket.connected) vaoPhong();
    return () => {
      socket.off("connect", vaoPhong);
      socket.off("scada:cmd", nhan);
      releaseSharedSocket();
    };
  }, [requestId, userId]);
}
