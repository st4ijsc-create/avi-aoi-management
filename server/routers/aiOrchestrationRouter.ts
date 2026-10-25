/**
 * Phase E5 — Factory Control Plane: AI-ASSISTED ORCHESTRATION router (advisory).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over server/services/orchestration/aiOrchestrationAdvisor.ts. The AI
 * PROPOSES a multi-machine WorkflowDefinition (constrained to the workflow schema,
 * validated + simulated on the twin) — the human reviews it in the Studio and deploys
 * it SEPARATELY via orchestration.deployWorkflow (which carries its own RBAC + HITL).
 *
 * HITL ABSOLUTE — this router opens NO device path, issues NO command, and NEVER
 * calls deployWorkflow / startRun. It is ADVISORY/READ → RBAC machine_control/canView.
 * Flag-gated by AI_ORCHESTRATION_ADVISOR_ENABLED (off → an honest disabled result).
 *
 * Registration (routers.ts — reported, NOT edited here): key "aiOrchestration".
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { machines } from "../../drizzle/schema";
import { inArray } from "drizzle-orm";
import { idsMayTrongPhamVi } from "./_adapterPhamVi";
import {
  suggestWorkflow,
  optimizeWorkflow,
  advisorStatus,
  type AdvisorMachine,
  type AdvisorLang,
} from "../services/orchestration/aiOrchestrationAdvisor";
import type { WorkflowDefinition } from "../services/orchestration/foe/workflowModel";
import {
  queryByText,
  formatCausalContext,
  isCausalGraphEnabled,
} from "../services/aiCausalGraph";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

/** Load all machines as advisor rows (id + machineType + per-machine capability override). */
async function loadAdvisorMachines(idsMay: number[] | null = null): Promise<AdvisorMachine[]> {
  const d = await db();
  // phạm vi người dùng (L6b 2026-10-25): chỉ máy trong phạm vi (tên + năng lực máy đi vào lời nhắc LLM ⇒ không được chứa máy nhà máy khác)
  const rows = await d.select().from(machines).where(idsMay === null ? undefined : inArray(machines.id, idsMay.length > 0 ? idsMay : [-1]));
  return rows.map((m) => ({ id: m.id, name: m.name, machineType: m.machineType, capabilities: m.capabilities }));
}

/**
 * Build an optional RCA/causal-graph hint block from the defect/machine context, reusing
 * the existing causal graph (flag-gated by RAG_CAUSAL_GRAPH_ENABLED). Fail-safe → "".
 */
function buildCausalHint(defectType?: string, machineText?: string | null): string {
  if (!defectType || !isCausalGraphEnabled()) return "";
  try {
    return formatCausalContext(queryByText(defectType, machineText ?? null));
  } catch {
    return "";
  }
}

export const aiOrchestrationRouter = router({
  /** Whether the AI orchestration advisor flag is enabled (UI gating hint). */
  status: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(() => advisorStatus()),

  /**
   * SUGGEST a WorkflowDefinition for a goal/problem. Advisory/read (the human deploys
   * separately). The model only sees the eligible machines + their E0 capabilities; the
   * proposal is validated + simulated before return. NEVER deploys/runs.
   */
  suggestWorkflow: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(
      z.object({
        goal: z.string().max(2000).optional(),
        machineIds: z.array(z.number().int().positive()).max(64).optional(),
        context: z
          .object({
            defectType: z.string().max(200).optional(),
            incidentId: z.union([z.string().max(64), z.number()]).optional(),
            machineId: z.number().int().positive().optional(),
          })
          .optional(),
        lang: langSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const idsMay = await idsMayTrongPhamVi(ctx); // phạm vi người dùng (L6b 2026-10-25)
      const machineRows = await loadAdvisorMachines(idsMay);
      const trongPv = (id: number) => idsMay === null || idsMay.includes(id);
      // Optional RCA/causal-graph hint from the problem context (machine name → text match).
      const focus = input.context?.machineId
        ? machineRows.find((m) => m.id === input.context?.machineId)
        : undefined;
      const hint = buildCausalHint(input.context?.defectType, focus?.name ?? null);

      return suggestWorkflow({
        goal: input.goal,
        machineIds: input.machineIds ? input.machineIds.filter(trongPv) : input.machineIds,
        context: input.context ? { ...input.context, machineId: input.context.machineId != null && trongPv(input.context.machineId) ? input.context.machineId : undefined, hint: hint || undefined } : (hint ? { hint } : undefined),
        lang: input.lang as AdvisorLang,
        machines: machineRows,
      });
    }),

  /**
   * OPTIMIZE an existing WorkflowDefinition (parallelize / interlocks / reorder). Returns a
   * revised def + diff/rationale + a fresh simulation. Advisory/read; the human accepts +
   * deploys separately. NEVER deploys/runs.
   */
  optimizeWorkflow: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(
      z.object({
        workflow: z.record(z.string(), z.unknown()),
        goal: z.string().max(2000).optional(),
        lang: langSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      const machineRows = await loadAdvisorMachines(await idsMayTrongPhamVi(ctx)); // phạm vi người dùng (L6b 2026-10-25)
      return optimizeWorkflow({
        workflow: input.workflow as unknown as WorkflowDefinition,
        goal: input.goal,
        lang: input.lang as AdvisorLang,
        machines: machineRows,
      });
    }),
});
