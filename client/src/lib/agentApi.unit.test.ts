/**
 * Đợt 1 · T5 — lớp mỏng API agent: bộ tách khung SSE + bóc phong bì sự kiện (thuần).
 */
import { describe, expect, it } from "vitest";
import { bocSuKien, taoBoTachSse, chuanHoaHoanTac, chuanHoaDanhSach } from "./agentApi";

describe("taoBoTachSse", () => {
  it("tách khung theo dòng trống, chịu mảnh cắt ngang khung + CRLF", () => {
    const ra: Array<{ data: string; id?: string }> = [];
    const tach = taoBoTachSse((k) => ra.push(k));
    tach.nap('data: {"loai":"chu","noiDung":"a"}\n\nda');
    tach.nap('ta: {"loai":"chu","noiDung":"b"}\r\n\r\n');
    tach.nap('id: 7\ndata: {"loai":"nghi","noiDung":"c"}\n\n: ping\n\n');
    tach.ket();
    expect(ra).toEqual([
      { data: '{"loai":"chu","noiDung":"a"}' },
      { data: '{"loai":"chu","noiDung":"b"}' },
      { data: '{"loai":"nghi","noiDung":"c"}', id: "7" },
    ]);
  });
  it("khung cuối không có dòng trống vẫn được phát khi kết thúc luồng", () => {
    const ra: Array<{ data: string }> = [];
    const tach = taoBoTachSse((k) => ra.push(k));
    tach.nap('data: {"loai":"xong","lyDo":"huy"}');
    tach.ket();
    expect(ra).toHaveLength(1);
  });
});

describe("bocSuKien", () => {
  it("sự kiện trần", () => {
    expect(bocSuKien('{"loai":"chu","noiDung":"x"}')).toEqual({ suKien: { loai: "chu", noiDung: "x" } });
  });
  it("phong bì {seq, suKien} / {n, e}", () => {
    expect(bocSuKien('{"seq":3,"suKien":{"loai":"chu","noiDung":"x"}}')).toEqual({ seq: 3, suKien: { loai: "chu", noiDung: "x" } });
    expect(bocSuKien('{"n":4,"e":{"loai":"nghi","noiDung":"y"}}')).toEqual({ seq: 4, suKien: { loai: "nghi", noiDung: "y" } });
  });
  it("[DONE] / JSON hỏng / không có `loai` ⇒ null", () => {
    expect(bocSuKien("[DONE]")).toBeNull();
    expect(bocSuKien("{hong")).toBeNull();
    expect(bocSuKien('{"type":"token"}')).toBeNull();
  });
});

describe("chuẩn hoá đầu ra tRPC (hợp đồng T4 chưa chốt)", () => {
  it("danhSach: mảng hoặc {runs}/{items}", () => {
    const r = { id: "a", trangThai: "dang-chay", projectId: "p" };
    expect(chuanHoaDanhSach([r])).toEqual([r]);
    expect(chuanHoaDanhSach({ runs: [r] })).toEqual([r]);
    expect(chuanHoaDanhSach({ items: [r] })).toEqual([r]);
    expect(chuanHoaDanhSach(null)).toEqual([]);
  });
  it("hoanTac: khoiPhuc/xungDot với tên khác", () => {
    expect(chuanHoaHoanTac({ khoiPhuc: ["a.ts"], xungDot: [{ duong: "b.ts", lyDo: "đã sửa tiếp" }] })).toEqual({
      khoiPhuc: ["a.ts"],
      xungDot: [{ duong: "b.ts", lyDo: "đã sửa tiếp" }],
    });
    expect(chuanHoaHoanTac({ daKhoiPhuc: [{ duong: "a.ts" }], conflicts: ["c.ts"] })).toEqual({
      khoiPhuc: ["a.ts"],
      xungDot: [{ duong: "c.ts" }],
    });
    expect(chuanHoaHoanTac(undefined)).toEqual({ khoiPhuc: [], xungDot: [] });
  });
});
