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
