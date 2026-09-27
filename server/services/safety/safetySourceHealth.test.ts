/**
 * doc 80 Đợt 1 Task 4 (SAF-02) — `computeSafetySourceHealth` (THUẦN): ảnh chụp cờ + cấu hình
 * ⇒ báo cáo nguồn an toàn. Kiểm ngữ nghĩa phải KHỚP adapterFacade.getSafetyStatus (nhánh
 * safety-PLC) và safetyPreflightPolicy — bản đối chiếu với HÀNH VI THẬT nằm ở
 * `server/routers/safetySourceHealth.dot1.db.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { computeSafetySourceHealth, type SourceHealthSnapshot } from "./safetySourceHealth";

function snap(over: Partial<SourceHealthSnapshot> = {}): SourceHealthSnapshot {
  return {
    checkedAt: "2026-09-27T00:00:00.000Z",
    flags: {
      safetyPlcAdapter: true,
      otPreflight: true,
      robotPreflight: true,
      otControl: true,
      robotControl: true,
      safetyVision: false,
      safetyZoneSw: false,
      safetyEstopAdapter: false,
    },
    plcConfigsEnabled: [],
    plcRead: "ok",
    visibleFactoryIds: null,
    zones: [],
    calibrations: [],
    estop: { kind: "null", label: "null (scaffold)", rated: false, reachable: false },
    socketServerUp: true,
    ...over,
  };
}
const SIM_CFG = { id: 1, code: "SIM-SAFETY-PLC-1", backend: "sim", endpoint: null, factoryId: 1, scope: "sim" };
const REAL_CFG = { id: 2, code: "PLC-L1", backend: "modbus", endpoint: "tcp://10.0.0.5:502", factoryId: 2, scope: null };
const REAL_NO_EP = { id: 3, code: "PLC-L2", backend: "opcua", endpoint: null, factoryId: 2, scope: null };

describe("computeSafetySourceHealth — Safety PLC + preflight", () => {
  it("adapter TẮT ⇒ basis adapter_off, preflight đọc UNKNOWN ⇒ ghi/chuyển động thật BỊ CHẶN", () => {
    const h = computeSafetySourceHealth(snap({ flags: { ...snap().flags, safetyPlcAdapter: false }, plcConfigsEnabled: [SIM_CFG] }));
    expect(h.safetyPlc.basis).toBe("adapter_off");
    expect(h.preflight.expectedReading).toBe("UNKNOWN");
    expect(h.preflight.ot.realWrites).toBe("blocked");
    expect(h.preflight.robot.realWrites).toBe("blocked");
  });

  it("adapter BẬT, 0 cấu hình bật ⇒ no_config ⇒ bị chặn (SAFETY_UNKNOWN)", () => {
    const h = computeSafetySourceHealth(snap());
    expect(h.safetyPlc.basis).toBe("no_config");
    expect(h.preflight.ot.realWrites).toBe("blocked");
    expect(h.preflight.ot.refusalReason).toBe("SAFETY_UNKNOWN");
  });

  it("đọc cấu hình lỗi (DB) ⇒ read_error ⇒ bị chặn", () => {
    const h = computeSafetySourceHealth(snap({ plcRead: "error" }));
    expect(h.safetyPlc.basis).toBe("read_error");
    expect(h.preflight.robot.realWrites).toBe("blocked");
  });

  it("CHỈ cấu hình SIM (dev hôm nay) ⇒ basis sim: preflight lấy OK từ GIẢ LẬP ⇒ ghi thật KHÔNG bị chặn bởi preflight", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [SIM_CFG] }));
    expect(h.safetyPlc.basis).toBe("sim");
    expect(h.safetyPlc.simConfigs).toBe(1);
    expect(h.safetyPlc.realConfigs).toBe(0);
    expect(h.preflight.expectedReading).toBe("SIM");
    expect(h.preflight.ot.realWrites).toBe("sim_basis");
    expect(h.preflight.robot.realWrites).toBe("sim_basis");
    expect(h.preflight.ot.refusalReason).toBeNull();
  });

  it("modbus/opcua KHÔNG endpoint rơi về SIM (mirror backendForConfig)", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [REAL_NO_EP] }));
    expect(h.safetyPlc.basis).toBe("sim");
    expect(h.safetyPlc.configs[0]).toMatchObject({ code: "PLC-L2", backend: "opcua", effective: "sim" });
  });

  it("chỉ cấu hình thật ⇒ real_basis", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [REAL_CFG] }));
    expect(h.safetyPlc.basis).toBe("real");
    expect(h.preflight.ot.realWrites).toBe("real_basis");
  });

  it("thật + SIM ⇒ mixed: một cấu hình SIM đủ cho OK (anyOk) dù PLC thật không đọc được", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [REAL_CFG, SIM_CFG] }));
    expect(h.safetyPlc.basis).toBe("mixed");
    expect(h.preflight.ot.realWrites).toBe("sim_can_satisfy");
  });

  it("OT_CONTROL tắt ⇒ OT là dry_run (preflight không bao giờ được chạm); robot vẫn đánh giá riêng", () => {
    const h = computeSafetySourceHealth(snap({ flags: { ...snap().flags, otControl: false }, plcConfigsEnabled: [SIM_CFG] }));
    expect(h.preflight.ot.realWrites).toBe("dry_run");
    expect(h.preflight.robot.realWrites).toBe("sim_basis");
  });

  it("cờ preflight = tắt ⇒ unguarded (ghi thật không qua safety-PLC)", () => {
    const h = computeSafetySourceHealth(snap({ flags: { ...snap().flags, robotPreflight: false } }));
    expect(h.preflight.robot.realWrites).toBe("unguarded");
    expect(h.preflight.robot.flag).toBe("ROBOT_SAFETY_PREFLIGHT_ENABLED");
    expect(h.preflight.ot.flag).toBe("OT_SAFETY_PREFLIGHT_ENABLED");
  });

  it("phạm vi người xem: cấu hình ngoài nhà máy CHỈ được đếm, không lộ mã; số tổng vẫn là nền của preflight", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [SIM_CFG, REAL_CFG], visibleFactoryIds: [1] }));
    expect(h.safetyPlc.enabledConfigs).toBe(2);
    expect(h.safetyPlc.configs.map((c) => c.code)).toEqual(["SIM-SAFETY-PLC-1"]);
    expect(h.safetyPlc.hiddenConfigs).toBe(1);
    expect(JSON.stringify(h)).not.toContain("PLC-L1");
    expect(JSON.stringify(h)).not.toContain("10.0.0.5");
  });

  it("cấu hình mang nhãn nguồn (SIM-*/scope=sim ⇒ SIM)", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [SIM_CFG] }));
    expect(h.safetyPlc.configs[0].provenance).toBe("SIM");
  });
});

describe("computeSafetySourceHealth — vision / zone / e-stop / socket", () => {
  it("vision + zone tắt, 0 camera/zone; e-stop scaffold không rated; socket máy chủ", () => {
    const h = computeSafetySourceHealth(snap({ socketServerUp: false }));
    expect(h.vision).toEqual({ enabled: false, calibrations: 0, onnxPersonModelWired: false });
    expect(h.zoneSw).toEqual({ enabled: false, zones: 0 });
    expect(h.estop).toMatchObject({ enabled: false, rated: false, adapter: "null" });
    expect(h.socket).toEqual({ serverUp: false });
  });
  it("đếm zone/camera theo phạm vi (factoryId NULL không lộ cho người bị giới hạn)", () => {
    const h = computeSafetySourceHealth(
      snap({
        flags: { ...snap().flags, safetyZoneSw: true, safetyVision: true },
        zones: [{ factoryId: 1 }, { factoryId: 2 }, { factoryId: null }],
        calibrations: [{ factoryId: 1 }],
        visibleFactoryIds: [1],
      }),
    );
    expect(h.zoneSw).toEqual({ enabled: true, zones: 1 });
    expect(h.vision.calibrations).toBe(1);
  });
});
