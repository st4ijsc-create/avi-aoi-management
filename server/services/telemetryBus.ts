/**
 * P2 (doc 12 §3/§4) — UNIFIED TELEMETRY BUS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE ingest path for EVERY device protocol. Every reader (OT drivers via the OT
 * manager, MTConnect poller, SECS/GEM SV poll, Sparkplug, the inspection
 * pipeline, …) normalizes its reading into a `CanonicalSample` and calls
 * `ingestTelemetry(samples)`. The bus then:
 *   1. normalizes each CanonicalSample → a canonical `ot_telemetry` row
 *      (numeric → numValue, bool → boolValue, string/json → textValue),
 *   2. resolves the soft machineId (uses an explicit one, else maps deviceId →
 *      machines.code, cached) so not-yet-mapped devices still ingest (machineId null),
 *   3. bulk-inserts into the ONE canonical store `ot_telemetry`,
 *   4. broadcasts the batch on the ONE socket channel `telemetry:sample`
 *      (global room + per-machine room) via socket.emitTelemetrySamples.
 *
 * HONESTY / NO-FAKE-DATA: the bus has NO timer and produces NO data of its own.
 * It only ever forwards samples a real reader handed it. When no device is
 * connected, no reader calls in → nothing is inserted or broadcast. DB-absent and
 * socket-absent are both safe no-ops (tests / headless). Inserts are wrapped so a
 * persistence error never propagates into a protocol reader's poll loop.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { InsertOtTelemetry, OtTelemetry } from "../../drizzle/schema";
import { createBusFanout } from "../_core/busFanout";
// G2.6 (doc 44 W2-B2) — contract validation before enqueue/persist. Gated by
// CONTRACT_VALIDATE_INGEST_MODE (default "off" → filterTelemetrySamples returns the same
// array reference immediately; zero added cost). No cycle: ingestValidation never imports
// this module at runtime.
import { filterTelemetrySamples } from "./contracts/ingestValidation";

/** The canonical telemetry protocol set (mirrors telemetryProtocolEnum). */
export type TelemetryProtocol = NonNullable<OtTelemetry["protocol"]>;

/** The canonical quality flag set (mirrors telemetryQualityEnum). */
export type TelemetryQuality = NonNullable<OtTelemetry["quality"]>;

/**
 * Protocol-agnostic input to the bus. ONE reading from any reader. `value` is the
 * raw JS primitive; the bus splits it into numValue/textValue/boolValue. Provide
 * `machineId` when the reader already knows it (OT adapters, MTConnect/SECS sinks);
 * otherwise provide `deviceId` and the bus resolves machineId by machines.code.
 */
export interface CanonicalSample {
  /** Event/source time. Defaults to now() when omitted. */
  ts?: Date;
  /** Soft machine ref if already known (preferred — skips resolution). */
  machineId?: number | null;
  /** External device identifier; also used to resolve machineId when machineId absent. */
  deviceId?: string | null;
  protocol: TelemetryProtocol;
  /** Normalized tag/metric name (e.g. "temperature", "spindle_speed"). */
  metric: string;
  /** Raw value; split into the typed columns by the bus. */
  value: number | string | boolean | null;
  unit?: string | null;
  quality?: TelemetryQuality;
  /** Raw payload / extra fields that don't map to a typed column. */
  meta?: Record<string, unknown> | null;
}

const MAX_TEXT = 1000;

// ── In-process telemetry TAP (T1-c twin streaming gateway) ───────────────────
// A tap is a side-channel listener invoked with each ingested batch AFTER the
// canonical insert + the existing `telemetry:sample` broadcast. It does NOT change
// the single ingest/broadcast path — it only lets an opt-in consumer (the twin
// streaming gateway) observe samples without polling and without a second bus.
// No taps registered → zero overhead. Tap errors are isolated (never affect ingest).
export type TelemetryTap = (rows: InsertOtTelemetry[]) => void;
const taps = new Set<TelemetryTap>();

/** Register a telemetry tap. Returns an unsubscribe fn. */
export function registerTelemetryTap(tap: TelemetryTap): () => void {
  taps.add(tap);
  return () => { taps.delete(tap); };
}

/**
 * Pure: normalize ONE CanonicalSample → a canonical ot_telemetry insert row.
 * Exactly one of numValue/textValue/boolValue is set (or none for a null value).
 * No I/O — unit-testable. `machineId` is taken as-already-resolved.
 */
export function toCanonicalRow(s: CanonicalSample, machineId: number | null): InsertOtTelemetry {
  const row: InsertOtTelemetry = {
    ts: s.ts ?? new Date(),
    machineId: machineId ?? undefined,
    deviceId: s.deviceId ?? undefined,
    protocol: s.protocol,
    metric: s.metric.slice(0, 256),
    numValue: null,
    textValue: null,
    boolValue: null,
    unit: s.unit ?? undefined,
    quality: s.quality ?? "good",
    meta: s.meta ?? undefined,
  };

  const v = s.value;
  if (typeof v === "number" && Number.isFinite(v)) {
    row.numValue = v;
  } else if (typeof v === "boolean") {
    row.boolValue = v;
  } else if (typeof v === "string") {
    row.textValue = v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : v;
  } else if (v != null) {
    const j = JSON.stringify(v);
    row.textValue = j.length > MAX_TEXT ? j.slice(0, MAX_TEXT) : j;
  }
  return row;
}

// deviceId → machineId resolution cache.
// MON-F11: entry NEGATIVE (chưa map được, value=null) phải có TTL, nếu không map
// máy sau khi telemetry đã chảy sẽ mãi NULL tới lần restart. Entry POSITIVE
// (đã resolve ra id) cache vĩnh viễn (expires=Infinity) như hành vi trước đây.
const NEG_CACHE_TTL_MS = 60_000; // 60s cho negative entry
const machineIdCache = new Map<string, { value: number | null; expires: number }>();

/** Clear the deviceId→machineId cache (tests / after master-data edits). */
export function clearMachineIdCache(): void {
  machineIdCache.clear();
}

/** Resolve a deviceId to a platform machineId via machines.code (cached). */
async function resolveMachineId(deviceId: string | null | undefined): Promise<number | null> {
  if (!deviceId) return null;
  const cached = machineIdCache.get(deviceId);
  if (cached && (cached.value !== null || cached.expires > Date.now())) {
    return cached.value; // positive: dùng luôn; negative: dùng khi chưa hết TTL
  }
  let resolved: number | null = null;
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (db) {
      const { machines } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ id: machines.id })
        .from(machines)
        .where(eq(machines.code, deviceId))
        .limit(1);
      resolved = rows.length > 0 ? rows[0].id : null;
    }
  } catch {
    resolved = null; // resolution failure → ingest as unmapped (machineId null)
  }
  machineIdCache.set(deviceId, {
    value: resolved,
    expires: resolved === null ? Date.now() + NEG_CACHE_TTL_MS : Infinity,
  });
  return resolved;
}

// ── U6-b (G-10) — optional cross-instance fan-out for telemetry ──────────────
// Default OFF → pure in-process (mirrors eventBus). When EVENTBUS_REDIS_ENABLED
// + REDIS_URL are set, each locally-INGESTED batch is published to remote
// instances, and a batch from a REMOTE instance is RE-BROADCAST on this
// instance's socket + fed to local taps (so this instance's clients/twin see
// samples ingested elsewhere). It is NOT re-persisted (the origin instance
// already inserted it) and NOT re-fanned-out (loopback-safe). The wire payload is
// the already-normalized broadcast row array (JSON-safe, ISO ts).
type BroadcastRow = ReturnType<typeof toBroadcast>;
const telemetryFanout = createBusFanout("telemetry");
telemetryFanout.onRemote((payload) => {
  const rows = payload as BroadcastRow[];
  if (!Array.isArray(rows) || rows.length === 0) return;
  // Re-broadcast remote samples locally (no DB write, no re-fan-out).
  void broadcastAndTap(rows, /* remote */ true);
});

/** True when Redis cross-instance telemetry fan-out is actually active. */
export function isTelemetryFanoutActive(): boolean {
  return telemetryFanout.active;
}

/** Tear down the telemetry fan-out adapter (tests / graceful shutdown). */
export async function closeTelemetryFanout(): Promise<void> {
  await telemetryFanout.close();
}

/**
 * Broadcast a batch on the ONE unified socket channel + fire in-process taps.
 * Shared by the local ingest path and the remote-inject path. When `remote` is
 * false (local ingest) the batch is ALSO published to remote instances. When
 * `remote` is true (a batch received FROM Redis) it is NOT re-published
 * (loopback-safe) and the tap payload is the already-broadcast shape.
 */
async function broadcastAndTap(rows: BroadcastRow[], remote: boolean): Promise<void> {
  // Broadcast on the ONE unified channel (signal-only; no-op without io).
  try {
    const { emitTelemetrySamples } = await import("../_core/socket");
    emitTelemetrySamples(rows);
  } catch (err) {
    console.error("[TelemetryBus] broadcast failed:", (err as Error)?.message || err);
  }
  // Fan out to remote instances ONLY for locally-ingested batches (not echoes).
  if (!remote) telemetryFanout.publish(rows);
}

/** Convert a persisted/insert row to the socket broadcast shape (ts → ISO). */
function toBroadcast(row: InsertOtTelemetry) {
  const ts = row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts as any).toISOString();
  return {
    machineId: row.machineId ?? null,
    deviceId: row.deviceId ?? null,
    protocol: String(row.protocol),
    metric: row.metric,
    numValue: row.numValue ?? null,
    textValue: row.textValue ?? null,
    boolValue: row.boolValue ?? null,
    unit: row.unit ?? null,
    quality: String(row.quality ?? "good"),
    ts,
  };
}

/**
 * Bulk-persist canonical rows. PRIMARY path = the dedicated TimescaleDB hypertable
 * (mirrors energy_readings). When TSDB is disabled/degraded the helper returns null
 * and we FALL BACK to the main-DB ot_telemetry table (the plain table from 0132).
 * DB-absent on both paths → persist NOTHING (returns 0). This is the SINGLE write
 * function shared by the live ingest path AND the C1 store-and-forward backfill so
 * both persist identically. Throws on a real DB error so the caller can decide to
 * buffer (store-and-forward) vs swallow (live path). Returns rows persisted.
 */
async function persistRows(rows: InsertOtTelemetry[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { insertOtTelemetryRows } = await import("../db/timescale");
  const tsdbPersisted = await insertOtTelemetryRows(rows);
  if (tsdbPersisted !== null) {
    return tsdbPersisted; // TSDB handled it (count, possibly 0 if it degraded mid-batch).
  }
  // TSDB disabled/degraded → main-DB fallback.
  const { getDb } = await import("../db/connection");
  const db = await getDb();
  if (db) {
    const { otTelemetry } = await import("../../drizzle/schema");
    // G2.9 (doc 44 W0-D) — idempotent replay: rows violating the natural key
    // uq_ot_telemetry_device_metric_ts ("deviceId", metric, ts — migration 0247)
    // are silently SKIPPED instead of duplicated or failing the whole batch
    // (store-forward backfill / reader retry re-sends the same samples). Before
    // 0247 is applied ON CONFLICT DO NOTHING is a harmless no-op. The returned
    // count stays rows.length ("persisted or already present") ON PURPOSE: an
    // all-duplicate replayed batch must count as success so store-and-forward
    // does NOT re-buffer it (that would loop the replay forever).
    await db.insert(otTelemetry).values(rows).onConflictDoNothing();
    return rows.length;
  }
  return 0; // DB absent on both paths → nothing persisted.
}

/**
 * C1 — wire the store-and-forward backfill to the SAME persistRows path. The insert fn
 * the buffer replays through is exactly the live write, so a backfilled row lands
 * identically to a live one. setInsertFn is an idempotent assignment (cheap), so we
 * (re)wire on each engaged ingest rather than latching — this keeps the wiring correct
 * even after a store-forward reset (tests / maintenance) with no stale-latch hazard.
 */
async function ensureStoreForwardWired(): Promise<typeof import("./ot/storeForward")> {
  const sf = await import("./ot/storeForward");
  sf.setInsertFn((rows) => persistRows(rows));
  return sf;
}

/**
 * OT-F10 (doc 40 §11) — expose the store-forward wiring so an INDEPENDENT drain timer
 * (backgroundJobs) can replay the buffer through the SAME persist path even when no live
 * ingest is happening (DB recovered during a quiet period). Without this the injected
 * insert fn stays the default (throws) until the next ingest, so a WAL restored on boot
 * could never drain on its own. Idempotent (setInsertFn is a cheap re-assignment).
 */
export async function wireStoreForward(): Promise<void> {
  await ensureStoreForwardWired();
}

// ── R-2a (doc 38 P0-D) — WRITE-COALESCING RING BUFFER ───────────────────────
// Optional in-memory ring buffer that coalesces samples from EVERY reader (all OT
// adapters, MTConnect, SECS, robots…) into ONE multi-row insert per flush window,
// eliminating the historical 1-INSERT-per-tag-per-poll write amplification at the
// bus level (on top of the per-tick coalescing done by ingest.ingestSamples).
//
// FLAG: TELEMETRY_BATCH_ENABLED (default OFF). Rationale for default-OFF:
//   • When OFF the ingest path is byte-for-byte the prior synchronous behaviour —
//     every batch persists + broadcasts immediately, no in-memory window, so the
//     "never lose a sample" invariant holds trivially (nothing is ever buffered).
//   • When ON a small (<= TELEMETRY_FLUSH_MS, default 250ms) in-memory window is
//     introduced. It is drained on: the flush timer, a size threshold
//     (TELEMETRY_MAX_BATCH, default 500 → backpressure via an awaited flush), and
//     `beforeExit`. A HARD crash (SIGKILL/power-loss) can still lose at most one
//     window — inherent to any in-memory buffer — so callers wanting zero-loss
//     across SIGTERM should invoke flushTelemetryBuffer() from their shutdown hook
//     (exported below) or keep the flag OFF. Store-and-forward is UNCHANGED and
//     still protects against DB-down (it runs inside ingestNow per flushed batch).
function batchEnabled(): boolean {
  return process.env.TELEMETRY_BATCH_ENABLED === "true";
}
function intEnv(name: string, def: number, min = 1): number {
  const n = parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(n) && n >= min ? n : def;
}
function flushMs(): number {
  return intEnv("TELEMETRY_FLUSH_MS", 250);
}
function maxBatch(): number {
  return intEnv("TELEMETRY_MAX_BATCH", 500);
}

let telemetryBuffer: CanonicalSample[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownFlushWired = false;

function scheduleFlush(): void {
  if (flushTimer) return;
  const t = setTimeout(() => {
    flushTimer = null;
    void flushTelemetryBuffer();
  }, flushMs());
  if (typeof (t as { unref?: () => void }).unref === "function") {
    (t as { unref: () => void }).unref();
  }
  flushTimer = t;
}

/**
 * Register a best-effort `beforeExit` flush so a graceful drain of the event loop
 * flushes any buffered samples. NOTE: we deliberately DO NOT add SIGTERM/SIGINT
 * listeners here — adding a signal listener overrides Node's default terminate
 * behaviour and could HANG the process on Ctrl-C. Operators wanting a guaranteed
 * SIGTERM flush should call flushTelemetryBuffer() from their existing shutdown
 * hook. Registered lazily (only once batching is actually engaged) so the default
 * (flag-OFF) path adds no process listeners at all.
 */
function ensureShutdownFlush(): void {
  if (shutdownFlushWired) return;
  shutdownFlushWired = true;
  try {
    process.on("beforeExit", () => {
      void flushTelemetryBuffer();
    });
  } catch {
    // no process (unlikely) → best-effort only
  }
}

/** Number of samples currently buffered (for tests / metrics). */
export function bufferedTelemetryCount(): number {
  return telemetryBuffer.length;
}

/**
 * Flush the coalescing buffer NOW as ONE multi-row insert (via ingestNow, which
 * owns persist + store-forward + broadcast + taps). Idempotent, never throws.
 * Exported so a shutdown hook can guarantee no buffered sample is lost on SIGTERM.
 */
export async function flushTelemetryBuffer(): Promise<number> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (telemetryBuffer.length === 0) return 0;
  const batch = telemetryBuffer;
  telemetryBuffer = [];
  try {
    return await ingestNow(batch);
  } catch (err) {
    console.error("[TelemetryBus] buffered flush failed:", (err as Error)?.message || err);
    return 0;
  }
}

/**
 * THE unified ingest entry. When TELEMETRY_BATCH_ENABLED is OFF (default) this is a
 * thin pass-through to ingestNow (byte-for-byte the prior behaviour). When ON it
 * appends to the coalescing ring buffer and returns fast; the buffer is drained by
 * the flush timer, by a size-threshold backpressure flush (awaited), or on exit.
 * The order of samples is preserved (FIFO). Never throws into the caller's loop.
 */
export async function ingestTelemetry(samples: CanonicalSample[]): Promise<number> {
  if (!samples || samples.length === 0) return 0;

  // G2.6 (doc 44 W2-B2) — contract-validation seam BEFORE enqueue (covers both the
  // buffered and the direct path). Mode "off" (default) returns the same array reference —
  // zero cost. Mode "quarantine" drops (and quarantines) samples whose canonical telemetry
  // shape (subject syn/+/+/+/+/+/telemetry) is invalid; mode "log" only counts+warns.
  // Fail-safe by contract: internal validator errors never filter the batch.
  samples = filterTelemetrySamples(samples);
  if (samples.length === 0) return 0;

  if (!batchEnabled()) {
    return ingestNow(samples);
  }

  // Buffered (coalescing) path.
  ensureShutdownFlush();
  for (const s of samples) telemetryBuffer.push(s);
  if (telemetryBuffer.length >= maxBatch()) {
    // Backpressure: bound memory + apply latency to the caller by flushing inline.
    return flushTelemetryBuffer();
  }
  scheduleFlush();
  return samples.length; // accepted into the buffer (best-effort count)
}

/**
 * THE unified ingest core. Normalize → resolve machineId → bulk-insert into
 * ot_telemetry → broadcast on `telemetry:sample`. Fail-safe: returns the count
 * actually persisted; never throws into the caller's poll loop.
 *
 * C1 STORE-AND-FORWARD (additive, flag-gated by OT_STORE_FORWARD_ENABLED, default OFF):
 * when the flag is ON and the insert persists 0 rows for a NON-EMPTY batch (DB down),
 * the rows are BUFFERED to a durable WAL instead of being dropped; when the flag is ON
 * and a write SUCCEEDS, a bounded backfill opportunistically drains anything buffered
 * while offline. With the flag OFF the code path is byte-for-byte the prior behaviour.
 */
async function ingestNow(samples: CanonicalSample[]): Promise<number> {
  if (!samples || samples.length === 0) return 0;

  // 1+2: normalize + resolve machineId for each sample.
  const rows: InsertOtTelemetry[] = [];
  for (const s of samples) {
    const machineId =
      s.machineId != null ? s.machineId : await resolveMachineId(s.deviceId);
    rows.push(toCanonicalRow(s, machineId));
  }

  // 3: bulk insert via the shared persist path. Degrade-safe: an insert error never
  // propagates into a protocol reader's poll loop.
  let persisted = 0;
  let insertThrew = false;
  try {
    persisted = await persistRows(rows);
  } catch (err) {
    insertThrew = true;
    console.error("[TelemetryBus] insert failed:", (err as Error)?.message || err);
  }

  // 3b: C1 STORE-AND-FORWARD (additive; no-op unless OT_STORE_FORWARD_ENABLED). When
  // the batch did NOT fully persist (DB down/degraded or the insert threw), buffer the
  // rows to the durable WAL instead of dropping them. On a SUCCESSFUL write,
  // opportunistically drain anything buffered while offline. Fault-isolated so the
  // store-and-forward path can never break ingest/broadcast.
  try {
    const { storeForwardEnabled } = await import("./ot/storeForward");
    if (storeForwardEnabled()) {
      const sf = await ensureStoreForwardWired();
      // The persist path is all-or-nothing per batch (one db.insert(values)): it either
      // returns rows.length, returns 0 (DB absent/degraded), or throws. So "nothing
      // landed" == (threw OR persisted 0). Buffer only then — never buffer rows that
      // already persisted (that would risk a double-insert since a live write is not in
      // the applied ledger). buffer() is itself idempotent by natural key.
      if (insertThrew || persisted === 0) {
        await sf.buffer(rows);
      } else if (persisted === rows.length) {
        // A healthy write → the DB is back; drain the offline backlog (bounded).
        if (sf.bufferedCount() > 0) await sf.backfill();
      }
    }
  } catch (err) {
    console.error("[TelemetryBus] store-and-forward failed:", (err as Error)?.message || err);
  }

  // 4: broadcast on the ONE unified channel (signal-only; no-op without io) AND
  //    fan out this locally-ingested batch to remote instances (U6-b; no-op unless
  //    EVENTBUS_REDIS_ENABLED + REDIS_URL). Loopback-safe (remote=false here).
  await broadcastAndTap(rows.map(toBroadcast), /* remote */ false);

  // 5: fan out to any registered in-process taps (T1-c twin gateway). Fault-isolated.
  if (taps.size > 0) {
    for (const tap of taps) {
      try {
        tap(rows);
      } catch (err) {
        console.error("[TelemetryBus] tap failed:", (err as Error)?.message || err);
      }
    }
  }

  return persisted;
}

// ── MON-F13 (doc 40 §11) — ENERGY auto-ingest tap ────────────────────────────
// Mirror whitelisted energy metrics from the unified telemetry stream into the
// dedicated `energy_readings` table so the ISO-50001 energy views have live data
// WITHOUT a second reader / second ingest path. This is an OBSERVER (a tap): it runs
// AFTER the canonical persist + broadcast and never affects them; a failure is isolated.
//
// FLAG: ENERGY_INGEST_FROM_TELEMETRY (default OFF). Registered ONLY when the flag is
// true at boot, so the flag-OFF path keeps taps.size === 0 (byte-for-byte prior
// behaviour, zero overhead). Set the flag in .env before start to engage it.
//
// HONESTY: produces NO data of its own — it only re-shapes rows a real reader already
// handed the bus. Only rows whose metric is in the whitelist AND carry a finite numeric
// value are mirrored; everything else is ignored. `unit` is taken from device_tags
// (by adapterId+tagKey in meta, cached) when the sample itself omitted a unit.

/** metric name (lowercased) → which energy_readings column it populates. */
const ENERGY_METRIC_COLUMN: Record<
  string,
  "value" | "powerKw" | "powerFactor" | "reactivePowerKvar" | "apparentPowerKva"
> = {
  // energy (kWh) → the mandatory `value` column
  energy_kwh: "value",
  kwh: "value",
  active_energy_kwh: "value",
  // instantaneous active power (kW)
  power_kw: "powerKw",
  active_power_kw: "powerKw",
  kw: "powerKw",
  // power factor [0..1]
  power_factor: "powerFactor",
  pf: "powerFactor",
  // reactive / apparent power
  reactive_power_kvar: "reactivePowerKvar",
  kvar: "reactivePowerKvar",
  apparent_power_kva: "apparentPowerKva",
  kva: "apparentPowerKva",
};

/** Default unit per target column (used only when neither sample nor device_tags has one). */
const ENERGY_DEFAULT_UNIT: Record<string, string> = {
  value: "kWh",
  powerKw: "kW",
  powerFactor: "",
  reactivePowerKvar: "kVAr",
  apparentPowerKva: "kVA",
};

function energyIngestEnabled(): boolean {
  return process.env.ENERGY_INGEST_FROM_TELEMETRY === "true";
}

// unit lookup cache: `${adapterId}|${tagKey}` → unit (or "" when not found).
const energyUnitCache = new Map<string, string>();

/** Resolve a row's unit: prefer the sample's own unit, else device_tags (cached). */
async function resolveEnergyUnit(row: InsertOtTelemetry): Promise<string | null> {
  if (row.unit) return row.unit;
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const adapterId = meta.adapterId;
  const tagKey = meta.tagKey;
  if (adapterId == null || tagKey == null) return null;
  const cacheKey = `${adapterId}|${tagKey}`;
  const cached = energyUnitCache.get(cacheKey);
  if (cached !== undefined) return cached || null;
  let unit = "";
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (db) {
      const { deviceTags } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      const found = await db
        .select({ unit: deviceTags.unit })
        .from(deviceTags)
        .where(and(eq(deviceTags.adapterId, Number(adapterId)), eq(deviceTags.tagKey, String(tagKey))))
        .limit(1);
      unit = found.length > 0 && found[0].unit ? String(found[0].unit) : "";
    }
  } catch {
    unit = ""; // lookup failure → fall back to the sample/default unit
  }
  energyUnitCache.set(cacheKey, unit);
  return unit || null;
}

/**
 * The tap fn: for each whitelisted numeric row, build one energy_readings insert and
 * bulk-persist the batch. Fired from a sync tap via an isolated async IIFE (the bus's
 * tap loop is sync). Fault-isolated — an insert error is logged, never rethrown.
 */
function energyMirrorTap(rows: InsertOtTelemetry[]): void {
  if (!energyIngestEnabled() || rows.length === 0) return;
  void (async () => {
    try {
      const energyRows: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        const col = ENERGY_METRIC_COLUMN[row.metric?.toLowerCase() ?? ""];
        if (!col) continue;
        const num = row.numValue;
        if (num == null || !Number.isFinite(num)) continue; // energy is numeric-only
        const unit = (await resolveEnergyUnit(row)) ?? ENERGY_DEFAULT_UNIT[col] ?? "";
        const valueStr = String(num);
        const er: Record<string, unknown> = {
          machineId: row.machineId ?? null,
          source: "electricity",
          value: valueStr, // NOT NULL — always the measured value of this metric
          unit: unit || ENERGY_DEFAULT_UNIT[col] || "kWh",
          timestamp: row.ts instanceof Date ? row.ts : new Date(row.ts as string | number),
        };
        // Populate the typed column too (value already holds it when col === 'value').
        if (col !== "value") er[col] = valueStr;
        energyRows.push(er);
      }
      if (energyRows.length === 0) return;
      const { getDb } = await import("../db/connection");
      const db = await getDb();
      if (!db) return; // DB absent → no-op (never fabricate)
      const { energyReadings } = await import("../../drizzle/schema");
      await db.insert(energyReadings).values(energyRows as any);
    } catch (err) {
      console.error("[TelemetryBus] energy mirror tap failed:", (err as Error)?.message || err);
    }
  })();
}

// Register the energy tap ONLY when the flag is on at boot (keeps the flag-OFF path at
// taps.size === 0 → zero overhead + byte-for-byte prior behaviour).
if (energyIngestEnabled()) {
  registerTelemetryTap(energyMirrorTap);
  console.log("[TelemetryBus] MON-F13 energy auto-ingest tap ENABLED (ENERGY_INGEST_FROM_TELEMETRY)");
}
