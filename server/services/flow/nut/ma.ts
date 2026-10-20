/**
 * ★★ Đợt 8.2 Task 3 — NODE `du-lieu.ma`: mã JS nhỏ của người viết luồng, chạy trong Docker cách ly (`lib/chayMaCachLy.ts`).
 * Tham số `ma` = THÂN của `async (items) => { … }` (CHUỖI CỐ ĐỊNH — không qua biểu thức, không có `$env`/`$node`). `items` là
 * mảng `{ json }` của cổng `main`; trả về mảng phần tử `{ json: {...} }` hoặc đối tượng thường (tự bọc thành `{ json }`).
 * Hạng `thuan`, `idempotent` (không mạng, không đĩa ⇒ chạy lại vô hại). Ảnh thiếu / docker vắng ⇒ lỗi node rõ ràng.
 */
import type { ItemLuong } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, type KetQuaChay } from "../dangKyNut";
import { chayMaCachLy, LoiMaLuong } from "../lib/chayMaCachLy";

/** Chuẩn hoá kết quả của mã thành mảng item. */
export function chuanHoaItem(ra: unknown): ItemLuong[] {
  if (ra === null || ra === undefined) return [];
  const ds = Array.isArray(ra) ? ra : [ra];
  return ds.map((x, i) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      if (Object.keys(o).length === 1 && o.json && typeof o.json === "object" && !Array.isArray(o.json)) return { json: o.json as Record<string, unknown> };
      return { json: o };
    }
    throw new LoiMaLuong("dau-ra-hong", `phần tử ${i} của kết quả phải là đối tượng (nhận ${Array.isArray(x) ? "mảng" : typeof x})`);
  });
}

dangKyNut({
  type: "du-lieu.ma",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    if (typeof thamSo.ma !== "string") throw new LoiMaLuong("khong-hop-le", "tham số 'ma' phải là chuỗi");
    const kq = await chayMaCachLy({ ma: thamSo.ma, items: ngu.inputs.main ?? [] });
    return { main: chuanHoaItem(kq.items) };
  },
});
