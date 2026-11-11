// Phép tính tiền dùng chung. Mọi số tiền là đồng (số nguyên).

/** Làm tròn tới đồng. */
export function lamTron(x) {
  // Làm tròn nửa xa số 0: đối xứng giữa bán (dương) và trả hàng (âm). Math.round(-0.5) = -0 làm lệch 1 đồng.
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** `phanTram` % của `soTien`, làm tròn tới đồng. */
export function phanTramCua(soTien, phanTram) {
  return lamTron((soTien * phanTram) / 100);
}

export function congTien(...ds) {
  return ds.reduce((s, x) => s + x, 0);
}
