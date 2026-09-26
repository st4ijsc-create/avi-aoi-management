/**
 * ★★★ doc 83 · (A)+(B) — **DANH TÍNH CHO MẶT TIẾP XÚC KHÔNG-CÓ-PHIÊN-WEB (CLI · MCP).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY LÀ CHỖ DỄ MỞ LỖ NHẤT CỦA CẢ LƯỢT NÀY, VÀ VÌ SAO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Toàn bộ lớp an toàn của doc 78/79 neo vào **MỘT** con số: `ToolExecContext.user.id`.
 *   • RBAC — `checkPermission(userId, role, "ai_repo_read", "canView"|"canEdit")` và
 *     `("ai_repo_exec","canCreate")`; `proposeAction` gọi nó lần 1, `confirmAction` gọi LẠI lần 2.
 *   • Quyền sở hữu — `ai_pending_actions.userId` (một người KHÔNG duyệt được đề xuất của người
 *     khác), `ai_coding_sessions.userId`, `ai_coding_lessons.userId`.
 *   • Sổ WORM — `audit_logs` ghi *ai* đã ghi tệp nào.
 * Trên web con số ấy đến từ `ctx.user.id`, tức từ một cookie phiên đã ký. **CLI và MCP không có
 * cookie.** Nếu ta để nó đến từ một tham số dòng lệnh, một biến môi trường, hay tên người dùng của
 * hệ điều hành, thì **cả ba hàng rào trên biến thành trang trí trong đúng một dòng**: ai cũng khai
 * được `--user-id 1` và trở thành admin.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⇒ QUYẾT ĐỊNH: **DANH TÍNH CLI = MỘT LƯỢT ĐĂNG NHẬP THẬT, QUA ĐÚNG HÀM MÀ WEB DÙNG.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `verifyCredentials()` của `server/_core/authService.ts` là hàm mà `POST /api/auth/login` gọi.
 * Dùng lại **NGUYÊN** nó nghĩa là CLI thừa hưởng, không phải chép lại:
 *   • `bcrypt.compare` trên `user_secrets.passwordHash` (KHÔNG có đường nào khác vào);
 *   • khoá tài khoản sau 5 lần sai (`MAX_LOGIN_ATTEMPTS` / `LOCKOUT_MINUTES`) — một CLI dò mật
 *     khẩu bị chặn bởi ĐÚNG bộ đếm mà web dùng, không phải một bộ đếm thứ hai;
 *   • `isActive === false` ⇒ TỪ CHỐI;
 *   • hàng `audit_logs` cho **mọi** lượt thử, thành công lẫn thất bại.
 * Ta **không** viết một bảng token CLI, không đẻ một bí mật mới, không thêm migration. Bề mặt
 * chứng thực mới = **0**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BỐN RÀNG BUỘC LÀM CHO CLI **CHẶT HƠN** WEB, KHÔNG LỎNG HƠN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **2FA bật ⇒ CLI TỪ CHỐI.** `verifyCredentials` cố ý KHÔNG kiểm 2FA (docblock của chính nó:
 *     *"Does NOT issue a cookie or check 2FA — that is the caller's responsibility"*), và tuyến
 *     web `/api/auth/login` trả `requires2FA` rồi dừng. Một CLI chỉ gọi `verifyCredentials` và đi
 *     tiếp sẽ **vòng qua 2FA** — tức mở một cửa hậu vào đúng những tài khoản được bảo vệ NHẤT.
 *     Lượt này chưa dựng đường nhập mã TOTP ở terminal, nên câu trả lời fail-closed là **từ chối**:
 *     hẹp hơn web, không bao giờ rộng hơn. (Xem `MA_DANH_TINH.CAN_2FA`.)
 *  2. **Mật khẩu KHÔNG BAO GIỜ đến từ `argv`.** `argv` hiện nguyên văn trong bảng tiến trình
 *     (`tasklist /v`, `ps aux`, Sysmon) và trong lịch sử shell. `docNguonMatKhau()` nhận mật khẩu
 *     từ **TTY** hoặc từ **biến môi trường**, và `cli.ts` không đăng ký cờ `--mat-khau` nào —
 *     `danhTinhCli.census.test.ts` cưỡng chế bằng AST.
 *  3. **Không lưu vé xuống đĩa.** Danh tính sống trong bộ nhớ của tiến trình CLI và chết cùng nó.
 *     Một tệp `~/.avi-cli/token` là một bí mật dài hạn nằm ngoài mọi cơ chế thu hồi của repo này
 *     (`user_sessions` / `thuHoiPhienTheoToken`), tức một bề mặt mới phải canh mà không ai canh.
 *  4. **Không có danh tính mặc định.** Thiếu tên hoặc thiếu mật khẩu ⇒ `{ok:false}`. Không có
 *     nhánh nào trả về một người dùng khi chưa chứng minh được là ai — kể cả nhánh `catch`.
 *
 * ⚠ `req` ĐƯA VÀO `verifyCredentials` LÀ MỘT VẬT GIẢ, VÀ ĐIỀU ĐÓ AN TOÀN: hàm chỉ đọc `req.ip`,
 *   `req.socket?.remoteAddress`, `req.headers["user-agent"]` — ba ô ấy đi vào **sổ audit**, không
 *   vào một phép phán quyết nào. Ta khai thật `"cli:<tên tiến trình>"` để một người soi sổ phân
 *   biệt được lượt đăng nhập từ terminal với lượt từ trình duyệt.
 */
import type { Request } from "express";
import { LoginError, verifyCredentials } from "../../_core/authService";
import { get2FAStatus } from "../../db/auth";

/** Nguồn gọi — chỉ để ghi sổ, KHÔNG tham gia phán quyết nào. */
export type NguonDanhTinh = "cli" | "mcp";

/**
 * Mã máy-đọc-được của một lượt phân giải danh tính. Mỗi mã ⇒ một hành động KHÁC của người dùng
 * (đúng luật đã dùng ở `repoSandbox.MA_TU_CHOI_HOP_CAT`): gộp hai lý do vào một mã là bắt người ta
 * đi tìm một lỗi không tồn tại.
 */
export const MA_DANH_TINH = {
  /** Không có tên đăng nhập ⇒ CLI không chạy. Không có "người dùng mặc định". */
  THIEU_TEN: "THIEU_TEN",
  /** Có tên nhưng không có mật khẩu ⇒ TỪ CHỐI (không có đường nào đi tiếp mà chưa chứng minh). */
  THIEU_MAT_KHAU: "THIEU_MAT_KHAU",
  /** Sai tên hoặc sai mật khẩu — cố ý KHÔNG nói cái nào sai (đúng như tuyến web). */
  SAI_THONG_TIN: "SAI_THONG_TIN",
  /** Tài khoản bị vô hiệu hoá. */
  TAI_KHOAN_TAT: "TAI_KHOAN_TAT",
  /** Tài khoản đang bị khoá do đăng nhập sai nhiều lần. */
  TAI_KHOAN_KHOA: "TAI_KHOAN_KHOA",
  /** Tài khoản không hỗ trợ đăng nhập bằng mật khẩu (OpenID…). */
  KHONG_HO_TRO_MAT_KHAU: "KHONG_HO_TRO_MAT_KHAU",
  /** ★ Tài khoản BẬT 2FA — xem ràng buộc 1 ở docblock đầu file. Fail-closed. */
  CAN_2FA: "CAN_2FA",
  /** Hỏng hạ tầng (CSDL không với tới…). KHÔNG phải "sai mật khẩu", và cũng KHÔNG cho đi tiếp. */
  LOI_HE_THONG: "LOI_HE_THONG",
} as const;
export type MaDanhTinh = (typeof MA_DANH_TINH)[keyof typeof MA_DANH_TINH];

/**
 * Danh tính đã CHỨNG MINH. Ba ô này (và chỉ ba ô) là thứ dựng nên `ToolExecContext.user` — cùng
 * hình dạng mà tuyến web dựng từ `ctx.user`.
 */
export interface DanhTinhCli {
  readonly userId: number;
  readonly role: string;
  readonly ten: string | null;
}

export type KetQuaDanhTinh =
  | { readonly ok: true; readonly danhTinh: DanhTinhCli }
  | { readonly ok: false; readonly ma: MaDanhTinh; readonly loi: string };

/** Câu giải thích cho mỗi mã — tiếng Việt, hiện thẳng ở terminal. */
export function cauTuChoiDanhTinh(ma: MaDanhTinh): string {
  switch (ma) {
    case MA_DANH_TINH.THIEU_TEN:
      return "Thiếu tên đăng nhập. CLI KHÔNG có tài khoản mặc định — mọi lượt chạy phải chứng minh mình là ai.";
    case MA_DANH_TINH.THIEU_MAT_KHAU:
      return "Thiếu mật khẩu. Nhập ở dấu nhắc, hoặc đặt biến môi trường (mật khẩu KHÔNG được truyền qua tham số dòng lệnh — nó hiện trong bảng tiến trình).";
    case MA_DANH_TINH.SAI_THONG_TIN:
      return "Tên đăng nhập hoặc mật khẩu không đúng.";
    case MA_DANH_TINH.TAI_KHOAN_TAT:
      return "Tài khoản đã bị vô hiệu hoá.";
    case MA_DANH_TINH.TAI_KHOAN_KHOA:
      return "Tài khoản đang bị tạm khoá do đăng nhập sai nhiều lần. Chờ hết thời gian khoá rồi thử lại.";
    case MA_DANH_TINH.KHONG_HO_TRO_MAT_KHAU:
      return "Tài khoản này không đăng nhập bằng mật khẩu được.";
    case MA_DANH_TINH.CAN_2FA:
      return (
        "Tài khoản đang bật xác thực hai lớp (2FA). CLI lượt này CHƯA có đường nhập mã 2FA, nên nó TỪ CHỐI " +
        "thay vì đi vòng qua lớp bảo vệ ấy. Dùng giao diện web, hoặc một tài khoản không bật 2FA."
      );
    case MA_DANH_TINH.LOI_HE_THONG:
    default:
      return "Không phân giải được danh tính do lỗi hệ thống (CSDL không với tới?). KHÔNG có đường đi tiếp khi chưa biết bạn là ai.";
  }
}

/**
 * ★ Vật giả hình dạng `Request` cho `verifyCredentials`. Ba ô nó đọc đều là ô **ghi sổ**, không ô
 * nào tham gia phán quyết — xem docblock đầu file.
 */
function reqGia(nguon: NguonDanhTinh): Request {
  return {
    ip: `cli:${nguon}`,
    socket: { remoteAddress: `cli:${nguon}` },
    headers: { "user-agent": `avi-coding-${nguon}` },
  } as unknown as Request;
}

export interface ThamSoXacThuc {
  readonly tenDangNhap: string | null | undefined;
  readonly matKhau: string | null | undefined;
  readonly nguon: NguonDanhTinh;
}

/**
 * ★★★ CỬA DUY NHẤT biến một cặp (tên, mật khẩu) thành một `userId`. **Không có cửa thứ hai**, và
 * `cauNoiCli.ts` chỉ nhận `DanhTinhCli` — nó không biết cách tự dựng một cái.
 *
 * ⚠ **KHÔNG BAO GIỜ ném.** Một lượt ném ở đây rất dễ bị người gọi bọc `catch` rồi đi tiếp; một
 *   phán quyết `{ok:false}` thì phải được đọc. Cùng kỷ luật với `thuXacThucRest`.
 */
export async function xacThucCli(p: ThamSoXacThuc): Promise<KetQuaDanhTinh> {
  const ten = typeof p.tenDangNhap === "string" ? p.tenDangNhap.trim() : "";
  const mk = typeof p.matKhau === "string" ? p.matKhau : "";
  if (ten === "") return { ok: false, ma: MA_DANH_TINH.THIEU_TEN, loi: cauTuChoiDanhTinh(MA_DANH_TINH.THIEU_TEN) };
  if (mk === "") return { ok: false, ma: MA_DANH_TINH.THIEU_MAT_KHAU, loi: cauTuChoiDanhTinh(MA_DANH_TINH.THIEU_MAT_KHAU) };

  let user: Awaited<ReturnType<typeof verifyCredentials>>;
  try {
    user = await verifyCredentials(ten, mk, reqGia(p.nguon));
  } catch (err) {
    const ma = maTuLoiDangNhap(err);
    return { ok: false, ma, loi: cauTuChoiDanhTinh(ma) };
  }

  /**
   * ★ Cổng 2FA — chạy SAU khi mật khẩu đã đúng, đúng thứ tự tuyến web dùng.
   * ⚠ Lượt đọc trạng thái 2FA hỏng ⇒ **TỪ CHỐI** (`LOI_HE_THONG`), KHÔNG "coi như không bật".
   *   "Không đọc được ⇒ cho qua" là đúng cái làm một cổng an toàn thành trang trí.
   */
  let bat2fa: boolean;
  try {
    const tt = await get2FAStatus(user.id);
    if (tt === null) return { ok: false, ma: MA_DANH_TINH.LOI_HE_THONG, loi: cauTuChoiDanhTinh(MA_DANH_TINH.LOI_HE_THONG) };
    bat2fa = tt.twoFactorEnabled === true;
  } catch {
    return { ok: false, ma: MA_DANH_TINH.LOI_HE_THONG, loi: cauTuChoiDanhTinh(MA_DANH_TINH.LOI_HE_THONG) };
  }
  if (bat2fa) return { ok: false, ma: MA_DANH_TINH.CAN_2FA, loi: cauTuChoiDanhTinh(MA_DANH_TINH.CAN_2FA) };

  return {
    ok: true,
    danhTinh: { userId: user.id, role: String(user.role), ten: user.name ?? null },
  };
}

/** Ánh xạ `LoginError.code` → mã của file này. Lỗi KHÔNG phải `LoginError` ⇒ lỗi hệ thống. */
function maTuLoiDangNhap(err: unknown): MaDanhTinh {
  if (!(err instanceof LoginError)) return MA_DANH_TINH.LOI_HE_THONG;
  switch (err.code) {
    case "ACCOUNT_DISABLED":
      return MA_DANH_TINH.TAI_KHOAN_TAT;
    case "ACCOUNT_LOCKED":
      return MA_DANH_TINH.TAI_KHOAN_KHOA;
    case "PASSWORD_UNSUPPORTED":
      return MA_DANH_TINH.KHONG_HO_TRO_MAT_KHAU;
    case "INVALID_CREDENTIALS":
    default:
      return MA_DANH_TINH.SAI_THONG_TIN;
  }
}

/**
 * ★ Biến môi trường chứa mật khẩu — **KHÔNG có cờ dòng lệnh tương ứng** (xem ràng buộc 2).
 * `AVI_CLI_PASSWORD` cho terminal, `AVI_MCP_PASSWORD` cho MCP (tiến trình do một MCP client sinh
 * ra, không có TTY để hỏi).
 */
export const BIEN_MAT_KHAU: Readonly<Record<NguonDanhTinh, string>> = {
  cli: "AVI_CLI_PASSWORD",
  mcp: "AVI_MCP_PASSWORD",
};
/** Biến môi trường chứa TÊN đăng nhập (tuỳ chọn cho CLI — có cờ `--nguoi-dung`; bắt buộc cho MCP). */
export const BIEN_NGUOI_DUNG: Readonly<Record<NguonDanhTinh, string>> = {
  cli: "AVI_CLI_USER",
  mcp: "AVI_MCP_USER",
};
