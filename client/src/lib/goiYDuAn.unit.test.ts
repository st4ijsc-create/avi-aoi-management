/**
 * ★★★ 2026-08-23 · UX LÔ 1 (B1) — LƯỚI CHO **GỢI Ý THEO DỰ ÁN**.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • id lạ rơi về gợi ý repo (gợi SAI tệ hơn không gợi)            ⇒ §2 ĐỎ
 *   • gợi ý csharp/react nêu một TỆP KHÔNG TỒN TẠI trên đĩa         ⇒ §3 ĐỎ (đúng lỗi live: nút
 *     gợi ý dẫn vào tệp không có thật)
 *   • gợi ý CHẠY LỆNH mất cờ `canChayLenh` (hiện cả cho người không quyền) ⇒ §1 ĐỎ
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { goiYTheoDuAn } from "./goiYDuAn";

const GOC_REPO = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

describe("§1 — ba dự án đã khai đều có ĐÚNG 3 gợi ý, mỗi bộ đúng hệ sinh thái", () => {
  it("★★★ repo: giữ nguyên ba gợi ý cũ; csharp: dotnet; react: node --test — mỗi bộ đúng MỘT gợi ý chạy lệnh", () => {
    for (const id of ["repo", "csharp", "react"]) {
      const g = goiYTheoDuAn(id);
      expect(g.length, id).toBe(3);
      expect(g.filter((x) => x.canChayLenh === true).length, `${id}: đúng một gợi ý chạy lệnh`).toBe(1);
    }
    expect(goiYTheoDuAn("csharp").find((x) => x.canChayLenh)!.macDinh).toContain("dotnet test");
    expect(goiYTheoDuAn("react").find((x) => x.canChayLenh)!.macDinh).toContain("node --test");
    expect(goiYTheoDuAn("repo").find((x) => x.canChayLenh)!.macDinh).toContain("npm run check");
  });

  it("★★ khoá i18n duy nhất từng gợi ý (không hai nút trùng một khoá)", () => {
    for (const id of ["repo", "csharp", "react"]) {
      const khoa = goiYTheoDuAn(id).map((x) => x.khoa);
      expect(new Set(khoa).size).toBe(khoa.length);
      for (const k of khoa) expect(k.startsWith("repoWs.suggest.")).toBe(true);
    }
  });
});

describe("§2 — id lạ ⇒ ẨN gợi ý (mặc định an toàn), KHÔNG rơi về bộ repo", () => {
  it("★★★ id do admin tự đăng ký / rỗng / null ⇒ []", () => {
    expect(goiYTheoDuAn("du-an-la")).toEqual([]);
    expect(goiYTheoDuAn("")).toEqual([]);
    expect(goiYTheoDuAn(null)).toEqual([]);
    expect(goiYTheoDuAn(undefined)).toEqual([]);
  });
});

describe("§3 — gợi ý bám CÂY THẬT: tệp nêu trong câu phải TỒN TẠI trong dự án mẫu", () => {
  it("★★★ csharp: src/Calculator.cs + CalculatorDemo.sln có thật trên đĩa", () => {
    expect(existsSync(join(GOC_REPO, "sandbox-projects", "csharp-demo", "src", "Calculator.cs"))).toBe(true);
    expect(existsSync(join(GOC_REPO, "sandbox-projects", "csharp-demo", "CalculatorDemo.sln"))).toBe(true);
  });

  it("★★★ react: src/validate.mjs + test/validate.test.mjs có thật trên đĩa", () => {
    expect(existsSync(join(GOC_REPO, "sandbox-projects", "react-pg-demo", "src", "validate.mjs"))).toBe(true);
    expect(existsSync(join(GOC_REPO, "sandbox-projects", "react-pg-demo", "test", "validate.test.mjs"))).toBe(true);
  });
});
