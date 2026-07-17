/**
 * wipIngestService — P2 WIP write-path (audit C / doc 12 §5–6).
 *
 * PROBLEM IT SOLVES: the entire WIP/traceability layer (wip_tracking,
 * station_dwell_time, line_balance_metrics) previously had NO writer, so the MES
 * Control Tower / WIP / Traceability views were always empty shells. This
 * service is the missing writer: after an inspection result is persisted, it
 * populates those tables from the inspection so the dashboards show real data.
 *
 * SAFETY / NON-BLOCKING CONTRACT:
 *   - This is fire-and-forget. The caller invokes ingestInspectionToWip(...)
 *     WITHOUT awaiting (or with .catch). Every public entry wraps its whole body
 *     in try/catch and NEVER throws — a WIP-ingest failure must never fail or
 *     roll back the inspection insert.
 *   - It is pure telemetry/aggregation over already-persisted rows. It writes NO
 *     command to any machine (no commandDispatcher / driver.writeTags).
 *
 * HEURISTICS / ASSUMPTIONS (documented inline at each use):
 *   - "current station" = the machine's stationId; "line" = that station's
 *     lineId (machines are mapped to a station, stations to a line).
 *   - The matching ACTIVE production order is chosen by productModelId + lineId
 *     (status pending/in_progress), most-recently-created first. completedQuantity
 *     is incremented by 1 per inspected unit, clamped to targetQuantity (overflow
 *     guard) — mirrors the existing updateProductionOrderQuantities semantics.
 *   - A WIP unit is keyed by serialNumber (upsert). Its status is derived from the
 *     inspection result: OK -> in_process (still flowing), NG/scrap -> on_hold.
 *   - Dwell time is measured as the gap between the previous OPEN dwell row for the
 *     same serial+station and now; the previous row is closed (exitedAt set).
 *   - line_balance_metrics is bucketed per hour per line; throughput/wip counts are
 *     incremented and avg cycle time is updated from the inspection cycleTime.
 *   - Genealogy: when wip_tracking already has a parentSerialNumber for this
 *     serial it is preserved; component→serial genealogy continues to be owned by
 *     componentInstallationService (not duplicated here).
 */
import { getDb } from "../db/connection";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { publishToOutbox } from "./integration/outboxProducers"; // K0+-c: ADDITIVE ERP outbox (ERP_OUTBOX_ENABLED)
import { HELD_WIP_STATUS, dispatchExcludedStatuses } from "./wipHoldPolicy"; // W4-B: quality-hold enforcement
import {
  wipTracking,
  stationDwellTime,
  lineBalanceMetrics,
  productionOrders,
  stations,
} from "../../drizzle/schema";

export interface WipIngestInput {
  inspectionId: number;
  serialNumber: string | null;
  lotNumber?: string | null;
  overallResult: "OK" | "NG" | "NTF" | string;
  machineId: number;
  /** station the machine sits at; if omitted we resolve it from the machine row's station, then line */
  stationId?: number | null;
  productModelId?: number | null;
  productCode?: string | null;
  /**
   * Explicit production-order link from the inspection, if any. When set, the
   * submitInspection inline path already authoritatively bumps that order's
   * completedQuantity, so we SKIP the heuristic order match here to avoid
   * double-counting. Heuristic match runs only when this is null (e.g. AOI-ZIP).
   */
  productionOrderId?: number | null;
  /** inspection cycle time in seconds (as stored on product_inspections.cycleTime) */
  cycleTimeSec?: number | null;
  /** when the inspection happened (defaults to now) */
  at?: Date | null;
}

/** Hour bucket start for line_balance_metrics aggregation. */
function hourBucket(d: Date): Date {
  const b = new Date(d);
  b.setMinutes(0, 0, 0);
  return b;
}

/**
 * doc 51 CASE #2 — OUT-OF-ORDER GUARD.
 *
 * When a machine loses network then replays a burst of buffered inspections, the
 * events arrive out of chronological order (e.g. T3 then T1 then T2). The old
 * upsertWipUnit used a plain onConflictDoUpdate that is LAST-WRITE-WINS: the
 * LAST row processed (T2) overwrote currentStationId/status, so wip_tracking
 * ended up reflecting a STALE station instead of the newest event (T3). Likewise
 * recordDwell clamped `Math.max(0, at - enteredAt)` which silently hid the
 * negative gap of a late arrival.
 *
 * The guard makes the write MONOTONIC in the inspection time `at`: the current
 * station/machine/status is advanced ONLY when the incoming `at` is >= the time
 * of the row that currently holds the state. `enteredAt` is the ordering key —
 * it stores the inspection time of the event that set the current station, so a
 * late (older `at`) event can no longer regress the live state. In-order flow is
 * unaffected: `at` is always >= the stored enteredAt, so the guarded branch
 * advances exactly like the legacy path (only enteredAt now moves forward to the
 * true station-entry time, which is what dwell/aging readers actually want).
 *
 * FLAG: WIP_OUT_OF_ORDER_GUARD — DEFAULT ON. Last-write-wins on replay is a clear
 * data-integrity bug, and the guard is a no-op for in-order traffic, so it is on
 * by default. Set WIP_OUT_OF_ORDER_GUARD=false to restore the exact legacy
 * last-write-wins behaviour (enteredAt frozen at first-seen) if ever needed.
 */
export function isWipOutOfOrderGuardEnabled(): boolean {
  return process.env.WIP_OUT_OF_ORDER_GUARD !== "false";
}

/**
 * Resolve the lineId for a station id. Returns null when unknown so the rest of
 * the pipeline degrades gracefully (WIP row still written without a line).
 */
async function resolveLineId(database: any, stationId: number | null | undefined): Promise<number | null> {
  if (stationId == null) return null;
  try {
    const [row] = await database
      .select({ lineId: stations.lineId })
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);
    return row?.lineId ?? null;
  } catch {
    return null;
  }
}

/**
 * Main entry — fully guarded, never throws. Call WITHOUT await from ingest paths.
 */
export async function ingestInspectionToWip(input: WipIngestInput): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;

    const at = input.at ?? new Date();
    const result = (input.overallResult || "").toUpperCase();

    // HEURISTIC: station = machine.stationId (passed in by the caller, which
    // already has the machine row). If not provided, we skip station-scoped work
    // (dwell) but still do WIP + order + line-balance where possible.
    const stationId = input.stationId ?? null;
    const lineId = await resolveLineId(database, stationId);

    // (a) production order completedQuantity ------------------------------------
    // Skip when the inspection is already explicitly linked to an order: the
    // submitInspection inline path bumps that order authoritatively, so running
    // the heuristic match here too would double-count. Heuristic only for
    // inspections with no explicit order link (e.g. AOI-ZIP commits).
    if (input.productionOrderId == null) {
      await updateMatchingOrder(database, input, lineId, result).catch((e) =>
        console.error("[wipIngest] order update failed:", (e as any)?.message ?? e),
      );
    }

    // (b) WIP unit upsert -------------------------------------------------------
    if (input.serialNumber) {
      await upsertWipUnit(database, input, lineId, stationId, result, at).catch((e) =>
        console.error("[wipIngest] wip upsert failed:", (e as any)?.message ?? e),
      );
    }

    // (c) station dwell ---------------------------------------------------------
    if (stationId != null && input.serialNumber) {
      await recordDwell(database, input, lineId, stationId, at).catch((e) =>
        console.error("[wipIngest] dwell record failed:", (e as any)?.message ?? e),
      );
    }

    // (d) line balance metrics --------------------------------------------------
    if (lineId != null) {
      await updateLineBalance(database, lineId, stationId, input.cycleTimeSec ?? null, at).catch((e) =>
        console.error("[wipIngest] line balance failed:", (e as any)?.message ?? e),
      );
    }

    // (e) K0+-c: ADDITIVELY publish a production-event to the durable ERP outbox
    // (unit passed through a station). Fire-and-forget + error-isolated (this whole
    // function already never blocks the inspection insert); gated by
    // ERP_OUTBOX_ENABLED (no-op when off). Idempotent per serial+station+time.
    if (input.serialNumber) {
      publishToOutbox({
        eventType: "production-event",
        payload: {
          kind: "wip-station-pass",
          serialNumber: input.serialNumber,
          lotNumber: input.lotNumber ?? null,
          machineId: input.machineId,
          stationId,
          lineId,
          productModelId: input.productModelId ?? null,
          productCode: input.productCode ?? null,
          overallResult: result || null,
          cycleTimeSec: input.cycleTimeSec ?? null,
          timestamp: at.toISOString(),
        },
        idempotencyKey: `pe-${input.serialNumber}-${stationId ?? "na"}-${at.getTime()}`,
      });
    }
  } catch (e) {
    // Absolute last-resort guard — must never propagate to the inspection insert.
    console.error("[wipIngest] fatal (suppressed):", (e as any)?.message ?? e);
  }
}

/**
 * (a) Find the matching ACTIVE production order and bump completedQuantity (+OK/NG/NTF),
 * clamped to targetQuantity. Match = productModelId + lineId, status in
 * (pending,in_progress), newest first.
 */
async function updateMatchingOrder(
  database: any,
  input: WipIngestInput,
  lineId: number | null,
  result: string,
): Promise<void> {
  if (input.productModelId == null) return;

  const conds = [
    eq(productionOrders.productModelId, input.productModelId),
    inArray(productionOrders.status, ["pending", "in_progress"] as any),
  ];
  // Prefer a line-specific match when we know the line; otherwise any active
  // order for the product model.
  if (lineId != null) conds.push(eq(productionOrders.lineId, lineId));

  const [order] = await database
    .select()
    .from(productionOrders)
    .where(and(...conds))
    .orderBy(desc(productionOrders.createdAt))
    .limit(1);
  if (!order) return;

  // Overflow guard: never push completedQuantity past targetQuantity.
  if (order.completedQuantity >= order.targetQuantity) return;

  const updates: Record<string, any> = {
    completedQuantity: order.completedQuantity + 1,
    updatedAt: new Date(),
  };
  if (result === "OK") updates.okQuantity = order.okQuantity + 1;
  else if (result === "NG") updates.ngQuantity = order.ngQuantity + 1;
  else if (result === "NTF") updates.ntfQuantity = order.ntfQuantity + 1;

  if (updates.completedQuantity >= order.targetQuantity) {
    updates.status = "completed";
    updates.actualEndDate = new Date();
  } else if (order.status === "pending") {
    updates.status = "in_progress";
    updates.actualStartDate = new Date();
  }

  await database.update(productionOrders).set(updates).where(eq(productionOrders.id, order.id));
}

/**
 * (b) Upsert the WIP unit for this serial. Status derives from the result:
 *   OK  -> in_process (unit keeps flowing)
 *   NG  -> hold       (needs disposition)
 *   NTF -> hold
 *   else-> in_process
 * W4-B FIX: previously wrote 'on_hold', which is NOT a wipstatusenum value, so
 * the pgEnum rejected the insert and held serials were silently never recorded
 * (the whole ingest body is try/caught). We now write the CANONICAL enum value
 * 'hold' (HELD_WIP_STATUS) — no ALTER TYPE needed.
 * Genealogy: parentSerialNumber is preserved if already set (never overwritten
 * to null), so an upstream merge recorded elsewhere is not lost.
 */
async function upsertWipUnit(
  database: any,
  input: WipIngestInput,
  lineId: number | null,
  stationId: number | null,
  result: string,
  at: Date,
): Promise<void> {
  const status = result === "NG" ? HELD_WIP_STATUS : result === "NTF" ? HELD_WIP_STATUS : "in_process";

  const values = {
    serialNumber: input.serialNumber!,
    lotNumber: input.lotNumber ?? null,
    productId: input.productModelId ?? null,
    productCode: input.productCode ?? null,
    lineId: lineId ?? null,
    currentStationId: stationId ?? null,
    currentMachineId: input.machineId,
    status: status as any,
    quantity: 1,
    // The inspection time is the ordering key on conflict (see the guard below):
    // excluded."enteredAt" carries this value into the ON CONFLICT comparison.
    enteredAt: at,
    updatedAt: new Date(),
  };

  // GUARDED (doc 51 CASE #2, default ON): advance the live state (station /
  // machine / status / enteredAt) ONLY when the incoming inspection time `at`
  // (excluded."enteredAt") is >= the enteredAt of the row that currently holds
  // the state. A late-replayed (older) event therefore keeps its metadata
  // enrichment (lot/product coalesced in) but CANNOT regress the current station
  // or status. Equal timestamps advance (last-write-wins on a genuine tie — a
  // documented limitation). When the flag is OFF we fall back to the exact
  // legacy last-write-wins set (enteredAt frozen).
  if (isWipOutOfOrderGuardEnabled()) {
    // Incoming `at` is newer-or-equal than the stored state's enteredAt.
    const isNewer = sql`excluded."enteredAt" >= ${wipTracking.enteredAt}`;
    await database
      .insert(wipTracking)
      .values(values)
      .onConflictDoUpdate({
        target: wipTracking.serialNumber,
        targetWhere: sql`${wipTracking.serialNumber} IS NOT NULL`,
        set: {
          // Metadata: safe to backfill on ANY arrival (identity of a serial is
          // immutable); coalesce so we never null-out an existing value.
          lotNumber: input.lotNumber ?? sql`${wipTracking.lotNumber}`,
          productId: input.productModelId ?? sql`${wipTracking.productId}`,
          productCode: input.productCode ?? sql`${wipTracking.productCode}`,
          // Live-state fields: advance only on a newer-or-equal event.
          lineId: sql`CASE WHEN ${isNewer} THEN COALESCE(excluded."lineId", ${wipTracking.lineId}) ELSE ${wipTracking.lineId} END`,
          currentStationId: sql`CASE WHEN ${isNewer} THEN COALESCE(excluded."currentStationId", ${wipTracking.currentStationId}) ELSE ${wipTracking.currentStationId} END`,
          currentMachineId: sql`CASE WHEN ${isNewer} THEN excluded."currentMachineId" ELSE ${wipTracking.currentMachineId} END`,
          status: sql`CASE WHEN ${isNewer} THEN excluded."status" ELSE ${wipTracking.status} END`,
          // Ordering key advances with the state so multi-station in-order flow
          // and future replays compare against the CURRENT station's time.
          enteredAt: sql`CASE WHEN ${isNewer} THEN excluded."enteredAt" ELSE ${wipTracking.enteredAt} END`,
          updatedAt: new Date(),
        },
      });
    return;
  }

  // LEGACY (WIP_OUT_OF_ORDER_GUARD=false): byte-identical to the pre-guard path.
  await database
    .insert(wipTracking)
    .values(values)
    .onConflictDoUpdate({
      target: wipTracking.serialNumber,
      // Partial unique index (uq_wip_serial WHERE serialNumber IS NOT NULL) —
      // the matching predicate must be supplied so PG selects that index.
      targetWhere: sql`${wipTracking.serialNumber} IS NOT NULL`,
      set: {
        lotNumber: input.lotNumber ?? sql`${wipTracking.lotNumber}`,
        productId: input.productModelId ?? sql`${wipTracking.productId}`,
        productCode: input.productCode ?? sql`${wipTracking.productCode}`,
        lineId: lineId ?? sql`${wipTracking.lineId}`,
        currentStationId: stationId ?? sql`${wipTracking.currentStationId}`,
        currentMachineId: input.machineId,
        status: status as any,
        updatedAt: new Date(),
      },
    });
}

/**
 * (c) Record station dwell. Closes the previous OPEN dwell row for this
 * serial+station (sets exitedAt + dwellMs), then opens a new one. dwellMs of the
 * just-closed row = now - its enteredAt.
 */
async function recordDwell(
  database: any,
  input: WipIngestInput,
  lineId: number | null,
  stationId: number,
  at: Date,
): Promise<void> {
  // Close the most recent open dwell row for this serial at this station.
  const [open] = await database
    .select()
    .from(stationDwellTime)
    .where(
      and(
        eq(stationDwellTime.stationId, stationId),
        eq(stationDwellTime.serialNumber, input.serialNumber!),
        isNull(stationDwellTime.exitedAt),
      ),
    )
    .orderBy(desc(stationDwellTime.enteredAt))
    .limit(1);

  // doc 51 CASE #2 — dwell out-of-order guard. A late-replayed inspection whose
  // `at` predates the currently-open dwell row would compute a NEGATIVE gap that
  // Math.max(0,…) silently clamps to 0, corrupting the dwell record and opening a
  // backwards-dated leg. When the guard is ON we skip the dwell mutation for such
  // an arrival (the live WIP state is already handled monotonically in
  // upsertWipUnit); the open row is left intact for the correct in-order close.
  if (open && isWipOutOfOrderGuardEnabled() && at.getTime() < new Date(open.enteredAt).getTime()) {
    return;
  }

  if (open) {
    const dwellMs = Math.max(0, at.getTime() - new Date(open.enteredAt).getTime());
    // processingMs heuristic: cap processing at the inspection cycle time (if
    // known); any remainder of dwell beyond processing is treated as waiting.
    const cycleMs = input.cycleTimeSec != null ? Math.round(input.cycleTimeSec * 1000) : 0;
    const processingMs = cycleMs > 0 ? Math.min(cycleMs, dwellMs) : dwellMs;
    await database
      .update(stationDwellTime)
      .set({ exitedAt: at, dwellMs, processingMs })
      .where(eq(stationDwellTime.id, open.id));
  }

  // Open a fresh dwell row at this station for the next leg.
  await database.insert(stationDwellTime).values({
    lineId: lineId ?? null,
    stationId,
    machineId: input.machineId,
    serialNumber: input.serialNumber!,
    lotNumber: input.lotNumber ?? null,
    dwellMs: 0,
    processingMs: 0,
    starvedMs: 0,
    blockedMs: 0,
    enteredAt: at,
  });
}

/**
 * (d) Upsert the per-hour line_balance_metrics bucket for this line: increment
 * throughputUnits, refresh wipCount, and roll a simple running avg cycle time.
 */
async function updateLineBalance(
  database: any,
  lineId: number,
  stationId: number | null,
  cycleTimeSec: number | null,
  at: Date,
): Promise<void> {
  const periodStart = hourBucket(at);
  const periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000);
  const cycleMs = cycleTimeSec != null ? Math.round(cycleTimeSec * 1000) : null;

  // Live WIP count for the line (active units). W4-B: when WIP_HOLD_ENFORCED is
  // ON, held units drop out of the "live WIP" count too (they are parked for
  // disposition, not flowing); default OFF preserves the prior count.
  const [{ c: wipCount } = { c: 0 }] = await database
    .select({ c: sql<number>`count(*)::int` })
    .from(wipTracking)
    .where(and(eq(wipTracking.lineId, lineId), notInArray(wipTracking.status, dispatchExcludedStatuses() as any)));

  const [existing] = await database
    .select()
    .from(lineBalanceMetrics)
    .where(and(eq(lineBalanceMetrics.lineId, lineId), eq(lineBalanceMetrics.periodStart, periodStart)))
    .limit(1);

  if (existing) {
    const newThroughput = existing.throughputUnits + 1;
    // Running average over throughput (weight by count) for avgCycleTimeMs.
    let avgCycle = existing.avgCycleTimeMs;
    let maxCycle = existing.maxCycleTimeMs;
    // doc 54 P2.1 — 'bottleneck' của line phải là trạm CHẬM NHẤT (cycle lớn nhất) trong kỳ,
    // KHÔNG phải trạm VỪA báo cáo. Cũ: bottleneckStationId = stationId (trạm cuối ingest) →
    // nhãn nút-thắt nhảy loạn theo đơn vị cuối cùng đi qua, gây hiểu sai phân tích line-balance.
    // Nay: chỉ gán lại khi trạm này vừa lập MAX cycle mới (thực sự là điểm nghẽn nhất tới giờ).
    let bottleneck = existing.bottleneckStationId;
    if (cycleMs != null) {
      const prevAvg = existing.avgCycleTimeMs ?? cycleMs;
      avgCycle = Math.round((prevAvg * existing.throughputUnits + cycleMs) / newThroughput);
      maxCycle = Math.max(existing.maxCycleTimeMs ?? 0, cycleMs);
      if (cycleMs > (existing.maxCycleTimeMs ?? 0) && stationId != null) {
        bottleneck = stationId;
      }
    }
    await database
      .update(lineBalanceMetrics)
      .set({
        throughputUnits: newThroughput,
        wipCount: Number(wipCount) || 0,
        avgCycleTimeMs: avgCycle,
        maxCycleTimeMs: maxCycle,
        bottleneckStationId: bottleneck,
      })
      .where(eq(lineBalanceMetrics.id, existing.id));
  } else {
    await database.insert(lineBalanceMetrics).values({
      lineId,
      periodStart,
      periodEnd,
      avgCycleTimeMs: cycleMs,
      maxCycleTimeMs: cycleMs,
      bottleneckStationId: stationId ?? null,
      throughputUnits: 1,
      wipCount: Number(wipCount) || 0,
    });
  }
}
