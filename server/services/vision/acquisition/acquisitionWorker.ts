/**
 * acquisitionWorker.ts — the first RUNTIME CONSUMER of the acquisition framework
 * (doc 27 §9 V14 · Đợt 7.6).
 *
 * Before this module, createImageSource / frameToCanonicalInspection were a fully
 * tested framework with ZERO production callers. The worker closes that gap with a
 * minimal, honest loop per configured source:
 *
 *   grab() → (optional) image-quality metrics → ledger entry → (optional) submit
 *   through the SAME canonical inspection path every other ingest uses
 *   (machineApiRouters.processInspectionSubmission — no duplicated insert logic).
 *
 * ── SCOPE (deliberate) ────────────────────────────────────────────────────────
 *   • file/mock sources are the real payload today (replay a capture folder, soak
 *     a pipeline). "genicam" remains a stub — createImageSource itself refuses it
 *     until a driver is bound, so the worker inherits that gate for free.
 *   • Quality metrics REUSE aiAdvancedVision.imageQualityCheck (read-only import;
 *     that module is owned elsewhere). Raw frames (Mono8/RGB8 with known dims)
 *     are PNG-encoded via sharp first; frames whose format sharp cannot decode
 *     get quality:null (honest — never fabricated metrics).
 *   • Submission is OFF by default (submit:false): a bare frame carries pixels,
 *     not a verdict — frameToCanonicalInspection stamps NTF ("needs inspection").
 *   • Ledger is in-memory (ring buffer, RETAIN=200/worker) + console — the
 *     hot-folder DB ledger pattern is not duplicated because the worker has no
 *     idempotency problem (it generates frames; it does not re-read dropped files).
 *   • NO UI beyond the status/start/stop endpoints in visionAdapterRouter — a
 *     dedicated panel is a documented follow-up (EquipmentIntegration page slot).
 *
 * ── GATING ────────────────────────────────────────────────────────────────────
 *   LIVE_ACQUISITION_ENABLED (existing flag) gates STARTING any worker — even for
 *   offline sources, because a running worker is a live ingest producer. Plus a
 *   per-config `enabled` field. Autostart via ACQUISITION_WORKER_AUTOSTART (JSON
 *   array of configs) for headless deployments; malformed JSON logs and no-ops.
 */
import { z } from "zod";
import {
  createImageSource,
  isLiveAcquisitionEnabled,
  type CreateImageSourceOptions,
  type Frame,
  type ImageSource,
} from "./index";
import { frameToCanonicalInspection, frameToDataUrl } from "./frameToCanonicalInspection";
import { isEncodedImageFormat } from "./imageSource";
import type { CanonicalInspection } from "../visionAdapterRegistry";

// ── Config (zod — also the router input schema) ───────────────────────────────

const fileSourceSchema = z.object({
  kind: z.literal("file"),
  sourceId: z.string().min(1).max(128).optional(),
  directory: z.string().min(1).max(1024).optional(),
  files: z.array(z.string().min(1).max(1024)).max(10_000).optional(),
  extensions: z.array(z.string().min(1).max(16)).max(32).optional(),
  loop: z.boolean().optional(),
});

const mockSourceSchema = z.object({
  kind: z.literal("mock"),
  sourceId: z.string().min(1).max(128).optional(),
  width: z.number().int().min(1).max(8192).optional(),
  height: z.number().int().min(1).max(8192).optional(),
  pixelFormat: z.enum(["Mono8", "RGB8"]).optional(),
  maxFrames: z.number().int().min(0).max(1_000_000).optional(),
  seed: z.number().int().optional(),
});

const genicamSourceSchema = z.object({
  kind: z.literal("genicam"),
  sourceId: z.string().min(1).max(128).optional(),
  // Stub — createImageSource/GenICamImageSource enforce the honest gates.
});

export const acquisitionWorkerConfigSchema = z
  .object({
    /** Unique worker id (also the status key). */
    id: z.string().min(1).max(128),
    source: z.discriminatedUnion("kind", [fileSourceSchema, mockSourceSchema, genicamSourceSchema]),
    /** Required when submit=true — the machine the frames belong to. */
    machineCode: z.string().min(1).max(100).optional(),
    /** Grab cadence (ms). Default 2000, floor 50. */
    intervalMs: z.number().int().min(50).max(3_600_000).optional(),
    /** Stop after N frames (0 = until source exhausts / stopped). */
    maxFrames: z.number().int().min(0).max(1_000_000).optional(),
    /** Submit each frame as a canonical (NTF) inspection. Default false. */
    submit: z.boolean().optional(),
    /** Run image-quality metrics per frame. Default true. */
    assessQuality: z.boolean().optional(),
    /** Per-config enable — disabled configs refuse to start (autostart lists can keep them). */
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.submit && !cfg.machineCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "submit:true requires machineCode (the inspection must belong to a machine)",
        path: ["machineCode"],
      });
    }
  });

export type AcquisitionWorkerConfig = z.infer<typeof acquisitionWorkerConfigSchema>;

// ── Ledger / status shapes ───────────────────────────────────────────────────

export interface AcquisitionQualitySummary {
  sharpness: number;
  brightness: number;
  contrast: number;
  blurScore: number;
  acceptable: boolean;
}

export interface AcquisitionLedgerEntry {
  frameId: number;
  at: string;
  sourceId: string;
  pixelFormat?: string;
  /** null = quality assessment skipped/undecodable (honest, not fabricated). */
  quality: AcquisitionQualitySummary | null;
  submitted: boolean;
  inspectionId?: number | null;
  error?: string;
}

export type AcquisitionWorkerState = "running" | "completed" | "stopped" | "error";

export interface AcquisitionWorkerStatus {
  id: string;
  state: AcquisitionWorkerState;
  config: AcquisitionWorkerConfig;
  startedAt: string;
  stoppedAt: string | null;
  framesGrabbed: number;
  submitted: number;
  errors: number;
  lastError: string | null;
  /** Tail of the in-memory ledger (newest last). */
  ledger: AcquisitionLedgerEntry[];
}

const LEDGER_RETAIN = 200;
const MAX_CONSECUTIVE_ERRORS = 5;

// ── Submit seam (same pattern as hotFolderService — test-injectable) ──────────

export type WorkerSubmitFn = (canonical: CanonicalInspection) => Promise<{ inspectionId: number | null }>;

let submitOverride: WorkerSubmitFn | null = null;

/** Test-only: replace the submitInspection call. */
export function __setAcquisitionSubmitForTests(fn: WorkerSubmitFn | null): void {
  submitOverride = fn;
}

async function submitCanonical(canonical: CanonicalInspection): Promise<{ inspectionId: number | null }> {
  if (submitOverride) return submitOverride(canonical);
  // The EXACT function behind machineApi.submitInspection (image upload, point/defect
  // resolution, NG/MQTT alerts, cache invalidation). rateLimit:false — the worker is a
  // trusted internal producer whose cadence is already bounded by intervalMs+maxFrames
  // (same rationale as the hot-folder/WAL internal callers).
  const { processInspectionSubmission } = await import("../../../routers/machineApiRouters");
  const result = await processInspectionSubmission(
    canonical as Parameters<typeof processInspectionSubmission>[0],
    { rateLimit: false },
  );
  return { inspectionId: result.inspectionId ?? null };
}

// ── Quality seam (READ-ONLY reuse of aiAdvancedVision.imageQualityCheck) ──────

type QualityFn = (image: Buffer) => Promise<AcquisitionQualitySummary | null>;

let qualityOverride: QualityFn | null = null;

/** Test-only: replace the quality assessor (avoids sharp/model deps in unit tests). */
export function __setAcquisitionQualityForTests(fn: QualityFn | null): void {
  qualityOverride = fn;
}

/**
 * Produce an encoded (PNG/JPEG/…) buffer for quality assessment: encoded frames
 * pass through; raw Mono8/RGB8 frames with known dims are PNG-encoded via sharp.
 * Returns null when the frame genuinely cannot be decoded (no fabricated pixels).
 */
async function frameToEncodedBuffer(frame: Frame): Promise<Buffer | null> {
  const fmt = frame.metadata.pixelFormat;
  if (isEncodedImageFormat(fmt)) return frame.data;
  const { width, height } = frame.metadata;
  if (!width || !height) return null;
  const upper = (fmt ?? "").toUpperCase();
  const channels = upper === "RGB8" ? 3 : upper === "MONO8" ? 1 : null;
  if (!channels || frame.data.length < width * height * channels) return null;
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(frame.data, { raw: { width, height, channels: channels as 1 | 3 } })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function assessFrameQuality(frame: Frame): Promise<AcquisitionQualitySummary | null> {
  try {
    const encoded = await frameToEncodedBuffer(frame);
    if (!encoded) return null;
    if (qualityOverride) return qualityOverride(encoded);
    const { imageQualityCheck } = await import("../../aiAdvancedVision");
    const q = await imageQualityCheck(encoded);
    return {
      sharpness: q.sharpness,
      brightness: q.brightness,
      contrast: q.contrast,
      blurScore: q.blurScore,
      acceptable: q.acceptable,
    };
  } catch {
    return null; // metrics unavailable → honest null, never fabricated
  }
}

// ── Runtime ──────────────────────────────────────────────────────────────────

interface WorkerRuntime {
  config: AcquisitionWorkerConfig;
  source: ImageSource | null;
  state: AcquisitionWorkerState;
  startedAt: Date;
  stoppedAt: Date | null;
  framesGrabbed: number;
  submitted: number;
  errors: number;
  consecutiveErrors: number;
  lastError: string | null;
  ledger: AcquisitionLedgerEntry[];
  timer: NodeJS.Timeout | null;
  /** In-flight tick guard (ticks never overlap). */
  busy: boolean;
}

const workers = new Map<string, WorkerRuntime>();

function pushLedger(rt: WorkerRuntime, entry: AcquisitionLedgerEntry): void {
  rt.ledger.push(entry);
  if (rt.ledger.length > LEDGER_RETAIN) rt.ledger.splice(0, rt.ledger.length - LEDGER_RETAIN);
}

async function closeSource(rt: WorkerRuntime): Promise<void> {
  const src = rt.source;
  rt.source = null;
  if (src) {
    try {
      await src.close();
    } catch {
      /* close must never throw upward */
    }
  }
}

function finish(rt: WorkerRuntime, state: AcquisitionWorkerState): void {
  if (rt.timer) {
    clearTimeout(rt.timer);
    rt.timer = null;
  }
  rt.state = state;
  rt.stoppedAt = new Date();
  void closeSource(rt);
}

async function tick(rt: WorkerRuntime): Promise<void> {
  if (rt.state !== "running" || rt.busy) return;
  rt.busy = true;
  try {
    const src = rt.source;
    if (!src) {
      finish(rt, "error");
      return;
    }

    let frame: Frame;
    try {
      frame = await src.grab();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no more frames|exhausted/i.test(msg)) {
        console.log(`[AcqWorker] ${rt.config.id}: source exhausted after ${rt.framesGrabbed} frame(s) — completed`);
        finish(rt, "completed");
        return;
      }
      rt.errors++;
      rt.consecutiveErrors++;
      rt.lastError = msg;
      pushLedger(rt, {
        frameId: rt.framesGrabbed + 1,
        at: new Date().toISOString(),
        sourceId: src.sourceId,
        quality: null,
        submitted: false,
        error: msg,
      });
      if (rt.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[AcqWorker] ${rt.config.id}: ${MAX_CONSECUTIVE_ERRORS} consecutive grab errors — stopping (error)`);
        finish(rt, "error");
      }
      return;
    }

    rt.framesGrabbed++;
    rt.consecutiveErrors = 0;

    const quality = rt.config.assessQuality === false ? null : await assessFrameQuality(frame);

    const entry: AcquisitionLedgerEntry = {
      frameId: frame.metadata.frameId,
      at: frame.metadata.timestamp,
      sourceId: frame.metadata.sourceId,
      pixelFormat: frame.metadata.pixelFormat,
      quality,
      submitted: false,
    };

    if (rt.config.submit && rt.config.machineCode) {
      try {
        const canonical = frameToCanonicalInspection(frame, {
          machineCode: rt.config.machineCode,
          // Attach a renderable image when the frame is encoded (bridge is honest
          // about raw formats — no fake data-URL). Verdict stays NTF: acquisition
          // is not judgement.
          encodeImage: !!frameToDataUrl(frame),
        });
        const { inspectionId } = await submitCanonical(canonical);
        entry.submitted = true;
        entry.inspectionId = inspectionId;
        rt.submitted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.error = `submit failed: ${msg}`;
        rt.errors++;
        rt.lastError = entry.error;
      }
    }

    pushLedger(rt, entry);

    if (rt.config.maxFrames && rt.framesGrabbed >= rt.config.maxFrames) {
      console.log(`[AcqWorker] ${rt.config.id}: reached maxFrames=${rt.config.maxFrames} — completed`);
      finish(rt, "completed");
    }
  } finally {
    rt.busy = false;
    if (rt.state === "running") {
      rt.timer = setTimeout(() => void tick(rt), Math.max(50, rt.config.intervalMs ?? 2000));
      if (typeof rt.timer.unref === "function") rt.timer.unref();
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface StartWorkerResult {
  ok: boolean;
  reason?: string;
  id?: string;
}

/**
 * Start one worker. Refuses when: the LIVE_ACQUISITION_ENABLED flag is off (the
 * worker is a live ingest producer — offline sources stay constructable for
 * dev/tests via createImageSource directly), the config is disabled, or another
 * RUNNING worker holds the same id. Source construction/open errors are returned
 * as honest reasons, never thrown.
 */
export async function startAcquisitionWorker(config: AcquisitionWorkerConfig): Promise<StartWorkerResult> {
  if (!isLiveAcquisitionEnabled()) {
    return {
      ok: false,
      reason:
        "Acquisition worker is disabled — set LIVE_ACQUISITION_ENABLED=true to allow " +
        "running acquisition loops (offline sources remain available for dev/tests).",
    };
  }
  if (config.enabled === false) {
    return { ok: false, reason: `Worker "${config.id}" is disabled (enabled:false).` };
  }
  const existing = workers.get(config.id);
  if (existing && existing.state === "running") {
    return { ok: false, reason: `Worker "${config.id}" is already running.` };
  }

  let source: ImageSource;
  try {
    source = createImageSource(config.source as CreateImageSourceOptions);
    await source.open();
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const rt: WorkerRuntime = {
    config,
    source,
    state: "running",
    startedAt: new Date(),
    stoppedAt: null,
    framesGrabbed: 0,
    submitted: 0,
    errors: 0,
    consecutiveErrors: 0,
    lastError: null,
    ledger: [],
    timer: null,
    busy: false,
  };
  workers.set(config.id, rt);
  console.log(
    `[AcqWorker] ${config.id}: started (${config.source.kind} source, interval=${config.intervalMs ?? 2000}ms, ` +
      `submit=${config.submit === true}, quality=${config.assessQuality !== false})`,
  );
  // First tick immediately (no initial delay).
  void tick(rt);
  return { ok: true, id: config.id };
}

/** Stop a worker by id. Idempotent; unknown id → {ok:false}. */
export async function stopAcquisitionWorker(id: string): Promise<{ ok: boolean; reason?: string }> {
  const rt = workers.get(id);
  if (!rt) return { ok: false, reason: `No worker "${id}"` };
  if (rt.state === "running") {
    finish(rt, "stopped");
    console.log(`[AcqWorker] ${id}: stopped after ${rt.framesGrabbed} frame(s)`);
  }
  return { ok: true };
}

/** Stop everything (shutdown / test teardown). */
export async function stopAllAcquisitionWorkers(): Promise<void> {
  for (const id of workers.keys()) await stopAcquisitionWorker(id);
}

/** Status of every registered worker (running + finished, ledger tail included). */
export function getAcquisitionWorkersStatus(): {
  liveEnabled: boolean;
  workers: AcquisitionWorkerStatus[];
} {
  return {
    liveEnabled: isLiveAcquisitionEnabled(),
    workers: [...workers.values()].map((rt) => ({
      id: rt.config.id,
      state: rt.state,
      config: rt.config,
      startedAt: rt.startedAt.toISOString(),
      stoppedAt: rt.stoppedAt ? rt.stoppedAt.toISOString() : null,
      framesGrabbed: rt.framesGrabbed,
      submitted: rt.submitted,
      errors: rt.errors,
      lastError: rt.lastError,
      ledger: rt.ledger.slice(-20),
    })),
  };
}

/** Test-only: drop all runtime state. */
export async function __resetAcquisitionWorkersForTests(): Promise<void> {
  await stopAllAcquisitionWorkers();
  workers.clear();
  submitOverride = null;
  qualityOverride = null;
}

/**
 * Boot autostart: ACQUISITION_WORKER_AUTOSTART = JSON array of worker configs.
 * Malformed JSON / invalid configs log and no-op (never block boot). Does nothing
 * when LIVE_ACQUISITION_ENABLED is off (startAcquisitionWorker re-checks anyway).
 */
export async function startAcquisitionWorkersFromEnv(): Promise<{ started: number }> {
  const raw = (process.env.ACQUISITION_WORKER_AUTOSTART ?? "").trim();
  if (!raw) return { started: 0 };
  if (!isLiveAcquisitionEnabled()) {
    console.log("[AcqWorker] autostart configured but LIVE_ACQUISITION_ENABLED is off — skipping");
    return { started: 0 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[AcqWorker] ACQUISITION_WORKER_AUTOSTART is not valid JSON:", (err as Error)?.message ?? err);
    return { started: 0 };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  let started = 0;
  for (const item of list) {
    const check = acquisitionWorkerConfigSchema.safeParse(item);
    if (!check.success) {
      console.error("[AcqWorker] autostart config invalid:", check.error.issues[0]?.message ?? "unknown");
      continue;
    }
    const res = await startAcquisitionWorker(check.data);
    if (res.ok) started++;
    else console.warn(`[AcqWorker] autostart "${check.data.id}" refused: ${res.reason}`);
  }
  return { started };
}
