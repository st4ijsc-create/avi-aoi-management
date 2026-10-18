import { test } from "node:test";
import assert from "node:assert";
import { gomNgTheoCa, tyLeNg } from "../src/kho.mjs";
import { caCuaMoc } from "../src/ca.mjs";

test("ẩn: tyLeNg tong <= 0 luôn 0, kể cả ng = 0", () => {
  for (const [t, n] of [[0, 0], [0, 7], [-1, -1], [-100, 3]]) assert.strictEqual(tyLeNg(t, n), 0, `${t},${n}`);
});
test("ẩn: tyLeNg bình thường, làm tròn 2 chữ số", () => {
  assert.strictEqual(tyLeNg(7, 1), 14.29);
  assert.strictEqual(tyLeNg(1000, 0), 0);
  assert.strictEqual(tyLeNg(8, 8), 100);
});
test("ẩn: caCuaMoc với ca 1 bắt đầu 22h (vắt qua nửa đêm)", () => {
  assert.strictEqual(caCuaMoc("2026-01-01T22:00:00Z", 22), "CA1");
  assert.strictEqual(caCuaMoc("2026-01-02T05:59:00Z", 22), "CA1");
  assert.strictEqual(caCuaMoc("2026-01-02T06:00:00Z", 22), "CA2");
  assert.strictEqual(caCuaMoc("2026-01-01T21:59:00Z", 22), "CA3");
});
test("ẩn: gomNgTheoCa với ca 1 bắt đầu 22h", () => {
  const bg = [
    { moc: "2026-01-01T23:00:00Z", soNg: 1 },
    { moc: "2026-01-02T03:00:00Z", soNg: 2 },
    { moc: "2026-01-02T10:00:00Z", soNg: 4 },
    { moc: "2026-01-02T15:00:00Z", soNg: 8 },
  ];
  assert.deepStrictEqual(gomNgTheoCa(bg, 22), { CA1: 3, CA2: 4, CA3: 8 });
});
