/** Đợt 10.4b-E — một lượt Hỏi bằng model ngoài, phụ thuộc tiêm: 428 → hỏi 1 lần → gửi lại; nguồn; lỗi; không rò ngữ cảnh. */
import { describe, expect, it, vi } from "vitest";
import { LoiHttp } from "../loi/loiHttp";
import { chayHoiNgoai, type PhuThuocHoiNgoai } from "./hoiNgoai";

const loi428 = () => new LoiHttp(428, "x", { success: false, code: "CAN_XAC_NHAN_VAN_HANH", muc: "van-hanh" });

function dung(o: { buoc?: Array<Array<Record<string, unknown>> | Error>; dongY?: boolean; daDongY?: boolean } = {}) {
  const bodies: Array<{ context: Record<string, unknown> }> = [];
  const gui: Array<Record<string, unknown>> = [];
  let da = o.daDongY === true;
  const buoc = [...(o.buoc ?? [[{ type: "done" }]])];
  const hoiDongY = vi.fn(async () => o.dongY !== false);
  const ghiDongY = vi.fn(() => {
    da = true;
  });
  const pt: PhuThuocHoiNgoai = {
    cauHoi: "Q",
    lichSu: [],
    ngonNgu: "vi",
    chonModel: "ngoai:p:m",
    signal: new AbortController().signal,
    layIdHoiThoai: async () => 42,
    daDongY: () => da,
    ghiDongY,
    hoiDongY,
    gui: (m) => gui.push(m),
    moDong: async ({ than, nhan }) => {
      bodies.push(than as never);
      const b = buoc.shift()!;
      if (b instanceof Error) throw b;
      for (const sk of b) nhan(sk);
      return { hong: [] };
    },
  };
  return { pt, bodies, gui, hoiDongY, ghiDongY };
}

describe("chayHoiNgoai", () => {
  it("lượt thường: meta → nguồn gửi webview; token làm sạch; done.vet; gửi ĐÚNG hội thoại máy chủ", async () => {
    const d = dung({ buoc: [[{ type: "meta", ngoai: { nhaCungCap: "p", model: "m" } }, { type: "token", token: "xin‮ chào" }, { type: "done", vet: { nhaCungCap: "p", model: "m", tokenVao: 1, tokenRa: 2, chiPhiUocUsd: 0.01, callId: 5 } }]] });
    const kq = await chayHoiNgoai(d.pt);
    expect(kq).toMatchObject({ loai: "xong", traLoi: "xin chào", canhBao: null, ngoai: { nhaCungCap: "p", model: "m" }, vet: { tokenVao: 1, tokenRa: 2 } });
    expect(d.gui).toContainEqual({ loai: "nguon_ngoai", nhaCungCap: "p", model: "m" });
    expect(d.gui).toContainEqual({ loai: "token", chu: "xin chào" });
    expect(d.bodies[0]!.context.conversationId).toBe(42);
    expect("xacNhanVanHanh" in d.bodies[0]!.context).toBe(false);
    expect(d.hoiDongY).not.toHaveBeenCalled();
  });

  it("★★★ 428 lần đầu → hỏi đồng ý ĐÚNG MỘT lần → gửi lại với xacNhanVanHanh:true", async () => {
    const d = dung({ buoc: [loi428(), [{ type: "token", token: "ok" }, { type: "done" }]] });
    const kq = await chayHoiNgoai(d.pt);
    expect(kq.loai).toBe("xong");
    expect(d.hoiDongY).toHaveBeenCalledTimes(1);
    expect(d.ghiDongY).toHaveBeenCalledTimes(1);
    expect(d.bodies).toHaveLength(2);
    expect("xacNhanVanHanh" in d.bodies[0]!.context).toBe(false);
    expect(d.bodies[1]!.context.xacNhanVanHanh).toBe(true);
  });

  it("★ đã đồng ý trong phiên ⇒ gửi cờ ngay, KHÔNG hỏi lại", async () => {
    const d = dung({ daDongY: true });
    await chayHoiNgoai(d.pt);
    expect(d.bodies[0]!.context.xacNhanVanHanh).toBe(true);
    expect(d.hoiDongY).not.toHaveBeenCalled();
  });

  it("★★★ từ chối đồng ý ⇒ KHÔNG gửi lại, không ghi đồng ý", async () => {
    const d = dung({ buoc: [loi428()], dongY: false });
    expect(await chayHoiNgoai(d.pt)).toEqual({ loai: "tu-choi-dong-y" });
    expect(d.bodies).toHaveLength(1);
    expect(d.ghiDongY).not.toHaveBeenCalled();
  });

  it("428 lần hai (đã đồng ý mà máy chủ vẫn đòi) ⇒ lỗi, không lặp vô hạn", async () => {
    const d = dung({ buoc: [loi428(), loi428()] });
    const kq = await chayHoiNgoai(d.pt);
    expect(kq.loai).toBe("loi");
    expect(d.bodies).toHaveLength(2);
    expect(d.hoiDongY).toHaveBeenCalledTimes(1);
  });

  it("lỗi NGOAI_* trước SSE ⇒ câu thân thiện theo mã/trần", async () => {
    const d = dung({ buoc: [new LoiHttp(429, "x", { code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi" })] });
    const kq = await chayHoiNgoai(d.pt);
    expect(kq).toMatchObject({ loai: "loi" });
    expect((kq as { thongDiep: string }).thongDiep).toContain("trần trong ngày của bạn");
  });

  it("lỗi trong SSE (error.code) ⇒ loi theo mã", async () => {
    const d = dung({ buoc: [[{ type: "error", error: "NGOAI_TAT", code: "NGOAI_TAT" }]] });
    const kq = await chayHoiNgoai(d.pt);
    expect((kq as { thongDiep: string }).thongDiep).toContain("đang tắt");
  });

  it("★ lỗi KHÔNG phải model ngoài (401, mạng) ⇒ ném lên cho nhánh chung", async () => {
    const e401 = new LoiHttp(401, "het han", { code: "UNAUTHORIZED" });
    await expect(chayHoiNgoai(dung({ buoc: [e401] }).pt)).rejects.toBe(e401);
    const mang = new TypeError("fetch failed");
    await expect(chayHoiNgoai(dung({ buoc: [mang] }).pt)).rejects.toBe(mang);
  });

  it("không có done ⇒ cảnh báo CẮT NGANG, vẫn trả chữ đã nhận", async () => {
    const d = dung({ buoc: [[{ type: "token", token: "dở" }]] });
    const kq = await chayHoiNgoai(d.pt);
    expect(kq).toMatchObject({ loai: "xong", traLoi: "dở" });
    expect((kq as { canhBao: string }).canhBao).toContain("CẮT NGANG");
  });

  it("meta sai hình dạng ⇒ bỏ qua, không gửi nguồn giả", async () => {
    const d = dung({ buoc: [[{ type: "meta", ngoai: { nhaCungCap: 5 } }, { type: "done" }]] });
    const kq = await chayHoiNgoai(d.pt);
    expect(kq).toMatchObject({ loai: "xong", ngoai: null });
    expect(d.gui.some((m) => m.loai === "nguon_ngoai")).toBe(false);
  });
});
