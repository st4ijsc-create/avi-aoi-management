/**
 * Phần THUẦN của đăng nhập: đọc cookie phiên và phân loại đáp ứng.
 *
 * 2FA là nhánh RIÊNG vì extension chạy headless: không có bước nhập mã ⇒ phải từ chối rành mạch
 * chứ không được im lặng coi như sai mật khẩu (giống ràng buộc của CLI hiện có).
 */
export const TEN_COOKIE = "app_session_id";

/** Khoá cất cookie phiên trong SecretStorage. Khai MỘT chỗ — mọi tệp khác import từ đây. */
export const KHOA_COOKIE = "aviAiLocal.cookie";

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
  return {
    loai: "loi",
    thongDiep: typeof o.message === "string" ? o.message : "Đăng nhập thất bại",
  };
}
