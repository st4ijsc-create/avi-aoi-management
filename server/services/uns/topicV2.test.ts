/**
 * doc 44 W2-A1 / G2.1 — topicV2 unit tests (PURE, no I/O).
 *
 *  - slugSegment: lowercase, Vietnamese diacritics stripped, đ→d, [a-z0-9-]
 *    only, empty → honest "unassigned" fallback
 *  - topic grammar: syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect} and
 *    aggregate nodes _line/_area/_site (spec LDS-L1 §9.1 / LDS-L2 §4.1)
 *  - aspect classification for legacy avi message types
 *  - QoS/retain per aspect (LDS-L1 §9.3)
 *  - canonical payload SHAPES cross-checked against the seeded schema registry
 *    files (contracts/canonical/*.json): every `required` field present, enum
 *    fields inside the schema enum
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  slugSegment,
  UNS_V2_UNASSIGNED,
  buildEquipmentTopicV2,
  buildLineAggregateTopicV2,
  buildAreaAggregateTopicV2,
  buildSiteAggregateTopicV2,
  isa95PathString,
  assetUrn,
  classifyAviAspect,
  aspectPublishOptions,
  toCanonicalState,
  normalizeEventSeverity,
  parseAviLikeTopic,
  buildTelemetryPayloadV2,
  buildStateSnapshotV2,
  buildEventPayloadV2,
  buildHealthPayloadV2,
  extractScalarMetrics,
  isUnsTopicV2Enabled,
  type Isa95PathV2,
} from "./topicV2";

const PATH: Isa95PathV2 = {
  site: "hanoi",
  area: "assy",
  line: "line1",
  cell: "cell3",
  equipment: "screw01",
};

// ── canonical schema files (seeded in W0 / G2.5) ──────────────────────────────
const CANONICAL_DIR = resolve(__dirname, "../../../contracts/canonical");
function loadSchema(name: string): any {
  return JSON.parse(readFileSync(resolve(CANONICAL_DIR, name), "utf8"));
}
/** Assert `payload` has every schema-required field + respects enum fields. */
function expectMatchesSchema(payload: Record<string, unknown>, schema: any): void {
  for (const req of schema.required as string[]) {
    expect(payload, `required field '${req}' missing`).toHaveProperty(req);
    expect(payload[req], `required field '${req}' must not be undefined/null`).not.toBeNull();
  }
  for (const [key, prop] of Object.entries<any>(schema.properties ?? {})) {
    if (prop.enum && key in payload && payload[key] != null) {
      expect(prop.enum, `field '${key}' value '${payload[key]}' not in schema enum`).toContain(
        payload[key],
      );
    }
  }
}

describe("G2.1 — slugSegment (LDS-L2 §4.2 naming rules)", () => {
  it("lowercases and strips Vietnamese diacritics (đ→d)", () => {
    expect(slugSegment("Xưởng Lắp Ráp 1")).toBe("xuong-lap-rap-1");
    expect(slugSegment("Đường Chuyền Á 2")).toBe("duong-chuyen-a-2");
    expect(slugSegment("LINE1")).toBe("line1");
  });

  it("collapses non-alphanumerics to single dashes and trims", () => {
    expect(slugSegment("  A -- B__C  ")).toBe("a-b-c");
    expect(slugSegment("F1/W2#L3+X")).toBe("f1-w2-l3-x"); // MQTT specials never leak
  });

  it("empty/null → honest 'unassigned' fallback (never fabricated)", () => {
    expect(slugSegment("")).toBe(UNS_V2_UNASSIGNED);
    expect(slugSegment("   ")).toBe(UNS_V2_UNASSIGNED);
    expect(slugSegment(null)).toBe(UNS_V2_UNASSIGNED);
    expect(slugSegment(undefined, "fallback-x")).toBe("fallback-x");
    expect(slugSegment("###")).toBe(UNS_V2_UNASSIGNED);
  });
});

describe("G2.1 — topic grammar (LDS-L1 §9.1)", () => {
  it("equipment topic: syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}", () => {
    expect(buildEquipmentTopicV2(PATH, "telemetry")).toBe("syn/hanoi/assy/line1/cell3/screw01/telemetry");
    expect(buildEquipmentTopicV2(PATH, "state")).toBe("syn/hanoi/assy/line1/cell3/screw01/state");
    expect(buildEquipmentTopicV2(PATH, "cmd_ack")).toBe("syn/hanoi/assy/line1/cell3/screw01/cmd_ack");
  });

  it("aggregate nodes: _line / _area / _site (LDS-L2 §4.1)", () => {
    expect(buildLineAggregateTopicV2({ site: "hanoi", area: "assy", line: "line1" }, "state")).toBe(
      "syn/hanoi/assy/line1/_line/state",
    );
    expect(buildAreaAggregateTopicV2({ site: "hanoi", area: "assy" }, "state")).toBe(
      "syn/hanoi/assy/_area/state",
    );
    expect(buildSiteAggregateTopicV2("hanoi", "state")).toBe("syn/hanoi/_site/state");
  });

  it("path string + asset URN (LDS-L1 §6.2)", () => {
    expect(isa95PathString(PATH)).toBe("hanoi/assy/line1/cell3/screw01");
    expect(assetUrn(PATH)).toBe("urn:syn:asset:hanoi:line1:cell3:screw01");
  });

  it("root is env-tunable but defaults to spec 'syn'", () => {
    expect(buildSiteAggregateTopicV2("s", "health").startsWith("syn/")).toBe(true);
  });
});

describe("G2.1 — aspect classification + QoS/retain (LDS-L1 §9.3)", () => {
  it("classifies legacy avi message types", () => {
    expect(classifyAviAspect("errors")).toBe("events");
    expect(classifyAviAspect("heartbeat")).toBe("health");
    expect(classifyAviAspect("status")).toBe("state");
    expect(classifyAviAspect("inspection")).toBe("telemetry");
    expect(classifyAviAspect("summary/daily")).toBe("telemetry");
  });

  it("state/health retained QoS1; events/cmd_ack QoS1; telemetry QoS0", () => {
    expect(aspectPublishOptions("state")).toEqual({ qos: 1, retain: true });
    expect(aspectPublishOptions("health")).toEqual({ qos: 1, retain: true });
    expect(aspectPublishOptions("events")).toEqual({ qos: 1, retain: false });
    expect(aspectPublishOptions("cmd_ack")).toEqual({ qos: 1, retain: false });
    expect(aspectPublishOptions("telemetry")).toEqual({ qos: 0, retain: false });
  });

  it("parses both avi/{fid}/... and avi/factory/{fid}/... legacy topics", () => {
    const a = parseAviLikeTopic("avi/1/workshop/2/station/3/errors");
    const b = parseAviLikeTopic("avi/factory/1/workshop/2/station/3/errors");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.stationId).toBe("3");
    expect(parseAviLikeTopic("some/other/topic")).toBeNull();
  });
});

describe("G2.1 — canonical state / severity normalization", () => {
  it("maps known labels to the canonical enum (LDS-L1 §8.7)", () => {
    expect(toCanonicalState("running")).toBe("EXECUTE");
    expect(toCanonicalState("idle")).toBe("IDLE");
    expect(toCanonicalState("error")).toBe("FAULTED");
    expect(toCanonicalState("maintenance")).toBe("MAINTENANCE");
    expect(toCanonicalState("offline")).toBe("OFFLINE");
    expect(toCanonicalState("held")).toBe("HELD");
  });

  it("unknown labels pass through UPPERCASED (honest — never coerced)", () => {
    expect(toCanonicalState("warming-up")).toBe("WARMING-UP");
    expect(toCanonicalState("")).toBe("UNKNOWN");
  });

  it("severity synonyms map into the canonical enum; unknown → fallback", () => {
    expect(normalizeEventSeverity("low")).toBe("info");
    expect(normalizeEventSeverity("medium")).toBe("warning");
    expect(normalizeEventSeverity("high")).toBe("error");
    expect(normalizeEventSeverity("critical")).toBe("critical");
    expect(normalizeEventSeverity("???", "error")).toBe("error");
  });
});

describe("G2.5 shape — built payloads match contracts/canonical/*.json", () => {
  it("telemetry {asset_id, ts, seq, metrics[]}", () => {
    const schema = loadSchema("telemetry.schema.json");
    const p = buildTelemetryPayloadV2({
      path: PATH,
      ts: "2026-07-12T00:00:00.000Z",
      seq: 7,
      metrics: [{ name: "screw.torque", value: 1.82, quality: "good", ts: "2026-07-12T00:00:00.000Z" }],
    });
    expectMatchesSchema(p, schema);
    // metric items required fields + quality enum
    const itemSchema = schema.properties.metrics.items;
    for (const m of p.metrics) expectMatchesSchema(m as any, itemSchema);
    expect(p.asset_id).toBe("urn:syn:asset:hanoi:line1:cell3:screw01");
    expect(p.seq).toBe(7);
  });

  it("state {path, ts, state} (+values/health)", () => {
    const schema = loadSchema("state.schema.json");
    const p = buildStateSnapshotV2({
      path: PATH,
      ts: "2026-07-12T00:00:00.000Z",
      state: "EXECUTE",
      values: { "screw.torque": 1.82 },
      health: "online",
    });
    expectMatchesSchema(p, schema);
    expect(p.path).toBe("hanoi/assy/line1/cell3/screw01");
  });

  it("event {event_id, asset_id, type, severity, ts} with enum-valid type/severity", () => {
    const schema = loadSchema("event.schema.json");
    const p = buildEventPayloadV2({
      path: PATH,
      type: "fault",
      severity: "error",
      ts: "2026-07-12T00:00:00.000Z",
      cause: "E42: solder bridge",
      payload: { inspectionId: 9 },
    });
    expectMatchesSchema(p, schema);
    expect(p.event_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("health {asset_id, status, last_seen} with enum-valid status", () => {
    const schema = loadSchema("health.schema.json");
    const p = buildHealthPayloadV2({
      path: PATH,
      status: "online",
      lastSeen: "2026-07-12T00:00:00.000Z",
      latencyMs: 42,
    });
    expectMatchesSchema(p, schema);
  });
});

describe("extractScalarMetrics", () => {
  it("extracts top-level scalars only (objects/arrays skipped), bounded", () => {
    const metrics = extractScalarMetrics({
      totalNG: 3,
      ok: true,
      name: "abc",
      nested: { x: 1 },
      arr: [1, 2],
      nul: null,
    });
    expect(metrics.map((m) => m.name).sort()).toEqual(["name", "ok", "totalNG"]);
  });

  it("non-object payloads → []", () => {
    expect(extractScalarMetrics("str")).toEqual([]);
    expect(extractScalarMetrics(null)).toEqual([]);
    expect(extractScalarMetrics([1, 2])).toEqual([]);
  });
});

describe("flag gate", () => {
  it("UNS_TOPIC_V2_ENABLED default OFF", () => {
    delete process.env.UNS_TOPIC_V2_ENABLED;
    expect(isUnsTopicV2Enabled()).toBe(false);
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    expect(isUnsTopicV2Enabled()).toBe(true);
    delete process.env.UNS_TOPIC_V2_ENABLED;
  });
});
