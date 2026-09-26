/**
 * ★★★ 2026-08-23 · UX LÔ 1 (D2) — LƯỚI CHO **PHÉP CHIA TỆP NHIỄU** của cây tệp.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bảng đuôi phình sang tệp MÃ (`.ts` bị coi là nhiễu — cây trống trơn)  ⇒ §1 ĐỎ
 *   • bỏ `toLowerCase` (`.PNG` lọt qua)                                     ⇒ §1 ĐỎ
 *   • chia làm MẤT mục hoặc ĐẢO thứ tự                                      ⇒ §2 ĐỎ
 */
import { describe, it, expect } from "vitest";
import { chiaTepHienThi, laTepNhieu } from "./cayTepHienThi";

describe("§1 — laTepNhieu: đúng bảng đuôi nhiễu, không phình sang tệp mã", () => {
  it("★★★ ảnh/log/nhị phân ⇒ true (kể cả viết HOA)", () => {
    for (const p of ["anh.png", "a/b/c.jpg", "x.jpeg", "server.log", "khoa.lic", "du-lieu.b64", "model.pt", "lib.jar", "ANH.PNG"]) {
      expect(laTepNhieu(p), p).toBe(true);
    }
  });

  it("★★★ tệp MÃ/cấu hình ⇒ false — cây không được trống trơn vì vá quá tay", () => {
    for (const p of ["a.ts", "b.tsx", "c.cs", "d.sln", "e.json", "f.md", "g.mjs", "khong-duoi", "x.spec.ts"]) {
      expect(laTepNhieu(p), p).toBe(false);
    }
  });
});

describe("§2 — chiaTepHienThi: không mất mục, không đảo thứ tự trong từng nhóm", () => {
  it("★★★ chinh + nhieu = đúng tập vào; thứ tự từng nhóm giữ nguyên", () => {
    const vao = [
      { path: "a.ts" }, { path: "b.png" }, { path: "c.cs" }, { path: "d.log" }, { path: "e.md" },
    ];
    const { chinh, nhieu } = chiaTepHienThi(vao);
    expect(chinh.map((x) => x.path)).toEqual(["a.ts", "c.cs", "e.md"]);
    expect(nhieu.map((x) => x.path)).toEqual(["b.png", "d.log"]);
    expect(chinh.length + nhieu.length).toBe(vao.length);
  });

  it("★ danh sách rỗng ⇒ hai nhóm rỗng, không ném", () => {
    expect(chiaTepHienThi([])).toEqual({ chinh: [], nhieu: [] });
  });
});
