/** `bo-the-phu` CLI: bỏ đúng tiền tố `[Dk] `, `--chi-dem` không ghi, mã thoát 0/2/3. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./boThePhu";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bo-the-phu-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const chay = (argv: string[]) => {
  let o = "";
  const ma = main(argv, (s) => (o += s));
  return { ma, o };
};
const NGUON = 'it("[D1] một", () => { expect(f(0)).toBe(1); });\nit("hai", () => { expect(f(1)).toBe(2); });\n// "[D9] trong chú thích"\n';

describe("boThePhu CLI", () => {
  it("★★★ bỏ đúng `[D1] ` ở tên ca, giữ nguyên phần còn lại (kể cả chuỗi `[D9]` trong chú thích); báo số tiền tố", () => {
    const t = path.join(dir, "a.test.ts");
    fs.writeFileSync(t, NGUON);
    const { ma, o } = chay([t]);
    expect(ma).toBe(0);
    expect(fs.readFileSync(t, "utf8")).toBe('it("một", () => { expect(f(0)).toBe(1); });\nit("hai", () => { expect(f(1)).toBe(2); });\n// "[D9] trong chú thích"\n');
    expect(o).toContain(`${t}: 1 tiền tố đã bỏ`);
    expect(o).toContain("Tổng: 1");
  });
  it("★★ --chi-dem không ghi tệp (nội dung giữ nguyên từng byte)", () => {
    const t = path.join(dir, "a.test.ts");
    fs.writeFileSync(t, NGUON);
    const { ma, o } = chay(["--chi-dem", t]);
    expect(ma).toBe(0);
    expect(fs.readFileSync(t, "utf8")).toBe(NGUON);
    expect(o).toContain("1 tiền tố (chỉ đếm)");
  });
  it("★★ không có tệp / cờ lạ ⇒ mã 2; tệp không tồn tại ⇒ mã 3 và không ghi tệp nào sau nó", () => {
    expect(chay([]).ma).toBe(2);
    expect(chay(["--la", "x"]).ma).toBe(2);
    const t = path.join(dir, "a.test.ts");
    fs.writeFileSync(t, NGUON);
    expect(chay([path.join(dir, "khong-co.ts"), t]).ma).toBe(3);
    expect(fs.readFileSync(t, "utf8")).toBe(NGUON);
  });
  it("★ tệp không có tag ⇒ không ghi lại (mtime không đổi), 0 tiền tố", () => {
    const t = path.join(dir, "b.test.ts");
    fs.writeFileSync(t, 'it("x", () => { expect(1).toBe(1); });\n');
    const truoc = fs.statSync(t).mtimeMs;
    const { o } = chay([t]);
    expect(fs.statSync(t).mtimeMs).toBe(truoc);
    expect(o).toContain("0 tiền tố");
  });
});
