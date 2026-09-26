/**
 * Doc 34 · P2 — GOLDEN-CODE few-shot loader.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Loads the versioned golden-code library (`knowledge/golden-code/index.json` + the
 * per-language source files it references) and selects the 1–2 most relevant examples
 * to PRIME a code-generation prompt. Grounding the LLM in known-correct, adapter-VALIDATED
 * examples is the strongest defence against the model "hallucinating" the syntax of a rare
 * vendor dialect (Zmotion ZBasic, Techman job-lists, MELSEC device tables, IR flows).
 *
 * SHARED ON-DISK CONTRACT (an authoring pipeline WRITES this — we READ it):
 *   knowledge/golden-code/index.json
 *     [{ id, lang, title, task, file, kind, tier, tags:[] }]  (kind = programmingAdapter kind
 *      for Tier-A examples; null for Tier-B RAG-first placeholders)
 *   knowledge/golden-code/<lang>/<name>.<ext>     (the raw golden source `file` points at)
 *
 * Everything is best-effort: a missing index / file / bad line degrades to an EMPTY set —
 * never a crash. Only Tier-A examples (kind non-null, real code on disk) are ever selected;
 * Tier-B placeholders are README stubs and must NOT be few-shot material.
 *
 * FLAGS:
 *   GOLDEN_CODE_DIR   (default knowledge/golden-code) — corpus root.
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";

/** One index.json entry, after normalisation (before the code file is loaded). */
export interface GoldenExampleMeta {
  id: string;
  /** Language/dialect label (e.g. "iec61131-st", "zmotion-basic", "urscript"). */
  lang: string;
  title: string;
  /** The natural-language task the example answers (for the few-shot header). */
  task: string;
  /** Path (relative to the corpus root) of the raw source file. */
  file: string;
  /** programmingAdapter kind for Tier-A examples; null for Tier-B RAG-first placeholders. */
  kind: string | null;
  /** "A" (has authoring substrate) | "B" (RAG-first, no substrate). */
  tier: string;
  tags: string[];
}

export interface GoldenExample extends GoldenExampleMeta {
  /** Raw golden source loaded from `file` ("" if unreadable / placeholder). */
  code: string;
}

interface RawIndexEntry {
  id?: unknown;
  lang?: unknown;
  title?: unknown;
  task?: unknown;
  file?: unknown;
  kind?: unknown;
  tier?: unknown;
  tags?: unknown;
}

export interface SelectGoldenParams {
  /** Target programmingAdapter kind — an EXACT match dominates the ranking. */
  kind: string;
  /** Optional soft signals (request keywords) — tag overlap breaks ties. */
  tags?: string[];
  /** Optional language label — a match adds a small bonus. */
  lang?: string;
  /** Max examples to return (clamped 0..6, default 2). */
  limit?: number;
}

function goldenDir(): string {
  const raw = (process.env.GOLDEN_CODE_DIR || "knowledge/golden-code").trim();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

let cache: GoldenExample[] | null = null;
let cacheDir: string | null = null;

function readCode(dir: string, file: string): string {
  try {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/**
 * Load + memoise all golden examples (index.json + code files). Never throws — a missing or
 * malformed corpus returns []. The cache is keyed on the resolved dir so a test that flips
 * GOLDEN_CODE_DIR reloads correctly.
 */
export function loadGoldenExamples(forceReload = false): GoldenExample[] {
  const dir = goldenDir();
  if (cache && !forceReload && cacheDir === dir) return cache;

  const indexPath = path.join(dir, "index.json");
  let raw: RawIndexEntry[] = [];
  try {
    if (fs.existsSync(indexPath)) {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (Array.isArray(parsed)) raw = parsed as RawIndexEntry[];
    }
  } catch {
    raw = [];
  }

  cache = raw
    .filter((e): e is RawIndexEntry => !!e && typeof e.id === "string" && typeof e.file === "string")
    .map((e) => ({
      id: String(e.id),
      lang: typeof e.lang === "string" ? e.lang : "",
      title: typeof e.title === "string" ? e.title : String(e.id),
      task: typeof e.task === "string" ? e.task : "",
      file: String(e.file),
      kind: typeof e.kind === "string" && e.kind.trim() ? e.kind : null,
      tier: typeof e.tier === "string" ? e.tier : "",
      tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t)) : [],
      code: readCode(dir, String(e.file)),
    }));
  cacheDir = dir;
  return cache;
}

/**
 * Pick up to `limit` golden examples to prime few-shot generation for `kind`.
 * Ranking: an exact adapter-kind match dominates (score 100); a language match (+10) and
 * request-keyword ↔ tag overlap (+5 each) break ties. Only Tier-A examples (kind non-null,
 * real code on disk) are eligible — a Tier-B README stub is never few-shot material.
 */
export function selectGoldenExamples(params: SelectGoldenParams): GoldenExample[] {
  const limit = Math.max(0, Math.min(6, params.limit ?? 2));
  if (limit === 0) return [];

  const wantKind = String(params.kind ?? "").trim().toLowerCase();
  const wantLang = String(params.lang ?? "").trim().toLowerCase();
  const wantTags = new Set((params.tags ?? []).map((t) => String(t).toLowerCase()).filter(Boolean));

  // Doc 80 · Task 10 (D3) — ví dụ ÂM của corpus safety-linter (`safety-lint-unsafe`: vòng lặp không
  // lối thoát, vượt vùng chuyển động…) tồn tại để KIỂM linter, KHÔNG phải mẫu để model bắt chước.
  // Trước bản vá, yêu cầu ST có thể được "mồi" bằng chính chương trình không an toàn đó.
  const usable = loadGoldenExamples().filter(
    (e) => e.kind && e.code.trim().length > 0 && !e.tags.some((t) => t.toLowerCase() === "safety-lint-unsafe"),
  );

  const scored = usable.map((e) => {
    const kindMatch = String(e.kind).toLowerCase() === wantKind;
    let score = kindMatch ? 100 : 0;
    if (wantLang && e.lang.toLowerCase() === wantLang) score += 10;
    if (wantTags.size) {
      for (const t of e.tags) if (wantTags.has(t.toLowerCase())) score += 5;
    }
    return { e, score, kindMatch };
  });

  return scored
    .filter((s) => s.kindMatch || s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

/**
 * Render selected examples into a compact few-shot block for a code prompt. Empty selection
 * → "" (the caller omits the section). The fenced blocks mirror the exact style the model
 * should emit.
 */
export function formatGoldenExamplesForPrompt(examples: GoldenExample[]): string {
  if (!examples.length) return "";
  return examples
    .map((e, i) => {
      const task = e.task ? `\n// task: ${e.task}` : "";
      // Doc 80 · D3 — header SAFETY/_safety_note của golden KHÔNG đi vào prompt (model chép nguyên văn).
      return `### Golden example ${i + 1}: ${e.title} [${e.id}]${task}\n\`\`\`\n${locHeaderGolden(e.code).trim()}\n\`\`\``;
    })
    .join("\n\n");
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// Doc 80 · Task 10 · D3 (AI-04 / AI-05) — HEADER GOLDEN KHÔNG ĐI VÀO PROMPT, KHÔNG ĐI RA MÃ.
//
// Đo (phụ lục A §2 #3): 11/11 đầu ra mã mang dòng `SAFETY:` hoặc header golden chép nguyên văn;
// 2 JSON (IR/POU) vỡ vì một dòng chú thích nằm giữa JSON. Hai nguồn: luật prompt "đặt dòng SAFETY
// làm dòng CUỐI trong khối mã" (đã bỏ) và header disclaimer của chính các file golden few-shot.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Chữ ký header golden — dùng cho FILE GOLDEN (đầu vào few-shot, nguồn do ta kiểm soát). */
const GOLDEN_HEADER_SIG = /\bSAFETY\s*:|golden[- ]example|golden-code|certification disclaimer|golden[- ]corpus|AI-assisted/i;
/**
 * Chữ ký cho MÃ TRẢ VỀ — HẸP hơn: chú thích "SAFETY: guard must be closed…" của chính người dùng
 * phải được giữ; chỉ gỡ đúng câu nhắc cũ của prompt và đúng dấu vết golden.
 */
const OUTPUT_HEADER_SIG = /SAFETY\s*:\s*simulate and test before running|golden[- ]example|golden-code|AI-assisted golden|certification disclaimer|golden[- ]corpus/i;

const LINE_COMMENT_RE = /^[ \t]*(\/\/|'|;|#)(.*)$/;

/** Gỡ các khối chú thích (khối `(* *)`, `/* *\/`, đoạn chú thích dòng) mà `laHeader(text)` nhận. */
function goKhoiChuThich(code: string, laHeader: (text: string) => boolean): string {
  let s = code.replace(/[ \t]*\(\*[\s\S]*?\*\)[ \t]*(?:\r?\n|$)/g, (m) => (laHeader(m) ? "" : m));
  s = s.replace(/[ \t]*\/\*[\s\S]*?\*\/[ \t]*(?:\r?\n|$)/g, (m) => (laHeader(m) ? "" : m));

  const lines = s.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(LINE_COMMENT_RE);
    if (!m) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // Một ĐOẠN = các dòng chú thích liên tiếp cùng ký hiệu, dừng ở dòng chú thích RỖNG (vạch ngăn).
    const marker = m[1];
    const para: string[] = [];
    let j = i;
    while (j < lines.length) {
      const mm = lines[j].match(LINE_COMMENT_RE);
      if (!mm || mm[1] !== marker || mm[2].trim() === "") break;
      para.push(lines[j]);
      j++;
    }
    if (para.length && laHeader(para.join("\n"))) {
      // Bỏ đoạn header + vạch ngăn rỗng ngay sau nó (nếu có).
      const sep = lines[j]?.match(LINE_COMMENT_RE);
      i = sep && sep[1] === marker && sep[2].trim() === "" ? j + 1 : j;
      continue;
    }
    if (!para.length) {
      out.push(lines[i]);
      i++;
      continue;
    }
    out.push(...para);
    i = j;
  }
  return out.join("\n");
}

/** Gỡ khoá `_…` cấp đỉnh của một JSON (vd `_safety_note`); không phải JSON / không có ⇒ nguyên văn. */
function goKhoaGachDuoiJson(code: string): string {
  const t = code.trim();
  if (!t.startsWith("{")) return code;
  const theoDong = code.replace(/^[ \t]*"_[A-Za-z0-9_]*"[ \t]*:[ \t]*"(?:[^"\\\n]|\\.)*"[ \t]*,?[ \t]*\r?\n/gm, "");
  if (theoDong === code) return code;
  try {
    JSON.parse(theoDong);
    return theoDong; // giữ nguyên định dạng gốc (golden viết gọn — tiết kiệm token prompt)
  } catch {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      for (const k of Object.keys(o)) if (k.startsWith("_")) delete o[k];
      return JSON.stringify(o, null, 2);
    } catch {
      return code;
    }
  }
}

function catDongTrongDauCuoi(s: string): string {
  return s.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

/** D3 — lọc header disclaimer / `_safety_note` của MỘT file golden trước khi đưa vào prompt. */
export function locHeaderGolden(code: string): string {
  const s = goKhoiChuThich(goKhoaGachDuoiJson(String(code ?? "")), (t) => GOLDEN_HEADER_SIG.test(t));
  return catDongTrongDauCuoi(s);
}

let dongHeaderGoldenCache: Set<string> | null = null;
/** Mọi dòng (đã trim, ≥ 20 ký tự) thuộc header golden — để nhận ra bản chép nguyên văn trong mã trả về. */
function dongHeaderGolden(): Set<string> {
  if (dongHeaderGoldenCache && cacheDir === goldenDir()) return dongHeaderGoldenCache;
  const set = new Set<string>();
  for (const e of loadGoldenExamples()) {
    const giu = new Set(locHeaderGolden(e.code).split(/\r?\n/).map((l) => l.trim()));
    for (const l of e.code.split(/\r?\n/)) {
      const t = l.trim();
      if (t.length >= 20 && !giu.has(t)) set.add(t);
    }
  }
  dongHeaderGoldenCache = set;
  return set;
}

/**
 * D3 — HẬU KIỂM mã model trả về: gỡ khối chú thích là header golden chép lại (khớp chữ ký hẹp HOẶC
 * chứa nguyên văn một dòng header golden), câu nhắc `SAFETY: simulate…` cũ, và `_safety_note` của
 * JSON. Mã không có dấu vết nào ⇒ trả NGUYÊN VĂN từng byte.
 */
export function goHeaderGoldenKhoiMa(code: string): string {
  const src = String(code ?? "");
  const header = dongHeaderGolden();
  const laHeader = (t: string) =>
    OUTPUT_HEADER_SIG.test(t) || t.split(/\r?\n/).some((l) => header.has(l.trim()));
  const s = goKhoiChuThich(goKhoaGachDuoiJson(src), laHeader);
  return s === src ? src : catDongTrongDauCuoi(s);
}

/** Test/ops helper: clear the memoised cache (next call reloads from disk). */
export function _clearGoldenCache(): void {
  cache = null;
  cacheDir = null;
  dongHeaderGoldenCache = null;
}
