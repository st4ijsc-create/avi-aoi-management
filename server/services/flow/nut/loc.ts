/**
 * ★★ Lô logic-loc (2026-10-26; dieu-phoi duyệt) — LỌC và SẮP XẾP item (thuần, không đụng dữ liệu nhà máy).
 *
 * `logic.loc` — cổng ra `giu` / `loai`. Item `giu` khi MỌI điều kiện (≤ 5, VÀ) cùng khớp; mỗi điều kiện `{ giaTri, so, dich }` dùng đúng toán tử NGHIÊM NGẶT của `logic.chon`
 *   (`eq` `in` `gt` `lt` `gte` `lte`; không ép kiểu; KHÔNG regex). Biểu thức lỗi ⇒ item ra `loai` (bảo toàn: Σ ra = Σ vào). Cần ≥ 1 điều kiện. Trần 1000 item mỗi lượt-node.
 *   `loai` không bắt buộc nối (item bị lọc bỏ là hành vi mong đợi).
 * `logic.sap-xep` — cổng `main`: sắp xếp ỔN ĐỊNH theo `giaTri` (biểu thức theo item), `huong` tang | giam, `kieu` so | chu. Khoá sai kiểu (không phải số hữu hạn / không phải chuỗi) xếp CUỐI
 *   theo thứ tự cũ, bất kể hướng. Chuỗi so theo mã UTF-16 (xác định, không phụ thuộc locale). Trần 1000 item.
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";
import { TOAN_TU_CHON, khopDieuKien } from "./chon";

export const TRAN_ITEM_LOC = 1000;
export const TRAN_DIEU_KIEN_LOC = 5;
export const HUONG_SAP_XEP = ["tang", "giam"] as const;
export const KIEU_SAP_XEP = ["so", "chu"] as const;
export { TOAN_TU_CHON as TOAN_TU_LOC };

export class LoiLoc extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

type DieuKienLoc = { giaTri?: unknown; so?: unknown; dich?: unknown };

dangKyNut({
  type: "logic.loc",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["giu", "loai"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_LOC) throw new LoiLoc(`logic.loc nhận ${vao.length} item — tối đa ${TRAN_ITEM_LOC} mỗi lượt (không cắt âm thầm).`, "QUA_TRAN_ITEM");
    const ds = (Array.isArray(thamSo.dieuKien) ? thamSo.dieuKien : []) as DieuKienLoc[];
    if (ds.length < 1) throw new LoiLoc("logic.loc cần ít nhất một điều kiện.", "THAM_SO_SAI");
    if (ds.length > TRAN_DIEU_KIEN_LOC) throw new LoiLoc(`logic.loc có ${ds.length} điều kiện — tối đa ${TRAN_DIEU_KIEN_LOC}.`, "THAM_SO_SAI");
    const ra: KetQuaChay = { giu: [], loai: [] };
    for (const item of vao) {
      let giu = false;
      try {
        const nc = nguCanhItem(ngu, item, vao);
        giu = ds.every((d) => khopDieuKien(danhGiaThamSo(d?.giaTri, nc), d?.so, danhGiaThamSo(d?.dich, nc)));
      } catch {
        giu = false; // biểu thức lỗi ⇒ `loai`, KHÔNG làm rơi item
      }
      ra[giu ? "giu" : "loai"].push(item);
    }
    return ra;
  },
});

dangKyNut({
  type: "logic.sap-xep",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_LOC) throw new LoiLoc(`logic.sap-xep nhận ${vao.length} item — tối đa ${TRAN_ITEM_LOC} mỗi lượt (không cắt âm thầm).`, "QUA_TRAN_ITEM");
    const huong = String(thamSo.huong ?? "tang");
    const kieu = String(thamSo.kieu ?? "so");
    if (!(HUONG_SAP_XEP as readonly string[]).includes(huong)) throw new LoiLoc(`logic.sap-xep: huong phải là ${HUONG_SAP_XEP.join(" | ")}.`, "THAM_SO_SAI");
    if (!(KIEU_SAP_XEP as readonly string[]).includes(kieu)) throw new LoiLoc(`logic.sap-xep: kieu phải là ${KIEU_SAP_XEP.join(" | ")}.`, "THAM_SO_SAI");
    const khoa = vao.map((item, i) => {
      let k: unknown;
      try {
        k = danhGiaThamSo(thamSo.giaTri, nguCanhItem(ngu, item, vao));
      } catch {
        k = undefined;
      }
      const hopLe = kieu === "so" ? typeof k === "number" && Number.isFinite(k) : typeof k === "string";
      return { item, i, k: hopLe ? (k as number | string) : null };
    });
    const hs = huong === "giam" ? -1 : 1;
    khoa.sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1; // sai kiểu ⇒ cuối
      return a.k < b.k ? -hs : a.k > b.k ? hs : a.i - b.i;
    });
    return { main: khoa.map((x) => x.item) };
  },
});
