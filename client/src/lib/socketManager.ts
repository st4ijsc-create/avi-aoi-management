import { io, Socket } from "socket.io-client";
import { ganNoiLaiKhiServerNgat, type TrangThaiNoiLai } from "./socketNoiLai";

let sharedSocket: Socket | null = null;
let refCount = 0;

// ★★★ F5 đầy đủ — server NGẮT socket khi quyền / phạm vi / phiên của người dùng đổi; socket.io-client không tự nối lại sau
// `"io server disconnect"` ⇒ `socketNoiLai.ts` nối lại có giới hạn (UNAUTHORIZED ⇒ dừng + đường "đã đăng xuất" sẵn có).
let trangThaiNoiLai: TrangThaiNoiLai = "binh_thuong";
const nguoiNghe = new Set<(t: TrangThaiNoiLai) => void>();
let xuLyHetPhien: (() => void) | null = null;
let xuLyQuyenDoi: (() => void) | null = null;

/** main.tsx gắn: hết phiên ⇒ cho truy vấn chạy lại (UNAUTHORIZED ⇒ về đăng nhập); quyền đổi ⇒ tải lại quyền. */
export function datXuLyKetNoiLai(h: { khiHetPhien?: () => void; khiQuyenDoi?: () => void }): void {
  xuLyHetPhien = h.khiHetPhien ?? null;
  xuLyQuyenDoi = h.khiQuyenDoi ?? null;
}
export function layTrangThaiNoiLai(): TrangThaiNoiLai {
  return trangThaiNoiLai;
}
/** Theo dõi trạng thái nối lại (ConnectionBanner). Trả hàm gỡ. */
export function theoDoiTrangThaiNoiLai(fn: (t: TrangThaiNoiLai) => void): () => void {
  nguoiNghe.add(fn);
  return () => nguoiNghe.delete(fn);
}

export function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(window.location.origin, {
      path: "/api/socket.io",
      // doc 67 W6 (việc 1) — WEBSOCKET-FIRST: polling-first cost 4-6 HTTP
      // round-trips on EVERY page load before the upgrade handshake (over half
      // of the apiCount in the page captures). websocket-first connects in one
      // round-trip; socket.io still falls back to polling automatically when
      // the WS handshake fails (old proxies / corp firewalls that block
      // Upgrade: websocket).
      // ROLLBACK: if a kiosk environment sits behind a proxy that silently
      // drops WS (symptom: every page load waits out the WS connect timeout
      // before recovering on polling), restore the previous order:
      //   transports: ["polling", "websocket"]
      transports: ["websocket", "polling"],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
    });
    ganNoiLaiKhiServerNgat(sharedSocket, {
      khiHetPhien: () => xuLyHetPhien?.(),
      khiQuyenDoi: () => xuLyQuyenDoi?.(),
      khiDoiTrangThai: (t) => {
        trangThaiNoiLai = t;
        for (const f of nguoiNghe) f(t);
      },
    });
  }
  refCount++;
  return sharedSocket;
}

export function releaseSharedSocket(): void {
  refCount = Math.max(0, refCount - 1);
  // Keep socket alive — it will be cleaned up when the tab/window closes.
  // Disconnecting on refCount=0 causes reconnect loops during page navigation
  // because DashboardLayout (with NotificationCenter) unmounts and remounts.
}
