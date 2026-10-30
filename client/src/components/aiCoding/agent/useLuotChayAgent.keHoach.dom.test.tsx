// @vitest-environment jsdom
//
// Đợt 11.3-C — hook: Duyệt/Bác kế hoạch gửi ĐÚNG băm hiển thị; thẻ đổi theo câu trả lời THẬT (không lạc quan); CONFLICT ⇒ "đã đổi" + nạp kế hoạch mới;
// DA_QUYET ⇒ hỏi lại sổ; lỗi trong thân ⇒ thẻ giữ "cho" kèm mã; ném lỗi mạng ⇒ giữ "cho"; keHoachDangCho lỗi ⇒ im lặng.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { SuKienAgent } from "@shared/agentCore/kieu";

const B1 = "d".repeat(64);
const B2 = "e".repeat(64);
const VIEC = [{ noiDung: "Sửa a.ts", trangThai: "cho" as const }];
const h = vi.hoisted(() => ({
  duyetKeHoach: vi.fn(),
  keHoachDangCho: vi.fn(),
  suKien: [] as unknown[],
}));
vi.mock("@/lib/agentApi", () => ({
  agentTrpc: { danhSach: vi.fn(async () => []), cuaToi: vi.fn(async () => []), duyetKeHoach: h.duyetKeHoach, keHoachDangCho: h.keHoachDangCho },
  huyLuotChay: vi.fn(),
  noiLaiLuotChay: vi.fn(),
  moLuotChay: vi.fn(async (_than: unknown, o: { onSuKien: (e: unknown) => void }) => {
    for (const e of h.suKien) o.onSuKien(e);
  }),
}));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: () => "Mất kết nối mạng" }));

import { useLuotChayAgent } from "./useLuotChayAgent";
import type { MucKeHoachDuyet } from "./trangThaiAgent";

const the = (r: { current: ReturnType<typeof useLuotChayAgent> }) =>
  r.current.trangThai.dongThoiGian.filter((m): m is MucKeHoachDuyet => m.kieu === "ke-hoach-duyet");

async function dung() {
  h.suKien = [{ loai: "bat-dau", runId: "r1", cheDo: "sua" }, { loai: "ke-hoach-cho-duyet", viec: VIEC, bam: B1 }] as SuKienAgent[];
  const { result } = renderHook(() => useLuotChayAgent({ projectId: "p1" }));
  await act(async () => {
    await result.current.gui("làm", "sua");
  });
  return result;
}

beforeEach(() => {
  h.duyetKeHoach.mockReset();
  h.keHoachDangCho.mockReset();
  h.keHoachDangCho.mockResolvedValue({ ok: false, ma: "LOI", bam: null, trangThai: null, viec: [] });
});
afterEach(cleanup);

describe("useLuotChayAgent — quyetKeHoach", () => {
  it("gửi runId + ĐÚNG băm đang hiển thị + quyết định; ok có trangThai ⇒ thẻ đổi theo máy chủ", async () => {
    h.duyetKeHoach.mockResolvedValue({ ok: true, ma: null, trangThai: "duyet", luc: "2026-10-31T01:00:00.000Z" });
    const r = await dung();
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(h.duyetKeHoach).toHaveBeenCalledWith("r1", B1, "duyet");
    expect(the(r)[0]).toMatchObject({ trangThai: "da-duyet", luc: "2026-10-31T01:00:00.000Z" });
  });

  it("★ KHÔNG lạc quan: khi chờ máy chủ thẻ ở 'dang-gui', chưa 'da-duyet'", async () => {
    let xong!: (v: unknown) => void;
    h.duyetKeHoach.mockReturnValue(new Promise((ok) => (xong = ok)));
    const r = await dung();
    let p!: Promise<void>;
    act(() => {
      p = r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(the(r)[0]!.trangThai).toBe("dang-gui");
    await act(async () => {
      xong({ ok: true, ma: null, trangThai: "bac", luc: null });
      await p;
    });
    expect(the(r)[0]!.trangThai).toBe("bac");
  });

  it("CONFLICT ⇒ thẻ cũ 'da-doi' và nạp kế hoạch mới từ keHoachDangCho (thẻ mới 'cho'); không đụng soSuKien", async () => {
    h.duyetKeHoach.mockResolvedValue({ ok: false, ma: "CONFLICT", trangThai: null, luc: null });
    h.keHoachDangCho.mockResolvedValue({ ok: true, ma: null, bam: B2, trangThai: "cho", viec: [{ noiDung: "Kế hoạch mới", trangThai: "cho" }] });
    const r = await dung();
    const so = r.current.trangThai.soSuKien;
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(the(r).map((m) => [m.bam, m.trangThai])).toEqual([[B1, "da-doi"], [B2, "cho"]]);
    expect(r.current.trangThai.soSuKien).toBe(so);
  });

  it("DA_QUYET ⇒ hỏi lại sổ và thẻ theo sổ (đã duyệt ở nơi khác)", async () => {
    h.duyetKeHoach.mockResolvedValue({ ok: false, ma: "DA_QUYET", trangThai: null, luc: null });
    h.keHoachDangCho.mockResolvedValue({ ok: true, ma: null, bam: B1, trangThai: "duyet", viec: VIEC });
    const r = await dung();
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "bac");
    });
    expect(h.duyetKeHoach).toHaveBeenCalledWith("r1", B1, "bac");
    expect(h.keHoachDangCho).toHaveBeenCalledWith("r1");
    expect(the(r)[0]!.trangThai).toBe("da-duyet");
  });

  it("lỗi trong thân (LOI_CSDL) ⇒ thẻ giữ 'cho' kèm mã; ném lỗi mạng ⇒ giữ 'cho' kèm chuỗi đã dịch", async () => {
    h.duyetKeHoach.mockResolvedValueOnce({ ok: false, ma: "LOI_CSDL", trangThai: null, luc: null });
    const r = await dung();
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(the(r)[0]).toMatchObject({ trangThai: "cho", maLoi: "LOI_CSDL" });
    h.duyetKeHoach.mockRejectedValueOnce(new Error("net"));
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(the(r)[0]).toMatchObject({ trangThai: "cho", maLoi: "Mất kết nối mạng" });
  });

  it("ok nhưng thiếu quyết định ⇒ KHÔNG tự coi là đã duyệt, hỏi lại sổ", async () => {
    h.duyetKeHoach.mockResolvedValue({ ok: true, ma: null, trangThai: null, luc: null });
    const r = await dung();
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(h.keHoachDangCho).toHaveBeenCalled();
    expect(the(r)[0]!.trangThai).toBe("dang-gui");
  });

  it("★ CONFLICT rồi keHoachDangCho NÉM (mất mạng) ⇒ thẻ vẫn da-doi, KHÔNG kẹt dang-gui (nút không khoá mãi)", async () => {
    h.duyetKeHoach.mockResolvedValue({ ok: false, ma: "CONFLICT", trangThai: null, luc: null });
    h.keHoachDangCho.mockRejectedValue(new Error("mạng"));
    const r = await dung();
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(the(r)[0]!.trangThai).toBe("da-doi");
  });

  it("★ thẻ đang dang-gui (hoặc đã quyết) ⇒ quyetKeHoach KHÔNG gọi mạng (giữ phím không gửi lặp)", async () => {
    let xong!: (v: unknown) => void;
    h.duyetKeHoach.mockReturnValue(new Promise((ok) => (xong = ok)));
    const r = await dung();
    const cu = the(r)[0]!;
    let p!: Promise<void>;
    act(() => {
      p = r.current.quyetKeHoach(cu, "duyet");
    });
    expect(the(r)[0]!.trangThai).toBe("dang-gui");
    await act(async () => {
      await r.current.quyetKeHoach(the(r)[0]!, "duyet");
    });
    expect(h.duyetKeHoach).toHaveBeenCalledTimes(1);
    await act(async () => {
      xong({ ok: true, ma: null, trangThai: "duyet", luc: null });
      await p;
    });
  });

  it("★ đổi lượt giữa lúc hỏi sổ ⇒ kết quả muộn KHÔNG áp lên trạng thái mới", async () => {
    h.suKien = [{ loai: "bat-dau", runId: "r1", cheDo: "sua" }, { loai: "ke-hoach-cho-duyet", viec: VIEC, bam: B1 }, { loai: "xong", lyDo: "hoan-thanh" }] as SuKienAgent[];
    const { result } = renderHook(() => useLuotChayAgent({ projectId: "p1" }));
    await act(async () => {
      await result.current.gui("làm", "sua");
    });
    let giai!: (v: unknown) => void;
    h.keHoachDangCho.mockReturnValue(new Promise((ok) => (giai = ok)));
    let p!: Promise<void>;
    act(() => {
      p = result.current.lamMoiKeHoach();
    });
    act(() => result.current.datLai());
    await act(async () => {
      giai({ ok: true, ma: null, bam: B2, trangThai: "cho", viec: VIEC });
      await p;
    });
    expect(result.current.trangThai.dongThoiGian.filter((m) => m.kieu === "ke-hoach-duyet")).toHaveLength(0);
  });

  it("thẻ không ở cho ⇒ không gửi gì; lamMoiKeHoach lỗi/ném ⇒ im lặng, thẻ giữ nguyên", async () => {
    const r = await dung();
    h.keHoachDangCho.mockRejectedValue(new Error("mạng"));
    await act(async () => {
      await r.current.lamMoiKeHoach();
    });
    expect(the(r)[0]!.trangThai).toBe("cho");
    await act(async () => {
      await r.current.quyetKeHoach({ ...the(r)[0]!, trangThai: "da-duyet" }, "duyet");
    });
    expect(h.duyetKeHoach).not.toHaveBeenCalled();
  });
});
