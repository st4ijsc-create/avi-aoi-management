export type MaGiamGia =
  | { loai: "phan-tram"; ma: string; phanTram: number; giamToiDa?: number }
  | { loai: "bac"; ma: string; bac: { tu: number; giam: number }[] };

/** Số tiền được giảm (VND, nguyên) cho một tạm tính; không bao giờ vượt tạm tính. */
export function tinhGiam(ma: MaGiamGia, tamTinh: number): number {
  let giam = 0;
  if (ma.loai === "phan-tram") {
    if (!(ma.phanTram > 0 && ma.phanTram <= 100)) {
      throw new RangeError(`Phần trăm giảm không hợp lệ: ${ma.phanTram}`);
    }
    giam = Math.floor((tamTinh * ma.phanTram) / 100);
    if (ma.giamToiDa !== undefined) giam = Math.min(giam, ma.giamToiDa);
  } else {
    let tuCaoNhat = -Infinity;
    for (const b of ma.bac) {
      if (tamTinh >= b.tu && b.tu > tuCaoNhat) {
        tuCaoNhat = b.tu;
        giam = b.giam;
      }
    }
  }
  return Math.max(0, Math.min(giam, tamTinh));
}
