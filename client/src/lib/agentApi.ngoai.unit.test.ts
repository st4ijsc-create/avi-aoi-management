// Đợt 10.4b L4 — `moLuotChay`: lỗi TRƯỚC SSE của lượt model ngoài thành lỗi có kiểu (hook phân biệt 428); lỗi khác giữ đường cũ;
// thân yêu cầu mang `xacNhanVanHanh` NGUYÊN VĂN khi hook đặt, và KHÔNG có trường khi không đặt.
import { afterEach, describe, expect, it, vi } from "vitest";
import { moLuotChay } from "./agentApi";
import { LoiSinhChuNgoai } from "./loiNgoai";

const phanHoi = (status: number, body: unknown) => ({ ok: false, status, body: null, json: async () => body }) as unknown as Response;
const goi = () => moLuotChay({ cauHoi: "q", projectId: "p", cheDo: "hoi", chonModel: "ngoai:openai:m" }, { signal: new AbortController().signal, onSuKien: () => undefined });
afterEach(() => vi.unstubAllGlobals());

describe("moLuotChay — lỗi trước SSE", () => {
  it("428 CAN_XAC_NHAN_VAN_HANH ⇒ LoiSinhChuNgoai canXacNhanVanHanh, mang muc", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => phanHoi(428, { success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" })));
    const e = await goi().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LoiSinhChuNgoai);
    expect((e as LoiSinhChuNgoai).canXacNhanVanHanh).toBe(true);
    expect((e as LoiSinhChuNgoai).status).toBe(428);
    expect((e as LoiSinhChuNgoai).muc).toBe("van-hanh");
  });
  it("429 NGOAI_VUOT_TRAN ⇒ mang tranVuot; 400 NGOAI_CHI_HOI ⇒ có kiểu, KHÔNG phải 428", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => phanHoi(429, { success: false, code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi" })));
    const a = (await goi().catch((x: unknown) => x)) as LoiSinhChuNgoai;
    expect([a.code, a.tranVuot, a.canXacNhanVanHanh]).toEqual(["NGOAI_VUOT_TRAN", "nguoi", false]);
    vi.stubGlobal("fetch", vi.fn(async () => phanHoi(400, { success: false, code: "NGOAI_CHI_HOI" })));
    const b = (await goi().catch((x: unknown) => x)) as LoiSinhChuNgoai;
    expect([b.code, b.canXacNhanVanHanh]).toEqual(["NGOAI_CHI_HOI", false]);
  });
  it("404 CHON_MODEL_KHONG_CO (không thuộc đường ngoài) ⇒ lỗi thường, KHÔNG LoiSinhChuNgoai", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => phanHoi(404, { success: false, code: "CHON_MODEL_KHONG_CO" })));
    const e = await goi().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(LoiSinhChuNgoai);
  });
  it("thân không phải JSON / mã lạ ⇒ lỗi thường", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, body: null, json: async () => { throw new Error("x"); } }) as unknown as Response));
    expect(await goi().catch((x: unknown) => x)).not.toBeInstanceOf(LoiSinhChuNgoai);
  });
});

describe("moLuotChay — thân yêu cầu", () => {
  it("xacNhanVanHanh:true đi NGUYÊN VĂN; vắng ⇒ không có trường", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    const o = { signal: new AbortController().signal, onSuKien: () => undefined };
    await moLuotChay({ cauHoi: "q", projectId: "p", cheDo: "hoi", chonModel: "ngoai:openai:m", xacNhanVanHanh: true }, o);
    await moLuotChay({ cauHoi: "q", projectId: "p", cheDo: "hoi", chonModel: "ngoai:openai:m" }, o);
    const thans = f.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));
    expect(thans[0].xacNhanVanHanh).toBe(true);
    expect("xacNhanVanHanh" in thans[1]).toBe(false);
  });
});
