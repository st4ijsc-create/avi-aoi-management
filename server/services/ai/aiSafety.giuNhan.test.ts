import { describe, it, expect } from "vitest";
import { redactSecretsOnly } from "./aiSafety";

/**
 * ★★★ G12 (audit 2026-09-22 · dự án thật D3) — **CHE MÀ GIỮ CÚ PHÁP.**
 *
 * Ca thật: một đơn đặt website; model sinh một file Express có `password: 'your_password'`;
 * bộ che nuốt cả nhãn ⇒ `[REDACTED_SECRET],` ⇒ `node --check` đỏ: *Unexpected token '['*.
 * Hàng rào an toàn tự tay phá hỏng hiện vật nó đang bảo vệ.
 *
 * Trục đo của bộ lưới này có HAI vế, và vế thứ hai mới là vế giữ cho bản vá trung thực:
 *   1. mã sau khi che PHẢI còn parse được;
 *   2. giá trị bí mật PHẢI biến mất SẠCH — không sót một ký tự nào.
 */
const conNguyen = (s: string, bi: string) => s.includes(bi);

describe("redactSecretsOnly — G12 giữ nhãn", () => {
  it("★★★ CA THẬT ĐÃ ĐO: đoạn `new Pool({...})` sau khi che vẫn là JS hợp lệ", () => {
    const ma = [
      "const pool = new Pool({",
      "  user: 'your_user',",
      "  host: 'localhost',",
      "  password: 'sieu_bi_mat_that',",
      "  port: 5432,",
      "});",
    ].join("\n");
    const { text } = redactSecretsOnly(ma);
    expect(text).toContain("password: '[REDACTED_SECRET]'");
    expect(conNguyen(text, "sieu_bi_mat_that")).toBe(false); // ★ vế 2 — bí mật SẠCH
    // `new Function` chỉ PHÂN TÍCH CÚ PHÁP, không chạy ⇒ `Pool` chưa định nghĩa vẫn hợp lệ.
    expect(() => new Function(text)).not.toThrow();
  });

  it("★★★ ĐỐI CHỨNG: bí mật biến mất với MỌI dạng nhãn, không sót ký tự", () => {
    const cap: ReadonlyArray<readonly [string, string]> = [
      ["password=matkhau_that_123", "matkhau_that_123"],
      ["pwd: 'matkhau_that_123'", "matkhau_that_123"],
      ['passwd:"matkhau_that_123"', "matkhau_that_123"],
      ["api_key: 'kx7Lm2Qp9Rs4Tv6W'", "kx7Lm2Qp9Rs4Tv6W"],
      ["client_secret=kx7Lm2Qp9Rs4Tv6W", "kx7Lm2Qp9Rs4Tv6W"],
      ["access-token: kx7Lm2Qp9Rs4Tv6W", "kx7Lm2Qp9Rs4Tv6W"],
    ];
    for (const [vao, bi] of cap) {
      const { text } = redactSecretsOnly(vao);
      expect(conNguyen(text, bi), vao).toBe(false);
      expect(text, vao).toContain("[REDACTED_SECRET]");
    }
  });

  it("★ nhãn được GIỮ ⇒ người đọc log biết trường nào đã bị che", () => {
    expect(redactSecretsOnly("password=matkhau_that").text).toBe("password=[REDACTED_SECRET]");
    expect(redactSecretsOnly("api_key: kx7Lm2Qp9Rs4Tv6W").text).toBe("api_key: [REDACTED_SECRET]");
  });

  it("★ dấu nháy CÂN ĐỐI hai bên (đây chính là thứ làm mã parse được)", () => {
    expect(redactSecretsOnly(`password: "matkhau_that"`).text).toBe(`password: "[REDACTED_SECRET]"`);
    expect(redactSecretsOnly(`password: 'matkhau_that'`).text).toBe(`password: '[REDACTED_SECRET]'`);
  });

  it("★ HÀNH VI CŨ GIỮ NGUYÊN cho luật KHÔNG có nhãn (jwt / bearer / khoá riêng)", () => {
    expect(redactSecretsOnly("Bearer abcdefghijklmnop").text).toBe("[REDACTED_SECRET]");
    expect(redactSecretsOnly("sk-0123456789abcdefgh").text).toBe("[REDACTED_SECRET]");
  });

  it("★ 'Pass/Fail' của nhà máy KHÔNG bị che (ranh giới cũ không đổi)", () => {
    expect(redactSecretsOnly("Pass: PASSED").text).toBe("Pass: PASSED");
  });
});
