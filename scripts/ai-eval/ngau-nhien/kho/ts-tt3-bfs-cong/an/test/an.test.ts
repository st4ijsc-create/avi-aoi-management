import { test } from "node:test";
import assert from "node:assert/strict";
import { duongNganNhat } from "../src/luoi.ts";

test("phá hoà: Lên trước Trái", () => {
  assert.deepEqual(duongNganNhat(["E..", "...", "..S"]), {
    doDai: 4,
    duong: [[2, 2], [1, 2], [0, 2], [0, 1], [0, 0]],
  });
});

test("phá hoà: Trái trước Phải", () => {
  assert.deepEqual(duongNganNhat([".S.", ".#.", ".E."]), {
    doDai: 4,
    duong: [[0, 1], [0, 0], [1, 0], [2, 0], [2, 1]],
  });
});

test("phá hoà: Lên trước Xuống", () => {
  assert.deepEqual(duongNganNhat(["...", "S#E", "..."]), {
    doDai: 4,
    duong: [[1, 0], [0, 0], [0, 1], [0, 2], [1, 2]],
  });
});

test("phá hoà: đi bộ trước dịch chuyển khi dài bằng nhau", () => {
  assert.deepEqual(duongNganNhat(["Sa..E", "####.", "####a"]), {
    doDai: 4,
    duong: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  });
});

test("dịch chuyển là TUỲ CHỌN: đi qua ô cổng mà không dịch chuyển", () => {
  assert.deepEqual(duongNganNhat(["S.a.E", "#####", "a...."]), {
    doDai: 4,
    duong: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  });
});

test("chuỗi hai cổng", () => {
  assert.deepEqual(duongNganNhat(["S.a#b.E", "#######", "a..b###"]), {
    doDai: 9,
    duong: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2], [2, 3], [0, 4], [0, 5], [0, 6]],
  });
});

test("E kề S và cổng dẫn vào vùng kín ⇒ null", () => {
  assert.deepEqual(duongNganNhat(["SE"]), { doDai: 1, duong: [[0, 0], [0, 1]] });
  assert.equal(duongNganNhat(["Sa#E", "##a#"]), null);
});

test("mê cung dài: đường duy nhất", () => {
  const luoi = [
    "S.#.......",
    ".##.####..",
    "......#...",
    "#####.#.##",
    "......#..E",
  ];
  assert.deepEqual(duongNganNhat(luoi), {
    doDai: 19,
    duong: [
      [0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [2, 3], [1, 3], [0, 3], [0, 4], [0, 5],
      [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [2, 7], [3, 7], [4, 7], [4, 8], [4, 9],
    ],
  });
});

test("lưới không hợp lệ ⇒ RangeError", () => {
  for (const luoi of [
    [],
    ["S.", "E"],
    ["S..", "..."],
    ["...", "..E"],
    ["SE", "E."],
    ["SS", "E."],
    ["SaE"],
    ["SaaaE", "....."],
    ["S.X.E"],
    ["S. .E"],
    ["SA.AE"],
  ]) {
    assert.throws(() => duongNganNhat(luoi), RangeError, JSON.stringify(luoi));
  }
});
