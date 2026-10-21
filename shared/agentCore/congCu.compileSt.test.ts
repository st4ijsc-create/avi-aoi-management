/**
 * ★ Đợt 9 (2026-10-21) — tool TUỲ CHỌN `compile_st`: schema + kiểm tham số + lời nhắc hệ thống.
 *
 * ĐỘT BIẾN PHẢI BẮT: compile_st lọt vào bộ phơi MẶC ĐỊNH (mọi người gọi — extension, CLI — đổi bộ tool) · xếp loại ghi/lệnh
 * (mất ở hoi) · nhận cả path lẫn code / không nhận gì · quy tắc 13 xuất hiện khi tool KHÔNG được phơi (lời nhắc cờ tắt
 * phải GIỐNG TỪNG BYTE bản trước — A/B sạch) · schema có `pattern`/`maxLength` (grammar llama.cpp).
 */
import { describe, expect, it } from "vitest";
import { CONG_CU, CONG_CU_TUY_CHON, LOAI_CONG_CU, congCuTheoCheDo, kiemThamSo } from "./congCu";
import { QUY_TAC_COMPILE_ST, dungLoiNhacHeThong } from "./loiNhac";
import { timGioiHanGrammar } from "../../server/services/ai/nativeToolCalls";

const ten = (ds: { function: { name: string } }[]) => ds.map((t) => t.function.name);

describe("compile_st — bộ phơi", () => {
  it("mặc định KHÔNG có ở chế độ nào; có khi người gọi liệt kê ở `them` (kể cả hoi — loại đọc)", () => {
    expect(CONG_CU_TUY_CHON.has("compile_st")).toBe(true);
    expect(LOAI_CONG_CU.compile_st).toBe("doc");
    for (const c of ["hoi", "sua", "tu-dong"] as const) {
      expect(ten(congCuTheoCheDo(c))).not.toContain("compile_st");
      expect(ten(congCuTheoCheDo(c, ["compile_st"]))).toContain("compile_st");
      expect(congCuTheoCheDo(c, ["compile_st"]).length).toBe(congCuTheoCheDo(c).length + 1);
    }
  });

  it("schema: path + code đều tuỳ chọn, lọt grammar llama.cpp", () => {
    const s = CONG_CU.find((t) => t.function.name === "compile_st")!.function;
    expect((s.parameters as any).required).toEqual([]);
    expect(Object.keys((s.parameters as any).properties).sort()).toEqual(["code", "path"]);
    expect(s.description).toMatch(/only compiles/i);
    expect(timGioiHanGrammar(CONG_CU)).toEqual([]);
  });
});

describe("compile_st — kiemThamSo", () => {
  it("đúng MỘT trong path / code", () => {
    expect(kiemThamSo("compile_st", { path: "src/a.st" })).toEqual({ ok: true, thamSo: { path: "src/a.st" } });
    expect(kiemThamSo("compile_st", { code: "PROGRAM P END_PROGRAM" }).ok).toBe(true);
    const rong = kiemThamSo("compile_st", {});
    expect(rong.ok).toBe(false);
    if (!rong.ok) expect(rong.loiChoModel).toMatch(/either "path".*or "code"/);
    expect(kiemThamSo("compile_st", { path: "a.st", code: "x" }).ok).toBe(false);
    expect(kiemThamSo("compile_st", { code: "x".repeat(64 * 1024 + 1) }).ok).toBe(false);
  });
});

describe("compile_st — lời nhắc hệ thống", () => {
  for (const cheDo of ["hoi", "sua", "tu-dong"] as const) {
    it(`${cheDo}: KHÔNG phơi ⇒ lời nhắc giống từng byte bản không có tham số congCu; phơi ⇒ có đúng quy tắc 13`, () => {
      const goc = dungLoiNhacHeThong({ cheDo, ngonNgu: "vi" });
      expect(dungLoiNhacHeThong({ cheDo, ngonNgu: "vi", congCu: ten(congCuTheoCheDo(cheDo)) })).toBe(goc);
      const bat = dungLoiNhacHeThong({ cheDo, ngonNgu: "vi", congCu: ten(congCuTheoCheDo(cheDo, ["compile_st"])) });
      expect(bat).toContain(QUY_TAC_COMPILE_ST);
      expect(bat.replace(`${QUY_TAC_COMPILE_ST}\n`, "")).toBe(goc);
      expect(QUY_TAC_COMPILE_ST).toMatch(/NOT compile-checked/);
    });
  }
});
