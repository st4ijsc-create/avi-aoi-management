/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1, extended by E3-5; Task 6 / Wave 2 đường B adds image) —
 * kbDocParser.ts unit tests.
 *
 * `pdf-parse` and `mammoth` are BOTH mocked — no live parser/model is ever exercised here.
 * md/txt paths need no mocking (plain string handling). E3-5 adds `./kbPdfOcr` (the scanned-PDF
 * OCR helper) to the mocks — its OWN fail-safe/injection/bounds behavior is covered in
 * kbPdfOcr.test.ts; this file only covers the WIRING (density detection → OCR path taken/not
 * taken, meta flags, and the normal-PDF path staying byte-identical). Task 6 adds
 * `./kbImageDescriber` to the mocks the same way — its OWN VLM-call/honest-degrade behavior is
 * covered in kbImageDescriber.test.ts; this file only covers the WIRING (magic-byte check →
 * describeImageForKnowledge call/not-called, meta.sourceType, error propagation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getTextMock = vi.fn();
const destroyMock = vi.fn(async () => undefined);
const PDFParseMock = vi.fn().mockImplementation(() => ({ getText: getTextMock, destroy: destroyMock }));
vi.mock("pdf-parse", () => ({ PDFParse: PDFParseMock }));

const extractRawTextMock = vi.fn();
vi.mock("mammoth", () => ({
  extractRawText: (...args: unknown[]) => extractRawTextMock(...args),
}));

const ocrScannedPdfMock = vi.fn();
vi.mock("./kbPdfOcr", () => ({
  ocrScannedPdf: (...args: unknown[]) => ocrScannedPdfMock(...args),
}));

const describeImageForKnowledgeMock = vi.fn();
vi.mock("./kbImageDescriber", () => ({
  describeImageForKnowledge: (...args: unknown[]) => describeImageForKnowledgeMock(...args),
}));

async function loadFresh() {
  vi.resetModules();
  return import("./kbDocParser");
}

beforeEach(() => {
  vi.clearAllMocks();
  destroyMock.mockResolvedValue(undefined);
  // Safe default: "OCR not available/used" — matches kbPdfOcr's own EMPTY_RESULT shape, so any
  // test whose fixture text happens to be short (density below the default threshold) still
  // falls back to the ORIGINAL pdf-parse text (honest, no crash), same as real "OCR off" behavior.
  ocrScannedPdfMock.mockResolvedValue({ text: "", ocrUsed: false, pagesAttempted: 0, pagesProcessed: 0, pagesFailed: 0 });
  delete process.env.KB_PARSE_MAX_CHARS;
  delete process.env.KB_PARSE_TIMEOUT_MS;
  delete process.env.KB_OCR_SCANNED_DENSITY_THRESHOLD;
});

afterEach(() => {
  delete process.env.KB_PARSE_MAX_CHARS;
  delete process.env.KB_PARSE_TIMEOUT_MS;
  delete process.env.KB_OCR_SCANNED_DENSITY_THRESHOLD;
});

// ─── normalizeSourceType ────────────────────────────────────────────────────

describe("normalizeSourceType", () => {
  it("resolves bare extensions", async () => {
    const { normalizeSourceType } = await loadFresh();
    expect(normalizeSourceType("pdf")).toBe("pdf");
    expect(normalizeSourceType("docx")).toBe("docx");
    expect(normalizeSourceType("md")).toBe("md");
    expect(normalizeSourceType("txt")).toBe("txt");
  });

  it("resolves dotted extensions and filenames", async () => {
    const { normalizeSourceType } = await loadFresh();
    expect(normalizeSourceType(".pdf")).toBe("pdf");
    expect(normalizeSourceType("manual.pdf")).toBe("pdf");
    expect(normalizeSourceType("notes.MD")).toBe("md");
    expect(normalizeSourceType("readme.txt")).toBe("txt");
    expect(normalizeSourceType("spec-v2.docx")).toBe("docx");
  });

  it("resolves MIME types", async () => {
    const { normalizeSourceType } = await loadFresh();
    expect(normalizeSourceType("application/pdf")).toBe("pdf");
    expect(normalizeSourceType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "docx",
    );
    expect(normalizeSourceType("text/markdown")).toBe("md");
    expect(normalizeSourceType("text/plain")).toBe("txt");
  });

  it("throws KbUnsupportedTypeError for anything else", async () => {
    const { normalizeSourceType, KbUnsupportedTypeError } = await loadFresh();
    expect(() => normalizeSourceType("pptx")).toThrow(KbUnsupportedTypeError);
    expect(() => normalizeSourceType("application/zip")).toThrow(KbUnsupportedTypeError);
    expect(() => normalizeSourceType("")).toThrow(KbUnsupportedTypeError);
  });

  it("resolves 'url' (E3-3's pass-through marker for kbWebFetcher-extracted text)", async () => {
    const { normalizeSourceType } = await loadFresh();
    expect(normalizeSourceType("url")).toBe("url");
  });
});

// ─── url (E3-3 pass-through — no network/HTML parsing here, see kbWebFetcher.ts) ────────────

describe("parseDocument — url (pass-through, mirrors md/txt)", () => {
  it("treats already-extracted text as-is, bounded + trimmed like txt", async () => {
    const { parseDocument } = await loadFresh();
    const result = await parseDocument("  Already-extracted page text.  \r\n", "url");
    expect(result.text).toBe("Already-extracted page text.");
    expect(result.meta).toMatchObject({ sourceType: "url", truncated: false });
  });

  it("bounds extracted size via KB_PARSE_MAX_CHARS, same as md/txt", async () => {
    process.env.KB_PARSE_MAX_CHARS = "10";
    const { parseDocument } = await loadFresh();
    const result = await parseDocument("0123456789ABCDEF", "url");
    expect(result.text).toBe("0123456789");
    expect(result.meta.truncated).toBe(true);
  });
});

// ─── md / txt (no mocking needed) ───────────────────────────────────────────

describe("parseDocument — md/txt", () => {
  it("extracts plain markdown text as-is", async () => {
    const { parseDocument } = await loadFresh();
    const result = await parseDocument("# Title\n\nSome body text.", "md");
    expect(result.text).toBe("# Title\n\nSome body text.");
    expect(result.meta).toMatchObject({ sourceType: "md", truncated: false });
  });

  it("extracts plain txt from a Buffer input", async () => {
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("hello world", "utf8"), "readme.txt");
    expect(result.text).toBe("hello world");
    expect(result.meta.sourceType).toBe("txt");
  });

  it("normalizes CRLF to LF and trims", async () => {
    const { parseDocument } = await loadFresh();
    const result = await parseDocument("  line one\r\nline two  ", "txt");
    expect(result.text).toBe("line one\nline two");
  });

  it("bounds extracted size via KB_PARSE_MAX_CHARS and flags truncated", async () => {
    process.env.KB_PARSE_MAX_CHARS = "10";
    const { parseDocument } = await loadFresh();
    const result = await parseDocument("0123456789ABCDEF", "txt");
    expect(result.text).toBe("0123456789");
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.charCount).toBe(10);
  });
});

// ─── pdf (mocked pdf-parse) ──────────────────────────────────────────────────

describe("parseDocument — pdf", () => {
  it("extracts text via PDFParse.getText and destroys the parser", async () => {
    getTextMock.mockResolvedValueOnce({
      text: "page one text\n\npage two text",
      pages: [{ num: 1, text: "page one text" }, { num: 2, text: "page two text" }],
      total: 2,
    });
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake"), "application/pdf");
    expect(result.text).toBe("page one text\n\npage two text");
    expect(result.meta).toMatchObject({ sourceType: "pdf", pageCount: 2, truncated: false });
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to joining per-page text when `text` is absent", async () => {
    getTextMock.mockResolvedValueOnce({ pages: [{ num: 1, text: "only page" }], total: 1 });
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake"), "pdf");
    expect(result.text).toBe("only page");
  });

  it("a corrupt/unparseable PDF throws KbParseError (destroy still called)", async () => {
    getTextMock.mockRejectedValueOnce(new Error("Invalid PDF structure"));
    const { parseDocument, KbParseError } = await loadFresh();
    await expect(parseDocument(Buffer.from("not a pdf"), "pdf")).rejects.toThrow(KbParseError);
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("a hanging parse is aborted by the timeout guard (never hangs)", async () => {
    process.env.KB_PARSE_TIMEOUT_MS = "20";
    getTextMock.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const { parseDocument, KbParseError } = await loadFresh();
    await expect(parseDocument(Buffer.from("x"), "pdf")).rejects.toThrow(KbParseError);
  });
});

// ─── pdf — E3-5 scanned-PDF OCR wiring (kbPdfOcr mocked) ─────────────────────────────────────

describe("parseDocument — pdf — scanned-PDF OCR wiring (E3-5)", () => {
  it("a normal, text-dense PDF NEVER calls ocrScannedPdf (unchanged behavior)", async () => {
    const denseText = "A".repeat(3000); // density 1500 chars/page, far above the ~20 threshold
    getTextMock.mockResolvedValueOnce({ text: denseText, pages: [{ num: 1, text: denseText }], total: 2 });
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake"), "pdf");
    expect(result.text).toBe(denseText);
    expect(ocrScannedPdfMock).not.toHaveBeenCalled();
    expect(result.meta.ocrUsed).toBeFalsy();
    expect(result.meta.scannedNoOcr).toBeFalsy();
  });

  it("a scanned/low-text PDF + OCR available takes the OCR path and returns the OCR'd text", async () => {
    getTextMock.mockResolvedValueOnce({ text: "", pages: [{ num: 1, text: "" }, { num: 2, text: "" }], total: 2 });
    ocrScannedPdfMock.mockResolvedValueOnce({
      text: "OCR-recognized page content",
      ocrUsed: true,
      pagesAttempted: 2,
      pagesProcessed: 2,
      pagesFailed: 0,
    });
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake scanned"), "pdf");
    expect(result.text).toBe("OCR-recognized page content");
    expect(result.meta).toMatchObject({ sourceType: "pdf", pageCount: 2, ocrUsed: true, ocrPagesProcessed: 2 });
    expect(result.meta.scannedNoOcr).toBeFalsy();
    expect(ocrScannedPdfMock).toHaveBeenCalledWith(expect.any(Buffer), 2);
  });

  it("OCR disabled/unavailable for a scanned PDF → returns the ORIGINAL (possibly empty) text with scannedNoOcr:true, no crash, no fabrication", async () => {
    getTextMock.mockResolvedValueOnce({ text: "", pages: [{ num: 1, text: "" }], total: 1 });
    // ocrScannedPdfMock uses the default beforeEach mock: { text: "", ocrUsed: false, ... }
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake scanned"), "pdf");
    expect(result.text).toBe("");
    expect(result.meta).toMatchObject({ sourceType: "pdf", ocrUsed: false, scannedNoOcr: true });
  });

  it("an unexpected throw from ocrScannedPdf is caught (defense-in-depth) — still falls back honestly, never crashes", async () => {
    getTextMock.mockResolvedValueOnce({ text: "", pages: [{ num: 1, text: "" }], total: 1 });
    ocrScannedPdfMock.mockRejectedValueOnce(new Error("unexpected kbPdfOcr crash"));
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake scanned"), "pdf");
    expect(result.text).toBe("");
    expect(result.meta.scannedNoOcr).toBe(true);
    expect(result.meta.ocrUsed).toBe(false);
  });

  it("the density threshold is configurable via KB_OCR_SCANNED_DENSITY_THRESHOLD", async () => {
    const text = "X".repeat(10); // density 10 chars/page
    getTextMock.mockResolvedValueOnce({ text, pages: [{ num: 1, text }], total: 1 });
    process.env.KB_OCR_SCANNED_DENSITY_THRESHOLD = "5"; // 10 > 5 → NOT scanned, OCR path skipped
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("%PDF-1.4 fake"), "pdf");
    expect(result.text).toBe(text);
    expect(ocrScannedPdfMock).not.toHaveBeenCalled();
  });
});

// ─── docx (mocked mammoth) ───────────────────────────────────────────────────

describe("parseDocument — docx", () => {
  it("extracts text via mammoth.extractRawText", async () => {
    extractRawTextMock.mockResolvedValueOnce({ value: "Docx body content.", messages: [] });
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(Buffer.from("PK fake docx"), "docx");
    expect(result.text).toBe("Docx body content.");
    expect(result.meta.sourceType).toBe("docx");
    expect(extractRawTextMock).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
  });

  it("a corrupt docx throws KbParseError, not a raw exception", async () => {
    extractRawTextMock.mockRejectedValueOnce(new Error("Can't find end of central directory"));
    const { parseDocument, KbParseError } = await loadFresh();
    await expect(parseDocument(Buffer.from("not a zip"), "docx")).rejects.toThrow(KbParseError);
  });
});

// ─── image (Task 6, Wave 2 đường B — VLM path, mocked kbImageDescriber) ──────

describe("normalizeSourceType — image extensions", () => {
  it("resolves png/jpg/jpeg/webp (bare, dotted, filename, MIME) to 'image'", async () => {
    const { normalizeSourceType } = await loadFresh();
    expect(normalizeSourceType("png")).toBe("image");
    expect(normalizeSourceType(".jpg")).toBe("image");
    expect(normalizeSourceType("so-do-day.jpeg")).toBe("image");
    expect(normalizeSourceType("image/webp")).toBe("image");
  });
});

describe("parseDocument — image", () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

  it("a genuine PNG is handed to describeImageForKnowledge and its text becomes the parsed text", async () => {
    describeImageForKnowledgeMock.mockResolvedValueOnce({ ok: true, text: "Sơ đồ đấu dây 3 khối PLC" });
    const { parseDocument } = await loadFresh();
    const result = await parseDocument(PNG_BYTES, "wiring-diagram.png");
    expect(result.text).toBe("Sơ đồ đấu dây 3 khối PLC");
    expect(result.meta.sourceType).toBe("image");
    expect(describeImageForKnowledgeMock).toHaveBeenCalledWith(expect.any(Buffer), "wiring-diagram.png");
  });

  it("a genuine JPEG and WEBP also pass the magic-byte check", async () => {
    describeImageForKnowledgeMock.mockResolvedValue({ ok: true, text: "ok" });
    const { parseDocument } = await loadFresh();
    await expect(parseDocument(JPEG_BYTES, "photo.jpg")).resolves.toMatchObject({ text: "ok" });
    await expect(parseDocument(WEBP_BYTES, "photo.webp")).resolves.toMatchObject({ text: "ok" });
  });

  it("chống nhầm định dạng: extension says PNG but bytes don't match ⇒ KbParseError, VLM never called", async () => {
    const { parseDocument, KbParseError } = await loadFresh();
    await expect(parseDocument(Buffer.from("not really a png"), "diagram.png")).rejects.toThrow(KbParseError);
    expect(describeImageForKnowledgeMock).not.toHaveBeenCalled();
  });

  it("VLM not ready/empty ⇒ KbParseError carrying the VERBATIM reason (honest degrade, never a fabricated chunk)", async () => {
    describeImageForKnowledgeMock.mockResolvedValueOnce({
      ok: false,
      reason: "Model thị giác chưa sẵn sàng — chưa thể nạp ảnh (vision model unavailable).",
    });
    const { parseDocument, KbParseError } = await loadFresh();
    const call = parseDocument(PNG_BYTES, "diagram.png");
    await expect(call).rejects.toThrow(KbParseError);
    await expect(call).rejects.toThrow("Model thị giác chưa sẵn sàng — chưa thể nạp ảnh (vision model unavailable).");
  });
});

// ─── unsupported type never attempts to parse ───────────────────────────────

describe("parseDocument — unsupported type", () => {
  it("throws KbUnsupportedTypeError and never calls any parser", async () => {
    const { parseDocument, KbUnsupportedTypeError } = await loadFresh();
    await expect(parseDocument(Buffer.from("data"), "application/zip")).rejects.toThrow(KbUnsupportedTypeError);
    expect(getTextMock).not.toHaveBeenCalled();
    expect(extractRawTextMock).not.toHaveBeenCalled();
  });
});
