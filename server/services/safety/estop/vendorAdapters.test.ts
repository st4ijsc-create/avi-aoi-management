/**
 * T-3 (doc 38 R-3) — tests for the Safety-PLC VENDOR skeleton adapters.
 *
 * The central invariant: a SKELETON is NEVER safety-rated and NEVER actuates.
 * These tests pin that honesty contract so a future edit cannot silently make a
 * skeleton claim rated:true / actuated:true.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  PilzPnozMultiAdapter,
  SickFlexiSoftAdapter,
  createVendorAdapter,
  registerVendorAdapter,
  type SafetyPlcVendorAdapter,
} from "./vendorAdapters";
import {
  getSafetyPlcAdapter,
  resetSafetyPlcAdapter,
  NullSafetyPlcAdapter,
  requestEmergencyStop,
} from "./safetyEstopAdapter";

afterEach(() => {
  resetSafetyPlcAdapter();
  delete process.env.SAFETY_ESTOP_ADAPTER_ENABLED;
});

describe("vendor skeleton adapters — honesty invariant", () => {
  const each: Array<[string, SafetyPlcVendorAdapter]> = [
    ["pilz", new PilzPnozMultiAdapter()],
    ["sick", new SickFlexiSoftAdapter()],
  ];

  it.each(each)("%s: isRated()=false, label states NOT safety-rated", (_v, a) => {
    expect(a.isRated()).toBe(false);
    expect(a.label()).toMatch(/not safety-rated/i);
  });

  it.each(each)("%s: triggerEmergencyStop() does NOT actuate", async (_v, a) => {
    const r = await a.triggerEmergencyStop({ machineId: 3, reason: "unit" });
    expect(r.actuated).toBe(false);
    expect(r.rated).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/software interlock/i);
  });

  it.each(each)("%s: selfTest() rated:false, ok:false, rated-hardware check fails", async (_v, a) => {
    const t = await a.selfTest();
    expect(t.rated).toBe(false);
    expect(t.ok).toBe(false);
    const ratedCheck = t.checks.find((c) => c.name === "rated-hardware-certified");
    expect(ratedCheck?.pass).toBe(false);
  });

  it.each(each)("%s: reads never fabricate — no endpoint → quality unknown", async (_v, a) => {
    const e = await a.readEstopState();
    expect(e.quality).toBe("unknown");
    expect(e.active).toBeUndefined();
    const z = await a.readZoneState({ zoneId: 5 });
    expect(z.quality).toBe("unknown");
  });

  it("default protocols: Pilz=modbus, Sick=ethernet-ip", () => {
    expect(new PilzPnozMultiAdapter().label()).toMatch(/no endpoint/);
    expect(createVendorAdapter("pilz").vendor).toBe("pilz");
    expect(createVendorAdapter("sick").vendor).toBe("sick");
  });
});

describe("registerVendorAdapter — registering a skeleton does not arm a rated stop", () => {
  it("registers into the estop registry but stays non-rated / non-actuating", async () => {
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "true";
    const prev = registerVendorAdapter(new PilzPnozMultiAdapter());
    expect(prev).toBeInstanceOf(NullSafetyPlcAdapter);
    expect(getSafetyPlcAdapter().isRated()).toBe(false);

    // Even flag-ON + skeleton registered → the entry does not actuate.
    const r = await requestEmergencyStop({ machineId: 1 });
    expect(r.enabled).toBe(true);
    expect(r.actuated).toBe(false);
    expect(r.rated).toBe(false);
  });
});
