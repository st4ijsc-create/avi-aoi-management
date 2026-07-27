/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-6) — unit tests for the LoRA/QLoRA fine-tune sidecar.
 *
 * Everything is mocked: child_process.spawn (fake EventEmitter, mirrors
 * localSidecarTrainer.test.ts's FakeChild), fs (job/dataset/progress/result files),
 * kbStudioService.listCorpusChunksForTraining (the training-data source), the DB
 * (getAiModelById/getModelVersions/createModelVersion/updateModelVersion), and
 * aiEvalHarness (evaluateQualityGate/persistEvalReport — "eval MOCKED" per the brief). No real
 * process, no real filesystem, no DB, no GGUF/llama.cpp ever touched.
 *
 * Coverage (per the brief):
 *  1. gate — LLM_FINETUNE_CMD unset ⇒ LoraFinetuneUnavailableError, nothing else runs.
 *  2. orchestration — job.json contract shape; spawn called with an ARG ARRAY + no shell; on
 *     sidecar success ⇒ createModelVersion (status NOT active) + independent eval run +
 *     evalReport persisted; the version is NEVER auto-activated (status never flips to ACTIVE).
 *  3. fail-safe — spawn error / non-zero exit / timeout / missing output GGUF / too-small or
 *     unmigrated corpus / base-model-missing ⇒ a typed error, NO model_versions row, job dir
 *     cleaned up (fs.rmSync). A malicious corpus name cannot influence the spawned command or
 *     any filesystem path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── fs: in-memory store driven by the test (mirrors localSidecarTrainer.test.ts) ──
const fsStore = new Map<string, string>();
const fsExist = new Set<string>();
const mkdirSpy = vi.fn();
const rmSpy = vi.fn();
const unlinkSpy = vi.fn((p: string) => {
  fsExist.delete(p);
  fsStore.delete(p);
});
const copySpy = vi.fn((src: string, dst: string) => {
  fsExist.add(dst);
  fsStore.set(dst, fsStore.get(src) ?? "<gguf-bytes>");
});

vi.mock("fs", () => {
  const api = {
    mkdirSync: (p: string) => { mkdirSpy(p); fsExist.add(p); },
    writeFileSync: (p: string, data: string) => { fsStore.set(p, String(data)); fsExist.add(p); },
    readFileSync: (p: string) => {
      if (!fsStore.has(p)) throw new Error(`ENOENT ${p}`);
      return fsStore.get(p)!;
    },
    existsSync: (p: string) => fsExist.has(p),
    copyFileSync: (s: string, d: string) => copySpy(s, d),
    unlinkSync: (p: string) => unlinkSpy(p),
    rmSync: (p: string, opts: unknown) => {
      rmSpy(p, opts);
      for (const key of Array.from(fsExist)) if (key.startsWith(p)) fsExist.delete(key);
      for (const key of Array.from(fsStore.keys())) if (key.startsWith(p)) fsStore.delete(key);
    },
  };
  return { default: api, ...api };
});

// ── child_process.spawn: returns a controllable fake child ──────
let lastChild: FakeChild | null = null;
let lastSpawnArgs: { cmd: string; args: string[] } | null = null;
const allSpawnArgs: Array<{ cmd: string; args: string[] }> = [];

class FakeChild extends EventEmitter {
  killed = false;
  kill() { this.killed = true; }
}

const spawnSpy = vi.fn((cmd: string, args: string[]) => {
  lastSpawnArgs = { cmd, args };
  allSpawnArgs.push({ cmd, args });
  lastChild = new FakeChild();
  return lastChild;
});
vi.mock("child_process", () => ({ spawn: (c: string, a: string[], opts: unknown) => spawnSpy(c, a, opts) }));

// ── kbStudioService (training-data source) ───────────────────────
const listCorpusChunksForTrainingMock = vi.fn();
vi.mock("./kbStudioService", () => ({
  listCorpusChunksForTraining: (corpus: string, limit: number) => listCorpusChunksForTrainingMock(corpus, limit),
}));

// ── DB layer ────────────────────────────────────────────────────
const getAiModelByIdMock = vi.fn();
const getModelVersionsMock = vi.fn();
const createModelVersionMock = vi.fn();
const updateModelVersionMock = vi.fn();
vi.mock("../db/ai", () => ({
  getAiModelById: (id: number) => getAiModelByIdMock(id),
  getModelVersions: (id: number) => getModelVersionsMock(id),
  createModelVersion: (data: unknown) => createModelVersionMock(data),
  updateModelVersion: (id: number, data: unknown) => updateModelVersionMock(id, data),
}));

// ── aiEvalHarness — "eval MOCKED" per the brief ───────────────────
const evaluateQualityGateMock = vi.fn(
  (candidateAccuracy: number, baselineAccuracy: number | null, epsilon = 0) => ({
    pass: baselineAccuracy == null || candidateAccuracy >= baselineAccuracy - epsilon,
    reason: baselineAccuracy == null ? "No baseline — candidate accepted as first version." : "mock gate reason",
    accuracyDelta: Number((candidateAccuracy - (baselineAccuracy ?? 0)).toFixed(4)),
    epsilon,
  }),
);
const persistEvalReportMock = vi.fn(async () => undefined);
vi.mock("./aiEvalHarness", () => ({
  evaluateQualityGate: (a: number, b: number | null, e?: number) => evaluateQualityGateMock(a, b, e),
  persistEvalReport: (versionId: number, metrics: unknown, report: unknown) => persistEvalReportMock(versionId, metrics, report),
}));

import {
  isLlmFinetuneEnabled,
  startLoraFinetune,
  evaluateLoraCandidate,
  LoraFinetuneUnavailableError,
  LoraFinetuneError,
} from "./aiLlmFinetuneSidecar";

// 12-word chunk template: cut=floor(12*0.4)=4 → prompt = first 4 words (varies per chunk via
// the leading "chunk <i>" pair), completion = the SAME fixed 8-word tail for every chunk. A
// generateFn that echoes that fixed tail therefore scores a perfect word-overlap "match" for
// every held-out sample, regardless of which chunk it came from — deterministic, no real LLM.
const COMPLETION_TAIL = "charlie delta echo foxtrot golf hotel india juliet";
function chunkText(i: number): string {
  return `chunk ${i} alpha bravo ${COMPLETION_TAIL}`;
}
function makeChunks(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i, sourceRef: `doc-${i}.pdf`, chunkIndex: 0, text: chunkText(i) }));
}
const perfectGenerateFn = async () => COMPLETION_TAIL;

function findWritten(suffix: string): string | undefined {
  for (const k of fsStore.keys()) if (k.endsWith(suffix)) return k;
  return undefined;
}

beforeEach(() => {
  fsStore.clear();
  fsExist.clear();
  mkdirSpy.mockClear();
  rmSpy.mockClear();
  unlinkSpy.mockClear();
  copySpy.mockClear();
  spawnSpy.mockClear();
  allSpawnArgs.length = 0;
  lastChild = null;
  lastSpawnArgs = null;
  listCorpusChunksForTrainingMock.mockReset();
  listCorpusChunksForTrainingMock.mockResolvedValue({ tableAvailable: true, chunks: makeChunks(20) });
  getAiModelByIdMock.mockReset();
  getAiModelByIdMock.mockResolvedValue({ id: 7, code: "QWEN3", filePath: "/uploads/models/base/qwen3-hf", currentVersion: "1.0.0" });
  getModelVersionsMock.mockReset();
  getModelVersionsMock.mockResolvedValue([]);
  createModelVersionMock.mockReset();
  createModelVersionMock.mockResolvedValue({ id: 501, modelId: 7, version: "1.0.0-lora.1", status: "VALIDATING" });
  updateModelVersionMock.mockReset();
  updateModelVersionMock.mockResolvedValue(undefined);
  evaluateQualityGateMock.mockClear();
  persistEvalReportMock.mockClear();
  delete process.env.LLM_FINETUNE_CMD;
  delete process.env.LLM_FINETUNE_TIMEOUT_MS;
  delete process.env.LLM_FINETUNE_MIN_SAMPLES;
  delete process.env.LLM_FINETUNE_MAX_SAMPLES;
});

// ─── isLlmFinetuneEnabled ──────────────────────────────────────────────────

describe("isLlmFinetuneEnabled", () => {
  it("is false when LLM_FINETUNE_CMD is unset/empty", () => {
    expect(isLlmFinetuneEnabled()).toBe(false);
    process.env.LLM_FINETUNE_CMD = "   ";
    expect(isLlmFinetuneEnabled()).toBe(false);
  });
  it("is true when LLM_FINETUNE_CMD is set", () => {
    process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
    expect(isLlmFinetuneEnabled()).toBe(true);
  });
});

// ─── gate ────────────────────────────────────────────────────────────────

describe("startLoraFinetune — gate", () => {
  it("LLM_FINETUNE_CMD unset ⇒ LoraFinetuneUnavailableError, nothing else runs", async () => {
    await expect(
      startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }),
    ).rejects.toBeInstanceOf(LoraFinetuneUnavailableError);
    expect(getAiModelByIdMock).not.toHaveBeenCalled();
    expect(listCorpusChunksForTrainingMock).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });
});

// ─── orchestration: job.json contract + no-shell spawn ────────────────────

describe("startLoraFinetune — happy path (orchestration)", () => {
  beforeEach(() => {
    process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
  });

  it("writes job.json to the contracted shape and spawns without a shell", async () => {
    const p = startLoraFinetune({
      baseModelId: 7,
      corpus: "vendor-x",
      targetVersion: "1.0.0-lora.1",
      hyperparams: { rank: 8, quantization: "4bit" },
      userId: 5,
      generateFn: perfectGenerateFn,
    });

    await vi.waitFor(() => expect(lastChild).not.toBeNull());

    const jobJsonKey = findWritten("job.json")!;
    const contract = JSON.parse(fsStore.get(jobJsonKey)!);
    expect(contract.baseModelId).toBe(7);
    expect(contract.targetVersion).toBe("1.0.0-lora.1");
    expect(contract.corpus).toBe("vendor-x");
    expect(typeof contract.baseModelPath).toBe("string");
    expect(contract.hyperparams).toEqual({
      rank: 8, alpha: 32, epochs: 3, learningRate: 0.0002, quantization: "4bit", maxSeqLen: 2048, batchSize: 4,
    });
    expect(contract.manifests.train).toMatch(/dataset[\\/]train\.jsonl$/);
    expect(contract.manifests.test).toMatch(/dataset[\\/]test\.jsonl$/);
    expect(contract.output.ggufPath).toMatch(/output[\\/]model\.gguf$/);
    expect(contract.output.adapterDir).toMatch(/output[\\/]adapter$/);
    expect(contract.progressPath).toMatch(/progress\.json$/);
    expect(typeof contract.jobId).toBe("string");
    expect(contract.jobId).toMatch(/^lora_\d+_[0-9a-f]{8}$/);

    // spawn: NO shell, arg array, jobDir as the FINAL argument.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(lastSpawnArgs!.cmd).toBe("python");
    expect(lastSpawnArgs!.args[0]).toBe("tools/trainer/finetune_lora.py");
    expect(lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1]).toMatch(/jobs[\\/]lora[\\/]lora_\d+_[0-9a-f]{8}$/);
    const spawnOpts = spawnSpy.mock.calls[0]![2] as { shell?: boolean };
    expect(spawnOpts.shell).toBe(false);

    // train.jsonl/test.jsonl were actually written, completion-style records.
    const trainLines = fsStore.get(contract.manifests.train)!.trim().split("\n");
    const testLines = fsStore.get(contract.manifests.test)!.trim().split("\n");
    expect(trainLines.length + testLines.length).toBe(20);
    expect(JSON.parse(trainLines[0]!)).toHaveProperty("text");

    // Complete the run so the pending promise settles (avoid an unhandled rejection).
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: { trainLoss: 1.2, evalLoss: 1.3 } }));
    lastChild!.emit("exit", 0);
    await p;
  });

  it("on sidecar success: registers a NOT-active model_versions row, runs the independent eval, persists evalReport, and NEVER activates it", async () => {
    const p = startLoraFinetune({
      baseModelId: 7,
      corpus: "vendor-x",
      targetVersion: "1.0.0-lora.1",
      userId: 5,
      generateFn: perfectGenerateFn,
    });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());

    const jobJsonKey = findWritten("job.json")!;
    const contract = JSON.parse(fsStore.get(jobJsonKey)!);
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({
      success: true,
      metrics: { trainLoss: 0.8, evalLoss: 0.9, perplexity: 2.4, samples: 18, epochs: 3 },
    }));
    lastChild!.emit("exit", 0);

    const result = await p;

    // ── registration: status NOT active ──
    expect(createModelVersionMock).toHaveBeenCalledTimes(1);
    const createArgs = createModelVersionMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(createArgs.modelId).toBe(7);
    expect(createArgs.version).toBe("1.0.0-lora.1");
    expect(createArgs.status).toBe("VALIDATING");
    expect(createArgs.status).not.toBe("ACTIVE");
    expect(createArgs.filePath).toMatch(/lora_.*\.gguf$/);
    // sidecar's own metrics are carried as ADVISORY, sanitized to known numeric keys only.
    expect(createArgs.metrics).toEqual({ trainLoss: 0.8, evalLoss: 0.9, perplexity: 2.4, samples: 18, epochs: 3 });
    expect(copySpy).toHaveBeenCalledWith(contract.output.ggufPath, createArgs.filePath);

    // ── independent eval ran + evalReport persisted ──
    expect(persistEvalReportMock).toHaveBeenCalledTimes(1);
    const [versionIdArg, metricsArg, reportArg] = persistEvalReportMock.mock.calls[0]! as [number, any, any];
    expect(versionIdArg).toBe(501);
    expect(metricsArg.evaluated).toBeGreaterThan(0);
    expect(reportArg.gate).toBeDefined();
    expect(reportArg.split).toBe("test");
    expect(evaluateQualityGateMock).toHaveBeenCalledTimes(1);

    // ── after eval: status bumped to READY (still NOT active) ──
    expect(updateModelVersionMock).toHaveBeenCalledWith(501, { status: "READY" });

    // ── NEVER activated: no DB call anywhere ever sets status to ACTIVE ──
    for (const call of updateModelVersionMock.mock.calls) {
      expect((call[1] as { status?: string }).status).not.toBe("ACTIVE");
    }
    for (const call of createModelVersionMock.mock.calls) {
      expect((call[0] as { status?: string }).status).not.toBe("ACTIVE");
    }

    expect(result.status).toBe("succeeded");
    expect(result.versionId).toBe(501);
    expect(result.gate).not.toBeNull();
    expect(result.evaluated).toBeGreaterThan(0);
  });

  it("a failed independent eval leaves the version registered (VALIDATING) but does not throw", async () => {
    persistEvalReportMock.mockRejectedValueOnce(new Error("db down"));
    const p = startLoraFinetune({
      baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1", generateFn: perfectGenerateFn,
    });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    const contract = JSON.parse(fsStore.get(findWritten("job.json")!)!);
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: {} }));
    lastChild!.emit("exit", 0);

    const result = await p;
    expect(result.status).toBe("succeeded"); // the version WAS created — this is not a failure
    expect(result.gate).toBeNull();
    expect(createModelVersionMock).toHaveBeenCalledTimes(1);
    // status was never bumped to READY because the eval step threw before that line.
    expect(updateModelVersionMock).not.toHaveBeenCalled();
    // The registered version's .gguf is NOT treated as orphaned — the DB row genuinely tracks
    // it (only the evalReport is missing), so the failure-path cleanup must never delete it.
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});

// ─── fail-safe ──────────────────────────────────────────────────────────

describe("startLoraFinetune — fail-safe", () => {
  beforeEach(() => {
    process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
  });

  it("base model not found ⇒ LoraFinetuneError, zero filesystem interaction, no model_versions row", async () => {
    getAiModelByIdMock.mockResolvedValueOnce(null);
    await expect(
      startLoraFinetune({ baseModelId: 999, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }),
    ).rejects.toBeInstanceOf(LoraFinetuneError);
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
  });

  it("base model has no filePath ⇒ LoraFinetuneError, no spawn", async () => {
    getAiModelByIdMock.mockResolvedValueOnce({ id: 7, code: "QWEN3", filePath: null });
    await expect(
      startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }),
    ).rejects.toBeInstanceOf(LoraFinetuneError);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
  });

  it("corpus store unmigrated (tableAvailable:false) ⇒ LoraFinetuneError, job dir cleaned, no spawn", async () => {
    listCorpusChunksForTrainingMock.mockResolvedValueOnce({ tableAvailable: false, chunks: [] });
    await expect(
      startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }),
    ).rejects.toThrow(/kb_studio_chunks not migrated/i);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledTimes(1);
    expect(rmSpy.mock.calls[0]![0]).toMatch(/jobs[\\/]lora[\\/]lora_\d+_[0-9a-f]{8}$/);
  });

  it("corpus too small (< LLM_FINETUNE_MIN_SAMPLES) ⇒ LoraFinetuneError, job dir cleaned, no spawn", async () => {
    listCorpusChunksForTrainingMock.mockResolvedValueOnce({ tableAvailable: true, chunks: makeChunks(3) });
    await expect(
      startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }),
    ).rejects.toThrow(/only 3 chunk/i);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledTimes(1);
  });

  it("sidecar spawn error (ENOENT-style) ⇒ LoraFinetuneError, job dir cleaned, no model_versions row", async () => {
    const p = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    lastChild!.emit("error", new Error("spawn python ENOENT"));
    await expect(p).rejects.toBeInstanceOf(LoraFinetuneError);
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledTimes(1);
  });

  it("sidecar exits non-zero ⇒ LoraFinetuneError, job dir cleaned, no model_versions row, no GGUF copy", async () => {
    const p = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    lastChild!.emit("exit", 1);
    await expect(p).rejects.toThrow(/exited with code 1/);
    expect(copySpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledTimes(1);
  });

  it("exit 0 but no model.gguf produced ⇒ LoraFinetuneError, no registration", async () => {
    const p = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    // Do NOT add output/model.gguf to fsExist.
    lastChild!.emit("exit", 0);
    await expect(p).rejects.toThrow(/produced no GGUF/i);
    expect(copySpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledTimes(1);
  });

  it("timeout ⇒ the child is SIGKILLed, LoraFinetuneError, job dir cleaned, no hang", async () => {
    process.env.LLM_FINETUNE_TIMEOUT_MS = "15";
    const p = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" });
    // Attach the rejection handler IMMEDIATELY (before any await) — the timeout is short
    // enough (15ms) that it can otherwise fire while we're still inside `vi.waitFor`'s polling
    // below, which would race Node's unhandledRejection detection against attaching `.catch`.
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    // Never emit exit/error — only the timeout should settle this promise.
    await assertion;
    expect(lastChild!.killed).toBe(true);
    expect(createModelVersionMock).not.toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("a downstream createModelVersion failure (after a genuinely successful train) is still a typed error with cleanup", async () => {
    createModelVersionMock.mockResolvedValueOnce(undefined);
    const p = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1", generateFn: perfectGenerateFn });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    const contract = JSON.parse(fsStore.get(findWritten("job.json")!)!);
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: {} }));
    lastChild!.emit("exit", 0);
    await expect(p).rejects.toBeInstanceOf(LoraFinetuneError);
    expect(persistEvalReportMock).not.toHaveBeenCalled();
    // The GGUF was already copied into trainedDir before createModelVersion returned no row —
    // that copy must be cleaned up (best-effort unlink) so no orphaned, untracked artifact is
    // left behind; the DB never gets a half-registered model either way.
    expect(copySpy).toHaveBeenCalledTimes(1);
    const orphanedPath = copySpy.mock.calls[0]![1] as string;
    expect(unlinkSpy).toHaveBeenCalledWith(orphanedPath);
    expect(rmSpy).toHaveBeenCalledTimes(1); // jobDir cleanup still happens too
  });

  it("createModelVersion THROWING (not just returning no row) also cleans up the orphaned .gguf", async () => {
    createModelVersionMock.mockRejectedValueOnce(new Error("db connection lost"));
    const p = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1", generateFn: perfectGenerateFn });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    const contract = JSON.parse(fsStore.get(findWritten("job.json")!)!);
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: {} }));
    lastChild!.emit("exit", 0);
    await expect(p).rejects.toBeInstanceOf(LoraFinetuneError);
    const orphanedPath = copySpy.mock.calls[0]![1] as string;
    expect(unlinkSpy).toHaveBeenCalledWith(orphanedPath);
    expect(rmSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── injection safety ──────────────────────────────────────────────────────

describe("startLoraFinetune — a malicious corpus name cannot inject via spawn or path", () => {
  beforeEach(() => {
    process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
  });

  it.each([
    "; rm -rf / #",
    "../../../etc/passwd",
    "$(cat /etc/shadow)",
    "corpus`whoami`",
    "corpus && del C:\\Windows",
  ])("corpus=%j never reaches jobDir, spawn args, or the shell", async (maliciousCorpus) => {
    listCorpusChunksForTrainingMock.mockResolvedValueOnce({ tableAvailable: true, chunks: makeChunks(20) });
    const p = startLoraFinetune({
      baseModelId: 7, corpus: maliciousCorpus, targetVersion: "1.0.0-lora.1", generateFn: perfectGenerateFn,
    });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());

    // The malicious string is passed through as ordinary DATA to the DB-read layer...
    expect(listCorpusChunksForTrainingMock).toHaveBeenCalledWith(maliciousCorpus, expect.any(Number));

    // ...but the job directory + every spawn argument stay confined to the safe, internally
    // generated jobId shape — the malicious string appears NOWHERE in them.
    const jobDirArg = lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1]!;
    expect(jobDirArg).toMatch(/jobs[\\/]lora[\\/]lora_\d+_[0-9a-f]{8}$/);
    expect(jobDirArg).not.toContain(maliciousCorpus);
    for (const arg of lastSpawnArgs!.args) expect(arg).not.toContain(maliciousCorpus);
    expect(lastSpawnArgs!.cmd).not.toContain(maliciousCorpus);

    // spawn was always invoked with an explicit arg ARRAY + shell:false (no shell involved at
    // all — a malicious corpus string could never be shell-interpreted even if it DID leak in).
    const spawnOpts = spawnSpy.mock.calls[spawnSpy.mock.calls.length - 1]![2] as { shell?: boolean };
    expect(spawnOpts.shell).toBe(false);
    expect(Array.isArray(lastSpawnArgs!.args)).toBe(true);

    // Settle the pending promise.
    const contract = JSON.parse(fsStore.get(findWritten("job.json")!)!);
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: {} }));
    lastChild!.emit("exit", 0);
    await p;
  });
});

describe("startLoraFinetune — a malicious targetVersion cannot escape trainedDir via the finalPath", () => {
  beforeEach(() => {
    process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
  });

  it.each([
    "../../../etc/x",
    "..\\..\\x",
    "a/b",
  ])("targetVersion=%j is rejected up front — no spawn, no DB call, no filesystem work", async (maliciousVersion) => {
    await expect(
      startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: maliciousVersion, generateFn: perfectGenerateFn }),
    ).rejects.toBeInstanceOf(LoraFinetuneError);
    // Rejected by the charset guard BEFORE the base model is even looked up — zero side effects,
    // exactly like the LLM_FINETUNE_CMD-unset gate test above.
    expect(getAiModelByIdMock).not.toHaveBeenCalled();
    expect(listCorpusChunksForTrainingMock).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(createModelVersionMock).not.toHaveBeenCalled();
  });
});

describe("startLoraFinetune — finalPath is built from jobId only (targetVersion is metadata, not a path component)", () => {
  beforeEach(() => {
    process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
  });

  it("the registered filePath is confined to trainedDir and derived solely from jobId, even for a benign-but-tricky version string containing dots", async () => {
    // This documents the PRIMARY defense directly (belt-and-suspenders charset rejection is
    // covered separately above): a value like "1.0.0-lora.1" legitimately contains characters
    // that WOULD be allowed by the charset guard, so this exercises the actual path-construction
    // code (not just the guard) and confirms it never echoes targetVersion into the filename.
    const p = startLoraFinetune({
      baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1", generateFn: perfectGenerateFn,
    });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    const contract = JSON.parse(fsStore.get(findWritten("job.json")!)!);
    fsExist.add(contract.output.ggufPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: {} }));
    lastChild!.emit("exit", 0);
    const result = await p;

    const createArgs = createModelVersionMock.mock.calls[0]![0] as Record<string, unknown>;
    const finalPath = createArgs.filePath as string;
    // finalPath is confined to trainedDir and built purely from the jobId shape — the version
    // string "1.0.0-lora.1" (still recorded separately as createArgs.version, i.e. METADATA)
    // does not appear anywhere in the filesystem path.
    expect(finalPath).toMatch(/[\\/]uploads[\\/]models[\\/]trained[\\/]lora_lora_\d+_[0-9a-f]{8}\.gguf$/);
    expect(finalPath).not.toContain("1.0.0-lora.1");
    expect(createArgs.version).toBe("1.0.0-lora.1"); // metadata is preserved, just not in the path
    expect(result.status).toBe("succeeded");
  });
});

// ─── evaluateLoraCandidate (the independent eval, unit-level) ─────────────

describe("evaluateLoraCandidate", () => {
  it("scores every held-out sample and reports a gate via the (mocked) aiEvalHarness primitives", async () => {
    const outcome = await evaluateLoraCandidate({
      candidateGgufPath: "/abs/models/candidate.gguf",
      testSamples: [{ text: chunkText(1) }, { text: chunkText(2) }],
      generateFn: perfectGenerateFn,
    });
    expect(outcome.candidate.evaluated).toBe(2);
    expect(outcome.candidate.skipped).toBe(0);
    expect(outcome.candidate.accuracy).toBe(1);
    expect(outcome.report.gate.pass).toBe(true);
    expect(evaluateQualityGateMock).toHaveBeenCalledWith(1, null, 0);
  });

  it("a generateFn that never matches the held-out completion drives accuracy toward 0", async () => {
    const outcome = await evaluateLoraCandidate({
      candidateGgufPath: "/abs/models/candidate.gguf",
      testSamples: [{ text: chunkText(1) }, { text: chunkText(2) }],
      generateFn: async () => "totally unrelated output zzz qqq",
    });
    expect(outcome.candidate.accuracy).toBe(0);
  });

  it("a generation failure for one sample is counted as skipped, not a crash", async () => {
    let call = 0;
    const outcome = await evaluateLoraCandidate({
      candidateGgufPath: "/abs/models/candidate.gguf",
      testSamples: [{ text: chunkText(1) }, { text: chunkText(2) }],
      generateFn: async () => {
        call++;
        if (call === 1) throw new Error("model OOM");
        return COMPLETION_TAIL;
      },
    });
    expect(outcome.candidate.evaluated).toBe(1);
    expect(outcome.candidate.skipped).toBe(1);
  });
});
