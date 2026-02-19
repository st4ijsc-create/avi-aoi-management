/**
 * Quality Gate Template Router
 * CRUD custom templates + built-in template library
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { getBuiltinTemplates, getBuiltinTemplate } from "../services/qualityGateTemplateService";
import { qualityGates } from "../../drizzle/schema/spc";

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
      if (!template) throw new Error("Template not found");
      return template;
    }),

  /**
   * List custom templates from DB
   */
  listCustom: protectedProcedure.query(async () => {
    const db = await getDb();
    try {
      const result = await db!.execute(sql`
        SELECT * FROM quality_gate_templates 
        ORDER BY "createdAt" DESC
      `);
      return result.rows;
    } catch (err: any) {
      // Table doesn't exist yet (migration not run)
      if (err.code === '42P01') return [];
      throw err;
    }
  }),

  /**
   * Create custom template
   */
  createCustom: protectedProcedure
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
        const result = await db!.execute(sql`
          INSERT INTO quality_gate_templates ("name", "description", "standard", "category", "rules", "notifyRoles", "createdBy", "createdAt", "updatedAt")
          VALUES (${input.name}, ${input.description || null}, ${input.standard || null}, ${input.category}, 
                  ${JSON.stringify(input.rules)}::jsonb, ${JSON.stringify(input.notifyRoles || [])}::jsonb, 
                  ${ctx.user?.id || null}, NOW(), NOW())
          RETURNING *
        `);
        return result.rows[0];
      } catch (err: any) {
        if (err.code === '42P01') throw new Error('Quality gate templates table not found. Please run migration 0067.');
        throw err;
      }
    }),

  /**
   * Update custom template
   */
  updateCustom: protectedProcedure
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
      const sets: string[] = [`"updatedAt" = NOW()`];
      if (input.name) sets.push(`"name" = '${input.name}'`);
      if (input.description !== undefined) sets.push(`"description" = '${input.description}'`);
      if (input.standard !== undefined) sets.push(`"standard" = '${input.standard}'`);
      if (input.category) sets.push(`"category" = '${input.category}'`);
      if (input.rules) sets.push(`"rules" = '${JSON.stringify(input.rules)}'::jsonb`);
      if (input.notifyRoles) sets.push(`"notifyRoles" = '${JSON.stringify(input.notifyRoles)}'::jsonb`);

      const db = await getDb();
      try {
        const result = await db!.execute(sql.raw(`
          UPDATE quality_gate_templates SET ${sets.join(", ")} WHERE id = ${input.id} RETURNING *
        `));
        return result.rows[0];
      } catch (err: any) {
        if (err.code === '42P01') throw new Error('Quality gate templates table not found. Please run migration 0067.');
        throw err;
      }
    }),

  /**
   * Delete custom template
   */
  deleteCustom: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      try {
        await db!.execute(sql`DELETE from quality_gate_templates WHERE id = ${input.id}`);
        return { success: true };
      } catch (err: any) {
        if (err.code === '42P01') throw new Error('Quality gate templates table not found. Please run migration 0067.');
        throw err;
      }
    }),

  /**
   * Apply template to a production line (creates quality gates)
   */
  applyToLine: protectedProcedure
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
          if (err.code === '42P01') throw new Error('Quality gate templates table not found. Please run migration 0067.');
          throw err;
        }
        if (!result.rows[0]) throw new Error("Custom template not found");
        const custom = result.rows[0] as any;
        templateRules = typeof custom.rules === "string" ? JSON.parse(custom.rules) : custom.rules;
        templateName = custom.name;
        notifyRoles = typeof custom.notifyRoles === "string" ? JSON.parse(custom.notifyRoles) : (custom.notifyRoles || []);
      } else {
        const builtin = getBuiltinTemplate(input.templateId);
        if (!builtin) throw new Error("Built-in template not found");
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
        createdGates.push(result.rows[0]);
      }

      return { gatesCreated: createdGates.length, gates: createdGates };
    }),
});
