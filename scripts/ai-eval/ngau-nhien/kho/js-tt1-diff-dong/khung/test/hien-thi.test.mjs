import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDong, apDung, apNguoc } from "../src/diff.mjs";

const op = (s) => ({ loai: s[0], dong: s.slice(1) });

test("hai văn bản giống hệt ⇒ toàn dòng giữ nguyên", () => {
  assert.deepEqual(diffDong(["a", "b", "c"], ["a", "b", "c"]), [" a", " b", " c"].map(op));
});

test("thêm một dòng ở giữa và xoá một dòng", () => {
  assert.deepEqual(diffDong(["a", "c"], ["a", "b", "c"]), [" a", "+b", " c"].map(op));
  assert.deepEqual(diffDong(["a", "b", "c"], ["a", "c"]), [" a", "-b", " c"].map(op));
});

test("apDung và apNguoc khôi phục hai phía", () => {
  const cu = ["mot", "hai", "ba", "bon"];
  const moi = ["mot", "ba", "bon", "nam"];
  const d = diffDong(cu, moi);
  assert.deepEqual(d, [" mot", "-hai", " ba", " bon", "+nam"].map(op));
  assert.deepEqual(apDung(cu, d), moi);
  assert.deepEqual(apNguoc(moi, d), cu);
});
