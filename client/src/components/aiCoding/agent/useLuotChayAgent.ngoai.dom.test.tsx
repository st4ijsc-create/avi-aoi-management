// @vitest-environment jsdom
//
// Đợt 10.4b L4 — luồng 428 `CAN_XAC_NHAN_VAN_HANH` của lượt agent model NGOÀI trong hook:
//   • hỏi MỘT lần; đồng ý ⇒ gửi lại ĐÚNG MỘT lần với `xacNhanVanHanh:true`; từ chối ⇒ KHÔNG gửi lại, trạng thái về như trước, trả "tu-choi";
//   • không bao giờ tự đồng ý; 428 lần hai không lặp; đã xác nhận từ trước ⇒ cờ đi ngay lượt đầu;
//   • lỗi hiện qua khoá i18n theo `code` (KHÔNG `error`/`message` thô của máy chủ); 400 NGOAI_CHI_HOI không đi vào hộp xác nhận;
//   • hồi quy: model cục bộ / auto KHÔNG bao giờ mang `xacNhanVanHanh` và KHÔNG hỏi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({ than: [] as Record<string, unknown>[], kich: [] as Array<() => Promise<void>> }));
vi.mock("@/lib/agentApi", () => ({
  agentTrpc: { danhSach: vi.fn(async () => []), cuaToi: vi.fn(async () => []) },
  huyLuotChay: vi.fn(),
  noiLaiLuotChay: vi.fn(),
  moLuotChay: vi.fn(async (than: Record<string, unknown>, o: { onSuKien: (e: unknown) => void }) => {
    h.than.push(JSON.parse(JSON.stringify(than)));
    const k = h.kich.shift();
    if (k) await k();
    else o.onSuKien({ loai: "xong", lyDo: "hoan-thanh" });
  }),
}));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: () => "loi-thuong" }));

import { LoiSinhChuNgoai, thongDiepLoiNgoai } from "@/lib/loiNgoai";
import { datXacNhanVanHanh } from "@/lib/dongYNgoai";
import { useLuotChayAgent } from "./useLuotChayAgent";

const MA = "ngoai:openai:gpt-test";
const RAW = "CHUOI-THO-CUA-MAY-CHU";
const loi428 = () => new LoiSinhChuNgoai({ status: 428, code: "CAN_XAC_NHAN_VAN_HANH", error: RAW, muc: "van-hanh" });
const nem = (e: Error) => async () => {
  throw e;
};

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  h.than.length = 0;
  h.kich.length = 0;
});

function dung(chonModel: string | undefined, hoi?: (k: string, m: string) => Promise<boolean>) {
  return renderHook(() => useLuotChayAgent({ projectId: "p1", chonModel, ...(hoi ? { hoiVanHanh: hoi } : {}) }));
}

describe("428 — hỏi một lần, gửi lại đúng một lần", () => {
  it("đồng ý ⇒ 2 yêu cầu; yêu cầu 1 KHÔNG có cờ, yêu cầu 2 có xacNhanVanHanh:true; hộp hỏi đúng 1 lần với (hội thoại, model)", async () => {
    const hoi = vi.fn(async () => true);
    const { result } = dung(MA, hoi);
    h.kich.push(nem(loi428()));
    let kq: unknown;
    await act(async () => {
      kq = await result.current.gui("đọc a.ts", "hoi");
    });
    expect(h.than).toHaveLength(2);
    expect("xacNhanVanHanh" in h.than[0]!).toBe(false);
    expect(h.than[1]).toMatchObject({ cauHoi: "đọc a.ts", cheDo: "hoi", chonModel: MA, xacNhanVanHanh: true });
    expect(hoi).toHaveBeenCalledTimes(1);
    expect(hoi).toHaveBeenCalledWith("agent|p1", MA);
    expect(kq).toBeUndefined();
    expect(result.current.trangThai.ketThuc?.lyDo).toBe("hoan-thanh");
    expect(result.current.matKetNoi).toBeNull();
  });

  it("★ TỪ CHỐI ⇒ đúng 1 yêu cầu (KHÔNG gửi lại), trả 'tu-choi', trạng thái về như TRƯỚC khi gửi, không báo mất kết nối", async () => {
    const hoi = vi.fn(async () => false);
    const { result } = dung(MA, hoi);
    h.kich.push(nem(loi428()));
    const truoc = result.current.trangThai;
    let kq: unknown;
    await act(async () => {
      kq = await result.current.gui("đọc a.ts", "hoi");
    });
    expect(h.than).toHaveLength(1);
    expect(kq).toBe("tu-choi");
    expect(result.current.trangThai).toEqual(truoc);
    expect(result.current.trangThai.dangChay).toBe(false);
    expect(result.current.matKetNoi).toBeNull();
  });

  it("không truyền hoiVanHanh ⇒ coi như TỪ CHỐI (không bao giờ tự đồng ý)", async () => {
    const { result } = dung(MA);
    h.kich.push(nem(loi428()));
    let kq: unknown;
    await act(async () => {
      kq = await result.current.gui("x", "hoi");
    });
    expect(h.than).toHaveLength(1);
    expect(kq).toBe("tu-choi");
  });

  it("★ 428 lần HAI (sau khi đã đồng ý) ⇒ KHÔNG gửi lần ba, KHÔNG hỏi lần hai; hiện câu i18n theo code, không chuỗi thô của máy chủ", async () => {
    const hoi = vi.fn(async () => true);
    const { result } = dung(MA, hoi);
    h.kich.push(nem(loi428()), nem(loi428()));
    await act(async () => {
      await result.current.gui("x", "hoi");
    });
    expect(h.than).toHaveLength(2);
    expect(hoi).toHaveBeenCalledTimes(1);
    expect(result.current.matKetNoi).toBe(thongDiepLoiNgoai("CAN_XAC_NHAN_VAN_HANH"));
    expect(result.current.matKetNoi).not.toContain(RAW);
    expect(result.current.matKetNoi).not.toBe("");
  });

  it("đã xác nhận từ trước trong hội thoại ⇒ cờ đi NGAY lượt đầu, không hỏi", async () => {
    datXacNhanVanHanh("agent|p1", MA);
    const hoi = vi.fn(async () => true);
    const { result } = dung(MA, hoi);
    await act(async () => {
      await result.current.gui("x", "hoi");
    });
    expect(h.than).toHaveLength(1);
    expect(h.than[0]).toMatchObject({ xacNhanVanHanh: true });
    expect(hoi).not.toHaveBeenCalled();
  });

  it("bấm Dừng trong lúc hộp đang mở ⇒ đồng ý SAU ĐÓ không gửi lại", async () => {
    let mo!: (v: boolean) => void;
    const hoi = vi.fn(() => new Promise<boolean>((r) => (mo = r)));
    const { result } = dung(MA, hoi);
    h.kich.push(nem(loi428()));
    let xong!: Promise<unknown>;
    await act(async () => {
      xong = result.current.gui("x", "hoi");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hoi).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.dung();
    });
    await act(async () => {
      mo(true);
      await xong;
    });
    expect(h.than).toHaveLength(1);
  });
});

describe("lỗi khác — không đi vào hộp xác nhận", () => {
  it("400 NGOAI_CHI_HOI ⇒ 1 yêu cầu, không hỏi, câu i18n theo code (không chuỗi thô)", async () => {
    const hoi = vi.fn(async () => true);
    const { result } = dung(MA, hoi);
    h.kich.push(nem(new LoiSinhChuNgoai({ status: 400, code: "NGOAI_CHI_HOI", error: RAW })));
    await act(async () => {
      await result.current.gui("x", "hoi");
    });
    expect(h.than).toHaveLength(1);
    expect(hoi).not.toHaveBeenCalled();
    expect(result.current.matKetNoi).toBe(thongDiepLoiNgoai("NGOAI_CHI_HOI"));
    expect(result.current.matKetNoi).not.toContain(RAW);
  });
  it("429 NGOAI_VUOT_TRAN kèm tranVuot ⇒ câu nêu trần nào bị vượt", async () => {
    const { result } = dung(MA, vi.fn(async () => true));
    h.kich.push(nem(new LoiSinhChuNgoai({ status: 429, code: "NGOAI_VUOT_TRAN", tranVuot: "nguoi" })));
    await act(async () => {
      await result.current.gui("x", "hoi");
    });
    expect(result.current.matKetNoi).toBe(thongDiepLoiNgoai("NGOAI_VUOT_TRAN", "nguoi"));
  });
  it("lỗi thường (mất mạng) ⇒ đường cũ (mapTrpcError)", async () => {
    const { result } = dung(MA, vi.fn(async () => true));
    h.kich.push(nem(new Error("boom")));
    await act(async () => {
      await result.current.gui("x", "hoi");
    });
    expect(result.current.matKetNoi).toBe("loi-thuong");
  });
});

describe("hồi quy — model cục bộ / auto y như cũ", () => {
  it.each([["vai-tro:code.software"], ["auto"], [undefined]])("chonModel=%s ⇒ thân KHÔNG có xacNhanVanHanh; 428 giả cũng KHÔNG mở hộp", async (cm) => {
    const hoi = vi.fn(async () => true);
    const { result } = dung(cm, hoi);
    h.kich.push(nem(loi428()));
    await act(async () => {
      await result.current.gui("x", "sua");
    });
    expect(h.than).toHaveLength(1);
    expect("xacNhanVanHanh" in h.than[0]!).toBe(false);
    expect(hoi).not.toHaveBeenCalled();
  });
  it("thân lượt cục bộ chế độ sửa giữ NGUYÊN hình cũ (không trường lạ)", async () => {
    const { result } = dung(undefined);
    await act(async () => {
      await result.current.gui("sửa", "sua");
    });
    expect(h.than[0]).toEqual({ cauHoi: "sửa", projectId: "p1", cheDo: "sua" });
  });
});
