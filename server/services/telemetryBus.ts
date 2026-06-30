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

// deviceId → machineId resolution cache (negative results cached as null).
const machineIdCache = new Map<string, number | null>();

/** Clear the deviceId→machineId cache (tests / after master-data edits). */
export function clearMachineIdCache(): void {
  machineIdCache.clear();
}

/** Resolve a deviceId to a platform machineId via machines.code (cached). */
async function resolveMachineId(deviceId: string | null | undefined): Promise<number | null> {
  if (!deviceId) return null;
  if (machineIdCache.has(deviceId)) return machineIdCache.get(deviceId) ?? null;
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
  machineIdCache.set(deviceId, resolved);
  return resolved;
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
 * THE unified ingest entry. Normalize → resolve machineId → bulk-insert into
 * ot_telemetry → broadcast on `telemetry:sample`. Fail-safe: returns the count
 * actually persisted; never throws into the caller's poll loop.
 */
export async function ingestTelemetry(samples: CanonicalSample[]): Promise<number> {
  if (!samples || samples.length === 0) return 0;

  // 1+2: normalize + resolve machineId for each sample.
  const rows: InsertOtTelemetry[] = [];
  for (const s of samples) {
    const machineId =
      s.machineId != null ? s.machineId : await resolveMachineId(s.deviceId);
    rows.push(toCanonicalRow(s, machineId));
  }

  // 3: bulk insert (single statement). DB-absent → skip persist, still broadcast.
  let persisted = 0;
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (db) {
      const { otTelemetry } = await import("../../drizzle/schema");
      await db.insert(otTelemetry).values(rows);
      persisted = rows.length;
    }
  } catch (err) {
    console.error("[TelemetryBus] insert failed:", (err as Error)?.message || err);
  }

  // 4: broadcast on the ONE unified channel (signal-only; no-op without io).
  try {
    const { emitTelemetrySamples } = await import("../_core/socket");
    emitTelemetrySamples(rows.map(toBroadcast));
  } catch (err) {
    console.error("[TelemetryBus] broadcast failed:", (err as Error)?.message || err);
  }

  return persisted;
}
