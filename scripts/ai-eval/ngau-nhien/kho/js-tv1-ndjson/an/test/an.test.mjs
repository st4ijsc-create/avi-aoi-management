import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { demNdjson, docNdjson } from "../src/ndjson.mjs";

const tuBuffer = (...bufs) => Readable.from(bufs.map((b) => Buffer.from(b)));

test("CRLF và dòng cuối không có xuống dòng", async () => {
  const kq = await demNdjson(Readable.from(['{"a":1}\r\n{"b":2}\r\n{"c":3}']));
  assert.deepEqual(kq, { tong: 3, hopLe: 3, loi: [] });
});

test("dòng rỗng / toàn khoảng trắng bị bỏ nhưng vẫn được đánh số", async () => {
  const kq = await demNdjson(Readable.from(['\n   \n{"a":1}\n\t\n[1,2]\n']));
  assert.deepEqual(kq, { tong: 2, hopLe: 1, loi: [{ dong: 5, lyDo: "khong-phai-doi-tuong" }] });
});

test("mảnh cắt ngang giữa dòng", async () => {
  const kq = await demNdjson(Readable.from(['{"a"', ':1}\n{"b":', '2}\n{x', '}\n']));
  assert.deepEqual(kq, { tong: 3, hopLe: 2, loi: [{ dong: 3, lyDo: "json" }] });
});

test("mảnh Buffer cắt ngang giữa các byte của một ký tự UTF-8", async () => {
  const toan = Buffer.from('{"ten":"Đà Nẵng"}\n{"ten":"Huế"}\n', "utf8");
  const vt = toan.indexOf(Buffer.from("Đ")) + 1; // giữa 2 byte của "Đ"
  const vt2 = toan.indexOf(Buffer.from("ế")) + 2; // giữa 3 byte của "ế"
  const ra = [];
  for await (const x of docNdjson(tuBuffer(toan.subarray(0, vt), toan.subarray(vt, vt2), toan.subarray(vt2)))) ra.push(x);
  assert.deepEqual(ra, [{ dong: 1, giaTri: { ten: "Đà Nẵng" } }, { dong: 2, giaTri: { ten: "Huế" } }]);
});

test("null, số, chuỗi, boolean, mảng đều không phải đối tượng", async () => {
  const kq = await demNdjson(Readable.from(['null\n42\n"x"\ntrue\n[]\n{}\n']));
  assert.equal(kq.tong, 6);
  assert.equal(kq.hopLe, 1);
  assert.deepEqual(kq.loi.map((l) => l.lyDo), Array(5).fill("khong-phai-doi-tuong"));
  assert.deepEqual(kq.loi.map((l) => l.dong), [1, 2, 3, 4, 5]);
});

test("async iterable thường (không phải Readable) với Uint8Array", async () => {
  async function* nguon() {
    yield new TextEncoder().encode('{"a":1}\n');
    yield '{"b":';
    yield new TextEncoder().encode("2}");
  }
  const kq = await demNdjson(nguon());
  assert.deepEqual(kq, { tong: 2, hopLe: 2, loi: [] });
});

test("docNdjson bỏ dòng lỗi, giữ số dòng gốc", async () => {
  const ra = [];
  for await (const x of docNdjson(Readable.from(['{"a":1}\n\nlỗi\n[3]\n{"a":5}\n']))) ra.push(x);
  assert.deepEqual(ra, [{ dong: 1, giaTri: { a: 1 } }, { dong: 5, giaTri: { a: 5 } }]);
});

test("nguồn lớn 20.000 dòng, mảnh 7 byte", async () => {
  const dong = [];
  for (let i = 0; i < 20000; i++) dong.push(i % 1000 === 0 ? "{lỗi" : JSON.stringify({ i, s: "Ồ" }));
  const buf = Buffer.from(dong.join("\n"), "utf8");
  async function* manh() {
    for (let i = 0; i < buf.length; i += 7) yield buf.subarray(i, i + 7);
  }
  const kq = await demNdjson(manh());
  assert.equal(kq.tong, 20000);
  assert.equal(kq.hopLe, 19980);
  assert.deepEqual(kq.loi.slice(0, 2), [{ dong: 1, lyDo: "json" }, { dong: 1001, lyDo: "json" }]);
});
