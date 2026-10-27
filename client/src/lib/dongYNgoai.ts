/**
 * Đợt 10.4b (L0b) — ĐỒNG Ý GỬI DỮ LIỆU RA NGOÀI theo PHIÊN (sessionStorage — KHÔNG lưu bền: đóng tab là hết) và XÁC NHẬN DỮ LIỆU VẬN HÀNH theo HỘI THOẠI.
 * Kế hoạch §D4 (dieu-phoi Q7 + kiem-dinh N1):
 *   • đồng ý RIÊNG theo `nhà cung cấp:model` — đổi nhà cung cấp/model ⇒ hỏi lại;
 *   • xác nhận vận hành: MỘT lần mỗi hội thoại (khoá `convKey` do bề mặt chọn: id hội thoại / "moi") — máy chủ không có trạng thái (HTTP 428 + `context.xacNhanVanHanh`), nên
 *     "một lần" là việc của client; cờ này CHỈ là UX — máy chủ KHÔNG coi nó nâng mức hay vượt 403 `NGOAI_DU_LIEU_VAN_HANH`.
 * Mọi truy cập storage bọc try/catch (chế độ riêng tư / bị chặn ⇒ coi như CHƯA đồng ý — đóng mặc định).
 */
const KHOA_DONG_Y = "aiNgoai.dongY";
const KHOA_VAN_HANH = "aiNgoai.xacNhanVanHanh";

/** `ngoai:<ncc>:<model>` ⇒ { nhaCungCap, model }; không phải mã ngoài ⇒ null. */
export function tachMaNgoai(ma: string): { nhaCungCap: string; model: string } | null {
  if (!ma.startsWith("ngoai:")) return null;
  const phan = ma.split(":");
  if (phan.length < 3 || !phan[1] || !phan.slice(2).join(":")) return null;
  return { nhaCungCap: phan[1], model: phan.slice(2).join(":") };
}

function doc(khoa: string): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(khoa) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function ghi(khoa: string, ds: string[]): void {
  try {
    sessionStorage.setItem(khoa, JSON.stringify(ds.slice(-200)));
  } catch {
    /* chế độ riêng tư — chỉ sống trong lượt hiện tại */
  }
}

/** Đã đồng ý trong PHIÊN này cho đúng `nhà cung cấp:model` (mã `ngoai:…`)? Không phải mã ngoài ⇒ true (không cần). */
export function daDongYNgoai(ma: string): boolean {
  const t = tachMaNgoai(ma);
  return t === null ? true : doc(KHOA_DONG_Y).includes(`${t.nhaCungCap}:${t.model}`);
}
export function datDongYNgoai(ma: string): void {
  const t = tachMaNgoai(ma);
  if (!t) return;
  const khoa = `${t.nhaCungCap}:${t.model}`;
  const ds = doc(KHOA_DONG_Y);
  if (!ds.includes(khoa)) ghi(KHOA_DONG_Y, [...ds, khoa]);
}

/** Đã xác nhận "người gõ = dữ liệu vận hành" cho hội thoại `convKey` (kèm nhà cung cấp:model — đổi model ⇒ hỏi lại)? */
export function daXacNhanVanHanh(convKey: string, ma: string): boolean {
  const t = tachMaNgoai(ma);
  return t === null ? true : doc(KHOA_VAN_HANH).includes(`${convKey}|${t.nhaCungCap}:${t.model}`);
}
export function datXacNhanVanHanh(convKey: string, ma: string): void {
  const t = tachMaNgoai(ma);
  if (!t) return;
  const k = `${convKey}|${t.nhaCungCap}:${t.model}`;
  const ds = doc(KHOA_VAN_HANH);
  if (!ds.includes(k)) ghi(KHOA_VAN_HANH, [...ds, k]);
}
