/**
 * Đợt 10.2 — `dungNguCanhKb`: các trường người dùng chọn (`chonModel`, `modelTask`, `cheDoNghi`) PHẢI tới máy chủ.
 * Trước 2026-10-27 hàm dựng context chỉ chép 6 trường ⇒ bộ chọn tầng model (G4) và chế độ nghĩ (F3) ở màn lập trình là nút trang trí.
 */
import { describe, expect, it } from "vitest";
import { dungNguCanhKb } from "./useKbChatStream";

const goc = { route: "/ai-chat", uiLanguage: "vi" };

describe("dungNguCanhKb", () => {
  it("lượt thường: payload KHÔNG đổi một byte (chỉ route + uiLanguage)", () => {
    expect(dungNguCanhKb(goc)).toEqual(goc);
    expect(dungNguCanhKb({ ...goc, chonModel: "auto", modelTask: "auto" })).toEqual(goc);
  });
  it("chonModel cụ thể đi nguyên văn", () => {
    expect(dungNguCanhKb({ ...goc, chonModel: "vai-tro:code.software" })).toEqual({ ...goc, chonModel: "vai-tro:code.software" });
  });
  it("modelTask ≠ auto và cheDoNghi đi tới máy chủ (từng bị bỏ rơi)", () => {
    expect(dungNguCanhKb({ ...goc, modelTask: "code", cheDoNghi: "nhanh" })).toEqual({ ...goc, modelTask: "code", cheDoNghi: "nhanh" });
  });
  it("các trường lập trình cũ vẫn đi: codingMode, projectId, codingEditPath, dauRaKhongTinCay, selectedMachineCode", () => {
    const c = dungNguCanhKb({ ...goc, codingMode: true, projectId: "p1", codingEditPath: "a/b.cs", dauRaKhongTinCay: "x", selectedMachineCode: "M1" });
    expect(c).toMatchObject({ codingMode: true, projectId: "p1", codingEditPath: "a/b.cs", dauRaKhongTinCay: "x", selectedMachineCode: "M1" });
  });
});
