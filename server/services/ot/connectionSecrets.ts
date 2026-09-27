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
import { parseOpcuaSecurityOptions } from "./drivers/opcuaSecurity"; // final wave (item 5): so sánh bảo mật theo hiệu lực

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
 * (không có ⇒ bỏ khoá). Đệ quy theo object; final wave (item 5): MẢNG được khôi phục theo
 * ĐÚNG CHỈ SỐ — đối xứng với redactConnectionOptionSecrets (che theo từng phần tử) — trước đây
 * mảng đi qua nguyên vẹn nên phần tử mang placeholder bị LƯU chuỗi "[redacted]" làm mật khẩu.
 *
 * ⚠ Hàm này KHÔNG tự hỏi "bí mật có được phép giữ lại không" — đó là `secretReentryRequired`,
 * router phải gọi nó TRƯỚC (đổi endpoint/bảo mật thì placeholder không được khôi phục).
 */
export function restoreRedactedSecrets(incoming: unknown, stored: unknown): unknown {
  if (Array.isArray(incoming)) {
    const st = Array.isArray(stored) ? stored : [];
    return incoming.map((v, i) => restoreRedactedSecrets(v, st[i]));
  }
  if (incoming === null || typeof incoming !== "object") return incoming;
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

// ── doc 81 Đợt 1B final wave (item 5, security) — đổi nơi gửi/cách bảo vệ ⇒ nhập lại bí mật ──
/**
 * Lỗ được ghim: một người có canEdit sửa `endpoint` (hoặc hạ `securityMode` xuống None) mà gửi kèm
 * "[redacted]" ⇒ router khôi phục mật khẩu UserName đã lưu ⇒ mật khẩu ấy được gửi tới host do họ
 * chọn / đi trần trên dây. Luật: nếu endpoint, securityMode, securityPolicy hoặc trustOnFirstUse
 * ĐỔI so với dòng đã lưu thì placeholder KHÔNG được khôi phục — yêu cầu phải mang lại bí mật.
 * Áp cho cả endpoint dự phòng: `ha.secondaryEndpoint` + `ha.secondaryOptions.*`; và vì
 * deviceAdapter.ts dùng LẠI options chính khi không có secondaryOptions, đổi secondaryEndpoint
 * khi ấy cũng đụng tới bí mật chính.
 */

/** Khoá bảo mật làm nên "cách bí mật được bảo vệ trên dây". */
const BINDING_KEYS = ["securityMode", "securityPolicy", "trustOnFirstUse"] as const;
type BindingKey = (typeof BINDING_KEYS)[number];

function normEndpoint(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * So sánh THEO HIỆU LỰC (parseOpcuaSecurityOptions: thiếu securityMode ≡ None/None, hoa-thường
 * không tính); tổ hợp không parse được (giao thức khác dùng khoá cùng tên) ⇒ so chuỗi thô đã
 * chuẩn hoá. Trả về khoá đầu tiên đổi, hoặc null.
 */
function firstBindingKeyChanged(incoming: Record<string, unknown>, stored: Record<string, unknown>): BindingKey | null {
  let a: Record<BindingKey, string>;
  let b: Record<BindingKey, string>;
  try {
    const pi = parseOpcuaSecurityOptions(incoming);
    const ps = parseOpcuaSecurityOptions(stored);
    a = { securityMode: pi.securityMode, securityPolicy: pi.securityPolicy, trustOnFirstUse: String(pi.trustOnFirstUse) };
    b = { securityMode: ps.securityMode, securityPolicy: ps.securityPolicy, trustOnFirstUse: String(ps.trustOnFirstUse) };
  } catch {
    const raw = (o: Record<string, unknown>): Record<BindingKey, string> => ({
      securityMode: String(o.securityMode ?? "").trim().toLowerCase(),
      securityPolicy: String(o.securityPolicy ?? "").trim().toLowerCase(),
      trustOnFirstUse: String(o.trustOnFirstUse ?? "").trim().toLowerCase(),
    });
    a = raw(incoming);
    b = raw(stored);
  }
  for (const k of BINDING_KEYS) if (a[k] !== b[k]) return k;
  return null;
}

/** Object có khoá "giống bí mật" mang đúng placeholder (đệ quy, KHÔNG vào nhánh `ha` — dự phòng xét riêng). */
export function carriesRedactedPlaceholder(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesRedactedPlaceholder);
  if (value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "ha") continue;
    if (v === REDACTED_SECRET && SENSITIVE_KEY_RE.test(k)) return true;
    if (carriesRedactedPlaceholder(v)) return true;
  }
  return false;
}

/** Object đang GIỮ một bí mật thật (không rỗng, không placeholder), không vào nhánh `ha`. */
export function holdsStoredSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsStoredSecret);
  if (value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "ha") continue;
    if (SENSITIVE_KEY_RE.test(k) && v !== null && v !== undefined && v !== "" && v !== REDACTED_SECRET) return true;
    if (holdsStoredSecret(v)) return true;
  }
  return false;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export interface SecretReentryViolation {
  /** Trường vừa đổi khiến bí mật đã lưu không được dùng lại (đưa vào appError params.field). */
  field: string;
}

/**
 * Trả về vi phạm đầu tiên, hoặc null khi được phép khôi phục placeholder. `incoming.options ===
 * undefined` nghĩa là yêu cầu KHÔNG gửi connectionOptions (giữ nguyên dòng đã lưu) — với một lượt
 * đổi endpoint, điều đó tương đương với placeholder cho MỌI bí mật đang lưu.
 */
export function secretReentryRequired(
  incoming: { endpoint?: string; options?: Record<string, unknown> | null },
  stored: { endpoint: string; options: Record<string, unknown> | null | undefined },
): SecretReentryViolation | null {
  const so = stored.options ?? {};
  const io = incoming.options === null ? {} : incoming.options;

  // ── Bí mật CHÍNH ─────────────────────────────────────────────────────────────
  const primaryKept = io === undefined ? holdsStoredSecret(so) : carriesRedactedPlaceholder(io);
  const endpointChanged = incoming.endpoint !== undefined && normEndpoint(incoming.endpoint) !== normEndpoint(stored.endpoint);
  if (primaryKept) {
    if (endpointChanged) return { field: "endpoint" };
    if (io !== undefined) {
      const k = firstBindingKeyChanged(io, so);
      if (k) return { field: k };
    }
  }

  // ── Bí mật DỰ PHÒNG (ha.secondaryEndpoint / ha.secondaryOptions) ─────────────
  if (io === undefined) return null; // không gửi options ⇒ nhánh ha giữ nguyên
  const haIn = obj(io.ha);
  const haSt = obj(so.ha);
  if (!haIn) return null;
  const secIn = obj(haIn.secondaryOptions);
  const secSt = obj(haSt?.secondaryOptions);
  const secondaryEndpointChanged =
    haIn.secondaryEndpoint !== undefined && normEndpoint(haIn.secondaryEndpoint) !== normEndpoint(haSt?.secondaryEndpoint);
  // Không có secondaryOptions riêng ⇒ dự phòng dùng options CHÍNH (deviceAdapter.ts) ⇒ đổi
  // secondaryEndpoint gửi bí mật chính tới host mới.
  const secondaryKept = secIn ? carriesRedactedPlaceholder(secIn) : primaryKept;
  if (!secondaryKept) return null;
  if (secondaryEndpointChanged) return { field: "ha.secondaryEndpoint" };
  if (secIn) {
    const k = firstBindingKeyChanged(secIn, secSt ?? {});
    if (k) return { field: `ha.secondaryOptions.${k}` };
  }
  return null;
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
