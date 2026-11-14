/**
 * Bộ ĐO dùng chung cho test ReDoS tất định của bộ che (`cheDuLieu.redos.test.ts`, chạy cả trong Worker qua `redosDo.worker.ts`).
 * Thuần, không import, không đĩa / mạng. KHÔNG dùng trong mã sản xuất.
 *
 *   · `doCaoSao` — "độ cao sao" của nguồn regex: số tầng nhóm lồng nhau mang lượng từ KHÔNG CHẶN (*, +, {n,}).
 *     GIỚI HẠN: độ cao 1 KHÔNG chứng minh an toàn — nhánh CHỒNG nhau dưới một lượng từ không chặn ((?:a|a)+, (?:\w|\d)+) vẫn lùi
 *     hàm mũ ở độ cao 1. Lớp đó do phép đo ĐỘNG (A2 trong Worker có hạn) bắt, không do hàm này.
 *   · `bocPrototype` — bọc RegExp.prototype để đếm "công" (số ký tự giao cho mỗi lần gọi regex) và ghi mọi regex đã chạy.
 */

/** Độ cao sao của nguồn regex. Bỏ qua lớp ký tự và ký tự thoát. */
export function doCaoSao(nguon: string): number {
  const ngan: number[] = [0];
  let i = 0;
  const luongTu = (j: number): [boolean, number] => {
    const c = nguon[j];
    if (c === "*" || c === "+") return [true, j + 1 + (nguon[j + 1] === "?" ? 1 : 0)];
    if (c === "?") return [false, j + 1];
    if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}\??/.exec(nguon.slice(j));
      if (m) return [m[2] !== undefined && m[3] === "", j + m[0].length];
    }
    return [false, j];
  };
  const nguyenTu = (j: number) => {
    const [kc, k] = luongTu(j);
    if (kc) ngan[ngan.length - 1] = Math.max(ngan[ngan.length - 1]!, 1);
    i = k;
  };
  while (i < nguon.length) {
    const c = nguon[i]!;
    if (c === "\\") {
      nguyenTu(i + 2);
    } else if (c === "[") {
      i++;
      if (nguon[i] === "^") i++;
      if (nguon[i] === "]") i++;
      while (i < nguon.length && nguon[i] !== "]") i += nguon[i] === "\\" ? 2 : 1;
      nguyenTu(i + 1);
    } else if (c === "(") {
      ngan.push(0);
      i++;
      if (nguon[i] === "?") {
        i++;
        if (nguon[i] === "<" && nguon[i + 1] !== "=" && nguon[i + 1] !== "!") i = nguon.indexOf(">", i) + 1; // (?<ten>
        else i += nguon[i] === "<" ? 2 : 1; // (?<= (?<! (?: (?= (?!
      }
    } else if (c === ")") {
      const trong = ngan.pop()!;
      const [kc, k] = luongTu(i + 1);
      i = k;
      ngan[ngan.length - 1] = Math.max(ngan[ngan.length - 1]!, kc ? trong + 1 : trong);
    } else {
      nguyenTu(i + 1);
    }
  }
  return ngan[0]!;
}

export interface GhiCong {
  /** Tổng số ký tự đã giao cho các lần gọi regex được đếm. */
  cong: number;
  /** Mọi regex đã chạy, khoá `/<source>/<flags>`. */
  daChay: Map<string, RegExp>;
}

type HamRegex = (this: RegExp, ...a: unknown[]) => unknown;
const KHOA: readonly PropertyKey[] = ["exec", "test", Symbol.replace, Symbol.match, Symbol.matchAll, Symbol.split, Symbol.search];

/**
 * Bọc RegExp.prototype; trả hàm KHÔI PHỤC (gọi trong finally). Quy tắc đếm:
 *   · lời gọi ngoài cùng: cộng độ dài chuỗi; regex g/y gọi exec/test: chỉ đoạn từ lastIndex trước tới sau;
 *   · lời gọi LỒNG của CÙNG ĐỐI TƯỢNG (exec nội bộ của @@replace/@@match/@@search khi exec đã bị bọc) ⇒ KHÔNG đếm lại;
 *   · bản sao species mà @@split tạo (cùng nguồn, đối tượng khác, gọi ngay trong khung @@split) ⇒ KHÔNG đếm lại;
 *   · @@matchAll tự nó không quét gì (trả bộ lặp) ⇒ đếm 0; exec của bản sao khi lặp chạy SAU, ngoài khung, đếm theo đoạn lastIndex;
 *   · đối tượng KHÁC (kể cả cùng nguồn) gọi từ callback ⇒ ĐẾM (rà kiem-dinh C4).
 * GIỚI HẠN còn lại: callback gọi CHÍNH đối tượng regex đang thay (`s.replace(re, () => re.test(s))`) ⇒ không phân biệt được với exec
 * nội bộ ⇒ KHÔNG đếm.
 */
export function bocPrototype(ghi: GhiCong): () => void {
  const P = RegExp.prototype as unknown as Record<PropertyKey, HamRegex>;
  const goc = new Map(KHOA.map((k) => [k, P[k]!] as const));
  const ngan: Array<{ re: RegExp; k: PropertyKey }> = [];
  for (const k of KHOA) {
    const g = goc.get(k)!;
    P[k] = function (this: RegExp, s: unknown, ...r: unknown[]) {
      ghi.daChay.set(`/${this.source}/${this.flags}`, this);
      const cha = ngan[ngan.length - 1];
      const longCungDoiTuong = ngan.some((f) => f.re === this);
      const banSaoSplit = cha !== undefined && cha.k === Symbol.split && cha.re.source === this.source;
      const tinh = !longCungDoiTuong && !banSaoSplit && k !== Symbol.matchAll;
      const chuoi = String(s);
      const coTrangThai = (k === "exec" || k === "test") && (this.global || this.sticky);
      const truoc = this.lastIndex;
      ngan.push({ re: this, k });
      try {
        return Reflect.apply(g, this, [s, ...r]);
      } finally {
        ngan.pop();
        if (tinh) ghi.cong += coTrangThai ? (this.lastIndex > 0 ? this.lastIndex : chuoi.length) - Math.min(truoc, chuoi.length) : chuoi.length;
      }
    };
  }
  return () => {
    for (const k of KHOA) P[k] = goc.get(k)!;
  };
}
