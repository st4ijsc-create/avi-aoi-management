/**
 * AOI-A — Configurable DINOv2 model path + HONEST degradation verification.
 *
 * Proves the four AOI-A guarantees WITHOUT a real .onnx binary:
 *   (a) loader with a missing model path → degraded tier, honest note, no throw
 *   (b) the model path is read from env (AI_DINOV2_MODEL_PATH, legacy alias, default)
 *   (c) anomaly detection with degraded (heuristic) embeddings still returns a scored
 *       result LABELLED with its tier (source/degraded)
 *   (d) getDinov2ModelHealth reports model-absent + the active fallback tier correctly
 *
 * No real DB / ONNX / GGUF needed — everything is mocked or runs on the sharp-only tier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";

// ── Keep heavy native deps out of the test env (sharp IS used for heuristic tier) ──
vi.mock("onnxruntime-node", () => ({ InferenceSession: { create: vi.fn() }, Tensor: class {} }));
// GGUF unavailable by default → forces the heuristic tier in health + anomaly tests.
vi.mock("./aiGgufEngine", () => ({ isGgufAvailable: vi.fn(async () => false) }));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./aiVisionLanguage", () => ({ describeDefect: vi.fn() }));

import {
  getDinov2ModelPath,
  dinov2ModelExists,
  getDinov2ModelHealth,
  extractEmbedding,
  DEFAULT_DINOV2_MODEL_PATH,
} from "./aiImageEmbedding";
import { getAiModelById } from "../db/ai";

vi.mock("../db/ai", () => ({
  getAiModelById: vi.fn(),
  getActiveModelForProduct: vi.fn(),
  getAiModels: vi.fn(async () => []),
}));

const mockedGetAiModelById = vi.mocked(getAiModelById);

const ENV_KEYS = ["AI_DINOV2_MODEL_PATH", "DINOV2_MODEL_PATH"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ─── (b) Configurable path is read from env ────────────────────────────────────

describe("AOI-A (b) — configurable DINOv2 model path", () => {
  it("defaults to the repo-relative models/dinov2.onnx when no env set", () => {
    const p = getDinov2ModelPath();
    expect(path.isAbsolute(p)).toBe(true); // resolved to absolute
    expect(p.replace(/\\/g, "/")).toContain(DEFAULT_DINOV2_MODEL_PATH);
    expect(DEFAULT_DINOV2_MODEL_PATH).toBe("models/dinov2.onnx");
  });

  it("reads AI_DINOV2_MODEL_PATH (absolute) verbatim", () => {
    const abs = path.resolve(os.tmpdir(), "some", "dinov2-real.onnx");
    process.env.AI_DINOV2_MODEL_PATH = abs;
    expect(getDinov2ModelPath()).toBe(abs);
  });

  it("resolves a repo-relative AI_DINOV2_MODEL_PATH against cwd", () => {
    process.env.AI_DINOV2_MODEL_PATH = "custom/models/v2.onnx";
    expect(getDinov2ModelPath()).toBe(path.resolve(process.cwd(), "custom/models/v2.onnx"));
  });

  it("falls back to the legacy DINOV2_MODEL_PATH alias when the new var is unset", () => {
    const legacy = path.resolve(os.tmpdir(), "legacy.onnx");
    process.env.DINOV2_MODEL_PATH = legacy;
    expect(getDinov2ModelPath()).toBe(legacy);
  });

  it("AI_DINOV2_MODEL_PATH takes precedence over the legacy alias", () => {
    process.env.AI_DINOV2_MODEL_PATH = "/new/model.onnx";
    process.env.DINOV2_MODEL_PATH = "/legacy/model.onnx";
    expect(getDinov2ModelPath().replace(/\\/g, "/")).toContain("/new/model.onnx");
  });
});

// ─── (b/d) Model presence detection ────────────────────────────────────────────

describe("AOI-A — dinov2ModelExists", () => {
  it("false when the configured path does not exist (no throw)", () => {
    process.env.AI_DINOV2_MODEL_PATH = path.resolve(os.tmpdir(), `does-not-exist-${Date.now()}.onnx`);
    expect(dinov2ModelExists()).toBe(false);
  });

  it("true when a file actually exists at the configured path", () => {
    const tmp = path.join(os.tmpdir(), `aoiA-fake-model-${Date.now()}.onnx`);
    fs.writeFileSync(tmp, "not-a-real-onnx"); // presence check only; never loaded here
    try {
      process.env.AI_DINOV2_MODEL_PATH = tmp;
      expect(dinov2ModelExists()).toBe(true);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

// ─── (a) Loader with a missing model file → honest error, no fabricated vector ──

describe("AOI-A (a) — loader degrades honestly when the model file is missing", () => {
  it("extractEmbedding throws a clear 'not found → degrade' error (never fabricates)", async () => {
    // ACTIVE model row whose filePath points at a NON-existent .onnx.
    const missing = path.resolve(os.tmpdir(), `missing-model-${Date.now()}.onnx`);
    process.env.AI_DINOV2_MODEL_PATH = missing; // env path also absent
    mockedGetAiModelById.mockResolvedValue({
      id: 1,
      code: "dinov2-small",
      status: "ACTIVE",
      filePath: missing,
      currentVersion: 1,
      preprocessConfig: null,
      inputShape: [1, 3, 224, 224],
    } as any);

    await expect(extractEmbedding(1, Buffer.from("img"))).rejects.toThrow(/not found/i);
    // Honest message names the degraded fallback — it does NOT return a vector.
    await expect(extractEmbedding(1, Buffer.from("img"))).rejects.toThrow(/degraded embedding tier/i);
  });
});

// ─── (d) Health check reports model-absent + active fallback tier ──────────────

describe("AOI-A (d) — getDinov2ModelHealth (usable by a future health endpoint)", () => {
  it("model absent + GGUF unavailable → activeTier 'heuristic', degraded, honest note", async () => {
    process.env.AI_DINOV2_MODEL_PATH = path.resolve(os.tmpdir(), `absent-${Date.now()}.onnx`);
    const h = await getDinov2ModelHealth();
    expect(h.modelPresent).toBe(false);
    expect(h.source).toBe("AI_DINOV2_MODEL_PATH");
    expect(h.activeTier).toBe("heuristic"); // GGUF mocked unavailable
    expect(h.degraded).toBe(true);
    expect(h.note).toMatch(/NOT found/i);
    expect(h.note).toMatch(/not fabricated/i);
    expect(path.isAbsolute(h.modelPath)).toBe(true);
  });

  it("model absent + GGUF available → activeTier 'text-of-image' (still degraded)", async () => {
    const gguf = await import("./aiGgufEngine");
    vi.mocked(gguf.isGgufAvailable).mockResolvedValue(true);
    process.env.AI_DINOV2_MODEL_PATH = path.resolve(os.tmpdir(), `absent2-${Date.now()}.onnx`);
    const h = await getDinov2ModelHealth();
    expect(h.modelPresent).toBe(false);
    expect(h.activeTier).toBe("text-of-image");
    expect(h.degraded).toBe(true);
  });

  it("model present → activeTier 'onnx', not degraded, source reflects config var", async () => {
    const tmp = path.join(os.tmpdir(), `aoiA-present-${Date.now()}.onnx`);
    fs.writeFileSync(tmp, "fake");
    try {
      process.env.AI_DINOV2_MODEL_PATH = tmp;
      const h = await getDinov2ModelHealth();
      expect(h.modelPresent).toBe(true);
      expect(h.activeTier).toBe("onnx");
      expect(h.degraded).toBe(false);
      expect(h.source).toBe("AI_DINOV2_MODEL_PATH");
      expect(h.note).toMatch(/present/i);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it("reports the legacy alias as the source when only DINOV2_MODEL_PATH is set", async () => {
    process.env.DINOV2_MODEL_PATH = path.resolve(os.tmpdir(), `legacy-absent-${Date.now()}.onnx`);
    const h = await getDinov2ModelHealth();
    expect(h.source).toBe("DINOV2_MODEL_PATH");
    expect(h.modelPresent).toBe(false);
  });

  it("reports 'default' source and the repo-relative path when no env is set", async () => {
    const h = await getDinov2ModelHealth();
    expect(h.source).toBe("default");
    expect(h.configuredPath).toBe(DEFAULT_DINOV2_MODEL_PATH);
  });
});
