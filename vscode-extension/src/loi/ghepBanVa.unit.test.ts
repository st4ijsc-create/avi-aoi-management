/**
 * LƯỚI ghép đề xuất cục bộ (`DeXuatCucBo`) thành nội dung MỚI của tệp. Hai bất biến sống còn:
 *   (1) EOL của tệp gốc phải được GIỮ NGUYÊN — đổi EOL cả tệp làm git diff trông như "sửa toàn bộ
 *       tệp", người duyệt mất khả năng thấy thay đổi THẬT (xem docblock `ghepBanVa.ts`).
 *   (2) `dongCuoi` vượt số dòng thật của tệp ⇒ `{ok:false}`, KHÔNG tự cắt bớt — mã đến từ model,
 *       im lặng cắt là ghi một thứ người duyệt chưa từng thấy.
 */
import { describe, it, expect } from "vitest";
import { ghepBanVa } from "./ghepBanVa";
import type { DeXuatCucBo } from "./deXuatCucBo";

const doan = (p: Partial<Extract<DeXuatCucBo, { loai: "doan" }>>): DeXuatCucBo => ({
  loai: "doan",
  path: "a.cs",
  dongDau: 1,
  dongCuoi: 1,
  thayThe: "",
  ...p,
});

describe("ghepBanVa", () => {
  it("★★★ thay đoạn GIỮA tệp đúng vị trí — 1-based, BAO GỒM cả dongCuoi", () => {
    const goc = "1\n2\n3\n4\n5";
    const r = ghepBanVa(goc, doan({ dongDau: 2, dongCuoi: 3, thayThe: "X\nY" }));
    expect(r).toEqual({ ok: true, moi: "1\nX\nY\n4\n5" });
  });

  it("★★★ GIỮ NGUYÊN CRLF — tệp gốc \\r\\n ⇒ kết quả vẫn \\r\\n ở MỌI dòng", () => {
    const goc = "1\r\n2\r\n3\r\n4\r\n5";
    const r = ghepBanVa(goc, doan({ dongDau: 2, dongCuoi: 3, thayThe: "X\nY" })) as { ok: true; moi: string };
    expect(r.ok).toBe(true);
    expect(r.moi).toBe("1\r\nX\r\nY\r\n4\r\n5");
    // Không còn LF trần nào lọt qua (thayThe đến từ model dùng \n, phải được dịch sang \r\n).
    expect(r.moi.match(/(?<!\r)\n/g)).toBeNull();
  });

  it("★★★ dongCuoi VƯỢT số dòng của tệp ⇒ {ok:false}, KHÔNG tự cắt bớt", () => {
    const goc = "1\n2\n3";
    const r = ghepBanVa(goc, doan({ dongDau: 2, dongCuoi: 10, thayThe: "X" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).toMatch(/dongCuoi|dòng/i);
  });

  it("★★ tệp KHÔNG có newline cuối ⇒ kết quả cũng không tự thêm", () => {
    const goc = "1\n2\n3"; // không có \n cuối
    const r = ghepBanVa(goc, doan({ dongDau: 1, dongCuoi: 1, thayThe: "A" })) as { ok: true; moi: string };
    expect(r.ok).toBe(true);
    expect(r.moi).toBe("A\n2\n3");
    expect(r.moi.endsWith("\n")).toBe(false);
  });

  it("★★ loai:\"toanVan\" ⇒ trả thẳng modified, không đụng gì khác", () => {
    const r = ghepBanVa("bất kỳ gì", { loai: "toanVan", path: "a.cs", modified: "NOI DUNG MOI" });
    expect(r).toEqual({ ok: true, moi: "NOI DUNG MOI" });
  });

  it("★★ thayThe RỖNG (xoá dòng) ⇒ hợp lệ, dòng bị xoá đúng", () => {
    const goc = "1\n2\n3\n4";
    const r = ghepBanVa(goc, doan({ dongDau: 2, dongCuoi: 2, thayThe: "" }));
    expect(r).toEqual({ ok: true, moi: "1\n\n3\n4" });
  });

  it("★ thay dòng ĐẦU (dongDau=1)", () => {
    const goc = "1\n2\n3";
    const r = ghepBanVa(goc, doan({ dongDau: 1, dongCuoi: 1, thayThe: "MOI" }));
    expect(r).toEqual({ ok: true, moi: "MOI\n2\n3" });
  });

  it("★ thay dòng CUỐI (dongCuoi = số dòng cuối cùng)", () => {
    const goc = "1\n2\n3";
    const r = ghepBanVa(goc, doan({ dongDau: 3, dongCuoi: 3, thayThe: "MOI" }));
    expect(r).toEqual({ ok: true, moi: "1\n2\nMOI" });
  });

  it("★ dongDau vượt số dòng của tệp ⇒ {ok:false}", () => {
    const goc = "1\n2";
    const r = ghepBanVa(goc, doan({ dongDau: 5, dongCuoi: 5, thayThe: "X" }));
    expect(r.ok).toBe(false);
  });
});
