/**
 * loiKhaiPhamViDem.unit.test.ts — **NHÃN `tong-quan-pham-vi` PHẢI NÓI ĐÚNG NÓ ĐẾM CÁI GÌ.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT LỜI KHAI CÓ HẠN SỬ DỤNG, VÀ KHÔNG AI CƯỠNG CHẾ HẠN
 * ════════════════════════════════════════════════════════════════════════════
 * Câu `(đếm theo toàn nhà máy)` **đúng** khi màn luôn nạp **một** nhà máy. Task 20 cho phép nạp
 * nhiều, và câu ấy thành **sai trong im lặng** — không lỗi, không lưới nào đỏ.
 *
 * Đo trên trình duyệt thật (`.qa-v2/tho-v5/_m3c.json`), `hang-tong-quan` so với `dem-may`:
 *
 * | phạm vi | `hang-tong-quan` | `dem-may` | câu cũ |
 * |---|---|---|---|
 * | một tầng | 371 | 371 | đúng (1 nhà máy) |
 * | FUYU-F | 549 | 549 | đúng |
 * | **tập đoàn** | **1.700** | 1.700 | **SAI — "the factory" số ít cho 6 nhà máy** |
 *
 * Sau bản vá, đo lại cùng harness: một tầng giữ *"(counted across the whole factory)"*, tập đoàn
 * thành *"(counted across the **6** factories currently loaded)"*.
 *
 * ★ Nghi can BAN ĐẦU của mục này là `dai-canh-bao` (*"Counted across your whole account scope"*).
 *   Phép đo **bác bỏ** nó: `Alarms (80)` y hệt ở cả ba phạm vi ⇒ con số đúng là của toàn tài
 *   khoản, đúng như nó khai. Khuyết tật thật nằm ở **nhãn bên cạnh** — lại một lần nữa,
 *   bác bỏ một nghi can không phải là đóng hồ sơ.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

const TRANG = docMaNguon(resolve(__dirname, "../../../../src/pages/TwinVanHanh.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("★★★ nhãn phạm vi của hàng tổng quan", () => {
  it("★★★ nhiều nhà máy ⇒ câu NÊU SỐ, không còn 'toàn nhà máy' số ít", () => {
    expect(TRANG).toContain("soNhaMayNap > 1");
    expect(TRANG).toContain("twin3d.vanHanh.demTheoNhieuNhaMay");
  });

  it("★★★ MỘT nhà máy ⇒ GIỮ NGUYÊN câu cũ (không đổi hành vi mọi phạm vi dưới)", () => {
    expect(TRANG).toContain('t("twin3d.vanHanh.demTheoNhaMay", "(đếm theo toàn nhà máy)")');
  });

  it("★★★ G12 — MỘT biểu thức, HAI người đọc: `phamViThuc` và nhãn dùng CHUNG `soNhaMayNap`", () => {
    /*
     * Chép biểu thức lần thứ hai thì hai bản đồng ý tới lần sửa đầu tiên, rồi màn **khai một
     * đằng và hạ cấp một nẻo** — và không ai đỏ.
     */
    expect(TRANG).toContain(
      "const soNhaMayNap = napNhaMay.gopKhuonVien ? factories.length : factoryId === null ? 0 : 1;",
    );
    expect(TRANG).toContain("phamViThuc(phamViYeuCau, factories.length, soNhaMayNap)");
    // …và KHÔNG còn bản chép cũ nằm trong lời gọi.
    expect(TRANG).not.toMatch(/phamViThuc\(\s*phamViYeuCau,\s*factories\.length,\s*napNhaMay\.gopKhuonVien/);
  });

  it("★★★ ĐỐI CHỨNG — lời khai của `dai-canh-bao` GIỮ NGUYÊN (phép đo đã minh oan cho nó)", () => {
    // `Alarms (80)` y hệt ở cả ba phạm vi ⇒ nó đúng là số của toàn tài khoản. Đổi câu ấy sẽ là
    // sửa một thứ không hỏng — và làm mất một lời khai đang đúng.
    expect(TRANG).toContain("twin3d.daiCanhBao.phamViTaiKhoan");
  });
});
