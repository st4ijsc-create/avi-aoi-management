/**
 * Doc 24 / Connectivity — unsMappingService PURE tests.
 *
 * Covers: value transforms (rename/scale/offset/cast) applied deterministically,
 * the deadband gate (suppresses sub-threshold changes), topic templating, the
 * publish DECISION (mapped vs default), the stateful deadband consult, and the
 * live preview. All DB-free.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyValueTransform,
  passesDeadband,
  renderUnsTopic,
  effectiveMetricName,
  sparkplugTypeFor,
  decideMappedPublish,
  applyMappingForPublish,
  previewMapping,
  __resetDeadbandStoreForTest,
  type ResolvedMapping,
  type MappedPublishCtx,
} from "./unsMappingService";

const mapping = (over: Partial<ResolvedMapping> = {}): ResolvedMapping => ({
  id: 1,
  adapterId: 1,
  tag: "t",
  unsTopic: "ENT/{adapterCode}/{tag}",
  sparkplugMetric: null,
  transform: null,
  enabled: true,
  ...over,
});

const ctx = (over: Partial<MappedPublishCtx> = {}): MappedPublishCtx => ({
  adapterId: 1,
  adapterCode: "A1",
  tag: "t",
  machineId: 5,
  rawValue: 10,
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
  quality: "good",
  dataType: "float",
  ...over,
});

describe("applyValueTransform", () => {
  it("scale then offset (numeric)", () => {
    expect(applyValueTransform(10, { scale: 2, offset: 5 })).toBe(25);
  });
  it("numeric string is coerced before scaling", () => {
    expect(applyValueTransform("10", { scale: 2 })).toBe(20);
  });
  it("cast → number / bool / string", () => {
    expect(applyValueTransform("5", { cast: "number" })).toBe(5);
    expect(applyValueTransform(1, { cast: "bool" })).toBe(true);
    expect(applyValueTransform(0, { cast: "bool" })).toBe(false);
    expect(applyValueTransform("on", { cast: "bool" })).toBe(true);
    expect(applyValueTransform(23.5, { cast: "string" })).toBe("23.5");
  });
  it("scale+offset+cast compose (scale first, then cast)", () => {
    // (0*2+0.5) = 0.5 → bool true (non-zero)
    expect(applyValueTransform(0, { scale: 2, offset: 0.5, cast: "bool" })).toBe(true);
  });
  it("rename does NOT change the value", () => {
    expect(applyValueTransform(7, { rename: "renamed" })).toBe(7);
  });
  it("no transform → pass-through scalar", () => {
    expect(applyValueTransform(42)).toBe(42);
    expect(applyValueTransform(true)).toBe(true);
    expect(applyValueTransform("hi")).toBe("hi");
  });
});

describe("passesDeadband", () => {
  it("no deadband → always publishes", () => {
    expect(passesDeadband(5, 5.0001, 0)).toBe(true);
    expect(passesDeadband(5, 5.0001, undefined)).toBe(true);
  });
  it("first sample always publishes", () => {
    expect(passesDeadband(undefined, 5, 1)).toBe(true);
    expect(passesDeadband(null, 5, 1)).toBe(true);
  });
  it("suppresses a sub-threshold change; passes at/above threshold", () => {
    expect(passesDeadband(5, 5.5, 1)).toBe(false); // |0.5| < 1
    expect(passesDeadband(5, 6, 1)).toBe(true); //   |1|  ≥ 1
    expect(passesDeadband(5, 4, 1)).toBe(true); //   |1|  ≥ 1
  });
  it("non-numeric → publishes only on change", () => {
    expect(passesDeadband("a", "a", 1)).toBe(false);
    expect(passesDeadband("a", "b", 1)).toBe(true);
  });
});

describe("renderUnsTopic + naming", () => {
  it("expands placeholders", () => {
    expect(
      renderUnsTopic("{enterprise}/{adapterCode}/{machineId}/{rename}", {
        adapterCode: "A1",
        tag: "t",
        machineId: 5,
        rename: "temp",
      }),
    ).toBe("AVI-AOI/A1/5/temp");
  });
  it("rename falls back to tag when unset", () => {
    expect(renderUnsTopic("{rename}", { adapterCode: "A1", tag: "t", machineId: null })).toBe("t");
  });
  it("effectiveMetricName: sparkplugMetric → rename → tag", () => {
    expect(effectiveMetricName(mapping({ sparkplugMetric: "M" }), "t")).toBe("M");
    expect(effectiveMetricName(mapping({ transform: { rename: "R" } }), "t")).toBe("R");
    expect(effectiveMetricName(mapping(), "t")).toBe("t");
  });
  it("sparkplugTypeFor honours cast, then dataType, then typeof", () => {
    expect(sparkplugTypeFor("bool", "float", 1)).toBe("Boolean");
    expect(sparkplugTypeFor(undefined, "int", 1)).toBe("Int64");
    expect(sparkplugTypeFor(undefined, undefined, "x")).toBe("String");
  });
});

describe("decideMappedPublish", () => {
  it("no mapping → default (caller keeps today's normalization)", () => {
    expect(decideMappedPublish(null, ctx(), { sparkplugEnabled: false }).decision.kind).toBe("default");
  });
  it("disabled mapping → default", () => {
    expect(decideMappedPublish(mapping({ enabled: false }), ctx(), { sparkplugEnabled: false }).decision.kind).toBe("default");
  });
  it("normalized: mapped topic + transformed value", () => {
    const { decision } = decideMappedPublish(
      mapping({ unsTopic: "E/{adapterCode}/{rename}", transform: { rename: "temperature", scale: 2, offset: 1, unit: "C" } }),
      ctx({ rawValue: 10 }),
      { sparkplugEnabled: false },
    );
    expect(decision.kind).toBe("normalized");
    if (decision.kind === "normalized") {
      expect(decision.topic).toBe("E/A1/temperature");
      expect(decision.value).toBe(21);
      expect(decision.metric).toBe("temperature");
      expect(decision.payload).toMatchObject({ metric: "temperature", value: 21, unit: "C", tag: "t" });
    }
  });
  it("sparkplug: mapped metric name + transformed value", () => {
    const { decision } = decideMappedPublish(
      mapping({ sparkplugMetric: "Temp", transform: { scale: 0.1 } }),
      ctx({ rawValue: 250 }),
      { sparkplugEnabled: true },
    );
    expect(decision.kind).toBe("sparkplug");
    if (decision.kind === "sparkplug") {
      expect(decision.deviceId).toBe("A1");
      expect(decision.metric).toMatchObject({ name: "Temp", value: 25, type: "Double" });
    }
  });
  it("deadband suppresses when lastValue close", () => {
    const { decision } = decideMappedPublish(
      mapping({ transform: { deadband: 1 } }),
      ctx({ rawValue: 5.4 }),
      { sparkplugEnabled: false, lastValue: 5 },
    );
    expect(decision.kind).toBe("suppress");
  });
});

describe("applyMappingForPublish (stateful deadband)", () => {
  beforeEach(() => __resetDeadbandStoreForTest());

  it("first publishes; a sub-threshold follow-up is suppressed; a large change publishes again", () => {
    const m = mapping({ transform: { deadband: 1 } });
    const d1 = applyMappingForPublish(m, ctx({ rawValue: 5 }), { sparkplugEnabled: false });
    expect(d1.kind).toBe("normalized"); // first sample always publishes

    const d2 = applyMappingForPublish(m, ctx({ rawValue: 5.5 }), { sparkplugEnabled: false });
    expect(d2.kind).toBe("suppress"); // |5.5-5| < 1

    const d3 = applyMappingForPublish(m, ctx({ rawValue: 7 }), { sparkplugEnabled: false });
    expect(d3.kind).toBe("normalized"); // |7-5| ≥ 1 (baseline stayed at last PUBLISHED=5)
  });
});

describe("previewMapping", () => {
  it("shows resulting topic, metric, transformed value + willPublish", () => {
    const p = previewMapping(
      mapping({ unsTopic: "E/{adapterCode}/{tag}", transform: { scale: 2, unit: "C" } }),
      21,
      { adapterCode: "A1" },
    );
    expect(p.unsTopic).toBe("E/A1/t");
    expect(p.transformedValue).toBe(42);
    expect(p.unit).toBe("C");
    expect(p.willPublish).toBe(true);
  });
  it("willPublish=false when deadband suppresses vs a provided prevValue", () => {
    const p = previewMapping(mapping({ transform: { deadband: 5 } }), 21, { prevValue: 20 });
    expect(p.willPublish).toBe(false);
    expect(p.note).toBeTruthy();
  });
});
