import { eq, and, desc, like, or, sql, inArray, ne } from "drizzle-orm";
import { getDb } from "./connection";
import {
  factories, InsertFactory,
  workshops, InsertWorkshop,
  productionLines, InsertProductionLine,
  stations, InsertStation,
  machines, InsertMachine,
  workstations, InsertWorkstation,
  factoryZones, InsertFactoryZone,
  MACHINE_LIFECYCLE_TRANSITIONS,
  MACHINE_LIFECYCLE_EXCLUDED,
  isLegalLifecycleTransition,
  type MachineLifecycleStatus,
} from "../../drizzle/schema";

export { MACHINE_LIFECYCLE_TRANSITIONS, MACHINE_LIFECYCLE_EXCLUDED, isLegalLifecycleTransition };
export type { MachineLifecycleStatus };

// ── Doc 27 Đợt 3 / W3-B — domain errors (M2/M3/M7) ─────────────────────────
// Detected by NAME at the router layer (isErrorNamed) so tests can mock ../db
// without needing class identity across module boundaries.

/** Illegal machine lifecycle transition (M2) → router maps to CONFLICT. */
export class LifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleTransitionError";
  }
}

/** machines.code already used by an ACTIVE machine (M3/M7) → CONFLICT. */
export class MachineCodeCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MachineCodeCollisionError";
  }
}

/** True when the (possibly wrapped) error is a unique violation on the active-code partial index. */
function isActiveCodeUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string; message?: string; cause?: { code?: string; constraint_name?: string; message?: string } };
  const candidates = [err, err?.cause];
  return candidates.some((c) =>
    c?.code === "23505" &&
    ((c?.constraint_name ?? "").includes("machines_code") || (c?.message ?? "").includes("machines_code") ||
     (c?.constraint_name ?? "").includes("uq_machines_code_active") || (c?.message ?? "").includes("uq_machines_code_active")),
  );
}

// ── Doc 44 W2-A2 (G1.10) — asset URN/ISA-95 identity sync hooks ─────────────
// The db layer is the single choke point every machine mutation funnels
// through (hierarchyRouters / dataRouters / socket / _core auto-register), so
// the URN/path columns (0251) are kept fresh HERE. Fire-and-forget by design:
// the dynamic import + queue* wrappers never throw and never block/fail the
// mutation (see urnService — one warning per process, then silent).

function queueUrnSync(machineId: number): void {
  import("../services/assetRegistry/urnService")
    .then((m) => m.queueAssetIdentitySync(machineId, "db-hook"))
    .catch(() => undefined);
}

function queueUrnSyncForStation(stationId: number): void {
  import("../services/assetRegistry/urnService")
    .then((m) => m.queueStationAssetIdentitySync(stationId))
    .catch(() => undefined);
}

function queueUrnSyncForLine(lineId: number): void {
  import("../services/assetRegistry/urnService")
    .then((m) => m.queueLineAssetIdentitySync(lineId))
    .catch(() => undefined);
}

// ============ FACTORY FUNCTIONS ============
export async function createFactory(data: InsertFactory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(factories).values(data).returning({ id: factories.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
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

// ============ FACTORY ZONE FUNCTIONS (W6-25) ============
// Vùng polygon vẽ trên mặt bằng — CRUD gated ở tầng router bằng machine_control/canEdit.
export async function getFactoryZones(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryZones)
    .where(eq(factoryZones.factoryId, factoryId))
    .orderBy(factoryZones.id);
}

export async function createFactoryZone(data: InsertFactoryZone) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(factoryZones).values(data).returning({ id: factoryZones.id });
  return result.id;
}

export async function updateFactoryZone(id: number, data: Partial<InsertFactoryZone>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factoryZones).set({ ...data, updatedAt: new Date() }).where(eq(factoryZones.id, id));
}

export async function deleteFactoryZone(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(factoryZones).where(eq(factoryZones.id, id));
}

// ============ WORKSHOP FUNCTIONS ============
export async function createWorkshop(data: InsertWorkshop) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(workshops).values(data).returning({ id: workshops.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
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
  const [result] = await db.insert(productionLines).values(data).returning({ id: productionLines.id });
  return result.id;
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
  return result.length > 0 ? result[0] : undefined;
}

export async function updateProductionLine(id: number, data: Partial<InsertProductionLine>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set(data).where(eq(productionLines.id, id));
  // G1.10: line renamed or moved to another workshop → machine URNs under it change.
  if (data.code !== undefined || data.workshopId !== undefined) queueUrnSyncForLine(id);
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
  const [result] = await db.insert(stations).values(data).returning({ id: stations.id });
  return result.id;
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

// Get default station (first available station for auto-registration)
export async function getDefaultStation() {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stations).where(eq(stations.isActive, true)).orderBy(stations.id).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getStationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateStation(id: number, data: Partial<InsertStation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set(data).where(eq(stations.id, id));
  // G1.10: station renamed or reassigned to another line → machine URNs change.
  if (data.code !== undefined || data.lineId !== undefined) queueUrnSyncForStation(id);
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
  try {
    const [result] = await db.insert(machines).values(data).returning({ id: machines.id });
    queueUrnSync(result.id); // G1.10 — stamp urn/isa95_path (fire-and-forget)
    return result.id;
  } catch (e) {
    // M7: routers pre-check duplicates, but a concurrent insert can still hit
    // the partial unique index — surface a clean domain error, not a raw 500.
    if (isActiveCodeUniqueViolation(e)) {
      throw new MachineCodeCollisionError(`Machine code '${data.code}' is already in use by an active machine`);
    }
    throw e;
  }
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

// ── Doc 27 Đợt 5 / W5-E — gap F9: server-side search + pagination ──────────
// MachineRegistration previously pulled the FULL machine list and filtered
// client-side. This is the paged counterpart of getMachines(); `getMachines`
// itself is left untouched (30+ consumers rely on the full-list shape).
export async function getMachinesPaged(opts: {
  search?: string;
  registrationStatus?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  // Bounded server-side regardless of caller input (default 50, hard max 200).
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);

  const conditions = [eq(machines.isActive, true)];
  if (opts.registrationStatus) {
    conditions.push(eq(machines.registrationStatus, opts.registrationStatus));
  }
  const search = opts.search?.trim();
  if (search) {
    // Escape LIKE wildcards so a literal '%'/'_' in the query stays literal.
    const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
    const q = `%${escaped.toLowerCase()}%`;
    conditions.push(sql`(
      lower(${machines.code}) LIKE ${q}
      OR lower(${machines.name}) LIKE ${q}
      OR lower(coalesce(${machines.serialNumber}, '')) LIKE ${q}
      OR lower(${machines.machineType}) LIKE ${q}
    )`);
  }
  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db.select().from(machines).where(where).orderBy(machines.name).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(machines).where(where),
  ]);
  return { items, total: Number(totalRows[0]?.count) || 0 };
}

/** F9 — registration status counts for the summary cards (single grouped query). */
export async function getMachineRegistrationSummary() {
  const db = await getDb();
  if (!db) return { pending: 0, approved: 0, rejected: 0, total: 0 };
  const rows = await db
    .select({
      status: machines.registrationStatus,
      count: sql<number>`count(*)`,
    })
    .from(machines)
    .where(eq(machines.isActive, true))
    .groupBy(machines.registrationStatus);
  const summary = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    const n = Number(r.count) || 0;
    summary.total += n;
    if (r.status === "pending") summary.pending += n;
    else if (r.status === "approved") summary.approved += n;
    else if (r.status === "rejected") summary.rejected += n;
  }
  return summary;
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

// M2 soft-gate: ingest from a decommissioned/retired machine is NOT rejected
// (consistent with the commissioning-gate fail-open philosophy, 0177/0178) —
// we only WARN, throttled per machine so a chatty machine cannot flood logs.
// Hard flagging on the ingest row itself (machineApiRouters) is a Đợt-4 item.
const lifecycleWarnAt = new Map<number, number>();
const LIFECYCLE_WARN_INTERVAL_MS = 10 * 60 * 1000;

function warnIfLifecycleExcluded(machine: { id: number; code: string; lifecycleStatus?: string | null }): void {
  const status = machine.lifecycleStatus;
  if (!status || !(MACHINE_LIFECYCLE_EXCLUDED as readonly string[]).includes(status)) return;
  const now = Date.now();
  const last = lifecycleWarnAt.get(machine.id) ?? 0;
  if (now - last < LIFECYCLE_WARN_INTERVAL_MS) return;
  lifecycleWarnAt.set(machine.id, now);
  console.warn(
    `[machine-lifecycle] machine ${machine.id} (${machine.code}) is '${status}' but is still authenticating/ingesting — ` +
    `data is accepted (soft gate), but the machine should be re-commissioned or its credentials revoked`,
  );
}

export async function getMachineByApiKey(apiKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines)
    .where(and(eq(machines.apiKey, apiKey), eq(machines.isActive, true)))
    .limit(1);
  if (result.length === 0) return undefined;
  warnIfLifecycleExcluded(result[0]);
  return result[0];
}

export async function getMachineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMachineByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(machines)
    .where(and(eq(machines.code, code), eq(machines.isActive, true)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
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
  // G1.10: only code/station changes alter the URN — skip the (frequent) status writes.
  if (data.code !== undefined || data.stationId !== undefined) queueUrnSync(id);
}

/**
 * M3 soft-delete: the code column is kept INTACT as a tombstone (the partial
 * unique index uq_machines_code_active makes the code reusable by a new active
 * machine), and the asset is force-stamped 'retired' (M2 out-of-band stamp —
 * delete is terminal unless the row is explicitly restored).
 */
export async function deleteMachine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines)
    .set({ isActive: false, lifecycleStatus: "retired", updatedAt: new Date() })
    .where(eq(machines.id, id));
}

// Lấy máy theo serialNumber
// M3: ACTIVE rows only — a soft-deleted tombstone must never be silently
// resurrected by machine.register (re-registration creates a NEW row; the
// tombstone stays restorable via the recycle-bin flow).
export async function getMachineBySerialNumber(serialNumber: string) {
  const db = await getDb();
  if (!db) return undefined;
  // Tìm theo field serialNumber trước, sau đó fallback tìm theo code
  const bySerial = await db.select().from(machines)
    .where(and(eq(machines.serialNumber, serialNumber), eq(machines.isActive, true)))
    .limit(1);
  if (bySerial.length > 0) return bySerial[0];

  // Fallback: tìm theo code dạng SN-xxx
  const byCode = await db.select().from(machines)
    .where(and(eq(machines.code, `SN-${serialNumber}`), eq(machines.isActive, true)))
    .limit(1);
  return byCode.length > 0 ? byCode[0] : undefined;
}

// Lấy danh sách máy chờ duyệt (pending)
export async function getPendingMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines)
    .where(eq(machines.registrationStatus, "pending"))
    .orderBy(desc(machines.createdAt));
}

// Duyệt máy: cập nhật trạng thái, gán APIKey nếu chưa có.
// M2: approval also advances a 'commissioning' asset to 'active' (the admin
// sign-off IS the commissioning gate for the register flow) — other lifecycle
// states (maintenance/decommissioned/retired) are left untouched.
export async function approveMachine(id: number, data: {
  stationId?: number;
  code?: string;
  name?: string;
  apiKey?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({
    ...data,
    registrationStatus: "approved",
    lastSyncAt: new Date(),
  }).where(eq(machines.id, id));
  await db.update(machines)
    .set({ lifecycleStatus: "active" })
    .where(and(eq(machines.id, id), eq(machines.lifecycleStatus, "commissioning")));
  // G1.10: approval may (re)assign code/station → refresh the asset identity.
  if (data.code !== undefined || data.stationId !== undefined) queueUrnSync(id);
}

/**
 * Doc 27 Đợt 3 / W3-B — gap M2: the ONLY sanctioned way to move a machine
 * between asset lifecycle states. Validates against MACHINE_LIFECYCLE_TRANSITIONS
 * and returns minimal before/after snapshots for the audit trail.
 *
 * Throws:
 *  - Error("Machine not found")     — unknown id (router → NOT_FOUND)
 *  - LifecycleTransitionError       — illegal transition (router → CONFLICT)
 */
export async function transitionMachineLifecycle(
  id: number,
  to: MachineLifecycleStatus,
): Promise<{
  before: { id: number; code: string; name: string; lifecycleStatus: string };
  after: { id: number; code: string; name: string; lifecycleStatus: string };
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [machine] = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  if (!machine) throw new Error("Machine not found");

  const from = (machine.lifecycleStatus ?? "active") as MachineLifecycleStatus;
  if (from === to) {
    throw new LifecycleTransitionError(`Machine is already '${from}'`);
  }
  if (!isLegalLifecycleTransition(from, to)) {
    const allowed = MACHINE_LIFECYCLE_TRANSITIONS[from] ?? [];
    throw new LifecycleTransitionError(
      `Illegal lifecycle transition '${from}' → '${to}' (allowed from '${from}': ${allowed.length ? allowed.join(", ") : "none — terminal state"})`,
    );
  }

  await db.update(machines)
    .set({ lifecycleStatus: to, updatedAt: new Date() })
    .where(eq(machines.id, id));

  const snapshot = { id: machine.id, code: machine.code, name: machine.name };
  return {
    before: { ...snapshot, lifecycleStatus: from },
    after: { ...snapshot, lifecycleStatus: to },
  };
}

// Từ chối máy
export async function rejectMachine(id: number, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(machines).set({
    registrationStatus: "rejected",
    pendingConfig: reason || null,
  }).where(eq(machines.id, id));
}

// Lấy line theo stationId (thông qua station → line)
export async function getLineByStationId(stationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const station = await db.select().from(stations).where(eq(stations.id, stationId)).limit(1);
  if (station.length === 0) return undefined;
  const line = await db.select().from(productionLines).where(eq(productionLines.id, station[0].lineId)).limit(1);
  return line.length > 0 ? line[0] : undefined;
}

// ==============================
// Workstations Functions
// ==============================

export async function getWorkstations(filters?: { lineId?: number; workshopId?: number; factoryId?: number; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions: any[] = [];
  if (filters?.isActive !== undefined) conditions.push(eq(workstations.isActive, filters.isActive));
  if (filters?.lineId) conditions.push(eq(workstations.lineId, filters.lineId));
  if (filters?.workshopId) conditions.push(eq(workstations.workshopId, filters.workshopId));
  if (filters?.factoryId) conditions.push(eq(workstations.factoryId, filters.factoryId));
  
  if (conditions.length === 0) {
    return db.select().from(workstations).orderBy(workstations.orderIndex);
  }
  return db.select().from(workstations).where(and(...conditions)).orderBy(workstations.orderIndex);
}

export async function getWorkstationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(workstations).where(eq(workstations.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getWorkstationByCode(code: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(workstations).where(eq(workstations.code, code)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createWorkstation(data: Omit<InsertWorkstation, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [result] = await db.insert(workstations).values(data).returning({ id: workstations.id });
  return result.id;
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

// ============ HIERARCHY TREE FUNCTIONS (for MQTT subscription setup) ============

/**
 * Get full hierarchy tree: Factory → Workshop → Line → Station → Machine
 * Returns flat joined rows for tree assembly on the router layer.
 */
export async function getFullHierarchyFlat() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      factoryId: factories.id,
      factoryCode: factories.code,
      factoryName: factories.name,
      factoryIsActive: factories.isActive,
      workshopId: workshops.id,
      workshopCode: workshops.code,
      workshopName: workshops.name,
      workshopIsActive: workshops.isActive,
      lineId: productionLines.id,
      lineCode: productionLines.code,
      lineName: productionLines.name,
      lineIsActive: productionLines.isActive,
      stationId: stations.id,
      stationCode: stations.code,
      stationName: stations.name,
      stationOrderIndex: stations.orderIndex,
      stationIsActive: stations.isActive,
      machineId: machines.id,
      machineCode: machines.code,
      machineName: machines.name,
      machineType: machines.machineType,
      machineOperationStatus: machines.operationStatus,
      machineIsActive: machines.isActive,
    })
    .from(factories)
    .leftJoin(workshops, eq(workshops.factoryId, factories.id))
    .leftJoin(productionLines, eq(productionLines.workshopId, workshops.id))
    .leftJoin(stations, eq(stations.lineId, productionLines.id))
    .leftJoin(machines, eq(machines.stationId, stations.id))
    .where(eq(factories.isActive, true))
    .orderBy(
      factories.name,
      workshops.name,
      productionLines.name,
      stations.orderIndex,
      machines.name,
    );
}

/**
 * Get hierarchy tree for a specific factory
 */
export async function getFactoryHierarchyFlat(factoryId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      factoryId: factories.id,
      factoryCode: factories.code,
      factoryName: factories.name,
      workshopId: workshops.id,
      workshopCode: workshops.code,
      workshopName: workshops.name,
      lineId: productionLines.id,
      lineCode: productionLines.code,
      lineName: productionLines.name,
      stationId: stations.id,
      stationCode: stations.code,
      stationName: stations.name,
      stationOrderIndex: stations.orderIndex,
      machineId: machines.id,
      machineCode: machines.code,
      machineName: machines.name,
      machineType: machines.machineType,
      machineOperationStatus: machines.operationStatus,
    })
    .from(factories)
    .leftJoin(workshops, and(eq(workshops.factoryId, factories.id), eq(workshops.isActive, true)))
    .leftJoin(productionLines, and(eq(productionLines.workshopId, workshops.id), eq(productionLines.isActive, true)))
    .leftJoin(stations, and(eq(stations.lineId, productionLines.id), eq(stations.isActive, true)))
    .leftJoin(machines, and(eq(machines.stationId, stations.id), eq(machines.isActive, true)))
    .where(and(eq(factories.id, factoryId), eq(factories.isActive, true)))
    .orderBy(
      workshops.name,
      productionLines.name,
      stations.orderIndex,
      machines.name,
    );
}

// ============ CASCADE DELETE FUNCTIONS ============

// Get counts of children under a factory
export async function getFactoryCascadeInfo(factoryId: number) {
  const db = await getDb();
  if (!db) return { workshops: 0, lines: 0, stations: 0, machines: 0 };
  const ws = await db.select({ id: workshops.id }).from(workshops)
    .where(and(eq(workshops.factoryId, factoryId), eq(workshops.isActive, true)));
  const wsIds = ws.map(w => w.id);
  if (wsIds.length === 0) return { workshops: 0, lines: 0, stations: 0, machines: 0 };
  const ln = await db.select({ id: productionLines.id }).from(productionLines)
    .where(and(inArray(productionLines.workshopId, wsIds), eq(productionLines.isActive, true)));
  const lnIds = ln.map(l => l.id);
  let stCount = 0, mcCount = 0;
  if (lnIds.length > 0) {
    const st = await db.select({ id: stations.id }).from(stations)
      .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
    stCount = st.length;
    const stIds = st.map(s => s.id);
    if (stIds.length > 0) {
      const mc = await db.select({ id: machines.id }).from(machines)
        .where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
      mcCount = mc.length;
    }
  }
  return { workshops: wsIds.length, lines: lnIds.length, stations: stCount, machines: mcCount };
}

// Get counts of children under a workshop
export async function getWorkshopCascadeInfo(workshopId: number) {
  const db = await getDb();
  if (!db) return { lines: 0, stations: 0, machines: 0 };
  const ln = await db.select({ id: productionLines.id }).from(productionLines)
    .where(and(eq(productionLines.workshopId, workshopId), eq(productionLines.isActive, true)));
  const lnIds = ln.map(l => l.id);
  if (lnIds.length === 0) return { lines: 0, stations: 0, machines: 0 };
  const st = await db.select({ id: stations.id }).from(stations)
    .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
  const stIds = st.map(s => s.id);
  let mcCount = 0;
  if (stIds.length > 0) {
    const mc = await db.select({ id: machines.id }).from(machines)
      .where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
    mcCount = mc.length;
  }
  return { lines: lnIds.length, stations: stIds.length, machines: mcCount };
}

// Get counts of children under a line
export async function getLineCascadeInfo(lineId: number) {
  const db = await getDb();
  if (!db) return { stations: 0, machines: 0 };
  const st = await db.select({ id: stations.id }).from(stations)
    .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)));
  const stIds = st.map(s => s.id);
  let mcCount = 0;
  if (stIds.length > 0) {
    const mc = await db.select({ id: machines.id }).from(machines)
      .where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
    mcCount = mc.length;
  }
  return { stations: stIds.length, machines: mcCount };
}

// Get counts of children under a station
export async function getStationCascadeInfo(stationId: number) {
  const db = await getDb();
  if (!db) return { machines: 0 };
  const mc = await db.select({ id: machines.id }).from(machines)
    .where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)));
  return { machines: mc.length };
}

// Cascade soft-delete factory and all children
export async function cascadeDeleteFactory(factoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // W2.8: atomic cascade — a crash mid-cascade must not leave a half-deleted hierarchy.
  await db.transaction(async (tx) => {
    const ws = await tx.select({ id: workshops.id }).from(workshops)
      .where(and(eq(workshops.factoryId, factoryId), eq(workshops.isActive, true)));
    const wsIds = ws.map(w => w.id);
    if (wsIds.length > 0) {
      const ln = await tx.select({ id: productionLines.id }).from(productionLines)
        .where(and(inArray(productionLines.workshopId, wsIds), eq(productionLines.isActive, true)));
      const lnIds = ln.map(l => l.id);
      if (lnIds.length > 0) {
        const st = await tx.select({ id: stations.id }).from(stations)
          .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
        const stIds = st.map(s => s.id);
        if (stIds.length > 0) {
          await tx.update(machines).set({ isActive: false, lifecycleStatus: "retired" }).where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
          await tx.update(stations).set({ isActive: false }).where(inArray(stations.id, stIds));
        }
        await tx.update(productionLines).set({ isActive: false }).where(inArray(productionLines.id, lnIds));
      }
      await tx.update(workshops).set({ isActive: false }).where(inArray(workshops.id, wsIds));
    }
    await tx.update(factories).set({ isActive: false }).where(eq(factories.id, factoryId));
  });
}

// Cascade soft-delete workshop and all children
export async function cascadeDeleteWorkshop(workshopId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const ln = await tx.select({ id: productionLines.id }).from(productionLines)
      .where(and(eq(productionLines.workshopId, workshopId), eq(productionLines.isActive, true)));
    const lnIds = ln.map(l => l.id);
    if (lnIds.length > 0) {
      const st = await tx.select({ id: stations.id }).from(stations)
        .where(and(inArray(stations.lineId, lnIds), eq(stations.isActive, true)));
      const stIds = st.map(s => s.id);
      if (stIds.length > 0) {
        await tx.update(machines).set({ isActive: false, lifecycleStatus: "retired" }).where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
        await tx.update(stations).set({ isActive: false }).where(inArray(stations.id, stIds));
      }
      await tx.update(productionLines).set({ isActive: false }).where(inArray(productionLines.id, lnIds));
    }
    await tx.update(workshops).set({ isActive: false }).where(eq(workshops.id, workshopId));
  });
}

// Cascade soft-delete line and all children
export async function cascadeDeleteLine(lineId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const st = await tx.select({ id: stations.id }).from(stations)
      .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)));
    const stIds = st.map(s => s.id);
    if (stIds.length > 0) {
      await tx.update(machines).set({ isActive: false, lifecycleStatus: "retired" }).where(and(inArray(machines.stationId, stIds), eq(machines.isActive, true)));
      await tx.update(stations).set({ isActive: false }).where(inArray(stations.id, stIds));
    }
    await tx.update(productionLines).set({ isActive: false }).where(eq(productionLines.id, lineId));
  });
}

// Cascade soft-delete station and all children
export async function cascadeDeleteStation(stationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    await tx.update(machines).set({ isActive: false, lifecycleStatus: "retired" }).where(and(eq(machines.stationId, stationId), eq(machines.isActive, true)));
    await tx.update(stations).set({ isActive: false }).where(eq(stations.id, stationId));
  });
}

// ============ LIST DELETED (INACTIVE) FUNCTIONS ============

export async function getDeletedFactories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factories).where(eq(factories.isActive, false)).orderBy(factories.name);
}

export async function getDeletedWorkshops() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workshops).where(eq(workshops.isActive, false)).orderBy(workshops.name);
}

export async function getDeletedLines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productionLines).where(eq(productionLines.isActive, false)).orderBy(productionLines.name);
}

export async function getDeletedStations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stations).where(eq(stations.isActive, false)).orderBy(stations.orderIndex);
}

export async function getDeletedMachines() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(machines).where(eq(machines.isActive, false)).orderBy(machines.name);
}

export async function getDeletedWorkstations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workstations).where(eq(workstations.isActive, false)).orderBy(workstations.orderIndex);
}

// ============ RESTORE FUNCTIONS ============

export async function restoreFactory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(factories).set({ isActive: true }).where(eq(factories.id, id));
}

export async function restoreWorkshop(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workshops).set({ isActive: true }).where(eq(workshops.id, id));
}

export async function restoreLine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(productionLines).set({ isActive: true }).where(eq(productionLines.id, id));
}

export async function restoreStation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(stations).set({ isActive: true }).where(eq(stations.id, id));
}

/**
 * M3 restore: because code uniqueness is only enforced among ACTIVE machines,
 * a tombstone's code may have been reused by a newer registration. Restoring
 * such a machine must fail with a clean domain error (router → CONFLICT with a
 * message naming the current holder), NOT a raw index violation.
 *
 * M2: a restored machine lands on 'decommissioned' — one legal transition away
 * from 'active' — so it stays excluded from auto-assign until a human
 * explicitly re-commissions it (decommissioned → active).
 */
export async function restoreMachine(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [machine] = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  if (!machine) throw new Error("Machine not found");
  if (machine.isActive) return; // already restored — idempotent

  const [holder] = await db.select({ id: machines.id, name: machines.name }).from(machines)
    .where(and(eq(machines.code, machine.code), eq(machines.isActive, true), ne(machines.id, id)))
    .limit(1);
  if (holder) {
    throw new MachineCodeCollisionError(
      `Cannot restore: code '${machine.code}' has been reused by active machine #${holder.id} (${holder.name}). ` +
      `Rename or delete that machine first.`,
    );
  }

  try {
    await db.update(machines)
      .set({ isActive: true, lifecycleStatus: "decommissioned", updatedAt: new Date() })
      .where(eq(machines.id, id));
  } catch (e) {
    if (isActiveCodeUniqueViolation(e)) {
      throw new MachineCodeCollisionError(
        `Cannot restore: code '${machine.code}' has just been taken by another active machine`,
      );
    }
    throw e;
  }
}

export async function restoreWorkstation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(workstations).set({ isActive: true }).where(eq(workstations.id, id));
}
