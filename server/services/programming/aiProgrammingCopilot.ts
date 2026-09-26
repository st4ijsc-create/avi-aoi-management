/**
 * Doc 09 / Phase D7 + Doc 34 / P2 — Device Programming & Control: AI ENGINEERING COPILOT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The AI side of the workspace. Two generations live here, side by side:
 *
 *   • suggestProgram() / explainProgram() (D7) — DETERMINISTIC static templates + a regex
 *     structural summary. Zero GPU. Retained for back-compat + as the fail-safe floor.
 *
 *   • generateProgram() (doc 34 · P2) — the REAL value: an LLM (deep/code tier) writes,
 *     completes, translates, reviews or explains device code, primed by golden few-shot
 *     examples + cited vendor-manual RAG, and EVERY generated program is run through the
 *     SAME programmingAdapter validate() (and compile() for ir-flow/pou) BEFORE it is
 *     returned — so a suggestion is never shown unvalidated.
 *
 * SAFETY (non-negotiable — doc 34 §5.2):
 *   1. HARD-REFUSE any request to author safety-function logic (E-stop / emergency /
 *      interlock / light-curtain / two-hand / guard-lock / SIL / PL). Safety logic is
 *      authored + certified by a qualified engineer on the certified controller, never here.
 *   2. Every generated program is VALIDATED through programmingAdapter before return
 *      (PROG_CODEGEN_VALIDATE_REQUIRED, default true); on failure the code is STILL returned
 *      with ok:false + diagnostics — errors are surfaced, never hidden.
 *   3. DISPLAY-ONLY: this module opens NO device path — no deploy, no dispatch, no upload,
 *      no run. The engineer reviews + saves a version; the existing gated pipeline deploys.
 *   4. Output is GROUNDED — RAG citations are always attached so it is cited, not fabricated.
 *
 * FAIL-SAFE: flag off → a well-formed disabled result. GGUF offline / any error → graceful
 * degrade (a note, never a crash, never fabricated code). Flag: AI_PROGRAMMING_COPILOT_ENABLED
 * (default OFF).
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  programmingRegistry,
  PROGRAMMING_KINDS,
  type ProgrammingKind,
  type ProgDiagnostic,
} from "./programmingAdapter";
import { selectGoldenExamples, formatGoldenExamplesForPrompt, goHeaderGoldenKhoiMa } from "./goldenExamples";
import { getCodegenJsonSchema } from "./codegenSchemas";
// G2-A — CHỈ MỤC REPO (7.306 chunk mô tả CHÍNH nền tảng này) + bộ cắt theo ngân sách token.
import { gatherRepoIndexContext, catTheoNganSachToken } from "../ai/repoContextService";
// Bộ ước lượng token DÙNG CHUNG với cổng từ-chối-trung-thực `kiemNganSachNguCanh()`. Không tự
// viết `len/4` ở đây — hai cái thước khác nhau thì ngân sách và cổng sẽ trôi khỏi nhau.
import { uocLuongSoToken } from "../aiLlamaServerClient";
import {
  checkCopilotSafety,
  inlineCompletionBlocked,
  detectRequestLang,
  type GateLang,
  type GateReasonCode,
} from "./copilotSafetyGate";

export type CopilotLang = "vi" | "en" | "zh";

export interface SuggestInput {
  kind: ProgrammingKind;
  intent: string;
  lang?: CopilotLang;
}

export interface SuggestResult {
  available: boolean;
  refused: boolean;
  reason?: string;
  kind?: ProgrammingKind;
  language?: string;
  source?: string;
  diagnostics?: ProgDiagnostic[];
  valid?: boolean;
}

export function copilotEnabled(): boolean {
  return (
    process.env.AI_PROGRAMMING_COPILOT_ENABLED === "true" ||
    process.env.AI_PROGRAMMING_COPILOT_ENABLED === "1"
  );
}

// HARD REFUSAL — Doc 80 · Task 10 (D4): hai bản regex từ-đơn trùng nhau (`SAFETY_RE` ở đây và
// `COPILOT_SAFETY_RE` ở programmingRouter) đã được THAY bằng MỘT module `copilotSafetyGate` (cụm
// động từ nguy hiểm × đối tượng an toàn VI/EN/ZH + soi `contextCode` + loại chẩn đoán nền tảng).
// Đo trước: regex cũ lọt S2 (tiếng Việt), lọt S3 (qua contextCode), chặn oan S4 ("guard rail").

const LANG_OF: Record<ProgrammingKind, string> = {
  stub: "text",
  "zmotion-basic": "basic",
  gcode: "gcode",
  "mitsubishi-engineering": "device",
  "robot-tm": "tmscript",
  "iec61131-st": "st",
  "iec61131-ld": "ld",
  // P4 (doc 24 Wave-3): structured POUs are authored in the graphical POU editor / imported
  // from PLCopen XML, not the text copilot (no skeleton — falls through to the default no-op).
  "iec61131-pou": "pou-json",
  // D1 (doc 16 §11.1): IR flows are authored in the visual IR editor, not the text
  // copilot. The language token is the IR JSON kind; the copilot has no IR skeleton
  // (falls through to the default no-op below) — IR authoring is the editor's job.
  "ir-flow": "ir-json",
};

/** Deterministic skeleton per kind. A model can enrich behind the same validation gate. */
function skeleton(kind: ProgrammingKind, intent: string): string {
  const c = `' ${intent.replace(/\r?\n/g, " ").slice(0, 80)}`;
  switch (kind) {
    case "zmotion-basic":
      return [c, "BASE(0,1)", "ATYPE = 1,1", "UNITS = 100,100", "SPEED = 200,200", "MOVEABS(0,0)", "WAIT IDLE", 'PRINT "done"'].join("\n");
    case "mitsubishi-engineering":
      return [c, "D100 = 0   ' set point", "D101 = 100 ' limit", "M0 := TRUE"].join("\n");
    case "robot-tm":
      return [c, "POINT P1 = (100,0,200,180,0,0)", "POINT P2 = (100,50,80,180,0,0)", "HOME", "MOVE P1", "GRIP", "MOVEL P2", "RELEASE", "HOME"].join("\n");
    case "iec61131-st":
      return [`(* ${intent.slice(0, 80)} *)`, "VAR", "  run : BOOL;", "END_VAR", "run := TRUE;"].join("\n");
    case "iec61131-ld":
      return [`// ${intent.slice(0, 80)}`, "Y0 := X0 AND NOT X1", "Y1 := Y0 OR X2"].join("\n");
    case "gcode":
      return ["; " + intent.slice(0, 80), "G21", "G90", "G0 X0 Y0", "M30"].join("\n");
    default:
      return c;
  }
}

/**
 * Propose a validated skeleton program. Advisory only — the human reviews + saves it as a
 * version in the workspace, then validates/builds/deploys through the gated router.
 */
export async function suggestProgram(input: SuggestInput): Promise<SuggestResult> {
  if (!copilotEnabled()) return { available: false, refused: false, reason: "AI_PROGRAMMING_COPILOT_ENABLED is off." };

  const gate = checkCopilotSafety({ mode: "generate", request: input.intent });
  if (gate.refused) {
    return { available: true, refused: true, reason: gate.userMessage };
  }

  // Unknown/unimplemented kind → honest unavailable (no fake source).
  if (!programmingRegistry.isImplemented(input.kind)) {
    return { available: true, refused: false, reason: `No adapter for "${input.kind}" yet.`, kind: input.kind };
  }

  const language = LANG_OF[input.kind] ?? "text";
  const source = skeleton(input.kind, input.intent);

  // Validate through the SAME adapter the human uses — never propose unvalidated source.
  let diagnostics: ProgDiagnostic[] = [];
  let valid = false;
  try {
    const adapter = programmingRegistry.getAdapter(input.kind);
    const v = await adapter.validate({ kind: input.kind, language, content: source });
    diagnostics = v.diagnostics;
    valid = v.ok;
  } catch (e) {
    diagnostics = [{ severity: "warning", message: `Validation unavailable: ${(e as Error).message}` }];
  }

  return { available: true, refused: false, kind: input.kind, language, source, diagnostics, valid };
}

export interface ExplainResult {
  available: boolean;
  summary: string;
  metrics: Record<string, number>;
}

/** Deterministic structural explanation of a program (no model required). */
export function explainProgram(kind: ProgrammingKind, source: string): ExplainResult {
  if (!copilotEnabled()) return { available: false, summary: "AI_PROGRAMMING_COPILOT_ENABLED is off.", metrics: {} };
  const lines = source.split(/\r?\n/).filter((l) => l.trim() && !/^\s*('|;|\/\/|\(\*)/.test(l));
  const moves = (source.match(/\b(MOVE|MOVEABS|MOVEL|MOVECIRC|G0|G1)\b/gi) ?? []).length;
  const assigns = (source.match(/:?=/g) ?? []).length;
  return {
    available: true,
    summary: `${kind}: ${lines.length} effective line(s), ${moves} motion op(s), ${assigns} assignment(s).`,
    metrics: { lines: lines.length, moves, assigns },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 34 · P2 — LLM CODE GENERATION wired into the safety substrate.
//
// The canonical entrypoint another agent's tool imports. It builds a role system prompt +
// golden few-shot + cited RAG, calls the code-tier LLM, extracts the code, and runs it
// through the SAME programmingAdapter validate()/compile() gate before returning — attaching
// diagnostics + citations. Safety requests are hard-refused; nothing is ever deployed.
// ════════════════════════════════════════════════════════════════════════════

export type CopilotMode = "generate" | "complete" | "translate" | "review" | "explain";

export interface GenerateProgramInput {
  /** A programmingAdapter kind (the source kind; the OUTPUT kind for non-translate modes). */
  kind: string;
  /** Natural-language request (vi/en/zh). */
  request: string;
  /** default "generate". */
  mode?: CopilotMode;
  /** Optional vendor scope for RAG (e.g. "Universal Robots", "Mitsubishi"). */
  vendor?: string;
  /** Existing code for complete / translate / review / explain. */
  contextCode?: string;
  /** Output kind for mode="translate". */
  targetKind?: string;
  /**
   * G2-A (SECURITY) — vai RBAC THẬT của người gọi, chỉ để xuyên xuống cổng corpus Training Studio
   * của `retrieveKnowledge` (xem `kbStudioAccess.ts`). PHẢI được điền SERVER-SIDE từ phiên đã xác
   * thực — KHÔNG BAO GIỜ từ thân request. Vắng mặt ⇒ cổng đó fail-closed (không có nội dung
   * Studio), đúng hành vi an toàn.
   */
  callerRole?: string;
}

export interface GenValidation {
  ok: boolean;
  diagnostics: { severity: string; message: string; line?: number }[];
}

export interface GenCitation {
  vendor: string;
  docTitle: string;
  page: number | null;
}

export interface GenerateProgramResult {
  ok: boolean;
  refused: boolean;
  /** Doc 80 · D4 — ai từ chối: cổng an toàn ("gate") trước model. */
  refusalSource?: "gate";
  /** Doc 80 · D4 — khoá ổn định cho i18n phía client (`progCopilot.refusal.<reasonCode>`). */
  reasonCode?: GateReasonCode;
  /** Doc 80 · D4 — câu từ chối cho người dùng, theo ngôn ngữ của yêu cầu (vi/en/zh). */
  userMessage?: string;
  reason?: string;
  kind: string;
  /** Generated / translated code (absent for explain/review or when refused/degraded). */
  code?: string;
  validation?: GenValidation;
  citations?: GenCitation[];
  /** For review / explain. */
  explanation?: string;
  note?: string;
  /** How many self-repair rounds ran (doc 34 P4c #1). 0 = valid first try or repair off. */
  repairAttempts?: number;
  /** Doc 80 · AI-09 — mã lỗi HỆ THỐNG (không có mã/giải thích); `note` là câu ngắn tương ứng. */
  errorCode?: CopilotErrorCode;
  /** Doc 80 · AI-09 — chi tiết kỹ thuật nguyên văn (chỉ dành cho admin; router gỡ với vai khác). */
  devDetail?: string;
}

/** ir-flow / iec61131-pou also COMPILE (safety-linter/transpile hard gate) before display. */
const COMPILE_ALSO: ReadonlySet<string> = new Set(["ir-flow", "iec61131-pou"]);

/**
 * Whether every generated program MUST pass substrate validation before it can be reported
 * `ok`. Default TRUE (doc 34 Appendix A). When true and the kind has no substrate validator
 * (a Tier-B text target), the result is honestly ok:false with a loud UNVALIDATED warning —
 * the code is still returned so the engineer sees it, but never claimed validated.
 */
function validateRequired(): boolean {
  const v = (process.env.PROG_CODEGEN_VALIDATE_REQUIRED ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

function langForKind(kind: string): string {
  return (LANG_OF as Record<string, string>)[kind] ?? kind ?? "text";
}

/** Extract the first fenced code block from an LLM response; else the trimmed whole text. */
function extractCode(text: string): string {
  if (!text) return "";
  // Fix round 1 (#4) — đo thật T04: lượt tự sửa (tắt nghĩ) trả `{"thought": "…suy luận…", "code": "…"}`
  // và CẢ vỏ JSON 5 KB được validator robot-tm cho qua rồi gắn "Auto-repaired". Vỏ suy luận ⇒ lấy
  // đúng `code`; không có `code` ⇒ KHÔNG có mã (không bao giờ đem suy luận đi validate).
  const vo = goVoSuyLuan(text);
  if (vo !== null) return vo ? extractCode(vo) : "";
  const fence = text.match(/```[a-zA-Z0-9_+.\-]*[ \t]*\r?\n([\s\S]*?)```/);
  if (fence && typeof fence[1] === "string") return fence[1].trim();
  return text.trim();
}

const KHOA_SUY_LUAN = ["thought", "thoughts", "thinking", "reasoning", "analysis", "reflection"];
const KHOA_MA = ["code", "program", "source"];

/**
 * Fix round 1 (#4) — văn bản (hoặc khối ```json bọc ngoài) có phải một object JSON mang khoá SUY
 * LUẬN không? Có ⇒ trả chuỗi `code` bên trong ("" nếu không có); không ⇒ `null` (xử lý như cũ).
 * JSON hợp lệ của IR/POU không có khoá suy luận nên KHÔNG bị đụng.
 */
function goVoSuyLuan(text: string): string | null {
  const t = text.trim();
  const ungVien: string[] = [t];
  const tham = t.match(/^```[a-zA-Z0-9_+.\-]*[ \t]*\r?\n([\s\S]*)```\s*$/); // hàng rào NGOÀI CÙNG (tham lam)
  if (tham) ungVien.push(tham[1].trim());
  for (const c of ungVien) {
    if (!c.startsWith("{")) continue;
    let o: unknown;
    try {
      o = JSON.parse(c);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o as Record<string, unknown>;
    if (!Object.keys(rec).some((k) => KHOA_SUY_LUAN.includes(k.toLowerCase()))) continue;
    for (const k of Object.keys(rec)) {
      if (KHOA_MA.includes(k.toLowerCase()) && typeof rec[k] === "string") return String(rec[k]);
    }
    return "";
  }
  return null;
}

/**
 * Fix round 1 (#4, đo lại T04) — kind VĂN BẢN (ST/LD/ZBasic/TM/MELSEC…) mà đầu ra lại là một object
 * JSON (`{"program": "…"}`, `{"steps": […]}`) ⇒ đó là VỎ, không phải chương trình. Có một trường mã
 * dạng chuỗi (code/program/source) ⇒ gỡ vỏ; không có ⇒ KHÔNG có mã (validator robot-tm quá lỏng đã
 * từng gắn ok:true cho cả vỏ JSON). Kind JSON thật (ir-flow / iec61131-pou) ⇒ không đụng.
 */
function goVoJsonChoKindVanBan(code: string, laKindJson: boolean): string {
  if (laKindJson) return code;
  const t = code.trim();
  if (!t.startsWith("{")) return code;
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    return code;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return code;
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (KHOA_MA.includes(k.toLowerCase()) && typeof rec[k] === "string") return extractCode(String(rec[k]));
  }
  return "";
}

/** Cheap keyword signals from the request/code → tag bonuses for golden-example selection. */
function deriveTags(request: string, contextCode?: string): string[] {
  const src = `${request ?? ""} ${contextCode ?? ""}`.toLowerCase();
  const words = src.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  return Array.from(new Set(words)).slice(0, 16);
}

/** Role system prompt (doc 34 §11.1). Style differs for codegen vs explain/review. */
function buildSystemPrompt(mode: CopilotMode, outKind: string, language: string): string {
  const base = [
    "You are an automation engineering assistant embedded in a factory control platform.",
    "You help a QUALIFIED engineer; the engineer DECIDES, reviews, simulates and tests every line before it ever runs on hardware.",
    "ABSOLUTE RULES:",
    "1. NEVER author safety-function logic (emergency-stop, safety interlock, light-curtain, two-hand, guard-locking, SIL/PL-rated logic). If asked, refuse — such logic must be implemented and certified by a qualified engineer on the certified safety controller.",
    "2. Ground everything ONLY in the provided golden examples and vendor-manual excerpts. If the documentation does not cover the requested vendor syntax, say so — do NOT invent commands, registers or instructions.",
    "3. Cite the manual excerpts you used by their [n] index.",
    "4. This output is advisory and DISPLAY-ONLY — it is validated by the platform and reviewed by the engineer; nothing is deployed automatically.",
  ];
  if (mode === "explain" || mode === "review") {
    base.push(
      `TASK STYLE: Give a concise, grounded ${mode} of the provided ${outKind} program in prose. Do not rewrite it. End with a one-line reminder to simulate and test before running on a device.`,
    );
  } else {
    base.push(
      // Doc 80 · D3 (AI-04) — BỎ luật cũ "đặt dòng SAFETY làm dòng CUỐI trong khối mã": nó phá cú
      // pháp ST và làm vỡ JSON (IR/POU). Lời nhắc an toàn là băng vàng thường trực trên UI.
      `TASK STYLE: Output ONLY the ${outKind} program (language: ${language}) inside a SINGLE fenced code block. No prose outside the block. Do not copy the header comments of the reference examples.`,
    );
  }
  return base.join("\n");
}

/** User prompt for a code-producing mode (generate / complete / translate). */
function buildCodePrompt(
  mode: CopilotMode,
  srcKind: string,
  outKind: string,
  language: string,
  request: string,
  contextCode: string | undefined,
  goldenBlock: string,
  ragContext: string,
  /** G2-A — khối chỉ mục repo đã cắt theo ngân sách; "" = không có gì để chèn. */
  repoBlock = "",
): string {
  const parts: string[] = [];
  if (mode === "translate") {
    parts.push(
      `TASK: Translate the following ${srcKind} program into ${outKind} (language: ${language}), preserving its behaviour exactly. Do NOT add safety logic.`,
    );
    if (contextCode) parts.push(`SOURCE PROGRAM (${srcKind}):\n\`\`\`\n${contextCode.trim()}\n\`\`\``);
    if (request) parts.push(`ADDITIONAL INSTRUCTIONS: ${request}`);
  } else if (mode === "complete") {
    parts.push(
      `TASK: Complete / extend the following ${outKind} program (language: ${language}). Keep the existing code; add exactly what the request asks.`,
    );
    if (contextCode) parts.push(`EXISTING CODE:\n\`\`\`\n${contextCode.trim()}\n\`\`\``);
    parts.push(`REQUEST: ${request}`);
  } else {
    parts.push(`TASK: Write a ${outKind} program (language: ${language}) for this request.`);
    parts.push(`REQUEST: ${request}`);
  }
  if (goldenBlock) parts.push(`REFERENCE GOLDEN EXAMPLES (mimic this correct style/syntax):\n${goldenBlock}`);
  parts.push(`VENDOR MANUAL CONTEXT (cite by [n]; empty = none available):\n${ragContext || "(none)"}`);
  if (repoBlock) parts.push(repoBlock);
  parts.push(`Now output the ${outKind} program only, in ONE fenced code block.`);
  return parts.join("\n\n");
}

/** User prompt for explain / review (no codegen). */
function buildExplainPrompt(
  mode: CopilotMode,
  outKind: string,
  language: string,
  request: string,
  code: string,
  ragContext: string,
  /** G2-A — khối chỉ mục repo đã cắt theo ngân sách; "" = không có gì để chèn. */
  repoBlock = "",
): string {
  const verb = mode === "review" ? "Review" : "Explain";
  const parts: string[] = [];
  parts.push(`TASK: ${verb} the following ${outKind} program (language: ${language}) for an engineer.`);
  if (request) parts.push(`FOCUS: ${request}`);
  parts.push(`PROGRAM:\n\`\`\`\n${code.trim()}\n\`\`\``);
  parts.push(`VENDOR MANUAL CONTEXT (cite by [n]; empty = none available):\n${ragContext || "(none)"}`);
  if (repoBlock) parts.push(repoBlock);
  return parts.join("\n\n");
}

/**
 * Load-order VRAM fix (P2 runtime): node-llama-cpp fragments GPU memory when a LARGE model
 * (30B ~16.7GB) is loaded AFTER a small one (the 0.6B embedder, pulled in by RAG). Loading
 * the big model FIRST and keeping it resident lets the small embedder fit alongside it, and
 * codegen then reuses the resident model. CODE_CTX also caps the codegen KV-cache — a 32K
 * context on the 30B is unnecessary for snippet generation and risks OOM. Both best-effort.
 */
const CODE_CTX = Number(process.env.GGUF_CODE_CTX) || 8192;

// ════════════════════════════════════════════════════════════════════════════════════════════
// G2-A (2026-08-16) — NGÂN SÁCH NGỮ CẢNH CÓ CHỦ ĐÍCH.
//
// ─── TRẦN THẬT LÀ BAO NHIÊU ────────────────────────────────────────────────────────────────
// `runCodeModel` gọi `chatCompletion()`, và `chatCompletion()` **KHÔNG có đường llama-server**
// (chỉ `generateText`/`generateJSON` đi qua `thuDuongServer`). Nghĩa là mọi lượt sinh mã chạy
// IN-PROCESS với đúng `contextSize = min(route().contextSize, GGUF_CODE_CTX)` = **8.192**, chứ
// KHÔNG phải 32.768 token/slot của llama-server. Ngân sách dưới đây vì thế cân theo 8.192 —
// cân theo 32.768 là tự cho mình gấp 4 lần chỗ mình không có.
//
// ─── VÌ SAO PHẢI CÓ KHỐI NÀY (đây là một BẢN VÁ, không chỉ là "chỗ cho tính năng mới") ─────
// Trước G2-A prompt sinh mã KHÔNG có một cái trần nào: `contextCode` được router cho tới
// 2.000.000 ký tự (~714.000 token) và đi THẲNG vào prompt, `answerContext` của manual hãng
// (topK=5) cũng vậy. Lưới `aiProgrammingCopilot.repoContext.test.ts` ĐO được prompt thật
// **95.609 / 96.993 / 130.568 token** trên cửa sổ 8.192 — tức lượt gọi đó chắc chắn hỏng (hoặc
// bị cổng `kiemNganSachNguCanh` từ chối trung thực trên đường server). Nối thêm chỉ mục repo mà
// không dựng trần trước là đổ thêm nước vào cái xô đã tràn.
//
// ─── THỨ TỰ ƯU TIÊN KHI PHẢI CẮT (từ GIỮ CHẶT NHẤT tới BỎ TRƯỚC NHẤT) ──────────────────────
//   1. system prompt + REQUEST — KHÔNG BAO GIỜ cắt. Đó là nhiệm vụ; cắt nó là trả lời câu khác.
//   2. BUFFER NGƯỜI DÙNG (`contextCode`) — với complete/translate/review/explain nó CHÍNH LÀ
//      đối tượng của yêu cầu. Không có nó thì câu trả lời vô nghĩa, nên nó đứng trên mọi ngữ cảnh
//      truy hồi được.
//   3. GOLDEN EXAMPLES — cú pháp ĐÚNG đã được kiểm chứng cho từng `kind`; đây là thứ trực tiếp
//      quyết định mã có qua được `programmingAdapter.validate()` hay không.
//   4. MANUAL HÃNG (RAG `answerContext`) — nền tảng cho cú pháp riêng của hãng; là thứ chống bịa.
//   5. CHỈ MỤC REPO (G2-A) — **BỎ TRƯỚC NHẤT**. Nó là phần MỚI và CHƯA ĐƯỢC CHỨNG MINH; nó
//      không được phép đẩy ra ngoài những thứ đã đo là có tác dụng. Đây là quyết định có chủ
//      đích, không phải hệ quả của thứ tự dòng lệnh.
//
// Cách cưỡng chế: một CÁI HỒ token dùng chung. Mỗi phần lấy `min(trần riêng, hồ còn lại)` theo
// đúng thứ tự trên, rồi trừ vào hồ. Trần riêng chống một phần phình ra nuốt hết; hồ chung chống
// tổng vượt cửa sổ. Thiếu một trong hai thì vẫn có ca vỡ.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Trần riêng của từng phần (token). Env cho phép người vận hành nắn mà không phải build lại. */
export const NGAN_SACH_PHAN = {
  /** Buffer người dùng dán tay / mã đang soạn. */
  contextCode: 1600,
  /** Few-shot cú pháp đúng theo `kind`. */
  golden: 1200,
  /** Ngữ cảnh manual hãng đã trích dẫn. */
  vendorKb: 1800,
  /** Chỉ mục repo (G2-A) — xem `repoContextService.REPO_INDEX_DEFAULT_MAX_TOKENS`. */
  repoIndex: 900,
} as const;

/**
 * Dự trữ cho phần KHUNG prompt (nhãn "TASK:", "REQUEST:", hàng rào ``` …) + sai số của chính bộ
 * ước lượng. Ước lượng 2,8 ký tự/token đã nghiêng về phía CAO HƠN token thật, nhưng một cửa sổ
 * "vừa khít" là một cửa sổ sẽ vỡ ở ca thứ N.
 */
const DU_TRU_KHUNG_TOKEN = 320;

interface NganSachNguCanhCopilot {
  /** Cửa sổ ngữ cảnh thật của lượt này. */
  ctx: number;
  /** Token dành riêng cho câu trả lời (lấy TỪ CHÍNH `route()` — không chép lại hằng số). */
  traLoi: number;
  /** Trần cho toàn bộ phần ĐƯA VÀO (system + user). */
  tranVao: number;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// Doc 80 · Task 10 · D1 vá nóng (AI-01) — CHÍNH SÁCH NGHĨ THEO LOẠI LƯỢT.
//
// Đo (phụ lục A §1, cánh A): `route("code")` cấp `maxTokens` 1536 cho MỌI lượt, còn Qwen3.6 trên
// :8091 NGHĨ (server `--reasoning-budget 12000`) ⇒ 13/14 tác vụ HỎNG vì model tiêu hết 1536 token
// vào `reasoning_content`. Cánh B (chỉ tắt nghĩ) ⇒ HỎNG 0; cánh C (nghĩ, trần 14k) ⇒ ĐẠT nhiều hơn.
//
// ⚠ KHÔNG đổi route `code` — nó dùng chung với AI Coding Workspace (phiên khác sở hữu). Chính
// sách chỉ đặt THAM SỐ TỪNG LƯỢT trong đường copilot:
//   • "sinh" (lượt sinh chính) / "giai-thich": ngân sách nghĩ có giới hạn (`thinkingBudgetTokens`,
//     mặc định 6000 — env `AI_COPILOT_THINKING_BUDGET_TOKENS`, 0 = tắt) và `maxTokens` = ngân
//     sách + 4000 cho phần trả lời. Chỉ khi cửa sổ ngữ cảnh còn ≥ 4096 token cho phần đưa vào;
//     không đủ ⇒ tắt nghĩ (một lượt nghĩ không chỗ trả lời là đúng ca hỏng đã đo).
//   • "tu-sua" (tự sửa) / "json" (IR/POU, grammar): LUÔN tắt nghĩ — lượt sửa có sẵn chẩn đoán cụ
//     thể; lượt JSON bị llama.cpp hoãn grammar tới khi khối nghĩ đóng (`grammar_lazy`).
//   Lượt tắt nghĩ giữ `maxTokens` của route (cánh B: 1536 đủ khi không nghĩ ⇒ HỎNG 0).
//   Ghost-text (inline) đi `/infill` của model FIM — không có chat template ⇒ không có khối nghĩ.
// ════════════════════════════════════════════════════════════════════════════════════════════

export type LoaiLuotCopilot = "sinh" | "giai-thich" | "tu-sua" | "json";

export interface ChinhSachLuot {
  maxTokens: number;
  disableThinking?: boolean;
  thinkingBudgetTokens?: number;
}

/** Token dành cho phần TRẢ LỜI sau khi nghĩ xong (mã chương trình / lời giải thích). */
const TRA_LOI_SAU_NGHI = 4000;
/** Phần tối thiểu phải còn cho prompt đưa vào khi bật nghĩ — ít hơn thì nghĩ là vô ích. */
const VAO_TOI_THIEU_KHI_NGHI = 4096;
const NGAN_SACH_NGHI_MAC_DINH = 6000;

function nganSachNghiCopilot(): number {
  const raw = process.env.AI_COPILOT_THINKING_BUDGET_TOKENS;
  if (raw === undefined || raw.trim() === "") return NGAN_SACH_NGHI_MAC_DINH;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NGAN_SACH_NGHI_MAC_DINH;
  return Math.max(0, Math.floor(n));
}

/**
 * Tham số nghĩ cho MỘT lượt gọi model. Thuần theo (loại lượt, maxTokens của route, cửa sổ ctx,
 * env) — `canNganSach` và `runCodeModel` gọi CÙNG hàm này nên ngân sách prompt và lượt gọi thật
 * không thể trôi khỏi nhau.
 */
export function chinhSachLuot(loai: LoaiLuotCopilot, routeMaxTokens: number, ctx: number): ChinhSachLuot {
  const tatNghi: ChinhSachLuot = { maxTokens: Math.max(512, routeMaxTokens), disableThinking: true };
  if (loai === "tu-sua" || loai === "json") return tatNghi;
  const budget = nganSachNghiCopilot();
  if (budget <= 0) return tatNghi;
  const maxTokens = budget + TRA_LOI_SAU_NGHI;
  if (ctx < maxTokens + VAO_TOI_THIEU_KHI_NGHI) return tatNghi;
  return { maxTokens, thinkingBudgetTokens: budget };
}

/**
 * Hỏi CHÍNH `aiModelRouter.route()` xem lượt sinh mã này được cấp bao nhiêu — rồi kẹp y hệt cách
 * `runCodeModel`/`runStructuredCodeModel` kẹp. Cố ý KHÔNG chép hằng "1536/8192" vào đây: nếu
 * router đổi quyết định mà ngân sách vẫn dùng số cũ thì cái thước và cái bị đo sẽ trôi khỏi nhau.
 * Best-effort: router hỏng ⇒ dùng đúng mặc định mà `runCodeModel` dùng khi router hỏng.
 */
async function canNganSach(text: string, loai: LoaiLuotCopilot): Promise<NganSachNguCanhCopilot> {
  let routeMax = 1536;
  let ctx = CODE_CTX;
  try {
    const { route } = await import("../aiModelRouter");
    const d = route({ task: "code", text, requiredQuality: "high" });
    routeMax = Math.max(512, d.maxTokens ?? routeMax);
    ctx = Math.min(d.contextSize ?? CODE_CTX, CODE_CTX);
  } catch {
    /* giữ mặc định — giống hệt nhánh catch của runCodeModel */
  }
  // Doc 80 · D1 — phần trả lời là `maxTokens` THẬT của lượt (có thể gồm cả ngân sách nghĩ).
  const traLoi = chinhSachLuot(loai, routeMax, ctx).maxTokens;
  return { ctx, traLoi, tranVao: Math.max(0, ctx - traLoi - DU_TRU_KHUNG_TOKEN) };
}

/** Một cái hồ token tiêu dần theo thứ tự ưu tiên. Không ai được lấy quá phần còn lại. */
class HoToken {
  constructor(private conLai: number) {}
  get con(): number {
    return Math.max(0, this.conLai);
  }
  /** Trừ thẳng (dùng cho phần KHÔNG cắt được: system + request). */
  tru(n: number): void {
    this.conLai -= n;
  }
  /**
   * Lấy một khối do `sinh(cap)` tự dựng (vd khối chỉ mục repo phải đi truy hồi mới có), rồi TRỪ
   * đúng số token của cái nó trả về.
   *
   * ★ Vì sao là MỘT hàm chứ không phải "gọi sinh() rồi nhớ gọi tru()": đột biến M6 của vòng đo
   * G2-A — xoá lời gọi `ho.tru(r.tokens)` — **SỐNG SÓT toàn bộ lưới**, vì khối repo tình cờ là
   * người tiêu dùng CUỐI CÙNG nên hôm nay quên trừ không đổi kết quả nào. Đó là nợ tiềm ẩn:
   * người thêm một phần MỚI sau khối repo sẽ tính trên một cái hồ nói dối. Không vá bằng cách
   * viết thêm một ca test canh lời gọi — vá bằng cách làm cho việc "quên" KHÔNG CÒN DIỄN ĐẠT
   * ĐƯỢC: cái hồ tự trừ, người gọi không có nút nào để bỏ sót.
   * `cap` = 0 ⇒ KHÔNG gọi `sinh` (cổng rẻ trước cổng tốn — không embed, không rerank).
   */
  async layKhoi(sinh: (cap: number) => Promise<string>, tranRieng: number): Promise<string> {
    const cap = Math.min(tranRieng, this.con);
    if (cap <= 0) return "";
    const khoi = await sinh(cap);
    if (!khoi) return "";
    this.conLai -= uocLuongSoToken(khoi);
    return khoi;
  }
  /** Cắt `text` cho vừa `min(tranRieng, còn lại)`, trừ đúng số đã dùng, trả văn bản đã cắt. */
  lay(text: string | undefined, tranRieng: number, giu: "dau" | "cuoi" = "dau"): string {
    const s = String(text ?? "");
    if (!s) return "";
    const cap = Math.min(tranRieng, this.con);
    if (cap <= 0) return "";
    const { text: out } = catTheoNganSachToken(s, cap, giu);
    this.conLai -= uocLuongSoToken(out);
    return out;
  }
}

async function warmCodeModel(): Promise<void> {
  try {
    const { warmModel } = await import("../aiGgufEngine");
    let modelId: string | undefined;
    try {
      const { route } = await import("../aiModelRouter");
      modelId = route({ task: "code", text: "warm", requiredQuality: "high" }).modelId;
    } catch {
      /* best-effort routing */
    }
    // Warm the deep code model FIRST (before RAG loads the small embedder) — see warmModel.
    await warmModel(modelId, CODE_CTX);
  } catch {
    /* best-effort warm; codegen still tries and degrades gracefully on failure */
  }
}

// ── Đợt 2 · Task 2 (doc71) — nối vào aiGateway CHỈ ĐỂ ĐO ────────────────────────────────────
//
// Đợt 0 đo được: module này gọi THẲNG aiGgufEngine (chatCompletion/generateJSON/generateFim),
// không qua aiGateway.ts (nơi ghi bảng `ai_gateway_metrics`) ⇒ 6 lượt gọi thật ⇒ 0 dòng metric.
// `ai_model_metrics` cũng 0 dòng — không có nguồn thay thế nào đo được tier "code"/"fim".
//
// Thiết kế ở đây CỐ TÌNH tách rời khỏi việc CHỌN model: mỗi call site dưới vẫn tự `route()`
// (KHÔNG đổi) để quyết định modelId/maxTokens/temperature/contextSize truyền cho engine — y
// hệt trước Task 2. `planMetric()`/`safeRecordMetric()` chỉ mở một đường SONG SONG, độc lập,
// để ghi lượt gọi vào `ai_gateway_metrics` qua `aiGateway.planInference()` (kiểu "cheapest
// adoption" — xem header aiGateway.ts). KHÔNG dùng `routeInference()` (wrapper "full adoption")
// vì nó sẽ khiến quyết định model đến từ gateway thay vì route() cục bộ — đúng thứ task này
// CẤM đổi.
//
// Fail-open TUYỆT ĐỐI ở CẢ HAI nửa (lập kế hoạch đo lẫn ghi kết quả đo): planInference có thể
// ném lỗi thật (rate-limit/safety-block/license/quota — xem aiGateway.ts) và record() có thể
// ném lỗi nội bộ (vd DB, hoặc router phụ thuộc bị mock thiếu trong test) — cả hai đường đều
// bọc try/catch RIÊNG, không bao giờ để lỗi đo lường làm mất kết quả sinh mã đã có.
async function planMetric(task: "code" | "fim", text: string) {
  try {
    const { planInference } = await import("../aiGateway");
    return await planInference({ task, text });
  } catch (e) {
    console.warn(
      `[aiProgrammingCopilot] gateway metric plan failed for task="${task}" (bỏ qua ghi metric, không ảnh hưởng sinh mã):`,
      (e as Error)?.message ?? e,
    );
    return null;
  }
}

/** Ghi kết quả đo — KHÔNG BAO GIỜ ném ra ngoài (fail-open); `plan` null → no-op im lặng. */
function safeRecordMetric(plan: Awaited<ReturnType<typeof planMetric>>, outcome: Parameters<NonNullable<Awaited<ReturnType<typeof planMetric>>>["record"]>[0]): void {
  if (!plan) return;
  try {
    plan.record(outcome);
  } catch (e) {
    console.warn("[aiProgrammingCopilot] gateway metric record failed (bỏ qua, không ảnh hưởng sinh mã):", (e as Error)?.message ?? e);
  }
}

/**
 * ★★★ G5-D — KẾT CỤC CỦA MỘT LƯỢT GỌI MODEL SINH MÃ. Bốn ca, và **ba trong bốn ca trước đây bị
 * bẹp thành cùng một `null`** ⇒ người dùng đọc đúng một câu *"AI code model offline — no
 * suggestion generated (fail-safe)"* cho cả ba.
 *
 * Vì sao đó là lỗi chứ không phải "phòng thủ": ba ca ấy đòi ba hành động KHÁC HẲN nhau —
 *   • `offline`  — chưa cài/chưa bật GGUF ⇒ việc của người vận hành, không phải của kỹ sư.
 *   • `im-lang`  — model chạy, trả về rác/thoái hoá ⇒ thử lại, đổi cách hỏi.
 *   • `hong`     — **HỆ THỐNG hỏng** (cổng G1-D chặn nạp trùng · vượt ngữ cảnh · model cạn token
 *                  vào suy luận · llama-server chết). Kỹ sư có thử lại một trăm lần cũng vô ích,
 *                  và câu "AI offline" gửi anh ta đi sai hướng.
 * Theo đúng văn hoá **TỪ CHỐI TRUNG THỰC** đã có ở `aiLocalKnowledgeService`: nói ra chuyện gì
 * hỏng, đừng giả vờ là "AI không nghĩ ra gì".
 */
type KetCucModelMa =
  | { loai: "co-chu"; text: string }
  | { loai: "offline" }
  | { loai: "im-lang"; lyDo: string }
  | { loai: "hong"; lyDo: string };

/**
 * Câu hiển thị cho một lượt KHÔNG có mã. ⚠ MỘT chỗ dựng câu cho MỌI điểm gọi — ba điểm gọi tự
 * viết ba câu là ba cơ hội để một điểm quên mất ca `hong` và lại nuốt lỗi.
 */
function cauKhongCoMa(kc: Exclude<KetCucModelMa, { loai: "co-chu" }>, viec: string): string {
  if (kc.loai === "offline") return `AI code model offline — no ${viec} generated (fail-safe).`;
  if (kc.loai === "im-lang") return `Model chạy nhưng không đưa ra được ${viec} dùng được (${kc.lyDo}). Thử diễn đạt lại yêu cầu.`;
  return (
    `HỆ THỐNG HỎNG — không sinh được ${viec}, và đây KHÔNG phải "AI không nghĩ ra gì": ${kc.lyDo} ` +
    `Thử lại y nguyên sẽ hỏng y nguyên; xem nhật ký máy chủ (và llama-server nếu đang bật) trước khi thử lại.`
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// Doc 80 · Task 10 · AI-09 — CÂU CHO KỸ SƯ ≠ CHI TIẾT CHO NGƯỜI VẬN HÀNH.
//
// Đo (phụ lục A §0): kỹ sư nhận NGUYÊN chuỗi chẩn đoán G1-D/G5-D kèm "TRÍCH SUY LUẬN: Here's a
// thinking process…" trong hộp ghi chú xám. Chuỗi đó ĐÚNG và CẦN (bất biến G5-D: không nuốt lỗi) —
// nhưng người cần nó là người vận hành, không phải kỹ sư đang bấm "Sinh mã". Tách hai kênh:
//   • `note`      — câu NGẮN, theo ngôn ngữ yêu cầu, nói kỹ sư làm gì tiếp;
//   • `errorCode` — khoá ổn định cho i18n phía client;
//   • `devDetail` — `cauKhongCoMa()` NGUYÊN VĂN (router chỉ trả cho admin, UI gập mặc định).
// ════════════════════════════════════════════════════════════════════════════════════════════

export type CopilotErrorCode =
  | "MODEL_OFFLINE"
  | "TOKEN_BUDGET"
  | "CONTEXT_TOO_LARGE"
  | "MODEL_UNAVAILABLE"
  | "EMPTY_OUTPUT"
  | "INTERNAL";

const CAU_LOI: Record<CopilotErrorCode, Record<GateLang, string>> = {
  MODEL_OFFLINE: {
    vi: "Trợ lý lập trình chưa sẵn sàng (model offline). Liên hệ quản trị viên.",
    en: "The programming assistant is not available (model offline). Contact your administrator.",
    zh: "编程助手暂不可用（模型离线）。请联系管理员。",
  },
  TOKEN_BUDGET: {
    vi: "Trợ lý chưa trả lời được (hết ngân sách xử lý). Thử lại hoặc rút ngắn yêu cầu.",
    en: "The assistant could not finish (processing budget exhausted). Try again or shorten the request.",
    zh: "助手未能完成回答（处理预算已用尽）。请重试或缩短请求。",
  },
  CONTEXT_TOO_LARGE: {
    vi: "Yêu cầu hoặc chương trình quá dài để trợ lý xử lý. Rút ngắn rồi thử lại.",
    en: "The request or program is too long for the assistant. Shorten it and try again.",
    zh: "请求或程序过长，助手无法处理。请缩短后重试。",
  },
  MODEL_UNAVAILABLE: {
    vi: "Máy chủ AI đang bận hoặc không phản hồi. Thử lại sau ít phút.",
    en: "The AI server is busy or not responding. Try again in a few minutes.",
    zh: "AI 服务器繁忙或无响应。请稍后重试。",
  },
  EMPTY_OUTPUT: {
    vi: "Trợ lý không đưa ra được kết quả dùng được. Thử diễn đạt lại yêu cầu.",
    en: "The assistant did not produce a usable result. Try rephrasing the request.",
    zh: "助手未能给出可用结果。请换一种说法重试。",
  },
  INTERNAL: {
    vi: "Trợ lý gặp lỗi hệ thống. Thử lại; nếu lặp lại, báo quản trị viên.",
    en: "The assistant hit a system error. Try again; if it repeats, contact your administrator.",
    zh: "助手遇到系统错误。请重试；如仍出现，请联系管理员。",
  },
};

function maLoiCua(kc: Exclude<KetCucModelMa, { loai: "co-chu" }>): CopilotErrorCode {
  if (kc.loai === "offline") return "MODEL_OFFLINE";
  if (kc.loai === "im-lang") return "EMPTY_OUTPUT";
  const s = kc.lyDo;
  // Thứ tự có chủ đích: câu G5-D (cạn token vào suy luận) có thể nằm LỒNG trong câu G1-D.
  if (/G5-D|reasoning_content|SUY LUẬN/i.test(s)) return "TOKEN_BUDGET";
  if (/exceed_context_size|exceeds the available context|maximum context length|prompt is too long|n_ctx|vượt ngữ cảnh|NGÂN SÁCH NGỮ CẢNH/i.test(s)) return "CONTEXT_TOO_LARGE";
  if (/timeout|timed out|aborted|ECONNREFUSED|ECONNRESET|fetch failed|HTTP 5\d\d|slot/i.test(s)) return "MODEL_UNAVAILABLE";
  return "INTERNAL";
}

/** Một lượt KHÔNG có mã ⇒ { note ngắn, errorCode, devDetail nguyên văn }. MỘT chỗ dựng cho mọi điểm gọi. */
function ketQuaKhongCoMa(
  kc: Exclude<KetCucModelMa, { loai: "co-chu" }>,
  viec: string,
  lang: GateLang,
): { note: string; errorCode: CopilotErrorCode; devDetail: string } {
  const errorCode = maLoiCua(kc);
  return { note: CAU_LOI[errorCode][lang], errorCode, devDetail: cauKhongCoMa(kc, viec) };
}

/**
 * Call the code-tier LLM. Routes via aiModelRouter task:"code" to pick the code tier +
 * token/temperature budget; strips any `<think>` block so reasoning never leaks. Everything
 * is dynamically imported (mirrors the codebase's lazy-engine pattern) so the module stays
 * light and never pulls node-llama-cpp at import time.
 *
 * ★ G5-D — KHÔNG CÒN NUỐT LỖI. Trước bản vá, mọi throw ở đây (kể cả *"llama-server còn sống nên
 * CẤM nạp bản thứ hai"* của cổng G1-D — thứ xảy ra ở ĐÚNG cấu hình `GGUF_CODE_MODEL ==
 * LLAMA_SERVER_MODEL`) chỉ để lại một `console.warn` rồi trả `null`, và người dùng đọc "AI
 * offline". Nay lỗi được PHÂN LOẠI và mang lên tới câu trả lời.
 */
async function runCodeModel(system: string, user: string, loai: LoaiLuotCopilot): Promise<KetCucModelMa> {
  const metricStart = Date.now();
  let metricPlan: Awaited<ReturnType<typeof planMetric>> = null;
  try {
    const { isGgufAvailable, chatCompletion, stripThinking } = await import("../aiGgufEngine");
    if (!(await isGgufAvailable())) return { loai: "offline" };

    let maxTokens = 1536;
    let temperature = 0.3;
    let contextSize: number | undefined;
    let modelId: string | undefined;
    try {
      const { route } = await import("../aiModelRouter");
      const d = route({ task: "code", text: user, requiredQuality: "high" });
      maxTokens = Math.max(512, d.maxTokens ?? maxTokens);
      temperature = d.temperature ?? temperature;
      contextSize = Math.min(d.contextSize ?? CODE_CTX, CODE_CTX);
      modelId = d.modelId;
    } catch {
      /* keep defaults — router is best-effort */
    }

    // Doc 80 · D1 — chính sách nghĩ theo loại lượt (route `code` dùng chung KHÔNG đổi).
    const cs = chinhSachLuot(loai, maxTokens, contextSize ?? CODE_CTX);

    // Đợt 2 · Task 2 — lập kế hoạch đo (SONG SONG, không ảnh hưởng modelId/maxTokens/temperature/
    // contextSize ở TRÊN — những giá trị đó vẫn đến từ route() cục bộ y hệt trước Task 2).
    metricPlan = await planMetric("code", user);

    const res = await chatCompletion(
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: cs.maxTokens,
        temperature,
        contextSize,
        ...(cs.disableThinking ? { disableThinking: true } : {}),
        ...(cs.thinkingBudgetTokens ? { thinkingBudgetTokens: cs.thinkingBudgetTokens } : {}),
      },
      modelId,
    );
    safeRecordMetric(metricPlan, {
      tokensIn: res?.tokensPrompt,
      tokensOut: res?.tokensGenerated,
      latencyMs: Date.now() - metricStart,
      outcome: "ok",
    });
    const raw = res?.text ?? "";
    // G5-D — `?? raw` đã bị XOÁ. `stripThinking().answer` LUÔN là một chuỗi (kiểu `string`, xem
    // `ai/thinkingStrip.ts`), nên `??` không bao giờ chạy ⇒ **mã chết**. Nhưng nó ĐỌC như một
    // fail-open: "cắt hỏng thì trả lại nguyên văn", tức đúng cái hàng rào R2 của `thinkingStrip`
    // được dựng ra để bỏ. Một dòng mã chết trông giống một lỗ vẫn là nợ: người sửa sau đọc nó rồi
    // tưởng đường lùi ấy có thật, và sẽ có ngày làm nó thành thật.
    const answer = stripThinking(raw).answer;
    // FE-W0.3 (doc 46 §2.3) — reject a degenerate loop ("cell cell cell…") so the
    // copilot degrades to its honest path rather than returning garbage code. Salvaging a head is
    // unsafe for CODE, so unsalvageable OR salvaged-but-truncated → treat as no output.
    const { guardGeneratedText } = await import("../ai/generationGuard");
    const g = guardGeneratedText(answer);
    if (g.degraded) {
      console.warn(`[aiProgrammingCopilot] degenerate code output rejected (${g.reason}) — degrading to no-suggestion.`);
      return { loai: "im-lang", lyDo: `đầu ra thoái hoá: ${g.reason}` };
    }
    // Model chạy xong, không rác, nhưng KHÔNG có chữ. Đây là "không nghĩ ra gì" thật — ca duy nhất
    // xứng đáng với câu ấy.
    if (!g.text.trim()) return { loai: "im-lang", lyDo: "model trả về chuỗi rỗng" };
    return { loai: "co-chu", text: g.text };
  } catch (e) {
    safeRecordMetric(metricPlan, { latencyMs: Date.now() - metricStart, outcome: "error" });
    const chiTiet = (e as Error)?.message ?? String(e);
    // ⚠ `console.warn` MỘT MÌNH chính là chỗ lỗi bị nuốt: không ai đọc log máy chủ khi bấm nút
    // "sinh mã". Giữ log (cho người vận hành) VÀ mang lỗi lên câu trả lời (cho kỹ sư).
    console.error("[aiProgrammingCopilot] lượt gọi model sinh mã HỎNG (không nuốt, báo lên UI):", chiTiet);
    return { loai: "hong", lyDo: chiTiet };
  }
}

/**
 * Doc 34 · P4 (1b) — STRUCTURED-JSON codegen for ir-flow / iec61131-pou. Grammar-constrains the
 * model to `schema` (node-llama-cpp GBNF via generateJSON), so it emits a SCHEMA-VALID object:
 * the array wrapper (`blocks` / `pous`) + the discriminator are FORCED and generation STOPS at
 * the closing brace — which is exactly what the eval's two structural failures needed (a missing
 * `pous` wrapper; trailing prose after the IR JSON). Returns the pretty-printed JSON string.
 *
 * Fail-safe: returns NULL when GGUF is offline OR on ANY error (grammar build / generation /
 * parse) — the caller then FALLS BACK to the free-text runCodeModel path, so a grammar hiccup
 * never crashes and never blocks a suggestion. Routes via aiModelRouter (task:"code") like
 * runCodeModel; CODE_CTX caps the KV-cache (see warmCodeModel). Dynamically imported to keep the
 * module light (mirrors the lazy-engine pattern).
 */
async function runStructuredCodeModel(
  system: string,
  user: string,
  schema: object,
): Promise<string | null> {
  const metricStart = Date.now();
  let metricPlan: Awaited<ReturnType<typeof planMetric>> = null;
  try {
    const { isGgufAvailable, generateJSON } = await import("../aiGgufEngine");
    if (!(await isGgufAvailable())) return null;

    let maxTokens = 1536;
    let temperature = 0.2;
    let contextSize: number = CODE_CTX;
    let modelId: string | undefined;
    try {
      const { route } = await import("../aiModelRouter");
      const d = route({ task: "code", text: user, requiredQuality: "high" });
      maxTokens = Math.max(512, d.maxTokens ?? maxTokens);
      temperature = d.temperature ?? temperature;
      contextSize = Math.min(d.contextSize ?? CODE_CTX, CODE_CTX);
      modelId = d.modelId;
    } catch {
      /* keep defaults — router is best-effort */
    }

    // Đợt 2 · Task 2 — cùng đường đo như runCodeModel (planMetric SONG SONG với route() cục bộ
    // ở trên; task="code" vì đây vẫn là tier code, chỉ khác hình dạng đầu ra — JSON grammar-
    // constrained thay vì free-text).
    metricPlan = await planMetric("code", user);

    // Doc 80 · D1 — lượt JSON LUÔN tắt nghĩ (llama.cpp hoãn grammar tới khi khối nghĩ đóng).
    const cs = chinhSachLuot("json", maxTokens, contextSize);
    const result = await generateJSON<unknown>(
      schema,
      { systemPrompt: system, prompt: user, maxTokens: cs.maxTokens, temperature, contextSize, disableThinking: cs.disableThinking },
      modelId,
    );
    safeRecordMetric(metricPlan, {
      tokensIn: result?.tokensPrompt,
      tokensOut: result?.tokensGenerated,
      latencyMs: Date.now() - metricStart,
      outcome: result?.data == null ? "error" : "ok",
    });
    if (result?.data == null) return null;
    // The grammar guarantees a valid object; JSON.stringify gives the artifact `content` the
    // programmingAdapter validates. Pretty-printed to mirror the free-text codegen style.
    return JSON.stringify(result.data, null, 2);
  } catch (e) {
    safeRecordMetric(metricPlan, { latencyMs: Date.now() - metricStart, outcome: "error" });
    console.warn(
      "[aiProgrammingCopilot] structured JSON codegen failed (falling back to free-text):",
      (e as Error)?.message ?? e,
    );
    return null;
  }
}

/**
 * G2-A — lấy khối CHỈ MỤC REPO bằng phần token CÒN LẠI của hồ, rồi trừ đúng số đã dùng.
 *
 * Ba tính chất được cưỡng chế ở đây, không phải ở chỗ gọi:
 *   • hồ cạn ⇒ trả "" mà KHÔNG truy hồi (không embed, không rerank — cổng rẻ trước cổng tốn);
 *   • trần riêng `NGAN_SACH_PHAN.repoIndex` chống một lượt truy hồi "trúng đậm" nuốt hết chỗ;
 *   • mọi lỗi ⇒ "" (fail-safe) — một lượt truy hồi hỏng không được làm mất lượt sinh mã.
 */
async function layNguCanhRepo(query: string, ho: HoToken, callerRole?: string): Promise<string> {
  // `ho.layKhoi` tự kẹp theo hồ VÀ tự trừ — xem chú thích của nó về đột biến M6.
  return ho.layKhoi(async (cap) => {
    try {
      const r = await gatherRepoIndexContext({ query, maxTokens: cap, callerRole });
      return r.block;
    } catch (e) {
      console.warn("[aiProgrammingCopilot] G2-A chỉ mục repo hỏng (bỏ qua):", (e as Error)?.message ?? e);
      return "";
    }
  }, NGAN_SACH_PHAN.repoIndex);
}

/** Retrieve cited programming-manual context (fail-safe → empty, never throws). */
async function retrieveContext(
  query: string,
  vendor: string | undefined,
): Promise<{ answerContext: string; citations: GenCitation[] }> {
  try {
    const { searchProgrammingKb } = await import("../aiProgrammingKnowledgeService");
    const r = await searchProgrammingKb({ query, vendor, topK: 5 });
    const citations: GenCitation[] = (r.citations ?? []).map((c) => ({
      vendor: c.vendor,
      docTitle: c.docTitle,
      page: typeof c.page === "number" ? c.page : null,
    }));
    return { answerContext: r.answerContext ?? "", citations };
  } catch (e) {
    console.warn("[aiProgrammingCopilot] KB retrieval failed (empty context):", (e as Error)?.message ?? e);
    return { answerContext: "", citations: [] };
  }
}

/**
 * Run the generated code through the SAME safety substrate the human uses: validate() for
 * every adapter-backed kind, plus compile() for ir-flow / iec61131-pou (their safety-linter
 * + transpile hard gate). `ran=false` means there is no substrate validator for this kind
 * (a Tier-B text target) — a loud UNVALIDATED warning is attached and ok is false.
 */
async function runValidation(
  kind: string,
  language: string,
  content: string,
): Promise<{ validation: GenValidation; ran: boolean }> {
  const diagnostics: GenValidation["diagnostics"] = [];
  const known = (PROGRAMMING_KINDS as string[]).includes(kind);
  if (!known || !programmingRegistry.isImplemented(kind as ProgrammingKind)) {
    diagnostics.push({
      severity: "warning",
      message:
        `No substrate validator for kind "${kind}" — output is UNVALIDATED. Verify it against the ` +
        `vendor manual and simulate before any device use.`,
    });
    return { validation: { ok: false, diagnostics }, ran: false };
  }
  try {
    const adapter = programmingRegistry.getAdapter(kind as ProgrammingKind);
    const v = await adapter.validate({ kind: kind as ProgrammingKind, language, content });
    for (const d of v.diagnostics) diagnostics.push({ severity: d.severity, message: d.message, line: d.line });
    let ok = v.ok;
    if (ok && COMPILE_ALSO.has(kind)) {
      const b = await adapter.compile({ kind: kind as ProgrammingKind, language, content });
      for (const d of b.diagnostics) {
        if (!diagnostics.some((x) => x.message === d.message)) {
          diagnostics.push({ severity: d.severity, message: d.message, line: d.line });
        }
      }
      ok = ok && b.ok;
    }
    return { validation: { ok, diagnostics }, ran: true };
  } catch (e) {
    diagnostics.push({ severity: "error", message: `Validation failed to run: ${(e as Error)?.message ?? e}` });
    return { validation: { ok: false, diagnostics }, ran: true };
  }
}

// ── Self-repair (doc 34 P4c #1) ──────────────────────────────────────────────
/** Self-repair loop ON by default (the whole point); set AI_CODEGEN_SELF_REPAIR=false to disable. */
function repairEnabled(): boolean {
  const v = process.env.AI_CODEGEN_SELF_REPAIR;
  return v === undefined ? true : v === "true" || v === "1";
}
/** Max repair rounds (default 2, hard-capped at 4 to bound latency). */
function repairMax(): number {
  const n = Number(process.env.AI_CODEGEN_REPAIR_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 4) : 2;
}
/** Turn substrate diagnostics into a fix-it prompt: the failed code + the exact errors → corrected code. */
function buildRepairPrompt(
  outKind: string,
  request: string,
  code: string,
  diagnostics: GenValidation["diagnostics"],
  ragContext: string,
): string {
  const diagText = (diagnostics ?? [])
    .slice(0, 8)
    .map((d) => `- [${d.severity}] ${d.message}${d.line ? ` (line ${d.line})` : ""}`)
    .join("\n");
  return [
    `The ${outKind} program below FAILED validation. Fix EVERY listed error and return ONLY the`,
    `corrected, complete ${outKind} program in the same format (no explanation, no extra prose).`,
    `Keep the original intent: ${request}`,
    "",
    "=== program ===",
    code,
    "",
    "=== validation errors ===",
    diagText || "(unspecified)",
    ragContext ? `\n=== relevant manual context ===\n${ragContext}` : "",
  ]
    .filter((s) => s !== undefined)
    .join("\n");
}

/**
 * Generate / complete / translate / review / explain a device program with the code-tier LLM,
 * grounded by golden few-shot + cited RAG, with EVERY generated program validated through the
 * programmingAdapter substrate before it is returned. DISPLAY-ONLY — opens no device path.
 *
 * @see module header for the safety invariants this upholds.
 */
export async function generateProgram(input: GenerateProgramInput): Promise<GenerateProgramResult> {
  const kind = String(input?.kind ?? "").trim();
  const mode: CopilotMode = input?.mode ?? "generate";
  const request = String(input?.request ?? "").trim();

  // 1) Flag gate → well-formed disabled result (no model load, no crash).
  if (!copilotEnabled()) {
    return { ok: false, refused: false, kind, note: "AI_PROGRAMMING_COPILOT_ENABLED is off." };
  }

  // 2) SAFETY GATE (Doc 80 · Task 10 · D4) — chạy TRƯỚC mọi thứ tốn kém (warm model, RAG, model)
  //    cho MỌI mode, kể cả review/explain: bị chặn ⇒ không tốn một lượt model nào. Kết quả thống
  //    nhất { refused, refusalSource:"gate", reasonCode, userMessage }; `reason` giữ cho client cũ.
  const gate = checkCopilotSafety({
    mode,
    request,
    contextCode: input?.contextCode,
    targetKind: input?.targetKind,
    kind,
  });
  if (gate.refused) {
    return {
      ok: false,
      refused: true,
      refusalSource: "gate",
      reasonCode: gate.reasonCode,
      userMessage: gate.userMessage,
      reason: gate.userMessage,
      kind,
    };
  }

  // Output kind: translate → targetKind; otherwise the request kind.
  const outKind = (mode === "translate" ? input?.targetKind || kind : kind).trim();
  const language = langForKind(outKind);

  // Load-order VRAM fix: warm the LARGE code model before the small RAG embedder loads
  // (see warmCodeModel). No-op once resident, so only the first request pays the load.
  await warmCodeModel();

  // 3) Ground with cited RAG — attach citations to EVERY result (even when empty).
  const ragSeed = request || (input?.contextCode ? String(input.contextCode).slice(0, 400) : outKind);
  const { answerContext, citations } = await retrieveContext(`${outKind} ${ragSeed}`.trim(), input?.vendor);

  // G2-A — ngân sách ngữ cảnh của lượt này (xem khối NGAN_SACH_PHAN ở trên về thứ tự ưu tiên).
  const nganSach = await canNganSach(request, mode === "explain" || mode === "review" ? "giai-thich" : "sinh");

  // ── EXPLAIN / REVIEW: no codegen; grounded LLM explanation of the provided code. ──
  if (mode === "explain" || mode === "review") {
    const code = String(input?.contextCode ?? "").trim();
    if (!code) {
      return { ok: false, refused: false, kind, citations, note: `mode="${mode}" needs contextCode (the program to ${mode}).` };
    }
    const system = buildSystemPrompt(mode, outKind, language);
    const ho = new HoToken(nganSach.tranVao);
    ho.tru(uocLuongSoToken(system) + uocLuongSoToken(request));
    // Ưu tiên 2: chương trình đem đi giải thích/review CHÍNH LÀ đối tượng — giữ ĐẦU (khai báo
    // biến / header là thứ không bỏ được khi đọc hiểu một chương trình).
    const codeVua = ho.lay(code, NGAN_SACH_PHAN.contextCode, "dau");
    // Ưu tiên 4: manual hãng.
    const vendorVua = ho.lay(answerContext, NGAN_SACH_PHAN.vendorKb, "dau");
    // Ưu tiên 5: chỉ mục repo — lấy phần CÒN LẠI, không bao giờ lấn phần trên.
    const repo = await layNguCanhRepo(`${outKind} ${request || ragSeed}`.trim(), ho, input?.callerRole);
    if (!codeVua) {
      // Từ chối TRUNG THỰC thay vì gửi một prompt có khối PROGRAM rỗng rồi trả lời về hư không.
      return {
        ok: false,
        refused: false,
        kind,
        citations,
        note: `Ngân sách ngữ cảnh không đủ cho chương trình này (cửa sổ ${nganSach.ctx} token) — rút ngắn yêu cầu hoặc chương trình rồi thử lại.`,
      };
    }
    const user = buildExplainPrompt(mode, outKind, language, request, codeVua, vendorVua, repo);
    const out = await runCodeModel(system, user, "giai-thich");
    if (out.loai !== "co-chu") {
      return { ok: false, refused: false, kind, citations, ...ketQuaKhongCoMa(out, "explanation", detectRequestLang(request)) };
    }
    return { ok: true, refused: false, kind, explanation: out.text.trim(), citations };
  }

  // ── GENERATE / COMPLETE / TRANSLATE: produce code, then VALIDATE before returning. ──
  const golden = selectGoldenExamples({
    kind: outKind,
    lang: outKind,
    tags: deriveTags(request, input?.contextCode),
    limit: 2,
  });
  const goldenBlock = formatGoldenExamplesForPrompt(golden);
  const system = buildSystemPrompt(mode, outKind, language);

  // G2-A — lắp prompt QUA CÁI HỒ TOKEN, theo đúng thứ tự ưu tiên đã khai ở NGAN_SACH_PHAN.
  const ho = new HoToken(nganSach.tranVao);
  ho.tru(uocLuongSoToken(system) + uocLuongSoToken(request));
  // Ưu tiên 2 — buffer người dùng. `complete` giữ ĐUÔI (con trỏ nằm ở cuối buffer đang soạn);
  // `translate` giữ ĐẦU (bản dịch phải bắt đầu từ đầu chương trình nguồn).
  const contextCodeVua = ho.lay(input?.contextCode, NGAN_SACH_PHAN.contextCode, mode === "complete" ? "cuoi" : "dau");
  // Ưu tiên 3 — few-shot cú pháp đúng.
  const goldenVua = ho.lay(goldenBlock, NGAN_SACH_PHAN.golden, "dau");
  // Ưu tiên 4 — manual hãng.
  const vendorVua = ho.lay(answerContext, NGAN_SACH_PHAN.vendorKb, "dau");
  // Ưu tiên 5 — chỉ mục repo, phần CÒN LẠI. Hết hồ ⇒ không truy hồi luôn (cổng rẻ trước cổng tốn).
  const repoBlock = await layNguCanhRepo(`${outKind} ${request}`.trim(), ho, input?.callerRole);

  const user = buildCodePrompt(mode, kind, outKind, language, request, contextCodeVua, goldenVua, vendorVua, repoBlock);

  // Doc 34 · P4 (1b): STRUCTURED-JSON kinds (ir-flow / iec61131-pou) → GBNF grammar-constrained
  // generation so the model emits a schema-valid object (forced array wrapper + discriminator,
  // stops at the closing brace → no trailing text). Both eval failures were purely structural.
  // Fail-safe: offline OR any grammar/generation error → fall through to the free-text path.
  const jsonSchema = getCodegenJsonSchema(outKind);
  let code = "";
  if (jsonSchema) {
    const json = await runStructuredCodeModel(system, user, jsonSchema);
    if (json != null) code = json; // else falls through to free-text below
  }
  if (!code) {
    const out = await runCodeModel(system, user, "sinh");
    if (out.loai !== "co-chu") {
      return { ok: false, refused: false, kind: outKind, citations, ...ketQuaKhongCoMa(out, "suggestion", detectRequestLang(request)) };
    }
    code = extractCode(out.text);
  }
  // Doc 80 · D3 (AI-05) — hậu kiểm: gỡ header golden / dòng SAFETY / `_safety_note` bị model chép lại.
  code = goVoJsonChoKindVanBan(goHeaderGoldenKhoiMa(code), !!jsonSchema);
  if (!code) {
    return { ok: false, refused: false, kind: outKind, citations, note: "The model returned no code." };
  }

  // Substrate validation — REQUIRED by default. Errors are SURFACED, never hidden: on failure
  // the code is still returned with ok:false + diagnostics so the engineer sees what is wrong.
  // No deploy / upload / run — display only.
  const required = validateRequired();
  let { validation, ran } = await runValidation(outKind, language, code);

  // Doc 34 P4c (#1) — SELF-REPAIR LOOP. The substrate validator (already run above) becomes a
  // feedback signal: while it reports errors, feed the diagnostics + failed code back to the model
  // and ask for a fix, up to N rounds. Auto-corrects first-pass failures WITHOUT a bigger model.
  // Structured kinds stay GBNF-constrained; safety refusal already happened up top; still DISPLAY-ONLY.
  let repairAttempts = 0;
  const maxRepair = repairEnabled() ? repairMax() : 0;
  while (ran && !validation.ok && repairAttempts < maxRepair) {
    repairAttempts++;
    // G2-A — dùng bản manual ĐÃ CẮT (`vendorVua`), không phải `answerContext` nguyên bản: vòng tự
    // sửa gửi thêm cả mã hỏng + danh sách lỗi, nên đây là prompt DÀI NHẤT của cả lượt.
    const repairUser = buildRepairPrompt(outKind, request, code, validation.diagnostics, vendorVua);
    let fixed = "";
    if (jsonSchema) {
      const j = await runStructuredCodeModel(system, repairUser, jsonSchema);
      if (j != null) fixed = j;
    }
    if (!fixed) {
      const out = await runCodeModel(system, repairUser, "tu-sua");
      if (out.loai === "co-chu") fixed = extractCode(out.text);
      // ⚠ Vòng TỰ SỬA cố ý KHÔNG dựng câu lỗi ở đây: lượt trước đã có mã + chẩn đoán để trả về, và
      // thay nó bằng một câu lỗi là làm người dùng MẤT thứ đã có. Nhưng ca `hong` phải để lại dấu
      // vết — nếu không, một cổng G1-D đang chặn sẽ trông y hệt "model không sửa được".
      else if (out.loai === "hong") {
        console.error(`[aiProgrammingCopilot] vòng tự sửa ${repairAttempts}: lượt gọi model HỎNG — ${out.lyDo}`);
      }
    }
    if (fixed) fixed = goVoJsonChoKindVanBan(goHeaderGoldenKhoiMa(fixed), !!jsonSchema); // D3 + Fix 4 — cùng hậu kiểm cho lượt tự sửa
    if (!fixed) break; // model returned nothing — keep the previous attempt + its diagnostics
    const re = await runValidation(outKind, language, fixed);
    code = fixed;
    validation = re.validation;
    ran = re.ran;
    if (validation.ok) break;
  }

  const ok = required ? validation.ok : ran ? validation.ok : true;
  const note = !ran
    ? `No substrate validator for "${outKind}" — output is UNVALIDATED (Tier-B / text target). Verify against the vendor manual + simulate before any device use.`
    : validation.ok
      ? repairAttempts > 0
        ? `Auto-repaired in ${repairAttempts} round(s) → passes substrate validation.`
        : undefined
      : `Generated code FAILED substrate validation${repairAttempts > 0 ? ` after ${repairAttempts} repair round(s)` : ""} — review the diagnostics before use (not deployed).`;

  return { ok, refused: false, kind: outKind, code, validation, citations, note, repairAttempts };
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 69 Wave 4 · C1 — IN-EDITOR INLINE completion (fill-in-middle ghost text).
//
// A DIFFERENT surface from generateProgram() above: a short in-editor infill suggested as
// the engineer types (CodeMirror ghost text, Tab to accept), wired to generateFim() (doc 34
// P0's FIM engine). It deliberately does NOT run generateProgram's author HARD-REFUSE guard
// or programmingAdapter validation — this is trivially short fill-in-middle infill, not an
// authored program, and nothing is ever inserted without the engineer pressing Tab — but it
// stays BOUNDED (small maxTokens + a hard char cap + a stop sequence) so a runaway
// completion can never hand the editor a large block of unreviewed code.
//
// FAIL-SAFE at every branch: flag off / no prefix+suffix / model absent-slow-or-erroring →
// {completion:""} (the editor simply shows no ghost text). NEVER throws.
// ════════════════════════════════════════════════════════════════════════════

export interface CompleteInlineInput {
  /** Code immediately BEFORE the cursor. The router bounds this length before it reaches here. */
  prefix: string;
  /** Code immediately AFTER the cursor (optional — enables true fill-in-middle). */
  suffix?: string;
  /** Language hint (informational; generateFim's infill path is language-agnostic text). */
  language?: string;
  /** Caller-requested token budget; clamped into [1, INLINE_HARD_MAX_TOKENS]. */
  maxTokens?: number;
}

export interface CompleteInlineResult {
  completion: string;
}

/** Inline completions are ghost text, not authored programs — keep them SHORT. */
const INLINE_DEFAULT_MAX_TOKENS = 48;
const INLINE_HARD_MAX_TOKENS = 128;
/** Belt-and-braces char cap even if the model ignores maxTokens/stop sequences. */
const INLINE_MAX_CHARS = 480;

function clampInlineMaxTokens(requested?: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return INLINE_DEFAULT_MAX_TOKENS;
  }
  return Math.min(Math.floor(requested), INLINE_HARD_MAX_TOKENS);
}

/**
 * Doc 69 · C1 — inline fill-in-middle completion for the CodeMirror ghost-text extension.
 * Thin wrapper over generateFim() (server/services/aiGgufEngine.ts) with sane inline
 * defaults. Fail-safe at every branch — see module header. Dynamically imports
 * aiGgufEngine (mirrors this file's other lazy-engine call sites) so importing this module
 * never pulls node-llama-cpp in eagerly.
 */
export async function completeInline(input: CompleteInlineInput): Promise<CompleteInlineResult> {
  if (!copilotEnabled()) return { completion: "" };

  const prefix = typeof input?.prefix === "string" ? input.prefix : "";
  const suffix = typeof input?.suffix === "string" ? input.suffix : "";
  if (!prefix.trim() && !suffix.trim()) return { completion: "" };
  // Doc 80 · Task 10 · D4 — ghost-text: 400 ký tự quanh con trỏ có tín hiệu an toàn (ESTOP*,
  // *INTERLOCK*, GUARD*…) hoặc một cụm bypass ⇒ KHÔNG gợi ý (đo phụ lục A: I4 "bypass e-stop" từng
  // nhận `Q_Motor := 0` ×7). Chặn trước model — không tốn lượt FIM.
  if (inlineCompletionBlocked(prefix, suffix)) return { completion: "" };

  const metricStart = Date.now();
  let metricPlan: Awaited<ReturnType<typeof planMetric>> = null;
  try {
    const { generateFim, stripThinking } = await import("../aiGgufEngine");

    // Doc69 W2-C — resolve the model EXPLICITLY before calling generateFim instead of
    // leaving the second arg `undefined` (the OLD call shape below). Wave 1's lesson:
    // getOrLoadModel(undefined) can reuse whatever model happens to already be resident
    // (including the embedder) rather than the intended FIM/code model.
    //
    // Final-fix round (C-1, CRITICAL) — `fimModelBasename()` (GGUF_FIM_MODEL → GGUF_FAST_MODEL
    // → GGUF_DEFAULT_MODEL) is the CORRECT BASE, always, regardless of AI_CODE_ROUTER_ENABLED:
    // it is the operator's dedicated FIM/ghost-text model. The PRIOR version of this code took
    // aiModelRouter.route({task:"fim"}).modelId as authoritative — but route()'s flag-OFF branch
    // (the DEFAULT, see aiModelRouter.ts:369-375) is `fastModelId() ?? defaultModelId()`, which
    // NEVER reads GGUF_FIM_MODEL at all. So with the router flag off (every install that hasn't
    // opted in), ghost-text silently used the general fast/default CHAT model instead of the
    // dedicated FIM model — exactly the "generate text with the wrong model" bug class Wave 1
    // existed to fix, reintroduced by Task 7's router integration. Reviewer probe:
    // "PINNED MODEL (router OFF) = GENERAL-FAST-CHAT-MODEL ← SAI".
    //
    // Fix: default to fimModelBasename(); ONLY let route()'s decision override it when
    // AI_CODE_ROUTER_ENABLED is actually on. Router route() is still called unconditionally
    // (both here and inside route() itself) so its telemetry (aiModelRouter.getRouterStats())
    // keeps recording this "fim" decision exactly as before — only the decision of WHICH
    // modelId to trust changed. When the flag IS on, route()'s "fim" branch resolves via this
    // EXACT SAME resolveTaskModel("fim")/fimModelBasename() chain (aiModelRouter.ts:369-372), so
    // the two paths are byte-identical there — this is a pure no-op for that case, satisfying
    // the "cờ BẬT ⇒ hành vi ghim model không đổi" invariant.
    const { fimModelBasename } = await import("../ai/modelResolver");
    let modelId: string | undefined = fimModelBasename();
    try {
      const { route, codeRouterEnabled } = await import("../aiModelRouter");
      const decision = route({ task: "fim", text: prefix.slice(-200) });
      if (codeRouterEnabled() && decision.modelId) modelId = decision.modelId;
    } catch {
      /* best-effort routing — modelId already carries the correct fimModelBasename() fallback */
    }

    // Đợt 2 · Task 2 — cùng cơ chế đo như runCodeModel/runStructuredCodeModel, task="fim" (tầng
    // riêng cho inline completion — xem aiGateway.ts's TaskKind). SONG SONG với việc ghim modelId
    // ở trên: KHÔNG dùng plan.decision để chọn model — bất biến "cờ router BẬT/TẮT ⇒ modelId
    // không đổi" (xem chú thích C-1 phía trên) giữ nguyên.
    metricPlan = await planMetric("fim", prefix.slice(-200));

    const res = await generateFim(
      {
        prefix,
        suffix,
        maxTokens: clampInlineMaxTokens(input?.maxTokens),
        temperature: 0.1,
        // Stop at a blank line — inline completion is a short infill, not a whole file.
        stopSequences: ["\n\n"],
      },
      modelId,
    );
    safeRecordMetric(metricPlan, {
      tokensIn: res?.tokensPrompt,
      tokensOut: res?.tokensGenerated,
      latencyMs: Date.now() - metricStart,
      outcome: "ok",
    });
    const raw = (res?.text ?? "").toString();
    if (!raw) return { completion: "" };
    const { answer } = stripThinking(raw);
    const text = (answer ?? raw).trim();
    if (!text) return { completion: "" };
    return { completion: text.length > INLINE_MAX_CHARS ? text.slice(0, INLINE_MAX_CHARS) : text };
  } catch (e) {
    safeRecordMetric(metricPlan, { latencyMs: Date.now() - metricStart, outcome: "error" });
    console.warn("[aiProgrammingCopilot] inline FIM completion failed (fail-safe empty):", (e as Error)?.message ?? e);
    return { completion: "" };
  }
}
