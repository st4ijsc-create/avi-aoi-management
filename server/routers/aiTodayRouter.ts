/**
 * AI "Today" Router — role-aware, zero-click login briefing.
 *
 * Design ref: docs/ECOSYSTEM/05_AI_MINIMAL_EFFORT_UX_IDEAS_2026-06.md (§2).
 *
 * Single READ-ONLY query: get() → a role-routed, severity-aware summary for the
 * CURRENT user (ctx.user). Composes the existing analytics/PdM/anomaly services
 * (see server/services/aiTodayBriefing.ts). Fully fail-safe — the service never
 * throws; a failing source degrades that section + adds a soft warning.
 *
 * Register in server/routers.ts as key "aiToday".
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { buildTodayBriefing, type BriefingLang } from "../services/aiTodayBriefing";

function langOf(input: { lang?: string } | undefined): BriefingLang {
  const l = input?.lang;
  return l === "en" || l === "zh" ? l : "vi";
}

export const aiTodayRouter = router({
  /** The personalized "Today" briefing for the current user (zero-click). */
  get: protectedProcedure
    .input(z.object({ lang: z.enum(["vi", "en", "zh"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const u = ctx.user as { id: number; role: string; name?: string | null };
      return buildTodayBriefing({ id: u.id, role: String(u.role), name: u.name ?? null }, langOf(input));
    }),
});
