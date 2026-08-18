#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * BỘ ĐO ĐỘ TIN CẬY GỌI TOOL (tool-calling eval) — G0 phần A, nhiệm vụ 1.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * VÌ SAO CÓ FILE NÀY: hệ có 77 tool đăng ký trong `server/services/aiLocalTools/**`, và việc
 * CHỌN tool hiện do **regex** làm (`intentClassifier.classifyToolIntent`), với một đường LLM dự
 * phòng chỉ chạy khi regex trượt (`classifyToolIntentLLM`, cờ `AI_TOOL_LLM_FALLBACK=1`).
 * Trước file này **chưa từng có phép đo nào** nói được regex gánh bao nhiêu phần trăm, sai ở đâu,
 * và có đoán bừa tham số hay không.
 *
 * ★ HARNESS GỌI THẲNG MÃ SẢN PHẨM. Không mô phỏng lại luật chọn tool: nó `import` đúng
 *   `classifyToolIntent` mà `tryExecuteTool()` gọi, và đúng `listTools()` của registry thật.
 *   Một tên tool bịa trong bộ ca là LỖI CỦA BỘ CA và bị `--selfcheck` bắt (không phải một ca trượt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỚP LỖI FILE NÀY CỐ Ý CHỐNG: **"KHÔNG ĐO ĐƯỢC GÌ MÀ CỔNG VẪN KHAI XANH."**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Repo này đã dính đúng lớp lỗi đó (glob rỗng ⇒ vitest im lặng ⇒ cổng xanh). Ở đây nó có ba cửa:
 *   1. Chạy 0 ca  ⇒ **THOÁT 1**, không bao giờ in "PASS" trên một tập rỗng.
 *   2. Nhánh LLM không sẵn sàng ⇒ in khối **SKIPPED** kèm LÝ DO cụ thể, và ghi
 *      `llm.available=false` vào report. `--ci` coi *"xin đo LLM mà không đo được"* là **THẤT BẠI**,
 *      không phải im lặng bỏ qua.
 *   3. Mọi con số suy ra từ mẫu số 0 được ghi `null` (KHÔNG phải 1.0) — một tỉ lệ không tồn tại
 *      không được phép trông giống một tỉ lệ hoàn hảo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CHỈ SỐ IN RA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   toolAccuracyStrict   — đúng CHÍNH XÁC `expectTool` / số ca có kỳ vọng khác null.
 *   toolAccuracyLenient  — thuộc {expectTool} ∪ acceptTools (chỉ nới ở ca có lý lẽ ghi trong `note`).
 *   argsAccuracy         — args khớp (mọi khoá trong `expectArgs` đúng giá trị, mọi khoá trong
 *                          `forbidArgKeys` vắng mặt) / số ca có `expectArgs`.
 *                          ⚠ Tính trên MỌI ca có expectArgs, **kể cả ca chọn sai tool** (chọn sai
 *                          tool thì args đương nhiên sai — che nó đi là làm đẹp số liệu).
 *   refusalCorrectRate   — nhóm `refuse` trả `tool=null` / tổng nhóm `refuse`.
 *   falsePositiveRate    — nhóm `refuse` LẠI chọn một tool / tổng nhóm `refuse`.  (1 − refusalCorrectRate)
 *   clarifyRate          — trong các ca `refuse` có `expectClarify`, tỉ lệ KÈM câu hỏi lại.
 *   distractorPairRate   — cặp đối kháng ĐẠT khi **cả hai** vế đúng **và** ra hai tool KHÁC nhau.
 *                          ⚠ Đây là chỉ số khó nhất và là chỉ số duy nhất bắt được lỗi "gộp hai ý
 *                          định khác nhau vào một tool" — một cặp cùng trúng một tool vẫn có thể
 *                          cho từng vế "đúng" ở chỉ số khác nếu bộ ca lỏng.
 *   diacritics           — tách accuracy câu CÓ DẤU vs KHÔNG DẤU + `dropPoints` (chênh lệch).
 *
 * TÁCH REGEX vs LLM (yêu cầu cốt lõi — regex gánh bao nhiêu %):
 *   `regexOnly` : chỉ `classifyToolIntent()`. KHÔNG cần model, không nạp VRAM.
 *   `withLlm`   : mô phỏng ĐÚNG đường ống của `tryExecuteTool()` — regex trước, chỉ khi
 *                 `tool === null` mới gọi `classifyToolIntentLLM()`. Nạp model ⇒ **opt-in `--llm`**.
 *   `llmLift`   : withLlm − regexOnly, theo từng chỉ số. Đây là câu trả lời cho *"bật cờ
 *                 AI_TOOL_LLM_FALLBACK có đáng không"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CÁCH CHẠY (phải qua `tsx` — file này import module TypeScript)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   npx tsx scripts/ai-eval/eval-toolcall.mjs --selfcheck   # kiểm tra bộ ca + registry, KHÔNG model
 *   npx tsx scripts/ai-eval/eval-toolcall.mjs               # nhánh regex (KHÔNG cần model)
 *   npx tsx scripts/ai-eval/eval-toolcall.mjs --llm         # + nhánh LLM dự phòng (NẠP MODEL)
 *   npx tsx scripts/ai-eval/eval-toolcall.mjs --group distractor
 *   npx tsx scripts/ai-eval/eval-toolcall.mjs --ci --min 0.75
 *
 * CỜ: --selfcheck · --llm · --group <select|args|refuse|distractor> · --only <id-prefix> ·
 *     --limit N · --label <tên> · --cases <path> · --out <dir> · --ci · --min <float> · --quiet
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const SELFCHECK = has("--selfcheck");
const DO_LLM = has("--llm");
/**
 * ★★★ G2-B — NHÁNH THỨ BA: **TOOL-CALLING GỐC**. Model tự quyết định gọi tool nào, qua ô `tools`
 * của `llama-server`, thay vì để một bộ phân loại regex bên ngoài chọn hộ.
 *
 * ⚠⚠ BA CÁI BẪY CỦA PHÉP ĐO NÀY — đã cài lưới cho cả ba:
 *  (1) **MẪU SỐ.** Bẫy đã dính hai lần trong đợt này: một tỉ lệ tính trên *"ca mà model có trả
 *      lời"* thay vì *"ca kỳ vọng"* sẽ cho `1,000` ở đúng nhánh TỆ NHẤT (model chết ⇒ 0 ca trả
 *      lời ⇒ 0/0 ⇒ "hoàn hảo"). Ở đây **mọi** ca đều sinh một bản ghi: lượt hỏng ⇒ `tool: null`
 *      + `reason: "NATIVE_ERROR:…"`, tức nó rơi vào nhóm "không chọn tool" và bị TRỪ ĐIỂM đúng
 *      như một lượt từ chối sai. `scoreRun()` dùng chung, mẫu số y hệt hai nhánh kia.
 *  (2) **Lỗi vận chuyển đội lốt "từ chối đúng".** Vì một lượt HTTP hỏng cũng cho `tool: null`, và
 *      `tool: null` là ĐÁP ÁN ĐÚNG của nhóm `refuse`, một server chết sẽ đẩy `refusalCorrectRate`
 *      lên 1,000. ⇒ `nativeErrors` được đếm RIÊNG, in ra kèm mọi bảng, và `--ci` coi
 *      `nativeErrors > 0` là THẤT BẠI.
 *  (3) **Schema làm chết grammar.** 9/77 tool có `maxLength ≥ 2000` hoặc `pattern` phức tạp ⇒
 *      llama.cpp trả 400 cho CẢ yêu cầu. Đi qua `veSchemaAnToanChoGrammar()` của mã sản phẩm
 *      (không phải một bản chép trong harness) và KHẲNG ĐỊNH `timGioiHanGrammar()` trả rỗng.
 */
const DO_NATIVE = has("--native");
const GROUP = val("--group", null);
const ONLY = val("--only", null);
const LIMIT = Number(val("--limit", "0")) || 0;
const LABEL = val("--label", new Date().toISOString().slice(0, 10));
const CASES_FILE = path.resolve(val("--cases", path.join(HERE, "toolcall-cases.json")));
const OUT_DIR = path.resolve(val("--out", path.join(HERE, "reports")));
const DO_CI = has("--ci");
const CI_MIN = Number(val("--min", "0.75"));
const QUIET = has("--quiet");

const log = (...a) => { if (!QUIET) console.log(...a); };

// ─── Tiện ích so sánh ────────────────────────────────────────────────────────
/** So sánh sâu, chấp nhận số nguyên/thực bằng nhau về giá trị. */
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k]));
}

/**
 * Args ĐẠT khi: mọi khoá trong `expectArgs` có mặt và đúng giá trị, VÀ mọi khoá trong
 * `forbidArgKeys` vắng mặt. Trả về cả danh sách sai lệch để người đọc report thấy sai ở ĐÂU
 * (một tỉ lệ không nói được "orderCode bị cắt còn 12345").
 */
function checkArgs(expectArgs, forbidKeys, actual) {
  const diffs = [];
  const act = actual ?? {};
  for (const [k, v] of Object.entries(expectArgs ?? {})) {
    if (!Object.hasOwn(act, k)) diffs.push({ key: k, expected: v, actual: "(vắng)" });
    else if (!deepEq(act[k], v)) diffs.push({ key: k, expected: v, actual: act[k] });
  }
  for (const k of forbidKeys ?? []) {
    if (Object.hasOwn(act, k) && act[k] !== undefined) {
      diffs.push({ key: k, expected: "(phải VẮNG)", actual: act[k] });
    }
  }
  return { ok: diffs.length === 0, diffs };
}

/** Tỉ lệ — `null` khi mẫu số 0. KHÔNG BAO GIỜ trả 1.0 cho một tập rỗng. */
function rate(hit, total) {
  return total > 0 ? Number((hit / total).toFixed(4)) : null;
}

// ─── Nạp bộ ca ───────────────────────────────────────────────────────────────
function loadCases() {
  if (!fs.existsSync(CASES_FILE)) {
    throw new Error(`Không tìm thấy bộ ca: ${CASES_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(CASES_FILE, "utf8"));
  const all = Array.isArray(raw) ? raw : raw.cases;
  if (!Array.isArray(all) || all.length === 0) {
    throw new Error(`Bộ ca rỗng hoặc sai định dạng: ${CASES_FILE}`);
  }
  let cases = all;
  if (GROUP) cases = cases.filter((c) => c.group === GROUP);
  if (ONLY) cases = cases.filter((c) => String(c.id).startsWith(ONLY));
  if (LIMIT) cases = cases.slice(0, LIMIT);
  return { all, cases };
}

// ─── Kiểm tra tính toàn vẹn của bộ ca (chạy LUÔN, không chỉ ở --selfcheck) ───
/**
 * ⚠ Ba lỗi dưới đây là lỗi CỦA BỘ CA, không phải kết quả đo. Chúng làm cả phép đo vô nghĩa nên
 * phải **THOÁT 1** ngay, chứ không được biến thành "vài ca trượt".
 */
function validateCases(all, registryNames) {
  const errs = [];
  const seen = new Set();
  const GROUPS = new Set(["select", "args", "refuse", "distractor"]);
  for (const c of all) {
    if (!c.id) errs.push(`Ca thiếu 'id': ${JSON.stringify(c).slice(0, 80)}`);
    if (seen.has(c.id)) errs.push(`Trùng id: ${c.id}`);
    seen.add(c.id);
    if (!c.question || typeof c.question !== "string") errs.push(`${c.id}: thiếu 'question'`);
    if (!GROUPS.has(c.group)) errs.push(`${c.id}: 'group' không hợp lệ (${c.group})`);
    if (!("expectTool" in c)) errs.push(`${c.id}: thiếu 'expectTool' (dùng null cho ca từ chối)`);
    if (c.expectTool !== null && !registryNames.has(c.expectTool)) {
      errs.push(`${c.id}: expectTool "${c.expectTool}" KHÔNG có trong registry thật`);
    }
    for (const t of c.acceptTools ?? []) {
      if (!registryNames.has(t)) errs.push(`${c.id}: acceptTools "${t}" KHÔNG có trong registry thật`);
      if (!c.note) errs.push(`${c.id}: có acceptTools thì BẮT BUỘC có 'note' nêu lý lẽ`);
    }
    if (c.group === "refuse" && c.expectTool !== null) {
      errs.push(`${c.id}: nhóm 'refuse' phải có expectTool = null`);
    }
    if (c.group === "distractor" && !c.pairId) errs.push(`${c.id}: nhóm 'distractor' thiếu 'pairId'`);
  }
  // Cặp đối kháng phải đủ 2 vế và phải kỳ vọng HAI tool KHÁC nhau (nếu bằng nhau thì nó
  // không còn là ca đối kháng — và sẽ "đạt" một cách vô nghĩa).
  const pairs = new Map();
  for (const c of all.filter((x) => x.group === "distractor")) {
    if (!pairs.has(c.pairId)) pairs.set(c.pairId, []);
    pairs.get(c.pairId).push(c);
  }
  for (const [pid, arr] of pairs) {
    if (arr.length !== 2) errs.push(`Cặp ${pid}: phải có ĐÚNG 2 vế (đang có ${arr.length})`);
    else if (arr[0].expectTool === arr[1].expectTool) {
      errs.push(`Cặp ${pid}: hai vế kỳ vọng CÙNG một tool ⇒ không phải ca đối kháng`);
    }
  }
  return errs;
}

// ─── Nhánh LLM: kiểm tra sẵn sàng TRƯỚC khi đo, và nói rõ vì sao không đo được ─
async function probeLlmReadiness() {
  if (process.env.AI_TOOL_LLM_FALLBACK !== "1") {
    return { available: false, reason: "AI_TOOL_LLM_FALLBACK ≠ 1 — classifyToolIntentLLM() sẽ trả LLM_FALLBACK_DISABLED ngay, không hề gọi model." };
  }
  const useLegacyOllama = (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";
  let ggufErr = null;
  if (!useLegacyOllama) {
    try {
      const { isGgufAvailable } = await import("../../server/services/aiGgufEngine");
      if (await isGgufAvailable()) return { available: true, engine: "gguf" };
      ggufErr = "isGgufAvailable() trả false (thiếu file model hoặc engine chưa nạp được)";
    } catch (e) {
      ggufErr = e?.message ?? String(e); // rơi xuống thử Ollama
    }
  }
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) return { available: true, engine: "ollama", base };
    return { available: false, reason: `Ollama ${base} trả HTTP ${res.status}; GGUF cũng không sẵn sàng.` };
  } catch (e) {
    return {
      available: false,
      reason:
        `Không có engine phân loại: GGUF không sẵn sàng` +
        (typeof ggufErr === "string" ? ` (${ggufErr})` : "") +
        `, và Ollama ${base} không kết nối được (${e?.message ?? e}).`,
    };
  }
}

// ═══ G2-B — NHÁNH TOOL-CALLING GỐC ════════════════════════════════════════════════════════════

const NATIVE_URL = (process.env.LLAMA_SERVER_URL || "http://127.0.0.1:8091").replace(/\/$/, "");

/**
 * Câu dẫn hệ thống của nhánh native. CỐ Ý NGẮN VÀ TRUNG TÍNH: nhánh regex không có "prompt" nào
 * để tinh chỉnh, nên một system prompt dài dòng dạy model mẹo làm bài sẽ biến phép so sánh thành
 * "regex vs regex+một bài giảng" — bất công theo cấu tạo và không tái lập được ở sản phẩm.
 */
const NATIVE_SYSTEM =
  "Bạn là trợ lý vận hành nhà máy AOI/AVI. Nếu câu hỏi cần dữ liệu hệ thống, hãy gọi đúng MỘT tool phù hợp. " +
  "Nếu câu hỏi không cần dữ liệu hệ thống, trả lời ngắn gọn bằng lời, KHÔNG gọi tool.";

/**
 * Dựng mảng `tools` khuôn OpenAI từ registry THẬT.
 *
 * ⚠⚠ `__authCtx` BỊ BÓC KHỎI SCHEMA, và đây là quyết định AN NINH chứ không phải dọn dẹp:
 * 30/77 tool khai `__authCtx` trong `parameters`. Đưa ô ấy vào danh sách tool là **dạy model bịa
 * ra một danh tính** ("userId": 999, "role": "superadmin") — đúng thứ mà `argsWithAuthCtx()`
 * (`toolRegistry.ts`) xoá vô điều kiện rồi gán lại từ phiên thật. Hàng rào ấy vẫn giữ được, nhưng
 * mời model thử là làm rộng bề mặt tấn công không vì lý do gì.
 */
async function dungToolsTuRegistry(tools) {
  const { z } = await import("zod");
  const { veSchemaAnToanChoGrammar, timGioiHanGrammar } = await import("../../server/services/ai/nativeToolCalls");
  const bocAuth = (js) => {
    if (js?.properties?.__authCtx) {
      const { __authCtx, ...rest } = js.properties;
      const req = Array.isArray(js.required) ? js.required.filter((r) => r !== "__authCtx") : js.required;
      return { ...js, properties: rest, ...(req ? { required: req } : {}) };
    }
    return js;
  };
  const wire = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: (t.description || "").slice(0, 300),
      parameters: veSchemaAnToanChoGrammar(
        bocAuth(z.toJSONSchema(t.parameters, { io: "input", unrepresentable: "any" })),
      ),
    },
  }));
  // Cửa chống "đo được 0 mà cổng vẫn xanh": nếu còn một ràng buộc làm chết grammar thì MỌI lượt
  // sẽ trả 400, và ta phải biết ngay ở đây chứ không phải qua 82 bản ghi `NATIVE_ERROR`.
  const con = timGioiHanGrammar(wire);
  if (con.length) throw new Error(`tools còn ${con.length} ràng buộc làm chết grammar: ${con.slice(0, 3).join(" · ")}`);
  const raw = JSON.stringify(wire);
  if (raw.includes("__authCtx")) throw new Error("`__authCtx` vẫn còn trong schema gửi cho model — BÓC HỎNG.");
  return { wire, bytes: raw.length };
}

/** Kiểm tra nhánh native có đo được không, và nói RÕ vì sao nếu không. */
async function probeNativeReadiness() {
  try {
    const res = await fetch(`${NATIVE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "x",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "probe", description: "p", parameters: { type: "object", properties: {} } } }],
        tool_choice: "auto",
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { available: false, reason: `llama-server ${NATIVE_URL} trả HTTP ${res.status} cho một yêu cầu CÓ \`tools\`: ${t.slice(0, 180)}` };
    }
    const j = await res.json();
    return { available: true, build: j?.system_fingerprint ?? "(không khai)", url: NATIVE_URL };
  } catch (e) {
    return { available: false, reason: `không gọi được ${NATIVE_URL}: ${e?.message ?? e}` };
  }
}

/** Một lượt hỏi native. LUÔN trả về một quyết định — lỗi thành `tool:null` + `loi:true`. */
async function hoiNative(question, wire) {
  try {
    const res = await fetch(`${NATIVE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "x",
        messages: [
          { role: "system", content: NATIVE_SYSTEM },
          { role: "user", content: question },
        ],
        tools: wire,
        tool_choice: "auto",
        max_tokens: 320,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { tool: null, args: {}, reason: `NATIVE_ERROR:HTTP ${res.status} ${t.slice(0, 100)}`, loi: true, content: "" };
    }
    const j = await res.json();
    const tc = j?.choices?.[0]?.message?.tool_calls?.[0];
    const content = j?.choices?.[0]?.message?.content ?? "";
    if (!tc?.function?.name) {
      return { tool: null, args: {}, reason: `native:không gọi tool (${String(content).slice(0, 60)})`, loi: false, content };
    }
    let args = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch {
      // ⚠ args không parse được là một lượt CHỌN ĐÚNG-TOOL-SAI-THAM-SỐ, không phải một lượt hỏng
      // vận chuyển: giữ `tool`, để `argsAccuracy` trừ điểm đúng chỗ.
      args = {};
    }
    return { tool: tc.function.name, args, reason: `native:tool_calls`, loi: false, content };
  } catch (e) {
    return { tool: null, args: {}, reason: `NATIVE_ERROR:${e?.message ?? e}`, loi: true, content: "" };
  }
}

// ─── Chấm điểm một lượt chạy (regex-only hoặc with-llm) ──────────────────────
function scoreRun(records) {
  const withExpect = records.filter((r) => r.expectTool !== null);
  const refuse = records.filter((r) => r.group === "refuse");
  // ⚠ Mẫu số là "MỌI ca CÓ chấm args" (`argsOk !== null`), không phải "ca có `expectArgs`":
  //   một ca chỉ khai `forbidArgKeys` (cấm đoán bừa một khoá) vẫn là một phép đo args đầy đủ.
  const argsCases = records.filter((r) => r.argsOk !== null);

  const strictHits = withExpect.filter((r) => r.tool === r.expectTool).length;
  const lenientHits = withExpect.filter(
    (r) => r.tool === r.expectTool || (r.acceptTools ?? []).includes(r.tool),
  ).length;
  const argsHits = argsCases.filter((r) => r.argsOk).length;
  const refuseOk = refuse.filter((r) => r.tool === null).length;
  /**
   * ⚠⚠ `hasClarify === null` = **KHÔNG ĐO ĐƯỢC**, và những ca ấy bị LOẠI KHỎI MẪU SỐ.
   *
   * Vì sao có nhánh này: nhánh regex/llm có một Ô CÓ CẤU TRÚC (`decision.clarifyMessage`) — có
   * hay không là một sự thật nhị phân. Nhánh native hỏi lại bằng CHÍNH CÂU TRẢ LỜI (văn xuôi).
   * Lượt đo đầu dùng proxy *"câu trả lời có dấu ?"*, và proxy ấy chấm SAI ngay 2/3 ca: C03
   * ("Vui lòng cung cấp mã lệnh sản xuất (orderCode) để tôi kiểm tra") và C05 ("Tôi cần thêm
   * thông tin để thực hiện phân tích tương quan") **hỏi lại rất rõ ràng** mà không có dấu hỏi ⇒
   * bảng in ra `clarifyRate = 0.000` cho một hành vi thực ra ĐÚNG.
   *
   * Một tỉ lệ 0,000 sai còn tệ hơn một ô `n/a`: nó trông như một phép đo. So một ô-có-cấu-trúc với
   * một regex-trên-văn-xuôi là so hai thứ khác nhau — nên nhánh native khai KHÔNG ĐO ĐƯỢC, và
   * `rate()` trả `null` trên mẫu số 0 đúng như cửa số 3 ở đầu file đã quy định.
   */
  const clarifyCases = refuse.filter((r) => r.expectClarify && r.hasClarify !== null);
  const clarifyOk = clarifyCases.filter((r) => r.tool === null && r.hasClarify).length;

  // Cặp đối kháng: đạt khi CẢ HAI vế đúng VÀ hai tool khác nhau.
  const pairs = new Map();
  for (const r of records.filter((x) => x.group === "distractor")) {
    if (!pairs.has(r.pairId)) pairs.set(r.pairId, []);
    pairs.get(r.pairId).push(r);
  }
  let pairOk = 0, pairTotal = 0, pairCollapsed = 0;
  const pairDetail = [];
  for (const [pid, arr] of pairs) {
    if (arr.length !== 2) continue;
    pairTotal++;
    const bothRight = arr.every((r) => r.tool === r.expectTool);
    const distinct = arr[0].tool !== arr[1].tool;
    if (bothRight && distinct) pairOk++;
    // "SẬP CẶP" — hai câu khác ý định bị gộp về CÙNG một tool (kể cả cùng null).
    const collapsed = arr[0].tool === arr[1].tool;
    if (collapsed) pairCollapsed++;
    pairDetail.push({
      pairId: pid,
      ok: bothRight && distinct,
      collapsed,
      got: arr.map((r) => ({ id: r.id, expect: r.expectTool, got: r.tool })),
    });
  }

  // Tách theo dấu tiếng Việt.
  const noDia = withExpect.filter((r) => r.noDiacritics);
  const dia = withExpect.filter((r) => !r.noDiacritics && records.some((x) => x.variantOf === r.id));
  const diaAcc = rate(dia.filter((r) => r.tool === r.expectTool).length, dia.length);
  const noDiaAcc = rate(noDia.filter((r) => r.tool === r.expectTool).length, noDia.length);

  return {
    n: records.length,
    toolAccuracyStrict: rate(strictHits, withExpect.length),
    toolAccuracyLenient: rate(lenientHits, withExpect.length),
    toolSelectN: withExpect.length,
    argsAccuracy: rate(argsHits, argsCases.length),
    argsN: argsCases.length,
    refusalCorrectRate: rate(refuseOk, refuse.length),
    falsePositiveRate: rate(refuse.length - refuseOk, refuse.length),
    refuseN: refuse.length,
    clarifyRate: rate(clarifyOk, clarifyCases.length),
    clarifyN: clarifyCases.length,
    distractorPairRate: rate(pairOk, pairTotal),
    distractorPairsOk: pairOk,
    distractorPairsTotal: pairTotal,
    distractorPairsCollapsed: pairCollapsed,
    diacritics: {
      withDiacriticsAccuracy: diaAcc,
      noDiacriticsAccuracy: noDiaAcc,
      dropPoints:
        diaAcc !== null && noDiaAcc !== null ? Number((diaAcc - noDiaAcc).toFixed(4)) : null,
      pairedN: Math.min(dia.length, noDia.length),
    },
    perGroup: Object.fromEntries(
      ["select", "args", "refuse", "distractor"].map((g) => {
        const gr = records.filter((r) => r.group === g);
        const gh = gr.filter((r) => (r.expectTool === null ? r.tool === null : r.tool === r.expectTool)).length;
        return [g, { n: gr.length, correct: gh, accuracy: rate(gh, gr.length) }];
      }),
    ),
    _pairDetail: pairDetail,
  };
}

function fmt(v) {
  return v === null || v === undefined ? "  n/a" : v.toFixed(3);
}

async function main() {
  // ── 1. Nạp registry THẬT (side-effect đăng ký toàn bộ tool) ──
  const toolsMod = await import("../../server/services/aiLocalTools/index");
  const { classifyToolIntent, classifyToolIntentLLM, listTools } = toolsMod;
  const tools = listTools();
  const registryNames = new Set(tools.map((t) => t.name));
  const kinds = tools.reduce((a, t) => {
    const k = t.kind ?? "read";
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});

  const { all, cases } = loadCases();

  // ── 2. Kiểm tra bộ ca (LUÔN chạy — bộ ca hỏng thì phép đo vô nghĩa) ──
  const errs = validateCases(all, registryNames);
  if (errs.length) {
    console.error("\n[toolcall] ✗ BỘ CA KHÔNG HỢP LỆ — không đo được gì:");
    for (const e of errs) console.error("   -", e);
    process.exit(1);
  }

  log(
    `[toolcall] registry THẬT: ${tools.length} tool (` +
      Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(" · ") +
      `)`,
  );
  log(
    `[toolcall] bộ ca: ${all.length} ca (` +
      ["select", "args", "refuse", "distractor"]
        .map((g) => `${g}=${all.filter((c) => c.group === g).length}`)
        .join(" · ") +
      `) → chạy ${cases.length}`,
  );

  if (SELFCHECK) {
    // ⚠ selfcheck KHÔNG gọi model và KHÔNG khẳng định chất lượng — nó chỉ chứng minh
    //   "harness nối đúng vào mã sản phẩm và bộ ca hợp lệ".
    const llm = await probeLlmReadiness().catch((e) => ({ available: false, reason: String(e) }));
    log(`[toolcall] classifyToolIntent import: OK (${typeof classifyToolIntent})`);
    log(`[toolcall] classifyToolIntentLLM import: OK (${typeof classifyToolIntentLLM})`);
    log(`[toolcall] nhánh LLM: ${llm.available ? `SẴN SÀNG (${llm.engine})` : `KHÔNG sẵn sàng — ${llm.reason}`}`);
    const covered = new Set(all.filter((c) => c.expectTool).map((c) => c.expectTool));
    log(`[toolcall] tool được bộ ca phủ: ${covered.size}/${tools.length}`);
    const notCovered = tools.map((t) => t.name).filter((n) => !covered.has(n));
    log(`[toolcall] CHƯA phủ (${notCovered.length}): ${notCovered.join(", ")}`);
    log("[toolcall] ✓ selfcheck OK — bộ ca hợp lệ, wiring nguyên vẹn, KHÔNG nạp model nào.");
    process.exit(0);
  }

  if (cases.length === 0) {
    // Cửa 1 chống "cổng xanh trên tập rỗng".
    console.error("[toolcall] ✗ 0 ca được chạy (bộ lọc --group/--only/--limit loại hết). THOÁT 1.");
    process.exit(1);
  }

  // ── 3. Nhánh REGEX (không cần model) ──
  const t0 = Date.now();
  const regexRecords = cases.map((c) => {
    const d = classifyToolIntent(c.question, c.context);
    const argsChk = c.expectArgs || c.forbidArgKeys ? checkArgs(c.expectArgs, c.forbidArgKeys, d.args) : null;
    return {
      id: c.id,
      group: c.group,
      pairId: c.pairId ?? null,
      variantOf: c.variantOf ?? null,
      noDiacritics: !!c.noDiacritics,
      question: c.question,
      expectTool: c.expectTool,
      acceptTools: c.acceptTools ?? [],
      expectArgs: c.expectArgs ?? null,
      expectClarify: !!c.expectClarify,
      tool: d.tool,
      args: d.args,
      reason: d.reason,
      hasClarify: !!d.clarifyMessage,
      argsOk: argsChk ? argsChk.ok : null,
      argsDiffs: argsChk ? argsChk.diffs : [],
      path: "regex",
    };
  });
  const regexMs = Date.now() - t0;
  const regexScore = scoreRun(regexRecords);

  // ── 4. Nhánh LLM dự phòng (đúng đường ống tryExecuteTool: chỉ chạy khi regex trả null) ──
  let llmInfo = await probeLlmReadiness().catch((e) => ({ available: false, reason: String(e) }));
  let llmRecords = null;
  let llmScore = null;
  let llmMs = null;
  let llmCalls = 0;

  if (DO_LLM && llmInfo.available) {
    const t1 = Date.now();
    llmRecords = [];
    for (const r of regexRecords) {
      if (r.tool !== null) {
        llmRecords.push({ ...r, path: "regex" });
        continue;
      }
      llmCalls++;
      let d;
      try {
        d = await classifyToolIntentLLM(r.question);
      } catch (e) {
        d = { tool: null, args: {}, reason: `LLM_THREW:${e?.message ?? e}` };
      }
      const c = cases.find((x) => x.id === r.id);
      const argsChk = c.expectArgs || c.forbidArgKeys ? checkArgs(c.expectArgs, c.forbidArgKeys, d.args) : null;
      llmRecords.push({
        ...r,
        tool: d.tool,
        args: d.args,
        reason: d.reason,
        // Đường ống thật giữ lại clarifyMessage của heuristic khi LLM cũng bỏ cuộc.
        hasClarify: d.tool === null ? r.hasClarify : false,
        argsOk: argsChk ? argsChk.ok : null,
        argsDiffs: argsChk ? argsChk.diffs : [],
        path: "llm",
      });
    }
    llmMs = Date.now() - t1;
    llmScore = scoreRun(llmRecords);
  }

  // ── 4-bis. ★★★ G2-B — NHÁNH TOOL-CALLING GỐC ──
  let nativeInfo = { available: false, reason: "không yêu cầu (thiếu cờ --native)" };
  let nativeRecords = null;
  let nativeScore = null;
  let nativeMs = null;
  let nativeErrors = 0;
  let nativeToolBytes = 0;

  if (DO_NATIVE) {
    nativeInfo = await probeNativeReadiness().catch((e) => ({ available: false, reason: String(e) }));
    if (nativeInfo.available) {
      let wire = null;
      try {
        const dung = await dungToolsTuRegistry(tools);
        wire = dung.wire;
        nativeToolBytes = dung.bytes;
      } catch (e) {
        nativeInfo = { available: false, reason: `dựng tools từ registry HỎNG: ${e?.message ?? e}` };
      }
      if (wire) {
        log(
          `[toolcall] nhánh NATIVE: ${wire.length} tool → ${nativeToolBytes} byte schema gửi kèm MỖI lượt ` +
            `(build ${nativeInfo.build})`,
        );
        const t2 = Date.now();
        nativeRecords = [];
        for (const c of cases) {
          const d = await hoiNative(c.question, wire);
          if (d.loi) nativeErrors++;
          const argsChk = c.expectArgs || c.forbidArgKeys ? checkArgs(c.expectArgs, c.forbidArgKeys, d.args) : null;
          nativeRecords.push({
            id: c.id,
            group: c.group,
            pairId: c.pairId ?? null,
            variantOf: c.variantOf ?? null,
            noDiacritics: !!c.noDiacritics,
            question: c.question,
            expectTool: c.expectTool,
            acceptTools: c.acceptTools ?? [],
            expectArgs: c.expectArgs ?? null,
            expectClarify: !!c.expectClarify,
            tool: d.tool,
            args: d.args,
            reason: d.reason,
            /**
             * ⚠⚠ `null` = KHÔNG ĐO ĐƯỢC — xem khối lý lẽ ở `scoreRun()`. Nhánh regex/llm có ô
             * CÓ CẤU TRÚC `clarifyMessage`; nhánh native hỏi lại bằng văn xuôi. Proxy "có dấu ?"
             * mà lượt đầu dùng chấm SAI 2/3 ca (C03/C05 hỏi lại rõ ràng, không dấu hỏi) ⇒ in ra
             * `0.000` cho một hành vi ĐÚNG. Ô này khai thẳng là không đo được thay vì đẻ ra một
             * con số trông giống phép đo. `content` vẫn được lưu để người sau chấm tay được.
             */
            hasClarify: null,
            traLoiVanXuoi: (d.content || "").slice(0, 400),
            argsOk: argsChk ? argsChk.ok : null,
            argsDiffs: argsChk ? argsChk.diffs : [],
            path: "native",
          });
        }
        nativeMs = Date.now() - t2;
        nativeScore = scoreRun(nativeRecords);
      }
    }
  }

  // ── 5. In kết quả ──
  log("\n[toolcall] ── từng ca (nhánh REGEX) ──");
  /**
   * ⚠ HAI dấu tick RIÊNG BIỆT, cố ý. Bản đầu chỉ in MỘT dấu theo tool, nên hai ca chọn đúng tool
   * mà trích SAI tham số (B03 cắt cụt mã lô · B09 mất bộ lọc trạng thái) hiện ra là "✓" — đúng
   * kiểu thước đo nói xanh trong khi thứ đang hỏng nằm ngay trong cùng dòng.
   */
  for (const r of regexRecords) {
    const want = r.expectTool ?? "(none)";
    const got = r.tool ?? "(none)";
    const ok = r.expectTool === null ? r.tool === null : r.tool === r.expectTool;
    const argTag =
      r.argsOk === null
        ? "         "
        : r.argsOk
          ? " args=✓  "
          : ` args=✗ (${r.argsDiffs.map((d) => `${d.key}: ${JSON.stringify(d.actual)} ≠ ${JSON.stringify(d.expected)}`).join(" · ")})`;
    log(
      `  tool=${ok ? "✓" : "✗"} ${String(r.id).padEnd(6)} [${r.group.padEnd(10)}] muốn=${String(want).padEnd(34)} được=${String(got).padEnd(34)}${argTag} (${r.reason.replace(/\s+/g, " ").slice(0, 46)})`,
    );
  }

  const printBlock = (title, s, ms) => {
    log(`\n[toolcall] ── ${title} ── (${ms} ms)`);
    log(`  accuracy chọn tool (strict) : ${fmt(s.toolAccuracyStrict)}   (${s.toolSelectN} ca có kỳ vọng)`);
    log(`  accuracy chọn tool (lenient): ${fmt(s.toolAccuracyLenient)}`);
    log(`  accuracy trích args         : ${fmt(s.argsAccuracy)}   (${s.argsN} ca)`);
    log(`  từ chối ĐÚNG                : ${fmt(s.refusalCorrectRate)}   (${s.refuseN} ca nhóm refuse)`);
    log(`  DƯƠNG TÍNH GIẢ              : ${fmt(s.falsePositiveRate)}   ← chọn tool khi lẽ ra KHÔNG nên`);
    log(`  hỏi lại khi thiếu tham số   : ${fmt(s.clarifyRate)}   (${s.clarifyN} ca)`);
    log(`  cặp đối kháng ĐẠT           : ${fmt(s.distractorPairRate)}   (${s.distractorPairsOk}/${s.distractorPairsTotal}; ${s.distractorPairsCollapsed} cặp SẬP về cùng 1 tool)`);
    log(`  có dấu vs KHÔNG dấu         : ${fmt(s.diacritics.withDiacriticsAccuracy)} vs ${fmt(s.diacritics.noDiacriticsAccuracy)}  (tụt ${fmt(s.diacritics.dropPoints)} điểm trên ${s.diacritics.pairedN} cặp)`);
    log("  theo nhóm:");
    for (const [g, v] of Object.entries(s.perGroup)) {
      log(`    ${g.padEnd(11)} ${String(v.correct).padStart(3)}/${String(v.n).padEnd(3)} = ${fmt(v.accuracy)}`);
    }
  };

  printBlock("KẾT QUẢ — CHỈ REGEX (không model)", regexScore, regexMs);

  if (regexScore._pairDetail.some((p) => !p.ok)) {
    log("\n[toolcall] cặp đối kháng TRƯỢT (nhánh regex):");
    for (const p of regexScore._pairDetail.filter((x) => !x.ok)) {
      log(
        `  ${p.pairId}${p.collapsed ? " [SẬP — hai câu về cùng một tool]" : ""}: ` +
          p.got.map((g) => `${g.id} muốn=${g.expect} được=${g.got ?? "(none)"}`).join("  |  "),
      );
    }
  }

  // ── Nhánh LLM: hoặc in kết quả, hoặc in khối SKIPPED có lý do (KHÔNG im lặng) ──
  if (DO_LLM && llmScore) {
    printBlock(`KẾT QUẢ — REGEX + LLM DỰ PHÒNG (${llmInfo.engine}, ${llmCalls} lượt gọi model)`, llmScore, llmMs);
    log("\n[toolcall] ── LIFT của nhánh LLM (withLlm − regexOnly) ──");
    for (const k of ["toolAccuracyStrict", "argsAccuracy", "refusalCorrectRate", "falsePositiveRate", "distractorPairRate"]) {
      const a = regexScore[k], b = llmScore[k];
      const d = a === null || b === null ? null : Number((b - a).toFixed(4));
      log(`  ${k.padEnd(22)} ${fmt(a)} → ${fmt(b)}   lift=${d === null ? " n/a" : (d >= 0 ? "+" : "") + d.toFixed(3)}`);
    }
    const covered = regexScore.toolSelectN
      ? Number(((regexScore.toolAccuracyStrict ?? 0) / (llmScore.toolAccuracyStrict || 1)).toFixed(4))
      : null;
    log(`\n  → REGEX gánh ${covered === null ? "n/a" : (covered * 100).toFixed(1) + "%"} phần đúng của đường ống đầy đủ.`);
  } else if (DO_LLM) {
    log(`\n[toolcall] ── NHÁNH LLM: ✗ BỎ QUA — KHÔNG ĐO ĐƯỢC GÌ ──`);
    log(`  LÝ DO: ${llmInfo.reason}`);
    log(`  ⚠ Con số ở trên CHỈ là nhánh regex. Đừng đọc nó như "đường ống đầy đủ".`);
    log(`  Muốn đo: đặt AI_TOOL_LLM_FALLBACK=1 và bảo đảm GGUF (GGUF_MODELS_DIR/GGUF_FAST_MODEL) hoặc Ollama chạy được.`);
  } else {
    log(`\n[toolcall] ── NHÁNH LLM: không yêu cầu (thiếu cờ --llm) ──`);
    log(`  Trạng thái sẵn sàng đo được: ${llmInfo.available ? `SẴN SÀNG (${llmInfo.engine})` : `KHÔNG — ${llmInfo.reason}`}`);
    log(`  ⚠ Mọi con số ở trên là ĐƯỜNG REGEX. Đường ống sản phẩm (tryExecuteTool) còn một bước LLM nữa.`);
  }

  // ── ★★★ G2-B — BẢNG SO SÁNH BA NHÁNH, MỖI TỈ LỆ KÈM MẪU SỐ ──
  if (DO_NATIVE && nativeScore) {
    printBlock(`KẾT QUẢ — TOOL-CALLING GỐC (${cases.length} lượt gọi model, ${nativeErrors} lỗi vận chuyển)`, nativeScore, nativeMs);

    log("\n[toolcall] ── ★ SO SÁNH BA NHÁNH (mẫu số in kèm MỌI tỉ lệ) ──");
    const cot = (s, k) => fmt(s ? s[k] : null);
    const hang = (nhan, k, mauSoKey) => {
      const mau = nativeScore[mauSoKey];
      log(
        `  ${nhan.padEnd(26)} regex=${cot(regexScore, k)}  llm=${cot(llmScore, k)}  native=${cot(nativeScore, k)}   ` +
          `[mẫu số = ${mau} ca]`,
      );
    };
    hang("chọn tool (strict)", "toolAccuracyStrict", "toolSelectN");
    hang("chọn tool (lenient)", "toolAccuracyLenient", "toolSelectN");
    hang("trích args", "argsAccuracy", "argsN");
    hang("từ chối ĐÚNG", "refusalCorrectRate", "refuseN");
    hang("DƯƠNG TÍNH GIẢ", "falsePositiveRate", "refuseN");
    hang("hỏi lại khi thiếu", "clarifyRate", "clarifyN");
    log(
      `  ${"cặp đối kháng ĐẠT".padEnd(26)} regex=${cot(regexScore, "distractorPairRate")}  ` +
        `llm=${cot(llmScore, "distractorPairRate")}  native=${cot(nativeScore, "distractorPairRate")}   ` +
        `[mẫu số = ${nativeScore.distractorPairsTotal} cặp]`,
    );
    log(
      `  ${"có dấu / KHÔNG dấu".padEnd(26)} regex=${fmt(regexScore.diacritics.withDiacriticsAccuracy)}/${fmt(regexScore.diacritics.noDiacriticsAccuracy)}  ` +
        `native=${fmt(nativeScore.diacritics.withDiacriticsAccuracy)}/${fmt(nativeScore.diacritics.noDiacriticsAccuracy)}   ` +
        `[mẫu số = ${nativeScore.diacritics.pairedN} cặp]`,
    );
    log(
      `\n  ⚠ ${nativeErrors} lỗi vận chuyển ở nhánh native. Một lượt hỏng cho \`tool:null\`, mà \`null\` LÀ đáp án ` +
        `đúng của nhóm 'refuse' ⇒ server chết sẽ đẩy "từ chối ĐÚNG" lên 1,000. Đọc con số này TRƯỚC.`,
    );
    log(`  ⏱ chi phí: regex ${regexMs} ms cho ${cases.length} ca · native ${nativeMs} ms (${Math.round(nativeMs / cases.length)} ms/ca, ${nativeToolBytes} byte schema mỗi lượt).`);

    const lech = [];
    for (const r of nativeRecords) {
      const rg = regexRecords.find((x) => x.id === r.id);
      const nOk = r.expectTool === null ? r.tool === null : r.tool === r.expectTool;
      const rOk = rg ? (rg.expectTool === null ? rg.tool === null : rg.tool === rg.expectTool) : false;
      if (nOk !== rOk) lech.push({ id: r.id, group: r.group, expect: r.expectTool, regex: rg?.tool ?? null, native: r.tool, nOk });
    }
    log(`\n[toolcall] ── ${lech.length} ca mà native và regex BẤT ĐỒNG ──`);
    for (const l of lech) {
      log(
        `  ${l.nOk ? "native ĐÚNG" : "regex  ĐÚNG"} ${String(l.id).padEnd(6)} [${l.group.padEnd(10)}] muốn=${String(l.expect ?? "(none)").padEnd(30)} regex=${String(l.regex ?? "(none)").padEnd(30)} native=${l.native ?? "(none)"}`,
      );
    }
  } else if (DO_NATIVE) {
    log(`\n[toolcall] ── NHÁNH NATIVE: ✗ BỎ QUA — KHÔNG ĐO ĐƯỢC GÌ ──`);
    log(`  LÝ DO: ${nativeInfo.reason}`);
    log(`  ⚠ Con số ở trên KHÔNG nói gì về tool-calling gốc.`);
  }

  // ── 6. Ghi report ──
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `toolcall-${LABEL}.json`);
  const strip = (s) => {
    if (!s) return null;
    const { _pairDetail, ...rest } = s;
    return { ...rest, distractorPairs: _pairDetail };
  };
  const report = {
    label: LABEL,
    timestamp: new Date().toISOString(),
    casesFile: path.relative(ROOT, CASES_FILE),
    registry: { total: tools.length, byKind: kinds },
    filters: { group: GROUP, only: ONLY, limit: LIMIT || null },
    regexOnly: { ...strip(regexScore), elapsedMs: regexMs },
    llm: llmScore
      ? { available: true, engine: llmInfo.engine, modelCalls: llmCalls, ...strip(llmScore), elapsedMs: llmMs }
      : { available: false, requested: DO_LLM, reason: llmInfo.reason ?? null },
    // ★ G2-B — `transportErrors` nằm CẠNH mọi tỉ lệ trong report, không phải ở một dòng log trôi
    // qua: người đọc file JSON phải thấy ngay rằng `refusalCorrectRate` cao có thể là do server chết.
    native: nativeScore
      ? {
          available: true,
          url: NATIVE_URL,
          build: nativeInfo.build ?? null,
          toolsSent: tools.length,
          toolSchemaBytes: nativeToolBytes,
          transportErrors: nativeErrors,
          systemPrompt: NATIVE_SYSTEM,
          ...strip(nativeScore),
          elapsedMs: nativeMs,
        }
      : { available: false, requested: DO_NATIVE, reason: nativeInfo.reason ?? null },
    records: (llmRecords ?? regexRecords).map((r) => ({
      id: r.id, group: r.group, pairId: r.pairId, question: r.question,
      expectTool: r.expectTool, tool: r.tool, reason: r.reason, path: r.path,
      args: r.args, expectArgs: r.expectArgs, argsOk: r.argsOk, argsDiffs: r.argsDiffs,
      hasClarify: r.hasClarify, noDiacritics: r.noDiacritics,
    })),
    regexRecords: llmRecords
      ? regexRecords.map((r) => ({ id: r.id, tool: r.tool, reason: r.reason }))
      : undefined,
    // ★ G2-B — bản ghi TỪNG CA của nhánh native, ĐẦY ĐỦ. Lượt đầu bản vá này chỉ ghi `native.*`
    // (các tỉ lệ tổng) và để `records` mang bản ghi của nhánh llm ⇒ **không ai kiểm lại được ca
    // nào native sai**: một truy vấn `records.filter(path==="native")` trả 0 và trông y hệt
    // "native không sai ca nào". Thước đo tự khai một con số mà không cho ai lần lại được nó.
    nativeRecords: nativeRecords
      ? nativeRecords.map((r) => ({
          id: r.id, group: r.group, pairId: r.pairId, question: r.question,
          expectTool: r.expectTool, tool: r.tool, reason: r.reason,
          args: r.args, expectArgs: r.expectArgs, argsOk: r.argsOk, argsDiffs: r.argsDiffs,
          hasClarify: r.hasClarify, noDiacritics: r.noDiacritics, traLoiVanXuoi: r.traLoiVanXuoi ?? null,
        }))
      : undefined,
  };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
  log(`\n[toolcall] báo cáo → ${path.relative(ROOT, outFile)}`);

  // ── 7. Cổng CI ──
  let fail = false;
  if (DO_CI) {
    log(`\n[toolcall] ── CỔNG CI (min=${CI_MIN}) ──`);
    const s = llmScore ?? regexScore;
    const acc = s.toolAccuracyStrict;
    if (acc === null) {
      log("  ✗ không có ca nào có kỳ vọng tool ⇒ KHÔNG đo được accuracy.");
      fail = true;
    } else if (acc < CI_MIN) {
      log(`  ✗ accuracy chọn tool ${acc.toFixed(3)} < ${CI_MIN}`);
      fail = true;
    } else {
      log(`  ✓ accuracy chọn tool ${acc.toFixed(3)} ≥ ${CI_MIN}`);
    }
    // ⚠ Cửa 2: xin đo LLM mà không đo được là THẤT BẠI, không phải "bỏ qua".
    if (DO_LLM && !llmScore) {
      log("  ✗ yêu cầu --llm nhưng nhánh LLM KHÔNG đo được ⇒ cổng KHÔNG được khai xanh.");
      fail = true;
    }
    // ★ G2-B — cùng cửa ấy cho nhánh native, cộng một cửa RIÊNG cho lỗi vận chuyển: một lượt hỏng
    // cho `tool:null`, mà `null` là đáp án ĐÚNG của nhóm `refuse` ⇒ server chết = "từ chối hoàn hảo".
    if (DO_NATIVE && !nativeScore) {
      log("  ✗ yêu cầu --native nhưng nhánh NATIVE KHÔNG đo được ⇒ cổng KHÔNG được khai xanh.");
      fail = true;
    }
    if (DO_NATIVE && nativeScore && nativeErrors > 0) {
      log(`  ✗ ${nativeErrors} lỗi vận chuyển ở nhánh native ⇒ mọi tỉ lệ của nhánh này bị nhiễm.`);
      fail = true;
    }
    log(fail ? "  KẾT QUẢ: FAIL" : "  KẾT QUẢ: PASS");
  }

  // Dọn model nếu đã nạp.
  try {
    const eng = await import("../../server/services/aiGgufEngine");
    await eng.disposeGguf?.();
  } catch { /* không có gì để dọn */ }

  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("[toolcall] ✗ hỏng:", err?.stack ?? err?.message ?? err);
  process.exit(1);
});
