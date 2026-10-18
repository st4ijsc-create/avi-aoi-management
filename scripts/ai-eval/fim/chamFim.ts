/**
 * ★★★ ĐỢT 4C — chấm bộ đo FIM (ghost-text). Thuần — kiểm thước ở `chamFim.test.ts`.
 *
 * Chỉ số (trên gợi ý ĐÃ QUA `catGoiY` của extension — tức đúng thứ người dùng thấy):
 *   · khớp dòng đầu: dòng đầu gợi ý == dòng đầu đáp án (bỏ khoảng trắng CUỐI dòng);
 *   · khớp toàn đoạn: mọi dòng khớp (bỏ khoảng trắng cuối dòng + dòng trống cuối);
 *   · tương tự ký tự: 1 − Levenshtein / max(độ dài);
 *   · tỉ lệ rỗng: không gợi ý gì (ghost-text im lặng — không sai, nhưng cũng không giúp).
 */
export interface MauFim {
  id: string;
  /** Đường tệp nguồn, tương đối gốc repo. */
  tep: string;
  /** Commit mà tệp được đọc ra (bộ mẫu không trôi theo đĩa). */
  ban?: string;
  ngonNgu: "ts" | "js" | "py" | "cs";
  kieu: "giua-dong" | "dong" | "khoi";
  tienTo: string;
  hauTo: string;
  dapAn: string;
}

export interface KetQuaMot {
  id: string;
  ngonNgu: MauFim["ngonNgu"];
  kieu: MauFim["kieu"];
  khopDongDau: boolean;
  khopToanDoan: boolean;
  tuongTu: number;
  rong: boolean;
  ms: number;
}

function chuanDong(s: string): string[] {
  const ds = s.replace(/\r\n?/g, "\n").split("\n").map((x) => x.trimEnd());
  while (ds.length > 0 && ds[ds.length - 1] === "") ds.pop();
  return ds;
}

export function doTuongTu(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let truoc = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const nay = [i];
    for (let j = 1; j <= m; j++) {
      nay[j] = Math.min(truoc[j] + 1, nay[j - 1] + 1, truoc[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    truoc = nay;
  }
  return 1 - truoc[m] / Math.max(n, m);
}

export function chamMot(mau: MauFim, goiY: string, ms: number): KetQuaMot {
  const a = chuanDong(goiY);
  const b = chuanDong(mau.dapAn);
  const rong = a.length === 0;
  return {
    id: mau.id,
    ngonNgu: mau.ngonNgu,
    kieu: mau.kieu,
    khopDongDau: !rong && a[0] === b[0],
    khopToanDoan: !rong && a.join("\n") === b.join("\n"),
    tuongTu: rong ? 0 : doTuongTu(a.join("\n"), b.join("\n")),
    rong,
    ms,
  };
}

export function phanVi(ds: number[], p: number): number {
  if (ds.length === 0) return 0;
  const x = [...ds].sort((u, v) => u - v);
  return x[Math.min(x.length - 1, Math.ceil(p * x.length) - 1)];
}

export interface TongHop {
  n: number;
  khopDongDau: number;
  khopToanDoan: number;
  tuongTu: number;
  tiLeRong: number;
  p50: number;
  p95: number;
}

export function tongHop(ds: KetQuaMot[]): TongHop {
  const n = ds.length || 1;
  const tb = (f: (k: KetQuaMot) => number) => ds.reduce((s, k) => s + f(k), 0) / n;
  return {
    n: ds.length,
    khopDongDau: tb((k) => (k.khopDongDau ? 1 : 0)),
    khopToanDoan: tb((k) => (k.khopToanDoan ? 1 : 0)),
    tuongTu: tb((k) => k.tuongTu),
    tiLeRong: tb((k) => (k.rong ? 1 : 0)),
    p50: phanVi(ds.map((k) => k.ms), 0.5),
    p95: phanVi(ds.map((k) => k.ms), 0.95),
  };
}
