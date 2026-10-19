import { test } from "node:test";
import assert from "node:assert/strict";
import { HangUuTien, topK } from "../src/hangUuTien.ts";

const tang = (a: number, b: number) => a - b;

test("push/pop theo thứ tự tăng dần", () => {
  const h = new HangUuTien<number>(tang);
  for (const x of [5, 1, 4, 2, 3]) h.push(x);
  assert.equal(h.size(), 5);
  const ra: number[] = [];
  while (h.size() > 0) ra.push(h.pop()!);
  assert.deepEqual(ra, [1, 2, 3, 4, 5]);
});

test("peek không lấy phần tử ra", () => {
  const h = new HangUuTien<number>(tang);
  h.push(7);
  h.push(3);
  assert.equal(h.peek(), 3);
  assert.equal(h.size(), 2);
});

test("topK lấy k phần tử nhỏ nhất", () => {
  assert.deepEqual(topK([9, 4, 7, 1, 8], 3, tang), [1, 4, 7]);
});
