/**
 * doc 81 Đợt 4 Task B4 (QĐ-4c) — the fail-closed lock reason `persistUnknown` is explained to the operator in vi/en/zh
 * (RobotControl shows `robot.motionLock.reason.<code>` instead of the raw code). Oracle: the locale files themselves
 * and the RobotControl source.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE } from "./robotDriver";

const ROOT = path.resolve(__dirname, "../../..");
const read = (l: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "client/src/i18n/locales", `${l}.json`), "utf8"));

describe("B4 — persistUnknown is translated", () => {
  it("the reason code is exactly the ruling's `persistUnknown`", () => {
    expect(MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE).toBe("persistUnknown");
  });

  it("vi / en / zh each carry a distinct, non-empty sentence", () => {
    const texts = ["vi", "en", "zh"].map((l) => read(l).robot?.motionLock?.reason?.[MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE]);
    for (const t of texts) expect(typeof t === "string" && t.length > 10).toBe(true);
    expect(new Set(texts).size).toBe(3);
  });

  it("RobotControl renders the key for the lock badge tooltip and the clear dialog", () => {
    const src = fs.readFileSync(path.join(ROOT, "client/src/pages/RobotControl.tsx"), "utf8");
    expect(src).toContain('t("robot.motionLock.reason.persistUnknown"');
    expect(src.match(/reason: lockReason\(/g)?.length).toBe(2);
  });
});
