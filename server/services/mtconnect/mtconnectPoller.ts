/**
 * MTConnect poller — flag-gated, fail-safe polling of MTConnect Agents.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Lifecycle mirrors the OT manager (server/services/ot/otManager.ts):
 *   - No-op unless MTCONNECT_ENABLED === "true".
 *   - Sources come from env MTCONNECT_SOURCES (JSON array or CSV of
 *     {agentUrl, machineCode, pollMs}). Each source polls /current on its own
 *     interval; per-source try/catch so one bad agent never stops the others.
 *   - startMtconnectPoller() / stopMtconnectPoller() are idempotent.
 *
 * STORAGE (reuses existing tables — NO schema change):
 *   - Numeric SAMPLE DataItems  → the UNIFIED TELEMETRY BUS (ingestTelemetry,
 *     protocol 'mtconnect') → canonical `ot_telemetry` + `telemetry:sample` broadcast.
 *     machineCode is the deviceId; the sink adapterId is carried in each sample's meta.
 *   - EVENT / CONDITION DataItems → `process_results` (one row), with the MTConnect
 *     state in `metrics` and a pass/fail/warn `result` derived from the state.
 *
 * Machine mapping: source.machineCode → machines.code → machineId.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { fetchCurrent } from "./mtconnectClient";
import type { MtcReading } from "./mtconnectClient";
import type { InsertProcessResult } from "../../../drizzle/schema";
import { ingestTelemetry, type CanonicalSample } from "../telemetryBus";

export interface MtcSource {
  agentUrl: string;
  machineCode: string;
  pollMs: number;
}

interface MtcSourceStats {
  agentUrl: string;
  machineCode: string;
  machineId: number | null;
  pollMs: number;
  polls: number;
  lastPollAt: string | null;
  lastReadingCount: number;
  lastError: string | null;
  telemetryRows: number;
  eventRows: number;
}

let running = false;
const timers: NodeJS.Timeout[] = [];
const stats = new Map<string, MtcSourceStats>();
// machineCode → resolved sink adapterId (cached after first DB resolution).
const adapterCache = new Map<string, number>();

const DEFAULT_POLL_MS = 5000;

function flagEnabled(): boolean {
  return process.env.MTCONNECT_ENABLED === "true";
}

function log(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err != null ? String(err) : "";
  console.warn(`[MTConnect] ${msg}${detail ? `: ${detail}` : ""}`);
}

/**
 * Parse MTCONNECT_SOURCES. Accepts a JSON array of objects, or a CSV where each
 * comma-separated item is `agentUrl|machineCode|pollMs`. Pure + fail-safe.
 */
export function parseSources(raw: string | undefined): MtcSource[] {
  if (!raw || !raw.trim()) return [];
  const text = raw.trim();
  const out: MtcSource[] = [];

  const push = (agentUrl: unknown, machineCode: unknown, pollMs: unknown) => {
    if (typeof agentUrl !== "string" || !agentUrl.trim()) return;
    if (typeof machineCode !== "string" || !machineCode.trim()) return;
    const n = Number(pollMs);
    out.push({
      agentUrl: agentUrl.trim(),
      machineCode: machineCode.trim(),
      pollMs: Number.isFinite(n) && n >= 500 ? n : DEFAULT_POLL_MS,
    });
  };

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        if (it && typeof it === "object") {
          push((it as any).agentUrl, (it as any).machineCode, (it as any).pollMs);
        }
      }
      return out;
    } catch (err) {
      log("parseSources JSON failed, treating as CSV", err);
    }
  }

  // CSV fallback: items separated by ';' or newline; fields by '|'.
  for (const item of text.split(/[;\n]+/)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const [agentUrl, machineCode, pollMs] = trimmed.split("|").map((s) => s.trim());
    push(agentUrl, machineCode, pollMs);
  }
  return out;
}

/**
 * A condition/event observation → a process_results `result`.
 * NORMAL/READY/ACTIVE/AVAILABLE → pass; WARNING → warn; FAULT/UNAVAILABLE/STOPPED → fail.
 */
export function stateToResult(reading: MtcReading): "pass" | "fail" | "warn" | "skip" {
  const s = (reading.conditionState || reading.value || "").toUpperCase();
  if (s === "WARNING") return "warn";
  if (s === "FAULT" || s === "UNAVAILABLE" || s === "STOPPED" || s === "INTERRUPTED") return "fail";
  if (s === "" ) return "skip";
  return "pass";
}

/**
 * Pure mapper: split normalized readings into the two storage shapes.
 *   - numeric SAMPLE → a CanonicalSample (protocol 'mtconnect') for the bus.
 *   - EVENT / CONDITION → process_results row (state in metrics).
 * No I/O; the poller supplies machineId + machineCode (= deviceId) context.
 * `adapterId` is carried in each sample's `meta` for traceability.
 */
export function mapReadings(
  readings: MtcReading[],
  ctx: { adapterId: number; machineId: number; machineCode: string },
): { telemetry: CanonicalSample[]; events: InsertProcessResult[] } {
  const telemetry: CanonicalSample[] = [];
  const events: InsertProcessResult[] = [];

  for (const r of readings) {
    const tagKey = r.dataItemName || r.dataItemId;

    if (r.category === "SAMPLE" && r.numericValue !== null) {
      telemetry.push({
        ts: r.timestamp,
        machineId: ctx.machineId,
        deviceId: ctx.machineCode,
        protocol: "mtconnect",
        metric: tagKey.slice(0, 128),
        value: r.numericValue,
        quality: r.value.toUpperCase() === "UNAVAILABLE" ? "bad" : "good",
        meta: { adapterId: ctx.adapterId },
      });
      continue;
    }

    // EVENT, CONDITION, or a non-numeric SAMPLE → an event/state row.
    events.push({
      serialNumber: `mtc:${ctx.machineCode}`,
      machineId: ctx.machineId,
      stepType: `mtconnect:${r.type.toLowerCase()}`,
      result: stateToResult(r),
      metrics: {
        dataItemId: r.dataItemId,
        type: r.type,
        subType: r.subType ?? "",
        category: r.category,
        state: r.conditionState ?? r.value,
        value: r.value,
      },
      recipeRef: tagKey.slice(0, 128),
      measuredAt: r.timestamp,
    });
  }

  return { telemetry, events };
}

/**
 * Resolve the platform machineId for a machineCode and a SINK adapterId to attach
 * ot_telemetry rows to. Reuses an existing deviceAdapter for the machine when one
 * exists (any protocol); otherwise creates a 'stub'-protocol sink adapter named
 * after the machine (the schema's otProtocolEnum has no 'mtconnect' member, so we
 * reuse the valid 'stub' member rather than altering the enum).
 *
 * Returns null when there's no DB or the machineCode is unknown.
 */
async function resolveSink(
  machineCode: string,
): Promise<{ machineId: number; adapterId: number } | null> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return null;

  const { machines, deviceAdapters } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const machineRows = await db
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.code, machineCode))
    .limit(1);
  if (machineRows.length === 0) {
    log(`machineCode "${machineCode}" not found in machines table`);
    return null;
  }
  const machineId = machineRows[0].id;

  const cached = adapterCache.get(machineCode);
  if (cached != null) return { machineId, adapterId: cached };

  const sinkCode = `mtc-${machineCode}`.slice(0, 64);

  const existing = await db
    .select({ id: deviceAdapters.id })
    .from(deviceAdapters)
    .where(eq(deviceAdapters.code, sinkCode))
    .limit(1);
  if (existing.length > 0) {
    adapterCache.set(machineCode, existing[0].id);
    return { machineId, adapterId: existing[0].id };
  }

  // Create a dedicated sink adapter (protocol 'stub' — valid enum member).
  const inserted = await db
    .insert(deviceAdapters)
    .values({
      machineId,
      code: sinkCode,
      name: `MTConnect ${machineCode}`,
      protocol: "stub",
      endpoint: "mtconnect",
      pollIntervalMs: DEFAULT_POLL_MS,
      status: "connected",
      isEnabled: false, // not driven by the OT manager; we write to it directly
    })
    .returning({ id: deviceAdapters.id });
  const adapterId = inserted[0].id;
  adapterCache.set(machineCode, adapterId);
  return { machineId, adapterId };
}

/** Persist mapped rows. Telemetry → unified bus; events → process_results. */
async function persist(
  telemetry: CanonicalSample[],
  events: InsertProcessResult[],
): Promise<{ telemetryRows: number; eventRows: number }> {
  let telemetryRows = 0;
  let eventRows = 0;

  // Numeric SAMPLEs go through the ONE unified telemetry bus (persist + broadcast).
  if (telemetry.length > 0) {
    try {
      await ingestTelemetry(telemetry);
      telemetryRows = telemetry.length;
    } catch (err) {
      log("telemetry bus ingest failed", err);
    }
  }

  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return { telemetryRows, eventRows };

  const { processResults } = await import("../../../drizzle/schema");

  if (events.length > 0) {
    try {
      await db.insert(processResults).values(events);
      eventRows = events.length;
    } catch (err) {
      log("process_results insert failed", err);
    }
  }
  return { telemetryRows, eventRows };
}

/** Poll one source once. Fail-safe; updates stats. */
async function pollOnce(source: MtcSource): Promise<void> {
  const st = stats.get(source.agentUrl + "|" + source.machineCode);
  try {
    const sink = await resolveSink(source.machineCode);
    if (st) {
      st.polls += 1;
      st.lastPollAt = new Date().toISOString();
      st.machineId = sink?.machineId ?? null;
    }
    if (!sink) {
      if (st) st.lastError = "machineCode unresolved / no DB";
      return;
    }

    const readings = await fetchCurrent(source.agentUrl, Math.max(2000, source.pollMs));
    if (st) st.lastReadingCount = readings.length;

    const { telemetry, events } = mapReadings(readings, {
      adapterId: sink.adapterId,
      machineId: sink.machineId,
      machineCode: source.machineCode,
    });
    const { telemetryRows, eventRows } = await persist(telemetry, events);
    if (st) {
      st.telemetryRows += telemetryRows;
      st.eventRows += eventRows;
      st.lastError = null;
    }
  } catch (err) {
    log(`poll ${source.machineCode} failed`, err);
    if (st) st.lastError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Start the MTConnect poller. Returns false when the flag is off or no valid
 * source is configured. Idempotent.
 */
export async function startMtconnectPoller(): Promise<boolean> {
  if (running) return true;
  if (!flagEnabled()) {
    console.log("[MTConnect] disabled (set MTCONNECT_ENABLED=true to enable)");
    return false;
  }

  const sources = parseSources(process.env.MTCONNECT_SOURCES);
  if (sources.length === 0) {
    console.log("[MTConnect] no sources configured (set MTCONNECT_SOURCES) — nothing to start");
    return false;
  }

  for (const source of sources) {
    const key = source.agentUrl + "|" + source.machineCode;
    stats.set(key, {
      agentUrl: source.agentUrl,
      machineCode: source.machineCode,
      machineId: null,
      pollMs: source.pollMs,
      polls: 0,
      lastPollAt: null,
      lastReadingCount: 0,
      lastError: null,
      telemetryRows: 0,
      eventRows: 0,
    });
    // Kick once immediately, then on the interval. Errors stay inside pollOnce.
    void pollOnce(source);
    const timer = setInterval(() => void pollOnce(source), source.pollMs);
    if (typeof timer.unref === "function") timer.unref();
    timers.push(timer);
    console.log(`[MTConnect] source "${source.machineCode}" → ${source.agentUrl} every ${source.pollMs}ms`);
  }

  running = true;
  console.log(`[MTConnect] started — ${sources.length} source(s)`);
  return true;
}

/** Stop the poller: clear every interval. Idempotent. */
export function stopMtconnectPoller(): void {
  while (timers.length > 0) {
    const t = timers.pop()!;
    clearInterval(t);
  }
  running = false;
}

export function isMtconnectRunning(): boolean {
  return running;
}

/** Snapshot of per-source stats (for the optional status router). */
export function getMtconnectStats(): { running: boolean; enabled: boolean; sources: MtcSourceStats[] } {
  return {
    running,
    enabled: flagEnabled(),
    sources: Array.from(stats.values()).map((s) => ({ ...s })),
  };
}
