/**
 * ★★★ ĐỢT E — cửa DUY NHẤT để lưới real-host nhập MÃ SẢN XUẤT thật.
 *
 * `dist/extension.js` (bundle chạy thật) chỉ xuất `activate`/`deactivate` — không đủ để lưới gọi
 * thẳng `apBanVa`/`KhoDeXuat`/... Tệp này bundle riêng (esbuild, `external: vscode`) đúng những
 * export cần cho các ca real-host, để lưới gọi ĐÚNG hàm sản xuất, KHÔNG viết lại logic ghi/băm/ghép
 * lần thứ hai trong lưới (viết lại là tạo một bản sao sẽ trôi khỏi bản thật, đúng bài học đã trả
 * giá nhiều lần trong dự án này — xem docblock `chanGhi.ts`, `duyetGhi.ts`).
 *
 * ⚠ Tệp này (và cả cây `test-real-host/`) nằm NGOÀI `vscode-extension/src/`, nên `census.unit.
 *   test.ts` (GOC = `src/`) không quét tới — không cần né các từ khoá bị cấm ở đó, và cũng không
 *   ảnh hưởng gì tới phép đếm "ĐÚNG MỘT lần applyEdit/WorkspaceEdit" của census (bundle NÀY không
 *   phải `dist/extension.js`, không phải artifact người dùng cài).
 */
export { apBanVa } from "../src/ui/apBanVa";
export { KhoDeXuat, SCHEME } from "../src/ui/diffDeXuat";
export { dangNhap } from "../src/mang/dangNhap";
export { duongTuongDoiTrongWorkspace, giaiDuongDeXuat, duocPhepGhi } from "../src/loi/chanGhi";
export { giaiDuongThat } from "../src/loi/duongThat";
export { docDeXuatCucBo } from "../src/loi/deXuatCucBo";
export { bamNoiDung } from "../src/loi/bamTep";
