/**
 * doc 81 Đợt 1B Task 12 — niêm phong mật khẩu trong `device_adapters.connection_options`
 * (json) bằng secretBox TRƯỚC khi lưu. Không cột mới, không migration: chỉ giá trị của khoá
 * `password` (và `ha.secondaryOptions.password` của endpoint dự phòng) đổi thành
 * `enc:v1:…`. Driver OPC UA đọc lại qua `decryptSecret` (opcuaSecurity.resolveOpcuaPassword);
 * dòng cũ còn plaintext vẫn chạy (secretBox passthrough) cho tới khi được sửa/lưu lại.
 *
 * `encryptSecret` idempotent ⇒ form sửa gửi lại nguyên ciphertext không bị mã hoá chồng.
 * THUẦN (ngoài secretBox), không đổi object đầu vào.
 */
import { encryptSecret } from "../security/secretBox";

function sealPassword(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...opts };
  if (typeof out.password === "string" && out.password !== "") {
    out.password = encryptSecret(out.password);
  }
  return out;
}

export function sealConnectionOptionSecrets(
  options: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!options || typeof options !== "object") return options;
  const out = sealPassword(options);
  const ha = out.ha;
  if (ha && typeof ha === "object" && !Array.isArray(ha)) {
    const haOut: Record<string, unknown> = { ...(ha as Record<string, unknown>) };
    const so = haOut.secondaryOptions;
    if (so && typeof so === "object" && !Array.isArray(so)) {
      haOut.secondaryOptions = sealPassword(so as Record<string, unknown>);
    }
    out.ha = haOut;
  }
  return out;
}
