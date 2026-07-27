/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — kbIngestRouter.ts unit tests.
 *
 * `../services/kbIngestService` is fully mocked (no real parse/embed/DB work); this file
 * covers ONLY the router's own responsibilities: admin/engineer RBAC (+2FA), the
 * KB_STUDIO_ENABLED gate checked BEFORE decoding the payload, base64 decode + size bound,
 * the MIME/extension allowlist checked before any heavy work, and the typed-error →
 * TRPCError code mapping.
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

import { kbIngestRouter } from "./kbIngestRouter";
import { KbIngestDisabledError, KbIngestValidationError, KbEmbedError, KbStoreError } from "../services/kbIngestService";
import { KbUnsupportedTypeError, KbParseError } from "../services/kbDocParser";

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

beforeEach(() => {
  vi.clearAllMocks();
  isKbStudioEnabledMock.mockReturnValue(true);
  ingestDocumentMock.mockResolvedValue({
    corpus: "vendor-x-manuals",
    sourceRef: "manual.pdf",
    chunksAdded: 3,
    parsedMeta: { sourceType: "pdf", charCount: 100, truncated: false },
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
    expect(status).toMatchObject({ enabled: true, allowedTypes: ["pdf", "docx", "md", "txt"] });
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
