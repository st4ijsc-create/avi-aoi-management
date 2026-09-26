/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-4) — kbVideoTranscriber.ts unit tests.
 *
 * `node:child_process` (`execFile`) is FULLY MOCKED — no real ffmpeg/whisper.cpp binary is ever
 * spawned, mirroring kbWebFetcher.test.ts's "no real network call" discipline. `./kbIngestService`
 * (`ingestDocument`/`isKbStudioEnabled`) is mocked too — this file never touches a real DB/model.
 *
 * Covers: ffmpeg/whisper.cpp command construction (arg ARRAY, sanitized generated temp path —
 * never the raw filename, never a shell string), the SttUnavailableError/SttTranscribeError
 * fail-safe (unset config, ENOENT, non-zero exit, timeout) + temp-file cleanup on every path, a
 * shell-injection attempt via a malicious filename, and the VIDEO_INGEST_ENABLED/
 * KB_STUDIO_ENABLED-gated wiring from `ingestVideo` into `ingestDocument`. Router-level RBAC/2FA
 * for the `ingestVideo` mutation is covered in kbIngestRouter.test.ts (same split as E3-3's
 * kbWebFetcher.test.ts vs kbIngestRouter.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── mocks: node:child_process (execFile), ./kbIngestService ──────────────────────────────

type ExecFileCallback = (err: unknown, stdout?: string, stderr?: string) => void;

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const ingestDocumentMock = vi.fn();
const isKbStudioEnabledMock = vi.fn(() => true);
vi.mock("./kbIngestService", () => ({
  ingestDocument: (...args: unknown[]) => ingestDocumentMock(...args),
  isKbStudioEnabled: () => isKbStudioEnabledMock(),
}));

// ─── fixtures ───────────────────────────────────────────────────────────────────────────────

const FFMPEG_BIN = "/opt/st4i-stt/ffmpeg";
const WHISPER_BIN = "/opt/st4i-stt/whisper-cli";
const WHISPER_MODEL = "/opt/st4i-stt/models/ggml-base.bin";

const TEMP_DIR = path.join(process.cwd(), "uploads", "tmp", "video-ingest");

/** Parse a mocked execFile call's args into `{ bin, argv, callback }` regardless of whether
 * `options` was supplied (execFile's real signature overloads on arg count). */
function parseExecFileCall(call: unknown[]): { bin: string; argv: string[]; callback: ExecFileCallback } {
  const bin = call[0] as string;
  const argv = call[1] as string[];
  const callback = (call.length >= 4 ? call[3] : call[2]) as ExecFileCallback;
  return { bin, argv, callback };
}

/** Default execFile mock: simulates BOTH sidecars succeeding — writes a fake wav (for the
 * ffmpeg call, output path is the last argv element) and a fake transcript .txt (for the
 * whisper call, output prefix follows "-of"), matching the real CLIs' side effects closely
 * enough for transcribeVideo's own post-spawn `fs.stat`/`fs.readFile` steps to succeed. */
/** Simulate a sidecar succeeding with realistic side effects: ffmpeg writes the wav (path is
 * its last argv element), whisper writes the transcript .txt (path follows "-of"). Shared by
 * `mockExecSuccess` AND every "target one sidecar to fail" helper below, so that e.g. targeting
 * whisper for failure still lets the PRECEDING ffmpeg call genuinely produce a wav file — same
 * as it would with a real, working ffmpeg binary. */
function succeedWithSideEffects(bin: string, argv: string[], transcriptText: string) {
  if (bin === FFMPEG_BIN) {
    const wavPath = argv[argv.length - 1]!;
    fs.mkdirSync(path.dirname(wavPath), { recursive: true });
    fs.writeFileSync(wavPath, Buffer.from("RIFF....WAVEfmt fake"));
  } else if (bin === WHISPER_BIN) {
    const ofIndex = argv.indexOf("-of");
    const prefix = argv[ofIndex + 1]!;
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.txt`, transcriptText);
  }
}

function mockExecSuccess(transcriptText = "hello this is the local transcript") {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const { bin, argv, callback } = parseExecFileCall(args);
    succeedWithSideEffects(bin, argv, transcriptText);
    callback(null, "", "");
  });
}

/** Runs the FULL sidecar chain realistically, except `targetBin` fails with whatever `makeErr`
 * returns (ENOENT / non-zero-exit / timeout). Any OTHER sidecar in the chain still succeeds
 * with its normal side effects (e.g. targeting whisper still lets ffmpeg really write a wav). */
function mockExecFailureFor(targetBin: string, makeErr: (bin: string) => unknown) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const { bin, argv, callback } = parseExecFileCall(args);
    if (bin === targetBin) {
      callback(makeErr(bin));
      return;
    }
    succeedWithSideEffects(bin, argv, "hello this is the local transcript");
    callback(null, "", "");
  });
}

function mockExecEnoentFor(targetBin: string) {
  mockExecFailureFor(targetBin, (bin) => {
    const err: NodeJS.ErrnoException = new Error(`spawn ${bin} ENOENT`);
    err.code = "ENOENT";
    return err;
  });
}

function mockExecNonZeroExitFor(targetBin: string) {
  mockExecFailureFor(targetBin, (bin) => {
    const err: any = new Error(`Command failed: ${bin}`);
    err.code = 1;
    err.stderr = "fatal: could not process input";
    return err;
  });
}

function mockExecTimeoutFor(targetBin: string) {
  mockExecFailureFor(targetBin, () => {
    const err: any = new Error(`Command timed out`);
    err.killed = true;
    err.signal = "SIGTERM";
    return err;
  });
}

function tempDirEntries(): string[] {
  try {
    return fs.readdirSync(TEMP_DIR);
  } catch {
    return [];
  }
}

// ─── env plumbing ────────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "WHISPER_BIN",
  "WHISPER_MODEL",
  "FFMPEG_BIN",
  "VIDEO_INGEST_ENABLED",
  "KB_STUDIO_ENABLED",
  "VIDEO_INGEST_MAX_BYTES",
  "VIDEO_INGEST_MAX_DURATION_SEC",
  "VIDEO_INGEST_FFMPEG_TIMEOUT_MS",
  "VIDEO_INGEST_WHISPER_TIMEOUT_MS",
  "VIDEO_INGEST_MAX_TEXT_CHARS",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WHISPER_BIN = WHISPER_BIN;
  process.env.WHISPER_MODEL = WHISPER_MODEL;
  process.env.FFMPEG_BIN = FFMPEG_BIN;
  vi.clearAllMocks();
  isKbStudioEnabledMock.mockReturnValue(true);
  mockExecSuccess();
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

async function loadFresh() {
  vi.resetModules();
  return import("./kbVideoTranscriber");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// isVideoIngestEnabled / getSttConfig
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("isVideoIngestEnabled", () => {
  it("defaults to false when unset", async () => {
    delete process.env.VIDEO_INGEST_ENABLED;
    const mod = await loadFresh();
    expect(mod.isVideoIngestEnabled()).toBe(false);
  });

  it("true for 'true' and '1'", async () => {
    const mod = await loadFresh();
    process.env.VIDEO_INGEST_ENABLED = "true";
    expect(mod.isVideoIngestEnabled()).toBe(true);
    process.env.VIDEO_INGEST_ENABLED = "1";
    expect(mod.isVideoIngestEnabled()).toBe(true);
    process.env.VIDEO_INGEST_ENABLED = "false";
    expect(mod.isVideoIngestEnabled()).toBe(false);
  });
});

describe("getSttConfig / isSttConfigured", () => {
  it("returns null (and isSttConfigured false) when ANY of the three env vars is unset", async () => {
    const mod = await loadFresh();
    delete process.env.WHISPER_BIN;
    expect(mod.getSttConfig()).toBeNull();
    expect(mod.isSttConfigured()).toBe(false);

    process.env.WHISPER_BIN = WHISPER_BIN;
    delete process.env.WHISPER_MODEL;
    expect(mod.getSttConfig()).toBeNull();

    process.env.WHISPER_MODEL = WHISPER_MODEL;
    delete process.env.FFMPEG_BIN;
    expect(mod.getSttConfig()).toBeNull();
  });

  it("resolves all three from env when set — never hardcoded", async () => {
    const mod = await loadFresh();
    expect(mod.getSttConfig()).toEqual({
      whisperBin: WHISPER_BIN,
      modelPath: WHISPER_MODEL,
      ffmpegBin: FFMPEG_BIN,
    });
    expect(mod.isSttConfigured()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// sanitizeExtension
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("sanitizeExtension", () => {
  it("extracts a normal extension", async () => {
    const { sanitizeExtension } = await loadFresh();
    expect(sanitizeExtension("training-video.mp4")).toBe("mp4");
    expect(sanitizeExtension("clip.MOV")).toBe("mov");
  });

  it("falls back to 'bin' for no/invalid extension", async () => {
    const { sanitizeExtension } = await loadFresh();
    expect(sanitizeExtension("no-extension-at-all")).toBe("bin");
    expect(sanitizeExtension("")).toBe("bin");
    expect(sanitizeExtension("trailing.")).toBe("bin");
    expect(sanitizeExtension("way-too-long.abcdefghij")).toBe("bin");
  });

  it("a malicious filename yields ONLY a short safe extension, nothing else survives", async () => {
    const { sanitizeExtension } = await loadFresh();
    expect(sanitizeExtension("; rm -rf /$(id).mp4")).toBe("mp4");
    expect(sanitizeExtension("video; rm -rf /")).toBe("bin");
    expect(sanitizeExtension("`touch pwned`.mov")).toBe("mov");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// transcribeVideo — command construction (arg array, sanitized temp paths)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("transcribeVideo — command construction", () => {
  it("invokes ffmpeg with an ARG ARRAY: -i <input>, -t <duration cap>, 16kHz mono wav output", async () => {
    const mod = await loadFresh();
    await mod.transcribeVideo({ buffer: Buffer.from("fake mp4 bytes"), filename: "clip.mp4" });

    const ffmpegCall = execFileMock.mock.calls.find((c) => c[0] === FFMPEG_BIN);
    expect(ffmpegCall).toBeTruthy();
    const { argv } = parseExecFileCall(ffmpegCall!);
    expect(Array.isArray(argv)).toBe(true);
    expect(argv).toContain("-i");
    expect(argv).toContain("-t");
    expect(argv).toContain("3600"); // default VIDEO_INGEST_MAX_DURATION_SEC
    expect(argv).toContain("-ac");
    expect(argv).toContain("1");
    expect(argv).toContain("-ar");
    expect(argv).toContain("16000");
    expect(argv).toContain("-f");
    expect(argv).toContain("wav");
    // The wav output path is the module's own generated temp path, under the video-ingest temp dir.
    const wavPath = argv[argv.length - 1]!;
    expect(wavPath.startsWith(TEMP_DIR)).toBe(true);
    expect(wavPath.endsWith(".wav")).toBe(true);
  });

  it("invokes whisper.cpp with an ARG ARRAY: -m <model>, -f <wav path>, -otxt output", async () => {
    const mod = await loadFresh();
    await mod.transcribeVideo({ buffer: Buffer.from("fake mp4 bytes"), filename: "clip.mp4" });

    const whisperCall = execFileMock.mock.calls.find((c) => c[0] === WHISPER_BIN);
    expect(whisperCall).toBeTruthy();
    const { argv } = parseExecFileCall(whisperCall!);
    expect(Array.isArray(argv)).toBe(true);
    expect(argv).toEqual(
      expect.arrayContaining(["-m", WHISPER_MODEL, "-f", expect.stringContaining(TEMP_DIR), "-otxt"]),
    );
    const mIndex = argv.indexOf("-m");
    expect(argv[mIndex + 1]).toBe(WHISPER_MODEL);
  });

  it("respects a custom language option, defaults to 'auto'", async () => {
    const mod = await loadFresh();
    await mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" });
    let whisperCall = execFileMock.mock.calls.find((c) => c[0] === WHISPER_BIN)!;
    let { argv } = parseExecFileCall(whisperCall);
    expect(argv[argv.indexOf("-l") + 1]).toBe("auto");

    execFileMock.mockClear();
    mockExecSuccess();
    await mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" }, { language: "vi" });
    whisperCall = execFileMock.mock.calls.find((c) => c[0] === WHISPER_BIN)!;
    ({ argv } = parseExecFileCall(whisperCall));
    expect(argv[argv.indexOf("-l") + 1]).toBe("vi");
  });

  it("returns the transcript text and metadata on success", async () => {
    const mod = await loadFresh();
    mockExecSuccess("chào mừng đến với training studio");
    const result = await mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" });
    expect(result.text).toBe("chào mừng đến với training studio");
    expect(result.meta.filename).toBe("a.mp4");
    expect(result.meta.durationCapSec).toBe(3600);
    expect(result.meta.truncated).toBe(false);
  });

  it("uses an on-disk `path` input directly as the ffmpeg -i argv element (no copy needed)", async () => {
    const mod = await loadFresh();
    const srcPath = path.join(TEMP_DIR, "..", "caller-owned-source.mp4");
    fs.mkdirSync(path.dirname(srcPath), { recursive: true });
    fs.writeFileSync(srcPath, Buffer.from("real bytes"));
    try {
      await mod.transcribeVideo({ path: srcPath, filename: "caller-owned-source.mp4" });
      const ffmpegCall = execFileMock.mock.calls.find((c) => c[0] === FFMPEG_BIN)!;
      const { argv } = parseExecFileCall(ffmpegCall);
      expect(argv[argv.indexOf("-i") + 1]).toBe(srcPath);
      // Caller-owned path is NOT deleted by transcribeVideo.
      expect(fs.existsSync(srcPath)).toBe(true);
    } finally {
      fs.rmSync(srcPath, { force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Shell-injection safety
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("transcribeVideo — shell-injection safety", () => {
  it.each([
    "; rm -rf / #.mp4",
    "$(id).mov",
    "`touch pwned`.mp4",
    "video with spaces and 'quotes'.mp4",
    "unicode混沌видео.mp4",
    "no-extension-payload; rm -rf /",
  ])("a malicious filename %s never reaches a shell or a raw path", async (maliciousFilename) => {
    const mod = await loadFresh();
    await mod.transcribeVideo({ buffer: Buffer.from("bytes"), filename: maliciousFilename });

    // Every execFile call used an ARG ARRAY (never a pre-joined shell string).
    for (const call of execFileMock.mock.calls) {
      const { argv } = parseExecFileCall(call);
      expect(Array.isArray(argv)).toBe(true);
      for (const arg of argv) {
        // The raw malicious filename never appears verbatim in any argv element — only a
        // GENERATED (UUID) temp path with, at most, a short sanitized extension does.
        expect(String(arg)).not.toBe(maliciousFilename);
        expect(String(arg).includes("rm -rf")).toBe(false);
        expect(String(arg).includes("$(id)")).toBe(false);
        expect(String(arg).includes("`touch")).toBe(false);
      }
    }
    const ffmpegCall = execFileMock.mock.calls.find((c) => c[0] === FFMPEG_BIN)!;
    const { argv } = parseExecFileCall(ffmpegCall);
    const inputPath = argv[argv.indexOf("-i") + 1]!;
    // The written input path is under the temp dir and is a SINGLE, generated, safe path —
    // exactly one argv element, never shell-parsed.
    expect(inputPath.startsWith(TEMP_DIR)).toBe(true);
    expect(path.basename(inputPath)).toMatch(/^[0-9a-f-]{36}-input\.[a-z0-9]+$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Fail-safe: unset config / ENOENT / non-zero exit / timeout — never crash, never hang
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("transcribeVideo — fail-safe", () => {
  it("WHISPER_BIN unset ⇒ SttUnavailableError BEFORE any spawn", async () => {
    const mod = await loadFresh();
    delete process.env.WHISPER_BIN;
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttUnavailableError,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("FFMPEG_BIN unset ⇒ SttUnavailableError BEFORE any spawn", async () => {
    const mod = await loadFresh();
    delete process.env.FFMPEG_BIN;
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttUnavailableError,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("WHISPER_MODEL unset ⇒ SttUnavailableError with the exact fail-safe message", async () => {
    const mod = await loadFresh();
    delete process.env.WHISPER_MODEL;
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toThrow(
      "local STT not configured — set WHISPER_BIN/FFMPEG_BIN + WHISPER_MODEL",
    );
  });

  it("ffmpeg binary ENOENT ⇒ SttUnavailableError, temp files cleaned up", async () => {
    const mod = await loadFresh();
    mockExecEnoentFor(FFMPEG_BIN);
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttUnavailableError,
    );
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("whisper binary ENOENT ⇒ SttUnavailableError, temp files (incl. the extracted wav) cleaned up", async () => {
    const mod = await loadFresh();
    mockExecEnoentFor(WHISPER_BIN);
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttUnavailableError,
    );
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("ffmpeg non-zero exit ⇒ SttTranscribeError, temp files cleaned up", async () => {
    const mod = await loadFresh();
    mockExecNonZeroExitFor(FFMPEG_BIN);
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttTranscribeError,
    );
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("whisper non-zero exit ⇒ SttTranscribeError, temp files (incl. the extracted wav) cleaned up", async () => {
    const mod = await loadFresh();
    mockExecNonZeroExitFor(WHISPER_BIN);
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttTranscribeError,
    );
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("ffmpeg timeout ⇒ SttTranscribeError mentioning the timeout, never hangs, temp cleaned up", async () => {
    const mod = await loadFresh();
    mockExecTimeoutFor(FFMPEG_BIN);
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toThrow(/timed out/i);
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("whisper timeout ⇒ SttTranscribeError mentioning the timeout, never hangs, temp cleaned up", async () => {
    const mod = await loadFresh();
    mockExecTimeoutFor(WHISPER_BIN);
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toThrow(/timed out/i);
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("no buffer/path supplied ⇒ SttValidationError, no spawn attempted", async () => {
    const mod = await loadFresh();
    await expect(mod.transcribeVideo({ filename: "a.mp4" } as any)).rejects.toBeInstanceOf(mod.SttValidationError);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("empty buffer ⇒ SttValidationError, no spawn attempted", async () => {
    const mod = await loadFresh();
    await expect(
      mod.transcribeVideo({ buffer: Buffer.alloc(0), filename: "a.mp4" }),
    ).rejects.toBeInstanceOf(mod.SttValidationError);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("oversized buffer (over VIDEO_INGEST_MAX_BYTES) ⇒ SttValidationError, no spawn attempted", async () => {
    process.env.VIDEO_INGEST_MAX_BYTES = "1000";
    const mod = await loadFresh();
    await expect(
      mod.transcribeVideo({ buffer: Buffer.alloc(2000), filename: "a.mp4" }),
    ).rejects.toBeInstanceOf(mod.SttValidationError);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("ffmpeg produces no/empty wav output ⇒ SttTranscribeError, temp cleaned up", async () => {
    const mod = await loadFresh();
    // Simulate ffmpeg "succeeding" (exit 0) without ever writing a wav file — a real-world edge
    // case (e.g. a video with no audio stream).
    execFileMock.mockImplementation((...args: unknown[]) => {
      const { callback } = parseExecFileCall(args);
      callback(null, "", "");
    });
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttTranscribeError,
    );
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("whisper produces no transcript file ⇒ SttTranscribeError, temp cleaned up", async () => {
    const mod = await loadFresh();
    execFileMock.mockImplementation((...args: unknown[]) => {
      const { bin, argv, callback } = parseExecFileCall(args);
      if (bin === FFMPEG_BIN) {
        const wavPath = argv[argv.length - 1]!;
        fs.mkdirSync(path.dirname(wavPath), { recursive: true });
        fs.writeFileSync(wavPath, Buffer.from("RIFF"));
      }
      // whisper "succeeds" but never writes the .txt file.
      callback(null, "", "");
    });
    await expect(mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" })).rejects.toBeInstanceOf(
      mod.SttTranscribeError,
    );
    expect(tempDirEntries()).toHaveLength(0);
  });

  it("temp files are ALSO cleaned up on the happy path (nothing left behind)", async () => {
    const mod = await loadFresh();
    await mod.transcribeVideo({ buffer: Buffer.from("x"), filename: "a.mp4" });
    expect(tempDirEntries()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ingestVideo — gating + wiring to ingestDocument
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("ingestVideo — VIDEO_INGEST_ENABLED / KB_STUDIO_ENABLED gate", () => {
  it("VIDEO_INGEST_ENABLED off ⇒ VideoIngestDisabledError, no transcription/ingest attempted", async () => {
    const mod = await loadFresh();
    delete process.env.VIDEO_INGEST_ENABLED; // default OFF
    await expect(
      mod.ingestVideo({ corpus: "c1", video: { buffer: Buffer.from("x"), filename: "a.mp4" } }),
    ).rejects.toBeInstanceOf(mod.VideoIngestDisabledError);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("KB_STUDIO_ENABLED off ⇒ VideoIngestDisabledError, no transcription/ingest attempted", async () => {
    const mod = await loadFresh();
    process.env.VIDEO_INGEST_ENABLED = "true";
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(
      mod.ingestVideo({ corpus: "c1", video: { buffer: Buffer.from("x"), filename: "a.mp4" } }),
    ).rejects.toBeInstanceOf(mod.VideoIngestDisabledError);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });
});

describe("ingestVideo — wires the transcript into ingestDocument", () => {
  beforeEach(() => {
    process.env.VIDEO_INGEST_ENABLED = "true";
  });

  it("feeds ingestDocument with sourceType:'video', the transcript text, and corpus/sourceRef/userId", async () => {
    const mod = await loadFresh();
    mockExecSuccess("this is the transcribed lecture content");
    ingestDocumentMock.mockResolvedValue({
      corpus: "vendor-x-training",
      sourceRef: "onboarding.mp4",
      chunksAdded: 4,
      parsedMeta: { sourceType: "video", charCount: 40, truncated: false },
    });

    const result = await mod.ingestVideo({
      corpus: "vendor-x-training",
      video: { buffer: Buffer.from("bytes"), filename: "onboarding.mp4" },
      userId: 7,
    });

    expect(result.chunksAdded).toBe(4);
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
    expect(ingestDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        corpus: "vendor-x-training",
        sourceType: "video",
        sourceRef: "onboarding.mp4",
        text: "this is the transcribed lecture content",
        userId: 7,
      }),
    );
  });

  it("a transcription failure (SttTranscribeError) propagates WITHOUT calling ingestDocument", async () => {
    const mod = await loadFresh();
    mockExecNonZeroExitFor(WHISPER_BIN);
    await expect(
      mod.ingestVideo({ corpus: "c1", video: { buffer: Buffer.from("x"), filename: "a.mp4" } }),
    ).rejects.toBeInstanceOf(mod.SttTranscribeError);
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });
});
