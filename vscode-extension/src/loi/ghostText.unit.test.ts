/**
 * ★★★ ĐỢT 4C — lưới LOGIC THUẦN của ghost-text (inline completion): cắt ngữ cảnh quanh con trỏ có trần, bỏ qua tệp
 * cấm, che bí mật trước khi rời máy, cắt gợi ý tại ranh giới hợp lý (không lặp hậu tố, không mang dấu che vào tệp).
 */
import { describe, it, expect } from "vitest";
import {
  TRAN_HAU_TO,
  TRAN_TIEN_TO,
  catGoiY,
  catNguCanh,
  dungThanYeuCauFim,
  laCheDoMotDong,
  lyDoBoQua,
} from "./ghostText";
import { CHE } from "./nguCanh";

describe("catNguCanh — tiền tố/hậu tố quanh con trỏ có TRẦN", () => {
  it("★★★ tệp nhỏ ⇒ lấy nguyên hai phía", () => {
    const s = "const a = 1;\nconst b = 2;\n";
    const kq = catNguCanh(s, 6);
    expect(kq).toEqual({ tienTo: "const ", hauTo: "a = 1;\nconst b = 2;\n" });
  });

  it("★★★ trần là TRẦN THẬT: tiền tố ≤ TRAN_TIEN_TO, hậu tố ≤ TRAN_HAU_TO", () => {
    const dong = "x".repeat(39) + "\n";
    const s = dong.repeat(500);
    const kq = catNguCanh(s, 10_000);
    expect(kq.tienTo.length).toBeLessThanOrEqual(TRAN_TIEN_TO);
    expect(kq.hauTo.length).toBeLessThanOrEqual(TRAN_HAU_TO);
    expect(kq.tienTo.length).toBeGreaterThan(TRAN_TIEN_TO - 41);
    expect(s.slice(0, 10_000).endsWith(kq.tienTo)).toBe(true);
    expect(s.slice(10_000).startsWith(kq.hauTo)).toBe(true);
  });

  it("★★ bị cắt ⇒ tiền tố bắt đầu ĐẦU DÒNG, hậu tố kết thúc CUỐI DÒNG (không nửa dòng)", () => {
    const s = Array.from({ length: 300 }, (_, i) => `dong_${i} = ${i};`).join("\n");
    const giua = s.indexOf("dong_150");
    const kq = catNguCanh(s, giua);
    expect(kq.tienTo.startsWith("dong_")).toBe(true);
    expect(kq.hauTo.endsWith("\n")).toBe(true);
    expect(s.slice(giua).startsWith(kq.hauTo)).toBe(true);
  });

  it("★ trần tuỳ chỉnh được", () => {
    const kq = catNguCanh("abcdef\nghij\nklmn", 9, { tienTo: 4, hauTo: 3 });
    expect(kq.tienTo.length).toBeLessThanOrEqual(4);
    expect(kq.hauTo.length).toBeLessThanOrEqual(3);
  });
});

describe("lyDoBoQua — tệp cấm KHÔNG gửi byte nào", () => {
  const coBan = { duong: "D:\\ws\\src\\a.ts", scheme: "file", trongWorkspace: true, soKyTu: 1000 };
  it("★★★ tệp thường trong workspace ⇒ cho qua", () => {
    expect(lyDoBoQua(coBan)).toBeUndefined();
  });
  it("★★★ .env / khoá riêng / .git ⇒ bỏ qua", () => {
    expect(lyDoBoQua({ ...coBan, duong: "D:\\ws\\.env" })).toMatch(/nhạy cảm/);
    expect(lyDoBoQua({ ...coBan, duong: "D:\\ws\\.env.local" })).toMatch(/nhạy cảm/);
    expect(lyDoBoQua({ ...coBan, duong: "D:\\ws\\certs\\tls.key" })).toMatch(/nhạy cảm/);
    expect(lyDoBoQua({ ...coBan, duong: "D:\\ws\\.git\\config" })).toMatch(/nhạy cảm/);
  });
  it("★★★ ngoài workspace ⇒ bỏ qua", () => {
    expect(lyDoBoQua({ ...coBan, trongWorkspace: false })).toMatch(/ngoài workspace/);
  });
  it("★★★ tệp quá lớn ⇒ bỏ qua", () => {
    expect(lyDoBoQua({ ...coBan, soKyTu: 5_000_000 })).toMatch(/quá lớn/);
  });
  it("★★ không phải tệp trên đĩa (untitled, git:, output) ⇒ bỏ qua", () => {
    expect(lyDoBoQua({ ...coBan, scheme: "untitled" })).toBeDefined();
    expect(lyDoBoQua({ ...coBan, scheme: "git" })).toBeDefined();
  });
});

describe("dungThanYeuCauFim — che bí mật TRƯỚC khi rời máy", () => {
  it("★★★ khoá trong tiền tố và hậu tố đều bị che", () => {
    const than = dungThanYeuCauFim({
      tienTo: 'const k = "sk-abcdefghijklmnopqrstuvwxyz";\nconst x = ',
      hauTo: '\nconst url = "postgres://u:MatKhauThat@h/db";',
      motDong: true,
    });
    expect(than.prompt).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(than.suffix).not.toContain("MatKhauThat");
    expect(than.prompt).toContain(CHE);
    expect(than.suffix).toContain(CHE);
  });
  it("★★★ luôn xin model logic `fim` (hậu tố rỗng ở cuối tệp KHÔNG được rơi sang model `code` lớn)", () => {
    expect(dungThanYeuCauFim({ tienTo: "a", hauTo: "", motDong: false }).model).toBe("fim");
  });
  it("★★ một dòng ⇒ trần token nhỏ hơn nhiều dòng; không stream; nhiệt độ 0 (đo bằng tham lam)", () => {
    const a = dungThanYeuCauFim({ tienTo: "a", hauTo: "b", motDong: true });
    const b = dungThanYeuCauFim({ tienTo: "a", hauTo: "\n", motDong: false });
    expect(a.max_tokens).toBeLessThan(b.max_tokens);
    expect(a.stream).toBe(false);
    expect(a.temperature).toBe(0);
  });
});

describe("laCheDoMotDong", () => {
  it("★★ còn chữ sau con trỏ trên CÙNG dòng ⇒ một dòng", () => {
    expect(laCheDoMotDong("  ", "x);\nnext")).toBe(true);
  });
  it("★★★ đã gõ dở trên dòng (con trỏ cuối dòng) ⇒ một dòng — chỉ dòng TRỐNG mới được gợi ý cả khối", () => {
    expect(laCheDoMotDong("  const a = ", "\nnext")).toBe(true);
  });
  it("★★ dòng trống (chỉ thụt lề) + con trỏ cuối dòng ⇒ nhiều dòng được", () => {
    expect(laCheDoMotDong("{\n  ", "\nnext")).toBe(false);
    expect(laCheDoMotDong("", "   \nnext")).toBe(false);
    expect(laCheDoMotDong("x\n", "")).toBe(false);
  });
});

describe("catGoiY — cắt tại ranh giới hợp lý", () => {
  it("★★★ chế độ một dòng ⇒ chỉ dòng đầu", () => {
    expect(catGoiY("foo(a);\nbar();", { tienTo: "  x = ", hauTo: "y\n", motDong: true })).toBe("foo(a);");
  });

  it("★★★ một dòng: KHÔNG lặp phần ĐÓNG đã có sau con trỏ", () => {
    // con trỏ: foo(|)  — model viết "a, b)" ⇒ chèn ra "foo(a, b))" nếu không cắt
    expect(catGoiY("a, b)", { tienTo: "foo(", hauTo: ")\n", motDong: true })).toBe("a, b");
    expect(catGoiY('ten");', { tienTo: 'log("', hauTo: '");\n', motDong: true })).toBe("ten");
  });

  it("★★★ nhiều dòng: dừng khi model bắt đầu CHÉP LẠI hậu tố", () => {
    const tienTo = "function f() {\n  ";
    const hauTo = "\n  return x;\n}\n";
    expect(catGoiY("const x = 1;\n  return x;\n}", { tienTo, hauTo, motDong: false })).toBe("const x = 1;");
  });

  it("★★★ nhiều dòng: dừng khi thụt lề LÙI quá dòng con trỏ (hết khối)", () => {
    const tienTo = "if (a) {\n    ";
    const kq = catGoiY("b();\n    c();\n}\nelse {", { tienTo, hauTo: "\n", motDong: false });
    expect(kq).toBe("b();\n    c();");
  });

  it("★★ nhiều dòng: dừng ở dòng trống đầu tiên + trần số dòng", () => {
    expect(catGoiY("a();\nb();\n\nc();", { tienTo: "", hauTo: "\n", motDong: false })).toBe("a();\nb();");
    const dai = Array.from({ length: 30 }, (_, i) => `l${i}();`).join("\n");
    expect(catGoiY(dai, { tienTo: "", hauTo: "\n", motDong: false, tranDong: 4 }).split("\n")).toHaveLength(4);
  });

  it("★★★ gợi ý mang DẤU CHE (model nhìn bản đã che) ⇒ bỏ hẳn, không chèn rác vào tệp", () => {
    expect(catGoiY(`"${CHE}";`, { tienTo: "const k = ", hauTo: "\n", motDong: true })).toBe("");
    expect(catGoiY('"[REDACTED_SECRET]";', { tienTo: "const k = ", hauTo: "\n", motDong: true })).toBe("");
  });

  it("★★ sentinel FIM rò ra ⇒ cắt", () => {
    expect(catGoiY("x = 1<|endoftext|>rac", { tienTo: "", hauTo: "\n", motDong: false })).toBe("x = 1");
    expect(catGoiY("x = 1<|fim_middle|>", { tienTo: "", hauTo: "\n", motDong: false })).toBe("x = 1");
  });

  it("★★ CRLF ⇒ chuẩn hoá \\n; khoảng trắng cuối bị gọt; rỗng ⇒ rỗng", () => {
    expect(catGoiY("a();\r\n    b();  ", { tienTo: "    ", hauTo: "\r\n", motDong: false })).toBe("a();\n    b();");
    expect(catGoiY("   ", { tienTo: "", hauTo: "\n", motDong: false })).toBe("");
    expect(catGoiY("", { tienTo: "", hauTo: "\n", motDong: false })).toBe("");
  });

  it("★★ gợi ý chỉ CHÉP đúng đầu hậu tố ⇒ rỗng (không gợi ý thứ đã có)", () => {
    expect(catGoiY("return x;", { tienTo: "  ", hauTo: "return x;\n}", motDong: true })).toBe("");
  });

  it("★ ĐỐI CHỨNG — gợi ý hợp lệ đi qua nguyên vẹn", () => {
    expect(catGoiY("return a + b;", { tienTo: "  ", hauTo: "\n}\n", motDong: false })).toBe("return a + b;");
  });
});
