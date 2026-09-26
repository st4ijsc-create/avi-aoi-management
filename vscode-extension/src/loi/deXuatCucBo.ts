/**
 * Đọc đề xuất sửa CỤC BỘ từ văn bản model.
 *
 * Ở chế độ LOCAL, máy chủ KHÔNG phát `pending_action` (codingMode false), đề xuất sửa đến từ
 * VĂN BẢN của model, dưới dạng khối rào ``` ```avi-tool ``` `` … ``` ``` ```.
 *
 * Parser này là cửa DUY NHẤT cho đường ghi cục bộ. Sai một nhịp ở đây = ghi nhầm tệp trên
 * máy lập trình viên ⇒ mọi ca biên phải trả `[]` chứ KHÔNG đoán.
 *
 * Việc TÁCH khối rào (regex, JSON.parse an toàn, kiểm `tool`/`args` là object) đã chuyển sang
 * `khoiAviTool.ts` — MỘT nơi DUY NHẤT biết cú pháp hàng rào, dùng chung với `yeuCauDoc.ts` (Đợt
 * D, ba tool ĐỌC). Tệp này chỉ còn lo phần RIÊNG của hai tool GHI:
 * - Kiểm từng trường bằng `typeof`; thiếu/sai kiểu ⇒ bỏ qua
 * - `dongDau`/`dongCuoi` phải là số nguyên ≥ 1 và `dongCuoi >= dongDau`; sai ⇒ bỏ qua
 * - `tool` khác `de_xuat_sua_doan`/`de_xuat_sua` ⇒ bỏ qua
 *
 * GIỚI HẠN ĐÃ BIẾT: nếu `thayThe`/`modified` chứa nguyên văn hàng rào ```, regex lười cắt khối
 * sớm ⇒ JSON hỏng ⇒ một đề xuất hợp lệ bị bỏ im lặng. Không sửa ở đợt này (cần đổi giao thức).
 */

import { tachKhoiAviTool } from "./khoiAviTool";

export type DeXuatCucBo =
  | { loai: "doan"; path: string; dongDau: number; dongCuoi: number; thayThe: string }
  | { loai: "toanVan"; path: string; modified: string };

export function docDeXuatCucBo(vanBan: string): DeXuatCucBo[] {
  const ketQua: DeXuatCucBo[] = [];

  for (const { tool, args } of tachKhoiAviTool(vanBan)) {
    // Xử lý de_xuat_sua_doan: sửa đoạn (dòng từ→đến)
    if (tool === "de_xuat_sua_doan") {
      // Kiểm trường bắt buộc
      if (
        typeof args.path !== "string" ||
        typeof args.thayThe !== "string" ||
        typeof args.dongDau !== "number" ||
        typeof args.dongCuoi !== "number"
      ) {
        continue;
      }

      // Kiểm số dòng: phải là số nguyên ≥ 1, dongCuoi >= dongDau
      if (
        !Number.isInteger(args.dongDau) ||
        !Number.isInteger(args.dongCuoi) ||
        args.dongDau < 1 ||
        args.dongCuoi < 1 ||
        args.dongCuoi < args.dongDau
      ) {
        continue;
      }

      ketQua.push({
        loai: "doan",
        path: args.path,
        dongDau: args.dongDau,
        dongCuoi: args.dongCuoi,
        thayThe: args.thayThe,
      });
    }

    // Xử lý de_xuat_sua: sửa toàn văn
    else if (tool === "de_xuat_sua") {
      // Kiểm trường bắt buộc
      if (typeof args.path !== "string" || typeof args.modified !== "string") {
        continue;
      }

      ketQua.push({
        loai: "toanVan",
        path: args.path,
        modified: args.modified,
      });
    }

    // Tool khác ⇒ bỏ qua (đọc/grep là việc của Đợt D)
  }

  return ketQua;
}
