function soNguyen(x, ten = "giá trị") {
  if (typeof x === "bigint") return x;
  if (typeof x === "number" && Number.isSafeInteger(x)) return BigInt(x);
  throw new TypeError(`${ten} phải là số nguyên (BigInt hoặc Number an toàn)`);
}

const tuyetDoi = (x) => (x < 0n ? -x : x);

function ucln(a, b) {
  a = tuyetDoi(a);
  b = tuyetDoi(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Chia lấy phần nguyên làm tròn XUỐNG (b > 0). */
function chiaSan(a, b) {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

function ep(b) {
  return b instanceof PhanSo ? b : new PhanSo(b);
}

export class PhanSo {
  constructor(tu, mau = 1n) {
    let t = soNguyen(tu, "tử");
    let m = soNguyen(mau, "mẫu");
    if (m === 0n) throw new RangeError("mẫu bằng 0");
    if (m < 0n) {
      t = -t;
      m = -m;
    }
    const g = ucln(t, m);
    this.tu = t / g;
    this.mau = m / g;
    Object.freeze(this);
  }

  static parse(chuoi) {
    if (typeof chuoi !== "string") throw new TypeError("parse cần chuỗi");
    const k = /^\s*([+-]?\d+)\s*(?:\/\s*([+-]?\d+)\s*)?$/.exec(chuoi);
    if (!k) throw new SyntaxError(`không phải phân số: ${JSON.stringify(chuoi)}`);
    return new PhanSo(BigInt(k[1]), k[2] === undefined ? 1n : BigInt(k[2]));
  }

  static tuLienPhanSo(ds) {
    if (!Array.isArray(ds) || ds.length === 0) throw new RangeError("liên phân số rỗng");
    let x = new PhanSo(ds[ds.length - 1]);
    for (let k = ds.length - 2; k >= 0; k--) x = new PhanSo(1n).chia(x).cong(soNguyen(ds[k]));
    return x;
  }

  cong(b) {
    b = ep(b);
    return new PhanSo(this.tu * b.mau + b.tu * this.mau, this.mau * b.mau);
  }

  tru(b) {
    b = ep(b);
    return new PhanSo(this.tu * b.mau - b.tu * this.mau, this.mau * b.mau);
  }

  nhan(b) {
    b = ep(b);
    return new PhanSo(this.tu * b.tu, this.mau * b.mau);
  }

  chia(b) {
    b = ep(b);
    if (b.tu === 0n) throw new RangeError("chia cho 0");
    return new PhanSo(this.tu * b.mau, this.mau * b.tu);
  }

  soSanh(b) {
    b = ep(b);
    const h = this.tu * b.mau - b.tu * this.mau;
    return h < 0n ? -1 : h > 0n ? 1 : 0;
  }

  bang(b) {
    return this.soSanh(b) === 0;
  }

  toString() {
    return this.mau === 1n ? `${this.tu}` : `${this.tu}/${this.mau}`;
  }

  lienPhanSo() {
    const ra = [];
    let p = this.tu;
    let q = this.mau;
    for (;;) {
      const a = chiaSan(p, q);
      ra.push(a);
      const r = p - a * q;
      if (r === 0n) return ra;
      [p, q] = [q, r];
    }
  }

  xapXi(N) {
    const n = soNguyen(N, "N");
    if (n < 1n) throw new RangeError("N phải ≥ 1");
    if (this.mau <= n) return this;
    // h0/k0, h1/k1: hai phân số hội tụ liên tiếp; dừng khi phân số hội tụ kế có mẫu > N
    let [h0, k0, h1, k1] = [0n, 1n, 1n, 0n];
    let p = this.tu;
    let q = this.mau;
    for (;;) {
      const a = chiaSan(p, q);
      const h2 = a * h1 + h0;
      const k2 = a * k1 + k0;
      if (k2 > n) break;
      [h0, k0, h1, k1] = [h1, k1, h2, k2];
      [p, q] = [q, p - a * q];
    }
    const t = (n - k0) / k1;
    const c1 = new PhanSo(h1, k1);
    const c2 = new PhanSo(h0 + t * h1, k0 + t * k1);
    const d1 = this.tru(c1);
    const d2 = this.tru(c2);
    const s = new PhanSo(tuyetDoi(d1.tu), d1.mau).soSanh(new PhanSo(tuyetDoi(d2.tu), d2.mau));
    if (s < 0) return c1;
    if (s > 0) return c2;
    return c1.soSanh(c2) < 0 ? c1 : c2;
  }
}
