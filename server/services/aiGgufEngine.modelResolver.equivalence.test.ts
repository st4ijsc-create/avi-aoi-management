/**
 * doc69 G2-5b — equivalence proof: aiGgufEngine's exported `codeModelBasename()` /
 * `fimModelBasename()` (now delegating to the shared modelResolver) return the SAME basename as
 * the pre-refactor inline logic, for representative env configs.
 *
 * Both functions are pure env reads (no model load, no fs access at call time — GGUF_MODELS_DIR
 * is only touched by resolveModelPath/ensureModelsDir, neither of which these call), so the real
 * module can be imported directly without mocking node-llama-cpp/fs (mirrors how other
 * lightweight aiGgufEngine exports are tested elsewhere in this suite).
 */
import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { codeModelBasename, fimModelBasename } from "./aiGgufEngine";

/**
 * Pre-refactor reference copy (verbatim algorithm) of aiGgufEngine.ts's OLD
 * codeModelBasename()/fimModelBasename(), before delegating to modelResolver.ts. Deliberately
 * duplicated (not imported) — the point is an INDEPENDENT re-implementation to compare against.
 */
function refCodeModelBasename(): string | undefined {
  const v = (process.env.GGUF_CODE_MODEL || "").trim();
  if (v) return path.basename(v).replace(/\.gguf$/i, "");
  const d = (process.env.GGUF_DEFAULT_MODEL || "").trim();
  return d ? path.basename(d).replace(/\.gguf$/i, "") : undefined;
}
function refFimModelBasename(): string | undefined {
  const v = (process.env.GGUF_FIM_MODEL || "").trim();
  if (v) return path.basename(v).replace(/\.gguf$/i, "");
  const fast = (process.env.GGUF_FAST_MODEL || "").trim();
  if (fast) return path.basename(fast).replace(/\.gguf$/i, "");
  const d = (process.env.GGUF_DEFAULT_MODEL || "").trim();
  return d ? path.basename(d).replace(/\.gguf$/i, "") : undefined;
}

const KEYS = ["GGUF_CODE_MODEL", "GGUF_FIM_MODEL", "GGUF_FAST_MODEL", "GGUF_DEFAULT_MODEL"] as const;
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

const matrix: Array<{ label: string; env: Partial<Record<(typeof KEYS)[number], string>> }> = [
  { label: "all unset", env: {} },
  { label: "only default set", env: { GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" } },
  { label: "code + default set", env: { GGUF_CODE_MODEL: "Coder.gguf", GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" } },
  { label: "fast + default set (fim unset)", env: { GGUF_FAST_MODEL: "Qwen3-4B.gguf", GGUF_DEFAULT_MODEL: "Qwen3-30B.gguf" } },
  { label: "fim + fast set", env: { GGUF_FIM_MODEL: "Fim.gguf", GGUF_FAST_MODEL: "Qwen3-4B.gguf" } },
  { label: "code set without .gguf suffix", env: { GGUF_CODE_MODEL: "Coder" } },
];

describe("aiGgufEngine.codeModelBasename/fimModelBasename — equivalence with pre-refactor logic", () => {
  it.each(matrix)("$label", ({ env }) => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    expect(codeModelBasename()).toBe(refCodeModelBasename());
    expect(fimModelBasename()).toBe(refFimModelBasename());
  });
});
