/**
 * Giá trị điều kiện của node `logic.chon` ⇄ chữ trong ô nhập (form có kiểu). KHÔNG ép kiểu ngầm: số / true / false / null / "chuỗi trong ngoặc kép" / chữ trần (= chuỗi).
 * `in` nhận danh sách phân cách bằng dấu phẩy. Thuần, test được.
 */
export type GiaTriChon = string | number | boolean | null;

export function phanTichGiaTri(chu: string): GiaTriChon {
  const t = chu.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function hienGiaTri(v: unknown): string {
  if (typeof v === "string") return /^(true|false|null|-?\d+(\.\d+)?)$/.test(v.trim()) || v !== v.trim() || (v.startsWith('"') && v.endsWith('"')) ? `"${v}"` : v;
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Danh sách cho `in`: tách theo dấu phẩy (bỏ phần rỗng), mỗi phần qua phanTichGiaTri. */
export function phanTichDanhSach(chu: string): GiaTriChon[] {
  return chu.split(",").map((x) => x.trim()).filter((x) => x !== "").map(phanTichGiaTri);
}
export const hienDanhSach = (ds: unknown): string => (Array.isArray(ds) ? ds.map(hienGiaTri).join(", ") : "");
