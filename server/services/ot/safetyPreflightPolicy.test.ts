/**
 * doc 81 Đợt 1B final wave (item 3, final review Important #1) — MỘT chính sách preflight an toàn
 * cho cả hai dispatcher (OT + robot): cùng cách đọc cờ (chỉ đúng chuỗi "false" mới tắt, mặc định
 * BẬT), cùng từ vựng mã lý do (SAFETY_BLOCKED / SAFETY_UNKNOWN). Trước đây OT có cờ, robot không;
 * robot còn ghi chú sai rằng OT "cho UNKNOWN qua".
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  isOtSafetyPreflightEnabled,
  isRobotSafetyPreflightEnabled,
  safetyPreflightReason,
  SAFETY_PREFLIGHT_FLAGS,
} from "./safetyPreflightPolicy";
import { isSafetyPreflightEnabled } from "./commandDispatcher";

const KEYS = ["OT_SAFETY_PREFLIGHT_ENABLED", "ROBOT_SAFETY_PREFLIGHT_ENABLED"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe("safetyPreflightPolicy — hai cờ, một ngữ nghĩa", () => {
  it("tên cờ đúng như .env.example ghi", () => {
    expect(SAFETY_PREFLIGHT_FLAGS).toEqual({ ot: "OT_SAFETY_PREFLIGHT_ENABLED", robot: "ROBOT_SAFETY_PREFLIGHT_ENABLED" });
  });

  it.each([
    ["ot", isOtSafetyPreflightEnabled, "OT_SAFETY_PREFLIGHT_ENABLED"],
    ["robot", isRobotSafetyPreflightEnabled, "ROBOT_SAFETY_PREFLIGHT_ENABLED"],
  ] as const)("%s: mặc định BẬT; chỉ \"false\" tắt; \"0\"/\"off\"/\"FALSE\"/rỗng vẫn BẬT; cờ của bên kia không ảnh hưởng", (_side, read, key) => {
    for (const k of KEYS) delete process.env[k];
    expect(read()).toBe(true);
    process.env[key] = "false";
    expect(read()).toBe(false);
    for (const v of ["0", "off", "no", "FALSE", "", "true"]) {
      process.env[key] = v;
      expect(read(), `giá trị ${JSON.stringify(v)}`).toBe(true);
    }
    delete process.env[key];
    const other = key === "OT_SAFETY_PREFLIGHT_ENABLED" ? "ROBOT_SAFETY_PREFLIGHT_ENABLED" : "OT_SAFETY_PREFLIGHT_ENABLED";
    process.env[other] = "false";
    expect(read(), "cờ của bên kia không được tắt bên này").toBe(true);
  });

  it("commandDispatcher.isSafetyPreflightEnabled là CÙNG một hàm đọc (không còn điểm đọc thứ hai)", () => {
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    expect(isSafetyPreflightEnabled()).toBe(isOtSafetyPreflightEnabled());
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    expect(isSafetyPreflightEnabled()).toBe(false);
    expect(isOtSafetyPreflightEnabled()).toBe(false);
  });

  it("mã lý do: BLOCKED ⇒ SAFETY_BLOCKED; mọi thứ khác (UNKNOWN / ERROR / chuỗi lạ) ⇒ SAFETY_UNKNOWN; OK không phải lý do từ chối", () => {
    expect(safetyPreflightReason("BLOCKED")).toBe("SAFETY_BLOCKED");
    expect(safetyPreflightReason("UNKNOWN")).toBe("SAFETY_UNKNOWN");
    expect(safetyPreflightReason("ERROR")).toBe("SAFETY_UNKNOWN");
    expect(safetyPreflightReason("whatever")).toBe("SAFETY_UNKNOWN");
    expect(() => safetyPreflightReason("OK")).toThrow(/OK is not a refusal/);
  });
});

// ════════ doc 81 Đợt 1C Task 1 — luật lệnh THẬT (quyết định chủ dự án 2026-09-27) ════════
// Bảng kỳ vọng viết TAY từ quyết định: "SIM safety-PLC KHÔNG được thoả preflight đối với đích đã
// commission"; "tag an toàn đọc ra chất lượng xấu với backend real ⇒ UNKNOWN". Không suy từ mã.
import { actuationPreflightVerdict, type PlcPreflightReading } from "./safetyPreflightPolicy";

describe("Đợt 1C Task 1 — actuationPreflightVerdict", () => {
  const R = (kind: PlcPreflightReading["kind"], outcome: PlcPreflightReading["outcome"]): PlcPreflightReading => ({ kind, outcome });
  const cases: Array<[string, PlcPreflightReading[], string, string | null]> = [
    ["0 cấu hình", [], "UNKNOWN", "SAFETY_UNKNOWN"],
    ["SIM rỗng sạch", [R("sim_empty", "clean")], "UNKNOWN", "SAFETY_SIM_ONLY"],
    ["SIM kịch bản sạch", [R("sim_scripted", "clean")], "UNKNOWN", "SAFETY_SIM_ONLY"],
    ["endpoint thật chưa gán tag", [R("real_unmapped", "clean")], "UNKNOWN", "SAFETY_SIM_ONLY"],
    ["SIM + chưa gán tag", [R("sim_empty", "clean"), R("real_unmapped", "clean")], "UNKNOWN", "SAFETY_SIM_ONLY"],
    ["thật sạch", [R("real", "clean")], "OK", null],
    ["thật sạch + SIM sạch", [R("sim_empty", "clean"), R("real", "clean")], "OK", null],
    ["thật lỗi đọc + SIM sạch", [R("real", "error"), R("sim_empty", "clean")], "UNKNOWN", "SAFETY_UNKNOWN"],
    ["thật tag chất lượng xấu", [R("real", "incomplete")], "UNKNOWN", "SAFETY_UNKNOWN"],
    ["thật xấu + SIM sạch", [R("real", "incomplete"), R("sim_empty", "clean")], "UNKNOWN", "SAFETY_UNKNOWN"],
    // Fix round 1 (ruling R-1C-b, 2026-09-27): cấu hình KHÔNG theo máy đích ⇒ một PLC thật sạch không được
    // che e-stop không đọc được của PLC thật khác ⇒ BẤT KỲ real nào incomplete/error ⇒ UNKNOWN.
    ["thật xấu + thật sạch", [R("real", "incomplete"), R("real", "clean")], "UNKNOWN", "SAFETY_UNKNOWN"],
    ["thật sạch + thật lỗi đọc", [R("real", "clean"), R("real", "error")], "UNKNOWN", "SAFETY_UNKNOWN"],
    ["thật lỗi đọc + thật BLOCKED ⇒ BLOCKED vẫn thắng", [R("real", "error"), R("real", "blocked")], "BLOCKED", "SAFETY_BLOCKED"],
    ["thật sạch + SIM lỗi đọc (SIM không tính)", [R("real", "clean"), R("sim_empty", "error")], "OK", null],
    ["thật BLOCKED + thật sạch", [R("real", "clean"), R("real", "blocked")], "BLOCKED", "SAFETY_BLOCKED"],
    ["SIM kịch bản BLOCKED + thật sạch", [R("real", "clean"), R("sim_scripted", "blocked")], "BLOCKED", "SAFETY_BLOCKED"],
    ["chỉ lỗi đọc SIM", [R("sim_empty", "error")], "UNKNOWN", "SAFETY_SIM_ONLY"],
  ];
  it.each(cases)("%s", (_ten, readings, state, reason) => {
    expect(actuationPreflightVerdict(readings)).toEqual({ state, reason });
  });

  it("safetyPreflightReason: UNKNOWN + basis sim_only ⇒ SAFETY_SIM_ONLY; basis không đổi BLOCKED; OK vẫn ném", () => {
    expect(safetyPreflightReason("UNKNOWN", "sim_only")).toBe("SAFETY_SIM_ONLY");
    expect(safetyPreflightReason("ERROR", "sim_only")).toBe("SAFETY_SIM_ONLY");
    expect(safetyPreflightReason("BLOCKED", "sim_only")).toBe("SAFETY_BLOCKED");
    expect(safetyPreflightReason("UNKNOWN", null)).toBe("SAFETY_UNKNOWN");
    expect(() => safetyPreflightReason("OK", "sim_only")).toThrow(/OK is not a refusal/);
  });
});

// doc 81 Đợt 4 Task A1 (ruling R-4-c) — MỘT bộ so khớp cấu hình ↔ đích cho cổng và bảng nguồn an toàn.
describe("Đợt 4 Task A1 — plcConfigAppliesToTarget", () => {
  it("bảng chân trị (đích null ⇒ mọi cấu hình; không gắn đích ⇒ luôn; cột cụ thể nhất quyết định)", async () => {
    const { plcConfigAppliesToTarget: f } = await import("./safetyPreflightPolicy");
    const M = { robotId: null, machineId: 10, stationId: 3, lineId: 2, factoryId: 1 };
    const R = { robotId: 7, machineId: null, stationId: 3, lineId: 2, factoryId: 1 };
    const RL = { robotId: 8, machineId: null, stationId: null, lineId: 2, factoryId: 1 };
    const none = {};
    expect(f({ lineId: 99, robotId: 98 }, null)).toBe(true);
    expect(f(none, M)).toBe(true);
    expect(f({ robotId: null, stationId: null, lineId: null, factoryId: null }, R)).toBe(true);
    expect(f({ lineId: 2, factoryId: 1 }, M)).toBe(true);
    expect(f({ lineId: 5, factoryId: 1 }, M)).toBe(false); // factoryId của hàng chuyền 5 là chủ, không mở rộng
    expect(f({ factoryId: 1 }, M)).toBe(true);
    expect(f({ factoryId: 2 }, M)).toBe(false);
    expect(f({ stationId: 3 }, M)).toBe(true);
    expect(f({ stationId: 4, lineId: 2 }, M)).toBe(false);
    expect(f({ stationId: 4, lineId: 2 }, RL)).toBe(true); // robot chỉ đặt ở chuyền: không loại trừ được trạm
    expect(f({ robotId: 7, lineId: 2 }, R)).toBe(true);
    expect(f({ robotId: 7, lineId: 2 }, M)).toBe(false);
    expect(f({ robotId: 9, lineId: 2 }, R)).toBe(false);
  });
});
