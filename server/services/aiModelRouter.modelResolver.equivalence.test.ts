/**
 * doc69 G2-5b — equivalence proof: aiModelRouter.route()'s resolved `modelId` (now fed by the
 * shared modelResolver via the fastModelId/defaultModelId/thinkingModelId/codeModelId/fimModelId
 * wrappers) is IDENTICAL to what a verbatim copy of the pre-refactor inline resolvers would have
 * produced, for representative env configs.
 *
 * This is ADDITIONAL to (not a replacement for) the pre-existing full-coverage suites
 * `aiModelRouter.code.test.ts` and `aiModelRouter.thinking.test.ts`, which assert exact modelId
 * strings and remain unmodified/green after this refactor — that is itself strong equivalence
 * evidence. This file makes the "same as before" comparison explicit and mechanical via a
 * reference implementation, rather than relying on hard-coded expectations staying in sync by hand.
 *
 * aiGgufEngine.ggufModelFileExists is stubbed so the import chain stays inert (matches the
 * existing aiModelRouter.*.test.ts pattern) — irrelevant here since none of these cases touch the
 * thinking-tier file-exists check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./aiGgufEngine", () => ({
  ggufModelFileExists: vi.fn(() => true),
}));

async function freshRouter() {
  vi.resetModules();
  return await import("./aiModelRouter");
}

/**
 * Pre-refactor reference copy (verbatim algorithm) of aiModelRouter.ts's OLD private resolvers,
 * as they existed before delegating to modelResolver.ts. See git history / the G2-5b report for
 * the original source. Deliberately duplicated here (not imported) — the whole point is an
 * INDEPENDENT re-implementation to compare against.
 */
function preRefactorReference() {
  const stripGguf = (s: string) => s.replace(/\.gguf$/i, "");
  const env = (n: string) => (process.env[n] || "").trim();
  const fastModelId = (): string | undefined => {
    const v = env("GGUF_FAST_MODEL");
    return v.length ? stripGguf(v) : undefined;
  };
  const defaultModelId = (): string | undefined => {
    const v = env("GGUF_DEFAULT_MODEL");
    return v.length ? stripGguf(v) : undefined;
  };
  const codeModelId = (): string | undefined => {
    const v = env("GGUF_CODE_MODEL");
    if (v.length) return stripGguf(v);
    return defaultModelId();
  };
  const fimModelId = (): string | undefined => {
    const v = env("GGUF_FIM_MODEL");
    if (v.length) return stripGguf(v);
    return fastModelId() ?? defaultModelId();
  };
  return { fastModelId, defaultModelId, codeModelId, fimModelId };
}

const ENV_KEYS = [
  "GGUF_FAST_MODEL",
  "GGUF_DEFAULT_MODEL",
  "GGUF_CODE_MODEL",
  "GGUF_FIM_MODEL",
  "AI_CODE_ROUTER_ENABLED",
] as const;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("aiModelRouter.route() model resolution — equivalence with pre-refactor inline logic", () => {
  it("trivial/easy chat -> Tier 1 fast model (or default fallback, per the pre-refactor chain)", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().fastModelId();
    expect(route({ task: "chat", text: "hi" }).modelId).toBe(expected);
    expect(expected).toBe("Qwen3-4B");
  });

  it("trivial/easy chat with NO fast model configured -> explicit default basename", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().defaultModelId();
    expect(route({ task: "chat", text: "hi" }).modelId).toBe(expected);
    expect(expected).toBe("Qwen3-30B");
  });

  it("medium chat -> Tier 2 default model", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    const { route } = await freshRouter();
    const text = "x".repeat(300); // pushes classifyDifficulty into "medium"
    const expected = preRefactorReference().defaultModelId();
    expect(route({ task: "chat", text }).modelId).toBe(expected);
  });

  it("write action (HITL, Tier 4) -> explicit default model", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().defaultModelId();
    expect(route({ task: "intent", isWrite: true }).modelId).toBe(expected);
  });

  it("code tier, flag ON, GGUF_CODE_MODEL set -> matches reference codeModelId()", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    process.env.GGUF_CODE_MODEL = "Qwen3-Coder-30B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().codeModelId();
    expect(route({ task: "code" }).modelId).toBe(expected);
    expect(expected).toBe("Qwen3-Coder-30B");
  });

  it("code tier, flag ON, GGUF_CODE_MODEL unset -> falls back to default (matches reference)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "1";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().codeModelId();
    expect(route({ task: "code" }).modelId).toBe(expected);
    expect(expected).toBe("Qwen3-30B");
  });

  it("fim tier, flag ON, only GGUF_FAST_MODEL set -> matches reference fimModelId() (fast, not default)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "on";
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().fimModelId();
    expect(route({ task: "fim" }).modelId).toBe(expected);
    expect(expected).toBe("Qwen3-4B");
  });

  it("fim tier, flag ON, neither FIM nor FAST set -> matches reference fimModelId() (falls to default)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "yes";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    const { route } = await freshRouter();
    const expected = preRefactorReference().fimModelId();
    expect(route({ task: "fim" }).modelId).toBe(expected);
    expect(expected).toBe("Qwen3-30B");
  });

  it("code/fim flag OFF -> byte-identical to deep/fast tiers regardless of GGUF_CODE_MODEL/GGUF_FIM_MODEL", async () => {
    process.env.GGUF_DEFAULT_MODEL = "Qwen3-30B.gguf";
    process.env.GGUF_FAST_MODEL = "Qwen3-4B.gguf";
    process.env.GGUF_CODE_MODEL = "Qwen3-Coder-30B.gguf";
    process.env.GGUF_FIM_MODEL = "Qwen2.5-Coder-FIM.gguf";
    const { route } = await freshRouter();
    expect(route({ task: "code" }).modelId).toBe(preRefactorReference().defaultModelId());
    expect(route({ task: "fim" }).modelId).toBe(preRefactorReference().fastModelId());
  });
});
