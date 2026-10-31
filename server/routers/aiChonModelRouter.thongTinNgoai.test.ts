/**
 * ★ Đợt 10.4b L0a' — `aiChonModel.thongTinNgoai` (hợp đồng shared/ai/sinhChuNgoai.ts) qua caller tRPC thật, cổng giấy phép tắt Ở ĐÂY.
 * Chỉ thông tin: không giữ chỗ / không gọi mạng; mức theo bề mặt (chat = van-hanh); quyền tối thiểu Q2b; bề mặt chưa mở ⇒ như không tồn tại.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

const h = vi.hoisted(() => ({
  factoryIds: [5] as number[] | null,
  beMat: ["luong", "kiem-dinh", "chat"] as string[],
  kiem: [] as unknown[],
  kiemTruoc: null as null | (() => Promise<unknown>),
  dem: [] as Array<{ khoa: string; tokenGiu: number; tienGiuUsd: number }>,
  choVanHanh: false,
}));

vi.mock("../db/reportAggregators", () => ({ resolveTenantFactoryScope: vi.fn(async () => ({ factoryIds: h.factoryIds, labels: {} })) }));
vi.mock("../services/ai/chonModel/kieu", async (io) => {
  const goc = await io<typeof import("../services/ai/chonModel/kieu")>();
  return {
    ...goc,
    get BE_MAT_NGOAI_DUOC_DUNG() {
      return h.beMat;
    },
  };
});
vi.mock("../services/ai/ngoai/cauHinhNgoai", async (io) => ({
  ...(await io<typeof import("../services/ai/ngoai/cauHinhNgoai")>()),
  layCauHinhNhaMay: async () => ({ choDuLieuVanHanh: h.choVanHanh }),
}));
vi.mock("../services/ai/ngoai/congNgoai", async (io) => {
  const goc = await io<typeof import("../services/ai/ngoai/congNgoai")>();
  const db = { execute: async () => h.dem, transaction: async () => undefined };
  return {
    ...goc,
    phuThuocMacDinh: { ...goc.phuThuocMacDinh, db: async () => db },
    kiemTruocNgoai: async (yc: unknown) => {
      h.kiem.push(yc);
      if (h.kiemTruoc) return h.kiemTruoc();
      const cfg = { factoryId: 5, batNgoai: true, choDuLieuVanHanh: true, luuNguyenVan: false, hanGiuNgay: 30, tranTokenNgay: 100_000, tranTienNgayUsd: 2, tranTokenNguoiNgay: null, tranTokenLuongNgay: null, tranTokenLuot: null, tranLanPhut: 100 };
      return { db, cfg, tran: cfg, model: { model: "claude-x", giaVaoUsdTrieu: 3, giaRaUsdTrieu: 15 }, maxTokens: 4000, tinhTran: 5 };
    },
  };
});

import { aiChonModelRouter } from "./aiChonModelRouter";
import { LoiNgoai } from "../services/ai/ngoai/loi";
import { mucCuaGhep } from "../services/ai/ngoai/ghepPhan";

const goi = (role = "user") => aiChonModelRouter.createCaller({ user: { id: 7, role, name: "u" } } as never);
const IN = { chonModel: "ngoai:anthropic:claude-x", beMat: "chat" as const };

beforeEach(() => {
  h.factoryIds = [5];
  h.beMat = ["luong", "kiem-dinh", "chat"];
  h.kiem = [];
  h.kiemTruoc = null;
  h.dem = [{ khoa: "nha-may", tokenGiu: 100, tienGiuUsd: 0.5 }];
  h.choVanHanh = false;
});

describe("aiChonModel.thongTinNgoai", () => {
  it("được phép: hình dạng hợp đồng; chat ⇒ mucDuLieu van-hanh; người thường KHÔNG thấy số nhà máy; yêu cầu kiểm qua bộ dựng mang mức van-hanh", async () => {
    const r = await goi().thongTinNgoai(IN);
    expect(r).toMatchObject({ nhaCungCap: "anthropic", model: "claude-x", duocPhep: true, mucDuLieu: "van-hanh", choDuLieuVanHanh: true, dinhKemBiCam: true });
    expect(r).not.toHaveProperty("lyDo");
    expect(r.conLaiTranNgay.nhaMay).toEqual({ duTranChoLuotNay: true });
    const yc = h.kiem[0] as { tinNhan: unknown; ngu: { nguonMuc: unknown; nhaMayChuDuLieu: unknown } };
    expect(mucCuaGhep(yc.tinNhan)).toBe("van-hanh");
    expect(yc.ngu).toMatchObject({ nhaMayChuDuLieu: [5], nguonMuc: { loai: "be-mat", beMat: "chat", phanDaGhep: ["van-hanh"] } });
  });

  it("admin thấy số nhà máy; coding ⇒ ky-thuat", async () => {
    const r = await goi("admin").thongTinNgoai({ ...IN, beMat: "coding" as never });
    // coding chưa mở trong danh sách giả ⇒ không tồn tại; mở rồi đo lại
    expect(r).toMatchObject({ duocPhep: false, lyDo: "NGOAI_KHONG_TON_TAI" });
    h.beMat = ["chat", "coding"];
    const r2 = await goi("admin").thongTinNgoai({ ...IN, beMat: "coding" as never });
    expect(r2).toMatchObject({ duocPhep: true, mucDuLieu: "ky-thuat" });
    expect(r2.conLaiTranNgay.nhaMay).toHaveProperty("token");
  });

  it("cổng từ chối van-hanh ⇒ duocPhep false + lyDo + choDuLieuVanHanh đọc từ cấu hình (hộp đồng ý nói đúng)", async () => {
    h.kiemTruoc = async () => Promise.reject(new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH"));
    const r = await goi().thongTinNgoai(IN);
    expect(r).toMatchObject({ duocPhep: false, lyDo: "NGOAI_DU_LIEU_VAN_HANH", choDuLieuVanHanh: false });
  });

  it("vượt trần ngày nhà máy ⇒ NGOAI_VUOT_TRAN + tranVuot 'nha-may' + duTranChoLuotNay false", async () => {
    h.dem = [{ khoa: "nha-may", tokenGiu: 99_000, tienGiuUsd: 0 }];
    const r = await goi().thongTinNgoai(IN);
    expect(r).toMatchObject({ duocPhep: false, lyDo: "NGOAI_VUOT_TRAN", tranVuot: "nha-may", conLaiTranNgay: { nhaMay: { duTranChoLuotNay: false } } });
  });

  it("bề mặt chưa mở / không đúng MỘT nhà máy ⇒ NGOAI_KHONG_TON_TAI, KHÔNG gọi kiemTruoc; input strict", async () => {
    h.beMat = ["luong", "kiem-dinh"];
    expect(await goi().thongTinNgoai(IN)).toMatchObject({ duocPhep: false, lyDo: "NGOAI_KHONG_TON_TAI" });
    h.beMat = ["chat"];
    h.factoryIds = [5, 6];
    expect(await goi().thongTinNgoai(IN)).toMatchObject({ duocPhep: false, lyDo: "NGOAI_KHONG_TON_TAI" });
    expect(h.kiem).toHaveLength(0);
    await expect(goi().thongTinNgoai({ ...IN, mucDuLieu: "ky-thuat" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
