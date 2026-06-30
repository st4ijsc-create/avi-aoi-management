/**
 * R0-1 (doc 16 §9 Khối 4) — MQTT sensor ingest → machine_sensor_readings.
 *
 * Closes the unwired loop "MQTT sensor → machineSensorReadings" so predictive
 * maintenance can score against REAL vibration / motor-current / temperature /
 * pressure streams instead of only the 4 heartbeat metrics.
 *
 * ── TOPIC CONVENTION ─────────────────────────────────────────────────────────
 *   factory/{factoryId}/{machineCode}/sensor/{sensorType}
 *     factoryId   — numeric factory id (informational; machine resolved by code)
 *     machineCode — matches machines.code (resolved → machineId, cached)
 *     sensorType  — vibration | current | temperature | pressure | ...
 *
 *   Payload: either a bare number ("0.42") OR a JSON object:
 *     { "value": 0.42, "unit": "mm/s", "timestamp": "2026-06-30T10:00:00Z" }
 *   `unit`/`timestamp` are optional (timestamp defaults to receive time).
 *
 * ── DESIGN ───────────────────────────────────────────────────────────────────
 *   • Reuses the EXISTING Aedes broker (wired into mqttService.processAedesPublish)
 *     — NO new broker connection is opened.
 *   • Gated behind PDM_SENSOR_INGEST_ENABLED (default false). When off the topic
 *     parser short-circuits → no subscription effect, no writes.
 *   • Unknown machineCode → log + skip (never throws into the publish handler).
 *   • Fail-safe: any DB/parse error is swallowed so it never breaks the broker's
 *     publish loop (mirrors telemetryBus / mqttService error handling).
 */
import { logger } from "../logger";

export const SENSOR_INGEST_ENABLED_FLAG = "PDM_SENSOR_INGEST_ENABLED";

/** Topic convention: factory/{factoryId}/{machineCode}/sensor/{sensorType}. */
const SENSOR_TOPIC_RE = /^factory\/([^/]+)\/([^/]+)\/sensor\/([^/]+)$/;

export interface ParsedSensorTopic {
  factoryId: string;
  machineCode: string;
  sensorType: string;
}

export interface ParsedSensorReading extends ParsedSensorTopic {
  value: number;
  unit: string | null;
  timestamp: Date;
}

/** True when the sensor-ingest feature flag is on. */
export function isSensorIngestEnabled(): boolean {
  return process.env[SENSOR_INGEST_ENABLED_FLAG] === "true";
}

/**
 * Pure: parse a topic against the sensor convention. Returns null when the topic
 * is not a sensor topic (lets the broker handler skip non-sensor traffic cheaply).
 */
export function parseSensorTopic(topic: string): ParsedSensorTopic | null {
  const m = SENSOR_TOPIC_RE.exec(topic);
  if (!m) return null;
  const [, factoryId, machineCode, sensorType] = m;
  if (!machineCode || !sensorType) return null;
  return { factoryId, machineCode, sensorType: sensorType.slice(0, 50) };
}

/**
 * Pure: parse a sensor MQTT message (topic + raw payload) into a normalized
 * reading, or null when the topic does not match / the payload has no finite
 * numeric value. No I/O — unit-testable.
 */
export function parseSensorMessage(
  topic: string,
  payload: Buffer | string | unknown,
): ParsedSensorReading | null {
  const parsedTopic = parseSensorTopic(topic);
  if (!parsedTopic) return null;

  const raw = Buffer.isBuffer(payload)
    ? payload.toString()
    : typeof payload === "string"
      ? payload
      : payload == null
        ? ""
        : String(payload);

  let value: number | null = null;
  let unit: string | null = null;
  let timestamp: Date = new Date();

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Try JSON object first; fall back to a bare numeric payload.
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const v = Number(obj.value);
      if (Number.isFinite(v)) value = v;
      if (typeof obj.unit === "string") unit = obj.unit.slice(0, 20);
      if (obj.timestamp != null) {
        const t = new Date(obj.timestamp as string);
        if (!Number.isNaN(t.getTime())) timestamp = t;
      }
    } catch {
      return null; // malformed JSON → skip (no throw).
    }
  } else {
    const v = Number(trimmed);
    if (Number.isFinite(v)) value = v;
  }

  if (value == null || !Number.isFinite(value)) return null;

  return { ...parsedTopic, value, unit, timestamp };
}

// machineCode → machineId resolution cache (negative results cached as null).
const machineIdCache = new Map<string, number | null>();

/** Clear the machineCode→machineId cache (tests / after master-data edits). */
export function clearSensorMachineIdCache(): void {
  machineIdCache.clear();
}

/** Resolve a machineCode to a platform machineId via machines.code (cached). */
async function resolveMachineId(machineCode: string): Promise<number | null> {
  if (machineIdCache.has(machineCode)) return machineIdCache.get(machineCode) ?? null;
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
        .where(eq(machines.code, machineCode))
        .limit(1);
      resolved = rows.length > 0 ? rows[0].id : null;
    }
  } catch {
    resolved = null; // resolution failure → treat as unknown machine.
  }
  machineIdCache.set(machineCode, resolved);
  return resolved;
}

/**
 * Handle ONE sensor MQTT message: gate → parse → resolve machine → insert into
 * machine_sensor_readings (source='mqtt'). Fail-safe & non-blocking: returns true
 * only when a row was actually written, and NEVER throws into the publish loop.
 */
export async function handleSensorMessage(
  topic: string,
  payload: Buffer | string | unknown,
): Promise<boolean> {
  if (!isSensorIngestEnabled()) return false;

  let reading: ParsedSensorReading | null;
  try {
    reading = parseSensorMessage(topic, payload);
  } catch (err) {
    logger.warn({ topic, err: (err as Error)?.message }, "[SensorIngest] parse failed");
    return false;
  }
  if (!reading) return false;

  try {
    const machineId = await resolveMachineId(reading.machineCode);
    if (machineId == null) {
      // Unknown machine → log + skip (no throw), per R0-1 requirement.
      logger.warn(
        { machineCode: reading.machineCode, sensorType: reading.sensorType },
        "[SensorIngest] unknown machineCode — skipping sensor reading",
      );
      return false;
    }

    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return false; // DB-absent (tests / headless) → safe no-op.

    const { machineSensorReadings } = await import("../../drizzle/schema");
    await db.insert(machineSensorReadings).values({
      machineId,
      sensorType: reading.sensorType,
      // decimal column → string is the safe representation across drivers.
      value: String(reading.value),
      unit: reading.unit ?? undefined,
      timestamp: reading.timestamp,
      source: "mqtt",
    } as any);

    return true;
  } catch (err) {
    logger.error(
      { topic, err: (err as Error)?.message },
      "[SensorIngest] insert failed",
    );
    return false;
  }
}
