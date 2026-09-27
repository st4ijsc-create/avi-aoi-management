/**
 * doc 80 Đợt 1 Task 5 — fix round 1 (#2): tệp .bas mà ZAux_BasDown đọc KHÔNG BAO GIỜ bị lộ dở.
 *
 * compile() ghi `${ZMC_BUILD_DIR}/${checksum}.bas` — CÙNG đường dẫn cho mọi lượt biên dịch cùng
 * nguồn (build, simulate, deploy biên dịch lại). Bản cũ `writeFile(filePath, …)` CẮT tệp về 0
 * rồi mới ghi ⇒ một lượt biên dịch song song với một lượt nạp đang đọc tệp có thể làm lượt nạp
 * đọc được tệp RỖNG/DỞ. Sau vá: ghi tệp tạm rồi `rename` (nguyên tử trên cùng ổ đĩa) ⇒ người đọc
 * chỉ thấy bản cũ ĐẦY ĐỦ hoặc bản mới ĐẦY ĐỦ. Và `compile(src, { persist:false })` (đường xem
 * trước deploy) KHÔNG ghi gì.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZmotionBasicAdapter } from "./zmotionBasicAdapter";

let dir = "";
const truoc = process.env.ZMC_BUILD_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zmc-atomic-"));
  process.env.ZMC_BUILD_DIR = dir;
});
afterEach(() => {
  if (truoc === undefined) delete process.env.ZMC_BUILD_DIR;
  else process.env.ZMC_BUILD_DIR = truoc;
  rmSync(dir, { recursive: true, force: true });
});

// Chương trình LỚN (~4 MB) để cửa sổ "đã cắt, chưa ghi xong" của bản cũ đủ rộng mà đo được.
const LON = Array.from({ length: 160_000 }, (_, i) => `MOVE(${i % 997})  ' buoc ${i}`).join("\n");

describe("zmotion compile — ghi tệp .bas NGUYÊN TỬ + chế độ không ghi", () => {
  it("★★★ biên dịch SONG SONG với người đọc: mọi lượt đọc thấy tệp ĐẦY ĐỦ (không bao giờ rỗng/dở)", async () => {
    const a = new ZmotionBasicAdapter();
    const src = { kind: "zmotion-basic" as const, language: "basic", content: LON };
    const first = await a.compile(src);
    const file = first.meta?.filePath as string;
    expect(typeof file).toBe("string");

    let dangBienDich = true;
    const loi: string[] = [];
    let soLanDoc = 0;
    const doc = (async () => {
      while (dangBienDich) {
        try {
          const s = await readFile(file, "utf8");
          soLanDoc++;
          if (s !== LON) loi.push(`len=${s.length}`);
        } catch (e) {
          loi.push(`read: ${(e as NodeJS.ErrnoException).code}`);
        }
      }
    })();
    for (let lap = 0; lap < 6; lap++) {
      const rs = await Promise.all(Array.from({ length: 4 }, () => a.compile(src)));
      for (const r of rs) expect(r.meta?.filePath).toBe(file);
    }
    dangBienDich = false;
    await doc;
    expect(soLanDoc).toBeGreaterThan(0);
    expect(loi.slice(0, 5)).toEqual([]);
    // Không để lại tệp tạm.
    expect(readdirSync(dir)).toEqual([file.split(/[\\/]/).pop()]);
    expect(readFileSync(file, "utf8")).toBe(LON);
  }, 120_000);

  it("persist:false (bản xem trước) ⇒ KHÔNG ghi tệp nào, outputRef y hệt, meta báo chưa ghi", async () => {
    const a = new ZmotionBasicAdapter();
    const src = { kind: "zmotion-basic" as const, language: "basic", content: "MOVE(10)\nMOVE(20)" };
    const r = await a.compile(src, { persist: false });
    expect(readdirSync(dir)).toEqual([]);
    expect(r.meta?.filePath).toBeUndefined();
    expect(r.meta?.persisted).toBe(false);
    const thuong = await a.compile(src);
    expect(thuong.outputRef).toBe(r.outputRef);
    expect(existsSync(thuong.meta?.filePath as string)).toBe(true);
  });
});
