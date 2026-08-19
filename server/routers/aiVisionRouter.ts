/**
 * AI Vision Router (P4-F "vision-close-loop" + consolidation)
 *
 * ① CLOSE THE LOOP — propose a defect record from a vision/anomaly finding.
 *    A finding from any vision tool (advanced vision lab / anomaly /
 *    segmentation / image search / vision-language) can be turned into an
 *    inspection defect record. The write NEVER happens here: proposeDefect
 *    creates a pending HITL action (aiCopilotActions.proposeAction →
 *    propose_defect_from_vision tool) and returns its actionId. The UI then
 *    confirms via the EXISTING aiCopilot.confirmAction (token == actionId).
 *    On confirm the defect is written into measurement_results.defectCatalogId
 *    (attach to an existing result, or create a new NG result) — audit-logged,
 *    RBAC-gated (history_correct = admin/supervisor/quality_inspector).
 *
 *    suggestDefectCodes — best-effort map a free-text finding → IPC defect
 *    codes (defect_catalog). The user can override the chosen code in the
 *    confirm dialog (defectCatalogId is part of the proposed args).
 *
 *    defectCodes — passthrough catalog list for the override picker.
 *
 * ② CONSOLIDATION — the 5 sprawling vision routers are re-mounted as
 *    sub-namespaces under `aiVision.*` (aiVision.advanced, aiVision.anomaly,
 *    aiVision.segmentation, aiVision.imageSearch, aiVision.language) so new
 *    callers have one entry point. The ORIGINAL top-level namespaces
 *    (aiAdvancedVision, aiAnomaly, …) are kept in routers.ts for backward
 *    compatibility — nothing the frontend currently calls is renamed.
 */

import { z } from "zod";
import { protectedProcedure as thuTucVanHanh, moduleProcedure, router } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
import { proposeAction, type CopilotUser } from "../services/aiCopilotActions";
import { getTool, isWriteTool } from "../services/aiLocalTools/toolRegistry";
import type { ToolLang } from "../services/aiLocalTools";
import { mapVisionFindingToDefect } from "../services/visionDefectProposal";
// Side-effect import: registers the propose_defect_from_vision write tool.
import "../services/visionDefectProposal";
import { listDefectCatalog } from "../db/product";

// Existing vision routers — re-mounted as sub-namespaces (consolidation).
import { aiAdvancedVisionRouter } from "./aiAdvancedVisionRouter";
import { aiAnomalyRouter } from "./aiAnomalyRouter";
import { aiSegmentationRouter } from "./aiSegmentationRouter";
import { aiImageSearchRouter } from "./aiImageSearchRouter";
import { aiVisionLanguageRouter } from "./aiVisionLanguageRouter";

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

function toCopilotUser(user: { id: number; role: string; name?: string | null }): CopilotUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

const sourceSchema = z
  .enum(["advanced_vision", "anomaly", "segmentation", "image_search", "vision_language"])
  .default("advanced_vision");

export const aiVisionRouter = router({
  // ── Best-effort map a finding's free text → IPC defect codes ────────────────
  // ⚠ CỐ Ý **KHÔNG** khoá: đây là phép khớp CHUỖI thuần trên `defect_catalog` — dữ liệu chủ VẬN
  //   HÀNH, không một lượt suy luận nào. Khoá một lượt đọc danh mục là khoá dữ liệu của khách.
  suggestDefectCodes: thuTucVanHanh
    .input(
      z.object({
        findingText: z.string().min(1).max(500),
        category: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    )
    .query(async ({ input }) => {
      const matches = await mapVisionFindingToDefect(input.findingText, {
        category: input.category,
        limit: input.limit,
      });
      return { matches };
    }),

  // ── Catalog passthrough for the override picker ─────────────────────────────
  // ⚠ CỐ Ý **KHÔNG** khoá: `listDefectCatalog()` — danh mục mã lỗi, dữ liệu chủ VẬN HÀNH.
  defectCodes: thuTucVanHanh
    .input(
      z
        .object({
          category: z.string().optional(),
          severity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const rows = await listDefectCatalog(input);
      return rows.map((c: any) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        nameVi: c.nameVi ?? null,
        category: c.category,
        severity: c.severity,
        ipcReference: c.ipcReference ?? null,
      }));
    }),

  // ── Propose a defect from a vision finding (HITL — NO direct write) ──────────
  proposeDefect: protectedProcedure
    .input(
      z
        .object({
          // Target — attach OR create:
          measurementResultId: z.number().int().positive().nullable().optional(),
          inspectionId: z.number().int().positive().nullable().optional(),
          pointDefId: z.number().int().positive().nullable().optional(),
          // Classification (user-resolved/overridden).
          defectCatalogId: z.number().int().positive(),
          // Provenance.
          source: sourceSchema,
          findingText: z.string().max(500).optional(),
          confidence: z.number().min(0).max(1).nullable().optional(),
          // Optional location on the board image.
          bbox: z
            .object({
              x: z.number().int().min(0),
              y: z.number().int().min(0),
              w: z.number().int().positive(),
              h: z.number().int().positive(),
            })
            .nullable()
            .optional(),
          imageKey: z.string().max(255).nullable().optional(),
          lang: langSchema.optional(),
        })
        .refine(
          (v) => !!v.measurementResultId || (!!v.inspectionId && !!v.pointDefId),
          { message: "Provide measurementResultId (attach) OR inspectionId + pointDefId (create)" },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      const lang: ToolLang = input.lang ?? "vi";
      const user = toCopilotUser(ctx.user as any);

      const tool = getTool("propose_defect_from_vision");
      if (!tool || !isWriteTool(tool)) {
        return {
          ok: false as const,
          reason: "TOOL_UNAVAILABLE",
          message: "Công cụ đề xuất lỗi từ thị giác không khả dụng.",
        };
      }

      const { lang: _omit, ...rest } = input;
      // Re-validate against the tool's own bounds (defense in depth).
      const parsed = (tool.parameters as z.ZodType<any>).safeParse(rest);
      if (!parsed.success) {
        return {
          ok: false as const,
          reason: "ARGS_INVALID",
          message: "Tham số đề xuất không hợp lệ.",
        };
      }

      const res = await proposeAction(tool, parsed.data as Record<string, unknown>, {
        user,
        lang,
        req: {
          ip: (ctx.req as any)?.ip,
          headers: (ctx.req as any)?.headers,
          socket: (ctx.req as any)?.socket,
        },
      });
      if (!res.ok || !res.pendingAction) {
        return {
          ok: false as const,
          reason: res.reason ?? "PROPOSE_FAILED",
          denied: res.denied ?? false,
          message: res.message,
        };
      }
      return {
        ok: true as const,
        actionId: res.pendingAction.actionId,
        token: res.pendingAction.token,
        summary: res.pendingAction.summary,
        preview: res.pendingAction.preview,
        expiresAt: res.pendingAction.expiresAt,
      };
    }),

  // ── Consolidation: existing vision routers as sub-namespaces ─────────────────
  advanced: aiAdvancedVisionRouter,
  anomaly: aiAnomalyRouter,
  segmentation: aiSegmentationRouter,
  imageSearch: aiImageSearchRouter,
  language: aiVisionLanguageRouter,
});
