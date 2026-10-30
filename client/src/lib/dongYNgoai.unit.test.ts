// @vitest-environment jsdom
// Đồng ý theo PHIÊN (sessionStorage, không bền) + xác nhận vận hành theo HỘI THOẠI; đổi nhà cung cấp/model ⇒ hỏi lại.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daDongYNgoai, daXacNhanVanHanh, datDongYNgoai, datXacNhanVanHanh, tachMaNgoai } from "./dongYNgoai";

const A = "ngoai:openai_compat:gpt-x";
const B = "ngoai:anthropic:claude-x";
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("tachMaNgoai", () => {
  it("tách nhà cung cấp + model (model có thể chứa ':'); mã khác ⇒ null", () => {
    expect(tachMaNgoai(A)).toEqual({ nhaCungCap: "openai_compat", model: "gpt-x" });
    expect(tachMaNgoai("ngoai:gemini:models:pro-1")).toEqual({ nhaCungCap: "gemini", model: "models:pro-1" });
    for (const x of ["auto", "vai-tro:chat", "ho-so:p1", "ngoai:", "ngoai:a", "ngoai:a:"]) expect(tachMaNgoai(x), x).toBeNull();
  });
});

describe("đồng ý theo PHIÊN", () => {
  it("chưa đồng ý ⇒ false; đồng ý ⇒ true CHỈ cho đúng nhà cung cấp:model; đổi model/nhà cung cấp ⇒ hỏi lại", () => {
    expect(daDongYNgoai(A)).toBe(false);
    datDongYNgoai(A);
    expect(daDongYNgoai(A)).toBe(true);
    expect(daDongYNgoai("ngoai:openai_compat:gpt-y")).toBe(false);
    expect(daDongYNgoai(B)).toBe(false);
  });
  it("lưu ở sessionStorage, KHÔNG ở localStorage (không bền qua phiên)", () => {
    datDongYNgoai(A);
    expect(sessionStorage.getItem("aiNgoai.dongY")).toContain("openai_compat:gpt-x");
    expect(localStorage.length).toBe(0);
  });
  it("mã không phải ngoài ⇒ không cần đồng ý (true) và đặt đồng ý không làm gì", () => {
    expect(daDongYNgoai("vai-tro:chat")).toBe(true);
    datDongYNgoai("vai-tro:chat");
    expect(sessionStorage.length).toBe(0);
  });
  it("storage hỏng/bị chặn ⇒ coi như CHƯA đồng ý (đóng mặc định), không văng", () => {
    const boom = () => {
      throw new Error("chan");
    };
    vi.stubGlobal("sessionStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(daDongYNgoai(A)).toBe(false);
    expect(() => datDongYNgoai(A)).not.toThrow();
  });
  it("dữ liệu lưu hỏng (không phải mảng chuỗi) ⇒ coi như chưa đồng ý", () => {
    sessionStorage.setItem("aiNgoai.dongY", '{"x":1}');
    expect(daDongYNgoai(A)).toBe(false);
    sessionStorage.setItem("aiNgoai.dongY", "không phải JSON");
    expect(daDongYNgoai(A)).toBe(false);
  });
});

describe("xác nhận vận hành theo HỘI THOẠI", () => {
  it("MỘT lần mỗi hội thoại + model: hội thoại khác / model khác ⇒ hỏi lại", () => {
    expect(daXacNhanVanHanh("c1", A)).toBe(false);
    datXacNhanVanHanh("c1", A);
    expect(daXacNhanVanHanh("c1", A)).toBe(true);
    expect(daXacNhanVanHanh("c2", A)).toBe(false);
    expect(daXacNhanVanHanh("c1", B)).toBe(false);
  });
  it("độc lập với đồng ý theo phiên (đồng ý chung KHÔNG thay xác nhận vận hành)", () => {
    datDongYNgoai(A);
    expect(daXacNhanVanHanh("c1", A)).toBe(false);
  });
  it("sessionStorage, không bền", () => {
    datXacNhanVanHanh("c1", A);
    expect(sessionStorage.getItem("aiNgoai.xacNhanVanHanh")).toContain("c1|openai_compat:gpt-x");
    expect(localStorage.length).toBe(0);
  });
});
