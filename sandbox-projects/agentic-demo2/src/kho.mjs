import { caCuaMoc } from "./ca.mjs";

/** Gộp số lượng NG theo ca. Trả object {CA1,CA2,CA3} -> tổng soNg. */
export function gomNgTheoCa(banGhi, gioBatDau) {
  const r = { CA1: 0, CA2: 0, CA3: 0 };
  for (const b of banGhi) {
    const ca = caCuaMoc(b.moc, gioBatDau);
    r[ca] += b.soNg;
  }
  return r;
}

/** Tỷ lệ NG phần trăm, làm tròn 2 chữ số. tong <= 0 trả 0. */
export function tyLeNg(tong, ng) {
  return Math.round((ng / tong) * 10000) / 100;
}
