import { describe, it, expect } from "vitest";
import { thuMucTuLoi } from "./thuMucTuLoi";

describe("thuMucTuLoi — G6 (audit 2026-09-21)", () => {
  it("★★★ ca THẬT đã đo: đầu ra `node --test` chỉ ra thư mục chứa tệp nguồn", () => {
    const loi = `
✖ ty le NG - tong = 0 phai tra 0
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      at TestContext.<anonymous> (sandbox-projects/agentic-demo/test/kho.test.mjs:18:10)
      at async Test.run (node:internal/test_runner/test:1073:7)`;
    const r = thuMucTuLoi(loi);
    // Thư mục của tệp test PHẢI có, và thư mục CHA (bao được cả src/) cũng phải có.
    expect(r).toContain("sandbox-projects/agentic-demo/test");
    expect(r).toContain("sandbox-projects/agentic-demo");
  });

  it("★★★ CHA phải có mặt — tệp NGUỒN có bug nằm ở src/ chứ không ở test/", () => {
    const r = thuMucTuLoi("at (a/b/test/x.test.mjs:1:1)");
    expect(r).toContain("a/b/test");
    expect(r).toContain("a/b");
  });

  it("★ đường TUYỆT ĐỐI Windows bị LOẠI (hộp cát đằng nào cũng từ chối — đây là lỗ cũ của trichTepTuLoi)", () => {
    expect(thuMucTuLoi(String.raw`in C:\Users\x\tests\CalculatorTests.cs:line 35`)).toEqual([]);
    expect(thuMucTuLoi(String.raw`at D:\SOURCES\repo\src\a.ts:3`)).toEqual([]);
  });

  it("★ đường POSIX tuyệt đối và leo cấp bị LOẠI", () => {
    expect(thuMucTuLoi("at /etc/passwd:1")).toEqual([]);
    expect(thuMucTuLoi("at ../../bi-mat/a.ts:1")).toEqual([]);
  });

  it("★ KHÔNG trả về tên TỆP — chỉ thư mục (đây là ranh giới với trichTepTuLoi đã bị gỡ)", () => {
    for (const d of thuMucTuLoi("at src/kho.mjs:9 and test/kho.test.mjs:3")) {
      expect(d.endsWith(".mjs")).toBe(false);
      expect(d.endsWith(".ts")).toBe(false);
    }
  });

  it("★ xuất hiện NHIỀU LẦN thì xếp trước", () => {
    const r = thuMucTuLoi("a/b/x.ts:1\na/b/y.ts:2\na/b/z.ts:3\nc/d/w.ts:1");
    expect(r[0]).toBe("a/b");
  });

  it("★ không suy được gì ⇒ [] (người gọi PHẢI lùi về hành vi cũ)", () => {
    expect(thuMucTuLoi("")).toEqual([]);
    expect(thuMucTuLoi(null)).toEqual([]);
    expect(thuMucTuLoi(undefined)).toEqual([]);
    expect(thuMucTuLoi("mọi test đều xanh")).toEqual([]);
  });

  it("★ trần 4 thư mục — cây phải NHỎ mới giúp model chọn đúng", () => {
    const loi = Array.from({ length: 30 }, (_, i) => `at d${i}/s${i}/f.ts:1`).join("\n");
    expect(thuMucTuLoi(loi).length).toBeLessThanOrEqual(4);
  });

  it("★ dấu \\ của Windows (đường TƯƠNG ĐỐI) vẫn nhận, chuẩn hoá về /", () => {
    const r = thuMucTuLoi(String.raw`at sandbox-projects\agentic-demo\test\kho.test.mjs:18:10`);
    expect(r).toContain("sandbox-projects/agentic-demo/test");
  });

  it("★ không ném với đầu vào rác", () => {
    for (const x of ["((((", "\u0000", "a".repeat(5000), "🙂/🙂.ts:1"]) {
      expect(() => thuMucTuLoi(x)).not.toThrow();
    }
  });
});
