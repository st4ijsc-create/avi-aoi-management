/**
 * run_command: tiến trình con nhận URL CSDL CHẾT đặt ở chỗ sinh. Không DB, không mạng: tiến trình con chỉ in máy:cổng/đường của hai URL (không tài khoản, không mật khẩu).
 * Env cha dùng hai URL GIẢ không mang tài khoản.
 */
import { describe, expect, it } from "vitest";
import { chayLenhTrongHopCat, moiTruongDaLoc } from "./repoCommandSandbox";

const IN_DICH =
  'const d=(t)=>{const v=process.env[t];if(!v)return "vang";const u=new URL(v);return u.host+u.pathname};console.log("DICH="+d("DATABASE_URL")+"|"+d("TEST_DATABASE_URL"))';
const CHA: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgresql://127.0.0.1:1/cha_gia", TEST_DATABASE_URL: "postgresql://127.0.0.1:1/cha_gia_test" };

describe("run_command — URL CSDL của tiến trình con", () => {
  it("★★★ U1 con nhận hai URL CHẾT cổng 9 (không phải của tiến trình cha, không vắng)", async () => {
    const kq = await chayLenhTrongHopCat({ file: process.execPath, args: ["-e", IN_DICH] }, { hanGioMs: 15_000, goc: process.cwd(), envNguon: CHA });
    expect(kq.maThoat).toBe(0);
    expect(kq.dauRa).toContain("DICH=127.0.0.1:9/aoi_management|127.0.0.1:9/aoi_management_test");
  }, 30_000);
  it("★★★ U2 phép lọc DÙNG CHUNG không tự thêm URL CSDL (cửa chạy ứng dụng của người dùng đi qua nó)", () => {
    const r = moiTruongDaLoc(CHA);
    expect([r.DATABASE_URL, r.TEST_DATABASE_URL]).toEqual([undefined, undefined]);
  });
});
