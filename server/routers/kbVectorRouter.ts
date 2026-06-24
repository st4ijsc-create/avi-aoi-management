/**
 * Phase 4 WS4.1 — KB vector store router: ingest (admin) + similarity search.
 * The legacy file-based KB Q&A (aiLocalKbRouter) is unchanged; this is the
 * production pgvector path, activated by KB_PGVECTOR_ENABLED.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";

export const kbVectorRouter = router({
  status: protectedProcedure.query(async () => {
    const { isKbPgvectorEnabled } = await import("../services/kb/kbVectorStore");
    return { enabled: isKbPgvectorEnabled() };
  }),

  ingest: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100000).optional() }).optional())
    .mutation(async ({ input }) => {
      const { ingestKbChunks } = await import("../services/kb/kbVectorStore");
      return ingestKbChunks({ limit: input?.limit });
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1), topK: z.number().min(1).max(20).default(5) }))
    .query(async ({ input }) => {
      const { searchKb } = await import("../services/kb/kbVectorStore");
      return searchKb(input.query, input.topK);
    }),
});
