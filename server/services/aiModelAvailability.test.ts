/**
 * W7-D (doc 27 gap V4) — aiModelAvailability tests: manifest-driven presence
 * check (ok/partial/missing), external-gguf env resolution, db_feature_status
 * upsert resilience.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../db/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../db/connection";
import { checkModelAvailability, reportAiModelAvailability } from "./aiModelAvailability";

let dir: string;
const ENV_KEYS = ["AI_MODELS_MANIFEST_PATH", "TEST_W7D_GGUF", "TEST_W7D_GGUF_DIR"];
const saved: Record<string, string | undefined> = {};

function writeManifest(models: unknown[]) {
  const p = path.join(dir, "manifest.json");
  fs.writeFileSync(p, JSON.stringify({ version: 1, models }, null, 2));
  process.env.AI_MODELS_MANIFEST_PATH = p;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-model-avail-"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("checkModelAvailability", () => {
  it("status=ok when all required models are present", async () => {
    fs.writeFileSync(path.join(dir, "a.onnx"), "x");
    writeManifest([
      { name: "a", kind: "onnx", file: "a.onnx", required: true },
      { name: "b", kind: "onnx", file: "b.onnx", required: false }, // optional absent — still ok
    ]);
    const r = await checkModelAvailability();
    expect(r.status).toBe("ok");
    expect(r.items.find((i) => i.name === "a")?.present).toBe(true);
    expect(r.items.find((i) => i.name === "b")?.present).toBe(false);
    expect(r.detail).toContain("a=present");
    expect(r.detail).toContain("b=absent(optional)");
  });

  it("status=missing when NO required model is present (with fetch hint)", async () => {
    writeManifest([{ name: "a", kind: "onnx", file: "a.onnx", required: true }]);
    const r = await checkModelAvailability();
    expect(r.status).toBe("missing");
    expect(r.detail).toContain("a=MISSING");
    expect(r.detail).toContain("fetch-models.mjs");
  });

  it("status=partial when some required models are present", async () => {
    fs.writeFileSync(path.join(dir, "a.onnx"), "x");
    writeManifest([
      { name: "a", kind: "onnx", file: "a.onnx", required: true },
      { name: "c", kind: "onnx", file: "c.onnx", required: true },
    ]);
    const r = await checkModelAvailability();
    expect(r.status).toBe("partial");
  });

  it("external-gguf entries resolve through pathEnv/dirEnv", async () => {
    const gguf = path.join(dir, "m.gguf");
    fs.writeFileSync(gguf, "x");
    writeManifest([
      { name: "g-abs", kind: "external-gguf", pathEnv: "TEST_W7D_GGUF", required: false },
      { name: "g-rel", kind: "external-gguf", pathEnv: "TEST_W7D_GGUF_REL", dirEnv: "TEST_W7D_GGUF_DIR", required: false },
    ]);
    process.env.TEST_W7D_GGUF = gguf; // absolute
    process.env.TEST_W7D_GGUF_DIR = dir;
    process.env.TEST_W7D_GGUF_REL = "m.gguf"; // relative to dirEnv
    const r = await checkModelAvailability();
    expect(r.items.find((i) => i.name === "g-abs")?.present).toBe(true);
    expect(r.items.find((i) => i.name === "g-rel")?.present).toBe(true);
    delete process.env.TEST_W7D_GGUF_REL;
  });

  it("unreadable manifest reports honestly instead of throwing", async () => {
    process.env.AI_MODELS_MANIFEST_PATH = path.join(dir, "nope.json");
    const r = await checkModelAvailability();
    expect(r.status).toBe("ok"); // zero required entries — nothing provably missing
    expect(r.detail).toContain("manifest.json not readable");
  });
});

describe("reportAiModelAvailability", () => {
  it("upserts the ai_models db_feature_status row", async () => {
    fs.writeFileSync(path.join(dir, "a.onnx"), "x");
    writeManifest([{ name: "a", kind: "onnx", file: "a.onnx", required: true }]);
    const execute = vi.fn(async () => []);
    (getDb as any).mockResolvedValue({ execute });

    const r = await reportAiModelAvailability();
    expect(r?.status).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
    // the upsert targets the ai_models feature row
    const query = execute.mock.calls[0][0] as { queryChunks?: unknown[] };
    expect(JSON.stringify(query)).toContain("ai_models");
  });

  it("never throws when the DB is unavailable or the table is missing", async () => {
    writeManifest([{ name: "a", kind: "onnx", file: "a.onnx", required: true }]);
    (getDb as any).mockResolvedValue({ execute: vi.fn(async () => { throw new Error("relation db_feature_status does not exist"); }) });
    const r = await reportAiModelAvailability();
    expect(r?.status).toBe("missing"); // report still produced

    (getDb as any).mockResolvedValue(null);
    const r2 = await reportAiModelAvailability();
    expect(r2?.status).toBe("missing");
  });
});
