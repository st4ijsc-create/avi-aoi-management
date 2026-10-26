import { describe, expect, it } from "vitest";
import {
  __xoaDemTuDien,
  chuanHoaDeKhop,
  cheChuoi,
  cheGiaTri,
  cheSchemaTool,
  laTenKhoaNhay,
  layTuDienNhay,
  TU_DIEN_RONG,
  type TuDienNhay,
} from "./cheDuLieu";
import { VECTOR_CHE, type VectorChe } from "./vectorChe";

function tuDienCua(v: VectorChe): TuDienNhay {
  if (!v.tuDien) return TU_DIEN_RONG;
  return {
    tenNguoiDung: new Set(v.tuDien.nguoiDung ?? []),
    tenKhach: new Set(v.tuDien.khach ?? []),
    tenNhaMay: new Set(v.tuDien.nhaMay ?? []),
  };
}

function chay(v: VectorChe) {
  const tu = tuDienCua(v);
  return v.cheDo === "schema" ? cheSchemaTool(v.dauVao, tu) : cheGiaTri(v.dauVao, tu);
}

/** Vector thất bại dưới một bộ che cho trước (dùng cho cả bộ thật lẫn bộ "không che"). */
function thatBai(v: VectorChe, ra: string): boolean {
  return v.phaiKhongCon.some((s) => ra.includes(s)) || (v.phaiConLai ?? []).some((s) => !ra.includes(s));
}

describe("cheDuLieu — vector dùng chung", () => {
  for (const v of VECTOR_CHE) {
    it(v.ten, () => {
      const kq = chay(v);
      const ra = JSON.stringify(kq.giaTri);
      for (const s of v.phaiKhongCon) expect(ra, `còn "${s}"`).not.toContain(s);
      for (const s of v.phaiConLai ?? []) expect(ra, `mất "${s}"`).toContain(s);
      if (v.phaiKhongCon.length > 0) expect(kq.soTruongDaChe).toBeGreaterThan(0);
      else expect(kq.soTruongDaChe).toBe(0);
    });
  }

  it("đột biến 'không che' (bộ che trả nguyên văn) làm đỏ ≥ 10 vector — vector có răng", () => {
    const do_ = VECTOR_CHE.filter((v) => thatBai(v, JSON.stringify(v.dauVao)));
    expect(do_.length).toBeGreaterThanOrEqual(10);
  });

  it("giữ KIỂU trường giao thức / số liệu", () => {
    const kq = cheGiaTri({ maxTokens: 512, passRate: 0.97, passed: true, tokenCount: 3 }).giaTri as Record<string, unknown>;
    expect(typeof kq.maxTokens).toBe("number");
    expect(kq.passRate).toBe(0.97);
    expect(kq.passed).toBe(true);
    expect(kq.tokenCount).toBe(3);
  });

  it("khoá nhạy mang số/bool ⇒ null (không đổi kiểu sang chuỗi); token trong KẾT QUẢ TOOL bị che", () => {
    const kq = cheGiaTri({ pin: 1, password: 1234, token: "x", ketQua: { token: "abc-tool-secret" } }).giaTri as Record<string, unknown>;
    expect(kq.password).toBeNull();
    expect(kq.token).toBe("[REDACTED_SECRET]");
    expect(JSON.stringify(kq)).not.toContain("abc-tool-secret");
    expect(kq.pin).toBe(1);
  });
});

describe("laTenKhoaNhay — neo theo đoạn + ngoại lệ", () => {
  it.each([
    "password", "DB_PASSWORD", "MYSQL_PWD", "AWS_SECRET_ACCESS_KEY", "x-api-key", "apiKey", "Api_Key", "APIKey",
    "client_secret", "accessToken", "sessionId", "Authorization", "cookie", "pаssword", "ｐａｓｓｗｏｒｄ",
  ])("nhạy: %s", (t) => expect(laTenKhoaNhay(t)).toBe(true));
  it.each([
    "maxTokens", "tokenCount", "tokensOut", "tokenizer", "passed", "passRate", "password_policy_min_length",
    "tokenType", "sessionTimeout", "secretName", "status", "name", "pass", "keyboard", "compass",
  ])("không nhạy: %s", (t) => expect(laTenKhoaNhay(t)).toBe(false));
});

describe("cheChuoi — văn bản", () => {
  it("chuẩn hoá bỏ ký tự vô hình", () => {
    expect(chuanHoaDeKhop("a​b‮c﻿d")).toBe("abcd");
  });

  it("chữ Nga thuần (không trộn Latin, không thành từ khoá) giữ nguyên", () => {
    expect(cheChuoi("Привет мир").giaTri).toBe("Привет мир");
  });

  it("giá trị dạng biểu thức mã giữ nguyên; giá trị chữ bị che", () => {
    expect(cheChuoi("token = process.env.TOKEN").giaTri).toContain("process.env.TOKEN");
    expect(cheChuoi("secret: abcd1234").giaTri).not.toContain("abcd1234");
  });

  it("so sánh `==` trong mã không bị coi là gán", () => {
    expect(cheChuoi("if (token == null) return;").giaTri).toBe("if (token == null) return;");
  });

  it("hiệu năng: từ điển 5 000 tên + văn bản 200 KB < 200 ms", () => {
    const ten = Array.from({ length: 5000 }, (_, i) => `Khach Hang Mau ${i} Co`);
    const tu: TuDienNhay = { tenNguoiDung: new Set(), tenKhach: new Set(ten), tenNhaMay: new Set() };
    const vb = "Dây chuyền 3 báo lỗi cho Khach Hang Mau 4321 Co lúc 8h, tốc độ 120 sp/phút. ".repeat(2700);
    expect(vb.length).toBeGreaterThan(200_000);
    cheChuoi("khởi động", tu); // dựng chỉ mục (đệm theo đối tượng từ điển)
    const t0 = performance.now();
    const kq = cheChuoi(vb, tu);
    const ms = performance.now() - t0;
    expect(kq.giaTri).not.toContain("Khach Hang Mau 4321 Co");
    expect(ms).toBeLessThan(200);
  });
});

describe("layTuDienNhay — đệm 5 phút", () => {
  it("đọc một lần trong 5 phút, đọc lại sau 5 phút; lỗi đọc ⇒ ném", async () => {
    __xoaDemTuDien();
    let lan = 0;
    const nguon = { docTen: async () => (lan++, { nguoiDung: ["nguyen van a"], khach: [], nhaMay: [] }) };
    await layTuDienNhay(nguon, 1_000);
    await layTuDienNhay(nguon, 1_000 + 299_999);
    expect(lan).toBe(1);
    await layTuDienNhay(nguon, 1_000 + 300_000);
    expect(lan).toBe(2);
    __xoaDemTuDien();
    await expect(layTuDienNhay({ docTen: async () => Promise.reject(new Error("db")) }, 1)).rejects.toThrow();
    __xoaDemTuDien();
  });
});
