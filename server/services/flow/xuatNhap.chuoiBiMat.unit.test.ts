/**
 * Đơn vị thuần cho bộ làm sạch bí mật HTTP của XUẤT luồng (lô vá 17 biến thể): tên khoá (chuẩn hoá bỏ dấu, từ khoá ngắn chỉ khi đứng riêng), chuỗi thân, url.
 * Bổ sung cho `xuatNhapBiMatBienThe.test.ts` (của người kiểm định — KHÔNG sửa) — gồm ca token ĐỘC LẬP (không có tên khoá) và ca KHÔNG báo nhầm.
 */
import { describe, expect, it } from "vitest";
import { laTenBiMat, lamSachChuoiBiMat, lamSachUrl } from "./xuatNhap";

describe("laTenBiMat", () => {
  it("bắt: key / token / password / mật_khẩu / pwd / pass / otp / sid / sessionId / credentials / signature / Authorization / X-Api-Key", () => {
    for (const k of ["apiKey", "access_token", "password", "mật_khẩu", "Mật Khẩu", "pwd", "pass", "otp", "sid", "sessionId", "credentials", "signature", "Authorization", "X-Api-Key", "bi_mat", "khoa_api", "xac_thuc", "privateKey", "clientSecret"]) expect(laTenBiMat(k), k).toBe(true);
  });
  it("KHÔNG báo nhầm: bypass / inside / passenger / Accept / Content-Type / X-Request-Id / ten / ghiChu / soMay / orderId", () => {
    for (const k of ["bypass", "inside", "passenger", "Accept", "Content-Type", "X-Request-Id", "ten", "ghiChu", "soMay", "orderId", "tieuDe"]) expect(laTenBiMat(k), k).toBe(false);
  });
});

describe("lamSachChuoiBiMat", () => {
  it("dòng xác thực nhiều từ: xoá tới hết giá trị; cặp key=value; mat_khau=; session_id:", () => {
    expect(lamSachChuoiBiMat("Authorization: Bearer abc.def")).toBe("Authorization: ");
    expect(lamSachChuoiBiMat("authorization=Basic dXNlcjpwYXNz&mode=a")).toBe("authorization=&mode=a");
    expect(lamSachChuoiBiMat("user=a&mat_khau=xyz&ok=1")).toBe("user=a&mat_khau=&ok=1");
    expect(lamSachChuoiBiMat("session_id: S123")).toBe("session_id: ");
  });
  it("token ĐỘC LẬP (không có tên khoá) bị gỡ: sk-…, ghp_…, JWT, chuỗi ≥ 40 ký tự; chữ thường giữ nguyên", () => {
    expect(lamSachChuoiBiMat("dùng sk-abcdefghijklmnopqrstuvwxyz123456 nhé")).toBe("dùng  nhé");
    expect(lamSachChuoiBiMat("x ghp_abcdefghijklmnopqrstuvwxyz1234 y")).toBe("x  y");
    expect(lamSachChuoiBiMat("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcde12345")).toBe("");
    expect(lamSachChuoiBiMat("đây là câu thường, không có bí mật nào")).toBe("đây là câu thường, không có bí mật nào");
  });
});

describe("lamSachUrl", () => {
  it("query / fragment / %3F / %23 / userinfo (mật khẩu chứa @) / khoảng trắng đầu / tham số ma trận / đoạn đường dẫn giống token", () => {
    expect(lamSachUrl("https://h.example.com:8443/v1/send?token=A#f").url).toBe("https://h.example.com:8443/v1/send");
    expect(lamSachUrl("https://h.example.com/p%3Ftoken=A").url).toBe("https://h.example.com/p");
    expect(lamSachUrl("https://h.example.com/p%23frag").url).toBe("https://h.example.com/p");
    expect(lamSachUrl("https://a:b@c@h.example.com/p").url).toBe("https://h.example.com/p");
    expect(lamSachUrl("  https://a:b@h.example.com/p").url).toBe("https://h.example.com/p");
    expect(lamSachUrl("https://h.example.com/p;jsessionid=Z/q").url).toBe("https://h.example.com/p/q");
    expect(lamSachUrl("https://h.example.com/bot123456:AAbbCCdd/send").url).toBe("https://h.example.com/DIEN-LAI-DOAN-DUONG-DAN/send");
    expect(lamSachUrl("https://h.example.com/v1/AbCdEfGhIjKlMnOpQrStUvWx12/x").url).toBe("https://h.example.com/v1/DIEN-LAI-DOAN-DUONG-DAN/x");
  });
  it("KHÔNG phá URL thường: đường ngắn, slug chữ-không-số dài, biểu thức {{ }} trong đường/truy vấn (dấu ? của biểu thức)", () => {
    expect(lamSachUrl("https://h.example.com/api/v1/may-bao-tri-dinh-ky-hang-thang/x").doi).toBe(false);
    expect(lamSachUrl("https://h.example.com/api/{{ $json.id }}/x").url).toBe("https://h.example.com/api/{{ $json.id }}/x");
    expect(lamSachUrl("https://h.example.com/{{ $json.a ? 1 : 2 }}/x").url).toBe("https://h.example.com/{{ $json.a ? 1 : 2 }}/x");
  });
});
