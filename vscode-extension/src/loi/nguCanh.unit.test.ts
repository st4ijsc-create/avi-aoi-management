/**
 * LƯỚI ngữ cảnh. Ba bất biến: (1) KHÔNG bao giờ gửi tệp bí mật (.env, khoá riêng); (2) chuỗi
 * giống khoá bị CHE trước khi rời máy dev; (3) ngân sách là TRẦN THẬT — vượt thì CẮT và NÓI rõ
 * đã cắt, chứ không im lặng gửi quá.
 */
import { describe, it, expect } from "vitest";
import { cheBiMat, duocPhepGuiNoiDung, dungNguCanh } from "./nguCanh";

describe("duocPhepGuiNoiDung", () => {
  it("★★★ CẤM mọi biến thể .env", () => {
    expect(duocPhepGuiNoiDung(".env")).toBe(false);
    expect(duocPhepGuiNoiDung("d:/du-an/.env.local")).toBe(false);
    expect(duocPhepGuiNoiDung("sub/.env.production")).toBe(false);
  });

  it("★★★ CẤM khoá riêng", () => {
    expect(duocPhepGuiNoiDung("keys/id_rsa")).toBe(false);
    expect(duocPhepGuiNoiDung("a/b/server.pem")).toBe(false);
  });

  it("★★ mã nguồn bình thường thì CHO", () => {
    expect(duocPhepGuiNoiDung("src/Calculator.cs")).toBe(true);
    expect(duocPhepGuiNoiDung("client/src/env.ts")).toBe(true);
  });
});

describe("cheBiMat", () => {
  it("★★★ che khoá OpenAI-style và AWS", () => {
    expect(cheBiMat("k = sk-abcdefghijklmnopqrstuvwx")).not.toContain("abcdefghijklmnop");
    expect(cheBiMat("id AKIAIOSFODNN7EXAMPLE")).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("★★★ che JWT ba đoạn", () => {
    const s = "tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyM30.abcdEFGH_ij";
    expect(cheBiMat(s)).not.toContain("eyJzdWIiOjEyM30");
  });

  it("★★★ che gán mật khẩu/khoá", () => {
    expect(cheBiMat('password="Sieu@Bimat123"')).not.toContain("Sieu@Bimat123");
    expect(cheBiMat("api_key = zzz9999zzz")).not.toContain("zzz9999zzz");
  });

  it("★★ mã thường KHÔNG bị đụng", () => {
    const ma = "public int Add(int a, int b) => a + b;";
    expect(cheBiMat(ma)).toBe(ma);
  });
});

describe("dungNguCanh", () => {
  it("★★★ đoạn chọn đứng TRƯỚC tệp đang mở (ưu tiên thứ tự)", () => {
    const s = dungNguCanh({
      doanChon: { duong: "a.cs", dongDau: 3, dongCuoi: 4, noiDung: "CHON_DAY" },
      tepDangMo: { duong: "a.cs", noiDung: "TOAN_TEP" },
      nganSach: 10_000,
    });
    expect(s.indexOf("CHON_DAY")).toBeLessThan(s.indexOf("TOAN_TEP"));
    expect(s).toContain("a.cs");
    expect(s).toContain("3");
  });

  it("★★★ vượt ngân sách ⇒ CẮT và KHAI đã cắt", () => {
    const s = dungNguCanh({
      tepDangMo: { duong: "to.cs", noiDung: "x".repeat(5000) },
      nganSach: 500,
    });
    expect(s.length).toBeLessThanOrEqual(700); // 500 + nhãn/khung
    expect(s).toContain("đã cắt");
  });

  it("★★★ nội dung gửi đi ĐÃ qua che bí mật", () => {
    const s = dungNguCanh({
      tepDangMo: { duong: "a.ts", noiDung: 'const k = "sk-abcdefghijklmnopqrstuvwx";' },
      nganSach: 10_000,
    });
    expect(s).not.toContain("abcdefghijklmnop");
  });

  it("★★ không có gì ⇒ chuỗi rỗng (không đẻ khung trống)", () => {
    expect(dungNguCanh({ nganSach: 1000 })).toBe("");
  });
});
