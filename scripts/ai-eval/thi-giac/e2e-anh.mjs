// e2e ĐỌC ẢNH qua máy chủ (Đợt 9, 2026-10-24): /v1/chat/completions (token cá nhân) + /api/ai/local-kb/stream (cookie), mỗi đường
// 3 ảnh (#04, #08, #12 của bo-anh.json). Chấm NỘI DUNG bằng đúng nhóm từ khoá của bo-anh.json (KB: `done.answer`). Chỉ HTTP.
// Cần tmp/vscode-e2e/token.env (tao-token.mjs) + cookie đăng nhập. Thu hồi token ở cuối (--thu-hoi <id>).
//   node scripts/ai-eval/thi-giac/e2e-anh.mjs --cookie tmp/audit-ai/ck.txt [--thu-hoi <id>] [--chi 04,08,12]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ck } from "../codegen-chay-duoc/cookie.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GOC = path.join(ROOT, "scripts/ai-eval/thi-giac");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, "tmp/vscode-e2e/token.env"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const BASE = env.AI_EVAL_BASE, TOKEN = env.AI_EVAL_TOKEN;
const cookie = ck(path.resolve(ROOT, arg("--cookie", "tmp/audit-ai/ck.txt")));
const bo = JSON.parse(fs.readFileSync(path.join(GOC, "bo-anh.json"), "utf8"));
const CHI = arg("--chi", "04,08,12").split(",");
// Ngữ cảnh KB (mặc định = đường WEB như lần đo cổng); thêm `--ngu-canh '{"route":"vscode","codingMode":true}'` để đo đúng hình dạng extension.
const NGU_CANH = { uiLanguage: "vi", ...JSON.parse(arg("--ngu-canh", "{}")) };
const CHI_KB = process.argv.includes("--chi-kb");
const boDau = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const cham = (cau, tl) => cau.nhom.map((alt) => alt.some((re) => new RegExp(re, "i").test(boDau(tl))));
const ketQua = { v1: 0, kb: 0, kbModelChinh: 0 };

for (const cau of bo.anh.filter((c) => CHI.includes(c.id))) {
  const anh = `data:image/png;base64,${fs.readFileSync(path.join(GOC, cau.tep)).toString("base64")}`;
  if (!CHI_KB) { // /v1
    const t0 = Date.now();
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ model: "chat", max_tokens: 8000, messages: [{ role: "user", content: [{ type: "text", text: cau.hoi }, { type: "image_url", image_url: { url: anh } }] }] }),
    });
    const j = await r.json().catch(() => ({}));
    const nd = j.choices?.[0]?.message?.content ?? "";
    const n = cham(cau, nd), ok = r.status === 200 && n.every(Boolean);
    if (ok) ketQua.v1++;
    console.log(`/v1 #${cau.id}: HTTP ${r.status} ${ok ? "ĐÚNG" : "sai "} [${n.map(Number).join("")}] · ${Date.now() - t0} ms · ${JSON.stringify(j.error ?? nd.slice(0, 160))}`);
  }
  { // KB stream
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/ai/local-kb/stream`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ question: cau.hoi, image: anh, history: [], context: NGU_CANH }),
    });
    const than = await r.text();
    const ev = than.split("\n\n").map((k) => k.replace(/^data:\s*/m, "").trim()).filter((d) => d.startsWith("{")).map((d) => { try { return JSON.parse(d); } catch { return null; } }).filter(Boolean);
    const v = ev.find((e) => e.type === "vision");
    const done = ev.find((e) => e.type === "done");
    const traLoi = done?.answer ?? ev.filter((e) => e.type === "token").map((e) => e.token ?? "").join("");
    const n = cham(cau, traLoi), ok = r.status === 200 && n.every(Boolean);
    if (ok) ketQua.kb++;
    if (v?.ok === true && v?.nguon === "model-chinh") ketQua.kbModelChinh++;
    console.log(`KB #${cau.id}: HTTP ${r.status} ${ok ? "ĐÚNG" : "sai "} [${n.map(Number).join("")}] · ${Date.now() - t0} ms · vision ok=${v?.ok} nguon=${v?.nguon} reason=${v?.reason ?? "-"} · provider ${done?.provider ?? "?"} · ${JSON.stringify(traLoi.slice(0, 160))}`);
  }
}
const id = arg("--thu-hoi", null);
if (id) {
  const r = await fetch(`${BASE}/api/trpc/aiGatewayToken.thuHoi`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ json: { id: Number(id) } }) });
  console.log(`thu hồi token id=${id}: HTTP ${r.status}`);
}
const dat = (CHI_KB || ketQua.v1 >= 2) && ketQua.kb >= 2 && ketQua.kbModelChinh === CHI.length;
console.log(`E2E: /v1 ${ketQua.v1}/${CHI.length} · KB ${ketQua.kb}/${CHI.length} · KB nguon=model-chinh ${ketQua.kbModelChinh}/${CHI.length} ⇒ ${dat ? "ĐẠT" : "KHÔNG ĐẠT"}`);
process.exit(dat ? 0 : 1);
