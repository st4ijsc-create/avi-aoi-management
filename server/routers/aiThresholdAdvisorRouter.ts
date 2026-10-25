/**
 * AI Threshold / Param Advisor Router (LUỒNG ② — Technician Copilot).
 *
 * Read-only recommendations + one HITL apply path for NG thresholds:
 *   - recommendForPoint        → LSL/USL/target for a measurement point.
 *   - recommendNgThreshold     → warning/critical % for an NG threshold.
 *   - recommendInspectionParam → minSampleSize/cooldown for an NG threshold.
 *   - applyNgThreshold         → proposeAction(adjust_ng_threshold) → returns
 *                                actionId. The UI then confirms via the EXISTING
 *                                aiCopilot.confirmAction (token == actionId).
 *
 * HITL is preserved: this router NEVER writes thresholds directly. The
 * measurement-point apply path stays in thresholdApproval (the UI calls that),
 * and the NG apply path is propose+confirm. Args are re-validated against the
 * tool's zod bounds before proposing (defense in depth).
 */

import { z } from "zod";
import { mqttNgRateThresholds } from "../../drizzle/schema";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { dieuKienViTriTrongPhamVi, idsMayTrongPhamVi } from "./_adapterPhamVi";
import type { PhamViAdvisor } from "../services/aiThresholdAdvisor";
import { protectedProcedure, router } from "../_core/trpc";
import {
  recommendForMeasurementPoint,
  recommendNgThreshold,
  recommendInspectionParam,
} from "../services/aiThresholdAdvisor";
import { proposeAction, type CopilotUser } from "../services/aiCopilotActions";
import { getTool, isWriteTool } from "../services/aiLocalTools/toolRegistry";
import type { ToolLang } from "../services/aiLocalTools";

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

function toCopilotUser(user: { id: number; role: string; name?: string | null }): CopilotUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

/** phạm vi người dùng (L6b 2026-10-25): phạm vi người gọi cho advisor (máy trong phạm vi, luật sản phẩm, ngưỡng NG theo trạm/máy). */
async function pvAdvisor(ctx: CoDanhTinh): Promise<PhamViAdvisor> {
  const scope = phamViCua(ctx);
  return {
    idsMay: await idsMayTrongPhamVi(ctx),
    scope,
    congNg: await dieuKienViTriTrongPhamVi(scope, { stationId: mqttNgRateThresholds.stationId, machineId: mqttNgRateThresholds.machineId }),
  };
}

export const aiThresholdAdvisorRouter = router({
  // ── Measurement-point limits (LSL/USL/target) ───────────────────────────────
  recommendForPoint: protectedProcedure
    .input(
      z.object({
        measurementPointId: z.number().int().positive(),
        productModelId: z.number().int().positive().optional(),
        machineId: z.number().int().positive().optional(),
        windowSize: z.number().int().positive().max(20000).optional(),
        windowDays: z.number().int().positive().max(365).optional(),
      }),
    )
    .query(async ({ input, ctx }) => recommendForMeasurementPoint(input, await pvAdvisor(ctx))),

  // ── NG-rate threshold (warning/critical %) ──────────────────────────────────
  recommendNgThreshold: protectedProcedure
    .input(
      z.object({
        ngThresholdId: z.number().int().positive(),
        windowDays: z.number().int().positive().max(365).optional(),
        minSampleDays: z.number().int().positive().max(365).optional(),
      }),
    )
    .query(async ({ input, ctx }) => recommendNgThreshold(input, await pvAdvisor(ctx))),

  // ── Inspection params (minSampleSize / cooldown) ────────────────────────────
  recommendInspectionParam: protectedProcedure
    .input(
      z.object({
        ngThresholdId: z.number().int().positive(),
        windowDays: z.number().int().positive().max(365).optional(),
      }),
    )
    .query(async ({ input, ctx }) => recommendInspectionParam(input, await pvAdvisor(ctx))),

  // ── Apply NG threshold via HITL (propose → UI confirms with aiCopilot.confirmAction) ──
  applyNgThreshold: protectedProcedure
    .input(
      z.object({
        ngThresholdId: z.number().int().positive(),
        warningThreshold: z.number().min(0).max(100).optional(),
        criticalThreshold: z.number().min(0).max(100).optional(),
        lang: langSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const lang: ToolLang = input.lang ?? "vi";
      const user = toCopilotUser(ctx.user as any);

      const tool = getTool("adjust_ng_threshold");
      if (!tool || !isWriteTool(tool)) {
        return { ok: false as const, reason: "TOOL_UNAVAILABLE", message: "Công cụ điều chỉnh ngưỡng NG không khả dụng." };
      }

      const args: Record<string, unknown> = { thresholdId: input.ngThresholdId };
      if (input.warningThreshold !== undefined) args.warningThreshold = input.warningThreshold;
      if (input.criticalThreshold !== undefined) args.criticalThreshold = input.criticalThreshold;

      // Re-validate against the tool's bounds (defense in depth) before proposing.
      const parsed = (tool.parameters as z.ZodType<any>).safeParse(args);
      if (!parsed.success) {
        return { ok: false as const, reason: "ARGS_OUT_OF_BOUNDS", message: "Giá trị đề xuất vượt giới hạn cho phép." };
      }

      const res = await proposeAction(tool, parsed.data as Record<string, unknown>, { user, lang });
      if (!res.ok || !res.pendingAction) {
        return { ok: false as const, reason: res.reason ?? "PROPOSE_FAILED", message: res.message };
      }
      return { ok: true as const, actionId: res.pendingAction.actionId, summary: res.pendingAction.summary };
    }),
});
