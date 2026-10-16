import { describe, expect, it } from "vitest";
import { KHOA_CHE_DO_CHAT, chuanHoaCheDo, docCheDoDaLuu, luuCheDo, type KhoNho } from "./cheDoChat";

function khoGia(dau: Record<string, string> = {}): KhoNho & { du: Record<string, string> } {
  const du = { ...dau };
  return { du, getItem: (k) => du[k] ?? null, setItem: (k, v) => void (du[k] = v) };
}
const khoNem: KhoNho = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
};

describe("cheDoChat", () => {
  it("mặc định Hỏi khi chưa lưu / giá trị lạ", () => {
    expect(docCheDoDaLuu(true, khoGia())).toBe("hoi");
    expect(docCheDoDaLuu(true, khoGia({ [KHOA_CHE_DO_CHAT]: "bay" }))).toBe("hoi");
    expect(docCheDoDaLuu(true, null)).toBe("hoi");
  });
  it("tu-dong chỉ giữ khi có quyền ai_repo_exec, không thì về Hỏi", () => {
    expect(chuanHoaCheDo("tu-dong", true)).toBe("tu-dong");
    expect(chuanHoaCheDo("tu-dong", false)).toBe("hoi");
    expect(chuanHoaCheDo("sua", false)).toBe("sua");
  });
  it("lưu rồi đọc lại; kho ném lỗi không làm vỡ", () => {
    const k = khoGia();
    luuCheDo("sua", k);
    expect(docCheDoDaLuu(false, k)).toBe("sua");
    expect(() => luuCheDo("sua", khoNem)).not.toThrow();
    expect(docCheDoDaLuu(true, khoNem)).toBe("hoi");
  });
});
