import { test } from "node:test";
import assert from "node:assert/strict";
import { HangUuTien, topK } from "../src/hangUuTien.ts";

type Viec = { k: string; p: number };
const theoP = (a: Viec, b: Viec) => a.p - b.p;
const rutHet = <T>(h: HangUuTien<T>): T[] => {
  const ra: T[] = [];
  while (h.size() > 0) ra.push(h.pop() as T);
  return ra;
};

test("hàng rỗng: size 0, peek/pop trả undefined", () => {
  const h = new HangUuTien<number>((a, b) => a - b);
  assert.equal(h.size(), 0);
  assert.equal(h.peek(), undefined);
  assert.equal(h.pop(), undefined);
  h.push(1);
  assert.equal(h.pop(), 1);
  assert.equal(h.pop(), undefined);
  assert.equal(h.size(), 0);
});

test("ổn định: cùng ưu tiên thì vào trước ra trước", () => {
  const h = new HangUuTien<Viec>(theoP);
  const vao: Viec[] = [];
  for (let i = 0; i < 30; i++) vao.push({ k: `v${i}`, p: (i * 7) % 3 });
  for (const v of vao) h.push(v);
  const ra = rutHet(h).map((v) => v.k);
  const kyVong = [0, 1, 2].flatMap((p) => vao.filter((v) => v.p === p).map((v) => v.k));
  assert.deepEqual(ra, kyVong);
});

test("comparator đảo ngược ⇒ hàng lớn trước, vẫn ổn định", () => {
  const h = new HangUuTien<Viec>((a, b) => b.p - a.p);
  for (const [k, p] of [["a", 1], ["b", 3], ["c", 1], ["d", 3], ["e", 2]] as const) h.push({ k, p });
  assert.deepEqual(rutHet(h).map((v) => v.k), ["b", "d", "e", "a", "c"]);
});

test("capNhat giữ thứ tự vào ban đầu khi hoà ưu tiên", () => {
  const h = new HangUuTien<Viec>(theoP, (v) => v.k);
  h.push({ k: "a", p: 5 });
  h.push({ k: "b", p: 3 });
  h.push({ k: "c", p: 5 });
  assert.equal(h.capNhat({ k: "c", p: 3 }), true);
  assert.equal(h.peek()!.k, "b");
  assert.equal(h.capNhat({ k: "a", p: 3 }), true);
  assert.deepEqual(rutHet(h), [{ k: "a", p: 3 }, { k: "b", p: 3 }, { k: "c", p: 3 }]);
});

test("capNhat tăng ưu tiên (đẩy xuống sau)", () => {
  const h = new HangUuTien<Viec>(theoP, (v) => v.k);
  for (const [k, p] of [["x", 1], ["y", 2], ["z", 3], ["w", 4]] as const) h.push({ k, p });
  assert.equal(h.capNhat({ k: "x", p: 10 }), true);
  assert.equal(h.size(), 4);
  assert.deepEqual(rutHet(h).map((v) => v.k), ["y", "z", "w", "x"]);
});

test("capNhat khoá không có ⇒ false; không có hàm khoá ⇒ TypeError", () => {
  const h = new HangUuTien<Viec>(theoP, (v) => v.k);
  h.push({ k: "a", p: 1 });
  assert.equal(h.capNhat({ k: "q", p: 0 }), false);
  assert.equal(h.size(), 1);
  h.pop();
  assert.equal(h.capNhat({ k: "a", p: 0 }), false);
  const h2 = new HangUuTien<Viec>(theoP);
  h2.push({ k: "a", p: 1 });
  assert.throws(() => h2.capNhat({ k: "a", p: 0 }), TypeError);
});

test("push khoá trùng ⇒ RangeError; sau khi pop thì push lại được", () => {
  const h = new HangUuTien<Viec>(theoP, (v) => v.k);
  h.push({ k: "a", p: 2 });
  assert.throws(() => h.push({ k: "a", p: 1 }), RangeError);
  assert.equal(h.size(), 1);
  assert.deepEqual(h.pop(), { k: "a", p: 2 });
  h.push({ k: "a", p: 1 });
  assert.equal(h.size(), 1);
  const h2 = new HangUuTien<Viec>(theoP);
  h2.push({ k: "a", p: 1 });
  h2.push({ k: "a", p: 1 });
  assert.equal(h2.size(), 2);
});

test("topK: hoà ưu tiên giữ thứ tự đầu vào, k = 0, k > n, nhận Iterable", () => {
  const ds: Viec[] = [{ k: "a", p: 2 }, { k: "b", p: 1 }, { k: "c", p: 2 }, { k: "d", p: 1 }, { k: "e", p: 2 }];
  assert.deepEqual(topK(ds, 3, theoP).map((v) => v.k), ["b", "d", "a"]);
  assert.deepEqual(topK(ds, 0, theoP), []);
  assert.deepEqual(topK(ds, 99, theoP).map((v) => v.k), ["b", "d", "a", "c", "e"]);
  assert.deepEqual(topK(new Set([3, 1, 2]), 2, (a, b) => b - a), [3, 2]);
  assert.deepEqual(ds.map((v) => v.k), ["a", "b", "c", "d", "e"]);
});

test("topK: k âm hoặc không nguyên ⇒ RangeError", () => {
  assert.throws(() => topK([1, 2], -1, (a, b) => a - b), RangeError);
  assert.throws(() => topK([1, 2], 1.5, (a, b) => a - b), RangeError);
  assert.throws(() => topK([1, 2], Number.NaN, (a, b) => a - b), RangeError);
});

test("ngẫu nhiên tất định: khớp mô hình quét tuyến tính", () => {
  const h = new HangUuTien<Viec>(theoP, (v) => v.k);
  const moHinh: { k: string; p: number; thuTu: number }[] = [];
  let thuTu = 0;
  let x = 2024;
  const r = () => (x = (x * 1103515245 + 12345) % 2147483648);
  for (let buoc = 0; buoc < 3000; buoc++) {
    const loai = r() % 4;
    if (loai === 0) {
      const v = h.pop();
      if (moHinh.length === 0) {
        assert.equal(v, undefined);
        continue;
      }
      let m = 0;
      for (let i = 1; i < moHinh.length; i++) {
        const a = moHinh[i], b = moHinh[m];
        if (a.p < b.p || (a.p === b.p && a.thuTu < b.thuTu)) m = i;
      }
      const [mm] = moHinh.splice(m, 1);
      assert.deepEqual(v, { k: mm.k, p: mm.p }, `bước ${buoc}`);
    } else if (loai === 3) {
      const k = `k${r() % 60}`;
      const p = r() % 8;
      const ok = h.capNhat({ k, p });
      const o = moHinh.find((m) => m.k === k);
      assert.equal(ok, !!o, `bước ${buoc}`);
      if (o) o.p = p;
    } else {
      const k = `k${r() % 60}`;
      const p = r() % 8;
      if (moHinh.some((m) => m.k === k)) {
        assert.throws(() => h.push({ k, p }), RangeError);
      } else {
        h.push({ k, p });
        moHinh.push({ k, p, thuTu: thuTu++ });
      }
    }
    assert.equal(h.size(), moHinh.length);
  }
});
