// Phép tính tiền dùng chung. Mọi số tiền là đồng (số nguyên).

/** Làm tròn tới đồng. */
export function lamTron(x) {
  return Math.round(x);
}

/** `phanTram` % của `soTien`, làm tròn tới đồng. */
export function phanTramCua(soTien, phanTram) {
  return lamTron((soTien * phanTram) / 100);
}

export function congTien(...ds) {
  return ds.reduce((s, x) => s + x, 0);
}
