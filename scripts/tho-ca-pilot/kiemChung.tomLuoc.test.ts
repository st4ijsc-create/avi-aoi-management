import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { taoChayLenhKiem, tomLuocDauRa } from "./kiemChung";

describe("tomLuocDauRa — giữ ĐẦU + dòng LỖI + ĐUÔI", () => {
  const dong = (i: number) => `dong ${String(i).padStart(4, "0")} ${"x".repeat(60)}`;
  const nen = Array.from({ length: 200 }, (_v, i) => dong(i)).join("\n");
  it("★★★ đầu ra ≤ 3000 ký tự ⇒ undefined (duoi đã đủ)", () => {
    expect(tomLuocDauRa("a".repeat(3000))).toBeUndefined();
    expect(tomLuocDauRa("")).toBeUndefined();
  });
  it("★★★ đầu ra dài: có đầu (1000), đuôi (1500) và dòng LỖI nằm giữa mà đuôi 3000 sẽ mất", () => {
    const giua = ["FAIL a.test.ts > nhóm > ca một", "AssertionError: expected 1 to be 2", "TypeError: x is not a function"];
    const s = [nen.slice(0, 5000), ...giua, nen.slice(0, 12000)].join("\n");
    const t = tomLuocDauRa(s)!;
    expect(t.startsWith(s.slice(0, 1000))).toBe(true);
    expect(t.endsWith(s.slice(-1500))).toBe(true);
    for (const g of giua) expect(t).toContain(g);
    expect(s.slice(-3000)).not.toContain("AssertionError: expected 1 to be 2"); // đuôi cũ MẤT dòng lỗi này
  });
  it("★★ dòng lỗi đã nằm trong đầu hoặc đuôi thì KHÔNG lặp lại ở phần giữa", () => {
    const s = ["FAIL o-dau.test.ts", nen, "FAIL o-giua.test.ts", nen, "FAIL o-duoi.test.ts"].join("\n");
    const t = tomLuocDauRa(s)!;
    const phanGiua = t.split("--- dòng lỗi (ngoài đầu và đuôi) ---")[1]!.split("--- đuôi ---")[0]!;
    expect(phanGiua).toContain("FAIL o-giua.test.ts");
    expect(phanGiua).not.toContain("FAIL o-dau.test.ts");
    expect(phanGiua).not.toContain("FAIL o-duoi.test.ts");
  });
  it("★★ tối đa 40 dòng lỗi, mỗi dòng ≤ 300 ký tự, bỏ trùng", () => {
    const nhieu = Array.from({ length: 80 }, (_v, i) => `Error: loi so ${i}`);
    const t = tomLuocDauRa([nen, ...nhieu, ...nhieu, nen].join("\n"))!;
    expect((t.match(/Error: loi so/g) ?? []).length).toBe(40);
    const dai = tomLuocDauRa([nen, `Error: ${"y".repeat(500)}`, nen].join("\n"))!;
    const dongDai = dai.split("\n").find((l) => l.startsWith("Error: yyy"))!;
    expect(dongDai).toHaveLength(300);
  });
  it("★★★ cùng một dòng lỗi lặp nhiều lần ở giữa ⇒ chỉ ghi MỘT lần", () => {
    const lap = ["Error: LOI_LAP", "Error: LOI_LAP", "Error: LOI_LAP", "Error: LOI_KHAC", "Error: LOI_LAP"];
    const t = tomLuocDauRa([nen, ...lap, nen].join(String.fromCharCode(10)))!;
    expect((t.match(/Error: LOI_LAP/g) ?? []).length).toBe(1);
    expect((t.match(/Error: LOI_KHAC/g) ?? []).length).toBe(1);
  });
  it("★★ đầu ra dài nhưng KHÔNG có dòng lỗi ngoài đầu / đuôi ⇒ ghi '(không có)'", () => {
    expect(tomLuocDauRa(nen)!).toContain("(không có)");
  });
  it.each(["FAIL", "AssertionError", "Error:", "TypeError", "ReferenceError", "SyntaxError", "Unhandled", "✗", "×"])("★ nhận dòng lỗi chứa %s", (tu) => {
    const t = tomLuocDauRa([nen, `${tu} gia lap o giua`, nen].join("\n"))!;
    expect(t).toContain(`${tu} gia lap o giua`);
  });
});

describe("taoChayLenhKiem — tomLuoc chỉ xuất hiện khi đầu ra dài", () => {
  const chay = async (lenh: string) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcl-"));
    try {
      return await taoChayLenhKiem()(lenh, cwd, 60);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };
  it("★★★ đầu ra ngắn ⇒ KHÔNG có khoá tomLuoc (JSON không đổi); `duoi` không đổi", async () => {
    const kq = await chay(`node -e "console.log('ngan')"`);
    expect("tomLuoc" in kq).toBe(false);
    expect(kq.duoi.trim()).toBe("ngan");
  }, 90_000);
  it("★★★ đầu ra dài có lỗi ở giữa ⇒ tomLuoc mang lỗi đó, `duoi` (3000 cuối) thì không", async () => {
    const kq = await chay(`node -e "for (let i = 0; i < 300; i++) { console.log('dong ' + i + ' ' + 'x'.repeat(60)); if (i === 100) console.log('AssertionError: LOI_O_GIUA'); }"`);
    expect(kq.duoi.length).toBeLessThanOrEqual(3000);
    expect(kq.duoi).not.toContain("LOI_O_GIUA");
    expect(kq.tomLuoc).toContain("AssertionError: LOI_O_GIUA");
  }, 90_000);
});
