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
      context: { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo" } }),
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
      else evs.push(o.type + (o.stop ? `(${o.stop})` : ""));
    }
  }
  return { text, ttftMs: tFirst, totalMs: Date.now() - t0, evs };
}

async function genRaw(t) {
  const t0 = Date.now();
  const res = await fetch(RAW_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "system", content: SYS }, { role: "user", content: t.prompt }],
      temperature: 0.2, top_p: 0.9, max_tokens: Number(arg("--max-tokens", 1400)), stream: false }),
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
    const key = lang === "cs" ? /class|namespace/ : lang === "py" ? /def\s/ : /function|=>|const|export/;
    const good = fences.filter(f => key.test(f));
    return (good.length ? good : fences).sort((a, b) => b.length - a.length)[0].trim();
  }
  return text.trim();
}

// ─────────────────────────────────────────────────────────── CHẠY
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
const RUNNERS = { ts: runTs, py: runPy, cs: runCs };

// ─────────────────────────────────────────────────────────── VÒNG
const gen = CONFIG === "pipeline" ? genPipeline
  : CONFIG === "raw" ? genRaw
  : (t) => genFake(t, CONFIG);


// ★★★ CỔNG SỨC KHOẺ — bài học đắt nhất phiên này: llama-server CHẾT giữa chừng và tôi suýt
//   báo cáo "đường ống + Coder = 0/9" như phát hiện sản phẩm, trong khi đó là hiện vật công cụ.
async function kiemLlama(nhan) {
  try {
    const r = await fetch("http://127.0.0.1:8091/health", { signal: AbortSignal.timeout(4000) });
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
