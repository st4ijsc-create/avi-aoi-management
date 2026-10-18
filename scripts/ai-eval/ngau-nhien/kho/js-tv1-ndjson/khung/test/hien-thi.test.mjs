import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { demNdjson, docNdjson } from "../src/ndjson.mjs";

test("đếm dòng hợp lệ đơn giản", async () => {
  const kq = await demNdjson(Readable.from(['{"a":1}\n{"b":2}\n']));
  assert.deepEqual(kq, { tong: 2, hopLe: 2, loi: [] });
});

test("dòng JSON hỏng được báo theo số dòng", async () => {
  const kq = await demNdjson(Readable.from(['{"a":1}\n{hỏng\n{"c":3}\n']));
  assert.deepEqual(kq, { tong: 3, hopLe: 2, loi: [{ dong: 2, lyDo: "json" }] });
});

test("docNdjson phát các object hợp lệ", async () => {
  const ra = [];
  for await (const x of docNdjson(Readable.from(['{"a":1}\n{"a":2}\n']))) ra.push(x);
  assert.deepEqual(ra, [{ dong: 1, giaTri: { a: 1 } }, { dong: 2, giaTri: { a: 2 } }]);
});
