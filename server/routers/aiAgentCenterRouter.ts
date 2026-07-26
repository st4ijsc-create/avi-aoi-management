/**
 * AI Agent Command Center Router (doc69 Giai đoạn 4 / Wave E2, task E2-1).
 *
 * Ops-scoped (admin/engineer — the roster is cross-user, same rationale as
 * aiAgentRouter's D4 `listAgentSessionsForOps`) READ endpoints over the roster
 * read-model in server/services/aiAgentCenterService.ts. NO writes, NO realtime
 * (Socket/SSE — that's E2-4), NO cost/savings model (E2-2 will ADD a `getSavings`
 * query to THIS SAME router — left room below, do not build it here).
 */
import { z } from "zod";
import { router, roleProcedure, moduleGate } from "../_core/trpc";
import { getRoster, getCommandCenterReadModel } from "../services/aiAgentCenterService";

/**
 * Cross-user roster visibility: admin/engineer ONLY (mirrors aiAgentRouter.ts's D4
 * `opsAgentProcedure = roleProcedure("admin", "engineer")` convention) PLUS the same
 * MOD_AI license/module gate every other AI router enforces (aiCopilotRouter.ts's
 * `moduleProcedure("MOD_AI")`). `roleProcedure(...)` is NOT built on top of
 * `moduleProcedure(...)`, so the module gate is composed the way server/_core/
 * trpc.ts's own moduleGate.ts docstring recommends: appended via `.use(moduleGate(...))`
 * onto an admin/role procedure (e.g. `adminProcedure.use(moduleGate('MOD_FEDERATION'))`).
 */
const opsAgentCenterProcedure = roleProcedure("admin", "engineer").use(moduleGate("MOD_AI"));

export const aiAgentCenterRouter = router({
  /** Bare roster (9 personas + Scheduled Agents) — no sessions/taskFeed. */
  getRoster: opsAgentCenterProcedure.query(async () => {
    return { roster: await getRoster() };
  }),

  /** Full read-model: roster + recent ops-scoped orchestrator sessions + unified task feed. */
  getReadModel: opsAgentCenterProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      return getCommandCenterReadModel({ limit: input?.limit });
    }),

  // E2-2 (doc69 Wave E2) will ADD a `getSavings` (token-cost / local-vs-cloud savings
  // meter) query HERE — deliberately not built by this task.
});
