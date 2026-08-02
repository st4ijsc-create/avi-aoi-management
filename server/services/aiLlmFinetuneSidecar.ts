/**
 * LoRA/QLoRA Fine-Tune Sidecar — doc69 Giai đoạn 5 / Wave E3, task E3-6 (LAST E3 task).
 *
 * An operator-managed, GATED pipeline: train a LoRA adapter on a KB corpus (E3-1/E3-2
 * `kb_studio_chunks`), convert it to GGUF, and register it as a `model_versions` row that
 * lands in the SAME eval→gate→activate path as every other model in this codebase
 * (`server/services/aiModelService.ts`'s `activateModelVersionManual` — the W0-2 eval-gate +
 * D3 model-card gate). This module NEVER activates a version itself — see "Never auto-activate"
 * below.
 *
 * ─── HONEST FRAMING (state this wherever the subsystem is surfaced) ───────────────────────
 * LoRA teaches a base model STYLE / FORMAT / domain-idiom (how to phrase an answer, what
 * structure to use, vendor-specific terminology) — it does NOT teach FACTS. Facts stay in RAG
 * (the KB corpus is retrieved at answer time regardless of which adapter is active). A LoRA
 * fine-tune is a subsystem an operator opts into for a specific style need; it is never the
 * default, and RAG-grounded generation (the existing local-AI answer path) remains the fast,
 * default, always-on path. Combine LoRA (style) + RAG (facts) — never use LoRA as a substitute
 * for grounding.
 *
 * ─── MIRRORS `server/services/localSidecarTrainer.ts` (read that file first) ──────────────
 * Same file-based, no-shell protocol:
 *   1. Build a bounded training JSONL from a KB corpus (kbStudioService.listCorpusChunksForTraining).
 *   2. Create  uploads/training/jobs/lora/<jobId>/{output,logs,dataset}
 *   3. Write   <jobDir>/job.json   — the training contract (read by tools/trainer/finetune_lora.py)
 *   4. spawn   LLM_FINETUNE_CMD <jobDir>   (NO shell → no injection; arg array, split like
 *      LOCAL_TRAINER_CMD — see resolveFinetuneCommand)
 *   5. on exit code 0 + <jobDir>/output/model.gguf present → read result.json (ADVISORY metrics
 *      only — never trusted for the gate, exactly like localSidecarTrainer's ONNX result.json),
 *      copy the GGUF into uploads/models/trained/, register a model_versions row, run an
 *      independent eval on a LOCKED held-out test split, persist the evalReport, and STOP.
 *      otherwise / timeout / ENOENT → a typed error, NO model_versions row, jobDir cleaned up.
 *
 * ─── Never auto-activate (the whole point of this file) ───────────────────────────────────
 * On sidecar success this module calls `createModelVersion` with status `"VALIDATING"` (needs
 * eval — mirrors `aiModelService.uploadModelVersion`'s own convention for a freshly-registered,
 * not-yet-vetted version) and, once the independent eval below completes, bumps it to `"READY"`
 * (trained + evaluated, still NOT active) — REGARDLESS of whether the eval gate passed. It never
 * calls `activateModelVersion` / `activateModelVersionManual` itself, and never reads
 * `AI_AUTO_PROMOTE_ENABLED` to decide otherwise (that flag is simply never consulted here — the
 * only way a LoRA version becomes ACTIVE is a human calling the EXISTING gated
 * `activateModelVersionManual`, which independently re-checks `evalReport.gate.pass` + the D3
 * card gate before allowing it, exactly as it does for every vision model version).
 *
 * ─── Independent eval, not sidecar self-report ─────────────────────────────────────────────
 * `evaluateLoraCandidate` below does NOT call `aiEvalHarness.evaluateModelVersion`/
 * `compareBeforeAfter` directly — those are ONNX-image-classifier-specific (they load an image,
 * run `predictWithLocalClassifier`, and compare against a `{imageUrl,label}` manifest), which
 * does not fit a generative text/GGUF LoRA adapter. Instead this module reuses the SAME shared
 * primitives aiEvalHarness itself is built on: `aiMetrics.buildConfusionMatrix`/`computeMetrics`
 * for the metric math, and `aiEvalHarness.evaluateQualityGate`/`persistEvalReport` for the gate
 * decision + persistence — so the resulting `evalReport` shape and `activateModelVersionManual`'s
 * `evalReport.gate.pass` check work IDENTICALLY for a LoRA version as for a vision version. The
 * eval itself: for each held-out test chunk, split it into a prompt prefix + an expected
 * completion, ask the CANDIDATE gguf to continue the prompt, and score word-overlap against the
 * expected completion (a STYLE/vocabulary-similarity signal, deliberately not a semantic-
 * correctness judge — consistent with "LoRA=style, not facts"). Never trusts the sidecar's own
 * advisory `result.json` metrics for this decision.
 *
 * ─── Dataset source: kb_studio_chunks only (NOT aiDatasetBuilder) ──────────────────────────
 * STEP 0 pointed at two candidate sources: E3-1's `kb_studio_chunks` and the existing
 * `aiDatasetBuilder`. Investigated `aiDatasetBuilder.ts`: every sample shape there is
 * `{imageUrl,label}` (classification) or `{imageUrl,masks}` (segmentation) — image/label data,
 * fundamentally incompatible with LLM text fine-tuning. So this module reads training text
 * EXCLUSIVELY from `kb_studio_chunks` via a new `kbStudioService.listCorpusChunksForTraining`
 * (bounded, deterministic order) — see that function's doc comment. A future "text instruction
 * dataset" table would be a natural fast-follow if a non-KB-corpus text source is ever needed.
 *
 * ─── Fail-safe ──────────────────────────────────────────────────────────────────────────────
 *  - `LLM_FINETUNE_CMD` unset (default) ⇒ the ENTIRE subsystem is inert: `isLlmFinetuneEnabled()`
 *    is false, `startLoraFinetune` throws {@link LoraFinetuneUnavailableError} before touching
 *    the filesystem or the DB.
 *  - Sidecar spawn ENOENT / non-zero exit / timeout (spawn-level `SIGKILL`, never hangs) ⇒
 *    {@link LoraFinetuneError}, NO `model_versions` row is ever created, and the job directory is
 *    removed (best-effort `fs.rmSync`) so a failed run never leaves partial artifacts behind.
 *  - A malicious corpus name (`"; rm -rf / #"`, `"../../../etc/passwd"`, …) can never reach the
 *    spawned process or a filesystem path: the corpus string is used ONLY (a) as a bound
 *    parameterized value in a drizzle `eq()` WHERE clause (kbStudioService — never string-
 *    concatenated into SQL or a path) and (b) as a JSON string field inside `job.json` (escaped
 *    by `JSON.stringify`). The job directory name is derived SOLELY from an internally generated
 *    `jobId` (`lora_<timestamp>_<random hex>` — never influenced by any request field), and the
 *    spawned command's argument array is `[...LLM_FINETUNE_CMD tail, jobDir]` — the corpus string
 *    never appears in `cmd`/`args` at all.
 *  - Likewise, a malicious `targetVersion` (`"../../../../etc/cron.d/pwned"`, `"..\\..\\x"`,
 *    `"a/b"`, …) can never influence the trained-artifact's filesystem path: `finalPath` is built
 *    SOLELY from the internally generated `jobId` (see {@link safeTrainedFilePath}) — never from
 *    `targetVersion`, which is used only as METADATA (the `model_versions.version` column and the
 *    changeLog text), exactly like `corpus`. A charset guard (`assertSafeIdentifier`) additionally
 *    REJECTS a `targetVersion` containing path separators/`..`/anything outside
 *    `[A-Za-z0-9._-]` up front, before any of this runs, as a belt-and-suspenders measure.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getAiModelById, getModelVersions, createModelVersion, updateModelVersion } from "../db/ai";
import { listCorpusChunksForTraining } from "./kbStudioService";
import { evaluateQualityGate, persistEvalReport, type CompareReport, type EvalResult, type QualityGateResult } from "./aiEvalHarness";
import { buildConfusionMatrix, computeMetrics, seededShuffle, hashString } from "./aiMetrics";
import type { ModelVersion } from "../../drizzle/schema";

// ─── Configuration ─────────────────────────────────────────────

/** Default sidecar timeout: 4 hours (LoRA/QLoRA runs typically longer than the vision Tier-2
 *  default). Override with LLM_FINETUNE_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** Default bound on how many kb_studio_chunks rows feed one fine-tune ("bounded, honest data
 *  assembly" per the brief) — override with LLM_FINETUNE_MAX_SAMPLES. */
const DEFAULT_MAX_SAMPLES = 5000;
/** Minimum corpus size to even attempt a fine-tune (guarantees a non-trivial train AND test
 *  split) — override with LLM_FINETUNE_MIN_SAMPLES. */
const DEFAULT_MIN_SAMPLES = 10;
/** Fraction of the (deterministically shuffled) corpus held out as the LOCKED test split. */
const TEST_SPLIT_RATIO = 0.1;
/** Word-overlap threshold above which a test sample counts as a style "match" — deliberately
 *  lenient (this is a style/vocabulary signal, not a semantic-correctness judge). */
const STYLE_MATCH_THRESHOLD = 0.15;
/** Split seed base — XORed with a per-corpus hash (mirrors aiDatasetBuilder's per-class seeding)
 *  so the split is deterministic for a given corpus without depending on row order. */
const SPLIT_SEED = 1337;

/** LoRA fine-tune sidecar is enabled only when LLM_FINETUNE_CMD is set (non-empty). Default OFF. */
export function isLlmFinetuneEnabled(): boolean {
  return !!(process.env.LLM_FINETUNE_CMD && process.env.LLM_FINETUNE_CMD.trim());
}

function finetuneTimeoutMs(): number {
  const raw = Number(process.env.LLM_FINETUNE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function maxSamples(): number {
  const raw = Number(process.env.LLM_FINETUNE_MAX_SAMPLES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_SAMPLES;
}

function minSamples(): number {
  const raw = Number(process.env.LLM_FINETUNE_MIN_SAMPLES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MIN_SAMPLES;
}

/**
 * The command + args for the sidecar. LLM_FINETUNE_CMD is split on whitespace (e.g.
 * `python tools/trainer/finetune_lora.py`) so the operator can configure the interpreter; the
 * job directory is appended as the FINAL argument. Split + spawned WITHOUT a shell — mirrors
 * localSidecarTrainer.resolveSidecarCommand exactly, same injection-safety rationale.
 */
function resolveFinetuneCommand(jobDir: string): { cmd: string; args: string[] } {
  const parts = (process.env.LLM_FINETUNE_CMD ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("LLM_FINETUNE_CMD is not set");
  }
  const [cmd, ...rest] = parts;
  return { cmd: cmd!, args: [...rest, jobDir] };
}

// ─── Typed errors ──────────────────────────────────────────────

/** Thrown when LLM_FINETUNE_CMD is unset — the whole subsystem is OFF by design. */
export class LoraFinetuneUnavailableError extends Error {
  constructor(message = "LoRA fine-tune sidecar is disabled (LLM_FINETUNE_CMD is not set).") {
    super(message);
    this.name = "LoraFinetuneUnavailableError";
  }
}

/** Thrown for every OTHER fail-safe case: missing/invalid base model, empty/too-small corpus,
 *  sidecar ENOENT/non-zero-exit/timeout, missing output GGUF, or a downstream registration
 *  failure. NEVER thrown after a `model_versions` row has already been created for a run that
 *  genuinely trained successfully — see the module doc comment's fail-safe section. */
export class LoraFinetuneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoraFinetuneError";
  }
}

/**
 * Charset guard for caller-supplied identifiers that are handled near filesystem paths
 * elsewhere in this codebase (defense in depth — see {@link jobRootDir}'s doc comment and
 * `finalPath` below for the PRIMARY defense, which is simply never concatenating these values
 * into a path at all). Rejects path separators, `..`, and anything outside a conservative
 * allowlist with a clear typed error instead of silently coercing a malicious value.
 */
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9._-]+$/;
function assertSafeIdentifier(value: string, field: string): void {
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new LoraFinetuneError(
      `${field} contains characters that are not allowed (only letters, digits, '.', '_', '-') — got "${value}".`,
    );
  }
}

// ─── Request / result types ────────────────────────────────────

export interface LoraHyperparams {
  /** LoRA rank (r). Default 16. */
  rank: number;
  /** LoRA alpha (scaling). Default 32. */
  alpha: number;
  epochs: number;
  learningRate: number;
  /** QLoRA quantization for the base model during training. "none" = full-precision LoRA. */
  quantization: "none" | "4bit" | "8bit";
  maxSeqLen: number;
  batchSize: number;
}

const DEFAULT_HYPERPARAMS: LoraHyperparams = {
  rank: 16,
  alpha: 32,
  epochs: 3,
  learningRate: 0.0002,
  quantization: "none",
  maxSeqLen: 2048,
  batchSize: 4,
};

function mergeHyperparams(overrides?: Partial<LoraHyperparams>): LoraHyperparams {
  return { ...DEFAULT_HYPERPARAMS, ...(overrides ?? {}) };
}

/** Injectable text-generation hook used ONLY by the independent eval step (never by training
 *  itself — training is entirely the Python sidecar's job). Defaults to a real
 *  `aiGgufEngine.loadGgufModel` + `generateText` call against the CANDIDATE gguf; tests inject a
 *  deterministic stub so this module's unit tests never touch the native llama.cpp binding. */
export type LoraGenerateFn = (prompt: string, ggufPath: string) => Promise<string>;

export interface StartLoraFinetuneRequest {
  /** ai_models.id of the BASE model this LoRA adapter is trained from (its filePath is the base
   *  GGUF handed to the sidecar). The resulting version is registered under this SAME model. */
  baseModelId: number;
  /** kb_studio_chunks corpus name — the ONLY supported training-data source (see module doc
   *  comment for why aiDatasetBuilder's image/label datasets don't apply here). */
  corpus: string;
  /** The new model_versions.version string (caller-chosen, e.g. "1.0.0-lora.1"). */
  targetVersion: string;
  hyperparams?: Partial<LoraHyperparams>;
  userId?: number;
  /** Test-only override for the eval step's generation call (see {@link LoraGenerateFn}). */
  generateFn?: LoraGenerateFn;
}

export interface StartLoraFinetuneResult {
  jobId: string;
  status: "succeeded";
  versionId: number;
  version: string;
  /** null when the independent eval step itself failed to run (version stays "VALIDATING" —
   *  activateModelVersionManual will refuse to activate it without an explicit, audited
   *  force:true override, which is the safe default for "we don't know if this is good"). */
  gate: QualityGateResult | null;
  evaluated: number;
  skipped: number;
}

// ─── Path helpers (Windows-safe, mirrors localSidecarTrainer) ──

function generateJobId(): string {
  return `lora_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

/** ALWAYS derived from the internally generated jobId — NEVER from corpus/version/any other
 *  request field, so a malicious string in those fields cannot influence a filesystem path. */
function jobRootDir(jobId: string): string {
  return path.join(process.cwd(), "uploads", "training", "jobs", "lora", jobId);
}

function trainedGgufDir(): string {
  return path.join(process.cwd(), "uploads", "models", "trained");
}

/**
 * Build the final trained-artifact path from an internally-generated `fileName` only (never a
 * raw caller-supplied field — see the CVE-class note in {@link startLoraFinetune}) and, as a
 * defense-in-depth safety net, assert the resolved result never escapes `trainedDir` before
 * anything is written there.
 */
function safeTrainedFilePath(trainedDir: string, fileName: string): string {
  const finalPath = path.join(trainedDir, fileName);
  const resolvedDir = path.resolve(trainedDir);
  const resolvedFinal = path.resolve(finalPath);
  if (resolvedFinal !== resolvedDir && !resolvedFinal.startsWith(resolvedDir + path.sep)) {
    throw new LoraFinetuneError(`Refusing to write trained artifact outside ${trainedDir}.`);
  }
  return finalPath;
}

function resolveFsPath(filePath: string): string {
  if (filePath.startsWith("/uploads/")) return path.join(process.cwd(), filePath);
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(process.cwd(), filePath);
}

/** Best-effort cleanup — NEVER throws. Called on every failure path AFTER the job directory has
 *  been created, so a failed run never leaves partial artifacts (checkpoints, half-written
 *  datasets, logs) behind. Never called after a successful run (artifacts + logs are kept for
 *  audit, mirroring localSidecarTrainer's own precedent of never deleting a successful job's dir). */
function cleanupJobDir(jobDir: string): void {
  try {
    fs.rmSync(jobDir, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[aiLlmFinetuneSidecar] failed to clean up job dir ${jobDir} (best-effort):`, (e as Error)?.message ?? e);
  }
}

// ─── job.json contract (read by tools/trainer/finetune_lora.py) ─

interface LoraJobContract {
  jobId: string;
  baseModelId: number;
  targetVersion: string;
  /** Absolute path to the base model (HF dir or a base .gguf — the Python side documents which
   *  it expects; see tools/trainer/finetune_lora.py's module doc comment). */
  baseModelPath: string;
  /** Informational only — NEVER used to build a path or shell arg on the Node side. */
  corpus: string;
  manifests: { train: string; test: string };
  hyperparams: LoraHyperparams;
  output: { dir: string; adapterDir: string; ggufPath: string; resultPath: string };
  progressPath: string;
  logsDir: string;
}

// ─── Training-data assembly (kb_studio_chunks → bounded JSONL) ──

interface LoraTextSample {
  text: string;
}

function writeJsonlText(filePath: string, samples: LoraTextSample[]): void {
  const lines = samples.map((s) => JSON.stringify({ text: s.text }));
  fs.writeFileSync(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
}

interface LoraDatasetBuild {
  trainPath: string;
  testPath: string;
  trainCount: number;
  testCount: number;
  /** Kept in memory (not re-read from disk) so the eval step can run directly against the exact
   *  held-out set this build produced. */
  testSamples: LoraTextSample[];
}

/**
 * Build a bounded, deterministic train/test JSONL split from a kb_studio_chunks corpus.
 * Completion-style records (`{"text": "..."}`) — the honest shape for a raw-text/style LoRA
 * (see module doc comment); NOT synthesized instruction/answer pairs (this module never
 * fabricates Q&A that wasn't in the source corpus).
 *
 * Throws {@link LoraFinetuneError} if the corpus store isn't migrated or has fewer than
 * `minSamples()` chunks — deliberately BEFORE any spawn, so an under-sized corpus never reaches
 * the sidecar at all.
 */
async function buildLoraTrainingSet(corpus: string, jobDir: string): Promise<LoraDatasetBuild> {
  const { tableAvailable, chunks } = await listCorpusChunksForTraining(corpus, maxSamples());
  if (!tableAvailable) {
    throw new LoraFinetuneError(
      `Knowledge corpus store is unavailable (kb_studio_chunks not migrated) — cannot build a LoRA training set for corpus "${corpus}".`,
    );
  }
  const min = minSamples();
  if (chunks.length < min) {
    throw new LoraFinetuneError(
      `Corpus "${corpus}" has only ${chunks.length} chunk(s) — need at least ${min} to fine-tune (bounded, honest data assembly; see LLM_FINETUNE_MIN_SAMPLES).`,
    );
  }

  const samples: LoraTextSample[] = chunks.map((c) => ({ text: c.text }));
  const seed = (SPLIT_SEED ^ hashString(corpus)) >>> 0;
  const shuffled = seededShuffle(samples, seed);
  const nTest = Math.max(1, Math.round(shuffled.length * TEST_SPLIT_RATIO));
  const testSamples = shuffled.slice(0, nTest);
  const trainSamples = shuffled.slice(nTest);

  const datasetDir = path.join(jobDir, "dataset");
  fs.mkdirSync(datasetDir, { recursive: true });
  const trainPath = path.join(datasetDir, "train.jsonl");
  const testPath = path.join(datasetDir, "test.jsonl");
  writeJsonlText(trainPath, trainSamples);
  writeJsonlText(testPath, testSamples);

  return { trainPath, testPath, trainCount: trainSamples.length, testCount: testSamples.length, testSamples };
}

// ─── Spawn (no shell, arg array — mirrors localSidecarTrainer) ──

function describeExitCode(code: number): string {
  if (code === -1) return "LoRA fine-tune sidecar failed to start (spawn error / command not found).";
  if (code === -2) return `LoRA fine-tune sidecar timed out after ${finetuneTimeoutMs()}ms.`;
  return `LoRA fine-tune sidecar exited with code ${code}.`;
}

/**
 * Spawn the sidecar and resolve with its exit code once it exits (or a negative sentinel on a
 * spawn error / timeout). Never rejects — mirrors localSidecarTrainer.spawnAndPoll, minus the
 * progress-polling-to-DB piece (there is no `training_jobs` row for a LoRA run in this task —
 * see module doc comment's dataset-source section for the equivalent DB-integration boundary).
 */
async function spawnAndWait(jobDir: string, baseModelPath: string): Promise<number> {
  // ★ C-2 (review TOÀN NHÁNH) — HỘ TIÊU THỤ VRAM THỨ MƯỜI MỘT, xin phép NGAY TRƯỚC khi spawn.
  const vramTicket = await beginFinetuneVram(baseModelPath);

  return new Promise<number>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
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
      const { cmd, args } = resolveFinetuneCommand(jobDir);
      child = spawn(cmd, args, { cwd: process.cwd(), shell: false, windowsHide: true });
    } catch {
      // Nhánh thoát ĐỒNG BỘ (resolveFinetuneCommand ném / spawn ném): không listener nào kịp
      // gắn ⇒ KHÔNG CÒN chỗ nào khác trả được giấy phép này. Bài học Task 6 vòng 1.
      releaseVram();
      finish(-1);
      return;
    }

    timer = setTimeout(() => {
      // ⚠ KHÔNG trả giấy phép ở đây: SIGKILL là yêu cầu chết, chưa phải cái chết (kỷ luật I-1).
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      finish(-2);
    }, finetuneTimeoutMs());

    child.on("error", () => { releaseVram(); finish(-1); });
    child.on("exit", (code) => { releaseVram(); finish(code == null ? -1 : code); });
  });
}

/**
 * ★ C-2 — giấy phép VRAM cho tiến trình con QLoRA.
 *
 * `LLM_FINETUNE_CMD` trỏ tới `tools/trainer/finetune_lora.py`, và file đó cấp phát VRAM THẬT:
 * `:174-196` chọn `torch.bfloat16` + `device_map="auto"` ngay khi `torch.cuda.is_available()` —
 * tức trọng số mô hình nền đi thẳng lên GPU (QLoRA 4-bit/8-bit là NHIỀU GB).
 *
 * ⚠ Hôm nay 0 MiB CHỈ VÌ `LLM_FINETUNE_CMD` chưa đặt — cùng lớp mù đã sinh ra hộ thứ sáu và
 * thứ bảy (xem `localSidecarTrainer.beginTrainerVram`).
 *
 * ⚠ KHÔNG bịa một hằng số: neo vào **KÍCH THƯỚC FILE trọng số nền THẬT** (`filePath` ⇒ nấc
 * `"file-size"` của `vramEstimator`), đúng kỷ luật `loadGgufModel`. QLoRA lượng tử hoá xuống
 * 4-bit nên nạp ÍT hơn file fp16 ⇒ đây là **trần trên có nguồn**, không phải một con số phát
 * minh — thứ đã làm hỏng bốn tài liệu quyết định trước. `VRAM_FINETUNE_ESTIMATE_MB` chỉ là lối
 * lùi khi không `stat` được file (lúc đó nấc tụt xuống `"config-default"`, hoặc `"unknown"` nếu
 * biến cũng không đặt — và `"unknown"` LÀ câu trả lời trung thực, xem báo cáo §5.4).
 */
async function beginFinetuneVram(baseModelPath: string): Promise<import("./vram/vramWiring").VramTicket> {
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    const envMb = Number(process.env.VRAM_FINETUNE_ESTIMATE_MB);
    return await beginVramAllocation({
      owner: "sidecar:llm-finetune",
      kind: "external-process",
      priority: "background",
      filePath: baseModelPath,
      configDefaultBytes: Number.isFinite(envMb) && envMb > 0 ? envMb * 1024 * 1024 : undefined,
      ttlMs: finetuneTimeoutMs(),
      releaseProof: "process-exit",
    });
  } catch {
    return { commitMeasured: async () => {}, release: () => {} };
  }
}

function sanitizeAdvisoryMetrics(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const m = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["trainLoss", "evalLoss", "perplexity", "samples", "epochs"]) {
    if (typeof m[key] === "number") out[key] = m[key];
  }
  return out;
}

// ─── Independent eval on the LOCKED held-out test split ─────────

/** Split a chunk's text into a prompt prefix (~40% of words) + the expected completion (the
 *  rest). Too-short chunks (<6 words) can't hold out a meaningful completion → null (skipped). */
function splitPromptCompletion(text: string): { prompt: string; completion: string } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 6) return null;
  const cut = Math.max(3, Math.floor(words.length * 0.4));
  return { prompt: words.slice(0, cut).join(" "), completion: words.slice(cut).join(" ") };
}

/** Lenient word-overlap coefficient (0..1) between two strings — a STYLE/vocabulary similarity
 *  signal, not a semantic judge (see module doc comment's honest framing). */
function wordOverlapScore(a: string, b: string): number {
  const wordsOf = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
  const setA = wordsOf(a);
  const setB = wordsOf(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / Math.min(setA.size, setB.size);
}

/** Default generation hook: loads the given gguf and asks aiGgufEngine to continue `prompt`.
 *  Dynamically imported so merely importing this MODULE never touches node-llama-cpp — only
 *  actually calling this function (i.e. running a real eval with no injected `generateFn`) does. */
async function defaultLoraGenerate(prompt: string, ggufPath: string): Promise<string> {
  const { loadGgufModel, generateText } = await import("./aiGgufEngine");
  const modelId = await loadGgufModel({ modelPath: ggufPath });
  const result = await generateText({ prompt, maxTokens: 200, temperature: 0.2 }, modelId);
  return result.text;
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(resolveFsPath(p));
  } catch {
    return false;
  }
}

/**
 * Score the candidate GGUF (and, if present, the current ACTIVE version's GGUF as a baseline)
 * against the held-out test split, then apply + persist the SAME quality gate every other model
 * version goes through. Does NOT call aiEvalHarness.evaluateModelVersion/compareBeforeAfter
 * (image-classifier-specific) — see module doc comment for the full rationale. Reuses
 * `aiMetrics.buildConfusionMatrix`/`computeMetrics` for the metric math and
 * `aiEvalHarness.evaluateQualityGate` for the pass/fail decision, so the resulting report is
 * structurally IDENTICAL to a vision model's CompareReport (`activateModelVersionManual` reads
 * `evalReport.gate.pass` without caring which model type produced it).
 */
export async function evaluateLoraCandidate(opts: {
  candidateGgufPath: string;
  testSamples: LoraTextSample[];
  baselineGgufPath?: string | null;
  epsilon?: number;
  generateFn?: LoraGenerateFn;
}): Promise<{ candidate: EvalResult; report: CompareReport }> {
  const generate = opts.generateFn ?? defaultLoraGenerate;

  const scoreAgainst = async (ggufPath: string): Promise<EvalResult> => {
    const predictedIdx: number[] = [];
    const actualIdx: number[] = [];
    let skipped = 0;
    for (const sample of opts.testSamples) {
      const parts = splitPromptCompletion(sample.text);
      if (!parts) {
        skipped++;
        continue;
      }
      let generated: string;
      try {
        generated = await generate(parts.prompt, ggufPath);
      } catch {
        skipped++;
        continue;
      }
      const score = wordOverlapScore(generated, parts.completion);
      // class 0 = "style-match" (always the ground truth for a held-out sample), class 1 =
      // "style-mismatch" (what the candidate is scored against).
      actualIdx.push(0);
      predictedIdx.push(score >= STYLE_MATCH_THRESHOLD ? 0 : 1);
    }
    const matrix = buildConfusionMatrix(predictedIdx, actualIdx, 2);
    const metrics = computeMetrics(matrix);
    return { ...metrics, evaluated: predictedIdx.length, skipped, labels: ["style-match", "style-mismatch"], split: "test" };
  };

  const candidate = await scoreAgainst(opts.candidateGgufPath);

  let baseline: EvalResult | null = null;
  if (opts.baselineGgufPath && fileExists(opts.baselineGgufPath)) {
    baseline = await scoreAgainst(opts.baselineGgufPath);
  }

  const gate = evaluateQualityGate(candidate.accuracy, baseline?.accuracy ?? null, opts.epsilon ?? 0);

  const report: CompareReport = {
    baseline,
    candidate,
    gate,
    split: "test",
    generatedAt: new Date().toISOString(),
    // sha256 over the sorted held-out sample texts — pins exactly what this run evaluated
    // against, mirroring aiDatasetBuilder.computeContentHash's ordering discipline (order-
    // independent, deterministic) without importing that (image-dataset-shaped) module.
    datasetContentHash: hashTestSamples(opts.testSamples),
  };

  return { candidate, report };
}

function hashTestSamples(samples: LoraTextSample[]): string {
  const sorted = samples.map((s) => s.text).sort();
  const h = crypto.createHash("sha256");
  for (const t of sorted) h.update(t).update("\n");
  return h.digest("hex");
}

async function getActiveVersionGguf(baseModelId: number): Promise<{ id: number; filePath: string | null } | null> {
  const versions = await getModelVersions(baseModelId);
  const active = versions.find((v) => v.status === "ACTIVE");
  if (!active) return null;
  return { id: active.id, filePath: active.filePath };
}

// ─── Main entry ────────────────────────────────────────────────

/**
 * Run the LoRA fine-tune sidecar end-to-end: build data → job.json → spawn (no shell) → on
 * success, register a NEW, NOT-active model_versions row + run the independent eval + persist
 * the evalReport. Throws a typed error and never leaves a half-registered model on ANY failure
 * BEFORE registration; a failure of the (optional, best-effort) eval step AFTER a successful
 * registration is swallowed (logged) so a real trained artifact stays visible to operators —
 * see the module doc comment.
 */
export async function startLoraFinetune(req: StartLoraFinetuneRequest): Promise<StartLoraFinetuneResult> {
  if (!isLlmFinetuneEnabled()) {
    throw new LoraFinetuneUnavailableError();
  }

  const corpus = (req.corpus ?? "").trim();
  if (!corpus) {
    throw new LoraFinetuneError("corpus is required.");
  }
  const targetVersion = (req.targetVersion ?? "").trim();
  if (!targetVersion) {
    throw new LoraFinetuneError("targetVersion is required.");
  }
  // Belt-and-suspenders: reject a targetVersion containing path separators/traversal sequences
  // outright, even though the PRIMARY defense below is that targetVersion is never concatenated
  // into a filesystem path at all (see the `finalPath` comment further down). targetVersion is
  // still passed through as plain METADATA to createModelVersion — exactly like `corpus`.
  assertSafeIdentifier(targetVersion, "targetVersion");

  const baseModel = await getAiModelById(req.baseModelId);
  if (!baseModel) {
    throw new LoraFinetuneError(`Base model ${req.baseModelId} not found — cannot fine-tune.`);
  }
  if (!baseModel.filePath) {
    throw new LoraFinetuneError(`Base model ${req.baseModelId} has no filePath — cannot fine-tune.`);
  }
  const baseModelPath = resolveFsPath(baseModel.filePath);
  const hyperparams = mergeHyperparams(req.hyperparams);

  const jobId = generateJobId();
  const jobDir = jobRootDir(jobId);
  const outputDir = path.join(jobDir, "output");
  const logsDir = path.join(jobDir, "logs");

  // Set once the trained GGUF has been copied into the durable trainedDir; `registered` flips
  // true only once `createModelVersion` has actually returned a row. If the copy happened but
  // registration never completed (e.g. `createModelVersion` throws), the catch block below
  // unlinks `copiedFinalPath` (best-effort) so a failed run never leaves an orphaned, untracked
  // .gguf with no `model_versions` row — see the module doc comment's fail-safe section.
  let copiedFinalPath: string | null = null;
  let registered = false;

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const dataset = await buildLoraTrainingSet(corpus, jobDir);

    const ggufPath = path.join(outputDir, "model.gguf");
    const resultPath = path.join(outputDir, "result.json");
    const progressPath = path.join(jobDir, "progress.json");
    const adapterDir = path.join(outputDir, "adapter");

    const contract: LoraJobContract = {
      jobId,
      baseModelId: req.baseModelId,
      targetVersion,
      baseModelPath,
      corpus,
      manifests: { train: dataset.trainPath, test: dataset.testPath },
      hyperparams,
      output: { dir: outputDir, adapterDir, ggufPath, resultPath },
      progressPath,
      logsDir,
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(contract, null, 2), "utf-8");

    // C-2 — `baseModelPath` đi kèm để ước lượng VRAM neo vào KÍCH THƯỚC FILE trọng số nền thật
    // (nấc "file-size"), thay vì một hằng số bịa. Xem `beginFinetuneVram()`.
    const exitCode = await spawnAndWait(jobDir, baseModelPath);
    if (exitCode !== 0) {
      throw new LoraFinetuneError(describeExitCode(exitCode));
    }
    if (!fs.existsSync(ggufPath)) {
      throw new LoraFinetuneError(`Sidecar finished but produced no GGUF at ${ggufPath}`);
    }

    // Advisory sidecar metrics — NEVER trusted for the gate (see module doc comment).
    let sidecarResult: unknown = {};
    try {
      sidecarResult = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    } catch {
      sidecarResult = {};
    }

    const trainedDir = trainedGgufDir();
    fs.mkdirSync(trainedDir, { recursive: true });
    // finalPath is built SOLELY from the internally-generated jobId — NEVER from targetVersion
    // (caller-supplied, zod-bounded but not charset-restricted). Putting targetVersion in a
    // filesystem path was a path-traversal / arbitrary-file-write vector (e.g.
    // targetVersion="../../../../etc/cron.d/pwned" could escape trainedDir). targetVersion is
    // still recorded — as pure METADATA — on the model_versions row created just below (the
    // `version` column and the changeLog text), exactly like `corpus` already is.
    const finalPath = safeTrainedFilePath(trainedDir, `lora_${jobId}.gguf`);
    fs.copyFileSync(ggufPath, finalPath);
    copiedFinalPath = finalPath;

    // ── Register — status "VALIDATING" ("needs eval"); NEVER "ACTIVE". ──
    const created: ModelVersion | undefined = await createModelVersion({
      modelId: req.baseModelId,
      version: targetVersion,
      filePath: finalPath,
      changeLog:
        `LoRA fine-tune (job ${jobId}) on corpus "${corpus}" — ${dataset.trainCount} train / ` +
        `${dataset.testCount} test samples (quantization=${hyperparams.quantization}, ` +
        `rank=${hyperparams.rank}, epochs=${hyperparams.epochs}). Sidecar-reported metrics are ` +
        `ADVISORY ONLY — see evalReport for the independently-evaluated gate decision. ` +
        `NOT activated: activation requires activateModelVersionManual (HITL).`,
      metrics: sanitizeAdvisoryMetrics((sidecarResult as { metrics?: unknown } | null)?.metrics),
      status: "VALIDATING",
      createdBy: req.userId,
    } as any); // additive/loosely-typed metrics bag — same cast convention as aiTrainingPipeline.ts's createModelVersion call

    if (!created) {
      throw new LoraFinetuneError("createModelVersion returned no row.");
    }
    registered = true;

    // ── Independent eval on the LOCKED held-out test split — best-effort; a failure here
    //    never un-registers the version, it just leaves it without an evalReport (so
    //    activateModelVersionManual refuses to activate it without an explicit force override,
    //    which is the safe default). ──
    let gate: QualityGateResult | null = null;
    let evaluated = 0;
    let skipped = 0;
    try {
      const baseline = await getActiveVersionGguf(req.baseModelId);
      const outcome = await evaluateLoraCandidate({
        candidateGgufPath: finalPath,
        testSamples: dataset.testSamples,
        baselineGgufPath: baseline?.filePath ?? null,
        generateFn: req.generateFn,
      });
      // Persist FIRST — only report gate/evaluated/skipped back to the caller once the
      // evalReport has actually landed in the DB, so "gate: null" consistently means "nothing
      // durable was written" (a persist failure must not report a gate the DB doesn't have).
      await persistEvalReport(created.id, outcome.candidate, outcome.report);
      await updateModelVersion(created.id, { status: "READY" });
      gate = outcome.report.gate;
      evaluated = outcome.candidate.evaluated;
      skipped = outcome.candidate.skipped;
    } catch (err) {
      console.warn(
        `[aiLlmFinetuneSidecar] independent eval failed for version ${created.id} ` +
        `(version stays "VALIDATING", no evalReport — activateModelVersionManual will refuse ` +
        `to activate it without force:true):`,
        (err as Error)?.message ?? err,
      );
    }

    return { jobId, status: "succeeded", versionId: created.id, version: created.version, gate, evaluated, skipped };
  } catch (err) {
    cleanupJobDir(jobDir);
    // A downstream failure AFTER the GGUF was copied into trainedDir but BEFORE registration
    // completed (e.g. createModelVersion throws, or returns no row) would otherwise leave an
    // orphaned .gguf sitting in trainedDir with no model_versions row pointing at it. Clean it
    // up best-effort so a failed run leaves no untracked artifact behind. Never runs once
    // `registered` is true — the "no half-registered model" DB invariant stays intact (a
    // registered version's artifact is always kept, even if the LATER, best-effort eval step
    // fails — that failure is swallowed above and never reaches this catch at all).
    if (copiedFinalPath && !registered) {
      try {
        fs.unlinkSync(copiedFinalPath);
      } catch (cleanupErr) {
        console.warn(
          `[aiLlmFinetuneSidecar] failed to clean up orphaned trained artifact ${copiedFinalPath} (best-effort):`,
          (cleanupErr as Error)?.message ?? cleanupErr,
        );
      }
    }
    if (err instanceof LoraFinetuneError || err instanceof LoraFinetuneUnavailableError) throw err;
    throw new LoraFinetuneError(err instanceof Error ? err.message : String(err));
  }
}
