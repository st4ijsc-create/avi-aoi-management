/**
 * ★ Đợt 10.4 (T1a/T1b) — `aiKiemDinh.{xemTruoc, chay}` qua caller tRPC thật (giấy phép tắt), phụ thuộc giả: input strict (không văn bản /
 * mức / nhà máy / công cụ), đúng MỘT nhà máy, nguồn của chủ, yêu cầu cổng mang mức do MÁY CHỦ suy + nhà máy người gọi; xem trước KHÔNG gọi;
 * chống lặp 409 / bộ nhớ 120 s không tính phí; lỗi cổng ⇒ mã tRPC đúng + reason.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterEach, describe, expect, it } from "vitest";
import { aiKiemDinhRouter, __datPhuThuocKiemDinhChoTest } from "./aiKiemDinhRouter";
import { readAppErrorMeta } from "../_core/appError";
import { LoiNgoai } from "../services/ai/ngoai/loi";
import type { YeuCauGoiNgoai } from "../services/ai/ngoai/congNgoai";

const HOP_LE = JSON.stringify({ ketLuan: "can-sua", diem: 55, loi: [{ muc: "vua", moTa: "thiếu kiểm null" }], baiHocDeXuat: [] });
const goi = (role = "user") => aiKiemDinhRouter.createCaller({ user: { id: 7, role, name: "u" } } as never);
const RUN = "3f2b8c1e-1d2a-4c3b-9a8e-1234567890ab";
const INPUT = { chonModel: "ngoai:anthropic:claude-thu", nguon: { loai: "agent" as const, runId: RUN }, tieuChi: "an toàn" };

function dat(o: { nhaMay?: number[] | null; nguon?: unknown; traVe?: Array<string | Error>; cho?: Promise<void>; kiemTruoc?: () => Promise<unknown> } = {}) {
  const nhan: YeuCauGoiNgoai[] = [];
  const kiem: YeuCauGoiNgoai[] = [];
  const traVe = o.traVe ?? [HOP_LE];
  __datPhuThuocKiemDinhChoTest({
    nhaMayCua: async () => (o.nhaMay === undefined ? [5] : o.nhaMay),
    docNguon: async () => (o.nguon === undefined ? { cauHoi: "hỏi", traLoi: "đáp", muc: "ky-thuat", beMat: "agent-turn" } : (o.nguon as never)),
    goi: async (yc) => {
      nhan.push(yc);
      if (o.cho) await o.cho;
      const r = traVe.shift() ?? HOP_LE;
      if (r instanceof Error) throw r;
      return { noiDung: r, toolCalls: [], khongTinCay: true, tokenVao: 10, tokenRa: 20, chiPhiUocUsd: 0.001, callId: 77 };
    },
    kiemTruoc: (async (yc: YeuCauGoiNgoai) => {
      kiem.push(yc);
      if (o.kiemTruoc) return o.kiemTruoc();
      return {
        db: { execute: async () => [{ khoa: "nha-may", tokenGiu: 100, tienGiuUsd: 0.5 }] },
        cfg: { tranTokenNgay: 1000, tranTienNgayUsd: 2, tranTokenNguoiNgay: null },
        model: { giaVaoUsdTrieu: 3, giaRaUsdTrieu: 15 },
        maxTokens: 4000,
      };
    }) as never,
  });
  return { nhan, kiem };
}
afterEach(() => __datPhuThuocKiemDinhChoTest(null));

const loi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const m = readAppErrorMeta(e) as { appParams?: { reason?: string } } | null;
    return `${(e as { code?: string }).code}:${m?.appParams?.reason ?? ""}`;
  }
};

describe("input strict", () => {
  it("khoá lạ / nguồn van-ban / văn bản / mức / nhà máy / congCu ⇒ BAD_REQUEST; chonModel không phải ngoai ⇒ BAD_REQUEST", async () => {
    dat();
    for (const bad of [
      { ...INPUT, mucDuLieu: "ky-thuat" },
      { ...INPUT, factoryId: 5 },
      { ...INPUT, congCu: [] },
      { ...INPUT, nguon: { loai: "van-ban", cauHoi: "x", traLoi: "y" } },
      { ...INPUT, nguon: { loai: "agent", runId: RUN, traLoi: "chèn" } },
      { ...INPUT, chonModel: "vai-tro:chat" },
      { ...INPUT, chonModel: "auto" },
    ]) {
      expect(await loi(goi().chay(bad as never)), JSON.stringify(bad)).toMatch(/^BAD_REQUEST/);
    }
  });
});

describe("chay", () => {
  it("yêu cầu cổng: nhà máy người gọi (đúng MỘT) là chủ dữ liệu, mức do MÁY CHỦ suy, bề mặt theo nguồn, không công cụ; trả ketQua + vet + callId", async () => {
    const { nhan } = dat({ nguon: { cauHoi: "hỏi", traLoi: "đáp", muc: "van-hanh", beMat: "coding" } });
    const kq = await goi().chay(INPUT);
    expect(kq).toMatchObject({ ketQua: { ketLuan: "can-sua", diem: 55 }, vet: { nhaCungCap: "anthropic", model: "claude-thu", soLanGoi: 1, chiPhiUocUsd: 0.001 }, callId: 77 });
    expect(nhan).toHaveLength(1);
    expect(nhan[0]).not.toHaveProperty("congCu");
    expect(nhan[0]!.ngu).toEqual({ userId: 7, flowId: null, runId: null, tuDong: false, nhaMayNguoiGoi: [5], nhaMayChuDuLieu: [5], nguonMuc: { loai: "be-mat", beMat: "coding", phanDaGhep: ["van-hanh"] } });
    expect(nhan[0]!.tinNhan[1]!.noiDung).toContain("đáp");
  });

  it("không nhà máy / NHIỀU nhà máy / nguồn không có (không phải chủ) ⇒ NOT_FOUND, cổng KHÔNG được gọi; trả lời rỗng ⇒ BAD_REQUEST", async () => {
    for (const o of [{ nhaMay: null }, { nhaMay: [] }, { nhaMay: [5, 6] }, { nguon: null }]) {
      const { nhan } = dat(o as never);
      expect(await loi(goi().chay(INPUT)), JSON.stringify(o)).toBe("NOT_FOUND:kiem-dinh-khong-co-nguon");
      expect(nhan).toHaveLength(0);
    }
    dat({ nguon: { cauHoi: "q", traLoi: "  ", muc: "ky-thuat", beMat: "chat" } });
    expect(await loi(goi().chay(INPUT))).toBe("BAD_REQUEST:kiem-dinh-tra-loi-rong");
  });

  it("lỗi cổng ⇒ mã tRPC đúng + reason; sai định dạng 2 lần ⇒ BAD_GATEWAY NGOAI_SAI_SCHEMA; lỗi KHÔNG vào bộ nhớ (gọi lại được)", async () => {
    dat({ traVe: [new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH")] });
    expect(await loi(goi().chay(INPUT))).toBe("FORBIDDEN:NGOAI_DU_LIEU_VAN_HANH");
    expect(await goi().chay(INPUT)).toMatchObject({ ketQua: { diem: 55 } });
    dat({ traVe: ["rác", "rác"] });
    expect(await loi(goi().chay(INPUT))).toBe("BAD_GATEWAY:NGOAI_SAI_SCHEMA");
    dat({ traVe: [new LoiNgoai("NGOAI_VUOT_TRAN")] });
    expect(await loi(goi().chay(INPUT))).toBe("TOO_MANY_REQUESTS:NGOAI_VUOT_TRAN");
  });

  it("chống lặp: cùng khoá đang chạy ⇒ CONFLICT NGOAI_DANG_CHAY; xong ⇒ lần sau trả bộ nhớ (tuBoNho, KHÔNG gọi lại); khác tiêu chí ⇒ gọi mới", async () => {
    let mo!: () => void;
    const cho = new Promise<void>((r) => (mo = r));
    const { nhan } = dat({ cho });
    const p1 = goi().chay(INPUT);
    await new Promise((r) => setTimeout(r, 20));
    expect(await loi(goi().chay(INPUT))).toBe("CONFLICT:NGOAI_DANG_CHAY");
    mo();
    await p1;
    const lan2 = await goi().chay(INPUT);
    expect(lan2).toMatchObject({ tuBoNho: true, ketQua: { diem: 55 } });
    expect(nhan).toHaveLength(1);
    await goi().chay({ ...INPUT, tieuChi: "khác" });
    expect(nhan).toHaveLength(2);
  });

  it("rà kiem-dinh R5 — bộ nhớ 120 s: nhà máy vừa tắt AI ngoài / gỡ model (kiemTruoc từ chối) ⇒ lỗi, KHÔNG trả kết quả cũ", async () => {
    let tuChoi = false;
    const { nhan } = dat({ kiemTruoc: async () => (tuChoi ? Promise.reject(new LoiNgoai("NGOAI_KHONG_TON_TAI")) : ({ db: { execute: async () => [] }, cfg: {}, model: {}, maxTokens: 1 } as never)) });
    await goi().chay(INPUT);
    tuChoi = true;
    expect(await loi(goi().chay(INPUT))).toBe("NOT_FOUND:NGOAI_KHONG_TON_TAI");
    expect(nhan).toHaveLength(1);
  });

  it("rà kiem-dinh R6 — khoá chống lặp gồm NGƯỜI GỌI: người khác cùng ID nguồn (giả định nguồn đọc được) KHÔNG nhận bộ nhớ của người kia", async () => {
    const { nhan } = dat();
    await goi().chay(INPUT);
    const nguoiKhac = aiKiemDinhRouter.createCaller({ user: { id: 8, role: "user", name: "v" } } as never);
    const kq = await nguoiKhac.chay(INPUT);
    expect(kq).not.toHaveProperty("tuBoNho");
    expect(nhan).toHaveLength(2);
  });

  it("rà kiem-dinh T1 — bộ nhớ 120 s KHÔNG vượt quyền: người đã rời nhà máy / nhà máy vừa tắt ngoài ⇒ lỗi, không nhận kết quả cũ", async () => {
    const { nhan } = dat();
    await goi().chay(INPUT);
    dat({ nhaMay: [5, 6] }); // __dat… xoá bộ nhớ ⇒ dựng lại bộ nhớ có kết quả rồi đổi phạm vi
    const r = aiKiemDinhRouter.createCaller({ user: { id: 7, role: "user", name: "u" } } as never);
    expect(await loi(r.chay(INPUT))).toBe("NOT_FOUND:kiem-dinh-khong-co-nguon");
    expect(nhan).toHaveLength(1);
  });
});

describe("xemTruoc", () => {
  it("được phép: mức máy chủ suy, token ước (bi quan) + chi phí ước + trần ngày còn lại; KHÔNG gọi nhà cung cấp", async () => {
    const { nhan, kiem } = dat({ nguon: { cauHoi: "hỏi", traLoi: "đáp", muc: "van-hanh", beMat: "chat" } });
    const r = await goi().xemTruoc(INPUT);
    expect(r).toMatchObject({ duocPhep: true, mucDuLieu: "van-hanh", nhaCungCap: "anthropic", model: "claude-thu", dinhKemBiCam: true, tranByte: 1024 * 1024 });
    expect(r.tokenUoc).toBeGreaterThan(4000);
    expect(r.chiPhiUocUsd).toBeGreaterThan(0.06);
    expect(r.kichThuocByte).toBeGreaterThan(100);
    expect(r.conLaiTranNgay).toEqual({ nhaMay: { token: 900, usd: 1.5 }, nguoi: { token: null } });
    expect(kiem).toHaveLength(1);
    expect(nhan).toHaveLength(0);
  });

  it("cổng từ chối ở bước kiểm (vd dữ liệu vận hành chưa cho) ⇒ duocPhep false + lyDo, không ném", async () => {
    dat({ kiemTruoc: async () => Promise.reject(new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH")) });
    expect(await goi().xemTruoc(INPUT)).toMatchObject({ duocPhep: false, lyDo: "NGOAI_DU_LIEU_VAN_HANH", chiPhiUocUsd: null });
  });
});
