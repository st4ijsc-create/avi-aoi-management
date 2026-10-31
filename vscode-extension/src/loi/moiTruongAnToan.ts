/**
 * ★★★ Đợt 12 / H2 — MÔI TRƯỜNG CHO TIẾN TRÌNH CON do extension sinh (lệnh model viết/duyệt trong `chayLenhCucBo`, MCP server trong
 * `mcpClient`). THUẦN — không `vscode`, không chạm tiến trình.
 *
 * VÌ SAO: trước đây hai nơi truyền NGUYÊN `process.env` của extension host. Môi trường của một lập trình viên thường chứa token/khoá
 * đám mây (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `NPM_TOKEN`, `DATABASE_URL`…); tiến trình con chạy MÃ DO MODEL VIẾT (test, build
 * script) hoặc một MCP server bên thứ ba ⇒ mã đó đọc được và gửi đi đâu tuỳ ý. Đây là lỗ an toàn thật, không phải vệ sinh.
 *
 * KHÁC máy chủ (`repoCommandSandbox.moiTruongDaLoc`, danh sách TRẮNG chặt): ở máy lập trình viên chuỗi công cụ cần RẤT NHIỀU biến vô hại
 * (JAVA_HOME, GOPATH, CARGO_HOME, DOTNET_ROOT, NVM_*, PYTHON*, …) mà ta không thể liệt kê hết ⇒ ở đây là danh sách CẤM theo TÊN bí mật,
 * cộng một lớp phụ theo GIÁ TRỊ (token có tiền tố nhà cung cấp; URL có `user:mật-khẩu@`), cộng NGOẠI LỆ cho vài tên trông giống bí mật
 * nhưng là cấu hình công cụ (proxy, đường chứng chỉ CA, GOPRIVATE…). Nghiêng về LOẠI thừa: một biến vô hại bị loại làm lệnh thất bại
 * ồn ào (người dùng thấy, thêm vào `env` của MCP server nếu cần); một bí mật lọt ra là im lặng.
 *
 * Quy ước: so tên KHÔNG phân biệt hoa/thường (Windows không phân biệt). Bên gọi đặt biến RIÊNG của nó SAU khi lọc (`{...loc(env), ...rieng}`):
 * biến mà người dùng chủ động khai cho một MCP server là quyết định của họ, không bị lọc lại.
 */
import { RE_TOKEN_CO_TIEN_TO } from "../../../shared/mauBiMat";

/** Mảnh tên biến nghe như bí mật. So bằng `includes` trên tên IN HOA. */
const MANH_TEN_BI_MAT: readonly string[] = [
  "KEY", // API_KEY, ACCESS_KEY, PRIVATE_KEY, SSH_KEY… (cả `APIKEY`)
  "PASSWORD",
  "PASSWD",
  "SECRET",
  "TOKEN",
  "CREDENTIAL",
  "AUTH", // SSH_AUTH_SOCK, NPM_CONFIG__AUTH, AUTH_HEADER…
  "PRIVATE",
  "COOKIE",
  "SESSION_ID",
  "CONNECTION_STRING",
  "CONNECTIONSTRING",
  "CONN_STR",
  "CONNSTR",
  "DSN",
  "BEARER",
  "SIGNATURE",
  "PASSPHRASE",
  "_PWD", // MYSQL_PWD (KHÔNG khớp `PWD` trần — đó là thư mục hiện tại)
  "_PASS", // SMTP_PASS, DB_PASS (cả `_PASSWORD`)
  "WEBHOOK", // URL webhook Slack/Discord là bí mật
  "SALT",
];

/** Tiền tố tên của dịch vụ đám mây / nhà cung cấp AI: cả nhóm biến bị loại (kể cả biến vô hại như `AWS_REGION` — chấp nhận loại thừa). */
const TIEN_TO_DICH_VU: readonly string[] = [
  "AWS_",
  "AZURE_",
  "ARM_",
  "GCP_",
  "GCLOUD_",
  "GOOGLE_",
  "GITHUB_",
  "GITLAB_",
  "GH_",
  "GL_",
  "OPENAI_",
  "ANTHROPIC_",
  "HF_",
  "HUGGINGFACE",
  "DOCKER_",
  "KUBE",
  "VERCEL_",
  "NETLIFY_",
  "HEROKU_",
  "DIGITALOCEAN_",
  "SENTRY_",
  "NPM_CONFIG__", // `_authToken`, `_auth` của npm (hai gạch dưới: sau tiền tố `npm_config_` là khoá bắt đầu bằng `_`)
];

/**
 * NGOẠI LỆ (thắng cả mảnh-tên lẫn tiền-tố lẫn kiểm giá trị): cấu hình công cụ, không phải bí mật.
 * Proxy: giá trị CÓ THỂ mang `user:pass@proxy` (⚠ bí mật proxy VẪN tới tiến trình con — đã ghi nhận, đánh đổi chấp nhận) — chủ định giữ (công cụ cần để ra mạng nội bộ); đó là cấu hình của chính người dùng cho CHÍNH
 * công cụ, và đã nằm trong môi trường mà họ chạy lệnh bằng tay.
 */
const NGOAI_LE: ReadonlySet<string> = new Set([
  "JAVA_HOME",
  "GOPATH",
  "GOROOT",
  "GOPRIVATE",
  "GONOPROXY",
  "GONOSUMDB",
  "GOFLAGS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "FTP_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
]);

// user có thể RỖNG (`redis://:matkhau@host`); phần mật khẩu không chứa `/` để đường dẫn kiểu `http://reg:4873/@scope/pkg` không bị coi là mật khẩu.
const RE_URL_CO_MAT_KHAU = /\/\/[^/\s:@]*:[^@\s/]+@/;
/** Khối khoá riêng PEM và JWT ba đoạn đặt trong một biến tên vô hại. */
const RE_GIA_TRI_KHOA = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/;

export type LyDoLoaiBien = "ten" | "tien-to" | "gia-tri-token" | "gia-tri-url" | "gia-tri-khoa";

/** Lý do loại một biến, hoặc `null` nếu giữ. Thuần; KHÔNG trả giá trị (chỉ dùng cho đo/nhật ký). */
export function lyDoLoaiBien(ten: string, giaTri: string): LyDoLoaiBien | null {
  const T = ten.toUpperCase();
  if (NGOAI_LE.has(T)) return null;
  // `HTTP_PROXY` viết thường (`http_proxy`) đã gom nhờ `toUpperCase`.
  if (TIEN_TO_DICH_VU.some((p) => T.startsWith(p))) return "tien-to";
  // `AUTHOR` (GIT_AUTHOR_NAME/EMAIL — `git commit` của lệnh test cần chúng) không phải `AUTH`: bỏ đoạn AUTHOR trước khi so mảnh.
  const tenSoManh = T.replace(/AUTHOR/g, "");
  if (MANH_TEN_BI_MAT.some((m) => tenSoManh.includes(m))) return "ten";
  if (new RegExp(RE_TOKEN_CO_TIEN_TO.source).test(giaTri)) return "gia-tri-token";
  if (RE_URL_CO_MAT_KHAU.test(giaTri)) return "gia-tri-url";
  if (RE_GIA_TRI_KHOA.test(giaTri)) return "gia-tri-khoa";
  return null;
}

/**
 * Môi trường đã lọc bí mật cho tiến trình con. `undefined` giữ nguyên bị bỏ (kiểu `ProcessEnv`). Không đổi `nguon`.
 * Bên gọi nối biến RIÊNG của nó SAU kết quả này.
 */
export function moiTruongDaLocChoTienTrinhCon(nguon: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ra: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(nguon)) {
    if (v === undefined) continue;
    if (lyDoLoaiBien(k, v) === null) ra[k] = v;
  }
  return ra;
}
