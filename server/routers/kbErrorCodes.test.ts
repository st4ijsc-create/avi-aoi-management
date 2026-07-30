/**
 * Sprint 5 §4 (Task 3, A4) — câu từ chối nạp tài liệu phải mang MÃ để client dịch.
 * Trước đây: `Document exceeds 20971520 bytes` (byte thô, không phải "20 MB"),
 * `Unsupported document type: "pptx"`, `Failed to fetch ...` — toàn tiếng Anh,
 * trong khi kbImageDescriber cùng luồng lại tiếng Việt (một màn hình hai thứ tiếng).
 *
 * Hai phần:
 *  A. Đơn vị — 6 hàm dựng lỗi trong kbErrors.ts trả đúng `appCode`/`appParams`.
 *  B. Tích hợp — gọi THẬT `kbIngestRouter`/`kbStudioRouter` (service bị mock), xác nhận
 *     `appCode` đi được từ router ra tới `TRPCError.cause` (không chỉ đúng ở tầng hàm dựng lỗi
 *     — đây là bài học "kiểm hợp đồng API trước khi viết giao diện" ở §6 spec: điều đã từng
 *     chết lặng lẽ đúng ở chỗ nối này trong A3/A4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readAppErrorMeta } from "../_core/appError";
import {
  buildTooLargeError,
  buildUnsupportedTypeError,
  buildContentTypeMismatchError,
  buildParseFailedError,
  buildNoTextError,
  buildFetchFailedError,
} from "./kbErrors";
import { parseDocument, KbContentTypeMismatchError } from "../services/kbDocParser";

// ─── A. Đơn vị — kbErrors.ts ──────────────────────────────────────────────────

describe("mã lỗi luồng nạp tri thức — hàm dựng lỗi (kbErrors.ts)", () => {
  it("quá dung lượng ⇒ KB_FILE_TOO_LARGE kèm giới hạn tính bằng MB, không phải byte thô", () => {
    const err = buildTooLargeError(20 * 1024 * 1024);
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_FILE_TOO_LARGE");
    expect(meta?.appParams).toEqual({ limitMb: 20 });
    // fallbackMessage giữ nguyên văn câu cũ — log máy chủ/API /v1 không gãy.
    expect(err.message).toBe("Document exceeds 20971520 bytes");
  });

  it("loại tệp không hỗ trợ ⇒ KB_UNSUPPORTED_TYPE kèm đuôi và danh sách hỗ trợ", () => {
    const err = buildUnsupportedTypeError("pptx", "pdf, docx, md, txt");
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_UNSUPPORTED_TYPE");
    expect(meta?.appParams).toMatchObject({ ext: "pptx" });
  });

  it("nội dung không khớp phần mở rộng khai báo ⇒ KB_CONTENT_TYPE_MISMATCH kèm claimed/detected", () => {
    const err = buildContentTypeMismatchError("md", "a PNG image");
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_CONTENT_TYPE_MISMATCH");
    expect(meta?.appParams).toEqual({ claimed: "md", detected: "a PNG image" });
  });

  it("phân tích thất bại ⇒ KB_PARSE_FAILED KHÔNG kèm reason trong appParams (I-1a) nhưng vẫn giữ trong fallbackMessage", () => {
    const err = buildParseFailedError("corrupt pdf");
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_PARSE_FAILED");
    // reason là lỗi VỀ CHÍNH TỆP (không có gì hạ tầng để rò) nhưng nguyên văn tiếng Anh — bỏ
    // khỏi appParams để không nội suy ra câu i18n (nếu không, người vận hành vẫn đọc câu Anh).
    expect(meta?.appParams).toBeUndefined();
    // fallbackMessage (log máy chủ/API /v1) vẫn giữ nguyên văn reason — chẩn đoán không mất.
    expect(err.message).toBe("Failed to parse document: corrupt pdf");
  });

  it("không còn chữ nào để nạp ⇒ KB_NO_TEXT_EXTRACTED kèm nguồn", () => {
    const err = buildNoTextError("manual.pdf");
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_NO_TEXT_EXTRACTED");
    expect(meta?.appParams).toEqual({ source: "manual.pdf" });
  });

  describe("tải URL thất bại — KB_FETCH_FAILED (I-1b: reason có thể chứa IP/hostname nội bộ)", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("appParams CHỈ có url, KHÔNG có reason — reason không ra client bằng bất kỳ đường nào", () => {
      const err = buildFetchFailedError(
        "https://example.com/page",
        "Host resolves to a blocked/internal address (169.254.169.254)",
      );
      const meta = readAppErrorMeta(err);
      expect(meta?.appCode).toBe("KB_FETCH_FAILED");
      expect(meta?.appParams).toEqual({ url: "https://example.com/page" });
    });

    it("fallbackMessage (chính là TRPCError.message, ĐI THẲNG tới client) KHÔNG chứa reason gốc", () => {
      const err = buildFetchFailedError(
        "https://example.com/page",
        "Host resolves to a blocked/internal address (169.254.169.254)",
      );
      expect(err.message).toBe("Failed to fetch https://example.com/page");
      expect(err.message).not.toContain("169.254.169.254");
      expect(err.message).not.toContain("blocked/internal address");
    });

    it("reason gốc vẫn được console.error ở máy chủ — không mất chẩn đoán", () => {
      buildFetchFailedError("https://example.com/page", "Host resolves to a blocked/internal address (169.254.169.254)");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain("169.254.169.254");
    });
  });

  it("mọi mã KB đều dùng trpcCode BAD_REQUEST trừ KB_FILE_TOO_LARGE (PAYLOAD_TOO_LARGE) — không mã tRPC nào bị đổi", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(buildTooLargeError(1024).code).toBe("PAYLOAD_TOO_LARGE");
    expect(buildUnsupportedTypeError("zip", "pdf").code).toBe("BAD_REQUEST");
    expect(buildContentTypeMismatchError("md", "png").code).toBe("BAD_REQUEST");
    expect(buildParseFailedError("x").code).toBe("BAD_REQUEST");
    expect(buildNoTextError("x").code).toBe("BAD_REQUEST");
    expect(buildFetchFailedError("u", "r").code).toBe("BAD_REQUEST");
    consoleErrorSpy.mockRestore();
  });
});

// ─── A2. Đơn vị — KbContentTypeMismatchError (I-2, kbDocParser.ts) ────────────

describe("KbContentTypeMismatchError — kbDocParser.ts ném lớp con có cấu trúc thay vì KbParseError chung (I-2)", () => {
  it("tệp .txt chứa byte PNG ⇒ KbContentTypeMismatchError (con của KbParseError) với claimed/detected đúng", async () => {
    const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const call = parseDocument(PNG_BYTES, "notes.txt");
    await expect(call).rejects.toThrow(KbContentTypeMismatchError);
    const err = await call.catch((e) => e as KbContentTypeMismatchError);
    expect(err.claimed).toBe("TXT");
    expect(err.detected).toBe("a PNG image");
    // Message tiếng Anh gốc PHẢI còn nguyên văn — kbDocParser.test.ts (không được sửa) assert
    // /PNG image/ trên đúng câu này.
    expect(err.message).toMatch(/PNG image/);
  });

  it("ảnh khai PNG nhưng bytes không khớp bất kỳ định dạng ảnh nào đã biết ⇒ detected là câu honest, không bịa", async () => {
    const call = parseDocument(Buffer.from("not really a png"), "diagram.png");
    await expect(call).rejects.toThrow(KbContentTypeMismatchError);
    const err = await call.catch((e) => e as KbContentTypeMismatchError);
    expect(err.claimed).toBe("PNG");
    expect(err.detected).toBe("content that does not match any recognised image format");
  });

  it("ảnh khai PNG nhưng bytes thực tế là JPEG ⇒ detected nêu đúng định dạng thật", async () => {
    const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const call = parseDocument(JPEG_BYTES, "diagram.png");
    await expect(call).rejects.toThrow(KbContentTypeMismatchError);
    const err = await call.catch((e) => e as KbContentTypeMismatchError);
    expect(err.claimed).toBe("PNG");
    expect(err.detected).toBe("a JPEG image");
  });
});

// ─── B. Tích hợp — kbIngestRouter ─────────────────────────────────────────────

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

const ingestDocumentMock = vi.fn();
const isKbStudioEnabledMock = vi.fn(() => true);
vi.mock("../services/kbIngestService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kbIngestService")>();
  return {
    ...actual,
    ingestDocument: (...args: unknown[]) => ingestDocumentMock(...args),
    isKbStudioEnabled: () => isKbStudioEnabledMock(),
  };
});

const ingestUrlMock = vi.fn();
const isWebIngestEnabledMock = vi.fn(() => true);
vi.mock("../services/kbWebFetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kbWebFetcher")>();
  return {
    ...actual,
    ingestUrl: (...args: unknown[]) => ingestUrlMock(...args),
    isWebIngestEnabled: () => isWebIngestEnabledMock(),
  };
});

const ingestVideoMock = vi.fn();
const isVideoIngestEnabledMock = vi.fn(() => true);
vi.mock("../services/kbVideoTranscriber", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kbVideoTranscriber")>();
  return {
    ...actual,
    ingestVideo: (...args: unknown[]) => ingestVideoMock(...args),
    isVideoIngestEnabled: () => isVideoIngestEnabledMock(),
  };
});

import { kbIngestRouter } from "./kbIngestRouter";
import { KbIngestValidationError } from "../services/kbIngestService";
import { KbUnsupportedTypeError, KbParseError, KbContentTypeMismatchError } from "../services/kbDocParser";
import { WebIngestDisabledError, SsrfBlockedError } from "../services/kbWebFetcher";

function ingestCallerFor(role: string) {
  return kbIngestRouter.createCaller({ user: { id: 1, role, name: "Tester", twoFactorEnabled: true } } as any);
}

const SMALL_PDF_B64 = Buffer.from("%PDF-1.4 minimal fake content").toString("base64");
const validUpload = {
  corpus: "vendor-x-manuals",
  sourceRef: "manual.pdf",
  mimeOrExt: "application/pdf",
  base64: SMALL_PDF_B64,
};

describe("kbIngestRouter — appCode thật sự tới được TRPCError.cause (không chỉ đúng ở kbErrors.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isKbStudioEnabledMock.mockReturnValue(true);
    isWebIngestEnabledMock.mockReturnValue(true);
    isVideoIngestEnabledMock.mockReturnValue(true);
    ingestDocumentMock.mockResolvedValue({
      corpus: "vendor-x-manuals",
      sourceRef: "manual.pdf",
      chunksAdded: 3,
      parsedMeta: { sourceType: "pdf", charCount: 100, truncated: false },
    });
    ingestUrlMock.mockResolvedValue({
      corpus: "vendor-x-manuals",
      sourceRef: "https://example.com/page",
      chunksAdded: 2,
      parsedMeta: { sourceType: "url", charCount: 50, truncated: false },
    });
  });

  it("mimeOrExt không hỗ trợ (trước khi giải mã) ⇒ KB_UNSUPPORTED_TYPE, code tRPC vẫn BAD_REQUEST", async () => {
    const err = await ingestCallerFor("admin")
      .uploadDocument({ ...validUpload, mimeOrExt: "pptx" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_UNSUPPORTED_TYPE");
    expect(meta?.appParams).toMatchObject({ ext: "pptx" });
  });

  it("payload giải mã vượt giới hạn ⇒ KB_FILE_TOO_LARGE kèm limitMb đúng giới hạn cấu hình, code tRPC vẫn PAYLOAD_TOO_LARGE", async () => {
    const original = process.env.KB_INGEST_MAX_UPLOAD_BYTES;
    process.env.KB_INGEST_MAX_UPLOAD_BYTES = String(2 * 1024 * 1024); // 2 MB
    try {
      vi.resetModules();
      const { kbIngestRouter: freshRouter } = await import("./kbIngestRouter");
      const caller = freshRouter.createCaller({
        user: { id: 1, role: "admin", name: "Tester", twoFactorEnabled: true },
      } as any);
      const bigB64 = Buffer.from("x".repeat(3 * 1024 * 1024)).toString("base64");
      const err = await caller.uploadDocument({ ...validUpload, base64: bigB64 }).catch((e) => e);
      expect(err).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
      const meta = readAppErrorMeta(err);
      expect(meta?.appCode).toBe("KB_FILE_TOO_LARGE");
      expect(meta?.appParams).toEqual({ limitMb: 2 });
    } finally {
      if (original === undefined) delete process.env.KB_INGEST_MAX_UPLOAD_BYTES;
      else process.env.KB_INGEST_MAX_UPLOAD_BYTES = original;
    }
  });

  it("service ném KbParseError ⇒ KB_PARSE_FAILED KHÔNG kèm reason trong appParams (I-1a)", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbParseError("corrupt pdf"));
    const err = await ingestCallerFor("admin").uploadDocument(validUpload).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_PARSE_FAILED");
    expect(meta?.appParams).toBeUndefined();
  });

  it("service ném KbContentTypeMismatchError (con của KbParseError) ⇒ KB_CONTENT_TYPE_MISMATCH kèm claimed/detected, KHÔNG rơi vào KB_PARSE_FAILED (I-2)", async () => {
    ingestDocumentMock.mockRejectedValueOnce(
      new KbContentTypeMismatchError(
        'File "notes.txt" has a TXT (text) extension but its content is a PNG image, not text.',
        "TXT",
        "a PNG image",
      ),
    );
    const err = await ingestCallerFor("admin").uploadDocument(validUpload).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_CONTENT_TYPE_MISMATCH");
    expect(meta?.appParams).toEqual({ claimed: "TXT", detected: "a PNG image" });
  });

  it("service ném KbIngestValidationError (không còn chữ để nạp) ⇒ KB_NO_TEXT_EXTRACTED kèm sourceRef", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbIngestValidationError('Document "manual.pdf" produced no extractable text'));
    const err = await ingestCallerFor("admin").uploadDocument(validUpload).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_NO_TEXT_EXTRACTED");
    expect(meta?.appParams).toEqual({ source: "manual.pdf" });
  });

  it("ingestUrl: service ném SsrfBlockedError ⇒ KB_FETCH_FAILED kèm url gốc, KHÔNG kèm reason (I-1b: reason có thể là IP nội bộ)", async () => {
    ingestUrlMock.mockRejectedValueOnce(new SsrfBlockedError("Host resolves to a blocked/internal address (169.254.169.254)"));
    const urlInput = { corpus: "vendor-x-manuals", url: "https://example.com/page" };
    const err = await ingestCallerFor("admin").ingestUrl(urlInput).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_FETCH_FAILED");
    expect(meta?.appParams).toEqual({ url: "https://example.com/page" });
    // fallbackMessage đi thẳng tới client (TRPCError.message) — TUYỆT ĐỐI không được chứa IP nội bộ.
    expect((err as Error).message).not.toContain("169.254.169.254");
  });

  it("ingestUrl: service ném WebIngestDisabledError ⇒ FEATURE_DISABLED (không phải mã KB), code tRPC vẫn FORBIDDEN", async () => {
    ingestUrlMock.mockRejectedValueOnce(new WebIngestDisabledError());
    const urlInput = { corpus: "vendor-x-manuals", url: "https://example.com/page" };
    const err = await ingestCallerFor("admin").ingestUrl(urlInput).catch((e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    const meta = readAppErrorMeta(err);
    // WebIngestDisabledError là "tính năng chưa bật", không phải lỗi tài liệu — dùng mã họ
    // phổ quát FEATURE_DISABLED (đã đăng ký từ Task 1), không nhồi vào một trong 6 mã KB.
    expect(meta?.appCode).toBe("FEATURE_DISABLED");
  });
});

// ─── B2. Tích hợp — kbStudioRouter (job-tracked wrapper, cùng cách map lỗi) ──

const listCorporaMock = vi.fn();
const createCorpusMock = vi.fn();
const deleteCorpusMock = vi.fn();
const listJobsMock = vi.fn();
const ensureCorpusRegisteredMock = vi.fn();
const createJobMock = vi.fn();
const markJobSucceededMock = vi.fn();
const markJobFailedMock = vi.fn();
const previewCorpusMock = vi.fn();

vi.mock("../services/kbStudioService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kbStudioService")>();
  return {
    ...actual,
    listCorpora: (...a: unknown[]) => listCorporaMock(...a),
    createCorpus: (...a: unknown[]) => createCorpusMock(...a),
    deleteCorpus: (...a: unknown[]) => deleteCorpusMock(...a),
    listJobs: (...a: unknown[]) => listJobsMock(...a),
    ensureCorpusRegistered: (...a: unknown[]) => ensureCorpusRegisteredMock(...a),
    createJob: (...a: unknown[]) => createJobMock(...a),
    markJobSucceeded: (...a: unknown[]) => markJobSucceededMock(...a),
    markJobFailed: (...a: unknown[]) => markJobFailedMock(...a),
    previewCorpus: (...a: unknown[]) => previewCorpusMock(...a),
  };
});

const startLoraFinetuneMock = vi.fn();
vi.mock("../services/aiLlmFinetuneSidecar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/aiLlmFinetuneSidecar")>();
  return {
    ...actual,
    startLoraFinetune: (...a: unknown[]) => startLoraFinetuneMock(...a),
  };
});

import { kbStudioRouter } from "./kbStudioRouter";

function studioCallerFor(role: string) {
  return kbStudioRouter.createCaller({ user: { id: 1, role, name: "Tester", twoFactorEnabled: true } } as any);
}

describe("kbStudioRouter — appCode thật sự tới được TRPCError.cause (mirror kbIngestRouter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isKbStudioEnabledMock.mockReturnValue(true);
    isWebIngestEnabledMock.mockReturnValue(true);
    createJobMock.mockResolvedValue({ tableAvailable: true, job: { id: 42, corpus: "vendor-x", status: "running" } });
    ensureCorpusRegisteredMock.mockResolvedValue(undefined);
    markJobSucceededMock.mockResolvedValue(undefined);
    markJobFailedMock.mockResolvedValue(undefined);
    ingestDocumentMock.mockResolvedValue({
      corpus: "vendor-x-manuals",
      sourceRef: "manual.pdf",
      chunksAdded: 3,
      parsedMeta: { sourceType: "pdf", charCount: 100, truncated: false },
    });
    ingestUrlMock.mockResolvedValue({
      corpus: "vendor-x-manuals",
      sourceRef: "https://example.com/page",
      chunksAdded: 2,
      parsedMeta: { sourceType: "url", charCount: 50, truncated: false },
    });
  });

  it("ingestDocumentJob: mimeOrExt không hỗ trợ ⇒ KB_UNSUPPORTED_TYPE (khớp kbIngestRouter, không lệch mã giữa hai router)", async () => {
    const err = await studioCallerFor("admin")
      .ingestDocumentJob({ ...validUpload, mimeOrExt: "pptx" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(readAppErrorMeta(err)?.appCode).toBe("KB_UNSUPPORTED_TYPE");
  });

  it("ingestUrlJob: service ném FetchError ⇒ KB_FETCH_FAILED kèm url gốc, KHÔNG kèm reason (I-1b), job vẫn được đánh dấu failed", async () => {
    const { FetchError } = await import("../services/kbWebFetcher");
    ingestUrlMock.mockRejectedValueOnce(new FetchError("timed out"));
    const urlInput = { corpus: "vendor-x", url: "https://example.com/page" };
    const err = await studioCallerFor("admin").ingestUrlJob(urlInput).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_FETCH_FAILED");
    expect(meta?.appParams).toEqual({ url: "https://example.com/page" });
    // markJobFailed vẫn nhận message của lỗi GỐC (chưa map) — hành vi đã có từ trước, không đổi.
    // Đây KHÔNG phải đường ra client — job-log nội bộ, không đi qua appError/i18n.
    expect(markJobFailedMock).toHaveBeenCalledWith(42, "timed out");
  });

  it("ingestDocumentJob: service ném KbIngestValidationError (không còn chữ) ⇒ KB_NO_TEXT_EXTRACTED kèm sourceRef", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbIngestValidationError('Document "manual.pdf" produced no extractable text'));
    const err = await studioCallerFor("admin").ingestDocumentJob(validUpload).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(readAppErrorMeta(err)?.appCode).toBe("KB_NO_TEXT_EXTRACTED");
    expect(readAppErrorMeta(err)?.appParams).toEqual({ source: "manual.pdf" });
  });

  it("ingestDocumentJob: service ném KbContentTypeMismatchError ⇒ KB_CONTENT_TYPE_MISMATCH (khớp kbIngestRouter, I-2)", async () => {
    ingestDocumentMock.mockRejectedValueOnce(
      new KbContentTypeMismatchError(
        'File "notes.txt" has a TXT (text) extension but its content is a PNG image, not text.',
        "TXT",
        "a PNG image",
      ),
    );
    const err = await studioCallerFor("admin").ingestDocumentJob(validUpload).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    const meta = readAppErrorMeta(err);
    expect(meta?.appCode).toBe("KB_CONTENT_TYPE_MISMATCH");
    expect(meta?.appParams).toEqual({ claimed: "TXT", detected: "a PNG image" });
  });
});
