import { test } from "node:test";
import assert from "node:assert/strict";
import { duongNganNhat } from "../src/luoi.ts";

test("lưới mở 3x3: phá hoà Phải trước Xuống", () => {
  assert.deepEqual(duongNganNhat(["S..", "...", "..E"]), {
    doDai: 4,
    duong: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  });
});

test("cổng dịch chuyển rút ngắn đường (tốn 1 bước)", () => {
  assert.deepEqual(duongNganNhat(["S.a#E", "###.a"]), {
    doDai: 4,
    duong: [[0, 0], [0, 1], [0, 2], [1, 4], [0, 4]],
  });
});

test("không tới được ⇒ null", () => {
  assert.equal(duongNganNhat(["S#E"]), null);
});
