/**
 * ★★★ Đợt 3c — vá "cookie-tossing / same-site": COOKIE KHÔNG TÁCH THEO CỔNG. Xem trước chỉ an toàn khi origin công
 * khai của proxy có HOST KHÁC SITE với host ứng dụng. `cungSite` là phép so CHẶT (fail-closed) dùng ở cả cấu hình
 * lẫn lúc cấp vé.
 */
import { describe, it, expect } from "vitest";
import { cungSite, laNhomLoopbackTen } from "./cungSite";

describe("§1 — cungSite: CÙNG site ⇒ true (từ chối xem trước)", () => {
  it("★★★ cùng host, khác cổng = CÙNG site (đúng lỗ đã báo)", () => {
    expect(cungSite("127.0.0.1", "127.0.0.1")).toBe(true);
    expect(cungSite("may-chu.local", "MAY-CHU.local.")).toBe(true);
  });
  it("★★★ nhóm loopback 'tên' — localhost / *.localhost / 127.0.0.1 / ::1 coi là MỘT", () => {
    for (const [a, b] of [
      ["localhost", "127.0.0.1"],
      ["[::1]", "localhost"],
      ["::1", "127.0.0.1"],
      ["preview.localhost", "127.0.0.1"],
      ["[::ffff:127.0.0.1]", "localhost"],
      ["0.0.0.0", "localhost"],
    ]) expect(cungSite(a!, b!), `${a} ~ ${b}`).toBe(true);
  });
  it("★★ tên miền: cha/con hoặc chung HAI nhãn cuối ⇒ cùng site (chặt: co.uk/com.vn cũng bị coi cùng)", () => {
    expect(cungSite("app.factory.vn", "preview.factory.vn")).toBe(true);
    expect(cungSite("factory.vn", "preview.factory.vn")).toBe(true);
    expect(cungSite("aoi-server", "preview.aoi-server")).toBe(true);
    expect(cungSite("a.cty.com.vn", "b.khac.com.vn")).toBe(true);
  });
  it("★★★ fail-closed: host rỗng / méo ⇒ true", () => {
    expect(cungSite("", "10.0.0.9")).toBe(true);
    expect(cungSite("10.0.0.9", undefined)).toBe(true);
    expect(cungSite("a b", "10.0.0.9")).toBe(true);
  });
});

describe("§2 — KHÁC site ⇒ false (xem trước được bật)", () => {
  it("★★★ 127.0.0.2 khác site với 127.0.0.1 / localhost (cookie theo HOST, IP chỉ khớp tuyệt đối)", () => {
    expect(cungSite("127.0.0.1", "127.0.0.2")).toBe(false);
    expect(cungSite("localhost", "127.0.0.2")).toBe(false);
    expect(cungSite("[::1]", "127.0.0.2")).toBe(false);
  });
  it("★★ IP LAN khác nhau; tên miền đăng ký khác nhau; tên vs IP", () => {
    expect(cungSite("10.0.0.5", "10.0.0.9")).toBe(false);
    expect(cungSite("app.factory.vn", "preview.factory-xt.vn")).toBe(false);
    expect(cungSite("aoi-server", "192.168.1.5")).toBe(false);
  });
});

describe("§3 — laNhomLoopbackTen", () => {
  it("★★ 127.0.0.2 KHÔNG thuộc nhóm (nó là lối ra được khuyên dùng trên máy dev)", () => {
    expect(laNhomLoopbackTen("127.0.0.2")).toBe(false);
    expect(laNhomLoopbackTen("localhost")).toBe(true);
    expect(laNhomLoopbackTen("[::1]")).toBe(true);
  });
});
