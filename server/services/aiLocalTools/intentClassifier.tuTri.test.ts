/**
 * ★★★ 2026-08-24 · VÒNG TỰ-TRỊ-GHI — LƯỚI cho vị từ KHỞI ĐỘNG `laYDinhTuTri`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO VỊ TỪ NÀY LÀ CHỖ NGUY HIỂM NHẤT ĐỂ ĐO — và các đột biến phải bắt được:
 *   • đảo mặc định: `laYDinhTuTri` LUÔN trả `true` ⇒ câu THƯỜNG khởi động vòng tự-ghi ⇒ §2 ĐỎ
 *   • nới quá tay: một câu HỎI/ĐỌC/SỬA-MỘT-TỆP lọt thành ý định tự trị            ⇒ §2 ĐỎ
 *   • thu quá tay: câu tự trị THẬT (có/không dấu) bị coi là câu thường            ⇒ §1 ĐỎ
 *
 * Chiều hỏng ĐẮT là THỪA (một câu thường mở vòng tự ghi đĩa), nên §2 (chống dương-tính-giả) là
 * trọng tâm. Lưới A/B có-dấu/không-dấu vì bộ chọn tool của repo này từng gần như mù với đầu vào
 * không dấu (G4-A: accuracy 0,917 → 0,167).
 */
import { describe, it, expect } from "vitest";
import { laYDinhTuTri } from "./intentClassifier";

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — CÂU TỰ TRỊ THẬT ⇒ true (A/B có dấu / không dấu)", () => {
  const co = [
    "tự sửa cho test xanh",
    "tự động sửa lỗi build",
    "tự vá cho tới khi test pass",
    "tự động khắc phục cho tới khi build xanh",
    "sửa lặp cho tới khi test xanh",
    "auto-fix the build until tests pass",
    "keep fixing until the tests pass",
    "please self-repair until the build is green",
  ];
  for (const q of co) it(`★★ "${q}" ⇒ Ý ĐỊNH TỰ TRỊ`, () => expect(laYDinhTuTri(q)).toBe(true));

  // B — cùng câu, BỎ DẤU (người dùng gõ không dấu vẫn phải nhận ra).
  const khongDau = [
    "tu sua cho test xanh",
    "tu dong sua loi build",
    "sua lap cho toi khi test xanh",
  ];
  for (const q of khongDau) it(`★★★ (không dấu) "${q}" ⇒ Ý ĐỊNH TỰ TRỊ`, () => expect(laYDinhTuTri(q)).toBe(true));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — CHỐNG DƯƠNG-TÍNH-GIẢ: câu THƯỜNG KHÔNG được khởi động vòng tự-ghi", () => {
  const khong = [
    // ĐỌC / HỎI / GIẢI THÍCH — đường HITL cũ, không tự trị.
    "đọc tệp src/Calculator.cs",
    "liệt kê thư mục server/services",
    "giải thích lớp Calculator và có lỗi gì không",
    "src/Calculator.cs có bug nào không?",
    // SỬA MỘT TỆP tường minh (trichDuongSuaTatDinh lo) — KHÔNG phải một VÒNG tự sửa.
    "sửa src/Calculator.cs: thêm dòng chú thích",
    "fix src/StringUtils.cs to add a null check",
    // CHẠY tường minh — một lượt, không phải vòng tự sửa.
    "chạy dotnet test và cho tôi biết kết quả",
    "run npm run check",
    // Văn xuôi vô can trùng chữ.
    "tự tin sửa lại phần này giúp mình",
    "sửa lại cho tôi khi nào rảnh",
    "tạo dự án C# đọc file pdf",
    "",
  ];
  for (const q of khong) it(`★★★ "${q}" ⇒ KHÔNG khởi động tự trị`, () => expect(laYDinhTuTri(q)).toBe(false));

  it("★ không ném trên đầu vào rỗng/khoảng trắng", () => {
    expect(() => laYDinhTuTri("")).not.toThrow();
    expect(laYDinhTuTri("   ")).toBe(false);
  });
});
