export type SoSanh<T> = (a: T, b: T) => number;

type Nut<T> = { giaTri: T; thuTu: number };

export class HangUuTien<T> {
  #soSanh: SoSanh<T>;
  #khoaCua: ((x: T) => string) | undefined;
  #heap: Nut<T>[] = [];
  #viTri = new Map<string, number>();
  #dem = 0;

  constructor(soSanh: SoSanh<T>, khoaCua?: (x: T) => string) {
    this.#soSanh = soSanh;
    this.#khoaCua = khoaCua;
  }

  size(): number {
    return this.#heap.length;
  }

  peek(): T | undefined {
    return this.#heap.length ? this.#heap[0].giaTri : undefined;
  }

  push(x: T): void {
    if (this.#khoaCua) {
      const k = this.#khoaCua(x);
      if (this.#viTri.has(k)) throw new RangeError(`khoá đã có: ${k}`);
    }
    this.#heap.push({ giaTri: x, thuTu: this.#dem++ });
    this.#ghiViTri(this.#heap.length - 1);
    this.#len(this.#heap.length - 1);
  }

  pop(): T | undefined {
    const h = this.#heap;
    if (!h.length) return undefined;
    const dau = h[0];
    const cuoi = h.pop()!;
    if (h.length) {
      h[0] = cuoi;
      this.#ghiViTri(0);
      this.#xuong(0);
    }
    if (this.#khoaCua) this.#viTri.delete(this.#khoaCua(dau.giaTri));
    return dau.giaTri;
  }

  capNhat(x: T): boolean {
    if (!this.#khoaCua) throw new TypeError("hàng không có hàm khoá");
    const i = this.#viTri.get(this.#khoaCua(x));
    if (i === undefined) return false;
    const cu = this.#heap[i];
    this.#heap[i] = { giaTri: x, thuTu: cu.thuTu };
    this.#len(i);
    this.#xuong(this.#viTri.get(this.#khoaCua(x))!);
    return true;
  }

  #truoc(a: Nut<T>, b: Nut<T>): boolean {
    const c = this.#soSanh(a.giaTri, b.giaTri);
    return c !== 0 ? c < 0 : a.thuTu < b.thuTu;
  }

  #ghiViTri(i: number): void {
    if (this.#khoaCua) this.#viTri.set(this.#khoaCua(this.#heap[i].giaTri), i);
  }

  #doi(i: number, j: number): void {
    const h = this.#heap;
    [h[i], h[j]] = [h[j], h[i]];
    this.#ghiViTri(i);
    this.#ghiViTri(j);
  }

  #len(i: number): void {
    while (i > 0) {
      const cha = (i - 1) >> 1;
      if (!this.#truoc(this.#heap[i], this.#heap[cha])) break;
      this.#doi(i, cha);
      i = cha;
    }
  }

  #xuong(i: number): void {
    const h = this.#heap;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.#truoc(h[l], h[m])) m = l;
      if (r < h.length && this.#truoc(h[r], h[m])) m = r;
      if (m === i) return;
      this.#doi(i, m);
      i = m;
    }
  }
}

export function topK<T>(ds: Iterable<T>, k: number, soSanh: SoSanh<T>): T[] {
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k không hợp lệ: ${k}`);
  const h = new HangUuTien<T>(soSanh);
  for (const x of ds) h.push(x);
  const ra: T[] = [];
  while (ra.length < k && h.size() > 0) ra.push(h.pop()!);
  return ra;
}
