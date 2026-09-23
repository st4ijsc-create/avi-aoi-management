/**
 * ★ F4 phần 2 — lưới cho khối "Vì sao model đề xuất": không vẽ khối rỗng, đuôi đúng, tổng ký tự THẬT,
 * và lý do KHÔNG BAO GIỜ gán sang thẻ khác thẻ nó được chụp cho.
 */
import { describe, it, expect } from "vitest";
import { chupLyDoDuyet, lyDoChoThe } from "./lyDoDuyetLogic";

describe("chupLyDoDuyet", () => {
  it("không nghĩ / chỉ khoảng trắng / chỉ thẻ think ⇒ null (không vẽ khối rỗng)", () => {
    expect(chupLyDoDuyet("a1", "")).toBeNull();
    expect(chupLyDoDuyet("a1", "   \n ")).toBeNull();
    expect(chupLyDoDuyet("a1", "<think></think>")).toBeNull();
    expect(chupLyDoDuyet("a1", undefined)).toBeNull();
  });
  it("thiếu actionId ⇒ null", () => {
    expect(chupLyDoDuyet("", "lý do")).toBeNull();
  });
  it("ngắn ⇒ giữ nguyên, bỏ thẻ think", () => {
    expect(chupLyDoDuyet("a1", "<think>Hàm thiếu kiểm null nên sửa dòng 12.</think>")).toEqual({
      actionId: "a1", duoi: "Hàm thiếu kiểm null nên sửa dòng 12.", soKyTu: 36, biCat: false,
    });
  });
  it("★★ dài ⇒ giữ ĐẦU (kế hoạch) + '…' + ĐUÔI (kết luận); phần giữa đệm bị bỏ; soKyTu là tổng THẬT", () => {
    // Hình dạng đo live (f4-live.mjs): đầu nêu yêu cầu, giữa tự kiểm, đuôi là câu đệm.
    const s = "KẾ HOẠCH: đổi hằng 900→1000." + "x".repeat(500) + "KẾT LUẬN: sửa dòng 13";
    const r = chupLyDoDuyet("a1", s, 100)!;
    expect(r.biCat).toBe(true);
    expect(r.soKyTu).toBe(s.length);
    expect(r.duoi.startsWith("KẾ HOẠCH: đổi hằng 900→1000.")).toBe(true);
    expect(r.duoi).toContain("\n…\n");
    expect(r.duoi.endsWith("KẾT LUẬN: sửa dòng 13")).toBe(true);
    expect(r.duoi.length).toBeLessThanOrEqual(100 + 3);
  });
  it("dài và có xuống dòng gần mép cắt ⇒ cắt ở ranh giới dòng, không giữa chữ", () => {
    const s = "A".repeat(40) + "\n" + "a".repeat(200) + "\n" + "B".repeat(50);
    const r = chupLyDoDuyet("a1", s, 100)!;
    expect(r.duoi).toBe("A".repeat(40) + "\n…\n" + "B".repeat(50));
  });
});

describe("lyDoChoThe", () => {
  const ly = chupLyDoDuyet("a1", "lý do")!;
  it("cùng thẻ ⇒ hiện", () => expect(lyDoChoThe(ly, "a1")).toBe(ly));
  it("★★ thẻ khác (lượt mới đang chảy) ⇒ KHÔNG gán lý do sai", () => expect(lyDoChoThe(ly, "a2")).toBeNull());
  it("không thẻ ⇒ null", () => {
    expect(lyDoChoThe(ly, null)).toBeNull();
    expect(lyDoChoThe(null, "a1")).toBeNull();
  });
});
