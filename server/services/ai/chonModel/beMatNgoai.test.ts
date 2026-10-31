/**
 * ★ Đợt 10.4b — BỀ MẶT dùng được model NGOÀI (`BE_MAT_NGOAI_DUOC_DUNG`): ghim ĐÚNG tập đang mở. Mỗi bề mặt mở là một lần rà + một lần
 * gộp riêng (kế hoạch v2.1 D1); thêm / bỏ một bề mặt mà không sửa ghim ⇒ đỏ. "agent" (L3) và extension (E) CHƯA mở.
 * Đường thật: nhánh màn lập trình (`codingNgoai.ts`) đọc hằng này — "coding" đóng ⇒ 404 `modelNgoaiChuaCaiDat`.
 */
import { describe, expect, it } from "vitest";
import { BE_MAT_NGOAI_DUOC_DUNG } from "./kieu";
import { phuThuocCodingNgoaiThat } from "../../../routes/codingNgoai";
import { phuThuocKbNgoaiThat } from "../../../routes/kbNgoai";

describe("BE_MAT_NGOAI_DUOC_DUNG", () => {
  it("ĐÚNG tập mở: luong · kiem-dinh · chat (L1) · coding (L2, Hỏi); agent CHƯA", () => {
    expect([...BE_MAT_NGOAI_DUOC_DUNG]).toEqual(["luong", "kiem-dinh", "chat", "coding"]);
    expect(BE_MAT_NGOAI_DUOC_DUNG).not.toContain("agent");
  });
  it("phụ thuộc THẬT của nhánh KB và nhánh màn lập trình đọc CÙNG hằng (không bản sao)", async () => {
    expect(await phuThuocKbNgoaiThat.beMatMo()).toBe(BE_MAT_NGOAI_DUOC_DUNG);
    expect(await phuThuocCodingNgoaiThat.beMatMo()).toBe(BE_MAT_NGOAI_DUOC_DUNG);
    expect(await phuThuocCodingNgoaiThat.beMatMo()).toContain("coding");
  });
});
