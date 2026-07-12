/**
 * AI Generation Guard — degenerate-loop detector + salvage/fallback wrapper.
 *
 * WHY (doc 46 §2.3): the local GGUF text model (Qwen3) can drop into a
 * DEGENERATE LOOP — e.g. "cell cell cell…" repeated thousands of times, or a
 * short n-gram cycling forever, mixing CN/EN — and emit ~140KB of gibberish.
 * When that lands in the "Auto Executive Summary" on /management-insight it
 * reads as garbage to management (high reputational risk). This module gives a
 * PURE, dependency-free way to (a) DETECT such output and (b) either salvage a
 * clean head or hand back an empty string so the caller substitutes an honest
 * template/offline summary.
 *
 * Design:
 *  - `detectDegenerate(text, opts?)` is a PURE function (no env, no I/O) so it is
 *    trivially unit-testable. All thresholds come from `opts` (with defaults).
 *  - `guardGeneratedText(text, opts?)` is the wrapper callers use: it reads the
 *    `AI_GEN_GUARD_ENABLED` flag (default ON — a guard only ever PROTECTS, so it
 *    needs no off-switch, but the flag exists for emergencies), merges env
 *    threshold overrides, tries to salvage a clean head, else returns "".
 *
 * The guard NEVER throws and NEVER fabricates content — on any doubt it degrades
 * to the caller's own fallback.
 */

// ─── Options / result types ────────────────────────────────────

export interface DegenerateOptions {
  /** A single word repeated at least this many times IN A ROW → degenerate. Default 12. */
  maxConsecutiveWordRepeat?: number;
  /** A 2–4 word block repeated at least this many times consecutively → degenerate. Default 6. */
  maxNgramRepeat?: number;
  /** unique-words / total-words below this (and enough words) → degenerate. Default 0.18. */
  minUniqueRatio?: number;
  /** Only apply the unique-ratio test once there are at least this many words/CJK chars. Default 40. */
  minWordsForRatio?: number;
  /** Any single non-space character repeated at least this many times in a row → degenerate. Default 80. */
  maxConsecutiveCharRepeat?: number;
  /** Absolute character ceiling — beyond this the output is abnormal regardless of shape. Default 20000. */
  maxChars?: number;
}

export interface DegenerateResult {
  degenerate: boolean;
  /** Machine-readable reason (empty when not degenerate), e.g. "word_repeat:cell×1000". */
  reason: string;
  /**
   * Character offset in the ORIGINAL text where the degeneration begins, when a
   * precise start is known (word/n-gram/char repeat). Absent for whole-text
   * signals (low unique ratio) where no clean head can be identified.
   */
  truncateAt?: number;
}

export interface GuardResult {
  /** Clean text to use: the original, a salvaged head, or "" when unsalvageable. */
  text: string;
  /** True when the guard rejected or truncated the model output. */
  degraded: boolean;
  /** Reason (empty when not degraded). */
  reason: string;
}

// ─── Defaults ──────────────────────────────────────────────────

export const DEFAULT_DEGENERATE_OPTIONS: Required<DegenerateOptions> = {
  maxConsecutiveWordRepeat: 12,
  maxNgramRepeat: 6,
  minUniqueRatio: 0.18,
  minWordsForRatio: 40,
  maxConsecutiveCharRepeat: 80,
  maxChars: 20000,
};

/** Minimum length of a salvaged head — shorter than this and we prefer the caller's fallback. */
const DEFAULT_MIN_HEAD_CHARS = 80;

// ─── Tokenization (offset-preserving) ──────────────────────────

interface Tok {
  /** Normalized form (lowercased, surrounding punctuation stripped) for comparison. */
  norm: string;
  /** Start offset in the ORIGINAL text (so we can report a precise truncateAt). */
  start: number;
}

/** Split on whitespace, keeping each token's original start offset. Normalizes for comparison. */
function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rawLower = m[0].toLowerCase();
    // Strip leading/trailing non-letter/non-number (keeps CJK, drops quotes/commas/brackets).
    const norm = rawLower.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || rawLower;
    toks.push({ norm, start: m.index });
  }
  return toks;
}

function blocksEqual(toks: Tok[], a: number, b: number, n: number): boolean {
  for (let k = 0; k < n; k++) {
    if (toks[a + k].norm !== toks[b + k].norm) return false;
  }
  return true;
}

/**
 * Find the EARLIEST consecutive-repetition of a 1–4 word block. n=1 uses the
 * word-repeat threshold; n≥2 uses the n-gram threshold. Returns the original-text
 * start offset + a reason, or null. Greedy per start index → O(words · 4).
 */
function findRepetition(
  toks: Tok[],
  maxConsecutiveWordRepeat: number,
  maxNgramRepeat: number,
): { start: number; reason: string } | null {
  const nMax = 4;
  for (let i = 0; i < toks.length; i++) {
    for (let n = 1; n <= nMax && i + 2 * n <= toks.length; n++) {
      let reps = 1;
      let j = i + n;
      while (j + n <= toks.length && blocksEqual(toks, i, j, n)) {
        reps++;
        j += n;
      }
      const threshold = n === 1 ? maxConsecutiveWordRepeat : maxNgramRepeat;
      if (reps >= threshold) {
        const label =
          n === 1
            ? `word_repeat:${toks[i].norm.slice(0, 24)}×${reps}`
            : `ngram${n}_repeat×${reps}`;
        return { start: toks[i].start, reason: label };
      }
    }
  }
  return null;
}

/** Longest run of one identical non-whitespace character → returns { start, char, len } or null. */
function findCharRun(text: string, threshold: number): { start: number; reason: string } | null {
  let runStart = 0;
  let runLen = 0;
  let prev = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === prev && !/\s/.test(c)) {
      runLen++;
    } else {
      prev = c;
      runStart = i;
      runLen = 1;
    }
    if (runLen >= threshold) {
      return { start: runStart, reason: `char_repeat:${JSON.stringify(c)}×${runLen}` };
    }
  }
  return null;
}

/** Unique / total ratio over normalized tokens; ignores pure-punctuation tokens. */
function uniqueWordRatio(toks: Tok[]): { ratio: number; total: number } {
  const words = toks.filter((t) => /[\p{L}\p{N}]/u.test(t.norm));
  if (words.length === 0) return { ratio: 1, total: 0 };
  const uniq = new Set(words.map((t) => t.norm));
  return { ratio: uniq.size / words.length, total: words.length };
}

/** CJK-aware ratio: unique CJK chars / total CJK chars (catches space-less walls like 的的的). */
function uniqueCjkRatio(text: string): { ratio: number; total: number } {
  const cjk = text.match(/[㐀-鿿]/g);
  if (!cjk || cjk.length === 0) return { ratio: 1, total: 0 };
  const uniq = new Set(cjk);
  return { ratio: uniq.size / cjk.length, total: cjk.length };
}

// ─── Public: pure detector ─────────────────────────────────────

/**
 * Detect a degenerate/looping model output. PURE — no env, no I/O, never throws.
 * Checks, in order (earliest precise start wins for salvage):
 *   1. char-level run  (aaaaaa… / 的的的…)
 *   2. word / n-gram consecutive repetition  (cell cell cell… / "a b a b a b…")
 *   3. low unique-word ratio  (whole output is a small vocabulary churning)
 *   4. low unique CJK-char ratio  (space-less CJK repetition wall)
 *   5. absolute length ceiling  (abnormally long regardless of shape)
 */
export function detectDegenerate(text: string, opts: DegenerateOptions = {}): DegenerateResult {
  const o = { ...DEFAULT_DEGENERATE_OPTIONS, ...opts };
  if (!text || typeof text !== "string") return { degenerate: false, reason: "" };

  // 1) single-character run (cheap, precise start).
  const charRun = findCharRun(text, o.maxConsecutiveCharRepeat);
  if (charRun) return { degenerate: true, reason: charRun.reason, truncateAt: charRun.start };

  // 2) word / n-gram consecutive repetition (precise start).
  const toks = tokenize(text);
  const rep = findRepetition(toks, o.maxConsecutiveWordRepeat, o.maxNgramRepeat);
  if (rep) return { degenerate: true, reason: rep.reason, truncateAt: rep.start };

  // 3) low unique-word ratio over the whole output (no precise head → salvage falls to fallback).
  const wr = uniqueWordRatio(toks);
  if (wr.total >= o.minWordsForRatio && wr.ratio < o.minUniqueRatio) {
    return { degenerate: true, reason: `low_unique_ratio:${wr.ratio.toFixed(3)}` };
  }

  // 4) low unique CJK-char ratio (space-less CJK walls that tokenize to few "words").
  const cr = uniqueCjkRatio(text);
  if (cr.total >= o.minWordsForRatio && cr.ratio < o.minUniqueRatio) {
    return { degenerate: true, reason: `low_cjk_ratio:${cr.ratio.toFixed(3)}` };
  }

  // 5) absolute length ceiling.
  if (text.length > o.maxChars) {
    return { degenerate: true, reason: `length_exceeded:${text.length}`, truncateAt: o.maxChars };
  }

  return { degenerate: false, reason: "" };
}

// ─── Env flag + threshold overrides ────────────────────────────

/** Guard is ON by default; set AI_GEN_GUARD_ENABLED=false to disable (emergency escape hatch). */
export function isGuardEnabled(): boolean {
  return (process.env.AI_GEN_GUARD_ENABLED ?? "true").toLowerCase() !== "false";
}

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Merge env overrides onto the defaults (used by guardGeneratedText). */
function optionsFromEnv(overrides: DegenerateOptions = {}): DegenerateOptions {
  return {
    maxConsecutiveWordRepeat: numEnv("AI_GEN_GUARD_MAX_WORD_REPEAT", DEFAULT_DEGENERATE_OPTIONS.maxConsecutiveWordRepeat),
    maxNgramRepeat: numEnv("AI_GEN_GUARD_MAX_NGRAM_REPEAT", DEFAULT_DEGENERATE_OPTIONS.maxNgramRepeat),
    minUniqueRatio: numEnv("AI_GEN_GUARD_MIN_UNIQUE_RATIO", DEFAULT_DEGENERATE_OPTIONS.minUniqueRatio),
    minWordsForRatio: numEnv("AI_GEN_GUARD_MIN_WORDS", DEFAULT_DEGENERATE_OPTIONS.minWordsForRatio),
    maxConsecutiveCharRepeat: numEnv("AI_GEN_GUARD_MAX_CHAR_REPEAT", DEFAULT_DEGENERATE_OPTIONS.maxConsecutiveCharRepeat),
    maxChars: numEnv("AI_GEN_GUARD_MAX_CHARS", DEFAULT_DEGENERATE_OPTIONS.maxChars),
    ...overrides,
  };
}

// ─── Public: caller-facing guard ───────────────────────────────

/**
 * Guard a model output. When the guard is disabled → returns the text untouched.
 * When degenerate:
 *   • if a clean, substantial head precedes the loop → return the salvaged head (degraded:true).
 *   • otherwise → return "" (degraded:true); the caller MUST substitute its own honest fallback.
 * Never throws.
 */
export function guardGeneratedText(
  raw: string | null | undefined,
  overrides: DegenerateOptions = {},
  minHeadChars: number = DEFAULT_MIN_HEAD_CHARS,
): GuardResult {
  const text = typeof raw === "string" ? raw : "";
  if (!isGuardEnabled()) return { text, degraded: false, reason: "" };

  const opts = optionsFromEnv(overrides);
  const det = detectDegenerate(text, opts);
  if (!det.degenerate) return { text, degraded: false, reason: "" };

  // Try to salvage a clean head that precedes the loop.
  if (typeof det.truncateAt === "number" && det.truncateAt >= minHeadChars) {
    const head = text.slice(0, det.truncateAt).trim();
    if (head.length >= minHeadChars && !detectDegenerate(head, opts).degenerate) {
      return { text: head, degraded: true, reason: det.reason };
    }
  }

  // Unsalvageable → empty; caller substitutes an honest fallback.
  return { text: "", degraded: true, reason: det.reason };
}

/**
 * Lightweight boolean check for STREAMING paths — cheap enough to call as tokens
 * accumulate. Returns true once the accumulated text has degenerated. Honors the
 * enable flag + env thresholds. Never throws.
 */
export function isDegenerateStream(accumulated: string, overrides: DegenerateOptions = {}): boolean {
  if (!isGuardEnabled()) return false;
  return detectDegenerate(accumulated, optionsFromEnv(overrides)).degenerate;
}
