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

  // 2) Optional UNS republish (UNCHANGED default behaviour). Isolated so it can't break (1).
  await republishSampleToUns(adapter, sample);
}

/**
 * R-2a (doc 38 P0-D) — Ingest ALL samples of ONE poll tick as a SINGLE bus call.
 *
 * The OT drivers hand back a full `OtSample[]` per readTags() tick. Routing the whole
 * array through ONE `ingestTelemetry(...)` collapses the historical
 * "1 INSERT per tag per poll" round-trips into ONE multi-row insert per tick (the
 * bus already bulk-inserts `values(rows)`), matching what MTConnect already did.
 * `ingestSample` (single) is retained for compatibility. Order is preserved: the
 * canonical write lands the whole tick first, then per-sample UNS republish runs in
 * the original tag order. Each UNS republish is independently isolated so one tag's
 * publish error can never break the batch. Never throws into the poll loop.
 */
export async function ingestSamples(adapter: RuntimeAdapter, samples: OtSample[]): Promise<void> {
  if (!samples || samples.length === 0) return;

  // 1) Canonical path — ONE bus call for the whole tick (persist + broadcast).
  await ingestTelemetry(samples.map((s) => sampleToCanonical(adapter, s)));

  // 2) Optional UNS republish, per sample, in order (UNCHANGED per-sample behaviour).
  if (process.env.OT_INGEST_TO_UNS === "true") {
    for (const sample of samples) {
      await republishSampleToUns(adapter, sample);
    }
  }
}

/**
 * Optional UNS republish of ONE sample (UNCHANGED default behaviour). No-op unless
 * OT_INGEST_TO_UNS==="true". Fully isolated in its own try/catch so a UNS error can
 * never break the canonical telemetry write. Extracted from `ingestSample` so both
 * the single- and batch-ingest paths share EXACTLY the same republish semantics.
 */
async function republishSampleToUns(adapter: RuntimeAdapter, sample: OtSample): Promise<void> {
  if (process.env.OT_INGEST_TO_UNS === "true") {
    // W7-1 (doc 44 G1.14) — EDGE AUTONOMY: at the edge the UNS broker IS the
    // northbound "central". When it is unreachable, DO NOT log-and-drop (the old
    // behaviour below) — BUFFER the sample to the edge store-and-forward (≥24h) for
    // ordered idempotent replay on reconnect. Zero-cost no-op when EDGE_GATEWAY_MODE
    // is unset: the server-central path is byte-for-byte unchanged.
    if (process.env.EDGE_GATEWAY_MODE === "true" || process.env.EDGE_GATEWAY_MODE === "1") {
      try {
        const edge = await import("../edge/edgeGatewayRuntime");
        if (!(await edge.centralReachable())) {
          await edge.bufferUnsSample(adapter, sample);
          return; // buffered — do NOT attempt a publish that would silently no-op/drop
        }
      } catch (err) {
        console.error("[OT] edge UNS reachability check failed:", (err as Error)?.message || err);
      }
    }
    try {
      const { isUnsBridgeEnabled } = await import("../unsBridge");
      if (isUnsBridgeEnabled()) {
        const sparkplugEnabled = process.env.UNS_SPARKPLUG_ENABLED === "true";

        // Doc 24 (Connectivity) — no-code Tag → UNS mapping (flag UNS_MAPPING_ENABLED,
        // default OFF). When ON and this tag has an ENABLED mapping, publish to the
        // mapped topic/metric with the transform applied (deadband may suppress).
        // An UNMAPPED tag (or flag OFF) falls through to the default normalization
        // below — today's behaviour is completely unchanged. READ-DIRECTION only.
        if (process.env.UNS_MAPPING_ENABLED === "true") {
          const { getMappingForTag, applyMappingForPublish } = await import("../unsMappingService");
          const mapping = await getMappingForTag(adapter.adapterId, sample.tagKey);
          if (mapping) {
            const tagDef = adapter.tags.find((t) => t.tagKey === sample.tagKey);
            const decision = applyMappingForPublish(
              mapping,
              {
                adapterId: adapter.adapterId,
                adapterCode: adapter.code,
                tag: sample.tagKey,
                machineId: adapter.machineId ?? null,
                rawValue: sample.value,
                timestamp: sample.timestamp,
                quality: sample.quality,
                dataType: tagDef?.dataType,
              },
              { sparkplugEnabled },
            );
            if (decision.kind === "sparkplug") {
              const { publishSparkplugDData } = await import("../unsPublisher");
              publishSparkplugDData(decision.deviceId, [decision.metric]);
              return;
            }
            if (decision.kind === "normalized") {
              const { publishNormalized } = await import("../unsPublisher");
              publishNormalized(decision.topic, decision.payload);
              return;
            }
            if (decision.kind === "suppress") {
              // Deadband suppressed this MAPPED sample — publish nothing (a mapped
              // tag must NOT fall back to the default topic).
              return;
            }
            // decision.kind === "default" (mapping disabled) → fall through to default.
          }
        }

        if (sparkplugEnabled) {
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
      // W7-1 (doc 44 G1.14) — at the edge a publish fault BUFFERS (no silent drop);
      // the central all-in-one keeps the historical log-and-continue behaviour.
      if (process.env.EDGE_GATEWAY_MODE === "true" || process.env.EDGE_GATEWAY_MODE === "1") {
        try {
          const edge = await import("../edge/edgeGatewayRuntime");
          await edge.bufferUnsSample(adapter, sample);
        } catch {
          /* buffering itself failed — fall through to the honest log below */
        }
      }
      console.error("[OT] UNS publish failed:", (err as Error)?.message || err);
    }
  }
}
