/**
 * ★★★ 2026-08-23 · UX LÔ 1 (D1) — LƯỚI CHO **PHÉP LỌC MỐC SEARCH/REPLACE Ở TẦNG HIỂN THỊ**.
 *
 * Sự việc live: `=======` trong văn xuôi model biến dòng đứng trên nó thành **H1** (setext heading),
 * `>>>>>>> REPLACE` thành **7 tầng blockquote**. `lamSachMocChoHienThi` phải trung hoà cú pháp ấy
 * TRƯỚC bộ render markdown — và KHÔNG được đụng một byte nào ngoài các dòng mốc.
 *
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC:
 *   • bỏ bọc khối trọn vẹn (mốc đi thẳng vào markdown)            ⇒ §1 ĐỎ
 *   • bọc luôn cả bên TRONG code fence có sẵn (phá fence model)   ⇒ §2 ĐỎ
 *   • bỏ trung hoà dòng `=======` mồ côi (H1 sống lại)            ⇒ §3 ĐỎ
 *   • hàm "lọc" mà ĐỔI văn bản thường (mất chữ của model)         ⇒ §4 ĐỎ (bất động điểm)
 *   • CRLF làm regex hình dạng trượt                              ⇒ §5 ĐỎ
 */
import { describe, it, expect } from "vitest";
import { MOC_DONG, MOC_MO, MOC_NGAN, RE_MO, RE_NGAN, RE_DONG, lamSachMocChoHienThi } from "./aiCodingMoc";

const KHOI = [MOC_MO, "return a / b;", MOC_NGAN, 'if (b == 0) throw new X("0");', "return a / b;", MOC_DONG].join("\n");

describe("§1 — khối trọn vẹn được BỌC vào fence ```text (mốc còn NGUYÊN VĂN bên trong)", () => {
  it("★★★ ba dòng mốc không còn đứng trần trước markdown, nhưng không mất một byte nội dung", () => {
    const ra = lamSachMocChoHienThi(`Tôi đề xuất sửa như sau:\n${KHOI}\nĐã đổi Divide để ném lỗi.`);
    const dong = ra.split("\n");
    const iMo = dong.indexOf(MOC_MO);
    expect(iMo, "mốc mở phải còn nguyên văn (người đọc vẫn thấy)").toBeGreaterThan(0);
    expect(dong[iMo - 1], "ngay TRÊN mốc mở phải là hàng rào fence").toBe("```text");
    const iDong = dong.indexOf(MOC_DONG);
    expect(dong[iDong + 1], "ngay DƯỚI mốc đóng phải đóng fence").toBe("```");
    // Nội dung của khối còn đủ.
    expect(ra).toContain('if (b == 0) throw new X("0");');
    expect(ra).toContain("Đã đổi Divide để ném lỗi.");
  });

  it("★★ hình dạng NỚI (8 dấu `<`, chữ thường) vẫn được nhận — luật hình-dạng, không danh sách trắng", () => {
    expect(RE_MO.test("<<<<<<<< search")).toBe(true);
    expect(RE_NGAN.test("====")).toBe(true);
    expect(RE_DONG.test(">>>> replace")).toBe(true);
    const ra = lamSachMocChoHienThi(["<<<<<<<< SEARCH", "a", "====", "b", ">>>> REPLACE"].join("\n"));
    expect(ra.split("\n")[0]).toBe("```text");
  });
});

describe("§2 — bên trong code fence CÓ SẴN: không đụng một dòng nào", () => {
  it("★★★ mốc nằm trong ``` của model ⇒ giữ nguyên (bọc thêm là phá fence)", () => {
    const vao = ["```", KHOI, "```"].join("\n");
    expect(lamSachMocChoHienThi(vao)).toBe(vao);
  });
});

describe("§3 — dòng mốc MỒ CÔI được trung hoà thành inline code", () => {
  it("★★★ `=======` mồ côi (thứ đẻ ra H1) thành `\\`=======\\``", () => {
    const ra = lamSachMocChoHienThi("Tiêu đề vô tình\n=======\nvăn xuôi tiếp");
    expect(ra).toContain("`=======`");
    expect(ra.split("\n")[1]).toBe("`=======`");
  });

  it("★★ `>>>>>>> REPLACE` không có mở ⇒ cũng trung hoà (7 tầng blockquote chết ở đây)", () => {
    const ra = lamSachMocChoHienThi(`văn xuôi\n${MOC_DONG}`);
    expect(ra).toContain(`\`${MOC_DONG}\``);
  });

  it("★★ mốc MỞ bị cắt giữa chừng (đang stream, không có mốc đóng) ⇒ trung hoà đúng MỘT dòng ấy", () => {
    const ra = lamSachMocChoHienThi(`${MOC_MO}\ndở dang chưa có REPLACE`);
    expect(ra.split("\n")[0]).toBe(`\`${MOC_MO}\``);
    expect(ra).toContain("dở dang chưa có REPLACE");
  });
});

describe("§4 — BẤT ĐỘNG ĐIỂM: văn bản không mốc đi qua NGUYÊN VẸN từng byte", () => {
  it("★★★ văn xuôi + mã + heading `#` + so sánh `a < b` ⇒ trả về đúng chuỗi vào", () => {
    for (const vao of [
      "Hàm Divide chia hai số.\n\n# Tóm tắt\n- if (a < b) return;\n- x >= y",
      "",
      "một dòng",
      "```csharp\nint x = 1;\n```",
    ]) {
      expect(lamSachMocChoHienThi(vao)).toBe(vao);
    }
  });
});

describe("§5 — CRLF: tệp/luồng Windows không làm phép nhận hình dạng trượt", () => {
  it("★★★ khối mốc với `\\r\\n` vẫn được bọc", () => {
    const vao = `chữ\r\n${MOC_MO}\r\na\r\n${MOC_NGAN}\r\nb\r\n${MOC_DONG}\r\nchữ cuối`;
    const ra = lamSachMocChoHienThi(vao);
    expect(ra).toContain("```text");
    expect(ra).toContain("chữ cuối");
  });
});
