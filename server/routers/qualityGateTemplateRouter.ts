/**
 * Quality Gate Template Router
 * CRUD custom templates + built-in template library
 */

import { z } from "zod";
import { appError } from "../_core/appError";
import { router, protectedProcedure, qualityProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { sql, eq, desc } from "drizzle-orm";
import { getBuiltinTemplates, getBuiltinTemplate } from "../services/qualityGateTemplateService";
import { qualityGates, qualityGateTemplates, qualityGateTemplateAssignments } from "../../drizzle/schema/spc";

export const qualityGateTemplateRouter = router({
  /**
   * List all built-in templates
   */
  listBuiltin: protectedProcedure.query(() => {
    return getBuiltinTemplates();
  }),

  /**
   * Get a specific built-in template
   */
  getBuiltin: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const template = getBuiltinTemplate(input.id);
      if (!template) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "qualityGateTemplate" }, "Template not found");
      return template;
    }),

  /**
   * List custom templates from DB
   */
  listCustom: protectedProcedure.query(async () => {
    const db = await getDb();
    try {
      return await db!.select().from(qualityGateTemplates).orderBy(desc(qualityGateTemplates.createdAt));
    } catch (err: any) {
      if (err.code === '42P01') return [];
      throw err;
    }
  }),

  /**
   * Create custom template
   */
  createCustom: qualityProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      standard: z.string().optional(),
      category: z.enum(["electronics", "automotive", "aerospace", "medical", "general", "custom"]),
      rules: z.array(z.object({
        gateType: z.enum(["yield_rate", "ng_count", "ng_rate", "cpk_threshold", "consecutive_ng"]),
        threshold: z.number(),
        comparisonOperator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
        windowSize: z.number().min(10).max(10000),
        consecutiveCount: z.number().min(1).max(100),
        action: z.enum(["alert", "pause", "stop"]),
        autoResumeAfterMinutes: z.number().optional(),
      })),
      notifyRoles: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      try {
        const [result] = await db!.insert(qualityGateTemplates).values({
          name: input.name,
          description: input.description || null,
          standard: input.standard || "custom",
          category: input.category,
          rules: input.rules,
          notifyRoles: input.notifyRoles || [],
          createdBy: ctx.user?.id || null,
        }).returning();
        return result;
      } catch (err: any) {
        if (err.code === '42P01') throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "qualityGateTemplateRegistry" }, "Quality gate templates table not found. Please run migration 0067.");
        throw err;
      }
    }),

  /**
   * Update custom template
   */
  updateCustom: qualityProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      standard: z.string().optional(),
      category: z.enum(["electronics", "automotive", "aerospace", "medical", "general", "custom"]).optional(),
      rules: z.array(z.object({
        gateType: z.enum(["yield_rate", "ng_count", "ng_rate", "cpk_threshold", "consecutive_ng"]),
        threshold: z.number(),
        comparisonOperator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
        windowSize: z.number().min(10).max(10000),
        consecutiveCount: z.number().min(1).max(100),
        action: z.enum(["alert", "pause", "stop"]),
        autoResumeAfterMinutes: z.number().optional(),
      })).optional(),
      notifyRoles: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.standard !== undefined) updateData.standard = input.standard;
      if (input.category !== undefined) updateData.category = input.category;
      if (input.rules !== undefined) updateData.rules = input.rules;
      if (input.notifyRoles !== undefined) updateData.notifyRoles = input.notifyRoles;

      const db = await getDb();
      try {
        const [result] = await db!.update(qualityGateTemplates)
          .set(updateData)
          .where(eq(qualityGateTemplates.id, input.id))
          .returning();
        return result;
      } catch (err: any) {
        if (err.code === '42P01') throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "qualityGateTemplateRegistry" }, "Quality gate templates table not found. Please run migration 0067.");
        throw err;
      }
    }),

  /**
   * Delete custom template
   */
  deleteCustom: qualityProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      try {
        await db!.delete(qualityGateTemplates).where(eq(qualityGateTemplates.id, input.id));
        return { success: true };
      } catch (err: any) {
        if (err.code === '42P01') throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "qualityGateTemplateRegistry" }, "Quality gate templates table not found. Please run migration 0067.");
        throw err;
      }
    }),

  /**
   * Apply template to a production line (creates quality gates)
   */
  applyToLine: qualityProcedure
    .input(z.object({
      templateId: z.string(),   // built-in ID or "custom:N"
      lineId: z.number(),
      workstationId: z.number().optional(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      let templateRules: any[];
      let templateName: string;
      let notifyRoles: string[];

      const db = await getDb();
      if (input.templateId.startsWith("custom:")) {
        const customId = parseInt(input.templateId.replace("custom:", ""));
        let result;
        try {
          result = await db!.execute(sql`SELECT * FROM quality_gate_templates WHERE id = ${customId}`);
        } catch (err: any) {
          if (err.code === '42P01') throw appError("PRECONDITION_FAILED", "FEATURE_NOT_CONFIGURED", { feature: "qualityGateTemplateRegistry" }, "Quality gate templates table not found. Please run migration 0067.");
          throw err;
        }
        if (!((result as any).rows ?? result)[0]) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "qualityGateTemplate" }, "Custom template not found");
        const custom = ((result as any).rows ?? result)[0] as any;
        templateRules = typeof custom.rules === "string" ? JSON.parse(custom.rules) : custom.rules;
        templateName = custom.name;
        notifyRoles = typeof custom.notifyRoles === "string" ? JSON.parse(custom.notifyRoles) : (custom.notifyRoles || []);
      } else {
        const builtin = getBuiltinTemplate(input.templateId);
        if (!builtin) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "qualityGateTemplate" }, "Built-in template not found");
        templateRules = builtin.rules;
        templateName = builtin.name;
        notifyRoles = builtin.notifyRoles;
      }

      const createdGates = [];
      for (const rule of templateRules) {
        const result = await db!.execute(sql`
          INSERT INTO quality_gates ("name", "description", "lineId", "workstationId", "productModelId", "machineId",
            "gateType", "threshold", "comparisonOperator", "windowSize", "consecutiveCount", "action",
            "autoResumeAfterMinutes", "notifyRoles", "isActive", "createdBy", "createdAt", "updatedAt")
          VALUES (
            ${`${templateName} - ${rule.gateType}`},
            ${'Auto-created from template: ' + templateName},
            ${input.lineId},
            ${input.workstationId || null},
            ${input.productModelId || null},
            ${input.machineId || null},
            ${rule.gateType},
            ${rule.threshold.toString()},
            ${rule.comparisonOperator},
            ${rule.windowSize},
            ${rule.consecutiveCount},
            ${rule.action},
            ${rule.autoResumeAfterMinutes || null},
            ${JSON.stringify(notifyRoles)}::jsonb,
            true,
            ${ctx.user?.id || null},
            NOW(), NOW()
          )
          RETURNING *
        `);
        createdGates.push(((result as any).rows ?? result)[0]);
      }

      return { gatesCreated: createdGates.length, gates: createdGates };
    }),
});
