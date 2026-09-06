/**
 * useKhoTrangThai.ts — nối `twin:trangThai` (§10.2) vào KHO DÙNG CHUNG (§9.8).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ VÌ SAO TÁCH KHỎI `khoTrangThai.ts`
 * ════════════════════════════════════════════════════════════════════════════
 * `khoTrangThai.ts` là module THUẦN — test được ở `environment: "node"` không
 * cần DOM, không cần socket. Hook này là lớp vỏ react MỎNG NHẤT có thể: nó chỉ
 * bơm sự kiện vào `apDung()` và trả kho ra. Mọi LUẬT nằm ở module thuần, nên
 * phần khó test (react + socket) không chứa quyết định nào.
 *
 * ⚠ Cố ý KHÔNG thay `useTwinStream` (WIP theo trạm). Hai hook đo HAI đại lượng
 *   khác nhau — WIP/trạm và trạng thái/máy — và gộp chúng lại là đúng lỗi G7
 *   "đo nhầm đại lượng". `useTwinStream` giữ nguyên cho lớp phủ WIP.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import {
  KHO_RONG,
  apDung,
  ketNoiTheoMoc,
  type KhoTrangThai,
  type MocTrangThai,
  type TrangThaiKetNoi,
} from "./khoTrangThai";

/** Hình dạng gói `twin:trangThai` do server phát (`socket.ts`). */
interface GoiTrangThai {
  factoryId: number;
  may: MocTrangThai[];
  bayGio: number;
  capNhatMoiNhat: number | null;
  tong: number;
}

export interface KetQuaKhoTrangThai {
  kho: KhoTrangThai;
  /** Một trong NĂM trạng thái G15 — KHÔNG phải một boolean. */
  ketNoi: TrangThaiKetNoi;
  /**
   * Đặt ảnh lịch sử đang xem. `moc = null` ⇒ về trực tiếp.
   * ★ Nhận CẢ dữ liệu chứ không chỉ mốc — xem docblock trong thân hàm.
   */
  datAnhLichSu: (moc: number | null, may: readonly MocTrangThai[] | null) => void;
}

/**
 * ★ `bayGio` là THAM SỐ chứ không đọc `Date.now()` bên trong: trạng thái kết nối
 *   phải đổi theo đồng hồ mà TRANG đang dùng để render, nếu không thì nhãn
 *   "trực tiếp" và nhãn tuổi dữ liệu sẽ lệch nhau vài giây và không ai hiểu vì sao.
 */
export function useKhoTrangThai(
  factoryId: number | null,
  bayGio: number,
): KetQuaKhoTrangThai {
  const [kho, setKho] = useState<KhoTrangThai>(KHO_RONG);
  const [daKetNoi, setDaKetNoi] = useState(false);
  const khoRef = useRef(kho);
  khoRef.current = kho;

  useEffect(() => {
    if (factoryId === null) return;
    const socket = getSharedSocket();

    const onConnect = () => {
      setDaKetNoi(true);
      socket.emit("subscribe", { twinFactoryId: factoryId });
    };
    const onDisconnect = () => setDaKetNoi(false);
    const onTrangThai = (goi: GoiTrangThai) => {
      // Gói của nhà máy KHÁC (người dùng vừa đổi bộ chọn) — bỏ qua, nếu không
      // cảnh sẽ nhấp nháy dữ liệu của nhà máy cũ.
      if (goi.factoryId !== factoryId) return;
      setKho((cu) =>
        apDung(cu, {
          may: goi.may ?? [],
          bayGio: goi.bayGio,
          nguon: "socket",
          // Sự kiện trực tiếp luôn kéo người xem về hiện tại: giữ `mocXemLai`
          // ở đây sẽ làm gói mới ghi đè ảnh lịch sử đang xem.
          mocXemLai: null,
        }),
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("twin:trangThai", onTrangThai);
    if (socket.connected) onConnect();

    return () => {
      socket.emit("unsubscribe", { twinFactoryId: factoryId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("twin:trangThai", onTrangThai);
      releaseSharedSocket();
    };
  }, [factoryId]);

  /**
   * ★★★ ĐỔ ẢNH LỊCH SỬ VÀO **CÙNG MỘT** `apDung()` mà socket dùng (§9.8).
   *
   * ⚠ Bản viết đầu chỉ đặt `mocXemLai` mà KHÔNG thay dữ liệu — hậu quả là nhãn
   * nói "Xem lại 14:32" trong khi cảnh vẫn vẽ số liệu TRỰC TIẾP. Đó đúng là
   * "live và replay lệch nhau" mà §9.8 sinh ra để chặn, chỉ khác là lệch 100%.
   * Nên hàm này nhận CẢ dữ liệu, không chỉ cái mốc.
   *
   * `null` ⇒ về trực tiếp: xoá `mocXemLai` và để gói socket kế tiếp ghi đè.
   */
  const datAnhLichSu = useMemo(
    () => (moc: number | null, may: readonly MocTrangThai[] | null) => {
      setKho((cu) => {
        if (moc == null) return { ...cu, mocXemLai: null };
        if (!may) return { ...cu, mocXemLai: moc, nguon: "lich_su" as const };
        return apDung(cu, { may, bayGio: moc, nguon: "lich_su", mocXemLai: moc });
      });
    },
    [],
  );

  const ketNoi = ketNoiTheoMoc(kho, daKetNoi, bayGio);
  return { kho, ketNoi, datAnhLichSu };
}
