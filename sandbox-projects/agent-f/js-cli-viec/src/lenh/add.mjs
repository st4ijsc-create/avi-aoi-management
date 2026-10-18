import { docKho, ghiKho, idKeTiep } from "../kho.mjs";

const NGAY = /^\d{4}-\d{2}-\d{2}$/;

export function lenhAdd({ viTri, co }, io) {
  const tieuDe = (viTri[0] ?? "").trim();
  if (!tieuDe) {
    io.loi("Thiếu tiêu đề việc\n");
    return 1;
  }
  if (co.han !== undefined && !NGAY.test(co.han)) {
    io.loi(`Hạn chót không hợp lệ: ${co.han} (dùng YYYY-MM-DD)\n`);
    return 1;
  }
  const ds = docKho(io.duongKho);
  const viec = { id: idKeTiep(ds), tieuDe, xong: false };
  if (co.han) viec.han = co.han;
  ds.push(viec);
  ghiKho(io.duongKho, ds);
  io.ghi(`Đã thêm #${viec.id}: ${tieuDe}\n`);
  return 0;
}
