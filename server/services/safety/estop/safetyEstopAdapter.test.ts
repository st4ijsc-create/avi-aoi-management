/**
 * W1-5 (doc 25 §T1) — test cho SCAFFOLD đường e-stop safety-rated độc lập.
 *
 * Bao phủ (skeleton, không nối HW thật):
 *   • Null adapter: isRated()=false; health() reachable:false; triggerEmergencyStop()
 *     KHÔNG actuate (actuated:false) — trung thực chưa có HW.
 *   • requestEmergencyStop flag OFF → no-op tuyệt đối (enabled:false).
 *   • requestEmergencyStop flag ON + Null adapter → enabled:true nhưng actuated:false.
 *   • requestEmergencyStop flag ON + MOCK rated adapter đã register → gọi adapter,
 *     trả rated:true/actuated:true.
 *   • adapter throw → trả message trung thực, KHÔNG throw ra caller.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  safetyEstopAdapterEnabled,
  NullSafetyPlcAdapter,
  registerSafetyPlcAdapter,
  getSafetyPlcAdapter,
  resetSafetyPlcAdapter,
  requestEmergencyStop,
  type SafetyPlcAdapter,
  type EstopTarget,
  type EstopResult,
} from "./safetyEstopAdapter";

beforeEach(() => {
  delete process.env.SAFETY_ESTOP_ADAPTER_ENABLED;
  resetSafetyPlcAdapter();
});
afterEach(() => {
  delete process.env.SAFETY_ESTOP_ADAPTER_ENABLED;
  resetSafetyPlcAdapter();
});

describe("safetyEstopAdapterEnabled (cờ)", () => {
  it("mặc định OFF; bật bằng 'true' hoặc '1'", () => {
    expect(safetyEstopAdapterEnabled()).toBe(false);
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "true";
    expect(safetyEstopAdapterEnabled()).toBe(true);
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "1";
    expect(safetyEstopAdapterEnabled()).toBe(true);
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "false";
    expect(safetyEstopAdapterEnabled()).toBe(false);
  });
});

describe("NullSafetyPlcAdapter (scaffold — KHÔNG safety-rated)", () => {
  it("isRated()=false và label nêu rõ scaffold", () => {
    const a = new NullSafetyPlcAdapter();
    expect(a.isRated()).toBe(false);
    expect(a.label()).toMatch(/scaffold/i);
  });

  it("health() báo reachable:false, rated:false — trung thực chưa có HW", async () => {
    const h = await new NullSafetyPlcAdapter().health();
    expect(h.reachable).toBe(false);
    expect(h.rated).toBe(false);
  });

  it("triggerEmergencyStop() KHÔNG actuate (actuated:false, rated:false)", async () => {
    const r = await new NullSafetyPlcAdapter().triggerEmergencyStop({ machineId: 7 });
    expect(r.actuated).toBe(false);
    expect(r.rated).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/software interlock/i);
  });

  it("registry mặc định là Null; register trả adapter trước đó; reset khôi phục Null", () => {
    expect(getSafetyPlcAdapter()).toBeInstanceOf(NullSafetyPlcAdapter);
    const fake: SafetyPlcAdapter = new NullSafetyPlcAdapter();
    const prev = registerSafetyPlcAdapter(fake);
    expect(prev).toBeInstanceOf(NullSafetyPlcAdapter);
    expect(getSafetyPlcAdapter()).toBe(fake);
    resetSafetyPlcAdapter();
    expect(getSafetyPlcAdapter()).toBeInstanceOf(NullSafetyPlcAdapter);
  });
});

describe("requestEmergencyStop (ENTRY)", () => {
  const target: EstopTarget = { machineId: 7, lineId: 1, reason: "test" };

  it("flag OFF → no-op tuyệt đối (enabled:false, không actuate)", async () => {
    const r = await requestEmergencyStop(target);
    expect(r.enabled).toBe(false);
    expect(r.actuated).toBe(false);
    expect(r.rated).toBe(false);
    expect(r.adapter).toBe("off");
  });

  it("flag ON + Null adapter → enabled:true nhưng actuated:false (chưa có HW)", async () => {
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "true";
    const r = await requestEmergencyStop(target);
    expect(r.enabled).toBe(true);
    expect(r.actuated).toBe(false);
    expect(r.rated).toBe(false);
  });

  it("flag ON + MOCK rated adapter → gọi adapter, actuated:true/rated:true", async () => {
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "true";
    let seen: EstopTarget | null = null;
    const mock: SafetyPlcAdapter = {
      kind: "mock-rated",
      isRated: () => true,
      async health() {
        return { reachable: true, rated: true, label: "mock rated" };
      },
      async triggerEmergencyStop(t: EstopTarget): Promise<EstopResult> {
        seen = t;
        return { ok: true, rated: true, actuated: true, adapter: "mock rated" };
      },
      label: () => "mock rated",
    };
    registerSafetyPlcAdapter(mock);
    const r = await requestEmergencyStop(target);
    expect(r.enabled).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.rated).toBe(true);
    expect(r.actuated).toBe(true);
    expect(seen).toEqual(target);
  });

  it("flag ON + adapter throw → message trung thực, KHÔNG throw ra caller", async () => {
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "true";
    const boom: SafetyPlcAdapter = {
      kind: "boom",
      isRated: () => true,
      async health() {
        return { reachable: false, rated: true, label: "boom" };
      },
      async triggerEmergencyStop(): Promise<EstopResult> {
        throw new Error("bus fault");
      },
      label: () => "boom",
    };
    registerSafetyPlcAdapter(boom);
    const r = await requestEmergencyStop(target);
    expect(r.enabled).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.actuated).toBe(false);
    expect(r.message).toMatch(/bus fault/);
  });
});
