/**
 * ★★★ ĐỢT 4C — KIỂM THƯỚC bộ đo FIM: đáp án thật ⇒ 100 %, rỗng ⇒ 0 %, rác ⇒ thấp; bộ mẫu thật hợp lệ.
 * Thước sai thì mọi bảng so model phía sau là số giả — nên đo thước TRƯỚC.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chamMot, tongHop, doTuongTu, phanVi, type MauFim } from "./chamFim";

const docBo = (ten: string): MauFim[] =>
  readFileSync(join(__dirname, ten), "utf8")
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));

// Bộ chính + bộ độc lập thứ hai (hạt khác — đo độ nhiễu của bảng so model).
describe.each(["mau-fim.jsonl", "mau-fim-2.jsonl"])("thước FIM — %s", (ten) => {
  const mau = docBo(ten);
  it("★★★ bộ mẫu ≥ 60, đủ bốn ngôn ngữ, đủ ba kiểu cắt", () => {
    expect(mau.length).toBeGreaterThanOrEqual(60);
    expect(new Set(mau.map((m) => m.ngonNgu))).toEqual(new Set(["ts", "js", "py", "cs"]));
    expect(new Set(mau.map((m) => m.kieu))).toEqual(new Set(["giua-dong", "dong", "khoi"]));
  });

  it("★★★ mỗi mẫu là mã THẬT: tiền tố + đáp án + hậu tố là một đoạn liền trong tệp nguồn của repo", () => {
    for (const m of mau) {
      expect(m.ban, m.id).toMatch(/^[0-9a-f]{40}$/);
      const goc = execFileSync("git", ["show", `${m.ban}:${m.tep}`], {
        cwd: join(__dirname, "..", "..", ".."),
        encoding: "utf8",
        maxBuffer: 64 << 20,
      }).replace(/\r\n/g, "\n");
      expect(goc, m.id).toContain(m.tienTo + m.dapAn + m.hauTo);
      expect(m.dapAn.trim().length, m.id).toBeGreaterThan(0);
    }
  });

  it("★★★ đáp án thật ⇒ 100 % mọi chỉ số", () => {
    const kq = tongHop(mau.map((m) => chamMot(m, m.dapAn, 1)));
    expect(kq.khopDongDau).toBe(1);
    expect(kq.khopToanDoan).toBe(1);
    expect(kq.tuongTu).toBe(1);
  });

  it("★★★ rỗng ⇒ 0 % mọi chỉ số", () => {
    const kq = tongHop(mau.map((m) => chamMot(m, "", 1)));
    expect(kq.khopDongDau).toBe(0);
    expect(kq.khopToanDoan).toBe(0);
    expect(kq.tuongTu).toBe(0);
    expect(kq.tiLeRong).toBe(1);
  });

  it("★★ rác ⇒ không khớp, tương tự thấp", () => {
    const kq = tongHop(mau.map((m) => chamMot(m, "zzzz qqqq ;", 1)));
    expect(kq.khopDongDau).toBe(0);
    expect(kq.tuongTu).toBeLessThan(0.2);
  });

  it("★★ khoảng trắng CUỐI dòng không tính là sai; khoảng trắng ĐẦU dòng có tính", () => {
    const m: MauFim = { id: "x", tep: "", ngonNgu: "ts", kieu: "khoi", tienTo: "", hauTo: "\n", dapAn: "a();\n  b();" };
    expect(chamMot(m, "a();  \n  b();", 1).khopToanDoan).toBe(true);
    expect(chamMot(m, "a();\nb();", 1).khopToanDoan).toBe(false);
    expect(chamMot(m, "a();\nb();", 1).khopDongDau).toBe(true);
  });

  it("★ độ tương tự + phân vị", () => {
    expect(doTuongTu("abc", "abc")).toBe(1);
    expect(doTuongTu("", "")).toBe(1);
    expect(doTuongTu("abcd", "abce")).toBeCloseTo(0.75);
    expect(phanVi([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(phanVi([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });
});
