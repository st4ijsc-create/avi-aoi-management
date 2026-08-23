/**
 * ★★★ 2026-08-23 · UX LÔ 1 (C4) — LƯỚI CHO **NHẬN XÉT "CHỈ THẤY ĐỊNH NGHĨA"** của `grep_repo`.
 *
 * Sự việc live: *"Grep 1 kết quả là định nghĩa mà không ai nói cho tôi 'không nơi nào gọi'"* —
 * người hỏi "X gọi ở đâu" nhận một dòng `export function X(...)` và phải TỰ suy ra rằng cả phạm vi
 * quét không có một điểm gọi nào.
 *
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC:
 *   • nói cả khi phép quét là BẢN CẮT (`catBot=true`)              ⇒ §2 ĐỎ (khẳng định toàn thể từ
 *     một phép đo bộ phận — đúng lớp lỗi GREP_DEADLINE tồn tại để chống)
 *   • nói khi CÓ một dòng là điểm GỌI (`const kq = X(...)`)        ⇒ §2 ĐỎ
 *   • nói cho một mẫu KHÔNG phải định danh trần (`log.*Error`)     ⇒ §2 ĐỎ
 *   • `$` trong định danh làm regex nổ / khớp bừa                  ⇒ §3 ĐỎ
 */
import { describe, it, expect } from "vitest";
import { nhanXetChiThayDinhNghia } from "./repoReadTools";

const KHOP = (text: string, path = "server/a.ts", line = 1) => ({ path, line, text });

describe("§1 — CHẮC thì nói: mọi dòng khớp đều là dòng khai báo, quét trọn vẹn", () => {
  it("★★★ một kết quả duy nhất là `export function X(` ⇒ có câu 'chưa thấy nơi nào GỌI'", () => {
    const c = nhanXetChiThayDinhNghia("phanGiaiGoc", [KHOP("export function phanGiaiGoc(projectId: unknown) {")], false);
    expect(c).not.toBeNull();
    expect(c).toContain("KHAI BÁO");
    expect(c).toContain("CHƯA thấy nơi nào GỌI");
    expect(c).toContain("phanGiaiGoc");
  });

  it("★★ nhiều dòng nhưng TOÀN khai báo (const + interface qua hai tệp) ⇒ vẫn nói, kèm tên tệp", () => {
    const c = nhanXetChiThayDinhNghia(
      "MocXanh",
      [KHOP("export const MocXanh = 5;", "shared/x.ts"), KHOP("interface MocXanh {", "server/y.ts", 9)],
      false,
    );
    expect(c).not.toBeNull();
    expect(c).toContain("shared/x.ts");
    expect(c).toContain("server/y.ts");
  });
});

describe("§2 — KHÔNG CHẮC thì im lặng (`null`) — nói sai 'chưa ai gọi' đắt hơn không nói", () => {
  it("★★★ BẢN CẮT (`catBot=true`) ⇒ null, kể cả khi mọi dòng đều là khai báo", () => {
    expect(nhanXetChiThayDinhNghia("x", [KHOP("const x = 1;")], true)).toBeNull();
  });

  it("★★★ có MỘT dòng là điểm GỌI ⇒ null (dòng `const kq = X(...)` là usage, không phải khai báo)", () => {
    expect(
      nhanXetChiThayDinhNghia("executeDecision", [
        KHOP("export function executeDecision(decision) {"),
        KHOP("const outcome = await executeDecision(decision, execCtx);", "server/b.ts", 40),
      ], false),
    ).toBeNull();
  });

  it("★★ mẫu là REGEX thật (không phải định danh trần) ⇒ null — 'dòng khai báo của nó' không tồn tại", () => {
    expect(nhanXetChiThayDinhNghia("log.*Error", [KHOP("function logXError() {}")], false)).toBeNull();
    expect(nhanXetChiThayDinhNghia("a b", [KHOP("const ab = 1")], false)).toBeNull();
  });

  it("★★ 0 kết quả ⇒ null (tool đã có câu NO_MATCH riêng, đừng chồng câu)", () => {
    expect(nhanXetChiThayDinhNghia("x", [], false)).toBeNull();
  });
});

describe("§3 — định danh chứa `$` không làm khuôn regex nổ hay khớp bừa", () => {
  it("★ `x$y` được thoát trước khi ghép khuôn", () => {
    expect(() => nhanXetChiThayDinhNghia("x$y", [KHOP("const x$y = 1;")], false)).not.toThrow();
    expect(nhanXetChiThayDinhNghia("x$y", [KHOP("const x$y = 1;")], false)).not.toBeNull();
  });
});
