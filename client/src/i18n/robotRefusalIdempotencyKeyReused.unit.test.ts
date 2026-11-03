/**
 * T6d polish (2026-11-01, re-review N2 + dieu-phoi) — câu từ chối robot `idempotencyKeyReused` KHÔNG được khuyên dùng khoá mới:
 * lệnh trước dùng khoá ấy có thể đã chạy ⇒ phải kiểm robot / vị trí trước khi ra lệnh lại.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (l: string): string =>
  (JSON.parse(readFileSync(join(__dirname, "locales", `${l}.json`), "utf8")) as { errors: { robotRefusal: { idempotencyKeyReused: string } } }).errors.robotRefusal
    .idempotencyKeyReused;

const YEU_CAU: Record<string, { co: RegExp; cam: RegExp }> = {
  vi: { co: /kiểm tra robot.*vị trí.*trước khi ra lệnh lại/i, cam: /mã mới|khoá mới|khóa mới|key mới/i },
  en: { co: /check the robot.*position.*before commanding again/i, cam: /new (idempotency )?key/i },
  zh: { co: /检查机器人.*位置.*再次下达指令前|再次下达指令前.*检查机器人.*位置/, cam: /新的?(幂等)?键|新的?密钥|新的?钥匙/ },
};

describe("errors.robotRefusal.idempotencyKeyReused", () => {
  for (const l of ["vi", "en", "zh"]) {
    it(`${l}: nói kiểm robot / vị trí trước khi ra lệnh lại, không khuyên khoá mới`, () => {
      const t = doc(l);
      expect(t).toMatch(YEU_CAU[l].co);
      expect(t).not.toMatch(YEU_CAU[l].cam);
    });
  }
});
