/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1 + E3-3) — kbIngestRouter.ts unit tests.
 *
 * `../services/kbIngestService` and `../services/kbWebFetcher` are BOTH fully mocked (no real
 * parse/embed/DB/network work); this file covers ONLY the router's own responsibilities:
 * admin/engineer RBAC (+2FA), the KB_STUDIO_ENABLED gate checked BEFORE decoding the payload,
 * base64 decode + size bound, the MIME/extension allowlist checked before any heavy work, the
 * typed-error → TRPCError code mapping, and (E3-3) the WEB_INGEST_ENABLED gate + ingestUrl's
 * own error mapping. The SSRF guard itself is NOT re-tested here — see kbWebFetcher.test.ts;
 * this file only checks that the router wires the gate/RBAC/error-mapping correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors aiModelCardGate.test.ts: disable the global audit-mutation middleware so router
// tests that reach past RBAC don't fire an async write against the real test DB.
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
import { KbIngestDisabledError, KbIngestValidationError, KbEmbedError, KbStoreError } from "../services/kbIngestService";
import { KbUnsupportedTypeError, KbParseError } from "../services/kbDocParser";
import { WebIngestDisabledError, SsrfBlockedError, FetchError } from "../services/kbWebFetcher";
import { VideoIngestDisabledError, SttUnavailableError, SttValidationError, SttTranscribeError } from "../services/kbVideoTranscriber";

const SMALL_PDF_B64 = Buffer.from("%PDF-1.4 minimal fake content").toString("base64");

function callerFor(role: string, twoFactorEnabled = true) {
  return kbIngestRouter.createCaller({ user: { id: 1, role, name: "Tester", twoFactorEnabled } } as any);
}

const validInput = {
  corpus: "vendor-x-manuals",
  sourceRef: "manual.pdf",
  mimeOrExt: "application/pdf",
  base64: SMALL_PDF_B64,
};

const SMALL_VIDEO_B64 = Buffer.from("fake mp4 bytes").toString("base64");

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
  ingestVideoMock.mockResolvedValue({
    corpus: "vendor-x-manuals",
    sourceRef: "onboarding.mp4",
    chunksAdded: 5,
    parsedMeta: { sourceType: "video", charCount: 200, truncated: false },
  });
});

// ─── RBAC ─────────────────────────────────────────────────────────────────

describe("kbIngestRouter — admin/engineer RBAC", () => {
  it("operator cannot uploadDocument", async () => {
    await expect(callerFor("operator").uploadDocument(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("viewer cannot uploadDocument", async () => {
    await expect(callerFor("viewer").uploadDocument(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("quality_inspector (not admin/engineer) cannot uploadDocument", async () => {
    await expect(callerFor("quality_inspector").uploadDocument(validInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admin WITHOUT 2FA is FORBIDDEN, and the service is never touched", async () => {
    await expect(callerFor("admin", false).uploadDocument(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("engineer WITHOUT 2FA is FORBIDDEN", async () => {
    await expect(callerFor("engineer", false).uploadDocument(validInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admin WITH 2FA clears the RBAC gate and reaches the service", async () => {
    const result = await callerFor("admin", true).uploadDocument(validInput);
    expect(result.chunksAdded).toBe(3);
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("engineer WITH 2FA clears the RBAC gate and reaches the service", async () => {
    await expect(callerFor("engineer", true).uploadDocument(validInput)).resolves.toMatchObject({ chunksAdded: 3 });
  });

  it("status query also requires admin/engineer (+2FA)", async () => {
    await expect(callerFor("operator").status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const status = await callerFor("admin", true).status();
    expect(status).toMatchObject({
      enabled: true,
      allowedTypes: ["pdf", "docx", "md", "txt"],
      webIngestEnabled: true,
      videoIngestEnabled: true,
    });
  });
});

// ─── E3-3: ingestUrl — admin/engineer RBAC (+2FA) ────────────────────────────

describe("kbIngestRouter — ingestUrl admin/engineer RBAC", () => {
  const urlInput = { corpus: "vendor-x-manuals", url: "https://example.com/page" };

  it("operator cannot ingestUrl", async () => {
    await expect(callerFor("operator").ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestUrlMock).not.toHaveBeenCalled();
  });

  it("viewer cannot ingestUrl", async () => {
    await expect(callerFor("viewer").ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITHOUT 2FA is FORBIDDEN, service never touched", async () => {
    await expect(callerFor("admin", false).ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestUrlMock).not.toHaveBeenCalled();
  });

  it("engineer WITHOUT 2FA is FORBIDDEN", async () => {
    await expect(callerFor("engineer", false).ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITH 2FA clears the RBAC gate and reaches the service", async () => {
    const result = await callerFor("admin", true).ingestUrl(urlInput);
    expect(result.chunksAdded).toBe(2);
    expect(ingestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("engineer WITH 2FA clears the RBAC gate and reaches the service", async () => {
    await expect(callerFor("engineer", true).ingestUrl(urlInput)).resolves.toMatchObject({ chunksAdded: 2 });
  });
});

// ─── E3-3: ingestUrl — WEB_INGEST_ENABLED / KB_STUDIO_ENABLED gate ───────────

describe("kbIngestRouter — ingestUrl WEB_INGEST_ENABLED gate", () => {
  const urlInput = { corpus: "vendor-x-manuals", url: "https://example.com/page" };

  it("WEB_INGEST_ENABLED off ⇒ FORBIDDEN before any fetch (ingestUrl service never called)", async () => {
    isWebIngestEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestUrlMock).not.toHaveBeenCalled();
  });

  it("KB_STUDIO_ENABLED off ⇒ FORBIDDEN before any fetch", async () => {
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestUrlMock).not.toHaveBeenCalled();
  });

  it("a WebIngestDisabledError surfaced FROM the service is also mapped to FORBIDDEN", async () => {
    ingestUrlMock.mockRejectedValueOnce(new WebIngestDisabledError());
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── E3-3: ingestUrl — input validation + typed error → TRPCError mapping ────

describe("kbIngestRouter — ingestUrl input validation + error mapping", () => {
  const urlInput = { corpus: "vendor-x-manuals", url: "https://example.com/page" };

  it("rejects a non-URL string before reaching the service", async () => {
    await expect(
      callerFor("admin", true).ingestUrl({ corpus: "c1", url: "not a url" }),
    ).rejects.toBeTruthy();
    expect(ingestUrlMock).not.toHaveBeenCalled();
  });

  it("SsrfBlockedError ⇒ BAD_REQUEST", async () => {
    ingestUrlMock.mockRejectedValueOnce(new SsrfBlockedError("blocked IP"));
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("FetchError ⇒ BAD_REQUEST", async () => {
    ingestUrlMock.mockRejectedValueOnce(new FetchError("timed out"));
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("KbEmbedError ⇒ INTERNAL_SERVER_ERROR", async () => {
    ingestUrlMock.mockRejectedValueOnce(new KbEmbedError("model not loaded"));
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("KbStoreError ⇒ INTERNAL_SERVER_ERROR", async () => {
    ingestUrlMock.mockRejectedValueOnce(new KbStoreError("table not migrated"));
    await expect(callerFor("admin", true).ingestUrl(urlInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("happy path passes corpus/url/userId through to ingestUrl", async () => {
    await callerFor("admin", true).ingestUrl(urlInput);
    expect(ingestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ corpus: "vendor-x-manuals", url: "https://example.com/page", userId: 1 }),
    );
  });
});

// ─── KB_STUDIO_ENABLED gate ─────────────────────────────────────────────────

describe("kbIngestRouter — KB_STUDIO_ENABLED gate", () => {
  it("flag OFF ⇒ FORBIDDEN BEFORE decoding/parsing (ingestDocument never called)", async () => {
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("a KbIngestDisabledError surfaced FROM the service is also mapped to FORBIDDEN", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbIngestDisabledError());
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── MIME/extension allowlist ────────────────────────────────────────────────

describe("kbIngestRouter — MIME/extension allowlist", () => {
  it("an unsupported type is rejected BEFORE decoding the payload (BAD_REQUEST)", async () => {
    await expect(
      callerFor("admin", true).uploadDocument({ ...validInput, mimeOrExt: "application/zip" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it.each(["pdf", "docx", "md", "txt", "application/pdf", "text/plain"])(
    "accepts allowed type %s",
    async (mimeOrExt) => {
      await expect(callerFor("admin", true).uploadDocument({ ...validInput, mimeOrExt })).resolves.toBeTruthy();
    },
  );
});

// ─── base64 decode + size bound ──────────────────────────────────────────────

describe("kbIngestRouter — base64 decode + size bound", () => {
  it("rejects an oversized decoded payload (PAYLOAD_TOO_LARGE)", async () => {
    const original = process.env.KB_INGEST_MAX_UPLOAD_BYTES;
    process.env.KB_INGEST_MAX_UPLOAD_BYTES = "16"; // 16 bytes cap
    try {
      vi.resetModules();
      const { kbIngestRouter: freshRouter } = await import("./kbIngestRouter");
      const caller = freshRouter.createCaller({
        user: { id: 1, role: "admin", name: "Tester", twoFactorEnabled: true },
      } as any);
      const bigB64 = Buffer.from("x".repeat(1000)).toString("base64");
      await expect(caller.uploadDocument({ ...validInput, base64: bigB64 })).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
      });
    } finally {
      if (original === undefined) delete process.env.KB_INGEST_MAX_UPLOAD_BYTES;
      else process.env.KB_INGEST_MAX_UPLOAD_BYTES = original;
    }
  });

  it("rejects an empty document payload (base64 that decodes to zero bytes)", async () => {
    await expect(
      callerFor("admin", true).uploadDocument({ ...validInput, base64: " " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("strips a data: URL prefix before decoding", async () => {
    await callerFor("admin", true).uploadDocument({
      ...validInput,
      base64: `data:application/pdf;base64,${SMALL_PDF_B64}`,
    });
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
    const call = ingestDocumentMock.mock.calls[0]![0];
    expect(Buffer.isBuffer(call.buffer)).toBe(true);
    expect(call.buffer.toString("utf8")).toBe("%PDF-1.4 minimal fake content");
  });
});

// ─── error → TRPCError code mapping ──────────────────────────────────────────

describe("kbIngestRouter — typed error → TRPCError code mapping", () => {
  it("KbIngestValidationError ⇒ BAD_REQUEST", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbIngestValidationError("corpus is required"));
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("KbUnsupportedTypeError (from the service) ⇒ BAD_REQUEST", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbUnsupportedTypeError("zip"));
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("KbParseError (corrupt file) ⇒ BAD_REQUEST", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbParseError("corrupt pdf"));
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("KbEmbedError ⇒ INTERNAL_SERVER_ERROR", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbEmbedError("model not loaded"));
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("KbStoreError ⇒ INTERNAL_SERVER_ERROR", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new KbStoreError("table not migrated"));
    await expect(callerFor("admin", true).uploadDocument(validInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

// ─── E3-4: ingestVideo — admin/engineer RBAC (+2FA) ──────────────────────────

describe("kbIngestRouter — ingestVideo admin/engineer RBAC", () => {
  const videoInput = { corpus: "vendor-x-manuals", filename: "onboarding.mp4", base64: SMALL_VIDEO_B64 };

  it("operator cannot ingestVideo", async () => {
    await expect(callerFor("operator").ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestVideoMock).not.toHaveBeenCalled();
  });

  it("viewer cannot ingestVideo", async () => {
    await expect(callerFor("viewer").ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITHOUT 2FA is FORBIDDEN, service never touched", async () => {
    await expect(callerFor("admin", false).ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestVideoMock).not.toHaveBeenCalled();
  });

  it("engineer WITHOUT 2FA is FORBIDDEN", async () => {
    await expect(callerFor("engineer", false).ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin WITH 2FA clears the RBAC gate and reaches the service", async () => {
    const result = await callerFor("admin", true).ingestVideo(videoInput);
    expect(result.chunksAdded).toBe(5);
    expect(ingestVideoMock).toHaveBeenCalledTimes(1);
  });

  it("engineer WITH 2FA clears the RBAC gate and reaches the service", async () => {
    await expect(callerFor("engineer", true).ingestVideo(videoInput)).resolves.toMatchObject({ chunksAdded: 5 });
  });
});

// ─── E3-4: ingestVideo — VIDEO_INGEST_ENABLED / KB_STUDIO_ENABLED gate ───────

describe("kbIngestRouter — ingestVideo VIDEO_INGEST_ENABLED gate", () => {
  const videoInput = { corpus: "vendor-x-manuals", filename: "onboarding.mp4", base64: SMALL_VIDEO_B64 };

  it("VIDEO_INGEST_ENABLED off ⇒ FORBIDDEN before any transcription (service never called)", async () => {
    isVideoIngestEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestVideoMock).not.toHaveBeenCalled();
  });

  it("KB_STUDIO_ENABLED off ⇒ FORBIDDEN before any transcription", async () => {
    isKbStudioEnabledMock.mockReturnValue(false);
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ingestVideoMock).not.toHaveBeenCalled();
  });

  it("a VideoIngestDisabledError surfaced FROM the service is also mapped to FORBIDDEN", async () => {
    ingestVideoMock.mockRejectedValueOnce(new VideoIngestDisabledError());
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── E3-4: ingestVideo — base64 decode + size bound + typed error mapping ────

describe("kbIngestRouter — ingestVideo input validation + error mapping", () => {
  const videoInput = { corpus: "vendor-x-manuals", filename: "onboarding.mp4", base64: SMALL_VIDEO_B64 };

  it("rejects an oversized decoded video payload (PAYLOAD_TOO_LARGE)", async () => {
    const original = process.env.KB_INGEST_MAX_VIDEO_UPLOAD_BYTES;
    process.env.KB_INGEST_MAX_VIDEO_UPLOAD_BYTES = "16"; // 16 bytes cap
    try {
      vi.resetModules();
      const { kbIngestRouter: freshRouter } = await import("./kbIngestRouter");
      const caller = freshRouter.createCaller({
        user: { id: 1, role: "admin", name: "Tester", twoFactorEnabled: true },
      } as any);
      const bigB64 = Buffer.from("x".repeat(1000)).toString("base64");
      await expect(caller.ingestVideo({ ...videoInput, base64: bigB64 })).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
      });
    } finally {
      if (original === undefined) delete process.env.KB_INGEST_MAX_VIDEO_UPLOAD_BYTES;
      else process.env.KB_INGEST_MAX_VIDEO_UPLOAD_BYTES = original;
    }
  });

  it("rejects an empty video payload (base64 that decodes to zero bytes)", async () => {
    await expect(
      callerFor("admin", true).ingestVideo({ ...videoInput, base64: " " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ingestVideoMock).not.toHaveBeenCalled();
  });

  it("SttUnavailableError ⇒ SERVICE_UNAVAILABLE", async () => {
    ingestVideoMock.mockRejectedValueOnce(new SttUnavailableError());
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("SttValidationError ⇒ BAD_REQUEST", async () => {
    ingestVideoMock.mockRejectedValueOnce(new SttValidationError("video too large"));
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("SttTranscribeError ⇒ INTERNAL_SERVER_ERROR", async () => {
    ingestVideoMock.mockRejectedValueOnce(new SttTranscribeError("whisper.cpp exited with code 1"));
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("KbEmbedError ⇒ INTERNAL_SERVER_ERROR", async () => {
    ingestVideoMock.mockRejectedValueOnce(new KbEmbedError("model not loaded"));
    await expect(callerFor("admin", true).ingestVideo(videoInput)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("happy path passes corpus/video.filename/video.buffer/userId/language through to ingestVideo", async () => {
    await callerFor("admin", true).ingestVideo({ ...videoInput, language: "vi" });
    expect(ingestVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        corpus: "vendor-x-manuals",
        userId: 1,
        language: "vi",
        video: expect.objectContaining({ filename: "onboarding.mp4" }),
      }),
    );
    const call = ingestVideoMock.mock.calls[0]![0];
    expect(Buffer.isBuffer(call.video.buffer)).toBe(true);
  });
});

// ─── happy path wires ctx.user.id through ────────────────────────────────────

describe("kbIngestRouter — happy path", () => {
  it("passes corpus/sourceType/sourceRef/buffer/userId through to ingestDocument", async () => {
    await callerFor("admin", true).uploadDocument(validInput);
    expect(ingestDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        corpus: "vendor-x-manuals",
        sourceType: "application/pdf",
        sourceRef: "manual.pdf",
        userId: 1,
      }),
    );
  });
});
