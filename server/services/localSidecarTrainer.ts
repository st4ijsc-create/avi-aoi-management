/**
 * Local Sidecar Trainer — WS-1 Tier 2 (B8 scaffolding, opt-in, default OFF)
 *
 * This is the Node side of a FILE-BASED protocol that hands deep training off to
 * an external Python sidecar (PyTorch / Ultralytics). It is intentionally
 * OPT-IN: nothing here runs unless `LOCAL_TRAINER_CMD` is set, so the default
 * behavior of the pipeline (Tier-1 local-embedding classifier) is unchanged.
 *
 * Protocol (all paths absolute, Windows-safe via path.join):
 *   1. buildDataset(datasetId) → JSONL manifests (train/val/test).
 *   2. Create  uploads/training/jobs/<jobId>/{output,logs}
 *   3. Write   <jobDir>/job.json   — the training contract (read by the sidecar)
 *   4. spawn   LOCAL_TRAINER_CMD <jobDir>   (NO shell → no injection)
 *   5. poll    <jobDir>/progress.json — atomic-safe, parse failures ignored,
 *              mirror into updateTrainingJob(progress/currentEpoch/trainingMetrics)
 *   6. on exit code 0 + <jobDir>/output/model.onnx present → read result.json,
 *              copy ONNX into uploads/models/trained/sidecar_<jobId>_<version>.onnx,
 *              return { success:true, outputModelPath, finalMetrics, ... }
 *      otherwise / timeout → { success:false, error }
 *
 * The Stage 3-6 quality gate in aiTrainingPipeline re-evaluates the produced
 * ONNX on the LOCKED test split — sidecar-reported metrics are advisory only and
 * are NEVER trusted for activation.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import * as dbAdvanced from "../db/aiAdvanced";
import { getAiModelById } from "../db/ai";
import { buildDataset } from "./aiDatasetBuilder";
import type { LocalTrainingResult } from "./aiLocalTraining";

// ─── Configuration ─────────────────────────────────────────────

/** Default sidecar timeout: 2 hours. Override with LOCAL_TRAINER_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Progress poll interval. */
const POLL_INTERVAL_MS = 2000;

/**
 * Tier-2 sidecar is enabled only when LOCAL_TRAINER_CMD is set (non-empty).
 * Default OFF → offline-first Tier-1 only.
 */
export function isSidecarEnabled(): boolean {
  return !!(process.env.LOCAL_TRAINER_CMD && process.env.LOCAL_TRAINER_CMD.trim());
}

function sidecarTimeoutMs(): number {
  const raw = Number(process.env.LOCAL_TRAINER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * The command + args for the sidecar. LOCAL_TRAINER_CMD is split on whitespace
 * so the operator can configure e.g. `python tools/trainer/train.py`. The job
 * directory is appended as the final argument. We deliberately split args and
 * spawn WITHOUT a shell to avoid command injection.
 */
function resolveSidecarCommand(jobDir: string): { cmd: string; args: string[] } {
  const parts = (process.env.LOCAL_TRAINER_CMD ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("LOCAL_TRAINER_CMD is not set");
  }
  const [cmd, ...rest] = parts;
  return { cmd: cmd!, args: [...rest, jobDir] };
}

// ─── Request type ──────────────────────────────────────────────

export interface SidecarTrainingRequest {
  jobId: number;
  modelId: number;
  targetVersion: string;
  datasetId: number;
  classLabels: string[];
  /** "classification" (default) or "detection" — drives the sidecar pipeline. */
  task?: "classification" | "detection";
  /** Backend the sidecar should use, e.g. "pytorch" | "ultralytics". */
  framework?: string;
  /** Hyperparameters forwarded verbatim to the sidecar config block. */
  config?: Record<string, unknown>;
  createdBy?: number;
}

// ─── Path helpers (Windows-safe) ───────────────────────────────

function jobRootDir(jobId: number): string {
  return path.join(process.cwd(), "uploads", "training", "jobs", String(jobId));
}

function trainedModelsDir(): string {
  return path.join(process.cwd(), "uploads", "models", "trained");
}

/**
 * Resolve a stored model filePath (which may be a "/uploads/..." web path or an
 * absolute/relative fs path) to an absolute filesystem path.
 */
function resolveFsPath(filePath: string): string {
  if (filePath.startsWith("/uploads/")) return path.join(process.cwd(), filePath);
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(process.cwd(), filePath);
}

/** The root images are resolved against, so the sidecar can join relative urls. */
function imageRoot(): string {
  return path.join(process.cwd(), "uploads");
}

// ─── job.json contract ─────────────────────────────────────────

interface JobContract {
  jobId: number;
  modelId: number;
  targetVersion: string;
  task: string;
  framework: string;
  classLabels: string[];
  /** Absolute manifest paths. */
  manifests: { train: string; val: string; test: string };
  /** Pretrained base ONNX (absolute) if the model has one — sidecar may warm-start. */
  baseModelPath: string | null;
  /** Absolute root for resolving relative imageUrls in the manifests. */
  imageRoot: string;
  config: Record<string, unknown>;
  /** Where the sidecar must write outputs. */
  output: { dir: string; modelPath: string; resultPath: string };
  /** Where the sidecar must write incremental progress (atomic). */
  progressPath: string;
  logsDir: string;
}

// ─── Main entry ────────────────────────────────────────────────

/**
 * Run the Python sidecar trainer end-to-end and return a result in the same
 * shape as Tier-1 (LocalTrainingResult). Never throws on a training failure —
 * failures resolve with { success:false, error } so the pipeline marks the job
 * FAILED without creating a model_version.
 */
export async function runSidecarTraining(req: SidecarTrainingRequest): Promise<LocalTrainingResult> {
  const startTime = Date.now();

  if (!isSidecarEnabled()) {
    return {
      jobId: req.jobId,
      success: false,
      trainingSamples: 0,
      validationSamples: 0,
      durationMs: Date.now() - startTime,
      error: "Local sidecar trainer is disabled (LOCAL_TRAINER_CMD not set)",
    };
  }

  try {
    // ── 1. Materialize dataset manifests ──────────────────────
    const built = await buildDataset(req.datasetId);

    // ── 2. Create job dir tree ────────────────────────────────
    const jobDir = jobRootDir(req.jobId);
    const outputDir = path.join(jobDir, "output");
    const logsDir = path.join(jobDir, "logs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // ── 3. Write job.json contract ────────────────────────────
    const model = await getAiModelById(req.modelId);
    const baseModelPath = model?.filePath ? resolveFsPath(model.filePath) : null;

    const outputModelPath = path.join(outputDir, "model.onnx");
    const resultPath = path.join(outputDir, "result.json");
    const progressPath = path.join(jobDir, "progress.json");

    const contract: JobContract = {
      jobId: req.jobId,
      modelId: req.modelId,
      targetVersion: req.targetVersion,
      task: req.task ?? "classification",
      framework: req.framework ?? "pytorch",
      classLabels: req.classLabels,
      manifests: {
        train: built.manifestPaths.train,
        val: built.manifestPaths.val,
        test: built.manifestPaths.test,
      },
      baseModelPath,
      imageRoot: imageRoot(),
      config: req.config ?? {},
      output: { dir: outputDir, modelPath: outputModelPath, resultPath },
      progressPath,
      logsDir,
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(contract, null, 2), "utf-8");

    // ── 4. Spawn the sidecar (no shell) + 5. poll progress ────
    const exitCode = await spawnAndPoll(req.jobId, jobDir, progressPath, req.config);

    // ── 6. Interpret outcome ──────────────────────────────────
    if (exitCode !== 0) {
      return fail(req.jobId, startTime, `Sidecar exited with code ${exitCode}`);
    }
    if (!fs.existsSync(outputModelPath)) {
      return fail(req.jobId, startTime, `Sidecar finished but produced no model at ${outputModelPath}`);
    }

    // Read sidecar result (advisory metrics; gate re-evaluates anyway).
    let result: any = {};
    try {
      result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    } catch {
      result = {};
    }

    // Copy the produced ONNX into the canonical trained-models dir.
    const trainedDir = trainedModelsDir();
    fs.mkdirSync(trainedDir, { recursive: true });
    const finalPath = path.join(trainedDir, `sidecar_${req.jobId}_${req.targetVersion}.onnx`);
    fs.copyFileSync(outputModelPath, finalPath);

    const m = result.metrics ?? {};
    return {
      jobId: req.jobId,
      success: true,
      outputModelPath: finalPath,
      finalMetrics: {
        accuracy: Number(m.accuracy ?? 0),
        precision: Number(m.precision ?? 0),
        recall: Number(m.recall ?? 0),
        f1Score: Number(m.f1Score ?? 0),
        confusionMatrix: Array.isArray(m.confusionMatrix) ? m.confusionMatrix : [],
      },
      trainingSamples: built.split.train,
      validationSamples: built.split.val,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    return fail(req.jobId, startTime, err instanceof Error ? err.message : String(err));
  }
}

function fail(jobId: number, startTime: number, error: string): LocalTrainingResult {
  return {
    jobId,
    success: false,
    trainingSamples: 0,
    validationSamples: 0,
    durationMs: Date.now() - startTime,
    error,
  };
}

/**
 * Spawn the sidecar process and poll progress.json until the process exits or
 * the timeout elapses. Resolves with the exit code (or a non-zero sentinel on
 * timeout/spawn error). Never rejects.
 */
function spawnAndPoll(
  jobId: number,
  jobDir: string,
  progressPath: string,
  config?: Record<string, unknown>,
): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      if (timer) clearTimeout(timer);
      resolve(code);
    };

    let child;
    try {
      const { cmd, args } = resolveSidecarCommand(jobDir);
      child = spawn(cmd, args, { cwd: process.cwd(), shell: false, windowsHide: true });
    } catch (err) {
      finish(-1);
      return;
    }

    // ── Progress poller (atomic-safe, swallows parse errors) ──
    const poller = setInterval(() => {
      void pollProgressOnce(jobId, progressPath);
    }, POLL_INTERVAL_MS);

    // ── Timeout guard ─────────────────────────────────────────
    const timeoutMs = sidecarTimeoutMs();
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      finish(-2);
    }, timeoutMs);

    child.on("error", () => finish(-1));
    child.on("exit", (code) => finish(code == null ? -1 : code));
  });
}

/**
 * Read progress.json once and mirror it into the training_jobs row. All errors
 * (file missing, half-written file, malformed JSON) are swallowed so a transient
 * read never crashes the poller. Exported for unit testing.
 */
export async function pollProgressOnce(jobId: number, progressPath: string): Promise<void> {
  try {
    if (!fs.existsSync(progressPath)) return;
    const raw = fs.readFileSync(progressPath, "utf-8");
    if (!raw.trim()) return;
    const p = JSON.parse(raw);
    if (p == null || typeof p !== "object") return;

    const update: Record<string, unknown> = {};
    if (typeof p.progress === "number") update.progress = clampProgress(p.progress);
    if (typeof p.epoch === "number") update.currentEpoch = p.epoch;
    // Mirror the streaming metrics history if the sidecar provides it.
    if (p.metrics && typeof p.metrics === "object") update.trainingMetrics = p.metrics;
    if (Object.keys(update).length === 0) return;

    await dbAdvanced.updateTrainingJob(jobId, update);
  } catch {
    // Atomic-safe: ignore partial/missing/corrupt reads — try again next tick.
  }
}

/**
 * Map a sidecar progress fraction/percent (0..1 or 0..100) into the pipeline's
 * Stage-2 training band (30..75) so it composes with the surrounding stages.
 */
function clampProgress(raw: number): number {
  const pct = raw <= 1 ? raw * 100 : raw;
  const bounded = Math.max(0, Math.min(100, pct));
  return 30 + Math.round((bounded / 100) * 45);
}
