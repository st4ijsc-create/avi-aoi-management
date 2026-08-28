/**
 * Gộp dự án LOCAL (thư mục workspace) và SERVER (hộp cát trên box AI) vào MỘT danh sách.
 *
 * ⚠ Nhãn là hàng rào an toàn, không phải trang trí: hai chế độ ghi vào HAI NƠI KHÁC NHAU. Một dev
 * tưởng đang sửa tệp local mà thật ra động vào box AI (hoặc ngược lại) là tai nạn không cứu được,
 * nên `loai` phải hiện ra cả bằng mắt (nhãn) lẫn bằng mã (trường).
 */
export interface MucDuAn {
  id: string;
  nhan: string;
  loai: "local" | "server";
}

export function gopDanhSachDuAn(
  thuMucLocal: string[],
  duAnServer: Array<{ id: string; name: string }>,
): MucDuAn[] {
  const ds: MucDuAn[] = [];
  for (const t of thuMucLocal) ds.push({ id: `local:${t}`, nhan: `LOCAL · ${t}`, loai: "local" });
  for (const d of duAnServer) {
    ds.push({ id: `server:${d.id}`, nhan: `SERVER · ${d.name}`, loai: "server" });
  }
  return ds;
}
