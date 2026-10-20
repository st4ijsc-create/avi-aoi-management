import { describe, expect, it } from "vitest";
import { giuQuyenChu } from "./bauChu";

describe("bauChu (Đợt 8.0, DB)", () => {
  it("hai bên giành ⇒ đúng một thắng; nhả ⇒ bên kia giành được", async () => {
    const ten = `thu-${Date.now()}`;
    const [a, b] = await Promise.all([giuQuyenChu(ten), giuQuyenChu(ten)]);
    expect([a.la, b.la].filter(Boolean)).toHaveLength(1);
    const thang = a.la ? a : b;
    const c = await giuQuyenChu(ten);
    expect(c.la).toBe(false);
    await thang.nha();
    const d = await giuQuyenChu(ten);
    expect(d.la).toBe(true);
    await d.nha();
  });
});
