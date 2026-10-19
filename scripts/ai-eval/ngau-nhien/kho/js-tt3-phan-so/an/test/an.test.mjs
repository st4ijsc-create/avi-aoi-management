import { test } from "node:test";
import assert from "node:assert/strict";
import { PhanSo } from "../src/phanSo.mjs";

const ps = (t, m) => new PhanSo(t, m);
const chuoi = (x) => x.toString();

test("chuẩn hoá: số 0, hai dấu âm, BigInt lớn, mẫu mặc định", () => {
  const khong = ps(0, -5);
  assert.equal(khong.tu, 0n);
  assert.equal(khong.mau, 1n);
  assert.equal(chuoi(khong), "0");
  assert.equal(chuoi(ps(-4n, -6n)), "2/3");
  assert.equal(chuoi(ps(2n ** 80n, 2n ** 78n)), "4");
  assert.equal(chuoi(ps(2n ** 70n + 1n, 2n ** 70n)), `${2n ** 70n + 1n}/${2n ** 70n}`);
  assert.equal(chuoi(new PhanSo(7)), "7");
  assert.equal(typeof ps(3, 9).tu, "bigint");
});

test("hàm dựng: mẫu 0 ⇒ RangeError, không phải số nguyên ⇒ TypeError", () => {
  assert.throws(() => ps(1, 0), RangeError);
  assert.throws(() => ps(1n, 0n), RangeError);
  assert.throws(() => ps(1.5, 2), TypeError);
  assert.throws(() => ps("3", 1), TypeError);
  assert.throws(() => ps(2 ** 60, 1), TypeError);
  assert.throws(() => ps(1, NaN), TypeError);
});

test("parse: khoảng trắng, dấu ở mẫu, dấu +, số 0 đứng đầu", () => {
  assert.equal(chuoi(PhanSo.parse(" 4 / -8 ")), "-1/2");
  assert.equal(chuoi(PhanSo.parse("+3")), "3");
  assert.equal(chuoi(PhanSo.parse("007/014")), "1/2");
  assert.equal(chuoi(PhanSo.parse("\t-10/-4\n")), "5/2");
  assert.equal(chuoi(PhanSo.parse("123456789012345678901234567890/10")), "12345678901234567890123456789");
});

test("parse: chuỗi sai ⇒ SyntaxError, mẫu 0 ⇒ RangeError, không phải chuỗi ⇒ TypeError", () => {
  for (const s of ["", "  ", "1.5", "1/2/3", "- 3", "a/b", "3/", "/3", "1 2", "0x10", "1e3", "--1"]) {
    assert.throws(() => PhanSo.parse(s), SyntaxError, JSON.stringify(s));
  }
  assert.throws(() => PhanSo.parse("4/0"), RangeError);
  assert.throws(() => PhanSo.parse(5), TypeError);
});

test("bốn phép tính, trộn số nguyên, không sửa toán hạng", () => {
  const a = ps(5, 6);
  const b = a.tru(1);
  assert.equal(chuoi(b), "-1/6");
  assert.equal(chuoi(a), "5/6");
  const c = b.nhan(3n);
  assert.equal(chuoi(c), "-1/2");
  assert.equal(chuoi(c.chia(ps(-1, 4))), "2");
  assert.equal(chuoi(ps(2, 3).nhan(0)), "0");
  assert.equal(chuoi(ps(1, 4).cong(ps(3, 4))), "1");
  assert.equal(chuoi(ps(1, 3).chia(2)), "1/6");
  assert.ok(b instanceof PhanSo);
});

test("chia cho 0 ⇒ RangeError; toán hạng sai kiểu ⇒ TypeError", () => {
  assert.throws(() => ps(1, 2).chia(0), RangeError);
  assert.throws(() => ps(1, 2).chia(0n), RangeError);
  assert.throws(() => ps(1, 2).chia(ps(0, 7)), RangeError);
  assert.throws(() => ps(1, 2).cong("1"), TypeError);
  assert.throws(() => ps(1, 2).nhan(0.5), TypeError);
});

test("so sánh chính xác với số rất lớn", () => {
  const lon = 10n ** 30n;
  assert.equal(ps(lon + 1n, lon).soSanh(1), 1);
  assert.equal(ps(lon - 1n, lon).soSanh(ps(lon - 2n, lon - 1n)), 1);
  assert.equal(ps(-1, 3).soSanh(ps(-1, 2)), 1);
  assert.equal(ps(-1, 2).soSanh(ps(-1, 3)), -1);
  assert.equal(ps(2, 4).soSanh(ps(1, 2)), 0);
  assert.equal(ps(2, 4).bang(ps(-1, -2)), true);
  assert.equal(ps(0, 9).bang(0), true);
  assert.equal(ps(1, 3).bang(ps(1, 2)), false);
});

test("liên phân số chính tắc (phần nguyên làm tròn xuống)", () => {
  assert.deepEqual(ps(415, 93).lienPhanSo(), [4n, 2n, 6n, 7n]);
  assert.deepEqual(ps(-7, 3).lienPhanSo(), [-3n, 1n, 2n]);
  assert.deepEqual(ps(-1, 2).lienPhanSo(), [-1n, 2n]);
  assert.deepEqual(ps(1, 3).lienPhanSo(), [0n, 3n]);
  assert.deepEqual(ps(5).lienPhanSo(), [5n]);
  assert.deepEqual(ps(0).lienPhanSo(), [0n]);
  assert.deepEqual(ps(-6).lienPhanSo(), [-6n]);
});

test("tuLienPhanSo: dựng lại phân số, lỗi khi rỗng / chia 0", () => {
  assert.equal(chuoi(PhanSo.tuLienPhanSo([4n, 2n, 6n, 7n])), "415/93");
  assert.equal(chuoi(PhanSo.tuLienPhanSo([-3, 1, 2])), "-7/3");
  assert.equal(chuoi(PhanSo.tuLienPhanSo([5n])), "5");
  assert.equal(chuoi(PhanSo.tuLienPhanSo([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])), "89/55");
  assert.throws(() => PhanSo.tuLienPhanSo([]), RangeError);
  assert.throws(() => PhanSo.tuLienPhanSo([1, 0]), RangeError);
});

test("xấp xỉ π: 3, 22/7, 311/99, 355/113; đúng ngay nếu mẫu ≤ N; lỗi N", () => {
  const pi = PhanSo.parse("314159265358979/100000000000000");
  assert.equal(chuoi(pi.xapXi(1)), "3");
  assert.equal(chuoi(pi.xapXi(10)), "22/7");
  assert.equal(chuoi(pi.xapXi(100n)), "311/99");
  assert.equal(chuoi(pi.xapXi(1000)), "355/113");
  assert.equal(chuoi(pi.nhan(-1).xapXi(10)), "-22/7");
  assert.equal(chuoi(ps(3, 7).xapXi(7)), "3/7");
  assert.throws(() => pi.xapXi(0), RangeError);
  assert.throws(() => pi.xapXi(-5n), RangeError);
  assert.throws(() => pi.xapXi(1.5), TypeError);
});

test("xấp xỉ: hai ứng viên cách đều ⇒ chọn phân số NHỎ HƠN", () => {
  assert.equal(chuoi(ps(1, 2).xapXi(1)), "0");
  assert.equal(chuoi(ps(-1, 2).xapXi(1)), "-1");
  assert.equal(chuoi(ps(3, 4).xapXi(2)), "1/2");
  assert.equal(chuoi(ps(5, 2).xapXi(1)), "2");
});

test("xấp xỉ khớp tìm vét cạn trên nhiều giá trị", () => {
  // vét cạn độc lập: với mỗi mẫu q ≤ N, xét hai tử bao quanh x·q; khoảng cách so chéo bằng BigInt
  function vetCan(t, m, N) {
    let tot = null;
    for (let q = 1n; q <= N; q++) {
      const san = (t * q - (((t * q) % m) + m) % m) / m;
      for (const p of [san, san + 1n]) {
        const kc = (x) => { const v = x.p * m - t * x.q; return [v < 0n ? -v : v, x.q * m]; };
        const ung = { p, q };
        if (!tot) { tot = ung; continue; }
        const [a1, b1] = kc(ung), [a2, b2] = kc(tot);
        const s = a1 * b2 - a2 * b1;
        if (s < 0n || (s === 0n && p * tot.q < tot.p * q)) tot = ung;
      }
    }
    return new PhanSo(tot.p, tot.q).toString();
  }
  const ds = [[1000n, 1n], [355n, 113n], [-13n, 29n], [7n, 3n], [1n, 7n], [-271828n, 100000n], [17n, 64n], [0n, 1n], [99n, 100n]];
  const dsN = [1n, 2n, 3n, 5n, 7n, 12n, 30n, 64n];
  for (const [t, m] of ds) {
    for (const N of dsN) {
      const x = new PhanSo(t, m);
      assert.equal(chuoi(x.xapXi(N)), vetCan(x.tu, x.mau, N), `${chuoi(x)} N=${N}`);
    }
  }
});
