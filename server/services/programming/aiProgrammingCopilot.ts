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
import { selectGoldenExamples, formatGoldenExamplesForPrompt } from "./goldenExamples";

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

// HARD REFUSAL — the copilot must NEVER author safety-function logic. Strengthened (doc 34
// §5.2): matches E-stop / emergency-stop / interlock / safety-function/relay/PLC / light-
// curtain / two-hand / guard-lock / lockout-tagout / muting, SIL 1..4, Performance-Level a..e,
// plus CJK 安全/急停 terms. Deliberately broad — over-refusal is the safe side. Word-boundary
// anchored so ordinary words ("silicon", "place") do not false-trigger.
const SAFETY_RE =
  /\b(e-?stops?|emergency[-\s]?stops?|emergency|interlocks?|safety(?:[-\s]?(?:function|relay|plc|logic|circuit|door|gate|rated))?|safeties|sil\s?[1-4]?|pl[-\s]?[a-e]|performance[-\s]?level|guard[-\s]?lock(?:ing)?|guard|light[-\s]?curtain|two[-\s]?hand|lockout|tagout|muting|estop)\b|(?:安全|急停|安全门|安全回路|安全继电器|紧急停止|光幕|双手)/i;

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

  if (SAFETY_RE.test(input.intent)) {
    return {
      available: true,
      refused: true,
      reason:
        "The copilot does not author safety logic (E-stop / interlock / SIL / guards). " +
        "That must be implemented by a certified engineer on the certified PLC.",
    };
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
  reason?: string;
  kind: string;
  /** Generated / translated code (absent for explain/review or when refused/degraded). */
  code?: string;
  validation?: GenValidation;
  citations?: GenCitation[];
  /** For review / explain. */
  explanation?: string;
  note?: string;
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

function isCodeMode(mode: CopilotMode): boolean {
  return mode === "generate" || mode === "complete" || mode === "translate";
}

function langForKind(kind: string): string {
  return (LANG_OF as Record<string, string>)[kind] ?? kind ?? "text";
}

/** Extract the first fenced code block from an LLM response; else the trimmed whole text. */
function extractCode(text: string): string {
  if (!text) return "";
  const fence = text.match(/```[a-zA-Z0-9_+.\-]*[ \t]*\r?\n([\s\S]*?)```/);
  if (fence && typeof fence[1] === "string") return fence[1].trim();
  return text.trim();
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
      `TASK STYLE: Output ONLY the ${outKind} program (language: ${language}) inside a SINGLE fenced code block. Put a "SAFETY: simulate and test before running on a device." comment as the LAST line INSIDE the block. No prose outside the block.`,
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
): string {
  const verb = mode === "review" ? "Review" : "Explain";
  const parts: string[] = [];
  parts.push(`TASK: ${verb} the following ${outKind} program (language: ${language}) for an engineer.`);
  if (request) parts.push(`FOCUS: ${request}`);
  parts.push(`PROGRAM:\n\`\`\`\n${code.trim()}\n\`\`\``);
  parts.push(`VENDOR MANUAL CONTEXT (cite by [n]; empty = none available):\n${ragContext || "(none)"}`);
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

async function warmCodeModel(): Promise<void> {
  try {
    const { isGgufAvailable, generateText } = await import("../aiGgufEngine");
    if (!(await isGgufAvailable())) return;
    let modelId: string | undefined;
    try {
      const { route } = await import("../aiModelRouter");
      modelId = route({ task: "code", text: "warm", requiredQuality: "high" }).modelId;
    } catch {
      /* best-effort routing */
    }
    await generateText({ prompt: "ok", maxTokens: 1, contextSize: CODE_CTX }, modelId);
  } catch {
    /* best-effort warm; codegen still tries and degrades gracefully on failure */
  }
}

/**
 * Call the code-tier LLM. Fail-safe: returns null when GGUF is offline or on ANY error (the
 * caller degrades gracefully). Routes via aiModelRouter task:"code" to pick the code tier +
 * token/temperature budget; strips any `<think>` block so reasoning never leaks. Everything
 * is dynamically imported (mirrors the codebase's lazy-engine pattern) so the module stays
 * light and never pulls node-llama-cpp at import time.
 */
async function runCodeModel(system: string, user: string): Promise<string | null> {
  try {
    const { isGgufAvailable, chatCompletion, stripThinking } = await import("../aiGgufEngine");
    if (!(await isGgufAvailable())) return null;

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

    const res = await chatCompletion(
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens,
        temperature,
        contextSize,
      },
      modelId,
    );
    const raw = res?.text ?? "";
    return stripThinking(raw).answer ?? raw;
  } catch (e) {
    console.warn("[aiProgrammingCopilot] code model call failed (degrading):", (e as Error)?.message ?? e);
    return null;
  }
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

  // 2) SAFETY (hard, strengthened) — never AUTHOR safety-function logic. Applies to every
  //    code-producing mode; probes the request + any target-kind/kind hint.
  const safetyProbe = `${request} ${input?.targetKind ?? ""} ${kind}`;
  if (isCodeMode(mode) && SAFETY_RE.test(safetyProbe)) {
    return {
      ok: false,
      refused: true,
      kind,
      reason:
        "Refused: the copilot does not author safety-function logic (E-stop / emergency / interlock / " +
        "light-curtain / two-hand / guard-lock / SIL / PL). That must be implemented and verified by a " +
        "certified engineer on the certified safety controller — never generated by AI.",
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

  // ── EXPLAIN / REVIEW: no codegen; grounded LLM explanation of the provided code. ──
  if (mode === "explain" || mode === "review") {
    const code = String(input?.contextCode ?? "").trim();
    if (!code) {
      return { ok: false, refused: false, kind, citations, note: `mode="${mode}" needs contextCode (the program to ${mode}).` };
    }
    const system = buildSystemPrompt(mode, outKind, language);
    const user = buildExplainPrompt(mode, outKind, language, request, code, answerContext);
    const out = await runCodeModel(system, user);
    if (out == null) {
      return { ok: false, refused: false, kind, citations, note: "AI code model offline — no explanation generated (fail-safe)." };
    }
    return { ok: true, refused: false, kind, explanation: out.trim(), citations };
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
  const user = buildCodePrompt(mode, kind, outKind, language, request, input?.contextCode, goldenBlock, answerContext);

  const out = await runCodeModel(system, user);
  if (out == null) {
    return { ok: false, refused: false, kind: outKind, citations, note: "AI code model offline — no suggestion generated (fail-safe)." };
  }
  const code = extractCode(out);
  if (!code) {
    return { ok: false, refused: false, kind: outKind, citations, note: "The model returned no code." };
  }

  // Substrate validation — REQUIRED by default. Errors are SURFACED, never hidden: on failure
  // the code is still returned with ok:false + diagnostics so the engineer sees what is wrong.
  // No deploy / upload / run — display only.
  const required = validateRequired();
  const { validation, ran } = await runValidation(outKind, language, code);
  const ok = required ? validation.ok : ran ? validation.ok : true;
  const note = !ran
    ? `No substrate validator for "${outKind}" — output is UNVALIDATED (Tier-B / text target). Verify against the vendor manual + simulate before any device use.`
    : validation.ok
      ? undefined
      : "Generated code FAILED substrate validation — review the diagnostics before use (not deployed).";

  return { ok, refused: false, kind: outKind, code, validation, citations, note };
}
