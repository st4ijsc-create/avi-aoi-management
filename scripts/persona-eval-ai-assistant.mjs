/**
 * Persona-based evaluation of the Smart Assistant ("Trợ lý thông minh").
 *
 * Roleplays 6 user personas at different skill/role levels and asks the
 * `/api/ai/local-kb/ask` endpoint a representative set of Vietnamese
 * questions. Captures: intent, language, confidence, tool used, citations
 * count, latency, and the answer body.
 *
 * Output: JSON file `AI_ASSISTANT_PERSONA_EVAL_RESULTS.json` and a compact
 * Markdown summary `AI_ASSISTANT_PERSONA_EVAL_RESULTS.md` at repo root.
 *
 * Usage: node scripts/persona-eval-ai-assistant.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.argv[2] || "http://localhost:3000";

// ─── Personas ──────────────────────────────────────────────────────────────
// userRole maps to backend's `UserRole` enum: worker | engineer | manager | it_admin
const PERSONAS = [
  {
    id: "P1_operator_new",
    name: "Công nhân vận hành (mới vào nghề)",
    userRole: "worker",
    level: "basic",
    description:
      "Mới được giao chạy máy AOI, chưa thuộc giao diện, hỏi cách thao tác cơ bản.",
    questions: [
      "Làm sao để vào màn hình kiểm tra sản phẩm?",
      "Tôi thấy máy báo NG, phải làm gì tiếp theo?",
      "Cách đổi ca làm việc trong hệ thống?",
      "Hôm nay máy của tôi đã kiểm tra được bao nhiêu sản phẩm?",
      "Tôi quên mật khẩu, làm sao đăng nhập lại?",
    ],
  },
  {
    id: "P2_operator_exp",
    name: "Công nhân vận hành (kinh nghiệm)",
    userRole: "worker",
    level: "basic",
    description:
      "Đã thành thạo thao tác, quan tâm tới sản lượng / lỗi / lô đang chạy.",
    questions: [
      "Trạng thái lô L20260505-001 thế nào?",
      "Máy nào đang offline?",
      "Top 5 lỗi nhiều nhất tuần này",
      "Xu hướng lỗi 7 ngày qua",
      "Lô của tôi sắp xong chưa?",
    ],
  },
  {
    id: "P3_qa_engineer",
    name: "Kỹ sư QA / Quy trình",
    userRole: "engineer",
    level: "technical",
    description:
      "Cấu hình sản phẩm, điểm đo, ngưỡng, phân tích nguyên nhân lỗi (RCA).",
    questions: [
      "Hướng dẫn cài điểm đo cho sản phẩm",
      "Cách tạo sản phẩm mới và liên kết với lệnh sản xuất?",
      "Các tham số cấu hình của một measurement point gồm những gì?",
      "Cho ví dụ cấu hình một điểm đo dạng vòng tròn (ring) với fiducial",
      "Cách phân tích Pareto cho NG theo điểm đo trong tháng?",
      "SPC trong hệ thống dùng công thức nào để tính UCL/LCL?",
      "có bao nhiêu Rules cho SPC",
      "liệt kê các luật Nelson SPC",
    ],
  },
  {
    id: "P4_production_mgr",
    name: "Quản lý sản xuất",
    userRole: "manager",
    level: "manager",
    description:
      "Theo dõi KPI, OEE, sản lượng, tỉ lệ NG cấp công ty / nhà máy / dây chuyền.",
    questions: [
      "Hôm nay sản lượng toàn công ty thế nào?",
      "Tỉ lệ NG tháng này so với tháng trước?",
      "Nhà máy nào có hiệu suất tốt nhất tuần này?",
      "OEE của dây chuyền A đang là bao nhiêu?",
      "Xuất báo cáo điều hành tuần qua dạng PDF được không?",
    ],
  },
  {
    id: "P5_ai_engineer",
    name: "Kỹ sư AI / Vision",
    userRole: "engineer",
    level: "technical",
    description:
      "Triển khai mô hình AI, đánh giá hiệu năng, drift, A/B testing.",
    questions: [
      "Cách triển khai một mô hình AI mới lên edge device?",
      "Confusion matrix của mô hình hiện tại ra sao?",
      "Hệ thống có phát hiện model drift không, theo metric nào?",
      "Cách chạy A/B testing giữa hai phiên bản model?",
      "Active learning trong hệ thống hoạt động thế nào?",
    ],
  },
  {
    id: "P6_it_admin",
    name: "Quản trị hệ thống (IT Admin)",
    userRole: "it_admin",
    level: "technical",
    description:
      "Quản lý người dùng, phân quyền, tích hợp MQTT/SSO, vận hành hệ thống.",
    questions: [
      "Cách phân quyền cho một role mới?",
      "MQTT broker chạy ở port nào và config ở đâu?",
      "Cách tích hợp SSO / OAuth với hệ thống?",
      "Backup database định kỳ ở đâu?",
      "Cách bật/tắt license bypass cho môi trường dev?",
    ],
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(`LOGIN failed: status=${res.status} body=${JSON.stringify(body).slice(0, 300)}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookie.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("No session cookie returned");
  return cookie;
}

async function ask(cookie, persona, question) {
  const t0 = Date.now();
  const maxAttempts = 3;
  let res = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(`${BASE}/api/ai/local-kb/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          question,
          topK: 5,
          userRole: persona.userRole,
          history: [],
        }),
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  const ms = Date.now() - t0;
  if (!res) {
    return {
      persona: persona.id,
      personaName: persona.name,
      userRole: persona.userRole,
      level: persona.level,
      question,
      httpStatus: 0,
      success: false,
      error: `fetch failed after ${maxAttempts} attempts: ${lastErr?.message ?? lastErr}`,
      latencyMs: ms,
      intent: null,
      language: null,
      confidence: null,
      provider: null,
      cached: null,
      toolName: null,
      toolNote: null,
      toolSummary: null,
      citationsCount: 0,
      topCitations: [],
      answerLength: 0,
      answer: "",
    };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { success: false, error: "non-json response" };
  }
  const d = body?.data || {};
  const answer = d.answer || d.text || "";
  return {
    persona: persona.id,
    personaName: persona.name,
    userRole: persona.userRole,
    level: persona.level,
    question,
    httpStatus: res.status,
    success: !!body?.success,
    error: body?.error ?? null,
    latencyMs: ms,
    intent: d.intent ?? null,
    language: d.language ?? null,
    confidence: typeof d.confidence === "number" ? Number(d.confidence.toFixed(3)) : d.confidence ?? null,
    provider: d.provider ?? null,
    cached: d.cached ?? null,
    toolName: d.toolName ?? d.toolResult?.tool ?? null,
    toolNote: d.toolResult?.note ?? null,
    toolSummary: d.toolResult?.textSummary || d.toolResult?.summary || null,
    citationsCount: Array.isArray(d.citations) ? d.citations.length : 0,
    topCitations: Array.isArray(d.citations)
      ? d.citations.slice(0, 3).map((c) => ({
          score: typeof c.score === "number" ? Number(c.score.toFixed(3)) : c.score,
          src: `${c.sourceType ?? "?"}/${c.sourcePath ?? "?"}`,
          title: c.title ?? null,
        }))
      : [],
    answerLength: answer.length,
    answer,
  };
}

// ─── Heuristic scoring rubric (auto, lightweight) ──────────────────────────
function scoreAnswer(rec) {
  const a = (rec.answer || "").toLowerCase();
  const len = rec.answerLength || 0;
  const score = {
    nonEmpty: len > 30 ? 1 : 0,
    grounded: rec.citationsCount > 0 || !!rec.toolName ? 1 : 0,
    toolWhenLive: 0, // set per-question if the question expects a tool
    hasSteps: /(\n\s*\d+[\.\)]|\n\s*[-•])/.test(rec.answer || "") ? 1 : 0,
    hasNavPath: /(menu|sidebar|màn hình|trang|menu trái|sidebar trái|đường dẫn|navigate|url|\/[a-z\-]+)/i.test(rec.answer || "") ? 1 : 0,
    notHallucinated: /(không có|không tìm thấy|chưa có thông tin)/.test(a) && rec.citationsCount === 0 ? 1 : (rec.citationsCount > 0 ? 1 : 0),
    fastEnough: rec.latencyMs <= 8000 ? 1 : 0,
  };
  // expected tool detection
  const liveTriggers = /(hôm nay|sản lượng|máy nào|offline|lô\s+l\d|trạng thái lô|top \d+ lỗi|xu hướng lỗi|tỉ lệ ng|tỷ lệ ng)/i;
  if (liveTriggers.test(rec.question)) {
    score.toolWhenLive = rec.toolName ? 1 : 0;
  } else {
    delete score.toolWhenLive;
  }
  // Stage 12.C — content-specific assertions for SPC rules regression net.
  // Catches the failure class observed pre-Stage-12.A (no rule names, no count).
  const q = rec.question || "";
  const ansText = rec.answer || "";
  if (/có bao nhiêu Rules cho SPC/i.test(q)) {
    const hasCount = /\b(12|13)\b/.test(ansText);
    const hasWE = /WE_[1-4]|Western Electric/i.test(ansText);
    const hasNelson = /NELSON_[1-8]|Nelson/i.test(ansText);
    score.contentSpecific = (hasCount && hasWE && hasNelson) ? 1 : 0;
  } else if (/liệt kê các luật Nelson SPC/i.test(q)) {
    score.contentSpecific = /NELSON_8|Nelson 8/i.test(ansText) ? 1 : 0;
  }
  const total = Object.values(score).reduce((a, b) => a + b, 0);
  const max = Object.keys(score).length;
  return { ...score, _total: total, _max: max, _pct: Math.round((total / max) * 100) };
}

// ─── Depth scoring rubric (Phase 5) ────────────────────────────────────────
// Five criteria, each 0..1, averaged into `total` (0..1).
// Designed for VN procedural answers grounded on knowledge/features/*.md.
function scoreDepth(rec) {
  const ans = rec.answer || "";
  const a = ans.toLowerCase();
  const len = ans.length;

  // 1) Procedural completeness — section headers + ordered steps
  const headerCount = (ans.match(/^#{2,3}\s+\S/gm) || []).length;
  const numberedSteps = (ans.match(/^\s*(?:\d+[\.\)]|bước\s*\d+|step\s*\d+)\s+\S/gim) || []).length;
  const bulletSteps = (ans.match(/^\s*[-*•]\s+\S/gm) || []).length;
  let procedural = 0;
  if (numberedSteps >= 3) procedural = 1;
  else if (numberedSteps >= 2 || (bulletSteps >= 4 && headerCount >= 1)) procedural = 0.7;
  else if (bulletSteps >= 2 || headerCount >= 1) procedural = 0.4;
  else if (len > 200) procedural = 0.2;

  // 2) Role accuracy — answer aligns with persona's role context
  const role = (rec.userRole || "").toLowerCase();
  const roleVocab = {
    worker: /(công nhân|vận hành|operator|ca làm|tổ trưởng|nhập liệu|máy đang)/i,
    engineer: /(kỹ sư|engineer|model|mô hình|thuật toán|drift|confusion|threshold|calib|cấu hình thiết bị)/i,
    manager: /(quản lý|manager|báo cáo|kpi|oee|sản lượng|dashboard|điều hành|tuần|tháng)/i,
    it_admin: /(it_admin|quản trị|phân quyền|role|permission|sso|oauth|mqtt|backup|license|database|server)/i,
  };
  const hits = roleVocab[role] ? (ans.match(roleVocab[role]) || []).length : 0;
  // Citation source weight: feature/domain MDs are role-aware authored docs.
  const featureCite = (rec.topCitations || []).some((c) => /^feature\//.test(c.src || ""));
  const domainCite = (rec.topCitations || []).some((c) => /^domain\//.test(c.src || ""));
  let roleAccuracy = 0;
  if (hits >= 2 && (featureCite || domainCite)) roleAccuracy = 1;
  else if (hits >= 1 && (featureCite || domainCite)) roleAccuracy = 0.8;
  else if (featureCite || domainCite) roleAccuracy = 0.6;
  else if (hits >= 1) roleAccuracy = 0.4;
  else if (rec.citationsCount > 0) roleAccuracy = 0.2;

  // 3) Error / troubleshooting coverage
  const errorTerms = /(lỗi|error|troubleshoot|khắc phục|xử lý sự cố|cảnh báo|alert|warning|nếu .* (?:không|fail|lỗi)|trong trường hợp|fallback|rollback)/i;
  const errorCount = (ans.match(new RegExp(errorTerms.source, "gi")) || []).length;
  let errorCoverage = 0;
  if (errorCount >= 3) errorCoverage = 1;
  else if (errorCount === 2) errorCoverage = 0.7;
  else if (errorCount === 1) errorCoverage = 0.4;

  // 4) API / endpoint / config references
  const apiPatterns = [
    /\/api\/[a-z0-9_\-\/]+/gi,
    /\b(GET|POST|PUT|DELETE|PATCH)\s+\/[a-z0-9_\-\/]+/gi,
    /`[A-Z_][A-Z0-9_]{3,}=/g, // ENV var inside backticks
    /`[a-z][a-zA-Z0-9_]*\s*\(/g, // function call inside backticks
    /(port|cổng)\s*\d{2,5}/gi,
    /\b\d{2,5}\s*\/\s*(tcp|udp|mqtt|http|ws)\b/gi,
  ];
  let apiHits = 0;
  for (const re of apiPatterns) apiHits += (ans.match(re) || []).length;
  let apiRefs = 0;
  if (apiHits >= 3) apiRefs = 1;
  else if (apiHits === 2) apiRefs = 0.7;
  else if (apiHits === 1) apiRefs = 0.4;

  // 5) Examples — code fences, "ví dụ", concrete values
  const codeFences = (ans.match(/```/g) || []).length;
  const exampleMentions = (ans.match(/(ví dụ|example|chẳng hạn|e\.g\.|i\.e\.)/gi) || []).length;
  const screenPath = (ans.match(/\/[a-z][a-z0-9\-]+(?:\/[a-z0-9\-:]+)+/gi) || []).length;
  let examples = 0;
  if (codeFences >= 2 || (exampleMentions >= 1 && codeFences >= 2)) examples = 1;
  else if (codeFences >= 2 || exampleMentions >= 2 || (codeFences >= 1 && screenPath >= 1)) examples = 0.7;
  else if (codeFences >= 1 || exampleMentions >= 1 || screenPath >= 2) examples = 0.4;
  else if (screenPath >= 1) examples = 0.2;

  const round2 = (n) => Math.round(n * 100) / 100;
  const parts = { procedural, roleAccuracy, errorCoverage, apiRefs, examples };
  const total = round2(
    (procedural + roleAccuracy + errorCoverage + apiRefs + examples) / 5,
  );
  return {
    procedural: round2(procedural),
    roleAccuracy: round2(roleAccuracy),
    errorCoverage: round2(errorCoverage),
    apiRefs: round2(apiRefs),
    examples: round2(examples),
    total,
    _signals: {
      headerCount,
      numberedSteps,
      bulletSteps,
      roleVocabHits: hits,
      featureCite,
      domainCite,
      errorCount,
      apiHits,
      codeFences,
      exampleMentions,
      screenPath,
    },
  };
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

// ─── Run ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[eval] base=${BASE}`);
  const cookie = await login();
  console.log("[eval] logged in");

  const all = [];
  const snapshotPath = path.join(process.cwd(), "AI_ASSISTANT_PERSONA_EVAL_RESULTS.partial.json");
  for (const persona of PERSONAS) {
    console.log(`\n[eval] === ${persona.id} :: ${persona.name} (${persona.userRole}/${persona.level}) ===`);
    for (const q of persona.questions) {
      process.stdout.write(`  Q: ${q.slice(0, 70)}${q.length > 70 ? "…" : ""} ... `);
      try {
        const rec = await ask(cookie, persona, q);
        rec.score = scoreAnswer(rec);
        rec.depth = scoreDepth(rec);
        all.push(rec);
        console.log(
          `[${rec.latencyMs}ms intent=${rec.intent} tool=${rec.toolName ?? "-"} cit=${rec.citationsCount} score=${rec.score._pct}% depth=${rec.depth.total}]`,
        );
      } catch (e) {
        console.log(`ERROR ${e.message}`);
        all.push({
          persona: persona.id,
          personaName: persona.name,
          userRole: persona.userRole,
          level: persona.level,
          question: q,
          error: e.message,
          score: { _total: 0, _max: 1, _pct: 0 },
          depth: { total: 0 },
        });
      }
    }
    // Incremental snapshot after each persona so we don't lose progress on crash.
    try {
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({ baseUrl: BASE, runAt: new Date().toISOString(), partial: true, results: all }, null, 2),
        "utf8",
      );
    } catch {}
  }

  // Persist results
  const outDir = process.cwd();
  const jsonPath = path.join(outDir, "AI_ASSISTANT_PERSONA_EVAL_RESULTS.json");
  // (Aggregation happens below; we re-write JSON after computing it.)

  // Quick aggregation per persona
  const byPersona = {};
  for (const r of all) {
    const p = r.persona;
    if (!byPersona[p]) byPersona[p] = { name: r.personaName, role: r.userRole, level: r.level, count: 0, sumPct: 0, sumDepth: 0, depthGteThreshold: 0, toolUsed: 0, citationOnly: 0, empty: 0, latencies: [] };
    const agg = byPersona[p];
    agg.count++;
    agg.sumPct += r.score?._pct ?? 0;
    const depthTotal = r.depth?.total ?? 0;
    agg.sumDepth += depthTotal;
    if (depthTotal >= 0.75) agg.depthGteThreshold++;
    if (r.toolName) agg.toolUsed++;
    if (!r.toolName && (r.citationsCount ?? 0) > 0) agg.citationOnly++;
    if ((r.answerLength ?? 0) < 30) agg.empty++;
    if (typeof r.latencyMs === "number") agg.latencies.push(r.latencyMs);
  }

  // Overall aggregates
  const allLatencies = all
    .map((r) => r.latencyMs)
    .filter((n) => typeof n === "number")
    .sort((a, b) => a - b);
  const overallP95 = percentile(allLatencies, 95);
  const overallP50 = percentile(allLatencies, 50);
  const overallPassRate = all.length
    ? Math.round((all.filter((r) => (r.score?._pct ?? 0) >= 70).length / all.length) * 100)
    : 0;
  const personaDepthAvgs = Object.values(byPersona).map(
    (a) => a.sumDepth / Math.max(1, a.count),
  );
  const personasWithDepth075 = personaDepthAvgs.filter((d) => d >= 0.75).length;
  const personasTotal = personaDepthAvgs.length;
  const overallDepthAvg = personaDepthAvgs.length
    ? Math.round(
        (personaDepthAvgs.reduce((a, b) => a + b, 0) / personaDepthAvgs.length) * 100,
      ) / 100
    : 0;

  const md = [];
  md.push("# AI Assistant — Persona Evaluation Results");
  md.push("");
  md.push(`Run at: ${new Date().toISOString()}`);
  md.push(`Endpoint: \`${BASE}/api/ai/local-kb/ask\``);
  md.push("");
  md.push("## Overall");
  md.push("");
  md.push(`- Pass rate (score ≥ 70%): **${overallPassRate}%** (${all.filter((r) => (r.score?._pct ?? 0) >= 70).length}/${all.length})`);
  md.push(`- Latency p50/p95: **${overallP50}ms / ${overallP95}ms** (target p95 ≤ 11000)`);
  md.push(`- Avg depth (mean of persona means): **${overallDepthAvg}**`);
  md.push(`- Personas with avg depth ≥ 0.75: **${personasWithDepth075}/${personasTotal}** (target ≥ ${Math.ceil(personasTotal * 0.9)})`);
  md.push("");
  md.push("## Summary by Persona");
  md.push("");
  md.push("| Persona | Role/Level | Avg score | Avg depth | Depth≥0.75 | Tool used | Citation-only | Empty | Avg latency (ms) | p95 latency (ms) |");
  md.push("|---------|------------|-----------|-----------|------------|-----------|---------------|-------|-------------------|--------------------|");
  for (const [pid, agg] of Object.entries(byPersona)) {
    const avgPct = Math.round(agg.sumPct / agg.count);
    const avgDepth = Math.round((agg.sumDepth / agg.count) * 100) / 100;
    const sortedLat = [...agg.latencies].sort((a, b) => a - b);
    const avgLat = sortedLat.length ? Math.round(sortedLat.reduce((a, b) => a + b, 0) / sortedLat.length) : 0;
    const p95Lat = percentile(sortedLat, 95);
    md.push(`| ${pid} — ${agg.name} | ${agg.role}/${agg.level} | ${avgPct}% | ${avgDepth} | ${agg.depthGteThreshold}/${agg.count} | ${agg.toolUsed}/${agg.count} | ${agg.citationOnly}/${agg.count} | ${agg.empty}/${agg.count} | ${avgLat} | ${p95Lat} |`);
  }
  md.push("");
  md.push("## Per-question detail");
  md.push("");
  for (const r of all) {
    md.push(`### [${r.persona}] ${r.question}`);
    md.push("");
    md.push(`- intent=\`${r.intent ?? "-"}\` lang=\`${r.language ?? "-"}\` provider=\`${r.provider ?? "-"}\` tool=\`${r.toolName ?? "-"}\` toolNote=\`${r.toolNote ?? "-"}\` cit=${r.citationsCount ?? 0} latency=${r.latencyMs ?? "-"}ms score=**${r.score?._pct ?? 0}%** depth=**${r.depth?.total ?? 0}**`);
    if (r.depth) {
      md.push(`- depth breakdown: procedural=${r.depth.procedural}, role=${r.depth.roleAccuracy}, error=${r.depth.errorCoverage}, api=${r.depth.apiRefs}, examples=${r.depth.examples}`);
    }
    if (r.topCitations && r.topCitations.length) {
      md.push(`- citations: ${r.topCitations.map((c) => `${c.src} (${c.score})`).join(", ")}`);
    }
    if (r.toolSummary) md.push(`- toolSummary: ${r.toolSummary.slice(0, 200)}`);
    md.push("");
    md.push("```");
    md.push((r.answer || r.error || "(empty)").slice(0, 1200));
    md.push("```");
    md.push("");
  }
  const mdPath = path.join(outDir, "AI_ASSISTANT_PERSONA_EVAL_RESULTS.md");
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");
  console.log(`[eval] wrote ${mdPath}`);

  // Final JSON with aggregates
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        baseUrl: BASE,
        runAt: new Date().toISOString(),
        overall: {
          passRatePct: overallPassRate,
          latencyP50Ms: overallP50,
          latencyP95Ms: overallP95,
          avgDepth: overallDepthAvg,
          personasWithDepth075,
          personasTotal,
          targets: { passRatePct: 95, latencyP95Ms: 11000, depth: 0.75, depthPersonaCoveragePct: 90 },
        },
        byPersona,
        results: all,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[eval] wrote ${jsonPath}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
