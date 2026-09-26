import { describe, it, expect } from "vitest";
import {
  vanTayCauHinh,
  chuanHoaKhoTrangThaiMcpNgoai,
  daDuocDuyet,
  biTat,
  ghiDaDuyet,
  datTat,
} from "./mcpDuyet";
import type { CauHinhMcpServer } from "./mcpCauHinh";

const CFG: CauHinhMcpServer = { ten: "demo", lenh: "npx", doi: ["-y", "some-mcp"], thuMuc: "d:/x", moi: { A: "1" } };

describe("chuanHoaKhoTrangThaiMcpNgoai", () => {
  it("★★★ rỗng/hỏng ⇒ object rỗng, KHÔNG đoán", () => {
    expect(chuanHoaKhoTrangThaiMcpNgoai(undefined)).toEqual({});
    expect(chuanHoaKhoTrangThaiMcpNgoai(null)).toEqual({});
    expect(chuanHoaKhoTrangThaiMcpNgoai("chuoi-la")).toEqual({});
    expect(chuanHoaKhoTrangThaiMcpNgoai([1, 2])).toEqual({});
    expect(chuanHoaKhoTrangThaiMcpNgoai(42)).toEqual({});
  });

  it("★★ mục hợp lệ được giữ, mục hỏng bị loại", () => {
    const r = chuanHoaKhoTrangThaiMcpNgoai({ a: { daDuyetVanTay: "x", tat: true }, b: "hong", c: { daDuyetVanTay: 5 } });
    expect(r.a).toEqual({ daDuyetVanTay: "x", tat: true });
    expect(r.b).toBeUndefined();
    expect(r.c).toEqual({ daDuyetVanTay: undefined, tat: false });
  });
});

describe("daDuocDuyet / vanTayCauHinh", () => {
  it("★★★ chưa từng duyệt (kho rỗng) ⇒ false", () => {
    expect(daDuocDuyet({}, CFG)).toBe(false);
  });

  it("★★★ đã duyệt ĐÚNG cấu hình này ⇒ true", () => {
    const kho = ghiDaDuyet({}, CFG);
    expect(daDuocDuyet(kho, CFG)).toBe(true);
  });

  it("★★★ CẤU HÌNH ĐỔI (command/args/cwd) SAU KHI ĐÃ DUYỆT ⇒ vân tay lệch, coi như CHƯA duyệt (phải hỏi lại)", () => {
    const kho = ghiDaDuyet({}, CFG);
    const cfgDoiLenh = { ...CFG, lenh: "python" };
    const cfgDoiArgs = { ...CFG, doi: ["--khac"] };
    const cfgDoiCwd = { ...CFG, thuMuc: "e:/khac" };
    expect(daDuocDuyet(kho, cfgDoiLenh)).toBe(false);
    expect(daDuocDuyet(kho, cfgDoiArgs)).toBe(false);
    expect(daDuocDuyet(kho, cfgDoiCwd)).toBe(false);
  });

  it("★★ XOAY VÒNG GIÁ TRỊ env (không đổi tên khoá) ⇒ vân tay KHÔNG đổi — không hỏi lại", () => {
    const kho = ghiDaDuyet({}, CFG);
    const cfgDoiGiaTriEnv = { ...CFG, moi: { A: "giá-trị-mới-hoàn-toàn" } };
    expect(daDuocDuyet(kho, cfgDoiGiaTriEnv)).toBe(true);
  });

  it("★★ đổi TÊN KHOÁ env ⇒ vân tay đổi (đây là đổi cấu trúc, không phải xoay vòng giá trị)", () => {
    const kho = ghiDaDuyet({}, CFG);
    const cfgDoiTenKhoaEnv = { ...CFG, moi: { B: "1" } };
    expect(daDuocDuyet(kho, cfgDoiTenKhoaEnv)).toBe(false);
  });

  it("★★ hai server KHÁC TÊN không chia sẻ vân tay duyệt của nhau", () => {
    const kho = ghiDaDuyet({}, CFG);
    const cfgKhacTen = { ...CFG, ten: "khac" };
    expect(daDuocDuyet(kho, cfgKhacTen)).toBe(false);
  });

  it("★★ vanTayCauHinh là hàm THUẦN, ổn định (cùng đầu vào ⇒ cùng đầu ra)", () => {
    expect(vanTayCauHinh(CFG)).toBe(vanTayCauHinh({ ...CFG }));
  });
});

describe("biTat / datTat", () => {
  it("★★ mặc định chưa tắt", () => {
    expect(biTat({}, "demo")).toBe(false);
  });

  it("★★★ datTat KHÔNG đụng cờ đã-duyệt (hai khái niệm tách bạch)", () => {
    const daDuyet = ghiDaDuyet({}, CFG);
    const daTat = datTat(daDuyet, "demo", true);
    expect(biTat(daTat, "demo")).toBe(true);
    expect(daDuocDuyet(daTat, CFG)).toBe(true);
  });

  it("★★ bật lại (tat:false) sau khi đã tắt", () => {
    const daTat = datTat({}, "demo", true);
    const daBat = datTat(daTat, "demo", false);
    expect(biTat(daBat, "demo")).toBe(false);
  });

  it("★★ ghiDaDuyet/datTat KHÔNG đổi object đầu vào tại chỗ (thuần)", () => {
    const kho = {};
    const kho2 = ghiDaDuyet(kho, CFG);
    expect(kho).toEqual({});
    expect(kho2).not.toBe(kho);
  });
});
