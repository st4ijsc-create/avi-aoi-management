import { docKho, ghiKho } from "../kho.mjs";

export function lenhDone({ viTri }, io) {
  const id = Number(viTri[0]);
  const ds = docKho(io.duongKho);
  const viec = ds.find((v) => v.id === id);
  if (!viec) {
    io.loi(`Không có việc #${viTri[0] ?? ""}\n`);
    return 1;
  }
  viec.xong = true;
  ghiKho(io.duongKho, ds);
  io.ghi(`Đã xong #${id}\n`);
  return 0;
}
