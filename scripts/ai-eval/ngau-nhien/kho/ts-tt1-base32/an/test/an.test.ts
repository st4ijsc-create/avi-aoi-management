import { test } from "node:test";
import assert from "node:assert/strict";
import { maHoa, giaiMa, maHoaSo } from "../src/base32.ts";

const b = (s: string) => new TextEncoder().encode(s);

test("mảng rỗng", () => {
  assert.equal(maHoa(new Uint8Array()), "");
  assert.deepEqual(giaiMa(""), new Uint8Array());
});

test("mã hoá các độ dài 1..5 byte", () => {
  assert.equal(maHoa(b("fo")), "CSQG");
  assert.equal(maHoa(b("foo")), "CSQPY");
  assert.equal(maHoa(b("foob")), "CSQPYRG");
  assert.equal(maHoa(b("fooba")), "CSQPYRK1");
  assert.equal(maHoa(Uint8Array.from([0xff, 0x00, 0x80])), "ZW080");
});

test("giải mã không phân biệt hoa thường, bỏ gạch", () => {
  assert.deepEqual(giaiMa("csqp-yrk1-e8"), b("foobar"));
});

test("O đọc là 0, I/L đọc là 1", () => {
  assert.deepEqual(giaiMa("zwO8o"), Uint8Array.from([0xff, 0x00, 0x80]));
  assert.deepEqual(giaiMa("cSqPyRkie8"), b("foobar"));
  assert.deepEqual(giaiMa("CSQPYRKLE8"), b("foobar"));
});

test("ký tự lạ (U, khoảng trắng, ký hiệu) ném RangeError", () => {
  assert.throws(() => giaiMa("CSQU"), RangeError);
  assert.throws(() => giaiMa("CS QG"), RangeError);
  assert.throws(() => giaiMa("CS*G"), RangeError);
});

test("độ dài không hợp lệ ném RangeError", () => {
  assert.throws(() => giaiMa("C"), RangeError); // 5 bit thừa
  assert.throws(() => giaiMa("CSQ"), RangeError); // 15 bit ⇒ 1 byte + 7 bit thừa
});

test("bit thừa khác 0 ném RangeError", () => {
  assert.throws(() => giaiMa("CS"), RangeError); // 'S' = 25 ⇒ 2 bit thừa = 01
  assert.deepEqual(giaiMa("CR"), b("f"));
});

test("khứ hồi ngẫu nhiên tất định", () => {
  let x = 12345;
  for (let len = 0; len < 40; len++) {
    const du = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      du[i] = x & 0xff;
    }
    assert.deepEqual(giaiMa(maHoa(du)), du);
  }
});

test("maHoaSo: số lớn và số âm", () => {
  assert.equal(maHoaSo(31n), "Z");
  assert.equal(maHoaSo(32n), "10");
  assert.equal(maHoaSo(2n ** 64n - 1n), "FZZZZZZZZZZZZ");
  assert.throws(() => maHoaSo(-1n), RangeError);
});
