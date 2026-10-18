/**
 * Bộ đo "SINH ĐƯỢC MÃ CHẠY ĐƯỢC" — hai trục.
 *   --config pipeline : đi ĐÚNG đường sản phẩm (/api/ai/local-kb/stream, codingMode)
 *   --config raw      : gọi THẲNG llama-server (đo MODEL THUẦN, không chịu nợ đường ống)
 *   --config fake-ok / fake-bad : KHÔNG gọi model — nạp lời giải đúng/sai có sẵn.
 *                                 Đây là phép KIỂM THƯỚC ĐO: fake-ok phải 100% ĐẠT,
 *                                 fake-bad phải 0% ĐẠT. Không thoả ⇒ bộ đo hỏng, vứt số.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ck } from "./cookie.mjs";
// ★ 2026-10-17 (AI Local Đợt 5.2) — trích mã + bốn trình chạy tách sang `cham.mjs` để Training Studio "Eval mã" dùng
//   CÙNG bộ chấm (không chép). Hành vi chấm không đổi; kiểm bằng thước fake-ok 12/12 · fake-bad 0/12.
import { SYS, chamBai } from "./cham.mjs";

// Gốc repo suy từ VỊ TRÍ tệp này (không ghim D:/SOURCES/avi-aoi-management) để chạy được trong worktree khác
// mà không chạm cây làm việc của phiên khác; server đo chọn bằng AI_EVAL_BASE (mặc định :3000 như cũ).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..").split(path.sep).join("/");
const BASE = (process.env.AI_EVAL_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const BENCH = `${ROOT}/scripts/ai-eval/codegen-chay-duoc`;
const WORK = `${ROOT}/tmp/codegen-chay-duoc-work`;  // sản phẩm tạm — KHÔNG vào git
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CK = ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`));
const CONFIG = arg("--config", "pipeline");
const ONLY = arg("--only", null);
const RAW_URL = arg("--raw-url", "http://127.0.0.1:8091/v1/chat/completions");
const LABEL = arg("--label", CONFIG);
// ★ F3 — chế độ nghĩ theo lượt gửi kèm (sau | can-bang | nhanh); vắng ⇒ không gửi ⇒ mặc định sản phẩm.
const CHE_DO_NGHI = arg("--che-do-nghi", null);

const TASKFILE = arg("--tasks", "tasks.json");
// Lời giải kiểm thước đi cặp theo tên: tasks-<x>.json ⇔ fake-<x>.json (tasks-hard, tasks-api …); tasks.json ⇔ fake.json.
const FAKE_CAP = TASKFILE.replace(/^tasks/, "fake");
const FAKEFILE = arg("--fake", FAKE_CAP !== TASKFILE && fs.existsSync(`${BENCH}/${FAKE_CAP}`) ? FAKE_CAP : "fake.json");
const tasks = JSON.parse(fs.readFileSync(`${BENCH}/${TASKFILE}`, "utf8"))
  .filter(t => !ONLY || ONLY.split(",").includes(t.id) || ONLY.split(",").includes(t.lang) || (t.nhom && ONLY.split(",").includes(t.nhom)));

// ─────────────────────────────────────────────────────────── SINH
async function genPipeline(t) {
  const t0 = Date.now(); let tFirst = null;
  const res = await fetch(`${BASE}/api/ai/local-kb/stream`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: CK },
    body: JSON.stringify({ question: t.prompt, topK: 5, history: [], userRole: "admin",
      context: { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo", ...(CHE_DO_NGHI ? { cheDoNghi: CHE_DO_NGHI } : {}) } }),
  });
  if (!res.ok) return { text: "", err: `HTTP ${res.status}`, ttftMs: null, totalMs: Date.now() - t0 };
  let text = "", buf = ""; const dec = new TextDecoder(); const evs = [];
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      const m = blk.match(/^data:\s*([\s\S]*)$/m); if (!m) continue;
      let o; try { o = JSON.parse(m[1]); } catch { continue; }
      if (o.type === "token") { if (tFirst === null) tFirst = Date.now() - t0; text += o.token ?? ""; }
      // R2 phần B — soi GƯƠNG client (useKbChatStream): `done.answerRevised` ⇒ văn bản đã sửa tất định sau stream
      // (bổ sung `using` C#) THAY văn bản tích luỹ. Thiết bị đo phải thấy đúng thứ người dùng thấy.
      else if (o.type === "done" && o.answerRevised === true && typeof o.answer === "string") { text = o.answer; evs.push("done:revised"); }
      else evs.push(o.type + (o.stop ? `(${o.stop})` : ""));
    }
  }
  return { text, ttftMs: tFirst, totalMs: Date.now() - t0, evs };
}

/**
 * ★ B2 (2026-09-22) — `--sampling hien-tai|chinh-hang`: hồ sơ sampling cho trục M.
 *
 *   hien-tai  (mặc định) = đúng bộ số bộ đo đã dùng cho MỌI báo cáo trước đó (temp 0,2 · top_p 0,9;
 *               top_k/min_p/presence để server điền: 20 · 0,05 · 0) ⇒ số cũ vẫn so được với số mới.
 *   chinh-hang           = model card Qwen3.6-35B-A3B: NGHĨ  0,6 / 0,95 / 20 / 0 / 0 / 1,0;
 *                                                     KHÔNG nghĩ (đi kèm --khong-nghi) 0,7 / 0,8 / 20 / 0 / 1,5 / 1,0.
 * ⚠ `min_p: 0` gửi TƯỜNG MINH — vắng là server điền 0,05, và "chính hãng" thành giả trong im lặng.
 * Cùng bộ số nằm ở `server/services/ai/hoSoSampling.ts` cho trục H; đổi một bên phải đổi bên kia.
 */
function samplingThan() {
  const ten = arg("--sampling", "hien-tai");
  if (ten !== "chinh-hang") return { temperature: 0.2, top_p: 0.9 };
  const nghi = !args.includes("--khong-nghi");
  return nghi
    ? { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1.0 }
    : { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1.0 };
}

async function genRaw(t) {
  const t0 = Date.now();
  const res = await fetch(RAW_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(arg("--model", null) ? { model: arg("--model", null) } : {}), messages: [{ role: "system", content: SYS }, { role: "user", content: t.prompt }],
      /**
       * ★★★ `--khong-nghi` (2026-09-22) — TẮT KHỐI `<think>` cho model biết nghĩ.
       *
       * Đo được trên Qwen3.6-27B: llama-server bật `thinking = 1` theo mặc định của template, và
       * ở trần 4.000 token thì **10/12 bài bị cắt cụt** — `2/12` khi ấy là con số của NGƯỜI ĐO,
       * không phải của model. Cùng hình dạng đã cắn một lần ở Qwen3.8 (trần 4k ⇒ 22 % là SỐ GIẢ;
       * trần 12k mới ra 67 %).
       *
       * Nhưng "cho đủ token" chỉ trả lời MỘT nửa câu hỏi. Nửa kia là: *một công cụ lập trình có
       * dùng nổi nó không?* — và ở đó 200 giây một lượt là câu trả lời KHÔNG, bất kể điểm số.
       * ⇒ Hai trục, đo tách bạch:
       *   • nghĩ BẬT  + trần rộng  = TRẦN CHẤT LƯỢNG của model;
       *   • nghĩ TẮT  + trần hẹp   = thứ thật sự dùng được trong một vòng lặp lập trình.
       * Một con số đơn lẻ luôn giấu mất một trong hai.
       *
       * ⚠ `chat_template_kwargs` là đường CHÍNH THỐNG của llama-server để truyền biến vào template
       *   Jinja; template Qwen3.6 kiểm đúng `enable_thinking is false` rồi phát `<think>\n\n</think>`
       *   rỗng. KHÔNG chèn chuỗi `/no_think` vào prompt: template này không có nhánh ấy, và một mẹo
       *   thất truyền sẽ HỎNG TRONG IM LẶNG (prompt bẩn, thinking vẫn bật, số vẫn ra — chỉ là sai).
       */
      /**
       * `--effort low|medium|high|xhigh` (2026-09-22) — template Qwen3.8 doc `reasoning_effort|default('xhigh')`:
       * llama-server ap muc CAO NHAT theo mac dinh, va do la ly do Qwen3.8 nghi 7.252 tok/bai (vs 5.220 cua
       * Qwen3.6) roi cut 7/36 o 16k. Muon so cong bang "cung effort" hay do truc "effort thap" thi phai co
       * nut nay. Cung duong chat_template_kwargs; gop voi --khong-nghi thanh MOT doi tuong.
       */
      ...(() => {
        const kw = {};
        if (args.includes("--khong-nghi")) kw.enable_thinking = false;
        const ef = arg("--effort", null);
        if (ef) kw.reasoning_effort = ef;
        return Object.keys(kw).length ? { chat_template_kwargs: kw } : {};
      })(),
      ...samplingThan(), max_tokens: Number(arg("--max-tokens", 1400)), stream: false }),
  });
  if (!res.ok) return { text: "", err: `HTTP ${res.status} ${(await res.text()).slice(0,200)}`, totalMs: Date.now() - t0 };
  const j = await res.json();
  const u = j.usage || {};
  return { text: j.choices?.[0]?.message?.content ?? "", totalMs: Date.now() - t0,
           promptTok: u.prompt_tokens, genTok: u.completion_tokens,
           tokPerSec: u.completion_tokens ? +(u.completion_tokens / ((Date.now() - t0) / 1000)).toFixed(1) : null };
}

const FAKE = JSON.parse(fs.readFileSync(`${BENCH}/${FAKEFILE}`, "utf8"));
async function genFake(t, kind) {
  const c = FAKE[kind]?.[t.id];
  return { text: c ? "```\n" + c + "\n```" : "", totalMs: 0, fake: true };
}


// ─────────────────────────────────────────────────────────── VÒNG
const gen = CONFIG === "pipeline" ? genPipeline
  : CONFIG === "raw" ? genRaw
  : (t) => genFake(t, CONFIG);


// ★★★ CỔNG SỨC KHOẺ — bài học đắt nhất phiên này: llama-server CHẾT giữa chừng và tôi suýt
//   báo cáo "đường ống + Coder = 0/9" như phát hiện sản phẩm, trong khi đó là hiện vật công cụ.
async function kiemLlama(nhan) {
  // fake-ok / fake-bad KHÔNG gọi model (kiểm thước) ⇒ không đòi llama-server sống: vứt số vì server chết chỉ đúng khi
  // số ấy có đi qua model.
  if (CONFIG.startsWith("fake-")) return;
  /**
   * ★ Cổng canh ĐÚNG endpoint đang đo, không canh cứng một cổng. Bản đầu ghim `:8091/health`;
   * khi đo một runtime KHÁC (Ollama :11434 cho Devstral — llama.cpp b9814 không nạp nổi kiến trúc
   * `mistral3` có thị giác) thì cổng ấy vứt một lượt đo hoàn toàn hợp lệ. Một cổng canh sai chỗ
   * cũng nguy hiểm như không có cổng.
   */
  const base = new URL(RAW_URL);
  const url = base.port === "11434" ? `${base.origin}/api/tags` : `${base.origin}/health`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (r.status !== 200) throw new Error("health " + r.status);
  } catch (e) {
    console.error(`
⛔ VỨT KẾT QUẢ: llama-server :8091 KHÔNG khoẻ ${nhan} (${e}). Mọi số của lượt này VÔ GIÁ TRỊ.`);
    process.exit(2);
  }
}
await kiemLlama("TRƯỚC khi đo");

const rows = [];
for (const t of tasks) {
  process.stderr.write(`▶ ${t.id} (${t.lang}) … `);
  let g; try { g = await gen(t); } catch (e) { g = { text: "", err: String(e).slice(0, 200) }; }
  const dir = `${WORK}/${LABEL}/${t.id}`;
  const c = await chamBai({ t, text: g.text || "", dir });
  const r = { ok: c.dat };
  const row = { id: t.id, lang: t.lang, ...(t.nhom ? { nhom: t.nhom } : {}), config: LABEL, sinhDuocMa: c.sinhDuocMa, chayDat: c.dat,
    ttftMs: g.ttftMs ?? null, totalMs: g.totalMs ?? null, tokPerSec: g.tokPerSec ?? null,
    genTok: g.genTok ?? null, evs: g.evs ?? null, err: g.err ?? null,
    loi: c.loi, code: c.code, vanBanGoc: (g.text||"").slice(0,20000) };
  rows.push(row);
  process.stderr.write(`${r.ok ? "ĐẠT" : "TRƯỢT"}  ${g.totalMs ?? "-"}ms\n`);
}

await kiemLlama("SAU khi đo");
fs.mkdirSync(`${BENCH}/reports`, { recursive: true });
fs.writeFileSync(`${BENCH}/reports/${LABEL}.json`, JSON.stringify(rows, null, 1));
const by = (f) => rows.filter(f);
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
console.log(`\n══ ${LABEL} ══ n=${rows.length}`);
// api2: in MỌI ngôn ngữ có mặt (cpp/tsx/pgsql/tsql/ps1 trước đây bị bỏ khỏi bảng tóm tắt) + theo NHÓM nếu bài khai `nhom`.
for (const l of [...new Set(["ts", "py", "cs", ...rows.map((r) => r.lang)])]) {
  const g = by(r => r.lang === l); if (!g.length) continue;
  console.log(` ${l}: sinh ${by(r => r.lang === l && r.sinhDuocMa).length}/${g.length} · CHẠY ĐẠT ${by(r => r.lang === l && r.chayDat).length}/${g.length}`);
}
for (const n of [...new Set(rows.map((r) => r.nhom).filter(Boolean))]) {
  const g = by(r => r.nhom === n);
  console.log(` [${n}] CHẠY ĐẠT ${g.filter(r => r.chayDat).length}/${g.length}`);
}
const okAll = by(r => r.chayDat).length;
console.log(` TỔNG chạy-đạt: ${okAll}/${rows.length} = ${pct(okAll, rows.length)}%`);
const lat = rows.map(r => r.totalMs).filter(Boolean);
if (lat.length) console.log(` độ trễ: trung vị ${lat.sort((a,b)=>a-b)[Math.floor(lat.length/2)]}ms · max ${Math.max(...lat)}ms`);
