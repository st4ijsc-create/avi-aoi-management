/**
 * ★ 2026-10-18 — tool `lookup_api` (khuyến nghị #1/#2 báo cáo `2026-10-18-ai-local-nguon-hoc-code.md`): tra CHÍNH XÁC
 * ký hiệu API trong chỉ mục cục bộ (XML IntelliSense .NET, .d.ts, JDK src.zip, Python stdlib) + quy tắc lời nhắc "lỗi
 * biên dịch kiểu/thành viên không tồn tại ⇒ gọi lookup_api TRƯỚC khi đoán".
 *
 * ĐỘT BIẾN PHẢI BẮT: lookup_api xếp loại ghi/lệnh (mất ở chế độ hoi) · language nhận giá trị tuỳ ý · name dài vô hạn ·
 * schema có `pattern`/`maxLength` (grammar llama.cpp) · lời nhắc không nêu mã lỗi C#/TS/Java/Python.
 */
import { describe, expect, it } from "vitest";
import { CONG_CU, LOAI_CONG_CU, NGON_NGU_API, congCuTheoCheDo, kiemThamSo } from "./congCu";
import { dungLoiNhacHeThong } from "./loiNhac";
import { timGioiHanGrammar } from "../../server/services/ai/nativeToolCalls";

const schema = () => CONG_CU.find((t) => t.function.name === "lookup_api")!.function;

describe("lookup_api — schema", () => {
  it("mô tả tiếng Anh nói rõ: tên chính xác, KHÔNG phải tìm ngữ nghĩa; tham số name (bắt buộc) + language (enum)", () => {
    const s = schema();
    expect(s.description).toMatch(/exact/i);
    expect(s.description).toMatch(/namespace|module|package/i);
    expect((s.parameters as any).required).toEqual(["name"]);
    expect(Object.keys((s.parameters as any).properties).sort()).toEqual(["language", "name"]);
    expect((s.parameters as any).properties.language.enum).toEqual([...NGON_NGU_API]);
    expect([...NGON_NGU_API]).toEqual(["csharp", "typescript", "java", "python"]);
  });

  it("lọt grammar llama.cpp", () => {
    expect(timGioiHanGrammar(CONG_CU)).toEqual([]);
  });

  it("loại ĐỌC ⇒ có ở MỌI chế độ, kể cả hoi", () => {
    expect(LOAI_CONG_CU.lookup_api).toBe("doc");
    for (const c of ["hoi", "sua", "tu-dong"] as const) expect(congCuTheoCheDo(c).map((t) => t.function.name)).toContain("lookup_api");
  });
});

describe("lookup_api — kiemThamSo", () => {
  it("name bắt buộc, cắt trần 200 ký tự; language enum", () => {
    expect(kiemThamSo("lookup_api", '{"name":"SqlBulkCopyOptions"}')).toEqual({ ok: true, thamSo: { name: "SqlBulkCopyOptions" } });
    expect(kiemThamSo("lookup_api", { name: "HttpClient", language: "java" })).toEqual({ ok: true, thamSo: { name: "HttpClient", language: "java" } });
    const sai = kiemThamSo("lookup_api", { name: "x", language: "rust" });
    expect(sai.ok).toBe(false);
    if (!sai.ok) {
      expect(sai.loiChoModel).toMatch(/csharp/);
      expect(sai.loiChoModel).toMatch(/Example/);
    }
    expect(kiemThamSo("lookup_api", {}).ok).toBe(false);
    expect(kiemThamSo("lookup_api", { name: "a".repeat(201) }).ok).toBe(false);
  });
});

describe("lời nhắc — vòng 'lỗi biên dịch → tra ký hiệu'", () => {
  for (const cheDo of ["hoi", "sua", "tu-dong"] as const) {
    it(`chế độ ${cheDo}: nêu lookup_api + các mã lỗi 'không tìm thấy ký hiệu' của 4 ngôn ngữ, đòi tra TRƯỚC khi đoán`, () => {
      const p = dungLoiNhacHeThong({ cheDo, ngonNgu: "vi" });
      const quyTac = p.split("\n").find((d) => d.includes("lookup_api") && /CS0246/.test(d));
      expect(quyTac, "một quy tắc riêng nói về lỗi biên dịch + lookup_api").toBeTruthy();
      for (const ma of ["CS0246", "CS0103", "CS1061", "CS0234", "TS2304", "TS2339", "TS2305", "cannot find symbol", "NameError", "AttributeError"]) {
        expect(quyTac).toContain(ma);
      }
      expect(quyTac).toMatch(/before (you )?(guess|chang|edit)/i);
    });
  }
});
