/**
 * ★★★ MẪU TOKEN CÓ TIỀN TỐ — MỘT NGUỒN cho mọi bộ che bí mật trên đường RỜI MÁY. THUẦN, KHÔNG import gì, không
 * env/đĩa/mạng, không ném.
 *
 * Người dùng (đừng nhân bản danh sách này ở nơi khác — thêm dạng mới Ở ĐÂY, hai phía tự có):
 *   · máy chủ `server/services/ai/aiSafety.ts` — `REDACT_PATTERNS` (⇒ `redactSecretsOnly`/`redactSecretsAndPII`/
 *     `checkOutput`) + `PENDING_SECRET_START_PATTERNS` (⇒ `StreamingSecretRedactor`);
 *   · extension `vscode-extension/src/loi/nguCanh.ts#cheBiMat` (⇒ ngữ cảnh, tool đọc, ghost text, kết quả lệnh).
 * Tách thành tệp riêng (như `shared/quetMenhLenh.ts`) vì census extension cấm gộp `aiSafety.ts` vào bundle.
 *
 * VÌ SAO (đo, 2026-10-17, bộ đầu-cuối `scripts/ai-eval/vscode-e2e --config ro`): một `ghp_…` hardcode trong tệp mã
 * thường RÒ 21/21 lượt qua extension — `cheBiMat` không có luật GitHub, còn máy chủ chỉ biết `sk-`/`ghp_`/`AKIA`.
 *
 * NGUYÊN TẮC CHỌN MẪU: chỉ dạng có TIỀN TỐ do nhà cung cấp định nghĩa + thân đủ dài (dương tính giả gần 0 trong mã/văn
 * xuôi). Bí mật KHÔNG có hình dạng (mật khẩu, token nội bộ 32 hex) không thuộc tệp này — tầng chặn-theo-TỆP và luật
 * "gán khoá = giá trị" của từng phía lo.
 *   · biên TRÁI `(?<![A-Za-z0-9])`: `xghp_…`, `aAKIA…` (tiền tố nằm GIỮA một định danh) không bị coi là khoá; gạch dưới
 *     được phép đứng trước (`MY_ghp_…` vẫn che — nghiêng về che thừa).
 *   · không biên PHẢI: thân lượng từ `{n,}` tham lam đã nuốt hết phần còn lại; dạng độ dài CỐ ĐỊNH (`AKIA`, `AIza`) có
 *     đuôi thừa thì phần thừa còn lại — vẫn không rò lõi.
 */

export interface MauToken {
  /** Nhãn ổn định (đếm/nhật ký) — KHÔNG chứa giá trị. */
  ten: string;
  /** Nguồn regex của CẢ token (tiền tố + thân), không cờ, không biên. */
  nguon: string;
}

export const MAU_TOKEN_CO_TIEN_TO: readonly MauToken[] = [
  // GitHub: PAT cổ điển / OAuth / user-to-server / server-to-server / refresh — thân thật 36 ký tự [A-Za-z0-9].
  { ten: "github", nguon: "gh[pousr]_[A-Za-z0-9]{20,}" },
  // GitHub fine-grained PAT: `github_pat_` + 82 ký tự [A-Za-z0-9_].
  { ten: "github_pat", nguon: "github_pat_[A-Za-z0-9_]{22,}" },
  // GitLab PAT: `glpat-` + 20 ký tự.
  { ten: "gitlab", nguon: "glpat-[A-Za-z0-9_-]{20,}" },
  // Slack: `xox[abprs]-` + SỐ + `-` … (đòi số ngay sau tiền tố ⇒ `xoxb-container-large` không phải khoá).
  { ten: "slack", nguon: "xox[abprs]-[0-9]{6,}-[A-Za-z0-9-]{8,}" },
  // AWS access key id: đúng 20 ký tự.
  { ten: "aws", nguon: "AKIA[0-9A-Z]{16}" },
  // Google API key: đúng 39 ký tự.
  { ten: "google", nguon: "AIza[0-9A-Za-z_-]{35}" },
  // Stripe secret / restricted key (live).
  { ten: "stripe", nguon: "[sr]k_live_[0-9A-Za-z]{16,}" },
  // npm access token: `npm_` + 36 (`npm_config_x`/`npm_package_y` dừng ở `_` ⇒ không khớp).
  { ten: "npm", nguon: "npm_[A-Za-z0-9]{30,}" },
  // OpenAI khoá dự án/tài khoản dịch vụ/quản trị — thân có `-`/`_`, luật `sk-[A-Za-z0-9]{16,}` cũ của máy chủ dừng ở `-`.
  { ten: "openai", nguon: "sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}" },
];

const BIEN_TRAI = "(?<![A-Za-z0-9])";

/**
 * Regex GỘP (cờ `g`) mọi mẫu trên. Dùng với `String.replace` (tự đặt lại `lastIndex`); ĐỪNG dùng `.test()`/`.exec()`
 * trên hằng `g` này (có trạng thái) — gọi `cheTokenCoTienTo` hoặc dựng regex riêng từ `MAU_TOKEN_CO_TIEN_TO`.
 */
export const RE_TOKEN_CO_TIEN_TO = new RegExp(`${BIEN_TRAI}(?:${MAU_TOKEN_CO_TIEN_TO.map((m) => m.nguon).join("|")})`, "g");

/**
 * Tiền tố ĐANG MỌC ở đuôi bộ đệm (cho bộ che luồng): tiền tố đã đủ, thân còn đang tới. Bộ che luồng phải GIỮ từ đây
 * tới khi gặp ký tự kết thúc — không thì token dài hơn đuôi giữ thường (32 ký tự, vd `github_pat_` 93 ký tự) bị nhả
 * dần từng mảnh trước khi đủ độ dài để mẫu đầy đủ khớp.
 */
export const RE_TOKEN_CO_TIEN_TO_DANG_GO =
  /(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_|glpat-|xox[abprs]-|AKIA|AIza|[sr]k_live_|npm_|sk-)[A-Za-z0-9_-]*$/;

/** Thay mọi token có tiền tố bằng `thay`. Thuần, không ném. */
export function cheTokenCoTienTo(s: string, thay: string): string {
  if (typeof s !== "string" || s.length === 0) return s;
  return s.replace(RE_TOKEN_CO_TIEN_TO, thay);
}
