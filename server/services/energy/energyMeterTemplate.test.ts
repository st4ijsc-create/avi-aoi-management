/**
 * doc 40 W5 (MTX-09) — energy-meter Modbus template tests (vitest, pure — no I/O).
 *
 * Validates that every template is SELF-CONSISTENT and cements the reuse contract:
 *   • each register's Modbus address actually parses via the REAL parseModbusAddress
 *     (so the existing modbusDriver can read it — no new driver),
 *   • each energy tagKey is a metric the telemetry→energy tap whitelists,
 *   • the adapter plan is shaped for a protocol='modbus' device_adapter.
 */
import { describe, it, expect } from "vitest";
import {
  listEnergyMeterTemplates,
  getEnergyMeterTemplate,
  toOtTagAddresses,
  buildEnergyMeterAdapterPlan,
  isEnergyIngestMetric,
  ENERGY_INGEST_METRICS,
} from "./energyMeterTemplate";
import { parseModbusAddress } from "../ot/drivers/modbusDecode";

describe("energy meter templates", () => {
  it("ships the expected templates, all honestly marked", () => {
    const all = listEnergyMeterTemplates();
    expect(all.map((t) => t.id).sort()).toEqual(
      ["generic-iec-float", "schneider-pm5000", "selec-mfm384"].sort(),
    );
    // No template falsely claims spec-verified without a real register-list check.
    for (const t of all) expect(t.validationStatus).toBe("assumed");
  });

  it("every register address parses via the real modbus address parser", () => {
    for (const t of listEnergyMeterTemplates()) {
      for (const r of t.registers) {
        expect(() => parseModbusAddress(r.address), `${t.id}:${r.metric} (${r.address})`).not.toThrow();
      }
    }
  });

  it("every template maps at least power_kw + energy_kwh to whitelisted metrics", () => {
    for (const t of listEnergyMeterTemplates()) {
      const metrics = t.registers.map((r) => r.metric);
      expect(metrics).toContain("power_kw");
      expect(metrics).toContain("energy_kwh");
      for (const m of metrics) expect(isEnergyIngestMetric(m)).toBe(true);
    }
  });

  it("toOtTagAddresses uses metric as tagKey (so ot_telemetry.metric matches the tap)", () => {
    const tags = toOtTagAddresses("schneider-pm5000");
    const keys = tags.map((t) => t.tagKey);
    expect(keys).toContain("power_kw");
    expect(keys).toContain("energy_kwh");
    // Every tag key is a whitelisted energy metric → auto-mirrors into energy_readings.
    for (const t of tags) {
      expect((ENERGY_INGEST_METRICS as readonly string[]).includes(t.tagKey)).toBe(true);
      expect(t.dataType).toBe("float");
    }
  });

  it("buildEnergyMeterAdapterPlan yields a protocol='modbus' plan reusing the OT driver", () => {
    const plan = buildEnergyMeterAdapterPlan("10.0.0.42", "selec-mfm384", { unitId: 5 });
    expect(plan.adapter.protocol).toBe("modbus");
    expect(plan.adapter.endpoint).toBe("tcp://10.0.0.42:502");
    expect(plan.adapter.unitId).toBe(5);
    expect(plan.adapter.kind).toBe("energy_meter");
    expect(plan.tags.length).toBeGreaterThan(0);
  });

  it("unknown template ids fail loud", () => {
    expect(getEnergyMeterTemplate("nope")).toBeUndefined();
    expect(() => toOtTagAddresses("nope")).toThrow(/unknown energy meter template/);
    expect(() => buildEnergyMeterAdapterPlan("h", "nope")).toThrow(/unknown energy meter template/);
  });
});
