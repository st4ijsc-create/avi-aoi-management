import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { adminProcedure } from "./_shared";

// ============= DASHBOARD WIDGET ROUTER =============
export const dashboardWidgetRouter = router({
  getLayout: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getDashboardWidgetLayout(ctx.user.id);
    }),

  saveLayout: protectedProcedure
    .input(z.object({
      widgets: z.array(z.object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        settings: z.record(z.string(), z.any()).optional(),
        visible: z.boolean(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.saveDashboardWidgetLayout(ctx.user.id, input.widgets);
    }),

  resetLayout: protectedProcedure
    .mutation(async ({ ctx }) => {
      await db.resetDashboardWidgetLayout(ctx.user.id);
      return { success: true };
    }),

  // ============= SHARED TEMPLATES =============
  
  // Get all shared templates (public or created by user)
  getSharedTemplates: protectedProcedure
    .query(async ({ ctx }) => {
      // Get all public templates
      const publicTemplates = await db.getDashboardTemplates({ isPublic: true });
      
      // Get user's own templates (if not admin)
      let userTemplates: Awaited<ReturnType<typeof db.getDashboardTemplates>> = [];
      if (ctx.user.role !== 'admin') {
        userTemplates = await db.getDashboardTemplates({ createdBy: ctx.user.id, isPublic: false });
      }
      
      // Combine and deduplicate
      const allTemplates = [...publicTemplates, ...userTemplates];
      const uniqueTemplates = allTemplates.filter((t, i, arr) => 
        arr.findIndex(x => x.id === t.id) === i
      );
      
      return uniqueTemplates;
    }),

  // Get template by ID
  getSharedTemplateById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getDashboardTemplateById(input.id);
    }),

  // Create shared template (admin only)
  createSharedTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      widgets: z.array(z.string()),
      layout: z.array(z.object({
        i: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        minW: z.number().optional(),
        minH: z.number().optional(),
      })),
      isPublic: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.createDashboardTemplate({
        name: input.name,
        description: input.description,
        templateType: 'shared',
        widgets: input.widgets,
        layout: input.layout,
        isPublic: input.isPublic,
        createdBy: ctx.user.id,
      });
    }),

  // Update shared template (admin only)
  updateSharedTemplate: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      widgets: z.array(z.string()).optional(),
      layout: z.array(z.object({
        i: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        minW: z.number().optional(),
        minH: z.number().optional(),
      })).optional(),
      isPublic: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateDashboardTemplate(id, data);
      return { success: true };
    }),

  // Delete shared template (admin only)
  deleteSharedTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteDashboardTemplate(input.id);
      return { success: true };
    }),

  // Apply shared template (increment usage count)
  applySharedTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.incrementTemplateUsage(input.id);
      return { success: true };
    }),

  // Save current layout as shared template (admin only)
  saveAsSharedTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      isPublic: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get current user's layout
      const currentLayout = await db.getDashboardWidgetLayout(ctx.user.id);
      
      if (!currentLayout) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No layout found to save' });
      }
      
      // Extract widgets and layout from current layout
      const widgets = currentLayout.widgets.map(w => w.id);
      const layout = currentLayout.widgets.map(w => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
      }));
      
      return db.createDashboardTemplate({
        name: input.name,
        description: input.description,
        templateType: 'shared',
        widgets,
        layout,
        isPublic: input.isPublic,
        createdBy: ctx.user.id,
      });
    }),

  // ============= WIDGET STYLE PRESETS =============
  
  // Get all style presets (user's own + public + system)
  getStylePresets: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserWidgetStylePresets(ctx.user.id);
    }),

  // Get preset by ID
  getStylePresetById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getWidgetStylePresetById(input.id);
    }),

  // Create style preset
  createStylePreset: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      backgroundColor: z.string().default('#ffffff'),
      textColor: z.string().default('#1f2937'),
      borderColor: z.string().default('#e5e7eb'),
      accentColor: z.string().default('#3b82f6'),
      borderRadius: z.string().default('0.5rem'),
      shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']).default('sm'),
      opacity: z.string().default('1.00'),
      presetType: z.enum(['user', 'shared']).default('user'),
      isPublic: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Only admin can create shared presets
      if (input.presetType === 'shared' && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admin can create shared presets' });
      }
      return db.createWidgetStylePreset({
        ...input,
        createdBy: ctx.user.id,
      });
    }),

  // Update style preset
  updateStylePreset: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
      borderColor: z.string().optional(),
      accentColor: z.string().optional(),
      borderRadius: z.string().optional(),
      shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
      opacity: z.string().optional(),
      isPublic: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Only owner or admin can update
      if (preset.createdBy !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update this preset' });
      }
      const { id, ...data } = input;
      await db.updateWidgetStylePreset(id, data);
      return { success: true };
    }),

  // Delete style preset
  deleteStylePreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Only owner or admin can delete
      if (preset.createdBy !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete this preset' });
      }
      // Cannot delete system presets
      if (preset.presetType === 'system') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete system presets' });
      }
      await db.deleteWidgetStylePreset(input.id);
      return { success: true };
    }),

  // Apply style preset (increment usage count)
  applyStylePreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.incrementWidgetStylePresetUsage(input.id);
      return { success: true };
    }),

  // Get public style presets only
  getPublicStylePresets: protectedProcedure
    .query(async () => {
      return db.getPublicWidgetStylePresets();
    }),

  // Export preset as JSON
  exportStylePreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Check access - user can export their own, public, or system presets
      if (preset.createdBy !== ctx.user.id && !preset.isPublic && preset.presetType !== 'system') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to export this preset' });
      }
      return {
        name: preset.name,
        description: preset.description,
        backgroundColor: preset.backgroundColor,
        textColor: preset.textColor,
        borderColor: preset.borderColor,
        accentColor: preset.accentColor,
        borderRadius: preset.borderRadius,
        shadow: preset.shadow,
        opacity: preset.opacity,
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.user.name,
        version: '1.0',
      };
    }),

  // Import preset from JSON
  importStylePreset: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      backgroundColor: z.string(),
      textColor: z.string(),
      borderColor: z.string(),
      accentColor: z.string(),
      borderRadius: z.string(),
      shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']),
      opacity: z.string(),
      isPublic: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate name
      const existingPresets = await db.getUserWidgetStylePresets(ctx.user.id);
      const duplicateName = existingPresets.find(p => p.name === input.name && p.createdBy === ctx.user.id);
      if (duplicateName) {
        // Append timestamp to make unique
        input.name = `${input.name} (imported ${new Date().toLocaleDateString()})`;
      }
      
      // Only admin can create public presets
      if (input.isPublic && ctx.user.role !== 'admin') {
        input.isPublic = false;
      }
      
      return db.createWidgetStylePreset({
        ...input,
        presetType: 'user',
        createdBy: ctx.user.id,
      });
    }),

  // Bulk export presets
  exportAllUserPresets: protectedProcedure
    .query(async ({ ctx }) => {
      const presets = await db.getUserWidgetStylePresets(ctx.user.id);
      const userPresets = presets.filter(p => p.createdBy === ctx.user.id);
      return {
        presets: userPresets.map(p => ({
          name: p.name,
          description: p.description,
          backgroundColor: p.backgroundColor,
          textColor: p.textColor,
          borderColor: p.borderColor,
          accentColor: p.accentColor,
          borderRadius: p.borderRadius,
          shadow: p.shadow,
          opacity: p.opacity,
        })),
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.user.name,
        version: '1.0',
        count: userPresets.length,
      };
    }),

  // Bulk import presets
  importMultiplePresets: protectedProcedure
    .input(z.object({
      presets: z.array(z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        backgroundColor: z.string(),
        textColor: z.string(),
        borderColor: z.string(),
        accentColor: z.string(),
        borderRadius: z.string(),
        shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']),
        opacity: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const results: { name: string; success: boolean; error?: string }[] = [];
      const existingPresets = await db.getUserWidgetStylePresets(ctx.user.id);
      const existingNames = new Set(existingPresets.filter(p => p.createdBy === ctx.user.id).map(p => p.name));
      
      for (const preset of input.presets) {
        try {
          let name = preset.name;
          // Handle duplicate names
          if (existingNames.has(name)) {
            name = `${name} (imported ${new Date().toLocaleDateString()})`;
          }
          
          await db.createWidgetStylePreset({
            ...preset,
            name,
            presetType: 'user',
            isPublic: false,
            createdBy: ctx.user.id,
          });
          existingNames.add(name);
          results.push({ name: preset.name, success: true });
        } catch (error) {
          results.push({ name: preset.name, success: false, error: (error as Error).message });
        }
      }
      
      return {
        imported: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      };
    }),

  // Share preset with team (admin only)
  sharePreset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Update preset to be shared and public
      await db.updateWidgetStylePreset(input.id, {
        presetType: 'shared',
        isPublic: true,
      });
      return { success: true, message: 'Preset shared with team' };
    }),

  // Unshare preset (admin only)
  unsharePreset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Cannot unshare system presets
      if (preset.presetType === 'system') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot modify system presets' });
      }
      // Update preset to be private
      await db.updateWidgetStylePreset(input.id, {
        presetType: 'user',
        isPublic: false,
      });
      return { success: true, message: 'Preset is now private' };
    }),

  // Get all shared presets (for team members)
  getSharedStylePresets: protectedProcedure
    .query(async () => {
      return db.getSharedWidgetStylePresets();
    }),

  // Clone shared preset to user's collection
  cloneSharedPreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Check if preset is accessible (public or shared)
      if (!preset.isPublic && preset.presetType !== 'shared' && preset.createdBy !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to clone this preset' });
      }
      // Create a copy for the user
      const newPresetId = await db.createWidgetStylePreset({
        name: `${preset.name} (copy)`,
        description: preset.description || undefined,
        backgroundColor: preset.backgroundColor,
        textColor: preset.textColor,
        borderColor: preset.borderColor,
        accentColor: preset.accentColor,
        borderRadius: preset.borderRadius,
        shadow: preset.shadow,
        opacity: preset.opacity,
        presetType: 'user',
        isPublic: false,
        createdBy: ctx.user.id,
      });
      return { success: true, newPresetId };
    }),

  // ============ USER CUSTOM DASHBOARDS ============

  listCustomDashboards: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserCustomDashboards(ctx.user.id);
    }),

  listPublicDashboards: protectedProcedure
    .query(async () => {
      return db.getPublicCustomDashboards();
    }),

  getCustomDashboard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const dashboard = await db.getUserCustomDashboardById(input.id);
      if (!dashboard) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
      }
      // Check access: owner or public
      if (dashboard.userId !== ctx.user.id && !dashboard.isPublic) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to view this dashboard' });
      }
      return dashboard;
    }),

  createCustomDashboard: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      widgets: z.array(z.object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        size: z.enum(['small', 'medium', 'large', 'full']),
        position: z.object({ x: z.number(), y: z.number() }),
        config: z.record(z.string(), z.any()).default({}),
      })).default([]),
      gridCols: z.number().min(2).max(6).default(4),
      isPublic: z.boolean().default(false),
      autoRefreshInterval: z.number().min(0).max(3600).optional(),
      globalFilters: z.record(z.string(), z.any()).optional(),
      themePreset: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.createUserCustomDashboard({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        widgets: input.widgets,
        gridCols: input.gridCols,
        isPublic: input.isPublic,
        autoRefreshInterval: input.autoRefreshInterval,
        globalFilters: input.globalFilters || {},
        themePreset: input.themePreset,
      });
    }),

  updateCustomDashboard: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      widgets: z.array(z.object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        size: z.enum(['small', 'medium', 'large', 'full']),
        position: z.object({ x: z.number(), y: z.number() }),
        config: z.record(z.string(), z.any()).default({}),
      })).optional(),
      gridCols: z.number().min(2).max(6).optional(),
      isPublic: z.boolean().optional(),
      autoRefreshInterval: z.number().min(0).max(3600).optional(),
      globalFilters: z.record(z.string(), z.any()).optional(),
      themePreset: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return db.updateUserCustomDashboard(id, ctx.user.id, data);
    }),

  deleteCustomDashboard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteUserCustomDashboard(input.id, ctx.user.id);
      return { success: true };
    }),

  duplicateCustomDashboard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return db.duplicateUserCustomDashboard(input.id, ctx.user.id);
    }),

  toggleCustomDashboardFavorite: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return db.toggleCustomDashboardFavorite(input.id, ctx.user.id);
    }),

  toggleCustomDashboardPublic: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return db.toggleCustomDashboardPublic(input.id, ctx.user.id);
    }),

  exportCustomDashboard: protectedProcedure
    .input(z.object({
      id: z.number(),
      format: z.enum(['json', 'html']),
    }))
    .query(async ({ ctx, input }) => {
      const dashboard = await db.getUserCustomDashboardById(input.id);
      if (!dashboard) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
      }
      if (dashboard.userId !== ctx.user.id && !dashboard.isPublic) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }

      if (input.format === 'json') {
        return {
          format: 'json' as const,
          filename: `${dashboard.name.replace(/\s+/g, '_')}.json`,
          content: JSON.stringify({
            name: dashboard.name,
            description: dashboard.description,
            widgets: dashboard.widgets,
            gridCols: dashboard.gridCols,
            globalFilters: dashboard.globalFilters,
            themePreset: dashboard.themePreset,
            autoRefreshInterval: dashboard.autoRefreshInterval,
            exportedAt: new Date().toISOString(),
          }, null, 2),
        };
      }

      // HTML export
      const widgetsArr = Array.isArray(dashboard.widgets) ? dashboard.widgets : [];
      const widgetHtml = widgetsArr.map((w: any) =>
        `<div class="widget" style="grid-column: span ${w.size === 'full' ? 4 : w.size === 'large' ? 3 : w.size === 'medium' ? 2 : 1};">
          <div class="widget-header">${w.title || w.type}</div>
          <div class="widget-body">[${w.type}]</div>
        </div>`
      ).join('\n');

      return {
        format: 'html' as const,
        filename: `${dashboard.name.replace(/\s+/g, '_')}.html`,
        content: `<!DOCTYPE html>
<html><head><title>${dashboard.name}</title>
<style>
body { font-family: system-ui, sans-serif; padding: 24px; background: #f5f5f5; }
h1 { margin-bottom: 8px; } p { color: #666; margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: repeat(${dashboard.gridCols || 4}, 1fr); gap: 16px; }
.widget { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.widget-header { font-weight: 600; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
.widget-body { color: #888; min-height: 80px; display: flex; align-items: center; justify-content: center; }
</style></head><body>
<h1>${dashboard.name}</h1>
<p>${dashboard.description || ''}</p>
<div class="grid">${widgetHtml}</div>
<footer style="margin-top:24px;color:#999;font-size:12px;">Exported: ${new Date().toISOString()}</footer>
</body></html>`,
      };
    }),

  importCustomDashboard: protectedProcedure
    .input(z.object({
      jsonContent: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      let parsed: any;
      try {
        parsed = JSON.parse(input.jsonContent);
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid JSON' });
      }
      
      if (!parsed.name || !Array.isArray(parsed.widgets)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid dashboard format' });
      }
      
      return db.createUserCustomDashboard({
        userId: ctx.user.id,
        name: `${parsed.name} (Imported)`,
        description: parsed.description,
        widgets: parsed.widgets,
        gridCols: parsed.gridCols || 4,
        isPublic: false,
        autoRefreshInterval: parsed.autoRefreshInterval,
        globalFilters: parsed.globalFilters || {},
        themePreset: parsed.themePreset,
      });
    }),

  saveCustomDashboardAsTemplate: protectedProcedure
    .input(z.object({
      dashboardId: z.number(),
      name: z.string().min(1),
      description: z.string().optional(),
      isPublic: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const dashboard = await db.getUserCustomDashboardById(input.dashboardId);
      if (!dashboard || dashboard.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      
      const widgetsArr = Array.isArray(dashboard.widgets) ? dashboard.widgets : [];
      
      // Convert to template-compatible format
      const templateLayout = widgetsArr.map((w: any, i: number) => ({
        i: w.id || `widget-${i}`,
        x: w.position?.x || 0,
        y: w.position?.y || (i * 2),
        w: w.size === 'full' ? 4 : w.size === 'large' ? 3 : w.size === 'medium' ? 2 : 1,
        h: 2,
      }));
      
      const templateWidgets = widgetsArr.map((w: any) => w.type);
      
      return db.createDashboardTemplate({
        name: input.name,
        description: input.description || dashboard.description || '',
        templateType: 'shared',
        widgets: templateWidgets,
        layout: templateLayout,
        isPublic: input.isPublic,
        createdBy: ctx.user.id,
      });
    }),
});
