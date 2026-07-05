/**
 * Doc 34 · P1 — PROGRAMMING Knowledge Base tRPC router.
 *
 * Read surface over `aiProgrammingKnowledgeService` (the vendor-manual retrieval
 * corpus, PARALLEL to the ops KB). All procedures are gated with
 * `machine_monitoring / canView` — the SAME permission the programming pages
 * (`/ir-editor`, `/pou-studio`) already require, so this router is visible to
 * exactly the engineers who use the programming tools.
 *
 *   • search       — retrieve page-cited programming context (query/vendor?/lang?/topK?)
 *   • collections  — manifest + live summary of the corpus (per-vendor)
 *   • reload       — clear the in-memory cache & re-read from disk (admin/maintenance)
 *
 * SAFETY: retrieval-only. This router NEVER synthesises an answer with an LLM
 * (that is P2, aiProgrammingCopilot) and opens NO device path. The service itself
 * is gated behind PROG_KB_ENABLED (default false) → when off, `search` returns a
 * well-formed EMPTY result rather than erroring. ctx.user is the source of truth.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  searchProgrammingKb,
  getProgrammingKbStatus,
  reloadProgrammingKb,
} from "../services/aiProgrammingKnowledgeService";

const SearchInput = z.object({
  query: z.string().min(1, "query required").max(2000),
  vendor: z.string().max(120).optional(),
  lang: z.string().max(16).optional(),
  topK: z.number().int().min(1).max(20).default(8),
});

export const aiProgrammingKbRouter = router({
  /**
   * Retrieve + assemble page-cited programming context. Read-only; returns an
   * empty (but well-formed) result when PROG_KB_ENABLED is off or the corpus is
   * empty. Optional vendor/lang metadata pre-filter.
   */
  search: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(SearchInput)
    .query(async ({ input }) =>
      searchProgrammingKb({
        query: input.query,
        vendor: input.vendor,
        lang: input.lang,
        topK: input.topK,
      }),
    ),

  /** Manifest + live per-vendor summary of the programming corpus. */
  collections: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => getProgrammingKbStatus()),

  /** Clear the in-memory cache and reload collections from disk. */
  reload: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .mutation(() => reloadProgrammingKb()),
});
