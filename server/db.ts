import { eq, and, desc, asc, gte, lte, gt, lt, like, sql, or, isNull, isNotNull, not, ne, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { 
  InsertUser, users,
  factories, InsertFactory,
  workshops, InsertWorkshop,
  productionLines, InsertProductionLine,
  stations, InsertStation,
  machines, InsertMachine,
  productInspections, InsertProductInspection,
  measurementPointDefs, InsertMeasurementPointDef,
  measurementResults, InsertMeasurementResult,
  factoryLayouts, InsertFactoryLayout,
  machinePositions, InsertMachinePosition,
  dailyStatistics, InsertDailyStatistics,
  productModels, InsertProductModel,
  workshopPositions, InsertWorkshopPosition,
  factoryPositions, InsertFactoryPosition,
  alertSettings, InsertAlertSetting,
  alertHistory, InsertAlertHistory,
  productMachineMappings, InsertProductMachineMapping,
  shiftConfigs, InsertShiftConfig,
  productionOrders, InsertProductionOrder,
  lineStages, InsertLineStage,
  lineProductAssignments, InsertLineProductAssignment,
  machineStatusLogs, InsertMachineStatusLog,
  machineHeartbeats, InsertMachineHeartbeat,
  manualMachineConnections, InsertManualMachineConnection,
  yieldAlertThresholds, InsertYieldAlertThreshold,
  yieldThresholdHistory, InsertYieldThresholdHistory,
  backupCodes, InsertBackupCode,
  userSessions, InsertUserSession,
  systemSettings, InsertSystemSetting,
  auditLogs, InsertAuditLog,
  workstations, InsertWorkstation,
  scheduledReports, InsertScheduledReport,
  scheduledReportLogs, InsertScheduledReportLog,
  smtpConfig, InsertSmtpConfig,
  mqttClients, InsertMqttClient,
  mqttSubscriptions, InsertMqttSubscription,
  mqttErrorSummary, InsertMqttErrorSummary,
  mqttMessageLogs, InsertMqttMessageLog,
  mqttAlertRules, InsertMqttAlertRule,
  mqttAlertHistory, InsertMqttAlertHistory,
  systemConfig, InsertSystemConfig,
  userCorporateAssignments, InsertUserCorporateAssignment,
  userFactoryAssignments, InsertUserFactoryAssignment,
  emailTemplateConfig, InsertEmailTemplateConfig,
  notifications, InsertNotification,
  userNotificationPreferences, InsertUserNotificationPreference,
  dashboardTemplates, InsertDashboardTemplate,
  dashboardWidgetLayouts, InsertDashboardWidgetLayout,
  userSettings, InsertUserSetting,
  processes, InsertProcess,
  lineProcessAssignments, InsertLineProcessAssignment,
  widgetStylePresets, InsertWidgetStylePreset,
  productCategories, InsertProductCategory,
  backupLogs, InsertBackupLog,
  scheduledBackups, InsertScheduledBackup,
  templateMarketplace, InsertTemplateMarketplace,
  templateReviews, InsertTemplateReview,
  productionOrderTemplates, InsertProductionOrderTemplate
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.SUPABASE_DATABASE_URL) {
    try {
      const pool = new Pool({
        connectionString: process.env.SUPABASE_DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USER FUNCTIONS ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserRole(userId: number, role: 'user' | 'admin') {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.delete(users).where(eq(users.id, userId));
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalUser(data: {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  role?: 'user' | 'admin';
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Generate a unique openId for local users
  const openId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  const result = await db.insert(users).values({
    openId,
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    email: data.email || null,
    phone: data.phone || null,
    department: data.department || null,
    position: data.position || null,
    loginMethod: 'local',
    role: data.role || 'user',
    isActive: true,
  });
  return { id: Number(result[0].id), openId };
}

export async function updateUser(userId: number, data: {
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  position?: string;
  role?: 'user' | 'admin';
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set(data).where(eq(users.id, userId));
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function getActiveUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.isActive, true)).orderBy(desc(users.createdAt));
}

export async function getUsersByRole(role: 'user' | 'admin') {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.role, role)).orderBy(desc(users.createdAt));
}

export async function getUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role?: 'user' | 'admin';
  username?: string;
  phone?: string;
  department?: string;
  position?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Hash password using bcrypt
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(data.password, 10);
  
  // Generate a unique openId for local users
  const openId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  const result = await db.insert(users).values({
    openId,
    username: data.username || data.email.split('@')[0],
    passwordHash,
    name: data.name,
    email: data.email,
    phone: data.phone || null,
    department: data.department || null,
    position: data.position || null,
    loginMethod: 'local',
    role: data.role || 'user',
    isActive: true,
  });
  return Number(result[0].id);
}

export async function searchUsers(query: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users)
    .where(
      or(
        like(users.name, `%${query}%`),
        like(users.username, `%${query}%`),
        like(users.email, `%${query}%`)
      )
    )
    .orderBy(desc(users.createdAt));
}

// ============ 2FA FUNCTIONS ============
export async function setup2FA(userId: number, secret: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ twoFactorSecret: secret })
    .where(eq(users.id, userId));
}

export async function enable2FA(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ twoFactorEnabled: true })
    .where(eq(users.id, userId));
}

export async function disable2FA(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ twoFactorSecret: null, twoFactorEnabled: false })
    .where(eq(users.id, userId));
}

export async function get2FAStatus(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({
    twoFactorEnabled: users.twoFactorEnabled,
    twoFactorSecret: users.twoFactorSecret,
  }).from(users).where(eq(users.id, userId));
  return result[0] || null;
}

// ============ FACTORY FUNCTIONS ============
export async function createFactory(data: InsertFactory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(factories).values(data);
  return result[0].id;
}

export async function getFactories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factories).where(eq(factories.isActive, true)).orderBy(factories.name);
}

export async function getFactoryById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(factories).where(eq(factories.id, id)).limit(1);
  return result[0];
}

export async function updateFactory(id: number, data: Partial<InsertFactory>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factories).set(data).where(eq(factories.id, id));
}

export async function deleteFactory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factories).set({ isActive: false }).where(eq(factories.id, id));
}

// ============ WORKSHOP FUNCTIONS ============
export async function createWorkshop(data: InsertWorkshop) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(workshops).values(data);
  return result[0].id;
}

export async function getWorkshopsByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops)
    .where(and(eq(workshops.factoryId, factoryId), eq(workshops.isActive, true)))
    .orderBy(workshops.name);
}

export async function getWorkshops() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops).where(eq(workshops.isActive, true)).orderBy(workshops.name);
}

export async function getWorkshopById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(workshops).where(eq(workshops.id, id)).limit(1);
  return result[0];
}

export async function updateWorkshop(id: number, data: Partial<InsertWorkshop>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workshops).set(data).where(eq(workshops.id, id));
}

export async function deleteWorkshop(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workshops).set({ isActive: false }).where(eq(workshops.id, id));
}

// ============ PRODUCTION LINE FUNCTIONS ============
export async function createProductionLine(data: InsertProductionLine) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productionLines).values(data);
  return result[0].id;
}

export async function getProductionLinesByWorkshop(workshopId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines)
    .where(and(eq(productionLines.workshopId, workshopId), eq(productionLines.isActive, true)))
    .orderBy(productionLines.name);
}

export async function getProductionLines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines).where(eq(productionLines.isActive, true)).orderBy(productionLines.name);
}

export async function getLineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productionLines).where(eq(productionLines.id, id)).limit(1);
  return result[0];
}

export async function updateProductionLine(id: number, data: Partial<InsertProductionLine>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set(data).where(eq(productionLines.id, id));
}

export async function deleteProductionLine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set({ isActive: false }).where(eq(productionLines.id, id));
}

// ============ STATION FUNCTIONS ============
export async function createStation(data: InsertStation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(stations).values(data);
  return result[0].id;
}

export async function getStationsByLine(lineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stations)
    .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)))
    .orderBy(stations.orderIndex);
}

export async function getStations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stations).where(eq(stations.isActive, true)).orderBy(stations.orderIndex);
}

export async function getStationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  return result[0];
}

export async function updateStation(id: number, data: Partial<InsertStation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set(data).where(eq(stations.id, id));
}

export async function deleteStation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set({ isActive: false }).where(eq(stations.id, id));
}

// ============ MACHINE FUNCTIONS ============
export async function createMachine(data: InsertMachine) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(machines).values(data);
  return result[0].id;
}

export async function getMachinesByStation(stationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines)
    .where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)))
    .orderBy(machines.name);
}

export async function getMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines).where(eq(machines.isActive, true)).orderBy(machines.name);
}

// Get machines with full hierarchy info (line, workshop, factory)
export async function getMachinesWithHierarchy() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select({
      machine: machines,
      station: stations,
      line: productionLines,
      workshop: workshops,
      factory: factories,
    })
    .from(machines)
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .leftJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .leftJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machines.isActive, true))
    .orderBy(factories.name, workshops.name, productionLines.name, stations.orderIndex, machines.name);
  
  return result;
}

export async function getMachineByApiKey(apiKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines)
    .where(and(eq(machines.apiKey, apiKey), eq(machines.isActive, true)))
    .limit(1);
  return result[0];
}

export async function getMachineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  return result[0];
}

export async function getMachineByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines)
    .where(and(eq(machines.code, code), eq(machines.isActive, true)))
    .limit(1);
  return result[0];
}

export async function updateMachineHeartbeat(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({ lastHeartbeat: new Date() }).where(eq(machines.id, id));
}

export async function updateMachine(id: number, data: Partial<InsertMachine>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set(data).where(eq(machines.id, id));
}

export async function deleteMachine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({ isActive: false }).where(eq(machines.id, id));
}

// ============ PRODUCT MODEL FUNCTIONS ============
export async function createProductModel(data: InsertProductModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productModels).values(data);
  return result[0].id;
}

export async function getProductModels(options?: {
  search?: string;
  lifecycleStatus?: "development" | "active" | "eol" | "archived";
  sortBy?: "code" | "name" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  // Build WHERE conditions
  const conditions = [eq(productModels.isActive, true)];
  
  // Apply search filter
  if (options?.search) {
    const searchTerm = `%${options.search}%`;
    conditions.push(
      or(
        like(productModels.code, searchTerm),
        like(productModels.name, searchTerm),
        like(productModels.description, searchTerm)
      )!
    );
  }
  
  // Apply lifecycle status filter
  if (options?.lifecycleStatus) {
    conditions.push(eq(productModels.lifecycleStatus, options.lifecycleStatus));
  }
  
  // Determine sorting
  const sortOrder = options?.sortOrder === "desc" ? desc : asc;
  let orderByClause;
  switch (options?.sortBy) {
    case "code":
      orderByClause = sortOrder(productModels.code);
      break;
    case "name":
      orderByClause = sortOrder(productModels.name);
      break;
    case "createdAt":
      orderByClause = sortOrder(productModels.createdAt);
      break;
    case "updatedAt":
      orderByClause = sortOrder(productModels.updatedAt);
      break;
    default:
      orderByClause = desc(productModels.createdAt);
  }
  
  // Build final query with pagination
  let query = db
    .select()
    .from(productModels)
    .where(and(...conditions))
    .orderBy(orderByClause);
  
  if (options?.limit && options?.offset) {
    return query.limit(options.limit).offset(options.offset);
  } else if (options?.limit) {
    return query.limit(options.limit);
  } else if (options?.offset) {
    return query.offset(options.offset);
  }
  
  return query;
}

export async function getProductModelById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels).where(eq(productModels.id, id)).limit(1);
  return result[0];
}

export async function getProductModelByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productModels).where(eq(productModels.code, code)).limit(1);
  return result[0];
}

export async function updateProductModel(id: number, data: Partial<InsertProductModel>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productModels).set(data).where(eq(productModels.id, id));
}

export async function deleteProductModel(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // First delete related measurement point definitions
  await db.delete(measurementPointDefs).where(eq(measurementPointDefs.productModelId, id));
  // Then delete the product model
  await db.delete(productModels).where(eq(productModels.id, id));
}

// ============ PRODUCT INSPECTION FUNCTIONS ============
export async function createProductInspection(data: InsertProductInspection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productInspections).values(data);
  return result[0].id;
}

export async function getProductInspections(filters: {
  machineId?: number;
  corporateCode?: string;
  factoryCode?: string;
  serialNumber?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  const conditions = [];
  if (filters.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.factoryCode) conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  if (filters.serialNumber) conditions.push(like(productInspections.serialNumber, `%${filters.serialNumber}%`));
  if (filters.result) conditions.push(eq(productInspections.overallResult, filters.result));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(sql`${productInspections.corporateCode} IN (${corporateCodes.map(c => `'${c}'`).join(',')})`);
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(sql`${productInspections.factoryCode} IN (${factoryCodes.map(c => `'${c}'`).join(',')})`);
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      } else {
        // User has no assignments, return empty result
        return { data: [], total: 0 };
      }
    } else {
      // User has no assignments, return empty result
      return { data: [], total: 0 };
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db.select().from(productInspections)
      .where(whereClause)
      .orderBy(desc(productInspections.inspectionTime))
      .limit(filters.limit || 50)
      .offset(filters.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(productInspections).where(whereClause)
  ]);

  return { data, total: countResult[0]?.count || 0 };
}

export async function getProductInspectionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(productInspections).where(eq(productInspections.id, id)).limit(1);
  return result[0];
}

export async function updateProductInspectionNTF(id: number, userId: number, reason: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productInspections).set({
    overallResult: "NTF",
    ntfConfirmedBy: userId,
    ntfConfirmedAt: new Date(),
    ntfReason: reason
  }).where(eq(productInspections.id, id));
}

// ============ MEASUREMENT POINT DEFINITION FUNCTIONS ============
export async function createMeasurementPointDef(data: InsertMeasurementPointDef) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(measurementPointDefs).values(data);
  return result[0].id;
}

export async function getMeasurementPointDefsByProductModel(productModelId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.productModelId, productModelId), eq(measurementPointDefs.isActive, true)))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementPointDefs)
    .where(and(eq(measurementPointDefs.machineId, machineId), eq(measurementPointDefs.isActive, true)))
    .orderBy(measurementPointDefs.orderIndex);
}

export async function getMeasurementPointDefById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs).where(eq(measurementPointDefs.id, id)).limit(1);
  return result[0];
}

export async function getMeasurementPointDefByCode(productModelId: number, code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.productModelId, productModelId),
      eq(measurementPointDefs.code, code)
    ))
    .limit(1);
  return result[0];
}

export async function updateMeasurementPointDef(id: number, data: Partial<InsertMeasurementPointDef>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementPointDefs).set(data).where(eq(measurementPointDefs.id, id));
}

export async function deleteMeasurementPointDef(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementPointDefs).set({ isActive: false }).where(eq(measurementPointDefs.id, id));
}

// ============ MEASUREMENT RESULT FUNCTIONS ============
export async function createMeasurementResult(data: InsertMeasurementResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(measurementResults).values(data);
  return result[0].id;
}

export async function createMeasurementResults(dataList: InsertMeasurementResult[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataList.length === 0) return;
  await db.insert(measurementResults).values(dataList);
}

export async function getMeasurementResultsByInspection(inspectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurementResults)
    .where(eq(measurementResults.inspectionId, inspectionId))
    .orderBy(measurementResults.id);
}

export async function getMeasurementResultById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(measurementResults).where(eq(measurementResults.id, id)).limit(1);
  return result[0];
}

export async function updateMeasurementResultRemark(id: number, remark: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(measurementResults).set({ remark }).where(eq(measurementResults.id, id));
}

// ============ FACTORY LAYOUT FUNCTIONS ============
export async function createFactoryLayout(data: InsertFactoryLayout) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(factoryLayouts).values(data);
  return result[0].id;
}

export async function getFactoryLayoutsByWorkshop(workshopId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryLayouts)
    .where(and(eq(factoryLayouts.workshopId, workshopId), eq(factoryLayouts.isActive, true)))
    .orderBy(factoryLayouts.name);
}

export async function getFactoryLayoutsByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryLayouts)
    .where(and(eq(factoryLayouts.factoryId, factoryId), eq(factoryLayouts.isActive, true)))
    .orderBy(factoryLayouts.name);
}

export async function getCorporationLayouts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryLayouts)
    .where(and(eq(factoryLayouts.layoutLevel, "CORPORATION"), eq(factoryLayouts.isActive, true)))
    .orderBy(factoryLayouts.name);
}

export async function getFactoryLayoutById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(factoryLayouts).where(eq(factoryLayouts.id, id)).limit(1);
  return result[0];
}

export async function updateFactoryLayout(id: number, data: Partial<InsertFactoryLayout>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factoryLayouts).set(data).where(eq(factoryLayouts.id, id));
}

// ============ MACHINE POSITION FUNCTIONS ============
export async function createMachinePosition(data: InsertMachinePosition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(machinePositions).values(data);
  return result[0].id;
}

export async function getMachinePositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machinePositions).where(eq(machinePositions.layoutId, layoutId));
}

export async function updateMachinePosition(id: number, data: Partial<InsertMachinePosition>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machinePositions).set(data).where(eq(machinePositions.id, id));
}

export async function deleteMachinePosition(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(machinePositions).where(eq(machinePositions.id, id));
}

// ============ WORKSHOP POSITION FUNCTIONS ============
export async function createWorkshopPosition(data: InsertWorkshopPosition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(workshopPositions).values(data);
  return result[0].id;
}

export async function getWorkshopPositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshopPositions).where(eq(workshopPositions.layoutId, layoutId));
}

// ============ FACTORY POSITION FUNCTIONS ============
export async function createFactoryPosition(data: InsertFactoryPosition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(factoryPositions).values(data);
  return result[0].id;
}

export async function getFactoryPositionsByLayout(layoutId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryPositions).where(eq(factoryPositions.layoutId, layoutId));
}

// ============ DAILY STATISTICS FUNCTIONS ============
export async function upsertDailyStatistics(data: InsertDailyStatistics) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(dailyStatistics).values(data).onConflictDoUpdate({
    target: [dailyStatistics.machineId, dailyStatistics.date],
    set: {
      totalCount: data.totalCount,
      okCount: data.okCount,
      ngCount: data.ngCount,
      ntfCount: data.ntfCount,
      yieldRate: data.yieldRate,
    }
  });
}

export async function getDailyStatistics(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
} | number, startDateArg?: Date, endDateArg?: Date) {
  const db = await getDb();
  if (!db) return [];

  // Support both old and new API
  let machineId: number | undefined;
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (typeof params === 'number') {
    // Old API: getDailyStatistics(machineId, startDate, endDate)
    machineId = params;
    startDate = startDateArg;
    endDate = endDateArg;
  } else {
    // New API: getDailyStatistics({ machineId?, startDate?, endDate? })
    machineId = params.machineId;
    startDate = params.startDate;
    endDate = params.endDate;
  }

  const conditions = [];
  if (machineId) conditions.push(eq(dailyStatistics.machineId, machineId));
  if (startDate) conditions.push(gte(dailyStatistics.date, startDate));
  if (endDate) conditions.push(lte(dailyStatistics.date, endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // If no machineId, aggregate across all machines
  if (!machineId) {
    const result = await db.select({
      date: dailyStatistics.date,
      okCount: sql<number>`SUM(${dailyStatistics.okCount})`.as('ok_count'),
      ngCount: sql<number>`SUM(${dailyStatistics.ngCount})`.as('ng_count'),
      ntfCount: sql<number>`SUM(${dailyStatistics.ntfCount})`.as('ntf_count'),
    })
      .from(dailyStatistics)
      .where(whereClause)
      .groupBy(dailyStatistics.date)
      .orderBy(dailyStatistics.date);
    
    return result.map(r => ({
      date: r.date,
      okCount: Number(r.okCount) || 0,
      ngCount: Number(r.ngCount) || 0,
      ntfCount: Number(r.ntfCount) || 0,
    }));
  }

  return db.select().from(dailyStatistics)
    .where(whereClause)
    .orderBy(dailyStatistics.date);
}

// ============ DASHBOARD STATS FUNCTIONS ============
export async function getDashboardStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };

  // Build conditions for inspections
  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters?.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

  // If factory or workshop filter, need to join with machines
  if (filters?.factoryId || filters?.workshopId) {
    // Get machine IDs first
    const machineConditions = [];
    if (filters?.factoryId) {
      const workshopsInFactory = await db.select({ id: workshops.id }).from(workshops)
        .where(eq(workshops.factoryId, filters.factoryId));
      const workshopIds = workshopsInFactory.map(w => w.id);
      
      if (workshopIds.length > 0) {
        const linesInWorkshops = await db.select({ id: productionLines.id }).from(productionLines)
          .where(sql`${productionLines.workshopId} IN (${workshopIds.join(',')})`);
        const lineIds = linesInWorkshops.map(l => l.id);
        
        if (lineIds.length > 0) {
          const stationsInLines = await db.select({ id: stations.id }).from(stations)
            .where(sql`${stations.lineId} IN (${lineIds.join(',')})`);
          const stationIds = stationsInLines.map(s => s.id);
          
          if (stationIds.length > 0) {
            const machinesInStations = await db.select({ id: machines.id }).from(machines)
              .where(sql`${machines.stationId} IN (${stationIds.join(',')})`);
            const machineIds = machinesInStations.map(m => m.id);
            
            if (machineIds.length > 0) {
              conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
            } else {
              return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };
            }
          }
        }
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
  }).from(productInspections).where(whereClause);

  const stats = result[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const total = Number(stats.total) || 0;
  const ok = Number(stats.ok) || 0;
  const ng = Number(stats.ng) || 0;
  const ntf = Number(stats.ntf) || 0;
  const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

  return { total, ok, ng, ntf, yieldRate: Math.round(yieldRate * 100) / 100 };
}

export async function getMachineStats(machineId: number, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };

  const conditions = [eq(productInspections.machineId, machineId)];
  if (startDate) conditions.push(gte(productInspections.inspectionTime, startDate));
  if (endDate) conditions.push(lte(productInspections.inspectionTime, endDate));

  const result = await db.select({
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
  }).from(productInspections).where(and(...conditions));

  const stats = result[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const total = Number(stats.total) || 0;
  const ok = Number(stats.ok) || 0;
  const ng = Number(stats.ng) || 0;
  const ntf = Number(stats.ntf) || 0;
  const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

  return { total, ok, ng, ntf, yieldRate: Math.round(yieldRate * 100) / 100 };
}

// ============ STATS WITH COMPARISON ============
export async function getStatsWithComparison(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  // Get current period stats
  const currentStats = await getDashboardStats(filters);
  
  // Calculate previous period (same duration)
  if (filters?.startDate && filters?.endDate) {
    const duration = filters.endDate.getTime() - filters.startDate.getTime();
    const prevEndDate = new Date(filters.startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - duration);
    
    const prevStats = await getDashboardStats({
      ...filters,
      startDate: prevStartDate,
      endDate: prevEndDate,
    });
    
    // Calculate trends
    const outputTrend = prevStats.total > 0 
      ? ((currentStats.total - prevStats.total) / prevStats.total) * 100 
      : 0;
    const fpyTrend = prevStats.yieldRate > 0 
      ? currentStats.yieldRate - prevStats.yieldRate 
      : 0;
    
    return {
      current: currentStats,
      previous: prevStats,
      trends: {
        output: Math.round(outputTrend * 10) / 10,
        fpy: Math.round(fpyTrend * 10) / 10,
        ok: prevStats.ok > 0 ? Math.round(((currentStats.ok - prevStats.ok) / prevStats.ok) * 1000) / 10 : 0,
        ng: prevStats.ng > 0 ? Math.round(((currentStats.ng - prevStats.ng) / prevStats.ng) * 1000) / 10 : 0,
        ntf: prevStats.ntf > 0 ? Math.round(((currentStats.ntf - prevStats.ntf) / prevStats.ntf) * 1000) / 10 : 0,
      }
    };
  }
  
  return {
    current: currentStats,
    previous: null,
    trends: null,
  };
}

// ============ SHIFT STATS ============
export async function getShiftStats(filters?: {
  factoryId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Define shifts: Morning (6-14), Afternoon (14-22), Night (22-6)
  // Use alias for TiDB compatibility in GROUP BY
  const shiftExpr = sql<string>`CASE 
    WHEN HOUR(${productInspections.inspectionTime}) >= 6 AND HOUR(${productInspections.inspectionTime}) < 14 THEN 'morning'
    WHEN HOUR(${productInspections.inspectionTime}) >= 14 AND HOUR(${productInspections.inspectionTime}) < 22 THEN 'afternoon'
    ELSE 'night'
  END`;
  
  const result = await db.select({
    shift: shiftExpr.as('shift'),
    total: sql<number>`count(*)`.as('total'),
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`.as('ok'),
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`.as('ng'),
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`.as('ntf'),
  })
  .from(productInspections)
  .where(whereClause)
  .groupBy(sql`shift`);

  return result.map(r => ({
    shift: String(r.shift),
    shiftName: r.shift === 'morning' ? 'Ca sáng (6h-14h)' : r.shift === 'afternoon' ? 'Ca chiều (14h-22h)' : 'Ca đêm (22h-6h)',
    total: Number(r.total) || 0,
    ok: Number(r.ok) || 0,
    ng: Number(r.ng) || 0,
    ntf: Number(r.ntf) || 0,
    fpy: Number(r.total) > 0 ? Math.round(((Number(r.ok) + Number(r.ntf)) / Number(r.total)) * 1000) / 10 : 0,
  }));
}

// ============ TOP/BOTTOM MACHINES ============
export async function getTopBottomMachines(filters?: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return { top: [], bottom: [] };

  const conditions = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filters?.limit || 5;

  const result = await db.select({
    machineId: productInspections.machineId,
    total: sql<number>`count(*)`,
    ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
    ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
    ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
  })
  .from(productInspections)
  .where(whereClause)
  .groupBy(productInspections.machineId)
  .having(sql`count(*) > 0`);

  // Get machine details
  const machineDetails = await db.select().from(machines);
  const machineMap = new Map(machineDetails.map(m => [m.id, m]));

  const machinesWithStats = result.map(r => {
    const machine = machineMap.get(r.machineId!);
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ntf = Number(r.ntf) || 0;
    const fpy = total > 0 ? ((ok + ntf) / total) * 100 : 0;
    return {
      id: r.machineId,
      name: machine?.name || 'Unknown',
      code: machine?.code || '',
      total,
      ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0,
      ntf,
      fpy: Math.round(fpy * 10) / 10,
    };
  });

  // Sort by FPY for top/bottom
  const sorted = [...machinesWithStats].sort((a, b) => b.fpy - a.fpy);
  
  return {
    top: sorted.slice(0, limit),
    bottom: sorted.slice(-limit).reverse(),
  };
}

// ============ ACTIVE ALERTS COUNT ============
export async function getActiveAlertsCount() {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.select({
    count: sql<number>`count(*)`,
  })
  .from(alertHistory)
  .where(sql`${alertHistory.acknowledgedAt} IS NULL`);

  return Number(result[0]?.count) || 0;
}

// ============ DAILY STATS ============
export async function getDailyStats(factoryId?: number, workshopId?: number, days: number = 30) {
  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

  // Use raw SQL for TiDB compatibility - GROUP BY with alias
  const result = await db.execute(sql.raw(`
    SELECT 
      DATE_FORMAT(inspectionTime, '%Y-%m-%d') as date,
      COUNT(*) as totalProducts,
      SUM(CASE WHEN overallResult = 'OK' THEN 1 ELSE 0 END) as okCount,
      SUM(CASE WHEN overallResult = 'NG' THEN 1 ELSE 0 END) as ngCount,
      SUM(CASE WHEN overallResult = 'NTF' THEN 1 ELSE 0 END) as ntfCount
    FROM product_inspections
    WHERE inspectionTime >= '${startDateStr}'
    GROUP BY date
    ORDER BY date DESC
  `));

  const rows = (result as any)[0] || [];
  return rows.map((r: any) => ({
    date: String(r.date),
    totalProducts: Number(r.totalProducts) || 0,
    okCount: Number(r.okCount) || 0,
    ngCount: Number(r.ngCount) || 0,
    ntfCount: Number(r.ntfCount) || 0,
  }));
}

// ============ HOURLY STATS ============
export async function getHourlyStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
  hours?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const hoursBack = filters?.hours || 24;
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hoursBack);
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

  // Use raw SQL for TiDB compatibility - GROUP BY with alias
  let machineCondition = '';
  if (filters?.machineId) {
    machineCondition = ` AND machineId = ${filters.machineId}`;
  }

  const result = await db.execute(sql.raw(`
    SELECT 
      DATE_FORMAT(inspectionTime, '%Y-%m-%d %H:00') as hour,
      COUNT(*) as totalProducts,
      SUM(CASE WHEN overallResult = 'OK' THEN 1 ELSE 0 END) as okCount,
      SUM(CASE WHEN overallResult = 'NG' THEN 1 ELSE 0 END) as ngCount,
      SUM(CASE WHEN overallResult = 'NTF' THEN 1 ELSE 0 END) as ntfCount
    FROM product_inspections
    WHERE inspectionTime >= '${startDateStr}'${machineCondition}
    GROUP BY hour
    ORDER BY hour ASC
  `));

  const rows = (result as any)[0] || [];
  return rows.map((r: any) => {
    const total = Number(r.totalProducts) || 1;
    const ok = Number(r.okCount) || 0;
    const ng = Number(r.ngCount) || 0;
    const ntf = Number(r.ntfCount) || 0;
    return {
      hour: String(r.hour),
      total,
      ok,
      ng,
      ntf,
      fpy: ((ok / total) * 100).toFixed(1),
      fy: ((ng / total) * 100).toFixed(1),
      ntfy: ((ntf / total) * 100).toFixed(1),
    };
  });
}

// ============ SEARCH INSPECTIONS ============
export async function searchInspections(params: {
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stationCode?: string;
  machineCode?: string;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };

  // Build machine IDs from hierarchy filters
  let machineIds: number[] | undefined;

  if (params.machineCode) {
    const machineResult = await db.select({ id: machines.id }).from(machines)
      .where(like(machines.code, `%${params.machineCode}%`));
    machineIds = machineResult.map(m => m.id);
  } else if (params.stationCode || params.lineCode || params.workshopCode || params.factoryCode) {
    // Build hierarchy filter
    let stationIds: number[] | undefined;
    let lineIds: number[] | undefined;
    let workshopIds: number[] | undefined;

    if (params.factoryCode) {
      const factoryResult = await db.select({ id: factories.id }).from(factories)
        .where(like(factories.code, `%${params.factoryCode}%`));
      if (factoryResult.length > 0) {
        const workshopResult = await db.select({ id: workshops.id }).from(workshops)
          .where(sql`${workshops.factoryId} IN (${factoryResult.map(f => f.id).join(',')})`);
        workshopIds = workshopResult.map(w => w.id);
      }
    }

    if (params.workshopCode) {
      const workshopResult = await db.select({ id: workshops.id }).from(workshops)
        .where(like(workshops.code, `%${params.workshopCode}%`));
      workshopIds = workshopIds 
        ? workshopIds.filter(id => workshopResult.some(w => w.id === id))
        : workshopResult.map(w => w.id);
    }

    if (workshopIds && workshopIds.length > 0) {
      const lineResult = await db.select({ id: productionLines.id }).from(productionLines)
        .where(sql`${productionLines.workshopId} IN (${workshopIds.join(',')})`);
      lineIds = lineResult.map(l => l.id);
    }

    if (params.lineCode) {
      const lineResult = await db.select({ id: productionLines.id }).from(productionLines)
        .where(like(productionLines.code, `%${params.lineCode}%`));
      lineIds = lineIds
        ? lineIds.filter(id => lineResult.some(l => l.id === id))
        : lineResult.map(l => l.id);
    }

    if (lineIds && lineIds.length > 0) {
      const stationResult = await db.select({ id: stations.id }).from(stations)
        .where(sql`${stations.lineId} IN (${lineIds.join(',')})`);
      stationIds = stationResult.map(s => s.id);
    }

    if (params.stationCode) {
      const stationResult = await db.select({ id: stations.id }).from(stations)
        .where(like(stations.code, `%${params.stationCode}%`));
      stationIds = stationIds
        ? stationIds.filter(id => stationResult.some(s => s.id === id))
        : stationResult.map(s => s.id);
    }

    if (stationIds && stationIds.length > 0) {
      const machineResult = await db.select({ id: machines.id }).from(machines)
        .where(sql`${machines.stationId} IN (${stationIds.join(',')})`);
      machineIds = machineResult.map(m => m.id);
    }
  }

  // Build inspection query
  const conditions = [];
  if (machineIds && machineIds.length > 0) {
    conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
  } else if (params.factoryCode || params.workshopCode || params.lineCode || params.stationCode || params.machineCode) {
    // No machines found matching filters
    return { data: [], total: 0 };
  }

  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.productModel) conditions.push(like(productInspections.productModel, `%${params.productModel}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db.select().from(productInspections)
      .where(whereClause)
      .orderBy(desc(productInspections.inspectionTime))
      .limit(params.limit || 50)
      .offset(params.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(productInspections).where(whereClause)
  ]);

  return { data, total: countResult[0]?.count || 0 };
}

// ============ TOP NG MEASUREMENT POINTS ============
export async function getTopNGMeasurementPoints(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(measurementResults.result, 'NG')];
  
  if (params.machineId) {
    // Get inspections for this machine first
    const inspectionIds = await db.select({ id: productInspections.id })
      .from(productInspections)
      .where(eq(productInspections.machineId, params.machineId));
    if (inspectionIds.length > 0) {
      conditions.push(sql`${measurementResults.inspectionId} IN (${inspectionIds.map(i => i.id).join(',')})`);
    } else {
      return [];
    }
  }

  if (params.startDate || params.endDate) {
    // Filter by inspection time
    const inspectionConditions = [];
    if (params.startDate) inspectionConditions.push(gte(productInspections.inspectionTime, params.startDate));
    if (params.endDate) inspectionConditions.push(lte(productInspections.inspectionTime, params.endDate));
    
    const inspectionIds = await db.select({ id: productInspections.id })
      .from(productInspections)
      .where(and(...inspectionConditions));
    
    if (inspectionIds.length > 0) {
      conditions.push(sql`${measurementResults.inspectionId} IN (${inspectionIds.map(i => i.id).join(',')})`);
    } else {
      return [];
    }
  }

  const result = await db.select({
    pointDefId: measurementResults.pointDefId,
    ngCount: sql<number>`count(*)`.as('ng_count'),
  })
    .from(measurementResults)
    .where(and(...conditions))
    .groupBy(measurementResults.pointDefId)
    .orderBy(desc(sql`ng_count`))
    .limit(params.limit || 10);

  // Get point definition details
  const pointDefIds = result.map(r => r.pointDefId);
  if (pointDefIds.length === 0) return [];

  const pointDefs = await db.select()
    .from(measurementPointDefs)
    .where(sql`${measurementPointDefs.id} IN (${pointDefIds.join(',')})`);

  const pointDefMap = new Map(pointDefs.map(p => [p.id, p]));

  // Get total NG count for percentage calculation
  const totalNGResult = await db.select({
    total: sql<number>`count(*)`.as('total'),
  })
    .from(measurementResults)
    .where(and(...conditions));
  const totalNG = totalNGResult[0]?.total || 0;

  return result.map(r => {
    const pointDef = pointDefMap.get(r.pointDefId);
    return {
      pointDefId: r.pointDefId,
      code: pointDef?.code || 'Unknown',
      name: pointDef?.name || 'Unknown',
      ngCount: Number(r.ngCount),
      percentage: totalNG > 0 ? (Number(r.ngCount) / totalNG * 100) : 0,
    };
  });
}

// ============ SEED DATA FUNCTIONS ============
export async function seedSampleData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if data already exists
  const existingFactories = await db.select().from(factories).limit(1);
  if (existingFactories.length > 0) {
    return { message: "Sample data already exists" };
  }

  // Create 3 factories
  const factoryData = [
    { code: "FAC-HN", name: "Nhà máy Hà Nội", address: "Khu CN Thăng Long, Hà Nội", region: "Miền Bắc", country: "Vietnam" },
    { code: "FAC-DN", name: "Nhà máy Đà Nẵng", address: "Khu CN Hòa Khánh, Đà Nẵng", region: "Miền Trung", country: "Vietnam" },
    { code: "FAC-HCM", name: "Nhà máy TP.HCM", address: "Khu CN Tân Bình, TP.HCM", region: "Miền Nam", country: "Vietnam" },
  ];

  const factoryIds: number[] = [];
  for (const factory of factoryData) {
    const result = await db.insert(factories).values(factory);
    factoryIds.push(result[0].id);
  }

  // Create 2-4 workshops per factory
  const workshopData = [
    // Hà Nội - 3 workshops
    { factoryId: factoryIds[0], code: "WS-HN-01", name: "Xưởng lắp ráp A", floorArea: "2500" },
    { factoryId: factoryIds[0], code: "WS-HN-02", name: "Xưởng lắp ráp B", floorArea: "2000" },
    { factoryId: factoryIds[0], code: "WS-HN-03", name: "Xưởng kiểm tra", floorArea: "1500" },
    // Đà Nẵng - 2 workshops
    { factoryId: factoryIds[1], code: "WS-DN-01", name: "Xưởng sản xuất 1", floorArea: "3000" },
    { factoryId: factoryIds[1], code: "WS-DN-02", name: "Xưởng sản xuất 2", floorArea: "2500" },
    // HCM - 4 workshops
    { factoryId: factoryIds[2], code: "WS-HCM-01", name: "Xưởng SMT", floorArea: "4000" },
    { factoryId: factoryIds[2], code: "WS-HCM-02", name: "Xưởng Assembly", floorArea: "3500" },
    { factoryId: factoryIds[2], code: "WS-HCM-03", name: "Xưởng Testing", floorArea: "2000" },
    { factoryId: factoryIds[2], code: "WS-HCM-04", name: "Xưởng Packing", floorArea: "1500" },
  ];

  const workshopIds: number[] = [];
  for (const workshop of workshopData) {
    const result = await db.insert(workshops).values(workshop);
    workshopIds.push(result[0].id);
  }

  // Create production lines
  const lineData = [
    { workshopId: workshopIds[0], code: "LINE-HN-A1", name: "Dây chuyền A1" },
    { workshopId: workshopIds[0], code: "LINE-HN-A2", name: "Dây chuyền A2" },
    { workshopId: workshopIds[1], code: "LINE-HN-B1", name: "Dây chuyền B1" },
    { workshopId: workshopIds[3], code: "LINE-DN-01", name: "Dây chuyền 1" },
    { workshopId: workshopIds[5], code: "LINE-HCM-SMT1", name: "SMT Line 1" },
    { workshopId: workshopIds[5], code: "LINE-HCM-SMT2", name: "SMT Line 2" },
    { workshopId: workshopIds[6], code: "LINE-HCM-ASM1", name: "Assembly Line 1" },
  ];

  const lineIds: number[] = [];
  for (const line of lineData) {
    const result = await db.insert(productionLines).values(line);
    lineIds.push(result[0].id);
  }

  // Create stations
  const stationData = [
    { lineId: lineIds[0], code: "ST-HN-A1-01", name: "Trạm kiểm tra 1", orderIndex: 1 },
    { lineId: lineIds[0], code: "ST-HN-A1-02", name: "Trạm kiểm tra 2", orderIndex: 2 },
    { lineId: lineIds[4], code: "ST-HCM-SMT1-01", name: "AOI Station 1", orderIndex: 1 },
    { lineId: lineIds[4], code: "ST-HCM-SMT1-02", name: "AOI Station 2", orderIndex: 2 },
    { lineId: lineIds[6], code: "ST-HCM-ASM1-01", name: "AVI Station 1", orderIndex: 1 },
  ];

  const stationIds: number[] = [];
  for (const station of stationData) {
    const result = await db.insert(stations).values(station);
    stationIds.push(result[0].id);
  }

  // Create machines with API keys
  const { nanoid } = await import("nanoid");
  const machineData = [
    { stationId: stationIds[0], code: "AVI-HN-001", name: "AVI Machine 1", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[0], code: "AVI-HN-002", name: "AVI Machine 2", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[1], code: "AOI-HN-001", name: "AOI Machine 1", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[2], code: "AOI-HCM-001", name: "AOI SMT 1", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[3], code: "AOI-HCM-002", name: "AOI SMT 2", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[4], code: "AVI-HCM-001", name: "AVI Assembly 1", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
  ];

  for (const machine of machineData) {
    await db.insert(machines).values(machine);
  }

  // Create sample product model
  const [productModelResult] = await db.insert(productModels).values({
    code: "PCB-001",
    name: "PCB Main Board v1.0",
    description: "Main circuit board for electronic device",
    imageWidth: 1920,
    imageHeight: 1080,
  }).returning({ id: productModels.id });
  const productModelId = productModelResult.id;

  // Create sample measurement points (30 points)
  const measurementTypes = ["DIMENSION", "VISUAL", "POSITION", "COLOR", "SURFACE"] as const;
  for (let i = 1; i <= 30; i++) {
    await db.insert(measurementPointDefs).values({
      productModelId,
      code: `MP-${String(i).padStart(3, '0')}`,
      name: `Measurement Point ${i}`,
      measurementType: measurementTypes[i % measurementTypes.length],
      positionX: 50 + (i % 10) * 180,
      positionY: 50 + Math.floor(i / 10) * 300,
      radius: 15 + (i % 3) * 5,
      orderIndex: i,
    });
  }

  return { 
    message: "Sample data created successfully",
    factories: factoryIds.length,
    workshops: workshopIds.length,
    lines: lineIds.length,
    stations: stationIds.length,
    machines: machineData.length,
    productModels: 1,
    measurementPoints: 30
  };
}

// ============ ALERT SETTINGS FUNCTIONS ============
export async function getAlertSettings(userId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (userId) {
    return db.select().from(alertSettings)
      .where(eq(alertSettings.userId, userId))
      .orderBy(desc(alertSettings.createdAt));
  }
  return db.select().from(alertSettings)
    .orderBy(desc(alertSettings.createdAt));
}

export async function getAlertSettingById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(alertSettings)
    .where(eq(alertSettings.id, id))
    .limit(1);
  return result[0];
}

export async function createAlertSetting(data: InsertAlertSetting) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(alertSettings).values(data);
  return { id: result[0].id };
}

export async function updateAlertSetting(id: number, data: Partial<InsertAlertSetting>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(alertSettings).set(data).where(eq(alertSettings.id, id));
}

export async function deleteAlertSetting(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(alertSettings).where(eq(alertSettings.id, id));
}

export async function getAlertHistory(alertSettingId?: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  if (alertSettingId) {
    return db.select().from(alertHistory)
      .where(eq(alertHistory.alertSettingId, alertSettingId))
      .orderBy(desc(alertHistory.createdAt))
      .limit(limit);
  }
  return db.select().from(alertHistory)
    .orderBy(desc(alertHistory.createdAt))
    .limit(limit);
}

export async function createAlertHistory(data: InsertAlertHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(alertHistory).values(data);
  return { id: result[0].id };
}

export async function acknowledgeAlert(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(alertHistory).set({
    acknowledgedAt: new Date(),
    acknowledgedBy: userId,
  }).where(eq(alertHistory.id, id));
}

// Generate sample inspection data for testing
export async function seedInspectionData(count: number = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all machines
  const allMachines = await db.select().from(machines).where(eq(machines.isActive, true));
  if (allMachines.length === 0) {
    throw new Error("No machines found. Please seed sample data first.");
  }

  // Get product model with measurement points
  const productModel = await db.select().from(productModels).limit(1);
  if (productModel.length === 0) {
    throw new Error("No product model found. Please seed sample data first.");
  }
  const productModelId = productModel[0].id;

  const measurementPoints = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.productModelId, productModelId));

  const results: string[] = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NTF']; // 80% OK, 10% NG, 10% NTF
  const ngReasons = ['Scratch detected', 'Dimension out of spec', 'Position shifted', 'Color mismatch', 'Surface defect'];
  
  let createdCount = 0;
  const now = new Date();

  for (let i = 0; i < count; i++) {
    // Random machine
    const machine = allMachines[Math.floor(Math.random() * allMachines.length)];
    
    // Random date within last 30 days
    const inspectionDate = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    // Generate serial number
    const serialNumber = `SN-${inspectionDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(5, '0')}`;
    
    // Determine overall result
    const overallResult = results[Math.floor(Math.random() * results.length)] as 'OK' | 'NG' | 'NTF';
    
    // Create inspection record
    const [inspectionResult] = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)), // 1-6 seconds
    }).returning({ id: productInspections.id });
    const inspectionId = inspectionResult.id;

    // Create measurement results for each point
    for (const point of measurementPoints) {
      // If overall is NG, make 1-3 points NG
      let pointResult: 'OK' | 'NG' = 'OK';
      if (overallResult === 'NG' || overallResult === 'NTF') {
        // 10-20% chance each point is NG when overall is NG
        if (Math.random() < 0.15) {
          pointResult = 'NG';
        }
      }

      await db.insert(measurementResults).values({
        inspectionId,
        pointDefId: point.id,
        result: pointResult,
        measuredValue: pointResult === 'OK' ? (Math.random() * 0.1 + 0.95).toFixed(3) : (Math.random() * 0.2 + 0.7).toFixed(3),
        remark: pointResult === 'NG' ? ngReasons[Math.floor(Math.random() * ngReasons.length)] : null,
      });
    }

    createdCount++;
  }

  return {
    message: `Created ${createdCount} inspection records with measurement results`,
    inspections: createdCount,
    measurementResultsPerInspection: measurementPoints.length,
  };
}


// ============ PRODUCT-MACHINE MAPPING FUNCTIONS ============
export async function getProductMachineMappings(machineId?: number, productModelId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(productMachineMappings);
  
  if (machineId) {
    query = query.where(eq(productMachineMappings.machineId, machineId)) as typeof query;
  }
  if (productModelId) {
    query = query.where(eq(productMachineMappings.productModelId, productModelId)) as typeof query;
  }
  
  return query.orderBy(desc(productMachineMappings.priority));
}

export async function createProductMachineMapping(data: InsertProductMachineMapping) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productMachineMappings).values(data);
  return { id: result[0].id };
}

export async function updateProductMachineMapping(id: number, data: Partial<InsertProductMachineMapping>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productMachineMappings).set(data).where(eq(productMachineMappings.id, id));
}

export async function deleteProductMachineMapping(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(productMachineMappings).where(eq(productMachineMappings.id, id));
}

export async function getMappingsByMachine(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    mapping: productMachineMappings,
    product: productModels,
  })
  .from(productMachineMappings)
  .innerJoin(productModels, eq(productMachineMappings.productModelId, productModels.id))
  .where(eq(productMachineMappings.machineId, machineId))
  .orderBy(desc(productMachineMappings.priority));
}

export async function getMappingsByProduct(productModelId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    mapping: productMachineMappings,
    machine: machines,
  })
  .from(productMachineMappings)
  .innerJoin(machines, eq(productMachineMappings.machineId, machines.id))
  .where(eq(productMachineMappings.productModelId, productModelId))
  .orderBy(desc(productMachineMappings.priority));
}

// ============ SHIFT CONFIG FUNCTIONS ============
export async function getShiftConfigs(factoryId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (factoryId) {
    return db.select().from(shiftConfigs)
      .where(or(eq(shiftConfigs.factoryId, factoryId), isNull(shiftConfigs.factoryId)))
      .orderBy(shiftConfigs.orderIndex);
  }
  
  return db.select().from(shiftConfigs).orderBy(shiftConfigs.orderIndex);
}

export async function createShiftConfig(data: InsertShiftConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(shiftConfigs).values(data);
  return { id: result[0].id };
}

export async function updateShiftConfig(id: number, data: Partial<InsertShiftConfig>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(shiftConfigs).set(data).where(eq(shiftConfigs.id, id));
}

export async function deleteShiftConfig(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(shiftConfigs).where(eq(shiftConfigs.id, id));
}

export async function getDefaultShiftConfigs() {
  const db = await getDb();
  if (!db) return [];
  
  // Get global shifts (factoryId is null)
  return db.select().from(shiftConfigs)
    .where(isNull(shiftConfigs.factoryId))
    .orderBy(shiftConfigs.orderIndex);
}


// ============ PRODUCTION ORDER FUNCTIONS ============
export async function getProductionOrders(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  status?: string;
  companyCode?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  if (filters?.factoryId) conditions.push(eq(productionOrders.factoryId, filters.factoryId));
  if (filters?.workshopId) conditions.push(eq(productionOrders.workshopId, filters.workshopId));
  if (filters?.lineId) conditions.push(eq(productionOrders.lineId, filters.lineId));
  if (filters?.status) conditions.push(eq(productionOrders.status, filters.status as any));
  if (filters?.companyCode) conditions.push(eq(productionOrders.companyCode, filters.companyCode));
  
  return db.select().from(productionOrders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionOrders.createdAt));
}

export async function getProductionOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(productionOrders).where(eq(productionOrders.id, id));
  return result[0] || null;
}

export async function getProductionOrderByCode(orderCode: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(productionOrders).where(eq(productionOrders.orderCode, orderCode));
  return result[0] || null;
}

export async function createProductionOrder(data: InsertProductionOrder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productionOrders).values(data);
  return result;
}

export async function updateProductionOrder(id: number, data: Partial<InsertProductionOrder>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(productionOrders).set(data).where(eq(productionOrders.id, id));
}

export async function deleteProductionOrder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(productionOrders).where(eq(productionOrders.id, id));
}

export async function updateProductionOrderQuantities(id: number, result: 'OK' | 'NG' | 'NTF') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const order = await getProductionOrderById(id);
  if (!order) throw new Error("Production order not found");
  
  const updates: Partial<InsertProductionOrder> = {
    completedQuantity: order.completedQuantity + 1,
  };
  
  if (result === 'OK') updates.okQuantity = order.okQuantity + 1;
  else if (result === 'NG') updates.ngQuantity = order.ngQuantity + 1;
  else if (result === 'NTF') updates.ntfQuantity = order.ntfQuantity + 1;
  
  // Auto update status
  if (updates.completedQuantity! >= order.targetQuantity) {
    updates.status = 'completed';
    updates.actualEndDate = new Date();
  } else if (order.status === 'pending') {
    updates.status = 'in_progress';
    updates.actualStartDate = new Date();
  }
  
  return db.update(productionOrders).set(updates).where(eq(productionOrders.id, id));
}

// ============ LINE STAGE FUNCTIONS ============
export async function getLineStages(lineId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (lineId) {
    return db.select().from(lineStages)
      .where(eq(lineStages.lineId, lineId))
      .orderBy(lineStages.orderIndex);
  }
  
  return db.select().from(lineStages).orderBy(lineStages.orderIndex);
}

export async function getLineStageById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(lineStages).where(eq(lineStages.id, id));
  return result[0] || null;
}

export async function createLineStage(data: InsertLineStage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(lineStages).values(data);
  return result;
}

export async function updateLineStage(id: number, data: Partial<InsertLineStage>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(lineStages).set(data).where(eq(lineStages.id, id));
}

export async function deleteLineStage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(lineStages).where(eq(lineStages.id, id));
}

export async function reorderLineStages(lineId: number, stageIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Update orderIndex for each stage based on position in array
  for (let i = 0; i < stageIds.length; i++) {
    await db.update(lineStages)
      .set({ orderIndex: i })
      .where(and(eq(lineStages.id, stageIds[i]), eq(lineStages.lineId, lineId)));
  }
}

// ============ LINE PRODUCT ASSIGNMENT FUNCTIONS ============
export async function getLineProductAssignments(filters?: {
  lineId?: number;
  productModelId?: number;
  productionOrderId?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  if (filters?.lineId) conditions.push(eq(lineProductAssignments.lineId, filters.lineId));
  if (filters?.productModelId) conditions.push(eq(lineProductAssignments.productModelId, filters.productModelId));
  if (filters?.productionOrderId) conditions.push(eq(lineProductAssignments.productionOrderId, filters.productionOrderId));
  if (filters?.isActive !== undefined) conditions.push(eq(lineProductAssignments.isActive, filters.isActive));
  
  return db.select().from(lineProductAssignments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(lineProductAssignments.createdAt));
}

export async function createLineProductAssignment(data: InsertLineProductAssignment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(lineProductAssignments).values(data);
  return result;
}

export async function updateLineProductAssignment(id: number, data: Partial<InsertLineProductAssignment>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(lineProductAssignments).set(data).where(eq(lineProductAssignments.id, id));
}

export async function deleteLineProductAssignment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.delete(lineProductAssignments).where(eq(lineProductAssignments.id, id));
}

// ============ WORKSHOP LAYOUT FUNCTIONS ============
export async function getWorkshopLayoutsWithMachines(workshopId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // Get workshop layout
  const layouts = await db.select().from(factoryLayouts)
    .where(and(
      eq(factoryLayouts.workshopId, workshopId),
      eq(factoryLayouts.layoutLevel, 'WORKSHOP')
    ));
  
  if (layouts.length === 0) return null;
  
  const layout = layouts[0];
  
  // Get machine positions for this layout
  const positions = await db.select({
    position: machinePositions,
    machine: machines
  })
    .from(machinePositions)
    .innerJoin(machines, eq(machinePositions.machineId, machines.id))
    .where(eq(machinePositions.layoutId, layout.id));
  
  return {
    layout,
    machinePositions: positions
  };
}

export async function getFactoryLayoutsWithWorkshops(factoryId: number) {
  const db = await getDb();
  if (!db) return null;
  
  // Get factory layout
  const layouts = await db.select().from(factoryLayouts)
    .where(and(
      eq(factoryLayouts.factoryId, factoryId),
      eq(factoryLayouts.layoutLevel, 'FACTORY')
    ));
  
  if (layouts.length === 0) return null;
  
  const layout = layouts[0];
  
  // Get workshop positions for this layout
  const positions = await db.select({
    position: workshopPositions,
    workshop: workshops
  })
    .from(workshopPositions)
    .innerJoin(workshops, eq(workshopPositions.workshopId, workshops.id))
    .where(eq(workshopPositions.layoutId, layout.id));
  
  return {
    layout,
    workshopPositions: positions
  };
}


// ============ MACHINE STATUS LOGS ============
export async function createMachineStatusLog(data: InsertMachineStatusLog) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(machineStatusLogs).values(data);
  return result[0].id;
}

export async function getMachineStatusLogs(machineId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(machineStatusLogs)
    .where(eq(machineStatusLogs.machineId, machineId))
    .orderBy(desc(machineStatusLogs.timestamp))
    .limit(limit);
}

export async function getLatestMachineStatus(machineId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(machineStatusLogs)
    .where(eq(machineStatusLogs.machineId, machineId))
    .orderBy(desc(machineStatusLogs.timestamp))
    .limit(1);

  return result[0] || null;
}

export async function getAllMachinesWithStatus() {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select({
    machine: machines,
    station: stations,
    line: productionLines,
    workshop: workshops,
    factory: factories
  })
    .from(machines)
    .innerJoin(stations, eq(machines.stationId, stations.id))
    .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
    .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .innerJoin(factories, eq(workshops.factoryId, factories.id))
    .where(eq(machines.isActive, true));

  const statusPromises = allMachines.map(async (m) => {
    const latestStatus = await getLatestMachineStatus(m.machine.id);
    const latestHeartbeat = await getLatestMachineHeartbeat(m.machine.id);
    const uptimeStats = await getMachineUptimeStats(m.machine.id, 24);
    
    return {
      ...m.machine,
      station: m.station,
      line: m.line,
      workshop: m.workshop,
      factory: m.factory,
      latestStatus: latestStatus?.status || 'offline',
      lastStatusChange: latestStatus?.timestamp || null,
      latestHeartbeat: latestHeartbeat?.timestamp || m.machine.lastHeartbeat || null,
      heartbeatStatus: latestHeartbeat?.status || 'stopped',
      uptimePercent: uptimeStats.uptimePercent,
      totalOnlineTime: uptimeStats.totalOnlineTime,
      totalOfflineTime: uptimeStats.totalOfflineTime,
    };
  });

  return Promise.all(statusPromises);
}

export async function getMachineUptimeStats(machineId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return { uptimePercent: 0, totalOnlineTime: 0, totalOfflineTime: 0 };

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const logs = await db.select()
    .from(machineStatusLogs)
    .where(and(
      eq(machineStatusLogs.machineId, machineId),
      gte(machineStatusLogs.timestamp, startTime)
    ))
    .orderBy(machineStatusLogs.timestamp);

  if (logs.length === 0) {
    return { uptimePercent: 0, totalOnlineTime: 0, totalOfflineTime: 0 };
  }

  let totalOnlineTime = 0;
  let totalOfflineTime = 0;
  
  for (let i = 0; i < logs.length - 1; i++) {
    const current = logs[i];
    const next = logs[i + 1];
    const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000;
    
    if (current.status === 'online') {
      totalOnlineTime += duration;
    } else {
      totalOfflineTime += duration;
    }
  }

  const lastLog = logs[logs.length - 1];
  const timeSinceLastLog = (Date.now() - new Date(lastLog.timestamp).getTime()) / 1000;
  if (lastLog.status === 'online') {
    totalOnlineTime += timeSinceLastLog;
  } else {
    totalOfflineTime += timeSinceLastLog;
  }

  const totalTime = totalOnlineTime + totalOfflineTime;
  const uptimePercent = totalTime > 0 ? Math.round((totalOnlineTime / totalTime) * 1000) / 10 : 0;

  return {
    uptimePercent,
    totalOnlineTime: Math.round(totalOnlineTime),
    totalOfflineTime: Math.round(totalOfflineTime),
  };
}

export async function markOfflineNotificationSent(logId: number) {
  const db = await getDb();
  if (!db) return;

  await db.update(machineStatusLogs)
    .set({ notificationSent: true })
    .where(eq(machineStatusLogs.id, logId));
}

export async function getUnnotifiedOfflineMachines(thresholdMinutes: number = 5) {
  const db = await getDb();
  if (!db) return [];

  const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  
  const offlineLogs = await db.select({
    log: machineStatusLogs,
    machine: machines
  })
    .from(machineStatusLogs)
    .innerJoin(machines, eq(machineStatusLogs.machineId, machines.id))
    .where(and(
      eq(machineStatusLogs.status, 'offline'),
      eq(machineStatusLogs.notificationSent, false),
      lte(machineStatusLogs.timestamp, thresholdTime)
    ));

  const machineLatestOffline = new Map<number, typeof offlineLogs[0]>();
  for (const log of offlineLogs) {
    const existing = machineLatestOffline.get(log.machine.id);
    if (!existing || new Date(log.log.timestamp) > new Date(existing.log.timestamp)) {
      machineLatestOffline.set(log.machine.id, log);
    }
  }

  return Array.from(machineLatestOffline.values());
}

// ============ MACHINE HEARTBEATS ============
export async function createMachineHeartbeat(data: InsertMachineHeartbeat) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(machineHeartbeats).values(data);
  return result[0].id;
}

export async function getMachineHeartbeats(machineId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return db.select()
    .from(machineHeartbeats)
    .where(eq(machineHeartbeats.machineId, machineId))
    .orderBy(desc(machineHeartbeats.timestamp))
    .limit(limit);
}

export async function getLatestMachineHeartbeat(machineId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select()
    .from(machineHeartbeats)
    .where(eq(machineHeartbeats.machineId, machineId))
    .orderBy(desc(machineHeartbeats.timestamp))
    .limit(1);

  return result[0] || null;
}

export async function getHeartbeatHistory(machineId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return [];

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return db.select()
    .from(machineHeartbeats)
    .where(and(
      eq(machineHeartbeats.machineId, machineId),
      gte(machineHeartbeats.timestamp, startTime)
    ))
    .orderBy(machineHeartbeats.timestamp);
}

// ============ BULK MEASUREMENT POINTS ============
export async function bulkCreateMeasurementPoints(points: InsertMeasurementPointDef[]) {
  const db = await getDb();
  if (!db) return { success: 0, failed: 0, errors: [] as string[] };

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const point of points) {
    try {
      await db.insert(measurementPointDefs).values(point);
      success++;
    } catch (error: any) {
      failed++;
      errors.push(`${point.code}: ${error.message}`);
    }
  }

  return { success, failed, errors };
}


// ============ UPTIME TIMELINE ============
export async function getUptimeTimeline(machineId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return [];

  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const logs = await db.select()
    .from(machineStatusLogs)
    .where(and(
      eq(machineStatusLogs.machineId, machineId),
      gte(machineStatusLogs.timestamp, startTime)
    ))
    .orderBy(machineStatusLogs.timestamp);

  // Build timeline segments
  const segments: Array<{
    start: Date;
    end: Date;
    status: string;
    duration: number;
  }> = [];

  if (logs.length === 0) {
    return segments;
  }

  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];
    const next = logs[i + 1];
    const endTime = next ? new Date(next.timestamp) : new Date();
    const duration = (endTime.getTime() - new Date(current.timestamp).getTime()) / 1000;

    segments.push({
      start: new Date(current.timestamp),
      end: endTime,
      status: current.status,
      duration: Math.round(duration),
    });
  }

  return segments;
}

export async function getAllMachinesUptimeTimeline(hours: number = 24) {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select({
    id: machines.id,
    code: machines.code,
    name: machines.name,
  })
    .from(machines)
    .where(eq(machines.isActive, true));

  const timelinePromises = allMachines.map(async (machine) => {
    const timeline = await getUptimeTimeline(machine.id, hours);
    const stats = await getMachineUptimeStats(machine.id, hours);
    return {
      machineId: machine.id,
      machineCode: machine.code,
      machineName: machine.name,
      timeline,
      uptimePercent: stats.uptimePercent,
      totalOnlineTime: stats.totalOnlineTime,
      totalOfflineTime: stats.totalOfflineTime,
    };
  });

  return Promise.all(timelinePromises);
}

// ============ ALERT CONFIGURATION ============
export async function getAlertConfiguration() {
  const db = await getDb();
  if (!db) return null;

  // Get from alertSettings table with type 'machine_offline'
  const result = await db.select()
    .from(alertSettings)
    .where(eq(alertSettings.alertType, 'machine_offline'))
    .limit(1);

  if (result.length === 0) {
    // Return default config
    return {
      id: null,
      thresholdMinutes: 5,
      isActive: true,
      notifyEmail: true,
      notifyInApp: true,
    };
  }

  const setting = result[0];
  return {
    id: setting.id,
    thresholdMinutes: setting.threshold ? Number(setting.threshold) : 5,
    isActive: setting.isActive,
    notifyEmail: setting.notifyEmail,
    notifyInApp: setting.notifyInApp,
  };
}

export async function updateAlertConfiguration(config: {
  thresholdMinutes: number;
  isActive: boolean;
}) {
  const db = await getDb();
  if (!db) return null;

  // Check if exists
  const existing = await db.select()
    .from(alertSettings)
    .where(eq(alertSettings.alertType, 'machine_offline'))
    .limit(1);

  if (existing.length === 0) {
    // Create new - need userId, use 0 for system alert
    const result = await db.insert(alertSettings).values({
      userId: 0, // System alert
      name: 'Machine Offline Alert',
      alertType: 'machine_offline',
      threshold: config.thresholdMinutes.toString(),
      isActive: config.isActive,
    });
    return result[0].id;
  } else {
    // Update existing
    await db.update(alertSettings)
      .set({
        threshold: config.thresholdMinutes.toString(),
        isActive: config.isActive,
        updatedAt: new Date(),
      })
      .where(eq(alertSettings.id, existing[0].id));
    return existing[0].id;
  }
}

// ============ MACHINE STATUS REPORT ============
export async function getMachineStatusReport(machineId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return null;

  const logs = await db.select()
    .from(machineStatusLogs)
    .where(and(
      eq(machineStatusLogs.machineId, machineId),
      gte(machineStatusLogs.timestamp, startDate),
      lte(machineStatusLogs.timestamp, endDate)
    ))
    .orderBy(machineStatusLogs.timestamp);

  const machine = await db.select()
    .from(machines)
    .where(eq(machines.id, machineId))
    .limit(1);

  if (!machine[0]) return null;

  // Calculate statistics
  let totalOnlineTime = 0;
  let totalOfflineTime = 0;
  let offlineCount = 0;
  let longestOffline = 0;
  let longestOnline = 0;

  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];
    const next = logs[i + 1];
    const endTime = next ? new Date(next.timestamp) : endDate;
    const duration = (endTime.getTime() - new Date(current.timestamp).getTime()) / 1000;

    if (current.status === 'online') {
      totalOnlineTime += duration;
      if (duration > longestOnline) longestOnline = duration;
    } else {
      totalOfflineTime += duration;
      offlineCount++;
      if (duration > longestOffline) longestOffline = duration;
    }
  }

  const totalTime = totalOnlineTime + totalOfflineTime;
  const uptimePercent = totalTime > 0 ? Math.round((totalOnlineTime / totalTime) * 1000) / 10 : 0;
  const mtbf = offlineCount > 0 ? Math.round(totalOnlineTime / offlineCount) : totalOnlineTime; // Mean Time Between Failures
  const mttr = offlineCount > 0 ? Math.round(totalOfflineTime / offlineCount) : 0; // Mean Time To Repair

  return {
    machine: machine[0],
    period: {
      start: startDate,
      end: endDate,
      totalHours: Math.round(totalTime / 3600 * 10) / 10,
    },
    statistics: {
      uptimePercent,
      totalOnlineTime: Math.round(totalOnlineTime),
      totalOfflineTime: Math.round(totalOfflineTime),
      offlineCount,
      longestOffline: Math.round(longestOffline),
      longestOnline: Math.round(longestOnline),
      mtbf: Math.round(mtbf),
      mttr: Math.round(mttr),
    },
    logs: logs.map(log => ({
      timestamp: log.timestamp,
      status: log.status,
      ipAddress: log.ipAddress,
    })),
  };
}


// ============ MANUAL MACHINE CONNECTIONS FUNCTIONS ============

export async function listManualConnections() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(manualMachineConnections).orderBy(desc(manualMachineConnections.createdAt));
}

export async function getManualConnectionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(manualMachineConnections).where(eq(manualMachineConnections.id, id));
  return results[0] || null;
}

export async function getManualConnectionByMachineId(machineId: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(manualMachineConnections).where(eq(manualMachineConnections.machineId, machineId));
  return results[0] || null;
}

export async function createManualConnection(data: InsertManualMachineConnection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(manualMachineConnections).values(data);
  return { id: Number(result[0].id) };
}

export async function updateManualConnection(id: number, data: Partial<InsertManualMachineConnection>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(manualMachineConnections).set(data).where(eq(manualMachineConnections.id, id));
}

export async function deleteManualConnection(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(manualMachineConnections).where(eq(manualMachineConnections.id, id));
}

export async function updateManualConnectionStatus(
  id: number, 
  status: 'connected' | 'disconnected' | 'error' | 'pending',
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: any = {
    connectionStatus: status,
    lastConnectionAttempt: new Date(),
  };
  
  if (status === 'connected') {
    updateData.lastSuccessfulConnection = new Date();
    updateData.retryCount = 0;
    updateData.errorMessage = null;
  } else if (status === 'error' && errorMessage) {
    updateData.errorMessage = errorMessage;
  }
  
  await db.update(manualMachineConnections).set(updateData).where(eq(manualMachineConnections.id, id));
}

export async function incrementManualConnectionRetry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(manualMachineConnections)
    .set({ 
      retryCount: sql`${manualMachineConnections.retryCount} + 1`,
      lastConnectionAttempt: new Date()
    })
    .where(eq(manualMachineConnections.id, id));
}

export async function getEnabledManualConnections() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(manualMachineConnections).where(eq(manualMachineConnections.isEnabled, true));
}


// ============ Yield Alert Thresholds ============

export async function getYieldAlertThresholds() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(yieldAlertThresholds).orderBy(yieldAlertThresholds.metricType);
}

export async function getYieldAlertThresholdById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.id, id));
  return results[0] || null;
}

export async function getYieldAlertThresholdByType(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH') {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.metricType, metricType));
  return results[0] || null;
}

export async function createYieldAlertThreshold(data: InsertYieldAlertThreshold) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(yieldAlertThresholds).values(data);
  return result[0].id;
}

export async function updateYieldAlertThreshold(id: number, data: Partial<InsertYieldAlertThreshold>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(yieldAlertThresholds).set(data).where(eq(yieldAlertThresholds.id, id));
}

export async function deleteYieldAlertThreshold(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(yieldAlertThresholds).where(eq(yieldAlertThresholds.id, id));
}

export async function getEnabledYieldAlertThresholds() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(yieldAlertThresholds).where(eq(yieldAlertThresholds.isEnabled, true));
}


// ==================== Yield Threshold History ====================

export async function createYieldThresholdHistory(data: InsertYieldThresholdHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(yieldThresholdHistory).values(data);
  return { id: Number(result[0].id), ...data };
}

export async function getYieldThresholdHistoryByThreshold(thresholdId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .where(eq(yieldThresholdHistory.thresholdId, thresholdId))
    .orderBy(desc(yieldThresholdHistory.createdAt));
}

export async function getYieldThresholdHistoryByType(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH') {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .where(eq(yieldThresholdHistory.metricType, metricType))
    .orderBy(desc(yieldThresholdHistory.createdAt));
}

export async function getAllYieldThresholdHistory(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(yieldThresholdHistory)
    .orderBy(desc(yieldThresholdHistory.createdAt))
    .limit(limit);
}

export async function getYieldThresholdHistoryWithComparison(metricType: 'FPY' | 'FY' | 'NTF' | 'UPH', days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return db.select()
    .from(yieldThresholdHistory)
    .where(
      and(
        eq(yieldThresholdHistory.metricType, metricType),
        gte(yieldThresholdHistory.createdAt, startDate)
      )
    )
    .orderBy(desc(yieldThresholdHistory.createdAt));
}


// ============ AUDIT LOG FUNCTIONS ============

export type AuditAction = 
  | 'login' | 'login_failed' | 'logout'
  | 'create' | 'update' | 'delete'
  | 'password_change' | 'role_change'
  | 'export' | 'import';

export type AuditEntityType = 
  | 'user' | 'machine' | 'product' | 'inspection'
  | 'factory' | 'workshop' | 'line' | 'station'
  | 'alert' | 'threshold' | 'mapping' | 'order';

export async function createAuditLog(data: {
  userId?: number | null;
  userName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  entityName?: string | null;
  details?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  status?: 'success' | 'failure';
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");
  
  const result = await db.insert(auditLogs).values({
    userId: data.userId ?? null,
    userName: data.userName ?? null,
    action: data.action,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    entityName: data.entityName ?? null,
    details: data.details ? JSON.stringify(data.details) : null,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
    status: data.status ?? 'success',
  });
  
  return { id: Number(result[0].id) };
}

export async function getAuditLogs(params: {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  status?: 'success' | 'failure';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{
  logs: Array<{
    id: number;
    userId: number | null;
    userName: string | null;
    action: string;
    entityType: string | null;
    entityId: number | null;
    entityName: string | null;
    details: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    status: 'success' | 'failure';
    createdAt: Date;
  }>;
  total: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");
  
  const conditions: string[] = [];
  const values: any[] = [];
  
  if (params.userId) {
    conditions.push("userId = ?");
    values.push(params.userId);
  }
  if (params.action) {
    conditions.push("action = ?");
    values.push(params.action);
  }
  if (params.entityType) {
    conditions.push("entityType = ?");
    values.push(params.entityType);
  }
  if (params.entityId) {
    conditions.push("entityId = ?");
    values.push(params.entityId);
  }
  if (params.status) {
    conditions.push("status = ?");
    values.push(params.status);
  }
  if (params.startDate) {
    conditions.push("createdAt >= ?");
    values.push(params.startDate);
  }
  if (params.endDate) {
    conditions.push("createdAt <= ?");
    values.push(params.endDate);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  
  // Build query with parameters
  let countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
  let selectQuery = `SELECT * FROM audit_logs ${whereClause} ORDER BY createdAt DESC LIMIT ${limit} OFFSET ${offset}`;
  
  // Get total count
  const countResult = await db.execute(sql`${sql.raw(countQuery)}`);
  const total = (countResult as any)[0]?.[0]?.total || 0;
  
  // Get logs
  const logsResult = await db.execute(sql`${sql.raw(selectQuery)}`);
  
  return {
    logs: ((logsResult as any)[0] || []).map((row: any) => ({
      id: row.id,
      userId: row.userId,
      userName: row.userName,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityName: row.entityName,
      details: row.details,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      status: row.status,
      createdAt: new Date(row.createdAt),
    })),
    total,
  };
}

export async function getAuditLogStats(days: number = 7): Promise<{
  totalActions: number;
  loginCount: number;
  failedLogins: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  topUsers: Array<{ userName: string; count: number }>;
  actionsByDay: Array<{ date: string; count: number }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
  
  // Total actions
  const totalResult = await db.execute(sql`SELECT COUNT(*) as total FROM audit_logs WHERE createdAt >= ${startDateStr}`);
  const totalActions = (totalResult as any)[0]?.[0]?.total || 0;
  
  // Login counts
  const loginResult = await db.execute(sql`SELECT 
    SUM(CASE WHEN action = 'login' AND status = 'success' THEN 1 ELSE 0 END) as loginCount,
    SUM(CASE WHEN action = 'login_failed' OR (action = 'login' AND status = 'failure') THEN 1 ELSE 0 END) as failedLogins
  FROM audit_logs WHERE createdAt >= ${startDateStr}`);
  const loginCount = (loginResult as any)[0]?.[0]?.loginCount || 0;
  const failedLogins = (loginResult as any)[0]?.[0]?.failedLogins || 0;
  
  // CRUD counts
  const crudResult = await db.execute(sql`SELECT 
    SUM(CASE WHEN action = 'create' THEN 1 ELSE 0 END) as createCount,
    SUM(CASE WHEN action = 'update' THEN 1 ELSE 0 END) as updateCount,
    SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END) as deleteCount
  FROM audit_logs WHERE createdAt >= ${startDateStr}`);
  const createCount = (crudResult as any)[0]?.[0]?.createCount || 0;
  const updateCount = (crudResult as any)[0]?.[0]?.updateCount || 0;
  const deleteCount = (crudResult as any)[0]?.[0]?.deleteCount || 0;
  
  // Top users
  const topUsersResult = await db.execute(sql`SELECT userName, COUNT(*) as count FROM audit_logs 
    WHERE createdAt >= ${startDateStr} AND userName IS NOT NULL
    GROUP BY userName ORDER BY count DESC LIMIT 10`);
  const topUsers = ((topUsersResult as any)[0] || []).map((row: any) => ({
    userName: row.userName,
    count: row.count,
  }));
  
  // Actions by day
  const byDayResult = await db.execute(sql`SELECT DATE(createdAt) as date, COUNT(*) as count FROM audit_logs 
    WHERE createdAt >= ${startDateStr}
    GROUP BY DATE(createdAt) ORDER BY date DESC`);
  const actionsByDay = ((byDayResult as any)[0] || []).map((row: any) => ({
    date: row.date,
    count: row.count,
  }));
  
  return {
    totalActions,
    loginCount,
    failedLogins,
    createCount,
    updateCount,
    deleteCount,
    topUsers,
    actionsByDay,
  };
}


// =====================================================
// Backup Codes Functions
// =====================================================

export async function generateBackupCodes(userId: number, codes: string[]) {
  const db = await getDb();
  if (!db) return codes;
  
  // Delete existing backup codes for user
  await db.delete(backupCodes).where(eq(backupCodes.userId, userId));
  
  // Insert new backup codes
  const insertData = codes.map(code => ({
    userId,
    code,
    isUsed: false,
  }));
  
  await db.insert(backupCodes).values(insertData);
  return codes;
}

export async function getBackupCodes(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(backupCodes)
    .where(eq(backupCodes.userId, userId))
    .orderBy(backupCodes.id);
}

export async function verifyBackupCode(userId: number, code: string) {
  const db = await getDb();
  if (!db) return false;
  
  // Get all unused backup codes for user
  const codes = await db.select()
    .from(backupCodes)
    .where(
      and(
        eq(backupCodes.userId, userId),
        eq(backupCodes.isUsed, false)
      )
    );
  
  // Check each code with bcrypt compare (codes are hashed)
  const bcrypt = await import('bcryptjs');
  for (const backupCode of codes) {
    const isMatch = await bcrypt.compare(code.toUpperCase(), backupCode.code);
    if (isMatch) {
      // Mark as used
      await db.update(backupCodes)
        .set({ isUsed: true, usedAt: new Date() })
        .where(eq(backupCodes.id, backupCode.id));
      return true;
    }
  }
  
  return false;
}

export async function getUnusedBackupCodesCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` })
    .from(backupCodes)
    .where(
      and(
        eq(backupCodes.userId, userId),
        eq(backupCodes.isUsed, false)
      )
    );
  return result[0]?.count || 0;
}

// =====================================================
// User Sessions Functions
// =====================================================

export async function createUserSession(data: {
  userId: number;
  sessionToken: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  location?: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) return 0;
  
  const [result] = await db.insert(userSessions).values(data).returning({ id: userSessions.id });
  return result.id;
}

export async function getUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.isActive, true)
      )
    )
    .orderBy(desc(userSessions.lastActivityAt));
}

export async function getSessionByToken(sessionToken: string) {
  const db = await getDb();
  if (!db) return null;
  
  const [session] = await db.select()
    .from(userSessions)
    .where(eq(userSessions.sessionToken, sessionToken))
    .limit(1);
  return session;
}

export async function updateSessionActivity(sessionId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(userSessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(userSessions.id, sessionId));
}

export async function revokeSession(sessionId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(userSessions)
    .set({ isActive: false })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId)
      )
    );
}

export async function revokeAllSessions(userId: number, exceptSessionId?: number) {
  const db = await getDb();
  if (!db) return;
  
  if (exceptSessionId) {
    await db.update(userSessions)
      .set({ isActive: false })
      .where(
        and(
          eq(userSessions.userId, userId),
          not(eq(userSessions.id, exceptSessionId))
        )
      );
  } else {
    await db.update(userSessions)
      .set({ isActive: false })
      .where(eq(userSessions.userId, userId));
  }
}

export async function cleanupExpiredSessions() {
  const db = await getDb();
  if (!db) return;
  
  await db.update(userSessions)
    .set({ isActive: false })
    .where(lte(userSessions.expiresAt, new Date()));
}

// =====================================================
// System Settings Functions
// =====================================================

export async function getSystemSetting(key: string) {
  const db = await getDb();
  if (!db) return null;
  
  const [setting] = await db.select()
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, key))
    .limit(1);
  return setting;
}

export async function getSystemSettings(category?: string) {
  const db = await getDb();
  if (!db) return [];
  
  if (category) {
    return db.select()
      .from(systemSettings)
      .where(eq(systemSettings.category, category))
      .orderBy(systemSettings.settingKey);
  }
  return db.select()
    .from(systemSettings)
    .orderBy(systemSettings.category, systemSettings.settingKey);
}

export async function updateSystemSetting(key: string, value: string, updatedBy?: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(systemSettings)
    .set({ 
      settingValue: value,
      updatedBy: updatedBy || null,
      updatedAt: new Date()
    })
    .where(eq(systemSettings.settingKey, key));
}

export async function createSystemSetting(data: InsertSystemSetting) {
  const db = await getDb();
  if (!db) return 0;
  
  const [result] = await db.insert(systemSettings).values(data).returning({ id: systemSettings.id });
  return result.id;
}


// ==============================
// Workstations Functions
// ==============================

export async function getWorkstations(filters?: { lineId?: number; workshopId?: number; factoryId?: number; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(workstations.isActive, filters?.isActive ?? true)];
  if (filters?.lineId) conditions.push(eq(workstations.lineId, filters.lineId));
  if (filters?.workshopId) conditions.push(eq(workstations.workshopId, filters.workshopId));
  if (filters?.factoryId) conditions.push(eq(workstations.factoryId, filters.factoryId));
  
  return db.select().from(workstations).where(and(...conditions)).orderBy(workstations.orderIndex);
}

export async function getWorkstationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(workstations).where(eq(workstations.id, id)).limit(1);
  return result[0] || null;
}

export async function createWorkstation(data: Omit<InsertWorkstation, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(workstations).values(data);
  return result[0].id;
}

export async function updateWorkstation(id: number, data: Partial<Omit<InsertWorkstation, 'id' | 'createdAt' | 'updatedAt'>>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(workstations).set(data).where(eq(workstations.id, id));
}

export async function deleteWorkstation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(workstations).where(eq(workstations.id, id));
}

// Get defect statistics by workstation
export async function getDefectsByWorkstation(filters?: { 
  startDate?: Date; 
  endDate?: Date; 
  productModelId?: number;
  machineId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    // Simplified query: Use LEFT JOIN to handle cases with no measurement results
    const query = sql`
      SELECT 
        w.id as workstationId,
        w.code as workstationCode,
        w.name as workstationName,
        w.processType,
        mpd.id as measurementPointId,
        mpd.code as measurementPointCode,
        mpd.name as measurementPointName,
        COALESCE(COUNT(mr.id), 0) as totalCount,
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as okCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount
      FROM workstations w
      LEFT JOIN measurement_point_defs mpd ON mpd.workstationId = w.id
      LEFT JOIN measurement_results mr ON mr.pointDefId = mpd.id
      LEFT JOIN product_inspections pi ON mr.inspectionId = pi.id
      WHERE w.isActive = 1
      ${filters?.startDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime >= ${filters.startDate})` : sql``}
      ${filters?.endDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime <= ${filters.endDate})` : sql``}
      ${filters?.productModelId ? sql`AND (mpd.productModelId IS NULL OR mpd.productModelId = ${filters.productModelId})` : sql``}
      ${filters?.machineId ? sql`AND (pi.machineId IS NULL OR pi.machineId = ${filters.machineId})` : sql``}
      GROUP BY w.id, w.code, w.name, w.processType, mpd.id, mpd.code, mpd.name
      HAVING mpd.id IS NOT NULL
      ORDER BY ngCount DESC
    `;
    
    const result = await db.execute(query);
    return (result[0] as unknown) as Array<{
      workstationId: number | null;
      workstationCode: string | null;
      workstationName: string | null;
      processType: string | null;
      measurementPointId: number;
      measurementPointCode: string;
      measurementPointName: string;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
    }>;
  } catch (error) {
    console.error('getDefectsByWorkstation error:', error);
    return [];
  }
}

// Get top NG measurement points by workstation
export async function getTopNGMeasurementPointsByWorkstation(filters?: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const limitVal = filters?.limit || 10;
    const query = sql`
      SELECT 
        w.id as workstationId,
        w.code as workstationCode,
        w.name as workstationName,
        mpd.id as measurementPointId,
        mpd.code as measurementPointCode,
        mpd.name as measurementPointName,
        COALESCE(COUNT(mr.id), 0) as totalCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount
      FROM measurement_point_defs mpd
      LEFT JOIN workstations w ON mpd.workstationId = w.id
      LEFT JOIN measurement_results mr ON mr.pointDefId = mpd.id AND mr.result IN ('NG', 'NTF')
      LEFT JOIN product_inspections pi ON mr.inspectionId = pi.id
      WHERE 1=1
      ${filters?.startDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime >= ${filters.startDate})` : sql``}
      ${filters?.endDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime <= ${filters.endDate})` : sql``}
      GROUP BY w.id, w.code, w.name, mpd.id, mpd.code, mpd.name
      HAVING ngCount > 0 OR ntfCount > 0
      ORDER BY ngCount DESC
      LIMIT ${limitVal}
    `;

    const result = await db.execute(query);
    return (result[0] as unknown) as Array<{
      workstationId: number | null;
      workstationCode: string | null;
      workstationName: string | null;
      measurementPointId: number;
      measurementPointCode: string;
      measurementPointName: string;
      totalCount: number;
      ngCount: number;
      ntfCount: number;
    }>;
  } catch (error) {
    console.error('getTopNGMeasurementPointsByWorkstation error:', error);
    return [];
  }
}

// Get workstation summary statistics
export async function getWorkstationSummary(filters?: { 
  startDate?: Date; 
  endDate?: Date; 
}) {
  const db = await getDb();
  if (!db) return [];
  
  try {
    const query = sql`
      SELECT 
        w.id as workstationId,
        w.code as workstationCode,
        w.name as workstationName,
        w.processType,
        COALESCE(COUNT(DISTINCT mpd.id), 0) as measurementPointCount,
        COALESCE(COUNT(mr.id), 0) as totalInspections,
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as okCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount,
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as yieldRate
      FROM workstations w
      LEFT JOIN measurement_point_defs mpd ON mpd.workstationId = w.id
      LEFT JOIN measurement_results mr ON mr.pointDefId = mpd.id
      LEFT JOIN product_inspections pi ON mr.inspectionId = pi.id
      WHERE w.isActive = 1
      ${filters?.startDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime >= ${filters.startDate})` : sql``}
      ${filters?.endDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime <= ${filters.endDate})` : sql``}
      GROUP BY w.id, w.code, w.name, w.processType
      ORDER BY ngCount DESC
    `;
    
    const result = await db.execute(query);
    return (result[0] as unknown) as Array<{
      workstationId: number;
      workstationCode: string;
      workstationName: string;
      processType: string;
      measurementPointCount: number;
      totalInspections: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      yieldRate: number;
    }>;
  } catch (error) {
    console.error('getWorkstationSummary error:', error);
    return [];
  }
}


// Get measurement points by workstation with NG statistics
export async function getMeasurementPointsByWorkstation(filters: {
  workstationId: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const query = sql`
      SELECT 
        mpd.id as measurementPointId,
        mpd.code as measurementPointCode,
        mpd.name as measurementPointName,
        mpd.pointType,
        mpd.lowerLimit,
        mpd.upperLimit,
        mpd.unit,
        COALESCE(COUNT(mr.id), 0) as totalCount,
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as okCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount,
        COALESCE(AVG(mr.measuredValue), 0) as avgValue,
        COALESCE(MIN(mr.measuredValue), 0) as minValue,
        COALESCE(MAX(mr.measuredValue), 0) as maxValue
      FROM measurement_point_defs mpd
      LEFT JOIN measurement_results mr ON mr.pointDefId = mpd.id
      LEFT JOIN product_inspections pi ON mr.inspectionId = pi.id
      WHERE mpd.workstationId = ${filters.workstationId}
      ${filters.startDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime >= ${filters.startDate})` : sql``}
      ${filters.endDate ? sql`AND (pi.inspectionTime IS NULL OR pi.inspectionTime <= ${filters.endDate})` : sql``}
      GROUP BY mpd.id, mpd.code, mpd.name, mpd.pointType, mpd.lowerLimit, mpd.upperLimit, mpd.unit
      ORDER BY ngCount DESC, mpd.code ASC
    `;

    const result = await db.execute(query);
    return (result[0] as unknown) as Array<{
      measurementPointId: number;
      measurementPointCode: string;
      measurementPointName: string;
      pointType: string;
      lowerLimit: number | null;
      upperLimit: number | null;
      unit: string | null;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      avgValue: number;
      minValue: number;
      maxValue: number;
    }>;
  } catch (error) {
    console.error('getMeasurementPointsByWorkstation error:', error);
    return [];
  }
}

// ============ SEED WORKSTATION ANALYTICS DATA ============
export async function seedWorkstationAnalyticsData(options?: {
  inspectionCount?: number;
  daysBack?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const inspectionCount = options?.inspectionCount || 500;
  const daysBack = options?.daysBack || 7;

  // Step 1: Ensure workstations exist
  const existingWorkstations = await db.select().from(workstations);
  if (existingWorkstations.length === 0) {
    // Create default workstations
    const defaultWorkstations = [
      { code: 'WS-SMT', name: 'SMT Assembly', description: 'Surface Mount Technology', processType: 'SMT' as const, orderIndex: 1, isActive: true },
      { code: 'WS-DIP', name: 'DIP Soldering', description: 'Dual In-line Package Soldering', processType: 'DIP' as const, orderIndex: 2, isActive: true },
      { code: 'WS-AOI', name: 'AOI Inspection', description: 'Automated Optical Inspection', processType: 'TESTING' as const, orderIndex: 3, isActive: true },
      { code: 'WS-FCT', name: 'Functional Test', description: 'Functional Circuit Testing', processType: 'TESTING' as const, orderIndex: 4, isActive: true },
      { code: 'WS-PKG', name: 'Packaging', description: 'Final Packaging', processType: 'PACKAGING' as const, orderIndex: 5, isActive: true },
    ];

    for (const ws of defaultWorkstations) {
      await db.insert(workstations).values(ws);
    }
    console.log(`Created ${defaultWorkstations.length} default workstations`);
  }

  // Step 2: Get all workstations
  const allWorkstations = await db.select().from(workstations).where(eq(workstations.isActive, true));
  if (allWorkstations.length === 0) {
    throw new Error("No active workstations found");
  }

  // Step 3: Get all machines
  const allMachines = await db.select().from(machines).where(eq(machines.isActive, true));
  if (allMachines.length === 0) {
    throw new Error("No machines found. Please seed sample data first.");
  }

  // Step 4: Get product model with measurement points
  const productModel = await db.select().from(productModels).limit(1);
  if (productModel.length === 0) {
    throw new Error("No product model found. Please seed sample data first.");
  }
  const productModelId = productModel[0].id;

  // Step 5: Get measurement points and assign workstations if not assigned
  let measurementPoints = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.productModelId, productModelId));

  if (measurementPoints.length === 0) {
    throw new Error("No measurement points found. Please create measurement points first.");
  }

  // Assign workstations to measurement points if not already assigned
  let assignedCount = 0;
  for (let i = 0; i < measurementPoints.length; i++) {
    const point = measurementPoints[i];
    if (!point.workstationId) {
      const workstation = allWorkstations[i % allWorkstations.length];
      await db.update(measurementPointDefs)
        .set({ workstationId: workstation.id })
        .where(eq(measurementPointDefs.id, point.id));
      assignedCount++;
    }
  }
  if (assignedCount > 0) {
    console.log(`Assigned workstations to ${assignedCount} measurement points`);
    // Refresh measurement points
    measurementPoints = await db.select().from(measurementPointDefs)
      .where(eq(measurementPointDefs.productModelId, productModelId));
  }

  // Step 6: Generate inspection data
  const results: string[] = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NG', 'NTF']; // 70% OK, 20% NG, 10% NTF
  const ngReasons = [
    'Scratch detected', 
    'Dimension out of spec', 
    'Position shifted', 
    'Color mismatch', 
    'Surface defect',
    'Solder bridge',
    'Missing component',
    'Wrong polarity',
    'Cold solder joint',
    'Tombstone effect'
  ];
  
  let createdInspections = 0;
  let createdResults = 0;
  const now = new Date();

  for (let i = 0; i < inspectionCount; i++) {
    // Random machine
    const machine = allMachines[Math.floor(Math.random() * allMachines.length)];
    
    // Random date within last N days
    const inspectionDate = new Date(now.getTime() - Math.random() * daysBack * 24 * 60 * 60 * 1000);
    
    // Generate serial number
    const serialNumber = `SN-WS-${inspectionDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(5, '0')}`;
    
    // Determine overall result
    const overallResult = results[Math.floor(Math.random() * results.length)] as 'OK' | 'NG' | 'NTF';
    
    // Create inspection record
    const [inspectionResult] = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-WS-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)),
    }).returning({ id: productInspections.id });
    const inspectionId = inspectionResult.id;
    createdInspections++;

    // Create measurement results for each point
    for (const point of measurementPoints) {
      // If overall is NG/NTF, make some points NG based on workstation
      let pointResult: 'OK' | 'NG' | 'NTF' = 'OK';
      
      if (overallResult === 'NG' || overallResult === 'NTF') {
        // Higher chance of NG for certain workstations (simulate real-world patterns)
        const workstation = allWorkstations.find(ws => ws.id === point.workstationId);
        let ngProbability = 0.15; // default 15%
        
        if (workstation) {
          // SMT and DIP have higher defect rates
          if (workstation.code === 'WS-SMT') ngProbability = 0.25;
          else if (workstation.code === 'WS-DIP') ngProbability = 0.20;
          else if (workstation.code === 'WS-AOI') ngProbability = 0.10;
        }
        
        if (Math.random() < ngProbability) {
          pointResult = overallResult === 'NTF' ? 'NTF' : 'NG';
        }
      }

      await db.insert(measurementResults).values({
        inspectionId,
        pointDefId: point.id,
        result: pointResult,
        measuredValue: pointResult === 'OK' 
          ? (Math.random() * 0.1 + 0.95).toFixed(3) 
          : (Math.random() * 0.2 + 0.7).toFixed(3),
        remark: pointResult === 'NG' || pointResult === 'NTF' 
          ? ngReasons[Math.floor(Math.random() * ngReasons.length)] 
          : null,
      });
      createdResults++;
    }
  }

  return {
    message: `Created ${createdInspections} inspection records with ${createdResults} measurement results`,
    inspections: createdInspections,
    measurementResults: createdResults,
    workstationsUsed: allWorkstations.length,
    measurementPointsPerInspection: measurementPoints.length,
  };
}


// ============ NG TREND AND COMPARISON FUNCTIONS ============

// Get NG trend data by day
export async function getNGTrendByDay(filters?: {
  startDate?: Date;
  endDate?: Date;
  workstationId?: number;
  measurementPointDefId?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const query = sql`
      SELECT 
        DATE(pi.inspectionTime) as date,
        COALESCE(COUNT(mr.id), 0) as totalCount,
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as okCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount,
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as ngRate
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr.inspectionId = pi.id
      LEFT JOIN measurement_point_defs mpd ON mr.pointDefId = mpd.id
      WHERE pi.inspectionTime IS NOT NULL
      ${filters?.startDate ? sql`AND pi.inspectionTime >= ${filters.startDate}` : sql``}
      ${filters?.endDate ? sql`AND pi.inspectionTime <= ${filters.endDate}` : sql``}
      ${filters?.workstationId ? sql`AND mpd.workstationId = ${filters.workstationId}` : sql``}
      ${filters?.measurementPointDefId ? sql`AND mr.pointDefId = ${filters.measurementPointDefId}` : sql``}
      GROUP BY DATE(pi.inspectionTime)
      ORDER BY date ASC
    `;

    const result = await db.execute(query);
    return (result[0] as unknown) as Array<{
      date: string;
      totalCount: number;
      okCount: number;
      ngCount: number;
      ntfCount: number;
      ngRate: number;
    }>;
  } catch (error) {
    console.error('getNGTrendByDay error:', error);
    return [];
  }
}

// Get NG comparison between two periods
export async function getNGComparison(filters: {
  currentStartDate: Date;
  currentEndDate: Date;
  previousStartDate: Date;
  previousEndDate: Date;
}) {
  const db = await getDb();
  if (!db) return null;

  try {
    // Get current period stats
    const currentQuery = sql`
      SELECT 
        COALESCE(COUNT(mr.id), 0) as totalCount,
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as okCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount,
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as ngRate
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr.inspectionId = pi.id
      WHERE pi.inspectionTime >= ${filters.currentStartDate}
        AND pi.inspectionTime <= ${filters.currentEndDate}
    `;

    // Get previous period stats
    const previousQuery = sql`
      SELECT 
        COALESCE(COUNT(mr.id), 0) as totalCount,
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as okCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as ngCount,
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as ntfCount,
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as ngRate
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr.inspectionId = pi.id
      WHERE pi.inspectionTime >= ${filters.previousStartDate}
        AND pi.inspectionTime <= ${filters.previousEndDate}
    `;

    const [currentResult, previousResult] = await Promise.all([
      db.execute(currentQuery),
      db.execute(previousQuery),
    ]);

    const current = (currentResult[0] as any)[0] || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };
    const previous = (previousResult[0] as any)[0] || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };

    // Calculate changes
    const ngRateChange = Number(current.ngRate) - Number(previous.ngRate);
    const totalCountChange = Number(current.totalCount) - Number(previous.totalCount);
    const ngCountChange = Number(current.ngCount) - Number(previous.ngCount);

    return {
      current: {
        totalCount: Number(current.totalCount),
        okCount: Number(current.okCount),
        ngCount: Number(current.ngCount),
        ntfCount: Number(current.ntfCount),
        ngRate: Number(current.ngRate),
      },
      previous: {
        totalCount: Number(previous.totalCount),
        okCount: Number(previous.okCount),
        ngCount: Number(previous.ngCount),
        ntfCount: Number(previous.ntfCount),
        ngRate: Number(previous.ngRate),
      },
      changes: {
        ngRateChange,
        ngRateChangePercent: previous.ngRate > 0 ? (ngRateChange / Number(previous.ngRate)) * 100 : 0,
        totalCountChange,
        totalCountChangePercent: previous.totalCount > 0 ? (totalCountChange / Number(previous.totalCount)) * 100 : 0,
        ngCountChange,
        ngCountChangePercent: previous.ngCount > 0 ? (ngCountChange / Number(previous.ngCount)) * 100 : 0,
        isImproved: ngRateChange < 0, // NG rate decreased = improved
      },
    };
  } catch (error) {
    console.error('getNGComparison error:', error);
    return null;
  }
}


// ==================== Scheduled Reports ====================

export async function getScheduledReports(filters?: {
  isActive?: boolean;
  reportType?: string;
  schedule?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(scheduledReports);
  
  const conditions = [];
  if (filters?.isActive !== undefined) {
    conditions.push(eq(scheduledReports.isActive, filters.isActive));
  }
  if (filters?.reportType) {
    conditions.push(eq(scheduledReports.reportType, filters.reportType as any));
  }
  if (filters?.schedule) {
    conditions.push(eq(scheduledReports.schedule, filters.schedule as any));
  }
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  
  return query.orderBy(desc(scheduledReports.createdAt));
}

export async function getScheduledReportById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(scheduledReports)
    .where(eq(scheduledReports.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function createScheduledReport(data: InsertScheduledReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(scheduledReports).values(data);
  return result[0].id;
}

export async function updateScheduledReport(id: number, data: Partial<InsertScheduledReport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(scheduledReports)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(scheduledReports.id, id));
}

export async function deleteScheduledReport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Delete logs first
  await db.delete(scheduledReportLogs).where(eq(scheduledReportLogs.reportId, id));
  // Delete report
  await db.delete(scheduledReports).where(eq(scheduledReports.id, id));
}

export async function getScheduledReportLogs(reportId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(scheduledReportLogs)
    .where(eq(scheduledReportLogs.reportId, reportId))
    .orderBy(desc(scheduledReportLogs.sentAt))
    .limit(limit);
}

export async function createScheduledReportLog(data: InsertScheduledReportLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(scheduledReportLogs).values(data);
  return result[0].id;
}

export async function getReportsDueForSending() {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  
  return db.select().from(scheduledReports)
    .where(and(
      eq(scheduledReports.isActive, true),
      or(
        isNull(scheduledReports.nextScheduledAt),
        lte(scheduledReports.nextScheduledAt, now)
      )
    ))
    .orderBy(scheduledReports.nextScheduledAt);
}

export async function updateReportNextSchedule(id: number, nextScheduledAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(scheduledReports)
    .set({ 
      nextScheduledAt,
      lastSentAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(scheduledReports.id, id));
}

// ============= SMTP Configuration =============

export async function getSmtpConfig() {
  const db = await getDb();
  if (!db) return null;
  
  const configs = await db.select().from(smtpConfig).limit(1);
  return configs[0] || null;
}

export async function createOrUpdateSmtpConfig(data: Omit<InsertSmtpConfig, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getSmtpConfig();
  
  if (existing) {
    await db.update(smtpConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(smtpConfig.id, existing.id));
    return existing.id;
  } else {
    const result = await db.insert(smtpConfig).values(data);
    return result[0].id;
  }
}


// ============= MQTT Client Functions =============

export async function getMqttClients(filters?: {
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  connectionStatus?: 'ONLINE' | 'OFFLINE' | 'DISCONNECTED';
  stationId?: number;
  mappingType?: 'AUTO' | 'MANUAL';
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(mqttClients.isActive, true)];
  
  if (filters?.approvalStatus) {
    conditions.push(eq(mqttClients.approvalStatus, filters.approvalStatus));
  }
  if (filters?.connectionStatus) {
    conditions.push(eq(mqttClients.connectionStatus, filters.connectionStatus));
  }
  if (filters?.stationId) {
    conditions.push(eq(mqttClients.stationId, filters.stationId));
  }
  if (filters?.mappingType) {
    conditions.push(eq(mqttClients.mappingType, filters.mappingType));
  }
  
  return db.select()
    .from(mqttClients)
    .where(and(...conditions))
    .orderBy(desc(mqttClients.createdAt));
}

export async function getMqttClientById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(mqttClients)
    .where(eq(mqttClients.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function getMqttClientByDeviceId(deviceId: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(mqttClients)
    .where(eq(mqttClients.deviceId, deviceId))
    .limit(1);
  
  return results[0] || null;
}

export async function approveMqttClient(
  id: number, 
  approvedBy: number, 
  stationId?: number,
  mappingType?: 'AUTO' | 'MANUAL'
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set({
      approvalStatus: 'APPROVED',
      approvedBy,
      approvedAt: new Date(),
      stationId: stationId || null,
      mappingType: mappingType || 'MANUAL',
    })
    .where(eq(mqttClients.id, id));
}

export async function rejectMqttClient(id: number, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set({
      approvalStatus: 'REJECTED',
      rejectionReason: reason || null,
    })
    .where(eq(mqttClients.id, id));
}

export async function updateMqttClientMapping(id: number, data: {
  stationId?: number | null;
  processId?: number | null;
  mappingType?: 'AUTO' | 'MANUAL';
  autoReconnect?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set(data)
    .where(eq(mqttClients.id, id));
}

export async function updateMqttClientSettings(id: number, data: {
  deviceName?: string;
  receiveNGAlerts?: boolean;
  receiveDailySummary?: boolean;
  receiveWeeklySummary?: boolean;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set(data)
    .where(eq(mqttClients.id, id));
}

export async function deleteMqttClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Soft delete
  await db.update(mqttClients)
    .set({ isActive: false })
    .where(eq(mqttClients.id, id));
}

export async function disconnectAndResetMqttClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set({
      stationId: null,
      processId: null,
      connectionStatus: 'DISCONNECTED',
      lastDisconnectedAt: new Date(),
    })
    .where(eq(mqttClients.id, id));
}

export async function getMqttErrorSummaries(filters?: {
  stationId?: number;
  summaryType?: 'DAILY' | 'WEEKLY';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  if (filters?.stationId) {
    conditions.push(eq(mqttErrorSummary.stationId, filters.stationId));
  }
  if (filters?.summaryType) {
    conditions.push(eq(mqttErrorSummary.summaryType, filters.summaryType));
  }
  if (filters?.startDate) {
    conditions.push(gte(mqttErrorSummary.summaryDate, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(mqttErrorSummary.summaryDate, filters.endDate));
  }
  
  return db.select()
    .from(mqttErrorSummary)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(mqttErrorSummary.summaryDate))
    .limit(filters?.limit || 50);
}

export async function getMqttMessageLogs(filters?: {
  clientId?: number;
  stationId?: number;
  messageType?: 'NG_ALERT' | 'DAILY_SUMMARY' | 'WEEKLY_SUMMARY' | 'CUSTOM';
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  if (filters?.clientId) {
    conditions.push(eq(mqttMessageLogs.targetClientId, filters.clientId));
  }
  if (filters?.stationId) {
    conditions.push(eq(mqttMessageLogs.stationId, filters.stationId));
  }
  if (filters?.messageType) {
    conditions.push(eq(mqttMessageLogs.messageType, filters.messageType));
  }
  
  return db.select()
    .from(mqttMessageLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(mqttMessageLogs.createdAt))
    .limit(filters?.limit || 100);
}


// ============ MQTT DASHBOARD STATISTICS ============

export async function getMqttDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  
  // Get client counts by status
  const clients = await db.select().from(mqttClients);
  
  const totalClients = clients.length;
  const onlineClients = clients.filter(c => c.connectionStatus === 'ONLINE').length;
  const offlineClients = clients.filter(c => c.connectionStatus === 'OFFLINE').length;
  const pendingApproval = clients.filter(c => c.approvalStatus === 'PENDING').length;
  const approvedClients = clients.filter(c => c.approvalStatus === 'APPROVED').length;
  
  // Get message stats for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const messages = await db.select()
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, today));
  
  const totalMessages = messages.length;
  const deliveredMessages = messages.filter(m => m.deliveryStatus === 'DELIVERED').length;
  const failedMessages = messages.filter(m => m.deliveryStatus === 'FAILED').length;
  const pendingMessages = messages.filter(m => m.deliveryStatus === 'PENDING').length;
  
  // Get message breakdown by type
  const ngAlerts = messages.filter(m => m.messageType === 'NG_ALERT').length;
  const dailySummaries = messages.filter(m => m.messageType === 'DAILY_SUMMARY').length;
  const weeklySummaries = messages.filter(m => m.messageType === 'WEEKLY_SUMMARY').length;
  
  return {
    clients: {
      total: totalClients,
      online: onlineClients,
      offline: offlineClients,
      pendingApproval,
      approved: approvedClients,
    },
    messages: {
      total: totalMessages,
      delivered: deliveredMessages,
      failed: failedMessages,
      pending: pendingMessages,
      deliveryRate: totalMessages > 0 ? (deliveredMessages / totalMessages * 100).toFixed(1) : '0',
    },
    breakdown: {
      ngAlerts,
      dailySummaries,
      weeklySummaries,
    },
  };
}

export async function getMqttMessageTrend(days: number = 7) {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  
  const messages = await db.select()
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, startDate))
    .orderBy(mqttMessageLogs.createdAt);
  
  // Group by date
  const trend: Record<string, { date: string; total: number; delivered: number; failed: number; ngAlerts: number }> = {};
  
  for (let i = 0; i <= days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - i));
    const dateStr = date.toISOString().split('T')[0];
    trend[dateStr] = { date: dateStr, total: 0, delivered: 0, failed: 0, ngAlerts: 0 };
  }
  
  messages.forEach(m => {
    const dateStr = new Date(m.createdAt!).toISOString().split('T')[0];
    if (trend[dateStr]) {
      trend[dateStr].total++;
      if (m.deliveryStatus === 'DELIVERED') trend[dateStr].delivered++;
      if (m.deliveryStatus === 'FAILED') trend[dateStr].failed++;
      if (m.messageType === 'NG_ALERT') trend[dateStr].ngAlerts++;
    }
  });
  
  return Object.values(trend);
}

export async function getRecentMqttMessages(limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: mqttMessageLogs.id,
    messageType: mqttMessageLogs.messageType,
    topic: mqttMessageLogs.topic,
    deliveryStatus: mqttMessageLogs.deliveryStatus,
    deliveredAt: mqttMessageLogs.deliveredAt,
    createdAt: mqttMessageLogs.createdAt,
    stationId: mqttMessageLogs.stationId,
    inspectionId: mqttMessageLogs.inspectionId,
  })
    .from(mqttMessageLogs)
    .orderBy(desc(mqttMessageLogs.createdAt))
    .limit(limit);
}

export async function updateMqttClientFcmToken(clientId: number, fcmToken: string) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttClients)
    .set({ fcmToken, updatedAt: new Date() })
    .where(eq(mqttClients.id, clientId));
}

export async function getMqttClientsWithFcmToken() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttClients)
    .where(and(
      isNotNull(mqttClients.fcmToken),
      eq(mqttClients.approvalStatus, 'APPROVED'),
      eq(mqttClients.isActive, true)
    ));
}

export async function getOfflineMqttClientsWithFcmToken(stationId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [
    isNotNull(mqttClients.fcmToken),
    eq(mqttClients.approvalStatus, 'APPROVED'),
    eq(mqttClients.isActive, true),
    eq(mqttClients.connectionStatus, 'OFFLINE'),
    eq(mqttClients.receiveNGAlerts, true),
  ];
  
  if (stationId) {
    conditions.push(eq(mqttClients.stationId, stationId));
  }
  
  return db.select()
    .from(mqttClients)
    .where(and(...conditions));
}


// ============ MQTT REALTIME STATS FUNCTIONS ============

export async function getMqttMessageCountSince(since: Date) {
  const db = await getDb();
  if (!db) return { total: 0, delivered: 0, failed: 0, ngAlerts: 0 };
  
  const messages = await db.select({
    deliveryStatus: mqttMessageLogs.deliveryStatus,
    messageType: mqttMessageLogs.messageType,
  })
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, since));
  
  return {
    total: messages.length,
    delivered: messages.filter(m => m.deliveryStatus === 'DELIVERED').length,
    failed: messages.filter(m => m.deliveryStatus === 'FAILED').length,
    ngAlerts: messages.filter(m => m.messageType === 'NG_ALERT').length,
  };
}

export async function getMqttLatencyStats() {
  const db = await getDb();
  if (!db) return { avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const messages = await db.select({
    createdAt: mqttMessageLogs.createdAt,
    deliveredAt: mqttMessageLogs.deliveredAt,
  })
    .from(mqttMessageLogs)
    .where(and(
      gte(mqttMessageLogs.createdAt, oneHourAgo),
      isNotNull(mqttMessageLogs.deliveredAt)
    ));
  
  if (messages.length === 0) {
    return { avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  }
  
  const latencies = messages
    .map(m => {
      if (!m.createdAt || !m.deliveredAt) return null;
      return new Date(m.deliveredAt).getTime() - new Date(m.createdAt).getTime();
    })
    .filter((l): l is number => l !== null && l >= 0);
  
  if (latencies.length === 0) {
    return { avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  }
  
  latencies.sort((a, b) => a - b);
  
  const avgMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const minMs = latencies[0];
  const maxMs = latencies[latencies.length - 1];
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Ms = latencies[p95Index] || maxMs;
  
  return { avgMs, minMs, maxMs, p95Ms };
}


export async function getMqttThroughputHistory(minutes: number = 60) {
  const db = await getDb();
  if (!db) return [];
  
  const since = new Date(Date.now() - minutes * 60 * 1000);
  
  const messages = await db.select({
    createdAt: mqttMessageLogs.createdAt,
    deliveryStatus: mqttMessageLogs.deliveryStatus,
    messageType: mqttMessageLogs.messageType,
  })
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, since))
    .orderBy(mqttMessageLogs.createdAt);
  
  // Group by minute
  const minuteData: Record<string, { 
    time: string; 
    timestamp: number;
    count: number; 
    delivered: number; 
    failed: number;
    ngAlerts: number;
  }> = {};
  
  // Initialize all minutes in the range
  for (let i = 0; i < minutes; i++) {
    const date = new Date(Date.now() - (minutes - i - 1) * 60 * 1000);
    const minuteKey = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    minuteData[minuteKey] = { 
      time: minuteKey, 
      timestamp: date.getTime(),
      count: 0, 
      delivered: 0, 
      failed: 0,
      ngAlerts: 0,
    };
  }
  
  messages.forEach(m => {
    if (!m.createdAt) return;
    const date = new Date(m.createdAt);
    const minuteKey = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    
    if (minuteData[minuteKey]) {
      minuteData[minuteKey].count++;
      if (m.deliveryStatus === 'DELIVERED') minuteData[minuteKey].delivered++;
      if (m.deliveryStatus === 'FAILED') minuteData[minuteKey].failed++;
      if (m.messageType === 'NG_ALERT') minuteData[minuteKey].ngAlerts++;
    }
  });
  
  return Object.values(minuteData).sort((a, b) => a.timestamp - b.timestamp);
}


// ============ MQTT ALERT RULES FUNCTIONS ============

export async function getMqttAlertRules() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertRules)
    .orderBy(desc(mqttAlertRules.createdAt));
}

export async function getMqttAlertRuleById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(mqttAlertRules)
    .where(eq(mqttAlertRules.id, id))
    .limit(1);
  
  return result[0] || null;
}

export async function getEnabledMqttAlertRules() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertRules)
    .where(eq(mqttAlertRules.isEnabled, true));
}

export async function createMqttAlertRule(data: {
  name: string;
  description?: string;
  ruleType: 'LATENCY_THRESHOLD' | 'BROKER_DISCONNECT' | 'MESSAGE_FAILURE_RATE' | 'THROUGHPUT_LOW' | 'THROUGHPUT_HIGH' | 'CLIENT_OFFLINE';
  thresholdValue: string;
  thresholdUnit?: string;
  comparisonOperator?: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
  timeWindowMinutes?: number;
  notifyOwner?: boolean;
  notifyEmail?: boolean;
  notifyMqtt?: boolean;
  cooldownMinutes?: number;
  createdBy?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(mqttAlertRules).values({
    name: data.name,
    description: data.description,
    ruleType: data.ruleType,
    thresholdValue: data.thresholdValue,
    thresholdUnit: data.thresholdUnit || 'ms',
    comparisonOperator: data.comparisonOperator || 'GT',
    timeWindowMinutes: data.timeWindowMinutes || 5,
    notifyOwner: data.notifyOwner ?? true,
    notifyEmail: data.notifyEmail ?? false,
    notifyMqtt: data.notifyMqtt ?? false,
    cooldownMinutes: data.cooldownMinutes || 15,
    createdBy: data.createdBy,
  });
  
  return { id: Number(result[0].id) };
}

export async function updateMqttAlertRule(id: number, data: Partial<{
  name: string;
  description: string;
  thresholdValue: string;
  thresholdUnit: string;
  comparisonOperator: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
  timeWindowMinutes: number;
  notifyOwner: boolean;
  notifyEmail: boolean;
  notifyMqtt: boolean;
  cooldownMinutes: number;
  isEnabled: boolean;
}>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttAlertRules)
    .set(data)
    .where(eq(mqttAlertRules.id, id));
}

export async function deleteMqttAlertRule(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(mqttAlertRules)
    .where(eq(mqttAlertRules.id, id));
}

export async function updateMqttAlertRuleLastTriggered(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttAlertRules)
    .set({ lastTriggeredAt: new Date() })
    .where(eq(mqttAlertRules.id, id));
}

// ============ MQTT ALERT HISTORY FUNCTIONS ============

export async function getMqttAlertHistory(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertHistory)
    .orderBy(desc(mqttAlertHistory.triggeredAt))
    .limit(limit);
}

export async function getUnresolvedMqttAlerts() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertHistory)
    .where(eq(mqttAlertHistory.isResolved, false))
    .orderBy(desc(mqttAlertHistory.triggeredAt));
}

export async function createMqttAlertHistoryEntry(data: {
  ruleId: number;
  ruleName: string;
  ruleType: string;
  triggeredValue: string;
  thresholdValue: string;
  message: string;
  notificationSent?: boolean;
  notificationError?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(mqttAlertHistory).values({
    ruleId: data.ruleId,
    ruleName: data.ruleName,
    ruleType: data.ruleType,
    triggeredValue: data.triggeredValue,
    thresholdValue: data.thresholdValue,
    message: data.message,
    notificationSent: data.notificationSent ?? false,
    notificationError: data.notificationError,
  });
  
  return { id: Number(result[0].id) };
}

export async function resolveMqttAlert(id: number, userId: number, note?: string) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttAlertHistory)
    .set({
      isResolved: true,
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNote: note,
    })
    .where(eq(mqttAlertHistory.id, id));
}


// ============ SYSTEM CONFIG FUNCTIONS ============
export async function getAllSystemConfig() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(systemConfig).orderBy(systemConfig.configKey);
}

export async function getSystemConfigByKey(key: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.configKey, key))
    .limit(1);
  
  return result[0] || null;
}

export async function updateSystemConfig(key: string, value: string, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(systemConfig)
    .set({
      configValue: value,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(systemConfig.configKey, key));
}

export async function createSystemConfig(data: {
  configKey: string;
  configValue: string;
  description?: string;
  dataType?: "STRING" | "NUMBER" | "BOOLEAN" | "JSON";
  isEditable?: boolean;
  requiresRestart?: boolean;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(systemConfig).values(data);
  return { id: Number(result[0].id) };
}


// ============ CORPORATE/FACTORY STATISTICS FUNCTIONS ============
export async function getYieldRateByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    if (corporateAssignments.length > 0) {
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      conditions.push(sql`${productInspections.corporateCode} IN (${corporateCodes.map(c => `'${c}'`).join(',')})`);
    } else {
      // User has no corporate assignments, return empty
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    totalInspections: Number(r.totalInspections),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    yieldRate: Number(r.totalInspections) > 0 
      ? (Number(r.okCount) / Number(r.totalInspections) * 100).toFixed(2)
      : '0.00',
  }));
}

export async function getYieldRateByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(sql`${productInspections.corporateCode} IN (${corporateCodes.map(c => `'${c}'`).join(',')})`);
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(sql`${productInspections.factoryCode} IN (${factoryCodes.map(f => `'${f}'`).join(',')})`);
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      }
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, productInspections.factoryCode);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    factoryCode: r.factoryCode || 'N/A',
    totalInspections: Number(r.totalInspections),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    yieldRate: Number(r.totalInspections) > 0 
      ? (Number(r.okCount) / Number(r.totalInspections) * 100).toFixed(2)
      : '0.00',
  }));
}

export async function getThroughputByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const interval = filters.interval || 'day';
  const conditions = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    if (corporateAssignments.length > 0) {
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      conditions.push(sql`${productInspections.corporateCode} IN (${corporateCodes.map(c => `'${c}'`).join(',')})`);
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d %H:00:00')`;
  } else if (interval === 'week') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%u')`;
  } else {
    dateFormat = sql`DATE(${productInspections.inspectionTime})`;
  }

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      timeInterval: dateFormat.as('timeInterval'),
      count: sql<number>`COUNT(*)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, sql`timeInterval`)
    .orderBy(sql`timeInterval`);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    timeInterval: r.timeInterval,
    count: Number(r.count),
  }));
}

export async function getThroughputByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const interval = filters.interval || 'day';
  const conditions = [];
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(sql`${productInspections.corporateCode} IN (${corporateCodes.map(c => `'${c}'`).join(',')})`);
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(sql`${productInspections.factoryCode} IN (${factoryCodes.map(f => `'${f}'`).join(',')})`);
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      }
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d %H:00:00')`;
  } else if (interval === 'week') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%u')`;
  } else {
    dateFormat = sql`DATE(${productInspections.inspectionTime})`;
  }

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      timeInterval: dateFormat.as('timeInterval'),
      count: sql<number>`COUNT(*)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, productInspections.factoryCode, sql`timeInterval`)
    .orderBy(sql`timeInterval`);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    factoryCode: r.factoryCode || 'N/A',
    timeInterval: r.timeInterval,
    count: Number(r.count),
  }));
}


// Helper functions for Bulk Import
export async function getFactoryByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(factories).where(eq(factories.code, code)).limit(1);
  return results[0] || null;
}

export async function getWorkshopByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(workshops).where(eq(workshops.code, code)).limit(1);
  return results[0] || null;
}

export async function getStationByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(stations).where(eq(stations.code, code)).limit(1);
  return results[0] || null;
}

export async function getProductionLineByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(productionLines).where(eq(productionLines.code, code)).limit(1);
  return results[0] || null;
}


// User Assignment Functions
export async function getUserCorporateAssignments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const results = await db.select().from(userCorporateAssignments).where(eq(userCorporateAssignments.userId, userId));
  return results;
}

export async function getUserFactoryAssignments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const results = await db.select().from(userFactoryAssignments).where(eq(userFactoryAssignments.userId, userId));
  return results;
}

export async function createCorporateAssignment(data: InsertUserCorporateAssignment) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(userCorporateAssignments).values(data).returning({ id: userCorporateAssignments.id });
  return result;
}

export async function createFactoryAssignment(data: InsertUserFactoryAssignment) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(userFactoryAssignments).values(data).returning({ id: userFactoryAssignments.id });
  return result;
}

export async function deleteCorporateAssignment(userId: number, corporateCode: string) {
  const db = await getDb();
  if (!db) return null;
  
  await db.delete(userCorporateAssignments)
    .where(and(
      eq(userCorporateAssignments.userId, userId),
      eq(userCorporateAssignments.corporateCode, corporateCode)
    ));
  return true;
}

export async function deleteFactoryAssignment(userId: number, factoryCode: string) {
  const db = await getDb();
  if (!db) return null;
  
  await db.delete(userFactoryAssignments)
    .where(and(
      eq(userFactoryAssignments.userId, userId),
      eq(userFactoryAssignments.factoryCode, factoryCode)
    ));
  return true;
}

// Helper to check if user has access to corporate/factory
export async function hasAccessToCorporate(userId: number, corporateCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // Admin has access to all
  const user = await getUserById(userId);
  if (user?.role === 'admin') return true;
  
  const assignments = await db.select()
    .from(userCorporateAssignments)
    .where(and(
      eq(userCorporateAssignments.userId, userId),
      eq(userCorporateAssignments.corporateCode, corporateCode)
    ))
    .limit(1);
  
  return assignments.length > 0;
}

export async function hasAccessToFactory(userId: number, factoryCode: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  // Admin has access to all
  const user = await getUserById(userId);
  if (user?.role === 'admin') return true;
  
  const assignments = await db.select()
    .from(userFactoryAssignments)
    .where(and(
      eq(userFactoryAssignments.userId, userId),
      eq(userFactoryAssignments.factoryCode, factoryCode)
    ))
    .limit(1);
  
  return assignments.length > 0;
}


// ============ EMAIL TEMPLATE CONFIG FUNCTIONS ============

export async function getEmailTemplateConfigs() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailTemplateConfig).orderBy(desc(emailTemplateConfig.isDefault));
}

export async function getEmailTemplateConfigById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(emailTemplateConfig).where(eq(emailTemplateConfig.id, id)).limit(1);
  return results[0] || null;
}

export async function getDefaultEmailTemplateConfig() {
  const db = await getDb();
  if (!db) return null;
  
  // First try to get the default template
  const defaultResults = await db.select()
    .from(emailTemplateConfig)
    .where(eq(emailTemplateConfig.isDefault, true))
    .limit(1);
  
  if (defaultResults[0]) return defaultResults[0];
  
  // If no default, get the first active one
  const activeResults = await db.select()
    .from(emailTemplateConfig)
    .where(eq(emailTemplateConfig.isActive, true))
    .limit(1);
  
  return activeResults[0] || null;
}

export async function createEmailTemplateConfig(data: InsertEmailTemplateConfig) {
  const db = await getDb();
  if (!db) return null;
  
  // If this is set as default, unset other defaults
  if (data.isDefault) {
    await db.update(emailTemplateConfig).set({ isDefault: false });
  }
  
  const [result] = await db.insert(emailTemplateConfig).values(data).returning({ id: emailTemplateConfig.id });
  return { id: Number(result.id) };
}

export async function updateEmailTemplateConfig(id: number, data: Partial<InsertEmailTemplateConfig>) {
  const db = await getDb();
  if (!db) return;
  
  // If this is set as default, unset other defaults
  if (data.isDefault) {
    await db.update(emailTemplateConfig).set({ isDefault: false });
  }
  
  await db.update(emailTemplateConfig).set(data).where(eq(emailTemplateConfig.id, id));
}

export async function deleteEmailTemplateConfig(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(emailTemplateConfig).where(eq(emailTemplateConfig.id, id));
}

export async function setDefaultEmailTemplateConfig(id: number) {
  const db = await getDb();
  if (!db) return;
  
  // Unset all defaults
  await db.update(emailTemplateConfig).set({ isDefault: false });
  
  // Set new default
  await db.update(emailTemplateConfig).set({ isDefault: true }).where(eq(emailTemplateConfig.id, id));
}


// ============ NOTIFICATIONS FUNCTIONS ============

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(notifications).values(data).returning({ id: notifications.id });
  return { id: Number(result.id) };
}

export async function getNotifications(userId: number, filters?: {
  type?: 'ALERT' | 'REPORT' | 'SYSTEM' | 'INFO' | 'WARNING' | 'SUCCESS';
  isRead?: boolean;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(notifications.userId, userId)];
  
  if (filters?.type) {
    conditions.push(eq(notifications.type, filters.type));
  }
  if (filters?.isRead !== undefined) {
    conditions.push(eq(notifications.isRead, filters.isRead));
  }
  
  return db.select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(filters?.limit || 50)
    .offset(filters?.offset || 0);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
  
  return result[0]?.count || 0;
}

export async function markNotificationAsRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(notifications.id, id),
      eq(notifications.userId, userId)
    ));
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
}

export async function deleteNotification(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(notifications)
    .where(and(
      eq(notifications.id, id),
      eq(notifications.userId, userId)
    ));
}

export async function deleteOldNotifications(userId: number, daysOld: number = 30) {
  const db = await getDb();
  if (!db) return;
  
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  await db.delete(notifications)
    .where(and(
      eq(notifications.userId, userId),
      lte(notifications.createdAt, cutoffDate)
    ));
}

// Broadcast notification to multiple users
export async function broadcastNotification(userIds: number[], data: Omit<InsertNotification, 'userId'>) {
  const db = await getDb();
  if (!db) return [];
  
  const results: number[] = [];
  for (const userId of userIds) {
    const [result] = await db.insert(notifications).values({ ...data, userId }).returning({ id: notifications.id });
    results.push(Number(result.id));
  }
  return results;
}

// ============ USER NOTIFICATION PREFERENCES ============

export async function getUserNotificationPreferences(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .limit(1);
  
  return results[0] || null;
}

export async function upsertUserNotificationPreferences(userId: number, data: Partial<InsertUserNotificationPreference>) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getUserNotificationPreferences(userId);
  
  if (existing) {
    await db.update(userNotificationPreferences)
      .set(data)
      .where(eq(userNotificationPreferences.userId, userId));
  } else {
    await db.insert(userNotificationPreferences).values({ userId, ...data });
  }
}

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
      .set({ widgets })
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


// ============ PROCESSES FUNCTIONS ============

export async function getProcesses(filters?: {
  processType?: 'SMT' | 'DIP' | 'ASSEMBLY' | 'TESTING' | 'PACKAGING' | 'INSPECTION' | 'OTHER';
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [];
  
  if (filters?.processType) {
    conditions.push(eq(processes.processType, filters.processType));
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(processes.isActive, filters.isActive));
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  return db.select()
    .from(processes)
    .where(whereClause)
    .orderBy(asc(processes.orderIndex));
}

export async function getProcessById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(processes)
    .where(eq(processes.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function getProcessByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(processes)
    .where(eq(processes.code, code))
    .limit(1);
  
  return results[0] || null;
}

export async function createProcess(data: InsertProcess) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(processes).values(data).returning({ id: processes.id });
  return { id: Number(result.id) };
}

export async function updateProcess(id: number, data: Partial<InsertProcess>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(processes)
    .set(data)
    .where(eq(processes.id, id));
}

export async function deleteProcess(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // First delete all line process assignments
  await db.delete(lineProcessAssignments)
    .where(eq(lineProcessAssignments.processId, id));
  
  // Then delete the process
  await db.delete(processes)
    .where(eq(processes.id, id));
}

export async function reorderProcesses(orderedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(processes)
      .set({ orderIndex: i })
      .where(eq(processes.id, orderedIds[i]));
  }
}

// ============ LINE PROCESS ASSIGNMENTS FUNCTIONS ============

export async function getLineProcessAssignments(lineId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    assignment: lineProcessAssignments,
    process: processes,
  })
    .from(lineProcessAssignments)
    .leftJoin(processes, eq(lineProcessAssignments.processId, processes.id))
    .where(eq(lineProcessAssignments.lineId, lineId))
    .orderBy(asc(lineProcessAssignments.orderIndex));
}

export async function getLineProcessAssignmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(lineProcessAssignments)
    .where(eq(lineProcessAssignments.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function createLineProcessAssignment(data: InsertLineProcessAssignment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(lineProcessAssignments).values(data).returning({ id: lineProcessAssignments.id });
  return { id: Number(result.id) };
}

export async function updateLineProcessAssignment(id: number, data: Partial<InsertLineProcessAssignment>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(lineProcessAssignments)
    .set(data)
    .where(eq(lineProcessAssignments.id, id));
}

export async function deleteLineProcessAssignment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(lineProcessAssignments)
    .where(eq(lineProcessAssignments.id, id));
}

export async function reorderLineProcessAssignments(lineId: number, orderedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(lineProcessAssignments)
      .set({ orderIndex: i })
      .where(and(
        eq(lineProcessAssignments.id, orderedIds[i]),
        eq(lineProcessAssignments.lineId, lineId)
      ));
  }
}

export async function deleteLineProcessAssignmentsByLine(lineId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(lineProcessAssignments)
    .where(eq(lineProcessAssignments.lineId, lineId));
}

// ============ TOP NG ANALYSIS FUNCTIONS (ENHANCED) ============

export async function getTopNGMeasurementPointsEnhanced(filters: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
  productModelId?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const limitCount = filters.limit || 10;
  const conditions: SQL[] = [];
  
  // Join with inspections to filter by date and factory
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  if (filters.productModelId) {
    conditions.push(eq(productInspections.productModelId, filters.productModelId));
  }
  
  // Filter for NG results only
  conditions.push(eq(measurementResults.result, 'NG'));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const results = await db
    .select({
      measurementPointId: measurementResults.pointDefId,
      pointCode: measurementPointDefs.code,
      pointName: measurementPointDefs.name,
      measurementType: measurementPointDefs.measurementType,
      ngCount: sql<number>`COUNT(*)`,
      totalCount: sql<number>`(
        SELECT COUNT(*) FROM measurement_results mr2 
        WHERE mr2.measurementPointId = ${measurementResults.pointDefId}
      )`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementResults.pointDefId, measurementPointDefs.code, measurementPointDefs.name, measurementPointDefs.measurementType)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(limitCount);
  
  return results.map((r, index) => ({
    rank: index + 1,
    measurementPointId: r.measurementPointId,
    pointCode: r.pointCode || 'N/A',
    pointName: r.pointName || 'Unknown',
    measurementType: r.measurementType || 'OTHER',
    ngCount: Number(r.ngCount),
    totalCount: Number(r.totalCount),
    ngRate: Number(r.totalCount) > 0 
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100).toFixed(2)
      : '0.00',
    // For Pareto chart - cumulative percentage
    cumulativePercent: 0, // Will be calculated in router
  }));
}

// ============ TREND ANALYSIS FUNCTIONS ============

export async function getYieldTrendData(filters: {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  factoryCode?: string;
  interval?: 'hour' | 'day' | 'week' | 'month';
}) {
  const db = await getDb();
  if (!db) return [];
  
  const interval = filters.interval || 'day';
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, filters.startDate),
    lte(productInspections.inspectionTime, filters.endDate),
  ];
  
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d %H:00:00')`;
  } else if (interval === 'week') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%u')`;
  } else if (interval === 'month') {
    dateFormat = sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m')`;
  } else {
    dateFormat = sql`DATE(${productInspections.inspectionTime})`;
  }
  
  const results = await db
    .select({
      timeInterval: dateFormat.as('timeInterval'),
      totalCount: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`timeInterval`)
    .orderBy(sql`timeInterval`);
  
  return results.map(r => ({
    timeInterval: r.timeInterval,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    yieldRate: Number(r.totalCount) > 0 
      ? ((Number(r.okCount) / Number(r.totalCount)) * 100)
      : 0,
    ngRate: Number(r.totalCount) > 0 
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100)
      : 0,
  }));
}

// ============ ANOMALY DETECTION FUNCTIONS ============

export async function getRecentYieldData(filters: {
  machineId?: number;
  factoryCode?: string;
  days?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const days = filters.days || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, startDate),
  ];
  
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const results = await db
    .select({
      date: sql`DATE(${productInspections.inspectionTime})`.as('date'),
      totalCount: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`date`)
    .orderBy(sql`date`);
  
  return results.map(r => ({
    date: r.date,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    yieldRate: Number(r.totalCount) > 0 
      ? ((Number(r.okCount) / Number(r.totalCount)) * 100)
      : 0,
    ngRate: Number(r.totalCount) > 0 
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100)
      : 0,
  }));
}

// ============ WORKSTATION ANALYSIS FUNCTIONS ============

export async function getNGByWorkstation(filters: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [];
  
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  // Filter for NG results
  conditions.push(eq(measurementResults.result, 'NG'));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  // First get NG counts
  const ngResults = await db
    .select({
      workstationId: measurementPointDefs.workstationId,
      workstationCode: workstations.code,
      workstationName: workstations.name,
      processType: workstations.processType,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementPointDefs.workstationId, workstations.code, workstations.name, workstations.processType)
    .orderBy(sql`COUNT(*) DESC`);
  
  // Get total counts per workstation (all results, not just NG)
  const totalConditions: SQL[] = [];
  if (filters.startDate) {
    totalConditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    totalConditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    totalConditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    totalConditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const totalWhereClause = totalConditions.length > 0 ? and(...totalConditions) : undefined;
  
  const totalResults = await db
    .select({
      workstationId: measurementPointDefs.workstationId,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(totalWhereClause)
    .groupBy(measurementPointDefs.workstationId);
  
  // Create map of total counts
  const totalMap = new Map(totalResults.map(r => [r.workstationId, Number(r.totalCount)]));
  
  return ngResults.map(r => ({
    workstationId: r.workstationId,
    workstationCode: r.workstationCode || 'N/A',
    workstationName: r.workstationName || 'Unknown',
    processType: r.processType || 'OTHER',
    ngCount: Number(r.ngCount),
    totalCount: totalMap.get(r.workstationId) || Number(r.ngCount),
  }));
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


// ============ WORKSTATION-MEASUREMENT POINT LINKED ANALYSIS ============

export async function getNGByMeasurementPointForWorkstation(filters: {
  workstationId: number;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: SQL[] = [
    eq(measurementPointDefs.workstationId, filters.workstationId),
    eq(measurementResults.result, 'NG'),
  ];
  
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const whereClause = and(...conditions);
  
  // Get NG counts by measurement point
  const ngResults = await db
    .select({
      pointDefId: measurementPointDefs.id,
      pointCode: measurementPointDefs.code,
      pointName: measurementPointDefs.name,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementPointDefs.id, measurementPointDefs.code, measurementPointDefs.name)
    .orderBy(sql`COUNT(*) DESC`);
  
  // Get total counts per measurement point (all results)
  const totalConditions: SQL[] = [
    eq(measurementPointDefs.workstationId, filters.workstationId),
  ];
  if (filters.startDate) {
    totalConditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    totalConditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    totalConditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    totalConditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const totalWhereClause = and(...totalConditions);
  
  const totalResults = await db
    .select({
      pointDefId: measurementPointDefs.id,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(totalWhereClause)
    .groupBy(measurementPointDefs.id);
  
  // Create map of total counts
  const totalMap = new Map(totalResults.map(r => [r.pointDefId, Number(r.totalCount)]));
  
  return ngResults.map(r => ({
    pointDefId: r.pointDefId,
    pointCode: r.pointCode || 'N/A',
    pointName: r.pointName || 'Unknown',
    ngCount: Number(r.ngCount),
    totalCount: totalMap.get(r.pointDefId) || Number(r.ngCount),
  }));
}

// Get linked measurement points for a workstation
export async function getLinkedMeasurementPointsForWorkstation(workstationId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    name: measurementPointDefs.name,
    unit: measurementPointDefs.unit,
    lowerLimit: measurementPointDefs.lowerLimit,
    upperLimit: measurementPointDefs.upperLimit,
    nominalValue: measurementPointDefs.nominalValue,
    productModelId: measurementPointDefs.productModelId,
  })
  .from(measurementPointDefs)
  .where(eq(measurementPointDefs.workstationId, workstationId))
  .orderBy(measurementPointDefs.code);
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


// ============ CURSOR-BASED PAGINATION HELPERS ============

export interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  direction?: 'forward' | 'backward';
}

// Helper to encode cursor
export function encodeCursor(id: number, timestamp: Date): string {
  return Buffer.from(`${id}:${timestamp.getTime()}`).toString('base64');
}

// Helper to decode cursor
export function decodeCursor(cursor: string): { id: number; timestamp: Date } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const [idStr, timestampStr] = decoded.split(':');
    const id = parseInt(idStr, 10);
    const timestamp = new Date(parseInt(timestampStr, 10));
    if (isNaN(id) || isNaN(timestamp.getTime())) return null;
    return { id, timestamp };
  } catch {
    return null;
  }
}

// Cursor-based pagination for product inspections
export async function getProductInspectionsCursor(params: CursorPaginationParams & {
  machineId?: number;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  corporateCode?: string;
  factoryCode?: string;
}): Promise<CursorPaginationResult<typeof productInspections.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 500); // Max 500 per request
  const conditions: SQL[] = [];

  // Build filter conditions
  if (params.machineId) conditions.push(eq(productInspections.machineId, params.machineId));
  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.productModel) conditions.push(like(productInspections.productModel, `%${params.productModel}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));
  if (params.corporateCode) conditions.push(eq(productInspections.corporateCode, params.corporateCode));
  if (params.factoryCode) conditions.push(eq(productInspections.factoryCode, params.factoryCode));

  // Cursor condition
  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(productInspections.inspectionTime, cursorData.timestamp),
            and(
              eq(productInspections.inspectionTime, cursorData.timestamp),
              gt(productInspections.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(productInspections.inspectionTime, cursorData.timestamp),
            and(
              eq(productInspections.inspectionTime, cursorData.timestamp),
              lt(productInspections.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch one extra to check if there are more
  const results = await db.select()
    .from(productInspections)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(productInspections.inspectionTime)
        : desc(productInspections.inspectionTime),
      params.direction === 'backward'
        ? asc(productInspections.id)
        : desc(productInspections.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  // Reverse if backward direction
  if (params.direction === 'backward') {
    data.reverse();
  }

  // Generate cursors
  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.inspectionTime) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.inspectionTime) : null,
    hasMore,
  };
}

// Cursor-based pagination for measurement results
export async function getMeasurementResultsCursor(params: CursorPaginationParams & {
  inspectionId?: number;
  pointDefId?: number;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof measurementResults.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 100, 1000); // Max 1000 per request
  const conditions: SQL[] = [];

  if (params.inspectionId) conditions.push(eq(measurementResults.inspectionId, params.inspectionId));
  if (params.pointDefId) conditions.push(eq(measurementResults.pointDefId, params.pointDefId));
  if (params.result) conditions.push(eq(measurementResults.result, params.result));

  // Cursor condition (using id only since measurementResults doesn't have timestamp)
  if (params.cursor) {
    const cursorId = parseInt(Buffer.from(params.cursor, 'base64').toString('utf-8'), 10);
    if (!isNaN(cursorId)) {
      if (params.direction === 'backward') {
        conditions.push(gt(measurementResults.id, cursorId));
      } else {
        conditions.push(lt(measurementResults.id, cursorId));
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(measurementResults)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(measurementResults.id)
        : desc(measurementResults.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? Buffer.from(lastItem.id.toString()).toString('base64') : null,
    prevCursor: firstItem ? Buffer.from(firstItem.id.toString()).toString('base64') : null,
    hasMore,
  };
}

// Cursor-based pagination for alert history
export async function getAlertHistoryCursor(params: CursorPaginationParams & {
  alertSettingId?: number;
  alertType?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof alertHistory.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 200); // Max 200 per request
  const conditions: SQL[] = [];

  if (params.alertSettingId) conditions.push(eq(alertHistory.alertSettingId, params.alertSettingId));
  if (params.startDate) conditions.push(gte(alertHistory.createdAt, params.startDate));
  if (params.endDate) conditions.push(lte(alertHistory.createdAt, params.endDate));

  // Cursor condition
  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(alertHistory.createdAt, cursorData.timestamp),
            and(
              eq(alertHistory.createdAt, cursorData.timestamp),
              gt(alertHistory.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(alertHistory.createdAt, cursorData.timestamp),
            and(
              eq(alertHistory.createdAt, cursorData.timestamp),
              lt(alertHistory.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(alertHistory)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(alertHistory.createdAt)
        : desc(alertHistory.createdAt),
      params.direction === 'backward'
        ? asc(alertHistory.id)
        : desc(alertHistory.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.createdAt) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.createdAt) : null,
    hasMore,
  };
}

// Cursor-based pagination for MQTT alert history
export async function getMqttAlertHistoryCursor(params: CursorPaginationParams & {
  ruleId?: number;
  resolved?: boolean;
  startDate?: Date;
  endDate?: Date;
}): Promise<CursorPaginationResult<typeof mqttAlertHistory.$inferSelect>> {
  const db = await getDb();
  if (!db) return { data: [], nextCursor: null, prevCursor: null, hasMore: false };

  const limit = Math.min(params.limit || 50, 200);
  const conditions: SQL[] = [];

  if (params.ruleId) conditions.push(eq(mqttAlertHistory.ruleId, params.ruleId));
  if (params.resolved !== undefined) {
    if (params.resolved) {
      conditions.push(isNotNull(mqttAlertHistory.resolvedAt));
    } else {
      conditions.push(isNull(mqttAlertHistory.resolvedAt));
    }
  }
  if (params.startDate) conditions.push(gte(mqttAlertHistory.triggeredAt, params.startDate));
  if (params.endDate) conditions.push(lte(mqttAlertHistory.triggeredAt, params.endDate));

  if (params.cursor) {
    const cursorData = decodeCursor(params.cursor);
    if (cursorData) {
      if (params.direction === 'backward') {
        conditions.push(
          or(
            gt(mqttAlertHistory.triggeredAt, cursorData.timestamp),
            and(
              eq(mqttAlertHistory.triggeredAt, cursorData.timestamp),
              gt(mqttAlertHistory.id, cursorData.id)
            )
          )!
        );
      } else {
        conditions.push(
          or(
            lt(mqttAlertHistory.triggeredAt, cursorData.timestamp),
            and(
              eq(mqttAlertHistory.triggeredAt, cursorData.timestamp),
              lt(mqttAlertHistory.id, cursorData.id)
            )
          )!
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db.select()
    .from(mqttAlertHistory)
    .where(whereClause)
    .orderBy(
      params.direction === 'backward' 
        ? asc(mqttAlertHistory.triggeredAt)
        : desc(mqttAlertHistory.triggeredAt),
      params.direction === 'backward'
        ? asc(mqttAlertHistory.id)
        : desc(mqttAlertHistory.id)
    )
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;

  if (params.direction === 'backward') {
    data.reverse();
  }

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore && lastItem ? encodeCursor(lastItem.id, lastItem.triggeredAt) : null,
    prevCursor: firstItem ? encodeCursor(firstItem.id, firstItem.triggeredAt) : null,
    hasMore,
  };
}


// ============ PRODUCT CATEGORY FUNCTIONS ============

export async function getProductCategories(filters?: { parentId?: number | null; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(productCategories);
  
  const conditions: SQL[] = [];
  
  if (filters?.parentId !== undefined) {
    if (filters.parentId === null) {
      conditions.push(isNull(productCategories.parentId));
    } else {
      conditions.push(eq(productCategories.parentId, filters.parentId));
    }
  }
  
  if (filters?.isActive !== undefined) {
    conditions.push(eq(productCategories.isActive, filters.isActive));
  }
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }
  
  return query.orderBy(asc(productCategories.orderIndex), asc(productCategories.name));
}

export async function getProductCategoryById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(productCategories).where(eq(productCategories.id, id)).limit(1);
  return result[0] || null;
}

export async function getProductCategoryByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(productCategories).where(eq(productCategories.code, code)).limit(1);
  return result[0] || null;
}

export async function createProductCategory(data: InsertProductCategory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(productCategories).values(data);
  return { id: result[0].id };
}

export async function updateProductCategory(id: number, data: Partial<InsertProductCategory>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productCategories).set(data).where(eq(productCategories.id, id));
}

export async function deleteProductCategory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if category has children
  const children = await db.select().from(productCategories).where(eq(productCategories.parentId, id)).limit(1);
  if (children.length > 0) {
    throw new Error("Cannot delete category with children");
  }
  
  await db.delete(productCategories).where(eq(productCategories.id, id));
}

export async function getProductCategoryTree() {
  const db = await getDb();
  if (!db) return [];
  
  const allCategories = await db.select().from(productCategories)
    .where(eq(productCategories.isActive, true))
    .orderBy(asc(productCategories.orderIndex), asc(productCategories.name));
  
  // Build tree structure
  const categoryMap = new Map<number, typeof allCategories[0] & { children: typeof allCategories }>();
  const rootCategories: (typeof allCategories[0] & { children: typeof allCategories })[] = [];
  
  // First pass: create map
  for (const cat of allCategories) {
    categoryMap.set(cat.id, { ...cat, children: [] });
  }
  
  // Second pass: build tree
  for (const cat of allCategories) {
    const catWithChildren = categoryMap.get(cat.id)!;
    if (cat.parentId === null) {
      rootCategories.push(catWithChildren);
    } else {
      const parent = categoryMap.get(cat.parentId);
      if (parent) {
        parent.children.push(catWithChildren);
      }
    }
  }
  
  return rootCategories;
}

export async function updateProductCategoryCount(categoryId: number) {
  const db = await getDb();
  if (!db) return;
  
  // Count products in this category
  const category = await getProductCategoryById(categoryId);
  if (!category) return;
  
  const products = await db.select({ count: sql<number>`COUNT(*)` })
    .from(productModels)
    .where(eq(productModels.category, category.code));
  
  const count = products[0]?.count || 0;
  
  await db.update(productCategories)
    .set({ productCount: count })
    .where(eq(productCategories.id, categoryId));
}

export async function reorderProductCategories(categoryIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  for (let i = 0; i < categoryIds.length; i++) {
    await db.update(productCategories)
      .set({ orderIndex: i })
      .where(eq(productCategories.id, categoryIds[i]));
  }
}


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
  if (!db) throw new Error("Database not available");
  
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
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(backupLogs).values(log);
  return result[0].id;
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
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(scheduledBackups).values(backup);
  return result[0].id;
}

export async function updateScheduledBackup(id: number, data: Partial<InsertScheduledBackup>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(scheduledBackups).set(data).where(eq(scheduledBackups.id, id));
}

export async function deleteScheduledBackup(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
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
  return result[0] || null;
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
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(templateMarketplace).values(data);
  return result[0].id;
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
  if (!db) throw new Error("Database not available");
  
  await db.update(templateMarketplace)
    .set({ downloadCount: sql`${templateMarketplace.downloadCount} + 1` })
    .where(eq(templateMarketplace.id, id));
}

export async function updateMarketplaceTemplate(id: number, data: Partial<InsertTemplateMarketplace>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(templateMarketplace).set(data).where(eq(templateMarketplace.id, id));
}

export async function deleteMarketplaceTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(templateMarketplace).where(eq(templateMarketplace.id, id));
}

// ============ TEMPLATE REVIEWS FUNCTIONS ============

export async function createTemplateReview(review: InsertTemplateReview) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(templateReviews).values(review);
  
  // Update marketplace rating
  await updateMarketplaceRating(review.marketplaceId);
  
  return result[0].id;
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


// ============ PRODUCTION ORDER TEMPLATES ============
export async function listOrderTemplates(factoryId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(productionOrderTemplates).where(eq(productionOrderTemplates.isActive, true));
  if (factoryId) {
    query = db.select().from(productionOrderTemplates).where(
      and(
        eq(productionOrderTemplates.isActive, true),
        or(
          eq(productionOrderTemplates.factoryId, factoryId),
          isNull(productionOrderTemplates.factoryId)
        )
      )
    );
  }
  return await query;
}

export async function getOrderTemplate(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(productionOrderTemplates).where(eq(productionOrderTemplates.id, id));
  return results[0] || null;
}

export async function createOrderTemplate(data: InsertProductionOrderTemplate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(productionOrderTemplates).values(data);
  return { id: result[0].id };
}

export async function updateOrderTemplate(id: number, data: Partial<InsertProductionOrderTemplate>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productionOrderTemplates).set(data).where(eq(productionOrderTemplates.id, id));
}

export async function deleteOrderTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productionOrderTemplates).set({ isActive: false }).where(eq(productionOrderTemplates.id, id));
}

// ============ WIP TRACKING ============
export async function getWIPStatus(factoryId?: number) {
  const db = await getDb();
  if (!db) return { orders: [], summary: { total: 0, inProgress: 0, completed: 0, pending: 0 } };
  
  // Get all in-progress orders with their current status
  let query = db.select({
    id: productionOrders.id,
    orderCode: productionOrders.orderCode,
    productModelId: productionOrders.productModelId,
    lineId: productionOrders.lineId,
    targetQuantity: productionOrders.targetQuantity,
    completedQuantity: productionOrders.completedQuantity,
    okQuantity: productionOrders.okQuantity,
    ngQuantity: productionOrders.ngQuantity,
    status: productionOrders.status,
    plannedStartDate: productionOrders.plannedStartDate,
    plannedEndDate: productionOrders.plannedEndDate,
    updatedAt: productionOrders.updatedAt,
  }).from(productionOrders);
  
  const orders = factoryId 
    ? await query.where(eq(productionOrders.factoryId, factoryId))
    : await query;
  
  const summary = {
    total: orders.length,
    inProgress: orders.filter(o => o.status === 'in_progress').length,
    completed: orders.filter(o => o.status === 'completed').length,
    pending: orders.filter(o => o.status === 'pending').length,
  };
  
  return { orders, summary };
}

export async function getWIPByLine(lineId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select().from(productionOrders)
    .where(and(
      eq(productionOrders.lineId, lineId),
      eq(productionOrders.status, 'in_progress')
    ))
    .orderBy(productionOrders.priority);
}

// ============ SCHEDULING OPTIMIZATION ============
export interface ScheduleOptimizationResult {
  orderId: number;
  suggestedLineId: number;
  suggestedStartDate: Date;
  suggestedEndDate: Date;
  reason: string;
  score: number;
}

export async function optimizeSchedule(factoryId: number): Promise<ScheduleOptimizationResult[]> {
  const db = await getDb();
  if (!db) return [];
  
  // Get pending orders
  const pendingOrders = await db.select().from(productionOrders)
    .where(and(
      eq(productionOrders.factoryId, factoryId),
      eq(productionOrders.status, 'pending')
    ))
    .orderBy(desc(productionOrders.priority));
  
  // Get available lines with capacity
  const lines = await db.select().from(productionLines)
    .where(eq(productionLines.isActive, true));
  
  // Get current line utilization
  const inProgressOrders = await db.select().from(productionOrders)
    .where(and(
      eq(productionOrders.factoryId, factoryId),
      eq(productionOrders.status, 'in_progress')
    ));
  
  const lineUtilization = new Map<number, number>();
  for (const order of inProgressOrders) {
    const current = lineUtilization.get(order.lineId) || 0;
    lineUtilization.set(order.lineId, current + 1);
  }
  
  const suggestions: ScheduleOptimizationResult[] = [];
  
  for (const order of pendingOrders) {
    // Find best line based on utilization and capacity
    let bestLine = lines[0];
    let bestScore = 0;
    
    for (const line of lines) {
      const utilization = lineUtilization.get(line.id) || 0;
      const maxCapacity = line.maxConcurrentOrders || 5;
      const availableCapacity = maxCapacity - utilization;
      
      if (availableCapacity > 0) {
        const score = availableCapacity / maxCapacity * 100;
        if (score > bestScore) {
          bestScore = score;
          bestLine = line;
        }
      }
    }
    
    if (bestLine && bestScore > 0) {
      // Calculate suggested dates based on capacity
      const capacityPerHour = bestLine.capacityPerHour || 100;
      const hoursNeeded = Math.ceil(order.targetQuantity / capacityPerHour);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + hoursNeeded * 60 * 60 * 1000);
      
      suggestions.push({
        orderId: order.id,
        suggestedLineId: bestLine.id,
        suggestedStartDate: startDate,
        suggestedEndDate: endDate,
        reason: `Line ${bestLine.name} has ${Math.round(bestScore)}% available capacity`,
        score: bestScore,
      });
      
      // Update utilization for next iteration
      const current = lineUtilization.get(bestLine.id) || 0;
      lineUtilization.set(bestLine.id, current + 1);
    }
  }
  
  return suggestions.sort((a, b) => b.score - a.score);
}

export async function applyScheduleSuggestion(suggestion: ScheduleOptimizationResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(productionOrders)
    .set({
      lineId: suggestion.suggestedLineId,
      plannedStartDate: suggestion.suggestedStartDate,
      plannedEndDate: suggestion.suggestedEndDate,
      status: 'pending',
    })
    .where(eq(productionOrders.id, suggestion.orderId));
}


// ============ MQTT CLIENT CREATE ============
export async function createMqttClient(data: {
  deviceId: string;
  deviceName: string;
  deviceType?: string;
  stationId?: number;
  processId?: number;
  mappingType?: 'AUTO' | 'MANUAL';
  receiveNGAlerts?: boolean;
  receiveDailySummary?: boolean;
  receiveWeeklySummary?: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: number;
  approvedAt?: Date;
  connectionStatus?: 'ONLINE' | 'OFFLINE' | 'DISCONNECTED';
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Generate a unique clientId from deviceId
  const clientId = `client_${data.deviceId}_${Date.now()}`;
  
  const result = await db.insert(mqttClients).values({
    clientId,
    deviceId: data.deviceId,
    deviceName: data.deviceName,
    stationId: data.stationId || null,
    processId: data.processId || null,
    mappingType: data.mappingType || 'MANUAL',
    receiveNGAlerts: data.receiveNGAlerts ?? true,
    receiveDailySummary: data.receiveDailySummary ?? true,
    receiveWeeklySummary: data.receiveWeeklySummary ?? true,
    approvalStatus: data.approvalStatus || 'PENDING',
    approvedBy: data.approvedBy || null,
    approvedAt: data.approvedAt || null,
    connectionStatus: data.connectionStatus || 'OFFLINE',
    isActive: data.isActive ?? true,
  });
  
  return { id: Number(result[0].id) };
}

// ============ MQTT CLIENT CONNECTION HISTORY ============
export async function getMqttClientConnectionHistory(clientId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  // Get from mqtt_message_logs where targetClientId matches
  const results = await db.select({
    id: mqttMessageLogs.id,
    messageType: mqttMessageLogs.messageType,
    status: mqttMessageLogs.deliveryStatus,
    createdAt: mqttMessageLogs.createdAt,
    payload: mqttMessageLogs.payload,
  })
    .from(mqttMessageLogs)
    .where(eq(mqttMessageLogs.targetClientId, clientId))
    .orderBy(desc(mqttMessageLogs.createdAt))
    .limit(limit);
  
  return results;
}

// ============ MQTT CLIENT HEALTH ============
export async function getMqttClientHealth(clientId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const client = await getMqttClientById(clientId);
  if (!client) return null;
  
  // Get message stats for last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const messageStats = await db.select({
    total: sql<number>`COUNT(*)`,
    delivered: sql<number>`SUM(CASE WHEN ${mqttMessageLogs.deliveryStatus} = 'DELIVERED' THEN 1 ELSE 0 END)`,
    failed: sql<number>`SUM(CASE WHEN ${mqttMessageLogs.deliveryStatus} = 'FAILED' THEN 1 ELSE 0 END)`,
    pending: sql<number>`SUM(CASE WHEN ${mqttMessageLogs.deliveryStatus} = 'PENDING' THEN 1 ELSE 0 END)`,
  })
    .from(mqttMessageLogs)
    .where(and(
      eq(mqttMessageLogs.targetClientId, clientId),
      gte(mqttMessageLogs.createdAt, oneDayAgo)
    ));
  
  const stats = messageStats[0] || { total: 0, delivered: 0, failed: 0, pending: 0 };
  
  // Calculate uptime (simplified - based on last heartbeat)
  const lastSeenMs = client.lastHeartbeat ? new Date(client.lastHeartbeat).getTime() : 0;
  const uptimeMs = client.connectionStatus === 'ONLINE' ? Date.now() - lastSeenMs : 0;
  
  return {
    clientId,
    deviceName: client.deviceName,
    connectionStatus: client.connectionStatus,
    lastSeen: client.lastHeartbeat,
    uptimeMs,
    messageStats: {
      total: Number(stats.total),
      delivered: Number(stats.delivered),
      failed: Number(stats.failed),
      pending: Number(stats.pending),
      successRate: Number(stats.total) > 0 
        ? Math.round((Number(stats.delivered) / Number(stats.total)) * 100) 
        : 100,
    },
    healthScore: calculateClientHealthScore(client, stats),
  };
}

function calculateClientHealthScore(client: any, stats: any): number {
  let score = 100;
  
  // Connection status
  if (client.connectionStatus === 'OFFLINE') score -= 30;
  if (client.connectionStatus === 'DISCONNECTED') score -= 50;
  
  // Message success rate
  const successRate = Number(stats.total) > 0 
    ? Number(stats.delivered) / Number(stats.total) 
    : 1;
  score -= (1 - successRate) * 40;
  
  // Last seen (if offline for too long)
  if (client.lastHeartbeat) {
    const hoursSinceLastSeen = (Date.now() - new Date(client.lastHeartbeat).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastSeen > 24) score -= 20;
    else if (hoursSinceLastSeen > 1) score -= 10;
  }
  
  return Math.max(0, Math.round(score));
}

export async function getAllMqttClientsHealth() {
  const db = await getDb();
  if (!db) return [];
  
  const clients = await getMqttClients();
  const healthData = await Promise.all(
    clients.map(client => getMqttClientHealth(client.id))
  );
  
  return healthData.filter(h => h !== null);
}

// ============ WORKSTATION ERRORS ============
export async function getWorkstationErrors(filters: {
  stationId?: number;
  machineId?: number;
  limit?: number;
  includeResolved?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  // Get NG inspections as "errors"
  conditions.push(eq(productInspections.overallResult, 'NG'));
  
  if (filters.stationId) {
    // Get machines for this station
    const stationMachines = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.stationId, filters.stationId));
    
    if (stationMachines.length > 0) {
      const machineIds = stationMachines.map(m => m.id);
      conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
    }
  }
  
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  
  if (!filters.includeResolved) {
    // Only show recent errors (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    conditions.push(gte(productInspections.inspectionTime, oneDayAgo));
  }
  
  const results = await db.select({
    id: productInspections.id,
    serialNumber: productInspections.serialNumber,
    machineId: productInspections.machineId,
    overallResult: productInspections.overallResult,
    inspectionTime: productInspections.inspectionTime,
    productModel: productInspections.productModel,
    factoryCode: productInspections.factoryCode,
  })
    .from(productInspections)
    .where(and(...conditions))
    .orderBy(desc(productInspections.inspectionTime))
    .limit(filters.limit || 50);
  
  return results;
}

export async function getWorkstationErrorSummary(filters: {
  stationId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const db = await getDb();
  if (!db) return { total: 0, byMachine: [], byHour: [], byDefectType: [] };
  
  const conditions = [eq(productInspections.overallResult, 'NG')];
  
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  
  if (filters.stationId) {
    const stationMachines = await db.select({ id: machines.id })
      .from(machines)
      .where(eq(machines.stationId, filters.stationId));
    
    if (stationMachines.length > 0) {
      const machineIds = stationMachines.map(m => m.id);
      conditions.push(sql`${productInspections.machineId} IN (${machineIds.join(',')})`);
    }
  }
  
  // Total count
  const totalResult = await db.select({
    count: sql<number>`COUNT(*)`,
  })
    .from(productInspections)
    .where(and(...conditions));
  
  // By machine
  const byMachine = await db.select({
    machineId: productInspections.machineId,
    count: sql<number>`COUNT(*)`,
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(productInspections.machineId)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(10);
  
  // By hour (last 24 hours)
  const byHour = await db.select({
    hour: sql<string>`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d %H:00')`,
    count: sql<number>`COUNT(*)`,
  })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d %H:00')`)
    .orderBy(sql`DATE_FORMAT(${productInspections.inspectionTime}, '%Y-%m-%d %H:00')`);
  
  return {
    total: Number(totalResult[0]?.count || 0),
    byMachine: byMachine.map(m => ({ machineId: m.machineId, count: Number(m.count) })),
    byHour: byHour.map(h => ({ hour: h.hour, count: Number(h.count) })),
    byDefectType: [], // Would need measurement results join
  };
}
