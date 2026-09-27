/**
 * doc 80 Đợt 1 Task 4 (SAF-02) — `computeSafetySourceHealth` (THUẦN): ảnh chụp cờ + cấu hình
 * ⇒ báo cáo nguồn an toàn. Kiểm ngữ nghĩa phải KHỚP adapterFacade.getSafetyStatus (nhánh
 * safety-PLC) và safetyPreflightPolicy — bản đối chiếu với HÀNH VI THẬT nằm ở
 * `server/routers/safetySourceHealth.dot1.db.test.ts` và ở khối "oracle backendForConfig" dưới đây.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Oracle độc lập cho Fix round 1 #1: driver OT GIẢ đếm số lần connect — để đo backend THẬT
// (`backendForConfig(cfg).read()`) có thực sự đọc thiết bị hay không.
const drv = vi.hoisted(() => ({ connects: 0 }));
vi.mock("../ot/driverRegistry", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ot/driverRegistry")>();
  return {
    ...orig,
    createDriver: () => ({
      connect: async () => { drv.connects += 1; },
      disconnect: async () => {},
      readTags: async (tags: Array<{ tagKey: string }>) =>
        tags.map((t) => ({ tagKey: t.tagKey, value: false, quality: "good", timestamp: new Date() })),
    }),
  };
});

import { computeSafetySourceHealth, effectiveBackend, type SourceHealthSnapshot, type PlcConfigLite } from "./safetySourceHealth";
import { backendForConfig, statusToFindings } from "./plc/safetyPlcAdapter";
import type { SafetyPlcConfig } from "../../../drizzle/schema";

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
    estop: { kind: "null", label: "null (scaffold — KHÔNG safety-rated)", rated: false },
    socketServerUp: true,
    ...over,
  };
}
const SIM_CFG: PlcConfigLite = { id: 1, code: "SIM-SAFETY-PLC-1", backend: "sim", endpoint: null, statusMap: null, factoryId: 1, scope: "sim" };
const SIM_SCRIPTED: PlcConfigLite = { id: 4, code: "SIM-SCRIPT", backend: "sim", endpoint: null, statusMap: { simScript: [{}, { estop: true }] }, factoryId: 1, scope: "sim" };
const REAL_CFG: PlcConfigLite = {
  id: 2, code: "PLC-L1", backend: "modbus", endpoint: "tcp://10.0.0.5:502",
  statusMap: { estop: { address: "40001" } }, factoryId: 2, scope: null,
};
const REAL_UNMAPPED: PlcConfigLite = { id: 5, code: "PLC-L3", backend: "modbus", endpoint: "tcp://10.0.0.6:502", statusMap: {}, factoryId: 2, scope: null };
const REAL_NO_EP: PlcConfigLite = { id: 3, code: "PLC-L2", backend: "opcua", endpoint: null, statusMap: { estop: { address: "ns=2;s=E" } }, factoryId: 2, scope: null };

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

  it("modbus/opcua KHÔNG endpoint rơi về SIM kịch bản RỖNG (mirror backendForConfig)", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [REAL_NO_EP] }));
    expect(h.safetyPlc.basis).toBe("sim");
    expect(h.safetyPlc.configs[0]).toMatchObject({ code: "PLC-L2", backend: "opcua", effective: "sim_empty" });
  });

  it("chỉ cấu hình thật CÓ ánh xạ tag ⇒ real_basis", () => {
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

// ── Fix round 1 #1 — endpoint thật mà KHÔNG ánh xạ tag an toàn nào ⇒ OK dựa trên KHÔNG GÌ ──
describe("Fix round 1 #1 — real_unmapped", () => {
  it("modbus có endpoint, statusMap không có địa chỉ nào ⇒ real_unmapped (không phải real)", () => {
    expect(effectiveBackend(REAL_UNMAPPED)).toBe("real_unmapped");
    expect(effectiveBackend({ ...REAL_UNMAPPED, statusMap: null })).toBe("real_unmapped");
    expect(effectiveBackend({ ...REAL_UNMAPPED, statusMap: { estop: {} } })).toBe("real_unmapped");
    expect(effectiveBackend({ ...REAL_UNMAPPED, statusMap: { muting: { address: "10002" } } })).toBe("real");
  });

  it("chỉ cấu hình unmapped ⇒ basis real_unmapped, verdict unmapped_basis (rủi ro, không chặn)", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [REAL_UNMAPPED] }));
    expect(h.safetyPlc.basis).toBe("real_unmapped");
    expect(h.safetyPlc.realConfigs).toBe(0);
    expect(h.safetyPlc.realUnmappedConfigs).toBe(1);
    expect(h.preflight.expectedReading).toBe("UNMAPPED");
    expect(h.preflight.ot.realWrites).toBe("unmapped_basis");
    expect(h.preflight.ot.refusalReason).toBeNull();
  });

  it("thật (có tag) + unmapped ⇒ mixed / sim_can_satisfy (cấu hình không đọc gì cũng đủ cho OK)", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [REAL_CFG, REAL_UNMAPPED] }));
    expect(h.safetyPlc.basis).toBe("mixed");
    expect(h.preflight.robot.realWrites).toBe("sim_can_satisfy");
  });

  describe("ORACLE: backendForConfig(cfg).read() THẬT với driver đếm connect", () => {
    beforeEach(() => { drv.connects = 0; });
    const asRow = (c: PlcConfigLite) => ({ ...c, name: c.code, vendor: "generic", enabled: true }) as unknown as SafetyPlcConfig;

    it("unmapped: backend thật trả {} KHÔNG connect ⇒ 0 finding ⇒ facade OK — đúng lý do nhãn real_unmapped", async () => {
      const snapRead = await backendForConfig(asRow(REAL_UNMAPPED)).read();
      expect(snapRead).toEqual({});
      expect(statusToFindings(snapRead)).toEqual([]);
      expect(drv.connects).toBe(0);
      expect(effectiveBackend(REAL_UNMAPPED)).toBe("real_unmapped");
    });

    it("có ánh xạ: backend thật CÓ connect + đọc tag ⇒ nhãn real", async () => {
      await backendForConfig(asRow(REAL_CFG)).read();
      expect(drv.connects).toBe(1);
      expect(effectiveBackend(REAL_CFG)).toBe("real");
    });
  });
});

// ── Fix round 1 #4 — SIM kịch bản rỗng (luôn OK) ≠ SIM có kịch bản ─────────────────────────
describe("Fix round 1 #4 — sim_empty vs sim_scripted", () => {
  it("phân loại theo statusMap.simScript (mirror backendForConfig)", () => {
    expect(effectiveBackend(SIM_CFG)).toBe("sim_empty");
    expect(effectiveBackend(SIM_SCRIPTED)).toBe("sim_scripted");
    expect(effectiveBackend({ ...SIM_CFG, statusMap: { simScript: [] } })).toBe("sim_empty");
    // modbus/opcua KHÔNG endpoint ⇒ backendForConfig dựng SimSafetyPlcBackend([]) — BỎ QUA simScript.
    expect(effectiveBackend({ ...REAL_NO_EP, statusMap: { simScript: [{ estop: true }] } })).toBe("sim_empty");
  });
  it("đếm tách bạch trong báo cáo", () => {
    const h = computeSafetySourceHealth(snap({ plcConfigsEnabled: [SIM_CFG, SIM_SCRIPTED] }));
    expect(h.safetyPlc.basis).toBe("sim");
    expect(h.safetyPlc.simConfigs).toBe(2);
    expect(h.safetyPlc.simScriptedConfigs).toBe(1);
    expect(h.safetyPlc.configs.map((c) => c.effective)).toEqual(["sim_empty", "sim_scripted"]);
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
  it("Fix round 1 #3: nhãn e-stop bị GỠ endpoint; không còn trường reachable", () => {
    const h = computeSafetySourceHealth(
      snap({ estop: { kind: "pilz-pnozmulti", label: "pilz skeleton (modbus @ tcp://10.9.9.9:502) — NOT safety-rated", rated: false } }),
    );
    expect(JSON.stringify(h)).not.toContain("10.9.9.9");
    expect(h.estop.label).toContain("pilz skeleton");
    expect(h.estop).not.toHaveProperty("reachable");
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

// Doc 80 Đợt 1 final wave (item 5) — cờ bảng nguồn an toàn == vị từ của cổng thật, lật từng biến.
// Trước final wave `robotControl` là bản parse riêng (`process.env.ROBOT_CONTROL_ENABLED === "true"`) —
// hôm nay khớp, nhưng là hai chỗ có thể trôi. Nay `docCoDangBat()` gọi thẳng `isRobotControlEnabled()`.
import { afterEach } from "vitest";
import { docCoDangBat } from "./safetySourceHealth";
import { isOtControlEnabled } from "../ot/commandDispatcher";
import { isRobotControlEnabled } from "../robot/robotCommandDispatcher";
import { isOtSafetyPreflightEnabled, isRobotSafetyPreflightEnabled } from "../ot/safetyPreflightPolicy";

describe("final wave item 5 — docCoDangBat() == cổng thật cho MỌI giá trị env", () => {
  const CO = [
    { env: "ROBOT_CONTROL_ENABLED", o: "robotControl", cong: isRobotControlEnabled },
    { env: "OT_CONTROL_ENABLED", o: "otControl", cong: isOtControlEnabled },
    { env: "OT_SAFETY_PREFLIGHT_ENABLED", o: "otPreflight", cong: isOtSafetyPreflightEnabled },
    { env: "ROBOT_SAFETY_PREFLIGHT_ENABLED", o: "robotPreflight", cong: isRobotSafetyPreflightEnabled },
  ] as const;
  const GIA_TRI = ["true", "1", "TRUE", "yes", "false", "0", "", undefined] as const;
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => { for (const c of CO) { savedEnv[c.env] = process.env[c.env]; delete process.env[c.env]; } });
  afterEach(() => {
    for (const c of CO) {
      if (savedEnv[c.env] === undefined) delete process.env[c.env];
      else process.env[c.env] = savedEnv[c.env];
    }
  });

  for (const c of CO) {
    it(`${c.env}: bảng == cổng qua ${GIA_TRI.length} giá trị`, () => {
      const lech: string[] = [];
      let soBat = 0;
      for (const v of GIA_TRI) {
        if (v === undefined) delete process.env[c.env];
        else process.env[c.env] = v;
        const cong = c.cong();
        const bang = docCoDangBat()[c.o];
        if (cong) soBat++;
        if (bang !== cong) lech.push(`${c.env}=${JSON.stringify(v)}: bảng=${bang} cổng=${cong}`);
      }
      expect(lech).toEqual([]);
      expect(soBat, "vị từ không bật lần nào trong dãy ⇒ phép so vô nghĩa (tên biến env sai?)").toBeGreaterThan(0);
    });
  }
});
