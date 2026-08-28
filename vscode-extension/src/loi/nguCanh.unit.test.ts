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

  it("★★★ kiểu JSON: \"password\": \"…\" PHẢI bị che (appsettings.json của .NET)", () => {
    const r = cheBiMat('{ "password": "SuperSecret123" }');
    expect(r).not.toContain("SuperSecret123");
  });

  it("★★★ credential NHÚNG trong chuỗi kết nối bị che (đo thật trên .env.example)", () => {
    const r = cheBiMat("DATABASE_URL=postgresql://user:sieu-mat-khau@localhost:5432/avi_aoi");
    expect(r).not.toContain("sieu-mat-khau");
    expect(r).toContain("postgresql://user:"); // vẫn đọc được cấu trúc, chỉ mất mật khẩu
    expect(r).toContain("@localhost:5432");
  });

  it("★★★ giá trị NHIỀU TỪ không nháy bị che tới hết dòng", () => {
    const r = cheBiMat("password = correct horse battery staple");
    expect(r).not.toContain("horse");
    expect(r).not.toContain("staple");
  });

  it("★★ khoá Stripe dùng GẠCH DƯỚI (sk_live_…) cũng bị che", () => {
    expect(cheBiMat('const k = "sk_live_51H2xJ2KxABCDEFGHIJKLMNOP";')).not.toContain("51H2xJ2Kx");
  });

  it("★★ che tới hết dòng KHÔNG tràn sang dòng sau", () => {
    const r = cheBiMat("password = bi-mat\nconst x = 1;");
    expect(r).toContain("const x = 1;");
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

  it("★★★ danh sách tệp bị LỌC: tên .env không lọt vào ngữ cảnh", () => {
    const s = dungNguCanh({ dsTep: ["src/a.cs", ".env", "src/b.cs"], nganSach: 10_000 });
    expect(s).toContain("src/a.cs");
    expect(s).not.toContain(".env");
  });

  it("★★★ hết ngân sách ⇒ khối sau bị bỏ nhưng PHẢI KHAI BÁO (không bỏ im lặng)", () => {
    const s = dungNguCanh({
      doanChon: { duong: "a.cs", dongDau: 1, dongCuoi: 2, noiDung: "x".repeat(3000) },
      tepDangMo: { duong: "a.cs", noiDung: "KHONG_DUOC_XUAT_HIEN" },
      nganSach: 200,
    });
    expect(s).not.toContain("KHONG_DUOC_XUAT_HIEN");
    expect(s).toContain("ĐÃ BỎ QUA");
    expect(s).toContain("tệp đang mở");
  });
});
