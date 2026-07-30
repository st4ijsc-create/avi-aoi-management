/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — Knowledge & Training Studio upload endpoint.
 *
 * Minimal by design (per the task brief): a single bounded-base64 tRPC mutation that hands
 * the decoded file to kbIngestService.ingestDocument. E3-2 builds the full Studio UI
 * (Source/Jobs/Corpus/Eval) + corpus/job registry tables on top of this; this router's
 * surface is deliberately small so E3-2 stays additive.
 *
 * Gates (defense-in-depth, both layers independently enforce):
 *  - RBAC: admin/engineer only, mirrors server/routers/aiModelRouter.ts's
 *    `modelCardProcedure` (`roleProcedure("admin","engineer").use(require2FA)`) — both roles
 *    are PRIVILEGED_ROLES in _core/trpc.ts, so a fresh (non-2FA) session is rejected before
 *    ANY parsing/DB work.
 *  - Feature flag: `KB_STUDIO_ENABLED` (default OFF) is checked HERE (→ FORBIDDEN) before
 *    decoding the payload, AND again inside kbIngestService.ingestDocument (→
 *    KbIngestDisabledError, mapped to FORBIDDEN below) — so calling the service directly
 *    (as future callers/tests might) is just as safe as going through this router.
 *  - Bounds: `KB_INGEST_MAX_UPLOAD_BYTES` (default 20MB decoded) + a pdf/docx/md/txt
 *    extension/MIME allowlist, both checked BEFORE the (potentially large) payload is
 *    handed to the parser.
 *
 * `ingestUrl` (E3-3) reuses the SAME `kbStudioProcedure` gate, PLUS `WEB_INGEST_ENABLED`
 * (default OFF) checked here before any network I/O — see server/services/kbWebFetcher.ts for
 * the SSRF guard that unconditionally applies to every fetch it performs.
 *
 * `ingestVideo` (E3-4) reuses the SAME `kbStudioProcedure` gate, PLUS `VIDEO_INGEST_ENABLED`
 * (default OFF) checked here BEFORE decoding the (potentially large) base64 video payload — see
 * server/services/kbVideoTranscriber.ts for the ffmpeg+whisper.cpp sidecar pipeline and its
 * shell-injection-safety + fail-safe discipline.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, roleProcedure, require2FA } from "../_core/trpc";
import { appError } from "../_core/appError";
import {
  normalizeSourceType,
  KbUnsupportedTypeError,
  KbParseError,
  KbContentTypeMismatchError,
} from "../services/kbDocParser";
import {
  ingestDocument,
  isKbStudioEnabled,
  KbIngestDisabledError,
  KbIngestValidationError,
  KbEmbedError,
  KbStoreError,
} from "../services/kbIngestService";
import {
  ingestUrl,
  isWebIngestEnabled,
  WebIngestDisabledError,
  SsrfBlockedError,
  FetchError,
} from "../services/kbWebFetcher";
import {
  ingestVideo,
  isVideoIngestEnabled,
  VideoIngestDisabledError,
  SttUnavailableError,
  SttValidationError,
  SttTranscribeError,
} from "../services/kbVideoTranscriber";
import {
  buildTooLargeError,
  buildUnsupportedTypeError,
  buildContentTypeMismatchError,
  buildParseFailedError,
  buildNoTextError,
  buildFetchFailedError,
  KB_SUPPORTED_TYPES,
} from "./kbErrors";

const kbStudioProcedure = roleProcedure("admin", "engineer").use(require2FA);

const MAX_UPLOAD_BYTES = (() => {
  const n = Number(process.env.KB_INGEST_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 20 * 1024 * 1024;
})();

/** Separate, much higher cap for base64-encoded VIDEO payloads (default 300MB decoded) — kept
 * independent of MAX_UPLOAD_BYTES so operators can tune document vs video upload limits apart.
 * `kbVideoTranscriber.transcribeVideo` re-checks its OWN `VIDEO_INGEST_MAX_BYTES` bound too
 * (defense-in-depth, same layering as the KB_STUDIO_ENABLED gate). */
const MAX_VIDEO_UPLOAD_BYTES = (() => {
  const n = Number(process.env.KB_INGEST_MAX_VIDEO_UPLOAD_BYTES ?? 300 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 300 * 1024 * 1024;
})();

function decodeBase64Payload(b64: string, maxBytes: number, label: string): Buffer {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileContent" }, `Invalid base64 ${label} payload`);
  }
  if (buf.length === 0) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileContent" }, `Empty ${label} payload`);
  }
  if (buf.length > maxBytes) {
    // Sprint 5 §4 (Task 3) — trước đây "${label} exceeds ${maxBytes} bytes" (byte thô, không
    // phải "20 MB"). Dùng CHUNG một mã cho cả nhánh "Document" lẫn "Video" (`label` chỉ còn ảnh
    // hưởng tới 2 thông điệp validate phía trên — không đổi mã tRPC nào ở đây).
    throw buildTooLargeError(maxBytes);
  }
  return buf;
}

function decodeBase64Doc(b64: string): Buffer {
  return decodeBase64Payload(b64, MAX_UPLOAD_BYTES, "Document");
}

export const kbIngestRouter = router({
  /** Read-only status — reachable by any admin/engineer session (with 2FA), no DB touch. */
  status: kbStudioProcedure.query(() => ({
    enabled: isKbStudioEnabled(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    // Task 6, Wave 2 đường B: png/jpg/jpeg/webp added — server actually accepts these now
    // (kbDocParser.normalizeSourceType → "image" → kbImageDescriber VLM path), so `accept`
    // on the client's file input (SourceTab.tsx derives it straight from this array) must
    // reflect that truthfully.
    allowedTypes: ["pdf", "docx", "md", "txt", "png", "jpg", "jpeg", "webp"] as const,
    webIngestEnabled: isWebIngestEnabled(),
    videoIngestEnabled: isVideoIngestEnabled(),
    maxVideoUploadBytes: MAX_VIDEO_UPLOAD_BYTES,
  })),

  uploadDocument: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        sourceRef: z.string().trim().min(1).max(500),
        /** MIME type, bare/dotted extension, or filename — see kbDocParser.normalizeSourceType. */
        mimeOrExt: z.string().trim().min(1).max(200),
        /** Bounded base64 (optionally a data: URL) — see MAX_UPLOAD_BYTES for the DECODED cap. */
        base64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isKbStudioEnabled()) {
        throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "kbStudioIngest" }, "Knowledge & Training Studio ingest is disabled.");
      }

      // MIME/extension allowlist, checked BEFORE decoding the (possibly large) payload.
      // Sprint 5 §4 (Task 3) — trước đây `Unsupported document type: "pptx"` (tiếng Anh trần).
      try {
        normalizeSourceType(input.mimeOrExt);
      } catch (err) {
        if (err instanceof KbUnsupportedTypeError) {
          throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
        }
        throw err;
      }

      const buffer = decodeBase64Doc(input.base64);

      try {
        return await ingestDocument({
          corpus: input.corpus,
          sourceType: input.mimeOrExt,
          sourceRef: input.sourceRef,
          buffer,
          userId: ctx.user?.id,
        });
      } catch (err) {
        // KbIngestDisabledError KHÔNG nằm trong 7 nhóm Task 3 di trú (xem task-3-report.md
        // Step 1) — giữ nguyên như cũ.
        if (err instanceof KbIngestDisabledError) {
          throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "kbStudioIngest" }, err.message);
        }
        if (err instanceof KbUnsupportedTypeError) {
          throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
        }
        // KbIngestValidationError chỉ còn thực sự tới được đây qua nhánh "không còn chữ để nạp"
        // (`ingestDocument`'s "produced no extractable text"/"produced zero chunks"): zod đã bắt
        // corpus/sourceRef/base64 rỗng ở input schema phía trên trước khi service được gọi — xem
        // task-3-report.md mục Step 1 cho lý giải đầy đủ.
        if (err instanceof KbIngestValidationError) {
          throw buildNoTextError(input.sourceRef);
        }
        // I-2 fix round 1 — PHẢI đứng TRƯỚC nhánh KbParseError chung bên dưới: đây là lớp con
        // (extends KbParseError), đặt sau thì nhánh này không bao giờ chạy tới.
        if (err instanceof KbContentTypeMismatchError) {
          throw buildContentTypeMismatchError(err.claimed, err.detected);
        }
        if (err instanceof KbParseError) {
          throw buildParseFailedError(err.message);
        }
        if (err instanceof KbEmbedError || err instanceof KbStoreError) {
          throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "ingestKbDocument" }, err.message);
        }
        throw err;
      }
    }),

  /**
   * E3-3 — fetch a URL under kbWebFetcher's SSRF guard, extract text, feed ingestDocument.
   * Gated behind WEB_INGEST_ENABLED (checked HERE, before any network I/O) AND
   * KB_STUDIO_ENABLED (checked here AND again inside ingestUrl — same defense-in-depth
   * pattern as uploadDocument above). The SSRF guard itself has no bypass: it is not a flag,
   * it is unconditional inside kbWebFetcher.fetchUrlForIngest whenever this endpoint runs.
   */
  ingestUrl: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        url: z.string().trim().min(1).max(2000).url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isKbStudioEnabled() || !isWebIngestEnabled()) {
        throw appError(
          "FORBIDDEN",
          "FEATURE_DISABLED",
          { feature: "webIngest" },
          "Web URL ingest is disabled (WEB_INGEST_ENABLED and/or KB_STUDIO_ENABLED is off).",
        );
      }

      try {
        return await ingestUrl({ corpus: input.corpus, url: input.url, userId: ctx.user?.id });
      } catch (err) {
        // KbIngestDisabledError KHÔNG nằm trong 7 nhóm Task 3 di trú — giữ nguyên như cũ.
        if (err instanceof KbIngestDisabledError) {
          throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "kbStudioIngest" }, err.message);
        }
        // Sprint 5 §4 (Task 3) — "tính năng chưa bật" là mã họ phổ quát FEATURE_DISABLED (đã
        // đăng ký ở Task 1), không phải một trong 6 mã KB tài liệu (theo gợi ý của brief).
        if (err instanceof WebIngestDisabledError) {
          throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "webIngest" }, err.message);
        }
        // SsrfBlockedError (đích bị chặn) và FetchError (mọi lỗi fetch khác) đều là "không tải
        // được nội dung từ URL này" dưới góc nhìn người vận hành — gộp vào MỘT mã.
        if (err instanceof SsrfBlockedError || err instanceof FetchError) {
          throw buildFetchFailedError(input.url, err.message);
        }
        if (err instanceof KbUnsupportedTypeError) {
          throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
        }
        // Xem ghi chú tương tự ở uploadDocument: chỉ thực sự tới được đây qua nhánh "không còn
        // chữ để nạp" (trang lấy về rỗng) — corpus/url đã được zod bắt ở input schema.
        if (err instanceof KbIngestValidationError) {
          throw buildNoTextError(input.url);
        }
        // I-2 fix round 1 — PHẢI đứng TRƯỚC nhánh KbParseError chung bên dưới: đây là lớp con
        // (extends KbParseError), đặt sau thì nhánh này không bao giờ chạy tới.
        if (err instanceof KbContentTypeMismatchError) {
          throw buildContentTypeMismatchError(err.claimed, err.detected);
        }
        if (err instanceof KbParseError) {
          throw buildParseFailedError(err.message);
        }
        if (err instanceof KbEmbedError || err instanceof KbStoreError) {
          throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "ingestKbDocument" }, err.message);
        }
        throw err;
      }
    }),

  /**
   * E3-4 — transcribe a video locally (ffmpeg + whisper.cpp, fully offline — see
   * kbVideoTranscriber.ts's module doc comment for the shell-injection-safety + fail-safe
   * discipline) and feed the transcript into ingestDocument. Gated behind VIDEO_INGEST_ENABLED
   * (checked HERE, before decoding the base64 payload) AND KB_STUDIO_ENABLED (checked here AND
   * again inside ingestVideo — same defense-in-depth pattern as ingestUrl above). The video
   * bytes are base64, decoded + size-bounded BEFORE any sidecar work — mirrors uploadDocument's
   * decode-then-bound discipline, with a dedicated (larger) cap for video.
   */
  ingestVideo: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        /** Original filename — METADATA ONLY (ingest sourceRef + an extension hint for
         * ffmpeg's format probing). Never used to build a filesystem path. */
        filename: z.string().trim().min(1).max(500),
        /** Bounded base64 (optionally a data: URL) — see MAX_VIDEO_UPLOAD_BYTES for the
         * DECODED cap. */
        base64: z.string().min(1),
        /** whisper.cpp -l language code, or "auto" (default) for auto-detect. */
        language: z.string().trim().min(1).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isKbStudioEnabled() || !isVideoIngestEnabled()) {
        throw appError(
          "FORBIDDEN",
          "FEATURE_DISABLED",
          { feature: "videoIngest" },
          "Video ingest is disabled (VIDEO_INGEST_ENABLED and/or KB_STUDIO_ENABLED is off).",
        );
      }

      const buffer = decodeBase64Payload(input.base64, MAX_VIDEO_UPLOAD_BYTES, "Video");

      try {
        return await ingestVideo({
          corpus: input.corpus,
          video: { buffer, filename: input.filename },
          userId: ctx.user?.id,
          language: input.language,
        });
      } catch (err) {
        // VideoIngestDisabledError/KbIngestDisabledError/SttUnavailableError/SttValidationError/
        // SttTranscribeError KHÔNG nằm trong 7 nhóm Task 3 di trú — giữ nguyên như cũ.
        if (err instanceof VideoIngestDisabledError || err instanceof KbIngestDisabledError) {
          throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "videoIngest" }, err.message);
        }
        if (err instanceof SttUnavailableError) {
          throw appError("SERVICE_UNAVAILABLE", "FEATURE_DISABLED", { feature: "speechToText" }, err.message);
        }
        if (err instanceof SttValidationError) {
          throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "videoContent" }, err.message);
        }
        if (err instanceof KbUnsupportedTypeError) {
          throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
        }
        // Xem ghi chú ở uploadDocument/ingestUrl — chỉ thực sự tới được đây qua nhánh "không còn
        // chữ để nạp" (transcript rỗng). `input.filename` là "source" gần nhất router có sẵn.
        if (err instanceof KbIngestValidationError) {
          throw buildNoTextError(input.filename);
        }
        // I-2 fix round 1 — PHẢI đứng TRƯỚC nhánh KbParseError chung bên dưới: đây là lớp con
        // (extends KbParseError), đặt sau thì nhánh này không bao giờ chạy tới.
        if (err instanceof KbContentTypeMismatchError) {
          throw buildContentTypeMismatchError(err.claimed, err.detected);
        }
        if (err instanceof KbParseError) {
          throw buildParseFailedError(err.message);
        }
        if (err instanceof SttTranscribeError || err instanceof KbEmbedError || err instanceof KbStoreError) {
          throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "ingestKbDocument" }, err.message);
        }
        throw err;
      }
    }),
});
