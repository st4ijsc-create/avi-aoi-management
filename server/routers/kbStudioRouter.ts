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
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, roleProcedure, require2FA } from "../_core/trpc";
import { rethrowDbError } from "../_core/dbErrors";
import { normalizeSourceType, KbUnsupportedTypeError, KbParseError } from "../services/kbDocParser";
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

const kbStudioProcedure = roleProcedure("admin", "engineer").use(require2FA);
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
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 document payload" });
  }
  if (buf.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Empty document payload" });
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: `Document exceeds ${MAX_UPLOAD_BYTES} bytes` });
  }
  return buf;
}

/** Same typed-error → TRPCError mapping as kbIngestRouter.uploadDocument, reused for
 * ingestDocumentJob's catch path (after the job has already been marked failed). */
function mapIngestDocumentError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof KbIngestDisabledError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  }
  if (err instanceof KbUnsupportedTypeError || err instanceof KbIngestValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof KbParseError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof KbEmbedError || err instanceof KbStoreError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  }
  throw err as Error;
}

/** Same typed-error → TRPCError mapping as kbIngestRouter.ingestUrl, reused for
 * ingestUrlJob's catch path. */
function mapIngestUrlError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof WebIngestDisabledError || err instanceof KbIngestDisabledError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  }
  if (
    err instanceof SsrfBlockedError ||
    err instanceof FetchError ||
    err instanceof KbUnsupportedTypeError ||
    err instanceof KbIngestValidationError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof KbParseError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof KbEmbedError || err instanceof KbStoreError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
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
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation text does not match the corpus name — deletion refused.",
        });
      }
      try {
        const result = await kbStudioService.deleteCorpus(input.name);
        return { deleted: true as const, name: input.name, ...result };
      } catch (err) {
        if (err instanceof KbCorpusNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        if (err instanceof KbStudioTableUnavailableError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
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
        throw new TRPCError({ code: "FORBIDDEN", message: "Knowledge & Training Studio ingest is disabled." });
      }
      try {
        normalizeSourceType(input.mimeOrExt);
      } catch (err) {
        if (err instanceof KbUnsupportedTypeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
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
        await kbStudioService.markJobSucceeded(jobId, result.chunksAdded);
        return { ...result, jobId };
      } catch (err) {
        await kbStudioService.markJobFailed(jobId, err instanceof Error ? err.message : String(err));
        mapIngestDocumentError(err);
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
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Web URL ingest is disabled (WEB_INGEST_ENABLED and/or KB_STUDIO_ENABLED is off).",
        });
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
        await kbStudioService.markJobSucceeded(jobId, result.chunksAdded);
        return { ...result, jobId };
      } catch (err) {
        await kbStudioService.markJobFailed(jobId, err instanceof Error ? err.message : String(err));
        mapIngestUrlError(err);
      }
    }),

  // ─── Eval-lite ────────────────────────────────────────────────────────
  /** Reads a sample of kb_studio_chunks for `corpus` (+counts). NO embedding, NO model call —
   * see server/services/kbStudioService.ts's previewCorpus doc comment. A full RAG-answer-
   * quality eval (does the model answer WELL from this corpus, not just "what got ingested")
   * needs a live embed/LLM model and a golden question/answer set, and is a documented OPS
   * STEP, not built here: `scripts/ai-kb/eval-rag.mjs` already implements exactly this
   * methodology (golden-set + recall@K, optional LLM reranker) against the file-based ops-KB
   * — an operator adapts/points that same harness at a Studio corpus's golden set (or writes
   * the small per-corpus variant) rather than this endpoint growing a second, live eval path. */
  corpusPreview: kbStudioProcedure
    .input(
      z.object({
        corpus: z.string().trim().min(1).max(120),
        limit: z.number().min(1).max(50).optional(),
      }),
    )
    .query(({ input }) => kbStudioService.previewCorpus(input.corpus, input.limit ?? 20)),
});
