#!/usr/bin/env node
/**
 * scripts/ai-eval/eval-vscode-route.mjs — Việc 3 · B4: bộ đo đi qua ĐÚNG đường extension.
 *
 * ★★★ VÌ SAO BỘ NÀY TỒN TẠI ★★★
 * Mọi bộ `eval-*` khác trong thư mục này gọi THẲNG một service (searchProgrammingKb,
 * classifyToolIntent, generateProgram, …) — không đứa nào đi qua HTTP thật, qua phiên đăng
 * nhập thật, qua `context.route === "vscode"` như người dùng thật gõ trong panel VSCode. Route
 * đó VỪA ĐỔI HẲN hai lần gần đây:
 *   - Việc 2 (task-v2-report.md): tool-loop TẮT HOÀN TOÀN cho route vscode (KHONG_TOOL_VSCODE).
 *   - Việc 1 (task-v1-report.md): route vscode nối vào knowledge/programming/* (91k→125k chunk,
 *     6 hãng), KHÔNG còn chạm kho vận hành (knowledge/chunks.jsonl) một byte nào.
 * Không có bộ đo nào xác nhận cả hai điều đó qua ĐƯỜNG DÂY THẬT (HTTP + cookie phiên thật) cho
 * tới bộ này.
 *
 * ★ KHÁC BIỆT QUAN TRỌNG với eval-rag-programming.mjs: case ở đó gọi
 * `searchProgrammingKb({query, vendor, topK})` — CÓ vendor lọc trước. Route thật KHÔNG NHẬN
 * trường `vendor` từ client (`parseContext()` trong server/routes/aiLocalKnowledgeApi.ts không
 * đọc `context.vendor`) — `retrieveProgrammingKnowledgeForVscode()` tìm KHẮP cả 6 collection chỉ
 * bằng nội dung câu hỏi. Đây là phép đo CẬN THỰC hơn: nó đo cả bước "model tự nhận ra đúng hãng"
 * mà bộ eval-rag-programming.mjs bỏ qua bằng cách cho sẵn đáp án.
 *
 * ★ CHỐNG CACHE: `answerCache` khoá bằng `userRole|normalizeText(question)|k|studio` — KHÔNG có
 * `route` trong khoá (đọc server/services/aiLocalKnowledgeService.ts:getCacheKey). Hai câu hỏi
 * trùng chữ ở hai lượt đo (dù khác route/khác ngày) sẽ ăn cache của nhau. Mỗi case trong
 * vscode-route-cases.json mang một token `[ts={ts}]` được điền THẬT ở runtime (Date.now() +
 * random) để đảm bảo mỗi lượt gọi là một khoá cache MỚI — TTL mặc định 10 phút
 * (KB_QA_CACHE_TTL_MS), đủ để một lượt chạy lại vô tình trùng giây bị cache nếu không có token.
 *
 * CHẤM: theo KẾT CỤC nhận được qua stream SSE thật (không suy diễn từ mã nguồn):
 *   - "grounded"     : ĐẠT nếu có ≥1 citation sourceType="vendor_manual" mà sourcePath/title chứa
 *                      đúng tên hãng kỳ vọng VÀ score ≥ 0.5 (ngưỡng sản xuất thật, không phải một
 *                      ngưỡng eval tự đặt); SAI nếu có citation nhưng KHÔNG đúng hãng; HỎNG nếu
 *                      citations rỗng hoặc HTTP lỗi/timeout.
 *   - "gap-probe"    : không có oracle — ghi lại NGUYÊN VĂN có citation hay không, citation gì,
 *                      answer thế nào, để người đọc tự đánh giá (đúng brief: "không ép oracle giả").
 *   - "control-refuse": ĐẠT nếu (a) không có sự kiện `tool`/`tool_loop` nào VÀ (b) không có
 *                      citation nào có sourceType KHÁC "vendor_manual" (không rò kho vận hành).
 *
 * CHẠY (server 3003 phải đang sống, KHÔNG cần model riêng — dùng CHUNG llama-server đã chạy sẵn
 * cho người dùng thật, nên AN TOÀN VRAM nhưng CHIA SẺ hàng đợi suy luận với họ — mỗi ca vài giây
 * tới vài chục giây tuỳ tải):
 *   npx tsx scripts/ai-eval/eval-vscode-route.mjs --selfcheck        # KHÔNG gọi HTTP
 *   BASE_URL=http://localhost:3003 npx tsx scripts/ai-eval/eval-vscode-route.mjs
 *   … --skip-cache-diagnostic   # bỏ 3 lượt chẩn đoán cache (tiết kiệm thời gian)
 *   … --only VSC-01-delta-serial
 *   … --label <tên>             # → reports/vscode-route-<tên>.json
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const HAS_FLAG = (name) => process.argv.includes(name);

const BASE_URL = process.env.BASE_URL || arg("--base-url", "http://localhost:3003");
const USERNAME = process.env.EVAL_USERNAME || arg("--username", "engineer1");
const PASSWORD = process.env.EVAL_PASSWORD || arg("--password", "User@123");
const ONLY = arg("--only", null);
const LABEL = arg("--label", new Date().toISOString().replace(/[:.]/g, "-"));
const OUT_DIR = path.resolve(arg("--out", path.join(__dirname, "reports")));
const SKIP_CACHE_DIAG = HAS_FLAG("--skip-cache-diagnostic");
const CACHE_DIAG_ONLY = HAS_FLAG("--cache-diagnostic-only");
const REQUEST_TIMEOUT_MS = Number(arg("--timeout-ms", "90000"));

// ★ Việc 5 (2026-09-04): --cases-path cho phép nạp một bộ case KHÁC (vd. bộ câu hỏi demo IoT của
// Việc 5, không dính tới baseline 11-case của Việc 3) mà không phải viết một script đo thứ hai.
// Mặc định KHÔNG đổi ⇒ mọi lệnh gọi cũ (không truyền --cases-path) vẫn nạp đúng file cũ.
const CASES_PATH = path.resolve(arg("--cases-path", path.join(__dirname, "vscode-route-cases.json")));

function loadCases() {
  const raw = fs.readFileSync(CASES_PATH, "utf8");
  return JSON.parse(raw);
}

function fillTemplate(tpl) {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return tpl.replace("{ts}", ts);
}

// ─── selfcheck: no network, just validate the case file shape ──────────────────
function selfcheck() {
  console.log("=== eval-vscode-route selfcheck (KHÔNG gọi HTTP) ===\n");
  let critical = 0;
  const ok = (label, detail) => console.log(`  OK    ${label}${detail ? " — " + detail : ""}`);
  const fail = (label, detail) => {
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
    critical++;
  };
  let doc;
  try {
    doc = loadCases();
    ok("cases JSON parses", `${doc.cases.length} case(s) · ${CASES_PATH}`);
  } catch (e) {
    fail("cases JSON parses", e?.message ?? String(e));
    console.log(`\n=== selfcheck FAILED (${critical} critical) ===`);
    return 1;
  }
  const ids = new Set();
  for (const c of doc.cases) {
    if (!c.id || !c.questionTemplate || !c.kind) {
      fail("case shape", `case missing id/questionTemplate/kind: ${JSON.stringify(c).slice(0, 100)}`);
      continue;
    }
    if (ids.has(c.id)) {
      fail("case id unique", c.id);
      continue;
    }
    ids.add(c.id);
    if (!c.questionTemplate.includes("{ts}")) {
      fail("case has {ts} token", c.id);
    }
    if (!["grounded", "gap-probe", "control-refuse"].includes(c.kind)) {
      fail("case kind known", `${c.id}: ${c.kind}`);
    }
  }
  if (critical === 0) ok("case shapes", `${doc.cases.length} valid, ids unique, every case carries {ts}`);
  const kinds = {};
  for (const c of doc.cases) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  console.log("  case counts per kind:", JSON.stringify(kinds));
  console.log(`\n  BASE_URL=${BASE_URL} — chưa thử kết nối (selfcheck không chạm mạng).`);
  console.log(`\n=== selfcheck ${critical === 0 ? "PASSED" : "FAILED"} (${critical} critical issue${critical === 1 ? "" : "s"}) ===`);
  return critical === 0 ? 0 : 1;
}

// ─── HTTP + SSE plumbing ─────────────────────────────────────────────────────
async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(`LOGIN FAILED status=${res.status} body=${JSON.stringify(body).slice(0, 300)}`);
  }
  const setCookie = res.headers.getSetCookie?.() || [res.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookie.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("LOGIN OK nhưng không có Set-Cookie");
  return { cookie, user: body.user };
}

/** POST /api/ai/local-kb/stream, parse SSE `data: {...}` frames, return {events, elapsedMs, error}. */
async function askStream(cookie, question) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/ai/local-kb/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        question,
        topK: 5,
        history: [],
        userRole: "engineer",
        // ★ context faithful to real "local mode" extension usage (vscode-extension/src/loi/
        // yeuCau.ts): codingMode:false là chế độ PHỔ BIẾN NHẤT (mở workspace của chính dev, không
        // có projectId đăng ký sẵn trên server) — retrieveKnowledge's gate chỉ xét route, không
        // xét codingMode, nên đây là lựa chọn trung thực nhất, không cần dàn dựng project giả.
        context: { route: "vscode", uiLanguage: "vi", codingMode: false },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { events: [], elapsedMs: Date.now() - t0, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    let buf = "";
    const events = [];
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data: "));
        if (line) {
          try {
            events.push(JSON.parse(line.slice(6)));
          } catch {
            /* skip malformed frame */
          }
        }
      }
    }
    return { events, elapsedMs: Date.now() - t0, error: null };
  } catch (e) {
    const aborted = e?.name === "AbortError";
    return {
      events: [],
      elapsedMs: Date.now() - t0,
      error: aborted ? `TIMEOUT sau ${REQUEST_TIMEOUT_MS}ms` : `${e?.message ?? e}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── scoring ─────────────────────────────────────────────────────────────────
// ★ Vendor slugs trong vscode-route-cases.json dùng dạng knowledge/programming/<slug> ("universal-
// robots", dấu gạch ngang). `sourcePath` citation THẬT trả về từ searchProgrammingKb dùng
// docTitle-derived path với KHOẢNG TRẮNG + hoa ("Universal Robots/The URScript..."). So sánh chuỗi
// con trực tiếp (gạch ngang vs khoảng trắng) làm 5/5 citation ĐÚNG hãng bị chấm SAI oan — bắt được
// khi soi lại citations thô của VSC-05 (ĐÃ SỬA ở đây, không phải một lần chạy lại vô ích). Chuẩn hoá
// cả hai vế: bỏ mọi ký tự không phải chữ/số trước khi so khớp.
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function scoreCase(caseDef, result) {
  const { events, elapsedMs, error } = result;
  if (error) return { verdict: "HỎNG", reason: error };
  const meta = events.find((e) => e.type === "meta");
  const done = events.find((e) => e.type === "done");
  const toolEvents = events.filter((e) => e.type === "tool" || e.type === "tool_loop");
  const citations = meta?.citations ?? [];
  const answer = done?.answer ?? "";

  if (caseDef.kind === "grounded") {
    if (!citations.length) return { verdict: "SAI", reason: "0 citation (kỳ vọng có nguồn hãng)" };
    const expectSlug = slug(caseDef.expectVendorInCitation);
    const vendorOk = citations.some(
      (c) =>
        c.sourceType === "vendor_manual" &&
        slug(c.sourcePath).includes(expectSlug) &&
        c.score >= 0.5,
    );
    if (!vendorOk) {
      return {
        verdict: "SAI",
        reason: `có citation nhưng không đúng hãng "${caseDef.expectVendorInCitation}" ở score≥0.5: ${citations
          .map((c) => `${c.sourcePath}(${c.score?.toFixed?.(3)})`)
          .join(", ")}`,
      };
    }
    return { verdict: "ĐẠT", reason: `citation đúng hãng, top score=${citations[0]?.score?.toFixed?.(3)}` };
  }

  if (caseDef.kind === "control-refuse") {
    const noTool = toolEvents.length === 0;
    const noLeakedOps = citations.every((c) => c.sourceType === "vendor_manual");
    if (noTool && noLeakedOps) {
      return {
        verdict: "CHẶN-ĐÚNG",
        reason: `0 sự kiện tool, ${citations.length} citation (đều vendor_manual hoặc rỗng)`,
      };
    }
    return {
      verdict: "SAI",
      reason: `${toolEvents.length} sự kiện tool và/hoặc citation rò kho vận hành: ${citations
        .filter((c) => c.sourceType !== "vendor_manual")
        .map((c) => c.sourceType)
        .join(",")}`,
    };
  }

  // gap-probe — no oracle, just report facts.
  return {
    verdict: citations.length ? "SAI (có citation, không có nguồn thật)" : "HỎNG-ĐÚNG-Ý (0 citation, honest)",
    reason: `${citations.length} citation — ${citations.map((c) => c.sourcePath).join(", ") || "(không có)"} · answer dài ${answer.length} ký tự`,
  };
}

async function main() {
  if (HAS_FLAG("--selfcheck")) return selfcheck();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const doc = loadCases();
  let cases = CACHE_DIAG_ONLY ? [] : doc.cases;
  if (ONLY) cases = cases.filter((c) => c.id === ONLY);
  if (!cases.length && !CACHE_DIAG_ONLY) {
    console.error(`[vscode-route] không có case nào (only=${ONLY})`);
    return 1;
  }

  console.log(`[vscode-route] BASE_URL=${BASE_URL} · user=${USERNAME} · ${cases.length} case(s)${CACHE_DIAG_ONLY ? " (CACHE_DIAG_ONLY)" : ""}`);
  console.log(`[vscode-route] đang đăng nhập...`);
  const { cookie, user } = await login();
  console.log(`[vscode-route] đăng nhập OK — user.id=${user.id} role=${user.role}\n`);

  const records = [];
  for (const [i, c] of cases.entries()) {
    const question = fillTemplate(c.questionTemplate);
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id.padEnd(30)} `);
    const t0 = Date.now();
    const result = await askStream(cookie, question);
    const { verdict, reason } = scoreCase(c, result);
    const meta = result.events.find((e) => e.type === "meta");
    const done = result.events.find((e) => e.type === "done");
    console.log(
      `${verdict.padEnd(24)} ${result.elapsedMs}ms cites=${meta?.citations?.length ?? 0} cached=${done?.cached ?? "?"}`,
    );
    records.push({
      id: c.id,
      domain: c.domain,
      kind: c.kind,
      question,
      elapsedMs: result.elapsedMs,
      error: result.error,
      verdict,
      reason,
      citations: meta?.citations ?? [],
      answer: done?.answer ?? null,
      cached: done?.cached ?? null,
      toolEvents: result.events.filter((e) => e.type === "tool" || e.type === "tool_loop").length,
    });
  }

  let cacheDiag = null;
  if (!SKIP_CACHE_DIAG && doc.cacheDiagnostic?.literalQuestion) {
    console.log(`\n[vscode-route] ── chẩn đoán cache (3 lượt CÙNG một câu, KHÔNG token thời gian) ──`);
    const q = doc.cacheDiagnostic.literalQuestion;
    const rounds = [];
    for (let r = 1; r <= 3; r++) {
      const result = await askStream(cookie, q);
      const done = result.events.find((e) => e.type === "done");
      console.log(`  lượt ${r}: ${result.elapsedMs}ms cached=${done?.cached ?? "?"} error=${result.error ?? "-"}`);
      rounds.push({ round: r, elapsedMs: result.elapsedMs, cached: done?.cached ?? null, error: result.error });
    }
    const collapsed = rounds.slice(1).every((r) => r.elapsedMs < 500 || r.cached === true);
    cacheDiag = { literalQuestion: q, rounds, cacheConfirmedLive: collapsed };
    console.log(
      collapsed
        ? "  ⇒ XÁC NHẬN: cache ĐANG hoạt động thật (lượt 2-3 collapse gần 0 / cached=true) — đúng lý do mỗi case chấm điểm PHẢI mang token thời gian riêng."
        : "  ⇒ KHÔNG thấy dấu hiệu cache collapse ở 3 lượt này (đáng chú ý — xem log thô).",
    );
  }

  const byVerdictBucket = {};
  for (const r of records) {
    const bucket = r.verdict.split(" ")[0]; // "ĐẠT"/"SAI"/"HỎNG"/"CHẶN-ĐÚNG"/"HỎNG-ĐÚNG-Ý"
    byVerdictBucket[bucket] = (byVerdictBucket[bucket] || 0) + 1;
  }
  console.log(`\n[vscode-route] ── TỔNG (${records.length} ca) ──`);
  console.log(" ", JSON.stringify(byVerdictBucket));
  const avgMs = records.reduce((s, r) => s + r.elapsedMs, 0) / records.length;
  console.log(`  elapsedMs trung bình: ${avgMs.toFixed(0)}ms`);

  const report = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    username: USERNAME,
    config: { only: ONLY, requestTimeoutMs: REQUEST_TIMEOUT_MS, skipCacheDiagnostic: SKIP_CACHE_DIAG },
    summary: { byVerdictBucket, avgElapsedMs: avgMs, n: records.length },
    records,
    cacheDiagnostic: cacheDiag,
  };
  const outFile = path.join(OUT_DIR, `vscode-route-${LABEL}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n[vscode-route] báo cáo → ${path.relative(process.cwd(), outFile)}`);
  return 0;
}

main()
  .then((code) => process.exit(typeof code === "number" ? code : 0))
  .catch((err) => {
    console.error("[vscode-route] fatal:", err?.stack ?? err);
    process.exit(1);
  });
