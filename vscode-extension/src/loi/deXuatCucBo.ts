/**
 * Đọc đề xuất sửa CỤC BỘ từ văn bản model.
 *
 * Ở chế độ LOCAL, máy chủ KHÔNG phát `pending_action` (codingMode false), đề xuất sửa đến từ
 * VĂN BẢN của model, dưới dạng khối rào ``` ```avi-tool ``` `` … ``` ``` ```.
 *
 * Parser này là cửa DUY NHẤT cho đường ghi cục bộ. Sai một nhịp ở đây = ghi nhầm tệp trên
 * máy lập trình viên ⇒ mọi ca biên phải trả `[]` chứ KHÔNG đoán.
 *
 * - Tách khối bằng hàng rào ``` ```avi-tool ``` `` … ``` ``` ```
 * - `JSON.parse` trong `try/catch`; hỏng ⇒ bỏ qua khối đó, KHÔNG ném
 * - Kiểm từng trường bằng `typeof`; thiếu/sai kiểu ⇒ bỏ qua
 * - `dongDau`/`dongCuoi` phải là số nguyên ≥ 1 và `dongCuoi >= dongDau`; sai ⇒ bỏ qua
 * - `tool` khác `de_xuat_sua_doan`/`de_xuat_sua` ⇒ bỏ qua
 */

export type DeXuatCucBo =
  | { loai: "doan"; path: string; dongDau: number; dongCuoi: number; thayThe: string }
  | { loai: "toanVan"; path: string; modified: string };

export function docDeXuatCucBo(vanBan: string): DeXuatCucBo[] {
  const ketQua: DeXuatCucBo[] = [];

  // Tách các khối avi-tool từ văn bản
  const regex = /```avi-tool\n([\s\S]*?)\n```/g;
  let khopMatches;

  while ((khopMatches = regex.exec(vanBan)) !== null) {
    const jsonText = khopMatches[1];

    // Cố gắng parse JSON; hỏng ⇒ bỏ qua khối này, không ném
    let obj: any;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      // JSON không hợp lệ ⇒ bỏ qua
      continue;
    }

    // Kiểm cấu trúc: phải có `tool` và `args`
    if (typeof obj.tool !== "string" || typeof obj.args !== "object" || !obj.args) {
      continue;
    }

    const tool = obj.tool;
    const args = obj.args;

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
