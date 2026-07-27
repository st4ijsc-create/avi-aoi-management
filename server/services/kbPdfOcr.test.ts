/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-5) — kbPdfOcr.ts unit tests.
 *
 * `node:child_process` (`execFile`, the pdftoppm sidecar) AND `./ai/ocrService` (the EXISTING
 * OCR engine — `isOcrEngineEnabled`/`ocrModelsAvailable`/`runOcr`) are BOTH FULLY MOCKED. No
 * real pdftoppm binary is ever spawned and no real ONNX inference ever runs.
 *
 * Covers: the double-gate (`KB_OCR_ENABLED` AND ocrService's `OCR_ENGINE_ENABLED`) +
 * `PDFTOPPM_BIN` + model-availability availability check; the honest fail-safe (disabled /
 * models unavailable / PDFTOPPM_BIN absent / ENOENT / a page render or OCR failure — never
 * crash, never fabricate); shell-injection safety (execFile + arg array + generated temp
 * paths, a malicious PDF's bytes never reach argv); bounds (KB_OCR_MAX_PAGES, total timeout);
 * and temp-file cleanup on every exit path. The kbDocParser wiring (density detection, meta
 * flags) is covered separately in kbDocParser.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── mocks: node:child_process (execFile), ./ai/ocrService ────────────────────────────────

type ExecFileCallback = (err: unknown, stdout?: string, stderr?: string) => void;

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const isOcrEngineEnabledMock = vi.fn(() => true);
const ocrModelsAvailableMock = vi.fn(() => true);
const runOcrMock = vi.fn();
vi.mock("./ai/ocrService", () => ({
  isOcrEngineEnabled: () => isOcrEngineEnabledMock(),
  ocrModelsAvailable: () => ocrModelsAvailableMock(),
  runOcr: (...args: unknown[]) => runOcrMock(...args),
}));

// ─── fixtures ───────────────────────────────────────────────────────────────────────────────

const PDFTOPPM_BIN = "/opt/st4i-ocr/pdftoppm";
const TEMP_DIR = path.join(process.cwd(), "uploads", "tmp", "kb-ocr");

function parseExecFileCall(call: unknown[]): { bin: string; argv: string[]; callback: ExecFileCallback } {
  const bin = call[0] as string;
  const argv = call[1] as string[];
  const callback = (call.length >= 4 ? call[3] : call[2]) as ExecFileCallback;
  return { bin, argv, callback };
}

/** Simulates pdftoppm succeeding: writes a fake PNG at `${outPrefix}.png` (the last argv
 * element is the output prefix — see runPdftoppm's arg order). */
function succeedWithPng(argv: string[]) {
  const outPrefix = argv[argv.length - 1]!;
  const pngPath = `${outPrefix}.png`;
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, Buffer.from("fake-png-bytes"));
}

function mockExecSuccess() {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const { argv, callback } = parseExecFileCall(args);
    succeedWithPng(argv);
    callback(null, "", "");
  });
}

/** Every pdftoppm call fails the same way (used for ENOENT/non-zero/timeout scenarios that
 * should apply uniformly, e.g. "the binary genuinely doesn't exist"). */
function mockExecFailure(makeErr: () => unknown) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const { callback } = parseExecFileCall(args);
    callback(makeErr());
  });
}

function mockExecEnoent() {
  mockExecFailure(() => {
    const err: NodeJS.ErrnoException = new Error(`spawn ${PDFTOPPM_BIN} ENOENT`);
    err.code = "ENOENT";
    return err;
  });
}

/** Only the FIRST call fails (non-zero exit); every subsequent call succeeds — used to prove a
 * single page's render failure doesn't abort the rest of the document (best-effort). */
function mockExecFailFirstCallOnly() {
  let first = true;
  execFileMock.mockImplementation((...args: unknown[]) => {
    const { argv, callback } = parseExecFileCall(args);
    if (first) {
      first = false;
      const err: any = new Error("Command failed");
      err.code = 1;
      err.stderr = "fatal: corrupt page";
      callback(err);
      return;
    }
    succeedWithPng(argv);
    callback(null, "", "");
  });
}

/** Delays the callback by `ms` real milliseconds — used for the total-timeout test so
 * Date.now() genuinely advances between the loop's per-page timeout checks. */
function mockExecSuccessWithDelay(ms: number) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const { argv, callback } = parseExecFileCall(args);
    setTimeout(() => {
      succeedWithPng(argv);
      callback(null, "", "");
    }, ms);
  });
}

function mockOcrSuccess(text = "recognized page text") {
  runOcrMock.mockResolvedValue({
    ok: true,
    engine: "onnx",
    text,
    lines: [{ text, score: 0.91 }],
    confidence: 0.91,
    degraded: false,
  });
}

// ─── env plumbing ────────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "PDFTOPPM_BIN",
  "KB_OCR_ENABLED",
  "KB_OCR_MAX_PAGES",
  "KB_OCR_RENDER_DPI",
  "KB_OCR_RENDER_TIMEOUT_MS",
  "KB_OCR_PAGE_TIMEOUT_MS",
  "KB_OCR_TOTAL_TIMEOUT_MS",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.PDFTOPPM_BIN = PDFTOPPM_BIN;
  process.env.KB_OCR_ENABLED = "true";
  vi.clearAllMocks();
  isOcrEngineEnabledMock.mockReturnValue(true);
  ocrModelsAvailableMock.mockReturnValue(true);
  mockExecSuccess();
  mockOcrSuccess();
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
  return import("./kbPdfOcr");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// isKbOcrEnabled / isKbPdfOcrAvailable — the double-gate
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("isKbOcrEnabled", () => {
  it("defaults to false when unset", async () => {
    delete process.env.KB_OCR_ENABLED;
    const mod = await loadFresh();
    expect(mod.isKbOcrEnabled()).toBe(false);
  });

  it("true for 'true' and '1'", async () => {
    const mod = await loadFresh();
    process.env.KB_OCR_ENABLED = "true";
    expect(mod.isKbOcrEnabled()).toBe(true);
    process.env.KB_OCR_ENABLED = "1";
    expect(mod.isKbOcrEnabled()).toBe(true);
    process.env.KB_OCR_ENABLED = "false";
    expect(mod.isKbOcrEnabled()).toBe(false);
  });
});

describe("isKbPdfOcrAvailable — requires KB_OCR_ENABLED AND OCR_ENGINE_ENABLED AND models AND PDFTOPPM_BIN", () => {
  it("true when every precondition is met", async () => {
    const mod = await loadFresh();
    expect(await mod.isKbPdfOcrAvailable()).toBe(true);
  });

  it("false when KB_OCR_ENABLED is off (default) even though ocrService's own gate is on", async () => {
    delete process.env.KB_OCR_ENABLED;
    const mod = await loadFresh();
    expect(await mod.isKbPdfOcrAvailable()).toBe(false);
    // Short-circuits before ever importing ocrService's gate checks.
    expect(isOcrEngineEnabledMock).not.toHaveBeenCalled();
  });

  it("false when ocrService's OCR_ENGINE_ENABLED (master flag) is off, even with KB_OCR_ENABLED on", async () => {
    isOcrEngineEnabledMock.mockReturnValue(false);
    const mod = await loadFresh();
    expect(await mod.isKbPdfOcrAvailable()).toBe(false);
  });

  it("false when ONNX models are unavailable on disk", async () => {
    ocrModelsAvailableMock.mockReturnValue(false);
    const mod = await loadFresh();
    expect(await mod.isKbPdfOcrAvailable()).toBe(false);
  });

  it("false when PDFTOPPM_BIN is unset, even with both OCR gates on", async () => {
    delete process.env.PDFTOPPM_BIN;
    const mod = await loadFresh();
    expect(await mod.isKbPdfOcrAvailable()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ocrScannedPdf — honest fail-safe (never throws, never fabricates)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("ocrScannedPdf — fail-safe", () => {
  it("KB_OCR_ENABLED off (default) → empty/ocrUsed:false, no sidecar spawned, no crash", async () => {
    delete process.env.KB_OCR_ENABLED;
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    expect(result).toEqual({ text: "", ocrUsed: false, pagesAttempted: 0, pagesProcessed: 0, pagesFailed: 0 });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(runOcrMock).not.toHaveBeenCalled();
  });

  it("OCR_ENGINE_ENABLED (ocrService master) off → empty/ocrUsed:false, no crash", async () => {
    isOcrEngineEnabledMock.mockReturnValue(false);
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    expect(result.ocrUsed).toBe(false);
    expect(result.text).toBe("");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("ONNX models unavailable → empty/ocrUsed:false, no crash", async () => {
    ocrModelsAvailableMock.mockReturnValue(false);
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    expect(result.ocrUsed).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("PDFTOPPM_BIN unset → empty/ocrUsed:false, no sidecar spawned, no crash", async () => {
    delete process.env.PDFTOPPM_BIN;
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    expect(result.ocrUsed).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("PDFTOPPM_BIN set but the binary doesn't exist (ENOENT) → empty/ocrUsed:false, stops after first attempt, no crash", async () => {
    mockExecEnoent();
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 5);
    expect(result.ocrUsed).toBe(false);
    expect(result.text).toBe("");
    expect(result.pagesAttempted).toBe(1); // stops immediately — every page would ENOENT the same way
    expect(result.pagesFailed).toBe(1);
    expect(runOcrMock).not.toHaveBeenCalled();
  });

  it("a single page's render failure (non-zero exit) is best-effort — the rest of the document still processes", async () => {
    mockExecFailFirstCallOnly();
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    expect(result.pagesAttempted).toBe(2);
    expect(result.pagesFailed).toBe(1);
    expect(result.pagesProcessed).toBe(1);
    expect(result.ocrUsed).toBe(true); // page 2 succeeded, so SOME real OCR text is returned
  });

  it("runOcr throwing on a page is caught, best-effort continues, no crash, no fabrication", async () => {
    runOcrMock.mockReset();
    runOcrMock.mockRejectedValueOnce(new Error("onnxruntime session crashed"));
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 1);
    expect(result.ocrUsed).toBe(false);
    expect(result.text).toBe("");
    expect(result.pagesFailed).toBe(1);
  });

  it("runOcr resolving degraded (ok:false) is treated as a failed page, not fabricated text", async () => {
    runOcrMock.mockReset();
    runOcrMock.mockResolvedValue({
      ok: false,
      engine: "none",
      text: "",
      lines: [],
      confidence: 0,
      degraded: true,
      reason: "OCR_MODEL_NOT_AVAILABLE",
    });
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 1);
    expect(result.ocrUsed).toBe(false);
    expect(result.text).toBe("");
    expect(result.pagesFailed).toBe(1);
  });

  it("all pages failing still returns a clean result (never throws)", async () => {
    mockExecEnoent();
    const mod = await loadFresh();
    await expect(mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 3)).resolves.toMatchObject({ ocrUsed: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ocrScannedPdf — success path
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("ocrScannedPdf — success path", () => {
  it("renders + OCRs every page and concatenates the recognized text", async () => {
    let call = 0;
    runOcrMock.mockImplementation(async () => {
      call += 1;
      return {
        ok: true,
        engine: "onnx",
        text: `page ${call} text`,
        lines: [{ text: `page ${call} text`, score: 0.9 }],
        confidence: 0.9,
        degraded: false,
      };
    });
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    expect(result.ocrUsed).toBe(true);
    expect(result.pagesProcessed).toBe(2);
    expect(result.pagesFailed).toBe(0);
    expect(result.text).toBe("page 1 text\n\npage 2 text");
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(runOcrMock).toHaveBeenCalledTimes(2);
  });

  it("passes the requested language through to ocrService.runOcr", async () => {
    const mod = await loadFresh();
    await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 1, { language: "vi" });
    expect(runOcrMock).toHaveBeenCalledWith(expect.any(Buffer), { language: "vi" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Bounds — KB_OCR_MAX_PAGES + total timeout
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("bounds", () => {
  it("KB_OCR_MAX_PAGES caps how many pages are ever rendered, regardless of the page-count hint", async () => {
    process.env.KB_OCR_MAX_PAGES = "3";
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 100);
    expect(result.pagesAttempted).toBe(3);
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });

  it("KB_OCR_TOTAL_TIMEOUT_MS bounds the whole routine — stops before exhausting all requested pages", async () => {
    process.env.KB_OCR_TOTAL_TIMEOUT_MS = "0";
    mockExecSuccessWithDelay(5); // real delay so Date.now() genuinely advances between pages
    const mod = await loadFresh();
    const result = await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 5);
    // Exactly the page already "in flight" when the deadline (0ms) is first checked gets
    // processed; the loop then observes elapsed>0 and stops rather than attempting the rest.
    expect(result.pagesAttempted).toBe(1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Temp-file cleanup
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("temp-file cleanup", () => {
  it("cleans up the written PDF copy and every rendered page PNG on success", async () => {
    const mod = await loadFresh();
    await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    const entries = fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR) : [];
    expect(entries).toEqual([]);
  });

  it("cleans up even when pdftoppm fails immediately (ENOENT)", async () => {
    mockExecEnoent();
    const mod = await loadFresh();
    await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 2);
    const entries = fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR) : [];
    expect(entries).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Shell-injection safety
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("shell-injection safety", () => {
  it("execFile is called with an argument ARRAY (never a shell string) and no shell:true option", async () => {
    const mod = await loadFresh();
    await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const call = execFileMock.mock.calls[0]!;
    expect(call[0]).toBe(PDFTOPPM_BIN);
    expect(Array.isArray(call[1])).toBe(true);
    // Every element of the args array is a primitive string — never an object/shell string.
    for (const el of call[1] as unknown[]) expect(typeof el).toBe("string");
    // If an options object was passed (3-arg or 4-arg overload), it must never set shell:true.
    const maybeOptions = call.length >= 4 ? call[2] : undefined;
    if (maybeOptions && typeof maybeOptions === "object") {
      expect((maybeOptions as Record<string, unknown>).shell).toBeFalsy();
    }
  });

  it("a malicious PDF's byte content never appears in any pdftoppm argv element", async () => {
    const malicious = Buffer.from("%PDF-1.4\n; rm -rf / #\n$(id)\n`touch pwned`\nunicode-🔥-payload");
    const mod = await loadFresh();
    await mod.ocrScannedPdf(malicious, 1);
    const call = execFileMock.mock.calls[0]!;
    const argv = call[1] as string[];
    for (const el of argv) {
      expect(el).not.toContain("rm -rf");
      expect(el).not.toContain("$(id)");
      expect(el).not.toContain("touch pwned");
      expect(el).not.toContain("🔥");
    }
  });

  it("the PDF is written to, and rendered from, a crypto.randomUUID()-generated temp path — never a caller-supplied name", async () => {
    const mod = await loadFresh();
    await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 1);
    const call = execFileMock.mock.calls[0]!;
    const argv = call[1] as string[];
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const pdfPathArg = argv[argv.length - 2]!; // second-to-last: the input pdf path
    const outPrefixArg = argv[argv.length - 1]!; // last: the output prefix
    expect(pdfPathArg).toMatch(uuidRe);
    expect(pdfPathArg.startsWith(TEMP_DIR)).toBe(true);
    expect(outPrefixArg).toMatch(uuidRe);
    expect(outPrefixArg.startsWith(TEMP_DIR)).toBe(true);
  });

  it("every argv element is either a fixed flag, a bounded number, or a generated temp path — nothing else", async () => {
    const mod = await loadFresh();
    await mod.ocrScannedPdf(Buffer.from("%PDF-1.4 fake"), 1);
    const call = execFileMock.mock.calls[0]!;
    const argv = call[1] as string[];
    const fixedFlags = new Set(["-png", "-r", "-f", "-l", "-singlefile"]);
    const uuidRe = /^[0-9a-f-]{36}/i;
    for (const el of argv) {
      const isFixedFlag = fixedFlags.has(el);
      const isNumber = /^\d+$/.test(el);
      const isGeneratedPath = el.startsWith(TEMP_DIR) && uuidRe.test(path.basename(el));
      expect(isFixedFlag || isNumber || isGeneratedPath).toBe(true);
    }
  });
});
