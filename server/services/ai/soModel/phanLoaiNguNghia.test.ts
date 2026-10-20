import { describe, expect, it } from "vitest";
import { cauMauTheoVaiTro, chonVaiTroTheoNhung, phanLoaiNguNghia, VAI_TRO_TANG_4, VI_DU_MAC_DINH } from "./phanLoaiNguNghia";

describe("phanLoaiNguNghia (Đợt 7.3, tầng 4)", () => {
  const mau = new Map<string, number[][]>([
    ["code.plc", [[1, 0, 0], [0.9, 0.1, 0]]],
    ["code.software", [[0, 1, 0]]],
    ["chat", [[0, 0, 1]]],
  ]);

  it("chọn vai trò có câu mẫu gần nhất khi qua ngưỡng + cách biệt", () => {
    expect(chonVaiTroTheoNhung([1, 0.05, 0], mau, 0.5, 0.02).vaiTro).toBe("code.plc");
    expect(chonVaiTroTheoNhung([0.1, 1, 0], mau, 0.5, 0.02).vaiTro).toBe("code.software");
  });

  it("dưới ngưỡng ⇒ null (tầng 5 — mặc định của bề mặt)", () => {
    const kq = chonVaiTroTheoNhung([1, 1, 1], mau, 0.9, 0.02);
    expect(kq.vaiTro).toBeNull();
    expect(kq.lyDo).toContain("ngưỡng");
  });

  it("hai vai trò sát nhau ⇒ null", () => {
    const kq = chonVaiTroTheoNhung([1, 1.2, 0], mau, 0.5, 0.05); // code.software 0.768 vs code.plc 0.721
    expect(kq.vaiTro).toBeNull();
    expect(kq.lyDo).toContain("sát");
  });

  it("câu mẫu: CSDL thắng, rỗng ⇒ mặc định; đủ mọi vai trò tầng 4", () => {
    const m = cauMauTheoVaiTro((vt) => (vt === "chat" ? ["x"] : []));
    expect(m.get("chat")).toEqual(["x"]);
    expect(m.get("code.plc")).toBe(VI_DU_MAC_DINH["code.plc"]);
    expect([...m.keys()].sort()).toEqual([...VAI_TRO_TANG_4].sort());
  });

  it("nhúng hỏng ⇒ null, không ném", async () => {
    const kq = await phanLoaiNguNghia("viết ST", { cauMau: cauMauTheoVaiTro(), nhung: async () => { throw new Error("chết"); } });
    expect(kq.vaiTro).toBeNull();
    expect(kq.lyDo).toContain("nhúng hỏng");
  });
});
