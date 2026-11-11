// Cộng dồn dòng đơn. Một dòng: { sanPham, soLuong, donGia, giamPhanTram }. Dòng trả hàng: soLuong < 0.
import { congTien, phanTramCua } from "./tien.mjs";

export const VAT_PHAN_TRAM = 8;

/** Tiền một dòng sau giảm giá (âm với dòng trả hàng). */
export function tienDong(dong) {
  const goc = dong.soLuong * dong.donGia;
  return goc - phanTramCua(goc, dong.giamPhanTram ?? 0);
}

/** { soDong, truocThue, thue, tong } của một đơn. Thuế tính trên từng dòng. */
export function tongDon(don) {
  const tien = don.dong.map(tienDong);
  const thue = tien.map((t) => phanTramCua(t, VAT_PHAN_TRAM));
  const truocThue = congTien(...tien);
  const tongThue = congTien(...thue);
  return { soDong: don.dong.length, truocThue, thue: tongThue, tong: truocThue + tongThue };
}
