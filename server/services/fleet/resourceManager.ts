/**
 * Khối 2 (doc 16 §7 part d / §15 G2) — Shared resource registry.
 * Flag: FLEET_RESOURCE_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * claim / release / availability over `shared_resources` + `resource_reservations`,
 * MIRRORING the trafficManager's reservation discipline (so the whole of Khối 2 uses
 * one consistent claim model):
 *
 *   • claimResource()  — a shared resource has capacity 1 (a jig/gripper is held by
 *                        ONE device at a time). If free → grant ACTIVE + set the
 *                        resource's cached status='in_use' + currentOwnerDeviceId. If
 *                        held → QUEUE (default, backpressure) or REJECT per
 *                        `queueIfFull`. An existing ACTIVE claim by the SAME device is
 *                        returned idempotently (re-claim is a no-op, not a 2nd row).
 *   • releaseResource()— release a device's claim(s); the oldest QUEUED waiter is then
 *                        PROMOTED to active (FIFO) and becomes the new owner; if no
 *                        waiter, the resource returns to 'available'.
 *   • getResourceAvailability() — DERIVED from active reservations (authoritative),
 *                        not just the cached status flag.
 *
 * INTEGRATION SEAM (advisory in G2, documented — does NOT block G1): a task that needs
 * a shared resource (operation_codes.toolType) SHOULD claimResource() before dispatch
 * and releaseResource() after. The allocator does NOT enforce this in G2 (flag-gated,
 * additive); a later phase can make holding the resource a hard pre-dispatch gate.
 *
 * SAFETY: pure orchestration STATE — no device control. With the flag off every
 * mutating entry point is a no-op (enabled:false).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { sharedResources, resourceReservations } from "../../../drizzle/schema/fleetResource";
import { fleetResourceEnabled } from "./skillRegistry";

export interface ClaimInput {
  resourceId: number;
  deviceId: number;
  deviceKind?: string;
  taskId?: number | null;
  reservedUntil?: Date | null;
  /** When the resource is in use: queue (default) or reject. */
  queueIfFull?: boolean;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface ClaimResult {
  ok: boolean;
  enabled: boolean;
  status: "active" | "queued" | "rejected";
  reservationId?: number;
  message?: string;
}

/** Count of ACTIVE reservations on a resource (derived "in use" — capacity is 1). */
export async function getResourceActiveCount(resourceId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const active = await db
    .select()
    .from(resourceReservations)
    .where(and(eq(resourceReservations.resourceId, resourceId), eq(resourceReservations.status, "active")));
  return active.length;
}

export interface AvailabilityRow {
  resourceId: number;
  code: string;
  type: string;
  status: string; // cached hint
  available: boolean; // DERIVED (no active reservation)
  currentOwnerDeviceId: number | null;
  activeCount: number;
  queuedCount: number;
}

/** DERIVED availability for one resource (authoritative over the cached status). */
export async function getResourceAvailability(resourceId: number): Promise<AvailabilityRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [res] = await db.select().from(sharedResources).where(eq(sharedResources.id, resourceId)).limit(1);
  if (!res) return null;
  const reservations = await db.select().from(resourceReservations).where(eq(resourceReservations.resourceId, resourceId));
  const activeCount = reservations.filter((r) => r.status === "active").length;
  const queuedCount = reservations.filter((r) => r.status === "queued").length;
  return {
    resourceId: res.id,
    code: res.code,
    type: res.type,
    status: res.status,
    available: activeCount === 0,
    currentOwnerDeviceId: res.currentOwnerDeviceId ?? null,
    activeCount,
    queuedCount,
  };
}

function baseRes(input: ClaimInput) {
  return {
    resourceId: input.resourceId,
    deviceId: input.deviceId,
    deviceKind: input.deviceKind ?? "robot",
    taskId: input.taskId ?? null,
    reservedUntil: input.reservedUntil ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
  };
}

/**
 * Claim a shared resource for a device (capacity 1). Enforces single-owner; queues or
 * rejects on conflict. Idempotent re-claim by the same holder.
 */
export async function claimResource(input: ClaimInput): Promise<ClaimResult> {
  if (!fleetResourceEnabled()) return { ok: false, enabled: false, status: "rejected", message: "FLEET_RESOURCE_ENABLED off" };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, status: "rejected", message: "db unavailable" };

  // ATOMIC (P0 — closes the TOCTOU double-claim race): serialize all claimers of THIS
  // resource on the resource row (SELECT … FOR UPDATE) inside one transaction, so the
  // single-owner check + insert cannot interleave with a concurrent claimer.
  return db.transaction(async (tx) => {
    const [res] = await tx.select().from(sharedResources).where(eq(sharedResources.id, input.resourceId)).for("update");
    if (!res) return { ok: false, enabled: true, status: "rejected", message: `resource ${input.resourceId} not found` };

    // Idempotent re-claim: this device already holds an active claim.
    const [existing] = await tx
      .select()
      .from(resourceReservations)
      .where(
        and(
          eq(resourceReservations.resourceId, input.resourceId),
          eq(resourceReservations.deviceId, input.deviceId),
          eq(resourceReservations.status, "active"),
        ),
      )
      .limit(1);
    if (existing) return { ok: true, enabled: true, status: "active", reservationId: existing.id };

    const activeRows = await tx
      .select()
      .from(resourceReservations)
      .where(and(eq(resourceReservations.resourceId, input.resourceId), eq(resourceReservations.status, "active")));
    const activeCount = activeRows.length;
    const queueIfFull = input.queueIfFull ?? true;

    if (activeCount >= 1) {
      // In use by another device.
      if (!queueIfFull) {
        const [row] = await tx.insert(resourceReservations).values({ ...baseRes(input), status: "rejected" }).returning({ id: resourceReservations.id });
        return { ok: false, enabled: true, status: "rejected", reservationId: row?.id, message: "resource in use" };
      }
      const [row] = await tx.insert(resourceReservations).values({ ...baseRes(input), status: "queued" }).returning({ id: resourceReservations.id });
      console.log(`[Fleet] resource ${input.resourceId} in use → device ${input.deviceId} QUEUED`);
      return { ok: true, enabled: true, status: "queued", reservationId: row?.id };
    }

    // Free — grant + mark owner.
    const [row] = await tx.insert(resourceReservations).values({ ...baseRes(input), status: "active" }).returning({ id: resourceReservations.id });
    await tx
      .update(sharedResources)
      .set({ status: "in_use", currentOwnerDeviceId: input.deviceId, updatedAt: new Date() })
      .where(eq(sharedResources.id, input.resourceId));
    return { ok: true, enabled: true, status: "active", reservationId: row?.id };
  });
}

export interface ReleaseResult {
  ok: boolean;
  enabled: boolean;
  released: number;
  promoted: number;
}

/**
 * Release a device's claim(s) on a resource (or all of the device's resource claims
 * when `resourceId` omitted — use on device-offline). After freeing an ACTIVE claim,
 * promote the oldest QUEUED waiter (FIFO) to active and make it the new owner; if no
 * waiter, the resource returns to 'available'.
 */
export async function releaseResource(deviceId: number, resourceId?: number): Promise<ReleaseResult> {
  if (!fleetResourceEnabled()) return { ok: false, enabled: false, released: 0, promoted: 0 };
  const db = await getDb();
  if (!db) return { ok: false, enabled: true, released: 0, promoted: 0 };

  const held = await db
    .select()
    .from(resourceReservations)
    .where(
      and(
        eq(resourceReservations.deviceId, deviceId),
        inArray(resourceReservations.status, ["active", "queued"]),
        ...(resourceId != null ? [eq(resourceReservations.resourceId, resourceId)] : []),
      ),
    );
  if (held.length === 0) return { ok: true, enabled: true, released: 0, promoted: 0 };

  // Snapshot the resources whose ACTIVE claim we are about to free BEFORE the update
  // (the update mutates the held rows' status, so read it first).
  const freedResources = [...new Set(held.filter((h) => h.status === "active").map((h) => h.resourceId))];

  const now = new Date();
  await db
    .update(resourceReservations)
    .set({ status: "released", releasedAt: now })
    .where(inArray(resourceReservations.id, held.map((h) => h.id)));

  // For each resource whose ACTIVE claim we just freed, promote the oldest waiter.
  let promoted = 0;
  for (const rid of freedResources) {
    const [next] = await db
      .select()
      .from(resourceReservations)
      .where(and(eq(resourceReservations.resourceId, rid), eq(resourceReservations.status, "queued")))
      .orderBy(resourceReservations.createdAt)
      .limit(1);
    if (next) {
      await db.update(resourceReservations).set({ status: "active" }).where(eq(resourceReservations.id, next.id));
      await db
        .update(sharedResources)
        .set({ status: "in_use", currentOwnerDeviceId: next.deviceId, updatedAt: now })
        .where(eq(sharedResources.id, rid));
      promoted++;
    } else {
      await db
        .update(sharedResources)
        .set({ status: "available", currentOwnerDeviceId: null, updatedAt: now })
        .where(eq(sharedResources.id, rid));
    }
  }
  console.log(`[Fleet] device ${deviceId} released ${held.length} resource claim(s), promoted ${promoted} waiter(s)`);
  return { ok: true, enabled: true, released: held.length, promoted };
}
