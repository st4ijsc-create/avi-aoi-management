/**
 * HA-4 (lệnh) — `goiYLenhTuChoi(lenh)`: câu GỢI Ý nối vào lời từ chối lệnh của chế độ tu-dong, nêu DẠNG ĐƯỢC PHÉP gần nhất.
 * THUẦN: không đọc đĩa, không env, không CSDL. Bảng ca lấy từ 18 lời gọi bị từ chối của lượt đo 14/11 (agent-f py-doi-soat / js-loi-3-lop).
 * ĐỘT BIẾN PHẢI BẮT: gợi ý sai dạng · gợi ý cho lệnh khớp dạng đúng · chép nguyên văn lệnh của model vào gợi ý · gợi ý cách lách (đọc tệp bị DENIED bằng lệnh khác).
 */
import { describe, expect, it } from "vitest";
import { goiYLenhTuChoi } from "./goiYLenhTuChoi";

describe("goiYLenhTuChoi — dạng pytest / unittest", () => {
  it("★★★ pytest kèm cờ (-v, -s, -q, -x) ⇒ nêu ĐÚNG dạng `python -m pytest <path>` không cờ", () => {
    for (const lenh of ["python -m pytest py-doi-soat/tests/test_doi_soat.py -v", "python -m pytest tests/x.py -v -s", "python -m pytest tests -q", "python -m pytest tests -x"]) {
      const g = goiYLenhTuChoi(lenh);
      expect(g, lenh).toContain("python -m pytest <path>");
      expect(g, lenh).toMatch(/no flags|without flags/i);
    }
  });
  it("★★★ unittest kèm cờ ⇒ nêu dạng `python -m unittest <path>`; hai đường dẫn ⇒ nêu MỘT đường dẫn", () => {
    expect(goiYLenhTuChoi("python -m unittest tests/test_x.py -v")).toContain("python -m unittest <path>");
    expect(goiYLenhTuChoi("python -m pytest tests/a.py tests/b.py")).toMatch(/exactly one path/i);
  });
  it("★★★ trình thông dịch đặt tên khác (python3, py) ⇒ nêu phải đúng `python`", () => {
    expect(goiYLenhTuChoi("python3 -m pytest tests")).toMatch(/named exactly `python`/);
    expect(goiYLenhTuChoi("py -m pytest tests")).toMatch(/named exactly `python`/);
  });
  it("★★★ dạng ĐÚNG (đã được chạy) KHÔNG sinh gợi ý pytest — chuỗi rỗng", () => {
    expect(goiYLenhTuChoi("python -m pytest py-doi-soat/tests")).toBe("");
    expect(goiYLenhTuChoi("python -m unittest tests/test_x.py")).toBe("");
  });
});

describe("goiYLenhTuChoi — glob và lệnh node", () => {
  it("★★★ `node --test` với ký tự đại diện ⇒ nêu truyền THƯ MỤC, không glob", () => {
    const g = goiYLenhTuChoi("node --test js-loi-3-lop/test/*.test.mjs");
    expect(g).toContain("node --test <directory>");
    expect(g).toMatch(/wildcard|glob/i);
  });
  it("★★ `?` hay `*` ở lệnh khác ⇒ gợi ý chung về ký tự đại diện", () => {
    expect(goiYLenhTuChoi("npx vitest run tests/*.test.ts")).toMatch(/wildcard|glob/i);
  });
  it("★★★ `node --test <thư mục>` (dạng đúng) ⇒ rỗng", () => {
    expect(goiYLenhTuChoi("node --test js-loi-3-lop/test")).toBe("");
  });
});

describe("goiYLenhTuChoi — lệnh ĐỌC tệp / chạy mã tuỳ ý", () => {
  it("★★★ cat / head / tail / type ⇒ nêu `read_file <path>`; và nêu rằng tệp bị từ chối là CHỦ Ý, không lách bằng script", () => {
    for (const lenh of ["cat py-doi-soat/du_lieu/so_sach.csv", "head -n 5 data.csv", "tail data.csv", "type data.csv"]) {
      const g = goiYLenhTuChoi(lenh);
      expect(g, lenh).toContain("read_file");
      expect(g, lenh).toMatch(/not readable by design/i);
      expect(g, lenh).toMatch(/do not (write|work around)/i);
    }
  });
  it("★★★ `python -c …` và `python <tệp>.py` ⇒ nêu không chạy mã tuỳ ý; kiểm bằng `python -m pytest <path>`", () => {
    for (const lenh of ["python -c print(1)", "python py-doi-soat/_read_csv.py a.csv b.csv", "python -"]) {
      const g = goiYLenhTuChoi(lenh);
      expect(g, lenh).toMatch(/arbitrary (code|script)/i);
      expect(g, lenh).toContain("python -m pytest <path>");
    }
  });
  it("★★★ mkdir ⇒ nêu không phải lệnh kiểm chứng, tạo tệp bằng write_file", () => {
    const g = goiYLenhTuChoi("mkdir -p py-doi-soat/scripts");
    expect(g).toMatch(/not a verification command/i);
    expect(g).toContain("write_file");
  });
});

describe("goiYLenhTuChoi — an toàn và biên", () => {
  it("★★★ gợi ý KHÔNG chép nguyên văn lệnh của model (không dẫn lại chuỗi bất kỳ vào lời nhắc)", () => {
    const lenh = "cat ../../ngoai/BI_MAT_DUOI_DAY_123.csv";
    const g = goiYLenhTuChoi(lenh);
    expect(g).not.toContain("BI_MAT_DUOI_DAY_123");
    expect(g).not.toContain("ngoai");
    expect(goiYLenhTuChoi("python -m pytest BI_MAT_456/x.py -v")).not.toContain("BI_MAT_456");
  });
  it("★★★ lệnh không thuộc bảng (git status, npm test, rỗng, không phải chuỗi, có xuống dòng) ⇒ rỗng, KHÔNG ném", () => {
    for (const lenh of ["git status", "npm test", "", "   ", undefined, null, 42, { a: 1 }, "python\n-m\npytest x -v"]) {
      expect(() => goiYLenhTuChoi(lenh as unknown)).not.toThrow();
    }
    for (const lenh of ["git status", "npm test", "", "   ", undefined, null, 42]) expect(goiYLenhTuChoi(lenh as unknown), String(lenh)).toBe("");
  });
  it("★★ chữ HOA và nhiều dấu cách vẫn nhận ra dạng (Windows)", () => {
    expect(goiYLenhTuChoi("  PYTHON   -m   pytest   tests/x.py   -V ")).toContain("python -m pytest <path>");
    expect(goiYLenhTuChoi("CAT a.csv")).toContain("read_file");
  });
  it("★★ lệnh rất dài không làm chậm và không ném; chỉ 64 token đầu được xét (ký tự đại diện ở token thứ 70 KHÔNG tạo gợi ý)", () => {
    const dai = "python -m pytest " + "a/".repeat(50_000) + " -v";
    const t0 = Date.now();
    expect(goiYLenhTuChoi(dai)).toContain("python -m pytest <path>");
    expect(Date.now() - t0).toBeLessThan(200);
    expect(goiYLenhTuChoi(`git status ${"a ".repeat(70)}*.ts`)).toBe("");
    expect(goiYLenhTuChoi(`git status ${"a ".repeat(10)}*.ts`)).toContain("Wildcards");
  });
});
