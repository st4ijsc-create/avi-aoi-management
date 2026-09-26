/**
 * Table-driven tests for the shared env → GGUF-basename resolver (doc69 Wave 1, G2-5b).
 *
 * modelResolver.ts is PURE (env reads only, no I/O) — no mocking needed. Covers:
 *  - toBasename/ensureGgufSuffix normalization (incl. the ".gguf.gguf" double-suffix bug).
 *  - Each individual env atom (fast/default/thinking/code/fim/embed) across representative
 *    env configs (set/unset, with/without an existing ".gguf" suffix).
 *  - resolveTaskModel (aiModelRouter.ts's call shape) and resolveLogicalModel (openaiGateway.ts's
 *    call shape), including the passthrough/unknown-id branch.
 *
 * Equivalence proof that each of the 3 real call sites (aiModelRouter.route(),
 * aiGgufEngine.codeModelBasename/fimModelBasename, openaiGateway's /v1 endpoints) still resolves
 * the SAME basename as the pre-refactor inline logic lives in three sibling files:
 *   - server/services/aiModelRouter.modelResolver.equivalence.test.ts
 *   - server/services/aiGgufEngine.modelResolver.equivalence.test.ts
 *   - server/routes/openaiGateway.modelResolver.equivalence.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  toBasename,
  ensureGgufSuffix,
  fastModelBasename,
  defaultModelBasename,
  thinkingModelBasename,
  codeModelBasename,
  fimModelBasename,
  embedModelBasename,
  resolveTaskModel,
  resolveLogicalModel,
  type ResolvableTask,
} from "./modelResolver";

const GGUF_KEYS = [
  "GGUF_FAST_MODEL",
  "GGUF_DEFAULT_MODEL",
  "GGUF_THINKING_MODEL",
  "GGUF_CODE_MODEL",
  "GGUF_FIM_MODEL",
  "GGUF_EMBED_MODEL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of GGUF_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of GGUF_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ─── Normalization primitives ──────────────────────────────────────────────────────────────

describe("toBasename — the ONE place '.gguf' is stripped for env-sourced values", () => {
  it.each([
    ["Qwen3-4B.gguf", "Qwen3-4B"],
    ["Qwen3-4B.GGUF", "Qwen3-4B"], // case-insensitive
    ["Qwen3-4B", "Qwen3-4B"], // already bare
    ["models/Qwen3-4B.gguf", "Qwen3-4B"], // directory component stripped too
    ["C:\\models\\Qwen3-4B.gguf", "Qwen3-4B"], // windows-style path
    ["  Qwen3-4B.gguf  ", "Qwen3-4B"], // trims whitespace
    ["", ""],
    [undefined as unknown as string, ""],
  ])("toBasename(%j) -> %j", (input, expected) => {
    expect(toBasename(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = toBasename("dir/Model.gguf");
    expect(toBasename(once)).toBe(once);
  });
});

describe("ensureGgufSuffix — proves the '.gguf.gguf' double-suffix bug can't recur", () => {
  it.each([
    ["Qwen3-4B", "Qwen3-4B.gguf"],
    ["Qwen3-4B.gguf", "Qwen3-4B.gguf"], // already suffixed -> NOT doubled
    ["Qwen3-4B.GGUF", "Qwen3-4B.gguf"], // case-insensitive input, canonical lowercase suffix out
    ["", ""],
  ])("ensureGgufSuffix(%j) -> %j", (input, expected) => {
    expect(ensureGgufSuffix(input)).toBe(expected);
  });

  it("is idempotent — repeated application never GROWS the suffix (the actual bug class: a resolver's basename gets re-suffixed on every downstream '${id}.gguf' append)", () => {
    const once = ensureGgufSuffix("Qwen3-4B");
    const twice = ensureGgufSuffix(once);
    const thrice = ensureGgufSuffix(twice);
    expect(once).toBe("Qwen3-4B.gguf");
    expect(twice).toBe(once);
    expect(thrice).toBe(once);
  });

  it("a literal pre-existing double-suffix is left stable, never grows to a triple suffix", () => {
    // toBasename() strips exactly ONE trailing ".gguf" (mirrors every real env value, which never
    // carries a double suffix); an already-doubled literal is therefore a stable fixed point here
    // rather than fully healed — the important guarantee is it never grows further.
    const doubled = "Qwen3-4B.gguf.gguf";
    expect(ensureGgufSuffix(doubled)).toBe(doubled);
    expect(ensureGgufSuffix(ensureGgufSuffix(doubled))).toBe(doubled);
  });
});

// ─── Individual env atoms ───────────────────────────────────────────────────────────────────

describe("fastModelBasename / defaultModelBasename / thinkingModelBasename — no fallback", () => {
  it("unset -> undefined", () => {
    expect(fastModelBasename()).toBeUndefined();
    expect(defaultModelBasename()).toBeUndefined();
    expect(thinkingModelBasename()).toBeUndefined();
  });

  it("set WITH .gguf suffix -> stripped", () => {
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    process.env.GGUF_THINKING_MODEL = "Qwen3-30B-Thinking.gguf";
    expect(fastModelBasename()).toBe("Qwen3-4B");
    expect(defaultModelBasename()).toBe("Qwen3-30B");
    expect(thinkingModelBasename()).toBe("Qwen3-30B-Thinking");
  });

  it("set WITHOUT .gguf suffix -> unchanged (proves no double-append downstream)", () => {
    process.env.GGUF_FAST_MODEL = "Qwen3-4B";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B";
    expect(fastModelBasename()).toBe("Qwen3-4B");
    expect(defaultModelBasename()).toBe("Qwen3-30B");
  });

  it("whitespace-only -> undefined (not an empty-string basename)", () => {
    process.env.GGUF_FAST_MODEL = "   ";
    expect(fastModelBasename()).toBeUndefined();
  });
});

describe("codeModelBasename — GGUF_CODE_MODEL, else GGUF_DEFAULT_MODEL", () => {
  it("both unset -> undefined", () => {
    expect(codeModelBasename()).toBeUndefined();
  });
  it("only GGUF_DEFAULT_MODEL set -> falls back to it", () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    expect(codeModelBasename()).toBe("Qwen3-30B");
  });
  it("GGUF_CODE_MODEL set -> wins over default", () => {
    process.env.GGUF_CODE_MODEL = "Qwen3-Coder-30B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    expect(codeModelBasename()).toBe("Qwen3-Coder-30B");
  });
});

describe("fimModelBasename — GGUF_FIM_MODEL, else GGUF_FAST_MODEL, else GGUF_DEFAULT_MODEL", () => {
  it("all unset -> undefined", () => {
    expect(fimModelBasename()).toBeUndefined();
  });
  it("only GGUF_DEFAULT_MODEL set -> falls all the way back to it (never undefined)", () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    expect(fimModelBasename()).toBe("Qwen3-30B");
  });
  it("GGUF_FAST_MODEL + GGUF_DEFAULT_MODEL set, FIM unset -> falls back to FAST (not default)", () => {
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    expect(fimModelBasename()).toBe("Qwen3-4B");
  });
  it("GGUF_FIM_MODEL set -> wins over fast and default", () => {
    process.env.GGUF_FIM_MODEL = "Qwen2.5-Coder-FIM.gguf";
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    expect(fimModelBasename()).toBe("Qwen2.5-Coder-FIM");
  });
});

describe("embedModelBasename — GGUF_EMBED_MODEL, no fallback", () => {
  it("unset -> undefined", () => {
    expect(embedModelBasename()).toBeUndefined();
  });
  it("set -> stripped", () => {
    process.env.GGUF_EMBED_MODEL = "mxbai-embed-large.gguf";
    expect(embedModelBasename()).toBe("mxbai-embed-large");
  });

  // Regression (doc69 W1-4 review) — the confirmed live ".gguf.gguf" bug in
  // aiGgufEngine.generateEmbedding/generateEmbeddings (see aiGgufEngine.test.ts for the
  // full engine-level regression): both a WITH-suffix and a WITHOUT-suffix
  // GGUF_EMBED_MODEL must converge on the exact SAME single-".gguf" filename once run
  // through ensureGgufSuffix() — the actual value handed to the engine's `${id}.gguf` append.
  it("WITH .gguf suffix and WITHOUT it converge to the SAME ensureGgufSuffix() filename (never doubled)", () => {
    process.env.GGUF_EMBED_MODEL = "Qwen3-Embedding-0.6B-f16.gguf";
    const withSuffix = ensureGgufSuffix(embedModelBasename());
    expect(withSuffix).toBe("Qwen3-Embedding-0.6B-f16.gguf");

    delete process.env.GGUF_EMBED_MODEL;
    process.env.GGUF_EMBED_MODEL = "Qwen3-Embedding-0.6B-f16";
    const withoutSuffix = ensureGgufSuffix(embedModelBasename());
    expect(withoutSuffix).toBe("Qwen3-Embedding-0.6B-f16.gguf");

    expect(withSuffix).toBe(withoutSuffix);
    expect(withSuffix.endsWith(".gguf.gguf")).toBe(false);
  });
});

// ─── resolveTaskModel — aiModelRouter.ts call shape ─────────────────────────────────────────

describe("resolveTaskModel — aiModelRouter.ts call shape (fast/default/thinking/code/fim)", () => {
  const table: Array<[ResolvableTask, Record<string, string>, string | undefined]> = [
    ["fast", {}, undefined],
    ["fast", { GGUF_FAST_MODEL: "Qwen3-4B.gguf" }, "Qwen3-4B"],
    ["default", {}, undefined],
    ["default", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-30B"],
    ["thinking", {}, undefined],
    ["thinking", { GGUF_THINKING_MODEL: "Thinker.gguf" }, "Thinker"],
    ["code", {}, undefined],
    ["code", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-30B"],
    ["code", { GGUF_CODE_MODEL: "Coder.gguf", GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Coder"],
    ["fim", {}, undefined],
    ["fim", { GGUF_FAST_MODEL: "Qwen3-4B.gguf" }, "Qwen3-4B"],
    ["fim", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-30B"],
    ["fim", { GGUF_FIM_MODEL: "Fim.gguf", GGUF_FAST_MODEL: "Qwen3-4B.gguf" }, "Fim"],
  ];
  it.each(table)("resolveTaskModel(%j) with env %j -> %j", (task, env, expected) => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    expect(resolveTaskModel(task)).toBe(expected);
  });
});

// ─── resolveLogicalModel — openaiGateway.ts call shape ──────────────────────────────────────

describe("resolveLogicalModel — openaiGateway.ts call shape (OpenAI-style logical names)", () => {
  const table: Array<[string, Record<string, string>, string | undefined]> = [
    ["", {}, undefined],
    ["", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-30B"],
    ["chat", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-30B"],
    ["code", { GGUF_CODE_MODEL: "Coder.gguf" }, "Coder"],
    ["coder", { GGUF_CODE_MODEL: "Coder.gguf" }, "Coder"], // alias
    ["fast", { GGUF_FAST_MODEL: "Qwen3-4B.gguf" }, "Qwen3-4B"],
    ["fim", { GGUF_FIM_MODEL: "Fim.gguf" }, "Fim"],
    ["infill", { GGUF_FIM_MODEL: "Fim.gguf" }, "Fim"], // alias
    // FIX (doc69 W1-4 review, STEP 0 finding (b)): resolveLogicalModel's "fim"/"infill" is
    // DELIBERATELY only a 2-level fallback (FIM_MODEL -> FAST_MODEL -> undefined) — it must NOT
    // fall through to GGUF_DEFAULT_MODEL like resolveTaskModel("fim")/fimModelBasename() do (see
    // that describe block above), because this is the shape `POST /v1/chat/completions` feeds
    // straight into getOrLoadModel with no internal backstop — an explicit default here would
    // force-pin that model instead of preserving the original "reuse whatever's hot" behavior.
    ["fim", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, undefined],
    ["infill", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, undefined],
    ["fim", { GGUF_FAST_MODEL: "Qwen3-4B.gguf", GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-4B"],
    ["embed", { GGUF_EMBED_MODEL: "Embed.gguf" }, "Embed"],
    ["embedding", { GGUF_EMBED_MODEL: "Embed.gguf" }, "Embed"], // alias
    ["embeddings", { GGUF_EMBED_MODEL: "Embed.gguf" }, "Embed"], // alias
    ["CHAT", { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" }, "Qwen3-30B"], // case-insensitive key match
  ];
  it.each(table)("resolveLogicalModel(%j) with env %j -> %j", (name, env, expected) => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    expect(resolveLogicalModel(name)).toBe(expected);
  });

  it("unknown id passthrough: strips a trailing .gguf but PRESERVES any directory (verbatim client-supplied basename)", () => {
    expect(resolveLogicalModel("my-custom-model")).toBe("my-custom-model");
    expect(resolveLogicalModel("my-custom-model.gguf")).toBe("my-custom-model");
    expect(resolveLogicalModel("subdir/my-custom-model.gguf")).toBe("subdir/my-custom-model");
  });

  it("empty/whitespace-only passthrough -> undefined", () => {
    expect(resolveLogicalModel("   ")).toBeUndefined();
    expect(resolveLogicalModel(undefined)).toBeUndefined();
  });
});
