/**
 * Database queries for License Management
 */
import { getDb } from "./connection";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  licenses,
  type InsertLicense,
  licenseActivations,
  type InsertLicenseActivation,
  licenseSyncLogs,
  type InsertLicenseSyncLog,
  licenseRevocations,
  type InsertLicenseRevocation,
  licenseModules,
  type InsertLicenseModule,
} from "../../drizzle/schema";

// =====================================================
// License CRUD
// =====================================================

export async function createLicense(data: InsertLicense) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.insert(licenses).values(data).returning();
  return result;
}

export async function getLicenseByKey(licenseKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.select().from(licenses).where(eq(licenses.licenseKey, licenseKey)).limit(1);
  return result ?? null;
}

export async function getLicenseById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.select().from(licenses).where(eq(licenses.id, id)).limit(1);
  return result ?? null;
}

export async function getAllLicenses(params?: {
  status?: string;
  productCode?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const conditions: any[] = [];
  if (params?.status) conditions.push(eq(licenses.status, params.status as any));
  if (params?.productCode) conditions.push(eq(licenses.productCode, params.productCode));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(licenses)
    .where(where)
    .orderBy(desc(licenses.createdAt))
    .limit(params?.limit || 100)
    .offset(params?.offset || 0);

  const [countResult] = await db.select({ count: sql<number>`count(*)` })
    .from(licenses)
    .where(where);

  return {
    licenses: rows,
    total: Number(countResult?.count || 0),
  };
}

export async function updateLicense(id: number, data: Partial<InsertLicense>) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.update(licenses)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(licenses.id, id))
    .returning();
  return result;
}

export async function updateLicenseByKey(licenseKey: string, data: Partial<InsertLicense>) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.update(licenses)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(licenses.licenseKey, licenseKey))
    .returning();
  return result;
}

export async function deleteLicense(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  await db.delete(licenses).where(eq(licenses.id, id));
}

// =====================================================
// License Activations
// =====================================================

export async function createLicenseActivation(data: InsertLicenseActivation) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.insert(licenseActivations).values(data).returning();
  return result;
}

export async function getActivationsByLicenseKey(licenseKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  return db.select().from(licenseActivations)
    .where(eq(licenseActivations.licenseKey, licenseKey))
    .orderBy(desc(licenseActivations.activatedAt));
}

export async function getActivationByFingerprint(licenseKey: string, fingerprint: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.select().from(licenseActivations)
    .where(and(
      eq(licenseActivations.licenseKey, licenseKey),
      eq(licenseActivations.hardwareFingerprint, fingerprint),
    ))
    .limit(1);

  return result ?? null;
}

export async function getActiveActivationCount(licenseKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(licenseActivations)
    .where(and(
      eq(licenseActivations.licenseKey, licenseKey),
      eq(licenseActivations.isActive, true),
    ));

  return Number(result?.count || 0);
}

export async function updateActivationLastSeen(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  await db.update(licenseActivations)
    .set({ lastSeenAt: new Date() })
    .where(eq(licenseActivations.id, id));
}

export async function deactivateActivation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  await db.update(licenseActivations)
    .set({ isActive: false, deactivatedAt: new Date() })
    .where(eq(licenseActivations.id, id));
}

export async function deactivateAllActivations(licenseKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  await db.update(licenseActivations)
    .set({ isActive: false, deactivatedAt: new Date() })
    .where(eq(licenseActivations.licenseKey, licenseKey));
}

// =====================================================
// License Sync Logs
// =====================================================

export async function createSyncLog(data: InsertLicenseSyncLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.insert(licenseSyncLogs).values(data).returning();
  return result;
}

export async function getSyncLogs(licenseKey: string, limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  return db.select().from(licenseSyncLogs)
    .where(eq(licenseSyncLogs.licenseKey, licenseKey))
    .orderBy(desc(licenseSyncLogs.createdAt))
    .limit(limit);
}

// =====================================================
// Revocations (CRL)
// =====================================================

export async function revokeLicense(data: InsertLicenseRevocation) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  // Upsert revocation
  const [result] = await db.insert(licenseRevocations)
    .values(data)
    .onConflictDoUpdate({
      target: licenseRevocations.licenseKey,
      set: {
        reason: data.reason,
        revokedBy: data.revokedBy,
        revokedAt: new Date(),
      },
    })
    .returning();

  // Update license status
  await db.update(licenses)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(licenses.licenseKey, data.licenseKey));

  // Deactivate all activations
  await deactivateAllActivations(data.licenseKey);

  return result;
}

export async function unrevokeLicense(licenseKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  await db.delete(licenseRevocations).where(eq(licenseRevocations.licenseKey, licenseKey));
  await db.update(licenses)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(licenses.licenseKey, licenseKey));
}

export async function getRevokedKeys() {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const rows = await db.select({ licenseKey: licenseRevocations.licenseKey })
    .from(licenseRevocations);
  return rows.map(r => r.licenseKey);
}

export async function isLicenseRevoked(licenseKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.select().from(licenseRevocations)
    .where(eq(licenseRevocations.licenseKey, licenseKey))
    .limit(1);
  return !!result;
}

// =====================================================
// License Modules
// =====================================================

export async function createLicenseModule(data: InsertLicenseModule) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.insert(licenseModules).values(data).returning();
  return result;
}

export async function getAllLicenseModules() {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  return db.select().from(licenseModules).orderBy(licenseModules.moduleCode);
}

export async function updateLicenseModule(id: number, data: Partial<InsertLicenseModule>) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [result] = await db.update(licenseModules)
    .set(data)
    .where(eq(licenseModules.id, id))
    .returning();
  return result;
}

export async function deleteLicenseModule(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  await db.delete(licenseModules).where(eq(licenseModules.id, id));
}

// =====================================================
// License Statistics
// =====================================================

export async function getLicenseStats() {
  const db = await getDb();
  if (!db) throw new Error("Database not connected");

  const [total] = await db.select({ count: sql<number>`count(*)` }).from(licenses);
  const [active] = await db.select({ count: sql<number>`count(*)` }).from(licenses).where(eq(licenses.status, 'active'));
  const [expired] = await db.select({ count: sql<number>`count(*)` }).from(licenses).where(eq(licenses.status, 'expired'));
  const [revoked] = await db.select({ count: sql<number>`count(*)` }).from(licenses).where(eq(licenses.status, 'revoked'));
  const [totalActivations] = await db.select({ count: sql<number>`count(*)` }).from(licenseActivations).where(eq(licenseActivations.isActive, true));

  return {
    totalLicenses: Number(total?.count || 0),
    activeLicenses: Number(active?.count || 0),
    expiredLicenses: Number(expired?.count || 0),
    revokedLicenses: Number(revoked?.count || 0),
    totalActiveActivations: Number(totalActivations?.count || 0),
  };
}
