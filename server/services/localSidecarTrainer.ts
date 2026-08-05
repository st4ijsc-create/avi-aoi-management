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
 *              copy ONNX into uploads/models/trained/sidecar_<jobId>.onnx (filename derived
 *              SOLELY from the internally-generated numeric jobId — see the path-safety note in
 *              runSidecarTraining below; targetVersion is caller-supplied and is never
 *              concatenated into this path),
 *              return { success:true, outputModelPath, finalMetrics, ... }
 *      otherwise / timeout → { success:false, error }
 *
 * The Stage 3-6 quality gate in aiTrainingPipeline re-evaluates the produced
 * ONNX on the LOCKED test split — sidecar-reported metrics are advisory only and
 * are NEVER trusted for activation.
 */

import { spawn } from "child_process";
import path from "path";
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "./vram/vramRefusalSignal";
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
  /** "classification" (default), "detection", or "segmentation" — drives the sidecar pipeline. */
  task?: "classification" | "detection" | "segmentation";
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
      // ★ Pha 3 Task 5 — mã thoát của lượt TỪ CHỐI phải nói ĐÚNG nguyên nhân: người trực đọc
      // "Sidecar exited with code -3" sẽ đi tìm lỗi trong `train.py` — một tiến trình chưa bao
      // giờ chạy. Cùng kỷ luật `describeExitCode()` của module anh em.
      return fail(
        req.jobId,
        startTime,
        exitCode === EXIT_VRAM_REFUSED
          ? "VRAM refused for the trainer sidecar and the defer budget (VRAM_DEFER_BUDGET_HOURS) ran out — " +
            "the sidecar was NEVER spawned. [VI] Cổng sổ VRAM từ chối và ngân sách hoãn đã hết; " +
            "tiến trình huấn luyện CHƯA từng chạy — xem sự kiện defer/defer_exceeded trong vram_events."
          : `Sidecar exited with code ${exitCode}`,
      );
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

    // Copy the produced ONNX into the canonical trained-models dir. finalPath is built SOLELY
    // from `req.jobId` — an internally generated `training_jobs` primary key (a number, never
    // caller-influenced) — NEVER from `req.targetVersion` (a caller-supplied, zod-bounded but
    // not charset-restricted string; the sibling `aiLlmFinetuneSidecar.ts` had the identical
    // one-line path-traversal bug via its own targetVersion — see that module's doc comment).
    // targetVersion still flows through as METADATA in the job.json contract above (read by the
    // Python sidecar) — only removed from the FILESYSTEM PATH construction here.
    const trainedDir = trainedModelsDir();
    fs.mkdirSync(trainedDir, { recursive: true });
    const finalPath = path.join(trainedDir, `sidecar_${req.jobId}.onnx`);
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
 * ★★★ Pha 3 Task 5 (B) — MÃ THOÁT KHI LƯỢT XIN VRAM BỊ TỪ CHỐI **QUÁ ĐÁY HOÃN**.
 *
 * ⚠ Đây KHÔNG phải một lượt nuốt lời từ chối: tiến trình con **không được sinh ra**, nên cưỡng
 * chế vẫn có hiệu lực đúng như trước. Thứ được trả lại là hợp đồng `"Never rejects"` ghi ngay
 * dưới đây — thứ Pha 2B làm vỡ, và cái vỡ đó biến "chưa tới lượt" thành "job HỎNG".
 */
const EXIT_VRAM_REFUSED = -3;

/**
 * Spawn the sidecar process and poll progress.json until the process exits or
 * the timeout elapses. Resolves with the exit code (or a non-zero sentinel on
 * timeout/spawn error/VRAM refusal past the defer budget). Never rejects.
 */
async function spawnAndPoll(
  jobId: number,
  jobDir: string,
  progressPath: string,
  config?: Record<string, unknown>,
): Promise<number> {
  // ★ C-2 (review TOÀN NHÁNH) — HỘ TIÊU THỤ VRAM THỨ MƯỜI, xin phép NGAY TRƯỚC khi spawn.
  // TRƯỚC khi vào Promise theo dõi vì `beginTrainerVram()` là async còn executor bên dưới cố
  // tình giữ ĐỒNG BỘ (cùng khuôn `kbSyncScheduler.runKbSyncNow`).
  // ★★★ Pha 3 Task 5 — HỢP ĐỒNG "Never rejects" ĐƯỢC TRẢ LẠI. `beginTrainerVram()` đã hoãn tới
  // hết ngân sách rồi mới ném; tới đây thì việc đúng là **kết thúc lượt bằng một mã thoát có
  // tên**, không phải ném xuyên qua ba tầng để `runLocalTraining()` bắt được một `Error` lạ mặt.
  let vramTicket: import("./vram/vramWiring").VramTicket;
  try {
    vramTicket = await beginTrainerVram();
  } catch (err) {
    if (!isVramRefusal(err)) throw err;
    console.error(
      `[localSidecarTrainer] job ${jobId}: KHÔNG xin được VRAM sau khi đã hoãn hết ngân sách ` +
        `(VRAM_DEFER_BUDGET_HOURS) ⇒ KHÔNG spawn tiến trình con. ${(err as Error)?.message ?? err}`,
    );
    return EXIT_VRAM_REFUSED;
  }

  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      if (timer) clearTimeout(timer);
      resolve(code);
    };
    const releaseVram = () => {
      try {
        vramTicket.release();
      } catch {
        /* telemetry KHÔNG được làm hỏng vòng đời tiến trình con */
      }
    };

    let child;
    try {
      const { cmd, args } = resolveSidecarCommand(jobDir);
      child = spawn(cmd, args, { cwd: process.cwd(), shell: false, windowsHide: true });
    } catch (err) {
      // Nhánh thoát ĐỒNG BỘ: `resolveSidecarCommand()` ném (LOCAL_TRAINER_CMD rỗng) hoặc
      // `spawn()` ném (EACCES). Không listener nào kịp gắn ⇒ KHÔNG CÒN chỗ nào khác trả được
      // giấy phép này. Bài học Task 6 vòng 1.
      releaseVram();
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
      // ⚠ KHÔNG trả giấy phép ở đây: SIGKILL là YÊU CẦU chết, chưa phải cái chết. Nhánh "exit"
      // bên dưới trả chỗ khi tiến trình THẬT SỰ chết — kỷ luật thứ tự nhả I-1, xem đầu
      // `vram/vramWiring.ts`.
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      finish(-2);
    }, timeoutMs);

    // ⚠ release() ở CẢ HAI nhánh sự kiện: "exit" (đã chết) VÀ "error" (spawn hỏng — "exit" có
    // thể KHÔNG BAO GIỜ tới). Thiếu một nhánh là giấy phép treo vĩnh viễn ⇒ reconciler báo lệch
    // ÂM mãi mãi.
    child.on("error", () => { releaseVram(); finish(-1); });
    child.on("exit", (code) => { releaseVram(); finish(code == null ? -1 : code); });
  });
}

/**
 * ★ C-2 — giấy phép VRAM cho tiến trình con Python.
 *
 * `LOCAL_TRAINER_CMD` trỏ tới `tools/trainer/train.py`, và file đó cấp phát VRAM THẬT:
 * `:260-261` `torch.device("cuda")`, `:629-630`/`:693` huấn luyện YOLOv8-seg với `device=0`.
 * Docstring `train_seg()` (`:616`) nói rõ mô hình được chọn cỡ **~6 GB VRAM**.
 *
 * ⚠ Hôm nay hộ này đo 0 MiB **CHỈ VÌ `LOCAL_TRAINER_CMD` chưa được đặt**. Đó CHÍNH XÁC là lập
 * luận dự án đã dùng để tuyên bố hộ thứ SÁU (`aiReranker`, 0 MiB chỉ vì `RAG_RERANKER_GPU=false`)
 * và hộ thứ BẢY (`aiImageEmbedding`, 0 MiB chỉ vì `ENABLE_CUDA` vắng) là thiếu sót THẬT. Cùng
 * tiêu chuẩn ⇒ hộ này cũng vậy: một biến env là có ngay ~6 GB mà không công cụ nào thấy.
 *
 * ⚠ 6.144 MiB đi qua `configDefaultBytes` (không hard-code vào `estimatedBytes`) để sự kiện ghi
 * `estimateSource: "config-default"` — dấu vết để Task 7 truy "chỗ nào còn dựa hằng số". Số này
 * là MỤC TIÊU THIẾT KẾ chép từ docstring của chính script, chưa phải số ĐO — Pha 2 phải đo thật.
 *
 * ⚠ KHÔNG `commitMeasured()` (khác sidecar thị giác, giống `cron:kb-sync`): khi tiến trình con
 * thoát, VRAM của nó đã được OS thu hồi từ lâu — đo delta lúc đó chỉ cho ra 0 giả, tệ hơn không đo.
 *
 * ★★★ Pha 3 Task 5 (B) — **HOÃN, KHÔNG ĐÁNH THẤT BẠI.** Từ Pha 2B, một lời từ chối ở đây đi thẳng
 * ra `runLocalTraining()` → `catch` → `fail()` ⇒ job huấn luyện bị ghi **THẤT BẠI** và phải chạy
 * lại TAY, đúng lúc lý do duy nhất là *"card đang bận NGAY BÂY GIỜ"*. Và nó phá luôn hợp đồng
 * `"Never rejects"* ghi ở docstring `spawnAndPoll()`. Nay lượt xin đi qua `xinVramCoHoan()`: lùi
 * 15→60 phút, đáy `VRAM_DEFER_BUDGET_HOURS` (mặc định 6 giờ), mỗi lượt hoãn để lại **ba vết**.
 * Quá đáy thì lời từ chối **vẫn tới nơi** (cưỡng chế không bị tắt) — chỉ muộn hơn.
 */
async function beginTrainerVram(): Promise<import("./vram/vramWiring").VramTicket> {
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    const { xinVramCoHoan, vramJobDeferBudgetMs } = await import("./vram/vramDefer");
    return await xinVramCoHoan({
      owner: "sidecar:local-trainer",
      leaseKind: "external-process",
      priority: "background",
      budgetMs: vramJobDeferBudgetMs(),
      xin: () =>
        beginVramAllocation({
          owner: "sidecar:local-trainer",
          kind: "external-process",
          priority: "background",
          configDefaultBytes: Number(process.env.VRAM_TRAINER_ESTIMATE_MB ?? 6144) * 1024 * 1024,
          // Trần thời lượng job thật — quá mốc này tiến trình bị SIGKILL, nên giấy phép không bao
          // giờ sống lâu hơn khoảng tiến trình con được PHÉP sống.
          ttlMs: sidecarTimeoutMs(),
          releaseProof: "process-exit",
        }),
    });
  } catch (err) {
    // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG: nuốt ở đây là TẮT cưỡng chế tại điểm gọi này.
    if (isVramRefusal(err)) throw err;
    return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
  }
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
