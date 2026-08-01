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

  const usable = loadGoldenExamples().filter((e) => e.kind && e.code.trim().length > 0);

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
      return `### Golden example ${i + 1}: ${e.title} [${e.id}]${task}\n\`\`\`\n${e.code.trim()}\n\`\`\``;
    })
    .join("\n\n");
}

/** Test/ops helper: clear the memoised cache (next call reloads from disk). */
export function _clearGoldenCache(): void {
  cache = null;
  cacheDir = null;
}
