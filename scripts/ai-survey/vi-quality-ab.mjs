#!/usr/bin/env node
/**
 * scripts/ai-survey/vi-quality-ab.mjs — Đợt 0 Task 4 (Đ2): A/B chất lượng tiếng Việt
 * giữa 2 model 30B ứng viên thường trú, trên 4 PROMPT THẬT lấy từ đường chạy sản xuất.
 *
 * CÂU HỎI: nếu bỏ model general (Qwen3-30B-A3B-Instruct) để lấy chỗ cho model chuyên
 * code (Qwen3-Coder-30B-A3B-Instruct), câu tiếng Việt hiện cho người vận hành có tệ đi
 * không? Script này CHỈ SINH VÀ TRÌNH BÀY cặp câu trả lời cạnh nhau — KHÔNG CHẤM, KHÔNG
 * KẾT LUẬN model nào hay hơn. Đó là việc của chủ dự án (xem ràng buộc trong brief task-4).
 *
 * NGUỒN 4 PROMPT (trích/tái dựng từ mã sản xuất — xem NOTE trong từng prompt bên dưới
 * để biết phần nào là verbatim, phần nào phải tái dựng vì hàm gốc không export):
 *   P1 RCA              — server/services/aiRcaCopilot.ts:500-513  (hàm synthesize())
 *   P2 Báo cáo điều hành — server/services/aiExecutiveReport.ts:318-342 (buildSystemPrompt/buildUserPrompt)
 *   P3 (thay "cố vấn ngưỡng" — KHÔNG dùng LLM, xem NOTE) — server/services/aiReportGenerator.ts:556-560
 *   P4 Trợ lý tri thức   — server/services/aiLocalKnowledgeService.ts:1136-1166 (generateWithOllama)
 *
 * PHƯƠNG PHÁP (bắt buộc theo brief Đợt 0 — KHÔNG khởi động app, tránh race điều kiện
 * double-warm mà Task 2 phát hiện ở backgroundJobs.ts/aiLocalKnowledgeApi.ts):
 *   - Import THẲNG các hàm production (loadGgufModel/unloadGgufModel/generateText từ
 *     aiGgufEngine.ts; gatherKpis từ aiExecutiveReport.ts; retrieveKnowledge từ
 *     aiLocalKnowledgeService.ts) — không boot Express, không trigger warm-up job nào.
 *   - Hai model 30B KHÔNG thể cùng cư trú (Task 3 đã xác nhận bằng đo trực tiếp) →
 *     sinh TUẦN TỰ: nạp model A → sinh hết 4 prompt → dispose → nạp model B → sinh hết
 *     4 prompt → dispose. Không giữ cả hai.
 *   - CÙNG tham số sinh cho cả 2 model, cả 4 prompt (xem GEN_PARAMS bên dưới) — khác
 *     tham số thì phép so vô nghĩa (yêu cầu brief).
 *   - Ẩn danh: nhãn "Model 1"/"Model 2" gán NGẪU NHIÊN (Math.random, không cố định thứ
 *     tự nạp = thứ tự nhãn), bảng ánh xạ THẬT ghi ra file riêng (MODEL_MAP_FILE bên
 *     dưới) — KHÔNG in ra stdout (nơi nội dung được redirect vào file chủ dự án đọc).
 *   - stdout CHỈ chứa markdown cuối cùng (ép qua process.stdout.write, không console.log)
 *     — mọi log tiến trình/nạp model của aiGgufEngine.ts (dùng console.log/warn nội bộ)
 *     bị patch sang stderr trong lúc chạy để không lẫn vào file output.
 *
 * CHẠY:
 *   npx tsx scripts/ai-survey/vi-quality-ab.mjs > docs/superpowers/reports/2026-08-01-do0-vi-ab.md
 *
 * KHÔNG sửa aiGgufEngine.ts/aiRcaCopilot.ts/aiExecutiveReport.ts/aiLocalKnowledgeService.ts/
 * aiReportGenerator.ts — chỉ IMPORT hàm production, không đổi hành vi.
 */
import "dotenv/config";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Windows: dynamic import() needs a file:// URL, not a bare "D:\..." path
// (ERR_UNSUPPORTED_ESM_URL_SCHEME otherwise).
const svc = (rel) => pathToFileURL(path.join(REPO_ROOT, "server", "services", rel)).href;

// ─── stdout must stay CLEAN markdown only — redirect all console.* noise to stderr ──
const realLog = console.log.bind(console);
console.log = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);
const out = (s) => process.stdout.write(s);

// ─── Generation params — CỐ Ý CHUẨN HOÁ, giống nhau cho MỌI (model, prompt) ────────
// temperature=0 (greedy, giống cách scripts/ai-bench/bench.mjs dùng "temperature: 0, //
// deterministic") — KHÁC với tham số production thật của từng dịch vụ (RCA/report dùng
// decision.temperature > 0, KB dùng 0.15) vì mục tiêu ở đây là cô lập BIẾN DUY NHẤT =
// model, không lẫn biến thiên ngẫu nhiên của sampling giữa 2 lượt gọi. topP=0.9 vẫn
// truyền cho đủ tham số GgufGenerateOptions nhưng là no-op khi temperature=0 (greedy
// argmax không lấy mẫu). "seed": generateText()/LlamaChatSession.prompt() hiện KHÔNG có
// tham số seed nào trong GgufGenerateOptions (server/services/aiGgufEngine.ts:59-74) —
// với temperature=0 không có lấy mẫu ngẫu nhiên nên seed không ảnh hưởng, bỏ qua hợp lý.
const GEN_PARAMS = { temperature: 0, topP: 0.9, maxTokens: 700 };
const CONTEXT_SIZE = 8192; // đủ cho prompt dài nhất (P4, ~5 chunk KB) + 700 token sinh ra

const MODEL_GENERAL = (process.env.GGUF_DEFAULT_MODEL || "Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL.gguf").trim();
const MODEL_CODER = (process.env.GGUF_CODE_MODEL || "Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf").trim();

const MODEL_MAP_FILE = path.join(
  REPO_ROOT,
  ".superpowers/sdd/2026-08-01-do0-model-roster-survey/task-4-model-map.md",
);

// ─── VRAM helper (giống scripts/ai-bench/bench.mjs) ────────────────────────────────
function readVram() {
  try {
    const outText = execFileSync(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 4000, windowsHide: true },
    ).toString().trim();
    const [used, total] = outText.split(",").map((s) => parseInt(s.trim(), 10));
    return { usedMib: used, totalMib: total };
  } catch {
    return null;
  }
}

function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── P1 — RCA (server/services/aiRcaCopilot.ts:500-513, hàm synthesize()) ──────────
// `sys` dưới đây là COPY VERBATIM (character-for-character) từ nguồn — hằng số nội bộ,
// không export. KHÔNG có nhánh tiếng Việt nào trong `sys`/`userPrompt` dù `lang` mặc
// định = "vi" (aiRcaCopilot.ts:629) — đây là PHÁT HIỆN THẬT của task này, không phải
// giản lược của tôi: xem "Ghi chú" trong báo cáo. `userPrompt` dùng ĐÚNG template thật
// (dòng 506-513: Defect type / Machine / EVIDENCE / Known write-tools / Return up to N
// hypotheses) nhưng phần EVIDENCE không gọi được `gatherEvidence()` (hàm nội bộ không
// export, cần 6 nguồn phụ: Pareto/SPC/anomaly/vision/causal-graph/corrections) — thay
// bằng dữ liệu Pareto THẬT lấy lại từ gatherKpis() (P2, cùng 1 lượt gọi DB, không truy
// vấn thêm), theo ĐÚNG định dạng dòng "Pareto top defects: ..." của buildEvidenceDigest
// (aiRcaCopilot.ts:450).
const RCA_SYS =
  "You are an SMT/AOI manufacturing root-cause analyst. Using ONLY the supplied evidence, " +
  "produce ranked hypotheses for the defect. NEVER invent evidence. If evidence is weak, " +
  "return fewer hypotheses with lower confidence. Output strictly the JSON schema. " +
  "recommendedFix.kind must be WRITE (maps to a known write-tool), MANUAL (hands-on steps), " +
  "or INVESTIGATE (more data needed). For WRITE, set tool + args only if you are confident.";
const RCA_MAX_HYPOTHESES = 3; // aiRcaCopilot.ts:33 MAX_HYPOTHESES

function buildRcaUserPrompt(kpis) {
  const defectType = kpis.topDefects[0]?.type ?? "(unspecified)";
  const machine = kpis.pdmRiskMachines[0]?.machineCode ?? "(unspecified)";
  const paretoLine = kpis.topDefects.length
    ? `Pareto top defects: ${kpis.topDefects.map((p) => `${p.type} (${p.count}, ${p.percentage.toFixed(1)}%)`).join("; ")}`
    : "(no quantitative evidence available)";
  return (
    `Defect type: ${defectType}\n` +
    `Machine: ${machine}\n\n` +
    `EVIDENCE:\n${paretoLine}\n\n` +
    `Known write-tools you may reference for a WRITE fix: adjust_ng_threshold, configure_inspection_param, ` +
    `create_ng_threshold, update_product_quality_target, set_machine_param, acknowledge_machine_alarm, ` +
    `create_maintenance_workorder.\n` +
    `Return up to ${RCA_MAX_HYPOTHESES} hypotheses ranked by confidence (0..1, descending).`
  );
}

// ─── P2 — Báo cáo điều hành (server/services/aiExecutiveReport.ts:318-342) ─────────
// `buildSystemPrompt("vi")`/`buildUserPrompt(kpis)` không export → COPY VERBATIM logic
// (2 hàm rất ngắn, không nhánh phức tạp) — `kpis` là kết quả THẬT của `gatherKpis("day",
// "vi")` (hàm CÓ export, gọi trực tiếp DB, không qua LLM) — không phải dữ liệu dựng.
const EXEC_SYS_VI =
  "Bạn là giám đốc chất lượng nhà máy AOI/AVI. Dựa trên bộ KPI THỰC được cung cấp (JSON), " +
  "hãy viết một bản tóm tắt điều hành NGẮN GỌN, sắc bén cho ban lãnh đạo bằng tiếng Việt. " +
  "Tập trung vào sản lượng, tỷ lệ đạt (FPY), xu hướng NG, các lỗi hàng đầu, và máy có rủi ro hỏng. " +
  "Chỉ dùng số liệu trong dữ liệu, không bịa. Trả lời theo đúng định dạng được yêu cầu.";
function buildExecUserPrompt(kpis) {
  return JSON.stringify({
    instruction:
      "Produce: headline (1 sentence), highlights (3-5 bullets), risks (2-4 bullets), recommendations (2-4 bullets).",
    kpis,
  });
}

// ─── P3 — thay "cố vấn ngưỡng" (KHÔNG dùng LLM — xem NOTE) ─────────────────────────
// Đã tìm trong aiThresholdAdvisor.ts, aiSetupAdvisor.ts, aiThresholdTuneScheduler.ts,
// aiCalibration.ts, aiAnomalyCalibration.ts, thresholdGovernanceService.ts,
// aiAutoProposer.ts (lệnh: grep "generateText|generateNarrative|generateJSON|
// routeInference|aiGgufEngine|aiProviderRouter" trên cả 7 file) → 0 KHỚP. Toàn bộ
// "cố vấn ngưỡng"/"setup advisor" trong hệ này là THỐNG KÊ THUẦN (suggestThresholds())
// + chuỗi đa ngôn ngữ TĨNH (hàm w(lang,vi,en,zh), không phải LLM sinh) — KHÔNG có prompt
// LLM nào để A/B. Thay bằng prompt gần nhất tìm được: `generateDailyQualitySummary()`
// (server/services/aiReportGenerator.ts:556-560) — cũng là báo cáo chất lượng tiếng
// Việt tầng "report", nhưng KHÁC code path với P2 (module/hàm khác, JSON shape khác).
// `collectInspectionStats`/`collectTopDefects` (nguồn số liệu gốc của hàm này) không
// export → tái dùng ĐÚNG con số thật từ `kpis` (P2, cùng 1 lượt gatherKpis) ghép theo
// ĐÚNG công thức/nhãn field của aiReportGenerator.ts:530-546 (period/total/ok/ng/
// yieldRate/topDefects/anomalies) — không gọi DB thêm lần nữa.
const DAILY_SYS_VI = "Bạn là chuyên gia chất lượng AOI. Viết tóm tắt báo cáo chất lượng hàng ngày bằng tiếng Việt.";
function buildDailyUserPrompt(kpis) {
  const total = kpis.totalInspections;
  const ok = kpis.okCount;
  const ng = kpis.ngCount;
  const yieldRate = kpis.fpy;
  const period = `${kpis.window.start.split("T")[0]} to ${kpis.window.end.split("T")[0]}`;
  const topDefectsFormatted = kpis.topDefects.map((d) => ({
    ...d,
    percentage: ng > 0 ? (d.count / ng) * 100 : 0, // aiReportGenerator.ts:537 (recompute vs ng, KHÁC percentage của gatherKpis)
  }));
  const anomalies = [];
  const defectRate = total > 0 ? (ng / total) * 100 : 0;
  if (defectRate > 10) anomalies.push(`High defect rate: ${defectRate.toFixed(1)}%`);
  if (topDefectsFormatted.length > 0 && topDefectsFormatted[0].percentage > 50) {
    anomalies.push(
      `Dominant defect type "${topDefectsFormatted[0].type}" accounts for ${topDefectsFormatted[0].percentage.toFixed(1)}% of all defects`,
    );
  }
  return JSON.stringify({ period, total, ok, ng, yieldRate, topDefects: topDefectsFormatted, anomalies });
}

// ─── P4 — Trợ lý tri thức (server/services/aiLocalKnowledgeService.ts:1136-1166) ───
// `getSystemPromptForRole()` (dòng 844-909, không export) → COPY VERBATIM toàn bộ hàm
// (giữ nguyên literal string, kể cả nhánh zh/en không dùng tới) để không có sai lệch khi
// gõ lại. `retrieveKnowledge()` (dòng 1593, CÓ export) gọi THẬT với 1 câu hỏi vận hành
// thật → citations/contexts là dữ liệu KB THẬT (knowledge/chunks.jsonl), không bịa.
// Prompt cuối (mảng .filter(Boolean).join("\n"), dòng 1146-1166) COPY VERBATIM cấu trúc
// nhưng BỎ 2 khối: `historyBlock` (rỗng — lượt hỏi đầu tiên, kịch bản thật hợp lệ) và
// `toolBlock` (rỗng — không có dữ liệu tool thời gian thực trong lượt test này, cũng là
// kịch bản thật hợp lệ khi câu hỏi không cần tra CSDL trực tiếp). `hintsBlock`
// (formatHintsBlock/extractKbHints, dòng 926-965) BỊ BỎ vì là logic trích xuất
// regex khá dài, không export — vượt quá phạm vi hợp lý của 1 script đo; hintsBlock
// vốn cũng thường rỗng khi ngữ cảnh không chứa API path/env var/code fence. `plan.safeText`
// (redact câu hỏi qua aiGateway) được thay bằng câu hỏi thô — không cần redact vì câu hỏi
// test không chứa bí mật/PII.
function getSystemPromptForRole(userLevel, language, intent = "general") {
  const VI_GUARD = "Chỉ dùng tài liệu được cấp; không bịa API/endpoint/biến/bảng. Không nhắc Alibaba/AWS/GCP/Azure. Thiếu dữ kiện thì nói rõ chưa có.";
  const EN_GUARD = "Use only the provided context; never invent APIs/vars/tables. Never mention Alibaba/AWS/GCP/Azure. If data missing, say so.";
  const VI_FORMAT = "Cấu trúc: (1) Tóm tắt 1–2 câu, (2) Các bước đánh số nêu *làm gì + ở đâu trong UI + kết quả*, (3) Lưu ý/lỗi thường gặp, (4) Liên quan 2 chủ đề. 200–450 từ. KHI ngữ cảnh có API/biến/lệnh, BẮT BUỘC trích lại trong backtick hoặc code-fence ```bash/```sql/```ts.";
  const EN_FORMAT = "Structure: (1) 1–2 sentence summary, (2) numbered steps with *what + where in UI + expected result*, (3) gotchas/common errors, (4) 2 related topics. 200–450 words. When context has APIs/vars/commands, you MUST quote them in backticks or code fences ```bash/```sql/```ts.";
  const VI_DEF_FORMAT = "Cấu trúc: (1) Định nghĩa ngắn gọn 1–3 câu, (2) Liệt kê thành phần/đặc điểm chính (bullet hoặc bảng), (3) Ví dụ cụ thể từ ngữ cảnh (code/giá trị/công thức nếu có), (4) 1–2 chủ đề liên quan. KHÔNG bịa đường dẫn UI/menu nếu ngữ cảnh không nói rõ. KHÔNG dùng template 'Các bước → Truy cập URL → Chọn tab' cho câu hỏi định nghĩa.";
  const EN_DEF_FORMAT = "Structure: (1) Short definition 1–3 sentences, (2) Bullet list of key components/properties, (3) Concrete example from context (code/value/formula if present), (4) 1–2 related topics. Do NOT fabricate UI paths/menus. Do NOT use the 'Steps → Open URL → Click tab' template for definition questions.";
  const VI_LIST_FORMAT = "Cấu trúc: (1) Tổng số mục được liệt kê (con số chính xác), (2) Danh sách đầy đủ dưới dạng bullet hoặc bảng (không cắt ngắn), (3) Trích nguyên văn code/giá trị từ ngữ cảnh khi có, (4) Nguồn gốc (file/đường dẫn). KHÔNG bịa số lượng. KHÔNG dùng template 'Các bước → Truy cập URL'.";
  const EN_LIST_FORMAT = "Structure: (1) Total count (exact number), (2) Full list as bullets or table (do NOT truncate), (3) Verbatim code/values from context, (4) Source (file path). Do NOT invent counts. Do NOT use the 'Steps → Open URL' template.";
  const ZH_GUARD = "仅使用所提供的资料；不得编造 API/接口/变量/数据表。不得提及 Alibaba/AWS/GCP/Azure。资料不足时请明确说明尚无数据。";
  const ZH_FORMAT = "结构：(1) 1–2 句概述，(2) 编号步骤，说明*做什么 + 在界面中的位置 + 预期结果*，(3) 注意事项/常见错误，(4) 2 个相关主题。200–450 字。当上下文包含 API/变量/命令时，必须用反引号或代码块 ```bash/```sql/```ts 原样引用。";
  const ZH_DEF_FORMAT = "结构：(1) 1–3 句简短定义，(2) 关键组成/特征的项目列表，(3) 来自上下文的具体示例（如有代码/数值/公式），(4) 1–2 个相关主题。若上下文未说明，请勿编造界面路径/菜单。定义类问题请勿使用“步骤→打开网址→点击标签”的模板。";
  const ZH_LIST_FORMAT = "结构：(1) 列出项目的总数（准确数字），(2) 完整列表（项目符号或表格，不得截断），(3) 原样引用上下文中的代码/数值，(4) 来源（文件路径）。不得编造数量。请勿使用“步骤→打开网址”的模板。";
  const isDef = intent === "definition";
  const isList = intent === "list";
  if (language === "zh") {
    const fmt = isDef ? ZH_DEF_FORMAT : isList ? ZH_LIST_FORMAT : ZH_FORMAT;
    if (userLevel === "basic") return `面向一线操作工的 SYNAPSE 本地部署系统助手。用简体中文、通俗易懂、完整地回答。${fmt} ${ZH_GUARD}`;
    if (userLevel === "manager") return `面向管理者的 SYNAPSE 本地部署系统分析助手。用简体中文回答，聚焦 KPI/趋势/运营影响，并给出优先级行动建议。${fmt} ${ZH_GUARD}`;
    return `面向工程师的 SYNAPSE 本地部署系统技术助手。用简体中文回答，给出具体的 API/数据结构/配置/命令；解释设计与错误处理。${fmt} ${ZH_GUARD}`;
  }
  if (language === "vi") {
    const fmt = isDef ? VI_DEF_FORMAT : isList ? VI_LIST_FORMAT : VI_FORMAT;
    if (userLevel === "basic") return `Trợ lý hệ thống SYNAPSE on-prem cho công nhân. Trả lời tiếng Việt, dễ hiểu, đầy đủ. ${fmt} ${VI_GUARD}`;
    if (userLevel === "manager") return `Trợ lý phân tích SYNAPSE on-prem cho quản lý. Trả lời tiếng Việt, tập trung KPI/xu hướng/tác động vận hành, đề xuất hành động ưu tiên. ${fmt} ${VI_GUARD}`;
    return `Trợ lý kỹ thuật SYNAPSE on-prem cho kỹ sư. Trả lời tiếng Việt, kèm API/schema/cấu hình/CLI cụ thể; giải thích thiết kế và xử lý lỗi. ${fmt} ${VI_GUARD}`;
  }
  const fmt = isDef ? EN_DEF_FORMAT : isList ? EN_LIST_FORMAT : EN_FORMAT;
  if (userLevel === "basic") return `Support assistant for SYNAPSE on-prem system, for line workers. ${fmt} ${EN_GUARD}`;
  if (userLevel === "manager") return `Analytical assistant for SYNAPSE on-prem system, for managers. Focus on KPIs, trends, operational impact, prioritized actions. ${fmt} ${EN_GUARD}`;
  return `Technical assistant for SYNAPSE on-prem system, for engineers. Include APIs, schemas, config, CLI; explain design and error handling. ${fmt} ${EN_GUARD}`;
}

const KB_QUESTION = "Ngưỡng cảnh báo tỷ lệ NG được cấu hình như thế nào và ai được thông báo khi vượt ngưỡng?";
const CONTEXT_CHUNK_CHAR_CAP = Number(process.env.KB_QA_CTX_CAP ?? 1200); // aiLocalKnowledgeService.ts:367

async function buildKbPrompt() {
  const { retrieveKnowledge } = await import(svc("aiLocalKnowledgeService.ts"));
  const { redactSecretsAndPII } = await import(svc("ai/aiSafety.ts"));
  const retrieve = await retrieveKnowledge(KB_QUESTION, 5);

  const contextBlock = retrieve.citations
    .map((c, i) => {
      const raw = retrieve.contexts[i] ?? "";
      const ctx = raw.length > CONTEXT_CHUNK_CHAR_CAP ? `${raw.slice(0, CONTEXT_CHUNK_CHAR_CAP)}…` : raw;
      return `[${i + 1}] ${c.title} | ${c.sourcePath}\n${redactSecretsAndPII(ctx).text}`;
    })
    .join("\n\n");

  const systemPrompt = getSystemPromptForRole("technical", retrieve.language, retrieve.intent);
  const userPrompt = [
    systemPrompt,
    "", // historyBlock rỗng — lượt hỏi đầu tiên
    "NGUYÊN TẮC TRẢ LỜI:",
    "1. Chỉ trả lời dựa trên ngữ cảnh được cung cấp; trích dẫn nguồn bằng [1], [2].",
    "2. Nếu ngữ cảnh KHÔNG liên quan trực tiếp đến câu hỏi, hãy trả lời chính xác: \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\" và đề xuất câu hỏi rõ hơn. KHÔNG bịa.",
    "3. Trả lời đúng trọng tâm câu hỏi hiện tại; bỏ qua phần ngữ cảnh không liên quan.",
    "4. Nếu có dữ liệu thời gian thực, ƯU TIÊN dùng nó; không bịa số liệu.",
    "5. TUYỆT ĐỐI KHÔNG lặp lại, sao chép, hoặc tóm tắt các câu trả lời trước trong Lịch sử hội thoại. Lịch sử CHỈ dùng để hiểu ngữ cảnh (ví dụ: đại từ, chủ đề đang nói tới). CHỈ trả lời cho 'Câu hỏi hiện tại' bên dưới, không nhắc lại nội dung cũ.",
    `Phân loại ý định: ${retrieve.intent}`,
    `Ngôn ngữ: ${retrieve.language}`,
    "", // toolBlock rỗng — không có dữ liệu tool thời gian thực trong lượt test này
    "=== Ngữ cảnh từ knowledge base ===",
    contextBlock,
    "", // hintsBlock BỎ (xem ghi chú trên hàm)
    `\n=== Câu hỏi hiện tại ===\n${KB_QUESTION}`,
    "=== Câu trả lời (chỉ trả lời câu hỏi hiện tại, không lặp lại lịch sử) ===",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: "P4_KB",
    title: "Trợ lý tri thức — hỏi đáp vận hành",
    sourceFile: "server/services/aiLocalKnowledgeService.ts",
    sourceLines: "1136-1166 (hàm generateWithOllama()) + 844-909 (getSystemPromptForRole, copy verbatim) + 1593 (retrieveKnowledge(), gọi thật)",
    systemPrompt: null, // đã gộp vào userPrompt như đúng cách generateWithOllama() làm (dòng 1146-1147: KHÔNG truyền systemPrompt riêng cho generateText — toàn bộ prompt là 1 khối)
    userPrompt,
    note:
      `Câu hỏi test: "${KB_QUESTION}". retrieve.language="${retrieve.language}", retrieve.intent="${retrieve.intent}", ` +
      `${retrieve.citations.length} citation thật từ knowledge/chunks.jsonl (${retrieve.citations.map((c) => c.sourcePath).join(", ") || "(không tìm được citation liên quan)"}). ` +
      `Bỏ 2 khối rỗng hợp lệ (historyBlock, toolBlock) + 1 khối bị lược (hintsBlock, logic regex không export) — xem comment trong mã nguồn script.`,
  };
}

// ─── Build cả 4 prompt (gọi DB/KB THẬT, KHÔNG gọi model) ───────────────────────────
async function buildPrompts() {
  const { gatherKpis } = await import(svc("aiExecutiveReport.ts"));
  // `now` cố định vào 2026-07-14 (thay vì mặc định = giờ chạy script) — xác nhận bằng SQL
  // trực tiếp (lệnh: SELECT date_trunc('day',"createdAt"),count(*) FROM product_inspections
  // GROUP BY 1 ORDER BY count(*) DESC) rằng 2026-07-13 có 3540 lượt kiểm tra thật — NHIỀU
  // (review round 1, Minor: bản đầu ghi nhầm "nhiều NHẤT"; 2026-07-12 có 5370 lượt, nhiều
  // hơn — đã sửa chữ dùng, KHÔNG đổi mốc vì không cần chạy lại model 30B chỉ vì chọn ngày
  // chưa phải ngày đông nhất, dữ liệu 07-13 vẫn thật và đủ phong phú để so sánh). 24h gần
  // thời điểm chạy script (2026-08-01) trả về 0 (không có traffic dev gần đây) — dùng "now"
  // THẬT nhưng lùi lại mốc thời gian có dữ liệu, KHÔNG BỊA số liệu nào, `now` vẫn là tham số
  // hợp lệ của gatherKpis() production.
  const kpis = await gatherKpis("day", "vi", new Date("2026-07-14T00:00:00.000Z")); // global (không factoryCode), giống scheduler mặc định

  const prompts = [
    {
      id: "P1_RCA",
      title: "RCA — phân tích nguyên nhân gốc",
      sourceFile: "server/services/aiRcaCopilot.ts",
      sourceLines: "500-513 (hàm synthesize())",
      systemPrompt: RCA_SYS,
      userPrompt: buildRcaUserPrompt(kpis),
      note:
        "`sys` verbatim từ nguồn. PHÁT HIỆN: sys/userPrompt KHÔNG có nhánh tiếng Việt nào (tham số " +
        "`lang` không được dùng trong synthesize(), dù mặc định lang=\"vi\") — model có thể trả lời " +
        "bằng tiếng Anh dù đây là luồng RCA cho người vận hành nói tiếng Việt. EVIDENCE tái dựng từ " +
        "Pareto thật (gatherKpis), không gọi được gatherEvidence() (nội bộ, cần 6 nguồn phụ). " +
        "⚠ KHAI BÁO CƠ CHẾ SINH (review round 1, Important 2): sản xuất THẬT gọi `generateJSON()` " +
        "(aiRcaCopilot.ts:527-539) — ràng buộc theo RCA_JSON_SCHEMA bằng GBNF grammar (chỉ cho phép " +
        "field cause/confidence/evidence/recommendedFix đúng kiểu). Lượt sinh dưới đây dùng " +
        "`generateText()` TỰ DO (không ràng buộc schema) — CỐ Ý, không phải sai sót: mục tiêu Task 4 " +
        "là chấm CHẤT LƯỢNG VĂN XUÔI tiếng Việt, mà GBNF ép đúng khuôn JSON gần như không còn văn " +
        "xuôi tự nhiên để chấm (chỉ còn field ngắn, không phải câu/đoạn). Hệ quả quan sát được: cả 2 " +
        "model dưới đây đều KHÔNG khớp RCA_JSON_SCHEMA thật (thiếu field bắt buộc, tự đặt field lạ như " +
        "\"rank\"/\"evidenceSupport\") — vì không bị ép theo schema. Điều này áp dụng ĐỀU cho cả 2 " +
        "model (không phá tính công bằng của phép so) nhưng làm P1 kém đại diện cho ĐƯỜNG CHẠY THẬT " +
        "hơn 3 prompt còn lại — người đọc nên cân nhắc P1 là \"cùng system+user prompt nhưng cơ chế " +
        "ràng buộc đầu ra khác sản xuất\", không phải \"y hệt sản xuất\".",
    },
    {
      id: "P2_EXEC",
      title: "Báo cáo điều hành",
      sourceFile: "server/services/aiExecutiveReport.ts",
      sourceLines: "318-342 (buildSystemPrompt(\"vi\") + buildUserPrompt(kpis))",
      systemPrompt: EXEC_SYS_VI,
      userPrompt: buildExecUserPrompt(kpis),
      note:
        `KPI THẬT từ gatherKpis("day","vi") — totalInspections=${kpis.totalInspections}, ` +
        `fpy=${kpis.fpy.toFixed(1)}%, ngRate=${kpis.ngRate.toFixed(1)}%, ${kpis.topDefects.length} top defect, ` +
        `${kpis.pdmRiskMachines.length} máy rủi ro. ${kpis.dataWarnings.length ? "dataWarnings: " + kpis.dataWarnings.join("; ") : "không cảnh báo dữ liệu."}`,
    },
    {
      id: "P3_DAILY",
      title: "Tóm tắt chất lượng hàng ngày (thay \"cố vấn ngưỡng\" — xem note)",
      sourceFile: "server/services/aiReportGenerator.ts",
      sourceLines: "556-560 (trong generateDailyQualitySummary())",
      systemPrompt: DAILY_SYS_VI,
      userPrompt: buildDailyUserPrompt(kpis),
      note:
        "THAY THẾ cho \"cố vấn ngưỡng\" theo yêu cầu brief — đã tìm trong aiThresholdAdvisor.ts, " +
        "aiSetupAdvisor.ts, aiThresholdTuneScheduler.ts, aiCalibration.ts, aiAnomalyCalibration.ts, " +
        "thresholdGovernanceService.ts, aiAutoProposer.ts (grep generateText|generateNarrative|" +
        "generateJSON|routeInference|aiGgufEngine|aiProviderRouter trên cả 7 file) → 0 khớp. Không có " +
        "prompt LLM nào trong domain \"cố vấn ngưỡng\" — 100% thống kê (suggestThresholds()) + chuỗi " +
        "đa ngôn ngữ TĨNH, không phải LLM sinh. Số liệu tái dùng từ gatherKpis() (P2), ghép theo đúng " +
        "công thức/nhãn field của aiReportGenerator.ts:530-546.",
    },
    null, // P4 điền bên dưới (async riêng)
  ];

  prompts[3] = await buildKbPrompt();
  return { prompts, kpis };
}

// ─── Model load/generate/unload (import thẳng aiGgufEngine.ts, không boot app) ─────
async function loadModel(basename) {
  const { loadGgufModel } = await import(svc("aiGgufEngine.ts"));
  return loadGgufModel({ modelPath: basename, gpuLayers: "max", contextSize: CONTEXT_SIZE });
}

async function generateAll(modelId, prompts) {
  const { generateText } = await import(svc("aiGgufEngine.ts"));
  const results = [];
  for (const p of prompts) {
    console.error(`[vi-ab] generating ${p.id} on ${modelId}...`);
    const t0 = Date.now();
    const res = await generateText(
      {
        systemPrompt: p.systemPrompt ?? undefined,
        prompt: p.userPrompt,
        maxTokens: GEN_PARAMS.maxTokens,
        temperature: GEN_PARAMS.temperature,
        topP: GEN_PARAMS.topP,
      },
      modelId,
    );
    console.error(`[vi-ab]   done ${p.id} in ${Date.now() - t0}ms (${res.tokensGenerated} tok generated)`);
    results.push({ id: p.id, text: res.text, tokensGenerated: res.tokensGenerated, tokensPrompt: res.tokensPrompt, totalTimeMs: res.totalTimeMs });
  }
  return results;
}

async function unloadAll() {
  const { getLoadedGgufModels, unloadGgufModel } = await import(svc("aiGgufEngine.ts"));
  for (const m of getLoadedGgufModels()) {
    await unloadGgufModel(m.modelId ?? m.id ?? m.name);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const vramStart = readVram();
  console.error(`[vi-ab] VRAM start: ${JSON.stringify(vramStart)}`);

  const { prompts } = await buildPrompts();
  console.error(`[vi-ab] built ${prompts.length} prompts (live DB/KB data, no model call yet)`);

  // Phase 0 cleanup — retrieveKnowledge() (P4) loads the small embed model
  // (GGUF_EMBED_MODEL) internally via embedQuestion(). Unload it now so each
  // 30B phase below starts from a clean, attributable VRAM baseline (Task 2/3
  // methodology) — matches brief "chỉ nạp model đang cần".
  await unloadAll();
  const vramAfterKb = readVram();
  console.error(`[vi-ab] VRAM after KB-retrieval cleanup: ${JSON.stringify(vramAfterKb)}`);

  // ── Phase 1: General (Qwen3-30B-A3B-Instruct) ──
  console.error(`[vi-ab] loading GENERAL: ${MODEL_GENERAL}`);
  const idGeneral = await loadModel(MODEL_GENERAL);
  console.error(`[vi-ab] loaded General as modelId=${idGeneral}, VRAM=${JSON.stringify(readVram())}`);
  const outGeneral = await generateAll(idGeneral, prompts);
  await unloadAll();
  const vramAfterGeneral = readVram();
  console.error(`[vi-ab] disposed General, VRAM=${JSON.stringify(vramAfterGeneral)}`);

  // ── Phase 2: Coder (Qwen3-Coder-30B-A3B-Instruct) ──
  console.error(`[vi-ab] loading CODER: ${MODEL_CODER}`);
  const idCoder = await loadModel(MODEL_CODER);
  console.error(`[vi-ab] loaded Coder as modelId=${idCoder}, VRAM=${JSON.stringify(readVram())}`);
  const outCoder = await generateAll(idCoder, prompts);
  await unloadAll();
  const vramEnd = readVram();
  console.error(`[vi-ab] disposed Coder, VRAM=${JSON.stringify(vramEnd)}`);

  // ── Anonymize: random Model 1 / Model 2 label assignment ──
  const generalIsModel1 = Math.random() < 0.5;
  const label = {
    general: generalIsModel1 ? "Model 1" : "Model 2",
    coder: generalIsModel1 ? "Model 2" : "Model 1",
  };
  const byLabel = {
    [label.general]: { name: "General", results: outGeneral },
    [label.coder]: { name: "Coder", results: outCoder },
  };

  // ── Write the PRIVATE mapping file (NOT part of stdout) ──
  fs.mkdirSync(path.dirname(MODEL_MAP_FILE), { recursive: true });
  fs.writeFileSync(
    MODEL_MAP_FILE,
    `# Bảng ánh xạ Model 1 / Model 2 — Task 4 (Đ2 A/B tiếng Việt)\n\n` +
      `**CHỈ chủ dự án đọc file này SAU KHI đã tự chấm bản ẩn danh** ` +
      `(\`docs/superpowers/reports/2026-08-01-do0-vi-ab.md\`) — đọc trước sẽ làm lệch đánh giá.\n\n` +
      `Sinh lúc: ${new Date().toISOString()}\n` +
      `Gán nhãn: ngẫu nhiên (\`Math.random() < 0.5\`), không cố định theo thứ tự nạp.\n\n` +
      `| Nhãn ẩn danh | Model thật (file GGUF) |\n|---|---|\n` +
      `| **${label.general}** | \`${MODEL_GENERAL}\` (General — Qwen3-30B-A3B-Instruct) |\n` +
      `| **${label.coder}** | \`${MODEL_CODER}\` (Coder — Qwen3-Coder-30B-A3B-Instruct) |\n`,
    "utf8",
  );
  console.error(`[vi-ab] model map written: ${MODEL_MAP_FILE}`);

  // ── Emit anonymized markdown to stdout (ONLY thing on stdout) ──
  const now = new Date().toISOString();
  let md = "";
  md += `# Đợt 0 Task 4 — A/B chất lượng tiếng Việt (Model 1 / Model 2, ẩn danh)\n\n`;
  md += `Sinh lúc: ${now}\n\n`;
  md += `**Không kết luận model nào hay hơn trong file này — chỉ trình bày cặp câu trả lời cạnh nhau. ` +
    `Chủ dự án chấm.** Bảng ánh xạ nhãn↔model thật ở file riêng (không commit).\n\n`;

  // Review round 1 (coordinator) — hai phát hiện phụ được nâng lên mục riêng, đứng ngay đầu
  // file (không chôn trong "Ghi chú" của từng prompt) vì "chúng không phải phụ lục, chúng là
  // thứ chủ dự án cần biết". Cả hai ĐỘC LẬP với câu hỏi "model nào viết tiếng Việt hay hơn".
  md += `## ⚠ Phát hiện quan trọng (độc lập với việc chọn model — không phải kết luận A/B)\n\n`;
  md += `1. **RCA copilot sinh tiếng Anh, không phải tiếng Việt, dù \`lang\` mặc định "vi".** ` +
    `\`synthesize(input, lang, ev)\` (\`server/services/aiRcaCopilot.ts\`) nhận tham số \`lang\` ` +
    `nhưng KHÔNG hề tham chiếu nó trong thân hàm — \`sys\`/\`userPrompt\` 100% tiếng Anh, không có ` +
    `nhánh ngôn ngữ nào. Xác nhận bằng lượt sinh thật ở Prompt 1 bên dưới: cả 2 model đều trả lời ` +
    `tiếng Anh. Đây là **bug sản phẩm thật**, không liên quan tới việc chọn roster model nào thường ` +
    `trú — **KHÔNG vá trong khảo sát này** (phát hiện của khảo sát, sửa là việc đợt khác).\n`;
  md += `2. **"Cố vấn ngưỡng" (threshold advisor) không hề gọi LLM.** Đã grep 7 file liên quan ` +
    `(\`aiThresholdAdvisor.ts\`, \`aiSetupAdvisor.ts\`, \`aiThresholdTuneScheduler.ts\`, ` +
    `\`aiCalibration.ts\`, \`aiAnomalyCalibration.ts\`, \`thresholdGovernanceService.ts\`, ` +
    `\`aiAutoProposer.ts\`) cho pattern gọi model (\`generateText|generateNarrative|generateJSON|` +
    `routeInference|aiGgufEngine|aiProviderRouter\`) → **0 khớp**. Toàn bộ domain này là thống kê ` +
    `thuần (\`suggestThresholds()\`) + chuỗi đa ngôn ngữ TĨNH, không phải LLM sinh — nếu quyết định ` +
    `roster dựa một phần vào "ảnh hưởng tới cố vấn ngưỡng", trục này **không hề bị ảnh hưởng** bởi ` +
    `việc đổi model 30B nào thường trú. Prompt 3 bên dưới dùng bản THAY THẾ (\`aiReportGenerator.ts\`) ` +
    `vì lý do này — xem "Ghi chú" của Prompt 3.\n\n`;

  md += `## Tham số sinh (giống hệt nhau cho cả 2 model, cả 4 prompt)\n\n`;
  md += `| Tham số | Giá trị |\n|---|---|\n`;
  md += `| temperature | ${GEN_PARAMS.temperature} (greedy — xem lý do trong mã script) |\n`;
  md += `| top_p | ${GEN_PARAMS.topP} (no-op ở temperature=0) |\n`;
  md += `| max tokens | ${GEN_PARAMS.maxTokens} |\n`;
  md += `| seed | không hỗ trợ ở tầng \`generateText()\` hiện tại; temperature=0 → không cần |\n`;
  md += `| contextSize (lúc nạp model) | ${CONTEXT_SIZE} |\n`;
  md += `| gpuLayers | "max" (full GPU offload, cả 2 model) |\n\n`;
  md += `Lệnh sinh file này:\n\`\`\`bash\nnpx tsx scripts/ai-survey/vi-quality-ab.mjs > docs/superpowers/reports/2026-08-01-do0-vi-ab.md\n\`\`\`\n\n`;
  md += `---\n\n`;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const r1 = byLabel["Model 1"].results.find((r) => r.id === p.id);
    const r2 = byLabel["Model 2"].results.find((r) => r.id === p.id);
    md += `## Prompt ${i + 1} — ${p.title}\n\n`;
    md += `**Nguồn:** \`${p.sourceFile}\` — ${p.sourceLines}\n\n`;
    md += `**Ghi chú:** ${p.note}\n\n`;
    if (p.systemPrompt) {
      md += `### System prompt (dùng chung cho cả 2 model)\n\n\`\`\`\n${p.systemPrompt}\n\`\`\`\n\n`;
    }
    md += `### User prompt (dùng chung cho cả 2 model)\n\n\`\`\`\n${p.userPrompt}\n\`\`\`\n\n`;
    md += `### Cặp câu trả lời\n\n`;
    md += `<table>\n<tr><th width="50%">Model 1</th><th width="50%">Model 2</th></tr>\n<tr>\n`;
    md += `<td valign="top">\n\n<pre style="white-space:pre-wrap">${htmlEscape(r1?.text ?? "(lỗi sinh)")}</pre>\n\n` +
      `<sub>${r1?.tokensGenerated ?? "?"} token sinh ra, ${r1?.totalTimeMs ?? "?"}ms</sub>\n\n</td>\n`;
    md += `<td valign="top">\n\n<pre style="white-space:pre-wrap">${htmlEscape(r2?.text ?? "(lỗi sinh)")}</pre>\n\n` +
      `<sub>${r2?.tokensGenerated ?? "?"} token sinh ra, ${r2?.totalTimeMs ?? "?"}ms</sub>\n\n</td>\n`;
    md += `</tr>\n</table>\n\n---\n\n`;
  }

  md += `## Vệ sinh VRAM (xác nhận từng lượt)\n\n`;
  md += `| Mốc | VRAM (MiB used/total) |\n|---|---|\n`;
  md += `| Trước khi bắt đầu | ${JSON.stringify(vramStart)} |\n`;
  md += `| Sau dọn model embed (trước Phase 1) | ${JSON.stringify(vramAfterKb)} |\n`;
  // Review fix (Important 1) — bản đầu in thẳng "General"/"Coder" ở đây, rò tên model
  // thật ngay trong CHÍNH file khai là ẩn danh (dù nhãn Model 1/2 ở trên không bị ảnh
  // hưởng — không đủ để suy ra ánh xạ — vẫn vi phạm đúng trục brief nhấn mạnh nhất).
  // Nhãn trung lập theo THỨ TỰ NẠP (không phải theo Model 1/2, để không lộ thêm suy luận
  // "model nạp trước luôn là Model X").
  md += `| Sau dispose model đầu tiên nạp (Phase 1) | ${JSON.stringify(vramAfterGeneral)} |\n`;
  md += `| Sau dispose model thứ hai nạp (Phase 2, cuối cùng) | ${JSON.stringify(vramEnd)} |\n\n`;
  md += `Lệnh đo (chạy độc lập sau khi script kết thúc):\n\`\`\`bash\nnvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits\ntasklist | grep node.exe   # (PowerShell: Get-Process node -ErrorAction SilentlyContinue)\n\`\`\`\n`;

  out(md);
  console.error(`[vi-ab] DONE — ${prompts.length} prompt × 2 model = ${prompts.length * 2} lượt sinh.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[vi-ab] fatal:", err?.stack ?? err);
    process.exit(1);
  });
