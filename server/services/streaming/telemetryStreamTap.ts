/**
 * doc 44 W4 / G2.7 — bridge telemetryBus → StreamBridge (OPTIONAL, flag-gated).
 *
 * telemetryBus already exposes `registerTelemetryTap` (an observer fired AFTER the
 * canonical persist + broadcast). This wires that tap to PUBLISH each ingested
 * batch onto the streaming bus as one `syn/telemetry/{line}` message, so the
 * StreamProcessor (and any future consumer group / lake sink) can replay/reprocess
 * WITHOUT a second reader and WITHOUT modifying telemetryBus.ts.
 *
 * HONESTY: registered ONLY when STREAM_TELEMETRY_TAP_ENABLED=true at boot, so the
 * default path keeps telemetryBus taps at zero overhead. The tap re-shapes rows a
 * real reader already handed the bus — it fabricates nothing. A publish error is
 * isolated (never affects ingest).
 *
 * Flag: STREAM_TELEMETRY_TAP_ENABLED (default OFF).
 */

import type { InsertOtTelemetry } from "../../../drizzle/schema";
import type { RawTelemetrySample } from "./streamProcessor";

export function isStreamTelemetryTapEnabled(): boolean {
  return process.env.STREAM_TELEMETRY_TAP_ENABLED === "true";
}

/** Derive a coarse line segment from a row (machineId/deviceId) for the topic. */
function lineSegmentOf(row: InsertOtTelemetry): string {
  const dev = row.deviceId ?? "";
  const m = /-?L(\d+)\b/i.exec(dev);
  if (m) return `l${m[1]}`;
  if (row.machineId != null) return `m${row.machineId}`;
  return "unassigned";
}

/** Map a canonical ot_telemetry insert row → the processor's RawTelemetrySample. */
export function rowToSample(row: InsertOtTelemetry): RawTelemetrySample {
  const value =
    row.numValue ?? (row.boolValue != null ? row.boolValue : row.textValue ?? null);
  return {
    deviceId: row.deviceId ?? null,
    machineCode: null,
    ts: row.ts instanceof Date ? row.ts.toISOString() : (row.ts as string | number | null) ?? null,
    metric: row.metric,
    value,
    meta: (row.meta ?? null) as Record<string, unknown> | null,
  };
}

let unregister: (() => void) | null = null;

/**
 * Install the telemetry→stream tap. Returns an unregister fn (or null when the flag
 * is off). Idempotent-ish: a second call replaces the previous registration.
 */
export async function installTelemetryStreamTap(): Promise<(() => void) | null> {
  if (!isStreamTelemetryTapEnabled()) return null;
  const [{ registerTelemetryTap }, { getStreamBridge }] = await Promise.all([
    import("../telemetryBus"),
    import("./streamBridge"),
  ]);
  const bridge = await getStreamBridge();

  if (unregister) unregister();
  unregister = registerTelemetryTap((rows: InsertOtTelemetry[]) => {
    if (rows.length === 0) return;
    // Group by line segment so each line is its own topic (consumer-group friendly).
    const byLine = new Map<string, RawTelemetrySample[]>();
    for (const row of rows) {
      const seg = lineSegmentOf(row);
      let arr = byLine.get(seg);
      if (!arr) {
        arr = [];
        byLine.set(seg, arr);
      }
      arr.push(rowToSample(row));
    }
    for (const [seg, samples] of byLine) {
      void bridge
        .publish(`syn/telemetry/${seg}`, samples)
        .catch((err) => console.error("[StreamTelemetryTap] publish failed:", (err as Error)?.message ?? err));
    }
  });
  console.log("[StreamTelemetryTap] telemetryBus → StreamBridge tap ENABLED (STREAM_TELEMETRY_TAP_ENABLED)");
  return unregister;
}

/** Remove the tap (tests / shutdown). */
export function removeTelemetryStreamTap(): void {
  if (unregister) {
    unregister();
    unregister = null;
  }
}
