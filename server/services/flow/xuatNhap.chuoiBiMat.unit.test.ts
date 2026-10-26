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

describe("thẻ XML · full-width · giới hạn đã biết (lô nhỏ kiem-dinh)", () => {
  it("★ thẻ XML mang bí mật: xoá NỘI DUNG, giữ thẻ (password / api-key có thuộc tính / token / authorization / Password hoa-thường lẫn)", () => {
    expect(lamSachChuoiBiMat("<req><password>SEC-XML-1</password><user>a</user></req>")).toBe("<req><password></password><user>a</user></req>");
    expect(lamSachChuoiBiMat('<api-key id="1">SEC-XML-2</api-key>')).toBe('<api-key id="1"></api-key>');
    expect(lamSachChuoiBiMat("<Token>SEC-XML-3</Token><x>ok</x>")).toBe("<Token></Token><x>ok</x>");
    expect(lamSachChuoiBiMat("<authorization>Bearer SEC-XML-4</authorization>")).toBe("<authorization></authorization>");
    expect(lamSachChuoiBiMat("<ten>Nguyen Van A</ten>")).toBe("<ten>Nguyen Van A</ten>");
  });

  it("★ full-width (NFKD/NFKC): ｐａｓｓｗｏｒｄ làm tên khoá và trong chuỗi key=value đều bị bắt; chuỗi KHÔNG có bí mật giữ nguyên bản gốc (không bị đổi sang NFKC)", () => {
    expect(laTenBiMat("ｐａｓｓｗｏｒｄ")).toBe(true);
    expect(laTenBiMat("ＡＰＩ＿ＫＥＹ")).toBe(true);
    expect(lamSachChuoiBiMat("ｐａｓｓｗｏｒｄ=SEC-FW-1&a=1")).toBe("password=&a=1");
    const thuong = "Ｘin chào ｍáy ０１ — không bí mật";
    expect(lamSachChuoiBiMat(thuong)).toBe(thuong);
  });

  it("GIỚI HẠN ĐÃ BIẾT (khoá thành ca để không ai tưởng là đã phủ): Basic base64 trong trường không tên khoá KHÔNG bị bắt; UUID trong đường dẫn bị thay chỗ giữ; khoá vô hại chứa 'key' bị xoá giá trị", () => {
    const basic = "dùng Basic dXNlcjpwYXNz cho kết nối";
    expect(lamSachChuoiBiMat(basic)).toBe(basic); // giới hạn: không có tên khoá, không giống token độc lập
    expect(lamSachUrl("https://h.example.com/items/3f2504e04f8911d39a0c0305e82c3301/x").url).toBe("https://h.example.com/items/DIEN-LAI-DOAN-DUONG-DAN/x"); // UUID liền (quá tay có chủ ý)
    expect(lamSachChuoiBiMat("keyboard=azerty&ok=1")).toBe("keyboard=&ok=1"); // quá tay có chủ ý
    expect(laTenBiMat("authorName")).toBe(true); // quá tay có chủ ý
  });
});
