#!/usr/bin/env node
/**
 * Lô D1-script — K1: máy chủ GIẢ đòi `Authorization: Bearer <khoá giả>` trên MỌI đường. Không GPU, không :8091, không DB.
 *
 *   node scripts/ai-eval/d1/k1-may-gia.mjs --ra <tệp.jsonl>
 *
 * Ba lượt trên CÙNG danh sách mục:
 *   (dung)      LLAMA_SERVER_API_KEY_FILE = tệp khoá giả ĐÚNG   ⇒ mỗi mục ≥ 1 yêu cầu, 0 lần 401.
 *   (khong-tep) biến = "" TƯỜNG MINH (dotenv không ghi đè biến đã có ⇒ .env không chen vào) ⇒ mỗi mục ≥ 1 lần 401 (đối chứng âm).
 *   (sai-khoa)  tệp khoá giả KHÁC                               ⇒ mỗi mục ≥ 1 lần 401 (đối chứng âm).
 * ĐẠT khi cả ba đúng kỳ vọng ở MỌI mục đã phủ. Mục 0 yêu cầu ⇒ KHÔNG xanh (không trỏ vào máy giả).
 *
 * Cách ly tiến trình con: bỏ mọi LLAMA_* / GGUF_* / AI_* của cha; LLAMA_SERVER_URL = máy giả; TEMP = TMP = thư mục tạm D (khoá khe
 * khoaKhe.mjs rơi vào D); GGUF_MODELS_DIR = D + GGUF_FAST_MODEL = tên không có (nhánh nạp model trong tiến trình, nếu lỡ chạy, hỏng
 * ngay chứ không nạp model thật); DATABASE_URL chết; 6 cờ luật A = false. cwd = gốc repo (script đọc tệp tương đối; tmp/ bị gitignore).
 * Khoá giả sinh ngẫu nhiên, nằm trong D, KHÔNG in. Đầu ra chỉ ghi đường + có/không khoá đúng + mã trả.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RA = arg("ra", "");
if (!RA) { console.error("thiếu --ra <tệp.jsonl>"); process.exit(2); }

const D = fs.mkdtempSync(path.join(os.tmpdir(), "k1-may-gia-"));
const KHOA = `khoa-gia-${crypto.randomBytes(16).toString("hex")}`;
const TEP_DUNG = path.join(D, "dung.key");
const TEP_SAI = path.join(D, "sai.key");
fs.writeFileSync(TEP_DUNG, `${KHOA}\n`);
fs.writeFileSync(TEP_SAI, `khoa-gia-${crypto.randomBytes(16).toString("hex")}\n`);

// ── Máy chủ giả: đòi Bearer trên MỌI đường, trả hình tối thiểu của llama-server ──────────────────────────────────────────────
let soDo = [];
const tra = (res, ma, than, kieu = "application/json") => { res.writeHead(ma, { "content-type": kieu }); res.end(typeof than === "string" ? than : JSON.stringify(than)); };
const may = http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => { b += d; if (b.length > 5e6) req.destroy(); });
  req.on("end", () => {
    const dung = req.headers.authorization === `Bearer ${KHOA}`;
    const duong = (req.url ?? "").split("?")[0];
    soDo.push({ duong, dung, co: Boolean(req.headers.authorization) });
    if (!dung) return tra(res, 401, { error: { code: 401, message: "Invalid API Key", type: "authentication_error" } });
    if (duong === "/health") return tra(res, 200, { status: "ok" });
    if (duong === "/v1/models") return tra(res, 200, { object: "list", data: [{ id: "gia-k1.gguf" }] });
    if (duong === "/props") return tra(res, 200, { modalities: { vision: false }, default_generation_settings: { n_ctx: 4096 }, model_path: "gia-k1.gguf" });
    if (duong === "/metrics") return tra(res, 200, "llamacpp:prompt_tokens_total 1\n", "text/plain");
    if (duong === "/v1/chat/completions") return tra(res, 200, { choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 }, timings: { prompt_n: 1, prompt_ms: 1 } });
    if (duong === "/v1/completions") return tra(res, 200, { choices: [{ text: "", finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    return tra(res, 404, { error: "khong co" });
  });
});
await new Promise((ok) => may.listen(0, "127.0.0.1", ok));
const URL_GIA = `http://127.0.0.1:${may.address().port}`;

const CO_A = ["ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED", "FOE_ENABLED", "FOE_DURABLE", "OT_GATEWAY_ENABLED", "ROBOT_GATEWAY_ENABLED"];
function envCon(tepKhoa) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(LLAMA_|GGUF_|AI_)/i.test(k)) e[k] = v;
  for (const k of CO_A) e[k] = "false";
  Object.assign(e, { TEMP: D, TMP: D, LLAMA_SERVER_URL: URL_GIA, GGUF_MODELS_DIR: D, GGUF_FAST_MODEL: "khong-co-k1.gguf", DATABASE_URL: "postgres://khong:khong@127.0.0.1:9/x" });
  e.LLAMA_SERVER_API_KEY_FILE = tepKhoa || ""; // kiem-dinh 18:20 / HST 18:2x: rỗng tường minh, không bỏ biến
  return e;
}

// ── Mục: tệp ⇒ lệnh NHỎ NHẤT. Mục `chuaPhu` = chưa có lệnh nhỏ nhất an toàn (ghi lý do; K1 báo "phủ thiếu", không tính xanh) ─────────
const S = (f) => path.join(GOC, "scripts/ai-eval", f);
const node = (f, ...a) => [process.execPath, [S(f), ...a]];
const tsx = (f, ...a) => [process.execPath, ["--import", "tsx", S(f), ...a]];
const MUC = [
  { tep: "bo-nho/tai-dai.mjs", lenh: node("bo-nho/tai-dai.mjs", "1") },
  { tep: "bo-nho/tai-hoi-thoai.mjs", lenh: node("bo-nho/tai-hoi-thoai.mjs", "--vong", "1", "--dai", "1", "--luot", "1", "--cuoc", "1") },
  { tep: "thi-giac/tai-chung-tien-to.mjs", lenh: node("thi-giac/tai-chung-tien-to.mjs", "1") },
  { tep: "thi-giac/do-doc-anh.mjs", lenh: () => node("thi-giac/do-doc-anh.mjs", "--nhan", "k1", "--che-do", "truc-tiep", "--url", URL_GIA, "--lan", "1", "--chi", "01", "--max-ra", "16") },
  { tep: "flow-tin-cay/do-tin-cay-35b.mjs", lenh: () => node("flow-tin-cay/do-tin-cay-35b.mjs", "server/services/flow/eval/phieuBaoTri.vang.json", path.join(D, "tin-cay.json")) },
  { tep: "trich-xuat/do.mts", lenh: () => tsx("trich-xuat/do.mts", "--dich", "nha", "--url", `${URL_GIA}/v1/chat/completions`, "--nhan", "k1") },
  { tep: "trich-xuat/do-chen.mts", lenh: () => tsx("trich-xuat/do-chen.mts", "--pha", "c3", "--k", "1", "--lap", "1", "--url", `${URL_GIA}/v1/chat/completions`) },
  { tep: "lib/goi-llama.mjs /props", lenh: node("lib/goi-llama.mjs", "/props") },
  { tep: "lib/goi-llama.mjs /metrics", lenh: node("lib/goi-llama.mjs", "/metrics") },
  { tep: "lib/goi-llama.mjs /v1/models", lenh: node("lib/goi-llama.mjs", "/v1/models") },
  { tep: "ngau-nhien/lib/goiModel.mjs", lenh: () => [process.execPath, ["--input-type=module", "-e",
    `const { taoGoiModel } = await import(${JSON.stringify(new URL("../ngau-nhien/lib/goiModel.mjs", import.meta.url).href)});
     const g = taoGoiModel({ rawUrl: process.env.LLAMA_SERVER_URL + "/v1/chat/completions", maxTokens: 8 });
     await g.chatRaw("", "k1"); await g.hoanThanhRaw("k1", []); await g.kiemSong("k1", { thoat: false }); await g.modelDangChay();`]] },
  { tep: "codegen-chay-duoc/run.mjs", chuaPhu: "cần bộ bài + toolchain biên dịch; lệnh nhỏ nhất chưa đọc đủ" },
  { tep: "eval-toolcall.mjs", chuaPhu: "import registry tool của server (aiLocalTools) — chưa xác định nhập có chạm DB" },
  { tep: "mo-ta-luong/chay.mts", chuaPhu: "import server/services/flow — chưa xác định nhập có chạm DB" },
  { tep: "ngau-nhien/mot-luot.mjs", chuaPhu: "đi qua goiModel.mjs (phủ ở mục goiModel)" },
];

/** spawn BẤT ĐỒNG BỘ (spawnSync sẽ chặn vòng sự kiện ⇒ máy giả không trả lời được). Quá 90 s ⇒ giết con, ghi tinHieu. */
function chay(bin, thamSo, o) {
  return new Promise((ok) => {
    const c = spawn(bin, thamSo, { ...o, windowsHide: true });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => { stdout = (stdout + d).slice(-4000); });
    c.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
    const h = setTimeout(() => c.kill(), 90_000);
    c.on("close", (status, signal) => { clearTimeout(h); ok({ status, signal, stdout, stderr }); });
    c.on("error", (e) => { clearTimeout(h); ok({ status: null, signal: null, stdout, stderr: String(e?.message ?? e) }); });
  });
}

const ra = fs.openSync(RA, "a");
const ghi = (o) => fs.writeSync(ra, JSON.stringify(o) + "\n");
ghi({ luc: new Date().toISOString(), D, may: URL_GIA });
const LUOT = [
  { ten: "dung", tep: TEP_DUNG, kyVong: (n, n401) => n >= 1 && n401 === 0 },
  { ten: "khong-tep", tep: "", kyVong: (n, n401) => n401 >= 1 },
  { ten: "sai-khoa", tep: TEP_SAI, kyVong: (n, n401) => n401 >= 1 },
];
let dat = 0, truot = 0;
const chuaPhu = MUC.filter((m) => m.chuaPhu);
for (const l of LUOT) {
  for (const m of MUC.filter((x) => !x.chuaPhu)) {
    soDo = [];
    const [bin, thamSo] = typeof m.lenh === "function" ? m.lenh() : m.lenh;
    const r = await chay(bin, thamSo, { cwd: GOC, env: envCon(l.tep) });
    const n = soDo.length, n401 = soDo.filter((x) => !x.dung).length;
    const ok = l.kyVong(n, n401);
    ok ? dat++ : truot++;
    ghi({ luot: l.ten, muc: m.tep, ma: r.status, tinHieu: r.signal, soYeuCau: n, so401: n401, duong: [...new Set(soDo.map((x) => x.duong))], dat: ok,
      // đầu ra con: KHÔNG chứa khoá (máy giả không bao giờ gửi khoá ra); cắt ngắn.
      duoi: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replaceAll(KHOA, "khoa-gia-<…>").slice(-600) });
    console.log(`${ok ? "DAT  " : "TRUOT"} [${l.ten}] ${m.tep} · ${n} yêu cầu, ${n401} lần 401 · ma ${r.status}`);
  }
}
ghi({ ket: { dat, truot, chuaPhu: chuaPhu.map((m) => ({ tep: m.tep, lyDo: m.chuaPhu })) } });
fs.closeSync(ra);
may.close();
fs.rmSync(D, { recursive: true, force: true });
console.log(`K1: dat ${dat} · truot ${truot} · CHƯA PHỦ ${chuaPhu.length}: ${chuaPhu.map((m) => m.tep).join(", ")}`);
process.exitCode = truot ? 1 : 0;
