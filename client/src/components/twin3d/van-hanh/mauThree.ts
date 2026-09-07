/**
 * mauThree.ts — MỘT đường quy `oklch()` → RGB thật, dùng chung cho MỌI người tiêu thụ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G29 — `THREE.Color` KHÔNG ĐỌC `oklch()`: WARN RỒI TRẢ **TRẮNG**
 * ════════════════════════════════════════════════════════════════════════════
 * three r182 gặp `new THREE.Color("oklch(...)")` thì in `Unknown color model`
 * (một **console.warn**, KHÔNG throw) rồi trả `#ffffff`. Hệ quả đo được ở
 * nghiệm thu Đợt 8: 12 cột WIP mọc đúng vị trí, đúng chiều cao, **trắng như
 * nhau** — hình học đủ, kênh MÀU chở đúng **0 bit**. Mọi cổng vẫn xanh (`check`
 * 0, `build` 0, unit test xanh) vì không cổng nào nhìn vào pixel.
 *
 * ⚠ Docblock `mauTrangThai.ts` từng khẳng định *"trình duyệt tính oklch → rgb
 *   nên không cần thư viện màu"*. Khẳng định đó **SAI với biến CSS**: custom
 *   property KHÔNG được CSS phân giải — nó thay thế nguyên văn, và
 *   `getPropertyValue` trả lại đúng chuỗi tác giả đã viết. (Đã thử cả cách gán
 *   vào `color` của một phần tử dò: Chrome nay giữ nguyên `oklch()` ở computed
 *   value luôn.) Docblock đó ĐÃ được sửa cùng đợt này.
 *
 * Cách quy ĐÚNG là canvas 2D: `ctx.fillStyle = <bất kỳ cú pháp màu CSS nào>`
 * rồi ĐỌC LẠI PIXEL. Trình duyệt buộc phải rasterise nên nó trả RGB thật.
 * Đo trên trang: `--warning` → `rgb(239,168,49)`, `--info` → `rgb(90,163,236)`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MỘT MODULE RIÊNG — G12: "HAI BẢN CÀI ĐẶT HIẾM KHI CHỈ LỆCH MỘT CHỖ"
 * ════════════════════════════════════════════════════════════════════════════
 * Lô A viết bản vá này TRONG `CanhVanHanh.tsx` vì phạm vi tệp của nó. Nhưng
 * cùng lỗi còn ở `DongChayLine.tsx`, ở `TwinVanHanh.tsx` (đường vào `LoBatchMay`,
 * nơi `c.set(oklch)` sinh **84 warning**) và ở `phaVeNen()` (`phamViCanh.ts`).
 * Chép bản vá sang bốn chỗ là tạo bốn bản cài đặt sẽ lệch nhau ở lần sửa đầu
 * tiên. Nên nó được **rút ra đây**, và `CanhVanHanh.tsx` **re-export** để mọi
 * call site cũ + test G20 của lô A giữ nguyên.
 *
 * ★ Module này CHẠY ĐƯỢC TRONG NODE: `byteMau` trả `null` khi không có DOM, và
 *   mọi hàm công khai đều có nhánh dự phòng. Nhờ vậy `phamViCanh.ts` (module
 *   thuần, test ở `environment: "node"`) import được mà không đổi môi trường.
 */

import * as THREE from "three";

import { giaiMauCanh } from "../mauTrangThai";
import { byteMau, laCuPhapLa } from "./byteMau";

export { byteMau, laCuPhapLa };

/**
 * Token CSS → `THREE.Color` có SẮC THẬT (không phải trắng).
 */
export function mauThree(token: string, duPhong: string): THREE.Color {
  const gt = giaiMauCanh(token);
  if (!gt) return new THREE.Color(duPhong);
  // Hex/rgb/hsl/tên: three đọc thẳng được, không cần vòng qua canvas.
  if (!laCuPhapLa(gt)) return new THREE.Color(gt);
  const b = byteMau(gt);
  if (!b) return new THREE.Color(duPhong);
  /*
   * ★★★ `setRGB(..., SRGBColorSpace)` CHỨ KHÔNG `new THREE.Color(r/255, …)`.
   *
   * Bộ dựng ba-số coi đầu vào là **ĐÃ TUYẾN TÍNH** và không quy đổi gì. Nạp
   * thẳng byte sRGB vào đó cho ra một màu SAI SẮC — và sai theo hướng SÁNG LÊN,
   * tức là đúng hướng che mất khuyết tật. Đo được: nền `rgb(7,10,16)` đi vòng
   * qua `getHexString()` ra `#2e3847`, sáng gấp mấy lần.
   *
   * ★ Chính test của tệp này bắt được, ở lượt chạy ĐẦU TIÊN của `mauHex` — một
   *   ví dụ sống cho việc test phải so ở ĐÚNG đơn vị (ở đây: đúng không gian
   *   màu), nếu không nó xanh trên một con số không có nghĩa.
   */
  return new THREE.Color().setRGB(b[0] / 255, b[1] / 255, b[2] / 255, THREE.SRGBColorSpace);
}

/**
 * ★★★ Cùng phép quy, nhưng trả **chuỗi hex** cho những chỗ nhận `string`.
 *
 * `KhungCanh` nhận `mauNen` là `string` rồi mới dựng `<color args={[mauNen]}/>`
 * bên trong (`KhungCanh.tsx:262`) — tức là `new THREE.Color(...)` xảy ra ở BÊN
 * KIA hàng rào tệp. Truyền một chuỗi `oklch()` qua đó thì nền cảnh 3D thành
 * **TRẮNG** ở theme tối: đo được ở nghiệm thu Đợt 8 (canvas trắng toát trên nền
 * ứng dụng tối) và console in `Unknown color model oklch(14.5% .015 260)`.
 *
 * Quy ở ĐÂY, tại nguồn, thay vì sửa từng người tiêu thụ — hex thì MỌI người
 * tiêu thụ đều đọc được.
 */
export function mauHex(token: string, duPhong: string): string {
  const gt = giaiMauCanh(token);
  if (!gt) return duPhong;
  if (!laCuPhapLa(gt)) return gt;
  // ★ Đi THẲNG từ byte sRGB ra hex. KHÔNG vòng qua `mauThree().getHexString()`:
  //   đường đó nạp byte vào không gian tuyến tính rồi quy ngược ra sRGB, làm màu
  //   sáng vọt lên (`rgb(7,10,16)` → `#2e3847`). Xem chú thích ở `mauThree`.
  const b = byteMau(gt);
  if (!b) return duPhong;
  return `#${b.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * ★★★ CHUỖI MÀU CSS **AN TOÀN CHO THREE** — cửa duy nhất cho `LoBatchMay`.
 *
 * `LoBatchMay.tsx:189` làm `c.set(m.mau)`, tức `new THREE.Color(chuỗi)` xảy ra
 * BÊN KIA hàng rào tệp của kit Đợt 1. Truyền `oklch()` qua đó = 42 máy × mỗi
 * lần đổi trạng thái một warning, và **mọi máy trắng như nhau**. Đây là nguồn
 * của **84 warning** đếm được ở nghiệm thu Đợt 8.
 *
 * Trả `rgb(r, g, b)` chứ không hex vì đầu ra của hàm này còn chảy tiếp vào
 * `phaVeNen()` — và `tachRgb` ở đó đọc `rgb()` trực tiếp, khỏi phải parse hex
 * lần nữa. Cả hai đường cùng một chuỗi, không có nhánh nào lệch.
 *
 * ⚠ KHÁC `giaiMauCanh(token) ?? duPhong`: cái đó trả lại NGUYÊN chuỗi oklch.
 *   Mọi call site truyền màu vào three phải đi qua hàm này, không đi qua đó.
 */
export function mauCss(token: string, duPhong: string): string {
  const gt = giaiMauCanh(token);
  if (!gt) return duPhong;
  if (!laCuPhapLa(gt)) return gt;
  const b = byteMau(gt);
  if (!b) return duPhong;
  return `rgb(${b[0]}, ${b[1]}, ${b[2]})`;
}
