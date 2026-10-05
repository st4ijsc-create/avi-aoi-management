/**
 * doc 81 Đợt 3 Task 4 fix 1 (Ruling R-3-g) — mọi `apply-migration-0357…0363.mjs` TỪ CHỐI chạy khi không chỉ rõ ĐÚNG MỘT
 * đích (`--dev-only` | `--test-only` | `--both`). Trước đây không cờ = áp CẢ dev lẫn _test.
 *
 * An toàn của chính lưới: tiến trình con nhận `DATABASE_URL` trỏ cổng 1 (không có gì nghe) — kể cả khi cổng chặn hỏng, script
 * KHÔNG với tới được CSDL nào; và nó phải thoát mã 2 với lời từ chối, không phải lỗi kết nối.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ["0357", "0358", "0359", "0360", "0361", "0362", "0363"].map((n) => {
  const f = readdirSync(DIR).find((x) => x.startsWith(`apply-migration-${n}`) && x.endsWith(".mjs"));
  return path.join(DIR, f as string);
});

const run = (script: string, args: string[]) =>
  spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, DATABASE_URL: "postgresql://khong:co@127.0.0.1:1/khong_co", TEST_DATABASE_URL: "postgresql://khong:co@127.0.0.1:1/khong_co_test" },
    encoding: "utf8",
    timeout: 30_000,
  });

describe("R-3-g — apply-migration 0357…0363 đòi ĐÚNG MỘT cờ đích", () => {
  it("tìm đủ bảy script (cầu chì)", () => {
    expect(SCRIPTS.every((s) => s && s.endsWith(".mjs"))).toBe(true);
    expect(SCRIPTS).toHaveLength(7);
  });
  for (const s of SCRIPTS) {
    it(`${path.basename(s)}: không cờ ⇒ mã 2 + lời từ chối; hai cờ ⇒ mã 2`, () => {
      const r0 = run(s, []);
      expect(r0.status).toBe(2);
      expect(r0.stderr).toMatch(/DUNG MOT dich/);
      const r2 = run(s, ["--dev-only", "--test-only"]);
      expect(r2.status).toBe(2);
      expect(r2.stderr).toMatch(/DUNG MOT dich/);
    });
  }
});
