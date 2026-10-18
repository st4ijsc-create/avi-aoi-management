import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDong, apDung, apNguoc } from "../src/diff.mjs";

const op = (s) => ({ loai: s[0], dong: s.slice(1) });

test("thay một dòng: xoá đứng TRƯỚC thêm", () => {
  assert.deepEqual(diffDong(["a", "b", "c"], ["a", "x", "c"]), [" a", "-b", "+x", " c"].map(op));
});

test("khối thay toàn bộ (mọi bước đều hoà) ⇒ mọi dòng xoá rồi mới tới dòng thêm", () => {
  assert.deepEqual(diffDong(["p", "q"], ["r", "s"]), ["-p", "-q", "+r", "+s"].map(op));
});

test("mảng rỗng ở một hoặc hai phía", () => {
  assert.deepEqual(diffDong([], []), []);
  assert.deepEqual(diffDong([], ["a", "b"]), ["+a", "+b"].map(op));
  assert.deepEqual(diffDong(["a", "b"], []), ["-a", "-b"].map(op));
});

test("nhiều khối thay đổi", () => {
  const d = diffDong(["a", "b", "c", "d", "e"], ["a", "c", "d", "x", "e", "f"]);
  assert.deepEqual(d, [" a", "-b", " c", " d", "+x", " e", "+f"].map(op));
});

test("hoà khi đổi chỗ / dòng lặp: ưu tiên xoá", () => {
  assert.deepEqual(diffDong(["x", "a"], ["a", "x"]), ["-x", " a", "+x"].map(op));
  assert.deepEqual(diffDong(["a", "a", "b"], ["a", "b", "a"]), [" a", "-a", " b", "+a"].map(op));
});

test("so dòng chính xác: khoảng trắng cuối và dòng rỗng là khác nhau", () => {
  assert.deepEqual(diffDong(["a ", "b"], ["a", "b"]), ["-a ", "+a", " b"].map(op));
  assert.deepEqual(diffDong(["", "a"], ["a", ""]), ["-", " a", "+"].map(op));
});

test("apDung / apNguoc ném Error khi bản vá không khớp", () => {
  const d = [" a", "-b", "+x", " c"].map(op);
  assert.throws(() => apDung(["a", "B", "c"], d), Error);
  assert.throws(() => apDung(["a", "b", "c", "d"], d), Error);
  assert.throws(() => apDung(["a", "b"], d), Error);
  assert.throws(() => apNguoc(["a", "b", "c"], d), Error);
  assert.throws(() => apDung(["a"], [{ loai: "?", dong: "a" }]), Error);
  assert.deepEqual(apNguoc(["a", "x", "c"], d), ["a", "b", "c"]);
});

function lcs(a, b) {
  // DP tiền tố — độc lập với cách cài của lời giải
  let truoc = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const nay = [0];
    for (let j = 1; j <= b.length; j++) nay[j] = a[i - 1] === b[j - 1] ? truoc[j - 1] + 1 : Math.max(truoc[j], nay[j - 1]);
    truoc = nay;
  }
  return truoc[b.length];
}

test("ngẫu nhiên có hạt giống: tối thiểu, khứ hồi, xoá trước thêm trong từng khối", () => {
  let x = 20261018;
  const r = (k) => ((x = (x * 48271) % 2147483647), x % k);
  for (let lan = 0; lan < 150; lan++) {
    const cu = Array.from({ length: r(14) }, () => "abcd"[r(4)]);
    const moi = Array.from({ length: r(14) }, () => "abcd"[r(4)]);
    const d = diffDong(cu, moi);
    assert.equal(d.filter((t) => t.loai === " ").length, lcs(cu, moi));
    assert.deepEqual(apDung(cu, d), moi);
    assert.deepEqual(apNguoc(moi, d), cu);
    for (let k = 1; k < d.length; k++) assert.ok(!(d[k - 1].loai === "+" && d[k].loai === "-"), `"+" đứng trước "-" ở lần ${lan}`);
  }
});

test("2000 × 2000 dòng, đầu vào bị đóng băng không bị sửa", () => {
  const cu = Object.freeze(Array.from({ length: 2000 }, (_, i) => `d${i}`));
  const moi = Object.freeze(Array.from({ length: 2000 }, (_, i) => (i % 10 === 0 ? `x${i}` : `d${i}`)));
  const ky = [];
  for (let i = 0; i < 2000; i++) {
    if (i % 10 === 0) ky.push({ loai: "-", dong: `d${i}` }, { loai: "+", dong: `x${i}` });
    else ky.push({ loai: " ", dong: `d${i}` });
  }
  const t0 = Date.now();
  const d = diffDong(cu, moi);
  assert.ok(Date.now() - t0 < 4000, "quá chậm");
  assert.deepEqual(d, ky);
});
