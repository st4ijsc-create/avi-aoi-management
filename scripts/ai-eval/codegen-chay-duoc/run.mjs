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
import { execFileSync, execSync } from "node:child_process";
import { ck } from "./cookie.mjs";

const ROOT = "D:/SOURCES/avi-aoi-management";
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
const FAKEFILE = arg("--fake", TASKFILE.startsWith("tasks-hard") ? "fake-hard.json" : "fake.json");
const tasks = JSON.parse(fs.readFileSync(`${BENCH}/${TASKFILE}`, "utf8"))
  .filter(t => !ONLY || ONLY.split(",").includes(t.id) || ONLY.split(",").includes(t.lang));

const SYS = "Bạn là trợ lý lập trình. Trả lời bằng ĐÚNG MỘT khối mã trong dấu ``` và không thêm lời giải thích nào ngoài khối mã đó.";

// ─────────────────────────────────────────────────────────── SINH
async function genPipeline(t) {
  const t0 = Date.now(); let tFirst = null;
  const res = await fetch("http://127.0.0.1:3000/api/ai/local-kb/stream", {
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

// ─────────────────────────────────────────────────────────── TÁCH MÃ
function extract(text, lang) {
  const fences = [...text.matchAll(/```[a-zA-Z#+]*\s*\n([\s\S]*?)```/g)].map(m => m[1]);
  if (fences.length) {
    // ★ ƯU TIÊN khối mang ĐỊNH DANH bài yêu cầu. Đường ống trả kèm NGỮ CẢNH REPO, trong đó có
    //   khối mã dài hơn nhiều — lấy "dài nhất" là lấy nhầm tệp của repo (đã đo: 21.638 ký tự
    //   trong khi model thật chỉ sinh 2.002).
    if (globalThis.__dinhDanh) {
      const trung = fences.filter(f => f.includes(globalThis.__dinhDanh));
      if (trung.length) return trung.sort((a, b) => b.length - a.length)[0].trim();
    }
    const key = lang === "cs" ? /class|namespace/ : lang === "cpp" ? /#include|template|struct|class/ : lang === "py" ? /def\s/ : /function|=>|const|export/;
    const good = fences.filter(f => key.test(f));
    return (good.length ? good : fences).sort((a, b) => b.length - a.length)[0].trim();
  }
  return text.trim();
}

// ─────────────────────────────────────────────────────────── CHẠY
/** CMake không nằm trên PATH của shell này — ghim đường tuyệt đối đã ĐO được, không đoán. */
const CMAKE = fs.existsSync("C:/Program Files/CMake/bin/cmake.exe")
  ? "C:/Program Files/CMake/bin/cmake.exe"
  : "cmake";

function sh(cmd, cwd, timeout = 180000) {
  try { return { ok: true, out: execSync(cmd, { cwd, timeout, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ""}\n${e.stderr || ""}`.slice(-1500) }; }
}

function runTs(t, code, dir) {
  fs.mkdirSync(dir, { recursive: true });
  // model hay viết `export function` — giữ nguyên; node 24 tự bóc kiểu cho .ts
  fs.writeFileSync(`${dir}/sol.ts`, code);
  fs.writeFileSync(`${dir}/t.test.ts`, t.test.replace("./sol.mjs", "./sol.ts"));
  fs.writeFileSync(`${dir}/package.json`, '{"type":"module"}');
  return sh(`node --experimental-transform-types --test t.test.ts`, dir, 60000);
}
function runPy(t, code, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/sol.py`, code);
  fs.writeFileSync(`${dir}/t.py`, t.test);
  return sh(`python t.py`, dir, 60000);
}
function runCs(t, code, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(`${BENCH}/cs-template/p.csproj`, `${dir}/p.csproj`);
  fs.writeFileSync(`${dir}/Sol.cs`, code);
  fs.writeFileSync(`${dir}/Program.cs`, t.test);
  return sh(`dotnet run --project p.csproj -v q --nologo`, dir, 240000);
}
/**
 * ★★★ C++ (2026-09-22) — chủ dự án đã cài CMake + msys2; đo được trên máy này: msys2 ở `C:\msys64`
 * **chưa cài gói toolchain** (0 tệp `g++.exe`), còn **MSVC 14.51.36231 thì có đủ**
 * (VS Professional 2026 + Build Tools 2026), chỉ không nằm trên PATH vì MSVC cần `vcvars64`.
 *
 * ⇒ Đi qua **CMake**, vì CMake tự dò MSVC qua registry: một bước ít hơn là một chỗ ít hỏng hơn,
 *   và bộ đo không phải mang theo một bản sao logic dựng môi trường của Visual Studio.
 *
 * ⚠ Thư mục dựng KHÔNG được nằm dưới thư mục tạm của hệ: MSBuild cảnh báo MSB8029 và build tăng
 *   dần có thể sai. Nên `dir` do người gọi truyền (nằm trong `tmp/` của repo) là đúng chỗ.
 * ⚠ `--config Release` BẮT BUỘC ở generator đa-cấu-hình của Visual Studio; thiếu nó thì
 *   `CMAKE_BUILD_TYPE` bị bỏ qua trong im lặng và tệp .exe rơi vào `Debug/`.
 */
function runCpp(t, code, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(`${BENCH}/cpp-template/CMakeLists.txt`, `${dir}/CMakeLists.txt`);
  // Bài kiểm nối THẲNG vào sau lời giải: C++ một-tệp, không cần hệ thống test ngoài.
  fs.writeFileSync(`${dir}/sol.cpp`, `${code}

${t.test}
`);
  const cm = sh(`"${CMAKE}" -S . -B b`, dir, 180000);
  if (!cm.ok) return cm;
  const bd = sh(`"${CMAKE}" --build b --config Release`, dir, 300000);
  if (!bd.ok) return bd;
  // ⚠ Dựng bằng `path.join` chứ KHÔNG gõ tay dấu `\` trong template string: bản đầu viết
  //   "b\Release\solbench.exe", JS nuốt hai dấu thoát và lệnh thành "bReleasesolbench.exe"
  //   — biên dịch ĐÃ đạt mà cả ba bài vẫn 0/3, tức một hiện vật công cụ đội lốt khuyết tật model.
  return sh(`"${path.join(dir, "b", "Release", "solbench.exe")}"`, dir, 60000);
}
const RUNNERS = { ts: runTs, py: runPy, cs: runCs, cpp: runCpp };

// ─────────────────────────────────────────────────────────── VÒNG
const gen = CONFIG === "pipeline" ? genPipeline
  : CONFIG === "raw" ? genRaw
  : (t) => genFake(t, CONFIG);


// ★★★ CỔNG SỨC KHOẺ — bài học đắt nhất phiên này: llama-server CHẾT giữa chừng và tôi suýt
//   báo cáo "đường ống + Coder = 0/9" như phát hiện sản phẩm, trong khi đó là hiện vật công cụ.
async function kiemLlama(nhan) {
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
  globalThis.__dinhDanh = (t.test.match(/import\s*\{\s*([A-Za-z_$][\w$]*)/) || t.test.match(/from sol import\s+([A-Za-z_][\w]*)/) || t.test.match(/([A-Z][A-Za-z0-9]+)\.[A-Z]/) || [])[1] || t.name;
  const code = extract(g.text || "", t.lang);
  const dir = `${WORK}/${LABEL}/${t.id}`;
  let r = { ok: false, out: "KHÔNG SINH ĐƯỢC MÃ" };
  if (code) { try { r = RUNNERS[t.lang](t, code, dir); } catch (e) { r = { ok: false, out: String(e).slice(0, 600) }; } }
  const row = { id: t.id, lang: t.lang, config: LABEL, sinhDuocMa: !!code, chayDat: r.ok,
    ttftMs: g.ttftMs ?? null, totalMs: g.totalMs ?? null, tokPerSec: g.tokPerSec ?? null,
    genTok: g.genTok ?? null, evs: g.evs ?? null, err: g.err ?? null,
    loi: r.ok ? null : String(r.out).slice(-700), code, vanBanGoc: (g.text||'').slice(0,20000) };
  rows.push(row);
  process.stderr.write(`${r.ok ? "ĐẠT" : "TRƯỢT"}  ${g.totalMs ?? "-"}ms\n`);
}

await kiemLlama("SAU khi đo");
fs.mkdirSync(`${BENCH}/reports`, { recursive: true });
fs.writeFileSync(`${BENCH}/reports/${LABEL}.json`, JSON.stringify(rows, null, 1));
const by = (f) => rows.filter(f);
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
console.log(`\n══ ${LABEL} ══ n=${rows.length}`);
for (const l of ["ts", "py", "cs"]) {
  const g = by(r => r.lang === l); if (!g.length) continue;
  console.log(` ${l}: sinh ${by(r => r.lang === l && r.sinhDuocMa).length}/${g.length} · CHẠY ĐẠT ${by(r => r.lang === l && r.chayDat).length}/${g.length}`);
}
const okAll = by(r => r.chayDat).length;
console.log(` TỔNG chạy-đạt: ${okAll}/${rows.length} = ${pct(okAll, rows.length)}%`);
const lat = rows.map(r => r.totalMs).filter(Boolean);
if (lat.length) console.log(` độ trễ: trung vị ${lat.sort((a,b)=>a-b)[Math.floor(lat.length/2)]}ms · max ${Math.max(...lat)}ms`);
