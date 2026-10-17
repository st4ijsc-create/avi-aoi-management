/**
 * ★★ Đợt 3c — phòng thủ chiều sâu chống cookie-tossing, mức CHỈ GHI LOG (không đổi hành vi xác thực):
 * header Cookie mang ≥ 2 `app_session_id` (dấu hiệu một cookie che bóng `path=/api` ghi từ một origin cùng site —
 * `cookie.parse` giữ giá trị ĐẦU TIÊN, mà trình duyệt gửi path DÀI trước) ⇒ cảnh báo có GIỚI HẠN TẦN SUẤT.
 * MỘT điểm gọi duy nhất: `sdk.xacThucTho`.
 */
import { describe, it, expect, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";

const goiCanhBao = vi.hoisted(() => ({ ds: [] as Array<string | undefined> }));
vi.mock("./cookiePhienTrung", async (goc) => {
  const m = await goc<typeof import("./cookiePhienTrung")>();
  return { ...m, canhBaoCookiePhienTrung: (h: string | undefined) => goiCanhBao.ds.push(h) };
});

import { demCookieTheoTen, taoCanhBaoCookiePhienTrung } from "./cookiePhienTrung";

describe("§1 — đếm cookie theo TÊN (header thô, không qua cookie.parse vốn nuốt bản trùng)", () => {
  it("★★★ đếm đúng, không nhầm tiền tố/hậu tố tên", () => {
    expect(demCookieTheoTen(`${COOKIE_NAME}=a; x=1; ${COOKIE_NAME}=b`, COOKIE_NAME)).toBe(2);
    expect(demCookieTheoTen(`${COOKIE_NAME}=a;${COOKIE_NAME}=b;  ${COOKIE_NAME} =c`, COOKIE_NAME)).toBe(3);
    expect(demCookieTheoTen(`${COOKIE_NAME}X=a; __aipv_u_${COOKIE_NAME}=b; ${COOKIE_NAME}=c`, COOKIE_NAME)).toBe(1);
    expect(demCookieTheoTen(undefined, COOKIE_NAME)).toBe(0);
    expect(demCookieTheoTen("", COOKIE_NAME)).toBe(0);
  });
});

describe("§2 — cảnh báo có GIỚI HẠN TẦN SUẤT, không chặn", () => {
  it("★★★ 1 cookie ⇒ im; ≥ 2 ⇒ MỘT cảnh báo mỗi cửa sổ, đếm số bị nén, không lộ giá trị cookie", () => {
    let gio = 0;
    const log: string[] = [];
    const canh = taoCanhBaoCookiePhienTrung({ bayGio: () => gio, ghi: (s) => log.push(s), khoangMs: 60_000 });
    canh(`${COOKIE_NAME}=mot`);
    expect(log).toEqual([]);
    canh(`${COOKIE_NAME}=BIMAT1; ${COOKIE_NAME}=BIMAT2`);
    canh(`${COOKIE_NAME}=a; ${COOKIE_NAME}=b`);
    canh(`${COOKIE_NAME}=a; ${COOKIE_NAME}=b`);
    expect(log.length).toBe(1);
    expect(log[0]).toContain("2");
    expect(log[0]).not.toContain("BIMAT");
    gio = 60_001;
    canh(`${COOKIE_NAME}=a; ${COOKIE_NAME}=b; ${COOKIE_NAME}=c`);
    expect(log.length).toBe(2);
    expect(log[1]).toMatch(/nén 2/);
  });
  it("★★ hàm ghi ném ⇒ KHÔNG ném ra ngoài (xác thực không được hỏng vì log)", () => {
    const canh = taoCanhBaoCookiePhienTrung({ bayGio: () => 0, ghi: () => { throw new Error("x"); } });
    expect(() => canh(`${COOKIE_NAME}=a; ${COOKIE_NAME}=b`)).not.toThrow();
  });
});

describe("§3 — MỘT điểm gọi: sdk.authenticateRequest, hành vi KHÔNG đổi", () => {
  it("★★★ header trùng ⇒ sdk gọi cảnh báo với header thô; vẫn là phán quyết cũ (phiên rác ⇒ ném)", async () => {
    const { sdk } = await import("./sdk");
    const h = `${COOKIE_NAME}=rac1; ${COOKIE_NAME}=rac2`;
    await expect(sdk.authenticateRequest({ headers: { cookie: h } } as any)).rejects.toThrow();
    expect(goiCanhBao.ds).toContain(h);
  });
});
