/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio MANAGEMENT router: corpus registry +
 * job-tracked ingest + a chunk-sample "Eval-lite" preview, layered over E3-1's synchronous,
 * un-registered `kbIngestRouter` (uploadDocument/ingestUrl) + E3-1's `kb_studio_chunks` store.
 *
 * This router does NOT reimplement parse/chunk/embed/store: `ingestDocumentJob` /
 * `ingestUrlJob` call the EXACT SAME `kbIngestService.ingestDocument` / `kbWebFetcher.ingestUrl`
 * that `kbIngestRouter.ts` calls — the only addition is job bookkeeping (insert a `kb_ingest_jobs`
 * row 'running' BEFORE the call, update it 'succeeded'/'failed' after) around that existing call,
 * plus a `kb_corpora` registry (server/services/kbStudioService.ts).
 *
 * Gates (mirrors kbIngestRouter.ts's kbStudioProcedure exactly for everything except
 * `deleteCorpus`):
 *  - RBAC: `roleProcedure("admin", "engineer").use(require2FA)` for reads/creates/ingest.
 *    `deleteCorpus` is NARROWER — admin-only (`roleProcedure("admin").use(require2FA)`),
 *    mirroring aiModelRouter's `activateVersion`/`promoteStage` and aiAgentRouter's
 *    `killSwitchProcedure`: a destructive, cross-document delete is an admin decision even
 *    though day-to-day corpus/ingest management is admin+engineer.
 *  - `KB_STUDIO_ENABLED` gates the two ingest mutations ONLY (checked here BEFORE any decode/
 *    fetch/DB work, same as kbIngestRouter) — `listCorpora`/`listJobs`/`createCorpus`/
 *    `deleteCorpus`/`corpusPreview` are pure registry/read operations and stay usable even
 *    while ingest itself is flag-disabled (e.g. to clean up a corpus, or review history from
 *    when the flag was on). The FE determines the flag state via the EXISTING
 *    `trpc.kbIngest.status` query (brief-sanctioned reuse — no duplicate status endpoint here).
 *
 * Fail-safe: every query/mutation in this file is safe to call against an unmigrated
 * kb_corpora/kb_ingest_jobs (pg 42P01) — see server/services/kbStudioService.ts's module doc
 * comment for the exact read-vs-write triage. The two ingest mutations NEVER let a missing
 * registry table block the actual ingest (job tracking degrades to `jobId: null`).
 *
 * doc69 E3-6 addendum — `startFinetune` wires the Training Studio "Model Builder" tab's LoRA
 * fine-tune subsystem (`server/services/aiLlmFinetuneSidecar.ts`) behind the SAME admin/engineer
 * + 2FA gate as the rest of this router. See that module's doc comment for the full
 * mirror-of-localSidecarTrainer protocol, the never-auto-activate discipline, and the honest
 * "LoRA=style, not facts" framing. The client-side `ModelBuilderTab.tsx` placeholder is NOT
 * wired to this endpoint in this task (left as a documented fast-follow per the brief) — this
 * endpoint is the deliverable.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, roleProcedure, require2FA } from "../_core/trpc";
import { appError } from "../_core/appError";
import { rethrowDbError } from "../_core/dbErrors";
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
import * as kbStudioService from "../services/kbStudioService";
import { KbStudioTableUnavailableError, KbCorpusNotFoundError } from "../services/kbStudioService";
import { startLoraFinetune, LoraFinetuneUnavailableError, LoraFinetuneError } from "../services/aiLlmFinetuneSidecar";
import * as kbStudioEval from "../services/kbStudioEval";
import { kiemSauNap, kiemKhiKhongCoChu } from "../services/kbKiemSauNap";
import {
  KbEvalBoVangVangError,
  KbEvalBoVangLoiError,
  KbEvalDangChayError,
  KbEvalBangVangError,
} from "../services/kbStudioEval";
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

/** R4 — job thất bại vì KHÔNG trích được chữ vẫn mang kết quả kiểm máy (vd cờ PDF quét ảnh); lỗi khác ⇒ null. */
function ketQuaMayKhiLoi(err: unknown) {
  return err instanceof KbIngestValidationError && err.meta ? kiemKhiKhongCoChu(err.meta) : null;
}
/** deleteCorpus only — see module doc comment for why this is narrower than the rest. */
const kbStudioDeleteProcedure = roleProcedure("admin").use(require2FA);

/** SAME bound + env knob as kbIngestRouter.ts's uploadDocument — one shared budget for a
 * decoded document payload, regardless of which router the upload came through. */
const MAX_UPLOAD_BYTES = (() => {
  const n = Number(process.env.KB_INGEST_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 20 * 1024 * 1024;
})();

/** Duplicated (not imported) from kbIngestRouter.ts, which doesn't export it — this is
 * request-decoding boilerplate, not ingest logic (parse/chunk/embed/store stay in the
 * EXISTING services and are never reimplemented). */
function decodeBase64Doc(b64: string): Buffer {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileContent" }, "Invalid base64 document payload");
  }
  if (buf.length === 0) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "fileContent" }, "Empty document payload");
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    // Sprint 5 §4 (Task 3) — trước đây "Document exceeds 20971520 bytes" (byte thô).
    throw buildTooLargeError(MAX_UPLOAD_BYTES);
  }
  return buf;
}

/** Same typed-error → TRPCError mapping as kbIngestRouter.uploadDocument, reused for
 * ingestDocumentJob's catch path (after the job has already been marked failed).
 * `sourceRef` is threaded through (this function is module-level, not a closure over the
 * mutation's `input`) so KB_NO_TEXT_EXTRACTED can carry the real document/source name — see
 * task-3-report.md Step 1 for why KbIngestValidationError is safe to treat as "no text" here. */
function mapIngestDocumentError(err: unknown, sourceRef: string): never {
  if (err instanceof TRPCError) throw err;
  // KbIngestDisabledError KHÔNG nằm trong 7 nhóm Task 3 di trú — giữ nguyên như cũ.
  if (err instanceof KbIngestDisabledError) {
    throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "kbStudioIngest" }, err.message);
  }
  if (err instanceof KbUnsupportedTypeError) {
    throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
  }
  if (err instanceof KbIngestValidationError) {
    throw buildNoTextError(sourceRef);
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
  throw err as Error;
}

/** Same typed-error → TRPCError mapping as kbIngestRouter.ingestUrl, reused for
 * ingestUrlJob's catch path. `url` threaded through for the same reason as `sourceRef` above. */
function mapIngestUrlError(err: unknown, url: string): never {
  if (err instanceof TRPCError) throw err;
  // KbIngestDisabledError KHÔNG nằm trong 7 nhóm Task 3 di trú — giữ nguyên như cũ.
  if (err instanceof KbIngestDisabledError) {
    throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "kbStudioIngest" }, err.message);
  }
  // Sprint 5 §4 (Task 3) — "tính năng chưa bật" là mã họ phổ quát FEATURE_DISABLED, không phải
  // một trong 6 mã KB tài liệu (theo gợi ý của brief).
  if (err instanceof WebIngestDisabledError) {
    throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "webIngest" }, err.message);
  }
  if (err instanceof SsrfBlockedError || err instanceof FetchError) {
    throw buildFetchFailedError(url, err.message);
  }
  if (err instanceof KbUnsupportedTypeError) {
    throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
  }
  if (err instanceof KbIngestValidationError) {
    throw buildNoTextError(url);
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
  throw err as Error;
}

export const kbStudioRouter = router({
  // ─── Corpus registry ──────────────────────────────────────────────────
  listCorpora: kbStudioProcedure.query(() => kbStudioService.listCorpora()),

  createCorpus: kbStudioProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await kbStudioService.createCorpus({
          name: input.name,
          description: input.description,
          createdBy: ctx.user?.id,
        });
      } catch (err) {
        if (err instanceof KbStudioTableUnavailableError) {
          // F6 (doc 71) — "bảng chưa migrate" chốt về FEATURE_NOT_CONFIGURED (KHÁC
          // OPERATION_FAILED cũ ở đây — đây là thiếu cấu hình/migration, không phải một
          // thao tác cụ thể thất bại). params đổi operation→feature theo appCode mới.
          throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "kbStudioRegistry" }, err.message);
        }
        rethrowDbError(err, { conflictMessage: `A corpus named "${input.name}" already exists.` });
      }
    }),

  /** Admin-only + 2FA (narrower than the rest of this router — see module doc comment).
   * Transactional (kbStudioService.deleteCorpus): removes the corpus's kb_studio_chunks rows
   * + kb_ingest_jobs rows + the kb_corpora registry row atomically. `confirm` must EXACTLY
   * match `name` — a server-side typed-confirm so a client-side bug (or a stale/forged
   * request) can never delete a corpus without the caller having echoed its exact name back. */
  deleteCorpus: kbStudioDeleteProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        confirm: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.confirm !== input.name) {
        throw appError(
          "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "confirm" },
          "Confirmation text does not match the corpus name — deletion refused.",
        );
      }
      try {
        const result = await kbStudioService.deleteCorpus(input.name);
        return { deleted: true as const, name: input.name, ...result };
      } catch (err) {
        if (err instanceof KbCorpusNotFoundError) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "kbCorpus" }, err.message);
        }
        if (err instanceof KbStudioTableUnavailableError) {
          // F6 (doc 71) — cùng lý do createCorpus ở trên: chốt FEATURE_NOT_CONFIGURED.
          throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "kbStudioRegistry" }, err.message);
        }
        throw err;
      }
    }),

  // ─── Ingest jobs ──────────────────────────────────────────────────────
  listJobs: kbStudioProcedure
    .input(
      z
        .object({
          corpus: z.string().trim().max(120).optional(),
          limit: z.number().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ input }) => kbStudioService.listJobs({ corpus: input?.corpus, limit: input?.limit })),

  /**
   * Job-tracked wrapper around E3-1's kbIngestService.ingestDocument — see the module doc
   * comment. Order of operations mirrors kbIngestRouter.uploadDocument EXACTLY through the
   * decode step (flag → MIME allowlist → base64 decode/bound), so a malformed request is
   * rejected BEFORE a job row is even created; only THEN is the corpus auto-registered and a
   * 'running' job inserted, ingestDocument called, and the job updated 'succeeded'/'failed'.
   * A throw from ingestDocument is caught, the job is marked 'failed' (best-effort — never
   * masks the real error), and the SAME typed-error mapping kbIngestRouter uses is re-applied
   * so this endpoint's error codes are indistinguishable from the E3-1 endpoint's.
   */
  ingestDocumentJob: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        sourceRef: z.string().trim().min(1).max(500),
        mimeOrExt: z.string().trim().min(1).max(200),
        base64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isKbStudioEnabled()) {
        throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "kbStudioIngest" }, "Knowledge & Training Studio ingest is disabled.");
      }
      try {
        normalizeSourceType(input.mimeOrExt);
      } catch (err) {
        if (err instanceof KbUnsupportedTypeError) {
          throw buildUnsupportedTypeError(err.input, KB_SUPPORTED_TYPES);
        }
        throw err;
      }
      const buffer = decodeBase64Doc(input.base64);

      await kbStudioService.ensureCorpusRegistered(input.corpus, ctx.user?.id);
      const jobResult = await kbStudioService.createJob({
        corpus: input.corpus,
        sourceType: input.mimeOrExt,
        sourceRef: input.sourceRef,
        createdBy: ctx.user?.id,
      });
      const jobId = jobResult.job?.id ?? null;

      try {
        const result = await ingestDocument({
          corpus: input.corpus,
          sourceType: input.mimeOrExt,
          sourceRef: input.sourceRef,
          buffer,
          userId: ctx.user?.id,
        });
        // R4 — kiểm máy sau nạp (mig 0360): trả cả về client để thẻ kết quả hiện cảnh báo ngay.
        const ketQuaMay = kiemSauNap(result.parsedMeta, result.chunksAdded);
        await kbStudioService.markJobSucceeded(jobId, result.chunksAdded, ketQuaMay);
        return { ...result, jobId, ketQuaMay };
      } catch (err) {
        await kbStudioService.markJobFailed(jobId, err instanceof Error ? err.message : String(err), ketQuaMayKhiLoi(err));
        mapIngestDocumentError(err, input.sourceRef);
      }
    }),

  /** Job-tracked wrapper around E3-3's kbWebFetcher.ingestUrl — same discipline as
   * ingestDocumentJob above (flag check → auto-register corpus → 'running' job → call →
   * 'succeeded'/'failed', never stuck). */
  ingestUrlJob: kbStudioProcedure
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

      await kbStudioService.ensureCorpusRegistered(input.corpus, ctx.user?.id);
      const jobResult = await kbStudioService.createJob({
        corpus: input.corpus,
        sourceType: "url",
        sourceRef: input.url,
        createdBy: ctx.user?.id,
      });
      const jobId = jobResult.job?.id ?? null;

      try {
        const result = await ingestUrl({ corpus: input.corpus, url: input.url, userId: ctx.user?.id });
        const ketQuaMay = kiemSauNap(result.parsedMeta, result.chunksAdded);
        await kbStudioService.markJobSucceeded(jobId, result.chunksAdded, ketQuaMay);
        return { ...result, jobId, ketQuaMay };
      } catch (err) {
        await kbStudioService.markJobFailed(jobId, err instanceof Error ? err.message : String(err), ketQuaMayKhiLoi(err));
        mapIngestUrlError(err, input.url);
      }
    }),

  // ─── Eval-lite ────────────────────────────────────────────────────────
  /** Reads a sample of kb_studio_chunks for `corpus` (+counts). NO embedding, NO model call —
   * a plain browse of what got ingested. The QUALITY measurement (golden set × real retrieval,
   * machine-graded, stored per run) is `evalCorpus` below (R1) — this stays the "what is in there"
   * view next to it. */
  corpusPreview: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        limit: z.number().min(1).max(50).optional(),
      }),
    )
    .query(({ input }) => kbStudioService.previewCorpus(input.corpus, input.limit ?? 20)),

  // ─── Eval thật (R1, kế hoạch AI Local 2026-09-22 §4) ─────────────────────
  /** Các bộ câu hỏi vàng trong `knowledge/studio-golden/*.jsonl` + số câu + số dòng lỗi (đọc tệp,
   * không model). */
  listGoldenSets: kbStudioProcedure.query(() => ({ sets: kbStudioEval.listBoVang() })),

  /**
   * Chạy một lượt eval — xem docblock `server/services/kbStudioEval.ts` (hai tầng: truy hồi corpus +
   * đường ống thật `retrieveKnowledge`). Đồng bộ trong request (≈ 1–3 s/câu khi bật tầng đường ống,
   * vì reranker chạy thật); một lượt tại một thời điểm. `callerRole` lấy từ PHIÊN (không từ body) —
   * đúng kỷ luật `KbQueryContext.callerRole`: tầng đường ống phải thấy Studio đúng như người gọi thấy.
   */
  evalCorpus: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        goldenSet: z.string().trim().min(1).max(120).optional(),
        k: z.number().int().min(1).max(20).optional(),
        pipeline: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await kbStudioEval.chayEval({
          corpus: input.corpus,
          boVang: input.goldenSet,
          k: input.k,
          duongOng: input.pipeline,
          callerRole: ctx.user?.role,
          userId: ctx.user?.id,
        });
      } catch (err) {
        if (err instanceof KbEvalBoVangVangError) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "kbGoldenSet" }, err.message);
        }
        if (err instanceof KbEvalBoVangLoiError) {
          const dau = err.loi[0];
          throw appError(
            "PRECONDITION_FAILED",
            "INVALID_VALUE",
            dau ? { field: "goldenSet", reason: `dòng ${dau.dong}: ${dau.lyDo}` } : { field: "goldenSet" },
            err.message,
          );
        }
        if (err instanceof KbEvalDangChayError) {
          throw appError("CONFLICT", "OPERATION_FAILED", { operation: "runKbEval", reason: "evalAlreadyRunning" }, err.message);
        }
        if (err instanceof KbEvalBangVangError) {
          throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "kbEvalRuns" }, err.message);
        }
        throw err;
      }
    }),

  /** Lịch sử lượt eval của một corpus (mới nhất trước), KHÔNG kèm kết quả từng câu. */
  listEvalRuns: kbStudioProcedure
    .input(z.object({ corpus: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(200).optional() }))
    .query(({ input }) => kbStudioEval.listEvalRuns(input.corpus, input.limit ?? 30)),

  /** Một lượt đầy đủ (kèm kết quả từng câu). Khoá theo cả `corpus` để một id đoán mò không đọc chéo. */
  getEvalRun: kbStudioProcedure
    .input(z.object({ id: z.number().int().positive(), corpus: z.string().trim().min(1).max(120) }))
    .query(({ input }) => kbStudioEval.getEvalRun(input.id, input.corpus)),

  // ─── Hồ sơ model (R3) ───────────────────────────────────────────────────
  /** Hồ sơ model THẬT (llama-server /props · .env · router · sổ đo B7 · báo cáo đo) — xem `ai/hoSoModelStudio.ts`. */
  hoSoModel: kbStudioProcedure.query(async () => {
    const { layHoSoModel } = await import("../services/ai/hoSoModelStudio");
    return layHoSoModel();
  }),

  // ─── Model Builder — LoRA fine-tune (doc69 E3-6) ─────────────────────────
  /**
   * Gated entry point for `server/services/aiLlmFinetuneSidecar.ts`'s `startLoraFinetune` — the
   * SAME admin/engineer + 2FA gate as the rest of this router (the brief's requirement is
   * "admin/engineer + require2FA", not the narrower admin-only gate `deleteCorpus` uses).
   * `startLoraFinetune` itself checks `isLlmFinetuneEnabled()` (LLM_FINETUNE_CMD) FIRST and
   * throws {@link LoraFinetuneUnavailableError} before touching the filesystem or DB when the
   * subsystem is off (default) — mapped to FORBIDDEN here, same shape as the KB_STUDIO_ENABLED/
   * WEB_INGEST_ENABLED gates above. This mutation AWAITS the full sidecar run (build data →
   * spawn → register → eval) and returns once it's done — it is not a fire-and-forget job
   * kickoff; a real GPU fine-tune is expected to take a while, which is an accepted ops
   * characteristic of this gated subsystem (not built as a background/polled job in this task).
   * NEVER activates the resulting model_versions row — see aiLlmFinetuneSidecar.ts's module doc
   * comment; activation is the separate, human-driven `aiModelRouter.activateVersion` /
   * `activateModelVersionManual` path.
   */
  startFinetune: kbStudioProcedure
    .input(
      z.object({
        baseModelId: z.number().int().positive(),
        corpus: z.string().trim().min(1).max(120),
        targetVersion: z.string().trim().min(1).max(50),
        hyperparams: z
          .object({
            rank: z.number().int().positive().max(256).optional(),
            alpha: z.number().int().positive().max(512).optional(),
            epochs: z.number().int().positive().max(50).optional(),
            learningRate: z.number().positive().max(1).optional(),
            quantization: z.enum(["none", "4bit", "8bit"]).optional(),
            maxSeqLen: z.number().int().positive().max(32768).optional(),
            batchSize: z.number().int().positive().max(256).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await startLoraFinetune({
          baseModelId: input.baseModelId,
          corpus: input.corpus,
          targetVersion: input.targetVersion,
          hyperparams: input.hyperparams,
          userId: ctx.user?.id,
        });
      } catch (err) {
        if (err instanceof LoraFinetuneUnavailableError) {
          throw appError("FORBIDDEN", "FEATURE_DISABLED", { feature: "loraFinetune" }, err.message);
        }
        if (err instanceof LoraFinetuneError) {
          throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "runLoraFinetune" }, err.message);
        }
        throw err;
      }
    }),
});
