/**
 * doc 81 Đợt 3b final wave — Ruling R-3b-c: `?next=` của trang đăng nhập (Login.tsx) chỉ nhận đường NỘI BỘ.
 * Trước: `nextValue.startsWith("/")` ⇒ `?next=//evil.example` (URL cùng giao thức tới máy khác) và `?next=/\evil.example`
 * đi thẳng vào `window.location.href` sau khi đăng nhập = open redirect. Oracle: luật WHATWG viết tay (như
 * shared/internalPath.test.ts), không gọi lại hàm của trang để suy kỳ vọng.
 */
import { describe, expect, it } from "vitest";
import LOGIN_SRC from "../pages/Login.tsx?raw";
import { loginNextPath } from "./loginNext";

describe("loginNextPath — ?next= của trang đăng nhập", () => {
  it.each([
    ["?next=/engineering-changes%3Fflyout%3Decn", "/engineering-changes?flyout=ecn"],
    ["?next=%2Frecipes", "/recipes"],
    ["?foo=1&next=/alerts", "/alerts"],
  ])("giữ đường nội bộ %s", (search, want) => {
    expect(loginNextPath(search)).toBe(want);
  });

  it.each([
    ["không có next", ""],
    ["next rỗng", "?next="],
    ["URL tuyệt đối", "?next=https%3A%2F%2Fevil.example%2F"],
    ["// cùng giao thức", "?next=//evil.example"],
    ["// mã hoá", "?next=%2F%2Fevil.example"],
    ["gạch chéo ngược", "?next=/%5Cevil.example"],
    ["TAB bị bỏ ⇒ //", "?next=/%09/evil.example"],
    ["đoạn chấm ⇒ //", "?next=/..//evil.example"],
    ["javascript:", "?next=javascript:alert(1)"],
    ["tương đối", "?next=dashboard"],
  ])("chặn %s ⇒ null (trang dùng đích theo vai)", (_n, search) => {
    expect(loginNextPath(search)).toBeNull();
  });

  it("Login.tsx: CẢ HAI chỗ đọc ?next= (đăng nhập thường/2FA và OAuth ngoài) đi qua loginNextPath; không còn startsWith('/') trần", () => {
    const src = LOGIN_SRC as string;
    expect(src).not.toMatch(/nextValue\s*&&\s*nextValue\.startsWith\(\s*["']\/["']\s*\)/);
    expect(src).not.toMatch(/get\(\s*["']next["']\s*\)/);
    expect(src.match(/loginNextPath\(window\.location\.search\)/g)?.length).toBe(2);
  });
});
