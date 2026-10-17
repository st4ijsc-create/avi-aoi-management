/**
 * ★★★ Đợt 3b — LƯỚI NỐI DÂY trên CHÍNH mã nguồn `AICodingWorkspace.tsx` (cùng khuôn `aiCodingWorkspacePhien.unit.test.ts`):
 *   • nút tệp chỉ ĐỀ XUẤT (setPending/setPendingDiff) — điểm gọi `confirmM.mutateAsync(` vẫn ĐÚNG MỘT;
 *   • tạo tệp = `deXuatSuaTay` với `original: ""` (đường có sẵn), xoá/đổi tên = hai tuyến đề xuất của tool sẵn có;
 *   • dán ảnh ⇒ OCR ⇒ CHÈN chữ vào ô (không tự gửi câu hỏi);
 *   • mở phiên khôi phục nhật ký lệnh từ trình duyệt; xoá phiên xoá nhật ký;
 *   • tab Git vẽ `KhungGit`; bộ chọn phiên có `onDoiTen`; màn trí nhớ có mặt.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "AICodingWorkspace.tsx"), "utf8");
const dem = (s: string, k: string) => s.split(k).length - 1;

/** Thân một `const ten = useCallback(...)` tới dòng deps đóng `}, [` ở cột 2. */
function thanHam(ten: string): string {
  const i = MA.indexOf(`const ${ten} = useCallback(`);
  expect(i, `không thấy ${ten}`).toBeGreaterThan(0);
  const j = MA.indexOf("\n  }, [", i);
  return MA.slice(i, j);
}

describe("Đợt 3b — nối dây trang", () => {
  it("★★★ HITL: vẫn ĐÚNG MỘT điểm gọi confirmM.mutateAsync; ba đề xuất tệp không gọi confirm", () => {
    expect(dem(MA, "await confirmM.mutateAsync(")).toBe(1); // (docblock đầu tệp nhắc tên hàm — đếm LỜI GỌI)
    for (const f of ["deXuatTaoTep", "deXuatXoaHoacDoiTen", "xuLyAnhLoi", "doiTenPhien"]) {
      expect(thanHam(f)).not.toContain("confirmM");
    }
  });

  it("★★★ tạo tệp đi qua deXuatSuaTay với original rỗng ⇒ thẻ duyệt diff; xoá/đổi tên ⇒ tuyến đề xuất ⇒ setPending", () => {
    const tao = thanHam("deXuatTaoTep");
    expect(tao).toContain("deXuatSuaTayM.mutateAsync({ path: duong, original: \"\"");
    expect(tao).toContain("setPendingDiff(");
    const xd = thanHam("deXuatXoaHoacDoiTen");
    expect(xd).toContain("deXuatXoaTepM.mutateAsync(");
    expect(xd).toContain("deXuatDoiTenTepM.mutateAsync(");
    expect(xd).toContain("setPending(");
    expect(MA).toContain("<ThaoTacTep");
  });

  it("★★ handleConfirm có nhánh delete_file/rename_file (đóng/đổi tab, làm mới cây) — không tự chế câu kết quả", () => {
    const hc = MA.slice(MA.indexOf("const handleConfirm = useCallback("), MA.indexOf("const handleCancel = useCallback("));
    expect(hc).toContain('pending.tool === "delete_file" || pending.tool === "rename_file"');
    expect(hc).toContain("out?.textSummary");
  });

  it("★★★ dán/kéo ảnh ⇒ OCR ⇒ CHÈN vào ô; KHÔNG tự gửi (handleSend)", () => {
    expect(MA).toMatch(/onPaste=\{\(e\) => \{\s*const f = layAnhTuDuLieu\(e\.clipboardData\)/);
    expect(MA).toMatch(/onDrop=\{\(e\) => \{\s*const f = layAnhTuDuLieu\(e\.dataTransfer\)/);
    const x = thanHam("xuLyAnhLoi");
    expect(x).toContain("ocrAnhM.mutateAsync(");
    expect(x).toContain("setInput(");
    expect(x).not.toContain("handleSend");
  });

  it("★★ phiên: mở lại khôi phục nhật ký lệnh (trình duyệt) + tính lại địa điểm lỗi; xoá phiên xoá nhật ký; có đổi tên", () => {
    const cp = thanHam("chonPhien");
    expect(cp).toContain("docNhatKyLenh(");
    expect(cp).toContain("phanTichLoiViTri(");
    expect(thanHam("xoaPhienNay")).toContain("xoaNhatKyLenh(");
    expect(MA).toContain("onDoiTen={(id, ten) => void doiTenPhien(id, ten)}");
  });

  it("★★ tab Git vẽ KhungGit; màn trí nhớ có mặt", () => {
    expect(MA).toContain('data-tab-duoi="git"');
    expect(MA).toMatch(/duoiChat === "git" \? \(\s*projectId \? \(\s*<KhungGit/);
    expect(MA).toContain("<QuanLyTriNho projectId={projectId} />");
  });
});
