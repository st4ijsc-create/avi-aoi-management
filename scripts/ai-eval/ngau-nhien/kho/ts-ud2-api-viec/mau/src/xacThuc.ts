import type { BoLoc, CapNhatViec, KetQua, LoiTruong, UuTien, ViecMoi } from "./kieu.ts";

const TRUONG = ["tieuDe", "xong", "uuTien", "nhan"];
const UU_TIEN: readonly string[] = ["thap", "vua", "cao"];

type DoiTuong = Record<string, unknown>;
const laDoiTuong = (x: unknown): x is DoiTuong => typeof x === "object" && x !== null && !Array.isArray(x);
const coMat = (o: DoiTuong, k: string) => Object.hasOwn(o, k) && o[k] !== undefined;

function kiemChung(x: unknown, batBuocTieuDe: boolean): KetQua<CapNhatViec> {
  if (!laDoiTuong(x)) return { ok: false, loi: [{ truong: "", thongDiep: "phải là đối tượng" }] };
  const loi: LoiTruong[] = [];
  const ra: CapNhatViec = {};

  if (!coMat(x, "tieuDe")) {
    if (batBuocTieuDe) loi.push({ truong: "tieuDe", thongDiep: "thiếu" });
  } else {
    const t = typeof x.tieuDe === "string" ? x.tieuDe.trim() : null;
    if (t === null || t.length < 1 || t.length > 200) loi.push({ truong: "tieuDe", thongDiep: "phải là chuỗi 1..200 ký tự" });
    else ra.tieuDe = t;
  }

  if (coMat(x, "xong")) {
    if (typeof x.xong !== "boolean") loi.push({ truong: "xong", thongDiep: "phải là boolean" });
    else ra.xong = x.xong;
  }

  if (coMat(x, "uuTien")) {
    if (typeof x.uuTien !== "string" || !UU_TIEN.includes(x.uuTien)) loi.push({ truong: "uuTien", thongDiep: "phải là thap|vua|cao" });
    else ra.uuTien = x.uuTien as UuTien;
  }

  if (coMat(x, "nhan")) {
    const n = x.nhan;
    if (!Array.isArray(n) || n.length > 5 || !n.every((s) => typeof s === "string" && s.trim() !== "")) {
      loi.push({ truong: "nhan", thongDiep: "phải là mảng tối đa 5 chuỗi khác rỗng" });
    } else ra.nhan = n.map((s: string) => s.trim());
  }

  for (const k of Object.keys(x)) if (!TRUONG.includes(k)) loi.push({ truong: k, thongDiep: "trường lạ" });

  return loi.length ? { ok: false, loi } : { ok: true, giaTri: ra };
}

export function kiemViecMoi(x: unknown): KetQua<ViecMoi> {
  const kq = kiemChung(x, true);
  if (!kq.ok) return kq;
  const g = kq.giaTri;
  return { ok: true, giaTri: { tieuDe: g.tieuDe!, xong: g.xong ?? false, uuTien: g.uuTien ?? "vua", nhan: g.nhan ?? [] } };
}

export function kiemCapNhat(x: unknown): KetQua<CapNhatViec> {
  return kiemChung(x, false);
}

export function kiemBoLoc(q: URLSearchParams): KetQua<BoLoc> {
  const loi: LoiTruong[] = [];
  const ra: BoLoc = {};
  const xong = q.get("xong");
  if (xong !== null) {
    if (xong === "true" || xong === "false") ra.xong = xong === "true";
    else loi.push({ truong: "xong", thongDiep: "phải là true|false" });
  }
  const uuTien = q.get("uuTien");
  if (uuTien !== null) {
    if (UU_TIEN.includes(uuTien)) ra.uuTien = uuTien as UuTien;
    else loi.push({ truong: "uuTien", thongDiep: "phải là thap|vua|cao" });
  }
  const tu = q.get("q")?.trim();
  if (tu) ra.q = tu;
  return loi.length ? { ok: false, loi } : { ok: true, giaTri: ra };
}
