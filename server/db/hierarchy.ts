import { eq, and, desc, like, or, sql, inArray, ne, lt, isNull, isNotNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { pgTable, serial, integer, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { getDb } from "./connection";
import {
  factories, InsertFactory,
  workshops, InsertWorkshop,
  productionLines, InsertProductionLine,
  stations, InsertStation,
  machines, InsertMachine,
  workstations, InsertWorkstation,
  factoryZones, InsertFactoryZone,
  apiKeys,
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

/**
 * Doc 51 P0 / R1 — a claim token could not be redeemed. `reason` drives the
 * router's status mapping AND the audit row; the MESSAGE is deliberately vague
 * for every reason except `no_key` so a caller cannot enumerate serial numbers
 * or distinguish "wrong token" from "unknown machine".
 */
export class ClaimTokenError extends Error {
  constructor(
    message: string,
    public readonly reason: "invalid" | "used" | "expired" | "no_key",
  ) {
    super(message);
    this.name = "ClaimTokenError";
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

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P0 / R1 — ONE-TIME CLAIM TOKENS + CREDENTIAL REVOCATION
// ════════════════════════════════════════════════════════════════════════════
// `machine.config` used to hand out machines.apiKey in plaintext to anyone who
// knew the serial number (printed on the machine's label). It no longer does;
// a machine now exchanges a short-lived, single-use CLAIM TOKEN for its key.
//
// NOTE (schema location): the canonical home for a pgTable in this repo is
// drizzle/schema/*. This table is declared here because migration 0273 and this
// module are the only code that touch it and the schema dir was out of scope
// for this change — see the hand-off note. Nothing breaks either way:
// `db:push` runs scripts/migrate-standalone.mjs (plain SQL files), NOT
// drizzle-kit push, so a table outside drizzle/schema is never dropped.

export const machineClaimTokens = pgTable("machine_claim_tokens", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  /** SHA-256 hex of the plaintext — the plaintext is NEVER stored. */
  tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
  /** Short, NON-SECRET display prefix (e.g. "mct_3f9c") for audit correlation. */
  tokenPrefix: varchar("tokenPrefix", { length: 32 }),
  expiresAt: timestamp("expiresAt").notNull(),
  /** The single-use enforcement bit (claimed under `WHERE usedAt IS NULL`). */
  usedAt: timestamp("usedAt"),
  usedFromIp: varchar("usedFromIp", { length: 64 }),
  /** Superseded by a newer token, or burned by a credential revocation. */
  invalidatedAt: timestamp("invalidatedAt"),
  issuedBy: integer("issuedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_machine_claim_tokens_hash").on(table.tokenHash),
  index("idx_machine_claim_tokens_machine").on(table.machineId),
]);

export type MachineClaimToken = typeof machineClaimTokens.$inferSelect;

// Handle usable for both the top-level db and a transaction handle — derived
// from the db's own transaction callback so the query-builder surface stays
// fully typed (same idiom as server/db/machineRecipe.ts).
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbOrTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Claim-token lifetime in minutes. Default 15; clamped to (0, 24h]. */
export function machineClaimTokenTtlMinutes(): number {
  const n = parseInt(process.env.MACHINE_CLAIM_TOKEN_TTL_MINUTES || "15", 10);
  return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? n : 15;
}

/**
 * SHA-256 hex. The token is 256 bits of CSPRNG output, so a plain hash is the
 * right primitive here (no KDF needed — there is no low-entropy secret to
 * stretch, and this runs on the machine-facing hot path).
 */
function hashClaimToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** `mct_<64 hex>` — distinct from mk_ (machine keys) and ak_ (admin keys). */
function generateClaimToken(): { plaintext: string; prefix: string } {
  const secret = randomBytes(32).toString("hex");
  return { plaintext: `mct_${secret}`, prefix: `mct_${secret.slice(0, 6)}` };
}

/**
 * Mint a one-time claim token for a machine. Any token still open for that
 * machine is invalidated first, so AT MOST ONE token is redeemable at a time
 * (a re-issue must not leave an older token alive in a technician's inbox).
 *
 * The PLAINTEXT is returned EXACTLY ONCE and never persisted.
 */
export async function issueMachineClaimToken(opts: {
  machineId: number;
  issuedBy?: number | null;
  ttlMinutes?: number;
}): Promise<{ token: string; tokenPrefix: string; expiresAt: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const ttl = opts.ttlMinutes && opts.ttlMinutes > 0 ? opts.ttlMinutes : machineClaimTokenTtlMinutes();
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  const { plaintext, prefix } = generateClaimToken();

  await db.transaction(async (tx) => {
    await tx.update(machineClaimTokens)
      .set({ invalidatedAt: new Date() })
      .where(and(
        eq(machineClaimTokens.machineId, opts.machineId),
        isNull(machineClaimTokens.usedAt),
        isNull(machineClaimTokens.invalidatedAt),
      ));
    await tx.insert(machineClaimTokens).values({
      machineId: opts.machineId,
      tokenHash: hashClaimToken(plaintext),
      tokenPrefix: prefix,
      expiresAt,
      issuedBy: opts.issuedBy ?? null,
    });
  });

  return { token: plaintext, tokenPrefix: prefix, expiresAt };
}

/**
 * Redeem a claim token for the machine's apiKey — EXACTLY ONCE.
 *
 * The whole exchange runs in ONE transaction: the token is burned
 * (`usedAt` stamped under `WHERE usedAt IS NULL`, so two concurrent claims
 * cannot both win) and the key is read in the same unit of work. Any failure
 * AFTER the burn rolls it back, so a token is only ever consumed by a redemption
 * that actually handed a key back.
 *
 * Throws ClaimTokenError (router → UNAUTHORIZED / PRECONDITION_FAILED).
 */
export async function redeemMachineClaimToken(opts: {
  serialNumber: string;
  claimToken: string;
  fromIp?: string | null;
}): Promise<{ machineId: number; machineCode: string; apiKey: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Uniform error: never reveal whether the SERIAL or the TOKEN was the problem.
  const invalid = () => new ClaimTokenError("Invalid or expired claim token", "invalid");

  const machine = await getMachineBySerialNumber(opts.serialNumber);
  if (!machine) throw invalid();

  const tokenHash = hashClaimToken(opts.claimToken);

  return db.transaction(async (tx) => {
    const [token] = await tx.select().from(machineClaimTokens)
      .where(and(
        eq(machineClaimTokens.tokenHash, tokenHash),
        eq(machineClaimTokens.machineId, machine.id),
      ))
      .limit(1);

    // Hash miss, or a token minted for a DIFFERENT machine (never usable here).
    if (!token) throw invalid();
    if (token.usedAt) throw new ClaimTokenError("Claim token has already been used", "used");
    if (token.invalidatedAt) throw invalid(); // superseded / burned by a revoke
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      throw new ClaimTokenError("Claim token has expired — ask an admin to issue a new one", "expired");
    }

    // Single-use: the row is only claimed if it is STILL unused. A concurrent
    // redemption that lost the race gets 0 rows back and is rejected.
    const claimed = await tx.update(machineClaimTokens)
      .set({ usedAt: new Date(), usedFromIp: opts.fromIp ?? null })
      .where(and(
        eq(machineClaimTokens.id, token.id),
        isNull(machineClaimTokens.usedAt),
      ))
      .returning({ id: machineClaimTokens.id });
    if (claimed.length === 0) {
      throw new ClaimTokenError("Claim token has already been used", "used");
    }

    // Re-read the machine INSIDE the transaction: the key may have been rotated
    // or revoked between the serial lookup and the burn.
    const [fresh] = await tx.select().from(machines).where(eq(machines.id, machine.id)).limit(1);
    if (!fresh || fresh.isActive === false) throw invalid();
    if (fresh.registrationStatus !== "approved" || !fresh.apiKey) {
      // Rolls the burn back — a token must not die for a server-side gap.
      throw new ClaimTokenError(
        "Machine has no active credential to claim — an admin must approve it first",
        "no_key",
      );
    }

    return { machineId: fresh.id, machineCode: fresh.code, apiKey: fresh.apiKey };
  });
}

type MachineCredentialRevocation = { apiKeysRevoked: number; sharedKeyCleared: boolean };

/**
 * Revoke EVERY credential a machine can authenticate with, on an open tx:
 *   1. api_keys rows bound to it   → isActive=false + revokedAt (machineAuthService
 *      denies both bits, resolution step 1)
 *   2. machines.apiKey             → NULL (the legacy shared-key path, step 2)
 *   3. any open claim token        → invalidated (nothing left to exchange)
 *
 * Callers MUST run this inside the same transaction as the state change that
 * justifies it, so a machine can never be left retired-but-authenticating.
 */
async function revokeMachineCredentialsTx(
  tx: DbOrTx,
  machineId: number,
): Promise<MachineCredentialRevocation> {
  const now = new Date();

  const revokedKeys = await tx.update(apiKeys)
    .set({ isActive: false, revokedAt: now, updatedAt: now })
    .where(and(eq(apiKeys.machineId, machineId), eq(apiKeys.isActive, true)))
    .returning({ id: apiKeys.id });

  const clearedShared = await tx.update(machines)
    .set({ apiKey: null, updatedAt: now })
    .where(and(eq(machines.id, machineId), isNotNull(machines.apiKey)))
    .returning({ id: machines.id });

  await tx.update(machineClaimTokens)
    .set({ invalidatedAt: now })
    .where(and(
      eq(machineClaimTokens.machineId, machineId),
      isNull(machineClaimTokens.usedAt),
      isNull(machineClaimTokens.invalidatedAt),
    ));

  return { apiKeysRevoked: revokedKeys.length, sharedKeyCleared: clearedShared.length > 0 };
}

/** Standalone credential revocation (own transaction) — for admin tooling/rotation. */
export async function revokeMachineCredentials(machineId: number): Promise<MachineCredentialRevocation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => revokeMachineCredentialsTx(tx, machineId));
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P3 / §5.1 — ZERO-TOUCH ENROLLMENT TOKENS (gỡ nghẽn single-admin)
// ════════════════════════════════════════════════════════════════════════════
// A machine used to need an admin to approve it AND mint/hand it a key, one at a
// time. An ENROLLMENT TOKEN lets a VALID machine self-serve: it presents an
// admin-issued, high-entropy token and the server approves it + tells the caller
// the machine is ready for a scoped mk_ key (the router then issues that key via
// machineAuthService.issueMachineKey). Same hash-at-rest / TTL / revoke posture
// as the P0 claim token (0273); DIFFERENCE: a claim token trades for an EXISTING
// machines.apiKey for ONE already-approved machine, whereas an enrollment token
// APPROVES the machine and can be an ALLOWLIST (serialPattern, maxUses>1) for a
// batch roll-out. Table declared here for the same reason machineClaimTokens is
// (migration 0283 + this module are its only touch points; db:push runs plain
// SQL, not drizzle-kit, so a table outside drizzle/schema is never dropped).

export const machineEnrollmentTokens = pgTable("machine_enrollment_tokens", {
  id: serial("id").primaryKey(),
  /** SHA-256 hex of the plaintext — the plaintext is NEVER stored. */
  tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
  /** Short, NON-SECRET display prefix (e.g. "met_3f9c") for audit correlation. */
  tokenPrefix: varchar("tokenPrefix", { length: 32 }),
  /** Allowlist match for serialNumber. NULL = one-time for a single machine. */
  serialPattern: varchar("serialPattern", { length: 120 }),
  /** Scopes granted to the auto-issued mk_ key (min ingest:write). */
  scopes: jsonb("scopes").$type<string[]>().notNull().default(["ingest:write", "equipment:read"]),
  /** Max redemptions (one-time = 1; allowlist batch = N) — the single-use bit. */
  maxUses: integer("maxUses").notNull().default(1),
  useCount: integer("useCount").notNull().default(0),
  expiresAt: timestamp("expiresAt").notNull(),
  /** Admin revoked it (distinct from expired / exhausted). */
  revokedAt: timestamp("revokedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  lastUsedFromIp: varchar("lastUsedFromIp", { length: 64 }),
  note: varchar("note", { length: 255 }),
  issuedBy: integer("issuedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_machine_enrollment_tokens_hash").on(table.tokenHash),
  index("idx_machine_enrollment_tokens_open").on(table.expiresAt),
]);

export type MachineEnrollmentToken = typeof machineEnrollmentTokens.$inferSelect;

/** Default scopes the auto-issued mk_ key gets when a token does not narrow them. */
export const ENROLLMENT_DEFAULT_SCOPES: readonly string[] = ["ingest:write", "equipment:read"];

/**
 * Doc 51 P3 — an enrollment could not be completed. `reason` drives the router's
 * status mapping AND the audit row. Messages are deliberately UNIFORM for the
 * token-secrecy cases (`invalid` covers hash-miss, revoked, and serial-pattern
 * mismatch) so a caller cannot enumerate tokens or serials; the operational
 * cases (`exhausted`, `machine_locked`, `needs_info`, `no_station`) are explicit.
 */
export class EnrollmentTokenError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "invalid"
      | "expired"
      | "exhausted"
      | "machine_locked"
      | "needs_info"
      | "no_station",
  ) {
    super(message);
    this.name = "EnrollmentTokenError";
  }
}

/** Enrollment-token lifetime in minutes. Default 60; clamped to (0, 30 days]. */
export function machineEnrollmentTokenTtlMinutes(): number {
  const n = parseInt(process.env.MACHINE_ENROLLMENT_TOKEN_TTL_MINUTES || "60", 10);
  return Number.isFinite(n) && n > 0 && n <= 30 * 24 * 60 ? n : 60;
}

/** SHA-256 hex — same primitive/rationale as the claim token (256-bit CSPRNG). */
function hashEnrollmentToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** `met_<64 hex>` — distinct from mct_ (claim), mk_ (machine key), ak_ (admin). */
function generateEnrollmentToken(): { plaintext: string; prefix: string } {
  const secret = randomBytes(32).toString("hex");
  return { plaintext: `met_${secret}`, prefix: `met_${secret.slice(0, 6)}` };
}

/**
 * Allowlist match. NULL pattern → any serial (one-time). A trailing `*` is a
 * PREFIX match (no regex → no ReDoS); otherwise an exact, case-sensitive match.
 */
export function serialMatchesEnrollmentPattern(serialNumber: string, pattern: string | null | undefined): boolean {
  if (!pattern) return true;
  if (pattern.endsWith("*")) return serialNumber.startsWith(pattern.slice(0, -1));
  return serialNumber === pattern;
}

/**
 * Mint an enrollment token. The PLAINTEXT is returned EXACTLY ONCE and never
 * persisted (only its SHA-256 hash). Scopes are stored on the token so the
 * auto-issued key inherits exactly what the admin granted; `maxUses`/`serialPattern`
 * turn a one-time token into a batch allowlist.
 */
export async function issueMachineEnrollmentToken(opts: {
  serialPattern?: string | null;
  scopes?: string[];
  maxUses?: number;
  ttlMinutes?: number;
  note?: string | null;
  issuedBy?: number | null;
}): Promise<{
  token: string;
  tokenPrefix: string;
  expiresAt: Date;
  serialPattern: string | null;
  scopes: string[];
  maxUses: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const ttl = opts.ttlMinutes && opts.ttlMinutes > 0 ? opts.ttlMinutes : machineEnrollmentTokenTtlMinutes();
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  const scopes = opts.scopes && opts.scopes.length > 0 ? opts.scopes : [...ENROLLMENT_DEFAULT_SCOPES];
  const maxUses = opts.maxUses && opts.maxUses > 0 ? Math.min(Math.trunc(opts.maxUses), 100_000) : 1;
  const serialPattern = opts.serialPattern?.trim() || null;
  const { plaintext, prefix } = generateEnrollmentToken();

  await db.insert(machineEnrollmentTokens).values({
    tokenHash: hashEnrollmentToken(plaintext),
    tokenPrefix: prefix,
    serialPattern,
    scopes,
    maxUses,
    expiresAt,
    note: opts.note?.trim() || null,
    issuedBy: opts.issuedBy ?? null,
  });

  return { token: plaintext, tokenPrefix: prefix, expiresAt, serialPattern, scopes, maxUses };
}

type MachineInfoForEnrollment = {
  name?: string;
  machineType?: string;
  model?: string;
  manufacturer?: string;
  firmwareVersion?: string;
  syncMode?: "online" | "offline";
};

/**
 * Redeem an enrollment token: validate + BURN one use atomically, then approve
 * (or create) the machine. Returns the machine + the scopes the caller should
 * mint an mk_ key with — the KEY itself is issued by the router
 * (machineAuthService.issueMachineKey) so both credential paths share one issuer.
 *
 * Ordering is deliberate for single-use vs. wasted-use balance:
 *   1. Validate machine STATE + station availability FIRST (own-handle reads) so
 *      a legitimate-but-locked machine, or a missing hierarchy, does NOT consume
 *      a token use.
 *   2. Validate + BURN the token in ONE transaction: the increment is guarded by
 *      `WHERE useCount < maxUses RETURNING`, so two concurrent redemptions of a
 *      one-time token cannot both win (true single-use).
 *   3. Approve / create the machine (single atomic statements each).
 *
 * A token IS consumed even if step 3 later fails (rare — only a DB fault, which
 * would also have failed the burn). The machine is left recoverable by an admin
 * (issueClaimToken / regenerateApiKey); the alternative — burning last — would
 * let an attacker replay a token, which is the exact risk this must prevent.
 *
 * Throws EnrollmentTokenError (router maps reason → status).
 */
export async function redeemMachineEnrollmentToken(opts: {
  serialNumber: string;
  enrollmentToken: string;
  machineInfo?: MachineInfoForEnrollment;
  fromIp?: string | null;
}): Promise<{ machineId: number; machineCode: string; scopes: string[]; created: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const serialNumber = opts.serialNumber.trim();

  // ── 1. Pre-burn state validation (so a bad machine state wastes no token use) ──
  const existing = await getMachineBySerialNumber(serialNumber); // ACTIVE rows only
  if (existing) {
    const lifecycle = (existing as { lifecycleStatus?: string | null }).lifecycleStatus;
    if (lifecycle === "retired" || lifecycle === "decommissioned") {
      throw new EnrollmentTokenError(
        `Machine '${existing.code}' is ${lifecycle} — an admin must re-commission it before it can enroll`,
        "machine_locked",
      );
    }
  }
  let station: Awaited<ReturnType<typeof getDefaultStation>> | undefined;
  let resolvedCode: string | undefined;
  if (!existing) {
    if (!opts.machineInfo?.machineType) {
      throw new EnrollmentTokenError(
        "Unknown machine — call register first, or provide machineInfo.machineType to enroll a new machine",
        "needs_info",
      );
    }
    station = await getDefaultStation();
    if (!station) {
      throw new EnrollmentTokenError(
        "No active station configured — create the factory hierarchy before enrolling machines",
        "no_station",
      );
    }
    // Resolve a non-colliding SN- code (same policy as machine.register).
    let code = `SN-${serialNumber}`;
    if (await getMachineByCode(code)) {
      let resolved: string | undefined;
      for (let i = 2; i <= 5 && !resolved; i++) {
        const candidate = `SN-${serialNumber}-${i}`;
        if (!(await getMachineByCode(candidate))) resolved = candidate;
      }
      if (!resolved) {
        throw new EnrollmentTokenError(
          `Machine code '${code}' (and suffixed variants) are already in use — an admin must intervene`,
          "machine_locked",
        );
      }
      code = resolved;
    }
    resolvedCode = code;
  }

  // ── 2. Validate + BURN the token atomically (single-use enforcement) ──────────
  const tokenHash = hashEnrollmentToken(opts.enrollmentToken);
  const invalid = () => new EnrollmentTokenError("Invalid or expired enrollment token", "invalid");

  const token = await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(machineEnrollmentTokens)
      .where(eq(machineEnrollmentTokens.tokenHash, tokenHash))
      .limit(1);

    if (!t) throw invalid();
    if (t.revokedAt) throw invalid(); // uniform — do not reveal revocation
    if (new Date(t.expiresAt).getTime() <= Date.now()) {
      throw new EnrollmentTokenError("Enrollment token has expired — ask an admin to issue a new one", "expired");
    }
    if (t.useCount >= t.maxUses) {
      throw new EnrollmentTokenError("Enrollment token has no remaining uses", "exhausted");
    }
    // Serial allowlist — uniform `invalid` so a token cannot be probed for its pattern.
    if (!serialMatchesEnrollmentPattern(serialNumber, t.serialPattern)) throw invalid();

    // Single-use: only claim if a use is STILL available. A concurrent redemption
    // that lost the race gets 0 rows and is rejected as exhausted.
    const burned = await tx
      .update(machineEnrollmentTokens)
      .set({
        useCount: sql`${machineEnrollmentTokens.useCount} + 1`,
        lastUsedAt: new Date(),
        lastUsedFromIp: opts.fromIp ?? null,
      })
      .where(and(eq(machineEnrollmentTokens.id, t.id), lt(machineEnrollmentTokens.useCount, t.maxUses)))
      .returning({ id: machineEnrollmentTokens.id });
    if (burned.length === 0) {
      throw new EnrollmentTokenError("Enrollment token has no remaining uses", "exhausted");
    }
    return t;
  });

  const scopes = Array.isArray(token.scopes) && token.scopes.length > 0
    ? (token.scopes as string[])
    : [...ENROLLMENT_DEFAULT_SCOPES];

  // ── 3. Approve or create the machine ─────────────────────────────────────────
  if (existing) {
    const info: Partial<InsertMachine> = {};
    if (opts.machineInfo?.name) info.name = opts.machineInfo.name;
    if (opts.machineInfo?.model !== undefined) info.model = opts.machineInfo.model;
    if (opts.machineInfo?.manufacturer !== undefined) info.manufacturer = opts.machineInfo.manufacturer;
    if (opts.machineInfo?.firmwareVersion !== undefined) info.firmwareVersion = opts.machineInfo.firmwareVersion;
    if (opts.machineInfo?.syncMode) info.syncMode = opts.machineInfo.syncMode;
    if (Object.keys(info).length > 0) await updateMachine(existing.id, info);
    // approveMachine flips registrationStatus→approved (+ commissioning→active).
    await approveMachine(existing.id, {});
    const fresh = await getMachineById(existing.id);
    return { machineId: existing.id, machineCode: fresh?.code ?? existing.code, scopes, created: false };
  }

  const info = opts.machineInfo!;
  const id = await createMachine({
    code: resolvedCode!,
    name: info.name?.trim() || `Machine ${serialNumber}`,
    machineType: info.machineType as InsertMachine["machineType"],
    model: info.model,
    manufacturer: info.manufacturer,
    firmwareVersion: info.firmwareVersion,
    serialNumber,
    syncMode: info.syncMode || "online",
    registrationStatus: "approved",
    lifecycleStatus: "active",
    stationId: station!.id,
  });
  return { machineId: id, machineCode: resolvedCode!, scopes, created: true };
}

/** Safe projection of an enrollment token — NEVER exposes the hash. */
function publicEnrollmentTokenRow(r: MachineEnrollmentToken) {
  return {
    id: r.id,
    tokenPrefix: r.tokenPrefix,
    serialPattern: r.serialPattern,
    scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
    maxUses: r.maxUses,
    useCount: r.useCount,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    lastUsedAt: r.lastUsedAt,
    note: r.note,
    issuedBy: r.issuedBy,
    createdAt: r.createdAt,
  };
}

export type PublicEnrollmentTokenRow = ReturnType<typeof publicEnrollmentTokenRow>;

/** List enrollment tokens (newest first) — SAFE shape only (no hash). */
export async function listMachineEnrollmentTokens(): Promise<PublicEnrollmentTokenRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(machineEnrollmentTokens)
    .orderBy(desc(machineEnrollmentTokens.createdAt));
  return rows.map(publicEnrollmentTokenRow);
}

/** Revoke an enrollment token: stamp revokedAt (redemption then denies it). */
export async function revokeMachineEnrollmentToken(id: number): Promise<PublicEnrollmentTokenRow> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(machineEnrollmentTokens)
    .set({ revokedAt: new Date() })
    .where(eq(machineEnrollmentTokens.id, id))
    .returning();
  if (!row) throw new Error(`Enrollment token ${id} not found`);
  return publicEnrollmentTokenRow(row);
}

/** Lifecycle states after which a machine must NOT be able to authenticate. */
export const MACHINE_LIFECYCLE_REVOKES_CREDENTIALS: readonly MachineLifecycleStatus[] = [
  "retired",
  "decommissioned",
];

/**
 * M3 soft-delete: the code column is kept INTACT as a tombstone (the partial
 * unique index uq_machines_code_active makes the code reusable by a new active
 * machine), and the asset is force-stamped 'retired' (M2 out-of-band stamp —
 * delete is terminal unless the row is explicitly restored).
 *
 * NOTE: this path does NOT revoke credentials, and does not need to —
 * machineAuthService rejects any machine whose `isActive` is false (step 1 of
 * its resolution order), which is exactly what a tombstone is.
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
 * Doc 51 P0 / R2 — CREDENTIAL REVOCATION IS PART OF THE TRANSITION. Moving to
 * 'retired'/'decommissioned' previously only stamped lifecycleStatus, while
 * machineAuthService gates on `machines.isActive` — so a retired machine kept
 * ingesting with a live key forever. The revoke now happens in the SAME
 * transaction as the state change: either the machine is retired AND cannot
 * authenticate, or neither.
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
  revoked?: MachineCredentialRevocation;
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

  const snapshot = { id: machine.id, code: machine.code, name: machine.name };
  const setState = { lifecycleStatus: to, updatedAt: new Date() };

  let revoked: MachineCredentialRevocation | undefined;
  if (MACHINE_LIFECYCLE_REVOKES_CREDENTIALS.includes(to)) {
    // Multi-statement → needs a transaction (state + every credential, atomically).
    revoked = await db.transaction(async (tx) => {
      await tx.update(machines).set(setState).where(eq(machines.id, id));
      return revokeMachineCredentialsTx(tx, id);
    });
  } else {
    // Single statement — atomic on its own; no transaction needed.
    await db.update(machines).set(setState).where(eq(machines.id, id));
  }

  return {
    before: { ...snapshot, lifecycleStatus: from },
    after: { ...snapshot, lifecycleStatus: to },
    revoked,
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
