/**
 * Phần THUẦN của đăng nhập: đọc cookie phiên và phân loại đáp ứng.
 *
 * 2FA là nhánh RIÊNG vì extension chạy headless: không có bước nhập mã ⇒ phải từ chối rành mạch
 * chứ không được im lặng coi như sai mật khẩu (giống ràng buộc của CLI hiện có).
 */
export const TEN_COOKIE = "app_session_id";

/** Khoá cất cookie phiên trong SecretStorage. Khai MỘT chỗ — mọi tệp khác import từ đây. */
export const KHOA_COOKIE = "aviAiLocal.cookie";

/**
 * ★★★ ĐỢT F / TASK 1 — khoá cất TÊN TÀI KHOẢN trong `globalState` (KHÔNG phải SecretStorage: tên
 * tài khoản không phải bí mật, chỉ dùng để HIỂN THỊ trong khung chat sau khi đăng nhập — xem
 * `bangChat.ts#trangThaiDangNhap`). Khai chung MỘT chỗ với `KHOA_COOKIE` vì hai giá trị này luôn
 * đổi CÙNG LÚC (đăng nhập ghi cả hai, đăng xuất xoá cả hai — `extension.ts`).
 */
export const KHOA_TEN_TAI_KHOAN = "aviAiLocal.tenTaiKhoan";

export type KetQuaDangNhap =
  | { loai: "ok"; ten: string }
  | { loai: "can2fa" }
  | { loai: "loi"; thongDiep: string };

/** Giá trị cookie phiên trong danh sách header `Set-Cookie`, hoặc `null` nếu không có. */
export function docCookiePhien(dong: string[]): string | null {
  for (const d of dong) {
    const dau = d.split(";")[0]?.trim() ?? "";
    const moc = dau.indexOf("=");
    if (moc <= 0) continue;
    if (dau.slice(0, moc) === TEN_COOKIE) return dau.slice(moc + 1);
  }
  return null;
}

export function phanTichKetQuaDangNhap(du: unknown): KetQuaDangNhap {
  if (!du || typeof du !== "object") return { loai: "loi", thongDiep: "Đáp ứng không hợp lệ" };
  const o = du as Record<string, unknown>;
  if (o.requires2FA === true) return { loai: "can2fa" };
  if (o.success === true) {
    const nd = o.user as { name?: unknown } | undefined;
    return { loai: "ok", ten: typeof nd?.name === "string" ? nd.name : "" };
  }
  // Máy chủ trả lỗi ở trường `error` (oauth.ts:360), CHỈ 2FA mới dùng `message`. Đọc `error`
  // TRƯỚC — đọc nhầm `message` ở đây khiến MỌI lỗi thật (sai mật khẩu, khoá tài khoản, vô hiệu
  // hoá) đều rơi về câu dự phòng chung, người dùng không biết vì sao bị chặn.
  const loi = typeof o.error === "string" ? o.error : typeof o.message === "string" ? o.message : null;
  return { loai: "loi", thongDiep: loi ?? "Đăng nhập thất bại" };
}

/**
 * Máy chủ chỉ được là http/https. Vị từ này chặn đường rò credential: `serverUrl` đến từ cấu
 * hình VSCode, và một scheme lạ (file:, data:, javascript:) hoặc URL rác sẽ được ghép thẳng vào
 * request MANG MẬT KHẨU. Từ chối rành mạch còn hơn gửi bí mật đi nơi không rõ.
 */
export function kiemTraServerUrl(url: string): { ok: true; url: string } | { ok: false; lyDo: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, lyDo: "Địa chỉ máy chủ không hợp lệ" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, lyDo: `Giao thức không được phép: ${u.protocol}` };
  }
  return { ok: true, url: url.replace(/\/+$/, "") };
}
