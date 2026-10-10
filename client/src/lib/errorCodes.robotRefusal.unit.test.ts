/**
 * doc 81 Đợt 1C final wave 5 (final review M8) — mã từ chối lệnh robot (kể cả HITL_ACTION_REQUIRED) có câu vi/en/zh
 * và được hiện QUA helper lỗi của client (`errorCodes.ts`), không phải mã trần.
 *
 * Trước bản vá: `robot.actuate` / `vda5050.sendOrder` trả `error` là mã trần ("HITL_ACTION_REQUIRED", "SAFETY_SIM_ONLY",
 * "robot_motion_in_progress" …) và Bảng lệnh ghép thẳng mã đó vào toast. Danh sách mã dưới đây là ORACLE độc lập (chép
 * từ các nhánh `error:` của robotCommandDispatcher / ros2Bridge), không lấy từ chính helper.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

import { translateRobotRefusal } from "./errorCodes";

import "../i18n";
import i18n from "i18next";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(async () => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});

const CODES = [
  "HITL_ACTION_REQUIRED",
  "HITL confirmation required",
  "HITL verify unavailable",
  "NOT_CONFIRMED",
  "ACTION_BINDING_MISMATCH",
  "MANUAL_CONFIRMER_MISMATCH",
  "robot not active/connected",
  "MOTION_LOCKED",
  "ROBOT_DISABLED", // final wave R-4-x
  "SAFETY_BLOCKED",
  "SAFETY_UNKNOWN",
  "SAFETY_SIM_ONLY",
  "INTERLOCK_BLOCKED",
  "POLICY_DENIED",
  "POLICY_APPROVAL_REQUIRED",
  "robot_motion_in_progress",
  "LEDGER_WRITE_FAILED",
  "IDEMPOTENT_JOB_IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
  "ROS2_JOB_MESSAGE_REQUIRED",
] as const;
const LOCALES = ["vi", "en", "zh"] as const;
const TEN_BIEN_MOI_TRUONG = /[A-Z][A-Z0-9]+_[A-Z0-9_]+/;

describe("M8 — translateRobotRefusal: mọi mã từ chối robot có câu ở cả ba ngôn ngữ", () => {
  for (const lng of LOCALES) {
    it.each(CODES)(`${lng}: %s ⇒ câu dịch (không phải fallback, không mã trần, không tên biến môi trường)`, async (code) => {
      await i18n.changeLanguage(lng);
      const s = translateRobotRefusal(code, "__FALLBACK__");
      expect(s).not.toBe("__FALLBACK__");
      expect(s.length).toBeGreaterThan(8);
      expect(s).not.toContain(code);
      expect(s).not.toMatch(TEN_BIEN_MOI_TRUONG);
    });
  }
  it("mã lạ / vắng ⇒ trả fallback NGUYÊN VĂN (không bao giờ hiện mã trần thay câu)", async () => {
    await i18n.changeLanguage("en");
    expect(translateRobotRefusal("SOMETHING_NEW", "Command not executed")).toBe("Command not executed");
    expect(translateRobotRefusal(undefined, "fb")).toBe("fb");
    expect(translateRobotRefusal("__proto__", "fb")).toBe("fb");
  });
  it("Bảng lệnh (CommandConsole) hiện lỗi robot.actuate QUA translateRobotRefusal", () => {
    const src = readFileSync(new URL("../pages/CommandConsole.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/translateRobotRefusal\(res\.error/);
  });
});
