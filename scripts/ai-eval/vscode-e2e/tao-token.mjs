/**
 * Tạo token cá nhân `avgw_…` (phạm vi `chat` + `apply`) cho TÀI KHOẢN ĐO, qua đúng thủ tục web của máy chủ
 * (`aiGatewayToken.tao` — `server/routers/aiGatewayTokenRouter.ts`: cần PHIÊN WEB, có audit, trả bản rõ ĐÚNG MỘT LẦN).
 * Không chạm DB trực tiếp. Bản rõ ghi vào `tmp/vscode-e2e/token.env` (tmp/ đã .gitignore), KHÔNG in ra màn hình.
 *
 *   # đăng nhập bằng mật khẩu (tài khoản phải có quyền AI + giấy phép MOD_AI):
 *   AI_EVAL_BASE=http://127.0.0.1:3010 AI_EVAL_USER=<user> AI_EVAL_PASS=<pass> node scripts/ai-eval/vscode-e2e/tao-token.mjs
 *   # hoặc dùng tệp cookie Netscape sẵn có (như các bộ đo khác):
 *   AI_EVAL_BASE=http://127.0.0.1:3010 node scripts/ai-eval/vscode-e2e/tao-token.mjs --cookie tmp/audit-ai/ck.txt
 *   # rồi:  set -a; . tmp/vscode-e2e/token.env; set +a      (bash)  — nạp AI_EVAL_BASE + AI_EVAL_TOKEN
 *
 * Thu hồi sau khi đo: trang web "Token cá nhân" hoặc tRPC `aiGatewayToken.thuHoi({id})` (id in ra bên dưới).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = (process.env.AI_EVAL_BASE || "").replace(/\/+$/, "");
if (!BASE) { console.error("⛔ cần AI_EVAL_BASE (vd http://127.0.0.1:3010)"); process.exit(2); }
const SO_NGAY = Number(arg("--so-ngay", 7));
const TEN = arg("--ten", `do-vscode-e2e-${new Date().toISOString().slice(0, 10)}`);

async function layCookie() {
  const tep = arg("--cookie", null);
  if (tep) {
    const { ck } = await import("../codegen-chay-duoc/cookie.mjs");
    return ck(path.resolve(ROOT, tep));
  }
  const user = process.env.AI_EVAL_USER, pass = process.env.AI_EVAL_PASS;
  if (!user || !pass) { console.error("⛔ cần --cookie <tệp> hoặc AI_EVAL_USER + AI_EVAL_PASS"); process.exit(2); }
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (r.status !== 200) { console.error(`⛔ đăng nhập hỏng: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(2); }
  const ds = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") ?? ""];
  const ck = ds.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!/app_session_id=/.test(ck)) { console.error("⛔ đăng nhập không trả cookie phiên app_session_id (2FA? đổi mật khẩu bắt buộc?)"); process.exit(2); }
  return ck;
}

const cookie = await layCookie();
const r = await fetch(`${BASE}/api/trpc/aiGatewayToken.tao`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ json: { ten: TEN, phamVi: ["chat", "apply"], soNgay: SO_NGAY } }),
});
const than = await r.json().catch(() => null);
const du = than?.result?.data?.json ?? than?.result?.data ?? null;
if (r.status !== 200 || !du?.ok || !/^avgw_/.test(du.token ?? "")) {
  console.error(`⛔ tạo token hỏng: HTTP ${r.status} ${JSON.stringify(than?.error?.json?.message ?? du?.note ?? than).slice(0, 300)}`);
  process.exit(2);
}
const ra = path.join(ROOT, "tmp", "vscode-e2e", "token.env");
fs.mkdirSync(path.dirname(ra), { recursive: true });
fs.writeFileSync(ra, `AI_EVAL_BASE=${BASE}\nAI_EVAL_TOKEN=${du.token}\n`, { mode: 0o600 });
console.log(`✓ token id=${du.id} ${du.tienTo}… phạm vi ${JSON.stringify(du.phamVi)} hết hạn ${du.hetHanLuc} ⇒ ${ra}`);
