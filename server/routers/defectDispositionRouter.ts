/**
 * W5-B (doc 27 §5 gap F2) — Defect disposition router (key "defectDisposition").
 *
 * Thin transport over defectDispositionService: create + status transitions
 * (mutations, quality roles) and inspection/queue reads (any authenticated
 * user). All business rules — soft-ref validation, legal-transition CONFLICT,
 * audit logging, re-inspect linkage — live in the service (unit-tested there).
 *
 * RBAC mirrors the neighbouring verdict actions (inspection.confirmNTF,
 * measurementResult.correctResult/classifyDefect): mutations use
 * qualityProcedure (admin | supervisor | quality_inspector, 2FA enforced),
 * reads use protectedProcedure.
 *
 * WORK-ORDER NOTE: `workOrderId` is a validated LINK-ONLY soft ref to an
 * existing maintenance_work_orders row. This router deliberately does NOT
 * create machine WOs for board repair — see the service header (MTTR/MTBF
 * pollution). Creating a machine WO stays with maintenance.createWorkOrder.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, moduleProcedure, qualityProcedure, roleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_QUALITY (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`
// (read surface). Write mutations keep their qualityProcedure role-floor + 2FA.
const protectedProcedure = moduleProcedure("MOD_QUALITY");
import {
  createDisposition,
  updateDispositionStatus,
  listDispositionsByInspection,
  listOpenDispositions,
  countOpenDispositions,
  getReInspectStatus,
  listRepairQueue,
  listDispositionsBySerial,
  getRepairStats,
  DispositionError,
  DEFECT_DISPOSITION_TYPES,
  DEFECT_DISPOSITION_STATUSES,
  LEGAL_TRANSITIONS,
} from "../services/defectDispositionService";

/**
 * W8-C (doc 27 V10) — repair-bench procedure: the REPAIR WALK (start repair /
 * mark repaired / send re-inspect) is the technician's job, so maintenance and
 * operator are allowed IN ADDITION to the quality roles. The quality-only
 * surface is untouched: `create` (the disposition DECISION) and `updateStatus`
 * (incl. closing) stay qualityProcedure. 2FA is still enforced for privileged
 * roles inside `transition` (mirrors _core require2FA — maintenance/operator
 * are not 2FA-mandated roles, same policy as operatorProcedure).
 */
const repairBenchProcedure = roleProcedure(
  "admin",
  "supervisor",
  "quality_inspector",
  "maintenance",
  "operator",
);
const TWO_FA_ROLES = new Set(["admin", "supervisor", "quality_inspector"]);
/** Repair-walk targets only — closing a disposition remains a quality decision. */
const REPAIR_TRANSITION_TARGETS = ["in_repair", "repaired", "re_inspect_pending"] as const;

/** Map the service's transport-agnostic error onto the right TRPC code. */
function rethrow(err: unknown): never {
  if (err instanceof DispositionError) {
    const code =
      err.code === "NOT_FOUND" ? "NOT_FOUND"
      : err.code === "CONFLICT" ? "CONFLICT"
      : err.code === "BAD_REQUEST" ? "BAD_REQUEST"
      : "INTERNAL_SERVER_ERROR";
    throw new TRPCError({ code, message: err.message });
  }
  throw err;
}

export const defectDispositionRouter = router({
  // ── create (write, quality roles) ─────────────────────────────────────────
  create: qualityProcedure
    .input(z.object({
      inspectionId: z.number().int().positive(),
      measurementResultId: z.number().int().positive().nullable().optional(),
      disposition: z.enum(DEFECT_DISPOSITION_TYPES),
      workOrderId: z.number().int().positive().nullable().optional(),
      assignee: z.number().int().positive().nullable().optional(),
      note: z.string().max(4000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await createDisposition(input, { id: ctx.user.id, name: ctx.user.name });
      } catch (err) {
        rethrow(err);
      }
    }),

  // ── status transition (write, quality roles) — illegal → CONFLICT ─────────
  updateStatus: qualityProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(DEFECT_DISPOSITION_STATUSES),
      assignee: z.number().int().positive().nullable().optional(),
      note: z.string().max(4000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await updateDispositionStatus(input, { id: ctx.user.id, name: ctx.user.name });
      } catch (err) {
        rethrow(err);
      }
    }),

  // ── reads (any authenticated user) ─────────────────────────────────────────
  listByInspection: protectedProcedure
    .input(z.object({ inspectionId: z.number().int().positive() }))
    .query(({ input }) => listDispositionsByInspection(input.inspectionId)),

  listOpen: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(({ input }) => listOpenDispositions(input?.limit ?? 100)),

  countOpen: protectedProcedure.query(() => countOpenDispositions()),

  reInspectStatus: protectedProcedure
    .input(z.object({ inspectionId: z.number().int().positive() }))
    .query(({ input }) => getReInspectStatus(input.inspectionId)),

  // Legal-transition map so the client renders exactly the actions the server
  // will accept (single source of truth stays in the service).
  transitions: protectedProcedure.query(() => LEGAL_TRANSITIONS),

  // ── W8-C (doc 27 V10) — repair-station additions (all ADDITIVE) ────────────

  /** Enriched open queue for the repair-station lanes (machine/line/product context, oldest first). */
  repairQueue: protectedProcedure
    .input(
      z.object({
        machineId: z.number().int().positive().nullable().optional(),
        lineId: z.number().int().positive().nullable().optional(),
        disposition: z.enum(DEFECT_DISPOSITION_TYPES).nullable().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }).optional(),
    )
    .query(({ input }) => listRepairQueue(input ?? {})),

  /** Scan workflow: all dispositions of one serial (open + closed history), newest first. */
  listBySerial: protectedProcedure
    .input(z.object({ serial: z.string().trim().min(1).max(100) }))
    .query(({ input }) => listDispositionsBySerial(input.serial)),

  /** Stats strip: backlog by lane, repaired/closed today, avg time in repair (audit-derived). */
  repairStats: protectedProcedure.query(() => getRepairStats()),

  /**
   * Repair-walk transition (start repair / mark repaired / send re-inspect) for
   * the repair bench — maintenance/operator INCLUDED (see repairBenchProcedure
   * note). Same service path as updateStatus: legal-transition CONFLICT + audit.
   * Closing is NOT possible here (quality-only via updateStatus).
   */
  transition: repairBenchProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(REPAIR_TRANSITION_TARGETS),
      note: z.string().max(4000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Mirror _core require2FA for privileged roles (roleProcedure alone does not).
      if (TWO_FA_ROLES.has(ctx.user.role) && !ctx.user.twoFactorEnabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
        });
      }
      try {
        return await updateDispositionStatus(
          { id: input.id, status: input.status, note: input.note },
          { id: ctx.user.id, name: ctx.user.name },
        );
      } catch (err) {
        rethrow(err);
      }
    }),
});
