/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — kbStudioRouter.ts unit tests.
 *
 * `../services/kbStudioService`, `../services/kbIngestService`, and `../services/kbWebFetcher`
 * are ALL fully mocked (no real parse/embed/DB/network work) — this file covers ONLY the
 * router's own responsibilities: admin/engineer RBAC (+2FA) for most endpoints, the NARROWER
 * admin-only (+2FA) gate on `deleteCorpus`, the `KB_STUDIO_ENABLED`/`WEB_INGEST_ENABLED` gates
 * on the two job-tracked ingest mutations (checked BEFORE any job/service work), the
 * server-side typed-confirm on `deleteCorpus`, the job-tracked ingest wiring (a 'running' job
 * created before the call, 'succeeded'/'failed' after — a throw NEVER leaves it stuck), and the
 * typed-error → TRPCError code mapping (identical to kbIngestRouter.ts's own mapping — see
 * kbIngestRouter.test.ts for the SSRF/parse/embed/store error-mapping cases this mirrors).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors kbIngestRouter.test.ts / aiModelCardGate.test.ts: disable the global audit-mutation
// middleware so router tests that reach past RBAC don't fire an async write against the real
// test DB.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

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

import { kbStudioRouter } from "./kbStudioRouter";
import { KbIngestDisabledError, KbIngestValidationError, KbEmbedError, KbStoreError } from "../services/kbIngestService";
import { KbUnsupportedTypeError, KbParseError } from "../services/kbDocParser";
import { WebIngestDisabledError, SsrfBlockedError, FetchError } from "../services/kbWebFetcher";
import { KbStudioTableUnavailableError, KbCorpusNotFoundError } from "../services/kbStudioService";

const SMALL_PDF_B64 = Buffer.from("%PDF-1.4 minimal fake content").toString("base64");

function callerFor(role: string, twoFactorEnabled = true) {
  return kbStudioRouter.createCaller({ user: { id: 1, role, name: "Tester", twoFactorEnabled } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  isKbStudioEnabledMock.mockReturnValue(true);
  isWebIngestEnabledMock.mockReturnValue(true);
  listCorporaMock.mockResolvedValue({ tableAvailable: true, corpora: [] });
  listJobsMock.mockResolvedValue({ tableAvailable: true, jobs: [] });
  ensureCorpusRegisteredMock.mockResolvedValue(undefined);
  createJobMock.mockResolvedValue({ tableAvailable: true, job: { id: 42, corpus: "vendor-x", status: "running" } });
  markJobSucceededMock.mockResolvedValue(undefined);
  markJobFailedMock.mockResolvedValue(undefined);
  previewCorpusMock.mockResolvedValue({ tableAvailable: true, totalChunks: 0, distinctSources: 0, sample: [] });
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

// ─── RBAC — listCorpora/createCorpus/listJobs/corpusPreview (admin/engineer) ─

describe("kbStudioRouter — admin/engineer RBAC (reads + createCorpus)", () => {
  it.each(["operator", "viewer", "quality_inspector"])("%s cannot listCorpora", async (role) => {
    await expect(callerFor(role).listCorpora()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listCorporaMock).not.toHaveBeenCalled();
  });

  it("admin WITHOUT 2FA is FORBIDDEN", async () => {
    await expect(callerFor("admin", false).listCorpora()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("engineer WITHOUT 2FA is FORBIDDEN", async () => {
    await expect(callerFor("engineer", false).listCorpora()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITH 2FA reaches listCorpora", async () => {
    await expect(callerFor("admin", true).listCorpora()).resolves.toEqual({ tableAvailable: true, corpora: [] });
  });

  it("engineer WITH 2FA reaches listCorpora, createCorpus, listJobs, corpusPreview", async () => {
    await expect(callerFor("engineer", true).listCorpora()).resolves.toBeTruthy();
    createCorpusMock.mockResolvedValueOnce({ id: 1, name: "vendor-x" });
    await expect(callerFor("engineer", true).createCorpus({ name: "vendor-x" })).resolves.toBeTruthy();
    await expect(callerFor("engineer", true).listJobs({})).resolves.toBeTruthy();
    await expect(callerFor("engineer", true).corpusPreview({ corpus: "vendor-x" })).resolves.toBeTruthy();
  });
});

// ─── deleteCorpus — NARROWER admin-only (+2FA) gate ──────────────────────────

describe("kbStudioRouter — deleteCorpus admin-ONLY (+2FA) gate", () => {
  it("engineer (who CAN do everything else) is FORBIDDEN from deleteCorpus", async () => {
    await expect(
      callerFor("engineer", true).deleteCorpus({ name: "vendor-x", confirm: "vendor-x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deleteCorpusMock).not.toHaveBeenCalled();
  });

  it("admin WITHOUT 2FA is FORBIDDEN", async () => {
    await expect(
      callerFor("admin", false).deleteCorpus({ name: "vendor-x", confirm: "vendor-x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deleteCorpusMock).not.toHaveBeenCalled();
  });

  it("admin WITH 2FA + matching confirm reaches the service", async () => {
    deleteCorpusMock.mockResolvedValueOnce({ chunksRemoved: 5, jobsRemoved: 2 });
    const result = await callerFor("admin", true).deleteCorpus({ name: "vendor-x", confirm: "vendor-x" });
    expect(result).toMatchObject({ deleted: true, name: "vendor-x", chunksRemoved: 5, jobsRemoved: 2 });
    expect(deleteCorpusMock).toHaveBeenCalledWith("vendor-x");
  });

  it("confirm text NOT matching the corpus name ⇒ BAD_REQUEST, service never called", async () => {
    await expect(
      callerFor("admin", true).deleteCorpus({ name: "vendor-x", confirm: "wrong-name" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteCorpusMock).not.toHaveBeenCalled();
  });

  it("KbCorpusNotFoundError ⇒ NOT_FOUND", async () => {
    deleteCorpusMock.mockRejectedValueOnce(new KbCorpusNotFoundError("ghost"));
    await expect(
      callerFor("admin", true).deleteCorpus({ name: "ghost", confirm: "ghost" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("KbStudioTableUnavailableError ⇒ PRECONDITION_FAILED", async () => {
    deleteCorpusMock.mockRejectedValueOnce(new KbStudioTableUnavailableError("not migrated"));
    await expect(
      callerFor("admin", true).deleteCorpus({ name: "vendor-x", confirm: "vendor-x" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

// ─── createCorpus — table-unavailable / conflict mapping ─────────────────────

describe("kbStudioRouter — createCorpus error mapping", () => {
  it("KbStudioTableUnavailableError ⇒ PRECONDITION_FAILED", async () => {
    createCorpusMock.mockRejectedValueOnce(new KbStudioTableUnavailableError("not migrated"));
    await expect(callerFor("admin", true).createCorpus({ name: "vendor-x" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("a unique-violation ⇒ CONFLICT", async () => {
    createCorpusMock.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }),
    );
    await expect(callerFor("admin", true).createCorpus({ name: "vendor-x" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

// ─── ingestDocumentJob — KB_STUDIO_ENABLED gate ──────────────────────────────

describe("kbStudioRouter — ingestDocumentJob KB_STUDIO_ENABLED gate", () => {
  const validInput = { corpus: "vendor-x", sourceRef: "manual.pdf", mimeOrExt: "application/pdf", base64: SMALL_PDF_B64 };

  it("flag OFF ⇒ FORBIDDEN before any job/decode/ingest work", async () => {
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestDocumentJob(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ensureCorpusRegisteredMock).not.toHaveBeenCalled();
    expect(createJobMock).not.toHaveBeenCalled();
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("operator cannot ingestDocumentJob", async () => {
    await expect(callerFor("operator").ingestDocumentJob(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an unsupported MIME type is rejected BEFORE any job is created", async () => {
    await expect(
      callerFor("admin", true).ingestDocumentJob({ ...validInput, mimeOrExt: "application/zip" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createJobMock).not.toHaveBeenCalled();
  });
});

// ─── ingestDocumentJob — job-tracked wiring (succeeded / failed-not-stuck) ───

describe("kbStudioRouter — ingestDocumentJob job lifecycle", () => {
  const validInput = { corpus: "vendor-x", sourceRef: "manual.pdf", mimeOrExt: "application/pdf", base64: SMALL_PDF_B64 };

  it("success: registers the corpus, creates a running job, calls ingestDocument, marks the job succeeded, returns jobId", async () => {
    const result = await callerFor("admin", true).ingestDocumentJob(validInput);
    expect(ensureCorpusRegisteredMock).toHaveBeenCalledWith("vendor-x", 1);
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ corpus: "vendor-x", sourceType: "application/pdf", sourceRef: "manual.pdf" }),
    );
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
    expect(markJobSucceededMock).toHaveBeenCalledWith(42, 3);
    expect(markJobFailedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ chunksAdded: 3, jobId: 42 });
  });

  it("a throw from ingestDocument marks the job FAILED (never stuck at running) and re-throws mapped error", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbStoreError("table not migrated"));
    await expect(callerFor("admin", true).ingestDocumentJob(validInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(markJobFailedMock).toHaveBeenCalledWith(42, "table not migrated");
    expect(markJobSucceededMock).not.toHaveBeenCalled();
  });

  it("createJob degrading to tableAvailable:false (unmigrated registry) still lets the ingest proceed with jobId:null", async () => {
    createJobMock.mockResolvedValueOnce({ tableAvailable: false, job: null });
    const result = await callerFor("admin", true).ingestDocumentJob(validInput);
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1); // ingest itself is NEVER blocked
    expect(result).toMatchObject({ chunksAdded: 3, jobId: null });
    expect(markJobSucceededMock).toHaveBeenCalledWith(null, 3); // best-effort no-op, verified at the service layer
  });

  const typedErrorCases: Array<[name: string, err: Error, code: string]> = [
    ["KbIngestDisabledError", new KbIngestDisabledError(), "FORBIDDEN"],
    ["KbIngestValidationError", new KbIngestValidationError("bad input"), "BAD_REQUEST"],
    ["KbUnsupportedTypeError", new KbUnsupportedTypeError("zip"), "BAD_REQUEST"],
    ["KbParseError", new KbParseError("corrupt pdf"), "BAD_REQUEST"],
    ["KbEmbedError", new KbEmbedError("model not loaded"), "INTERNAL_SERVER_ERROR"],
    ["KbStoreError", new KbStoreError("store failed"), "INTERNAL_SERVER_ERROR"],
  ];

  for (const [name, err, code] of typedErrorCases) {
    it(`${name} ⇒ ${code} (mirrors kbIngestRouter's mapping), job marked failed`, async () => {
      ingestDocumentMock.mockRejectedValueOnce(err);
      await expect(callerFor("admin", true).ingestDocumentJob(validInput)).rejects.toMatchObject({ code });
      expect(markJobFailedMock).toHaveBeenCalledWith(42, err.message);
    });
  }
});

// ─── ingestUrlJob — WEB_INGEST_ENABLED / KB_STUDIO_ENABLED gate ──────────────

describe("kbStudioRouter — ingestUrlJob gates", () => {
  const urlInput = { corpus: "vendor-x", url: "https://example.com/page" };

  it("WEB_INGEST_ENABLED off ⇒ FORBIDDEN, no job created, ingestUrl never called", async () => {
    isWebIngestEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestUrlJob(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createJobMock).not.toHaveBeenCalled();
    expect(ingestUrlMock).not.toHaveBeenCalled();
  });

  it("KB_STUDIO_ENABLED off ⇒ FORBIDDEN, no job created", async () => {
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestUrlJob(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createJobMock).not.toHaveBeenCalled();
  });
});

// ─── ingestUrlJob — job-tracked wiring (succeeded / failed-not-stuck) ───────

describe("kbStudioRouter — ingestUrlJob job lifecycle", () => {
  const urlInput = { corpus: "vendor-x", url: "https://example.com/page" };

  it("success: creates a running job, calls ingestUrl, marks the job succeeded", async () => {
    const result = await callerFor("admin", true).ingestUrlJob(urlInput);
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ corpus: "vendor-x", sourceType: "url", sourceRef: "https://example.com/page" }),
    );
    expect(markJobSucceededMock).toHaveBeenCalledWith(42, 2);
    expect(result).toMatchObject({ chunksAdded: 2, jobId: 42 });
  });

  it("SsrfBlockedError ⇒ BAD_REQUEST, job marked failed (never stuck)", async () => {
    ingestUrlMock.mockRejectedValueOnce(new SsrfBlockedError("blocked IP"));
    await expect(callerFor("admin", true).ingestUrlJob(urlInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(markJobFailedMock).toHaveBeenCalledWith(42, "blocked IP");
  });

  it("FetchError ⇒ BAD_REQUEST", async () => {
    ingestUrlMock.mockRejectedValueOnce(new FetchError("timed out"));
    await expect(callerFor("admin", true).ingestUrlJob(urlInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a WebIngestDisabledError surfaced FROM the service is also mapped to FORBIDDEN", async () => {
    ingestUrlMock.mockRejectedValueOnce(new WebIngestDisabledError());
    await expect(callerFor("admin", true).ingestUrlJob(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── corpusPreview (Eval-lite) ────────────────────────────────────────────────

describe("kbStudioRouter — corpusPreview", () => {
  it("reads chunk sample + counts via kbStudioService.previewCorpus, no model/embedding call", async () => {
    previewCorpusMock.mockResolvedValueOnce({
      tableAvailable: true,
      totalChunks: 12,
      distinctSources: 2,
      sample: [{ id: 1, sourceType: "pdf", sourceRef: "a.pdf", chunkIndex: 0, text: "hello", tokenCount: 2, createdAt: new Date() }],
    });
    const result = await callerFor("engineer", true).corpusPreview({ corpus: "vendor-x" });
    expect(result.totalChunks).toBe(12);
    expect(previewCorpusMock).toHaveBeenCalledWith("vendor-x", 20);
  });

  it("viewer cannot corpusPreview", async () => {
    await expect(callerFor("viewer").corpusPreview({ corpus: "vendor-x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
