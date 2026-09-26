import { getDb } from "./db";
import { appError } from "./_core/appError";
import { DbUnavailableError } from "./_core/dbErrors";
import { measurementPointTemplates } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Get all active measurement point templates
 */
export async function listTemplates() {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db.select().from(measurementPointTemplates)
    .where(eq(measurementPointTemplates.isActive, true))
    .orderBy(measurementPointTemplates.createdAt);
}

/**
 * Get template by ID
 */
export async function getTemplateById(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const result = await db.select().from(measurementPointTemplates)
    .where(eq(measurementPointTemplates.id, id));
  return result[0] || null;
}

/**
 * Get template by code
 */
export async function getTemplateByCode(code: string) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const result = await db.select().from(measurementPointTemplates)
    .where(eq(measurementPointTemplates.code, code));
  return result[0] || null;
}

/**
 * Get templates by category
 */
export async function getTemplatesByCategory(category: string) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db.select().from(measurementPointTemplates)
    .where(and(
      eq(measurementPointTemplates.category, category),
      eq(measurementPointTemplates.isActive, true)
    ))
    .orderBy(measurementPointTemplates.createdAt);
}

/**
 * Create new measurement point template
 */
export async function createTemplate(data: {
  code: string;
  name: string;
  description?: string;
  category?: string;
  points: any[];
  createdBy: number;
}) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const result = await db.insert(measurementPointTemplates).values({
    code: data.code,
    name: data.name,
    description: data.description,
    category: data.category,
    points: data.points,
    pointCount: data.points.length,
    createdBy: data.createdBy,
  });
  return result;
}

/**
 * Update measurement point template
 */
export async function updateTemplate(id: number, data: {
  name?: string;
  description?: string;
  category?: string;
  points?: any[];
}) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const updates: any = {};
  if (data.name) updates.name = data.name;
  if (data.description) updates.description = data.description;
  if (data.category) updates.category = data.category;
  if (data.points) {
    updates.points = data.points;
    updates.pointCount = data.points.length;
  }

  return db.update(measurementPointTemplates)
    .set(updates)
    .where(eq(measurementPointTemplates.id, id));
}

/**
 * Delete template (soft delete)
 */
export async function deleteTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db.update(measurementPointTemplates)
    .set({ isActive: false })
    .where(eq(measurementPointTemplates.id, id));
}

/**
 * Clone template
 */
export async function cloneTemplate(id: number, newCode: string, createdBy: number) {
  const template = await getTemplateById(id);
  if (!template) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "marketplaceTemplate" }, "Template not found");

  return createTemplate({
    code: newCode,
    name: `${template.name} (Copy)`,
    description: template.description || undefined,
    category: template.category || undefined,
    points: template.points,
    createdBy,
  });
}
