import { test } from "node:test";
import assert from "node:assert/strict";
import { PhanSo } from "../src/phanSo.mjs";

test("rút gọn và đưa dấu lên tử", () => {
  const a = new PhanSo(6n, -8n);
  assert.equal(a.tu, -3n);
  assert.equal(a.mau, 4n);
  assert.equal(a.toString(), "-3/4");
  assert.equal(new PhanSo(10, 5).toString(), "2");
});

test("cộng hai phân số", () => {
  assert.equal(new PhanSo(1, 2).cong(new PhanSo(1, 3)).toString(), "5/6");
});

test("parse chuỗi đơn giản", () => {
  assert.equal(PhanSo.parse("-3/6").toString(), "-1/2");
  assert.equal(PhanSo.parse("2").toString(), "2");
});
