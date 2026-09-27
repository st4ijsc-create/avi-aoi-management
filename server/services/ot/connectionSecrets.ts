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
import { SENSITIVE_KEY_RE } from "../assetRegistry/configDriftService";

function sealPassword(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...opts };
  if (typeof out.password === "string" && out.password !== "") {
    out.password = encryptSecret(out.password);
  }
  return out;
}

// ── Fix round 1 #2 — không để bí mật rời server ────────────────────────────────
/** Chuỗi thay cho mọi giá trị bí mật trong phản hồi API (form sửa gửi lại ⇒ giữ bí mật cũ). */
export const REDACTED_SECRET = "[redacted]";

/**
 * Thay giá trị của mọi khoá "giống bí mật" (cùng mẫu với configDriftService.redactSecrets:
 * password/secret/token/credential/passphrase/private/apiKey) bằng REDACTED_SECRET, đệ quy.
 * Khác redactSecrets (XOÁ khoá, cho hash): ở đây GIỮ khoá để UI biết "đã có mật khẩu" và để
 * update nhận ra placeholder. Giá trị rỗng/null giữ nguyên (không có gì để che).
 */
export function redactConnectionOptionSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConnectionOptionSecrets);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k) && v !== null && v !== undefined && v !== "") out[k] = REDACTED_SECRET;
      else out[k] = redactConnectionOptionSecrets(v);
    }
    return out;
  }
  return value;
}

/** Bản ghi adapter an toàn để trả ra trình duyệt (chỉ đổi connectionOptions). */
export function redactAdapterRow<T extends { connectionOptions?: unknown }>(row: T): T {
  if (!row || typeof row !== "object" || !("connectionOptions" in row)) return row;
  return { ...row, connectionOptions: redactConnectionOptionSecrets(row.connectionOptions) };
}

/**
 * Update: khoá bí mật mang đúng REDACTED_SECRET ⇒ lấy lại giá trị ĐÃ LƯU cùng đường dẫn
 * (không có ⇒ bỏ khoá). Đệ quy theo object; mảng giữ nguyên thứ tự và không ghép theo chỉ số.
 */
export function restoreRedactedSecrets(incoming: unknown, stored: unknown): unknown {
  if (incoming === null || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  const st = stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    if (v === REDACTED_SECRET && SENSITIVE_KEY_RE.test(k)) {
      if (st[k] !== undefined && st[k] !== REDACTED_SECRET) out[k] = st[k];
      continue;
    }
    out[k] = restoreRedactedSecrets(v, st[k]);
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
