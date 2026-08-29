/**
 * Đọc đề xuất sửa CỤC BỘ từ văn bản model.
 *
 * Ở chế độ LOCAL, máy chủ KHÔNG phát `pending_action` (codingMode false), đề xuất sửa đến từ
 * VĂN BẢN của model, dưới dạng khối rào ``` ```avi-tool ``` `` … ``` ``` ```.
 *
 * Parser này là cửa DUY NHẤT cho đường ghi cục bộ. Sai một nhịp ở đây = ghi nhầm tệp trên
 * máy lập trình viên ⇒ mọi ca biên phải trả `[]` chứ KHÔNG đoán.
 *
 * - Tách khối bằng hàng rào ``` ```avi-tool ``` `` … ``` ``` ``` (hỗ trợ LF + CRLF)
 * - `JSON.parse` trong `try/catch`; hỏng ⇒ bỏ qua khối đó, KHÔNG ném
 * - Kiểm trước khi truy cập trường: phải là object (KHÔNG null/số/chuỗi)
 * - Kiểm từng trường bằng `typeof`; thiếu/sai kiểu ⇒ bỏ qua
 * - `dongDau`/`dongCuoi` phải là số nguyên ≥ 1 và `dongCuoi >= dongDau`; sai ⇒ bỏ qua
 * - `tool` khác `de_xuat_sua_doan`/`de_xuat_sua` ⇒ bỏ qua
 *
 * GIỚI HẠN ĐÃ BIẾT: nếu `thayThe`/`modified` chứa nguyên văn hàng rào ```, regex lười cắt khối
 * sớm ⇒ JSON hỏng ⇒ một đề xuất hợp lệ bị bỏ im lặng. Không sửa ở đợt này (cần đổi giao thức).
 */

export type DeXuatCucBo =
  | { loai: "doan"; path: string; dongDau: number; dongCuoi: number; thayThe: string }
  | { loai: "toanVan"; path: string; modified: string };

export function docDeXuatCucBo(vanBan: string): DeXuatCucBo[] {
  const ketQua: DeXuatCucBo[] = [];

  // Tách các khối avi-tool từ văn bản (hỗ trợ LF `\n` và CRLF `\r\n`)
  const regex = /```avi-tool\r?\n([\s\S]*?)\r?\n```/g;
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

    // JSON.parse("null") trả về null (JSON hợp lệ), không ném. Phải chặn trước khi truy cập
    // trường, nếu không sẽ ném TypeError khi chạm obj.tool. Điều này sẽ vứt luôn những đề
    // xuất hợp lệ đã thu được — tệ hơn nhiều so với bỏ một khối.
    if (!obj || typeof obj !== "object") {
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
