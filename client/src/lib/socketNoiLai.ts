/**
 * ★★★ F5 đầy đủ — NỐI LẠI sau khi SERVER ngắt socket (đổi vai / phạm vi / quyền / phiên của chính người dùng).
 *
 * socket.io-client KHÔNG tự nối lại khi lý do ngắt là `"io server disconnect"` (server chủ động ngắt) — thiếu phần này thì tab bị ngắt tối
 * tới khi tải lại trang. Luật:
 *   • lý do `"io server disconnect"` ⇒ `socket.connect()` sau một độ trễ có NHIỄU: lần đầu 1–3 s, rồi gấp đôi (trần TRE_TRAN_MS), tối đa
 *     SO_LAN_TOI_DA lần; hết lượt ⇒ dừng (trạng thái `dung`);
 *   • handshake bị từ chối `UNAUTHORIZED` (phiên bị thu hồi / tài khoản tắt / buộc đổi mật khẩu) ⇒ DỪNG thử, gọi `khiHetPhien` — nơi gắn
 *     (main.tsx) cho các truy vấn tRPC chạy lại ⇒ đường xử lý "đã đăng xuất" SẴN CÓ (UNAUTHORIZED ⇒ về trang đăng nhập);
 *   • nối lại THÀNH CÔNG sau một lượt bị server ngắt ⇒ `khiQuyenDoi` (cho UI tải lại quyền); các trang tự đăng ký lại trên `connect` như cũ.
 *   • lý do khác (mạng, server tắt, `io client disconnect`) ⇒ không làm gì: bộ nối lại của socket.io-client lo (hoặc client tự ngắt).
 * Thuần (không DOM, không React) ⇒ lưới đơn vị điều khiển được đồng hồ và số ngẫu nhiên.
 */

/**
 * `dang_noi_lai` = đang thử lại sau khi server ngắt (quyền đổi); `cho_dich_vu` = máy chủ tạm không xác thực được (handshake
 * `SERVICE_UNAVAILABLE` — DB / sổ phiên hỏng), đang tự thử lại KHÔNG giới hạn số lần; `dung` = đã hết lượt (sẽ thử lại khi mạng về / tab hiện
 * lại); `het_phien` = handshake bị từ chối dứt khoát (`UNAUTHORIZED`).
 */
export type TrangThaiNoiLai = "binh_thuong" | "dang_noi_lai" | "cho_dich_vu" | "dung" | "het_phien";

/** Phần của socket.io-client `Socket` mà bộ nối lại dùng. */
export interface SocketNoiLai {
  connected: boolean;
  active?: boolean;
  on(ev: string, fn: (...a: any[]) => void): unknown;
  off(ev: string, fn: (...a: any[]) => void): unknown;
  connect(): unknown;
}

export interface TuyChonNoiLai {
  /** Đồng hồ hẹn giờ (lưới tiêm). */
  henGio?: (fn: () => void, ms: number) => unknown;
  huyHen?: (h: unknown) => void;
  /** Số ngẫu nhiên [0, 1) (lưới tiêm). */
  ngauNhien?: () => number;
  khiHetPhien?: () => void;
  khiQuyenDoi?: () => void;
  khiDoiTrangThai?: (t: TrangThaiNoiLai) => void;
  /**
   * fix round 1 (m8) — gắn bộ nghe "môi trường đã có thể nối lại" (mạng `online`, tab hiện lại `visibilitychange`); trạng thái `dung` thử lại khi
   * nó bắn. Trả hàm gỡ. Mặc định: `window` + `document` (không có ⇒ không gắn gì). Lưới tiêm.
   */
  ganKhoiPhuc?: (fn: () => void) => () => void;
}

export const TRE_DAU_MIN_MS = 1_000;
export const TRE_DAU_MAX_MS = 3_000;
export const TRE_TRAN_MS = 30_000;
export const SO_LAN_TOI_DA = 8;
export const LY_DO_SERVER_NGAT = "io server disconnect";
export const LOI_HANDSHAKE_HET_PHIEN = "UNAUTHORIZED";
/** fix round 1 (I1) — server không xác thực được VÌ HẠ TẦNG (DB / sổ phiên): vẫn bị từ chối, nhưng nên tự thử lại tới khi DB về. */
export const LOI_HANDSHAKE_HA_TANG = "SERVICE_UNAVAILABLE";

function ganKhoiPhucMacDinh(fn: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const khiHien = () => {
    if (document.visibilityState === "visible") fn();
  };
  window.addEventListener("online", fn);
  document.addEventListener("visibilitychange", khiHien);
  return () => {
    window.removeEventListener("online", fn);
    document.removeEventListener("visibilitychange", khiHien);
  };
}

/** Độ trễ của lần thử thứ `lan` (0-based): lần 0 ∈ [1 s, 3 s]; sau đó cơ số × 2^lan có nhiễu ±50 %, trần TRE_TRAN_MS. */
export function treLanThu(lan: number, r: number): number {
  if (lan <= 0) return Math.round(TRE_DAU_MIN_MS + r * (TRE_DAU_MAX_MS - TRE_DAU_MIN_MS));
  const coSo = Math.min(TRE_TRAN_MS, TRE_DAU_MAX_MS * 2 ** lan);
  return Math.round(Math.min(TRE_TRAN_MS, coSo * (0.5 + r * 0.5)));
}

/** Gắn bộ nối lại vào một socket. Trả hàm gỡ. */
export function ganNoiLaiKhiServerNgat(socket: SocketNoiLai, o: TuyChonNoiLai = {}): () => void {
  const henGio = o.henGio ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const huyHen = o.huyHen ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const ngauNhien = o.ngauNhien ?? Math.random;
  let lan = 0;
  let hen: unknown = null;
  let biServerNgat = false;
  let trangThai: TrangThaiNoiLai = "binh_thuong";
  const dat = (t: TrangThaiNoiLai) => {
    if (t === trangThai) return;
    trangThai = t;
    o.khiDoiTrangThai?.(t);
  };
  /** `khongTran` (I1 — hạ tầng hỏng): không giới hạn số lần, độ trễ vẫn lùi tới trần TRE_TRAN_MS. */
  const thu = (khongTran = false) => {
    if (hen !== null) return;
    if (!khongTran && lan >= SO_LAN_TOI_DA) {
      dat("dung");
      return;
    }
    const ms = treLanThu(Math.min(lan, SO_LAN_TOI_DA), ngauNhien());
    lan++;
    dat(khongTran ? "cho_dich_vu" : "dang_noi_lai");
    hen = henGio(() => {
      hen = null;
      if (!socket.connected) socket.connect();
    }, ms);
  };
  const onDisconnect = (lyDo: unknown) => {
    if (lyDo !== LY_DO_SERVER_NGAT) return;
    biServerNgat = true;
    thu();
  };
  const onConnectError = (err: unknown) => {
    const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "");
    // I1 — hạ tầng hỏng: LUÔN tự thử lại (kể cả lần nối đầu / nối lại của socket.io sau khi mạng chập), không giới hạn số lần.
    if (msg === LOI_HANDSHAKE_HA_TANG) {
      thu(true);
      return;
    }
    if (!biServerNgat) return; // lỗi nối lần ĐẦU (khác hạ tầng): hành vi cũ giữ nguyên (không đổi đường đăng nhập ban đầu)
    if (msg === LOI_HANDSHAKE_HET_PHIEN) {
      if (hen !== null) huyHen(hen);
      hen = null;
      biServerNgat = false;
      dat("het_phien");
      o.khiHetPhien?.();
      return;
    }
    // middleware từ chối vì lý do khác (vd. RATE_LIMITED) ⇒ socket.io không tự thử lại ⇒ thử lại có giới hạn; lỗi mạng (socket còn active)
    // ⇒ bộ nối lại của socket.io-client lo.
    if (socket.active === false) thu();
  };
  const onConnect = () => {
    if (hen !== null) huyHen(hen);
    hen = null;
    lan = 0;
    const sauNgat = biServerNgat;
    biServerNgat = false;
    dat("binh_thuong");
    if (sauNgat) o.khiQuyenDoi?.();
  };
  // m8 — đã dừng (hết lượt) ⇒ mạng về / tab hiện lại thì thử lại từ đầu (không bao giờ kẹt im lặng tới khi tải lại trang).
  const goKhoiPhuc = (o.ganKhoiPhuc ?? ganKhoiPhucMacDinh)(() => {
    if (trangThai !== "dung" || socket.connected) return;
    lan = 0;
    thu();
  });
  socket.on("disconnect", onDisconnect);
  socket.on("connect_error", onConnectError);
  socket.on("connect", onConnect);
  return () => {
    if (hen !== null) huyHen(hen);
    goKhoiPhuc();
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
    socket.off("connect", onConnect);
  };
}
