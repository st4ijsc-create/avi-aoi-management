/**
 * Doc 24 / Connectivity — No-code Tag → UNS mapping designer router.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router ONLY manages CONFIGURATION (how a raw OT tag is reshaped +
 *     published to the UNS) and runs a PURE live preview. It NEVER writes a value
 *     to a machine and imports NO command dispatcher — there is no control path here.
 *   - Mappings are consulted at PUBLISH time only when UNS_MAPPING_ENABLED === "true"
 *     (default OFF ⇒ inert). They affect the READ direction (telemetry → UNS) only.
 * RBAC via module 'machine_control':
 *   list/get/preview  → canView
 *   create            → canCreate
 *   update            → canEdit
 *   delete            → canDelete
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  createMapping,
  listMappings,
  getMapping,
  updateMapping,
  deleteMapping,
  previewMapping,
  type ResolvedMapping,
} from "../services/unsMappingService";

const transformSchema = z
  .object({
    rename: z.string().max(255).optional(),
    scale: z.number().optional(),
    offset: z.number().optional(),
    unit: z.string().max(50).optional(),
    cast: z.enum(["number", "bool", "string"]).optional(),
    deadband: z.number().nonnegative().optional(),
  })
  .strict();

const scalarSchema = z.union([z.number(), z.string(), z.boolean()]);

const createInput = z.object({
  adapterId: z.number().int().positive(),
  tag: z.string().min(1).max(128),
  unsTopic: z.string().min(1).max(500),
  sparkplugMetric: z.string().max(255).nullable().optional(),
  transform: transformSchema.nullable().optional(),
  enabled: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
});

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
}

export const unsMappingRouter = router({
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ adapterId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => listMappings({ adapterId: input?.adapterId })),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const row = await getMapping(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Mapping không tồn tại." });
      return row;
    }),

  create: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(createInput)
    .mutation(async ({ input, ctx }) => {
      try {
        return await createMapping({ ...input, createdBy: ctx.user.id });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Tag "${input.tag}" đã có mapping trong adapter này.`,
          });
        }
        throw err;
      }
    }),

  update: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(createInput.partial().omit({ adapterId: true }).extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      try {
        const row = await updateMapping(id, patch);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Mapping không tồn tại." });
        return row;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: "CONFLICT", message: "Tag đã có mapping trong adapter này." });
        }
        throw err;
      }
    }),

  delete: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const ok = await deleteMapping(input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Mapping không tồn tại." });
      return { success: true };
    }),

  /**
   * PURE live preview: reshape a sample raw value with an (unsaved) mapping draft →
   * the resulting UNS topic, Sparkplug metric name, transformed value, and whether a
   * deadband would suppress it. No DB write, no publish.
   */
  preview: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(
      z.object({
        adapterId: z.number().int().positive(),
        tag: z.string().min(1).max(128),
        unsTopic: z.string().min(1).max(500),
        sparkplugMetric: z.string().max(255).nullable().optional(),
        transform: transformSchema.nullable().optional(),
        rawValue: scalarSchema,
        adapterCode: z.string().optional(),
        machineId: z.number().int().nullable().optional(),
        prevValue: scalarSchema.nullable().optional(),
      }),
    )
    .query(({ input }) => {
      const draft: ResolvedMapping = {
        id: 0,
        adapterId: input.adapterId,
        tag: input.tag,
        unsTopic: input.unsTopic,
        sparkplugMetric: input.sparkplugMetric ?? null,
        transform: input.transform ?? null,
        enabled: true,
      };
      return previewMapping(draft, input.rawValue, {
        adapterCode: input.adapterCode,
        tag: input.tag,
        machineId: input.machineId ?? null,
        prevValue: input.prevValue ?? undefined,
      });
    }),
});
