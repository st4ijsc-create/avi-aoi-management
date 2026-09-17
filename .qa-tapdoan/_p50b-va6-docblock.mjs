import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/pages/TwinVanHanh.tsx";
let s = readFileSync(F, "utf8");
const cu = `   * ⚠⚠ HỆ QUẢ PHẢI NÓI RA (thiết kế §7.2, chưa vá ở lượt này): \`banKinh\` suy từ
   *   chính hai số này và \`far = max(2000, banKinh*24)\`. Khuôn viên QATD rộng
   *   ~2,25 km ⇒ \`far\` ~54 km với \`near\` mặc định ⇒ **tỉ lệ far/near lớn = nguy
   *   cơ z-fighting**. Không ngưỡng nào của §4 bắt được nó — chỉ mắt người thấy.
   */`;
const moi = `   * ⚠⚠ HỆ QUẢ PHẢI NÓI RA (thiết kế §7.2) — ĐÃ ĐO, ĐÃ VÁ MỘT NỬA (PH-50b):
   *   \`banKinh\` suy từ chính hai số này, và \`far\` suy từ \`banKinh\`.
   *
   *   (a) **Đã vá**: trước PH-50b \`far\` KHÔNG BAO GIỜ tới được camera — prop
   *       \`camera\` của \`<Canvas>\` chỉ là cấu hình KHỞI TẠO, mà lúc mount
   *       \`khuonVien\` còn \`null\` nên \`far\` chốt ở sàn **2000 m**. Đo sống 5 vai
   *       QATD: prop đòi 6.864–25.450, \`camera.far\` đứng ở 2000 ở CẢ NĂM ⇒ cuộn
   *       ra xa là mất sạch toà nhà. Nay \`loi/catCanh.ts\` tính \`far\` từ khoảng
   *       cách lùi xa nhất (hệ số 12 thay cho 24, đệm 1,25 thay cho 2,55) và
   *       \`loi/KhungCanh.DongBoCatCanh\` đưa nó vào camera đang sống. \`near\` đi
   *       theo \`far\` nên tỉ lệ far/near chỉ còn 20.000–24.957 (trước: nếu \`far\`
   *       từng tới nơi thì đã là 124.785).
   *
   *   (b) ⚠ **CÒN MỞ — z-fighting sàn/lưới, KHÔNG do PH-50b sinh ra**:
   *       \`CanhVanHanh.San\` đặt mặt sàn ở \`y = -0.01\` và \`gridHelper\` ở \`y = 0\`
   *       — cách nhau **1 cm**. Ở cỡ tập đoàn, bước z-buffer 24 bit tại các toà
   *       (z ≈ 2000 m) là **2,38 m** trước bản vá và **0,48 m** sau; cả hai đều
   *       lớn hơn 1 cm hàng chục tới hàng trăm lần. Đo được: đổi RIÊNG \`far\` làm
   *       21,5 % pixel mặt sàn đổi bên thắng, đổi RIÊNG \`near\` làm 22,4 % — trong
   *       khi chụp HAI LẦN CÙNG MỘT BẢN DỰNG cho 0 %. Bản vá làm bước z **mịn hơn
   *       5 lần** (tốt lên), nhưng KHÔNG đóng được khuyết tật: muốn đóng phải nâng
   *       khe hở sàn/lưới theo cỡ cảnh hoặc dùng \`polygonOffset\` — một thay đổi
   *       THỊ GIÁC trên màn chủ dự án đã nghiệm thu bằng mắt, nên để chủ đợt quyết.
   */`;
if (!s.includes(cu)) throw new Error("không thấy docblock cũ");
s = s.replace(cu, moi);
writeFileSync(F, s, "utf8");
console.log("ok");
