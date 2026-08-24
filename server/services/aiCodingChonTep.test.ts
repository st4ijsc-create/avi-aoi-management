/**
 * ★★★ 2026-08-24 · VÒNG TỰ-TRỊ-GHI — BƯỚC 1 "MODEL CHỌN TỆP" (`chonDuongTuTri`), vị từ THUẦN.
 *
 * Sinh từ nghiệm thu LIVE 30B #1: regex-nhặt-tệp-đầu trỏ tệp TEST / đường tuyệt đối. Thay bằng
 * "model chọn — server nhận CHỈ đường TRONG CÂY" (chống model bịa đường, đo LIVE 2026-08-19).
 *
 * ĐỘT BIẾN PHẢI BẮT: bỏ kiểm IN-TREE (trả đường model gửi bất kể cây) ⇒ §2 (bịa) + §4 (fallback
 * ngoài cây) ĐỎ.
 */
import { describe, it, expect } from "vitest";
import { chonDuongTuTri } from "./aiCodingAgent";

/** Cây `list_files`: TỆP + THƯ MỤC (thư mục có `/` cuối — KHÔNG được chọn). */
const CAY = ["src/Calculator.cs", "src/Program.cs", "tests/CalculatorTests.cs", "CalculatorDemo.sln", "src/", "tests/"].join("\n");
const F = (d: string) => `### FILE: ${d}`;

describe("§1 — `### FILE:` TRONG CÂY ⇒ trả đường (chuẩn hoá nhẹ về đúng dạng của cây)", () => {
  it("★★★ đường thẳng ⇒ trả nguyên văn cây", () => {
    expect(chonDuongTuTri(F("src/Calculator.cs"), CAY)).toBe("src/Calculator.cs");
  });
  it("★★★ gọt nháy/backtick + chịu ./ , \\ , HOA/thường ⇒ vẫn khớp, trả dạng cây", () => {
    expect(chonDuongTuTri(F("`src/Program.cs`"), CAY)).toBe("src/Program.cs");
    expect(chonDuongTuTri(F("./src/Calculator.cs"), CAY)).toBe("src/Calculator.cs");
    expect(chonDuongTuTri(F("src\\Calculator.cs"), CAY)).toBe("src/Calculator.cs");
    expect(chonDuongTuTri(F("SRC/CALCULATOR.CS"), CAY)).toBe("src/Calculator.cs");
  });
  it("★★★ tệp TEST KHÔNG bị lọc ở đây (audit lo) ⇒ vẫn trả (cờ sua_tep_test tính sau)", () => {
    expect(chonDuongTuTri(F("tests/CalculatorTests.cs"), CAY)).toBe("tests/CalculatorTests.cs");
  });
});

describe("§2 — MODEL BỊA đường (không trong cây) ⇒ null (đột biến bỏ kiểm IN-TREE ⇒ LỌT)", () => {
  it("★★★ `### FILE: src/DoesNotExist.cs` ⇒ null", () => {
    expect(chonDuongTuTri(F("src/DoesNotExist.cs"), CAY)).toBe(null);
  });
  it("★★★ đường TUYỆT ĐỐI (live #1) ⇒ null (không trong cây tương đối)", () => {
    expect(chonDuongTuTri(F("C:/Users/dev/tests/CalculatorTests.cs"), CAY)).toBe(null);
  });
});

describe("§3 — KHÔNG chọn được THƯ MỤC (chỉ tệp)", () => {
  it("★★★ `### FILE: src` (thư mục) ⇒ null", () => {
    expect(chonDuongTuTri(F("src"), CAY)).toBe(null);
    expect(chonDuongTuTri(F("src/"), CAY)).toBe(null);
  });
});

describe("§4 — DỰ PHÒNG: đường trong cây xuất hiện như TOKEN TRỌN VẸN trong văn xuôi", () => {
  it("★★★ không có `### FILE:` nhưng nêu đường trong cây ⇒ trả đường ấy", () => {
    expect(chonDuongTuTri("Nguyên nhân nằm ở src/Program.cs — cần thêm kiểm tra.", CAY)).toBe("src/Program.cs");
  });
  it("★★★ nêu đường NGOÀI cây ⇒ null (đột biến bỏ kiểm IN-TREE ⇒ LỌT)", () => {
    expect(chonDuongTuTri("Sửa ở src/Unknown.cs nhé", CAY)).toBe(null);
  });
  it("★★★ KHÔNG khớp chuỗi CON (biên token): 'a.cs' trong cây KHÔNG khớp 'data.cs' trong phản hồi", () => {
    expect(chonDuongTuTri("xem data.cs", ["a.cs"].join("\n"))).toBe(null);
  });
});

describe("§5 — biên / rỗng", () => {
  it("★★ cây rỗng ⇒ null", () => {
    expect(chonDuongTuTri(F("src/Calculator.cs"), "")).toBe(null);
  });
  it("★★ không có đường nào ⇒ null", () => {
    expect(chonDuongTuTri("tôi không chắc tệp nào", CAY)).toBe(null);
    expect(chonDuongTuTri("", CAY)).toBe(null);
  });
});
