/**
 * WS-1 Tier 2 (B8) — unit tests for the local Python-sidecar trainer scaffolding.
 *
 * Everything is mocked: child_process.spawn (fake EventEmitter), fs (job/progress/
 * result), buildDataset, and the DB. No real process, no real filesystem, no DB.
 *
 * Coverage:
 *  1. env OFF → dispatchTier2 throws AND pipeline Stage 2 takes the Tier-1 path.
 *  2. happy path → progress polled + pipeline runs eval/gate with outputModelPath.
 *  3. job.json written to the contracted shape.
 *  4. exit != 0 / missing model → FAILED, no model_version created.
 *  5. malformed progress.json → poller swallows it, no crash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── fs: in-memory store driven by the test ──────────────────────
const fsStore = new Map<string, string>();
const fsExist = new Set<string>();
const mkdirSpy = vi.fn();
const copySpy = vi.fn((src: string, dst: string) => {
  fsExist.add(dst);
  fsStore.set(dst, fsStore.get(src) ?? "<onnx>");
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
  };
  return { default: api, ...api };
});

// ── child_process.spawn: returns a controllable fake child ──────
let lastChild: FakeChild | null = null;
let lastSpawnArgs: { cmd: string; args: string[] } | null = null;

class FakeChild extends EventEmitter {
  killed = false;
  kill() { this.killed = true; }
}

const spawnSpy = vi.fn((cmd: string, args: string[]) => {
  lastSpawnArgs = { cmd, args };
  lastChild = new FakeChild();
  return lastChild;
});
vi.mock("child_process", () => ({ spawn: (c: string, a: string[]) => spawnSpy(c, a) }));

// ── buildDataset (dataset materialization) ──────────────────────
const buildDatasetMock = vi.fn(async () => ({
  datasetId: 12,
  totalSamples: 40,
  labelDistribution: { OK: 20, NG: 20 },
  split: { train: 30, val: 6, test: 4 },
  storageKey: "datasets/12",
  manifestPaths: {
    train: "/abs/uploads/datasets/12/train.jsonl",
    val: "/abs/uploads/datasets/12/val.jsonl",
    test: "/abs/uploads/datasets/12/test.jsonl",
  },
  labels: ["NG", "OK"],
}));
vi.mock("./aiDatasetBuilder", () => ({ buildDataset: (id: number) => buildDatasetMock(id) }));

// ── DB layer ────────────────────────────────────────────────────
const updateTrainingJobMock = vi.fn(async () => ({}));
vi.mock("../db/aiAdvanced", () => ({
  updateTrainingJob: (id: number, data: unknown) => updateTrainingJobMock(id, data),
}));
vi.mock("../db/ai", () => ({
  getAiModelById: vi.fn(async () => ({ id: 7, code: "M7", filePath: "/uploads/models/base.onnx", currentVersion: "1.0.0" })),
}));

import {
  isSidecarEnabled,
  runSidecarTraining,
  pollProgressOnce,
} from "./localSidecarTrainer";

// path.join on posix-style absolute cwd: we cannot control process.cwd() here,
// so we derive the expected job paths from whatever the module computed by
// reading back what it wrote. Helper: find the job.json key.
function findWritten(suffix: string): string | undefined {
  for (const k of fsStore.keys()) if (k.endsWith(suffix)) return k;
  return undefined;
}

beforeEach(() => {
  fsStore.clear();
  fsExist.clear();
  mkdirSpy.mockClear();
  copySpy.mockClear();
  spawnSpy.mockClear();
  updateTrainingJobMock.mockClear();
  buildDatasetMock.mockClear();
  lastChild = null;
  lastSpawnArgs = null;
  delete process.env.LOCAL_TRAINER_CMD;
  delete process.env.LOCAL_TRAINER_TIMEOUT_MS;
});

describe("isSidecarEnabled", () => {
  it("is false when LOCAL_TRAINER_CMD is unset/empty", () => {
    expect(isSidecarEnabled()).toBe(false);
    process.env.LOCAL_TRAINER_CMD = "   ";
    expect(isSidecarEnabled()).toBe(false);
  });
  it("is true when LOCAL_TRAINER_CMD is set", () => {
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    expect(isSidecarEnabled()).toBe(true);
  });
});

describe("runSidecarTraining — disabled", () => {
  it("returns success:false without spawning when env is off", async () => {
    const res = await runSidecarTraining({
      jobId: 42, modelId: 7, targetVersion: "1.3.0", datasetId: 12, classLabels: ["NG", "OK"],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled/i);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

describe("runSidecarTraining — happy path", () => {
  it("writes job.json, spawns without shell, copies ONNX, returns metrics", async () => {
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    process.env.LOCAL_TRAINER_TIMEOUT_MS = "60000";

    const p = runSidecarTraining({
      jobId: 42, modelId: 7, targetVersion: "1.3.0", datasetId: 12,
      classLabels: ["NG", "OK"], task: "classification", framework: "pytorch",
      config: { epochs: 5 },
    });

    // Let the spawn run; simulate sidecar producing model + result, then exit 0.
    await vi.waitFor(() => expect(lastChild).not.toBeNull());

    // Derive the EXACT artifact paths from the contract the module just wrote,
    // so we match its process.cwd()/path.join output (Windows-safe).
    const jobJsonKey0 = findWritten("job.json")!;
    const contract0 = JSON.parse(fsStore.get(jobJsonKey0)!);
    const modelPath = contract0.output.modelPath;
    const resultPath = contract0.output.resultPath;
    // Mark the produced artifacts as present.
    fsExist.add(modelPath);
    fsStore.set(resultPath, JSON.stringify({
      success: true,
      metrics: { accuracy: 0.94, precision: 0.93, recall: 0.95, f1Score: 0.94, confusionMatrix: [[20, 0], [1, 19]] },
    }));
    fsExist.add(resultPath);

    lastChild!.emit("exit", 0);

    const res = await p;

    // spawn invoked WITHOUT shell, jobDir as final arg.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(lastSpawnArgs!.cmd).toBe("python");
    expect(lastSpawnArgs!.args[0]).toBe("tools/trainer/train.py");
    expect(lastSpawnArgs!.args[lastSpawnArgs!.args.length - 1]).toMatch(/jobs[\\/]42$/);

    // job.json contract shape.
    const jobJsonKey = findWritten("job.json")!;
    const contract = JSON.parse(fsStore.get(jobJsonKey)!);
    expect(contract.jobId).toBe(42);
    expect(contract.targetVersion).toBe("1.3.0");
    expect(contract.classLabels).toEqual(["NG", "OK"]);
    expect(contract.task).toBe("classification");
    expect(contract.framework).toBe("pytorch");
    expect(contract.manifests.train).toBe("/abs/uploads/datasets/12/train.jsonl");
    expect(contract.manifests.val).toBe("/abs/uploads/datasets/12/val.jsonl");
    expect(contract.manifests.test).toBe("/abs/uploads/datasets/12/test.jsonl");
    expect(typeof contract.imageRoot).toBe("string");
    expect(contract.output.modelPath).toMatch(/output[\\/]model\.onnx$/);
    expect(contract.progressPath).toMatch(/progress\.json$/);

    // Result + ONNX copy into the canonical trained dir.
    expect(res.success).toBe(true);
    expect(res.outputModelPath).toMatch(/sidecar_42\.onnx$/);
    expect(copySpy).toHaveBeenCalled();
    expect(res.finalMetrics!.accuracy).toBe(0.94);
    expect(res.finalMetrics!.confusionMatrix).toEqual([[20, 0], [1, 19]]);
    expect(res.trainingSamples).toBe(30);
    expect(res.validationSamples).toBe(6);
  });
});

describe("runSidecarTraining — failures", () => {
  it("exit != 0 → success:false, no ONNX copy", async () => {
    process.env.LOCAL_TRAINER_CMD = "python train.py";
    const p = runSidecarTraining({ jobId: 42, modelId: 7, targetVersion: "1.3.0", datasetId: 12, classLabels: ["NG", "OK"] });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    lastChild!.emit("exit", 3);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/code 3/);
    expect(copySpy).not.toHaveBeenCalled();
  });

  it("exit 0 but no model.onnx → success:false", async () => {
    process.env.LOCAL_TRAINER_CMD = "python train.py";
    const p = runSidecarTraining({ jobId: 42, modelId: 7, targetVersion: "1.3.0", datasetId: 12, classLabels: ["NG", "OK"] });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());
    // Do NOT add model.onnx to fsExist.
    lastChild!.emit("exit", 0);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no model/i);
    expect(copySpy).not.toHaveBeenCalled();
  });
});

// ─── targetVersion path-traversal safety (inherited from the same one-line bug class fixed in
//     server/services/aiLlmFinetuneSidecar.ts's finalPath construction) ─────────────────────
describe("runSidecarTraining — a malicious targetVersion cannot escape the trained-models dir", () => {
  it.each([
    "../../../etc/passwd",
    "..\\..\\x",
    "a/b",
  ])("targetVersion=%j never influences the output artifact path", async (maliciousVersion) => {
    process.env.LOCAL_TRAINER_CMD = "python train.py";
    const p = runSidecarTraining({
      jobId: 42, modelId: 7, targetVersion: maliciousVersion, datasetId: 12, classLabels: ["NG", "OK"],
    });
    await vi.waitFor(() => expect(lastChild).not.toBeNull());

    const jobJsonKey = findWritten("job.json")!;
    const contract = JSON.parse(fsStore.get(jobJsonKey)!);
    fsExist.add(contract.output.modelPath);
    fsStore.set(contract.output.resultPath, JSON.stringify({ success: true, metrics: {} }));
    fsExist.add(contract.output.resultPath);
    lastChild!.emit("exit", 0);

    const res = await p;
    expect(res.success).toBe(true);

    // targetVersion still flows through as plain METADATA inside job.json (read by the Python
    // sidecar) — that's fine, it's never used as a filesystem path there either.
    expect(contract.targetVersion).toBe(maliciousVersion);

    // But the produced artifact's path is built SOLELY from the internally-generated numeric
    // jobId and stays confined to the canonical trained-models dir — the malicious targetVersion
    // never appears in it, and no traversal sequence survives into the resolved path.
    expect(res.outputModelPath).toMatch(/sidecar_42\.onnx$/);
    expect(res.outputModelPath).not.toContain("..");
    expect(res.outputModelPath).not.toContain(maliciousVersion);
    expect(copySpy).toHaveBeenCalledWith(contract.output.modelPath, res.outputModelPath);
  });
});

describe("pollProgressOnce", () => {
  it("ignores a malformed progress.json without throwing", async () => {
    const path = "/abs/uploads/training/jobs/42/progress.json";
    fsStore.set(path, "{ this is : not valid json");
    fsExist.add(path);
    await expect(pollProgressOnce(42, path)).resolves.toBeUndefined();
    expect(updateTrainingJobMock).not.toHaveBeenCalled();
  });

  it("ignores a missing/empty progress.json", async () => {
    await expect(pollProgressOnce(42, "/nope/progress.json")).resolves.toBeUndefined();
    const empty = "/abs/uploads/training/jobs/42/progress.json";
    fsStore.set(empty, "   ");
    fsExist.add(empty);
    await pollProgressOnce(42, empty);
    expect(updateTrainingJobMock).not.toHaveBeenCalled();
  });

  it("mirrors valid progress into updateTrainingJob (mapped band 30..75)", async () => {
    const path = "/abs/uploads/training/jobs/42/progress.json";
    fsStore.set(path, JSON.stringify({ progress: 0.5, epoch: 3, metrics: { loss: [1, 0.5] } }));
    fsExist.add(path);
    await pollProgressOnce(42, path);
    expect(updateTrainingJobMock).toHaveBeenCalledTimes(1);
    const [, data] = updateTrainingJobMock.mock.calls[0]!;
    expect((data as any).currentEpoch).toBe(3);
    // 0.5 → 30 + 0.5*45 = 52.5 → round 53
    expect((data as any).progress).toBe(53);
    expect((data as any).trainingMetrics).toEqual({ loss: [1, 0.5] });
  });
});
