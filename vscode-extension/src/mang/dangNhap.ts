/**
 * I/O đăng nhập. Mật khẩu KHÔNG BAO GIỜ được ghi log, không vào settings.json — nó chỉ đi thẳng
 * vào thân request rồi bị bỏ.
 */
import { docCookiePhien, phanTichKetQuaDangNhap, kiemTraServerUrl, type KetQuaDangNhap } from "../loi/dangNhap";

export async function dangNhap(
  serverUrl: string,
  ten: string,
  matKhau: string,
): Promise<{ ket: KetQuaDangNhap; cookie: string | null }> {
  // serverUrl đến từ cấu hình VSCode — workspace lạ có thể cố ghi đè. Chặn scheme lạ TRƯỚC khi
  // ghép URL và gửi mật khẩu đi, để không rò credential sang nơi không rõ.
  const kt = kiemTraServerUrl(serverUrl);
  if (!kt.ok) return { ket: { loai: "loi", thongDiep: kt.lyDo }, cookie: null };

  const res = await fetch(`${kt.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ten, password: matKhau }),
  });
  let than: unknown = null;
  try {
    than = await res.json();
  } catch {
    than = null;
  }
  return { ket: phanTichKetQuaDangNhap(than), cookie: docCookiePhien(res.headers.getSetCookie()) };
}
