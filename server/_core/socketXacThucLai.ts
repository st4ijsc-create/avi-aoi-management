/**
 * ★★★ F5-nhanh (2026-11-02) — XÁC THỰC LẠI TẠI THỜI ĐIỂM THAO TÁC cho handler socket NHẠY CẢM.
 *
 * Lỗ được vá: `socket.data.user` là ẢNH CHỤP lúc handshake (`socket.ts` io.use) và không bao giờ làm mới. Mọi cổng socket đọc
 * bản chụp ấy ⇒ một admin bị HẠ vai vẫn `admin:approve_registration` (đúc khoá API máy) tới khi socket rớt; tắt tài khoản, đăng
 * xuất, thu hồi phiên đều không chạm socket đang mở.
 *
 * Luật (MỘT hàm, mọi handler nhạy cảm gọi TRƯỚC khi hành động — census `socketThaoTacNhayCamCensus.test.ts`):
 *   • đọc LẠI từ DB, ngay lúc thao tác: hàng `users` (vai + `isActive`) và hàng sổ phiên `user_sessions` của CHÍNH vé cookie mà
 *     socket đã dùng lúc handshake (vé đọc lại từ `socket.handshake.headers.cookie` bằng `docVePhienTuCookie` — cùng bộ đọc với
 *     `sdk.xacThucTho`; KHÔNG lưu vé vào `socket.data`);
 *   • KHÔNG đọc qua auth cache (`getCachedAuthUser`): cache là bản sao ≤ TTL, chính là thứ cần tránh;
 *   • trả CHỦ THỂ MỚI (`DuLieuSocket` với vai từ DB) để handler đưa vào cổng quyền sẵn có (`duocQuanLyDangKyMay`,
 *     `duocTuChoiDangKyMay`) — một luật quyền, chỉ thay NGUỒN vai;
 *   • FAIL-CLOSED: không phải socket người dùng / không có vé / lỗi tra cứu / không có hàng người dùng / tài khoản tắt /
 *     không có hàng phiên / phiên bị thu hồi / phiên hết hạn / phiên của người KHÁC / bị BUỘC ĐỔI MẬT KHẨU (cùng cổng + cùng vai
 *     miễn trừ như handshake) ⇒ từ chối.
 *     ⚠ KHÁC `chanNeuPhienDaThuHoi` (fail-OPEN trên lỗi tra cứu cho HTTP): ở đây hành động là ĐÚC KHOÁ / đổi trạng thái —
 *     "không hỏi được" phải rơi về CHẶN.
 *
 * F5 đầy đủ (socketXetLaiQuyen.ts) bổ sung chiều PHÒNG: đổi quyền / phạm vi / phiên ⇒ socket bị NGẮT (trigger 0435 + bộ nhận); lượt quét của nó
 * dùng lại hàm này (cùng luật fail-closed) để kiểm lại mọi socket sống.
 */
import { biChanBoiCongDoiMatKhau } from "@shared/buocDoiMatKhau";
import { docVePhienTuCookie } from "./vePhienCookie";
import { suyRaPhaiDoiMatKhau } from "./publicUser";
import type { DuLieuSocket } from "./socketPhongQuyen";

/** Hàng người dùng tối thiểu mà phép xác thực lại cần. */
export interface HangNguoiDungXacThucLai {
  id: number;
  role?: string | null;
  isActive?: boolean | null;
  name?: string | null;
  /** Hai mốc của cổng BUỘC ĐỔI MẬT KHẨU — có sẵn trong hàng `users` (`getUserById` = select *), không tốn thêm câu hỏi. */
  passwordChangedAt?: Date | string | null;
  passwordInvalidBefore?: Date | string | null;
}

/**
 * F5-nhanh polish — CÙNG cổng buộc-đổi-mật-khẩu mà handshake áp (`sdk.chanNeuPhaiDoiMatKhau` = `biChanBoiCongDoiMatKhau(vai,
 * suyRaPhaiDoiMatKhau(mốc))`), trên hàng VỪA đọc và vai VỪA đọc (vai miễn trừ — `shared/buocDoiMatKhau.ts` — giữ nguyên quyết định chủ dự án).
 * Mốc có giá trị mà không đọc được thành ngày ⇒ coi là PHẢI đổi (hỏng theo chiều ĐÓNG).
 */
function biBuocDoiMatKhau(nguoi: HangNguoiDungXacThucLai, vai: string): boolean {
  const ngay = (v: Date | string | null | undefined): Date | null | "hong" => {
    if (v == null) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? "hong" : d;
  };
  const doiLuc = ngay(nguoi.passwordChangedAt);
  const thuHoi = ngay(nguoi.passwordInvalidBefore);
  const phaiDoi =
    thuHoi === "hong" || (thuHoi !== null && doiLuc === "hong")
      ? true
      : suyRaPhaiDoiMatKhau({ passwordChangedAt: doiLuc as Date | null, passwordInvalidBefore: thuHoi as Date | null });
  return biChanBoiCongDoiMatKhau(vai, phaiDoi);
}
/** Hàng sổ phiên tối thiểu. */
export interface HangPhienXacThucLai {
  /** F5 đầy đủ — `user_sessions.id`: khoá phòng điều khiển `kiem:phien:{id}` lúc handshake (KHÔNG BAO GIỜ là vé). */
  id?: number | null;
  userId: number;
  isActive?: boolean | null;
  expiresAt?: Date | string | null;
}
/** Bộ đọc CÓ THẨM QUYỀN (DB) — tách ra để lưới tiêm (không cần CSDL thật). */
export interface BoDocChuThe {
  docNguoiDung(userId: number): Promise<HangNguoiDungXacThucLai | null | undefined>;
  docPhien(veCookie: string): Promise<HangPhienXacThucLai | null | undefined>;
}

let boDocGhiDe: BoDocChuThe | null = null;
/** Chỉ lưới: thay bộ đọc chủ thể. `null` ⇒ về mặc định (`db.getUserById` / `db.getSessionByToken` THẬT). */
export function __datBoDocChuTheChoTest(b: BoDocChuThe | null): void {
  boDocGhiDe = b;
}
/** F5 đầy đủ — cùng bộ đọc (và cùng seam) cho khoá phiên lúc handshake và lượt quét xét lại quyền (`socketXetLaiQuyen.ts`). */
export async function layBoDocChuThe(): Promise<BoDocChuThe> {
  if (boDocGhiDe) return boDocGhiDe;
  // Import động: giữ socket.ts không kéo thêm cây db lúc khởi động (như socketPhongQuyen).
  const db = await import("../db");
  return {
    docNguoiDung: (id) => db.getUserById(id),
    docPhien: (ve) => db.getSessionByToken(ve),
  };
}

/** Hình dạng socket mà phép xác thực lại cần (socket.io `Socket` thoả). */
export interface SocketXacThucLai {
  data: unknown;
  handshake?: { headers?: Record<string, unknown> | null } | null;
}

export type KetQuaXacThucLai =
  | { ok: true; data: DuLieuSocket & { clientType: "browser"; user: { id: number; role: string; name: string | null } } }
  | { ok: false; lyDo: string };

/**
 * Đọc lại chủ thể của socket TẠI THỜI ĐIỂM THAO TÁC. Không bao giờ ném: mọi lỗi ⇒ `{ ok:false }`.
 * `lyDo` là mã ngắn cho dòng log từ chối (không chứa vé, không chứa dữ liệu payload).
 */
export async function xacThucLaiChoThaoTacSocket(socket: SocketXacThucLai): Promise<KetQuaXacThucLai> {
  try {
    const data = (socket?.data ?? null) as DuLieuSocket | null;
    const idChup = data?.user?.id;
    if (data?.clientType !== "browser" || typeof idChup !== "number" || !Number.isFinite(idChup)) {
      return { ok: false, lyDo: "KHONG_PHAI_SOCKET_NGUOI_DUNG" };
    }
    const cookie = socket.handshake?.headers?.cookie;
    const ve = docVePhienTuCookie(typeof cookie === "string" ? cookie : undefined);
    if (!ve) return { ok: false, lyDo: "KHONG_CO_VE_PHIEN" };

    const boDoc = await layBoDocChuThe();
    const [phien, nguoi] = await Promise.all([boDoc.docPhien(ve), boDoc.docNguoiDung(idChup)]);

    if (!phien) return { ok: false, lyDo: "PHIEN_KHONG_CO_TRONG_SO" };
    if (phien.isActive === false) return { ok: false, lyDo: "PHIEN_DA_THU_HOI" };
    if (phien.expiresAt != null && !(new Date(phien.expiresAt).getTime() > Date.now())) {
      return { ok: false, lyDo: "PHIEN_HET_HAN" };
    }
    if (phien.userId !== idChup) return { ok: false, lyDo: "PHIEN_CUA_NGUOI_KHAC" };

    if (!nguoi || nguoi.id !== idChup) return { ok: false, lyDo: "KHONG_CO_NGUOI_DUNG" };
    // `=== false` tường minh — cùng ngữ nghĩa `chanNeuTaiKhoanBiTat` (sdk.ts): cột cho phép NULL.
    if (nguoi.isActive === false) return { ok: false, lyDo: "TAI_KHOAN_BI_TAT" };
    const vai = String(nguoi.role ?? "");
    if (biBuocDoiMatKhau(nguoi, vai)) return { ok: false, lyDo: "PHAI_DOI_MAT_KHAU" };

    return {
      ok: true,
      data: {
        clientType: "browser",
        user: { id: nguoi.id, role: vai, name: nguoi.name ?? null },
      },
    };
  } catch (err) {
    console.error("[Socket.io] xac thuc lai chu the that bai (fail-closed):", (err as Error)?.message ?? err);
    return { ok: false, lyDo: "LOI_TRA_CUU" };
  }
}
