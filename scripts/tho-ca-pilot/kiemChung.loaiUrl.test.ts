import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loaiUrlCsdl, taoChayLenhKiem } from "./kiemChung";

const DAU = "MATKHAU_GIA_123";

describe("loaiUrlCsdl — lọc chuỗi kết nối CSDL khỏi đầu ra lệnh kiểm", () => {
  it.each([
    ["URL đầy đủ", `lỗi: postgresql://avi_app:${DAU}@127.0.0.1:5434/aoi_management_test hỏng`],
    ["URL dạng postgres://", `postgres://u:${DAU}@h/db`],
    ["viết hoa", `POSTGRESQL://u:${DAU}@h/db`],
    ["URL trong nháy kép", `connectionString: "postgresql://u:${DAU}@h:5434/db"`],
    ["URL trong nháy đơn", `url='postgres://u:${DAU}@h/db'`],
    ["gán biến môi trường", `TEST_DATABASE_URL=postgresql://u:${DAU}@h/db`],
    ["dạng user:pass@host trần", `kết nối ${"avi_app"}:${DAU}@127.0.0.1:5434 bị từ chối`],
    ["user:pass@host kèm đường dẫn", `avi_app:${DAU}@db.noi-bo.local/aoi_management_test`],
    ["URL có ký tự mã hoá %", `postgresql://u:${DAU}%21x@h/db`],
    ["hai URL trên hai dòng", `a postgres://u:${DAU}@h/1\nb postgresql://v:${DAU}@h/2`],
  ])("★★★ %s ⇒ không còn dấu mật khẩu", (_t, vao) => {
    const ra = loaiUrlCsdl(vao);
    expect(ra).not.toContain(DAU);
    expect(ra).toContain("***");
  });

  it("★★ URL được thay bằng postgres://*** và phần chữ xung quanh được giữ", () => {
    expect(loaiUrlCsdl(`lỗi: postgresql://u:${DAU}@h/db hỏng`)).toBe("lỗi: postgres://*** hỏng");
  });

  it("★★ mỗi dạng URL được thay NGUYÊN khối bằng postgres://*** (không để lại nửa chừng): postgres://, viết hoa, nhiều URL", () => {
    expect(loaiUrlCsdl(`postgres://u:${DAU}@h/db`)).toBe("postgres://***");
    expect(loaiUrlCsdl(`POSTGRESQL://u:${DAU}@h/db`)).toBe("postgres://***");
    expect(loaiUrlCsdl(`a postgres://u:${DAU}@h/1\nb postgresql://v:${DAU}@h/2`)).toBe("a postgres://***\nb postgres://***");
    expect(loaiUrlCsdl(`x postgres://h1/db y postgres://h2/db`)).toBe("x postgres://*** y postgres://***");
  });

  it("★★ nhiều chuỗi user:pass@host trần trong cùng đầu ra đều bị thay", () => {
    const ra = loaiUrlCsdl(`một avi_app:${DAU}@h1:5434 và hai avi_app:${DAU}x@h2:5434`);
    expect(ra).toBe("một *** và hai ***");
  });

  it("★★ đầu ra không có URL giữ NGUYÊN VĂN (không cắt oan vitest, đường dẫn, địa chỉ cổng)", () => {
    const mau = [
      " RUN  v2.1.9 D:/SOURCES/_tho_ca_wt",
      " ✓ server/db/x.test.ts (23 tests) 6ms",
      "Error: connect ECONNREFUSED 127.0.0.1:5434",
      "   Tests  23 passed (23)",
      "đường C:\\Users\\Admin\\x.ts:12:3 và http://localhost:3000/api",
    ].join("\n");
    expect(loaiUrlCsdl(mau)).toBe(mau);
  });
});

describe("loaiUrlCsdl — áp vào đầu ra lệnh kiểm THẬT của bộ chạy", () => {
  it("★★★ tiến trình con in URL từ env ⇒ `duoi` của KetQuaKiem không còn dấu mật khẩu", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcu-"));
    try {
      const url = `postgresql://avi_app:${DAU}@127.0.0.1:5434/aoi_management_test`;
      const kq = await taoChayLenhKiem({ testDbUrl: url })(`node -p "process.env.TEST_DATABASE_URL"`, cwd, 60);
      expect(kq.exit).toBe(0);
      expect(kq.duoi).toContain("postgres://***");
      expect(kq.duoi).not.toContain(DAU);
      expect(JSON.stringify(kq)).not.toContain(DAU);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 90_000);

  it("★★ đầu ra lỗi (stderr) có URL cũng bị lọc", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcu-"));
    try {
      const url = `postgresql://avi_app:${DAU}@127.0.0.1:5434/aoi_management_test`;
      const kq = await taoChayLenhKiem({ testDbUrl: url })(`node -e "console.error('ket noi loi: ' + process.env.TEST_DATABASE_URL); process.exit(3)"`, cwd, 60);
      expect(kq.exit).toBe(3);
      expect(kq.duoi).toContain("ket noi loi: postgres://***");
      expect(kq.duoi).not.toContain(DAU);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 90_000);
});

describe("CỜ TẮT ⇒ đầu ra lệnh kiểm KHÔNG đổi một byte; có cờ ⇒ thêm tên ca đỏ và đầu ra đầy đủ", () => {
  const URL_TRONG = "postgresql://u:matkhau-khong-bi-loc@127.0.0.1:5434/db";
  const chayVoi = async (lenh: string, testDbUrl?: string) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcb-"));
    try {
      return await taoChayLenhKiem(testDbUrl === undefined ? {} : { testDbUrl })(lenh, cwd, 60);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  };
  it("★★★ không testDbUrl: URL và user:pass@host trong đầu ra giữ NGUYÊN VĂN; không có tenCaDo / dauRaDayDu", async () => {
    const kq = await chayVoi(`node -e "console.log('${URL_TRONG}'); console.log('avi_app:matkhau-khong-bi-loc@h:5434'); console.log('   × ca do 3ms')"`);
    expect(kq.duoi).toContain(URL_TRONG);
    expect(kq.duoi).toContain("avi_app:matkhau-khong-bi-loc@h:5434");
    expect(kq.duoi).not.toContain("***");
    expect("tenCaDo" in kq).toBe(false);
    expect("dauRaDayDu" in kq).toBe(false);
  }, 90_000);
  it("★★★ có testDbUrl: có tenCaDo và dauRaDayDu (đã lọc); `duoi` vẫn là đuôi ≤ 3000 ký tự", async () => {
    const url = "postgresql://tho_ca_test:Mk9xPz3Qw7Ab@127.0.0.1:5434/aoi_management_test";
    const kq = await chayVoi(`node -e "console.log('   × ca do 3ms'); for (let i = 0; i < 400; i++) console.log('dong ' + i + ' ' + process.env.TEST_DATABASE_URL)"`, url);
    expect(kq.tenCaDo).toEqual(["ca do"]);
    expect(kq.dauRaDayDu).toBeDefined();
    expect(kq.dauRaDayDu!.length).toBeGreaterThan(3000);
    expect(kq.duoi.length).toBeLessThanOrEqual(3000);
    expect(kq.dauRaDayDu).not.toContain("Mk9xPz3Qw7Ab");
    expect(kq.duoi).not.toContain("Mk9xPz3Qw7Ab");
    expect(kq.dauRaDayDu).toContain("dong 0 postgres://***");
    expect(kq.dauRaDayDu).toContain("dong 399 postgres://***");
  }, 90_000);
  it("★★ lệnh không tồn tại có testDbUrl: lỗi / đầu ra vẫn qua bộ lọc (không ném)", async () => {
    const url = "postgresql://tho_ca_test:Mk9xPz3Qw7Ab@127.0.0.1:5434/aoi_management_test";
    const kq = await chayVoi("lenh-khong-ton-tai-zzz", url);
    expect(JSON.stringify(kq)).not.toContain("Mk9xPz3Qw7Ab");
  }, 90_000);
});

describe("dauRaDayDu — cắt giữa chỉ khi quá lớn", () => {
  it("★★★ đầu ra vừa (≈ 34 KB): KHÔNG cắt, KHÔNG dấu cắt giữa, giữ đủ đầu và cuối", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcd-"));
    try {
      const url = "postgresql://tho_ca_test:Mk9xPz3Qw7Ab@127.0.0.1:5434/aoi_management_test";
      const kq = await taoChayLenhKiem({ testDbUrl: url })(`node -e "for (let i = 0; i < 400; i++) console.log('dong ' + i + ' ' + 'x'.repeat(70))"`, cwd, 60);
      expect(kq.dauRaDayDu).toBeDefined();
      expect(kq.dauRaDayDu).not.toContain("cắt giữa");
      expect(kq.dauRaDayDu).toContain("dong 0 ");
      expect(kq.dauRaDayDu).toContain("dong 399 ");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 90_000);
  it("★★★ đầu ra RẤT lớn (≈ 600 KB): cắt giữa — giữ đầu 100 KB và cuối 300 KB, có dấu cắt, tổng ≤ ~400 KB", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcd-"));
    try {
      const url = "postgresql://tho_ca_test:Mk9xPz3Qw7Ab@127.0.0.1:5434/aoi_management_test";
      const kq = await taoChayLenhKiem({ testDbUrl: url })(`node -e "for (let i = 0; i < 6000; i++) console.log('dong ' + String(i).padStart(5, '0') + ' ' + 'x'.repeat(90))"`, cwd, 60);
      const d = kq.dauRaDayDu!;
      expect(d).toContain("…(cắt giữa)…");
      expect(d.startsWith("dong 00000 ")).toBe(true);
      expect(d.trimEnd().endsWith("x".repeat(90))).toBe(true);
      expect(d).toContain("dong 05999 ");
      expect(d.length).toBeLessThan(402_000);
      expect(d.length).toBeGreaterThan(399_000);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});
