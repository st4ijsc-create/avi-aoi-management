// e2e ĐỌC ẢNH qua máy chủ (Đợt 9, 2026-10-24): /v1/chat/completions (token cá nhân) + /api/ai/local-kb/stream (cookie) với ảnh #08.
// Chỉ HTTP. Cần tmp/vscode-e2e/token.env (tao-token.mjs) + cookie đăng nhập. Thu hồi token ở cuối (--thu-hoi <id>).
//   node scripts/ai-eval/thi-giac/e2e-anh.mjs --cookie tmp/audit-ai/ck.txt [--thu-hoi <id>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ck } from "../codegen-chay-duoc/cookie.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, "tmp/vscode-e2e/token.env"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const BASE = env.AI_EVAL_BASE, TOKEN = env.AI_EVAL_TOKEN;
const cookie = ck(path.resolve(ROOT, arg("--cookie", "tmp/audit-ai/ck.txt")));
const anh = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, "scripts/ai-eval/thi-giac/anh/08-tai-lieu-chu.png")).toString("base64")}`;
const HOI = "Tài liệu bảo trì trong ảnh nêu mã lỗi nào và nghĩa là gì?";
let hong = 0;

{ // /v1
  const t0 = Date.now();
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ model: "chat", max_tokens: 4000, messages: [{ role: "user", content: [{ type: "text", text: HOI }, { type: "image_url", image_url: { url: anh } }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  const nd = j.choices?.[0]?.message?.content ?? "";
  const ok = r.status === 200 && /E082/i.test(nd);
  if (!ok) hong++;
  console.log(`/v1: HTTP ${r.status} ${ok ? "ĐẠT" : "KHÔNG ĐẠT"} · ${Date.now() - t0} ms · ${JSON.stringify(j.error ?? nd.slice(0, 200))}`);
}
{ // KB stream
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/ai/local-kb/stream`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ question: HOI, image: anh, history: [], context: { uiLanguage: "vi" } }),
  });
  const than = await r.text();
  const ev = than.split("\n\n").map((k) => k.replace(/^data:\s*/m, "").trim()).filter((d) => d.startsWith("{")).map((d) => { try { return JSON.parse(d); } catch { return null; } }).filter(Boolean);
  const v = ev.find((e) => e.type === "vision");
  // Câu trả lời đầy đủ nằm ở sự kiện `done.answer` (token chỉ có khi LLM stream; đường trích/tool trả thẳng ở done).
  const done = ev.find((e) => e.type === "done");
  const traLoi = ev.filter((e) => e.type === "token").map((e) => e.token ?? "").join("") || (done?.answer ?? "");
  console.log(`KB stream: kiểu sự kiện ${JSON.stringify([...new Set(ev.map((e) => e.type))])} · provider ${done?.provider ?? "?"} · E082 trong trả lời: ${/E082/i.test(traLoi)}`);
  const ok = r.status === 200 && v?.ok === true && v?.nguon === "model-chinh";
  if (!ok) hong++;
  console.log(`KB stream: HTTP ${r.status} ${ok ? "ĐẠT" : "KHÔNG ĐẠT"} · ${Date.now() - t0} ms · vision=${JSON.stringify(v && { ok: v.ok, nguon: v.nguon, reason: v.reason, chiTiet: v.chiTiet, visionText: (v.visionText ?? "").slice(0, 120) })} · trả lời: ${JSON.stringify(traLoi.slice(0, 200))}`);
}
const id = arg("--thu-hoi", null);
if (id) {
  const r = await fetch(`${BASE}/api/trpc/aiGatewayToken.thuHoi`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ json: { id: Number(id) } }) });
  console.log(`thu hồi token id=${id}: HTTP ${r.status}`);
}
process.exit(hong ? 1 : 0);
