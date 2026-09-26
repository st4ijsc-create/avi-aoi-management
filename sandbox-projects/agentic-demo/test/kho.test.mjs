import { test } from "node:test";
import assert from "node:assert";
import { gomNgTheoCa, tyLeNg } from "../src/kho.mjs";

test("gom NG theo ca, ca vat qua nua dem", () => {
  const bg = [
    { moc: "2026-01-01T06:30:00Z", soNg: 2 },
    { moc: "2026-01-01T14:30:00Z", soNg: 3 },
    { moc: "2026-01-01T22:30:00Z", soNg: 4 },
    { moc: "2026-01-02T05:59:00Z", soNg: 1 },
  ];
  assert.deepStrictEqual(gomNgTheoCa(bg, 6), { CA1: 2, CA2: 3, CA3: 5 });
});

test("ty le NG - tong = 0 phai tra 0, KHONG tra NaN/Infinity", () => {
  assert.strictEqual(tyLeNg(0, 5), 0);
  assert.strictEqual(tyLeNg(-3, 5), 0);
});

test("ty le NG binh thuong", () => {
  assert.strictEqual(tyLeNg(200, 13), 6.5);
  assert.strictEqual(tyLeNg(3, 1), 33.33);
});
