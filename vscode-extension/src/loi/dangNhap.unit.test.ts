/**
 * LƯỚI đăng nhập (phần THUẦN). Hai vị từ dễ sai âm thầm: (1) đọc cookie phiên giữa nhiều
 * Set-Cookie có thuộc tính (HttpOnly/Path/SameSite) — lấy nhầm thuộc tính làm giá trị thì mọi
 * lượt sau 401; (2) phân loại kết quả — `requires2FA` PHẢI là nhánh riêng, không được coi là
 * "thành công" cũng không phải "sai mật khẩu".
 */
import { describe, it, expect } from "vitest";
import { docCookiePhien, phanTichKetQuaDangNhap, kiemTraServerUrl } from "./dangNhap";

describe("docCookiePhien", () => {
  it("★★★ lấy ĐÚNG giá trị giữa nhiều cookie có thuộc tính", () => {
    const dong = [
      "other=abc; Path=/; HttpOnly",
      "app_session_id=eyJHEADER.PAYLOAD.SIG; Path=/; HttpOnly; SameSite=Lax",
    ];
    expect(docCookiePhien(dong)).toBe("eyJHEADER.PAYLOAD.SIG");
  });

  it("★★★ không có cookie phiên ⇒ null (KHÔNG trả chuỗi rỗng giả vờ có)", () => {
    expect(docCookiePhien(["other=abc; Path=/"])).toBeNull();
    expect(docCookiePhien([])).toBeNull();
  });

  it("★★ tên cookie khác chứa chuỗi con KHÔNG bị nhận nhầm", () => {
    expect(docCookiePhien(["xx_app_session_id_bak=zzz; Path=/"])).toBeNull();
  });
});

describe("phanTichKetQuaDangNhap", () => {
  it("★★★ requires2FA là NHÁNH RIÊNG", () => {
    expect(phanTichKetQuaDangNhap({ requires2FA: true, userId: 7 })).toEqual({ loai: "can2fa" });
  });

  it("★★★ thành công ⇒ ok + tên", () => {
    expect(phanTichKetQuaDangNhap({ success: true, user: { name: "Anh Minh" } })).toEqual({
      loai: "ok",
      ten: "Anh Minh",
    });
  });

  it("★★ thất bại ⇒ loi có thông điệp", () => {
    const r = phanTichKetQuaDangNhap({ message: "Sai tài khoản" });
    expect(r.loai).toBe("loi");
    if (r.loai === "loi") expect(r.thongDiep).toBe("Sai tài khoản");
  });

  it("★★ đáp ứng lạ (null/chuỗi) ⇒ loi, KHÔNG ném", () => {
    expect(phanTichKetQuaDangNhap(null).loai).toBe("loi");
    expect(phanTichKetQuaDangNhap("<html>").loai).toBe("loi");
  });

  it("★★★ HÌNH DẠNG THẬT của máy chủ: lỗi nằm ở `error`, KHÔNG phải `message`", () => {
    // Đo thật trên oauth.ts:360 — `res.status(401).json({ error: err.message })`.
    // Ca này tồn tại vì lưới cũ tự bịa {message:...}: xanh mà KHÔNG phủ hợp đồng thật.
    const r = phanTichKetQuaDangNhap({ error: "Tên đăng nhập hoặc mật khẩu không đúng" });
    expect(r.loai).toBe("loi");
    if (r.loai === "loi") expect(r.thongDiep).toBe("Tên đăng nhập hoặc mật khẩu không đúng");
  });

  it("★★ 2FA vẫn thắng dù đáp ứng có kèm `message`", () => {
    expect(phanTichKetQuaDangNhap({ requires2FA: true, userId: 7, message: "Vui lòng nhập mã xác thực 2 bước" }))
      .toEqual({ loai: "can2fa" });
  });

  it("★★ HÌNH DẠNG THẬT khi thành công (đủ 4 trường user)", () => {
    expect(phanTichKetQuaDangNhap({ success: true, user: { id: 3, name: "Anh Minh", email: "a@b.c", role: "engineer" } }))
      .toEqual({ loai: "ok", ten: "Anh Minh" });
  });
});

describe("kiemTraServerUrl", () => {
  it("★★★ CHẶN scheme lạ (đường rò credential)", () => {
    expect(kiemTraServerUrl("file:///C:/x").ok).toBe(false);
    expect(kiemTraServerUrl("javascript:alert(1)").ok).toBe(false);
  });
  it("★★★ URL rác ⇒ từ chối, KHÔNG ném", () => {
    expect(kiemTraServerUrl("khong-phai-url").ok).toBe(false);
  });
  it("★★ http/https hợp lệ ⇒ nhận, cắt dấu / thừa cuối", () => {
    const r = kiemTraServerUrl("http://localhost:3000//");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("http://localhost:3000");
  });
});
