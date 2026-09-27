/**
 * doc 81 Đợt 1B Task 12 — bảo mật kênh OPC UA cho opcuaDriver (và Euromap 77 dùng lại driver).
 *
 * Trước bản này driver chỉ nói SecurityMode None, không PKI ⇒ server chỉ mở
 * SignAndEncrypt (S7-1500, Omron NX, KEPServerEX cấu hình chuẩn) không nối được (BE1 §1.1).
 *
 * ── CẤU HÌNH (khoá trong `device_adapters.connection_options`, json — KHÔNG cột mới) ──
 *   securityMode    "None" | "Sign" | "SignAndEncrypt"
 *   securityPolicy  "None" | "Basic256Sha256" | "Aes128_Sha256_RsaOaep" | "Aes256_Sha256_RsaPss"
 *   userName        tuỳ chọn; có userName + password ⇒ xác thực UserName, ngược lại ẩn danh
 *   password        chuỗi `enc:v1:…` của secretBox (router mã hoá khi lưu); chuỗi thường
 *                   cũ vẫn đọc được (secretBox passthrough) — không lưu plaintext MỚI
 *   trustOnFirstUse boolean, mặc định **false** — chứng chỉ server phải nằm sẵn trong trust-list
 *   Không đặt securityMode/securityPolicy ⇒ giữ None như cũ (không đổi hành vi) + cảnh báo
 *   MỘT lần mỗi tiến trình.
 *
 * ── PKI CỦA CLIENT ──────────────────────────────────────────────────────────────
 *   Thư mục: `OPCUA_PKI_DIR`, mặc định `<cwd>/data/opcua-pki` (thư mục dữ liệu của app,
 *   đã .gitignore). Lần nối bảo mật đầu tiên node-opcua tự sinh:
 *     <pki>/own/certs/client_certificate.pem   ← chứng chỉ của app (đưa cho PLC/server tin)
 *     <pki>/own/private/private_key.pem        ← khoá riêng (KHÔNG chép đi đâu)
 *
 * ── NGƯỜI VẬN HÀNH TIN MỘT CHỨNG CHỈ SERVER THẾ NÀO ─────────────────────────────
 *   1. Nối thử (testConnection hoặc bật adapter). Server chưa được tin ⇒ lỗi
 *      "server certificate is not trusted (BadCertificateUntrusted)" và node-opcua chép
 *      chứng chỉ server vào `<pki>/rejected/<CN>[<thumbprint>].pem`.
 *   2. So thumbprint trong tên tệp với thumbprint hiển thị trên PLC/server (TIA Portal,
 *      Sysmac, KEPServerEX…) — KHÔNG tin mù.
 *   3. CHUYỂN (move, không copy) tệp đó sang `<pki>/trusted/certs/`. Cách khác: chép chứng chỉ
 *      server xuất từ PLC (.der/.pem) vào `<pki>/trusted/certs/` TRƯỚC lần nối đầu — nếu nó đã
 *      nằm trong `<pki>/rejected/` thì phải XOÁ bản ở rejected/, vì node-opcua-pki coi chứng
 *      chỉ có mặt ở cả hai danh sách là BỊ TỪ CHỐI. Chứng chỉ server do CA cấp: chép chứng chỉ
 *      CA vào `<pki>/issuers/certs/` (+ CRL vào `<pki>/issuers/crl/`).
 *   4. Chiều ngược lại: đưa `<pki>/own/certs/client_certificate.pem` vào trust-list của
 *      server (PLC) — không có bước này server sẽ từ chối client.
 *   5. Nối lại — trust-list được đọc lại từ đĩa (watcher), không cần restart.
 *   `trustOnFirstUse: true` bỏ bước 1–3 (tự tin chứng chỉ lạ lần đầu) — CHỈ cho chạy thử.
 *   Fix round 1 (R20): TOFU chỉ chạy khi người vận hành đặt env
 *   `OPCUA_ALLOW_TRUST_ON_FIRST_USE=true` (mặc định tắt ⇒ từ chối trước khi mở socket), và dùng
 *   gốc PKI RIÊNG `<pki>/tofu` (trust-list + chứng chỉ client riêng: PLC phải tin
 *   `<pki>/tofu/own/certs/client_certificate.pem`). Một lần TOFU tự tin KHÔNG làm server được tin
 *   với adapter nghiêm ngặt. Mỗi lần tự tin ⇒ WARN kèm thumbprint.
 *   Thư mục PKI tạo với mode 0700; khoá riêng chmod 0600 trên POSIX (Windows: ACL kế thừa).
 */
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { decryptSecret, isEncrypted } from "../../security/secretBox";

export const OPCUA_SECURITY_MODES = ["None", "Sign", "SignAndEncrypt"] as const;
export type OpcuaSecurityModeName = (typeof OPCUA_SECURITY_MODES)[number];

export const OPCUA_SECURITY_POLICIES = [
  "None",
  "Basic256Sha256",
  "Aes128_Sha256_RsaOaep",
  "Aes256_Sha256_RsaPss",
] as const;
export type OpcuaSecurityPolicyName = (typeof OPCUA_SECURITY_POLICIES)[number];

export interface OpcuaSecuritySettings {
  securityMode: OpcuaSecurityModeName;
  securityPolicy: OpcuaSecurityPolicyName;
  trustOnFirstUse: boolean;
  /** false ⇒ không ai cấu hình bảo mật (mặc định cũ None) — dùng để cảnh báo một lần. */
  explicit: boolean;
}

function pickCaseInsensitive<T extends string>(raw: unknown, allowed: readonly T[], key: string): T | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error(`opcua: connectionOptions.${key} must be a string`);
  const hit = allowed.find((a) => a.toLowerCase() === raw.trim().toLowerCase());
  if (!hit) throw new Error(`opcua: connectionOptions.${key} "${raw}" is not one of ${allowed.join(" | ")}`);
  return hit;
}

/**
 * Đọc + kiểm cấu hình bảo mật. THUẦN. Tổ hợp vô nghĩa ⇒ throw (lỗi cấu hình, nói rõ):
 *   - mode None + policy khác None; mode Sign/SignAndEncrypt + policy None.
 * Mặc định: có mode bảo mật mà thiếu policy ⇒ Basic256Sha256; có policy bảo mật mà thiếu
 * mode ⇒ SignAndEncrypt; không có gì ⇒ None/None (explicit:false).
 */
export function parseOpcuaSecurityOptions(options: Record<string, unknown> | undefined | null): OpcuaSecuritySettings {
  const opts = options ?? {};
  const mode = pickCaseInsensitive(opts.securityMode, OPCUA_SECURITY_MODES, "securityMode");
  const policy = pickCaseInsensitive(opts.securityPolicy, OPCUA_SECURITY_POLICIES, "securityPolicy");
  const tofuRaw = opts.trustOnFirstUse;
  const trustOnFirstUse = tofuRaw === true || tofuRaw === "true" || tofuRaw === 1 || tofuRaw === "1";

  let securityMode: OpcuaSecurityModeName;
  let securityPolicy: OpcuaSecurityPolicyName;
  if (mode === undefined && policy === undefined) {
    securityMode = "None";
    securityPolicy = "None";
  } else if (mode === undefined) {
    securityPolicy = policy!;
    securityMode = policy === "None" ? "None" : "SignAndEncrypt";
  } else if (policy === undefined) {
    securityMode = mode;
    securityPolicy = mode === "None" ? "None" : "Basic256Sha256";
  } else {
    securityMode = mode;
    securityPolicy = policy;
  }
  if (securityMode === "None" && securityPolicy !== "None") {
    throw new Error(`opcua: securityMode None cannot be combined with securityPolicy ${securityPolicy}`);
  }
  if (securityMode !== "None" && securityPolicy === "None") {
    throw new Error(`opcua: securityMode ${securityMode} requires a securityPolicy other than None`);
  }
  return {
    securityMode,
    securityPolicy,
    trustOnFirstUse,
    explicit: mode !== undefined || policy !== undefined,
  };
}

/** Thư mục PKI của client: OPCUA_PKI_DIR, mặc định <cwd>/data/opcua-pki. Đọc MỖI lần gọi. */
export function resolveOpcuaPkiDir(): string {
  const env = process.env.OPCUA_PKI_DIR?.trim();
  return path.resolve(env ? env : path.join(process.cwd(), "data", "opcua-pki"));
}

/**
 * Mật khẩu UserName qua secretBox. `enc:v1:` giải mã; chuỗi thường cũ đi qua nguyên văn.
 * Giải mã hỏng (sai khoá / bị sửa) ⇒ throw — KHÔNG gửi rỗng, KHÔNG in mật khẩu.
 */
export function resolveOpcuaPassword(stored: unknown): string | undefined {
  if (typeof stored !== "string" || stored === "") return undefined;
  let plain: string | null;
  try {
    plain = decryptSecret(stored);
  } catch (e) {
    throw new Error(`opcua: cannot decrypt connectionOptions.password (${(e as Error)?.message ?? "secretBox error"})`);
  }
  if (plain == null) {
    throw new Error(
      isEncrypted(stored)
        ? "opcua: connectionOptions.password cannot be decrypted (SECRET_ENCRYPTION_KEY/JWT_SECRET changed or value tampered)"
        : "opcua: connectionOptions.password is empty",
    );
  }
  return plain;
}

// ── Cảnh báo None mặc định: MỘT lần mỗi tiến trình ─────────────────────────────
let warnedInsecureDefault = false;

/** Ghi cảnh báo "đang dùng None vì chưa cấu hình" đúng một lần. Trả true nếu lần này có ghi. */
export function warnInsecureDefaultOnce(endpoint: string): boolean {
  if (warnedInsecureDefault) return false;
  warnedInsecureDefault = true;
  let host = "";
  try {
    host = new URL(endpoint).host;
  } catch {
    host = "";
  }
  console.warn(
    `[OPCUA] securityMode not configured${host ? ` (first seen: ${host})` : ""} — using SecurityMode None ` +
      "(unsigned, unencrypted). Set connectionOptions.securityMode=SignAndEncrypt + securityPolicy=Basic256Sha256 " +
      "and trust the server certificate in OPCUA_PKI_DIR. This warning is logged once per process.",
  );
  return true;
}

// ── Fix round 1 (R20) — cảnh báo TƯ THẾ bảo mật: một lần cho mỗi (loại, endpoint) ──
// Driver không biết mã adapter; endpoint là định danh ổn định nhất của một adapter ở tầng này.
const POSTURE_WARN_MAX = 1000;
const postureWarned = new Set<string>();

/**
 * WARN một lần cho mỗi endpoint khi nó nối với `trustOnFirstUse` BẬT ("tofu") hoặc với
 * securityMode "None" ĐẶT TƯỜNG MINH ("none"). Tập nhớ có trần (không phình vô hạn).
 */
export function warnSecurityPostureOnce(kind: "tofu" | "none", endpoint: string): boolean {
  const key = `${kind}|${endpoint}`;
  if (postureWarned.has(key)) return false;
  if (postureWarned.size >= POSTURE_WARN_MAX) return false;
  postureWarned.add(key);
  console.warn(
    kind === "tofu"
      ? `[OPCUA] trustOnFirstUse is ON for ${endpoint} — unknown server certificates are auto-trusted into the ISOLATED ` +
          "<OPCUA_PKI_DIR>/tofu trust-list (never the strict one). Use only for commissioning/tests."
      : `[OPCUA] securityMode None set explicitly for ${endpoint} — traffic is unsigned and unencrypted.`,
  );
  return true;
}

/** Chỉ cho test. */
export function __resetOpcuaSecurityWarningForTest(): void {
  warnedInsecureDefault = false;
  postureWarned.clear();
}

/**
 * R20 — TOFU chỉ được phép khi NGƯỜI VẬN HÀNH bật `OPCUA_ALLOW_TRUST_ON_FIRST_USE=true` (env,
 * mặc định tắt). Một người có quyền sửa adapter (connectionOptions) KHÔNG tự bật được TOFU.
 * Gọi TRƯỚC khi mở socket/PKI.
 */
export function assertTrustOnFirstUseAllowed(trustOnFirstUse: boolean): void {
  if (!trustOnFirstUse) return;
  const v = process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE?.trim().toLowerCase();
  if (v === "true" || v === "1") return;
  throw new Error(
    "opcua: connectionOptions.trustOnFirstUse is requested but the operator has not enabled " +
      "OPCUA_ALLOW_TRUST_ON_FIRST_USE=true — refusing to connect. Trust the server certificate in " +
      "<OPCUA_PKI_DIR>/trusted/certs instead (see opcuaSecurity.ts).",
  );
}

/**
 * R20 — gốc PKI thực dùng: TOFU có gốc RIÊNG `<pki>/tofu` (trust-list riêng, chứng chỉ client
 * riêng) để một lần tự tin KHÔNG BAO GIỜ ghi vào `<pki>/trusted/certs` mà adapter nghiêm ngặt
 * đang theo dõi.
 */
export function opcuaPkiRoot(pkiDir: string, trustOnFirstUse: boolean): string {
  return trustOnFirstUse ? path.join(pkiDir, "tofu") : pkiDir;
}

function sha1Hex(cert: unknown): string {
  try {
    const first = Array.isArray(cert) ? cert[0] : cert;
    return createHash("sha1").update(first as Buffer).digest("hex");
  } catch {
    return "unknown";
  }
}

// ── Certificate manager dùng chung theo GỐC PKI ────────────────────────────────
// Một manager ⇔ một bộ watcher trên thư mục; tạo lại mỗi lần nối sẽ rò watcher. Giữ sẵn
// MỘT tham chiếu (referenceCounter++) để `client.disconnect()` (gọi cm.dispose()) chỉ giảm
// bộ đếm, không bao giờ huỷ manager đang dùng chung. Khởi tạo nối tiếp theo gốc (single-flight).
const managers = new Map<string, Promise<any>>();
const dirChains = new Map<string, Promise<unknown>>();

export function getOpcuaClientCertificateManager(pkg: any, pkiDir: string, trustOnFirstUse: boolean): Promise<any> {
  const root = opcuaPkiRoot(pkiDir, trustOnFirstUse);
  const key = root;
  const existing = managers.get(key);
  if (existing) return existing;
  const Ctor = pkg?.OPCUACertificateManager;
  if (typeof Ctor !== "function") {
    return Promise.reject(new Error("opcua: this node-opcua build has no OPCUACertificateManager (security unsupported)"));
  }
  const prev = dirChains.get(root) ?? Promise.resolve();
  const p = prev
    .catch(() => undefined)
    .then(async () => {
      // Fix round 1 #3 — thư mục PKI chỉ chủ sở hữu đọc được (mode chỉ áp khi TẠO mới).
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const cm = new Ctor({
        rootFolder: root,
        automaticallyAcceptUnknownCertificate: trustOnFirstUse,
      });
      await cm.initialize();
      // Khoá riêng 0600 trên POSIX. Windows: chmod chỉ bật/tắt read-only, không biểu diễn
      // quyền theo người dùng (ACL kế thừa từ thư mục cha) ⇒ bỏ qua có chủ đích.
      if (process.platform !== "win32" && typeof cm.privateKey === "string") {
        try {
          fs.chmodSync(cm.privateKey, 0o600);
        } catch {
          // khoá chưa tồn tại (manager giả) — bỏ qua
        }
      }
      if (trustOnFirstUse && typeof cm.trustCertificate === "function") {
        // R20 — mỗi lần TOFU tự tin một chứng chỉ ⇒ một WARN (chỉ thumbprint, không in chứng chỉ).
        const orig = cm.trustCertificate.bind(cm);
        cm.trustCertificate = async (certificate: unknown) => {
          await orig(certificate);
          console.warn(
            `[OPCUA] trustOnFirstUse ACCEPTED an unknown server certificate thumbprint=${sha1Hex(certificate)} ` +
              `into ${path.join(root, "trusted", "certs")}`,
          );
        };
      }
      cm.referenceCounter = (cm.referenceCounter ?? 0) + 1;
      return cm;
    });
  dirChains.set(root, p);
  managers.set(key, p);
  // Khởi tạo hỏng ⇒ không giữ promise hỏng (lần nối sau thử lại).
  p.catch(() => {
    if (managers.get(key) === p) managers.delete(key);
  });
  return p;
}

/** Chỉ cho test: huỷ mọi manager đã tạo (dừng watcher) để tiến trình test thoát sạch. */
export async function __disposeOpcuaCertificateManagersForTest(): Promise<void> {
  const all = [...managers.values()];
  managers.clear();
  dirChains.clear();
  for (const p of all) {
    try {
      const cm = await p;
      cm.referenceCounter = 0;
      await cm.dispose();
    } catch {
      // ignore
    }
  }
}

/**
 * Lỗi chứng chỉ server chưa tin ⇒ câu có lý do + chỉ đường cho người vận hành.
 * Fix round 1 #8 — client None mà server không mở endpoint None ⇒ nói đúng điều đó.
 */
export function explainOpcuaConnectError(err: unknown, pkiDir: string | null, securityMode?: OpcuaSecurityModeName): Error {
  const msg = (err as Error)?.message || String(err);
  if (securityMode === "None" && /End ?point must exist|cannot find endpoint/i.test(msg)) {
    return new Error(
      "opcua: server offers no endpoint for SecurityMode None/SecurityPolicy None — set connectionOptions.securityMode " +
        `(e.g. SignAndEncrypt) and securityPolicy to one the server exposes (underlying: ${msg.trim()})`,
    );
  }
  if (pkiDir && /BadCertificateUntrusted|certificate verification failed/i.test(msg)) {
    const e = new Error(
      `opcua: server certificate is not trusted (BadCertificateUntrusted) — verify its thumbprint, then move it from ` +
        `${path.join(pkiDir, "rejected")} to ${path.join(pkiDir, "trusted", "certs")} and reconnect ` +
        `(underlying: ${msg})`,
    );
    return e;
  }
  return err instanceof Error ? err : new Error(msg);
}
