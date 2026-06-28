/**
 * AI RCA Copilot Router (LUỒNG ③) — diagnose / latest / applyTopFix.
 *
 * - diagnose: run the RCA pipeline + persist → ranked result + rcaId.
 * - latest: recent persisted RCAs (optionally per machine).
 * - applyTopFix: propose (HITL) the top hypothesis's WRITE fix → returns the
 *   pending actionId. The UI confirms it via the EXISTING aiCopilot.confirmAction.
 *   This router NEVER auto-confirms/executes.
 *
 * Flag-gated inside the service (AI_RCA_COPILOT_ENABLED). The session user
 * (ctx.user) is the source of truth for ownership + RBAC re-check at confirm.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  runRca,
  persistRca,
  proposeTopFix,
  latestRca,
  runRcaInputSchema,
  type RcaResult,
} from "../services/aiRcaCopilot";
import type { ToolLang } from "../services/aiLocalTools";
import type { CopilotUser } from "../services/aiCopilotActions";

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

function toCopilotUser(user: { id: number; role: string; name?: string | null }): CopilotUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

export const aiRcaCopilotRouter = router({
  // Run RCA + persist → ranked result + rcaId.
  diagnose: protectedProcedure
    .input(runRcaInputSchema.extend({ lang: langSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const lang: ToolLang = input.lang ?? "vi";
      const user = ctx.user as any;
      const result: RcaResult = await runRca({
        machineId: input.machineId,
        defectType: input.defectType,
        incidentId: input.incidentId,
        lang,
      });
      const rcaId = result.ok && result.hypotheses.length > 0
        ? await persistRca({ result, requestedBy: user.id, requestedByName: user.name ?? null })
        : null;
      return { rcaId, ...result };
    }),

  // Recent persisted RCAs (optionally per machine).
  latest: protectedProcedure
    .input(z.object({ machineId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(50).optional() }))
    .query(async ({ input }) => {
      return latestRca(input.machineId, input.limit ?? 10);
    }),

  // Propose (HITL) the top fix → returns the pending actionId for the UI to
  // confirm via aiCopilot.confirmAction. Does NOT auto-confirm.
  applyTopFix: protectedProcedure
    .input(z.object({ rcaId: z.number().int().positive(), lang: langSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const lang: ToolLang = input.lang ?? "vi";
      const user = toCopilotUser(ctx.user as any);
      return proposeTopFix(input.rcaId, user, lang);
    }),
});
