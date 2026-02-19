import { getDb } from "./connection";
import { eq, and, desc, sql, or, SQL } from "drizzle-orm";
import {
  userSettings,
  type InsertUserSetting,
  dashboardWidgetLayouts,
  type InsertDashboardWidgetLayout,
  dashboardTemplates,
  type InsertDashboardTemplate,
  userCustomDashboards,
  type InsertUserCustomDashboard,
  widgetStylePresets,
  type InsertWidgetStylePreset,
} from "../../drizzle/schema";

// ============ USER SETTINGS FUNCTIONS ============

export async function getUserSettings(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  
  return results[0] || null;
}

export async function upsertUserSettings(userId: number, data: Partial<InsertUserSetting>) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getUserSettings(userId);
  
  if (existing) {
    await db.update(userSettings)
      .set(data)
      .where(eq(userSettings.userId, userId));
  } else {
    await db.insert(userSettings).values({ userId, ...data });
  }
}

// ============ DASHBOARD WIDGET LAYOUTS FUNCTIONS ============

export async function getDashboardWidgetLayout(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(dashboardWidgetLayouts)
    .where(and(
      eq(dashboardWidgetLayouts.userId, userId),
      eq(dashboardWidgetLayouts.isActive, true)
    ))
    .limit(1);
  
  return results[0] || null;
}

export async function saveDashboardWidgetLayout(userId: number, widgets: InsertDashboardWidgetLayout['widgets']) {
  const db = await getDb();
  if (!db) return null;
  
  const existing = await getDashboardWidgetLayout(userId);
  
  if (existing) {
    await db.update(dashboardWidgetLayouts)
      .set({ widgets, updatedAt: new Date() })
      .where(eq(dashboardWidgetLayouts.id, existing.id));
    return { id: existing.id };
  } else {
    const [result] = await db.insert(dashboardWidgetLayouts).values({
      userId,
      widgets,
      isActive: true,
    }).returning({ id: dashboardWidgetLayouts.id });
    return { id: Number(result.id) };
  }
}

export async function resetDashboardWidgetLayout(userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(dashboardWidgetLayouts)
    .where(eq(dashboardWidgetLayouts.userId, userId));
}


// ============ DASHBOARD TEMPLATES (SHARED) FUNCTIONS ============

export async function getDashboardTemplates(filters?: {
  templateType?: 'system' | 'shared';
  isPublic?: boolean;
  createdBy?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [];
  
  if (filters?.templateType) {
    conditions.push(eq(dashboardTemplates.templateType, filters.templateType));
  }
  if (filters?.isPublic !== undefined) {
    conditions.push(eq(dashboardTemplates.isPublic, filters.isPublic));
  }
  if (filters?.createdBy) {
    conditions.push(eq(dashboardTemplates.createdBy, filters.createdBy));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const results = await db.select()
    .from(dashboardTemplates)
    .where(whereClause)
    .orderBy(desc(dashboardTemplates.usageCount));
  
  return results;
}

export async function listDashboardTemplates() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(dashboardTemplates)
    .where(eq(dashboardTemplates.isPublic, true))
    .orderBy(desc(dashboardTemplates.usageCount));
}

export async function getDashboardTemplateById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(dashboardTemplates)
    .where(eq(dashboardTemplates.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function createDashboardTemplate(data: InsertDashboardTemplate) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(dashboardTemplates).values(data).returning({ id: dashboardTemplates.id });
  return { id: Number(result.id) };
}

export async function updateDashboardTemplate(id: number, data: Partial<InsertDashboardTemplate>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(dashboardTemplates)
    .set(data)
    .where(eq(dashboardTemplates.id, id));
}

export async function deleteDashboardTemplate(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(dashboardTemplates)
    .where(eq(dashboardTemplates.id, id));
}

export async function incrementTemplateUsage(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(dashboardTemplates)
    .set({ usageCount: sql`${dashboardTemplates.usageCount} + 1` })
    .where(eq(dashboardTemplates.id, id));
}

export async function applyDashboardTemplate(userId: number, templateId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // Get template
  const template = await getDashboardTemplateById(templateId);
  if (!template) return null;
  
  // Increment usage count
  await incrementTemplateUsage(templateId);
  
  // Return template data for frontend to apply
  return {
    widgets: template.widgets,
    layout: template.layout,
  };
}


// ============ USER CUSTOM DASHBOARDS FUNCTIONS ============

export async function getUserCustomDashboards(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(userCustomDashboards)
    .where(eq(userCustomDashboards.userId, userId))
    .orderBy(desc(userCustomDashboards.updatedAt));
}

export async function getPublicCustomDashboards() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(userCustomDashboards)
    .where(eq(userCustomDashboards.isPublic, true))
    .orderBy(desc(userCustomDashboards.updatedAt));
}

export async function getUserCustomDashboardById(id: number, userId?: number) {
  const db = await getDb();
  if (!db) return null;
  
  const conditions: SQL[] = [eq(userCustomDashboards.id, id)];
  
  const results = await db.select()
    .from(userCustomDashboards)
    .where(and(...conditions))
    .limit(1);
  
  return results[0] || null;
}

export async function createUserCustomDashboard(data: InsertUserCustomDashboard) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(userCustomDashboards).values(data)
    .returning({ id: userCustomDashboards.id });
  return { id: Number(result.id) };
}

export async function updateUserCustomDashboard(id: number, userId: number, data: Partial<InsertUserCustomDashboard>) {
  const db = await getDb();
  if (!db) return null;
  
  await db.update(userCustomDashboards)
    .set({ ...data, updatedAt: new Date() })
    .where(and(
      eq(userCustomDashboards.id, id),
      eq(userCustomDashboards.userId, userId)
    ));
  return { success: true };
}

export async function deleteUserCustomDashboard(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(userCustomDashboards)
    .where(and(
      eq(userCustomDashboards.id, id),
      eq(userCustomDashboards.userId, userId)
    ));
}

export async function duplicateUserCustomDashboard(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const original = await getUserCustomDashboardById(id);
  if (!original) return null;
  
  const [result] = await db.insert(userCustomDashboards).values({
    userId,
    name: `${original.name} (Copy)`,
    description: original.description,
    widgets: original.widgets,
    gridCols: original.gridCols,
    isPublic: false,
    isFavorite: false,
    autoRefreshInterval: original.autoRefreshInterval,
    globalFilters: original.globalFilters,
    themePreset: original.themePreset,
  }).returning({ id: userCustomDashboards.id });
  
  return { id: Number(result.id) };
}

export async function toggleCustomDashboardFavorite(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  const dashboard = await getUserCustomDashboardById(id);
  if (!dashboard || dashboard.userId !== userId) return;
  
  await db.update(userCustomDashboards)
    .set({ isFavorite: !dashboard.isFavorite, updatedAt: new Date() })
    .where(and(
      eq(userCustomDashboards.id, id),
      eq(userCustomDashboards.userId, userId)
    ));
  
  return { isFavorite: !dashboard.isFavorite };
}

export async function toggleCustomDashboardPublic(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  const dashboard = await getUserCustomDashboardById(id);
  if (!dashboard || dashboard.userId !== userId) return;
  
  await db.update(userCustomDashboards)
    .set({ isPublic: !dashboard.isPublic, updatedAt: new Date() })
    .where(and(
      eq(userCustomDashboards.id, id),
      eq(userCustomDashboards.userId, userId)
    ));
  
  return { isPublic: !dashboard.isPublic };
}

export async function saveCustomDashboardFromTemplate(userId: number, templateId: number, name: string) {
  const db = await getDb();
  if (!db) return null;
  
  const template = await getDashboardTemplateById(templateId);
  if (!template) return null;
  
  // Convert template layout to widget format
  const widgets = template.layout.map((l, idx) => ({
    id: l.i,
    type: template.widgets[idx] || 'kpi-card',
    title: template.widgets[idx] || 'Widget',
    size: l.w >= 4 ? 'full' as const : l.w >= 3 ? 'large' as const : l.w >= 2 ? 'medium' as const : 'small' as const,
    position: { x: l.x, y: l.y },
    config: {},
  }));
  
  const [result] = await db.insert(userCustomDashboards).values({
    userId,
    name,
    description: template.description,
    widgets,
    gridCols: 4,
    isPublic: false,
  }).returning({ id: userCustomDashboards.id });
  
  await incrementTemplateUsage(templateId);
  
  return { id: Number(result.id) };
}


// ============ WIDGET STYLE PRESETS FUNCTIONS ============

export async function getWidgetStylePresets(filters?: {
  presetType?: 'system' | 'shared' | 'user';
  isPublic?: boolean;
  createdBy?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [];
  
  if (filters?.presetType) {
    conditions.push(eq(widgetStylePresets.presetType, filters.presetType));
  }
  if (filters?.isPublic !== undefined) {
    conditions.push(eq(widgetStylePresets.isPublic, filters.isPublic));
  }
  if (filters?.createdBy) {
    conditions.push(eq(widgetStylePresets.createdBy, filters.createdBy));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  return db.select()
    .from(widgetStylePresets)
    .where(whereClause)
    .orderBy(desc(widgetStylePresets.usageCount));
}

export async function getWidgetStylePresetById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(widgetStylePresets)
    .where(eq(widgetStylePresets.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function createWidgetStylePreset(data: Omit<InsertWidgetStylePreset, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(widgetStylePresets).values(data).returning({ id: widgetStylePresets.id });
  return { id: Number(result.id) };
}

export async function updateWidgetStylePreset(id: number, data: Partial<InsertWidgetStylePreset>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(widgetStylePresets)
    .set(data)
    .where(eq(widgetStylePresets.id, id));
}

export async function deleteWidgetStylePreset(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(widgetStylePresets)
    .where(eq(widgetStylePresets.id, id));
}

export async function incrementWidgetStylePresetUsage(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(widgetStylePresets)
    .set({ usageCount: sql`${widgetStylePresets.usageCount} + 1` })
    .where(eq(widgetStylePresets.id, id));
}

export async function getPublicWidgetStylePresets() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(widgetStylePresets)
    .where(or(
      eq(widgetStylePresets.isPublic, true),
      eq(widgetStylePresets.presetType, 'system')
    ))
    .orderBy(desc(widgetStylePresets.usageCount));
}

export async function getUserWidgetStylePresets(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(widgetStylePresets)
    .where(or(
      eq(widgetStylePresets.createdBy, userId),
      eq(widgetStylePresets.isPublic, true),
      eq(widgetStylePresets.presetType, 'system')
    ))
    .orderBy(desc(widgetStylePresets.usageCount));
}

// Get shared widget style presets (presetType = 'shared' or isPublic = true)
export async function getSharedWidgetStylePresets() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(widgetStylePresets)
    .where(
      or(
        eq(widgetStylePresets.presetType, 'shared'),
        eq(widgetStylePresets.isPublic, true)
      )
    )
    .orderBy(desc(widgetStylePresets.usageCount), widgetStylePresets.name);
}
