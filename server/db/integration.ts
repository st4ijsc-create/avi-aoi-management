import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { eq, and, desc, gte, lte, like, sql, SQL } from "drizzle-orm";
import {
  factories,
  workshops,
  productionLines,
  lineStages,
  workstations,
  productModels,
  productCategories,
  measurementPointDefs,
  productMachineMappings,
  processes,
  shiftConfigs,
  mqttAlertRules,
  users,
  scheduledReports,
  backupLogs,
  type InsertBackupLog,
  scheduledBackups,
  type InsertScheduledBackup,
  templateMarketplace,
  type InsertTemplateMarketplace,
  templateReviews,
  type InsertTemplateReview,
} from "../../drizzle/schema";


// ============ BACKUP/RESTORE FUNCTIONS ============

const CATEGORY_TABLE_MAP: Record<string, any[]> = {
  corporate: [factories, workshops, productionLines, lineStages, workstations],
  products: [productModels, productCategories, measurementPointDefs, productMachineMappings],
  processes: [processes, shiftConfigs],
  alerts: [mqttAlertRules],
  users: [users],
  reports: [scheduledReports],
};

export async function exportSystemConfig(categories: string[]) {
  const db = await getDb();
  if (!db) return {};
  
  const result: Record<string, any[]> = {};
  
  for (const category of categories) {
    const tables = CATEGORY_TABLE_MAP[category];
    if (!tables) continue;
    
    for (const table of tables) {
      const tableName = (table as any)[Symbol.for("drizzle:Name")] || table._.name;
      try {
        const data = await db.select().from(table);
        result[tableName] = data;
      } catch (e) {
        console.error(`Error exporting table ${tableName}:`, e);
        result[tableName] = [];
      }
    }
  }
  
  return result;
}

export async function importSystemConfig(
  data: Record<string, any[]>,
  categories: string[],
  overwrite: boolean = false
) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  let imported = 0;
  let skipped = 0;
  let errors: string[] = [];
  
  for (const category of categories) {
    const tables = CATEGORY_TABLE_MAP[category];
    if (!tables) continue;
    
    for (const table of tables) {
      const tableName = (table as any)[Symbol.for("drizzle:Name")] || table._.name;
      const tableData = data[tableName];
      
      if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
        continue;
      }
      
      try {
        if (overwrite) {
          // Delete existing data first
          await db.delete(table);
        }
        
        // Insert new data
        for (const row of tableData) {
          // Remove auto-generated fields
          const { id, createdAt, updatedAt, ...insertData } = row;
          
          try {
            await db.insert(table).values(insertData);
            imported++;
          } catch (e) {
            // Skip duplicates
            skipped++;
          }
        }
      } catch (e) {
        errors.push(`Error importing ${tableName}: ${(e as Error).message}`);
      }
    }
  }
  
  return { imported, skipped, errors };
}


// ============ BACKUP LOGS FUNCTIONS ============

export async function createBackupLog(log: InsertBackupLog) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  const [result] = await db.insert(backupLogs).values(log).returning({ id: backupLogs.id });
  return result.id;
}

export async function listBackupLogs(filters?: {
  userId?: number;
  action?: "export" | "import" | "scheduled_export";
  status?: "success" | "failed" | "partial";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(backupLogs);
  const conditions: SQL[] = [];
  
  if (filters?.userId) {
    conditions.push(eq(backupLogs.userId, filters.userId));
  }
  if (filters?.action) {
    conditions.push(eq(backupLogs.action, filters.action));
  }
  if (filters?.status) {
    conditions.push(eq(backupLogs.status, filters.status));
  }
  if (filters?.startDate) {
    conditions.push(gte(backupLogs.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(backupLogs.createdAt, filters.endDate));
  }
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  
  query = query.orderBy(desc(backupLogs.createdAt)) as any;
  
  if (filters?.limit) {
    query = query.limit(filters.limit) as any;
  }
  if (filters?.offset) {
    query = query.offset(filters.offset) as any;
  }
  
  return query;
}

// ============ SCHEDULED BACKUPS FUNCTIONS ============

export async function createScheduledBackup(backup: InsertScheduledBackup) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  const [result] = await db.insert(scheduledBackups).values(backup).returning({ id: scheduledBackups.id });
  return result.id;
}

export async function updateScheduledBackup(id: number, data: Partial<InsertScheduledBackup>) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  await db.update(scheduledBackups).set(data).where(eq(scheduledBackups.id, id));
}

export async function deleteScheduledBackup(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  await db.delete(scheduledBackups).where(eq(scheduledBackups.id, id));
}

export async function listScheduledBackups(enabledOnly?: boolean) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(scheduledBackups);
  
  if (enabledOnly) {
    query = query.where(eq(scheduledBackups.isEnabled, true)) as any;
  }
  
  return query.orderBy(desc(scheduledBackups.createdAt));
}

export async function getScheduledBackupById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(scheduledBackups).where(eq(scheduledBackups.id, id));
  return result || null;
}

export async function getScheduledBackupsDue() {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(scheduledBackups)
    .where(and(
      eq(scheduledBackups.isEnabled, true),
      lte(scheduledBackups.nextRunAt, now)
    ));
}

// ============ TEMPLATE MARKETPLACE FUNCTIONS ============

export async function publishTemplateToMarketplace(data: InsertTemplateMarketplace) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  const [result] = await db.insert(templateMarketplace).values(data).returning({ id: templateMarketplace.id });
  return result.id;
}

export async function listMarketplaceTemplates(filters?: {
  category?: string;
  publisherId?: number;
  isFeatured?: boolean;
  search?: string;
  sortBy?: "rating" | "downloads" | "newest";
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(templateMarketplace);
  const conditions: SQL[] = [eq(templateMarketplace.isPublished, true)];
  
  if (filters?.category) {
    conditions.push(eq(templateMarketplace.category, filters.category));
  }
  if (filters?.publisherId) {
    conditions.push(eq(templateMarketplace.publisherId, filters.publisherId));
  }
  if (filters?.isFeatured) {
    conditions.push(eq(templateMarketplace.isFeatured, true));
  }
  if (filters?.search) {
    conditions.push(like(templateMarketplace.title, `%${filters.search}%`));
  }
  
  query = query.where(and(...conditions)) as any;
  
  // Sort
  if (filters?.sortBy === "rating") {
    query = query.orderBy(desc(templateMarketplace.rating)) as any;
  } else if (filters?.sortBy === "downloads") {
    query = query.orderBy(desc(templateMarketplace.downloadCount)) as any;
  } else {
    query = query.orderBy(desc(templateMarketplace.createdAt)) as any;
  }
  
  if (filters?.limit) {
    query = query.limit(filters.limit) as any;
  }
  if (filters?.offset) {
    query = query.offset(filters.offset) as any;
  }
  
  return query;
}

export async function getMarketplaceTemplateById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(templateMarketplace).where(eq(templateMarketplace.id, id));
  return result[0] || null;
}

export async function incrementTemplateDownloads(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  await db.update(templateMarketplace)
    .set({ downloadCount: sql`${templateMarketplace.downloadCount} + 1` })
    .where(eq(templateMarketplace.id, id));
}

export async function updateMarketplaceTemplate(id: number, data: Partial<InsertTemplateMarketplace>) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  await db.update(templateMarketplace).set(data).where(eq(templateMarketplace.id, id));
}

export async function deleteMarketplaceTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  await db.delete(templateMarketplace).where(eq(templateMarketplace.id, id));
}

// ============ TEMPLATE REVIEWS FUNCTIONS ============

export async function createTemplateReview(review: InsertTemplateReview) {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  
  const [result] = await db.insert(templateReviews).values(review).returning({ id: templateReviews.id });
  
  // Update marketplace rating
  await updateMarketplaceRating(review.marketplaceId);
  
  return result.id;
}

export async function listTemplateReviews(marketplaceId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(templateReviews)
    .where(eq(templateReviews.marketplaceId, marketplaceId))
    .orderBy(desc(templateReviews.createdAt));
}

export async function updateMarketplaceRating(marketplaceId: number) {
  const db = await getDb();
  if (!db) return;
  
  const reviews = await db.select().from(templateReviews)
    .where(eq(templateReviews.marketplaceId, marketplaceId));
  
  if (reviews.length === 0) return;
  
  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  
  await db.update(templateMarketplace)
    .set({ 
      rating: avgRating.toFixed(1),
      ratingCount: reviews.length 
    })
    .where(eq(templateMarketplace.id, marketplaceId));
}
