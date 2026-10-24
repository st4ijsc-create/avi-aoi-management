import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MA_BUILD } from "./maBuild";

describe("mã build (2026-10-24)", () => {
  it("không qua build (test) ⇒ 'dev'", () => {
    expect(MA_BUILD).toBe("dev");
  });
  it("★★ build.mjs nhúng __MA_BUILD__ = phiên bản + commit[-dirty] qua define (đóng gói mới có mã thật)", () => {
    const b = readFileSync(join(__dirname, "../../build.mjs"), "utf8");
    expect(b).toMatch(/define:\s*\{\s*__MA_BUILD__:\s*JSON\.stringify\(maBuild\(\)\)/);
    expect(b).toContain('"rev-parse", "--short", "HEAD"');
    expect(b).toContain('"-dirty"');
  });
  it("phiên bản trong package.json là 0.3.0 trở lên (bản cài cũ 0.2.0 phải thay)", () => {
    const v = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")).version as string;
    const [ma, mi] = v.split(".").map(Number);
    expect(ma! > 0 || mi! >= 3).toBe(true);
  });
});
