/**
 * ★ Pha 0 P0-11 (2026-11-04) — hạn phiên theo vai + gia hạn trượt TẠI CHỖ (thuần + nối dây; phần DB: `giaHanPhien.db.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const giaHanMock = vi.hoisted(() => vi.fn(async () => 1));
const phienMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock("../db", async (orig) => ({ ...(await orig<typeof import("../db")>()), giaHanPhienTaiCho: giaHanMock, getSessionByToken: phienMock }));

import { HAN_PHIEN_VAI_CAO_MS, HAN_PHIEN_VAI_KHAC_MS, TRAN_TUYET_DOI_PHIEN_MS, hanGiaHanMoi, hanPhienMs, hanPhienTheoVaiMs } from "./hanPhien";
import { chanNeuPhienDaThuHoi, giaHanPhienNeuCan } from "./sdk";

const GIO = 60 * 60 * 1000;
const NGAY = 24 * GIO;
const T0 = Date.UTC(2026, 10, 4, 8, 0, 0);
afterEach(() => {
  delete process.env.SESSION_TTL_DAYS;
  giaHanMock.mockReset();
  giaHanMock.mockImplementation(async () => 1);
  phienMock.mockReset();
  phienMock.mockImplementation(async () => null);
});

describe("hạn theo vai", () => {
  it("★★★ admin / engineer 7 ngày; operator / supervisor / vai khác / vắng 12 giờ", () => {
    expect(HAN_PHIEN_VAI_CAO_MS).toBe(7 * NGAY);
    expect(HAN_PHIEN_VAI_KHAC_MS).toBe(12 * GIO);
    for (const v of ["admin", "engineer", "ADMIN"]) expect(hanPhienTheoVaiMs(v), v).toBe(7 * NGAY);
    for (const v of ["operator", "supervisor", "user", "viewer", "", null, undefined]) expect(hanPhienTheoVaiMs(v), String(v)).toBe(12 * GIO);
  });
  it("★★ SESSION_TTL_DAYS là TRẦN TRÊN (nhỏ hơn thì thắng, lớn hơn không nới); vé / cookie tối đa 30 ngày", () => {
    process.env.SESSION_TTL_DAYS = "0.25"; // 6 giờ
    expect(hanPhienTheoVaiMs("admin")).toBe(6 * GIO);
    expect(hanPhienTheoVaiMs("operator")).toBe(6 * GIO);
    expect(hanPhienMs()).toBe(6 * GIO);
    process.env.SESSION_TTL_DAYS = "90";
    expect(hanPhienTheoVaiMs("admin")).toBe(7 * NGAY);
    expect(hanPhienMs()).toBe(30 * NGAY);
    delete process.env.SESSION_TTL_DAYS;
    expect(hanPhienMs()).toBe(TRAN_TUYET_DOI_PHIEN_MS);
  });
});

describe("hanGiaHanMoi — gia hạn trượt (thuần)", () => {
  const hang = (conMs: number, taoTruocMs = GIO, isActive = true) => ({ isActive, expiresAt: new Date(T0 + conMs), createdAt: new Date(T0 - taoTruocMs) });
  it("★★★ operator: còn ≥ 6 h ⇒ không; còn < 6 h ⇒ bây giờ + 12 h", () => {
    expect(hanGiaHanMoi(hang(6 * GIO), "operator", T0)).toBeNull();
    expect(hanGiaHanMoi(hang(6 * GIO - 1), "operator", T0)?.getTime()).toBe(T0 + 12 * GIO);
  });
  it("★★★ engineer: ngưỡng 3,5 ngày, gia hạn tới bây giờ + 7 ngày (đột biến 'operator nhận 7 ngày' bị ca trên bắt)", () => {
    expect(hanGiaHanMoi(hang(3.5 * NGAY), "engineer", T0)).toBeNull();
    expect(hanGiaHanMoi(hang(GIO), "engineer", T0)?.getTime()).toBe(T0 + 7 * NGAY);
  });
  it("★★★ TRẦN TUYỆT ĐỐI 30 ngày từ createdAt: không vượt; đã chạm trần ⇒ không gia hạn", () => {
    expect(hanGiaHanMoi(hang(GIO, 29.9 * NGAY), "engineer", T0)?.getTime()).toBe(T0 - 29.9 * NGAY + 30 * NGAY);
    expect(hanGiaHanMoi({ isActive: true, expiresAt: new Date(T0 + GIO), createdAt: new Date(T0 - 30 * NGAY + GIO) }, "engineer", T0)).toBeNull();
  });
  it("★★★ không gia hạn: thu hồi (isActive false) / đã hết hạn / thiếu mốc / không hàng", () => {
    expect(hanGiaHanMoi(hang(GIO, GIO, false), "operator", T0)).toBeNull();
    expect(hanGiaHanMoi(hang(-1), "operator", T0)).toBeNull();
    expect(hanGiaHanMoi({ isActive: true, expiresAt: null, createdAt: new Date(T0) }, "operator", T0)).toBeNull();
    expect(hanGiaHanMoi(null, "operator", T0)).toBeNull();
  });
});

describe("nối dây", () => {
  it("★★★ giaHanPhienNeuCan: cần gia hạn ⇒ UPDATE đúng token + hạn mới; không cần / thu hồi ⇒ KHÔNG gọi DB", async () => {
    const bay = Date.now();
    const hangCan = { isActive: true, expiresAt: new Date(bay + GIO), createdAt: new Date(bay - GIO) } as never;
    expect(await giaHanPhienNeuCan("tok", hangCan, "operator")).toBe(true);
    expect(giaHanMock).toHaveBeenCalledTimes(1);
    const [tok, moi] = giaHanMock.mock.calls[0] as unknown as [string, Date];
    expect(tok).toBe("tok");
    expect(Math.abs(moi.getTime() - (bay + 12 * GIO))).toBeLessThan(5_000);
    giaHanMock.mockClear();
    await giaHanPhienNeuCan("tok", { isActive: true, expiresAt: new Date(bay + 11 * GIO), createdAt: new Date(bay) } as never, "operator");
    await giaHanPhienNeuCan("tok", { isActive: false, expiresAt: new Date(bay + GIO), createdAt: new Date(bay) } as never, "operator");
    await giaHanPhienNeuCan("", hangCan, "operator");
    expect(giaHanMock).not.toHaveBeenCalled();
  });
  it("★★★ lỗi DB lúc gia hạn KHÔNG làm hỏng yêu cầu đã xác thực: giaHanPhienTaiCho ném ⇒ giaHanPhienNeuCan trả false, không ném (đột biến s4)", async () => {
    const bay = Date.now();
    giaHanMock.mockRejectedValueOnce(new Error("simulated DB fault (gia hạn)"));
    const canhBao = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(giaHanPhienNeuCan("tok", { isActive: true, expiresAt: new Date(bay + GIO), createdAt: new Date(bay - GIO) } as never, "operator")).resolves.toBe(false);
    } finally {
      canhBao.mockRestore();
    }
    expect(giaHanMock).toHaveBeenCalledTimes(1);
  });
  it("★★★ chanNeuPhienDaThuHoi TRẢ hàng sổ đã đọc (nguồn duy nhất cho gia hạn — đột biến s5 'return null' ⇒ không bao giờ gia hạn); thu hồi ⇒ ném; lỗi tra ⇒ null (fail-open giữ)", async () => {
    const bay = Date.now();
    const hangSong = { isActive: true, expiresAt: new Date(bay + GIO), createdAt: new Date(bay - GIO) };
    phienMock.mockResolvedValueOnce(hangSong);
    expect(await chanNeuPhienDaThuHoi("tok")).toBe(hangSong);
    phienMock.mockResolvedValueOnce({ ...hangSong, isActive: false });
    await expect(chanNeuPhienDaThuHoi("tok")).rejects.toThrow(/revoked/);
    const canhBao = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      phienMock.mockRejectedValueOnce(new Error("simulated DB fault (tra sổ)"));
      expect(await chanNeuPhienDaThuHoi("tok")).toBeNull();
    } finally {
      canhBao.mockRestore();
    }
    // nối hai đầu: hàng trả về ⇒ gia hạn chạy trên đúng hàng ấy
    phienMock.mockResolvedValueOnce(hangSong);
    expect(await giaHanPhienNeuCan("tok", await chanNeuPhienDaThuHoi("tok"), "operator")).toBe(true);
  });
  it("★★★ ghim nguồn: gia hạn CHỈ ở authenticateRequest SAU cổng đổi mật khẩu (đường bỏ qua cổng KHÔNG gia hạn); UPDATE chỉ SET expiresAt", () => {
    const sdk = readFileSync(join(__dirname, "sdk.ts"), "utf8");
    const ham = sdk.slice(sdk.indexOf("async authenticateRequest("), sdk.indexOf("private async xacThucTho("));
    // lời gọi gia hạn nằm TRONG khối `if` (trước dấu `}` đóng khối), không phải sau nó
    expect(ham).toMatch(/if \(tuyChon\?\.boQuaCongDoiMatKhau !== true\) \{\s*await chanNeuPhaiDoiMatKhau\(user\);\s*(\/\/[^\n]*\n\s*)*await giaHanPhienNeuCan\([^;]*;\s*\}\s*return user;/);
    expect(sdk.match(/await giaHanPhienNeuCan\(/g)).toHaveLength(1);
    const dbAuth = readFileSync(join(__dirname, "..", "db", "auth.ts"), "utf8");
    const g = dbAuth.slice(dbAuth.indexOf("export async function giaHanPhienTaiCho("), dbAuth.indexOf("export async function updateSessionActivity("));
    expect(g).toContain(".set({ expiresAt: hetHanMoi })");
    expect(g).toContain("eq(userSessions.isActive, true)");
    expect(g).toContain("lt(userSessions.expiresAt, hetHanMoi)");
  });
  it("★★ đăng nhập: sổ mang hạn THEO VAI (establishSession + OAuth/SAML qua ghiSoPhienChoOpenId)", () => {
    const a = readFileSync(join(__dirname, "authService.ts"), "utf8");
    expect(a).toContain("expiresAt: new Date(Date.now() + hanPhienTheoVaiMs(user.role)),");
    expect(a).toContain("expiresAt: new Date(Date.now() + Math.min(hanMs, hanPhienTheoVaiMs(vai))),");
  });
});
