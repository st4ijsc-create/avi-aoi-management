/**
 * Thước giả-đúng / giả-sai cho mọi bộ chấm TypeScript — chạy THẬT trên node ĐANG CÀI (2026-10-30: v26 gỡ
 * cờ biến đổi kiểu (CO_BIEN_DOI_TS) ⇒ ts 0/3 mọi lượt, H lẫn M, là hiện vật công cụ). Thước: lời giải đúng dùng cú
 * pháp chỉ BIẾN ĐỔI mới chạy được (enum, thuộc tính tham số) ⇒ PHẢI ĐẠT; sai / không biên dịch được ⇒ PHẢI TRƯỢT.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { chamBai } from "../codegen-chay-duoc/cham.mjs";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { chayLo } from "../ngau-nhien/multipl-e/chay.mjs";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { nodeCoBienDoiTs, CO_BIEN_DOI_TS } from "./tsChay.mjs";

const DUNG = [
  "```ts",
  "export enum Mau { Do = 1, Xanh = 2 }",
  "export class Kho { constructor(private readonly ten: string, public so: number = 0) {} nhan(): string { return `${this.ten}:${this.so * Mau.Xanh}`; } }",
  "```",
].join("\n");
const SAI = DUNG.replace("this.so * Mau.Xanh", "this.so * Mau.Do");
const HONG = "```ts\nexport class Kho { constructor(private ten: string {} }\n```";
const kiem = (nhap: string) =>
  [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    `import { Kho, Mau } from ${nhap};`,
    "test('kho', () => { assert.equal(new Kho('a', 3).nhan(), 'a:6'); assert.equal(Mau.Xanh, 2); });",
  ].join("\n");
const bai = (nhap: string) => ({ id: "T-ts-thuoc", lang: "ts", test: kiem(nhap) });
const thuMuc = () => fs.mkdtempSync(path.join(os.tmpdir(), "thuoc-ts-"));

describe("tsChay — nhánh chọn theo node đang cài", () => {
  it("nodeCoBienDoiTs khớp đúng bảng cờ của tiến trình", () => {
    expect(nodeCoBienDoiTs()).toBe(process.allowedNodeEnvironmentFlags.has(CO_BIEN_DOI_TS));
  });
});

describe("cham.mjs runTs — thước giả-đúng / giả-sai", () => {
  // bộ bài cũ import "./sol.mjs", tasks-hard import './sol.ts' (nháy đơn) — cả hai phải về đúng lời giải
  for (const nhap of ['"./sol.mjs"', "'./sol.ts'"]) {
    it(`giả-đúng (enum + thuộc tính tham số) ⇒ ĐẠT — import ${nhap}`, async () => {
      const k = await chamBai({ t: bai(nhap), text: DUNG, dir: thuMuc() });
      expect(k.loi).toBeNull();
      expect(k.dat).toBe(true);
    }, 60_000);
    it(`giả-sai (kết quả lệch) ⇒ TRƯỢT — import ${nhap}`, async () => {
      const k = await chamBai({ t: bai(nhap), text: SAI, dir: thuMuc() });
      expect(k.dat).toBe(false);
      expect(String(k.loi)).not.toMatch(/bad option/);
    }, 60_000);
  }
  it("không biên dịch được ⇒ TRƯỢT (không bao giờ cho qua)", async () => {
    const k = await chamBai({ t: bai('"./sol.mjs"'), text: HONG, dir: thuMuc() });
    expect(k.dat).toBe(false);
    expect(String(k.loi)).not.toMatch(/bad option/);
  }, 60_000);
});

describe("multipl-e chay.mjs ts — thước giả-đúng / giả-sai", () => {
  const prog = (dung: boolean) =>
    [
      "const assert = require('node:assert');",
      "enum Mau { Do = 1, Xanh = 2 }",
      "class Kho { constructor(private readonly ten: string, public so: number) {} nhan(): number { return this.so * Mau.Xanh; } }",
      `assert.strictEqual(new Kho('a', 3).nhan(), ${dung ? 6 : 7});`,
    ].join("\n");
  it("đúng ⇒ đạt, sai ⇒ trượt, không biên dịch ⇒ trượt", async () => {
    const kq = await chayLo(
      "ts",
      [
        { khoa: "dung", prog: prog(true) },
        { khoa: "sai", prog: prog(false) },
        { khoa: "hong", prog: "class X { constructor(private a: number {} }" },
      ],
      { goc: thuMuc(), duLieu: thuMuc(), songSong: 1 },
    );
    expect(kq.get("dung").dat).toBe(true);
    expect(kq.get("sai").dat).toBe(false);
    expect(kq.get("hong").dat).toBe(false);
    for (const k of ["dung", "sai", "hong"]) expect(kq.get(k).duoiRa).not.toMatch(/bad option/);
  }, 90_000);
});

describe("duan.mjs — cờ --experimental-strip-types node đang cài còn nhận", () => {
  it("node --experimental-strip-types --input-type=module -e 0 thoát 0", () => {
    expect(() =>
      execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", "0"], { stdio: "pipe" }),
    ).not.toThrow();
  });
});
