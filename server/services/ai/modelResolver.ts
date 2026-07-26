/**
 * Model Resolver (doc69 Wave 1, G2-5b) — SINGLE SOURCE OF TRUTH for env → GGUF-basename
 * resolution.
 *
 * WHY: the same env→basename logic was triplicated in three places that could (and did) drift:
 *   1. `server/services/aiModelRouter.ts`   — private fastModelId/defaultModelId/thinkingModelId/
 *      codeModelId/fimModelId, feeding the tier/task routing decision (route()).
 *   2. `server/services/aiGgufEngine.ts`    — exported codeModelBasename()/fimModelBasename().
 *   3. `server/routes/openaiGateway.ts`     — private resolveModelId(), mapping an OpenAI-style
 *      `body.model` string to a basename for the /v1 gateway.
 * All three now delegate here. This module is PURE — env reads only, no I/O, no model loading —
 * so it stays trivially/synchronously testable and safe to import from anywhere (including
 * `aiModelRouter.ts`, which deliberately keeps its own imports side-effect-free).
 *
 * Do NOT put routing/tier DECISIONS here (difficulty heuristics, tier selection, HITL, context
 * sizing) — that stays in `aiModelRouter.route()`. This module only answers "given the current
 * env (+ an optional caller-supplied id), what GGUF basename does that name refer to?".
 *
 * ─── ENV VAR → DEFAULT TABLE ───────────────────────────────────────────────────────────────
 *   GGUF_FAST_MODEL      no fallback → undefined                     "fast" tier / "fast" logical model
 *   GGUF_DEFAULT_MODEL   no fallback → undefined                     "default"/"chat" tier
 *   GGUF_THINKING_MODEL  no fallback → undefined (optional tier)     "thinking" tier (B6.2, caller flag-gates it)
 *   GGUF_CODE_MODEL      → GGUF_DEFAULT_MODEL                        "code" tier / "code"|"coder" logical model
 *   GGUF_FIM_MODEL       → GGUF_FAST_MODEL → GGUF_DEFAULT_MODEL      "fim" tier — resolveTaskModel("fim")/
 *                                                                     fimModelBasename() (aiModelRouter.route(),
 *                                                                     aiGgufEngine.generateFim's own backstop)
 *   GGUF_FIM_MODEL       → GGUF_FAST_MODEL → undefined (NO default)  "fim"|"infill" LOGICAL model —
 *                                                                     resolveLogicalModel() only, see finding
 *                                                                     (b) below for why this one differs
 *   GGUF_EMBED_MODEL     no fallback → undefined                     "embed"|"embedding"|"embeddings" logical model
 * Every resolved value is a bare BASENAME: no directory component, no trailing ".gguf" — callers
 * pass this straight to the engine, which appends ".gguf" itself (see `ensureGgufSuffix` below
 * for why normalizing BEFORE that append is what makes the ".gguf.gguf" bug impossible).
 *
 * ─── STEP 0 findings — the three pre-refactor implementations were NOT byte-identical ────────
 * Full comparison + rationale: `.superpowers/sdd/ai-g2-5b-report.md`. Summary:
 *
 *  (a) ".gguf"/path stripping. aiGgufEngine used `path.basename(v).replace(/\.gguf$/i,"")`
 *      (also strips a directory component); aiModelRouter/openaiGateway used a bare
 *      `.replace(/\.gguf$/i,"")` (kept any directory). Reconciled: every ENV-SOURCED resolution
 *      below uses `toBasename()` (path.basename + strip) — the more defensive of the two. This is
 *      a no-op for every value in the current `.env` (none contain a path separator). The ONE
 *      exception is `resolveLogicalModel`'s passthrough branch (an arbitrary client-supplied
 *      `model` string in the OpenAI gateway that doesn't match a known logical name) — that one
 *      intentionally keeps the ORIGINAL "verbatim, suffix-stripped-only" behavior, because the
 *      original comment explicitly says "honour it verbatim (client may target a real on-disk
 *      basename)" and the engine's `resolveModelPath` supports nested-path lookups under
 *      GGUF_MODELS_DIR — stripping the directory there would silently break that.
 *
 *  (b) [CORRECTED — doc69 W1-4 review round] openaiGateway's FIM fallback was only 2 levels
 *      (GGUF_FIM_MODEL → GGUF_FAST_MODEL, then undefined) while aiModelRouter/aiGgufEngine's
 *      ROUTING-task fim resolver already chained 3 levels (…→ GGUF_DEFAULT_MODEL). The initial
 *      G2-5b pass reconciled `resolveLogicalModel("fim"/"infill")` to the 3-level chain too — but
 *      that was a genuine, UNTESTED behavior change for `POST /v1/chat/completions` with
 *      `body.model: "fim"|"infill"`: unlike `/v1/completions` (→ `aiGgufEngine.generateFim`, which
 *      has ITS OWN internal `fimModelBasename()` 3-level backstop when handed `undefined` —
 *      unchanged, still 3-level), `chatCompletion`/`chatCompletionStream` have NO such backstop —
 *      they pass whatever `resolveLogicalModel` returns straight into `getOrLoadModel(modelId)`.
 *      An explicit modelId there FORCE-PINS that exact model (loading it even if a DIFFERENT model
 *      is already resident); `undefined` lets `getOrLoadModel` reuse whatever is already hot, or
 *      auto-load the default ONLY if nothing is loaded yet. So with FIM+FAST unset, DEFAULT set,
 *      and some OTHER model already resident, OLD `/v1/chat/completions` reused the hot model —
 *      the reconciled-to-3-levels NEW code would have force-loaded the default instead: a real,
 *      untested generation change on a task that must be behavior-preserving.
 *      FIXED: `resolveLogicalModel("fim"/"infill")` now resolves EXACTLY as the pre-refactor
 *      `openaiGateway.resolveModelId` did — GGUF_FIM_MODEL → GGUF_FAST_MODEL → undefined — via the
 *      module-private `fimModelForLogicalName()` below. `fimModelBasename()`/
 *      `resolveTaskModel("fim")` (the ROUTING-task shape consumed by `aiModelRouter.route()` and
 *      `aiGgufEngine.generateFim`'s own internal backstop) KEEP their original 3-level chain,
 *      unchanged — the two call shapes now deliberately resolve DIFFERENTLY for "fim" by design.
 */

import path from "path";

function envStr(name: string): string {
  return (process.env[name] || "").trim();
}

// ─── Suffix / basename normalization (the ONE place ".gguf" handling lives) ───────────────────

/**
 * Normalize an env value or filename — a bare id, a filename with ".gguf", or a path — down to
 * the canonical BASENAME: no directory, no trailing ".gguf" (case-insensitive). This is the
 * single place that strips ".gguf" for every ENV-SOURCED resolution below (previously duplicated
 * 3 different ways — see STEP 0 finding (a) above). Idempotent:
 * `toBasename(toBasename(x)) === toBasename(x)`.
 */
export function toBasename(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return path.basename(v).replace(/\.gguf$/i, "");
}

/**
 * Strip a trailing ".gguf" ONLY (case-insensitive) — deliberately does NOT touch a directory
 * component. Used exclusively by `resolveLogicalModel`'s client-passthrough branch, which must
 * preserve a caller-supplied path verbatim (see STEP 0 finding (a)). Idempotent.
 */
function stripGgufSuffixOnly(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  return v.replace(/\.gguf$/i, "");
}

/**
 * Idempotently ensure a resolved basename carries EXACTLY ONE trailing ".gguf" — for the rare
 * call site that needs a filename rather than a basename. ALWAYS strips (via `toBasename`) before
 * re-appending, so a value that already carries ".gguf" (or several) is never doubled/tripled.
 * This is what makes the ".gguf.gguf" class of bug structurally impossible for any caller that
 * routes a value through this module: `ensureGgufSuffix(ensureGgufSuffix(x)) === ensureGgufSuffix(x)`.
 */
export function ensureGgufSuffix(raw: string | undefined | null): string {
  const base = toBasename(raw);
  return base ? `${base}.gguf` : "";
}

// ─── Individual env resolvers (the "atoms" every call site is built from) ─────────────────────

/** GGUF_FAST_MODEL → basename; undefined if unset. No fallback. */
export function fastModelBasename(): string | undefined {
  const v = envStr("GGUF_FAST_MODEL");
  return v ? toBasename(v) : undefined;
}

/**
 * GGUF_DEFAULT_MODEL → basename; undefined if unset. No fallback — callers that need an EXPLICIT
 * model (never `undefined`, which makes the engine reuse whatever happens to be hot) must check
 * for undefined themselves; this resolver only reflects what env actually says.
 */
export function defaultModelBasename(): string | undefined {
  const v = envStr("GGUF_DEFAULT_MODEL");
  return v ? toBasename(v) : undefined;
}

/** GGUF_THINKING_MODEL → basename; undefined if unset. No fallback (optional tier, B6.2). */
export function thinkingModelBasename(): string | undefined {
  const v = envStr("GGUF_THINKING_MODEL");
  return v ? toBasename(v) : undefined;
}

/** GGUF_CODE_MODEL → basename; falls back to GGUF_DEFAULT_MODEL when unset. */
export function codeModelBasename(): string | undefined {
  const v = envStr("GGUF_CODE_MODEL");
  if (v) return toBasename(v);
  return defaultModelBasename();
}

/** GGUF_FIM_MODEL → basename; falls back to GGUF_FAST_MODEL, then GGUF_DEFAULT_MODEL. */
export function fimModelBasename(): string | undefined {
  const v = envStr("GGUF_FIM_MODEL");
  if (v) return toBasename(v);
  return fastModelBasename() ?? defaultModelBasename();
}

/**
 * FIX (doc69 W1-4 review round) — `resolveLogicalModel`'s "fim"/"infill" case must resolve
 * EXACTLY as the pre-refactor `openaiGateway.resolveModelId` did: GGUF_FIM_MODEL →
 * GGUF_FAST_MODEL → `undefined` — deliberately WITHOUT the 3rd-level GGUF_DEFAULT_MODEL fallback
 * that `fimModelBasename()`/`resolveTaskModel("fim")` have. See the module header, STEP 0 finding
 * (b), for why the two call shapes must differ: `POST /v1/chat/completions` is the only caller
 * that feeds this branch's result straight into `getOrLoadModel` with no internal backstop, so an
 * explicit "default" return here would force-pin the default model instead of reusing whichever
 * model is already resident — an untested, un-preserved behavior change. NOT exported: used only
 * by `resolveLogicalModel` below.
 */
function fimModelForLogicalName(): string | undefined {
  const v = envStr("GGUF_FIM_MODEL");
  if (v) return toBasename(v);
  return fastModelBasename();
}

/** GGUF_EMBED_MODEL → basename; undefined if unset. No fallback (embeddings need a real embed model). */
export function embedModelBasename(): string | undefined {
  const v = envStr("GGUF_EMBED_MODEL");
  return v ? toBasename(v) : undefined;
}

// ─── Task/tier resolver — aiModelRouter.ts call site ───────────────────────────────────────────

/** The env-resolvable tiers aiModelRouter's route() needs a basename for. */
export type ResolvableTask = "fast" | "default" | "thinking" | "code" | "fim";

/**
 * Resolve the `.gguf` basename for a routing task/tier. Covers fast/default/thinking/code/fim —
 * exactly the set aiModelRouter.route() consults. Pure passthrough to the atoms above; kept as
 * its own function so aiModelRouter has one call shape regardless of which tier it needs.
 */
export function resolveTaskModel(task: ResolvableTask): string | undefined {
  switch (task) {
    case "fast":
      return fastModelBasename();
    case "default":
      return defaultModelBasename();
    case "thinking":
      return thinkingModelBasename();
    case "code":
      return codeModelBasename();
    case "fim":
      return fimModelBasename();
    default: {
      const _exhaustive: never = task;
      return _exhaustive;
    }
  }
}

// ─── Logical-name resolver — openaiGateway.ts call site ────────────────────────────────────────

/**
 * Resolve a client-requested OpenAI-style `model` string to a concrete GGUF basename. Mirrors
 * openaiGateway's logical-model vocabulary (chat/code/coder/fast/fim/infill/embed/embedding/
 * embeddings) plus an unknown-id passthrough for a caller targeting a real on-disk basename
 * directly. Returns `undefined` when the caller should let the engine pick its own default
 * (`GGUF_DEFAULT_MODEL`) — passing a non-existent basename would make the engine throw on load.
 *
 * NOTE — "fim"/"infill" deliberately resolves via `fimModelForLogicalName()` (2-level: FIM_MODEL
 * → FAST_MODEL → undefined), NOT the exported `fimModelBasename()`/`resolveTaskModel("fim")`
 * (3-level, → DEFAULT_MODEL). See the module header, STEP 0 finding (b), for why this call shape
 * must preserve the original 2-level behavior.
 */
export function resolveLogicalModel(requested?: string): string | undefined {
  const key = (requested || "").trim().toLowerCase();

  switch (key) {
    case "":
    case "chat":
      return defaultModelBasename();
    case "code":
    case "coder":
      return codeModelBasename();
    case "fast":
      return fastModelBasename();
    case "fim":
    case "infill":
      return fimModelForLogicalName();
    case "embed":
    case "embedding":
    case "embeddings":
      return embedModelBasename();
    default: {
      // Unknown, non-empty id: honour it VERBATIM (client may target a real on-disk basename,
      // possibly nested under GGUF_MODELS_DIR — aiGgufEngine.resolveModelPath supports that via
      // path.join). Only the redundant ".gguf" suffix is stripped so the engine's own
      // `${id}.gguf` append can't double it; the directory component is deliberately preserved
      // (see STEP 0 finding (a) in the module header).
      const trimmed = (requested || "").trim();
      return trimmed ? stripGgufSuffixOnly(trimmed) : undefined;
    }
  }
}
