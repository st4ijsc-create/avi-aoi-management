/**
 * server/routers/machineTemplateImagePutSourceCensus.test.ts
 *
 * ★★★ Lô 8 (BG-116) vòng sửa 1 — HIGH (security, review độc lập).
 *
 * `PUT /api/machine-template-image/upload/:objectKey(*)` (`server/_core/index.ts`) TRƯỚC bản vá
 * chỉ `authenticateMachine` (xác nhận "anh là ai") rồi kiểm khoá KHỚP HÌNH DẠNG regex (xác nhận
 * "khoá trông hợp lệ") — KHÔNG bước nào hỏi "productModelId trong khoá có thuộc phạm vi máy này
 * không". Máy B xác thực THẬT (apiKey hợp lệ, scope `ingest:write` đúng) PUT được blob vào tiền tố
 * `product-models/<id-của-máy-A>/…` — ghi xuyên-tenant/spam dung lượng TRƯỚC KHI
 * `commitTemplateImage` (tRPC, có lọc máy) kịp chạy.
 *
 * ── Vì sao file này KHÔNG gọi HTTP PUT thật ──────────────────────────────────────────────────
 * `server/_core/index.ts` là MỘT hàm `startServer()` monolithic (route registration +
 * `.listen()` không tách rời) — KHÔNG có harness boot-app-không-listen nào trong repo. Tiền lệ
 * DUY NHẤT cho lớp lỗi "auth route PUT trong _core/index.ts" (`aoiPackageXacThuc.test.ts`) dùng
 * CENSUS NGUỒN (cắt vùng thân route bằng marker, assert cấu trúc trên văn bản mã), không phải
 * request HTTP thật — file này lặp lại ĐÚNG khuôn đó cho route ảnh template.
 *
 * ── HAI LỚP BẰNG CHỨNG (khớp `aoiPackageZipCuaNoiDoi.test.ts` §"vì sao không gọi HTTP thật") ──
 *  (a) NGUỒN (file này) — route THẬT SỰ gọi `mayDaDayChoSanPham(` TRƯỚC `storagePut(`, không chỉ
 *      "có mặt cả hai chữ trong file" (một `if(false)` bọc quanh lời gọi vẫn để lại chữ trong
 *      văn bản mà không chặn gì — §4 dưới đây canh THỨ TỰ, không chỉu canh SỰ CÓ MẶT).
 *  (b) HÀNH VI (`machineTemplateImagePresignCommit.db.test.ts`, mục "Vòng sửa 1 — HIGH") — gọi
 *      THẲNG `mayDaDayChoSanPham` (hàm THẬT route phụ thuộc) trên dữ liệu cây THẬT, đo ca dương
 *      (máy A ⇒ true) và ca âm cross-tenant THẬT (máy B có cây dạy sản phẩm KHÁC ⇒ false).
 *
 * §4 cầu chì chống đọc-file-rỗng (đúng khuôn `aoiPackageXacThuc.test.ts` §4) — một đường dẫn hỏng
 * đọc ra chuỗi rỗng sẽ làm mọi `not.toMatch`/`toMatch` bên dưới XANH GIẢ.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CORE_INDEX_PATH = join(__dirname, "..", "_core", "index.ts");
const CORE_INDEX_SOURCE = readFileSync(CORE_INDEX_PATH, "utf-8");

/**
 * Cắt vùng thân route `app.put("/api/machine-template-image/upload/:objectKey(*)", …)` — từ điểm
 * khai báo tới điểm khai báo route TIẾP THEO (`app.<method>(` ở đầu dòng thụt 2 khoảng trắng,
 * ĐÚNG thụt lề mọi route trong file này dùng — cùng hàm cắt `vungTuyenUploadZip` của
 * `aoiPackageXacThuc.test.ts`, không viết bản thứ hai).
 */
function vungTuyenUploadAnhTemplate(source: string): string {
  const MOC_MO = '"/api/machine-template-image/upload/:objectKey(*)"';
  const batDau = source.indexOf(MOC_MO);
  if (batDau === -1) return "";
  const phanConLai = source.slice(batDau + MOC_MO.length);
  const mocTuyenKeTiep = /\n {2}app\.(get|put|post|delete|patch)\(/;
  const khop = phanConLai.match(mocTuyenKeTiep);
  const ketThuc = khop ? batDau + MOC_MO.length + (khop.index ?? phanConLai.length) : source.length;
  return source.slice(batDau, ketThuc);
}

const VUNG_UPLOAD = vungTuyenUploadAnhTemplate(CORE_INDEX_SOURCE);

describe("PUT /api/machine-template-image/upload — vòng sửa 1 HIGH: buộc objectKey vào máy đã xác thực", () => {
  it("§4 cầu chì — nguồn đọc được phải dài hơn 1000 ký tự (chống đọc-file-rỗng)", () => {
    expect(CORE_INDEX_SOURCE.length).toBeGreaterThan(1000);
  });

  it("§4b cầu chì — vùng tuyến PUT phải cắt được và không quá nhỏ/quá lớn (marker còn đúng chỗ)", () => {
    expect(
      VUNG_UPLOAD.length,
      "không tìm thấy khai báo route PUT ảnh template trong _core/index.ts — marker đã đổi?",
    ).toBeGreaterThan(500);
    expect(VUNG_UPLOAD.length).toBeLessThan(CORE_INDEX_SOURCE.length / 2);
  });

  it("§1 — vùng route CÓ import động + gọi `mayDaDayChoSanPham(` (kiểm quyền sở hữu productModelId)", () => {
    expect(VUNG_UPLOAD).toMatch(/mayDaDayChoSanPham\(/);
    // Import ĐỘNG (`await import(...)`), cùng khuôn mọi service khác trong route này
    // (`authenticateMachine`/`storagePut` cũng import động) — không phải `import` tĩnh
    // ở đầu file.
    expect(VUNG_UPLOAD).toMatch(/const\s*\{\s*mayDaDayChoSanPham\s*\}\s*=\s*await import\("\.\.\/db\/cayDay"\)/);
  });

  it("★★★ §2 — `mayDaDayChoSanPham(` xuất hiện TRƯỚC `storagePut(` trong vùng route (thứ tự, không chỉ có mặt)", () => {
    const viTriKiemQuyen = VUNG_UPLOAD.indexOf("mayDaDayChoSanPham(");
    const viTriGhi = VUNG_UPLOAD.indexOf("storagePut(");
    expect(viTriKiemQuyen, "mayDaDayChoSanPham( không xuất hiện trong vùng route").toBeGreaterThan(-1);
    expect(viTriGhi, "storagePut( không xuất hiện trong vùng route").toBeGreaterThan(-1);
    expect(
      viTriKiemQuyen,
      "kiểm quyền sở hữu PHẢI đứng TRƯỚC lượt ghi byte — đứng SAU là vô nghĩa (byte đã ghi rồi mới từ chối)",
    ).toBeLessThan(viTriGhi);
  });

  it("§3 — vùng route TỪ CHỐI (return 403) khi `mayDaDayChoSanPham` trả false, KHÔNG rơi tiếp xuống storagePut", () => {
    const doanKiemQuyen = VUNG_UPLOAD.slice(
      VUNG_UPLOAD.indexOf("mayDaDayChoSanPham("),
      VUNG_UPLOAD.indexOf("storagePut("),
    );
    expect(doanKiemQuyen, "đoạn giữa hai lời gọi phải chứa nhánh return sớm").toMatch(/return res\.status\(403\)/);
  });

  it("§5 — ĐỐI CHỨNG phạm vi: `mayDaDayChoSanPham(` KHÔNG xuất hiện ở NƠI KHÁC trong _core/index.ts (canh đúng MỘT route, không phải cả file đã có sẵn helper này ở chỗ khác)", () => {
    const soLanCaFile = (CORE_INDEX_SOURCE.match(/mayDaDayChoSanPham\(/g) ?? []).length;
    const soLanTrongVung = (VUNG_UPLOAD.match(/mayDaDayChoSanPham\(/g) ?? []).length;
    expect(soLanCaFile, "mayDaDayChoSanPham xuất hiện NGOÀI vùng route PUT ảnh template — kiểm tra lại phạm vi cắt").toBe(soLanTrongVung);
    expect(soLanTrongVung).toBeGreaterThanOrEqual(1);
  });
});
