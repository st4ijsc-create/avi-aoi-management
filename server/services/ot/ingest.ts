/**
 * Sprint F1.1 / P2 — Ingest an OtSample through the UNIFIED TELEMETRY BUS.
 *
 * `sampleToCanonical` is a pure mapper (testable without DB): it turns an OtSample
 * + its adapter into a protocol-agnostic `CanonicalSample` (OT protocol → canonical
 * telemetryProtocolEnum; tagKey → metric; value is split into typed columns by the
 * bus). `ingestSample` funnels that ONE sample into `ingestTelemetry()` — the single
 * normalize → resolve machineId → bulk-insert(ot_telemetry) → broadcast(`telemetry:sample`)
 * path shared by EVERY protocol — and additionally (optionally) republishes to UNS.
 *
 * The UNS bridge republish (OT_INGEST_TO_UNS) is UNCHANGED and wrapped in its own
 * try/catch so a UNS error never breaks the canonical telemetry write.
 */
import type { OtSample, OtProtocol } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";
import { ingestTelemetry, type CanonicalSample, type TelemetryProtocol } from "../telemetryBus";

/**
 * Map an OT driver protocol → the canonical telemetryProtocolEnum value.
 * 'mitsubishi-mc' and 'stub' have no dedicated enum member → 'other'.
 * 'ethernet-ip' (driver) → 'ethernet_ip' (enum).
 */
export function otProtocolToCanonical(p: OtProtocol): TelemetryProtocol {
  switch (p) {
    case "opcua":
      return "opcua";
    case "modbus":
      return "modbus";
    case "s7":
      return "s7";
    case "ethernet-ip":
      return "ethernet_ip";
    case "mitsubishi-mc":
    case "stub":
    default:
      return "other";
  }
}

/**
 * Pure: an OtSample (+ its adapter) → a CanonicalSample. No I/O.
 * deviceId = adapter.code (lets the bus resolve machineId when adapter.machineId
 * is null); machineId is passed straight through when the adapter already has it.
 */
export function sampleToCanonical(adapter: RuntimeAdapter, sample: OtSample): CanonicalSample {
  return {
    ts: sample.timestamp,
    machineId: adapter.machineId ?? null,
    deviceId: adapter.code,
    protocol: otProtocolToCanonical(adapter.protocol),
    metric: sample.tagKey,
    value: sample.value,
    quality: sample.quality,
    meta: { adapterId: adapter.adapterId, tagKey: sample.tagKey },
  };
}

/** UNS topic for an adapter/tag (unchanged) — reused for the optional republish. */
function unsTopicFor(adapter: RuntimeAdapter, sample: OtSample): string {
  return `avi/0/workshop/ot/station/${adapter.code}/${sample.tagKey}`;
}

/**
 * Ingest ONE OT sample: funnel through the unified telemetry bus, then optionally
 * republish to UNS. The bus owns persistence + broadcast; this only adds UNS.
 */
export async function ingestSample(adapter: RuntimeAdapter, sample: OtSample): Promise<void> {
  // 1) Canonical path — ONE bus for every protocol (persist + broadcast).
  await ingestTelemetry([sampleToCanonical(adapter, sample)]);

  // 2) Optional UNS republish (UNCHANGED behaviour). Isolated so it can't break (1).
  if (process.env.OT_INGEST_TO_UNS === "true") {
    try {
      const { isUnsBridgeEnabled } = await import("../unsBridge");
      if (isUnsBridgeEnabled()) {
        if (process.env.UNS_SPARKPLUG_ENABLED === "true") {
          // F3a — Sparkplug-B DDATA (lazy DBIRTH in publisher). PUBLISH only.
          const { publishSparkplugDData } = await import("../unsPublisher");
          const { otTypeToSparkplug } = await import("../uns/sparkplugEncoder");
          const tagDef = adapter.tags.find((t) => t.tagKey === sample.tagKey);
          const type = tagDef
            ? otTypeToSparkplug(tagDef.dataType)
            : typeof sample.value === "number"
              ? "Double"
              : typeof sample.value === "boolean"
                ? "Boolean"
                : "String";
          publishSparkplugDData(adapter.code, [
            {
              name: sample.tagKey,
              type,
              value: sample.value,
              timestamp: sample.timestamp.getTime(),
            },
          ]);
        } else {
          // Legacy JSON path (backward-compat) — unchanged.
          const { publishNormalized } = await import("../unsPublisher");
          publishNormalized(unsTopicFor(adapter, sample), {
            adapterId: adapter.adapterId,
            machineId: adapter.machineId,
            tagKey: sample.tagKey,
            value: sample.value,
            quality: sample.quality,
            timestamp: sample.timestamp.toISOString(),
          });
        }
      }
    } catch (err) {
      console.error("[OT] UNS publish failed:", (err as Error)?.message || err);
    }
  }
}
