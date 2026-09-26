/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-4) — local video transcription (ffmpeg + whisper.cpp sidecars)
 * → Knowledge & Training Studio ingest.
 *
 * Pipeline: video (buffer or on-disk path) → ffmpeg extracts a 16kHz mono wav (whisper.cpp's
 * expected input) → whisper.cpp transcribes the wav → plain text → E3-1's
 * `kbIngestService.ingestDocument` (parse[pass-through, kbDocParser's "video" case]→chunk→
 * embed→store). This file does NOT reimplement chunk/embed/store — `ingestVideo` at the bottom
 * is a thin wrapper around `ingestDocument`, mirroring kbWebFetcher.ts's `ingestUrl`.
 *
 * 100% local, no cloud: both sidecars are external binaries resolved from env
 * (`FFMPEG_BIN`, `WHISPER_BIN`, `WHISPER_MODEL`) and spawned on localhost with no network I/O
 * of their own. See docs/ECOSYSTEM for the runbook (install + env vars + the live-run ops step).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * SHELL-INJECTION SAFETY (critical): every sidecar invocation goes through `runSidecar` below,
 * which calls Node's `execFile` (promisified) — NEVER `exec` with a concatenated shell string.
 * `execFile` takes `(command, argsArray, options)` and never spawns a shell to parse the
 * command line (no `shell: true` anywhere in this file), so an argv element can contain
 * `; rm -rf /`, `$(id)`, backticks, spaces, or unicode and it is passed to the OS as ONE
 * opaque argument — there is no shell metacharacter parsing step for an attacker-influenced
 * value to reach. The two places an attacker-influenced string could otherwise leak into a
 * command are defused specifically:
 *   1. The caller-supplied `filename` is NEVER used to build a filesystem path. This module
 *      always writes its own temp files under a GENERATED name (`crypto.randomUUID()`) inside
 *      `getTempDir()` — `filename` only ever contributes a short, allow-listed (`[a-z0-9]{1,8}`)
 *      extension hint via `sanitizeExtension`, and even that is optional cosmetic help for
 *      ffmpeg's format probing, not something the temp path's uniqueness depends on.
 *   2. The caller-supplied on-disk `path` (when provided instead of a buffer) IS passed as an
 *      argv element to ffmpeg — which is safe (argv elements are never shell-parsed) but this
 *      module still never interpolates it into a string that is later executed.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * FAIL-SAFE discipline (mirrors llamaVisionSidecar.ts / localSidecarTrainer.ts):
 *  - `WHISPER_BIN` / `FFMPEG_BIN` / `WHISPER_MODEL` unset → {@link SttUnavailableError} — checked
 *    by `getSttConfig()` BEFORE any spawn is attempted.
 *  - A configured binary that doesn't actually exist (spawn fails with ENOENT) → the SAME
 *    {@link SttUnavailableError}, caught in `runSidecar`'s error handler — a missing binary and
 *    an unset env var are both "local STT not configured" to the caller.
 *  - Non-zero exit code or a timeout → {@link SttTranscribeError} (never a raw/uncaught
 *    rejection, never a hang — every sidecar call has a hard `timeout` via execFile's native
 *    `timeout`/`killSignal` options).
 *  - Every temp file this module creates (input-from-buffer, wav, transcript txt) is unlinked
 *    in a `finally`, on every exit path (success, validation failure, sidecar failure, timeout).
 *  - Bounded: `VIDEO_INGEST_MAX_BYTES` caps the input size (checked BEFORE writing/spawning),
 *    `VIDEO_INGEST_MAX_DURATION_SEC` caps the EXTRACTED audio duration via ffmpeg's own `-t`
 *    (so a huge/looping video can't produce an unbounded wav even if it slipped past the byte
 *    cap), and separate timeouts bound each of the two sidecar steps.
 *
 * Gating: `isVideoIngestEnabled()` (`VIDEO_INGEST_ENABLED`, default OFF — mirrors
 * kbWebFetcher.ts's `WEB_INGEST_ENABLED`) AND `isKbStudioEnabled()`, both checked in
 * `ingestVideo` BEFORE any sidecar work. RBAC/2FA is enforced at the router layer
 * (server/routers/kbIngestRouter.ts), same pattern as E3-1/E3-3.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { ingestDocument, isKbStudioEnabled, type IngestDocumentResult } from "./kbIngestService";

const execFileAsync = promisify(execFile);

// ─── Errors ──────────────────────────────────────────────────────────────────────────────

/** The exact fail-safe message the task brief specifies, reused for every "not configured /
 * binary missing" case so callers can rely on the message shape, not just the type. */
const STT_NOT_CONFIGURED_MESSAGE =
  "local STT not configured — set WHISPER_BIN/FFMPEG_BIN + WHISPER_MODEL";

/** Thrown when WHISPER_BIN/FFMPEG_BIN/WHISPER_MODEL are unset, OR a configured binary could not
 * be spawned (ENOENT) — both cases mean "local STT is not usable right now". Never a crash. */
export class SttUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ? `${STT_NOT_CONFIGURED_MESSAGE} (${detail})` : STT_NOT_CONFIGURED_MESSAGE);
    this.name = "SttUnavailableError";
  }
}

/** Thrown for bad/insufficient input: no buffer/path supplied, empty file, or the input exceeds
 * `VIDEO_INGEST_MAX_BYTES`. */
export class SttValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttValidationError";
  }
}

/** Thrown when a configured, spawnable sidecar still fails: non-zero exit code, a timeout, or
 * it produced no usable output (empty wav / missing or empty transcript file). */
export class SttTranscribeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SttTranscribeError";
  }
}

/** Thrown when VIDEO_INGEST_ENABLED and/or KB_STUDIO_ENABLED is off — `ingestVideo` refuses
 * before touching ffmpeg/whisper.cpp or the ingest pipeline. */
export class VideoIngestDisabledError extends Error {
  constructor() {
    super("Video ingest is disabled (set VIDEO_INGEST_ENABLED=true AND KB_STUDIO_ENABLED=true to enable).");
    this.name = "VideoIngestDisabledError";
  }
}

// ─── Flags / tunables (all read fresh per call — never cached at module load) ─────────────

/** VIDEO_INGEST_ENABLED gate. Default OFF — mirrors kbWebFetcher.ts's isWebIngestEnabled. */
export function isVideoIngestEnabled(): boolean {
  const v = String(process.env.VIDEO_INGEST_ENABLED ?? "false").toLowerCase();
  return v === "true" || v === "1";
}

/** Max accepted input video size (bytes). Checked BEFORE writing any temp file or spawning
 * ffmpeg. Default 500MB. */
const MAX_BYTES = (() => {
  const n = Number(process.env.VIDEO_INGEST_MAX_BYTES ?? 500 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 500 * 1024 * 1024;
})();

/** Hard cap on the EXTRACTED audio duration (seconds), enforced via ffmpeg's own `-t` output
 * option — bounds whisper.cpp's work regardless of how long the source video actually is.
 * Default 3600s (1 hour). */
const MAX_DURATION_SEC = (() => {
  const n = Number(process.env.VIDEO_INGEST_MAX_DURATION_SEC ?? 3600);
  return Number.isFinite(n) && n > 0 ? n : 3600;
})();

/** Wall-clock timeout for the ffmpeg extraction step. Default 5 minutes. */
const FFMPEG_TIMEOUT_MS = (() => {
  const n = Number(process.env.VIDEO_INGEST_FFMPEG_TIMEOUT_MS ?? 5 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
})();

/** Wall-clock timeout for the whisper.cpp transcription step (bounded input duration above, but
 * transcription itself can still be slow on CPU-only hosts). Default 30 minutes. */
const WHISPER_TIMEOUT_MS = (() => {
  const n = Number(process.env.VIDEO_INGEST_WHISPER_TIMEOUT_MS ?? 30 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
})();

/** Bound on the transcript text length (chars) — mirrors kbDocParser's KB_PARSE_MAX_CHARS /
 * kbWebFetcher's WEB_INGEST_MAX_CHARS bounding discipline. */
const MAX_TEXT_CHARS = (() => {
  const n = Number(process.env.VIDEO_INGEST_MAX_TEXT_CHARS ?? 2_000_000);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
})();

function getTempDir(): string {
  return path.join(process.cwd(), "uploads", "tmp", "video-ingest");
}

function boundText(raw: string): { text: string; truncated: boolean } {
  const normalized = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_TEXT_CHARS) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, MAX_TEXT_CHARS), truncated: true };
}

/** Extracts a short, allow-listed extension hint from a (possibly hostile) filename — used ONLY
 * as a cosmetic suffix on the GENERATED temp filename (never as, or part of, a path by itself).
 * Anything that isn't a trailing `.` + 1-8 ASCII alnum chars falls back to "bin". A filename
 * like `"; rm -rf /$(id).mp4"` safely yields "mp4"; one with no recognisable extension (or pure
 * shell-metacharacter noise) yields "bin" — either way nothing from the raw string reaches a
 * path or a command. */
export function sanitizeExtension(filename: string): string {
  const raw = String(filename ?? "");
  const match = raw.match(/\.([a-zA-Z0-9]{1,8})$/);
  const ext = match?.[1]?.toLowerCase();
  return ext && /^[a-z0-9]+$/.test(ext) ? ext : "bin";
}

// ─── STT config resolution ─────────────────────────────────────────────────────────────────

export interface SttConfig {
  whisperBin: string;
  modelPath: string;
  ffmpegBin: string;
}

/** Resolve WHISPER_BIN/WHISPER_MODEL/FFMPEG_BIN from env. Returns null if ANY is unset — do NOT
 * hardcode paths/binaries. Read fresh on every call (no caching), same discipline as
 * kbWebFetcher.isWebIngestEnabled. */
export function getSttConfig(): SttConfig | null {
  const whisperBin = process.env.WHISPER_BIN;
  const modelPath = process.env.WHISPER_MODEL;
  const ffmpegBin = process.env.FFMPEG_BIN;
  if (!whisperBin || !modelPath || !ffmpegBin) return null;
  return { whisperBin, modelPath, ffmpegBin };
}

/** True only when all three env vars are set. Does NOT probe the filesystem (existence is
 * verified naturally by the spawn attempt — see `runSidecar`'s ENOENT handling) — this is a
 * cheap "is this feature configured at all" check for status endpoints. */
export function isSttConfigured(): boolean {
  return getSttConfig() !== null;
}

// ─── Sidecar invocation (execFile + arg array — see module doc comment) ───────────────────

/**
 * Spawn `bin` with `args` (never shell-parsed — see the module doc comment's
 * SHELL-INJECTION SAFETY section) and wait for it to exit 0. Never hangs (execFile's native
 * `timeout` option kills the process after `timeoutMs` and the killed error is turned into a
 * clear {@link SttTranscribeError}). Never crashes the caller: every failure mode is a typed
 * error — a missing binary (ENOENT) becomes {@link SttUnavailableError}; a non-zero exit or a
 * timeout becomes {@link SttTranscribeError}.
 */
async function runSidecar(bin: string, args: string[], timeoutMs: number, label: string): Promise<void> {
  try {
    await execFileAsync(bin, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string | Buffer };
    if (e?.code === "ENOENT") {
      throw new SttUnavailableError(`${label} binary not found at "${bin}"`);
    }
    if (e?.killed) {
      throw new SttTranscribeError(`${label} timed out after ${timeoutMs}ms and was killed`, e);
    }
    const stderrTail = String(e?.stderr ?? e?.message ?? e ?? "").slice(-2000);
    throw new SttTranscribeError(`${label} failed (${String(e?.code ?? "unknown exit")}): ${stderrTail}`, e);
  }
}

// ─── transcribeVideo ────────────────────────────────────────────────────────────────────────

export interface TranscribeVideoInput {
  /** An already-on-disk video file path. Caller-owned — this module reads it but never deletes
   * it (only temp files THIS module creates — the wav + transcript, and an input file it wrote
   * itself from `buffer` — are cleaned up). */
  path?: string;
  /** Raw video bytes. Written to a GENERATED temp path (never the caller's filename) and
   * unlinked in `finally`. */
  buffer?: Buffer;
  /** Original filename — METADATA ONLY: used for the ingest sourceRef and (via
   * `sanitizeExtension`) an allow-listed extension hint. NEVER used to build a filesystem path
   * or a command argument beyond that sanitized hint. */
  filename: string;
}

export interface TranscribeVideoOptions {
  /** whisper.cpp `-l` language code, or "auto" for auto-detect (requires a multilingual model).
   * Defaults to "auto". */
  language?: string;
}

export interface TranscribeVideoResult {
  text: string;
  meta: {
    filename: string;
    durationCapSec: number;
    wavBytes: number;
    ffmpegDurationMs: number;
    whisperDurationMs: number;
    truncated: boolean;
  };
}

/**
 * ffmpeg (extract 16kHz mono wav, duration-capped) → whisper.cpp (transcribe wav → text).
 * See the module doc comment for the full shell-injection-safety + fail-safe + bounds
 * discipline. Always cleans up every temp file it created, on every exit path.
 */
export async function transcribeVideo(
  input: TranscribeVideoInput,
  opts: TranscribeVideoOptions = {},
): Promise<TranscribeVideoResult> {
  const cfg = getSttConfig();
  if (!cfg) {
    throw new SttUnavailableError();
  }
  if (!input.buffer && !input.path) {
    throw new SttValidationError("transcribeVideo: either buffer or path must be supplied");
  }

  const id = randomUUID();
  const ext = sanitizeExtension(input.filename);
  const tempDir = getTempDir();
  await fs.promises.mkdir(tempDir, { recursive: true });

  const ownedInputPath = input.buffer ? path.join(tempDir, `${id}-input.${ext}`) : null;
  const wavPath = path.join(tempDir, `${id}.wav`);
  const txtPrefix = path.join(tempDir, id);
  const txtPath = `${txtPrefix}.txt`;
  const cleanupPaths = [wavPath, txtPath, ...(ownedInputPath ? [ownedInputPath] : [])];

  try {
    let sourcePath: string;
    if (input.buffer) {
      if (input.buffer.length === 0) {
        throw new SttValidationError("Video buffer is empty");
      }
      if (input.buffer.length > MAX_BYTES) {
        throw new SttValidationError(
          `Video exceeds the ${MAX_BYTES}-byte cap (VIDEO_INGEST_MAX_BYTES): ${input.buffer.length} bytes`,
        );
      }
      await fs.promises.writeFile(ownedInputPath!, input.buffer);
      sourcePath = ownedInputPath!;
    } else {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(input.path!);
      } catch (err) {
        throw new SttValidationError(
          `Video file not found at "${input.path}": ${(err as Error)?.message ?? String(err)}`,
        );
      }
      if (stat.size === 0) {
        throw new SttValidationError(`Video file at "${input.path}" is empty`);
      }
      if (stat.size > MAX_BYTES) {
        throw new SttValidationError(
          `Video exceeds the ${MAX_BYTES}-byte cap (VIDEO_INGEST_MAX_BYTES): ${stat.size} bytes`,
        );
      }
      sourcePath = input.path!;
    }

    // ── 1) ffmpeg: extract 16kHz mono wav, duration-capped ────────────────────────────────
    const ffmpegStart = Date.now();
    const ffmpegArgs = [
      "-y",
      "-i", sourcePath,
      "-t", String(MAX_DURATION_SEC),
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "wav",
      wavPath,
    ];
    await runSidecar(cfg.ffmpegBin, ffmpegArgs, FFMPEG_TIMEOUT_MS, "ffmpeg");
    const ffmpegDurationMs = Date.now() - ffmpegStart;

    let wavStat: fs.Stats | null = null;
    try {
      wavStat = await fs.promises.stat(wavPath);
    } catch {
      wavStat = null;
    }
    if (!wavStat || wavStat.size === 0) {
      throw new SttTranscribeError("ffmpeg produced no audio output (missing or empty wav file)");
    }

    // ── 2) whisper.cpp: transcribe wav → txtPath ───────────────────────────────────────────
    const whisperStart = Date.now();
    const language = opts.language ?? "auto";
    const whisperArgs = [
      "-m", cfg.modelPath,
      "-f", wavPath,
      "-l", language,
      "-otxt",
      "-of", txtPrefix,
      "-nt",
    ];
    await runSidecar(cfg.whisperBin, whisperArgs, WHISPER_TIMEOUT_MS, "whisper.cpp");
    const whisperDurationMs = Date.now() - whisperStart;

    let rawText: string;
    try {
      rawText = await fs.promises.readFile(txtPath, "utf8");
    } catch (err) {
      throw new SttTranscribeError(
        `whisper.cpp produced no transcript file at "${txtPath}": ${(err as Error)?.message ?? String(err)}`,
        err,
      );
    }
    const { text, truncated } = boundText(rawText);
    if (!text) {
      throw new SttTranscribeError("whisper.cpp produced an empty transcript");
    }

    return {
      text,
      meta: {
        filename: input.filename,
        durationCapSec: MAX_DURATION_SEC,
        wavBytes: wavStat.size,
        ffmpegDurationMs,
        whisperDurationMs,
        truncated,
      },
    };
  } finally {
    await Promise.all(cleanupPaths.map((p) => fs.promises.unlink(p).catch(() => {})));
  }
}

// ─── ingestVideo — wires transcribeVideo into E3-1's ingestDocument pipeline ───────────────

export interface IngestVideoInput {
  corpus: string;
  video: TranscribeVideoInput;
  userId?: number;
  language?: string;
}

/**
 * Transcribe `input.video` locally (ffmpeg + whisper.cpp, fully offline) and hand the transcript
 * to E3-1's `ingestDocument` (chunk→embed→store — NOT reimplemented here). Gated behind
 * `VIDEO_INGEST_ENABLED` (default OFF) AND `KB_STUDIO_ENABLED` — checked here BEFORE any sidecar
 * work, and `ingestDocument` re-checks `KB_STUDIO_ENABLED` itself (defense-in-depth, same
 * pattern as kbWebFetcher.ingestUrl). `sourceType` is "video" — kbDocParser.parseDocument passes
 * the already-transcribed text straight through (see kbDocParser.ts's "video" case).
 */
export async function ingestVideo(input: IngestVideoInput): Promise<IngestDocumentResult> {
  if (!isVideoIngestEnabled() || !isKbStudioEnabled()) {
    throw new VideoIngestDisabledError();
  }

  const transcribed = await transcribeVideo(input.video, { language: input.language });
  return ingestDocument({
    corpus: input.corpus,
    sourceType: "video",
    sourceRef: input.video.filename,
    text: transcribed.text,
    userId: input.userId,
  });
}
