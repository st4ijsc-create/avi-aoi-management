/**
 * Doc 34 (P0) — `code` / `fim` tier routing tests for aiModelRouter.
 *
 * Pure-logic (NO GGUF model load / no native binary). Covers the three P0 acceptance points:
 *  (a) AI_CODE_ROUTER_ENABLED unset/false → `code`/`fim` route BYTE-IDENTICALLY to the existing
 *      deep/fast tiers (same tier + same model) and GGUF_CODE_MODEL/GGUF_FIM_MODEL are ignored.
 *  (b) flag ON + GGUF_CODE_MODEL/GGUF_FIM_MODEL set → those basenames are returned (.gguf stripped).
 *  (c) flag ON + code/fim models unset → fall back to default / fast, and NEVER undefined.
 *
 * aiGgufEngine.ggufModelFileExists (the router's only engine import) is stubbed so the import chain
 * stays inert; the code/fim path never calls it, so the stub value is irrelevant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./aiGgufEngine", () => ({
  ggufModelFileExists: vi.fn(() => false),
}));

// Fresh module per test so any module-level state is clean; env resolvers read process.env at
// call time, so env mutations in a test are always picked up.
async function freshRouter() {
  vi.resetModules();
  return await import("./aiModelRouter");
}

const DEFAULT = "Qwen3-30B-A3B-Instruct";
const FAST = "Qwen3-4B";

beforeEach(() => {
  process.env.GGUF_DEFAULT_MODEL = `${DEFAULT}.gguf`;
  process.env.GGUF_FAST_MODEL = `${FAST}.gguf`;
  delete process.env.GGUF_CODE_MODEL;
  delete process.env.GGUF_FIM_MODEL;
  delete process.env.AI_CODE_ROUTER_ENABLED;
  delete process.env.GGUF_MAX_CTX;
});

describe("code/fim routing — flag OFF (byte-identical to deep/fast)", () => {
  it("code → deep tier (Tier 2) + GGUF_DEFAULT_MODEL when the flag is unset", async () => {
    const { route } = await freshRouter();
    const d = route({ task: "code", text: "generate ST for a conveyor start/stop" });
    expect(d.tier).toBe(2);
    expect(d.modelId).toBe(DEFAULT);
    expect(d.requiresHitl).toBe(false);
  });

  it("fim → fast tier (Tier 1) + GGUF_FAST_MODEL when the flag is unset", async () => {
    const { route } = await freshRouter();
    const d = route({ task: "fim" });
    expect(d.tier).toBe(1);
    expect(d.modelId).toBe(FAST);
  });

  it("ignores GGUF_CODE_MODEL/GGUF_FIM_MODEL when the flag is off (guaranteed no-op)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "false";
    process.env.GGUF_CODE_MODEL = "Qwen3-Coder-30B-A3B.gguf";
    process.env.GGUF_FIM_MODEL = "Qwen2.5-Coder-1.5B-FIM.gguf";
    const { route } = await freshRouter();
    expect(route({ task: "code" }).modelId).toBe(DEFAULT);
    expect(route({ task: "fim" }).modelId).toBe(FAST);
  });
});

describe("code/fim routing — flag ON", () => {
  it("routes code→GGUF_CODE_MODEL (Tier 2, large ctx) and fim→GGUF_FIM_MODEL (Tier 1, ctx 4096)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    process.env.GGUF_CODE_MODEL = "Qwen3-Coder-30B-A3B.gguf";
    process.env.GGUF_FIM_MODEL = "Qwen2.5-Coder-1.5B-FIM.gguf";
    const { route } = await freshRouter();

    const code = route({ task: "code" });
    expect(code.tier).toBe(2);
    expect(code.modelId).toBe("Qwen3-Coder-30B-A3B"); // .gguf stripped
    expect(code.contextSize).toBeGreaterThanOrEqual(8192); // deep-tier semantics: large ctx

    const fim = route({ task: "fim" });
    expect(fim.tier).toBe(1);
    expect(fim.modelId).toBe("Qwen2.5-Coder-1.5B-FIM");
    expect(fim.contextSize).toBe(4096); // fast-tier semantics: small ctx for inline completion
  });

  it("code falls back to GGUF_DEFAULT_MODEL, fim to GGUF_FAST_MODEL — never undefined — when models unset", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "1";
    const { route } = await freshRouter();

    const code = route({ task: "code" });
    expect(code.modelId).toBe(DEFAULT);
    expect(code.modelId).toBeDefined();

    const fim = route({ task: "fim" });
    expect(fim.modelId).toBe(FAST);
    expect(fim.modelId).toBeDefined();
  });

  it("fim falls back to GGUF_DEFAULT_MODEL when neither GGUF_FIM_MODEL nor GGUF_FAST_MODEL is set", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "on";
    delete process.env.GGUF_FAST_MODEL;
    const { route } = await freshRouter();
    const fim = route({ task: "fim" });
    expect(fim.modelId).toBe(DEFAULT);
    expect(fim.modelId).toBeDefined();
  });

  it("honors GGUF_MAX_CTX as the code context cap", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    process.env.GGUF_MAX_CTX = "16384";
    const { route } = await freshRouter();
    expect(route({ task: "code" }).contextSize).toBe(16384);
  });
});

describe("code/fim routing — precedence", () => {
  it("a code request carrying an image still routes to the vision tier (Tier 3)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    const { route } = await freshRouter();
    const d = route({ task: "code", hasImage: true });
    expect(d.tier).toBe(3);
  });
});
